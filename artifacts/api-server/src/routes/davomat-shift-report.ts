import { Router, type IRouter } from "express";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { canViewDavomat, isHrManager } from "../lib/roles";
import { pool } from "@workspace/db";
import { PHARMACY_SHIFTS, parseShiftBuckets, sendCoordinatorReportsNow } from "../lib/davomat-coordinator-send";
import {
  getAutoReportConfig,
  getScheduleConfig,
  saveAutoReportConfig,
  saveScheduleConfig,
} from "../lib/davomat-auto-report";
import {
  buildCoordinatorShiftReport,
  dateLabelUz,
  listPharmacyCoordinators,
  tashkentNow,
} from "../lib/davomat-shift-report";
import { renderDavomatShiftPdf, reportWarning, type ReportListKind } from "../lib/davomat-shift-report-pdf";
import { getReportGroup } from "../lib/telegram-report-group";

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

function positiveIds(raw: unknown, max: number): number[] {
  return (Array.isArray(raw) ? raw : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, max);
}

/** Yuborish oynasi uchun: koordinatorlar, direktorlar va guruh holati */
router.get("/davomat/send-report-options", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!isHrManager(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR yubora oladi" });
    return;
  }
  try {
    const [coords, directors, group] = await Promise.all([
      listPharmacyCoordinators(),
      pool.query(
        `SELECT full_name, telegram_id IS NOT NULL AS tg FROM users
          WHERE role = 'director' AND status IN ('active', 'on_leave') ORDER BY full_name`,
      ),
      getReportGroup().catch(() => null),
    ]);
    res.json({
      coordinators: coords.items,
      withoutCoordinator: coords.withoutCoordinator,
      directors: directors.rows.map((r) => ({ name: String(r.full_name || "Direktor"), hasTelegram: Boolean(r.tg) })),
      group: group ? { title: group.chatTitle, topic: group.topicName } : null,
      shifts: PHARMACY_SHIFTS,
    });
  } catch (err) {
    req.log?.error({ err }, "Hisobot yuborish sozlamalari");
    res.status(500).json({ error: "Ma’lumot yuklanmadi" });
  }
});

/** «Hisobot yuborish»: shu daqiqadagi holat — koordinatorlarga yoki direktorga (shaxsiy + guruh) */
router.post("/davomat/send-coordinator-reports", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!isHrManager(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR yubora oladi" });
    return;
  }
  const body = req.body as {
    mode?: string;
    lists?: string[];
    coordinatorIds?: number[];
    buckets?: string[];
    toPersonal?: boolean;
    toGroup?: boolean;
    employeeIds?: number[];
    filterLine?: string | null;
  };
  const lists = (Array.isArray(body.lists) ? body.lists : ["absent", "late", "present"]).filter(
    (k): k is ReportListKind => k === "absent" || k === "late" || k === "present",
  );
  try {
    const { rows } = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [req.userId]);
    res.json(
      await sendCoordinatorReportsNow({
        mode: body.mode === "director" ? "director" : "coordinators",
        lists,
        coordinatorIds: positiveIds(body.coordinatorIds, 500),
        buckets: parseShiftBuckets(body.buckets),
        toPersonal: body.toPersonal !== false,
        toGroup: body.toGroup !== false,
        employeeIds: positiveIds(body.employeeIds, 3000),
        filterLine: typeof body.filterLine === "string" ? body.filterLine.slice(0, 300) : null,
        actorName: String(rows[0]?.full_name || "Admin"),
      }),
    );
  } catch (err) {
    req.log?.error({ err }, "Koordinator hisobotlarini yuborish");
    res.status(503).json({ error: (err as Error).message || "Hisobot yuborilmadi" });
  }
});

/** Avtomatik yuborish sozlamasi */
router.get("/davomat/auto-report", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!isHrManager(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR" });
    return;
  }
  try {
    res.json(await getAutoReportConfig());
  } catch (err) {
    req.log?.error({ err }, "Avto-hisobot sozlamasi");
    res.status(500).json({ error: "Sozlama yuklanmadi" });
  }
});

router.put("/davomat/auto-report", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!isHrManager(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR" });
    return;
  }
  const body = (req.body || {}) as Record<string, unknown>;
  try {
    const { rows } = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [req.userId]);
    res.json(
      await saveAutoReportConfig(
        { enabled: body.enabled, intervalMin: body.intervalMin, fromHm: body.fromHm, toHm: body.toHm, settings: body.settings },
        String(rows[0]?.full_name || "Admin"),
      ),
    );
  } catch (err) {
    res.status(400).json({ error: (err as Error).message || "Saqlanmadi" });
  }
});

/** Belgilangan soatlarda guruhga (masalan 13:00 — 1-smena, 20:00 — 2-smena) */
router.get("/davomat/auto-schedule", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!isHrManager(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR" });
    return;
  }
  try {
    res.json(await getScheduleConfig());
  } catch (err) {
    req.log?.error({ err }, "Belgilangan soatli hisobot sozlamasi");
    res.status(500).json({ error: "Sozlama yuklanmadi" });
  }
});

router.put("/davomat/auto-schedule", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!isHrManager(req.userRole)) {
    res.status(403).json({ error: "Faqat admin va HR" });
    return;
  }
  const body = (req.body || {}) as Record<string, unknown>;
  try {
    const { rows } = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [req.userId]);
    res.json(await saveScheduleConfig({ enabled: body.enabled, runs: body.runs }, String(rows[0]?.full_name || "Admin")));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message || "Saqlanmadi" });
  }
});

export default router;
