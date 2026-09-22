import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  employeesTable,
  usersTable,
  warehouseShiftsTable,
  warehouseShiftMembersTable,
  attendanceRecordsTable,
} from "@workspace/db";
import {
  ensureOmborxonaDepartmentId,
  isOmborStaffRole,
} from "./omborxona-department";
import {
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

export async function createWarehouseShift(input: {
  name: string;
  startHm: string;
  endHm: string;
  overnight?: boolean;
  createdById?: number | null;
  departmentId?: number;
}) {
  const departmentId = input.departmentId ?? (await ensureOmborxonaDepartmentId());
  const startHm = normalizeHm(input.startHm);
  const endHm = normalizeHm(input.endHm);
  if (!startHm || !endHm) throw new Error("Vaqt HH:MM formatida bo‘lsin");
  const overnight =
    input.overnight === true ||
    (input.overnight !== false && hmToMinutes(endHm) <= hmToMinutes(startHm));
  const [created] = await db
    .insert(warehouseShiftsTable)
    .values({
      departmentId,
      name: input.name.trim(),
      startHm,
      endHm,
      overnight,
      active: true,
      createdById: input.createdById ?? null,
    })
    .returning();
  return created;
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

export async function assignEmployeeToShift(input: {
  shiftId: number;
  employeeId: number;
  assignedById?: number | null;
  note?: string | null;
}) {
  const shift = await getWarehouseShiftById(input.shiftId);
  if (!shift || !shift.active) throw new Error("Smena topilmadi yoki o‘chirilgan");

  const [emp] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, input.employeeId))
    .limit(1);
  if (!emp) throw new Error("Xodim topilmadi");
  if (emp.departmentId !== shift.departmentId) {
    throw new Error("Faqat Omborxona xodimlarini biriktirish mumkin");
  }

  await db
    .update(warehouseShiftMembersTable)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(warehouseShiftMembersTable.employeeId, input.employeeId),
        eq(warehouseShiftMembersTable.active, true),
      ),
    );

  const [created] = await db
    .insert(warehouseShiftMembersTable)
    .values({
      shiftId: shift.id,
      employeeId: input.employeeId,
      departmentId: shift.departmentId,
      active: true,
      assignedById: input.assignedById ?? null,
      note: input.note?.trim() || null,
    })
    .returning();

  const encoded = encodeWarehouseShiftType(shift.startHm, shift.endHm, shift.overnight);
  await db
    .update(employeesTable)
    .set({
      shiftType: encoded,
      shiftLabel: shift.name,
    })
    .where(eq(employeesTable.id, input.employeeId));

  return created;
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
      shiftType: "office",
      shiftLabel: null,
    })
    .where(eq(employeesTable.id, employeeId));
}

export async function warehouseHolatForDate(workDate: string, departmentId?: number) {
  const deptId = departmentId ?? (await ensureOmborxonaDepartmentId());
  const { shifts } = await listWarehouseShifts({ departmentId: deptId, includeInactive: false });
  const members = await db
    .select({
      memberId: warehouseShiftMembersTable.id,
      shiftId: warehouseShiftMembersTable.shiftId,
      employeeId: warehouseShiftMembersTable.employeeId,
      fullName: employeesTable.fullName,
      position: employeesTable.position,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
    })
    .from(warehouseShiftMembersTable)
    .innerJoin(employeesTable, eq(warehouseShiftMembersTable.employeeId, employeesTable.id))
    .where(
      and(
        eq(warehouseShiftMembersTable.departmentId, deptId),
        eq(warehouseShiftMembersTable.active, true),
      ),
    );

  const empIds = members.map((m) => m.employeeId);
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

  return shifts.map((s) => {
    const sm = members.filter((m) => m.shiftId === s.id);
    return {
      shift: {
        id: s.id,
        name: s.name,
        startHm: s.startHm,
        endHm: s.endHm,
        overnight: s.overnight,
        checkoutDeadlineHm: warehouseCheckoutDeadlineHm(workDate, s.endHm, s.overnight),
      },
      members: sm.map((m) => {
        const rec = byEmp.get(m.employeeId);
        return {
          employeeId: m.employeeId,
          fullName: m.fullName,
          position: m.position,
          checkInAt: rec?.checkInAt?.toISOString() ?? null,
          checkOutAt: rec?.checkOutAt?.toISOString() ?? null,
          status: rec?.status ?? "kutilmoqda",
        };
      }),
    };
  });
}
