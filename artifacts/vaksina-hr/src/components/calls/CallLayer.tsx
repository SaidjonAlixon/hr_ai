import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronDown,
  CornerDownLeft,
  Delete,
  Hand,
  Home,
  Keyboard,
  Loader2,
  Lock,
  Maximize2,
  Mic,
  MicOff,
  MonitorSmartphone,
  MonitorUp,
  MousePointerClick,
  Phone,
  PhoneOff,
  ScreenShareOff,
  SendHorizontal,
  ShieldCheck,
  SignalLow,
  SignalMedium,
  SwitchCamera,
  Video,
  VideoOff,
  WifiOff,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { callEngine, endedText, isControllableShare, useCall, type CallSnapshot } from "@/lib/calls/engine";

const MirrorView = lazy(() => import("./MirrorView"));

// ---------------------------------------------------------------- yordamchilar

const GRADIENTS = [
  "from-sky-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-fuchsia-500 to-purple-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-blue-600",
];

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function CallAvatar({ id, name, className }: { id: number; name: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-inner",
        GRADIENTS[Math.abs(id) % GRADIENTS.length],
        className,
      )}
    >
      {initials(name)}
    </div>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function formatDuration(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function statusText(s: CallSnapshot, now: number) {
  switch (s.phase) {
    case "outgoing":
      return s.callId ? "Jiringlamoqda…" : "Ulanmoqda…";
    case "incoming":
      return s.video ? "Video qo‘ng‘iroq" : "Ovozli qo‘ng‘iroq";
    case "connecting":
      return "Ulanmoqda…";
    case "active":
      if (s.conn === "reconnecting") return "Aloqa tiklanmoqda…";
      return formatDuration((now - (s.answeredAt ?? now)) / 1000);
    case "ended":
      return endedText(s.endedReason);
    default:
      return "";
  }
}

function hasLiveVideo(stream: MediaStream | null) {
  return Boolean(stream?.getVideoTracks().some((t) => t.readyState === "live"));
}

/** Holat xabari (DataChannel) yetib kelmasa ham, kadrlar kelayotgan bo‘lsa video ko‘rsatiladi */
function remoteVideoVisible(s: CallSnapshot) {
  if (s.phase !== "active" || !hasLiveVideo(s.remoteStream)) return false;
  return s.remote.cam || s.remote.share !== "none" || (s.rxVideo && !s.dcOpen);
}

type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };

