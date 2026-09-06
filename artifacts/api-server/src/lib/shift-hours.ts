/** Apteka smenalari (mudir/farmasevt/stajyor) + ofis belgilangan vaqt. */

import {
  DEFAULT_SHIFT_DEFS,
  SHIFT_DEFS,
  normalizeShiftKey,
  parseShiftKeys,
  encodeShiftKeys,
  validateShiftCombination,
  buildShiftDefs,
  type ShiftKey,
  type ShiftDefinition,
  type ShiftScheduleOverrides,
} from "./attendance-engine";
import { warnHmBefore } from "./shift-schedule";

export {
  DEFAULT_SHIFT_DEFS,
  SHIFT_DEFS,
  normalizeShiftKey,
  parseShiftKeys,
  encodeShiftKeys,
  validateShiftCombination,
  buildShiftDefs,
};
export type { ShiftKey, ShiftDefinition, ShiftScheduleOverrides };

export const PHARMACY_SHIFT_USER_ROLES = new Set(["mudir", "farmasevt", "stajyor"]);
export const PHARMACY_SHIFT_ORG_ROLES = new Set(["manager", "pharmacist", "intern"]);

/** @deprecated — use normalizeShiftKey; keeps old one|two API */
export function normalizeShiftType(raw?: string | null, shiftLabel?: string | null): "one" | "two" {
  const k = normalizeShiftKey(raw, shiftLabel);
  return k === "two" ? "two" : "one";
}

export function orgRoleFromUserRole(role?: string | null): string | null {
  if (role === "mudir") return "manager";
  if (role === "farmasevt") return "pharmacist";
  if (role === "stajyor") return "intern";
  if (role === "koordinator") return "coordinator";
  return null;
}

/** Smena faqat mudir / farmasevt / stajyor. Ofis xodimlarida smena yo‘q. */
export function isPharmacyShiftStaff(userRole?: string | null, orgRole?: string | null): boolean {
  const org = orgRole || orgRoleFromUserRole(userRole);
  return PHARMACY_SHIFT_USER_ROLES.has(userRole || "") || PHARMACY_SHIFT_ORG_ROLES.has(org || "");
}

export type WorkSchedule = {
  key: ShiftKey;
  label: string;
  start: string;
  end: string;
  graceMinutes: number;
  warnHm: string;
  warnText: string;
  overnight?: boolean;
};

export type StaffHours = {
  start: string;
  end: string;
  graceMinutes: number;
  overnight?: boolean;
  shiftKey?: ShiftKey;
};

function toWorkSchedule(def: ShiftDefinition): WorkSchedule {
  const warnHm = warnHmBefore(def.startHm, def.graceMinutes);
  const range = def.overnight
    ? `${def.startHm}–${def.endHm} (keyingi kun)`
    : `${def.startHm}–${def.endHm}`;
  return {
    key: def.key,
    label: def.label,
    start: def.startHm,
    end: def.endHm,
    graceMinutes: def.graceMinutes,
    overnight: def.overnight,
    warnHm,
    warnText: `Smena / ish vaqti ${range}. ${def.graceMinutes} daqiqadan so‘ng kechikish hisoblanadi.`,
  };
}

/** Sync — default yoki berilgan defs */
export function shiftWindow(
  shiftType?: string | null,
  shiftLabel?: string | null,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
): WorkSchedule {
  const key = normalizeShiftKey(shiftType, shiftLabel);
  return toWorkSchedule(defs[key] || defs.one);
}

export function workScheduleForStaff(
  userRole?: string | null,
  orgRole?: string | null,
  shiftType?: string | null,
  shiftLabel?: string | null,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
): WorkSchedule {
  if (isPharmacyShiftStaff(userRole, orgRole)) {
    return shiftWindow(shiftType, shiftLabel, defs);
  }
  return toWorkSchedule(defs.office);
}

export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToHm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function onTimeUntilHm(start: string, graceMinutes: number): string {
  return minutesToHm(hmToMinutes(start) + graceMinutes);
}

export function hoursForStaff(
  orgRole?: string | null,
  shiftType?: string | null,
  userRole?: string | null,
  shiftLabel?: string | null,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
): StaffHours {
  const w = workScheduleForStaff(userRole, orgRole, shiftType, shiftLabel, defs);
  return {
    start: w.start,
    end: w.end,
    graceMinutes: w.graceMinutes,
    overnight: w.overnight,
    shiftKey: w.key,
  };
}

export function primaryHoursFromPlan(
  shiftType?: string | null,
  shiftLabel?: string | null,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
): StaffHours {
  const keys = parseShiftKeys(shiftType, shiftLabel).filter((k) => k !== "office");
  const key = keys[0] || normalizeShiftKey(shiftType, shiftLabel);
  const w = shiftWindow(key, null, defs);
  return {
    start: w.start,
    end: w.end,
    graceMinutes: w.graceMinutes,
    overnight: w.overnight,
    shiftKey: w.key,
  };
}

/** Legacy named exports — default vaqtlar (admin override dan oldin) */
export const SHIFT_ONE = toWorkSchedule(DEFAULT_SHIFT_DEFS.one);
export const SHIFT_TWO = toWorkSchedule(DEFAULT_SHIFT_DEFS.two);
export const SHIFT_THREE = toWorkSchedule(DEFAULT_SHIFT_DEFS.three);
export const SHIFT_OFFICE = toWorkSchedule(DEFAULT_SHIFT_DEFS.office);
