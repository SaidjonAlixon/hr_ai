import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  db,
  employeesTable,
  staffingAlertsTable,
  employeeWorkSlotsTable,
  employeeBranchAssignmentsTable,
} from "@workspace/db";
import { displayBranchName } from "./geo-location";
import { ymdInTashkent } from "./shift-hours";
import { addDaysYmd } from "./attendance-engine";

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type EmployeeRow = typeof employeesTable.$inferSelect;
export type PharmacyOrgRole = "manager" | "pharmacist" | "intern";

const BRANCH_STAFF_ORG = ["pharmacist", "intern", "supervisor"];

/**
 * Filial = mudir qatori (employees.id). Mudir almashganda filial yangi qatorga o‘tadi,
 * shuning uchun shu id ga bog‘langan hamma narsa ham birga ko‘chishi kerak.
 */
const BRANCH_REF_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["employees", "assigned_branch_id"],
  ["branch_attendance_qr", "branch_id"],
  ["branch_contacts", "branch_employee_id"],
  ["branch_open_logs", "branch_id"],
  ["branch_audits", "manager_employee_id"],
  ["branch_needs", "manager_employee_id"],
  ["staff_need_requests", "manager_employee_id"],
  ["staffing_alerts", "manager_employee_id"],
  ["coordinator_branch_visits", "branch_id"],
  ["revision_visits", "branch_id"],
  ["employee_branch_assignments", "branch_id"],
  ["employee_work_slots", "branch_id"],
  ["attendance_records", "resolved_branch_id"],
  ["attendance_shift_segments", "branch_id"],
  ["attendance_punch_audit", "branch_id"],
  ["attestatsiya_attempts", "branch_id"],
  ["mobile_attendance_sessions", "branch_id"],
];

let presentRefColumns: Promise<Array<readonly [string, string]>> | null = null;

function branchRefColumns(): Promise<Array<readonly [string, string]>> {
  presentRefColumns ??= db
    .execute(sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
    `)
    .then((r) => {
      const rows = r.rows as Array<{ table_name: string; column_name: string }>;
      const have = new Set(rows.map((x) => `${x.table_name}.${x.column_name}`));
      return BRANCH_REF_COLUMNS.filter(([t, c]) => have.has(`${t}.${c}`));
    })
    .catch((err) => {
      presentRefColumns = null;
      throw err;
    });
  return presentRefColumns;
}

export function positionForOrgRole(orgRole: PharmacyOrgRole | "supervisor"): string {
  if (orgRole === "manager") return "Filial mudiri";
  if (orgRole === "intern") return "Stajyor";
  if (orgRole === "supervisor") return "Boshqaruvchi";
  return "Farmasevt";
}

export function userRoleForOrgRole(orgRole: PharmacyOrgRole): "mudir" | "farmasevt" | "stajyor" {
  if (orgRole === "manager") return "mudir";
  if (orgRole === "intern") return "stajyor";
  return "farmasevt";
}

export function orgRoleLabel(orgRole: PharmacyOrgRole): string {
  if (orgRole === "manager") return "mudir";
  if (orgRole === "intern") return "stajyor";
  return "farmasevt";
}

export function branchLabelOf(row: Pick<EmployeeRow, "location" | "fullName" | "userId">): string {
  const fromLoc = displayBranchName(row.location) || (row.location || "").split("|")[0]!.trim();
  if (fromLoc) return fromLoc;
  return row.userId ? "Filial" : row.fullName || "Filial";
}

function keepWorkingStatus(status: string | null | undefined): string {
  return status === "new" || status === "on_leave" ? status : "working";
}

/** Filialga bog‘liq yozuvlarni bir qatordan ikkinchisiga ko‘chiradi (jamoa, QR, smena, audit, tarix). */
export async function moveBranchRefs(tx: DbTx, fromId: number, toId: number): Promise<void> {
  if (fromId === toId) return;
  await tx
    .update(employeesTable)
    .set({ reportsToId: toId })
    .where(and(eq(employeesTable.reportsToId, fromId), inArray(employeesTable.orgRole, BRANCH_STAFF_ORG)));
  for (const [table, column] of await branchRefColumns()) {
    try {
      // Unikal indeks to‘qnashsa (masalan bir kunda ikki ochilish logi) — shu jadval o‘tkazib yuboriladi
      await tx.transaction(async (sp) => {
        await sp.execute(
          sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(column)} = ${toId} WHERE ${sql.identifier(column)} = ${fromId}`,
        );
      });
    } catch (err) {
      console.warn(`moveBranchRefs ${table}.${column} ${fromId}->${toId}:`, err);
    }
  }
}

/** Mudirsiz filial qatori — nom, GPS, raqam, koordinator saqlanadi. */
export async function createVacantBranchSlot(tx: DbTx, mudir: EmployeeRow): Promise<number> {
  const label = displayBranchName(mudir.location) || mudir.location || "Filial";
  const [slot] = await tx
    .insert(employeesTable)
    .values({
      fullName: label,
      position: "Filial mudiri",
      departmentId: mudir.departmentId,
      hiredAt: ymdInTashkent(new Date()),
      orgRole: "manager",
      reportsToId: mudir.reportsToId,
      location: mudir.location,
      latitude: mudir.latitude,
      longitude: mudir.longitude,
      shiftType: mudir.shiftType,
      shiftLabel: mudir.shiftLabel,
      qrFaceOnly: mudir.qrFaceOnly,
      branchNo: mudir.branchNo,
      userId: null,
      employmentStatus: "no_manager",
      createdById: mudir.createdById,
    })
    .returning({ id: employeesTable.id });
  return slot!.id;
}