function CallVideo({
  stream,
  muted = true,
  mirror,
  fit = "cover",
  className,
  videoRef,
  expectFrames = false,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  mirror?: boolean;
  fit?: "cover" | "contain";
  className?: string;
  videoRef?: (el: HTMLVideoElement | null) => void;
  /** Kadrlar kelayotgani ma’lum (getStats) — element ko‘rsatmay qolsa qayta biriktiriladi */
  expectFrames?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const expectRef = useRef(expectFrames);
  expectRef.current = expectFrames;
  const setRef = useCallback(
    (el: HTMLVideoElement | null) => {
      ref.current = el;
      videoRef?.(el);
    },
    [videoRef],
  );
  // Faqat video treklari: ovozli trek <video>da bo‘lsa iOS audio sessiyasi bilan to‘qnashadi
  const videoOnly = useMemo(() => {
    const tracks = stream?.getVideoTracks() ?? [];
    return tracks.length ? new MediaStream(tracks) : null;
  }, [stream]);
  useEffect(() => {
    const v = ref.current as FrameVideo | null;
    if (!v) return;
    let lastAttach = 0;
    const play = () => {
      if (videoOnly) void v.play().catch(() => undefined);
    };
    const attach = (force: boolean) => {
      if (force) {
        if (Date.now() - lastAttach < 2500) return;
        v.srcObject = null;
      }
      lastAttach = Date.now();
      if (v.srcObject !== videoOnly) v.srcObject = videoOnly;
      play();
    };
    attach(false);
    if (!videoOnly) return;
    const tracks = videoOnly.getVideoTracks();
    // Safari: trek kadrsiz (muted) holatda ulangan bo‘lsa, kadrlar kelganda ham qora qolishi mumkin
    const onUnmute = () => attach(true);
    for (const t of tracks) t.addEventListener("unmute", onUnmute);
    v.addEventListener("pause", play);
    v.addEventListener("loadedmetadata", play);
    v.addEventListener("stalled", play);

    let lastFrame = Date.now();
    let frameHandle = 0;
    const onFrame = () => {
      lastFrame = Date.now();
      frameHandle = v.requestVideoFrameCallback?.(onFrame) ?? 0;
    };
    if (v.requestVideoFrameCallback) frameHandle = v.requestVideoFrameCallback(onFrame);
    let lastTime = -1;
    const watchdog = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!tracks.some((t) => t.readyState === "live")) return;
      if (v.paused) play();
      if (!expectRef.current) {
        lastFrame = Date.now();
        return;
      }
      if (!v.requestVideoFrameCallback) {
        if (v.currentTime !== lastTime) lastFrame = Date.now();
        lastTime = v.currentTime;
      }
      if (Date.now() - lastFrame > 3000) {
        lastFrame = Date.now();
        attach(true);
      }
    }, 1000);
    return () => {
      clearInterval(watchdog);
      if (frameHandle) v.cancelVideoFrameCallback?.(frameHandle);
      for (const t of tracks) t.removeEventListener("unmute", onUnmute);
      v.removeEventListener("pause", play);
      v.removeEventListener("loadedmetadata", play);
      v.removeEventListener("stalled", play);
    };
  }, [videoOnly]);
  return (
    <video
      ref={setRef}
      autoPlay
      playsInline
      muted={muted}
      className={cn("h-full w-full bg-black", fit === "cover" ? "object-cover" : "object-contain", className)}
      style={mirror ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

/** Ovoz alohida <audio> orqali — oyna kichraysa ham uzilmaydi */
function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  const audioOnly = useMemo(() => {
    const tracks = stream?.getAudioTracks() ?? [];
    return tracks.length ? new MediaStream(tracks) : null;
  }, [stream]);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    if (a.srcObject !== audioOnly) a.srcObject = audioOnly;
    if (!audioOnly) return;
    const play = () => void a.play().catch(() => undefined);
    play();
    a.addEventListener("pause", play);
    document.addEventListener("visibilitychange", play);
    return () => {
      a.removeEventListener("pause", play);
      document.removeEventListener("visibilitychange", play);
    };
  }, [audioOnly]);
  return <audio ref={ref} autoPlay playsInline className="hidden" />;
}

function RoundButton({
  onClick,
  label,
  active,
  danger,
  success,
  big,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  danger?: boolean;
  success?: boolean;
  big?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-16 flex-col items-center gap-1.5 disabled:opacity-40 sm:w-[72px]"
      aria-label={label}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full transition-all duration-200 active:scale-90",
          big ? "h-16 w-16" : "h-12 w-12 sm:h-14 sm:w-14",
          danger
            ? "bg-red-500 text-white shadow-lg shadow-red-500/40 hover:bg-red-600"
            : success
              ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/40 hover:bg-emerald-600"
              : active
                ? "bg-white text-slate-900 shadow-lg"
                : "bg-white/12 text-white ring-1 ring-white/15 backdrop-blur-md hover:bg-white/20",
        )}
      >
        {children}
      </span>
      <span className="max-w-full truncate text-[11px] font-medium leading-tight text-white/85">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------- kiruvchi qo‘ng‘iroq

