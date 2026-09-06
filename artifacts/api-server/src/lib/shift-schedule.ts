/**
 * Admin sozlagan smena/ofis vaqtlarini DB dan yuklash (cache).
 * Faqat mudir/farmasevt/stajyor — smena; ofis — belgilangan vaqt.
 */
import { eq } from "drizzle-orm";
import { db, attendancePaySettingsTable } from "@workspace/db";
import {
  buildShiftDefs,
  type ShiftScheduleOverrides,
  type ShiftKey,
  type ShiftDefinition,
} from "./attendance-engine";

let cache: { at: number; overrides: ShiftScheduleOverrides } | null = null;
const TTL_MS = 30_000;

function hmOr(v: string | null | undefined, fallback: string): string {
  const s = String(v || "").trim();
  return /^\d{1,2}:\d{2}$/.test(s) ? s : fallback;
}

export function overridesFromPayRow(
  row: typeof attendancePaySettingsTable.$inferSelect | undefined | null,
): ShiftScheduleOverrides {
  if (!row) return {};
  return {
    one: {
      startHm: hmOr(row.shiftOneStartHm, "08:00"),
      endHm: hmOr(row.shiftOneEndHm, "17:00"),
    },
    two: {
      startHm: hmOr(row.shiftTwoStartHm, "17:00"),
      endHm: hmOr(row.shiftTwoEndHm, "23:45"),
    },
    three: {
      startHm: hmOr(row.shiftThreeStartHm, "23:00"),
      endHm: hmOr(row.shiftThreeEndHm, "07:00"),
      overnight: row.shiftThreeOvernight ?? true,
    },
    office: {
      startHm: hmOr(row.officeStartHm, "09:00"),
      endHm: hmOr(row.officeEndHm, "18:00"),
    },
    graceMinutes: row.graceMinutes ?? 15,
  };
}

export function invalidateShiftScheduleCache() {
  cache = null;
}

export async function loadShiftScheduleOverrides(force = false): Promise<ShiftScheduleOverrides> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.overrides;
  try {
    const [row] = await db
      .select()
      .from(attendancePaySettingsTable)
      .where(eq(attendancePaySettingsTable.id, 1))
      .limit(1);
    const overrides = overridesFromPayRow(row);
    cache = { at: Date.now(), overrides };
    return overrides;
  } catch {
    return cache?.overrides || {};
  }
}

export async function getEffectiveShiftDefs(): Promise<Record<ShiftKey, ShiftDefinition>> {
  return buildShiftDefs(await loadShiftScheduleOverrides());
}

export function warnHmBefore(startHm: string, minutesBefore = 15): string {
  const [h, m] = startHm.split(":").map(Number);
  let total = (h || 0) * 60 + (m || 0) - minutesBefore;
  if (total < 0) total += 24 * 60;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
