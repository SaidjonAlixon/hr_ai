import { Router, type IRouter, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  attendancePaySettingsTable,
  db,
  employeeBranchAssignmentsTable,
  employeeDayShiftPlansTable,
  employeeScheduleOverridesTable,
  employeesTable,
  pool,
  usersTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { canManageSettings, canManageSmenaFilial, hasFullPlatformAccess, isHrRole } from "../lib/roles";
import {
  cachedPaySettings,
  getEffectiveShiftDefs,
  ortaShiftHours,
  saveOrtaShiftHours,
  invalidateShiftScheduleCache,
  loadShiftScheduleOverrides,
} from "../lib/shift-schedule";
import { ORTA_SHIFT_LABEL, hmToMinutes, workScheduleForStaff, type ShiftDefinition } from "../lib/shift-hours";
import {
  loadScheduleOverrides,
  normalizeHm,
  overrideShiftLabel,
  pickScheduleOverride,
  type ScheduleShiftKey,
} from "../lib/employee-schedule-override";
import { canEditKpiSettings, canManagePayroll, isWorkDay, monthBounds, workdaysBetween, eachDate } from "../lib/kpi-payroll";
import { loadStaffFromUsers } from "../lib/staff-directory";
import { displayBranchName } from "../lib/geo-location";
import { DEFAULT_PAY_SETTINGS, encodeShiftKeys, parseShiftKeys, validateShiftCombination, type ShiftKey } from "../lib/attendance-engine";
import { notifyUser } from "../lib/notify";
import {
  MAIN_SCOPES,
  SWAP_SELECT,
  WEEKDAY_LABELS,
  ensureWorkCalendarSchema,
  invalidateWorkCalendar,
  isPayrollCalendarScope,
  loadWorkCalendar,
  normalizeRestWeekdays,
  payrollCalendarScope,
  rowToRule,
  rowToSwap,
  ruleOn,
  scopeCalendar,
  scopeLabel,
  swapOn,
  todayTashkentYmd,
  type RestRule,
  type SwapPayTo,
} from "../lib/work-calendar";

const router: IRouter = Router();

function canViewSchedule(role?: string | null) {
  return canManagePayroll(role) || canManageSmenaFilial(role) || hasFullPlatformAccess(role) || isHrRole(role);
}
function canEditSchedule(role?: string | null) {
  return canEditKpiSettings(role) || isHrRole(role) || hasFullPlatformAccess(role);
}
function canCreateSwap(role?: string | null) {
  return canEditSchedule(role) || canManageSmenaFilial(role);
}
/** Almashuv kunining puli kimga yozilishini admin, moliyachi, HR va kadrlar hal qiladi */
function canDecideSwap(role?: string | null) {
  return canManagePayroll(role) || isHrRole(role) || hasFullPlatformAccess(role);
}

function deny(res: Response, text: string) {
  res.status(403).json({ error: text });
}

const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const SHIFT_STAFF_ROLES = new Set(["mudir", "farmasevt", "stajyor", "stajor"]);
const SHIFT_STAFF_ORGS = new Set(["manager", "pharmacist", "intern"]);
const isShiftStaff = (row: { userRole?: string | null; orgRole?: string | null }) =>
  SHIFT_STAFF_ROLES.has(String(row.userRole || "").toLowerCase()) || SHIFT_STAFF_ORGS.has(String(row.orgRole || "").toLowerCase());

function isRealPerson(row: { fullName: string; employmentStatus: string | null }) {
  const st = String(row.employmentStatus || "").toLowerCase();
  if (st === "need_hire" || st === "no_manager" || st === "closed" || st === "dismissed" || st === "searching") return false;
  return !/xodim kerak/i.test(row.fullName || "");
}

export type ScopeHours = {
  start: string;
  end: string;
  overnight: boolean;
  /** base — o‘zi sozlanadi; derived — 1+2 / 2+3 boshqa smenalardan; orta — alohida */
  kind: "base" | "derived" | "orta";
  /** O‘rta smena: admin alohida vaqt qo‘yganmi (yo‘q bo‘lsa 1-smena vaqti) */
  custom: boolean;
  from: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
  /** To‘lanmaydigan tushlik (daq) — ish vaqtidan ayiriladi */
  breakMin: number;
  /** Tushlikni shu smena uchun alohida o‘zgartirish mumkinmi (1/2/3-smena, ofis) */
  breakEditable: boolean;
};

function hoursOf(
  def: Pick<ShiftDefinition, "startHm" | "endHm">,
  kind: ScopeHours["kind"] = "base",
  breakMin = 0,
  breakEditable = false,
): ScopeHours {
  return {
    start: def.startHm,
    end: def.endHm,
    overnight: hmToMinutes(def.endHm) <= hmToMinutes(def.startHm),
    kind,
    custom: false,
    from: null,
    updatedByName: null,
    updatedAt: null,
    breakMin,
    breakEditable,
  };
}

async function scopeHoursMap(): Promise<Record<string, ScopeHours>> {
  const defs = await getEffectiveShiftDefs();
  const orta = ortaShiftHours();
  const brk = { ...DEFAULT_PAY_SETTINGS.unpaidBreakByShift, ...cachedPaySettings()?.unpaidBreakByShift };
  const b = (k: ShiftKey) => Number(brk[k] ?? 0);
  return {
    "dorixona:1": hoursOf(defs.one, "base", b("one"), true),
    "dorixona:2": hoursOf(defs.two, "base", b("two"), true),
    "dorixona:3": hoursOf(defs.three, "base", b("three"), true),
    "dorixona:12": { ...hoursOf({ startHm: defs.one.startHm, endHm: defs.two.endHm }, "derived", b("one") + b("two")), from: "1-smena boshi → 2-smena oxiri" },
    "dorixona:23": { ...hoursOf({ startHm: defs.two.startHm, endHm: defs.three.endHm }, "derived", b("two") + b("three")), from: "2-smena boshi → 3-smena oxiri" },
    "dorixona:orta": {
      ...hoursOf({ startHm: orta?.start || defs.one.startHm, endHm: orta?.end || defs.one.endHm }, "orta", b("one")),
      custom: Boolean(orta),
      from: orta ? null : "1-smena vaqti",
      updatedByName: orta?.updatedByName ?? null,
      updatedAt: orta?.updatedAt ?? null,
    },
    "dorixona:office": { ...hoursOf(defs.office, "derived", b("office")), from: "Ofis vaqti" },
    "dorixona:other": { ...hoursOf(defs.one, "derived", b("one")), from: "1-smena vaqti" },
    ofis: hoursOf(defs.office, "base", b("office"), true),
  };
}

function rulePayload(rule: RestRule | null) {
  if (!rule) return null;
  return {
    ...rule,
    restLabels: rule.restWeekdays.map((d) => WEEKDAY_LABELS[d]),
  };
}

async function scopePayload(scope: string, month: string, staffCount: number) {
  const snap = await loadWorkCalendar();
  const cal = scopeCalendar(snap.calendars, scope);
  const rules = (snap.calendars.get(scope)?.rules ?? []) as RestRule[];
  const today = todayTashkentYmd();
  const { from, to } = monthBounds(month);
  const days = eachDate(from, to);
  const work = workdaysBetween(from, to, cal);
  const workSet = new Set(work);
  const overrides = days.filter((d) => cal.has(d)).map((d) => ({ day: d, isWork: cal.get(d)! }));
  const current = ruleOn(rules, today);
  const upcoming = rules.filter((r) => r.effectiveFrom > today);
  return {
    scope,
    label: scopeLabel(scope),
    staffCount,
    rule: rulePayload(current),
    upcoming: upcoming.map(rulePayload),
    history: rules.map(rulePayload).reverse(),
    legacy: !current,
    month: {
      month,
      workDays: work,
      restDays: days.filter((d) => !workSet.has(d)),
      overrides,
      total: days.length,
    },
  };
}

async function staffScopeCounts() {
  const staff = await loadStaffFromUsers("active", { skipFacePhotos: true });
  const counts = new Map<string, number>();
  for (const row of staff) {
    if (!isRealPerson(row)) continue;
    const scope = payrollCalendarScope(row);
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  return counts;
}

router.get("/work-calendar", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewSchedule(req.userRole)) return deny(res, "Ish jadvalini ko‘rish ruxsati yo‘q");
  try {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month) : todayTashkentYmd().slice(0, 7);
    await ensureWorkCalendarSchema();
    const counts = await staffScopeCounts();
    const scopes = new Set<string>(MAIN_SCOPES);
    for (const [scope, n] of counts) if (n > 0 && scope.startsWith("dorixona:")) scopes.add(scope);
    const items = [];
    const hours = await scopeHoursMap();
    for (const scope of scopes) {
      items.push({ ...(await scopePayload(scope, month, counts.get(scope) ?? 0)), hours: hours[scope] ?? null });
    }
    const snap = await loadWorkCalendar();
    res.json({
      month,
      today: todayTashkentYmd(),
      scopes: items,
      swaps: snap.swaps.filter((s) => s.workDate.startsWith(`${month}-`)),
      canEdit: canEditSchedule(req.userRole),
      canSwap: canCreateSwap(req.userRole),
      canDecide: canDecideSwap(req.userRole),
      canEditHours: canManageSettings(req.userRole),
      graceMinutes: cachedPaySettings()?.graceMinutes ?? DEFAULT_PAY_SETTINGS.graceMinutes,
    });
  } catch (err) {
    console.error("GET /work-calendar", err);
    res.status(503).json({ error: "Ish jadvali yuklanmadi" });
  }
});

