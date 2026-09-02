import { useQuery } from "@tanstack/react-query";

export type DavomatSegment = "all" | "office" | "pharmacy";

export type DavomatAnalytics = {
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

export type AnalyticsRangePreset = "today" | "7d" | "30d" | "month";

export function tashkentTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDaysYmd(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return dt.toISOString().slice(0, 10);
}

function tashkentYmd() {
  return tashkentTodayYmd();
}

export function rangeForPreset(preset: AnalyticsRangePreset) {
  const to = tashkentYmd();
  if (preset === "today") return { from: to, to };
  if (preset === "7d") return { from: addDaysYmd(to, -6), to };
  if (preset === "30d") return { from: addDaysYmd(to, -29), to };
  const [y, m] = to.split("-");
  return { from: `${y}-${m}-01`, to };
}

export async function fetchDavomatAnalytics(params: {
  from?: string;
  to?: string;
  segment?: DavomatSegment;
}): Promise<DavomatAnalytics> {
  const sp = new URLSearchParams();
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.segment) sp.set("segment", params.segment);
  const res = await fetch(`/api/davomat/analytics?${sp}`, { credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 404) {
      throw new Error("API yangilanmagan — serverni qayta ishga tushiring");
    }
    throw new Error(body.error || "Davomat analitikasi yuklanmadi");
  }
  return res.json();
}

export function useDavomatAnalytics(
  params: { from: string; to: string; segment: DavomatSegment },
  enabled = true,
) {
  return useQuery({
    queryKey: ["davomat-analytics", params],
    queryFn: () => fetchDavomatAnalytics(params),
    enabled,
    staleTime: 60_000,
    retry: 1,
  });
}
