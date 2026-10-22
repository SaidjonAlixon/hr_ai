/**
 * Konferensiya yozuvi: vaqtinchalik fayl → MP4 (ffmpeg) → Telegram → diskdan o‘chirish.
 * Platformada video saqlanmaydi — faqat statistika (DB) qoladi.
 */
import { spawn } from "node:child_process";
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
  extra?: { sentAt?: Date | null; fileId?: string | null; clearFileId?: boolean },
): Promise<void> {
  await pool.query(
    `UPDATE conferences
        SET recording_status = $2,
            recording_sent_at = COALESCE($3, recording_sent_at),
            recording_telegram_file_id = CASE
              WHEN $5 THEN NULL
              ELSE COALESCE($4, recording_telegram_file_id)
            END,
            updated_at = NOW()
      WHERE id = $1`,
    [confId, status, extra?.sentAt ?? null, extra?.fileId ?? null, Boolean(extra?.clearFileId)],
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

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr?.on("data", (d) => {
      err += String(d);
      if (err.length > 4000) err = err.slice(-4000);
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-500)}`));
    });
  });
}

/** WebM/boshqa → aniq MP4 (H.264 + AAC), Telegram uchun mos */
export async function convertRecordingToMp4(inputPath: string): Promise<string> {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === ".mp4") return inputPath;

  const outPath = inputPath.replace(/\.[^.]+$/i, "") + ".mp4";
  try {
    await runFfmpeg([
      "-y",
      "-fflags",
      "+genpts+igndts",
      "-err_detect",
      "ignore_err",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-shortest",
      outPath,
    ]);
    await safeUnlink(inputPath);
    return outPath;
  } catch (err) {
    // Ba’zan ffmpeg exit≠0 lekin MP4 yozilgan bo‘ladi
    try {
      const st = await fs.stat(outPath);
      if (st.size > 10_000) {
        logger.warn({ err, inputPath, outPath, bytes: st.size }, "ffmpeg exit error but mp4 usable");
        await safeUnlink(inputPath);
        return outPath;
      }
    } catch {
      /* no out */
    }
    logger.warn({ err, inputPath }, "ffmpeg MP4 convert failed — original file used");
    return inputPath;
  }
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

  let sendPath = filePath;
  try {
    await setRecordingStatus(conf.id, "converting");
    sendPath = await convertRecordingToMp4(filePath);
  } catch (err) {
    logger.warn({ err, code: conf.code }, "recording convert step failed");
    sendPath = filePath;
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(sendPath);
  } catch (err) {
    logger.error({ err, code: conf.code }, "conference recording read failed");
    await setRecordingStatus(conf.id, "failed");
    await safeUnlink(sendPath);
    if (sendPath !== filePath) await safeUnlink(filePath);
    return { ok: false, error: "Yozuv fayli o‘qilmadi" };
  }

  const mins = Math.max(1, Math.round((meta.actualSeconds || 0) / 60));
  const caption = [
    `<b>🎥 Konferensiya yozuvi (MP4)</b>`,
    `<b>${escapeHtml(conf.title)}</b>`,
    `Tashkilotchi: ${escapeHtml(meta.hostName)}`,
    `Kod: <code>${escapeHtml(conf.code)}</code>`,
    `Davomiyligi: ~${mins} daqiqa`,
    `Qatnashdi: ${meta.attendedCount} / ${meta.invitedCount} taklif`,
    ``,
    `Full HD yozuv. Platformada video saqlanmaydi — faqat statistika qoladi.`,
  ].join("\n");

  const isMp4 = sendPath.toLowerCase().endsWith(".mp4");
  const filename = `konferensiya_${conf.code}_${Date.now()}.${isMp4 ? "mp4" : "webm"}`;
  const mimeType = isMp4 ? "video/mp4" : "video/webm";
  try {
    await setRecordingStatus(conf.id, "sending");
    let sentAs: "video" | "document" = "document";
    // MP4 va ≤45MB → sendVideo (guruhda player); aks holda / muvaffaqiyatsiz → sendDocument (ishonchli)
    const tryVideo = isMp4 && buf.length <= 45 * 1024 * 1024;
    if (tryVideo) {
      try {
        await sendVideo(chatId, buf, filename, { caption, parseMode: "HTML", mimeType });
        sentAs = "video";
      } catch (vidErr) {
        logger.warn({ err: vidErr, code: conf.code, bytes: buf.length }, "sendVideo failed — sendDocument");
        await sendDocument(chatId, buf, filename, { caption, parseMode: "HTML", mimeType });
      }
    } else {
      await sendDocument(chatId, buf, filename, { caption, parseMode: "HTML", mimeType });
    }
    await setRecordingStatus(conf.id, "sent", { sentAt: new Date(), fileId: null });
    logger.info(
      { code: conf.code, chatId, bytes: buf.length, mp4: isMp4, sentAs },
      "conference recording sent to Telegram",
    );
  } catch (err) {
    logger.error({ err, code: conf.code, chatId, bytes: buf.length }, "conference recording Telegram send failed");
    await setRecordingStatus(conf.id, "failed");
    // Muvaffaqiyatsiz — faylni saqlab qolamiz (qayta urinish / tashxis)
    try {
      await sendMessage(
        chatId,
        `⚠️ <b>Konferensiya yozuvi yuborilmadi</b>\nKod: <code>${escapeHtml(conf.code)}</code>\n${escapeHtml(err instanceof Error ? err.message : "xato")}\nHajm: ${Math.round(buf.length / 1024 / 1024)} MB`,
      ).catch(() => undefined);
    } catch {
      /* */
    }
    return { ok: false, error: err instanceof Error ? err.message : "Telegramga yuborilmadi" };
  }

  // Faqat shu yozuv fayllarini o‘chirish (boshqa parallel yozuvlarni yo‘qotmasin!)
  await safeUnlink(sendPath);
  if (sendPath !== filePath) await safeUnlink(filePath);
  await pool.query(
    `UPDATE conferences
        SET recording_telegram_file_id = NULL,
            recording_status = 'sent_purged',
            updated_at = NOW()
      WHERE id = $1`,
    [conf.id],
  );
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
