/**
 * Konferensiya yozuvi: qo‘lda boshlash/to‘xtatish yoki avtomatik + vaqt limiti.
 * To‘xtagach blob qaytariladi — Telegram guruhiga yuboriladi, platformadan o‘chiriladi.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";

type RecorderState = "idle" | "recording" | "stopping";

export type RoomRecorderControls = {
  state: RecorderState;
  isRecording: boolean;
  elapsedSec: number;
  /** null = cheksiz */
  remainingSec: number | null;
  limitSec: number | null;
  start: (limitMinutes?: number | null) => Promise<boolean>;
  stop: () => Promise<Blob | null>;
};

function pickMime(): string {
  // Avvalo MP4 (qo‘llab-quvvatlansa), aks holda yuqori sifatli WebM → serverda MP4 ga o‘tkaziladi
  const types = [
    "video/mp4;codecs=avc1.4D401F,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "video/webm";
}

/** Video katak ichida proporsiyani saqlab chizish (letterbox) */
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
  const scale = Math.min(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.fillStyle = "#020617";
  ctx.fillRect(x, y, w, h);
  ctx.drawImage(video, dx, dy, dw, dh);
}

const REC_W = 1920;
const REC_H = 1080;
const REC_FPS = 24;
const REC_VIDEO_BPS = 4_500_000;
const REC_AUDIO_BPS = 160_000;

export function useRoomRecorder(
  room: Room | null,
  opts: {
    canRecord: boolean;
    /** Moderator kirganda avtomatik boshlash */
    autoStart?: boolean;
    /** Default limit (daq). 0 / null = cheksiz */
    defaultLimitMinutes?: number | null;
    stageSelector?: string;
    /** Limit tugaganda yoki to‘xtaganda (avtomatik) */
    onStopped?: (blob: Blob | null, reason: "manual" | "limit" | "unmount") => void;
  },
): RoomRecorderControls {
  const {
    canRecord,
    autoStart = false,
    defaultLimitMinutes = null,
    stageSelector = "[data-conference-stage]",
    onStopped,
  } = opts;

  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [limitSec, setLimitSec] = useState<number | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const startedAtRef = useRef<number>(0);
  const limitTimerRef = useRef<number>(0);
  const tickTimerRef = useRef<number>(0);
  const onStoppedRef = useRef(onStopped);
  onStoppedRef.current = onStopped;
  const stopInternalRef = useRef<(reason: "manual" | "limit" | "unmount") => Promise<Blob | null>>(
    async () => null,
  );

  const cleanupMedia = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (limitTimerRef.current) window.clearTimeout(limitTimerRef.current);
    limitTimerRef.current = 0;
    if (tickTimerRef.current) window.clearInterval(tickTimerRef.current);
    tickTimerRef.current = 0;
    try {
      void audioCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    audioCtxRef.current = null;
  };

  const stopInternal = useCallback(async (reason: "manual" | "limit" | "unmount"): Promise<Blob | null> => {
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
        const out = blob.size > 0 ? blob : null;
        // Faqat avtomatik limit — qo‘lda to‘xtatishni chaqiruvchi o‘zi yuboradi
        if (reason === "limit") onStoppedRef.current?.(out, reason);
        resolve(out);
      };
      try {
        rec.stop();
      } catch {
        cleanupMedia();
        recorderRef.current = null;
        setState("idle");
        resolve(null);
      }
    });
  }, []);

  stopInternalRef.current = stopInternal;

  const start = useCallback(
    async (limitMinutes?: number | null): Promise<boolean> => {
      if (!canRecord || !room || recorderRef.current) return false;
      if (typeof MediaRecorder === "undefined") return false;

      const stage = document.querySelector(stageSelector) as HTMLElement | null;
      const canvas = document.createElement("canvas");
      canvas.width = REC_W;
      canvas.height = REC_H;
      const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
      if (!ctx) return false;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const dest = audioCtx.createMediaStreamDestination();

      const connectTrack = (mediaTrack: MediaStreamTrack) => {
        try {
          const ms = new MediaStream([mediaTrack]);
          const src = audioCtx.createMediaStreamSource(ms);
          src.connect(dest);
        } catch {
          /* ignore */
        }
      };

      try {
        for (const pub of room.localParticipant.audioTrackPublications.values()) {
          if (pub.track?.mediaStreamTrack) connectTrack(pub.track.mediaStreamTrack);
        }
        for (const p of room.remoteParticipants.values()) {
          for (const pub of p.audioTrackPublications.values()) {
            if (pub.track?.mediaStreamTrack) connectTrack(pub.track.mediaStreamTrack);
          }
        }
      } catch {
        /* ignore */
      }

      const gap = 8;
      const draw = () => {
        ctx.fillStyle = "#020617";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const videos = Array.from((stage ?? document).querySelectorAll("video")) as HTMLVideoElement[];
        const pool = videos.filter((v) => v.readyState >= 2 && v.videoWidth > 0);
        if (!pool.length) {
          ctx.fillStyle = "#94a3b8";
          ctx.font = "bold 36px Segoe UI, sans-serif";
          ctx.fillText("Konferensiya yozilmoqda…", 48, 96);
        } else if (pool.length === 1) {
          drawContain(ctx, pool[0]!, 0, 0, canvas.width, canvas.height);
        } else {
          const n = pool.length;
          const cols = Math.ceil(Math.sqrt(n));
          const rows = Math.ceil(n / cols);
          const cellW = (canvas.width - gap * (cols + 1)) / cols;
          const cellH = (canvas.height - gap * (rows + 1)) / rows;
          pool.forEach((v, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = gap + col * (cellW + gap);
            const y = gap + row * (cellH + gap);
            // yumshoq burchak maskasi
            ctx.save();
            const r = 12;
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + cellW, y, x + cellW, y + cellH, r);
            ctx.arcTo(x + cellW, y + cellH, x, y + cellH, r);
            ctx.arcTo(x, y + cellH, x, y, r);
            ctx.arcTo(x, y, x + cellW, y, r);
            ctx.closePath();
            ctx.clip();
            drawContain(ctx, v, x, y, cellW, cellH);
            ctx.restore();
          });
        }
        rafRef.current = requestAnimationFrame(draw);
      };
      draw();

      const videoStream = canvas.captureStream(REC_FPS);
      const mixed = new MediaStream([...videoStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mime = pickMime();
      const rec = new MediaRecorder(mixed, {
        mimeType: mime,
        videoBitsPerSecond: REC_VIDEO_BPS,
        audioBitsPerSecond: REC_AUDIO_BPS,
      });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.start(1000);
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
    [canRecord, room, stageSelector, defaultLimitMinutes],
  );

  // Avtomatik boshlash (sozlamadan)
  useEffect(() => {
    if (!canRecord || !room || !autoStart) return;
    const t = window.setTimeout(() => {
      void start(defaultLimitMinutes);
    }, 1800);
    return () => window.clearTimeout(t);
  }, [canRecord, room, autoStart, start, defaultLimitMinutes]);

  // Unmount — to‘xtatish (yubormasdan)
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
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
