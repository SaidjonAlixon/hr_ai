import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, tasksTable, employeesTable } from "@workspace/db";
import { notifyUser } from "../lib/notify";
import { logger } from "../lib/logger";
import { parseReminderOffsetMs } from "../lib/task-schedule";

const FIVE_MIN_MS = 5 * 60 * 1000;

function readMeta(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

async function resolveAssigneeUserId(
  kind: string | null | undefined,
  assigneeId: number | null | undefined,
): Promise<number | null> {
  if (!assigneeId) return null;
  if (kind === "user") return assigneeId;
  if (kind === "employee") {
    const [row] = await db
      .select({ userId: employeesTable.userId })
      .from(employeesTable)
      .where(eq(employeesTable.id, assigneeId))
      .limit(1);
    return row?.userId ?? null;
  }
  return null;
}

function formatDueUz(due: Date): string {
  return due.toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Muddat oldidan (reminderOffset) bir marta eslatma yuboradi.
 * meta.reminderEnabled === true va status todo|in_progress.
 */
export async function sendTaskDueReminders(): Promise<number> {
  const now = new Date();

  const open = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        isNotNull(tasksTable.dueAt),
        inArray(tasksTable.status, ["todo", "in_progress"]),
        sql`COALESCE((${tasksTable.meta}->>'reminderEnabled')::boolean, false) = true`,
      ),
    );

  let sent = 0;

  for (const task of open) {
    if (!task.dueAt) continue;
    const meta = readMeta(task.meta);
    if (meta.reminderEnabled === false) continue;

    const offsetMs = parseReminderOffsetMs(
      typeof meta.reminderOffset === "string" ? meta.reminderOffset : "1d",
    );
    const remindAt = task.dueAt.getTime() - offsetMs;
    if (now.getTime() < remindAt) continue;

    const lastRaw =
      typeof meta.lastDueReminderAt === "string" ? meta.lastDueReminderAt : null;
    if (lastRaw) {
      const last = Date.parse(lastRaw);
      if (Number.isFinite(last) && last >= remindAt) continue;
    }

    const dueStr = formatDueUz(task.dueAt);
    const text = `⏰ Eslatma: «${task.title}» muddati yaqinlashmoqda (${dueStr})`;
    const linkUrl = `/vazifalar?task=${task.id}`;

    const assigneeUid = await resolveAssigneeUserId(
      task.assigneeKind,
      task.assigneeId,
    );
    const targets = new Set<number>();
    if (assigneeUid) targets.add(assigneeUid);
    if (task.createdById) targets.add(task.createdById);

    for (const userId of targets) {
      await notifyUser({
        userId,
        text,
        type: "task_due_reminder",
        linkUrl,
        title: "Vazifa eslatmasi",
        telegram: true,
      });
    }

    if (targets.size === 0) continue;

    await db
      .update(tasksTable)
      .set({
        meta: {
          ...meta,
          lastDueReminderAt: now.toISOString(),
        },
        updatedAt: now,
      })
      .where(eq(tasksTable.id, task.id));

    sent += 1;
  }

  if (sent > 0) {
    logger.info({ sent }, "Task due reminders sent");
  }
  return sent;
}

export function startTaskReminderJob(): void {
  sendTaskDueReminders().catch((err) =>
    logger.error({ err }, "Task reminder job failed"),
  );
  setInterval(() => {
    sendTaskDueReminders().catch((err) =>
      logger.error({ err }, "Task reminder job failed"),
    );
  }, FIVE_MIN_MS);
  logger.info("Task reminder job started (every 5 minutes)");
}
