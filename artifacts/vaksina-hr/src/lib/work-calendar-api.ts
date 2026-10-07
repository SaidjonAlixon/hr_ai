import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { canEditKpiSettings, canManagePayroll } from "./oylik-api";
import { canManageSmenaFilial, hasFullPlatformAccess, isHrRole } from "./roles";

export type RestRule = {
  id: number;
  scope: string;
  restWeekdays: number[];
  restLabels: string[];
  effectiveFrom: string;
  note: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
};

export type ScopeHours = {
  start: string;
  end: string;
  overnight: boolean;
  /** base — o‘zi sozlanadi; derived — boshqa smenalardan olinadi; orta — alohida, istalgan soat */
  kind: "base" | "derived" | "orta";
  custom: boolean;
  from: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
  /** To‘lanmaydigan tushlik (daq) — ish vaqtidan ayiriladi */
  breakMin?: number;
  breakEditable?: boolean;
};

export type ScopeSchedule = {
  scope: string;
  label: string;
  staffCount: number;
  hours?: ScopeHours | null;
  rule: RestRule | null;
  upcoming: RestRule[];
  history: RestRule[];
  legacy: boolean;
  month: {
    month: string;
    workDays: string[];
    restDays: string[];
    overrides: Array<{ day: string; isWork: boolean }>;
    total: number;
  };
};

export type SwapPayTo = "replacement" | "self";

export type ShiftSwap = {
  id: number;
  workDate: string;
  employeeId: number;
  employeeName: string;
  replacementEmployeeId: number;
  replacementName: string;
  reason: string | null;
  payTo: SwapPayTo | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdByName: string | null;
  createdAt: string | null;
};

export type WorkCalendarData = {
  month: string;
  today: string;
  scopes: ScopeSchedule[];
  swaps: ShiftSwap[];
  canEdit: boolean;
  canSwap: boolean;
  canDecide: boolean;
  canEditHours?: boolean;
  /** Kechikish chegarasi (daq) — barcha smenalar uchun */
  graceMinutes?: number;
};

export type ScopeStaffMember = {
  id: number;
  fullName: string;
  position: string;
  branch: string;
  shiftLabel: string;
  start: string;
  end: string;
  overnight: boolean;
  override: {
    id: number;
    label: string;
    mode: "permanent" | "period";
    validFrom: string;
    validTo: string | null;
    note: string | null;
  } | null;
};

export type SwapStaff = { id: number; fullName: string; position: string; branch: string; scope: string; shift: string };

/** ISO hafta kuni: 1 — dushanba … 7 — yakshanba */
export const WEEKDAYS_UZ = [
  { day: 1, short: "Du", label: "Dushanba" },
  { day: 2, short: "Se", label: "Seshanba" },
  { day: 3, short: "Ch", label: "Chorshanba" },
  { day: 4, short: "Pa", label: "Payshanba" },
  { day: 5, short: "Ju", label: "Juma" },
  { day: 6, short: "Sh", label: "Shanba" },
  { day: 7, short: "Ya", label: "Yakshanba" },
] as const;

export function canViewWorkSchedule(role?: string | null) {
  return canManagePayroll(role) || canManageSmenaFilial(role) || hasFullPlatformAccess(role) || isHrRole(role);
}

export function canEditWorkSchedule(role?: string | null) {
  return canEditKpiSettings(role) || isHrRole(role) || hasFullPlatformAccess(role);
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let message = "Xatolik";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}

export function useWorkCalendar(month: string, enabled = true) {
  return useQuery({
    queryKey: ["work-calendar", month],
    queryFn: () => json<WorkCalendarData>(`/api/work-calendar?month=${encodeURIComponent(month)}`),
    enabled,
    staleTime: 30_000,
  });
}

export function useSwapStaff(enabled: boolean) {
  return useQuery({
    queryKey: ["work-calendar", "staff"],
    queryFn: () => json<{ items: SwapStaff[] }>("/api/work-calendar/staff"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["work-calendar"] });
    void qc.invalidateQueries({ queryKey: ["oylik"] });
  };
}

