import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import {
  db,
  employeesTable,
  revisionAuditLogTable,
  revisionVisitsTable,
  usersTable,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { notifyUser } from "../lib/notify";
import { notifyReviziyaStakeholders } from "../lib/reviziya-notify";
import { generateUniqueActNumber, resolveActNumber } from "../lib/reviziya-act-number";
import { isDirectorRole } from "../lib/roles";
import { displayBranchName, parseGpsText } from "../lib/geo-location";
import {
  canAssignReviziya,
  canApproveReviziyaRequest,
  canCorrectReviziyaAmounts,
  canCreateReviziyaVisit,
  canOverrideRevisionSchedule,
  canViewAllReviziyaBranches,
  canViewReviziya,
} from "../lib/reviziya";
import {
  CYCLE_STATUS_LABEL,
  WORKFLOW_STATUS_LABEL,
  computeCycleStatus,
  computeNextRevisionDate,
  computeRemainingAmount,
  daysBetweenYmd,
  effectiveNextRevisionDate,
  formatDuration,
  moneyInt,
  tashkentYmd,
  type CycleStatus,
} from "../lib/reviziya-cycle";

const router: IRouter = Router();

function denyView(req: AuthRequest, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (!canViewReviziya(req.userRole)) {
    res.status(403).json({ error: "Reviziya bo‘limi uchun ruxsat yo‘q" });
    return true;
  }
  return false;
}

function parseId(raw: string | string[] | undefined): number {
  return parseInt(Array.isArray(raw) ? raw[0] : String(raw || ""), 10);
}

type Scope =
  | { mode: "all" }
  | { mode: "branches"; branchIds: number[] }
  | { mode: "assigned"; userId: number };

async function resolveScope(req: AuthRequest): Promise<Scope> {
  const role = req.userRole;
  const userId = req.userId || 0;
  if (canViewAllReviziyaBranches(role)) return { mode: "all" };
  if (role === "revizor") return { mode: "assigned", userId };

  const [me] = await db
    .select({
      id: employeesTable.id,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
    })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);

  if (role === "mudir" || me?.orgRole === "manager") {
    return { mode: "branches", branchIds: me ? [me.id] : [] };
  }

  if (role === "koordinator" || me?.orgRole === "coordinator") {
    if (!me) return { mode: "branches", branchIds: [] };
    const rows = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.orgRole, "manager"), eq(employeesTable.reportsToId, me.id)));
    return { mode: "branches", branchIds: rows.map((r) => r.id) };
  }

  return { mode: "branches", branchIds: [] };
}

function branchLabel(fullName: string, location: string | null): string {
  const fromLoc = displayBranchName(location);
  return fromLoc || fullName;
}

/** GPS / koordinata matni — koordinator F.I.Sh. emas */
function isGpsLikeLabel(value: string | null | undefined): boolean {
  const t = String(value || "").trim();
  if (!t) return true;
  if (/\|gps:/i.test(t)) return true;
  if (parseGpsText(t)) return true;
  if (/\d{1,3}\s*°/.test(t) && /[NSEWСЮВЗnsew]/u.test(t)) return true;
  if (/^-?\d{1,3}([.,]\d+)?\s*,\s*-?\d{1,3}([.,]\d+)?$/.test(t)) return true;
  return false;
}

function personNameOrNull(value: string | null | undefined): string | null {
  const t = String(value || "").trim();
  if (!t || isGpsLikeLabel(t)) return null;
  return t;
}

/** Koordinator nomi: employee.fullName → users.fullName; GPS hech qachon chiqmasin */
function resolveCoordinatorDisplayName(
  coord:
    | {
        fullName: string | null;
        userId: number | null;
      }
    | undefined,
  userNameById: Map<number, string>,
): string {
  if (!coord) return "—";
  const fromEmp = personNameOrNull(coord.fullName);
  if (fromEmp) return fromEmp;
  if (coord.userId != null) {
    const fromUser = personNameOrNull(userNameById.get(coord.userId));
    if (fromUser) return fromUser;
  }
  return "—";
}

async function resolveUserName(userId?: number | null): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.fullName ?? null;
}

async function auditVisit(opts: {
  visitId?: number | null;
  userId?: number;
  userName?: string | null;
  role?: string | null;
  action: string;
  detail?: string;
  reason?: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}) {
  const userName = opts.userName ?? (await resolveUserName(opts.userId));
  await db.insert(revisionAuditLogTable).values({
    documentId: null,
    visitId: opts.visitId ?? null,
    entityType: "revision_visit",
    entityId: opts.visitId ?? null,
    userId: opts.userId ?? null,
    userName,
    userRole: opts.role ?? null,
    action: opts.action,
    detail: opts.detail ?? null,
    reason: opts.reason ?? null,
    oldValue: opts.oldValue ?? null,
    newValue: opts.newValue ?? null,
  });
}

async function assertVisitAccess(req: AuthRequest, visit: typeof revisionVisitsTable.$inferSelect) {
  const scope = await resolveScope(req);
  if (scope.mode === "all") return true;
  if (scope.mode === "assigned") {
    return visit.assignedEmployeeId === scope.userId;
  }
  return scope.branchIds.includes(visit.branchId);
}

async function loadActiveManagers() {
  return db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      reportsToId: employeesTable.reportsToId,
      userId: employeesTable.userId,
      hiredAt: employeesTable.hiredAt,
    })
    .from(employeesTable)
    .where(and(eq(employeesTable.orgRole, "manager"), eq(employeesTable.employmentStatus, "working")));
}

type VisitRow = typeof revisionVisitsTable.$inferSelect;

function enrichVisit(v: VisitRow, today = tashkentYmd()) {
  const next = effectiveNextRevisionDate(v.nextRevisionDate, v.nextRevisionDateOverride);
  const hasCompleted = v.workflowStatus === "COMPLETED";
  const cycleStatus: CycleStatus =
    v.workflowStatus === "IN_PROGRESS" || v.workflowStatus === "ACCEPTED"
      ? "REVIZIYA_JARAYONIDA"
      : v.workflowStatus === "COMPLETED"
        ? computeCycleStatus({
            hasCompletedRevision: true,
            nextRevisionDate: next,
            today,
            cycleMonths: v.cycleMonths,
            workflowStatus: null,
          })
        : computeCycleStatus({
            hasCompletedRevision: false,
            nextRevisionDate: next,
            today,
            cycleMonths: v.cycleMonths,
            workflowStatus: v.workflowStatus,
          });

  const daysLeft = next ? daysBetweenYmd(today, next) : null;
  return {
    ...v,
    nextRevisionDateEffective: next,
    cycleStatus,
    cycleStatusLabel: CYCLE_STATUS_LABEL[cycleStatus],
    workflowStatusLabel: WORKFLOW_STATUS_LABEL[v.workflowStatus as keyof typeof WORKFLOW_STATUS_LABEL] || v.workflowStatus,
    daysLeft,
    durationLabel: formatDuration(v.durationMinutes),
  };
}

