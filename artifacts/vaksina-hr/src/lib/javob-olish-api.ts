export type JavobShiftInfo = {
  workDate: string;
  shiftType: string;
  shiftLabel: string;
  shiftStartHm: string;
  shiftEndHm: string;
  overnight: boolean;
  durationLabel: string;
};

export type JavobRequestItem = {
  id: number;
  employeeId: number;
  userId: number | null;
  fullName: string | null;
  workDate: string;
  shiftType: string | null;
  shiftLabel: string | null;
  shiftStartHm: string;
  shiftEndHm: string;
  shiftOvernight: boolean;
  fromHm: string;
  toHm: string;
  durationMinutes: number;
  durationLabel: string;
  note: string;
  status: string;
  coordinatorUserId: number | null;
  decidedById: number | null;
  decidedAt?: string | null;
  decisionNote: string | null;
  createdAt?: string;
};

export type JavobDayInput = {
  workDate: string;
  fromHm?: string;
  toHm?: string;
  note?: string;
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

export function fetchJavobShifts(dates: string[]) {
  if (!dates.length) return Promise.resolve({ items: [] as JavobShiftInfo[] });
  return apiJson<{ items: JavobShiftInfo[] }>(
    `/javob-olish/shifts?dates=${encodeURIComponent(dates.join(","))}`,
  );
}

export function fetchJavobRequests(scope: "mine" | "pending" | "all" = "mine") {
  return apiJson<{ items: JavobRequestItem[]; canDecide: boolean }>(
    `/javob-olish?scope=${scope}`,
  );
}

export function submitJavobRequests(body: { dates: string[]; note: string } | JavobDayInput[]) {
  const payload = Array.isArray(body) ? { days: body } : { dates: body.dates, note: body.note };
  return apiJson<{ ok: boolean; count: number; message: string; items: JavobRequestItem[] }>(
    "/javob-olish",
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function approveJavobRequest(id: number, note?: string) {
  return apiJson<{ ok: boolean; item: JavobRequestItem }>(`/javob-olish/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function rejectJavobRequest(id: number, note?: string) {
  return apiJson<{ ok: boolean; item: JavobRequestItem }>(`/javob-olish/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function cancelJavobRequest(id: number) {
  return apiJson<{ ok: boolean; item: JavobRequestItem }>(`/javob-olish/${id}/cancel`, {
    method: "POST",
  });
}

export function formatYmdDisplay(ymd: string) {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}

export function dateToYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
