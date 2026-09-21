/**
 * Ko‘p filial + smena ish slotlari.
 * Bir kunda 2 ta filial (masalan 1-smena A, 2-smena B) — vaqt kesishmasa ruxsat.
 */
import {
  atTashkent,
  addDaysYmd,
  plannedInterval,
  findBranchScheduleConflicts,
  type ShiftKey,
  type ShiftDefinition,
  DEFAULT_SHIFT_DEFS,
} from "./attendance-engine.ts";

export type WorkSlotMode = "permanent" | "period" | "weekly" | "days";

export type WorkSlotShiftKey = ShiftKey | "one+two" | "two+three";

export type WorkSlotRow = {
  id?: number;
  employeeId: number;
  branchId: number;
  branchLabel?: string | null;
  shiftKey: WorkSlotShiftKey;
  mode: WorkSlotMode;
  validFrom: string;
  validTo?: string | null;
  weekdays?: number[] | null;
  workDates?: string[] | null;
  note?: string | null;
  active?: boolean;
};

export type ResolvedDaySlot = {
  branchId: number;
  branchLabel?: string | null;
  shiftKey: WorkSlotShiftKey;
  mode: WorkSlotMode;
  slotId?: number;
};

const MODE_PRIORITY: Record<WorkSlotMode, number> = {
  days: 1,
  period: 2,
  weekly: 3,
  permanent: 4,
};

/** ISO: 1=Du … 7=Ya (Asia/Tashkent) */
export function isoWeekdayTashkent(ymd: string): number {
  const noon = atTashkent(ymd, "12:00");
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tashkent",
    weekday: "short",
  }).format(noon);
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[wd] || 1;
}

export function normalizeWeekdays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out = [
    ...new Set(
      raw
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7),
    ),
  ].sort((a, b) => a - b);
  return out;
}

export function normalizeWorkDates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((d) => String(d).trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  ].sort();
}

export function normalizeShiftKeyStrict(raw: unknown): WorkSlotShiftKey | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (s === "one" || s === "1") return "one";
  if (s === "two" || s === "2") return "two";
  if (s === "three" || s === "3") return "three";
  if (s === "one+two" || s === "1+2" || s === "onetwo") return "one+two";
  if (s === "two+three" || s === "2+3" || s === "twothree") return "two+three";
  return null;
}

export function slotCoversDate(slot: WorkSlotRow, workDate: string): boolean {
  if (slot.active === false) return false;
  if (slot.mode === "days") {
    const dates = slot.workDates || [];
    return dates.includes(workDate);
  }
  if (workDate < slot.validFrom) return false;
  if (slot.validTo && workDate > slot.validTo) return false;
  if (slot.mode === "weekly") {
    const days = slot.weekdays || [];
    if (!days.length) return false;
    return days.includes(isoWeekdayTashkent(workDate));
  }
  return true;
}

