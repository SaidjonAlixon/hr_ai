import { eq } from "drizzle-orm";
import { db, departmentsTable } from "@workspace/db";
import { FARMASEVT_DEPARTMENT_NAME } from "./role-departments";
import { orgRoleFromUserRole } from "./shift-hours";

export type DepartmentFilterMatch = {
  departmentId: number;
  departmentName: string;
  userRoles: Set<string>;
  orgRoles: Set<string>;
};

/** Bo‘lim nomi bo‘yicha rol/org_role bilan ham moslashtirish (masalan Koordinator bo‘limi). */
const DEPARTMENT_ROLE_ALIASES: Record<string, { userRoles: string[]; orgRoles: string[] }> = {
  Koordinator: { userRoles: ["koordinator"], orgRoles: ["coordinator"] },
  [FARMASEVT_DEPARTMENT_NAME]: {
    userRoles: ["mudir", "farmasevt", "stajyor"],
    orgRoles: ["manager", "pharmacist", "intern"],
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
  return {
    departmentId: dept.id,
    departmentName: dept.name,
    userRoles: new Set(alias?.userRoles ?? []),
    orgRoles: new Set(alias?.orgRoles ?? []),
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
  if (emp.departmentId === filter.departmentId) return true;
  if (filter.userRoles.has(emp.userRole || "")) return true;
  const org = emp.orgRole || orgRoleFromUserRole(emp.userRole);
  if (org && filter.orgRoles.has(org)) return true;
  return false;
}
