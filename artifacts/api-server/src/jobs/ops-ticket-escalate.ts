/**
 * AyTi ariza: 24 soat ichida qabul qilinmasa → HR menejer + admin.
 */
import { and, eq, isNull, lt } from "drizzle-orm";
import { db, opsTicketsTable, usersTable } from "@workspace/db";
import { notifyByRoles } from "../lib/notify";
import { logger } from "../lib/logger";

const TWENTY_FOUR_H_MS = 24 * 60 * 60 * 1000;
const CYCLE_MS = 5 * 60 * 1000;

function fmtDt(d: Date) {
  return d.toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function runOpsTicketEscalateCycle(): Promise<number> {
  const cutoff = new Date(Date.now() - TWENTY_FOUR_H_MS);
  const rows = await db
    .select()
    .from(opsTicketsTable)
    .where(
      and(
        eq(opsTicketsTable.dept, "it"),
        eq(opsTicketsTable.status, "new"),
        isNull(opsTicketsTable.acceptedAt),
        isNull(opsTicketsTable.escalatedAt),
        lt(opsTicketsTable.createdAt, cutoff),
      ),
    )
    .limit(80);

  if (!rows.length) return 0;

  const now = new Date();
  let n = 0;
  for (const row of rows) {
    let creatorName = "Xodim";
    if (row.createdById) {
      const [u] = await db
        .select({ fullName: usersTable.fullName })
        .from(usersTable)
        .where(eq(usersTable.id, row.createdById))
        .limit(1);
      if (u?.fullName) creatorName = u.fullName;
    }

    const branchTxt = row.branchName ? ` · ${row.branchName}` : "";
    const text =
      `AyTi arizani 24 soat ichida qabul qilmadi — chora ko‘ring.\n` +
      `${row.ticketNo}: «${row.title}»${branchTxt}\n` +
      `Yuboruvchi: ${creatorName}\n` +
      `Yuborilgan: ${fmtDt(row.createdAt)}\n` +
      `Eskalatsiya: ${fmtDt(now)}`;

    await db
      .update(opsTicketsTable)
      .set({ escalatedAt: now, updatedAt: now })
      .where(eq(opsTicketsTable.id, row.id));

    await notifyByRoles({
      roles: ["hr_menejer", "hr_direktor", "hr", "admin"],
      text,
      type: "ops_ticket_escalated",
      linkUrl: "/it",
    });
    n += 1;
  }
  if (n) logger.info({ count: n }, "AyTi tickets escalated (24h no accept)");
  return n;
}

export function startOpsTicketEscalateJob(): void {
  const kick = () => {
    runOpsTicketEscalateCycle().catch((err) =>
      logger.error({ err }, "AyTi ticket escalate job failed"),
    );
  };
  setTimeout(kick, 12_000);
  setInterval(kick, CYCLE_MS);
  logger.info("AyTi ticket escalate job started (every 5 min, threshold 24h)");
}
