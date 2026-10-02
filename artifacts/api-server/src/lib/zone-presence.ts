import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  attendanceRecordsTable,
  employeesTable,
  zonePresenceRulesTable,
} from "@workspace/db";
import { notifyUser } from "./notify";

export type ZoneMethod = "FACE_ID" | "QR";

export const ZONE_DUE_TEXT = "Yashil hududda ekanligingizni tasdiqlang.";
export const ZONE_BLOCK_TEXT =
  "Bugun bloklandi. Yashil hududda ekanligingizni belgilangan vaqtda tasdiqlamadingiz. Muammo bo‘lsa admin bilan bog‘laning — ruxsat berguncha Keldim va Ketdim yopiq.";

export type ZoneStatus = "off" | "idle" | "waiting" | "due" | "blocked";

export type ZoneView = {
  enabled: boolean;
  method: ZoneMethod | null;
  intervalHours: number | null;
  windowMinutes: number | null;
  status: ZoneStatus;
  dueAt: string | null;
  remainSec: number | null;
  message: string | null;
};

type Rule = typeof zonePresenceRulesTable.$inferSelect;

function tashkentToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

export function clampIntervalHours(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 2;
  return Math.min(12, Math.max(1, n));
}

export function clampWindowMinutes(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 15;
  return Math.min(120, Math.max(5, n));
}

export function parseZoneMethod(value: unknown): ZoneMethod {
  return value === "QR" ? "QR" : "FACE_ID";
}

function methodLabel(method: ZoneMethod): string {
  return method === "QR" ? "QR kod" : "Face ID";
}

export function isZoneBlocked(rule: Rule, now = new Date()): boolean {
  if (!rule.enabled) return false;
  const today = tashkentToday(now);
  const unlockedMs = rule.unlockedOn === today && rule.unlockedAt ? rule.unlockedAt.getTime() : 0;
  if (rule.blockedOn === today) {
    const blockedMs = rule.blockedAt ? rule.blockedAt.getTime() : 0;
    if (!(unlockedMs && unlockedMs >= blockedMs)) return true;
  }
  if (rule.promptAt && rule.dueAt && now.getTime() > rule.dueAt.getTime()) {
    if (tashkentToday(rule.dueAt) !== today) return false;
    if (unlockedMs && unlockedMs >= rule.dueAt.getTime()) return false;
    return true;
  }
  return false;
}

function viewFrom(rule: Rule | null, openCheckIn: Date | null, now = new Date()): ZoneView {
  if (!rule?.enabled) {
    return {
      enabled: false,
      method: null,
      intervalHours: null,
      windowMinutes: null,
      status: "off",
      dueAt: null,
      remainSec: null,
      message: null,
    };
  }
  const method = parseZoneMethod(rule.method);
  const base = {
    enabled: true,
    method,
    intervalHours: rule.intervalHours,
    windowMinutes: rule.windowMinutes,
  };
  if (isZoneBlocked(rule, now)) {
    return {
      ...base,
      status: "blocked",
      dueAt: null,
      remainSec: null,
      message: ZONE_BLOCK_TEXT,
    };
  }
  if (!openCheckIn) {
    return {
      ...base,
      status: "idle",
      dueAt: null,
      remainSec: null,
      message: null,
    };
  }
  if (rule.promptAt && rule.dueAt && now.getTime() <= rule.dueAt.getTime()) {
    const remainSec = Math.max(0, Math.ceil((rule.dueAt.getTime() - now.getTime()) / 1000));
    return {
      ...base,
      status: "due",
      dueAt: rule.dueAt.toISOString(),
      remainSec,
      message: `${ZONE_DUE_TEXT} ${methodLabel(method)} bilan ${rule.windowMinutes} daqiqa ichida tasdiqlang.`,
    };
  }
  return {
    ...base,
    status: "waiting",
    dueAt: null,
    remainSec: null,
    message: null,
  };
}

async function openCheckIns(employeeIds: number[], today: string): Promise<Map<number, Date>> {
  if (!employeeIds.length) return new Map();
  const rows = await db
    .select({
      employeeId: attendanceRecordsTable.employeeId,
      checkInAt: attendanceRecordsTable.checkInAt,
      checkOutAt: attendanceRecordsTable.checkOutAt,
    })
    .from(attendanceRecordsTable)
    .where(
      and(
        inArray(attendanceRecordsTable.employeeId, employeeIds),
        eq(attendanceRecordsTable.workDate, today),
        isNotNull(attendanceRecordsTable.checkInAt),
        isNull(attendanceRecordsTable.checkOutAt),
      ),
    );
  const map = new Map<number, Date>();
  for (const row of rows) {
    if (row.checkInAt) map.set(row.employeeId, row.checkInAt);
  }
  return map;
}

