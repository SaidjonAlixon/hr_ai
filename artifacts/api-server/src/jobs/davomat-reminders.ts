import { and, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  employeesTable,
  attendanceRecordsTable,
  notificationsTable,
  employeeDayShiftPlansTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { notifyAllActiveUsers, notifyUser } from "../lib/notify";
import { isTelegramConfigured } from "../lib/telegram";
import { DAVOMAT_GEOFENCE_METERS } from "../routes/davomat";
import {
  hmToMinutes,
  workScheduleForStaff,
  shiftEndAt,
  checkoutDeadlineAt,
  checkoutDeadlineHmFor,
  encodeShiftKeys,
} from "../lib/shift-hours";
import { getEffectiveShiftDefs, warnHmBefore } from "../lib/shift-schedule";
import { isOfisRestDay } from "../lib/ofis-weekend";

const FIVE_MIN_MS = 5 * 60 * 1000;
/** Job 5 daqiqada bir — eslatma oynasi (~bir marta ushlash) */
const REMIND_WINDOW_MIN = 10;
const START_WARN_BEFORE_MIN = 15;
const END_WARN_BEFORE_MIN = 60;

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

async function loadLinkedStaff() {
  return db
    .select({
      userId: employeesTable.userId,
      empId: employeesTable.id,
      fullName: employeesTable.fullName,
      orgRole: employeesTable.orgRole,
      position: employeesTable.position,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
    })
    .from(employeesTable)
    .where(
      and(
        isNotNull(employeesTable.userId),
        sql`coalesce(${employeesTable.employmentStatus}, 'working') not in ('dismissed', 'closed')`,
      ),
    );
}

async function userRoleMap(ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return map;
  const users = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(inArray(usersTable.id, uniq));
  for (const u of users) map.set(u.id, u.role);
  return map;
}

async function dayPlanShiftType(employeeId: number, workDate: string): Promise<string | null> {
  try {
    const [plan] = await db
      .select({ shiftKeys: employeeDayShiftPlansTable.shiftKeys })
      .from(employeeDayShiftPlansTable)
      .where(
        and(
          eq(employeeDayShiftPlansTable.employeeId, employeeId),
          eq(employeeDayShiftPlansTable.workDate, workDate),
        ),
      )
      .limit(1);
    if (!plan?.shiftKeys?.length) return null;
    const keys = (plan.shiftKeys as string[]).filter(
      (k) => k === "one" || k === "two" || k === "three",
    );
    if (!keys.length) return null;
    return encodeShiftKeys(keys as ("one" | "two" | "three")[]);
  } catch {
    return null;
  }
}

/**
 * 1) Ish boshlanishidan 15 daqiqa oldin — bir marta (ofis + apteka).
 * Boshqa «kelmagansiz» eslatmalari yo‘q.
 */
export async function remindShiftStart15Min(): Promise<number> {
  const { ymd, hour, minute } = tashkentParts();
  const mins = hour * 60 + minute;
  const since = dayStartUtcApprox(ymd);
  const linked = await loadLinkedStaff();
  const roles = await userRoleMap(linked.map((e) => e.userId || 0));
  const defs = await getEffectiveShiftDefs();
  let sent = 0;

  for (const e of linked) {
    if (!e.userId) continue;
    const role = roles.get(e.userId) || "";
    if (
      isOfisRestDay(ymd, {
        userRole: role,
        orgRole: e.orgRole,
        position: e.position,
      })
    ) {
      continue;
    }
    const planType = await dayPlanShiftType(e.empId, ymd);
    const shiftType = planType || e.shiftType;
    const shiftLabel = planType ? null : e.shiftLabel;
    const w = workScheduleForStaff(role, e.orgRole, shiftType, shiftLabel, defs);
    const warnHm = warnHmBefore(w.start, START_WARN_BEFORE_MIN);
    const warnMin = hmToMinutes(warnHm);
    if (mins < warnMin || mins >= warnMin + REMIND_WINDOW_MIN) continue;

    const [rec] = await db
      .select({ checkInAt: attendanceRecordsTable.checkInAt })
      .from(attendanceRecordsTable)
      .where(
        and(eq(attendanceRecordsTable.employeeId, e.empId), eq(attendanceRecordsTable.workDate, ymd)),
      )
      .limit(1);
    if (rec?.checkInAt) continue;

    const type = "davomat_shift_start_15m";
    if (await alreadyNotifiedToday(e.userId, type, since)) continue;

    const text =
      `⏰ Ish boshlanishiga 15 daqiqa qoldi\n` +
      `${w.label}: ${w.start}–${w.end}\n` +
      `Kelganda «Keldim» ni Face ID yoki QR bilan belgilang.`;

    await notifyUser({
      userId: e.userId,
      text,
      type,
      linkUrl: "/davomat-face",
      telegram: true,
      title: "Davomat — ish boshlanishi",
    });
    sent += 1;
  }
  if (sent > 0) logger.info({ sent }, "Davomat start-15m reminders");
  return sent;
}

/** @deprecated — alias */
export async function remindPharmacyShiftWarn(): Promise<number> {
  return remindShiftStart15Min();
}

/**
 * 2) Ish tugashidan (Ketdim) 1 soat oldin — bir marta.
 * Takroriy «Ketdim ni bosing» nag yo‘q.
 */
export async function remindCheckoutOneHourBefore(): Promise<number> {
  const now = new Date();
  const nowMs = now.getTime();
  const open = await loadOpenCheckouts();
  if (!open.length) return 0;

  const roles = await userRoleMap(open.map((r) => r.userId || 0));
  const defs = await getEffectiveShiftDefs();
  let sent = 0;

  for (const r of open) {
    if (!r.userId || !r.checkInAt) continue;
    const role = roles.get(r.userId) || "";
    const planType = await dayPlanShiftType(r.empId, r.workDate);
    const shiftType = planType || r.shiftType;
    const shiftLabel = planType ? null : r.shiftLabel;
    const w = workScheduleForStaff(role, r.orgRole, shiftType, shiftLabel, defs);
    const endAt = shiftEndAt(r.workDate, w.end, w.overnight);
    const warnAt = endAt.getTime() - END_WARN_BEFORE_MIN * 60_000;
    if (nowMs < warnAt || nowMs >= warnAt + REMIND_WINDOW_MIN * 60_000) continue;
    // Smena allaqachon tugagan bo‘lsa — bu eslatma emas
    if (nowMs >= endAt.getTime()) continue;

    const type = `davomat_checkout_1h_${r.workDate}`;
    const since = dayStartUtcApprox(r.workDate);
    if (await alreadyNotifiedToday(r.userId, type, since)) continue;

    const endHm = w.end;
    const text =
      `⏰ Ish tugashiga 1 soat qoldi\n` +
      `${w.label}: tugash ${endHm}\n` +
      `Ketishda «Ketdim» ni Face ID yoki QR bilan belgilang.`;

    await notifyUser({
      userId: r.userId,
      text,
      type,
      linkUrl: "/davomat-face",
      telegram: true,
      title: "Davomat — ketish eslatmasi",
    });
    sent += 1;
  }

  if (sent > 0) logger.info({ sent }, "Davomat checkout-1h reminders");
  return sent;
}

type OpenCheckoutRow = {
  id: number;
  userId: number | null;
  empId: number;
  workDate: string;
  checkInAt: Date | null;
  fullName: string | null;
  orgRole: string | null;
  shiftType: string | null;
  shiftLabel: string | null;
};

async function loadOpenCheckouts(): Promise<OpenCheckoutRow[]> {
  return db
    .select({
      id: attendanceRecordsTable.id,
      userId: attendanceRecordsTable.userId,
      empId: attendanceRecordsTable.employeeId,
      workDate: attendanceRecordsTable.workDate,
      checkInAt: attendanceRecordsTable.checkInAt,
      fullName: employeesTable.fullName,
      orgRole: employeesTable.orgRole,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
    })
    .from(attendanceRecordsTable)
    .innerJoin(employeesTable, eq(employeesTable.id, attendanceRecordsTable.employeeId))
    .where(
      and(
        isNotNull(attendanceRecordsTable.checkInAt),
        isNull(attendanceRecordsTable.checkOutAt),
        ne(attendanceRecordsTable.status, "absent"),
        ne(attendanceRecordsTable.status, "leave"),
        isNotNull(attendanceRecordsTable.userId),
      ),
    );
}

/**
 * Muddat o‘tgach avtomatik «kelmagan» — ogohlantirishsiz (jim).
 * Takroriy «Ketdim» naglari o‘chirilgan.
 */
export async function autoCloseMissedCheckoutSilent(): Promise<{ closed: number }> {
  const now = new Date();
  const open = await loadOpenCheckouts();
  if (!open.length) return { closed: 0 };

  const roles = await userRoleMap(open.map((r) => r.userId || 0));
  const defs = await getEffectiveShiftDefs();
  let closed = 0;

  for (const r of open) {
    if (!r.userId || !r.checkInAt) continue;
    const role = roles.get(r.userId) || "";
    const planType = await dayPlanShiftType(r.empId, r.workDate);
    const shiftType = planType || r.shiftType;
    const shiftLabel = planType ? null : r.shiftLabel;
    const w = workScheduleForStaff(role, r.orgRole, shiftType, shiftLabel, defs);
    const deadlineOpts = {
      shiftKey: w.key,
      shiftKeys: w.keys,
      overnight: Boolean(w.overnight),
    };
    const deadlineAt = checkoutDeadlineAt(r.workDate, w.end, w.overnight, deadlineOpts);
    const deadlineHm = checkoutDeadlineHmFor(deadlineOpts);
    if (now.getTime() < deadlineAt.getTime()) continue;

    await db
      .update(attendanceRecordsTable)
      .set({
        status: "absent",
        notes: `auto_absent_no_checkout: ${deadlineHm} gacha Ketdim yo‘q (smena ${w.end}, ${w.label})`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(attendanceRecordsTable.id, r.id),
          isNull(attendanceRecordsTable.checkOutAt),
          ne(attendanceRecordsTable.status, "absent"),
        ),
      );
    closed += 1;
  }

  if (closed > 0) logger.info({ closed }, "Davomat auto-absent (silent)");
  return { closed };
}

/** @deprecated — nag o‘chirildi; faqat jim yopish */
export async function remindAndAutoCloseMissedCheckout(): Promise<{ nags: number; closed: number }> {
  const r = await autoCloseMissedCheckoutSilent();
  return { nags: 0, closed: r.closed };
}

/** @deprecated */
export async function remindDavomatCheckIn(): Promise<number> {
  return 0;
}

/** @deprecated */
export async function broadcastDavomatRuleNotice(): Promise<number> {
  return 0;
}

/** @deprecated */
export async function announceShiftTwoCheckoutPolicy(): Promise<number> {
  return 0;
}

/** @deprecated */
export async function announceShiftThreeCheckoutPolicy(): Promise<number> {
  return 0;
}

/** @deprecated */
export async function remindDavomatCheckOut(): Promise<number> {
  return 0;
}

/**
 * Faqat 2 ta davomat eslatmasi:
 * - ish boshlanishidan 15 daqiqa oldin (1 marta)
 * - ish tugashidan 1 soat oldin (1 marta)
 * + jim auto-absent (xabar yo‘q)
 */
export async function runDavomatReminderCycle(): Promise<void> {
  await remindShiftStart15Min();
  await remindCheckoutOneHourBefore();
  await autoCloseMissedCheckoutSilent();
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
  logger.info(
    "Davomat reminders: start−15m + end−1h only (every 5 min); nags/policy/check-in spam off",
  );
}

/** Admin/HR qo‘lda yuboradi — avtomatik emas */
export function davomatBroadcastMessage(): string {
  return `Muhim: endi barcha xodimlar davomatdan Face ID orqali o‘tadi. Kelish/ketish — faqat belgilangan joydan ${DAVOMAT_GEOFENCE_METERS} m ichida. Ochish: Davomat Face ID.`;
}

export async function forceBroadcastDavomatToAll(): Promise<number> {
  return notifyAllActiveUsers({
    text: davomatBroadcastMessage(),
    type: "davomat_rule",
    linkUrl: "/davomat-face",
    telegram: true,
  });
}

export function davomatBroadcastTelegramReady(): boolean {
  return isTelegramConfigured();
}
