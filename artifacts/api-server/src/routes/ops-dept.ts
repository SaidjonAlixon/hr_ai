import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db, opsTicketsTable, usersTable, employeesTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import {
  ACCEPT_STATUSES,
  DONE_STATUSES,
  IT_CATEGORIES,
  TEXNIK_CATEGORIES,
  TICKET_STATUS,
  VERIFY_STATUSES,
  canAssignOpsTicket,
  canCreateOpsTicket,
  canManageOpsDept,
  canViewAllOpsTickets,
  canViewOpsDept,
  isOpsDeptHead,
  isPharmacyOpsRole,
} from "../lib/ops-dept";
import { IT_ROLES } from "../lib/roles";
import { notifyByRoles, notifyUser } from "../lib/notify";

const router: IRouter = Router();

function parseDept(raw: unknown): "it" | "texnik" | null {
  return raw === "it" || raw === "texnik" ? raw : null;
}

function iso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

async function resolveMyBranch(userId: number): Promise<string | null> {
  const [emp] = await db
    .select({
      id: employeesTable.id,
      location: employeesTable.location,
      assignedBranchId: employeesTable.assignedBranchId,
      orgRole: employeesTable.orgRole,
      reportsToId: employeesTable.reportsToId,
    })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);
  if (!emp) return null;
  if (emp.location?.trim()) return emp.location.trim();
  const branchId =
    emp.assignedBranchId || (emp.orgRole === "manager" ? emp.id : emp.reportsToId);
  if (!branchId) return null;
  const [mgr] = await db
    .select({
      location: employeesTable.location,
      fullName: employeesTable.fullName,
    })
    .from(employeesTable)
    .where(eq(employeesTable.id, branchId))
    .limit(1);
  return mgr?.location?.trim() || mgr?.fullName || null;
}

async function nameMap(ids: Array<number | null | undefined>) {
  const uniq = [...new Set(ids.filter((x): x is number => typeof x === "number" && x > 0))];
  if (!uniq.length) return new Map<number, string>();
  const rows = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName })
    .from(usersTable)
    .where(inArray(usersTable.id, uniq));
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

async function enrichTickets(rows: (typeof opsTicketsTable.$inferSelect)[]) {
  const names = await nameMap(
    rows.flatMap((r) => [
      r.createdById,
      r.assigneeId,
      r.assignedById,
      r.acceptedById,
      r.completedById,
      r.verifiedById,
    ]),
  );
  return rows.map((r) => ({
    ...r,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    acceptedAt: iso(r.acceptedAt),
    completedAt: iso(r.completedAt),
    verifiedAt: iso(r.verifiedAt),
    closedAt: iso(r.closedAt),
    createdByName: r.createdById ? names.get(r.createdById) || null : null,
    assigneeName: r.assigneeId ? names.get(r.assigneeId) || null : null,
    assignedByName: r.assignedById ? names.get(r.assignedById) || null : null,
    acceptedByName: r.acceptedById ? names.get(r.acceptedById) || null : null,
    completedByName: r.completedById ? names.get(r.completedById) || null : null,
    verifiedByName: r.verifiedById ? names.get(r.verifiedById) || null : null,
  }));
}

router.get("/ops-tickets/meta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const dept = parseDept(req.query.dept);
  if (!dept || !canViewOpsDept(dept, req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const roles = dept === "it" ? [...IT_ROLES] : ["texnik", "texnik_rahbar"];
  const staff = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.status, "active"));
  const pharmacy = isPharmacyOpsRole(req.userRole);
  const myBranch = req.userId && pharmacy ? await resolveMyBranch(req.userId) : null;
  const isHead = isOpsDeptHead(dept, req.userRole);
  res.json({
    dept,
    categories: dept === "it" ? IT_CATEGORIES : TEXNIK_CATEGORIES,
    statuses: TICKET_STATUS,
    staff: staff.filter((s) => roles.includes(s.role as (typeof IT_ROLES)[number]) && s.role !== "it_rahbar"),
    canManage: canManageOpsDept(dept, req.userRole),
    canCreate: canCreateOpsTicket(dept, req.userRole),
    canViewAll: canViewAllOpsTickets(dept, req.userRole),
    canAssign: canAssignOpsTicket(dept, req.userRole),
    isDeptHead: isHead,
    formMode: pharmacy ? "pharmacy" : isHead || canManageOpsDept(dept, req.userRole) ? "staff" : "office",
    myBranch,
  });
});

