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

export function isTexnikRole(_role?: string | null): boolean {
  return false;
}

/** Direktor bilan bir xil asosiy huquq (Asoschi ham shu yerda). */
export function isDirectorRole(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return r === "director" || r === "asoschi";
}

export function isAsoschiRole(role?: string | null): boolean {
  return (role ?? "").trim().toLowerCase() === "asoschi";
}

/** Maxfiy vazifa — faqat admin, asoschi, direktor, direktor yordamchisi */
export function canSetPrivateTaskVisibility(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return r === "admin" || isDirectorRole(r) || r === "direktor_yordamchisi";
}

/** Bosh admin — boshqa adminlarni ham butunlay o‘chira oladi; uni hech kim o‘chira olmaydi. */
export function isBoshAdmin(user?: { role?: string | null; login?: string | null } | null): boolean {
  if ((user?.role ?? "").trim().toLowerCase() !== "admin") return false;
  const logins = String(process.env.BOSH_ADMIN_LOGINS || "vaksina_admin")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return logins.includes((user?.login ?? "").trim().toLowerCase());
}

/** Admin, asoschi yoki korxona direktori. Foydalanuvchilar bo‘limi — faqat admin. */
export function hasFullPlatformAccess(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return r === "admin" || r === "asoschi" || r === "director";
}

export function isHrManager(role?: string | null): boolean {
  return isHrRole(role) || hasFullPlatformAccess(role);
}

/** Filial, mudir, farmasevt qo‘shish va o‘chirish — admin, direktor va HR menejer. */
export function canManagePharmacyOps(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return hasFullPlatformAccess(r) || r === "hr_menejer";
}

/** Sozlamalar: foydalanuvchilar, Face ID, kirish materiallari */
export function canManageSettings(role?: string | null): boolean {
  return hasFullPlatformAccess(role) || isDirectorRole(role);
}

/** Kirish materiallari va Preboarding — HR direktor ham to‘liq ochadi */
export function canManageOnboardingContent(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return canManageSettings(r) || r === "hr_direktor";
}

/** Xodim / foydalanuvchi HOLAT — faqat admin va direktor */
export function canChangeStaffStatus(role?: string | null): boolean {
  return hasFullPlatformAccess(role) || isDirectorRole(role);
}

/** Foydalanuvchilar bo‘limi — faqat admin */
export function canManageUsers(role?: string | null): boolean {
  return (role ?? "").trim().toLowerCase() === "admin";
}

/** Foydalanuvchini o‘chirish — faqat admin */
export function canDeleteUsers(role?: string | null): boolean {
  return canManageUsers(role);
}

/** Davomat qo‘lda tahrirlash (vaqt) — admin, direktor va HR direktor */
export function canEditDavomatManual(role?: string | null): boolean {
  return hasFullPlatformAccess(role) || isHrDirektor(role);
}

/** Davomatni bekor qilish (0) — admin va korxona direktori */
export function canResetDavomatManual(role?: string | null): boolean {
  return hasFullPlatformAccess(role);
}

/** Davomatni sababli qilish (jarimasiz) — admin, direktor va HR menejer */
export function canMarkDavomatExcuse(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return hasFullPlatformAccess(r) || r === "hr_menejer";
}

/** Davomat xatoliklar — faqat admin va asoschi. Korxona direktori ko‘rmaydi. */
export function canViewDavomatXatoliklar(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return r === "admin" || r === "asoschi";
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
  "tamojni_rahbar",
  "moliya_rahbar",
  "taminot_rahbar",
  "rivojlantirish_rahbar",
  "mamuriy_rahbar",
  "gpp_rahbar",
  "ombor_rahbar",
  "oshpaz_rahbar",
  "marketing_rahbar",
] as const;

export function isDeptHeadRole(role?: string | null): boolean {
  return !!role && (DEPT_HEAD_ROLES as readonly string[]).includes(role);
}

