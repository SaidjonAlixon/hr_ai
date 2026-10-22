/**
 * Konferensiya yozuvi: LiveKit kamera/ekran + barcha ovozlar.
 * DOM stage emas — barcha ishtirokchilar gridda; ekran ulashilsa asosiy kadr.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Track, type Participant, type Room } from "livekit-client";

type RecorderState = "idle" | "recording" | "stopping";

export type RoomRecorderControls = {
  state: RecorderState;
  isRecording: boolean;
  elapsedSec: number;
  remainingSec: number | null;
  limitSec: number | null;
  start: (limitMinutes?: number | null) => Promise<boolean>;
  stop: () => Promise<Blob | null>;
};

function pickMime(): string {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1.4D401F,mp4a.40.2",
    "video/mp4",
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "video/webm";
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  if (!vw || !vh) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(x, y, w, h);
    return;
  }
  const scale = Math.min(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.fillStyle = "#020617";
  ctx.fillRect(x, y, w, h);
  ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
  if (!vw || !vh) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(x, y, w, h);
    return;
  }
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

type Tile = { video: HTMLVideoElement; name: string; screen: boolean; identity: string };
type BagEntry = { el: HTMLVideoElement; sid: string; track: { detach: (el: HTMLMediaElement) => void } };

function collectTiles(room: Room, bag: Map<string, BagEntry>): Tile[] {
  const tiles: Tile[] = [];
  const alive = new Set<string>();

  const ensure = (
    key: string,
    track: { attach: (el: HTMLMediaElement) => HTMLMediaElement; detach: (el: HTMLMediaElement) => void; sid?: string },
    name: string,
    screen: boolean,
    identity: string,
  ) => {
    const sid = track.sid || key;
    alive.add(key);
    let entry = bag.get(key);
    if (!entry) {
      const el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.autoplay = true;
      el.setAttribute("playsinline", "true");
      entry = { el, sid: "", track };
      bag.set(key, entry);
    }
    // Faqat trek o‘zgaganda attach — har kadrda emas (qotish sababi edi)
    if (entry.sid !== sid) {
      try {
        if (entry.sid) entry.track.detach(entry.el);
      } catch {
        /* */
      }
      entry.sid = sid;
      entry.track = track;
      try {
        track.attach(entry.el);
        void entry.el.play().catch(() => undefined);
      } catch {
        /* */
      }
    }
    tiles.push({ video: entry.el, name, screen, identity });
  };

  const addPub = (p: Participant, screen: boolean) => {
    const src = screen ? Track.Source.ScreenShare : Track.Source.Camera;
    const pub = p.getTrackPublication(src);
    const track = pub?.track;
    if (!track || pub.isMuted) return;
    const name = p.name || p.identity || "Ishtirokchi";
    ensure(`${p.identity}:${screen ? "screen" : "cam"}`, track, name, screen, p.identity);
  };

  const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  for (const p of all) {
    addPub(p, true);
    addPub(p, false);
  }
  for (const [key, entry] of bag) {
    if (alive.has(key)) continue;
    try {
      entry.track.detach(entry.el);
    } catch {
      /* */
    }
    bag.delete(key);
  }
  return tiles;
}

/** Asosiy kadr: ekran > gapiruvchi > birinchi kamera; qolganlar pastki strip */
function pickMainAndStrip(tiles: Tile[], room: Room): { main: Tile | null; strip: Tile[] } {
  const ready = tiles.filter((t) => t.video.readyState >= 2 && t.video.videoWidth > 0);
  if (!ready.length) return { main: null, strip: [] };
  const screens = ready.filter((t) => t.screen);
  const cams = ready.filter((t) => !t.screen);
  if (screens.length) {
    return { main: screens[0]!, strip: cams };
  }
  const speakers = room.activeSpeakers ?? [];
  let main: Tile | null = null;
  for (const sp of speakers) {
    const hit = cams.find((c) => c.identity === sp.identity);
    if (hit) {
      main = hit;
      break;
    }
  }
  if (!main) main = cams[0] ?? null;
  const strip = cams.filter((c) => c !== main);
  return { main, strip };
}

