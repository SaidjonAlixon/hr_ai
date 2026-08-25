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