router.get("/reviziya/visits/meta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  res.json({
    cycleStatuses: Object.entries(CYCLE_STATUS_LABEL).map(([value, label]) => ({ value, label })),
    workflowStatuses: Object.entries(WORKFLOW_STATUS_LABEL).map(([value, label]) => ({ value, label })),
    nextActNumber: await generateUniqueActNumber(),
    permissions: {
      create: canCreateReviziyaVisit(req.userRole),
      assign: canAssignReviziya(req.userRole),
      approveRequest: canApproveReviziyaRequest(req.userRole),
      overrideSchedule: canOverrideRevisionSchedule(req.userRole),
      correctAmounts: canCorrectReviziyaAmounts(req.userRole),
      viewAll: canViewAllReviziyaBranches(req.userRole),
    },
  });
});

router.get("/reviziya/visits/next-act-number", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  res.json({ actNumber: await generateUniqueActNumber() });
});

router.get("/reviziya/visits/revizors", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  if (!canAssignReviziya(req.userRole) && !canCreateReviziyaVisit(req.userRole)) {
    res.status(403).json({ error: "Revizor tanlash uchun ruxsat yo‘q" });
    return;
  }
  const rows = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
    .from(usersTable)
    .where(and(eq(usersTable.status, "active"), inArray(usersTable.role, ["revizor", "reviziya_rahbar"])));
  res.json(rows);
});

/** Filiallar holati + dashboard statistikasi */
router.get("/reviziya/visits/dashboard", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const scope = await resolveScope(req);
  const today = tashkentYmd();
  const q = String(req.query.q || "").trim().toLowerCase();
  const statusFilter = String(req.query.status || "").trim();
  const regionFilter = String(req.query.region || "").trim().toLowerCase();
  const mudirFilter = String(req.query.mudir || "").trim().toLowerCase();
  const revizorFilter = String(req.query.revizor || "").trim().toLowerCase();
  const shortageMin = req.query.shortageMin != null ? moneyInt(req.query.shortageMin) : null;
  const shortageMax = req.query.shortageMax != null ? moneyInt(req.query.shortageMax) : null;
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || "50"), 10) || 50));

  let managers = await loadActiveManagers();
  if (scope.mode === "branches") {
    const set = new Set(scope.branchIds);
    managers = managers.filter((m) => set.has(m.id));
  } else if (scope.mode === "assigned") {
    const assigned = await db
      .select({ branchId: revisionVisitsTable.branchId })
      .from(revisionVisitsTable)
      .where(eq(revisionVisitsTable.assignedEmployeeId, scope.userId));
    const set = new Set(assigned.map((a) => a.branchId));
    managers = managers.filter((m) => set.has(m.id));
  }

  const branchIds = managers.map((m) => m.id);
  const visits =
    branchIds.length === 0
      ? []
      : await db
          .select()
          .from(revisionVisitsTable)
          .where(inArray(revisionVisitsTable.branchId, branchIds))
          .orderBy(desc(revisionVisitsTable.revisionDate), desc(revisionVisitsTable.id));

  const byBranch = new Map<number, VisitRow[]>();
  for (const v of visits) {
    const list = byBranch.get(v.branchId) || [];
    list.push(v);
    byBranch.set(v.branchId, list);
  }

  const coordIds = [...new Set(managers.map((m) => m.reportsToId).filter(Boolean))] as number[];
  const coords =
    coordIds.length === 0
      ? []
      : await db
          .select({
            id: employeesTable.id,
            fullName: employeesTable.fullName,
            userId: employeesTable.userId,
            orgRole: employeesTable.orgRole,
          })
          .from(employeesTable)
          .where(inArray(employeesTable.id, coordIds));
  const coordMap = new Map(coords.map((c) => [c.id, c]));

  const coordUserIds = [
    ...new Set(coords.map((c) => c.userId).filter((id): id is number => id != null)),
  ];
  const userNameById = new Map<number, string>();
  if (coordUserIds.length) {
    const users = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName })
      .from(usersTable)
      .where(inArray(usersTable.id, coordUserIds));
    for (const u of users) userNameById.set(u.id, u.fullName);
  }

  type BranchRow = {
    branchId: number;
    branchName: string;
    mudirName: string;
    region: string;
    lastRevisionDate: string | null;
    nextRevisionDate: string | null;
    daysLeft: number | null;
    cycleStatus: CycleStatus;
    cycleStatusLabel: string;
    shortageAmount: number;
    collectedAmount: number;
    remainingAmount: number;
    excessAmount: number;
    assignedRevizorId: number | null;
    assignedRevizorName: string | null;
    activeVisitId: number | null;
    workflowStatus: string | null;
    lastVisitDuration: string | null;
    cycleMonths: number | null;
  };

  const rows: BranchRow[] = [];
  for (const m of managers) {
    const list = byBranch.get(m.id) || [];
    const completed = list.filter((v) => v.workflowStatus === "COMPLETED");
    const latestCompleted = completed[0] || null;
    const active = list.find((v) => ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(v.workflowStatus)) || null;
    const source = latestCompleted;
    const next = source
      ? effectiveNextRevisionDate(source.nextRevisionDate, source.nextRevisionDateOverride)
      : null;
    const cycleMonths = source?.cycleMonths ?? null;
    let cycleStatus = computeCycleStatus({
      hasCompletedRevision: !!latestCompleted,
      nextRevisionDate: next,
      today,
      cycleMonths,
      workflowStatus: null,
    });
    if (active?.workflowStatus === "IN_PROGRESS" || active?.workflowStatus === "ACCEPTED") {
      cycleStatus = "REVIZIYA_JARAYONIDA";
    }

    const coord = m.reportsToId != null ? coordMap.get(m.reportsToId) : undefined;
    const region = resolveCoordinatorDisplayName(coord, userNameById);

    rows.push({
      branchId: m.id,
      branchName: branchLabel(m.fullName, m.location),
      mudirName: m.fullName,
      region,
      lastRevisionDate: latestCompleted?.revisionDate || latestCompleted?.completedAt?.toISOString().slice(0, 10) || null,
      nextRevisionDate: next,
      daysLeft: next ? daysBetweenYmd(today, next) : null,
      cycleStatus,
      cycleStatusLabel: CYCLE_STATUS_LABEL[cycleStatus],
      shortageAmount: latestCompleted?.shortageAmount ?? 0,
      collectedAmount: latestCompleted?.collectedAmount ?? 0,
      remainingAmount: latestCompleted?.remainingAmount ?? 0,
      excessAmount: latestCompleted?.excessAmount ?? 0,
      assignedRevizorId: active?.assignedEmployeeId ?? latestCompleted?.assignedEmployeeId ?? null,
      assignedRevizorName: active?.assignedEmployeeName ?? latestCompleted?.assignedEmployeeName ?? null,
      activeVisitId: active?.id ?? null,
      workflowStatus: active?.workflowStatus ?? (latestCompleted ? "COMPLETED" : null),
      lastVisitDuration: latestCompleted ? formatDuration(latestCompleted.durationMinutes) : null,
      cycleMonths,
    });
  }

  let filtered = rows;
  if (q) {
    filtered = filtered.filter(
      (r) =>
        r.branchName.toLowerCase().includes(q) ||
        r.mudirName.toLowerCase().includes(q) ||
        (r.assignedRevizorName || "").toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q),
    );
  }
  if (statusFilter) filtered = filtered.filter((r) => r.cycleStatus === statusFilter);
  if (regionFilter) filtered = filtered.filter((r) => r.region.toLowerCase().includes(regionFilter));
  if (mudirFilter) filtered = filtered.filter((r) => r.mudirName.toLowerCase().includes(mudirFilter));
  if (revizorFilter) filtered = filtered.filter((r) => (r.assignedRevizorName || "").toLowerCase().includes(revizorFilter));
  if (shortageMin != null) filtered = filtered.filter((r) => r.shortageAmount >= shortageMin);
  if (shortageMax != null) filtered = filtered.filter((r) => r.shortageAmount <= shortageMax);

  const stats = {
    totalBranches: rows.length,
    completedOk: rows.filter((r) => r.cycleStatus === "REJADAGIDEK" || r.cycleStatus === "REVIZIYA_YAKUNLANGAN").length,
    tezOrada: rows.filter((r) => r.cycleStatus === "TEZ_ORADA").length,
    muddatiOtgan: rows.filter((r) => r.cycleStatus === "MUDDATI_OTGAN").length,
    siklOtkazilgan: rows.filter((r) => r.cycleStatus === "SIKL_OTKAZIB_YUBORILGAN").length,
    yangiOchilgan: rows.filter((r) => r.cycleStatus === "YANGI_OCHILGAN").length,
    jarayonda: rows.filter((r) => r.cycleStatus === "REVIZIYA_JARAYONIDA").length,
    totalShortage: rows.reduce((s, r) => s + r.shortageAmount, 0),
    totalCollected: rows.reduce((s, r) => s + r.collectedAmount, 0),
    totalRemaining: rows.reduce((s, r) => s + r.remainingAmount, 0),
  };

  const total = filtered.length;
  const offset = (page - 1) * limit;
  const pageRows = filtered.slice(offset, offset + limit);

  res.json({
    today,
    scope: scope.mode,
    stats,
    branches: pageRows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  });
});

