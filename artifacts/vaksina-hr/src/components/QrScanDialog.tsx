/**
 * Full-screen QR scanner — faqat kamera, matnsiz.
 * Face ID talab qilinmaydi. Orqa kamera.
 */
import React, { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function QrScanDialog({ open, onOpenChange, title, description, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [camOk, setCamOk] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const handling = useRef(false);

  useEffect(() => {
    if (!open) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setBusy(false);
      setCamOk(true);
      handling.current = false;
      return;
    }

    let cancelled = false;
    let raf = 0;
    const Detector = getBarcodeDetector();

    async function start() {
      setCamOk(true);
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { exact: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }

        if (!Detector) {
          setCamOk(false);
          return;
        }

        const detector = new Detector({ formats: ["qr_code"] });
        const tick = async () => {
          if (cancelled || handling.current) {
            raf = requestAnimationFrame(tick);
            return;
          }
          const v = videoRef.current;
          if (v && v.readyState >= 2) {
            try {
              const codes = await detector.detect(v);
              const value = codes.find((c) => c.rawValue)?.rawValue?.trim();
              if (value) {
                handling.current = true;
                setBusy(true);
                try {
                  await onDetected(value);
                  onOpenChange(false);
                } catch {
                  handling.current = false;
                  setBusy(false);
                }
              }
            } catch {
              /* ignore frame errors */
            }
          }
          if (!cancelled) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setCamOk(false);
      }
    }

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, onDetected, onOpenChange, retryKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className={cn(
          "fixed inset-0 left-0 top-0 z-50 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0",
          "gap-0 overflow-hidden rounded-none border-0 bg-black p-0 shadow-none",
          "max-h-none data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
          "data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0",
          "data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0",
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(90dvh,720px)] sm:w-[min(100vw-2rem,420px)]",
          "sm:max-w-[420px] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl",
        )}
      >
        <DialogTitle className="sr-only">{title || "QR"}</DialogTitle>
        <DialogDescription className="sr-only">{description || "QR"}</DialogDescription>

        <div className="relative h-full w-full bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            muted
            autoPlay
          />

          {/* QR frame — faqat vizual */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={cn(
                "relative rounded-[1.25rem] border-2 border-white/90",
                "h-[min(68vw,280px)] w-[min(68vw,280px)]",
                "shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]",
              )}
            >
              <span className="absolute -left-0.5 -top-0.5 h-8 w-8 rounded-tl-[1.25rem] border-l-[3px] border-t-[3px] border-white" />
              <span className="absolute -right-0.5 -top-0.5 h-8 w-8 rounded-tr-[1.25rem] border-r-[3px] border-t-[3px] border-white" />
              <span className="absolute -bottom-0.5 -left-0.5 h-8 w-8 rounded-bl-[1.25rem] border-b-[3px] border-l-[3px] border-white" />
              <span className="absolute -bottom-0.5 -right-0.5 h-8 w-8 rounded-br-[1.25rem] border-b-[3px] border-r-[3px] border-white" />
            </div>
          </div>

          {!camOk ? (
            <button
              type="button"
              aria-label="Retry camera"
              className="absolute inset-0 z-10 flex items-center justify-center bg-black"
              onClick={() => setRetryKey((k) => k + 1)}
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30">
                <svg viewBox="0 0 24 24" className="h-8 w-8 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </span>
            </button>
          ) : null}

          {busy ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
              <Loader2 className="h-10 w-10 animate-spin text-white" />
            </div>
          ) : null}

          <button
            type="button"
            aria-label="Close"
            className="absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/25 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
