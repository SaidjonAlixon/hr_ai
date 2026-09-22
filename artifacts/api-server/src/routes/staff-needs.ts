import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  staffNeedRequestsTable,
  employeesTable,
  usersTable,
  requestsTable,
  vacanciesTable,
  branchNeedsTable,
  staffingAlertsTable,
  requestClaimsTable,
  javobOlishRequestsTable,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { notifyByRoles, notifyUser } from "../lib/notify";
import {
  HR_ROLES,
  isHrManager,
  hasFullPlatformAccess,
  isDirectorRole,
  isDeptHeadRole,
} from "../lib/roles";
import { ensureFarmasevtDepartmentId } from "../lib/farmasevt-department";
import { displayBranchName, stripGpsSuffix } from "../lib/geo-location";

const router: IRouter = Router();

const OPEN_STATUSES = ["open", "pending_hr", "approved", "searching"] as const;
const SHIFT_OPTS = new Set(["one", "two", "three"]);
const ROLE_OPTS = new Set(["farmasevt", "mudir", "stajyor"]);

function shiftLabelOf(shiftType: string, shiftLabel?: string | null): string {
  if (shiftLabel && /smena|\+/i.test(shiftLabel)) return shiftLabel;
  if (shiftType === "two") return "2-smena";
  if (shiftType === "three") return "3-smena";
  if (shiftType === "one") return "1-smena";
  return shiftLabel || shiftType || "1-smena";
}

function roleLabelOf(role: string, positionText?: string | null): string {
  if (role === "custom" && positionText) return positionText;
  if (role === "mudir") return "Mudir";
  if (role === "stajyor") return "Stajyor";
  if (role === "farmasevt") return "Farmasevt";
  return positionText || role || "Xodim";
}

function branchNameOf(location: string | null | undefined, fallback: string): string {
  const fromLoc = displayBranchName(location) || stripGpsSuffix(location);
  const generic = !fromLoc || /^(filial|apteka|branch|dorixona)\s*\d*$/i.test(fromLoc);
  return (generic ? fallback : fromLoc).trim() || fallback || "Filial";
}

function canCreateStaffNeed(role?: string | null): boolean {
  return role === "koordinator" || isDeptHeadRole(role) || hasFullPlatformAccess(role);
}

function canViewStaffNeed(role?: string | null): boolean {
  return (
    canCreateStaffNeed(role) ||
    isHrManager(role) ||
    isDirectorRole(role) ||
    role === "recruiter"
  );
}

async function actorCoordinator(userId: number) {
  const rows = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.userId, userId), eq(employeesTable.orgRole, "coordinator")));
  return rows[0] ?? null;
}

async function enrich(row: typeof staffNeedRequestsTable.$inferSelect) {
  let mgr: {
    id: number;
    fullName: string;
    location: string | null;
  } | null = null;
  if (row.managerEmployeeId) {
    const [m] = await db
      .select({
        id: employeesTable.id,
        fullName: employeesTable.fullName,
        location: employeesTable.location,
      })
      .from(employeesTable)
      .where(eq(employeesTable.id, row.managerEmployeeId))
      .limit(1);
    mgr = m ?? null;
  }

  const [creator] = await db
    .select({ fullName: usersTable.fullName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, row.coordinatorUserId))
    .limit(1);

  let hrName: string | null = null;
  if (row.hrApprovedById) {
    const [u] = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, row.hrApprovedById))
      .limit(1);
    hrName = u?.fullName ?? null;
  }

  let foundByName: string | null = null;
  if (row.foundById) {
    const [u] = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, row.foundById))
      .limit(1);
    foundByName = u?.fullName ?? null;
  }

  const isOffice = row.sourceType === "office";
  const branch = isOffice
    ? "Ofis / bo‘lim"
    : branchNameOf(row.branchLocation || mgr?.location, mgr?.fullName || "Filial");

  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    hrApprovedAt: row.hrApprovedAt?.toISOString() ?? null,
    deadlineAt: row.deadlineAt?.toISOString() ?? null,
    foundAt: row.foundAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    branchName: branch,
    managerName: mgr?.fullName ?? null,
    coordinatorName: creator?.fullName ?? null,
    creatorRole: creator?.role ?? null,
    hrApprovedByName: hrName,
    foundByName,
    shiftDisplay: isOffice ? "—" : shiftLabelOf(row.shiftType, row.shiftLabel),
    roleDisplay: roleLabelOf(row.roleNeeded, row.positionText),
  };
}

