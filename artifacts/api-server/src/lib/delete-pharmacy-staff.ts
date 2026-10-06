import { and, eq, inArray, or } from "drizzle-orm";
import {
  db,
  usersTable,
  employeesTable,
  attendanceRecordsTable,
  internshipsTable,
  staffingAlertsTable,
  branchAuditsTable,
  branchNeedsTable,
  faceProfilesTable,
  webauthnCredentialsTable,
  davomatFingerprintsTable,
  webauthnChallengesTable,
  kirishProgressTable,
  notificationsTable,
  userGoalsTable,
  goalDailyLogsTable,
  remindersTable,
  reminderEventsTable,
  telegramAuthTokensTable,
  chatMembersTable,
  chatMessagesTable,
  departmentsTable,
  tasksTable,
} from "@workspace/db";
import { isHrRole, isDirectorRole } from "./roles";
import { syncStaffingAlertForEmployee } from "./staffing-alert";
import { detachMudirFromBranch, positionForOrgRole, userRoleForOrgRole } from "./branch-shell";
import { invalidateFilialBranchCache } from "./filial-bot-data";
import { movePharmacyStaff } from "./move-pharmacy-staff";

const STAFF_ORG = new Set(["pharmacist", "intern", "supervisor", "manager"]);
const BRANCH_STAFF_ORG = new Set(["pharmacist", "intern", "supervisor"]);
const CHANGEABLE_ORG = new Set(["manager", "pharmacist", "intern", "supervisor"]);

export type PharmacyOrgRoleChange = "manager" | "pharmacist" | "intern";

export function canHardDeletePharmacyNetwork(role?: string): boolean {
  return role === "admin" || role === "asoschi" || role === "director" || role === "hr_menejer";
}

/** Koordinator faqat o‘z doirasidagi filial/xodimni o‘chira oladi */
export async function assertHardDeleteScope(
  role: string,
  actorUserId: number,
  targetId: number,
): Promise<string | null> {
  if (role === "admin" || isHrRole(role) || isDirectorRole(role)) return null;
  if (role !== "koordinator") return "Ruxsat yo‘q";

  const [actor] = await db
    .select({ id: employeesTable.id, orgRole: employeesTable.orgRole })
    .from(employeesTable)
    .where(eq(employeesTable.userId, actorUserId))
    .limit(1);
  if (!actor || actor.orgRole !== "coordinator") {
    return "Koordinator profili topilmadi";
  }

  const [target] = await db
    .select({
      id: employeesTable.id,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
      assignedBranchId: employeesTable.assignedBranchId,
    })
    .from(employeesTable)
    .where(eq(employeesTable.id, targetId))
    .limit(1);
  if (!target) return "Xodim topilmadi";

  if (target.orgRole === "manager") {
    if (target.reportsToId === actor.id) return null;
    return "Faqat o‘zingizga bog‘liq filialni o‘chira olasiz";
  }

  if (STAFF_ORG.has(target.orgRole || "")) {
    if (target.reportsToId === actor.id) return null;
    if (target.reportsToId) {
      const [mgr] = await db
        .select({ reportsToId: employeesTable.reportsToId })
        .from(employeesTable)
        .where(eq(employeesTable.id, target.reportsToId))
        .limit(1);
      if (mgr?.reportsToId === actor.id) return null;
    }
    if (target.assignedBranchId) {
      const [branch] = await db
        .select({ reportsToId: employeesTable.reportsToId })
        .from(employeesTable)
        .where(eq(employeesTable.id, target.assignedBranchId))
        .limit(1);
      if (branch?.reportsToId === actor.id) return null;
    }
    return "Faqat o‘zingizga bog‘liq xodimni o‘chira olasiz";
  }

  return "Bu yozuvni o‘chirib bo‘lmaydi";
}

export async function purgeUserSideEffects(userIds: number[]) {
  if (!userIds.length) return;

  await db.delete(faceProfilesTable).where(inArray(faceProfilesTable.userId, userIds));
  await db.delete(webauthnCredentialsTable).where(inArray(webauthnCredentialsTable.userId, userIds));
  await db.delete(davomatFingerprintsTable).where(inArray(davomatFingerprintsTable.userId, userIds));
  await db.delete(webauthnChallengesTable).where(inArray(webauthnChallengesTable.userId, userIds));
  await db.delete(kirishProgressTable).where(inArray(kirishProgressTable.userId, userIds));
  await db.delete(notificationsTable).where(inArray(notificationsTable.userId, userIds));
  await db.delete(goalDailyLogsTable).where(inArray(goalDailyLogsTable.userId, userIds));
  await db.delete(userGoalsTable).where(inArray(userGoalsTable.userId, userIds));
  await db.delete(remindersTable).where(inArray(remindersTable.userId, userIds));
  await db.delete(telegramAuthTokensTable).where(inArray(telegramAuthTokensTable.userId, userIds));
  await db.delete(chatMembersTable).where(inArray(chatMembersTable.userId, userIds));
  await db.delete(chatMessagesTable).where(inArray(chatMessagesTable.senderId, userIds));

  await db
    .update(departmentsTable)
    .set({ headId: null })
    .where(inArray(departmentsTable.headId, userIds));

  await db
    .update(branchNeedsTable)
    .set({ assignedUserId: null })
    .where(inArray(branchNeedsTable.assignedUserId, userIds));

  await db
    .delete(tasksTable)
    .where(
      and(eq(tasksTable.assigneeKind, "user"), inArray(tasksTable.assigneeId, userIds)),
    );
}

