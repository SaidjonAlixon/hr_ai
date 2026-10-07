/**
 * Tushuntirish xati: har bir davomat jarimasi (kechikish / kelmaslik) uchun xodimdan
 * avtomatik so‘raladi. Xodim o‘qiydi → sababini yozib tasdiqlaydi (QR qo‘yiladi) →
 * imzo chizadi → xat 1 varaqli PDF sifatida saqlanadi. Admin va xodimning o‘ziga ko‘rinadi.
 */
import { randomBytes, randomInt } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { notifyUser } from "./notify";
import type { JarimaPerson } from "./attendance-jarima";
import { isJarimaEnabled } from "./jarima-switch";

/** Oxirgi ogohlantirish (ishdan bo‘shatishga rozilik) xati shu martadan */
export const FINAL_STRIKE = 6;

export type LetterKind = "late" | "absent";
export type LetterStatus = "pending" | "confirmed" | "signed";

export type ExplanationLetterRow = {
  id: number;
  userId: number;
  employeeId: number | null;
  month: string;
  eventDate: string;
  kind: LetterKind;
  strikeN: number;
  fullName: string;
  position: string;
  branch: string;
  shift: string;
  planStart: string | null;
  planEnd: string | null;
  checkIn: string | null;
  lateMinutes: number | null;
  amount: number;
  phone: string | null;
  status: LetterStatus;
  reasonCode: string | null;
  reasonText: string | null;
  letterNo: string;
  verifyToken: string | null;
  confirmedAt: string | null;
  signedAt: string | null;
  hasSignature: boolean;
  hasQr: boolean;
  isTest: boolean;
  /** Rahbariyat qarori: tasdiqlandi (jarima qoladi) yoki bekor qilindi (holat hisobdan chiqadi) */
  reviewStatus: ReviewStatus | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  finalConsentAt: string | null;
  createdAt: string;
};

export type ReviewStatus = "approved" | "cancelled";

export type LetterSettings = {
  /** Shapkada o‘ng tomonda — kimga (har bir qator alohida) */
  headerLines: string[];
  /** Matn ichidagi tashkilot nomi */
  companyName: string;
};

export const DEFAULT_LETTER_SETTINGS: LetterSettings = {
  headerLines: ["«VAKSINA HEALTHCARE» MChJ", "direktori E.Avalovga"],
  companyName: "«VAKSINA HEALTHCARE» MChJ",
};

export const REASONS: Record<LetterKind, Array<{ code: string; label: string; sentence: string }>> = {
  late: [
    { code: "transport", label: "Transport / tirbandlik", sentence: "jamoat transporti kechikkani va yo‘llardagi tirbandlik sababli yo‘lda ushlanib qoldim" },
    { code: "health", label: "Sog‘lig‘im bilan bog‘liq", sentence: "ertalab sog‘lig‘im yomonlashgani sababli uydan o‘z vaqtida chiqa olmadim" },
    { code: "family", label: "Oilaviy sabab", sentence: "kutilmagan oilaviy vaziyat sababli ishga o‘z vaqtida yetib kela olmadim" },
    { code: "overslept", label: "Vaqtni noto‘g‘ri hisobladim", sentence: "vaqtni noto‘g‘ri rejalashtirganim sababli uydan kech chiqdim" },
    { code: "other", label: "Boshqa sabab", sentence: "quyida ko‘rsatilgan sabab tufayli ishga kechikdim" },
  ],
  absent: [
    { code: "health", label: "Kasal bo‘lib qoldim", sentence: "sog‘lig‘im keskin yomonlashgani sababli ishga chiqa olmadim" },
    { code: "family", label: "Oilaviy (shoshilinch) vaziyat", sentence: "shoshilinch oilaviy vaziyat yuzaga kelgani sababli ishga chiqa olmadim" },
    { code: "transport", label: "Yo‘l / transport muammosi", sentence: "yo‘l va transport bilan bog‘liq muammo sababli ish joyimga yetib kela olmadim" },
    { code: "schedule", label: "Ish jadvalini noto‘g‘ri tushundim", sentence: "ish jadvalimni noto‘g‘ri tushunganim sababli o‘sha kuni dam kunim deb o‘yladim" },
    { code: "other", label: "Boshqa sabab", sentence: "quyida ko‘rsatilgan sabab tufayli ishga chiqa olmadim" },
  ],
};

export const REASON_MIN = 40;
export const REASON_MAX = 800;
export const REASON_MIN_WORDS = 6;
/** Sabab faqat xodimning o‘z so‘zlari bilan — tayyor variant tanlanmaydi */
export const MANUAL_REASON = "manual";

export function reasonProblem(text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length < REASON_MIN) return `Sababni to‘liq yozing — kamida ${REASON_MIN} belgi`;
  if (t.length > REASON_MAX) return `Matn ${REASON_MAX} belgidan oshmasin`;
  const words = t.split(" ").filter((w) => /\p{L}{2,}/u.test(w));
  if (words.length < REASON_MIN_WORDS) return `Sababni kamida ${REASON_MIN_WORDS} so‘zdan iborat gap bilan yozing`;
  if (new Set(words.map((w) => w.toLocaleLowerCase("uz"))).size < Math.ceil(words.length / 2)) return "Bir xil so‘zlarni takrorlamang — sababni aniq yozing";
  if (/(.)\1{5,}/u.test(t)) return "Matnda ma’nosiz belgilar bor — sababni aniq yozing";
  return null;
}

