import { logger } from "../lib/logger";
import { runDisciplineScan } from "../lib/discipline";

const CYCLE_MS = 3 * 60 * 1000;

/** Jarima hodisalari: 3-martadan adminga PDF, 5-martada o‘sha kunga tizim bloki */
export function startDisciplineScanJob(): void {
  setTimeout(() => void runDisciplineScan(), 45_000);
  setInterval(() => void runDisciplineScan(), CYCLE_MS);
  logger.info("Discipline scan job started (every 3 minutes)");
}
