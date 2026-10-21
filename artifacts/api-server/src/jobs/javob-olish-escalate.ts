/**
 * Javob olish: 1-koordinator / bo‘lim boshlig‘i 8 soat ichida javob bermasa → HR.
 * Distrib/tamojni → Distribyutsiya HR.
 */
import { and, eq, inArray, lt } from "drizzle-orm";
import { db, employeesTable, javobOlishRequestsTable, usersTable } from "@workspace/db";
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

function isDistribFamilyRole(role: string) {
  return (
    role === "distrib" ||
    role === "distrib_rahbar" ||
    role === "distrib_hr" ||
    role === "tamojni" ||
    role === "tamojni_rahbar"
  );
}

export async function runJavobOlishEscalateCycle(): Promise<number> {
  const cutoff = new Date(Date.now() - EIGHT_HOURS_MS);
  const rows = await db
    .select()
    .from(javobOlishRequestsTable)
    .where(
      and(
        inArray(javobOlishRequestsTable.status, ["pending", "pending_coord", "pending_dept"]),
        lt(javobOlishRequestsTable.createdAt, cutoff),
      ),
    )
    .limit(100);

  if (!rows.length) return 0;

  const now = new Date();
  let n = 0;
  for (const row of rows) {
    const who = row.status === "pending_dept" ? "Bo‘lim boshlig‘i" : "Koordinator";
    let requesterRole = "";
    if (row.userId) {
      const [u] = await db
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, row.userId))
        .limit(1);
      requesterRole = String(u?.role || "");
    }
    const distribFamily = isDistribFamilyRole(requesterRole);
    const hrLabel = distribFamily ? "Distribyutsiya HR" : "HR";
    const note = `${who} 8 soat ichida javob bermadi. Yuborilgan: ${fmtDt(row.createdAt)}. ${hrLabel} ga o‘tkazilgan: ${fmtDt(now)}.`;
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
      roles: distribFamily ? ["distrib_hr", "admin"] : ["hr_menejer", "hr_direktor", "admin"],
      text: `${emp?.fullName || "Xodim"}: javob olish — ${who.toLowerCase()} javob bermadi. ${row.workDate} ${row.fromHm}–${row.toHm}. Sabab: ${row.note}. ${note}`,
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
