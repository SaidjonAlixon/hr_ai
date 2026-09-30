import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type DarslikTrack = "stajyor" | "farmasevt" | "mudir";

export const DARSLIK_TRACKS: Array<{ key: DarslikTrack; label: string; hint: string }> = [
  { key: "stajyor", label: "Stajyor", hint: "Yangi kelgan stajyorlar uchun" },
  { key: "farmasevt", label: "Farmasevt", hint: "Farmasevtlar malakasini oshirish" },
  { key: "mudir", label: "Mudir", hint: "Filial mudirlari uchun boshqaruv" },
];

export type DarslikLessonState = {
  videoDone: boolean;
  score: number | null;
  attempts: number;
  passed: boolean;
  passedAt: string | null;
};

export type DarslikQuestionPublic = { id: string; text: string; options: string[] };

export type DarslikLessonPublic = {
  id: number;
  number: number;
  title: string;
  description: string;
  videoKind: "youtube" | "drive" | null;
  youtubeId: string | null;
  videoDriveFileId: string | null;
  driveFileId: string | null;
  passScore: number;
  questions: DarslikQuestionPublic[];
  state: DarslikLessonState;
  locked: boolean;
};

export type DarslikSummary = {
  total: number;
  passed: number;
  percent: number;
  averageScore: number | null;
  completed: boolean;
  completedAt: string | null;
};

export type DarslikSectionPublic = {
  id: number;
  title: string;
  description: string;
  coverUrl: string;
  locked: boolean;
  summary: Omit<DarslikSummary, "completedAt">;
  lessons: DarslikLessonPublic[];
};

export type DarslikMeResponse = {
  track: DarslikTrack;
  trackLabel: string;
  preview: boolean;
  sections: DarslikSectionPublic[];
  lessons: DarslikLessonPublic[];
  summary: DarslikSummary;
};

export type DarslikTestResult = {
  score: number;
  correct: number;
  total: number;
  passed: boolean;
  passScore: number;
};

export type DarslikQuestion = {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
};

export type DarslikManageLesson = {
  id: number;
  track: DarslikTrack;
  sectionId: number | null;
  position: number;
  title: string;
  description: string;
  videoUrl: string;
  videoKind: "youtube" | "drive" | null;
  youtubeId: string | null;
  videoDriveFileId: string | null;
  pdfUrl: string;
  driveFileId: string | null;
  questions: DarslikQuestion[];
  passScore: number;
  published: boolean;
  updatedAt: string;
};

export type DarslikSection = {
  id: number;
  track: DarslikTrack;
  position: number;
  title: string;
  description: string;
  coverUrl: string;
  published: boolean;
  lessonCount: number;
  publishedCount: number;
};

export type DarslikManageResponse = {
  track: DarslikTrack;
  trackLabel: string;
  tracks: Array<{ key: DarslikTrack; label: string; total: number; published: number; sections: number }>;
  sections: DarslikSection[];
  lessons: DarslikManageLesson[];
};

export type DarslikLessonInput = {
  track: DarslikTrack;
  sectionId: number;
  title: string;
  description: string;
  videoUrl: string;
  pdfUrl: string;
  questions: DarslikQuestion[];
  passScore: number;
  published: boolean;
};

