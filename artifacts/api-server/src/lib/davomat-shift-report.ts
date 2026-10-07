import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  attendanceRecordsTable,
  db,
  employeeDayShiftPlansTable,
  employeesTable,
  usersTable,
} from "@workspace/db";
import { encodeShiftKeys, parseShiftKeys, type ShiftKey } from "./attendance-engine";
import {
  loadScheduleOverrides,
  pickScheduleOverride,
  workScheduleFromOverride,
} from "./employee-schedule-override";
import { isScheduledRestDay, isWeekendYmd } from "./ofis-weekend";
import { loadWorkCalendar } from "./work-calendar";
import { formatPersonName } from "./person-name";
import { getEffectiveShiftDefs } from "./shift-schedule";
import { ORTA_SHIFT_LABEL, isOrtaShift, isPharmacyShiftStaff, workScheduleForStaff, type WorkSchedule } from "./shift-hours";
import type { ReportCoordinatorSection, ReportPerson, ReportShiftBlock } from "./davomat-shift-report-pdf";

export type BuiltSection = ReportCoordinatorSection & {
  coordinatorEmployeeId: number | null;
  userId: number | null;
  telegramId: string | null;
};

export type ShiftBucket = "one" | "two" | "12" | "23" | "three" | "orta" | "office";

const MONTHS = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentabr",
  "oktabr",
  "noyabr",
  "dekabr",
];

const BUCKET_ORDER: ShiftBucket[] = ["one", "orta", "two", "12", "23", "three", "office"];

export function dateLabelUz(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const month = MONTHS[(m || 1) - 1] || "";
  return `${d}-${month} ${y}`;
}

export function monthStartYmd(ymd: string): string {
  return `${ymd.slice(0, 8)}01`;
}

export function eachYmd(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 40) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d! + 1));
    cur = dt.toISOString().slice(0, 10);
    guard += 1;
  }
  return out;
}

