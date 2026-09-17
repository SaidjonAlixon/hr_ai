/**
 * Ko‘chma davomat API — faqat admin ruxsat boshqaruvi; xodim start/end/track.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import {
  db,
  employeesTable,
  usersTable,
  attendanceRecordsTable,
  mobileAttendancePermissionsTable,
  mobileAttendanceSettingsTable,
  mobileAttendanceSessionsTable,
  mobileLocationPointsTable,
  mobileAttendanceAuditLogsTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { canManageUsers } from "../lib/roles";
import { clientIp, findDeviceByCred, readDeviceCookie } from "../lib/device-security";
import {
  dashboardKpis,
  findActivePermissionForEmployee,
  findEmployeeForUser,
  getMobileSettings,
  isImpossibleTravel,
  mobileTodayYmd,
  permissionCoversToday,
  recordSecurityEvent,
  validateGpsInput,
} from "../lib/mobile-attendance";
import { formatPersonName } from "../lib/person-name";
import { normalizePersonName } from "../lib/dedupe-employees";

const router: IRouter = Router();

function requireAdmin(req: AuthRequest, res: { status: (n: number) => { json: (b: unknown) => void } }): boolean {
  if (!canManageUsers(req.userRole)) {
    res.status(403).json({ error: "Faqat admin", code: "ADMIN_ONLY" });
    return false;
  }
  return true;
}

async function writeAudit(opts: {
  sessionId?: number | null;
  employeeId?: number | null;
  actorId?: number | null;
  action: string;
  metadata?: Record<string, unknown>;
  req: AuthRequest;
}) {
  try {
    await db.insert(mobileAttendanceAuditLogsTable).values({
      sessionId: opts.sessionId ?? null,
      employeeId: opts.employeeId ?? null,
      actorId: opts.actorId ?? null,
      action: opts.action,
      metadata: opts.metadata ?? null,
      ipAddress: clientIp(opts.req),
      userAgent: String(opts.req.headers["user-agent"] || "").slice(0, 400),
    });
  } catch (err) {
    console.warn("mobile audit failed", err);
  }
}

async function resolveDevice(req: AuthRequest) {
  const cred = readDeviceCookie(req);
  if (!cred || !req.userId) return { deviceRowId: null as number | null, deviceId: null as string | null };
  const device = await findDeviceByCred(req.userId, cred.deviceId, cred.token);
  if (!device || device.isBlocked) {
    return { deviceRowId: null, deviceId: cred.deviceId, blocked: Boolean(device?.isBlocked) };
  }
  return { deviceRowId: device.id, deviceId: device.deviceId, blocked: false, verified: device.isVerified };
}

/** GET /mobile-attendance/settings */
router.get("/mobile-attendance/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json({ settings: await getMobileSettings() });
  } catch (err) {
    console.error("GET mobile settings", err);
    res.status(503).json({ error: "Sozlamalar yuklanmadi" });
  }
});

/** PUT /mobile-attendance/settings */
router.put("/mobile-attendance/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const b = req.body || {};
    const patch: Record<string, unknown> = { updatedById: req.userId, updatedAt: new Date() };
    const boolKeys = [
      "enabled",
      "requireGps",
      "requireActiveShift",
      "routeTrackingDefault",
      "allowStartAnywhere",
      "allowEndAnywhere",
      "detectSuspicious",
      "createSecurityEvents",
    ] as const;
    for (const k of boolKeys) {
      if (typeof b[k] === "boolean") patch[k] = b[k];
    }
    if (b.gpsIntervalMin != null) {
      const n = Number(b.gpsIntervalMin);
      if ([1, 5, 10, 15, 30].includes(n)) patch.gpsIntervalMin = n;
    }
    if (b.maxAccuracyMeters != null) {
      const n = Number(b.maxAccuracyMeters);
      if ([10, 25, 50, 100].includes(n)) patch.maxAccuracyMeters = n;
    }
    if (b.retentionDays != null) {
      const n = Number(b.retentionDays);
      if ([30, 90, 180, 365].includes(n)) patch.retentionDays = n;
    }
    await db
      .update(mobileAttendanceSettingsTable)
      .set(patch)
      .where(eq(mobileAttendanceSettingsTable.id, 1));
    await writeAudit({
      actorId: req.userId,
      action: "MOBILE_SETTINGS_UPDATED",
      metadata: patch,
      req,
    });
    res.json({ ok: true, settings: await getMobileSettings() });
  } catch (err) {
    console.error("PUT mobile settings", err);
    res.status(503).json({ error: "Saqlanmadi" });
  }
});

/** GET /mobile-attendance/dashboard */
router.get("/mobile-attendance/dashboard", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    res.json(await dashboardKpis());
  } catch (err) {
    console.error("GET mobile dashboard", err);
    res.status(503).json({ error: "Dashboard yuklanmadi" });
  }
});

