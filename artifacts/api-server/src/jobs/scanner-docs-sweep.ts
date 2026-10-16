import { logger } from "../lib/logger";
import { sweepExpiredScannerDocs } from "../routes/scanner-docs";

const CYCLE_MS = 5 * 60 * 1000;

/** Muddati o‘tgan skaner PDF larini bazadan va diskdan o‘chirish */
export function startScannerDocsSweepJob(): void {
  const kick = () => {
    sweepExpiredScannerDocs()
      .then((n) => {
        if (n > 0) logger.info({ n }, "Expired scanner docs purged");
      })
      .catch((err) => logger.error({ err }, "Scanner docs sweep failed"));
  };
  setTimeout(kick, 15_000);
  setInterval(kick, CYCLE_MS);
  logger.info("Scanner docs sweep job started (every 5 minutes)");
}
