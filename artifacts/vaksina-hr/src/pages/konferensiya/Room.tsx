import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ConnectionQuality,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  supportsAudioOutputSelection,
  type Participant,
  type RemoteParticipant,
} from "livekit-client";
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Hand,
  LayoutGrid,
  Loader2,
  LogOut,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  Minimize,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Presentation,
  RefreshCw,
  Settings2,
  Signal,
  Star,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/components/calls/CallLayer";
import {
  conferenceApi,
  conferenceLink,
  copyText,
  type ChatMessage,
  type ConfSettings,
  type ConferenceDetails,
} from "@/lib/conference/api";
import { Segmented, ToggleRow } from "../qongiroq/ConferenceForm";
import { RotateLinkDialog } from "../qongiroq/RotateLinkDialog";
import { mediaErrorText } from "./PreJoin";
import { AudioRenderer, RoomUiContext, VideoTile, tileKey, type RoomUi, type TileSource } from "./Tile";
import { ChatPanel, PanelShell, PeoplePanel, useUnread } from "./SidePanel";
import {
  bestGrid,
  canPublish,
  canShareScreen,
  displayName,
  handOf,
  isMod,
  parseRoomMeta,
  useElementSize,
  useMediaQuery,
  useRoomTick,
  userIdOf,
} from "./room-utils";

type TileRef = { p: Participant; source: TileSource };

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="font-mono tabular-nums">{formatDuration((now - since) / 1000)}</span>;
}

function NetworkBadge({ q }: { q: ConnectionQuality }) {
  const map: Partial<Record<ConnectionQuality, { text: string; cls: string }>> = {
    [ConnectionQuality.Excellent]: { text: "A’lo", cls: "text-emerald-300" },
    [ConnectionQuality.Good]: { text: "Yaxshi", cls: "text-emerald-300" },
    [ConnectionQuality.Poor]: { text: "Sust internet", cls: "text-amber-300 bg-amber-500/15" },
    [ConnectionQuality.Lost]: { text: "Aloqa yo‘q", cls: "text-red-300 bg-red-500/15" },
  };
  const m = map[q];
  if (!m) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-2 py-0.5", m.cls)} title="Sizning internet aloqangiz">
      <Signal className="h-3 w-3" />
      <span className="hidden sm:inline">{m.text}</span>
    </span>
  );
}

