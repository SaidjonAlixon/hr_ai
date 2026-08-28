import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, employeesTable, departmentsTable } from "@workspace/db";
import { formatPersonName } from "./person-name";
import { resolveDepartmentIdForRole } from "./role-departments";

const ROLE_POSITION: Record<string, string> = {
  admin: "Admin",
  director: "Direktor",
  asoschi: "Asoschi",
  department_head: "Bo‘lim boshlig‘i",
  hr_direktor: "HR Direktor",
  hr_menejer: "HR Menejer",
  hr_auditor: "HR Auditor",
  recruiter: "Rekruter",
  trainer: "Trener",
  mentor: "Mentor",
  mudir: "Mudir",
  koordinator: "Koordinator",
  texnik: "Texnik",
  texnik_rahbar: "Texnik bo‘limi rahbari",
  it: "IT mutaxassisi",
  it_rahbar: "IT bo‘limi rahbari",
  ombor: "Ombor",
  farmasevt: "Farmasevt",
  stajyor: "Stajyor",
};

function orgRoleFromUserRole(role: string): string | null {
  if (role === "mudir") return "manager";
  if (role === "farmasevt") return "pharmacist";
  if (role === "stajyor") return "intern";
  if (role === "koordinator") return "coordinator";
  return null;
}

function todayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

export async function removeEmployeesForUser(userId: number): Promise<void> {
  const doomed = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId));
  const ids = doomed.map((r) => r.id);
  if (!ids.length) return;
  await db
    .update(employeesTable)
    .set({ reportsToId: null })
    .where(inArray(employeesTable.reportsToId, ids));
  try {
    await db.delete(employeesTable).where(inArray(employeesTable.id, ids));
  } catch {
    await db
      .update(employeesTable)
      .set({ userId: null, employmentStatus: "dismissed", updatedAt: new Date() })
      .where(inArray(employeesTable.id, ids));
  }
}

export async function ensureEmployeeForNewUser(user: {
  id: number;
  fullName: string;
  role: string;
  departmentId: number | null;
}): Promise<void> {
  const [existing] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.userId, user.id))
    .limit(1);
  if (existing) return;

  const name = formatPersonName(user.fullName.trim());
  const [orphan] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(
      and(
        isNull(employeesTable.userId),
        sql`lower(trim(${employeesTable.fullName})) = ${name.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (orphan) {
    await db
      .update(employeesTable)
      .set({
        userId: user.id,
        fullName: name,
        updatedAt: new Date(),
      })
      .where(eq(employeesTable.id, orphan.id));
    return;
  }

  let departmentId = user.departmentId;
  if (!departmentId) {
    departmentId = (await resolveDepartmentIdForRole(user.role)) ?? null;
  }
  if (!departmentId) {
    const [anyDept] = await db.select({ id: departmentsTable.id }).from(departmentsTable).limit(1);
    departmentId = anyDept?.id ?? 1;
  }

  await db.insert(employeesTable).values({
    fullName: name,
    position: ROLE_POSITION[user.role] || user.role || "Xodim",
    departmentId,
    hiredAt: todayYmd(),
    userId: user.id,
    employmentStatus: "working",
    orgRole: orgRoleFromUserRole(user.role),
    shiftType: "one",
  });
}
