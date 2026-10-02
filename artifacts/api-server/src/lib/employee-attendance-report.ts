import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  attendanceRecordsTable,
  candidatesTable,
  db,
  departmentsTable,
  employeeDayShiftPlansTable,
  employeesTable,
  pool,
  tasksTable,
  usersTable,
} from "@workspace/db";
import { addDaysYmd, type ShiftKey } from "./attendance-engine";
import { hmToMinutes, workScheduleForStaff, type WorkSchedule } from "./shift-hours";
import { getEffectiveShiftDefs } from "./shift-schedule";
import { isScheduledRestDay, isWeekendYmd } from "./ofis-weekend";
import {
  loadScheduleOverrides,
  pickScheduleOverride,
  workScheduleFromOverride,
} from "./employee-schedule-override";
import { scriptIncludes } from "./script-search";
import { stripGpsSuffix } from "./geo-location";
import { tashkentYmd } from "./employment-span";
import { syncApprovedJavobExcuses } from "./javob-exemptions";

export const APPROVER_NAME = "Saidmuhammadalixon";
export const APPROVER_LINE = "Tasdiqlaydi platforma masʼuli Saidmuhammadalixon";
export const SEALED_TITLE = "Hisobot VAKSINAMEDHR";

export const DAY_STATUSES = ["present", "late", "absent", "incomplete", "leave", "planned", "rest"] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

const STATUS_LABEL: Record<DayStatus, string> = {
  present: "Kelgan",
  late: "Kechikkan",
  absent: "Kelmagan",
  incomplete: "Chala kun",
  leave: "Ta'til",
  planned: "Hali kelmagan",
  rest: "Dam kuni",
};

const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];

export type EmployeeDay = {
  date: string;
  weekday: string;
  status: DayStatus;
  statusLabel: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: string | null;
  branch: string | null;
  excused?: boolean;
  excuseNote?: string | null;
};

export type EmployeeTaskItem = {
  id: number;
  title: string;
  status: string;
  statusLabel: string;
  dueLabel: string;
  bucket: "remaining" | "done" | "cancelled";
};

export type EmployeeTaskBlock = {
  total: number;
  remaining: number;
  inProgress: number;
  done: number;
  notDone: number;
  cancelled: number;
  items: EmployeeTaskItem[];
};

export type EmployeeAttendanceReport = {
  employee: {
    id: number;
    fullName: string;
    position: string;
    roleLabel: string;
    branch: string;
    phone: string | null;
    login: string | null;
    shift: string;
    hiredAt: string | null;
    statusLabel: string;
    department: string | null;
    attendanceTracked: boolean;
    photoUrl: string | null;
    birthDate: string | null;
    staffCode: string;
  };
  from: string;
  to: string;
  dayCount: number;
  statuses: DayStatus[];
  days: EmployeeDay[];
  summary: {
    present: number;
    late: number;
    absent: number;
    incomplete: number;
    leave: number;
    planned: number;
    rest: number;
    came: number;
    total: number;
    presentRate: number | null;
  };
  tasks: EmployeeTaskBlock;
  access: {
    joinedAt: string | null;
    firstSeenAt: string | null;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
  };
  javob: {
    total: number;
    approved: number;
    pending: number;
    rejected: number;
    items: Array<{
      id: number;
      date: string;
      fromHm: string;
      toHm: string;
      note: string;
      statusLabel: string;
      coordinator: string | null;
      coordinatorAt: string | null;
      hr: string | null;
      hrAt: string | null;
    }>;
  };
  attestatsiya: {
    total: number;
    passed: number;
    failed: number;
    items: Array<{
      id: number;
      title: string;
      statusLabel: string;
      score: number | null;
      passed: boolean | null;
      correct: number | null;
      total: number;
      when: string | null;
    }>;
  };
  darslik: {
    tracks: Array<{
      track: string;
      passed: number;
      total: number;
      percent: number;
      done: boolean;
    }>;
  };
};

export type SealedEmployeeReport = {
  kind: "employee-attendance";
  title: string;
  approverName: string;
  approverLine: string;
  sealedAt: string;
  report: EmployeeAttendanceReport;
};

function todayTashkentYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 1200) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
    guard += 1;
  }
  return out;
}

