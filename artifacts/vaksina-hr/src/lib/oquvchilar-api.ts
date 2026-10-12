import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type StudentStage = {
  stage: number;
  title: string;
  score: number | null;
  attempts: number;
  passed: boolean;
  videoDone: boolean;
  slidesDone: boolean;
  passedAt: string | null;
};

export type StudentKirish = {
  status: "not_started" | "in_progress" | "completed" | string;
  currentStage: number;
  stageCount: number;
  passed: number;
  attempts: number;
  avgScore: number | null;
  progressPct: number;
  completedAt: string | null;
  lastActivityAt: string | null;
  stages: StudentStage[];
};

export type Student = {
  id: number;
  fullName: string;
  login: string;
  password: string;
  phone: string | null;
  status: string;
  groupName: string | null;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  kirish: StudentKirish;
};

export type StudentRoster = {
  summary: {
    total: number;
    active: number;
    blocked: number;
    notStarted: number;
    inProgress: number;
    completed: number;
    avgProgress: number;
    avgScore: number | null;
  };
  items: Student[];
  groups: string[];
  stages: Array<{ stage: number; title: string; passed: number; avgScore: number | null }>;
  stageCount: number;
  passScore: number;
};

export type StudentCred = { id: number; fullName: string; login: string; password: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Xato ${res.status}`);
  return body as T;
}

const KEY = ["oquvchilar"] as const;

export function useStudents() {
  return useQuery({ queryKey: KEY, queryFn: () => api<StudentRoster>("/oquvchilar"), refetchInterval: 60_000 });
}

function useInvalidating<TArgs, TRes>(fn: (args: TArgs) => Promise<TRes>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCreateStudent() {
  return useInvalidating(
    (body: { fullName: string; phone?: string; groupName?: string; note?: string; login?: string; password?: string }) =>
      api<{ student: StudentCred }>("/oquvchilar", { method: "POST", body: JSON.stringify(body) }),
  );
}

export function useBulkCreateStudents() {
  return useInvalidating((body: { text: string; groupName?: string }) =>
    api<{ created: StudentCred[]; errors: Array<{ line: string; error: string }> }>("/oquvchilar/bulk", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

export function useUpdateStudent() {
  return useInvalidating(
    ({ id, ...body }: { id: number; fullName?: string; phone?: string; groupName?: string; note?: string; login?: string; password?: string; status?: "active" | "blocked" }) =>
      api<{ ok: boolean }>(`/oquvchilar/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  );
}

export function useResetStudentPassword() {
  return useInvalidating((id: number) =>
    api<{ login: string; password: string }>(`/oquvchilar/${id}/reset-password`, { method: "POST" }),
  );
}

export function useResetStudentProgress() {
  return useInvalidating((id: number) => api<{ ok: boolean }>(`/oquvchilar/${id}/reset-progress`, { method: "POST" }));
}

export function useDeleteStudent() {
  return useInvalidating((id: number) => api<{ ok: boolean }>(`/oquvchilar/${id}`, { method: "DELETE" }));
}

export async function downloadStudentsExcel(group?: string) {
  const qs = group ? `?group=${encodeURIComponent(group)}` : "";
  const res = await fetch(`/api/oquvchilar/export${qs}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "Excel yuklanmadi");
  }
  const blob = await res.blob();
  const { deliverFile } = await import("./tg-download");
  return deliverFile(blob, `oquvchilar_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
