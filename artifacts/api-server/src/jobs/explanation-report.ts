import { explanationReportTick } from "../lib/explanation-letter-report";
import { logger } from "../lib/logger";

const TICK_MS = 60_000;

export function startExplanationReportJob(): void {
  const run = () => explanationReportTick().catch((err) => logger.error({ err }, "Tushuntirish xatlari hisoboti yuborilmadi"));
  setTimeout(run, 30_000);
  setInterval(run, TICK_MS);
  logger.info("Explanation letters report job started (har 3 kunda 10:00)");
}
