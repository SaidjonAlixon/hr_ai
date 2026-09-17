/** Ko‘chma davomat (MOBILE_GPS) API client */

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
    const err = new Error(
      (body as { error?: string }).error || (body as { message?: string }).message || "Xato",
    );
    (err as Error & { code?: string; data?: unknown }).code = (body as { code?: string }).code;
    (err as Error & { data?: unknown }).data = body;
    throw err;
  }
  return body as T;
}

export type MobileSettings = {
  enabled: boolean;
  requireGps: boolean;
  requireActiveShift: boolean;
  routeTrackingDefault: boolean;
  gpsIntervalMin: number;
  maxAccuracyMeters: number;
  allowStartAnywhere: boolean;
  allowEndAnywhere: boolean;
  detectSuspicious: boolean;
  createSecurityEvents: boolean;
  retentionDays: number;
};

export type MobilePermissionRow = {
  id: number;
  employeeId: number;
  fullName?: string | null;
  position?: string | null;
  location?: string | null;
  status: string;
  permissionType: string;
  startDate?: string | null;
  endDate?: string | null;
  weekdays?: number[] | null;
  shiftKey?: string | null;
  note?: string | null;
  routeTrackingEnabled: boolean;
  coversToday?: boolean;
  todaySession?: {
    id: number;
    status: string;
    securityStatus: string;
    startTime: string | null;
    endTime: string | null;
    startLatitude: number;
    startLongitude: number;
    endLatitude?: number | null;
    endLongitude?: number | null;
  } | null;
};

export type MobileSessionDetail = {
  session: {
    id: number;
    employeeId: number;
    workDate: string;
    status: string;
    securityStatus: string;
    startTime: string | null;
    endTime: string | null;
    startLatitude: number;
    startLongitude: number;
    startAccuracy?: number | null;
    endLatitude?: number | null;
    endLongitude?: number | null;
    endAccuracy?: number | null;
    routeTrackingEnabled: boolean;
    fullName?: string | null;
    position?: string | null;
    location?: string | null;
  };
  points: Array<{
    id: number;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    recordedAt: string | null;
    sequenceNumber: number;
    pointType: string;
  }>;
};

export async function fetchMobileDashboard() {
  return api<{
    totalPermissions: number;
    activeOpenToday: number;
    startedToday: number;
    closedToday: number;
    workingNow: number;
    suspiciousToday: number;
    securityEventsToday: number;
    today: string;
    settingsEnabled: boolean;
  }>("/mobile-attendance/dashboard");
}

export async function fetchMobileSettings() {
  return api<{ settings: MobileSettings }>("/mobile-attendance/settings");
}

