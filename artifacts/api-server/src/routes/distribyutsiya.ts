import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  employeesTable,
  departmentJobTitlesTable,
  departmentsTable,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { formatPersonName } from "../lib/person-name";
import { ensureEmployeeForNewUser } from "../lib/user-employee-sync";
import {
  DISTRIBYUTSIYA_DEPARTMENT_NAME,
  ensureDistribyutsiyaSetup,
  listDistribyutsiyaJobTitles,
} from "../lib/distribyutsiya-department";
import { canManageSettings } from "../lib/roles";
import { newCredWorkbook, paintCredSheet, sendWorkbook } from "../lib/cred-excel";
import { ROLE_LABEL_UZ } from "../lib/dept-staff";

const router: IRouter = Router();

const DISTRIB_MANAGE_ROLES = new Set([
  "admin",
  "director",
  "distrib_rahbar",
  "distrib_hr",
]);

const DISTRIB_VIEW_ROLES = new Set([
  ...DISTRIB_MANAGE_ROLES,
  "distrib",
  "hr",
  "hr_direktor",
  "hr_menejer",
  "hr_kadr_rahbar",
]);

function canManageDistrib(role?: string | null): boolean {
  return !!role && DISTRIB_MANAGE_ROLES.has(role);
}

function canViewDistrib(role?: string | null): boolean {
  return !!role && (DISTRIB_VIEW_ROLES.has(role) || canManageSettings(role));
}

