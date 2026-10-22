/**
 * Konferensiya yozuvi: vaqtinchalik fayl → MP4 (ffmpeg) → Telegram → diskdan o‘chirish.
 * Admin «Zapislar»da holat/foiz/ETA ko‘rinadi; video platformada saqlanmaydi (yuborilgach o‘chadi).
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

/** Taxminiy Telegram yuklash tezligi (byte/s) — ETA uchun */
const EST_UPLOAD_BPS = 700_000;
/** Convert uchun taxminiy sekund (hajmga bog‘liq) */
function estConvertSec(bytes: number): number {
  return Math.max(8, Math.min(90, Math.round(bytes / (2.5 * 1024 * 1024))));
}
function estUploadSec(bytes: number): number {
  return Math.max(5, Math.min(170, Math.round(bytes / EST_UPLOAD_BPS)));
}

type RecStatus =
  | "uploaded"
  | "converting"
  | "sending"
  | "sent"
  | "sent_purged"
  | "failed"
  | "deleted";

type LiveProgress = {
  recordingId: number;
  phase: RecStatus;
  phaseStartedAt: number;
  bytes: number;
  progress: number;
  etaSec: number;
  timer: ReturnType<typeof setInterval> | null;
};

const live = new Map<number, LiveProgress>();

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

    CREATE TABLE IF NOT EXISTS conference_recordings (
      id SERIAL PRIMARY KEY,
      conference_id INT NOT NULL,
      conference_code TEXT NOT NULL,
      conference_title TEXT,
      host_name TEXT,
      status TEXT NOT NULL DEFAULT 'uploaded',
      progress INT NOT NULL DEFAULT 0,
      bytes INT,
      mime_type TEXT,
      temp_path TEXT,
      error TEXT,
      eta_sec INT,
      uploaded_by INT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      purged_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_conference_recordings_uploaded
      ON conference_recordings (uploaded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conference_recordings_conf
      ON conference_recordings (conference_id, uploaded_at DESC);
  `);
}

async function setConferenceRecordingStatus(
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

async function patchRecordingRow(
  id: number,
  patch: {
    status?: RecStatus;
    progress?: number;
    etaSec?: number | null;
    error?: string | null;
    tempPath?: string | null;
    sentAt?: Date | null;
    purgedAt?: Date | null;
    bytes?: number;
  },
): Promise<void> {
  await pool.query(
    `UPDATE conference_recordings SET
        status = COALESCE($2, status),
        progress = COALESCE($3, progress),
        eta_sec = CASE WHEN $4::boolean THEN $5 ELSE eta_sec END,
        error = CASE WHEN $6::boolean THEN $7 ELSE error END,
        temp_path = CASE WHEN $8::boolean THEN $9 ELSE temp_path END,
        sent_at = COALESCE($10, sent_at),
        purged_at = COALESCE($11, purged_at),
        bytes = COALESCE($12, bytes),
        updated_at = NOW()
      WHERE id = $1`,
    [
      id,
      patch.status ?? null,
      patch.progress ?? null,
      patch.etaSec !== undefined,
      patch.etaSec ?? null,
      patch.error !== undefined,
      patch.error ?? null,
      patch.tempPath !== undefined,
      patch.tempPath ?? null,
      patch.sentAt ?? null,
      patch.purgedAt ?? null,
      patch.bytes ?? null,
    ],
  );
}

function stopLive(recordingId: number): void {
  const cur = live.get(recordingId);
  if (cur?.timer) clearInterval(cur.timer);
  live.delete(recordingId);
}

function computeProgress(lp: LiveProgress): { progress: number; etaSec: number } {
  const elapsed = (Date.now() - lp.phaseStartedAt) / 1000;
  if (lp.phase === "uploaded") return { progress: 5, etaSec: estConvertSec(lp.bytes) + estUploadSec(lp.bytes) };
  if (lp.phase === "converting") {
    const total = estConvertSec(lp.bytes);
    const frac = Math.min(0.95, elapsed / total);
    const progress = Math.round(5 + frac * 30); // 5→35
    const remConvert = Math.max(0, Math.ceil(total - elapsed));
    return { progress, etaSec: remConvert + estUploadSec(lp.bytes) };
  }
  if (lp.phase === "sending") {
    const total = estUploadSec(lp.bytes);
    const frac = Math.min(0.97, elapsed / total);
    const progress = Math.round(35 + frac * 60); // 35→95
    return { progress, etaSec: Math.max(1, Math.ceil(total - elapsed)) };
  }
  if (lp.phase === "sent" || lp.phase === "sent_purged") return { progress: 100, etaSec: 0 };
  return { progress: lp.progress, etaSec: lp.etaSec };
}

function startLiveTicker(recordingId: number, phase: RecStatus, bytes: number): void {
  stopLive(recordingId);
  const lp: LiveProgress = {
    recordingId,
    phase,
    phaseStartedAt: Date.now(),
    bytes,
    progress: phase === "converting" ? 8 : phase === "sending" ? 40 : 5,
    etaSec: estConvertSec(bytes) + estUploadSec(bytes),
    timer: null,
  };
  const tick = () => {
    const cur = live.get(recordingId);
    if (!cur) return;
    const next = computeProgress(cur);
    cur.progress = next.progress;
    cur.etaSec = next.etaSec;
    void patchRecordingRow(recordingId, {
      progress: next.progress,
      etaSec: next.etaSec,
      status: cur.phase,
    }).catch(() => undefined);
  };
  lp.timer = setInterval(tick, 1500);
  live.set(recordingId, lp);
  tick();
}

function setLivePhase(recordingId: number, phase: RecStatus): void {
  const cur = live.get(recordingId);
  if (!cur) return;
  cur.phase = phase;
  cur.phaseStartedAt = Date.now();
  const next = computeProgress(cur);
  cur.progress = next.progress;
  cur.etaSec = next.etaSec;
  void patchRecordingRow(recordingId, {
    status: phase,
    progress: next.progress,
    etaSec: next.etaSec,
  }).catch(() => undefined);
}

export type AdminRecordingItem = {
  id: number;
  conferenceId: number;
  code: string;
  title: string;
  hostName: string | null;
  status: RecStatus;
  progress: number;
  etaSec: number | null;
  bytes: number | null;
  mimeType: string | null;
  error: string | null;
  hasFile: boolean;
  uploadedBy: number | null;
  uploadedAt: string;
  sentAt: string | null;
  purgedAt: string | null;
  updatedAt: string;
};

function enrichFromLive(row: AdminRecordingItem): AdminRecordingItem {
  const lp = live.get(row.id);
  if (!lp) return row;
  const next = computeProgress(lp);
  return {
    ...row,
    status: lp.phase,
    progress: next.progress,
    etaSec: next.etaSec,
  };
}

export async function listAdminRecordings(limit = 100): Promise<AdminRecordingItem[]> {
  await ensureRecordingSchema();
  const { rows } = await pool.query(
    `SELECT id, conference_id, conference_code, conference_title, host_name,
            status, progress, bytes, mime_type, temp_path, error, eta_sec,
            uploaded_by, uploaded_at, sent_at, purged_at, updated_at
       FROM conference_recordings
      WHERE status <> 'deleted'
      ORDER BY uploaded_at DESC
      LIMIT $1`,
    [Math.min(300, Math.max(1, limit))],
  );

  const items: AdminRecordingItem[] = [];
  for (const r of rows) {
    let hasFile = false;
    const tp = r.temp_path as string | null;
    if (tp) {
      try {
        const st = await fs.stat(tp);
        hasFile = st.isFile() && st.size > 0;
      } catch {
        hasFile = false;
      }
    }
    items.push(
      enrichFromLive({
        id: r.id as number,
        conferenceId: r.conference_id as number,
        code: r.conference_code as string,
        title: (r.conference_title as string) || r.conference_code,
        hostName: (r.host_name as string) || null,
        status: r.status as RecStatus,
        progress: Number(r.progress) || 0,
        etaSec: r.eta_sec == null ? null : Number(r.eta_sec),
        bytes: r.bytes == null ? null : Number(r.bytes),
        mimeType: (r.mime_type as string) || null,
        error: (r.error as string) || null,
        hasFile,
        uploadedBy: r.uploaded_by == null ? null : Number(r.uploaded_by),
        uploadedAt: new Date(r.uploaded_at).toISOString(),
        sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
        purgedAt: r.purged_at ? new Date(r.purged_at).toISOString() : null,
        updatedAt: new Date(r.updated_at).toISOString(),
      }),
    );
  }
  return items;
}

export async function deleteAdminRecording(id: number): Promise<{ ok: boolean; error?: string }> {
  await ensureRecordingSchema();
  const { rows } = await pool.query(
    `SELECT id, temp_path, status FROM conference_recordings WHERE id = $1 AND status <> 'deleted'`,
    [id],
  );
  if (!rows[0]) return { ok: false, error: "Yozuv topilmadi" };
  const status = rows[0].status as RecStatus;
  if (status === "converting" || status === "sending" || status === "uploaded") {
    stopLive(id);
  }
  const tp = rows[0].temp_path as string | null;
  if (tp) await safeUnlink(tp);
  // Sibling .mp4 / .webm
  if (tp) {
    const alt = tp.toLowerCase().endsWith(".mp4")
      ? tp.replace(/\.mp4$/i, ".webm")
      : tp.replace(/\.[^.]+$/i, ".mp4");
    if (alt !== tp) await safeUnlink(alt);
  }
  await pool.query(
    `UPDATE conference_recordings
        SET status = 'deleted', progress = 0, eta_sec = 0, temp_path = NULL,
            error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [id],
  );
  return { ok: true };
}

