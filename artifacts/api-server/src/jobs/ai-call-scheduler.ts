import { claimDueAiCallJobs } from "../lib/ai-call-jobs";
import { isAiCallBusy, runAiCallJob } from "../lib/ai-call-orchestrator";
import { logger } from "../lib/logger";
import { telegramCallerConfigured } from "../lib/telegram-voice-call";

const TICK_MS = 45_000;

export function startAiCallSchedulerJob(): void {
  if (process.env.AI_CALL_ENABLED === "0") {
    logger.info("AI call scheduler OFF (AI_CALL_ENABLED=0)");
    return;
  }

  const run = async () => {
    if (!telegramCallerConfigured()) return;
    if (isAiCallBusy()) return;
    try {
      const due = await claimDueAiCallJobs(1);
      for (const job of due) {
        logger.info({ jobId: job.id, target: job.targetTelegramId }, "AI call due — running");
        await runAiCallJob(job.id);
      }
    } catch (err) {
      logger.error({ err }, "AI call scheduler tick failed");
    }
  };

  setTimeout(() => {
    void run();
  }, 20_000);
  setInterval(() => {
    void run();
  }, TICK_MS);
  logger.info("AI call scheduler started (every 45s)");
}
