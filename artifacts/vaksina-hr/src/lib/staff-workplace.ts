/** Ofis / Dorixona segmenti — mas’ul tanlash filtri */

const DORIXONA_ORG = new Set([
  "manager",
  "pharmacist",
  "intern",
  "supervisor",
  "coordinator",
  "mudir",
  "farmasevt",
  "stajyor",
  "stajor",
  "koordinator",
]);

const DORIXONA_USER = new Set([
  "mudir",
  "farmasevt",
  "stajyor",
  "stajor",
  "koordinator",
]);

function norm(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[ʻʼ'`´]/g, "'")
    .replace(/\s+/g, " ");
}

export type StaffWorkplace = "ofis" | "dorixona";

export function isDorixonaStaffLike(input: {
  role?: string | null;
  orgRole?: string | null;
  position?: string | null;
  departmentName?: string | null;
  location?: string | null;
}): boolean {
  const org = norm(input.orgRole);
  const role = norm(input.role);
  const pos = norm(input.position);
  const dept = norm(input.departmentName);
  const loc = norm(input.location);

  if (org && DORIXONA_ORG.has(org)) return true;
  if (role && DORIXONA_USER.has(role)) return true;

  const hay = `${org} ${role} ${pos} ${dept}`;
  if (
    /\b(mudir|farmasevt|stajyor|stajor|koordinator|pharmacist|manager|intern|supervisor)\b/.test(
      hay,
    ) ||
    /filial\s*mudir/.test(pos) ||
    /фармацевт|заведующ/.test(hay)
  ) {
    return true;
  }
  if (dept && /(farmasevt|dorixona|apteka|фармацевт)/.test(dept)) return true;
  if (loc && (pos.includes("farmasevt") || pos.includes("mudir") || pos.includes("stajyor"))) {
    return true;
  }
  return false;
}

export function staffWorkplaceOf(input: {
  role?: string | null;
  orgRole?: string | null;
  position?: string | null;
  departmentName?: string | null;
  location?: string | null;
}): StaffWorkplace {
  return isDorixonaStaffLike(input) ? "dorixona" : "ofis";
}
