import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useAddChatMembers,
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Check,
  MessageCircle,
  Plus,
  Search,
  Send,
  User,
  UserPlus,
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
  farmasevt: "Farmasevt",
};

type ListFilter = "all" | "direct" | "group";

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

function GroupAvatar({ size = "md" }: { size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-9 w-9" : "h-11 w-11";
  return (
    <div
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center text-white shadow-sm",
        "bg-gradient-to-br from-[#6C5CE7] to-[#A29BFE]",
        dim,
      )}
    >
      <Users className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    </div>
  );
}

function tintForId(id: number) {
  const colors = [
    "#2AABEE",
    "#00B894",
    "#E17055",
    "#0984E3",
    "#D63031",
    "#00CEC9",
    "#FD79A8",
    "#FDCB6E",
  ];
  return colors[id % colors.length]!;
}

function TypeBadge({ type }: { type: string }) {
  const isGroup = type === "group";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0",
        isGroup
          ? "bg-[#6C5CE7]/25 text-[#C4B5FD]"
          : "bg-[#2AABEE]/20 text-[#7DD3FC]",
      )}
    >
      {isGroup ? (
        <>
          <Users className="h-2.5 w-2.5" /> Guruh
        </>
      ) : (
        <>
          <User className="h-2.5 w-2.5" /> Shaxsiy
        </>
      )}
    </span>
  );
}

