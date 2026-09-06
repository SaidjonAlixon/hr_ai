/**
 * HR Pro — smena / davomat / ish soati hisoblash yadrosi (Asia/Tashkent).
 * Smena = reja; davomat = haqiqiy check-in/out. Ishlangan vaqt faqat punchlardan.
 */

export type ShiftKey = "one" | "two" | "three" | "office";

export type ShiftDefinition = {
  key: ShiftKey;
  label: string;
  /** HH:mm — smena boshlanishi (workDate kuni) */
  startHm: string;
  /** HH:mm — smena tugashi (overnight bo‘lsa keyingi kun) */
  endHm: string;
  /** true = tugash keyingi kalendar kunida */
  overnight: boolean;
  /** Default unpaid break (daq) — sozlamadan override qilinadi */
  defaultUnpaidBreakMin: number;
  graceMinutes: number;
};

export const DEFAULT_SHIFT_DEFS: Record<ShiftKey, ShiftDefinition> = {
  one: {
    key: "one",
    label: "1-smena",
    startHm: "08:00",
    endHm: "17:00",
    overnight: false,
    defaultUnpaidBreakMin: 60,
    graceMinutes: 15,
  },
  two: {
    key: "two",
    label: "2-smena",
    startHm: "17:00",
    endHm: "23:45",
    overnight: false,
    defaultUnpaidBreakMin: 0,
    graceMinutes: 15,
  },
  three: {
    key: "three",
    label: "3-smena",
    startHm: "23:00",
    endHm: "07:00",
    overnight: true,
    defaultUnpaidBreakMin: 0,
    graceMinutes: 15,
  },
  office: {
    key: "office",
    label: "Ofis",
    startHm: "09:00",
    endHm: "18:00",
    overnight: false,
    defaultUnpaidBreakMin: 60,
    graceMinutes: 15,
  },
};

/** @deprecated alias — DEFAULT_SHIFT_DEFS bilan bir xil; runtime override `buildShiftDefs` orqali */
export const SHIFT_DEFS = DEFAULT_SHIFT_DEFS;

export type ShiftScheduleOverrides = {
  one?: { startHm?: string; endHm?: string };
  two?: { startHm?: string; endHm?: string };
  three?: { startHm?: string; endHm?: string; overnight?: boolean };
  office?: { startHm?: string; endHm?: string };
  graceMinutes?: number;
};

export function buildShiftDefs(
  overrides?: ShiftScheduleOverrides | null,
): Record<ShiftKey, ShiftDefinition> {
  const g = overrides?.graceMinutes;
  const base = DEFAULT_SHIFT_DEFS;
  return {
    one: {
      ...base.one,
      startHm: overrides?.one?.startHm || base.one.startHm,
      endHm: overrides?.one?.endHm || base.one.endHm,
      graceMinutes: g ?? base.one.graceMinutes,
    },
    two: {
      ...base.two,
      startHm: overrides?.two?.startHm || base.two.startHm,
      endHm: overrides?.two?.endHm || base.two.endHm,
      graceMinutes: g ?? base.two.graceMinutes,
    },
    three: {
      ...base.three,
      startHm: overrides?.three?.startHm || base.three.startHm,
      endHm: overrides?.three?.endHm || base.three.endHm,
      overnight: overrides?.three?.overnight ?? base.three.overnight,
      graceMinutes: g ?? base.three.graceMinutes,
    },
    office: {
      ...base.office,
      startHm: overrides?.office?.startHm || base.office.startHm,
      endHm: overrides?.office?.endHm || base.office.endHm,
      graceMinutes: g ?? base.office.graceMinutes,
    },
  };
}

function isHm(v: string | undefined | null): v is string {
  return !!v && /^\d{1,2}:\d{2}$/.test(v);
}

