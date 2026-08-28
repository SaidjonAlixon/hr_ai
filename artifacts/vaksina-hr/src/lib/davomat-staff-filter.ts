import type { DavomatEmployee } from "./davomat-api";
import { isPharmacyShiftRole, normalizeShiftType } from "./work-schedule";

export type DavomatStaffFilter = "all" | "shift_one" | "shift_two" | "office" | "external";

const PHARMACY_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor", "koordinator"]);
const PHARMACY_ORG_ROLES = new Set(["manager", "pharmacist", "intern", "coordinator", "supervisor"]);
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

const PHARMACY_POSITION_RE = /\b(mudir|farmasevt|stajyor|koordinator)\b/i;

function orgRoleFromUserRole(role?: string | null): string | null {
  if (role === "mudir") return "manager";
  if (role === "farmasevt") return "pharmacist";
  if (role === "stajyor") return "intern";
  if (role === "koordinator") return "coordinator";
  return null;
}

export function isPharmacyDavomatStaff(emp: {
  userRole?: string | null;
  orgRole?: string | null;
  position?: string | null;
}): boolean {
  if (PHARMACY_USER_ROLES.has(emp.userRole || "")) return true;
  if (PHARMACY_ORG_ROLES.has(emp.orgRole || "")) return true;
  const inferred = orgRoleFromUserRole(emp.userRole);
  if (inferred && PHARMACY_ORG_ROLES.has(inferred)) return true;
  return PHARMACY_POSITION_RE.test(emp.position || "");
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
  if (isPharmacyDavomatStaff(emp)) {
    return isShiftTwo(emp) ? "shift_two" : "shift_one";
  }
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
  const shiftTwo = isShiftTwo(emp);
  const pharmacy = isPharmacyDavomatStaff(emp);

  if (filter === "external") {
    return external || Boolean(farOfficeIds?.has(emp.id));
  }
  if (external) return false;

  if (filter === "shift_two") return shiftTwo;
  if (filter === "shift_one") return pharmacy && !shiftTwo;
  if (filter === "office") return !pharmacy;
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
  { key: "office", label: "Ofis", hint: "09:00 – 18:00", hours: "09:00–18:00" },
  {
    key: "external",
    label: "Tashqi xodimlar",
    hint: "Maydonda / masofadan",
    hours: "09:00–18:00",
  },
];
