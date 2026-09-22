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
  /** Birlamchi + kombinatsiya kalitlari (masalan 1+2 → ["one","two"]) */
  keys?: ShiftKey[];
  label: string;
  start: string;
  end: string;
  graceMinutes: number;
  warnHm: string;
  warnText: string;
  overnight?: boolean;
  /** Omborxona smenasi — Ketdim = tugash + 2 soat */
  warehouse?: boolean;
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
  warehouse?: boolean;
};

function toWorkSchedule(def: ShiftDefinition): WorkSchedule {
  const warnHm = warnHmBefore(def.startHm, def.graceMinutes);
  const range = def.overnight
    ? `${def.startHm}–${def.endHm} (keyingi kun)`
    : `${def.startHm}–${def.endHm}`;
  return {
    key: def.key,
    keys: [def.key],
    label: def.label,
    start: def.startHm,
    end: def.endHm,
    graceMinutes: def.graceMinutes,
    overnight: def.overnight,
    warnHm,
    warnText: `Smena / ish vaqti ${range}. ${def.graceMinutes} daqiqadan so‘ng kechikish hisoblanadi.`,
  };
}

/** Omborxona: tugashdan keyin 2 soat ichida Ketdim */
export const WAREHOUSE_CHECKOUT_GRACE_MS = 2 * 60 * 60 * 1000;

export function encodeWarehouseShiftType(
  startHm: string,
  endHm: string,
  overnight?: boolean,
): string {
  const norm = (hm: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "").trim());
    if (!m) return null;
    return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
  };
  const s = norm(startHm) || "09:00";
  const e = norm(endHm) || "18:00";
  const over =
    overnight === true ||
    (overnight !== false && hmToMinutes(e) <= hmToMinutes(s));
  return over ? `wh:${s}-${e}:o` : `wh:${s}-${e}`;
}

export function isWarehouseShiftType(shiftType?: string | null): boolean {
  return /^wh:/i.test(String(shiftType || "").trim());
}

export function parseWarehouseShiftType(
  shiftType?: string | null,
  shiftLabel?: string | null,
  graceMinutes = 15,
): WorkSchedule | null {
  const raw = String(shiftType || "").trim();
  const m = /^wh:(\d{1,2}:\d{2})-(\d{1,2}:\d{2})(:o)?$/i.exec(raw);
  if (!m) return null;
  const pad = (hm: string) => {
    const [h, mi] = hm.split(":");
    return `${String(Number(h)).padStart(2, "0")}:${mi}`;
  };
  const start = pad(m[1]!);
  const end = pad(m[2]!);
  const overnight = Boolean(m[3]) || hmToMinutes(end) <= hmToMinutes(start);
  const label = String(shiftLabel || "").trim() || "Ombor smena";
  const grace = graceMinutes > 0 ? graceMinutes : 15;
  const warnAt = warnHmBefore(start, grace);
  const range = overnight ? `${start}–${end} (keyingi kun)` : `${start}–${end}`;
  return {
    key: "office",
    keys: ["office"],
    label,
    start,
    end,
    graceMinutes: grace,
    overnight,
    warehouse: true,
    warnHm: warnAt,
    warnText: `Ombor smena «${label}»: ${range}. ${grace} daqiqadan so‘ng kechikish. Ketdim: tugashdan +2 soat.`,
  };
}

export function warehouseCheckoutDeadlineAt(
  workDateYmd: string,
  endHm: string,
  overnight?: boolean,
): Date {
  const endAt = shiftEndAt(workDateYmd, endHm, overnight);
  return new Date(endAt.getTime() + WAREHOUSE_CHECKOUT_GRACE_MS);
}

