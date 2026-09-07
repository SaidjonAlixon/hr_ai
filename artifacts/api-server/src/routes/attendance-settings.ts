/**
 * Filial biriktirish, smena reja, davomat sozlamalari API.
 * Smena faqat mudir/farmasevt/stajyor; ofis — belgilangan vaqt (admin o‘zgartiradi).
 */
import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  attendancePaySettingsTable,
  employeeBranchAssignmentsTable,
  employeeDayShiftPlansTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { canManageSettings, isHrRole } from "../lib/roles";
import {
  DEFAULT_PAY_SETTINGS,
  validateShiftCombination,
  parseShiftKeys,
  encodeShiftKeys,
  resolveBranchForDay,
  buildShiftDefs,
  plannedShiftMinutes,
  type BranchAssignment,
  type ShiftKey,
  type AttendancePaySettings,
} from "../lib/attendance-engine";
import {
  invalidateShiftScheduleCache,
  overridesFromPayRow,
  loadShiftScheduleOverrides,
} from "../lib/shift-schedule";

const router: IRouter = Router();

function canEdit(role?: string | null) {
  return canManageSettings(role) || isHrRole(role) || role === "koordinator";
}

function isHm(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^\d{1,2}:\d{2}$/.test(s) ? s : null;
}

function rowToPaySettings(row: typeof attendancePaySettingsTable.$inferSelect | undefined): AttendancePaySettings {
  if (!row) return { ...DEFAULT_PAY_SETTINGS, shiftSchedule: {} };
  return {
    unpaidBreakByShift: {
      one: row.unpaidBreakOneMin,
      two: row.unpaidBreakTwoMin,
      three: row.unpaidBreakThreeMin,
      office: row.unpaidBreakOfficeMin,
    },
    breakPaid: row.breakPaid,
    nightStartHm: row.nightStartHm,
    nightEndHm: row.nightEndHm,
    nightCoefficient: row.nightCoefficient,
    dailyNormMinutes: row.dailyNormMinutes,
    overtimeEnabled: row.overtimeEnabled,
    graceMinutes: row.graceMinutes,
    minRestHoursBetweenShifts: row.minRestHours,
    maxShiftsPerDay: row.maxShiftsPerDay,
    missingCheckoutStatus: "incomplete",
    shiftSchedule: overridesFromPayRow(row),
  };
}

function serializeShifts(row: typeof attendancePaySettingsTable.$inferSelect | undefined) {
  const defs = buildShiftDefs(overridesFromPayRow(row));
  return {
    pharmacyOnly: true,
    pharmacyRoles: ["mudir", "farmasevt", "stajyor"],
    officeNote: "Ofis xodimlarida smena yo‘q — faqat belgilangan ish vaqti",
    one: {
      start: defs.one.startHm,
      end: defs.one.endHm,
      overnight: false,
      unpaidBreakMin: row?.unpaidBreakOneMin ?? 60,
      plannedMinutes: plannedShiftMinutes(defs.one),
    },
    two: {
      start: defs.two.startHm,
      end: defs.two.endHm,
      overnight: false,
      unpaidBreakMin: row?.unpaidBreakTwoMin ?? 0,
      plannedMinutes: plannedShiftMinutes(defs.two),
    },
    three: {
      start: defs.three.startHm,
      end: defs.three.endHm,
      overnight: defs.three.overnight,
      unpaidBreakMin: row?.unpaidBreakThreeMin ?? 0,
      plannedMinutes: plannedShiftMinutes(defs.three),
    },
    office: {
      start: defs.office.startHm,
      end: defs.office.endHm,
      overnight: false,
      unpaidBreakMin: row?.unpaidBreakOfficeMin ?? 60,
      plannedMinutes: plannedShiftMinutes(defs.office),
    },
  };
}

const SETTINGS_RULES = {
  maxShiftsPerDay: 2,
  allowedPairs: ["one+two", "two+three"],
  warnPairs: ["one+three"],
  forbidden: ["one+two+three"],
  shiftEligible: "Faqat mudir, farmasevt, stajyor",
  office: "Ofis — smena yo‘q, belgilangan vaqt",
  branchPriority: ["substitute", "temp_one_day", "rotation", "permanent"],
} as const;

