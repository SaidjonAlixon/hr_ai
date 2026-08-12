import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, employeesTable, departmentsTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const STAFF_ROLES = ["mudir", "farmasevt", "stajyor"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

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

async function defaultDepartmentId(): Promise<number> {
  const [row] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .limit(1);
  if (!row) throw new Error("Bo'lim topilmadi — avval bo'lim yarating");
  return row.id;
}

async function ensureCoordinatorEmployee(userId: number, fullName: string) {
  const [existing] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId));

  if (existing) {
    if (existing.orgRole !== "coordinator") {
      const [updated] = await db
        .update(employeesTable)
        .set({ orgRole: "coordinator" })
        .where(eq(employeesTable.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  const departmentId = await defaultDepartmentId();
  const [created] = await db
    .insert(employeesTable)
    .values({
      fullName,
      position: "Koordinator",
      departmentId,
      hiredAt: new Date().toISOString().slice(0, 10),
      orgRole: "coordinator",
      userId,
      employmentStatus: "working",
      shiftType: "one",
    })
    .returning();
  return created;
}

/**
 * POST /api/pharmacy-network/staff
 * Koordinator → mudir; Mudir → farmasevt | stajyor
 * Avtomatik login/parol yaratadi.
 */
router.post("/pharmacy-network/staff", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const actorRole = req.userRole ?? "";
  const actorId = req.userId;
  if (!actorId) {
    res.status(401).json({ error: "Avtorizatsiya talab etiladi" });
    return;
  }

  const { firstName, lastName, phone, role, location } = req.body ?? {};
  const fn = String(firstName || "").trim();
  const ln = String(lastName || "").trim();
  const phoneVal = String(phone || "").trim();
  const staffRole = String(role || "").trim() as StaffRole;

  if (!fn || !ln) {
    res.status(400).json({ error: "Ism va familiya majburiy" });
    return;
  }
  if (!phoneVal) {
    res.status(400).json({ error: "Telefon raqam majburiy" });
    return;
  }
  if (!STAFF_ROLES.includes(staffRole)) {
    res.status(400).json({ error: "Rol: mudir, farmasevt yoki stajyor" });
    return;
  }

  if (actorRole === "koordinator") {
    if (staffRole !== "mudir") {
      res.status(403).json({ error: "Koordinator faqat mudir qo‘sha oladi" });
      return;
    }
  } else if (actorRole === "mudir") {
    if (staffRole !== "farmasevt" && staffRole !== "stajyor") {
      res.status(403).json({ error: "Mudir faqat farmasevt yoki stajyor qo‘sha oladi" });
      return;
    }
  } else if (
    actorRole === "admin" ||
    actorRole === "hr" ||
    actorRole === "hr_menejer" ||
    actorRole === "hr_direktor"
  ) {
    // HR/admin ham xuddi shu rollarni yaratishi mumkin
  } else {
    res.status(403).json({ error: "Ruxsat yo‘q" });
    return;
  }

  const fullName = `${fn} ${ln}`.replace(/\s+/g, " ").trim();
  const [actor] = await db
    .select({ fullName: usersTable.fullName, departmentId: usersTable.departmentId })
    .from(usersTable)
    .where(eq(usersTable.id, actorId));

  let reportsToId: number | null = null;
  let orgRole: string;
  let position: string;
  let branchLocation: string | null = location?.trim() || null;

  if (staffRole === "mudir") {
    orgRole = "manager";
    position = "Filial mudiri";
    if (actorRole === "koordinator") {
      const coord = await ensureCoordinatorEmployee(
        actorId,
        actor?.fullName || "Koordinator",
      );
      reportsToId = coord.id;
    } else {
      const [coord] = await db
        .select()
        .from(employeesTable)
        .where(eq(employeesTable.orgRole, "coordinator"))
        .limit(1);
      if (!coord) {
        res.status(400).json({
          error: "Avval tizimda koordinator xodimi bo‘lishi kerak",
        });
        return;
      }
      reportsToId = coord.id;
    }
    if (!branchLocation) branchLocation = "Filial";
  } else {
    const [myBranch] = await db
      .select()
      .from(employeesTable)
      .where(eq(employeesTable.userId, actorId));
    if (!myBranch || myBranch.orgRole !== "manager") {
      res.status(400).json({
        error: "Filial bog‘lanmagan — avval sizni mudir sifatida tarmoqqa ulang",
      });
      return;
    }
    reportsToId = myBranch.id;
    branchLocation = myBranch.location;
    if (staffRole === "stajyor") {
      orgRole = "intern";
      position = "Stajyor";
    } else {
      orgRole = "pharmacist";
      position = "Farmasevt";
    }
  }

  const generatedPassword = randomPassword(8);
  const finalLogin = await uniqueLogin(staffRole, fullName);
  const departmentId =
    actor?.departmentId ||
    (await defaultDepartmentId());

  try {
    const [user] = await db
      .insert(usersTable)
      .values({
        fullName,
        role: staffRole,
        departmentId,
        login: finalLogin,
        password: generatedPassword,
        phone: phoneVal,
        status: "active",
      })
      .returning();

    const [employee] = await db
      .insert(employeesTable)
      .values({
        fullName,
        position,
        departmentId,
        hiredAt: new Date().toISOString().slice(0, 10),
        orgRole,
        reportsToId,
        location: branchLocation,
        userId: user.id,
        employmentStatus: "working",
        shiftType: "one",
      })
      .returning();

    res.status(201).json({
      id: user.id,
      fullName: user.fullName,
      role: user.role,
      login: user.login,
      phone: user.phone,
      temporaryPassword: generatedPassword,
      employeeId: employee.id,
      orgRole: employee.orgRole,
      location: employee.location,
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(400).json({ error: "Bu login band — qayta urinib ko‘ring" });
      return;
    }
    throw err;
  }
});

export default router;
