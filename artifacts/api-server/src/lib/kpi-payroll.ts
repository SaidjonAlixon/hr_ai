import { isDirectorRole } from "./roles";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import {
  db,
  attendanceRecordsTable,
  branchAuditsTable,
  employeesTable,
  workCalendarDaysTable,
  kpiSettingsTable,
  payrollDaysTable,
  payrollMonthsTable,
  tasksTable,
  usersTable,
} from "@workspace/db";
import { displayBranchName } from "./geo-location";
import { isPharmacyStaffRow, loadStaffFromUsers } from "./staff-directory";
import { scriptIncludes } from "./script-search";
import { applyAttendanceJarima, JARIMA_RULE, JARIMA_START, salaryShareOnDates } from "./attendance-jarima";

export type KpiWeights = {
  attendance: number;
  tasks: number;
  checklist: number;
  workStartHm: string;
};

export type AttendanceDayDetail = {
  date: string;
  status: string;
  lateMinutes: number | null;
  counted: boolean;
  points: number;
  note: string;
};

export type TaskDetail = {
  id: number;
  title: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  points: number;
  label: string;
};

export type ChecklistDetail = {
  id: number;
  visitDate: string;
  visitName: string;
  percent: number;
  yesCount: number;
  totalCount: number;
};

export type PayrollCompute = {
  userId: number;
  employeeId: number | null;
  month: string;
  monthLabel: string;
  from: string;
  to: string;
  fullName: string;
  role: string;
  roleLabel: string;
  position: string | null;
  branch: string | null;
  fixedSalary: number;
  bonusPercent: number;
  attendance: {
    available: boolean;
    complete: boolean;
    percent: number;
    baseWeight: number;
    effectiveWeight: number;
    points: number;
    countedDays: number;
    expectedDays: number;
    closedDays: number;
    days: AttendanceDayDetail[];
  };
  tasks: {
    available: boolean;
    percent: number;
    baseWeight: number;
    effectiveWeight: number;
    points: number;
    total: number;
    items: TaskDetail[];
  };
  checklist: {
    available: boolean;
    percent: number;
    baseWeight: number;
    effectiveWeight: number;
    items: ChecklistDetail[];
  };
  kpiPercent: number;
  maxBonus: number;
  bonusAmount: number;
  totalAmount: number;
};

const MONTH_NAMES = [
  "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
  "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr",
];

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  director: "Direktor",
  moliya: "Moliyachi",
  hr: "HR",
  hr_direktor: "HR Direktor",
  hr_kadr_rahbar: "HR kadr b/m",
  hr_menejer: "HR Menejer",
  hr_auditor: "HR Auditor",
  recruiter: "Rekruter",
  trainer: "Trener",
  mentor: "Mentor",
  department_head: "Bo‘lim boshlig‘i",
  mudir: "Mudir",
  koordinator: "Koordinator",
  texnik: "Texnik",
  texnik_rahbar: "Texnik bo‘limi rahbari",
  it: "AyTi mutaxassisi",
  it_rahbar: "AyTi bo‘lim boshlig‘i",
  it_dasturchi: "Dasturchi",
  it_tarmoq: "Tarmoq administratori",
  ombor: "Omborxona xodimi",
  ombor_rahbar: "Omborxona bo‘lim boshlig‘i",
  sb: "SB operatori",
  sb_boshliq: "SB bo‘limi boshlig‘i",
  farmasevt: "Farmasevt",
  stajyor: "Stajyor",
  moliya_rahbar: "Moliya bo‘lim boshlig‘i",
  moliya_xodim: "Moliya xodimi",
  taminot_rahbar: "Ta’minot bo‘lim boshlig‘i",
  taminot: "Ta’minot xodimi",
  rivojlantirish_rahbar: "Rivojlantirish bo‘lim boshlig‘i",
  rivojlantirish: "Rivojlantirish xodimi",
  mamuriy_rahbar: "Ma’muriy-xo‘jalik bo‘lim boshlig‘i",
  mamuriy: "Ma’muriy-xo‘jalik xodimi",
  gpp_rahbar: "GPP bo‘lim boshlig‘i",
  gpp: "GPP xodimi",
  oshpaz_rahbar: "Oshpaz bo‘lim boshlig‘i",
  oshpaz: "Oshpaz",
  marketing_rahbar: "Marketing bo‘lim boshlig‘i",
  marketing: "Marketing xodimi",
  revizor: "Revizor-yig‘uvchi",
  reviziya_rahbar: "Reviziya bo‘limi rahbari",
  kassir: "Kassir",
  yurist: "Yurist",
  komunalniy: "Kommunal",
  farrosh: "Farrosh",
  mexanik: "Mexanik",
  direktor_yordamchisi: "Direktor yordamchisi",
};

export function canManagePayroll(role?: string | null) {
  return role === "admin" || isDirectorRole(role) || role === "moliya" || role === "moliya_rahbar" || role === "hr_direktor" || role === "hr_kadr_rahbar";
}

export function canApprovePayroll(role?: string | null) {
  return role === "admin" || isDirectorRole(role) || role === "moliya" || role === "moliya_rahbar";
}

export function canEditKpiSettings(role?: string | null) {
  return role === "admin" || role === "hr_direktor" || role === "hr_kadr_rahbar" || isDirectorRole(role) || role === "moliya" || role === "moliya_rahbar";
}

export function currentMonthKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

export function monthBounds(ym: string) {
  const raw = /^(\d{4})-(\d{2})$/.exec(ym || "") ? ym : currentMonthKey();
  const [y, m] = raw.split("-").map(Number);
  const from = `${raw}-01`;
  const lastDay = new Date(y!, m!, 0).getDate();
  const to = `${raw}-${String(lastDay).padStart(2, "0")}`;
  return { month: raw, from, to, monthLabel: `${MONTH_NAMES[m! - 1]} ${y}` };
}

