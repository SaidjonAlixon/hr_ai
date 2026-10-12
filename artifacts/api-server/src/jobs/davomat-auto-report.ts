import { autoReportTick } from "../lib/davomat-auto-report";
import { logger } from "../lib/logger";

const TICK_MS = 60_000;

export function startDavomatAutoReportJob(): void {
  const run = () => autoReportTick().catch((err) => logger.error({ err }, "Davomat auto-report job failed"));
  setTimeout(run, 20_000);
  setInterval(run, TICK_MS);
  logger.info("Davomat auto-report job started (every minute)");
}