export function expandWorkSlotShiftKeys(key: WorkSlotShiftKey | string): ShiftKey[] {
  const s = String(key || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (s === "one+two" || s === "1+2" || s === "onetwo") return ["one", "two"];
  if (s === "two+three" || s === "2+3" || s === "twothree") return ["two", "three"];
  if (s === "one" || s === "1") return ["one"];
  if (s === "two" || s === "2") return ["two"];
  if (s === "three" || s === "3") return ["three"];
  if (s === "office") return ["office"];
  return ["one"];
}

/**
 * Shu kun uchun amal qiladigan slotlar.
 * Bir xil smena uchun bir nechta bo‘lsa — eng ustuvor mode qoladi.
 */
export function resolveSlotsForDay(
  workDate: string,
  slots: WorkSlotRow[],
): ResolvedDaySlot[] {
  const covering = slots
    .filter((s) => slotCoversDate(s, workDate))
    .sort((a, b) => {
      const pa = MODE_PRIORITY[a.mode] - MODE_PRIORITY[b.mode];
      if (pa !== 0) return pa;
      return String(a.shiftKey).localeCompare(String(b.shiftKey));
    });

  const byShift = new Map<ShiftKey, WorkSlotRow>();
  for (const s of covering) {
    for (const key of expandWorkSlotShiftKeys(s.shiftKey)) {
      if (!byShift.has(key)) {
        byShift.set(key, { ...s, shiftKey: key });
      }
    }
  }

  return [...byShift.values()]
    .map((s) => ({
      branchId: s.branchId,
      branchLabel: s.branchLabel,
      shiftKey: s.shiftKey as ShiftKey,
      mode: s.mode,
      slotId: s.id,
    }))
    .sort((a, b) => {
      const order = { one: 1, two: 2, three: 3, office: 4 } as Record<string, number>;
      return (order[a.shiftKey] || 9) - (order[b.shiftKey] || 9);
    });
}

export function validateSlotInput(input: {
  mode: string;
  shiftKey: unknown;
  validFrom?: string | null;
  validTo?: string | null;
  weekdays?: unknown;
  workDates?: unknown;
}): { ok: true; mode: WorkSlotMode; shiftKey: ShiftKey; validFrom: string; validTo: string | null; weekdays: number[] | null; workDates: string[] | null } | { ok: false; error: string } {
  const mode = String(input.mode || "").trim() as WorkSlotMode;
  if (!["permanent", "period", "weekly", "days"].includes(mode)) {
    return { ok: false, error: "mode: permanent | period | weekly | days" };
  }
  const shiftKey = normalizeShiftKeyStrict(input.shiftKey);
  if (!shiftKey) return { ok: false, error: "Smena: 1, 2, 3, 1+2 yoki 2+3" };

  if (mode === "days") {
    const workDates = normalizeWorkDates(input.workDates);
    if (!workDates.length) return { ok: false, error: "Kamida bitta kun tanlang" };
    if (workDates.length > 62) return { ok: false, error: "Bir martada ko‘pi bilan 62 kun" };
    return {
      ok: true,
      mode,
      shiftKey,
      validFrom: workDates[0]!,
      validTo: workDates[workDates.length - 1]!,
      weekdays: null,
      workDates,
    };
  }

  const validFrom = String(input.validFrom || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
    return { ok: false, error: "validFrom YYYY-MM-DD" };
  }
  let validTo: string | null =
    input.validTo == null || input.validTo === ""
      ? null
      : String(input.validTo).trim();
  if (validTo && !/^\d{4}-\d{2}-\d{2}$/.test(validTo)) {
    return { ok: false, error: "validTo YYYY-MM-DD" };
  }
  if (mode === "period") {
    if (!validTo) return { ok: false, error: "Muddatli rejimda tugash sanasi majburiy" };
    if (validTo < validFrom) return { ok: false, error: "Tugash sanasi boshlanishdan oldin bo‘lmasin" };
  }
  if (mode === "permanent" && !validTo) {
    // ochiq muddat
  }
  let weekdays: number[] | null = null;
  if (mode === "weekly") {
    weekdays = normalizeWeekdays(input.weekdays);
    if (!weekdays.length) return { ok: false, error: "Haftalik uchun kamida bitta kun tanlang" };
  }
  return { ok: true, mode, shiftKey, validFrom, validTo, weekdays, workDates: null };
}

/** Saqlashdan oldin: bir xodim slotlari orasida vaqt+filial konflikti */
export function conflictAmongSlots(
  slots: WorkSlotRow[],
  sampleFrom: string,
  sampleTo: string,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
): string | null {
  let day = sampleFrom;
  let guard = 0;
  while (day <= sampleTo && guard < 120) {
    const daySlots = resolveSlotsForDay(day, slots);
    const entries = daySlots.map((s) => {
      const iv = plannedInterval(day, s.shiftKey, defs);
      return {
        branchId: s.branchId,
        startMs: iv.startMs,
        endMs: iv.endMs,
        label: `${s.branchLabel || s.branchId} · ${s.shiftKey}`,
      };
    });
    const err = findBranchScheduleConflicts(entries);
    if (err) return `${day}: ${err}`;
    day = addDaysYmd(day, 1);
    guard += 1;
  }
  return null;
}

const EARLY_IN_MIN = 45;
const LATE_OUT_MIN = 120;

export type ActivePunchSlot = ResolvedDaySlot & {
  startMs: number;
  endMs: number;
  punchOpenMs: number;
  punchCloseMs: number;
};

/** Kun slotlarini interval bilan (vaqt oynasidan qat’i nazar) */
export function allPunchSlotsAt(
  workDate: string,
  slots: ResolvedDaySlot[],
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
): ActivePunchSlot[] {
  return slots.map((s) => {
    const iv = plannedInterval(workDate, s.shiftKey, defs);
    return {
      ...s,
      startMs: iv.startMs,
      endMs: iv.endMs,
      punchOpenMs: iv.startMs - EARLY_IN_MIN * 60_000,
      punchCloseMs: iv.endMs + LATE_OUT_MIN * 60_000,
    };
  });
}

/** Hozirgi smena oynasidagi slot(lar) — informatsion / afzal tanlash */
export function activePunchSlotsAt(
  workDate: string,
  slots: ResolvedDaySlot[],
  nowMs: number,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
  action: "in" | "out" = "in",
): ActivePunchSlot[] {
  const out: ActivePunchSlot[] = [];
  for (const s of allPunchSlotsAt(workDate, slots, defs)) {
    const windowOk =
      action === "in"
        ? nowMs >= s.punchOpenMs && nowMs <= s.endMs + 15 * 60_000
        : nowMs >= s.startMs - 15 * 60_000 && nowMs <= s.punchCloseMs;
    if (windowOk) out.push(s);
  }
  return out;
}

/** Bir kunda 2+ turli filial biriktirilganmi */
export function isMultiBranchDay(slots: ResolvedDaySlot[]): boolean {
  return slots.length >= 2 && new Set(slots.map((s) => s.branchId)).size >= 2;
}

/**
 * Overlay oynada 1-smena va 2-smena birga aktiv bo‘lishi mumkin (17:00 atrofida).
 * GPS/UI uchun: hozir ishlayotgan, yo‘q bo‘lsa keyingi, yo‘q bo‘lsa oxirgi smenani tanlash.
 */
export function preferActivePunchSlot(
  slots: ActivePunchSlot[],
  nowMs: number,
): ActivePunchSlot | null {
  if (!slots.length) return null;
  const running = slots
    .filter((s) => nowMs >= s.startMs && nowMs <= s.endMs)
    .sort((a, b) => b.startMs - a.startMs);
  if (running[0]) return running[0];
  const upcoming = slots
    .filter((s) => nowMs < s.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (upcoming[0]) return upcoming[0];
  return [...slots].sort((a, b) => b.endMs - a.endMs)[0] ?? null;
}

/**
 * Asosiy yozuvda Ketdi bosilgan, lekin boshqa filial/smena hali ochilmagan — 2-filial «Keldim».
 * punchedShiftKeys: segment yoki asosiy yozuvdan yopilgan smenalar.
 */
export function hasOpenMultiBranchShift(
  daySlots: ResolvedDaySlot[],
  punchedShiftKeys: Iterable<string>,
): boolean {
  if (!isMultiBranchDay(daySlots)) return false;
  const done = new Set([...punchedShiftKeys].map((k) => String(k).toLowerCase()));
  return daySlots.some((s) => !done.has(String(s.shiftKey).toLowerCase()));
}

/**
 * Davomat uchun slotlar: avvalo oynadagi, yo‘q bo‘lsa kunning barcha biriktirilgan slotlari.
 * Keldim/Ketdim istalgan vaqtda qabul qilinadi; soat hisobi smena rejasi bo‘yicha.
 */
export function punchSlotsForGate(
  workDate: string,
  slots: ResolvedDaySlot[],
  nowMs: number,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
  action: "in" | "out" = "in",
): ActivePunchSlot[] {
  const active = activePunchSlotsAt(workDate, slots, nowMs, defs, action);
  if (active.length) return active;
  return allPunchSlotsAt(workDate, slots, defs);
}

export function formatShiftKeyUz(key: WorkSlotShiftKey | ShiftKey | string): string {
  const s = String(key || "").toLowerCase();
  if (s === "one+two" || s === "1+2") return "1+2";
  if (s === "two+three" || s === "2+3") return "2+3";
  if (s === "two") return "2-smena";
  if (s === "three") return "3-smena";
  if (s === "office") return "Ofis";
  return "1-smena";
}

export function formatModeUz(mode: WorkSlotMode | string): string {
  if (mode === "period") return "Muddatli";
  if (mode === "weekly") return "Haftalik";
  if (mode === "days") return "Kunlik";
  return "Doimiy";
}

export function weekdayLabelUz(n: number): string {
  const labels = ["", "Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
  return labels[n] || String(n);
}