/**
 * Mudirni filialdan ajratadi. Filial bo‘sh slot bo‘lib shu koordinatorda qoladi,
 * odamning qatori (davomat, oylik tarixi) o‘zgarmaydi. Qaytadi: filialning yangi id si.
 */
export async function detachMudirFromBranch(tx: DbTx, mudir: EmployeeRow): Promise<number> {
  const placeholderId = await createVacantBranchSlot(tx, mudir);
  await tx
    .update(employeesTable)
    .set({ branchNo: null, qrFaceOnly: false })
    .where(eq(employeesTable.id, mudir.id));
  await moveBranchRefs(tx, mudir.id, placeholderId);
  return placeholderId;
}

/** Bo‘sh filialga mavjud xodimni mudir qilib qo‘yadi — xodimning o‘z qatori filialga aylanadi. */
export async function occupyVacantBranch(tx: DbTx, slot: EmployeeRow, person: EmployeeRow): Promise<void> {
  await tx.update(employeesTable).set({ branchNo: null }).where(eq(employeesTable.id, slot.id));
  await tx
    .update(employeesTable)
    .set({
      orgRole: "manager",
      position: positionForOrgRole("manager"),
      reportsToId: slot.reportsToId,
      assignedBranchId: null,
      location: slot.location,
      latitude: slot.latitude,
      longitude: slot.longitude,
      branchNo: slot.branchNo,
      qrFaceOnly: slot.qrFaceOnly,
      employmentStatus: keepWorkingStatus(person.employmentStatus),
    })
    .where(eq(employeesTable.id, person.id));
  await moveBranchRefs(tx, slot.id, person.id);
  await tx.delete(staffingAlertsTable).where(eq(staffingAlertsTable.employeeId, slot.id));
  await tx.delete(employeesTable).where(and(eq(employeesTable.id, slot.id), isNull(employeesTable.userId)));
}

/** Xodimni filialga farmasevt / stajyor qilib biriktiradi. */
export async function placeAsBranchStaff(
  tx: DbTx,
  person: EmployeeRow,
  branch: EmployeeRow,
  orgRole: Exclude<PharmacyOrgRole, "manager">,
): Promise<void> {
  await tx
    .update(employeesTable)
    .set({
      orgRole,
      position: positionForOrgRole(orgRole),
      reportsToId: branch.id,
      assignedBranchId: null,
      location: branch.location,
      latitude: branch.latitude,
      longitude: branch.longitude,
      branchNo: null,
      qrFaceOnly: false,
      employmentStatus: keepWorkingStatus(person.employmentStatus),
    })
    .where(eq(employeesTable.id, person.id));
}

/**
 * Doimiy ko‘chirishda eski filialdagi smena slotlari va biriktirishlarni bugundan yopadi.
 * O‘tgan kunlar tarixi saqlanadi. keepBranchId — yangi filial (mudir uchun null: slot kerak emas).
 */
export async function endPlacementsOutside(
  tx: DbTx,
  employeeId: number,
  keepBranchId: number | null,
): Promise<void> {
  const today = ymdInTashkent(new Date());
  const yesterday = addDaysYmd(today, -1);
  const slotOther =
    keepBranchId == null ? undefined : ne(employeeWorkSlotsTable.branchId, keepBranchId);
  await tx
    .update(employeeWorkSlotsTable)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(employeeWorkSlotsTable.employeeId, employeeId),
        eq(employeeWorkSlotsTable.active, true),
        gte(employeeWorkSlotsTable.validFrom, today),
        slotOther,
      ),
    );
  await tx
    .update(employeeWorkSlotsTable)
    .set({ validTo: yesterday, updatedAt: new Date() })
    .where(
      and(
        eq(employeeWorkSlotsTable.employeeId, employeeId),
        eq(employeeWorkSlotsTable.active, true),
        lt(employeeWorkSlotsTable.validFrom, today),
        or(isNull(employeeWorkSlotsTable.validTo), gte(employeeWorkSlotsTable.validTo, today)),
        slotOther,
      ),
    );

  const assignOther =
    keepBranchId == null ? undefined : ne(employeeBranchAssignmentsTable.branchId, keepBranchId);
  await tx
    .delete(employeeBranchAssignmentsTable)
    .where(
      and(
        eq(employeeBranchAssignmentsTable.employeeId, employeeId),
        gte(employeeBranchAssignmentsTable.validFrom, today),
        assignOther,
      ),
    );
  await tx
    .update(employeeBranchAssignmentsTable)
    .set({ validTo: yesterday })
    .where(
      and(
        eq(employeeBranchAssignmentsTable.employeeId, employeeId),
        lt(employeeBranchAssignmentsTable.validFrom, today),
        or(
          isNull(employeeBranchAssignmentsTable.validTo),
          gte(employeeBranchAssignmentsTable.validTo, today),
        ),
        assignOther,
      ),
    );
}
