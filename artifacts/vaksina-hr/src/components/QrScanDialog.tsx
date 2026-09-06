/**
 * Minimal QR scanner dialog — BarcodeDetector (Chrome/Safari) + getUserMedia.
 * Face ID talab qilinmaydi.
 */
import React, { useEffect, useRef, useState } from "react";
import { Camera, Loader2, QrCode, X } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const handling = useRef(false);

  useEffect(() => {
    if (!open) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError(null);
      setBusy(false);
      handling.current = false;
      return;
    }

    let cancelled = false;
    let raf = 0;
    const Detector = getBarcodeDetector();

    async function start() {
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            // Mobil: orqa kamera — QR skaner
            video: { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
          setError("Brauzer QR skanerni qo‘llab-quvvatlamaydi. QR matnini pastga joylashtiring.");
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
                } catch (e) {
                  setError(e instanceof Error ? e.message : "QR qabul qilinmadi");
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
        setError("Kameraga ruxsat berilmadi. QR matnini joylashtirishingiz mumkin.");
      }
    }

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, onDetected, onOpenChange]);

  async function submitManual() {
    const v = manual.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    try {
      await onDetected(v);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "QR qabul qilinmadi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="border-b border-border px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <QrCode className="h-4 w-4" />
            {title || "QR kod skanerlash"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {description || "Filial QR kodini kameraga tuting. Face ID kerak emas."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative aspect-[3/4] bg-black sm:aspect-video">
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-48 w-48 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          {busy ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : null}
        </div>

        <div className="space-y-2 p-4">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <div className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Yoki QR matnini joylashtiring…"
              className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
            />
            <Button type="button" disabled={busy || !manual.trim()} onClick={() => void submitManual()}>
              OK
            </Button>
          </div>
          <Button type="button" variant="outline" className="w-full gap-2" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
            Yopish
          </Button>
          <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
            <Camera className="h-3 w-3" />
            Orqa kamera · faqat skan vaqtida
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
