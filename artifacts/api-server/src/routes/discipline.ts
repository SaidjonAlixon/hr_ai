import { Router, type IRouter, type Response } from "express";
import { optionalAuth, requireAuth, type AuthRequest } from "../middlewares/auth";
import { hasFullPlatformAccess, isHrRole } from "../lib/roles";
import {
  activeLockFor,
  attachLiveCoordinators,
  buildDisciplineReport,
  clearLock,
  listTodayLocks,
  LOCK_MESSAGE,
  lockDetailsById,
  lockDetailsFor,
  runDisciplineScan,
  todayTashkent,
} from "../lib/discipline";
import { renderDisciplinePdf } from "../lib/discipline-pdf";
import { invalidateLockCache } from "../lib/discipline-lock";
import { getJarimaSwitch, setJarimaEnabled } from "../lib/jarima-switch";
import { pool } from "@workspace/db";

const router: IRouter = Router();

function canManageDiscipline(role?: string | null) {
  return hasFullPlatformAccess(role) || isHrRole(role);
}

function denyUnlessManager(req: AuthRequest, res: Response): boolean {
  if (canManageDiscipline(req.userRole)) return false;
  res.status(403).json({ error: "Faqat admin va HR uchun" });
  return true;
}

/** Bloklangan xodim ham chaqira oladi — requireAuth uni to‘xtatib qo‘yadi */
router.get("/discipline/my-lock", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) {
    res.json({ locked: false });
    return;
  }
  const lock = await activeLockFor(req.userId);
  res.json(lock ? { locked: true, message: LOCK_MESSAGE, day: lock.lockDay } : { locked: false });
});

router.get("/discipline/my-lock/details", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!req.userId) {
    res.json({ locked: false });
    return;
  }
  const details = await lockDetailsFor(req.userId);
  res.json(details ? { locked: true, ...details } : { locked: false });
});

router.get("/discipline/locks", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyUnlessManager(req, res)) return;
  res.json({ day: todayTashkent(), items: await listTodayLocks() });
});

router.get("/discipline/locks/:id/details", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyUnlessManager(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Noto‘g‘ri ID" });
    return;
  }
  const details = await lockDetailsById(id);
  if (!details) {
    res.status(404).json({ error: "Blok topilmadi" });
    return;
  }
  res.json(details);
});

router.post("/discipline/locks/:id/clear", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyUnlessManager(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Noto‘g‘ri ID" });
    return;
  }
  const ok = await clearLock(id, req.userId!);
  if (!ok) {
    res.status(404).json({ error: "Blok topilmadi yoki allaqachon ochilgan" });
    return;
  }
  res.json({ ok: true });
});

router.get("/discipline/report.pdf", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyUnlessManager(req, res)) return;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month) : todayTashkent().slice(0, 7);
  if (month === todayTashkent().slice(0, 7)) await runDisciplineScan();
  const isCurrent = month === todayTashkent().slice(0, 7);
  if (isCurrent) await runDisciplineScan();
  const report = await buildDisciplineReport(month);
  await attachLiveCoordinators(report);
  const pdf = await renderDisciplinePdf(report, isCurrent ? { todayLocks: await listTodayLocks(), today: todayTashkent() } : {});
  res.setHeader("Content-Disposition", `attachment; filename="intizom_${month}.pdf"`);
  res.send(pdf);
});

router.get("/discipline/summary", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyUnlessManager(req, res)) return;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month) : todayTashkent().slice(0, 7);
  const report = await buildDisciplineReport(month);
  const level = (min: number, max = Infinity) => report.people.filter((p) => p.strikes >= min && p.strikes <= max).length;
  const sw = await getJarimaSwitch();
  res.json({
    month,
    jarima: { enabled: sw.enabled, updatedByName: sw.updatedByName, updatedAt: sw.updatedAt },
    level3: level(3, 3),
    level4: level(4, 4),
    level5: level(5),
    locks: month === todayTashkent().slice(0, 7) ? await listTodayLocks() : [],
  });
});

router.put("/discipline/jarima", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyUnlessManager(req, res)) return;
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "Holat noto‘g‘ri" });
    return;
  }
  try {
    const { rows } = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [req.userId]);
    const sw = await setJarimaEnabled(req.body.enabled, String(rows[0]?.full_name || "Admin"));
    invalidateLockCache();
    void runDisciplineScan();
    res.json({ enabled: sw.enabled, updatedByName: sw.updatedByName, updatedAt: sw.updatedAt });
  } catch (err) {
    console.error("PUT /discipline/jarima", err);
    res.status(503).json({ error: "Saqlanmadi" });
  }
});

export default router;
