/**
 * Ma'lumotnoma — xodim haqida rasmiy 1 varaqli A4 hujjat.
 * Admin/HR xodimni tanlab yaratadi; QR orqali haqiqiylik tekshiriladi.
 */
import { randomBytes, randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { db, employeesTable, pool, usersTable } from "@workspace/db";
import { workScheduleForStaff } from "./shift-hours";
import { getLetterSettings } from "./explanation-letter";
import { formatPersonName } from "./person-name";
import { displayBranchName } from "./geo-location";

const require = createRequire(import.meta.url);

export type MalumotnomaStatus = "active" | "cancelled";

export type MalumotnomaRow = {
  id: number;
  docNo: string;
  verifyToken: string;
  employeeId: number;
  userId: number | null;
  fullName: string;
  position: string;
  branch: string;
  shiftLabel: string;
  workStart: string;
  workEnd: string;
  companyName: string;
  directorName: string;
  directorTitle: string;
  status: MalumotnomaStatus;
  issuedAt: string;
  issuedByName: string | null;
  qrPng: string | null;
};

export type MalumotnomaSettings = {
  companyName: string;
  directorTitle: string;
  directorName: string;
};

export const DEFAULT_MALUMOTNOMA_SETTINGS: MalumotnomaSettings = {
  companyName: "«VAKSINA HEALTHCARE» MChJ",
  directorTitle: "Kompaniya direktori",
  directorName: "E. Avalov",
};

let ready: Promise<void> | null = null;

export function ensureMalumotnomaSchema(): Promise<void> {
  if (!ready) {
    ready = pool
      .query(
        `CREATE TABLE IF NOT EXISTS malumotnomalar (
           id SERIAL PRIMARY KEY,
           doc_no TEXT UNIQUE NOT NULL,
           verify_token TEXT UNIQUE NOT NULL,
           employee_id INTEGER NOT NULL,
           user_id INTEGER,
           full_name TEXT NOT NULL,
           position TEXT NOT NULL,
           branch TEXT NOT NULL,
           shift_label TEXT NOT NULL,
           work_start TEXT NOT NULL,
           work_end TEXT NOT NULL,
           company_name TEXT NOT NULL,
           director_name TEXT NOT NULL,
           director_title TEXT NOT NULL,
           qr_png TEXT,
           issued_by INTEGER,
           issued_by_name TEXT,
           issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           status TEXT NOT NULL DEFAULT 'active'
         );
         CREATE INDEX IF NOT EXISTS malumotnomalar_emp_idx ON malumotnomalar (employee_id, issued_at DESC);
         ALTER TABLE malumotnomalar ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
         CREATE TABLE IF NOT EXISTS malumotnoma_settings (
           id INTEGER PRIMARY KEY DEFAULT 1,
           company_name TEXT NOT NULL,
           director_title TEXT NOT NULL,
           director_name TEXT NOT NULL,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );`,
      )
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v || "");
}

function toRow(r: Record<string, unknown>): MalumotnomaRow {
  const branchRaw = String(r.branch || "");
  return {
    id: Number(r.id),
    docNo: String(r.doc_no),
    verifyToken: String(r.verify_token),
    employeeId: Number(r.employee_id),
    userId: r.user_id == null ? null : Number(r.user_id),
    fullName: String(r.full_name || "—"),
    position: String(r.position || ""),
    branch: displayBranchName(branchRaw).trim() || "—",
    shiftLabel: String(r.shift_label || ""),
    workStart: String(r.work_start || ""),
    workEnd: String(r.work_end || ""),
    companyName: String(r.company_name || DEFAULT_MALUMOTNOMA_SETTINGS.companyName),
    directorName: String(r.director_name || DEFAULT_MALUMOTNOMA_SETTINGS.directorName),
    directorTitle: String(r.director_title || DEFAULT_MALUMOTNOMA_SETTINGS.directorTitle),
    status: String(r.status || "active") === "cancelled" ? "cancelled" : "active",
    issuedAt: iso(r.issued_at),
    issuedByName: r.issued_by_name ? String(r.issued_by_name) : null,
    qrPng: r.qr_png ? String(r.qr_png) : null,
  };
}

const SELECT = `id, doc_no, verify_token, employee_id, user_id, full_name, position, branch,
  shift_label, work_start, work_end, company_name, director_name, director_title,
  qr_png, issued_by_name, issued_at, COALESCE(status, 'active') AS status`;

async function nextDocNo(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const letters = Array.from({ length: 4 }, () => String.fromCharCode(65 + randomInt(26))).join("");
    const digits = String(randomInt(0, 100_000)).padStart(5, "0");
    const no = `ML-${letters}-${digits}`;
    const { rowCount } = await pool.query(`SELECT 1 FROM malumotnomalar WHERE doc_no = $1`, [no]);
    if (!rowCount) return no;
  }
  return `ML-${Date.now().toString(36).toUpperCase()}`;
}

