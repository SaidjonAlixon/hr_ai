/**
 * Server ishga tushganda jadvallarni yaratadi / yetishmayotgan ustunlarni qo‘shadi.
 * Hech qachon DROP / TRUNCATE / DELETE qilmaydi — barcha ma’lumot Railway Postgres’da qoladi.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

const ENSURE_SQL = `
-- Kirish (stajyor o‘quv)
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

CREATE TABLE IF NOT EXISTS kirish_videos (
  id SERIAL PRIMARY KEY,
  stage INTEGER NOT NULL,
  youtube_url TEXT NOT NULL,
  youtube_id TEXT NOT NULL,
  updated_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS kirish_videos_stage_uidx ON kirish_videos (stage);
ALTER TABLE kirish_videos ADD COLUMN IF NOT EXISTS pdf_url TEXT;
ALTER TABLE kirish_videos ADD COLUMN IF NOT EXISTS drive_file_id TEXT;
ALTER TABLE kirish_videos ADD COLUMN IF NOT EXISTS video_drive_file_id TEXT;
ALTER TABLE kirish_videos ADD COLUMN IF NOT EXISTS questions_json JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 5-bosqich: stajyor videosi (Google Drive)
INSERT INTO kirish_videos (stage, youtube_url, youtube_id, video_drive_file_id, questions_json)
VALUES (
  5,
  'https://drive.google.com/file/d/1swNC0epB65S9H0tpHeiQHynmB-W9pi2c/view',
  '',
  '1swNC0epB65S9H0tpHeiQHynmB-W9pi2c',
  '[]'::jsonb
)
ON CONFLICT (stage) DO UPDATE SET
  video_drive_file_id = '1swNC0epB65S9H0tpHeiQHynmB-W9pi2c',
  youtube_url = CASE
    WHEN kirish_videos.youtube_id IS NULL OR kirish_videos.youtube_id = ''
      THEN 'https://drive.google.com/file/d/1swNC0epB65S9H0tpHeiQHynmB-W9pi2c/view'
    ELSE kirish_videos.youtube_url
  END,
  updated_at = NOW();

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
  reply_to_id INTEGER,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_messages_chat_id_idx ON chat_messages (chat_id);
CREATE INDEX IF NOT EXISTS chat_messages_chat_created_idx ON chat_messages (chat_id, created_at);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

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
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'work';
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS notify_system BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS notify_telegram BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS created_by_id INTEGER;

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
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS candidate_id INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pipeline_stage TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_note TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completion_attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

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

-- Bir filial + bir sana = bitta cheklist (eski dublikatlarni olib tashlab unique)
DELETE FROM branch_audits a
USING branch_audits b
WHERE a.manager_employee_id = b.manager_employee_id
  AND a.visit_date = b.visit_date
  AND a.id > b.id;
CREATE UNIQUE INDEX IF NOT EXISTS branch_audits_manager_visit_date_uidx
  ON branch_audits (manager_employee_id, visit_date);

-- Koordinator filial tashriflari (Keldim → Cheklist → Ketdim)
CREATE TABLE IF NOT EXISTS coordinator_branch_visits (
  id SERIAL PRIMARY KEY,
  coordinator_user_id INTEGER NOT NULL,
  coordinator_employee_id INTEGER,
  coordinator_name TEXT,
  branch_id INTEGER NOT NULL,
  branch_label TEXT,
  work_date TEXT NOT NULL,
  check_in_at TIMESTAMPTZ NOT NULL,
  check_out_at TIMESTAMPTZ,
  check_in_latitude DOUBLE PRECISION,
  check_in_longitude DOUBLE PRECISION,
  check_out_latitude DOUBLE PRECISION,
  check_out_longitude DOUBLE PRECISION,
  checklist_audit_id INTEGER,
  checklist_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS coord_visits_user_status_idx
  ON coordinator_branch_visits (coordinator_user_id, status);
CREATE INDEX IF NOT EXISTS coord_visits_branch_idx ON coordinator_branch_visits (branch_id);
CREATE INDEX IF NOT EXISTS coord_visits_work_date_idx ON coordinator_branch_visits (work_date);
CREATE INDEX IF NOT EXISTS coord_visits_checklist_idx ON coordinator_branch_visits (checklist_audit_id);
ALTER TABLE coordinator_branch_visits ADD COLUMN IF NOT EXISTS checkout_note TEXT;
ALTER TABLE coordinator_branch_visits ADD COLUMN IF NOT EXISTS last_presence_at TIMESTAMPTZ;
ALTER TABLE coordinator_branch_visits ADD COLUMN IF NOT EXISTS last_presence_reminder_at TIMESTAMPTZ;
ALTER TABLE coordinator_branch_visits ADD COLUMN IF NOT EXISTS presence_confirm_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coordinator_branch_visits ADD COLUMN IF NOT EXISTS presence_blocked_at TIMESTAMPTZ;
ALTER TABLE coordinator_branch_visits ADD COLUMN IF NOT EXISTS presence_unlock_request_at TIMESTAMPTZ;
ALTER TABLE coordinator_branch_visits ADD COLUMN IF NOT EXISTS presence_unlocked_at TIMESTAMPTZ;
ALTER TABLE coordinator_branch_visits ADD COLUMN IF NOT EXISTS presence_unlocked_by_id INTEGER;

-- Employees GPS (checklist geofence) + employment + org
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employees'
  ) THEN
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_status TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id INTEGER;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS org_role TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS reports_to_id INTEGER;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS location TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_type TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_label TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS created_by_id INTEGER;
  END IF;
END $$;

UPDATE employees
SET location = regexp_replace(location, '^(Азия|АЗИЯ)', 'ТАШСЕЛМАШ')
WHERE location ~ '^(Азия|АЗИЯ)($|[[:space:]]|\|)';

-- Face ID / WebAuthn
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  credential_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type TEXT,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  transports TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS webauthn_credentials_cred_uidx ON webauthn_credentials (credential_id);
CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx ON webauthn_credentials (user_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS webauthn_challenges_challenge_idx ON webauthn_challenges (challenge);

CREATE TABLE IF NOT EXISTS face_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  descriptor TEXT NOT NULL,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS face_profiles_user_uidx ON face_profiles (user_id);
ALTER TABLE face_profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;

CREATE TABLE IF NOT EXISTS attendance_records (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  user_id INTEGER,
  work_date TEXT NOT NULL,
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'present',
  source TEXT NOT NULL DEFAULT 'manual',
  check_latitude DOUBLE PRECISION,
  check_longitude DOUBLE PRECISION,
  distance_meters INTEGER,
  notes TEXT,
  created_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_emp_date_uidx
  ON attendance_records (employee_id, work_date);
CREATE INDEX IF NOT EXISTS attendance_records_date_idx ON attendance_records (work_date);
CREATE INDEX IF NOT EXISTS attendance_records_employee_idx ON attendance_records (employee_id);
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_latitude DOUBLE PRECISION;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_longitude DOUBLE PRECISION;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS distance_meters INTEGER;

-- Stajyor: intern xodimlar alohida akkaunt roli; Kirish faqat shu rolga
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'employees'
    ) THEN
      UPDATE users u
      SET role = 'stajyor'
      FROM employees e
      WHERE e.user_id = u.id
        AND e.org_role = 'intern'
        AND u.role IS DISTINCT FROM 'stajyor';
    END IF;
  END IF;
END $$;
`;

/** Vercel cold start uchun — yetishmayotgan kritik ustunlar (tez) */
const CRITICAL_COLUMNS_SQL = `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employees'
  ) THEN
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_status TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id INTEGER;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS org_role TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS reports_to_id INTEGER;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS location TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_type TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_label TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url TEXT;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS created_by_id INTEGER;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS fixed_salary INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS bonus_percent DOUBLE PRECISION NOT NULL DEFAULT 30;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    UPDATE employees
    SET location = regexp_replace(location, '^(Азия|АЗИЯ)', 'ТАШСЕЛМАШ')
    WHERE location ~ '^(Азия|АЗИЯ)($|[[:space:]]|\|)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tasks'
  ) THEN
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS candidate_id INTEGER;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pipeline_stage TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  credential_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type TEXT,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  transports TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS webauthn_credentials_cred_uidx ON webauthn_credentials (credential_id);
CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx ON webauthn_credentials (user_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS webauthn_challenges_challenge_idx ON webauthn_challenges (challenge);

CREATE TABLE IF NOT EXISTS face_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  descriptor TEXT NOT NULL,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS face_profiles_user_uidx ON face_profiles (user_id);
ALTER TABLE face_profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;

CREATE TABLE IF NOT EXISTS attendance_records (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  user_id INTEGER,
  work_date TEXT NOT NULL,
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'present',
  source TEXT NOT NULL DEFAULT 'manual',
  check_latitude DOUBLE PRECISION,
  check_longitude DOUBLE PRECISION,
  distance_meters INTEGER,
  notes TEXT,
  created_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_emp_date_uidx
  ON attendance_records (employee_id, work_date);
CREATE INDEX IF NOT EXISTS attendance_records_date_idx ON attendance_records (work_date);
CREATE INDEX IF NOT EXISTS attendance_records_employee_idx ON attendance_records (employee_id);
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_latitude DOUBLE PRECISION;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_longitude DOUBLE PRECISION;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS distance_meters INTEGER;

-- Stajyor: intern xodimlar alohida akkaunt roli; Kirish faqat shu rolga
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'employees'
    ) THEN
      UPDATE users u
      SET role = 'stajyor'
      FROM employees e
      WHERE e.user_id = u.id
        AND e.org_role = 'intern'
        AND u.role IS DISTINCT FROM 'stajyor';
    END IF;
  END IF;
END $$;

-- Nomzod hire qadamlari
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'candidates'
  ) THEN
    ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pipeline_step TEXT NOT NULL DEFAULT 'match';
    ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pipeline_json JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;
`;

