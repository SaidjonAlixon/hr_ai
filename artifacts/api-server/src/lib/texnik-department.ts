import { eq, sql } from "drizzle-orm";
import { db, departmentsTable } from "@workspace/db";

export const TEXNIK_DEPARTMENT_NAME = "Texnik";
export const TEXNIK_USER_ROLES = ["texnik", "texnik_rahbar"] as const;

export function isTexnikDeptRole(role?: string | null): boolean {
  return role === "texnik" || role === "texnik_rahbar";
}

export async function ensureTexnikDepartmentId(): Promise<number> {
  const [existing] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, TEXNIK_DEPARTMENT_NAME))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(departmentsTable).values({ name: TEXNIK_DEPARTMENT_NAME }).returning({ id: departmentsTable.id });
  if (created) return created.id;
  const [again] = await db.select({ id: departmentsTable.id }).from(departmentsTable).where(eq(departmentsTable.name, TEXNIK_DEPARTMENT_NAME)).limit(1);
  if (!again) throw new Error("Texnik bo‘limi yaratilmadi");
  return again.id;
}

export async function syncTexnikDepartmentAssignments(): Promise<number> {
  const id = await ensureTexnikDepartmentId();
  await db.execute(sql`
    UPDATE users SET department_id = ${id}
    WHERE role IN ('texnik', 'texnik_rahbar') AND department_id IS DISTINCT FROM ${id}
  `);
  await db.execute(sql`
    UPDATE employees e SET department_id = ${id}
    FROM users u WHERE e.user_id = u.id AND u.role IN ('texnik', 'texnik_rahbar') AND e.department_id IS DISTINCT FROM ${id}
  `);
  return id;
}
