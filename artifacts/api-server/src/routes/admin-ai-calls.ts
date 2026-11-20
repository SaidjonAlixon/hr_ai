import { Router } from "express";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import {
  createAiCallJob,
  deleteAiCallJob,
  getAiCallJob,
  listAiCallJobs,
  listAiCallLogs,
  listAiCallTargets,
  nextDailyScheduledAt,
  updateAiCallJob,
} from "../lib/ai-call-jobs";
import { isAiCallBusy, runAiCallJob } from "../lib/ai-call-orchestrator";
import { telegramCallerConfigured } from "../lib/telegram-voice-call";

const router = Router();

function requireAdmin(req: AuthRequest, res: import("express").Response): boolean {
  if (String(req.userRole || "").toLowerCase() !== "admin") {
    res.status(403).json({ error: "Faqat bosh admin" });
    return false;
  }
  return true;
}

function parseScheduledAt(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

router.get("/admin/ai-calls/status", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({
    configured: telegramCallerConfigured(),
    enabled: process.env.AI_CALL_ENABLED !== "0",
    busy: isAiCallBusy(),
  });
});

router.get("/admin/ai-calls/targets", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const q = String(req.query.q || "");
    const rows = await listAiCallTargets(q, Number(req.query.limit) || 40);
    res.json({ targets: rows });
  } catch (err) {
    console.error("GET /admin/ai-calls/targets", err);
    res.status(500).json({ error: "Targets olishda xato" });
  }
});

router.get("/admin/ai-calls/jobs", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const jobs = await listAiCallJobs(Number(req.query.limit) || 100);
    res.json({ jobs });
  } catch (err) {
    console.error("GET /admin/ai-calls/jobs", err);
    res.status(500).json({ error: "Joblar olishda xato" });
  }
});

router.post("/admin/ai-calls/jobs", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const body = req.body || {};
    const telegramId = String(body.targetTelegramId || "").trim();
    const openScript = String(body.openScript || "").trim();
    if (!telegramId || !/^\d+$/.test(telegramId)) {
      res.status(400).json({ error: "targetTelegramId raqam bo‘lishi kerak" });
      return;
    }
    if (!openScript || openScript.length < 3) {
      res.status(400).json({ error: "openScript kerak" });
      return;
    }
    const scheduledAt =
      parseScheduledAt(body.scheduledAt) ||
      (body.recurrence === "daily" && body.dailyTime
        ? nextDailyScheduledAt(String(body.dailyTime))
        : new Date());
    const job = await createAiCallJob({
      targetUserId: body.targetUserId != null ? Number(body.targetUserId) : null,
      targetTelegramId: telegramId,
      targetName: body.targetName ? String(body.targetName) : null,
      openScript,
      conversational: body.conversational !== false,
      maxTurns: body.maxTurns != null ? Number(body.maxTurns) : 4,
      voice: body.voice === "male" ? "male" : "female",
      scheduledAt,
      recurrence: body.recurrence === "daily" ? "daily" : "once",
      dailyTime: body.dailyTime ? String(body.dailyTime) : null,
      enabled: body.enabled !== false,
      createdBy: req.userId ?? null,
    });
    res.json({ job });
  } catch (err) {
    console.error("POST /admin/ai-calls/jobs", err);
    res.status(500).json({ error: "Job yaratishda xato" });
  }
});

