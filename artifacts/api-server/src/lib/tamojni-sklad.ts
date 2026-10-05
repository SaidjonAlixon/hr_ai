import { eq } from "drizzle-orm";
import { db, departmentSitesTable } from "@workspace/db";
import { ensureDepartmentByName } from "./role-departments";
import { ensureDepartmentSitesSchema } from "./ensure-schema";

export const TAMOJNI_SKLAD_DEPARTMENT_NAME = "Tamojni sklad";
export const TAMOJNI_STAFF_ROLE = "tamojni";
export const TAMOJNI_HEAD_ROLE = "tamojni_rahbar";
export const TAMOJNI_DEFAULT_RADIUS_M = 10;

export function isTamojniRole(role?: string | null): boolean {
  const r = String(role || "").trim();
  return r === TAMOJNI_STAFF_ROLE || r === TAMOJNI_HEAD_ROLE;
}

/** Tamojni sklad xodimi faqat shu bo‘limni ko‘radi */
export function isTamojniDepartmentMember(
  row: {
    departmentId?: number | null;
    userRole?: string | null;
    departmentName?: string | null;
  },
  departmentId: number,
): boolean {
  if (row.departmentId != null && row.departmentId === departmentId) return true;
  if (isTamojniRole(row.userRole)) return true;
  const name = String(row.departmentName || "")
    .trim()
    .toLocaleLowerCase("uz");
  return name === TAMOJNI_SKLAD_DEPARTMENT_NAME.toLocaleLowerCase("uz");
}

export function canManageTamojni(role?: string | null): boolean {
  const r = String(role || "").trim();
  return (
    r === "admin" ||
    r === "director" ||
    r === "asoschi" ||
    r === "distrib_hr" ||
    r === "distrib_rahbar" ||
    r === TAMOJNI_HEAD_ROLE
  );
}

/** Bo‘lim boshlig‘i faqat xodim qo‘shadi. HR va rahbar boshliqni ham qo‘shadi. */
export function tamojniCreatableRoles(actorRole?: string | null): string[] {
  if (actorRole === TAMOJNI_HEAD_ROLE) return [TAMOJNI_STAFF_ROLE];
  if (canManageTamojni(actorRole)) return [TAMOJNI_STAFF_ROLE, TAMOJNI_HEAD_ROLE];
  return [];
}

export async function ensureTamojniSkladDepartmentId(): Promise<number> {
  await ensureDepartmentSitesSchema();
  return ensureDepartmentByName(TAMOJNI_SKLAD_DEPARTMENT_NAME);
}

export type TamojniSite = {
  departmentId: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
};

export async function getTamojniSite(): Promise<TamojniSite | null> {
  const departmentId = await ensureTamojniSkladDepartmentId();
  const [row] = await db
    .select()
    .from(departmentSitesTable)
    .where(eq(departmentSitesTable.departmentId, departmentId))
    .limit(1);
  if (!row) return null;
  if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return null;
  return {
    departmentId,
    name: row.name.trim() || TAMOJNI_SKLAD_DEPARTMENT_NAME,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusM: row.radiusM > 0 ? row.radiusM : TAMOJNI_DEFAULT_RADIUS_M,
  };
}
