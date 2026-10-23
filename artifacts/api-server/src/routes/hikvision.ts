import { Router, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db, hikvisionEventLogTable, hikvisionPersonMapTable, usersTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  parseHikvisionPayload,
  processHikvisionEvent,
  upsertHikvisionMapping,
} from "../lib/hikvision-attendance";
import { ensureHikvisionSchema } from "../lib/ensure-schema";
import { logger } from "../lib/logger";
import { canManageUsers, hasFullPlatformAccess } from "../lib/roles";

const router = Router();

function requireHikAdmin(req: AuthRequest, res: Response): boolean {
  const role = req.userRole || "";
  if (
    canManageUsers(role) ||
    hasFullPlatformAccess(role) ||
    role === "admin" ||
    role === "hr" ||
    role === "hr_direktor" ||
    role === "director"
  ) {
    return true;
  }
  res.status(403).json({ error: "Ruxsat yo‘q" });
  return false;
}

function webhookSecretOk(req: Request): boolean {
  const expected = String(process.env.HIKVISION_WEBHOOK_SECRET || "").trim();
  if (!expected) return false;
  const q = String(req.query.token || req.query.secret || "").trim();
  const h = String(req.get("x-hikvision-token") || req.get("x-webhook-token") || "").trim();
  const auth = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return q === expected || h === expected || auth === expected;
}

/** Qurilma HTTP notification — auth token query/header orqali */
router.post("/hikvision/event", async (req: Request, res: Response): Promise<void> => {
  try {
    if (!webhookSecretOk(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    await ensureHikvisionSchema().catch(() => undefined);

    const rawBody = typeof req.body === "string" && req.body.trim() ? req.body : req.body;
    const parsed =
      parseHikvisionPayload(rawBody) ||
      parseHikvisionPayload(req.body) ||
      (typeof rawBody === "object" && rawBody ? parseHikvisionPayload(rawBody) : null);

    if (!parsed) {
      res.status(200).json({ ok: true, skipped: true, reason: "empty" });
      return;
    }

    const result = await processHikvisionEvent(parsed);
    logger.info(
      {
        employeeNo: parsed.employeeNo,
        name: parsed.name,
        action: result.action,
        ok: result.ok,
        skipped: result.skipped,
        reason: result.reason,
      },
      "Hikvision event",
    );
    res.status(200).json(result);
  } catch (err) {
    logger.error({ err }, "POST /hikvision/event");
    res.status(200).json({ ok: false, error: "server_error" });
  }
});

router.get("/hikvision/health", async (_req, res): Promise<void> => {
  const configured = Boolean(String(process.env.HIKVISION_WEBHOOK_SECRET || "").trim());
  res.json({
    ok: true,
    configured,
    hint: configured
      ? "Webhook tayyor. Qurilmada HTTP Host → /api/hikvision/event?token=…"
      : "HIKVISION_WEBHOOK_SECRET .env da yo‘q",
  });
});

router.get("/hikvision/maps", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireHikAdmin(req, res)) return;
  try {
    await ensureHikvisionSchema().catch(() => undefined);
    const rows = await db
      .select({
        id: hikvisionPersonMapTable.id,
        employeeNo: hikvisionPersonMapTable.employeeNo,
        userId: hikvisionPersonMapTable.userId,
        employeeId: hikvisionPersonMapTable.employeeId,
        deviceName: hikvisionPersonMapTable.deviceName,
        matchedBy: hikvisionPersonMapTable.matchedBy,
        userName: usersTable.fullName,
        updatedAt: hikvisionPersonMapTable.updatedAt,
      })
      .from(hikvisionPersonMapTable)
      .leftJoin(usersTable, eq(usersTable.id, hikvisionPersonMapTable.userId))
      .orderBy(hikvisionPersonMapTable.employeeNo);
    res.json({ items: rows });
  } catch (err) {
    logger.error({ err }, "GET /hikvision/maps");
    res.status(503).json({ error: "Ro‘yxat olinmadi" });
  }
});

router.post("/hikvision/maps", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireHikAdmin(req, res)) return;
  try {
    const employeeNo = String(req.body?.employeeNo || "").trim();
    const userId = Number(req.body?.userId);
    const deviceName = String(req.body?.deviceName || "").trim() || undefined;
    if (!employeeNo || !Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ error: "employeeNo va userId majburiy" });
      return;
    }
    await upsertHikvisionMapping({ employeeNo, userId, deviceName });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "POST /hikvision/maps");
    res.status(503).json({ error: "Saqlanmadi" });
  }
});

router.get("/hikvision/events", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireHikAdmin(req, res)) return;
  try {
    await ensureHikvisionSchema().catch(() => undefined);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const rows = await db
      .select()
      .from(hikvisionEventLogTable)
      .orderBy(desc(hikvisionEventLogTable.createdAt))
      .limit(limit);
    res.json({ items: rows });
  } catch (err) {
    logger.error({ err }, "GET /hikvision/events");
    res.status(503).json({ error: "Eventlar olinmadi" });
  }
});

/** Qo‘lda sinov — admin */
router.post("/hikvision/test-punch", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireHikAdmin(req, res)) return;
  try {
    const employeeNo = String(req.body?.employeeNo || "").trim();
    const name = String(req.body?.name || "").trim();
    const attendanceStatus = String(req.body?.attendanceStatus || "checkIn").trim();
    const label = String(req.body?.label || "KELDIM").trim();
    if (!employeeNo) {
      res.status(400).json({ error: "employeeNo majburiy" });
      return;
    }
    const result = await processHikvisionEvent({
      employeeNo,
      name: name || undefined,
      attendanceStatus,
      label,
      serialNo: Date.now() % 1_000_000_000,
      time: new Date().toISOString(),
      majorEventType: 5,
      subEventType: 75,
      currentVerifyMode: "face",
      deviceSerial: "manual-test",
      raw: { test: true, by: req.userId },
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /hikvision/test-punch");
    res.status(503).json({ error: "Sinov amalga oshmadi" });
  }
});

export default router;
