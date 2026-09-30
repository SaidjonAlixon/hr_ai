import { and, asc, gte, inArray, lte } from "drizzle-orm";
import {
  attendanceRecordsTable,
  db,
  employeesTable,
} from "@workspace/db";
import { displayBranchName } from "./geo-location";
import { addDaysYmd } from "./attendance-engine";
import { buildHolatReport, type HolatCoordNode, type HolatPerson } from "./holat";
import { isVacancyPlaceholder } from "./vacancy-slot";

function todayTashkentYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 400) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
    guard += 1;
  }
  return out;
}

function shiftBucket(shiftType?: string | null, shiftLabel?: string | null): { key: string; label: string } {
  const rawLabel = String(shiftLabel || "").trim();
  const compact = rawLabel.toLowerCase().replace(/\s+/g, "");
  const t = String(shiftType || "").trim().toLowerCase();
  if (compact.includes("1+2") || compact.includes("1-2") || t === "one_two" || t === "12") {
    return { key: "12", label: "1+2" };
  }
  if (compact.includes("2+3") || compact.includes("2-3") || t === "two_three" || t === "23") {
    return { key: "23", label: "2+3" };
  }
  if (t === "office" || compact.includes("ofis")) return { key: "office", label: "Asosiy ofis" };
  if (t === "three" || t === "3" || compact.includes("3-smena") || compact === "3smena") {
    return { key: "3", label: "3-smena" };
  }
  if (t === "two" || t === "2" || compact.includes("2-smena") || compact === "2smena") {
    return { key: "2", label: "2-smena" };
  }
  if (t === "one" || t === "1" || compact.includes("1-smena") || compact === "1smena" || !t) {
    return { key: "1", label: "1-smena" };
  }
  return { key: "other", label: rawLabel || "Boshqa" };
}

function roleKeyOf(p: HolatPerson): "mudir" | "farmasevt" | "stajyor" | "other" {
  if (p.orgRole === "manager" || p.loginRole === "mudir") return "mudir";
  if (p.orgRole === "pharmacist" || p.orgRole === "supervisor" || p.loginRole === "farmasevt") {
    return "farmasevt";
  }
  if (
    p.orgRole === "intern" ||
    p.loginRole === "stajyor" ||
    /staj/i.test(p.orgRoleLabel || p.position || "")
  ) {
    return "stajyor";
  }
  return "other";
}

function roleLabelOf(key: ReturnType<typeof roleKeyOf>): string {
  if (key === "mudir") return "Mudir";
  if (key === "farmasevt") return "Farmasevt";
  if (key === "stajyor") return "Stajyor";
  return "Xodim";
}

export type HisobotEmployeeRow = {
  employeeId: number;
  fullName: string;
  accountName: string | null;
  position: string;
  phone: string | null;
  login: string | null;
  roleKey: "mudir" | "farmasevt" | "stajyor" | "other";
  roleLabel: string;
  branch: string;
  shiftKey: string;
  shiftDisplay: string;
  presentDays: number;
  onTimeDays: number;
  lateDays: number;
  absentDays: number;
  presentRate: number;
  presentDates: string[];
  onTimeDates: string[];
  lateDates: string[];
  absentDates: string[];
};

export type HisobotBranchBlock = {
  branch: string;
  mudir: HisobotEmployeeRow | null;
  /** Mudir yopiq yoki tayinlanmagan — filial qobig‘i, odam emas. */
  mudirMissing: boolean;
  pharmacists: HisobotEmployeeRow[];
  interns: HisobotEmployeeRow[];
  others: HisobotEmployeeRow[];
  staffCount: number;
};

export type CoordinatorHisobot = {
  generatedAt: string;
  from: string;
  to: string;
  dayCount: number;
  coordinator: {
    employeeId: number;
    fullName: string;
    phone: string | null;
    login: string | null;
  };
  summary: {
    branchCount: number;
    mudirCount: number;
    pharmacistCount: number;
    internCount: number;
    staffTotal: number;
    avgPresentRate: number;
    noShowCount: number;
  };
  branches: HisobotBranchBlock[];
  employees: HisobotEmployeeRow[];
  noShows: HisobotEmployeeRow[];
  /** Koordinatorning o‘z davomati — xodimlar jadvaliga aralashmaydi. */
  self: HisobotEmployeeRow | null;
};

