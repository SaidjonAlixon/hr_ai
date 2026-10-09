import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ArrowLeft, CheckCircle2, Loader2, LogOut, MonitorSmartphone, RefreshCw, UserX, VideoOff, WifiOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ApiError, conferenceApi, rememberAfterLogin } from "@/lib/conference/api";
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
    retry: (n, err) => !(err instanceof ApiError && (err.status === 404 || err.status === 401)) && n < 2,
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
        lk = new Room({
          adaptiveStream: true,
          dynacast: true,
          disconnectOnPageLeave: true,
          videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
          audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          publishDefaults: {
            simulcast: true,
            videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
            screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
            dtx: true,
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
    return <ConferenceRoom room={room} code={code} details={details.data} onLeave={(all) => void leave(all)} />;
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
