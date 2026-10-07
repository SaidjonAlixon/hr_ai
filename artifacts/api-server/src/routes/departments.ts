import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, departmentJobTitlesTable, departmentsTable, pool, usersTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { isHrManager, isDirectorRole } from "../lib/roles";
import { dedupeDepartmentsByName } from "../lib/role-departments";

const router: IRouter = Router();

function canManageDepartments(role?: string) {
  return isHrManager(role) || isDirectorRole(role);
}

/** Har yangi bo‘limga avtomatik ochiladigan lavozimlar */
export const DEFAULT_DEPARTMENT_TITLES = ["Bo‘lim boshlig‘i", "Bo‘lim xodimi"] as const;

const normTitle = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[ʻʼ'`´’]/g, "‘")
    .toLocaleLowerCase("uz");

function cleanTitle(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

async function departmentTitles(departmentId: number) {
  return db
    .select()
    .from(departmentJobTitlesTable)
    .where(eq(departmentJobTitlesTable.departmentId, departmentId))
    .orderBy(asc(departmentJobTitlesTable.sortOrder), asc(departmentJobTitlesTable.id));
}

/** Lavozim qo‘shish: bir xil nom bo‘lsa yangisi ochilmaydi, nofaol bo‘lsa qayta yoqiladi */
async function addDepartmentTitle(departmentId: number, title: string) {
  const existing = await departmentTitles(departmentId);
  const hit = existing.find((t) => normTitle(t.title) === normTitle(title));
  if (hit) {
    if (hit.active) return { title: hit, created: false, reactivated: false };
    const [updated] = await db
      .update(departmentJobTitlesTable)
      .set({ active: true })
      .where(eq(departmentJobTitlesTable.id, hit.id))
      .returning();
    return { title: updated ?? hit, created: false, reactivated: true };
  }
  const nextOrder = existing.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1;
  const [created] = await db
    .insert(departmentJobTitlesTable)
    .values({ departmentId, title, sortOrder: nextOrder, active: true })
    .returning();
  return { title: created!, created: true, reactivated: false };
}

async function seedDefaultTitles(departmentId: number) {
  const out = [];
  for (const title of DEFAULT_DEPARTMENT_TITLES) out.push((await addDepartmentTitle(departmentId, title)).title);
  return out;
}

/** Lavozim bo‘yicha xodimlar soni (bo‘shatilganlarsiz) */
async function titleStaffCounts(): Promise<{ byTitle: Map<string, number>; byDept: Map<number, number> }> {
  const { rows } = await pool.query(
    `SELECT department_id, position, count(*)::int AS n
       FROM employees
      WHERE coalesce(employment_status, 'working') NOT IN ('dismissed', 'closed', 'need_hire', 'searching', 'no_manager')
      GROUP BY department_id, position`,
  );
  const byTitle = new Map<string, number>();
  const byDept = new Map<number, number>();
  for (const r of rows) {
    const dept = Number(r.department_id);
    const n = Number(r.n) || 0;
    byDept.set(dept, (byDept.get(dept) ?? 0) + n);
    const key = `${dept}|${normTitle(String(r.position || ""))}`;
    byTitle.set(key, (byTitle.get(key) ?? 0) + n);
  }
  return { byTitle, byDept };
}

async function titlesPayload(departmentId?: number) {
  const rows = departmentId
    ? await departmentTitles(departmentId)
    : await db
        .select()
        .from(departmentJobTitlesTable)
        .orderBy(asc(departmentJobTitlesTable.departmentId), asc(departmentJobTitlesTable.sortOrder), asc(departmentJobTitlesTable.id));
  const { byTitle, byDept } = await titleStaffCounts();
  return {
    titles: rows.map((t) => ({
      id: t.id,
      departmentId: t.departmentId,
      title: t.title,
      sortOrder: t.sortOrder,
      active: t.active,
      staffCount: byTitle.get(`${t.departmentId}|${normTitle(t.title)}`) ?? 0,
      createdAt: t.createdAt.toISOString(),
    })),
    staffByDepartment: Object.fromEntries(byDept),
  };
}

async function getDepartmentFull(id: number) {
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
  return row ?? null;
}

router.get("/departments", requireAuth, async (_req, res): Promise<void> => {
  try {
    await dedupeDepartmentsByName();
  } catch (err) {
    console.error("departments dedupe:", err);
  }
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
  res.json(
    rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

router.post("/departments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDepartments(req.userRole)) {
    res.status(403).json({ error: "Faqat HR / admin / direktor bo‘lim qo‘sha oladi" });
    return;
  }
  const { name, headId } = req.body ?? {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: "Bo'lim nomi kerak" });
    return;
  }
  const trimmed = String(name).trim().replace(/\s+/g, " ");
  const [dup] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(sql`lower(trim(name)) = ${trimmed.toLocaleLowerCase("uz")}`)
    .limit(1);
  if (dup) {
    res.status(409).json({ error: `«${trimmed}» bo‘limi allaqachon bor` });
    return;
  }
  const hid =
    headId === null || headId === undefined || headId === ""
      ? null
      : parseInt(String(headId), 10);
  if (hid != null && !Number.isFinite(hid)) {
    res.status(400).json({ error: "Boshliq id noto‘g‘ri" });
    return;
  }

  const [dept] = await db
    .insert(departmentsTable)
    .values({ name: trimmed, headId: hid })
    .returning();
  let jobTitles: Array<{ id: number; title: string }> = [];
  try {
    jobTitles = (await seedDefaultTitles(dept.id)).map((t) => ({ id: t.id, title: t.title }));
  } catch (err) {
    console.error("departments seed titles:", err);
  }
  const full = await getDepartmentFull(dept.id);
  res.status(201).json({
    ...(full
      ? { ...full, createdAt: full.createdAt.toISOString() }
      : { ...dept, headName: null, createdAt: dept.createdAt.toISOString() }),
    jobTitles,
  });
});

/** Barcha bo‘limlar lavozimlari + xodimlar soni (Bo‘limlar sahifasi uchun) */
router.get("/department-job-titles", requireAuth, async (_req, res): Promise<void> => {
  try {
    res.json(await titlesPayload());
  } catch (err) {
    console.error("GET /department-job-titles", err);
    res.status(503).json({ error: "Lavozimlar yuklanmadi" });
  }
});

router.get("/departments/:id/job-titles", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "id noto‘g‘ri" });
    return;
  }
  try {
    res.json(await titlesPayload(id));
  } catch (err) {
    console.error("GET /departments/:id/job-titles", err);
    res.status(503).json({ error: "Lavozimlar yuklanmadi" });
  }
});

