import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db, employeesTable, attendanceRecordsTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { canManageSettings, hasFullPlatformAccess } from "../lib/roles";
import {
  OMBORXONA_DEPARTMENT_NAME,
  ensureOmborxonaDepartmentId,
  isOmborHeadRole,
  isOmborStaffRole,
} from "../lib/omborxona-department";
import {
  assignEmployeeToShift,
  createWarehouseShift,
  getActiveMemberForEmployee,
  listOmborEmployees,
  listShiftMembers,
  listWarehouseShifts,
  unassignEmployee,
  updateWarehouseShift,
  warehouseHolatForDate,
} from "../lib/warehouse-shifts";
import { ymdInTashkent, warehouseCheckoutDeadlineHm } from "../lib/shift-hours";
import { formatPersonName } from "../lib/person-name";

function formatHmTashkent(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function attendanceStatusUz(status?: string | null, checkIn?: Date | null, checkOut?: Date | null): string {
  const s = String(status || "").toLowerCase();
  if (checkIn && !checkOut) return "Ishda";
  if (s === "late") return "Kechikkan";
  if (checkIn && checkOut && s === "present") return "Kelgan";
  if (checkIn && checkOut) return "Ketdi";
  if (s === "present") return "Kelgan";
  if (s === "absent") return "Kelmagan";
  if (s === "incomplete") return "Yopilmagan";
  return "Kutilmoqda";
}

function addYmdDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function periodRange(period: string, todayYmd: string): { from: string; to: string; label: string } {
  const [y, m] = todayYmd.split("-").map(Number);
  if (period === "year") {
    return { from: `${y}-01-01`, to: todayYmd, label: `${y}-yil` };
  }
  if (period === "month") {
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    return { from, to: todayYmd, label: `${String(m).padStart(2, "0")}.${y}` };
  }
  // week — oxirgi 7 kun
  return { from: addYmdDays(todayYmd, -6), to: todayYmd, label: "7 kun" };
}

function dayKind(status?: string | null): "late" | "absent" | "ok" | "other" {
  const s = String(status || "").toLowerCase();
  if (s === "late") return "late";
  if (s === "absent") return "absent";
  if (s === "present" || s === "incomplete") return "ok";
  return "other";
}

const router: IRouter = Router();

function canManageOmbor(role?: string | null): boolean {
  return (
    isOmborHeadRole(role) ||
    hasFullPlatformAccess(role) ||
    canManageSettings(role)
  );
}

function canViewOmbor(role?: string | null): boolean {
  return isOmborStaffRole(role) || canManageOmbor(role);
}

router.get("/omborxona/meta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewOmbor(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const departmentId = await ensureOmborxonaDepartmentId();
    res.json({
      departmentId,
      departmentName: OMBORXONA_DEPARTMENT_NAME,
      canManage: canManageOmbor(req.userRole),
      canViewHolat: canManageOmbor(req.userRole),
      checkoutGraceHours: 2,
    });
  } catch (err) {
    console.error("GET /omborxona/meta error:", err);
    res.status(500).json({ error: "Yuklanmadi" });
  }
});

router.get("/omborxona/shifts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewOmbor(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const includeInactive = canManageOmbor(req.userRole) && req.query.inactive === "1";
    const { departmentId, shifts } = await listWarehouseShifts({ includeInactive });
    const withCounts = await Promise.all(
      shifts.map(async (s) => {
        const members = await listShiftMembers(s.id);
        return {
          id: s.id,
          name: s.name,
          startHm: s.startHm,
          endHm: s.endHm,
          overnight: s.overnight,
          active: s.active,
          memberCount: members.length,
          members: canManageOmbor(req.userRole)
            ? members.map((m) => ({
                id: m.id,
                employeeId: m.employeeId,
                fullName: formatPersonName(m.fullName) || m.fullName,
                position: m.position,
                userRole: m.userRole,
              }))
            : undefined,
        };
      }),
    );
    res.json({ departmentId, shifts: withCounts });
  } catch (err) {
    console.error("GET /omborxona/shifts error:", err);
    res.status(500).json({ error: "Yuklanmadi" });
  }
});

router.post("/omborxona/shifts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageOmbor(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const name = String(req.body?.name || "").trim();
  const startHm = String(req.body?.startHm || "").trim();
  const endHm = String(req.body?.endHm || "").trim();
  if (!name || name.length < 2) {
    res.status(400).json({ error: "Smena nomini kiriting" });
    return;
  }
  try {
    const created = await createWarehouseShift({
      name,
      startHm,
      endHm,
      overnight: typeof req.body?.overnight === "boolean" ? req.body.overnight : undefined,
      createdById: req.userId ?? null,
    });
    res.status(201).json({ shift: created });
  } catch (err) {
    console.error("POST /omborxona/shifts error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Saqlanmadi" });
  }
});

