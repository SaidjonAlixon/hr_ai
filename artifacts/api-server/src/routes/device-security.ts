import { Router, type IRouter } from "express";
import { and, desc, eq, sql, isNull, gte } from "drizzle-orm";
import {
  db,
  usersTable,
  departmentsTable,
  userDevicesTable,
  userSessionsTable,
  loginAuditLogsTable,
  deviceChangeRequestsTable,
  securityEventsTable,
  deviceSecuritySettingsTable,
} from "@workspace/db";
import { optionalAuth, requireAuth, type AuthRequest } from "../middlewares/auth";
import { requireRegisteredDevice } from "../middlewares/device-security";
import { canManageKochmaAdmin, canManageUsers, canViewKochmaAdmin } from "../lib/roles";
import {
  approveDevice,
  ensureDeviceChangeRequest,
  getDeviceSecuritySettings,
  invalidateSettingsCache,
  reopenDeviceForApproval,
  revokeSessionsForUser,
  staffGroupForRole,
  writeSecurityEvent,
  readDeviceCookie,
  parseDeviceBindRaw,
  findDeviceByClientKey,
  sha256,
} from "../lib/device-security";
import { notifyUser } from "../lib/notify";

const router: IRouter = Router();

function requireView(req: AuthRequest, res: import("express").Response): boolean {
  if (!canViewKochmaAdmin(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return false;
  }
  return true;
}

function requireManage(req: AuthRequest, res: import("express").Response): boolean {
  if (!canManageKochmaAdmin(req.userRole)) {
    res.status(403).json({ error: "Faqat admin o‘zgartira oladi" });
    return false;
  }
  return true;
}

router.get(
  "/admin/devices/summary",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireView(req, res)) return;
    try {
      const [totals] = await db
        .select({
          total: sql<number>`count(*)::int`,
          verified: sql<number>`count(*) filter (where ${userDevicesTable.isVerified} and not ${userDevicesTable.isBlocked})::int`,
          pending: sql<number>`count(*) filter (where not ${userDevicesTable.isVerified} and not ${userDevicesTable.isBlocked})::int`,
          blocked: sql<number>`count(*) filter (where ${userDevicesTable.isBlocked})::int`,
        })
        .from(userDevicesTable);

      const [events] = await db
        .select({
          suspicious: sql<number>`count(*) filter (where ${securityEventsTable.resolvedAt} is null)::int`,
        })
        .from(securityEventsTable)
        .where(gte(securityEventsTable.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));

      const settings = await getDeviceSecuritySettings();
      res.json({
        total: totals?.total ?? 0,
        active: totals?.verified ?? 0,
        pending: totals?.pending ?? 0,
        blocked: totals?.blocked ?? 0,
        suspicious: events?.suspicious ?? 0,
        settings,
      });
    } catch (err) {
      console.error("devices summary", err);
      res.status(503).json({ error: "Yuklanmadi" });
    }
  },
);