export async function saveConferenceRecordingUpload(
  conf: Conference,
  input: {
    buffer: Buffer;
    filename: string;
    mimeType?: string;
    uploadedBy?: number;
    hostName?: string;
  },
): Promise<{ path: string; bytes: number; recordingId: number }> {
  await ensureRecordingSchema();
  const dir = await ensureRecordingDir();
  const ext = path.extname(input.filename || "") || (input.mimeType?.includes("mp4") ? ".mp4" : ".webm");
  const dest = path.join(dir, `${conf.code}-${Date.now()}${ext}`);
  await fs.writeFile(dest, input.buffer);
  await setConferenceRecordingStatus(conf.id, "uploaded");

  const { rows } = await pool.query(
    `INSERT INTO conference_recordings
       (conference_id, conference_code, conference_title, host_name, status, progress, bytes,
        mime_type, temp_path, eta_sec, uploaded_by)
     VALUES ($1,$2,$3,$4,'uploaded',5,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      conf.id,
      conf.code,
      conf.title,
      input.hostName || null,
      input.buffer.length,
      input.mimeType || null,
      dest,
      estConvertSec(input.buffer.length) + estUploadSec(input.buffer.length),
      input.uploadedBy ?? null,
    ],
  );
  const recordingId = rows[0]!.id as number;
  startLiveTicker(recordingId, "uploaded", input.buffer.length);
  logger.info({ code: conf.code, bytes: input.buffer.length, dest, recordingId }, "conference recording uploaded (temp)");
  return { path: dest, bytes: input.buffer.length, recordingId };
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
    recordingId?: number;
  },
): Promise<{ ok: boolean; error?: string }> {
  await ensureRecordingSchema();
  const recordingId = meta.recordingId;
  const chatId = conferenceReportChatId();

  let bytes = 0;
  try {
    bytes = (await fs.stat(filePath)).size;
  } catch {
    bytes = 0;
  }

  if (!isTelegramConfigured()) {
    if (recordingId) {
      stopLive(recordingId);
      await patchRecordingRow(recordingId, {
        status: "failed",
        progress: 0,
        etaSec: 0,
        error: "Telegram bot sozlanmagan",
      });
    }
    await safeUnlink(filePath);
    await setConferenceRecordingStatus(conf.id, "failed");
    return { ok: false, error: "Telegram bot sozlanmagan" };
  }

  if (recordingId) {
    startLiveTicker(recordingId, "converting", bytes || 1);
    await setConferenceRecordingStatus(conf.id, "converting");
  }

  let sendPath = filePath;
  try {
    if (recordingId) setLivePhase(recordingId, "converting");
    else await setConferenceRecordingStatus(conf.id, "converting");
    sendPath = await convertRecordingToMp4(filePath);
    if (recordingId && sendPath !== filePath) {
      await patchRecordingRow(recordingId, { tempPath: sendPath });
      try {
        bytes = (await fs.stat(sendPath)).size;
      } catch {
        /* keep */
      }
    }
  } catch (err) {
    logger.warn({ err, code: conf.code }, "recording convert step failed");
    sendPath = filePath;
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(sendPath);
    bytes = buf.length;
  } catch (err) {
    logger.error({ err, code: conf.code }, "conference recording read failed");
    if (recordingId) {
      stopLive(recordingId);
      await patchRecordingRow(recordingId, {
        status: "failed",
        progress: 0,
        etaSec: 0,
        error: "Yozuv fayli o‘qilmadi",
      });
    }
    await setConferenceRecordingStatus(conf.id, "failed");
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
    if (recordingId) {
      const cur = live.get(recordingId);
      if (cur) cur.bytes = bytes;
      setLivePhase(recordingId, "sending");
    }
    await setConferenceRecordingStatus(conf.id, "sending");
    let sentAs: "video" | "document" = "document";
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
    const sentAt = new Date();
    await setConferenceRecordingStatus(conf.id, "sent", { sentAt, fileId: null });
    if (recordingId) {
      stopLive(recordingId);
      await patchRecordingRow(recordingId, {
        status: "sent",
        progress: 100,
        etaSec: 0,
        sentAt,
        error: null,
      });
    }
    logger.info(
      { code: conf.code, chatId, bytes: buf.length, mp4: isMp4, sentAs, recordingId },
      "conference recording sent to Telegram",
    );
  } catch (err) {
    logger.error({ err, code: conf.code, chatId, bytes: buf.length }, "conference recording Telegram send failed");
    await setConferenceRecordingStatus(conf.id, "failed");
    if (recordingId) {
      stopLive(recordingId);
      await patchRecordingRow(recordingId, {
        status: "failed",
        progress: 0,
        etaSec: 0,
        error: err instanceof Error ? err.message : "Telegramga yuborilmadi",
        bytes: buf.length,
      });
    }
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
  if (recordingId) {
    await patchRecordingRow(recordingId, {
      status: "sent_purged",
      progress: 100,
      etaSec: 0,
      tempPath: null,
      purgedAt: new Date(),
    });
  }
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
