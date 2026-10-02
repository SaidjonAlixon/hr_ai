import { and, eq, inArray } from "drizzle-orm";
import { db, employeeScheduleOverridesTable } from "@workspace/db";
import type { ShiftKey } from "./attendance-engine";
import { hmToMinutes, type StaffHours, type WorkSchedule } from "./shift-hours";
import { warnHmBefore } from "./shift-schedule";

export const SCHEDULE_SHIFT_KEYS = ["office", "one", "two", "three"] as const;
export type ScheduleShiftKey = (typeof SCHEDULE_SHIFT_KEYS)[number];

export type ScheduleOverride = {
  id: number;
  employeeId: number;
  mode: "permanent" | "period";
  validFrom: string;
  validTo: string | null;
  shiftKey: ScheduleShiftKey;
  startHm: string;
  endHm: string;
  note: string | null;
};

const SHIFT_LABEL: Record<ScheduleShiftKey, string> = {
  office: "Ofis",
  one: "1-smena",
  two: "2-smena",
  three: "3-smena",
};

export function isScheduleShiftKey(value: string): value is ScheduleShiftKey {
  return (SCHEDULE_SHIFT_KEYS as readonly string[]).includes(value);
}

export function scheduleShiftLabel(key: ScheduleShiftKey): string {
  return SHIFT_LABEL[key];
}

export function scheduleOvernight(startHm: string, endHm: string): boolean {
  return hmToMinutes(endHm) <= hmToMinutes(startHm);
}

export function normalizeHm(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export function pickScheduleOverride(
  rules: ScheduleOverride[] | undefined,
  date: string,
): ScheduleOverride | null {
  if (!rules?.length) return null;
  const covering = rules.filter(
    (rule) => rule.validFrom <= date && (!rule.validTo || date <= rule.validTo),
  );
  covering.sort((a, b) => {
    const periodA = a.validTo ? 1 : 0;
    const periodB = b.validTo ? 1 : 0;
    if (periodA !== periodB) return periodB - periodA;
    return b.validFrom.localeCompare(a.validFrom) || b.id - a.id;
  });
  return covering[0] ?? null;
}

export function staffHoursFromOverride(rule: ScheduleOverride, graceMinutes = 15): StaffHours {
  return {
    start: rule.startHm,
    end: rule.endHm,
    graceMinutes,
    overnight: scheduleOvernight(rule.startHm, rule.endHm),
    shiftKey: rule.shiftKey,
    shiftKeys: [rule.shiftKey],
  };
}

export function workScheduleFromOverride(rule: ScheduleOverride, graceMinutes = 15): WorkSchedule {
  const overnight = scheduleOvernight(rule.startHm, rule.endHm);
  const label = scheduleShiftLabel(rule.shiftKey);
  const range = overnight ? `${rule.startHm}–${rule.endHm} (keyingi kun)` : `${rule.startHm}–${rule.endHm}`;
  return {
    key: rule.shiftKey as ShiftKey,
    keys: [rule.shiftKey],
    label,
    start: rule.startHm,
    end: rule.endHm,
    graceMinutes,
    overnight,
    warnHm: warnHmBefore(rule.startHm, graceMinutes),
    warnText: `${label}: kelish ${rule.startHm}, ketish ${rule.endHm}. ${graceMinutes} daqiqadan so‘ng kechikish. ${range}.`,
  };
}

function mapRow(row: {
  id: number;
  employeeId: number;
  mode: string;
  validFrom: string;
  validTo: string | null;
  shiftKey: string;
  startHm: string;
  endHm: string;
  note: string | null;
}): ScheduleOverride | null {
  if (!isScheduleShiftKey(row.shiftKey)) return null;
  return {
    id: row.id,
    employeeId: row.employeeId,
    mode: row.mode === "period" ? "period" : "permanent",
    validFrom: row.validFrom,
    validTo: row.validTo,
    shiftKey: row.shiftKey,
    startHm: row.startHm,
    endHm: row.endHm,
    note: row.note,
  };
}

export async function loadScheduleOverrides(
  employeeIds: number[],
  from: string,
  to: string,
): Promise<Map<number, ScheduleOverride[]>> {
  const ids = [...new Set(employeeIds.filter((id) => Number.isFinite(id) && id > 0))];
  const out = new Map<number, ScheduleOverride[]>();
  if (!ids.length) return out;
  const rows = await db
    .select({
      id: employeeScheduleOverridesTable.id,
      employeeId: employeeScheduleOverridesTable.employeeId,
      mode: employeeScheduleOverridesTable.mode,
      validFrom: employeeScheduleOverridesTable.validFrom,
      validTo: employeeScheduleOverridesTable.validTo,
      shiftKey: employeeScheduleOverridesTable.shiftKey,
      startHm: employeeScheduleOverridesTable.startHm,
      endHm: employeeScheduleOverridesTable.endHm,
      note: employeeScheduleOverridesTable.note,
    })
    .from(employeeScheduleOverridesTable)
    .where(
      and(
        eq(employeeScheduleOverridesTable.active, true),
        inArray(employeeScheduleOverridesTable.employeeId, ids),
      ),
    );
  for (const row of rows) {
    if (row.validTo && row.validTo < from) continue;
    if (row.validFrom > to) continue;
    const mapped = mapRow(row);
    if (!mapped) continue;
    const list = out.get(mapped.employeeId) ?? [];
    list.push(mapped);
    out.set(mapped.employeeId, list);
  }
  return out;
}

export async function resolveScheduleOverride(
  employeeId: number,
  workDate: string,
): Promise<ScheduleOverride | null> {
  const map = await loadScheduleOverrides([employeeId], workDate, workDate);
  return pickScheduleOverride(map.get(employeeId), workDate);
}
