/**
 * Koordinatorlar hisobot guruhi (forum) — bot u yerda faqat hisobot yuboradi, hech narsaga javob bermaydi.
 * Guruh va «Koordinatorlar» mavzusi webhook orqali avtomatik aniqlanadi
 * yoki admin/HR mavzu ichida /hisobot_guruh yozib belgilaydi.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { deleteMessage, getChatMember, type TelegramChat, type TelegramMessage } from "./telegram";
import { isHrManager } from "./roles";

export type ReportGroup = { chatId: string; chatTitle: string; threadId: number | null; topicName: string };

const TOPIC_RE = /k[oa]rdinator|координатор|кординатор/i;
const SILENT_TITLE_RE = /vaksinamed|вакцинамед|ваксинамед/i;
const REGISTER_CMD_RE = /^\/hisobot_guruh(@\w+)?(\s|$)/i;

let schemaReady: Promise<void> | null = null;
let cached: { group: ReportGroup | null; at: number } | null = null;
const CACHE_MS = 60_000;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool
      .query(`
CREATE TABLE IF NOT EXISTS telegram_report_group (
  id INTEGER PRIMARY KEY DEFAULT 1,
  chat_id TEXT NOT NULL,
  chat_title TEXT,
  thread_id INTEGER,
  topic_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS telegram_group_topics (
  chat_id TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chat_id, thread_id)
);`)
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

export async function getReportGroup(): Promise<ReportGroup | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.group;
  await ensureSchema();
  const { rows } = await pool.query(`SELECT chat_id, chat_title, thread_id, topic_name FROM telegram_report_group WHERE id = 1`);
  const r = rows[0];
  const group = r
    ? { chatId: String(r.chat_id), chatTitle: String(r.chat_title || ""), threadId: r.thread_id ?? null, topicName: String(r.topic_name || "") }
    : null;
  cached = { group, at: Date.now() };
  return group;
}

async function setReportGroup(chat: TelegramChat, threadId: number | null, topicName: string): Promise<void> {
  const current = await getReportGroup();
  if (current && current.chatId === String(chat.id) && current.threadId === threadId) return;
  await pool.query(
    `INSERT INTO telegram_report_group (id, chat_id, chat_title, thread_id, topic_name, updated_at)
     VALUES (1, $1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET chat_id = EXCLUDED.chat_id, chat_title = EXCLUDED.chat_title,
       thread_id = EXCLUDED.thread_id, topic_name = EXCLUDED.topic_name, updated_at = NOW()`,
    [String(chat.id), chat.title || "", threadId, topicName],
  );
  cached = null;
  logger.info({ chatId: chat.id, title: chat.title, threadId, topicName }, "Koordinator hisobot guruhi belgilandi");
}

function topicNameOf(msg: TelegramMessage): string | null {
  if (msg.forum_topic_created?.name) return msg.forum_topic_created.name;
  if (msg.forum_topic_edited?.name) return msg.forum_topic_edited.name;
  const root = msg.reply_to_message;
  if (root?.forum_topic_created?.name && root.message_id === msg.message_thread_id) return root.forum_topic_created.name;
  return null;
}

/** Hisobot guruhimi — bu yerda bot hech narsaga javob bermaydi */
export async function isReportChat(chat: TelegramChat): Promise<boolean> {
  if (SILENT_TITLE_RE.test(chat.title || "")) return true;
  try {
    const group = await getReportGroup();
    return !!group && group.chatId === String(chat.id);
  } catch {
    return false;
  }
}

/** Guruh xabaridan mavzu nomini eslab qoladi va «Koordinatorlar» mavzusini hisobot manzili qiladi */
export async function observeGroupMessage(msg: TelegramMessage): Promise<void> {
  try {
    await ensureSchema();
    const threadId = msg.is_topic_message && msg.message_thread_id ? msg.message_thread_id : null;
    const name = topicNameOf(msg);
    const chatId = String(msg.chat.id);

    if (name && threadId) {
      await pool.query(
        `INSERT INTO telegram_group_topics (chat_id, thread_id, name, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (chat_id, thread_id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
        [chatId, threadId, name],
      );
    }

    const text = String(msg.text || "").trim();
    if (REGISTER_CMD_RE.test(text) && msg.from) {
      const forumGeneral = msg.chat.is_forum && !threadId;
      let allowed = SILENT_TITLE_RE.test(msg.chat.title || "");
      if (!allowed) {
        const { rows } = await pool.query(`SELECT role FROM users WHERE telegram_id = $1 LIMIT 1`, [String(msg.from.id)]);
        allowed =
          (rows[0] && isHrManager(rows[0].role)) ||
          (await getChatMember(msg.chat.id, msg.from.id)
            .then((m) => m.status === "creator" || m.status === "administrator")
            .catch(() => false));
      }
      logger.info(
        { chatId, title: msg.chat.title, threadId, from: msg.from.id, allowed, forumGeneral },
        "telegram-report-group: /hisobot_guruh",
      );
      if (allowed && !forumGeneral) {
        await setReportGroup(msg.chat, threadId, name || (threadId ? await knownTopicName(chatId, threadId) : "") || "");
        await deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
      }
      return;
    }

    let topic = name;
    if (!topic && threadId) topic = await knownTopicName(chatId, threadId);
    if (topic && threadId && TOPIC_RE.test(topic)) await setReportGroup(msg.chat, threadId, topic);
  } catch (err) {
    logger.warn({ err }, "telegram-report-group: guruh xabari o‘qilmadi");
  }
}

async function knownTopicName(chatId: string, threadId: number): Promise<string | null> {
  const { rows } = await pool.query(`SELECT name FROM telegram_group_topics WHERE chat_id = $1 AND thread_id = $2`, [chatId, threadId]);
  return rows[0]?.name ?? null;
}