router.get("/reviziya/visits/calendar", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const scope = await resolveScope(req);
  const from = String(req.query.from || "").slice(0, 10);
  const to = String(req.query.to || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    res.status(400).json({ error: "from/to YYYY-MM-DD bo‘lishi kerak" });
    return;
  }

  const conditions = [
    or(
      and(gte(revisionVisitsTable.revisionDate, from), lte(revisionVisitsTable.revisionDate, to)),
      and(gte(revisionVisitsTable.scheduledDate, from), lte(revisionVisitsTable.scheduledDate, to)),
    )!,
  ];

  if (scope.mode === "branches") {
    if (!scope.branchIds.length) {
      res.json({ events: [] });
      return;
    }
    conditions.push(inArray(revisionVisitsTable.branchId, scope.branchIds));
  } else if (scope.mode === "assigned") {
    conditions.push(eq(revisionVisitsTable.assignedEmployeeId, scope.userId));
  }

  const rows = await db
    .select()
    .from(revisionVisitsTable)
    .where(and(...conditions))
    .orderBy(asc(revisionVisitsTable.revisionDate), asc(revisionVisitsTable.scheduledStartTime))
    .limit(2000);

  res.json({
    events: rows.map((v) => ({
      id: v.id,
      date: v.revisionDate || v.scheduledDate,
      startTime: v.scheduledStartTime,
      endTime: v.scheduledEndTime,
      branchId: v.branchId,
      branchName: v.branchName,
      revizorName: v.assignedEmployeeName,
      workflowStatus: v.workflowStatus,
      priority: v.priority,
      notes: v.notes,
    })),
  });
});