export function tashkentToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nextIsoDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(y!, m! - 1, d! + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

export function defaultIsWorkDay(iso: string): boolean {
  return new Date(`${iso}T12:00:00+05:00`).getDay() !== 0;
}

export function eachDate(from: string, to: string): string[] {
  const days: string[] = [];
  if (!from || !to || from > to) return days;
  let cur = from;
  while (cur <= to) {
    days.push(cur);
    cur = nextIsoDate(cur);
  }
  return days;
}

export function isWorkDay(iso: string, overrides?: Map<string, boolean>): boolean {
  if (overrides?.has(iso)) return overrides.get(iso)!;
  return defaultIsWorkDay(iso);
}

/** Default: yakshanba dam. Override kalendar orqali. */
export function workdaysBetween(from: string, to: string, overrides?: Map<string, boolean>): string[] {
  return eachDate(from, to).filter((d) => isWorkDay(d, overrides));
}

export function expectedWorkdays(from: string, to: string, month: string, overrides?: Map<string, boolean>) {
  const today = tashkentToday();
  const closeTo = month === currentMonthKey() && today < to ? today : to;
  return workdaysBetween(from, closeTo, overrides);
}

/** Ofis — oddiy ofis xodimlari bitta kalendar. Xavfsizlik alohida. Dorixona har smena alohida. */
export function isPayrollCalendarScope(scope: string) {
  return scope === "ofis" || scope === "xavfsizlik" || /^dorixona:[a-z0-9]{1,16}$/.test(scope);
}

export function calendarStorageKey(scope: string, iso: string) {
  if (scope === "ofis") return iso;
  return `${scope}|${iso}`;
}

export function parseCalendarStorageKey(raw: string): { scope: string; iso: string } | null {
  const scoped = /^([a-z0-9:_-]{1,40})\|(\d{4}-\d{2}-\d{2})$/.exec(raw);
  if (scoped && isPayrollCalendarScope(scoped[1]!)) return { scope: scoped[1]!, iso: scoped[2]! };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { scope: "ofis", iso: raw };
  return null;
}

function normPayroll(s: unknown) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[ʻʼ'`´]/g, "'");
}

function payrollShiftKey(shiftType?: string | null, shiftLabel?: string | null) {
  const compact = normPayroll(shiftLabel).replace(/\s+/g, "");
  const t = normPayroll(shiftType);
  if (compact.includes("1+2") || compact.includes("1-2") || t === "one_two" || t === "12") return "12";
  if (compact.includes("2+3") || compact.includes("2-3") || t === "two_three" || t === "23") return "23";
  if (t === "three" || t === "3" || compact.includes("3-smena") || compact === "3smena") return "3";
  if (t === "two" || t === "2" || compact.includes("2-smena") || compact === "2smena") return "2";
  if (t === "office" || compact.includes("ofis")) return "office";
  if (t === "one" || t === "1" || compact.includes("1-smena") || compact === "1smena" || !t) return "1";
  return "other";
}

export function payrollCalendarScope(input: {
  userRole?: string | null;
  orgRole?: string | null;
  position?: string | null;
  location?: string | null;
  shiftType?: string | null;
  shiftLabel?: string | null;
}) {
  const role = normPayroll(input.userRole);
  const org = normPayroll(input.orgRole);
  const pos = normPayroll(input.position);
  if (role === "sb" || role === "sb_boshliq" || /xavfsiz/.test(role) || /xavfsiz/.test(pos)) {
    return "xavfsizlik";
  }
  if (isPharmacyStaffRow({ userRole: role, orgRole: org, position: pos })) {
    return `dorixona:${payrollShiftKey(input.shiftType, input.shiftLabel)}`;
  }
  return "ofis";
}

export async function loadScopedCalendars(): Promise<Map<string, Map<string, boolean>>> {
  const out = new Map<string, Map<string, boolean>>();
  try {
    const rows = await db
      .select({ day: workCalendarDaysTable.day, isWork: workCalendarDaysTable.isWork })
      .from(workCalendarDaysTable);
    for (const r of rows) {
      const parsed = parseCalendarStorageKey(r.day);
      if (!parsed) continue;
      const bucket = out.get(parsed.scope) ?? new Map<string, boolean>();
      bucket.set(parsed.iso, Boolean(r.isWork));
      out.set(parsed.scope, bucket);
    }
  } catch (err) {
    console.error("loadScopedCalendars", err);
  }
  return out;
}

export async function loadWorkDayOverrides(scope = "ofis"): Promise<Map<string, boolean>> {
  const all = await loadScopedCalendars();
  return all.get(scope) ?? new Map();
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function roundMoney(n: number) {
  return Math.round(n);
}

function lateMinutes(workDate: string, checkIn: Date, startHm: string) {
  const hm = /^\d{2}:\d{2}$/.test(startHm) ? startHm : "09:00";
  const start = new Date(`${workDate}T${hm}:00+05:00`);
  return Math.max(0, Math.round((checkIn.getTime() - start.getTime()) / 60000));
}

function attendancePoints(status: string, lateMin: number | null): {
  counted: boolean;
  points: number;
  note: string;
} {
  const st = (status || "").toLowerCase();
  if (st === "leave" || st === "on_leave" || st === "sick") {
    return { counted: false, points: 0, note: "Uzrli — hisobga olinmaydi" };
  }
  if (st === "absent") {
    return { counted: true, points: 0, note: "Sababsiz kelmagan" };
  }
  if (lateMin == null) {
    if (st === "present" || st === "incomplete") {
      return { counted: true, points: 1, note: "O‘z vaqtida" };
    }
    return { counted: true, points: 0, note: status };
  }
  if (lateMin <= 5) return { counted: true, points: 1, note: "0–5 daqiqa" };
  if (lateMin <= 30) return { counted: true, points: 0.7, note: "5–30 daqiqa kechikish" };
  return { counted: true, points: 0.3, note: "30 daqiqadan ortiq kechikish" };
}

export async function loadKpiWeights(): Promise<KpiWeights> {
  try {
    const [row] = await db.select().from(kpiSettingsTable).where(eq(kpiSettingsTable.id, 1)).limit(1);
    return {
      attendance: row?.attendanceWeight ?? 40,
      tasks: row?.tasksWeight ?? 30,
      checklist: row?.checklistWeight ?? 30,
      workStartHm: row?.workStartHm ?? "09:00",
    };
  } catch {
    return { attendance: 40, tasks: 30, checklist: 30, workStartHm: "09:00" };
  }
}

function clampWeight(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function saveKpiWeights(patch: Partial<KpiWeights>, userId: number): Promise<KpiWeights> {
  const cur = await loadKpiWeights();
  const next = {
    attendance: clampWeight(patch.attendance ?? cur.attendance),
    tasks: clampWeight(patch.tasks ?? cur.tasks),
    checklist: clampWeight(patch.checklist ?? cur.checklist),
    workStartHm: patch.workStartHm || cur.workStartHm,
  };
  const [existing] = await db.select({ id: kpiSettingsTable.id }).from(kpiSettingsTable).limit(1);
  if (existing) {
    await db
      .update(kpiSettingsTable)
      .set({
        attendanceWeight: next.attendance,
        tasksWeight: next.tasks,
        checklistWeight: next.checklist,
        workStartHm: next.workStartHm,
        updatedById: userId,
        updatedAt: new Date(),
      })
      .where(eq(kpiSettingsTable.id, existing.id));
  } else {
    await db.insert(kpiSettingsTable).values({
      attendanceWeight: next.attendance,
      tasksWeight: next.tasks,
      checklistWeight: next.checklist,
      workStartHm: next.workStartHm,
      updatedById: userId,
    });
  }
  return next;
}

function effectiveWeights(
  base: KpiWeights,
  avail: { attendance: boolean; tasks: boolean; checklist: boolean },
) {
  const parts: Array<["attendance" | "tasks" | "checklist", number]> = [];
  if (avail.attendance) parts.push(["attendance", base.attendance]);
  if (avail.tasks) parts.push(["tasks", base.tasks]);
  if (avail.checklist) parts.push(["checklist", base.checklist]);
  const sum = parts.reduce((s, p) => s + p[1], 0);
  const out = { attendance: 0, tasks: 0, checklist: 0 };
  if (sum <= 0) return out;
  for (const [k, w] of parts) out[k] = (w / sum) * 100;
  return out;
}

export async function computePayroll(userId: number, monthKey: string): Promise<PayrollCompute | null> {
  const { month, from, to, monthLabel } = monthBounds(monthKey);
  const weights = await loadKpiWeights();
  const scopedCalendars = await loadScopedCalendars();

  const [user] = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return null;

  type EmpRow = {
    id: number;
    position: string | null;
    location: string | null;
    orgRole: string | null;
    shiftType: string | null;
    shiftLabel: string | null;
    fixedSalary: number | null;
    bonusPercent: number | null;
  };
  let emp: EmpRow | undefined;
  try {
    const [row] = await db
      .select({
        id: employeesTable.id,
        position: employeesTable.position,
        location: employeesTable.location,
        orgRole: employeesTable.orgRole,
        shiftType: employeesTable.shiftType,
        shiftLabel: employeesTable.shiftLabel,
        fixedSalary: employeesTable.fixedSalary,
        bonusPercent: employeesTable.bonusPercent,
      })
      .from(employeesTable)
      .where(eq(employeesTable.userId, userId))
      .limit(1);
    emp = row;
  } catch {
    const [row] = await db
      .select({
        id: employeesTable.id,
        position: employeesTable.position,
        location: employeesTable.location,
      })
      .from(employeesTable)
      .where(eq(employeesTable.userId, userId))
      .limit(1);
    emp = row
      ? { ...row, orgRole: null, shiftType: null, shiftLabel: null, fixedSalary: 0, bonusPercent: 30 }
      : undefined;
  }

  const fixedSalary = Math.max(0, Math.round(Number(emp?.fixedSalary ?? 0)));
  const bonusPercent = Math.max(0, Number(emp?.bonusPercent ?? 30));

  const attDays: AttendanceDayDetail[] = [];
  if (emp) {
    try {
      const records = await db
        .select({
          workDate: attendanceRecordsTable.workDate,
          status: attendanceRecordsTable.status,
          checkInAt: attendanceRecordsTable.checkInAt,
        })
        .from(attendanceRecordsTable)
        .where(
          and(
            eq(attendanceRecordsTable.employeeId, emp.id),
            gte(attendanceRecordsTable.workDate, from),
            lte(attendanceRecordsTable.workDate, to),
          ),
        );
      for (const r of records) {
        const late = r.checkInAt != null ? lateMinutes(r.workDate, r.checkInAt, weights.workStartHm) : null;
        const scored = attendancePoints(r.status, late);
        attDays.push({
          date: r.workDate,
          status: r.status,
          lateMinutes: late,
          counted: scored.counted,
          points: scored.points,
          note: scored.note,
        });
      }
    } catch (err) {
      console.error("computePayroll attendance", userId, err);
    }
  }
  const calendarScope = payrollCalendarScope({
    userRole: user.role,
    orgRole: emp?.orgRole,
    position: emp?.position,
    location: emp?.location,
    shiftType: emp?.shiftType,
    shiftLabel: emp?.shiftLabel,
  });
  const expected = expectedWorkdays(from, to, month, scopedCalendars.get(calendarScope) ?? new Map());
  const recorded = new Set(attDays.map((d) => d.date));
  const complete = expected.length > 0 && expected.every((d) => recorded.has(d));
  const closedDays = expected.filter((d) => recorded.has(d)).length;
  for (const date of expected) {
    if (!recorded.has(date)) {
      attDays.push({
        date,
        status: "missing",
        lateMinutes: null,
        counted: true,
        points: 0,
        note: "Yopilmagan kun",
      });
    }
  }
  const countedAtt = attDays.filter((d) => expected.includes(d.date) && d.counted);
  const attPoints = countedAtt.reduce((s, d) => s + d.points, 0);
  const attAvailable = complete && countedAtt.length > 0;
  const attPercent = countedAtt.length > 0 ? (attPoints / countedAtt.length) * 100 : 0;

  const fromDt = new Date(`${from}T00:00:00+05:00`);
  const toDt = new Date(`${to}T23:59:59+05:00`);
  let taskRows: Array<{
    id: number;
    title: string;
    status: string;
    dueAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
  }> = [];
  try {
    taskRows = await db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        status: tasksTable.status,
        dueAt: tasksTable.dueAt,
        completedAt: tasksTable.completedAt,
        createdAt: tasksTable.createdAt,
      })
      .from(tasksTable)
      .where(
        and(
          emp
            ? or(
                and(eq(tasksTable.assigneeKind, "user"), eq(tasksTable.assigneeId, userId)),
                and(eq(tasksTable.assigneeKind, "employee"), eq(tasksTable.assigneeId, emp.id)),
              )
            : and(eq(tasksTable.assigneeKind, "user"), eq(tasksTable.assigneeId, userId)),
          or(
            and(gte(tasksTable.dueAt, fromDt), lte(tasksTable.dueAt, toDt)),
            and(isNull(tasksTable.dueAt), gte(tasksTable.createdAt, fromDt), lte(tasksTable.createdAt, toDt)),
          ),
        ),
      );
  } catch (err) {
    console.error("computePayroll tasks", userId, err);
  }

  const taskItems: TaskDetail[] = taskRows.map((t) => {
    const done = t.status === "done" || t.status === "verified";
    let points = 0;
    let label = "Bajarilmagan";
    if (t.status === "cancelled") {
      points = 0;
      label = "Bekor qilingan";
    } else if (done) {
      if (!t.dueAt || (t.completedAt && t.completedAt.getTime() <= t.dueAt.getTime())) {
        points = 1;
        label = "O‘z vaqtida";
      } else {
        points = 0.5;
        label = "Kechikib bajarilgan";
      }
    }
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      dueAt: t.dueAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      points,
      label,
    };
  });
  const tasksAvailable = taskItems.length > 0;
  const taskPoints = taskItems.reduce((s, t) => s + t.points, 0);
  const taskPercent = tasksAvailable ? (taskPoints / taskItems.length) * 100 : 0;

  const checklistItems: ChecklistDetail[] = [];
  try {
    const auditWhere = emp
      ? or(eq(branchAuditsTable.coordinatorId, userId), eq(branchAuditsTable.managerEmployeeId, emp.id))
      : eq(branchAuditsTable.coordinatorId, userId);
    const audits = await db
      .select({
        id: branchAuditsTable.id,
        visitDate: branchAuditsTable.visitDate,
        visitName: branchAuditsTable.visitName,
        scorePercent: branchAuditsTable.scorePercent,
        yesCount: branchAuditsTable.yesCount,
        totalCount: branchAuditsTable.totalCount,
      })
      .from(branchAuditsTable)
      .where(and(auditWhere, gte(branchAuditsTable.visitDate, from), lte(branchAuditsTable.visitDate, to)));
    for (const a of audits) {
      checklistItems.push({
        id: a.id,
        visitDate: a.visitDate,
        visitName: a.visitName,
        percent: a.scorePercent,
        yesCount: a.yesCount,
        totalCount: a.totalCount,
      });
    }
  } catch (err) {
    console.error("computePayroll audits", userId, err);
  }
  const checklistAvailable = checklistItems.length > 0;
  const checklistPercent = checklistAvailable
    ? checklistItems.reduce((s, i) => s + i.percent, 0) / checklistItems.length
    : 0;

  const eff = effectiveWeights(weights, {
    attendance: attAvailable,
    tasks: tasksAvailable,
    checklist: checklistAvailable,
  });

  const kpiPercent =
    (attPercent * eff.attendance) / 100 +
    (taskPercent * eff.tasks) / 100 +
    (checklistPercent * eff.checklist) / 100;

  const maxBonus = roundMoney((fixedSalary * bonusPercent) / 100);
  const bonusAmount = roundMoney((maxBonus * kpiPercent) / 100);

  return {
    userId,
    employeeId: emp?.id ?? null,
    month,
    monthLabel,
    from,
    to,
    fullName: user.fullName,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    position: emp?.position ?? null,
    branch: displayBranchName(emp?.location) || null,
    fixedSalary,
    bonusPercent,
    attendance: {
      available: attAvailable,
      complete,
      percent: round1(attPercent),
      baseWeight: weights.attendance,
      effectiveWeight: round1(eff.attendance),
      points: round1(attPoints),
      countedDays: countedAtt.length,
      expectedDays: expected.length,
      closedDays,
      days: attDays.sort((a, b) => b.date.localeCompare(a.date)),
    },
    tasks: {
      available: tasksAvailable,
      percent: round1(taskPercent),
      baseWeight: weights.tasks,
      effectiveWeight: round1(eff.tasks),
      points: round1(taskPoints),
      total: taskItems.length,
      items: taskItems,
    },
    checklist: {
      available: checklistAvailable,
      percent: round1(checklistPercent),
      baseWeight: weights.checklist,
      effectiveWeight: round1(eff.checklist),
      items: checklistItems,
    },
    kpiPercent: round1(kpiPercent),
    maxBonus,
    bonusAmount,
    totalAmount: fixedSalary + bonusAmount,
  };
}

