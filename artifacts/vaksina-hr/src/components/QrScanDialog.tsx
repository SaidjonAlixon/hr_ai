/**
 * Full-screen QR scanner.
 * Default: orqa kamera; old/orqa almashtirish mumkin.
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, QrCode, SwitchCamera, X } from "lucide-react";
import jsQR from "jsqr";
import { cn } from "@/lib/utils";
import { openCameraFast, warmCamera, type CameraFacing } from "@/lib/camera-fast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stream?: MediaStream | null;
  title?: string;
  description?: string;
  onDetected: (payload: string) => Promise<void> | void;
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

function getBarcodeDetector(): (new (opts?: { formats: string[] }) => BarcodeDetectorLike) | null {
  const w = window as unknown as { BarcodeDetector?: new (opts?: { formats: string[] }) => BarcodeDetectorLike };
  return w.BarcodeDetector || null;
}

export async function openScanCamera(): Promise<MediaStream> {
  return openCameraFast("environment");
}

export async function primeQrCamera(): Promise<boolean> {
  return warmCamera("environment");
}

export function QrScanDialog({ open, onOpenChange, stream: streamProp, onDetected, title, description }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ownedStreamRef = useRef<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  /** Default: orqa kamera */
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const facingRef = useRef<CameraFacing>("environment");
  facingRef.current = facing;
  const handling = useRef(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      ownedStreamRef.current?.getTracks().forEach((t) => t.stop());
      ownedStreamRef.current = null;
      setReady(false);
      setBusy(false);
      setOpening(false);
      setFacing("environment");
      facingRef.current = "environment";
      handling.current = false;
      return;
    }

    let cancelled = false;

    async function bind(stream: MediaStream) {
      const video = videoRef.current;
      if (!video || cancelled) return false;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      try {
        await video.play();
      } catch {
        /* ignore */
      }
      return video.readyState >= 1 || (video.srcObject as MediaStream | null)?.active === true;
    }

    async function start() {
      setReady(false);
      setOpening(true);
      handling.current = false;
      if (cancelled) return;

      let stream =
        facingRef.current === "environment" && streamProp && streamProp.active ? streamProp : null;
      if (!stream) {
        try {
          stream = await openCameraFast(facingRef.current);
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          ownedStreamRef.current = stream;
        } catch {
          if (!cancelled) {
            setReady(false);
            setOpening(false);
          }
          return;
        }
      }

      const ok = await bind(stream);
      if (!cancelled) {
        setReady(Boolean(ok) || stream.active);
        setOpening(false);
      }
    }

    void start();
    return () => {
      cancelled = true;
      ownedStreamRef.current?.getTracks().forEach((t) => t.stop());
      ownedStreamRef.current = null;
    };
  }, [open, streamProp, facing]);

  useEffect(() => {
    if (!open || !ready) return;
    let cancelled = false;
    const Detector = getBarcodeDetector();
    const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;

    const handleValue = async (value: string) => {
      if (handling.current || cancelled) return;
      handling.current = true;
      setBusy(true);
      try {
        await onDetectedRef.current(value);
        onOpenChange(false);
      } catch {
        handling.current = false;
        setBusy(false);
      }
    };

    const id = window.setInterval(() => {
      void (async () => {
        if (cancelled || handling.current) return;
        const v = videoRef.current;
        const canvas = canvasRef.current;
        if (!v || v.readyState < 2 || v.videoWidth <= 0) return;
        try {
          if (detector) {
            const codes = await detector.detect(v);
            const value = codes.find((c) => c.rawValue)?.rawValue?.trim();
            if (value) {
              await handleValue(value);
              return;
            }
          }
          if (canvas) {
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) return;
            const w = Math.min(v.videoWidth, 640);
            const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * w));
            if (canvas.width !== w) canvas.width = w;
            if (canvas.height !== h) canvas.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            const image = ctx.getImageData(0, 0, w, h);
            const code = jsQR(image.data, w, h, { inversionAttempts: "dontInvert" });
            if (code?.data?.trim()) await handleValue(code.data.trim());
          }
        } catch {
          /* skip */
        }
      })();
    }, 90);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, ready, onOpenChange]);

  const onTapCamera = async () => {
    setOpening(true);
    try {
      ownedStreamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await openCameraFast(facingRef.current);
      ownedStreamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play().catch(() => undefined);
      }
      setReady(true);
    } catch {
      setReady(false);
    } finally {
      setOpening(false);
    }
  };

  const switchCamera = () => {
    if (busy || opening) return;
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  };

  if (!open || typeof document === "undefined") return null;

  const heading = title?.trim() || "QR scanner";
  const hint =
    description?.trim() ||
    "QR kodni ramka ichiga joylashtiring — avtomatik o‘qiladi";

  return createPortal(
    <div className="fixed inset-0 z-[110] bg-black" role="dialog" aria-modal="true" aria-label={heading}>
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        autoPlay
      />
      <canvas ref={canvasRef} className="hidden" aria-hidden />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/80 via-black/45 to-transparent pb-16 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex items-start justify-between gap-3 px-4">
          <div className="min-w-0 flex-1 pt-1">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 ring-1 ring-white/25">
              <QrCode className="h-4 w-4 shrink-0 text-white" />
              <span className="text-xs font-semibold uppercase tracking-wide text-white">QR</span>
            </div>
            <h2 className="mt-2 text-lg font-bold leading-tight text-white drop-shadow-sm sm:text-xl">
              {heading}
            </h2>
            <p className="mt-1 max-w-[18rem] text-sm leading-snug text-white/85 sm:max-w-sm">{hint}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label={facing === "environment" ? "Old kamera" : "Orqa kamera"}
              disabled={busy || opening}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/35 active:scale-95 disabled:opacity-50"
              onClick={switchCamera}
            >
              {opening ? <Loader2 className="h-5 w-5 animate-spin" /> : <SwitchCamera className="h-5 w-5" />}
            </button>
            <button
              type="button"
              aria-label="Yopish"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/35 active:scale-95"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>
      </div>

      {ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
          <div
            className={cn(
              "relative rounded-[1.35rem] border-[3px] border-white",
              "h-[min(72vw,300px)] w-[min(72vw,300px)]",
              "shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]",
            )}
          >
            <span className="absolute -left-1 -top-1 h-10 w-10 rounded-tl-[1.35rem] border-l-[4px] border-t-[4px] border-emerald-400" />
            <span className="absolute -right-1 -top-1 h-10 w-10 rounded-tr-[1.35rem] border-r-[4px] border-t-[4px] border-emerald-400" />
            <span className="absolute -bottom-1 -left-1 h-10 w-10 rounded-bl-[1.35rem] border-b-[4px] border-l-[4px] border-emerald-400" />
            <span className="absolute -bottom-1 -right-1 h-10 w-10 rounded-br-[1.35rem] border-b-[4px] border-r-[4px] border-emerald-400" />
            <div className="absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 overflow-hidden rounded-full">
              <div className="h-full w-full animate-pulse bg-emerald-400/80" />
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-label="Camera"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/70 px-6"
          onClick={() => void onTapCamera()}
          disabled={opening}
        >
          {opening ? (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-white" />
              <p className="text-base font-semibold text-white">Kamera ochilmoqda…</p>
            </>
          ) : (
            <>
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-white/20 ring-2 ring-white/50 animate-pulse">
                <svg viewBox="0 0 24 24" className="h-11 w-11 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </span>
              <p className="max-w-[16rem] text-center text-base font-semibold text-white">
                Kamerani yoqish uchun bosing
              </p>
            </>
          )}
        </button>
      )}

      {ready && !busy ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/85 via-black/50 to-transparent pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16">
          <p className="mx-auto max-w-[20rem] px-4 text-center text-sm font-medium leading-snug text-white">
            QR kodni yashil burchakli ramka ichiga tuting
            <span className="mt-1 block text-xs text-white/60">
              {facing === "environment" ? "Orqa kamera" : "Old kamera"} · almashtirish tugmasi yuqorida
            </span>
          </p>
        </div>
      ) : null}

      {busy ? (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/55">
          <Loader2 className="h-11 w-11 animate-spin text-white" />
          <p className="text-sm font-medium text-white">Tasdiqlanmoqda…</p>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
