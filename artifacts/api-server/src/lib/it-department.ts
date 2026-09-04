import { eq, sql } from "drizzle-orm";
import { db, departmentsTable } from "@workspace/db";

export const IT_DEPARTMENT_NAME = "AyTi";
export const IT_DEPARTMENT_LEGACY_NAME = "IT";

/** AyTi bo‘limidagi barcha foydalanuvchi rollari */
export const IT_USER_ROLES = ["it", "it_rahbar", "it_dasturchi", "it_tarmoq"] as const;

export function isItDeptRole(role?: string | null): boolean {
  return !!role && (IT_USER_ROLES as readonly string[]).includes(role);
}

export async function ensureItDepartmentId(): Promise<number> {
  const [existing] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, IT_DEPARTMENT_NAME))
    .limit(1);
  if (existing) return existing.id;

  const [legacy] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, IT_DEPARTMENT_LEGACY_NAME))
    .limit(1);
  if (legacy) {
    await db
      .update(departmentsTable)
      .set({ name: IT_DEPARTMENT_NAME })
      .where(eq(departmentsTable.id, legacy.id));
    return legacy.id;
  }

  const [created] = await db
    .insert(departmentsTable)
    .values({ name: IT_DEPARTMENT_NAME })
    .returning({ id: departmentsTable.id });
  if (created) return created.id;

  const [again] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, IT_DEPARTMENT_NAME))
    .limit(1);
  if (!again) throw new Error("AyTi bo‘limi yaratilmadi");
  return again.id;
}

export async function syncItDepartmentAssignments(): Promise<number> {
  const id = await ensureItDepartmentId();
  await db.execute(sql`
    UPDATE users SET department_id = ${id}
    WHERE role IN ('it', 'it_rahbar', 'it_dasturchi', 'it_tarmoq')
      AND department_id IS DISTINCT FROM ${id}
  `);
  await db.execute(sql`
    UPDATE employees e SET department_id = ${id}
    FROM users u
    WHERE e.user_id = u.id
      AND u.role IN ('it', 'it_rahbar', 'it_dasturchi', 'it_tarmoq')
      AND e.department_id IS DISTINCT FROM ${id}
  `);
  return id;
}
