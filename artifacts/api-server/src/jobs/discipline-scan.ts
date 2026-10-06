import { logger } from "../lib/logger";
import { DIGEST_HOURS, runDisciplineDigest, runDisciplineScan } from "../lib/discipline";

const CYCLE_MS = 3 * 60 * 1000;

async function cycle() {
  await runDisciplineScan();
  await runDisciplineDigest();
}

/** Jarima hodisalari va 5-martada bloklash — har 3 daqiqada; hisobot PDF — har 4 soatda */
export function startDisciplineScanJob(): void {
  setTimeout(() => void cycle(), 45_000);
  setInterval(() => void cycle(), CYCLE_MS);
  logger.info({ digestHours: DIGEST_HOURS }, "Discipline scan job started (scan every 3 minutes, report every 4 hours)");
}
