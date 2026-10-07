/**
 * Smenalar bo‘yicha ish / dam kunlari — oylik, jarima va davomat shu bitta manbadan o‘qiydi.
 *  1) work_calendar_rules — har smena uchun haftalik dam kunlari (qachondan amal qilishi bilan)
 *  2) work_calendar_days  — aniq sana bo‘yicha o‘zgartirish (bayram, qo‘shimcha ish kuni)
 *  3) shift_day_swaps     — almashuv: xodim dam oladi, o‘rniga boshqasi chiqadi
 * Qoida bo‘lmagan sana uchun eski tartib ishlaydi (oylik: yakshanba dam, davomat: ofis shanba–yakshanba).
 */
import { pool } from "@workspace/db";
import { isPharmacyStaffRow } from "./staff-directory";

export type RestRule = {
  id: number;
  scope: string;
  restWeekdays: number[];
  effectiveFrom: string;
  note: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
};

/** Sana → ish kuni (true) / dam (false) o‘zgartirishlari + shu smenaning haftalik qoidalari */
export class ScopeCalendar extends Map<string, boolean> {
  rules: RestRule[];
  constructor(rules: RestRule[] = []) {
    super();
    this.rules = [...rules].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  }
}

export type SwapPayTo = "replacement" | "self";

export type ShiftSwap = {
  id: number;
  workDate: string;
  employeeId: number;
  employeeName: string;
  replacementEmployeeId: number;
  replacementName: string;
  reason: string | null;
  payTo: SwapPayTo | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdByName: string | null;
  createdAt: string | null;
};

export const WEEKDAY_LABELS = ["", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];

const SCOPE_LABELS: Record<string, string> = {
  ofis: "Asosiy ofis",
  xavfsizlik: "Xavfsizlik",
  "dorixona:1": "1-smena",
  "dorixona:2": "2-smena",
  "dorixona:3": "3-smena",
  "dorixona:12": "1+2 smena",
  "dorixona:23": "2+3 smena",
  "dorixona:orta": "O‘rta smena",
  "dorixona:office": "Dorixona · ofis vaqti",
  "dorixona:other": "Boshqa smena",
};

/** Sozlamalar oynasida doim ko‘rinadigan smenalar (tartib bilan) */
export const MAIN_SCOPES = [
  "dorixona:1",
  "dorixona:2",
  "dorixona:3",
  "dorixona:12",
  "dorixona:23",
  "dorixona:orta",
  "ofis",
];

/** Birinchi ishga tushganda yoziladigan qoidalar: 1-smena yakshanba dam, ofis shanba–yakshanba, qolganlarga dam yo‘q */
const SEED_RULES: Array<[string, number[]]> = [
  ["ofis", [6, 7]],
  ["dorixona:1", [7]],
  ["dorixona:2", []],
  ["dorixona:3", []],
  ["dorixona:12", []],
  ["dorixona:23", []],
  ["dorixona:orta", []],
];

export function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] || scope.replace(/^dorixona:/, "");
}

export function todayTashkentYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

