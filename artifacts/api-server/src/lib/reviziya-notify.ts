import { and, eq, ne } from "drizzle-orm";
import { db, employeesTable, usersTable } from "@workspace/db";
import { notifyUser } from "./notify";
import { displayBranchName } from "./geo-location";

/**
 * Reviziya xabari — faqat shu muammo/filial bilan bog‘liq odamlarga:
 * mudir, koordinator, biriktirilgan revizor (+ ixtiyoriy qo‘shimcha userId lar).
 * E’lon / barcha rollarga broadcast qilinmaydi.
 */
export async function resolveBranchStakeholderUserIds(opts: {
  branchId?: number | null;
  branchName?: string | null;
  assignedRevizorId?: number | null;
  extraUserIds?: Array<number | null | undefined>;
}): Promise<number[]> {
  const ids = new Set<number>();

  for (const x of opts.extraUserIds || []) {
    if (x != null && Number.isFinite(x) && x > 0) ids.add(Number(x));
  }
  if (opts.assignedRevizorId != null && opts.assignedRevizorId > 0) {
    ids.add(opts.assignedRevizorId);
  }

  let manager:
    | {
        id: number;
        userId: number | null;
        reportsToId: number | null;
      }
    | undefined;

  if (opts.branchId != null && opts.branchId > 0) {
    const [m] = await db
      .select({
        id: employeesTable.id,
        userId: employeesTable.userId,
        reportsToId: employeesTable.reportsToId,
      })
      .from(employeesTable)
      .where(eq(employeesTable.id, opts.branchId))
      .limit(1);
    manager = m;
  } else if (opts.branchName?.trim()) {
    const want = displayBranchName(opts.branchName).toLowerCase();
    const raw = opts.branchName.trim().toLowerCase();
    const managers = await db
      .select({
        id: employeesTable.id,
        userId: employeesTable.userId,
        reportsToId: employeesTable.reportsToId,
        fullName: employeesTable.fullName,
        location: employeesTable.location,
      })
      .from(employeesTable)
      .where(
        and(
          eq(employeesTable.orgRole, "manager"),
          ne(employeesTable.employmentStatus, "dismissed"),
        ),
      );
    manager = managers.find((m) => {
      const loc = displayBranchName(m.location).toLowerCase();
      const fn = (m.fullName || "").toLowerCase();
      return loc === want || loc === raw || fn === raw || (m.location || "").toLowerCase().includes(raw);
    });
  }

  if (manager?.userId) ids.add(manager.userId);

  if (manager?.reportsToId) {
    const [coord] = await db
      .select({ userId: employeesTable.userId })
      .from(employeesTable)
      .where(eq(employeesTable.id, manager.reportsToId))
      .limit(1);
    if (coord?.userId) ids.add(coord.userId);
  }

  return [...ids];
}

export async function notifyReviziyaStakeholders(opts: {
  text: string;
  type: string;
  linkUrl: string;
  branchId?: number | null;
  branchName?: string | null;
  assignedRevizorId?: number | null;
  extraUserIds?: Array<number | null | undefined>;
  /** Qo‘shimcha: faqat reviziya_rahbar (shu bo‘lim boshlig‘i) — e’lon emas */
  includeReviziyaRahbar?: boolean;
}): Promise<void> {
  const userIds = await resolveBranchStakeholderUserIds(opts);

  if (opts.includeReviziyaRahbar) {
    const heads = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.status, "active"), eq(usersTable.role, "reviziya_rahbar")));
    for (const h of heads) userIds.push(h.id);
  }

  const unique = [...new Set(userIds.filter((id) => id > 0))];
  for (const userId of unique) {
    await notifyUser({
      userId,
      text: opts.text,
      type: opts.type,
      linkUrl: opts.linkUrl,
    });
  }
}
