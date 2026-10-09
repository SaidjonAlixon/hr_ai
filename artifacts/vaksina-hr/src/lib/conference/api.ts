export type SpeakMode = "all" | "selected";
export type CameraMode = "all" | "speakers";
export type ScreenMode = "all" | "speakers" | "hosts";

export type ConfSettings = {
  speakMode: SpeakMode;
  cameraMode: CameraMode;
  screenMode: ScreenMode;
  chat: boolean;
  muteOnJoin: boolean;
  camOffOnJoin: boolean;
};

export const DEFAULT_SETTINGS: ConfSettings = {
  speakMode: "all",
  cameraMode: "all",
  screenMode: "speakers",
  chat: true,
  muteOnJoin: true,
  camOffOnJoin: false,
};

export type ConfStatus = "scheduled" | "live" | "ended" | "cancelled";
export type MemberRole = "host" | "cohost" | "participant";
export type Spotlight = { userId: number; source: "auto" | "camera" | "screen" };

export type ConferenceListItem = {
  code: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  durationMin: number;
  status: ConfStatus;
  host: { id: number; fullName: string };
  invitedCount: number;
  liveCount: number;
  myRole: MemberRole | null;
  invited: boolean;
  link: string;
};

export type ConferenceList = { canCreate: boolean; serverReady: boolean; items: ConferenceListItem[] };

export type ConferenceMember = {
  userId: number;
  fullName: string;
  position: string | null;
  role: MemberRole;
  canSpeak: boolean | null;
  invited: boolean;
  banned: boolean;
  joinedAt: string | null;
};

export type ConferenceDetails = {
  conference: {
    code: string;
    title: string;
    description: string | null;
    scheduledAt: string;
    durationMin: number;
    status: ConfStatus;
    settings: ConfSettings;
    spotlight: Spotlight | null;
    host: { id: number; fullName: string };
    startedAt: string | null;
    endedAt: string | null;
    link: string;
    liveCount: number;
  };
  me: {
    userId: number;
    fullName: string;
    role: MemberRole | "guest";
    moderator: boolean;
    owner: boolean;
    canSpeak: boolean;
    invited: boolean;
    banned: boolean;
  };
  joinable: boolean;
  reason: null | "ended" | "cancelled" | "early" | "banned";
  serverReady: boolean;
  serverTime: string;
  members?: ConferenceMember[];
};

export type JoinTicket = { url: string; token: string; identity: string; settings: ConfSettings };

export type ChatMessage = { id: number; userId: number; name: string; text: string; at: string };

export type Person = { id: number; fullName: string; role: string; position: string | null; department: string | null };
export type Department = { id: number; name: string; people: number };

export type Invitee = { userId: number; role: "cohost" | "participant"; canSpeak: boolean | null };

export type ConferenceInput = {
  title: string;
  description?: string | null;
  scheduledAt: string;
  durationMin: number;
  settings: ConfSettings;
  invitees: Invitee[];
  notify?: boolean;
};

export type ModAction =
  | "mute"
  | "unmute"
  | "camera-off"
  | "screen-off"
  | "allow-speak"
  | "revoke-speak"
  | "lower-hand"
  | "kick"
  | "unban"
  | "make-cohost"
  | "remove-cohost"
  | "mute-all";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public reason?: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "include",
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError("Internet aloqasi yo‘q — qayta urinib ko‘ring", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
  if (!res.ok) throw new ApiError(data.error || "Xatolik yuz berdi", res.status, data.reason);
  return data as T;
}

const base = (code: string) => `/api/conferences/${encodeURIComponent(code)}`;

export const conferenceApi = {
  list: () => request<ConferenceList>("/api/conferences"),
  details: (code: string) => request<ConferenceDetails>(base(code)),
  create: (input: ConferenceInput) =>
    request<{ ok: true; code: string; link: string; invited: number }>("/api/conferences", { method: "POST", json: input }),
  update: (code: string, input: Partial<ConferenceInput>) =>
    request<{ ok: true; invited: number }>(base(code), { method: "PATCH", json: input }),
  cancel: (code: string) => request<{ ok: true }>(base(code), { method: "DELETE", json: {} }),
  join: (code: string) => request<JoinTicket>(`${base(code)}/join`, { method: "POST", json: {} }),
  end: (code: string) => request<{ ok: true }>(`${base(code)}/end`, { method: "POST", json: {} }),
  moderate: (code: string, action: ModAction, userId?: number) =>
    request<{ ok: true; count?: number }>(`${base(code)}/moderate`, { method: "POST", json: { action, userId } }),
  settings: (code: string, settings: Partial<ConfSettings>) =>
    request<{ ok: true; settings: ConfSettings }>(`${base(code)}/settings`, { method: "PUT", json: { settings } }),
  spotlight: (code: string, userId: number | null, source: Spotlight["source"] = "auto") =>
    request<{ ok: true }>(`${base(code)}/spotlight`, { method: "PUT", json: { userId, source } }),
  hand: (code: string, raised: boolean) => request<{ ok: true }>(`${base(code)}/hand`, { method: "POST", json: { raised } }),
  messages: (code: string) => request<{ items: ChatMessage[] }>(`${base(code)}/messages`),
  send: (code: string, text: string) =>
    request<{ message: ChatMessage }>(`${base(code)}/messages`, { method: "POST", json: { text } }),
  people: (params: { q?: string; departmentId?: number; code?: string }) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.departmentId) sp.set("departmentId", String(params.departmentId));
    if (params.code) sp.set("code", params.code);
    return request<{ items: Person[] }>(`/api/conferences/people?${sp}`);
  },
  departments: () => request<{ items: Department[] }>("/api/conferences/departments"),
};

export function conferencePath(code: string) {
  return `/konferensiya/${code}`;
}

export function conferenceLink(code: string) {
  return `${window.location.origin}${conferencePath(code)}`;
}

export function formatWhen(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const time = d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Bugun, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Ertaga, ${time}`;
  return `${d.toLocaleDateString("uz-UZ", { day: "numeric", month: "long" })}, ${time}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** Kirish havolasi orqali kelgan, lekin tizimga kirmagan foydalanuvchini login'dan keyin qaytarish */
export const AFTER_LOGIN_KEY = "vaksina.afterLogin";

export function rememberAfterLogin(path: string) {
  try {
    sessionStorage.setItem(AFTER_LOGIN_KEY, path);
  } catch {
    /* private rejim */
  }
}

export function takeAfterLogin(): string | null {
  try {
    const v = sessionStorage.getItem(AFTER_LOGIN_KEY);
    sessionStorage.removeItem(AFTER_LOGIN_KEY);
    return v && /^\/konferensiya\/[a-z-]+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