/** Admin/HR: majburiy tozalash (eski ogohlantirish/ariza/ehtiyoj/javob → 0) */
router.post("/staff-needs/admin/purge-legacy", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole ?? "";
  if (!hasFullPlatformAccess(role) && !isHrManager(role)) {
    res.status(403).json({ error: "Ruxsat yoʻq" });
    return;
  }

  const [alerts] = await Promise.all([
    db
      .update(staffingAlertsTable)
      .set({ workflowStatus: "closed" })
      .where(inArray(staffingAlertsTable.workflowStatus, ["pending", "confirmed"]))
      .returning({ id: staffingAlertsTable.id }),
  ]);
  const closedReqs = await db
    .update(requestsTable)
    .set({ status: "closed" })
    .where(inArray(requestsTable.status, ["submitted", "reviewing", "accepted", "announced"]))
    .returning({ id: requestsTable.id });
  const closedNeeds = await db
    .update(branchNeedsTable)
    .set({ status: "closed", closedAt: new Date() })
    .where(inArray(branchNeedsTable.status, ["pending", "assigned", "in_progress", "done"]))
    .returning({ id: branchNeedsTable.id });
  await db
    .update(employeesTable)
    .set({ employmentStatus: "closed" })
    .where(
      and(
        inArray(employeesTable.employmentStatus, ["need_hire", "searching", "new"]),
        inArray(employeesTable.orgRole, ["pharmacist", "intern", "supervisor", "manager"]),
      ),
    );
  const closedJavob = await db
    .update(javobOlishRequestsTable)
    .set({ status: "cancelled" })
    .where(inArray(javobOlishRequestsTable.status, ["pending", "pending_coord", "pending_hr"]))
    .returning({ id: javobOlishRequestsTable.id });
  await db
    .update(vacanciesTable)
    .set({ status: "closed" })
    .where(inArray(vacanciesTable.status, ["draft", "published"]));
  await db
    .update(requestClaimsTable)
    .set({ status: "rejected" })
    .where(inArray(requestClaimsTable.status, ["pending", "accepted"]));

  res.json({
    ok: true,
    closedAlerts: alerts.length,
    closedRequests: closedReqs.length,
    closedBranchNeeds: closedNeeds.length,
    closedJavob: closedJavob.length,
  });
});

router.get("/staff-needs/my-branches", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "koordinator" || !req.userId) {
    res.status(403).json({ error: "Faqat koordinator" });
    return;
  }
  const coord = await actorCoordinator(req.userId);
  if (!coord) {
    res.json([]);
    return;
  }
  const managers = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      location: employeesTable.location,
      latitude: employeesTable.latitude,
      longitude: employeesTable.longitude,
    })
    .from(employeesTable)
    .where(
      and(eq(employeesTable.orgRole, "manager"), eq(employeesTable.reportsToId, coord.id)),
    )
    .orderBy(asc(employeesTable.fullName));

  res.json(
    managers.map((m) => ({
      id: m.id,
      managerName: m.fullName,
      branchLocation: branchNameOf(m.location, m.fullName),
      latitude: m.latitude,
      longitude: m.longitude,
    })),
  );
});

router.get("/staff-needs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole ?? "";
  if (!canViewStaffNeed(role)) {
    res.status(403).json({ error: "Ruxsat yoʻq" });
    return;
  }

  const { status } = req.query as Record<string, string>;
  let rows = await db
    .select()
    .from(staffNeedRequestsTable)
    .orderBy(desc(staffNeedRequestsTable.createdAt));

  if (status === "open") {
    rows = rows.filter((r) => (OPEN_STATUSES as readonly string[]).includes(r.status));
  } else if (status === "pending_hr") {
    rows = rows.filter((r) => r.status === "pending_hr" || r.status === "open");
  } else if (status === "active") {
    rows = rows.filter((r) =>
      ["open", "pending_hr", "approved", "searching"].includes(r.status),
    );
  } else if (status === "history") {
    rows = rows.filter((r) => ["found", "rejected", "cancelled"].includes(r.status));
  } else if (status) {
    rows = rows.filter((r) => r.status === status);
  }

  if (role === "koordinator" && req.userId) {
    rows = rows.filter((r) => r.coordinatorUserId === req.userId);
  } else if (isDeptHeadRole(role) && !isHrManager(role) && req.userId) {
    rows = rows.filter((r) => r.coordinatorUserId === req.userId);
  }

  res.json(await Promise.all(rows.map(enrich)));
});

