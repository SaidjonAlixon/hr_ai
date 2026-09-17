import { createHash, randomBytes } from "crypto";
import type { Request, Response } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  deviceSecuritySettingsTable,
  userDevicesTable,
  userSessionsTable,
  loginAuditLogsTable,
  securityEventsTable,
  deviceChangeRequestsTable,
} from "@workspace/db";
import { isProdEnv } from "./session";

export const DEVICE_COOKIE = "device_cred";
export const SECURE_SESSION_COOKIE = "session";
export const LEGACY_SESSION_PREFIX = "legacy:";

export type StaffGroup = "office" | "pharmacy";
export type EnforcementMode = "off" | "selected" | "office" | "pharmacy" | "all";

export type DeviceSecuritySettings = {
  id: number;
  enforcementMode: EnforcementMode;
  officeMaxDevices: number;
  pharmacyMaxDevices: number;
  officeRequireApprove: boolean;
  pharmacyRequireApprove: boolean;
  officeBlockForeign: boolean;
  pharmacyBlockForeign: boolean;
  officeVerifyQr: boolean;
  pharmacyVerifyQr: boolean;
  officeVerifyFace: boolean;
  pharmacyVerifyFace: boolean;
  logIpChanges: boolean;
  suspiciousNotify: boolean;
};

const PHARMACY_ROLES = new Set(["mudir", "farmasevt", "stajyor", "koordinator"]);

export function staffGroupForRole(role?: string | null): StaffGroup {
  return PHARMACY_ROLES.has(String(role || "").toLowerCase()) ? "pharmacy" : "office";
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function clientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0]!.trim();
  return req.socket.remoteAddress || "";
}

export type DeviceMeta = {
  deviceName?: string;
  deviceType?: string;
  os?: string;
  osVersion?: string;
  browser?: string;
  browserVersion?: string;
  userAgent?: string;
};

export function parseDeviceMeta(body: unknown, uaHeader?: string): DeviceMeta {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const ua = String(b.userAgent || uaHeader || "");
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const isTablet = /iPad|Tablet/i.test(ua);
  let browser = String(b.browser || "");
  let os = String(b.os || "");
  if (!browser) {
    if (/Edg\//i.test(ua)) browser = "Edge";
    else if (/Chrome\//i.test(ua)) browser = "Chrome";
    else if (/Firefox\//i.test(ua)) browser = "Firefox";
    else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
    else browser = "Unknown";
  }
  if (!os) {
    if (/Windows/i.test(ua)) os = "Windows";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/iPhone|iPad|iOS/i.test(ua)) os = "iOS";
    else if (/Mac OS/i.test(ua)) os = "macOS";
    else if (/Linux/i.test(ua)) os = "Linux";
    else os = "Unknown";
  }
  return {
    deviceName: String(b.deviceName || `${browser} / ${os}`).slice(0, 120),
    deviceType: String(b.deviceType || (isTablet ? "tablet" : isMobile ? "mobile" : "desktop")),
    os,
    osVersion: b.osVersion ? String(b.osVersion).slice(0, 40) : undefined,
    browser,
    browserVersion: b.browserVersion ? String(b.browserVersion).slice(0, 40) : undefined,
    userAgent: ua.slice(0, 500),
  };
}

let settingsCache: { at: number; value: DeviceSecuritySettings } | null = null;

export async function getDeviceSecuritySettings(): Promise<DeviceSecuritySettings> {
  if (settingsCache && Date.now() - settingsCache.at < 15_000) return settingsCache.value;
  const [row] = await db.select().from(deviceSecuritySettingsTable).where(eq(deviceSecuritySettingsTable.id, 1)).limit(1);
  if (!row) {
    try {
      await db.insert(deviceSecuritySettingsTable).values({ id: 1 });
    } catch {
      /* race */
    }
    const [created] = await db.select().from(deviceSecuritySettingsTable).where(eq(deviceSecuritySettingsTable.id, 1)).limit(1);
    const value = mapSettings(created!);
    settingsCache = { at: Date.now(), value };
    return value;
  }
  const value = mapSettings(row);
  settingsCache = { at: Date.now(), value };
  return value;
}

export function invalidateSettingsCache() {
  settingsCache = null;
}

function mapSettings(row: typeof deviceSecuritySettingsTable.$inferSelect): DeviceSecuritySettings {
  return {
    id: row.id,
    enforcementMode: (row.enforcementMode as EnforcementMode) || "selected",
    officeMaxDevices: row.officeMaxDevices ?? 2,
    pharmacyMaxDevices: row.pharmacyMaxDevices ?? 1,
    officeRequireApprove: row.officeRequireApprove ?? true,
    pharmacyRequireApprove: row.pharmacyRequireApprove ?? true,
    officeBlockForeign: row.officeBlockForeign ?? true,
    pharmacyBlockForeign: row.pharmacyBlockForeign ?? true,
    officeVerifyQr: row.officeVerifyQr ?? true,
    pharmacyVerifyQr: row.pharmacyVerifyQr ?? true,
    officeVerifyFace: row.officeVerifyFace ?? true,
    pharmacyVerifyFace: row.pharmacyVerifyFace ?? true,
    logIpChanges: row.logIpChanges ?? true,
    suspiciousNotify: row.suspiciousNotify ?? true,
  };
}

export function policyForGroup(settings: DeviceSecuritySettings, group: StaffGroup) {
  if (group === "pharmacy") {
    return {
      maxDevices: settings.pharmacyMaxDevices,
      requireApprove: settings.pharmacyRequireApprove,
      blockForeign: settings.pharmacyBlockForeign,
      verifyQr: settings.pharmacyVerifyQr,
      verifyFace: settings.pharmacyVerifyFace,
    };
  }
  return {
    maxDevices: settings.officeMaxDevices,
    requireApprove: settings.officeRequireApprove,
    blockForeign: settings.officeBlockForeign,
    verifyQr: settings.officeVerifyQr,
    verifyFace: settings.officeVerifyFace,
  };
}

export async function isDeviceSecurityEnforced(user: {
  id: number;
  role: string;
  deviceSecurityEnforced?: boolean | null;
}): Promise<boolean> {
  const settings = await getDeviceSecuritySettings();
  const mode = settings.enforcementMode;
  if (mode === "off") return false;
  if (mode === "all") return true;
  if (mode === "selected") return Boolean(user.deviceSecurityEnforced);
  const group = staffGroupForRole(user.role);
  if (mode === "office") return group === "office";
  if (mode === "pharmacy") return group === "pharmacy";
  return false;
}

export function readDeviceCookie(req: Request): { deviceId: string; token: string } | null {
  const raw = req.cookies?.[DEVICE_COOKIE];
  if (!raw || typeof raw !== "string") return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [deviceId, token] = parts;
  if (!deviceId || !token) return null;
  return { deviceId, token };
}

export function setDeviceCookie(res: Response, deviceId: string, token: string) {
  res.cookie(DEVICE_COOKIE, `${deviceId}.${token}`, {
    httpOnly: true,
    maxAge: 400 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
    secure: isProdEnv(),
    path: "/",
  });
}

export function clearDeviceCookie(res: Response) {
  res.clearCookie(DEVICE_COOKIE, { path: "/", sameSite: "lax", secure: isProdEnv() });
}

export function setSecureSessionCookie(res: Response, sessionToken: string) {
  res.cookie(SECURE_SESSION_COOKIE, `sec.${sessionToken}`, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
    secure: isProdEnv(),
    path: "/",
  });
}

export function parseSecureSessionCookie(raw?: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  if (raw.startsWith("sec.")) return raw.slice(4);
  return null;
}

export function isLegacySessionCookie(raw?: string): boolean {
  if (!raw) return false;
  if (raw.startsWith("sec.")) return false;
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64").toString());
    return Number.isFinite(decoded?.userId);
  } catch {
    return false;
  }
}

