import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import {
  db,
  attendanceRecordsTable,
  branchAuditsTable,
  coordinatorBranchVisitsTable,
  employeesTable,
  usersTable,
} from "@workspace/db";

export type CoordVisitRow = typeof coordinatorBranchVisitsTable.$inferSelect;

let lastBackfillMs = 0;
const BACKFILL_COOLDOWN_MS = 60_000;

export function formatDurationMinutes(mins: number | null): string {
  if (mins == null || !Number.isFinite(mins) || mins < 0) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h <= 0) return `${m} daq`;
  if (m === 0) return `${h} soat`;
  return `${h} soat ${m} daq`;
}

export function visitDurationMinutes(v: {
  checkInAt: Date | string | null;
  checkOutAt: Date | string | null;
}): number | null {
  if (!v.checkInAt) return null;
  const start = new Date(v.checkInAt).getTime();
  const end = v.checkOutAt ? new Date(v.checkOutAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60_000);
}

export async function getOpenCoordinatorVisit(
  coordinatorUserId: number,
): Promise<CoordVisitRow | null> {
  const [row] = await db
    .select()
    .from(coordinatorBranchVisitsTable)
    .where(
      and(
        eq(coordinatorBranchVisitsTable.coordinatorUserId, coordinatorUserId),
        eq(coordinatorBranchVisitsTable.status, "open"),
      ),
    )
    .orderBy(desc(coordinatorBranchVisitsTable.checkInAt))
    .limit(1);
  return row ?? null;
}

/**
 * Keldim oldidan: boshqa filialda ochiq tashrif bo‘lsa — blok.
 * Ketdim: faqat ochiq filialda.
 */
export async function assertCoordinatorPunchAllowed(opts: {
  userId: number;
  action: "in" | "out";
  branchId: number | null | undefined;
  branchLabel?: string | null;
}): Promise<{ ok: true } | { ok: false; status: number; error: string; code: string }> {
  const open = await getOpenCoordinatorVisit(opts.userId);
  const branchId = opts.branchId != null && Number.isFinite(opts.branchId) ? Number(opts.branchId) : null;

  if (opts.action === "in") {
    if (open && branchId != null && open.branchId !== branchId) {
      const prev = open.branchLabel || `Filial #${open.branchId}`;
      return {
        ok: false,
        status: 403,
        code: "open_visit_elsewhere",
        error: `Avvalgi filialda «Ketdim» qilmagansiz: «${prev}». Avval shu yerdan Ketdim qiling — keyin boshqa filialga o‘ting.`,
      };
    }
    if (open && branchId != null && open.branchId === branchId) {
      return {
        ok: false,
        status: 400,
        code: "already_in_branch",
        error: `Bu filialda allaqachon «Keldim» qilgansiz. Cheklistni to‘ldiring, keyin «Ketdim» bosing.`,
      };
    }
    if (!branchId) {
      // Ofis / GPS yo‘q — ochiq filial tashrifini yopmasdan ofis punchiga ruxsat (agar ochiq bo‘lsa ogohlantirish)
      if (open) {
        const prev = open.branchLabel || `Filial #${open.branchId}`;
        return {
          ok: false,
          status: 403,
          code: "open_visit_elsewhere",
          error: `Filialda ochiq tashrif bor: «${prev}». Avval «Ketdim» qiling.`,
        };
      }
    }
    return { ok: true };
  }

  // out
  if (open) {
    if (branchId != null && open.branchId !== branchId) {
      const prev = open.branchLabel || `Filial #${open.branchId}`;
      return {
        ok: false,
        status: 403,
        code: "checkout_wrong_branch",
        error: `«Ketdim» faqat tashrif qilgan filialda: «${prev}». Boshqa joyda Ketdim qilib bo‘lmaydi.`,
      };
    }
  }
  return { ok: true };
}

