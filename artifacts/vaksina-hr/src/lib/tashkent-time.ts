/** Platforma vaqti — faqat Asia/Tashkent (UTC+05, DST yo‘q). */

export const TASHKENT_TZ = "Asia/Tashkent";
export const TASHKENT_OFFSET = "+05:00";

export type TashkentParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const PARTS_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TASHKENT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function tashkentParts(input?: string | Date | null): TashkentParts {
  const d = input == null ? new Date() : input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    return tashkentParts(new Date());
  }
  const bag: Record<string, string> = {};
  for (const p of PARTS_FMT.formatToParts(d)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD` Toshkent kalendar sanasi */
export function tashkentYmd(input?: string | Date | null): string {
  const p = tashkentParts(input);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** datetime-local qiymati: `YYYY-MM-DDTHH:mm` (Toshkent devor soati) */
export function toTashkentInputValue(iso?: string | Date | null): string {
  const d = iso == null ? new Date() : iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = tashkentParts(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * datetime-local / `YYYY-MM-DDTHH:mm` ni Toshkent deb o‘qib UTC ISO qaytaradi.
 * Brauzer lokal zonasi ishlatilmaydi.
 */
export function fromTashkentInputValue(local: string): string | null {
  if (!local?.trim()) return null;
  const m = local.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}${TASHKENT_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Toshkent `YYYY-MM-DD` + soat/minut → UTC ISO */
export function tashkentWallToIso(ymd: string, hour: number, minute: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T${pad2(hour)}:${pad2(minute)}:00${TASHKENT_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Toshkent kun boshi / oxiri (UTC ISO) */
export function startOfTashkentDayIso(input?: string | Date | null): string {
  const ymd = typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : tashkentYmd(input);
  return `${ymd}T00:00:00.000${TASHKENT_OFFSET}`;
}

export function endOfTashkentDayIso(input?: string | Date | null): string {
  const ymd = typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : tashkentYmd(input);
  return `${ymd}T23:59:59.999${TASHKENT_OFFSET}`;
}

/** ISO → Toshkent HH:mm */
export function formatTashkentHm(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("uz-UZ", {
    timeZone: TASHKENT_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO → Toshkent sana+vaqt */
export function formatTashkentDt(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("uz-UZ", {
    timeZone: TASHKENT_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Bugun / kecha / sana (Toshkent) */
export function formatTashkentRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const ymd = tashkentYmd(d);
  const today = tashkentYmd();
  const yestDate = new Date(`${today}T12:00:00${TASHKENT_OFFSET}`);
  yestDate.setTime(yestDate.getTime() - 86_400_000);
  const yest = tashkentYmd(yestDate);
  const time = formatTashkentHm(d);
  if (ymd === today) return `Bugun, ${time}`;
  if (ymd === yest) return `Kecha, ${time}`;
  const p = tashkentParts(d);
  return `${pad2(p.day)}.${pad2(p.month)}.${p.year}, ${time}`;
}

/** `YYYY-MM-DDTHH:mm` ni qismlarga ajratadi (timezone yo‘q — Toshkent wall) */
export function parseTashkentInput(local: string): TashkentParts | null {
  const m = local?.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6] || 0),
  };
}

export function tashkentInputFromParts(p: Pick<TashkentParts, "year" | "month" | "day" | "hour" | "minute">): string {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Kalendar kunini Toshkent YMD qilib olish (DayPicker Date) */
export function calendarDayToTashkentYmd(day: Date): string {
  // DayPicker odatda mahalliy yarim tun beradi — faqat Y/M/D ni olamiz
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`;
}

export function addTashkentDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00${TASHKENT_OFFSET}`);
  d.setTime(d.getTime() + days * 86_400_000);
  return tashkentYmd(d);
}

/** 0=Yakshanba … 6=Shanba (Toshkent kalendar kuni) */
export function tashkentWeekday(ymd?: string): number {
  const day = ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : tashkentYmd();
  // Toshkent 12:00 = UTC 07:00 — xuddi shu kalendar kuni
  return new Date(`${day}T12:00:00${TASHKENT_OFFSET}`).getUTCDay();
}

/** DayPicker uchun mahalliy Date (faqat Y/M/D) */
export function tashkentYmdToCalendarDate(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}