/** Nomzod hire qadamlari — ENSURE_SQL dan mustaqil, har doim alohida ishga tushadi */
export async function ensureCandidatePipelineColumns(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pipeline_step TEXT NOT NULL DEFAULT 'match';
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pipeline_json JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);
    logger.info("Candidate pipeline columns ensured");
  } catch (err) {
    logger.warn({ err }, "Candidate pipeline columns ensure failed");
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureEmployeesOrgColumns(): Promise<void> {
  const timeoutMs = 8_000;
  const client = await pool.connect();
  try {
    await Promise.race([
      client.query(CRITICAL_COLUMNS_SQL),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`critical columns query timeout ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    await ensureCandidatePipelineColumns();
  } finally {
    client.release();
  }
}

export async function ensurePersistentSchema(): Promise<void> {
  const timeoutMs = process.env.VERCEL ? 8_000 : 30_000;
  const client = await pool.connect();
  try {
    await Promise.race([
      client.query(ENSURE_SQL),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`schema ensure query timeout ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    logger.info("Persistent DB schema ensured (CREATE IF NOT EXISTS only — no wipe)");
    await ensureCandidatePipelineColumns();
    await client.query(`
CREATE TABLE IF NOT EXISTS kpi_settings (
  id SERIAL PRIMARY KEY,
  attendance_weight INTEGER NOT NULL DEFAULT 40,
  tasks_weight INTEGER NOT NULL DEFAULT 30,
  checklist_weight INTEGER NOT NULL DEFAULT 30,
  work_start_hm TEXT NOT NULL DEFAULT '09:00',
  updated_by_id INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO kpi_settings (id, attendance_weight, tasks_weight, checklist_weight)
SELECT 1, 40, 30, 30
WHERE NOT EXISTS (SELECT 1 FROM kpi_settings WHERE id = 1);
ALTER TABLE kpi_settings ADD COLUMN IF NOT EXISTS work_start_hm TEXT NOT NULL DEFAULT '09:00';

CREATE TABLE IF NOT EXISTS payroll_months (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  employee_id INTEGER,
  month TEXT NOT NULL,
  fixed_salary INTEGER NOT NULL DEFAULT 0,
  bonus_percent DOUBLE PRECISION NOT NULL DEFAULT 30,
  kpi_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_bonus INTEGER NOT NULL DEFAULT 0,
  bonus_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by_id INTEGER,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_months_user_month_uidx ON payroll_months (user_id, month);

CREATE TABLE IF NOT EXISTS work_calendar_days (
  day TEXT PRIMARY KEY,
  is_work BOOLEAN NOT NULL,
  updated_by_id INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_sheets (
  id SERIAL PRIMARY KEY,
  branch_name TEXT NOT NULL,
  month TEXT NOT NULL,
  plan_current DOUBLE PRECISION NOT NULL DEFAULT 0,
  plan_prev DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_net_rate DOUBLE PRECISION NOT NULL DEFAULT 0.88,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by_id INTEGER,
  approved_by_id INTEGER,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS settlement_sheets_branch_month_uidx ON settlement_sheets (branch_name, month);

CREATE TABLE IF NOT EXISTS settlement_lines (
  id SERIAL PRIMARY KEY,
  sheet_id INTEGER NOT NULL,
  employee_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  full_name TEXT NOT NULL,
  phone TEXT,
  sales DOUBLE PRECISION NOT NULL DEFAULT 0,
  percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  fiksa DOUBLE PRECISION NOT NULL DEFAULT 0,
  plan_bonus DOUBLE PRECISION NOT NULL DEFAULT 0,
  avans DOUBLE PRECISION NOT NULL DEFAULT 0,
  inventory_fine DOUBLE PRECISION NOT NULL DEFAULT 0,
  time_fine DOUBLE PRECISION NOT NULL DEFAULT 0,
  expiry_hold DOUBLE PRECISION NOT NULL DEFAULT 0,
  card_amount DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS assigned_branch_id INTEGER;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS fixed_salary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bonus_percent DOUBLE PRECISION NOT NULL DEFAULT 30;
ALTER TABLE settlement_lines ADD COLUMN IF NOT EXISTS position TEXT;
ALTER TABLE settlement_lines ADD COLUMN IF NOT EXISTS plan_current DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE settlement_lines ADD COLUMN IF NOT EXISTS plan_prev DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE settlement_lines ADD COLUMN IF NOT EXISTS extra_bonus DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE settlement_lines ADD COLUMN IF NOT EXISTS fine_note TEXT;
ALTER TABLE settlement_lines ALTER COLUMN percent SET DEFAULT 0;
UPDATE settlement_lines SET percent = 0 WHERE ABS(percent - 0.006) < 0.0000001;

CREATE TABLE IF NOT EXISTS revision_documents (
  id SERIAL PRIMARY KEY,
  doc_no TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  branch_name TEXT,
  planned_date TEXT,
  started_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by_id INTEGER,
  revizor_id INTEGER,
  responsible_name TEXT,
  parent_id INTEGER,
  storno_of_id INTEGER,
  check_lat DOUBLE PRECISION,
  check_lng DOUBLE PRECISION,
  otp_code TEXT,
  signed_by_reviziya_head_id INTEGER,
  signed_by_accountant_id INTEGER,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  denoms JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  shortage_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS revision_documents_type_idx ON revision_documents (doc_type);
CREATE INDEX IF NOT EXISTS revision_documents_status_idx ON revision_documents (status);
CREATE INDEX IF NOT EXISTS revision_documents_branch_idx ON revision_documents (branch_name);

CREATE TABLE IF NOT EXISTS revision_in_transit (
  id SERIAL PRIMARY KEY,
  receipt_doc_id INTEGER NOT NULL,
  handover_doc_id INTEGER,
  revizor_id INTEGER NOT NULL,
  branch_name TEXT,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'UZS',
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',
  route_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS revision_in_transit_status_idx ON revision_in_transit (status);

CREATE TABLE IF NOT EXISTS revision_dicts (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revision_watchlist (
  id SERIAL PRIMARY KEY,
  branch_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  consecutive_count INTEGER NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revision_audit_log (
  id SERIAL PRIMARY KEY,
  document_id INTEGER,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS revision_audit_log_doc_idx ON revision_audit_log (document_id);
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS visit_id INTEGER;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS entity_id INTEGER;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS user_role TEXT;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS old_value JSONB;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS new_value JSONB;
CREATE INDEX IF NOT EXISTS revision_audit_log_visit_idx ON revision_audit_log (visit_id);

CREATE TABLE IF NOT EXISTS revision_visits (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL,
  branch_name TEXT NOT NULL,
  revision_date TEXT,
  scheduled_date TEXT,
  scheduled_start_time TEXT,
  scheduled_end_time TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by_id INTEGER,
  duration_minutes INTEGER,
  assigned_employee_id INTEGER,
  assigned_employee_name TEXT,
  workflow_status TEXT NOT NULL DEFAULT 'ASSIGNED',
  priority TEXT NOT NULL DEFAULT 'normal',
  shortage_amount INTEGER NOT NULL DEFAULT 0,
  excess_amount INTEGER NOT NULL DEFAULT 0,
  collected_amount INTEGER NOT NULL DEFAULT 0,
  remaining_amount INTEGER NOT NULL DEFAULT 0,
  act_number TEXT,
  act_url TEXT,
  receipt_url TEXT,
  extra_docs JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  responsible_name TEXT,
  next_revision_date TEXT,
  next_revision_date_override TEXT,
  cycle_months INTEGER,
  created_by_id INTEGER,
  updated_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS revision_visits_branch_idx ON revision_visits (branch_id);
CREATE INDEX IF NOT EXISTS revision_visits_status_idx ON revision_visits (workflow_status);
CREATE INDEX IF NOT EXISTS revision_visits_scheduled_idx ON revision_visits (scheduled_date);
CREATE INDEX IF NOT EXISTS revision_visits_assigned_idx ON revision_visits (assigned_employee_id);
CREATE INDEX IF NOT EXISTS revision_visits_revision_date_idx ON revision_visits (revision_date);
CREATE INDEX IF NOT EXISTS revision_visits_created_idx ON revision_visits (created_at);

CREATE TABLE IF NOT EXISTS ops_tickets (
  id SERIAL PRIMARY KEY,
  ticket_no TEXT NOT NULL,
  dept TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  branch_name TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'new',
  created_by_id INTEGER,
  assignee_id INTEGER,
  accepted_at TIMESTAMPTZ,
  accepted_by_id INTEGER,
  completed_at TIMESTAMPTZ,
  completed_by_id INTEGER,
  verified_at TIMESTAMPTZ,
  verified_by_id INTEGER,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ops_tickets_dept_idx ON ops_tickets (dept);
CREATE INDEX IF NOT EXISTS ops_tickets_status_idx ON ops_tickets (status);
ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS accepted_by_id INTEGER;
ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS completed_by_id INTEGER;
ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS verified_by_id INTEGER;
ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS assigned_by_id INTEGER;
ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS verify_result TEXT;
ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS task_id INTEGER;
ALTER TABLE ops_tickets ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ops_tickets_task_id_idx ON ops_tickets (task_id);
CREATE INDEX IF NOT EXISTS ops_tickets_escalated_idx ON ops_tickets (status, escalated_at, created_at);

CREATE TABLE IF NOT EXISTS department_job_titles (
  id SERIAL PRIMARY KEY,
  department_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS department_job_titles_dept_idx ON department_job_titles (department_id);

ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_in_method TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS check_out_method TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS resolved_branch_id INTEGER;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS resolved_branch_label TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS shift_plan TEXT;

CREATE TABLE IF NOT EXISTS branch_attendance_qr (
  id SERIAL PRIMARY KEY,
  qr_id TEXT NOT NULL,
  branch_id INTEGER NOT NULL,
  branch_label TEXT,
  token_hash TEXT NOT NULL,
  token_payload TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS branch_attendance_qr_qr_id_uidx ON branch_attendance_qr (qr_id);
CREATE INDEX IF NOT EXISTS branch_attendance_qr_branch_idx ON branch_attendance_qr (branch_id);
CREATE INDEX IF NOT EXISTS branch_attendance_qr_status_idx ON branch_attendance_qr (status);
ALTER TABLE branch_attendance_qr ADD COLUMN IF NOT EXISTS token_payload TEXT;

CREATE TABLE IF NOT EXISTS department_attendance_qr (
  id SERIAL PRIMARY KEY,
  qr_id TEXT NOT NULL,
  department_id INTEGER NOT NULL,
  department_label TEXT,
  token_hash TEXT NOT NULL,
  token_payload TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS department_attendance_qr_qr_id_uidx ON department_attendance_qr (qr_id);
CREATE INDEX IF NOT EXISTS department_attendance_qr_dept_idx ON department_attendance_qr (department_id);
CREATE INDEX IF NOT EXISTS department_attendance_qr_status_idx ON department_attendance_qr (status);

CREATE TABLE IF NOT EXISTS attendance_punch_audit (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER,
  user_id INTEGER,
  branch_id INTEGER,
  verification_method TEXT,
  action TEXT,
  gps_result TEXT,
  gps_distance INTEGER,
  face_result TEXT,
  qr_result TEXT,
  final_result TEXT NOT NULL,
  failure_reason TEXT,
  device_id TEXT,
  ip_address TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS attendance_punch_audit_emp_idx ON attendance_punch_audit (employee_id);
CREATE INDEX IF NOT EXISTS attendance_punch_audit_created_idx ON attendance_punch_audit (created_at);
ALTER TABLE attendance_punch_audit ADD COLUMN IF NOT EXISTS resolution_status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE attendance_punch_audit ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE attendance_punch_audit ADD COLUMN IF NOT EXISTS resolved_by_user_id INTEGER;
ALTER TABLE attendance_punch_audit ADD COLUMN IF NOT EXISTS resolution_note TEXT;
CREATE INDEX IF NOT EXISTS attendance_punch_audit_resolution_idx ON attendance_punch_audit (resolution_status);

-- Smena / ofis sozlamalari (admin «Smena sozlamalari»)
CREATE TABLE IF NOT EXISTS attendance_pay_settings (
  id SERIAL PRIMARY KEY,
  unpaid_break_one_min INTEGER NOT NULL DEFAULT 60,
  unpaid_break_two_min INTEGER NOT NULL DEFAULT 0,
  unpaid_break_three_min INTEGER NOT NULL DEFAULT 0,
  unpaid_break_office_min INTEGER NOT NULL DEFAULT 60,
  break_paid BOOLEAN NOT NULL DEFAULT FALSE,
  night_start_hm TEXT NOT NULL DEFAULT '22:00',
  night_end_hm TEXT NOT NULL DEFAULT '06:00',
  night_coefficient DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  daily_norm_minutes INTEGER NOT NULL DEFAULT 480,
  overtime_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  grace_minutes INTEGER NOT NULL DEFAULT 15,
  min_rest_hours INTEGER NOT NULL DEFAULT 12,
  max_shifts_per_day INTEGER NOT NULL DEFAULT 2,
  shift_one_start_hm TEXT NOT NULL DEFAULT '08:00',
  shift_one_end_hm TEXT NOT NULL DEFAULT '17:00',
  shift_two_start_hm TEXT NOT NULL DEFAULT '17:00',
  shift_two_end_hm TEXT NOT NULL DEFAULT '23:45',
  shift_three_start_hm TEXT NOT NULL DEFAULT '23:00',
  shift_three_end_hm TEXT NOT NULL DEFAULT '07:00',
  shift_three_overnight BOOLEAN NOT NULL DEFAULT TRUE,
  office_start_hm TEXT NOT NULL DEFAULT '09:00',
  office_end_hm TEXT NOT NULL DEFAULT '18:00',
  updated_by_id INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS unpaid_break_one_min INTEGER NOT NULL DEFAULT 60;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS unpaid_break_two_min INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS unpaid_break_three_min INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS unpaid_break_office_min INTEGER NOT NULL DEFAULT 60;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS break_paid BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS night_start_hm TEXT NOT NULL DEFAULT '22:00';
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS night_end_hm TEXT NOT NULL DEFAULT '06:00';
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS night_coefficient DOUBLE PRECISION NOT NULL DEFAULT 1.5;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS daily_norm_minutes INTEGER NOT NULL DEFAULT 480;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS overtime_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS grace_minutes INTEGER NOT NULL DEFAULT 15;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS min_rest_hours INTEGER NOT NULL DEFAULT 12;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS max_shifts_per_day INTEGER NOT NULL DEFAULT 2;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS shift_one_start_hm TEXT NOT NULL DEFAULT '08:00';
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS shift_one_end_hm TEXT NOT NULL DEFAULT '17:00';
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS shift_two_start_hm TEXT NOT NULL DEFAULT '17:00';
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS shift_two_end_hm TEXT NOT NULL DEFAULT '23:45';
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS shift_three_start_hm TEXT NOT NULL DEFAULT '23:00';
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS shift_three_end_hm TEXT NOT NULL DEFAULT '07:00';
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS shift_three_overnight BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS office_start_hm TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS office_end_hm TEXT NOT NULL DEFAULT '18:00';
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS updated_by_id INTEGER;
ALTER TABLE attendance_pay_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
INSERT INTO attendance_pay_settings (id)
SELECT 1
WHERE NOT EXISTS (SELECT 1 FROM attendance_pay_settings WHERE id = 1);

-- Kunlik / vaqtinchalik filial biriktirish (rotatsiya)
CREATE TABLE IF NOT EXISTS employee_branch_assignments (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  branch_label TEXT,
  kind TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  replaces_employee_id INTEGER,
  note TEXT,
  created_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS emp_branch_assign_emp_idx ON employee_branch_assignments (employee_id);
CREATE INDEX IF NOT EXISTS emp_branch_assign_range_idx ON employee_branch_assignments (valid_from, valid_to);

-- Kunlik smena segmentlari (ko‘p filial kelish/ketish)
CREATE TABLE IF NOT EXISTS attendance_shift_segments (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  shift_key TEXT NOT NULL,
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  branch_id INTEGER,
  branch_label TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'face',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_segments_emp_date_shift_uidx
  ON attendance_shift_segments (employee_id, work_date, shift_key);
CREATE INDEX IF NOT EXISTS attendance_segments_emp_date_idx
  ON attendance_shift_segments (employee_id, work_date);

-- Kunlik smena rejasi
CREATE TABLE IF NOT EXISTS employee_day_shift_plans (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  shift_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_id INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS emp_day_shift_plans_uidx ON employee_day_shift_plans (employee_id, work_date);

-- Ko‘p filial + smena ish slotlari (doimiy / muddat / haftalik / kunlik)
CREATE TABLE IF NOT EXISTS employee_work_slots (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  branch_label TEXT,
  shift_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  weekdays JSONB,
  work_dates JSONB,
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS emp_work_slots_emp_idx ON employee_work_slots (employee_id);
CREATE INDEX IF NOT EXISTS emp_work_slots_active_idx ON employee_work_slots (employee_id, active);
CREATE INDEX IF NOT EXISTS emp_work_slots_range_idx ON employee_work_slots (valid_from, valid_to);
ALTER TABLE employee_work_slots ADD COLUMN IF NOT EXISTS weekdays JSONB;
ALTER TABLE employee_work_slots ADD COLUMN IF NOT EXISTS work_dates JSONB;
ALTER TABLE employee_work_slots ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE employee_work_slots ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE employee_work_slots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Javob olish so‘rovlari (har sana = alohida yozuv)
CREATE TABLE IF NOT EXISTS javob_olish_requests (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  user_id INTEGER,
  work_date TEXT NOT NULL,
  shift_type TEXT,
  shift_label TEXT,
  shift_start_hm TEXT NOT NULL,
  shift_end_hm TEXT NOT NULL,
  shift_overnight INTEGER NOT NULL DEFAULT 0,
  from_hm TEXT NOT NULL,
  to_hm TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  coordinator_user_id INTEGER,
  decided_by_id INTEGER,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS javob_olish_emp_idx ON javob_olish_requests (employee_id);
CREATE INDEX IF NOT EXISTS javob_olish_date_idx ON javob_olish_requests (work_date);
CREATE INDEX IF NOT EXISTS javob_olish_status_idx ON javob_olish_requests (status);
CREATE INDEX IF NOT EXISTS javob_olish_coord_idx ON javob_olish_requests (coordinator_user_id);
ALTER TABLE javob_olish_requests ADD COLUMN IF NOT EXISTS coord_decided_by_id INTEGER;
ALTER TABLE javob_olish_requests ADD COLUMN IF NOT EXISTS coord_decided_at TIMESTAMPTZ;
ALTER TABLE javob_olish_requests ADD COLUMN IF NOT EXISTS coord_decision_note TEXT;
ALTER TABLE javob_olish_requests ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
ALTER TABLE javob_olish_requests ADD COLUMN IF NOT EXISTS escalated_note TEXT;
UPDATE javob_olish_requests
  SET escalated_note = REPLACE(escalated_note, 'Escalate:', 'HR ga o‘tkazilgan:')
  WHERE escalated_note LIKE '%Escalate:%';
UPDATE javob_olish_requests SET status = 'pending_coord' WHERE status = 'pending';
DROP INDEX IF EXISTS javob_olish_pending_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS javob_olish_pending_uidx
  ON javob_olish_requests (employee_id, work_date)
  WHERE status IN ('pending', 'pending_coord', 'pending_hr');

-- Web Push (Chrome / Safari PWA) — telefonda tizim bildirishnomasi
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uidx ON push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS push_vapid_keys (
  id INTEGER PRIMARY KEY DEFAULT 1,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'mailto:admin@vaksina.local',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branch_contacts (
  id SERIAL PRIMARY KEY,
  branch_employee_id INTEGER NOT NULL,
  primary_phone TEXT NOT NULL DEFAULT '',
  extra_phones JSONB NOT NULL DEFAULT '[]'::jsonb,
  telegram_nick TEXT,
  contact_from_hm TEXT,
  contact_to_hm TEXT,
  updated_by_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS branch_contacts_branch_uidx ON branch_contacts (branch_employee_id);
CREATE INDEX IF NOT EXISTS branch_contacts_updated_by_idx ON branch_contacts (updated_by_user_id);

CREATE TABLE IF NOT EXISTS lokatsiya_bot_users (
  telegram_user_id BIGINT PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  starts_count INTEGER NOT NULL DEFAULT 1,
  branch_views INTEGER NOT NULL DEFAULT 0,
  last_action TEXT,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_at TIMESTAMPTZ,
  first_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lokatsiya_bot_users_last_seen_idx ON lokatsiya_bot_users (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS lokatsiya_bot_users_blocked_idx ON lokatsiya_bot_users (is_blocked);

CREATE TABLE IF NOT EXISTS lokatsiya_bot_recruiters (
  telegram_user_id BIGINT PRIMARY KEY,
  chat_id BIGINT NOT NULL DEFAULT 0,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  added_by_telegram_id BIGINT,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lokatsiya_bot_recruiters_active_idx ON lokatsiya_bot_recruiters (is_active);

-- ========== Device Security (opt-in) ==========
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_security_enforced BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS device_security_settings (
  id SERIAL PRIMARY KEY,
  enforcement_mode TEXT NOT NULL DEFAULT 'selected',
  office_max_devices INTEGER NOT NULL DEFAULT 2,
  pharmacy_max_devices INTEGER NOT NULL DEFAULT 1,
  office_require_approve BOOLEAN NOT NULL DEFAULT TRUE,
  pharmacy_require_approve BOOLEAN NOT NULL DEFAULT TRUE,
  office_block_foreign BOOLEAN NOT NULL DEFAULT TRUE,
  pharmacy_block_foreign BOOLEAN NOT NULL DEFAULT TRUE,
  office_verify_qr BOOLEAN NOT NULL DEFAULT TRUE,
  pharmacy_verify_qr BOOLEAN NOT NULL DEFAULT TRUE,
  office_verify_face BOOLEAN NOT NULL DEFAULT TRUE,
  pharmacy_verify_face BOOLEAN NOT NULL DEFAULT TRUE,
  log_ip_changes BOOLEAN NOT NULL DEFAULT TRUE,
  suspicious_notify BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by_id INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO device_security_settings (id)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM device_security_settings WHERE id = 1);

CREATE TABLE IF NOT EXISTS user_devices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,
  device_name TEXT,
  device_type TEXT NOT NULL DEFAULT 'unknown',
  slot TEXT NOT NULL DEFAULT 'general',
  os TEXT,
  os_version TEXT,
  browser TEXT,
  browser_version TEXT,
  user_agent TEXT,
  ip_address TEXT,
  last_ip TEXT,
  approx_location TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_at TIMESTAMPTZ,
  blocked_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_devices_device_id_uidx ON user_devices (device_id);
CREATE INDEX IF NOT EXISTS user_devices_user_idx ON user_devices (user_id);
CREATE INDEX IF NOT EXISTS user_devices_user_verified_idx ON user_devices (user_id, is_verified);

CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  device_row_id INTEGER,
  session_token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_uidx ON user_sessions (session_token_hash);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id);

CREATE TABLE IF NOT EXISTS login_audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  device_row_id INTEGER,
  device_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_reason TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS login_audit_user_idx ON login_audit_logs (user_id);
CREATE INDEX IF NOT EXISTS login_audit_created_idx ON login_audit_logs (created_at);

CREATE TABLE IF NOT EXISTS device_change_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  old_device_row_id INTEGER,
  new_device_row_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by INTEGER
);
CREATE INDEX IF NOT EXISTS device_change_req_user_idx ON device_change_requests (user_id);
CREATE INDEX IF NOT EXISTS device_change_req_status_idx ON device_change_requests (status);

CREATE TABLE IF NOT EXISTS security_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  device_row_id INTEGER,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by INTEGER
);
CREATE INDEX IF NOT EXISTS security_events_user_idx ON security_events (user_id);
CREATE INDEX IF NOT EXISTS security_events_created_idx ON security_events (created_at);

-- ========== Ko‘chma davomat (MOBILE_GPS) ==========
CREATE TABLE IF NOT EXISTS mobile_attendance_settings (
  id SERIAL PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  require_gps BOOLEAN NOT NULL DEFAULT TRUE,
  require_active_shift BOOLEAN NOT NULL DEFAULT FALSE,
  route_tracking_default BOOLEAN NOT NULL DEFAULT FALSE,
  gps_interval_min INTEGER NOT NULL DEFAULT 10,
  max_accuracy_meters INTEGER NOT NULL DEFAULT 50,
  allow_start_anywhere BOOLEAN NOT NULL DEFAULT TRUE,
  allow_end_anywhere BOOLEAN NOT NULL DEFAULT TRUE,
  detect_suspicious BOOLEAN NOT NULL DEFAULT TRUE,
  create_security_events BOOLEAN NOT NULL DEFAULT TRUE,
  retention_days INTEGER NOT NULL DEFAULT 90,
  updated_by_id INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO mobile_attendance_settings (id)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM mobile_attendance_settings WHERE id = 1);

CREATE TABLE IF NOT EXISTS mobile_attendance_permissions (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  user_id INTEGER,
  granted_by_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  permission_type TEXT NOT NULL DEFAULT 'permanent',
  start_date TEXT,
  end_date TEXT,
  weekdays JSONB,
  shift_key TEXT,
  note TEXT,
  allow_anywhere BOOLEAN NOT NULL DEFAULT TRUE,
  allow_start_anywhere BOOLEAN NOT NULL DEFAULT TRUE,
  allow_end_anywhere BOOLEAN NOT NULL DEFAULT TRUE,
  route_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  gps_interval_min INTEGER,
  max_accuracy_meters INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by_id INTEGER
);
CREATE INDEX IF NOT EXISTS mobile_att_perm_emp_idx ON mobile_attendance_permissions (employee_id);
CREATE INDEX IF NOT EXISTS mobile_att_perm_status_idx ON mobile_attendance_permissions (status);
CREATE INDEX IF NOT EXISTS mobile_att_perm_user_idx ON mobile_attendance_permissions (user_id);

CREATE TABLE IF NOT EXISTS mobile_attendance_sessions (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  user_id INTEGER,
  permission_id INTEGER,
  work_date TEXT NOT NULL,
  shift_key TEXT,
  branch_id INTEGER,
  branch_label TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  security_status TEXT NOT NULL DEFAULT 'ok',
  device_row_id INTEGER,
  device_id TEXT,
  session_token_hash TEXT,
  ip_address TEXT,
  user_agent TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  start_latitude DOUBLE PRECISION NOT NULL,
  start_longitude DOUBLE PRECISION NOT NULL,
  start_accuracy DOUBLE PRECISION,
  start_location_ts TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  end_latitude DOUBLE PRECISION,
  end_longitude DOUBLE PRECISION,
  end_accuracy DOUBLE PRECISION,
  end_location_ts TIMESTAMPTZ,
  route_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  attendance_record_id INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mobile_att_sess_emp_date_idx ON mobile_attendance_sessions (employee_id, work_date);
CREATE INDEX IF NOT EXISTS mobile_att_sess_status_idx ON mobile_attendance_sessions (status);
CREATE INDEX IF NOT EXISTS mobile_att_sess_user_idx ON mobile_attendance_sessions (user_id);

CREATE TABLE IF NOT EXISTS mobile_location_points (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sequence_number INTEGER NOT NULL DEFAULT 0,
  point_type TEXT NOT NULL DEFAULT 'track'
);
CREATE INDEX IF NOT EXISTS mobile_loc_points_sess_idx ON mobile_location_points (session_id);
CREATE INDEX IF NOT EXISTS mobile_loc_points_recorded_idx ON mobile_location_points (recorded_at);

CREATE TABLE IF NOT EXISTS mobile_attendance_audit_logs (
  id SERIAL PRIMARY KEY,
  session_id INTEGER,
  employee_id INTEGER,
  actor_id INTEGER,
  action TEXT NOT NULL,
  metadata JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mobile_att_audit_emp_idx ON mobile_attendance_audit_logs (employee_id);
CREATE INDEX IF NOT EXISTS mobile_att_audit_created_idx ON mobile_attendance_audit_logs (created_at);
CREATE INDEX IF NOT EXISTS mobile_att_audit_action_idx ON mobile_attendance_audit_logs (action);
`);
    await ensureRevisionVisitsSchema();
    await ensureWarehouseShiftsSchema();
  } catch (err) {
    logger.error({ err }, "Failed to ensure DB schema");
    throw err;
  } finally {
    client.release();
  }

  try {
    const { syncAllRoleDepartmentAssignments } = await import("./role-departments");
    await syncAllRoleDepartmentAssignments();
  } catch (err) {
    logger.warn({ err }, "Role department sync skipped");
  }

  try {
    const { ensureDistribyutsiyaSetup } = await import("./distribyutsiya-department");
    await ensureDistribyutsiyaSetup();
  } catch (err) {
    logger.warn({ err }, "Distribyutsiya setup skipped");
  }

  try {
    const { ensureOmborxonaDepartmentId } = await import("./omborxona-department");
    await ensureOmborxonaDepartmentId();
  } catch (err) {
    logger.warn({ err }, "Omborxona department setup skipped");
  }
}

/** Filial reviziya sikli — ENSURE_SQL oxirida bo‘lishiga qaramay alohida kafolat */
const REVISION_VISITS_SQL = `
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS visit_id INTEGER;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS entity_id INTEGER;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS user_role TEXT;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS old_value JSONB;
ALTER TABLE revision_audit_log ADD COLUMN IF NOT EXISTS new_value JSONB;
CREATE INDEX IF NOT EXISTS revision_audit_log_visit_idx ON revision_audit_log (visit_id);

CREATE TABLE IF NOT EXISTS revision_visits (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL,
  branch_name TEXT NOT NULL,
  revision_date TEXT,
  scheduled_date TEXT,
  scheduled_start_time TEXT,
  scheduled_end_time TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by_id INTEGER,
  duration_minutes INTEGER,
  assigned_employee_id INTEGER,
  assigned_employee_name TEXT,
  workflow_status TEXT NOT NULL DEFAULT 'ASSIGNED',
  priority TEXT NOT NULL DEFAULT 'normal',
  shortage_amount INTEGER NOT NULL DEFAULT 0,
  excess_amount INTEGER NOT NULL DEFAULT 0,
  collected_amount INTEGER NOT NULL DEFAULT 0,
  remaining_amount INTEGER NOT NULL DEFAULT 0,
  act_number TEXT,
  act_url TEXT,
  receipt_url TEXT,
  extra_docs JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  responsible_name TEXT,
  next_revision_date TEXT,
  next_revision_date_override TEXT,
  cycle_months INTEGER,
  created_by_id INTEGER,
  updated_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS revision_visits_branch_idx ON revision_visits (branch_id);
CREATE INDEX IF NOT EXISTS revision_visits_status_idx ON revision_visits (workflow_status);
CREATE INDEX IF NOT EXISTS revision_visits_scheduled_idx ON revision_visits (scheduled_date);
CREATE INDEX IF NOT EXISTS revision_visits_assigned_idx ON revision_visits (assigned_employee_id);
CREATE INDEX IF NOT EXISTS revision_visits_revision_date_idx ON revision_visits (revision_date);
CREATE INDEX IF NOT EXISTS revision_visits_created_idx ON revision_visits (created_at);
`;

const WAREHOUSE_SHIFTS_SQL = `
CREATE TABLE IF NOT EXISTS warehouse_shifts (
  id SERIAL PRIMARY KEY,
  department_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_hm TEXT NOT NULL,
  end_hm TEXT NOT NULL,
  overnight BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wh_shifts_dept_idx ON warehouse_shifts (department_id);
CREATE INDEX IF NOT EXISTS wh_shifts_active_idx ON warehouse_shifts (active);

CREATE TABLE IF NOT EXISTS warehouse_shift_members (
  id SERIAL PRIMARY KEY,
  shift_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  department_id INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by_id INTEGER,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS wh_shift_members_shift_idx ON warehouse_shift_members (shift_id);
CREATE INDEX IF NOT EXISTS wh_shift_members_emp_idx ON warehouse_shift_members (employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS wh_shift_members_emp_active_uidx
  ON warehouse_shift_members (employee_id) WHERE active = true;
`;

export async function ensureWarehouseShiftsSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(WAREHOUSE_SHIFTS_SQL);
    logger.info("Warehouse shifts schema ensured");
  } catch (err) {
    logger.warn({ err }, "Warehouse shifts schema ensure failed");
    throw err;
  } finally {
    client.release();
  }
}

const LOKATSIYA_BOT_SQL = `
CREATE TABLE IF NOT EXISTS lokatsiya_bot_users (
  telegram_user_id BIGINT PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  starts_count INTEGER NOT NULL DEFAULT 1,
  branch_views INTEGER NOT NULL DEFAULT 0,
  last_action TEXT,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_at TIMESTAMPTZ,
  first_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lokatsiya_bot_users_last_seen_idx ON lokatsiya_bot_users (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS lokatsiya_bot_users_blocked_idx ON lokatsiya_bot_users (is_blocked);

CREATE TABLE IF NOT EXISTS lokatsiya_bot_recruiters (
  telegram_user_id BIGINT PRIMARY KEY,
  chat_id BIGINT NOT NULL DEFAULT 0,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  added_by_telegram_id BIGINT,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lokatsiya_bot_recruiters_active_idx ON lokatsiya_bot_recruiters (is_active);
`;

const STAFF_NEED_REQUESTS_SQL = `
CREATE TABLE IF NOT EXISTS staff_need_requests (
  id SERIAL PRIMARY KEY,
  coordinator_user_id INTEGER NOT NULL,
  manager_employee_id INTEGER,
  branch_location TEXT,
  shift_type TEXT NOT NULL DEFAULT 'one',
  shift_label TEXT,
  role_needed TEXT NOT NULL DEFAULT 'farmasevt',
  position_text TEXT,
  source_type TEXT NOT NULL DEFAULT 'pharmacy',
  needed_by TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending_hr',
  hr_approved_by_id INTEGER,
  hr_approved_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ,
  found_by_id INTEGER,
  found_at TIMESTAMPTZ,
  rejected_by_id INTEGER,
  rejected_at TIMESTAMPTZ,
  reject_reason TEXT,
  request_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE staff_need_requests ALTER COLUMN manager_employee_id DROP NOT NULL;
ALTER TABLE staff_need_requests ADD COLUMN IF NOT EXISTS position_text TEXT;
ALTER TABLE staff_need_requests ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'pharmacy';
ALTER TABLE staff_need_requests ADD COLUMN IF NOT EXISTS needed_by TEXT;
CREATE INDEX IF NOT EXISTS staff_need_requests_status_idx ON staff_need_requests (status);
CREATE INDEX IF NOT EXISTS staff_need_requests_coord_idx ON staff_need_requests (coordinator_user_id);
CREATE INDEX IF NOT EXISTS staff_need_requests_mgr_idx ON staff_need_requests (manager_employee_id);

CREATE TABLE IF NOT EXISTS app_one_time_jobs (
  job_key TEXT PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT
);
`;

/** Majburiy tozalash v2: ogohlantirish, ariza, ehtiyoj, javob olish, vacancy → 0 */
const PURGE_LEGACY_STAFF_NEEDS_SQL = `
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app_one_time_jobs WHERE job_key = 'purge_legacy_staff_needs_v2') THEN
    RETURN;
  END IF;

  UPDATE staffing_alerts
  SET workflow_status = 'closed', updated_at = NOW()
  WHERE workflow_status IN ('pending', 'confirmed');

  UPDATE requests
  SET status = 'closed', updated_at = NOW()
  WHERE status IN ('submitted', 'reviewing', 'accepted', 'announced');

  UPDATE branch_needs
  SET status = 'closed', closed_at = COALESCE(closed_at, NOW()), updated_at = NOW()
  WHERE status IN ('pending', 'assigned', 'in_progress', 'done');

  UPDATE employees
  SET employment_status = 'closed', updated_at = NOW()
  WHERE employment_status IN ('need_hire', 'searching', 'new')
    AND org_role IN ('pharmacist', 'intern', 'supervisor', 'manager');

  UPDATE javob_olish_requests
  SET status = 'cancelled', updated_at = NOW()
  WHERE status IN ('pending', 'pending_coord', 'pending_hr');

  UPDATE vacancies
  SET status = 'closed', updated_at = NOW()
  WHERE status IN ('draft', 'published');

  UPDATE request_claims
  SET status = 'rejected', updated_at = NOW()
  WHERE status IN ('pending', 'accepted');

  -- Eski ochiq Xodim kerak so‘rovlari ham nol
  UPDATE staff_need_requests
  SET status = 'cancelled', updated_at = NOW()
  WHERE status IN ('pending_hr', 'approved', 'searching');

  INSERT INTO app_one_time_jobs (job_key, note)
  VALUES (
    'purge_legacy_staff_needs_v2',
    'To‘liq nol: alert/ariza/ehtiyoj/javob/vacancy — faqat yangi Xodim kerak oqimi'
  )
  ON CONFLICT (job_key) DO NOTHING;
END $$;
`;

export async function ensureLokatsiyaBotSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(LOKATSIYA_BOT_SQL);
    logger.info("Lokatsiya bot schema ensured");
  } catch (err) {
    logger.warn({ err }, "Lokatsiya bot schema ensure failed");
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureStaffNeedRequestsSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(STAFF_NEED_REQUESTS_SQL);
    await client.query(PURGE_LEGACY_STAFF_NEEDS_SQL);
    logger.info("Staff need requests schema + legacy purge ensured");
  } catch (err) {
    logger.warn({ err }, "Staff need requests schema ensure failed");
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureRevisionVisitsSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(REVISION_VISITS_SQL);
    logger.info("Revision visits schema ensured");
  } catch (err) {
    logger.warn({ err }, "Revision visits schema ensure failed");
    throw err;
  } finally {
    client.release();
  }
}
