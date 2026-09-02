import { shiftWindow, workScheduleForStaff, onTimeUntilHm } from "./shift-hours";
import { displayBranchName } from "./geo-location";

export const PHARMACY_SEGMENT_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor", "koordinator"]);
export const PHARMACY_SEGMENT_ORG_ROLES = new Set(["manager", "pharmacist", "intern", "coordinator"]);

export type DavomatSegment = "all" | "office" | "pharmacy";

export function davomatStaffSegment(
  userRole?: string | null,
  orgRole?: string | null,
): "office" | "pharmacy" {
  if (PHARMACY_SEGMENT_USER_ROLES.has(userRole || "")) return "pharmacy";
  if (PHARMACY_SEGMENT_ORG_ROLES.has(orgRole || "")) return "pharmacy";
  return "office";
}

type DayRow = {
  date: string;
  present: number;
  late: number;
  incomplete: number;
  leave: number;
  absent: number;
};

type EmpDay = {
  date: string;
  status: string;
  checkIn: string;
  lateArrivalMin: number;
};

type EmpRow = {
  id: number;
  fullName: string;
  position: string;
  departmentName: string | null;
  location: string | null;
  orgRole: string | null;
  days: EmpDay[];
  totals: {
    present: number;
    absent: number;
    late: number;
    incomplete: number;
    leave: number;
    workedMinutes: number;
    lateArrivalMin: number;
  };
};

type ReportLike = {
  from: string;
  to: string;
  dates: string[];
  summary: {
    employees: number;
    days: number;
    presentPersonDays: number;
    absentPersonDays: number;
    latePersonDays: number;
    totalLateMinutes: number;
  };
  days: DayRow[];
  employees: EmpRow[];
};

export type EmployeeMeta = {
  id: number;
  userRole: string | null;
  orgRole: string | null;
  shiftType: string | null;
};

export type DavomatAnalyticsPayload = {
  from: string;
  to: string;
  segment: DavomatSegment;
  segments: {
    office: { headcount: number; attendanceRate: number };
    pharmacy: { headcount: number; attendanceRate: number };
  };
  kpis: {
    headcount: number;
    attendanceRate: number;
    presentPersonDays: number;
    absentPersonDays: number;
    latePersonDays: number;
    leavePersonDays: number;
    incompletePersonDays: number;
    totalLateMinutes: number;
    avgLateMinutes: number;
    totalWorkedHours: number;
    shiftCoverage: number;
    targetRate: number;
    deltaRate: number | null;
  };
  today: {
    present: number;
    late: number;
    absent: number;
    leave: number;
    incomplete: number;
    attendanceRate: number;
  } | null;
  statusBreakdown: Array<{ key: string; label: string; count: number; pct: number }>;
  dailyTrend: Array<{
    date: string;
    label: string;
    present: number;
    late: number;
    absent: number;
    leave: number;
    attendanceRate: number;
  }>;
  monthlyTrend: Array<{ month: string; label: string; attendanceRate: number; late: number }>;
  byDepartment: Array<{
    name: string;
    headcount: number;
    present: number;
    late: number;
    absent: number;
    attendanceRate: number;
  }>;
  byShift: Array<{
    key: string;
    label: string;
    headcount: number;
    present: number;
    late: number;
    absent: number;
    attendanceRate: number;
  }>;
  byRole: Array<{
    key: string;
    label: string;
    headcount: number;
    attendanceRate: number;
    late: number;
  }>;
  distribution: Array<{ bucket: string; count: number }>;
  topDepartments: Array<{ name: string; attendanceRate: number }>;
  topLate: Array<{
    id: number;
    fullName: string;
    departmentName: string | null;
    position: string;
    lateDays: number;
    lateMinutes: number;
  }>;
  branchOpenings: Array<{
    branchId: number;
    branchName: string;
    managerName: string;
    shiftLabel: string;
    expectedOpen: string;
    graceUntil: string;
    checkIn: string | null;
    status: "on_time" | "late" | "absent" | "leave";
    statusLabel: string;
    lateMinutes: number;
    date: string;
  }>;
  branchOpeningSummary: {
    date: string;
    total: number;
    onTime: number;
    late: number;
    absent: number;
    leave: number;
  } | null;
  recentCheckins: Array<{
    fullName: string;
    departmentName: string | null;
    position: string;
    date: string;
    checkIn: string;
    status: string;
    statusLabel: string;
  }>;
  alerts: Array<{ id: string; severity: "high" | "medium"; title: string; count: number }>;
  bestDay: { date: string; rate: number } | null;
  worstDay: { date: string; rate: number } | null;
};