export async function purgeEmployeeSideEffects(employeeIds: number[]) {
  if (!employeeIds.length) return;

  await db
    .delete(attendanceRecordsTable)
    .where(inArray(attendanceRecordsTable.employeeId, employeeIds));
  await db.delete(internshipsTable).where(inArray(internshipsTable.employeeId, employeeIds));
  await db
    .delete(staffingAlertsTable)
    .where(
      or(
        inArray(staffingAlertsTable.employeeId, employeeIds),
        inArray(staffingAlertsTable.managerEmployeeId, employeeIds),
      ),
    );
  await db
    .delete(branchAuditsTable)
    .where(inArray(branchAuditsTable.managerEmployeeId, employeeIds));
  await db
    .delete(branchNeedsTable)
    .where(inArray(branchNeedsTable.managerEmployeeId, employeeIds));

  // Boshqalar shu mudirga bog‘langan bo‘lsa — bog‘lanishni uzamiz
  await db
    .update(employeesTable)
    .set({ reportsToId: null })
    .where(inArray(employeesTable.reportsToId, employeeIds));

  await db
    .update(employeesTable)
    .set({ assignedBranchId: null })
    .where(inArray(employeesTable.assignedBranchId, employeeIds));

  // employee assignee vazifalari
  await db
    .delete(tasksTable)
    .where(
      and(eq(tasksTable.assigneeKind, "employee"), inArray(tasksTable.assigneeId, employeeIds)),
    );
}

/**
 * Filial mudiri yoki xodimni butunlay o‘chiradi.
 *
 * scope:
 * - "person" (default) — faqat shu odam; mudir o‘chirilsa filial (bo‘sh slot) + jamoa qoladi
 * - "branch" — mudir bilan butun filial (farmasevt/stajyorlar ham)
 *
 * ID eski cache dan noto‘g‘ri kelishi mumkin — userId / fullName bilan ham qidiriladi.
 */
