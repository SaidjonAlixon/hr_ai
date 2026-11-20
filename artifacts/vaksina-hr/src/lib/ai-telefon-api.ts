async function getJson<T>(url: string, errMsg: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || errMsg);
  }
  return res.json() as Promise<T>;
}

async function sendJson<T>(url: string, method: string, body?: unknown, errMsg = "Xato"): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body != null ? { "Content-Type": "application/json" } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error || errMsg);
  }
  return res.json() as Promise<T>;
}

export type AiCallVoice = "male" | "female";

export type AiCallJob = {
  id: number;
  targetUserId: number | null;
  targetTelegramId: string;
  targetName: string | null;
  openScript: string;
  conversational: boolean;
  maxTurns: number;
  voice?: AiCallVoice;
  scheduledAt: string;
  recurrence: "once" | "daily";
  dailyTime: string | null;
  enabled: boolean;
  status: string;
  lastError: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AiCallTarget = {
  id: number;
  fullName: string;
  phone: string | null;
  telegramId: string;
  role: string;
};

export type AiCallLog = {
  id: number;
  jobId: number;
  startedAt: string;
  endedAt: string | null;
  outcome: string;
  transcript: Array<{ role: string; text: string }>;
};

export function fetchAiCallStatus() {
  return getJson<{ configured: boolean; enabled: boolean; busy?: boolean }>(
    "/api/admin/ai-calls/status",
    "Status",
  );
}

export function fetchAiCallTargets(q = "") {
  return getJson<{ targets: AiCallTarget[] }>(
    `/api/admin/ai-calls/targets?q=${encodeURIComponent(q)}`,
    "Targets",
  );
}

export function fetchAiCallJobs() {
  return getJson<{ jobs: AiCallJob[] }>("/api/admin/ai-calls/jobs", "Jobs");
}

export function createAiCallJob(body: {
  targetUserId?: number | null;
  targetTelegramId: string;
  targetName?: string | null;
  openScript: string;
  conversational?: boolean;
  maxTurns?: number;
  voice?: AiCallVoice;
  scheduledAt?: string;
  recurrence?: "once" | "daily";
  dailyTime?: string | null;
  enabled?: boolean;
}) {
  return sendJson<{ job: AiCallJob }>("/api/admin/ai-calls/jobs", "POST", body, "Yaratilmadi");
}

export function startLiveTelegramCall(body: {
  targetUserId?: number | null;
  targetTelegramId: string;
  targetName?: string | null;
  openScript: string;
  conversational?: boolean;
  maxTurns?: number;
  voice?: AiCallVoice;
}) {
  return sendJson<{ ok: boolean; jobId: number; message?: string; voice?: AiCallVoice }>(
    "/api/admin/ai-calls/live",
    "POST",
    body,
    "Telegram qo‘ng‘iroq boshlanmadi",
  );
}

export function patchAiCallJob(id: number, body: Record<string, unknown>) {
  return sendJson<{ job: AiCallJob }>(`/api/admin/ai-calls/jobs/${id}`, "PATCH", body, "Yangilanmadi");
}

export function deleteAiCallJob(id: number) {
  return sendJson<{ ok: boolean }>(`/api/admin/ai-calls/jobs/${id}`, "DELETE", undefined, "O‘chirilmadi");
}

export function runAiCallJobNow(id: number) {
  return sendJson<{ ok: boolean; message?: string }>(
    `/api/admin/ai-calls/jobs/${id}/run-now`,
    "POST",
    {},
    "Ishga tushmadi",
  );
}

export function fetchAiCallLogs(jobId?: number) {
  const q = jobId != null ? `?jobId=${jobId}` : "";
  return getJson<{ logs: AiCallLog[] }>(`/api/admin/ai-calls/logs${q}`, "Loglar");
}
