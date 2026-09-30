import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
  unloadModule?: (name: string) => void;
  setOption?: (module: string, option: string, value: unknown) => void;
};

function hideYoutubeCaptions(player: YTPlayer | null) {
  if (!player) return;
  try {
    player.unloadModule?.("captions");
  } catch {
    /* ignore */
  }
  try {
    player.unloadModule?.("cc");
  } catch {
    /* ignore */
  }
  try {
    player.setOption?.("captions", "track", {});
  } catch {
    /* ignore */
  }
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId: string;
          playerVars?: Record<string, number | string>;
          events?: {
            onReady?: () => void;
            onStateChange?: (e: { data: number }) => void;
          };
        },
      ) => YTPlayer;
      PlayerState?: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;

function loadYoutubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.querySelector("script[data-yt-iframe-api]")) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.dataset.ytIframeApi = "1";
      document.head.appendChild(tag);
    }
    if (window.YT?.Player) resolve();
  });
  return ytApiPromise;
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function isFullyWatched(maxWatched: number, duration: number) {
  if (!Number.isFinite(duration) || duration < 2) return false;
  return maxWatched >= duration - 0.85 || maxWatched / duration >= 0.985;
}

const PLAY_HINT_KEY = "kirish-player-click-hint";

export function RestrictedVideoPlayer({
  youtubeId,
  driveFileId,
  src,
  poster,
  onEnded,
  onProgress,
}: {
  youtubeId?: string | null;
  driveFileId?: string | null;
  src?: string;
  poster?: string;
  onEnded?: () => void;
  onProgress?: (info: { current: number; duration: number; maxWatched: number; percent: number }) => void;
}) {
  const [showHint, setShowHint] = useState(() => {
    try {
      return localStorage.getItem(PLAY_HINT_KEY) !== "1";
    } catch {
      return true;
    }
  });

  const hideHint = () => {
    if (!showHint) return;
    setShowHint(false);
    try {
      localStorage.setItem(PLAY_HINT_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const { wrapRef, expanded, toggleExpanded } = useExpandablePlayer();

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative h-full w-full",
        expanded && "fixed inset-0 z-[200] h-[100dvh] w-screen bg-black",
      )}
    >
      {youtubeId ? (
        <YoutubeRestricted
          id={youtubeId}
          onEnded={onEnded}
          onProgress={onProgress}
          onPlaying={hideHint}
          showHint={showHint}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
        />
      ) : driveFileId ? (
        <DriveRestricted
          fileId={driveFileId}
          onEnded={onEnded}
          onProgress={onProgress}
          onPlaying={hideHint}
          showHint={showHint}
        />
      ) : (
        <Html5Restricted
          src={src || ""}
          poster={poster}
          onEnded={onEnded}
          onProgress={onProgress}
          onPlaying={hideHint}
          showHint={showHint}
          expanded={expanded}
          onToggleExpanded={toggleExpanded}
        />
      )}
    </div>
  );
}

function DriveRestricted({
  fileId,
  onEnded,
  onProgress,
  onPlaying,
  showHint,
}: {
  fileId: string;
  onEnded?: () => void;
  onProgress?: (info: { current: number; duration: number; maxWatched: number; percent: number }) => void;
  onPlaying?: () => void;
  showHint: boolean;
}) {
  const [done, setDone] = useState(false);
  const [canConfirm, setCanConfirm] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setCanConfirm(true), 8_000);
    return () => window.clearTimeout(t);
  }, [fileId]);

  const markDone = () => {
    if (done) return;
    setDone(true);
    onPlaying?.();
    onProgress?.({ current: 1, duration: 1, maxWatched: 1, percent: 100 });
    onEnded?.();
  };

  return (
    <div className="relative h-full w-full bg-black">
      <iframe
        title="Kirish video"
        src={`https://drive.google.com/file/d/${fileId}/preview`}
        className="absolute inset-0 h-full w-full border-0"
        allow="autoplay; fullscreen"
        allowFullScreen
      />
      {showHint && !done ? (
        <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-lg bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white">
          Videoni ko‘ring, so‘ng pastdagi tugmani bosing
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10">
        <button
          type="button"
          disabled={!canConfirm && !done}
          onClick={markDone}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
            done
              ? "bg-emerald-500 text-white"
              : canConfirm
                ? "bg-[#2AABEE] text-white hover:bg-[#1f96d4]"
                : "cursor-not-allowed bg-white/20 text-white/60",
          )}
        >
          {done ? "Video ko‘rildi ✓" : canConfirm ? "Videoni ko‘rib chiqdim" : "Video yuklanmoqda…"}
        </button>
      </div>
    </div>
  );
}

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type LockableOrientation = ScreenOrientation & {
  lock?: (o: string) => Promise<void>;
  unlock?: () => void;
};

