import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  departmentsTable,
  faceProfilesTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { setSessionCookie } from "../lib/session";

const router: IRouter = Router();

const DESCRIPTOR_LEN = 128;
const MATCH_MAX_DISTANCE = 0.48;

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

function parseDescriptor(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== DESCRIPTOR_LEN) return null;
  const out: number[] = [];
  for (const n of raw) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

router.get("/auth/face/status", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const [row] = await db
    .select({ id: faceProfilesTable.id, createdAt: faceProfilesTable.createdAt })
    .from(faceProfilesTable)
    .where(eq(faceProfilesTable.userId, userId))
    .limit(1);
  res.json({ registered: Boolean(row), count: row ? 1 : 0 });
});

router.post("/auth/face/enroll", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const descriptor = parseDescriptor(req.body?.descriptor);
  if (!descriptor) {
    res.status(400).json({ error: "Yuz aniq olinmadi — qayta urinib ko‘ring" });
    return;
  }

  const payload = {
    userId,
    descriptor: JSON.stringify(descriptor),
    updatedAt: new Date(),
  };
  const [existing] = await db
    .select({ id: faceProfilesTable.id })
    .from(faceProfilesTable)
    .where(eq(faceProfilesTable.userId, userId))
    .limit(1);
  if (existing) {
    await db
      .update(faceProfilesTable)
      .set(payload)
      .where(eq(faceProfilesTable.id, existing.id));
  } else {
    await db.insert(faceProfilesTable).values(payload);
  }
  res.json({ ok: true, registered: true });
});

router.post("/auth/face/login", async (req, res): Promise<void> => {
  const descriptor = parseDescriptor(req.body?.descriptor);
  if (!descriptor) {
    res.status(400).json({ error: "Yuz aniq olinmadi — kameraga qarab turing" });
    return;
  }

  const rows = await db
    .select({
      id: faceProfilesTable.id,
      userId: faceProfilesTable.userId,
      descriptor: faceProfilesTable.descriptor,
    })
    .from(faceProfilesTable);

  let best: { id: number; userId: number; dist: number } | null = null;
  let second = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    let stored: number[];
    try {
      stored = JSON.parse(row.descriptor) as number[];
    } catch {
      continue;
    }
    if (!Array.isArray(stored) || stored.length !== DESCRIPTOR_LEN) continue;
    const dist = euclidean(descriptor, stored);
    if (!best || dist < best.dist) {
      second = best?.dist ?? Number.POSITIVE_INFINITY;
      best = { id: row.id, userId: row.userId, dist };
    } else if (dist < second) {
      second = dist;
    }
  }

  if (!best || best.dist > MATCH_MAX_DISTANCE) {
    res.status(401).json({
      error: "Bu yuz aniqlanmadi. Ro‘yxatdan o‘ting — login/parol bilan kirib Face ID ni ulang.",
      code: "face_not_registered",
    });
    return;
  }
  if (second - best.dist < 0.06 && second <= MATCH_MAX_DISTANCE) {
    res.status(401).json({
      error: "Yuz aniq ajratilmadi — yorug‘likni tekshiring va qayta urinib ko‘ring",
      code: "face_ambiguous",
    });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, best.userId));
  if (!user || user.status !== "active") {
    res.status(403).json({
      error: user?.fullName
        ? `${user.fullName}: profil faol emas`
        : "Foydalanuvchi faol emas",
      code: "user_inactive",
      fullName: user?.fullName ?? undefined,
    });
    return;
  }

  await db
    .update(faceProfilesTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(faceProfilesTable.id, best.id));

  setSessionCookie(res, user.id);
  const fullUser = await getUserWithDept(user.id);
  const fullName = fullUser?.fullName ?? user.fullName;
  res.json({
    user: fullUser,
    fullName,
    message: fullName,
  });
});

router.delete("/auth/face", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  await db.delete(faceProfilesTable).where(eq(faceProfilesTable.userId, userId));
  res.json({ ok: true });
});

export default router;
