import { createContext, memo, useContext, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  ConnectionQuality,
  Track,
  type Participant,
  type RemoteTrack,
  type Room,
  type TrackPublication,
} from "livekit-client";
import {
  Crown,
  Hand,
  Maximize2,
  Mic,
  MicOff,
  MonitorOff,
  MoreVertical,
  Pin,
  PinOff,
  ShieldCheck,
  ShieldOff,
  Star,
  StarOff,
  UserX,
  VideoOff,
  Volume2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CallAvatar } from "@/components/calls/CallLayer";
import { conferenceApi, type ModAction, type Spotlight } from "@/lib/conference/api";
import { canPublish, displayName, handOf, isMod, roleOf, userIdOf } from "./room-utils";

export type TileSource = "camera" | "screen";

export type RoomUi = {
  code: string;
  room: Room;
  moderator: boolean;
  owner: boolean;
  meUid: number;
  hostId: number;
  spotlight: Spotlight | null;
  localPin: string | null;
  setLocalPin: (key: string | null) => void;
};

export const RoomUiContext = createContext<RoomUi | null>(null);

export function useRoomUi(): RoomUi {
  const ctx = useContext(RoomUiContext);
  if (!ctx) throw new Error("RoomUiContext yo‘q");
  return ctx;
}

export function tileKey(p: Participant, source: TileSource) {
  return `${p.identity}:${source}`;
}

function videoPub(p: Participant, source: TileSource): TrackPublication | undefined {
  return p.getTrackPublication(source === "screen" ? Track.Source.ScreenShare : Track.Source.Camera);
}

function VideoView({ pub, mirror, contain }: { pub: TrackPublication; mirror: boolean; contain: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const track = pub.track;
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn("absolute inset-0 h-full w-full bg-black", contain ? "object-contain" : "object-cover", mirror && "-scale-x-100")}
    />
  );
}

function QualityBadge({ q }: { q: ConnectionQuality }) {
  if (q !== ConnectionQuality.Poor && q !== ConnectionQuality.Lost) return null;
  return (
    <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 backdrop-blur" title="Internet sust">
      {q === ConnectionQuality.Lost ? "Aloqa yo‘q" : "Sust aloqa"}
    </span>
  );
}

export const VideoTile = memo(function VideoTile({
  participant: p,
  source,
  tick,
  variant = "grid",
  className,
  style,
}: {
  participant: Participant;
  source: TileSource;
  /** Xona holati o‘zgarganda memo qayta chizsin */
  tick: number;
  variant?: "grid" | "main" | "strip";
  className?: string;
  style?: CSSProperties;
}) {
  const ui = useRoomUi();
  void tick;
  const pub = videoPub(p, source);
  const hasVideo = Boolean(pub?.track && !pub.isMuted);
  const micPub = p.getTrackPublication(Track.Source.Microphone);
  const micOn = Boolean(micPub && !micPub.isMuted);
  const role = roleOf(p);
  const hand = handOf(p) > 0;
  const uid = userIdOf(p);
  const key = tileKey(p, source);
  const spotlighted = ui.spotlight?.userId === uid;
  const pinned = ui.localPin === key;
  const name = displayName(p);
  const small = variant === "strip";

  return (
    <div
      style={style}
      onDoubleClick={() => ui.setLocalPin(pinned ? null : key)}
      className={cn(
        "group relative overflow-hidden rounded-2xl bg-slate-800 ring-1 ring-white/5 transition-shadow",
        p.isSpeaking && source === "camera" && "ring-2 ring-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.15)]",
        className,
      )}
    >
      {hasVideo && pub ? (
        <VideoView pub={pub} mirror={p.isLocal && source === "camera"} contain={source === "screen" || variant === "main"} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
          <div className="relative">
            {p.isSpeaking ? <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/30" /> : null}
            <CallAvatar
              id={uid}
              name={name}
              className={cn(small ? "h-10 w-10 text-sm" : variant === "main" ? "h-28 w-28 text-4xl" : "h-16 w-16 text-xl sm:h-20 sm:w-20 sm:text-2xl")}
            />
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1 p-2">
        <div className="flex flex-wrap gap-1">
          {spotlighted ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
              <Star className="h-3 w-3" /> Asosiy
            </span>
          ) : null}
          {pinned && !spotlighted ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
              <Pin className="h-3 w-3" /> Qadalgan
            </span>
          ) : null}
          {hand ? (
            <span className="inline-flex animate-bounce items-center gap-1 rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">
              <Hand className="h-3 w-3" /> {small ? "" : "Qo‘l"}
            </span>
          ) : null}
        </div>
        <QualityBadge q={p.connectionQuality} />
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-2 pt-6">
        <span className="flex min-w-0 items-center gap-1.5 rounded-lg bg-black/40 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {source === "camera" ? (
            micOn ? (
              <Mic className={cn("h-3.5 w-3.5 shrink-0", p.isSpeaking ? "text-emerald-400" : "text-white/80")} />
            ) : (
              <MicOff className="h-3.5 w-3.5 shrink-0 text-red-400" />
            )
          ) : (
            <Maximize2 className="h-3.5 w-3.5 shrink-0 text-sky-300" />
          )}
          {role !== "participant" ? <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" /> : null}
          <span className="truncate">
            {source === "screen" ? `${name} — ekran` : name}
            {p.isLocal ? " (siz)" : ""}
          </span>
        </span>
        {!small ? (
          <div className="pointer-events-auto opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
            <ParticipantMenu participant={p} source={source} dark />
          </div>
        ) : null}
      </div>
    </div>
  );
});

