import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  VideoPresets,
  createAudioAnalyser,
  createLocalAudioTrack,
  createLocalVideoTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from "livekit-client";
import { AlertTriangle, CalendarClock, Clock, Crown, Loader2, Mic, MicOff, Users, Video, VideoOff, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { CallAvatar } from "@/components/calls/CallLayer";
import { formatWhen, type ConferenceDetails } from "@/lib/conference/api";

export type JoinPrefs = {
  micOn: boolean;
  camOn: boolean;
  audioTrack: LocalAudioTrack | null;
  videoTrack: LocalVideoTrack | null;
};

export function mediaErrorText(err: unknown): string {
  const name = (err as { name?: string })?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Brauzer kamera/mikrofonga ruxsat bermadi. Manzil satridagi qulf belgisini bosib, ruxsatni yoqing.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Qurilma topilmadi — kamera yoki mikrofon ulanganini tekshiring.";
  if (name === "NotReadableError") return "Qurilma boshqa dasturda band (Zoom, Telegram va h.k.). Uni yopib, qayta urinib ko‘ring.";
  return "Qurilmani yoqib bo‘lmadi.";
}

function useCountdown(targetMs: number | null, offsetMs: number) {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    if (targetMs == null) return;
    const t = setInterval(() => setNow(Date.now() + offsetMs), 1000);
    return () => clearInterval(t);
  }, [targetMs, offsetMs]);
  return targetMs == null ? null : Math.max(0, targetMs - now);
}

function formatLeft(ms: number) {
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d) return `${d} kun ${h} soat`;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}

function DeviceSelect({
  kind,
  value,
  onChange,
  enabled,
}: {
  kind: MediaDeviceKind;
  value: string;
  onChange: (id: string) => void;
  enabled: boolean;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      Room.getLocalDevices(kind, false)
        .then((list) => alive && setDevices(list.filter((d) => d.deviceId)))
        .catch(() => undefined);
    void load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, [kind, enabled]);
  if (devices.length < 2) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full min-w-0 truncate rounded-xl border border-white/10 bg-white/5 px-2 text-xs text-white outline-none"
    >
      {devices.map((d, i) => (
        <option key={d.deviceId} value={d.deviceId} className="text-black">
          {d.label || `${kind === "audioinput" ? "Mikrofon" : "Kamera"} ${i + 1}`}
        </option>
      ))}
    </select>
  );
}

