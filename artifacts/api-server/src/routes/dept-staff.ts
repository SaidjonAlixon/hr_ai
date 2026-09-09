import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, employeesTable, usersTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";
import { formatPersonName } from "../lib/person-name";
import { ensureEmployeeForNewUser } from "../lib/user-employee-sync";
import { newCredWorkbook, paintCredSheet, sendWorkbook } from "../lib/cred-excel";
import {
  ROLE_LABEL_UZ,
  assertCanCreateDeptStaff,
  canAddDeptStaff,
  isDeptHeadRole,
  resolveDeptHeadContext,
} from "../lib/dept-staff";

const router: IRouter = Router();

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

router.get("/dept-staff/meta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole ?? "";
  const userId = req.userId;
  // Bo‘lim boshlig‘i (view-only ham) — o‘z bo‘limi meta
  if (!userId || (!canAddDeptStaff(role) && !isDeptHeadRole(role))) {
    res.json({ canAdd: false, departmentId: null, departmentName: null, roles: [] });
    return;
  }
  const ctx = await resolveDeptHeadContext(userId, role);
  if (!ctx) {
    res.json({ canAdd: false, departmentId: null, departmentName: null, roles: [] });
    return;
  }
  res.json({
    canAdd: canAddDeptStaff(role) && ctx.creatableRoles.length > 0,
    departmentId: ctx.departmentId,
    departmentName: ctx.departmentName,
    roles: ctx.creatableRoles.map((value) => ({
      value,
      label: ROLE_LABEL_UZ[value] || value,
    })),
  });
});

/** Bo‘lim boshlig‘i — o‘z bo‘limi xodimlari login/parol Excel */
router.get("/dept-staff/export", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const role = req.userRole ?? "";
  const userId = req.userId;
  if (!userId || !canAddDeptStaff(role)) {
    res.status(403).json({ error: "Ruxsat yo‘q — faqat bo‘lim boshlig‘i" });
    return;
  }
  const ctx = await resolveDeptHeadContext(userId, role);
  if (!ctx?.departmentId) {
    res.status(403).json({ error: "Bo‘lim topilmadi — profilingizda bo‘lim biriktirilganini tekshiring" });
    return;
  }

  try {
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
      .where(eq(usersTable.departmentId, ctx.departmentId))
      .orderBy(asc(usersTable.fullName));

    // Bir user → bir qator (bir nechta employee bo‘lsa)
    const seen = new Set<string>();
    const unique = rows.filter((r) => {
      const key = `${r.login || r.fullName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const workbook = newCredWorkbook();
    paintCredSheet(workbook, {
      name: "Xodimlar",
      title: `VAKSINA MED — ${ctx.departmentName} · login/parol · ${unique.length} ta`,
      headers: ["F.I.Sh.", "Lavozim", "Rol", "Login", "Parol", "Telefon", "Holat"],
      widths: [32, 22, 20, 24, 14, 16, 12],
      rows: unique.map((r) => [
        r.fullName || "—",
        r.position || "—",
        ROLE_LABEL_UZ[r.role] || r.role || "—",
        r.login || "—",
        r.password || "—",
        r.phone || "—",
        r.status === "active" ? "Faol" : r.status || "—",
      ]),
      monoCols: [4, 5],
    });

    const stamp = new Date().toISOString().slice(0, 10);
    await sendWorkbook(res, workbook, `bolim-login-${stamp}.xlsx`);
  } catch (err) {
    console.error("GET /dept-staff/export error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Excel yuklanmadi",
    });
  }
});

router.post("/dept-staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const actorRole = req.userRole ?? "";
  const actorId = req.userId;
  if (!actorId) {
    res.status(401).json({ error: "Avtorizatsiya talab etiladi" });
    return;
  }
  if (!canAddDeptStaff(actorRole)) {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }

  const { firstName, lastName, phone, role, position } = req.body ?? {};
  const fn = String(firstName || "").trim();
  const ln = String(lastName || "").trim();
  const phoneVal = String(phone || "").trim();
  const staffRole = String(role || "").trim();
  const jobTitle = String(position || "").trim();

  if (!fn || !ln) {
    res.status(400).json({ error: "Ism va familiya majburiy" });
    return;
  }
  if (!phoneVal) {
    res.status(400).json({ error: "Telefon raqam majburiy" });
    return;
  }
  if (!staffRole) {
    res.status(400).json({ error: "Rolni tanlang" });
    return;
  }
  if (!jobTitle) {
    res.status(400).json({ error: "Lavozimni yozing" });
    return;
  }

  const scope = await assertCanCreateDeptStaff(actorId, actorRole, staffRole);
  if ("error" in scope) {
    res.status(scope.status).json({ error: scope.error });
    return;
  }

  const fullName = formatPersonName(`${fn} ${ln}`);
  const generatedPassword = randomPassword(8);
  const finalLogin = await uniqueLogin(staffRole, fullName);

  try {
    const [user] = await db
      .insert(usersTable)
      .values({
        fullName,
        role: staffRole,
        departmentId: scope.departmentId,
        login: finalLogin,
        password: generatedPassword,
        phone: phoneVal,
        status: "active",
      })
      .returning();

    await ensureEmployeeForNewUser({
      id: user.id,
      fullName: user.fullName,
      role: user.role,
      departmentId: user.departmentId,
      position: jobTitle,
    });

    res.status(201).json({
      id: user.id,
      fullName: user.fullName,
      role: user.role,
      position: jobTitle,
      login: user.login,
      phone: user.phone,
      departmentName: scope.departmentName,
      temporaryPassword: generatedPassword,
      message: `«${fullName}» ${scope.departmentName} bo‘limiga qo‘shildi`,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      res.status(400).json({ error: "Bu login band" });
      return;
    }
    console.error("POST /dept-staff error:", err);
    res.status(503).json({ error: "Xodim qo‘shilmadi" });
  }
});

export default router;
