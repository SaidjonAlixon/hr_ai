import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, departmentsTable, userDevicesTable } from "@workspace/db";
import { setSessionCookie, clearSessionCookie } from "../lib/session";
import {
  clientIp,
  createServerSession,
  findDeviceByCred,
  getDeviceSecuritySettings,
  isDeviceSecurityEnforced,
  parseDeviceMeta,
  policyForGroup,
  readDeviceCookie,
  registerPendingDevice,
  setDeviceCookie,
  clearDeviceCookie,
  staffGroupForRole,
  writeLoginAudit,
  writeSecurityEvent,
  countVerifiedDevices,
  touchDevice,
} from "../lib/device-security";
import { notifyUser } from "../lib/notify";
import { canManageUsers } from "../lib/roles";

const router: IRouter = Router();

async function getUserWithDept(userId: number) {
  const [user] = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      departmentId: usersTable.departmentId,
      departmentName: departmentsTable.name,
      login: usersTable.login,
      phone: usersTable.phone,
      status: usersTable.status,
      deviceSecurityEnforced: usersTable.deviceSecurityEnforced,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
    .where(eq(usersTable.id, userId));
  return user ?? null;
}

function canSignIn(status?: string | null) {
  return status === "active" || status === "on_leave";
}

function statusBlockMessage(status?: string | null) {
  if (status === "on_leave") return "Foydalanuvchi tatilda";
  if (status === "terminated") return "Foydalanuvchi tugatilgan";
  if (status === "vacant" || status === "inactive" || status === "blocked") {
    return "Foydalanuvchi hozir bo‘sh holatda";
  }
  return "Foydalanuvchi faol emas";
}

function isDbDown(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === "ETIMEDOUT" ||
    e.code === "ECONNREFUSED" ||
    e.code === "ENOTFOUND" ||
    e.code === "57P01" ||
    /timeout|ECONNRESET|Connection terminated/i.test(String(e.message || ""))
  );
}

