import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  employeesTable,
  departmentJobTitlesTable,
  departmentsTable,
  departmentSitesTable,
  employeeScheduleOverridesTable,
  staffCommentsTable,
} from "@workspace/db";
import { archiveAndDeleteUser } from "../lib/dismiss-user";
import { buildStaffAttendanceDays } from "../lib/employee-attendance-report";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { formatPersonName } from "../lib/person-name";
import { ensureEmployeeForNewUser } from "../lib/user-employee-sync";
import { notifyUser } from "../lib/notify";
import {
  DISTRIBYUTSIYA_DEPARTMENT_NAME,
  ensureDistribyutsiyaSetup,
  listDistribyutsiyaJobTitles,
} from "../lib/distribyutsiya-department";
import { canManageSettings, hasFullPlatformAccess } from "../lib/roles";
import {
  canManageTamojni,
  ensureTamojniSkladDepartmentId,
  getTamojniSite,
  isTamojniOrDistribRole,
  normalizeDavomatSite,
  resolveDistribDavomatSite,
  syncTamojniEmployeesWithSite,
  tamojniCreatableRoles,
  TAMOJNI_DEFAULT_RADIUS_M,
  TAMOJNI_HEAD_ROLE,
  TAMOJNI_SKLAD_DEPARTMENT_NAME,
  TAMOJNI_STAFF_ROLE,
} from "../lib/tamojni-sklad";
import { normalizeHm, pickScheduleOverride, type ScheduleOverride } from "../lib/employee-schedule-override";
import { ymdInTashkent } from "../lib/shift-hours";
import { newCredWorkbook, paintCredSheet, sendWorkbook } from "../lib/cred-excel";
import { ROLE_LABEL_UZ } from "../lib/dept-staff";

const router: IRouter = Router();

const DISTRIB_MANAGE_ROLES = new Set([
  "admin",
  "director",
  "asoschi",
  "distrib_rahbar",
  "distrib_hr",
]);

/** Menyu / sahifa — faqat Distribyutsiya HR va rahbar (+ platform admin manage) */
const DISTRIB_VIEW_ROLES = new Set(["distrib_rahbar", "distrib_hr", "tamojni_rahbar"]);

function canManageDistrib(role?: string | null): boolean {
  return !!role && (DISTRIB_MANAGE_ROLES.has(role) || canManageSettings(role));
}

function canViewDistrib(role?: string | null): boolean {
  return !!role && (DISTRIB_VIEW_ROLES.has(role) || canManageDistrib(role));
}

/** Davomat joyini (Asosiy ofis / Tamojni sklad) faqat Distribyutsiya HR va Admin o‘zgartiradi */
const DAVOMAT_SITE_EDIT_ROLES = new Set(["admin", "director", "asoschi", "distrib_hr"]);