export type PayrollListRow = {
  employeeId: number;
  userId: number | null;
  fullName: string;
  roleLabel: string;
  userRole: string | null;
  orgRole: string | null;
  position: string | null;
  branch: string | null;
  shiftType: string | null;
  shiftLabel: string | null;
  calendarScope: string;
  fixedSalary: number;
  salary: number;
  jarima: number;
  jarimaNote: string | null;
  jarimaEvents: Array<{ date: string; kind: "late" | "absent"; n: number; amount: number }>;
  jarimaLocked: boolean;
  returnedDays: Array<{ date: string; salary: number; jarima: number }>;
  bonusPercent: number;
  kpiPercent: number;
  bonusAmount: number;
  totalAmount: number;
  status: string;
  attendance: number;
  tasks: number;
  checklist: number;
  attendanceAvailable: boolean;
  attendanceComplete: boolean;
  expectedWorkDays: number;
  closedWorkDays: number;
  tasksAvailable: boolean;
  checklistAvailable: boolean;
};

function kpiFromParts(
  weights: KpiWeights,
  attPercent: number,
  attAvailable: boolean,
  taskPercent: number,
  tasksAvailable: boolean,
  checklistPercent: number,
  checklistAvailable: boolean,
  fixedSalary: number,
  bonusPercent: number,
) {
  const eff = effectiveWeights(weights, {
    attendance: attAvailable,
    tasks: tasksAvailable,
    checklist: checklistAvailable,
  });
  const kpiPercent =
    (attPercent * eff.attendance) / 100 +
    (taskPercent * eff.tasks) / 100 +
    (checklistPercent * eff.checklist) / 100;
  const maxBonus = roundMoney((fixedSalary * bonusPercent) / 100);
  const bonusAmount = roundMoney((maxBonus * kpiPercent) / 100);
  return {
    kpiPercent: round1(kpiPercent),
    bonusAmount,
    totalAmount: fixedSalary + bonusAmount,
    attendance: round1(attPercent),
    tasks: round1(taskPercent),
    checklist: round1(checklistPercent),
  };
}

