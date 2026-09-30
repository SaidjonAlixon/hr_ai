import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type PreboardingQuestion = { id: string; text: string; options: string[]; correctIndex?: number };

export type PreboardingLearnerStage = {
  id: number;
  position: number;
  title: string;
  subtitle: string;
  youtubeId: string | null;
  videoDriveFileId: string | null;
  driveFileId: string | null;
  questions: PreboardingQuestion[];
  open: boolean;
  state: {
    videoDone: boolean;
    slidesDone: boolean;
    score: number | null;
    attempts: number;
    passed: boolean;
  };
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json", ...(init?.headers || {}) },
    ...init,
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

export function usePreboardingMe() {
  return useQuery({
    queryKey: ["preboarding-kurs", "me"],
    queryFn: () =>
      json<{ track: string; passScore: number; status: string; stages: PreboardingLearnerStage[] }>(
        "/api/preboarding-kurs/me",
      ),
  });
}

export function usePreboardingVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => json(`/api/preboarding-kurs/stages/${id}/video`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["preboarding-kurs"] }),
  });
}

export function usePreboardingSlides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => json(`/api/preboarding-kurs/stages/${id}/slides`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["preboarding-kurs"] }),
  });
}

export function usePreboardingTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: number; answers: Record<string, number> }) =>
      json<{ result: { score: number; correct: number; total: number; passed: boolean } }>(
        `/api/preboarding-kurs/stages/${p.id}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: p.answers }),
        },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["preboarding-kurs"] }),
  });
}

export type PreboardingAdminStage = {
  id: number;
  track: string;
  position: number;
  title: string;
  subtitle: string;
  youtubeUrl: string;
  youtubeId: string;
  videoDriveFileId: string | null;
  pdfUrl: string | null;
  driveFileId: string | null;
  questionsJson: PreboardingQuestion[];
  published: boolean;
};

export function usePreboardingAdmin(track: string) {
  return useQuery({
    queryKey: ["preboarding-kurs", "admin", track],
    queryFn: () =>
      json<{
        stages: PreboardingAdminStage[];
        results: Array<{
          userId: number;
          fullName: string;
          status: string;
          stages: Array<{ id: number; title: string; score: number | null; attempts: number; passed: boolean }>;
        }>;
      }>(`/api/preboarding-kurs/admin?track=${track}`),
  });
}

export function useSavePreboardingStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown> & { id?: number }) => {
      const { id, ...rest } = body;
      return json(id ? `/api/preboarding-kurs/admin/stages/${id}` : "/api/preboarding-kurs/admin/stages", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rest),
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["preboarding-kurs"] }),
  });
}

export function useDeletePreboardingStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => json(`/api/preboarding-kurs/admin/stages/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["preboarding-kurs"] }),
  });
}
