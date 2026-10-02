import { and, eq, inArray } from "drizzle-orm";
import { db, employeesTable, payrollMonthsTable, usersTable } from "@workspace/db";
import { buildStaffAttendanceDays } from "./employee-attendance-report";

/** Jarima shu kundan boshlanadi. Undan oldingi kechikish va kelmaslik hisobga kirmaydi. */
export const JARIMA_START = "2026-10-01";

export const JARIMA_RULE = [
  "1-marta — 1 kunlik ish haqining 30%",
  "2-marta — 1 kunlik ish haqining 30%",
  "3-marta — 1 kunlik ish haqining 100%",
  "4-marta va undan keyin — har safar 1 oylik ish haqining 50%",
] as const;

const PHARMACY_ROLES = new Set(["mudir", "farmasevt", "stajyor", "stajor"]);

function roleTitle(role: string | null | undefined): string {
  const key = String(role || "").toLowerCase();
  if (key === "mudir") return "Filial mudiri";
  if (key === "farmasevt") return "Farmasevt";
  if (key === "stajyor" || key === "stajor") return "Stajyor";
  return "";
}
const AUTO_NOTE = "Davomat jarimasi";

export type JarimaEvent = {
  date: string;
  kind: "late" | "absent";
  n: number;
  amount: number;
};

