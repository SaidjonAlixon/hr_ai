/**
 * Javob olish — 1-koordinator → (8 soat) HR menejer/direktor → yakuniy.
 * Tasdiqlangan soat/kun davomat jarimasidan ozod.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNotNull, lte, ne, or } from "drizzle-orm";
import {
  db,
  employeesTable,
  usersTable,
  javobOlishRequestsTable,
  employeeDayShiftPlansTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { isHrRole, isDirectorRole, isDeptHeadRole, DEPT_HEAD_ROLES } from "../lib/roles";
import { departmentNameForRole, ROLE_DEPARTMENT_NAME } from "../lib/role-departments";
import { notifyUser, notifyByRoles } from "../lib/notify";
import {
  hoursForStaff,
  encodeShiftKeys,
  parseShiftKeys,
  hmToMinutes,
} from "../lib/shift-hours";
import { getEffectiveShiftDefs } from "../lib/shift-schedule";
import { displayBranchName } from "../lib/geo-location";
import { excuseAttendanceFromApprovedJavob } from "../lib/javob-exemptions";

const router: IRouter = Router();

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const OPEN_STATUSES = ["pending", "pending_coord", "pending_dept", "pending_hr"] as const;

function usesCoordinatorChain(role: string) {
  return (
    role === "mudir" ||
    role === "farmasevt" ||
    role === "stajyor" ||
    role === "stajor" ||
    role === "koordinator"
  );
}

function isCoordRole(role: string) {
  return role === "koordinator";
}

function isHrApprover(role: string) {
  return (
    role === "hr_menejer" ||
    role === "hr_direktor" ||
    role === "hr" ||
    role === "hr_kadr_rahbar" ||
    role === "admin" ||
    isDirectorRole(role)
  );
}

/** Admin/rahbar koordinator bosqichini ham yakuniy qaror bilan yopa oladi */
function isFinalOverrideRole(role: string) {
  return role === "admin" || isDirectorRole(role);
}

function canActOn(role: string, status: string): boolean {
  if (status === "pending_coord") return isCoordRole(role) || isFinalOverrideRole(role);
  if (status === "pending_dept") return isDeptHeadRole(role) || isFinalOverrideRole(role);
  if (status === "pending_hr") return isHrApprover(role);
  return false;
}

function isLead(role: string) {
  return role === "admin" || isDirectorRole(role) || isCoordRole(role) || isHrRole(role);
}