/** Rejalashtirilgan smena davomiyligi (daq) — faqat ma’lumot; ish haqi uchun ishlatilmasin */
export function plannedShiftMinutes(def: ShiftDefinition): number {
  const start = hmToMinutes(def.startHm);
  let end = hmToMinutes(def.endHm);
  if (def.overnight || end <= start) end += 24 * 60;
  return end - start;
}

export type AttendancePaySettings = {
  unpaidBreakByShift: Partial<Record<ShiftKey, number>>;
  /** true = break paid (ish vaqtidan ayirilmaydi) */
  breakPaid: boolean;
  nightStartHm: string;
  nightEndHm: string;
  nightCoefficient: number;
  dailyNormMinutes: number;
  overtimeEnabled: boolean;
  graceMinutes: number;
  minRestHoursBetweenShifts: number;
  maxShiftsPerDay: number;
  /** Missing checkout: hech qachon 24 soat deb hisoblama */
  missingCheckoutStatus: "incomplete";
  /** Admin sozlagan smena oynalari */
  shiftSchedule?: ShiftScheduleOverrides;
};

export const DEFAULT_PAY_SETTINGS: AttendancePaySettings = {
  unpaidBreakByShift: { one: 60, two: 0, three: 0, office: 60 },
  breakPaid: false,
  nightStartHm: "22:00",
  nightEndHm: "06:00",
  nightCoefficient: 1.5,
  dailyNormMinutes: 8 * 60,
  overtimeEnabled: true,
  graceMinutes: 15,
  minRestHoursBetweenShifts: 12,
  maxShiftsPerDay: 2,
  missingCheckoutStatus: "incomplete",
};

export type TimeInterval = { startMs: number; endMs: number };

export type PunchSegment = {
  shiftKey: ShiftKey;
  /** ISO / Date — haqiqiy kirish */
  checkInAt: Date | string | null;
  /** ISO / Date — haqiqiy chiqish */
  checkOutAt: Date | string | null;
};

export type DayShiftPlan = {
  workDate: string; // YYYY-MM-DD (Toshkent) — smena boshlangan kun
  shiftKeys: ShiftKey[];
};

export type BranchAssignmentKind = "substitute" | "temp_one_day" | "rotation" | "permanent";

export type BranchAssignment = {
  kind: BranchAssignmentKind;
  branchId: number;
  branchLabel?: string | null;
  validFrom: string; // YYYY-MM-DD
  validTo?: string | null; // inclusive; null = ochiq
  replacesEmployeeId?: number | null;
};

export type DayAttendanceResult = {
  workDate: string;
  shiftKeys: ShiftKey[];
  shiftCount: number;
  status: string;
  missingCheckout: boolean;
  /** Haqiqiy ishlagan daqiqalar (overlap bir marta) */
  rawWorkedMinutes: number;
  /** Unpaid break ayirilgandan keyin */
  paidWorkedMinutes: number;
  unpaidBreakMinutes: number;
  nightMinutes: number;
  lateArrivalMin: number;
  earlyLeaveMin: number;
  overtimeMin: number;
  earlyArrivalMin: number;
  plannedMinutes: number;
  plannedPaidMinutes: number;
  overlapMinutes: number;
  intervals: TimeInterval[];
  warnings: string[];
};

export type ShiftAssignValidation = {
  ok: boolean;
  error?: string;
  warning?: string;
};

const TZ = "Asia/Tashkent";

export function hmToMinutes(hm: string): number {
  const [h, m] = String(hm || "0:0").split(":").map((x) => Number(x) || 0);
  return h * 60 + m;
}

export function minutesToHm(total: number): string {
  const n = Math.max(0, Math.floor(total));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatDurationUz(mins: number): string {
  const n = Math.max(0, Math.floor(mins));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h > 0 && m > 0) return `${h} soat ${m} daqiqa`;
  if (h > 0) return `${h} soat`;
  return `${m} daqiqa`;
}

