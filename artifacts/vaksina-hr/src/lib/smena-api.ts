export type SmenaBranch = {
  id: number;
  name: string;
  managerName: string;
  hasGps: boolean;
};

export type SmenaAssignable = {
  id: number;
  fullName: string;
  orgRole: string | null;
  shiftType: string;
  assignedBranchId: number | null;
  assignedBranchName: string | null;
};

export type ShiftPick = "one" | "two" | "three" | "one+two" | "two+three";
export type SlotShiftKey = "one" | "two" | "three" | "one+two" | "two+three";
export type SlotMode = "permanent" | "period" | "weekly" | "days";

export type SmenaMe = {
  pharmacyStaff: boolean;
  canPickShift: boolean;
  canPickOwnBranch: boolean;
  canAssignOthers: boolean;
  canDayRotate?: boolean;
  canManageSlots?: boolean;
  viewOnly?: boolean;
  employee: {
    id: number;
    fullName: string;
    orgRole: string | null;
    assignedBranchId: number | null;
    assignedBranchName: string | null;
  } | null;
  shift: {
    type: string;
    types?: string[];
    label: string;
    start: string;
    end: string;
    warnHm: string;
    warnText: string;
    hoursNote: string;
    windows?: Array<{ type: string; label: string; start: string; end: string; overnight?: boolean }>;
  };
  branches: SmenaBranch[];
  assignable: SmenaAssignable[];
  rules: {
    eligible?: string;
    office?: string;
    shift1: string;
    shift2: string;
    shift3?: string;
    combo?: string;
    branch: string;
  };
};

export type SmenaRotationItem = {
  id: number;
  employeeId: number;
  fullName: string;
  orgRole: string | null;
  branchId: number;
  branchLabel: string | null;
  workDate?: string;
  shiftKeys: string[];
  note: string | null;
  createdAt?: string;
};

export type StaffMonitoringItem = {
  employeeId: number;
  fullName: string;
  orgRole: string | null;
  primaryBranchId: number | null;
  primaryBranchName: string | null;
  todayBranchId: number | null;
  todayBranchLabel: string | null;
  todayShiftKey: string;
  todayShiftLabel: string;
  todayMode: string;
  todayModeLabel: string;
  slotsCount: number;
};

export type WorkSlotItem = {
  id: number;
  employeeId: number;
  branchId: number;
  branchLabel: string | null;
  shiftKey: SlotShiftKey;
  mode: SlotMode;
  validFrom: string;
  validTo: string | null;
  weekdays: number[] | null;
  workDates: string[] | null;
  overrideBase?: boolean;
  note: string | null;
  active?: boolean;
  modeLabel?: string;
  shiftLabel?: string;
  fullName?: string;
  orgRole?: string | null;
  primaryBranchId?: number | null;
  primaryBranchName?: string | null;
  createdAt?: string;
  createdByName?: string;
  isExpired?: boolean;
};

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
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    throw new Error(body.error || body.message || `So‘rov bajarilmadi (kod ${res.status})`);
  }
  return body as T;
}

export function fetchSmenaMe(): Promise<SmenaMe> {
  return apiJson<SmenaMe>("/smena/me");
}

