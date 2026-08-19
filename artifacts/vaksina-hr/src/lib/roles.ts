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

/** HR + admin — boshqaruv huquqi */
export function isHrManager(role?: string | null): boolean {
  return isHrRole(role) || role === "admin";
}

/** Davomat: direktor, HR direktor, HR menejer (+ admin) */
export function canViewDavomat(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    role === "hr_direktor" ||
    role === "hr_menejer" ||
    role === "hr"
  );
}

/** Cheklist holati / reyting: admin, direktor, HR direktor, HR menejer, koordinator */
export function canViewChecklistStatus(role?: string | null): boolean {
  return (
    role === "admin" ||
    role === "director" ||
    role === "hr_direktor" ||
    role === "hr_menejer" ||
    role === "hr" ||
    role === "koordinator"
  );
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

/** Kirish o‘quv bo‘limi — faqat stajyor (+ admin ko‘rishi mumkin) */
export function canAccessKirish(role?: string | null): boolean {
  return role === "stajyor" || role === "admin";
}

export function isStajyor(role?: string | null): boolean {
  return role === "stajyor";
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
  ombor: "Ombor",
  farmasevt: "Farmasevt",
  stajyor: "Stajyor",
};

export function userRoleLabel(role?: string | null): string {
  if (!role) return "";
  return USER_ROLE_LABELS[role] || role;
}
