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

export type ApiScope = { id: string; label: string; description: string; path: string };

export type ApiTokenRow = {
  id: number;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: number;
  note: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  creatorName?: string | null;
  active: boolean;
};

export type ApiAccessLog = {
  id: number;
  tokenId: number;
  method: string;
  path: string;
  status: number;
  ip: string | null;
  userAgent: string | null;
  deviceLabel: string | null;
  querySummary: string | null;
  durationMs: number | null;
  createdAt: string;
  tokenName?: string | null;
  tokenPrefix?: string | null;
};

export function fetchApiScopes() {
  return getJson<{ scopes: ApiScope[] }>("/api/admin/api-tokens/scopes", "Scope olishda xato");
}

export function fetchApiTokens() {
  return getJson<{ tokens: ApiTokenRow[] }>("/api/admin/api-tokens", "Tokenlar olishda xato");
}

export function createApiToken(body: {
  name: string;
  scopes: string[];
  expiresAt?: string | null;
  expiresInDays?: number | null;
  note?: string | null;
}) {
  return sendJson<{ token: string; warning: string; meta: ApiTokenRow }>(
    "/api/admin/api-tokens",
    "POST",
    body,
    "Token yaratishda xato",
  );
}

export function revokeApiToken(id: number) {
  return sendJson<{ ok: boolean }>(`/api/admin/api-tokens/${id}/revoke`, "POST", undefined, "Bekor qilishda xato");
}

export function patchApiToken(
  id: number,
  body: { name?: string; scopes?: string[]; expiresAt?: string | null; note?: string | null },
) {
  return sendJson<{ token: ApiTokenRow }>(`/api/admin/api-tokens/${id}`, "PATCH", body, "Yangilashda xato");
}

export function fetchApiTokenLogs(params?: {
  tokenId?: number;
  path?: string;
  limit?: number;
  from?: string;
  to?: string;
}) {
  const q = new URLSearchParams();
  if (params?.tokenId) q.set("tokenId", String(params.tokenId));
  if (params?.path) q.set("path", params.path);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  const qs = q.toString();
  return getJson<{ logs: ApiAccessLog[] }>(
    `/api/admin/api-tokens/logs${qs ? `?${qs}` : ""}`,
    "Loglarni olishda xato",
  );
}