function latinSlug(input: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
    ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
    ў: "o", қ: "q", ғ: "g", ҳ: "h",
  };
  let s = input.trim().toLowerCase();
  s = s.replace(/o['ʻ’`]/g, "o").replace(/g['ʻ’`]/g, "g");
  let out = "";
  for (const ch of s) out += map[ch] ?? ch;
  out = out.replace(/[^a-z0-9]+/g, "").slice(0, 14);
  return out || "user";
}

function randomPassword(len = 8): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pwd = "";
  for (let i = 0; i < len; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
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

router.get("/distribyutsiya/meta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewDistrib(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const departmentId = await ensureDistribyutsiyaSetup();
    const { titles } = await listDistribyutsiyaJobTitles({
      departmentId,
      includeInactive: canManageDistrib(req.userRole),
    });
    res.json({
      departmentId,
      departmentName: DISTRIBYUTSIYA_DEPARTMENT_NAME,
      canManage: canManageDistrib(req.userRole),
      canAddStaff: canManageDistrib(req.userRole),
      titles: titles.map((t) => ({
        id: t.id,
        title: t.title,
        sortOrder: t.sortOrder,
        active: t.active,
      })),
    });
  } catch (err) {
    console.error("GET /distribyutsiya/meta error:", err);
    res.status(500).json({ error: "Yuklanmadi" });
  }
});

router.get("/distribyutsiya/job-titles", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewDistrib(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const departmentId = await ensureDistribyutsiyaSetup();
    const { titles } = await listDistribyutsiyaJobTitles({
      departmentId,
      includeInactive: true,
    });
    res.json({ departmentId, titles });
  } catch (err) {
    console.error("GET /distribyutsiya/job-titles error:", err);
    res.status(500).json({ error: "Yuklanmadi" });
  }
});

router.post("/distribyutsiya/job-titles", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDistrib(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const title = String(req.body?.title || "").trim();
  if (!title || title.length < 2) {
    res.status(400).json({ error: "Lavozim nomi kiriting" });
    return;
  }
  try {
    const departmentId = await ensureDistribyutsiyaSetup();
    const [maxRow] = await db
      .select({ m: sql<number>`coalesce(max(${departmentJobTitlesTable.sortOrder}), 0)` })
      .from(departmentJobTitlesTable)
      .where(eq(departmentJobTitlesTable.departmentId, departmentId));
    const [created] = await db
      .insert(departmentJobTitlesTable)
      .values({
        departmentId,
        title,
        sortOrder: Number(maxRow?.m || 0) + 1,
        active: true,
      })
      .returning();
    res.status(201).json({ title: created });
  } catch (err) {
    console.error("POST /distribyutsiya/job-titles error:", err);
    res.status(500).json({ error: "Saqlanmadi" });
  }
});

router.patch("/distribyutsiya/job-titles/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDistrib(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "id noto‘g‘ri" });
    return;
  }
  const departmentId = await ensureDistribyutsiyaSetup();
  const [existing] = await db
    .select()
    .from(departmentJobTitlesTable)
    .where(
      and(
        eq(departmentJobTitlesTable.id, id),
        eq(departmentJobTitlesTable.departmentId, departmentId),
      ),
    )
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }

  const updates: Partial<typeof departmentJobTitlesTable.$inferInsert> = {};
  if (typeof req.body?.title === "string" && req.body.title.trim()) {
    updates.title = req.body.title.trim();
  }
  if (typeof req.body?.active === "boolean") {
    updates.active = req.body.active;
  }
  if (req.body?.sortOrder != null && Number.isFinite(Number(req.body.sortOrder))) {
    updates.sortOrder = Number(req.body.sortOrder);
  }
  if (!Object.keys(updates).length) {
    res.status(400).json({ error: "O‘zgarish yo‘q" });
    return;
  }

  const [updated] = await db
    .update(departmentJobTitlesTable)
    .set(updates)
    .where(eq(departmentJobTitlesTable.id, id))
    .returning();
  res.json({ title: updated });
});

router.delete("/distribyutsiya/job-titles/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDistrib(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "id noto‘g‘ri" });
    return;
  }
  const departmentId = await ensureDistribyutsiyaSetup();
  /** O‘chirish o‘rniga nofaol — tarix saqlansin */
  const [updated] = await db
    .update(departmentJobTitlesTable)
    .set({ active: false })
    .where(
      and(
        eq(departmentJobTitlesTable.id, id),
        eq(departmentJobTitlesTable.departmentId, departmentId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  res.json({ ok: true, title: updated });
});

router.get("/distribyutsiya/staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewDistrib(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const departmentId = await ensureDistribyutsiyaSetup();
    const rows = await db
      .select({
        userId: usersTable.id,
        fullName: usersTable.fullName,
        role: usersTable.role,
        login: usersTable.login,
        phone: usersTable.phone,
        status: usersTable.status,
        employeeId: employeesTable.id,
        position: employeesTable.position,
        hiredAt: employeesTable.hiredAt,
      })
      .from(usersTable)
      .leftJoin(employeesTable, eq(employeesTable.userId, usersTable.id))
      .where(eq(usersTable.departmentId, departmentId))
      .orderBy(asc(usersTable.fullName));

    res.json({
      departmentId,
      departmentName: DISTRIBYUTSIYA_DEPARTMENT_NAME,
      staff: rows,
    });
  } catch (err) {
    console.error("GET /distribyutsiya/staff error:", err);
    res.status(500).json({ error: "Yuklanmadi" });
  }
});

/** Distribyutsiya HR / rahbar — xodimlar login/parol Excel */
router.get("/distribyutsiya/staff/export", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDistrib(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const departmentId = await ensureDistribyutsiyaSetup();
    const rows = await db
      .select({
        fullName: usersTable.fullName,
        role: usersTable.role,
        login: usersTable.login,
        password: usersTable.password,
        phone: usersTable.phone,
        status: usersTable.status,
        position: employeesTable.position,
      })
      .from(usersTable)
      .leftJoin(employeesTable, eq(employeesTable.userId, usersTable.id))
      .where(eq(usersTable.departmentId, departmentId))
      .orderBy(asc(usersTable.fullName));

    const workbook = newCredWorkbook();
    paintCredSheet(workbook, {
      name: "Xodimlar",
      title: `VAKSINA MED — Distribyutsiya · login/parol · ${rows.length} ta`,
      headers: ["F.I.Sh.", "Lavozim", "Rol", "Login", "Parol", "Telefon", "Holat"],
      widths: [32, 22, 22, 24, 14, 16, 12],
      rows: rows.map((r) => [
        r.fullName,
        r.position || "—",
        ROLE_LABEL_UZ[r.role] || r.role,
        r.login || "—",
        r.password || "—",
        r.phone || "—",
        r.status === "active" ? "Faol" : r.status || "—",
      ]),
      monoCols: [4, 5],
    });

    const stamp = new Date().toISOString().slice(0, 10);
    await sendWorkbook(res, workbook, `distribyutsiya-login-${stamp}.xlsx`);
  } catch (err) {
    console.error("GET /distribyutsiya/staff/export error:", err);
    res.status(500).json({ error: "Excel yuklanmadi" });
  }
});

/** Distribyutsiya xodimi qo‘shish — lavozim katalogidan */
router.post("/distribyutsiya/staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDistrib(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }

  const firstName = String(req.body?.firstName || "").trim();
  const lastName = String(req.body?.lastName || "").trim();
  const phone = req.body?.phone ? String(req.body.phone).trim() : null;
  const jobTitleId = req.body?.jobTitleId != null ? Number(req.body.jobTitleId) : null;
  const staffRoleRaw = String(req.body?.role || "distrib").trim();
  const allowedStaffRoles = new Set(["distrib", "distrib_hr", "distrib_rahbar"]);
  if (!allowedStaffRoles.has(staffRoleRaw)) {
    res.status(400).json({ error: "Noto‘g‘ri rol" });
    return;
  }
  /** Oddiy xodim uchun lavozim majburiy; rahbar/HR uchun ixtiyoriy */
  if (!firstName || !lastName) {
    res.status(400).json({ error: "Ism va familiya kiriting" });
    return;
  }

  try {
    const departmentId = await ensureDistribyutsiyaSetup();
    let position = "Distribyutsiya xodimi";

    if (jobTitleId) {
      const [jt] = await db
        .select()
        .from(departmentJobTitlesTable)
        .where(
          and(
            eq(departmentJobTitlesTable.id, jobTitleId),
            eq(departmentJobTitlesTable.departmentId, departmentId),
            eq(departmentJobTitlesTable.active, true),
          ),
        )
        .limit(1);
      if (!jt) {
        res.status(400).json({ error: "Lavozim topilmadi" });
        return;
      }
      position = jt.title;
    } else if (staffRoleRaw === "distrib") {
      res.status(400).json({ error: "Lavozimni tanlang" });
      return;
    } else if (staffRoleRaw === "distrib_rahbar") {
      position = "Distribyutsiya rahbari";
    } else if (staffRoleRaw === "distrib_hr") {
      position = "Distribyutsiya HR";
    }

    const fullName = formatPersonName(`${lastName} ${firstName}`);
    const generatedPassword = randomPassword(8);
    const finalLogin = await uniqueLogin(staffRoleRaw, fullName);

    const [user] = await db
      .insert(usersTable)
      .values({
        fullName,
        role: staffRoleRaw,
        departmentId,
        login: finalLogin,
        password: generatedPassword,
        phone,
        status: "active",
      })
      .returning();

    await ensureEmployeeForNewUser({
      id: user.id,
      fullName: user.fullName,
      role: user.role,
      departmentId,
      position,
    });

    if (staffRoleRaw === "distrib_rahbar") {
      await db
        .update(departmentsTable)
        .set({ headId: user.id })
        .where(eq(departmentsTable.id, departmentId));
    }

    res.status(201).json({
      ok: true,
      userId: user.id,
      fullName: user.fullName,
      role: user.role,
      position,
      login: finalLogin,
      temporaryPassword: generatedPassword,
      message: "Distribyutsiya xodimi qo‘shildi",
    });
  } catch (err) {
    console.error("POST /distribyutsiya/staff error:", err);
    res.status(500).json({ error: "Qo‘shilmadi" });
  }
});

export default router;
