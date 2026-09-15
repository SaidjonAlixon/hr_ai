import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let message = "Xatolik";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* */
    }
    throw new Error(message);
  }
  return res.json();
}

export type OpsTicket = {
  id: number;
  ticketNo: string;
  dept: string;
  category: string;
  title: string;
  description: string | null;
  branchName: string | null;
  priority: string;
  status: string;
  createdById: number | null;
  assigneeId: number | null;
  createdByName?: string | null;
  assigneeName?: string | null;
  acceptedAt?: string | null;
  acceptedById?: number | null;
  acceptedByName?: string | null;
  completedAt?: string | null;
  completedById?: number | null;
  completedByName?: string | null;
  verifiedAt?: string | null;
  verifiedById?: number | null;
  verifiedByName?: string | null;
  closedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export function useOpsMeta(dept: "it" | "texnik") {
  return useQuery({
    queryKey: ["ops", dept, "meta"],
    queryFn: () =>
      json<{
        categories: Array<{ value: string; label: string }>;
        staff: Array<{ id: number; fullName: string }>;
        canManage: boolean;
        canCreate: boolean;
        canViewAll: boolean;
      }>(`/api/ops-tickets/meta?dept=${dept}`),
  });
}

export function useOpsDash(dept: "it" | "texnik") {
  return useQuery({
    queryKey: ["ops", dept, "dash"],
    queryFn: () => json<any>(`/api/ops-tickets/dashboard?dept=${dept}`),
  });
}

export function useOpsTickets(dept: "it" | "texnik", opts?: { status?: string; mine?: boolean }) {
  const qs = [
    opts?.status ? `status=${encodeURIComponent(opts.status)}` : "",
    opts?.mine ? "mine=1" : "",
  ]
    .filter(Boolean)
    .join("&");
  return useQuery({
    queryKey: ["ops", dept, "list", opts?.status, opts?.mine],
    queryFn: () => json<OpsTicket[]>(`/api/ops-tickets?dept=${dept}${qs ? `&${qs}` : ""}`),
  });
}

export function useOpsMutations(dept: "it" | "texnik") {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["ops", dept] });
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        json("/api/ops-tickets", { method: "POST", body: JSON.stringify({ ...body, dept }) }),
      onSuccess: inv,
    }),
    patch: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
        json(`/api/ops-tickets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
      onSuccess: inv,
    }),
  };
}