export type JarimaPerson = {
  userId: number;
  employeeId: number;
  fullName: string;
  position: string;
  salary: number;
  strikes: number;
  late: number;
  absent: number;
  amount: number;
  events: JarimaEvent[];
  note: string | null;
  status: string;
  locked: boolean;
};

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function todayTashkent(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

/** Oylik oyning kunlariga teng. Qoldiq oxirgi kunlarga, yig‘indi oylikka teng. */
export function salaryShareOnDates(monthly: number, month: string, dates: string[]): number {
  const total = Math.max(0, Math.round(monthly));
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (total <= 0 || n <= 0) return 0;
  const base = Math.floor(total / n);
  const rem = total - base * n;
  let sum = 0;
  for (const date of dates) {
    if (!date.startsWith(`${month}-`)) continue;
    const day = Number(date.slice(8, 10));
    if (day < 1 || day > n) continue;
    sum += base + (day > n - rem ? 1 : 0);
  }
  return sum;
}

/** Kunlik = oylik / shu oyning kunlari. Har bir marta alohida qo‘shiladi. */
export function jarimaAmount(monthly: number, monthDays: number, strikes: number): number {
  const salary = Math.max(0, Math.round(monthly));
  if (salary <= 0 || strikes <= 0) return 0;
  const daily = salary / Math.max(1, monthDays);
  let total = 0;
  for (let n = 1; n <= strikes; n += 1) {
    if (n === 1 || n === 2) total += Math.round(daily * 0.3);
    else if (n === 3) total += Math.round(daily);
    else total += Math.round(salary * 0.5);
  }
  return total;
}

function reasonLine(late: number, absent: number): string {
  const lateText = late === 1 ? "Kech kelindi" : `${late} marta kech kelindi`;
  const absentText = absent === 1 ? "Kelmagansiz" : `${absent} marta kelmagansiz`;
  if (late > 0 && absent > 0) return `${lateText}. ${absentText}`;
  if (late > 0) return lateText;
  return absentText;
}

function warningLine(strikes: number): string {
  if (strikes <= 1) return "Ogohlantirish: keyingi safar yana 1 kunlik ish haqingizning 30% jarima.";
  if (strikes === 2) return "Ogohlantirish: 3-martada 1 kunlik ish haqingizning 100% jarima.";
  if (strikes === 3) return "Ogohlantirish: 4-martada 1 oylik ish haqingizning 50% jarima.";
  return "Ogohlantirish: har keyingi safar 1 oylik ish haqingizning 50% jarima.";
}

function autoNote(late: number, absent: number, strikes: number): string | null {
  if (strikes <= 0) return null;
  return `${reasonLine(late, absent)}. ${warningLine(strikes)}`;
}

function isAutoNote(note: string | null | undefined): boolean {
  const text = String(note || "").trim();
  return !text || text.startsWith(AUTO_NOTE) || text.startsWith("Siz ") || text.startsWith("Kech kelindi") || text.startsWith("Kelmagansiz") || /^\d+ marta (kech kelindi|kelmagansiz)/.test(text) || text.includes("Ogohlantirish:");
}

export async function applyAttendanceJarima(
  monthKey: string,
  isWorkDayFor?: (person: {
    role: string | null;
    orgRole: string | null;
    position: string | null;
    location: string | null;
    shiftType: string | null;
    shiftLabel: string | null;
  }, date: string) => boolean,
): Promise<{
  month: string;
  active: boolean;
  people: JarimaPerson[];
}> {
  const month = String(monthKey || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month) || month < JARIMA_START.slice(0, 7)) {
    return { month, active: false, people: [] };
  }
  const from = `${month}-01` < JARIMA_START ? JARIMA_START : `${month}-01`;
  const to = monthEnd(month);
  if (from > to) return { month, active: false, people: [] };

  const staff = await db
    .select({
      employeeId: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      orgRole: employeesTable.orgRole,
      location: employeesTable.location,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      fixedSalary: employeesTable.fixedSalary,
      role: usersTable.role,
      status: employeesTable.employmentStatus,
    })
    .from(employeesTable)
    .innerJoin(usersTable, eq(usersTable.id, employeesTable.userId))
    .where(inArray(usersTable.role, ["mudir", "farmasevt", "stajyor", "stajor"]));

  const people = staff.filter((row) => {
    const role = String(row.role || "").toLowerCase();
    const status = String(row.status || "").toLowerCase();
    if (!PHARMACY_ROLES.has(role) || row.userId == null) return false;
    if (status === "need_hire" || status === "no_manager" || status === "closed" || status === "dismissed") return false;
    if (/xodim kerak/i.test(row.fullName || "")) return false;
    return true;
  });
  if (!people.length) return { month, active: true, people: [] };

  const userIds = people.map((row) => row.userId as number);
  const savedRows = await db
    .select({
      userId: payrollMonthsTable.userId,
      salary: payrollMonthsTable.fixedSalary,
      jarima: payrollMonthsTable.jarima,
      note: payrollMonthsTable.jarimaNote,
      status: payrollMonthsTable.status,
    })
    .from(payrollMonthsTable)
    .where(and(eq(payrollMonthsTable.month, month), inArray(payrollMonthsTable.userId, userIds)));
  const savedByUser = new Map(savedRows.map((row) => [row.userId, row]));

  const packs = await buildStaffAttendanceDays({
    employeeIds: people.map((row) => row.employeeId),
    from,
    to,
  });
  const daysByEmp = new Map(packs.map((pack) => [pack.employeeId, pack.days]));
  const today = todayTashkent();
  const monthDays = daysInMonth(month);
  const out: JarimaPerson[] = [];

  for (const person of people) {
    const userId = person.userId as number;
    const saved = savedByUser.get(userId);
    const salary = Math.max(0, Math.round(Number(saved?.salary || person.fixedSalary || 0)));
    const days = daysByEmp.get(person.employeeId) ?? [];
    const counted = days
      .filter((day) => {
        if (day.date < JARIMA_START) return false;
        if (day.excused) return false;
        if (day.status === "prehire" || day.status === "outside") return false;
        if (day.status === "rest" || day.status === "leave" || day.status === "planned") return false;
        if (isWorkDayFor && !isWorkDayFor(person, day.date)) return false;
        if (day.status === "late") return true;
        return day.status === "absent" && day.date < today;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const events: JarimaEvent[] = [];
    for (const day of counted) {
      const n = events.length + 1;
      events.push({
        date: day.date,
        kind: day.status === "late" ? "late" : "absent",
        n,
        amount: jarimaAmount(salary, monthDays, n) - jarimaAmount(salary, monthDays, n - 1),
      });
    }
    const late = events.filter((event) => event.kind === "late").length;
    const absent = events.length - late;
    const strikes = events.length;
    const amount = events.reduce((sum, event) => sum + event.amount, 0);
    const note = autoNote(late, absent, strikes);
    const status = saved?.status === "approved" || saved?.status === "returned" ? saved.status : "draft";
    const locked = status === "approved" || (saved != null && !isAutoNote(saved.note));
    const shownAmount = locked ? Math.max(0, saved?.jarima ?? 0) : amount;
    const shownNote = locked ? saved?.note ?? null : note;
    out.push({
      userId,
      employeeId: person.employeeId,
      fullName: person.fullName,
      position: person.position || roleTitle(person.role),
      salary,
      strikes,
      late,
      absent,
      amount: shownAmount,
      events,
      note: shownNote,
      status,
      locked,
    });

    if (locked) continue;
    if (saved) {
      if (saved.jarima === amount && (saved.note || null) === note) continue;
      await db
        .update(payrollMonthsTable)
        .set({
          jarima: amount,
          jarimaNote: note,
          totalAmount: salary - amount,
          updatedAt: new Date(),
        })
        .where(and(eq(payrollMonthsTable.userId, userId), eq(payrollMonthsTable.month, month)));
      continue;
    }
    if (salary <= 0 && amount <= 0) continue;
    await db.insert(payrollMonthsTable).values({
      userId,
      employeeId: person.employeeId,
      month,
      status: "draft",
      fixedSalary: salary,
      bonusPercent: 0,
      kpiPercent: 0,
      maxBonus: 0,
      bonusAmount: 0,
      totalAmount: salary - amount,
      jarima: amount,
      jarimaNote: note,
    });
  }

  return { month, active: true, people: out };
}
