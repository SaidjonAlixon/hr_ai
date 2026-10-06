/**
 * Cheklist holati (dashboard, tashriflar, qamrov, reyting, vaqt) shu sanadan boshlab ko‘rsatiladi.
 * Eski yozuvlar bazada qoladi — oylik/KPI hisobiga ta’sir qilmaydi.
 */
export const CHECKLIST_EPOCH = "2026-10-01";

/** `from` sanasini epoch dan oldin bo‘lmaydigan qilib qaytaradi (YYYY-MM-DD). */
export function checklistFrom(from?: string | null): string {
  const f = String(from || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(f) && f > CHECKLIST_EPOCH ? f : CHECKLIST_EPOCH;
}

export function isOnOrAfterChecklistEpoch(ymd: string | null | undefined): boolean {
  return String(ymd || "") >= CHECKLIST_EPOCH;
}
