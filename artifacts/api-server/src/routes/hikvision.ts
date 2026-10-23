import { Router, type Request, type Response } from "express";
import { desc, eq } from "drizzle-orm";
import { db, hikvisionEventLogTable, hikvisionPersonMapTable, usersTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  parseHikvisionPayload,
  processHikvisionEvent,
  upsertHikvisionMapping,
} from "../lib/hikvision-attendance";
import { parseHikvisionHttpBody } from "../lib/hikvision-payload";
import { ensureHikvisionSchema } from "../lib/ensure-schema";
import { syncHikvisionDayFromDevice } from "../lib/hikvision-device-sync";
import { hikvisionDeviceConfigured } from "../lib/hikvision-device-client";
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

function eventFromRequest(req: Request) {
  const ct = String(req.get("content-type") || "");
  const parsedBody = parseHikvisionHttpBody(req.body, ct);
  const fromJson = parsedBody.eventJson ? parseHikvisionPayload(parsedBody.eventJson) : null;
  const fromXml = parsedBody.xmlText ? parseHikvisionPayload(parsedBody.xmlText) : null;
  const fromRaw =
    !fromJson && !fromXml
      ? parseHikvisionPayload(
          typeof req.body === "string" || Buffer.isBuffer(req.body)
            ? Buffer.isBuffer(req.body)
              ? req.body.toString("utf8")
              : req.body
            : req.body,
        )
      : null;
  const ev = fromJson || fromXml || fromRaw;
  if (!ev) return null;
  if (parsedBody.pictureDataUrl) {
    ev.pictureDataUrl = parsedBody.pictureDataUrl;
  }
  return ev;
}

/** Qurilma HTTP notification — yuz rasmi + event */
router.post("/hikvision/event", async (req: Request, res: Response): Promise<void> => {
  try {
    if (!webhookSecretOk(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = eventFromRequest(req);
    if (!parsed) {
      res.status(200).json({ ok: true, skipped: true, reason: "empty" });
      return;
    }

    /**
     * Qurilma HTTP timeout (~3–5s). AI/DB sekin bo‘lsa event navbati yo‘qolardi.
     * Darhol 200 — punch fonida.
     */
    res.status(200).json({ ok: true, accepted: true, employeeNo: parsed.employeeNo });

    void (async () => {
      await ensureHikvisionSchema().catch(() => undefined);
      const result = await processHikvisionEvent(parsed);
      logger.info(
        {
          employeeNo: parsed.employeeNo,
          name: parsed.name,
          hasPicture: Boolean(parsed.pictureDataUrl),
          action: result.action,
          matchMode: result.matchMode,
          ok: result.ok,
          skipped: result.skipped,
          reason: result.reason,
        },
        "Hikvision event",
      );
    })().catch((err) => logger.error({ err }, "POST /hikvision/event async"));
  } catch (err) {
    logger.error({ err }, "POST /hikvision/event");
    if (!res.headersSent) {
      res.status(200).json({ ok: false, error: "server_error" });
    }
  }
});

router.get("/hikvision/health", async (_req, res): Promise<void> => {
  const configured = Boolean(String(process.env.HIKVISION_WEBHOOK_SECRET || "").trim());
  res.json({
    ok: true,
    configured,
    faceCompare: true,
    devicePull: hikvisionDeviceConfigured(),
    hint: configured
      ? "Webhook: qurilma yuzi HR Pro Face ID bilan solishtiriladi → Keldim/Ketdim"
      : "HIKVISION_WEBHOOK_SECRET .env da yo‘q",
  });
});

/**
 * Qurilmadan tanlangan kun Keldim/Ketdim → ofis xodimlari (kirill/lotin ism) → HR Pro baza.
 * Davomat sahifasidagi «Face ID yangilash» tugmasi — faqat admin.
 */
router.post("/hikvision/sync-day", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = String(req.userRole || "").trim().toLowerCase();
  if (role !== "admin") {
    res.status(403).json({ error: "Faqat admin Face ID yangilashi mumkin" });
    return;
  }
  try {
    const workDate = String(req.body?.date || req.body?.workDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      res.status(400).json({ error: "date (YYYY-MM-DD) majburiy" });
      return;
    }
    const result = await syncHikvisionDayFromDevice(workDate);
    if (!result.ok) {
      res.status(503).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /hikvision/sync-day");
    res.status(503).json({ error: "Face ID sync amalga oshmadi" });
  }
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

/** Qo‘lda sinov — rasm (data URL) + ixtiyoriy employeeNo */
router.post("/hikvision/test-punch", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireHikAdmin(req, res)) return;
  try {
    const employeeNo = String(req.body?.employeeNo || "").trim();
    const name = String(req.body?.name || "").trim();
    const attendanceStatus = String(req.body?.attendanceStatus || "checkIn").trim();
    const label = String(req.body?.label || "KELDIM").trim();
    const pictureDataUrl = String(req.body?.pictureDataUrl || req.body?.snapshot || "").trim();
    if (!pictureDataUrl && !employeeNo) {
      res.status(400).json({ error: "pictureDataUrl (Face ID rasm) yoki employeeNo kerak" });
      return;
    }
    const result = await processHikvisionEvent({
      employeeNo: employeeNo || undefined,
      name: name || undefined,
      attendanceStatus,
      label,
      pictureDataUrl: pictureDataUrl.startsWith("data:image/") ? pictureDataUrl : undefined,
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
