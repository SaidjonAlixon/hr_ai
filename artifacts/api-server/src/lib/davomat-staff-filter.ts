/**
 * Davomat xodimlar guruhi filtri (UI bilan bir xil).
 * Ofis / 1-smena / 2-smena — Excel eksportida ham shu qoida.
 */
import { isSecurityStaff } from "./security-shifts";
import { parseShiftKeys } from "./attendance-engine";
import { isOrtaShift } from "./shift-hours";

export type DavomatStaffFilter =
  | "all"
  | "pharmacy"
  | "shift_one"
  | "shift_two"
  | "shift_three"
  | "shift_12"
  | "shift_23"
  | "shift_orta"
  | "office"
  | "office_core"
  | "warehouse"
  | "security"
  | "external";

/** Xavfsizlik: SB roli, `sb:` smena yoki «Xavfsizlik» bo‘limi */
export function isSecurityDavomatStaff(emp: {
  userRole?: string | null;
  departmentName?: string | null;
  shiftType?: string | null;
}): boolean {
  if (isSecurityStaff(emp)) return true;
  const d = normDeptName(emp.departmentName);
  return d === "xavfsizlik" || d === "хавфсизлик" || d === "безопасность";
}

const OMBOR_USER_ROLES = new Set(["ombor", "ombor_rahbar"]);