router.post("/staff-needs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole ?? "";
  if (!canCreateStaffNeed(role) || !req.userId) {
    res.status(403).json({ error: "Ruxsat yoʻq" });
    return;
  }

  const isCoord = role === "koordinator";
  const isOffice = !isCoord && (isDeptHeadRole(role) || hasFullPlatformAccess(role));

  const count = Math.max(1, Math.min(20, parseInt(String(req.body?.count ?? "1"), 10) || 1));
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : null;
  const neededBy =
    typeof req.body?.neededBy === "string" ? req.body.neededBy.trim().slice(0, 80) : null;

  if (isCoord) {
    const coord = await actorCoordinator(req.userId);
    if (!coord) {
      res.status(400).json({ error: "Koordinator kartasi yoʻq" });
      return;
    }
    const managerEmployeeId = parseInt(String(req.body?.managerEmployeeId ?? ""), 10);
    let shiftType = String(req.body?.shiftType ?? "one").trim().toLowerCase();
    if (!SHIFT_OPTS.has(shiftType)) shiftType = "one";
    let roleNeeded = String(req.body?.roleNeeded ?? "farmasevt").trim().toLowerCase();
    if (!ROLE_OPTS.has(roleNeeded)) roleNeeded = "farmasevt";

    if (!Number.isFinite(managerEmployeeId)) {
      res.status(400).json({ error: "Filial tanlang" });
      return;
    }
    const [mgr] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.id, managerEmployeeId))
      .limit(1);
    if (!mgr || mgr.orgRole !== "manager" || mgr.reportsToId !== coord.id) {
      res.status(403).json({ error: "Faqat o‘z filiallaringizga so‘rov yuborasiz" });
      return;
    }

    const existing = await db
      .select({ id: staffNeedRequestsTable.id })
      .from(staffNeedRequestsTable)
      .where(
        and(
          eq(staffNeedRequestsTable.managerEmployeeId, managerEmployeeId),
          eq(staffNeedRequestsTable.shiftType, shiftType),
          eq(staffNeedRequestsTable.roleNeeded, roleNeeded),
          inArray(staffNeedRequestsTable.status, [...OPEN_STATUSES]),
        ),
      )
      .limit(1);
    if (existing.length) {
      res.status(400).json({
        error: "Bu filial + smena uchun ochiq so‘rov bor — HR tasdiǧini kuting yoki Topildi qiling",
      });
      return;
    }

    const branch = branchNameOf(mgr.location, mgr.fullName);
    const shift = shiftLabelOf(shiftType);
    const roleL = roleLabelOf(roleNeeded);
    const deptId = await ensureFarmasevtDepartmentId();

    const [createdReq] = await db
      .insert(requestsTable)
      .values({
        departmentId: deptId,
        position: roleL,
        count,
        description: `${branch} · ${shift} — Xodim kerak (koordinator).`,
        requirements: null,
        salaryRange: null,
        deadline: null,
        reason: `Filial: ${branch}. Smena: ${shift}. Lavozim: ${roleL}. Son: ${count}.${neededBy ? ` Kerak: ${neededBy}.` : ""}${note ? ` Izoh: ${note}` : ""}`,
        city: branch,
        district: "—",
        priority: "urgent",
        status: "submitted",
        createdById: req.userId,
      })
      .returning();

    const [created] = await db
      .insert(staffNeedRequestsTable)
      .values({
        coordinatorUserId: req.userId,
        managerEmployeeId,
        branchLocation: branch,
        shiftType,
        shiftLabel: shift,
        roleNeeded,
        sourceType: "pharmacy",
        neededBy,
        count,
        note,
        status: "open",
        requestId: createdReq.id,
      })
      .returning();

    await notifyByRoles({
      roles: [...HR_ROLES, "admin", "recruiter"],
      text: `Xodim kerak (ochiq): ${branch} · ${shift} · ${roleL} ×${count}`,
      type: "new_request",
      linkUrl: "/xodim-kerak",
    });

    try {
      const { notifyFilialRecruitersStaffNeed } = await import("../lib/filial-recruiter-notify");
      await notifyFilialRecruitersStaffNeed({
        employee: {
          fullName: `${roleL} ×${count}`,
          location: branch,
          latitude: null,
          longitude: null,
          orgRole:
            roleNeeded === "mudir" ? "manager" : roleNeeded === "stajyor" ? "intern" : "pharmacist",
          shiftType,
          shiftLabel: shift,
        },
        branchLocation: branch,
        status: "need_hire",
      });
    } catch (err) {
      console.error("[staff-needs] notify", err);
    }

    res.status(201).json(await enrich(created));
    return;
  }

  if (!isOffice) {
    res.status(403).json({ error: "Ruxsat yoʻq" });
    return;
  }

  const positionText =
    typeof req.body?.positionText === "string" ? req.body.positionText.trim().slice(0, 200) : "";
  if (positionText.length < 3) {
    res.status(400).json({ error: "Qanday xodim kerakligini yozing (kamida 3 belgi)" });
    return;
  }

  const deptId = await ensureFarmasevtDepartmentId();
  const [createdReq] = await db
    .insert(requestsTable)
    .values({
      departmentId: deptId,
      position: positionText,
      count,
      description: `Ofis / bo‘lim — Xodim kerak.`,
      requirements: null,
      salaryRange: null,
      deadline: null,
      reason: `Lavozim: ${positionText}. Son: ${count}.${neededBy ? ` Kerak: ${neededBy}.` : ""}${note ? ` Izoh: ${note}` : ""}`,
      city: "Ofis",
      district: "Ofis",
      priority: "urgent",
      status: "submitted",
      createdById: req.userId,
    })
    .returning();

  const [created] = await db
    .insert(staffNeedRequestsTable)
    .values({
      coordinatorUserId: req.userId,
      managerEmployeeId: null,
      branchLocation: "Ofis / bo‘lim",
      shiftType: "one",
      shiftLabel: null,
      roleNeeded: "custom",
      positionText,
      sourceType: "office",
      neededBy,
      count,
      note,
      status: "open",
      requestId: createdReq.id,
    })
    .returning();

  await notifyByRoles({
    roles: [...HR_ROLES, "admin", "recruiter"],
    text: `Ofis xodim kerak (ochiq): ${positionText} ×${count}`,
    type: "new_request",
    linkUrl: "/xodim-kerak",
  });

  res.status(201).json(await enrich(created));
});