async function notifyAdminsDevice(opts: {
  title: string;
  message: string;
  link?: string;
}) {
  try {
    const admins = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.status, "active"));
    for (const a of admins) {
      if (!canManageUsers(a.role)) continue;
      await notifyUser({
        userId: a.id,
        text: `${opts.title}: ${opts.message}`,
        type: "security",
        linkUrl: opts.link || "/admin/qurilmalar",
      });
    }
  } catch (err) {
    console.error("notifyAdminsDevice", err);
  }
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const compact = (v: unknown) => String(v ?? "").replace(/[\s\u00a0\u200b\uFEFF]+/g, "");
  const login = compact(req.body?.login);
  const password = compact(req.body?.password);
  const ip = clientIp(req);
  const ua = String(req.headers["user-agent"] || "");
  const meta = parseDeviceMeta(req.body?.device, ua);

  if (!login || !password) {
    res.status(400).json({ error: "Login va parol kerak" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(sql`lower(${usersTable.login}) = lower(${login})`);

    if (!user || compact(user.password) !== password) {
      await writeLoginAudit({
        userId: user?.id,
        ipAddress: ip,
        userAgent: ua,
        action: "login",
        status: "fail",
        failureReason: "BAD_CREDENTIALS",
      });
      res.status(401).json({ error: "Login yoki parol noto'g'ri" });
      return;
    }

    if (!canSignIn(user.status)) {
      await writeLoginAudit({
        userId: user.id,
        ipAddress: ip,
        userAgent: ua,
        action: "login",
        status: "fail",
        failureReason: "STATUS_BLOCKED",
      });
      res.status(403).json({ error: statusBlockMessage(user.status) });
      return;
    }

    const enforced =
      !canManageUsers(user.role) && (await isDeviceSecurityEnforced(user));
    const fullUser = await getUserWithDept(user.id);

    // ========== Opt-in yo‘q — eski login ==========
    if (!enforced) {
      setSessionCookie(res, user.id);
      await writeLoginAudit({
        userId: user.id,
        ipAddress: ip,
        userAgent: ua,
        action: "login",
        status: "success",
        failureReason: null,
        meta: { mode: "legacy" },
      });
      req.log?.info?.({ userId: user.id, role: user.role }, "User logged in");
      res.json({ user: fullUser, deviceSecurity: { enforced: false } });
      return;
    }

    // ========== Device security enforced ==========
    const settings = await getDeviceSecuritySettings();
    const group = staffGroupForRole(user.role);
    const policy = policyForGroup(settings, group);
    const cred = readDeviceCookie(req);
    let device = cred ? await findDeviceByCred(user.id, cred.deviceId, cred.token) : null;

    if (device && device.isBlocked) {
      await writeLoginAudit({
        userId: user.id,
        deviceRowId: device.id,
        deviceId: device.deviceId,
        ipAddress: ip,
        userAgent: ua,
        action: "login",
        status: "blocked",
        failureReason: "DEVICE_BLOCKED",
      });
      await writeSecurityEvent({
        userId: user.id,
        deviceRowId: device.id,
        eventType: "device_blocked_login",
        severity: "high",
      });
      res.status(403).json({
        success: false,
        code: "DEVICE_NOT_AUTHORIZED",
        error: "Qurilma bloklangan. Administratorga murojaat qiling.",
        message: "Qurilma bloklangan. Administratorga murojaat qiling.",
      });
      return;
    }

    if (device && device.isVerified) {
      await touchDevice(device.id, ip);
      await db
        .update(userDevicesTable)
        .set({ lastLoginAt: new Date(), lastIp: ip })
        .where(eq(userDevicesTable.id, device.id));
      await createServerSession({
        userId: user.id,
        deviceRowId: device.id,
        ipAddress: ip,
        userAgent: ua,
        res,
      });
      await writeLoginAudit({
        userId: user.id,
        deviceRowId: device.id,
        deviceId: device.deviceId,
        ipAddress: ip,
        userAgent: ua,
        action: "login",
        status: "success",
      });
      res.json({
        user: fullUser,
        deviceSecurity: {
          enforced: true,
          status: "ok",
          deviceName: device.deviceName,
          isPrimary: device.isPrimary,
        },
      });
      return;
    }

    if (device && !device.isVerified) {
      await writeLoginAudit({
        userId: user.id,
        deviceRowId: device.id,
        deviceId: device.deviceId,
        ipAddress: ip,
        userAgent: ua,
        action: "login",
        status: "pending",
        failureReason: "DEVICE_PENDING",
      });
      res.status(403).json({
        success: false,
        code: "DEVICE_PENDING",
        error: "Qurilma admin tasdig‘ini kutmoqda.",
        message: "Qurilma admin tasdig‘ini kutmoqda.",
        device: {
          name: device.deviceName,
          os: device.os,
          browser: device.browser,
        },
      });
      return;
    }

    // Yangi yoki noma’lum qurilma
    const verifiedCount = await countVerifiedDevices(user.id);

    if (verifiedCount > 0 && policy.blockForeign) {
      // Yangi qurilma — pending + block dashboard
      const pending = await registerPendingDevice({
        userId: user.id,
        meta,
        ip,
        slot: group,
      });
      setDeviceCookie(res, pending.deviceId, pending.token);

      await writeLoginAudit({
        userId: user.id,
        deviceRowId: pending.rowId,
        deviceId: pending.deviceId,
        ipAddress: ip,
        userAgent: ua,
        action: "login",
        status: "blocked",
        failureReason: "DEVICE_NOT_AUTHORIZED",
      });
      await writeSecurityEvent({
        userId: user.id,
        deviceRowId: pending.rowId,
        eventType: "foreign_device_login",
        severity: "high",
        metadata: { deviceName: meta.deviceName, ip },
      });
      if (settings.suspiciousNotify) {
        await notifyAdminsDevice({
          title: "Shubhali kirish",
          message: `${user.fullName} yangi qurilmadan kirishga harakat qildi (${meta.deviceName}).`,
        });
      }

      res.status(403).json({
        success: false,
        code: "DEVICE_NOT_AUTHORIZED",
        error:
          "Ushbu akkaunt boshqa qurilmaga biriktirilgan. Iltimos, o‘zingizga biriktirilgan asosiy qurilmadan kiring.",
        message:
          "Ushbu akkaunt boshqa qurilmaga biriktirilgan. Iltimos, o‘zingizga biriktirilgan asosiy qurilmadan kiring. Qurilmangizni almashtirish kerak bo‘lsa administratorga murojaat qiling.",
        canRequestChange: true,
        device: { name: meta.deviceName, os: meta.os, browser: meta.browser },
      });
      return;
    }

    // Birinchi qurilma (yoki blockForeign o‘chiq)
    const pending = await registerPendingDevice({
      userId: user.id,
      meta,
      ip,
      slot: group,
    });
    setDeviceCookie(res, pending.deviceId, pending.token);

    if (!policy.requireApprove) {
      await db
        .update(userDevicesTable)
        .set({
          isVerified: true,
          isPrimary: true,
          lastLoginAt: new Date(),
        })
        .where(eq(userDevicesTable.id, pending.rowId));
      await createServerSession({
        userId: user.id,
        deviceRowId: pending.rowId,
        ipAddress: ip,
        userAgent: ua,
        res,
      });
      await writeLoginAudit({
        userId: user.id,
        deviceRowId: pending.rowId,
        deviceId: pending.deviceId,
        ipAddress: ip,
        userAgent: ua,
        action: "login",
        status: "success",
        meta: { autoApproved: true },
      });
      res.json({
        user: fullUser,
        deviceSecurity: { enforced: true, status: "ok", autoApproved: true },
      });
      return;
    }

    await writeLoginAudit({
      userId: user.id,
      deviceRowId: pending.rowId,
      deviceId: pending.deviceId,
      ipAddress: ip,
      userAgent: ua,
      action: "login",
      status: "pending",
      failureReason: "DEVICE_PENDING",
    });
    await writeSecurityEvent({
      userId: user.id,
      deviceRowId: pending.rowId,
      eventType: "new_device_pending",
      severity: "medium",
      metadata: { deviceName: meta.deviceName },
    });
    await notifyAdminsDevice({
      title: "Yangi qurilma",
      message: `${user.fullName} yangi qurilmadan kirishga harakat qildi (${meta.deviceName}).`,
    });

    res.status(403).json({
      success: false,
      code: "DEVICE_PENDING",
      error: "Yangi qurilma aniqlandi. Administrator tasdig‘i kerak.",
      message: "Yangi qurilma aniqlandi. Ushbu qurilmani asosiy qurilma sifatida biriktirish uchun administrator tasdig‘i kerak.",
      device: { name: meta.deviceName, os: meta.os, browser: meta.browser },
    });
  } catch (err) {
    console.error("auth/login error:", err);
    if (!process.env.DATABASE_URL) {
      res.status(503).json({
        error: "DATABASE_URL sozlanmagan — Vercel Environment Variables tekshiring",
      });
      return;
    }
    res.status(503).json({
      error: isDbDown(err)
        ? "Baza bilan aloqa yo‘q — birozdan keyin qayta urinib ko‘ring"
        : "Server xatosi — qayta urinib ko‘ring",
    });
  }
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const sessionCookie = req.cookies?.session;
  if (!sessionCookie) {
    res.status(204).end();
    return;
  }

  try {
    // Dual-mode: load via requireAuth path
    const { optionalAuth } = await import("../middlewares/auth");
    await new Promise<void>((resolve) => {
      void optionalAuth(req as any, res, () => resolve());
    });
    const userId = (req as any).userId as number | undefined;
    if (!userId) {
      res.status(204).end();
      return;
    }
    const user = await getUserWithDept(userId);
    if (!user) {
      res.status(401).json({ error: "Foydalanuvchi topilmadi" });
      return;
    }
    const enforced = await isDeviceSecurityEnforced(user as any);
    res.json({ ...user, deviceSecurityEnforced: enforced || Boolean(user.deviceSecurityEnforced) });
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(401).json({ error: "Noto'g'ri sessiya" });
      return;
    }
    console.error("auth/me error:", err);
    res.status(503).json({
      error: isDbDown(err)
        ? "Baza bilan aloqa yo‘q — birozdan keyin qayta urinib ko‘ring"
        : "Server xatosi — qayta urinib ko‘ring",
    });
  }
});

