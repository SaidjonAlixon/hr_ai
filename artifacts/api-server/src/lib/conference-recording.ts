/**
 * Konferensiya yozuvi: vaqtinchalik fayl → Telegram (VAKSINA tushuntirish xatlari) → diskdan o‘chirish.
 * Platformada video saqlanmaydi — faqat statistika (DB) qoladi.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { REPORT_CHAT_ID } from "./explanation-letter-report";
import { escapeHtml, isTelegramConfigured, sendDocument, sendMessage, sendVideo } from "./telegram";
import type { Conference } from "./conferences";

const RECORD_DIR =
  process.env.CONFERENCE_RECORDING_DIR?.trim() ||
  path.join(process.env.TMPDIR || process.env.TEMP || "/tmp", "hr-conference-recordings");

export function conferenceReportChatId(): string {
  return process.env.CONFERENCE_VIDEO_CHAT_ID?.trim() || REPORT_CHAT_ID;
}

export async function ensureRecordingDir(): Promise<string> {
  await fs.mkdir(RECORD_DIR, { recursive: true });
  return RECORD_DIR;
}

export async function ensureRecordingSchema(): Promise<void> {
  await pool.query(`
    ALTER TABLE conferences ADD COLUMN IF NOT EXISTS recording_status TEXT;
    ALTER TABLE conferences ADD COLUMN IF NOT EXISTS recording_sent_at TIMESTAMPTZ;
    ALTER TABLE conferences ADD COLUMN IF NOT EXISTS recording_telegram_file_id TEXT;
  `);
}

async function setRecordingStatus(
  confId: number,
  status: string,
  extra?: { sentAt?: Date | null; fileId?: string | null },
): Promise<void> {
  await pool.query(
    `UPDATE conferences
        SET recording_status = $2,
            recording_sent_at = COALESCE($3, recording_sent_at),
            recording_telegram_file_id = COALESCE($4, recording_telegram_file_id),
            updated_at = NOW()
      WHERE id = $1`,
    [confId, status, extra?.sentAt ?? null, extra?.fileId ?? null],
  );
}

export async function saveConferenceRecordingUpload(
  conf: Conference,
  input: { buffer: Buffer; filename: string; mimeType?: string },
): Promise<{ path: string; bytes: number }> {
  await ensureRecordingSchema();
  const dir = await ensureRecordingDir();
  const ext = path.extname(input.filename || "") || (input.mimeType?.includes("mp4") ? ".mp4" : ".webm");
  const dest = path.join(dir, `${conf.code}-${Date.now()}${ext}`);
  await fs.writeFile(dest, input.buffer);
  await setRecordingStatus(conf.id, "uploaded");
  logger.info({ code: conf.code, bytes: input.buffer.length, dest }, "conference recording uploaded (temp)");
  return { path: dest, bytes: input.buffer.length };
}

export async function deliverConferenceRecordingAndPurge(
  conf: Conference,
  filePath: string,
  meta: {
    attendedCount: number;
    invitedCount: number;
    actualSeconds: number;
    hostName: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  await ensureRecordingSchema();
  const chatId = conferenceReportChatId();
  if (!isTelegramConfigured()) {
    await safeUnlink(filePath);
    await setRecordingStatus(conf.id, "failed");
    return { ok: false, error: "Telegram bot sozlanmagan" };
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch (err) {
    logger.error({ err, code: conf.code }, "conference recording read failed");
    await setRecordingStatus(conf.id, "failed");
    return { ok: false, error: "Yozuv fayli o‘qilmadi" };
  }

  const mins = Math.max(1, Math.round((meta.actualSeconds || 0) / 60));
  const caption = [
    `<b>🎥 Konferensiya yozuvi</b>`,
    `<b>${escapeHtml(conf.title)}</b>`,
    `Tashkilotchi: ${escapeHtml(meta.hostName)}`,
    `Kod: <code>${escapeHtml(conf.code)}</code>`,
    `Davomiyligi: ~${mins} daqiqa`,
    `Qatnashdi: ${meta.attendedCount} / ${meta.invitedCount} taklif`,
    ``,
    `Yozuv guruhga yuborildi. Platformada video saqlanmaydi — faqat statistika qoladi.`,
  ].join("\n");

  const filename = `konferensiya_${conf.code}_${Date.now()}.webm`;
  try {
    await setRecordingStatus(conf.id, "sending");
    try {
      if (buf.length <= 48 * 1024 * 1024) {
        await sendVideo(chatId, buf, filename, {
          caption,
          parseMode: "HTML",
          mimeType: filename.endsWith(".mp4") ? "video/mp4" : "video/webm",
        });
      } else {
        throw new Error("too-large-for-sendVideo");
      }
    } catch {
      await sendDocument(chatId, buf, filename, {
        caption,
        parseMode: "HTML",
        mimeType: "video/webm",
      });
    }
    await setRecordingStatus(conf.id, "sent", { sentAt: new Date() });
    logger.info({ code: conf.code, chatId, bytes: buf.length }, "conference recording sent to Telegram");
  } catch (err) {
    logger.error({ err, code: conf.code, chatId }, "conference recording Telegram send failed");
    await setRecordingStatus(conf.id, "failed");
    // Xato bo‘lsa ham platformada saqlamaymiz
    await safeUnlink(filePath);
    return { ok: false, error: err instanceof Error ? err.message : "Telegramga yuborilmadi" };
  }

  await safeUnlink(filePath);
  return { ok: true };
}

export async function sendConferenceStatsToGroup(
  conf: Conference,
  meta: {
    attendedCount: number;
    invitedCount: number;
    actualSeconds: number;
    hostName: string;
    attendanceLines: string[];
  },
): Promise<void> {
  if (!isTelegramConfigured()) return;
  const chatId = conferenceReportChatId();
  const mins = Math.max(0, Math.round((meta.actualSeconds || 0) / 60));
  const people = meta.attendanceLines.slice(0, 40).join("\n") || "—";
  const text = [
    `<b>📊 Konferensiya statistikasi</b>`,
    `<b>${escapeHtml(conf.title)}</b>`,
    `Tashkilotchi: ${escapeHtml(meta.hostName)}`,
    `Kod: <code>${escapeHtml(conf.code)}</code>`,
    `Davomiyligi: ${mins} daqiqa`,
    `Qatnashdi: ${meta.attendedCount} / ${meta.invitedCount}`,
    ``,
    `<b>Qatnashuvchilar</b>`,
    escapeHtml(people),
  ].join("\n");
  try {
    await sendMessage(chatId, text, { parse_mode: "HTML" });
  } catch (err) {
    logger.warn({ err, code: conf.code }, "conference stats Telegram failed");
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    /* ignore */
  }
}
