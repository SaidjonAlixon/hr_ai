/**
 * Tasdiqlangan javob olish — davomat jarimasidan ozod qilish.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, javobOlishRequestsTable } from "@workspace/db";
import { hmToMinutes } from "./shift-hours";

export type JavobExemption = {
  employeeId: number;
  workDate: string;
  fromHm: string;
  toHm: string;
  shiftStartHm: string;
  shiftEndHm: string;
  fullDay: boolean;
  durationMinutes: number;
};

export async function loadApprovedJavobExemptions(
  employeeIds: number[],
  dates: string[],
): Promise<Map<string, JavobExemption>> {
  const map = new Map<string, JavobExemption>();
  if (!employeeIds.length || !dates.length) return map;
  const rows = await db
    .select()
    .from(javobOlishRequestsTable)
    .where(
      and(
        inArray(javobOlishRequestsTable.employeeId, employeeIds),
        inArray(javobOlishRequestsTable.workDate, dates),
        eq(javobOlishRequestsTable.status, "approved"),
      ),
    );
  for (const r of rows) {
    const fullDay = r.fromHm === r.shiftStartHm && r.toHm === r.shiftEndHm;
    map.set(`${r.employeeId}|${r.workDate}`, {
      employeeId: r.employeeId,
      workDate: r.workDate,
      fromHm: r.fromHm,
      toHm: r.toHm,
      shiftStartHm: r.shiftStartHm,
      shiftEndHm: r.shiftEndHm,
      fullDay,
      durationMinutes: r.durationMinutes || Math.max(0, durationMin(r.fromHm, r.toHm)),
    });
  }
  return map;
}

function durationMin(fromHm: string, toHm: string) {
  let a = hmToMinutes(fromHm);
  let b = hmToMinutes(toHm);
  if (b <= a) b += 24 * 60;
  return b - a;
}

function fmtSignedMin(min: number) {
  const sign = min >= 0 ? "+" : "−";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h ? `${sign}${h}s ${m}d` : `${sign}${m}d`;
}

/** Kunlik metrikaga jarima imtiyozi qo‘llash */
export function applyJavobExemptionToMetrics<T extends {
  status: string;
  checkIn: string;
  lateArrivalMin: number;
  earlyLeaveMin: number;
  lateArrivalLabel: string;
  earlyLeaveLabel: string;
}>(metrics: T, ex: JavobExemption | undefined, graceMinutes = 15): T {
  if (!ex) return metrics;
  if (ex.fullDay) {
    return {
      ...metrics,
      status: "leave",
      lateArrivalMin: 0,
      earlyLeaveMin: 0,
      lateArrivalLabel: "—",
      earlyLeaveLabel: "—",
    };
  }

  const late = Math.max(0, metrics.lateArrivalMin - ex.durationMinutes);
  const early = Math.max(0, metrics.earlyLeaveMin - ex.durationMinutes);
  let status = metrics.status;
  if (status === "late" && late <= graceMinutes) {
    status = metrics.checkIn && metrics.checkIn !== "—" ? "present" : status;
  }
  if (status === "absent") {
    // Soatlik ruxsat — to‘liq yo‘qlikni leave qilmaymiz, lekin jarima daqiqalarini kamaytiramiz
  }

  return {
    ...metrics,
    status,
    lateArrivalMin: late,
    earlyLeaveMin: early,
    lateArrivalLabel: late ? fmtSignedMin(late) : "—",
    earlyLeaveLabel: early ? fmtSignedMin(early) : "—",
  };
}
