/** Apteka smenalari (Toshkent). Faqat mudir / farmasevt / stajyor. */

export const SHIFT_ONE = {
  key: "one" as const,
  label: "1-smena",
  start: "08:00",
  end: "17:00",
  warnHm: "07:45",
  warnText:
    "15 daqiqadan so‘ng 1-smena boshlanadi (08:00). Ishga kech qolayapsiz — bugun tizim ishga tushdi, davomatingiz platforma orqali qabul qilinadi.",
};

export const SHIFT_TWO = {
  key: "two" as const,
  label: "2-smena",
  start: "17:00",
  end: "23:45",
  warnHm: "16:45",
  warnText:
    "15 daqiqadan so‘ng 2-smena boshlanadi (17:00). Ishga kech qolayapsiz — bugun tizim ishga tushdi, davomatingiz platforma orqali qabul qilinadi.",
};

export const PHARMACY_SHIFT_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor"]);
export const PHARMACY_SHIFT_ORG_ROLES = new Set(["manager", "pharmacist", "intern"]);

export function normalizeShiftType(raw?: string | null, shiftLabel?: string | null): "one" | "two" {
  const s = (raw || "").trim().toLowerCase();
  if (s === "two" || s === "2") return "two";
  const lab = (shiftLabel || "").toLowerCase();
  if (lab.includes("2-smena") || lab.includes("2 smena")) return "two";
  return "one";
}

export function orgRoleFromUserRole(role?: string | null): string | null {
  if (role === "mudir") return "manager";
  if (role === "farmasevt") return "pharmacist";
  if (role === "stajyor") return "intern";
  if (role === "koordinator") return "coordinator";
  return null;
}

export function isPharmacyShiftStaff(userRole?: string | null, orgRole?: string | null): boolean {
  const org = orgRole || orgRoleFromUserRole(userRole);
  return PHARMACY_SHIFT_USER_ROLES.has(userRole || "") || PHARMACY_SHIFT_ORG_ROLES.has(org || "");
}

export const SHIFT_OFFICE = {
  key: "office" as const,
  label: "Ofis",
  start: "09:00",
  end: "18:00",
  warnHm: "08:45",
  warnText:
    "15 daqiqadan so‘ng ish vaqti boshlanadi (09:00). Ishga kech qolayapsiz — bugun tizim ishga tushdi, davomatingiz platforma orqali qabul qilinadi.",
};

export type WorkSchedule = {
  key: "one" | "two" | "office";
  label: string;
  start: string;
  end: string;
  warnHm: string;
  warnText: string;
};

export function workScheduleForStaff(
  userRole?: string | null,
  orgRole?: string | null,
  shiftType?: string | null,
  shiftLabel?: string | null,
): WorkSchedule {
  if (isPharmacyShiftStaff(userRole, orgRole)) {
    return shiftWindow(shiftType, shiftLabel);
  }
  return SHIFT_OFFICE;
}

export function shiftWindow(
  shiftType?: string | null,
  shiftLabel?: string | null,
): WorkSchedule & { key: "one" | "two" } {
  return normalizeShiftType(shiftType, shiftLabel) === "two" ? SHIFT_TWO : SHIFT_ONE;
}

export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Apteka smenasi yoki ofis 09:00–18:00 */
export function hoursForStaff(
  orgRole?: string | null,
  shiftType?: string | null,
  userRole?: string | null,
  shiftLabel?: string | null,
): { start: string; end: string } {
  const w = workScheduleForStaff(userRole, orgRole, shiftType, shiftLabel);
  return { start: w.start, end: w.end };
}