/** GET /mobile-attendance/permissions */
router.get("/mobile-attendance/permissions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const status = String((req.query as { status?: string }).status || "active");
    const baseQuery = db
      .select({
        id: mobileAttendancePermissionsTable.id,
        employeeId: mobileAttendancePermissionsTable.employeeId,
        userId: mobileAttendancePermissionsTable.userId,
        status: mobileAttendancePermissionsTable.status,
        permissionType: mobileAttendancePermissionsTable.permissionType,
        startDate: mobileAttendancePermissionsTable.startDate,
        endDate: mobileAttendancePermissionsTable.endDate,
        weekdays: mobileAttendancePermissionsTable.weekdays,
        shiftKey: mobileAttendancePermissionsTable.shiftKey,
        note: mobileAttendancePermissionsTable.note,
        routeTrackingEnabled: mobileAttendancePermissionsTable.routeTrackingEnabled,
        maxAccuracyMeters: mobileAttendancePermissionsTable.maxAccuracyMeters,
        gpsIntervalMin: mobileAttendancePermissionsTable.gpsIntervalMin,
        createdAt: mobileAttendancePermissionsTable.createdAt,
        revokedAt: mobileAttendancePermissionsTable.revokedAt,
        fullName: employeesTable.fullName,
        position: employeesTable.position,
        location: employeesTable.location,
      })
      .from(mobileAttendancePermissionsTable)
      .leftJoin(employeesTable, eq(employeesTable.id, mobileAttendancePermissionsTable.employeeId));

    const rows =
      status === "all"
        ? await baseQuery.orderBy(desc(mobileAttendancePermissionsTable.id)).limit(500)
        : await baseQuery
            .where(eq(mobileAttendancePermissionsTable.status, status))
            .orderBy(desc(mobileAttendancePermissionsTable.id))
            .limit(500);

    const today = mobileTodayYmd();
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const sessions =
      empIds.length > 0
        ? await db
            .select()
            .from(mobileAttendanceSessionsTable)
            .where(
              and(
                inArray(mobileAttendanceSessionsTable.employeeId, empIds),
                eq(mobileAttendanceSessionsTable.workDate, today),
              ),
            )
        : [];
    const sessByEmp = new Map<number, (typeof sessions)[0]>();
    for (const s of sessions) {
      const prev = sessByEmp.get(s.employeeId);
      if (!prev || s.id > prev.id) sessByEmp.set(s.employeeId, s);
    }

    res.json({
      today,
      permissions: rows.map((r) => {
        const s = sessByEmp.get(r.employeeId);
        return {
          ...r,
          fullName: formatPersonName(r.fullName) || r.fullName,
          coversToday: r.status === "active" && permissionCoversToday(r as never, today),
          todaySession: s
            ? {
                id: s.id,
                status: s.status,
                securityStatus: s.securityStatus,
                startTime: s.startTime?.toISOString() ?? null,
                endTime: s.endTime?.toISOString() ?? null,
                startLatitude: s.startLatitude,
                startLongitude: s.startLongitude,
                endLatitude: s.endLatitude,
                endLongitude: s.endLongitude,
              }
            : null,
        };
      }),
    });
  } catch (err) {
    console.error("GET mobile permissions", err);
    res.status(503).json({ error: "Ruxsatlar yuklanmadi" });
  }
});

/** POST /mobile-attendance/permissions — grant (single or mass) */
router.post("/mobile-attendance/permissions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const b = req.body || {};
    const employeeIds: number[] = Array.isArray(b.employeeIds)
      ? b.employeeIds.map(Number).filter((n: number) => Number.isFinite(n))
      : b.employeeId != null
        ? [Number(b.employeeId)]
        : [];
    if (!employeeIds.length) {
      res.status(400).json({ error: "Xodim tanlang" });
      return;
    }
    const permissionType = String(b.permissionType || "permanent");
    if (!["permanent", "temporary", "weekdays", "shift"].includes(permissionType)) {
      res.status(400).json({ error: "Noto‘g‘ri ruxsat turi" });
      return;
    }
    const emps = await db
      .select({
        id: employeesTable.id,
        userId: employeesTable.userId,
        fullName: employeesTable.fullName,
      })
      .from(employeesTable)
      .where(inArray(employeesTable.id, employeeIds));
    if (!emps.length) {
      res.status(404).json({ error: "Xodim topilmadi" });
      return;
    }
    const settings = await getMobileSettings();
    const created: number[] = [];
    for (const emp of emps) {
      // eski active ni revoke (bitta aktiv ruxsat)
      await db
        .update(mobileAttendancePermissionsTable)
        .set({
          status: "revoked",
          revokedAt: new Date(),
          revokedById: req.userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mobileAttendancePermissionsTable.employeeId, emp.id),
            eq(mobileAttendancePermissionsTable.status, "active"),
          ),
        );
      const [row] = await db
        .insert(mobileAttendancePermissionsTable)
        .values({
          employeeId: emp.id,
          userId: emp.userId,
          grantedById: req.userId!,
          status: "active",
          permissionType,
          startDate: b.startDate || null,
          endDate: b.endDate || null,
          weekdays: Array.isArray(b.weekdays) ? b.weekdays.map(Number) : null,
          shiftKey: b.shiftKey || null,
          note: b.note ? String(b.note).slice(0, 500) : null,
          allowAnywhere: b.allowAnywhere !== false,
          allowStartAnywhere: b.allowStartAnywhere !== false,
          allowEndAnywhere: b.allowEndAnywhere !== false,
          routeTrackingEnabled:
            typeof b.routeTrackingEnabled === "boolean"
              ? b.routeTrackingEnabled
              : settings.routeTrackingDefault,
          gpsIntervalMin:
            b.gpsIntervalMin != null ? Number(b.gpsIntervalMin) : settings.gpsIntervalMin,
          maxAccuracyMeters:
            b.maxAccuracyMeters != null ? Number(b.maxAccuracyMeters) : settings.maxAccuracyMeters,
        })
        .returning({ id: mobileAttendancePermissionsTable.id });
      if (row) created.push(row.id);
      await writeAudit({
        employeeId: emp.id,
        actorId: req.userId,
        action: "MOBILE_ATTENDANCE_PERMISSION_GRANTED",
        metadata: {
          permissionId: row?.id,
          permissionType,
          routeTracking: b.routeTrackingEnabled,
          fullName: emp.fullName,
        },
        req,
      });
    }
    res.json({ ok: true, createdIds: created, count: created.length });
  } catch (err) {
    console.error("POST mobile permissions", err);
    res.status(503).json({ error: "Ruxsat berilmadi" });
  }
});

/** POST /mobile-attendance/permissions/:id/revoke */
router.post(
  "/mobile-attendance/permissions/:id/revoke",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      const id = Number(req.params.id);
      const [row] = await db
        .select()
        .from(mobileAttendancePermissionsTable)
        .where(eq(mobileAttendancePermissionsTable.id, id))
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "Topilmadi" });
        return;
      }
      await db
        .update(mobileAttendancePermissionsTable)
        .set({
          status: "revoked",
          revokedAt: new Date(),
          revokedById: req.userId,
          updatedAt: new Date(),
        })
        .where(eq(mobileAttendancePermissionsTable.id, id));
      await writeAudit({
        employeeId: row.employeeId,
        actorId: req.userId,
        action: "MOBILE_ATTENDANCE_PERMISSION_REVOKED",
        metadata: { permissionId: id },
        req,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("revoke mobile permission", err);
      res.status(503).json({ error: "Bekor qilinmadi" });
    }
  },
);

