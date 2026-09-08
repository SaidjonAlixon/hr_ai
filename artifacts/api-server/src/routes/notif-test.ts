import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  cancelNotifTestJob,
  listNotifTestJobs,
  notifTestStatus,
  scheduleNotifTest,
  sendNotifTestNow,
} from "../jobs/notif-test";

const router = Router();

function requireAdmin(req: AuthRequest, res: { status: (n: number) => { json: (b: unknown) => void } }): boolean {
  if (req.userRole !== "admin" && req.userRole !== "director") {
    res.status(403).json({ error: "Faqat admin/direktor" });
    return false;
  }
  return true;
}

router.get("/admin/notif-test/status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const status = await notifTestStatus(req.userId!);
    res.json(status);
  } catch (err) {
    console.error("GET /admin/notif-test/status", err);
    res.status(503).json({ error: "Status olinmadi" });
  }
});

router.get("/admin/notif-test/pending", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const pending = listNotifTestJobs(req.userId!).map((j) => ({
    id: j.id,
    userId: j.userId,
    delayMinutes: j.delayMinutes,
    sendAt: new Date(j.sendAtMs).toISOString(),
    createdAt: new Date(j.createdAtMs).toISOString(),
    text: j.text || null,
    remainSeconds: Math.max(0, Math.round((j.sendAtMs - Date.now()) / 1000)),
  }));
  res.json({ pending });
});

router.post("/admin/notif-test/now", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const body = req.body as { text?: string; userId?: number };
    const targetId = Number(body.userId) > 0 ? Number(body.userId) : req.userId!;
    if (targetId !== req.userId) {
      const [u] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, targetId))
        .limit(1);
      if (!u) {
        res.status(404).json({ error: "Foydalanuvchi topilmadi" });
        return;
      }
    }
    const result = await sendNotifTestNow({
      userId: targetId,
      createdById: req.userId!,
      text: body.text,
    });
    const status = await notifTestStatus(targetId);
    res.json({
      ...result,
      pushDevices: status.pushDevices,
      message:
        status.pushDevices > 0
          ? `Yuborildi: telefon tizim push (${status.pushDevices} qurilma)` +
            (result.telegramLinked ? " + Telegram." : ".")
          : result.telegramLinked
            ? "Telegramga yuborildi, lekin telefon push hali yoqilmagan — «Telefon push yoqish» bosing."
            : "Tizimga yozildi. Telefonda ko‘rinishi uchun «Telefon push yoqish» bosing (HTTPS / PWA).",
    });
  } catch (err) {
    console.error("POST /admin/notif-test/now", err);
    res.status(503).json({ error: "Yuborilmadi" });
  }
});

router.post("/admin/notif-test/schedule", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  try {
    const body = req.body as { delayMinutes?: number; text?: string; userId?: number };
    const delayMinutes = Number(body.delayMinutes);
    if (!Number.isFinite(delayMinutes) || delayMinutes < 1 || delayMinutes > 120) {
      res.status(400).json({ error: "delayMinutes: 1…120 oralig‘ida bo‘lsin" });
      return;
    }
    const targetId = Number(body.userId) > 0 ? Number(body.userId) : req.userId!;
    if (targetId !== req.userId) {
      const [u] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, targetId))
        .limit(1);
      if (!u) {
        res.status(404).json({ error: "Foydalanuvchi topilmadi" });
        return;
      }
    }

    const job = await scheduleNotifTest({
      userId: targetId,
      createdById: req.userId!,
      delayMinutes,
      text: body.text,
    });
    const status = await notifTestStatus(targetId);
    res.json({
      ok: true,
      job: {
        id: job.id,
        delayMinutes: job.delayMinutes,
        sendAt: new Date(job.sendAtMs).toISOString(),
        remainSeconds: Math.max(0, Math.round((job.sendAtMs - Date.now()) / 1000)),
      },
      telegramConfigured: status.telegramConfigured,
      telegramLinked: status.telegramLinked,
      message: `Taymer qo‘yildi: ${job.delayMinutes} daqiqadan keyin yuboriladi.`,
    });
  } catch (err) {
    console.error("POST /admin/notif-test/schedule", err);
    res.status(503).json({ error: "Rejalashtirilmadi" });
  }
});

router.delete("/admin/notif-test/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = String(req.params.id || "");
  const ok = cancelNotifTestJob(id, req.userId!);
  if (!ok) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  res.json({ ok: true });
});

export default router;