export function saveMySmena(body: { shiftType?: ShiftPick | string; assignedBranchId?: number | null }) {
  return apiJson<{ ok: boolean }>("/smena/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function assignSmenaBranch(
  employeeId: number,
  assignedBranchId: number | null | undefined,
  shiftType?: ShiftPick | string,
) {
  const body: Record<string, unknown> = {};
  if (assignedBranchId != null) body.assignedBranchId = assignedBranchId;
  if (shiftType != null) body.shiftType = shiftType;
  return apiJson<{
    ok: boolean;
    assignedBranchName: string;
    shiftOnly?: boolean;
  }>(`/smena/assign/${employeeId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** Filialni o‘zgartirmasdan faqat smena */
export function changeShiftOnly(employeeId: number, shiftKey: SlotShiftKey | string) {
  return apiJson<{
    ok: boolean;
    shiftOnly: boolean;
    shiftType: string;
    shiftLabel: string;
    branchId: number;
    branchName: string;
    message: string;
  }>(`/smena/shift-only/${employeeId}`, {
    method: "PATCH",
    body: JSON.stringify({ shiftKey }),
  });
}

export type ShiftBoardOption = {
  key: SlotShiftKey;
  label: string;
  start: string;
  end: string;
  overnight: boolean;
};

export type ShiftBoardStaff = {
  employeeId: number;
  fullName: string;
  orgRole: string | null;
  branchId: number | null;
  branchName: string | null;
  baseShiftKey: SlotShiftKey;
  todayShiftKey: SlotShiftKey;
  overrides: Array<{ id: number; shiftKey: SlotShiftKey; weekdays: number[] }>;
  week: Array<{ weekday: number; shiftKey: SlotShiftKey; override: boolean }>;
  otherRotations: number;
};

export type ShiftBoard = {
  today: string;
  todayWeekday: number;
  shiftOptions: ShiftBoardOption[];
  staff: ShiftBoardStaff[];
};

export function fetchShiftBoard() {
  return apiJson<ShiftBoard>("/smena/shift-board");
}

/** shiftKey = null — tanlangan kunlar asosiy smenaga qaytadi */
export function saveShiftOverride(body: { employeeId: number; weekdays: number[]; shiftKey: SlotShiftKey | null }) {
  return apiJson<{ ok: boolean; message: string; cleared: boolean }>("/smena/shift-override", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateWorkSlotShift(slotId: number, shiftKey: SlotShiftKey | string) {
  return apiJson<{
    ok: boolean;
    item: WorkSlotItem;
    message?: string;
    unchanged?: boolean;
  }>(`/smena/slots/${slotId}`, {
    method: "PATCH",
    body: JSON.stringify({ shiftKey }),
  });
}

export function createDayRotation(body: {
  employeeId: number;
  branchId: number;
  workDate?: string;
  workDates?: string[];
  shiftType?: ShiftPick | string;
  note?: string;
}) {
  return apiJson<{
    ok: boolean;
    workDate: string;
    workDates: string[];
    count: number;
    branchLabel: string;
    shiftType: string | null;
    permanentUnchanged: boolean;
  }>("/smena/rotation", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchDayRotations(date: string) {
  return apiJson<{ workDate: string; items: SmenaRotationItem[] }>(
    `/smena/rotations?date=${encodeURIComponent(date)}`,
  );
}

export async function fetchRotationsForDates(dates: string[]) {
  const uniq = [...new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (!uniq.length) return { workDates: [] as string[], items: [] as SmenaRotationItem[] };
  const results = await Promise.all(uniq.map((d) => fetchDayRotations(d)));
  const items = results.flatMap((r) =>
    r.items.map((it) => ({ ...it, workDate: it.workDate || r.workDate })),
  );
  items.sort((a, b) => {
    const da = (a.workDate || "").localeCompare(b.workDate || "");
    if (da !== 0) return da;
    return a.fullName.localeCompare(b.fullName, "uz");
  });
  return { workDates: uniq, items };
}

export function deleteDayRotation(id: number) {
  return apiJson<{ ok: boolean }>(`/smena/rotation/${id}`, { method: "DELETE" });
}

export function fetchAllWorkSlots() {
  return apiJson<{ items: WorkSlotItem[]; staffMonitoring?: StaffMonitoringItem[] }>("/smena/slots/all");
}

export function fetchEmployeeSlots(employeeId: number, date?: string) {
  const q = new URLSearchParams({ employeeId: String(employeeId) });
  if (date) q.set("date", date);
  return apiJson<{ employeeId: number; items: WorkSlotItem[]; daySlots: WorkSlotItem[]; date: string }>(
    `/smena/slots?${q.toString()}`,
  );
}

export function createWorkSlot(body: {
  employeeId: number;
  branchId: number;
  shiftKey: SlotShiftKey;
  mode: SlotMode;
  validFrom?: string;
  validTo?: string | null;
  weekdays?: number[];
  workDates?: string[];
  note?: string;
}) {
  return apiJson<{ ok: boolean; item: WorkSlotItem }>("/smena/slots", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteWorkSlot(id: number) {
  return apiJson<{ ok: boolean }>(`/smena/slots/${id}`, { method: "DELETE" });
}

export function shiftLabelShort(type: string | null | undefined): string {
  const s = String(type || "").toLowerCase();
  if (s.includes("one+two") || s === "one+two") return "1+2";
  if (s.includes("two+three") || s === "two+three") return "2+3";
  if (s === "three" || s.includes("three")) return "3-smena";
  if (s === "two" || s.startsWith("two")) return "2-smena";
  if (s === "office") return "Ofis";
  return "1-smena";
}

export function todayTashkentYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

export const WEEKDAY_OPTIONS = [
  { value: 1, label: "Du" },
  { value: 2, label: "Se" },
  { value: 3, label: "Ch" },
  { value: 4, label: "Pa" },
  { value: 5, label: "Ju" },
  { value: 6, label: "Sh" },
  { value: 7, label: "Ya" },
] as const;
