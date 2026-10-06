import { eq } from "drizzle-orm";
import { db, employeesTable, usersTable } from "@workspace/db";
import {
  branchLabelOf,
  detachMudirFromBranch,
  endPlacementsOutside,
  occupyVacantBranch,
  orgRoleLabel,
  placeAsBranchStaff,
  userRoleForOrgRole,
  type DbTx,
  type EmployeeRow,
  type PharmacyOrgRole,
} from "./branch-shell";
import { invalidateFilialBranchCache } from "./filial-bot-data";

export type MoveStaffInput = {
  employeeId: number;
  targetBranchId: number;
  newOrgRole: PharmacyOrgRole;
  /** Maqsad filialda mudir bo‘lsa va xodim mudir qilinsa — eski mudir qayerga, kim bo‘lib o‘tadi */
  displaced?: { targetBranchId: number; newOrgRole: PharmacyOrgRole } | null;
};

export type MoveStaffResult =
  | { ok: true; message: string; steps: string[] }
  | {
      ok: false;
      status: number;
      error: string;
      /** Maqsad filialdagi joriy mudir — UI shu odam uchun yo‘nalish so‘raydi */
      occupiedBy?: { employeeId: number; fullName: string };
    };

class MoveError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly occupiedBy?: { employeeId: number; fullName: string },
  ) {
    super(message);
  }
}

const MOVABLE_ORG = new Set(["manager", "pharmacist", "intern", "supervisor"]);
const ROLES = new Set<PharmacyOrgRole>(["manager", "pharmacist", "intern"]);

function currentRoleOf(row: EmployeeRow): PharmacyOrgRole {
  if (row.orgRole === "manager") return "manager";
  if (row.orgRole === "intern") return "intern";
  return "pharmacist";
}

function currentBranchIdOf(row: EmployeeRow): number | null {
  if (row.orgRole === "manager") return row.id;
  return row.reportsToId ?? row.assignedBranchId ?? null;
}

function isInactive(status: string | null | undefined): boolean {
  return status === "dismissed" || status === "closed";
}

async function loadRow(tx: DbTx, id: number): Promise<EmployeeRow | undefined> {
  const [row] = await tx.select().from(employeesTable).where(eq(employeesTable.id, id)).limit(1);
  return row;
}

async function loadBranch(tx: DbTx, id: number, what: string): Promise<EmployeeRow> {
  const row = await loadRow(tx, id);
  if (!row || row.orgRole !== "manager") throw new MoveError(404, `${what} topilmadi`);
  if (isInactive(row.employmentStatus)) throw new MoveError(400, `${what} yopilgan yoki o‘chirilgan`);
  return row;
}

async function setUserRole(tx: DbTx, row: EmployeeRow, role: PharmacyOrgRole) {
  if (!row.userId) return;
  await tx
    .update(usersTable)
    .set({ role: userRoleForOrgRole(role) })
    .where(eq(usersTable.id, row.userId));
}

/**
 * Xodimni boshqa filialga va/yoki boshqa rolga o‘tkazadi.
 * - Mudir ketgan filial o‘chmaydi: bo‘sh slot bo‘lib shu koordinatorda qoladi.
 * - Odamning employees qatori o‘zgarmaydi — davomat, oylik, jarima tarixi u bilan qoladi.
 * - Hammasi bitta tranzaksiya: biror qadam xato bo‘lsa hech narsa o‘zgarmaydi.
 */
