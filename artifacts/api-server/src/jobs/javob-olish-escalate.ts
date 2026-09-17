/**
 * Javob olish: 1-koordinator 8 soat ichida javob bermasa → HR menejer + HR direktor.
 */
import { and, eq, inArray, lt } from "drizzle-orm";
import { db, employeesTable, javobOlishRequestsTable } from "@workspace/db";
import { notifyByRoles } from "../lib/notify";
import { logger } from "../lib/logger";

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
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

export async function runJavobOlishEscalateCycle(): Promise<number> {
  const cutoff = new Date(Date.now() - EIGHT_HOURS_MS);
  const rows = await db
    .select()
    .from(javobOlishRequestsTable)
    .where(
      and(
        inArray(javobOlishRequestsTable.status, ["pending", "pending_coord"]),
        lt(javobOlishRequestsTable.createdAt, cutoff),
      ),
    )
    .limit(100);

  if (!rows.length) return 0;

  const now = new Date();
  let n = 0;
  for (const row of rows) {
    const note = `Koordinator 8 soat ichida javob bermadi. Yuborilgan: ${fmtDt(row.createdAt)}. HR ga o‘tkazilgan: ${fmtDt(now)}.`;
    await db
      .update(javobOlishRequestsTable)
      .set({
        status: "pending_hr",
        escalatedAt: now,
        escalatedNote: note,
        updatedAt: now,
      })
      .where(eq(javobOlishRequestsTable.id, row.id));

    const [emp] = await db
      .select({ fullName: employeesTable.fullName })
      .from(employeesTable)
      .where(eq(employeesTable.id, row.employeeId))
      .limit(1);

    await notifyByRoles({
      roles: ["hr_menejer", "hr_direktor", "admin"],
      text: `${emp?.fullName || "Xodim"}: javob olish — koordinator javob bermadi. ${row.workDate} ${row.fromHm}–${row.toHm}. Sabab: ${row.note}. ${note}`,
      type: "javob_olish_escalated",
      linkUrl: "/javob-olish",
    });
    n += 1;
  }
  if (n) logger.info({ count: n }, "Javob olish escalated to HR");
  return n;
}

export function startJavobOlishEscalateJob(): void {
  // Schema ensure (CREATE/ALTER) tinglashdan keyin ishlashi mumkin — biroz kechiktiramiz
  const kick = () => {
    runJavobOlishEscalateCycle().catch((err) =>
      logger.error({ err }, "Javob olish escalate job failed"),
    );
  };
  setTimeout(kick, 8_000);
  setInterval(kick, CYCLE_MS);
  logger.info("Javob olish escalate job started (every 5 minutes, threshold 8h)");
}