const ROLE_LABELS: Record<string, string> = {
  manager: "Mudir",
  pharmacist: "Farmasevt",
  intern: "Stajyor",
  coordinator: "Koordinator",
  mudir: "Mudir",
  farmasevt: "Farmasevt",
  stajyor: "Stajyor",
  koordinator: "Koordinator",
};

const STATUS_LABELS: Record<string, string> = {
  present: "Vaqtida",
  late: "Kechikdi",
  absent: "Kelmagan",
  incomplete: "To‘liq emas",
  leave: "Ta'til",
};

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 1000) / 10;
}

function shortDate(ymd: string) {
  const [, m, d] = ymd.split("-");
  return `${d}.${m}`;
}

function monthKey(ymd: string) {
  return ymd.slice(0, 7);
}

function monthLabel(key: string) {
  const [y, m] = key.split("-");
  const months = [
    "Yan",
    "Fev",
    "Mar",
    "Apr",
    "May",
    "Iyn",
    "Iyl",
    "Avg",
    "Sen",
    "Okt",
    "Noy",
    "Dek",
  ];
  return `${months[Number(m) - 1]} ${y}`;
}

function filterReport(
  report: ReportLike,
  metaById: Map<number, EmployeeMeta>,
  segment: DavomatSegment,
): ReportLike {
  if (segment === "all") return report;
  const allowed = new Set(
    report.employees
      .filter((e) => {
        const m = metaById.get(e.id);
        const seg = davomatStaffSegment(m?.userRole, m?.orgRole ?? e.orgRole);
        return seg === segment;
      })
      .map((e) => e.id),
  );
  const employees = report.employees.filter((e) => allowed.has(e.id));
  const dates = report.dates;
  const days = dates.map((date) => {
    let present = 0;
    let late = 0;
    let incomplete = 0;
    let leave = 0;
    let absent = 0;
    for (const e of employees) {
      const d = e.days.find((x) => x.date === date);
      const st = d?.status ?? "absent";
      if (st === "absent") absent += 1;
      else if (st === "leave") leave += 1;
      else {
        present += 1;
        if (st === "late") late += 1;
        if (st === "incomplete") incomplete += 1;
      }
    }
    return { date, present, late, incomplete, leave, absent };
  });
  const summary = {
    employees: employees.length,
    days: dates.length,
    presentPersonDays: employees.reduce((s, e) => s + e.totals.present, 0),
    absentPersonDays: employees.reduce((s, e) => s + e.totals.absent, 0),
    latePersonDays: employees.reduce((s, e) => s + e.totals.late, 0),
    totalLateMinutes: employees.reduce((s, e) => s + e.totals.lateArrivalMin, 0),
  };
  return { ...report, employees, days, summary };
}

function segmentRate(report: ReportLike) {
  const expected = report.summary.employees * report.summary.days;
  if (!expected) return 0;
  return pct(report.summary.presentPersonDays, expected);
}

function roleKey(meta: EmployeeMeta | undefined, emp: EmpRow) {
  if (meta?.userRole && PHARMACY_SEGMENT_USER_ROLES.has(meta.userRole)) return meta.userRole;
  if (emp.orgRole && PHARMACY_SEGMENT_ORG_ROLES.has(emp.orgRole)) return emp.orgRole;
  return meta?.userRole || emp.orgRole || "office";
}

function isBranchManager(meta: EmployeeMeta | undefined, emp: EmpRow): boolean {
  return meta?.userRole === "mudir" || emp.orgRole === "manager" || meta?.orgRole === "manager";
}

