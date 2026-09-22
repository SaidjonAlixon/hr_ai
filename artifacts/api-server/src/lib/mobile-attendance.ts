/**
 * Ko‘chma davomat (MOBILE_GPS) — ruxsat tekshiruvi, GPS validation, suspicious jump.
 */
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  db,
  employeesTable,
  mobileAttendancePermissionsTable,
  mobileAttendanceSettingsTable,
  mobileAttendanceSessionsTable,
  securityEventsTable,
} from "@workspace/db";

/** YYYY-MM-DD — Asia/Tashkent */
function mobileTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

export type MobileSettings = {
  id: number;
  enabled: boolean;
  requireGps: boolean;
  requireActiveShift: boolean;
  routeTrackingDefault: boolean;
  gpsIntervalMin: number;
  maxAccuracyMeters: number;
  allowStartAnywhere: boolean;
  allowEndAnywhere: boolean;
  detectSuspicious: boolean;
  createSecurityEvents: boolean;
  retentionDays: number;
};

export type MobilePermission = typeof mobileAttendancePermissionsTable.$inferSelect;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Impossible travel: ~120 km/h max realistic road speed */
export function isImpossibleTravel(
  lat1: number,
  lon1: number,
  t1Ms: number,
  lat2: number,
  lon2: number,
  t2Ms: number,
  maxKmh = 120,
): { suspicious: boolean; distanceM: number; speedKmh: number } {
  const distanceM = haversineMeters(lat1, lon1, lat2, lon2);
  const dtH = Math.max((t2Ms - t1Ms) / 3_600_000, 1 / 3600);
  const speedKmh = distanceM / 1000 / dtH;
  return { suspicious: speedKmh > maxKmh && distanceM > 5000, distanceM, speedKmh };
}

export async function getMobileSettings(): Promise<MobileSettings> {
  const [row] = await db.select().from(mobileAttendanceSettingsTable).where(eq(mobileAttendanceSettingsTable.id, 1)).limit(1);
  if (row) {
    return {
      id: row.id,
      enabled: row.enabled,
      requireGps: row.requireGps,
      requireActiveShift: row.requireActiveShift,
      routeTrackingDefault: row.routeTrackingDefault,
      gpsIntervalMin: row.gpsIntervalMin,
      maxAccuracyMeters: row.maxAccuracyMeters,
      allowStartAnywhere: row.allowStartAnywhere,
      allowEndAnywhere: row.allowEndAnywhere,
      detectSuspicious: row.detectSuspicious,
      createSecurityEvents: row.createSecurityEvents,
      retentionDays: row.retentionDays,
    };
  }
  await db.insert(mobileAttendanceSettingsTable).values({ id: 1 });
  return {
    id: 1,
    enabled: true,
    requireGps: true,
    requireActiveShift: false,
    routeTrackingDefault: false,
    gpsIntervalMin: 10,
    maxAccuracyMeters: 50,
    allowStartAnywhere: true,
    allowEndAnywhere: true,
    detectSuspicious: true,
    createSecurityEvents: true,
    retentionDays: 90,
  };
}

function weekdayTashkent(ymd: string): number {
  // ISO: Mon=1 … Sun=7 — JS getUTCDay with Tashkent noon
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d, 7, 0, 0); // ~noon Tashkent (UTC+5)
  const js = new Date(utc).getUTCDay(); // 0=Sun
  return js === 0 ? 7 : js;
}

/** Ruxsat bugun amal qiladimi */
export function permissionCoversToday(
  p: MobilePermission,
  todayYmd: string = mobileTodayYmd(),
  shiftKey?: string | null,
): boolean {
  if (p.status !== "active") return false;
  const type = String(p.permissionType || "permanent");
  if (type === "permanent") return true;
  if (type === "temporary") {
    if (p.startDate && todayYmd < p.startDate) return false;
    if (p.endDate && todayYmd > p.endDate) return false;
    return true;
  }
  if (type === "weekdays") {
    const days = Array.isArray(p.weekdays) ? p.weekdays.map(Number) : [];
    if (!days.length) return false;
    return days.includes(weekdayTashkent(todayYmd));
  }
  if (type === "shift") {
    if (!p.shiftKey) return true;
    if (!shiftKey) return true;
    return String(p.shiftKey).toLowerCase() === String(shiftKey).toLowerCase();
  }
  // fallback temporary window if dates set
  if (p.startDate || p.endDate) {
    if (p.startDate && todayYmd < p.startDate) return false;
    if (p.endDate && todayYmd > p.endDate) return false;
  }
  return true;
}