export async function getMalumotnomaSettings(): Promise<MalumotnomaSettings> {
  await ensureMalumotnomaSchema();
  const { rows } = await pool.query(
    `SELECT company_name, director_title, director_name FROM malumotnoma_settings WHERE id = 1`,
  );
  if (rows[0]) {
    return {
      companyName: String(rows[0].company_name || DEFAULT_MALUMOTNOMA_SETTINGS.companyName),
      directorTitle: String(rows[0].director_title || DEFAULT_MALUMOTNOMA_SETTINGS.directorTitle),
      directorName: String(rows[0].director_name || DEFAULT_MALUMOTNOMA_SETTINGS.directorName),
    };
  }
  // Birinchi marta — tushuntirish xati sozlamalaridan taxminiy qiymat
  try {
    const letter = await getLetterSettings();
    const company = letter.companyName || DEFAULT_MALUMOTNOMA_SETTINGS.companyName;
    const dirLine = letter.headerLines.find((l) => /direkt/i.test(l)) || "";
    const m = dirLine.match(/direktori?\s+(.+)$/i);
    const directorName = m?.[1]?.replace(/ga$/i, "").trim() || DEFAULT_MALUMOTNOMA_SETTINGS.directorName;
    return { companyName: company, directorTitle: DEFAULT_MALUMOTNOMA_SETTINGS.directorTitle, directorName };
  } catch {
    return { ...DEFAULT_MALUMOTNOMA_SETTINGS };
  }
}

export async function saveMalumotnomaSettings(s: MalumotnomaSettings): Promise<MalumotnomaSettings> {
  await ensureMalumotnomaSchema();
  const companyName = s.companyName.trim() || DEFAULT_MALUMOTNOMA_SETTINGS.companyName;
  const directorTitle = s.directorTitle.trim() || DEFAULT_MALUMOTNOMA_SETTINGS.directorTitle;
  const directorName = s.directorName.trim() || DEFAULT_MALUMOTNOMA_SETTINGS.directorName;
  await pool.query(
    `INSERT INTO malumotnoma_settings (id, company_name, director_title, director_name, updated_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       company_name = EXCLUDED.company_name,
       director_title = EXCLUDED.director_title,
       director_name = EXCLUDED.director_name,
       updated_at = NOW()`,
    [companyName, directorTitle, directorName],
  );
  return { companyName, directorTitle, directorName };
}

function shiftLabelUz(shiftType?: string | null, shiftLabel?: string | null, scheduleLabel?: string): string {
  const raw = String(shiftType || "").trim().toLowerCase();
  if (raw === "one+two" || /1\s*\+\s*2/.test(String(shiftLabel || ""))) return "1+2 smena";
  if (raw === "two+three" || /2\s*\+\s*3/.test(String(shiftLabel || ""))) return "2+3 smena";
  if (raw === "one+three" || /1\s*\+\s*3/.test(String(shiftLabel || ""))) return "1+3 smena";
  if (raw === "one" || raw === "1") return "1-smena";
  if (raw === "two" || raw === "2") return "2-smena";
  if (raw === "three" || raw === "3") return "3-smena";
  if (raw === "office" || /ofis/i.test(String(shiftLabel || ""))) return "Ofis grafigi";
  if (String(shiftLabel || "").trim()) return String(shiftLabel).trim();
  return scheduleLabel || "Ish grafigi";
}

function rolePosition(role?: string | null, position?: string | null): string {
  const p = String(position || "").trim();
  if (p) return p;
  const r = String(role || "").toLowerCase();
  if (r === "farmasevt") return "Farmasevt";
  if (r === "mudir") return "Filial mudiri";
  if (r === "stajyor" || r === "stajor") return "Stajyor";
  if (r === "koordinator") return "Koordinator";
  return "Xodim";
}

function cleanBranchName(raw?: string | null): string {
  const name = displayBranchName(raw).trim();
  return name || "—";
}

export async function searchMalumotnomaStaff(q: string): Promise<
  Array<{
    employeeId: number;
    userId: number | null;
    fullName: string;
    position: string;
    branch: string;
    shiftLabel: string;
    workStart: string;
    workEnd: string;
    role: string | null;
  }>
