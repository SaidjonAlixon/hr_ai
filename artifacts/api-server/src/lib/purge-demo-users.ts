import { eq, ilike, inArray, or } from "drizzle-orm";
import {
  db,
  usersTable,
  employeesTable,
  payrollMonthsTable,
  settlementLinesTable,
  remindersTable,
  reminderEventsTable,
  revisionAuditLogTable,
} from "@workspace/db";
import { purgeEmployeeSideEffects, purgeUserSideEffects } from "./delete-pharmacy-staff";

/** Demo / test ismlar — smena ro‘yxatidagi soxta yozuvlar */
const DEMO_EXACT_NAMES = ["Salom Salom", "Demo Stajyor"] as const;

function demoNameClause(column: typeof usersTable.fullName | typeof employeesTable.fullName) {
  return or(
    ilike(column, "Demo%"),
    ...DEMO_EXACT_NAMES.map((n) => eq(column, n)),
  );
}

export async function purgeDemoUsers(): Promise<{
  deletedUsers: number;
  deletedEmployees: number;
  names: string[];
}> {
  const demoUsers = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName })
    .from(usersTable)
    .where(demoNameClause(usersTable.fullName));

  const demoEmployees = await db
    .select({
      id: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
    })
    .from(employeesTable)
    .where(demoNameClause(employeesTable.fullName));

  const userIds = [
    ...new Set([
      ...demoUsers.map((u) => u.id),
      ...demoEmployees.map((e) => e.userId).filter((id): id is number => id != null),
    ]),
  ];

  let employeeIds = [...new Set(demoEmployees.map((e) => e.id))];
  if (userIds.length) {
    const linked = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(inArray(employeesTable.userId, userIds));
    employeeIds = [...new Set([...employeeIds, ...linked.map((e) => e.id)])];
  }

  if (userIds.length) {
    const rem = await db
      .select({ id: remindersTable.id })
      .from(remindersTable)
      .where(inArray(remindersTable.userId, userIds));
    const remIds = rem.map((r) => r.id);
    if (remIds.length) {
      await db.delete(reminderEventsTable).where(inArray(reminderEventsTable.reminderId, remIds));
    }
    await db.delete(payrollMonthsTable).where(inArray(payrollMonthsTable.userId, userIds));
    await db
      .update(revisionAuditLogTable)
      .set({ userId: null })
      .where(inArray(revisionAuditLogTable.userId, userIds));
  }

  await db
    .delete(settlementLinesTable)
    .where(
      or(
        ilike(settlementLinesTable.fullName, "Demo%"),
        eq(settlementLinesTable.fullName, "Salom Salom"),
      ),
    );

  if (employeeIds.length) {
    await db
      .update(employeesTable)
      .set({ reportsToId: null, assignedBranchId: null })
      .where(
        or(
          inArray(employeesTable.reportsToId, employeeIds),
          inArray(employeesTable.assignedBranchId, employeeIds),
        ),
      );
    await purgeEmployeeSideEffects(employeeIds);
  }
  if (userIds.length) {
    await purgeUserSideEffects(userIds);
  }

  if (employeeIds.length) {
    await db.delete(employeesTable).where(inArray(employeesTable.id, employeeIds));
  }
  if (userIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }

  const names = [
    ...new Set([
      ...demoUsers.map((u) => u.fullName),
      ...demoEmployees.map((e) => e.fullName),
    ]),
  ];

  return {
    deletedUsers: userIds.length,
    deletedEmployees: employeeIds.length,
    names,
  };
}
