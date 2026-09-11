/** Davomat API client */

import { compressFaceSnapshotAsync } from "./face-id";

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
  shiftType?: string | null;
  shiftLabel?: string | null;
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
}): Promise<DavomatReport> {
  const q = new URLSearchParams();
  q.set("from", params.from);
  q.set("to", params.to);
  if (params.search) q.set("search", params.search);
  if (params.departmentId) q.set("departmentId", params.departmentId);
  if (params.location) q.set("location", params.location);
  if (params.employeeId) q.set("employeeId", params.employeeId);
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
    ? await compressFaceSnapshotAsync(payload.snapshot)
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
  action: "in" | "out";
  snapshot?: string;
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
}> {
  const snapshot = payload.snapshot;
  return apiJson("/davomat/face-punch", {
    method: "POST",
    body: JSON.stringify({ ...payload, snapshot }),
  });
}

export type WorkplaceInfo = {
  allowedMeters: number;
  gpsReady?: boolean;
  gpsError?: string | null;
  workDate: string;
  site?: {
    label: string;
    latitude: number;
    longitude: number;
    kind?: "branch" | "office";
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
  };
  shift?: {
    type: "one" | "two" | "office" | string;
    label: string;
    start: string;
    end: string;
    overnight?: boolean;
    warnHm: string;
    warnText: string;
  } | null;
};

export async function fetchMyWorkplace(): Promise<WorkplaceInfo> {
  return apiJson<WorkplaceInfo>("/davomat/me/workplace");
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

export type QrBranchRow = {
  id: number;
  name: string;
  managerName: string;
  hasActiveQr: boolean;
  hasPayload?: boolean;
  qrId: string | null;
  version: number | null;
  createdAt: string | null;
};

export function fetchQrBranches(): Promise<{ branches: QrBranchRow[] }> {
  return apiJson("/davomat/qr/branches");
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
  action: "in" | "out";
  deviceId?: string;
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
}): Promise<void> {
  const q = new URLSearchParams();
  q.set("from", params.from);
  q.set("to", params.to);
  if (params.search) q.set("search", params.search);
  if (params.departmentId) q.set("departmentId", params.departmentId);
  if (params.location) q.set("location", params.location);
  if (params.staffFilter && params.staffFilter !== "all") q.set("staffFilter", params.staffFilter);
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