router.get("/ops-tickets", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const dept = parseDept(req.query.dept);
  if (!dept || !canViewOpsDept(dept, req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const mine = req.query.mine === "1" || req.query.mine === "true";
  const cond = [eq(opsTicketsTable.dept, dept)];
  if (status) cond.push(eq(opsTicketsTable.status, status));

  if (mine) {
    if (!req.userId) {
      res.json([]);
      return;
    }
    cond.push(eq(opsTicketsTable.createdById, req.userId));
  } else if (canViewAllOpsTickets(dept, req.userRole)) {
    // rahbar — hammasi
  } else if (canManageOpsDept(dept, req.userRole) && req.userId) {
    // oddiy AyTi xodimi — o‘ziga biriktirilgan + o‘zi yozgan
    cond.push(
      or(
        eq(opsTicketsTable.assigneeId, req.userId),
        eq(opsTicketsTable.createdById, req.userId),
      )!,
    );
  } else {
    if (!req.userId) {
      res.json([]);
      return;
    }
    cond.push(eq(opsTicketsTable.createdById, req.userId));
  }

  const rows = await db
    .select()
    .from(opsTicketsTable)
    .where(and(...cond))
    .orderBy(desc(opsTicketsTable.createdAt))
    .limit(400);
  res.json(await enrichTickets(rows));
});

router.post("/ops-tickets", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const dept = parseDept(req.body?.dept);
  if (!dept || !canCreateOpsTicket(dept, req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const title = String(req.body?.title || "").trim();
  if (!title) {
    res.status(400).json({ error: "Mavzuni kiriting" });
    return;
  }
  const description = req.body?.description ? String(req.body.description).trim() : "";
  if (description.length < 3) {
    res.status(400).json({ error: "Muammoni qisqa yozing (kamida 3 belgi)" });
    return;
  }

  const pharmacy = isPharmacyOpsRole(req.userRole);
  let branchName: string | null = null;
  if (pharmacy && req.userId) {
    branchName = await resolveMyBranch(req.userId);
    if (!branchName) {
      res.status(400).json({ error: "Filialingiz topilmadi — koordinator/mudir bilan bog‘laning" });
      return;
    }
  } else if (req.body?.branchName) {
    branchName = String(req.body.branchName).trim() || null;
  }

  const prefix = dept === "it" ? "IT" : "TX";
  const ticketNo = `${prefix}-${new Date().getFullYear()}-${String(Date.now() % 100000).padStart(5, "0")}`;

  const [row] = await db
    .insert(opsTicketsTable)
    .values({
      ticketNo,
      dept,
      category: "other",
      title,
      description,
      branchName,
      priority: "normal",
      status: "new",
      createdById: req.userId ?? null,
      assigneeId: null,
    })
    .returning();

  const whoRow = req.userId
    ? await db
        .select({ fullName: usersTable.fullName })
        .from(usersTable)
        .where(eq(usersTable.id, req.userId))
        .limit(1)
    : [];
  const who = whoRow[0]?.fullName || "Xodim";
  const branchTxt = branchName ? ` · ${branchName}` : "";
  await notifyByRoles({
    roles: ["it_rahbar", "admin"],
    text: `Yangi AyTi ariza: ${who}${branchTxt} — ${title}`,
    type: "ops_ticket",
    linkUrl: "/it",
  });

  res.status(201).json((await enrichTickets([row]))[0]);
});

router.patch("/ops-tickets/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(opsTicketsTable).where(eq(opsTicketsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  const dept = existing.dept as "it" | "texnik";
  const action = typeof req.body?.action === "string" ? req.body.action : "";
  const isCreator = !!req.userId && existing.createdById === req.userId;
  const canManage = canManageOpsDept(dept, req.userRole);
  const canAssign = canAssignOpsTicket(dept, req.userRole);
  const isAssignee = !!req.userId && existing.assigneeId === req.userId;
  const now = new Date();

  /** Ariza egasi — bajarilgan ishni baholaydi */
  if (action === "verify") {
    if (!isCreator) {
      res.status(403).json({ error: "Baholash faqat ariza egasi uchun" });
      return;
    }
    if (existing.status !== "done") {
      res.status(400).json({ error: "Avval AyTi «Bajarildi» deb belgilashi kerak" });
      return;
    }
    const result = String(req.body?.verifyResult || "done");
    if (!["done", "partial", "not_done"].includes(result)) {
      res.status(400).json({ error: "Noto‘g‘ri baho" });
      return;
    }

    if (result === "not_done") {
      const [updated] = await db
        .update(opsTicketsTable)
        .set({
          status: "in_progress",
          verifyResult: result,
          verifiedAt: now,
          verifiedById: req.userId || null,
          completedAt: null,
          completedById: null,
          closedAt: null,
          updatedAt: now,
        })
        .where(eq(opsTicketsTable.id, id))
        .returning();
      if (existing.assigneeId) {
        await notifyUser({
          userId: existing.assigneeId,
          text: `Ariza qayta ochildi (bajarilmadi): ${existing.title}`,
          type: "ops_ticket",
          linkUrl: "/it",
        });
      }
      res.json((await enrichTickets([updated]))[0]);
      return;
    }

    const [updated] = await db
      .update(opsTicketsTable)
      .set({
        status: "verified",
        verifyResult: result,
        verifiedAt: now,
        verifiedById: req.userId || null,
        closedAt: now,
        updatedAt: now,
      })
      .where(eq(opsTicketsTable.id, id))
      .returning();
    res.json((await enrichTickets([updated]))[0]);
    return;
  }

  /** Rahbar — xodimga yo‘naltirish */
  if (action === "assign") {
    if (!canAssign) {
      res.status(403).json({ error: "Yo‘naltirish faqat bo‘lim boshlig‘i uchun" });
      return;
    }
    const assigneeId = Number(req.body?.assigneeId);
    if (!assigneeId) {
      res.status(400).json({ error: "Xodimni tanlang" });
      return;
    }
    const [updated] = await db
      .update(opsTicketsTable)
      .set({
        assigneeId,
        assignedById: req.userId ?? null,
        status: existing.status === "new" ? "accepted" : existing.status,
        acceptedAt: existing.acceptedAt || now,
        acceptedById: existing.acceptedById || req.userId || null,
        updatedAt: now,
      })
      .where(eq(opsTicketsTable.id, id))
      .returning();
    await notifyUser({
      userId: assigneeId,
      text: `Sizga AyTi ariza biriktirildi: ${existing.title}`,
      type: "ops_ticket",
      linkUrl: "/it",
    });
    res.json((await enrichTickets([updated]))[0]);
    return;
  }

  if (action === "accept") {
    if (!canManage) {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    const [updated] = await db
      .update(opsTicketsTable)
      .set({
        status: "accepted",
        acceptedAt: existing.acceptedAt || now,
        acceptedById: existing.acceptedById || req.userId || null,
        assigneeId: existing.assigneeId || req.userId || null,
        assignedById: existing.assignedById || (canAssign ? req.userId : existing.assignedById) || null,
        updatedAt: now,
      })
      .where(eq(opsTicketsTable.id, id))
      .returning();
    res.json((await enrichTickets([updated]))[0]);
    return;
  }

  if (action === "complete") {
    if (!canManage && !isAssignee) {
      res.status(403).json({ error: "Ruxsat yo‘q" });
      return;
    }
    if (existing.assigneeId && !isAssignee && !canAssign) {
      res.status(403).json({ error: "Faqat biriktirilgan xodim bajarishi mumkin" });
      return;
    }
    const [updated] = await db
      .update(opsTicketsTable)
      .set({
        status: "done",
        acceptedAt: existing.acceptedAt || now,
        acceptedById: existing.acceptedById || req.userId || null,
        completedAt: now,
        completedById: req.userId || null,
        updatedAt: now,
      })
      .where(eq(opsTicketsTable.id, id))
      .returning();
    if (existing.createdById) {
      await notifyUser({
        userId: existing.createdById,
        text: `Arizangiz bajarildi — baholang: ${existing.title}`,
        type: "ops_ticket",
        linkUrl: "/it",
      });
    }
    res.json((await enrichTickets([updated]))[0]);
    return;
  }

  if (!canManage) {
    res.status(403).json({ error: "Holatni AyTi xodimi o‘zgartiradi" });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: now };

  if (req.body.status && canAssign) {
    const nextStatus = String(req.body.status);
    updates.status = nextStatus;
    if (ACCEPT_STATUSES.has(nextStatus) && !existing.acceptedAt) {
      updates.acceptedAt = now;
      updates.acceptedById = req.userId ?? null;
    }
    if (DONE_STATUSES.has(nextStatus) && !existing.completedAt) {
      updates.completedAt = now;
      updates.completedById = req.userId ?? null;
    }
    if (VERIFY_STATUSES.has(nextStatus)) {
      if (!existing.verifiedAt) {
        updates.verifiedAt = now;
        updates.verifiedById = req.userId ?? null;
      }
      updates.closedAt = existing.closedAt || now;
    }
  }

  if (req.body.assigneeId !== undefined) {
    if (!canAssign) {
      res.status(403).json({ error: "Yo‘naltirish faqat bo‘lim boshlig‘i uchun" });
      return;
    }
    updates.assigneeId = req.body.assigneeId ? Number(req.body.assigneeId) : null;
    updates.assignedById = req.userId ?? null;
    if (req.body.assigneeId && existing.status === "new") {
      updates.status = "accepted";
      if (!existing.acceptedAt) {
        updates.acceptedAt = now;
        updates.acceptedById = req.userId ?? null;
      }
    }
  }

  if (req.body.priority && canAssign) updates.priority = String(req.body.priority);

  const [updated] = await db.update(opsTicketsTable).set(updates).where(eq(opsTicketsTable.id, id)).returning();
  res.json((await enrichTickets([updated]))[0]);
});

router.get("/ops-tickets/dashboard", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const dept = parseDept(req.query.dept);
  if (!dept || !canViewOpsDept(dept, req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const cond = [eq(opsTicketsTable.dept, dept)];
  if (canViewAllOpsTickets(dept, req.userRole)) {
    // all
  } else if (canManageOpsDept(dept, req.userRole) && req.userId) {
    cond.push(
      or(
        eq(opsTicketsTable.assigneeId, req.userId),
        eq(opsTicketsTable.createdById, req.userId),
      )!,
    );
  } else {
    if (!req.userId) {
      res.json({ total: 0, open: 0, urgent: 0, byStatus: {}, byCat: {}, awaitingVerify: 0 });
      return;
    }
    cond.push(eq(opsTicketsTable.createdById, req.userId));
  }
  const rows = await db.select().from(opsTicketsTable).where(and(...cond));
  const byStatus: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byCat[r.category] = (byCat[r.category] || 0) + 1;
  }
  res.json({
    total: rows.length,
    open: rows.filter((r) => r.status !== "closed" && r.status !== "verified").length,
    urgent: rows.filter((r) => r.priority === "urgent" && r.status !== "closed" && r.status !== "verified").length,
    awaitingVerify: rows.filter((r) => r.status === "done").length,
    byStatus,
    byCat,
  });
});

export default router;