function weekdayOf(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00+05:00`);
  return WEEKDAYS[d.getUTCDay()] ?? "";
}

function hm(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function roleLabel(orgRole: string | null, position: string): string {
  const r = String(orgRole || "").toLowerCase();
  if (r === "manager" || r === "mudir") return "Mudir";
  if (r === "pharmacist" || r === "farmasevt") return "Farmasevt";
  if (r === "intern" || r === "stajyor") return "Stajyor";
  if (r === "supervisor" || r === "coordinator" || r === "koordinator") return "Koordinator";
  if (r === "revizor") return "Revizor";
  const p = String(position || "").trim();
  return p || "Xodim";
}

function shiftDisplay(shiftType?: string | null, shiftLabel?: string | null): string {
  const label = String(shiftLabel || "").trim();
  if (label) return label;
  const t = String(shiftType || "one").toLowerCase();
  if (t === "two" || t === "2") return "2-smena";
  if (t === "three" || t === "3") return "3-smena";
  if (t === "office") return "Ofis";
  return "1-smena";
}

export function parseStatuses(raw: unknown): DayStatus[] {
  const parts = Array.isArray(raw)
    ? raw.map(String)
    : String(raw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  const set = new Set<DayStatus>();
  for (const p of parts) {
    if ((DAY_STATUSES as readonly string[]).includes(p)) set.add(p as DayStatus);
  }
  if (!set.size) {
    return DAY_STATUSES.filter((s) => s !== "planned");
  }
  return DAY_STATUSES.filter((s) => set.has(s));
}

function summarize(days: EmployeeDay[]) {
  const summary = {
    present: 0,
    late: 0,
    absent: 0,
    incomplete: 0,
    leave: 0,
    planned: 0,
    rest: 0,
    came: 0,
    total: days.length,
    presentRate: null as number | null,
  };
  for (const d of days) {
    if (d.excused) {
      summary.present += 1;
      continue;
    }
    summary[d.status] += 1;
  }
  summary.came = summary.present + summary.late + summary.incomplete;
  const base = summary.came + summary.absent;
  summary.presentRate = base > 0 ? Math.round((summary.came / base) * 1000) / 10 : null;
  return summary;
}

function hoursBetween(checkIn: Date | null | undefined, checkOut: Date | null | undefined): string | null {
  if (!checkIn || !checkOut) return null;
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} daq`;
  return m ? `${h} soat ${m} daq` : `${h} soat`;
}

function employmentLabel(status: string | null | undefined): string {
  const s = String(status || "").toLowerCase();
  if (s === "working") return "Ishlaydi";
  if (s === "dismissed") return "Bo‘shatilgan";
  if (s === "new") return "Yangi";
  if (s === "terminated") return "Bo‘shatilgan";
  if (s === "on_leave") return "Ta’tilda";
  if (s === "active") return "Faol";
  if (s === "vacant") return "Bo‘sh";
  return s || "—";
}

function userRoleLabel(role: string | null | undefined): string {
  const r = String(role || "").toLowerCase();
  const map: Record<string, string> = {
    admin: "Admin",
    director: "Direktor",
    hr: "HR",
    hr_direktor: "HR direktor",
    recruiter: "Rekruter",
    mudir: "Mudir",
    koordinator: "Koordinator",
    farmasevt: "Farmasevt",
    stajyor: "Stajyor",
    revizor: "Revizor",
    reviziya_rahbar: "Reviziya rahbari",
    moliyachi: "Moliyachi",
    sb: "Xavfsizlik",
    sb_boshliq: "Xavfsizlik boshlig‘i",
  };
  return map[r] || (r ? r : "Foydalanuvchi");
}

const TASK_STATUS_LABEL: Record<string, string> = {
  todo: "Bajarilmagan",
  in_progress: "Jarayonda",
  done: "Bajarilgan",
  verified: "Tasdiqlangan",
  cancelled: "Bekor",
};

function taskBucket(status: string): EmployeeTaskItem["bucket"] {
  if (status === "done" || status === "verified") return "done";
  if (status === "cancelled") return "cancelled";
  return "remaining";
}

