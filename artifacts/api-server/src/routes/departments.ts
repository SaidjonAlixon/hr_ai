import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, departmentsTable, usersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/departments", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: departmentsTable.id,
      name: departmentsTable.name,
      headId: departmentsTable.headId,
      headName: usersTable.fullName,
      createdAt: departmentsTable.createdAt,
    })
    .from(departmentsTable)
    .leftJoin(usersTable, eq(departmentsTable.headId, usersTable.id))
    .orderBy(departmentsTable.name);
  res.json(rows);
});

router.post("/departments", async (req, res): Promise<void> => {
  const { name, headId } = req.body ?? {};
  if (!name) {
    res.status(400).json({ error: "Bo'lim nomi kerak" });
    return;
  }
  const [dept] = await db
    .insert(departmentsTable)
    .values({ name, headId: headId ?? null })
    .returning();
  res.status(201).json({ ...dept, headName: null });
});

router.get("/departments/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [row] = await db
    .select({
      id: departmentsTable.id,
      name: departmentsTable.name,
      headId: departmentsTable.headId,
      headName: usersTable.fullName,
      createdAt: departmentsTable.createdAt,
    })
    .from(departmentsTable)
    .leftJoin(usersTable, eq(departmentsTable.headId, usersTable.id))
    .where(eq(departmentsTable.id, id));
  if (!row) { res.status(404).json({ error: "Topilmadi" }); return; }
  res.json(row);
});

router.patch("/departments/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, headId } = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (headId !== undefined) updates.headId = headId;
  const [updated] = await db
    .update(departmentsTable)
    .set(updates)
    .where(eq(departmentsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Topilmadi" }); return; }
  res.json({ ...updated, headName: null });
});

router.delete("/departments/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(departmentsTable).where(eq(departmentsTable.id, id));
  res.sendStatus(204);
});

export default router;