function canChangeDavomatSite(role?: string | null): boolean {
  return !!role && (DAVOMAT_SITE_EDIT_ROLES.has(role) || hasFullPlatformAccess(role));
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
  const permanent = req.query.permanent === "1";
  if (permanent) {
    if (!hasFullPlatformAccess(req.userRole)) {
      res.status(403).json({ error: "Lavozimni faqat admin o‘chiradi" });
      return;
    }
    const [removed] = await db
      .delete(departmentJobTitlesTable)
      .where(
        and(
          eq(departmentJobTitlesTable.id, id),
          eq(departmentJobTitlesTable.departmentId, departmentId),
        ),
      )
      .returning({ id: departmentJobTitlesTable.id, title: departmentJobTitlesTable.title });
    if (!removed) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json({ ok: true, deleted: true, title: removed });
    return;
  }
  /** HR: o‘chirish o‘rniga nofaol — ro‘yxatda qoladi */
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
        davomatSite: employeesTable.davomatSite,
        location: employeesTable.location,
        orgRole: employeesTable.orgRole,
        employeeDepartmentId: employeesTable.departmentId,
        employmentStatus: employeesTable.employmentStatus,
      })
      .from(usersTable)
      .leftJoin(employeesTable, eq(employeesTable.userId, usersTable.id))
      .where(eq(usersTable.departmentId, departmentId))
      .orderBy(asc(usersTable.fullName));

    const userIds = rows.map((r) => r.userId);
    const commentStats = new Map<number, { count: number; lastText: string; lastAt: Date; lastAuthor: string | null }>();
    if (userIds.length) {
      const comments = await db
        .select({
          userId: staffCommentsTable.userId,
          text: staffCommentsTable.text,
          createdAt: staffCommentsTable.createdAt,
          authorName: staffCommentsTable.authorName,
        })
        .from(staffCommentsTable)
        .where(inArray(staffCommentsTable.userId, userIds))
        .orderBy(desc(staffCommentsTable.createdAt));
      for (const c of comments) {
        const s = commentStats.get(c.userId);
        if (s) s.count += 1;
        else commentStats.set(c.userId, { count: 1, lastText: c.text, lastAt: c.createdAt, lastAuthor: c.authorName });
      }
    }

    res.json({
      departmentId,
      departmentName: DISTRIBYUTSIYA_DEPARTMENT_NAME,
      canChangeSite: canChangeDavomatSite(req.userRole),
      canManageStaff: canManageDistrib(req.userRole),
      myUserId: req.userId ?? null,
      staff: rows.map(({ location, orgRole, employeeDepartmentId, ...r }) => ({
        ...r,
        commentCount: commentStats.get(r.userId)?.count ?? 0,
        lastComment: commentStats.get(r.userId)
          ? {
              text: commentStats.get(r.userId)!.lastText,
              createdAt: commentStats.get(r.userId)!.lastAt,
              authorName: commentStats.get(r.userId)!.lastAuthor,
            }
          : null,
        davomatSite:
          resolveDistribDavomatSite({
            davomatSite: r.davomatSite,
            userRole: r.role,
            orgRole,
            departmentId: employeeDepartmentId,
            departmentName: location,
            location,
          }) ?? "office",
      })),
    });
  } catch (err) {
    console.error("GET /distribyutsiya/staff error:", err);
    res.status(500).json({ error: "Yuklanmadi" });
  }
});

/** Xodim davomat joyi: Asosiy ofis yoki Tamojni sklad (GPS shu joydan olinadi) */
router.patch(
  "/distribyutsiya/staff/:userId/davomat-site",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (!canChangeDavomatSite(req.userRole)) {
      res.status(403).json({ error: "Davomat joyini faqat Distribyutsiya HR va Admin o‘zgartiradi" });
      return;
    }
    const userId = Number(req.params.userId);
    const site = normalizeDavomatSite(req.body?.site);
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ error: "Xodim noto‘g‘ri" });
      return;
    }
    if (!site) {
      res.status(400).json({ error: "Asosiy ofis yoki Tamojni skladni tanlang" });
      return;
    }
    try {
      const [user] = await db
        .select({
          id: usersTable.id,
          fullName: usersTable.fullName,
          role: usersTable.role,
          departmentId: usersTable.departmentId,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      if (!user) {
        res.status(404).json({ error: "Xodim topilmadi" });
        return;
      }
      const distribDeptId = await ensureDistribyutsiyaSetup();
      const tamojniDeptId = await ensureTamojniSkladDepartmentId();
      const member =
        user.departmentId === distribDeptId ||
        user.departmentId === tamojniDeptId ||
        isTamojniOrDistribRole(user.role);
      if (!member) {
        res.status(400).json({ error: "Faqat Distribyutsiya va Tamojni sklad xodimlarining joyi o‘zgartiriladi" });
        return;
      }

      const tamojniSite = site === "tamojni" ? await getTamojniSite() : null;
      if (site === "tamojni" && !tamojniSite) {
        res.status(400).json({
          error: "Avval «Tamojni sklad» bo‘limida sklad lokatsiyasini kiriting, keyin xodimni biriktiring.",
        });
        return;
      }

      const [emp] = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(eq(employeesTable.userId, user.id))
        .limit(1);
      if (!emp) {
        await ensureEmployeeForNewUser({
          id: user.id,
          fullName: user.fullName,
          role: user.role,
          departmentId: user.departmentId,
        });
      }

      const label = site === "tamojni" ? tamojniSite!.name || TAMOJNI_SKLAD_DEPARTMENT_NAME : "Asosiy ofis";
      await db
        .update(employeesTable)
        .set({
          davomatSite: site,
          location: label,
          latitude: site === "tamojni" ? tamojniSite!.latitude : null,
          longitude: site === "tamojni" ? tamojniSite!.longitude : null,
          assignedBranchId: null,
          updatedAt: new Date(),
        })
        .where(eq(employeesTable.userId, user.id));

      await notifyUser({
        userId: user.id,
        text: `Davomat joyingiz o‘zgardi: ${label}. Endi Keldim / Ketdim faqat shu joy hududidan qabul qilinadi.`,
        type: "davomat_site",
        linkUrl: "/davomat-face",
      }).catch(() => undefined);

      res.json({ ok: true, userId: user.id, davomatSite: site, label });
    } catch (err) {
      console.error("PATCH /distribyutsiya/staff/:userId/davomat-site error:", err);
      res.status(500).json({ error: "Davomat joyi saqlanmadi" });
    }
  },
);

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

