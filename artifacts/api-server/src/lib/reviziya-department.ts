import { eq, sql } from "drizzle-orm";
import { db, departmentsTable } from "@workspace/db";

export const REVIZIYA_DEPARTMENT_NAME = "Reviziya";

export const REVIZIYA_USER_ROLES = ["revizor", "reviziya_rahbar"] as const;

export function isReviziyaDeptRole(role?: string | null): boolean {
  return role === "revizor" || role === "reviziya_rahbar";
}

export async function ensureReviziyaDepartmentId(): Promise<number> {
  const [existing] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, REVIZIYA_DEPARTMENT_NAME))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(departmentsTable)
    .values({ name: REVIZIYA_DEPARTMENT_NAME })
    .returning({ id: departmentsTable.id });
  if (created) return created.id;

  const [again] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, REVIZIYA_DEPARTMENT_NAME))
    .limit(1);
  if (!again) throw new Error("Reviziya bo‘limi yaratilmadi");
  return again.id;
}

export async function syncReviziyaDepartmentAssignments(departmentId?: number): Promise<number> {
  const revId = departmentId ?? (await ensureReviziyaDepartmentId());
  await db.execute(sql`
    UPDATE users
    SET department_id = ${revId}
    WHERE role IN ('revizor', 'reviziya_rahbar')
      AND department_id IS DISTINCT FROM ${revId}
  `);
  await db.execute(sql`
    UPDATE employees e
    SET department_id = ${revId}
    FROM users u
    WHERE e.user_id = u.id
      AND u.role IN ('revizor', 'reviziya_rahbar')
      AND e.department_id IS DISTINCT FROM ${revId}
  `);
  await db.execute(sql`
    INSERT INTO users (full_name, role, login, password, status, department_id)
    SELECT 'Demo Revizor-yig''uvchi', 'revizor', 'revizor1', 'pass123', 'active', ${revId}
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE login = 'revizor1')
  `);
  await db.execute(sql`
    INSERT INTO users (full_name, role, login, password, status, department_id)
    SELECT 'Demo Reviziya rahbari', 'reviziya_rahbar', 'reviziya_rahbar1', 'pass123', 'active', ${revId}
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE login = 'reviziya_rahbar1')
  `);
  return revId;
}
