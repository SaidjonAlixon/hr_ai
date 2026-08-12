import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

export type ChatUser = {
  id: number;
  fullName: string;
  role: string;
  status: string;
  login?: string;
};

export type ChatReplyPreview = {
  id: number;
  content: string;
  senderName: string;
  deleted: boolean;
};

export type ChatMessage = {
  id: number;
  chatId: number;
  senderId: number;
  senderName: string;
  content: string;
  createdAt: string;
  deleted?: boolean;
  editedAt?: string | null;
  replyToId?: number | null;
  replyTo?: ChatReplyPreview | null;
  read?: boolean;
  pending?: boolean;
};

export type ChatListItem = {
  id: number;
  type: "direct" | "group" | string;
  title: string;
  members: ChatUser[];
  memberCount?: number;
  peer: ChatUser | null;
  lastMessage: {
    id: number;
    content: string;
    senderId: number;
    createdAt: string;
  } | null;
  unreadCount: number;
  lastMessageAt: string;
  createdAt: string;
};

export type ChatDetail = {
  id: number;
  type: "direct" | "group" | string;
  title: string;
  members: ChatUser[];
  peer: ChatUser | null;
  createdAt: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message || `Xato ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function useChatList(
  options?: Omit<UseQueryOptions<{ chats: ChatListItem[] }>, "queryKey" | "queryFn">,
) {
  return useQuery({
    queryKey: ["chats"],
    queryFn: () => apiFetch<{ chats: ChatListItem[] }>("/chats"),
    refetchInterval: 5_000,
    ...options,
  });
}

export function useChatUsers(q: string, enabled = true) {
  return useQuery({
    queryKey: ["chats", "users", q],
    queryFn: () =>
      apiFetch<{ users: ChatUser[] }>(
        `/chats/users${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      ),
    enabled,
    staleTime: 10_000,
  });
}

export function useChatMessages(chatId: number | null) {
  return useQuery({
    queryKey: ["chats", chatId, "messages"],
    queryFn: () =>
      apiFetch<{ messages: ChatMessage[] }>(`/chats/${chatId}/messages?limit=80`),
    enabled: !!chatId,
    refetchInterval: chatId ? 3_000 : false,
    structuralSharing: (oldData, newData) => {
      const old = oldData as { messages: ChatMessage[] } | undefined;
      const next = newData as { messages: ChatMessage[] } | undefined;
      if (!old?.messages?.length || !next?.messages) return newData;
      const pending = old.messages.filter((m) => m.pending || m.id < 0);
      if (!pending.length) return newData;
      const ids = new Set(next.messages.map((m) => m.id));
      const contents = new Set(next.messages.map((m) => `${m.senderId}:${m.content}`));
      const keep = pending.filter(
        (p) => !ids.has(p.id) && !contents.has(`${p.senderId}:${p.content}`),
      );
      if (!keep.length) return newData;
      return { messages: [...next.messages, ...keep] };
    },
  });
}

