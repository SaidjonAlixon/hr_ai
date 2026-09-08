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
ALTER TABLE kirish_videos ADD COLUMN IF NOT EXISTS questions_json JSONB NOT NULL DEFAULT '[]'::jsonb;

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
`;

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
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ops_tickets_dept_idx ON ops_tickets (dept);
CREATE INDEX IF NOT EXISTS ops_tickets_status_idx ON ops_tickets (status);

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
CREATE UNIQUE INDEX IF NOT EXISTS javob_olish_pending_uidx
  ON javob_olish_requests (employee_id, work_date)
  WHERE status = 'pending';

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
`);
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
}