export async function zoneViewForUser(userId: number, now = new Date()): Promise<ZoneView> {
  const [rule] = await db
    .select()
    .from(zonePresenceRulesTable)
    .where(eq(zonePresenceRulesTable.userId, userId))
    .limit(1);
  if (!rule?.enabled) return viewFrom(null, null, now);
  let checkIn: Date | null = null;
  if (rule.employeeId) {
    const opens = await openCheckIns([rule.employeeId], tashkentToday(now));
    checkIn = opens.get(rule.employeeId) ?? null;
  }
  return viewFrom(rule, checkIn, now);
}

export async function zonePunchBlock(userId: number | null | undefined): Promise<{
  error: string;
  code: "zone_blocked";
} | null> {
  if (!userId) return null;
  const [rule] = await db
    .select()
    .from(zonePresenceRulesTable)
    .where(eq(zonePresenceRulesTable.userId, userId))
    .limit(1);
  if (!rule || !isZoneBlocked(rule)) return null;
  return { error: ZONE_BLOCK_TEXT, code: "zone_blocked" };
}

export async function saveZoneRule(opts: {
  userId: number;
  enabled: boolean;
  intervalHours: number;
  windowMinutes: number;
  method: ZoneMethod;
}): Promise<ZoneView> {
  const [emp] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.userId, opts.userId))
    .limit(1);
  const now = new Date();
  const [existing] = await db
    .select()
    .from(zonePresenceRulesTable)
    .where(eq(zonePresenceRulesTable.userId, opts.userId))
    .limit(1);
  const turningOn = opts.enabled && !existing?.enabled;
  const values = {
    employeeId: emp?.id ?? existing?.employeeId ?? null,
    enabled: opts.enabled,
    intervalHours: opts.intervalHours,
    windowMinutes: opts.windowMinutes,
    method: opts.method,
    updatedAt: now,
    ...(turningOn
      ? {
          cycleStartedAt: now,
          promptAt: null,
          dueAt: null,
          promptNotifiedAt: null,
        }
      : {}),
    ...(!opts.enabled
      ? {
          promptAt: null,
          dueAt: null,
          promptNotifiedAt: null,
        }
      : {}),
  };
  if (existing) {
    await db.update(zonePresenceRulesTable).set(values).where(eq(zonePresenceRulesTable.userId, opts.userId));
  } else {
    await db.insert(zonePresenceRulesTable).values({ userId: opts.userId, ...values });
  }
  return zoneViewForUser(opts.userId, now);
}

export async function unlockZoneDay(opts: { userId: number; adminUserId: number }): Promise<ZoneView> {
  const now = new Date();
  const today = tashkentToday(now);
  const [existing] = await db
    .select()
    .from(zonePresenceRulesTable)
    .where(eq(zonePresenceRulesTable.userId, opts.userId))
    .limit(1);
  if (!existing?.enabled) {
    return viewFrom(null, null, now);
  }
  await db
    .update(zonePresenceRulesTable)
    .set({
      blockedOn: null,
      unlockedOn: today,
      unlockedAt: now,
      unlockedBy: opts.adminUserId,
      cycleStartedAt: now,
      promptAt: null,
      dueAt: null,
      promptNotifiedAt: null,
      updatedAt: now,
    })
    .where(eq(zonePresenceRulesTable.userId, opts.userId));
  try {
    await notifyUser({
      userId: opts.userId,
      title: "Ruxsat berildi",
      text: "Admin ruxsat berdi. Yashil hudud tasdiqi va Keldim/Ketdim yana ochiq.",
      type: "zone_presence_unlock",
      linkUrl: "/davomat-face",
    });
  } catch {
    /* xabar ketmasa ham ruxsat saqlanadi */
  }
  return zoneViewForUser(opts.userId, now);
}

export async function markZoneConfirmed(userId: number): Promise<ZoneView> {
  const now = new Date();
  const [rule] = await db
    .select()
    .from(zonePresenceRulesTable)
    .where(eq(zonePresenceRulesTable.userId, userId))
    .limit(1);
  if (!rule?.enabled) {
    throw Object.assign(new Error("Sizga hudud tasdiqi yoqilmagan"), { status: 400, code: "zone_off" });
  }
  if (isZoneBlocked(rule, now)) {
    throw Object.assign(new Error(ZONE_BLOCK_TEXT), { status: 403, code: "zone_blocked" });
  }
  if (!rule.promptAt || !rule.dueAt || now.getTime() > rule.dueAt.getTime()) {
    throw Object.assign(new Error("Hozir tasdiqlash oynasi ochiq emas"), { status: 400, code: "zone_not_due" });
  }
  await db
    .update(zonePresenceRulesTable)
    .set({
      lastConfirmedAt: now,
      cycleStartedAt: now,
      promptAt: null,
      dueAt: null,
      promptNotifiedAt: null,
      updatedAt: now,
    })
    .where(eq(zonePresenceRulesTable.userId, userId));
  return zoneViewForUser(userId, now);
}

export async function loadZoneListFlags(userIds: number[]): Promise<
  Map<number, { enabled: boolean; intervalHours: number; windowMinutes: number; method: ZoneMethod; status: ZoneStatus }>
