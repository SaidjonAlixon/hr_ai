import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import { eq } from "drizzle-orm";
import { db, userSessionsTable } from "@workspace/db";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function isProdEnv(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true"
  );
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type SessionMeta = { ipAddress?: string | null; userAgent?: string | null };

/**
 * Sessiya faqat bazadagi `user_sessions` yozuvi orqali tan olinadi.
 * Cookie ichida userId yo‘q — tasodifiy token, bazada uning sha256 xeshi.
 */
async function issueSession(
  res: Response,
  userId: number,
  sameSite: "lax" | "none",
  meta?: SessionMeta,
): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await db.insert(userSessionsTable).values({
    userId,
    deviceRowId: null,
    sessionTokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
  });
  const secure = isProdEnv();
  res.cookie("session", `sec.${token}`, {
    httpOnly: true,
    maxAge: SESSION_TTL_MS,
    signed: false,
    sameSite: sameSite === "none" && secure ? "none" : "lax",
    secure,
    path: "/",
  });
}

export async function setSessionCookie(res: Response, userId: number, meta?: SessionMeta): Promise<void> {
  await issueSession(res, userId, "lax", meta);
}

/** Telegram Mini App WebView — SameSite=None kerak (secure) */
export async function setTelegramSessionCookie(
  res: Response,
  userId: number,
  meta?: SessionMeta,
): Promise<void> {
  await issueSession(res, userId, "none", meta);
}

/** Cookie’dagi xavfsiz sessiyadan userId (bekor qilingan / muddati o‘tgan — null). */
export async function sessionUserIdFromCookie(raw: unknown): Promise<number | null> {
  if (typeof raw !== "string" || !raw.startsWith("sec.")) return null;
  const token = raw.slice(4);
  if (!token) return null;
  const [row] = await db
    .select({
      userId: userSessionsTable.userId,
      revokedAt: userSessionsTable.revokedAt,
      expiresAt: userSessionsTable.expiresAt,
    })
    .from(userSessionsTable)
    .where(eq(userSessionsTable.sessionTokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return null;
  return row.userId;
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie("session", { path: "/", sameSite: "lax", secure: isProdEnv() });
}