/** Distribyutsiya bo‘limidagi xodimni topadi; boshqa bo‘lim xodimi bo‘lsa — null */
async function findDistribMember(userId: number) {
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const departmentId = await ensureDistribyutsiyaSetup();
  const [row] = await db
    .select({
      userId: usersTable.id,
      fullName: usersTable.fullName,
      role: usersTable.role,
      departmentId: usersTable.departmentId,
      employeeId: employeesTable.id,
    })
    .from(usersTable)
    .leftJoin(employeesTable, eq(employeesTable.userId, usersTable.id))
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!row || row.departmentId !== departmentId) return null;
  return { ...row, distribDepartmentId: departmentId };
}

/** Distribyutsiya HR rahbarni o‘zgartira/o‘chira olmaydi; hech kim o‘zini o‘chirmaydi */
function staffActionDenied(req: AuthRequest, target: { userId: number; role: string }): string | null {
  if (target.userId === req.userId) return "O‘zingizga bu amalni qila olmaysiz";
  if (req.userRole === "distrib_hr" && target.role === "distrib_rahbar") {
    return "Distribyutsiya rahbarini faqat Admin yoki direktor o‘zgartiradi";
  }
  return null;
}

async function actorName(userId?: number): Promise<string | null> {
  if (!userId) return null;
  const [u] = await db.select({ fullName: usersTable.fullName }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.fullName ?? null;
}

const DISTRIB_STATUS_LABEL: Record<string, string> = {
  working: "Ishlayapti",
  on_leave: "Ta’tilda",
  dismissed: "Bo‘shatildi",
};

/** Holat: ishlayapti / ta’tilda / bo‘shatildi (bo‘shatilsa — Bo‘shatilganlar arxiviga, login bekor) */
router.patch("/distribyutsiya/staff/:userId/status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDistrib(req.userRole)) {
    res.status(403).json({ error: "Holatni Distribyutsiya HR yoki rahbari o‘zgartiradi" });
    return;
  }
  const status = String(req.body?.status || "").trim();
  if (!DISTRIB_STATUS_LABEL[status]) {
    res.status(400).json({ error: "Holatni tanlang" });
    return;
  }
  const reason = String(req.body?.reason || "").trim().slice(0, 500);
  if (status === "dismissed" && reason.length < 3) {
    res.status(400).json({ error: "Bo‘shatish sababini yozing" });
    return;
  }
  try {
    const target = await findDistribMember(Number(req.params.userId));
    if (!target) {
      res.status(404).json({ error: "Distribyutsiya xodimi topilmadi" });
      return;
    }
    const denied = staffActionDenied(req, target);
    if (denied) {
      res.status(403).json({ error: denied });
      return;
    }

    if (status === "dismissed") {
      const ok = await archiveAndDeleteUser(target.userId, { actorId: req.userId ?? null, reason });
      if (!ok) {
        res.status(404).json({ error: "Topilmadi" });
        return;
      }
      res.json({ ok: true, removed: true, message: `${target.fullName} bo‘shatildi va Bo‘shatilganlar arxiviga o‘tkazildi` });
      return;
    }

    if (!target.employeeId) {
      await ensureEmployeeForNewUser({
        id: target.userId,
        fullName: target.fullName,
        role: target.role,
        departmentId: target.distribDepartmentId,
      });
    }
    await db
      .update(employeesTable)
      .set({ employmentStatus: status, updatedAt: new Date() })
      .where(eq(employeesTable.userId, target.userId));
    await db
      .update(usersTable)
      .set({ status: status === "on_leave" ? "on_leave" : "active" })
      .where(eq(usersTable.id, target.userId));

    const author = await actorName(req.userId);
    await db.insert(staffCommentsTable).values({
      userId: target.userId,
      employeeId: target.employeeId ?? null,
      departmentId: target.distribDepartmentId,
      kind: "note",
      relatedDate: ymdInTashkent(new Date()),
      text: `Holat o‘zgardi: ${DISTRIB_STATUS_LABEL[status]}${reason ? `. ${reason}` : ""}`,
      authorId: req.userId ?? null,
      authorName: author,
    });
    await notifyUser({
      userId: target.userId,
      text: `Holatingiz o‘zgartirildi: ${DISTRIB_STATUS_LABEL[status]}${reason ? ` (${reason})` : ""}`,
      type: "staff_status",
      linkUrl: "/dashboard",
    }).catch(() => undefined);

    res.json({ ok: true, removed: false, status, message: `Holat: ${DISTRIB_STATUS_LABEL[status]}` });
  } catch (err) {
    console.error("PATCH /distribyutsiya/staff/:userId/status error:", err);
    res.status(500).json({ error: "Holat saqlanmadi" });
  }
});