export async function writeLoginAudit(opts: {
  userId?: number | null;
  deviceRowId?: number | null;
  deviceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  action: string;
  status: string;
  failureReason?: string | null;
  meta?: Record<string, unknown>;
}) {
  try {
    await db.insert(loginAuditLogsTable).values({
      userId: opts.userId ?? null,
      deviceRowId: opts.deviceRowId ?? null,
      deviceId: opts.deviceId ?? null,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
      action: opts.action,
      status: opts.status,
      failureReason: opts.failureReason ?? null,
      meta: opts.meta ?? null,
    });
  } catch (err) {
    console.error("login_audit insert", err);
  }
}

export async function writeSecurityEvent(opts: {
  userId?: number | null;
  deviceRowId?: number | null;
  eventType: string;
  severity?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.insert(securityEventsTable).values({
      userId: opts.userId ?? null,
      deviceRowId: opts.deviceRowId ?? null,
      eventType: opts.eventType,
      severity: opts.severity || "medium",
      metadata: opts.metadata ?? null,
    });
  } catch (err) {
    console.error("security_event insert", err);
  }
}

export async function createServerSession(opts: {
  userId: number;
  deviceRowId: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  res: Response;
}) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(userSessionsTable).values({
    userId: opts.userId,
    deviceRowId: opts.deviceRowId,
    sessionTokenHash: sha256(token),
    expiresAt,
    ipAddress: opts.ipAddress ?? null,
    userAgent: opts.userAgent ?? null,
  });
  setSecureSessionCookie(opts.res, token);
  return token;
}

export async function revokeSessionsForUser(userId: number, deviceRowId?: number) {
  const now = new Date();
  if (deviceRowId != null) {
    await db
      .update(userSessionsTable)
      .set({ revokedAt: now })
      .where(
        and(
          eq(userSessionsTable.userId, userId),
          eq(userSessionsTable.deviceRowId, deviceRowId),
          isNull(userSessionsTable.revokedAt),
        ),
      );
  } else {
    await db
      .update(userSessionsTable)
      .set({ revokedAt: now })
      .where(and(eq(userSessionsTable.userId, userId), isNull(userSessionsTable.revokedAt)));
  }
}

