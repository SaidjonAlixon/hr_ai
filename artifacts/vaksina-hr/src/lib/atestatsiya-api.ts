import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DARSLIK_TRACKS, type DarslikTrack } from "./darsliklar-api";

export type AttestTrack = DarslikTrack;
export const ATTESTATSIYA_TRACKS = DARSLIK_TRACKS;

export type AttestWindow = "upcoming" | "open" | "closed";
export type AttestAttemptStatus = "in_progress" | "submitted" | "expired" | "annulled" | "not_started";

export type AttestQuestion = { id: string; text: string; options: string[]; correctIndex: number };
export type AttestQuestionPublic = { id: string; text: string; options: string[] };

export type AttestLearnerAttempt = {
  id: number;
  attemptNo: number;
  status: Exclude<AttestAttemptStatus, "not_started">;
  startedAt: string;
  deadlineAt: string;
  submittedAt: string | null;
  answeredCount: number;
  total: number;
  score: number | null;
  correct: number | null;
  passed: boolean | null;
  resultHidden: boolean;
  locationLabel: string | null;
  retakeAllowed: boolean;
  annulReason: string | null;
  questions?: AttestQuestionPublic[];
  answers?: Record<string, number>;
};

export type AttestExamCard = {
  id: number;
  title: string;
  description: string;
  durationMinutes: number;
  passScore: number;
  questionCount: number;
  locationMode: "branch" | "office";
  locationTarget: string;
  startsAt: string;
  endsAt: string;
  window: AttestWindow;
  published: boolean;
  attempt: AttestLearnerAttempt | null;
  attemptsCount: number;
  canStart: boolean;
  canResume: boolean;
  reason: string | null;
};

export type AttestMe = {
  track: AttestTrack;
  trackLabel: string;
  preview: boolean;
  serverNow: string;
  branch: { label: string | null; hasGps: boolean } | null;
  exams: AttestExamCard[];
};

export type AttestExamInput = {
  track: AttestTrack;
  title: string;
  description: string;
  questions: AttestQuestion[];
  passScore: number;
  durationMinutes: number;
  locationMode: "branch" | "office";
  startsAt: string;
  endsAt: string;
  shuffleQuestions: boolean;
  showResult: boolean;
  published: boolean;
};

export type AttestManageExam = Omit<AttestExamInput, "track" | "questions"> & {
  id: number;
  track: AttestTrack;
  questions: AttestQuestion[];
  window: AttestWindow;
  updatedAt: string;
  stats: { started: number; inProgress: number; finished: number; passed: number; annulled: number; hasAttempts: boolean };
};

export type AttestManage = {
  track: AttestTrack;
  trackLabel: string;
  targets: number;
  tracks: Array<{ key: AttestTrack; label: string; total: number; open: number }>;
  exams: AttestManageExam[];
};

export type AttestMonitorRow = {
  userId: number;
  fullName: string;
  phone: string | null;
  branchLabel: string | null;
  inTrack: boolean;
  status: AttestAttemptStatus;
  attemptId: number | null;
  attemptNo: number;
  attemptsCount: number;
  startedAt: string | null;
  deadlineAt: string | null;
  submittedAt: string | null;
  remainingSec: number | null;
  durationSec: number | null;
  answeredCount: number;
  total: number;
  score: number | null;
  correct: number | null;
  passed: boolean | null;
  locationLabel: string | null;
  distanceM: number | null;
  accuracyM: number | null;
  focusLost: number;
  retakeAllowed: boolean;
  annulReason: string | null;
  history: Array<{ attemptNo: number; status: string; score: number | null; passed: boolean | null; startedAt: string; submittedAt: string | null }>;
};

export type AttestMonitor = {
  exam: Omit<AttestManageExam, "stats">;
  trackLabel: string;
  serverNow: string;
  stats: {
    targets: number;
    notStarted: number;
    inProgress: number;
    finished: number;
    expired: number;
    passed: number;
    failed: number;
    annulled: number;
    passRate: number | null;
    avgScore: number | null;
    maxScore: number | null;
    minScore: number | null;
    avgDurationMin: number | null;
    focusLostPeople: number;
    buckets: Array<{ label: string; count: number }>;
  };
  questionStats: Array<{ number: number; id: string; text: string; answered: number; correct: number; percent: number | null }>;
  branches: Array<{ label: string; total: number; finished: number; passed: number; avgScore: number | null }>;
  rows: AttestMonitorRow[];
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
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      if (body?.code) code = body.code;
    } catch {
      /* ignore */
    }
    const err = new Error(message || `Xato ${res.status}`) as Error & { code?: string };
    err.code = code;
    throw err;
  }
  return res.json() as Promise<T>;
}

const ME_KEY = ["atestatsiya", "me"] as const;
const MANAGE_KEY = ["atestatsiya", "manage"] as const;

export function useAttestMe(track?: AttestTrack | null) {
  return useQuery({
    queryKey: [...ME_KEY, track ?? "own"],
    queryFn: () => apiFetch<AttestMe>(`/atestatsiya/me${track ? `?track=${track}` : ""}`),
    refetchInterval: 30_000,
  });
}

export function readGps(): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Bu qurilmada GPS yo‘q"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: Math.round(p.coords.accuracy),
        }),
      (err) => {
        if (err.code === 1) reject(new Error("Joylashuvga ruxsat berilmadi. Brauzer sozlamasidan GPS’ni yoqing."));
        else if (err.code === 3) reject(new Error("GPS vaqti tugadi. Ochiq joyda qayta urinib ko‘ring."));
        else reject(new Error("Joylashuv aniqlanmadi. GPS yoqilganini tekshiring."));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}