router.put("/work-calendar/rule", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canEditSchedule(req.userRole)) return deny(res, "Ish jadvalini admin, HR yoki moliyachi o‘zgartiradi");
  const scope = String(req.body?.scope || "").slice(0, 40);
  if (!isPayrollCalendarScope(scope) || scope === "xavfsizlik") {
    res.status(400).json({ error: "Smena noto‘g‘ri" });
    return;
  }
  const restWeekdays = normalizeRestWeekdays(req.body?.restWeekdays);
  if (restWeekdays.length > 6) {
    res.status(400).json({ error: "Haftada kamida bitta ish kuni bo‘lishi kerak" });
    return;
  }
  const today = todayTashkentYmd();
  const effectiveFrom = isYmd(req.body?.effectiveFrom) ? req.body.effectiveFrom : today;
  if (effectiveFrom < `${today.slice(0, 7)}-01`) {
    res.status(400).json({ error: "O‘tgan oylar uchun jadvalni o‘zgartirib bo‘lmaydi" });
    return;
  }
  try {
    await ensureWorkCalendarSchema();
    const [me] = await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    const note = req.body?.note ? String(req.body.note).slice(0, 200) : null;
    await pool.query(
      `INSERT INTO work_calendar_rules (scope, rest_weekdays, effective_from, note, updated_by_id, updated_by_name, updated_at)
       VALUES ($1, $2::int[], $3, $4, $5, $6, NOW())
       ON CONFLICT (scope, effective_from) DO UPDATE SET
         rest_weekdays = EXCLUDED.rest_weekdays,
         note = EXCLUDED.note,
         updated_by_id = EXCLUDED.updated_by_id,
         updated_by_name = EXCLUDED.updated_by_name,
         updated_at = NOW()`,
      [scope, restWeekdays, effectiveFrom, note, req.userId!, me?.fullName || null],
    );
    invalidateWorkCalendar();
    await loadWorkCalendar(true);
    const month = isYmd(req.body?.month) ? String(req.body.month).slice(0, 7) : String(req.body?.month || effectiveFrom).slice(0, 7);
    const counts = await staffScopeCounts();
    const hours = await scopeHoursMap();
    res.json({ ok: true, scope: { ...(await scopePayload(scope, month, counts.get(scope) ?? 0)), hours: hours[scope] ?? null } });
  } catch (err) {
    console.error("PUT /work-calendar/rule", err);
    res.status(503).json({ error: "Jadval saqlanmadi" });
  }
});

