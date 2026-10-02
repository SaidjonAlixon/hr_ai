export type JavobShiftInfo = {
  workDate: string;
  shiftType: string;
  shiftLabel: string;
  shiftStartHm: string;
  shiftEndHm: string;
  overnight: boolean;
  durationLabel: string;
};

export type JavobTimelineStep = {
  key: string;
  label: string;
  at?: string | null;
  atLabel: string;
  by: string | null;
  note: string | null;
};

export type JavobRequestItem = {
  id: number;
  employeeId: number;
  userId: number | null;
  fullName: string | null;
  branchLabel?: string | null;
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
  kind?: "day" | "hour";
  coordinatorUserId: number | null;
  coordinatorName?: string | null;
  coordDecidedById?: number | null;
  coordDecidedByName?: string | null;
  coordDecidedAt?: string | null;
  coordDecisionNote?: string | null;
  escalatedAt?: string | null;
  escalatedNote?: string | null;
  decidedById: number | null;
  decidedByName?: string | null;
  decidedAt?: string | null;
  decisionNote: string | null;
  createdAt?: string;
  createdAtLabel?: string;
  escalatedAtLabel?: string;
  coordDecidedAtLabel?: string;
  decidedAtLabel?: string;
  timeline?: JavobTimelineStep[];
  /** Joriy foydalanuvchi shu so‘rovga hozir javob bera oladimi (faqat scope=pending) */
  canAct?: boolean;
};

/** Koordinator 8 soat ichida javob bermasa, so‘rov HR ga o‘tadi */
export const JAVOB_COORD_ESCALATE_HOURS = 8;

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

export function fetchJavobRequests(
  scope: "mine" | "pending" | "all" | "approved-by-me" | "decided" = "mine",
  extra?: { employeeId?: number; from?: string; to?: string },
) {
  const qs = new URLSearchParams({ scope });
  if (extra?.employeeId) qs.set("employeeId", String(extra.employeeId));
  if (extra?.from) qs.set("from", extra.from);
  if (extra?.to) qs.set("to", extra.to);
  return apiJson<{
    items: JavobRequestItem[];
    canDecide: boolean;
    roleScope?: "coord" | "hr" | "none";
  }>(`/javob-olish?${qs.toString()}`);
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

/** Bir yuborishdagi ketma-ket kunlar — bitta qaror. */
const JAVOB_BATCH_MS = 10 * 60 * 1000;

function ymdSerial(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function sameJavobBatch(a: JavobRequestItem, b: JavobRequestItem) {
  if (a.employeeId !== b.employeeId) return false;
  if (a.status !== b.status) return false;
  if ((a.note || "").trim() !== (b.note || "").trim()) return false;
  if (a.fromHm !== b.fromHm || a.toHm !== b.toHm) return false;
  const ta = a.createdAt ? new Date(a.createdAt).getTime() : NaN;
  const tb = b.createdAt ? new Date(b.createdAt).getTime() : NaN;
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return a.id === b.id;
  return Math.abs(ta - tb) <= JAVOB_BATCH_MS;
}

export type JavobRequestGroup = {
  id: number;
  head: JavobRequestItem;
  items: JavobRequestItem[];
  datesLabel: string;
  dayCount: number;
};

/** Bir xodimning bir martada belgilagan ketma-ket kunlarini bitta kartaga yig‘adi. */
export function groupConsecutiveJavob(items: JavobRequestItem[]): JavobRequestGroup[] {
  const used = new Set<number>();
  const sorted = [...items].sort((a, b) => a.workDate.localeCompare(b.workDate) || a.id - b.id);
  const groups: JavobRequestGroup[] = [];

  for (const seed of sorted) {
    if (used.has(seed.id)) continue;
    const pool = sorted.filter((it) => !used.has(it.id) && sameJavobBatch(seed, it));
    const byDate = new Map<string, JavobRequestItem>();
    for (const it of pool) {
      if (!byDate.has(it.workDate)) byDate.set(it.workDate, it);
    }
    const span = new Map<string, JavobRequestItem>();
    const stack = [seed.workDate];
    while (stack.length) {
      const day = stack.pop()!;
      if (span.has(day)) continue;
      const hit = byDate.get(day);
      if (!hit || !sameJavobBatch(seed, hit)) continue;
      span.set(day, hit);
      const n = ymdSerial(day);
      if (!Number.isFinite(n)) continue;
      for (const other of byDate.values()) {
        const diff = ymdSerial(other.workDate) - n;
        if (diff === 1 || diff === -1) stack.push(other.workDate);
      }
    }
    const members = [...span.values()].sort((a, b) => a.workDate.localeCompare(b.workDate) || a.id - b.id);
    if (!members.length) {
      used.add(seed.id);
      continue;
    }
    for (const it of members) used.add(it.id);
    const first = members[0]!;
    const last = members[members.length - 1]!;
    groups.push({
      id: first.id,
      head: first,
      items: members,
      dayCount: members.length,
      datesLabel:
        members.length === 1
          ? formatYmdDisplay(first.workDate)
          : `${formatYmdDisplay(first.workDate)} – ${formatYmdDisplay(last.workDate)}`,
    });
  }

  return groups.sort((a, b) => {
    const ta = a.head.createdAt ? new Date(a.head.createdAt).getTime() : 0;
    const tb = b.head.createdAt ? new Date(b.head.createdAt).getTime() : 0;
    return tb - ta || b.head.workDate.localeCompare(a.head.workDate);
  });
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

export function isJavobOpenStatus(status: string) {
  return status === "pending" || status === "pending_coord" || status === "pending_dept" || status === "pending_hr";
}
