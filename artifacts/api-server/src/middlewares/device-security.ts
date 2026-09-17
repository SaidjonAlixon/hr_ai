import type { Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable, userDevicesTable, userSessionsTable } from "@workspace/db";
import type { AuthRequest } from "./auth";
import { canManageUsers } from "../lib/roles";
import {
  clientIp,
  getDeviceSecuritySettings,
  isDeviceSecurityEnforced,
  isLegacySessionCookie,
  parseSecureSessionCookie,
  policyForGroup,
  readDeviceCookie,
  sha256,
  staffGroupForRole,
  touchDevice,
  touchSession,
} from "../lib/device-security";

export type DeviceAuthRequest = AuthRequest & {
  deviceEnforced?: boolean;
  deviceRowId?: number;
  secureSessionId?: number;
};

/**
 * requireAuth dan keyin: faqat enforcement scope dagi userlar uchun
 * device_token + active session tekshiradi.
 */
export async function requireRegisteredDevice(
  req: DeviceAuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Avtorizatsiya talab etiladi",
      });
      return;
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        role: usersTable.role,
        deviceSecurityEnforced: usersTable.deviceSecurityEnforced,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId))
      .limit(1);

    if (!user) {
      res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Foydalanuvchi topilmadi" });
      return;
    }

    const enforced = await isDeviceSecurityEnforced(user);
    req.deviceEnforced = enforced;
    if (!enforced || canManageUsers(user.role)) {
      next();
      return;
    }

    const sessionRaw = req.cookies?.session as string | undefined;
    const secureToken = parseSecureSessionCookie(sessionRaw);
    if (!secureToken) {
      // Legacy cookie bilan enforced user — ruxsat bermaymiz
      if (isLegacySessionCookie(sessionRaw)) {
        res.status(403).json({
          success: false,
          code: "DEVICE_NOT_AUTHORIZED",
          message: "Ushbu qurilmadan foydalanishga ruxsat berilmagan. Qayta login qiling.",
        });
        return;
      }
      res.status(401).json({
        success: false,
        code: "SESSION_REVOKED",
        message: "Sessiya tugagan. Qayta kiring.",
      });
      return;
    }

    const [session] = await db
      .select()
      .from(userSessionsTable)
      .where(eq(userSessionsTable.sessionTokenHash, sha256(secureToken)))
      .limit(1);

    if (!session || session.userId !== req.userId) {
      res.status(401).json({
        success: false,
        code: "SESSION_REVOKED",
        message: "Sessiya topilmadi.",
      });
      return;
    }
    if (session.revokedAt) {
      res.status(403).json({
        success: false,
        code: "SESSION_REVOKED",
        message: "Sessiya admin tomonidan tugatilgan.",
      });
      return;
    }
    if (session.expiresAt.getTime() < Date.now()) {
      res.status(401).json({
        success: false,
        code: "SESSION_REVOKED",
        message: "Sessiya muddati tugagan.",
      });
      return;
    }

    const cred = readDeviceCookie(req);
    if (!cred) {
      res.status(403).json({
        success: false,
        code: "DEVICE_NOT_AUTHORIZED",
        message: "Ushbu qurilmadan foydalanishga ruxsat berilmagan.",
      });
      return;
    }

    const [device] = await db
      .select()
      .from(userDevicesTable)
      .where(
        and(eq(userDevicesTable.userId, req.userId), eq(userDevicesTable.deviceId, cred.deviceId)),
      )
      .limit(1);

    if (!device || device.deviceTokenHash !== sha256(cred.token)) {
      res.status(403).json({
        success: false,
        code: "DEVICE_NOT_AUTHORIZED",
        message: "Ushbu qurilmadan foydalanishga ruxsat berilmagan.",
      });
      return;
    }
    if (device.isBlocked) {
      res.status(403).json({
        success: false,
        code: "DEVICE_NOT_AUTHORIZED",
        message: "Qurilma bloklangan.",
      });
      return;
    }
    if (!device.isVerified) {
      res.status(403).json({
        success: false,
        code: "DEVICE_PENDING",
        message: "Qurilma admin tasdig‘ini kutmoqda.",
      });
      return;
    }

    if (session.deviceRowId != null && session.deviceRowId !== device.id) {
      res.status(403).json({
        success: false,
        code: "DEVICE_NOT_AUTHORIZED",
        message: "Sessiya boshqa qurilmaga biriktirilgan.",
      });
      return;
    }

    const settings = await getDeviceSecuritySettings();
    const policy = policyForGroup(settings, staffGroupForRole(user.role));
    // QR/Face yo‘llari uchun flag (route ichida ham tekshirilishi mumkin)
    (req as DeviceAuthRequest & { devicePolicy?: typeof policy }).devicePolicy = policy;

    req.deviceRowId = device.id;
    req.secureSessionId = session.id;
    void touchDevice(device.id, clientIp(req));
    void touchSession(session.id);
    next();
  } catch (err) {
    console.error("requireRegisteredDevice", err);
    res.status(503).json({ success: false, code: "SERVER_ERROR", message: "Server xatosi" });
  }
}

/** Auth + device (enforced userlar uchun). Non-enforced uchun faqat auth. */
export function requireAuthAndDevice(
  requireAuthMw: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void> | void,
) {
  return [requireAuthMw, requireRegisteredDevice];
}