router.delete("/work-calendar/rule/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canEditSchedule(req.userRole)) return deny(res, "Ish jadvalini admin, HR yoki moliyachi o‘zgartiradi");
  const id = Number(req.params.id);
  try {
    await ensureWorkCalendarSchema();
    const { rows } = await pool.query(`SELECT * FROM work_calendar_rules WHERE id = $1`, [id]);
    const rule = rows[0] ? rowToRule(rows[0]) : null;
    if (!rule) {
      res.status(404).json({ error: "Qoida topilmadi" });
      return;
    }
    if (rule.effectiveFrom <= todayTashkentYmd()) {
      res.status(400).json({ error: "Amaldagi qoidani o‘chirib bo‘lmaydi — yangi qoida qo‘ying" });
      return;
    }
    await pool.query(`DELETE FROM work_calendar_rules WHERE id = $1`, [id]);
    invalidateWorkCalendar();
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /work-calendar/rule", err);
    res.status(503).json({ error: "Qoida o‘chirilmadi" });
  }
});

const HOURS_COLUMNS: Record<
  string,
  {
    start: "shiftOneStartHm" | "shiftTwoStartHm" | "shiftThreeStartHm" | "officeStartHm";
    end: "shiftOneEndHm" | "shiftTwoEndHm" | "shiftThreeEndHm" | "officeEndHm";
    brk: "unpaidBreakOneMin" | "unpaidBreakTwoMin" | "unpaidBreakThreeMin" | "unpaidBreakOfficeMin";
  }