router.get(
  "/admin/devices",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireView(req, res)) return;
    try {
      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "all");
      const rows = await db
        .select({
          id: userDevicesTable.id,
          userId: userDevicesTable.userId,
          deviceId: userDevicesTable.deviceId,
          deviceName: userDevicesTable.deviceName,
          deviceType: userDevicesTable.deviceType,
          slot: userDevicesTable.slot,
          os: userDevicesTable.os,
          browser: userDevicesTable.browser,
          userAgent: userDevicesTable.userAgent,
          ipAddress: userDevicesTable.ipAddress,
          lastIp: userDevicesTable.lastIp,
          approxLocation: userDevicesTable.approxLocation,
          firstSeenAt: userDevicesTable.firstSeenAt,
          lastSeenAt: userDevicesTable.lastSeenAt,
          lastLoginAt: userDevicesTable.lastLoginAt,
          isPrimary: userDevicesTable.isPrimary,
          isVerified: userDevicesTable.isVerified,
          isBlocked: userDevicesTable.isBlocked,
          fullName: usersTable.fullName,
          phone: usersTable.phone,
          login: usersTable.login,
          role: usersTable.role,
          departmentName: departmentsTable.name,
          enforced: usersTable.deviceSecurityEnforced,
        })
        .from(userDevicesTable)
        .innerJoin(usersTable, eq(userDevicesTable.userId, usersTable.id))
        .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
        .orderBy(desc(userDevicesTable.lastSeenAt))
        .limit(500);

      let filtered = rows;
      if (q) {
        const qq = q.toLowerCase();
        filtered = rows.filter(
          (r) =>
            r.fullName?.toLowerCase().includes(qq) ||
            r.phone?.includes(q) ||
            r.login?.toLowerCase().includes(qq) ||
            r.deviceId?.toLowerCase().includes(qq) ||
            r.lastIp?.includes(q) ||
            r.ipAddress?.includes(q),
        );
      }
      if (status === "active") {
        filtered = filtered.filter((r) => r.isVerified && !r.isBlocked);
      } else if (status === "pending") {
        filtered = filtered.filter((r) => !r.isVerified && !r.isBlocked);
      } else if (status === "blocked") {
        filtered = filtered.filter((r) => r.isBlocked);
      }

      // Session status
      const deviceIds = filtered.map((r) => r.id);
      const sessions =
        deviceIds.length > 0
          ? await db
              .select({
                deviceRowId: userSessionsTable.deviceRowId,
                id: userSessionsTable.id,
                revokedAt: userSessionsTable.revokedAt,
                expiresAt: userSessionsTable.expiresAt,
              })
              .from(userSessionsTable)
              .where(isNull(userSessionsTable.revokedAt))
          : [];

      const activeSessionByDevice = new Set(
        sessions
          .filter((s) => s.deviceRowId && s.expiresAt.getTime() > Date.now())
          .map((s) => s.deviceRowId!),
      );

      res.json({
        devices: filtered.map((r) => {
          let os = r.os || "";
          let browser = r.browser || "";
          const ua = r.userAgent || "";
          if ((!os || os === "Unknown") && ua) {
            if (/Windows/i.test(ua)) os = "Windows";
            else if (/Android/i.test(ua)) os = "Android";
            else if (/iPhone|iPad|iOS/i.test(ua)) os = "iOS";
            else if (/Mac OS/i.test(ua)) os = "macOS";
            else if (/Linux/i.test(ua)) os = "Linux";
          }
          if ((!browser || browser === "Unknown") && ua) {
            if (/Edg\//i.test(ua)) browser = "Edge";
            else if (/Chrome\//i.test(ua)) browser = "Chrome";
            else if (/Firefox\//i.test(ua)) browser = "Firefox";
            else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
          }
          return {
            ...r,
            os: os || null,
            browser: browser || null,
            staffGroup: staffGroupForRole(r.role),
            status: r.isBlocked
              ? "blocked"
              : !r.isVerified
                ? "pending"
                : activeSessionByDevice.has(r.id)
                  ? "active"
                  : "inactive",
            sessionActive: activeSessionByDevice.has(r.id),
          };
        }),
      });
    } catch (err) {
      console.error("devices list", err);
      res.status(503).json({ error: "Yuklanmadi" });
    }
  },
);

router.get(
  "/admin/devices/item/:id",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireView(req, res)) return;
    const id = Number(req.params.id);
    const [device] = await db.select().from(userDevicesTable).where(eq(userDevicesTable.id, id)).limit(1);
    if (!device) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    const [user] = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        phone: usersTable.phone,
        login: usersTable.login,
        role: usersTable.role,
        departmentName: departmentsTable.name,
        enforced: usersTable.deviceSecurityEnforced,
      })
      .from(usersTable)
      .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
      .where(eq(usersTable.id, device.userId))
      .limit(1);

    const sessions = await db
      .select()
      .from(userSessionsTable)
      .where(eq(userSessionsTable.deviceRowId, id))
      .orderBy(desc(userSessionsTable.createdAt))
      .limit(20);

    const sessionActive = sessions.some(
      (s) => !s.revokedAt && s.expiresAt && s.expiresAt.getTime() > Date.now(),
    );
    const status = device.isBlocked
      ? "blocked"
      : !device.isVerified
        ? "pending"
        : sessionActive
          ? "active"
          : "inactive";

    // Bo‘sh OS/Browser bo‘lsa — userAgent dan taxminiy qiymat
    let os = device.os || "";
    let browser = device.browser || "";
    const ua = device.userAgent || "";
    if ((!os || os === "Unknown") && ua) {
      if (/Windows/i.test(ua)) os = "Windows";
      else if (/Android/i.test(ua)) os = "Android";
      else if (/iPhone|iPad|iOS/i.test(ua)) os = "iOS";
      else if (/Mac OS/i.test(ua)) os = "macOS";
      else if (/Linux/i.test(ua)) os = "Linux";
    }
    if ((!browser || browser === "Unknown") && ua) {
      if (/Edg\//i.test(ua)) browser = "Edge";
      else if (/Chrome\//i.test(ua)) browser = "Chrome";
      else if (/Firefox\//i.test(ua)) browser = "Firefox";
      else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
    }

    res.json({
      device: {
        ...device,
        os: os || null,
        browser: browser || null,
        status,
        sessionActive,
        staffGroup: staffGroupForRole(user?.role),
        fullName: user?.fullName || "",
        phone: user?.phone || null,
        login: user?.login || "",
        role: user?.role || "",
        departmentName: user?.departmentName || null,
        enforced: Boolean(user?.enforced),
      },
      user,
      sessions,
      staffGroup: staffGroupForRole(user?.role),
    });
  },
);

router.post(
  "/admin/devices/item/:id/approve",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireManage(req, res)) return;
    const id = Number(req.params.id);
    const device = await approveDevice(id, req.userId!);
    if (!device) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    await notifyUser({
      userId: device.userId,
      text: "Qurilmangiz asosiy qilib tasdiqlandi. Faqat shu qurilmadan qayta kiring — boshqa joylar yopildi.",
      type: "security",
      linkUrl: "/login",
      title: "Qurilma tasdiqlandi",
    });
    res.json({ ok: true, device });
  },
);