function drawMainPlusStrip(
  ctx: CanvasRenderingContext2D,
  main: Tile,
  strip: Tile[],
  canvasW: number,
  canvasH: number,
  gap: number,
  labelH: number,
) {
  const stripH = strip.length ? Math.round(canvasH * 0.22) : 0;
  const mainH = canvasH - stripH - (strip.length ? gap : 0);
  if (main.screen) drawContain(ctx, main.video, gap, gap, canvasW - gap * 2, mainH - gap);
  else drawCover(ctx, main.video, gap, gap, canvasW - gap * 2, mainH - gap);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(gap, gap + mainH - gap - labelH, canvasW - gap * 2, labelH);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 22px Segoe UI, sans-serif";
  ctx.fillText(`${main.screen ? "🖥 " : "🎤 "}${main.name}`.slice(0, 48), gap + 14, gap + mainH - gap - 12);

  if (!strip.length || !stripH) return;
  const maxStrip = Math.min(strip.length, 8);
  const shown = strip.slice(0, maxStrip);
  const cellW = (canvasW - gap * (shown.length + 1)) / shown.length;
  shown.forEach((t, i) => {
    const x = gap + i * (cellW + gap);
    const y = mainH + gap;
    drawCover(ctx, t.video, x, y, cellW, stripH - gap);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, y + stripH - gap - 28, cellW, 28);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px Segoe UI, sans-serif";
    ctx.fillText(t.name.slice(0, 22), x + 6, y + stripH - gap - 8);
  });
}

function connectAllAudio(room: Room, audioCtx: AudioContext, dest: MediaStreamAudioDestinationNode, linked: Set<string>) {
  const link = (id: string, mediaTrack: MediaStreamTrack) => {
    if (linked.has(id) || mediaTrack.readyState !== "live") return;
    try {
      const src = audioCtx.createMediaStreamSource(new MediaStream([mediaTrack]));
      src.connect(dest);
      linked.add(id);
    } catch {
      /* */
    }
  };
  const scan = (p: Participant) => {
    for (const pub of p.audioTrackPublications.values()) {
      const t = pub.track?.mediaStreamTrack;
      if (t) link(`${p.identity}:${pub.trackSid || t.id}`, t);
    }
  };
  scan(room.localParticipant);
  for (const p of room.remoteParticipants.values()) scan(p);
}

/** 720p — Full HD o‘rniga: UI qotmasin, sifat hali yaxshi */
const REC_W = 1280;
const REC_H = 720;
const REC_FPS = 24;
const REC_VIDEO_BPS = 2_200_000;
const REC_AUDIO_BPS = 128_000;
const FRAME_MS = Math.round(1000 / REC_FPS);