function buildBranchOpenings(
  report: ReportLike,
  metaById: Map<number, EmployeeMeta>,
  targetDate: string,
): DavomatAnalyticsPayload["branchOpenings"] {
  const openings: DavomatAnalyticsPayload["branchOpenings"] = [];
  for (const e of report.employees) {
    const m = metaById.get(e.id);
    if (!isBranchManager(m, e)) continue;

    const branchName = displayBranchName(e.location) || e.location?.trim() || e.fullName;
    const schedule = workScheduleForStaff(m?.userRole, m?.orgRole ?? e.orgRole, m?.shiftType);
    const day = e.days.find((x) => x.date === targetDate);

    let status: "on_time" | "late" | "absent" | "leave";
    let statusLabel: string;
    let checkIn: string | null = null;
    let lateMinutes = 0;

    if (!day || day.status === "absent") {
      status = "absent";
      statusLabel = "Ochilmagan";
    } else if (day.status === "leave") {
      status = "leave";
      statusLabel = "Ta'tilda";
    } else {
      checkIn = day.checkIn && day.checkIn !== "—" ? day.checkIn : null;
      if (day.status === "late" || day.lateArrivalMin > 0) {
        status = "late";
        statusLabel = "Kech ochilgan";
        lateMinutes = day.lateArrivalMin;
      } else {
        status = "on_time";
        statusLabel = "Vaqtida";
      }
    }

    openings.push({
      branchId: e.id,
      branchName,
      managerName: e.fullName,
      shiftLabel: schedule.label,
      expectedOpen: schedule.start,
      graceUntil: onTimeUntilHm(schedule.start, schedule.graceMinutes),
      checkIn,
      status,
      statusLabel,
      lateMinutes,
      date: targetDate,
    });
  }

  const order: Record<string, number> = { late: 0, absent: 1, leave: 2, on_time: 3 };
  return openings.sort((a, b) => {
    const oa = order[a.status] ?? 9;
    const ob = order[b.status] ?? 9;
    if (oa !== ob) return oa - ob;
    if (b.lateMinutes !== a.lateMinutes) return b.lateMinutes - a.lateMinutes;
    return a.branchName.localeCompare(b.branchName, "uz");
  });
}

