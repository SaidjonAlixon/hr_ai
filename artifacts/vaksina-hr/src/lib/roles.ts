/** HR oilasi — barcha HR ichki rollari (eski `hr` = menejer bilan bir xil huquq). */
export const HR_ROLES = ["hr", "hr_direktor", "hr_auditor", "hr_menejer", "hr_kadr_rahbar"] as const;

export type HrRole = (typeof HR_ROLES)[number];

export function isHrRole(role?: string | null): boolean {
  return !!role && (HR_ROLES as readonly string[]).includes(role);
}

/** HR direktor yoki auditor — Kuzatuv bo‘limi */
export function normalizeUserRole(role?: string | null): string {
  return (role ?? "").trim().toLowerCase();
}

export function isHrOversight(role?: string | null): boolean {
  const r = normalizeUserRole(role);
  return r === "hr_direktor" || r === "hr_auditor";
}

export function isHrDirektor(role?: string | null): boolean {
  return normalizeUserRole(role) === "hr_direktor";
}

export function isHrKadrRahbar(role?: string | null): boolean {
  return normalizeUserRole(role) === "hr_kadr_rahbar";
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

export function isTexnikRole(_role?: string | null): boolean {
  return false;
}

/** AyTi / Texnik ops arizalari — zayavka (barcha rollar) */
export function canCreateOpsTicket(dept: "it" | "texnik", role?: string | null): boolean {
  if (!role) return false;
  return dept === "it";
}

/** Sahifani ochish: zayavka yozish / o‘z arizalarini ko‘rish */
export function canViewOpsDept(dept: "it" | "texnik", role?: string | null): boolean {
  return canCreateOpsTicket(dept, role);
}

/** AyTi ariza holati / qabul / bajarish — AyTi xodimi, admin, asoschi, direktor */
export function canManageOpsDept(dept: "it" | "texnik", role?: string | null): boolean {
  if (dept !== "it") return false;
  if (hasFullPlatformAccess(role) || isDirectorRole(role)) return true;
  return isItRole(role);
}

/** Barcha arizalar doskasi */
export function canViewAllOpsTickets(dept: "it" | "texnik", role?: string | null): boolean {
  return canManageOpsDept(dept, role);
}

export function canViewReviziya(role?: string | null): boolean {
  return (
    isReviziyaRole(role) ||
    hasHrOversightNav(role) ||
    hasFullPlatformAccess(role) ||
    isDirectorRole(role) ||
    role === "moliya" ||
    role === "sb" ||
    role === "sb_boshliq" ||
    role === "mudir"
  );
}

/** Direktor bilan bir xil asosiy huquq (Asoschi ham shu yerda). */
export function isDirectorRole(role?: string | null): boolean {
  const r = normalizeUserRole(role);
  return r === "director" || r === "asoschi";
}

export function isAsoschiRole(role?: string | null): boolean {
  return normalizeUserRole(role) === "asoschi";
}

/** Maxfiy vazifa — faqat admin, asoschi, direktor, direktor yordamchisi */
export function canSetPrivateTaskVisibility(role?: string | null): boolean {
  const r = normalizeUserRole(role);
  return r === "admin" || isDirectorRole(r) || r === "direktor_yordamchisi";
}

/**
 * Admin yoki Asoschi — platformadagi barcha imkoniyatlar (100%).
 * Oddiy «foydalanuvchi» emas: sozlamalar, HR, IT, o‘chirish va hokazo.
 */
export function hasFullPlatformAccess(role?: string | null): boolean {
  const r = normalizeUserRole(role);
  return r === "admin" || r === "asoschi";
}

export function isHrManager(role?: string | null): boolean {
  return isHrRole(role) || hasFullPlatformAccess(role);
}

/** Sozlamalar: foydalanuvchilar, Face ID, kirish materiallari */
export function canManageSettings(role?: string | null): boolean {
  return hasFullPlatformAccess(role) || isDirectorRole(role);
}

/** Xodim / foydalanuvchi HOLAT (status) — faqat admin va direktor */
export function canChangeStaffStatus(role?: string | null): boolean {
  return hasFullPlatformAccess(role) || isDirectorRole(role);
}

/** Foydalanuvchilar bo‘limi — faqat admin (asoschi/direktor ko‘rmaydi) */
export function canManageUsers(role?: string | null): boolean {
  return normalizeUserRole(role) === "admin";
}

/** Foydalanuvchini o‘chirish — faqat admin */
export function canDeleteUsers(role?: string | null): boolean {
  return canManageUsers(role);
}

/** Davomat Dashboard — to‘liq umumiy ma’lumot (filtr Ofis/Dorixona/Hammasi) */
export function canViewFullDavomatDashboard(role?: string | null): boolean {
  const r = normalizeUserRole(role);
  return (
    hasFullPlatformAccess(r) ||
    isDirectorRole(r) ||
    r === "moliya" ||
    r === "moliya_rahbar" ||
    r === "hr_direktor" ||
    r === "hr_menejer" ||
    r === "hr" ||
    r === "hr_kadr_rahbar" ||
    r === "hr_auditor" ||
    r === "recruiter"
  );
}

/** Davomat: direktor, HR direktor, HR menejer (+ admin) */
export function canViewDavomat(role?: string | null): boolean {
  return (
    canViewFullDavomatDashboard(role) ||
    hasHrOversightNav(role) ||
    isSbRole(role) ||
    isDeptHeadRole(role)
  );
}

/** Davomat qo‘lda tahrirlash (vaqt) — admin va HR direktor */
export function canEditDavomatManual(role?: string | null): boolean {
  const r = normalizeUserRole(role);
  return r === "admin" || r === "hr_direktor";
}

/** Davomatni bekor qilish (0) — faqat admin */
export function canResetDavomatManual(role?: string | null): boolean {
  return normalizeUserRole(role) === "admin";
}

/** Xodimlar — to‘liq (barcha ofis bo‘limlari): admin, direktor, HR, SB, rekruter */
export function canViewEmployeesFull(role?: string | null): boolean {
  return (
    role === "admin" ||
    isDirectorRole(role) ||
    isHrRole(role) ||
    isSbRole(role) ||
    role === "recruiter"
  );
}

/** Xodimlar menyusi: to‘liq yoki bo‘lim boshlig‘i (faqat o‘z bo‘limi). Oddiy xodim / mudir / farmasevt — yo‘q. */
export function canViewEmployees(role?: string | null): boolean {
  if (!role) return false;
  if (canViewEmployeesFull(role)) return true;
  if (role === "mudir" || role === "farmasevt" || role === "stajyor" || role === "koordinator") {
    return false;
  }
  if (role === "moliya") return false;
  if (isLimitedOfficeStaffRole(role)) return false;
  return isDeptHeadRole(role);
}

/**
 * Bo‘lim boshliqlari — o‘z bo‘limi xodimlarini ko‘radi,
 * lekin qo‘shish/tahrir/o‘chirish cheklangan (view-only).
 */
export const EMPLOYEE_VIEW_ONLY_ROLES = [
  "recruiter",
  "it_rahbar",
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
  if (role === "recruiter") return true;
  if (canViewEmployeesFull(role)) return false;
  return (EMPLOYEE_VIEW_ONLY_ROLES as readonly string[]).includes(role) || isDeptHeadRole(role);
}

/** Dublikatlar — admin, asoschi va HR */
export function canViewEmployeeDuplicates(role?: string | null): boolean {
  return (
    hasFullPlatformAccess(role) ||
    role === "hr" ||
    role === "hr_direktor" ||
    role === "hr_kadr_rahbar" ||
    role === "hr_menejer" ||
    role === "hr_auditor"
  );
}

export const DEPT_HEAD_ROLES = [
  "it_rahbar",
  "reviziya_rahbar",
  "sb_boshliq",
  "hr_direktor",
  "hr_kadr_rahbar",
  "hr_menejer",
  "distrib_rahbar",
  "distrib_hr",
  "moliya_rahbar",
  "taminot_rahbar",
  "rivojlantirish_rahbar",
  "mamuriy_rahbar",
  "gpp_rahbar",
  "ombor_rahbar",
  "oshpaz_rahbar",
  "marketing_rahbar",
] as const;

/** Ofis bo‘lim xodimlari — faqat Mening ishim + Davomat */
export const LIMITED_OFFICE_STAFF_ROLES = [
  "moliya_xodim",
  "taminot",
  "rivojlantirish",
  "mamuriy",
  "gpp",
  "ombor",
  "oshpaz",
  "marketing",
  "kassir",
  "yurist",
  "komunalniy",
  "direktor_yordamchisi",
] as const;

export function isLimitedOfficeStaffRole(role?: string | null): boolean {
  return !!role && (LIMITED_OFFICE_STAFF_ROLES as readonly string[]).includes(role);
}

export function isDistribyutsiyaRole(role?: string | null): boolean {
  return role === "distrib" || role === "distrib_hr" || role === "distrib_rahbar";
}

/** Distribyutsiya bo‘limi menyusi — faqat Distribyutsiya HR / rahbar */
export function canViewDistribyutsiya(role?: string | null): boolean {
  return role === "distrib_rahbar" || role === "distrib_hr";
}

export function canManageDistribyutsiya(role?: string | null): boolean {
  return canManageSettings(role) || role === "distrib_rahbar" || role === "distrib_hr";
}

export function isDeptHeadRole(role?: string | null): boolean {
  return !!role && (DEPT_HEAD_ROLES as readonly string[]).includes(role);
}

/** /dashboard da to‘liq yoki bo‘limga mos davomat analytics ko‘rsatish */
export function usesDavomatDashboardHome(role?: string | null): boolean {
  return canViewFullDavomatDashboard(role) || isDeptHeadRole(role);
}

export function canAddDeptStaff(role?: string | null): boolean {
  return isDeptHeadRole(role);
}

/** Cheklist holati (dashboard, tashriflar, qamrov): admin, direktor, HR, rekruter, auditor */
export function canViewChecklistStatus(role?: string | null): boolean {
  const r = normalizeUserRole(role);
  return (
    r === "admin" ||
    isDirectorRole(r) ||
    hasHrOversightNav(r) ||
    r === "hr_menejer" ||
    r === "hr" ||
    r === "hr_auditor" ||
    r === "recruiter" ||
    r === "moliya"
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
    isDirectorRole(role) ||
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
    isDirectorRole(role) ||
    role === "hr_direktor" ||
    role === "hr_menejer" ||
    role === "hr"
  );
}

/** Kirish o‘quv bo‘limi — faqat stajyor (+ admin/asoschi ko‘rishi mumkin) */
export function canAccessKirish(role?: string | null): boolean {
  return role === "stajyor" || hasFullPlatformAccess(role);
}

export function isStajyor(role?: string | null): boolean {
  return role === "stajyor";
}

/** Tarmoq Holat (koordinator→stajyor + bo‘limlar) */
export function canViewHolat(role?: string | null): boolean {
  return (
    role === "admin" ||
    isDirectorRole(role) ||
    isHrRole(role) ||
    role === "koordinator" ||
    role === "mudir"
  );
}

export function canViewHolatFull(role?: string | null): boolean {
  return role === "admin" || isDirectorRole(role) || isHrRole(role);
}

/** Apteka filiali — mudir, farmasevt, stajyor */
export function isPharmacyBranchRole(role?: string | null): boolean {
  return role === "mudir" || role === "farmasevt" || role === "stajyor";
}

/** Filial reytingi (cheklist ball) — o‘z filiali */
export function canViewPharmacyReyting(role?: string | null): boolean {
  return isPharmacyBranchRole(role);
}

/** Bog‘lanish (filial telefon / telegram) — mudir, koordinator, admin/asoschi */
export function canAccessBoglanish(role?: string | null): boolean {
  return role === "mudir" || role === "koordinator" || hasFullPlatformAccess(role) || isDirectorRole(role);
}

/** Ish o‘rinlari, nomzod, suhbat, stajirovka — faqat HR oilasi + admin/rekruter/trener */
export const HR_RECRUITMENT_PATHS = [
  "/vacancies",
  "/candidates",
  "/interviews",
  "/internships",
] as const;

export function canSeeHrRecruitment(role?: string | null): boolean {
  return (
    isHrRole(role) ||
    hasFullPlatformAccess(role) ||
    isDirectorRole(role) ||
    role === "recruiter" ||
    role === "trainer"
  );
}

export function isHrRecruitmentPath(pathname: string): boolean {
  return HR_RECRUITMENT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const HR_ROLE_LABELS: Record<string, string> = {
  hr: "HR",
  hr_direktor: "HR Direktor",
  hr_auditor: "HR Auditor",
  hr_menejer: "HR Menejer",
  hr_kadr_rahbar: "HR kadr b/m",
};

/** Foydalanuvchi rollari — Farmasevt va Stajyor alohida */
export const USER_ROLE_LABELS: Record<string, string> = {
  admin: "",
  ...HR_ROLE_LABELS,
  recruiter: "Rekruter",
  trainer: "Trener",
  director: "Direktor",
  asoschi: "Asoschi",
  mudir: "Mudir",
  koordinator: "Koordinator",
  it: "AyTi mutaxassisi",
  it_rahbar: "AyTi bo‘lim boshlig‘i",
  it_dasturchi: "Dasturchi",
  it_tarmoq: "Tarmoq administratori",
  ombor: "Omborxona xodimi",
  ombor_rahbar: "Omborxona bo‘lim boshlig‘i",
  sb: "SB operatori",
  sb_boshliq: "SB bo‘limi boshlig‘i",
  farmasevt: "Farmasevt",
  stajyor: "Stajyor",
  moliya: "Moliyachi",
  moliya_rahbar: "Moliya bo‘lim boshlig‘i",
  moliya_xodim: "Moliya xodimi",
  taminot_rahbar: "Ta’minot bo‘lim boshlig‘i",
  taminot: "Ta’minot xodimi",
  rivojlantirish_rahbar: "Rivojlantirish bo‘lim boshlig‘i",
  rivojlantirish: "Rivojlantirish xodimi",
  mamuriy_rahbar: "Ma’muriy-xo‘jalik bo‘lim boshlig‘i",
  mamuriy: "Ma’muriy-xo‘jalik xodimi",
  gpp_rahbar: "GPP bo‘lim boshlig‘i",
  gpp: "GPP xodimi",
  oshpaz_rahbar: "Oshpaz bo‘lim boshlig‘i",
  oshpaz: "Oshpaz",
  marketing_rahbar: "Marketing bo‘lim boshlig‘i",
  marketing: "Marketing xodimi",
  revizor: "Revizor-yig‘uvchi",
  reviziya_rahbar: "Reviziya bo‘limi rahbari",
  distrib: "Distribyutsiya xodimi",
  distrib_hr: "Distribyutsiya HR",
  distrib_rahbar: "Distribyutsiya rahbari",
  kassir: "Kassir",
  yurist: "Yurist",
  komunalniy: "Kommunal",
  direktor_yordamchisi: "Direktor yordamchisi",
};

export function userRoleLabel(role?: string | null): string {
  if (!role) return "";
  return USER_ROLE_LABELS[role] || role;
}