function scoreAttendanceDays(
  records: Array<{ status: string; checkInAt: Date | null; workDate: string }>,
  workStartHm: string,
  expected: string[],
) {
  const recorded = new Set(records.map((r) => r.workDate));
  const complete = expected.length > 0 && expected.every((d) => recorded.has(d));
  const closedDays = expected.filter((d) => recorded.has(d)).length;
  let points = 0;
  let counted = 0;
  for (const r of records) {
    if (!expected.includes(r.workDate)) continue;
    const late = r.checkInAt != null ? lateMinutes(r.workDate, r.checkInAt, workStartHm) : null;
    const scored = attendancePoints(r.status, late);
    if (scored.counted) {
      counted += 1;
      points += scored.points;
    }
  }
  const available = complete && counted > 0;
  return {
    available,
    complete,
    percent: counted > 0 ? (points / counted) * 100 : 0,
    expectedDays: expected.length,
    closedDays,
  };
}

function scoreTaskRows(rows: Array<{ status: string; dueAt: Date | null; completedAt: Date | null }>) {
  if (!rows.length) return { available: false, percent: 0 };
  let points = 0;
  for (const t of rows) {
    const done = t.status === "done" || t.status === "verified";
    if (t.status === "cancelled") {
      points += 0;
    } else if (done) {
      if (!t.dueAt || (t.completedAt && t.completedAt.getTime() <= t.dueAt.getTime())) points += 1;
      else points += 0.5;
    }
  }
  return { available: true, percent: (points / rows.length) * 100 };
}