router.get("/reviziya/visits/my-tasks", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const today = tashkentYmd();
  const userId = req.userId!;
  const role = req.userRole;

  const whereParts: any[] = [];

  if (canViewAllReviziyaBranches(role) || canApproveReviziyaRequest(role)) {
    whereParts.push(
      inArray(revisionVisitsTable.workflowStatus, [
        "REQUESTED",
        "ASSIGNED",
        "ACCEPTED",
        "IN_PROGRESS",
      ]),
    );
  } else if (role === "revizor") {
    whereParts.push(
      inArray(revisionVisitsTable.workflowStatus, ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"]),
      eq(revisionVisitsTable.assignedEmployeeId, userId),
    );
  } else if (role === "mudir" || role === "koordinator") {
    const scope = await resolveScope(req);
    if (scope.mode === "branches") {
      if (!scope.branchIds.length) {
        res.json({ today: [], upcoming: [], pending: [], todayYmd: today });
        return;
      }
      whereParts.push(
        inArray(revisionVisitsTable.workflowStatus, [
          "REQUESTED",
          "ASSIGNED",
          "ACCEPTED",
          "IN_PROGRESS",
        ]),
        inArray(revisionVisitsTable.branchId, scope.branchIds),
      );
    }
  } else {
    whereParts.push(
      inArray(revisionVisitsTable.workflowStatus, ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"]),
      eq(revisionVisitsTable.assignedEmployeeId, userId),
    );
  }

  const rows = await db
    .select()
    .from(revisionVisitsTable)
    .where(and(...whereParts))
    .orderBy(asc(revisionVisitsTable.revisionDate), asc(revisionVisitsTable.scheduledStartTime))
    .limit(200);

  const pending = rows
    .filter((v) => v.workflowStatus === "REQUESTED")
    .map((v) => enrichVisit(v, today));
  const active = rows.filter((v) => v.workflowStatus !== "REQUESTED");
  const todayList = active.filter((v) => (v.revisionDate || v.scheduledDate) === today);
  const upcoming = active.filter((v) => {
    const d = v.revisionDate || v.scheduledDate || "";
    return d > today;
  });

  res.json({
    todayYmd: today,
    pending,
    today: todayList.map((v) => enrichVisit(v, today)),
    upcoming: upcoming.map((v) => enrichVisit(v, today)),
  });
});

router.get("/reviziya/visits", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const scope = await resolveScope(req);
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit || "40"), 10) || 40));
  const branchId = req.query.branchId ? parseInt(String(req.query.branchId), 10) : null;
  const status = String(req.query.status || "").trim();

  const conditions = [];
  if (scope.mode === "branches") {
    if (!scope.branchIds.length) {
      res.json({ items: [], pagination: { page, limit, total: 0, pages: 1 } });
      return;
    }
    conditions.push(inArray(revisionVisitsTable.branchId, scope.branchIds));
  } else if (scope.mode === "assigned") {
    conditions.push(eq(revisionVisitsTable.assignedEmployeeId, scope.userId));
  }
  if (branchId && Number.isFinite(branchId)) {
    if (scope.mode === "branches" && !scope.branchIds.includes(branchId)) {
      res.status(403).json({ error: "Bu filialga ruxsat yo‘q" });
      return;
    }
    conditions.push(eq(revisionVisitsTable.branchId, branchId));
  }
  if (status) conditions.push(eq(revisionVisitsTable.workflowStatus, status));

  const where = conditions.length ? and(...conditions) : undefined;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(revisionVisitsTable)
    .where(where);
  const items = await db
    .select()
    .from(revisionVisitsTable)
    .where(where)
    .orderBy(asc(revisionVisitsTable.revisionDate), asc(revisionVisitsTable.scheduledStartTime), asc(revisionVisitsTable.id))
    .limit(limit)
    .offset((page - 1) * limit);

  const today = tashkentYmd();
  res.json({
    items: items.map((v) => enrichVisit(v, today)),
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) || 1 },
  });
});

router.get("/reviziya/visits/branch/:branchId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const branchId = parseId(req.params.branchId);
  const scope = await resolveScope(req);
  if (scope.mode === "branches" && !scope.branchIds.includes(branchId)) {
    res.status(403).json({ error: "Bu filialga ruxsat yo‘q" });
    return;
  }

  const [manager] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, branchId), eq(employeesTable.orgRole, "manager")))
    .limit(1);
  if (!manager) {
    res.status(404).json({ error: "Filial topilmadi" });
    return;
  }

  if (scope.mode === "assigned") {
    const any = await db
      .select({ id: revisionVisitsTable.id })
      .from(revisionVisitsTable)
      .where(and(eq(revisionVisitsTable.branchId, branchId), eq(revisionVisitsTable.assignedEmployeeId, scope.userId)))
      .limit(1);
    if (!any.length) {
      res.status(403).json({ error: "Bu filialga ruxsat yo‘q" });
      return;
    }
  }

  const history = await db
    .select()
    .from(revisionVisitsTable)
    .where(eq(revisionVisitsTable.branchId, branchId))
    .orderBy(desc(revisionVisitsTable.revisionDate), desc(revisionVisitsTable.id))
    .limit(100);

  const today = tashkentYmd();
  const completed = history.filter((v) => v.workflowStatus === "COMPLETED");
  const latest = completed[0] || null;
  const active = history.find((v) => ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(v.workflowStatus)) || null;
  const next = latest ? effectiveNextRevisionDate(latest.nextRevisionDate, latest.nextRevisionDateOverride) : null;
  let cycleStatus = computeCycleStatus({
    hasCompletedRevision: !!latest,
    nextRevisionDate: next,
    today,
    cycleMonths: latest?.cycleMonths,
  });
  if (active && (active.workflowStatus === "IN_PROGRESS" || active.workflowStatus === "ACCEPTED")) {
    cycleStatus = "REVIZIYA_JARAYONIDA";
  }

  let region = "—";
  if (manager.reportsToId) {
    const [c] = await db
      .select({
        fullName: employeesTable.fullName,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(eq(employeesTable.id, manager.reportsToId))
      .limit(1);
    const userNameById = new Map<number, string>();
    if (c?.userId != null) {
      const [u] = await db
        .select({ id: usersTable.id, fullName: usersTable.fullName })
        .from(usersTable)
        .where(eq(usersTable.id, c.userId))
        .limit(1);
      if (u) userNameById.set(u.id, u.fullName);
    }
    region = resolveCoordinatorDisplayName(c, userNameById);
  }

  res.json({
    branch: {
      branchId: manager.id,
      branchName: branchLabel(manager.fullName, manager.location),
      mudirName: manager.fullName,
      region,
      cycleStatus,
      cycleStatusLabel: CYCLE_STATUS_LABEL[cycleStatus],
      lastRevisionDate: latest?.revisionDate || null,
      nextRevisionDate: next,
      daysLeft: next ? daysBetweenYmd(today, next) : null,
      shortageAmount: latest?.shortageAmount ?? 0,
      collectedAmount: latest?.collectedAmount ?? 0,
      remainingAmount: latest?.remainingAmount ?? 0,
      excessAmount: latest?.excessAmount ?? 0,
      delayDays: next && daysBetweenYmd(today, next) < 0 ? Math.abs(daysBetweenYmd(today, next)) : 0,
    },
    active: active ? enrichVisit(active, today) : null,
    latest: latest ? enrichVisit(latest, today) : null,
    history: history.map((v) => enrichVisit(v, today)),
  });
});