export async function findDeviceByCred(userId: number, deviceId: string, token: string) {
  const [row] = await db
    .select()
    .from(userDevicesTable)
    .where(and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.deviceId, deviceId)))
    .limit(1);
  if (!row) return null;
  if (row.deviceTokenHash !== sha256(token)) return null;
  return row;
}

export async function countVerifiedDevices(userId: number): Promise<number> {
  const rows = await db
    .select({ id: userDevicesTable.id })
    .from(userDevicesTable)
    .where(
      and(
        eq(userDevicesTable.userId, userId),
        eq(userDevicesTable.isVerified, true),
        eq(userDevicesTable.isBlocked, false),
      ),
    );
  return rows.length;
}

export async function registerPendingDevice(opts: {
  userId: number;
  meta: DeviceMeta;
  ip: string;
  slot: string;
}): Promise<{ deviceId: string; token: string; rowId: number }> {
  const deviceId = randomToken(18);
  const token = randomToken(32);
  const [row] = await db
    .insert(userDevicesTable)
    .values({
      userId: opts.userId,
      deviceId,
      deviceTokenHash: sha256(token),
      deviceName: opts.meta.deviceName,
      deviceType: opts.meta.deviceType || "unknown",
      slot: opts.slot,
      os: opts.meta.os,
      osVersion: opts.meta.osVersion,
      browser: opts.meta.browser,
      browserVersion: opts.meta.browserVersion,
      userAgent: opts.meta.userAgent,
      ipAddress: opts.ip,
      lastIp: opts.ip,
      isPrimary: false,
      isVerified: false,
      isBlocked: false,
    })
    .returning({ id: userDevicesTable.id });
  return { deviceId, token, rowId: row!.id };
}

export async function approveDevice(deviceRowId: number, reviewedBy: number) {
  const [device] = await db.select().from(userDevicesTable).where(eq(userDevicesTable.id, deviceRowId)).limit(1);
  if (!device) return null;
  const settings = await getDeviceSecuritySettings();
  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, device.userId))
    .limit(1);
  if (!user) return null;
  const policy = policyForGroup(settings, staffGroupForRole(user.role));
  const verified = await db
    .select()
    .from(userDevicesTable)
    .where(
      and(
        eq(userDevicesTable.userId, user.id),
        eq(userDevicesTable.isVerified, true),
        eq(userDevicesTable.isBlocked, false),
      ),
    );

  // Agar limit to‘lgan bo‘lsa — eng eski primary emasini revoke
  if (verified.length >= policy.maxDevices) {
    const toRevoke = verified.filter((d) => d.id !== deviceRowId).sort((a, b) => a.id - b.id);
    while (toRevoke.length >= policy.maxDevices) {
      const old = toRevoke.shift()!;
      await db
        .update(userDevicesTable)
        .set({ isVerified: false, isPrimary: false, isBlocked: true, blockedAt: new Date(), blockedBy: reviewedBy })
        .where(eq(userDevicesTable.id, old.id));
      await revokeSessionsForUser(user.id, old.id);
    }
  }

  const hasPrimary = verified.some((d) => d.isPrimary && d.id !== deviceRowId);
  await db
    .update(userDevicesTable)
    .set({
      isVerified: true,
      isBlocked: false,
      blockedAt: null,
      blockedBy: null,
      isPrimary: !hasPrimary,
      lastSeenAt: new Date(),
      lastLoginAt: new Date(),
    })
    .where(eq(userDevicesTable.id, deviceRowId));

  await db
    .update(deviceChangeRequestsTable)
    .set({ status: "approved", reviewedAt: new Date(), reviewedBy })
    .where(
      and(
        eq(deviceChangeRequestsTable.newDeviceRowId, deviceRowId),
        eq(deviceChangeRequestsTable.status, "pending"),
      ),
    );

  return device;
}

export async function touchDevice(deviceRowId: number, ip?: string) {
  await db
    .update(userDevicesTable)
    .set({
      lastSeenAt: new Date(),
      ...(ip ? { lastIp: ip } : {}),
    })
    .where(eq(userDevicesTable.id, deviceRowId));
}

export async function touchSession(sessionId: number) {
  await db
    .update(userSessionsTable)
    .set({ lastActivityAt: new Date() })
    .where(eq(userSessionsTable.id, sessionId));
}

export type DeviceAuthContext = {
  enforced: boolean;
  deviceRowId?: number;
  sessionId?: number;
  deviceStatus?: "ok" | "pending" | "blocked" | "foreign";
};

export { usersTable, userDevicesTable, userSessionsTable, deviceChangeRequestsTable, securityEventsTable, loginAuditLogsTable, deviceSecuritySettingsTable };
