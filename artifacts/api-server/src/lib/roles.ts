/** HR oilasi — barcha HR ichki rollari (eski `hr` = menejer bilan bir xil huquq). */
export const HR_ROLES = ["hr", "hr_direktor", "hr_auditor", "hr_menejer", "hr_kadr_rahbar"] as const;

export type HrRole = (typeof HR_ROLES)[number];

export function isHrRole(role?: string | null): boolean {
  return !!role && (HR_ROLES as readonly string[]).includes(role);
}

/** HR direktor yoki auditor — Kuzatuv bo‘limi */
export function isHrOversight(role?: string | null): boolean {
  return role === "hr_direktor" || role === "hr_auditor";
}

export function isHrDirektor(role?: string | null): boolean {
  return role === "hr_direktor";
}

export function isHrKadrRahbar(role?: string | null): boolean {
  return role === "hr_kadr_rahbar";
}

/** To‘liq HR boshqaruv menyusi (direktor, auditor, kadr b/m). */
export function hasHrOversightNav(role?: string | null): boolean {
  return isHrOversight(role) || isHrKadrRahbar(role);
}

/** Xavfsizlik (SB) — operator va bo‘lim boshlig‘i */
export const SB_ROLES = ["sb", "sb_boshliq"] as const;

export function isSbRole(role?: string | null): boolean {
  return role === "sb" || role === "sb_boshliq";
}

export const REVIZIYA_ROLES = ["revizor", "reviziya_rahbar"] as const;

export function isReviziyaRole(role?: string | null): boolean {
  return role === "revizor" || role === "reviziya_rahbar";
}

export const IT_ROLES = ["it", "it_rahbar", "it_dasturchi", "it_tarmoq"] as const;

export function isItRole(role?: string | null): boolean {
  return !!role && (IT_ROLES as readonly string[]).includes(role);
}

export function isTexnikRole(role?: string | null): boolean {
  return role === "texnik" || role === "texnik_rahbar";
}

export function isHrManager(role?: string | null): boolean {
  return isHrRole(role) || role === "admin";
}

export function canManageSettings(role?: string | null): boolean {
  return role === "admin" || role === "director";
}

/** Xodim / foydalanuvchi HOLAT — faqat admin va direktor */
export function canChangeStaffStatus(role?: string | null): boolean {
  return role === "admin" || role === "director";
}

/** Foydalanuvchini o‘chirish — faqat admin */
export function canDeleteUsers(role?: string | null): boolean {
  return role === "admin";
}

/** Davomat: direktor, HR direktor, HR menejer (+ admin) */
export function canViewDavomat(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    role === "hr_direktor" ||
    role === "hr_kadr_rahbar" ||
    role === "hr_menejer" ||
    role === "hr" ||
    isSbRole(role) ||
    role === "moliya"
  );
}

/** Xodimlar — to‘liq (barcha ofis bo‘limlari): admin, direktor, HR, SB */
export function canViewEmployeesFull(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    isHrRole(role) ||
    isSbRole(role)
  );
}

/** Xodimlar menyusi: to‘liq yoki bo‘lim boshlig‘i. Oddiy xodim / mudir / farmasevt — yo‘q. */
export function canViewEmployees(role?: string | null): boolean {
  if (!role) return false;
  if (canViewEmployeesFull(role)) return true;
  if (role === "mudir" || role === "farmasevt" || role === "stajyor" || role === "koordinator") {
    return false;
  }
  if (role === "mentor" || role === "recruiter" || role === "moliya") return false;
  return (
    role === "department_head" ||
    role === "it_rahbar" ||
    role === "texnik_rahbar" ||
    role === "reviziya_rahbar" ||
    role === "moliya_rahbar" ||
    role === "taminot_rahbar" ||
    role === "rivojlantirish_rahbar" ||
    role === "mamuriy_rahbar" ||
    role === "gpp_rahbar" ||
    role === "ombor_rahbar" ||
    role === "oshpaz_rahbar" ||
    role === "marketing_rahbar" ||
    role === "distrib_rahbar" ||
    role === "distrib_hr"
  );
}

/**
 * Bo‘lim boshliqlari — o‘z bo‘limi (view-only tahrir).
 */
export const EMPLOYEE_VIEW_ONLY_ROLES = [
  "department_head",
  "it_rahbar",
  "texnik_rahbar",
  "reviziya_rahbar",
  "moliya_rahbar",
  "taminot_rahbar",
  "rivojlantirish_rahbar",
  "mamuriy_rahbar",
  "gpp_rahbar",
  "ombor_rahbar",
  "oshpaz_rahbar",
  "marketing_rahbar",
  "distrib_rahbar",
  "distrib_hr",
] as const;

export function isEmployeeDirectoryViewOnly(role?: string | null): boolean {
  if (!role) return false;
  if (canViewEmployeesFull(role)) return false;
  return (EMPLOYEE_VIEW_ONLY_ROLES as readonly string[]).includes(role);
}

/** Dublikatlar — faqat admin va HR */
export function canViewEmployeeDuplicates(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "hr" ||
    role === "hr_direktor" ||
    role === "hr_kadr_rahbar" ||
    role === "hr_menejer" ||
    role === "hr_auditor"
  );
}

/** Cheklist holati (dashboard, tashriflar, qamrov): admin, direktor, HR, rekruter, auditor */
export function canViewChecklistStatus(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    role === "hr_direktor" ||
    role === "hr_kadr_rahbar" ||
    role === "hr_menejer" ||
    role === "hr" ||
    role === "hr_auditor" ||
    role === "recruiter" ||
    role === "moliya"
  );
}

/** Koordinatorlar reytingi — HR + koordinatorlar (faqat reyting) */
export function canViewCoordinatorRanking(role?: string | null): boolean {
  return canViewChecklistStatus(role) || role === "koordinator";
}

/** Excel eksport — barcha tashriflar: admin, direktor, HR rahbariyat, auditor, rekruter */
export function canExportChecklistStatus(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    role === "hr_direktor" ||
    role === "hr_menejer" ||
    role === "hr" ||
    role === "hr_auditor" ||
    role === "hr_kadr_rahbar" ||
    role === "recruiter"
  );
}

/** Ish o‘rni muddatini cho‘zish — HR menejer, HR direktor, direktor */
export function canExtendVacancy(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    role === "hr_direktor" ||
    role === "hr_menejer" ||
    role === "hr"
  );
}

/** Tarmoq Holat (koordinator→stajyor + bo‘limlar) */
export function canViewHolat(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    isHrRole(role) ||
    role === "koordinator" ||
    role === "mudir"
  );
}

export function canViewHolatFull(role?: string | null): boolean {
  return role === "admin" || role === "director" || isHrRole(role);
}

/** Apteka filiali — mudir, farmasevt, stajyor */
export function isPharmacyBranchRole(role?: string | null): boolean {
  return role === "mudir" || role === "farmasevt" || role === "stajyor";
}

/** Filial reytingi (cheklist ball) — o‘z filiali */
export function canViewPharmacyReyting(role?: string | null): boolean {
  return isPharmacyBranchRole(role);
}
export function canAccessKirish(role?: string | null): boolean {
  return role === "stajyor" || role === "admin";
}

export const HR_ROLE_LABELS: Record<string, string> = {
  hr: "HR",
  hr_direktor: "HR Direktor",
  hr_auditor: "HR Auditor",
  hr_menejer: "HR Menejer",
  hr_kadr_rahbar: "HR kadr b/m",
};