export function startAttestPreview(examId: number) {
  return apiFetch<{ attempt: AttestLearnerAttempt; serverNow: string; practice: boolean }>(
    `/atestatsiya/preview/exams/${examId}/start`,
    { method: "POST", body: "{}" },
  );
}

export function scoreAttestPreview(examId: number, answers: Record<string, number>) {
  return apiFetch<{ attempt: AttestLearnerAttempt; serverNow: string }>(
    `/atestatsiya/preview/exams/${examId}/score`,
    { method: "POST", body: JSON.stringify({ answers }) },
  );
}

export function useStartAttest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { examId: number; latitude: number; longitude: number; accuracy: number }) =>
      apiFetch<{ attempt: AttestLearnerAttempt; serverNow: string; resumed: boolean }>(
        `/atestatsiya/me/exams/${p.examId}/start`,
        { method: "POST", body: JSON.stringify(p) },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export function saveAttestProgress(attemptId: number, answers: Record<string, number>, focusLost: number) {
  return apiFetch<{ ok: boolean; answeredCount: number; serverNow: string }>(
    `/atestatsiya/me/attempts/${attemptId}/progress`,
    { method: "POST", body: JSON.stringify({ answers, focusLost }) },
  );
}

export function submitAttest(attemptId: number, answers: Record<string, number>, focusLost: number) {
  return apiFetch<{ attempt: AttestLearnerAttempt; serverNow: string }>(
    `/atestatsiya/me/attempts/${attemptId}/submit`,
    { method: "POST", body: JSON.stringify({ answers, focusLost }) },
  );
}

export type AttestResultRow = {
  examId: number;
  examTitle: string;
  passScore: number;
  locationMode: "branch" | "office";
  durationMinutes: number;
  windowStart: string;
  windowEnd: string;
  userId: number;
  fullName: string;
  phone: string | null;
  branchLabel: string | null;
  status: AttestAttemptStatus;
  score: number | null;
  correct: number | null;
  total: number;
  passed: boolean | null;
  attemptNo: number;
  attemptsCount: number;
  startedAt: string | null;
  submittedAt: string | null;
  durationSec: number | null;
  locationLabel: string | null;
  distanceM: number | null;
  accuracyM: number | null;
  focusLost: number;
  retakeAllowed: boolean;
  annulReason: string | null;
};

export type AttestResults = {
  track: AttestTrack;
  trackLabel: string;
  exams: Array<{ id: number; title: string }>;
  stats: {
    people: number;
    exams: number;
    rows: number;
    notStarted: number;
    inProgress: number;
    finished: number;
    passed: number;
    failed: number;
    annulled: number;
    passRate: number | null;
    avgScore: number | null;
  };
  rows: AttestResultRow[];
};

export function useAttestResults(track: AttestTrack, enabled: boolean) {
  return useQuery({
    queryKey: [...MANAGE_KEY, "results", track],
    queryFn: () => apiFetch<AttestResults>(`/atestatsiya/manage/results?track=${track}`),
    enabled,
    refetchInterval: 20_000,
  });
}

export function useAttestManage(track: AttestTrack, enabled: boolean) {
  return useQuery({
    queryKey: [...MANAGE_KEY, track],
    queryFn: () => apiFetch<AttestManage>(`/atestatsiya/manage?track=${track}`),
    enabled,
  });
}

export function useAttestMonitor(examId: number | null) {
  return useQuery({
    queryKey: [...MANAGE_KEY, "monitor", examId],
    queryFn: () => apiFetch<AttestMonitor>(`/atestatsiya/manage/${examId}/monitor`),
    enabled: examId != null,
    refetchInterval: 10_000,
  });
}

function useManageMut<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: MANAGE_KEY }),
  });
}

export function useSaveAttestExam() {
  return useManageMut(({ id, ...input }: AttestExamInput & { id?: number | null }) =>
    apiFetch<{ exam: AttestManageExam }>(id ? `/atestatsiya/manage/${id}` : "/atestatsiya/manage", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(input),
    }),
  );
}

export function usePublishAttest() {
  return useManageMut(({ id, published }: { id: number; published: boolean }) =>
    apiFetch(`/atestatsiya/manage/${id}/publish`, { method: "PATCH", body: JSON.stringify({ published }) }),
  );
}

export function useDeleteAttest() {
  return useManageMut((id: number) => apiFetch(`/atestatsiya/manage/${id}`, { method: "DELETE" }));
}

export function useAnnulAttempt() {
  return useManageMut(({ id, reason }: { id: number; reason: string }) =>
    apiFetch(`/atestatsiya/manage/attempts/${id}/annul`, { method: "POST", body: JSON.stringify({ reason }) }),
  );
}

export function useRestoreAttempt() {
  return useManageMut((id: number) => apiFetch(`/atestatsiya/manage/attempts/${id}/restore`, { method: "POST" }));
}

export function useFinishAttempt() {
  return useManageMut((id: number) => apiFetch(`/atestatsiya/manage/attempts/${id}/finish`, { method: "POST" }));
}

export function useGrantRetake() {
  return useManageMut(({ examId, userId }: { examId: number; userId: number }) =>
    apiFetch(`/atestatsiya/manage/${examId}/users/${userId}/retake`, { method: "POST" }),
  );
}

const TZ = "Asia/Tashkent";

export function formatAttestDt(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(",", "");
}

/** datetime-local qiymati (brauzer vaqti) → ISO */
export function localInputToIso(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const ATTEST_STATUS_LABEL: Record<AttestAttemptStatus, string> = {
  not_started: "Boshlamagan",
  in_progress: "Ishlayapti",
  submitted: "Topshirdi",
  expired: "Vaqti tugadi",
  annulled: "Bekor qilingan",
};