function dueLabel(value: Date | null): string {
  if (!value) return "Muddat yo‘q";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function whenLabel(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date}, ${time}`;
}

function cleanBranch(location: string | null | undefined): string {
  const s = stripGpsSuffix(location);
  if (!s) return "—";
  if (/[°º]/.test(s) || /\d+\s*['’′]\s*\d+/.test(s)) return "—";
  return s;
}

const JAVOB_STATUS: Record<string, string> = {
  pending_coord: "Koordinator kutilyapti",
  pending_hr: "HR kutilyapti",
  approved: "Tasdiqlangan",
  rejected: "Rad etilgan",
  cancelled: "Bekor",
};

const ATTEMPT_STATUS: Record<string, string> = {
  in_progress: "Jarayonda",
  submitted: "Topshirilgan",
  expired: "Muddati o‘tgan",
  annulled: "Bekor",
};

/** Kelish smena boshlanishi + ruxsat daqiqasidan keyin bo‘lsa kechikkan. */
function cameStatus(checkInHm: string, schedule: WorkSchedule): "present" | "late" {
  const grace = schedule.graceMinutes > 0 ? schedule.graceMinutes : 15;
  let arrived = hmToMinutes(checkInHm);
  const start = hmToMinutes(schedule.start);
  if (!Number.isFinite(arrived) || !Number.isFinite(start)) return "present";
  if (schedule.overnight && arrived < start) arrived += 24 * 60;
  return arrived - start > grace ? "late" : "present";
}

function scheduleForDay(
  planKeys: string[] | undefined,
  staff: {
    userRole?: string | null;
    orgRole?: string | null;
    shiftType?: string | null;
    shiftLabel?: string | null;
  } | null,
  defs: Awaited<ReturnType<typeof getEffectiveShiftDefs>>,
): WorkSchedule {
  const keys = (planKeys || []).filter((k): k is ShiftKey => k === "one" || k === "two" || k === "three");
  if (keys.length) {
    return workScheduleForStaff(staff?.userRole, staff?.orgRole, keys.join("+"), null, defs);
  }
  return workScheduleForStaff(staff?.userRole, staff?.orgRole, staff?.shiftType, staff?.shiftLabel, defs);
}

function classify(
  rec: { status: string; checkInAt: Date | null; checkOutAt: Date | null } | undefined,
  ymd: string,
  today: string,
  schedule: WorkSchedule,
  staff: {
    userRole?: string | null;
    orgRole?: string | null;
    position?: string | null;
    shiftType?: string | null;
  } | null,
): DayStatus {
  const st = String(rec?.status || "").toLowerCase();
  if (st === "leave") return "leave";
  const hasIn = Boolean(rec?.checkInAt);
  const hasOut = Boolean(rec?.checkOutAt);
  if (hasIn && !hasOut) return "incomplete";
  if (hasIn) {
    const checkInHm = hm(rec?.checkInAt);
    if (!checkInHm) return "present";
    return cameStatus(checkInHm, schedule);
  }
  if (ymd > today) return "planned";
  if (staff && isReportRestDay(ymd, staff)) return "rest";
  return "absent";
}

/** Ofis, xavfsizlik grafigi va admin (shanba–yakshanba). Dorixona smenasiga tegmaydi. */
function isReportRestDay(
  ymd: string,
  staff: {
    userRole?: string | null;
    orgRole?: string | null;
    position?: string | null;
    shiftType?: string | null;
  },
): boolean {
  if (isScheduledRestDay(ymd, staff)) return true;
  const role = String(staff.userRole || "").trim().toLowerCase();
  const position = String(staff.position || "").trim();
  return (role === "admin" || /^admin$/i.test(position)) && isWeekendYmd(ymd);
}

/** Platforma hisoboti shu kundan boshlanadi. Undan oldingi kunlar hisobotga kirmaydi. */
export const PLATFORM_START = "2026-09-01";

export function resolveRange(fromRaw: unknown, toRaw: unknown): { from: string; to: string } | { error: string } {
  const today = todayTashkentYmd();
  let from = typeof fromRaw === "string" && isYmd(fromRaw) ? fromRaw : addDaysYmd(today, -29);
  let to = typeof toRaw === "string" && isYmd(toRaw) ? toRaw : today;
  if (to > today) to = today;
  if (to < PLATFORM_START) return { error: "Hisobot faqat 01.09.2026 dan boshlanadi" };
  if (from < PLATFORM_START) from = PLATFORM_START;
  if (from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  if (from < PLATFORM_START) from = PLATFORM_START;
  const days = eachDateInclusive(from, to);
  if (days.length > 1100) return { error: "Davr 3 yildan oshmasin" };
  if (!days.length) return { error: "Sana oralig‘i noto‘g‘ri" };
  return { from, to };
}

export async function searchEmployees(q: string) {
  const query = q.trim().slice(0, 80);
  if (query.length < 2) return [];
  const staffAll = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      orgRole: employeesTable.orgRole,
      location: employeesTable.location,
      employmentStatus: employeesTable.employmentStatus,
      hiredAt: employeesTable.hiredAt,
      userId: employeesTable.userId,
      phone: usersTable.phone,
      login: usersTable.login,
      userRole: usersTable.role,
      userFullName: usersTable.fullName,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .orderBy(asc(employeesTable.fullName));
  const staff = staffAll
    .filter((r) =>
      scriptIncludes(
        [r.fullName, r.userFullName, r.position, r.location, r.phone, r.login, String(r.id)].filter(Boolean).join(" "),
        query,
      ),
    )
    .slice(0, 20);

  const linkedUsers = new Set(staff.map((r) => r.userId).filter((id): id is number => id != null));
  const accountsAll = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      phone: usersTable.phone,
      login: usersTable.login,
      status: usersTable.status,
    })
    .from(usersTable)
    .orderBy(asc(usersTable.fullName));
  const accounts = accountsAll.filter((u) =>
    scriptIncludes([u.fullName, u.phone, u.login, String(u.id)].filter(Boolean).join(" "), query),
  );

  const fromStaff = staff.map((r) => ({
    id: r.id,
    employeeId: r.id,
    userId: r.userId,
    fullName: r.fullName,
    roleLabel: roleLabel(r.orgRole, r.position) || userRoleLabel(r.userRole),
    branch: cleanBranch(r.location),
    phone: r.phone,
    login: r.login,
    employmentStatus: r.employmentStatus,
    hiredAt: r.hiredAt,
  }));
  const fromUsers = accounts
    .filter((u) => !linkedUsers.has(u.id))
    .map((u) => ({
      id: u.id,
      employeeId: null as number | null,
      userId: u.id,
      fullName: u.fullName,
      roleLabel: userRoleLabel(u.role),
      branch: "—",
      phone: u.phone,
      login: u.login,
      employmentStatus: u.status,
      hiredAt: null as string | null,
    }));
  return [...fromStaff, ...fromUsers].slice(0, 25);
}

async function loadTasks(employeeId: number | null, userId: number | null): Promise<EmployeeTaskBlock> {
  const empty: EmployeeTaskBlock = {
    total: 0,
    remaining: 0,
    inProgress: 0,
    done: 0,
    notDone: 0,
    cancelled: 0,
    items: [],
  };
  const parts = [];
  if (employeeId) parts.push(and(eq(tasksTable.assigneeKind, "employee"), eq(tasksTable.assigneeId, employeeId)));
  if (userId) parts.push(and(eq(tasksTable.assigneeKind, "user"), eq(tasksTable.assigneeId, userId)));
  if (!parts.length) return empty;
  const rows = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      status: tasksTable.status,
      dueAt: tasksTable.dueAt,
    })
    .from(tasksTable)
    .where(parts.length === 1 ? parts[0] : or(...parts))
    .orderBy(desc(tasksTable.updatedAt))
    .limit(200);
  const items: EmployeeTaskItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    statusLabel: TASK_STATUS_LABEL[row.status] || row.status,
    dueLabel: dueLabel(row.dueAt),
    bucket: taskBucket(row.status),
  }));
  return {
    total: items.length,
    remaining: items.filter((t) => t.bucket === "remaining").length,
    inProgress: items.filter((t) => t.status === "in_progress").length,
    done: items.filter((t) => t.bucket === "done").length,
    notDone: items.filter((t) => t.status === "todo").length,
    cancelled: items.filter((t) => t.bucket === "cancelled").length,
    items,
  };
}

async function loadAccess(userId: number | null) {
  const empty = { joinedAt: null as string | null, firstSeenAt: null, lastLoginAt: null, lastSeenAt: null };
  if (!userId) return empty;
  const [user] = await db
    .select({ createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const devices = await pool.query<{ first_seen_at: Date | null; last_login_at: Date | null; last_seen_at: Date | null }>(
    `SELECT MIN(first_seen_at) AS first_seen_at,
            MAX(last_login_at) AS last_login_at,
            MAX(last_seen_at) AS last_seen_at
     FROM user_devices WHERE user_id = $1`,
    [userId],
  );
  const row = devices.rows[0];
  return {
    joinedAt: whenLabel(user?.createdAt),
    firstSeenAt: whenLabel(row?.first_seen_at),
    lastLoginAt: whenLabel(row?.last_login_at),
    lastSeenAt: whenLabel(row?.last_seen_at),
  };
}

async function loadJavob(employeeId: number | null, userId: number | null, from: string, to: string) {
  const empty = { total: 0, approved: 0, pending: 0, rejected: 0, items: [] as EmployeeAttendanceReport["javob"]["items"] };
  if (!employeeId && !userId) return empty;
  const found = await pool.query<{
    id: number;
    work_date: string;
    from_hm: string;
    to_hm: string;
    note: string;
    status: string;
    coord_name: string | null;
    coord_decided_at: Date | null;
    hr_name: string | null;
    decided_at: Date | null;
  }>(
    `SELECT r.id, r.work_date, r.from_hm, r.to_hm, r.note, r.status,
            cu.full_name AS coord_name, r.coord_decided_at,
            hu.full_name AS hr_name, r.decided_at
     FROM javob_olish_requests r
     LEFT JOIN users cu ON cu.id = r.coord_decided_by_id
     LEFT JOIN users hu ON hu.id = r.decided_by_id
     WHERE r.work_date >= $3 AND r.work_date <= $4
       AND (
         ($1::int IS NOT NULL AND r.employee_id = $1)
         OR ($2::int IS NOT NULL AND r.user_id = $2)
       )
     ORDER BY r.work_date DESC, r.id DESC
     LIMIT 80`,
    [employeeId, userId, from, to],
  );
  const items = found.rows.map((r) => ({
    id: r.id,
    date: r.work_date,
    fromHm: r.from_hm,
    toHm: r.to_hm,
    note: r.note,
    statusLabel: JAVOB_STATUS[r.status] || r.status,
    coordinator: r.coord_name,
    coordinatorAt: whenLabel(r.coord_decided_at),
    hr: r.hr_name,
    hrAt: whenLabel(r.decided_at),
  }));
  return {
    total: items.length,
    approved: items.filter((i) => i.statusLabel === "Tasdiqlangan").length,
    pending: items.filter((i) => i.statusLabel.includes("kutil")).length,
    rejected: items.filter((i) => i.statusLabel === "Rad etilgan" || i.statusLabel === "Bekor").length,
    items,
  };
}

async function loadAttestatsiya(userId: number | null, from: string, to: string) {
  const empty = { total: 0, passed: 0, failed: 0, items: [] as EmployeeAttendanceReport["attestatsiya"]["items"] };
  if (!userId) return empty;
  const found = await pool.query<{
    id: number;
    title: string;
    status: string;
    score: number | null;
    passed: boolean | null;
    correct: number | null;
    total: number;
    started_at: Date | null;
    submitted_at: Date | null;
  }>(
    `SELECT a.id, e.title, a.status, a.score, a.passed, a.correct, a.total, a.started_at, a.submitted_at
     FROM attestatsiya_attempts a
     JOIN attestatsiya_exams e ON e.id = a.exam_id
     WHERE a.user_id = $1
       AND (a.started_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN $2::date AND $3::date
     ORDER BY a.started_at DESC
     LIMIT 40`,
    [userId, from, to],
  );
  const items = found.rows.map((r) => ({
    id: r.id,
    title: r.title,
    statusLabel: ATTEMPT_STATUS[r.status] || r.status,
    score: r.score,
    passed: r.passed,
    correct: r.correct,
    total: r.total,
    when: whenLabel(r.submitted_at || r.started_at),
  }));
  return {
    total: items.length,
    passed: items.filter((i) => i.passed === true).length,
    failed: items.filter((i) => i.passed === false).length,
    items,
  };
}

async function loadDarslik(userId: number | null) {
  if (!userId) return { tracks: [] as EmployeeAttendanceReport["darslik"]["tracks"] };
  const found = await pool.query<{ track: string; lessons_json: Record<string, { passed?: boolean }> | null; completed_at: Date | null; lesson_count: number }>(
    `SELECT p.track, p.lessons_json, p.completed_at,
            (SELECT count(*)::int FROM darslik_lessons l WHERE l.track = p.track AND l.published) AS lesson_count
     FROM darslik_progress p
     WHERE p.user_id = $1`,
    [userId],
  );
  const labels: Record<string, string> = { stajyor: "Stajyor", farmasevt: "Farmasevt", mudir: "Mudir" };
  return {
    tracks: found.rows.map((r) => {
      const passed = Object.values(r.lessons_json || {}).filter((x) => x?.passed).length;
      const total = Number(r.lesson_count) || 0;
      return {
        track: labels[r.track] || r.track,
        passed,
        total,
        percent: total > 0 ? Math.round((passed / total) * 100) : 0,
        done: Boolean(r.completed_at) || (total > 0 && passed >= total),
      };
    }),
  };
}

export async function buildEmployeeAttendanceReport(input: {
  employeeId?: number | null;
  userId?: number | null;
  from: string;
  to: string;
  statuses: DayStatus[];
}): Promise<EmployeeAttendanceReport | null> {
  let employeeId = input.employeeId && input.employeeId > 0 ? input.employeeId : null;
  let userId = input.userId && input.userId > 0 ? input.userId : null;
  if (!employeeId && !userId) return null;

  const empQuery = employeeId
    ? eq(employeesTable.id, employeeId)
    : userId
      ? eq(employeesTable.userId, userId)
      : sql`false`;
  const [emp] = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      orgRole: employeesTable.orgRole,
      location: employeesTable.location,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      hiredAt: employeesTable.hiredAt,
      photoUrl: employeesTable.photoUrl,
      candidateId: employeesTable.candidateId,
      employmentStatus: employeesTable.employmentStatus,
      updatedAt: employeesTable.updatedAt,
      userId: employeesTable.userId,
      phone: usersTable.phone,
      login: usersTable.login,
      userRole: usersTable.role,
      departmentId: usersTable.departmentId,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .where(empQuery)
    .limit(1);

  let account: {
    id: number;
    fullName: string;
    role: string;
    phone: string | null;
    login: string;
    status: string;
    departmentId: number | null;
  } | null = null;
  if (!emp && userId) {
    const [user] = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        role: usersTable.role,
        phone: usersTable.phone,
        login: usersTable.login,
        status: usersTable.status,
        departmentId: usersTable.departmentId,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    account = user ?? null;
    if (!account) return null;
  }
  if (emp) {
    employeeId = emp.id;
    userId = emp.userId ?? userId;
  }

  const departmentId = emp?.departmentId ?? account?.departmentId ?? null;
  let department: string | null = null;
  if (departmentId) {
    const [dept] = await db
      .select({ name: departmentsTable.name })
      .from(departmentsTable)
      .where(eq(departmentsTable.id, departmentId))
      .limit(1);
    department = dept?.name ?? null;
  }

  const who = employeeId
    ? eq(attendanceRecordsTable.employeeId, employeeId)
    : eq(attendanceRecordsTable.userId, userId!);
  if (employeeId) await syncApprovedJavobExcuses([employeeId], input.from, input.to);
  const records = await db
    .select({
      workDate: attendanceRecordsTable.workDate,
      status: attendanceRecordsTable.status,
      checkInAt: attendanceRecordsTable.checkInAt,
      checkOutAt: attendanceRecordsTable.checkOutAt,
      branch: attendanceRecordsTable.resolvedBranchLabel,
      excused: attendanceRecordsTable.excused,
      excuseNote: attendanceRecordsTable.excuseNote,
    })
    .from(attendanceRecordsTable)
    .where(and(who, gte(attendanceRecordsTable.workDate, input.from), lte(attendanceRecordsTable.workDate, input.to)));

  const byDate = new Map<string, (typeof records)[number]>();
  for (const rec of records) {
    const prev = byDate.get(rec.workDate);
    if (!prev || (!prev.checkInAt && rec.checkInAt)) byDate.set(rec.workDate, rec);
  }

  const today = todayTashkentYmd();
  const wanted = new Set(input.statuses);
  const shiftDefs = await getEffectiveShiftDefs();
  const scheduleRules = emp
    ? await loadScheduleOverrides([emp.id], input.from, input.to)
    : new Map();
  const dayPlans = emp
    ? await db
        .select({
          workDate: employeeDayShiftPlansTable.workDate,
          shiftKeys: employeeDayShiftPlansTable.shiftKeys,
        })
        .from(employeeDayShiftPlansTable)
        .where(
          and(
            eq(employeeDayShiftPlansTable.employeeId, emp.id),
            gte(employeeDayShiftPlansTable.workDate, input.from),
            lte(employeeDayShiftPlansTable.workDate, input.to),
          ),
        )
    : [];
  const planByDate = new Map(dayPlans.map((row) => [row.workDate, row.shiftKeys || []]));
  const staffShift = emp
    ? {
        userRole: emp.userRole,
        orgRole: emp.orgRole,
        shiftType: emp.shiftType,
        shiftLabel: emp.shiftLabel,
        position: emp.position,
      }
    : account
      ? { userRole: account.role, orgRole: null, shiftType: null, shiftLabel: null, position: null }
      : null;
  const hiredYmd = emp?.hiredAt && isYmd(String(emp.hiredAt).slice(0, 10)) ? String(emp.hiredAt).slice(0, 10) : null;
  const firstPunch = records.map((r) => r.workDate).sort()[0] || null;
  let spanFrom = input.from < PLATFORM_START ? PLATFORM_START : input.from;
  if (hiredYmd && hiredYmd > spanFrom) spanFrom = hiredYmd;
  else if (!hiredYmd && firstPunch && firstPunch > spanFrom) spanFrom = firstPunch;
  if (spanFrom < PLATFORM_START) spanFrom = PLATFORM_START;
  let spanTo = input.to > today ? today : input.to;
  const dismissedYmd =
    emp && (emp.employmentStatus === "dismissed" || emp.employmentStatus === "closed")
      ? tashkentYmd(emp.updatedAt)
      : null;
  if (dismissedYmd && dismissedYmd < spanTo) spanTo = dismissedYmd;
  if (spanTo < PLATFORM_START) spanTo = PLATFORM_START;
  if (spanFrom > spanTo) spanFrom = spanTo;
  const attendanceTracked = Boolean(emp) || records.length > 0;
  const days: EmployeeDay[] = [];
  if (attendanceTracked && (!(!hiredYmd && !firstPunch))) {
    for (const ymd of eachDateInclusive(spanFrom, spanTo)) {
      const rec = byDate.get(ymd);
      const ov = pickScheduleOverride(scheduleRules.get(emp?.id || 0), ymd);
      const schedule = ov
        ? workScheduleFromOverride(ov, shiftDefs.office.graceMinutes)
        : scheduleForDay(planByDate.get(ymd), staffShift, shiftDefs);
      const status = classify(
        rec,
        ymd,
        today,
        schedule,
        ov ? (ov.shiftKey === "office" ? { userRole: "hr_menejer", orgRole: null, position: null, shiftType: null } : null) : staffShift,
      );
      if (!wanted.has(status)) continue;
      const excused = Boolean(rec?.excused);
      days.push({
        date: ymd,
        weekday: weekdayOf(ymd),
        status,
        statusLabel: excused ? "Sababli" : STATUS_LABEL[status],
        checkIn: hm(rec?.checkInAt),
        checkOut: hm(rec?.checkOutAt),
        hours: hoursBetween(rec?.checkInAt, rec?.checkOutAt),
        branch: rec?.branch ? cleanBranch(String(rec.branch)) : null,
        excused,
        excuseNote: excused ? rec?.excuseNote || null : null,
      });
    }
  }

  let photoUrl = emp?.photoUrl || null;
  let birthDate: string | null = null;
  if (emp?.candidateId) {
    const [cand] = await db
      .select({ birthDate: candidatesTable.birthDate, photoUrl: candidatesTable.photoUrl })
      .from(candidatesTable)
      .where(eq(candidatesTable.id, emp.candidateId))
      .limit(1);
    birthDate = cand?.birthDate || null;
    if (!photoUrl) photoUrl = cand?.photoUrl || null;
  }
  if (!photoUrl && userId) {
    const face = await pool.query<{ photo_url: string | null }>(
      `SELECT photo_url FROM face_profiles WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    photoUrl = face.rows[0]?.photo_url || null;
  }
  const staffCode = `VMHR-${String((emp?.id ?? account?.id ?? 0)).padStart(6, "0")}`;

  const tasks = await loadTasks(employeeId, userId);
  const access = await loadAccess(userId);
  const javob = await loadJavob(employeeId, userId, spanFrom, spanTo);
  const attestatsiya = await loadAttestatsiya(userId, spanFrom, spanTo);
  const darslik = await loadDarslik(userId);
  const summary = summarize(days);
  if (!attendanceTracked) summary.presentRate = null;

  return {
    employee: emp
      ? {
          id: emp.id,
          fullName: emp.fullName,
          position: emp.position,
          roleLabel: roleLabel(emp.orgRole, emp.position),
          branch: cleanBranch(emp.location),
          phone: emp.phone,
          login: emp.login,
          shift: shiftDisplay(emp.shiftType, emp.shiftLabel),
          hiredAt: emp.hiredAt,
          statusLabel: employmentLabel(emp.employmentStatus),
          department,
          attendanceTracked,
          photoUrl,
          birthDate,
          staffCode,
        }
      : {
          id: account!.id,
          fullName: account!.fullName,
          position: userRoleLabel(account!.role),
          roleLabel: userRoleLabel(account!.role),
          branch: department || "—",
          phone: account!.phone,
          login: account!.login,
          shift: "—",
          hiredAt: null,
          statusLabel: employmentLabel(account!.status),
          department,
          attendanceTracked,
          photoUrl,
          birthDate,
          staffCode,
        },
    from: spanFrom,
    to: spanTo,
    dayCount: eachDateInclusive(spanFrom, spanTo).length,
    statuses: input.statuses,
    days,
    summary,
    tasks,
    access,
    javob,
    attestatsiya,
    darslik,
  };
}