> = {
  "dorixona:1": { start: "shiftOneStartHm", end: "shiftOneEndHm", brk: "unpaidBreakOneMin" },
  "dorixona:2": { start: "shiftTwoStartHm", end: "shiftTwoEndHm", brk: "unpaidBreakTwoMin" },
  "dorixona:3": { start: "shiftThreeStartHm", end: "shiftThreeEndHm", brk: "unpaidBreakThreeMin" },
  ofis: { start: "officeStartHm", end: "officeEndHm", brk: "unpaidBreakOfficeMin" },
};

async function upsertPaySettings(values: Partial<typeof attendancePaySettingsTable.$inferInsert>) {
  const [existing] = await db
    .select({ id: attendancePaySettingsTable.id })
    .from(attendancePaySettingsTable)
    .where(eq(attendancePaySettingsTable.id, 1))
    .limit(1);
  if (existing) {
    await db.update(attendancePaySettingsTable).set(values).where(eq(attendancePaySettingsTable.id, 1));
  } else {
    await db.insert(attendancePaySettingsTable).values({ id: 1, ...values });
  }
  invalidateShiftScheduleCache();
  await loadShiftScheduleOverrides(true);
}

/** Kechikish chegarasi (daq) — barcha smena va ofis uchun umumiy */
router.put("/work-calendar/grace", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageSettings(req.userRole)) return deny(res, "Kechikish chegarasini faqat admin yoki direktor o‘zgartiradi");
  const graceMinutes = Number(req.body?.graceMinutes);
  if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 120) {
    res.status(400).json({ error: "Kechikish 0 dan 120 daqiqagacha bo‘lsin" });
    return;
  }
  try {
    await upsertPaySettings({ graceMinutes, updatedById: req.userId ?? null, updatedAt: new Date() });
    res.json({ ok: true, graceMinutes });
  } catch (err) {
    console.error("PUT /work-calendar/grace", err);
    res.status(503).json({ error: "Kechikish chegarasi saqlanmadi" });
  }
});

/** Smena vaqti: 1/2/3-smena va ofis — davomat sozlamasida; O‘rta smena — alohida (istalgan soat) */
router.put("/work-calendar/hours", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageSettings(req.userRole)) return deny(res, "Smena vaqtini faqat admin yoki direktor o‘zgartiradi");
  const scope = String(req.body?.scope || "");
  const reset = req.body?.reset === true;
  const start = normalizeHm(String(req.body?.start || ""));
  const end = normalizeHm(String(req.body?.end || ""));
  if (!reset && (!start || !end)) {
    res.status(400).json({ error: "Boshlanish va tugash vaqtini HH:MM ko‘rinishida kiriting" });
    return;
  }
  if (!reset && start === end) {
    res.status(400).json({ error: "Boshlanish va tugash bir xil bo‘lmasin" });
    return;
  }
  const rawBreak = req.body?.breakMin;
  const breakMin = rawBreak == null || rawBreak === "" ? null : Number(rawBreak);
  if (breakMin != null && (!Number.isInteger(breakMin) || breakMin < 0 || breakMin > 240)) {
    res.status(400).json({ error: "Tushlik 0 dan 240 daqiqagacha bo‘lsin" });
    return;
  }
  if (!reset && breakMin != null && start && end) {
    const span = (hmToMinutes(end) - hmToMinutes(start) + 1440) % 1440;
    if (breakMin >= span) {
      res.status(400).json({ error: "Tushlik smena davomiyligidan kam bo‘lishi kerak" });
      return;
    }
  }
  try {
    const name = await actorName(req.userId!);
    if (scope === "dorixona:orta") {
      await saveOrtaShiftHours(reset ? null : { start: start!, end: end! }, { id: req.userId ?? null, name });
    } else {
      const cols = HOURS_COLUMNS[scope];
      if (!cols || reset) {
        res.status(400).json({
          error:
            scope === "dorixona:12" || scope === "dorixona:23"
              ? "Juft smena vaqti 1, 2 va 3-smena vaqtidan olinadi — o‘shalarni o‘zgartiring"
              : "Bu smena vaqtini bu yerda o‘zgartirib bo‘lmaydi",
        });
        return;
      }
      const overnight = hmToMinutes(end!) <= hmToMinutes(start!);
      if (overnight && scope !== "dorixona:3") {
        res.status(400).json({ error: "Bu smena bir kun ichida tugashi kerak (tugash boshlanishdan keyin bo‘lsin)" });
        return;
      }
      await upsertPaySettings({
        [cols.start]: start!,
        [cols.end]: end!,
        ...(breakMin != null ? { [cols.brk]: breakMin } : {}),
        ...(scope === "dorixona:3" ? { shiftThreeOvernight: overnight } : {}),
        updatedById: req.userId ?? null,
        updatedAt: new Date(),
      });
    }
    res.json({ ok: true, hours: await scopeHoursMap() });
  } catch (err) {
    console.error("PUT /work-calendar/hours", err);
    res.status(503).json({ error: "Smena vaqti saqlanmadi" });
  }
});

