/** Davomat API client */

import { compressFaceSnapshotAsync } from "./face-id";

/** «Keldim» imzolanmagan tushuntirish xati sababli rad etilganda — `detail: { letterId }` */
export const EXPLANATION_REQUIRED_EVENT = "vaksina-explanation-required";

export type DavomatDayMetrics = {
  date: string;
  status: string;
  checkIn: string;
  checkOut: string;
  workedMinutes: number;
  workedHours: string;
  earlyArrivalMin: number;
  lateArrivalMin: number;
  earlyLeaveMin: number;
  overtimeMin: number;
  earlyArrivalLabel: string;
  lateArrivalLabel: string;
  earlyLeaveLabel: string;
  overtimeLabel: string;
  source?: string | null;
  notes?: string | null;
  recordId?: number | null;
  /** Ofis dam kunida ixtiyoriy kelgan */
  restDayWork?: boolean;
  /** Kelgan, lekin ketish hali yozilmagan */
  missingCheckout?: boolean;
  /** Shu kundagi reja vaqti (xodimga xos bo‘lishi mumkin) */
  planStart?: string;
  planEnd?: string;
  planShift?: string | null;
  planCustom?: boolean;
  /** Sababli kun — jarima tushmaydi */
  excused?: boolean;
  excuseNote?: string | null;
  excusedById?: number | null;
  excusedByName?: string | null;
  excusedAt?: string | null;
};

export type DavomatEmployee = {
  id: number;
  fullName: string;
  position: string;
  departmentId: number;
  departmentName: string | null;
  location: string | null;
  orgRole: string | null;
  userRole?: string | null;
  userId?: number | null;
  shiftType?: string | null;
  shiftLabel?: string | null;
  /** Omborxona xodimi (ofis/apteka guruhlariga kirmaydi) */
  warehouse?: boolean;
  /** Xavfsizlik 24 soatlik smena (09:00 → ertasi 09:00) */
  security?: boolean;
  /** Omborxona smenasi `HH:MM-HH:MM`; biriktirilmagan bo‘lsa null */
  warehouseShiftKey?: string | null;
  reportsToId?: number | null;
  coordinatorId?: number | null;
  coordinatorName?: string | null;
  workStart?: string;
  workEnd?: string;
  days: DavomatDayMetrics[];
  totals: {
    present: number;
    absent: number;
    late: number;
    incomplete: number;
    leave: number;
    workedMinutes: number;
    workedHours: string;
    lateArrivalMin: number;
    earlyArrivalMin: number;
    earlyLeaveMin: number;
    overtimeMin: number;
    lateArrivalLabel: string;
    earlyArrivalLabel: string;
    earlyLeaveLabel: string;
    overtimeLabel: string;
  };
};

export type DavomatReport = {
  workStart: string;
  workEnd: string;
  from: string;
  to: string;
  dates: string[];
  summary: {
    employees: number;
    days: number;
    presentPersonDays: number;
    absentPersonDays: number;
    latePersonDays: number;
    totalWorkedHours: string;
    totalLateMinutes: number;
    totalLateLabel: string;
  };
  days: Array<{
    date: string;
    present: number;
    late: number;
    incomplete: number;
    leave: number;
    absent: number;
    presentList: string[];
    absentList: string[];
    lateList: string[];
    farFromOffice?: Array<{
      employeeId: number;
      fullName: string;
      position: string | null;
      departmentName: string | null;
      checkIn: string | null;
      officeDistanceMeters: number;
    }>;
  }>;
  employees: DavomatEmployee[];
};