function durationMinutes(fromHm: string, toHm: string): number {
  let a = hmToMinutes(fromHm);
  let b = hmToMinutes(toHm);
  if (b <= a) b += 24 * 60;
  return b - a;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} soat ${m} daqiqa`;
  if (h) return `${h} soat`;
  return `${m} daqiqa`;
}

function fmtDt(d: Date | string | null | undefined) {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "—";
  return x.toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function empByUserId(userId: number) {
  const [row] = await db
    .select({
      id: employeesTable.id,
      userId: employeesTable.userId,
      fullName: employeesTable.fullName,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
      assignedBranchId: employeesTable.assignedBranchId,
      shiftType: employeesTable.shiftType,
      shiftLabel: employeesTable.shiftLabel,
      location: employeesTable.location,
    })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);
  return row ?? null;
}

async function dayShiftTypeFor(employeeId: number, workDate: string): Promise<string | null> {
  const [plan] = await db
    .select({ shiftKeys: employeeDayShiftPlansTable.shiftKeys })
    .from(employeeDayShiftPlansTable)
    .where(
      and(
        eq(employeeDayShiftPlansTable.employeeId, employeeId),
        eq(employeeDayShiftPlansTable.workDate, workDate),
      ),
    )
    .limit(1);
  if (!plan?.shiftKeys?.length) return null;
  const keys = (plan.shiftKeys as string[]).filter((k) => k === "one" || k === "two" || k === "three");
  if (!keys.length) return null;
  return encodeShiftKeys(keys as ("one" | "two" | "three")[]);
}

async function resolveShiftForDate(
  emp: NonNullable<Awaited<ReturnType<typeof empByUserId>>>,
  workDate: string,
  userRole: string,
) {
  const defs = await getEffectiveShiftDefs();
  const dayType = await dayShiftTypeFor(emp.id, workDate);
  const shiftType = dayType || emp.shiftType || "one";
  const shiftLabel = dayType ? null : emp.shiftLabel;
  const hours = hoursForStaff(emp.orgRole, shiftType, userRole, shiftLabel, defs);
  const keys = parseShiftKeys(shiftType, shiftLabel);
  return {
    shiftType: keys.length > 1 ? encodeShiftKeys(keys as ("one" | "two" | "three")[]) : hours.shiftKey || "one",
    shiftLabel:
      keys.length > 1
        ? `${keys.map((k) => (k === "one" ? "1" : k === "two" ? "2" : "3")).join("+")}-smena ${hours.start}–${hours.end}`
        : `${hours.shiftKey === "two" ? "2" : hours.shiftKey === "three" ? "3" : hours.shiftKey === "office" ? "Ofis" : "1"}-smena ${hours.start}–${hours.end}`,
    shiftStartHm: hours.start,
    shiftEndHm: hours.end,
    overnight: Boolean(hours.overnight),
    durationLabel: formatDuration(durationMinutes(hours.start, hours.end)),
  };
}

/** Shu bo‘limning boshlig‘i. Lavozim yo‘q yoki o‘zi boshliq bo‘lsa — null, HR ga o‘tadi. */
async function findOfficeDeptHeadUserId(role: string, userId: number): Promise<number | null> {
  const deptName = departmentNameForRole(role);
  if (!deptName) return null;
  const headRoles = Object.entries(ROLE_DEPARTMENT_NAME)
    .filter(([candidate, name]) => name === deptName && (DEPT_HEAD_ROLES as readonly string[]).includes(candidate))
    .map(([candidate]) => candidate);
  if (!headRoles.length) return null;
  const [head] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.role, headRoles),
        eq(usersTable.status, "active"),
        ne(usersTable.id, userId),
      ),
    )
    .limit(1);
  return head?.id ?? null;
}

async function findCoordinatorUserId(empId: number): Promise<number | null> {
  let currentId: number | null = empId;
  for (let i = 0; i < 6 && currentId; i++) {
    const [row] = await db
      .select({
        reportsToId: employeesTable.reportsToId,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(eq(employeesTable.id, currentId))
      .limit(1);
    if (!row?.reportsToId) break;
    const [mgr] = await db
      .select({
        id: employeesTable.id,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(eq(employeesTable.id, row.reportsToId))
      .limit(1);
    if (!mgr) break;
    if (mgr.userId) {
      const [u] = await db
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, mgr.userId))
        .limit(1);
      if (u?.role === "koordinator") return mgr.userId;
    }
    currentId = mgr.id;
  }
  return null;
}

async function coordinatorScopeEmployeeIds(coordEmpId: number): Promise<Set<number>> {
  const mgrs = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.reportsToId, coordEmpId));
  const ids = new Set(mgrs.map((m) => m.id));
  ids.add(coordEmpId);
  if (!ids.size) return ids;
  const staff = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(
      or(inArray(employeesTable.reportsToId, [...ids]), inArray(employeesTable.assignedBranchId, [...ids])),
    );
  for (const s of staff) ids.add(s.id);
  return ids;
}

function normalizeStatus(s: string) {
  if (s === "pending") return "pending_coord";
  return s;
}

type EmpLite = {
  id: number;
  fullName: string;
  location: string | null;
  orgRole: string | null;
  reportsToId: number | null;
  assignedBranchId: number | null;
  userId: number | null;
};

function branchLabelFromEmp(
  emp: EmpLite | undefined,
  byId: Map<number, EmpLite>,
): string | null {
  if (!emp) return null;
  if (emp.assignedBranchId) {
    const br = byId.get(emp.assignedBranchId);
    if (br) {
      return (
        displayBranchName(br.location) ||
        br.location ||
        br.fullName ||
        null
      );
    }
  }
  if (emp.orgRole === "manager") {
    return displayBranchName(emp.location) || emp.location || emp.fullName || null;
  }
  let cursor: EmpLite | undefined = emp;
  for (let i = 0; i < 5 && cursor?.reportsToId; i++) {
    const mgr = byId.get(cursor.reportsToId);
    if (!mgr) break;
    if (mgr.orgRole === "manager") {
      return displayBranchName(mgr.location) || mgr.location || mgr.fullName || null;
    }
    cursor = mgr;
  }
  return displayBranchName(emp.location) || emp.location || null;
}

function serializeRow(
  r: typeof javobOlishRequestsTable.$inferSelect,
  extra?: {
    fullName?: string | null;
    branchLabel?: string | null;
    coordinatorName?: string | null;
    deptStep?: boolean;
    coordDecidedByName?: string | null;
    decidedByName?: string | null;
  },
) {
  const status = normalizeStatus(r.status);
  const fullDay = r.fromHm === r.shiftStartHm && r.toHm === r.shiftEndHm;
  const timeline: Array<{
    key: string;
    label: string;
    at: string | null;
    atLabel: string;
    by: string | null;
    note: string | null;
  }> = [];

  timeline.push({
    key: "sent",
    label: "So‘rov yuborildi",
    at: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    atLabel: fmtDt(r.createdAt),
    by: extra?.fullName || null,
    note: null,
  });

  const stepName = extra?.deptStep ? "Bo‘lim boshlig‘i" : "Koordinator";
  if (r.coordDecidedAt && !r.escalatedAt) {
    const coordRejected = status === "rejected" && !r.decidedAt;
    timeline.push({
      key: "coord",
      label: coordRejected ? `${stepName} rad etdi` : `${stepName} tasdiqladi`,
      at: new Date(r.coordDecidedAt).toISOString(),
      atLabel: fmtDt(r.coordDecidedAt),
      by: extra?.coordDecidedByName || extra?.coordinatorName || null,
      note: r.coordDecisionNote || null,
    });
  }

  if (r.escalatedAt) {
    timeline.push({
      key: "escalated",
      label: extra?.deptStep ? "Bo‘lim boshlig‘i javob bermadi — HR ga o‘tdi" : "Koordinator javob bermadi — HR ga o‘tdi",
      at: new Date(r.escalatedAt).toISOString(),
      atLabel: fmtDt(r.escalatedAt),
      by: extra?.coordinatorName || null,
      note: r.escalatedNote || null,
    });
  }

  if (r.decidedAt && (status === "approved" || status === "rejected") && r.decidedById) {
    // HR final (or coord reject that also set decidedById — skip duplicate if same as coord-only reject)
    const isCoordOnlyReject =
      status === "rejected" &&
      r.coordDecidedAt &&
      !r.escalatedAt &&
      r.decidedById === r.coordDecidedById &&
      timeline.some((t) => t.key === "coord");
    if (!isCoordOnlyReject) {
      const direct = !r.coordDecidedAt && !r.escalatedAt;
      timeline.push({
        key: "hr",
        label: direct
          ? status === "approved"
            ? "Rahbariyat to‘g‘ridan-to‘g‘ri tasdiqladi"
            : "Rahbariyat to‘g‘ridan-to‘g‘ri rad etdi"
          : status === "approved"
            ? "HR yakuniy tasdiqladi"
            : "HR rad etdi",
        at: new Date(r.decidedAt).toISOString(),
        atLabel: fmtDt(r.decidedAt),
        by: extra?.decidedByName || null,
        note: r.decisionNote || null,
      });
    }
  }

  if ((status === "pending_coord" || status === "pending_dept") && !r.coordDecidedAt && !r.escalatedAt) {
    timeline.push({
      key: "waiting_coord",
      label: status === "pending_dept" ? "Bo‘lim boshlig‘i javobi kutilmoqda" : "Koordinator javobi kutilmoqda",
      at: null,
      atLabel: "—",
      by: extra?.coordinatorName || null,
      note: null,
    });
  }
  if (status === "pending_hr" && !r.decidedAt) {
    timeline.push({
      key: "waiting_hr",
      label: "HR yakuniy ruxsati kutilmoqda",
      at: null,
      atLabel: "—",
      by: null,
      note: null,
    });
  }

  return {
    id: r.id,
    employeeId: r.employeeId,
    userId: r.userId,
    fullName: extra?.fullName || null,
    branchLabel: extra?.branchLabel || null,
    workDate: r.workDate,
    shiftType: r.shiftType,
    shiftLabel: r.shiftLabel,
    shiftStartHm: r.shiftStartHm,
    shiftEndHm: r.shiftEndHm,
    shiftOvernight: Boolean(r.shiftOvernight),
    fromHm: r.fromHm,
    toHm: r.toHm,
    durationMinutes: r.durationMinutes,
    durationLabel: formatDuration(r.durationMinutes),
    note: r.note,
    status,
    kind: fullDay ? ("day" as const) : ("hour" as const),
    coordinatorUserId: r.coordinatorUserId,
    coordinatorName: extra?.coordinatorName || null,
    coordDecidedById: r.coordDecidedById,
    coordDecidedByName: extra?.coordDecidedByName || null,
    coordDecidedAt: r.coordDecidedAt,
    coordDecisionNote: r.coordDecisionNote,
    escalatedAt: r.escalatedAt,
    escalatedNote: r.escalatedNote,
    decidedById: r.decidedById,
    decidedByName: extra?.decidedByName || null,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
    createdAtLabel: fmtDt(r.createdAt),
    escalatedAtLabel: fmtDt(r.escalatedAt),
    coordDecidedAtLabel: fmtDt(r.coordDecidedAt),
    decidedAtLabel: fmtDt(r.decidedAt),
    timeline,
  };
}

async function enrichRows(
  rows: (typeof javobOlishRequestsTable.$inferSelect)[],
): Promise<ReturnType<typeof serializeRow>[]> {
  if (!rows.length) return [];

  const empIds = [...new Set(rows.map((r) => r.employeeId))];
  const userIds = new Set<number>();
  for (const r of rows) {
    if (r.coordinatorUserId) userIds.add(r.coordinatorUserId);
    if (r.coordDecidedById) userIds.add(r.coordDecidedById);
    if (r.decidedById) userIds.add(r.decidedById);
  }

  const empRows = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
      assignedBranchId: employeesTable.assignedBranchId,
      userId: employeesTable.userId,
    })
    .from(employeesTable)
    .where(inArray(employeesTable.id, empIds));

  const relatedIds = new Set<number>();
  for (const e of empRows) {
    if (e.assignedBranchId) relatedIds.add(e.assignedBranchId);
    if (e.reportsToId) relatedIds.add(e.reportsToId);
  }
  // one more hop for mudir→coordinator chain branch resolve
  if (relatedIds.size) {
    const extra = await db
      .select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        location: employeesTable.location,
        orgRole: employeesTable.orgRole,
        reportsToId: employeesTable.reportsToId,
        assignedBranchId: employeesTable.assignedBranchId,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(inArray(employeesTable.id, [...relatedIds]));
    for (const e of extra) {
      empRows.push(e);
      if (e.reportsToId) relatedIds.add(e.reportsToId);
      if (e.assignedBranchId) relatedIds.add(e.assignedBranchId);
    }
    const stillMissing = [...relatedIds].filter((id) => !empRows.some((e) => e.id === id));
    if (stillMissing.length) {
      const more = await db
        .select({
          id: employeesTable.id,
          fullName: employeesTable.fullName,
          location: employeesTable.location,
          orgRole: employeesTable.orgRole,
          reportsToId: employeesTable.reportsToId,
          assignedBranchId: employeesTable.assignedBranchId,
          userId: employeesTable.userId,
        })
        .from(employeesTable)
        .where(inArray(employeesTable.id, stillMissing));
      empRows.push(...more);
    }
  }

  const empById = new Map<number, EmpLite>();
  for (const e of empRows) empById.set(e.id, e);

  // coordinator names may also come from employee.userId match
  for (const e of empById.values()) {
    if (e.userId) userIds.add(e.userId);
  }

  const users =
    userIds.size > 0
      ? await db
          .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
          .from(usersTable)
          .where(inArray(usersTable.id, [...userIds]))
      : [];
  const nameByUserId = new Map(users.map((u) => [u.id, u.fullName]));
  const roleByUserId = new Map(users.map((u) => [u.id, u.role]));

  return rows.map((r) => {
    const emp = empById.get(r.employeeId);
    return serializeRow(r, {
      fullName: emp?.fullName || null,
      branchLabel: branchLabelFromEmp(emp, empById),
      coordinatorName: r.coordinatorUserId
        ? nameByUserId.get(r.coordinatorUserId) || null
        : null,
      deptStep:
        r.status === "pending_dept" ||
        (r.coordinatorUserId != null && isDeptHeadRole(roleByUserId.get(r.coordinatorUserId))),
      coordDecidedByName: r.coordDecidedById
        ? nameByUserId.get(r.coordDecidedById) || null
        : null,
      decidedByName: r.decidedById ? nameByUserId.get(r.decidedById) || null : null,
    });
  });
}

router.get("/javob-olish/shifts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const me = await empByUserId(req.userId!);
  if (!me) {
    res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
    return;
  }
  const raw = String(req.query.dates || "");
  const dates = raw
    .split(",")
    .map((d) => d.trim())
    .filter((d) => YMD.test(d));
  if (!dates.length) {
    res.status(400).json({ error: "dates=YYYY-MM-DD,..." });
    return;
  }
  const role = req.userRole || "";
  const items = [];
  for (const d of dates.slice(0, 31)) {
    const shift = await resolveShiftForDate(me, d, role);
    items.push({ workDate: d, ...shift });
  }
  res.json({ items });
});

async function enrichOne(row: typeof javobOlishRequestsTable.$inferSelect) {
  const [item] = await enrichRows([row]);
  return item!;
}

router.get("/javob-olish", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  const me = await empByUserId(req.userId!);
  const statusFilter = req.query.status ? String(req.query.status) : null;
  const scope = String(req.query.scope || "mine");

  let rows: (typeof javobOlishRequestsTable.$inferSelect)[] = [];
  let canDecide = false;

  if (scope === "pending") {
    if (role === "admin" || isDirectorRole(role)) {
      rows = await db
        .select()
        .from(javobOlishRequestsTable)
        .where(inArray(javobOlishRequestsTable.status, ["pending", "pending_coord", "pending_dept", "pending_hr"]))
        .orderBy(desc(javobOlishRequestsTable.createdAt));
      canDecide = true;
    } else if (isCoordRole(role) && me) {
      rows = await db
        .select()
        .from(javobOlishRequestsTable)
        .where(inArray(javobOlishRequestsTable.status, ["pending", "pending_coord"]))
        .orderBy(desc(javobOlishRequestsTable.createdAt));
      const scopeIds = await coordinatorScopeEmployeeIds(me.id);
      rows = rows.filter((r) => scopeIds.has(r.employeeId) || r.coordinatorUserId === req.userId);
      canDecide = true;
    } else if (isHrApprover(role)) {
      rows = await db
        .select()
        .from(javobOlishRequestsTable)
        .where(inArray(javobOlishRequestsTable.status, ["pending", "pending_coord", "pending_dept", "pending_hr"]))
        .orderBy(desc(javobOlishRequestsTable.createdAt));
      canDecide = true;
    } else if (isDeptHeadRole(role)) {
      rows = await db
        .select()
        .from(javobOlishRequestsTable)
        .where(
          and(
            eq(javobOlishRequestsTable.status, "pending_dept"),
            eq(javobOlishRequestsTable.coordinatorUserId, req.userId!),
          ),
        )
        .orderBy(desc(javobOlishRequestsTable.createdAt));
      canDecide = true;
    } else {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    const items = await enrichRows(rows);
    res.json({
      items: items.map((it) => ({
        ...it,
        canAct:
          it.status === "pending_dept"
            ? (isDeptHeadRole(role) && it.coordinatorUserId === req.userId) || isFinalOverrideRole(role)
            : canActOn(role, it.status),
      })),
      canDecide,
      roleScope: isHrApprover(role) ? "hr" : isCoordRole(role) ? "coord" : isDeptHeadRole(role) ? "dept" : "none",
    });
    return;
  } else if (scope === "decided") {
    if (isHrApprover(role)) {
      rows = await db
        .select()
        .from(javobOlishRequestsTable)
        .where(
          and(
            inArray(javobOlishRequestsTable.status, ["approved", "rejected"]),
            isNotNull(javobOlishRequestsTable.decidedAt),
          ),
        )
        .orderBy(desc(javobOlishRequestsTable.decidedAt))
        .limit(300);
    } else if (isCoordRole(role) || isDeptHeadRole(role)) {
      rows = await db
        .select()
        .from(javobOlishRequestsTable)
        .where(eq(javobOlishRequestsTable.coordDecidedById, req.userId!))
        .orderBy(desc(javobOlishRequestsTable.coordDecidedAt))
        .limit(300);
    } else {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
  } else if (scope === "approved-by-me") {
    if (!isHrApprover(role)) {
      res.status(403).json({ error: "Faqat HR ko‘radi" });
      return;
    }
    rows = await db
      .select()
      .from(javobOlishRequestsTable)
      .where(
        and(
          eq(javobOlishRequestsTable.decidedById, req.userId!),
          eq(javobOlishRequestsTable.status, "approved"),
        ),
      )
      .orderBy(desc(javobOlishRequestsTable.decidedAt), desc(javobOlishRequestsTable.workDate))
      .limit(500);
    canDecide = false;
  } else if (scope === "all" && isLead(role)) {
    const employeeId = Number(req.query.employeeId);
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const personOnly = Number.isFinite(employeeId) && employeeId > 0;
    const conds = [];
    if (personOnly) conds.push(eq(javobOlishRequestsTable.employeeId, employeeId));
    if (YMD.test(from)) conds.push(gte(javobOlishRequestsTable.workDate, from));
    if (YMD.test(to)) conds.push(lte(javobOlishRequestsTable.workDate, to));
    const base = db.select().from(javobOlishRequestsTable);
    const filteredQ = conds.length ? base.where(and(...conds)) : base;
    rows = await filteredQ
      .orderBy(desc(javobOlishRequestsTable.workDate), desc(javobOlishRequestsTable.createdAt))
      .limit(personOnly ? 1000 : 800);
    if (isCoordRole(role) && me) {
      const scopeIds = await coordinatorScopeEmployeeIds(me.id);
      rows = rows.filter((r) => scopeIds.has(r.employeeId) || r.coordinatorUserId === req.userId);
    }
    canDecide = isCoordRole(role) || isHrApprover(role);
  } else {
    if (!me) {
      res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
      return;
    }
    const conds = [eq(javobOlishRequestsTable.employeeId, me.id)];
    if (statusFilter) conds.push(eq(javobOlishRequestsTable.status, statusFilter));
    rows = await db
      .select()
      .from(javobOlishRequestsTable)
      .where(and(...conds))
      .orderBy(desc(javobOlishRequestsTable.workDate))
      .limit(100);
  }

  res.json({
    items: await enrichRows(rows),
    canDecide,
    roleScope: isHrApprover(role) ? "hr" : isCoordRole(role) ? "coord" : "none",
  });
});

router.post("/javob-olish", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole || "";
  const me = await empByUserId(req.userId!);
  if (!me) {
    res.status(400).json({ error: "Xodim kartochkasi yo‘q" });
    return;
  }

  const sharedNote = String(req.body?.note || "").trim();
  type DayIn = { workDate?: string; fromHm?: string; toHm?: string; note?: string };

  let daysRaw: DayIn[] | null = null;
  if (Array.isArray(req.body?.dates) && req.body.dates.length) {
    daysRaw = (req.body.dates as unknown[]).map((d) => ({
      workDate: String(d),
      note: sharedNote,
    }));
  } else if (Array.isArray(req.body?.days) && req.body.days.length) {
    daysRaw = req.body.days as DayIn[];
  }

  if (!daysRaw?.length) {
    res.status(400).json({ error: "Kamida bitta kun tanlang" });
    return;
  }
  if (daysRaw.length > 31) {
    res.status(400).json({ error: "Bir martada max 31 kun" });
    return;
  }

  const batchNote = sharedNote || String(daysRaw[0]?.note || "").trim();
  if (!batchNote || batchNote.length < 3) {
    res.status(400).json({ error: "Izoh majburiy — sababni yozing" });
    return;
  }
  if (batchNote.length > 800) {
    res.status(400).json({ error: "Izoh juda uzun (max 800)" });
    return;
  }

  const prepared: Array<{
    workDate: string;
    fromHm: string;
    toHm: string;
    note: string;
    shift: Awaited<ReturnType<typeof resolveShiftForDate>>;
    durationMinutes: number;
  }> = [];

  const seen = new Set<string>();
  for (const raw of daysRaw) {
    const workDate = String(raw.workDate || "").trim();
    if (!YMD.test(workDate)) {
      res.status(400).json({ error: `Noto‘g‘ri sana: ${workDate}` });
      return;
    }
    if (seen.has(workDate)) {
      res.status(400).json({ error: `Takroriy sana: ${workDate}` });
      return;
    }
    seen.add(workDate);

    const shift = await resolveShiftForDate(me, workDate, role);
    let fromHm = String(raw.fromHm || "").trim() || shift.shiftStartHm;
    let toHm = String(raw.toHm || "").trim() || shift.shiftEndHm;
    if (!HM.test(fromHm) || !HM.test(toHm)) {
      fromHm = shift.shiftStartHm;
      toHm = shift.shiftEndHm;
    }
    const dur = durationMinutes(fromHm, toHm);
    prepared.push({
      workDate,
      fromHm,
      toHm,
      note: batchNote,
      shift,
      durationMinutes: dur > 0 ? dur : durationMinutes(shift.shiftStartHm, shift.shiftEndHm),
    });
  }

  const existing = await db
    .select({ workDate: javobOlishRequestsTable.workDate })
    .from(javobOlishRequestsTable)
    .where(
      and(
        eq(javobOlishRequestsTable.employeeId, me.id),
        inArray(javobOlishRequestsTable.status, [...OPEN_STATUSES]),
        inArray(
          javobOlishRequestsTable.workDate,
          prepared.map((p) => p.workDate),
        ),
      ),
    );
  if (existing.length) {
    const datesTxt = existing
      .map((e) => {
        const [y, m, d] = e.workDate.split("-");
        return y && m && d ? `${d}.${m}.${y}` : e.workDate;
      })
      .join(", ");
    res.status(409).json({
      error: `Shu kun(lar) uchun ochiq so‘rov bor (${datesTxt}). Tasdiqlash yoki rad etishgacha shu kun bo‘yicha qayta yuborib bo‘lmaydi.`,
      openDates: existing.map((e) => e.workDate),
    });
    return;
  }

  const officeFlow = !usesCoordinatorChain(role);
  const deptHeadUserId = officeFlow ? await findOfficeDeptHeadUserId(role, req.userId!) : null;
  const coordUserId = officeFlow ? deptHeadUserId : await findCoordinatorUserId(me.id);
  const initialStatus = officeFlow ? (deptHeadUserId ? "pending_dept" : "pending_hr") : "pending_coord";
  const created = [];

  for (const p of prepared) {
    const [row] = await db
      .insert(javobOlishRequestsTable)
      .values({
        employeeId: me.id,
        userId: me.userId,
        workDate: p.workDate,
        shiftType: p.shift.shiftType,
        shiftLabel: p.shift.shiftLabel,
        shiftStartHm: p.shift.shiftStartHm,
        shiftEndHm: p.shift.shiftEndHm,
        shiftOvernight: p.shift.overnight ? 1 : 0,
        fromHm: p.fromHm,
        toHm: p.toHm,
        durationMinutes: p.durationMinutes,
        note: p.note,
        status: initialStatus,
        coordinatorUserId: coordUserId,
      })
      .returning();
    created.push(row);
  }

  const count = created.length;
  const datesTxt = prepared.map((p) => p.workDate).join(", ");
  const timeTxt = prepared
    .map((p) => `${p.workDate} ${p.fromHm}–${p.toHm}`)
    .join("; ");
  const notifyText = `${me.fullName}: javob olish so‘rovi (${count} ta). ${timeTxt}. Sabab: ${batchNote}. Yuborilgan: ${fmtDt(new Date())}. 8 soat ichida javob bering.`;

  if (officeFlow && deptHeadUserId) {
    await notifyUser({
      userId: deptHeadUserId,
      text: notifyText,
      type: "javob_olish",
      linkUrl: "/javob-olish",
    });
  } else if (officeFlow) {
    await notifyByRoles({
      roles: ["hr_menejer", "hr_direktor", "admin"],
      text: `${notifyText} Bo‘lim boshlig‘i lavozimi yo‘q — HR menejer va HR direktor tasdiqlaydi.`,
      type: "javob_olish",
      linkUrl: "/javob-olish",
    });
  } else if (coordUserId) {
    await notifyUser({
      userId: coordUserId,
      text: notifyText,
      type: "javob_olish",
      linkUrl: "/javob-olish",
    });
  } else {
    await notifyByRoles({
      roles: ["koordinator", "hr_menejer", "hr_direktor", "admin"],
      text: `${notifyText} (1-koordinator topilmadi — HR ko‘rib chiqing)`,
      type: "javob_olish",
      linkUrl: "/javob-olish",
    });
  }

  const sentTo = officeFlow
    ? deptHeadUserId
      ? "bo‘lim boshlig‘iga"
      : "HR menejer va HR direktorga"
    : "1-koordinatorga";
  res.status(201).json({
    ok: true,
    count,
    message: `${count} ta kun uchun so‘rov ${sentTo} yuborildi.`,
    items: await enrichRows(created),
  });
});

router.post("/javob-olish/:id/approve", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await decide(req, res, "approved");
});

router.post("/javob-olish/:id/reject", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await decide(req, res, "rejected");
});

const BATCH_MS = 10 * 60 * 1000;

function shiftYmd(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, (d || 1) + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function spanLabel(dates: string[]) {
  const sorted = [...dates].sort();
  if (!sorted.length) return "";
  const show = (ymd: string) => {
    const [y, m, d] = ymd.split("-");
    return y && m && d ? `${d}.${m}.${y}` : ymd;
  };
  if (sorted.length === 1) return show(sorted[0]!);
  return `${show(sorted[0]!)}–${show(sorted[sorted.length - 1]!)} (${sorted.length} kun)`;
}

/** Bir yuborishdagi ketma-ket kunlar — bitta qaror. */
async function consecutiveBatch(row: typeof javobOlishRequestsTable.$inferSelect) {
  const created = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
  const rows = await db
    .select()
    .from(javobOlishRequestsTable)
    .where(
      and(
        eq(javobOlishRequestsTable.employeeId, row.employeeId),
        eq(javobOlishRequestsTable.status, row.status),
        eq(javobOlishRequestsTable.note, row.note),
        eq(javobOlishRequestsTable.fromHm, row.fromHm),
        eq(javobOlishRequestsTable.toHm, row.toHm),
        gte(javobOlishRequestsTable.createdAt, new Date(created.getTime() - BATCH_MS)),
        lte(javobOlishRequestsTable.createdAt, new Date(created.getTime() + BATCH_MS)),
      ),
    );
  const byDate = new Map(rows.map((r) => [r.workDate, r]));
  const keep = new Map<string, (typeof rows)[number]>();
  const stack = [row.workDate];
  while (stack.length) {
    const day = stack.pop()!;
    if (keep.has(day)) continue;
    const hit = byDate.get(day);
    if (!hit) continue;
    keep.set(day, hit);
    const prev = byDate.get(shiftYmd(day, -1));
    const next = byDate.get(shiftYmd(day, 1));
    if (prev) stack.push(prev.workDate);
    if (next) stack.push(next.workDate);
  }
  return [...keep.values()].sort((a, b) => a.workDate.localeCompare(b.workDate));
}

router.post("/javob-olish/:id/cancel", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const me = await empByUserId(req.userId!);
  const id = Number(req.params.id);
  const [row] = await db
    .select()
    .from(javobOlishRequestsTable)
    .where(eq(javobOlishRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "So‘rov topilmadi" });
    return;
  }
  const st = normalizeStatus(row.status);
  if (st !== "pending_coord" && st !== "pending_dept" && st !== "pending_hr") {
    res.status(400).json({ error: "Faqat ochiq so‘rovni bekor qilish mumkin" });
    return;
  }
  if (!me || row.employeeId !== me.id) {
    res.status(403).json({ error: "Faqat o‘z so‘rovingizni bekor qilasiz" });
    return;
  }
  const batch = await consecutiveBatch(row);
  const now = new Date();
  const updated = await db
    .update(javobOlishRequestsTable)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      and(
        inArray(
          javobOlishRequestsTable.id,
          batch.map((r) => r.id),
        ),
        eq(javobOlishRequestsTable.status, row.status),
      ),
    )
    .returning();
  const head = updated.find((r) => r.id === row.id) ?? updated[0];
  if (!head) {
    res.status(409).json({ error: "Bu so‘rovga allaqachon javob berilgan" });
    return;
  }
  res.json({ ok: true, item: await enrichOne(head), count: updated.length });
});

async function decide(
  req: AuthRequest,
  res: import("express").Response,
  decision: "approved" | "rejected",
): Promise<void> {
  const role = req.userRole || "";
  const id = Number(req.params.id);
  const decisionNote = req.body?.note ? String(req.body.note).slice(0, 400) : null;
  const [row] = await db
    .select()
    .from(javobOlishRequestsTable)
    .where(eq(javobOlishRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "So‘rov topilmadi" });
    return;
  }

  const status = normalizeStatus(row.status);
  const now = new Date();
  const batch = await consecutiveBatch(row);
  const batchIds = batch.map((r) => r.id);
  const when = spanLabel(batch.map((r) => r.workDate));

  const markBatchSababli = async () => {
    if (decision !== "approved") return;
    await excuseAttendanceFromApprovedJavob(
      batch.map((item) => ({
        employeeId: item.employeeId,
        userId: item.userId,
        workDate: item.workDate,
        fromHm: item.fromHm,
        toHm: item.toHm,
        note: item.note,
        decisionNote,
        decidedById: req.userId!,
        decidedAt: now,
      })),
    );
  };

  /** Ketma-ket kunlarning hammasi bir qaror. Holat o‘zgarmagan bo‘lsa yangilanadi. */
  const guardedUpdate = async (set: Partial<typeof javobOlishRequestsTable.$inferInsert>) => {
    const updatedRows = await db
      .update(javobOlishRequestsTable)
      .set(set)
      .where(and(inArray(javobOlishRequestsTable.id, batchIds), eq(javobOlishRequestsTable.status, row.status)))
      .returning();
    const updated = updatedRows.find((r) => r.id === row.id);
    if (!updated) {
      res.status(409).json({ error: "Bu so‘rovga allaqachon javob berilgan" });
      return null;
    }
    return updated;
  };

  /** 1-bosqich: koordinator (admin/rahbar — darhol yakuniy qaror) */
  if (status === "pending_coord") {
    if (!(isCoordRole(role) || isFinalOverrideRole(role))) {
      res.status(403).json({ error: "Avval 1-koordinator javob beradi" });
      return;
    }
    if (isCoordRole(role)) {
      const me = await empByUserId(req.userId!);
      if (me) {
        const scope = await coordinatorScopeEmployeeIds(me.id);
        if (!scope.has(row.employeeId) && row.coordinatorUserId !== req.userId) {
          res.status(403).json({ error: "Bu so‘rov sizning doirangizda emas" });
          return;
        }
      }
    }

    if (!isCoordRole(role)) {
      const updated = await guardedUpdate({
        status: decision,
        decidedById: req.userId!,
        decidedAt: now,
        decisionNote,
        updatedAt: now,
      });
      if (!updated) return;
      await markBatchSababli();
      if (row.userId) {
        await notifyUser({
          userId: row.userId,
          text:
            decision === "approved"
              ? `${when} ${row.fromHm}–${row.toHm} javob olish tasdiqlandi (rahbariyat). Davomatda Sababli. Jarima tushmaydi.`
              : `${when} javob olish so‘rovingiz rahbariyat tomonidan rad etildi.${decisionNote ? ` Sabab: ${decisionNote}` : ""}`,
          type: "javob_olish_decision",
          linkUrl: "/javob-olish",
        });
      }
      res.json({ ok: true, item: await enrichOne(updated) });
      return;
    }

    if (decision === "rejected") {
      const updated = await guardedUpdate({
        status: "rejected",
        coordDecidedById: req.userId!,
        coordDecidedAt: now,
        coordDecisionNote: decisionNote,
        decidedById: req.userId!,
        decidedAt: now,
        decisionNote,
        updatedAt: now,
      });
      if (!updated) return;
      if (row.userId) {
        await notifyUser({
          userId: row.userId,
          text: `${when} javob olish so‘rovingiz koordinator tomonidan rad etildi.${decisionNote ? ` Sabab: ${decisionNote}` : ""}`,
          type: "javob_olish_decision",
          linkUrl: "/javob-olish",
        });
      }
      res.json({ ok: true, item: await enrichOne(updated) });
      return;
    }

    // Koordinator tasdiqladi → HR yakuniy
    const updated = await guardedUpdate({
      status: "pending_hr",
      coordDecidedById: req.userId!,
      coordDecidedAt: now,
      coordDecisionNote: decisionNote,
      updatedAt: now,
    });
    if (!updated) return;

    const item = await enrichOne(updated);

    await notifyByRoles({
      roles: ["hr_menejer", "hr_direktor", "admin"],
      text: `${item.fullName || "Xodim"}: koordinator tasdiqladi — HR yakuniy ruxsat kerak. ${when} ${row.fromHm}–${row.toHm}. Sabab: ${row.note}. Yuborilgan: ${fmtDt(row.createdAt)}.`,
      type: "javob_olish",
      linkUrl: "/javob-olish",
    });

    res.json({ ok: true, item });
    return;
  }

  /** Ofis: bo‘lim boshlig‘i, so‘ng HR. Admin yakuniy yopishi mumkin. */
  if (status === "pending_dept") {
    const assignedHead = isDeptHeadRole(role) && row.coordinatorUserId === req.userId;
    const adminFinal = isFinalOverrideRole(role);
    if (!assignedHead && !adminFinal) {
      res.status(403).json({ error: "Avval bo‘lim boshlig‘i javob beradi" });
      return;
    }
    if (adminFinal && !assignedHead) {
      const updated = await guardedUpdate({
        status: decision,
        decidedById: req.userId!,
        decidedAt: now,
        decisionNote,
        updatedAt: now,
      });
      if (!updated) return;
      await markBatchSababli();
      if (row.userId) {
        await notifyUser({
          userId: row.userId,
          text:
            decision === "approved"
              ? `${when} ${row.fromHm}–${row.toHm} javob olish tasdiqlandi (admin). Davomatda Sababli. Jarima tushmaydi.`
              : `${when} javob olish so‘rovingiz admin tomonidan rad etildi.${decisionNote ? ` Sabab: ${decisionNote}` : ""}`,
          type: "javob_olish_decision",
          linkUrl: "/javob-olish",
        });
      }
      res.json({ ok: true, item: await enrichOne(updated) });
      return;
    }
    if (decision === "rejected") {
      const updated = await guardedUpdate({
        status: "rejected",
        coordDecidedById: req.userId!,
        coordDecidedAt: now,
        coordDecisionNote: decisionNote,
        decidedById: req.userId!,
        decidedAt: now,
        decisionNote,
        updatedAt: now,
      });
      if (!updated) return;
      if (row.userId) {
        await notifyUser({
          userId: row.userId,
          text: `${when} javob olish so‘rovingiz bo‘lim boshlig‘i tomonidan rad etildi.${decisionNote ? ` Sabab: ${decisionNote}` : ""}`,
          type: "javob_olish_decision",
          linkUrl: "/javob-olish",
        });
      }
      res.json({ ok: true, item: await enrichOne(updated) });
      return;
    }
    const updated = await guardedUpdate({
      status: "pending_hr",
      coordDecidedById: req.userId!,
      coordDecidedAt: now,
      coordDecisionNote: decisionNote,
      updatedAt: now,
    });
    if (!updated) return;
    const item = await enrichOne(updated);
    await notifyByRoles({
      roles: ["hr_menejer", "hr_direktor", "admin"],
      text: `${item.fullName || "Xodim"}: bo‘lim boshlig‘i tasdiqladi — HR yakuniy ruxsat kerak. ${when} ${row.fromHm}–${row.toHm}. Sabab: ${row.note}.`,
      type: "javob_olish",
      linkUrl: "/javob-olish",
    });
    res.json({ ok: true, item });
    return;
  }

  /** 2-bosqich: HR */
  if (status === "pending_hr") {
    if (!isHrApprover(role)) {
      res.status(403).json({ error: "Yakuniy ruxsatni HR beradi" });
      return;
    }

    const updated = await guardedUpdate({
      status: decision,
      decidedById: req.userId!,
      decidedAt: now,
      decisionNote,
      updatedAt: now,
    });
    if (!updated) return;
    await markBatchSababli();

    if (row.userId) {
      await notifyUser({
        userId: row.userId,
        text:
          decision === "approved"
            ? `${when} ${row.fromHm}–${row.toHm} javob olish tasdiqlandi (HR). Davomatda Sababli. Jarima tushmaydi.`
            : `${when} javob olish so‘rovingiz HR tomonidan rad etildi.${decisionNote ? ` Sabab: ${decisionNote}` : ""}`,
        type: "javob_olish_decision",
        linkUrl: "/javob-olish",
      });
    }

    res.json({ ok: true, item: await enrichOne(updated) });
    return;
  }

  res.status(409).json({ error: "Bu so‘rovga allaqachon javob berilgan" });
}

export default router;
