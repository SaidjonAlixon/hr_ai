/**
 * Jarima tizimining umumiy kaliti (Oylik → Intizom nazorati).
 * O‘chiq: jarima, tushuntirish xati, «Keldim» bloki va platforma bloki hech kimda ishlamaydi.
 * Yoqilgan kundan boshlab hisoblanadi — o‘chiq turgan kunlar keyin ham hisobga kirmaydi.
 */
import { pool } from "@workspace/db";

type OffRange = { from: string; to: string | null };

export type JarimaSwitch = {
  enabled: boolean;
  offRanges: OffRange[];
  updatedByName: string | null;
  updatedAt: string | null;
};

const DEFAULT_SWITCH: JarimaSwitch = { enabled: true, offRanges: [], updatedByName: null, updatedAt: null };
const CACHE_MS = 10_000;

let ready: Promise<void> | null = null;
let cache: { at: number; value: JarimaSwitch } | null = null;

function todayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

function previousYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function ensureTable(): Promise<void> {
  ready ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS jarima_switch (
         id INT PRIMARY KEY,
         enabled BOOLEAN NOT NULL DEFAULT TRUE,
         off_ranges JSONB NOT NULL DEFAULT '[]'::jsonb,
         updated_by_name TEXT,
         updated_at TIMESTAMPTZ
       )`,
    )
    .then(() => undefined)
    .catch((err) => {
      ready = null;
      throw err;
    });
  return ready;
}

function parseRanges(raw: unknown): OffRange[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({ from: String((r as OffRange)?.from || ""), to: (r as OffRange)?.to ? String((r as OffRange).to) : null }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.from));
}

export async function getJarimaSwitch(): Promise<JarimaSwitch> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    await ensureTable();
    const { rows } = await pool.query(`SELECT enabled, off_ranges, updated_by_name, updated_at FROM jarima_switch WHERE id = 1`);
    const r = rows[0];
    const value: JarimaSwitch = r
      ? {
          enabled: Boolean(r.enabled),
          offRanges: parseRanges(r.off_ranges),
          updatedByName: (r.updated_by_name as string) || null,
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        }
      : DEFAULT_SWITCH;
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? DEFAULT_SWITCH;
  }
}

export async function isJarimaEnabled(): Promise<boolean> {
  return (await getJarimaSwitch()).enabled;
}

/** O‘chirilgan kun hisobga kirmaydi; qayta yoqilgan kundan boshlab yana hisoblanadi */
export function isJarimaOffDay(sw: JarimaSwitch, ymd: string): boolean {
  return sw.offRanges.some((r) => r.from <= ymd && (r.to == null || ymd <= r.to));
}

export async function setJarimaEnabled(enabled: boolean, byName: string): Promise<JarimaSwitch> {
  await ensureTable();
  cache = null;
  const current = await getJarimaSwitch();
  if (current.enabled === enabled) return current;
  const today = todayYmd();
  const ranges = current.offRanges.map((r) => ({ ...r }));
  if (!enabled) {
    ranges.push({ from: today, to: null });
  } else {
    const open = [...ranges].reverse().find((r) => r.to == null);
    if (open) open.to = previousYmd(today);
  }
  await pool.query(
    `INSERT INTO jarima_switch (id, enabled, off_ranges, updated_by_name, updated_at)
     VALUES (1, $1, $2::jsonb, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, off_ranges = EXCLUDED.off_ranges,
       updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()`,
    [enabled, JSON.stringify(ranges), byName],
  );
  cache = null;
  return getJarimaSwitch();
}
