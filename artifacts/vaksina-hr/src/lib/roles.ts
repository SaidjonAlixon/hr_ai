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

export function isTexnikRole(role?: string | null): boolean {
  return role === "texnik" || role === "texnik_rahbar";
}

export function canViewReviziya(role?: string | null): boolean {
  return (
    isReviziyaRole(role) ||
    hasHrOversightNav(role) ||
    role === "admin" ||
    role === "moliya" ||
    role === "sb" ||
    role === "sb_boshliq" ||
    role === "mudir"
  );
}

export function isHrManager(role?: string | null): boolean {
  return isHrRole(role) || role === "admin";
}

/** Sozlamalar: foydalanuvchilar, Face ID, kirish materiallari */
export function canManageSettings(role?: string | null): boolean {
  return role === "admin" || role === "director";
}

/** Xodim / foydalanuvchi HOLAT (status) — faqat admin va direktor */
export function canChangeStaffStatus(role?: string | null): boolean {
  return role === "admin" || role === "director";
}

/** Foydalanuvchini o‘chirish — faqat admin (direktor ham yo‘q) */
export function canDeleteUsers(role?: string | null): boolean {
  return role === "admin";
}

/** Davomat: direktor, HR direktor, HR menejer (+ admin) */
export function canViewDavomat(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    hasHrOversightNav(role) ||
    role === "hr_menejer" ||
    role === "hr" ||
    isSbRole(role) ||
    role === "moliya"
  );
}

/** Xodimlar ro‘yxati — HR, moliya, SB va rahbariyat */
export function canViewEmployees(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    isHrRole(role) ||
    isSbRole(role) ||
    role === "moliya" ||
    role === "recruiter" ||
    role === "department_head" ||
    role === "mentor" ||
    role === "mudir" ||
    role === "koordinator" ||
    role === "it_rahbar" ||
    role === "texnik_rahbar" ||
    role === "reviziya_rahbar" ||
    role === "sb_boshliq" ||
    role === "hr_direktor" ||
    role === "hr_menejer" ||
    role === "distrib_rahbar" ||
    role === "distrib_hr"
  );
}

/**
 * AyTi / bo‘lim boshliqlari / koordinator — to‘liq ro‘yxatni ko‘radi,
 * lekin qo‘shish, tahrir, o‘chirish va dublikatlar yo‘q.
 */
export const EMPLOYEE_VIEW_ONLY_ROLES = [
  "department_head",
  "it_rahbar",
  "texnik_rahbar",
  "reviziya_rahbar",
  "koordinator",
] as const;

export function isEmployeeDirectoryViewOnly(role?: string | null): boolean {
  return !!role && (EMPLOYEE_VIEW_ONLY_ROLES as readonly string[]).includes(role);
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

export const DEPT_HEAD_ROLES = [
  "department_head",
  "it_rahbar",
  "texnik_rahbar",
  "reviziya_rahbar",
  "sb_boshliq",
  "hr_direktor",
  "hr_kadr_rahbar",
  "hr_menejer",
  "distrib_rahbar",
  "distrib_hr",
] as const;

export function isDistribyutsiyaRole(role?: string | null): boolean {
  return role === "distrib" || role === "distrib_hr" || role === "distrib_rahbar";
}

export function canViewDistribyutsiya(role?: string | null): boolean {
  return (
    canManageSettings(role) ||
    isDistribyutsiyaRole(role) ||
    role === "hr" ||
    role === "hr_direktor" ||
    role === "hr_menejer" ||
    role === "hr_kadr_rahbar"
  );
}

export function canManageDistribyutsiya(role?: string | null): boolean {
  return canManageSettings(role) || role === "distrib_rahbar" || role === "distrib_hr";
}

export function isDeptHeadRole(role?: string | null): boolean {
  return !!role && (DEPT_HEAD_ROLES as readonly string[]).includes(role);
}

export function canAddDeptStaff(role?: string | null): boolean {
  return isDeptHeadRole(role);
}

/** Cheklist holati (dashboard, tashriflar, qamrov): admin, direktor, HR, rekruter, auditor */
export function canViewChecklistStatus(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    hasHrOversightNav(role) ||
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

/** Kirish o‘quv bo‘limi — faqat stajyor (+ admin ko‘rishi mumkin) */
export function canAccessKirish(role?: string | null): boolean {
  return role === "stajyor" || role === "admin";
}

export function isStajyor(role?: string | null): boolean {
  return role === "stajyor";
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
    role === "admin" ||
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
  admin: "Admin",
  ...HR_ROLE_LABELS,
  recruiter: "Rekruter",
  trainer: "Trener",
  mentor: "Mentor",
  director: "Direktor",
  department_head: "Bo‘lim boshlig‘i",
  mudir: "Mudir",
  koordinator: "Koordinator",
  texnik: "Texnik",
  texnik_rahbar: "Texnik bo‘limi rahbari",
  it: "AyTi mutaxassisi",
  it_rahbar: "AyTi bo‘lim boshlig‘i",
  it_dasturchi: "Dasturchi",
  it_tarmoq: "Tarmoq administratori",
  ombor: "Ombor",
  sb: "SB operatori",
  sb_boshliq: "SB bo‘limi boshlig‘i",
  farmasevt: "Farmasevt",
  stajyor: "Stajyor",
  moliya: "Moliyachi",
  revizor: "Revizor-yig‘uvchi",
  reviziya_rahbar: "Reviziya bo‘limi rahbari",
  distrib: "Distribyutsiya xodimi",
  distrib_hr: "Distribyutsiya HR",
  distrib_rahbar: "Distribyutsiya rahbari",
};

export function userRoleLabel(role?: string | null): string {
  if (!role) return "";
  return USER_ROLE_LABELS[role] || role;
}
