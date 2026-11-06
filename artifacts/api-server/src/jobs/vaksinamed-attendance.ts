import { isVmAttendanceConfigured, monthsToSync, syncVaksinamedAttendance } from "../lib/vaksinamed-attendance";
import { logger } from "../lib/logger";

const TICK_MS = 15 * 60_000;

export function startVaksinamedAttendanceJob(): void {
  if (!isVmAttendanceConfigured()) {
    logger.info("VaksinaMed davomat sinxronizatsiyasi o‘chiq (VAKSINAMED_ATTENDANCE_MAP yo‘q)");
    return;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (const month of monthsToSync()) await syncVaksinamedAttendance(month);
    } catch (err) {
      logger.error({ err }, "VaksinaMed davomat sinxronlanmadi");
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), 60_000);
  setInterval(() => void run(), TICK_MS);
  logger.info("VaksinaMed davomat sinxronizatsiyasi ishga tushdi (har 15 daqiqa)");
}
