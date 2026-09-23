/**
 * AyTi ariza → Topshiriq bog‘lash.
 * Rahbar qabul qilganda task yaratiladi (muddat = qabul + 2 kun).
 * Yopilganda / tasdiqlanganda task «bajarildi»ga o‘tadi.
 */
import { eq } from "drizzle-orm";
import { db, opsTicketsTable, tasksTable } from "@workspace/db";
import { notifyUser } from "./notify";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

export function opsTicketDueAt(acceptedAt: Date): Date {
  return new Date(acceptedAt.getTime() + TWO_DAYS_MS);
}

type TicketRow = typeof opsTicketsTable.$inferSelect;

/** Ariza qabul qilinganda topshiriq yaratish (bir marta) */
export async function ensureTaskForOpsTicket(opts: {
  ticket: TicketRow;
  assigneeUserId: number;
  acceptedById: number;
  acceptedAt: Date;
}): Promise<number | null> {
  const { ticket, assigneeUserId, acceptedById, acceptedAt } = opts;
  if (ticket.taskId) return ticket.taskId;
  if (!assigneeUserId || !acceptedById) return null;

  const dueAt = opsTicketDueAt(acceptedAt);
  const descParts = [
    `AyTi ariza: ${ticket.ticketNo}`,
    ticket.branchName ? `Filial / joy: ${ticket.branchName}` : null,
    ticket.description?.trim() || null,
    `Muddat: qabul qilingan vaqtdan +2 kun (tizim).`,
  ].filter(Boolean);

  const [task] = await db
    .insert(tasksTable)
    .values({
      title: `AyTi: ${ticket.title}`.slice(0, 200),
      description: descParts.join("\n"),
      status: "in_progress",
      priority: ticket.priority || "normal",
      dueAt,
      assigneeKind: "user",
      assigneeId: assigneeUserId,
      createdById: acceptedById,
      acceptedAt,
      meta: {
        source: "ops_ticket",
        opsTicketId: ticket.id,
        opsTicketNo: ticket.ticketNo,
        taskType: "other",
        branchOrDept: ticket.branchName || "AyTi",
      },
    })
    .returning();

  await db
    .update(opsTicketsTable)
    .set({ taskId: task.id, updatedAt: new Date() })
    .where(eq(opsTicketsTable.id, ticket.id));

  if (assigneeUserId !== acceptedById) {
    await notifyUser({
      userId: assigneeUserId,
      text: `Sizga AyTi topshirig‘i: «${ticket.title}» (${ticket.ticketNo}) — muddat 2 kun`,
      type: "ops_ticket",
      linkUrl: "/vazifalar",
    });
  } else {
    await notifyUser({
      userId: assigneeUserId,
      text: `AyTi ariza qabul qilindi → topshiriq ochildi: «${ticket.title}» (${ticket.ticketNo})`,
      type: "ops_ticket",
      linkUrl: "/vazifalar",
    });
  }

  return task.id;
}

/** Ariza yopilganda / tasdiqlanganda bog‘langan topshiriqni bajarildi qilish */
export async function completeOpsLinkedTask(
  taskId: number | null | undefined,
  note?: string,
): Promise<void> {
  if (!taskId) return;
  const [existing] = await db
    .select({
      id: tasksTable.id,
      status: tasksTable.status,
      completedAt: tasksTable.completedAt,
    })
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);
  if (!existing) return;
  if (
    existing.status === "done" ||
    existing.status === "verified" ||
    existing.status === "cancelled"
  ) {
    return;
  }
  const now = new Date();
  await db
    .update(tasksTable)
    .set({
      status: "done",
      completedAt: existing.completedAt || now,
      completionNote: note?.trim() || "AyTi ariza yopildi",
      updatedAt: now,
    })
    .where(eq(tasksTable.id, taskId));
}
