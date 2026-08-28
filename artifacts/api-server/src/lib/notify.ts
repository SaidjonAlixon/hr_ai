import { and, eq, inArray } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";

import { HR_ROLES } from "../lib/roles";
import {
  davomatMiniAppKeyboard,
  escapeHtml,
  isTelegramConfigured,
  sendMessage,
} from "./telegram";
import { logger } from "./logger";

/** Faol HR (va ixtiyoriy admin) ga bildirishnoma */
export async function notifyActiveHrs(opts: {
  text: string;
  type: string;
  linkUrl: string;
  includeAdmin?: boolean;
}): Promise<void> {
  const roles = opts.includeAdmin === false ? [...HR_ROLES] : [...HR_ROLES, "admin"];
  const hrs = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.status, "active"), inArray(usersTable.role, roles)));

  for (const r of hrs) {
    await notifyUser({ userId: r.id, ...opts });
  }
}

export async function notifyByRoles(opts: {
  roles: string[];
  text: string;
  type: string;
  linkUrl: string;
}): Promise<void> {
  if (!opts.roles.length) return;
  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.status, "active"), inArray(usersTable.role, opts.roles)));

  for (const r of users) {
    await notifyUser({ userId: r.id, ...opts });
  }
}

async function pushTelegramToUser(
  userId: number,
  text: string,
  linkUrl?: string,
): Promise<void> {
  if (!isTelegramConfigured()) return;

  const [user] = await db
    .select({ telegramId: usersTable.telegramId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user?.telegramId) return;

  const reply_markup =
    linkUrl?.includes("davomat") ? davomatMiniAppKeyboard() : undefined;

  try {
    await sendMessage(user.telegramId, escapeHtml(text), {
      parse_mode: "HTML",
      reply_markup,
    });
  } catch (err) {
    logger.warn({ err, userId }, "Telegram bildirishnoma yuborilmadi");
  }
}

export async function notifyUser(opts: {
  userId: number | null | undefined;
  text: string;
  type: string;
  linkUrl: string;
  telegram?: boolean;
}): Promise<void> {
  if (!opts.userId) return;
  await db.insert(notificationsTable).values({
    userId: opts.userId,
    text: opts.text,
    type: opts.type,
    linkUrl: opts.linkUrl,
  });
  if (opts.telegram) {
    await pushTelegramToUser(opts.userId, opts.text, opts.linkUrl);
  }
}

/** Barcha faol foydalanuvchilarga (xodimlarga) bildirishnoma */
export async function notifyAllActiveUsers(opts: {
  text: string;
  type: string;
  linkUrl: string;
}): Promise<number> {
  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.status, "active"));

  for (const u of users) {
    await notifyUser({ userId: u.id, ...opts });
  }
  return users.length;
}
