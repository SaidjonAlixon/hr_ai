import {
  parseShiftKeys,
  plannedInterval,
  type ShiftKey,
} from "./attendance-engine";

/** YYYY-MM-DD in Asia/Tashkent */
export type Ymd = string;

/**
 * Punch uchun workDate:
 * - ochiq (check-in bor, check-out yo‘q, absent/leave emas) yozuv — o‘sha kun
 * - tungi / kechikkan Ketdim: kechagi ochiq yozuv (muddat checkoutDeadlineAt da tekshiriladi)
 * - aks holda bugun
 */
export function resolveAttendanceWorkDate(opts: {
  todayYmd: string;
  now: Date;
  shiftType?: string | null;
  shiftLabel?: string | null;
  /** Bugungi yozuv */
  todayRec?: {
    checkInAt?: Date | null;
    checkOutAt?: Date | null;
    status?: string | null;
  } | null;
  /** Kecha yozuv */
  yesterdayRec?: {
    checkInAt?: Date | null;
    checkOutAt?: Date | null;
    status?: string | null;
  } | null;
  yesterdayYmd: string;
}): { workDate: string; reason: string } {
  const { todayYmd, yesterdayYmd, now, todayRec, yesterdayRec } = opts;
  const keys = parseShiftKeys(opts.shiftType, opts.shiftLabel) as ShiftKey[];

  const isOpen = (rec?: {
    checkInAt?: Date | null;
    checkOutAt?: Date | null;
    status?: string | null;
  } | null) => {
    if (!rec?.checkInAt || rec.checkOutAt) return false;
    const st = rec.status || "";
    if (st === "absent" || st === "leave") return false;
    return true;
  };

  if (isOpen(todayRec)) {
    return { workDate: todayYmd, reason: "open_today" };
  }
  // 2-smena 02:00 / 3-smena 10:00 gacha Ketdim — ochiq kechagi yozuv ustun
  if (isOpen(yesterdayRec)) {
    return { workDate: yesterdayYmd, reason: "open_overnight" };
  }

  // 3-smena start: kechqurun 23:00 — workDate = today
  if (keys.includes("three")) {
    const plan = plannedInterval(todayYmd, "three");
    if (now.getTime() >= plan.startMs - 60 * 60_000) {
      return { workDate: todayYmd, reason: "three_start" };
    }
  }

  return { workDate: todayYmd, reason: "calendar_today" };
}