/** PATCH /mobile-attendance/permissions/:id */
router.patch(
  "/mobile-attendance/permissions/:id",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!requireAdmin(req, res)) return;
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof b.routeTrackingEnabled === "boolean") patch.routeTrackingEnabled = b.routeTrackingEnabled;
      if (b.gpsIntervalMin != null) patch.gpsIntervalMin = Number(b.gpsIntervalMin);
      if (b.maxAccuracyMeters != null) patch.maxAccuracyMeters = Number(b.maxAccuracyMeters);
      if (b.note !== undefined) patch.note = b.note ? String(b.note).slice(0, 500) : null;
      if (b.permissionType) patch.permissionType = String(b.permissionType);
      if (b.startDate !== undefined) patch.startDate = b.startDate || null;
      if (b.endDate !== undefined) patch.endDate = b.endDate || null;
      if (b.weekdays !== undefined) patch.weekdays = Array.isArray(b.weekdays) ? b.weekdays : null;
      if (b.shiftKey !== undefined) patch.shiftKey = b.shiftKey || null;
      await db
        .update(mobileAttendancePermissionsTable)
        .set(patch)
        .where(eq(mobileAttendancePermissionsTable.id, id));
      res.json({ ok: true });
    } catch (err) {
      console.error("PATCH mobile permission", err);
      res.status(503).json({ error: "Yangilanmadi" });
    }
  },
);

/** GET /mobile-attendance/live — bugungi kuzatuv (online/offline) */
router.get("/mobile-attendance/live", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const today = mobileTodayYmd();
    const qEmp = Number((req.query as { employeeId?: string }).employeeId);
    const ONLINE_MS = 90_000;

    const conditions = [
      eq(mobileAttendanceSessionsTable.status, "open"),
      eq(mobileAttendanceSessionsTable.workDate, today),
    ];
    if (Number.isFinite(qEmp) && qEmp > 0) {
      conditions.push(eq(mobileAttendanceSessionsTable.employeeId, qEmp));
    }

    const rows = await db
      .select({
        session: mobileAttendanceSessionsTable,
        fullName: employeesTable.fullName,
        position: employeesTable.position,
        location: employeesTable.location,
      })
      .from(mobileAttendanceSessionsTable)
      .leftJoin(employeesTable, eq(employeesTable.id, mobileAttendanceSessionsTable.employeeId))
      .where(and(...conditions))
      .orderBy(desc(mobileAttendanceSessionsTable.startTime))
      .limit(100);

    const live = [];
    const seenEmp = new Set<number>();
    for (const { session: s, fullName, position, location } of rows) {
      seenEmp.add(s.employeeId);
      const [lastPt] = await db
        .select()
        .from(mobileLocationPointsTable)
        .where(eq(mobileLocationPointsTable.sessionId, s.id))
        .orderBy(desc(mobileLocationPointsTable.sequenceNumber))
        .limit(1);

      const lat = lastPt?.latitude ?? s.startLatitude;
      const lng = lastPt?.longitude ?? s.startLongitude;
      const recordedAt = lastPt?.recordedAt ?? s.startTime;
      const liveAtMs = recordedAt ? new Date(recordedAt).getTime() : 0;
      const presence =
        liveAtMs > 0 && Date.now() - liveAtMs <= ONLINE_MS ? "online" : "offline";

      const pointCount = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(mobileLocationPointsTable)
        .where(eq(mobileLocationPointsTable.sessionId, s.id));

      live.push({
        sessionId: s.id,
        employeeId: s.employeeId,
        userId: s.userId,
        fullName: formatPersonName(fullName) || fullName,
        position,
        location,
        status: s.status,
        presence,
        securityStatus: s.securityStatus,
        routeTrackingEnabled: s.routeTrackingEnabled,
        startTime: s.startTime?.toISOString() ?? null,
        startLatitude: s.startLatitude,
        startLongitude: s.startLongitude,
        liveLatitude: lat,
        liveLongitude: lng,
        liveAccuracy: lastPt?.accuracy ?? s.startAccuracy,
        liveAt: recordedAt?.toISOString?.() ?? (recordedAt ? new Date(recordedAt).toISOString() : null),
        pointCount: Number(pointCount[0]?.n ?? 0),
        durationMin: s.startTime
          ? Math.round((Date.now() - s.startTime.getTime()) / 60_000)
          : 0,
      });
    }

    // Ruxsat bor, lekin hali lokatsiya bermagan — offline ro‘yxatda
    const perms = await db
      .select({
        perm: mobileAttendancePermissionsTable,
        fullName: employeesTable.fullName,
        position: employeesTable.position,
        location: employeesTable.location,
      })
      .from(mobileAttendancePermissionsTable)
      .leftJoin(employeesTable, eq(employeesTable.id, mobileAttendancePermissionsTable.employeeId))
      .where(eq(mobileAttendancePermissionsTable.status, "active"))
      .limit(400);

    for (const { perm: p, fullName, position, location } of perms) {
      if (!p.employeeId || seenEmp.has(p.employeeId)) continue;
      if (Number.isFinite(qEmp) && qEmp > 0 && p.employeeId !== qEmp) continue;
      if (!permissionCoversToday(p, today)) continue;
      live.push({
        sessionId: null,
        employeeId: p.employeeId,
        userId: p.userId,
        fullName: formatPersonName(fullName) || fullName,
        position,
        location,
        status: "waiting",
        presence: "offline",
        securityStatus: "ok",
        routeTrackingEnabled: true,
        startTime: null,
        startLatitude: null,
        startLongitude: null,
        liveLatitude: null,
        liveLongitude: null,
        liveAccuracy: null,
        liveAt: null,
        pointCount: 0,
        durationMin: 0,
      });
    }

    live.sort((a, b) => {
      if (a.presence !== b.presence) return a.presence === "online" ? -1 : 1;
      return String(a.fullName || "").localeCompare(String(b.fullName || ""), "uz");
    });

    const onlineCount = live.filter((l) => l.presence === "online").length;
    res.json({
      today,
      count: live.length,
      onlineCount,
      live,
      polledAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("GET mobile live", err);
    res.status(503).json({ error: "Live yuklanmadi" });
  }
});

