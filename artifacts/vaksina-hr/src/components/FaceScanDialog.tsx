import React, { useEffect, useRef, useState } from "react";
import { Loader2, ScanFace, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  averageDescriptorsRobust,
  detectFaceDescriptor,
  ensureFaceModels,
  faceAlignHint,
  isFaceIdSupported,
  isStableSample,
  type FaceAlignStatus,
  type FaceOvalFrame,
} from "@/lib/face-id";
import { cn } from "@/lib/utils";

type CaptureResult = { fullName?: string } | void;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "enroll" | "login";
  onCaptured: (descriptor: number[], snapshot?: string) => Promise<CaptureResult>;
  title?: string;
  description?: string;
};

function grabFaceSnapshot(video: HTMLVideoElement | null): string | undefined {
  if (!video || video.videoWidth < 8) return undefined;
  try {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cropW = Math.round(Math.min(vw, vh * 0.78));
    const cropH = Math.round(Math.min(vh, cropW * 1.25));
    const sx = Math.max(0, Math.round((vw - cropW) / 2));
    const sy = Math.max(0, Math.round((vh - cropH) * 0.28));
    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = Math.min(cropH, vh - sy);
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } catch {
    return undefined;
  }
}

const ENROLL_SAMPLES = 9;
const LOGIN_STREAK = 4;
const MIN_SCORE_ENROLL = 0.7;
const MIN_SCORE_LOGIN = 0.65;

