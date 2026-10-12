import { Router, type IRouter } from "express";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { canViewDavomat, isHrManager } from "../lib/roles";
import { pool } from "@workspace/db";
import { sendCoordinatorReportsNow } from "../lib/davomat-coordinator-send";
import {
  buildCoordinatorShiftReport,
  dateLabelUz,
  tashkentNow,
} from "../lib/davomat-shift-report";
import { renderDavomatShiftPdf, reportWarning } from "../lib/davomat-shift-report-pdf";

const router: IRouter = Router();

router.post("/davomat/day-report.pdf", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewDavomat(req.userRole)) {
    res.status(403).json({ error: "Davomat hisoboti bu rol uchun yopiq" });
    return;
  }
  const body = req.body as { date?: string; employeeIds?: number[]; filterLine?: string | null };
  const ymd = String(body.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    res.status(400).json({ error: "Sana noto‘g‘ri" });
    return;
  }
  const ids = (Array.isArray(body.employeeIds) ? body.employeeIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, 2000);
  if (!ids.length) {
    res.status(400).json({ error: "PDF uchun xodim tanlanmagan" });
    return;
  }

  try {
    const now = tashkentNow();
    const today = ymd === now.ymd;
    const sections = await buildCoordinatorShiftReport({
      ymd,
      employeeIds: ids,
      viewerUserId: req.userId,
      viewerRole: req.userRole,
    });
    const dateLabel = dateLabelUz(ymd);
    const pdf = await renderDavomatShiftPdf({
      dateLabel,
      reportHm: now.hm,
      updated: false,
      title: "Davomat · kunlik hisobot",
      warningText: today
        ? reportWarning(dateLabel, now.hm, "shu smenaning keyingi belgilangan hisobot vaqti")
        : `Hisobot kuni: ${dateLabel}. Hujjat vaqti: ${dateLabelUz(now.ymd)}, soat ${now.hm}. Kelmagan va kechikkan xodimlarni HR menejerlarga yozib, sababli qildiring. Aks holda bu bir kunlik jarimaga sabab bo‘ladi.`,
      filterLine: body.filterLine || null,
      sections,
    });
    const filename = `davomat_${ymd}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    req.log?.error({ err }, "Davomat kunlik PDF");
    res.status(500).json({ error: "PDF tayyorlanmadi" });
  }
});

/** «Hisobot yuborish»: shu daqiqadagi holat — har koordinatorga o‘z xodimlari (shaxsiy + guruh) */
router.post("/davomat/send-coordinator-reports", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!isHrManager(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR yubora oladi" });
    return;
  }
  const body = req.body as { employeeIds?: number[]; filterLine?: string | null };
  const ids = (Array.isArray(body.employeeIds) ? body.employeeIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, 3000);
  try {
    const { rows } = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [req.userId]);
    res.json(
      await sendCoordinatorReportsNow({
        employeeIds: ids,
        filterLine: typeof body.filterLine === "string" ? body.filterLine.slice(0, 300) : null,
        actorName: String(rows[0]?.full_name || "Admin"),
      }),
    );
  } catch (err) {
    req.log?.error({ err }, "Koordinator hisobotlarini yuborish");
    res.status(503).json({ error: (err as Error).message || "Hisobot yuborilmadi" });
  }
});

export default router;