/** Masofadagi ovozlar: mikrofon va ekran ovozi */
export function AudioRenderer({ room, tick }: { room: Room; tick: number }) {
  void tick;
  const tracks: RemoteTrack[] = [];
  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.audioTrackPublications.values()) {
      if (pub.track && pub.isSubscribed) tracks.push(pub.track as RemoteTrack);
    }
  }
  return (
    <div className="hidden">
      {tracks.map((t) => (
        <AudioEl key={t.sid} track={t} />
      ))}
    </div>
  );
}

function AudioEl({ track }: { track: RemoteTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <audio ref={ref} autoPlay />;
}

export function useModerate() {
  const ui = useRoomUi();
  const { toast } = useToast();
  return async (action: ModAction, userId?: number, okText?: string) => {
    try {
      const out = await conferenceApi.moderate(ui.code, action, userId);
      if (okText) toast({ title: okText });
      return out;
    } catch (e) {
      toast({ title: "Bajarilmadi", description: (e as Error).message, variant: "destructive" });
      return null;
    }
  };
}

function Item({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <DropdownMenuItem onClick={onClick} className={cn("gap-2", danger && "text-red-600 focus:text-red-600")}>
      {icon}
      {children}
    </DropdownMenuItem>
  );
}

/** Tashkilotchi amallari — plitkada ham, ishtirokchilar ro‘yxatida ham */
export function ParticipantMenu({ participant: p, source = "camera", dark }: { participant: Participant; source?: TileSource; dark?: boolean }) {
  const ui = useRoomUi();
  const { toast } = useToast();
  const mod = useModerate();
  const uid = userIdOf(p);
  const key = tileKey(p, source);
  const pinned = ui.localPin === key;
  const spotlighted = ui.spotlight?.userId === uid;
  const micPub = p.getTrackPublication(Track.Source.Microphone);
  const micOn = Boolean(micPub && !micPub.isMuted);
  const camOn = p.isCameraEnabled;
  const screenOn = p.isScreenShareEnabled;
  const speaks = canPublish(p, Track.Source.Microphone);
  const targetIsHost = uid === ui.hostId;
  const targetIsMod = isMod(p);
  const canManage = ui.moderator && !p.isLocal && !targetIsHost && (!targetIsMod || ui.owner);
  const hand = handOf(p) > 0;

  const setSpot = async (on: boolean) => {
    try {
      await conferenceApi.spotlight(ui.code, on ? uid : null, on ? (screenOn ? "screen" : "auto") : "auto");
      toast({ title: on ? `${displayName(p)} hammaga asosiy ekranda` : "Asosiy ekran bekor qilindi" });
    } catch (e) {
      toast({ title: "Bajarilmadi", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Amallar"
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg transition",
            dark ? "bg-black/40 text-white backdrop-blur-sm hover:bg-black/60" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate">{displayName(p)}</DropdownMenuLabel>
        <Item icon={pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />} onClick={() => ui.setLocalPin(pinned ? null : key)}>
          {pinned ? "Qadashni olish (faqat menda)" : "Menda kattalashtirish"}
        </Item>
        {ui.moderator ? (
          <Item icon={spotlighted ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />} onClick={() => void setSpot(!spotlighted)}>
            {spotlighted ? "Asosiy ekranni bekor qilish" : "Hammaga asosiy ekran qilish"}
          </Item>
        ) : null}
        {ui.moderator && hand && !p.isLocal ? (
          <Item icon={<Hand className="h-4 w-4" />} onClick={() => void mod("lower-hand", uid)}>
            Qo‘lini tushirish
          </Item>
        ) : null}
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            {micOn ? (
              <Item icon={<MicOff className="h-4 w-4" />} onClick={() => void mod("mute", uid, "Mikrofon o‘chirildi")}>
                Mikrofonini o‘chirish
              </Item>
            ) : (
              <Item icon={<Volume2 className="h-4 w-4" />} onClick={() => void mod("unmute", uid, "Mikrofon yoqish so‘raldi")}>
                So‘z berish (mikrofonni yoqish)
              </Item>
            )}
            {speaks ? (
              <Item icon={<ShieldOff className="h-4 w-4" />} onClick={() => void mod("revoke-speak", uid, "Gapirish taqiqlandi")}>
                Gapirishni taqiqlash
              </Item>
            ) : (
              <Item icon={<ShieldCheck className="h-4 w-4" />} onClick={() => void mod("allow-speak", uid, "Gapirishga ruxsat berildi")}>
                Gapirishga ruxsat berish
              </Item>
            )}
            {camOn ? (
              <Item icon={<VideoOff className="h-4 w-4" />} onClick={() => void mod("camera-off", uid, "Kamera o‘chirildi")}>
                Kamerasini o‘chirish
              </Item>
            ) : null}
            {screenOn ? (
              <Item icon={<MonitorOff className="h-4 w-4" />} onClick={() => void mod("screen-off", uid, "Ekran ulashish to‘xtatildi")}>
                Ekran ulashishni to‘xtatish
              </Item>
            ) : null}
            {ui.owner ? (
              targetIsMod ? (
                <Item icon={<Crown className="h-4 w-4" />} onClick={() => void mod("remove-cohost", uid, "Yordamchi huquqi olindi")}>
                  Yordamchilikdan olish
                </Item>
              ) : (
                <Item icon={<Crown className="h-4 w-4" />} onClick={() => void mod("make-cohost", uid, "Yordamchi tashkilotchi qilindi")}>
                  Yordamchi tashkilotchi qilish
                </Item>
              )
            ) : null}
            <DropdownMenuSeparator />
            <Item
              danger
              icon={<UserX className="h-4 w-4" />}
              onClick={() => {
                if (window.confirm(`${displayName(p)} konferensiyadan chiqarilsinmi? U qayta kira olmaydi.`)) {
                  void mod("kick", uid, "Chiqarib yuborildi");
                }
              }}
            >
              Chiqarib yuborish
            </Item>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
