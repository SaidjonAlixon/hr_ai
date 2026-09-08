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
  isPharmacyShiftStaff,
  shiftWindow,
  hmToMinutes,
  workScheduleForStaff,
  shiftEndAt,
  CHECKOUT_GRACE_MS,
  encodeShiftKeys,
} from "../lib/shift-hours";
import { getEffectiveShiftDefs } from "../lib/shift-schedule";

const FIVE_MIN_MS = 5 * 60 * 1000;
/** Grace ichida eslatma oralig‘i */
const NAG_EVERY_MS = 30 * 60 * 1000;

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

function addYmdDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
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

async function loadLinkedStaff() {
  return db
    .select({
      userId: employeesTable.userId,
      empId: employeesTable.id,
      fullName: employeesTable.fullName,
      orgRole: employeesTable.orgRole,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
    })
    .from(employeesTable)
    .where(
      and(
        isNotNull(employeesTable.userId),
        sql`coalesce(${employeesTable.employmentStatus}, 'working') <> 'dismissed'`,
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

/** Ish boshlanishidan 15 daqiqa oldin — apteka smenasi va ofis xodimlari */
export async function remindPharmacyShiftWarn(): Promise<number> {
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
    const w = workScheduleForStaff(role, e.orgRole, e.shiftType, e.shiftLabel, defs);
    const warnMin = hmToMinutes(w.warnHm);
    if (mins < warnMin || mins >= warnMin + 15) continue;

    const [rec] = await db
      .select({ checkInAt: attendanceRecordsTable.checkInAt })
      .from(attendanceRecordsTable)
      .where(and(eq(attendanceRecordsTable.employeeId, e.empId), eq(attendanceRecordsTable.workDate, ymd)))
      .limit(1);
    if (rec?.checkInAt) continue;

    const type = `davomat_shift_warn_${w.key}`;
    if (await alreadyNotifiedToday(e.userId, type, since)) continue;

    const text = `${w.label} (${w.start}–${w.end}): ${w.warnText}`;
    await notifyUser({
      userId: e.userId,
      text,
      type,
      linkUrl: "/davomat-face",
      telegram: true,
    });
    sent += 1;
  }
  if (sent > 0) logger.info({ sent }, "Shift start warnings sent");
  return sent;
}

/** Hali kelmaganlarga eslatma (smena soatiga qarab) */
export async function remindDavomatCheckIn(): Promise<number> {
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
    const pharmacy = isPharmacyShiftStaff(role, e.orgRole);
    if (pharmacy) {
      const start = hmToMinutes(shiftWindow(e.shiftType, e.shiftLabel, defs).start);
      if (mins < start || mins > start + 150) continue;
    } else if (mins < 8 * 60 + 30 || mins > 11 * 60) {
      continue;
    }

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

    const w = pharmacy ? shiftWindow(e.shiftType, e.shiftLabel, defs) : null;
    await db.insert(notificationsTable).values({
      userId: e.userId,
      text: w
        ? `${e.fullName}: ${w.label} (${w.start}) boshlandi, hali kelish yo‘q. Face ID qiling — kechikish jarima.`
        : `${e.fullName}: bugun hali kelish belgilanmagan. Face ID bilan davomatdan o‘ting (${DAVOMAT_GEOFENCE_METERS} m hudud).`,
      type: "davomat_checkin",
      linkUrl: "/davomat-face",
    });
    sent += 1;
  }
  if (sent > 0) logger.info({ sent }, "Davomat check-in reminders sent");
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
 * Smena tugagach:
 * - 0…2 soat: har 30 daqiqada Telegram + in-app + OS eslatma
 * - 2 soatdan keyin: avtomatik «kelmagan» (absent), kun yopiladi
 * Farmasevt (apteka) + ofis xodimlari.
 */
export async function remindAndAutoCloseMissedCheckout(): Promise<{ nags: number; closed: number }> {
  const now = new Date();
  const open = await loadOpenCheckouts();
  if (!open.length) return { nags: 0, closed: 0 };

  const roles = await userRoleMap(open.map((r) => r.userId || 0));
  const defs = await getEffectiveShiftDefs();
  let nags = 0;
  let closed = 0;

  for (const r of open) {
    if (!r.userId || !r.checkInAt) continue;
    const role = roles.get(r.userId) || "";
    const planType = await dayPlanShiftType(r.empId, r.workDate);
    const shiftType = planType || r.shiftType;
    const shiftLabel = planType ? null : r.shiftLabel;
    const w = workScheduleForStaff(role, r.orgRole, shiftType, shiftLabel, defs);
    const endAt = shiftEndAt(r.workDate, w.end, w.overnight);
    const endMs = endAt.getTime();
    const nowMs = now.getTime();

    // Smena hali tugamagan
    if (nowMs < endMs) continue;

    const graceEndMs = endMs + CHECKOUT_GRACE_MS;

    // 2 soat o‘tdi — avtomatik kelmagan
    if (nowMs >= graceEndMs) {
      await db
        .update(attendanceRecordsTable)
        .set({
          status: "absent",
          notes: `auto_absent_no_checkout: smena ${w.end} dan keyin 2 soat ichida Ketdim yo‘q (${w.label})`,
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

      await notifyUser({
        userId: r.userId,
        text:
          `Davomat yopildi: ${r.fullName || "Xodim"} — smena tugagach 2 soat ichida «Ketdim» bosilmadi. ` +
          `Bugun «kelmagan» deb belgilandi. Ertaga yangi kun «Keldim» dan boshlanadi.`,
        type: "davomat_auto_absent",
        linkUrl: "/davomat-face",
        telegram: true,
      });
      continue;
    }

    // Grace oynasi: har 30 daqiqada bir eslatma (0, 30, 60, 90)
    const elapsed = nowMs - endMs;
    const slot = Math.min(3, Math.floor(elapsed / NAG_EVERY_MS));
    const type = `davomat_checkout_nag_${r.workDate}_${slot}`;
    const since = dayStartUtcApprox(r.workDate);
    if (await alreadyNotifiedToday(r.userId, type, since)) continue;

    const remainMin = Math.max(0, Math.ceil((graceEndMs - nowMs) / 60_000));
    const text =
      `Ish vaqtingiz tugadi (${w.end}). «Ketdim» ni Face ID/QR bilan yoping. ` +
      `Yana ~${remainMin} daqiqa ichida yopilmasa, bugun ishlamagansiz deb topilasiz. ` +
      `Hudud: ${DAVOMAT_GEOFENCE_METERS} m.`;

    await notifyUser({
      userId: r.userId,
      text,
      type,
      linkUrl: "/davomat-face",
      telegram: true,
    });
    nags += 1;
  }

  if (nags > 0 || closed > 0) {
    logger.info({ nags, closed }, "Davomat checkout nag / auto-absent");
  }
  return { nags, closed };
}

/** @deprecated — use remindAndAutoCloseMissedCheckout */
export async function remindDavomatCheckOut(): Promise<number> {
  const r = await remindAndAutoCloseMissedCheckout();
  return r.nags;
}

export async function runDavomatReminderCycle(): Promise<void> {
  await broadcastDavomatRuleNotice();
  await remindPharmacyShiftWarn();
  await remindDavomatCheckIn();
  await remindAndAutoCloseMissedCheckout();
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
