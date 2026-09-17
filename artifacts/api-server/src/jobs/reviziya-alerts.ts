import { and, eq, isNotNull, lt, inArray } from "drizzle-orm";
import { db, revisionDocumentsTable, revisionInTransitTable, revisionVisitsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { notifyReviziyaStakeholders } from "../lib/reviziya-notify";
import { IN_TRANSIT_HOURS } from "../lib/reviziya";
import { tashkentYmd } from "../lib/reviziya-cycle";

const INTERVAL_MS = 15 * 60 * 1000;

export async function runReviziyaAlerts(): Promise<void> {
  const cutoff = new Date(Date.now() - IN_TRANSIT_HOURS * 36e5);
  const overdue = await db
    .select({
      id: revisionInTransitTable.id,
      branchName: revisionInTransitTable.branchName,
      revizorId: revisionInTransitTable.revizorId,
    })
    .from(revisionInTransitTable)
    .where(and(eq(revisionInTransitTable.status, "open"), lt(revisionInTransitTable.acceptedAt, cutoff)));

  for (const row of overdue) {
    await notifyReviziyaStakeholders({
      branchName: row.branchName,
      assignedRevizorId: row.revizorId,
      includeReviziyaRahbar: true,
      text: `«${row.branchName || "Filial"}» yo‘ldagi pul ${IN_TRANSIT_HOURS} soatdan oshdi`,
      type: "reviziya_in_transit_overdue",
      linkUrl: "/reviziya",
    });
  }

  const today = tashkentYmd();
  const missed = await db
    .select({
      id: revisionDocumentsTable.id,
      branchName: revisionDocumentsTable.branchName,
      revizorId: revisionDocumentsTable.revizorId,
    })
    .from(revisionDocumentsTable)
    .where(
      and(
        eq(revisionDocumentsTable.docType, "assignment"),
        eq(revisionDocumentsTable.status, "planned"),
        isNotNull(revisionDocumentsTable.plannedDate),
        lt(revisionDocumentsTable.plannedDate, today),
      ),
    );
  for (const row of missed) {
    await notifyReviziyaStakeholders({
      branchName: row.branchName,
      assignedRevizorId: row.revizorId,
      includeReviziyaRahbar: true,
      text: `Reja bo‘yicha tekshiruv o‘tkazilmadi: ${row.branchName || "Filial"}`,
      type: "reviziya_missed_plan",
      linkUrl: "/reviziya",
    });
  }

  const ordered = await db
    .select({
      id: revisionVisitsTable.id,
      branchId: revisionVisitsTable.branchId,
      branchName: revisionVisitsTable.branchName,
      nextRevisionDate: revisionVisitsTable.nextRevisionDate,
      nextRevisionDateOverride: revisionVisitsTable.nextRevisionDateOverride,
      assignedEmployeeId: revisionVisitsTable.assignedEmployeeId,
    })
    .from(revisionVisitsTable)
    .where(eq(revisionVisitsTable.workflowStatus, "COMPLETED"));

  const latestByBranch = new Map<number, (typeof ordered)[0]>();
  for (const v of ordered.sort((a, b) => b.id - a.id)) {
    if (!latestByBranch.has(v.branchId)) latestByBranch.set(v.branchId, v);
  }

  for (const v of latestByBranch.values()) {
    const next = v.nextRevisionDateOverride || v.nextRevisionDate;
    if (!next) continue;
    if (next < today) {
      await notifyReviziyaStakeholders({
        branchId: v.branchId,
        branchName: v.branchName,
        assignedRevizorId: v.assignedEmployeeId,
        includeReviziyaRahbar: true,
        text: `${v.branchName}: reviziya muddati o‘tgan (keyingi sana ${next})`,
        type: "reviziya_overdue_cycle",
        linkUrl: "/reviziya",
      });
    } else {
      const days = Math.round(
        (Date.parse(`${next}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
      );
      if (days >= 0 && days <= 14) {
        await notifyReviziyaStakeholders({
          branchId: v.branchId,
          branchName: v.branchName,
          assignedRevizorId: v.assignedEmployeeId,
          includeReviziyaRahbar: days <= 3,
          text: `${v.branchName}: reviziya ${days} kundan keyin`,
          type: "reviziya_upcoming",
          linkUrl: "/reviziya",
        });
      }
    }
  }

  const todayAssigned = await db
    .select({
      id: revisionVisitsTable.id,
      assignedEmployeeId: revisionVisitsTable.assignedEmployeeId,
      branchId: revisionVisitsTable.branchId,
      branchName: revisionVisitsTable.branchName,
    })
    .from(revisionVisitsTable)
    .where(
      and(
        eq(revisionVisitsTable.revisionDate, today),
        inArray(revisionVisitsTable.workflowStatus, ["ASSIGNED", "ACCEPTED"]),
        isNotNull(revisionVisitsTable.assignedEmployeeId),
      ),
    );
  for (const t of todayAssigned) {
    await notifyReviziyaStakeholders({
      branchId: t.branchId,
      branchName: t.branchName,
      assignedRevizorId: t.assignedEmployeeId,
      text: `Bugun reviziya: ${t.branchName}`,
      type: "reviziya_today",
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
