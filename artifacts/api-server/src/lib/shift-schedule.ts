/**
 * Admin sozlagan smena/ofis vaqtlarini DB dan yuklash (cache).
 * Faqat mudir/farmasevt/stajyor — smena; ofis — belgilangan vaqt.
 */
import { eq } from "drizzle-orm";
import { db, pool, attendancePaySettingsTable } from "@workspace/db";
import {
  DEFAULT_PAY_SETTINGS,
  buildShiftDefs,
  type AttendancePaySettings,
  type ShiftScheduleOverrides,
  type ShiftKey,
  type ShiftDefinition,
} from "./attendance-engine";

let cache: { at: number; overrides: ShiftScheduleOverrides; settings: AttendancePaySettings } | null = null;
const TTL_MS = 30_000;

/** O‘rta smena — admin istalgan soatdan istalgan soatgacha qo‘yadi. null = 1-smena vaqti. */
export type ExtraShiftHours = {
  start: string;
  end: string;
  updatedByName: string | null;
  updatedAt: string | null;
};

export const ORTA_HOURS_SCOPE = "dorixona:orta";

let ortaHours: ExtraShiftHours | null = null;
let hourTableReady: Promise<void> | null = null;

function ensureShiftHourTable(): Promise<void> {
  if (!hourTableReady) {
    hourTableReady = pool
      .query(
        `CREATE TABLE IF NOT EXISTS shift_hour_settings (
           scope TEXT PRIMARY KEY,
           start_hm TEXT NOT NULL,
           end_hm TEXT NOT NULL,
           updated_by_id INTEGER,
           updated_by_name TEXT,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`,
      )
      .then(() => undefined)
      .catch((err) => {
        hourTableReady = null;
        throw err;
      });
  }
  return hourTableReady;
}

async function readOrtaHours(): Promise<ExtraShiftHours | null> {
  await ensureShiftHourTable();
  const { rows } = await pool.query(
    `SELECT start_hm, end_hm, updated_by_name, updated_at FROM shift_hour_settings WHERE scope = $1`,
    [ORTA_HOURS_SCOPE],
  );
  const row = rows[0];
  if (!row) return null;
  const start = hmOr(row.start_hm, "");
  const end = hmOr(row.end_hm, "");
  if (!start || !end) return null;
  return {
    start,
    end,
    updatedByName: row.updated_by_name || null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ? String(row.updated_at) : null,
  };
}

/** Sinxron: oxirgi yuklangan O‘rta smena vaqti (loadShiftScheduleOverrides dan keyin to‘g‘ri) */
export function ortaShiftHours(): ExtraShiftHours | null {
  return ortaHours;
}

export async function saveOrtaShiftHours(
  hours: { start: string; end: string } | null,
  actor: { id: number | null; name: string | null },
): Promise<ExtraShiftHours | null> {
  await ensureShiftHourTable();
  if (!hours) {
    await pool.query(`DELETE FROM shift_hour_settings WHERE scope = $1`, [ORTA_HOURS_SCOPE]);
  } else {
    await pool.query(
      `INSERT INTO shift_hour_settings (scope, start_hm, end_hm, updated_by_id, updated_by_name, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (scope) DO UPDATE SET
         start_hm = EXCLUDED.start_hm,
         end_hm = EXCLUDED.end_hm,
         updated_by_id = EXCLUDED.updated_by_id,
         updated_by_name = EXCLUDED.updated_by_name,
         updated_at = NOW()`,
      [ORTA_HOURS_SCOPE, hours.start, hours.end, actor.id, actor.name],
    );
  }
  invalidateShiftScheduleCache();
  await loadShiftScheduleOverrides(true);
  return ortaHours;
}

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

export function paySettingsFromRow(
  row: typeof attendancePaySettingsTable.$inferSelect | undefined | null,
): AttendancePaySettings {
  if (!row) return { ...DEFAULT_PAY_SETTINGS, shiftSchedule: {} };
  return {
    unpaidBreakByShift: {
      one: row.unpaidBreakOneMin,
      two: row.unpaidBreakTwoMin,
      three: row.unpaidBreakThreeMin,
      office: row.unpaidBreakOfficeMin,
    },
    breakPaid: row.breakPaid,
    nightStartHm: row.nightStartHm,
    nightEndHm: row.nightEndHm,
    nightCoefficient: row.nightCoefficient,
    dailyNormMinutes: row.dailyNormMinutes,
    overtimeEnabled: row.overtimeEnabled,
    graceMinutes: row.graceMinutes,
    minRestHoursBetweenShifts: row.minRestHours,
    maxShiftsPerDay: row.maxShiftsPerDay,
    missingCheckoutStatus: "incomplete",
    shiftSchedule: overridesFromPayRow(row),
  };
}

/** Sinxron: oxirgi yuklangan davomat sozlamasi (tushlik, kechikish, smena oynalari) */
export function cachedPaySettings(): AttendancePaySettings | undefined {
  return cache?.settings;
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
    try {
      ortaHours = await readOrtaHours();
    } catch (err) {
      console.error("readOrtaHours", err);
    }
    cache = { at: Date.now(), overrides, settings: paySettingsFromRow(row) };
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