/** Xodimni o‘chirish — login, sessiya, yuz/barmoq izi o‘chadi; yozuv Bo‘shatilganlar arxivida qoladi */
router.delete("/distribyutsiya/staff/:userId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDistrib(req.userRole)) {
    res.status(403).json({ error: "Xodimni Distribyutsiya HR yoki rahbari o‘chiradi" });
    return;
  }
  const reason = String((req.query as { reason?: string }).reason || req.body?.reason || "").trim().slice(0, 500);
  if (reason.length < 3) {
    res.status(400).json({ error: "O‘chirish sababini yozing" });
    return;
  }
  try {
    const target = await findDistribMember(Number(req.params.userId));
    if (!target) {
      res.status(404).json({ error: "Distribyutsiya xodimi topilmadi" });
      return;
    }
    const denied = staffActionDenied(req, target);
    if (denied) {
      res.status(403).json({ error: denied });
      return;
    }
    const ok = await archiveAndDeleteUser(target.userId, { actorId: req.userId ?? null, reason });
    if (!ok) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json({ ok: true, message: `${target.fullName} o‘chirildi` });
  } catch (err) {
    console.error("DELETE /distribyutsiya/staff/:userId error:", err);
    res.status(500).json({ error: "O‘chirilmadi" });
  }
});

const COMMENT_KINDS = new Set(["note", "late", "early", "warning", "praise"]);
const COMMENT_KIND_LABEL: Record<string, string> = {
  note: "Izoh",
  late: "Kech kelish",
  early: "Erta ketish",
  warning: "Ogohlantirish",
  praise: "Rag‘bat",
};

router.get("/distribyutsiya/staff/:userId/comments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewDistrib(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(400).json({ error: "Xodim noto‘g‘ri" });
    return;
  }
  const items = await db
    .select()
    .from(staffCommentsTable)
    .where(eq(staffCommentsTable.userId, userId))
    .orderBy(desc(staffCommentsTable.createdAt))
    .limit(200);
  res.json({
    items: items.map((c) => ({ ...c, canDelete: c.authorId === req.userId || hasFullPlatformAccess(req.userRole) })),
  });
});

router.post("/distribyutsiya/staff/:userId/comments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDistrib(req.userRole)) {
    res.status(403).json({ error: "Izohni Distribyutsiya HR yoki rahbari yozadi" });
    return;
  }
  const text = String(req.body?.text || "").trim().slice(0, 2000);
  if (text.length < 2) {
    res.status(400).json({ error: "Izoh matnini yozing" });
    return;
  }
  const kind = COMMENT_KINDS.has(String(req.body?.kind)) ? String(req.body.kind) : "note";
  const relatedRaw = String(req.body?.relatedDate || "").slice(0, 10);
  const relatedDate = /^\d{4}-\d{2}-\d{2}$/.test(relatedRaw) ? relatedRaw : ymdInTashkent(new Date());
  try {
    const target = await findDistribMember(Number(req.params.userId));
    if (!target) {
      res.status(404).json({ error: "Distribyutsiya xodimi topilmadi" });
      return;
    }
    const author = await actorName(req.userId);
    const [row] = await db
      .insert(staffCommentsTable)
      .values({
        userId: target.userId,
        employeeId: target.employeeId ?? null,
        departmentId: target.distribDepartmentId,
        kind,
        relatedDate,
        text,
        authorId: req.userId ?? null,
        authorName: author,
      })
      .returning();
    if (req.body?.notify) {
      await notifyUser({
        userId: target.userId,
        text: `HR izohi (${COMMENT_KIND_LABEL[kind]}, ${relatedDate.split("-").reverse().join(".")}): ${text}`,
        type: "staff_comment",
        linkUrl: "/dashboard",
      }).catch(() => undefined);
    }
    res.status(201).json({ ok: true, comment: row });
  } catch (err) {
    console.error("POST /distribyutsiya/staff/:userId/comments error:", err);
    res.status(500).json({ error: "Izoh saqlanmadi" });
  }
});

