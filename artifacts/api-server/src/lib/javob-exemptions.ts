/**
 * Tasdiqlangan javob olish — davomat jarimasidan ozod qilish.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { attendanceRecordsTable, db, javobOlishRequestsTable } from "@workspace/db";
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

export type ApprovedJavobExcuse = {
  employeeId: number;
  userId: number | null;
  workDate: string;
  fromHm: string;
  toHm: string;
  note: string;
  decisionNote?: string | null;
  decidedById: number | null;
  decidedAt: Date | null;
};

export function javobExcuseNote(row: {
  note: string;
  fromHm: string;
  toHm: string;
  decisionNote?: string | null;
}): string {
  const reason = String(row.note || "").trim();
  const extra = String(row.decisionNote || "").trim();
  const time = `${row.fromHm}–${row.toHm}`;
  const text = extra
    ? `Javob olish: ${reason}. ${time}. Izoh: ${extra}`
    : `Javob olish: ${reason}. ${time}`;
  return text.slice(0, 500);
}

/** HR (yoki yakuniy) tasdiqlagan javob olish — davomatda Sababli. Qo‘lda belgilangan Sababli ustidan yozilmaydi. */
export async function excuseAttendanceFromApprovedJavob(rows: ApprovedJavobExcuse[]): Promise<number> {
  const list = rows.filter((row) => row.employeeId > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.workDate));
  if (!list.length) return 0;
  const employeeIds = [...new Set(list.map((row) => row.employeeId))];
  const dates = [...new Set(list.map((row) => row.workDate))].sort();
  const existing = await db
    .select({
      id: attendanceRecordsTable.id,
      employeeId: attendanceRecordsTable.employeeId,
      workDate: attendanceRecordsTable.workDate,
      excused: attendanceRecordsTable.excused,
    })
    .from(attendanceRecordsTable)
    .where(
      and(
        inArray(attendanceRecordsTable.employeeId, employeeIds),
        gte(attendanceRecordsTable.workDate, dates[0]!),
        lte(attendanceRecordsTable.workDate, dates[dates.length - 1]!),
      ),
    );
  const byKey = new Map(existing.map((row) => [`${row.employeeId}|${row.workDate}`, row]));
  let marked = 0;
  for (const row of list) {
    const key = `${row.employeeId}|${row.workDate}`;
    const hit = byKey.get(key);
    if (hit?.excused) continue;
    const now = new Date();
    const payload = {
      excused: true,
      excuseNote: javobExcuseNote(row),
      excusedById: row.decidedById,
      excusedAt: row.decidedAt ?? now,
      updatedAt: now,
    };
    if (hit) {
      await db.update(attendanceRecordsTable).set(payload).where(eq(attendanceRecordsTable.id, hit.id));
      hit.excused = true;
    } else {
      const [inserted] = await db
        .insert(attendanceRecordsTable)
        .values({
          employeeId: row.employeeId,
          userId: row.userId,
          workDate: row.workDate,
          status: "absent",
          source: "manual",
          createdById: row.decidedById,
          ...payload,
        })
        .returning({ id: attendanceRecordsTable.id });
      if (inserted) {
        byKey.set(key, {
          id: inserted.id,
          employeeId: row.employeeId,
          workDate: row.workDate,
          excused: true,
        });
      }
    }
    marked += 1;
  }
  return marked;
}

/** Hisobotdan oldin: shu oralikdagi tasdiqlangan javob olishlarni Sababli qiladi. */
export async function syncApprovedJavobExcuses(
  employeeIds: number[],
  from: string,
  to: string,
): Promise<void> {
  const ids = [...new Set(employeeIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
  const rows = await db
    .select({
      employeeId: javobOlishRequestsTable.employeeId,
      userId: javobOlishRequestsTable.userId,
      workDate: javobOlishRequestsTable.workDate,
      fromHm: javobOlishRequestsTable.fromHm,
      toHm: javobOlishRequestsTable.toHm,
      note: javobOlishRequestsTable.note,
      decisionNote: javobOlishRequestsTable.decisionNote,
      decidedById: javobOlishRequestsTable.decidedById,
      decidedAt: javobOlishRequestsTable.decidedAt,
    })
    .from(javobOlishRequestsTable)
    .where(
      and(
        inArray(javobOlishRequestsTable.employeeId, ids),
        gte(javobOlishRequestsTable.workDate, from),
        lte(javobOlishRequestsTable.workDate, to),
        eq(javobOlishRequestsTable.status, "approved"),
      ),
    );
  await excuseAttendanceFromApprovedJavob(rows);
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
  missingCheckout?: boolean;
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
    status =
      metrics.checkIn && metrics.checkIn !== "—"
        ? metrics.missingCheckout
          ? "incomplete"
          : "present"
        : status;
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
