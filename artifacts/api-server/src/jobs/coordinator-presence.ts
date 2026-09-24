import { and, eq, isNull } from "drizzle-orm";
import { db, coordinatorBranchVisitsTable } from "@workspace/db";
import { notifyUser } from "../lib/notify";
import { logger } from "../lib/logger";
import {
  COORD_PRESENCE_INTERVAL_MS,
  isCoordinatorOfficeVisit,
  isVisitPresenceBlocked,
  isVisitPresenceOverdue,
  markPresenceBlockedIfNeeded,
  visitPresenceBaseMs,
} from "../lib/coordinator-visits";

const FIVE_MIN_MS = 5 * 60 * 1000;

/**
 * 1) 30 daqiqada eslatma
 * 2) +10 daqiqa ichida tasdiqlanmasa — blok + ogohlantirish
 */
export async function sendCoordinatorPresenceReminders(): Promise<{
  reminded: number;
  blocked: number;
}> {
  const now = Date.now();
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
    // Ofisda qolish — 30 daqiqa hudud tasdiqlash talab qilinmaydi
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
    const text = `📍 «${branch}» — hududingizni tasdiqlang (10 daqiqa ichida). Yoki ishingiz tugasa «Ketdim» qiling. Aks holda cheklist bloklanadi. Cheklist → «Hududni tasdiqlash».`;

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
  }, FIVE_MIN_MS);
  logger.info(
    "Coordinator presence job started (every 5 min; ping 20m, block after +10m)",
  );
}