/** Bo‘limga lavozim qo‘shish (bitta yoki standart to‘plam: { defaults: true }) */
router.post("/departments/:id/job-titles", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDepartments(req.userRole)) {
    res.status(403).json({ error: "Lavozimni HR, admin yoki direktor qo‘shadi" });
    return;
  }
  const id = Number(req.params.id);
  const dept = Number.isFinite(id) ? await getDepartmentFull(id) : null;
  if (!dept) {
    res.status(404).json({ error: "Bo‘lim topilmadi" });
    return;
  }
  try {
    if (req.body?.defaults === true) {
      await seedDefaultTitles(id);
      res.status(201).json({ ok: true, ...(await titlesPayload(id)) });
      return;
    }
    const title = cleanTitle(req.body?.title);
    if (title.length < 2) {
      res.status(400).json({ error: "Lavozim nomini kiriting (kamida 2 harf)" });
      return;
    }
    const result = await addDepartmentTitle(id, title);
    if (!result.created && !result.reactivated) {
      res.status(409).json({ error: `«${result.title.title}» lavozimi bu bo‘limda allaqachon bor` });
      return;
    }
    res.status(201).json({ ok: true, title: result.title, reactivated: result.reactivated });
  } catch (err) {
    console.error("POST /departments/:id/job-titles", err);
    res.status(503).json({ error: "Lavozim saqlanmadi" });
  }
});

