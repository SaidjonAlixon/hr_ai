import { rateWindow, remindCooksIfNeeded, sendPendingTodayMenu } from "../lib/abet";
import { logger } from "../lib/logger";

const TICK_MS = 2 * 60_000;
const SEND_FROM_HM = "08:00";

export function startAbetJob(): void {
  const run = () => {
    const win = rateWindow();
    if (win.now < SEND_FROM_HM || win.state === "closed") return;
    sendPendingTodayMenu().catch((err) => logger.error({ err }, "Abet menyusi yuborilmadi"));
    remindCooksIfNeeded().catch((err) => logger.error({ err }, "Oshpazlarga abet eslatmasi yuborilmadi"));
  };
  setTimeout(run, 45_000);
  setInterval(run, TICK_MS);
  logger.info("Abet job started (08:00 oldindan tasdiqlangan menyu, 09:00/10:30/11:00 oshpaz eslatmalari)");
}
