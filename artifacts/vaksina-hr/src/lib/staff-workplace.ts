/** Xodimlar bo‘limidagi Ofis / Dorixona ajratish. Boshqa sahifalar shu qoidani ishlatadi. */

const PHARMACY_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor", "koordinator"]);
const PHARMACY_ORG_ROLES = new Set(["manager", "pharmacist", "intern", "supervisor", "coordinator"]);

function norm(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

export type StaffWorkplace = "ofis" | "dorixona";

export function isDorixonaStaffLike(input: {
  role?: string | null;
  orgRole?: string | null;
  position?: string | null;
  departmentName?: string | null;
}): boolean {
  const role = norm(input.role);
  const org = norm(input.orgRole);
  const pos = norm(input.position);
  const dept = norm(input.departmentName);
  if (PHARMACY_USER_ROLES.has(role)) return true;
  if (PHARMACY_ORG_ROLES.has(org)) return true;
  if (/filial\s*mudir|farmasevt|stajyor|stajor/.test(pos)) return true;
  if (/(farmasevt|dorixona|apteka)/.test(dept) && /(mudir|farmasevt|stajyor)/.test(`${pos} ${role}`)) return true;
  return false;
}

export function staffWorkplaceOf(input: {
  role?: string | null;
  orgRole?: string | null;
  position?: string | null;
  departmentName?: string | null;
}): StaffWorkplace {
  return isDorixonaStaffLike(input) ? "dorixona" : "ofis";
}
