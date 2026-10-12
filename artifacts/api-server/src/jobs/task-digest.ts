import { taskDigestTick } from "../lib/task-digest";
import { logger } from "../lib/logger";

const TICK_MS = 60_000;

export function startTaskDigestJob(): void {
  const run = () => taskDigestTick().catch((err) => logger.error({ err }, "Vazifalar eslatmasi yuborilmadi"));
  setTimeout(run, 45_000);
  setInterval(run, TICK_MS);
  logger.info("Task digest job started (10:00 va 17:00; tasdiqlash eslatmasi 09/12/15/18)");
}