function overrideKeyFor(scope: string, start: string, end: string): ScheduleShiftKey {
  if (hmToMinutes(end) <= hmToMinutes(start)) return "three";
  if (scope === "ofis" || scope === "dorixona:office") return "office";
  return hmToMinutes(end) >= 20 * 60 ? "two" : "one";
}

/** Shu smenadagi xodimlar va har birining amaldagi vaqti (shaxsiy vaqt bo‘lsa — o‘sha) */
router.get("/work-calendar/scope-staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewSchedule(req.userRole)) return deny(res, "Ruxsat yo‘q");
  const scope = String(req.query.scope || "");
  if (!isPayrollCalendarScope(scope)) {
    res.status(400).json({ error: "Smena noto‘g‘ri" });
    return;
  }
  try {
    const today = todayTashkentYmd();
    const defs = await getEffectiveShiftDefs();
    const staff = await loadStaffFromUsers("active", { skipFacePhotos: true });
    const rows = staff.filter((row) => isRealPerson(row) && payrollCalendarScope(row) === scope);
    const overrides = await loadScheduleOverrides(rows.map((r) => r.id), today, today);
    const items = rows
      .map((row) => {
        const base = workScheduleForStaff(row.userRole, row.orgRole, row.shiftType, row.shiftLabel, defs);
        const ov = pickScheduleOverride(overrides.get(row.id), today);
        return {
          id: row.id,
          fullName: row.fullName,
          position: row.position || "",
          branch: displayBranchName(row.location) || "",
          shiftLabel: row.shiftLabel || base.label,
          start: ov ? ov.startHm : base.start,
          end: ov ? ov.endHm : base.end,
          overnight: ov ? hmToMinutes(ov.endHm) <= hmToMinutes(ov.startHm) : Boolean(base.overnight),
          override: ov
            ? {
                id: ov.id,
                label: overrideShiftLabel(ov),
                mode: ov.mode,
                validFrom: ov.validFrom,
                validTo: ov.validTo,
                note: ov.note,
              }
            : null,
        };
      })
      .sort((a, b) => Number(Boolean(b.override)) - Number(Boolean(a.override)) || a.fullName.localeCompare(b.fullName, "uz"));
    res.json({ scope, items, canEditHours: canManageSettings(req.userRole) });
  } catch (err) {
    console.error("GET /work-calendar/scope-staff", err);
    res.status(503).json({ error: "Xodimlar yuklanmadi" });
  }
});

/** Xodimga shaxsiy kelish-ketish vaqti (doimiy yoki muddatli). Davomat, jarima va Keldim/Ketdim shu vaqtdan. */
router.put("/work-calendar/staff-hours", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageSettings(req.userRole)) return deny(res, "Shaxsiy vaqtni faqat admin yoki direktor belgilaydi");
  const employeeId = Number(req.body?.employeeId);
  const scope = String(req.body?.scope || "");
  const start = normalizeHm(String(req.body?.start || ""));
  const end = normalizeHm(String(req.body?.end || ""));
  const today = todayTashkentYmd();
  const validFrom = isYmd(req.body?.validFrom) ? req.body.validFrom : today;
  const validTo = isYmd(req.body?.validTo) ? req.body.validTo : null;
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 160) : "";
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    res.status(400).json({ error: "Xodim tanlanmagan" });
    return;
  }
  if (!start || !end || start === end) {
    res.status(400).json({ error: "Kelish va ketish vaqtini to‘g‘ri kiriting" });
    return;
  }
  if (validTo && validTo < validFrom) {
    res.status(400).json({ error: "Tugash sanasi boshlanishdan oldin bo‘lmasin" });
    return;
  }
  try {
    const cards = await loadCards([employeeId]);
    const emp = cards.get(employeeId);
    if (!emp) {
      res.status(404).json({ error: "Xodim topilmadi" });
      return;
    }
    const orta = scope === "dorixona:orta";
    const fullNote = orta ? [ORTA_SHIFT_LABEL, note].filter(Boolean).join(" · ") : note || null;
    if (!validTo) {
      await db
        .update(employeeScheduleOverridesTable)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(employeeScheduleOverridesTable.employeeId, employeeId),
            eq(employeeScheduleOverridesTable.mode, "permanent"),
            eq(employeeScheduleOverridesTable.active, true),
          ),
        );
    }
    const [saved] = await db
      .insert(employeeScheduleOverridesTable)
      .values({
        employeeId,
        mode: validTo ? "period" : "permanent",
        validFrom,
        validTo,
        shiftKey: overrideKeyFor(scope, start, end),
        startHm: start,
        endHm: end,
        note: fullNote,
        active: true,
        createdById: req.userId!,
      })
      .returning({ id: employeeScheduleOverridesTable.id });
    if (emp.userId) {
      const range = `${start}–${end}`;
      await notifyUser({
        userId: emp.userId,
        text: `Ish vaqtingiz o‘zgardi: ${range}${validTo ? ` (${validFrom} — ${validTo})` : ` (${validFrom} dan)`}. Davomat shu vaqt bo‘yicha hisoblanadi.`,
        type: "smena_hours",
        linkUrl: "/davomat-face",
      }).catch(() => undefined);
    }
    res.json({ ok: true, id: saved?.id });
  } catch (err) {
    console.error("PUT /work-calendar/staff-hours", err);
    res.status(503).json({ error: "Shaxsiy vaqt saqlanmadi" });
  }
});