export async function syncCoordinatorVisitOnPunch(opts: {
  userId: number;
  employeeId: number;
  fullName: string;
  action: "in" | "out";
  branchId: number | null | undefined;
  branchLabel?: string | null;
  workDate: string;
  latitude?: number | null;
  longitude?: number | null;
  checkoutNote?: string | null;
}): Promise<CoordVisitRow | null> {
  const branchId =
    opts.branchId != null && Number.isFinite(Number(opts.branchId))
      ? Number(opts.branchId)
      : null;
  if (!branchId) return null;

  const now = new Date();
  const open = await getOpenCoordinatorVisit(opts.userId);

  if (opts.action === "in") {
    if (open && open.branchId === branchId) return open;
    const [created] = await db
      .insert(coordinatorBranchVisitsTable)
      .values({
        coordinatorUserId: opts.userId,
        coordinatorEmployeeId: opts.employeeId,
        coordinatorName: opts.fullName,
        branchId,
        branchLabel: opts.branchLabel || null,
        workDate: opts.workDate,
        checkInAt: now,
        checkInLatitude: opts.latitude ?? null,
        checkInLongitude: opts.longitude ?? null,
        status: "open",
      })
      .returning();
    return created ?? null;
  }

  // out — ochiq tashrifni yopish
  if (open && open.branchId === branchId) {
    const note = String(opts.checkoutNote || "").trim() || open.checkoutNote || null;
    const [updated] = await db
      .update(coordinatorBranchVisitsTable)
      .set({
        checkOutAt: now,
        checkOutLatitude: opts.latitude ?? null,
        checkOutLongitude: opts.longitude ?? null,
        checkoutNote: note,
        status: "closed",
        updatedAt: now,
      })
      .where(eq(coordinatorBranchVisitsTable.id, open.id))
      .returning();
    return updated ?? null;
  }
  return open;
}