let ready: Promise<void> | null = null;

export function ensureExplanationSchema(): Promise<void> {
  if (!ready) {
    ready = pool
      .query(
        `CREATE TABLE IF NOT EXISTS explanation_letters (
           id SERIAL PRIMARY KEY,
           user_id INTEGER NOT NULL,
           employee_id INTEGER,
           month TEXT NOT NULL,
           event_date TEXT NOT NULL,
           kind TEXT NOT NULL,
           strike_n INTEGER NOT NULL DEFAULT 1,
           full_name TEXT,
           position TEXT,
           branch TEXT,
           shift TEXT,
           plan_start TEXT,
           plan_end TEXT,
           check_in TEXT,
           late_minutes INTEGER,
           amount INTEGER NOT NULL DEFAULT 0,
           status TEXT NOT NULL DEFAULT 'pending',
           reason_code TEXT,
           reason_text TEXT,
           letter_no TEXT,
           verify_token TEXT UNIQUE,
           qr_png TEXT,
           signature_png TEXT,
           sign_ip TEXT,
           sign_ua TEXT,
           confirmed_at TIMESTAMPTZ,
           signed_at TIMESTAMPTZ,
           created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
           UNIQUE (user_id, event_date, kind)
         );
         CREATE INDEX IF NOT EXISTS explanation_letters_user_idx ON explanation_letters (user_id, status);
         CREATE INDEX IF NOT EXISTS explanation_letters_month_idx ON explanation_letters (month);
         ALTER TABLE explanation_letters ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
         ALTER TABLE explanation_letters ADD COLUMN IF NOT EXISTS review_status TEXT;
         ALTER TABLE explanation_letters ADD COLUMN IF NOT EXISTS review_note TEXT;
         ALTER TABLE explanation_letters ADD COLUMN IF NOT EXISTS reviewed_by INTEGER;
         ALTER TABLE explanation_letters ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT;
         ALTER TABLE explanation_letters ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
         ALTER TABLE explanation_letters ADD COLUMN IF NOT EXISTS final_consent_at TIMESTAMPTZ;
         CREATE TABLE IF NOT EXISTS explanation_letter_settings (
           id INTEGER PRIMARY KEY DEFAULT 1,
           header_lines JSONB NOT NULL,
           company_name TEXT NOT NULL,
           updated_by_name TEXT,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );
         CREATE TABLE IF NOT EXISTS explanation_letter_numbers (
           letter_no TEXT PRIMARY KEY,
           letter_id INTEGER,
           is_test BOOLEAN NOT NULL DEFAULT FALSE,
           issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         );
         CREATE UNIQUE INDEX IF NOT EXISTS explanation_letters_no_uq ON explanation_letters (letter_no);`,
      )
      .then(() => migrateLetterNumbers())
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

const SELECT_COLS = `l.id, l.user_id, l.employee_id, l.month, l.event_date, l.kind, l.strike_n, l.full_name, l.position,
  l.branch, l.shift, l.plan_start, l.plan_end, l.check_in, l.late_minutes, l.amount, l.status, l.reason_code,
  l.reason_text, l.letter_no, l.verify_token, l.confirmed_at, l.signed_at, l.created_at,
  (l.signature_png IS NOT NULL) AS has_signature, (l.qr_png IS NOT NULL) AS has_qr, l.is_test,
  l.review_status, l.review_note, l.reviewed_by_name, l.reviewed_at, l.final_consent_at, u.phone`;

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

function toRow(r: Record<string, unknown>): ExplanationLetterRow {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    employeeId: r.employee_id == null ? null : Number(r.employee_id),
    month: String(r.month),
    eventDate: String(r.event_date),
    kind: r.kind === "late" ? "late" : "absent",
    strikeN: Number(r.strike_n) || 1,
    fullName: String(r.full_name || "—"),
    position: String(r.position || ""),
    branch: String(r.branch || ""),
    shift: String(r.shift || ""),
    planStart: (r.plan_start as string) || null,
    planEnd: (r.plan_end as string) || null,
    checkIn: (r.check_in as string) || null,
    lateMinutes: r.late_minutes == null ? null : Number(r.late_minutes),
    amount: Number(r.amount) || 0,
    phone: (r.phone as string) || null,
    status: r.status === "signed" ? "signed" : r.status === "confirmed" ? "confirmed" : "pending",
    reasonCode: (r.reason_code as string) || null,
    reasonText: (r.reason_text as string) || null,
    letterNo: String(r.letter_no || "—"),
    verifyToken: (r.verify_token as string) || null,
    confirmedAt: iso(r.confirmed_at),
    signedAt: iso(r.signed_at),
    hasSignature: Boolean(r.has_signature),
    hasQr: Boolean(r.has_qr),
    isTest: Boolean(r.is_test),
    reviewStatus: r.review_status === "approved" || r.review_status === "cancelled" ? r.review_status : null,
    reviewNote: (r.review_note as string) || null,
    reviewedByName: (r.reviewed_by_name as string) || null,
    reviewedAt: iso(r.reviewed_at),
    finalConsentAt: iso(r.final_consent_at),
    createdAt: iso(r.created_at) || new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- hujjat raqami

/** I va O yo‘q — 1 va 0 bilan adashtirilmasin */
const NO_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LETTER_NO_SQL = "^[A-Z]{4}-[0-9]{5}$";

function randomLetterNo(): string {
  let head = "";
  for (let i = 0; i < 4; i++) head += NO_LETTERS[randomInt(NO_LETTERS.length)];
  return `${head}-${randomInt(10000, 100000)}`;
}

/** Raqam reyestrga yoziladi — xat o‘chirilsa ham shu raqam boshqa xatga hech qachon berilmaydi */
async function assignLetterNo(id: number, isTest: boolean): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const no = randomLetterNo();
    const { rowCount } = await pool.query(
      `INSERT INTO explanation_letter_numbers (letter_no, letter_id, is_test) VALUES ($1, $2, $3) ON CONFLICT (letter_no) DO NOTHING`,
      [no, id, isTest],
    );
    if (!rowCount) continue;
    await pool.query(`UPDATE explanation_letters SET letter_no = $2 WHERE id = $1`, [id, no]);
    return no;
  }
  throw new Error("letter_no_exhausted");
}

/** Eski (TX-…/TEST-…) raqamlarni yangi formatga o‘tkazish */
async function migrateLetterNumbers(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, is_test FROM explanation_letters WHERE letter_no IS NULL OR letter_no !~ $1 ORDER BY id`,
    [LETTER_NO_SQL],
  );
  for (const r of rows) await assignLetterNo(Number(r.id), Boolean(r.is_test));
}

/** «abcd 12345», «ABCD-12345», «abcd12345» → «ABCD-12345» */
export function normalizeLetterNo(raw: string): string | null {
  const m = /^([A-Z]{4})(\d{5})$/.exec(raw.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  return m ? `${m[1]}-${m[2]}` : null;
}

/** QR ichidagi `/tx/<token>` havolasi yoki tokenning o‘zi */
export function tokenFromScan(raw: string): string | null {
  const s = raw.trim();
  const m = /\/tx\/([A-Za-z0-9_-]{16,80})(?:[/?#]|$)/.exec(s);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{20,80}$/.test(s) ? s : null;
}

export async function letterByNo(no: string): Promise<ExplanationLetterRow | null> {
  await ensureExplanationSchema();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM explanation_letters l LEFT JOIN users u ON u.id = l.user_id WHERE l.letter_no = $1`,
    [no],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** Raqam qachondir berilganmi (xat keyin o‘chirilgan bo‘lishi mumkin) */
export async function issuedLetterNo(no: string): Promise<{ issuedAt: string | null; isTest: boolean } | null> {
  await ensureExplanationSchema();
  const { rows } = await pool.query(`SELECT issued_at, is_test FROM explanation_letter_numbers WHERE letter_no = $1`, [no]);
  return rows[0] ? { issuedAt: iso(rows[0].issued_at), isTest: Boolean(rows[0].is_test) } : null;
}

/** Jarima hodisalaridan xat yaratish / yangilash. Imzolangan xat o‘zgarmaydi. */
export async function syncExplanationLetters(month: string, people: JarimaPerson[], today: string): Promise<void> {
  await ensureExplanationSchema();
  const keep: string[] = [];
  const recentFrom = shiftYmd(today, -2);
  for (const p of people) {
    for (const ev of p.events) {
      keep.push(`${p.userId}|${ev.date}|${ev.kind}`);
      const { rows } = await pool.query(
        `INSERT INTO explanation_letters
           (user_id, employee_id, month, event_date, kind, strike_n, full_name, position, branch, shift,
            plan_start, plan_end, check_in, late_minutes, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (user_id, event_date, kind) DO UPDATE SET
           strike_n = EXCLUDED.strike_n,
           employee_id = EXCLUDED.employee_id,
           full_name = EXCLUDED.full_name,
           position = EXCLUDED.position,
           branch = EXCLUDED.branch,
           shift = EXCLUDED.shift,
           plan_start = EXCLUDED.plan_start,
           plan_end = EXCLUDED.plan_end,
           check_in = EXCLUDED.check_in,
           late_minutes = EXCLUDED.late_minutes,
           amount = EXCLUDED.amount,
           is_test = FALSE,
           updated_at = NOW()
         WHERE explanation_letters.status <> 'signed'
         RETURNING id, letter_no, (xmax = 0) AS inserted`,
        [
          p.userId,
          p.employeeId,
          month,
          ev.date,
          ev.kind,
          ev.n,
          p.fullName,
          p.position,
          (ev.branch && ev.branch.trim()) || p.branch,
          p.shift,
          ev.planStart ?? null,
          ev.planEnd ?? null,
          ev.kind === "late" ? ev.checkIn ?? null : null,
          ev.kind === "late" ? ev.lateMinutes ?? null : null,
          ev.amount,
        ],
      );
      const row = rows[0];
      if (!row) continue;
      if (!row.letter_no) await assignLetterNo(Number(row.id), false);
      if (row.inserted && ev.date >= recentFrom) {
        const what = ev.kind === "late" ? "kechikish" : "ishga kelmaslik";
        await notifyUser({
          userId: p.userId,
          title: "Tushuntirish xati",
          text: `${fmtDmy(ev.date)} kungi ${what} holati bo‘yicha tushuntirish xati so‘ralmoqda. Platformada o‘qib, sababini yozing va imzolang.`,
          type: "explanation_letter",
          linkUrl: "/oylik",
        }).catch(() => undefined);
      }
    }
  }
  const { rows: stale } = await pool.query(
    `SELECT id, user_id, event_date, kind FROM explanation_letters WHERE month = $1 AND status <> 'signed' AND NOT is_test AND review_status IS NULL`,
    [month],
  );
  const keepSet = new Set(keep);
  const drop = stale.filter((r) => !keepSet.has(`${r.user_id}|${r.event_date}|${r.kind}`)).map((r) => r.id as number);
  if (drop.length) await pool.query(`DELETE FROM explanation_letters WHERE id = ANY($1::int[])`, [drop]);
}

export async function myLetters(userId: number): Promise<ExplanationLetterRow[]> {
  await ensureExplanationSchema();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM explanation_letters l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.user_id = $1 ORDER BY l.event_date DESC, l.id DESC LIMIT 100`,
    [userId],
  );
  return rows.map(toRow);
}

/** `month = null` — barcha oylar (oxirgi 2000 ta) */
export async function lettersForMonth(month: string | null): Promise<ExplanationLetterRow[]> {
  await ensureExplanationSchema();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM explanation_letters l LEFT JOIN users u ON u.id = l.user_id
      WHERE ($1::text IS NULL OR l.month = $1) ORDER BY l.event_date DESC, l.full_name LIMIT 2000`,
    [month],
  );
  return rows.map(toRow);
}

export async function letterMonths(): Promise<string[]> {
  await ensureExplanationSchema();
  const { rows } = await pool.query(`SELECT DISTINCT month FROM explanation_letters ORDER BY month DESC`);
  return rows.map((r) => String(r.month));
}

/** Davomat «Keldim» oldidan: imzolanmagan eng eski xat */
export async function pendingLetterFor(userId: number): Promise<ExplanationLetterRow | null> {
  await ensureExplanationSchema();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM explanation_letters l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.user_id = $1 AND l.status <> 'signed' AND l.review_status IS DISTINCT FROM 'cancelled'
      ORDER BY l.event_date, l.id LIMIT 1`,
    [userId],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function explanationPunchBlock(userId: number | null | undefined): Promise<Record<string, unknown> | null> {
  if (!userId || !(await isJarimaEnabled())) return null;
  const l = await pendingLetterFor(userId).catch((err) => {
    logLetterError(err, "punch-gate");
    return null;
  });
  if (!l) return null;
  const what = l.kind === "late" ? "kechikish" : "ishga kelmaslik";
  return {
    error: `Avval ${fmtDmy(l.eventDate)} kungi ${what} bo‘yicha tushuntirish xatini yozib imzolang — shundan keyin davomat belgilanadi.`,
    code: "explanation_required",
    letterId: l.id,
    letterNo: l.letterNo,
    eventDate: l.eventDate,
    kind: l.kind,
  };
}

// ---------------------------------------------------------------- test (admin)

export type TestLetterInput = {
  userId: number;
  kind: LetterKind;
  strikeN: number;
  eventDate: string;
  lateMinutes: number | null;
};

export async function createTestLetter(input: TestLetterInput): Promise<ExplanationLetterRow | { error: string }> {
  await ensureExplanationSchema();
  const { rows: people } = await pool.query(
    `SELECT u.id, u.full_name, u.role, e.id AS employee_id, e.position, e.shift_type, e.shift_label, e.fixed_salary,
            COALESCE(NULLIF(TRIM(e.location), ''), NULLIF(TRIM(b.location), '')) AS branch
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM employees x WHERE x.user_id = u.id
          ORDER BY (x.employment_status = 'dismissed'), x.id DESC LIMIT 1
       ) e ON TRUE
       LEFT JOIN employees b ON b.id = e.assigned_branch_id
      WHERE u.id = $1`,
    [input.userId],
  );
  const p = people[0];
  if (!p) return { error: "Foydalanuvchi topilmadi" };
  const planStart = "08:00";
  const late = input.kind === "late" ? Math.max(1, input.lateMinutes ?? 25) : null;
  const checkIn = late != null ? `${String(8 + Math.floor(late / 60)).padStart(2, "0")}:${String(late % 60).padStart(2, "0")}` : null;
  const shift = p.shift_label ? String(p.shift_label) : p.shift_type === "two" ? "2-smena" : "1-smena";
  const strikeN = Math.min(10, Math.max(1, input.strikeN));
  const salary = Math.max(0, Number(p.fixed_salary) || 0);
  const [yy, mm] = input.eventDate.split("-").map(Number);
  const monthDays = new Date(Date.UTC(yy!, mm!, 0)).getUTCDate();
  const amount = Math.round(
    strikeN <= 1 ? 0 : strikeN <= 3 ? (salary / monthDays) * 0.3 : strikeN === 4 ? salary / monthDays : salary * 0.5,
  );
  const { rows } = await pool.query(
    `INSERT INTO explanation_letters
       (user_id, employee_id, month, event_date, kind, strike_n, full_name, position, branch, shift,
        plan_start, plan_end, check_in, late_minutes, amount, is_test)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE)
     ON CONFLICT (user_id, event_date, kind) DO NOTHING
     RETURNING id`,
    [
      p.id,
      p.employee_id ?? null,
      input.eventDate.slice(0, 7),
      input.eventDate,
      input.kind,
      strikeN,
      p.full_name,
      p.position || "Farmasevt",
      p.branch || "Test",
      shift,
      planStart,
      "20:00",
      checkIn,
      late,
      amount,
    ],
  );
  const id = rows[0]?.id as number | undefined;
  if (!id) return { error: "Shu kun va tur uchun xat allaqachon bor — boshqa sana tanlang" };
  await assignLetterNo(id, true);
  await notifyUser({
    userId: p.id,
    title: "Tushuntirish xati (test)",
    text: `${fmtDmy(input.eventDate)} kungi ${input.kind === "late" ? "kechikish" : "ishga kelmaslik"} holati bo‘yicha test tushuntirish xati. Imzolanmaguncha keyingi davomat belgilanmaydi.`,
    type: "explanation_letter",
    linkUrl: "/oylik",
  }).catch(() => undefined);
  return (await letterById(id))!;
}

export async function testLetters(): Promise<ExplanationLetterRow[]> {
  await ensureExplanationSchema();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM explanation_letters l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.is_test ORDER BY l.id DESC LIMIT 100`,
  );
  return rows.map(toRow);
}

