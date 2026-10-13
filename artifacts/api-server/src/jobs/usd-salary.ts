import { currentMonthKey } from "../lib/kpi-payroll";
import { syncUsdSalaries } from "../lib/usd-salary";
import { logger } from "../lib/logger";

const TICK_MS = 60 * 60_000;

export function startUsdSalaryJob(): void {
  const run = () =>
    syncUsdSalaries(currentMonthKey())
      .then((r) => {
        if (r.updated) logger.info({ rate: r.rate, updated: r.updated }, "Dollar fiksalar kurs bo‘yicha yangilandi");
      })
      .catch((err) => logger.error({ err }, "Dollar fiksalar yangilanmadi"));
  setTimeout(run, 30_000);
  setInterval(run, TICK_MS);
  logger.info("USD salary job started (har soatda CBU kursi)");
}
