import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, departmentsTable } from "@workspace/db";
import { logger } from "../lib/logger";

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

router.post("/auth/login", async (req, res): Promise<void> => {
  const { login, password } = req.body ?? {};
  if (!login || !password) {
    res.status(400).json({ error: "Login va parol kerak" });
    return;
  }

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

  const token = Buffer.from(JSON.stringify({ userId: user.id })).toString("base64");
  const isProd =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true";

  res.cookie("session", token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    signed: false,
    sameSite: "lax",
    secure: isProd,
    path: "/",
  });

  const fullUser = await getUserWithDept(user.id);
  req.log.info({ userId: user.id, role: user.role }, "User logged in");
  res.json({ user: fullUser });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const sessionCookie = req.cookies?.session;
  if (!sessionCookie) {
    res.status(401).json({ error: "Avtorizatsiya talab etiladi" });
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
  } catch {
    res.status(401).json({ error: "Noto'g'ri sessiya" });
  }
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const isProd =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true";
  res.clearCookie("session", { path: "/", sameSite: "lax", secure: isProd });
  res.json({ ok: true });
});

export default router;
