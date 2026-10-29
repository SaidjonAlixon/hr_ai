import { taskDigestTick } from "../lib/task-digest";
import { logger } from "../lib/logger";

const TICK_MS = 60_000;

export function startTaskDigestJob(): void {
  const run = () => taskDigestTick().catch((err) => logger.error({ err }, "Vazifalar eslatmasi yuborilmadi"));
  setTimeout(run, 45_000);
  setInterval(run, TICK_MS);
  logger.info("Task digest job started (10:00 va 15:00; bot yo‘q → guruh 10/15/18; tasdiq 09/12/18; admin PDF)");
}
