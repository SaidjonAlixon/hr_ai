async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data;
}

export type NotifTestStatus = {
  telegramConfigured: boolean;
  telegramLinked: boolean;
  pushDevices: number;
  pending: number;
};

export type NotifTestPending = {
  id: string;
  userId: number;
  delayMinutes: number;
  sendAt: string;
  createdAt: string;
  text: string | null;
  remainSeconds: number;
};

export function fetchNotifTestStatus() {
  return apiJson<NotifTestStatus>("/admin/notif-test/status");
}

export function fetchNotifTestPending() {
  return apiJson<{ pending: NotifTestPending[] }>("/admin/notif-test/pending");
}

export function sendNotifTestNow(body?: { text?: string; userId?: number }) {
  return apiJson<{
    ok: true;
    telegramConfigured: boolean;
    telegramLinked: boolean;
    message: string;
  }>("/admin/notif-test/now", { method: "POST", body: JSON.stringify(body || {}) });
}

export function scheduleNotifTest(body: {
  delayMinutes: number;
  text?: string;
  userId?: number;
}) {
  return apiJson<{
    ok: true;
    job: { id: string; delayMinutes: number; sendAt: string; remainSeconds: number };
    telegramConfigured: boolean;
    telegramLinked: boolean;
    message: string;
  }>("/admin/notif-test/schedule", { method: "POST", body: JSON.stringify(body) });
}

export function cancelNotifTest(id: string) {
  return apiJson<{ ok: true }>(`/admin/notif-test/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
