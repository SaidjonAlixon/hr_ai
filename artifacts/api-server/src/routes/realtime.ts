import { Router, type IRouter } from "express";
import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  chatMembersTable,
  chatMessagesTable,
  chatsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import type { AuthRequest } from "../middlewares/auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

async function buildSyncPayload(me: number, chatId: number | null, afterMsgId: number | null) {
  const [unreadRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(
      and(eq(notificationsTable.userId, me), eq(notificationsTable.isRead, false)),
    );

  const memberships = await db
    .select({ chatId: chatMembersTable.chatId })
    .from(chatMembersTable)
    .where(eq(chatMembersTable.userId, me));

  const chatIds = memberships.map((m) => m.chatId);
  let chatsVersion = "0";

  if (chatIds.length) {
    const [ver] = await db
      .select({
        maxAt: sql<string>`coalesce(max(${chatsTable.lastMessageAt})::text, '0')`,
      })
      .from(chatsTable)
      .where(inArray(chatsTable.id, chatIds));

    const [maxMsg] = await db
      .select({
        maxId: sql<number>`coalesce(max(${chatMessagesTable.id}), 0)::int`,
      })
      .from(chatMessagesTable)
      .where(inArray(chatMessagesTable.chatId, chatIds));

    chatsVersion = `${ver?.maxAt ?? "0"}:${maxMsg?.maxId ?? 0}`;
  }

  let newMessages: Array<{
    id: number;
    chatId: number;
    senderId: number;
    senderName: string;
    content: string;
    deleted: boolean;
    editedAt: string | null;
    replyToId: number | null;
    read: boolean;
    createdAt: string;
  }> = [];

  let messagesVersion = "0";

  if (chatId && Number.isFinite(chatId)) {
    const [mem] = await db
      .select()
      .from(chatMembersTable)
      .where(
        and(eq(chatMembersTable.chatId, chatId), eq(chatMembersTable.userId, me)),
      )
      .limit(1);

    if (mem) {
      const [mv] = await db
        .select({
          maxId: sql<number>`coalesce(max(${chatMessagesTable.id}), 0)::int`,
          maxEdited: sql<string>`coalesce(max(${chatMessagesTable.editedAt})::text, '0')`,
          maxDeleted: sql<string>`coalesce(max(${chatMessagesTable.deletedAt})::text, '0')`,
        })
        .from(chatMessagesTable)
        .where(eq(chatMessagesTable.chatId, chatId));
      messagesVersion = `${mv?.maxId ?? 0}:${mv?.maxEdited ?? "0"}:${mv?.maxDeleted ?? "0"}`;

      if (afterMsgId && Number.isFinite(afterMsgId) && afterMsgId > 0) {
        const rows = await db
          .select({
            id: chatMessagesTable.id,
            chatId: chatMessagesTable.chatId,
            senderId: chatMessagesTable.senderId,
            content: chatMessagesTable.content,
            replyToId: chatMessagesTable.replyToId,
            editedAt: chatMessagesTable.editedAt,
            deletedAt: chatMessagesTable.deletedAt,
            createdAt: chatMessagesTable.createdAt,
            senderName: usersTable.fullName,
          })
          .from(chatMessagesTable)
          .innerJoin(usersTable, eq(usersTable.id, chatMessagesTable.senderId))
          .where(
            and(
              eq(chatMessagesTable.chatId, chatId),
              gt(chatMessagesTable.id, afterMsgId),
            ),
          )
          .orderBy(asc(chatMessagesTable.id))
          .limit(50);

        const others = await db
          .select({
            userId: chatMembersTable.userId,
            lastReadAt: chatMembersTable.lastReadAt,
          })
          .from(chatMembersTable)
          .where(
            and(eq(chatMembersTable.chatId, chatId), ne(chatMembersTable.userId, me)),
          );

        newMessages = rows.map((m) => {
          const deleted = !!m.deletedAt;
          const read =
            m.senderId === me &&
            others.length > 0 &&
            others.every(
              (o) => o.lastReadAt && o.lastReadAt.getTime() >= m.createdAt.getTime(),
            );
          return {
            id: m.id,
            chatId: m.chatId,
            senderId: m.senderId,
            senderName: m.senderName,
            content: deleted ? "" : m.content,
            deleted,
            editedAt: m.editedAt?.toISOString() ?? null,
            replyToId: m.replyToId ?? null,
            read,
            createdAt: m.createdAt.toISOString(),
          };
        });
      }
    }
  }

  return {
    serverTime: Date.now(),
    unreadNotifications: unreadRow?.c ?? 0,
    chatsVersion,
    messagesVersion,
    newMessages,
  };
}

/** Tezkor sync (Vercel-friendly poll) */
router.get("/realtime/sync", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const me = req.userId!;
  const chatId = req.query.chatId ? Number(req.query.chatId) : null;
  const afterMsgId = req.query.afterMsgId ? Number(req.query.afterMsgId) : null;
  try {
    const payload = await buildSyncPayload(
      me,
      chatId && Number.isFinite(chatId) ? chatId : null,
      afterMsgId && Number.isFinite(afterMsgId) ? afterMsgId : null,
    );
    res.json(payload);
  } catch (err) {
    console.error("realtime/sync", err);
    res.status(503).json({ error: "Realtime sync xato" });
  }
});

/** SSE stream — ochiq ulanish */
router.get("/realtime/stream", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const me = req.userId!;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  let closed = false;
  let lastChatsVersion = "";
  let lastMessagesVersion = "";
  let lastUnread = -1;

  const write = (event: string, data: unknown) => {
    if (closed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      closed = true;
    }
  };

  write("hello", { ok: true, serverTime: Date.now() });

  const tick = async () => {
    if (closed) return;
    try {
      const chatId = req.query.chatId ? Number(req.query.chatId) : null;
      const afterMsgId = req.query.afterMsgId ? Number(req.query.afterMsgId) : null;
      const payload = await buildSyncPayload(
        me,
        chatId && Number.isFinite(chatId) ? chatId : null,
        afterMsgId && Number.isFinite(afterMsgId) ? afterMsgId : null,
      );

      const changed =
        payload.chatsVersion !== lastChatsVersion ||
        payload.messagesVersion !== lastMessagesVersion ||
        payload.unreadNotifications !== lastUnread;

      lastChatsVersion = payload.chatsVersion;
      lastMessagesVersion = payload.messagesVersion;
      lastUnread = payload.unreadNotifications;

      write(changed ? "update" : "ping", payload);
    } catch {
      write("error", { message: "sync failed" });
    }
  };

  await tick();
  const interval = setInterval(() => {
    void tick();
  }, 1000);

  const heartbeat = setInterval(() => {
    if (!closed) {
      try {
        res.write(`: hb\n\n`);
      } catch {
        closed = true;
      }
    }
  }, 15000);

  req.on("close", () => {
    closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
  });
});

export default router;