export function PreJoin({
  details,
  joining,
  error,
  onJoin,
  onTimeReached,
}: {
  details: ConferenceDetails;
  joining: boolean;
  error: string | null;
  onJoin: (prefs: JoinPrefs) => void;
  onTimeReached: () => void;
}) {
  const c = details.conference;
  const me = details.me;
  const settings = c.settings;
  const canSpeak = me.canSpeak;
  const [micOn, setMicOn] = useState(() => canSpeak && !settings.muteOnJoin);
  const [camOn, setCamOn] = useState(() => !settings.camOffOnJoin && (me.moderator || settings.cameraMode === "all" || canSpeak));
  const camAllowed = me.moderator || settings.cameraMode === "all" || canSpeak;
  const [audioTrack, setAudioTrack] = useState<LocalAudioTrack | null>(null);
  const [videoTrack, setVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [audioId, setAudioId] = useState("");
  const [videoId, setVideoId] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const levelRef = useRef<HTMLDivElement>(null);
  const handedOver = useRef(false);
  const tracksRef = useRef<{ a: LocalAudioTrack | null; v: LocalVideoTrack | null }>({ a: null, v: null });

  // Kamera oldindan ko‘rish
  useEffect(() => {
    if (!camOn || !camAllowed) {
      setVideoTrack(null);
      return;
    }
    let alive = true;
    let created: LocalVideoTrack | null = null;
    createLocalVideoTrack({ resolution: VideoPresets.h720.resolution, deviceId: videoId || undefined, facingMode: "user" })
      .then((t) => {
        if (!alive) {
          t.stop();
          return;
        }
        created = t;
        setMediaError(null);
        setVideoTrack(t);
      })
      .catch((e) => {
        if (!alive) return;
        setMediaError(mediaErrorText(e));
        setCamOn(false);
      });
    return () => {
      alive = false;
      if (created && !handedOver.current) created.stop();
    };
  }, [camOn, camAllowed, videoId]);

  // Mikrofon oldindan tekshirish
  useEffect(() => {
    if (!micOn || !canSpeak) {
      setAudioTrack(null);
      return;
    }
    let alive = true;
    let created: LocalAudioTrack | null = null;
    createLocalAudioTrack({ deviceId: audioId || undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true })
      .then((t) => {
        if (!alive) {
          t.stop();
          return;
        }
        created = t;
        setMediaError(null);
        setAudioTrack(t);
      })
      .catch((e) => {
        if (!alive) return;
        setMediaError(mediaErrorText(e));
        setMicOn(false);
      });
    return () => {
      alive = false;
      if (created && !handedOver.current) created.stop();
    };
  }, [micOn, canSpeak, audioId]);

  tracksRef.current = { a: audioTrack, v: videoTrack };

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  useEffect(() => {
    if (!audioTrack) return;
    const { calculateVolume, cleanup } = createAudioAnalyser(audioTrack, { cloneTrack: true });
    let frame = 0;
    const loop = () => {
      const v = Math.min(1, calculateVolume() * 2.2);
      if (levelRef.current) levelRef.current.style.width = `${Math.round(v * 100)}%`;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      void cleanup();
    };
  }, [audioTrack]);

  const offset = new Date(details.serverTime).getTime() - Date.now();
  const openAt = me.moderator ? null : new Date(c.scheduledAt).getTime() - 10 * 60_000;
  const left = useCountdown(details.reason === "early" ? openAt : null, offset);
  const reached = left === 0;
  useEffect(() => {
    if (reached) onTimeReached();
  }, [reached, onTimeReached]);

  const join = useCallback(() => {
    handedOver.current = true;
    onJoin({ micOn: micOn && canSpeak, camOn: camOn && camAllowed, audioTrack: tracksRef.current.a, videoTrack: tracksRef.current.v });
  }, [onJoin, micOn, camOn, canSpeak, camAllowed]);

  const blocked = details.reason === "ended" || details.reason === "cancelled" || details.reason === "banned";
  const end = new Date(new Date(c.scheduledAt).getTime() + c.durationMin * 60_000);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1.35fr_1fr] lg:items-center lg:py-12">
      <div className="space-y-3">
        <div className="relative aspect-video overflow-hidden rounded-3xl bg-slate-900 shadow-2xl ring-1 ring-white/10">
          {videoTrack ? (
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-800 to-slate-950">
              <CallAvatar id={me.userId} name={me.fullName} className="h-24 w-24 text-3xl" />
              <p className="text-sm text-white/60">{camOn ? "Kamera yoqilmoqda…" : "Kamera o‘chiq"}</p>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10">
            <button
              type="button"
              disabled={!canSpeak}
              onClick={() => setMicOn((v) => !v)}
              title={!canSpeak ? "Tashkilotchi gapirishga ruxsat bermagan" : micOn ? "Mikrofonni o‘chirish" : "Mikrofonni yoqish"}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition active:scale-90 disabled:opacity-50",
                micOn ? "bg-white/15 backdrop-blur hover:bg-white/25" : "bg-red-500 hover:bg-red-600",
              )}
            >
              {!canSpeak ? <VolumeX className="h-5 w-5" /> : micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </button>
            <button
              type="button"
              disabled={!camAllowed}
              onClick={() => setCamOn((v) => !v)}
              title={camOn ? "Kamerani o‘chirish" : "Kamerani yoqish"}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition active:scale-90 disabled:opacity-50",
                camOn ? "bg-white/15 backdrop-blur hover:bg-white/25" : "bg-red-500 hover:bg-red-600",
              )}
            >
              {camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </button>
          </div>
          {micOn && audioTrack ? (
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur">
              <Mic className="h-3.5 w-3.5 text-emerald-400" />
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/15">
                <div ref={levelRef} className="h-full w-0 rounded-full bg-emerald-400 transition-[width] duration-75" />
              </div>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DeviceSelect kind="audioinput" value={audioId} onChange={setAudioId} enabled={Boolean(audioTrack)} />
          <DeviceSelect kind="videoinput" value={videoId} onChange={setVideoId} enabled={Boolean(videoTrack)} />
        </div>
        {!canSpeak ? (
          <p className="flex items-start gap-2 rounded-2xl bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <VolumeX className="mt-0.5 h-4 w-4 shrink-0" />
            Siz tinglovchi sifatida kirasiz. Gapirmoqchi bo‘lsangiz, ichkarida «Qo‘l ko‘tarish» tugmasini bosing.
          </p>
        ) : null}
        {mediaError ? (
          <p className="flex items-start gap-2 rounded-2xl bg-red-500/10 px-3 py-2 text-xs text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {mediaError}
          </p>
        ) : null}
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-white shadow-xl backdrop-blur sm:p-8">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/80 ring-1 ring-white/15">
          {c.status === "live" ? (
            <>
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Jonli efir
            </>
          ) : (
            <>
              <CalendarClock className="h-3.5 w-3.5" /> Konferensiya
            </>
          )}
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{c.title}</h1>
        {c.description ? <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{c.description}</p> : null}
        <div className="mt-5 space-y-2.5 text-sm text-white/80">
          <p className="flex items-center gap-2.5">
            <Clock className="h-4 w-4 text-white/50" />
            {formatWhen(c.scheduledAt)} – {end.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}
          </p>
          <p className="flex items-center gap-2.5">
            <Crown className="h-4 w-4 text-amber-400" />
            Tashkilotchi: {c.host.fullName}
            {me.role === "host" ? " (siz)" : ""}
          </p>
          {c.status === "live" ? (
            <p className="flex items-center gap-2.5">
              <Users className="h-4 w-4 text-white/50" />
              {c.liveCount ? `Ichkarida ${c.liveCount} kishi` : "Hozircha ichkarida hech kim yo‘q"}
            </p>
          ) : null}
        </div>

        <div className="mt-7">
          {blocked ? (
            <div className="rounded-2xl bg-white/5 p-4 text-sm text-white/80">
              {details.reason === "ended"
                ? "Bu konferensiya yakunlangan."
                : details.reason === "cancelled"
                  ? "Bu konferensiya bekor qilingan."
                  : "Tashkilotchi sizni bu konferensiyadan chiqargan."}
            </div>
          ) : !details.serverReady ? (
            <div className="flex items-start gap-2 rounded-2xl bg-amber-500/10 p-4 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Konferensiya media-serveri hali sozlanmagan. Administratorga murojaat qiling.
            </div>
          ) : details.joinable ? (
            <button
              type="button"
              disabled={joining}
              onClick={join}
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-base font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-600 active:scale-[0.98] disabled:opacity-60"
            >
              {joining ? <Loader2 className="h-5 w-5 animate-spin" /> : <Video className="h-5 w-5" />}
              {joining ? "Ulanmoqda…" : me.moderator && c.status === "scheduled" ? "Konferensiyani boshlash" : "Qo‘shilish"}
            </button>
          ) : (
            <div className="rounded-2xl bg-white/5 p-5 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-white/50">Kirish ochilishiga</p>
              <p className="mt-1 font-mono text-4xl font-bold tabular-nums">{left != null ? formatLeft(left) : "—"}</p>
              <p className="mt-2 text-xs leading-relaxed text-white/60">
                Kirish boshlanishdan 10 daqiqa oldin ochiladi. Sahifani yopmasangiz, tugma o‘zi faollashadi.
              </p>
            </div>
          )}
          {error ? (
            <p className="mt-3 flex items-start gap-2 rounded-2xl bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
