import type { Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  usersTable,
  userDevicesTable,
  userSessionsTable,
  withDbRetry,
  isTransientDbError,
} from "@workspace/db";
import { canManageUsers } from "../lib/roles";
import {
  clientIp,
  isDeviceSecurityEnforced,
  isLegacySessionCookie,
  parseSecureSessionCookie,
  readDeviceCookie,
  sha256,
  touchDevice,
  touchSession,
} from "../lib/device-security";

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  deviceEnforced?: boolean;
  deviceRowId?: number;
  secureSessionId?: number;
}

function dbErrDetail(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string; code?: string }; code?: string };
  return [e?.code, e?.message, e?.cause?.code, e?.cause?.message].filter(Boolean).join(" | ");
}

async function loadSessionUser(
  req: AuthRequest,
): Promise<{ id: number; role: string; deviceSecurityEnforced: boolean } | null> {
  return withDbRetry(() => loadSessionUserOnce(req), { attempts: 3, label: "loadSessionUser" });
}

async function loadSessionUserOnce(
  req: AuthRequest,
): Promise<{ id: number; role: string; deviceSecurityEnforced: boolean } | null> {
  const sessionCookie = req.cookies?.session;
  if (!sessionCookie) return null;

  const secureToken = parseSecureSessionCookie(sessionCookie);
  if (secureToken) {
    const [session] = await db
      .select()
      .from(userSessionsTable)
      .where(eq(userSessionsTable.sessionTokenHash, sha256(secureToken)))
      .limit(1);
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      return null;
    }
    const [user] = await db
      .select({
        id: usersTable.id,
        role: usersTable.role,
        status: usersTable.status,
        deviceSecurityEnforced: usersTable.deviceSecurityEnforced,
      })
      .from(usersTable)
      .where(eq(usersTable.id, session.userId))
      .limit(1);
    if (!user || (user.status !== "active" && user.status !== "on_leave")) {
      return null;
    }
    (req as AuthRequest).secureSessionId = session.id;
    (req as AuthRequest).deviceRowId = session.deviceRowId ?? undefined;
    return {
      id: user.id,
      role: user.role,
      deviceSecurityEnforced: Boolean(user.deviceSecurityEnforced),
    };
  }

  if (!isLegacySessionCookie(sessionCookie)) return null;
  let decoded: { userId?: number };
  try {
    decoded = JSON.parse(Buffer.from(sessionCookie, "base64").toString());
  } catch {
    return null;
  }
  if (!decoded?.userId) return null;

  const [user] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      status: usersTable.status,
      deviceSecurityEnforced: usersTable.deviceSecurityEnforced,
    })
    .from(usersTable)
    .where(eq(usersTable.id, decoded.userId))
    .limit(1);

  if (!user || (user.status !== "active" && user.status !== "on_leave")) {
    return null;
  }
  return {
    id: user.id,
    role: user.role,
    deviceSecurityEnforced: Boolean(user.deviceSecurityEnforced),
  };
}

