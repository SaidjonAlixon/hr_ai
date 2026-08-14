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
import {
  findClosestFace,
  matchFaceForAuth,
  ownerNameOfUser,
  parseFaceDescriptor,
} from "../lib/face-match";

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

function parseDescriptor(raw: unknown): number[] | null {
  return parseFaceDescriptor(raw);
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

  const taken = await findClosestFace(descriptor, { excludeUserId: userId });
  if (taken) {
    const owner = await ownerNameOfUser(taken.userId);
    res.status(409).json({
      error: owner
        ? `Bu yuz allaqachon ${owner} ga biriktirilgan. Bitta yuzni faqat bitta xodim ishlatadi.`
        : "Bu yuz allaqachon boshqa xodimga biriktirilgan. Bitta yuzni faqat bitta xodim ishlatadi.",
      code: "face_already_taken",
      fullName: owner ?? undefined,
    });
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

  const matched = await matchFaceForAuth(descriptor);
  if (!matched.ok) {
    res.status(401).json({ error: matched.error, code: matched.code });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, matched.userId));
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
    .where(eq(faceProfilesTable.id, matched.id));

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
