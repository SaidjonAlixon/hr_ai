import { pool } from "@workspace/db";
import { isJarimaEnabled } from "./jarima-switch";

export const DISCIPLINE_ROLES = new Set(["mudir", "farmasevt", "stajyor", "stajor"]);
export const LOCK_MESSAGE = "Intizom qoidalari buzilgani sababli bugun platformadan foydalana olmaysiz. Admin yoki HR bilan bog‘laning.";

export function todayTashkent(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

export type DisciplineLock = {
  id: number;
  userId: number;
  lockDay: string;
  strikeN: number;
  eventDate: string;
  kind: string;
};

const lockCache = new Map<number, { at: number; lock: DisciplineLock | null }>();
const LOCK_CACHE_MS = 20_000;

export function invalidateLockCache(userId?: number) {
  if (userId == null) lockCache.clear();
  else lockCache.delete(userId);
}

export async function activeLockFor(userId: number): Promise<DisciplineLock | null> {
  if (!(await isJarimaEnabled())) return null;
  const hit = lockCache.get(userId);
  if (hit && Date.now() - hit.at < LOCK_CACHE_MS) return hit.lock;
  let r: Record<string, any> | undefined;
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, lock_day, strike_n, event_date, kind
         FROM discipline_locks
        WHERE user_id = $1 AND lock_day = $2 AND cleared_at IS NULL
        LIMIT 1`,
      [userId, todayTashkent()],
    );
    r = rows[0];
  } catch {
    return null;
  }
  const lock: DisciplineLock | null = r
    ? { id: r.id, userId: r.user_id, lockDay: r.lock_day, strikeN: r.strike_n, eventDate: r.event_date, kind: r.kind }
    : null;
  lockCache.set(userId, { at: Date.now(), lock });
  return lock;
}