async function loadShiftMap(employeeIds: number[]): Promise<Map<number, { shiftType: string | null; shiftLabel: string | null }>> {
  const map = new Map<number, { shiftType: string | null; shiftLabel: string | null }>();
  if (!employeeIds.length) return map;
  const rows = await db
    .select({
      id: employeesTable.id,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
    })
    .from(employeesTable)
    .where(inArray(employeesTable.id, employeeIds));
  for (const r of rows) {
    map.set(r.id, { shiftType: r.shiftType, shiftLabel: r.shiftLabel });
  }
  return map;
}

function buildPersonAttendance(
  p: HolatPerson,
  dates: string[],
  byEmpDate: Map<string, { checkInAt: Date | null; status: string | null }>,
  shifts: Map<number, { shiftType: string | null; shiftLabel: string | null }>,
): HisobotEmployeeRow | null {
  if (p.employeeId == null || isVacancyPlaceholder(p)) return null;
  // Filial qobig‘i: mudir tayinlanmagan, ism o‘rnida dorixona nomi turadi.
  if (p.employmentStatus === "no_manager") return null;
  const onTimeDates: string[] = [];
  const lateDates: string[] = [];
  const absentDates: string[] = [];
  for (const d of dates) {
    const rec = byEmpDate.get(`${p.employeeId}|${d}`);
    const came = Boolean(rec?.checkInAt) && rec?.status !== "absent" && rec?.status !== "leave";
    if (!came) absentDates.push(d);
    else if (rec?.status === "late") lateDates.push(d);
    else onTimeDates.push(d);
  }
  const presentDates = [...onTimeDates, ...lateDates].sort();
  const dayCount = dates.length || 1;
  const presentDays = presentDates.length;
  const onTimeDays = onTimeDates.length;
  const lateDays = lateDates.length;
  const absentDays = absentDates.length;
  const presentRate = Math.round((presentDays / dayCount) * 1000) / 10;
  const sh = shifts.get(p.employeeId);
  const key = roleKeyOf(p);
  const shift = shiftBucket(sh?.shiftType, sh?.shiftLabel);
  return {
    employeeId: p.employeeId,
    fullName: p.fullName,
    accountName: p.accountName,
    position: p.position || roleLabelOf(key),
    phone: p.phone,
    login: p.login,
    roleKey: key,
    roleLabel: roleLabelOf(key),
    branch: displayBranchName(p.branch) || p.branch || "—",
    shiftKey: shift.key,
    shiftDisplay: shift.label,
    presentDays,
    onTimeDays,
    lateDays,
    absentDays,
    presentRate,
    presentDates,
    onTimeDates,
    lateDates,
    absentDates,
  };
}

function collectPeople(coord: HolatCoordNode): HolatPerson[] {
  const list: HolatPerson[] = [];
  for (const m of coord.mudirs ?? []) {
    list.push(m);
    for (const s of m.staff ?? []) list.push(s);
  }
  return list;
}

