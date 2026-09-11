import { Router, type IRouter, type Response, type Request } from "express";
import {
  filialDeleteWebhook,
  filialGetMe,
  filialGetWebhookInfo,
  filialPublicBaseUrl,
  filialSetMyCommands,
  filialSetMyDescription,
  filialSetMyName,
  filialSetMyShortDescription,
  filialSetWebhook,
  isFilialBotConfigured,
  shouldFilialUsePolling,
  verifyFilialWebhookSecret,
  type FilialTelegramUpdate,
} from "../lib/telegram-filial";
import { handleFilialBotUpdate } from "../lib/filial-bot-handler";
import { loadFilialBranches } from "../lib/filial-bot-data";

const router: IRouter = Router();

router.post("/telegram-filial/webhook", async (req: Request, res: Response): Promise<void> => {
  if (!isFilialBotConfigured()) {
    res.status(503).json({ error: "TELEGRAM_FILIAL_BOT_TOKEN sozlanmagan" });
    return;
  }
  if (!verifyFilialWebhookSecret(req.header("x-telegram-bot-api-secret-token") || undefined)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Tez 200 — Telegram takrorlamasligi uchun
  res.json({ ok: true });
  try {
    await handleFilialBotUpdate(req.body as FilialTelegramUpdate);
  } catch (err) {
    console.error("telegram-filial webhook:", err);
  }
});

router.get("/telegram-filial/status", async (_req: Request, res: Response): Promise<void> => {
  if (!isFilialBotConfigured()) {
    res.json({ configured: false, polling: false });
    return;
  }
  let me: unknown = null;
  let webhook: unknown = null;
  let branchCount = 0;
  try {
    me = await filialGetMe();
  } catch (e) {
    me = { error: (e as Error).message };
  }
  try {
    webhook = await filialGetWebhookInfo();
  } catch (e) {
    webhook = { error: (e as Error).message };
  }
  try {
    branchCount = (await loadFilialBranches()).length;
  } catch {
    /* ignore */
  }
  res.json({
    configured: true,
    pollingPreferred: shouldFilialUsePolling(),
    me,
    webhook,
    branchCount,
  });
});

/** Webhook o‘rnatish — faqat filial bot tokeniga; HR botga tegmaydi */
router.post("/telegram-filial/setup", async (req: Request, res: Response): Promise<void> => {
  const setupSecret =
    process.env.TELEGRAM_FILIAL_SETUP_SECRET?.trim() ||
    process.env.TELEGRAM_SETUP_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  const auth = req.header("x-setup-secret") || req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!setupSecret || auth !== setupSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isFilialBotConfigured()) {
    res.status(503).json({ error: "TELEGRAM_FILIAL_BOT_TOKEN sozlanmagan" });
    return;
  }

  try {
    await filialSetMyCommands([
      { command: "start", description: "Filiallar ro‘yxati" },
      { command: "filiallar", description: "Filiallarni ko‘rish" },
      { command: "yordam", description: "Yordam" },
    ]);
    try {
      await filialSetMyName("Vaksina lokatsiya");
      await filialSetMyShortDescription("Filial lokatsiyasi, telefon va bog‘lanish vaqti");
      await filialSetMyDescription(
        "Vaksina lokatsiya — filialni tanlang, lokatsiya, mudir/koordinator va telefon raqamlarini ko‘ring.",
      );
    } catch {
      /* nom ixtiyoriy */
    }

    if (shouldFilialUsePolling()) {
      await filialDeleteWebhook();
      res.json({
        ok: true,
        mode: "polling",
        note: "Lokal URL — polling ishlatiladi. PUBLIC_APP_URL https bo‘lsa webhook qo‘ying.",
        me: await filialGetMe(),
      });
      return;
    }

    const base = filialPublicBaseUrl();
    if (!base) {
      res.status(400).json({ error: "PUBLIC_APP_URL kerak (https)" });
      return;
    }
    const webhookUrl = `${base}/api/telegram-filial/webhook`;
    const whSecret = process.env.TELEGRAM_FILIAL_WEBHOOK_SECRET?.trim();
    await filialSetWebhook(webhookUrl, whSecret);
    res.json({
      ok: true,
      mode: "webhook",
      webhookUrl,
      me: await filialGetMe(),
      info: await filialGetWebhookInfo(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
