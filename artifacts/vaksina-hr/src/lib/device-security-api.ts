/** Device security admin / employee API helpers */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body as { error?: string; message?: string }).error || (body as { message?: string }).message || "Xato");
    (err as Error & { data?: unknown; code?: string }).data = body;
    (err as Error & { code?: string }).code = (body as { code?: string }).code;
    throw err;
  }
  return body as T;
}

export type DeviceRow = {
  id: number;
  userId: number;
  deviceId: string;
  deviceName: string | null;
  deviceType: string;
  slot: string;
  os: string | null;
  browser: string | null;
  ipAddress: string | null;
  lastIp: string | null;
  approxLocation: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastLoginAt: string | null;
  isPrimary: boolean;
  isVerified: boolean;
  isBlocked: boolean;
  fullName: string;
  phone: string | null;
  login: string;
  role: string;
  departmentName: string | null;
  enforced: boolean;
  status: string;
  sessionActive: boolean;
  staffGroup: string;
};

export type DeviceSettings = {
  enforcementMode: string;
  officeMaxDevices: number;
  pharmacyMaxDevices: number;
  officeRequireApprove: boolean;
  pharmacyRequireApprove: boolean;
  officeBlockForeign: boolean;
  pharmacyBlockForeign: boolean;
  officeVerifyQr: boolean;
  pharmacyVerifyQr: boolean;
  officeVerifyFace: boolean;
  pharmacyVerifyFace: boolean;
  logIpChanges: boolean;
  suspiciousNotify: boolean;
};

export function fetchDeviceSummary() {
  return api<{
    total: number;
    active: number;
    pending: number;
    blocked: number;
    suspicious: number;
    settings: DeviceSettings;
  }>("/admin/devices/summary");
}

export function fetchDevices(params?: { q?: string; status?: string }) {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.status && params.status !== "all") sp.set("status", params.status);
  const q = sp.toString();
  return api<{ devices: DeviceRow[] }>(`/admin/devices${q ? `?${q}` : ""}`);
}

export function fetchDeviceDetail(id: number) {
  return api<{
    device: DeviceRow & Record<string, unknown>;
    user: Record<string, unknown>;
    sessions: Array<Record<string, unknown>>;
  }>(`/admin/devices/item/${id}`);
}

export function approveDevice(id: number) {
  return api(`/admin/devices/item/${id}/approve`, { method: "POST", body: "{}" });
}
export function rejectDevice(id: number) {
  return api(`/admin/devices/item/${id}/reject`, { method: "POST", body: "{}" });
}
export function blockDevice(id: number) {
  return api(`/admin/devices/item/${id}/block`, { method: "POST", body: "{}" });
}
export function unblockDevice(id: number) {
  return api(`/admin/devices/item/${id}/unblock`, { method: "POST", body: "{}" });
}
export function setPrimaryDevice(id: number) {
  return api(`/admin/devices/item/${id}/set-primary`, { method: "POST", body: "{}" });
}
export function revokeDeviceSessions(id: number) {
  return api(`/admin/devices/item/${id}/revoke-sessions`, { method: "POST", body: "{}" });
}
export function revokeAllUserSessions(userId: number) {
  return api(`/admin/devices/user/${userId}/revoke-all-sessions`, { method: "POST", body: "{}" });
}
export function setUserEnforce(userId: number, enforced: boolean) {
  return api(`/admin/devices/user/${userId}/enforce`, {
    method: "POST",
    body: JSON.stringify({ enforced }),
  });
}
export function fetchDeviceSettings() {
  return api<DeviceSettings>("/admin/devices/settings");
}
export function saveDeviceSettings(data: Partial<DeviceSettings>) {
  return api<DeviceSettings>("/admin/devices/settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
export function fetchLoginHistory() {
  return api<{ logs: Array<Record<string, unknown>> }>("/admin/devices/login-history");
}
export function fetchSecurityEvents() {
  return api<{ events: Array<Record<string, unknown>> }>("/admin/devices/events");
}
export function fetchEnforceUsers() {
  return api<{
    users: Array<{
      id: number;
      fullName: string;
      login: string;
      role: string;
      phone: string | null;
      enforced: boolean;
      departmentName: string | null;
      staffGroup: string;
    }>;
  }>("/admin/devices/users");
}
export function requestDeviceChange(reason?: string) {
  return api("/devices/me/request-change", {
    method: "POST",
    body: JSON.stringify({ reason: reason || "" }),
  });
}

export async function loginWithDevice(login: string, password: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      login,
      password,
      device: {
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body as { error?: string; message?: string }).error || (body as { message?: string }).message || "Login xato");
    (err as Error & { data?: unknown; code?: string; status?: number }).data = body;
    (err as Error & { code?: string }).code = (body as { code?: string }).code;
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return body as { user: import("@workspace/api-client-react").User; deviceSecurity?: Record<string, unknown> };
}
