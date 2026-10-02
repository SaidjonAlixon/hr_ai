import { logger } from "../lib/logger";
import { sweepZonePresence } from "../lib/zone-presence";

const TICK_MS = 30_000;

export function startZonePresenceJob() {
  const tick = async () => {
    try {
      const result = await sweepZonePresence();
      if (result.prompted || result.blocked) {
        logger.info(result, "zone presence sweep");
      }
    } catch (err) {
      logger.warn({ err }, "zone presence sweep failed");
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
}