function defaultSettingsPayload() {
  return {
    settings: rowToPaySettings(undefined),
    shifts: serializeShifts(undefined),
    rules: { ...SETTINGS_RULES },
  };
}

router.get("/attendance-settings", requireAuth, async (_req, res): Promise<void> => {
  try {
    const [row] = await db
      .select()
      .from(attendancePaySettingsTable)
      .where(eq(attendancePaySettingsTable.id, 1))
      .limit(1);
    res.json({
      settings: rowToPaySettings(row),
      shifts: serializeShifts(row),
      rules: { ...SETTINGS_RULES },
    });
  } catch (err) {
    console.error("GET /attendance-settings error:", err);
    try {
      res.json(defaultSettingsPayload());
    } catch (err2) {
      console.error("GET /attendance-settings fallback error:", err2);
      res.status(200).json({
        settings: {
          unpaidBreakByShift: { one: 60, two: 0, three: 0, office: 60 },
          breakPaid: false,
          nightStartHm: "22:00",
          nightEndHm: "06:00",
          nightCoefficient: 1.5,
          dailyNormMinutes: 480,
          overtimeEnabled: true,
          graceMinutes: 15,
          minRestHoursBetweenShifts: 12,
          maxShiftsPerDay: 2,
          missingCheckoutStatus: "incomplete",
          shiftSchedule: {},
        },
        shifts: {
          pharmacyOnly: true,
          pharmacyRoles: ["mudir", "farmasevt", "stajyor"],
          officeNote: "Ofis xodimlarida smena yo‘q — faqat belgilangan ish vaqti",
          one: { start: "08:00", end: "17:00", overnight: false, unpaidBreakMin: 60, plannedMinutes: 540 },
          two: { start: "17:00", end: "23:45", overnight: false, unpaidBreakMin: 0, plannedMinutes: 405 },
          three: { start: "23:00", end: "07:00", overnight: true, unpaidBreakMin: 0, plannedMinutes: 480 },
          office: { start: "09:00", end: "18:00", overnight: false, unpaidBreakMin: 60, plannedMinutes: 540 },
        },
        rules: { ...SETTINGS_RULES },
      });
    }
  }
});

