/**
 * Konferensiya yozuvi (mijoz): sahna video + audio aralashtiriladi.
 * Tugagach blob qaytariladi — server Telegramga yuboradi va o‘chiradi.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";

type RecorderState = "idle" | "recording" | "stopping";

function pickMime(): string {
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "video/webm";
}

export function useRoomRecorder(room: Room | null, enabled: boolean, stageSelector = "[data-conference-stage]") {
  const [state, setState] = useState<RecorderState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const stopInternal = useCallback(async (): Promise<Blob | null> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") {
      setState("idle");
      return null;
    }
    setState("stopping");
    return new Promise((resolve) => {
      rec.onstop = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        try {
          void audioCtxRef.current?.close();
        } catch {
          /* ignore */
        }
        audioCtxRef.current = null;
        destRef.current = null;
        recorderRef.current = null;
        const blob = new Blob(chunksRef.current, { type: pickMime() });
        chunksRef.current = [];
        setState("idle");
        resolve(blob.size > 0 ? blob : null);
      };
      try {
        rec.stop();
      } catch {
        setState("idle");
        resolve(null);
      }
    });
  }, []);

  const start = useCallback(async () => {
    if (!enabled || !room || recorderRef.current) return;
    if (typeof MediaRecorder === "undefined") return;

    const stage = document.querySelector(stageSelector) as HTMLElement | null;
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    canvasRef.current = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const dest = audioCtx.createMediaStreamDestination();
    destRef.current = dest;

    // MediaElementSource LiveKit audio ni buzadi — faqat track MediaStream dan olamiz
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

    const draw = () => {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const videos = Array.from(
        (stage ?? document).querySelectorAll("video"),
      ) as HTMLVideoElement[];
      const live = videos.filter((v) => v.readyState >= 2 && v.videoWidth > 0);
      if (!live.length) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "28px sans-serif";
        ctx.fillText("Konferensiya yozilmoqda…", 40, 80);
      } else if (live.length === 1) {
        const v = live[0]!;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      } else {
        const cols = Math.ceil(Math.sqrt(live.length));
        const rows = Math.ceil(live.length / cols);
        const cellW = canvas.width / cols;
        const cellH = canvas.height / rows;
        live.forEach((v, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          ctx.drawImage(v, col * cellW, row * cellH, cellW, cellH);
        });
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    const videoStream = canvas.captureStream(12);
    const mixed = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const mime = pickMime();
    const rec = new MediaRecorder(mixed, {
      mimeType: mime,
      videoBitsPerSecond: 1_200_000,
      audioBitsPerSecond: 96_000,
    });
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.start(2000);
    recorderRef.current = rec;
    setState("recording");
  }, [enabled, room, stageSelector]);

  useEffect(() => {
    if (!enabled || !room) return;
    const t = window.setTimeout(() => {
      void start();
    }, 1500);
    return () => {
      window.clearTimeout(t);
      void stopInternal();
    };
  }, [enabled, room, start, stopInternal]);

  return { state, stop: stopInternal, isRecording: state === "recording" };
}