export function useSaveRestRule() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { scope: string; restWeekdays: number[]; effectiveFrom: string; note?: string; month: string }) =>
      json<{ ok: boolean; scope: ScopeSchedule }>("/api/work-calendar/rule", { method: "PUT", body: JSON.stringify(p) }),
    onSuccess: invalidate,
  });
}

export function useDeleteRestRule() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => json<{ ok: boolean }>(`/api/work-calendar/rule/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useCreateSwap() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { workDate: string; employeeId: number; replacementEmployeeId: number; reason?: string; payTo?: SwapPayTo | null }) =>
      json<{ ok: boolean; id: number }>("/api/work-calendar/swaps", { method: "POST", body: JSON.stringify(p) }),
    onSuccess: invalidate,
  });
}

export function useDecideSwap() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: { id: number; payTo: SwapPayTo }) =>
      json<{ ok: boolean }>(`/api/work-calendar/swaps/${p.id}/decide`, { method: "POST", body: JSON.stringify({ payTo: p.payTo }) }),
    onSuccess: invalidate,
  });
}

export function useCancelSwap() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => json<{ ok: boolean }>(`/api/work-calendar/swaps/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useScopeStaff(scope: string, enabled: boolean) {
  return useQuery({
    queryKey: ["work-calendar", "scope-staff", scope],
    queryFn: () =>
      json<{ scope: string; items: ScopeStaffMember[]; canEditHours: boolean }>(
        `/api/work-calendar/scope-staff?scope=${encodeURIComponent(scope)}`,
      ),
    enabled,
    staleTime: 60_000,
  });
}

function useInvalidateHours() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return () => {
    invalidate();
    void qc.invalidateQueries({ queryKey: ["davomat"] });
    void qc.invalidateQueries({ queryKey: ["attendance-settings"] });
  };
}

export function useSaveShiftHours() {
  const invalidate = useInvalidateHours();
  return useMutation({
    mutationFn: (p: { scope: string; start?: string; end?: string; breakMin?: number; reset?: boolean }) =>
      json<{ ok: boolean }>("/api/work-calendar/hours", { method: "PUT", body: JSON.stringify(p) }),
    onSuccess: invalidate,
  });
}

export function useSaveGraceMinutes() {
  const invalidate = useInvalidateHours();
  return useMutation({
    mutationFn: (graceMinutes: number) =>
      json<{ ok: boolean }>("/api/work-calendar/grace", { method: "PUT", body: JSON.stringify({ graceMinutes }) }),
    onSuccess: invalidate,
  });
}

export function useSaveStaffHours() {
  const invalidate = useInvalidateHours();
  return useMutation({
    mutationFn: (p: { employeeId: number; scope: string; start: string; end: string; validFrom?: string; validTo?: string | null; note?: string }) =>
      json<{ ok: boolean; id: number }>("/api/work-calendar/staff-hours", { method: "PUT", body: JSON.stringify(p) }),
    onSuccess: invalidate,
  });
}

export function useClearStaffHours() {
  const invalidate = useInvalidateHours();
  return useMutation({
    mutationFn: (employeeId: number) => json<{ ok: boolean }>(`/api/work-calendar/staff-hours/${employeeId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

/** "08:00"–"17:00" → 9 soat; tun smenasida ertasi kungacha */
export function spanMinutes(start: string, end: string): number {
  const toMin = (hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : diff + 24 * 60;
}

export function spanLabel(start: string, end: string): string {
  const total = spanMinutes(start, end);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} soat ${m} daqiqa` : `${h} soat`;
}

export function hoursText(h: Pick<ScopeHours, "start" | "end" | "overnight"> | null | undefined): string {
  if (!h) return "";
  return `${h.start}–${h.end}${h.overnight ? " (ertasi)" : ""}`;
}

export function restSummary(rule: RestRule | null, legacy: boolean, scope: string): string {
  if (!rule) {
    if (legacy && scope === "ofis") return "Shanba va yakshanba dam (standart)";
    return legacy ? "Yakshanba dam (standart)" : "Dam kuni yo‘q";
  }
  if (!rule.restWeekdays.length) return "Haftalik dam kuni yo‘q — har kuni ish";
  return `${rule.restLabels.join(", ")} — dam`;
}
