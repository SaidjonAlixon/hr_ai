import { explanationReportTick } from "../lib/explanation-letter-report";
import { logger } from "../lib/logger";

const TICK_MS = 60_000;

export function startExplanationReportJob(): void {
  // Tushuntirish xatlari guruhga yuborish o‘chirilgan — job ishga tushirilmaydi
  void explanationReportTick;
  void TICK_MS;
  logger.info("Explanation letters report job OFF (guruhga yuborish o‘chirilgan)");
}
