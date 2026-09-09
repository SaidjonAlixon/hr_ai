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
  "distrib_rahbar",
  "distrib_hr",
  "moliya_rahbar",
  "taminot_rahbar",
  "rivojlantirish_rahbar",
  "mamuriy_rahbar",
  "gpp_rahbar",
  "ombor_rahbar",
  "oshpaz_rahbar",
  "marketing_rahbar",
] as const;

const NAMED_HEAD_CREATABLE: Record<string, readonly string[]> = {
  it_rahbar: ["it_rahbar", "it", "it_dasturchi", "it_tarmoq"],
  texnik_rahbar: ["texnik"],
  reviziya_rahbar: ["revizor"],
  sb_boshliq: ["sb"],
  hr_direktor: ["hr", "hr_menejer", "hr_kadr_rahbar", "hr_auditor", "recruiter", "trainer", "mentor"],
  hr_kadr_rahbar: ["hr", "hr_menejer", "hr_auditor", "recruiter", "trainer", "mentor"],
  hr_menejer: ["hr", "recruiter", "trainer", "mentor"],
  distrib_rahbar: ["distrib", "distrib_hr"],
  distrib_hr: ["distrib"],
  moliya_rahbar: ["moliya_xodim"],
  taminot_rahbar: ["taminot"],
  rivojlantirish_rahbar: ["rivojlantirish"],
  mamuriy_rahbar: ["mamuriy"],
  gpp_rahbar: ["gpp"],
  ombor_rahbar: ["ombor"],
  oshpaz_rahbar: ["oshpaz"],
  marketing_rahbar: ["marketing"],
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
  ombor: "Omborxona xodimi",
  ombor_rahbar: "Omborxona bo‘lim boshlig‘i",
  distrib: "Distribyutsiya xodimi",
  distrib_hr: "Distribyutsiya HR",
  distrib_rahbar: "Distribyutsiya rahbari",
  moliya_rahbar: "Moliya bo‘lim boshlig‘i",
  moliya_xodim: "Moliya xodimi",
  taminot_rahbar: "Ta’minot bo‘lim boshlig‘i",
  taminot: "Ta’minot xodimi",
  rivojlantirish_rahbar: "Rivojlantirish bo‘lim boshlig‘i",
  rivojlantirish: "Rivojlantirish xodimi",
  mamuriy_rahbar: "Ma’muriy-xo‘jalik bo‘lim boshlig‘i",
  mamuriy: "Ma’muriy-xo‘jalik xodimi",
  gpp_rahbar: "GPP bo‘lim boshlig‘i",
  gpp: "GPP xodimi",
  oshpaz_rahbar: "Oshpaz bo‘lim boshlig‘i",
  oshpaz: "Oshpaz",
  marketing_rahbar: "Marketing bo‘lim boshlig‘i",
  marketing: "Marketing xodimi",
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

  // Profil bo‘limi nom/ID bilan moslashmagan bo‘lsa — tuzatamiz
  if (departmentId && actor?.departmentId !== departmentId) {
    await db.update(usersTable).set({ departmentId }).where(eq(usersTable.id, userId));
  }

  const named = NAMED_HEAD_CREATABLE[role];
  const creatableRoles = named?.length
    ? [...named]
    : creatableRolesForDepartmentName(departmentName);

  // Excel/eksport uchun bo‘lim kerak; creatable bo‘sh bo‘lsa ham kontekst qaytadi
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