function IncomingScreen({ s }: { s: CallSnapshot }) {
  const peer = s.peer!;
  return (
    <div
      data-call-ui=""
      className="fixed inset-0 z-[9995] flex flex-col items-center justify-between overflow-hidden bg-slate-950 px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))] text-white animate-in fade-in duration-300"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(16,185,129,0.35),transparent_55%),radial-gradient(circle_at_80%_90%,rgba(59,130,246,0.35),transparent_50%)]" />
      <div className="relative z-10 flex flex-col items-center gap-2 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/85 ring-1 ring-white/15">
          {s.video ? <Video className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
          VAKSINA HR · {s.video ? "Video qo‘ng‘iroq" : "Ovozli qo‘ng‘iroq"}
        </div>
      </div>
      <div className="relative z-10 flex flex-col items-center gap-5 text-center">
        <div className="relative flex items-center justify-center">
          <span className="absolute h-44 w-44 animate-ping rounded-full bg-emerald-400/20 [animation-duration:2s]" />
          <span className="absolute h-36 w-36 animate-ping rounded-full bg-emerald-400/25 [animation-duration:2s] [animation-delay:.4s]" />
          <CallAvatar id={peer.id} name={peer.fullName} className="relative h-28 w-28 text-4xl ring-4 ring-white/20" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{peer.fullName}</h2>
          <p className="mt-1 text-sm text-white/70">
            {peer.role === "admin" ? "Administrator" : "Xodim"} · sizga qo‘ng‘iroq qilmoqda
          </p>
        </div>
      </div>
      <div className="relative z-10 flex w-full max-w-sm items-end justify-between">
        <RoundButton big danger label="Rad etish" onClick={() => void callEngine.decline()}>
          <PhoneOff className="h-7 w-7" />
        </RoundButton>
        {s.video ? (
          <RoundButton label="Ovozli" onClick={() => void callEngine.accept(false)}>
            <Phone className="h-5 w-5" />
          </RoundButton>
        ) : null}
        <div className="animate-bounce [animation-duration:1.4s]">
          <RoundButton big success label="Qabul qilish" onClick={() => void callEngine.accept()}>
            {s.video ? <Video className="h-7 w-7" /> : <Phone className="h-7 w-7" />}
          </RoundButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- masofaviy boshqaruv (admin)

type Rect = { left: number; top: number; width: number; height: number };

/** Video kadri konteynerda (object-contain) egallagan to‘rtburchak */
function useVideoRect(video: HTMLVideoElement | null, container: HTMLDivElement | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    if (!video || !container) {
      setRect(null);
      return;
    }
    const calc = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      const k = Math.min(cw / vw, ch / vh);
      const w = vw * k;
      const h = vh * k;
      setRect({ left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(container);
    video.addEventListener("resize", calc);
    video.addEventListener("loadedmetadata", calc);
    return () => {
      ro.disconnect();
      video.removeEventListener("resize", calc);
      video.removeEventListener("loadedmetadata", calc);
    };
  }, [video, container]);
  return rect;
}

function ControlSurface({ rect }: { rect: Rect | null }) {
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; lx: number; ly: number; moved: boolean; id: number } | null>(null);
  const pending = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const raf = useRef(0);
  const cursor = useRef<HTMLDivElement>(null);
  const move = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null; last: { x: number; y: number } | null }>({
    at: 0,
    timer: null,
    last: null,
  });

  useEffect(() => () => {
    if (move.current.timer) clearTimeout(move.current.timer);
  }, []);

  /** Kursor darhol shu yerda chiziladi; xodimga ~25 marta/s yuboriladi */
  const pointAt = (clientX: number, clientY: number) => {
    const el = surface.current;
    const c = cursor.current;
    if (!el || !c) return;
    const r = el.getBoundingClientRect();
    c.style.opacity = "1";
    c.style.transform = `translate(${clientX - r.left}px, ${clientY - r.top}px)`;
    const m = move.current;
    m.last = { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
    const send = () => {
      m.timer = null;
      m.at = Date.now();
      if (m.last) callEngine.sendControl({ e: "move", ...m.last });
    };
    const wait = 40 - (Date.now() - m.at);
    if (wait <= 0) send();
    else if (!m.timer) m.timer = setTimeout(send, wait);
  };

  const norm = (clientX: number, clientY: number) => {
    const r = surface.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height, r };
  };

  const flush = () => {
    raf.current = 0;
    const p = pending.current;
    pending.current = null;
    if (p && (p.dx || p.dy)) callEngine.sendControl({ e: "scroll", ...p });
  };

  const queueScroll = (x: number, y: number, dx: number, dy: number) => {
    const p = pending.current ?? { x, y, dx: 0, dy: 0 };
    p.dx += dx;
    p.dy += dy;
    pending.current = p;
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };

  if (!rect) return null;
  return (
    <div
      ref={surface}
      tabIndex={0}
      className="absolute cursor-none touch-none overflow-hidden rounded-sm outline-none ring-2 ring-sky-400/70 focus:ring-sky-300"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onPointerDown={(e) => {
        surface.current?.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        pointAt(e.clientX, e.clientY);
        cursor.current?.classList.add("scale-90");
        drag.current = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, id: e.pointerId };
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse" && cursor.current) cursor.current.style.opacity = "0";
      }}
      onPointerMove={(e) => {
        pointAt(e.clientX, e.clientY);
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.moved = true;
        if (d.moved) {
          const { x, y, r } = norm(d.x, d.y);
          queueScroll(x, y, -(e.clientX - d.lx) / r.width, -(e.clientY - d.ly) / r.height);
        }
        d.lx = e.clientX;
        d.ly = e.clientY;
      }}
      onPointerUp={(e) => {
        cursor.current?.classList.remove("scale-90");
        const d = drag.current;
        drag.current = null;
        if (!d || d.moved) return;
        const { x, y } = norm(e.clientX, e.clientY);
        callEngine.sendControl({ e: "tap", x, y });
      }}
      onPointerCancel={() => {
        cursor.current?.classList.remove("scale-90");
        drag.current = null;
      }}
      onWheel={(e) => {
        const { x, y, r } = norm(e.clientX, e.clientY);
        queueScroll(x, y, e.deltaX / r.width, e.deltaY / r.height);
      }}
      onKeyDown={(e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (["Enter", "Backspace", "Tab", "Escape"].includes(e.key)) {
          e.preventDefault();
          callEngine.sendControl({ e: "key", key: e.key as "Enter" });
        } else if (e.key.length === 1) {
          e.preventDefault();
          callEngine.sendControl({ e: "text", value: e.key });
        }
      }}
    >
      <div
        ref={cursor}
        className="pointer-events-none absolute left-0 top-0 z-10 opacity-0 transition-[scale] duration-100 will-change-transform"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" className="-ml-[3px] -mt-[2px] block drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
          <path d="M4 2.5l15.5 9.2-6.9 1.5-3.3 6.4L4 2.5z" fill="#fff" stroke="#0f172a" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