export type DarslikResults = {
  track: DarslikTrack;
  sections: Array<{ id: number; title: string; coverUrl: string }>;
  lessons: Array<{ id: number; number: number; title: string; sectionId: number | null }>;
  learners: Array<{
    userId: number;
    fullName: string;
    started: boolean;
    total: number;
    passed: number;
    percent: number;
    averageScore: number | null;
    completed: boolean;
    completedAt: string | null;
    lastActivityAt: string | null;
    lessons: Array<{ lessonId: number; passed: boolean; score: number | null; attempts: number }>;
  }>;
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

const ME_KEY = ["darsliklar", "me"] as const;
const MANAGE_KEY = ["darsliklar", "manage"] as const;

export function useDarsliklarMe(track?: DarslikTrack | null) {
  return useQuery({
    queryKey: [...ME_KEY, track ?? "own"],
    queryFn: () =>
      apiFetch<DarslikMeResponse>(`/darsliklar/me${track ? `?track=${track}` : ""}`),
  });
}

export function useCompleteDarslikVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: number) =>
      apiFetch<DarslikMeResponse>(`/darsliklar/me/lessons/${lessonId}/complete-video`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export function useSubmitDarslikTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lessonId, answers }: { lessonId: number; answers: Record<string, number> }) =>
      apiFetch<DarslikMeResponse & { result: DarslikTestResult }>(
        `/darsliklar/me/lessons/${lessonId}/submit-test`,
        { method: "POST", body: JSON.stringify({ answers }) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export function useDarsliklarManage(track: DarslikTrack, enabled: boolean) {
  return useQuery({
    queryKey: [...MANAGE_KEY, track],
    queryFn: () => apiFetch<DarslikManageResponse>(`/darsliklar/manage?track=${track}`),
    enabled,
  });
}

export function useDarsliklarResults(track: DarslikTrack, enabled: boolean) {
  return useQuery({
    queryKey: [...MANAGE_KEY, "results", track],
    queryFn: () => apiFetch<DarslikResults>(`/darsliklar/manage/results?track=${track}`),
    enabled,
  });
}

function useManageMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: MANAGE_KEY });
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}

export function useSaveDarslik() {
  return useManageMutation(({ id, ...input }: DarslikLessonInput & { id?: number | null }) =>
    apiFetch<{ lesson: DarslikManageLesson }>(
      id ? `/darsliklar/manage/${id}` : "/darsliklar/manage",
      { method: id ? "PUT" : "POST", body: JSON.stringify(input) },
    ),
  );
}

export function usePublishDarslik() {
  return useManageMutation(({ id, published }: { id: number; published: boolean }) =>
    apiFetch<{ lesson: DarslikManageLesson }>(`/darsliklar/manage/${id}/publish`, {
      method: "PATCH",
      body: JSON.stringify({ published }),
    }),
  );
}

export function useDeleteDarslik() {
  return useManageMutation((id: number) =>
    apiFetch<{ ok: boolean }>(`/darsliklar/manage/${id}`, { method: "DELETE" }),
  );
}

export function useReorderDarsliklar() {
  return useManageMutation(({ track, sectionId, ids }: { track: DarslikTrack; sectionId: number; ids: number[] }) =>
    apiFetch<{ lessons: DarslikManageLesson[] }>("/darsliklar/manage/reorder", {
      method: "POST",
      body: JSON.stringify({ track, sectionId, ids }),
    }),
  );
}

export function useSaveDarslikSection() {
  return useManageMutation(
    (input: {
      id?: number | null;
      track: DarslikTrack;
      title: string;
      description: string;
      coverUrl: string;
      published: boolean;
    }) =>
      apiFetch(input.id ? `/darsliklar/manage/sections/${input.id}` : "/darsliklar/manage/sections", {
        method: input.id ? "PUT" : "POST",
        body: JSON.stringify(input),
      }),
  );
}

export function useDeleteDarslikSection() {
  return useManageMutation((id: number) =>
    apiFetch<{ ok: boolean }>(`/darsliklar/manage/sections/${id}`, { method: "DELETE" }),
  );
}

export function useReorderDarslikSections() {
  return useManageMutation(({ track, ids }: { track: DarslikTrack; ids: number[] }) =>
    apiFetch<{ ok: boolean }>("/darsliklar/manage/sections/reorder", {
      method: "POST",
      body: JSON.stringify({ track, ids }),
    }),
  );
}

/** Havoladan YouTube ID (oldindan ko‘rish uchun) */
export function previewYoutubeId(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0] || "";
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com") || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live", "v"].includes(parts[0] || "") && /^[\w-]{11}$/.test(parts[1] || "")) {
        return parts[1]!;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Havoladan Google Drive fayl ID */
export function previewDriveFileId(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s) && !s.includes("/")) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "drive.google.com" && host !== "docs.google.com") return null;
    const m = u.pathname.match(/\/(?:file|document|presentation|spreadsheets)\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m?.[1]) return m[1];
    const qid = u.searchParams.get("id");
    if (qid && /^[a-zA-Z0-9_-]{20,}$/.test(qid)) return qid;
  } catch {
    /* ignore */
  }
  return null;
}