export async function hardDeletePharmacyEmployee(
  employeeId: number,
  opts?: {
    userId?: number | null;
    fullName?: string | null;
    scope?: "person" | "branch";
  },
): Promise<{
  ok: true;
  deletedEmployees: number;
  deletedUsers: number;
  kind: "filial" | "mudir" | "staff";
  fullName: string;
  message?: string;
} | { ok: false; status: number; error: string }> {
  const scope = opts?.scope === "branch" ? "branch" : "person";
  const selectCols = {
    id: employeesTable.id,
    fullName: employeesTable.fullName,
    orgRole: employeesTable.orgRole,
    userId: employeesTable.userId,
  };

  let target:
    | {
        id: number;
        fullName: string;
        orgRole: string | null;
        userId: number | null;
      }
    | undefined;

  if (Number.isFinite(employeeId) && employeeId > 0) {
    const [byId] = await db
      .select(selectCols)
      .from(employeesTable)
      .where(eq(employeesTable.id, employeeId));
    target = byId;
  }

  const wantName = String(opts?.fullName || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  // Eski cache: UI userId yuborgan bo‘lishi mumkin
  if (!target && opts?.userId && Number.isFinite(opts.userId)) {
    const [byUser] = await db
      .select(selectCols)
      .from(employeesTable)
      .where(eq(employeesTable.userId, opts.userId));
    if (byUser) {
      if (!wantName || byUser.fullName.trim().replace(/\s+/g, " ").toLowerCase() === wantName) {
        target = byUser;
      }
    }
  }

  // Ism bo‘yicha (faqat aniq moslik)
  if (!target && wantName) {
    const byName = await db.select(selectCols).from(employeesTable);
    const matches = byName.filter(
      (r) =>
        STAFF_ORG.has(r.orgRole || "") &&
        r.fullName.trim().replace(/\s+/g, " ").toLowerCase() === wantName,
    );
    target =
      matches.find((r) => r.orgRole === "manager") ??
      matches[0];
  }

  if (!target) {
    return {
      ok: false,
      status: 404,
      error:
        "Xodim topilmadi — ro‘yxat eskirgan bo‘lishi mumkin. Sahifani yangilab qayta urinib ko‘ring",
    };
  }
  if (target.orgRole === "coordinator") {
    return { ok: false, status: 400, error: "Koordinatorni shu yo‘l bilan o‘chirib bo‘lmaydi" };
  }
  if (!STAFF_ORG.has(target.orgRole || "")) {
    return { ok: false, status: 400, error: "Faqat filial mudiri yoki filial xodimini o‘chirish mumkin" };
  }

  // Bo‘sh filial shell ni faqat branch scope bilan o‘chirish mumkin
  if (
    target.orgRole === "manager" &&
    !target.userId &&
    scope === "person"
  ) {
    return {
      ok: false,
      status: 400,
      error: "Bu filialda mudir yo‘q — o‘chiriladigan odam yo‘q. Filial koordinatorda qoladi.",
    };
  }

  const toDelete: Array<{ id: number; userId: number | null }> = [];
  let kind: "filial" | "mudir" | "staff" = "staff";
  let keepMessage: string | undefined;

  if (target.orgRole === "manager" && scope === "branch") {
    kind = "filial";
    const staff = await db
      .select({
        id: employeesTable.id,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(
        or(
          eq(employeesTable.reportsToId, target.id),
          eq(employeesTable.assignedBranchId, target.id),
        ),
      );
    const seen = new Set<number>();
    for (const s of staff) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      toDelete.push(s);
    }
  } else if (target.orgRole === "manager" && scope === "person") {
    // Faqat mudir — filial bo‘sh slot sifatida qoladi, jamoa saqlanadi
    kind = "mudir";
    const [full] = await db.select().from(employeesTable).where(eq(employeesTable.id, target.id)).limit(1);
    if (!full) {
      return { ok: false, status: 404, error: "Xodim topilmadi" };
    }
    await db.transaction((tx) => detachMudirFromBranch(tx, full));
    keepMessage = `«${target.fullName}» o‘chirildi. Filial koordinatorda qoldi — mudir o‘rni bo‘sh.`;
  } else {
    // Farmasevt/stajyor hard-delete: smena uchun «xodim kerak» slot + ogohlantirish
    const [full] = await db.select().from(employeesTable).where(eq(employeesTable.id, target.id)).limit(1);
    if (full && (full.orgRole === "pharmacist" || full.orgRole === "intern" || full.orgRole === "supervisor")) {
      let branch = full.location;
      if (!branch && full.reportsToId) {
        const [mgr] = await db
          .select({ location: employeesTable.location })
          .from(employeesTable)
          .where(eq(employeesTable.id, full.reportsToId))
          .limit(1);
        branch = mgr?.location ?? null;
      }
      const shiftHint =
        full.shiftLabel ||
        (full.shiftType === "two" || full.shiftType === "2"
          ? "2-smena"
          : full.shiftType === "three" || full.shiftType === "3"
            ? "3-smena"
            : full.shiftType
              ? "1-smena"
              : "smena");
      const [slot] = await db
        .insert(employeesTable)
        .values({
          fullName: `${shiftHint} — xodim kerak`,
          position: full.orgRole === "intern" ? "Stajyor" : "Farmasevt",
          departmentId: full.departmentId,
          hiredAt: new Date().toISOString().slice(0, 10),
          orgRole: full.orgRole === "intern" ? "intern" : "pharmacist",
          reportsToId: full.reportsToId,
          location: branch,
          latitude: full.latitude,
          longitude: full.longitude,
          shiftType: full.shiftType,
          shiftLabel: full.shiftLabel,
          userId: null,
          employmentStatus: "need_hire",
          createdById: full.createdById,
        })
        .returning();
      if (slot) {
        await syncStaffingAlertForEmployee({
          employee: slot,
          previousStatus: "working",
          newStatus: "need_hire",
          userId: null,
        });
      }
      keepMessage = `«${target.fullName}» o‘chirildi. O‘rni bo‘sh — yangi xodim qo‘shishingiz mumkin.`;
    }
  }
  toDelete.push({ id: target.id, userId: target.userId });

  const empIds = [...new Set(toDelete.map((e) => e.id))];
  const userIds = [
    ...new Set(toDelete.map((e) => e.userId).filter((id): id is number => id != null)),
  ];

  if (userIds.length) {
    const rem = await db
      .select({ id: remindersTable.id })
      .from(remindersTable)
      .where(inArray(remindersTable.userId, userIds));
    const remIds = rem.map((r) => r.id);
    if (remIds.length) {
      await db.delete(reminderEventsTable).where(inArray(reminderEventsTable.reminderId, remIds));
    }
  }

  await purgeEmployeeSideEffects(empIds);
  await purgeUserSideEffects(userIds);

  await db.delete(employeesTable).where(inArray(employeesTable.id, empIds));
  if (userIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  }
  invalidateFilialBranchCache();

  return {
    ok: true,
    deletedEmployees: empIds.length,
    deletedUsers: userIds.length,
    kind,
    fullName: target.fullName,
    message: keepMessage,
  };
}

export function canChangePharmacyOrgRole(role?: string): boolean {
  return canHardDeletePharmacyNetwork(role);
}

/**
 * Mudir ↔ farmasevt ↔ stajyor rollarini almashtirish (faqat admin/koordinator/HR).
 * Filial kartasi (manager shell id) saqlanadi — mudir demote qilinsa yangi bo‘sh slot ochiladi.
 */
export async function changePharmacyOrgRole(
  employeeId: number,
  newOrgRole: PharmacyOrgRoleChange,
  actorUserId: number,
  actorRole: string,
): Promise<
  | { ok: true; fullName: string; orgRole: PharmacyOrgRoleChange; message: string }
  | { ok: false; status: number; error: string }
> {
  if (!canChangePharmacyOrgRole(actorRole)) {
    return { ok: false, status: 403, error: "Rolni o‘zgartirish uchun ruxsat yo‘q" };
  }
  if (!["manager", "pharmacist", "intern"].includes(newOrgRole)) {
    return { ok: false, status: 400, error: "Yangi rol: mudir, farmasevt yoki stajyor" };
  }

  const scopeErr = await assertHardDeleteScope(actorRole, actorUserId, employeeId);
  if (scopeErr) return { ok: false, status: 403, error: scopeErr };

  const [target] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!target) return { ok: false, status: 404, error: "Xodim topilmadi" };
  if (!CHANGEABLE_ORG.has(target.orgRole || "")) {
    return { ok: false, status: 400, error: "Faqat mudir, farmasevt yoki stajyor rolini o‘zgartirish mumkin" };
  }
  if (target.employmentStatus === "dismissed") {
    return { ok: false, status: 400, error: "Bo‘shatilgan xodimning rolini o‘zgartirib bo‘lmaydi" };
  }
  if (target.orgRole === "manager" && !target.userId) {
    return { ok: false, status: 400, error: "Bo‘sh filialga avval mudir qo‘shing" };
  }
  if (!target.userId && BRANCH_STAFF_ORG.has(target.orgRole || "")) {
    return { ok: false, status: 400, error: "Bo‘sh (xodim kerak) slotning rolini o‘zgartirib bo‘lmaydi" };
  }

  const current =
    target.orgRole === "supervisor"
      ? "pharmacist"
      : (target.orgRole as PharmacyOrgRoleChange);

  if (current === newOrgRole) {
    return {
      ok: true,
      fullName: target.fullName,
      orgRole: newOrgRole,
      message: "Rol o‘zgarmadi",
    };
  }

  // Farmasevt ↔ stajyor (va supervisor → pharmacist/intern)
  if (current !== "manager" && newOrgRole !== "manager") {
    await db
      .update(employeesTable)
      .set({
        orgRole: newOrgRole,
        position: positionForOrgRole(newOrgRole),
      })
      .where(eq(employeesTable.id, target.id));
    if (target.userId) {
      await db
        .update(usersTable)
        .set({ role: userRoleForOrgRole(newOrgRole) })
        .where(eq(usersTable.id, target.userId));
    }
    return {
      ok: true,
      fullName: target.fullName,
      orgRole: newOrgRole,
      message: `«${target.fullName}» endi ${positionForOrgRole(newOrgRole).toLowerCase()}`,
    };
  }

  // Mudir ↔ farmasevt/stajyor — shu filial ichida. Filial o‘chmaydi, har kimning tarixi o‘zida qoladi.
  const branchId =
    current === "manager" ? target.id : (target.reportsToId ?? target.assignedBranchId);
  if (!branchId) {
    return { ok: false, status: 400, error: "Xodim filialga bog‘lanmagan" };
  }
  const demoteRole: PharmacyOrgRoleChange = current === "intern" ? "intern" : "pharmacist";
  const moved = await movePharmacyStaff({
    employeeId: target.id,
    targetBranchId: branchId,
    newOrgRole,
    displaced: newOrgRole === "manager" ? { targetBranchId: branchId, newOrgRole: demoteRole } : null,
  });
  if (!moved.ok) return { ok: false, status: moved.status, error: moved.error };
  return { ok: true, fullName: target.fullName, orgRole: newOrgRole, message: moved.message };
}
