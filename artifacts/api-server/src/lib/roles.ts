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

/** HR + admin — boshqaruv huquqi (ariza, nomzod, vakansiya va h.k.) */
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

/** Cheklist holati: admin, direktor, HR direktor */
export function canViewChecklistStatus(role?: string | null): boolean {
  return role === "admin" || role === "director" || role === "hr_direktor";
}

/** Kirish o‘quv bo‘limi — faqat stajyor (+ admin) */
export function canAccessKirish(role?: string | null): boolean {
  return role === "stajyor" || role === "admin";
}

export const HR_ROLE_LABELS: Record<string, string> = {
  hr: "HR",
  hr_direktor: "HR Direktor",
  hr_auditor: "HR Auditor",
  hr_menejer: "HR Menejer",
};