/** Barcha faol xodimlar oyligi — bitta oy uchun, N+1 so‘rovsiz. */
export async function computePayrollList(
  monthKey: string,
  q = "",
): Promise<{ month: string; monthLabel: string; workDays: string[]; calendars: Record<string, string[]>; items: PayrollListRow[] }> {
  const { month, from, to, monthLabel } = monthBounds(monthKey);
  const scopedCalendars = await loadScopedCalendars();
  const expectedByScope = new Map<string, string[]>();
  const expectedFor = (scope: string) => {
    const cached = expectedByScope.get(scope);
    if (cached) return cached;
    const days = expectedWorkdays(from, to, month, scopedCalendars.get(scope) ?? new Map());
    expectedByScope.set(scope, days);
    return days;
  };
  const weights = await loadKpiWeights();
  const fromDt = new Date(`${from}T00:00:00+05:00`);
  const toDt = new Date(`${to}T23:59:59+05:00`);
  const needle = q.trim();

  const staffRows = await loadStaffFromUsers("active");
  const users = staffRows.filter((u) => {
    if (!needle) return true;
    const hay = `${u.fullName} ${u.login || ""} ${u.position || ""} ${u.location || ""}`;
    return scriptIncludes(hay, needle);
  });

  const empIds = users.map((u) => u.id);
  const userIds = users.map((u) => u.userId).filter((id): id is number => id != null);

  const attByEmp = new Map<number, Array<{ status: string; checkInAt: Date | null; workDate: string }>>();
  if (empIds.length) {
    try {
      const records = await db
        .select({
          employeeId: attendanceRecordsTable.employeeId,
          workDate: attendanceRecordsTable.workDate,
          status: attendanceRecordsTable.status,
          checkInAt: attendanceRecordsTable.checkInAt,
        })
        .from(attendanceRecordsTable)
        .where(
          and(
            inArray(attendanceRecordsTable.employeeId, empIds),
            gte(attendanceRecordsTable.workDate, from),
            lte(attendanceRecordsTable.workDate, to),
          ),
        );
      for (const r of records) {
        const list = attByEmp.get(r.employeeId) ?? [];
        list.push(r);
        attByEmp.set(r.employeeId, list);
      }
    } catch (err) {
      console.error("payroll list attendance", err);
    }
  }

  const taskByUser = new Map<number, Array<{ status: string; dueAt: Date | null; completedAt: Date | null }>>();
  const taskByEmp = new Map<number, Array<{ status: string; dueAt: Date | null; completedAt: Date | null }>>();
  try {
    const taskRows = await db
      .select({
        assigneeKind: tasksTable.assigneeKind,
        assigneeId: tasksTable.assigneeId,
        status: tasksTable.status,
        dueAt: tasksTable.dueAt,
        completedAt: tasksTable.completedAt,
      })
      .from(tasksTable)
      .where(
        or(
          and(gte(tasksTable.dueAt, fromDt), lte(tasksTable.dueAt, toDt)),
          and(isNull(tasksTable.dueAt), gte(tasksTable.createdAt, fromDt), lte(tasksTable.createdAt, toDt)),
        ),
      );
    for (const t of taskRows) {
      const row = { status: t.status, dueAt: t.dueAt, completedAt: t.completedAt };
      if (t.assigneeKind === "user") {
        const list = taskByUser.get(t.assigneeId) ?? [];
        list.push(row);
        taskByUser.set(t.assigneeId, list);
      } else if (t.assigneeKind === "employee") {
        const list = taskByEmp.get(t.assigneeId) ?? [];
        list.push(row);
        taskByEmp.set(t.assigneeId, list);
      }
    }
  } catch (err) {
    console.error("payroll list tasks", err);
  }

  const checkByUser = new Map<number, Map<number, number>>();
  const checkByEmp = new Map<number, Map<number, number>>();
  try {
    const audits = await db
      .select({
        id: branchAuditsTable.id,
        coordinatorId: branchAuditsTable.coordinatorId,
        managerEmployeeId: branchAuditsTable.managerEmployeeId,
        scorePercent: branchAuditsTable.scorePercent,
      })
      .from(branchAuditsTable)
      .where(and(gte(branchAuditsTable.visitDate, from), lte(branchAuditsTable.visitDate, to)));
    for (const a of audits) {
      if (a.coordinatorId != null) {
        const m = checkByUser.get(a.coordinatorId) ?? new Map();
        m.set(a.id, a.scorePercent);
        checkByUser.set(a.coordinatorId, m);
      }
      if (a.managerEmployeeId != null) {
        const m = checkByEmp.get(a.managerEmployeeId) ?? new Map();
        m.set(a.id, a.scorePercent);
        checkByEmp.set(a.managerEmployeeId, m);
      }
    }
  } catch (err) {
    console.error("payroll list audits", err);
  }

  const statusByUser = new Map<number, string>();
  const payByUser = new Map<number, { salary: number; jarima: number; note: string | null; returnedDays: Array<{ date: string; salary: number; jarima: number }> }>();
  if (userIds.length) {
    try {
      const saved = await db
        .select({
          userId: payrollMonthsTable.userId,
          status: payrollMonthsTable.status,
          salary: payrollMonthsTable.fixedSalary,
          jarima: payrollMonthsTable.jarima,
          note: payrollMonthsTable.jarimaNote,
          returnedDays: payrollMonthsTable.returnedDays,
        })
        .from(payrollMonthsTable)
        .where(and(eq(payrollMonthsTable.month, month), inArray(payrollMonthsTable.userId, userIds)));
      for (const s of saved) {
        statusByUser.set(s.userId, s.status);
        payByUser.set(s.userId, { salary: s.salary, jarima: s.jarima, note: s.note, returnedDays: Array.isArray(s.returnedDays) ? s.returnedDays : [] });
      }
    } catch (err) {
      console.error("payroll list months", err);
    }
  }

  const items: PayrollListRow[] = users.map((u) => {
    const fixedSalary = Math.max(0, Math.round(Number(u.fixedSalary ?? 0)));
    const bonusPercent = Math.max(0, Number(u.bonusPercent ?? 30));
    const uid = u.userId;
    const empId = u.id;
    const calendarScope = payrollCalendarScope({
      userRole: u.userRole,
      orgRole: u.orgRole,
      position: u.position,
      location: u.location,
      shiftType: u.shiftType,
      shiftLabel: u.shiftLabel,
    });
    const expected = expectedFor(calendarScope);
    const att = scoreAttendanceDays(attByEmp.get(empId) ?? [], weights.workStartHm, expected);
    const mergedTasks = [...(uid != null ? taskByUser.get(uid) ?? [] : []), ...(taskByEmp.get(empId) ?? [])];
    const tasks = scoreTaskRows(mergedTasks);
    const checkMap = new Map<number, number>([
      ...(uid != null ? checkByUser.get(uid) ?? [] : []),
      ...(checkByEmp.get(empId) ?? []),
    ]);
    const checkPercents = [...checkMap.values()];
    const checklistAvailable = checkPercents.length > 0;
    const checklistPercent = checklistAvailable
      ? checkPercents.reduce((s, n) => s + n, 0) / checkPercents.length
      : 0;
    const money = kpiFromParts(
      weights,
      att.percent,
      att.available,
      tasks.percent,
      tasks.available,
      checklistPercent,
      checklistAvailable,
      fixedSalary,
      bonusPercent,
    );
    const roleKey = u.userRole || u.orgRole || "";
    return {
      employeeId: empId,
      userId: uid,
      fullName: u.fullName,
      roleLabel: ROLE_LABELS[roleKey] || roleKey,
      userRole: u.userRole,
      orgRole: u.orgRole,
      position: u.position ?? null,
      branch: displayBranchName(u.location) || null,
      shiftType: u.shiftType ?? null,
      shiftLabel: u.shiftLabel ?? null,
      calendarScope,
      fixedSalary,
      salary: uid != null ? payByUser.get(uid)?.salary ?? 0 : 0,
      jarima: uid != null ? payByUser.get(uid)?.jarima ?? 0 : 0,
      jarimaNote: uid != null ? payByUser.get(uid)?.note ?? null : null,
      jarimaEvents: [],
      jarimaLocked: false,
      returnedDays: uid != null ? payByUser.get(uid)?.returnedDays ?? [] : [],
      bonusPercent,
      kpiPercent: money.kpiPercent,
      bonusAmount: money.bonusAmount,
      totalAmount: money.totalAmount,
      status: (uid != null ? statusByUser.get(uid) : undefined) || "draft",
      attendance: money.attendance,
      tasks: money.tasks,
      checklist: money.checklist,
      attendanceAvailable: att.available,
      attendanceComplete: att.complete,
      expectedWorkDays: att.expectedDays,
      closedWorkDays: att.closedDays,
      tasksAvailable: tasks.available,
      checklistAvailable,
    };
  });

  if (month >= JARIMA_START.slice(0, 7)) {
    try {
      const snap = await applyAttendanceJarima(month, jarimaWorkDay(scopedCalendars));
      const byUser = new Map(snap.people.map((person) => [person.userId, person]));
      for (const item of items) {
        if (item.userId == null) continue;
        const hit = byUser.get(item.userId);
        if (!hit) continue;
        item.jarimaEvents = hit.events;
        item.jarimaLocked = hit.locked;
        if (hit.locked) continue;
        item.salary = hit.salary;
        item.jarima = hit.amount;
        item.jarimaNote = hit.note;
      }
    } catch (err) {
      console.error("payroll attendance jarima", err);
    }
  }

  items.sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
  const scopeKeys = new Set<string>([
    "ofis",
    "xavfsizlik",
    "dorixona:1",
    "dorixona:2",
    "dorixona:3",
    "dorixona:12",
    "dorixona:23",
  ]);
  for (const key of scopedCalendars.keys()) scopeKeys.add(key);
  for (const item of items) scopeKeys.add(item.calendarScope);
  const calendars: Record<string, string[]> = {};
  for (const scope of scopeKeys) {
    calendars[scope] = workdaysBetween(from, to, scopedCalendars.get(scope) ?? new Map());
  }
  return { month, monthLabel, workDays: calendars.ofis ?? [], calendars, items };
}

