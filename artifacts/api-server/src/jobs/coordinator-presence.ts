import { and, eq, isNull } from "drizzle-orm";
import { db, coordinatorBranchVisitsTable } from "@workspace/db";
import { notifyUser } from "../lib/notify";
import { logger } from "../lib/logger";
import {
  autoCloseStaleCoordinatorVisits,
  COORD_PRESENCE_INTERVAL_MS,
  COORD_PRESENCE_PERIOD_MS,
  isCoordinatorOfficeVisit,
  isVisitPresenceBlocked,
  isVisitPresenceOverdue,
  markPresenceBlockedIfNeeded,
  visitPresenceBaseMs,
} from "../lib/coordinator-visits";

const TICK_MS = 60 * 1000;

/**
 * 1) Oxirgi tasdiqdan 50 daqiqa o‘tgach eslatma
 * 2) 1 soat ichida tasdiqlanmasa — blok + ogohlantirish
 */
export async function sendCoordinatorPresenceReminders(): Promise<{
  reminded: number;
  blocked: number;
}> {
  const now = Date.now();
  try {
    const autoClosed = await autoCloseStaleCoordinatorVisits(new Date(now));
    if (autoClosed > 0) logger.info({ autoClosed }, "Stale coordinator visits auto-closed");
  } catch (err) {
    logger.error({ err }, "Stale coordinator visit auto-close failed");
  }
  const openVisits = await db
    .select()
    .from(coordinatorBranchVisitsTable)
    .where(
      and(
        eq(coordinatorBranchVisitsTable.status, "open"),
        isNull(coordinatorBranchVisitsTable.checkOutAt),
      ),
    );

  let reminded = 0;
  let blocked = 0;

  for (const visit of openVisits) {
    // Ofisda qolish — hudud tasdiqlash talab qilinmaydi
    if (isCoordinatorOfficeVisit(visit)) continue;

    // Avval blok (grace tugagan)
    if (isVisitPresenceBlocked(visit, now)) {
      const marked = await markPresenceBlockedIfNeeded(visit, new Date(now));
      if (marked && !visit.presenceBlockedAt) blocked += 1;
      continue;
    }

    if (!isVisitPresenceOverdue(visit, now)) continue;

    const baseMs = visitPresenceBaseMs(visit);
    if (baseMs == null) continue;

    const lastRemind = visit.lastPresenceReminderAt
      ? new Date(visit.lastPresenceReminderAt).getTime()
      : 0;
    // Bir eslatma oynasida qayta spam qilmaslik
    if (lastRemind && lastRemind >= baseMs + COORD_PRESENCE_INTERVAL_MS - 5_000) {
      continue;
    }

    const branch = visit.branchLabel || "Filial";
    const deadline = new Date(baseMs + COORD_PRESENCE_PERIOD_MS).toLocaleTimeString("uz-UZ", {
      timeZone: "Asia/Tashkent",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const text = `📍 «${branch}» — hududingizni ${deadline} gacha tasdiqlang (1 soatlik muddat tugayapti). Yoki ishingiz tugasa «Ketdim» qiling. Aks holda tashrif yopiladi va cheklist bloklanadi. Cheklist → «Hududni tasdiqlash».`;

    await notifyUser({
      userId: visit.coordinatorUserId,
      text,
      type: "coordinator_presence_ping",
      linkUrl: "/checklist?presence=1",
      title: "Hududni tasdiqlang",
      telegram: true,
    });

    await db
      .update(coordinatorBranchVisitsTable)
      .set({
        lastPresenceReminderAt: new Date(now),
        updatedAt: new Date(now),
      })
      .where(eq(coordinatorBranchVisitsTable.id, visit.id));

    reminded += 1;
  }

  if (reminded > 0 || blocked > 0) {
    logger.info({ reminded, blocked }, "Coordinator presence cycle");
  }
  return { reminded, blocked };
}

export function startCoordinatorPresenceJob(): void {
  sendCoordinatorPresenceReminders().catch((err) =>
    logger.error({ err }, "Coordinator presence job failed"),
  );
  setInterval(() => {
    sendCoordinatorPresenceReminders().catch((err) =>
      logger.error({ err }, "Coordinator presence job failed"),
    );
  }, TICK_MS);
  logger.info(
    "Coordinator presence job started (every 1 min; ping 50m, block at 60m)",
  );
}
