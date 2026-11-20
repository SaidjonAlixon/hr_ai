import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pool } from "@workspace/db";
import { logger } from "./logger";

const RECORDING_DIR =
  process.env.P2P_RECORDINGS_DIR ||
  path.join(process.env.TMPDIR || process.env.TEMP || "/tmp", "hr-p2p-recordings");

let schemaReady: Promise<void> | null = null;

export async function ensureP2pRecordingSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS p2p_call_recordings (
          id SERIAL PRIMARY KEY,
          call_id TEXT,
          caller_id INT,
          callee_id INT,
          caller_name TEXT,
          callee_name TEXT,
          duration_sec INT,
          bytes INT,
          mime_type TEXT,
          file_path TEXT,
          uploaded_by INT,
          status TEXT NOT NULL DEFAULT 'ready',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_p2p_call_recordings_created
          ON p2p_call_recordings (created_at DESC);
      `);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

async function ensureDir(): Promise<string> {
  await fs.mkdir(RECORDING_DIR, { recursive: true });
  return RECORDING_DIR;
}

export async function saveP2pRecording(input: {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  callId?: string | null;
  callerId?: number | null;
  calleeId?: number | null;
  callerName?: string | null;
  calleeName?: string | null;
  durationSec?: number | null;
  uploadedBy?: number | null;
}): Promise<{ id: number; bytes: number; path: string }> {
  await ensureP2pRecordingSchema();
  const dir = await ensureDir();
  const ext = path.extname(input.filename || "") || (input.mimeType?.includes("mp4") ? ".mp4" : ".webm");
  const dest = path.join(dir, `p2p-${Date.now()}${ext}`);
  await fs.writeFile(dest, input.buffer);

  const { rows } = await pool.query(
    `INSERT INTO p2p_call_recordings
       (call_id, caller_id, callee_id, caller_name, callee_name, duration_sec, bytes, mime_type, file_path, uploaded_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ready')
     RETURNING id`,
    [
      input.callId || null,
      input.callerId ?? null,
      input.calleeId ?? null,
      input.callerName || null,
      input.calleeName || null,
      input.durationSec ?? null,
      input.buffer.length,
      input.mimeType || null,
      dest,
      input.uploadedBy ?? null,
    ],
  );
  const id = rows[0]!.id as number;
  logger.info({ id, bytes: input.buffer.length, dest, callId: input.callId }, "p2p recording saved");
  return { id, bytes: input.buffer.length, path: dest };
}

export async function listP2pRecordings(limit = 100): Promise<
  Array<{
    id: number;
    callId: string | null;
    callerId: number | null;
    calleeId: number | null;
    callerName: string | null;
    calleeName: string | null;
    durationSec: number | null;
    bytes: number | null;
    mimeType: string | null;
    createdAt: string;
  }>
> {
  await ensureP2pRecordingSchema();
  const { rows } = await pool.query(
    `SELECT id, call_id, caller_id, callee_id, caller_name, callee_name,
            duration_sec, bytes, mime_type, created_at
     FROM p2p_call_recordings
     WHERE status <> 'deleted'
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.min(300, Math.max(1, limit))],
  );
  return rows.map((r) => ({
    id: r.id as number,
    callId: (r.call_id as string) || null,
    callerId: (r.caller_id as number) ?? null,
    calleeId: (r.callee_id as number) ?? null,
    callerName: (r.caller_name as string) || null,
    calleeName: (r.callee_name as string) || null,
    durationSec: (r.duration_sec as number) ?? null,
    bytes: (r.bytes as number) ?? null,
    mimeType: (r.mime_type as string) || null,
    createdAt: new Date(r.created_at as string | Date).toISOString(),
  }));
}

export async function getP2pRecordingFile(
  id: number,
): Promise<{ ok: true; path: string; mimeType: string; filename: string } | { ok: false; error: string }> {
  await ensureP2pRecordingSchema();
  const { rows } = await pool.query(
    `SELECT id, file_path, mime_type FROM p2p_call_recordings WHERE id = $1 AND status <> 'deleted'`,
    [id],
  );
  const row = rows[0];
  if (!row?.file_path) return { ok: false, error: "Topilmadi" };
  const filePath = String(row.file_path);
  if (!existsSync(filePath)) return { ok: false, error: "Fayl yo‘q" };
  return {
    ok: true,
    path: filePath,
    mimeType: String(row.mime_type || "video/webm"),
    filename: path.basename(filePath),
  };
}

export async function deleteP2pRecording(id: number): Promise<{ ok: boolean; error?: string }> {
  await ensureP2pRecordingSchema();
  const { rows } = await pool.query(
    `SELECT id, file_path FROM p2p_call_recordings WHERE id = $1 AND status <> 'deleted'`,
    [id],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "Topilmadi" };
  await pool.query(`UPDATE p2p_call_recordings SET status = 'deleted' WHERE id = $1`, [id]);
  if (row.file_path) {
    try {
      await fs.unlink(String(row.file_path));
    } catch {
      /* */
    }
  }
  return { ok: true };
}