export async function movePharmacyStaff(input: MoveStaffInput): Promise<MoveStaffResult> {
  const { employeeId, targetBranchId, newOrgRole } = input;
  const displaced = input.displaced ?? null;
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return { ok: false, status: 400, error: "Xodim tanlanmagan" };
  }
  if (!Number.isFinite(targetBranchId) || targetBranchId <= 0) {
    return { ok: false, status: 400, error: "Qaysi filialga o‘tkazishni tanlang" };
  }
  if (!ROLES.has(newOrgRole)) {
    return { ok: false, status: 400, error: "Yangi rol: mudir, farmasevt yoki stajyor" };
  }
  if (displaced) {
    if (!ROLES.has(displaced.newOrgRole) || !Number.isFinite(displaced.targetBranchId)) {
      return { ok: false, status: 400, error: "Joriy mudir uchun filial va rolni tanlang" };
    }
    if (displaced.targetBranchId === targetBranchId && displaced.newOrgRole === "manager") {
      return { ok: false, status: 400, error: "Bir filialda faqat bitta mudir bo‘ladi" };
    }
  }

  try {
    const result = await db.transaction(async (tx) => {
      const person = await loadRow(tx, employeeId);
      if (!person || !MOVABLE_ORG.has(person.orgRole || "")) {
        throw new MoveError(404, "Faqat mudir, farmasevt yoki stajyorni ko‘chirish mumkin");
      }
      if (!person.userId) throw new MoveError(400, "Bo‘sh o‘rinni ko‘chirib bo‘lmaydi");
      if (isInactive(person.employmentStatus)) {
        throw new MoveError(400, "Bo‘shatilgan xodimni ko‘chirib bo‘lmaydi");
      }
      const target = await loadBranch(tx, targetBranchId, "Tanlangan filial");

      const fromBranchId = currentBranchIdOf(person);
      const sameRole = currentRoleOf(person) === newOrgRole && person.orgRole !== "supervisor";
      if (fromBranchId === target.id && sameRole) {
        throw new MoveError(400, "Xodim allaqachon shu filialda shu lavozimda");
      }

      const fromRow = fromBranchId ? await loadRow(tx, fromBranchId) : undefined;
      const fromLabel = fromRow ? branchLabelOf(fromRow) : null;
      const targetLabel = branchLabelOf(target);

      // Filial id lari mudir almashganda o‘zgaradi — UI yuborgan eski id → hozirgi qator
      const branchNow = new Map<number, number>();
      const cur = (id: number) => branchNow.get(id) ?? id;
      const steps: string[] = [];
      let sourceLeftVacant = false;

      if (person.orgRole === "manager") {
        branchNow.set(person.id, await detachMudirFromBranch(tx, person));
        sourceLeftVacant = true;
      }

      let oldMudir: EmployeeRow | undefined;
      if (newOrgRole === "manager") {
        let slot = await loadBranch(tx, cur(target.id), "Tanlangan filial");
        if (slot.userId) {
          if (!displaced) {
            throw new MoveError(
              409,
              `«${targetLabel}» filialida mudir bor: ${slot.fullName}. Uni qayerga, kim qilib o‘tkazishni tanlang.`,
              { employeeId: slot.id, fullName: slot.fullName },
            );
          }
          oldMudir = slot;
          branchNow.set(target.id, await detachMudirFromBranch(tx, slot));
          slot = await loadBranch(tx, cur(target.id), "Tanlangan filial");
        }
        await occupyVacantBranch(tx, slot, person);
        branchNow.set(target.id, person.id);
        await endPlacementsOutside(tx, person.id, null);
      } else {
        const branch = await loadBranch(tx, cur(target.id), "Tanlangan filial");
        await placeAsBranchStaff(tx, person, branch, newOrgRole);
        await endPlacementsOutside(tx, person.id, branch.id);
      }
      await setUserRole(tx, person, newOrgRole);
      steps.push(
        fromBranchId === target.id
          ? `${person.fullName} — «${targetLabel}» filialida endi ${orgRoleLabel(newOrgRole)}`
          : `${person.fullName} — «${targetLabel}» filialiga ${orgRoleLabel(newOrgRole)} qilib o‘tkazildi`,
      );

      if (oldMudir && displaced) {
        const dTarget = await loadBranch(tx, cur(displaced.targetBranchId), "Joriy mudir uchun tanlangan filial");
        const dLabel = branchLabelOf(dTarget);
        if (displaced.newOrgRole === "manager") {
          if (dTarget.userId) {
            throw new MoveError(409, `«${dLabel}» filialida mudir bor — ${oldMudir.fullName}ni u yerga mudir qilib bo‘lmaydi`);
          }
          await occupyVacantBranch(tx, dTarget, oldMudir);
          branchNow.set(displaced.targetBranchId, oldMudir.id);
          await endPlacementsOutside(tx, oldMudir.id, null);
          if (fromBranchId != null && displaced.targetBranchId === fromBranchId) sourceLeftVacant = false;
        } else {
          await placeAsBranchStaff(tx, oldMudir, dTarget, displaced.newOrgRole);
          await endPlacementsOutside(tx, oldMudir.id, dTarget.id);
        }
        await setUserRole(tx, oldMudir, displaced.newOrgRole);
        steps.push(
          displaced.targetBranchId === targetBranchId
            ? `${oldMudir.fullName} — «${dLabel}» filialida endi ${orgRoleLabel(displaced.newOrgRole)}`
            : `${oldMudir.fullName} — «${dLabel}» filialiga ${orgRoleLabel(displaced.newOrgRole)} qilib o‘tkazildi`,
        );
      }

      if (sourceLeftVacant && fromLabel && fromBranchId !== target.id) {
        steps.push(`«${fromLabel}» filiali o‘chmadi — mudir o‘rni bo‘sh, koordinatorda qoladi`);
      } else if (sourceLeftVacant && fromLabel && newOrgRole !== "manager") {
        steps.push(`«${fromLabel}» filiali saqlandi — yangi mudir qo‘yishingiz mumkin`);
      }
      return steps;
    });

    invalidateFilialBranchCache();
    return { ok: true, steps: result, message: result.join(". ") + "." };
  } catch (err) {
    if (err instanceof MoveError) {
      return {
        ok: false,
        status: err.status,
        error: err.message,
        ...(err.occupiedBy ? { occupiedBy: err.occupiedBy } : {}),
      };
    }
    throw err;
  }
}