export function tashkentNow(d = new Date()): { ymd: string; hour: number; minute: number; hm: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    minute,
    hm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function branchLabel(location: string | null | undefined): string {
  const raw = String(location || "")
    .split("|")[0]!
    .split("·")[0]!
    .trim();
  if (!raw || raw === "-" || raw === "—") return "";
  return raw;
}

function pharmacyKeys(raw?: string | null, label?: string | null): ShiftKey[] {
  return parseShiftKeys(raw, label).filter(
    (k): k is ShiftKey => k === "one" || k === "two" || k === "three",
  );
}

export function shiftBucketOf(
  userRole: string | null | undefined,
  orgRole: string | null | undefined,
  shiftType: string | null | undefined,
  shiftLabel: string | null | undefined,
): ShiftBucket {
  if (!isPharmacyShiftStaff(userRole, orgRole)) return "office";
  if (isOrtaShift(shiftType, shiftLabel)) return "orta";
  const keys = pharmacyKeys(shiftType, shiftLabel);
  const set = new Set(keys);
  if (set.has("two") && set.has("three")) return "23";
  if (set.has("one") && set.has("two")) return "12";
  if (set.size === 1 && set.has("three")) return "three";
  if (set.size === 1 && set.has("two")) return "two";
  return "one";
}

function bucketTitle(bucket: ShiftBucket, hours: string): { title: string; hours: string } {
  if (bucket === "12") return { title: "1+2", hours };
  if (bucket === "23") return { title: "2+3", hours };
  if (bucket === "two") return { title: "2-smena", hours };
  if (bucket === "three") return { title: "3-smena", hours };
  if (bucket === "orta") return { title: ORTA_SHIFT_LABEL, hours };
  if (bucket === "office") return { title: "Ofis", hours };
  return { title: "1-smena", hours };
}

type EmpNode = {
  id: number;
  fullName: string;
  reportsToId: number | null;
  assignedBranchId: number | null;
  orgRole: string | null;
  userRole: string | null;
  userId: number | null;
  telegramId: string | null;
  shiftType: string | null;
  shiftLabel: string | null;
  position: string;
  location: string | null;
  hiredAt: string | null;
  employmentStatus: string | null;
};

export type CoordHit = { id: number; name: string; userId: number | null; telegramId: string | null };

function resolveCoordinator(employeeId: number, byId: Map<number, EmpNode>): CoordHit | null {
  const start = byId.get(employeeId);
  if (!start) return null;
  const seen = new Set<number>();
  let nextId = start.reportsToId ?? start.assignedBranchId ?? null;
  for (let i = 0; i < 8 && nextId != null; i++) {
    if (seen.has(nextId)) return null;
    seen.add(nextId);
    const node = byId.get(nextId);
    if (!node) return null;
    const org = String(node.orgRole || "").toLowerCase();
    const role = String(node.userRole || "").toLowerCase();
    if (org === "coordinator" || role === "koordinator") {
      const name = formatPersonName(node.fullName) || node.fullName;
      return name ? { id: node.id, name, userId: node.userId, telegramId: node.telegramId } : null;
    }
    nextId = node.reportsToId;
  }
  return null;
}

type DayRec = {
  checkInAt: Date | null;
  checkOutAt: Date | null;
  status: string | null;
  excused: boolean;
};

function formatHm(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function atTashkent(ymd: string, hm: string): Date {
  return new Date(`${ymd}T${hm}:00+05:00`);
}

function scheduleEnd(ymd: string, sched: WorkSchedule): Date {
  const start = atTashkent(ymd, sched.start);
  let end = atTashkent(ymd, sched.end);
  if (sched.overnight || end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  return end;
}

async function loadNodes(): Promise<EmpNode[]> {
  return db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      reportsToId: employeesTable.reportsToId,
      assignedBranchId: employeesTable.assignedBranchId,
      orgRole: employeesTable.orgRole,
      userRole: usersTable.role,
      userId: employeesTable.userId,
      telegramId: usersTable.telegramId,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      position: employeesTable.position,
      location: employeesTable.location,
      hiredAt: employeesTable.hiredAt,
      employmentStatus: employeesTable.employmentStatus,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .where(
      sql`coalesce(${employeesTable.employmentStatus}, 'working') not in ('dismissed', 'closed')`,
    );
}

/** employeeId → koordinator ismi (rahbarlik zanjiri bo‘yicha) */
export async function coordinatorNamesFor(employeeIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const [id, hit] of await coordinatorsFor(employeeIds)) out.set(id, hit.name);
  return out;
}

/** employeeId → koordinator (id, ism, user, telegram) */
export async function coordinatorsFor(employeeIds: number[]): Promise<Map<number, CoordHit>> {
  const out = new Map<number, CoordHit>();
  if (!employeeIds.length) return out;
  const nodes = await loadNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const id of employeeIds) {
    const hit = resolveCoordinator(id, byId);
    if (hit) out.set(id, hit);
  }
  return out;
}

export async function buildCoordinatorShiftReport(opts: {
  ymd: string;
  employeeIds?: number[];
  buckets?: ShiftBucket[];
  coordinatorEmployeeId?: number | null;
  viewerUserId?: number | null;
  viewerRole?: string | null;
}): Promise<BuiltSection[]> {
  const nodes = await loadNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const coordOf = new Map<number, CoordHit | null>();
  for (const n of nodes) coordOf.set(n.id, resolveCoordinator(n.id, byId));

  const viewerRole = String(opts.viewerRole || "").toLowerCase();
  let allowedIds: Set<number> | null = null;
  if (viewerRole === "koordinator" && opts.viewerUserId) {
    const me = nodes.find((n) => n.userId === opts.viewerUserId);
    allowedIds = new Set(
      nodes.filter((n) => me && coordOf.get(n.id)?.id === me.id).map((n) => n.id),
    );
    if (me) allowedIds.add(me.id);
  }

  const wanted = new Set(opts.employeeIds || []);
  const skipStatus = new Set(["need_hire", "searching", "no_manager"]);
  const staff = nodes.filter((n) => {
    if (skipStatus.has(String(n.employmentStatus || ""))) return false;
    if (!String(n.fullName || "").trim()) return false;
    if (wanted.size && !wanted.has(n.id)) return false;
    if (allowedIds && !allowedIds.has(n.id)) return false;
    if (opts.coordinatorEmployeeId && coordOf.get(n.id)?.id !== opts.coordinatorEmployeeId) return false;
    const hired = String(n.hiredAt || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(hired) && hired > opts.ymd) return false;
    return true;
  });
  if (!staff.length) return [];

  const ids = staff.map((s) => s.id);
  const from = monthStartYmd(opts.ymd);
  const defs = await getEffectiveShiftDefs();
  const overrides = await loadScheduleOverrides(ids, from, opts.ymd);
  await loadWorkCalendar();
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
        gte(employeeDayShiftPlansTable.workDate, from),
        lte(employeeDayShiftPlansTable.workDate, opts.ymd),
      ),
    );
  const planMap = new Map<string, string>();
  for (const plan of plans) {
    const keys = (plan.shiftKeys || []).filter(
      (k): k is "one" | "two" | "three" => k === "one" || k === "two" || k === "three",
    );
    if (keys.length) planMap.set(`${plan.employeeId}|${plan.workDate}`, encodeShiftKeys(keys));
  }

  const records = await db
    .select({
      employeeId: attendanceRecordsTable.employeeId,
      workDate: attendanceRecordsTable.workDate,
      checkInAt: attendanceRecordsTable.checkInAt,
      checkOutAt: attendanceRecordsTable.checkOutAt,
      status: attendanceRecordsTable.status,
      excused: attendanceRecordsTable.excused,
    })
    .from(attendanceRecordsTable)
    .where(
      and(
        inArray(attendanceRecordsTable.employeeId, ids),
        gte(attendanceRecordsTable.workDate, from),
        lte(attendanceRecordsTable.workDate, opts.ymd),
      ),
    );
  const recMap = new Map<string, DayRec>();
  for (const rec of records) {
    recMap.set(`${rec.employeeId}|${rec.workDate}`, {
      checkInAt: rec.checkInAt,
      checkOutAt: rec.checkOutAt,
      status: rec.status,
      excused: Boolean(rec.excused),
    });
  }

  const days = eachYmd(from, opts.ymd);
  const bucketFilter = opts.buckets?.length ? new Set(opts.buckets) : null;

  type Built = ReportPerson & {
    bucket: ShiftBucket;
    hours: string;
    coordKey: string;
    coordId: number | null;
    coordName: string;
    coordUserId: number | null;
    coordTelegram: string | null;
  };
  const built: Built[] = [];

  for (const emp of staff) {
    const hired = String(emp.hiredAt || "").slice(0, 10);
    const scheduleFor = (ymd: string): WorkSchedule | null => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(hired) && ymd < hired) return null;
      const ov = pickScheduleOverride(overrides.get(emp.id), ymd);
      if (ov) {
        if (ov.shiftKey === "office" && isWeekendYmd(ymd)) return null;
        return workScheduleFromOverride(ov);
      }
      const planType = planMap.get(`${emp.id}|${ymd}`) || null;
      const shiftType = planType || emp.shiftType;
      const shiftLabel = planType ? null : emp.shiftLabel;
      if (
        isScheduledRestDay(ymd, {
          employeeId: emp.id,
          userRole: emp.userRole,
          orgRole: emp.orgRole,
          position: emp.position,
          shiftType: emp.shiftType,
          shiftLabel: emp.shiftLabel,
        })
      ) {
        return null;
      }
      return workScheduleForStaff(emp.userRole, emp.orgRole, shiftType, shiftLabel, defs);
    };

    const monthNotes: string[] = [];
    for (const ymd of days) {
      const sched = scheduleFor(ymd);
      if (!sched) continue;
      const rec = recMap.get(`${emp.id}|${ymd}`);
      if (rec?.excused || rec?.status === "leave") continue;
      const day = dateLabelUz(ymd).replace(/ \d{4}$/, "");
      if (!rec?.checkInAt) {
        monthNotes.push(`${day} — kelmagan`);
        continue;
      }
      const start = atTashkent(ymd, sched.start);
      const grace = (sched.graceMinutes ?? 15) * 60_000;
      if (rec.checkInAt.getTime() > start.getTime() + grace) {
        monthNotes.push(`${day} — kechikkan, ${formatHm(rec.checkInAt)} da kelgan`);
      }
    }

    const todaySched = scheduleFor(opts.ymd);
    if (!todaySched) continue;
    const todayPlan = planMap.get(`${emp.id}|${opts.ymd}`) || null;
    const todayOv = pickScheduleOverride(overrides.get(emp.id), opts.ymd);
    const bucket = todayOv
      ? todayOv.shiftKey === "office"
        ? "office"
        : shiftBucketOf(emp.userRole, emp.orgRole, todayOv.shiftKey, todayOv.note?.startsWith(ORTA_SHIFT_LABEL) ? ORTA_SHIFT_LABEL : null)
      : shiftBucketOf(
          emp.userRole,
          emp.orgRole,
          todayPlan || emp.shiftType,
          todayPlan ? null : emp.shiftLabel,
        );
    if (bucketFilter && !bucketFilter.has(bucket)) continue;

    const rec = recMap.get(`${emp.id}|${opts.ymd}`);
    const hours = `${todaySched.start}–${todaySched.end}`;
    const coord = coordOf.get(emp.id);
    const base = {
      fullName: formatPersonName(emp.fullName) || emp.fullName,
      position: emp.position || "—",
      branch: branchLabel(emp.location),
      checkIn: formatHm(rec?.checkInAt),
      checkOut: formatHm(rec?.checkOutAt),
      monthNotes,
      bucket,
      hours,
      coordKey: coord ? String(coord.id) : "none",
      coordId: coord?.id ?? null,
      coordName: coord?.name || "Koordinatorsiz",
      coordUserId: coord?.userId ?? null,
      coordTelegram: coord?.telegramId ?? null,
    };

    if (rec?.excused) {
      built.push({ ...base, list: "present", statusLabel: "Sababli" });
      continue;
    }
    if (rec?.status === "leave") {
      built.push({ ...base, list: "present", statusLabel: "Ta’til" });
      continue;
    }
    if (!rec?.checkInAt) {
      if (opts.ymd === tashkentNow().ymd && Date.now() < atTashkent(opts.ymd, todaySched.start).getTime()) continue;
      built.push({ ...base, list: "absent", statusLabel: "Kelmagan", checkIn: "—", checkOut: "—" });
      continue;
    }
    const start = atTashkent(opts.ymd, todaySched.start);
    const grace = (todaySched.graceMinutes ?? 15) * 60_000;
    const late = rec.checkInAt.getTime() > start.getTime() + grace;
    if (late) {
      built.push({ ...base, list: "late", statusLabel: "Kechikkan" });
      continue;
    }
    const end = scheduleEnd(opts.ymd, todaySched);
    const missingOut = !rec.checkOutAt && Date.now() > end.getTime();
    built.push({
      ...base,
      list: "present",
      statusLabel: missingOut ? "Keldi, ketishi yo‘q" : "Kelgan",
    });
  }

  const byCoord = new Map<
    string,
    {
      id: number | null;
      name: string;
      userId: number | null;
      telegramId: string | null;
      blocks: Map<ShiftBucket, Built[]>;
    }
  >();
  for (const row of built) {
    let group = byCoord.get(row.coordKey);
    if (!group) {
      group = {
        id: row.coordId,
        name: row.coordName,
        userId: row.coordUserId,
        telegramId: row.coordTelegram,
        blocks: new Map(),
      };
      byCoord.set(row.coordKey, group);
    }
    const list = group.blocks.get(row.bucket) || [];
    list.push(row);
    group.blocks.set(row.bucket, list);
  }

  const sections: BuiltSection[] = [];
  const groups = [...byCoord.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, "uz"));
  for (const [, group] of groups) {
    const blocks: ReportShiftBlock[] = [];
    for (const bucket of BUCKET_ORDER) {
      const people = group.blocks.get(bucket);
      if (!people?.length) continue;
      people.sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));
      const meta = bucketTitle(bucket, people[0]!.hours);
      blocks.push({ title: meta.title, hours: meta.hours, people });
    }
    if (blocks.length) {
      sections.push({
        coordinatorEmployeeId: group.id,
        coordinatorName: group.name,
        userId: group.userId,
        telegramId: group.telegramId,
        blocks,
      });
    }
  }
  return sections;
}

