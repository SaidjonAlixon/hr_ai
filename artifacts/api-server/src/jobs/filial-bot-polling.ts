import { logger } from "../lib/logger";
import { handleFilialBotUpdate } from "../lib/filial-bot-handler";
import {
  filialDeleteWebhook,
  filialGetUpdates,
  filialSetMyCommands,
  filialSetMyDescription,
  filialSetMyName,
  filialSetMyShortDescription,
  isFilialBotConfigured,
  shouldFilialUsePolling,
} from "../lib/telegram-filial";

let started = false;
let offset = 0;
let running = false;

async function pollOnce() {
  if (running) return;
  running = true;
  try {
    const updates = await filialGetUpdates(offset || undefined, 25);
    for (const u of updates) {
      offset = u.update_id + 1;
      await handleFilialBotUpdate(u);
    }
  } catch (err) {
    logger.warn({ err }, "Vaksina lokatsiya polling xato");
    await new Promise((r) => setTimeout(r, 3000));
  } finally {
    running = false;
  }
}

async function applyBotProfile() {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["setMyName", () => filialSetMyName("Vaksina lokatsiya")],
    [
      "setMyShortDescription",
      () => filialSetMyShortDescription("Filial lokatsiyasi, telefon va bog‘lanish vaqti"),
    ],
    [
      "setMyDescription",
      () =>
        filialSetMyDescription(
          "Vaksina lokatsiya — filialni tanlang, lokatsiya, mudir/koordinator va telefon raqamlarini ko‘ring.",
        ),
    ],
    [
      "setMyCommands",
      () =>
        filialSetMyCommands([
          { command: "start", description: "Filiallar ro‘yxati" },
          { command: "filiallar", description: "Filiallarni ko‘rish" },
          { command: "yordam", description: "Yordam" },
          { command: "yaqin", description: "Eng yaqin 3 ta filial" },
          { command: "admin", description: "Admin panel" },
          { command: "id", description: "Telegram ID" },
        ]),
    ],
  ];
  for (const [label, fn] of steps) {
    try {
      await fn();
    } catch (err) {
      logger.warn({ err, step: label }, "Vaksina lokatsiya profil sozlamasi o‘tmadi");
    }
  }
}

export function startFilialBotPollingJob() {
  if (started) return;
  if (!isFilialBotConfigured()) {
    logger.info("Vaksina lokatsiya: TELEGRAM_FILIAL_BOT_TOKEN yo‘q — o‘chirilgan");
    return;
  }
  if (!shouldFilialUsePolling()) {
    logger.info("Vaksina lokatsiya: webhook rejimi (polling yo‘q)");
    return;
  }

  started = true;
  void (async () => {
    try {
      await filialDeleteWebhook();
    } catch (err) {
      logger.warn({ err }, "Vaksina lokatsiya deleteWebhook");
    }
    await applyBotProfile();
    logger.info("Vaksina lokatsiya polling boshlandi (HR botga tegmaydi)");
    for (;;) {
      await pollOnce();
    }
  })();
}
