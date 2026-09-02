import { eq, sql } from "drizzle-orm";
import { db, departmentsTable } from "@workspace/db";

export const FARMASEVT_DEPARTMENT_NAME = "Farmasevt";

export const PHARMACY_USER_ROLES = ["mudir", "farmasevt", "stajyor"] as const;

/** Rol → bo‘lim nomi. Faqat mudir/farmasevt/stajyor «Farmasevt» bo‘limida. */
export const ROLE_DEPARTMENT_NAME: Record<string, string> = {
  admin: "Rahbariyat",
  director: "Rahbariyat",
  asoschi: "Rahbariyat",
  moliya: "Rahbariyat",
  mudir: FARMASEVT_DEPARTMENT_NAME,
  farmasevt: FARMASEVT_DEPARTMENT_NAME,
  stajyor: FARMASEVT_DEPARTMENT_NAME,
  hr: "HR",
  hr_direktor: "HR",
  hr_menejer: "HR",
  hr_auditor: "HR",
  recruiter: "Rekruting",
  trainer: "Trening",
  mentor: "Trening",
  koordinator: "Koordinator",
  department_head: "Farmatsiya",
  it: "IT",
  it_rahbar: "IT",
  texnik: "Texnik",
  texnik_rahbar: "Texnik",
  revizor: "Reviziya",
  reviziya_rahbar: "Reviziya",
  sb: "Xavfsizlik",
  sb_boshliq: "Xavfsizlik",
  ombor: "Ombor",
};

export function departmentNameForRole(role?: string | null): string | null {
  if (!role) return null;
  return ROLE_DEPARTMENT_NAME[role] ?? null;
}

export async function ensureDepartmentByName(name: string): Promise<number> {
  const [existing] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, name))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(departmentsTable)
    .values({ name })
    .returning({ id: departmentsTable.id });
  if (created) return created.id;

  const [again] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, name))
    .limit(1);
  if (!again) throw new Error(`«${name}» bo‘limi yaratilmadi`);
  return again.id;
}

export async function resolveDepartmentIdForRole(role: string): Promise<number | null> {
  const name = departmentNameForRole(role);
  if (!name) return null;
  return ensureDepartmentByName(name);
}

/** Barcha rollarni o‘z bo‘limiga; faqat apteka tarmog‘i — Farmasevt. */
export async function syncAllRoleDepartmentAssignments(): Promise<void> {
  const farmId = await ensureDepartmentByName(FARMASEVT_DEPARTMENT_NAME);

  for (const [role, deptName] of Object.entries(ROLE_DEPARTMENT_NAME)) {
    if ((PHARMACY_USER_ROLES as readonly string[]).includes(role)) continue;
    const deptId = await ensureDepartmentByName(deptName);
    await db.execute(sql`
      UPDATE users
      SET department_id = ${deptId}
      WHERE role = ${role}
        AND department_id IS DISTINCT FROM ${deptId}
    `);
    await db.execute(sql`
      UPDATE employees e
      SET department_id = ${deptId}
      FROM users u
      WHERE e.user_id = u.id
        AND u.role = ${role}
        AND e.department_id IS DISTINCT FROM ${deptId}
    `);
  }

  await db.execute(sql`
    UPDATE users
    SET department_id = ${farmId}
    WHERE role IN ('mudir', 'farmasevt', 'stajyor')
      AND department_id IS DISTINCT FROM ${farmId}
  `);
  await db.execute(sql`
    UPDATE employees e
    SET department_id = ${farmId}
    FROM users u
    WHERE e.user_id = u.id
      AND u.role IN ('mudir', 'farmasevt', 'stajyor')
      AND e.department_id IS DISTINCT FROM ${farmId}
  `);
  await db.execute(sql`
    UPDATE employees
    SET department_id = ${farmId}
    WHERE org_role IN ('manager', 'pharmacist', 'intern')
      AND (
        user_id IS NULL
        OR user_id IN (SELECT id FROM users WHERE role IN ('mudir', 'farmasevt', 'stajyor'))
      )
      AND department_id IS DISTINCT FROM ${farmId}
  `);
}