/** Cheklist sahifasidan tashrif ochish (Face ID dan keyin yoki GPS ichida) */
export async function startCoordinatorVisit(opts: {
  userId: number;
  employeeId: number;
  fullName: string;
  branchId: number;
  branchLabel?: string | null;
  workDate: string;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<
  | { ok: true; visit: CoordVisitRow }
  | { ok: false; status: number; error: string; code: string }
> {
  const gate = await assertCoordinatorPunchAllowed({
    userId: opts.userId,
    action: "in",
    branchId: opts.branchId,
    branchLabel: opts.branchLabel,
  });
  if (!gate.ok) {
    if (gate.code === "already_in_branch") {
      const open = await getOpenCoordinatorVisit(opts.userId);
      if (open) return { ok: true, visit: open };
    }
    return gate;
  }
  const visit = await syncCoordinatorVisitOnPunch({
    userId: opts.userId,
    employeeId: opts.employeeId,
    fullName: opts.fullName,
    action: "in",
    branchId: opts.branchId,
    branchLabel: opts.branchLabel,
    workDate: opts.workDate,
    latitude: opts.latitude,
    longitude: opts.longitude,
  });
  if (!visit) {
    return { ok: false, status: 503, error: "Tashrif ochilmadi", code: "visit_create_failed" };
  }
  return { ok: true, visit };
}

/** Ketdim: izoh bilan filial tashrifini yopish (Face ID dan oldin/keyin) */
export async function finishCoordinatorVisitWithNote(opts: {
  userId: number;
  note: string;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<
  | { ok: true; visit: CoordVisitRow }
  | { ok: false; status: number; error: string; code: string }
> {
  const note = String(opts.note || "").trim();
  if (note.length < 10) {
    return {
      ok: false,
      status: 400,
      code: "note_too_short",
      error: "Izoh kamida 10 belgidan iborat bo‘lsin — bugun nima qilganingizni yozing.",
    };
  }
  if (note.length > 2000) {
    return {
      ok: false,
      status: 400,
      code: "note_too_long",
      error: "Izoh juda uzun (maks. 2000 belgi).",
    };
  }

  const open = await getOpenCoordinatorVisit(opts.userId);
  if (!open) {
    return {
      ok: false,
      status: 400,
      code: "no_open_visit",
      error: "Yopiladigan ochiq tashrif yo‘q. Avval filialda «Keldim» qiling.",
    };
  }

  const now = new Date();
  const [updated] = await db
    .update(coordinatorBranchVisitsTable)
    .set({
      checkOutAt: now,
      checkOutLatitude: opts.latitude ?? null,
      checkOutLongitude: opts.longitude ?? null,
      checkoutNote: note,
      status: "closed",
      updatedAt: now,
    })
    .where(eq(coordinatorBranchVisitsTable.id, open.id))
    .returning();

  if (!updated) {
    return { ok: false, status: 503, code: "finish_failed", error: "Tashrif yopilmadi" };
  }
  return { ok: true, visit: updated };
}

export async function attachChecklistToOpenVisit(opts: {
  coordinatorUserId: number;
  branchId: number;
  auditId: number;
}): Promise<CoordVisitRow | null> {
  const open = await getOpenCoordinatorVisit(opts.coordinatorUserId);
  if (!open || open.branchId !== opts.branchId) return null;
  const now = new Date();
  const [updated] = await db
    .update(coordinatorBranchVisitsTable)
    .set({
      checklistAuditId: opts.auditId,
      checklistAt: now,
      updatedAt: now,
    })
    .where(eq(coordinatorBranchVisitsTable.id, open.id))
    .returning();
  return updated ?? null;
}

export async function assertChecklistAllowedForCoordinator(opts: {
  userId: number;
  branchId: number;
}): Promise<{ ok: true; visit: CoordVisitRow } | { ok: false; status: number; error: string; code: string }> {
  let open = await getOpenCoordinatorVisit(opts.userId);
  // Agar sync ushlamagan bo‘lsa — bugungi attendance dan ochiq tashrif tiklash
  if (!open) {
    open = await openVisitFromTodayAttendance(opts.userId, opts.branchId);
  }
  if (!open) {
    return {
      ok: false,
      status: 403,
      code: "need_checkin",
      error:
        "Avval shu filialda Face ID orqali «Keldim» qiling. Keyin cheklist ochiladi. Tugagach «Ketdim» qiling.",
    };
  }
  if (open.branchId !== opts.branchId) {
    const prev = open.branchLabel || `Filial #${open.branchId}`;
    return {
      ok: false,
      status: 403,
      code: "wrong_branch_visit",
      error: `Hozir ochiq tashrif: «${prev}». Faqat shu filialda cheklist qila olasiz. Boshqasiga o‘tishdan oldin «Ketdim» qiling.`,
    };
  }
  return { ok: true, visit: open };
}

/** Bugungi davomat (filial) dan ochiq tashrif yaratish — sync tushib qolgan hollar */
async function openVisitFromTodayAttendance(
  userId: number,
  branchId: number,
): Promise<CoordVisitRow | null> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
  const [user] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const [emp] = await db
    .select({ id: employeesTable.id, fullName: employeesTable.fullName })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);
  if (!emp) return null;

  const [rec] = await db
    .select()
    .from(attendanceRecordsTable)
    .where(
      and(
        eq(attendanceRecordsTable.employeeId, emp.id),
        eq(attendanceRecordsTable.workDate, today),
        eq(attendanceRecordsTable.resolvedBranchId, branchId),
        isNotNull(attendanceRecordsTable.checkInAt),
      ),
    )
    .limit(1);
  if (!rec?.checkInAt) return null;
  if (rec.checkOutAt) return null; // allaqachon ketgan

  return syncCoordinatorVisitOnPunch({
    userId,
    employeeId: emp.id,
    fullName: user?.fullName || emp.fullName,
    action: "in",
    branchId,
    branchLabel: rec.resolvedBranchLabel,
    workDate: today,
    latitude: rec.checkLatitude,
    longitude: rec.checkLongitude,
  });
}

export function serializeVisit(v: CoordVisitRow) {
  const durationMin = visitDurationMinutes(v);
  const checklistLagMin =
    v.checklistAt && v.checkInAt
      ? Math.round((new Date(v.checklistAt).getTime() - new Date(v.checkInAt).getTime()) / 60_000)
      : null;
  return {
    id: v.id,
    coordinatorUserId: v.coordinatorUserId,
    coordinatorEmployeeId: v.coordinatorEmployeeId,
    coordinatorName: v.coordinatorName,
    branchId: v.branchId,
    branchLabel: v.branchLabel,
    workDate: v.workDate,
    checkInAt: v.checkInAt,
    checkOutAt: v.checkOutAt,
    checklistAuditId: v.checklistAuditId,
    checklistAt: v.checklistAt,
    checkoutNote: v.checkoutNote ?? null,
    status: v.status,
    durationMinutes: durationMin,
    durationLabel: formatDurationMinutes(durationMin),
    checklistAfterCheckInMinutes: checklistLagMin,
    checklistAfterCheckInLabel: formatDurationMinutes(checklistLagMin),
    stillOpen: v.status === "open" && !v.checkOutAt,
  };
}

/**
 * Eski Keldim/cheklistlardan monitoring jadvalini to‘ldirish.
 * Attendance (resolved filial) + branch_audits asosida.
 */
export async function backfillCoordinatorVisitsFromHistory(opts?: {
  from?: string;
  to?: string;
  force?: boolean;
}): Promise<{ inserted: number; linked: number }> {
  const now = Date.now();
  if (!opts?.force && now - lastBackfillMs < BACKFILL_COOLDOWN_MS) {
    return { inserted: 0, linked: 0 };
  }
  lastBackfillMs = now;

  let inserted = 0;
  let linked = 0;

  const coordUsers = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "koordinator"));
  if (!coordUsers.length) return { inserted, linked };

  const coordUserIds = coordUsers.map((u) => u.id);
  const nameByUser = new Map(coordUsers.map((u) => [u.id, u.fullName]));

  const empRows = await db
    .select({
      id: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
    })
    .from(employeesTable)
    .where(inArray(employeesTable.userId, coordUserIds));
  const empByUser = new Map<number, { id: number; fullName: string }>();
  for (const e of empRows) {
    if (e.userId != null && !empByUser.has(e.userId)) {
      empByUser.set(e.userId, { id: e.id, fullName: e.fullName });
    }
  }
  const empIds = empRows.map((e) => e.id);
  const userByEmp = new Map<number, number>();
  for (const e of empRows) {
    if (e.userId != null) userByEmp.set(e.id, e.userId);
  }

  const existing = await db
    .select({
      id: coordinatorBranchVisitsTable.id,
      coordinatorUserId: coordinatorBranchVisitsTable.coordinatorUserId,
      branchId: coordinatorBranchVisitsTable.branchId,
      workDate: coordinatorBranchVisitsTable.workDate,
      checklistAuditId: coordinatorBranchVisitsTable.checklistAuditId,
      checkOutAt: coordinatorBranchVisitsTable.checkOutAt,
      status: coordinatorBranchVisitsTable.status,
    })
    .from(coordinatorBranchVisitsTable);
  const byKey = new Map<string, (typeof existing)[0]>();
  for (const row of existing) {
    byKey.set(`${row.coordinatorUserId}|${row.branchId}|${row.workDate}`, row);
  }

  // 1) Attendance — filialda Keldim/Ketdim
  if (empIds.length) {
    const attConds = [
      inArray(attendanceRecordsTable.employeeId, empIds),
      isNotNull(attendanceRecordsTable.resolvedBranchId),
      isNotNull(attendanceRecordsTable.checkInAt),
    ];
    if (opts?.from) attConds.push(gte(attendanceRecordsTable.workDate, opts.from));
    if (opts?.to) attConds.push(lte(attendanceRecordsTable.workDate, opts.to));

    const records = await db
      .select({
        employeeId: attendanceRecordsTable.employeeId,
        workDate: attendanceRecordsTable.workDate,
        checkInAt: attendanceRecordsTable.checkInAt,
        checkOutAt: attendanceRecordsTable.checkOutAt,
        branchId: attendanceRecordsTable.resolvedBranchId,
        branchLabel: attendanceRecordsTable.resolvedBranchLabel,
        checkLatitude: attendanceRecordsTable.checkLatitude,
        checkLongitude: attendanceRecordsTable.checkLongitude,
      })
      .from(attendanceRecordsTable)
      .where(and(...attConds))
      .orderBy(desc(attendanceRecordsTable.workDate))
      .limit(2000);

    for (const r of records) {
      if (r.branchId == null || !r.checkInAt) continue;
      const userId = userByEmp.get(r.employeeId);
      if (!userId) continue;
      const key = `${userId}|${r.branchId}|${r.workDate}`;
      if (byKey.has(key)) {
        const ex = byKey.get(key)!;
        if (!ex.checkOutAt && r.checkOutAt) {
          await db
            .update(coordinatorBranchVisitsTable)
            .set({
              checkOutAt: r.checkOutAt,
              status: "closed",
              updatedAt: new Date(),
            })
            .where(eq(coordinatorBranchVisitsTable.id, ex.id));
          ex.checkOutAt = r.checkOutAt;
          ex.status = "closed";
          linked += 1;
        }
        continue;
      }
      const emp = empByUser.get(userId);
      const [created] = await db
        .insert(coordinatorBranchVisitsTable)
        .values({
          coordinatorUserId: userId,
          coordinatorEmployeeId: emp?.id ?? r.employeeId,
          coordinatorName: nameByUser.get(userId) || emp?.fullName || null,
          branchId: r.branchId,
          branchLabel: r.branchLabel || null,
          workDate: r.workDate,
          checkInAt: r.checkInAt,
          checkOutAt: r.checkOutAt ?? null,
          checkInLatitude: r.checkLatitude ?? null,
          checkInLongitude: r.checkLongitude ?? null,
          status: r.checkOutAt ? "closed" : "open",
        })
        .returning({
          id: coordinatorBranchVisitsTable.id,
          coordinatorUserId: coordinatorBranchVisitsTable.coordinatorUserId,
          branchId: coordinatorBranchVisitsTable.branchId,
          workDate: coordinatorBranchVisitsTable.workDate,
          checklistAuditId: coordinatorBranchVisitsTable.checklistAuditId,
          checkOutAt: coordinatorBranchVisitsTable.checkOutAt,
          status: coordinatorBranchVisitsTable.status,
        });
      if (created) {
        byKey.set(key, created);
        inserted += 1;
      }
    }
  }

  // 2) Branch audits — cheklist saqlangan tashriflar
  const auditConds = [inArray(branchAuditsTable.coordinatorId, coordUserIds)];
  if (opts?.from) auditConds.push(gte(branchAuditsTable.visitDate, opts.from));
  if (opts?.to) auditConds.push(lte(branchAuditsTable.visitDate, opts.to));

  const audits = await db
    .select({
      id: branchAuditsTable.id,
      coordinatorId: branchAuditsTable.coordinatorId,
      coordinatorName: branchAuditsTable.coordinatorName,
      branchId: branchAuditsTable.managerEmployeeId,
      branchLabel: branchAuditsTable.branchLocation,
      visitDate: branchAuditsTable.visitDate,
      createdAt: branchAuditsTable.createdAt,
      checkLatitude: branchAuditsTable.checkLatitude,
      checkLongitude: branchAuditsTable.checkLongitude,
    })
    .from(branchAuditsTable)
    .where(and(...auditConds))
    .orderBy(desc(branchAuditsTable.createdAt))
    .limit(2000);

  for (const a of audits) {
    const key = `${a.coordinatorId}|${a.branchId}|${a.visitDate}`;
    const ex = byKey.get(key);
    if (ex) {
      if (!ex.checklistAuditId) {
        await db
          .update(coordinatorBranchVisitsTable)
          .set({
            checklistAuditId: a.id,
            checklistAt: a.createdAt,
            updatedAt: new Date(),
          })
          .where(eq(coordinatorBranchVisitsTable.id, ex.id));
        ex.checklistAuditId = a.id;
        linked += 1;
      }
      continue;
    }
    const emp = empByUser.get(a.coordinatorId);
    const checkIn = a.createdAt || new Date();
    const [created] = await db
      .insert(coordinatorBranchVisitsTable)
      .values({
        coordinatorUserId: a.coordinatorId,
        coordinatorEmployeeId: emp?.id ?? null,
        coordinatorName: a.coordinatorName || nameByUser.get(a.coordinatorId) || null,
        branchId: a.branchId,
        branchLabel: a.branchLabel || null,
        workDate: a.visitDate,
        checkInAt: checkIn,
        checkOutAt: checkIn,
        checkInLatitude: a.checkLatitude ?? null,
        checkInLongitude: a.checkLongitude ?? null,
        checklistAuditId: a.id,
        checklistAt: a.createdAt,
        status: "closed",
      })
      .returning({
        id: coordinatorBranchVisitsTable.id,
        coordinatorUserId: coordinatorBranchVisitsTable.coordinatorUserId,
        branchId: coordinatorBranchVisitsTable.branchId,
        workDate: coordinatorBranchVisitsTable.workDate,
        checklistAuditId: coordinatorBranchVisitsTable.checklistAuditId,
        checkOutAt: coordinatorBranchVisitsTable.checkOutAt,
        status: coordinatorBranchVisitsTable.status,
      });
    if (created) {
      byKey.set(key, created);
      inserted += 1;
    }
  }

  return { inserted, linked };
}