/** GET /mobile-attendance/sessions — admin history */
router.get("/mobile-attendance/sessions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const q = req.query as Record<string, string>;
    const from = q.from || mobileTodayYmd();
    const to = q.to || from;
    const conditions = [
      gte(mobileAttendanceSessionsTable.workDate, from),
      lte(mobileAttendanceSessionsTable.workDate, to),
    ];
    if (q.employeeId) {
      const eid = Number(q.employeeId);
      const [emp] = await db
        .select({ id: employeesTable.id, userId: employeesTable.userId })
        .from(employeesTable)
        .where(eq(employeesTable.id, eid))
        .limit(1);
      if (emp?.userId) {
        const twins = await db
          .select({ id: employeesTable.id })
          .from(employeesTable)
          .where(eq(employeesTable.userId, emp.userId));
        const ids = twins.map((t) => t.id);
        if (ids.length > 1) conditions.push(inArray(mobileAttendanceSessionsTable.employeeId, ids));
        else conditions.push(eq(mobileAttendanceSessionsTable.employeeId, eid));
      } else {
        conditions.push(eq(mobileAttendanceSessionsTable.employeeId, eid));
      }
    }
    if (q.status) conditions.push(eq(mobileAttendanceSessionsTable.status, q.status));

    const rows = await db
      .select({
        session: mobileAttendanceSessionsTable,
        fullName: employeesTable.fullName,
        position: employeesTable.position,
        location: employeesTable.location,
      })
      .from(mobileAttendanceSessionsTable)
      .leftJoin(employeesTable, eq(employeesTable.id, mobileAttendanceSessionsTable.employeeId))
      .where(and(...conditions))
      .orderBy(desc(mobileAttendanceSessionsTable.startTime))
      .limit(500);

    res.json({
      from,
      to,
      sessions: rows.map(({ session: s, fullName, position, location }) => ({
        ...s,
        fullName: formatPersonName(fullName) || fullName,
        position,
        location,
        startTime: s.startTime?.toISOString() ?? null,
        endTime: s.endTime?.toISOString() ?? null,
        durationMin:
          s.startTime && s.endTime
            ? Math.round((s.endTime.getTime() - s.startTime.getTime()) / 60_000)
            : null,
      })),
    });
  } catch (err) {
    console.error("GET mobile sessions", err);
    res.status(503).json({ error: "Tarix yuklanmadi" });
  }
});

/** GET /mobile-attendance/sessions/:id — detail + points */
router.get(
  "/mobile-attendance/sessions/:id",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const id = Number(req.params.id);
      const [s] = await db
        .select()
        .from(mobileAttendanceSessionsTable)
        .where(eq(mobileAttendanceSessionsTable.id, id))
        .limit(1);
      if (!s) {
        res.status(404).json({ error: "Topilmadi" });
        return;
      }
      const isAdmin = canManageUsers(req.userRole);
      if (!isAdmin) {
        const emp = await findEmployeeForUser(req.userId!);
        if (!emp || emp.id !== s.employeeId) {
          res.status(403).json({ error: "Ruxsat yo‘q" });
          return;
        }
      }
      const [emp] = await db
        .select({
          fullName: employeesTable.fullName,
          position: employeesTable.position,
          location: employeesTable.location,
        })
        .from(employeesTable)
        .where(eq(employeesTable.id, s.employeeId))
        .limit(1);
      const points = await db
        .select()
        .from(mobileLocationPointsTable)
        .where(eq(mobileLocationPointsTable.sessionId, id))
        .orderBy(mobileLocationPointsTable.sequenceNumber);

      res.json({
        session: {
          ...s,
          startTime: s.startTime?.toISOString() ?? null,
          endTime: s.endTime?.toISOString() ?? null,
          fullName: formatPersonName(emp?.fullName) || emp?.fullName,
          position: emp?.position,
          location: emp?.location,
        },
        points: points.map((p) => ({
          id: p.id,
          latitude: p.latitude,
          longitude: p.longitude,
          accuracy: p.accuracy,
          recordedAt: p.recordedAt?.toISOString() ?? null,
          sequenceNumber: p.sequenceNumber,
          pointType: p.pointType,
        })),
      });
    } catch (err) {
      console.error("GET mobile session detail", err);
      res.status(503).json({ error: "Yuklanmadi" });
    }
  },
);

