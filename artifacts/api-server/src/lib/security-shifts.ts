/**
 * Xavfsizlik (SB) — 24 soatlik smenalar, 09:00 → ertasi 09:00, 1 ish kuni hisoblanadi.
 * Ketdim: smena tugashidan +2 soat (ertasi 11:00) gacha.
 *
 * `employees.shift_type` kodlari:
 * - `sb:09:00-09:00:mon-sat`          — dushanba–shanba har kuni, yakshanba dam (SB boshlig‘i)
 * - `sb:09:00-09:00:alt:2026-09-28`   — kun ora: anchor sanasi ish kuni, ertasi dam (SB operatori)
 * - `sb:09:00-09:00:daily`            — har kuni, dam kunisiz
 */

export const SECURITY_USER_ROLES = new Set(["sb", "sb_boshliq"]);

export const SECURITY_DEFAULT_START = "09:00";
export const SECURITY_DEFAULT_END = "09:00";

export type SecurityPattern =
  | { kind: "mon-sat" }
  | { kind: "daily" }
  | { kind: "alt"; anchor: string };

export type SecurityShift = {
  start: string;
  end: string;
  pattern: SecurityPattern;
};

const SB_RE =
  /^sb:(\d{1,2}:\d{2})-(\d{1,2}:\d{2})(?::(mon-sat|daily|alt:(\d{4}-\d{2}-\d{2})))?$/i;

function padHm(hm: string): string {
  const [h, m] = hm.split(":");
  return `${String(Number(h)).padStart(2, "0")}:${m}`;
}

export function isSecurityShiftType(shiftType?: string | null): boolean {
  return /^sb:/i.test(String(shiftType || "").trim());
}

export function parseSecurityShift(shiftType?: string | null): SecurityShift | null {
  const m = SB_RE.exec(String(shiftType || "").trim());
  if (!m) return null;
  const mode = String(m[3] || "mon-sat").toLowerCase();
  const pattern: SecurityPattern =
    mode === "daily"
      ? { kind: "daily" }
      : mode.startsWith("alt:") && m[4]
        ? { kind: "alt", anchor: m[4] }
        : { kind: "mon-sat" };
  return { start: padHm(m[1]!), end: padHm(m[2]!), pattern };
}

export function encodeSecurityShiftType(opts: {
  start?: string;
  end?: string;
  pattern: SecurityPattern;
}): string {
  const start = padHm(opts.start || SECURITY_DEFAULT_START);
  const end = padHm(opts.end || SECURITY_DEFAULT_END);
  const p = opts.pattern;
  const tail = p.kind === "alt" ? `alt:${p.anchor}` : p.kind;
  return `sb:${start}-${end}:${tail}`;
}

/** Xavfsizlik xodimi: SB roli yoki `sb:` smena kodi */
export function isSecurityStaff(emp: {
  userRole?: string | null;
  shiftType?: string | null;
}): boolean {
  return SECURITY_USER_ROLES.has(String(emp.userRole || "").trim()) || isSecurityShiftType(emp.shiftType);
}

/** Kod bo‘lmasa ham SB xodimi — standart: 08:00–08:00, dushanba–shanba */
export function securityShiftFor(emp: {
  userRole?: string | null;
  shiftType?: string | null;
}): SecurityShift | null {
  const parsed = parseSecurityShift(emp.shiftType);
  if (parsed) return parsed;
  if (!SECURITY_USER_ROLES.has(String(emp.userRole || "").trim())) return null;
  return {
    start: SECURITY_DEFAULT_START,
    end: SECURITY_DEFAULT_END,
    pattern: { kind: "mon-sat" },
  };
}

function ymdToUtcDays(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

export function isSecurityRestDay(ymd: string, pattern: SecurityPattern): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  if (pattern.kind === "daily") return false;
  if (pattern.kind === "mon-sat") {
    return new Date(`${ymd}T12:00:00Z`).getUTCDay() === 0;
  }
  const diff = ymdToUtcDays(ymd) - ymdToUtcDays(pattern.anchor);
  return Math.abs(diff) % 2 === 1;
}

export function securityPatternLabel(pattern: SecurityPattern): string {
  if (pattern.kind === "alt") return "Kun ora";
  if (pattern.kind === "daily") return "Har kuni";
  return "Du–Sha, yakshanba dam";
}
