import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  employeesTable,
  usersTable,
  warehouseShiftsTable,
  warehouseShiftMembersTable,
  attendanceRecordsTable,
  employeeScheduleOverridesTable,
} from "@workspace/db";
import {
  ensureOmborxonaDepartmentId,
  isOmborStaffRole,
  WAREHOUSE_FREE_END_HM,
  WAREHOUSE_FREE_LABEL,
  WAREHOUSE_FREE_START_HM,
} from "./omborxona-department";
import {
  encodeWarehouseFreeShiftType,
  encodeWarehouseShiftType,
  hmToMinutes,
  warehouseCheckoutDeadlineHm,
} from "./shift-hours";

const HM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function normalizeHm(raw: string): string | null {
  const s = String(raw || "").trim();
  const m = HM_RE.exec(s);
  if (!m) return null;
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

export async function listWarehouseShifts(opts?: {
  departmentId?: number;
  includeInactive?: boolean;
}) {
  const departmentId = opts?.departmentId ?? (await ensureOmborxonaDepartmentId());
  const rows = await db
    .select()
    .from(warehouseShiftsTable)
    .where(
      opts?.includeInactive
        ? eq(warehouseShiftsTable.departmentId, departmentId)
        : and(
            eq(warehouseShiftsTable.departmentId, departmentId),
            eq(warehouseShiftsTable.active, true),
          ),
    )
    .orderBy(asc(warehouseShiftsTable.startHm), asc(warehouseShiftsTable.id));
  return { departmentId, shifts: rows };
}

export async function getWarehouseShiftById(id: number) {
  const [row] = await db
    .select()
    .from(warehouseShiftsTable)
    .where(eq(warehouseShiftsTable.id, id))
    .limit(1);
  return row ?? null;
}

export async function createWarehouseShift(_input: {
  name: string;
  startHm: string;
  endHm: string;
  overnight?: boolean;
  createdById?: number | null;
  departmentId?: number;
}): Promise<never> {
  throw new Error(
    "Omborxona endi erkin grafikda (08:00 → ertasi 07:00). Yangi smena yaratish o‘chirilgan.",
  );
}

export async function updateWarehouseShift(
  id: number,
  patch: {
    name?: string;
    startHm?: string;
    endHm?: string;
    overnight?: boolean;
    active?: boolean;
  },
) {
  const existing = await getWarehouseShiftById(id);
  if (!existing) return null;
  const updates: Partial<typeof warehouseShiftsTable.$inferInsert> = {};
  if (typeof patch.name === "string" && patch.name.trim()) updates.name = patch.name.trim();
  if (patch.startHm != null) {
    const hm = normalizeHm(patch.startHm);
    if (!hm) throw new Error("Boshlanish vaqti noto‘g‘ri");
    updates.startHm = hm;
  }
  if (patch.endHm != null) {
    const hm = normalizeHm(patch.endHm);
    if (!hm) throw new Error("Tugash vaqti noto‘g‘ri");
    updates.endHm = hm;
  }
  if (typeof patch.active === "boolean") updates.active = patch.active;
  if (typeof patch.overnight === "boolean") updates.overnight = patch.overnight;

  const startHm = updates.startHm ?? existing.startHm;
  const endHm = updates.endHm ?? existing.endHm;
  if (updates.overnight === undefined && (updates.startHm || updates.endHm)) {
    updates.overnight = hmToMinutes(endHm) <= hmToMinutes(startHm);
  }

  if (!Object.keys(updates).length) return existing;
  const [updated] = await db
    .update(warehouseShiftsTable)
    .set(updates)
    .where(eq(warehouseShiftsTable.id, id))
    .returning();

  if (updated && (updates.startHm || updates.endHm || updates.name || updates.overnight != null)) {
    const members = await db
      .select({ employeeId: warehouseShiftMembersTable.employeeId })
      .from(warehouseShiftMembersTable)
      .where(
        and(
          eq(warehouseShiftMembersTable.shiftId, id),
          eq(warehouseShiftMembersTable.active, true),
        ),
      );
    if (members.length) {
      const encoded = encodeWarehouseShiftType(
        updated.startHm,
        updated.endHm,
        updated.overnight,
      );
      await db
        .update(employeesTable)
        .set({
          shiftType: encoded,
          shiftLabel: updated.name,
        })
        .where(
          inArray(
            employeesTable.id,
            members.map((m) => m.employeeId),
          ),
        );
    }
  }
  return updated;
}

export async function listOmborEmployees(departmentId?: number) {
  const deptId = departmentId ?? (await ensureOmborxonaDepartmentId());
  const rows = await db
    .select({
      employeeId: employeesTable.id,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      employmentStatus: employeesTable.employmentStatus,
      userId: employeesTable.userId,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      userRole: usersTable.role,
      login: usersTable.login,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(employeesTable.userId, usersTable.id))
    .where(eq(employeesTable.departmentId, deptId))
    .orderBy(asc(employeesTable.fullName));

  return rows.filter((r) => {
    const role = String(r.userRole || "").trim();
    if (!role) return true;
    return isOmborStaffRole(role);
  });
}

export async function listShiftMembers(shiftId: number) {
  return db
    .select({
      id: warehouseShiftMembersTable.id,
      shiftId: warehouseShiftMembersTable.shiftId,
      employeeId: warehouseShiftMembersTable.employeeId,
      active: warehouseShiftMembersTable.active,
      note: warehouseShiftMembersTable.note,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      userRole: usersTable.role,
    })
    .from(warehouseShiftMembersTable)
    .innerJoin(employeesTable, eq(warehouseShiftMembersTable.employeeId, employeesTable.id))
    .leftJoin(usersTable, eq(employeesTable.userId, usersTable.id))
    .where(
      and(
        eq(warehouseShiftMembersTable.shiftId, shiftId),
        eq(warehouseShiftMembersTable.active, true),
      ),
    )
    .orderBy(asc(employeesTable.fullName));
}

export async function getActiveMemberForEmployee(employeeId: number) {
  const [row] = await db
    .select({
      member: warehouseShiftMembersTable,
      shift: warehouseShiftsTable,
    })
    .from(warehouseShiftMembersTable)
    .innerJoin(
      warehouseShiftsTable,
      eq(warehouseShiftMembersTable.shiftId, warehouseShiftsTable.id),
    )
    .where(
      and(
        eq(warehouseShiftMembersTable.employeeId, employeeId),
        eq(warehouseShiftMembersTable.active, true),
        eq(warehouseShiftsTable.active, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Barcha omborxona xodimlarini erkin grafikga o‘tkazadi, smenalarni o‘chiradi */
export async function applyWarehouseFreeSchedule(): Promise<{
  employees: number;
  shiftsOff: number;
  membersOff: number;
  overridesOff: number;
}> {
  const departmentId = await ensureOmborxonaDepartmentId();
  const encoded = encodeWarehouseFreeShiftType();

  const staff = await db
    .select({
      id: employeesTable.id,
      userRole: usersTable.role,
    })
    .from(employeesTable)
    .leftJoin(usersTable, eq(employeesTable.userId, usersTable.id))
    .where(eq(employeesTable.departmentId, departmentId));

  const empIds = staff
    .filter((r) => {
      const role = String(r.userRole || "").trim();
      return !role || isOmborStaffRole(role);
    })
    .map((r) => r.id);

  let employees = 0;
  if (empIds.length) {
    await db
      .update(employeesTable)
      .set({
        shiftType: encoded,
        shiftLabel: WAREHOUSE_FREE_LABEL,
      })
      .where(inArray(employeesTable.id, empIds));
    employees = empIds.length;

    await db
      .update(employeeScheduleOverridesTable)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          inArray(employeeScheduleOverridesTable.employeeId, empIds),
          eq(employeeScheduleOverridesTable.active, true),
        ),
      );
  }

  const membersOff = await db
    .update(warehouseShiftMembersTable)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(warehouseShiftMembersTable.departmentId, departmentId),
        eq(warehouseShiftMembersTable.active, true),
      ),
    )
    .returning({ id: warehouseShiftMembersTable.id });

  const shiftsOff = await db
    .update(warehouseShiftsTable)
    .set({ active: false })
    .where(
      and(eq(warehouseShiftsTable.departmentId, departmentId), eq(warehouseShiftsTable.active, true)),
    )
    .returning({ id: warehouseShiftsTable.id });

  // overridesOff count — approximate via empIds update (no returning on all DBs easily)
  return {
    employees,
    shiftsOff: shiftsOff.length,
    membersOff: membersOff.length,
    overridesOff: empIds.length,
  };
}

export async function assignEmployeeToShift(_input: {
  shiftId: number;
  employeeId: number;
  assignedById?: number | null;
  note?: string | null;
}): Promise<never> {
  throw new Error(
    "Omborxona endi erkin grafikda (08:00 → ertasi 07:00). Smena biriktirish o‘chirilgan.",
  );
}

export async function unassignEmployee(employeeId: number) {
  await db
    .update(warehouseShiftMembersTable)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(warehouseShiftMembersTable.employeeId, employeeId),
        eq(warehouseShiftMembersTable.active, true),
      ),
    );
  await db
    .update(employeesTable)
    .set({
      shiftType: encodeWarehouseFreeShiftType(),
      shiftLabel: WAREHOUSE_FREE_LABEL,
    })
    .where(eq(employeesTable.id, employeeId));
}

