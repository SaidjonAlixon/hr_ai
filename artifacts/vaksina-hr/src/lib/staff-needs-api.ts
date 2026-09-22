import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type StaffNeedBranch = {
  id: number;
  managerName: string;
  branchLocation: string;
  latitude: number | null;
  longitude: number | null;
};

export type StaffNeedRequest = {
  id: number;
  coordinatorUserId: number;
  managerEmployeeId: number | null;
  branchLocation: string | null;
  shiftType: string;
  shiftLabel: string | null;
  roleNeeded: string;
  positionText?: string | null;
  sourceType?: string;
  neededBy?: string | null;
  count: number;
  note: string | null;
  status: string;
  hrApprovedById: number | null;
  hrApprovedAt: string | null;
  deadlineAt: string | null;
  foundById: number | null;
  foundAt: string | null;
  rejectedById: number | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  requestId: number | null;
  createdAt: string;
  updatedAt: string;
  branchName: string;
  managerName: string | null;
  coordinatorName: string | null;
  hrApprovedByName: string | null;
  foundByName: string | null;
  shiftDisplay: string;
  roleDisplay: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let message = "Xatolik";
    try {
      const body = await res.json();
      message = body?.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function useStaffNeedBranches(enabled = true) {
  return useQuery({
    queryKey: ["staff-needs", "my-branches"],
    queryFn: () => apiFetch<StaffNeedBranch[]>("/staff-needs/my-branches"),
    enabled,
  });
}

export function useStaffNeeds(status?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["staff-needs", status || "all"],
    queryFn: () =>
      apiFetch<StaffNeedRequest[]>(
        status ? `/staff-needs?status=${encodeURIComponent(status)}` : "/staff-needs",
      ),
    enabled: options?.enabled ?? true,
    refetchInterval: 20_000,
  });
}

export function useCreateStaffNeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      managerEmployeeId?: number;
      shiftType?: string;
      roleNeeded?: string;
      positionText?: string;
      neededBy?: string;
      count: number;
      note?: string;
    }) =>
      apiFetch<StaffNeedRequest>("/staff-needs", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-needs"] });
    },
  });
}

export function useApproveStaffNeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deadlineHours }: { id: number; deadlineHours?: number }) =>
      apiFetch<{ need: StaffNeedRequest; requestId: number }>(`/staff-needs/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ deadlineHours: deadlineHours ?? 72 }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-needs"] });
    },
  });
}

export function useRejectStaffNeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      apiFetch<StaffNeedRequest>(`/staff-needs/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-needs"] });
    },
  });
}

export function useFoundStaffNeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<StaffNeedRequest>(`/staff-needs/${id}/found`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-needs"] });
    },
  });
}

export function useCancelStaffNeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<StaffNeedRequest>(`/staff-needs/${id}/cancel`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-needs"] });
    },
  });
}

export function statusLabel(status: string): string {
  if (status === "open" || status === "pending_hr") return "Ochiq ariza";
  if (status === "approved" || status === "searching") return "Ochiq ariza";
  if (status === "found") return "Topildi";
  if (status === "rejected") return "Rad etilgan";
  if (status === "cancelled") return "Bekor";
  return status;
}