export function buildDavomatAnalytics(
  report: ReportLike,
  meta: EmployeeMeta[],
  segment: DavomatSegment,
  prevReport?: ReportLike | null,
): DavomatAnalyticsPayload {
  const metaById = new Map(meta.map((m) => [m.id, m]));
  const allMeta = meta;
  const officeIds = allMeta.filter((m) => davomatStaffSegment(m.userRole, m.orgRole) === "office");
  const pharmacyIds = allMeta.filter((m) => davomatStaffSegment(m.userRole, m.orgRole) === "pharmacy");

  const officeReport = filterReport(report, metaById, "office");
  const pharmacyReport = filterReport(report, metaById, "pharmacy");
  const filtered = filterReport(report, metaById, segment);
  const prevFiltered = prevReport ? filterReport(prevReport, metaById, segment) : null;

  const expected = filtered.summary.employees * filtered.summary.days;
  const attendanceRate = expected ? pct(filtered.summary.presentPersonDays, expected) : 0;
  const prevRate = prevFiltered
    ? segmentRate(prevFiltered)
    : null;

  const leavePersonDays = filtered.employees.reduce((s, e) => s + e.totals.leave, 0);
  const incompletePersonDays = filtered.employees.reduce((s, e) => s + e.totals.incomplete, 0);
  const workedMinutes = filtered.employees.reduce((s, e) => s + e.totals.workedMinutes, 0);

  const statusCounts = {
    present: filtered.summary.presentPersonDays - filtered.summary.latePersonDays - incompletePersonDays,
    late: filtered.summary.latePersonDays,
    absent: filtered.summary.absentPersonDays,
    incomplete: incompletePersonDays,
    leave: leavePersonDays,
  };
  const statusTotal = Object.values(statusCounts).reduce((a, b) => a + b, 0) || 1;

  const dailyTrend = filtered.days.map((d) => {
    const hc = filtered.summary.employees || 1;
    const attended = d.present;
    return {
      date: d.date,
      label: shortDate(d.date),
      present: d.present,
      late: d.late,
      absent: d.absent,
      leave: d.leave,
      attendanceRate: pct(attended, hc),
    };
  });

  const monthlyMap = new Map<string, { present: number; expected: number; late: number }>();
  for (const d of filtered.days) {
    const mk = monthKey(d.date);
    const cur = monthlyMap.get(mk) ?? { present: 0, expected: 0, late: 0 };
    cur.present += d.present;
    cur.expected += filtered.summary.employees;
    cur.late += d.late;
    monthlyMap.set(mk, cur);
  }
  const monthlyTrend = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      label: monthLabel(month),
      attendanceRate: pct(v.present, v.expected),
      late: v.late,
    }));

  const deptMap = new Map<
    string,
    { headcount: Set<number>; present: number; late: number; absent: number; expected: number }
  >();
  for (const e of filtered.employees) {
    const name = e.departmentName || "Boshqa";
    const cur = deptMap.get(name) ?? {
      headcount: new Set<number>(),
      present: 0,
      late: 0,
      absent: 0,
      expected: 0,
    };
    cur.headcount.add(e.id);
    cur.present += e.totals.present;
    cur.late += e.totals.late;
    cur.absent += e.totals.absent;
    cur.expected += filtered.summary.days;
    deptMap.set(name, cur);
  }
  const byDepartment = [...deptMap.entries()]
    .map(([name, v]) => ({
      name,
      headcount: v.headcount.size,
      present: v.present,
      late: v.late,
      absent: v.absent,
      attendanceRate: pct(v.present, v.expected),
    }))
    .sort((a, b) => b.attendanceRate - a.attendanceRate);

  const shiftMap = new Map<
    string,
    { label: string; headcount: Set<number>; present: number; late: number; absent: number; expected: number }
  >();
  for (const e of filtered.employees) {
    const m = metaById.get(e.id);
    const isPharm = davomatStaffSegment(m?.userRole, m?.orgRole ?? e.orgRole) === "pharmacy";
    const shift = isPharm ? shiftWindow(m?.shiftType) : { key: "office", label: "09:00–18:00" };
    const key = isPharm ? `pharm-${shift.key}` : "office";
    const label = isPharm ? `${shift.label} (${shift.start}–${shift.end})` : "Ofis 09:00–18:00";
    const cur = shiftMap.get(key) ?? {
      label,
      headcount: new Set<number>(),
      present: 0,
      late: 0,
      absent: 0,
      expected: 0,
    };
    cur.headcount.add(e.id);
    cur.present += e.totals.present;
    cur.late += e.totals.late;
    cur.absent += e.totals.absent;
    cur.expected += filtered.summary.days;
    shiftMap.set(key, cur);
  }
  const byShift = [...shiftMap.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      headcount: v.headcount.size,
      present: v.present,
      late: v.late,
      absent: v.absent,
      attendanceRate: pct(v.present, v.expected),
    }))
    .sort((a, b) => b.attendanceRate - a.attendanceRate);

  const roleMap = new Map<string, { label: string; headcount: Set<number>; present: number; late: number; expected: number }>();
  for (const e of filtered.employees) {
    const m = metaById.get(e.id);
    const key = roleKey(m, e);
    const label = ROLE_LABELS[key] || e.position || key;
    const cur = roleMap.get(key) ?? {
      label,
      headcount: new Set<number>(),
      present: 0,
      late: 0,
      expected: 0,
    };
    cur.headcount.add(e.id);
    cur.present += e.totals.present;
    cur.late += e.totals.late;
    cur.expected += filtered.summary.days;
    roleMap.set(key, cur);
  }
  const byRole = [...roleMap.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      headcount: v.headcount.size,
      attendanceRate: pct(v.present, v.expected),
      late: v.late,
    }))
    .sort((a, b) => b.attendanceRate - a.attendanceRate);

  const empRates = filtered.employees.map((e) => {
    const expectedDays = filtered.summary.days || 1;
    return pct(e.totals.present, expectedDays);
  });
  const buckets = [
    { bucket: "90–100%", min: 90, max: 101 },
    { bucket: "75–89%", min: 75, max: 90 },
    { bucket: "60–74%", min: 60, max: 75 },
    { bucket: "0–59%", min: 0, max: 60 },
  ];
  const distribution = buckets.map((b) => ({
    bucket: b.bucket,
    count: empRates.filter((r) => r >= b.min && r < b.max).length,
  }));

  const topLate = [...filtered.employees]
    .filter((e) => e.totals.late > 0)
    .sort((a, b) => b.totals.late - a.totals.late || b.totals.lateArrivalMin - a.totals.lateArrivalMin)
    .slice(0, 10)
    .map((e) => ({
      id: e.id,
      fullName: e.fullName,
      departmentName: e.departmentName,
      position: e.position,
      lateDays: e.totals.late,
      lateMinutes: e.totals.lateArrivalMin,
    }));

  const lastDate = filtered.dates[filtered.dates.length - 1] ?? "";
  const branchOpenings = lastDate
    ? buildBranchOpenings(
        segment === "pharmacy" || segment === "all" ? report : pharmacyReport,
        metaById,
        lastDate,
      )
    : [];
  const branchOpeningSummary = lastDate
    ? {
        date: lastDate,
        total: branchOpenings.length,
        onTime: branchOpenings.filter((b) => b.status === "on_time").length,
        late: branchOpenings.filter((b) => b.status === "late").length,
        absent: branchOpenings.filter((b) => b.status === "absent").length,
        leave: branchOpenings.filter((b) => b.status === "leave").length,
      }
    : null;

  const recentCheckins = filtered.employees
    .map((e) => {
      const d = e.days.find((x) => x.date === lastDate);
      if (!d || d.status === "absent" || d.status === "leave") return null;
      return {
        fullName: e.fullName,
        departmentName: e.departmentName,
        position: e.position,
        date: lastDate,
        checkIn: d.checkIn,
        status: d.status,
        statusLabel: STATUS_LABELS[d.status] || d.status,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
    .slice(0, 20);

  const alerts: DavomatAnalyticsPayload["alerts"] = [];
  const chronicLate = filtered.employees.filter((e) => e.totals.late >= 3).length;
  const chronicAbsent = filtered.employees.filter((e) => e.totals.absent >= 5).length;
  if (chronicLate > 0) {
    alerts.push({
      id: "chronic-late",
      severity: "medium",
      title: "3+ kun kechikkan xodimlar",
      count: chronicLate,
    });
  }
  if (chronicAbsent > 0) {
    alerts.push({
      id: "chronic-absent",
      severity: "high",
      title: "5+ kun kelmagan xodimlar",
      count: chronicAbsent,
    });
  }
  if (filtered.summary.totalLateMinutes > 0 && filtered.summary.employees > 0) {
    const avgLate = Math.round(filtered.summary.totalLateMinutes / filtered.summary.employees);
    if (avgLate >= 30) {
      alerts.push({
        id: "avg-late",
        severity: "medium",
        title: `O‘rtacha kechikish ${avgLate} daqiqa`,
        count: filtered.summary.employees,
      });
    }
  }

  let bestDay: DavomatAnalyticsPayload["bestDay"] = null;
  let worstDay: DavomatAnalyticsPayload["worstDay"] = null;
  for (const d of dailyTrend) {
    if (!bestDay || d.attendanceRate > bestDay.rate) bestDay = { date: d.date, rate: d.attendanceRate };
    if (!worstDay || d.attendanceRate < worstDay.rate) worstDay = { date: d.date, rate: d.attendanceRate };
  }

  const todayRow = filtered.days[filtered.days.length - 1];
  const today =
    todayRow && filtered.summary.employees
      ? {
          present: todayRow.present,
          late: todayRow.late,
          absent: todayRow.absent,
          leave: todayRow.leave,
          incomplete: todayRow.incomplete,
          attendanceRate: pct(todayRow.present, filtered.summary.employees),
        }
      : null;

  return {
    from: filtered.from,
    to: filtered.to,
    segment,
    segments: {
      office: { headcount: officeIds.length, attendanceRate: segmentRate(officeReport) },
      pharmacy: { headcount: pharmacyIds.length, attendanceRate: segmentRate(pharmacyReport) },
    },
    kpis: {
      headcount: filtered.summary.employees,
      attendanceRate,
      presentPersonDays: filtered.summary.presentPersonDays,
      absentPersonDays: filtered.summary.absentPersonDays,
      latePersonDays: filtered.summary.latePersonDays,
      leavePersonDays,
      incompletePersonDays,
      totalLateMinutes: filtered.summary.totalLateMinutes,
      avgLateMinutes: filtered.summary.employees
        ? Math.round(filtered.summary.totalLateMinutes / filtered.summary.employees)
        : 0,
      totalWorkedHours: Math.round((workedMinutes / 60) * 10) / 10,
      shiftCoverage: attendanceRate,
      targetRate: 95,
      deltaRate: prevRate != null ? Math.round((attendanceRate - prevRate) * 10) / 10 : null,
    },
    today,
    statusBreakdown: [
      { key: "present", label: "Vaqtida", count: statusCounts.present, pct: pct(statusCounts.present, statusTotal) },
      { key: "late", label: "Kechikdi", count: statusCounts.late, pct: pct(statusCounts.late, statusTotal) },
      { key: "absent", label: "Kelmagan", count: statusCounts.absent, pct: pct(statusCounts.absent, statusTotal) },
      { key: "incomplete", label: "To‘liq emas", count: statusCounts.incomplete, pct: pct(statusCounts.incomplete, statusTotal) },
      { key: "leave", label: "Ta'til", count: statusCounts.leave, pct: pct(statusCounts.leave, statusTotal) },
    ],
    dailyTrend,
    monthlyTrend,
    byDepartment,
    byShift,
    byRole,
    distribution,
    topDepartments: byDepartment.slice(0, 5),
    topLate,
    branchOpenings,
    branchOpeningSummary,
    recentCheckins,
    alerts,
    bestDay,
    worstDay,
  };
}