export async function upsertPayrollDraft(report: PayrollCompute, status?: string) {
  const payload = {
    employeeId: report.employeeId,
    fixedSalary: report.fixedSalary,
    bonusPercent: report.bonusPercent,
    kpiPercent: report.kpiPercent,
    maxBonus: report.maxBonus,
    bonusAmount: report.bonusAmount,
    totalAmount: report.totalAmount,
    snapshot: report as unknown as Record<string, unknown>,
    computedAt: new Date(),
    updatedAt: new Date(),
    ...(status ? { status } : {}),
  };
  const [existing] = await db
    .select({ id: payrollMonthsTable.id, status: payrollMonthsTable.status })
    .from(payrollMonthsTable)
    .where(and(eq(payrollMonthsTable.userId, report.userId), eq(payrollMonthsTable.month, report.month)))
    .limit(1);
  if (existing) {
    if (existing.status === "approved" && status !== "approved") return existing;
    await db.update(payrollMonthsTable).set(payload).where(eq(payrollMonthsTable.id, existing.id));
    return existing;
  }
  await db.insert(payrollMonthsTable).values({
    userId: report.userId,
    month: report.month,
    status: status || "draft",
    ...payload,
  });
  return null;
}

export function formatSom(n: number) {
  return `${Math.round(n).toLocaleString("ru-RU")} so‘m`;
}

