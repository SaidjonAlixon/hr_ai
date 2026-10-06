import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  departmentsTable,
  employeesTable,
  dismissedStaffTable,
  userSessionsTable,
  userDevicesTable,
  faceProfilesTable,
  webauthnCredentialsTable,
  davomatFingerprintsTable,
  telegramAuthTokensTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import { removeEmployeesForUser } from "./user-employee-sync";
import { logger } from "./logger";

/**
 * Foydalanuvchini «Bo‘shatilganlar»ga o‘tkazish:
 * surati arxivga yoziladi, so‘ng users/employees yozuvi va barcha kirish vositalari o‘chiriladi.
 * Arxivga yozilmasa — hech narsa o‘chirilmaydi.
 */
export async function archiveAndDeleteUser(
  userId: number,
  opts: {
    actorId?: number | null;
    actorName?: string | null;
    reason?: string | null;
    dismissedAt?: Date | null;
  } = {},
): Promise<boolean> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return false;

  const [emp] = await db
    .select({
      id: employeesTable.id,
      position: employeesTable.position,
      location: employeesTable.location,
      hiredAt: employeesTable.hiredAt,
      reportsToId: employeesTable.reportsToId,
      orgRole: employeesTable.orgRole,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      departmentId: employeesTable.departmentId,
    })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);
  const deptId = user.departmentId ?? emp?.departmentId ?? null;
  const [dept] = deptId
    ? await db
        .select({ name: departmentsTable.name })
        .from(departmentsTable)
        .where(eq(departmentsTable.id, deptId))
        .limit(1)
    : [];

  let actorName = opts.actorName ?? null;
  if (!actorName && opts.actorId) {
    const [actor] = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, opts.actorId))
      .limit(1);
    actorName = actor?.fullName ?? null;
  }

  await db.insert(dismissedStaffTable).values({
    formerUserId: user.id,
    formerEmployeeId: emp?.id ?? null,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    login: user.login,
    departmentId: deptId,
    departmentName: dept?.name ?? null,
    position: emp?.position ?? null,
    location: emp?.location ?? null,
    hiredAt: emp?.hiredAt ?? null,
    reportsToId: emp?.reportsToId ?? null,
    orgRole: emp?.orgRole ?? null,
    shiftType: emp?.shiftType ?? null,
    shiftLabel: emp?.shiftLabel ?? null,
    registeredAt: user.createdAt,
    dismissedAt: opts.dismissedAt ?? new Date(),
    dismissedById: opts.actorId ?? null,
    dismissedByName: actorName,
    reason: opts.reason?.trim().slice(0, 500) || null,
  });

  const now = new Date();
  const cleanup: Array<() => Promise<unknown>> = [
    () =>
      db
        .update(userSessionsTable)
        .set({ revokedAt: now })
        .where(and(eq(userSessionsTable.userId, userId), isNull(userSessionsTable.revokedAt))),
    () => db.delete(faceProfilesTable).where(eq(faceProfilesTable.userId, userId)),
    () => db.delete(webauthnCredentialsTable).where(eq(webauthnCredentialsTable.userId, userId)),
    () => db.delete(davomatFingerprintsTable).where(eq(davomatFingerprintsTable.userId, userId)),
    () => db.delete(telegramAuthTokensTable).where(eq(telegramAuthTokensTable.userId, userId)),
    () => db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId)),
    () => db.delete(userDevicesTable).where(eq(userDevicesTable.userId, userId)),
  ];
  for (const step of cleanup) {
    try {
      await step();
    } catch (err) {
      logger.warn({ err, userId }, "dismiss cleanup step failed");
    }
  }

  await removeEmployeesForUser(userId);
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  return true;
}

let sweepRunning = false;

/**
 * Holati «Tugatilgan» foydalanuvchilarni Bo‘shatilganlarga ko‘chiradi — boshqa hech qayerda qolmasin.
 * Faqat users.status = terminated: barcha bo‘shatish yo‘llari (Foydalanuvchilar, Xodimlar,
 * dorixona bo‘shatish) shu holatni qo‘yadi. employees «closed» ishlatilmaydi — u faol
 * foydalanuvchilarga ham qo‘yilishi mumkin (staff-needs tozalash).
 */
export async function sweepDismissedUsers(): Promise<number> {
  if (sweepRunning) return 0;
  sweepRunning = true;
  try {
    return await sweepOnce();
  } finally {
    sweepRunning = false;
  }
}