function normDeptName(s?: string | null): string {
  return String(s || "")
    .trim()
    .toLocaleLowerCase("uz")
    .replace(/[\u2018\u2019\u02BB\u02BC'`´]/g, "");
}

/** Omborxona: bo‘lim, ombor roli yoki `wh:` smena — ofis/apteka guruhlariga qo‘shilmaydi */
export function isWarehouseDavomatStaff(emp: {
  userRole?: string | null;
  departmentName?: string | null;
  shiftType?: string | null;
}): boolean {
  if (OMBOR_USER_ROLES.has(String(emp.userRole || "").trim())) return true;
  if (/^wh:/i.test(String(emp.shiftType || "").trim())) return true;
  const d = normDeptName(emp.departmentName);
  return d === "omborxona" || d === "омборхона" || d === "склад";
}

/** `wh:08:00-20:00:o` → `08:00-20:00`; smena biriktirilmagan bo‘lsa null */
export function warehouseShiftKeyOf(shiftType?: string | null): string | null {
  const m = /^wh:(\d{2}:\d{2})-(\d{2}:\d{2})/i.exec(String(shiftType || "").trim());
  return m ? `${m[1]}-${m[2]}` : null;
}

/** `none` = smena biriktirilmagan omborxona xodimlari */
export function parseWarehouseShiftFilter(raw?: string | null): string | null {
  const v = String(raw || "").trim();
  if (!v || v === "all") return null;
  if (v === "none") return "none";
  return /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(v) ? v : null;
}

export function matchesWarehouseShift(
  emp: { shiftType?: string | null },
  shiftFilter: string | null,
): boolean {
  if (!shiftFilter) return true;
  const key = warehouseShiftKeyOf(emp.shiftType);
  if (shiftFilter === "none") return key == null;
  return key === shiftFilter;
}

const SHIFT_PHARMACY_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor"]);
const SHIFT_PHARMACY_ORG_ROLES = new Set(["manager", "pharmacist", "intern", "supervisor"]);
/** Butun so‘z: «mudiri», «boshlig‘i» ofis lavozimi dorixona hisoblanmaydi */
function positionHasWord(position: string | null | undefined, words: string[]): boolean {
  const tokens = String(position || "")
    .toLowerCase()
    .replace(/[ʻʼ'`´]/g, "'")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const set = new Set(words);
  return tokens.some((w) => set.has(w));
}

const PHARMACY_POSITION_WORDS = ["mudir", "farmasevt", "stajyor", "stajor", "фармацевт", "заведующий", "заведующ"];

const NON_OFFICE_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor", "koordinator"]);
const NON_OFFICE_ORG_ROLES = new Set([
  "manager",
  "pharmacist",
  "intern",
  "coordinator",
  "supervisor",
]);
const NON_OFFICE_POSITION_WORDS = [...PHARMACY_POSITION_WORDS, "koordinator"];

const OFFICE_FIELD_USER_ROLES = new Set(["revizor", "reviziya_rahbar", "texnik", "texnik_rahbar"]);

function orgRoleFromUserRole(role?: string | null): string | null {
  if (role === "mudir") return "manager";
  if (role === "farmasevt") return "pharmacist";
  if (role === "stajyor") return "intern";
  if (role === "koordinator") return "coordinator";
  return null;
}

function normalizeShiftType(shiftType?: string | null, shiftLabel?: string | null): "one" | "two" | "custom" {
  const s = String(shiftType || "").toLowerCase().trim();
  if (s === "two" || s === "2" || s === "shift_two") return "two";
  if (s === "one" || s === "1" || s === "shift_one") return "one";
  if (/2|ikki|кеч/i.test(shiftLabel || "")) return "two";
  return "one";
}

function isOfficeFieldStaff(emp: { userRole?: string | null }): boolean {
  return OFFICE_FIELD_USER_ROLES.has(emp.userRole || "");
}

function isShiftPharmacyStaff(emp: {
  userRole?: string | null;
  orgRole?: string | null;
  position?: string | null;
}): boolean {
  if (SHIFT_PHARMACY_USER_ROLES.has(emp.userRole || "")) return true;
  if (SHIFT_PHARMACY_ORG_ROLES.has(emp.orgRole || "")) return true;
  const inferred = orgRoleFromUserRole(emp.userRole);
  if (inferred && SHIFT_PHARMACY_ORG_ROLES.has(inferred)) return true;
  return positionHasWord(emp.position, PHARMACY_POSITION_WORDS);
}

function isNonOfficeStaff(emp: {
  userRole?: string | null;
  orgRole?: string | null;
  position?: string | null;
}): boolean {
  if (NON_OFFICE_USER_ROLES.has(emp.userRole || "")) return true;
  if (NON_OFFICE_ORG_ROLES.has(emp.orgRole || "")) return true;
  const inferred = orgRoleFromUserRole(emp.userRole);
  if (inferred && NON_OFFICE_ORG_ROLES.has(inferred)) return true;
  return positionHasWord(emp.position, NON_OFFICE_POSITION_WORDS);
}

export type PharmacyShiftBucket = "shift_one" | "shift_two" | "shift_three" | "shift_12" | "shift_23" | "shift_orta";

/** UI dagi bilan bir xil: O‘rta, 2+3, 1+2, 3, 2, qolgani 1-smena — hech kim chetda qolmaydi */
export function pharmacyShiftBucket(emp: {
  shiftType?: string | null;
  shiftLabel?: string | null;
  workStart?: string;
  workEnd?: string;
}): PharmacyShiftBucket {
  if (isOrtaShift(emp.shiftType, emp.shiftLabel)) return "shift_orta";
  const keys = new Set(parseShiftKeys(emp.shiftType, emp.shiftLabel).filter((k) => k !== "office"));
  const label = String(emp.shiftLabel || "").toLowerCase().replace(/\s+/g, "");
  if (label.includes("2+3") || label.includes("2-3")) return "shift_23";
  if (label.includes("1+2") || label.includes("1-2")) return "shift_12";
  if (keys.has("two") && keys.has("three")) return "shift_23";
  if (keys.has("one") && keys.has("two")) return "shift_12";
  if (keys.size === 1 && keys.has("three")) return "shift_three";
  if (keys.size === 1 && keys.has("two")) return "shift_two";
  if (keys.size === 1 && keys.has("one")) return "shift_one";
  if (normalizeShiftType(emp.shiftType, emp.shiftLabel) === "two") return "shift_two";
  if ((emp.workStart === "17:00" || emp.workStart === "18:00") && emp.workEnd === "23:45") return "shift_two";
  return "shift_one";
}

function isShiftTwo(emp: {
  shiftType?: string | null;
  shiftLabel?: string | null;
  workStart?: string;
  workEnd?: string;
}): boolean {
  return pharmacyShiftBucket(emp) === "shift_two";
}

export function parseDavomatStaffFilter(raw?: string | null): DavomatStaffFilter {
  const v = String(raw || "").trim().toLowerCase();
  if (
    v === "pharmacy" ||
    v === "shift_one" ||
    v === "shift_two" ||
    v === "shift_three" ||
    v === "shift_12" ||
    v === "shift_23" ||
    v === "shift_orta" ||
    v === "office" ||
    v === "office_core" ||
    v === "warehouse" ||
    v === "security" ||
    v === "external" ||
    v === "all"
  ) {
    return v;
  }
  return "all";
}

export function matchesDavomatStaffFilter(
  emp: {
    userRole?: string | null;
    orgRole?: string | null;
    position?: string | null;
    shiftType?: string | null;
    shiftLabel?: string | null;
    departmentName?: string | null;
    workStart?: string;
    workEnd?: string;
  },
  filter: DavomatStaffFilter,
): boolean {
  if ((emp.userRole || "") === "admin" || /^admin$/i.test((emp.position || "").trim())) {
    return false;
  }
  if (filter === "all") return true;

  const security = isSecurityDavomatStaff(emp);
  const warehouse = isWarehouseDavomatStaff(emp) && !security;
  if (filter === "security") return security;
  if (filter === "warehouse") return warehouse;

  const shiftPharmacy = isShiftPharmacyStaff(emp);
  const shiftTwo = isShiftTwo(emp);
  const nonOffice = isNonOfficeStaff(emp);

  /** Ofis — ofis xodimlari, omborxona va xavfsizlik. Dorixona aralashmaydi. */
  if (filter === "office") {
    if (security || warehouse) return true;
    if (shiftPharmacy || nonOffice) return false;
    return true;
  }
  /** Faqat 09:00–18:00 ofis, ombor va xavfsizliksiz */
  if (filter === "office_core" || filter === "external") {
    if (security || isWarehouseDavomatStaff(emp)) return false;
    if (shiftPharmacy || nonOffice) return false;
    return true;
  }

  if (security || isWarehouseDavomatStaff(emp)) return false;

  if (filter === "pharmacy") return shiftPharmacy;
  if (filter === "shift_two") return shiftPharmacy && shiftTwo;
  return shiftPharmacy && pharmacyShiftBucket(emp) === filter;
}

export function staffFilterLabelUz(filter: DavomatStaffFilter): string {
  switch (filter) {
    case "pharmacy":
      return "Dorixona";
    case "shift_one":
      return "Dorixona · 1-smena";
    case "shift_two":
      return "Dorixona · 2-smena";
    case "shift_three":
      return "Dorixona · 3-smena";
    case "shift_12":
      return "Dorixona · 1+2 smena";
    case "shift_23":
      return "Dorixona · 2+3 smena";
    case "shift_orta":
      return "Dorixona · O‘rta smena";
    case "warehouse":
      return "Omborxona";
    case "security":
      return "Xavfsizlik";
    case "office":
      return "Ofis";
    case "office_core":
    case "external":
      return "Ofis · 09:00–18:00";
    default:
      return "Hammasi";
  }
}