router.delete("/distribyutsiya/comments/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageDistrib(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const id = Number(req.params.id);
  const [row] = await db.select().from(staffCommentsTable).where(eq(staffCommentsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Izoh topilmadi" });
    return;
  }
  if (row.authorId !== req.userId && !hasFullPlatformAccess(req.userRole)) {
    res.status(403).json({ error: "Faqat o‘z izohingizni o‘chirasiz" });
    return;
  }
  await db.delete(staffCommentsTable).where(eq(staffCommentsTable.id, id));
  res.json({ ok: true });
});

/** Kunlik kech kelish / erta ketish / kelmaganlar — Distribyutsiya HR uchun */
router.get("/distribyutsiya/attendance", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canViewDistrib(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const today = ymdInTashkent(new Date());
  const nowHm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const isYmd = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  let from = isYmd(req.query.from) ? String(req.query.from) : today;
  let to = isYmd(req.query.to) ? String(req.query.to) : from;
  if (to > today) to = today;
  if (from > to) from = to;
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 31) {
    res.status(400).json({ error: "Oraliq 31 kundan oshmasin" });
    return;
  }
  try {
    const departmentId = await ensureDistribyutsiyaSetup();
    const staff = await db
      .select({
        userId: usersTable.id,
        fullName: usersTable.fullName,
        role: usersTable.role,
        employeeId: employeesTable.id,
        position: employeesTable.position,
      })
      .from(usersTable)
      .innerJoin(employeesTable, eq(employeesTable.userId, usersTable.id))
      .where(eq(usersTable.departmentId, departmentId));
    const byEmp = new Map(staff.map((s) => [s.employeeId, s]));
    const daysByEmp = await buildStaffAttendanceDays({ employeeIds: staff.map((s) => s.employeeId), from, to });

    const comments = await db
      .select()
      .from(staffCommentsTable)
      .where(
        and(
          eq(staffCommentsTable.departmentId, departmentId),
          gte(staffCommentsTable.relatedDate, from),
          lte(staffCommentsTable.relatedDate, to),
        ),
      )
      .orderBy(asc(staffCommentsTable.createdAt));
    const commentsByKey = new Map<string, typeof comments>();
    for (const c of comments) {
      const key = `${c.userId}|${c.relatedDate}`;
      const list = commentsByKey.get(key) || [];
      list.push(c);
      commentsByKey.set(key, list);
    }

    type Incident = {
      key: string;
      date: string;
      type: "late" | "early" | "absent" | "incomplete";
      userId: number;
      fullName: string;
      position: string | null;
      minutes: number;
      checkIn: string | null;
      checkOut: string | null;
      planStart: string | null;
      planEnd: string | null;
      excused: boolean;
      excuseNote: string | null;
      comments: Array<{ id: number; kind: string; text: string; authorName: string | null; createdAt: Date }>;
    };
    const incidents: Incident[] = [];
    const summary = new Map<number, { userId: number; fullName: string; position: string | null; late: number; lateMinutes: number; early: number; earlyMinutes: number; absent: number }>();

    for (const { employeeId, days } of daysByEmp) {
      const s = byEmp.get(employeeId);
      if (!s) continue;
      const sum = summary.get(s.userId) || {
        userId: s.userId,
        fullName: s.fullName,
        position: s.position,
        late: 0,
        lateMinutes: 0,
        early: 0,
        earlyMinutes: 0,
        absent: 0,
      };
      for (const d of days) {
        const base = {
          date: d.date,
          userId: s.userId,
          fullName: s.fullName,
          position: s.position,
          checkIn: d.checkIn,
          checkOut: d.checkOut,
          planStart: d.planStart ?? null,
          planEnd: d.planEnd ?? null,
          excused: Boolean(d.excused),
          excuseNote: d.excuseNote ?? null,
          comments: (commentsByKey.get(`${s.userId}|${d.date}`) || []).map((c) => ({
            id: c.id,
            kind: c.kind,
            text: c.text,
            authorName: c.authorName,
            createdAt: c.createdAt,
          })),
        };
        if (d.status === "late") {
          sum.late += 1;
          sum.lateMinutes += d.lateMinutes || 0;
          incidents.push({ ...base, key: `${s.userId}|${d.date}|late`, type: "late", minutes: d.lateMinutes || 0 });
        }
        if ((d.earlyMinutes || 0) > 0) {
          sum.early += 1;
          sum.earlyMinutes += d.earlyMinutes || 0;
          incidents.push({ ...base, key: `${s.userId}|${d.date}|early`, type: "early", minutes: d.earlyMinutes || 0 });
        }
        const notStartedYet = d.date === today && !!d.planStart && nowHm < d.planStart;
        if (d.status === "absent" && !notStartedYet) {
          sum.absent += 1;
          incidents.push({ ...base, key: `${s.userId}|${d.date}|absent`, type: "absent", minutes: 0 });
        }
        if (d.status === "incomplete" && d.date < today) {
          incidents.push({ ...base, key: `${s.userId}|${d.date}|incomplete`, type: "incomplete", minutes: 0 });
        }
      }
      summary.set(s.userId, sum);
    }

    incidents.sort((a, b) => (a.date === b.date ? b.minutes - a.minutes : b.date.localeCompare(a.date)));
    res.json({
      from,
      to,
      today,
      staffCount: staff.length,
      canComment: canManageDistrib(req.userRole),
      counts: {
        late: incidents.filter((i) => i.type === "late").length,
        early: incidents.filter((i) => i.type === "early").length,
        absent: incidents.filter((i) => i.type === "absent").length,
        incomplete: incidents.filter((i) => i.type === "incomplete").length,
      },
      incidents,
      summary: [...summary.values()]
        .filter((s) => s.late || s.early || s.absent)
        .sort((a, b) => b.late + b.early - (a.late + a.early) || b.lateMinutes - a.lateMinutes),
    });
  } catch (err) {
    console.error("GET /distribyutsiya/attendance error:", err);
    res.status(500).json({ error: "Davomat yuklanmadi" });
  }
});

