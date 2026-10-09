import { conferenceTick } from "../lib/conferences";
import { logger } from "../lib/logger";

const TICK_MS = 60_000;

export function startConferenceReminderJob(): void {
  const run = () => conferenceTick().catch((err) => logger.error({ err }, "Conference reminder job failed"));
  setTimeout(run, 15_000);
  setInterval(run, TICK_MS);
  logger.info("Conference reminder job started (every minute)");
}
