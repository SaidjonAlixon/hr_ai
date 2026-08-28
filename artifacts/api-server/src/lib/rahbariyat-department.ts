import { eq, sql } from "drizzle-orm";
import { db, departmentsTable } from "@workspace/db";

export const RAHBARIYAT_DEPARTMENT_NAME = "Rahbariyat";

export const RAHBARIYAT_USER_ROLES = ["director", "moliya", "asoschi"] as const;

export function isRahbariyatRole(role?: string | null): boolean {
  return !!role && (RAHBARIYAT_USER_ROLES as readonly string[]).includes(role);
}

export async function ensureRahbariyatDepartmentId(): Promise<number> {
  const [existing] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, RAHBARIYAT_DEPARTMENT_NAME))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(departmentsTable)
    .values({ name: RAHBARIYAT_DEPARTMENT_NAME })
    .returning({ id: departmentsTable.id });
  if (created) return created.id;

  const [again] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, RAHBARIYAT_DEPARTMENT_NAME))
    .limit(1);
  if (!again) throw new Error("Rahbariyat bo‘limi yaratilmadi");
  return again.id;
}

/** Direktor, asoschi va moliya — «Rahbariyat» bo‘limida */
export async function syncRahbariyatDepartmentAssignments(departmentId?: number): Promise<number> {
  const rahId = departmentId ?? (await ensureRahbariyatDepartmentId());

  await db.execute(sql`
    UPDATE users
    SET department_id = ${rahId}
    WHERE role IN ('director', 'moliya', 'asoschi')
      AND department_id IS DISTINCT FROM ${rahId}
  `);

  await db.execute(sql`
    UPDATE employees e
    SET department_id = ${rahId}
    FROM users u
    WHERE e.user_id = u.id
      AND u.role IN ('director', 'moliya', 'asoschi')
      AND e.department_id IS DISTINCT FROM ${rahId}
  `);

  await db.execute(sql`
    UPDATE employees
    SET department_id = ${rahId}
    WHERE department_id IS DISTINCT FROM ${rahId}
      AND (
        lower(position) LIKE '%asoschi%'
        OR lower(position) LIKE '%tasischi%'
        OR lower(position) LIKE '%ta''sischi%'
        OR lower(position) LIKE '%ta’sischi%'
        OR lower(full_name) LIKE '%asoschi%'
      )
  `);

  return rahId;
}