export async function warehouseHolatForDate(workDate: string, departmentId?: number) {
  const deptId = departmentId ?? (await ensureOmborxonaDepartmentId());
  const staff = await listOmborEmployees(deptId);
  const empIds = staff.map((m) => m.employeeId);
  const records =
    empIds.length === 0
      ? []
      : await db
          .select({
            employeeId: attendanceRecordsTable.employeeId,
            checkInAt: attendanceRecordsTable.checkInAt,
            checkOutAt: attendanceRecordsTable.checkOutAt,
            status: attendanceRecordsTable.status,
          })
          .from(attendanceRecordsTable)
          .where(
            and(
              eq(attendanceRecordsTable.workDate, workDate),
              inArray(attendanceRecordsTable.employeeId, empIds),
            ),
          );
  const byEmp = new Map(records.map((r) => [r.employeeId, r]));

  return [
    {
      shift: {
        id: 0,
        name: WAREHOUSE_FREE_LABEL,
        startHm: WAREHOUSE_FREE_START_HM,
        endHm: WAREHOUSE_FREE_END_HM,
        overnight: true,
        checkoutDeadlineHm: warehouseCheckoutDeadlineHm(workDate, WAREHOUSE_FREE_END_HM, true, {
          flexible: true,
        }),
      },
      members: staff.map((m) => {
        const rec = byEmp.get(m.employeeId);
        return {
          employeeId: m.employeeId,
          fullName: m.fullName,
          position: m.position,
          checkInAt: rec?.checkInAt?.toISOString() ?? null,
          checkOutAt: rec?.checkOutAt?.toISOString() ?? null,
          status: rec?.status ?? "kutilmoqda",
          statusLabel: (() => {
            const st = String(rec?.status || "").toLowerCase();
            if (rec?.checkInAt && !rec?.checkOutAt) return "Ishda";
            // Erkin grafikda kechikish yo‘q — late bo‘lsa ham «Kelgan»
            if (rec?.checkInAt && rec?.checkOutAt) return st === "absent" ? "Kelmagan" : "Kelgan";
            if (st === "present") return "Kelgan";
            if (st === "absent") return "Kelmagan";
            if (st === "incomplete") return "Ketish yo‘q";
            if (st === "late") return "Kelgan";
            return "Kutilmoqda";
          })(),
        };
      }),
    },
  ];
}