/** GET /mobile-attendance/me — xodim holati */
router.get("/mobile-attendance/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const settings = await getMobileSettings();
    const emp = await findEmployeeForUser(req.userId!);
    if (!emp) {
      res.json({ allowed: false, reason: "employee_missing", settings: { enabled: settings.enabled } });
      return;
    }
    if (!settings.enabled) {
      res.json({ allowed: false, reason: "globally_disabled", employee: emp });
      return;
    }
    const perm = await findActivePermissionForEmployee(emp.id);
    if (!perm) {
      res.json({ allowed: false, reason: "no_permission", employee: emp });
      return;
    }
    const today = mobileTodayYmd();
    const [open] = await db
      .select()
      .from(mobileAttendanceSessionsTable)
      .where(
        and(
          eq(mobileAttendanceSessionsTable.employeeId, emp.id),
          eq(mobileAttendanceSessionsTable.workDate, today),
          eq(mobileAttendanceSessionsTable.status, "open"),
        ),
      )
      .orderBy(desc(mobileAttendanceSessionsTable.id))
      .limit(1);

    res.json({
      allowed: true,
      employee: {
        id: emp.id,
        fullName: formatPersonName(emp.fullName) || emp.fullName,
        position: emp.position,
        location: emp.location,
      },
      permission: {
        id: perm.id,
        permissionType: perm.permissionType,
        startDate: perm.startDate,
        endDate: perm.endDate,
        weekdays: perm.weekdays,
        shiftKey: perm.shiftKey,
        note: perm.note,
        routeTrackingEnabled: perm.routeTrackingEnabled,
        gpsIntervalMin: perm.gpsIntervalMin ?? settings.gpsIntervalMin,
        maxAccuracyMeters: perm.maxAccuracyMeters ?? settings.maxAccuracyMeters,
      },
      settings: {
        enabled: settings.enabled,
        maxAccuracyMeters: perm.maxAccuracyMeters ?? settings.maxAccuracyMeters,
        gpsIntervalMin: perm.gpsIntervalMin ?? settings.gpsIntervalMin,
        routeTracking: perm.routeTrackingEnabled,
      },
      openSession: open
        ? {
            id: open.id,
            startTime: open.startTime?.toISOString() ?? null,
            startLatitude: open.startLatitude,
            startLongitude: open.startLongitude,
            startAccuracy: open.startAccuracy,
            routeTrackingEnabled: open.routeTrackingEnabled,
            securityStatus: open.securityStatus,
          }
        : null,
      privacyNote:
        "Lokatsiyangiz faqat ko‘chma davomat boshlanishi/yakuni" +
        (perm.routeTrackingEnabled ? " va yo‘nalish qaydi (sahifa ochiq bo‘lganda)" : "") +
        " uchun qayd etiladi.",
    });
  } catch (err) {
    console.error("GET mobile me", err);
    res.status(503).json({ error: "Holat yuklanmadi" });
  }
});

/** POST /mobile-attendance/start */
router.post("/mobile-attendance/start", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const settings = await getMobileSettings();
    if (!settings.enabled) {
      res.status(403).json({ error: "Ko‘chma davomat o‘chirilgan", code: "MOBILE_DISABLED" });
      return;
    }
    const emp = await findEmployeeForUser(req.userId!);
    if (!emp) {
      res.status(403).json({ error: "Xodim kartasi yo‘q", code: "MOBILE_ATTENDANCE_NOT_ALLOWED" });
      return;
    }
    const st = String(emp.employmentStatus || "").toLowerCase();
    if (st === "dismissed" || st === "closed") {
      res.status(403).json({ error: "Xodim faol emas", code: "MOBILE_ATTENDANCE_NOT_ALLOWED" });
      return;
    }
    const perm = await findActivePermissionForEmployee(emp.id);
    if (!perm) {
      res.status(403).json({
        error: "Ko‘chma davomat ruxsati yo‘q",
        code: "MOBILE_ATTENDANCE_NOT_ALLOWED",
      });
      return;
    }

    const device = await resolveDevice(req);
    if (device.blocked) {
      res.status(403).json({ error: "Qurilma bloklangan", code: "DEVICE_BLOCKED" });
      return;
    }
    // Device security yoqilgan bo‘lsa requireAuth allaqachon tekshiradi;
    // qo‘shimcha: device cookie bo‘lmasa ogohlantirish
    if (!device.deviceRowId && req.deviceEnforced) {
      res.status(403).json({
        error: "Ro‘yxatdan o‘tgan qurilma talab qilinadi",
        code: "DEVICE_REQUIRED",
      });
      return;
    }

    const maxAcc = perm.maxAccuracyMeters ?? settings.maxAccuracyMeters;
    const gps = validateGpsInput({
      latitude: req.body?.latitude,
      longitude: req.body?.longitude,
      accuracy: req.body?.accuracy,
      maxAccuracy: maxAcc,
    });
    if (!gps.ok) {
      res.status(400).json({ error: gps.error, code: gps.code });
      return;
    }
    if (gps.accuracyWarn && settings.requireGps) {
      res.status(400).json({
        error: `Joylashuv aniqligi past (${Math.round(gps.accuracy || 0)} m). Maksimal ${maxAcc} m.`,
        code: "GPS_ACCURACY_LOW",
        accuracy: gps.accuracy,
        maxAccuracy: maxAcc,
      });
      return;
    }

    const today = mobileTodayYmd();
    const [existingOpen] = await db
      .select()
      .from(mobileAttendanceSessionsTable)
      .where(
        and(
          eq(mobileAttendanceSessionsTable.employeeId, emp.id),
          eq(mobileAttendanceSessionsTable.workDate, today),
          eq(mobileAttendanceSessionsTable.status, "open"),
        ),
      )
      .limit(1);
    if (existingOpen) {
      res.status(400).json({
        error: "Bugun allaqachon ochiq ko‘chma davomat bor",
        code: "ALREADY_OPEN",
        sessionId: existingOpen.id,
      });
      return;
    }

    const now = new Date();
    const locTs =
      req.body?.locationTimestamp != null
        ? new Date(Number(req.body.locationTimestamp) || req.body.locationTimestamp)
        : now;

    const [session] = await db
      .insert(mobileAttendanceSessionsTable)
      .values({
        employeeId: emp.id,
        userId: emp.userId,
        permissionId: perm.id,
        workDate: today,
        shiftKey: perm.shiftKey,
        status: "open",
        securityStatus: "ok",
        deviceRowId: device.deviceRowId,
        deviceId: device.deviceId,
        ipAddress: clientIp(req),
        userAgent: String(req.headers["user-agent"] || "").slice(0, 400),
        startTime: now,
        startLatitude: gps.lat,
        startLongitude: gps.lng,
        startAccuracy: gps.accuracy,
        startLocationTs: locTs,
        routeTrackingEnabled: Boolean(perm.routeTrackingEnabled),
      })
      .returning();

    await db.insert(mobileLocationPointsTable).values({
      sessionId: session!.id,
      latitude: gps.lat,
      longitude: gps.lng,
      accuracy: gps.accuracy,
      recordedAt: locTs,
      sequenceNumber: 0,
      pointType: "start",
    });

    // Asosiy attendance yozuvi — MOBILE_GPS (geofence yo‘q)
    try {
      const [rec] = await db
        .select()
        .from(attendanceRecordsTable)
        .where(
          and(
            eq(attendanceRecordsTable.employeeId, emp.id),
            eq(attendanceRecordsTable.workDate, today),
          ),
        )
        .limit(1);
      if (!rec) {
        const [ins] = await db
          .insert(attendanceRecordsTable)
          .values({
            employeeId: emp.id,
            userId: emp.userId,
            workDate: today,
            checkInAt: now,
            status: "incomplete",
            source: "mobile_gps",
            checkLatitude: gps.lat,
            checkLongitude: gps.lng,
            checkInMethod: "MOBILE_GPS",
            createdById: emp.userId,
          })
          .returning({ id: attendanceRecordsTable.id });
        if (ins) {
          await db
            .update(mobileAttendanceSessionsTable)
            .set({ attendanceRecordId: ins.id })
            .where(eq(mobileAttendanceSessionsTable.id, session!.id));
        }
      } else if (!rec.checkInAt) {
        await db
          .update(attendanceRecordsTable)
          .set({
            checkInAt: now,
            status: "incomplete",
            source: "mobile_gps",
            checkLatitude: gps.lat,
            checkLongitude: gps.lng,
            checkInMethod: "MOBILE_GPS",
            updatedAt: now,
          })
          .where(eq(attendanceRecordsTable.id, rec.id));
        await db
          .update(mobileAttendanceSessionsTable)
          .set({ attendanceRecordId: rec.id })
          .where(eq(mobileAttendanceSessionsTable.id, session!.id));
      }
    } catch (attErr) {
      console.warn("mobile start attendance sync", attErr);
    }

    await writeAudit({
      sessionId: session!.id,
      employeeId: emp.id,
      actorId: req.userId,
      action: "MOBILE_ATTENDANCE_STARTED",
      metadata: { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy },
      req,
    });

    res.json({
      ok: true,
      sessionId: session!.id,
      startTime: now.toISOString(),
      startLatitude: gps.lat,
      startLongitude: gps.lng,
      startAccuracy: gps.accuracy,
      routeTrackingEnabled: session!.routeTrackingEnabled,
      message: "Ko‘chma davomat boshlandi",
      accuracyWarn: gps.accuracyWarn,
    });
  } catch (err) {
    console.error("POST mobile start", err);
    res.status(503).json({ error: "Boshlanmadi" });
  }
});

