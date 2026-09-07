import { and, asc, eq } from "drizzle-orm";
import { db, departmentsTable, departmentJobTitlesTable } from "@workspace/db";
import { ensureDepartmentByName } from "./role-departments";

export const DISTRIBYUTSIYA_DEPARTMENT_NAME = "Distribyutsiya";

/** Boshlang‘ich lavozimlar — keyin UI dan qo‘shish/tahrirlash mumkin */
export const DISTRIBYUTSIYA_DEFAULT_TITLES = [
  "HRG",
  "CCO",
  "Vakolatxona rahbari",
  "Broker",
  "Operator",
  "Kilto",
  "Tashqi iqtisodiy faoliyat (TIF)",
  "Almir",
  "Sotuvchi-buxgalter / Realizatsiya buxgalteri",
  "Ombor mudiri",
  "Yig‘uvchi / Komplektlovchi",
  "Haydovchi",
] as const;

export async function ensureDistribyutsiyaDepartmentId(): Promise<number> {
  return ensureDepartmentByName(DISTRIBYUTSIYA_DEPARTMENT_NAME);
}

export async function seedDistribyutsiyaJobTitles(departmentId: number): Promise<void> {
  const existing = await db
    .select({ id: departmentJobTitlesTable.id, title: departmentJobTitlesTable.title })
    .from(departmentJobTitlesTable)
    .where(eq(departmentJobTitlesTable.departmentId, departmentId));

  if (existing.length > 0) return;

  await db.insert(departmentJobTitlesTable).values(
    DISTRIBYUTSIYA_DEFAULT_TITLES.map((title, i) => ({
      departmentId,
      title,
      sortOrder: i + 1,
      active: true,
    })),
  );
}

export async function ensureDistribyutsiyaSetup(): Promise<number> {
  const id = await ensureDistribyutsiyaDepartmentId();
  await seedDistribyutsiyaJobTitles(id);
  return id;
}

export async function listDistribyutsiyaJobTitles(opts?: {
  departmentId?: number;
  includeInactive?: boolean;
}) {
  const departmentId = opts?.departmentId ?? (await ensureDistribyutsiyaDepartmentId());
  const rows = await db
    .select()
    .from(departmentJobTitlesTable)
    .where(
      opts?.includeInactive
        ? eq(departmentJobTitlesTable.departmentId, departmentId)
        : and(
            eq(departmentJobTitlesTable.departmentId, departmentId),
            eq(departmentJobTitlesTable.active, true),
          ),
    )
    .orderBy(asc(departmentJobTitlesTable.sortOrder), asc(departmentJobTitlesTable.id));
  return { departmentId, titles: rows };
}

export async function getDistribyutsiyaDepartmentRow() {
  const id = await ensureDistribyutsiyaDepartmentId();
  const [row] = await db
    .select()
    .from(departmentsTable)
    .where(eq(departmentsTable.id, id))
    .limit(1);
  return row ?? { id, name: DISTRIBYUTSIYA_DEPARTMENT_NAME, headId: null };
}
