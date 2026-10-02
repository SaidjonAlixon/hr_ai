import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, payrollDaysTable, payrollMonthsTable, pool } from "@workspace/db";
import { salaryShareOnDates, type JarimaEvent } from "./attendance-jarima";

export type PayrollDaySheet = {
  userId: number;
  employeeId: number | null;
  day: string;
  salary: number | null;
  jarima: number | null;
  note: string | null;
  manual: boolean;
  status: "draft" | "approved" | "returned";
  publishedSalary: number | null;
  publishedJarima: number | null;
  publishedNote: string | null;
};

type SheetRow = typeof payrollDaysTable.$inferSelect;

function isCancelNote(note: string | null | undefined) {
  const text = note || "";
  return text.startsWith("Qaytarilgan") || text.startsWith("Bekor qilingan");
}

function asStatus(value: string | null | undefined): PayrollDaySheet["status"] {
  if (value === "approved" || value === "returned") return value;
  return "draft";
}

export function toSheet(row: SheetRow): PayrollDaySheet {
  return {
    userId: row.userId,
    employeeId: row.employeeId,
    day: row.day,
    salary: row.salary,
    jarima: row.jarima,
    note: row.note,
    manual: row.manual,
    status: asStatus(row.status),
    publishedSalary: row.publishedSalary,
    publishedJarima: row.publishedJarima,
    publishedNote: row.publishedNote,
  };
}

let restoredMonthReturn = false;
let daysTableReady = false;

async function ensurePayrollDaysTable(): Promise<void> {
  if (daysTableReady) return;
  await pool.query(`
CREATE TABLE IF NOT EXISTS payroll_days (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  employee_id INTEGER,
  day TEXT NOT NULL,
  salary INTEGER,
  jarima INTEGER,
  note TEXT,
  manual BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'draft',
  published_salary INTEGER,
  published_jarima INTEGER,
  published_note TEXT,
  approved_by_id INTEGER,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_days_user_day_uidx ON payroll_days (user_id, day);
`);
  daysTableReady = true;
}

export async function listPayrollDays(month: string): Promise<PayrollDaySheet[]> {
  await ensurePayrollDaysTable();
  if (!restoredMonthReturn) {
    restoredMonthReturn = true;
    try {
      await db
        .update(payrollMonthsTable)
        .set({ status: "approved", updatedAt: new Date() })
        .where(and(eq(payrollMonthsTable.month, "2026-10"), eq(payrollMonthsTable.status, "returned")));
    } catch (err) {
      console.error("payroll month return restore", err);
    }
  }
  const from = `${month}-01`;
  const to = `${month}-31`;
  const rows = await db
    .select()
    .from(payrollDaysTable)
    .where(and(gte(payrollDaysTable.day, from), lte(payrollDaysTable.day, to)));
  return rows.map(toSheet);
}

export function liveDayNote(event: JarimaEvent | undefined): string {
  if (!event) return "";
  return event.kind === "late" ? `${event.n}-marta · Kech kelindi` : `${event.n}-marta · Kelmagansiz`;
}

export function currentDayFigures(input: {
  monthSalary: number;
  month: string;
  day: string;
  events: JarimaEvent[];
  sheet?: PayrollDaySheet | null;
}): { salary: number; jarima: number; note: string } {
  const share = salaryShareOnDates(input.monthSalary, input.month, [input.day]);
  const event = input.events.find((item) => item.date === input.day);
  const sheet = input.sheet;
  const returnedUntouched = sheet?.status === "returned" && (sheet.jarima ?? 0) === 0 && isCancelNote(sheet.note);
  if (returnedUntouched) {
    return { salary: sheet?.salary ?? share, jarima: 0, note: sheet?.note || "Qaytarilgan · jarima 0" };
  }
  const salary = sheet?.manual && sheet.salary != null ? sheet.salary : share;
  const jarima = sheet?.manual && sheet.jarima != null ? sheet.jarima : Math.max(0, Math.round(event?.amount || 0));
  const note = sheet?.manual ? (sheet.note || "") : liveDayNote(event);
  return { salary, jarima, note };
}

export function isDayDirty(sheet: PayrollDaySheet | null | undefined, current: { salary: number; jarima: number; note: string }): boolean {
  if (!sheet || (sheet.status !== "approved" && sheet.status !== "returned")) return false;
  return current.salary !== (sheet.publishedSalary ?? current.salary)
    || current.jarima !== (sheet.publishedJarima ?? current.jarima)
    || (current.note || "") !== (sheet.publishedNote || "");
}

async function existingMap(day: string, userIds: number[]) {
  await ensurePayrollDaysTable();
  if (!userIds.length) return new Map<number, SheetRow>();
  const rows = await db
    .select()
    .from(payrollDaysTable)
    .where(and(eq(payrollDaysTable.day, day), inArray(payrollDaysTable.userId, userIds)));
  return new Map(rows.map((row) => [row.userId, row]));
}

async function writeDay(input: {
  userId: number;
  employeeId: number | null;
  day: string;
  salary: number | null;
  jarima: number | null;
  note: string | null;
  manual: boolean;
  status: string;
  publishedSalary: number | null;
  publishedJarima: number | null;
  publishedNote: string | null;
  approvedById?: number | null;
  approvedAt?: Date | null;
}) {
  const now = new Date();
  const [found] = await db
    .select({ id: payrollDaysTable.id })
    .from(payrollDaysTable)
    .where(and(eq(payrollDaysTable.userId, input.userId), eq(payrollDaysTable.day, input.day)))
    .limit(1);
  const patch = {
    employeeId: input.employeeId,
    salary: input.salary,
    jarima: input.jarima,
    note: input.note,
    manual: input.manual,
    status: input.status,
    publishedSalary: input.publishedSalary,
    publishedJarima: input.publishedJarima,
    publishedNote: input.publishedNote,
    approvedById: input.approvedById ?? null,
    approvedAt: input.approvedAt ?? null,
    updatedAt: now,
  };
  if (found) {
    await db.update(payrollDaysTable).set(patch).where(eq(payrollDaysTable.id, found.id));
    return;
  }
  await db.insert(payrollDaysTable).values({ userId: input.userId, day: input.day, ...patch });
}

