import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type ReceptionVisitType = "guest" | "staff" | "candidate" | "request" | "package" | string;
export type ReceptionStatus = "waiting" | "in_progress" | "done" | "cancelled" | "no_show";

export type ReceptionLog = {
  id: number;
  visitType: ReceptionVisitType;
  visitTypeLabel?: string | null;
  topic: string | null;
  visitorFullName: string;
  visitorPhone: string | null;
  visitorRoleHint: string | null;
  hostName: string | null;
  hostUserId: number | null;
  interviewerName: string | null;
  interviewerUserId: number | null;
  purpose: string | null;
  notes: string | null;
  status: ReceptionStatus | string;
  visitAt: string;
  leftAt: string | null;
  loggedByUserId: number;
  loggedByName?: string | null;
  hostUserName?: string | null;
  hostUserRole?: string | null;
  hostUserPhone?: string | null;
  interviewerUserName?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReceptionLogInput = {
  visitType: ReceptionVisitType;
  topic?: string | null;
  visitorFullName: string;
  visitorPhone?: string | null;
  visitorRoleHint?: string | null;
  hostName?: string | null;
  hostUserId?: number | null;
  interviewerName?: string | null;
  interviewerUserId?: number | null;
  purpose?: string | null;
  notes?: string | null;
  status?: ReceptionStatus | string;
  visitAt?: string | null;
  leftAt?: string | null;
};

export type ReceptionHostPresence = {
  status: "in_office" | "left" | "absent" | "leave";
  label: string;
  checkIn: string | null;
  checkOut: string | null;
};

export type ReceptionHost = {
  id: number;
  fullName: string;
  role: string;
  phone?: string | null;
  hasTelegram?: boolean;
  hasPhoto?: boolean;
  photoUrl?: string | null;
  presence?: ReceptionHostPresence;
};

export type ReceptionStats = {
  total: number;
  today: number;
  waiting: number;
  inProgress: number;
  done: number;
  interviewsToday: number;
  visitsToday: number;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Xato ${res.status}`);
  }
  return data as T;
}

export function fetchReceptionMeta() {
  return apiFetch<{
    visitTypes: { value: string; label: string }[];
    topics: { value: string; label: string }[];
    statuses: { value: string; label: string }[];
    roleHints: string[];
    canWrite: boolean;
  }>("/resepsion/meta");
}

export function fetchReceptionHosts(q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return apiFetch<{ items: ReceptionHost[] }>(`/resepsion/hosts${qs}`);
}

export function fetchReceptionLogs(params?: {
  visitType?: string;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
}) {
  const sp = new URLSearchParams();
  if (params?.visitType) sp.set("visitType", params.visitType);
  if (params?.status) sp.set("status", params.status);
  if (params?.from) sp.set("from", params.from);
  if (params?.to) sp.set("to", params.to);
  if (params?.q) sp.set("q", params.q);
  const qs = sp.toString() ? `?${sp}` : "";
  return apiFetch<{
    items: ReceptionLog[];
    stats: ReceptionStats;
    canWrite: boolean;
  }>(`/resepsion/logs${qs}`);
}

export function createReceptionLog(body: ReceptionLogInput) {
  return apiFetch<{ ok: true; item: ReceptionLog }>("/resepsion/logs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateReceptionLog(id: number, body: Partial<ReceptionLogInput>) {
  return apiFetch<{ ok: true; item: ReceptionLog }>(`/resepsion/logs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteReceptionLog(id: number) {
  return apiFetch<{ ok: true }>(`/resepsion/logs/${id}`, { method: "DELETE" });
}

export function useReceptionMeta() {
  return useQuery({ queryKey: ["resepsion", "meta"], queryFn: fetchReceptionMeta });
}

export function useReceptionHosts(q?: string) {
  return useQuery({
    queryKey: ["resepsion", "hosts", q || ""],
    queryFn: () => fetchReceptionHosts(q),
  });
}

export function useReceptionLogs(params?: {
  visitType?: string;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
}) {
  return useQuery({
    queryKey: ["resepsion", "logs", params],
    queryFn: () => fetchReceptionLogs(params),
    refetchInterval: 20_000,
  });
}

export function useReceptionMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["resepsion", "logs"] });
  const create = useMutation({
    mutationFn: createReceptionLog,
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ReceptionLogInput> }) =>
      updateReceptionLog(id, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: deleteReceptionLog,
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export function toLocalInputValue(iso?: string | Date | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInputValue(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatVisitDt(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatVisitTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] || ""}${parts[1]![0] || ""}`.toUpperCase();
}
