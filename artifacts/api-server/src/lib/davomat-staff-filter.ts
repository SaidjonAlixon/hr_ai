/**
 * Davomat xodimlar guruhi filtri (UI bilan bir xil).
 * Ofis / 1-smena / 2-smena — Excel eksportida ham shu qoida.
 */

export type DavomatStaffFilter = "all" | "shift_one" | "shift_two" | "office" | "external";

const SHIFT_PHARMACY_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor"]);
const SHIFT_PHARMACY_ORG_ROLES = new Set(["manager", "pharmacist", "intern", "supervisor"]);
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
  return SHIFT_PHARMACY_POSITION_RE.test(emp.position || "");
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

export function parseDavomatStaffFilter(raw?: string | null): DavomatStaffFilter {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "shift_one" || v === "shift_two" || v === "office" || v === "external" || v === "all") {
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
    workStart?: string;
    workEnd?: string;
  },
  filter: DavomatStaffFilter,
): boolean {
  if ((emp.userRole || "") === "admin" || /^admin$/i.test((emp.position || "").trim())) {
    return false;
  }
  if (filter === "all") return true;

  const shiftPharmacy = isShiftPharmacyStaff(emp);
  const shiftTwo = isShiftTwo(emp);
  const nonOffice = isNonOfficeStaff(emp);

  if (filter === "office" || filter === "external") {
    if (shiftPharmacy || nonOffice) return false;
    return true;
  }

  if (filter === "shift_two") return shiftPharmacy && shiftTwo;
  if (filter === "shift_one") return shiftPharmacy && !shiftTwo;
  return false;
}

export function staffFilterLabelUz(filter: DavomatStaffFilter): string {
  switch (filter) {
    case "shift_one":
      return "1-smena";
    case "shift_two":
      return "2-smena";
    case "office":
    case "external":
      return "Ofis";
    default:
      return "Hammasi";
  }
}