router.patch("/attendance-settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageSettings(req.userRole)) {
    res.status(403).json({ error: "Faqat admin yoki direktor sozlamani o‘zgartira oladi" });
    return;
  }
  try {
  const b = req.body ?? {};
  const [existing] = await db.select().from(attendancePaySettingsTable).where(eq(attendancePaySettingsTable.id, 1)).limit(1);

  const shiftOne = b.shiftOne || b.shifts?.one || {};
  const shiftTwo = b.shiftTwo || b.shifts?.two || {};
  const shiftThree = b.shiftThree || b.shifts?.three || {};
  const office = b.office || b.shifts?.office || {};

  const values = {
    unpaidBreakOneMin: Number(b.unpaidBreakOneMin ?? existing?.unpaidBreakOneMin ?? 60),
    unpaidBreakTwoMin: Number(b.unpaidBreakTwoMin ?? existing?.unpaidBreakTwoMin ?? 0),
    unpaidBreakThreeMin: Number(b.unpaidBreakThreeMin ?? existing?.unpaidBreakThreeMin ?? 0),
    unpaidBreakOfficeMin: Number(b.unpaidBreakOfficeMin ?? existing?.unpaidBreakOfficeMin ?? 60),
    breakPaid: Boolean(b.breakPaid ?? existing?.breakPaid ?? false),
    nightStartHm: isHm(b.nightStartHm) || existing?.nightStartHm || "22:00",
    nightEndHm: isHm(b.nightEndHm) || existing?.nightEndHm || "06:00",
    nightCoefficient: Number(b.nightCoefficient ?? existing?.nightCoefficient ?? 1.5),
    dailyNormMinutes: Number(b.dailyNormMinutes ?? existing?.dailyNormMinutes ?? 480),
    overtimeEnabled: Boolean(b.overtimeEnabled ?? existing?.overtimeEnabled ?? true),
    graceMinutes: Number(b.graceMinutes ?? existing?.graceMinutes ?? 15),
    minRestHours: Number(b.minRestHours ?? existing?.minRestHours ?? 12),
    maxShiftsPerDay: Number(b.maxShiftsPerDay ?? existing?.maxShiftsPerDay ?? 2),
    shiftOneStartHm: isHm(shiftOne.start ?? shiftOne.startHm) || existing?.shiftOneStartHm || "08:00",
    shiftOneEndHm: isHm(shiftOne.end ?? shiftOne.endHm) || existing?.shiftOneEndHm || "17:00",
    shiftTwoStartHm: isHm(shiftTwo.start ?? shiftTwo.startHm) || existing?.shiftTwoStartHm || "17:00",
    shiftTwoEndHm: isHm(shiftTwo.end ?? shiftTwo.endHm) || existing?.shiftTwoEndHm || "23:45",
    shiftThreeStartHm: isHm(shiftThree.start ?? shiftThree.startHm) || existing?.shiftThreeStartHm || "23:00",
    shiftThreeEndHm: isHm(shiftThree.end ?? shiftThree.endHm) || existing?.shiftThreeEndHm || "07:00",
    shiftThreeOvernight: Boolean(
      shiftThree.overnight ?? existing?.shiftThreeOvernight ?? true,
    ),
    officeStartHm: isHm(office.start ?? office.startHm) || existing?.officeStartHm || "09:00",
    officeEndHm: isHm(office.end ?? office.endHm) || existing?.officeEndHm || "18:00",
    updatedById: req.userId ?? null,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(attendancePaySettingsTable).set(values).where(eq(attendancePaySettingsTable.id, 1));
  } else {
    await db.insert(attendancePaySettingsTable).values({ id: 1, ...values });
  }
  invalidateShiftScheduleCache();
  await loadShiftScheduleOverrides(true);
  const [row] = await db.select().from(attendancePaySettingsTable).where(eq(attendancePaySettingsTable.id, 1)).limit(1);
  res.json({ settings: rowToPaySettings(row), shifts: serializeShifts(row) });
  } catch (err) {
    console.error("PATCH /attendance-settings error:", err);
    res.status(503).json({
      error:
        err instanceof Error
          ? err.message
          : "Smena sozlamalari saqlanmadi — jadval yaratilmagan bo‘lishi mumkin",
    });
  }
});

router.get("/employees/:id/branch-assignments", requireAuth, async (req, res): Promise<void> => {
  const employeeId = Number(req.params.id);
  if (!Number.isFinite(employeeId)) {
    res.status(400).json({ error: "Noto‘g‘ri id" });
    return;
  }
  const rows = await db
    .select()
    .from(employeeBranchAssignmentsTable)
    .where(eq(employeeBranchAssignmentsTable.employeeId, employeeId))
    .orderBy(asc(employeeBranchAssignmentsTable.validFrom));
  res.json({ assignments: rows });
});

router.post("/employees/:id/branch-assignments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canEdit(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const employeeId = Number(req.params.id);
  const kind = String(req.body?.kind || "");
  const branchId = Number(req.body?.branchId);
  const validFrom = String(req.body?.validFrom || "");
  const validTo = req.body?.validTo ? String(req.body.validTo) : null;
  if (!["substitute", "temp_one_day", "rotation", "permanent"].includes(kind)) {
    res.status(400).json({ error: "kind: substitute | temp_one_day | rotation | permanent" });
    return;
  }
  if (!Number.isFinite(employeeId) || !Number.isFinite(branchId) || !/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
    res.status(400).json({ error: "employeeId, branchId, validFrom (YYYY-MM-DD) majburiy" });
    return;
  }

  const existing = await db
    .select()
    .from(employeeBranchAssignmentsTable)
    .where(eq(employeeBranchAssignmentsTable.employeeId, employeeId));

  const newFrom = validFrom;
  const newTo = validTo || "9999-12-31";
  for (const e of existing) {
    if (e.branchId === branchId) continue;
    const eTo = e.validTo || "9999-12-31";
    if (newFrom <= eTo && (e.validFrom || "") <= newTo) {
      if (
        (kind === "temp_one_day" || kind === "substitute" || e.kind === "temp_one_day" || e.kind === "substitute") &&
        e.kind !== "permanent"
      ) {
        const day = newFrom;
        if (day >= (e.validFrom || "") && day <= eTo) {
          res.status(400).json({
            error: `Bir vaqtda ikki filialga biriktirib bo‘lmaydi (${e.branchLabel || e.branchId} va yangi)`,
          });
          return;
        }
      }
    }
  }

  const [row] = await db
    .insert(employeeBranchAssignmentsTable)
    .values({
      employeeId,
      branchId,
      branchLabel: req.body?.branchLabel ? String(req.body.branchLabel) : null,
      kind,
      validFrom,
      validTo,
      replacesEmployeeId: req.body?.replacesEmployeeId ? Number(req.body.replacesEmployeeId) : null,
      note: req.body?.note ? String(req.body.note) : null,
      createdById: req.userId ?? null,
    })
    .returning();

  res.status(201).json({ assignment: row });
});