export function warehouseCheckoutDeadlineHm(
  workDateYmd: string,
  endHm: string,
  overnight?: boolean,
): string {
  const at = warehouseCheckoutDeadlineAt(workDateYmd, endHm, overnight);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
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
    keys,
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
  const wh = parseWarehouseShiftType(shiftType, shiftLabel, defs.office?.graceMinutes ?? 15);
  if (wh) return wh;

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

/** 1-smena / ofis: smena tugagan kun 23:55 */
export const CHECKOUT_DEADLINE_HM = "23:55";
/** 2-smena: smena tugagan kundan keyingi kun 02:00 (23:55 qoidasi YO‘Q) */
export const CHECKOUT_DEADLINE_SHIFT_TWO_HM = "02:00";
/** 3-smena (tun): smena tugagan ertalab 10:00 */
export const CHECKOUT_DEADLINE_SHIFT_THREE_HM = "10:00";

/** @deprecated — o‘rniga checkoutDeadlineAt; eski hisoblar uchun qoldirilgan */
export const CHECKOUT_GRACE_MS = 2 * 60 * 60 * 1000;

function addYmdDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function ymdInTashkent(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** workDate + endHm → smena tugash vaqti (Toshkent) */
export function shiftEndAt(workDateYmd: string, endHm: string, overnight?: boolean): Date {
  const endDay = overnight ? addYmdDays(workDateYmd, 1) : workDateYmd;
  const hm = /^\d{1,2}:\d{2}$/.test(endHm) ? endHm : "18:00";
  return new Date(`${endDay}T${hm}:00+05:00`);
}

function normShiftKeys(opts?: {
  shiftKey?: string | null;
  shiftKeys?: Array<string | null | undefined> | null;
}): string[] {
  const fromList = (opts?.shiftKeys || [])
    .map((k) => String(k || "").toLowerCase())
    .filter(Boolean);
  if (fromList.length) return fromList;
  const one = String(opts?.shiftKey || "").toLowerCase();
  return one ? [one] : [];
}

/** 3-smena / tungi (2+3) — Ketdim smena tugagan ertalab 10:00 gacha */
export function usesShiftThreeCheckoutDeadline(opts?: {
  shiftKey?: string | null;
  shiftKeys?: Array<string | null | undefined> | null;
  overnight?: boolean;
}): boolean {
  const keys = normShiftKeys(opts);
  if (keys.some((k) => k === "three" || k === "3" || k === "shift_three")) return true;
  const one = String(opts?.shiftKey || "").toLowerCase();
  if (one === "three" || one === "3" || one === "shift_three") return true;
  // Tun smenasi (overnight) va 2-smena emas
  if (opts?.overnight && !keys.includes("two") && !keys.includes("2")) return true;
  return false;
}

/** 2-smena (yoki 1+2) — Ketdim ertasi 02:00; 23:55 umuman qo‘llanmaydi */
export function usesShiftTwoCheckoutDeadline(opts?: {
  shiftKey?: string | null;
  shiftKeys?: Array<string | null | undefined> | null;
  overnight?: boolean;
}): boolean {
  if (usesShiftThreeCheckoutDeadline(opts)) return false;
  const keys = normShiftKeys(opts);
  if (keys.some((k) => k === "two" || k === "2" || k === "shift_two")) return true;
  const one = String(opts?.shiftKey || "").toLowerCase();
  return one === "two" || one === "2" || one === "shift_two";
}

export function checkoutDeadlineHmFor(opts?: {
  shiftKey?: string | null;
  shiftKeys?: Array<string | null | undefined> | null;
  overnight?: boolean;
  warehouse?: boolean;
  shiftType?: string | null;
  workDateYmd?: string;
  endHm?: string;
}): string {
  if (opts?.warehouse || isWarehouseShiftType(opts?.shiftType)) {
    if (opts?.workDateYmd && opts?.endHm) {
      return warehouseCheckoutDeadlineHm(opts.workDateYmd, opts.endHm, opts.overnight);
    }
    return "tugash+2soat";
  }
  if (usesShiftThreeCheckoutDeadline(opts)) return CHECKOUT_DEADLINE_SHIFT_THREE_HM;
  if (usesShiftTwoCheckoutDeadline(opts)) return CHECKOUT_DEADLINE_SHIFT_TWO_HM;
  return CHECKOUT_DEADLINE_HM;
}

/**
 * Ketdim oxirgi muddati (Toshkent):
 * - Omborxona (warehouse): smena tugashi + 2 soat
 * - 2-smena: smena tugagan kundan KEYINGI kun 02:00 (23:55 YO‘Q)
 * - 3-smena: smena tugagan ertalab 10:00
 * - 1-smena / ofis: smena tugagan kun 23:55
 */
export function checkoutDeadlineAt(
  workDateYmd: string,
  endHm: string,
  overnight?: boolean,
  opts?: {
    shiftKey?: string | null;
    shiftKeys?: Array<string | null | undefined> | null;
    warehouse?: boolean;
    shiftType?: string | null;
  },
): Date {
  if (opts?.warehouse || isWarehouseShiftType(opts?.shiftType)) {
    return warehouseCheckoutDeadlineAt(workDateYmd, endHm, overnight);
  }
  const endAt = shiftEndAt(workDateYmd, endHm, overnight);
  const endDayYmd = ymdInTashkent(endAt);
  const merged = { ...opts, overnight };

  if (usesShiftThreeCheckoutDeadline(merged)) {
    // Tun smenasi tugagan ertalab (endDay) 10:00
    return new Date(`${endDayYmd}T${CHECKOUT_DEADLINE_SHIFT_THREE_HM}:00+05:00`);
  }
  if (usesShiftTwoCheckoutDeadline(merged)) {
    const nextDay = addYmdDays(endDayYmd, 1);
    return new Date(`${nextDay}T${CHECKOUT_DEADLINE_SHIFT_TWO_HM}:00+05:00`);
  }
  return new Date(`${endDayYmd}T${CHECKOUT_DEADLINE_HM}:00+05:00`);
}

/** Xabar matnlari uchun qisqa izoh */
export function checkoutDeadlineHint(opts?: {
  shiftKey?: string | null;
  shiftKeys?: Array<string | null | undefined> | null;
  overnight?: boolean;
  warehouse?: boolean;
  shiftType?: string | null;
}): string {
  if (opts?.warehouse || isWarehouseShiftType(opts?.shiftType)) {
    return "Ombor smena: «Ketdim» tugash vaqtidan keyin 2 soat ichida";
  }
  if (usesShiftThreeCheckoutDeadline(opts)) {
    return `3-smena: «Ketdim» ertalab soat ${CHECKOUT_DEADLINE_SHIFT_THREE_HM} gacha`;
  }
  if (usesShiftTwoCheckoutDeadline(opts)) {
    return `2-smena: «Ketdim» ertasi kun soat ${CHECKOUT_DEADLINE_SHIFT_TWO_HM} gacha (23:55 emas)`;
  }
  return `1-smena/ofis: «Ketdim» smena kuni soat ${CHECKOUT_DEADLINE_HM} gacha`;
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
  if (w.warehouse) {
    return {
      start: w.start,
      end: w.end,
      graceMinutes: w.graceMinutes,
      overnight: w.overnight,
      shiftKey: "office",
      shiftKeys: ["office"],
      warehouse: true,
    };
  }
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