export class DavomatApiError extends Error {
  code?: string;
  distanceMeters?: number;
  remainMeters?: number;
  allowedMeters?: number;
  fullName?: string;
  checkIn?: string;
  checkOut?: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  workplace?: {
    location?: string;
    latitude?: number;
    longitude?: number;
    kind?: "branch" | "office";
  };
  constructor(body: {
    error?: string;
    code?: string;
    distanceMeters?: number;
    remainMeters?: number;
    allowedMeters?: number;
    fullName?: string;
    checkIn?: string;
    checkOut?: string;
    checkInAt?: string | null;
    checkOutAt?: string | null;
    workplace?: {
      location?: string;
      latitude?: number;
      longitude?: number;
      kind?: "branch" | "office";
    };
  }) {
    super(body.error || "Davomat xatosi");
    this.code = body.code;
    this.distanceMeters = body.distanceMeters;
    this.remainMeters = body.remainMeters;
    this.allowedMeters = body.allowedMeters;
    this.fullName = body.fullName;
    this.checkIn = body.checkIn;
    this.checkOut = body.checkOut;
    this.checkInAt = body.checkInAt;
    this.checkOutAt = body.checkOutAt;
    this.workplace = body.workplace;
  }
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
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
    if ((body as { code?: string }).code === "explanation_required") {
      window.dispatchEvent(
        new CustomEvent(EXPLANATION_REQUIRED_EVENT, { detail: { letterId: (body as { letterId?: number }).letterId } }),
      );
    }
    throw new DavomatApiError(body as {
      error?: string;
      code?: string;
      distanceMeters?: number;
      remainMeters?: number;
      allowedMeters?: number;
      fullName?: string;
      checkIn?: string;
      checkOut?: string;
      checkInAt?: string | null;
      checkOutAt?: string | null;
      workplace?: {
        location?: string;
        latitude?: number;
        longitude?: number;
        kind?: "branch" | "office";
      };
    });
  }
  return body as T;
}

export function fetchDavomat(params: {
  from: string;
  to: string;
  search?: string;
  departmentId?: string;
  location?: string;
  employeeId?: string;
  staffFilter?: string;
}): Promise<DavomatReport> {
  const q = new URLSearchParams();
  q.set("from", params.from);
  q.set("to", params.to);
  if (params.search) q.set("search", params.search);
  if (params.departmentId) q.set("departmentId", params.departmentId);
  if (params.location) q.set("location", params.location);
  if (params.employeeId) q.set("employeeId", params.employeeId);
  if (params.staffFilter && params.staffFilter !== "all") q.set("staffFilter", params.staffFilter);
  return apiJson<DavomatReport>(`/davomat?${q}`);
}