router.patch("/omborxona/shifts/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageOmbor(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "id noto‘g‘ri" });
    return;
  }
  try {
    const updated = await updateWarehouseShift(id, {
      name: req.body?.name,
      startHm: req.body?.startHm,
      endHm: req.body?.endHm,
      overnight: req.body?.overnight,
      active: req.body?.active,
    });
    if (!updated) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json({ shift: updated });
  } catch (err) {
    console.error("PATCH /omborxona/shifts error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Saqlanmadi" });
  }
});

router.get("/omborxona/staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewOmbor(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const staff = await listOmborEmployees();
    const enriched = await Promise.all(
      staff.map(async (s) => {
        const active = await getActiveMemberForEmployee(s.employeeId);
        return {
          employeeId: s.employeeId,
          fullName: formatPersonName(s.fullName) || s.fullName,
          position: s.position,
          employmentStatus: s.employmentStatus,
          userId: s.userId,
          userRole: s.userRole,
          login: s.login,
          shiftType: s.shiftType,
          shiftLabel: s.shiftLabel,
          assignedShift: active
            ? {
                id: active.shift.id,
                name: active.shift.name,
                startHm: active.shift.startHm,
                endHm: active.shift.endHm,
                overnight: active.shift.overnight,
              }
            : null,
        };
      }),
    );

    // Oddiy xodim — faqat o‘zini ko‘radi
    if (isOmborStaffRole(req.userRole) && !canManageOmbor(req.userRole)) {
      const [me] = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(eq(employeesTable.userId, req.userId!))
        .limit(1);
      res.json({
        staff: enriched.filter((e) => me && e.employeeId === me.id),
      });
      return;
    }

    res.json({ staff: enriched });
  } catch (err) {
    console.error("GET /omborxona/staff error:", err);
    res.status(500).json({ error: "Yuklanmadi" });
  }
});

router.post("/omborxona/assign", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageOmbor(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const shiftId = Number(req.body?.shiftId);
  const rawIds = Array.isArray(req.body?.employeeIds)
    ? req.body.employeeIds
    : req.body?.employeeId != null
      ? [req.body.employeeId]
      : [];
  const employeeIds = [
    ...new Set(
      rawIds
        .map((id: unknown) => Number(id))
        .filter((id: number) => Number.isFinite(id) && id > 0),
    ),
  ];
  if (!Number.isFinite(shiftId) || employeeIds.length === 0) {
    res.status(400).json({ error: "shiftId va kamida bitta xodim kerak" });
    return;
  }
  try {
    const assignments = [];
    const errors: Array<{ employeeId: number; error: string }> = [];
    for (const employeeId of employeeIds) {
      try {
        const created = await assignEmployeeToShift({
          shiftId,
          employeeId,
          assignedById: req.userId ?? null,
          note: req.body?.note ? String(req.body.note) : null,
        });
        assignments.push(created);
      } catch (err) {
        errors.push({
          employeeId,
          error: err instanceof Error ? err.message : "Biriktirilmadi",
        });
      }
    }
    if (!assignments.length) {
      res.status(400).json({
        error: errors[0]?.error || "Biriktirilmadi",
        errors,
      });
      return;
    }
    res.status(201).json({
      ok: true,
      count: assignments.length,
      assignments,
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    console.error("POST /omborxona/assign error:", err);
    res.status(400).json({ error: err instanceof Error ? err.message : "Biriktirilmadi" });
  }
});

router.post("/omborxona/unassign", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageOmbor(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const employeeId = Number(req.body?.employeeId);
  if (!Number.isFinite(employeeId)) {
    res.status(400).json({ error: "employeeId kerak" });
    return;
  }
  try {
    await unassignEmployee(employeeId);
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /omborxona/unassign error:", err);
    res.status(500).json({ error: "Olib tashlanmadi" });
  }
});

router.get("/omborxona/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewOmbor(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const [emp] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.userId, req.userId!))
      .limit(1);
    if (!emp) {
      res.json({ employee: null, shift: null, today: null, workDate: ymdInTashkent(new Date()) });
      return;
    }
    const active = await getActiveMemberForEmployee(emp.id);
    const today = ymdInTashkent(new Date());
    const [rec] = await db
      .select({
        checkInAt: attendanceRecordsTable.checkInAt,
        checkOutAt: attendanceRecordsTable.checkOutAt,
        status: attendanceRecordsTable.status,
      })
      .from(attendanceRecordsTable)
      .where(
        and(
          eq(attendanceRecordsTable.employeeId, emp.id),
          eq(attendanceRecordsTable.workDate, today),
        ),
      )
      .limit(1);

    const checkInAt = rec?.checkInAt ?? null;
    const checkOutAt = rec?.checkOutAt ?? null;
    const statusLabel = attendanceStatusUz(rec?.status, checkInAt, checkOutAt);

    res.json({
      workDate: today,
      employee: {
        id: emp.id,
        fullName: formatPersonName(emp.fullName) || emp.fullName,
        position: emp.position,
        shiftType: emp.shiftType,
        shiftLabel: emp.shiftLabel,
      },
      shift: active
        ? {
            id: active.shift.id,
            name: active.shift.name,
            startHm: active.shift.startHm,
            endHm: active.shift.endHm,
            overnight: active.shift.overnight,
            workHours: `${active.shift.startHm}–${active.shift.endHm}${active.shift.overnight ? " (keyingi kun)" : ""}`,
            checkoutGraceHours: 2,
            checkoutDeadlineHm: warehouseCheckoutDeadlineHm(
              today,
              active.shift.endHm,
              active.shift.overnight,
            ),
          }
        : null,
      today: {
        workDate: today,
        checkInAt: checkInAt?.toISOString() ?? null,
        checkOutAt: checkOutAt?.toISOString() ?? null,
        checkInHm: formatHmTashkent(checkInAt),
        checkOutHm: formatHmTashkent(checkOutAt),
        status: rec?.status ?? null,
        statusLabel,
        nextAction: !checkInAt ? "in" : !checkOutAt ? "out" : "done",
      },
    });
  } catch (err) {
    console.error("GET /omborxona/me error:", err);
    res.status(500).json({ error: "Yuklanmadi" });
  }
});

