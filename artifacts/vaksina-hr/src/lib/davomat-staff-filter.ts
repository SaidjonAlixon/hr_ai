import type { DavomatEmployee } from "./davomat-api";
import { normalizeShiftType } from "./work-schedule";

/** Asosiy guruh: Hammasi | Dorixona | Ofis. Omborxona va xavfsizlik Ofis ichida. */
export type DavomatStaffFilter =
  | "all"
  | "pharmacy"
  | "shift_one"
  | "shift_two"
  | "office"
  | "warehouse"
  | "security"
  | "external";

const OMBOR_USER_ROLES = new Set(["ombor", "ombor_rahbar"]);
const SECURITY_USER_ROLES = new Set(["sb", "sb_boshliq"]);
const DISTRIB_USER_ROLES = new Set(["distrib", "distrib_hr", "distrib_rahbar"]);

/** Xavfsizlik (SB) — 09:00 dan ertasi 09:00 gacha, 1 ish kuni; Ketdim ertasi 11:00 gacha */
export const SECURITY_WORK_HOURS = { start: "09:00", end: "09:00" };

export function isSecurityStaff(emp: {
  security?: boolean;
  userRole?: string | null;
  departmentName?: string | null;
}): boolean {
  if (emp.security) return true;
  if (SECURITY_USER_ROLES.has(String(emp.userRole || "").trim())) return true;
  const d = normDeptName(emp.departmentName);
  return d === "xavfsizlik" || d === "хавфсизлик" || d === "безопасность";
}