/** POST /mobile-attendance/end */
router.post("/mobile-attendance/end", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const settings = await getMobileSettings();
    const emp = await findEmployeeForUser(req.userId!);
    if (!emp) {
      res.status(403).json({ error: "Ruxsat yo‘q", code: "MOBILE_ATTENDANCE_NOT_ALLOWED" });
      return;
    }
    const sessionId = req.body?.sessionId != null ? Number(req.body.sessionId) : null;
    const today = mobileTodayYmd();
    const [open] = await db
      .select()
      .from(mobileAttendanceSessionsTable)
      .where(
        sessionId
          ? and(
              eq(mobileAttendanceSessionsTable.id, sessionId),
              eq(mobileAttendanceSessionsTable.employeeId, emp.id),
              eq(mobileAttendanceSessionsTable.status, "open"),
            )
          : and(
              eq(mobileAttendanceSessionsTable.employeeId, emp.id),
              eq(mobileAttendanceSessionsTable.workDate, today),
              eq(mobileAttendanceSessionsTable.status, "open"),
            ),
      )
      .limit(1);
    if (!open) {
      res.status(400).json({ error: "Ochiq ko‘chma davomat yo‘q", code: "NO_OPEN_SESSION" });
      return;
    }

    const device = await resolveDevice(req);
    if (device.blocked) {
      res.status(403).json({ error: "Qurilma bloklangan", code: "DEVICE_BLOCKED" });
      return;
    }

    const perm = open.permissionId
      ? (
          await db
            .select()
            .from(mobileAttendancePermissionsTable)
            .where(eq(mobileAttendancePermissionsTable.id, open.permissionId))
            .limit(1)
        )[0]
      : null;
    const maxAcc = perm?.maxAccuracyMeters ?? settings.maxAccuracyMeters;
    const gps = validateGpsInput({
      latitude: req.body?.latitude,
      longitude: req.body?.longitude,
      accuracy: req.body?.accuracy,
      maxAccuracy: maxAcc,
    });
    if (!gps.ok) {
      res.status(400).json({ error: gps.error, code: gps.code });
      return;
    }

    const now = new Date();
    const locTs =
      req.body?.locationTimestamp != null
        ? new Date(Number(req.body.locationTimestamp) || req.body.locationTimestamp)
        : now;

    let securityStatus = open.securityStatus || "ok";
    if (settings.detectSuspicious) {
      const jump = isImpossibleTravel(
        open.startLatitude,
        open.startLongitude,
        open.startTime.getTime(),
        gps.lat,
        gps.lng,
        now.getTime(),
      );
      if (jump.suspicious) {
        securityStatus = "suspicious";
        if (settings.createSecurityEvents) {
          await recordSecurityEvent({
            userId: emp.userId,
            deviceRowId: device.deviceRowId,
            eventType: "mobile_impossible_travel",
            severity: "high",
            metadata: {
              sessionId: open.id,
              distanceM: Math.round(jump.distanceM),
              speedKmh: Math.round(jump.speedKmh),
              start: { lat: open.startLatitude, lng: open.startLongitude },
              end: { lat: gps.lat, lng: gps.lng },
            },
          });
        }
      }
    }

    const seq = await db
      .select({ n: sql<number>`coalesce(max(${mobileLocationPointsTable.sequenceNumber}),0)::int` })
      .from(mobileLocationPointsTable)
      .where(eq(mobileLocationPointsTable.sessionId, open.id));

    await db.insert(mobileLocationPointsTable).values({
      sessionId: open.id,
      latitude: gps.lat,
      longitude: gps.lng,
      accuracy: gps.accuracy,
      recordedAt: locTs,
      sequenceNumber: Number(seq[0]?.n ?? 0) + 1,
      pointType: "end",
    });

    await db
      .update(mobileAttendanceSessionsTable)
      .set({
        status: "closed",
        securityStatus,
        endTime: now,
        endLatitude: gps.lat,
        endLongitude: gps.lng,
        endAccuracy: gps.accuracy,
        endLocationTs: locTs,
        updatedAt: now,
      })
      .where(eq(mobileAttendanceSessionsTable.id, open.id));

    if (open.attendanceRecordId) {
      try {
        await db
          .update(attendanceRecordsTable)
          .set({
            checkOutAt: now,
            checkOutMethod: "MOBILE_GPS",
            checkLatitude: gps.lat,
            checkLongitude: gps.lng,
            status: securityStatus === "suspicious" ? "present" : "present",
            updatedAt: now,
            notes:
              securityStatus === "suspicious"
                ? "mobile_gps:suspicious_travel"
                : "mobile_gps:closed",
          })
          .where(eq(attendanceRecordsTable.id, open.attendanceRecordId));
      } catch {
        /* ignore */
      }
    }

    await writeAudit({
      sessionId: open.id,
      employeeId: emp.id,
      actorId: req.userId,
      action: "MOBILE_ATTENDANCE_ENDED",
      metadata: { lat: gps.lat, lng: gps.lng, securityStatus },
      req,
    });

    const durationMin = Math.round((now.getTime() - open.startTime.getTime()) / 60_000);
    res.json({
      ok: true,
      sessionId: open.id,
      endTime: now.toISOString(),
      endLatitude: gps.lat,
      endLongitude: gps.lng,
      endAccuracy: gps.accuracy,
      startLatitude: open.startLatitude,
      startLongitude: open.startLongitude,
      startTime: open.startTime.toISOString(),
      durationMin,
      securityStatus,
      message:
        securityStatus === "suspicious"
          ? "Davomat yakunlandi (shubhali harakat qayd etildi)"
          : "Davomat yakunlandi",
    });
  } catch (err) {
    console.error("POST mobile end", err);
    res.status(503).json({ error: "Yakunlanmadi" });
  }
});

