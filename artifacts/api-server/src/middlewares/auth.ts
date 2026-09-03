import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
}

async function loadSessionUser(
  req: AuthRequest,
): Promise<{ id: number; role: string } | null> {
  const sessionCookie = req.cookies?.session;
  if (!sessionCookie) return null;

  let decoded: { userId?: number };
  try {
    decoded = JSON.parse(Buffer.from(sessionCookie, "base64").toString());
  } catch {
    return null;
  }
  if (!decoded?.userId) return null;

  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.id, decoded.userId));

  if (!user || (user.status !== "active" && user.status !== "on_leave")) {
    return null;
  }
  return { id: user.id, role: user.role };
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await loadSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Avtorizatsiya talab etiladi" });
      return;
    }
    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch (err) {
    console.error("requireAuth db error:", err);
    res.status(503).json({ error: "Server vaqtincha ishlamayapti, qayta urinib ko‘ring" });
  }
}

/** Sessiya bo‘lsa userId qo‘yadi, bo‘lmasa ham o‘tkazadi (login sahifa yordami). */
export async function optionalAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await loadSessionUser(req);
    if (user) {
      req.userId = user.id;
      req.userRole = user.role;
    }
  } catch (err) {
    console.error("optionalAuth db error:", err);
  }
  next();
}
