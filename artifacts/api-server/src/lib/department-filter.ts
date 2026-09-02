import { eq } from "drizzle-orm";
import { db, departmentsTable } from "@workspace/db";
import { FARMASEVT_DEPARTMENT_NAME } from "./role-departments";
import { orgRoleFromUserRole } from "./shift-hours";

export type DepartmentFilterMatch = {
  departmentId: number;
  departmentName: string;
  userRoles: Set<string>;
  orgRoles: Set<string>;
  excludeUserRoles: Set<string>;
  excludeOrgRoles: Set<string>;
};

/** Bo‘lim nomi bo‘yicha rol/org_role bilan ham moslashtirish (masalan Koordinator bo‘limi). */
const DEPARTMENT_ROLE_ALIASES: Record<string, { userRoles: string[]; orgRoles: string[] }> = {
  Koordinator: { userRoles: ["koordinator"], orgRoles: ["coordinator"] },
  Mudir: { userRoles: ["mudir"], orgRoles: ["manager"] },
  [FARMASEVT_DEPARTMENT_NAME]: {
    userRoles: ["mudir", "farmasevt", "stajyor"],
    orgRoles: ["manager", "pharmacist", "intern"],
  },
};

/** Bo‘limda ko‘rinmasligi kerak bo‘lgan rollar (masalan Farmatsiyada koordinator yo‘q). */
const DEPARTMENT_ROLE_EXCLUDE: Record<string, { userRoles: string[]; orgRoles: string[] }> = {
  Farmatsiya: {
    userRoles: ["koordinator", "mudir"],
    orgRoles: ["coordinator", "manager"],
  },
};

export async function resolveDepartmentFilter(
  departmentId: string,
): Promise<DepartmentFilterMatch | null> {
  const id = Number(departmentId);
  if (!Number.isFinite(id)) return null;

  const [dept] = await db
    .select({ id: departmentsTable.id, name: departmentsTable.name })
    .from(departmentsTable)
    .where(eq(departmentsTable.id, id))
    .limit(1);
  if (!dept) return null;

  const alias = DEPARTMENT_ROLE_ALIASES[dept.name];
  const exclude = DEPARTMENT_ROLE_EXCLUDE[dept.name];
  return {
    departmentId: dept.id,
    departmentName: dept.name,
    userRoles: new Set(alias?.userRoles ?? []),
    orgRoles: new Set(alias?.orgRoles ?? []),
    excludeUserRoles: new Set(exclude?.userRoles ?? []),
    excludeOrgRoles: new Set(exclude?.orgRoles ?? []),
  };
}

export function matchesDepartmentFilter(
  emp: {
    departmentId: number;
    userRole?: string | null;
    orgRole?: string | null;
  },
  filter: DepartmentFilterMatch,
): boolean {
  const org = emp.orgRole || orgRoleFromUserRole(emp.userRole);
  if (filter.excludeUserRoles.has(emp.userRole || "")) return false;
  if (org && filter.excludeOrgRoles.has(org)) return false;

  if (filter.userRoles.size > 0 || filter.orgRoles.size > 0) {
    if (filter.userRoles.has(emp.userRole || "")) return true;
    if (org && filter.orgRoles.has(org)) return true;
    return false;
  }

  return emp.departmentId === filter.departmentId;
}
