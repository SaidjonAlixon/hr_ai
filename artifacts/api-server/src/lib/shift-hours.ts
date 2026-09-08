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
  /** Birlamchi smena (kelish nazorati) */
  shiftKey?: ShiftKey;
  /** Barcha smenalar — 1+2 bo‘lsa ["one","two"] */
  shiftKeys?: ShiftKey[];
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

function pharmacyKeys(
  shiftType?: string | null,
  shiftLabel?: string | null,
): ShiftKey[] {
  const keys = parseShiftKeys(shiftType, shiftLabel).filter((k) => k !== "office");
  if (keys.length) return keys;
  return [normalizeShiftKey(shiftType, shiftLabel)];
}

/**
 * Bitta yoki kombinatsiya smena oynasi.
 * 1+2 → ertalab 1-smena boshlanishi … 2-smena tugashi (08:00–23:45).
 * 2+3 → 2 boshlanishi … 3 tugashi (overnight).
 */
export function shiftWindow(
  shiftType?: string | null,
  shiftLabel?: string | null,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
): WorkSchedule {
  const raw = String(shiftType || "").trim().toLowerCase();
  if (raw === "office" || (!raw && String(shiftLabel || "").toLowerCase().includes("ofis"))) {
    return toWorkSchedule(defs.office);
  }
  const keys = pharmacyKeys(shiftType, shiftLabel);
  const first = defs[keys[0]] || defs.one;
  const last = defs[keys[keys.length - 1]] || first;
  if (keys.length === 1) return toWorkSchedule(first);

  const overnight = keys.some((k) => Boolean(defs[k]?.overnight)) || Boolean(last.overnight);
  const warnHm = warnHmBefore(first.startHm, first.graceMinutes);
  const short = keys
    .map((k) => (k === "one" ? "1" : k === "two" ? "2" : k === "three" ? "3" : k))
    .join("+");
  const range = overnight
    ? `${first.startHm}–${last.endHm} (keyingi kun)`
    : `${first.startHm}–${last.endHm}`;
  return {
    key: first.key,
    label: `${short}-smena`,
    start: first.startHm,
    end: last.endHm,
    graceMinutes: first.graceMinutes,
    overnight,
    warnHm,
    warnText: `${short}: kelish ${first.startHm}, ketish ${last.endHm}. ${first.graceMinutes} daqiqadan so‘ng kechikish. To‘liq ${range}.`,
  };
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

/** Smena tugagach Ketdim uchun 2 soatlik oyna */
export const CHECKOUT_GRACE_MS = 2 * 60 * 60 * 1000;

function addYmdDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** workDate + endHm → smena tugash vaqti (Toshkent) */
export function shiftEndAt(workDateYmd: string, endHm: string, overnight?: boolean): Date {
  const endDay = overnight ? addYmdDays(workDateYmd, 1) : workDateYmd;
  const hm = /^\d{1,2}:\d{2}$/.test(endHm) ? endHm : "18:00";
  return new Date(`${endDay}T${hm}:00+05:00`);
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
  const shiftKeys = isPharmacyShiftStaff(userRole, orgRole)
    ? pharmacyKeys(shiftType, shiftLabel)
    : (["office"] as ShiftKey[]);
  return {
    start: w.start,
    end: w.end,
    graceMinutes: w.graceMinutes,
    overnight: w.overnight,
    shiftKey: shiftKeys[0] || w.key,
    shiftKeys,
  };
}

/** Faqat birlamchi smena oynasi (combo bo‘lsa ham faqat birinchi) */
export function primaryHoursFromPlan(
  shiftType?: string | null,
  shiftLabel?: string | null,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
): StaffHours {
  const keys = pharmacyKeys(shiftType, shiftLabel);
  const key = keys[0] || normalizeShiftKey(shiftType, shiftLabel);
  const def = defs[key] || defs.one;
  const w = toWorkSchedule(def);
  return {
    start: w.start,
    end: w.end,
    graceMinutes: w.graceMinutes,
    overnight: w.overnight,
    shiftKey: w.key,
    shiftKeys: [w.key],
  };
}

/** Combo smena diapazon matni (UI/toast) */
export function shiftSpanNote(
  shiftType?: string | null,
  shiftLabel?: string | null,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
): string {
  const w = shiftWindow(shiftType, shiftLabel, defs);
  const keys = pharmacyKeys(shiftType, shiftLabel);
  if (keys.length <= 1) return `${w.start}–${w.end}`;
  return `kelish ${w.start} · ketish ${w.end}`;
}

/** Legacy named exports — default vaqtlar (admin override dan oldin) */
export const SHIFT_ONE = toWorkSchedule(DEFAULT_SHIFT_DEFS.one);
export const SHIFT_TWO = toWorkSchedule(DEFAULT_SHIFT_DEFS.two);
export const SHIFT_THREE = toWorkSchedule(DEFAULT_SHIFT_DEFS.three);
export const SHIFT_OFFICE = toWorkSchedule(DEFAULT_SHIFT_DEFS.office);