/** O‘z profili: ism/familiya + parol */
router.patch("/auth/profile", async (req, res): Promise<void> => {
  const { optionalAuth } = await import("../middlewares/auth");
  await new Promise<void>((resolve) => {
    void optionalAuth(req as any, res, () => resolve());
  });
  const userId = (req as any).userId as number | undefined;
  if (!userId) {
    res.status(401).json({ error: "Avtorizatsiya kerak" });
    return;
  }

  const firstName = String(req.body?.firstName ?? "").trim();
  const lastName = String(req.body?.lastName ?? "").trim();
  const password = String(req.body?.password ?? "").trim();

  if (!firstName || !lastName) {
    res.status(400).json({ error: "Ism va familiyani kiriting" });
    return;
  }
  if (!password) {
    res.status(400).json({ error: "Yangi parolni kiriting" });
    return;
  }
  if (password.length < 4) {
    res.status(400).json({ error: "Parol kamida 4 belgi bo‘lsin" });
    return;
  }

  const fullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();

  try {
    const [updated] = await db
      .update(usersTable)
      .set({ fullName, password })
      .where(eq(usersTable.id, userId))
      .returning({ id: usersTable.id });

    if (!updated) {
      res.status(404).json({ error: "Foydalanuvchi topilmadi" });
      return;
    }

    const user = await getUserWithDept(userId);
    res.json({ user, message: "Profil yangilandi — parol bazaga saqlandi" });
  } catch (err) {
    console.error("auth/profile error:", err);
    res.status(503).json({
      error: isDbDown(err)
        ? "Baza bilan aloqa yo‘q — birozdan keyin qayta urinib ko‘ring"
        : "Server xatosi — qayta urinib ko‘ring",
    });
  }
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  try {
    const { optionalAuth } = await import("../middlewares/auth");
    await new Promise<void>((resolve) => {
      void optionalAuth(req as any, res, () => resolve());
    });
    const userId = (req as any).userId as number | undefined;
    if (userId) {
      const { parseSecureSessionCookie, sha256 } = await import("../lib/device-security");
      const { userSessionsTable } = await import("@workspace/db");
      const token = parseSecureSessionCookie(req.cookies?.session);
      if (token) {
        await db
          .update(userSessionsTable)
          .set({ revokedAt: new Date() })
          .where(eq(userSessionsTable.sessionTokenHash, sha256(token)));
      }
    }
  } catch {
    /* ignore */
  }
  clearSessionCookie(res);
  clearDeviceCookie(res);
  res.json({ ok: true });
});

export default router;