/** Shaxsiy vaqtni olib tashlash — xodim yana smenaning umumiy vaqtiga qaytadi */
router.delete("/work-calendar/staff-hours/:employeeId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageSettings(req.userRole)) return deny(res, "Shaxsiy vaqtni faqat admin yoki direktor bekor qiladi");
  const employeeId = Number(req.params.employeeId);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    res.status(400).json({ error: "Xodim tanlanmagan" });
    return;
  }
  try {
    await db
      .update(employeeScheduleOverridesTable)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(employeeScheduleOverridesTable.employeeId, employeeId), eq(employeeScheduleOverridesTable.active, true)));
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /work-calendar/staff-hours", err);
    res.status(503).json({ error: "Shaxsiy vaqt bekor qilinmadi" });
  }
});

/** Almashuv uchun xodim tanlash — faqat dorixona smena xodimlari */
router.get("/work-calendar/staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canCreateSwap(req.userRole)) return deny(res, "Ruxsat yo‘q");
  try {
    const staff = await loadStaffFromUsers("active", { skipFacePhotos: true });
    const items = staff
      .filter((row) => isRealPerson(row) && isShiftStaff(row))
      .map((row) => {
        const scope = payrollCalendarScope(row);
        return {
          id: row.id,
          fullName: row.fullName,
          position: row.position || "",
          branch: displayBranchName(row.location) || "",
          scope,
          shift: scopeLabel(scope),
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));
    res.json({ items });
  } catch (err) {
    console.error("GET /work-calendar/staff", err);
    res.status(503).json({ error: "Xodimlar yuklanmadi" });
  }
});

type EmpCard = {
  id: number;
  userId: number | null;
  fullName: string;
  userRole: string | null;
  orgRole: string | null;
  position: string | null;
  location: string | null;
  shiftType: string | null;
  shiftLabel: string | null;
  assignedBranchId: number | null;
  employmentStatus: string | null;
};

