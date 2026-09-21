/**
 * Admin: ofis yashil zona test koordinatorini yaratish / o‘chirish.
 */
import { Router, type IRouter } from "express";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { hasFullPlatformAccess } from "../lib/roles";
import {
  ensureTestOfficeCoordinator,
  purgeTestOfficeCoordinator,
  TEST_COORD_LOGIN,
} from "../lib/test-office-coordinator";

const router: IRouter = Router();

function requireAdmin(req: AuthRequest, res: import("express").Response): boolean {
  if (!hasFullPlatformAccess(req.userRole) && req.userRole !== "admin") {
    res.status(403).json({ error: "Faqat admin" });
    return false;
  }
  return true;
}

/** Test koordinator yaratish / yangilash + login/parol */
router.post("/admin/test-office-coordinator", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await ensureTestOfficeCoordinator();
    res.json(result);
  } catch (err) {
    console.error("ensureTestOfficeCoordinator", err);
    res.status(503).json({ error: "Test koordinator yaratilmadi" });
  }
});

router.get("/admin/test-office-coordinator", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await ensureTestOfficeCoordinator();
    res.json({
      ...result,
      password: undefined,
      hint: `Login: ${TEST_COORD_LOGIN} · Parol avval yaratilganda berilgan / POST bilan qayta o‘rnatiladi`,
    });
  } catch (err) {
    console.error("get test-office-coordinator", err);
    res.status(503).json({ error: "Topilmadi" });
  }
});

/** Darhol bazadan o‘chirish (admin ruxsati) */
router.delete("/admin/test-office-coordinator", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await purgeTestOfficeCoordinator();
    res.json(result);
  } catch (err) {
    console.error("purgeTestOfficeCoordinator", err);
    res.status(503).json({ error: "O‘chirilmadi" });
  }
});

export default router;