export async function buildCoordinatorHisobot(opts: {
  coordinatorEmployeeId: number;
  from?: string | null;
  to?: string | null;
  full: boolean;
  scopeRole?: string | null;
  scopeUserId?: number | null;
}): Promise<CoordinatorHisobot | null> {
  const to = (opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to) ? opts.to : todayTashkentYmd());
  let from =
    opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from)
      ? opts.from
      : addDaysYmd(to, -29);
  if (from > to) from = to;
  // Max 120 kun — PDF/DB yukini cheklash
  const maxFrom = addDaysYmd(to, -119);
  if (from < maxFrom) from = maxFrom;

  const holat = await buildHolatReport({
    full: opts.full,
    scopeRole: opts.scopeRole,
    scopeUserId: opts.scopeUserId,
  });
  const coord = holat.coordinators.find((c) => c.employeeId === opts.coordinatorEmployeeId);
  if (!coord || coord.employeeId == null) return null;

  const people = collectPeople(coord);
  const ids = [
    ...people
      .map((p) => p.employeeId)
      .filter((id): id is number => typeof id === "number" && Number.isFinite(id)),
    ...(coord.employeeId != null ? [coord.employeeId] : []),
  ];
  const dates = eachDateInclusive(from, to);
  const shifts = await loadShiftMap(ids);

  const records =
    ids.length === 0
      ? []
      : await db
          .select({
            employeeId: attendanceRecordsTable.employeeId,
            workDate: attendanceRecordsTable.workDate,
            checkInAt: attendanceRecordsTable.checkInAt,
            status: attendanceRecordsTable.status,
          })
          .from(attendanceRecordsTable)
          .where(
            and(
              inArray(attendanceRecordsTable.employeeId, ids),
              gte(attendanceRecordsTable.workDate, from),
              lte(attendanceRecordsTable.workDate, to),
            ),
          )
          .orderBy(asc(attendanceRecordsTable.workDate));

  const byEmpDate = new Map<string, { checkInAt: Date | null; status: string | null }>();
  for (const r of records) {
    byEmpDate.set(`${r.employeeId}|${r.workDate}`, {
      checkInAt: r.checkInAt,
      status: r.status,
    });
  }

  const employees: HisobotEmployeeRow[] = [];
  const branches: HisobotBranchBlock[] = [];

  for (const mudirNode of coord.mudirs ?? []) {
    const mudirMissing =
      mudirNode.employmentStatus === "no_manager" ||
      mudirNode.employmentStatus === "closed" ||
      isVacancyPlaceholder(mudirNode);
    const mudirRow = mudirMissing ? null : buildPersonAttendance(mudirNode, dates, byEmpDate, shifts);
    const pharmacists: HisobotEmployeeRow[] = [];
    const interns: HisobotEmployeeRow[] = [];
    const others: HisobotEmployeeRow[] = [];
    for (const s of mudirNode.staff ?? []) {
      const row = buildPersonAttendance(s, dates, byEmpDate, shifts);
      if (!row) continue;
      if (row.roleKey === "farmasevt") pharmacists.push(row);
      else if (row.roleKey === "stajyor") interns.push(row);
      else others.push(row);
      employees.push(row);
    }
    if (mudirRow) employees.push(mudirRow);
    branches.push({
      branch: displayBranchName(mudirNode.branch) || mudirNode.branch || mudirNode.fullName,
      mudir: mudirRow,
      mudirMissing,
      pharmacists,
      interns,
      others,
      staffCount: pharmacists.length + interns.length + others.length + (mudirRow ? 1 : 0),
    });
  }

  employees.sort((a, b) => {
    const order = { mudir: 0, farmasevt: 1, stajyor: 2, other: 3 } as const;
    return order[a.roleKey] - order[b.roleKey] || a.fullName.localeCompare(b.fullName, "uz");
  });

  const noShows = employees.filter((e) => e.presentDays === 0);
  const avgPresentRate =
    employees.length === 0
      ? 0
      : Math.round(
          (employees.reduce((s, e) => s + e.presentRate, 0) / employees.length) * 10,
        ) / 10;

  return {
    generatedAt: new Intl.DateTimeFormat("uz-UZ", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date()),
    from,
    to,
    dayCount: dates.length,
    coordinator: {
      employeeId: coord.employeeId,
      fullName: coord.fullName,
      phone: coord.phone,
      login: coord.login,
    },
    summary: {
      branchCount: branches.length,
      mudirCount: employees.filter((e) => e.roleKey === "mudir").length,
      pharmacistCount: employees.filter((e) => e.roleKey === "farmasevt").length,
      internCount: employees.filter((e) => e.roleKey === "stajyor").length,
      staffTotal: employees.length,
      avgPresentRate,
      noShowCount: noShows.length,
    },
    branches,
    employees,
    noShows,
    self: (() => {
      const row = buildPersonAttendance(coord, dates, byEmpDate, shifts);
      if (!row) return null;
      return { ...row, roleLabel: "Koordinator", position: row.position || "Koordinator" };
    })(),
  };
}

export { todayTashkentYmd };
