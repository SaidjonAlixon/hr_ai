import { and, eq, isNull } from "drizzle-orm";
import { db, employeesTable, usersTable } from "@workspace/db";
import { userStatusFromEmployment } from "./staff-directory";
import { syncStaffingAlertForEmployee } from "./staffing-alert";
import { detachMudirFromBranch } from "./branch-shell";
import { invalidateFilialBranchCache } from "./filial-bot-data";

const BRANCH_STAFF_ORG = new Set(["pharmacist", "intern", "supervisor"]);
const DISMISS_ORG = new Set(["manager", ...BRANCH_STAFF_ORG]);

import { isHrRole, isDirectorRole } from "./roles";

export function canDismissPharmacyNetwork(role?: string): boolean {
  return role === "admin" || role === "asoschi" || role === "director" || role === "hr_menejer";
}

async function assertDismissScope(
  role: string,
  actorUserId: number,
  target: typeof employeesTable.$inferSelect,
): Promise<string | null> {
  if (role === "admin" || isDirectorRole(role) || isHrRole(role)) return null;
  if (target.orgRole === "coordinator") return "Koordinatorni bo‘shatib bo‘lmaydi";

  const mine = await db
    .select({
      id: employeesTable.id,
      orgRole: employeesTable.orgRole,
      userId: employeesTable.userId,
      reportsToId: employeesTable.reportsToId,
    })
    .from(employeesTable)
    .where(eq(employeesTable.userId, actorUserId));

  if (role === "mudir") {
    const myBranch =
      target.orgRole === "manager" && target.userId === actorUserId
        ? target
        : mine.find((e) => e.orgRole === "manager");
    if (!myBranch) return "Filial topilmadi";
    if (target.orgRole === "manager" && target.id !== myBranch.id) {
      return "Faqat o‘z filialingizdagi xodimlarni bo‘shatishingiz mumkin";
    }
    if (BRANCH_STAFF_ORG.has(target.orgRole || "") && target.reportsToId === myBranch.id) {
      return null;
    }
    return "Faqat o‘z filialingizdagi xodimlarni bo‘shatishingiz mumkin";
  }

  if (role === "koordinator") {
    const coord = mine.find((e) => e.orgRole === "coordinator") ?? mine[0];
    if (!coord) return "Koordinator kartasi topilmadi";
    if (target.orgRole === "manager" && target.reportsToId === coord.id) return null;
    if (BRANCH_STAFF_ORG.has(target.orgRole || "") && target.reportsToId != null) {
      const [mgr] = await db
        .select({ id: employeesTable.id, reportsToId: employeesTable.reportsToId })
        .from(employeesTable)
        .where(eq(employeesTable.id, target.reportsToId));
      if (mgr?.reportsToId === coord.id) return null;
    }
    return "Faqat o‘z tarmog‘ingizdagi mudir va xodimlarni bo‘shatishingiz mumkin";
  }

  return "Ruxsat yo‘q";
}

async function terminateUser(userId: number | null) {
  if (!userId) return;
  await db
    .update(usersTable)
    .set({ status: userStatusFromEmployment("dismissed") })
    .where(eq(usersTable.id, userId));
}

async function dismissEmployeeRecord(
  employee: typeof employeesTable.$inferSelect,
  actorUserId: number,
) {
  const [updated] = await db
    .update(employeesTable)
    .set({ employmentStatus: "dismissed" })
    .where(eq(employeesTable.id, employee.id))
    .returning();
  if (!updated) throw new Error("Xodim yangilanmadi");

  // Bazada dismissed saqlanadi; hech kimga bildirishnoma / bot / alert yo‘q
  await syncStaffingAlertForEmployee({
    employee: { ...updated, shiftType: employee.shiftType, shiftLabel: employee.shiftLabel },
    previousStatus: employee.employmentStatus,
    newStatus: "dismissed",
    userId: actorUserId,
  });
  await terminateUser(employee.userId);
  return updated;
}

export async function dismissPharmacyEmployee(
  employeeId: number,
  actorUserId: number,
  actorRole: string,
): Promise<
  | {
      ok: true;
      fullName: string;
      kind: "mudir" | "staff";
      placeholderId?: number;
      message: string;
    }
  | { ok: false; status: number; error: string }
> {
  if (!canDismissPharmacyNetwork(actorRole)) {
    return { ok: false, status: 403, error: "Ruxsat yo‘q" };
  }

  const [target] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!target) {
    return { ok: false, status: 404, error: "Xodim topilmadi" };
  }
  if (!DISMISS_ORG.has(target.orgRole || "")) {
    return { ok: false, status: 400, error: "Faqat mudir, farmasevt yoki stajyorni bo‘shatish mumkin" };
  }
  if (target.employmentStatus === "dismissed") {
    return { ok: false, status: 400, error: "Xodim allaqachon bo‘shatilgan" };
  }
  if (target.employmentStatus === "no_manager" && !target.userId) {
    return { ok: false, status: 400, error: "Bu filial allaqachon bo‘sh — yangi mudir qo‘shing" };
  }

  const scopeErr = await assertDismissScope(actorRole, actorUserId, target);
  if (scopeErr) return { ok: false, status: 403, error: scopeErr };

  if (target.orgRole === "manager") {
    const placeholderId = await db.transaction((tx) => detachMudirFromBranch(tx, target));
    await dismissEmployeeRecord(target, actorUserId);
    invalidateFilialBranchCache();

    return {
      ok: true,
      kind: "mudir",
      fullName: target.fullName,
      placeholderId,
      message: `«${target.fullName}» bo‘shatildi. Filial koordinatorda qoldi — yangi mudir qo‘yishingiz mumkin.`,
    };
  }

  await dismissEmployeeRecord(target, actorUserId);

  return {
    ok: true,
    kind: "staff",
    fullName: target.fullName,
    message: `«${target.fullName}» bo‘shatildi. Kerak bo‘lsa «Xodim kerak» bo‘limidan so‘rov yuboring.`,
  };
}

/** Yangi mudir yaratishda bo‘sh filial slotini yangilash */
export async function fillVacantBranchSlot(
  slotId: number,
  userId: number,
  fullName: string,
): Promise<boolean> {
  const [slot] = await db
    .select()
    .from(employeesTable)
    .where(
      and(
        eq(employeesTable.id, slotId),
        eq(employeesTable.orgRole, "manager"),
        isNull(employeesTable.userId),
      ),
    );
  if (!slot) return false;

  const [updated] = await db
    .update(employeesTable)
    .set({
      fullName,
      userId,
      employmentStatus: "working",
      position: "Filial mudiri",
    })
    .where(eq(employeesTable.id, slotId))
    .returning();
  return Boolean(updated);
}
