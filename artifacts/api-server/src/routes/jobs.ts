import { Router, type IRouter } from "express";
import { runDavomatReminderCycle } from "../jobs/davomat-reminders";
import { sendVacancyReminders } from "../jobs/vacancy-reminders";
import { sendTaskDueReminders } from "../jobs/task-reminders";
import { sendCoordinatorPresenceReminders } from "../jobs/coordinator-presence";

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

router.get("/jobs/task-reminders", async (req, res): Promise<void> => {
  if (!authorizeCron(req, res)) return;
  try {
    const sent = await sendTaskDueReminders();
    res.json({ ok: true, sent });
  } catch (err) {
    req.log?.error({ err }, "Task reminder cron failed");
    res.status(500).json({ error: "Task reminder job failed" });
  }
});

router.get("/jobs/coordinator-presence", async (req, res): Promise<void> => {
  if (!authorizeCron(req, res)) return;
  try {
    const result = await sendCoordinatorPresenceReminders();
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log?.error({ err }, "Coordinator presence cron failed");
    res.status(500).json({ error: "Coordinator presence job failed" });
  }
});

router.get("/jobs/filial-recruiter-monitor", async (req, res): Promise<void> => {
  if (!authorizeCron(req, res)) return;
  try {
    const { sendRecruiterStaffingMonitor } = await import("../jobs/filial-recruiter-monitor");
    const result = await sendRecruiterStaffingMonitor({ reason: "vercel_cron" });
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log?.error({ err }, "Filial recruiter monitor cron failed");
    res.status(500).json({ error: "Filial recruiter monitor job failed" });
  }
});

export default router;
