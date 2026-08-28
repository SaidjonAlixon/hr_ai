import { eq, sql } from "drizzle-orm";
import { db, departmentsTable } from "@workspace/db";

export const MOLIYA_DEPARTMENT_NAME = "Moliya";

export function isMoliyaRole(role?: string | null): boolean {
  return role === "moliya";
}

export async function ensureMoliyaDepartmentId(): Promise<number> {
  const [existing] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, MOLIYA_DEPARTMENT_NAME))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(departmentsTable)
    .values({ name: MOLIYA_DEPARTMENT_NAME })
    .returning({ id: departmentsTable.id });
  if (created) return created.id;

  const [again] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, MOLIYA_DEPARTMENT_NAME))
    .limit(1);
  if (!again) throw new Error("Moliya bo‘limi yaratilmadi");
  return again.id;
}

export async function syncMoliyaDepartmentAssignments(departmentId?: number): Promise<number> {
  const { syncRahbariyatDepartmentAssignments } = await import("./rahbariyat-department");
  return syncRahbariyatDepartmentAssignments(departmentId);
}