/** HR tasdiqlash = Topildi — ariza yopiladi, botdan yo‘qoladi */
router.post("/staff-needs/:id/approve", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole ?? "";
  if (!isHrManager(role) && !isDirectorRole(role)) {
    res.status(403).json({ error: "Faqat HR menejer tasdiqlaydi" });
    return;
  }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [row] = await db
    .select()
    .from(staffNeedRequestsTable)
    .where(eq(staffNeedRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  if (!(OPEN_STATUSES as readonly string[]).includes(row.status)) {
    res.status(400).json({ error: "Bu so‘rov allaqachon yopilgan" });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(staffNeedRequestsTable)
    .set({
      status: "found",
      hrApprovedById: req.userId ?? null,
      hrApprovedAt: now,
      foundById: req.userId ?? null,
      foundAt: now,
    })
    .where(eq(staffNeedRequestsTable.id, id))
    .returning();

  if (row.requestId) {
    await db
      .update(requestsTable)
      .set({ status: "closed" })
      .where(eq(requestsTable.id, row.requestId));
  }

  await notifyUser({
    userId: row.coordinatorUserId,
    text: `HR tasdiqladi (Topildi): ${row.branchLocation || "So‘rov"} · ${roleLabelOf(row.roleNeeded, row.positionText)} ×${row.count} — yopildi`,
    type: "stage_change",
    linkUrl: "/xodim-kerak",
  });

  res.json({ need: await enrich(updated), requestId: row.requestId });
});

router.post("/staff-needs/:id/reject", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole ?? "";
  if (!isHrManager(role) && !isDirectorRole(role)) {
    res.status(403).json({ error: "Faqat HR menejer" });
    return;
  }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 400) : "";
  if (reason.length < 3) {
    res.status(400).json({ error: "Rad etish uchun izoh majburiy (kamida 3 belgi)" });
    return;
  }
  const [row] = await db
    .select()
    .from(staffNeedRequestsTable)
    .where(eq(staffNeedRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  if (!(OPEN_STATUSES as readonly string[]).includes(row.status)) {
    res.status(400).json({ error: "Bu so‘rov allaqachon yopilgan" });
    return;
  }
  const [updated] = await db
    .update(staffNeedRequestsTable)
    .set({
      status: "rejected",
      rejectedById: req.userId ?? null,
      rejectedAt: new Date(),
      rejectReason: reason,
    })
    .where(eq(staffNeedRequestsTable.id, id))
    .returning();

  if (row.requestId) {
    await db
      .update(requestsTable)
      .set({ status: "closed" })
      .where(eq(requestsTable.id, row.requestId));
  }

  await notifyUser({
    userId: row.coordinatorUserId,
    text: `HR rad etdi: ${row.branchLocation || "So‘rov"} — ${reason}`,
    type: "stage_change",
    linkUrl: "/xodim-kerak",
  });

  res.json(await enrich(updated));
});

/** Topildi / yopish — HR, rekruter, yuboruvchi. Yopilgach botdan yo‘qoladi. */
router.post("/staff-needs/:id/found", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole ?? "";
  const canClose =
    isHrManager(role) ||
    isDirectorRole(role) ||
    role === "recruiter" ||
    role === "koordinator" ||
    isDeptHeadRole(role);
  if (!canClose) {
    res.status(403).json({ error: "Ruxsat yoʻq" });
    return;
  }

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [row] = await db
    .select()
    .from(staffNeedRequestsTable)
    .where(eq(staffNeedRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  if (
    (role === "koordinator" || isDeptHeadRole(role)) &&
    !isHrManager(role) &&
    row.coordinatorUserId !== req.userId
  ) {
    res.status(403).json({ error: "Faqat o‘z so‘rovingizni yopasiz" });
    return;
  }
  if (!(OPEN_STATUSES as readonly string[]).includes(row.status)) {
    res.status(400).json({ error: "Bu so‘rov allaqachon yopilgan" });
    return;
  }

  const [updated] = await db
    .update(staffNeedRequestsTable)
    .set({
      status: "found",
      foundById: req.userId ?? null,
      foundAt: new Date(),
      hrApprovedById: isHrManager(role) ? req.userId ?? null : row.hrApprovedById,
      hrApprovedAt: isHrManager(role) ? new Date() : row.hrApprovedAt,
    })
    .where(eq(staffNeedRequestsTable.id, id))
    .returning();

  if (row.requestId) {
    await db
      .update(requestsTable)
      .set({ status: "closed" })
      .where(eq(requestsTable.id, row.requestId));
  }

  await notifyByRoles({
    roles: [...HR_ROLES, "admin", "recruiter", "koordinator"],
    text: `Topildi / yopildi: ${row.branchLocation || "So‘rov"} · ${roleLabelOf(row.roleNeeded, row.positionText)} ×${row.count}`,
    type: "stage_change",
    linkUrl: "/xodim-kerak",
  });

  res.json(await enrich(updated));
});

router.post("/staff-needs/:id/cancel", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole ?? "";
  if ((!canCreateStaffNeed(role) && !isHrManager(role)) || !req.userId) {
    res.status(403).json({ error: "Ruxsat yoʻq" });
    return;
  }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [row] = await db
    .select()
    .from(staffNeedRequestsTable)
    .where(eq(staffNeedRequestsTable.id, id))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  const isHr = isHrManager(role) || isDirectorRole(role);
  if (!isHr && row.coordinatorUserId !== req.userId) {
    res.status(403).json({ error: "Faqat o‘z so‘rovingiz" });
    return;
  }
  if (!(OPEN_STATUSES as readonly string[]).includes(row.status)) {
    res.status(400).json({ error: "Yopiq so‘rov" });
    return;
  }

  const [updated] = await db
    .update(staffNeedRequestsTable)
    .set({
      status: isHr ? "found" : "cancelled",
      foundById: isHr ? req.userId : null,
      foundAt: isHr ? new Date() : null,
    })
    .where(eq(staffNeedRequestsTable.id, id))
    .returning();

  if (row.requestId) {
    await db.update(requestsTable).set({ status: "closed" }).where(eq(requestsTable.id, row.requestId));
  }

  res.json(await enrich(updated));
});

export default router;
