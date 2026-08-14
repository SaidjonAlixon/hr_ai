import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  employeesTable,
  attendanceRecordsTable,
  notificationsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { notifyAllActiveUsers } from "../lib/notify";
import { DAVOMAT_GEOFENCE_METERS } from "../routes/davomat";

const FIVE_MIN_MS = 5 * 60 * 1000;

function tashkentParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "0";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function dayStartUtcApprox(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+05:00`);
}

async function alreadyNotifiedToday(userId: number, type: string, since: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.type, type),
        gte(notificationsTable.createdAt, since),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Kunlik qoida xabari — barcha faol xodimlarga (kuniga 1 marta) */
export async function broadcastDavomatRuleNotice(): Promise<number> {
  const { ymd, hour } = tashkentParts();
  // Ertalab 07:00 dan keyin
  if (hour < 7) return 0;

  const since = dayStartUtcApprox(ymd);
  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.status, "active"));

  let sent = 0;
  const text =
    `Davomat: kelish va ketish faqat Face ID orqali. Belgilangan lokatsiyadan ${DAVOMAT_GEOFENCE_METERS} m ichida bo‘ling — aks holda qabul qilinmaydi.`;
  for (const u of users) {
    if (await alreadyNotifiedToday(u.id, "davomat_rule", since)) continue;
    await db.insert(notificationsTable).values({
      userId: u.id,
      text,
      type: "davomat_rule",
      linkUrl: "/davomat-face",
    });
    sent += 1;
  }
  if (sent > 0) logger.info({ sent }, "Davomat rule notices sent");
  return sent;
}

/** Ertalab: hali kelmaganlarga eslatma */
export async function remindDavomatCheckIn(): Promise<number> {
  const { ymd, hour, minute } = tashkentParts();
  const mins = hour * 60 + minute;
  // 08:30 – 11:00 oralig‘ida
  if (mins < 8 * 60 + 30 || mins > 11 * 60) return 0;

  const since = dayStartUtcApprox(ymd);
  const linked = await db
    .select({
      userId: employeesTable.userId,
      empId: employeesTable.id,
      fullName: employeesTable.fullName,
    })
    .from(employeesTable)
    .where(
      and(
        isNotNull(employeesTable.userId),
        sql`coalesce(${employeesTable.employmentStatus}, 'working') <> 'dismissed'`,
      ),
    );

  let sent = 0;
  for (const e of linked) {
    if (!e.userId) continue;
    const [rec] = await db
      .select({ id: attendanceRecordsTable.id, checkInAt: attendanceRecordsTable.checkInAt })
      .from(attendanceRecordsTable)
      .where(
        and(
          eq(attendanceRecordsTable.employeeId, e.empId),
          eq(attendanceRecordsTable.workDate, ymd),
        ),
      )
      .limit(1);
    if (rec?.checkInAt) continue;
    if (await alreadyNotifiedToday(e.userId, "davomat_checkin", since)) continue;

    await db.insert(notificationsTable).values({
      userId: e.userId,
      text: `${e.fullName}: bugun hali kelish belgilanmagan. Face ID bilan davomatdan o‘ting (${DAVOMAT_GEOFENCE_METERS} m hudud).`,
      type: "davomat_checkin",
      linkUrl: "/davomat-face",
    });
    sent += 1;
  }
  if (sent > 0) logger.info({ sent }, "Davomat check-in reminders sent");
  return sent;
}

/** Kechki: kelgan, lekin ketmaganlarga */
export async function remindDavomatCheckOut(): Promise<number> {
  const { ymd, hour, minute } = tashkentParts();
  const mins = hour * 60 + minute;
  // 17:30 – 21:00
  if (mins < 17 * 60 + 30 || mins > 21 * 60) return 0;

  const since = dayStartUtcApprox(ymd);
  const open = await db
    .select({
      userId: attendanceRecordsTable.userId,
      empId: attendanceRecordsTable.employeeId,
      fullName: employeesTable.fullName,
    })
    .from(attendanceRecordsTable)
    .innerJoin(employeesTable, eq(employeesTable.id, attendanceRecordsTable.employeeId))
    .where(
      and(
        eq(attendanceRecordsTable.workDate, ymd),
        isNotNull(attendanceRecordsTable.checkInAt),
        isNull(attendanceRecordsTable.checkOutAt),
        isNotNull(attendanceRecordsTable.userId),
      ),
    );

  let sent = 0;
  for (const r of open) {
    if (!r.userId) continue;
    if (await alreadyNotifiedToday(r.userId, "davomat_checkout", since)) continue;
    await db.insert(notificationsTable).values({
      userId: r.userId,
      text: `${r.fullName || "Xodim"}: ketishni Face ID bilan belgilang (${DAVOMAT_GEOFENCE_METERS} m hudud).`,
      type: "davomat_checkout",
      linkUrl: "/davomat-face",
    });
    sent += 1;
  }
  if (sent > 0) logger.info({ sent }, "Davomat check-out reminders sent");
  return sent;
}

export async function runDavomatReminderCycle(): Promise<void> {
  await broadcastDavomatRuleNotice();
  await remindDavomatCheckIn();
  await remindDavomatCheckOut();
}

export function startDavomatReminderJob(): void {
  runDavomatReminderCycle().catch((err) =>
    logger.error({ err }, "Davomat reminder job failed"),
  );
  setInterval(() => {
    runDavomatReminderCycle().catch((err) =>
      logger.error({ err }, "Davomat reminder job failed"),
    );
  }, FIVE_MIN_MS);
  logger.info("Davomat reminder job started (every 5 minutes)");
}

/** Darhol barcha faol xodimlarga bir marta yuborish (admin/HR) */
export async function forceBroadcastDavomatToAll(): Promise<number> {
  return notifyAllActiveUsers({
    text:
      `Muhim: endi barcha xodimlar davomatdan Face ID orqali o‘tadi. Kelish/ketish — faqat belgilangan joydan ${DAVOMAT_GEOFENCE_METERS} m ichida. Ochish: Davomat Face ID.`,
    type: "davomat_rule",
    linkUrl: "/davomat-face",
  });
}
