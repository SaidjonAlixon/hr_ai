import { eq } from "drizzle-orm";
import { db, usersTable, departmentsTable } from "@workspace/db";
import {
  PHARMACY_USER_ROLES,
  ROLE_DEPARTMENT_NAME,
  departmentNameForRole,
  ensureDepartmentByName,
  resolveDepartmentIdForRole,
} from "./role-departments";

/** Bo‘lim rahbari — o‘z bo‘limiga xodim qo‘shadi (apteka tarmog‘i alohida). */
export const DEPT_HEAD_ROLES = [
  "department_head",
  "it_rahbar",
  "texnik_rahbar",
  "reviziya_rahbar",
  "sb_boshliq",
  "hr_direktor",
  "hr_kadr_rahbar",
  "hr_menejer",
] as const;

const NAMED_HEAD_CREATABLE: Record<string, readonly string[]> = {
  it_rahbar: ["it_rahbar", "it", "it_dasturchi", "it_tarmoq"],
  texnik_rahbar: ["texnik"],
  reviziya_rahbar: ["revizor"],
  sb_boshliq: ["sb"],
  hr_direktor: ["hr", "hr_menejer", "hr_kadr_rahbar", "hr_auditor", "recruiter", "trainer", "mentor"],
  hr_kadr_rahbar: ["hr", "hr_menejer", "hr_auditor", "recruiter", "trainer", "mentor"],
  hr_menejer: ["hr", "recruiter", "trainer", "mentor"],
};

const RAHBAR_SUFFIX = /_rahbar$|^sb_boshliq$|^department_head$|^hr_direktor$|^hr_menejer$/;

const BLOCKED_STAFF_ROLES = new Set([
  "admin",
  "director",
  "asoschi",
  "koordinator",
  "mudir",
  "farmasevt",
  "stajyor",
  "moliya",
  ...PHARMACY_USER_ROLES,
  ...DEPT_HEAD_ROLES,
]);

export const ROLE_LABEL_UZ: Record<string, string> = {
  hr: "HR",
  hr_menejer: "HR Menejer",
  hr_kadr_rahbar: "HR kadr b/m",
  hr_auditor: "HR Auditor",
  recruiter: "Rekruter",
  trainer: "Trener",
  mentor: "Mentor",
  it_rahbar: "AyTi bo‘lim boshlig‘i",
  it: "AyTi mutaxassisi",
  it_dasturchi: "Dasturchi",
  it_tarmoq: "Tarmoq administratori",
  texnik: "Texnik",
  revizor: "Revizor-yig‘uvchi",
  sb: "SB operatori",
  ombor: "Ombor",
};

export function isDeptHeadRole(role?: string | null): boolean {
  return !!role && (DEPT_HEAD_ROLES as readonly string[]).includes(role);
}

export function canAddDeptStaff(role?: string | null): boolean {
  return isDeptHeadRole(role);
}

function creatableRolesForDepartmentName(deptName: string): string[] {
  const roles: string[] = [];
  for (const [role, name] of Object.entries(ROLE_DEPARTMENT_NAME)) {
    if (name !== deptName) continue;
    if (BLOCKED_STAFF_ROLES.has(role)) continue;
    if (RAHBAR_SUFFIX.test(role)) continue;
    roles.push(role);
  }
  return [...new Set(roles)].sort();
}

export async function resolveDeptHeadContext(userId: number, role: string): Promise<{
  departmentId: number;
  departmentName: string;
  creatableRoles: string[];
} | null> {
  if (!isDeptHeadRole(role)) return null;

  const [actor] = await db
    .select({
      departmentId: usersTable.departmentId,
      departmentName: departmentsTable.name,
    })
    .from(usersTable)
    .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
    .where(eq(usersTable.id, userId));

  let departmentName =
    actor?.departmentName?.trim() || departmentNameForRole(role) || null;
  if (!departmentName) return null;

  let departmentId = actor?.departmentId ?? null;

  if (role === "it_rahbar" || departmentName === "IT") {
    const { ensureItDepartmentId, IT_DEPARTMENT_NAME } = await import("./it-department");
    const itId = await ensureItDepartmentId();
    departmentName = IT_DEPARTMENT_NAME;
    departmentId = itId;
  }

  if (!departmentId) {
    departmentId = await ensureDepartmentByName(departmentName);
  }

  const named = NAMED_HEAD_CREATABLE[role];
  const creatableRoles = named?.length
    ? [...named]
    : creatableRolesForDepartmentName(departmentName);

  if (!creatableRoles.length) return null;

  return { departmentId, departmentName, creatableRoles };
}

export async function assertCanCreateDeptStaff(
  actorUserId: number,
  actorRole: string,
  targetRole: string,
): Promise<{ departmentId: number; departmentName: string } | { error: string; status: number }> {
  const ctx = await resolveDeptHeadContext(actorUserId, actorRole);
  if (!ctx) {
    return { error: "Bo‘lim rahbari konteksti topilmadi", status: 403 };
  }
  if (!ctx.creatableRoles.includes(targetRole)) {
    return { error: "Bu rolni qo‘shishga ruxsat yo‘q", status: 403 };
  }
  const expectedDept = departmentNameForRole(targetRole);
  if (expectedDept && expectedDept !== ctx.departmentName) {
    return { error: "Rol boshqa bo‘limga tegishli", status: 400 };
  }
  return { departmentId: ctx.departmentId, departmentName: ctx.departmentName };
}

export async function getActorDepartmentId(userId: number): Promise<number | null> {
  const [row] = await db
    .select({ departmentId: usersTable.departmentId })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return row?.departmentId ?? null;
}