export async function savePayrollDay(input: {
  userId: number;
  employeeId?: number | null;
  day: string;
  salary: number;
  jarima: number;
  note: string;
}) {
  await ensurePayrollDaysTable();
  const [found] = await db
    .select()
    .from(payrollDaysTable)
    .where(and(eq(payrollDaysTable.userId, input.userId), eq(payrollDaysTable.day, input.day)))
    .limit(1);
  const status = found ? asStatus(found.status) : "draft";
  await writeDay({
    userId: input.userId,
    employeeId: input.employeeId ?? found?.employeeId ?? null,
    day: input.day,
    salary: Math.max(0, Math.round(input.salary)),
    jarima: Math.max(0, Math.round(input.jarima)),
    note: String(input.note || "").slice(0, 240),
    manual: true,
    status,
    publishedSalary: found?.publishedSalary ?? null,
    publishedJarima: found?.publishedJarima ?? null,
    publishedNote: found?.publishedNote ?? null,
    approvedById: found?.approvedById ?? null,
    approvedAt: found?.approvedAt ?? null,
  });
}

export async function approvePayrollDays(input: {
  day: string;
  month: string;
  userIds: number[];
  approvedById: number;
  people: Array<{ userId: number | null; employeeId?: number; salary?: number; jarimaEvents?: JarimaEvent[] }>;
}) {
  const have = await existingMap(input.day, input.userIds);
  const byUser = new Map(input.people.filter((person) => person.userId != null).map((person) => [person.userId as number, person]));
  const now = new Date();
  let count = 0;
  for (const userId of input.userIds) {
    const person = byUser.get(userId);
    if (!person) continue;
    const sheet = have.get(userId);
    const parsed = sheet ? toSheet(sheet) : null;
    const cancelled = parsed?.status === "returned" && (parsed.jarima ?? 0) === 0 && isCancelNote(parsed.note);
    const edited = Boolean(parsed?.manual) && !cancelled;
    const current = currentDayFigures({
      monthSalary: person.salary ?? 0,
      month: input.month,
      day: input.day,
      events: person.jarimaEvents ?? [],
      sheet: edited ? parsed : null,
    });
    await writeDay({
      userId,
      employeeId: person.employeeId ?? sheet?.employeeId ?? null,
      day: input.day,
      salary: edited ? current.salary : null,
      jarima: edited ? current.jarima : null,
      note: edited ? current.note : null,
      manual: edited,
      status: "approved",
      publishedSalary: current.salary,
      publishedJarima: current.jarima,
      publishedNote: current.note,
      approvedById: input.approvedById,
      approvedAt: now,
    });
    count += 1;
  }
  return count;
}

export async function refreshPayrollDays(input: {
  day: string;
  month: string;
  userIds: number[];
  approvedById: number;
  people: Array<{ userId: number | null; employeeId?: number; salary?: number; jarimaEvents?: JarimaEvent[] }>;
}) {
  const have = await existingMap(input.day, input.userIds);
  const byUser = new Map(input.people.filter((person) => person.userId != null).map((person) => [person.userId as number, person]));
  const now = new Date();
  let count = 0;
  for (const userId of input.userIds) {
    const row = have.get(userId);
    const person = byUser.get(userId);
    if (!person) continue;
    const current = currentDayFigures({
      monthSalary: person.salary ?? 0,
      month: input.month,
      day: input.day,
      events: person.jarimaEvents ?? [],
      sheet: null,
    });
    await writeDay({
      userId,
      employeeId: person.employeeId ?? row?.employeeId ?? null,
      day: input.day,
      salary: null,
      jarima: null,
      note: null,
      manual: false,
      status: "approved",
      publishedSalary: current.salary,
      publishedJarima: current.jarima,
      publishedNote: current.note,
      approvedById: input.approvedById,
      approvedAt: now,
    });
    count += 1;
  }
  return count;
}

export async function returnPayrollDays(input: {
  day: string;
  month: string;
  userIds: number[];
  approvedById: number;
  people: Array<{ userId: number | null; employeeId?: number; salary?: number; jarimaEvents?: JarimaEvent[] }>;
}) {
  const have = await existingMap(input.day, input.userIds);
  const byUser = new Map(input.people.filter((person) => person.userId != null).map((person) => [person.userId as number, person]));
  const now = new Date();
  let count = 0;
  for (const userId of input.userIds) {
    const person = byUser.get(userId);
    if (!person) continue;
    const sheet = have.get(userId);
    const share = salaryShareOnDates(person.salary ?? 0, input.month, [input.day]);
    const salary = sheet?.manual && sheet.salary != null ? sheet.salary : share;
    await writeDay({
      userId,
      employeeId: person.employeeId ?? sheet?.employeeId ?? null,
      day: input.day,
      salary,
      jarima: 0,
      note: "Bekor qilingan · jarima 0",
      manual: true,
      status: "returned",
      publishedSalary: salary,
      publishedJarima: 0,
      publishedNote: "Bekor qilingan · jarima 0",
      approvedById: input.approvedById,
      approvedAt: now,
    });
    count += 1;
  }
  return count;
}