export async function saveMobileSettings(patch: Partial<MobileSettings>) {
  return api<{ ok: boolean; settings: MobileSettings }>("/mobile-attendance/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function fetchMobilePermissions(status = "active") {
  return api<{ today: string; permissions: MobilePermissionRow[] }>(
    `/mobile-attendance/permissions?status=${encodeURIComponent(status)}`,
  );
}

export async function grantMobilePermission(body: {
  employeeId?: number;
  employeeIds?: number[];
  permissionType: string;
  startDate?: string | null;
  endDate?: string | null;
  weekdays?: number[] | null;
  shiftKey?: string | null;
  note?: string | null;
  routeTrackingEnabled?: boolean;
  maxAccuracyMeters?: number;
  gpsIntervalMin?: number;
}) {
  return api<{ ok: boolean; count: number }>("/mobile-attendance/permissions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function revokeMobilePermission(id: number) {
  return api<{ ok: boolean }>(`/mobile-attendance/permissions/${id}/revoke`, { method: "POST" });
}

export async function patchMobilePermission(id: number, body: Record<string, unknown>) {
  return api<{ ok: boolean }>(`/mobile-attendance/permissions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function fetchMobileSessions(params: {
  from: string;
  to: string;
  employeeId?: number;
  status?: string;
}) {
  const qs = new URLSearchParams({ from: params.from, to: params.to });
  if (params.employeeId) qs.set("employeeId", String(params.employeeId));
  if (params.status) qs.set("status", params.status);
  return api<{ sessions: Array<Record<string, unknown>> }>(`/mobile-attendance/sessions?${qs}`);
}

export async function fetchMobileLive(employeeId?: number) {
  const qs = employeeId ? `?employeeId=${employeeId}` : "";
  return api<{
    today: string;
    count: number;
    onlineCount: number;
    polledAt: string;
    live: Array<{
      sessionId: number | null;
      employeeId: number;
      userId: number | null;
      fullName: string | null;
      position: string | null;
      location: string | null;
      status: string;
      presence: "online" | "offline";
      securityStatus: string;
      routeTrackingEnabled: boolean;
      startTime: string | null;
      startLatitude: number | null;
      startLongitude: number | null;
      liveLatitude: number | null;
      liveLongitude: number | null;
      liveAccuracy: number | null;
      liveAt: string | null;
      pointCount: number;
      durationMin: number;
    }>;
  }>(`/mobile-attendance/live${qs}`);
}

export async function fetchMobileSessionDetail(id: number) {
  return api<MobileSessionDetail>(`/mobile-attendance/sessions/${id}`);
}

export async function fetchMobileEmployees(q?: string, group?: "pharmacy" | "office" | "") {
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (group) qs.set("group", group);
  const suffix = qs.toString() ? `?${qs}` : "";
  return api<{
    group: string | null;
    count: number;
    employees: Array<{
      id: number;
      fullName: string;
      position: string | null;
      location: string | null;
      userId: number | null;
      userRole?: string | null;
      group?: string;
    }>;
  }>(`/mobile-attendance/employees${suffix}`);
}

export async function fetchMyMobileAttendance() {
  return api<{
    allowed: boolean;
    reason?: string;
    employee?: { id: number; fullName: string; position: string | null; location: string | null };
    permission?: {
      id: number;
      permissionType: string;
      routeTrackingEnabled: boolean;
      gpsIntervalMin: number;
      maxAccuracyMeters: number;
      note?: string | null;
    };
    settings?: {
      enabled: boolean;
      maxAccuracyMeters: number;
      gpsIntervalMin: number;
      routeTracking: boolean;
    };
    openSession?: {
      id: number;
      startTime: string | null;
      startLatitude: number;
      startLongitude: number;
      startAccuracy: number | null;
      routeTrackingEnabled: boolean;
      securityStatus: string;
    } | null;
    privacyNote?: string;
  }>("/mobile-attendance/me");
}

export async function startMobileAttendance(gps: {
  latitude: number;
  longitude: number;
  accuracy?: number;
  locationTimestamp?: number;
}) {
  return api<{
    ok: boolean;
    sessionId: number;
    startTime: string;
    message: string;
    routeTrackingEnabled: boolean;
  }>("/mobile-attendance/start", { method: "POST", body: JSON.stringify(gps) });
}

export async function endMobileAttendance(gps: {
  sessionId?: number;
  latitude: number;
  longitude: number;
  accuracy?: number;
  locationTimestamp?: number;
}) {
  return api<{
    ok: boolean;
    sessionId: number;
    message: string;
    durationMin: number;
    securityStatus: string;
    startLatitude: number;
    startLongitude: number;
    endLatitude: number;
    endLongitude: number;
    startTime: string;
    endTime: string;
  }>("/mobile-attendance/end", { method: "POST", body: JSON.stringify(gps) });
}

export async function trackMobilePoint(body: {
  sessionId: number;
  latitude: number;
  longitude: number;
  accuracy?: number;
}) {
  return api<{ ok: boolean }>("/mobile-attendance/track", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function ensureMobileTrack(gps?: {
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}) {
  return api<{
    ok: boolean;
    allowed: boolean;
    reason?: string;
    sessionId?: number;
    routeTrackingEnabled?: boolean;
    created?: boolean;
  }>("/mobile-attendance/ensure-track", {
    method: "POST",
    body: JSON.stringify(gps || {}),
  });
}

export function getCurrentPosition(timeoutMs = 12_000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GPS qo‘llab-quvvatlanmaydi"));
      return;
    }
    const t = window.setTimeout(() => reject(new Error("GPS timeout")), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(t);
        resolve(pos);
      },
      (err) => {
        window.clearTimeout(t);
        reject(err);
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: Math.min(timeoutMs, 10_000) },
    );
  });
}