/** Live studio: hozir Telegram orqali qo‘ng‘iroq (platforma WebRTC emas) */
router.post("/admin/ai-calls/live", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    if (!telegramCallerConfigured()) {
      res.status(503).json({ error: "Userbot sozlanmagan" });
      return;
    }
    if (isAiCallBusy()) {
      res.status(409).json({ error: "Hozir boshqa Telegram qo‘ng‘iroq band" });
      return;
    }
    const body = req.body || {};
    const telegramId = String(body.targetTelegramId || "").trim();
    const openScript = String(
      body.openScript ||
        "Assalomu alaykum. Bu AI Saydman. Vaksinahr platformasi bo‘yicha qisqa yordam uchun qo‘ng‘iroq qildim.",
    ).trim();
    if (!telegramId || !/^\d+$/.test(telegramId)) {
      res.status(400).json({ error: "Telegram ulangan xodim tanlang" });
      return;
    }
    if (openScript.length < 3) {
      res.status(400).json({ error: "Ochilish matni kerak" });
      return;
    }
    const job = await createAiCallJob({
      targetUserId: body.targetUserId != null ? Number(body.targetUserId) : null,
      targetTelegramId: telegramId,
      targetName: body.targetName ? String(body.targetName) : null,
      openScript,
      conversational: body.conversational !== false,
      maxTurns: body.maxTurns != null ? Number(body.maxTurns) : 4,
      voice: body.voice === "male" ? "male" : "female",
      scheduledAt: new Date(),
      recurrence: "once",
      dailyTime: null,
      enabled: true,
      createdBy: req.userId ?? null,
    });
    await updateAiCallJob(job.id, { status: "running", lastError: null });
    void runAiCallJob(job.id)
      .then(() => undefined)
      .catch((err) => console.error("live-call", err));
    res.json({
      ok: true,
      jobId: job.id,
      message: "Telegram qo‘ng‘iroq boshlandi",
      voice: job.voice,
    });
  } catch (err) {
    console.error("POST /admin/ai-calls/live", err);
    res.status(500).json({ error: "Telegram qo‘ng‘iroq boshlanmadi" });
  }
});

router.patch("/admin/ai-calls/jobs/:id", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "id" });
      return;
    }
    const body = req.body || {};
    const patch: Parameters<typeof updateAiCallJob>[1] = {};
    if (body.openScript != null) patch.openScript = String(body.openScript);
    if (body.conversational != null) patch.conversational = Boolean(body.conversational);
    if (body.maxTurns != null) patch.maxTurns = Number(body.maxTurns);
    if (body.voice != null) patch.voice = body.voice === "male" ? "male" : "female";
    if (body.scheduledAt != null) {
      const d = parseScheduledAt(body.scheduledAt);
      if (!d) {
        res.status(400).json({ error: "scheduledAt noto‘g‘ri" });
        return;
      }
      patch.scheduledAt = d;
    }
    if (body.recurrence != null) patch.recurrence = body.recurrence === "daily" ? "daily" : "once";
    if (body.dailyTime !== undefined) patch.dailyTime = body.dailyTime ? String(body.dailyTime) : null;
    if (body.enabled != null) patch.enabled = Boolean(body.enabled);
    if (body.status != null) patch.status = String(body.status) as never;
    if (body.targetTelegramId != null) patch.targetTelegramId = String(body.targetTelegramId);
    if (body.targetName !== undefined) patch.targetName = body.targetName ? String(body.targetName) : null;
    if (body.targetUserId !== undefined) {
      patch.targetUserId = body.targetUserId != null ? Number(body.targetUserId) : null;
    }
    // Qayta yoqilsa pending
    if (patch.enabled === true && !patch.status) patch.status = "pending";
    const job = await updateAiCallJob(id, patch);
    if (!job) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json({ job });
  } catch (err) {
    console.error("PATCH /admin/ai-calls/jobs", err);
    res.status(500).json({ error: "Yangilashda xato" });
  }
});

router.delete("/admin/ai-calls/jobs/:id", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    const ok = await deleteAiCallJob(id);
    if (!ok) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /admin/ai-calls/jobs", err);
    res.status(500).json({ error: "O‘chirishda xato" });
  }
});

router.post("/admin/ai-calls/jobs/:id/run-now", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    const job = await getAiCallJob(id);
    if (!job) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    if (!telegramCallerConfigured()) {
      res.status(503).json({ error: "Userbot sozlanmagan" });
      return;
    }
    await updateAiCallJob(id, { status: "running", lastError: null });
    // Async ishlatish — javob tez qaytsin
    void runAiCallJob(id)
      .then(() => undefined)
      .catch((err) => console.error("run-now", err));
    res.json({ ok: true, message: "Qo‘ng‘iroq ishga tushdi" });
  } catch (err) {
    console.error("POST run-now", err);
    res.status(500).json({ error: "Ishga tushirishda xato" });
  }
});

router.get("/admin/ai-calls/logs", requireAuth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const jobId = req.query.jobId != null ? Number(req.query.jobId) : undefined;
    const logs = await listAiCallLogs(Number(req.query.limit) || 50, jobId);
    res.json({ logs });
  } catch (err) {
    console.error("GET /admin/ai-calls/logs", err);
    res.status(500).json({ error: "Loglar olishda xato" });
  }
});

export default router;
