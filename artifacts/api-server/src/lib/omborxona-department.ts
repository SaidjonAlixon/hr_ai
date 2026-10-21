import { ensureDepartmentByName } from "./role-departments";

export const OMBORXONA_DEPARTMENT_NAME = "Omborxona";

export const OMBOR_ROLES = new Set(["ombor", "ombor_rahbar"]);
export const OMBOR_HEAD_ROLES = new Set(["ombor_rahbar"]);

export function isOmborStaffRole(role?: string | null): boolean {
  return OMBOR_ROLES.has(String(role || "").trim());
}

export function isOmborHeadRole(role?: string | null): boolean {
  return OMBOR_HEAD_ROLES.has(String(role || "").trim());
}

export async function ensureOmborxonaDepartmentId(): Promise<number> {
  return ensureDepartmentByName(OMBORXONA_DEPARTMENT_NAME);
}

/**
 * Omborxona — ERKIN GRAFIK (smenasiz).
 * Keldim: ish kuni 08:00 dan.
 * Ketdim: keyingi kun 07:00 gacha (istalgan vaqtda yopish mumkin; muddatdan oldin
 * avtomatik yopilmaydi). Keyingi ish kuni yana 08:00 dan Keldim.
 * Jarima / kechikish / erta ketish izohi — yo‘q. Dam: faqat yakshanba.
 */
export const WAREHOUSE_FREE_START_HM = "08:00";
export const WAREHOUSE_FREE_END_HM = "07:00";
export const WAREHOUSE_FREE_LABEL = "Erkin grafik";
/** encodeWarehouseShiftType(08:00, 07:00, true) */
export const WAREHOUSE_FREE_SHIFT_TYPE = "wh:08:00-07:00:o";

/** Eski smenalar uchun: tugashdan +2 soat (faqat non-free / xavfsizlik) */
export const WAREHOUSE_CHECKOUT_GRACE_MS = 2 * 60 * 60 * 1000;

export function isWarehouseFreeShiftType(shiftType?: string | null): boolean {
  const t = String(shiftType || "").trim().toLowerCase();
  return t === WAREHOUSE_FREE_SHIFT_TYPE || t === "wh:08:00-07:00:o";
}
