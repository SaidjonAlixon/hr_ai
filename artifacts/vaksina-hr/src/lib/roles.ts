/** HR oilasi — barcha HR ichki rollari (eski `hr` = menejer bilan bir xil huquq). */
export const HR_ROLES = ["hr", "hr_direktor", "hr_auditor", "hr_menejer"] as const;

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

/** Xavfsizlik (SB) — operator va bo‘lim boshlig‘i */
export const SB_ROLES = ["sb", "sb_boshliq"] as const;

export function isSbRole(role?: string | null): boolean {
  return role === "sb" || role === "sb_boshliq";
}

export const REVIZIYA_ROLES = ["revizor", "reviziya_rahbar"] as const;

export function isReviziyaRole(role?: string | null): boolean {
  return role === "revizor" || role === "reviziya_rahbar";
}

export function isItRole(role?: string | null): boolean {
  return role === "it" || role === "it_rahbar";
}

export function isTexnikRole(role?: string | null): boolean {
  return role === "texnik" || role === "texnik_rahbar";
}

export function canViewReviziya(role?: string | null): boolean {
  return (
    isReviziyaRole(role) ||
    role === "admin" ||
    role === "director" ||
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

/** Davomat: direktor, HR direktor, HR menejer (+ admin) */
export function canViewDavomat(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    role === "hr_direktor" ||
    role === "hr_menejer" ||
    role === "hr" ||
    isSbRole(role) ||
    role === "moliya"
  );
}

/** Cheklist holati (dashboard, tashriflar, qamrov): admin, direktor, HR */
export function canViewChecklistStatus(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    role === "hr_direktor" ||
    role === "hr_menejer" ||
    role === "hr" ||
    role === "moliya"
  );
}

/** Koordinatorlar reytingi — HR + koordinatorlar (faqat reyting) */
export function canViewCoordinatorRanking(role?: string | null): boolean {
  return canViewChecklistStatus(role) || role === "koordinator";
}

/** Excel eksport — barcha tashriflar: admin, direktor, HR rahbariyat */
export function canExportChecklistStatus(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    role === "hr_direktor" ||
    role === "hr_menejer" ||
    role === "hr"
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

/** Ish o‘rinlari, nomzod, suhbat, pipeline, stajirovka — faqat HR oilasi + admin/direktor/rekruter/trener */
export const HR_RECRUITMENT_PATHS = [
  "/vacancies",
  "/candidates",
  "/interviews",
  "/pipeline",
  "/internships",
] as const;

export function canSeeHrRecruitment(role?: string | null): boolean {
  return (
    isHrRole(role) ||
    role === "admin" ||
    role === "director" ||
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
  it: "IT mutaxassisi",
  it_rahbar: "IT bo‘limi rahbari",
  ombor: "Ombor",
  sb: "SB operatori",
  sb_boshliq: "SB bo‘limi boshlig‘i",
  farmasevt: "Farmasevt",
  stajyor: "Stajyor",
  moliya: "Moliyachi",
  revizor: "Revizor-yig‘uvchi",
  reviziya_rahbar: "Reviziya bo‘limi rahbari",
};

export function userRoleLabel(role?: string | null): string {
  if (!role) return "";
  return USER_ROLE_LABELS[role] || role;
}
