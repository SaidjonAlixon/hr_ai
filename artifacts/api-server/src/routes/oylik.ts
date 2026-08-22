import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db, employeesTable, payrollMonthsTable, usersTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import {
  canApprovePayroll,
  canEditKpiSettings,
  canManagePayroll,
  computePayroll,
  computePayrollList,
  currentMonthKey,
  formatSom,
  loadKpiWeights,
  saveKpiWeights,
  upsertPayrollDraft,
} from "../lib/kpi-payroll";

const router: IRouter = Router();

router.get("/oylik/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const month = String(req.query.month || currentMonthKey()).slice(0, 7);
    const report = await computePayroll(req.userId!, month);
    if (!report) {
      res.status(404).json({ error: "Foydalanuvchi topilmadi" });
      return;
    }
    const [saved] = await db
      .select({ status: payrollMonthsTable.status, approvedAt: payrollMonthsTable.approvedAt })
      .from(payrollMonthsTable)
      .where(and(eq(payrollMonthsTable.userId, req.userId!), eq(payrollMonthsTable.month, report.month)))
      .limit(1);
    try {
      await upsertPayrollDraft(report);
    } catch (saveErr) {
      console.error("GET /oylik/me upsert", saveErr);
    }
    res.json({ ...report, status: saved?.status || "draft", approvedAt: saved?.approvedAt || null });
  } catch (err) {
    console.error("GET /oylik/me", err);
    const detail = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `Oylik ma'lumoti yuklanmadi: ${detail}` });
  }
});

router.get("/oylik/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManagePayroll(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const weights = await loadKpiWeights();
    res.json({
      weights,
      canEdit: canEditKpiSettings(req.userRole),
      canApprove: canApprovePayroll(req.userRole),
    });
  } catch (err) {
    console.error("GET /oylik/settings", err);
    res.status(503).json({ error: "Sozlama yuklanmadi" });
  }
});

router.patch("/oylik/settings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canEditKpiSettings(req.userRole)) {
    res.status(403).json({ error: "KPI og‘irligini HR direktor, direktor, moliyachi yoki admin o‘zgartiradi" });
    return;
  }
  try {
    const body = req.body ?? {};
    const weights = await saveKpiWeights(
      {
        attendance: body.attendance != null ? Number(body.attendance) : undefined,
        tasks: body.tasks != null ? Number(body.tasks) : undefined,
        checklist: body.checklist != null ? Number(body.checklist) : undefined,
        workStartHm: body.workStartHm,
      },
      req.userId!,
    );
    res.json({ weights });
  } catch (err) {
    console.error("PATCH /oylik/settings", err);
    res.status(503).json({ error: "Sozlama saqlanmadi" });
  }
});

router.get("/oylik/employees", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManagePayroll(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const month = String(req.query.month || currentMonthKey()).slice(0, 7);
    const q = String(req.query.q || "").trim();
    const payload = await computePayrollList(month, q);
    res.json(payload);
  } catch (err) {
    console.error("GET /oylik/employees", err);
    const detail = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `Ro‘yxat yuklanmadi: ${detail}` });
  }
});

router.get("/oylik/employees/:userId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManagePayroll(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const userId = Number(req.params.userId);
    const month = String(req.query.month || currentMonthKey()).slice(0, 7);
    const report = await computePayroll(userId, month);
    if (!report) {
      res.status(404).json({ error: "Xodim topilmadi" });
      return;
    }
    const [saved] = await db
      .select({ status: payrollMonthsTable.status, approvedAt: payrollMonthsTable.approvedAt })
      .from(payrollMonthsTable)
      .where(and(eq(payrollMonthsTable.userId, userId), eq(payrollMonthsTable.month, report.month)))
      .limit(1);
    res.json({ ...report, status: saved?.status || "draft", approvedAt: saved?.approvedAt || null });
  } catch (err) {
    console.error("GET /oylik/employees/:id", err);
    const detail = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `Hisob yuklanmadi: ${detail}` });
  }
});

