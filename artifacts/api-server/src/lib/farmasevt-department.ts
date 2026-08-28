import { eq, sql } from "drizzle-orm";
import { db, departmentsTable } from "@workspace/db";

/** Mudir / farmasevt / stajyor uchun yagona bo‘lim nomi */
export const FARMASEVT_DEPARTMENT_NAME = "Farmasevt";

export const FARMASEVT_USER_ROLES = ["mudir", "farmasevt", "stajyor"] as const;

export function isFarmasevtDepartmentRole(role?: string | null): boolean {
  return !!role && (FARMASEVT_USER_ROLES as readonly string[]).includes(role);
}

/** «Farmasevt» bo‘limini topadi yoki yaratadi */
export async function ensureFarmasevtDepartmentId(): Promise<number> {
  const [existing] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, FARMASEVT_DEPARTMENT_NAME))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(departmentsTable)
    .values({ name: FARMASEVT_DEPARTMENT_NAME })
    .returning({ id: departmentsTable.id });
  if (created) return created.id;

  // Race: boshqa so‘rov yaratgan bo‘lishi mumkin
  const [again] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.name, FARMASEVT_DEPARTMENT_NAME))
    .limit(1);
  if (!again) throw new Error("Farmasevt bo‘limi yaratilmadi");
  return again.id;
}

/** Mavjud mudir/farmasevt/stajyor foydalanuvchi va xodimlarni «Farmasevt» bo‘limiga o‘tkazadi */
export async function syncFarmasevtDepartmentAssignments(_departmentId?: number): Promise<number> {
  const { syncAllRoleDepartmentAssignments, ensureDepartmentByName, FARMASEVT_DEPARTMENT_NAME } =
    await import("./role-departments");
  await syncAllRoleDepartmentAssignments();
  return ensureDepartmentByName(FARMASEVT_DEPARTMENT_NAME);
}