export async function savePayrollLine(input: {
  userId: number;
  employeeId?: number | null;
  month: string;
  salary: number;
  jarima: number;
  note?: string | null;
}) {
  const salary = Math.max(0, Math.round(Number(input.salary) || 0));
  const jarima = Math.max(0, Math.round(Number(input.jarima) || 0));
  const note = String(input.note ?? "").trim().slice(0, 240) || null;
  const net = salary - jarima;
  const [existing] = await db
    .select({ id: payrollMonthsTable.id })
    .from(payrollMonthsTable)
    .where(and(eq(payrollMonthsTable.userId, input.userId), eq(payrollMonthsTable.month, input.month)))
    .limit(1);
  const patch = {
    employeeId: input.employeeId ?? null,
    fixedSalary: salary,
    jarima,
    jarimaNote: note,
    totalAmount: net,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(payrollMonthsTable).set(patch).where(eq(payrollMonthsTable.id, existing.id));
    return { ...patch, status: "kept" as const };
  }
  await db.insert(payrollMonthsTable).values({
    userId: input.userId,
    month: input.month,
    status: "draft",
    bonusPercent: 0,
    kpiPercent: 0,
    maxBonus: 0,
    bonusAmount: 0,
    ...patch,
  });
  return { ...patch, status: "draft" as const };
}