router.patch("/oylik/salary/:userId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canEditKpiSettings(req.userRole)) {
    res.status(403).json({ error: "Fiks maosh / bonus foizini o‘zgartirish ruxsati yo‘q" });
    return;
  }
  try {
    const userId = Number(req.params.userId);
    const body = req.body ?? {};
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, userId))
      .limit(1);
    if (!emp) {
      res.status(404).json({ error: "Xodim kartochkasi yo‘q — avval xodimga bog‘lang" });
      return;
    }
    const patch: { fixedSalary?: number; bonusPercent?: number } = {};
    if (body.fixedSalary != null) patch.fixedSalary = Math.max(0, Math.round(Number(body.fixedSalary)));
    if (body.bonusPercent != null) patch.bonusPercent = Math.max(0, Math.min(200, Number(body.bonusPercent)));
    if (Object.keys(patch).length) {
      await db.update(employeesTable).set(patch).where(eq(employeesTable.id, emp.id));
    }
    const month = String(req.query.month || currentMonthKey()).slice(0, 7);
    const report = await computePayroll(userId, month);
    if (report) await upsertPayrollDraft(report);
    res.json(report);
  } catch (err) {
    console.error("PATCH /oylik/salary", err);
    res.status(503).json({ error: "Saqlanmadi" });
  }
});

router.post("/oylik/recalculate", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManagePayroll(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const month = String(req.body?.month || req.query.month || currentMonthKey()).slice(0, 7);
    const userId = req.body?.userId != null ? Number(req.body.userId) : null;
    const ids = userId
      ? [userId]
      : (await db.select({ id: usersTable.id }).from(usersTable)).map((u) => u.id);
    let n = 0;
    for (const id of ids) {
      const report = await computePayroll(id, month);
      if (!report) continue;
      await upsertPayrollDraft(report);
      n += 1;
    }
    res.json({ ok: true, month, count: n });
  } catch (err) {
    console.error("POST /oylik/recalculate", err);
    res.status(503).json({ error: "Qayta hisoblanmadi" });
  }
});

router.post("/oylik/approve", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canApprovePayroll(req.userRole)) {
    res.status(403).json({ error: "Tasdiqlash: admin, direktor yoki moliyachi" });
    return;
  }
  try {
    const userId = Number(req.body?.userId);
    const month = String(req.body?.month || currentMonthKey()).slice(0, 7);
    const report = await computePayroll(userId, month);
    if (!report) {
      res.status(404).json({ error: "Xodim topilmadi" });
      return;
    }
    await upsertPayrollDraft(report, "approved");
    await db
      .update(payrollMonthsTable)
      .set({ approvedById: req.userId!, approvedAt: new Date(), status: "approved" })
      .where(and(eq(payrollMonthsTable.userId, userId), eq(payrollMonthsTable.month, report.month)));
    res.json({ ok: true, ...report, status: "approved" });
  } catch (err) {
    console.error("POST /oylik/approve", err);
    res.status(503).json({ error: "Tasdiqlanmadi" });
  }
});

router.get("/oylik/export", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManagePayroll(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const month = String(req.query.month || currentMonthKey()).slice(0, 7);
    const { items } = await computePayrollList(month);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Oylik KPI");
    ws.columns = [
      { header: "F.I.Sh.", width: 28 },
      { header: "Lavozim", width: 18 },
      { header: "Filial", width: 16 },
      { header: "Fiks maosh", width: 14 },
      { header: "Bonus %", width: 10 },
      { header: "Davomat KPI", width: 12 },
      { header: "Topshiriq KPI", width: 14 },
      { header: "Checklist KPI", width: 14 },
      { header: "Umumiy KPI", width: 12 },
      { header: "Bonus", width: 14 },
      { header: "Jami oylik", width: 14 },
      { header: "Holat", width: 12 },
    ];
    for (const r of items) {
      ws.addRow([
        r.fullName,
        r.position || r.roleLabel,
        r.branch || "",
        r.fixedSalary,
        r.bonusPercent,
        r.attendanceAvailable ? r.attendance : "—",
        r.tasksAvailable ? r.tasks : "—",
        r.checklistAvailable ? r.checklist : "—",
        r.kpiPercent,
        r.bonusAmount,
        r.totalAmount,
        r.status === "approved" ? "Tasdiqlangan" : "Qoralama",
      ]);
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="oylik-kpi-${month}.xlsx"`);
    res.send(buf);
  } catch (err) {
    console.error("GET /oylik/export", err);
    res.status(503).json({ error: "Excel yuklanmadi" });
  }
});

export default router;
export { formatSom };