export async function sealEmployeeReport(input: {
  report: EmployeeAttendanceReport;
  sealedBy: number | null;
}): Promise<{ token: string; sealedAt: string; payload: SealedEmployeeReport }> {
  const sealedAt = new Date().toISOString();
  const payload: SealedEmployeeReport = {
    kind: "employee-attendance",
    title: SEALED_TITLE,
    approverName: APPROVER_NAME,
    approverLine: APPROVER_LINE,
    sealedAt,
    report: input.report,
  };
  const token = randomBytes(18).toString("base64url");
  const inserted = await pool.query<{ sealed_at: Date }>(
    `INSERT INTO employee_attendance_seals (token, payload, sealed_by, approver_name, sealed_at)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     RETURNING sealed_at`,
    [token, JSON.stringify(payload), input.sealedBy, APPROVER_NAME, sealedAt],
  );
  const at = inserted.rows[0]?.sealed_at;
  return {
    token,
    sealedAt: at ? new Date(at).toISOString() : sealedAt,
    payload,
  };
}

/** Bir nechta xodimning kunlik holati — yakka hisobotdagi tasnif bilan bir xil. */
export async function buildStaffAttendanceDays(input: {
  employeeIds: number[];
  from: string;
  to: string;
}): Promise<
  Array<{
    employeeId: number;
    days: EmployeeDay[];
  }>
