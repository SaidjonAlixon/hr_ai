/**
 * AI Telegram qo‘ng‘iroq joblari (admin rejalashtirish).
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

export type AiCallRecurrence = "once" | "daily";
export type AiCallStatus = "pending" | "running" | "done" | "failed" | "cancelled";
export type AiCallVoice = "male" | "female";

export type AiCallJob = {
  id: number;
  targetUserId: number | null;
  targetTelegramId: string;
  targetName: string | null;
  openScript: string;
  conversational: boolean;
  maxTurns: number;
  voice: AiCallVoice;
  scheduledAt: Date;
  recurrence: AiCallRecurrence;
  dailyTime: string | null;
  enabled: boolean;
  status: AiCallStatus;
  lastError: string | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiCallLog = {
  id: number;
  jobId: number;
  startedAt: Date;
  endedAt: Date | null;
  outcome: string;
  transcript: Array<{ role: string; text: string }>;
};

let ready: Promise<void> | null = null;

export function ensureAiCallSchema(): Promise<void> {
  ready ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS ai_call_jobs (
         id SERIAL PRIMARY KEY,
         target_user_id INT,
         target_telegram_id TEXT NOT NULL,
         target_name TEXT,
         open_script TEXT NOT NULL,
         conversational BOOLEAN NOT NULL DEFAULT TRUE,
         max_turns INT NOT NULL DEFAULT 4,
         scheduled_at TIMESTAMPTZ NOT NULL,
         recurrence TEXT NOT NULL DEFAULT 'once',
         daily_time TEXT,
         enabled BOOLEAN NOT NULL DEFAULT TRUE,
         status TEXT NOT NULL DEFAULT 'pending',
         last_error TEXT,
         created_by INT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );
       CREATE INDEX IF NOT EXISTS ai_call_jobs_due_idx
         ON ai_call_jobs (status, enabled, scheduled_at);
       CREATE TABLE IF NOT EXISTS ai_call_logs (
         id SERIAL PRIMARY KEY,
         job_id INT NOT NULL REFERENCES ai_call_jobs(id) ON DELETE CASCADE,
         started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         ended_at TIMESTAMPTZ,
         outcome TEXT NOT NULL DEFAULT 'started',
         transcript JSONB NOT NULL DEFAULT '[]'::jsonb
       );
       CREATE INDEX IF NOT EXISTS ai_call_logs_job_idx ON ai_call_logs (job_id, started_at DESC);
       ALTER TABLE ai_call_jobs ADD COLUMN IF NOT EXISTS voice TEXT NOT NULL DEFAULT 'female';`,
    )
    .then(() => undefined)
    .catch((err) => {
      ready = null;
      logger.error({ err }, "ai_call schema");
      throw err;
    });
  return ready;
}

function mapVoice(v: unknown): AiCallVoice {
  return String(v || "").toLowerCase() === "male" ? "male" : "female";
}

function mapJob(r: Record<string, unknown>): AiCallJob {
  return {
    id: Number(r.id),
    targetUserId: r.target_user_id != null ? Number(r.target_user_id) : null,
    targetTelegramId: String(r.target_telegram_id),
    targetName: r.target_name != null ? String(r.target_name) : null,
    openScript: String(r.open_script),
    conversational: Boolean(r.conversational),
    maxTurns: Number(r.max_turns) || 4,
    voice: mapVoice(r.voice),
    scheduledAt: new Date(String(r.scheduled_at)),
    recurrence: (String(r.recurrence) === "daily" ? "daily" : "once") as AiCallRecurrence,
    dailyTime: r.daily_time != null ? String(r.daily_time) : null,
    enabled: Boolean(r.enabled),
    status: String(r.status) as AiCallStatus,
    lastError: r.last_error != null ? String(r.last_error) : null,
    createdBy: r.created_by != null ? Number(r.created_by) : null,
    createdAt: new Date(String(r.created_at)),
    updatedAt: new Date(String(r.updated_at)),
  };
}

export async function listAiCallJobs(limit = 100): Promise<AiCallJob[]> {
  await ensureAiCallSchema();
  const { rows } = await pool.query(
    `SELECT * FROM ai_call_jobs ORDER BY scheduled_at DESC, id DESC LIMIT $1`,
    [Math.min(200, Math.max(1, limit))],
  );
  return rows.map(mapJob);
}

export async function getAiCallJob(id: number): Promise<AiCallJob | null> {
  await ensureAiCallSchema();
  const { rows } = await pool.query(`SELECT * FROM ai_call_jobs WHERE id = $1`, [id]);
  return rows[0] ? mapJob(rows[0]) : null;
}

export type CreateAiCallJobInput = {
  targetUserId?: number | null;
  targetTelegramId: string;
  targetName?: string | null;
  openScript: string;
  conversational?: boolean;
  maxTurns?: number;
  voice?: AiCallVoice;
  scheduledAt: Date;
  recurrence?: AiCallRecurrence;
  dailyTime?: string | null;
  enabled?: boolean;
  createdBy?: number | null;
};

export async function createAiCallJob(input: CreateAiCallJobInput): Promise<AiCallJob> {
  await ensureAiCallSchema();
  const voice: AiCallVoice = input.voice === "male" ? "male" : "female";
  const { rows } = await pool.query(
    `INSERT INTO ai_call_jobs (
       target_user_id, target_telegram_id, target_name, open_script,
       conversational, max_turns, voice, scheduled_at, recurrence, daily_time,
       enabled, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12)
     RETURNING *`,
    [
      input.targetUserId ?? null,
      String(input.targetTelegramId).trim(),
      input.targetName ?? null,
      String(input.openScript).trim(),
      input.conversational !== false,
      Math.min(8, Math.max(1, input.maxTurns ?? 4)),
      voice,
      input.scheduledAt,
      input.recurrence === "daily" ? "daily" : "once",
      input.dailyTime ?? null,
      input.enabled !== false,
      input.createdBy ?? null,
    ],
  );
  return mapJob(rows[0]);
}

export async function updateAiCallJob(
  id: number,
  patch: Partial<{
    openScript: string;
    conversational: boolean;
    maxTurns: number;
    voice: AiCallVoice;
    scheduledAt: Date;
    recurrence: AiCallRecurrence;
    dailyTime: string | null;
    enabled: boolean;
    status: AiCallStatus;
    lastError: string | null;
    targetTelegramId: string;
    targetName: string | null;
    targetUserId: number | null;
  }>,
): Promise<AiCallJob | null> {
  await ensureAiCallSchema();
  const cur = await getAiCallJob(id);
  if (!cur) return null;
  const next = {
    openScript: patch.openScript ?? cur.openScript,
    conversational: patch.conversational ?? cur.conversational,
    maxTurns: patch.maxTurns ?? cur.maxTurns,
    voice: patch.voice ?? cur.voice,
    scheduledAt: patch.scheduledAt ?? cur.scheduledAt,
    recurrence: patch.recurrence ?? cur.recurrence,
    dailyTime: patch.dailyTime !== undefined ? patch.dailyTime : cur.dailyTime,
    enabled: patch.enabled ?? cur.enabled,
    status: patch.status ?? cur.status,
    lastError: patch.lastError !== undefined ? patch.lastError : cur.lastError,
    targetTelegramId: patch.targetTelegramId ?? cur.targetTelegramId,
    targetName: patch.targetName !== undefined ? patch.targetName : cur.targetName,
    targetUserId: patch.targetUserId !== undefined ? patch.targetUserId : cur.targetUserId,
  };
  const { rows } = await pool.query(
    `UPDATE ai_call_jobs SET
       target_user_id=$2, target_telegram_id=$3, target_name=$4, open_script=$5,
       conversational=$6, max_turns=$7, voice=$8, scheduled_at=$9, recurrence=$10, daily_time=$11,
       enabled=$12, status=$13, last_error=$14, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [
      id,
      next.targetUserId,
      next.targetTelegramId,
      next.targetName,
      next.openScript,
      next.conversational,
      next.maxTurns,
      next.voice === "male" ? "male" : "female",
      next.scheduledAt,
      next.recurrence,
      next.dailyTime,
      next.enabled,
      next.status,
      next.lastError,
    ],
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function deleteAiCallJob(id: number): Promise<boolean> {
  await ensureAiCallSchema();
  const r = await pool.query(`DELETE FROM ai_call_jobs WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

/** Due jobs: pending + enabled + scheduled_at <= now */
export async function claimDueAiCallJobs(limit = 1): Promise<AiCallJob[]> {
  await ensureAiCallSchema();
  const { rows } = await pool.query(
    `UPDATE ai_call_jobs SET status = 'running', updated_at = NOW()
     WHERE id IN (
       SELECT id FROM ai_call_jobs
       WHERE enabled = TRUE AND status = 'pending' AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [Math.min(3, Math.max(1, limit))],
  );
  return rows.map(mapJob);
}

export async function insertAiCallLog(
  jobId: number,
  outcome: string,
  transcript: Array<{ role: string; text: string }>,
): Promise<number> {
  await ensureAiCallSchema();
  const { rows } = await pool.query(
    `INSERT INTO ai_call_logs (job_id, outcome, transcript, ended_at)
     VALUES ($1, $2, $3::jsonb, NOW()) RETURNING id`,
    [jobId, outcome, JSON.stringify(transcript)],
  );
  return Number(rows[0].id);
}

export async function listAiCallLogs(limit = 50, jobId?: number): Promise<AiCallLog[]> {
  await ensureAiCallSchema();
  const { rows } = jobId
    ? await pool.query(
        `SELECT * FROM ai_call_logs WHERE job_id = $1 ORDER BY started_at DESC LIMIT $2`,
        [jobId, limit],
      )
    : await pool.query(`SELECT * FROM ai_call_logs ORDER BY started_at DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({
    id: Number(r.id),
    jobId: Number(r.job_id),
    startedAt: new Date(String(r.started_at)),
    endedAt: r.ended_at ? new Date(String(r.ended_at)) : null,
    outcome: String(r.outcome),
    transcript: Array.isArray(r.transcript) ? r.transcript : [],
  }));
}

