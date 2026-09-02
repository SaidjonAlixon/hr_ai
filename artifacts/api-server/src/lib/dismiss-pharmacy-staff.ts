import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, employeesTable, usersTable } from "@workspace/db";
import { displayBranchName } from "./geo-location";
import { userStatusFromEmployment } from "./staff-directory";
import { syncStaffingAlertForEmployee } from "./staffing-alert";

const BRANCH_STAFF_ORG = new Set(["pharmacist", "intern", "supervisor"]);
const DISMISS_ORG = new Set(["manager", ...BRANCH_STAFF_ORG]);

export function canDismissPharmacyNetwork(role?: string): boolean {
  return (
    role === "koordinator" ||
    role === "mudir" ||
    role === "admin" ||
    role === "hr" ||
    role === "hr_menejer" ||
    role === "hr_direktor" ||
    role === "director"
  );
}

async function assertDismissScope(
  role: string,
  actorUserId: number,
  target: typeof employeesTable.$inferSelect,
): Promise<string | null> {
  if (["admin", "hr", "hr_menejer", "hr_direktor", "director"].includes(role)) return null;
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

  await syncStaffingAlertForEmployee({
    employee: updated,
    previousStatus: employee.employmentStatus,
    newStatus: "dismissed",
    userId: actorUserId,
  });
  await terminateUser(employee.userId);
  return updated;
}

async function createVacantBranchSlot(
  mudir: typeof employeesTable.$inferSelect,
): Promise<number> {
  const label = displayBranchName(mudir.location) || mudir.location || "Filial";
  const [slot] = await db
    .insert(employeesTable)
    .values({
      fullName: label,
      position: "Filial mudiri",
      departmentId: mudir.departmentId,
      hiredAt: new Date().toISOString().slice(0, 10),
      orgRole: "manager",
      reportsToId: mudir.reportsToId,
      location: mudir.location,
      latitude: mudir.latitude,
      longitude: mudir.longitude,
      shiftType: mudir.shiftType,
      shiftLabel: mudir.shiftLabel,
      userId: null,
      employmentStatus: "no_manager",
      createdById: mudir.createdById,
    })
    .returning({ id: employeesTable.id });
  return slot!.id;
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
    const team = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(
        and(
          eq(employeesTable.reportsToId, target.id),
          inArray(employeesTable.orgRole, [...BRANCH_STAFF_ORG]),
        ),
      );

    const placeholderId = await createVacantBranchSlot(target);
    if (team.length) {
      await db
        .update(employeesTable)
        .set({ reportsToId: placeholderId })
        .where(
          inArray(
            employeesTable.id,
            team.map((t) => t.id),
          ),
        );
    }

    await dismissEmployeeRecord(target, actorUserId);

    return {
      ok: true,
      kind: "mudir",
      fullName: target.fullName,
      placeholderId,
      message: `«${target.fullName}» bo‘shatildi. Filial saqlandi — yangi mudir qo‘shishingiz mumkin.`,
    };
  }

  await dismissEmployeeRecord(target, actorUserId);
  return {
    ok: true,
    kind: "staff",
    fullName: target.fullName,
    message: `«${target.fullName}» bo‘shatildi. O‘rniga yangi xodim qo‘shishingiz mumkin.`,
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
        eq(employeesTable.employmentStatus, "no_manager"),
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
