/**
 * Ofis yashil zonada tashrifni test qilish uchun vaqtinchalik koordinator.
 * 2 ta cheklist (tashrif) saqlangach — butunlay bazadan o‘chadi.
 */
import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import {
  db,
  usersTable,
  employeesTable,
  branchAuditsTable,
  coordinatorBranchVisitsTable,
  attendanceRecordsTable,
  attendancePunchAuditTable,
} from "@workspace/db";
import { ensureEmployeeForNewUser } from "./user-employee-sync";
import { purgeEmployeeSideEffects, purgeUserSideEffects } from "./delete-pharmacy-staff";
import { formatPersonName } from "./person-name";

export const TEST_COORD_LOGIN = "test.koordinator";
export const TEST_COORD_PASSWORD = "TestOfis2026!";
export const TEST_COORD_NAME = "TEST Koordinator Ofis";
export const TEST_BRANCH_PREFIX = "TEST Filial Ofis";
/** Nechta cheklist dan keyin avtomatik o‘chirish */
export const TEST_COORD_MAX_VISITS = 2;

/** Asosiy ofis (davomat yashil zona) — test filial GPS shu nuqta */
export const TEST_OFFICE_LAT = 41 + 13 / 60 + 9.3 / 3600;
export const TEST_OFFICE_LNG = 69 + 16 / 60 + 22.9 / 3600;
export const TEST_OFFICE_LABEL = '41°13\'09.3"N 69°16\'22.9"E';

export function isTestOfficeCoordinatorName(fullName?: string | null): boolean {
  const n = String(fullName || "").trim();
  return /^TEST\s+Koordinator/i.test(n) || n === TEST_COORD_NAME;
}

export function isTestOfficeCoordinatorLogin(login?: string | null): boolean {
  return String(login || "").trim().toLowerCase() === TEST_COORD_LOGIN;
}

export async function isTestOfficeCoordinatorUserId(userId?: number | null): Promise<boolean> {
  if (!userId) return false;
  const [u] = await db
    .select({ login: usersTable.login, fullName: usersTable.fullName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!u || u.role !== "koordinator") return false;
  return isTestOfficeCoordinatorLogin(u.login) || isTestOfficeCoordinatorName(u.fullName);
}

export async function countTestCoordinatorChecklists(userId: number): Promise<number> {
  const rows = await db
    .select({ id: branchAuditsTable.id })
    .from(branchAuditsTable)
    .where(eq(branchAuditsTable.coordinatorId, userId));
  return rows.length;
}

export async function listAssignedTestBranches(coordinatorEmployeeId: number) {
  return db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      latitude: employeesTable.latitude,
      longitude: employeesTable.longitude,
    })
    .from(employeesTable)
    .where(
      and(
        eq(employeesTable.reportsToId, coordinatorEmployeeId),
        eq(employeesTable.orgRole, "manager"),
        ilike(employeesTable.fullName, `${TEST_BRANCH_PREFIX}%`),
      ),
    )
    .orderBy(asc(employeesTable.id));
}

