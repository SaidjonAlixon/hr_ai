import { Router, type IRouter } from "express";
import { runDavomatReminderCycle } from "../jobs/davomat-reminders";
import { sendVacancyReminders } from "../jobs/vacancy-reminders";

const router: IRouter = Router();

function authorizeCron(req: { headers: { authorization?: string } }, res: { status: (n: number) => { json: (b: unknown) => void } }): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return false;
    }
  }
  return true;
}

/**
 * Vercel Cron: GET /api/jobs/vacancy-reminders
 * Authorization: Bearer $CRON_SECRET
 */
router.get("/jobs/vacancy-reminders", async (req, res): Promise<void> => {
  if (!authorizeCron(req, res)) return;

  try {
    const sent = await sendVacancyReminders();
    res.json({ ok: true, sent });
  } catch (err) {
    req.log?.error({ err }, "Vacancy reminder cron failed");
    res.status(500).json({ error: "Reminder job failed" });
  }
});

/**
 * Vercel Cron: GET /api/jobs/davomat-reminders
 * Authorization: Bearer $CRON_SECRET
 */
router.get("/jobs/davomat-reminders", async (req, res): Promise<void> => {
  if (!authorizeCron(req, res)) return;

  try {
    await runDavomatReminderCycle();
    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "Davomat reminder cron failed");
    res.status(500).json({ error: "Davomat reminder job failed" });
  }
});

export default router;
