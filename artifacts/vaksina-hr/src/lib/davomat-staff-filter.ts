import type { DavomatEmployee } from "./davomat-api";
import { normalizeShiftType } from "./work-schedule";

export type DavomatStaffFilter = "all" | "shift_one" | "shift_two" | "office" | "external";

/** Apteka smenalari — mudir, farmasevt, stajyor */
const SHIFT_PHARMACY_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor"]);
const SHIFT_PHARMACY_ORG_ROLES = new Set(["manager", "pharmacist", "intern"]);
const SHIFT_PHARMACY_POSITION_RE = /\b(mudir|farmasevt|stajyor)\b/i;

/** Ofisdan tashqari — faqat farmasevt, stajyor, koordinator */
const NON_OFFICE_USER_ROLES = new Set(["farmasevt", "stajyor", "koordinator"]);
const NON_OFFICE_ORG_ROLES = new Set(["pharmacist", "intern", "coordinator"]);
const NON_OFFICE_POSITION_RE = /\b(farmasevt|stajyor|koordinator)\b/i;

const EXTERNAL_USER_ROLES = new Set([
  "revizor",
  "reviziya_rahbar",
  "texnik",
  "texnik_rahbar",
  "sb",
  "sb_boshliq",
  "mentor",
  "recruiter",
  "trainer",
]);

function orgRoleFromUserRole(role?: string | null): string | null {
  if (role === "mudir") return "manager";
  if (role === "farmasevt") return "pharmacist";
  if (role === "stajyor") return "intern";
  if (role === "koordinator") return "coordinator";
  return null;
}

/** @deprecated isShiftPharmacyStaff yoki isNonOfficeStaff ishlating */
export function isPharmacyDavomatStaff(emp: {
  userRole?: string | null;
  orgRole?: string | null;
  position?: string | null;
}): boolean {
  return isShiftPharmacyStaff(emp);
}

export function isShiftPharmacyStaff(emp: {
  userRole?: string | null;
  orgRole?: string | null;
  position?: string | null;
}): boolean {
  if (SHIFT_PHARMACY_USER_ROLES.has(emp.userRole || "")) return true;
  if (SHIFT_PHARMACY_ORG_ROLES.has(emp.orgRole || "")) return true;
  const inferred = orgRoleFromUserRole(emp.userRole);
  if (inferred && SHIFT_PHARMACY_ORG_ROLES.has(inferred)) return true;
  return SHIFT_PHARMACY_POSITION_RE.test(emp.position || "");
}

export function isNonOfficeStaff(emp: {
  userRole?: string | null;
  orgRole?: string | null;
  position?: string | null;
}): boolean {
  if (NON_OFFICE_USER_ROLES.has(emp.userRole || "")) return true;
  if (NON_OFFICE_ORG_ROLES.has(emp.orgRole || "")) return true;
  const inferred = orgRoleFromUserRole(emp.userRole);
  if (inferred && NON_OFFICE_ORG_ROLES.has(inferred)) return true;
  return NON_OFFICE_POSITION_RE.test(emp.position || "");
}

function isShiftTwo(emp: {
  shiftType?: string | null;
  shiftLabel?: string | null;
  workStart?: string;
  workEnd?: string;
}): boolean {
  if (normalizeShiftType(emp.shiftType, emp.shiftLabel) === "two") return true;
  return (
    (emp.workStart === "17:00" || emp.workStart === "18:00") && emp.workEnd === "23:45"
  );
}

export function classifyDavomatStaff(emp: {
  userRole?: string | null;
  orgRole?: string | null;
  position?: string | null;
  shiftType?: string | null;
  shiftLabel?: string | null;
  workStart?: string;
  workEnd?: string;
}): Exclude<DavomatStaffFilter, "all"> {
  if (EXTERNAL_USER_ROLES.has(emp.userRole || "")) return "external";
  if (isShiftPharmacyStaff(emp)) {
    return isShiftTwo(emp) ? "shift_two" : "shift_one";
  }
  if (isNonOfficeStaff(emp)) return "shift_one";
  return "office";
}

export function staffFilterLabel(filter: DavomatStaffFilter): string {
  switch (filter) {
    case "shift_one":
      return "1-smena";
    case "shift_two":
      return "2-smena";
    case "office":
      return "Ofis";
    case "external":
      return "Tashqi xodimlar";
    default:
      return "Hammasi";
  }
}

/** Jadval va katak uchun qisqa smena nomi */
export function smenaLabelShort(emp: DavomatEmployee): string {
  if (EXTERNAL_USER_ROLES.has(emp.userRole || "")) return "Tashqi xodimlar";
  if (emp.userRole === "koordinator" || emp.orgRole === "coordinator") return "Koordinator";
  const kind = classifyDavomatStaff(emp);
  switch (kind) {
    case "shift_one":
      return "1-smena";
    case "shift_two":
      return "2-smena";
    case "office":
      return "Asosiy ofis";
    case "external":
      return "Tashqi xodimlar";
    default:
      return "Asosiy ofis";
  }
}

export function workHoursForStaffFilter(filter: DavomatStaffFilter): { start: string; end: string } {
  switch (filter) {
    case "shift_one":
      return { start: "08:00", end: "17:00" };
    case "shift_two":
      return { start: "17:00", end: "23:45" };
    case "office":
    case "external":
      return { start: "09:00", end: "18:00" };
    default:
      return { start: "09:00", end: "18:00" };
  }
}

export function workHoursForEmployee(emp: DavomatEmployee): { start: string; end: string } {
  if (emp.workStart && emp.workEnd) {
    return { start: emp.workStart, end: emp.workEnd };
  }
  return workHoursForStaffFilter(classifyDavomatStaff(emp));
}

export function matchesStaffFilter(
  emp: DavomatEmployee,
  filter: DavomatStaffFilter,
  farOfficeIds?: Set<number>,
): boolean {
  if (filter === "all") return true;

  const external = EXTERNAL_USER_ROLES.has(emp.userRole || "");
  const shiftPharmacy = isShiftPharmacyStaff(emp);
  const shiftTwo = isShiftTwo(emp);
  const nonOffice = isNonOfficeStaff(emp);

  if (filter === "external") {
    return external || Boolean(farOfficeIds?.has(emp.id));
  }

  if (filter === "shift_two") return shiftPharmacy && shiftTwo;
  if (filter === "shift_one") return shiftPharmacy && !shiftTwo;
  if (filter === "office") return !nonOffice;
  return false;
}

export const STAFF_FILTER_OPTIONS: Array<{
  key: DavomatStaffFilter;
  label: string;
  hint: string;
  hours: string;
}> = [
  { key: "all", label: "Hammasi", hint: "Barcha xodimlar", hours: "Turiga qarab" },
  { key: "shift_one", label: "1-smena", hint: "08:00 – 17:00", hours: "08:00–17:00" },
  { key: "shift_two", label: "2-smena", hint: "17:00 – 23:45", hours: "17:00–23:45" },
  {
    key: "office",
    label: "Ofis",
    hint: "09:00 – 18:00 (farmasevt/stajyor/koordinator dan tashqari)",
    hours: "09:00–18:00",
  },
  {
    key: "external",
    label: "Tashqi xodimlar",
    hint: "Maydonda / masofadan",
    hours: "09:00–18:00",
  },
];
