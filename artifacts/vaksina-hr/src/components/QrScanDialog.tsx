/**
 * Full-screen QR scanner.
 * Default: orqa kamera; old/orqa almashtirish va chiroq (torch) mumkin.
 * Kamera ochilishi tez: bosish paytidagi prefetch oqimi olinadi, kadr kelmasa avtomatik qayta ulanadi.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Camera, Flashlight, FlashlightOff, Loader2, QrCode, RefreshCw, SwitchCamera, X } from "lucide-react";
import jsQR from "jsqr";
import { cn } from "@/lib/utils";
import {
  cameraErrorCode,
  clearCameraDeviceCache,
  openCameraFast,
  prefetchCamera,
  warmCamera,
  type CameraFacing,
} from "@/lib/camera-fast";

function cameraErrorText(err: unknown): string {
  switch (cameraErrorCode(err)) {
    case "camera_denied":
      return "Kameraga ruxsat berilmagan. Brauzer sozlamalarida shu saytga kamera ruxsatini bering.";
    case "camera_busy":
      return "Kamera boshqa ilovada band. Boshqa ilovalarni yopib, qayta bosing.";
    case "camera_not_found":
      return "Kamera topilmadi. Qurilmada kamera borligini tekshiring.";
    case "camera_timeout":
      return "Kamera javob bermadi. Qayta bosing.";
    case "secure_context":
    case "camera_unsupported":
      return "Bu brauzer kamerani qo‘llamaydi — Chrome yoki Safari’da oching.";
    default:
      return "Kamera ochilmadi. Qayta bosing.";
  }
}

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

type TorchCaps = { torch?: boolean };

export function QrScanDialog({ open, onOpenChange, stream: streamProp, onDetected, title, description }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ownedStreamRef = useRef<MediaStream | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Default: orqa kamera */
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const facingRef = useRef<CameraFacing>("environment");
  facingRef.current = facing;
  const [retryKey, setRetryKey] = useState(0);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const handling = useRef(false);
  const autoReopen = useRef(0);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

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
      activeStreamRef.current = null;
      setReady(false);
      setBusy(false);
      setOpening(false);
      setError(null);
      setFacing("environment");
      facingRef.current = "environment";
      setTorchOn(false);
      setTorchSupported(false);
      handling.current = false;
      autoReopen.current = 0;
      return;
    }

    let cancelled = false;
    let frameWatch: number | null = null;

    async function bind(stream: MediaStream) {
      let video = videoRef.current;
      for (let i = 0; !video && i < 30 && !cancelled; i++) {
        await new Promise((r) => window.setTimeout(r, 50));
        video = videoRef.current;
      }
      if (!video || cancelled) return false;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.setAttribute("autoplay", "true");
      if (video.readyState < 1) {
        await Promise.race([
          new Promise<void>((resolve) => {
            const onMeta = () => {
              video!.removeEventListener("loadedmetadata", onMeta);
              resolve();
            };
            video!.addEventListener("loadedmetadata", onMeta);
          }),
          new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
        ]);
      }
      try {
        await video.play();
      } catch {
        /* ignore */
      }
      if (video.paused || video.readyState < 2) {
        try {
          video.srcObject = stream;
          await video.play();
        } catch {
          /* ignore */
        }
      }
      // Birinchi haqiqiy kadrni qisqa kutamiz (iOS qora ekran)
      if (video.readyState < 2) {
        for (let i = 0; i < 20 && !cancelled && video.readyState < 2; i++) {
          await new Promise((r) => window.setTimeout(r, 100));
        }
      }
      return video.readyState >= 2 && video.videoWidth >= 8;
    }

    const stopOwned = () => {
      ownedStreamRef.current?.getTracks().forEach((t) => t.stop());
      ownedStreamRef.current = null;
    };

    /** Kadr kelmay qolsa (Android/iOS qotishi) — avtomatik qayta ulash */
    const watchFrames = (stream: MediaStream) => {
      if (frameWatch != null) window.clearTimeout(frameWatch);
      frameWatch = window.setTimeout(() => {
        frameWatch = null;
        if (cancelled || activeStreamRef.current !== stream) return;
        const video = videoRef.current;
        const track = stream.getVideoTracks()[0];
        const alive = track?.readyState === "live";
        const hasFrames = Boolean(video && video.readyState >= 2 && video.videoWidth >= 8);
        if (alive && hasFrames) {
          autoReopen.current = 0;
          return;
        }
        if (alive && video && video.paused) void video.play().catch(() => undefined);
        if (autoReopen.current < 2) {
          autoReopen.current += 1;
          clearCameraDeviceCache(facingRef.current);
          setRetryKey((k) => k + 1);
        } else {
          setReady(false);
          setError(cameraErrorText(new Error("camera_failed")));
        }
      }, 3000);
    };

    async function start() {
      setReady(false);
      setOpening(true);
      handling.current = false;
      setError(null);
      setTorchOn(false);

      let stream: MediaStream | null =
        facingRef.current === "environment" && streamProp && streamProp.active ? streamProp : null;
      if (!stream) {
        try {
          stream = await openCameraFast(facingRef.current);
        } catch (e) {
          if (!cancelled) {
            setReady(false);
            setOpening(false);
            setError(cameraErrorText(e));
          }
          return;
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ownedStreamRef.current = stream;
      }

      activeStreamRef.current = stream;
      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (!cancelled && activeStreamRef.current === stream) setRetryKey((k) => k + 1);
        });
        track.addEventListener("unmute", () => {
          const v = videoRef.current;
          if (v && v.paused) void v.play().catch(() => undefined);
        });
      });

      const ok = await bind(stream);
      if (cancelled) return;
      if (!ok) {
        // Qora preview — keshni tozalab, bir marta qayta ochamiz
        clearCameraDeviceCache(facingRef.current);
        stopOwned();
        activeStreamRef.current = null;
        if (autoReopen.current >= 2) {
          setReady(false);
          setOpening(false);
          setError(cameraErrorText(new Error("camera_failed")));
          return;
        }
        autoReopen.current += 1;
        try {
          await new Promise((r) => window.setTimeout(r, 250));
          if (cancelled) return;
          const again = await openCameraFast(facingRef.current);
          if (cancelled) {
            again.getTracks().forEach((t) => t.stop());
            return;
          }
          ownedStreamRef.current = again;
          activeStreamRef.current = again;
          const ok2 = await bind(again);
          if (cancelled) return;
          setReady(ok2 || again.active);
          setOpening(false);
          if (ok2) {
            autoReopen.current = 0;
            const caps = again.getVideoTracks()[0]?.getCapabilities?.() as TorchCaps | undefined;
            setTorchSupported(Boolean(caps?.torch));
          } else {
            watchFrames(again);
          }
        } catch (e) {
          if (!cancelled) {
            setReady(false);
            setOpening(false);
            setError(cameraErrorText(e));
          }
        }
        return;
      }

      autoReopen.current = 0;
      const caps = stream.getVideoTracks()[0]?.getCapabilities?.() as TorchCaps | undefined;
      setTorchSupported(Boolean(caps?.torch));
      setReady(true);
      setOpening(false);
      watchFrames(stream);
    }

    // Telefon ilovani almashtirib qaytsa — preview to‘xtab qolgan bo‘lishi mumkin
    const onVisible = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      const stream = activeStreamRef.current;
      if (!stream) return;
      const live = stream.getVideoTracks().some((t) => t.readyState === "live");
      if (!live) {
        setRetryKey((k) => k + 1);
        return;
      }
      const v = videoRef.current;
      if (v && v.paused) void v.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);

    void start();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (frameWatch != null) window.clearTimeout(frameWatch);
      const v = videoRef.current;
      if (v) {
        try {
          v.srcObject = null;
        } catch {
          /* ignore */
        }
      }
      stopOwned();
      activeStreamRef.current = null;
    };
  }, [open, streamProp, facing, retryKey]);

  // Skan sikli: oldingi kadr tugagach keyingisi (qotish/yig‘ilib qolish yo‘q)
  useEffect(() => {
    if (!open || !ready) return;
    let cancelled = false;
    let timer: number | null = null;
    const Detector = getBarcodeDetector();
    let detector: BarcodeDetectorLike | null = null;
    try {
      detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
    } catch {
      detector = null;
    }
    let frameNo = 0;

    const handleValue = async (value: string) => {
      if (handling.current || cancelled) return;
      handling.current = true;
      try {
        navigator.vibrate?.(60);
      } catch {
        /* ignore */
      }
      setBusy(true);
      try {
        await onDetectedRef.current(value);
        onOpenChangeRef.current(false);
      } catch (e) {
        setBusy(false);
        setError((e as Error)?.message || "QR qabul qilinmadi — qayta urinib ko‘ring");
        // Xuddi shu QR qayta-qayta o‘qilib xato chaqnab turmasin
        window.setTimeout(() => {
          if (cancelled) return;
          handling.current = false;
          setError(null);
        }, 3000);
      }
    };

    const scanOnce = async () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || v.videoWidth <= 0 || v.paused) {
        if (v && v.paused && v.srcObject) void v.play().catch(() => undefined);
        return;
      }
      frameNo += 1;
      if (detector) {
        try {
          const codes = await detector.detect(v);
          const value = codes.find((c) => c.rawValue)?.rawValue?.trim();
          if (value) {
            await handleValue(value);
            return;
          }
        } catch {
          // Format qo‘llanmaydi — jsQR ga o‘tamiz
          detector = null;
        }
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      const w = Math.min(v.videoWidth, 720);
      const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * w));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      const image = ctx.getImageData(0, 0, w, h);
      const code = jsQR(image.data, w, h, {
        inversionAttempts: frameNo % 3 === 0 ? "attemptBoth" : "dontInvert",
      });
      if (code?.data?.trim()) await handleValue(code.data.trim());
    };

    const tick = async () => {
      if (cancelled) return;
      if (!handling.current) {
        try {
          await scanOnce();
        } catch {
          /* skip */
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), detector ? 60 : 100);
    };
    timer = window.setTimeout(() => void tick(), 120);

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [open, ready]);

  const onTapCamera = useCallback(() => {
    if (opening) return;
    // Bosish paytida (user gesture) kamerani boshlaymiz — iOS/Android ishonchli
    clearCameraDeviceCache(facingRef.current);
    autoReopen.current = 0;
    setError(null);
    ownedStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    prefetchCamera(facingRef.current);
    setRetryKey((k) => k + 1);
  }, [opening]);

  const switchCamera = () => {
    if (busy || opening) return;
    setError(null);
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  };

  const toggleTorch = async () => {
    const track = activeStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  const heading = title?.trim() || "QR scanner";
  const hint = description?.trim() || "QR kodni ramka ichiga joylashtiring — avtomatik o‘qiladi";
  const frameSize = "min(70vw, 288px)";

  return createPortal(
    <div
      className="cam-sheet-in fixed inset-0 z-[110] overflow-hidden bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
    >
      <video
        ref={videoRef}
        className={cn(
          "absolute inset-0 h-full w-full bg-black object-cover transition-opacity duration-300",
          ready ? "opacity-100" : "opacity-0",
          facing === "user" && "-scale-x-100",
        )}
        playsInline
        muted
        autoPlay
      />
      <canvas ref={canvasRef} className="hidden" aria-hidden />

      {/* Yuqori panel */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/75 via-black/35 to-transparent pb-14 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto flex items-center justify-between gap-3 px-4">
          <button
            type="button"
            aria-label="Yopish"
            className="cam-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white active:scale-95"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="cam-glass mx-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5">
              <QrCode className="h-3.5 w-3.5 text-emerald-300" />
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/90">QR</span>
            </div>
            <h2 className="mt-1.5 truncate text-[17px] font-bold leading-tight text-white drop-shadow">{heading}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {torchSupported && ready ? (
              <button
                type="button"
                aria-label={torchOn ? "Chiroqni o‘chirish" : "Chiroqni yoqish"}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full active:scale-95",
                  torchOn ? "bg-amber-300 text-black" : "cam-glass text-white",
                )}
                onClick={() => void toggleTorch()}
              >
                {torchOn ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
              </button>
            ) : null}
            <button
              type="button"
              aria-label={facing === "environment" ? "Old kamera" : "Orqa kamera"}
              disabled={busy || opening}
              className="cam-glass flex h-11 w-11 items-center justify-center rounded-full text-white active:scale-95 disabled:opacity-50"
              onClick={switchCamera}
            >
              {opening ? <Loader2 className="h-5 w-5 animate-spin" /> : <SwitchCamera className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Skan ramkasi */}
      {ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
          <div
            className="relative rounded-[28px] shadow-[0_0_0_9999px_rgba(0,0,0,0.58)]"
            style={{ width: frameSize, height: frameSize, ["--cam-scan-h" as string]: `calc(${frameSize} - 8px)` }}
          >
            <span className="absolute -left-0.5 -top-0.5 h-11 w-11 rounded-tl-[28px] border-l-[5px] border-t-[5px] border-emerald-400" />
            <span className="absolute -right-0.5 -top-0.5 h-11 w-11 rounded-tr-[28px] border-r-[5px] border-t-[5px] border-emerald-400" />
            <span className="absolute -bottom-0.5 -left-0.5 h-11 w-11 rounded-bl-[28px] border-b-[5px] border-l-[5px] border-emerald-400" />
            <span className="absolute -bottom-0.5 -right-0.5 h-11 w-11 rounded-br-[28px] border-b-[5px] border-r-[5px] border-emerald-400" />
            {!busy ? (
              <div className="absolute inset-x-3 top-1">
                <div className="cam-scan-line h-[3px] w-full rounded-full bg-gradient-to-r from-transparent via-emerald-300 to-transparent shadow-[0_0_14px_2px_rgba(52,211,153,0.7)]" />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black px-6">
          <button
            type="button"
            aria-label="Kamerani yoqish"
            onClick={onTapCamera}
            disabled={opening}
            className="relative flex h-28 w-28 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/25 transition active:scale-95 disabled:opacity-90"
          >
            {!opening && !error ? <span className="cam-pulse-ring absolute inset-0 rounded-full ring-2 ring-emerald-400/60" /> : null}
            {opening ? (
              <Loader2 className="h-11 w-11 animate-spin text-white" />
            ) : error ? (
              <RefreshCw className="h-10 w-10 text-white/90" />
            ) : (
              <Camera className="h-11 w-11 text-white" />
            )}
          </button>
          <div className="text-center">
            <p className="text-base font-semibold text-white">
              {opening ? "Kamera ochilmoqda…" : error ? "Kamerani qayta yoqing" : "Kamerani yoqish uchun bosing"}
            </p>
            {!opening && !error ? <p className="mt-1 text-sm text-white/60">{hint}</p> : null}
          </div>
          {error && !opening ? (
            <div className="flex max-w-[20rem] items-start gap-2.5 rounded-2xl border border-rose-400/30 bg-rose-500/15 px-3.5 py-3 text-left text-sm leading-snug text-rose-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
              <span>{error}</span>
            </div>
          ) : null}
          {error && !opening ? (
            <button
              type="button"
              onClick={onTapCamera}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-bold text-zinc-900 active:scale-95"
            >
              <RefreshCw className="h-4 w-4" />
              Qayta urinish
            </button>
          ) : null}
        </div>
      )}

      {ready && error && !busy ? (
        <div className="pointer-events-none absolute inset-x-4 top-[24%] z-40 mx-auto flex max-w-sm items-center gap-2 rounded-2xl bg-rose-600/95 px-4 py-3 text-sm font-semibold leading-snug text-white shadow-xl ring-1 ring-white/20">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Pastki panel */}
      {ready && !busy ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16">
          <div className="cam-glass mx-auto flex max-w-sm items-center gap-3 rounded-2xl px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-400/20 text-emerald-300">
              <QrCode className="h-5 w-5" />
            </span>
            <div className="min-w-0 text-left">
              <p className="text-sm font-semibold leading-snug text-white">{hint}</p>
              <p className="mt-0.5 text-[11px] text-white/55">
                {facing === "environment" ? "Orqa kamera" : "Old kamera"} · yaqinroq yoki uzoqroq tuting
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {busy ? (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm">
          <Loader2 className="h-11 w-11 animate-spin text-emerald-300" />
          <p className="text-sm font-semibold text-white">Tasdiqlanmoqda…</p>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