> {
  const ids = [...new Set(input.employeeIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return [];
  await syncApprovedJavobExcuses(ids, input.from, input.to);
  const emps = await db
    .select({
      id: employeesTable.id,
      userRole: usersTable.role,
      orgRole: employeesTable.orgRole,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      position: employeesTable.position,
      hiredAt: employeesTable.hiredAt,
      employmentStatus: employeesTable.employmentStatus,
      updatedAt: employeesTable.updatedAt,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .where(inArray(employeesTable.id, ids));
  const records = await db
    .select({
      employeeId: attendanceRecordsTable.employeeId,
      workDate: attendanceRecordsTable.workDate,
      status: attendanceRecordsTable.status,
      checkInAt: attendanceRecordsTable.checkInAt,
      checkOutAt: attendanceRecordsTable.checkOutAt,
      branch: attendanceRecordsTable.resolvedBranchLabel,
      excused: attendanceRecordsTable.excused,
      excuseNote: attendanceRecordsTable.excuseNote,
    })
    .from(attendanceRecordsTable)
    .where(
      and(
        inArray(attendanceRecordsTable.employeeId, ids),
        gte(attendanceRecordsTable.workDate, input.from),
        lte(attendanceRecordsTable.workDate, input.to),
      ),
    );
  const plans = await db
    .select({
      employeeId: employeeDayShiftPlansTable.employeeId,
      workDate: employeeDayShiftPlansTable.workDate,
      shiftKeys: employeeDayShiftPlansTable.shiftKeys,
    })
    .from(employeeDayShiftPlansTable)
    .where(
      and(
        inArray(employeeDayShiftPlansTable.employeeId, ids),
        gte(employeeDayShiftPlansTable.workDate, input.from),
        lte(employeeDayShiftPlansTable.workDate, input.to),
      ),
    );
  const shiftDefs = await getEffectiveShiftDefs();
  const overrides = await loadScheduleOverrides(ids, input.from, input.to);
  const today = todayTashkentYmd();
  const byEmpDate = new Map<string, (typeof records)[number]>();
  for (const rec of records) {
    const key = `${rec.employeeId}|${rec.workDate}`;
    const prev = byEmpDate.get(key);
    if (!prev || (!prev.checkInAt && rec.checkInAt)) byEmpDate.set(key, rec);
  }
  const plansByEmp = new Map<number, Map<string, string[]>>();
  for (const plan of plans) {
    const map = plansByEmp.get(plan.employeeId) ?? new Map<string, string[]>();
    map.set(plan.workDate, plan.shiftKeys || []);
    plansByEmp.set(plan.employeeId, map);
  }
  return emps.map((emp) => {
    const staffShift = {
      userRole: emp.userRole,
      orgRole: emp.orgRole,
      shiftType: emp.shiftType,
      shiftLabel: emp.shiftLabel,
      position: emp.position,
    };
    const hiredYmd = emp.hiredAt && isYmd(String(emp.hiredAt).slice(0, 10)) ? String(emp.hiredAt).slice(0, 10) : null;
    let spanFrom = input.from < PLATFORM_START ? PLATFORM_START : input.from;
    if (hiredYmd && hiredYmd > spanFrom) spanFrom = hiredYmd;
    if (spanFrom > input.to) spanFrom = input.to;
    const dismissedYmd =
      emp.employmentStatus === "dismissed" || emp.employmentStatus === "closed"
        ? tashkentYmd(emp.updatedAt)
        : null;
    const planByDate = plansByEmp.get(emp.id) ?? new Map<string, string[]>();
    const days: EmployeeDay[] = [];
    let spanTo = input.to > today ? today : input.to;
    if (dismissedYmd && dismissedYmd < spanTo) spanTo = dismissedYmd;
    if (spanFrom > spanTo) {
      return { employeeId: emp.id, days };
    }
    for (const ymd of eachDateInclusive(spanFrom, spanTo)) {
      const rec = byEmpDate.get(`${emp.id}|${ymd}`);
      const ov = pickScheduleOverride(overrides.get(emp.id), ymd);
      const schedule = ov
        ? workScheduleFromOverride(ov, shiftDefs.office.graceMinutes)
        : scheduleForDay(planByDate.get(ymd), staffShift, shiftDefs);
      const status = classify(
        rec,
        ymd,
        today,
        schedule,
        ov ? (ov.shiftKey === "office" ? { userRole: "hr_menejer", orgRole: null, position: null, shiftType: null } : null) : staffShift,
      );
      const excused = Boolean(rec?.excused);
      days.push({
        date: ymd,
        weekday: weekdayOf(ymd),
        status,
        statusLabel: excused ? "Sababli" : STATUS_LABEL[status],
        checkIn: hm(rec?.checkInAt),
        checkOut: hm(rec?.checkOutAt),
        hours: hoursBetween(rec?.checkInAt, rec?.checkOutAt),
        branch: rec?.branch ? cleanBranch(String(rec.branch)) : null,
        excused,
        excuseNote: excused ? rec?.excuseNote || null : null,
      });
    }
    return { employeeId: emp.id, days };
  });
}

export async function readEmployeeSeal(token: string): Promise<SealedEmployeeReport | null> {
  const safe = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(safe)) return null;
  const found = await pool.query<{ payload: SealedEmployeeReport; sealed_at: Date; approver_name: string }>(
    `SELECT payload, sealed_at, approver_name
     FROM employee_attendance_seals
     WHERE token = $1
     LIMIT 1`,
    [safe],
  );
  const row = found.rows[0];
  if (!row?.payload || row.payload.kind !== "employee-attendance") return null;
  return {
    ...row.payload,
    approverName: row.approver_name || APPROVER_NAME,
    approverLine: APPROVER_LINE,
    sealedAt: row.sealed_at ? new Date(row.sealed_at).toISOString() : row.payload.sealedAt,
  };
}