router.get("/omborxona/me/history", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewOmbor(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, req.userId!))
      .limit(1);
    if (!emp) {
      res.json({ period: "week", from: "", to: "", summary: { total: 0, late: 0, absent: 0, ok: 0 }, days: [] });
      return;
    }

    const periodRaw = String(req.query.period || "week").toLowerCase();
    const period = periodRaw === "month" || periodRaw === "year" ? periodRaw : "week";
    const filterRaw = String(req.query.filter || "all").toLowerCase();
    const filter = filterRaw === "late" || filterRaw === "absent" ? filterRaw : "all";

    const today = ymdInTashkent(new Date());
    const range = periodRange(period, today);

    const rows = await db
      .select({
        workDate: attendanceRecordsTable.workDate,
        checkInAt: attendanceRecordsTable.checkInAt,
        checkOutAt: attendanceRecordsTable.checkOutAt,
        status: attendanceRecordsTable.status,
      })
      .from(attendanceRecordsTable)
      .where(
        and(
          eq(attendanceRecordsTable.employeeId, emp.id),
          gte(attendanceRecordsTable.workDate, range.from),
          lte(attendanceRecordsTable.workDate, range.to),
        ),
      )
      .orderBy(desc(attendanceRecordsTable.workDate));

    const days = rows.map((r) => {
      const kind = dayKind(r.status);
      return {
        workDate: r.workDate,
        checkInHm: formatHmTashkent(r.checkInAt),
        checkOutHm: formatHmTashkent(r.checkOutAt),
        status: r.status,
        statusLabel: attendanceStatusUz(r.status, r.checkInAt, r.checkOutAt),
        kind,
      };
    });

    const summary = {
      total: days.length,
      late: days.filter((d) => d.kind === "late").length,
      absent: days.filter((d) => d.kind === "absent").length,
      ok: days.filter((d) => d.kind === "ok").length,
    };

    const filtered =
      filter === "late"
        ? days.filter((d) => d.kind === "late")
        : filter === "absent"
          ? days.filter((d) => d.kind === "absent")
          : days;

    res.json({
      period,
      filter,
      from: range.from,
      to: range.to,
      label: range.label,
      summary,
      days: filtered,
    });
  } catch (err) {
    console.error("GET /omborxona/me/history error:", err);
    res.status(500).json({ error: "Yuklanmadi" });
  }
});

router.get("/omborxona/holat", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageOmbor(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const workDate =
      typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : ymdInTashkent(new Date());
    const groups = await warehouseHolatForDate(workDate);
    res.json({ workDate, groups });
  } catch (err) {
    console.error("GET /omborxona/holat error:", err);
    res.status(500).json({ error: "Yuklanmadi" });
  }
});

export default router;