export function FaceScanDialog({ open, onOpenChange, mode, onCaptured, title, description }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ovalRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCapturedRef = useRef(onCaptured);
  onCapturedRef.current = onCaptured;

  const [hint, setHint] = useState("Kamera ochilmoqda…");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aligned, setAligned] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open) {
      setAligned(false);
      setProgress(0);
      setBusy(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const samples: number[][] = [];
    let loginStreak = 0;
    let running = true;
    let lastDesc: number[] | null = null;

    const stopCamera = () => {
      running = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    const readFrame = (): FaceOvalFrame | null => {
      const video = videoRef.current;
      const oval = ovalRef.current;
      if (!video || !oval) return null;
      const vr = video.getBoundingClientRect();
      const or = oval.getBoundingClientRect();
      if (vr.width < 8 || or.width < 8) return null;
      return {
        cx: or.left + or.width / 2 - vr.left,
        cy: or.top + or.height / 2 - vr.top,
        rx: or.width / 2,
        ry: or.height / 2,
      };
    };

    const start = async () => {
      setError(null);
      setBusy(false);
      setAligned(false);
      setProgress(0);
      lastDesc = null;
      samples.length = 0;
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
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
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
        setHint(
          mode === "enroll"
            ? "Yuzni oval ichiga joylashtiring — bir necha aniq kadr olinadi"
            : "Yuzni oval ichiga tuting",
        );

        const minScore = mode === "enroll" ? MIN_SCORE_ENROLL : MIN_SCORE_LOGIN;

        const loop = async () => {
          if (!running || cancelled) return;
          const videoEl = videoRef.current;
          if (videoEl && videoEl.readyState >= 2) {
            try {
              const result = await detectFaceDescriptor(videoEl, readFrame(), true);
              const alignStatus: FaceAlignStatus = result.status;
              const inFrame = alignStatus === "ok";
              setAligned(inFrame);

              if (!inFrame) {
                loginStreak = 0;
                lastDesc = null;
                if (mode === "enroll" && samples.length > 0) {
                  samples.length = 0;
                  setProgress(0);
                }
                setHint(faceAlignHint(alignStatus));
              } else if (!result.descriptor || (result.score ?? 0) < minScore) {
                setHint(faceAlignHint("low_quality"));
                loginStreak = 0;
              } else if (!isStableSample(lastDesc, result.descriptor)) {
                lastDesc = result.descriptor;
                loginStreak = 0;
                setHint(faceAlignHint("hold_still"));
              } else {
                lastDesc = result.descriptor;
                const desc = result.descriptor;

                if (mode === "enroll") {
                  samples.push(desc);
                  setProgress(Math.min(samples.length, ENROLL_SAMPLES));
                  setHint(`Aniq kadr ${Math.min(samples.length, ENROLL_SAMPLES)}/${ENROLL_SAMPLES}`);
                  if (samples.length >= ENROLL_SAMPLES) {
                    running = false;
                    setBusy(true);
                    setHint("Yuz saqlanmoqda…");
                    try {
                      await onCapturedRef.current(
                        averageDescriptorsRobust(samples.slice(0, ENROLL_SAMPLES)),
                        grabFaceSnapshot(videoEl),
                      );
                      stopCamera();
                      onOpenChange(false);
                    } catch (err) {
                      setError((err as Error)?.message || "Saqlanmadi");
                      setBusy(false);
                      samples.length = 0;
                      setProgress(0);
                      lastDesc = null;
                      running = true;
                    }
                    if (running && !cancelled) window.setTimeout(() => void loop(), 400);
                    return;
                  }
                } else {
                  loginStreak += 1;
                  setProgress(loginStreak);
                  setHint(faceAlignHint("ok"));
                  if (loginStreak >= LOGIN_STREAK) {
                    running = false;
                    setBusy(true);
                    setHint("Yuz tekshirilmoqda…");
                    try {
                      const captured = await onCapturedRef.current(desc, grabFaceSnapshot(videoEl));
                      const name =
                        captured && typeof captured === "object" && captured.fullName
                          ? captured.fullName.trim()
                          : "";
                      if (name) {
                        setError(null);
                        setHint(`Xush kelibsiz, ${name}`);
                        await new Promise((r) => window.setTimeout(r, 800));
                      }
                      stopCamera();
                      onOpenChange(false);
                      return;
                    } catch (err) {
                      setError((err as Error)?.message || "Bu yuz aniqlanmadi.");
                      setBusy(false);
                      loginStreak = 0;
                      setProgress(0);
                      lastDesc = null;
                      running = true;
                    }
                  }
                }
              }
            } catch (err) {
              if (!cancelled) setError((err as Error)?.message || "Face ID xatosi");
              return;
            }
          }
          if (running && !cancelled) window.setTimeout(() => void loop(), 85);
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

  const steps = mode === "enroll" ? ENROLL_SAMPLES : LOGIN_STREAK;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="w-[calc(100%-0.75rem)] max-w-md gap-3 overflow-hidden rounded-2xl p-3 sm:gap-4 sm:p-5 max-h-[100dvh]"
      >
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <ScanFace className="h-5 w-5 text-[#0b3a5c]" />
            {title || (mode === "enroll" ? "Face ID ni ulash" : "Face ID bilan kirish")}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {description ||
              (mode === "enroll"
                ? "Kameraga to‘g‘ri qarang — bir necha aniq kadr olinadi."
                : "Kameraga qarang — yuzingiz aniqlanadi.")}
          </DialogDescription>
        </DialogHeader>

        <div className="relative mx-auto w-full overflow-hidden rounded-3xl bg-zinc-950 aspect-[3/4] max-h-[min(56dvh,420px)] sm:aspect-[4/3] sm:max-h-[min(48vh,360px)]">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover -scale-x-100"
            playsInline
            muted
            autoPlay
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              ref={ovalRef}
              className={cn(
                "w-[68%] max-w-[230px] aspect-[3/4] rounded-full border-[3px] transition-all duration-200 sm:w-[52%] sm:max-w-[210px]",
                aligned
                  ? "border-emerald-400 shadow-[0_0_0_999px_rgba(0,0,0,0.58),0_0_28px_rgba(52,211,153,0.55)]"
                  : "border-white/85 shadow-[0_0_0_999px_rgba(0,0,0,0.58)]",
              )}
            />
          </div>
          {aligned ? (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
              <span className="rounded-full bg-emerald-500/90 px-3 py-1 text-[11px] font-medium text-white">
                Yuz aniq ✓
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex justify-center gap-1.5">
          {Array.from({ length: steps }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-6 rounded-full transition-colors",
                i < progress ? "bg-emerald-500" : "bg-slate-200",
              )}
            />
          ))}
        </div>

        <p
          className={cn(
            "min-h-5 text-center text-sm",
            error ? "text-red-600" : aligned ? "text-emerald-700" : "text-slate-600",
          )}
        >
          {busy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
          {error || hint}
        </p>
        <Button type="button" variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
          <X className="mr-1.5 h-4 w-4" />
          Bekor qilish
        </Button>
      </DialogContent>
    </Dialog>
  );
}
