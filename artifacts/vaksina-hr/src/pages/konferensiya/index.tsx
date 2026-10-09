import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  DisconnectReason,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPresets,
  isBrowserSupported,
} from "livekit-client";
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  CheckCircle2,
  Clock,
  Crown,
  Link2Off,
  Loader2,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  UserX,
  VideoOff,
  WifiOff,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ApiError,
  conferenceApi,
  formatDate,
  formatSpan,
  hhmmOf,
  rememberAfterLogin,
  type ConferenceDetails,
} from "@/lib/conference/api";
import { PreJoin, type JoinPrefs } from "./PreJoin";
import { ConferenceRoom } from "./Room";
import { canPublish } from "./room-utils";

type Phase = "prejoin" | "connecting" | "in" | "left" | "kicked" | "ended" | "lost" | "duplicate";

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-full bg-sky-600/15 blur-3xl" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function TopBar() {
  return (
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-4">
      <Link
        href="/qongiroq?tab=konferensiya"
        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Konferensiyalar
      </Link>
      <span className="text-sm font-semibold tracking-tight text-white/80">VAKSINA HR · Konferensiya</span>
    </div>
  );
}

function EndCard({
  icon,
  title,
  text,
  onRejoin,
  rejoinText = "Qayta kirish",
}: {
  icon: ReactNode;
  title: string;
  text: string;
  onRejoin?: () => void;
  rejoinText?: string;
}) {
  return (
    <div className="mx-auto mt-[12vh] flex max-w-md flex-col items-center px-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">{icon}</div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-white/65">{text}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {onRejoin ? (
          <button
            type="button"
            onClick={onRejoin}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-600"
          >
            <RefreshCw className="h-4 w-4" /> {rejoinText}
          </button>
        ) : null}
        <Link
          href="/qongiroq?tab=konferensiya"
          className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/20"
        >
          Konferensiyalar ro‘yxati
        </Link>
      </div>
    </div>
  );
}

type Tone = "red" | "amber" | "emerald" | "slate";

const TONES: Record<Tone, { ring: string; glow: string; icon: string; badge: string }> = {
  red: {
    ring: "border-red-500/30",
    glow: "from-red-500/15",
    icon: "bg-red-500/15 text-red-300 ring-red-400/30",
    badge: "bg-red-500/15 text-red-300 ring-red-400/30",
  },
  amber: {
    ring: "border-amber-500/30",
    glow: "from-amber-500/15",
    icon: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
    badge: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  },
  emerald: {
    ring: "border-emerald-500/30",
    glow: "from-emerald-500/15",
    icon: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
    badge: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  },
  slate: {
    ring: "border-white/10",
    glow: "from-white/5",
    icon: "bg-white/10 text-white/80 ring-white/15",
    badge: "bg-white/10 text-white/80 ring-white/15",
  },
};