router.get("/employees/:id/branch-on/:date", requireAuth, async (req, res): Promise<void> => {
  const employeeId = Number(req.params.id);
  const date = String(req.params.date || "");
  if (!Number.isFinite(employeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Noto‘g‘ri parametr" });
    return;
  }
  const rows = await db
    .select()
    .from(employeeBranchAssignmentsTable)
    .where(eq(employeeBranchAssignmentsTable.employeeId, employeeId));
  const mapped: BranchAssignment[] = rows.map((r) => ({
    kind: r.kind as BranchAssignment["kind"],
    branchId: r.branchId,
    branchLabel: r.branchLabel,
    validFrom: r.validFrom,
    validTo: r.validTo,
    replacesEmployeeId: r.replacesEmployeeId,
  }));
  const resolved = resolveBranchForDay(date, mapped);
  res.json({ date, resolved, assignments: rows });
});

router.put("/employees/:id/day-shifts/:date", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canEdit(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const employeeId = Number(req.params.id);
  const workDate = String(req.params.date || "");
  if (!Number.isFinite(employeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    res.status(400).json({ error: "Noto‘g‘ri parametr" });
    return;
  }
  const rawKeys = Array.isArray(req.body?.shiftKeys)
    ? (req.body.shiftKeys as string[])
    : parseShiftKeys(req.body?.shiftType || req.body?.shiftPlan);
  const shiftKeys = Array.from(new Set(rawKeys.map((k) => String(k)))) as ShiftKey[];
  const pharmacy = shiftKeys.filter((k) => k === "one" || k === "two" || k === "three");
  const check = validateShiftCombination(pharmacy);
  if (!check.ok) {
    res.status(400).json({ error: check.error, warning: check.warning });
    return;
  }

  const [existing] = await db
    .select()
    .from(employeeDayShiftPlansTable)
    .where(
      and(
        eq(employeeDayShiftPlansTable.employeeId, employeeId),
        eq(employeeDayShiftPlansTable.workDate, workDate),
      ),
    )
    .limit(1);

  let row;
  if (existing) {
    [row] = await db
      .update(employeeDayShiftPlansTable)
      .set({
        shiftKeys: pharmacy,
        note: req.body?.note ? String(req.body.note) : existing.note,
        updatedAt: new Date(),
      })
      .where(eq(employeeDayShiftPlansTable.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(employeeDayShiftPlansTable)
      .values({
        employeeId,
        workDate,
        shiftKeys: pharmacy,
        createdById: req.userId ?? null,
        note: req.body?.note ? String(req.body.note) : null,
      })
      .returning();
  }

  res.json({
    plan: row,
    encoded: encodeShiftKeys(pharmacy),
    warning: check.warning || null,
  });
});

router.get("/employees/:id/day-shifts/:date", requireAuth, async (req, res): Promise<void> => {
  const employeeId = Number(req.params.id);
  const workDate = String(req.params.date || "");
  const [row] = await db
    .select()
    .from(employeeDayShiftPlansTable)
    .where(
      and(
        eq(employeeDayShiftPlansTable.employeeId, employeeId),
        eq(employeeDayShiftPlansTable.workDate, workDate),
      ),
    )
    .limit(1);
  res.json({ plan: row || null });
});

export default router;
