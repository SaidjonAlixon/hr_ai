import React, { useEffect, useRef, useState } from "react";
import { ScanFace, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  averageDescriptors,
  detectFaceDescriptor,
  ensureFaceModels,
  isFaceIdSupported,
} from "@/lib/face-id";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "enroll" | "login";
  onCaptured: (descriptor: number[]) => Promise<void>;
};

const ENROLL_SAMPLES = 5;

export function FaceScanDialog({ open, onOpenChange, mode, onCaptured }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCapturedRef = useRef(onCaptured);
  onCapturedRef.current = onCaptured;
  const [hint, setHint] = useState("Kamera ochilmoqda…");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const samples: number[][] = [];
    let running = true;

    const stopCamera = () => {
      running = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    const start = async () => {
      setError(null);
      setBusy(false);
      if (!isFaceIdSupported()) {
        setError("Kamera faqat localhost yoki HTTPS da ishlaydi");
        return;
      }
      try {
        setHint("Model yuklanmoqda…");
        await ensureFaceModels();
        if (cancelled) return;
        setHint("Kamera ochilmoqda…");
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setHint("Yuzingizni ramkaga tuting");

        const loop = async () => {
          if (!running || cancelled) return;
          const videoEl = videoRef.current;
          if (videoEl && videoEl.readyState >= 2) {
            try {
              const desc = await detectFaceDescriptor(videoEl);
              if (desc && running && !cancelled) {
                samples.push(desc);
                if (mode === "enroll") {
                  setHint(`Yuz aniqlandi ${Math.min(samples.length, ENROLL_SAMPLES)}/${ENROLL_SAMPLES}`);
                  if (samples.length >= ENROLL_SAMPLES) {
                    running = false;
                    setBusy(true);
                    setHint("Yuz saqlanmoqda…");
                    try {
                      await onCapturedRef.current(averageDescriptors(samples.slice(0, ENROLL_SAMPLES)));
                      stopCamera();
                      onOpenChange(false);
                    } catch (err) {
                      setError((err as Error)?.message || "Saqlanmadi");
                      setBusy(false);
                      samples.length = 0;
                      running = true;
                    }
                    if (running && !cancelled) window.setTimeout(() => void loop(), 400);
                    return;
                  }
                } else {
                  running = false;
                  setBusy(true);
                  setHint("Yuz tekshirilmoqda…");
                  try {
                    await onCapturedRef.current(desc);
                    stopCamera();
                    onOpenChange(false);
                    return;
                  } catch (err) {
                    setError((err as Error)?.message || "Yuz mos kelmadi");
                    setBusy(false);
                    running = true;
                  }
                }
              } else {
                setHint("Yuzingizni kameraga yaqinroq tuting");
              }
            } catch (err) {
              if (!cancelled) setError((err as Error)?.message || "Face ID xatosi");
              return;
            }
          }
          if (running && !cancelled) window.setTimeout(() => void loop(), 280);
        };
        void loop();
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError") {
          setError("Kameraga ruxsat bering");
        } else {
          setError((err as Error)?.message || "Kamera ochilmadi");
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, mode, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-4 sm:p-5" hideClose>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanFace className="h-5 w-5" />
            {mode === "enroll" ? "Face ID ni ulash" : "Face ID bilan kirish"}
          </DialogTitle>
          <DialogDescription>
            Kameraga qarang. Google parol so‘ralmaydi — faqat yuzingiz.
          </DialogDescription>
        </DialogHeader>
        <div className="relative overflow-hidden rounded-xl bg-black aspect-[4/3]">
          <video
            ref={videoRef}
            className="h-full w-full object-cover -scale-x-100"
            playsInline
            muted
            autoPlay
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-48 w-36 rounded-full border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
          </div>
        </div>
        <p className="text-center text-sm text-slate-600 min-h-5">
          {busy ? <Loader2 className="inline h-4 w-4 animate-spin mr-1" /> : null}
          {error || hint}
        </p>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          <X className="mr-1.5 h-4 w-4" />
          Bekor qilish
        </Button>
      </DialogContent>
    </Dialog>
  );
}