/** Tugagan / bekor qilingan / eskirgan havola — kamera yoqilmaydi, faqat aniq holat */
function ClosedCard({
  tone,
  icon,
  badge,
  title,
  text,
  conf,
  actions,
}: {
  tone: Tone;
  icon: ReactNode;
  badge: string;
  title: string;
  text: string;
  conf?: ConferenceDetails["conference"];
  actions?: ReactNode;
}) {
  const t = TONES[tone];
  const start = conf ? new Date(conf.startedAt ?? conf.scheduledAt) : null;
  const planEnd = conf ? new Date(new Date(conf.scheduledAt).getTime() + conf.durationMin * 60_000) : null;
  const realEnd = conf?.endedAt ? new Date(conf.endedAt) : null;
  const lasted = conf?.startedAt && realEnd ? (realEnd.getTime() - new Date(conf.startedAt).getTime()) / 1000 : 0;
  return (
    <div className="mx-auto mt-[8vh] w-full max-w-md px-4 pb-10">
      <div className={cn("relative overflow-hidden rounded-[28px] border bg-slate-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur", t.ring)}>
        <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b to-transparent", t.glow)} />
        <div className="relative flex flex-col items-center text-center">
          <div className={cn("flex h-20 w-20 items-center justify-center rounded-full ring-1", t.icon)}>{icon}</div>
          <span className={cn("mt-4 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ring-1", t.badge)}>{badge}</span>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/65">{text}</p>
        </div>
        {conf && start ? (
          <div className="relative mt-6 space-y-2.5 rounded-2xl bg-white/[0.04] p-4 text-sm ring-1 ring-white/[0.06]">
            <p className="text-base font-semibold">{conf.title}</p>
            <p className="flex items-center gap-2 text-white/70">
              <CalendarDays className="h-4 w-4 shrink-0 text-white/45" />
              {formatDate(start, { weekday: true })}
            </p>
            <p className="flex items-center gap-2 tabular-nums text-white/70">
              <Clock className="h-4 w-4 shrink-0 text-white/45" />
              {realEnd && conf.startedAt
                ? `${hhmmOf(conf.startedAt)} – ${hhmmOf(realEnd)}`
                : `${hhmmOf(conf.scheduledAt)} – ${hhmmOf(planEnd!)}`}
              {lasted > 0 ? <span className="text-white/45">· {formatSpan(lasted)} davom etdi</span> : null}
            </p>
            <p className="flex items-center gap-2 text-white/70">
              <Crown className="h-4 w-4 shrink-0 text-amber-400" />
              Tashkilotchi: {conf.host.fullName}
            </p>
          </div>
        ) : null}
        <div className="relative mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          {actions}
          <Link
            href="/qongiroq?tab=konferensiya"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold transition hover:bg-white/20"
          >
            <ArrowLeft className="h-4 w-4" /> Konferensiyalar
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function KonferensiyaPage({ params }: { params: { code?: string } }) {
  const code = String(params.code || "").toLowerCase();
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>("prejoin");
  const [room, setRoom] = useState<Room | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const leavingRef = useRef(false);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    rememberAfterLogin(`/konferensiya/${code}`);
    setLocation("/login");
  }, [isLoading, isAuthenticated, code, setLocation]);

  const details = useQuery({
    queryKey: ["conference", code],
    queryFn: () => conferenceApi.details(code),
    enabled: isAuthenticated && Boolean(code),
    refetchInterval: phase === "prejoin" ? 15_000 : false,
    retry: (n, err) => !(err instanceof ApiError && [401, 403, 404, 410].includes(err.status)) && n < 2,
    // Havola xona ichida yangilansa — yangi kod yuklanguncha xona ko‘rinishi saqlanadi
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    document.title = details.data ? `${details.data.conference.title} · Konferensiya` : "Konferensiya";
  }, [details.data]);

  useEffect(
    () => () => {
      leavingRef.current = true;
      void roomRef.current?.disconnect();
    },
    [],
  );

  const join = useCallback(
    async (prefs: JoinPrefs) => {
      setJoinError(null);
      setPhase("connecting");
      leavingRef.current = false;
      const stopPreview = () => {
        prefs.audioTrack?.stop();
        prefs.videoTrack?.stop();
      };
      let lk: Room | null = null;
      try {
        const ticket = await conferenceApi.join(code);
        // Oddiy uy/ofis interneti (yuklash 2–5 Mbit) ham ko‘tarsin: kamera ≤ 0.8 Mbit, ekran ≤ 1.6 Mbit.
        // Ovoz uzluksiz (dtx o‘chiq — so‘z boshlari «yutilmaydi»), RED — paket yo‘qolsa ham ovoz uzilmaydi.
        lk = new Room({
          adaptiveStream: true,
          dynacast: true,
          disconnectOnPageLeave: true,
          videoCaptureDefaults: { resolution: VideoPresets.h540.resolution },
          audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          publishDefaults: {
            simulcast: true,
            videoEncoding: { maxBitrate: 800_000, maxFramerate: 24 },
            videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
            screenShareEncoding: { maxBitrate: 1_600_000, maxFramerate: 12 },
            screenShareSimulcastLayers: [ScreenSharePresets.h720fps5],
            degradationPreference: "balanced",
            dtx: false,
            red: true,
          },
        });
        const current = lk;
        current.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          if (roomRef.current !== current) return;
          roomRef.current = null;
          setRoom(null);
          void qc.invalidateQueries({ queryKey: ["conference", code] });
          void qc.invalidateQueries({ queryKey: ["conferences"] });
          if (leavingRef.current) return;
          if (reason === DisconnectReason.PARTICIPANT_REMOVED) setPhase("kicked");
          else if (reason === DisconnectReason.ROOM_DELETED) setPhase("ended");
          else if (reason === DisconnectReason.DUPLICATE_IDENTITY) setPhase("duplicate");
          else if (reason === DisconnectReason.CLIENT_INITIATED) setPhase("left");
          else setPhase("lost");
        });
        await current.connect(ticket.url, ticket.token, { autoSubscribe: true });
        roomRef.current = current;
        setRoom(current);
        setPhase("in");

        const lp = current.localParticipant;
        if (prefs.micOn && canPublish(lp, Track.Source.Microphone)) {
          if (prefs.audioTrack) await lp.publishTrack(prefs.audioTrack).catch(() => lp.setMicrophoneEnabled(true).catch(() => undefined));
          else await lp.setMicrophoneEnabled(true).catch(() => undefined);
        } else prefs.audioTrack?.stop();
        if (prefs.camOn && canPublish(lp, Track.Source.Camera)) {
          if (prefs.videoTrack) await lp.publishTrack(prefs.videoTrack).catch(() => lp.setCameraEnabled(true).catch(() => undefined));
          else await lp.setCameraEnabled(true).catch(() => undefined);
        } else prefs.videoTrack?.stop();
        void current.startAudio().catch(() => undefined);
      } catch (e) {
        stopPreview();
        if (lk) {
          leavingRef.current = true;
          void lk.disconnect();
        }
        roomRef.current = null;
        setRoom(null);
        const msg =
          e instanceof ApiError
            ? e.message
            : "Media-serverga ulanib bo‘lmadi. Internetni tekshirib, qayta urinib ko‘ring.";
        setJoinError(msg);
        setPhase("prejoin");
        setAttempt((a) => a + 1);
        void details.refetch();
      }
    },
    [code, qc, details],
  );

  const leave = useCallback(
    async (endForAll: boolean) => {
      leavingRef.current = true;
      if (endForAll) {
        try {
          await conferenceApi.end(code);
        } catch (e) {
          toast({ title: "Yakunlanmadi", description: (e as Error).message, variant: "destructive" });
          leavingRef.current = false;
          return;
        }
      }
      const r = roomRef.current;
      roomRef.current = null;
      setRoom(null);
      await r?.disconnect();
      setPhase(endForAll ? "ended" : "left");
      void qc.invalidateQueries({ queryKey: ["conferences"] });
    },
    [code, qc, toast],
  );

  const ended = useCallback(async () => {
    leavingRef.current = true;
    const r = roomRef.current;
    roomRef.current = null;
    setRoom(null);
    await r?.disconnect();
    setPhase("ended");
    void qc.invalidateQueries({ queryKey: ["conferences"] });
    void qc.invalidateQueries({ queryKey: ["conference"] });
  }, [qc]);

  const onCodeChanged = useCallback(
    (next: string) => {
      if (next && next !== code) setLocation(`/konferensiya/${next}`, { replace: true });
      void qc.invalidateQueries({ queryKey: ["conferences"] });
    },
    [code, setLocation, qc],
  );

  const refetchDetails = details.refetch;
  const onTimeReached = useCallback(() => void refetchDetails(), [refetchDetails]);

  const rejoin = () => {
    setPhase("prejoin");
    setAttempt((a) => a + 1);
    void details.refetch();
  };

  if (isLoading || !isAuthenticated) {
    return (
      <Screen>
        <div className="flex min-h-[100dvh] items-center justify-center text-white/70">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Yuklanmoqda…
        </div>
      </Screen>
    );
  }

  if (phase === "in" && room && details.data) {
    return (
      <ConferenceRoom
        room={room}
        code={code}
        details={details.data}
        onLeave={leave}
        onEnded={() => void ended()}
        onCodeChanged={onCodeChanged}
      />
    );
  }

  if (!isBrowserSupported()) {
    return (
      <Screen>
        <TopBar />
        <EndCard
          icon={<MonitorSmartphone className="h-9 w-9 text-amber-300" />}
          title="Brauzer qo‘llab-quvvatlanmaydi"
          text="Konferensiya uchun Chrome, Edge, Safari yoki Firefox’ning yangi versiyasidan foydalaning."
        />
      </Screen>
    );
  }

  const endState: Record<Exclude<Phase, "prejoin" | "connecting" | "in">, { icon: ReactNode; title: string; text: string; rejoin?: string }> = {
    left: {
      icon: <LogOut className="h-9 w-9 text-white/80" />,
      title: "Siz konferensiyadan chiqdingiz",
      text: "Konferensiya davom etayotgan bo‘lsa, istalgan vaqtda qayta qo‘shilishingiz mumkin.",
      rejoin: "Qayta qo‘shilish",
    },
    kicked: {
      icon: <UserX className="h-9 w-9 text-red-300" />,
      title: "Tashkilotchi sizni chiqarib yubordi",
      text: "Bu konferensiyaga qayta kira olmaysiz. Xato bo‘lsa, tashkilotchiga murojaat qiling.",
    },
    ended: {
      icon: <CheckCircle2 className="h-9 w-9 text-emerald-300" />,
      title: "Konferensiya yakunlandi",
      text: "Qatnashganingiz uchun rahmat!",
    },
    lost: {
      icon: <WifiOff className="h-9 w-9 text-amber-300" />,
      title: "Aloqa uzildi",
      text: "Internet aloqasi uzilib qoldi. Tarmoqni tekshirib, qayta qo‘shiling.",
      rejoin: "Qayta ulanish",
    },
    duplicate: {
      icon: <MonitorSmartphone className="h-9 w-9 text-sky-300" />,
      title: "Boshqa oynada ochildi",
      text: "Siz shu konferensiyaga boshqa oyna yoki qurilmadan kirdingiz. Bu yerda davom etish uchun qayta qo‘shiling.",
      rejoin: "Shu yerda davom etish",
    },
  };

  const conf = details.data?.conference;
  const reason = details.data?.reason;

  if (phase === "ended" || ((phase === "prejoin" || phase === "connecting") && (reason === "ended" || reason === "cancelled"))) {
    const cancelled = phase !== "ended" && reason === "cancelled";
    return (
      <Screen>
        <TopBar />
        <ClosedCard
          tone={cancelled ? "slate" : phase === "ended" ? "emerald" : "red"}
          icon={cancelled ? <Ban className="h-9 w-9" /> : phase === "ended" ? <CheckCircle2 className="h-9 w-9" /> : <VideoOff className="h-9 w-9" />}
          badge={cancelled ? "Bekor qilingan" : "Tugagan"}
          title={cancelled ? "Konferensiya bekor qilingan" : phase === "ended" ? "Konferensiya yakunlandi" : "Konferensiya tugagan"}
          text={
            cancelled
              ? "Tashkilotchi bu konferensiyani bekor qilgan. Yangi uchrashuv bo‘lsa, sizga bot orqali alohida taklif keladi."
              : phase === "ended"
                ? "Qatnashganingiz uchun rahmat! Tashkilotchi konferensiyani hamma uchun yakunladi."
                : "Bu konferensiya allaqachon yakunlangan, havola orqali endi kirib bo‘lmaydi. Yangi uchrashuv bo‘lsa, sizga yangi havola yuboriladi."
          }
          conf={conf}
        />
      </Screen>
    );
  }

  if (phase !== "prejoin" && phase !== "connecting") {
    const s = endState[phase as keyof typeof endState];
    return (
      <Screen>
        <TopBar />
        <EndCard icon={s.icon} title={s.title} text={s.text} onRejoin={s.rejoin ? rejoin : undefined} rejoinText={s.rejoin} />
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar />
      {details.isLoading ? (
        <div className="flex min-h-[60vh] items-center justify-center text-white/70">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Yuklanmoqda…
        </div>
      ) : details.isError && (details.error as ApiError)?.status === 410 ? (
        (details.error as ApiError).reason === "ended" ? (
          <ClosedCard
            tone="red"
            icon={<VideoOff className="h-9 w-9" />}
            badge="Tugagan"
            title="Konferensiya tugagan"
            text="Bu konferensiya allaqachon yakunlangan, havola orqali endi kirib bo‘lmaydi. Yangi uchrashuv bo‘lsa, sizga yangi havola yuboriladi."
          />
        ) : (
          <ClosedCard
            tone="amber"
            icon={<Link2Off className="h-9 w-9" />}
            badge="Havola eskirgan"
            title="Bu havola endi ishlamaydi"
            text="Tashkilotchi konferensiya uchun yangi havola yaratgan, eskisi bekor qilingan. Yangi havolani bot xabaridan yoki tashkilotchidan oling."
          />
        )
      ) : details.isError ? (
        <EndCard
          icon={<VideoOff className="h-9 w-9 text-white/70" />}
          title={(details.error as ApiError)?.status === 404 ? "Konferensiya topilmadi" : "Yuklab bo‘lmadi"}
          text={
            (details.error as ApiError)?.status === 404
              ? "Havola noto‘g‘ri yoki konferensiya o‘chirilgan. Havolani tashkilotchidan qayta so‘rang."
              : (details.error as Error).message
          }
          onRejoin={(details.error as ApiError)?.status === 404 ? undefined : () => void details.refetch()}
          rejoinText="Qayta urinish"
        />
      ) : details.data ? (
        <PreJoin
          key={attempt}
          details={details.data}
          joining={phase === "connecting"}
          error={joinError}
          onJoin={(p) => void join(p)}
          onTimeReached={onTimeReached}
        />
      ) : null}
    </Screen>
  );
}
