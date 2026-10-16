import type { Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, usersTable, userDevicesTable } from "@workspace/db";
import { notifyUser } from "./notify";
import { canManageKochmaAdmin, canManageUsers } from "./roles";
import {
  clientIp,
  countVerifiedDevices,
  createServerSession,
  ensureDeviceChangeRequest,
  findDeviceByClientKey,
  findDeviceByCred,
  getDeviceSecuritySettings,
  isDeviceSecurityEnforced,
  parseDeviceBindRaw,
  parseDeviceMeta,
  policyForUser,
  readDeviceCookie,
  refreshDeviceToken,
  registerPendingDevice,
  reopenDeviceForApproval,
  setDeviceCookie,
  staffGroupForRole,
  touchDevice,
  writeLoginAudit,
  writeSecurityEvent,
  getLastDeviceApproval,
  getPrimaryDeviceInfo,
  type CookieSiteMode,
} from "./device-security";

export type DeviceLoginUser = {
  id: number;
  fullName: string;
  role: string;
  deviceSecurityEnforced?: boolean | null;
};

async function notifyAdminsDevice(opts: { title: string; message: string; link?: string }) {
  try {
    const admins = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.status, "active"));
    for (const a of admins) {
      if (!canManageKochmaAdmin(a.role) && !canManageUsers(a.role)) continue;
      await notifyUser({
        userId: a.id,
        text: `${opts.title}: ${opts.message}`,
        type: "security",
        linkUrl: opts.link || "/admin/qurilmalar",
        title: opts.title,
      });
    }
  } catch (err) {
    console.error("notifyAdminsDevice", err);
  }
}

export type DeviceLoginResult =
  | { kind: "ok"; payload: Record<string, unknown> }
  | { kind: "blocked"; status: number; payload: Record<string, unknown> };

/**
 * Qurilma xavfsizligi yoqilgan foydalanuvchi uchun login yakuni.
 * Brauzer va Telegram Mini App bir xil oqimdan o‘tadi.
 */
