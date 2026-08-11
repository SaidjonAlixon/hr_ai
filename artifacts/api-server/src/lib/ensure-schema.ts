/**
 * Server ishga tushganda jadvallarni yaratadi / yetishmayotgan ustunlarni qo‘shadi.
 * Hech qachon DROP / TRUNCATE / DELETE qilmaydi — barcha ma’lumot Railway Postgres’da qoladi.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

const ENSURE_SQL = `
-- Kirish (farmasevt staj)
CREATE TABLE IF NOT EXISTS kirish_progress (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  current_stage INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'in_progress',
  stages_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS kirish_progress_user_uidx ON kirish_progress (user_id);

-- Chat
CREATE TABLE IF NOT EXISTS chats (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'direct',
  title TEXT,
  created_by_id INTEGER NOT NULL,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chats_last_message_at_idx ON chats (last_message_at);

CREATE TABLE IF NOT EXISTS chat_members (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_read_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_members_chat_user_uidx ON chat_members (chat_id, user_id);
CREATE INDEX IF NOT EXISTS chat_members_user_idx ON chat_members (user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_messages_chat_id_idx ON chat_messages (chat_id);
CREATE INDEX IF NOT EXISTS chat_messages_chat_created_idx ON chat_messages (chat_id, created_at);

-- Maqsad
CREATE TABLE IF NOT EXISTS user_goals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goal_daily_logs (
  id SERIAL PRIMARY KEY,
  goal_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  work_date DATE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS goal_daily_logs_user_date_uidx ON goal_daily_logs (user_id, work_date);

-- Eslatmalar
CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  notify_at TIMESTAMPTZ,
  remind_interval_minutes INTEGER,
  last_notified_at TIMESTAMPTZ,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminder_events (
  id SERIAL PRIMARY KEY,
  reminder_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  note TEXT,
  from_due_at TIMESTAMPTZ,
  to_due_at TIMESTAMPTZ,
  from_status TEXT,
  to_status TEXT,
  created_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_at TIMESTAMPTZ,
  assignee_kind TEXT NOT NULL DEFAULT 'user',
  assignee_id INTEGER NOT NULL,
  created_by_id INTEGER NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- Staffing
CREATE TABLE IF NOT EXISTS staffing_alerts (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  manager_employee_id INTEGER,
  branch_location TEXT,
  shift_type TEXT,
  shift_label TEXT,
  employment_status TEXT NOT NULL,
  workflow_status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  created_by_id INTEGER,
  confirmed_by_id INTEGER,
  confirmed_at TIMESTAMPTZ,
  request_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS request_claims (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL,
  recruiter_id INTEGER NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Branch needs
CREATE TABLE IF NOT EXISTS branch_needs (
  id SERIAL PRIMARY KEY,
  need_type TEXT NOT NULL,
  branch_location TEXT,
  manager_employee_id INTEGER,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by_id INTEGER,
  confirmed_by_id INTEGER,
  confirmed_at TIMESTAMPTZ,
  assigned_user_id INTEGER,
  assigned_at TIMESTAMPTZ,
  task_id INTEGER,
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  verified_by_id INTEGER,
  verified_at TIMESTAMPTZ,
  closed_by_id INTEGER,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Branch audits
CREATE TABLE IF NOT EXISTS branch_audits (
  id SERIAL PRIMARY KEY,
  manager_employee_id INTEGER NOT NULL,
  branch_location TEXT,
  manager_name TEXT,
  visit_date TEXT NOT NULL,
  visit_name TEXT NOT NULL DEFAULT '1-tashrif',
  month_label TEXT,
  coordinator_id INTEGER NOT NULL,
  coordinator_name TEXT,
  general_note TEXT,
  categories JSONB NOT NULL,
  score_percent INTEGER NOT NULL DEFAULT 0,
  answered_count INTEGER NOT NULL DEFAULT 0,
  yes_count INTEGER NOT NULL DEFAULT 0,
  no_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  check_latitude DOUBLE PRECISION,
  check_longitude DOUBLE PRECISION,
  distance_meters INTEGER,
  status TEXT NOT NULL DEFAULT 'saved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE branch_audits ADD COLUMN IF NOT EXISTS check_latitude DOUBLE PRECISION;
ALTER TABLE branch_audits ADD COLUMN IF NOT EXISTS check_longitude DOUBLE PRECISION;
ALTER TABLE branch_audits ADD COLUMN IF NOT EXISTS distance_meters INTEGER;

-- Employees GPS (checklist geofence) + employment
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employees'
  ) THEN
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_status TEXT;
  END IF;
END $$;
`;

export async function ensurePersistentSchema(): Promise<void> {
  // Vercel cold start — uzoq DDL loginni bloklamasin
  const timeoutMs = process.env.VERCEL ? 8_000 : 30_000;
  const client = await Promise.race([
    pool.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`schema ensure connect timeout ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
  try {
    await Promise.race([
      client.query(ENSURE_SQL),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`schema ensure query timeout ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    logger.info("Persistent DB schema ensured (CREATE IF NOT EXISTS only — no wipe)");
  } catch (err) {
    logger.error({ err }, "Failed to ensure DB schema");
    throw err;
  } finally {
    client.release();
  }
}