export default function ChatPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [urlChatId, setUrlChatId] = useState<number | null>(() => {
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    return Number.isFinite(id) && id > 0 ? id : null;
  });

  const [selectedId, setSelectedId] = useState<number | null>(urlChatId);
  const [listQuery, setListQuery] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [mobileShowChat, setMobileShowChat] = useState(!!urlChatId);
  const [newOpen, setNewOpen] = useState(false);
  const [newMode, setNewMode] = useState<"direct" | "group">("direct");
  const [userQuery, setUserQuery] = useState("");
  const [picked, setPicked] = useState<ChatUser[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addPicked, setAddPicked] = useState<ChatUser[]>([]);
  const [membersOpen, setMembersOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const list = useChatList();
  const messages = useChatMessages(selectedId);
  const createChat = useCreateChat();
  const sendMessage = useSendMessage(selectedId);
  const markRead = useMarkChatRead();
  const addMembers = useAddChatMembers(selectedId);
  const chatUsers = useChatUsers(userQuery, newOpen);
  const addUsers = useChatUsers(addQuery, addOpen);

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

  // URL dagi chat sizga tegishli emas bo‘lsa — tozalash
  useEffect(() => {
    if (!list.data || !selectedId) return;
    const found = list.data.chats.some((c) => c.id === selectedId);
    if (!found && !list.isLoading) {
      setSelectedId(null);
      setMobileShowChat(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("id");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
    }
  }, [list.data, list.isLoading, selectedId]);

  const chats = list.data?.chats ?? [];
  const filteredChats = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return chats.filter((c) => {
      if (listFilter === "direct" && c.type !== "direct") return false;
      if (listFilter === "group" && c.type !== "group") return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        (c.lastMessage?.content || "").toLowerCase().includes(q) ||
        c.members.some((m) => m.fullName.toLowerCase().includes(q))
      );
    });
  }, [chats, listQuery, listFilter]);

  const activeChat: ChatListItem | undefined = chats.find((c) => c.id === selectedId);

  const addableUsers = useMemo(() => {
    const memberIds = new Set(activeChat?.members.map((m) => m.id) ?? []);
    return (addUsers.data?.users ?? []).filter((u) => !memberIds.has(u.id));
  }, [addUsers.data?.users, activeChat?.members]);

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

  const toggleAddPick = (u: ChatUser) => {
    setAddPicked((prev) => {
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
        toast({
          title: res.chat.existing ? "Shaxsiy chat" : "Yangi shaxsiy chat",
          description: "Faqat ikkingiz ko‘rasiz",
        });
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
        toast({
          title: "Guruh ochildi",
          description: "Faqat qo‘shilgan a’zolar ko‘radi",
        });
      }
    } catch (e) {
      toast({
        title: "Xatolik",
        description: e instanceof Error ? e.message : "Chat ochilmadi",
        variant: "destructive",
      });
    }
  };

  const submitAddMembers = async () => {
    if (!addPicked.length || !selectedId) return;
    try {
      await addMembers.mutateAsync(addPicked.map((p) => p.id));
      setAddOpen(false);
      setAddPicked([]);
      setAddQuery("");
      toast({
        title: "A’zolar qo‘shildi",
        description: `${addPicked.length} kishi guruhga qo‘shildi`,
      });
      void list.refetch();
    } catch (e) {
      toast({
        title: "Xatolik",
        description: e instanceof Error ? e.message : "Qo‘shib bo‘lmadi",
        variant: "destructive",
      });
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
      toast({
        title: "Yuborilmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  };

  const meId = user?.id;
  const directCount = chats.filter((c) => c.type === "direct").length;
  const groupCount = chats.filter((c) => c.type === "group").length;

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

          <div className="flex gap-1.5 mb-3">
            {(
              [
                { id: "all", label: "Barchasi", count: chats.length },
                { id: "direct", label: "Shaxsiy", count: directCount },
                { id: "group", label: "Guruh", count: groupCount },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setListFilter(tab.id)}
                className={cn(
                  "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
                  listFilter === tab.id
                    ? tab.id === "group"
                      ? "bg-[#6C5CE7] text-white"
                      : "bg-[#2AABEE] text-white"
                    : "bg-[#242f3d] text-[#8b9aab] hover:text-white",
                )}
              >
                {tab.label}
                <span className="ml-1 opacity-80">{tab.count}</span>
              </button>
            ))}
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
              <p className="text-xs mt-1">
                Shaxsiy suhbat yoki guruh oching — faqat a’zolar ko‘radi
              </p>
            </div>
          )}
          {filteredChats.map((c) => {
            const active = c.id === selectedId;
            const isGroup = c.type === "group";
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openChat(c.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-3 text-left transition-colors border-b border-[#1c2733]/60",
                  active ? "bg-[#2b5278]/50" : "hover:bg-[#202b36]",
                  isGroup && "border-l-2 border-l-[#6C5CE7]",
                  !isGroup && "border-l-2 border-l-transparent",
                )}
              >
                {isGroup ? (
                  <GroupAvatar />
                ) : (
                  <AvatarBubble name={c.title} tint={tintForId(c.peer?.id || c.id)} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium truncate">{c.title}</span>
                      <TypeBadge type={c.type} />
                    </div>
                    <span className="text-[11px] text-[#6c7a89] shrink-0">
                      {formatTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-xs text-[#8b9aab] truncate">
                      {isGroup
                        ? c.lastMessage?.content ||
                          `${c.memberCount ?? c.members.length} a’zo · faqat guruh`
                        : c.lastMessage?.content || "Shaxsiy suhbat · faqat ikkingiz"}
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
            <p className="text-xs mt-2 max-w-sm text-center">
              Shaxsiy chat — faqat 2 kishi. Guruh — faqat qo‘shilgan a’zolar.
            </p>
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
                <GroupAvatar size="sm" />
              ) : (
                <AvatarBubble
                  name={activeChat.title}
                  size="sm"
                  tint={tintForId(activeChat.peer?.id || activeChat.id)}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate leading-tight">{activeChat.title}</p>
                  <TypeBadge type={activeChat.type} />
                </div>
                <button
                  type="button"
                  className="text-[11px] text-[#8b9aab] truncate hover:text-[#2AABEE]"
                  onClick={() => {
                    if (activeChat.type === "group") setMembersOpen(true);
                  }}
                >
                  {activeChat.type === "group"
                    ? `${activeChat.members.length} a’zo · faqat guruh a’zolari`
                    : `${ROLE_LABELS[activeChat.peer?.role || ""] || activeChat.peer?.role || ""} · faqat ikkingiz`}
                </button>
              </div>
              {activeChat.type === "group" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1 border-[#6C5CE7]/50 bg-transparent text-[#C4B5FD] hover:bg-[#6C5CE7]/20"
                  onClick={() => {
                    setAddPicked([]);
                    setAddQuery("");
                    setAddOpen(true);
                  }}
                >
                  <UserPlus className="h-4 w-4" />
                  <span className="hidden sm:inline">A’zo</span>
                </Button>
              )}
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

          <div className="flex gap-2 mb-2">
            <Button
              type="button"
              className={cn(
                "flex-1 gap-1.5",
                newMode === "direct"
                  ? "bg-[#2AABEE] hover:bg-[#229ED9]"
                  : "border border-[#2b3a4a] bg-transparent text-white hover:bg-[#242f3d]",
              )}
              onClick={() => {
                setNewMode("direct");
                setPicked((p) => (p[0] ? [p[0]] : []));
              }}
            >
              <User className="h-4 w-4" />
              Shaxsiy
            </Button>
            <Button
              type="button"
              className={cn(
                "flex-1 gap-1.5",
                newMode === "group"
                  ? "bg-[#6C5CE7] hover:bg-[#5A4BD1]"
                  : "border border-[#2b3a4a] bg-transparent text-white hover:bg-[#242f3d]",
              )}
              onClick={() => setNewMode("group")}
            >
              <Users className="h-4 w-4" />
              Guruh
            </Button>
          </div>

          <p className="text-xs text-[#8b9aab] mb-3">
            {newMode === "direct"
              ? "Faqat siz va tanlangan xodim ko‘radi. Boshqalar bu suhbatni ko‘rmaydi."
              : "Faqat guruhga qo‘shilgan a’zolar ko‘radi. Keyin ham a’zo qo‘shish mumkin."}
          </p>

          {newMode === "group" && (
            <Input
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Guruh nomi *"
              className="mb-3 bg-[#242f3d] border-transparent text-white placeholder:text-[#6c7a89]"
            />
          )}

          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6c7a89]" />
            <Input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder={
                newMode === "direct" ? "Xodim tanlang..." : "A’zolarni tanlang..."
              }
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
                  className={cn(
                    "text-xs px-2 py-1 rounded-full border",
                    newMode === "group"
                      ? "bg-[#6C5CE7]/20 text-[#C4B5FD] border-[#6C5CE7]/40"
                      : "bg-[#2AABEE]/20 text-[#2AABEE] border-[#2AABEE]/40",
                  )}
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
              className={
                newMode === "group"
                  ? "bg-[#6C5CE7] hover:bg-[#5A4BD1]"
                  : "bg-[#2AABEE] hover:bg-[#229ED9]"
              }
              disabled={
                createChat.isPending ||
                !picked.length ||
                (newMode === "group" && !groupTitle.trim())
              }
              onClick={() => void submitNewChat()}
            >
              {createChat.isPending
                ? "..."
                : newMode === "group"
                  ? "Guruh ochish"
                  : "Suhbat boshlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add members to group */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md bg-[#17212b] text-white border-[#1c2733]">
          <DialogHeader>
            <DialogTitle>Guruhga a’zo qo‘shish</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-[#8b9aab] mb-3">
            Yangi a’zolar faqat shu guruhni ko‘radi. Shaxsiy chatlarga ta’sir qilmaydi.
          </p>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6c7a89]" />
            <Input
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder="Xodim qidirish..."
              className="pl-9 bg-[#242f3d] border-transparent text-white placeholder:text-[#6c7a89]"
            />
          </div>
          {addPicked.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {addPicked.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleAddPick(p)}
                  className="text-xs px-2 py-1 rounded-full bg-[#6C5CE7]/20 text-[#C4B5FD] border border-[#6C5CE7]/40"
                >
                  {p.fullName} ×
                </button>
              ))}
            </div>
          )}
          <div className="max-h-64 overflow-y-auto rounded-lg border border-[#1c2733] divide-y divide-[#1c2733]">
            {addableUsers.map((u) => {
              const selected = addPicked.some((p) => p.id === u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleAddPick(u)}
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
                  {selected && <Check className="h-4 w-4 text-[#6C5CE7]" />}
                </button>
              );
            })}
            {!addUsers.isLoading && addableUsers.length === 0 && (
              <p className="p-4 text-sm text-[#6c7a89] text-center">
                Qo‘shish uchun xodim qolmadi
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-[#2b3a4a] bg-transparent text-white hover:bg-[#242f3d]"
              onClick={() => setAddOpen(false)}
            >
              Bekor
            </Button>
            <Button
              type="button"
              className="bg-[#6C5CE7] hover:bg-[#5A4BD1]"
              disabled={!addPicked.length || addMembers.isPending}
              onClick={() => void submitAddMembers()}
            >
              {addMembers.isPending ? "..." : "Qo‘shish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Members list */}
      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent className="sm:max-w-sm bg-[#17212b] text-white border-[#1c2733]">
          <DialogHeader>
            <DialogTitle>Guruh a’zolari</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto divide-y divide-[#1c2733]">
            {(activeChat?.members ?? []).map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-2.5">
                <AvatarBubble name={m.fullName} size="sm" tint={tintForId(m.id)} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {m.fullName}
                    {m.id === meId ? " (siz)" : ""}
                  </p>
                  <p className="text-[11px] text-[#8b9aab]">
                    {ROLE_LABELS[m.role] || m.role}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
