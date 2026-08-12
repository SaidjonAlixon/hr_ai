import { Router, type IRouter } from "express";
import { eq, and, ilike } from "drizzle-orm";
import { db, usersTable, departmentsTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const ALLOWED_ROLES = [
  "admin",
  "recruiter",
  "hr",
  "hr_direktor",
  "hr_auditor",
  "hr_menejer",
  "trainer",
  "mentor",
  "director",
  "department_head",
  "mudir",
  "koordinator",
  "texnik",
  "ombor",
  "farmasevt",
] as const;

function requireAdmin(req: AuthRequest, res: import("express").Response): boolean {
  if (req.userRole !== "admin") {
    res.status(403).json({ error: "Faqat admin foydalanuvchi yaratishi mumkin" });
    return false;
  }
  return true;
}

function latinSlug(input: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
    ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
    ў: "o", қ: "q", ғ: "g", ҳ: "h",
    "o'": "o", "g'": "g", "oʻ": "o", "gʻ": "g",
  };
  let s = input.trim().toLowerCase();
  s = s.replace(/o['ʻ’`]/g, "o").replace(/g['ʻ’`]/g, "g");
  let out = "";
  for (const ch of s) {
    out += map[ch] ?? ch;
  }
  out = out.replace(/[^a-z0-9]+/g, "").slice(0, 14);
  return out || "user";
}

function randomPassword(len = 8): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pwd = "";
  for (let i = 0; i < len; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  return pwd;
}

async function uniqueLogin(role: string, fullName: string): Promise<string> {
  const base = `${role}_${latinSlug(fullName)}`;
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.login, candidate));
    if (!existing) return candidate;
    candidate = `${base}${i + 2}`;
  }
  return `${base}_${Date.now().toString(36).slice(-4)}`;
}

function publicUser(row: {
  id: number;
  fullName: string;
  role: string;
  departmentId: number | null;
  login: string;
  phone: string | null;
  status: string;
  createdAt: Date;
}, departmentName: string | null = null) {
  return {
    id: row.id,
    fullName: row.fullName,
    role: row.role,
    departmentId: row.departmentId,
    departmentName,
    login: row.login,
    phone: row.phone,
    status: row.status,
    createdAt: row.createdAt,
  };
}

router.get("/users", async (req, res): Promise<void> => {
  const { role, departmentId, search } = req.query as Record<string, string>;

  const conditions = [];
  if (role) conditions.push(eq(usersTable.role, role));
  if (departmentId) conditions.push(eq(usersTable.departmentId, parseInt(departmentId, 10)));
  if (search) conditions.push(ilike(usersTable.fullName, `%${search}%`));

  const base = db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      departmentId: usersTable.departmentId,
      departmentName: departmentsTable.name,
      login: usersTable.login,
      phone: usersTable.phone,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id));

  const rows = conditions.length
    ? await base.where(and(...conditions))
    : await base;

  res.json(rows);
});

router.post("/users", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const { fullName, role, departmentId, login, password, phone, status } = req.body ?? {};
  if (!fullName?.trim() || !role) {
    res.status(400).json({ error: "Ism-familiya va rol majburiy" });
    return;
  }
  if (!ALLOWED_ROLES.includes(role)) {
    res.status(400).json({ error: "Noto'g'ri rol" });
    return;
  }

  const generatedPassword = password?.trim() || randomPassword(8);
  let finalLogin = login?.trim();
  if (!finalLogin) {
    finalLogin = await uniqueLogin(role, String(fullName));
  } else {
    const [dup] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.login, finalLogin));
    if (dup) {
      res.status(400).json({ error: "Bu login band" });
      return;
    }
  }

  try {
    const [user] = await db
      .insert(usersTable)
      .values({
        fullName: String(fullName).trim(),
        role,
        departmentId: departmentId ? parseInt(String(departmentId), 10) : null,
        login: finalLogin,
        password: generatedPassword,
        phone: phone ?? null,
        status: status ?? "active",
      })
      .returning();

    let departmentName: string | null = null;
    if (user.departmentId) {
      const [dept] = await db
        .select({ name: departmentsTable.name })
        .from(departmentsTable)
        .where(eq(departmentsTable.id, user.departmentId));
      departmentName = dept?.name ?? null;
    }

    res.status(201).json({
      ...publicUser(user, departmentName),
      temporaryPassword: generatedPassword,
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(400).json({ error: "Bu login band" });
      return;
    }
    throw err;
  }
});

router.get("/users/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [row] = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      departmentId: usersTable.departmentId,
      departmentName: departmentsTable.name,
      login: usersTable.login,
      phone: usersTable.phone,
      status: usersTable.status,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .leftJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
    .where(eq(usersTable.id, id));
  if (!row) { res.status(404).json({ error: "Topilmadi" }); return; }
  res.json(row);
});

router.patch("/users/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const allowed = ["fullName", "role", "departmentId", "phone", "status"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (updates.role && !ALLOWED_ROLES.includes(updates.role as typeof ALLOWED_ROLES[number])) {
    res.status(400).json({ error: "Noto'g'ri rol" });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Topilmadi" }); return; }
  res.json(publicUser(updated));
});

router.delete("/users/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (req.userId === id) {
    res.status(400).json({ error: "O'zingizni o'chira olmaysiz" });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.sendStatus(204);
});

export default router;