/** Davomat Dashboard — to‘liq umumiy ma’lumot */
export function canViewFullDavomatDashboard(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return (
    hasFullPlatformAccess(r) ||
    isDirectorRole(r) ||
    r === "direktor_yordamchisi" ||
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

/**
 * Direktor, asoschi, rahbariyat (direktor yordamchisi), HR oilasi, admin.
 * Logistika / Omborxona ko‘rish / Ko‘chma / Qurilmalar / Hisobot.
 */
export function canViewLeadershipModules(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return (
    hasFullPlatformAccess(r) ||
    isDirectorRole(r) ||
    r === "direktor_yordamchisi" ||
    isHrRole(r)
  );
}

/** Davomat erta-ketish / qo‘lda izoh — rahbariyat, HR va SB */
export function canViewDavomatNotes(role?: string | null): boolean {
  return canViewLeadershipModules(role) || isSbRole(role);
}

/** Davomat: to‘liq dashboard rollari + SB + bo‘lim boshliqlari + koordinator (faqat o‘z dorixonasi) */
export function canViewDavomat(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return (
    canViewFullDavomatDashboard(r) ||
    isSbRole(r) ||
    isDeptHeadRole(r) ||
    r === "koordinator" ||
    r === "tamojni"
  );
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

/** Xodimlar menyusi: to‘liq yoki bo‘lim boshlig‘i. Oddiy xodim / mudir / farmasevt — yo‘q. */
export function canViewEmployees(role?: string | null): boolean {
  if (!role) return false;
  if (canViewEmployeesFull(role)) return true;
  if (role === "mudir" || role === "farmasevt" || role === "stajyor" || role === "koordinator") {
    return false;
  }
  if (role === "moliya") return false;
  return (
    role === "it_rahbar" ||
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
    role === "distrib_hr" ||
    role === "tamojni_rahbar" ||
    role === "tamojni"
  );
}

/**
 * Bo‘lim boshliqlari — o‘z bo‘limi (view-only tahrir).
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
  "tamojni_rahbar",
  "tamojni",
] as const;

export function isEmployeeDirectoryViewOnly(role?: string | null): boolean {
  if (!role) return false;
  if (role === "recruiter") return true;
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
  const r = (role ?? "").trim().toLowerCase();
  return (
    r === "admin" ||
    isDirectorRole(r) ||
    r === "hr_direktor" ||
    r === "hr_kadr_rahbar" ||
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

/** Tarmoq Holat (koordinator→stajyor + bo‘limlar) */
export function canViewHolat(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return (
    canViewLeadershipModules(r) ||
    r === "koordinator" ||
    r === "mudir"
  );
}

export function canViewHolatFull(role?: string | null): boolean {
  return canViewLeadershipModules(role);
}

/** Apteka filiali — mudir, farmasevt, stajyor */
export function isPharmacyBranchRole(role?: string | null): boolean {
  return role === "mudir" || role === "farmasevt" || role === "stajyor";
}

/** Filial reytingi (cheklist ball) — o‘z filiali */
export function canViewPharmacyReyting(role?: string | null): boolean {
  return isPharmacyBranchRole(role);
}

/** Bog‘lanish (filial telefon / telegram) — mudir, koordinator, admin/asoschi/direktor */
export function canAccessBoglanish(role?: string | null): boolean {
  return role === "mudir" || role === "koordinator" || hasFullPlatformAccess(role) || isDirectorRole(role);
}

/** VaksinaMed Logistika SSO — admin + rahbariyat + HR */
export function canViewLogistika(role?: string | null): boolean {
  return canViewLeadershipModules(role);
}

/** Qurilmalar + Ko‘chma — ko‘rish (admin + rahbariyat + HR) */
export function canViewKochmaAdmin(role?: string | null): boolean {
  return canViewLeadershipModules(role);
}

/** Qurilmalar + Ko‘chma — o‘zgartirish: admin va korxona direktori */
export function canManageKochmaAdmin(role?: string | null): boolean {
  return hasFullPlatformAccess(role);
}

export function canAccessKirish(role?: string | null): boolean {
  return role === "stajyor" || hasFullPlatformAccess(role);
}

/** Darsliklar kursi — o‘quvchi roli → yo‘nalish (stajyor / farmasevt / mudir) */
export function darslikTrackForRole(role?: string | null): "stajyor" | "farmasevt" | "mudir" | null {
  if (role === "stajyor" || role === "farmasevt" || role === "mudir") return role;
  return null;
}

/** Darslik joylash — admin, direktor va trener */
export function canManageDarsliklar(role?: string | null): boolean {
  return canManageSettings(role) || role === "trainer";
}

export const HR_ROLE_LABELS: Record<string, string> = {
  hr: "HR",
  hr_direktor: "HR Direktor",
  hr_auditor: "HR Auditor",
  hr_menejer: "HR Menejer",
  hr_kadr_rahbar: "HR kadr b/m",
};

/** Smena va filial rotatsiyasi boshqaruvi — faqat HR menejer va Admin */
export function canManageSmenaFilial(role?: string | null): boolean {
  const r = (role ?? "").trim().toLowerCase();
  return hasFullPlatformAccess(r) || isHrRole(r);
}