router.post(
  "/admin/devices/item/:id/reject",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireManage(req, res)) return;
    const id = Number(req.params.id);
    const [device] = await db
      .update(userDevicesTable)
      .set({
        isBlocked: true,
        isVerified: false,
        isPrimary: false,
        blockedAt: new Date(),
        blockedBy: req.userId!,
      })
      .where(eq(userDevicesTable.id, id))
      .returning();
    if (!device) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    await revokeSessionsForUser(device.userId, device.id);
    await db
      .update(deviceChangeRequestsTable)
      .set({ status: "rejected", reviewedAt: new Date(), reviewedBy: req.userId! })
      .where(
        and(
          eq(deviceChangeRequestsTable.newDeviceRowId, id),
          eq(deviceChangeRequestsTable.status, "pending"),
        ),
      );
    await notifyUser({
      userId: device.userId,
      text: "Qurilma so‘rovingiz rad etildi. Bu qurilmadan kira olmaysiz — asosiy qurilmangizdan kiring.",
      type: "security",
      linkUrl: "/login",
      title: "Qurilma rad etildi",
    });
    res.json({ ok: true });
  },
);

router.post(
  "/admin/devices/item/:id/block",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireManage(req, res)) return;
    const id = Number(req.params.id);
    const [device] = await db
      .update(userDevicesTable)
      .set({
        isBlocked: true,
        isPrimary: false,
        blockedAt: new Date(),
        blockedBy: req.userId!,
      })
      .where(eq(userDevicesTable.id, id))
      .returning();
    if (!device) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    await revokeSessionsForUser(device.userId, device.id);
    res.json({ ok: true });
  },
);

router.post(
  "/admin/devices/item/:id/unblock",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireManage(req, res)) return;
    const id = Number(req.params.id);
    await db
      .update(userDevicesTable)
      .set({ isBlocked: false, blockedAt: null, blockedBy: null, isVerified: true })
      .where(eq(userDevicesTable.id, id));
    res.json({ ok: true });
  },
);

router.post(
  "/admin/devices/item/:id/set-primary",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireManage(req, res)) return;
    const id = Number(req.params.id);
    // Asosiy qilish = ruxsat berish bilan bir xil: faqat shu qurilma, qolganlari yopiladi
    const device = await approveDevice(id, req.userId!);
    if (!device) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json({ ok: true });
  },
);

router.post(
  "/admin/devices/item/:id/revoke-sessions",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireManage(req, res)) return;
    const id = Number(req.params.id);
    const [device] = await db.select().from(userDevicesTable).where(eq(userDevicesTable.id, id)).limit(1);
    if (!device) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    await revokeSessionsForUser(device.userId, device.id);
    res.json({ ok: true });
  },
);

router.post(
  "/admin/devices/user/:userId/revoke-all-sessions",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireManage(req, res)) return;
    const userId = Number(req.params.userId);
    await revokeSessionsForUser(userId);
    res.json({ ok: true });
  },
);

router.post(
  "/admin/devices/user/:userId/enforce",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireManage(req, res)) return;
    const userId = Number(req.params.userId);
    const enforced = Boolean(req.body?.enforced);
    await db
      .update(usersTable)
      .set({ deviceSecurityEnforced: enforced })
      .where(eq(usersTable.id, userId));
    if (enforced) {
      // Majburiy qilinganda eski legacy sessiyalar yetarli emas â€” keyingi login device talab qiladi
      await revokeSessionsForUser(userId);
    }
    res.json({ ok: true, enforced });
  },
);