export function useRoomRecorder(
  room: Room | null,
  opts: {
    canRecord: boolean;
    autoStart?: boolean;
    defaultLimitMinutes?: number | null;
    /** @deprecated DOM stage endi ishlatilmaydi — LiveKit treklar */
    stageSelector?: string;
    onStopped?: (blob: Blob | null, reason: "manual" | "limit" | "unmount" | "leave") => void;
  },
): RoomRecorderControls {
  const { canRecord, autoStart = false, defaultLimitMinutes = null, onStopped } = opts;

  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [limitSec, setLimitSec] = useState<number | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const videoBagRef = useRef<Map<string, BagEntry>>(new Map());
  const audioLinkedRef = useRef<Set<string>>(new Set());
  const startedAtRef = useRef<number>(0);
  const limitTimerRef = useRef<number>(0);
  const tickTimerRef = useRef<number>(0);
  const audioPollRef = useRef<number>(0);
  const lastFrameAtRef = useRef<number>(0);
  const autoStartedRef = useRef(false);
  const onStoppedRef = useRef(onStopped);
  onStoppedRef.current = onStopped;
  const stopInternalRef = useRef<(reason: "manual" | "limit" | "unmount" | "leave") => Promise<Blob | null>>(
    async () => null,
  );

  const cleanupMedia = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (limitTimerRef.current) window.clearTimeout(limitTimerRef.current);
    limitTimerRef.current = 0;
    if (tickTimerRef.current) window.clearInterval(tickTimerRef.current);
    tickTimerRef.current = 0;
    if (audioPollRef.current) window.clearInterval(audioPollRef.current);
    audioPollRef.current = 0;
    for (const entry of videoBagRef.current.values()) {
      try {
        entry.track.detach(entry.el);
      } catch {
        /* */
      }
      try {
        entry.el.srcObject = null;
      } catch {
        /* */
      }
    }
    videoBagRef.current.clear();
    audioLinkedRef.current.clear();
    try {
      void audioCtxRef.current?.close();
    } catch {
      /* */
    }
    audioCtxRef.current = null;
  };

  const stopInternal = useCallback(async (reason: "manual" | "limit" | "unmount" | "leave"): Promise<Blob | null> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") {
      cleanupMedia();
      setState("idle");
      setElapsedSec(0);
      setLimitSec(null);
      return null;
    }
    setState("stopping");
    return new Promise((resolve) => {
      rec.onstop = () => {
        cleanupMedia();
        recorderRef.current = null;
        const mime = rec.mimeType || pickMime();
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        setState("idle");
        setElapsedSec(0);
        setLimitSec(null);
        const out = blob.size > 800 ? blob : null;
        if (reason === "limit" || reason === "leave") onStoppedRef.current?.(out, reason);
        resolve(out);
      };
      try {
        if (rec.state === "recording") rec.requestData();
      } catch {
        /* */
      }
      window.setTimeout(() => {
        try {
          rec.stop();
        } catch {
          cleanupMedia();
          recorderRef.current = null;
          setState("idle");
          resolve(null);
        }
      }, 120);
    });
  }, []);

  stopInternalRef.current = stopInternal;

  const start = useCallback(
    async (limitMinutes?: number | null): Promise<boolean> => {
      if (!canRecord || !room || recorderRef.current) return false;
      if (typeof MediaRecorder === "undefined") return false;

      const canvas = document.createElement("canvas");
      canvas.width = REC_W;
      canvas.height = REC_H;
      const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
      if (!ctx) return false;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";

      const audioCtx = new AudioContext();
      try {
        if (audioCtx.state === "suspended") await audioCtx.resume();
      } catch {
        /* */
      }
      audioCtxRef.current = audioCtx;
      const dest = audioCtx.createMediaStreamDestination();
      audioLinkedRef.current = new Set();
      connectAllAudio(room, audioCtx, dest, audioLinkedRef.current);
      audioPollRef.current = window.setInterval(() => {
        if (!recorderRef.current || !audioCtxRef.current) return;
        connectAllAudio(room, audioCtxRef.current, dest, audioLinkedRef.current);
      }, 2000);

      const gap = 10;
      const labelH = 36;
      lastFrameAtRef.current = 0;
      const draw = (now: number) => {
        // Capture 24fps — display 60/120Hz da ortiqcha chizilmasin
        if (now - lastFrameAtRef.current < FRAME_MS - 2) {
          rafRef.current = requestAnimationFrame(draw);
          return;
        }
        lastFrameAtRef.current = now;
        // Tab yashirin bo‘lsa ham chizamiz — aks holda qora/qisqa video chiqadi
        ctx.fillStyle = "#020617";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const tiles = collectTiles(room, videoBagRef.current);
        const { main, strip } = pickMainAndStrip(tiles, room);

        if (!main) {
          ctx.fillStyle = "#94a3b8";
          ctx.font = "bold 40px Segoe UI, sans-serif";
          ctx.fillText("Konferensiya yozilmoqda…", 56, 100);
          ctx.font = "28px Segoe UI, sans-serif";
          ctx.fillText("Kamera yoki ekran ulashing", 56, 150);
        } else {
          // Ekran yoki gapiruvchi — katta; qolganlar pastida (hamma ko‘rinadi)
          drawMainPlusStrip(ctx, main, strip, canvas.width, canvas.height, gap, labelH);
        }
        rafRef.current = requestAnimationFrame(draw);
      };
      rafRef.current = requestAnimationFrame(draw);

      const videoStream = canvas.captureStream(REC_FPS);
      const mixed = new MediaStream([...videoStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mime = pickMime();
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(mixed, {
          mimeType: mime,
          videoBitsPerSecond: REC_VIDEO_BPS,
          audioBitsPerSecond: REC_AUDIO_BPS,
        });
      } catch {
        rec = new MediaRecorder(mixed);
      }
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      // 1s emas — 2s chunks: qisqa chiqishda ham yetarli ma’lumot
      rec.start(2000);
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      setState("recording");

      const lim =
        limitMinutes === undefined
          ? defaultLimitMinutes && defaultLimitMinutes > 0
            ? defaultLimitMinutes
            : null
          : limitMinutes && limitMinutes > 0
            ? limitMinutes
            : null;
      const limMs = lim ? lim * 60_000 : null;
      setLimitSec(limMs ? Math.round(limMs / 1000) : null);

      tickTimerRef.current = window.setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);

      if (limMs) {
        limitTimerRef.current = window.setTimeout(() => {
          void stopInternalRef.current("limit");
        }, limMs);
      }
      return true;
    },
    [canRecord, room, defaultLimitMinutes],
  );

  // Avtomatik boshlash — faqat bir marta, sozlama tayyor bo‘lgach
  useEffect(() => {
    if (!canRecord || !room || !autoStart) return;
    if (autoStartedRef.current) return;
    const t = window.setTimeout(() => {
      if (autoStartedRef.current || recorderRef.current) return;
      autoStartedRef.current = true;
      void start(defaultLimitMinutes && defaultLimitMinutes > 0 ? defaultLimitMinutes : null);
    }, 2200);
    return () => window.clearTimeout(t);
  }, [canRecord, room, autoStart, start, defaultLimitMinutes]);

  useEffect(() => {
    return () => {
      void stopInternalRef.current("unmount");
    };
  }, []);

  const remainingSec =
    limitSec == null || state !== "recording" ? null : Math.max(0, limitSec - elapsedSec);

  return {
    state,
    isRecording: state === "recording",
    elapsedSec,
    remainingSec,
    limitSec: state === "recording" ? limitSec : null,
    start,
    stop: () => stopInternal("manual"),
  };
}

export function formatRecClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
