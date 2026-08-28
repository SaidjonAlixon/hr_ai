import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db, revisionDocumentsTable, revisionInTransitTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { notifyByRoles } from "../lib/notify";
import { IN_TRANSIT_HOURS } from "../lib/reviziya";

const INTERVAL_MS = 15 * 60 * 1000;

function tashkentYmd(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(d);
}

export async function runReviziyaAlerts(): Promise<void> {
  const cutoff = new Date(Date.now() - IN_TRANSIT_HOURS * 36e5);
  const overdue = await db
    .select({ id: revisionInTransitTable.id })
    .from(revisionInTransitTable)
    .where(and(eq(revisionInTransitTable.status, "open"), lt(revisionInTransitTable.acceptedAt, cutoff)));

  if (overdue.length) {
    await notifyByRoles({
      roles: ["reviziya_rahbar", "director", "admin", "moliya"],
      text: `${overdue.length} ta «yo‘ldagi pul» ${IN_TRANSIT_HOURS} soatdan oshdi`,
      type: "reviziya_in_transit_overdue",
      linkUrl: "/reviziya",
    });
  }

  const today = tashkentYmd();
  const missed = await db
    .select({ id: revisionDocumentsTable.id })
    .from(revisionDocumentsTable)
    .where(
      and(
        eq(revisionDocumentsTable.docType, "assignment"),
        eq(revisionDocumentsTable.status, "planned"),
        isNotNull(revisionDocumentsTable.plannedDate),
        lt(revisionDocumentsTable.plannedDate, today),
      ),
    );
  if (missed.length) {
    await notifyByRoles({
      roles: ["reviziya_rahbar", "admin"],
      text: `Reja bo‘yicha ${missed.length} ta tekshiruv o‘tkazilmadi`,
      type: "reviziya_missed_plan",
      linkUrl: "/reviziya",
    });
  }
}

export function startReviziyaAlertJob() {
  const tick = () => {
    runReviziyaAlerts().catch((err) => logger.warn({ err }, "Reviziya alerts failed"));
  };
  tick();
  setInterval(tick, INTERVAL_MS);
}