router.get("/reviziya/visits/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionVisitsTable).where(eq(revisionVisitsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Reviziya topilmadi" });
    return;
  }
  if (!(await assertVisitAccess(req, row))) {
    res.status(403).json({ error: "Bu reviziyaga ruxsat yo‘q" });
    return;
  }
  const logs = await db
    .select()
    .from(revisionAuditLogTable)
    .where(eq(revisionAuditLogTable.visitId, id))
    .orderBy(desc(revisionAuditLogTable.createdAt))
    .limit(80);
  res.json({ ...enrichVisit(row), audit: logs });
});

router.post("/reviziya/visits", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  if (!canCreateReviziyaVisit(req.userRole)) {
    res.status(403).json({ error: "Reviziya arizasini faqat koordinator qoldiradi" });
    return;
  }

  const branchId = parseInt(String(req.body?.branchId || ""), 10);
  if (!Number.isFinite(branchId)) {
    res.status(400).json({ error: "Filial majburiy" });
    return;
  }

  const scope = await resolveScope(req);
  if (scope.mode === "branches" && !scope.branchIds.includes(branchId)) {
    res.status(403).json({ error: "Bu filialga ruxsat yo‘q" });
    return;
  }
  if (scope.mode === "assigned") {
    res.status(403).json({ error: "Revizor yangi reviziya yarata olmaydi — biriktirishni kutib turing" });
    return;
  }

  const [manager] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, branchId), eq(employeesTable.orgRole, "manager")))
    .limit(1);
  if (!manager) {
    res.status(404).json({ error: "Filial topilmadi" });
    return;
  }

  // Koordinator arizasi — kun/revizor keyin rahbar belgilaydi
  const isCoordinatorRequest = req.userRole === "koordinator";
  const preferredDate = String(req.body?.revisionDate || req.body?.preferredDate || "").slice(0, 10);
  const revisionDate =
    preferredDate && /^\d{4}-\d{2}-\d{2}$/.test(preferredDate)
      ? preferredDate
      : tashkentYmd();

  const notes = req.body?.notes ? String(req.body.notes).slice(0, 2000) : null;
  const actNumber = await resolveActNumber(req.body?.actNumber);
  const workflowStatus = isCoordinatorRequest ? "REQUESTED" : "ASSIGNED";

  let assignedId: number | null = null;
  let assignedName: string | null = null;
  if (!isCoordinatorRequest && req.body?.assignedEmployeeId) {
    const aid = parseInt(String(req.body.assignedEmployeeId), 10);
    if (Number.isFinite(aid)) {
      const [u] = await db
        .select({ fullName: usersTable.fullName, role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, aid))
        .limit(1);
      if (!u || (u.role !== "revizor" && u.role !== "reviziya_rahbar")) {
        res.status(400).json({ error: "Faqat revizor rolli xodim biriktiriladi" });
        return;
      }
      assignedId = aid;
      assignedName = u.fullName;
    }
  }

  const [created] = await db
    .insert(revisionVisitsTable)
    .values({
      branchId,
      branchName: branchLabel(manager.fullName, manager.location),
      revisionDate,
      scheduledDate: revisionDate,
      scheduledStartTime: null,
      scheduledEndTime: null,
      assignedEmployeeId: assignedId,
      assignedEmployeeName: assignedName,
      workflowStatus,
      priority: String(req.body?.priority || "normal"),
      shortageAmount: 0,
      excessAmount: 0,
      collectedAmount: 0,
      remainingAmount: 0,
      actNumber,
      actUrl: null,
      receiptUrl: null,
      extraDocs: [],
      notes,
      responsibleName: manager.fullName,
      nextRevisionDate: null,
      nextRevisionDateOverride: null,
      cycleMonths: null,
      startedAt: null,
      completedAt: null,
      completedById: null,
      durationMinutes: null,
      createdById: req.userId!,
      updatedById: req.userId!,
    })
    .returning();

  await auditVisit({
    visitId: created.id,
    userId: req.userId,
    userName: null,
    role: req.userRole,
    action: isCoordinatorRequest ? "revision_requested" : "revision_created",
    detail: `${created.branchName} · ${revisionDate}`,
    newValue: { workflowStatus, notes },
  });

  await notifyReviziyaStakeholders({
    branchId: created.branchId,
    branchName: created.branchName,
    includeReviziyaRahbar: true,
    text: isCoordinatorRequest
      ? `${created.branchName}: yangi reviziya arizasi (koordinator). Qabul qilib kun belgilang.`
      : `${created.branchName}: reviziya yaratildi (${revisionDate})`,
    type: isCoordinatorRequest ? "reviziya_requested" : "reviziya_created",
    linkUrl: "/reviziya",
  });

  res.status(201).json(enrichVisit(created));
});

/** Koordinator arizasini qabul qilish: kun + revizor */
router.post("/reviziya/visits/:id/approve-request", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  if (!canApproveReviziyaRequest(req.userRole)) {
    res.status(403).json({ error: "Arizani faqat reviziya rahbari / rahbariyat qabul qiladi" });
    return;
  }
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionVisitsTable).where(eq(revisionVisitsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Reviziya topilmadi" });
    return;
  }
  if (row.workflowStatus !== "REQUESTED") {
    res.status(400).json({ error: "Faqat kutayotgan ariza qabul qilinadi" });
    return;
  }

  const revisionDate = String(req.body?.revisionDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(revisionDate)) {
    res.status(400).json({ error: "Reviziya kuni majburiy (YYYY-MM-DD)" });
    return;
  }

  const assignedId = req.body?.assignedEmployeeId
    ? parseInt(String(req.body.assignedEmployeeId), 10)
    : null;
  let assignedName: string | null = null;
  if (assignedId && Number.isFinite(assignedId)) {
    const [u] = await db
      .select({ fullName: usersTable.fullName, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, assignedId))
      .limit(1);
    if (!u || (u.role !== "revizor" && u.role !== "reviziya_rahbar")) {
      res.status(400).json({ error: "Faqat revizor biriktiriladi" });
      return;
    }
    assignedName = u.fullName;
  }

  const start = req.body?.scheduledStartTime
    ? String(req.body.scheduledStartTime).slice(0, 8)
    : null;
  const end = req.body?.scheduledEndTime ? String(req.body.scheduledEndTime).slice(0, 8) : null;

  const [updated] = await db
    .update(revisionVisitsTable)
    .set({
      revisionDate,
      scheduledDate: revisionDate,
      scheduledStartTime: start,
      scheduledEndTime: end,
      assignedEmployeeId: assignedId && Number.isFinite(assignedId) ? assignedId : null,
      assignedEmployeeName: assignedName,
      workflowStatus: "ASSIGNED",
      notes: req.body?.notes
        ? String(req.body.notes).slice(0, 2000)
        : row.notes,
      updatedById: req.userId!,
    })
    .where(eq(revisionVisitsTable.id, id))
    .returning();

  await auditVisit({
    visitId: id,
    userId: req.userId,
    userName: null,
    role: req.userRole,
    action: "revision_request_approved",
    detail: `${revisionDate}${assignedName ? ` · ${assignedName}` : ""}`,
    oldValue: { workflowStatus: "REQUESTED" },
    newValue: {
      workflowStatus: "ASSIGNED",
      revisionDate,
      assignedEmployeeId: assignedId,
    },
  });

  if (assignedId) {
    await notifyUser({
      userId: assignedId,
      text: `Reviziya biriktirildi: ${updated.branchName} — ${revisionDate}`,
      type: "reviziya_assigned",
      linkUrl: "/reviziya",
    });
  }

  await notifyReviziyaStakeholders({
    branchId: updated.branchId,
    branchName: updated.branchName,
    assignedRevizorId: assignedId,
    text: `${updated.branchName}: reviziya arizasi qabul qilindi. Kun: ${revisionDate}`,
    type: "reviziya_approved",
    linkUrl: "/reviziya",
  });

  res.json(enrichVisit(updated));
});