const TAMOJNI_SHIFT_PRESETS: Record<string, { startHm: string; endHm: string; label: string }> = {
  office: { startHm: "09:00", endHm: "18:00", label: "Kunduzgi (09:00-18:00)" },
  one: { startHm: "08:00", endHm: "17:00", label: "1-smena" },
  two: { startHm: "17:00", endHm: "23:45", label: "2-smena" },
  three: { startHm: "23:00", endHm: "07:00", label: "3-smena" },
};

function parseCoord(value: unknown): number | null {
  const n = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

router.get("/distribyutsiya/tamojni", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (
    !canManageTamojni(req.userRole) &&
    req.userRole !== "tamojni_rahbar" &&
    req.userRole !== "distrib_rahbar" &&
    req.userRole !== "distrib_hr"
  ) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  try {
    const departmentId = await ensureTamojniSkladDepartmentId();
    const site = await getTamojniSite();
    await syncTamojniEmployeesWithSite(site);
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
        shiftType: employeesTable.shiftType,
        shiftLabel: employeesTable.shiftLabel,
        davomatSiteRaw: employeesTable.davomatSite,
      })
      .from(usersTable)
      .leftJoin(employeesTable, eq(employeesTable.userId, usersTable.id))
      .where(eq(usersTable.departmentId, departmentId))
      .orderBy(asc(usersTable.fullName));

    const employeeIds = rows.map((r) => r.employeeId).filter((id): id is number => !!id);
    const rules = new Map<number, ScheduleOverride[]>();
    if (employeeIds.length) {
      const overrides = await db
        .select()
        .from(employeeScheduleOverridesTable)
        .where(
          and(
            eq(employeeScheduleOverridesTable.active, true),
            inArray(employeeScheduleOverridesTable.employeeId, employeeIds),
          ),
        );
      for (const row of overrides) {
        if (!employeeIds.includes(row.employeeId)) continue;
        const key = row.shiftKey;
        if (key !== "office" && key !== "one" && key !== "two" && key !== "three") continue;
        const list = rules.get(row.employeeId) || [];
        list.push({
          id: row.id,
          employeeId: row.employeeId,
          mode: row.mode === "period" ? "period" : "permanent",
          validFrom: row.validFrom,
          validTo: row.validTo,
          shiftKey: key,
          startHm: row.startHm,
          endHm: row.endHm,
          note: row.note,
        });
        rules.set(row.employeeId, list);
      }
    }
    const today = ymdInTashkent(new Date());
    res.json({
      departmentId,
      departmentName: TAMOJNI_SKLAD_DEPARTMENT_NAME,
      canManage: canManageTamojni(req.userRole),
      canChangeSite: canChangeDavomatSite(req.userRole),
      creatableRoles: tamojniCreatableRoles(req.userRole),
      site,
      staff: rows.map(({ davomatSiteRaw, ...r }) => {
        const active = r.employeeId ? pickScheduleOverride(rules.get(r.employeeId) || [], today) : null;
        const preset = active ? TAMOJNI_SHIFT_PRESETS[active.shiftKey] : TAMOJNI_SHIFT_PRESETS.office;
        return {
          ...r,
          davomatSite: normalizeDavomatSite(davomatSiteRaw) ?? "tamojni",
          shiftKey: active?.shiftKey || "office",
          startHm: active?.startHm || preset?.startHm || "09:00",
          endHm: active?.endHm || preset?.endHm || "18:00",
          shiftTitle: active
            ? `${TAMOJNI_SHIFT_PRESETS[active.shiftKey]?.label || active.shiftKey} · ${active.startHm}–${active.endHm}`
            : (r.shiftLabel && !r.shiftLabel.toLowerCase().includes("ofis")
                ? r.shiftLabel
                : "Kunduzgi · 09:00–18:00"),
        };
      }),
    });
  } catch (err) {
    console.error("GET /distribyutsiya/tamojni error:", err);
    res.status(500).json({ error: "Yuklanmadi" });
  }
});

