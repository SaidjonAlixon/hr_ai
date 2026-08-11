import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

export type KirishStageState = {
  videoDone: boolean;
  slidesDone: boolean;
  score: number | null;
  attempts: number;
  passed: boolean;
  passedAt: string | null;
};

export type KirishProgress = {
  id: number;
  userId: number;
  currentStage: number;
  status: string;
  stages: Record<string, KirishStageState>;
  allPassed: boolean;
  completedAt: string | null;
  passScore: number;
  stageCount: number;
  updatedAt: string;
};

export type KirishSlide = {
  id: string;
  title: string;
  body: string;
  accent: string;
};

export type KirishQuestionPublic = {
  id: string;
  text: string;
  options: string[];
};

export type KirishStagePublic = {
  stage: number;
  title: string;
  subtitle: string;
  videoUrl: string;
  videoPosterHint: string;
  slides: KirishSlide[];
  questions: KirishQuestionPublic[];
};

export type KirishMeResponse = {
  progress: KirishProgress;
  stages: KirishStagePublic[];
};

export type KirishTestResult = {
  score: number;
  correct: number;
  total: number;
  passed: boolean;
};

export type KirishFinishReport = {
  status: string;
  statusLabel: string;
  averageScore: number;
  stages: Array<{
    stage: number;
    score: number | null;
    attempts: number;
    passedAt: string | null;
  }>;
  completedAt: string;
  message: string;
};

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
  return res.json() as Promise<T>;
}

export function useKirishMe() {
  return useQuery({
    queryKey: ["kirish", "me"],
    queryFn: () => apiFetch<KirishMeResponse>("/kirish/me"),
  });
}

export function useCompleteKirishVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stage: number) =>
      apiFetch<{ progress: KirishProgress }>(
        `/kirish/me/stage/${stage}/complete-video`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kirish", "me"] }),
  });
}

export function useCompleteKirishSlides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stage: number) =>
      apiFetch<{ progress: KirishProgress }>(
        `/kirish/me/stage/${stage}/complete-slides`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kirish", "me"] }),
  });
}

export function useSubmitKirishTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      stage,
      answers,
    }: {
      stage: number;
      answers: Record<string, number>;
    }) =>
      apiFetch<{ result: KirishTestResult; progress: KirishProgress }>(
        `/kirish/me/stage/${stage}/submit-test`,
        { method: "POST", body: JSON.stringify({ answers }) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kirish", "me"] }),
  });
}

export function useFinishKirish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ progress: KirishProgress; report: KirishFinishReport }>(
        "/kirish/me/finish",
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kirish", "me"] }),
  });
}
