import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, departmentsTable } from "@workspace/db";
import { setSessionCookie, clearSessionCookie } from "../lib/session";

const router: IRouter = Router();

async function getUserWithDept(userId: number) {
  const [user] = await db
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
    .where(eq(usersTable.id, userId));
  return user ?? null;
}

function isDbDown(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === "ETIMEDOUT" ||
    e.code === "ECONNREFUSED" ||
    e.code === "ENOTFOUND" ||
    e.code === "57P01" ||
    /timeout|ECONNRESET|Connection terminated/i.test(String(e.message || ""))
  );
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const { login, password } = req.body ?? {};
  if (!login || !password) {
    res.status(400).json({ error: "Login va parol kerak" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.login, login as string));

    if (!user || user.password !== password) {
      res.status(401).json({ error: "Login yoki parol noto'g'ri" });
      return;
    }

    if (user.status !== "active") {
      res.status(403).json({ error: "Foydalanuvchi faol emas" });
      return;
    }

    setSessionCookie(res, user.id);

    const fullUser = await getUserWithDept(user.id);
    req.log?.info?.({ userId: user.id, role: user.role }, "User logged in");
    res.json({ user: fullUser });
  } catch (err) {
    console.error("auth/login error:", err);
    if (!process.env.DATABASE_URL) {
      res.status(503).json({
        error: "DATABASE_URL sozlanmagan — Vercel Environment Variables tekshiring",
      });
      return;
    }
    res.status(503).json({
      error: isDbDown(err)
        ? "Baza bilan aloqa yo‘q — birozdan keyin qayta urinib ko‘ring"
        : "Server xatosi — qayta urinib ko‘ring",
    });
  }
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const sessionCookie = req.cookies?.session;
  if (!sessionCookie) {
    res.status(204).end();
    return;
  }

  try {
    const decoded = JSON.parse(Buffer.from(sessionCookie, "base64").toString());
    const user = await getUserWithDept(decoded.userId);
    if (!user) {
      res.status(401).json({ error: "Foydalanuvchi topilmadi" });
      return;
    }
    res.json(user);
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(401).json({ error: "Noto'g'ri sessiya" });
      return;
    }
    console.error("auth/me error:", err);
    res.status(503).json({
      error: isDbDown(err)
        ? "Baza bilan aloqa yo‘q — birozdan keyin qayta urinib ko‘ring"
        : "Server xatosi — qayta urinib ko‘ring",
    });
  }
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
