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
      `SELECT l.id, l.user_id, l.lock_day, l.strike_n, l.event_date, l.kind, u.role AS user_role
         FROM discipline_locks l
         JOIN users u ON u.id = l.user_id
        WHERE l.user_id = $1 AND l.lock_day = $2 AND l.cleared_at IS NULL
        LIMIT 1`,
      [userId, todayTashkent()],
    );
    r = rows[0];
    // Dorixona xodimlari (mudir, farmasevt, stajyor) endi bloklanmaydi — bloklari ochilgan hisoblanadi
    if (r && DISCIPLINE_ROLES.has(String(r.user_role || "").toLowerCase())) {
      lockCache.set(userId, { at: Date.now(), lock: null });
      return null;
    }
  } catch {
    return null;
  }
  const lock: DisciplineLock | null = r
    ? { id: r.id, userId: r.user_id, lockDay: r.lock_day, strikeN: r.strike_n, eventDate: r.event_date, kind: r.kind }
    : null;
  lockCache.set(userId, { at: Date.now(), lock });
  return lock;
}
