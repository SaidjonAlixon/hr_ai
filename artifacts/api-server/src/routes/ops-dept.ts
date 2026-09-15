import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, opsTicketsTable, usersTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import {
  ACCEPT_STATUSES,
  DONE_STATUSES,
  IT_CATEGORIES,
  TEXNIK_CATEGORIES,
  TICKET_STATUS,
  VERIFY_STATUSES,
  canCreateOpsTicket,
  canManageOpsDept,
  canViewAllOpsTickets,
  canViewOpsDept,
} from "../lib/ops-dept";
import { IT_ROLES } from "../lib/roles";

const router: IRouter = Router();

function parseDept(raw: unknown): "it" | "texnik" | null {
  return raw === "it" || raw === "texnik" ? raw : null;
}

function iso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
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
    rows.flatMap((r) => [r.createdById, r.assigneeId, r.acceptedById, r.completedById, r.verifiedById]),
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
  res.json({
    dept,
    categories: dept === "it" ? IT_CATEGORIES : TEXNIK_CATEGORIES,
    statuses: TICKET_STATUS,
    staff: staff.filter((s) => roles.includes(s.role as (typeof IT_ROLES)[number])),
    canManage: canManageOpsDept(dept, req.userRole),
    canCreate: canCreateOpsTicket(dept, req.userRole),
    canViewAll: canViewAllOpsTickets(dept, req.userRole),
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
  if (mine || !canViewAllOpsTickets(dept, req.userRole)) {
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
    res.status(400).json({ error: "Sarlavha kiriting" });
    return;
  }
  const prefix = dept === "it" ? "IT" : "TX";
  const ticketNo = `${prefix}-${new Date().getFullYear()}-${String(Date.now() % 100000).padStart(5, "0")}`;
  const canAssign = canManageOpsDept(dept, req.userRole);
  const [row] = await db
    .insert(opsTicketsTable)
    .values({
      ticketNo,
      dept,
      category: String(req.body?.category || (dept === "it" ? "other" : "other_repair")),
      title,
      description: req.body?.description ? String(req.body.description) : null,
      branchName: req.body?.branchName ? String(req.body.branchName) : null,
      priority: String(req.body?.priority || "normal"),
      status: "new",
      createdById: req.userId ?? null,
      assigneeId: canAssign && req.body?.assigneeId ? Number(req.body.assigneeId) : null,
    })
    .returning();
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

  /** Ariza egasi — bajarilgan ishni tasdiqlaydi */
  if (action === "verify") {
    if (!isCreator && !canManage) {
      res.status(403).json({ error: "Tasdiqlash faqat ariza egasi uchun" });
      return;
    }
    if (existing.status !== "done" && existing.status !== "verified") {
      res.status(400).json({ error: "Avval AyTi bajarilgan deb belgilashi kerak" });
      return;
    }
    const now = new Date();
    const [updated] = await db
      .update(opsTicketsTable)
      .set({
        status: "verified",
        verifiedAt: existing.verifiedAt || now,
        verifiedById: existing.verifiedById || req.userId || null,
        closedAt: existing.closedAt || now,
        updatedAt: now,
      })
      .where(eq(opsTicketsTable.id, id))
      .returning();
    res.json((await enrichTickets([updated]))[0]);
    return;
  }

  if (!canManage) {
    res.status(403).json({ error: "Holatni AyTi xodimi o‘zgartiradi" });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const now = new Date();

  if (action === "accept") {
    updates.status = "accepted";
    if (!existing.acceptedAt) {
      updates.acceptedAt = now;
      updates.acceptedById = req.userId ?? null;
    }
    if (req.body.assigneeId !== undefined) {
      updates.assigneeId = req.body.assigneeId ? Number(req.body.assigneeId) : req.userId ?? null;
    } else if (!existing.assigneeId) {
      updates.assigneeId = req.userId ?? null;
    }
  } else if (action === "complete") {
    updates.status = "done";
    if (!existing.acceptedAt) {
      updates.acceptedAt = now;
      updates.acceptedById = req.userId ?? null;
    }
    if (!existing.completedAt) {
      updates.completedAt = now;
      updates.completedById = req.userId ?? null;
    }
  } else {
    if (req.body.status) {
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
      if (nextStatus === "done" || nextStatus === "closed" || nextStatus === "verified") {
        updates.closedAt = nextStatus === "done" ? existing.closedAt : existing.closedAt || now;
      }
    }
    if (req.body.assigneeId !== undefined) {
      updates.assigneeId = req.body.assigneeId ? Number(req.body.assigneeId) : null;
      if (req.body.assigneeId && existing.status === "new" && !req.body.status) {
        updates.status = "accepted";
        if (!existing.acceptedAt) {
          updates.acceptedAt = now;
          updates.acceptedById = req.userId ?? null;
        }
      }
    }
    if (req.body.priority) updates.priority = String(req.body.priority);
  }

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
  if (!canViewAllOpsTickets(dept, req.userRole)) {
    if (!req.userId) {
      res.json({ total: 0, open: 0, urgent: 0, byStatus: {}, byCat: {} });
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
    open: rows.filter((r) => r.status !== "closed" && r.status !== "verified" && r.status !== "done").length,
    urgent: rows.filter((r) => r.priority === "urgent" && r.status !== "closed" && r.status !== "verified").length,
    awaitingVerify: rows.filter((r) => r.status === "done").length,
    byStatus,
    byCat,
  });
});

export default router;
