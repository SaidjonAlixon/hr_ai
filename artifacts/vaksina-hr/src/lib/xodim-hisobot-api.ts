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

/** Telefon skaneri kompyuterdagi localhost ni ochmaydi — haqiqiy sayt. */
const PUBLIC_SITE_ORIGIN = "https://vaksina-hr.uz";

function isLocalHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** QR ichidagi havola. Lokal sahifada ham https://vaksina-hr.uz ga yo‘naladi. */
export function publicVerifyUrl(pathOrHref: string): string {
  const raw = pathOrHref.trim();
  const here = typeof window !== "undefined" ? window.location : null;
  const base = here && !isLocalHost(here.hostname) ? here.origin : PUBLIC_SITE_ORIGIN;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (!isLocalHost(u.hostname)) return raw;
      return `${PUBLIC_SITE_ORIGIN}${u.pathname}${u.search}${u.hash}`;
    } catch {
      return raw;
    }
  }
  return `${base}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

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

export type FilialEmployeePick = {
  employeeId: number;
  userId: number | null;
  fullName: string;
  roleLabel: string;
  phone: string | null;
  hiredAt: string | null;
};

export type FilialPick = {
  id: number;
  name: string;
  mudirName: string | null;
  mudirMissing: boolean;
  coordinatorName: string | null;
  employees: FilialEmployeePick[];
};

export type FilialEmployeeRow = {
  employeeId: number;
  fullName: string;
  roleLabel: string;
  phone: string | null;
  shiftDisplay: string;
  presentDays: number;
  onTimeDays: number;
  lateDays: number;
  absentDays: number;
  presentRate: number;
  days?: XodimDay[];
};

export type FilialReport = {
  filial: FilialPick;
  from: string;
  to: string;
  dayCount: number;
  employees: FilialEmployeeRow[];
};

export async function fetchFilials(): Promise<FilialPick[]> {
  const res = await fetch("/api/holat/filials", { credentials: "include" });
  const data = await readJson<{ filials: FilialPick[] }>(res);
  return data.filials ?? [];
}

export async function fetchStaffDays(input: {
  employeeIds: number[];
  from: string;
  to: string;
}): Promise<Array<{ employeeId: number; days: XodimDay[] }>> {
  const qs = new URLSearchParams({
    employeeIds: input.employeeIds.join(","),
    from: input.from,
    to: input.to,
  });
  const res = await fetch(`/api/holat/staff-days?${qs}`, { credentials: "include" });
  const data = await readJson<{ packs: Array<{ employeeId: number; days: XodimDay[] }> }>(res);
  return data.packs ?? [];
}

export async function fetchFilialReport(input: {
  branchId: number;
  employeeIds: number[];
  from: string;
  to: string;
}): Promise<FilialReport> {
  const qs = new URLSearchParams({
    branchId: String(input.branchId),
    from: input.from,
    to: input.to,
    employeeIds: input.employeeIds.join(","),
  });
  const res = await fetch(`/api/holat/filial-report?${qs}`, { credentials: "include" });
  return readJson<FilialReport>(res);
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