router.patch("/reviziya/visits/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionVisitsTable).where(eq(revisionVisitsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Reviziya topilmadi" });
    return;
  }
  if (!(await assertVisitAccess(req, row))) {
    res.status(403).json({ error: "Bu reviziyaga ruxsat yo‘q" });
    return;
  }
  if (row.workflowStatus === "CANCELLED") {
    res.status(400).json({ error: "Bekor qilingan reviziya o‘zgartirilmaydi" });
    return;
  }

  const updates: Partial<typeof revisionVisitsTable.$inferInsert> = { updatedById: req.userId! };
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};

  const setMoney = (key: "shortageAmount" | "excessAmount" | "collectedAmount", bodyKey: string) => {
    if (req.body?.[bodyKey] === undefined) return;
    const val = moneyInt(req.body[bodyKey]);
    oldValue[key] = row[key];
    newValue[key] = val;
    updates[key] = val;
  };

  if (req.body?.notes !== undefined) updates.notes = String(req.body.notes);
  if (req.body?.actNumber !== undefined) updates.actNumber = String(req.body.actNumber || "") || null;
  if (req.body?.actUrl !== undefined) updates.actUrl = String(req.body.actUrl || "") || null;
  if (req.body?.receiptUrl !== undefined) updates.receiptUrl = String(req.body.receiptUrl || "") || null;
  if (req.body?.extraDocs !== undefined && Array.isArray(req.body.extraDocs)) updates.extraDocs = req.body.extraDocs;
  if (req.body?.responsibleName !== undefined) updates.responsibleName = String(req.body.responsibleName);
  if (req.body?.priority !== undefined) updates.priority = String(req.body.priority);
  if (req.body?.revisionDate !== undefined) updates.revisionDate = String(req.body.revisionDate).slice(0, 10);
  if (req.body?.scheduledDate !== undefined) updates.scheduledDate = String(req.body.scheduledDate).slice(0, 10);
  if (req.body?.scheduledStartTime !== undefined) updates.scheduledStartTime = String(req.body.scheduledStartTime).slice(0, 8);
  if (req.body?.scheduledEndTime !== undefined) updates.scheduledEndTime = String(req.body.scheduledEndTime).slice(0, 8);

  setMoney("shortageAmount", "shortageAmount");
  setMoney("excessAmount", "excessAmount");
  setMoney("collectedAmount", "collectedAmount");

  if (updates.collectedAmount != null || updates.shortageAmount != null) {
    const sh = updates.shortageAmount ?? row.shortageAmount;
    let col = updates.collectedAmount ?? row.collectedAmount;
    if (col > sh && !canCorrectReviziyaAmounts(req.userRole)) {
      res.status(400).json({ error: "Undirilgan summa kamomaddan katta — correction ruxsati kerak" });
      return;
    }
    if (col > sh && !canCorrectReviziyaAmounts(req.userRole)) col = sh;
    updates.collectedAmount = col;
    updates.remainingAmount = computeRemainingAmount(sh, col);
    newValue.remainingAmount = updates.remainingAmount;
  }

  if (req.body?.nextRevisionDateOverride !== undefined) {
    if (!canOverrideRevisionSchedule(req.userRole)) {
      res.status(403).json({ error: "Schedule override uchun ruxsat yo‘q" });
      return;
    }
    const ov = req.body.nextRevisionDateOverride ? String(req.body.nextRevisionDateOverride).slice(0, 10) : null;
    oldValue.nextRevisionDateOverride = row.nextRevisionDateOverride;
    newValue.nextRevisionDateOverride = ov;
    updates.nextRevisionDateOverride = ov;
    await auditVisit({
      visitId: id,
      userId: req.userId,
      userName: null,
      role: req.userRole,
      action: "schedule_overridden",
      reason: req.body?.reason ? String(req.body.reason) : "Manual override",
      oldValue: { nextRevisionDateOverride: row.nextRevisionDateOverride },
      newValue: { nextRevisionDateOverride: ov },
    });
  }

  const [updated] = await db
    .update(revisionVisitsTable)
    .set(updates)
    .where(eq(revisionVisitsTable.id, id))
    .returning();

  await auditVisit({
    visitId: id,
    userId: req.userId,
    userName: null,
    role: req.userRole,
    action: Object.keys(newValue).some((k) => k.includes("Amount")) ? "amount_updated" : "revision_updated",
    oldValue: Object.keys(oldValue).length ? oldValue : null,
    newValue: Object.keys(newValue).length ? newValue : { ...updates },
    reason: req.body?.reason ? String(req.body.reason) : undefined,
  });

  if (req.body?.actUrl && req.body.actUrl !== row.actUrl) {
    await auditVisit({
      visitId: id,
      userId: req.userId,
      userName: null,
      role: req.userRole,
      action: "document_uploaded",
      detail: "act",
      newValue: { actUrl: req.body.actUrl },
    });
  }

  res.json(enrichVisit(updated));
});