export async function savePayrollFiksa(input: {
  month: string;
  lines: Array<{ userId: number; employeeId?: number | null; salary: number }>;
}) {
  const month = String(input.month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Oy noto‘g‘ri");
  const lines = input.lines.slice(0, 500);
  let saved = 0;
  for (const line of lines) {
    const userId = Number(line.userId);
    if (!Number.isFinite(userId) || userId <= 0) continue;
    const salary = Math.max(0, Math.round(Number(line.salary) || 0));
    const employeeId = Number(line.employeeId) > 0 ? Number(line.employeeId) : null;
    const [existing] = await db
      .select({ id: payrollMonthsTable.id, jarima: payrollMonthsTable.jarima })
      .from(payrollMonthsTable)
      .where(and(eq(payrollMonthsTable.userId, userId), eq(payrollMonthsTable.month, month)))
      .limit(1);
    if (existing) {
      await db
        .update(payrollMonthsTable)
        .set({
          ...(employeeId ? { employeeId } : {}),
          fixedSalary: salary,
          totalAmount: salary - Math.max(0, existing.jarima ?? 0),
          updatedAt: new Date(),
        })
        .where(eq(payrollMonthsTable.id, existing.id));
    } else {
      await db.insert(payrollMonthsTable).values({
        userId,
        employeeId,
        month,
        status: "draft",
        fixedSalary: salary,
        bonusPercent: 0,
        kpiPercent: 0,
        maxBonus: 0,
        bonusAmount: 0,
        totalAmount: salary,
        jarima: 0,
        jarimaNote: null,
      });
    }
    if (employeeId) {
      await db.update(employeesTable).set({ fixedSalary: salary }).where(eq(employeesTable.id, employeeId));
    } else {
      await db.update(employeesTable).set({ fixedSalary: salary }).where(eq(employeesTable.userId, userId));
    }
    await db
      .update(payrollDaysTable)
      .set({ salary: null, updatedAt: new Date() })
      .where(and(eq(payrollDaysTable.userId, userId), gte(payrollDaysTable.day, `${month}-01`), lte(payrollDaysTable.day, `${month}-31`)));
    saved += 1;
  }
  return { saved };
}

function netAfterReturnedDays(salary: number, jarima: number, returnedDays: unknown): number {
  const days = Array.isArray(returnedDays) ? returnedDays : [];
  let holdSalary = 0;
  let holdJarima = 0;
  for (const day of days) {
    if (!day || typeof day !== "object") continue;
    holdSalary += Math.max(0, Math.round(Number((day as { salary?: unknown }).salary) || 0));
    holdJarima += Math.max(0, Math.round(Number((day as { jarima?: unknown }).jarima) || 0));
  }
  return salary - jarima - holdSalary + holdJarima;
}

export async function loadPayrollSlip(userId: number, month: string) {
  const [row] = await db
    .select({
      status: payrollMonthsTable.status,
      salary: payrollMonthsTable.fixedSalary,
      jarima: payrollMonthsTable.jarima,
      note: payrollMonthsTable.jarimaNote,
      returnedDays: payrollMonthsTable.returnedDays,
      approvedAt: payrollMonthsTable.approvedAt,
    })
    .from(payrollMonthsTable)
    .where(and(eq(payrollMonthsTable.userId, userId), eq(payrollMonthsTable.month, month)))
    .limit(1);
  const [user] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const dayRows = await db
    .select({
      status: payrollDaysTable.status,
      publishedSalary: payrollDaysTable.publishedSalary,
      publishedJarima: payrollDaysTable.publishedJarima,
    })
    .from(payrollDaysTable)
    .where(and(eq(payrollDaysTable.userId, userId), gte(payrollDaysTable.day, `${month}-01`), lte(payrollDaysTable.day, `${month}-31`)));
  const published = dayRows.filter((day) => day.status === "approved" || day.status === "returned");
  if (published.length) {
    const salary = published.reduce((sum, day) => sum + Math.max(0, day.publishedSalary ?? 0), 0);
    const jarima = published.reduce((sum, day) => sum + (day.status === "returned" ? 0 : Math.max(0, day.publishedJarima ?? 0)), 0);
    return {
      approved: true as const,
      returned: false as const,
      status: "approved" as const,
      month,
      fullName: user?.fullName ?? "",
      salary,
      jarima,
      note: null,
      net: salary - jarima,
      approvedAt: row?.approvedAt ?? null,
    };
  }
  const status = row?.status === "approved" || row?.status === "returned" ? row.status : "draft";
  if (status !== "approved") {
    return {
      approved: false as const,
      returned: status === "returned",
      status,
      month,
      fullName: user?.fullName ?? "",
    };
  }
  return {
    approved: true as const,
    returned: false as const,
    status: "approved" as const,
    month,
    fullName: user?.fullName ?? "",
    salary: row!.salary,
    jarima: row!.jarima,
    note: row!.note,
    net: netAfterReturnedDays(row!.salary, row!.jarima, row!.returnedDays),
    approvedAt: row!.approvedAt,
  };
}

export async function loadPayrollYear(userId: number, year: string) {
  const from = `${year}-01`;
  const to = `${year}-12`;
  const rows = await db
    .select({
      month: payrollMonthsTable.month,
      status: payrollMonthsTable.status,
      salary: payrollMonthsTable.fixedSalary,
      jarima: payrollMonthsTable.jarima,
      returnedDays: payrollMonthsTable.returnedDays,
    })
    .from(payrollMonthsTable)
    .where(and(eq(payrollMonthsTable.userId, userId), gte(payrollMonthsTable.month, from), lte(payrollMonthsTable.month, to)));
  const months = rows
    .map((row) => {
      const approved = row.status === "approved";
      return {
        month: row.month,
        status: row.status === "approved" || row.status === "returned" ? row.status : "draft",
        salary: approved ? row.salary : 0,
        jarima: approved ? row.jarima : 0,
        net: approved ? netAfterReturnedDays(row.salary, row.jarima, row.returnedDays) : 0,
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
  const approvedNet = months.reduce((sum, row) => sum + (row.status === "approved" ? row.net : 0), 0);
  return { year, months, approvedNet };
}

function jarimaWorkDay(calendars: Map<string, Map<string, boolean>>) {
  return (person: {
    role: string | null;
    orgRole: string | null;
    position: string | null;
    location: string | null;
    shiftType: string | null;
    shiftLabel: string | null;
  }, date: string) => {
    const scope = payrollCalendarScope({
      userRole: person.role,
      orgRole: person.orgRole,
      position: person.position,
      location: person.location,
      shiftType: person.shiftType,
      shiftLabel: person.shiftLabel,
    });
    return isWorkDay(date, calendars.get(scope) ?? new Map());
  };
}

export async function loadJarimaSummary(month: string, userId: number, manage: boolean) {
  const calendars = month >= JARIMA_START.slice(0, 7) ? await loadScopedCalendars() : new Map<string, Map<string, boolean>>();
  const snap = month >= JARIMA_START.slice(0, 7) ? await applyAttendanceJarima(month, jarimaWorkDay(calendars)) : null;
  const self = snap?.people.find((person) => person.userId === userId) ?? null;
  const counted = (snap?.people ?? []).filter((person) => person.amount > 0);
  const total = counted.reduce((sum, person) => sum + person.amount, 0);
  const rule = [...JARIMA_RULE];
  if (!manage) {
    const dayRows = await db
      .select({
        status: payrollDaysTable.status,
        publishedJarima: payrollDaysTable.publishedJarima,
        publishedNote: payrollDaysTable.publishedNote,
      })
      .from(payrollDaysTable)
      .where(and(eq(payrollDaysTable.userId, userId), gte(payrollDaysTable.day, `${month}-01`), lte(payrollDaysTable.day, `${month}-31`)));
    const published = dayRows.filter((day) => day.status === "approved" || day.status === "returned");
    if (published.length) {
      const total = published.reduce((sum, day) => sum + (day.status === "returned" ? 0 : Math.max(0, day.publishedJarima ?? 0)), 0);
      return {
        month,
        own: true,
        approved: true,
        people: total > 0 ? 1 : 0,
        total,
        active: Boolean(snap?.active),
        start: JARIMA_START,
        rule,
        self: self
          ? { ...self, amount: total, note: published.find((day) => day.status === "approved" && (day.publishedJarima ?? 0) > 0)?.publishedNote ?? null, status: "approved" }
          : null,
        rows: [] as typeof counted,
      };
    }
    return {
      month,
      own: true,
      approved: self?.status === "approved",
      people: self && self.amount > 0 ? 1 : 0,
      total: self?.amount ?? 0,
      active: Boolean(snap?.active),
      start: JARIMA_START,
      rule,
      self,
      rows: [] as typeof counted,
    };
  }
  return {
    month,
    own: false,
    approved: false,
    people: counted.length,
    total,
    active: Boolean(snap?.active),
    start: JARIMA_START,
    rule,
    self,
    rows: counted.sort((a, b) => b.amount - a.amount || a.fullName.localeCompare(b.fullName, "ru")),
  };
}

export async function loadMyPayrollCard(userId: number, monthKey: string) {
  const { month, from, to, monthLabel } = monthBounds(monthKey);
  const cardCalendars = month >= JARIMA_START.slice(0, 7) ? await loadScopedCalendars() : new Map<string, Map<string, boolean>>();
  const snap = month >= JARIMA_START.slice(0, 7) ? await applyAttendanceJarima(month, jarimaWorkDay(cardCalendars)) : null;
  const self = snap?.people.find((person) => person.userId === userId) ?? null;
  const [pay] = await db
    .select({ salary: payrollMonthsTable.fixedSalary })
    .from(payrollMonthsTable)
    .where(and(eq(payrollMonthsTable.userId, userId), eq(payrollMonthsTable.month, month)))
    .limit(1);
  const emps = await db
    .select({ fixedSalary: employeesTable.fixedSalary })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId));
  const empSalary = emps.reduce((max, row) => Math.max(max, Math.round(Number(row.fixedSalary) || 0)), 0);
  const salary = Math.max(0, Math.round(Number(self?.salary || pay?.salary || empSalary || 0)));
  const sheets = await db
    .select({
      day: payrollDaysTable.day,
      status: payrollDaysTable.status,
      publishedJarima: payrollDaysTable.publishedJarima,
      publishedNote: payrollDaysTable.publishedNote,
    })
    .from(payrollDaysTable)
    .where(and(eq(payrollDaysTable.userId, userId), gte(payrollDaysTable.day, from), lte(payrollDaysTable.day, to)));
  const byDay = new Map(sheets.map((row) => [row.day, row]));
  const days: Array<{ date: string; salary: number; jarima: number; kind: "late" | "absent" | null; n: number; note: string }> = [];
  for (let cursor = from; cursor <= to; cursor = nextIsoDay(cursor)) {
    const event = self?.events.find((item) => item.date === cursor);
    const sheet = byDay.get(cursor);
    let jarima = Math.max(0, Math.round(event?.amount || 0));
    let note = event ? (event.kind === "late" ? "Kech kelindi" : "Kelmagansiz") : "";
    if (sheet?.status === "returned") {
      jarima = 0;
      note = "Qaytarilgan";
    } else if (sheet?.status === "approved") {
      jarima = Math.max(0, sheet.publishedJarima ?? jarima);
      note = sheet.publishedNote || note;
    }
    days.push({
      date: cursor,
      salary: salaryShareOnDates(salary, month, [cursor]),
      jarima,
      kind: event?.kind ?? null,
      n: event?.n ?? 0,
      note,
    });
  }
  return { month, monthLabel, salary, days };
}

function nextIsoDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