function CtrlButton({
  active = true,
  danger,
  disabled,
  onClick,
  icon,
  label,
  badge,
  highlight,
  title,
}: {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  icon: ReactNode;
  label: string;
  badge?: number;
  highlight?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      className={cn(
        "group relative flex flex-col items-center gap-1 rounded-2xl px-2 py-1.5 text-[11px] font-medium text-white/80 transition active:scale-95 sm:px-3",
        disabled && "opacity-45",
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full transition sm:h-12 sm:w-12",
          danger
            ? "bg-red-500 text-white hover:bg-red-600"
            : highlight
              ? "bg-sky-500 text-white hover:bg-sky-600"
              : active
                ? "bg-white/10 hover:bg-white/20"
                : "bg-red-500/90 text-white hover:bg-red-500",
        )}
      >
        {icon}
      </span>
      <span className="hidden whitespace-nowrap sm:block">{label}</span>
      {badge ? (
        <span className="absolute right-1 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-slate-950 sm:right-2">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

function DeviceMenu({ room, kind }: { room: Room; kind: "audioinput" | "videoinput" }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const load = async () => {
    setDevices(await Room.getLocalDevices(kind, false).catch(() => []));
    if (kind === "audioinput" && supportsAudioOutputSelection()) {
      setOutputs(await Room.getLocalDevices("audiooutput", false).catch(() => []));
    }
  };
  const active = room.getActiveDevice(kind);
  const activeOut = room.getActiveDevice("audiooutput");
  return (
    <DropdownMenu onOpenChange={(o) => o && void load()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Qurilmani tanlash"
          className="absolute -right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white ring-2 ring-slate-950 transition hover:bg-slate-600 sm:flex"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="w-72">
        <DropdownMenuLabel>{kind === "audioinput" ? "Mikrofon" : "Kamera"}</DropdownMenuLabel>
        {devices.length === 0 ? <p className="px-2 py-1.5 text-xs text-muted-foreground">Qurilma topilmadi</p> : null}
        {devices.map((d, i) => (
          <DropdownMenuItem key={d.deviceId} onClick={() => void room.switchActiveDevice(kind, d.deviceId)} className="gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", d.deviceId === active ? "bg-emerald-500" : "bg-transparent")} />
            <span className="truncate">{d.label || `${kind === "audioinput" ? "Mikrofon" : "Kamera"} ${i + 1}`}</span>
          </DropdownMenuItem>
        ))}
        {outputs.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Karnay</DropdownMenuLabel>
            {outputs.map((d, i) => (
              <DropdownMenuItem key={d.deviceId} onClick={() => void room.switchActiveDevice("audiooutput", d.deviceId)} className="gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", d.deviceId === activeOut ? "bg-emerald-500" : "bg-transparent")} />
                <span className="truncate">{d.label || `Karnay ${i + 1}`}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  code,
  settings,
  onRotateLink,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  code: string;
  settings: ConfSettings;
  onRotateLink?: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(settings);
  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);
  const save = async (patch: Partial<ConfSettings>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    try {
      await conferenceApi.settings(code, next);
    } catch (e) {
      setDraft(draft);
      toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" });
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Konferensiya boshqaruvi</DialogTitle>
          <DialogDescription>O‘zgarishlar darhol hamma ishtirokchilarga qo‘llanadi.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Kim gapira oladi</span>
            <Segmented
              value={draft.speakMode}
              onChange={(v) => void save({ speakMode: v })}
              options={[
                ["all", "Hamma"],
                ["selected", "Faqat ruxsat berilganlar"],
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Kamera yoqish</span>
            <Segmented
              value={draft.cameraMode}
              onChange={(v) => void save({ cameraMode: v })}
              options={[
                ["all", "Hamma"],
                ["speakers", "Faqat gapiruvchilar"],
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Ekran ulashish</span>
            <Segmented
              value={draft.screenMode}
              onChange={(v) => void save({ screenMode: v })}
              options={[
                ["all", "Hamma"],
                ["speakers", "Gapiruvchilar"],
                ["hosts", "Faqat tashkilotchi"],
              ]}
            />
          </div>
          <div className="divide-y rounded-2xl border px-3">
            <ToggleRow label="Chat" checked={draft.chat} onChange={(v) => void save({ chat: v })} />
            <ToggleRow label="Yangi kirganlar mikrofoni o‘chiq" checked={draft.muteOnJoin} onChange={(v) => void save({ muteOnJoin: v })} />
            <ToggleRow label="Yangi kirganlar kamerasi o‘chiq" checked={draft.camOffOnJoin} onChange={(v) => void save({ camOffOnJoin: v })} />
          </div>
          {onRotateLink ? (
            <button
              type="button"
              onClick={onRotateLink}
              className="flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition hover:bg-muted"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <RefreshCw className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Yangi havola yaratish</span>
                <span className="block text-xs text-muted-foreground">Eski havola darhol eskiradi, ichkaridagilar uzilmaydi</span>
              </span>
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const decoder = new TextDecoder();

export function ConferenceRoom({
  room,
  code,
  details,
  onLeave,
  onEnded,
  onCodeChanged,
}: {
  room: Room;
  code: string;
  details: ConferenceDetails;
  onLeave: (endForAll: boolean) => Promise<void> | void;
  /** Tashkilotchi hamma uchun yakunladi */
  onEnded: () => void;
  /** Tashkilotchi yangi taklif havolasi yaratdi */
  onCodeChanged: (code: string) => void;
}) {
  const { toast } = useToast();
  const tick = useRoomTick(room);
  const local = room.localParticipant;
  const meta = parseRoomMeta(room.metadata);
  const settings = meta.settings ?? details.conference.settings;
  const moderator = isMod(local) || details.me.moderator;
  const owner = details.me.owner;
  const meUid = details.me.userId;
  const [panel, setPanel] = useState<null | "chat" | "people">(null);
  const [layout, setLayout] = useState<"auto" | "grid">("auto");
  const [localPin, setLocalPin] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [page, setPage] = useState(0);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const stageSize = useElementSize(stageEl);
  const desktop = useMediaQuery("(min-width: 1024px)");
  const wide = useMediaQuery("(min-width: 1400px)");
  const tablet = useMediaQuery("(min-width: 640px)");
  const joinedAt = useRef(Date.now()).current;
  const since = details.conference.startedAt ? new Date(details.conference.startedAt).getTime() : joinedAt;

  const membersQ = useQuery({
    queryKey: ["conference", code],
    queryFn: () => conferenceApi.details(code),
    enabled: moderator && panel === "people",
    refetchInterval: 20_000,
  });

  // ---------------------------------------------------------- chat va moderatsiya xabarlari
  useEffect(() => {
    let alive = true;
    conferenceApi
      .messages(code)
      .then(({ items }) => {
        if (!alive) return;
        setMessages((prev) => {
          const ids = new Set(items.map((m) => m.id));
          return [...items, ...prev.filter((m) => !ids.has(m.id))];
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [code]);

  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onCodeChangedRef = useRef(onCodeChanged);
  onCodeChangedRef.current = onCodeChanged;
  const [rotateOpen, setRotateOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);

  const enableMic = useCallback(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        return true;
      } catch (e) {
        if ((e as { name?: string })?.name === "NotAllowedError") {
          toast({ title: "Mikrofon yoqilmadi", description: mediaErrorText(e), variant: "destructive" });
          return false;
        }
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    toast({ title: "Mikrofon yoqilmadi", description: "Qayta urinib ko‘ring", variant: "destructive" });
    return false;
  }, [room, toast]);

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      // Faqat serverdan kelgan xabarlar (jo‘natuvchisi yo‘q) — ishtirokchi soxtalashtira olmaydi
      if (participant) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(decoder.decode(payload));
      } catch {
        return;
      }
      if (topic === "chat") {
        const msg = data as unknown as ChatMessage;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        return;
      }
      if (topic !== "mod") return;
      const lp = room.localParticipant;
      switch (data.type) {
        case "mute":
          void lp.setMicrophoneEnabled(false);
          toast({ title: "Tashkilotchi mikrofoningizni o‘chirdi" });
          break;
        case "unmute":
          void enableMic().then((ok) => ok && toast({ title: "Sizga so‘z berildi", description: "Mikrofoningiz yoqildi" }));
          break;
        case "camera-off":
          void lp.setCameraEnabled(false);
          toast({ title: "Tashkilotchi kamerangizni o‘chirdi" });
          break;
        case "screen-off":
          void lp.setScreenShareEnabled(false);
          toast({ title: "Tashkilotchi ekran ulashishni to‘xtatdi" });
          break;
        case "speak-granted":
          toast({ title: "Sizga gapirish ruxsati berildi", description: "Mikrofon tugmasini bosib gapiring" });
          break;
        case "speak-revoked":
          void lp.setMicrophoneEnabled(false);
          toast({ title: "Gapirish ruxsati olindi" });
          break;
        case "cohost-granted":
          toast({ title: "Siz yordamchi tashkilotchi bo‘ldingiz" });
          break;
        case "ended":
          onEndedRef.current();
          break;
        case "link-changed":
          if (typeof data.code === "string") {
            onCodeChangedRef.current(data.code);
            toast({ title: "Taklif havolasi yangilandi", description: "Eski havola endi ishlamaydi" });
          }
          break;
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, toast, enableMic]);

  // Tashkilotchiga: kim qo‘l ko‘tardi
  const prevHands = useRef(new Map<string, number>());
  useEffect(() => {
    for (const p of room.remoteParticipants.values()) {
      const h = handOf(p);
      const prev = prevHands.current.get(p.identity) ?? 0;
      if (moderator && h && h !== prev) toast({ title: `✋ ${displayName(p)} qo‘l ko‘tardi` });
      prevHands.current.set(p.identity, h);
    }
  }, [tick, room, moderator, toast]);

  // Ekran o‘chmasin
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof lock> } }).wakeLock?.request("screen") ?? null;
      } catch {
        lock = null;
      }
    };
    void request();
    const onVis = () => document.visibilityState === "visible" && void request();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const on = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  // ---------------------------------------------------------- boshqaruv
  const micOn = local.isMicrophoneEnabled;
  const camOn = local.isCameraEnabled;
  const screenOn = local.isScreenShareEnabled;
  const handUp = handOf(local) > 0;
  const mayMic = canPublish(local, Track.Source.Microphone);
  const mayCam = canPublish(local, Track.Source.Camera);
  const mayScreen = canPublish(local, Track.Source.ScreenShare) && canShareScreen();

  const toggleMic = async () => {
    if (!mayMic) {
      toast({ title: "Gapirish uchun ruxsat yo‘q", description: "«Qo‘l ko‘tarish» tugmasini bosing — tashkilotchi so‘z beradi." });
      return;
    }
    try {
      await local.setMicrophoneEnabled(!micOn);
    } catch (e) {
      toast({ title: "Mikrofon", description: mediaErrorText(e), variant: "destructive" });
    }
  };
  const toggleCam = async () => {
    if (!mayCam) {
      toast({ title: "Kamera yoqish uchun ruxsat yo‘q" });
      return;
    }
    try {
      await local.setCameraEnabled(!camOn);
    } catch (e) {
      toast({ title: "Kamera", description: mediaErrorText(e), variant: "destructive" });
    }
  };
  const toggleScreen = async () => {
    if (!mayScreen) {
      toast({
        title: canShareScreen() ? "Ekran ulashishga ruxsat yo‘q" : "Bu qurilmada ekran ulashib bo‘lmaydi",
        description: canShareScreen() ? "Tashkilotchidan so‘rang." : "Kompyuterdagi Chrome yoki Edge’dan foydalaning.",
      });
      return;
    }
    try {
      // systemAudio: exclude — aks holda butun kompyuter ovozi (boshqalarning ovozi ham) qayta yuborilib, aks-sado bo‘ladi.
      // Konferensiya oynasining o‘zi ro‘yxatda chiqmaydi (cheksiz ko‘zgu bo‘lmasin).
      await local.setScreenShareEnabled(!screenOn, {
        audio: true,
        systemAudio: "exclude",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        suppressLocalAudioPlayback: false,
        contentHint: "detail",
      });
    } catch (e) {
      if ((e as { name?: string })?.name !== "NotAllowedError") {
        toast({ title: "Ekran ulashilmadi", description: (e as Error).message, variant: "destructive" });
      }
    }
  };
  const toggleHand = async () => {
    try {
      await conferenceApi.hand(code, !handUp);
      if (!handUp) toast({ title: "Qo‘lingiz ko‘tarildi", description: "Tashkilotchi ko‘radi va so‘z beradi" });
    } catch (e) {
      toast({ title: "Bajarilmadi", description: (e as Error).message, variant: "destructive" });
    }
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "m" || e.key === "M") void toggleMic();
      if (e.key === "v" || e.key === "V") void toggleCam();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sendChat = async (text: string) => {
    try {
      const { message } = await conferenceApi.send(code, text);
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      return true;
    } catch (e) {
      toast({ title: "Yuborilmadi", description: (e as Error).message, variant: "destructive" });
      return false;
    }
  };

  const othersMessages = messages.filter((m) => m.userId !== meUid).length;
  const unread = useUnread(panel === "chat", othersMessages);

  // ---------------------------------------------------------- sahna
  const participants: Participant[] = [local, ...room.remoteParticipants.values()];
  const perPage = wide ? 25 : desktop ? 16 : tablet ? 9 : 6;
  const byUid = (uid: number) => participants.find((p) => userIdOf(p) === uid);

  const spot = meta.spotlight;
  const spotP = spot ? byUid(spot.userId) : undefined;
  // Ekran ulashayotgan bo‘lsa — ekrani, aks holda kamerasi (tashkilotchi «kamera» desa — doim kamera)
  const spotTile: TileRef | null = spotP
    ? { p: spotP, source: spot?.source !== "camera" && spotP.isScreenShareEnabled ? "screen" : "camera" }
    : null;
  // Boshqalarning ekrani birinchi: o‘z ekranini ulashayotgan odamga boshqa taqdimot bo‘lsa — o‘sha kattalashadi
  const screenTiles: TileRef[] = participants
    .filter((p) => p.isScreenShareEnabled)
    .sort((a, b) => Number(a.isLocal) - Number(b.isLocal))
    .map((p) => ({ p, source: "screen" }));
  const pinTile: TileRef | null = (() => {
    if (!localPin) return null;
    const [identity, source] = localPin.split(":");
    const p = participants.find((x) => x.identity === identity);
    if (!p) return null;
    if (source === "screen" && !p.isScreenShareEnabled) return null;
    return { p, source: source as TileSource };
  })();
  const focus: TileRef | null = spotTile ?? pinTile ?? (layout === "auto" ? screenTiles[0] ?? null : null);

  const remotes = participants.slice(1);
  const orderedRemotes =
    remotes.length + 1 > perPage
      ? [...remotes].sort((a, b) => (b.lastSpokeAt?.getTime() ?? 0) - (a.lastSpokeAt?.getTime() ?? 0))
      : remotes;
  const camTiles: TileRef[] = [local, ...orderedRemotes].map((p) => ({ p, source: "camera" }));

  const gridTiles = focus ? [] : [...screenTiles, ...camTiles];
  const pages = Math.max(1, Math.ceil(gridTiles.length / perPage));
  const curPage = Math.min(page, pages - 1);
  const pageTiles = gridTiles.slice(curPage * perPage, curPage * perPage + perPage);
  const grid = bestGrid(pageTiles.length, stageSize.width, stageSize.height, 8);

  const stripTiles = focus ? [...screenTiles, ...camTiles].filter((t) => tileKey(t.p, t.source) !== tileKey(focus.p, focus.source)) : [];

  const ui: RoomUi = useMemo(
    () => ({
      code,
      room,
      moderator,
      owner,
      meUid,
      hostId: details.conference.host.id,
      spotlight: meta.spotlight,
      localPin,
      setLocalPin,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [code, room, moderator, owner, meUid, details.conference.host.id, meta.spotlight?.userId, meta.spotlight?.source, localPin],
  );

  const reconnecting = room.state === ConnectionState.Reconnecting || room.state === ConnectionState.SignalReconnecting;
  const audioBlocked = !room.canPlaybackAudio;
  const panelNode =
    panel === "chat" ? (
      <PanelShell title="Chat" onClose={() => setPanel(null)}>
        <ChatPanel messages={messages} onSend={sendChat} enabled={settings.chat || moderator} meUid={meUid} />
      </PanelShell>
    ) : panel === "people" ? (
      <PanelShell title={`Ishtirokchilar · ${participants.length}`} onClose={() => setPanel(null)}>
        <PeoplePanel room={room} tick={tick} members={membersQ.data?.members} />
      </PanelShell>
    ) : null;

  return (
    <RoomUiContext.Provider value={ui}>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-950 text-white">
        {/* Yuqori panel */}
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-gradient-to-b from-slate-900/80 to-slate-950 px-3 sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-sky-600 shadow-lg shadow-emerald-500/20 sm:flex">
              <Presentation className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold tracking-tight">{details.conference.title}</p>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/70">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  <Elapsed since={since} />
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-2 py-0.5">
                  <Users className="h-3 w-3" /> {participants.length}
                </span>
                <NetworkBadge q={local.connectionQuality} />
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={async () => {
                if (await copyText(conferenceLink(code))) toast({ title: "Taklif havolasi nusxalandi", description: conferenceLink(code) });
              }}
              className="hidden items-center gap-1.5 rounded-xl bg-white/[0.08] px-3 py-2 text-xs font-semibold ring-1 ring-white/10 transition hover:bg-white/15 sm:inline-flex"
            >
              <Copy className="h-3.5 w-3.5" /> Havola
            </button>
            <button
              type="button"
              onClick={() => {
                setLayout((l) => (l === "auto" ? "grid" : "auto"));
                setLocalPin(null);
              }}
              title={layout === "auto" ? "Hammani panjarada ko‘rsatish" : "Avtomatik (ekran ulashilsa kattalashadi)"}
              className={cn("flex h-9 w-9 items-center justify-center rounded-xl transition hover:bg-white/15", layout === "grid" && "bg-white/15")}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              title="To‘liq ekran"
              className="hidden h-9 w-9 items-center justify-center rounded-xl transition hover:bg-white/15 sm:flex"
            >
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
            {moderator ? (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                title="Boshqaruv sozlamalari"
                className="flex h-9 w-9 items-center justify-center rounded-xl transition hover:bg-white/15"
              >
                <Settings2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </header>

        {reconnecting ? (
          <div className="mx-3 mb-2 flex items-center justify-center gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-200 sm:mx-5">
            <WifiOff className="h-4 w-4" /> Aloqa uzildi — qayta ulanmoqda…
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </div>
        ) : null}
        {audioBlocked ? (
          <button
            type="button"
            onClick={() => void room.startAudio()}
            className="mx-3 mb-2 flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-3 py-2.5 text-sm font-semibold text-white shadow-lg sm:mx-5"
          >
            <Volume2 className="h-4 w-4" /> Ovozni eshitish uchun bosing
          </button>
        ) : null}

        <div className="flex min-h-0 flex-1">
          {/* Sahna */}
          <main className="relative flex min-w-0 flex-1 flex-col gap-2 px-2 pb-2 sm:px-4">
            {spotP ? (
              <div className="absolute left-1/2 top-1 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500/90 py-1 pl-3 pr-1 text-xs font-semibold text-white shadow-lg">
                <Star className="h-3.5 w-3.5" />
                <span className="max-w-[50vw] truncate">Asosiy ekran: {displayName(spotP)}</span>
                {moderator ? (
                  <button
                    type="button"
                    onClick={() => void conferenceApi.spotlight(code, null)}
                    className="rounded-full bg-black/25 px-2 py-0.5 text-[11px] transition hover:bg-black/40"
                  >
                    Bekor qilish
                  </button>
                ) : (
                  <span className="pr-2" />
                )}
              </div>
            ) : null}

            {focus ? (
              <div className={cn("flex min-h-0 flex-1 gap-2", desktop ? "flex-row" : "flex-col")}>
                <VideoTile key={tileKey(focus.p, focus.source)} participant={focus.p} source={focus.source} tick={tick} variant="main" className="min-h-0 flex-1" />
                {stripTiles.length ? (
                  <div
                    className={cn(
                      "flex shrink-0 gap-2 overflow-auto [scrollbar-width:thin]",
                      desktop ? "w-56 flex-col xl:w-64" : "h-24 flex-row sm:h-28",
                    )}
                  >
                    {stripTiles.map((t) => (
                      <VideoTile
                        key={tileKey(t.p, t.source)}
                        participant={t.p}
                        source={t.source}
                        tick={tick}
                        variant="strip"
                        className={cn("shrink-0 cursor-pointer", desktop ? "aspect-video w-full" : "h-full w-40 sm:w-48")}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div ref={setStageEl} className="relative min-h-0 flex-1">
                <div className="absolute inset-0 flex flex-wrap content-center items-center justify-center gap-2">
                  {pageTiles.map((t) => (
                    <VideoTile
                      key={tileKey(t.p, t.source)}
                      participant={t.p}
                      source={t.source}
                      tick={tick}
                      style={{ width: Math.floor(grid.tileW), height: Math.floor(grid.tileH) }}
                    />
                  ))}
                </div>
                {pages > 1 ? (
                  <>
                    <button
                      type="button"
                      disabled={curPage === 0}
                      onClick={() => setPage(curPage - 1)}
                      className="absolute left-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 backdrop-blur transition hover:bg-black/70 disabled:opacity-0"
                      aria-label="Oldingi sahifa"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      disabled={curPage >= pages - 1}
                      onClick={() => setPage(curPage + 1)}
                      className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 backdrop-blur transition hover:bg-black/70 disabled:opacity-0"
                      aria-label="Keyingi sahifa"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur">
                      {curPage + 1} / {pages}
                    </span>
                  </>
                ) : null}
              </div>
            )}
          </main>

          {/* Yon panel: kompyuterda yonida, telefonda ustida */}
          {panelNode ? (
            desktop ? (
              <aside className="dark mb-2 mr-4 w-[360px] shrink-0 overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-black/40">
                {panelNode}
              </aside>
            ) : (
              <div className="dark fixed inset-0 z-40 flex flex-col">{panelNode}</div>
            )
          ) : null}
        </div>

        {/* Boshqaruv paneli */}
        <footer className="flex shrink-0 justify-center px-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-1">
          <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[28px] border border-white/10 bg-slate-900/90 px-1.5 py-1 shadow-2xl shadow-black/50 backdrop-blur [scrollbar-width:none] sm:gap-1 sm:px-3">
          <div className="relative">
            <CtrlButton
              active={micOn}
              disabled={!mayMic}
              onClick={() => void toggleMic()}
              icon={!mayMic ? <VolumeX className="h-5 w-5" /> : micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              label={!mayMic ? "Ruxsat yo‘q" : micOn ? "Ovoz" : "Ovoz o‘chiq"}
              title="Mikrofon (M)"
            />
            {mayMic ? <DeviceMenu room={room} kind="audioinput" /> : null}
          </div>
          <div className="relative">
            <CtrlButton
              active={camOn}
              disabled={!mayCam}
              onClick={() => void toggleCam()}
              icon={camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              label={camOn ? "Kamera" : "Kamera o‘chiq"}
              title="Kamera (V)"
            />
            {mayCam ? <DeviceMenu room={room} kind="videoinput" /> : null}
          </div>
          {canShareScreen() ? (
            <CtrlButton
              highlight={screenOn}
              disabled={!mayScreen}
              onClick={() => void toggleScreen()}
              icon={screenOn ? <MonitorX className="h-5 w-5" /> : <MonitorUp className="h-5 w-5" />}
              label={screenOn ? "To‘xtatish" : "Ekran"}
            />
          ) : null}
          <CtrlButton
            highlight={handUp}
            onClick={() => void toggleHand()}
            icon={<Hand className="h-5 w-5" />}
            label={handUp ? "Qo‘lni tushirish" : "Qo‘l ko‘tarish"}
          />
          <CtrlButton
            highlight={panel === "chat"}
            onClick={() => setPanel((p) => (p === "chat" ? null : "chat"))}
            icon={<MessageSquare className="h-5 w-5" />}
            label="Chat"
            badge={panel === "chat" ? 0 : unread}
          />
          <CtrlButton
            highlight={panel === "people"}
            onClick={() => setPanel((p) => (p === "people" ? null : "people"))}
            icon={<Users className="h-5 w-5" />}
            label="Ishtirokchilar"
            badge={moderator ? participants.filter((p) => handOf(p) > 0).length : 0}
          />
          <div className="mx-1 h-9 w-px shrink-0 bg-white/10 sm:mx-2" />
          <div className="flex shrink-0 items-center gap-1.5 pr-0.5">
            <button
              type="button"
              onClick={() => onLeave(false)}
              title="Faqat o‘zim chiqaman — konferensiya davom etadi"
              className={cn(
                "flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-semibold text-white transition active:scale-95 sm:h-12 sm:px-4",
                moderator ? "bg-white/10 hover:bg-white/20" : "bg-red-500 shadow-lg shadow-red-500/30 hover:bg-red-600",
              )}
            >
              {moderator ? <LogOut className="h-5 w-5" /> : <PhoneOff className="h-5 w-5" />}
              <span className="hidden sm:inline">Chiqish</span>
            </button>
            {moderator ? (
              <button
                type="button"
                onClick={() => setEndOpen(true)}
                title="Konferensiyani hamma uchun yakunlash"
                className="flex h-11 items-center gap-2 rounded-full bg-red-500 px-3.5 text-sm font-semibold text-white shadow-lg shadow-red-500/30 transition hover:bg-red-600 active:scale-95 sm:h-12 sm:px-4"
              >
                <PhoneOff className="h-5 w-5" />
                <span className="hidden md:inline">Hamma uchun yakunlash</span>
                <span className="hidden sm:inline md:hidden">Yakunlash</span>
              </button>
            ) : null}
          </div>
          </div>
        </footer>

        <AudioRenderer room={room} tick={tick} />
        {moderator ? (
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            code={code}
            settings={settings}
            onRotateLink={
              owner
                ? () => {
                    setSettingsOpen(false);
                    setRotateOpen(true);
                  }
                : undefined
            }
          />
        ) : null}
        {owner ? (
          <RotateLinkDialog
            code={code}
            title={details.conference.title}
            open={rotateOpen}
            onOpenChange={setRotateOpen}
            onRotated={(next) => onCodeChanged(next)}
          />
        ) : null}
        <AlertDialog open={endOpen} onOpenChange={(v) => !ending && setEndOpen(v)}>
          <AlertDialogContent className="max-w-md rounded-3xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Konferensiyani yakunlaysizmi?</AlertDialogTitle>
              <AlertDialogDescription>
                Konferensiya hamma uchun to‘liq tugaydi: barcha {participants.length} ishtirokchi chiqariladi va havola orqali qayta kirib
                bo‘lmaydi. Qatnashuv va chat tarixi saqlanib qoladi.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={ending}>Bekor qilish</AlertDialogCancel>
              <AlertDialogAction
                disabled={ending}
                onClick={(e) => {
                  e.preventDefault();
                  setEnding(true);
                  void Promise.resolve(onLeave(true)).finally(() => setEnding(false));
                }}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {ending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PhoneOff className="mr-2 h-4 w-4" />}
                Hamma uchun yakunlash
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </RoomUiContext.Provider>
  );
}