/** YYYY-MM-DD + HH:mm → Date in Asia/Tashkent wall time */
export function atTashkent(ymd: string, hm: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  const asUtc = Date.UTC(y, (mo || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  const probe = new Date(asUtc);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(probe);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  const offset = localAsUtc - asUtc;
  return new Date(asUtc - offset);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

/** Smena reja oralig‘i (workDate = boshlanish kuni) */
export function plannedInterval(
  workDate: string,
  key: ShiftKey,
  defs: Record<ShiftKey, ShiftDefinition> = DEFAULT_SHIFT_DEFS,
): TimeInterval {
  const def = defs[key] || DEFAULT_SHIFT_DEFS[key];
  const start = atTashkent(workDate, def.startHm);
  const endDate = def.overnight ? addDaysYmd(workDate, 1) : workDate;
  let end = atTashkent(endDate, def.endHm);
  if (end.getTime() <= start.getTime()) {
    end = atTashkent(addDaysYmd(workDate, 1), def.endHm);
  }
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export function normalizeShiftKey(
  raw?: string | null,
  shiftLabel?: string | null,
): ShiftKey {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "two" || s === "2" || s === "shift_two") return "two";
  if (s === "three" || s === "3" || s === "shift_three") return "three";
  if (s === "office") return "office";
  if (s === "one" || s === "1" || s === "shift_one") return "one";
  const lab = String(shiftLabel || "").toLowerCase();
  if (lab.includes("3-smena") || lab.includes("3 smena") || lab.includes("tungi")) return "three";
  if (lab.includes("2-smena") || lab.includes("2 smena")) return "two";
  return "one";
}

/** "one+two" | "one,two" | JSON array | single */
export function parseShiftKeys(
  raw?: string | null,
  shiftLabel?: string | null,
): ShiftKey[] {
  const s = String(raw || "").trim();
  if (!s) return [normalizeShiftKey(null, shiftLabel)];
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s) as string[];
      return Array.from(new Set(arr.map((x) => normalizeShiftKey(x))));
    } catch {
      /* fallthrough */
    }
  }
  const parts = s
    .split(/[+|,/\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [normalizeShiftKey(s, shiftLabel)];
  return Array.from(new Set(parts.map((p) => normalizeShiftKey(p))));
}

export function encodeShiftKeys(keys: ShiftKey[]): string {
  const uniq = Array.from(new Set(keys.filter((k) => k !== "office")));
  if (uniq.length === 0) return "one";
  if (uniq.length === 1) return uniq[0];
  return uniq.sort(shiftSort).join("+");
}

function shiftSort(a: ShiftKey, b: ShiftKey): number {
  const order: ShiftKey[] = ["one", "two", "three", "office"];
  return order.indexOf(a) - order.indexOf(b);
}

/**
 * Bir kunda smena biriktirish qoidalari:
 * max 2; 1+2 OK; 2+3 OK; 1+3 warning; 1+2+3 xato
 */
export function validateShiftCombination(
  keys: ShiftKey[],
  settings: AttendancePaySettings = DEFAULT_PAY_SETTINGS,
): ShiftAssignValidation {
  const pharmacy = keys.filter((k) => k === "one" || k === "two" || k === "three");
  const uniq = Array.from(new Set(pharmacy));
  if (uniq.length > settings.maxShiftsPerDay) {
    return {
      ok: false,
      error: `Bir xodimga bir kunda ${settings.maxShiftsPerDay} tadan ortiq smena berib bo‘lmaydi`,
    };
  }
  if (uniq.length === 3) {
    return { ok: false, error: "1+2+3 smena bir kunda ruxsat etilmaydi (maksimal 2 ta)" };
  }
  if (uniq.includes("one") && uniq.includes("three") && !uniq.includes("two")) {
    return {
      ok: true,
      warning:
        "1-smena va 3-smena ketma-ket emas — dam olish qisqa bo‘lishi mumkin. Tasdiqlang yoki 2-smena bilan almashtiring.",
    };
  }
  return { ok: true };
}

/** Oraliqlarni birlashtirish (overlap bir marta) */
export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const valid = intervals
    .filter((i) => i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (!valid.length) return [];
  const out: TimeInterval[] = [{ ...valid[0] }];
  for (let i = 1; i < valid.length; i++) {
    const cur = valid[i];
    const last = out[out.length - 1];
    if (cur.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, cur.endMs);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export function intervalsDurationMin(intervals: TimeInterval[]): number {
  return mergeIntervals(intervals).reduce(
    (s, i) => s + Math.round((i.endMs - i.startMs) / 60_000),
    0,
  );
}

export function overlapMinutes(a: TimeInterval[], b: TimeInterval[]): number {
  let total = 0;
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.startMs, y.startMs);
      const end = Math.min(x.endMs, y.endMs);
      if (end > start) total += Math.round((end - start) / 60_000);
    }
  }
  return total;
}

/** Tungi soatlar (sozlanadigan oyna, odatda 22:00–06:00) */
export function nightMinutesInIntervals(
  intervals: TimeInterval[],
  workDate: string,
  settings: AttendancePaySettings = DEFAULT_PAY_SETTINGS,
): number {
  const merged = mergeIntervals(intervals);
  const nightWindows: TimeInterval[] = [];
  for (const dayOffset of [-1, 0, 1]) {
    const day = addDaysYmd(workDate, dayOffset);
    nightWindows.push({
      startMs: atTashkent(day, settings.nightStartHm).getTime(),
      endMs: atTashkent(addDaysYmd(day, 1), settings.nightEndHm).getTime(),
    });
  }
  return overlapMinutes(merged, mergeIntervals(nightWindows));
}

function unpaidBreakForKeys(
  keys: ShiftKey[],
  settings: AttendancePaySettings,
): number {
  if (settings.breakPaid) return 0;
  let sum = 0;
  for (const k of keys) {
    const fromSettings = settings.unpaidBreakByShift[k];
    sum += fromSettings ?? SHIFT_DEFS[k]?.defaultUnpaidBreakMin ?? 0;
  }
  return sum;
}

/**
 * Haqiqiy punch segmentlaridan kunlik hisob.
 * Missing checkout → workedMinutes = 0, status incomplete (24 soat deb hisoblanmaydi).
 */
export function computeDayAttendance(input: {
  workDate: string;
  shiftKeys: ShiftKey[];
  segments: PunchSegment[];
  settings?: AttendancePaySettings;
}): DayAttendanceResult {
  const settings = { ...DEFAULT_PAY_SETTINGS, ...input.settings };
  const defs = buildShiftDefs({
    ...settings.shiftSchedule,
    graceMinutes: settings.graceMinutes,
  });
  const shiftKeys =
    input.shiftKeys.length > 0
      ? input.shiftKeys
      : input.segments.map((s) => s.shiftKey);
  const warnings: string[] = [];
  const combo = validateShiftCombination(shiftKeys, settings);
  if (combo.warning) warnings.push(combo.warning);
  if (!combo.ok && combo.error) warnings.push(combo.error);

  const planned = shiftKeys.map((k) => plannedInterval(input.workDate, k, defs));
  const plannedMinutes = intervalsDurationMin(planned);
  const plannedOverlap = Math.max(
    0,
    planned.reduce((s, p) => s + Math.round((p.endMs - p.startMs) / 60_000), 0) - plannedMinutes,
  );
  const unpaidBreakMinutes = unpaidBreakForKeys(shiftKeys, settings);
  const plannedPaidMinutes = Math.max(0, plannedMinutes - unpaidBreakMinutes);

  const rawIntervals: TimeInterval[] = [];
  let missingCheckout = false;
  let earlyArrivalMin = 0;
  let lateArrivalMin = 0;
  let earlyLeaveMin = 0;

  for (const seg of input.segments) {
    const plan = plannedInterval(input.workDate, seg.shiftKey, defs);
    const cin = toDate(seg.checkInAt);
    const cout = toDate(seg.checkOutAt);

    if (cin && !cout) {
      missingCheckout = true;
      // Avtomatik katta ish vaqti YO‘Q
      if (cin.getTime() > plan.startMs) {
        lateArrivalMin = Math.max(
          lateArrivalMin,
          Math.round((cin.getTime() - plan.startMs) / 60_000),
        );
      } else if (cin.getTime() < plan.startMs) {
        earlyArrivalMin = Math.max(
          earlyArrivalMin,
          Math.round((plan.startMs - cin.getTime()) / 60_000),
        );
      }
      continue;
    }

    if (cin && cout) {
      if (cout.getTime() <= cin.getTime()) {
        warnings.push("Check-out check-in dan oldin — segment e’tiborsiz");
        continue;
      }
      rawIntervals.push({ startMs: cin.getTime(), endMs: cout.getTime() });

      if (cin.getTime() < plan.startMs) {
        earlyArrivalMin = Math.max(
          earlyArrivalMin,
          Math.round((plan.startMs - cin.getTime()) / 60_000),
        );
      }
      // Kechikish — smena startidan (grace faqat status uchun)
      if (cin.getTime() > plan.startMs) {
        lateArrivalMin = Math.max(
          lateArrivalMin,
          Math.round((cin.getTime() - plan.startMs) / 60_000),
        );
      }
      if (cout.getTime() < plan.endMs) {
        earlyLeaveMin = Math.max(
          earlyLeaveMin,
          Math.round((plan.endMs - cout.getTime()) / 60_000),
        );
      }
    }
  }

  const merged = mergeIntervals(rawIntervals);
  const rawWorkedMinutes = intervalsDurationMin(merged);
  // Segment planned overlap (2+3) real punchlarda merge allaqachon bir marta hisoblaydi
  const sumRaw = rawIntervals.reduce(
    (s, i) => s + Math.round((i.endMs - i.startMs) / 60_000),
    0,
  );
  const overlapMinutesDeduped = Math.max(0, sumRaw - rawWorkedMinutes);

  const paidWorkedMinutes = missingCheckout
    ? 0
    : Math.max(0, rawWorkedMinutes - unpaidBreakMinutes);

  let overtimeMin = 0;
  if (!missingCheckout && settings.overtimeEnabled && paidWorkedMinutes > settings.dailyNormMinutes) {
    overtimeMin = paidWorkedMinutes - settings.dailyNormMinutes;
  }

  const nightMinutes = missingCheckout
    ? 0
    : nightMinutesInIntervals(merged, input.workDate, settings);

  let status = "absent";
  const grace = settings.graceMinutes;
  const pastGraceLate = lateArrivalMin > grace;
  if (missingCheckout) status = settings.missingCheckoutStatus;
  else if (rawWorkedMinutes > 0) status = pastGraceLate ? "late" : "present";
  else if (input.segments.some((s) => s.checkInAt)) status = "incomplete";

  return {
    workDate: input.workDate,
    shiftKeys,
    shiftCount: shiftKeys.length,
    status,
    missingCheckout,
    rawWorkedMinutes: missingCheckout ? 0 : rawWorkedMinutes,
    paidWorkedMinutes,
    unpaidBreakMinutes: missingCheckout ? 0 : unpaidBreakMinutes,
    nightMinutes,
    lateArrivalMin,
    earlyLeaveMin: missingCheckout ? 0 : earlyLeaveMin,
    overtimeMin,
    earlyArrivalMin,
    plannedMinutes,
    plannedPaidMinutes,
    overlapMinutes: Math.max(overlapMinutesDeduped, plannedOverlap),
    intervals: merged,
    warnings,
  };
}

/** Filial ustuvorligi: substitute > temp_one_day > rotation > permanent */
const BRANCH_PRIORITY: Record<BranchAssignmentKind, number> = {
  substitute: 1,
  temp_one_day: 2,
  rotation: 3,
  permanent: 4,
};

export function coversDate(a: BranchAssignment, workDate: string): boolean {
  if (workDate < a.validFrom) return false;
  if (a.validTo && workDate > a.validTo) return false;
  return true;
}

export function resolveBranchForDay(
  workDate: string,
  assignments: BranchAssignment[],
  fallback?: { branchId: number; branchLabel?: string | null } | null,
): { branchId: number; branchLabel?: string | null; kind: BranchAssignmentKind | "fallback" } | null {
  const covering = assignments
    .filter((a) => coversDate(a, workDate))
    .sort((a, b) => BRANCH_PRIORITY[a.kind] - BRANCH_PRIORITY[b.kind]);
  if (covering[0]) {
    return {
      branchId: covering[0].branchId,
      branchLabel: covering[0].branchLabel,
      kind: covering[0].kind,
    };
  }
  if (fallback) {
    return { branchId: fallback.branchId, branchLabel: fallback.branchLabel, kind: "fallback" };
  }
  return null;
}

/** Bir xodim bir vaqtda ikki filialda bo‘lolmasligi — interval kesishishi */
export function findBranchScheduleConflicts(
  entries: Array<{ branchId: number; startMs: number; endMs: number; label?: string }>,
): string | null {
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.branchId === b.branchId) continue;
      const start = Math.max(a.startMs, b.startMs);
      const end = Math.min(a.endMs, b.endMs);
      if (end > start) {
        return `Bir vaqtda ikki filialga biriktirib bo‘lmaydi (${a.label || a.branchId} va ${b.label || b.branchId})`;
      }
    }
  }
  return null;
}

