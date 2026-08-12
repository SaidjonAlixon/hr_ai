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
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    if (window.location.pathname.includes("/chat") && Number.isFinite(id) && id > 0) {
      return id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function lastPositiveMsgId(messages: ChatMessage[] | undefined): number {
  if (!messages?.length) return 0;
  let max = 0;
  for (const m of messages) {
    if (m.id > max) max = m.id;
  }
  return max;
}

/**
 * Platforma real-time sync:
 * - Tab ko‘rinadi: har ~1s poll
 * - SSE mavjud bo‘lsa — stream (tezroq push)
 * - Chat/xabar/bildirishnoma cache yangilanadi
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
    let es: EventSource | null = null;
    let useSse = true;

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
        void qc.invalidateQueries({ queryKey: ["chats"] });
      }

      if (chatId && payload.messagesVersion !== messagesVersionRef.current) {
        messagesVersionRef.current = payload.messagesVersion;

        if (payload.newMessages?.length) {
          qc.setQueryData<{ messages: ChatMessage[] }>(
            ["chats", chatId, "messages"],
            (old) => {
              const prev = old?.messages ?? [];
              const ids = new Set(prev.map((m) => m.id));
              const pending = prev.filter((m) => m.pending || m.id < 0);
              const incoming = payload.newMessages.filter((m) => !ids.has(m.id));
              if (!incoming.length && !pending.length) return old;
              // pending ni saqlab, server xabarlarini qo‘shamiz
              const withoutDupPending = pending.filter(
                (p) =>
                  !incoming.some(
                    (n) => n.senderId === p.senderId && n.content === p.content,
                  ),
              );
              return {
                messages: [
                  ...prev.filter((m) => !(m.pending || m.id < 0)),
                  ...incoming,
                  ...withoutDupPending,
                ].sort((a, b) => a.id - b.id || a.createdAt.localeCompare(b.createdAt)),
              };
            },
          );
        } else {
          // edit/delete uchun to‘liq refetch
          void qc.invalidateQueries({ queryKey: ["chats", chatId, "messages"] });
        }
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
        const payload = (await res.json()) as SyncPayload;
        applyPayload(payload);
      } catch {
        /* ignore transient */
      }
    };

    const startPoll = () => {
      if (pollTimer) return;
      void pollOnce();
      pollTimer = setInterval(() => {
        void pollOnce();
      }, 1000);
    };

    const stopPoll = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const startSse = () => {
      if (!useSse || es) return;
      const chatId = activeChatIdFromUrl();
      const cached = chatId
        ? qc.getQueryData<{ messages: ChatMessage[] }>(["chats", chatId, "messages"])
        : undefined;
      const afterMsgId = lastPositiveMsgId(cached?.messages);
      const params = new URLSearchParams();
      if (chatId) params.set("chatId", String(chatId));
      if (afterMsgId > 0) params.set("afterMsgId", String(afterMsgId));

      try {
        es = new EventSource(`/api/realtime/stream?${params.toString()}`);
      } catch {
        useSse = false;
        startPoll();
        return;
      }

      const onPayload = (ev: MessageEvent) => {
        try {
          applyPayload(JSON.parse(ev.data) as SyncPayload);
        } catch {
          /* ignore */
        }
      };

      es.addEventListener("update", onPayload);
      es.addEventListener("ping", onPayload);
      es.addEventListener("hello", () => {
        // SSE ishlayapti — poll kerak emas
        stopPoll();
      });
      es.onerror = () => {
        es?.close();
        es = null;
        useSse = false;
        startPoll();
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void pollOnce();
        if (useSse && !es) startSse();
        else if (!useSse) startPoll();
      } else {
        stopPoll();
        es?.close();
        es = null;
      }
    };

    // Boshlash: avval poll (ishonchli), parallel SSE urinish
    startPoll();
    startSse();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", pollOnce);

    // URL o‘zgaganda (chat id) sync parametrlarini yangilash
    const onPop = () => {
      es?.close();
      es = null;
      if (useSse) startSse();
      void pollOnce();
    };
    window.addEventListener("popstate", onPop);

    // history.replaceState chat ichida ishlatiladi — pollda URL o‘qiladi, SSE ni qayta ochamiz
    const origReplace = window.history.replaceState.bind(window.history);
    window.history.replaceState = (...args) => {
      origReplace(...args);
      if (String(args[2] || "").includes("/chat")) {
        es?.close();
        es = null;
        if (useSse) startSse();
      }
    };

    return () => {
      stopped = true;
      stopPoll();
      es?.close();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", pollOnce);
      window.removeEventListener("popstate", onPop);
      window.history.replaceState = origReplace;
    };
  }, [isAuthenticated, user, qc]);

  return null;
}
