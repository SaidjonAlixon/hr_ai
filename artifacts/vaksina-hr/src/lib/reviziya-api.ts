import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { canViewReviziya } from "./roles";

export { canViewReviziya };

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
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type RevDoc = {
  id: number;
  docNo: string;
  docType: string;
  status: string;
  branchName: string | null;
  plannedDate: string | null;
  responsibleName: string | null;
  payload: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  denoms: Array<Record<string, unknown>>;
  photos: Array<{ url: string; caption?: string }>;
  shortageAmount: number;
  checkLat?: number | null;
  checkLng?: number | null;
  createdAt?: string;
  audit?: Array<{ id: number; action: string; detail: string | null; createdAt: string }>;
};

export function useReviziyaMeta() {
  return useQuery({ queryKey: ["reviziya", "meta"], queryFn: () => json<any>("/api/reviziya/meta") });
}

export function useReviziyaDashboard() {
  return useQuery({ queryKey: ["reviziya", "dashboard"], queryFn: () => json<any>("/api/reviziya/dashboard") });
}

export function useReviziyaDocs(params?: { type?: string; status?: string; q?: string }) {
  const qs = new URLSearchParams();
  if (params?.type) qs.set("type", params.type);
  if (params?.status) qs.set("status", params.status);
  if (params?.q) qs.set("q", params.q);
  const s = qs.toString();
  return useQuery({
    queryKey: ["reviziya", "docs", params],
    queryFn: () => json<RevDoc[]>(`/api/reviziya/documents${s ? `?${s}` : ""}`),
  });
}

export function useReviziyaDoc(id?: number) {
  return useQuery({
    queryKey: ["reviziya", "doc", id],
    enabled: !!id,
    queryFn: () => json<RevDoc>(`/api/reviziya/documents/${id}`),
  });
}

export function useReviziyaBranches() {
  return useQuery({
    queryKey: ["reviziya", "branches"],
    queryFn: () => json<Array<{ id: number; branchName: string; responsibleName: string }>>("/api/reviziya/branches"),
  });
}

export function useReviziyaTransit() {
  return useQuery({
    queryKey: ["reviziya", "transit"],
    queryFn: () => json<any[]>("/api/reviziya/in-transit"),
  });
}

