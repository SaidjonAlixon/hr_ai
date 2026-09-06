/** Admin: smena va ofis ish vaqtlarini o‘qish/saqlash */

export type ShiftTimes = {
  start: string;
  end: string;
  overnight?: boolean;
  unpaidBreakMin?: number;
  plannedMinutes?: number;
};

export type AttendanceShiftsPayload = {
  pharmacyOnly: boolean;
  pharmacyRoles: string[];
  officeNote: string;
  one: ShiftTimes;
  two: ShiftTimes;
  three: ShiftTimes;
  office: ShiftTimes;
};

export type AttendanceSettingsResponse = {
  settings: Record<string, unknown>;
  shifts: AttendanceShiftsPayload;
  rules?: {
    shiftEligible?: string;
    office?: string;
    maxShiftsPerDay?: number;
    allowedPairs?: string[];
  };
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
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || "So‘rov bajarilmadi");
  return body as T;
}

export function fetchAttendanceSettings(): Promise<AttendanceSettingsResponse> {
  return apiJson<AttendanceSettingsResponse>("/attendance-settings");
}

export function patchAttendanceSettings(body: {
  shifts?: {
    one?: { start?: string; end?: string };
    two?: { start?: string; end?: string };
    three?: { start?: string; end?: string; overnight?: boolean };
    office?: { start?: string; end?: string };
  };
  graceMinutes?: number;
  unpaidBreakOneMin?: number;
  unpaidBreakTwoMin?: number;
  unpaidBreakThreeMin?: number;
  unpaidBreakOfficeMin?: number;
}): Promise<AttendanceSettingsResponse> {
  return apiJson<AttendanceSettingsResponse>("/attendance-settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