function ControlToolbar() {
  const [text, setText] = useState("");
  const [kbd, setKbd] = useState(false);
  const send = () => {
    if (!text) return;
    callEngine.sendControl({ e: "text", value: text });
    setText("");
  };
  return (
    <div className="pointer-events-auto mx-auto flex w-full max-w-xl flex-col gap-2 rounded-2xl bg-slate-900/85 p-2 text-white shadow-2xl ring-1 ring-sky-400/30 backdrop-blur-xl">
      <div className="flex items-center gap-1.5">
        <span className="mr-auto inline-flex items-center gap-1.5 rounded-full bg-sky-500/20 px-2.5 py-1 text-xs font-semibold text-sky-200">
          <MousePointerClick className="h-3.5 w-3.5" /> Boshqaruv yoqilgan
        </span>
        <ToolBtn label="Orqaga" onClick={() => callEngine.sendControl({ e: "nav", to: "back" })}>
          <ArrowLeft className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Bosh sahifa" onClick={() => callEngine.sendControl({ e: "nav", to: "home" })}>
          <Home className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Klaviatura" active={kbd} onClick={() => setKbd((v) => !v)}>
          <Keyboard className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="To‘xtatish" danger onClick={() => callEngine.stopControl()}>
          <Hand className="h-4 w-4" />
        </ToolBtn>
      </div>
      {kbd ? (
        <div className="flex items-center gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Xodim ekraniga yoziladigan matn…"
            className="h-9 min-w-0 flex-1 rounded-xl bg-white/10 px-3 text-sm text-white placeholder:text-white/40 outline-none ring-1 ring-white/10 focus:ring-sky-400/60"
          />
          <ToolBtn label="Yuborish" onClick={send}>
            <SendHorizontal className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn label="O‘chirish" onClick={() => callEngine.sendControl({ e: "key", key: "Backspace" })}>
            <Delete className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn label="Enter" onClick={() => callEngine.sendControl({ e: "key", key: "Enter" })}>
            <CornerDownLeft className="h-4 w-4" />
          </ToolBtn>
        </div>
      ) : null}
    </div>
  );
}