export async function listCoordinatorVisits(opts: {
  from?: string;
  to?: string;
  coordinatorUserId?: number;
  branchId?: number;
  limit?: number;
}) {
  try {
    await backfillCoordinatorVisitsFromHistory({ from: opts.from, to: opts.to });
  } catch (err) {
    console.error("coordinator visits backfill error:", err);
  }

  const conditions = [];
  if (opts.from) conditions.push(gte(coordinatorBranchVisitsTable.workDate, opts.from));
  if (opts.to) conditions.push(lte(coordinatorBranchVisitsTable.workDate, opts.to));
  if (opts.coordinatorUserId) {
    conditions.push(eq(coordinatorBranchVisitsTable.coordinatorUserId, opts.coordinatorUserId));
  }
  if (opts.branchId) {
    conditions.push(eq(coordinatorBranchVisitsTable.branchId, opts.branchId));
  }
  const rows = await db
    .select()
    .from(coordinatorBranchVisitsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(coordinatorBranchVisitsTable.checkInAt))
    .limit(Math.min(opts.limit ?? 500, 1000));
  return rows.map(serializeVisit);
}

/** Koordinator employee id bo‘yicha userId topish */
export async function coordinatorUserIdFromEmployee(employeeId: number): Promise<number | null> {
  const [row] = await db
    .select({ userId: employeesTable.userId })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId))
    .limit(1);
  return row?.userId ?? null;
}