/** Keyingi kun daily_time (Asia/Tashkent) */
export function nextDailyScheduledAt(dailyTime: string, from = new Date()): Date {
  const m = String(dailyTime || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  const hh = m ? Math.min(23, Math.max(0, Number(m[1]))) : 9;
  const mm = m ? Math.min(59, Math.max(0, Number(m[2]))) : 0;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // Bugungi Toshkent sanasi +1 kun
  const parts = Object.fromEntries(fmt.formatToParts(from).map((p) => [p.type, p.value]));
  const base = new Date(`${parts.year}-${parts.month}-${parts.day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:00`);
  let next = base;
  if (next.getTime() <= from.getTime() + 60_000) {
    next = new Date(base.getTime() + 24 * 60 * 60 * 1000);
  }
  // Agar bugungi slot o‘tgan bo‘lsa — ertaga
  if (next.getTime() <= from.getTime()) {
    next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
  }
  return next;
}

export async function listAiCallTargets(q = "", limit = 40) {
  const like = `%${q.trim()}%`;
  const { rows } = await pool.query(
    `SELECT id, full_name, phone, telegram_id, role
     FROM users
     WHERE telegram_id IS NOT NULL AND TRIM(telegram_id::text) <> ''
       AND status = 'active'
       AND ($1 = '%%' OR full_name ILIKE $1 OR phone ILIKE $1 OR telegram_id::text ILIKE $1)
     ORDER BY full_name ASC
     LIMIT $2`,
    [q.trim() ? like : "%%", Math.min(100, Math.max(1, limit))],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    fullName: String(r.full_name || ""),
    phone: r.phone ? String(r.phone) : null,
    telegramId: String(r.telegram_id),
    role: String(r.role || ""),
  }));
}