async function loadCards(ids: number[]): Promise<Map<number, EmpCard>> {
  const rows = await db
    .select({
      id: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
      userRole: usersTable.role,
      orgRole: employeesTable.orgRole,
      position: employeesTable.position,
      location: employeesTable.location,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      assignedBranchId: employeesTable.assignedBranchId,
      employmentStatus: employeesTable.employmentStatus,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .where(inArray(employeesTable.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

const branchOf = (e: EmpCard) => (String(e.orgRole || "").toLowerCase() === "manager" ? e.id : e.assignedBranchId);
const pharmacyKeys = (e: EmpCard) =>
  parseShiftKeys(e.shiftType, e.shiftLabel).filter((k): k is ShiftKey => k === "one" || k === "two" || k === "three");

async function actorName(userId: number) {
  const [me] = await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return me?.fullName || null;
}

router.post("/work-calendar/swaps", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canCreateSwap(req.userRole)) return deny(res, "Almashuvni admin, HR yoki smena mas’uli qo‘shadi");
  const workDate = req.body?.workDate;
  const employeeId = Number(req.body?.employeeId);
  const replacementId = Number(req.body?.replacementEmployeeId);
  const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 300) : null;
  const payToRaw = req.body?.payTo;
  const payTo: SwapPayTo | null = payToRaw === "replacement" || payToRaw === "self" ? payToRaw : null;
  const today = todayTashkentYmd();
  if (!isYmd(workDate)) {
    res.status(400).json({ error: "Sana noto‘g‘ri" });
    return;
  }
  if (workDate < `${today.slice(0, 7)}-01` || workDate > addDays(today, 62)) {
    res.status(400).json({ error: "Almashuv sanasi shu oy boshidan 2 oy oldinga qadar bo‘lishi mumkin" });
    return;
  }
  if (!Number.isFinite(employeeId) || !Number.isFinite(replacementId) || employeeId === replacementId) {
    res.status(400).json({ error: "Dam oladigan va o‘rniga chiqadigan xodim boshqa-boshqa bo‘lishi kerak" });
    return;
  }
  try {
    await ensureWorkCalendarSchema();
    const cards = await loadCards([employeeId, replacementId]);
    const resting = cards.get(employeeId);
    const replacing = cards.get(replacementId);
    if (!resting || !replacing || !isRealPerson(resting) || !isRealPerson(replacing)) {
      res.status(404).json({ error: "Xodim topilmadi" });
      return;
    }
    if (!isShiftStaff(resting) || !isShiftStaff(replacing)) {
      res.status(400).json({ error: "Almashuv faqat dorixona smena xodimlari orasida" });
      return;
    }
    await loadWorkCalendar(true);
    const clashA = swapOn(employeeId, workDate);
    const clashB = swapOn(replacementId, workDate);
    if (clashA) {
      res.status(409).json({ error: `${resting.fullName} shu kuni allaqachon almashuvda` });
      return;
    }
    if (clashB) {
      res.status(409).json({ error: `${replacing.fullName} shu kuni allaqachon almashuvda` });
      return;
    }

    let assignmentId: number | null = null;
    const restBranch = branchOf(resting);
    const replBranch = branchOf(replacing);
    if (restBranch && restBranch !== replBranch) {
      const [existing] = await db
        .select({ id: employeeBranchAssignmentsTable.id })
        .from(employeeBranchAssignmentsTable)
        .where(
          and(
            eq(employeeBranchAssignmentsTable.employeeId, replacementId),
            eq(employeeBranchAssignmentsTable.kind, "temp_one_day"),
            eq(employeeBranchAssignmentsTable.validFrom, workDate),
          ),
        )
        .limit(1);
      if (!existing) {
        const branchCards = await loadCards([restBranch]);
        const branch = branchCards.get(restBranch);
        const branchLabel = displayBranchName(branch?.location) || branch?.fullName || resting.location || "";
        const [row] = await db
          .insert(employeeBranchAssignmentsTable)
          .values({
            employeeId: replacementId,
            branchId: restBranch,
            branchLabel,
            kind: "temp_one_day",
            validFrom: workDate,
            validTo: workDate,
            note: `Almashuv · ${resting.fullName} o‘rniga`,
            createdById: req.userId ?? null,
          })
          .returning({ id: employeeBranchAssignmentsTable.id });
        assignmentId = row?.id ?? null;
      }
    }

    const restKeys = pharmacyKeys(resting);
    let dayPlanId: number | null = null;
    let prevPlanKeys: string[] | null = null;
    if (restKeys.length) {
      const [plan] = await db
        .select()
        .from(employeeDayShiftPlansTable)
        .where(and(eq(employeeDayShiftPlansTable.employeeId, replacementId), eq(employeeDayShiftPlansTable.workDate, workDate)))
        .limit(1);
      const snap = await loadWorkCalendar();
      const replScope = payrollCalendarScope(replacing);
      const replWorks = isWorkDay(workDate, scopeCalendar(snap.calendars, replScope));
      const ownKeys = plan?.shiftKeys?.length
        ? (plan.shiftKeys as string[]).filter((k): k is ShiftKey => k === "one" || k === "two" || k === "three")
        : replWorks
          ? pharmacyKeys(replacing)
          : [];
      const union = [...new Set<ShiftKey>([...ownKeys, ...restKeys])];
      const keys = union.length > restKeys.length && validateShiftCombination(union).ok ? union : restKeys;
      const encoded = parseShiftKeys(encodeShiftKeys(keys));
      if (plan) {
        prevPlanKeys = (plan.shiftKeys as string[]) || [];
        await db
          .update(employeeDayShiftPlansTable)
          .set({ shiftKeys: encoded, note: `Almashuv · ${resting.fullName} o‘rniga`, updatedAt: new Date() })
          .where(eq(employeeDayShiftPlansTable.id, plan.id));
        dayPlanId = plan.id;
      } else {
        const [row] = await db
          .insert(employeeDayShiftPlansTable)
          .values({
            employeeId: replacementId,
            workDate,
            shiftKeys: encoded,
            createdById: req.userId ?? null,
            note: `Almashuv · ${resting.fullName} o‘rniga`,
          })
          .returning({ id: employeeDayShiftPlansTable.id });
        dayPlanId = row?.id ?? null;
      }
    }

    const name = await actorName(req.userId!);
    const decide = payTo && canDecideSwap(req.userRole);
    const { rows } = await pool.query(
      `INSERT INTO shift_day_swaps
         (work_date, employee_id, replacement_employee_id, reason, pay_to, decided_by_id, decided_by_name, decided_at,
          assignment_id, day_plan_id, prev_plan_keys, created_by_id, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        workDate,
        employeeId,
        replacementId,
        reason,
        decide ? payTo : null,
        decide ? req.userId : null,
        decide ? name : null,
        decide ? new Date() : null,
        assignmentId,
        dayPlanId,
        prevPlanKeys ? JSON.stringify(prevPlanKeys) : null,
        req.userId ?? null,
        name,
      ],
    );
    invalidateWorkCalendar();

    const dateText = workDate.split("-").reverse().join(".");
    if (resting.userId) {
      await notifyUser({
        userId: resting.userId,
        text: `${dateText} — dam kuningiz. O‘rningizga ${replacing.fullName} chiqadi. Davomatda jarima yozilmaydi.`,
        type: "smena_swap",
        linkUrl: "/davomat-face",
      }).catch(() => undefined);
    }
    if (replacing.userId) {
      await notifyUser({
        userId: replacing.userId,
        text: `${dateText} — ${resting.fullName} o‘rniga ishga chiqasiz. Shu kuni davomat belgilang.`,
        type: "smena_swap",
        linkUrl: "/davomat-face",
      }).catch(() => undefined);
    }
    res.status(201).json({ ok: true, id: rows[0]?.id });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      res.status(409).json({ error: "Bu xodim shu kuni allaqachon almashuvda" });
      return;
    }
    console.error("POST /work-calendar/swaps", err);
    res.status(503).json({ error: "Almashuv saqlanmadi" });
  }
});

router.post("/work-calendar/swaps/:id/decide", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canDecideSwap(req.userRole)) return deny(res, "Kun haqini admin, moliyachi yoki HR hal qiladi");
  const id = Number(req.params.id);
  const payTo = req.body?.payTo;
  if (payTo !== "replacement" && payTo !== "self") {
    res.status(400).json({ error: "Kimga yozilishini tanlang" });
    return;
  }
  try {
    await ensureWorkCalendarSchema();
    const name = await actorName(req.userId!);
    const { rowCount } = await pool.query(
      `UPDATE shift_day_swaps SET pay_to = $2, decided_by_id = $3, decided_by_name = $4, decided_at = NOW()
        WHERE id = $1 AND cancelled_at IS NULL`,
      [id, payTo, req.userId!, name],
    );
    if (!rowCount) {
      res.status(404).json({ error: "Almashuv topilmadi" });
      return;
    }
    invalidateWorkCalendar();
    const { rows } = await pool.query(`${SWAP_SELECT} WHERE s.id = $1`, [id]);
    res.json({ ok: true, swap: rows[0] ? rowToSwap(rows[0]) : null });
  } catch (err) {
    console.error("POST /work-calendar/swaps/:id/decide", err);
    res.status(503).json({ error: "Qaror saqlanmadi" });
  }
});

router.delete("/work-calendar/swaps/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canCreateSwap(req.userRole)) return deny(res, "Ruxsat yo‘q");
  const id = Number(req.params.id);
  try {
    await ensureWorkCalendarSchema();
    const { rows } = await pool.query(
      `UPDATE shift_day_swaps SET cancelled_at = NOW() WHERE id = $1 AND cancelled_at IS NULL
       RETURNING assignment_id, day_plan_id, prev_plan_keys`,
      [id],
    );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "Almashuv topilmadi" });
      return;
    }
    if (row.assignment_id) {
      await db.delete(employeeBranchAssignmentsTable).where(eq(employeeBranchAssignmentsTable.id, Number(row.assignment_id)));
    }
    if (row.day_plan_id) {
      const prev = Array.isArray(row.prev_plan_keys) ? (row.prev_plan_keys as string[]) : null;
      if (prev) {
        await db
          .update(employeeDayShiftPlansTable)
          .set({ shiftKeys: prev, updatedAt: new Date() })
          .where(eq(employeeDayShiftPlansTable.id, Number(row.day_plan_id)));
      } else {
        await db.delete(employeeDayShiftPlansTable).where(eq(employeeDayShiftPlansTable.id, Number(row.day_plan_id)));
      }
    }
    invalidateWorkCalendar();
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /work-calendar/swaps/:id", err);
    res.status(503).json({ error: "Almashuv bekor qilinmadi" });
  }
});

export default router;