async function sweepOnce(): Promise<number> {
  const rows = await db
    .select({
      userId: usersTable.id,
      empUpdatedAt: employeesTable.updatedAt,
    })
    .from(usersTable)
    .leftJoin(employeesTable, eq(employeesTable.userId, usersTable.id))
    .where(and(ne(usersTable.role, "admin"), eq(usersTable.status, "terminated")));

  const byUser = new Map<number, (typeof rows)[number]>();
  for (const r of rows) if (!byUser.has(r.userId)) byUser.set(r.userId, r);

  let moved = 0;
  for (const r of byUser.values()) {
    try {
      const ok = await archiveAndDeleteUser(r.userId, {
        actorName: "Holat: Tugatilgan",
        reason: "Holati «Tugatilgan» qilingan",
        dismissedAt: r.empUpdatedAt ?? null,
      });
      if (ok) moved += 1;
    } catch (err) {
      logger.error({ err, userId: r.userId }, "sweepDismissedUsers: user not moved");
    }
  }
  if (moved) logger.info({ moved }, "Bo‘shatilganlarga ko‘chirildi");
  return moved;
}

const OWNER_COLUMNS = new Set([
  "user_id",
  "employee_id",
  "former_user_id",
  "former_employee_id",
  "sender_id",
]);

/** Darslik, imtihon va sozlamalar — odamning o‘z yozuvi emas. */
const SKIP_DELETE_TABLES = new Set([
  "users",
  "employees",
  "departments",
  "kirish_videos",
  "darslik_lessons",
  "attestatsiya_exams",
  "attendance_pay_settings",
  "kpi_settings",
  "work_calendar_days",
  "push_vapid_keys",
  "device_security_settings",
  "mobile_attendance_settings",
  "revision_dicts",
]);

function qid(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error("invalid identifier");
  return `"${name.replace(/"/g, "")}"`;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Array<Record<string, unknown>> }).rows;
  }
  return [];
}

type ColRef = { table: string; column: string; nullable: boolean };

async function personColumns(): Promise<ColRef[]> {
  const result = await db.execute(sql`
    SELECT c.table_name AS tbl, c.column_name AS col, c.is_nullable AS nullable
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND (
        c.column_name IN ('user_id', 'employee_id', 'former_user_id', 'former_employee_id', 'sender_id')
        OR c.column_name LIKE '%\\_user_id' ESCAPE '\\'
        OR c.column_name LIKE '%\\_by_id' ESCAPE '\\'
        OR c.column_name IN ('reports_to_id', 'assigned_branch_id', 'assignee_id')
      )
  `);
  return rowsOf(result).map((r) => ({
    table: String(r.tbl ?? r.table_name ?? ""),
    column: String(r.col ?? r.column_name ?? ""),
    nullable: String(r.nullable ?? r.is_nullable ?? "") === "YES",
  })).filter((r) => r.table && r.column);
}

async function runSql(statement: string): Promise<void> {
  await db.execute(sql.raw(statement));
}

/**
 * Odamga tegishli qatorlarni o‘chiradi, boshqa odamlarning yozuvlaridagi havolani bo‘shatadi.
 * users/employees qatorining o‘zi shu yerda o‘chirilmaydi.
 */
