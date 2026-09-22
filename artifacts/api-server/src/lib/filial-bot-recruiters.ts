import { pool } from "@workspace/db";
import { isFilialBotAdmin, parseFilialAdminIds } from "./filial-bot-users";

export type LokatsiyaRecruiter = {
  telegram_user_id: string;
  chat_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  added_by_telegram_id: string | null;
  note: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export function parseFilialRecruiterIds(): Set<number> {
  const raw = process.env.TELEGRAM_FILIAL_RECRUITER_IDS?.trim() || "";
  const ids = new Set<number>();
  for (const part of raw.split(/[,;\s]+/)) {
    const n = Number(part.trim());
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  return ids;
}

function fullName(u: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
}): string {
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return n || (u.username ? `@${u.username}` : "Rekruter");
}

export function recruiterDisplayName(u: LokatsiyaRecruiter): string {
  return fullName(u);
}

export async function isFilialBotRecruiter(telegramUserId?: number | null): Promise<boolean> {
  if (!telegramUserId) return false;
  if (isFilialBotAdmin(telegramUserId)) return true;
  if (parseFilialRecruiterIds().has(telegramUserId)) return true;
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM lokatsiya_bot_recruiters
     WHERE telegram_user_id = $1 AND is_active = TRUE
     LIMIT 1`,
    [telegramUserId],
  );
  return !!rows[0]?.ok;
}

export async function upsertLokatsiyaRecruiter(opts: {
  telegramUserId: number;
  chatId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  addedByTelegramId?: number | null;
  note?: string | null;
}): Promise<LokatsiyaRecruiter> {
  const { rows } = await pool.query<LokatsiyaRecruiter>(
    `INSERT INTO lokatsiya_bot_recruiters (
       telegram_user_id, chat_id, username, first_name, last_name,
       added_by_telegram_id, note, is_active, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW())
     ON CONFLICT (telegram_user_id) DO UPDATE SET
       chat_id = EXCLUDED.chat_id,
       username = COALESCE(EXCLUDED.username, lokatsiya_bot_recruiters.username),
       first_name = COALESCE(EXCLUDED.first_name, lokatsiya_bot_recruiters.first_name),
       last_name = COALESCE(EXCLUDED.last_name, lokatsiya_bot_recruiters.last_name),
       added_by_telegram_id = COALESCE(EXCLUDED.added_by_telegram_id, lokatsiya_bot_recruiters.added_by_telegram_id),
       note = COALESCE(EXCLUDED.note, lokatsiya_bot_recruiters.note),
       is_active = TRUE,
       updated_at = NOW()
     RETURNING telegram_user_id::text, chat_id::text, username, first_name, last_name,
               added_by_telegram_id::text, note, is_active, created_at, updated_at`,
    [
      opts.telegramUserId,
      opts.chatId,
      opts.username || null,
      opts.firstName || null,
      opts.lastName || null,
      opts.addedByTelegramId ?? null,
      opts.note || null,
    ],
  );
  return rows[0]!;
}

/** Rekruter botga /start bosganda chat_id yangilanadi */
export async function touchLokatsiyaRecruiterChat(
  telegramUserId: number,
  chatId: number,
  profile?: { username?: string | null; firstName?: string | null; lastName?: string | null },
): Promise<void> {
  if (!telegramUserId || !chatId) return;
  const envRecruiter = parseFilialRecruiterIds().has(telegramUserId);
  const { rowCount } = await pool.query(
    `UPDATE lokatsiya_bot_recruiters
     SET chat_id = $2,
         username = COALESCE($3, username),
         first_name = COALESCE($4, first_name),
         last_name = COALESCE($5, last_name),
         updated_at = NOW()
     WHERE telegram_user_id = $1 AND is_active = TRUE`,
    [
      telegramUserId,
      chatId,
      profile?.username || null,
      profile?.firstName || null,
      profile?.lastName || null,
    ],
  );
  if (!rowCount && (envRecruiter || isFilialBotAdmin(telegramUserId))) {
    await upsertLokatsiyaRecruiter({
      telegramUserId,
      chatId,
      username: profile?.username,
      firstName: profile?.firstName,
      lastName: profile?.lastName,
      note: envRecruiter ? "env" : "admin",
    });
  }
}

export async function deactivateLokatsiyaRecruiter(telegramUserId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE lokatsiya_bot_recruiters
     SET is_active = FALSE, updated_at = NOW()
     WHERE telegram_user_id = $1`,
    [telegramUserId],
  );
  return (rowCount ?? 0) > 0;
}

export async function listLokatsiyaRecruiters(activeOnly = true): Promise<LokatsiyaRecruiter[]> {
  const { rows } = await pool.query<LokatsiyaRecruiter>(
    `SELECT telegram_user_id::text, chat_id::text, username, first_name, last_name,
            added_by_telegram_id::text, note, is_active, created_at, updated_at
     FROM lokatsiya_bot_recruiters
     ${activeOnly ? "WHERE is_active = TRUE" : ""}
     ORDER BY updated_at DESC`,
  );
  return rows;
}

export async function listRecruiterBroadcastTargets(): Promise<
  Array<{ telegram_user_id: number; chat_id: number; name: string }>
> {
  const dbRows = await listLokatsiyaRecruiters(true);
  const map = new Map<number, { telegram_user_id: number; chat_id: number; name: string }>();

  for (const r of dbRows) {
    const id = Number(r.telegram_user_id);
    const chat = Number(r.chat_id);
    if (!Number.isFinite(id) || !Number.isFinite(chat) || chat === 0) continue;
    map.set(id, { telegram_user_id: id, chat_id: chat, name: recruiterDisplayName(r) });
  }

  // Env recruiters — chat_id faqat DB da bo‘lsa
  for (const id of parseFilialRecruiterIds()) {
    if (!map.has(id)) {
      // lokatsiya_bot_users dan chat topish
      const { rows } = await pool.query<{ chat_id: string; username: string | null; first_name: string | null; last_name: string | null }>(
        `SELECT chat_id::text, username, first_name, last_name
         FROM lokatsiya_bot_users WHERE telegram_user_id = $1 LIMIT 1`,
        [id],
      );
      const u = rows[0];
      if (u?.chat_id) {
        map.set(id, {
          telegram_user_id: id,
          chat_id: Number(u.chat_id),
          name: fullName(u),
        });
      }
    }
  }

  // Adminlar ham monitoring olsin
  for (const id of parseFilialAdminIds()) {
    if (map.has(id)) continue;
    const { rows } = await pool.query<{ chat_id: string; username: string | null; first_name: string | null; last_name: string | null }>(
      `SELECT chat_id::text, username, first_name, last_name
       FROM lokatsiya_bot_users WHERE telegram_user_id = $1 LIMIT 1`,
      [id],
    );
    const u = rows[0];
    if (u?.chat_id) {
      map.set(id, {
        telegram_user_id: id,
        chat_id: Number(u.chat_id),
        name: fullName(u),
      });
    }
  }

  return [...map.values()];
}
