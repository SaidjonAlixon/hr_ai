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
  byEmpDate: Map<string, { checkInAt: Date | null; status: string | null; excused?: boolean }>,
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
    if (rec?.excused) {
      onTimeDates.push(d);
      continue;
    }
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
            excused: attendanceRecordsTable.excused,
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

  const byEmpDate = new Map<string, { checkInAt: Date | null; status: string | null; excused?: boolean }>();
  for (const r of records) {
    byEmpDate.set(`${r.employeeId}|${r.workDate}`, {
      checkInAt: r.checkInAt,
      status: r.status,
      excused: Boolean(r.excused),
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

export type FilialEmployeePick = {
  employeeId: number;
  userId: number | null;
  fullName: string;
  roleLabel: string;
  phone: string | null;
  hiredAt: string | null;
};

export type FilialPick = {
  id: number;
  name: string;
  mudirName: string | null;
  mudirMissing: boolean;
  coordinatorName: string | null;
  employees: FilialEmployeePick[];
};

function isShellPerson(p: HolatPerson): boolean {
  return (
    p.employmentStatus === "no_manager" ||
    p.employmentStatus === "closed" ||
    isVacancyPlaceholder(p)
  );
}

function toFilialEmployee(p: HolatPerson): FilialEmployeePick | null {
  if (p.employeeId == null || isShellPerson(p)) return null;
  return {
    employeeId: p.employeeId,
    userId: p.userId,
    fullName: p.fullName,
    roleLabel: p.orgRoleLabel || p.position || "Xodim",
    phone: p.phone,
    hiredAt: p.hiredAt,
  };
}

/** Koordinator faqat o‘z filiallarini oladi. Bo‘sh o‘rin va filial qobig‘i xodim emas. */
export async function listScopedFilials(opts: {
  full: boolean;
  scopeRole?: string | null;
  scopeUserId?: number | null;
}): Promise<FilialPick[]> {
  const holat = await buildHolatReport({
    full: opts.full,
    scopeRole: opts.scopeRole,
    scopeUserId: opts.scopeUserId,
  });
  const filials: FilialPick[] = [];
  for (const coord of holat.coordinators) {
    for (const mudirNode of coord.mudirs ?? []) {
      if (mudirNode.employeeId == null) continue;
      const mudirMissing = isShellPerson(mudirNode);
      const employees: FilialEmployeePick[] = [];
      const mudirPick = mudirMissing ? null : toFilialEmployee(mudirNode);
      if (mudirPick) employees.push(mudirPick);
      for (const staff of mudirNode.staff ?? []) {
        const pick = toFilialEmployee(staff);
        if (pick) employees.push(pick);
      }
      filials.push({
        id: mudirNode.employeeId,
        name: displayBranchName(mudirNode.branch) || mudirNode.branch || mudirNode.fullName,
        mudirName: mudirMissing ? null : mudirNode.fullName,
        mudirMissing,
        coordinatorName: coord.fullName,
        employees,
      });
    }
  }
  filials.sort((a, b) => a.name.localeCompare(b.name, "uz"));
  return filials;
}

export async function buildFilialAttendance(opts: {
  branchId: number;
  employeeIds?: number[];
  from: string;
  to: string;
  full: boolean;
  scopeRole?: string | null;
  scopeUserId?: number | null;
}): Promise<{
  filial: FilialPick;
  from: string;
  to: string;
  dayCount: number;
  employees: HisobotEmployeeRow[];
} | null> {
  const holat = await buildHolatReport({
    full: opts.full,
    scopeRole: opts.scopeRole,
    scopeUserId: opts.scopeUserId,
  });
  let found: { coordName: string; mudir: HolatCoordNode["mudirs"][number] } | null = null;
  for (const coord of holat.coordinators) {
    const mudir = (coord.mudirs ?? []).find((m) => m.employeeId === opts.branchId);
    if (mudir && mudir.employeeId != null) {
      found = { coordName: coord.fullName, mudir };
      break;
    }
  }
  if (!found) return null;

  const mudirMissing = isShellPerson(found.mudir);
  const people: HolatPerson[] = [];
  if (!mudirMissing) people.push(found.mudir);
  for (const staff of found.mudir.staff ?? []) {
    if (!isShellPerson(staff)) people.push(staff);
  }
  const allowed = new Set(people.map((p) => p.employeeId).filter((id): id is number => id != null));
  const wanted =
    opts.employeeIds && opts.employeeIds.length
      ? people.filter((p) => p.employeeId != null && opts.employeeIds!.includes(p.employeeId) && allowed.has(p.employeeId))
      : people;
  const ids = wanted.map((p) => p.employeeId).filter((id): id is number => id != null);
  const dates = eachDateInclusive(opts.from, opts.to);
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
            excused: attendanceRecordsTable.excused,
          })
          .from(attendanceRecordsTable)
          .where(
            and(
              inArray(attendanceRecordsTable.employeeId, ids),
              gte(attendanceRecordsTable.workDate, opts.from),
              lte(attendanceRecordsTable.workDate, opts.to),
            ),
          );
  const byEmpDate = new Map<string, { checkInAt: Date | null; status: string | null; excused?: boolean }>();
  for (const r of records) {
    byEmpDate.set(`${r.employeeId}|${r.workDate}`, {
      checkInAt: r.checkInAt,
      status: r.status,
      excused: Boolean(r.excused),
    });
  }
  const employees = wanted
    .map((p) => buildPersonAttendance(p, dates, byEmpDate, shifts))
    .filter((row): row is HisobotEmployeeRow => row != null)
    .sort((a, b) => {
      const order = { mudir: 0, farmasevt: 1, stajyor: 2, other: 3 } as const;
      return order[a.roleKey] - order[b.roleKey] || a.fullName.localeCompare(b.fullName, "uz");
    });
  const picks = wanted.map((p) => toFilialEmployee(p)).filter((p): p is FilialEmployeePick => p != null);
  return {
    filial: {
      id: found.mudir.employeeId!,
      name: displayBranchName(found.mudir.branch) || found.mudir.branch || found.mudir.fullName,
      mudirName: mudirMissing ? null : found.mudir.fullName,
      mudirMissing,
      coordinatorName: found.coordName,
      employees: picks,
    },
    from: opts.from,
    to: opts.to,
    dayCount: dates.length,
    employees,
  };
}

export { todayTashkentYmd };
