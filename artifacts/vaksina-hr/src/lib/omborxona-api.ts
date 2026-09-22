import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type WarehouseShift = {
  id: number;
  name: string;
  startHm: string;
  endHm: string;
  overnight: boolean;
  active: boolean;
  memberCount?: number;
  members?: Array<{
    id: number;
    employeeId: number;
    fullName: string;
    position: string | null;
    userRole: string | null;
  }>;
};

export type OmborStaffRow = {
  employeeId: number;
  fullName: string;
  position: string | null;
  employmentStatus: string | null;
  userId: number | null;
  userRole: string | null;
  login: string | null;
  shiftType: string | null;
  shiftLabel: string | null;
  assignedShift: {
    id: number;
    name: string;
    startHm: string;
    endHm: string;
    overnight: boolean;
  } | null;
};

export type OmborHolatGroup = {
  shift: {
    id: number;
    name: string;
    startHm: string;
    endHm: string;
    overnight: boolean;
    checkoutDeadlineHm: string;
  };
  members: Array<{
    employeeId: number;
    fullName: string;
    position: string | null;
    checkInAt: string | null;
    checkOutAt: string | null;
    status: string;
  }>;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || "Xatolik");
  return body as T;
}

export function useOmborMeta(enabled = true) {
  return useQuery({
    queryKey: ["omborxona", "meta"],
    queryFn: () =>
      apiFetch<{
        departmentId: number;
        departmentName: string;
        canManage: boolean;
        canViewHolat: boolean;
        checkoutGraceHours: number;
      }>("/omborxona/meta"),
    enabled,
  });
}

export function useOmborShifts(enabled = true) {
  return useQuery({
    queryKey: ["omborxona", "shifts"],
    queryFn: () =>
      apiFetch<{ departmentId: number; shifts: WarehouseShift[] }>("/omborxona/shifts"),
    enabled,
  });
}

export function useOmborStaff(enabled = true) {
  return useQuery({
    queryKey: ["omborxona", "staff"],
    queryFn: () => apiFetch<{ staff: OmborStaffRow[] }>("/omborxona/staff"),
    enabled,
  });
}

export function useOmborMe(enabled = true) {
  return useQuery({
    queryKey: ["omborxona", "me"],
    queryFn: () =>
      apiFetch<{
        workDate: string;
        employee: {
          id: number;
          fullName: string;
          position: string | null;
          shiftType: string | null;
          shiftLabel: string | null;
        } | null;
        shift: {
          id: number;
          name: string;
          startHm: string;
          endHm: string;
          overnight: boolean;
          workHours: string;
          checkoutGraceHours: number;
          checkoutDeadlineHm: string;
        } | null;
        today: {
          workDate: string;
          checkInAt: string | null;
          checkOutAt: string | null;
          checkInHm: string | null;
          checkOutHm: string | null;
          status: string | null;
          statusLabel: string;
          nextAction: "in" | "out" | "done";
        } | null;
      }>("/omborxona/me"),
    enabled,
    refetchInterval: 60_000,
  });
}

export type OmborHistoryPeriod = "week" | "month" | "year";
export type OmborHistoryFilter = "all" | "late" | "absent";

export type OmborHistoryDay = {
  workDate: string;
  checkInHm: string | null;
  checkOutHm: string | null;
  status: string | null;
  statusLabel: string;
  kind: "late" | "absent" | "ok" | "other";
};

export function useOmborHistory(
  period: OmborHistoryPeriod,
  filter: OmborHistoryFilter,
  enabled = true,
) {
  return useQuery({
    queryKey: ["omborxona", "history", period, filter],
    queryFn: () =>
      apiFetch<{
        period: OmborHistoryPeriod;
        filter: OmborHistoryFilter;
        from: string;
        to: string;
        label: string;
        summary: { total: number; late: number; absent: number; ok: number };
        days: OmborHistoryDay[];
      }>(`/omborxona/me/history?period=${period}&filter=${filter}`),
    enabled,
  });
}

export function useOmborHolat(date: string, enabled = true) {
  return useQuery({
    queryKey: ["omborxona", "holat", date],
    queryFn: () =>
      apiFetch<{ workDate: string; groups: OmborHolatGroup[] }>(
        `/omborxona/holat?date=${encodeURIComponent(date)}`,
      ),
    enabled,
  });
}

export function useOmborMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["omborxona"] });
  };

  const createShift = useMutation({
    mutationFn: (body: { name: string; startHm: string; endHm: string; overnight?: boolean }) =>
      apiFetch<{ shift: WarehouseShift }>("/omborxona/shifts", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidate,
  });

  const updateShift = useMutation({
    mutationFn: (input: {
      id: number;
      name?: string;
      startHm?: string;
      endHm?: string;
      overnight?: boolean;
      active?: boolean;
    }) =>
      apiFetch<{ shift: WarehouseShift }>(`/omborxona/shifts/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });

  const assign = useMutation({
    mutationFn: (body: {
      shiftId: number;
      employeeId?: number;
      employeeIds?: number[];
      note?: string;
    }) => apiFetch<{ ok: boolean; count: number }>("/omborxona/assign", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    onSuccess: invalidate,
  });

  const unassign = useMutation({
    mutationFn: (body: { employeeId: number }) =>
      apiFetch("/omborxona/unassign", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });

  return { createShift, updateShift, assign, unassign };
}
