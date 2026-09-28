import { logger } from "../lib/logger";
import { sweepDismissedUsers } from "../lib/dismiss-user";

const CYCLE_MS = 5 * 60 * 1000;

/** «Tugatilgan» foydalanuvchilarni Bo‘shatilganlarga ko‘chirish (serverless’da so‘rovlar ichida ham ishlaydi) */
export function startDismissedSweepJob(): void {
  const kick = () => {
    sweepDismissedUsers().catch((err) => logger.error({ err }, "Dismissed sweep job failed"));
  };
  setTimeout(kick, 10_000);
  setInterval(kick, CYCLE_MS);
  logger.info("Dismissed sweep job started (every 5 minutes)");
}