export function useCreateChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      type: "direct" | "group";
      userId?: number;
      memberIds?: number[];
      title?: string;
    }) =>
      apiFetch<{ chat: ChatDetail & { existing?: boolean } }>("/chats", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

export function useSendMessage(
  chatId: number | null,
  me?: { id: number; fullName: string } | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { content: string; replyToId?: number | null }) =>
      apiFetch<{ message: ChatMessage }>(`/chats/${chatId}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onMutate: async (body) => {
      if (!chatId || !me) return { tempId: 0 };
      const tempId = -Date.now();
      const optimistic: ChatMessage = {
        id: tempId,
        chatId,
        senderId: me.id,
        senderName: me.fullName,
        content: body.content,
        createdAt: new Date().toISOString(),
        pending: true,
        read: false,
        replyToId: body.replyToId ?? null,
      };
      await qc.cancelQueries({ queryKey: ["chats", chatId, "messages"] });
      const prev = qc.getQueryData<{ messages: ChatMessage[] }>([
        "chats",
        chatId,
        "messages",
      ]);
      if (body.replyToId && prev?.messages) {
        const parent = prev.messages.find((m) => m.id === body.replyToId);
        if (parent) {
          optimistic.replyTo = {
            id: parent.id,
            content: parent.deleted ? "" : parent.content.slice(0, 120),
            senderName: parent.senderName,
            deleted: !!parent.deleted,
          };
        }
      }
      qc.setQueryData<{ messages: ChatMessage[] }>(
        ["chats", chatId, "messages"],
        (old) => ({ messages: [...(old?.messages ?? []), optimistic] }),
      );
      qc.setQueryData<{ chats: ChatListItem[] }>(["chats"], (old) => {
        if (!old?.chats) return old;
        return {
          chats: old.chats
            .map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    lastMessage: {
                      id: tempId,
                      content: body.content,
                      senderId: me.id,
                      createdAt: optimistic.createdAt,
                    },
                    lastMessageAt: optimistic.createdAt,
                  }
                : c,
            )
            .sort(
              (a, b) =>
                new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
            ),
        };
      });
      return { prev, tempId };
    },
    onError: (_err, _body, ctx) => {
      if (!chatId || !ctx?.prev) return;
      qc.setQueryData(["chats", chatId, "messages"], ctx.prev);
    },
    onSuccess: (data, _body, ctx) => {
      if (!chatId) return;
      qc.setQueryData<{ messages: ChatMessage[] }>(
        ["chats", chatId, "messages"],
        (old) => {
          const prev = (old?.messages ?? []).filter(
            (m) => m.id !== ctx?.tempId && m.id !== data.message.id,
          );
          return { messages: [...prev, data.message] };
        },
      );
      qc.setQueryData<{ chats: ChatListItem[] }>(["chats"], (old) => {
        if (!old?.chats) return old;
        return {
          chats: old.chats
            .map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    lastMessage: {
                      id: data.message.id,
                      content: data.message.content,
                      senderId: data.message.senderId,
                      createdAt: data.message.createdAt,
                    },
                    lastMessageAt: data.message.createdAt,
                  }
                : c,
            )
            .sort(
              (a, b) =>
                new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
            ),
        };
      });
    },
  });
}

export function useEditMessage(chatId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { messageId: number; content: string }) =>
      apiFetch<{ message: ChatMessage }>(
        `/chats/${chatId}/messages/${body.messageId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ content: body.content }),
        },
      ),
    onSuccess: (data) => {
      if (!chatId) return;
      qc.setQueryData<{ messages: ChatMessage[] }>(
        ["chats", chatId, "messages"],
        (old) => ({
          messages: (old?.messages ?? []).map((m) =>
            m.id === data.message.id
              ? {
                  ...m,
                  content: data.message.content,
                  editedAt: data.message.editedAt,
                }
              : m,
          ),
        }),
      );
    },
  });
}

export function useDeleteMessage(chatId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: number) =>
      apiFetch<{ ok: boolean; id: number }>(
        `/chats/${chatId}/messages/${messageId}`,
        { method: "DELETE" },
      ),
    onSuccess: (data) => {
      if (!chatId) return;
      qc.setQueryData<{ messages: ChatMessage[] }>(
        ["chats", chatId, "messages"],
        (old) => ({
          messages: (old?.messages ?? []).map((m) =>
            m.id === data.id
              ? { ...m, deleted: true, content: "", editedAt: null }
              : m,
          ),
        }),
      );
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

export function useMarkChatRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: number) =>
      apiFetch<{ ok: boolean }>(`/chats/${chatId}/read`, { method: "POST" }),
    onSuccess: (_data, chatId) => {
      qc.invalidateQueries({ queryKey: ["chats"] });
      qc.invalidateQueries({ queryKey: ["chats", chatId, "messages"] });
    },
  });
}

export function useAddChatMembers(chatId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberIds: number[]) =>
      apiFetch<{ chat: ChatDetail; added: number[] }>(`/chats/${chatId}/members`, {
        method: "POST",
        body: JSON.stringify({ memberIds }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

export function useRemoveChatMember(chatId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) =>
      apiFetch<{ ok: boolean; deletedChat?: boolean }>(
        `/chats/${chatId}/members/${userId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: number) =>
      apiFetch<void>(`/chats/${chatId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}