> {
  const term = q.trim().toLocaleLowerCase("uz");
  const rows = await db
    .select({
      employeeId: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      location: employeesTable.location,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      orgRole: employeesTable.orgRole,
      status: employeesTable.employmentStatus,
      role: usersTable.role,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .limit(400);

  const out = [];
  for (const r of rows) {
    const st = String(r.status || "").toLowerCase();
    if (["dismissed", "closed", "terminated", "need_hire", "no_manager"].includes(st)) continue;
    if (/xodim kerak/i.test(r.fullName || "")) continue;
    const fullName = formatPersonName(r.fullName || "") || r.fullName || "—";
    if (term) {
      const hay = `${fullName} ${r.position || ""} ${r.location || ""} ${r.role || ""}`.toLocaleLowerCase("uz");
      if (!hay.includes(term)) continue;
    }
    const schedule = workScheduleForStaff(r.role, r.orgRole, r.shiftType, r.shiftLabel);
    out.push({
      employeeId: r.employeeId,
      userId: r.userId,
      fullName,
      position: rolePosition(r.role, r.position),
      branch: cleanBranchName(r.location),
      shiftLabel: shiftLabelUz(r.shiftType, r.shiftLabel, schedule.label),
      workStart: schedule.start,
      workEnd: schedule.end,
      role: r.role,
    });
    if (out.length >= 40) break;
  }
  return out.sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));
}

async function qrDataUrl(text: string): Promise<string> {
  try {
    const QRCode = require("qrcode") as typeof import("qrcode");
    return await QRCode.toDataURL(text, {
      width: 512,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#4A1C6A", light: "#ffffff" },
    });
  } catch {
    return "";
  }
}

export async function createMalumotnoma(input: {
  employeeId: number;
  issuedBy?: number | null;
  issuedByName?: string | null;
  origin: string;
}): Promise<MalumotnomaRow> {
  await ensureMalumotnomaSchema();
  const settings = await getMalumotnomaSettings();
  const [row] = await db
    .select({
      employeeId: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      location: employeesTable.location,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      orgRole: employeesTable.orgRole,
      role: usersTable.role,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .where(eq(employeesTable.id, input.employeeId))
    .limit(1);
  if (!row) throw Object.assign(new Error("Xodim topilmadi"), { status: 404 });

  const schedule = workScheduleForStaff(row.role, row.orgRole, row.shiftType, row.shiftLabel);
  const docNo = await nextDocNo();
  const token = randomBytes(18).toString("base64url");
  const verifyUrl = `${input.origin.replace(/\/$/, "")}/ml/${token}`;
  const qr = await qrDataUrl(verifyUrl);
  const { rows } = await pool.query(
    `INSERT INTO malumotnomalar
       (doc_no, verify_token, employee_id, user_id, full_name, position, branch, shift_label,
        work_start, work_end, company_name, director_name, director_title, qr_png, issued_by, issued_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING ${SELECT}`,
    [
      docNo,
      token,
      row.employeeId,
      row.userId,
      formatPersonName(row.fullName || "") || row.fullName || "—",
      rolePosition(row.role, row.position),
      cleanBranchName(row.location),
      shiftLabelUz(row.shiftType, row.shiftLabel, schedule.label),
      schedule.start,
      schedule.end,
      settings.companyName,
      settings.directorName,
      settings.directorTitle,
      qr || null,
      input.issuedBy ?? null,
      input.issuedByName ?? null,
    ],
  );
  return toRow(rows[0]);
}

export async function malumotnomaById(id: number): Promise<MalumotnomaRow | null> {
  await ensureMalumotnomaSchema();
  const { rows } = await pool.query(`SELECT ${SELECT} FROM malumotnomalar WHERE id = $1`, [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function malumotnomaByToken(token: string): Promise<MalumotnomaRow | null> {
  await ensureMalumotnomaSchema();
  const { rows } = await pool.query(`SELECT ${SELECT} FROM malumotnomalar WHERE verify_token = $1`, [token]);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function listMalumotnomalar(limit = 50): Promise<MalumotnomaRow[]> {
  await ensureMalumotnomaSchema();
  const { rows } = await pool.query(
    `SELECT ${SELECT} FROM malumotnomalar ORDER BY issued_at DESC LIMIT $1`,
    [Math.min(200, Math.max(1, limit))],
  );
  return rows.map(toRow);
}

export function malumotnomaVerifyUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/ml/${token}`;
}

export function fmtMalumotnomaDate(isoStr: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(isoStr));
  } catch {
    return isoStr.slice(0, 10);
  }
}

/** Admin: hujjatni bekor qilish (QR endi haqiqiy emas) */
export async function cancelMalumotnoma(id: number): Promise<MalumotnomaRow | null> {
  await ensureMalumotnomaSchema();
  const { rows } = await pool.query(
    `UPDATE malumotnomalar SET status = 'cancelled' WHERE id = $1 RETURNING ${SELECT}`,
    [id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** Admin: hujjatni butunlay o‘chirish */
export async function deleteMalumotnoma(id: number): Promise<boolean> {
  await ensureMalumotnomaSchema();
  const { rowCount } = await pool.query(`DELETE FROM malumotnomalar WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
