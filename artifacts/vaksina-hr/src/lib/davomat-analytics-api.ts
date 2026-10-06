import { useEffect, useRef } from "react";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";

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
  byBranch: Array<{
    name: string;
    headcount: number;
    present: number;
    late: number;
    absent: number;
    attendanceRate: number;
    staff?: Array<{
      id: number;
      fullName: string;
      position: string;
      present: number;
      late: number;
      absent: number;
      incomplete: number;
      leave: number;
      lateMinutes: number;
      attendanceRate: number;
      lastCheckIn: string | null;
      lastStatus: string;
      lastStatusLabel: string;
    }>;
  }>;
  byDepartment: Array<{
    name: string;
    headcount: number;
    present: number;
    late: number;
    absent: number;
    attendanceRate: number;
    staff?: Array<{
      id: number;
      fullName: string;
      position: string;
      present: number;
      late: number;
      absent: number;
      incomplete: number;
      leave: number;
      lateMinutes: number;
      attendanceRate: number;
      lastCheckIn: string | null;
      lastStatus: string;
      lastStatusLabel: string;
    }>;
  }>;
  byShift: Array<{
    key: string;
    label: string;
    departments?: Array<{ name: string; headcount: number }>;
    segment?: "office" | "pharmacy";
    start?: string;
    end?: string;
    headcount: number;
    present: number;
    late: number;
    absent: number;
    expected?: number;
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
    lateDetails?: Array<{
      date: string;
      checkIn: string;
      lateMinutes: number;
    }>;
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
    staff: Array<{
      id: number;
      fullName: string;
      position: string;
      shiftLabel: string;
      checkIn: string | null;
      checkOut: string | null;
      status: "on_time" | "late" | "absent" | "leave" | "incomplete";
      statusLabel: string;
      lateMinutes: number;
    }>;
  }>;
  branchOpeningSummary: {
    date: string;
    total: number;
    onTime: number;
    late: number;
    absent: number;
    leave: number;
  } | null;
  officeDayBoard: Array<{
    employeeId: number;
    fullName: string;
    departmentName: string | null;
    position: string;
    shiftLabel: string;
    expectedOpen: string;
    graceUntil: string;
    checkIn: string | null;
    status: "on_time" | "late" | "absent" | "leave";
    statusLabel: string;
    lateMinutes: number;
    date: string;
  }>;
  officeDaySummary: {
    date: string;
    total: number;
    onTime: number;
    late: number;
    absent: number;
    leave: number;
  } | null;
  recentCheckins: Array<{
    id?: number;
    fullName: string;
    departmentName: string | null;
    position: string;
    date: string;
    checkIn: string;
    checkOut?: string;
    status: string;
    statusLabel: string;
    lateMinutes?: number;
    dayDetails?: Array<{
      date: string;
      checkIn: string;
      checkOut: string;
      status: string;
      statusLabel: string;
      lateMinutes: number;
    }>;
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
  fresh?: boolean;
}): Promise<DavomatAnalytics> {
  const sp = new URLSearchParams();
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.segment) sp.set("segment", params.segment);
  if (params.fresh) sp.set("fresh", "1");
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

const ANALYTICS_STALE_MS = 90_000;

export function prefetchDavomatAnalytics(
  qc: QueryClient,
  params: { from: string; to: string; segment: DavomatSegment },
) {
  return qc.prefetchQuery({
    queryKey: ["davomat-analytics", params],
    queryFn: () => fetchDavomatAnalytics(params),
    staleTime: ANALYTICS_STALE_MS,
  });
}

/** 7 kun / 30 kun / oy — tugma bosilganda dinamika darhol chiqishi uchun fonda yuklanadi */
export function usePrefetchDavomatRanges(segment: DavomatSegment, ready: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      for (const preset of ["7d", "30d", "month"] as const) {
        if (cancelled) return;
        await prefetchDavomatAnalytics(qc, { ...rangeForPreset(preset), segment }).catch(() => undefined);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [qc, segment, ready]);
  return (preset: AnalyticsRangePreset) =>
    void prefetchDavomatAnalytics(qc, { ...rangeForPreset(preset), segment }).catch(() => undefined);
}

export function useDavomatAnalytics(
  params: { from: string; to: string; segment: DavomatSegment },
  enabled = true,
) {
  const freshRef = useRef(false);
  const query = useQuery({
    queryKey: ["davomat-analytics", params],
    queryFn: () => {
      const fresh = freshRef.current;
      freshRef.current = false;
      return fetchDavomatAnalytics({ ...params, fresh });
    },
    enabled,
    staleTime: ANALYTICS_STALE_MS,
    placeholderData: (prev) => prev,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const refetchFresh = () => {
    freshRef.current = true;
    return query.refetch();
  };
  return { ...query, refetchFresh };
}
