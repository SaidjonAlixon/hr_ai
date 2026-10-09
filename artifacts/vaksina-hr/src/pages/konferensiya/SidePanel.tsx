import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Track, type Participant, type Room } from "livekit-client";
import {
  Copy,
  Crown,
  Hand,
  Loader2,
  MessageSquareOff,
  Mic,
  MicOff,
  MonitorUp,
  Search,
  SendHorizontal,
  ShieldCheck,
  UserCheck,
  Video,
  VideoOff,
  VolumeX,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CallAvatar } from "@/components/calls/CallLayer";
import { conferenceLink, copyText, type ChatMessage, type ConferenceMember } from "@/lib/conference/api";
import { ParticipantMenu, useModerate, useRoomUi } from "./Tile";
import { canPublish, displayName, handOf, hhmm, roleOf, userIdOf } from "./room-utils";

export function PanelShell({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Yopish"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- chat

export function ChatPanel({
  messages,
  onSend,
  enabled,
  meUid,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<boolean>;
  enabled: boolean;
  meUid: number;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    const ok = await onSend(t);
    setSending(false);
    if (ok) {
      setText("");
      stick.current = true;
    }
  };

  return (
    <>
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 [scrollbar-width:thin]"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
            <p className="text-sm font-medium">Hali xabar yo‘q</p>
            <p className="mt-1 text-xs">Savol yoki fikringizni shu yerda yozing — hamma ko‘radi.</p>
          </div>
        ) : (
          messages.map((m, i) => {
            const mine = m.userId === meUid;
            const grouped = i > 0 && messages[i - 1].userId === m.userId;
            return (
              <div key={m.id} className={cn("flex gap-2", mine && "flex-row-reverse", grouped && "-mt-2")}>
                {grouped ? <div className="w-8 shrink-0" /> : <CallAvatar id={m.userId} name={m.name} className="h-8 w-8 text-[11px]" />}
                <div className={cn("min-w-0 max-w-[80%]", mine && "text-right")}>
                  {!grouped ? (
                    <p className="mb-0.5 truncate text-[11px] font-medium text-muted-foreground">
                      {mine ? "Siz" : m.name} · {hhmm(m.at)}
                    </p>
                  ) : null}
                  <div
                    className={cn(
                      "inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-sm",
                      mine ? "rounded-tr-md bg-primary text-primary-foreground" : "rounded-tl-md bg-muted",
                    )}
                  >
                    {m.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="shrink-0 border-t p-3">
        {enabled ? (
          <div className="flex items-end gap-2 rounded-2xl border bg-muted/40 p-1.5 focus-within:ring-2 focus-within:ring-primary/30">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Xabar yozing…"
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
            />
            <button
              type="button"
              disabled={!text.trim() || sending}
              onClick={() => void send()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
              aria-label="Yuborish"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
            </button>
          </div>
        ) : (
          <p className="flex items-center justify-center gap-2 rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            <MessageSquareOff className="h-4 w-4" /> Tashkilotchi chatni o‘chirgan
          </p>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- ishtirokchilar

function StatusIcons({ p }: { p: Participant }) {
  const mic = p.getTrackPublication(Track.Source.Microphone);
  const micOn = Boolean(mic && !mic.isMuted);
  const speaks = canPublish(p, Track.Source.Microphone);
  return (
    <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
      {p.isScreenShareEnabled ? <MonitorUp className="h-4 w-4 text-sky-500" /> : null}
      {p.isCameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4 opacity-40" />}
      {!speaks ? (
        <VolumeX className="h-4 w-4 text-red-400" aria-label="Gapirish taqiqlangan" />
      ) : micOn ? (
        <Mic className={cn("h-4 w-4", p.isSpeaking && "text-emerald-500")} />
      ) : (
        <MicOff className="h-4 w-4 text-red-500" />
      )}
    </div>
  );
}

function RoleBadge({ p }: { p: Participant }) {
  const role = roleOf(p);
  if (role === "participant") return null;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
      <Crown className="h-3 w-3" />
      {role === "host" ? "Tashkilotchi" : "Yordamchi"}
    </span>
  );
}

function PersonRow({ p, extra }: { p: Participant; extra?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-muted/60">
      <div className="relative">
        <CallAvatar id={userIdOf(p)} name={displayName(p)} className="h-9 w-9 text-xs" />
        {p.isSpeaking ? <span className="absolute -inset-0.5 rounded-full ring-2 ring-emerald-400" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {displayName(p)}
          {p.isLocal ? <span className="text-muted-foreground"> (siz)</span> : null}
        </p>
        <RoleBadge p={p} />
      </div>
      {extra}
      <StatusIcons p={p} />
      <ParticipantMenu participant={p} />
    </div>
  );
}

export function PeoplePanel({
  room,
  tick,
  members,
}: {
  room: Room;
  tick: number;
  /** Faqat tashkilotchiga: taklif qilinganlar va chiqarilganlar */
  members: ConferenceMember[] | undefined;
}) {
  const ui = useRoomUi();
  const { toast } = useToast();
  const mod = useModerate();
  const [q, setQ] = useState("");
  void tick;

  const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  const query = q.trim().toLowerCase();
  const match = (name: string) => !query || name.toLowerCase().includes(query);
  const visible = all.filter((p) => match(displayName(p)));
  const hands = visible.filter((p) => handOf(p) > 0).sort((a, b) => handOf(a) - handOf(b));
  const hosts = visible.filter((p) => roleOf(p) !== "participant");
  const others = visible.filter((p) => roleOf(p) === "participant").sort((a, b) => displayName(a).localeCompare(displayName(b), "uz"));
  const inRoom = new Set(all.map(userIdOf));
  const notJoined = useMemo(
    () => (members ?? []).filter((m) => m.invited && !m.banned && !inRoom.has(m.userId) && match(m.fullName)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, tick, query],
  );
  const banned = (members ?? []).filter((m) => m.banned);

  return (
    <>
      <div className="shrink-0 space-y-2 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ishtirokchini qidirish…" className="h-10 rounded-xl pl-9" />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              if (await copyText(conferenceLink(ui.code))) toast({ title: "Taklif havolasi nusxalandi" });
            }}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition hover:bg-muted"
          >
            <Copy className="h-3.5 w-3.5" /> Havola
          </button>
          {ui.moderator ? (
            <button
              type="button"
              onClick={async () => {
                const out = await mod("mute-all");
                if (out) toast({ title: `${out.count ?? 0} kishining mikrofoni o‘chirildi` });
              }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100 dark:bg-red-500/10"
            >
              <MicOff className="h-3.5 w-3.5" /> Hammani ovozsiz
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2 [scrollbar-width:thin]">
        {hands.length ? (
          <div>
            <p className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600">
              <Hand className="h-3.5 w-3.5" /> Qo‘l ko‘targanlar · {hands.length}
            </p>
            {hands.map((p) => (
              <PersonRow
                key={`h-${p.identity}`}
                p={p}
                extra={
                  ui.moderator && !p.isLocal ? (
                    <button
                      type="button"
                      onClick={() => void mod("unmute", userIdOf(p), `${displayName(p)} ga so‘z berildi`)}
                      className="shrink-0 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700"
                    >
                      So‘z berish
                    </button>
                  ) : null
                }
              />
            ))}
          </div>
        ) : null}
        {hosts.length ? (
          <div>
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tashkilotchilar · {hosts.length}</p>
            {hosts.map((p) => (
              <PersonRow key={p.identity} p={p} />
            ))}
          </div>
        ) : null}
        <div>
          <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ishtirokchilar · {others.length}</p>
          {others.length ? (
            others.map((p) => <PersonRow key={p.identity} p={p} />)
          ) : (
            <p className="px-2 py-3 text-xs text-muted-foreground">Hozircha boshqa ishtirokchi yo‘q</p>
          )}
        </div>
        {ui.moderator && notJoined.length ? (
          <div>
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Hali kirmaganlar · {notJoined.length}</p>
            {notJoined.map((m) => (
              <div key={m.userId} className="flex items-center gap-2.5 rounded-xl px-2 py-2 opacity-70">
                <CallAvatar id={m.userId} name={m.fullName} className="h-9 w-9 text-xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.fullName}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{m.position || "Taklif qilingan"}</p>
                </div>
                {m.role === "cohost" ? <Crown className="h-4 w-4 text-amber-500" /> : null}
                {m.canSpeak === false ? <VolumeX className="h-4 w-4 text-red-400" /> : m.canSpeak ? <ShieldCheck className="h-4 w-4 text-emerald-500" /> : null}
              </div>
            ))}
          </div>
        ) : null}
        {ui.moderator && banned.length ? (
          <div>
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-red-500">Chiqarilganlar · {banned.length}</p>
            {banned.map((m) => (
              <div key={m.userId} className="flex items-center gap-2.5 rounded-xl px-2 py-2">
                <CallAvatar id={m.userId} name={m.fullName} className="h-9 w-9 text-xs grayscale" />
                <p className="min-w-0 flex-1 truncate text-sm">{m.fullName}</p>
                <button
                  type="button"
                  onClick={() => void mod("unban", m.userId, "Qayta kirishga ruxsat berildi")}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition hover:bg-muted"
                >
                  <UserCheck className="h-3.5 w-3.5" /> Qaytarish
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

export function useUnread(active: boolean, count: number): number {
  const [seen, setSeen] = useState(count);
  useEffect(() => {
    if (active) setSeen(count);
  }, [active, count]);
  return Math.max(0, count - seen);
}
