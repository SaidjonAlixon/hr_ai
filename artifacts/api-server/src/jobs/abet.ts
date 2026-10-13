import { rateWindow, sendPendingTodayMenu } from "../lib/abet";
import { logger } from "../lib/logger";

const TICK_MS = 5 * 60_000;
const SEND_FROM_HM = "08:00";

export function startAbetJob(): void {
  const run = () => {
    const win = rateWindow();
    if (win.now < SEND_FROM_HM || win.state === "closed") return;
    sendPendingTodayMenu().catch((err) => logger.error({ err }, "Abet menyusi yuborilmadi"));
  };
  setTimeout(run, 45_000);
  setInterval(run, TICK_MS);
  logger.info("Abet job started (oldindan tasdiqlangan menyu ertalab yuboriladi)");
}