function ToolBtn({
  label,
  onClick,
  active,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition active:scale-95",
        danger ? "bg-red-500/90 hover:bg-red-500" : active ? "bg-white text-slate-900" : "bg-white/10 hover:bg-white/20",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------- faol qo‘ng‘iroq

function ActiveScreen({ s }: { s: CallSnapshot }) {
  const peer = s.peer!;
  const now = useNow(s.phase === "active");
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [chrome, setChrome] = useState(true);
  const [mirrorRect, setMirrorRect] = useState<Rect | null>(null);
  const remoteSharing = s.remote.share !== "none";
  const mirror = s.phase === "active" && s.remoteMirror && remoteSharing;
  const showRemoteVideo = !mirror && remoteVideoVisible(s);
  const showRemote = mirror || showRemoteVideo;
  const videoPending = showRemoteVideo && !s.rxVideo;
  const videoRect = useVideoRect(showRemoteVideo ? videoEl : null, stage);
  const isAdmin = Boolean(s.me?.isAdmin);
  const live = s.phase === "active";
  const controller = s.controlSide === "controller";

  useEffect(() => {
    if (!showRemote || controller) {
      setChrome(true);
      return;
    }
    const t = setTimeout(() => setChrome(false), 5000);
    return () => clearTimeout(t);
  }, [showRemote, controller, chrome]);

  return (
    <div data-call-ui="" className="fixed inset-0 z-[9990] overflow-hidden bg-slate-950 text-white animate-in fade-in duration-200">
      <div
        ref={setStage}
        className="absolute inset-0"
        onClick={() => {
          if (!controller) setChrome((v) => !v);
        }}
      >
        {mirror ? (
          <Suspense fallback={null}>
            <MirrorView onRect={setMirrorRect} />
          </Suspense>
        ) : showRemoteVideo ? (
          <CallVideo
            stream={s.remoteStream}
            fit={remoteSharing ? "contain" : "cover"}
            mirror={!remoteSharing && s.remote.facing === "user"}
            videoRef={setVideoEl}
            expectFrames={s.rxVideo}
          />
        ) : (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.35),transparent_55%),radial-gradient(circle_at_75%_85%,rgba(139,92,246,0.3),transparent_55%)]" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center">
              <div className="relative flex items-center justify-center">
                {s.phase === "outgoing" || s.phase === "connecting" ? (
                  <>
                    <span className="absolute h-40 w-40 animate-ping rounded-full bg-sky-400/15 [animation-duration:2.2s]" />
                    <span className="absolute h-32 w-32 animate-ping rounded-full bg-sky-400/20 [animation-duration:2.2s] [animation-delay:.5s]" />
                  </>
                ) : null}
                <CallAvatar id={peer.id} name={peer.fullName} className="relative h-28 w-28 text-4xl ring-4 ring-white/15" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{peer.fullName}</h2>
                <p className={cn("mt-1.5 text-sm tabular-nums", s.phase === "ended" ? "text-red-300" : "text-white/70")}>
                  {statusText(s, now)}
                </p>
                {live && !s.remote.cam && s.video ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/70">
                    <VideoOff className="h-3.5 w-3.5" /> Kamerasi o‘chiq
                  </p>
                ) : null}
              </div>
            </div>
          </>
        )}
        {controller && showRemote && isControllableShare(s.remote.share) ? <ControlSurface rect={mirror ? mirrorRect : videoRect} /> : null}
        {videoPending ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-[calc(max(1.25rem,env(safe-area-inset-bottom))+9.5rem)] z-[5] flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3.5 py-1.5 text-xs text-white/90 backdrop-blur-md">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {remoteSharing ? "Ekran tasviri kutilmoqda…" : "Video ulanmoqda…"}
            </span>
          </div>
        ) : null}
      </div>

      {/* yuqori panel */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 via-black/30 to-transparent px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] transition-opacity duration-300",
          chrome ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="pointer-events-auto flex items-start gap-3">
          <button
            type="button"
            onClick={() => callEngine.setMinimized(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur-md hover:bg-white/20"
            aria-label="Kichraytirish"
            title="Kichraytirish — ilovadan foydalanishda davom eting"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            {showRemote ? (
              <>
                <p className="truncate text-base font-semibold">{peer.fullName}</p>
                <p className="text-xs tabular-nums text-white/75">
                  {remoteSharing ? (isControllableShare(s.remote.share) ? "Ilova ekrani · " : "Ekran ulashmoqda · ") : ""}
                  {statusText(s, now)}
                </p>
              </>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-[11px] text-white/60">
                <Lock className="h-3 w-3" /> Shifrlangan aloqa
              </p>
            )}
          </div>
          <div className="flex h-10 w-10 items-center justify-center">
            {s.conn === "reconnecting" ? (
              <WifiOff className="h-5 w-5 animate-pulse text-amber-300" />
            ) : live && s.quality === "poor" ? (
              <span title="Internet aloqasi sust" className="flex">
                <SignalLow className="h-5 w-5 text-red-400" />
              </span>
            ) : live && s.quality === "weak" ? (
              <span title="Internet aloqasi o‘rtacha" className="flex">
                <SignalMedium className="h-5 w-5 text-amber-300" />
              </span>
            ) : null}
          </div>
        </div>
        {live && !s.remote.mic ? (
          <div className="mt-3 flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1 text-xs text-white/85">
              <MicOff className="h-3.5 w-3.5" /> {peer.fullName.split(" ")[0]} mikrofoni o‘chiq
            </span>
          </div>
        ) : null}
      </div>

      {/* o‘z kamerasi (PiP) */}
      {s.localStream && s.local.cam ? (
        <div className="absolute right-3 top-[calc(max(1rem,env(safe-area-inset-top))+3.5rem)] z-20 aspect-[3/4] w-24 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/25 sm:w-36">
          <CallVideo stream={s.localStream} mirror={s.local.facing === "user"} />
          {s.local.share !== "none" ? (
            <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-1 text-center text-[10px]">Ekran ulashilmoqda</div>
          ) : null}
        </div>
      ) : s.local.share !== "none" ? (
        <div className="absolute right-3 top-[calc(max(1rem,env(safe-area-inset-top))+3.5rem)] z-20 flex w-28 flex-col items-center gap-1 rounded-2xl bg-emerald-500/20 p-3 text-center text-[11px] ring-1 ring-emerald-400/40 backdrop-blur-md sm:w-36">
          <MonitorUp className="h-5 w-5 text-emerald-300" />
          {isControllableShare(s.local.share) ? "Ilova ekrani ulashilmoqda" : "Ekran ulashilmoqda"}
        </div>
      ) : null}

      {/* pastki boshqaruv */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-12 transition-opacity duration-300",
          chrome ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {controller && showRemote ? (
          <div className="mb-3">
            <ControlToolbar />
          </div>
        ) : null}
        {live && isAdmin && !controller ? (
          <div className="mx-auto mb-3 flex max-w-md flex-wrap justify-center gap-2">
            {s.remote.share === "none" ? (
              <Chip
                onClick={() => callEngine.requestScreen()}
                disabled={s.waiting.screen}
                icon={s.waiting.screen ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MonitorSmartphone className="h-3.5 w-3.5" />}
              >
                {s.waiting.screen ? "Kutilmoqda…" : "Ekranini so‘rash"}
              </Chip>
            ) : (
              <Chip onClick={() => callEngine.stopRemoteShare()} icon={<ScreenShareOff className="h-3.5 w-3.5" />}>
                Ulashishni to‘xtatish
              </Chip>
            )}
            <Chip
              onClick={() => callEngine.requestControl()}
              disabled={s.waiting.control}
              icon={s.waiting.control ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MousePointerClick className="h-3.5 w-3.5" />}
            >
              {s.waiting.control ? "Ruxsat kutilmoqda…" : "Qurilmani boshqarish"}
            </Chip>
          </div>
        ) : null}
        <div className="mx-auto flex max-w-lg flex-wrap items-start justify-center gap-x-2 gap-y-3 sm:gap-x-4">
          <RoundButton label={s.local.mic ? "Mikrofon" : "Ovoz o‘chiq"} active={!s.local.mic} onClick={() => callEngine.toggleMic()} disabled={s.phase === "ended"}>
            {s.local.mic ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          </RoundButton>
          <RoundButton label={s.local.cam ? "Kamera" : "Kamera o‘chiq"} active={!s.local.cam} onClick={() => void callEngine.toggleCam()} disabled={s.phase === "ended"}>
            {s.local.cam ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </RoundButton>
          {s.local.cam && s.canFlip ? (
            <RoundButton label={s.local.facing === "user" ? "Orqa kamera" : "Old kamera"} onClick={() => void callEngine.flipCamera()}>
              <SwitchCamera className="h-5 w-5" />
            </RoundButton>
          ) : null}
          {live ? (
            <RoundButton
              label={s.local.share !== "none" ? "To‘xtatish" : "Ekran"}
              active={s.local.share !== "none"}
              onClick={() => (s.local.share !== "none" ? void callEngine.stopShare() : void callEngine.startShare())}
            >
              {s.local.share !== "none" ? <ScreenShareOff className="h-5 w-5" /> : <MonitorUp className="h-5 w-5" />}
            </RoundButton>
          ) : null}
          <RoundButton danger label="Tugatish" onClick={() => void callEngine.hangup()} disabled={s.phase === "ended"}>
            <PhoneOff className="h-6 w-6" />
          </RoundButton>
        </div>
      </div>
    </div>
  );
}

function Chip({ onClick, disabled, icon, children }: { onClick: () => void; disabled?: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3.5 py-2 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/20 active:scale-95 disabled:opacity-60"
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- kichik oyna

function MiniCall({ s }: { s: CallSnapshot }) {
  const peer = s.peer!;
  const now = useNow(s.phase === "active");
  const showVideo = !s.remoteMirror && remoteVideoVisible(s);
  return (
    <div
      data-call-ui=""
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-3 z-[9990] flex items-center gap-2.5 rounded-2xl bg-slate-900/95 p-2 pr-2.5 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl animate-in slide-in-from-bottom-4 md:bottom-6 md:right-6"
    >
      <button type="button" onClick={() => callEngine.setMinimized(false)} className="flex items-center gap-2.5 text-left">
        <div className="relative h-12 w-12 overflow-hidden rounded-xl">
          {showVideo ? (
            <CallVideo stream={s.remoteStream} fit={s.remote.share !== "none" ? "contain" : "cover"} expectFrames={s.rxVideo} />
          ) : (
            <CallAvatar id={peer.id} name={peer.fullName} className="h-12 w-12 rounded-xl text-base" />
          )}
          <span className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900" />
        </div>
        <div className="min-w-0 max-w-[9.5rem]">
          <p className="truncate text-sm font-semibold">{peer.fullName}</p>
          <p className="truncate text-xs tabular-nums text-white/65">
            {s.controlSide === "controlled" ? "Boshqarilmoqda · " : s.local.share !== "none" ? "Ulashilmoqda · " : ""}
            {statusText(s, now)}
          </p>
        </div>
      </button>
      <button
        type="button"
        onClick={() => callEngine.toggleMic()}
        className={cn("flex h-9 w-9 items-center justify-center rounded-full", s.local.mic ? "bg-white/10" : "bg-white text-slate-900")}
        aria-label="Mikrofon"
      >
        {s.local.mic ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => callEngine.setMinimized(false)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10"
        aria-label="Kattalashtirish"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => void callEngine.hangup()}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500"
        aria-label="Tugatish"
      >
        <PhoneOff className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- ruxsat so‘rovi (xodim)

function PromptCard({ s }: { s: CallSnapshot }) {
  const kind = s.prompt!.kind;
  const name = s.peer?.fullName ?? "Admin";
  return (
    <div data-call-ui="" className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 p-3 backdrop-blur-sm animate-in fade-in sm:items-center">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 text-slate-900 shadow-2xl animate-in slide-in-from-bottom-6 dark:bg-slate-900 dark:text-white">
        <div
          className={cn(
            "mx-auto flex h-14 w-14 items-center justify-center rounded-2xl",
            kind === "control" ? "bg-amber-100 text-amber-600 dark:bg-amber-500/20" : "bg-sky-100 text-sky-600 dark:bg-sky-500/20",
          )}
        >
          {kind === "control" ? <MousePointerClick className="h-7 w-7" /> : <MonitorUp className="h-7 w-7" />}
        </div>
        <h3 className="mt-4 text-center text-lg font-bold">
          {kind === "control" ? "Qurilmani boshqarishga ruxsat" : "Ekranni ulashish so‘rovi"}
        </h3>
        <p className="mt-2 text-center text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {kind === "control" ? (
            <>
              <b>{name}</b> VAKSINA HR ilovasi ichida sizning nomingizdan bosishi, yozishi va sahifalarni almashtirishi mumkin.
              Boshqa ilovalar va fayllaringizga kira olmaydi. Istalgan payt «To‘xtatish» tugmasi bilan o‘chirasiz.
            </>
          ) : (
            <>
              <b>{name}</b> ekraningizni ko‘rishni so‘rayapti. Ruxsat bersangiz, ekraningiz unga ko‘rinadi.
            </>
          )}
        </p>
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Faqat shu qo‘ng‘iroq davomida amal qiladi
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void callEngine.respondPrompt(false)}
            className="h-11 rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 active:scale-95 dark:bg-white/10 dark:text-white"
          >
            Rad etish
          </button>
          <button
            type="button"
            onClick={() => void callEngine.respondPrompt(true)}
            className={cn(
              "h-11 rounded-2xl text-sm font-semibold text-white shadow-lg transition active:scale-95",
              kind === "control" ? "bg-amber-500 shadow-amber-500/30 hover:bg-amber-600" : "bg-sky-600 shadow-sky-600/30 hover:bg-sky-700",
            )}
          >
            Ruxsat berish
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareBanner({ s }: { s: CallSnapshot }) {
  const controlled = s.controlSide === "controlled";
  if (!controlled && s.local.share === "none") return null;
  return (
    <div
      data-call-ui=""
      className={cn(
        "fixed inset-x-0 top-0 z-[9998] flex items-center justify-center gap-3 px-3 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-xs font-semibold text-white shadow-lg sm:text-sm",
        controlled ? "bg-red-600" : "bg-emerald-600",
      )}
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
      </span>
      <span className="truncate">
        {controlled
          ? `${s.peer?.fullName ?? "Admin"} qurilmangizni boshqarmoqda`
          : isControllableShare(s.local.share)
            ? "Ilova ekraningiz ulashilmoqda"
            : "Ekraningiz ulashilmoqda"}
      </span>
      <button
        type="button"
        onClick={() => (controlled ? callEngine.revokeControl() : void callEngine.stopShare())}
        className="shrink-0 rounded-full bg-white px-3 py-1 text-[11px] font-bold text-slate-900 active:scale-95 sm:text-xs"
      >
        To‘xtatish
      </button>
    </div>
  );
}

function NoticeToast({ s }: { s: CallSnapshot }) {
  const n = s.notice;
  useEffect(() => {
    if (!n) return;
    const t = setTimeout(() => callEngine.clearNotice(), 3500);
    return () => clearTimeout(t);
  }, [n]);
  if (!n) return null;
  return (
    <div
      data-call-ui=""
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.25rem)] z-[10000] flex justify-center px-4"
    >
      <div
        className={cn(
          "rounded-full px-4 py-2 text-sm font-medium text-white shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2",
          n.tone === "error" ? "bg-red-600/95" : n.tone === "warn" ? "bg-amber-600/95" : "bg-slate-900/90",
        )}
      >
        {n.text}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ildiz

export function CallLayer() {
  const { user, isAuthenticated } = useAuth();
  const s = useCall();
  const uid = isAuthenticated && user ? Number((user as { id?: number }).id) : 0;

  useEffect(() => {
    if (uid > 0) callEngine.start(uid);
    else callEngine.stop();
  }, [uid]);

  useEffect(() => {
    if (s.phase === "idle" || s.phase === "ended") return;
    const prev = document.title;
    document.title = s.phase === "incoming" ? `📞 ${s.peer?.fullName ?? ""} qo‘ng‘iroq qilmoqda` : `📞 ${s.peer?.fullName ?? "Qo‘ng‘iroq"}`;
    return () => {
      document.title = prev;
    };
  }, [s.phase, s.peer?.fullName]);

  const inCall = s.phase !== "idle" && s.peer;
  return (
    <>
      {inCall && s.phase !== "incoming" ? <RemoteAudio stream={s.remoteStream} /> : null}
      {inCall && s.phase === "incoming" ? <IncomingScreen s={s} /> : null}
      {inCall && s.phase !== "incoming" && !s.minimized ? <ActiveScreen s={s} /> : null}
      {inCall && s.phase !== "incoming" && s.minimized ? <MiniCall s={s} /> : null}
      {inCall ? <ShareBanner s={s} /> : null}
      {s.prompt ? <PromptCard s={s} /> : null}
      <NoticeToast s={s} />
    </>
  );
}