export async function completeEnforcedDeviceLogin(opts: {
  req: Request;
  res: Response;
  user: DeviceLoginUser;
  fullUser: unknown;
  deviceBody?: unknown;
  /** Telegram Mini App cookie (SameSite=None) */
  siteMode?: CookieSiteMode;
  userAgentOverride?: string;
}): Promise<DeviceLoginResult> {
  const { req, res, user, fullUser } = opts;
  const siteMode = opts.siteMode || "lax";
  const ip = clientIp(req);
  const ua = opts.userAgentOverride || String(req.headers["user-agent"] || "");
  const meta = parseDeviceMeta(opts.deviceBody, ua);
  if (siteMode === "telegram" && (!meta.deviceName || meta.deviceName === "Unknown / Unknown")) {
    meta.deviceName = "Telegram Mini App";
    meta.browser = meta.browser === "Unknown" ? "Telegram" : meta.browser;
    meta.deviceType = meta.deviceType || "mobile";
  }

  const settings = await getDeviceSecuritySettings();
  const group = staffGroupForRole(user.role);
  const policy = policyForUser(settings, user);
  const [lastApproval, primaryDevice] = await Promise.all([
    getLastDeviceApproval(user.id),
    getPrimaryDeviceInfo(user.id),
  ]);
  const devicePayload =
    opts.deviceBody && typeof opts.deviceBody === "object"
      ? (opts.deviceBody as Record<string, unknown>)
      : {};
  const clientKey = String(devicePayload.clientKey || "")
    .trim()
    .slice(0, 120);
  const bodyBind =
    parseDeviceBindRaw(devicePayload.deviceBind as string | undefined) ||
    (devicePayload.deviceId && devicePayload.deviceToken
      ? {
          deviceId: String(devicePayload.deviceId),
          token: String(devicePayload.deviceToken),
        }
      : null);
  const cookieCred = readDeviceCookie(req);
  const cred = cookieCred || bodyBind;

  let device = cred ? await findDeviceByCred(user.id, cred.deviceId, cred.token) : null;
  if (!device && clientKey) {
    device = await findDeviceByClientKey(user.id, clientKey);
  }

  const issueBind = async (row: { id: number; deviceId: string }) => {
    const token = await refreshDeviceToken(row.id);
    setDeviceCookie(res, row.deviceId, token, { siteMode });
    if (clientKey) {
      await db
        .update(userDevicesTable)
        .set({ clientKey })
        .where(and(eq(userDevicesTable.id, row.id), isNull(userDevicesTable.clientKey)));
    }
    return { deviceId: row.deviceId, token };
  };

  if (device && device.isBlocked && clientKey) {
    const byKey = await findDeviceByClientKey(user.id, clientKey);
    if (byKey && byKey.isVerified && !byKey.isBlocked) {
      device = byKey;
    }
  }

  if (device && device.isVerified && !device.isBlocked) {
    const bind = await issueBind(device);
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
      siteMode,
    });
    await writeLoginAudit({
      userId: user.id,
      deviceRowId: device.id,
      deviceId: device.deviceId,
      ipAddress: ip,
      userAgent: ua,
      action: "login",
      status: "success",
      meta: siteMode === "telegram" ? { via: "telegram" } : undefined,
    });
    return {
      kind: "ok",
      payload: {
        user: fullUser,
        ok: true,
        deviceSecurity: {
          enforced: true,
          status: "ok",
          deviceName: device.deviceName,
          isPrimary: device.isPrimary,
        },
        deviceBind: bind,
      },
    };
  }

  if (device && device.isBlocked) {
    await reopenDeviceForApproval(device.id);
    const bind = await issueBind(device);
    await ensureDeviceChangeRequest({
      userId: user.id,
      newDeviceRowId: device.id,
      reason:
        siteMode === "telegram"
          ? "Telegram orqali bloklangan qurilmadan qayta kirish"
          : "Bloklangan qurilmadan qayta kirish — almashtirish so‘rovi",
    });
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
    const isForeign = Boolean(primaryDevice && primaryDevice.id !== device.id);
    await notifyAdminsDevice({
      title: isForeign ? "Boshqa qurilmadan kirish" : "Qurilma almashtirish so‘rovi",
      message: isForeign
        ? `${user.fullName} BOSHQA qurilmadan kiryapti va ruxsat so‘ramoqda. Asosiy: ${primaryDevice?.deviceName || "—"}. Yangi: ${device.deviceName || "qurilma"}${siteMode === "telegram" ? " · Telegram" : ""}. Qurilmalar → Ruxsat so‘rovlari.`
        : `${user.fullName} qurilma almashtirish so‘ramoqda (${device.deviceName || "qurilma"})${siteMode === "telegram" ? " · Telegram" : ""}. Qurilmalar → Ruxsat so‘rovlari.`,
    });
    return {
      kind: "blocked",
      status: 403,
      payload: {
        success: false,
        code: "DEVICE_PENDING",
        error: "Qurilma admin tasdig‘ini kutmoqda.",
        message: isForeign
          ? "Diqqat: siz boshqa qurilmadan kiryapsiz. So‘rov adminga yuborildi — tasdiqlansa shu qurilma asosiy bo‘ladi."
          : "So‘rov adminga yuborildi. Tasdiqlansa shu qurilma asosiy bo‘ladi.",
        canRequestChange: true,
        requestSent: true,
        foreignDevice: isForeign,
        primaryDevice: primaryDevice
          ? { name: primaryDevice.deviceName, lastLoginAt: primaryDevice.lastLoginAt }
          : null,
        deviceBind: bind,
        device: { name: device.deviceName, os: device.os, browser: device.browser },
        lastApproval,
      },
    };
  }

  if (device && !device.isVerified) {
    const bind = await issueBind(device);
    await ensureDeviceChangeRequest({
      userId: user.id,
      newDeviceRowId: device.id,
      reason:
        siteMode === "telegram"
          ? "Telegram orqali yangi qurilma tasdiq kutilmoqda"
          : "Yangi qurilma tasdiq kutilmoqda",
    });
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
    const isForeign = Boolean(primaryDevice && primaryDevice.id !== device.id);
    await notifyAdminsDevice({
      title: isForeign ? "Boshqa qurilmadan kirish" : "Qurilma almashtirish so‘rovi",
      message: isForeign
        ? `${user.fullName} BOSHQA qurilmadan kiryapti va ruxsat so‘ramoqda. Asosiy: ${primaryDevice?.deviceName || "—"}. Yangi: ${device.deviceName || "qurilma"}${siteMode === "telegram" ? " · Telegram" : ""}. Qurilmalar → Ruxsat so‘rovlari.`
        : `${user.fullName} qurilma tasdig‘ini kutmoqda (${device.deviceName || "qurilma"})${siteMode === "telegram" ? " · Telegram" : ""}. Qurilmalar → Ruxsat so‘rovlari.`,
    });
    return {
      kind: "blocked",
      status: 403,
      payload: {
        success: false,
        code: "DEVICE_PENDING",
        error: "Qurilma admin tasdig‘ini kutmoqda.",
        message: isForeign
          ? "Diqqat: siz boshqa qurilmadan kiryapsiz. So‘rov adminga yuborildi — tasdiqlansa shu qurilmadan kira olasiz."
          : "So‘rov adminga yuborildi. Tasdiqlansa shu qurilmadan kira olasiz.",
        canRequestChange: true,
        requestSent: true,
        foreignDevice: isForeign,
        primaryDevice: primaryDevice
          ? { name: primaryDevice.deviceName, lastLoginAt: primaryDevice.lastLoginAt }
          : null,
        deviceBind: bind,
        device: {
          name: device.deviceName,
          os: device.os,
          browser: device.browser,
        },
        lastApproval,
      },
    };
  }

  const verifiedCount = await countVerifiedDevices(user.id);

  if (verifiedCount > 0 && policy.blockForeign) {
    const pending = await registerPendingDevice({
      userId: user.id,
      meta,
      ip,
      slot: group,
      clientKey: clientKey || null,
    });
    setDeviceCookie(res, pending.deviceId, pending.token, { siteMode });
    const deviceBind = { deviceId: pending.deviceId, token: pending.token };

    try {
      await ensureDeviceChangeRequest({
        userId: user.id,
        newDeviceRowId: pending.rowId,
        reason:
          siteMode === "telegram"
            ? "Telegram Mini App orqali yangi qurilmadan kirish"
            : "Yangi qurilmadan kirish urinishi",
      });
    } catch (e) {
      console.error("device_change_request insert", e);
    }

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
      metadata: { deviceName: meta.deviceName, ip, via: siteMode },
    });
    const primaryName = primaryDevice?.deviceName || "asosiy telefon";
    await notifyAdminsDevice({
      title: "Boshqa qurilmadan kirish",
      message: `${user.fullName} BOSHQA qurilmadan kiryapti va ruxsat so‘ramoqda. Asosiy: ${primaryName}. Yangi: ${meta.deviceName}${siteMode === "telegram" ? " · Telegram" : ""}. Qurilmalar → Ruxsat so‘rovlari.`,
    });

    return {
      kind: "blocked",
      status: 403,
      payload: {
        success: false,
        code: "DEVICE_NOT_AUTHORIZED",
        error:
          "Ushbu akkaunt boshqa qurilmaga biriktirilgan. Iltimos, o‘zingizga biriktirilgan asosiy qurilmadan kiring.",
        message:
          "Diqqat: siz boshqa qurilmadan kiryapsiz. Akkaunt asosiy telefonga biriktirilgan. So‘rov adminga yuborildi — tasdiqlansa shu telefon asosiy bo‘ladi.",
        canRequestChange: true,
        requestSent: true,
        foreignDevice: true,
        primaryDevice: primaryDevice
          ? { name: primaryDevice.deviceName, lastLoginAt: primaryDevice.lastLoginAt }
          : null,
        deviceBind,
        device: { name: meta.deviceName, os: meta.os, browser: meta.browser },
        lastApproval,
      },
    };
  }

  const pending = await registerPendingDevice({
    userId: user.id,
    meta,
    ip,
    slot: group,
    clientKey: clientKey || null,
  });
  setDeviceCookie(res, pending.deviceId, pending.token, { siteMode });
  const firstBind = { deviceId: pending.deviceId, token: pending.token };

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
      siteMode,
    });
    await writeLoginAudit({
      userId: user.id,
      deviceRowId: pending.rowId,
      deviceId: pending.deviceId,
      ipAddress: ip,
      userAgent: ua,
      action: "login",
      status: "success",
      meta: { autoApproved: true, via: siteMode === "telegram" ? "telegram" : "web" },
    });
    return {
      kind: "ok",
      payload: {
        user: fullUser,
        ok: true,
        deviceSecurity: { enforced: true, status: "ok", autoApproved: true },
        deviceBind: firstBind,
      },
    };
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
    metadata: { deviceName: meta.deviceName, via: siteMode },
  });
  await notifyAdminsDevice({
    title: "Yangi qurilma",
    message: `${user.fullName} yangi qurilmadan kirishga harakat qildi (${meta.deviceName})${siteMode === "telegram" ? " · Telegram" : ""}.`,
  });

  return {
    kind: "blocked",
    status: 403,
    payload: {
      success: false,
      code: "DEVICE_PENDING",
      error: "Yangi qurilma aniqlandi. Administrator tasdig‘i kerak.",
      message:
        "Yangi qurilma aniqlandi. Ushbu qurilmani asosiy qurilma sifatida biriktirish uchun administrator tasdig‘i kerak.",
      canRequestChange: true,
      requestSent: true,
      deviceBind: firstBind,
      device: { name: meta.deviceName, os: meta.os, browser: meta.browser },
      lastApproval,
    },
  };
}

/** Device security yoqilganmi (adminlar odatda ochiq). */
export async function shouldEnforceDeviceLogin(user: DeviceLoginUser): Promise<boolean> {
  const modeEnforced = await isDeviceSecurityEnforced(user);
  return modeEnforced && (!canManageUsers(user.role) || Boolean(user.deviceSecurityEnforced));
}