/** POST /mobile-attendance/ensure-track — ruxsat bo‘lsa bugungi tracking sessiyasini ochadi */
router.post("/mobile-attendance/ensure-track", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const settings = await getMobileSettings();
    if (!settings.enabled) {
      res.json({ ok: false, reason: "disabled", allowed: false });
      return;
    }
    const emp = await findEmployeeForUser(req.userId!);
    if (!emp) {
      res.json({ ok: false, reason: "employee_missing", allowed: false });
      return;
    }
    const perm = await findActivePermissionForEmployee(emp.id);
    if (!perm) {
      res.json({ ok: false, reason: "no_permission", allowed: false });
      return;
    }
    const today = mobileTodayYmd();
    const [open] = await db
      .select()
      .from(mobileAttendanceSessionsTable)
      .where(
        and(
          eq(mobileAttendanceSessionsTable.employeeId, emp.id),
          eq(mobileAttendanceSessionsTable.workDate, today),
          eq(mobileAttendanceSessionsTable.status, "open"),
        ),
      )
      .orderBy(desc(mobileAttendanceSessionsTable.id))
      .limit(1);

    if (open) {
      res.json({
        ok: true,
        allowed: true,
        sessionId: open.id,
        routeTrackingEnabled: Boolean(open.routeTrackingEnabled || perm.routeTrackingEnabled || true),
        created: false,
      });
      return;
    }

    const lat = Number(req.body?.latitude);
    const lng = Number(req.body?.longitude);
    const accuracy = req.body?.accuracy != null ? Number(req.body.accuracy) : null;
    const hasGps = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    // Boshlash tugmasi yo‘q — faqat haqiqiy GPS bilan sessiya ochiladi
    if (!hasGps) {
      res.json({ ok: false, reason: "gps_required", allowed: true });
      return;
    }
    const now = new Date();

    const [session] = await db
      .insert(mobileAttendanceSessionsTable)
      .values({
        employeeId: emp.id,
        userId: emp.userId,
        permissionId: perm.id,
        workDate: today,
        shiftKey: perm.shiftKey,
        status: "open",
        securityStatus: "ok",
        ipAddress: clientIp(req),
        userAgent: String(req.headers["user-agent"] || "").slice(0, 400),
        startTime: now,
        startLatitude: lat,
        startLongitude: lng,
        startAccuracy: Number.isFinite(accuracy as number) ? (accuracy as number) : null,
        startLocationTs: now,
        routeTrackingEnabled: true,
        notes: "auto_gps_grant",
      })
      .returning();

    await db.insert(mobileLocationPointsTable).values({
      sessionId: session!.id,
      latitude: lat,
      longitude: lng,
      accuracy: Number.isFinite(accuracy as number) ? (accuracy as number) : null,
      recordedAt: now,
      sequenceNumber: 0,
      pointType: "start",
    });

    res.json({
      ok: true,
      allowed: true,
      sessionId: session!.id,
      routeTrackingEnabled: true,
      created: true,
    });
  } catch (err) {
    console.error("POST mobile ensure-track", err);
    res.status(503).json({ error: "Tracking ochilmadi" });
  }
});