router.post("/reviziya/visits/:id/assign", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  if (!canAssignReviziya(req.userRole)) {
    res.status(403).json({ error: "Biriktirish uchun ruxsat yo‘q" });
    return;
  }
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionVisitsTable).where(eq(revisionVisitsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Reviziya topilmadi" });
    return;
  }
  if (!(await assertVisitAccess(req, row))) {
    res.status(403).json({ error: "Bu reviziyaga ruxsat yo‘q" });
    return;
  }
  if (row.workflowStatus === "COMPLETED" || row.workflowStatus === "CANCELLED") {
    res.status(400).json({ error: "Yakunlangan/bekor qilingan reviziya qayta biriktirilmaydi" });
    return;
  }

  const assignedId = parseInt(String(req.body?.assignedEmployeeId || ""), 10);
  if (!Number.isFinite(assignedId)) {
    res.status(400).json({ error: "assignedEmployeeId majburiy" });
    return;
  }
  const [u] = await db
    .select({ fullName: usersTable.fullName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, assignedId))
    .limit(1);
  if (!u || (u.role !== "revizor" && u.role !== "reviziya_rahbar")) {
    res.status(400).json({ error: "Faqat revizor biriktiriladi" });
    return;
  }

  const prevId = row.assignedEmployeeId;
  const prevName = row.assignedEmployeeName;
  const reassigned = prevId != null && prevId !== assignedId;

  const [updated] = await db
    .update(revisionVisitsTable)
    .set({
      assignedEmployeeId: assignedId,
      assignedEmployeeName: u.fullName,
      workflowStatus: "ASSIGNED",
      updatedById: req.userId!,
      revisionDate: req.body?.revisionDate ? String(req.body.revisionDate).slice(0, 10) : row.revisionDate,
      scheduledStartTime: req.body?.scheduledStartTime
        ? String(req.body.scheduledStartTime).slice(0, 8)
        : row.scheduledStartTime,
    })
    .where(eq(revisionVisitsTable.id, id))
    .returning();

  await auditVisit({
    visitId: id,
    userId: req.userId,
    userName: null,
    role: req.userRole,
    action: reassigned ? "revision_reassigned" : "revision_assigned",
    reason: req.body?.reason ? String(req.body.reason) : undefined,
    oldValue: { assignedEmployeeId: prevId, assignedEmployeeName: prevName },
    newValue: { assignedEmployeeId: assignedId, assignedEmployeeName: u.fullName },
  });

  await notifyUser({
    userId: assignedId,
    text: `Reviziya biriktirildi: ${row.branchName} (${updated.revisionDate || updated.scheduledDate})`,
    type: "reviziya_assigned",
    linkUrl: "/reviziya",
  });
  if (reassigned && prevId) {
    await notifyUser({
      userId: prevId,
      text: `Reviziya qayta biriktirildi (${row.branchName}) — endi sizda emas`,
      type: "reviziya_reassigned",
      linkUrl: "/reviziya",
    });
  }

  res.json(enrichVisit(updated));
});

router.post("/reviziya/visits/:id/accept", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionVisitsTable).where(eq(revisionVisitsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Reviziya topilmadi" });
    return;
  }
  if (row.assignedEmployeeId !== req.userId && !canAssignReviziya(req.userRole) && !canViewAllReviziyaBranches(req.userRole)) {
    res.status(403).json({ error: "Faqat biriktirilgan revizor qabul qilishi mumkin" });
    return;
  }
  if (row.workflowStatus !== "ASSIGNED") {
    res.status(400).json({ error: "Faqat ASSIGNED holatida qabul qilinadi" });
    return;
  }
  const [updated] = await db
    .update(revisionVisitsTable)
    .set({ workflowStatus: "ACCEPTED", updatedById: req.userId! })
    .where(eq(revisionVisitsTable.id, id))
    .returning();
  await auditVisit({
    visitId: id,
    userId: req.userId,
    userName: null,
    role: req.userRole,
    action: "revision_accepted",
  });
  res.json(enrichVisit(updated));
});

router.post("/reviziya/visits/:id/start", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionVisitsTable).where(eq(revisionVisitsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Reviziya topilmadi" });
    return;
  }
  const isAssignee = row.assignedEmployeeId === req.userId;
  if (!isAssignee && !canAssignReviziya(req.userRole) && !canViewAllReviziyaBranches(req.userRole)) {
    res.status(403).json({ error: "Faqat biriktirilgan revizor boshlashi mumkin" });
    return;
  }
  if (!["ASSIGNED", "ACCEPTED"].includes(row.workflowStatus)) {
    res.status(400).json({ error: "Reviziya boshlash uchun noto‘g‘ri status" });
    return;
  }

  const serverNow = new Date();
  const [updated] = await db
    .update(revisionVisitsTable)
    .set({
      workflowStatus: "IN_PROGRESS",
      startedAt: serverNow,
      updatedById: req.userId!,
    })
    .where(eq(revisionVisitsTable.id, id))
    .returning();

  await auditVisit({
    visitId: id,
    userId: req.userId,
    userName: null,
    role: req.userRole,
    action: "revision_started",
    newValue: { startedAt: serverNow.toISOString() },
  });

  res.json(enrichVisit(updated));
});

