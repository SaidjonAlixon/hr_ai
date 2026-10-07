import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, departmentSitesTable, employeesTable, usersTable } from "@workspace/db";
import { ensureDepartmentByName } from "./role-departments";
import { ensureDepartmentSitesSchema } from "./ensure-schema";

export const TAMOJNI_SKLAD_DEPARTMENT_NAME = "Tamojni sklad";
export const TAMOJNI_STAFF_ROLE = "tamojni";
export const TAMOJNI_HEAD_ROLE = "tamojni_rahbar";
export const TAMOJNI_DEFAULT_RADIUS_M = 150;

export function isTamojniRole(role?: string | null): boolean {
  const r = String(role || "").trim();
  return r === TAMOJNI_STAFF_ROLE || r === TAMOJNI_HEAD_ROLE;
}

export function isTamojniOrDistribRole(role?: string | null): boolean {
  const r = String(role || "").trim();
  return (
    r === TAMOJNI_STAFF_ROLE ||
    r === TAMOJNI_HEAD_ROLE ||
    r === "distrib" ||
    r === "distrib_hr" ||
    r === "distrib_rahbar"
  );
}

/** Tamojni sklad yoki Distribyutsiya a'zosi/rahbari ekanligini aniqlash */
export function isTamojniOrDistribMember(
  row: {
    departmentId?: number | null;
    userRole?: string | null;
    departmentName?: string | null;
    orgRole?: string | null;
    location?: string | null;
  },
  tamojniDeptId?: number | null,
): boolean {
  if (isTamojniOrDistribRole(row.userRole) || isTamojniOrDistribRole(row.orgRole)) return true;
  if (tamojniDeptId != null && row.departmentId === tamojniDeptId) return true;
  const name = String(row.departmentName || row.location || "")
    .trim()
    .toLocaleLowerCase("uz");
  return (
    name === TAMOJNI_SKLAD_DEPARTMENT_NAME.toLocaleLowerCase("uz") ||
    name === "tamojni sklad" ||
    name === "distribyutsiya" ||
    name.includes("tamojni") ||
    name.includes("дистриб")
  );
}

export type DavomatSiteChoice = "office" | "tamojni";

export function normalizeDavomatSite(raw: unknown): DavomatSiteChoice | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "office" || s === "ofis" || s === "asosiy_ofis") return "office";
  if (s === "tamojni" || s === "tamojni_sklad") return "tamojni";
  return null;
}

/**
 * Distribyutsiya / Tamojni xodimining davomat joyi.
 * HR yoki Admin tanlagan joy (employees.davomat_site) ustun; tanlanmagan bo‘lsa — Tamojni sklad.
 * null — xodim bu guruhga kirmaydi (oddiy davomat qoidalari).
 */
export function resolveDistribDavomatSite(
  row: {
    davomatSite?: string | null;
    departmentId?: number | null;
    userRole?: string | null;
    departmentName?: string | null;
    orgRole?: string | null;
    location?: string | null;
  },
  tamojniDeptId?: number | null,
): DavomatSiteChoice | null {
  const member =
    isTamojniRole(row.userRole) || isTamojniRole(row.orgRole) || isTamojniOrDistribMember(row, tamojniDeptId);
  if (!member) return null;
  return normalizeDavomatSite(row.davomatSite) ?? "tamojni";
}

export async function davomatSiteForEmployee(employeeId: number): Promise<string | null> {
  const [row] = await db
    .select({ davomatSite: employeesTable.davomatSite })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId))
    .limit(1)
    .catch(() => [] as Array<{ davomatSite: string | null }>);
  return row?.davomatSite ?? null;
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
    r === "hr" ||
    r === "hr_menejer" ||
    r === "hr_direktor" ||
    r === "hr_kadr_rahbar" ||
    r === "distrib_hr" ||
    r === "distrib_rahbar" ||
    r === TAMOJNI_HEAD_ROLE
  );
}

/** Bo‘lim boshlig‘i xodim qo‘sha olmaydi — smena va joyni boshqaradi. HR va rahbarlar xodim/boshliq qo‘shadi. */
export function tamojniCreatableRoles(actorRole?: string | null): string[] {
  if (actorRole === TAMOJNI_HEAD_ROLE) return [];
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

  const effectiveRadius = Math.max(row.radiusM || 0, TAMOJNI_DEFAULT_RADIUS_M);
  if (row.radiusM !== effectiveRadius) {
    await db
      .update(departmentSitesTable)
      .set({ radiusM: effectiveRadius, updatedAt: new Date() })
      .where(eq(departmentSitesTable.id, row.id))
      .catch(() => undefined);
  }

  return {
    departmentId,
    name: row.name.trim() || TAMOJNI_SKLAD_DEPARTMENT_NAME,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusM: effectiveRadius,
  };
}

/**
 * Barcha Tamojni sklad xodimlarini bazadagi Asosiy ofisdan to'liq ajratib,
 * faqat Tamojni sklad joyiga va uning GPS koordinatasiga bog'laydi.
 */
export async function syncTamojniEmployeesWithSite(site?: TamojniSite | null): Promise<void> {
  try {
    const departmentId = await ensureTamojniSkladDepartmentId();
    const actualSite = site || (await getTamojniSite());

    // 1. usersTable da tamojni / tamojni_rahbar bo'lganlarning departmentId sini tekshirish va to'g'rilash
    await db
      .update(usersTable)
      .set({ departmentId, updatedAt: new Date() })
      .where(
        and(
          inArray(usersTable.role, [TAMOJNI_STAFF_ROLE, TAMOJNI_HEAD_ROLE]),
          or(isNull(usersTable.departmentId), sql`${usersTable.departmentId} != ${departmentId}`),
        ),
      )
      .catch(() => undefined);

    // 2. employeesTable da shu xodimlarning location, latitude, longitude sini Tamojni sklad qilib qo'yish
    const tamojniUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        or(
          inArray(usersTable.role, [TAMOJNI_STAFF_ROLE, TAMOJNI_HEAD_ROLE]),
          eq(usersTable.departmentId, departmentId),
        ),
      );

    const userIds = tamojniUsers.map((u) => u.id).filter(Boolean);
    if (userIds.length > 0) {
      await db
        .update(employeesTable)
        .set({
          departmentId,
          location: actualSite?.name || TAMOJNI_SKLAD_DEPARTMENT_NAME,
          latitude: actualSite?.latitude ?? null,
          longitude: actualSite?.longitude ?? null,
          assignedBranchId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(employeesTable.userId, userIds),
            or(isNull(employeesTable.davomatSite), sql`${employeesTable.davomatSite} <> 'office'`),
          ),
        )
        .catch(() => undefined);
    }
  } catch (err) {
    console.error("syncTamojniEmployeesWithSite error:", err);
  }
}
