/**
 * Ofis xodimlari: shanba–yakshanba dam kuni (UI / vazifa muddati).
 * Dorixona xodimlariga tegmaydi.
 */

export function weekdayFromYmd(ymd: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return -1;
  return new Date(`${ymd}T12:00:00+05:00`).getDay();
}

/** Shanba yoki yakshanba */
export function isWeekendYmd(ymd: string): boolean {
  const wd = weekdayFromYmd(ymd);
  return wd === 0 || wd === 6;
}

export function isOfisWorkplace(workplace?: string | null): boolean {
  return (workplace || "ofis") === "ofis";
}