/** Minimal dam olish: oldingi smena tugashi → keyingi boshlanishi */
export function checkMinRestBetweenShifts(
  prevEndMs: number,
  nextStartMs: number,
  settings: AttendancePaySettings = DEFAULT_PAY_SETTINGS,
): string | null {
  const gapH = (nextStartMs - prevEndMs) / 3_600_000;
  if (gapH < settings.minRestHoursBetweenShifts) {
    return `Smenalar orasidagi dam olish ${gapH.toFixed(1)} soat — minimal ${settings.minRestHoursBetweenShifts} soat talab qilinadi`;
  }
  return null;
}

export type MonthlyTotals = {
  workDays: number;
  shiftCount: number;
  rawWorkedMinutes: number;
  paidWorkedMinutes: number;
  nightMinutes: number;
  lateArrivalMin: number;
  earlyLeaveMin: number;
  overtimeMin: number;
  leaveDays: number;
  sickDays: number;
  otherAbsentDays: number;
};

export function aggregateMonthly(days: DayAttendanceResult[]): MonthlyTotals {
  const tot: MonthlyTotals = {
    workDays: 0,
    shiftCount: 0,
    rawWorkedMinutes: 0,
    paidWorkedMinutes: 0,
    nightMinutes: 0,
    lateArrivalMin: 0,
    earlyLeaveMin: 0,
    overtimeMin: 0,
    leaveDays: 0,
    sickDays: 0,
    otherAbsentDays: 0,
  };
  for (const d of days) {
    if (d.status === "leave") {
      tot.leaveDays += 1;
      continue;
    }
    if (d.status === "absent") {
      tot.otherAbsentDays += 1;
      continue;
    }
    if (d.rawWorkedMinutes > 0 || d.missingCheckout) {
      tot.workDays += 1;
      tot.shiftCount += d.shiftCount;
      tot.rawWorkedMinutes += d.rawWorkedMinutes;
      tot.paidWorkedMinutes += d.paidWorkedMinutes;
      tot.nightMinutes += d.nightMinutes;
      tot.lateArrivalMin += d.lateArrivalMin;
      tot.earlyLeaveMin += d.earlyLeaveMin;
      tot.overtimeMin += d.overtimeMin;
    }
  }
  return tot;
}