> {
  const out = new Map<number, { enabled: boolean; intervalHours: number; windowMinutes: number; method: ZoneMethod; status: ZoneStatus }>();
  if (!userIds.length) return out;
  const rules = await db
    .select()
    .from(zonePresenceRulesTable)
    .where(inArray(zonePresenceRulesTable.userId, userIds));
  const empIds = rules.map((r) => r.employeeId).filter((id): id is number => id != null);
  const opens = await openCheckIns(empIds, tashkentToday());
  for (const rule of rules) {
    const checkIn = rule.employeeId ? opens.get(rule.employeeId) ?? null : null;
    const view = viewFrom(rule, checkIn);
    out.set(rule.userId, {
      enabled: view.enabled,
      intervalHours: rule.intervalHours,
      windowMinutes: rule.windowMinutes,
      method: parseZoneMethod(rule.method),
      status: view.status,
    });
  }
  return out;
}

let lastSweepAt = 0;

/** Davomat ochilganda va cron orasida ham oyna o‘z vaqtida ochilsin. */
export async function sweepZonePresenceSoon(): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < 15_000) return;
  lastSweepAt = now;
  await sweepZonePresence();
}

export async function sweepZonePresence(): Promise<{ prompted: number; blocked: number }> {
  const now = new Date();
  const today = tashkentToday(now);
  const rules = await db.select().from(zonePresenceRulesTable).where(eq(zonePresenceRulesTable.enabled, true));
  const empIds = rules.map((r) => r.employeeId).filter((id): id is number => id != null);
  const opens = await openCheckIns(empIds, today);
  let prompted = 0;
  let blocked = 0;

  for (const rule of rules) {
    const checkIn = rule.employeeId ? opens.get(rule.employeeId) ?? null : null;
    if (rule.unlockedOn === today && isZoneBlocked(rule, now) === false && rule.blockedOn === today) {
      /* admin ochgan */
    }
    if (!checkIn) {
      if (rule.promptAt) {
        await db
          .update(zonePresenceRulesTable)
          .set({ promptAt: null, dueAt: null, promptNotifiedAt: null, updatedAt: now })
          .where(eq(zonePresenceRulesTable.userId, rule.userId));
      }
      continue;
    }
    if (isZoneBlocked(rule, now)) {
      if (rule.blockedOn !== today) {
        await db
          .update(zonePresenceRulesTable)
          .set({
            blockedOn: today,
            blockedAt: now,
            promptAt: null,
            dueAt: null,
            promptNotifiedAt: null,
            blockNotifiedOn: today,
            updatedAt: now,
          })
          .where(eq(zonePresenceRulesTable.userId, rule.userId));
        blocked += 1;
        if (rule.blockNotifiedOn !== today) {
          await notifyUser({
            userId: rule.userId,
            title: "Bugun bloklandi",
            text: ZONE_BLOCK_TEXT,
            type: "zone_presence_blocked",
            linkUrl: "/davomat-face",
          }).catch(() => undefined);
        }
      }
      continue;
    }
    const cycle = rule.cycleStartedAt;
    if (!cycle || checkIn.getTime() > cycle.getTime()) {
      await db
        .update(zonePresenceRulesTable)
        .set({
          cycleStartedAt: checkIn,
          promptAt: null,
          dueAt: null,
          promptNotifiedAt: null,
          updatedAt: now,
        })
        .where(eq(zonePresenceRulesTable.userId, rule.userId));
      continue;
    }
    if (rule.promptAt && rule.dueAt && now.getTime() > rule.dueAt.getTime()) {
      await db
        .update(zonePresenceRulesTable)
        .set({
          blockedOn: today,
          blockedAt: now,
          promptAt: null,
          dueAt: null,
          promptNotifiedAt: null,
          blockNotifiedOn: today,
          updatedAt: now,
        })
        .where(eq(zonePresenceRulesTable.userId, rule.userId));
      blocked += 1;
      await notifyUser({
        userId: rule.userId,
        title: "Bugun bloklandi",
        text: ZONE_BLOCK_TEXT,
        type: "zone_presence_blocked",
        linkUrl: "/davomat-face",
      }).catch(() => undefined);
      continue;
    }
    const dueStart = cycle.getTime() + rule.intervalHours * 3_600_000;
    if (!rule.promptAt && now.getTime() >= dueStart) {
      const dueAt = new Date(now.getTime() + rule.windowMinutes * 60_000);
      await db
        .update(zonePresenceRulesTable)
        .set({
          promptAt: now,
          dueAt,
          promptNotifiedAt: now,
          updatedAt: now,
        })
        .where(eq(zonePresenceRulesTable.userId, rule.userId));
      prompted += 1;
      const method = parseZoneMethod(rule.method);
      await notifyUser({
        userId: rule.userId,
        title: "Hududni tasdiqlang",
        text: `${ZONE_DUE_TEXT} Davomat bo‘limida ${methodLabel(method)} orqali ${rule.windowMinutes} daqiqa ichida tasdiqlang.`,
        type: "zone_presence_due",
        linkUrl: "/davomat-face",
      }).catch(() => undefined);
    }
  }
  return { prompted, blocked };
}