export type CoordinatorDispatch = {
  coordinatorEmployeeId: number;
  coordinatorName: string;
  userId: number | null;
  telegramId: string | null;
  sections: ReportCoordinatorSection[];
};

/** Bot: shu smenadagi barcha koordinatorlar, botga kirmaganlar ham. */
export async function coordinatorDispatches(opts: {
  ymd: string;
  buckets: ShiftBucket[];
}): Promise<{ items: CoordinatorDispatch[]; withoutCoordinator: string[] }> {
  const nodes = await loadNodes();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pharmacyIds: number[] = [];
  const withoutCoordinator: string[] = [];
  for (const n of nodes) {
    if (!isPharmacyShiftStaff(n.userRole, n.orgRole)) continue;
    if (!String(n.fullName || "").trim()) continue;
    const st = String(n.employmentStatus || "");
    if (st === "need_hire" || st === "searching" || st === "no_manager") continue;
    const coord = resolveCoordinator(n.id, byId);
    if (!coord) {
      const bucket = shiftBucketOf(n.userRole, n.orgRole, n.shiftType, n.shiftLabel);
      if (opts.buckets.includes(bucket)) {
        withoutCoordinator.push(formatPersonName(n.fullName) || n.fullName);
      }
      continue;
    }
    pharmacyIds.push(n.id);
  }
  if (!pharmacyIds.length) return { items: [], withoutCoordinator };

  const sections = await buildCoordinatorShiftReport({
    ymd: opts.ymd,
    employeeIds: pharmacyIds,
    buckets: opts.buckets,
  });

  const items: CoordinatorDispatch[] = [];
  for (const section of sections) {
    if (!section.coordinatorEmployeeId) continue;
    if (!section.blocks.length) continue;
    items.push({
      coordinatorEmployeeId: section.coordinatorEmployeeId,
      coordinatorName: section.coordinatorName,
      userId: section.userId,
      telegramId: section.telegramId,
      sections: [section],
    });
  }
  return { items, withoutCoordinator };
}
