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

/** Ketdim: smena tugaganidan keyin 2 soat */
export const WAREHOUSE_CHECKOUT_GRACE_MS = 2 * 60 * 60 * 1000;
