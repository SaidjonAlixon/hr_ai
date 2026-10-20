export type AiProposal = {
  id: number;
  conversation_id: number;
  platform_user_id: number | null;
  kind: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  status: "pending" | "executed" | "rejected" | "failed";
  decided_at: string | null;
  decision_note: string | null;
  execution_result: string | null;
  created_at: string;
  display_name: string | null;
  username: string | null;
  user_full_name: string | null;
  user_role: string | null;
};

export type AiConversation = {
  id: number;
  telegram_user_id: string;
  telegram_chat_id: string;
  chat_type: string;
  display_name: string | null;
  username: string | null;
  platform_user_id: number | null;
  user_full_name: string | null;
  status: string;
  intent: string | null;
  pending_count: string;
  updated_at: string;
};

export type AiMessage = {
  id: number;
  conversation_id: number;
  role: "user" | "assistant" | "admin" | "system";
  text: string;
  created_at: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function fetchAiOverview() {
  return apiFetch<{ aiEnabled: boolean; proposals: AiProposal[]; conversations: AiConversation[] }>(
    "/ai-assistant/overview",
  );
}

export function fetchAiMessages(conversationId: number) {
  return apiFetch<{ messages: AiMessage[] }>(`/ai-assistant/conversations/${conversationId}/messages`);
}

export function approveAiProposal(id: number, note?: string) {
  return apiFetch<{ ok: boolean; result: string }>(`/ai-assistant/proposals/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ note: note || "" }),
  });
}

export function rejectAiProposal(id: number, note?: string) {
  return apiFetch<{ ok: boolean }>(`/ai-assistant/proposals/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ note: note || "" }),
  });
}

export function replyAiConversation(conversationId: number, text: string) {
  return apiFetch<{ ok: boolean }>(`/ai-assistant/conversations/${conversationId}/reply`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export type AiGroup = {
  chatId: string;
  title: string | null;
  enabled: boolean;
  updatedAt: string;
};

export function fetchAiGroups() {
  return apiFetch<{ groups: AiGroup[] }>("/ai-assistant/groups");
}

export function setAiGroupEnabled(chatId: string, enabled: boolean) {
  return apiFetch<{ ok: boolean; chatId: string; enabled: boolean }>(
    `/ai-assistant/groups/${encodeURIComponent(chatId)}`,
    { method: "POST", body: JSON.stringify({ enabled }) },
  );
}

export const AI_KIND_LABEL: Record<string, string> = {
  davomat_fix: "Davomat tuzatish",
  atestatsiya_retake: "Testni qayta ochish",
  account_help: "Akkaunt / kirish",
  admin_task: "Admin vazifasi",
};

export const AI_STATUS_LABEL: Record<string, string> = {
  pending: "Kutilmoqda",
  executed: "Bajarildi",
  rejected: "Rad etildi",
  failed: "Bajarilmadi",
};
