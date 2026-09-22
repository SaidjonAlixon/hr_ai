import "./load-env";
import app from "./app";
import { logger } from "./lib/logger";
import { startVacancyReminderJob } from "./jobs/vacancy-reminders";
import { startDavomatReminderJob } from "./jobs/davomat-reminders";
import { startTaskReminderJob } from "./jobs/task-reminders";
import { startCoordinatorPresenceJob } from "./jobs/coordinator-presence";
import { startReviziyaAlertJob } from "./jobs/reviziya-alerts";
import { startNotifTestJob } from "./jobs/notif-test";
import { startFilialBotPollingJob } from "./jobs/filial-bot-polling";
import { startFilialRecruiterMonitorJob } from "./jobs/filial-recruiter-monitor";
import { startJavobOlishEscalateJob } from "./jobs/javob-olish-escalate";

/** Vercel sets VERCEL=1 — serverless uses exported app, no listen. */
const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true";

if (!isVercel) {
  const rawPort = process.env["PORT"];

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startVacancyReminderJob();
    startDavomatReminderJob();
    startTaskReminderJob();
    startCoordinatorPresenceJob();
    startReviziyaAlertJob();
    startNotifTestJob();
    startFilialBotPollingJob();
    startFilialRecruiterMonitorJob();
    startJavobOlishEscalateJob();
  });
}

export default app;
