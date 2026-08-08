import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useChatList,
  useChatMessages,
  useChatUsers,
  useCreateChat,
  useMarkChatRead,
  useSendMessage,
  type ChatListItem,
  type ChatUser,
} from "@/lib/chat-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Check,
  MessageCircle,
  Plus,
  Search,
  Send,
  Users,
} from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  hr: "HR",
  recruiter: "Rekruter",
  trainer: "Trener",
  mentor: "Mentor",
  director: "Direktor",
  department_head: "Bo‘lim boshlig‘i",
  mudir: "Mudir",
  koordinator: "Koordinator",
  texnik: "Texnik",
  ombor: "Ombor",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("uz-UZ", { day: "2-digit", month: "2-digit" });
}

function formatMsgTime(iso: string) {
  return new Date(iso).toLocaleTimeString("uz-UZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AvatarBubble({
  name,
  size = "md",
  tint,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  tint?: string;
}) {
  const dim =
    size === "sm" ? "h-9 w-9 text-xs" : size === "lg" ? "h-12 w-12 text-base" : "h-11 w-11 text-sm";
  return (
    <div
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center font-semibold text-white shadow-sm",
        dim,
      )}
      style={{ background: tint || "#2AABEE" }}
    >
      {initials(name)}
    </div>
  );
}

function tintForId(id: number) {
  const colors = [
    "#2AABEE",
    "#6C5CE7",
    "#00B894",
    "#E17055",
    "#0984E3",
    "#D63031",
    "#00CEC9",
    "#FD79A8",
  ];
  return colors[id % colors.length]!;
}

