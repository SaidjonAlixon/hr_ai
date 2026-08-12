import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

export type UserGoal = {
  id: number;
  userId: number;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type GoalDailyLog = {
  id: number;
  goalId: number;
  userId: number;
  workDate: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type GoalsMeResponse = {
  goal: UserGoal | null;
  todayLog: GoalDailyLog | null;
  workDate: string;
  todaySubmitted: boolean;
  logs: GoalDailyLog[];
};

export type GoalPromptStatus = {
  eligible: boolean;
  workDate?: string;
  hasGoal?: boolean;
  goal?: UserGoal | null;
  todaySubmitted?: boolean;
  mustPrompt?: boolean;
};

export const GOAL_ROLES = new Set([
  "admin",
  "hr",
  "hr_direktor",
  "hr_auditor",
  "hr_menejer",
  "director",
  "department_head",
  "recruiter",
  "trainer",
  "mudir",
  "koordinator",
  "texnik",
  "ombor",
]);

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message || `Xato ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function localWorkDate(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isAfterDailyPromptTime(d = new Date()) {
  return d.getHours() > 17 || (d.getHours() === 17 && d.getMinutes() >= 55);
}

export const goalsMeQueryKey = (date?: string) =>
  ["goals", "me", date ?? localWorkDate()] as const;

export function useGoalsMe(options?: {
  query?: Partial<UseQueryOptions<GoalsMeResponse>>;
}) {
  const date = localWorkDate();
  return useQuery({
    queryKey: goalsMeQueryKey(date),
    queryFn: () => apiFetch<GoalsMeResponse>(`/goals/me?date=${date}`),
    ...options?.query,
  });
}

export function useGoalPromptStatus(enabled: boolean) {
  const date = localWorkDate();
  return useQuery({
    queryKey: ["goals", "prompt", date],
    queryFn: () =>
      apiFetch<GoalPromptStatus>(`/goals/me/prompt-status?date=${date}`),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useSaveGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; description?: string | null }) =>
      apiFetch<UserGoal>("/goals/me", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}

export function useSubmitDailyGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { content: string; workDate?: string }) =>
      apiFetch<GoalDailyLog>("/goals/me/daily", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
    },
  });
}
