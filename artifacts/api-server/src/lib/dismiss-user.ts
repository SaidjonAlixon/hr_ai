import { and, eq, isNull, ne } from "drizzle-orm";
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
