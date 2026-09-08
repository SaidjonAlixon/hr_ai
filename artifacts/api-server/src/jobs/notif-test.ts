import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { notifyUser } from "../lib/notify";
import { isTelegramConfigured } from "../lib/telegram";
import { logger } from "../lib/logger";
import { countUserPushSubscriptions } from "../lib/web-push";

export type NotifTestJob = {
  id: string;
  userId: number;
  createdById: number;
  text: string;
  delayMinutes: number;
  sendAtMs: number;
  createdAtMs: number;
};

const jobs = new Map<string, NotifTestJob>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function newId(): string {
  return `nt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function deliver(job: NotifTestJob): Promise<void> {
  const waitedMin = Math.round((Date.now() - job.createdAtMs) / 60_000);
  const text =
    job.text ||
    `TEST bildirishnoma: ${job.delayMinutes} daqiqadan keyin yuborildi (kutildi ~${waitedMin} daq). ` +
      `Agar bu xabar telefonda ko‘rinsa — kanal ishlayapti.`;

  await notifyUser({
    userId: job.userId,
    text,
    type: "notif_test",
    linkUrl: "/admin/test",
    telegram: true,
  });
  logger.info(
    { jobId: job.id, userId: job.userId, delayMinutes: job.delayMinutes },
    "Notif test delivered",
  );
}

function clearTimer(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

export function listNotifTestJobs(createdById?: number): NotifTestJob[] {
  const now = Date.now();
  return [...jobs.values()]
    .filter((j) => (createdById == null ? true : j.createdById === createdById))
    .filter((j) => j.sendAtMs > now - 60_000)
    .sort((a, b) => a.sendAtMs - b.sendAtMs);
}

export function cancelNotifTestJob(id: string, createdById: number): boolean {
  const job = jobs.get(id);
  if (!job || job.createdById !== createdById) return false;
  clearTimer(id);
  jobs.delete(id);
  return true;
}

export async function sendNotifTestNow(opts: {
  userId: number;
  createdById: number;
  text?: string;
}): Promise<{ ok: true; telegramConfigured: boolean; telegramLinked: boolean }> {
  const text =
    opts.text?.trim() ||
    `TEST bildirishnoma (hozir): ${new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}. Telefonda SMS kabi ko‘rinishi kerak.`;

  await notifyUser({
    userId: opts.userId,
    text,
    type: "notif_test",
    linkUrl: "/admin/test",
    telegram: true,
  });

  const telegramConfigured = isTelegramConfigured();
  let telegramLinked = false;
  if (telegramConfigured) {
    const [u] = await db
      .select({ telegramId: usersTable.telegramId })
      .from(usersTable)
      .where(eq(usersTable.id, opts.userId))
      .limit(1);
    telegramLinked = Boolean(u?.telegramId);
  }
  return { ok: true, telegramConfigured, telegramLinked };
}

export async function scheduleNotifTest(opts: {
  userId: number;
  createdById: number;
  delayMinutes: number;
  text?: string;
}): Promise<NotifTestJob> {
  const delayMinutes = Math.min(120, Math.max(1, Math.round(opts.delayMinutes)));
  const createdAtMs = Date.now();
  const sendAtMs = createdAtMs + delayMinutes * 60_000;
  const id = newId();
  const job: NotifTestJob = {
    id,
    userId: opts.userId,
    createdById: opts.createdById,
    text: (opts.text || "").trim(),
    delayMinutes,
    sendAtMs,
    createdAtMs,
  };
  jobs.set(id, job);

  const waitMs = Math.max(0, sendAtMs - Date.now());
  const timer = setTimeout(() => {
    void (async () => {
      const current = jobs.get(id);
      if (!current) return;
      jobs.delete(id);
      timers.delete(id);
      try {
        await deliver(current);
      } catch (err) {
        logger.error({ err, jobId: id }, "Notif test deliver failed");
      }
    })();
  }, waitMs);
  timers.set(id, timer);

  logger.info({ jobId: id, delayMinutes, sendAtMs }, "Notif test scheduled");
  return job;
}

/** Muddat o‘tganlarni qayta yuborish (server restart / drift) */
export async function processDueNotifTests(): Promise<number> {
  const now = Date.now();
  let n = 0;
  for (const [id, job] of [...jobs.entries()]) {
    if (job.sendAtMs > now) continue;
    clearTimer(id);
    jobs.delete(id);
    try {
      await deliver(job);
      n += 1;
    } catch (err) {
      logger.error({ err, jobId: id }, "Notif test due flush failed");
    }
  }
  return n;
}

export function startNotifTestJob(): void {
  setInterval(() => {
    processDueNotifTests().catch((err) =>
      logger.error({ err }, "Notif test sweep failed"),
    );
  }, 15_000);
  logger.info("Notif test job started (every 15s)");
}

export async function notifTestStatus(userId: number): Promise<{
  telegramConfigured: boolean;
  telegramLinked: boolean;
  pushDevices: number;
  pending: number;
}> {
  const telegramConfigured = isTelegramConfigured();
  let telegramLinked = false;
  if (telegramConfigured) {
    const [u] = await db
      .select({ telegramId: usersTable.telegramId })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    telegramLinked = Boolean(u?.telegramId);
  }
  const pushDevices = await countUserPushSubscriptions(userId);
  return {
    telegramConfigured,
    telegramLinked,
    pushDevices,
    pending: listNotifTestJobs(userId).length,
  };
}