function normDeptName(s?: string | null): string {
  return String(s || "")
    .trim()
    .toLocaleLowerCase("uz")
    .replace(/[\u2018\u2019\u02BB\u02BC'`´]/g, "");
}

/** Distribyutsiya — ofis doirasida, lekin «Ofis» chipiga kirmaydi */
export function isDistribStaff(emp: {
  userRole?: string | null;
  departmentName?: string | null;
  position?: string | null;
}): boolean {
  if (DISTRIB_USER_ROLES.has(String(emp.userRole || "").trim())) return true;
  const d = normDeptName(emp.departmentName);
  if (d === "distribyutsiya" || d === "дистрибуция" || d === "distribution") return true;
  return normDeptName(emp.position).includes("distribyutsiya");
}

/** Omborxona xodimi — backend `warehouse` belgisi, ombor roli, `wh:` smena yoki bo‘lim nomi */
export function isWarehouseStaff(emp: {
  warehouse?: boolean;
  userRole?: string | null;
  departmentName?: string | null;
  shiftType?: string | null;
}): boolean {
  if (emp.warehouse) return true;
  if (OMBOR_USER_ROLES.has(String(emp.userRole || "").trim())) return true;
  if (/^wh:/i.test(String(emp.shiftType || "").trim())) return true;
  const d = normDeptName(emp.departmentName);
  return d === "omborxona" || d === "омборхона" || d === "склад";
}

/** Omborxona smenasi tanlovi: "all" | "none" (biriktirilmagan) | "HH:MM-HH:MM" */
export type WarehouseShiftFilter = string;

export type WarehouseShiftOption = {
  key: string;
  label: string;
  hours: string;
  count: number;
};

export function matchesWarehouseShift(
  emp: { warehouseShiftKey?: string | null },
  filter: WarehouseShiftFilter,
): boolean {
  if (!filter || filter === "all") return true;
  if (filter === "none") return !emp.warehouseShiftKey;
  return emp.warehouseShiftKey === filter;
}

/** Hisobotdagi omborxona xodimlaridan smenalar ro‘yxati (vaqt bo‘yicha tartiblangan) */
export function warehouseShiftOptions(employees: DavomatEmployee[]): WarehouseShiftOption[] {
  const map = new Map<string, WarehouseShiftOption>();
  let unassigned = 0;
  for (const e of employees) {
    if (!isWarehouseStaff(e) || isSecurityStaff(e)) continue;
    const key = e.warehouseShiftKey;
    if (!key) {
      unassigned += 1;
      continue;
    }
    const hours = key.replace("-", "–");
    const cur = map.get(key);
    if (cur) {
      cur.count += 1;
      if (cur.label === hours && e.shiftLabel) cur.label = e.shiftLabel;
    } else {
      map.set(key, { key, label: e.shiftLabel?.trim() || hours, hours, count: 1 });
    }
  }
  const list = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  if (unassigned) {
    list.push({ key: "none", label: "Smena biriktirilmagan", hours: "", count: unassigned });
  }
  return list;
}

/** Apteka smenalari — mudir, farmasevt, stajyor */
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

/** Ofisdan tashqari — mudir, farmasevt, stajyor, koordinator (filialda ishlaydi) */
const NON_OFFICE_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor", "koordinator"]);
const NON_OFFICE_ORG_ROLES = new Set([
  "manager",
  "pharmacist",
  "intern",
  "coordinator",
  "supervisor",
]);
const NON_OFFICE_POSITION_WORDS = [...PHARMACY_POSITION_WORDS, "koordinator"];

/** Reviziya / texnik — endi Ofis filtriga kiradi */
const OFFICE_FIELD_USER_ROLES = new Set(["revizor", "reviziya_rahbar", "texnik", "texnik_rahbar"]);

function orgRoleFromUserRole(role?: string | null): string | null {
  if (role === "mudir") return "manager";
  if (role === "farmasevt") return "pharmacist";
  if (role === "stajyor") return "intern";
  if (role === "koordinator") return "coordinator";
  return null;
}

function isOfficeFieldStaff(emp: { userRole?: string | null }): boolean {
  return OFFICE_FIELD_USER_ROLES.has(emp.userRole || "");
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
  return positionHasWord(emp.position, PHARMACY_POSITION_WORDS);
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
  return positionHasWord(emp.position, NON_OFFICE_POSITION_WORDS);
}

type PharmacyShiftBucket = "shift_one" | "shift_two" | "shift_12" | "shift_23" | "shift_three";

function pharmacyKeySet(shiftType?: string | null, shiftLabel?: string | null): Set<"one" | "two" | "three"> {
  const keys = new Set<"one" | "two" | "three">();
  const parts = String(shiftType || "")
    .trim()
    .toLowerCase()
    .split(/[+|,/\s]+/)
    .filter(Boolean);
  for (const p of parts) {
    if (p === "one" || p === "1" || p === "shift_one") keys.add("one");
    else if (p === "two" || p === "2" || p === "shift_two") keys.add("two");
    else if (p === "three" || p === "3" || p === "shift_three") keys.add("three");
  }
  const lab = String(shiftLabel || "")
    .toLowerCase()
    .replace(/\s+/g, "");
  if (lab.includes("2+3") || lab.includes("2-3")) {
    keys.add("two");
    keys.add("three");
  } else if (lab.includes("1+2") || lab.includes("1-2")) {
    keys.add("one");
    keys.add("two");
  }
  return keys;
}

/** 1, 2, 3, 1+2 (08:00–23:45), 2+3 (17:00–07:00). Juftlik bitta smenaga yig‘ilmaydi. */
export function pharmacyShiftBucket(emp: {
  shiftType?: string | null;
  shiftLabel?: string | null;
  workStart?: string;
  workEnd?: string;
}): PharmacyShiftBucket {
  const keys = pharmacyKeySet(emp.shiftType, emp.shiftLabel);
  if (keys.has("two") && keys.has("three")) return "shift_23";
  if (keys.has("one") && keys.has("two")) return "shift_12";
  if (keys.size === 1 && keys.has("three")) return "shift_three";
  if (keys.size === 1 && keys.has("two")) return "shift_two";
  if (keys.size === 1 && keys.has("one")) return "shift_one";
  if (emp.workStart === "08:00" && emp.workEnd === "23:45") return "shift_12";
  if ((emp.workStart === "17:00" || emp.workStart === "18:00") && emp.workEnd === "07:00") return "shift_23";
  if (normalizeShiftType(emp.shiftType, emp.shiftLabel) === "two") return "shift_two";
  if (
    (emp.workStart === "17:00" || emp.workStart === "18:00") &&
    emp.workEnd === "23:45"
  ) {
    return "shift_two";
  }
  if (normalizeShiftType(emp.shiftType, emp.shiftLabel) === "three") return "shift_three";
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

export function classifyDavomatStaff(emp: {
  userRole?: string | null;
  orgRole?: string | null;
  position?: string | null;
  shiftType?: string | null;
  shiftLabel?: string | null;
  workStart?: string;
  workEnd?: string;
  warehouse?: boolean;
  security?: boolean;
  departmentName?: string | null;
}): Exclude<DavomatStaffFilter, "all" | "external"> {
  if (isSecurityStaff(emp)) return "security";
  if (isWarehouseStaff(emp)) return "warehouse";
  if (isOfficeFieldStaff(emp)) return "office";
  if (isShiftPharmacyStaff(emp)) {
    return isShiftTwo(emp) ? "shift_two" : "shift_one";
  }
  if (isNonOfficeStaff(emp)) return "shift_one";
  return "office";
}

export function staffFilterLabel(filter: DavomatStaffFilter): string {
  switch (filter) {
    case "pharmacy":
      return "Dorixona";
    case "shift_one":
      return "Dorixona · 1-smena";
    case "shift_two":
      return "Dorixona · 2-smena";
    case "warehouse":
      return "Omborxona";
    case "security":
      return "Xavfsizlik";
    case "office":
    case "external":
      return "Ofis";
    default:
      return "Hammasi";
  }
}

/** Jadval va katak uchun qisqa smena nomi */
export function smenaLabelShort(emp: DavomatEmployee): string {
  if (emp.userRole === "revizor" || emp.userRole === "reviziya_rahbar") return "Reviziya";
  if (emp.userRole === "texnik" || emp.userRole === "texnik_rahbar") return "Texnik";
  if (isDistribStaff(emp)) return "Distribyutsiya";
  if (emp.userRole === "koordinator" || emp.orgRole === "coordinator") return "Koordinator";
  if (emp.userRole === "mudir" || emp.orgRole === "manager" || /mudir/i.test(emp.position || ""))
    return "Filial mudiri";
  const kind = classifyDavomatStaff(emp);
  switch (kind) {
    case "shift_one":
    case "shift_two": {
      const bucket = pharmacyShiftBucket(emp);
      if (bucket === "shift_12") return "1+2";
      if (bucket === "shift_23") return "2+3";
      if (bucket === "shift_three") return "3-smena";
      return bucket === "shift_two" ? "2-smena" : "1-smena";
    }
    case "warehouse":
      return emp.shiftLabel?.trim() || (emp.warehouseShiftKey ? `Ombor ${emp.warehouseShiftKey}` : "Omborxona");
    case "security":
      return emp.shiftLabel?.trim() || "Xavfsizlik";
    case "office":
    default:
      return "Ofis";
  }
}

export function workHoursForStaffFilter(filter: DavomatStaffFilter): { start: string; end: string } {
  switch (filter) {
    case "shift_one":
      return { start: "08:00", end: "17:00" };
    case "shift_two":
      return { start: "17:00", end: "23:45" };
    case "security":
      return SECURITY_WORK_HOURS;
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
  _farOfficeIds?: Set<number>,
): boolean {
  // Admin faqat Foydalanuvchilar ro‘yxatida
  if ((emp.userRole || "") === "admin" || /^admin$/i.test((emp.position || "").trim())) {
    return false;
  }
  if (filter === "all") return true;

  const security = isSecurityStaff(emp);
  const warehouse = isWarehouseStaff(emp) && !security;
  if (filter === "security") return security;
  if (filter === "warehouse") return warehouse;

  const shiftPharmacy = isShiftPharmacyStaff(emp);
  const nonOffice = isNonOfficeStaff(emp);

  /**
   * Ofis — ofis, omborxona va xavfsizlik.
   * Dorixona (mudir, farmasevt, stajyor, koordinator) bu yerga kirmaydi.
   */
  if (filter === "office" || filter === "external") {
    if (security || isWarehouseStaff(emp)) return true;
    if (shiftPharmacy || nonOffice) return false;
    return true;
  }

  if (security || isWarehouseStaff(emp)) return false;

  if (filter === "pharmacy") return shiftPharmacy;
  if (filter === "shift_two") return shiftPharmacy && pharmacyShiftBucket(emp) === "shift_two";
  if (filter === "shift_one") return shiftPharmacy && pharmacyShiftBucket(emp) === "shift_one";
  return false;
}

/** Dorixona ichidagi smena. 1+2 va 2+3 alohida — to‘liq oyna bo‘yicha. */
export type PharmacyShiftFilter = "all" | "shift_one" | "shift_two" | "shift_12" | "shift_23";

export const PHARMACY_SHIFT_OPTIONS: Array<{
  key: Exclude<PharmacyShiftFilter, "all">;
  label: string;
  hours: string;
  start: string;
  end: string;
}> = [
  { key: "shift_one", label: "1-smena", hours: "08:00 – 17:00", start: "08:00", end: "17:00" },
  { key: "shift_two", label: "2-smena", hours: "17:00 – 23:45", start: "17:00", end: "23:45" },
  { key: "shift_12", label: "1+2", hours: "08:00 – 23:45", start: "08:00", end: "23:45" },
  { key: "shift_23", label: "2+3", hours: "17:00 – 07:00", start: "17:00", end: "07:00" },
];

export function matchesPharmacyShift(emp: DavomatEmployee, shift: PharmacyShiftFilter): boolean {
  if (shift === "all") return true;
  return pharmacyShiftBucket(emp) === shift;
}

/** Ofis ichidagi bo‘lim — bir-biriga aralashmaydi. Hammasi = ofis doirasi. */
export type OfficeInnerFilter = "all" | "desk" | "distrib" | "warehouse" | "security";

export const OFFICE_INNER_OPTIONS: Array<{
  key: OfficeInnerFilter;
  label: string;
  hint: string;
}> = [
  { key: "all", label: "Hammasi", hint: "Ofis doirasida" },
  { key: "desk", label: "Ofis", hint: "09:00 – 18:00" },
  { key: "distrib", label: "Distribyutsiya", hint: "Alohida bo‘lim" },
  { key: "warehouse", label: "Omborxona", hint: "Smenalar bo‘yicha" },
  { key: "security", label: "Xavfsizlik", hint: "09:00 – 09:00" },
];

export function matchesOfficeInner(
  emp: Parameters<typeof isSecurityStaff>[0] &
    Parameters<typeof isWarehouseStaff>[0] &
    Parameters<typeof isDistribStaff>[0],
  inner: OfficeInnerFilter,
): boolean {
  if (inner === "all") return true;
  const security = isSecurityStaff(emp);
  const distrib = isDistribStaff(emp) && !security;
  if (inner === "security") return security;
  if (inner === "distrib") return distrib;
  if (inner === "warehouse") return isWarehouseStaff(emp) && !security && !distrib;
  return !security && !distrib && !isWarehouseStaff(emp);
}

export const STAFF_FILTER_OPTIONS: Array<{
  key: "all" | "pharmacy" | "office";
  label: string;
  hint: string;
  hours: string;
}> = [
  { key: "all", label: "Hammasi", hint: "Barcha xodimlar", hours: "Turiga qarab" },
  { key: "pharmacy", label: "Dorixona", hint: "Smenalar bo‘yicha", hours: "Smenaga qarab" },
  { key: "office", label: "Ofis", hint: "09:00 – 18:00", hours: "09:00–18:00" },
];
