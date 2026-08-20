import { Router, type IRouter } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, attendanceRecordsTable, employeesTable, usersTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const MONTH_NAMES = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentabr",
  "Oktabr",
  "Noyabr",
  "Dekabr",
];

function currentMonthKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

function monthBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    const cur = currentMonthKey();
    return monthBounds(cur);
  }
  const from = `${ym}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${ym}-${String(lastDay).padStart(2, "0")}`;
  return { from, to, monthLabel: `${MONTH_NAMES[m - 1]} ${y}` };
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  director: "Direktor",
  hr: "HR",
  hr_direktor: "HR Direktor",
  hr_menejer: "HR Menejer",
  hr_auditor: "HR Auditor",
  recruiter: "Rekruter",
  trainer: "Trener",
  mentor: "Mentor",
  department_head: "Bo‘lim boshlig‘i",
  mudir: "Mudir",
  koordinator: "Koordinator",
  texnik: "Texnik",
  ombor: "Ombor",
  sb: "SB operatori",
  sb_boshliq: "SB bo‘limi boshlig‘i",
  farmasevt: "Farmasevt",
  stajyor: "Stajyor",
};

/** Xodimning oylik ma'lumoti — barcha rollar uchun */
router.get("/oylik/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const month = String(req.query.month || currentMonthKey()).slice(0, 7);
    const { from, to, monthLabel } = monthBounds(month);

    const [user] = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        role: usersTable.role,
        departmentId: usersTable.departmentId,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "Foydalanuvchi topilmadi" });
      return;
    }

    const [emp] = await db
      .select({
        id: employeesTable.id,
        position: employeesTable.position,
        location: employeesTable.location,
        orgRole: employeesTable.orgRole,
      })
      .from(employeesTable)
      .where(eq(employeesTable.userId, req.userId!))
      .limit(1);

    let records: Array<{
      workDate: string;
      status: string;
      checkInAt: Date | null;
      checkOutAt: Date | null;
    }> = [];

    if (emp) {
      records = await db
        .select({
          workDate: attendanceRecordsTable.workDate,
          status: attendanceRecordsTable.status,
          checkInAt: attendanceRecordsTable.checkInAt,
          checkOutAt: attendanceRecordsTable.checkOutAt,
        })
        .from(attendanceRecordsTable)
        .where(
          and(
            eq(attendanceRecordsTable.employeeId, emp.id),
            gte(attendanceRecordsTable.workDate, from),
            lte(attendanceRecordsTable.workDate, to),
          ),
        );
    }

    const workedDays = records.filter(
      (r) => r.checkInAt && (r.status === "present" || r.status === "late"),
    ).length;
    const lateDays = records.filter((r) => r.status === "late").length;
    const incompleteDays = records.filter((r) => r.status === "incomplete").length;
    const absentDays = records.filter((r) => r.status === "absent").length;

    res.json({
      month,
      monthLabel,
      from,
      to,
      fullName: user.fullName,
      role: user.role,
      roleLabel: ROLE_LABELS[user.role || ""] || user.role,
      position: emp?.position ?? null,
      branch: emp?.location ?? null,
      departmentId: user.departmentId,
      workedDays,
      lateDays,
      incompleteDays,
      absentDays,
      baseSalary: null as string | null,
      bonus: null as string | null,
      deduction: null as string | null,
      netSalary: null as string | null,
      status: "pending" as const,
      note: "Maosh summasi HR bo‘limi tomonidan tasdiqlanadi. Davomat kunlari avtomatik hisoblanadi.",
      days: records
        .sort((a, b) => b.workDate.localeCompare(a.workDate))
        .map((r) => ({
          date: r.workDate,
          status: r.status,
          checkIn: r.checkInAt ? r.checkInAt.toISOString() : null,
          checkOut: r.checkOutAt ? r.checkOutAt.toISOString() : null,
        })),
    });
  } catch (err) {
    console.error("GET /oylik/me", err);
    res.status(503).json({ error: "Oylik ma'lumoti yuklanmadi" });
  }
});

export default router;
