export type PayGrain = "kun" | "hafta" | "oy";

export type JarimaEvent = {
  date: string;
  kind: "late" | "absent";
  n: number;
  amount: number;
};

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const WEEKDAYS = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthEnd(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}

export function todayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

export function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function clampToMonth(month: string, ymd: string): string {
  const start = `${month}-01`;
  const end = monthEnd(month);
  if (ymd < start) return start;
  if (ymd > end) return end;
  return ymd;
}

export function formatDayUz(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${d} ${MONTHS[m - 1]}, ${WEEKDAYS[wd]}`;
}

export function formatShortUz(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export type PayWeek = { from: string; to: string; days: number; label: string };

/** Dushanbadan boshlanadi. Oy chetida qisqa hafta qoladi. */
export function weeksOfMonth(month: string): PayWeek[] {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const weeks: PayWeek[] = [];
  let cursor = start;
  while (cursor <= end) {
    const [y, m, d] = cursor.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const untilSunday = wd === 0 ? 0 : 7 - wd;
    let to = addDays(cursor, untilSunday);
    if (to > end) to = end;
    const days = Number(to.slice(8, 10)) - Number(cursor.slice(8, 10)) + 1;
    weeks.push({
      from: cursor,
      to,
      days,
      label: cursor === to ? formatShortUz(cursor) : `${formatShortUz(cursor)} – ${formatShortUz(to)}`,
    });
    cursor = addDays(to, 1);
  }
  return weeks;
}

/** Oylik oyning har kuniga teng. Qoldiq so‘m oxirgi kunlarga, yig‘indi oylikka teng. */
export function salaryOnDates(salary: number, month: string, dates: string[]): number {
  const total = Math.max(0, Math.round(Number(salary) || 0));
  const n = daysInMonth(month);
  if (total <= 0 || n <= 0) return 0;
  const base = Math.floor(total / n);
  const rem = total - base * n;
  let sum = 0;
  for (const date of dates) {
    if (!date.startsWith(`${month}-`)) continue;
    const day = Number(date.slice(8, 10));
    if (day < 1 || day > n) continue;
    sum += base + (day > n - rem ? 1 : 0);
  }
  return sum;
}

export function datesFromTo(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to && out.length < 40) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function jarimaInRange(events: JarimaEvent[] | undefined, from: string, to: string) {
  const hits = (events ?? []).filter((event) => event.date >= from && event.date <= to);
  const late = hits.filter((event) => event.kind === "late").length;
  const absent = hits.length - late;
  const amount = hits.reduce((sum, event) => sum + Math.round(event.amount || 0), 0);
  return { hits, late, absent, amount };
}

export function periodNote(hits: JarimaEvent[], grain: PayGrain): string {
  if (!hits.length) return grain === "oy" ? "" : "Jarima yo‘q";
  if (grain === "kun") {
    const hit = hits[0];
    const reason = hit.kind === "late" ? "Kech kelindi" : "Kelmagansiz";
    return `${hit.n}-marta · ${reason}`;
  }
  const late = hits.filter((event) => event.kind === "late").length;
  const absent = hits.length - late;
  const parts: string[] = [];
  if (late === 1) parts.push("Kech kelindi");
  else if (late > 1) parts.push(`${late} marta kech kelindi`);
  if (absent === 1) parts.push("Kelmagansiz");
  else if (absent > 1) parts.push(`${absent} marta kelmagansiz`);
  return parts.join(". ");
}

export type ReturnedDay = { date: string; salary: number; jarima: number };

export type DaySheet = {
  day: string;
  salary: number | null;
  jarima: number | null;
  note: string | null;
  manual: boolean;
  status: "draft" | "approved" | "returned";
  publishedSalary: number | null;
  publishedJarima: number | null;
  publishedNote: string | null;
};

export type PayrollSlice = {
  salary: number;
  jarima: number;
  note: string;
  readOnly: boolean;
  editSalary: boolean;
  editJarima: boolean;
  editNote: boolean;
  returned: boolean;
  returnedLabel: string;
  dirty: boolean;
  dayStatus: "draft" | "approved" | "returned" | "summary";
  net: number;
};

export function resolveDay(
  row: { salary?: number; jarimaEvents?: JarimaEvent[]; daySheets?: DaySheet[] },
  month: string,
  date: string,
) {
  const share = salaryOnDates(row.salary ?? 0, month, [date]);
  const event = (row.jarimaEvents ?? []).find((item) => item.date === date);
  const sheet = (row.daySheets ?? []).find((item) => item.day === date);
  const returnedUntouched = sheet?.status === "returned" && (sheet.jarima ?? 0) === 0 && ((sheet.note || "").startsWith("Qaytarilgan") || (sheet.note || "").startsWith("Bekor qilingan"));
  if (returnedUntouched && sheet) {
    return {
      salary: sheet.salary ?? share,
      jarima: 0,
      note: sheet.note || "Bekor qilingan · jarima 0",
      status: "returned" as const,
      dirty: false,
    };
  }
  const salary = sheet?.manual && sheet.salary != null ? sheet.salary : share;
  const jarima = sheet?.manual && sheet.jarima != null ? sheet.jarima : Math.max(0, Math.round(event?.amount || 0));
  const note = sheet?.manual ? (sheet.note || "") : periodNote(event ? [event] : [], "kun");
  const status = sheet?.status === "approved" || sheet?.status === "returned" ? sheet.status : "draft" as const;
  const dirty = (status === "approved" || status === "returned") && sheet != null && (
    salary !== (sheet.publishedSalary ?? salary)
    || jarima !== (sheet.publishedJarima ?? jarima)
    || (note || "") !== (sheet.publishedNote || "")
  );
  return { salary, jarima, note: note === "Jarima yo‘q" ? "" : note, status, dirty };
}

const WEEKDAY_SHORT = ["Ya", "Du", "Se", "Cho", "Pa", "Ju", "Sha"];

export function weekdayShort(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || "";
}

export function projectPayroll(
  row: { salary?: number; jarima?: number; jarimaNote?: string | null; jarimaEvents?: JarimaEvent[]; daySheets?: DaySheet[] },
  month: string,
  grain: PayGrain,
  from: string,
  to: string,
): PayrollSlice {
  if (grain === "kun") {
    const day = resolveDay(row, month, from);
    return {
      salary: day.salary,
      jarima: day.jarima,
      note: day.note,
      readOnly: false,
      editSalary: true,
      editJarima: true,
      editNote: true,
      returned: day.status === "returned",
      returnedLabel: "",
      dirty: day.dirty,
      dayStatus: day.status,
      net: day.salary - day.jarima,
    };
  }
  const dates = datesFromTo(from, to);
  let salary = 0;
  let jarima = 0;
  let approved = 0;
  let returned = 0;
  let waiting = 0;
  for (const date of dates) {
    const day = resolveDay(row, month, date);
    if (grain === "oy") {
      salary += day.salary;
    }
    jarima += day.jarima;
    if (day.status === "approved") approved += 1;
    else if (day.status === "returned") returned += 1;
    else waiting += 1;
  }
  if (grain === "hafta") salary = dates.reduce((sum, date) => sum + resolveDay(row, month, date).salary, 0);
  const fiksa = Math.round(Number(row.salary) || 0);
  const shownSalary = grain === "oy" ? fiksa : salary;
  return {
    salary: shownSalary,
    jarima,
    note: "",
    readOnly: true,
    editSalary: grain === "oy",
    editJarima: false,
    editNote: false,
    returned: false,
    returnedLabel: `${approved} tasdiq · ${returned} qaytarilgan · ${waiting} kutilmoqda`,
    dirty: false,
    dayStatus: "summary",
    net: shownSalary - jarima,
  };
}