export function useReviziyaMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["reviziya"] });
  };
  return {
    create: useMutation({
      mutationFn: (body: unknown) => json("/api/reviziya/documents", { method: "POST", body: JSON.stringify(body) }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
        json(`/api/reviziya/documents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
      onSuccess: invalidate,
    }),
    advance: useMutation({
      mutationFn: ({ id, status }: { id: number; status?: string }) =>
        json(`/api/reviziya/documents/${id}/advance`, { method: "POST", body: JSON.stringify({ status }) }),
      onSuccess: invalidate,
    }),
    storno: useMutation({
      mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
        json(`/api/reviziya/documents/${id}/storno`, { method: "POST", body: JSON.stringify({ reason }) }),
      onSuccess: invalidate,
    }),
    otp: useMutation({
      mutationFn: (id: number) => json(`/api/reviziya/documents/${id}/otp`, { method: "POST", body: "{}" }),
    }),
    confirmOtp: useMutation({
      mutationFn: ({ id, code }: { id: number; code: string }) =>
        json(`/api/reviziya/documents/${id}/confirm-otp`, { method: "POST", body: JSON.stringify({ code }) }),
      onSuccess: invalidate,
    }),
    handover: useMutation({
      mutationFn: (id: number) => json(`/api/reviziya/in-transit/${id}/handover`, { method: "POST", body: "{}" }),
      onSuccess: invalidate,
    }),
    addDict: useMutation({
      mutationFn: (body: unknown) => json("/api/reviziya/dicts", { method: "POST", body: JSON.stringify(body) }),
      onSuccess: invalidate,
    }),
  };
}

const OFFLINE_KEY = "reviziya_offline_queue";

export function enqueueOffline(doc: unknown) {
  const raw = localStorage.getItem(OFFLINE_KEY);
  const arr = raw ? JSON.parse(raw) : [];
  arr.push({ kind: "create", doc, at: new Date().toISOString() });
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(arr));
}

export function peekOfflineCount() {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY);
    return raw ? JSON.parse(raw).length : 0;
  } catch {
    return 0;
  }
}

export async function flushOffline() {
  const raw = localStorage.getItem(OFFLINE_KEY);
  const arr = raw ? JSON.parse(raw) : [];
  for (const op of arr) {
    if (op.doc) {
      await json("/api/reviziya/documents", { method: "POST", body: JSON.stringify(op.doc) });
    }
  }
  localStorage.removeItem(OFFLINE_KEY);
  return arr.length;
}

/* ── Filial reviziya sikli (visits) ── */

export type VisitDashBranch = {
  branchId: number;
  branchName: string;
  mudirName: string;
  region: string;
  lastRevisionDate: string | null;
  nextRevisionDate: string | null;
  daysLeft: number | null;
  cycleStatus: string;
  cycleStatusLabel: string;
  shortageAmount: number;
  collectedAmount: number;
  remainingAmount: number;
  excessAmount?: number;
  assignedRevizorName: string | null;
  activeVisitId: number | null;
  workflowStatus: string | null;
  lastVisitDuration?: string | null;
  cycleMonths?: number | null;
  responsibleNames?: string | null;
  lastActNumber?: string | null;
  activeRevisionDate?: string | null;
};

export type VisitDashResponse = {
  today: string;
  scope: string;
  stats: {
    totalBranches: number;
    completedOk: number;
    tezOrada: number;
    muddatiOtgan: number;
    siklOtkazilgan: number;
    yangiOchilgan: number;
    jarayonda: number;
    totalShortage: number;
    totalCollected: number;
    totalRemaining: number;
  };
  branches: VisitDashBranch[];
  pagination: { page: number; limit: number; total: number; pages: number };
};

export function useReviziyaVisitsMeta() {
  return useQuery({
    queryKey: ["reviziya", "visits", "meta"],
    queryFn: () => json<any>("/api/reviziya/visits/meta"),
  });
}

export function useReviziyaVisitsDashboard(params?: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
  }
  const s = qs.toString();
  return useQuery({
    queryKey: ["reviziya", "visits", "dashboard", params],
    queryFn: () => json<VisitDashResponse>(`/api/reviziya/visits/dashboard${s ? `?${s}` : ""}`),
  });
}

export function useReviziyaBranchDetail(branchId?: number | null) {
  return useQuery({
    queryKey: ["reviziya", "visits", "branch", branchId],
    enabled: !!branchId,
    queryFn: () => json<any>(`/api/reviziya/visits/branch/${branchId}`),
  });
}

export function useReviziyaMyTasks() {
  return useQuery({
    queryKey: ["reviziya", "visits", "my-tasks"],
    queryFn: () => json<any>("/api/reviziya/visits/my-tasks"),
  });
}

export type RequestState = "pending" | "approved" | "rejected";

export type ReviziyaRequest = {
  id: number;
  branchId: number;
  branchName: string;
  revisionDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  assignedEmployeeId: number | null;
  assignedEmployeeName: string | null;
  workflowStatus: string;
  notes: string | null;
  requestState: RequestState;
  requestedByName: string | null;
  requestedAt: string | null;
  requestDecidedByName: string | null;
  requestDecidedAt: string | null;
  requestRejectReason: string | null;
};

export function useReviziyaRequests() {
  return useQuery({
    queryKey: ["reviziya", "visits", "requests"],
    queryFn: () =>
      json<{
        items: ReviziyaRequest[];
        counts: Record<RequestState, number>;
        canDecide: boolean;
        canCreate: boolean;
      }>("/api/reviziya/visits/requests"),
  });
}

export function useReviziyaCalendar(from: string, to: string) {
  return useQuery({
    queryKey: ["reviziya", "visits", "calendar", from, to],
    enabled: !!from && !!to,
    queryFn: () => json<{ events: any[] }>(`/api/reviziya/visits/calendar?from=${from}&to=${to}`),
  });
}

export function useReviziyaRevizors() {
  return useQuery({
    queryKey: ["reviziya", "visits", "revizors"],
    queryFn: () => json<Array<{ id: number; fullName: string; role: string }>>("/api/reviziya/visits/revizors"),
  });
}

export function fetchNextActNumber() {
  return json<{ actNumber: string }>("/api/reviziya/visits/next-act-number");
}

export function fetchBranchStaff(branchId: number) {
  return json<{
    people: Array<{ id: number; fullName: string; orgRole: string; roleLabel: string; phone: string }>;
  }>(`/api/reviziya/branches/${branchId}/staff`);
}

export function fetchVisitByAct(number: string) {
  return json<Record<string, unknown>>(
    `/api/reviziya/visits/by-act?number=${encodeURIComponent(number.trim())}`,
  );
}

export function useReviziyaVisitMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["reviziya", "visits"] });
  return {
    create: useMutation({
      mutationFn: (body: unknown) => json("/api/reviziya/visits", { method: "POST", body: JSON.stringify(body) }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
        json(`/api/reviziya/visits/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
      onSuccess: invalidate,
    }),
    assign: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
        json(`/api/reviziya/visits/${id}/assign`, { method: "POST", body: JSON.stringify(body) }),
      onSuccess: invalidate,
    }),
    approveRequest: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
        json(`/api/reviziya/visits/${id}/approve-request`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      onSuccess: invalidate,
    }),
    rejectRequest: useMutation({
      mutationFn: ({ id, reason }: { id: number; reason: string }) =>
        json(`/api/reviziya/visits/${id}/reject-request`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        }),
      onSuccess: invalidate,
    }),
    accept: useMutation({
      mutationFn: (id: number) => json(`/api/reviziya/visits/${id}/accept`, { method: "POST", body: "{}" }),
      onSuccess: invalidate,
    }),
    start: useMutation({
      mutationFn: (id: number) => json(`/api/reviziya/visits/${id}/start`, { method: "POST", body: "{}" }),
      onSuccess: invalidate,
    }),
    complete: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
        json(`/api/reviziya/visits/${id}/complete`, { method: "POST", body: JSON.stringify(body) }),
      onSuccess: invalidate,
    }),
    cancel: useMutation({
      mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
        json(`/api/reviziya/visits/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
      onSuccess: invalidate,
    }),
    reviewApprove: useMutation({
      mutationFn: (id: number) => json(`/api/reviziya/visits/${id}/review-approve`, { method: "POST", body: "{}" }),
      onSuccess: invalidate,
    }),
    reviewReject: useMutation({
      mutationFn: ({ id, reason, action }: { id: number; reason: string; action: "redo" | "cancel" }) =>
        json(`/api/reviziya/visits/${id}/review-reject`, {
          method: "POST",
          body: JSON.stringify({ reason, action }),
        }),
      onSuccess: invalidate,
    }),
    addPayment: useMutation({
      mutationFn: ({ id, ...body }: { id: number } & AddPaymentBody) =>
        json<{ visit: { remainingAmount: number } }>(`/api/reviziya/visits/${id}/payments`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      onSuccess: invalidate,
    }),
    voidPayment: useMutation({
      mutationFn: ({ paymentId, reason }: { paymentId: number; reason: string }) =>
        json(`/api/reviziya/visits/payments/${paymentId}/void`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        }),
      onSuccess: invalidate,
    }),
  };
}

export type PaymentMethod = "cash" | "card" | "transfer" | "salary" | "other";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Naqd",
  card: "Karta",
  transfer: "O‘tkazma",
  salary: "Oylikdan ushlab qolindi",
  other: "Boshqa",
};

export type AddPaymentBody = {
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  note?: string | null;
  receiptUrl?: string | null;
};

export type VisitPayment = {
  id: number;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  note: string | null;
  receiptUrl: string | null;
  remainingAfter: number | null;
  createdAt: string;
  createdByName: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
};