export async function findActivePermissionForEmployee(
  employeeId: number,
  opts?: { shiftKey?: string | null; todayYmd?: string; userId?: number | null },
): Promise<MobilePermission | null> {
  const today = opts?.todayYmd || mobileTodayYmd();
  const rows = await db
    .select()
    .from(mobileAttendancePermissionsTable)
    .where(
      and(
        eq(mobileAttendancePermissionsTable.employeeId, employeeId),
        eq(mobileAttendancePermissionsTable.status, "active"),
      ),
    )
    .orderBy(desc(mobileAttendancePermissionsTable.id));
  for (const p of rows) {
    if (permissionCoversToday(p, today, opts?.shiftKey)) return p;
  }
  // Fallback: ruxsat user_id bo‘yicha (employee kartasi almashtirilgan bo‘lsa)
  const uid = opts?.userId != null ? Number(opts.userId) : NaN;
  if (Number.isFinite(uid) && uid > 0) {
    const byUser = await db
      .select()
      .from(mobileAttendancePermissionsTable)
      .where(
        and(
          eq(mobileAttendancePermissionsTable.userId, uid),
          eq(mobileAttendancePermissionsTable.status, "active"),
        ),
      )
      .orderBy(desc(mobileAttendancePermissionsTable.id));
    for (const p of byUser) {
      if (permissionCoversToday(p, today, opts?.shiftKey)) return p;
    }
  }
  return null;
}

/**
 * Admin bergan ko‘chma ruxsat — Face ID / Ofis QR / filial geofence dan mustaqil,
 * istalgan joydan davomat.
 */
export async function employeeHasMobileAnywhere(
  employeeId: number,
  userId?: number | null,
): Promise<boolean> {
  const perm = await findActivePermissionForEmployee(employeeId, { userId: userId ?? null });
  return Boolean(perm);
}

export async function findEmployeeForUser(userId: number) {
  const [emp] = await db
    .select({
      id: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      location: employeesTable.location,
      orgRole: employeesTable.orgRole,
      employmentStatus: employeesTable.employmentStatus,
    })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);
  return emp ?? null;
}

export function validateGpsInput(opts: {
  latitude?: unknown;
  longitude?: unknown;
  accuracy?: unknown;
  maxAccuracy: number;
}):
  | { ok: true; lat: number; lng: number; accuracy: number | null; accuracyWarn: boolean }
  | { ok: false; code: string; error: string } {
  const lat = Number(opts.latitude);
  const lng = Number(opts.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, code: "gps_unavailable", error: "Lokatsiyani aniqlab bo‘lmadi." };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, code: "gps_invalid", error: "GPS koordinata noto‘g‘ri." };
  }
  const accuracy =
    opts.accuracy == null || opts.accuracy === ""
      ? null
      : Number(opts.accuracy);
  const accuracyWarn =
    accuracy != null && Number.isFinite(accuracy) && accuracy > opts.maxAccuracy;
  return { ok: true, lat, lng, accuracy: Number.isFinite(accuracy as number) ? (accuracy as number) : null, accuracyWarn };
}

export async function recordSecurityEvent(opts: {
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
    console.warn("mobile attendance security event failed", err);
  }
}

export async function dashboardKpis() {
  const today = mobileTodayYmd();
  const settings = await getMobileSettings();
  const [permCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mobileAttendancePermissionsTable)
    .where(eq(mobileAttendancePermissionsTable.status, "active"));
  const [openToday] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mobileAttendanceSessionsTable)
    .where(
      and(
        eq(mobileAttendanceSessionsTable.workDate, today),
        eq(mobileAttendanceSessionsTable.status, "open"),
      ),
    );
  const [startedToday] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mobileAttendanceSessionsTable)
    .where(eq(mobileAttendanceSessionsTable.workDate, today));
  const [closedToday] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mobileAttendanceSessionsTable)
    .where(
      and(
        eq(mobileAttendanceSessionsTable.workDate, today),
        eq(mobileAttendanceSessionsTable.status, "closed"),
      ),
    );
  const [suspiciousToday] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mobileAttendanceSessionsTable)
    .where(
      and(
        eq(mobileAttendanceSessionsTable.workDate, today),
        eq(mobileAttendanceSessionsTable.securityStatus, "suspicious"),
      ),
    );
  const [secEvents] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(securityEventsTable)
    .where(
      and(
        gte(securityEventsTable.createdAt, new Date(`${today}T00:00:00+05:00`)),
        lte(securityEventsTable.createdAt, new Date(`${today}T23:59:59+05:00`)),
        sql`${securityEventsTable.eventType} LIKE 'mobile_%'`,
      ),
    );

  return {
    settingsEnabled: settings.enabled,
    totalPermissions: Number(permCount?.n ?? 0),
    activeOpenToday: Number(openToday?.n ?? 0),
    startedToday: Number(startedToday?.n ?? 0),
    closedToday: Number(closedToday?.n ?? 0),
    workingNow: Number(openToday?.n ?? 0),
    suspiciousToday: Number(suspiciousToday?.n ?? 0),
    securityEventsToday: Number(secEvents?.n ?? 0),
    today,
  };
}

export { mobileTodayYmd };

