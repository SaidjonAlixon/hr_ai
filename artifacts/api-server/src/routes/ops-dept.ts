import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, opsTicketsTable, usersTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import {
  IT_CATEGORIES,
  TEXNIK_CATEGORIES,
  TICKET_STATUS,
  canManageOpsDept,
  canViewOpsDept,
} from "../lib/ops-dept";

const router: IRouter = Router();

function parseDept(raw: unknown): "it" | "texnik" | null {
  return raw === "it" || raw === "texnik" ? raw : null;
}

router.get("/ops-tickets/meta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const dept = parseDept(req.query.dept);
  if (!dept || !canViewOpsDept(dept, req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const roles = dept === "it" ? ["it", "it_rahbar"] : ["texnik", "texnik_rahbar"];
  const staff = await db
    .select({ id: usersTable.id, fullName: usersTable.fullName, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.status, "active"));
  res.json({
    dept,
    categories: dept === "it" ? IT_CATEGORIES : TEXNIK_CATEGORIES,
    statuses: TICKET_STATUS,
    staff: staff.filter((s) => roles.includes(s.role)),
    canManage: canManageOpsDept(dept, req.userRole),
  });
});

router.get("/ops-tickets", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const dept = parseDept(req.query.dept);
  if (!dept || !canViewOpsDept(dept, req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const cond = [eq(opsTicketsTable.dept, dept)];
  if (status) cond.push(eq(opsTicketsTable.status, status));
  const rows = await db.select().from(opsTicketsTable).where(and(...cond)).orderBy(desc(opsTicketsTable.createdAt)).limit(400);
  res.json(rows);
});

router.post("/ops-tickets", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const dept = parseDept(req.body?.dept);
  if (!dept || !canViewOpsDept(dept, req.userRole)) {
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
  const [row] = await db
    .insert(opsTicketsTable)
    .values({
      ticketNo,
      dept,
      category: String(req.body?.category || "other_repair"),
      title,
      description: req.body?.description ? String(req.body.description) : null,
      branchName: req.body?.branchName ? String(req.body.branchName) : null,
      priority: String(req.body?.priority || "normal"),
      status: "new",
      createdById: req.userId ?? null,
      assigneeId: req.body?.assigneeId ? Number(req.body.assigneeId) : null,
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/ops-tickets/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const [existing] = await db.select().from(opsTicketsTable).where(eq(opsTicketsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  const dept = existing.dept as "it" | "texnik";
  if (!canManageOpsDept(dept, req.userRole) && req.userRole !== "admin") {
    res.status(403).json({ error: "Holatni bo‘lim xodimi o‘zgartiradi" });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (req.body.status) {
    updates.status = String(req.body.status);
    if (req.body.status === "closed" || req.body.status === "done") updates.closedAt = new Date();
  }
  if (req.body.assigneeId !== undefined) updates.assigneeId = req.body.assigneeId ? Number(req.body.assigneeId) : null;
  if (req.body.priority) updates.priority = String(req.body.priority);
  const [updated] = await db.update(opsTicketsTable).set(updates).where(eq(opsTicketsTable.id, id)).returning();
  res.json(updated);
});

router.get("/ops-tickets/dashboard", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const dept = parseDept(req.query.dept);
  if (!dept || !canViewOpsDept(dept, req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const rows = await db.select().from(opsTicketsTable).where(eq(opsTicketsTable.dept, dept));
  const byStatus: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byCat[r.category] = (byCat[r.category] || 0) + 1;
  }
  res.json({
    total: rows.length,
    open: rows.filter((r) => r.status !== "closed" && r.status !== "done").length,
    urgent: rows.filter((r) => r.priority === "urgent" && r.status !== "closed").length,
    byStatus,
    byCat,
  });
});

export default router;
