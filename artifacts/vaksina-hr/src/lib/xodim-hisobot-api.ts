/** Hisobot shu kundan boshlanadi. Undan oldingi sanalar ochilmaydi. */
export const PLATFORM_START = "2026-09-01";

export type XodimDayStatus = "present" | "late" | "absent" | "incomplete" | "leave" | "planned" | "rest";

export const XODIM_STATUS_OPTIONS: Array<{ id: XodimDayStatus; label: string }> = [
  { id: "present", label: "Kelgan" },
  { id: "late", label: "Kechikkan" },
  { id: "absent", label: "Kelmagan" },
  { id: "incomplete", label: "Chala kun" },
  { id: "leave", label: "Ta'til" },
  { id: "planned", label: "Hali kelmagan" },
  { id: "rest", label: "Dam kuni" },
];

export type XodimSearchHit = {
  id: number;
  employeeId: number | null;
  userId: number | null;
  fullName: string;
  roleLabel: string;
  branch: string;
  phone: string | null;
  login: string | null;
  employmentStatus: string;
  hiredAt: string | null;
};

export type XodimDay = {
  date: string;
  weekday: string;
  status: XodimDayStatus;
  statusLabel: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: string | null;
  branch: string | null;
};

export type XodimTaskItem = {
  id: number;
  title: string;
  status: string;
  statusLabel: string;
  dueLabel: string;
  bucket: "remaining" | "done" | "cancelled";
};

export type XodimTasks = {
  total: number;
  remaining: number;
  inProgress: number;
  done: number;
  notDone: number;
  cancelled: number;
  items: XodimTaskItem[];
};

export type XodimReport = {
  employee: {
    id: number;
    fullName: string;
    position: string;
    roleLabel: string;
    branch: string;
    phone: string | null;
    login: string | null;
    shift: string;
    hiredAt: string | null;
    statusLabel: string;
    department: string | null;
    attendanceTracked: boolean;
    photoUrl?: string | null;
    birthDate?: string | null;
    staffCode?: string;
  };
  from: string;
  to: string;
  dayCount: number;
  statuses: XodimDayStatus[];
  days: XodimDay[];
  summary: {
    present: number;
    late: number;
    absent: number;
    incomplete: number;
    leave: number;
    planned: number;
    rest: number;
    came: number;
    total: number;
    presentRate: number | null;
  };
  tasks: XodimTasks;
  access?: {
    joinedAt: string | null;
    firstSeenAt: string | null;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
  };
  javob?: {
    total: number;
    approved: number;
    pending: number;
    rejected: number;
    items: Array<{
      id: number;
      date: string;
      fromHm: string;
      toHm: string;
      note: string;
      statusLabel: string;
      coordinator: string | null;
      coordinatorAt: string | null;
      hr: string | null;
      hrAt: string | null;
    }>;
  };
  attestatsiya?: {
    total: number;
    passed: number;
    failed: number;
    items: Array<{
      id: number;
      title: string;
      statusLabel: string;
      score: number | null;
      passed: boolean | null;
      correct: number | null;
      total: number;
      when: string | null;
    }>;
  };
  darslik?: {
    tracks: Array<{
      track: string;
      passed: number;
      total: number;
      percent: number;
      done: boolean;
    }>;
  };
};

export type XodimSeal = {
  token: string;
  sealedAt: string;
  title: string;
  approverName: string;
  approverLine: string;
  verifyPath: string;
  report: XodimReport;
};

export type XodimVerified = {
  kind: "employee-attendance";
  title: string;
  approverName: string;
  approverLine: string;
  sealedAt: string;
  report: XodimReport;
};

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "So‘rov bajarilmadi");
  return data;
}

export async function searchXodimlar(q: string): Promise<XodimSearchHit[]> {
  const res = await fetch(`/api/holat/employees?q=${encodeURIComponent(q)}`, { credentials: "include" });
  const data = await readJson<{ employees: XodimSearchHit[] }>(res);
  return data.employees ?? [];
}

export async function fetchXodimReport(input: {
  employeeId: number | null;
  userId: number | null;
  from: string;
  to: string;
  statuses: XodimDayStatus[];
}): Promise<XodimReport> {
  const qs = new URLSearchParams({
    from: input.from,
    to: input.to,
    statuses: input.statuses.join(","),
  });
  if (input.employeeId) qs.set("employeeId", String(input.employeeId));
  if (input.userId) qs.set("userId", String(input.userId));
  const res = await fetch(`/api/holat/employee-report?${qs}`, { credentials: "include" });
  return readJson<XodimReport>(res);
}

export async function sealXodimReport(input: {
  employeeId: number | null;
  userId: number | null;
  from: string;
  to: string;
  statuses: XodimDayStatus[];
}): Promise<XodimSeal> {
  const res = await fetch("/api/holat/employee-report/seal", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<XodimSeal>(res);
}

export async function fetchVerifiedHisobot(token: string): Promise<XodimVerified> {
  const res = await fetch(`/api/holat/verify/${encodeURIComponent(token)}`);
  return readJson<XodimVerified>(res);
}

export function formatYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function formatSealWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date}, ${time}`;
}
