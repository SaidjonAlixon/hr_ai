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

export type ChatMessage = {
  id: number;
  chatId: number;
  senderId: number;
  senderName: string;
  content: string;
  createdAt: string;
};

export type ChatListItem = {
  id: number;
  type: string;
  title: string;
  members: ChatUser[];
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
  type: string;
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
    refetchInterval: 4_000,
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

export function useChatMessages(chatId: number | null, afterId?: number | null) {
  return useQuery({
    queryKey: ["chats", chatId, "messages"],
    queryFn: () =>
      apiFetch<{ messages: ChatMessage[] }>(
        `/chats/${chatId}/messages?limit=80`,
      ),
    enabled: !!chatId,
    refetchInterval: chatId ? 2_500 : false,
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

export function useSendMessage(chatId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiFetch<{ message: ChatMessage }>(`/chats/${chatId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }),
    onSuccess: (data) => {
      if (!chatId) return;
      qc.setQueryData<{ messages: ChatMessage[] }>(
        ["chats", chatId, "messages"],
        (old) => {
          const prev = old?.messages ?? [];
          if (prev.some((m) => m.id === data.message.id)) return old;
          return { messages: [...prev, data.message] };
        },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}

/** Poll yangi xabarlar (afterId) */
export async function fetchMessagesAfter(chatId: number, afterId: number) {
  return apiFetch<{ messages: ChatMessage[] }>(
    `/chats/${chatId}/messages?afterId=${afterId}&limit=50`,
  );
}