async function erasePersonTraces(userId: number | null, employeeIds: number[]): Promise<void> {
  const cols = await personColumns();
  const empList = employeeIds.filter((n) => Number.isInteger(n) && n > 0);
  const userOk = userId != null && Number.isInteger(userId) && userId > 0;

  if (userOk) {
    await runSql(
      `DELETE FROM tasks WHERE assignee_kind = 'user' AND assignee_id = ${userId}`,
    ).catch((err) => logger.warn({ err, userId }, "purge tasks by user"));
  }
  if (empList.length) {
    await runSql(
      `DELETE FROM tasks WHERE assignee_kind = 'employee' AND assignee_id IN (${empList.join(",")})`,
    ).catch((err) => logger.warn({ err }, "purge tasks by employee"));
  }

  const deletes: string[] = [];
  const nulls: string[] = [];
  for (const col of cols) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(col.table) || !/^[a-z_][a-z0-9_]*$/i.test(col.column)) continue;
    if (SKIP_DELETE_TABLES.has(col.table) && OWNER_COLUMNS.has(col.column)) continue;
    if (col.table === "tasks" && col.column === "assignee_id") continue;
    const ownedByUser = userOk && (col.column === "user_id" || col.column === "former_user_id" || col.column === "sender_id");
    const ownedByEmp = empList.length > 0 && (col.column === "employee_id" || col.column === "former_employee_id");
    if ((ownedByUser || ownedByEmp) && !SKIP_DELETE_TABLES.has(col.table) && col.table !== "users" && col.table !== "employees") {
      const idSql = ownedByUser && (col.column === "user_id" || col.column === "former_user_id" || col.column === "sender_id")
        ? String(userId)
        : empList.join(",");
      const op = idSql.includes(",") ? `IN (${idSql})` : `= ${idSql}`;
      if (ownedByUser && ownedByEmp) {
        deletes.push(`DELETE FROM ${qid(col.table)} WHERE ${qid(col.column)} = ${userId}`);
        deletes.push(`DELETE FROM ${qid(col.table)} WHERE ${qid(col.column)} IN (${empList.join(",")})`);
      } else {
        deletes.push(`DELETE FROM ${qid(col.table)} WHERE ${qid(col.column)} ${op}`);
      }
      continue;
    }
    if (!col.nullable) continue;
    if (col.table === "users" || col.table === "employees") {
      if (empList.length && (col.column === "reports_to_id" || col.column === "assigned_branch_id")) {
        nulls.push(`UPDATE ${qid(col.table)} SET ${qid(col.column)} = NULL WHERE ${qid(col.column)} IN (${empList.join(",")})`);
      }
      continue;
    }
    if (userOk && (col.column.endsWith("_user_id") || col.column.endsWith("_by_id") || col.column === "sender_id")) {
      nulls.push(`UPDATE ${qid(col.table)} SET ${qid(col.column)} = NULL WHERE ${qid(col.column)} = ${userId}`);
    }
    if (empList.length && (col.column.endsWith("_employee_id") || col.column === "reports_to_id" || col.column === "assigned_branch_id")) {
      nulls.push(`UPDATE ${qid(col.table)} SET ${qid(col.column)} = NULL WHERE ${qid(col.column)} IN (${empList.join(",")})`);
    }
  }

  let pending = [...deletes, ...nulls];
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    const failed: string[] = [];
    for (const statement of pending) {
      try {
        await runSql(statement);
      } catch (err) {
        failed.push(statement);
        if (pass === 5) logger.warn({ err, statement }, "purge step failed");
      }
    }
    pending = failed;
  }
}

async function employeeIdsForUser(userId: number): Promise<number[]> {
  const rows = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId));
  return rows.map((r) => r.id);
}

/**
 * Odamni hech qayerda qoldirmaydi: arxiv, davomat, javob, darslik, atestatsiya va login.
 * Boshqa odamlarga berilgan topshiriqlar qoladi, lekin bu odamning ismi ulanmaydi.
 */
export async function purgeUserCompletely(
  userId: number,
  opts: { allowAdmin?: boolean } = {},
): Promise<boolean> {
  const [user] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return false;
  if (user.role === "admin" && !opts.allowAdmin) throw new Error("Adminni faqat bosh admin butunlay o‘chira oladi");

  const empIds = await employeeIdsForUser(userId);
  if (empIds.length) {
    await db.update(employeesTable).set({ reportsToId: null }).where(inArray(employeesTable.reportsToId, empIds));
    await db.update(employeesTable).set({ assignedBranchId: null }).where(inArray(employeesTable.assignedBranchId, empIds));
  }
  await erasePersonTraces(userId, empIds);
  if (empIds.length) {
    await db.delete(employeesTable).where(inArray(employeesTable.id, empIds));
  }
  await db.delete(employeesTable).where(eq(employeesTable.userId, userId));
  await db.delete(dismissedStaffTable).where(eq(dismissedStaffTable.formerUserId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  logger.info({ userId, empIds }, "foydalanuvchi butunlay o‘chirildi");
  return true;
}

/** Bo‘shatilganlar arxividagi yozuvni va qolgan izlarni ham o‘chiradi. */
export async function purgeDismissedArchive(archiveId: number): Promise<boolean> {
  const [row] = await db
    .select({
      id: dismissedStaffTable.id,
      formerUserId: dismissedStaffTable.formerUserId,
      formerEmployeeId: dismissedStaffTable.formerEmployeeId,
    })
    .from(dismissedStaffTable)
    .where(eq(dismissedStaffTable.id, archiveId))
    .limit(1);
  if (!row) return false;

  if (row.formerUserId) {
    const [live] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, row.formerUserId)).limit(1);
    if (live) {
      await purgeUserCompletely(row.formerUserId);
      await db.delete(dismissedStaffTable).where(eq(dismissedStaffTable.id, archiveId));
      return true;
    }
  }

  const empIds = row.formerEmployeeId ? [row.formerEmployeeId] : [];
  await erasePersonTraces(row.formerUserId, empIds);
  if (row.formerEmployeeId) {
    await db.delete(employeesTable).where(eq(employeesTable.id, row.formerEmployeeId)).catch(() => undefined);
  }
  await db.delete(dismissedStaffTable).where(eq(dismissedStaffTable.id, archiveId));
  logger.info({ archiveId, formerUserId: row.formerUserId }, "arxivdan butunlay o‘chirildi");
  return true;
}