router.put("/distribyutsiya/tamojni/site", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (
    !canManageTamojni(req.userRole) &&
    req.userRole !== "tamojni_rahbar" &&
    req.userRole !== "distrib_rahbar" &&
    req.userRole !== "distrib_hr"
  ) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }
  const name = String(req.body?.name || "").trim();
  const latitude = parseCoord(req.body?.latitude);
  const longitude = parseCoord(req.body?.longitude);
  const radiusM = Math.max(TAMOJNI_DEFAULT_RADIUS_M, Number(req.body?.radiusM) || TAMOJNI_DEFAULT_RADIUS_M);
  if (name.length < 2) {
    res.status(400).json({ error: "Joy nomini kiriting" });
    return;
  }
  if (latitude == null || longitude == null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    res.status(400).json({ error: "Koordinatani Google Mapsdan nusxa qiling: 41.311081, 69.279737" });
    return;
  }
  try {
    const departmentId = await ensureTamojniSkladDepartmentId();
    const [existing] = await db
      .select({ id: departmentSitesTable.id })
      .from(departmentSitesTable)
      .where(eq(departmentSitesTable.departmentId, departmentId))
      .limit(1);
    if (existing) {
      await db
        .update(departmentSitesTable)
        .set({
          name,
          latitude,
          longitude,
          radiusM,
          updatedById: req.userId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(departmentSitesTable.id, existing.id));
    } else {
      await db.insert(departmentSitesTable).values({
        departmentId,
        name,
        latitude,
        longitude,
        radiusM,
        updatedById: req.userId ?? null,
      });
    }
    const updatedSite = await getTamojniSite();
    await syncTamojniEmployeesWithSite(updatedSite);
    res.json({ ok: true, site: updatedSite });
  } catch (err) {
    console.error("PUT /distribyutsiya/tamojni/site error:", err);
    res.status(500).json({ error: "Joy saqlanmadi" });
  }
});