export default function ChatPage() {
  const { user } = useAuth();
  const [urlChatId, setUrlChatId] = useState<number | null>(() => {
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    return Number.isFinite(id) && id > 0 ? id : null;
  });

  const [selectedId, setSelectedId] = useState<number | null>(urlChatId);
  const [listQuery, setListQuery] = useState("");
  const [mobileShowChat, setMobileShowChat] = useState(!!urlChatId);
  const [newOpen, setNewOpen] = useState(false);
  const [newMode, setNewMode] = useState<"direct" | "group">("direct");
  const [userQuery, setUserQuery] = useState("");
  const [picked, setPicked] = useState<ChatUser[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [draft, setDraft] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const list = useChatList();
  const messages = useChatMessages(selectedId);
  const createChat = useCreateChat();
  const sendMessage = useSendMessage(selectedId);
  const markRead = useMarkChatRead();
  const chatUsers = useChatUsers(userQuery, newOpen);

  useEffect(() => {
    if (urlChatId) {
      setSelectedId(urlChatId);
      setMobileShowChat(true);
    }
  }, [urlChatId]);

  useEffect(() => {
    const onPop = () => {
      const id = Number(new URLSearchParams(window.location.search).get("id"));
      setUrlChatId(Number.isFinite(id) && id > 0 ? id : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    markRead.mutate(selectedId);
  }, [selectedId, messages.data?.messages?.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data?.messages?.length, selectedId]);

  const chats = list.data?.chats ?? [];
  const filteredChats = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.lastMessage?.content.toLowerCase().includes(q),
    );
  }, [chats, listQuery]);

  const activeChat: ChatListItem | undefined = chats.find((c) => c.id === selectedId);

  const openChat = (id: number) => {
    setSelectedId(id);
    setMobileShowChat(true);
    const url = new URL(window.location.href);
    url.searchParams.set("id", String(id));
    window.history.replaceState({}, "", url.pathname + "?" + url.searchParams.toString());
  };

  const backToList = () => {
    setMobileShowChat(false);
  };

  const togglePick = (u: ChatUser) => {
    setPicked((prev) => {
      if (newMode === "direct") return [u];
      if (prev.some((p) => p.id === u.id)) return prev.filter((p) => p.id !== u.id);
      return [...prev, u];
    });
  };

  const submitNewChat = async () => {
    if (!picked.length) return;
    try {
      if (newMode === "direct") {
        const res = await createChat.mutateAsync({
          type: "direct",
          userId: picked[0]!.id,
        });
        setNewOpen(false);
        setPicked([]);
        setUserQuery("");
        openChat(res.chat.id);
      } else {
        if (!groupTitle.trim()) return;
        const res = await createChat.mutateAsync({
          type: "group",
          title: groupTitle.trim(),
          memberIds: picked.map((p) => p.id),
        });
        setNewOpen(false);
        setPicked([]);
        setGroupTitle("");
        setUserQuery("");
        openChat(res.chat.id);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Xato");
    }
  };

  const onSend = async () => {
    const text = draft.trim();
    if (!text || !selectedId || sendMessage.isPending) return;
    setDraft("");
    try {
      await sendMessage.mutateAsync(text);
    } catch (e) {
      setDraft(text);
      alert(e instanceof Error ? e.message : "Yuborilmadi");
    }
  };

  const meId = user?.id;

  return (
    <div className="h-full min-h-0 flex bg-[#0e1621] text-white overflow-hidden rounded-none sm:rounded-xl border border-[#1c2733]">
      {/* Chat list */}
      <aside
        className={cn(
          "w-full sm:w-[340px] lg:w-[380px] shrink-0 flex flex-col border-r border-[#1c2733] bg-[#17212b]",
          mobileShowChat ? "hidden sm:flex" : "flex",
        )}
      >
        <div className="px-4 pt-4 pb-3 border-b border-[#1c2733]">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-[#2AABEE]" />
              Chat
            </h1>
            <Button
              size="sm"
              className="bg-[#2AABEE] hover:bg-[#229ED9] text-white h-9 gap-1"
              onClick={() => {
                setNewMode("direct");
                setPicked([]);
                setGroupTitle("");
                setNewOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Yangi
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6c7a89]" />
            <Input
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder="Qidirish..."
              className="pl-9 bg-[#242f3d] border-transparent text-white placeholder:text-[#6c7a89] focus-visible:ring-[#2AABEE]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {list.isLoading && (
            <p className="text-sm text-[#6c7a89] p-4">Yuklanmoqda...</p>
          )}
          {!list.isLoading && filteredChats.length === 0 && (
            <div className="p-6 text-center text-[#6c7a89]">
              <MessageCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Hali chat yo‘q</p>
              <p className="text-xs mt-1">«Yangi» orqali xodim bilan suhbat boshlang</p>
            </div>
          )}
          {filteredChats.map((c) => {
            const active = c.id === selectedId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openChat(c.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-3 text-left transition-colors border-b border-[#1c2733]/60",
                  active ? "bg-[#2b5278]/50" : "hover:bg-[#202b36]",
                )}
              >
                {c.type === "group" ? (
                  <div className="h-11 w-11 rounded-full bg-[#6C5CE7] flex items-center justify-center shrink-0">
                    <Users className="h-5 w-5" />
                  </div>
                ) : (
                  <AvatarBubble
                    name={c.title}
                    tint={tintForId(c.peer?.id || c.id)}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{c.title}</span>
                    <span className="text-[11px] text-[#6c7a89] shrink-0">
                      {formatTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-xs text-[#8b9aab] truncate">
                      {c.lastMessage?.content || "Suhbat boshlandi"}
                    </p>
                    {c.unreadCount > 0 && (
                      <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#2AABEE] text-[10px] font-semibold flex items-center justify-center">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Conversation */}
      <section
        className={cn(
          "flex-1 min-w-0 flex flex-col bg-[#0e1621]",
          !mobileShowChat ? "hidden sm:flex" : "flex",
        )}
        style={{
          backgroundImage:
            "radial-gradient(ellipse at top, rgba(42,171,238,0.06), transparent 55%), linear-gradient(180deg,#0e1621,#0b1219)",
        }}
      >
        {!selectedId || !activeChat ? (
          <div className="flex-1 flex flex-col items-center justify-center text-[#6c7a89] p-6">
            <MessageCircle className="h-16 w-16 mb-3 opacity-30" />
            <p className="text-base">Chatni tanlang yoki yangi suhbat boshlang</p>
          </div>
        ) : (
          <>
            <header className="h-14 shrink-0 flex items-center gap-3 px-3 sm:px-4 border-b border-[#1c2733] bg-[#17212b]">
              <button
                type="button"
                className="sm:hidden p-2 -ml-1 rounded-md hover:bg-[#242f3d]"
                onClick={backToList}
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              {activeChat.type === "group" ? (
                <div className="h-10 w-10 rounded-full bg-[#6C5CE7] flex items-center justify-center">
                  <Users className="h-5 w-5" />
                </div>
              ) : (
                <AvatarBubble
                  name={activeChat.title}
                  size="sm"
                  tint={tintForId(activeChat.peer?.id || activeChat.id)}
                />
              )}
              <div className="min-w-0">
                <p className="font-medium truncate leading-tight">{activeChat.title}</p>
                <p className="text-[11px] text-[#8b9aab] truncate">
                  {activeChat.type === "group"
                    ? `${activeChat.members.length} a’zo`
                    : ROLE_LABELS[activeChat.peer?.role || ""] ||
                      activeChat.peer?.role ||
                      ""}
                </p>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-2">
              {(messages.data?.messages ?? []).map((m, idx, arr) => {
                const mine = m.senderId === meId;
                const prev = arr[idx - 1];
                const showName =
                  activeChat.type === "group" &&
                  !mine &&
                  (!prev || prev.senderId !== m.senderId);
                return (
                  <div
                    key={m.id}
                    className={cn("flex", mine ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 shadow-sm",
                        mine
                          ? "bg-[#2b5278] rounded-br-md"
                          : "bg-[#182533] rounded-bl-md",
                      )}
                    >
                      {showName && (
                        <p
                          className="text-[11px] font-semibold mb-0.5"
                          style={{ color: tintForId(m.senderId) }}
                        >
                          {m.senderName}
                        </p>
                      )}
                      <p className="text-[15px] leading-snug whitespace-pre-wrap break-words">
                        {m.content}
                      </p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className="text-[10px] text-[#8b9aab]">
                          {formatMsgTime(m.createdAt)}
                        </span>
                        {mine && <Check className="h-3 w-3 text-[#8b9aab]" />}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <footer className="shrink-0 p-3 sm:p-4 border-t border-[#1c2733] bg-[#17212b]">
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void onSend();
                }}
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Xabar yozing..."
                  className="min-h-11 bg-[#242f3d] border-transparent text-white placeholder:text-[#6c7a89] focus-visible:ring-[#2AABEE]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onSend();
                    }
                  }}
                />
                <Button
                  type="submit"
                  disabled={!draft.trim() || sendMessage.isPending}
                  className="h-11 w-11 rounded-full bg-[#2AABEE] hover:bg-[#229ED9] p-0 shrink-0"
                >
                  <Send className="h-5 w-5" />
                </Button>
              </form>
            </footer>
          </>
        )}
      </section>

      {/* New chat dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md bg-[#17212b] text-white border-[#1c2733]">
          <DialogHeader>
            <DialogTitle>Yangi chat</DialogTitle>
          </DialogHeader>

          <div className="flex gap-2 mb-3">
            <Button
              type="button"
              variant={newMode === "direct" ? "default" : "outline"}
              className={cn(
                "flex-1",
                newMode === "direct"
                  ? "bg-[#2AABEE] hover:bg-[#229ED9]"
                  : "border-[#2b3a4a] bg-transparent text-white hover:bg-[#242f3d]",
              )}
              onClick={() => {
                setNewMode("direct");
                setPicked((p) => (p[0] ? [p[0]] : []));
              }}
            >
              Shaxsiy
            </Button>
            <Button
              type="button"
              variant={newMode === "group" ? "default" : "outline"}
              className={cn(
                "flex-1",
                newMode === "group"
                  ? "bg-[#2AABEE] hover:bg-[#229ED9]"
                  : "border-[#2b3a4a] bg-transparent text-white hover:bg-[#242f3d]",
              )}
              onClick={() => setNewMode("group")}
            >
              Guruh
            </Button>
          </div>

          {newMode === "group" && (
            <Input
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Guruh nomi"
              className="mb-3 bg-[#242f3d] border-transparent text-white placeholder:text-[#6c7a89]"
            />
          )}

          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6c7a89]" />
            <Input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Xodim qidirish..."
              className="pl-9 bg-[#242f3d] border-transparent text-white placeholder:text-[#6c7a89]"
            />
          </div>

          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {picked.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePick(p)}
                  className="text-xs px-2 py-1 rounded-full bg-[#2AABEE]/20 text-[#2AABEE] border border-[#2AABEE]/40"
                >
                  {p.fullName} ×
                </button>
              ))}
            </div>
          )}

          <div className="max-h-64 overflow-y-auto rounded-lg border border-[#1c2733] divide-y divide-[#1c2733]">
            {(chatUsers.data?.users ?? []).map((u) => {
              const selected = picked.some((p) => p.id === u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => togglePick(u)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#242f3d]",
                    selected && "bg-[#2b5278]/40",
                  )}
                >
                  <AvatarBubble name={u.fullName} size="sm" tint={tintForId(u.id)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{u.fullName}</p>
                    <p className="text-[11px] text-[#8b9aab]">
                      {ROLE_LABELS[u.role] || u.role}
                    </p>
                  </div>
                  {selected && <Check className="h-4 w-4 text-[#2AABEE]" />}
                </button>
              );
            })}
            {!chatUsers.isLoading && (chatUsers.data?.users?.length ?? 0) === 0 && (
              <p className="p-4 text-sm text-[#6c7a89] text-center">Xodim topilmadi</p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="border-[#2b3a4a] bg-transparent text-white hover:bg-[#242f3d]"
              onClick={() => setNewOpen(false)}
            >
              Bekor
            </Button>
            <Button
              type="button"
              className="bg-[#2AABEE] hover:bg-[#229ED9]"
              disabled={
                createChat.isPending ||
                !picked.length ||
                (newMode === "group" && !groupTitle.trim())
              }
              onClick={() => void submitNewChat()}
            >
              {createChat.isPending ? "..." : "Boshlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