/** POST /mobile-attendance/track — route point (faqat ochiq sessiya + tracking ON) */
router.post("/mobile-attendance/track", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const emp = await findEmployeeForUser(req.userId!);
    if (!emp) {
      res.status(403).json({ error: "Ruxsat yo‘q", code: "MOBILE_ATTENDANCE_NOT_ALLOWED" });
      return;
    }
    const sessionId = Number(req.body?.sessionId);
    const [open] = await db
      .select()
      .from(mobileAttendanceSessionsTable)
      .where(
        and(
          eq(mobileAttendanceSessionsTable.id, sessionId),
          eq(mobileAttendanceSessionsTable.employeeId, emp.id),
          eq(mobileAttendanceSessionsTable.status, "open"),
        ),
      )
      .limit(1);
    if (!open) {
      res.status(400).json({ error: "Ochiq sessiya yo‘q", code: "NO_OPEN_SESSION" });
      return;
    }
    if (!open.routeTrackingEnabled) {
      // auto_ensure yoki eski sessiya — ruxsat bor bo‘lsa baribir qabul qilamiz
      const perm = await findActivePermissionForEmployee(emp.id);
      if (!perm) {
        res.status(403).json({ error: "Yo‘nalish qaydi o‘chirilgan", code: "TRACKING_OFF" });
        return;
      }
    }
    const settings = await getMobileSettings();
    const gps = validateGpsInput({
      latitude: req.body?.latitude,
      longitude: req.body?.longitude,
      accuracy: req.body?.accuracy,
      maxAccuracy: settings.maxAccuracyMeters * 2,
    });
    if (!gps.ok) {
      res.status(400).json({ error: gps.error, code: gps.code });
      return;
    }

    const last = await db
      .select()
      .from(mobileLocationPointsTable)
      .where(eq(mobileLocationPointsTable.sessionId, open.id))
      .orderBy(desc(mobileLocationPointsTable.sequenceNumber))
      .limit(1);
    const lastPt = last[0];
    if (lastPt) {
      const jump = isImpossibleTravel(
        lastPt.latitude,
        lastPt.longitude,
        lastPt.recordedAt.getTime(),
        gps.lat,
        gps.lng,
        Date.now(),
      );
      if (jump.suspicious && settings.detectSuspicious && settings.createSecurityEvents) {
        await recordSecurityEvent({
          userId: emp.userId,
          eventType: "mobile_track_impossible_jump",
          severity: "medium",
          metadata: { sessionId: open.id, distanceM: Math.round(jump.distanceM), speedKmh: Math.round(jump.speedKmh) },
        });
        await db
          .update(mobileAttendanceSessionsTable)
          .set({ securityStatus: "suspicious", updatedAt: new Date() })
          .where(eq(mobileAttendanceSessionsTable.id, open.id));
      }
    }

    const seq = (lastPt?.sequenceNumber ?? 0) + 1;
    const [pt] = await db
      .insert(mobileLocationPointsTable)
      .values({
        sessionId: open.id,
        latitude: gps.lat,
        longitude: gps.lng,
        accuracy: gps.accuracy,
        recordedAt: new Date(),
        sequenceNumber: seq,
        pointType: "track",
      })
      .returning({ id: mobileLocationPointsTable.id });

    res.json({ ok: true, pointId: pt?.id, sequenceNumber: seq });
  } catch (err) {
    console.error("POST mobile track", err);
    res.status(503).json({ error: "Nuqta saqlanmadi" });
  }
});

/** GET /mobile-attendance/employees — tanlash uchun (group=pharmacy|office) */
router.get("/mobile-attendance/employees", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const q = String((req.query as { q?: string }).q || "")
      .trim()
      .toLowerCase();
    const group = String((req.query as { group?: string }).group || "")
      .trim()
      .toLowerCase();
    const rows = await db
      .select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        position: employeesTable.position,
        location: employeesTable.location,
        userId: employeesTable.userId,
        orgRole: employeesTable.orgRole,
        employmentStatus: employeesTable.employmentStatus,
        userRole: usersTable.role,
      })
      .from(employeesTable)
      .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
      .orderBy(employeesTable.fullName)
      .limit(1200);

    const PHARMACY_ROLES = new Set(["mudir", "farmasevt", "stajyor", "koordinator"]);
    const PHARMACY_ORG = new Set(["manager", "pharmacist", "intern", "coordinator", "supervisor"]);

    const isPharmacy = (e: (typeof rows)[0]) => {
      const ur = String(e.userRole || "").toLowerCase();
      const org = String(e.orgRole || "").toLowerCase();
      return PHARMACY_ROLES.has(ur) || PHARMACY_ORG.has(org);
    };

    const filtered = rows
      .filter((e) => {
        const st = String(e.employmentStatus || "").toLowerCase();
        if (st === "dismissed" || st === "closed") return false;
        if (group === "pharmacy" || group === "dorixona") {
          if (!isPharmacy(e)) return false;
        } else if (group === "office" || group === "ofis") {
          if (isPharmacy(e)) return false;
        } else {
          return false;
        }
        if (!q) return true;
        const hay = `${e.fullName} ${e.position || ""} ${e.location || ""} ${e.userRole || ""}`.toLowerCase();
        return hay.includes(q);
      });

    /** Bir xodim kartasi / bir user — ro‘yxatda 1 marta */
    const score = (e: (typeof rows)[0]) => {
      let s = 0;
      if (e.userId != null) s += 100;
      if (e.userRole) s += 20;
      if (e.position) s += 5;
      const st = String(e.employmentStatus || "").toLowerCase();
      if (st === "working" || st === "new" || st === "active") s += 10;
      return s;
    };
    const pickBetter = (a: (typeof rows)[0], b: (typeof rows)[0]) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa > sb ? a : b;
      return a.id >= b.id ? a : b;
    };

    const byUser = new Map<number, (typeof rows)[0]>();
    const noUser: (typeof rows)[0][] = [];
    for (const e of filtered) {
      if (e.userId != null) {
        const prev = byUser.get(e.userId);
        byUser.set(e.userId, prev ? pickBetter(prev, e) : e);
      } else {
        noUser.push(e);
      }
    }
    const byName = new Map<string, (typeof rows)[0]>();
    for (const e of [...byUser.values(), ...noUser]) {
      const key = normalizePersonName(e.fullName || "");
      if (!key) continue;
      const prev = byName.get(key);
      byName.set(key, prev ? pickBetter(prev, e) : e);
    }

    const unique = [...byName.values()]
      .sort((a, b) => String(a.fullName || "").localeCompare(String(b.fullName || ""), "uz"))
      .slice(0, 400)
      .map((e) => ({
        id: e.id,
        fullName: formatPersonName(e.fullName) || e.fullName,
        position: e.position,
        location: e.location,
        userId: e.userId,
        orgRole: e.orgRole,
        userRole: e.userRole,
        group: isPharmacy(e) ? "pharmacy" : "office",
      }));
    res.json({ group: group || null, employees: unique, count: unique.length });
  } catch (err) {
    console.error("GET mobile employees", err);
    res.status(503).json({ error: "Xodimlar yuklanmadi" });
  }
});

export default router;