async function ensureTestBranch(
  coordinatorEmployeeId: number,
  departmentId: number | null,
  index: 1 | 2,
) {
  const name = `${TEST_BRANCH_PREFIX} ${index}`;
  const loc = `${name} |gps:${TEST_OFFICE_LAT.toFixed(6)},${TEST_OFFICE_LNG.toFixed(6)}`;
  const [existing] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(
      and(
        eq(employeesTable.reportsToId, coordinatorEmployeeId),
        eq(employeesTable.fullName, name),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(employeesTable)
      .set({
        location: loc,
        latitude: TEST_OFFICE_LAT,
        longitude: TEST_OFFICE_LNG,
        orgRole: "manager",
        employmentStatus: "working",
        departmentId: departmentId ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(employeesTable.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(employeesTable)
    .values({
      fullName: name,
      position: "Mudir (test)",
      departmentId: departmentId ?? 1,
      hiredAt: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" }),
      orgRole: "manager",
      reportsToId: coordinatorEmployeeId,
      location: loc,
      latitude: TEST_OFFICE_LAT,
      longitude: TEST_OFFICE_LNG,
      employmentStatus: "working",
      shiftType: "one",
    })
    .returning({ id: employeesTable.id });
  return created!.id;
}

export type TestCoordEnsureResult = {
  userId: number;
  employeeId: number;
  login: string;
  password: string;
  fullName: string;
  branchIds: number[];
  branchNames: string[];
  visitCount: number;
  maxVisits: number;
  message: string;
};

export async function ensureTestOfficeCoordinator(): Promise<TestCoordEnsureResult> {
  let [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.login, TEST_COORD_LOGIN))
    .limit(1);

  if (!user) {
    const [created] = await db
      .insert(usersTable)
      .values({
        fullName: formatPersonName(TEST_COORD_NAME),
        role: "koordinator",
        login: TEST_COORD_LOGIN,
        password: TEST_COORD_PASSWORD,
        phone: null,
        status: "active",
        departmentId: null,
      })
      .returning();
    user = created!;
  } else {
    await db
      .update(usersTable)
      .set({
        fullName: formatPersonName(TEST_COORD_NAME),
        role: "koordinator",
        password: TEST_COORD_PASSWORD,
        status: "active",
      })
      .where(eq(usersTable.id, user.id));
    user = { ...user, fullName: TEST_COORD_NAME, role: "koordinator", password: TEST_COORD_PASSWORD, status: "active" };
  }

  await ensureEmployeeForNewUser({
    id: user.id,
    fullName: TEST_COORD_NAME,
    role: "koordinator",
    departmentId: user.departmentId,
  });

  const [emp] = await db
    .select({
      id: employeesTable.id,
      departmentId: employeesTable.departmentId,
    })
    .from(employeesTable)
    .where(eq(employeesTable.userId, user.id))
    .limit(1);

  if (!emp) {
    throw new Error("Test koordinator employee yaratilmadi");
  }

  await db
    .update(employeesTable)
    .set({
      fullName: TEST_COORD_NAME,
      orgRole: "coordinator",
      position: "Koordinator (test)",
      employmentStatus: "working",
      latitude: TEST_OFFICE_LAT,
      longitude: TEST_OFFICE_LNG,
      location: `Asosiy ofis · ${TEST_OFFICE_LABEL}`,
      updatedAt: new Date(),
    })
    .where(eq(employeesTable.id, emp.id));

  const b1 = await ensureTestBranch(emp.id, emp.departmentId, 1);
  const b2 = await ensureTestBranch(emp.id, emp.departmentId, 2);
  const visitCount = await countTestCoordinatorChecklists(user.id);

  return {
    userId: user.id,
    employeeId: emp.id,
    login: TEST_COORD_LOGIN,
    password: TEST_COORD_PASSWORD,
    fullName: TEST_COORD_NAME,
    branchIds: [b1, b2],
    branchNames: [`${TEST_BRANCH_PREFIX} 1`, `${TEST_BRANCH_PREFIX} 2`],
    visitCount,
    maxVisits: TEST_COORD_MAX_VISITS,
    message:
      `Ofis yashil zonasida (${TEST_OFFICE_LABEL}) Keldim → Cheklist → Ketdim. ` +
      `2 ta tashrifdan keyin akkaunt avtomatik o‘chadi.`,
  };
}

export async function purgeTestOfficeCoordinator(): Promise<{
  deleted: boolean;
  userId: number | null;
  details: string;
}> {
  const users = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName })
    .from(usersTable)
    .where(
      or(
        eq(usersTable.login, TEST_COORD_LOGIN),
        ilike(usersTable.fullName, "TEST Koordinator%"),
      ),
    );

  const testEmps = await db
    .select({ id: employeesTable.id, userId: employeesTable.userId, fullName: employeesTable.fullName })
    .from(employeesTable)
    .where(
      or(
        ilike(employeesTable.fullName, "TEST Koordinator%"),
        ilike(employeesTable.fullName, `${TEST_BRANCH_PREFIX}%`),
      ),
    );

  const userIds = [...new Set(users.map((u) => u.id))];
  let employeeIds = [...new Set(testEmps.map((e) => e.id))];

  if (userIds.length) {
    const linked = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(inArray(employeesTable.userId, userIds));
    employeeIds = [...new Set([...employeeIds, ...linked.map((e) => e.id)])];

    // Test coord ostidagi filiallar
    if (employeeIds.length) {
      const kids = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(inArray(employeesTable.reportsToId, employeeIds));
      employeeIds = [...new Set([...employeeIds, ...kids.map((k) => k.id)])];
    }
  }

  if (!userIds.length && !employeeIds.length) {
    return { deleted: false, userId: null, details: "Test koordinator topilmadi" };
  }

  if (userIds.length) {
    await db
      .delete(coordinatorBranchVisitsTable)
      .where(inArray(coordinatorBranchVisitsTable.coordinatorUserId, userIds));
    await db.delete(branchAuditsTable).where(inArray(branchAuditsTable.coordinatorId, userIds));
    await db
      .delete(attendancePunchAuditTable)
      .where(inArray(attendancePunchAuditTable.userId, userIds));
    await purgeUserSideEffects(userIds);
  }

  if (employeeIds.length) {
    await db
      .delete(branchAuditsTable)
      .where(inArray(branchAuditsTable.managerEmployeeId, employeeIds));
    await db
      .delete(attendanceRecordsTable)
      .where(inArray(attendanceRecordsTable.employeeId, employeeIds));
    await purgeEmployeeSideEffects(employeeIds);
    await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
  }

  if (userIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }

  return {
    deleted: true,
    userId: userIds[0] ?? null,
    details: `O‘chirildi: ${userIds.length} user, ${employeeIds.length} employee`,
  };
}

/** 2-tashrifdan keyin chaqiriladi — limit yetgan bo‘lsa purge */
export async function maybePurgeTestCoordinatorAfterVisit(
  userId: number,
): Promise<{ purged: boolean; visitCount: number }> {
  if (!(await isTestOfficeCoordinatorUserId(userId))) {
    return { purged: false, visitCount: 0 };
  }
  const visitCount = await countTestCoordinatorChecklists(userId);
  if (visitCount < TEST_COORD_MAX_VISITS) {
    return { purged: false, visitCount };
  }
  await purgeTestOfficeCoordinator();
  return { purged: true, visitCount };
}

/**
 * Ofis GPS da test koordinator uchun qaysi test filialga tashrif.
 * preferredBranchId bo‘lsa — shu; aks holda ochiq tashrif / bugun bo‘sh filial.
 */
export async function resolveTestOfficeVisitBranch(opts: {
  coordinatorEmployeeId: number;
  coordinatorUserId: number;
  preferredBranchId?: number | null;
}): Promise<{ branchId: number; branchLabel: string } | null> {
  const branches = await listAssignedTestBranches(opts.coordinatorEmployeeId);
  if (!branches.length) return null;

  if (opts.preferredBranchId) {
    const hit = branches.find((b) => b.id === opts.preferredBranchId);
    if (hit) {
      return { branchId: hit.id, branchLabel: hit.fullName || hit.location || `Filial #${hit.id}` };
    }
  }

  const [open] = await db
    .select({
      branchId: coordinatorBranchVisitsTable.branchId,
      branchLabel: coordinatorBranchVisitsTable.branchLabel,
    })
    .from(coordinatorBranchVisitsTable)
    .where(
      and(
        eq(coordinatorBranchVisitsTable.coordinatorUserId, opts.coordinatorUserId),
        eq(coordinatorBranchVisitsTable.status, "open"),
      ),
    )
    .limit(1);
  if (open) {
    return {
      branchId: open.branchId,
      branchLabel: open.branchLabel || `Filial #${open.branchId}`,
    };
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
  const todayAudits = await db
    .select({ managerEmployeeId: branchAuditsTable.managerEmployeeId })
    .from(branchAuditsTable)
    .where(
      and(
        eq(branchAuditsTable.coordinatorId, opts.coordinatorUserId),
        eq(branchAuditsTable.visitDate, today),
      ),
    );
  const used = new Set(todayAudits.map((a) => a.managerEmployeeId));
  const free = branches.find((b) => !used.has(b.id)) ?? branches[0]!;
  return {
    branchId: free.id,
    branchLabel: free.fullName || free.location || `Filial #${free.id}`,
  };
}
