/**
 * Konferensiya yozuvi: LiveKit kamera/ekran + barcha ovozlar.
 * — Oddiy: barcha ishtirokchilar to‘liq grid.
 * — Tashkilotchi (yoki kimdir) ekran ulasa: faqat shu ekran to‘liq kadr.
 * — Ekran yopilsa: yana hammasi grid.
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

type Tile = {
  video: HTMLVideoElement | null;
  name: string;
  screen: boolean;
  identity: string;
  userId: number;
  speaking?: boolean;
};
type BagEntry = { el: HTMLVideoElement; sid: string; track: { detach: (el: HTMLMediaElement) => void } };

function uidOfParticipant(p: Participant): number {
  const fromAttr = Number(p.attributes?.uid);
  if (Number.isInteger(fromAttr) && fromAttr > 0) return fromAttr;
  const m = /^u(\d+)$/.exec(p.identity);
  return m ? Number(m[1]) : 0;
}

function collectTiles(room: Room, bag: Map<string, BagEntry>): Tile[] {
  const tiles: Tile[] = [];
  const alive = new Set<string>();
  const speakers = new Set((room.activeSpeakers ?? []).map((s) => s.identity));

  const ensureVideo = (
    key: string,
    track: { attach: (el: HTMLMediaElement) => HTMLMediaElement; detach: (el: HTMLMediaElement) => void; sid?: string },
  ): HTMLVideoElement => {
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
    return entry.el;
  };

  const all: Participant[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
  // Avval ekranlar
  for (const p of all) {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    const track = pub?.track;
    if (!track || pub.isMuted) continue;
    const name = p.name || p.identity || "Ishtirokchi";
    const el = ensureVideo(`${p.identity}:screen`, track);
    tiles.push({
      video: el,
      name,
      screen: true,
      identity: p.identity,
      userId: uidOfParticipant(p),
      speaking: speakers.has(p.identity),
    });
  }
  // Keyin kameralar (kamera o‘chiq ham — placeholder)
  for (const p of all) {
    const name = p.name || p.identity || "Ishtirokchi";
    const pub = p.getTrackPublication(Track.Source.Camera);
    const track = pub?.track;
    let video: HTMLVideoElement | null = null;
    if (track && !pub?.isMuted) {
      video = ensureVideo(`${p.identity}:cam`, track);
    }
    tiles.push({
      video,
      name,
      screen: false,
      identity: p.identity,
      userId: uidOfParticipant(p),
      speaking: speakers.has(p.identity),
    });
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

function videoReady(el: HTMLVideoElement | null): boolean {
  return Boolean(el && el.readyState >= 2 && el.videoWidth > 0);
}

/** Ekran ulashilgan bo‘lsa — faqat shu (tashkilotchi afzal); aks holda barcha kameralar */
function pickLayout(
  tiles: Tile[],
  hostUserId?: number | null,
): { mode: "screen"; screen: Tile } | { mode: "grid"; cams: Tile[] } | { mode: "empty" } {
  const screens = tiles.filter((t) => t.screen && videoReady(t.video));
  if (screens.length) {
    const hostScreen =
      hostUserId && hostUserId > 0 ? screens.find((s) => s.userId === hostUserId) : undefined;
    return { mode: "screen", screen: hostScreen ?? screens[0]! };
  }
  const cams = tiles.filter((t) => !t.screen);
  // Unique by identity
  const seen = new Set<string>();
  const unique: Tile[] = [];
  for (const c of cams) {
    if (seen.has(c.identity)) continue;
    seen.add(c.identity);
    unique.push(c);
  }
  if (!unique.length) return { mode: "empty" };
  return { mode: "grid", cams: unique };
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  speaking?: boolean,
) {
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(x, y, w, h);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
  const r = Math.min(w, h) * 0.18;
  ctx.fillStyle = speaking ? "#0ea5e9" : "#1e293b";
  ctx.beginPath();
  ctx.arc(x + w / 2, y + h / 2 - 8, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.max(16, Math.round(r * 0.9))}px Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials || "?", x + w / 2, y + h / 2 - 8);
  ctx.font = `bold ${Math.max(12, Math.round(h * 0.055))}px Segoe UI, sans-serif`;
  ctx.fillText(name.slice(0, 28), x + w / 2, y + h - Math.max(18, h * 0.08));
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawFullScreenShare(
  ctx: CanvasRenderingContext2D,
  screen: Tile,
  canvasW: number,
  canvasH: number,
) {
  if (!screen.video || !videoReady(screen.video)) {
    drawPlaceholder(ctx, screen.name, 0, 0, canvasW, canvasH);
    return;
  }
  // To‘liq kadr — strip yo‘q
  drawContain(ctx, screen.video, 0, 0, canvasW, canvasH);
  const labelH = 40;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, canvasH - labelH, canvasW, labelH);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 22px Segoe UI, sans-serif";
  ctx.fillText(`🖥 ${screen.name} · ekran`.slice(0, 60), 16, canvasH - 12);
}

function gridCols(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  if (n <= 16) return 4;
  return 5;
}

function drawParticipantGrid(
  ctx: CanvasRenderingContext2D,
  cams: Tile[],
  canvasW: number,
  canvasH: number,
  gap: number,
) {
  const n = cams.length;
  const cols = gridCols(n);
  const rows = Math.ceil(n / cols);
  const cellW = (canvasW - gap * (cols + 1)) / cols;
  const cellH = (canvasH - gap * (rows + 1)) / rows;
  cams.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gap + col * (cellW + gap);
    const y = gap + row * (cellH + gap);
    if (t.video && videoReady(t.video)) drawCover(ctx, t.video, x, y, cellW, cellH);
    else drawPlaceholder(ctx, t.name, x, y, cellW, cellH, t.speaking);
    if (t.speaking) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 2, y + 2, cellW - 4, cellH - 4);
    }
    const labelH = Math.min(32, Math.round(cellH * 0.16));
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, y + cellH - labelH, cellW, labelH);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(12, Math.round(labelH * 0.55))}px Segoe UI, sans-serif`;
    ctx.fillText(t.name.slice(0, 28), x + 8, y + cellH - Math.max(8, labelH * 0.28));
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
    /** Tashkilotchi userId — ekran ulasa faqat uniki to‘liq yoziladi */
    hostUserId?: number | null;
    /** @deprecated DOM stage endi ishlatilmaydi — LiveKit treklar */
    stageSelector?: string;
    onStopped?: (blob: Blob | null, reason: "manual" | "limit" | "unmount" | "leave") => void;
  },
): RoomRecorderControls {
  const { canRecord, autoStart = false, defaultLimitMinutes = null, hostUserId = null, onStopped } = opts;
  const hostUserIdRef = useRef(hostUserId);
  hostUserIdRef.current = hostUserId;

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
        const layout = pickLayout(tiles, hostUserIdRef.current);

        if (layout.mode === "screen") {
          // Tashkilotchi/ekran ulash — faqat to‘liq ekran (strip yo‘q)
          drawFullScreenShare(ctx, layout.screen, canvas.width, canvas.height);
        } else if (layout.mode === "grid") {
          // Ekran yo‘q — barcha ishtirokchilar to‘liq grid
          drawParticipantGrid(ctx, layout.cams, canvas.width, canvas.height, gap);
        } else {
          ctx.fillStyle = "#94a3b8";
          ctx.font = "bold 40px Segoe UI, sans-serif";
          ctx.fillText("Konferensiya yozilmoqda…", 56, 100);
          ctx.font = "28px Segoe UI, sans-serif";
          ctx.fillText("Kamera yoki ekran ulashing", 56, 150);
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