/** `ids` berilmasa — barcha test xatlari */
export async function deleteTestLetters(ids?: number[]): Promise<number> {
  await ensureExplanationSchema();
  const { rowCount } = ids?.length
    ? await pool.query(`DELETE FROM explanation_letters WHERE is_test AND id = ANY($1::int[])`, [ids])
    : await pool.query(`DELETE FROM explanation_letters WHERE is_test`);
  return rowCount ?? 0;
}

export async function letterUserOptions(q: string): Promise<Array<{ id: number; fullName: string; role: string; branch: string | null }>> {
  const needle = `%${q.trim().toLocaleLowerCase("uz")}%`;
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.role,
            (SELECT COALESCE(NULLIF(TRIM(e.location), ''), NULLIF(TRIM(b.location), ''))
               FROM employees e LEFT JOIN employees b ON b.id = e.assigned_branch_id
              WHERE e.user_id = u.id ORDER BY e.id DESC LIMIT 1) AS branch
       FROM users u
      WHERE u.status = 'active' AND ($1 = '%%' OR LOWER(u.full_name) LIKE $1 OR LOWER(u.login) LIKE $1)
      ORDER BY (u.role IN ('farmasevt','mudir','stajyor','stajor')) DESC, u.full_name
      LIMIT 30`,
    [needle],
  );
  return rows.map((r) => ({ id: Number(r.id), fullName: String(r.full_name), role: String(r.role), branch: (r.branch as string) || null }));
}

export async function letterById(id: number): Promise<ExplanationLetterRow | null> {
  await ensureExplanationSchema();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM explanation_letters l LEFT JOIN users u ON u.id = l.user_id WHERE l.id = $1`,
    [id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function letterByToken(token: string): Promise<ExplanationLetterRow | null> {
  await ensureExplanationSchema();
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} FROM explanation_letters l LEFT JOIN users u ON u.id = l.user_id WHERE l.verify_token = $1`,
    [token],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function letterImages(id: number): Promise<{ qr: string | null; signature: string | null }> {
  const { rows } = await pool.query(`SELECT qr_png, signature_png FROM explanation_letters WHERE id = $1`, [id]);
  return { qr: (rows[0]?.qr_png as string) || null, signature: (rows[0]?.signature_png as string) || null };
}

/** 1-qadam: xodim o‘qib, sababini o‘zi yozib tasdiqlaydi — QR uchun token beriladi */
export async function confirmLetter(id: number, reasonText: string, finalConsent: boolean): Promise<ExplanationLetterRow | null> {
  const token = randomBytes(18).toString("base64url");
  await pool.query(
    `UPDATE explanation_letters
        SET status = 'confirmed', reason_code = $2, reason_text = $3,
            verify_token = COALESCE(verify_token, $4), confirmed_at = NOW(), updated_at = NOW(),
            final_consent_at = CASE WHEN $5 THEN NOW() ELSE final_consent_at END
      WHERE id = $1 AND status <> 'signed'`,
    [id, MANUAL_REASON, reasonText, token, finalConsent],
  );
  return letterById(id);
}

/** Rahbariyat qarori. `reset` — qarorni qaytarish */
export async function reviewLetter(
  id: number,
  action: "approve" | "cancel" | "reset",
  note: string | null,
  by: { id: number; name: string },
): Promise<ExplanationLetterRow | null> {
  if (action === "reset") {
    await pool.query(
      `UPDATE explanation_letters
          SET review_status = NULL, review_note = NULL, reviewed_by = NULL, reviewed_by_name = NULL, reviewed_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [id],
    );
  } else {
    await pool.query(
      `UPDATE explanation_letters
          SET review_status = $2, review_note = $3, reviewed_by = $4, reviewed_by_name = $5, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [id, action === "approve" ? "approved" : "cancelled", note, by.id, by.name],
    );
  }
  return letterById(id);
}

/** Bekor qilingan xatlar — `user|sana|tur`; jarima hisobidan chiqariladi */
export async function cancelledLetterKeys(from: string, to: string): Promise<Set<string>> {
  await ensureExplanationSchema();
  const { rows } = await pool.query(
    `SELECT user_id, event_date, kind FROM explanation_letters
      WHERE review_status = 'cancelled' AND NOT is_test AND event_date BETWEEN $1 AND $2`,
    [from, to],
  );
  return new Set(rows.map((r) => `${r.user_id}|${r.event_date}|${r.kind}`));
}

// ---------------------------------------------------------------- shapka sozlamalari

let settingsCache: { at: number; value: LetterSettings } | null = null;

export async function getLetterSettings(): Promise<LetterSettings> {
  if (settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.value;
  await ensureExplanationSchema();
  const { rows } = await pool.query(`SELECT header_lines, company_name FROM explanation_letter_settings WHERE id = 1`);
  const r = rows[0];
  const lines = Array.isArray(r?.header_lines) ? (r.header_lines as unknown[]).map((x) => String(x).trim()).filter(Boolean) : [];
  const value: LetterSettings = r
    ? { headerLines: lines.length ? lines : DEFAULT_LETTER_SETTINGS.headerLines, companyName: String(r.company_name || "").trim() || DEFAULT_LETTER_SETTINGS.companyName }
    : DEFAULT_LETTER_SETTINGS;
  settingsCache = { at: Date.now(), value };
  return value;
}

export async function saveLetterSettings(s: LetterSettings, byName: string): Promise<LetterSettings> {
  await ensureExplanationSchema();
  await pool.query(
    `INSERT INTO explanation_letter_settings (id, header_lines, company_name, updated_by_name, updated_at)
     VALUES (1, $1::jsonb, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET header_lines = EXCLUDED.header_lines, company_name = EXCLUDED.company_name,
       updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()`,
    [JSON.stringify(s.headerLines), s.companyName, byName],
  );
  settingsCache = null;
  return getLetterSettings();
}

/** 2-qadam: imzo — xat yakunlanadi va o‘zgarmaydi */
export async function signLetter(
  id: number,
  signaturePng: string,
  qrPng: string | null,
  meta: { ip: string | null; ua: string | null },
): Promise<ExplanationLetterRow | null> {
  const { rowCount } = await pool.query(
    `UPDATE explanation_letters
        SET status = 'signed', signature_png = $2, qr_png = COALESCE($3, qr_png),
            sign_ip = $4, sign_ua = $5, signed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'confirmed'`,
    [id, signaturePng, qrPng, meta.ip, meta.ua?.slice(0, 300) ?? null],
  );
  if (!rowCount) return null;
  return letterById(id);
}

// ---------------------------------------------------------------- matn

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const WEEKDAYS = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];

function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fmtDmy(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

function longDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}-yil ${d}-${MONTHS[m - 1]} (${wd})`;
}

function stampTashkent(isoText: string): string {
  const d = new Date(isoText);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}.${g("month")}.${g("year")} ${g("hour")}:${g("minute")}`;
}

function minutesText(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} soat ${m} daqiqaga`;
  if (h) return `${h} soatga`;
  return `${m} daqiqaga`;
}

export function penaltyText(n: number): string {
  if (n <= 1) return "rasmiy ogohlantirish";
  if (n <= 3) return "1 kunlik ish haqining 30% miqdorida jarima";
  if (n === 4) return "1 kunlik ish haqining 100% miqdorida jarima";
  if (n < FINAL_STRIKE) return "1 oylik ish haqining 50% miqdorida jarima hamda o‘sha kuni platformaga kirish cheklovi";
  return "1 oylik ish haqining 50% miqdorida jarima va oxirgi (yakuniy) ogohlantirish";
}

export type LetterStage = { n: number; label: string };

/** Xatdagi rangli bosqichlar jadvali — oylik sahifasi bilan bir xil */
export const LETTER_STAGES: LetterStage[] = [
  { n: 1, label: "Ogohlantirish" },
  { n: 2, label: "Kunlikning 30%" },
  { n: 3, label: "Kunlikning 30%" },
  { n: 4, label: "Kunlikning 100%" },
  { n: 5, label: "Oylikning 50% · blok" },
  { n: 6, label: "Oxirgi ogohlantirish" },
];

export function nextStepText(n: number): string {
  if (n <= 1) return "Keyingi (2-) holatda: 1 kunlik ish haqining 30% miqdorida jarima.";
  if (n === 2) return "Keyingi (3-) holatda: yana 1 kunlik ish haqining 30% miqdorida jarima.";
  if (n === 3) return "Keyingi (4-) holatda: 1 kunlik ish haqining 100% miqdorida jarima.";
  if (n === 4) return "Keyingi (5-) holatda: 1 oylik ish haqining 50% miqdorida jarima va o‘sha kuni platformaga kirish cheklovi.";
  if (n === 5)
    return "Keyingi (6-) holatda: yana 1 oylik ish haqining 50% jarima, oxirgi ogohlantirish va ishdan bo‘shatishga rozilik to‘g‘risidagi tushuntirish xati.";
  return "Bu oxirgi tushuntirish xati. Holat yana takrorlansa — mehnat shartnomasi bekor qilinadi (ishdan bo‘shatish).";
}

export function fmtSum(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/\u00a0/g, " ")} so‘m`;
}

function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const [last, ...rest] = parts;
  return `${last} ${rest.map((x) => `${x[0]!.toLocaleUpperCase("uz")}.`).join("")}`.trim();
}

function withDan(full: string): string {
  const name = full.trim();
  return name ? `${name}dan` : "";
}

export type LetterContent = {
  letterNo: string;
  kind: LetterKind;
  kindLabel: string;
  addressee: string[];
  sender: { position: string; fullName: string; fromLine: string; branch: string; phone: string };
  title: string;
  /** Sarlavha ostidagi qisqa satr: holat turi, sana, nechanchi marta */
  subtitle: string;
  /** 6-martadan — oxirgi ogohlantirish va ishdan bo‘shatishga rozilik */
  final: boolean;
  intro: string;
  facts: string;
  reason: string | null;
  commitment: string;
  /** Faqat oxirgi xatda — ishdan bo‘shatishga rozilik bandi */
  finalConsent: string | null;
  closing: string[];
  stages: LetterStage[];
  stage: number;
  nextStep: string;
  penalty: string;
  amountText: string | null;
  footer: { date: string; signer: string; signedAt: string | null };
  verifyUrl: string | null;
  status: LetterStatus;
};

export function reasonSentence(kind: LetterKind, code: string | null, text: string | null): string | null {
  if (!code) return null;
  const detail = String(text || "").trim().replace(/\s+/g, " ");
  const end = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
  if (code === MANUAL_REASON) return detail ? `Mazkur holat quyidagi sabab bilan yuz berdi: ${end(detail)}` : null;
  const r = REASONS[kind].find((x) => x.code === code) ?? REASONS[kind].find((x) => x.code === "other")!;
  return `Mazkur holat quyidagi sabab bilan yuz berdi: ${r.sentence}.${detail ? ` Batafsil: ${end(detail)}` : ""}`;
}

export function letterContent(
  l: ExplanationLetterRow,
  origin: string | null,
  settings: LetterSettings = DEFAULT_LETTER_SETTINGS,
): LetterContent {
  const position = l.position || "Farmasevt";
  const branch = l.branch || "—";
  const shift = l.shift || "belgilangan ish jadvali";
  const date = longDate(l.eventDate);
  const company = settings.companyName;
  const n = l.strikeN;
  const final = n >= FINAL_STRIKE;
  const amountText = l.amount > 0 ? fmtSum(l.amount) : null;
  const penalty = `${penaltyText(n)}${amountText ? ` (${amountText})` : ""}`;

  const intro =
    "Men mazkur tushuntirish xatini yozishdan oldin yolg‘on ma’lumot bermaslik va vaziyat (holat) haqida to‘g‘ri ma’lumot berish lozimligi haqida ogohlantirildim hamda faqat to‘g‘ri ma’lumot beraman.";

  const who = `Men, ${l.fullName}, ${company}ning ${branch} filialida ${position.toLocaleLowerCase("uz")} lavozimida faoliyat yuritaman.`;
  let facts: string;
  if (l.kind === "late") {
    const plan = l.planStart ? `soat ${l.planStart} da boshlanishi` : "belgilangan vaqtda boshlanishi";
    const came = l.checkIn
      ? `ishga soat ${l.checkIn} da keldim${l.lateMinutes ? `, ya’ni ${minutesText(l.lateMinutes)} kechikdim` : " va kechikdim"}`
      : "ishga belgilangan vaqtdan kech keldim";
    facts =
      `${who} ${date} kuni ${shift} bo‘yicha ish vaqtim ${plan} belgilangan bo‘lishiga qaramay, ${came}. ` +
      `Ushbu holat platformadagi davomat tizimida qayd etilgan hamda joriy oy davomidagi ${n}-qoidabuzarlik hisoblanadi.`;
  } else {
    const hours = l.planStart && l.planEnd ? ` (ish vaqti ${l.planStart}–${l.planEnd})` : "";
    facts =
      `${who} ${date} kuni ${shift} bo‘yicha${hours} ish kunim bo‘lishiga qaramay, ishga kelmadim. ` +
      `Ishga chiqa olmasligim haqida rahbariyatni oldindan rasmiy tarzda ogohlantirmadim va uzrli sababni tasdiqlovchi hujjat taqdim etmadim. ` +
      `Ushbu holat platformadagi davomat tizimida «Kelmadi» deb qayd etilgan hamda joriy oy davomidagi ${n}-qoidabuzarlik hisoblanadi.`;
  }

  const duty =
    l.kind === "late"
      ? "bundan buyon ichki mehnat tartibi qoidalariga qat’iy rioya qilishga, ish joyimga belgilangan vaqtdan kamida 10–15 daqiqa oldin yetib kelishga, kechikish ehtimoli tug‘ilganda esa bu haqda filial mudiri va hududiy koordinatorni oldindan xabardor qilishga majburiyat olaman."
      : "bundan buyon ish jadvalimga to‘liq amal qilishga, uzrli sabab bilan ishga chiqa olmaydigan bo‘lsam, bu haqda ish boshlanishidan oldin filial mudiri, hududiy koordinator va HR bo‘limini xabardor qilishga hamda tasdiqlovchi hujjatni o‘z vaqtida taqdim etishga majburiyat olaman.";

  const commitment = final
    ? `Ushbu tushuntirish xati joriy oy davomida ${n}-marta sodir etilgan qoidabuzarlik bo‘yicha OXIRGI tushuntirish xatim ekanligi, menga nisbatan oxirgi (yakuniy) ogohlantirish berilgani hamda 1 oylik ish haqimning 50% miqdorida${amountText ? ` — ${amountText}` : ""} jarima ushlab qolinishi bilan tanishdim. Shuningdek, ${duty}`
    : `Ushbu holat uchun belgilangan intizomiy chora — ${penalty} — bilan tanishdim. Shuningdek, ${duty}`;

  const finalConsent = final
    ? "Agar ushbu holat bundan keyin yana takrorlansa, bu men bilan tuzilgan mehnat shartnomasini bekor qilish (ishdan bo‘shatish) uchun asos bo‘lishini to‘liq tushunaman va bunga oldindan o‘z roziligimni bildiraman. Bu holatda hech qanday e’tiroz va da’vo bildirmayman."
    : null;

  return {
    letterNo: l.letterNo,
    kind: l.kind,
    kindLabel: l.kind === "late" ? "Ishga kechikish" : "Ishga kelmaslik",
    addressee: settings.headerLines,
    sender: {
      position,
      fullName: l.fullName,
      fromLine: withDan(l.fullName),
      branch: `${branch} filiali`,
      phone: l.phone || "",
    },
    title: "TUSHUNTIRISH XATI",
    subtitle: final
      ? `OXIRGI OGOHLANTIRISH · ishdan bo‘shatishga rozilik · ${n}-qoidabuzarlik`
      : `${l.kind === "late" ? "Ishga kechikish" : "Ishga kelmaslik"} · ${fmtDmy(l.eventDate)} · joriy oydagi ${n}-qoidabuzarlik`,
    final,
    intro,
    facts,
    reason: reasonSentence(l.kind, l.reasonCode, l.reasonText),
    commitment,
    finalConsent,
    closing: [
      final
        ? "Menga nisbatan kompaniyaning ichki tartib qoidalarida belgilangan jarimalar hamda rahbariyat tomonidan tayinlanadigan intizomiy jazolar qo‘llanilishiga roziman va e’tirozim yo‘q."
        : "Ushbu holat qayta takrorlansa, menga nisbatan quyidagi bosqichlarda ko‘rsatilgan jarimalar hamda rahbariyat tomonidan tayinlanadigan intizomiy jazo (hayfsan, jarima, mehnat shartnomasini bekor qilish) qo‘llanilishiga roziman va e’tirozim yo‘q.",
      "Ushbu tushuntirish xatini VAKSINA HR platformasida to‘liq o‘qib, mazmuni bilan tanishib chiqdim va rozilik bildirgan holda o‘z imzom bilan tasdiqlayman. Undagi barcha ma’lumotlar to‘g‘ri.",
    ],
    stages: LETTER_STAGES,
    stage: Math.min(n, FINAL_STRIKE),
    nextStep: nextStepText(n),
    penalty,
    amountText,
    footer: {
      date: stampTashkent(l.signedAt ?? new Date().toISOString()).slice(0, 10),
      signer: shortName(l.fullName),
      signedAt: l.signedAt ? stampTashkent(l.signedAt) : null,
    },
    verifyUrl: l.verifyToken && origin ? `${origin.replace(/\/$/, "")}/tx/${l.verifyToken}` : null,
    status: l.status,
  };
}

export function logLetterError(err: unknown, where: string) {
  logger.error({ err }, `Tushuntirish xati: ${where}`);
}