/**
 * To‘liq ekran: brauzer Fullscreen API (Android/desktop), bo‘lmasa (iPhone) —
 * CSS orqali butun ekranga yoyiladi. Iframe ustidagi cheklov qatlamlari saqlanadi.
 */
function useExpandablePlayer() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const nativeRef = useRef(false);

  const fsElement = () => {
    const d = document as FsDocument;
    return d.fullscreenElement || d.webkitFullscreenElement || null;
  };

  const exit = useCallback(() => {
    const d = document as FsDocument;
    if (fsElement()) {
      try {
        void (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
      } catch {
        /* ignore */
      }
    }
    try {
      (screen.orientation as LockableOrientation | undefined)?.unlock?.();
    } catch {
      /* ignore */
    }
    nativeRef.current = false;
    setExpanded(false);
  }, []);

  const toggleExpanded = useCallback(async () => {
    if (expanded) {
      exit();
      return;
    }
    setExpanded(true);
    const el = wrapRef.current as FsElement | null;
    try {
      if (el?.requestFullscreen) {
        await el.requestFullscreen();
        nativeRef.current = true;
      } else if (el?.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
        nativeRef.current = true;
      }
    } catch {
      nativeRef.current = false;
    }
    try {
      await (screen.orientation as LockableOrientation | undefined)?.lock?.("landscape");
    } catch {
      /* ignore */
    }
  }, [expanded, exit]);

  useEffect(() => {
    const onChange = () => {
      if (nativeRef.current && !fsElement()) exit();
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [exit]);

  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded, exit]);

  return { wrapRef, expanded, toggleExpanded };
}

