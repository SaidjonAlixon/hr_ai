import { pool } from "@workspace/db";
import type { FilialTelegramUser } from "./telegram-filial";

export type LokatsiyaBotUser = {
  telegram_user_id: string;
  chat_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  starts_count: number;
  branch_views: number;
  last_action: string | null;
  is_blocked: boolean;
  blocked_at: Date | null;
  first_start_at: Date;
  last_start_at: Date;
  last_seen_at: Date;
};

export function parseFilialAdminIds(): Set<number> {
  const raw = process.env.TELEGRAM_FILIAL_ADMIN_IDS?.trim() || "";
  const ids = new Set<number>();
  for (const part of raw.split(/[,;\s]+/)) {
    const n = Number(part.trim());
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  return ids;
}

export function isFilialBotAdmin(telegramUserId?: number | null): boolean {
  if (!telegramUserId) return false;
  return parseFilialAdminIds().has(telegramUserId);
}

function fullName(u: Pick<LokatsiyaBotUser, "first_name" | "last_name" | "username">): string {
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return n || (u.username ? `@${u.username}` : "Noma’lum");
}

export function lokatsiyaUserDisplayName(u: LokatsiyaBotUser): string {
  return fullName(u);
}

export async function upsertLokatsiyaBotUser(
  user: FilialTelegramUser,
  chatId: number,
  opts?: { isStart?: boolean; action?: string; branchView?: boolean },
): Promise<void> {
  const username = user.username || null;
  const firstName = user.first_name || null;
  const lastName = user.last_name || null;
  const lang = user.language_code || null;
  const action = opts?.action || (opts?.isStart ? "start" : "seen");
  const startInc = opts?.isStart ? 1 : 0;
  const viewInc = opts?.branchView ? 1 : 0;

  await pool.query(
    `INSERT INTO lokatsiya_bot_users (
       telegram_user_id, chat_id, username, first_name, last_name, language_code,
       starts_count, branch_views, last_action, is_blocked, blocked_at,
       first_start_at, last_start_at, last_seen_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, FALSE, NULL,
       NOW(), NOW(), NOW(), NOW()
     )
     ON CONFLICT (telegram_user_id) DO UPDATE SET
       chat_id = EXCLUDED.chat_id,
       username = COALESCE(EXCLUDED.username, lokatsiya_bot_users.username),
       first_name = COALESCE(EXCLUDED.first_name, lokatsiya_bot_users.first_name),
       last_name = COALESCE(EXCLUDED.last_name, lokatsiya_bot_users.last_name),
       language_code = COALESCE(EXCLUDED.language_code, lokatsiya_bot_users.language_code),
       starts_count = lokatsiya_bot_users.starts_count + $7,
       branch_views = lokatsiya_bot_users.branch_views + $8,
       last_action = EXCLUDED.last_action,
       is_blocked = FALSE,
       blocked_at = NULL,
       last_start_at = CASE WHEN $7 > 0 THEN NOW() ELSE lokatsiya_bot_users.last_start_at END,
       last_seen_at = NOW(),
       updated_at = NOW()`,
    [user.id, chatId, username, firstName, lastName, lang, startInc, viewInc, action],
  );
}

export async function markLokatsiyaUserBlocked(telegramUserId: number): Promise<void> {
  await pool.query(
    `UPDATE lokatsiya_bot_users
     SET is_blocked = TRUE, blocked_at = NOW(), last_action = 'blocked', updated_at = NOW()
     WHERE telegram_user_id = $1`,
    [telegramUserId],
  );
}

export async function listLokatsiyaBotUsers(): Promise<LokatsiyaBotUser[]> {
  const { rows } = await pool.query<LokatsiyaBotUser>(
    `SELECT telegram_user_id::text, chat_id::text, username, first_name, last_name,
            language_code, starts_count, branch_views, last_action, is_blocked,
            blocked_at, first_start_at, last_start_at, last_seen_at
     FROM lokatsiya_bot_users
     ORDER BY last_seen_at DESC`,
  );
  return rows;
}

export async function listLokatsiyaBroadcastTargets(): Promise<
  Array<{ telegram_user_id: number; chat_id: number; name: string }>
> {
  const { rows } = await pool.query<{
    telegram_user_id: string;
    chat_id: string;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
  }>(
    `SELECT telegram_user_id::text, chat_id::text, username, first_name, last_name
     FROM lokatsiya_bot_users
     WHERE is_blocked = FALSE
     ORDER BY last_seen_at DESC`,
  );
  return rows.map((r) => ({
    telegram_user_id: Number(r.telegram_user_id),
    chat_id: Number(r.chat_id),
    name: fullName(r),
  }));
}

export async function lokatsiyaUserStats(): Promise<{
  total: number;
  active: number;
  blocked: number;
  startsToday: number;
  seenToday: number;
}> {
  const { rows } = await pool.query<{
    total: string;
    active: string;
    blocked: string;
    starts_today: string;
    seen_today: string;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE is_blocked = FALSE)::text AS active,
       COUNT(*) FILTER (WHERE is_blocked = TRUE)::text AS blocked,
       COUNT(*) FILTER (
         WHERE last_start_at >= (NOW() AT TIME ZONE 'Asia/Tashkent')::date
           AT TIME ZONE 'Asia/Tashkent'
       )::text AS starts_today,
       COUNT(*) FILTER (
         WHERE last_seen_at >= (NOW() AT TIME ZONE 'Asia/Tashkent')::date
           AT TIME ZONE 'Asia/Tashkent'
       )::text AS seen_today
     FROM lokatsiya_bot_users`,
  );
  const r = rows[0];
  return {
    total: Number(r?.total || 0),
    active: Number(r?.active || 0),
    blocked: Number(r?.blocked || 0),
    startsToday: Number(r?.starts_today || 0),
    seenToday: Number(r?.seen_today || 0),
  };
}

export function formatTashkent(dt: Date | string | null | undefined): string {
  if (!dt) return "—";
  const d = typeof dt === "string" ? new Date(dt) : dt;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}
