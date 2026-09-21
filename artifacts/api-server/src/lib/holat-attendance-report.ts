import { and, asc, gte, inArray, lte } from "drizzle-orm";
import {
  attendanceRecordsTable,
  db,
  employeesTable,
} from "@workspace/db";
import { displayBranchName } from "./geo-location";
import { addDaysYmd } from "./attendance-engine";
import { buildHolatReport, type HolatCoordNode, type HolatPerson } from "./holat";

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

function shiftDisplay(shiftType?: string | null, shiftLabel?: string | null): string {
  const label = String(shiftLabel || "").trim();
  if (label) return label;
  const t = String(shiftType || "one").toLowerCase();
  if (t === "two" || t === "2") return "2-smena";
  if (t === "three" || t === "3") return "3-smena";
  if (t === "office") return "Ofis";
  return "1-smena";
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
  phone: string | null;
  login: string | null;
  roleKey: "mudir" | "farmasevt" | "stajyor" | "other";
  roleLabel: string;
  branch: string;
  shiftDisplay: string;
  presentDays: number;
  absentDays: number;
  presentRate: number;
  presentDates: string[];
  absentDates: string[];
};

export type HisobotBranchBlock = {
  branch: string;
  mudir: HisobotEmployeeRow | null;
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
  if (p.employeeId == null) return null;
  const presentDates: string[] = [];
  const absentDates: string[] = [];
  for (const d of dates) {
    const rec = byEmpDate.get(`${p.employeeId}|${d}`);
    const present = Boolean(rec?.checkInAt) && rec?.status !== "absent" && rec?.status !== "leave";
    if (present) presentDates.push(d);
    else absentDates.push(d);
  }
  const dayCount = dates.length || 1;
  const presentDays = presentDates.length;
  const absentDays = absentDates.length;
  const presentRate = Math.round((presentDays / dayCount) * 1000) / 10;
  const sh = shifts.get(p.employeeId);
  const key = roleKeyOf(p);
  return {
    employeeId: p.employeeId,
    fullName: p.fullName,
    phone: p.phone,
    login: p.login,
    roleKey: key,
    roleLabel: roleLabelOf(key),
    branch: displayBranchName(p.branch) || p.branch || "—",
    shiftDisplay: shiftDisplay(sh?.shiftType, sh?.shiftLabel),
    presentDays,
    absentDays,
    presentRate,
    presentDates,
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
  const ids = people
    .map((p) => p.employeeId)
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id));
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
    const mudirRow = buildPersonAttendance(mudirNode, dates, byEmpDate, shifts);
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
  };
}

export { todayTashkentYmd };