router.get(
  "/admin/devices/settings",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireView(req, res)) return;
    res.json(await getDeviceSecuritySettings());
  },
);

router.put(
  "/admin/devices/settings",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireManage(req, res)) return;
    const b = req.body || {};
    await db
      .update(deviceSecuritySettingsTable)
      .set({
        enforcementMode: b.enforcementMode ?? undefined,
        officeMaxDevices: b.officeMaxDevices != null ? Number(b.officeMaxDevices) : undefined,
        pharmacyMaxDevices: b.pharmacyMaxDevices != null ? Number(b.pharmacyMaxDevices) : undefined,
        officeRequireApprove:
          b.officeRequireApprove != null ? Boolean(b.officeRequireApprove) : undefined,
        pharmacyRequireApprove:
          b.pharmacyRequireApprove != null ? Boolean(b.pharmacyRequireApprove) : undefined,
        officeBlockForeign: b.officeBlockForeign != null ? Boolean(b.officeBlockForeign) : undefined,
        pharmacyBlockForeign:
          b.pharmacyBlockForeign != null ? Boolean(b.pharmacyBlockForeign) : undefined,
        officeVerifyQr: b.officeVerifyQr != null ? Boolean(b.officeVerifyQr) : undefined,
        pharmacyVerifyQr: b.pharmacyVerifyQr != null ? Boolean(b.pharmacyVerifyQr) : undefined,
        officeVerifyFace: b.officeVerifyFace != null ? Boolean(b.officeVerifyFace) : undefined,
        pharmacyVerifyFace: b.pharmacyVerifyFace != null ? Boolean(b.pharmacyVerifyFace) : undefined,
        logIpChanges: b.logIpChanges != null ? Boolean(b.logIpChanges) : undefined,
        suspiciousNotify: b.suspiciousNotify != null ? Boolean(b.suspiciousNotify) : undefined,
        updatedById: req.userId!,
        updatedAt: new Date(),
      })
      .where(eq(deviceSecuritySettingsTable.id, 1));
    invalidateSettingsCache();
    res.json(await getDeviceSecuritySettings());
  },
);

router.get(
  "/admin/devices/login-history",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireView(req, res)) return;
    const rows = await db
      .select({
        id: loginAuditLogsTable.id,
        userId: loginAuditLogsTable.userId,
        deviceId: loginAuditLogsTable.deviceId,
        ipAddress: loginAuditLogsTable.ipAddress,
        userAgent: loginAuditLogsTable.userAgent,
        action: loginAuditLogsTable.action,
        status: loginAuditLogsTable.status,
        failureReason: loginAuditLogsTable.failureReason,
        createdAt: loginAuditLogsTable.createdAt,
        fullName: usersTable.fullName,
      })
      .from(loginAuditLogsTable)
      .leftJoin(usersTable, eq(loginAuditLogsTable.userId, usersTable.id))
      .orderBy(desc(loginAuditLogsTable.createdAt))
      .limit(200);
    res.json({ logs: rows });
  },
);

router.get(
  "/admin/devices/events",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireView(req, res)) return;
    const rows = await db
      .select({
        id: securityEventsTable.id,
        userId: securityEventsTable.userId,
        eventType: securityEventsTable.eventType,
        severity: securityEventsTable.severity,
        metadata: securityEventsTable.metadata,
        createdAt: securityEventsTable.createdAt,
        resolvedAt: securityEventsTable.resolvedAt,
        fullName: usersTable.fullName,
      })
      .from(securityEventsTable)
      .leftJoin(usersTable, eq(securityEventsTable.userId, usersTable.id))
      .orderBy(desc(securityEventsTable.createdAt))
      .limit(100);
    res.json({ events: rows });
  },
);

router.get(
  "/admin/devices/users",
  requireAuth,
  requireRegisteredDevice,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireView(req, res)) return;
    const users = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        login: usersTable.login,
        role: usersTable.role,
        phone: usersTable.phone,
        enforced: usersTable.deviceSecurityEnforced,
        departmentName: departmentsTable.name,
      })
      .from(usersTable)
      .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
      .where(eq(usersTable.status, "active"))
      .orderBy(usersTable.fullName)
      .limit(1000);
    res.json({
      users: users.map((u) => ({
        ...u,
        staffGroup: staffGroupForRole(u.role),
      })),
    });
  },
);