function useTransientControls() {
  const [showUi, setShowUi] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const reveal = useCallback(() => {
    setShowUi(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShowUi(false), 3500);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return { showUi, reveal };
}

/**
 * Video ustiga bosish (mobil): boshqaruv yashirin bo‘lsa — faqat ko‘rsatadi,
 * ko‘rinib turgan bo‘lsa — pauza qiladi.
 */
function TapSurface({
  playing,
  controlsVisible,
  onReveal,
  onPause,
}: {
  playing: boolean;
  controlsVisible: boolean;
  onReveal: () => void;
  onPause: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-20 touch-manipulation bg-transparent"
      onClick={(e) => {
        e.preventDefault();
        if (!playing) return;
        if (!controlsVisible) {
          onReveal();
          return;
        }
        onPause();
        onReveal();
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

function Controls({
  visible,
  playing,
  current,
  duration,
  maxWatched,
  expanded,
  showHint,
  onRewind,
  onSeekBack,
  onTogglePlay,
  onToggleExpanded,
  onInteract,
}: {
  visible: boolean;
  playing: boolean;
  current: number;
  duration: number;
  maxWatched: number;
  expanded?: boolean;
  showHint?: boolean;
  onRewind: () => void;
  onSeekBack: (t: number) => void;
  onTogglePlay: () => void;
  onToggleExpanded?: () => void;
  onInteract?: () => void;
}) {
  const dur = duration || 1;
  const watchedPct = Math.min(100, (maxWatched / dur) * 100);
  const nowPct = Math.min(100, (current / dur) * 100);
  const iconBtn =
    "flex h-8 w-8 shrink-0 touch-manipulation items-center justify-center rounded-full bg-white/15 text-white active:bg-white/30";

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 z-40 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-8 transition-opacity duration-200",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      onPointerDown={onInteract}
    >
      {showHint && !playing ? (
        <p className="mb-1 text-[10px] font-semibold text-[#F1C40F]">Pastdagi tugmani bosing</p>
      ) : null}
      <button
        type="button"
        className="relative mb-1 flex h-5 w-full touch-manipulation items-center"
        aria-label="Faqat orqaga o‘tish mumkin"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          const t = ratio * dur;
          if (t <= maxWatched + 0.05) onSeekBack(t);
        }}
      >
        <span className="relative block h-1 w-full overflow-hidden rounded-full bg-white/25">
          <span className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${watchedPct}%` }} />
          <span className="absolute inset-y-0 left-0 rounded-full bg-[#2AABEE]" style={{ width: `${nowPct}%` }} />
        </span>
        <span
          className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2AABEE] ring-1 ring-white"
          style={{ left: `${nowPct}%` }}
        />
      </button>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onTogglePlay}
          className={iconBtn}
          aria-label={playing ? "Pauza" : "Davom ettirish"}
        >
          {playing ? <Pause className="h-3.5 w-3.5 fill-white" /> : <Play className="ml-px h-3.5 w-3.5 fill-white" />}
        </button>
        <button
          type="button"
          onClick={onRewind}
          className="flex h-8 min-w-[4.25rem] touch-manipulation items-center justify-center gap-1 rounded-full bg-white/20 px-2 text-xs font-semibold text-white active:bg-white/35"
          aria-label="10 soniya orqaga"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          10 s
        </button>
        <span className="ml-auto text-[11px] tabular-nums text-white/90">
          {formatTime(current)} / {formatTime(duration)}
        </span>
        {onToggleExpanded ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            className={iconBtn}
            aria-label={expanded ? "Kichraytirish" : "To‘liq ekran"}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>
      {!playing ? (
        <p className="mt-1 text-[10px] text-white/60">Oldinga o‘tkazish yo‘q · orqaga qaytish mumkin</p>
      ) : null}
    </div>
  );
}

function Html5Restricted({
  src,
  poster,
  onEnded,
  onProgress,
  onPlaying,
  showHint,
  expanded,
  onToggleExpanded,
}: {
  src: string;
  poster?: string;
  onEnded?: () => void;
  onProgress?: (info: { current: number; duration: number; maxWatched: number; percent: number }) => void;
  onPlaying?: () => void;
  showHint?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const maxRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [maxWatched, setMaxWatched] = useState(0);
  const endedOnce = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const { showUi, reveal } = useTransientControls();

  const report = (el: HTMLVideoElement) => {
    const d = el.duration || 0;
    const t = el.currentTime;
    const max = maxRef.current;
    const percent = d > 0 ? Math.min(100, Math.floor((max / d) * 100)) : 0;
    onProgressRef.current?.({ current: t, duration: d, maxWatched: max, percent });
    if (!endedOnce.current && isFullyWatched(max, d)) {
      endedOnce.current = true;
      onEndedRef.current?.();
    }
  };

  const clampSeek = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.currentTime > maxRef.current + 2) {
      el.currentTime = maxRef.current;
    }
  }, []);

  return (
    <div className="relative h-full w-full bg-black">
      <video
        ref={ref}
        className="h-full w-full object-contain"
        src={src}
        poster={poster}
        playsInline
        controls={false}
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        onPlay={() => {
          setPlaying(true);
          onPlaying?.();
        }}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={() => setDuration(ref.current?.duration || 0)}
        onTimeUpdate={() => {
          const el = ref.current;
          if (!el) return;
        if (el.currentTime > maxRef.current + 2) {
          el.currentTime = maxRef.current;
          return;
        }
          maxRef.current = Math.max(maxRef.current, el.currentTime);
          setMaxWatched(maxRef.current);
          setCurrent(el.currentTime);
          report(el);
        }}
        onSeeking={clampSeek}
        onSeeked={clampSeek}
        onEnded={() => {
          const el = ref.current;
          if (!el) return;
          maxRef.current = Math.max(maxRef.current, el.duration || 0);
          setMaxWatched(maxRef.current);
          report(el);
        }}
      />
      {!playing ? (
        <button
          type="button"
          className="absolute left-1/2 top-[42%] z-30 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-900 shadow-md"
          aria-label="Play"
          onClick={() => {
            reveal();
            onPlaying?.();
            void ref.current?.play();
          }}
        >
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </button>
      ) : null}
      <TapSurface
        playing={playing}
        controlsVisible={showUi}
        onReveal={reveal}
        onPause={() => ref.current?.pause()}
      />
      <Controls
        visible={showUi || !playing}
        playing={playing}
        current={current}
        duration={duration}
        maxWatched={maxWatched}
        expanded={expanded}
        showHint={showHint}
        onToggleExpanded={onToggleExpanded}
        onInteract={reveal}
        onTogglePlay={() => {
          const el = ref.current;
          if (!el) return;
          reveal();
          if (el.paused) {
            onPlaying?.();
            void el.play();
          } else el.pause();
        }}
        onRewind={() => {
          const el = ref.current;
          if (!el) return;
          el.currentTime = Math.max(0, el.currentTime - 10);
        }}
        onSeekBack={(t) => {
          const el = ref.current;
          if (!el) return;
          el.currentTime = Math.min(t, maxRef.current);
        }}
      />
    </div>
  );
}

function YoutubeRestricted({
  id,
  onEnded,
  onProgress,
  onPlaying,
  showHint,
  expanded,
  onToggleExpanded,
}: {
  id: string;
  onEnded?: () => void;
  onProgress?: (info: { current: number; duration: number; maxWatched: number; percent: number }) => void;
  onPlaying?: () => void;
  showHint?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const maxRef = useRef(0);
  const endedOnce = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onPlayingRef = useRef(onPlaying);
  onPlayingRef.current = onPlaying;
  const { showUi, reveal } = useTransientControls();
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [maxWatched, setMaxWatched] = useState(0);

  const finishIfWatched = (max: number, d: number) => {
    if (endedOnce.current || !isFullyWatched(max, d)) return;
    endedOnce.current = true;
    onEndedRef.current?.();
  };

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    void loadYoutubeApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT?.Player) return;
      const player = new window.YT.Player(hostRef.current, {
        videoId: id,
        playerVars: {
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          cc_load_policy: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            hideYoutubeCaptions(player);
            if (!cancelled) setReady(true);
          },
          onStateChange: (e) => {
            hideYoutubeCaptions(player);
            const ended = window.YT?.PlayerState?.ENDED;
            const playingSt = window.YT?.PlayerState?.PLAYING ?? 1;
            if (e.data === playingSt) {
              setPlaying(true);
              onPlayingRef.current?.();
            }
            else setPlaying(false);
            if (typeof ended === "number" && e.data === ended) {
              const d = player.getDuration?.() || 0;
              if (isFullyWatched(maxRef.current, d)) {
                maxRef.current = Math.max(maxRef.current, d);
                finishIfWatched(maxRef.current, d);
              } else if (player.seekTo && maxRef.current > 0) {
                player.seekTo(maxRef.current, true);
                player.playVideo?.();
              }
            }
          },
        },
      });
      playerRef.current = player;
      timer = window.setInterval(() => {
        const p = playerRef.current;
        if (!p?.getCurrentTime) return;
        hideYoutubeCaptions(p);
        const t = p.getCurrentTime();
        const d = p.getDuration() || 0;
        if (t > maxRef.current + 2) {
          p.seekTo(maxRef.current, true);
          return;
        }
        maxRef.current = Math.max(maxRef.current, t);
        setMaxWatched(maxRef.current);
        setCurrent(t);
        if (d) setDuration(d);
        const percent = d > 0 ? Math.min(100, Math.floor((maxRef.current / d) * 100)) : 0;
        onProgressRef.current?.({
          current: t,
          duration: d,
          maxWatched: maxRef.current,
          percent,
        });
        finishIfWatched(maxRef.current, d);
      }, 250);
    });
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [id]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div className="pointer-events-none h-full w-full [&>iframe]:pointer-events-none [&>iframe]:h-full [&>iframe]:w-full">
        <div ref={hostRef} className="h-full w-full" />
      </div>
      {!ready && (
        <div className="absolute inset-0 z-0 flex items-center justify-center text-sm text-white/70">
          Video yuklanmoqda...
        </div>
      )}
      {!playing && ready ? (
        <button
          type="button"
          className="absolute left-1/2 top-[42%] z-30 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-900 shadow-md"
          aria-label="Play"
          onClick={() => {
            reveal();
            onPlaying?.();
            playerRef.current?.playVideo();
          }}
        >
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </button>
      ) : null}
      <TapSurface
        playing={playing}
        controlsVisible={showUi}
        onReveal={reveal}
        onPause={() => {
          if (ready) playerRef.current?.pauseVideo();
        }}
      />
      <Controls
        visible={ready && (showUi || !playing)}
        playing={playing}
        current={current}
        duration={duration}
        maxWatched={maxWatched}
        expanded={expanded}
        showHint={showHint}
        onToggleExpanded={onToggleExpanded}
        onInteract={reveal}
        onTogglePlay={() => {
          const p = playerRef.current;
          if (!p || !ready) return;
          reveal();
          if (playing) p.pauseVideo();
          else {
            onPlaying?.();
            p.playVideo();
          }
        }}
        onRewind={() => {
          const p = playerRef.current;
          if (!p) return;
          p.seekTo(Math.max(0, p.getCurrentTime() - 10), true);
        }}
        onSeekBack={(t) => {
          const p = playerRef.current;
          if (!p) return;
          p.seekTo(Math.min(t, maxRef.current), true);
        }}
      />
    </div>
  );
}