export async function saveDavomatManual(payload: {
  employeeId: number;
  workDate: string;
  checkIn?: string | null;
  checkOut?: string | null;
  status?: string;
  notes?: string;
}): Promise<void> {
  await apiJson("/davomat/manual", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type DavomatResetPart = "in" | "out" | "all";

/** Davomatni bekor qilish: faqat Keldim, faqat Ketdim yoki butun kun */
export type ScheduleShiftOption = {
  key: string;
  label: string;
  start: string;
  end: string;
};

export type EmployeeScheduleRule = {
  id: number;
  employeeId: number;
  mode: "permanent" | "period";
  validFrom: string;
  validTo: string | null;
  shiftKey: string;
  startHm: string;
  endHm: string;
  note: string | null;
};

export async function fetchEmployeeSchedule(employeeId: number, workDate: string): Promise<{
  shifts: ScheduleShiftOption[];
  current: EmployeeScheduleRule | null;
  rules: EmployeeScheduleRule[];
}> {
  const q = new URLSearchParams({ employeeId: String(employeeId), workDate });
  return apiJson(`/davomat/schedule-override?${q}`);
}

export async function saveEmployeeSchedule(payload: {
  employeeId: number;
  mode: "permanent" | "period";
  validFrom: string;
  validTo?: string | null;
  shiftKey: string;
  startHm: string;
  endHm: string;
}): Promise<void> {
  await apiJson("/davomat/schedule-override", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function clearEmployeeSchedule(employeeId: number, id?: number | null): Promise<void> {
  await apiJson("/davomat/schedule-override/clear", {
    method: "POST",
    body: JSON.stringify({ employeeId, id: id || undefined }),
  });
}

/** Kunni sababli qilish — faqat admin va HR menejer. Izoh majburiy. */
export async function saveDavomatExcuse(payload: {
  employeeId: number;
  workDate: string;
  status: string;
  note: string;
}): Promise<void> {
  await apiJson("/davomat/excuse", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function resetDavomatManual(payload: {
  employeeId: number;
  workDate: string;
  part?: DavomatResetPart;
}): Promise<{ ok: boolean; deleted: boolean; message?: string }> {
  return apiJson("/davomat/reset", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function faceVerifyDavomat(payload: {
  descriptor?: number[];
  descriptors?: number[][];
  latitude: number;
  longitude: number;
  accuracy?: number;
  snapshot?: string;
  liveness?: {
    blinked?: boolean;
    poses?: string[];
    steps?: string[];
    motion?: number;
    score?: number;
    challenge?: string;
  };
}): Promise<{
  ok: boolean;
  fullName: string;
  employeeId: number;
  distanceMeters: number;
  allowedMeters: number;
  workDate: string;
  nextAction: "in" | "out" | "done";
  checkIn: string;
  checkOut: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  employee?: DavomatEmployee | null;
  user?: {
    id: number;
    fullName: string;
    role: string;
    departmentId?: number | null;
    departmentName?: string | null;
    login?: string;
    phone?: string | null;
    status?: string;
    createdAt?: string;
  } | null;
  sessionSwitched?: boolean;
  ownerVerified?: boolean;
}> {
  const snapshot = payload.snapshot
    ? (await compressFaceSnapshotAsync(payload.snapshot, 640, 0.82)) || payload.snapshot
    : undefined;
  return apiJson("/davomat/face-verify", {
    method: "POST",
    body: JSON.stringify({ ...payload, snapshot }),
  });
}

export async function facePunchDavomat(payload: {
  descriptor: number[];
  latitude: number;
  longitude: number;
  accuracy?: number;
  /** Qurilma GPS vaqti (ms). Eskirgan nuqta bilan davomat yozilmaydi. */
  gpsCapturedAt?: number;
  action: "in" | "out";
  /** Cheklist dan tanlangan filial (mudir employee id) */
  branchId?: number;
  snapshot?: string;
  /** Erta ketish sababi */
  notes?: string;
  liveness?: {
    blinked?: boolean;
    poses?: string[];
    motion?: number;
    score?: number;
  };
}): Promise<{
  ok: boolean;
  action: "in" | "out";
  fullName: string;
  message?: string;
  checkIn: string;
  checkOut: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  nextAction?: "in" | "out" | "done";
  workedHours: string;
  distanceMeters: number;
  location?: string | null;
  employee?: DavomatEmployee | null;
  user?: {
    id: number;
    fullName: string;
    role: string;
    departmentId?: number | null;
    departmentName?: string | null;
    login?: string;
    phone?: string | null;
    status?: string;
    createdAt?: string;
  } | null;
  sessionSwitched?: boolean;
  checklistRedirect?: boolean;
  ofisdaRedirect?: boolean;
  checklistHint?: string;
  coordinatorVisit?: {
    id: number;
    branchId: number;
    isOffice?: boolean;
    visitKind?: "office" | "branch";
  } | null;
  attendanceAlreadyMarked?: boolean;
}> {
  /** AI anti-spoof ~180k char limitti — siqilmasa «Yuz rasmi olinmadi» chiqadi */
  const snapshot = payload.snapshot
    ? (await compressFaceSnapshotAsync(payload.snapshot, 640, 0.82)) || payload.snapshot
    : undefined;
  return apiJson("/davomat/face-punch", {
    method: "POST",
    body: JSON.stringify({ ...payload, snapshot }),
  });
}

export type WorkplaceInfo = {
  allowedMeters: number;
  /** Admin ko‘chma ruxsat — yashil zonadan tashqarida ham davomat */
  mobileAnywhere?: boolean;
  /** Reviziya: ofis + istalgan filial zonasidan davomat */
  fieldBranchPunch?: boolean;
  gpsReady?: boolean;
  gpsError?: string | null;
  shiftWindowOpen?: boolean;
  workDate: string;
  /** Jadval bo‘yicha bugun dam — davomat qilsa qo‘shimcha ish, jarimasiz */
  restDay?: { reason: string } | null;
  swapToday?: { kind: "rest" | "work"; with: string; id: number } | null;
  site?: {
    label: string;
    latitude: number;
    longitude: number;
    kind?: "branch" | "office";
  };
  dayPlan?: {
    workDate: string;
    slots: Array<{
      branchId: number;
      branchLabel: string | null;
      shiftKey: string;
      shiftLabel: string;
      mode?: string;
      activeNow?: boolean;
    }>;
    activeNow: Array<{
      branchId: number;
      branchLabel: string | null;
      shiftKey: string;
      shiftLabel: string;
    }>;
  };
  employee: {
    id: number;
    fullName: string;
    location: string | null;
    latitude: number | null;
    longitude: number | null;
    hasGps: boolean;
  };
  today: {
    checkIn: string;
    checkOut: string;
    checkInAt?: string | null;
    checkOutAt?: string | null;
    checkInMethod?: string | null;
    checkOutMethod?: string | null;
    status: string;
    complete: boolean;
    nextAction: "in" | "out" | "done";
    excused?: boolean;
    excuseNote?: string | null;
    excusedAt?: string | null;
    /** Koordinator: yopilgan ofis sessiyalari (cheklist hisobga kirmaydi) */
    priorOfficeMs?: number;
  };
  zonePresence?: {
    enabled: boolean;
    method: "FACE_ID" | "QR" | null;
    intervalHours: number | null;
    windowMinutes: number | null;
    status: "off" | "idle" | "waiting" | "due" | "blocked";
    dueAt: string | null;
    remainSec: number | null;
    message: string | null;
  };
  shift?: {
    type: "one" | "two" | "office" | string;
    keys?: string[];
    label: string;
    start: string;
    end: string;
    overnight?: boolean;
    warnHm: string;
    warnText: string;
    checkoutDeadlineHm?: string;
    checkoutDeadlineAt?: string;
    checkoutDeadlineHint?: string;
  } | null;
};

export async function fetchMyWorkplace(opts?: {
  lat?: number;
  lng?: number;
  branchId?: number;
}): Promise<WorkplaceInfo> {
  const q = new URLSearchParams();
  if (opts?.lat != null && Number.isFinite(opts.lat)) q.set("lat", String(opts.lat));
  if (opts?.lng != null && Number.isFinite(opts.lng)) q.set("lng", String(opts.lng));
  if (opts?.branchId != null && opts.branchId > 0) q.set("branchId", String(opts.branchId));
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiJson<WorkplaceInfo>(`/davomat/me/workplace${suffix}`);
}

export async function fetchMyDavomat(): Promise<{
  from: string;
  to: string;
  fullName: string;
  employee: DavomatEmployee | null;
}> {
  return apiJson("/davomat/me");
}

export const DAVOMAT_GEOFENCE_METERS = 70;
/** Asosiy ofis — 100 m atrofida qabul qilinadi */
export const DAVOMAT_OFFICE_GEOFENCE_METERS = 100;
/** 41°13'09.3"N 69°16'22.9"E */
export const DAVOMAT_SITE_LAT = 41 + 13 / 60 + 9.3 / 3600;
export const DAVOMAT_SITE_LNG = 69 + 16 / 60 + 22.9 / 3600;
export const DAVOMAT_SITE_LABEL = "41°13'09.3\"N 69°16'22.9\"E";

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export type DavomatSite = {
  allowedMeters: number;
  label: string;
  latitude: number;
  longitude: number;
  kind?: "branch" | "office";
};

export async function fetchDavomatSite(): Promise<DavomatSite> {
  try {
    const site = await apiJson<DavomatSite>("/davomat/site");
    return {
      ...site,
      allowedMeters: site.allowedMeters || DAVOMAT_OFFICE_GEOFENCE_METERS,
    };
  } catch {
    return {
      allowedMeters: DAVOMAT_OFFICE_GEOFENCE_METERS,
      label: DAVOMAT_SITE_LABEL,
      latitude: DAVOMAT_SITE_LAT,
      longitude: DAVOMAT_SITE_LNG,
      kind: "office",
    };
  }
}

export type DavomatMethods = {
  pharmacyStaff: boolean;
  /** Ofis xodimi (bo‘limi bor) — Face ID | QR */
  officeStaff?: boolean;
  /** Faqat admin: istalgan filial QR, lokatsiya shartsiz */
  adminQrAnywhere?: boolean;
  methods: Array<"FACE_ID" | "QR">;
  /** Admin o‘chirgan bo‘lsa false */
  face?: boolean;
  qr?: boolean;
  /** Faqat admin yoqqan xodimga keladi; aks holda maydon umuman yo‘q */
  finger?: boolean;
  canManageQr: boolean;
  canManageBranchQr?: boolean;
  canViewBranchQr?: boolean;
  canManageDeptQr?: boolean;
  /** Ofis QR ko‘rish/yuklash (yaratish emas) */
  canViewDeptQr?: boolean;
  assignedBranchId: number | null;
  departmentId?: number | null;
};

export function fetchDavomatMethods(): Promise<DavomatMethods> {
  return apiJson<DavomatMethods>("/davomat/methods");
}

export type DavomatMethodAccessRow = {
  userId: number;
  fullName: string;
  role: string;
  position: string;
  location: string;
  place: "ofis" | "dorixona";
  scheduleLabel?: string;
  scheduleHours?: string;
  status: string;
  face: boolean;
  qr: boolean;
  finger?: boolean;
  fingerEnrolled?: boolean;
  fingerDevice?: string | null;
  fingerEnrolledAt?: string | null;
  fingerLastUsedAt?: string | null;
  fingerUseCount?: number;
  zoneEnabled?: boolean;
  zoneIntervalHours?: number;
  zoneWindowMinutes?: number;
  zoneMethod?: "FACE_ID" | "QR";
  zoneStatus?: "off" | "idle" | "waiting" | "due" | "blocked";
};

export type FingerprintStatus =
  | { enabled: false }
  | {
      enabled: true;
      enrolled: boolean;
      thisDevice: boolean;
      deviceLabel: string | null;
      enrolledAt: string | null;
      lastUsedAt: string | null;
    };

export function fetchFingerprintStatus(): Promise<FingerprintStatus> {
  return apiJson<FingerprintStatus>("/davomat/fingerprint/status");
}

/** WebAuthn xatolarini xodimga tushunarli matnga aylantiradi. */
function fingerprintClientError(err: unknown, phase: "register" | "punch"): DavomatApiError {
  if (err instanceof DavomatApiError) return err;
  const name = (err as { name?: string })?.name || "";
  const code = (err as { code?: string })?.code || "";
  if (name === "InvalidStateError" || code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return new DavomatApiError({
      error: "Bu qurilmadagi barmoq izi boshqa akkauntga biriktirilgan. Har bir xodim faqat o‘z telefonidan ro‘yxatdan o‘tadi.",
      code: "finger_device_taken",
    });
  }
  if (name === "NotAllowedError" || name === "AbortError") {
    return new DavomatApiError({
      error:
        phase === "register"
          ? "Ro‘yxatdan o‘tkazish bekor qilindi yoki vaqt tugadi. Qayta urinib, barmog‘ingizni skanerga qo‘ying."
          : "Barmoq izi tasdiqlanmadi yoki bekor qilindi. Qayta urinib ko‘ring.",
      code: "finger_cancelled",
    });
  }
  if (name === "NotSupportedError" || name === "SecurityError") {
    return new DavomatApiError({
      error: "Bu brauzer barmoq izini qo‘llamaydi. Saytni Chrome yoki Safari brauzerida oching.",
      code: "finger_unsupported",
    });
  }
  return new DavomatApiError({
    error: (err as Error)?.message || "Barmoq izi bilan bog‘liq xato — qayta urinib ko‘ring",
    code: "finger_error",
  });
}

export type FingerprintEnrollResult = Extract<FingerprintStatus, { enabled: true }> & {
  /** Ro‘yxatdan o‘tishdagi barmoq tasdig‘i — shu zahoti bir marta Keldim/Ketdim */
  enrollPass?: string;
};

export async function enrollFingerprint(): Promise<FingerprintEnrollResult> {
  const { startRegistration } = await import("@simplewebauthn/browser");
  try {
    const optionsJSON = await apiJson<Parameters<typeof startRegistration>[0]["optionsJSON"]>(
      "/davomat/fingerprint/register/options",
      { method: "POST", body: "{}" },
    );
    const credential = await startRegistration({ optionsJSON });
    const out = await apiJson<Partial<FingerprintEnrollResult>>("/davomat/fingerprint/register/verify", {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
    return {
      enabled: true,
      enrolled: true,
      thisDevice: true,
      deviceLabel: out.deviceLabel ?? null,
      enrolledAt: out.enrolledAt ?? null,
      lastUsedAt: out.lastUsedAt ?? null,
      enrollPass: typeof out.enrollPass === "string" ? out.enrollPass : undefined,
    };
  } catch (err) {
    throw fingerprintClientError(err, "register");
  }
}

/** Barmoq izini so‘raydi; natijani davomat yuborish uchun qaytaradi. */
export async function captureFingerprintAssertion(): Promise<unknown> {
  const { startAuthentication } = await import("@simplewebauthn/browser");
  try {
    const optionsJSON = await apiJson<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
      "/davomat/fingerprint/punch/options",
      { method: "POST", body: "{}" },
    );
    return await startAuthentication({ optionsJSON });
  } catch (err) {
    throw fingerprintClientError(err, "punch");
  }
}

export function fingerprintPunchDavomat(
  payload: Omit<Parameters<typeof facePunchDavomat>[0], "descriptor" | "snapshot" | "liveness"> & {
    assertion: unknown;
    checkoutNote?: string;
  },
): ReturnType<typeof facePunchDavomat> {
  return apiJson("/davomat/fingerprint/punch", { method: "POST", body: JSON.stringify(payload) });
}

export function resetEmployeeFingerprint(userId: number) {
  return apiJson<{ ok: boolean; removed: boolean }>(`/davomat/fingerprint/${userId}`, { method: "DELETE" });
}

export function fingerprintSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

export function fetchDavomatMethodAccess(q = ""): Promise<{ items: DavomatMethodAccessRow[]; total: number }> {
  const qs = new URLSearchParams();
  if (q.trim()) qs.set("q", q.trim());
  return apiJson(`/davomat/method-access?${qs}`);
}

export function saveDavomatMethodAccess(body: { userId: number; face?: boolean; qr?: boolean; finger?: boolean }) {
  return apiJson<{ ok: boolean; userId: number; face: boolean; qr: boolean; finger?: boolean }>("/davomat/method-access", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function saveDavomatMethodAccessBulk(body: { userIds: number[]; face?: boolean; qr?: boolean; finger?: boolean }) {
  return apiJson<{ ok: boolean; updated: number }>("/davomat/method-access/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function saveZonePresence(body: {
  userId: number;
  enabled: boolean;
  intervalHours: number;
  windowMinutes: number;
  method: "FACE_ID" | "QR";
}) {
  return apiJson<{ ok: boolean; userId: number; zone: WorkplaceInfo["zonePresence"] }>("/davomat/zone-presence", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export type AccessAuditAction = "method" | "zone" | "zone_unlock" | "finger_enroll" | "finger_reset";

export type AccessAuditItem = {
  id: number;
  createdAt: string;
  actorUserId: number | null;
  actorName: string;
  actorRole: string | null;
  actorLogin: string | null;
  action: AccessAuditAction;
  batchId: string | null;
  batchSize: number | null;
  targetUserId: number;
  targetName: string;
  targetPosition: string | null;
  targetLocation: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
};

export type AccessAuditEditor = {
  id: number;
  fullName: string;
  role: string;
  login: string;
  status: string;
  isBoshAdmin: boolean;
  changes: number;
  lastAt: string | null;
};

export type AccessAuditResponse = {
  items: AccessAuditItem[];
  total: number;
  actors: Array<{ userId: number | null; name: string; changes: number; lastAt: string }>;
  editors: AccessAuditEditor[];
};

export function canViewAccessAudit() {
  return apiJson<{ allowed: boolean }>("/davomat/access-audit/can");
}

export function fetchAccessAudit(filters: {
  q?: string;
  actorUserId?: number | null;
  action?: AccessAuditAction | "";
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) {
  const qs = new URLSearchParams();
  if (filters.q?.trim()) qs.set("q", filters.q.trim());
  if (filters.actorUserId) qs.set("actorUserId", String(filters.actorUserId));
  if (filters.action) qs.set("action", filters.action);
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  qs.set("limit", String(filters.limit ?? 50));
  qs.set("offset", String(filters.offset ?? 0));
  return apiJson<AccessAuditResponse>(`/davomat/access-audit?${qs}`);
}

export function unlockZonePresence(userId: number) {
  return apiJson<{ ok: boolean; userId: number; zone: WorkplaceInfo["zonePresence"] }>("/davomat/zone-presence/unlock", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function confirmZonePresence(body: {
  method: "FACE_ID" | "QR";
  latitude: number;
  longitude: number;
  gpsCapturedAt: number;
  accuracy?: number;
  descriptor?: number[];
  snapshot?: string;
  qrPayload?: string;
}) {
  return apiJson<{ ok: boolean; message: string; zone: WorkplaceInfo["zonePresence"] }>("/davomat/zone-presence/confirm", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type QrBranchRow = {
  id: number;
  name: string;
  managerName: string;
  /** true — shu filial xodimlari faqat Face ID */
  qrFaceOnly?: boolean;
  hasActiveQr: boolean;
  hasPayload?: boolean;
  qrId: string | null;
  version: number | null;
  createdAt: string | null;
};

export function fetchQrBranches(): Promise<{ branches: QrBranchRow[] }> {
  return apiJson("/davomat/qr/branches");
}

export function setBranchQrFaceOnly(branchId: number, enabled: boolean) {
  return apiJson<{ ok: boolean; branchId: number; name: string; qrFaceOnly: boolean; message: string }>(
    "/davomat/qr/face-only",
    { method: "POST", body: JSON.stringify({ branchId, enabled }) },
  );
}

export type QrDepartmentRow = {
  id: number;
  name: string;
  hasActiveQr: boolean;
  hasPayload?: boolean;
  qrId: string | null;
  version: number | null;
  createdAt: string | null;
  /** Umumiy ofis QR — barcha ofis xodimlari */
  sharedOffice?: boolean;
};

/** Sentinel id — serverdagi OFFICE_SHARED_QR_DEPARTMENT_ID bilan mos */
export const OFFICE_SHARED_QR_DEPARTMENT_ID = 0;

export function fetchQrDepartments(): Promise<{ departments: QrDepartmentRow[] }> {
  return apiJson("/davomat/qr/departments");
}

export function fetchActiveBranchQr(branchId: number): Promise<{
  active: {
    qrId: string;
    branchId: number;
    branchLabel: string | null;
    version: number;
    status: string;
    createdAt: string;
    expiresAt: string | null;
    payload: string | null;
    needsReissue?: boolean;
  } | null;
}> {
  return apiJson(`/davomat/qr/active/${branchId}`);
}

export function fetchActiveDepartmentQr(departmentId: number): Promise<{
  active: {
    qrId: string;
    departmentId: number;
    departmentLabel: string | null;
    version: number;
    status: string;
    createdAt: string;
    expiresAt: string | null;
    payload: string | null;
    needsReissue?: boolean;
  } | null;
}> {
  return apiJson(`/davomat/qr/department/active/${departmentId}`);
}

export function issueBranchQr(branchId: number): Promise<{
  ok: boolean;
  qrId: string;
  branchId: number;
  branchLabel: string;
  version: number;
  payload: string;
  createdAt: string;
  note?: string;
}> {
  return apiJson("/davomat/qr/issue", {
    method: "POST",
    body: JSON.stringify({ branchId }),
  });
}

export function issueDepartmentQr(departmentId: number): Promise<{
  ok: boolean;
  qrId: string;
  departmentId: number;
  departmentLabel: string;
  version: number;
  payload: string;
  createdAt: string;
  note?: string;
}> {
  return apiJson("/davomat/qr/department/issue", {
    method: "POST",
    body: JSON.stringify({ departmentId }),
  });
}

export function revokeBranchQr(branchId: number): Promise<{ ok: boolean; revoked: boolean }> {
  return apiJson(`/davomat/qr/active/${branchId}`, { method: "DELETE" });
}

export function revokeDepartmentQr(departmentId: number): Promise<{ ok: boolean; revoked: boolean }> {
  return apiJson(`/davomat/qr/department/active/${departmentId}`, { method: "DELETE" });
}

export async function qrPunchDavomat(payload: {
  payload: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  gpsCapturedAt?: number;
  action: "in" | "out";
  deviceId?: string;
  /** Erta ketish sababi */
  notes?: string;
}): Promise<{
  ok: boolean;
  action: "in" | "out";
  fullName: string;
  message?: string;
  checkIn: string;
  checkOut: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  workedHours: string;
  distanceMeters: number;
  verificationMethod?: string;
  branchLabel?: string | null;
  departmentLabel?: string | null;
  adminQrAnywhere?: boolean;
  employee?: DavomatEmployee | null;
}> {
  return apiJson("/davomat/qr-punch", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function downloadDavomatExcel(params: {
  from: string;
  to: string;
  search?: string;
  departmentId?: string;
  location?: string;
  staffFilter?: string;
  warehouseShift?: string;
  branch?: string;
  branchLabel?: string;
  coordinatorId?: number;
  coordinatorLabel?: string;
}): Promise<{ via: "telegram" | "browser" }> {
  const q = new URLSearchParams();
  q.set("from", params.from);
  q.set("to", params.to);
  if (params.search) q.set("search", params.search);
  if (params.departmentId) q.set("departmentId", params.departmentId);
  if (params.location) q.set("location", params.location);
  if (params.staffFilter && params.staffFilter !== "all") q.set("staffFilter", params.staffFilter);
  if (params.staffFilter === "warehouse" && params.warehouseShift && params.warehouseShift !== "all") {
    q.set("warehouseShift", params.warehouseShift);
  }
  if (params.branch && params.branch !== "all") {
    q.set("branch", params.branch);
    if (params.branchLabel) q.set("branchLabel", params.branchLabel);
  }
  if (params.coordinatorId && params.coordinatorId > 0) {
    q.set("coordinatorId", String(params.coordinatorId));
    if (params.coordinatorLabel) q.set("coordinatorLabel", params.coordinatorLabel);
  }
  const res = await fetch(`/api/davomat/export?${q}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Excel yuklanmadi (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob.size) {
    throw new Error("Server bo‘sh fayl qaytardi — qayta urinib ko‘ring");
  }
  const { deliverFile } = await import("./tg-download");
  return deliverFile(blob, `davomat_${params.from}_${params.to}.xlsx`);
}

/** Kunlik hisobot: kelmaganlar, kechikkanlar, kelganlar va oylik sanoq. */
export async function downloadDavomatDayPdf(params: {
  date: string;
  employeeIds: number[];
  filterLine?: string;
}): Promise<{ via: "telegram" | "browser" }> {
  const res = await fetch("/api/davomat/day-report.pdf", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: params.date,
      employeeIds: params.employeeIds,
      filterLine: params.filterLine || null,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `PDF yuklanmadi (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("Server bo‘sh PDF qaytardi");
  const { deliverFile } = await import("./tg-download");
  return deliverFile(blob, `davomat_${params.date}.pdf`);
}
