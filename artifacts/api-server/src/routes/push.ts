import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  countUserPushSubscriptions,
  getVapidPublicKey,
  removePushSubscription,
  savePushSubscription,
} from "../lib/web-push";

const router = Router();

router.get("/push/vapid-public-key", requireAuth, async (_req, res): Promise<void> => {
  try {
    const publicKey = await getVapidPublicKey();
    res.json({ publicKey });
  } catch (err) {
    console.error("GET /push/vapid-public-key", err);
    res.status(503).json({ error: "VAPID olinmadi" });
  }
});

router.get("/push/status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const count = await countUserPushSubscriptions(req.userId!);
    res.json({
      subscribed: count > 0,
      devices: count,
      httpsRequired: true,
      note:
        "iOS: Saytni Home Screen’ga qo‘shing (PWA). Android Chrome: ruxsat bering. Push HTTPS da ishlaydi.",
    });
  } catch (err) {
    console.error("GET /push/status", err);
    res.status(503).json({ error: "Status olinmadi" });
  }
});

router.post("/push/subscribe", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const body = req.body as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    const endpoint = String(body.endpoint || "").trim();
    const p256dh = String(body.keys?.p256dh || "").trim();
    const auth = String(body.keys?.auth || "").trim();
    if (!endpoint || !p256dh || !auth) {
      res.status(400).json({ error: "endpoint + keys.p256dh + keys.auth majburiy" });
      return;
    }
    await savePushSubscription({
      userId: req.userId!,
      endpoint,
      p256dh,
      auth,
      userAgent: req.get("user-agent"),
    });
    const devices = await countUserPushSubscriptions(req.userId!);
    res.json({ ok: true, devices });
  } catch (err) {
    console.error("POST /push/subscribe", err);
    res.status(503).json({ error: "Obuna saqlanmadi" });
  }
});

router.post("/push/unsubscribe", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const endpoint = String((req.body as { endpoint?: string })?.endpoint || "").trim();
    if (!endpoint) {
      res.status(400).json({ error: "endpoint majburiy" });
      return;
    }
    const ok = await removePushSubscription(endpoint, req.userId!);
    res.json({ ok });
  } catch (err) {
    console.error("POST /push/unsubscribe", err);
    res.status(503).json({ error: "Obuna o‘chirilmadi" });
  }
});

export default router;