router.patch("/departments/:id/job-titles/:titleId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDepartments(req.userRole)) {
    res.status(403).json({ error: "Lavozimni HR, admin yoki direktor o‘zgartiradi" });
    return;
  }
  const id = Number(req.params.id);
  const titleId = Number(req.params.titleId);
  try {
    const list = await departmentTitles(id);
    const current = list.find((t) => t.id === titleId);
    if (!current) {
      res.status(404).json({ error: "Lavozim topilmadi" });
      return;
    }
    const updates: Partial<typeof departmentJobTitlesTable.$inferInsert> = {};
    if (req.body?.title !== undefined) {
      const title = cleanTitle(req.body.title);
      if (title.length < 2) {
        res.status(400).json({ error: "Lavozim nomini kiriting (kamida 2 harf)" });
        return;
      }
      if (list.some((t) => t.id !== titleId && normTitle(t.title) === normTitle(title))) {
        res.status(409).json({ error: `«${title}» lavozimi bu bo‘limda allaqachon bor` });
        return;
      }
      updates.title = title;
    }
    if (typeof req.body?.active === "boolean") updates.active = req.body.active;
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "O‘zgarish yo‘q" });
      return;
    }
    const [updated] = await db
      .update(departmentJobTitlesTable)
      .set(updates)
      .where(and(eq(departmentJobTitlesTable.id, titleId), eq(departmentJobTitlesTable.departmentId, id)))
      .returning();
    res.json({ ok: true, title: updated });
  } catch (err) {
    console.error("PATCH /departments/:id/job-titles/:titleId", err);
    res.status(503).json({ error: "Lavozim saqlanmadi" });
  }
});

/** Xodimi bor lavozim o‘chirilmaydi — nofaol qilinadi */
router.delete("/departments/:id/job-titles/:titleId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDepartments(req.userRole)) {
    res.status(403).json({ error: "Lavozimni HR, admin yoki direktor o‘chiradi" });
    return;
  }
  const id = Number(req.params.id);
  const titleId = Number(req.params.titleId);
  try {
    const list = await departmentTitles(id);
    const current = list.find((t) => t.id === titleId);
    if (!current) {
      res.status(404).json({ error: "Lavozim topilmadi" });
      return;
    }
    const { byTitle } = await titleStaffCounts();
    const staff = byTitle.get(`${id}|${normTitle(current.title)}`) ?? 0;
    if (staff > 0) {
      await db
        .update(departmentJobTitlesTable)
        .set({ active: false })
        .where(eq(departmentJobTitlesTable.id, titleId));
      res.json({ ok: true, deactivated: true, staff });
      return;
    }
    await db.delete(departmentJobTitlesTable).where(eq(departmentJobTitlesTable.id, titleId));
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error("DELETE /departments/:id/job-titles/:titleId", err);
    res.status(503).json({ error: "Lavozim o‘chirilmadi" });
  }
});

router.get("/departments/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const row = await getDepartmentFull(id);
  if (!row) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  res.json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.patch("/departments/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDepartments(req.userRole)) {
    res.status(403).json({ error: "Faqat HR / admin / direktor tahrirlashi mumkin" });
    return;
  }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, headId } = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (name !== undefined) {
    const n = String(name).trim();
    if (!n) {
      res.status(400).json({ error: "Bo'lim nomi bo‘sh bo‘lmasin" });
      return;
    }
    updates.name = n;
  }
  if (headId !== undefined) {
    updates.headId =
      headId === null || headId === "" ? null : parseInt(String(headId), 10);
  }
  if (!Object.keys(updates).length) {
    const existing = await getDepartmentFull(id);
    if (!existing) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json({ ...existing, createdAt: existing.createdAt.toISOString() });
    return;
  }

  const [updated] = await db
    .update(departmentsTable)
    .set(updates)
    .where(eq(departmentsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  const full = await getDepartmentFull(id);
  res.json(
    full
      ? { ...full, createdAt: full.createdAt.toISOString() }
      : { ...updated, headName: null, createdAt: updated.createdAt.toISOString() },
  );
});

router.delete("/departments/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDepartments(req.userRole)) {
    res.status(403).json({ error: "Faqat HR / admin / direktor o‘chira oladi" });
    return;
  }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [existing] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(eq(departmentsTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  try {
    await db.delete(departmentsTable).where(eq(departmentsTable.id, id));
    await db
      .delete(departmentJobTitlesTable)
      .where(eq(departmentJobTitlesTable.departmentId, id))
      .catch((err) => console.error("departments delete titles:", err));
    res.sendStatus(204);
  } catch {
    res.status(400).json({
      error: "Bo‘limni o‘chirib bo‘lmadi — unga bog‘langan yozuvlar bor",
    });
  }
});

export default router;
