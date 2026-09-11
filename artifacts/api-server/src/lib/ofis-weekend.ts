/**
 * Ofis xodimlari: shanba–yakshanba dam kuni.
 * Dorixona / smena xodimlariga tegmaydi.
 */

const SHIFT_PHARMACY_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor"]);
const SHIFT_PHARMACY_ORG_ROLES = new Set([
  "manager",
  "pharmacist",
  "intern",
  "supervisor",
]);
const SHIFT_PHARMACY_POSITION_RE =
  /mudir|farmasevt|stajyor|stajor|filial\s*mudir|фармацевт|заведующ/i;

const NON_OFFICE_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor", "koordinator"]);
const NON_OFFICE_ORG_ROLES = new Set([
  "manager",
  "pharmacist",
  "intern",
  "coordinator",
  "supervisor",
]);
const NON_OFFICE_POSITION_RE =
  /mudir|farmasevt|stajyor|stajor|koordinator|filial\s*mudir|фармацевт|заведующ/i;

function orgRoleFromUserRole(role?: string | null): string | null {
  if (role === "mudir") return "manager";
  if (role === "farmasevt") return "pharmacist";
  if (role === "stajyor") return "intern";
  if (role === "koordinator") return "coordinator";
  return null;
}

/** Toshkent kalendar kuni — 0=Yak … 6=Shan */
export function weekdayFromYmd(ymd: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return -1;
  return new Date(`${ymd}T12:00:00+05:00`).getDay();
}

/** Shanba yoki yakshanba */
export function isWeekendYmd(ymd: string): boolean {
  const wd = weekdayFromYmd(ymd);
  return wd === 0 || wd === 6;
}

/** Ofis (dorixona/smena emas) */
export function isOfisStaffEmp(emp: {
  userRole?: string | null;
  orgRole?: string | null;
  position?: string | null;
}): boolean {
  const userRole = emp.userRole || "";
  const orgRole = emp.orgRole || "";
  const position = emp.position || "";
  if (userRole === "admin" || /^admin$/i.test(position.trim())) return false;

  if (SHIFT_PHARMACY_USER_ROLES.has(userRole)) return false;
  if (SHIFT_PHARMACY_ORG_ROLES.has(orgRole)) return false;
  const inferred = orgRoleFromUserRole(userRole);
  if (inferred && SHIFT_PHARMACY_ORG_ROLES.has(inferred)) return false;
  if (SHIFT_PHARMACY_POSITION_RE.test(position)) return false;

  if (NON_OFFICE_USER_ROLES.has(userRole)) return false;
  if (NON_OFFICE_ORG_ROLES.has(orgRole)) return false;
  if (inferred && NON_OFFICE_ORG_ROLES.has(inferred)) return false;
  if (NON_OFFICE_POSITION_RE.test(position)) return false;

  return true;
}

/** Ofis + shanba/yakshanba → dam kuni */
export function isOfisRestDay(
  ymd: string,
  emp: {
    userRole?: string | null;
    orgRole?: string | null;
    position?: string | null;
  },
): boolean {
  return isOfisStaffEmp(emp) && isWeekendYmd(ymd);
}
