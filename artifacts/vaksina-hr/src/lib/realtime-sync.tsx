import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  getGetDashboardStatsQueryKey,
  getGetNotificationsQueryKey,
} from "@workspace/api-client-react";
import type { ChatMessage } from "@/lib/chat-api";

type SyncPayload = {
  serverTime: number;
  unreadNotifications: number;
  chatsVersion: string;
  messagesVersion: string;
  newMessages: ChatMessage[];
};

function activeChatIdFromUrl(): number | null {
  try {
    const path = window.location.pathname;
    const onChat = path.includes("/chat");
    if (!onChat) return null;
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function lastPositiveMsgId(messages: ChatMessage[] | undefined): number {
  if (!messages?.length) return 0;
  let max = 0;
  for (const m of messages) {
    if (m.id > max) max = m.id;
  }
  return max;
}

function sortMessages(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => {
    const aPend = a.pending || a.id < 0 ? 1 : 0;
    const bPend = b.pending || b.id < 0 ? 1 : 0;
    // Pending (optimistic) — oxirida, darhol ko‘rinsin
    if (aPend !== bPend) return aPend - bPend;
    if (a.id > 0 && b.id > 0) return a.id - b.id;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<number, ChatMessage>();
  for (const m of prev) {
    if (m.id > 0) byId.set(m.id, m);
  }
  for (const m of incoming) {
    if (m.id > 0) byId.set(m.id, { ...byId.get(m.id), ...m, pending: false });
  }
  const confirmed = [...byId.values()];
  const pending = prev.filter((m) => m.pending || m.id < 0).filter((p) => {
    return !confirmed.some(
      (n) => n.senderId === p.senderId && n.content === p.content,
    );
  });
  return sortMessages([...confirmed, ...pending]);
}

/**
 * Real-time sync — chat xabarlarini darhol ko‘rsatish uchun
 * optimistic xabarlarni buzmaydi.
 */
export function RealtimeSync() {
  const { user, isAuthenticated } = useAuth();
  const qc = useQueryClient();
  const chatsVersionRef = useRef("");
  const messagesVersionRef = useRef("");
  const unreadRef = useRef(-1);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    let stopped = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const applyPayload = (payload: SyncPayload) => {
      if (stopped) return;
      const chatId = activeChatIdFromUrl();

      if (payload.unreadNotifications !== unreadRef.current) {
        unreadRef.current = payload.unreadNotifications;
        void qc.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
        void qc.invalidateQueries({
          queryKey: getGetNotificationsQueryKey({ unreadOnly: true }),
        });
        void qc.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
      }

      if (payload.chatsVersion !== chatsVersionRef.current) {
        chatsVersionRef.current = payload.chatsVersion;
        // Ro‘yxatni yumshoq yangilash — xabarlar cache’ini tozalama
        void qc.invalidateQueries({ queryKey: ["chats"], exact: true });
      }

      if (!chatId) return;

      if (payload.newMessages?.length) {
        messagesVersionRef.current = payload.messagesVersion;
        qc.setQueryData<{ messages: ChatMessage[] }>(
          ["chats", chatId, "messages"],
          (old) => ({
            messages: mergeMessages(old?.messages ?? [], payload.newMessages),
          }),
        );
        return;
      }

      // edit/delete: versiya o‘zgagan, lekin yangi id yo‘q —
      // to‘liq invalidate QILMAYMIZ (pending xabar yo‘qoladi).
      // Faqat fonda refetch + merge.
      if (
        payload.messagesVersion &&
        payload.messagesVersion !== messagesVersionRef.current &&
        payload.messagesVersion !== "0"
      ) {
        messagesVersionRef.current = payload.messagesVersion;
        void (async () => {
          try {
            const res = await fetch(`/api/chats/${chatId}/messages?limit=80`, {
              credentials: "include",
              headers: { Accept: "application/json" },
            });
            if (!res.ok) return;
            const data = (await res.json()) as { messages: ChatMessage[] };
            qc.setQueryData<{ messages: ChatMessage[] }>(
              ["chats", chatId, "messages"],
              (old) => ({
                messages: mergeMessages(old?.messages ?? [], data.messages ?? []),
              }),
            );
          } catch {
            /* ignore */
          }
        })();
      }
    };

    const pollOnce = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      const chatId = activeChatIdFromUrl();
      const cached = chatId
        ? qc.getQueryData<{ messages: ChatMessage[] }>(["chats", chatId, "messages"])
        : undefined;
      const afterMsgId = lastPositiveMsgId(cached?.messages);

      const params = new URLSearchParams();
      if (chatId) params.set("chatId", String(chatId));
      if (afterMsgId > 0) params.set("afterMsgId", String(afterMsgId));

      try {
        const res = await fetch(`/api/realtime/sync?${params.toString()}`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        applyPayload((await res.json()) as SyncPayload);
      } catch {
        /* ignore */
      }
    };

    const startPoll = () => {
      if (pollTimer) return;
      void pollOnce();
      // Chat ochiq bo‘lsa juda tez, aks holda 1s
      pollTimer = setInterval(() => {
        void pollOnce();
      }, activeChatIdFromUrl() ? 400 : 1000);
    };

    const stopPoll = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        stopPoll();
        startPoll();
        void pollOnce();
      } else {
        stopPoll();
      }
    };

    startPoll();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", pollOnce);

    return () => {
      stopped = true;
      stopPoll();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", pollOnce);
    };
  }, [isAuthenticated, user, qc]);

  return null;
}