/** 1 = dushanba … 7 = yakshanba */
export function isoWeekday(ymd: string): number {
  const d = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function normalizeRestWeekdays(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort((a, b) => a - b);
}

export function ruleOn(rules: RestRule[], ymd: string): RestRule | null {
  let hit: RestRule | null = null;
  for (const rule of rules) {
    if (rule.effectiveFrom <= ymd) hit = rule;
    else break;
  }
  return hit;
}

/** Aniq javob: o‘zgartirish → haftalik qoida. Ikkalasi ham yo‘q bo‘lsa null (eski tartib). */
export function calendarWorkStatus(cal: Map<string, boolean> | null | undefined, ymd: string): boolean | null {
  if (!cal) return null;
  if (cal.has(ymd)) return cal.get(ymd)!;
  if (cal instanceof ScopeCalendar) {
    const rule = ruleOn(cal.rules, ymd);
    if (rule) return !rule.restWeekdays.includes(isoWeekday(ymd));
  }
  return null;
}

/* ───────── Smena → kalendar guruhi ───────── */

function norm(s: unknown) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[ʻʼ‘’'`´]/g, "'");
}

export function payrollShiftKey(shiftType?: string | null, shiftLabel?: string | null) {
  const compact = norm(shiftLabel).replace(/\s+/g, "");
  const t = norm(shiftType);
  if (t === "orta" || t === "middle" || /(^|[^a-z])o'?rta/.test(compact)) return "orta";
  const has1 = compact.includes("1-smena");
  const has2 = compact.includes("2-smena");
  const has3 = compact.includes("3-smena");
  if (t === "one+two" || t === "one_two" || t === "12" || compact.includes("1+2") || compact.includes("1-2") || (has1 && has2)) return "12";
  if (t === "two+three" || t === "two_three" || t === "23" || compact.includes("2+3") || compact.includes("2-3") || (has2 && has3)) return "23";
  if (t === "three" || t === "3" || has3 || compact === "3smena") return "3";
  if (t === "two" || t === "2" || has2 || compact === "2smena") return "2";
  if (t === "office" || compact.includes("ofis")) return "office";
  if (t === "one" || t === "1" || has1 || compact === "1smena" || !t) return "1";
  return "other";
}

export function payrollCalendarScope(input: {
  userRole?: string | null;
  orgRole?: string | null;
  position?: string | null;
  location?: string | null;
  shiftType?: string | null;
  shiftLabel?: string | null;
}) {
  const role = norm(input.userRole);
  const org = norm(input.orgRole);
  const pos = norm(input.position);
  if (role === "sb" || role === "sb_boshliq" || /xavfsiz/.test(role) || /xavfsiz/.test(pos)) {
    return "xavfsizlik";
  }
  if (isPharmacyStaffRow({ userRole: role, orgRole: org, position: pos })) {
    return `dorixona:${payrollShiftKey(input.shiftType, input.shiftLabel)}`;
  }
  return "ofis";
}

/** Ofis — oddiy ofis xodimlari bitta kalendar. Xavfsizlik alohida. Dorixona har smena alohida. */
export function isPayrollCalendarScope(scope: string) {
  return scope === "ofis" || scope === "xavfsizlik" || /^dorixona:[a-z0-9]{1,16}$/.test(scope);
}

export function calendarStorageKey(scope: string, iso: string) {
  if (scope === "ofis") return iso;
  return `${scope}|${iso}`;
}

export function parseCalendarStorageKey(raw: string): { scope: string; iso: string } | null {
  const scoped = /^([a-z0-9:_-]{1,40})\|(\d{4}-\d{2}-\d{2})$/.exec(raw);
  if (scoped && isPayrollCalendarScope(scoped[1]!)) return { scope: scoped[1]!, iso: scoped[2]! };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { scope: "ofis", iso: raw };
  return null;
}

/* ───────── Jadval ───────── */

let schemaReady: Promise<void> | null = null;

export function ensureWorkCalendarSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
CREATE TABLE IF NOT EXISTS work_calendar_days (
  day TEXT PRIMARY KEY,
  is_work BOOLEAN NOT NULL,
  updated_by_id INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS work_calendar_rules (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL,
  rest_weekdays INTEGER[] NOT NULL DEFAULT '{}',
  effective_from TEXT NOT NULL,
  note TEXT,
  updated_by_id INTEGER,
  updated_by_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS work_calendar_rules_scope_from_uidx ON work_calendar_rules (scope, effective_from);
CREATE TABLE IF NOT EXISTS shift_day_swaps (
  id SERIAL PRIMARY KEY,
  work_date TEXT NOT NULL,
  employee_id INTEGER NOT NULL,
  replacement_employee_id INTEGER NOT NULL,
  reason TEXT,
  pay_to TEXT,
  decided_by_id INTEGER,
  decided_by_name TEXT,
  decided_at TIMESTAMPTZ,
  assignment_id INTEGER,
  day_plan_id INTEGER,
  prev_plan_keys JSONB,
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS shift_day_swaps_emp_day_uidx ON shift_day_swaps (employee_id, work_date) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS shift_day_swaps_date_idx ON shift_day_swaps (work_date);
`);
      const today = todayTashkentYmd();
      for (const [scope, rest] of SEED_RULES) {
        const seeded = await pool.query(
          `INSERT INTO work_calendar_rules (scope, rest_weekdays, effective_from, note, updated_by_name)
           SELECT $1::text, $2::int[], $3::text, 'Boshlang‘ich qoida', 'Tizim'
            WHERE NOT EXISTS (SELECT 1 FROM work_calendar_rules WHERE scope = $1::text)
           ON CONFLICT DO NOTHING`,
          [scope, rest, today],
        );
        if (scope === "dorixona:orta" && seeded.rowCount) {
          await pool.query(
            `INSERT INTO work_calendar_days (day, is_work, updated_by_id, updated_at)
             SELECT 'dorixona:orta|' || substring(day from 16), is_work, updated_by_id, updated_at
               FROM work_calendar_days WHERE day LIKE 'dorixona:other|%'
             ON CONFLICT (day) DO NOTHING`,
          );
        }
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/* ───────── Xotiradagi nusxa (30 soniya) ───────── */

type Snapshot = {
  calendars: Map<string, ScopeCalendar>;
  restSwaps: Map<string, ShiftSwap>;
  workSwaps: Map<string, ShiftSwap>;
  swaps: ShiftSwap[];
  at: number;
};

const SNAPSHOT_TTL_MS = 30_000;
let snapshot: Snapshot = { calendars: new Map(), restSwaps: new Map(), workSwaps: new Map(), swaps: [], at: 0 };
let loading: Promise<Snapshot> | null = null;
let generation = 0;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

export function rowToRule(r: Record<string, unknown>): RestRule {
  return {
    id: Number(r.id),
    scope: String(r.scope),
    restWeekdays: normalizeRestWeekdays(r.rest_weekdays),
    effectiveFrom: String(r.effective_from),
    note: (r.note as string) || null,
    updatedByName: (r.updated_by_name as string) || null,
    updatedAt: iso(r.updated_at),
  };
}

export function rowToSwap(r: Record<string, unknown>): ShiftSwap {
  const payTo = r.pay_to === "replacement" || r.pay_to === "self" ? (r.pay_to as SwapPayTo) : null;
  return {
    id: Number(r.id),
    workDate: String(r.work_date),
    employeeId: Number(r.employee_id),
    employeeName: (r.employee_name as string) || `#${r.employee_id}`,
    replacementEmployeeId: Number(r.replacement_employee_id),
    replacementName: (r.replacement_name as string) || `#${r.replacement_employee_id}`,
    reason: (r.reason as string) || null,
    payTo,
    decidedByName: (r.decided_by_name as string) || null,
    decidedAt: iso(r.decided_at),
    createdByName: (r.created_by_name as string) || null,
    createdAt: iso(r.created_at),
  };
}

export const SWAP_SELECT = `
  SELECT s.*, a.full_name AS employee_name, b.full_name AS replacement_name
    FROM shift_day_swaps s
    LEFT JOIN employees a ON a.id = s.employee_id
    LEFT JOIN employees b ON b.id = s.replacement_employee_id`;

async function readSnapshot(): Promise<Snapshot> {
  await ensureWorkCalendarSchema();
  const [rules, days, swaps] = await Promise.all([
    pool.query(`SELECT * FROM work_calendar_rules ORDER BY scope, effective_from`),
    pool.query(`SELECT day, is_work FROM work_calendar_days`),
    pool.query(`${SWAP_SELECT} WHERE s.cancelled_at IS NULL ORDER BY s.work_date`),
  ]);
  const rulesByScope = new Map<string, RestRule[]>();
  for (const row of rules.rows) {
    const rule = rowToRule(row);
    rulesByScope.set(rule.scope, [...(rulesByScope.get(rule.scope) ?? []), rule]);
  }
  const calendars = new Map<string, ScopeCalendar>();
  for (const [scope, list] of rulesByScope) calendars.set(scope, new ScopeCalendar(list));
  for (const row of days.rows) {
    const parsed = parseCalendarStorageKey(String(row.day));
    if (!parsed) continue;
    let cal = calendars.get(parsed.scope);
    if (!cal) {
      cal = new ScopeCalendar();
      calendars.set(parsed.scope, cal);
    }
    cal.set(parsed.iso, Boolean(row.is_work));
  }
  const list = swaps.rows.map(rowToSwap);
  const restSwaps = new Map<string, ShiftSwap>();
  const workSwaps = new Map<string, ShiftSwap>();
  for (const swap of list) {
    restSwaps.set(`${swap.employeeId}|${swap.workDate}`, swap);
    workSwaps.set(`${swap.replacementEmployeeId}|${swap.workDate}`, swap);
  }
  return { calendars, restSwaps, workSwaps, swaps: list, at: Date.now() };
}

export async function loadWorkCalendar(force = false): Promise<Snapshot> {
  if (!force && snapshot.at && Date.now() - snapshot.at < SNAPSHOT_TTL_MS) return snapshot;
  if (loading) return loading;
  const startedAt = generation;
  loading = (async () => {
    try {
      const next = await readSnapshot();
      snapshot = startedAt === generation ? next : { ...next, at: 0 };
    } catch (err) {
      console.error("loadWorkCalendar", err);
    }
    return snapshot;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export function invalidateWorkCalendar() {
  generation += 1;
  snapshot = { ...snapshot, at: 0 };
}

export function scopeCalendar(calendars: Map<string, Map<string, boolean>>, scope: string): Map<string, boolean> {
  return calendars.get(scope) ?? new ScopeCalendar();
}

/* ───────── Davomat uchun sinxron savollar (avval loadWorkCalendar chaqiriladi) ───────── */

export function swapOn(employeeId: number | null | undefined, ymd: string): { kind: "rest" | "work"; swap: ShiftSwap } | null {
  if (!employeeId) return null;
  const rest = snapshot.restSwaps.get(`${employeeId}|${ymd}`);
  if (rest) return { kind: "rest", swap: rest };
  const work = snapshot.workSwaps.get(`${employeeId}|${ymd}`);
  if (work) return { kind: "work", swap: work };
  return null;
}

/** Smena kalendari bo‘yicha: { work, reason } yoki qoida yo‘q bo‘lsa null */
export function scopeDayStatus(scope: string, ymd: string): { work: boolean; reason: string } | null {
  const cal = snapshot.calendars.get(scope);
  if (!cal) return null;
  if (cal.has(ymd)) {
    const work = cal.get(ymd)!;
    return { work, reason: work ? "Kalendar bo‘yicha ish kuni" : "Kalendar bo‘yicha dam kuni" };
  }
  const rule = ruleOn(cal.rules, ymd);
  if (!rule) return null;
  const work = !rule.restWeekdays.includes(isoWeekday(ymd));
  return { work, reason: work ? "Ish kuni" : `Haftalik dam kuni · ${scopeLabel(scope)}` };
}

export function snapshotSwaps(): ShiftSwap[] {
  return snapshot.swaps;
}