router.post("/reviziya/visits/:id/complete", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionVisitsTable).where(eq(revisionVisitsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Reviziya topilmadi" });
    return;
  }
  const isAssignee = row.assignedEmployeeId === req.userId;
  if (!isAssignee && !canAssignReviziya(req.userRole) && !canViewAllReviziyaBranches(req.userRole)) {
    res.status(403).json({ error: "Faqat biriktirilgan revizor yakunlashi mumkin" });
    return;
  }
  if (!["IN_PROGRESS", "ACCEPTED", "ASSIGNED"].includes(row.workflowStatus)) {
    res.status(400).json({ error: "Reviziya yakunlash uchun noto‘g‘ri status" });
    return;
  }

  const shortage = req.body?.shortageAmount !== undefined ? moneyInt(req.body.shortageAmount) : row.shortageAmount;
  const excess = req.body?.excessAmount !== undefined ? moneyInt(req.body.excessAmount) : row.excessAmount;
  let collected = req.body?.collectedAmount !== undefined ? moneyInt(req.body.collectedAmount) : row.collectedAmount;
  if (collected > shortage && !canCorrectReviziyaAmounts(req.userRole)) {
    res.status(400).json({ error: "Undirilgan summa kamomaddan katta bo‘lishi mumkin emas" });
    return;
  }
  if (collected > shortage && !canCorrectReviziyaAmounts(req.userRole)) collected = shortage;

  const remaining = computeRemainingAmount(shortage, collected);
  const revisionDate = (req.body?.revisionDate ? String(req.body.revisionDate) : row.revisionDate || tashkentYmd()).slice(
    0,
    10,
  );
  const { nextRevisionDate, cycleMonths } = computeNextRevisionDate(revisionDate, shortage);

  const serverNow = new Date();
  const started = row.startedAt || serverNow;
  const durationMinutes = Math.max(0, Math.round((serverNow.getTime() - new Date(started).getTime()) / 60000));

  const actNumber =
    req.body?.actNumber !== undefined && String(req.body.actNumber || "").trim()
      ? await resolveActNumber(String(req.body.actNumber))
      : row.actNumber || (await generateUniqueActNumber());

  const [updated] = await db
    .update(revisionVisitsTable)
    .set({
      workflowStatus: "COMPLETED",
      completedAt: serverNow,
      completedById: req.userId!,
      startedAt: row.startedAt || serverNow,
      durationMinutes,
      shortageAmount: shortage,
      excessAmount: excess,
      collectedAmount: collected,
      remainingAmount: remaining,
      revisionDate,
      nextRevisionDate,
      cycleMonths,
      actNumber,
      actUrl: req.body?.actUrl !== undefined ? String(req.body.actUrl || "") || null : row.actUrl,
      receiptUrl: req.body?.receiptUrl !== undefined ? String(req.body.receiptUrl || "") || null : row.receiptUrl,
      notes: req.body?.notes !== undefined ? String(req.body.notes) : row.notes,
      extraDocs: Array.isArray(req.body?.extraDocs) ? req.body.extraDocs : row.extraDocs,
      updatedById: req.userId!,
    })
    .where(eq(revisionVisitsTable.id, id))
    .returning();

  await auditVisit({
    visitId: id,
    userId: req.userId,
    userName: null,
    role: req.userRole,
    action: "revision_completed",
    newValue: {
      completedAt: serverNow.toISOString(),
      durationMinutes,
      shortageAmount: shortage,
      collectedAmount: collected,
      remainingAmount: remaining,
      nextRevisionDate,
      cycleMonths,
    },
  });

  await notifyReviziyaStakeholders({
    branchId: row.branchId,
    branchName: row.branchName,
    assignedRevizorId: row.assignedEmployeeId,
    includeReviziyaRahbar: true,
    text: `${row.branchName}: reviziya yakunlandi. Kamomad ${shortage.toLocaleString("uz-UZ")}, qolgan ${remaining.toLocaleString("uz-UZ")} so‘m`,
    type: "reviziya_completed",
    linkUrl: "/reviziya",
  });

  res.json(enrichVisit(updated));
});

router.post("/reviziya/visits/:id/cancel", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  if (!canAssignReviziya(req.userRole) && !canViewAllReviziyaBranches(req.userRole)) {
    res.status(403).json({ error: "Bekor qilish uchun ruxsat yo‘q" });
    return;
  }
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionVisitsTable).where(eq(revisionVisitsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Reviziya topilmadi" });
    return;
  }
  if (row.workflowStatus === "COMPLETED") {
    res.status(400).json({ error: "Yakunlangan reviziya bekor qilinmaydi" });
    return;
  }
  const [updated] = await db
    .update(revisionVisitsTable)
    .set({ workflowStatus: "CANCELLED", updatedById: req.userId! })
    .where(eq(revisionVisitsTable.id, id))
    .returning();
  await auditVisit({
    visitId: id,
    userId: req.userId,
    userName: null,
    role: req.userRole,
    action: "revision_cancelled",
    reason: req.body?.reason ? String(req.body.reason) : undefined,
  });
  res.json(enrichVisit(updated));
});

router.get("/reviziya/visits/:id/history", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  const id = parseId(req.params.id);
  const [row] = await db.select().from(revisionVisitsTable).where(eq(revisionVisitsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Reviziya topilmadi" });
    return;
  }
  if (!(await assertVisitAccess(req, row))) {
    res.status(403).json({ error: "Bu reviziyaga ruxsat yo‘q" });
    return;
  }
  const history = await db
    .select()
    .from(revisionVisitsTable)
    .where(eq(revisionVisitsTable.branchId, row.branchId))
    .orderBy(desc(revisionVisitsTable.revisionDate), desc(revisionVisitsTable.id))
    .limit(100);
  const today = tashkentYmd();
  res.json({ items: history.map((v) => enrichVisit(v, today)) });
});

router.get("/reviziya/visits-report", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (denyView(req, res)) return;
  if (!canViewAllReviziyaBranches(req.userRole)) {
    res.status(403).json({ error: "Hisobot faqat rahbariyat / reviziya rahbari uchun" });
    return;
  }
  const from = String(req.query.from || "").slice(0, 10);
  const to = String(req.query.to || "").slice(0, 10);
  const conditions = [eq(revisionVisitsTable.workflowStatus, "COMPLETED")];
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) conditions.push(gte(revisionVisitsTable.revisionDate, from));
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) conditions.push(lte(revisionVisitsTable.revisionDate, to));

  const rows = await db
    .select()
    .from(revisionVisitsTable)
    .where(and(...conditions))
    .orderBy(desc(revisionVisitsTable.revisionDate))
    .limit(5000);

  const byBranch = new Map<string, { count: number; shortage: number; collected: number; remaining: number }>();
  const byRevizor = new Map<string, { count: number; shortage: number }>();
  for (const r of rows) {
    const b = byBranch.get(r.branchName) || { count: 0, shortage: 0, collected: 0, remaining: 0 };
    b.count += 1;
    b.shortage += r.shortageAmount;
    b.collected += r.collectedAmount;
    b.remaining += r.remainingAmount;
    byBranch.set(r.branchName, b);
    const name = r.assignedEmployeeName || "—";
    const rv = byRevizor.get(name) || { count: 0, shortage: 0 };
    rv.count += 1;
    rv.shortage += r.shortageAmount;
    byRevizor.set(name, rv);
  }

  res.json({
    totals: {
      count: rows.length,
      shortage: rows.reduce((s, r) => s + r.shortageAmount, 0),
      collected: rows.reduce((s, r) => s + r.collectedAmount, 0),
      remaining: rows.reduce((s, r) => s + r.remainingAmount, 0),
    },
    byBranch: [...byBranch.entries()].map(([name, v]) => ({ name, ...v })),
    byRevizor: [...byRevizor.entries()].map(([name, v]) => ({ name, ...v })),
  });
});

export default router;
