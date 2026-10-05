import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  employeesTable,
  departmentJobTitlesTable,
  departmentsTable,
  departmentSitesTable,
  employeeScheduleOverridesTable,
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
import { canManageSettings, hasFullPlatformAccess } from "../lib/roles";
import {
  canManageTamojni,
  ensureTamojniSkladDepartmentId,
  getTamojniSite,
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

const TAMOJNI_SHIFT_PRESETS: Record<string, { startHm: string; endHm: string; label: string }> = {
  office: { startHm: "09:00", endHm: "18:00", label: "Ofis" },
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
      creatableRoles: tamojniCreatableRoles(req.userRole),
      site,
      staff: rows.map((r) => {
        const active = r.employeeId ? pickScheduleOverride(rules.get(r.employeeId) || [], today) : null;
        const preset = active ? TAMOJNI_SHIFT_PRESETS[active.shiftKey] : TAMOJNI_SHIFT_PRESETS.office;
        return {
          ...r,
          shiftKey: active?.shiftKey || "office",
          startHm: active?.startHm || preset?.startHm || "09:00",
          endHm: active?.endHm || preset?.endHm || "18:00",
          shiftTitle: active
            ? `${TAMOJNI_SHIFT_PRESETS[active.shiftKey]?.label || active.shiftKey} · ${active.startHm}–${active.endHm}`
            : r.shiftLabel || "Ofis · 09:00–18:00",
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
    res.json({ ok: true, site: await getTamojniSite() });
  } catch (err) {
    console.error("PUT /distribyutsiya/tamojni/site error:", err);
    res.status(500).json({ error: "Joy saqlanmadi" });
  }
});

router.post("/distribyutsiya/tamojni/staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canManageTamojni(req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
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
      await db
        .update(employeesTable)
        .set({
          departmentId,
          position,
          shiftType: "office",
          shiftLabel: "Ofis · 09:00–18:00",
          reportsToId,
          location: TAMOJNI_SKLAD_DEPARTMENT_NAME,
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