router.post("/distribyutsiya/tamojni/staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageTamojni(req.userRole) || tamojniCreatableRoles(req.userRole).length === 0) {
    res.status(403).json({ error: "Xodimni HR yoki Distribyutsiya rahbari qo‘shadi" });
    return;
  }
  const firstName = String(req.body?.firstName || "").trim();
  const lastName = String(req.body?.lastName || "").trim();
  const phone = req.body?.phone ? String(req.body.phone).trim() : null;
  const staffRole = String(req.body?.role || TAMOJNI_STAFF_ROLE).trim();
  const positionInput = String(req.body?.position || "").trim();
  if (!tamojniCreatableRoles(req.userRole).includes(staffRole)) {
    res.status(400).json({ error: "Bu rolni qo‘shishga ruxsat yo‘q" });
    return;
  }
  if (!firstName || !lastName) {
    res.status(400).json({ error: "Ism va familiya kiriting" });
    return;
  }
  const position =
    positionInput ||
    (staffRole === TAMOJNI_HEAD_ROLE ? "Tamojni sklad bo‘lim boshlig‘i" : "Tamojni sklad xodimi");

  try {
    const departmentId = await ensureTamojniSkladDepartmentId();
    const fullName = formatPersonName(`${lastName} ${firstName}`);
    const generatedPassword = randomPassword(8);
    const finalLogin = await uniqueLogin(staffRole, fullName);
    const [user] = await db
      .insert(usersTable)
      .values({
        fullName,
        role: staffRole,
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

    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, user.id))
      .limit(1);

    if (emp) {
      let reportsToId: number | null = null;
      if (staffRole === TAMOJNI_STAFF_ROLE) {
        const [dept] = await db
          .select({ headId: departmentsTable.headId })
          .from(departmentsTable)
          .where(eq(departmentsTable.id, departmentId))
          .limit(1);
        if (dept?.headId) {
          const [headEmp] = await db
            .select({ id: employeesTable.id })
            .from(employeesTable)
            .where(eq(employeesTable.userId, dept.headId))
            .limit(1);
          reportsToId = headEmp?.id ?? null;
        }
      }
      const site = await getTamojniSite();
      await db
        .update(employeesTable)
        .set({
          departmentId,
          position,
          shiftType: "office",
          shiftLabel: "Ofis · 09:00–18:00",
          reportsToId,
          location: site?.name || TAMOJNI_SKLAD_DEPARTMENT_NAME,
          latitude: site?.latitude ?? null,
          longitude: site?.longitude ?? null,
          assignedBranchId: null,
          updatedAt: new Date(),
        })
        .where(eq(employeesTable.id, emp.id));
    }

    if (staffRole === TAMOJNI_HEAD_ROLE) {
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
      message: "Tamojni sklad xodimi qo‘shildi",
    });
  } catch (err) {
    console.error("POST /distribyutsiya/tamojni/staff error:", err);
    res.status(500).json({ error: "Qo‘shilmadi" });
  }
});

router.post("/distribyutsiya/tamojni/shift", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageTamojni(req.userRole)) {
    res.status(403).json({ error: "Smenani HR yoki bo‘lim boshlig‘i o‘zgartiradi" });
    return;
  }
  const employeeId = Number(req.body?.employeeId);
  const shiftKey = String(req.body?.shiftKey || "office").trim();
  const preset = TAMOJNI_SHIFT_PRESETS[shiftKey];
  if (!Number.isFinite(employeeId) || employeeId <= 0 || !preset) {
    res.status(400).json({ error: "Xodim va smena tanlanmagan" });
    return;
  }
  const startHm = normalizeHm(String(req.body?.startHm || preset.startHm));
  const endHm = normalizeHm(String(req.body?.endHm || preset.endHm));
  if (!startHm || !endHm || startHm === endHm) {
    res.status(400).json({ error: "Kelish va ketish vaqti HH:MM bo‘lsin" });
    return;
  }
  try {
    const departmentId = await ensureTamojniSkladDepartmentId();
    const [emp] = await db
      .select({
        id: employeesTable.id,
        departmentId: employeesTable.departmentId,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(eq(employeesTable.id, employeeId))
      .limit(1);
    if (!emp || emp.departmentId !== departmentId) {
      res.status(404).json({ error: "Tamojni sklad xodimi topilmadi" });
      return;
    }
    if (emp.userId) {
      const [user] = await db
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, emp.userId))
        .limit(1);
      if (user && user.role !== TAMOJNI_STAFF_ROLE && user.role !== TAMOJNI_HEAD_ROLE) {
        res.status(400).json({ error: "Bu xodim Tamojni skladga tegishli emas" });
        return;
      }
    }
    await db
      .update(employeeScheduleOverridesTable)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(employeeScheduleOverridesTable.employeeId, employeeId),
          eq(employeeScheduleOverridesTable.active, true),
        ),
      );
    const label = `${preset.label} · ${startHm}–${endHm}`;
    await db.insert(employeeScheduleOverridesTable).values({
      employeeId,
      mode: "permanent",
      validFrom: ymdInTashkent(new Date()),
      validTo: null,
      shiftKey,
      startHm,
      endHm,
      note: "Tamojni sklad smenasi",
      active: true,
      createdById: req.userId ?? null,
    });
    await db
      .update(employeesTable)
      .set({ shiftType: shiftKey, shiftLabel: label, updatedAt: new Date() })
      .where(eq(employeesTable.id, employeeId));
    res.json({ ok: true, employeeId, shiftKey, startHm, endHm, shiftTitle: label });
  } catch (err) {
    console.error("POST /distribyutsiya/tamojni/shift error:", err);
    res.status(500).json({ error: "Smena saqlanmadi" });
  }
});

export default router;