/** Xodim: qurilma almashtirish so‘rovi (sessiya yoki login+parol) */
router.post("/devices/me/request-change", async (req: AuthRequest, res): Promise<void> => {
  try {
    await new Promise<void>((resolve) => {
      void optionalAuth(req, res, () => resolve());
    });

    let userId = req.userId;
    const bodyBind = parseDeviceBindRaw(String(req.body?.deviceBind || ""));
    const clientKey = String(req.body?.clientKey || "").trim().slice(0, 120);

    if (!userId) {
      const compact = (v: unknown) => String(v ?? "").replace(/[\s\u00a0\u200b\uFEFF]+/g, "");
      const login = compact(req.body?.login);
      const password = compact(req.body?.password);
      if (login && password) {
        const [u] = await db
          .select({ id: usersTable.id, password: usersTable.password, status: usersTable.status })
          .from(usersTable)
          .where(sql`lower(${usersTable.login}) = lower(${login})`)
          .limit(1);
        if (!u || compact(u.password) !== password || (u.status !== "active" && u.status !== "on_leave")) {
          res.status(401).json({ error: "Login yoki parol noto‘g‘ri" });
          return;
        }
        userId = u.id;
      } else if (bodyBind) {
        // Telegram/login gate: sessiya yo‘q, lekin hozirgina berilgan deviceBind bor
        const [byBind] = await db
          .select()
          .from(userDevicesTable)
          .where(eq(userDevicesTable.deviceId, bodyBind.deviceId))
          .limit(1);
        if (byBind && byBind.deviceTokenHash === sha256(bodyBind.token)) {
          userId = byBind.userId;
        }
      }
      if (!userId) {
        res.status(401).json({ error: "Avtorizatsiya kerak yoki login/parol yuboring" });
        return;
      }
    }

    const cred = readDeviceCookie(req) || bodyBind;
    let device =
      cred
        ? (
            await db
              .select()
              .from(userDevicesTable)
              .where(and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.deviceId, cred.deviceId)))
              .limit(1)
          )[0]
        : null;
    if (!device && clientKey) {
      device = await findDeviceByClientKey(userId, clientKey);
    }
    if (!device) {
      res.status(400).json({ error: "Qurilma topilmadi — Telegram/brauzerdan qayta kirib so‘rang" });
      return;
    }
    // Bloklangan bo‘lsa — qayta ochib so‘rovga qo‘yamiz
    if (device.isBlocked || device.isVerified === false) {
      await reopenDeviceForApproval(device.id);
      [device] = await db
        .select()
        .from(userDevicesTable)
        .where(eq(userDevicesTable.id, device.id))
        .limit(1);
    }

    await ensureDeviceChangeRequest({
      userId,
      newDeviceRowId: device!.id,
      reason: String(req.body?.reason || "").slice(0, 500) || "Login sahifasidan so‘rov",
    });

    await writeSecurityEvent({
      userId,
      deviceRowId: device!.id,
      eventType: "device_change_request",
      severity: "medium",
    });

    const [user] = await db
      .select({ fullName: usersTable.fullName, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    const admins = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.status, "active"));
    for (const a of admins) {
      if (!canManageKochmaAdmin(a.role) && !canManageUsers(a.role)) continue;
      await notifyUser({
        userId: a.id,
        text: `${user?.fullName || "Xodim"} yangi qurilmadan foydalanishga ruxsat so‘ramoqda. Qurilmalar ? Ruxsat so‘rovlari.`,
        type: "security",
        linkUrl: "/admin/qurilmalar",
        title: "Qurilma almashtirish so‘rovi",
      });
    }

    res.json({ ok: true, message: "So‘rov yuborildi — admin tasdig‘ini kuting" });
  } catch (err) {
    console.error("devices/me/request-change", err);
    res.status(503).json({ error: "So‘rov yuborilmadi" });
  }
});

router.get("/devices/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const devices = await db
    .select({
      id: userDevicesTable.id,
      deviceName: userDevicesTable.deviceName,
      deviceType: userDevicesTable.deviceType,
      os: userDevicesTable.os,
      browser: userDevicesTable.browser,
      isPrimary: userDevicesTable.isPrimary,
      isVerified: userDevicesTable.isVerified,
      isBlocked: userDevicesTable.isBlocked,
      lastSeenAt: userDevicesTable.lastSeenAt,
      firstSeenAt: userDevicesTable.firstSeenAt,
    })
    .from(userDevicesTable)
    .where(eq(userDevicesTable.userId, req.userId!))
    .orderBy(desc(userDevicesTable.lastSeenAt));
  res.json({ devices });
});

export default router;