async function enforceDeviceIfNeeded(
  req: AuthRequest,
  res: Response,
  user: { id: number; role: string; deviceSecurityEnforced: boolean },
): Promise<boolean> {
  // Admin panel boshqaruvi uchun adminlar device check dan ozod (chicken-egg)
  if (canManageUsers(user.role)) {
    req.deviceEnforced = false;
    return true;
  }

  const enforced = await isDeviceSecurityEnforced(user);
  req.deviceEnforced = enforced;
  if (!enforced) return true;

  const sessionRaw = req.cookies?.session as string | undefined;
  const secureToken = parseSecureSessionCookie(sessionRaw);
  if (!secureToken) {
    res.status(403).json({
      success: false,
      code: "DEVICE_NOT_AUTHORIZED",
      message: "Ushbu qurilmadan foydalanishga ruxsat berilmagan.",
      error: "Ushbu qurilmadan foydalanishga ruxsat berilmagan.",
    });
    return false;
  }

  const [session] = await db
    .select()
    .from(userSessionsTable)
    .where(eq(userSessionsTable.sessionTokenHash, sha256(secureToken)))
    .limit(1);

  if (!session || session.userId !== user.id) {
    res.status(401).json({
      success: false,
      code: "SESSION_REVOKED",
      message: "Sessiya topilmadi.",
      error: "Sessiya topilmadi.",
    });
    return false;
  }
  if (session.revokedAt) {
    res.status(403).json({
      success: false,
      code: "SESSION_REVOKED",
      message: "Sessiya admin tomonidan tugatilgan.",
      error: "Sessiya admin tomonidan tugatilgan.",
    });
    return false;
  }
  if (session.expiresAt.getTime() < Date.now()) {
    res.status(401).json({
      success: false,
      code: "SESSION_REVOKED",
      message: "Sessiya muddati tugagan.",
      error: "Sessiya muddati tugagan.",
    });
    return false;
  }

  const cred = readDeviceCookie(req);
  if (!cred) {
    res.status(403).json({
      success: false,
      code: "DEVICE_NOT_AUTHORIZED",
      message: "Ushbu qurilmadan foydalanishga ruxsat berilmagan.",
      error: "Ushbu qurilmadan foydalanishga ruxsat berilmagan.",
    });
    return false;
  }

  const [device] = await db
    .select()
    .from(userDevicesTable)
    .where(and(eq(userDevicesTable.userId, user.id), eq(userDevicesTable.deviceId, cred.deviceId)))
    .limit(1);

  if (!device || device.deviceTokenHash !== sha256(cred.token)) {
    res.status(403).json({
      success: false,
      code: "DEVICE_NOT_AUTHORIZED",
      message: "Ushbu qurilmadan foydalanishga ruxsat berilmagan.",
      error: "Ushbu qurilmadan foydalanishga ruxsat berilmagan.",
    });
    return false;
  }
  if (device.isBlocked || !device.isVerified) {
    res.status(403).json({
      success: false,
      code: device.isBlocked ? "DEVICE_NOT_AUTHORIZED" : "DEVICE_PENDING",
      message: device.isBlocked
        ? "Qurilma bloklangan."
        : "Qurilma admin tasdig‘ini kutmoqda.",
      error: device.isBlocked
        ? "Qurilma bloklangan."
        : "Qurilma admin tasdig‘ini kutmoqda.",
    });
    return false;
  }
  if (session.deviceRowId != null && session.deviceRowId !== device.id) {
    res.status(403).json({
      success: false,
      code: "DEVICE_NOT_AUTHORIZED",
      message: "Sessiya boshqa qurilmaga biriktirilgan.",
      error: "Sessiya boshqa qurilmaga biriktirilgan.",
    });
    return false;
  }

  req.deviceRowId = device.id;
  req.secureSessionId = session.id;
  void touchDevice(device.id, clientIp(req));
  void touchSession(session.id);
  return true;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await loadSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Avtorizatsiya talab etiladi" });
      return;
    }
    req.userId = user.id;
    req.userRole = user.role;
    const ok = await enforceDeviceIfNeeded(req, res, user);
    if (!ok) return;
    next();
  } catch (err) {
    console.error("requireAuth db error:", dbErrDetail(err));
    res.status(503).json({
      error: isTransientDbError(err)
        ? "Baza bilan aloqa vaqtincha yo‘q — qayta urinib ko‘ring"
        : "Server vaqtincha ishlamayapti, qayta urinib ko‘ring",
    });
  }
}

/** Sessiya bo‘lsa userId qo‘yadi, bo‘lmasa ham o‘tkazadi (login sahifa yordami). */
export async function optionalAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await loadSessionUser(req);
    if (user) {
      req.userId = user.id;
      req.userRole = user.role;
    }
  } catch (err) {
    console.error("optionalAuth db error:", dbErrDetail(err));
  }
  next();
}
