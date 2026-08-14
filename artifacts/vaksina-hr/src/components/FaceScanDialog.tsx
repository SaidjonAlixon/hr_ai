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
  detectFaceLiveness,
  ensureFaceModels,
  faceAlignHint,
  isFaceIdSupported,
  LivenessTracker,
  type FaceAlignStatus,
  type FaceOvalFrame,
} from "@/lib/face-id";
import { cn } from "@/lib/utils";

type CaptureResult = { fullName?: string } | void;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "enroll" | "login";
  onCaptured: (descriptor: number[]) => Promise<CaptureResult>;
  title?: string;
  description?: string;
};

const ENROLL_SAMPLES = 5;
const LOGIN_STREAK = 2;

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
  const [liveOk, setLiveOk] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open) {
      setAligned(false);
      setLiveOk(false);
      setProgress(0);
      setBusy(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const samples: number[][] = [];
    let loginStreak = 0;
    let running = true;
    const liveness = new LivenessTracker();

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
      setLiveOk(false);
      setProgress(0);
      liveness.reset();
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
            width: { ideal: 720 },
            height: { ideal: 960 },
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
        setHint("Yuzingizni oval ramka ichiga tuting");

        const loop = async () => {
          if (!running || cancelled) return;
          const videoEl = videoRef.current;
          if (videoEl && videoEl.readyState >= 2) {
            try {
              // Liveness gacha tez landmark; keyin to‘liq descriptor
              const needDesc = liveness.isLive;
              const result = needDesc
                ? await detectFaceDescriptor(videoEl, readFrame(), true)
                : await detectFaceLiveness(videoEl, readFrame(), true);
              const alignStatus: FaceAlignStatus = result.status;
              const inFrame = alignStatus === "ok";
              setAligned(inFrame);

              if (!inFrame) {
                loginStreak = 0;
                if (mode === "enroll" && samples.length > 0) {
                  samples.length = 0;
                  setProgress(0);
                }
                if (alignStatus === "no_face") {
                  liveness.reset();
                  setLiveOk(false);
                }
                setHint(faceAlignHint(alignStatus));
              } else {
                const liveStatus = liveness.update(result.ear);
                const isLive = liveness.isLive;
                setLiveOk(isLive);

                if (!isLive) {
                  loginStreak = 0;
                  setHint(faceAlignHint(liveStatus));
                } else {
                  // Jonli tasdiqlandi — descriptor olish (agar hali yo‘q bo‘lsa)
                  let desc = result.descriptor;
                  if (!desc) {
                    const full = await detectFaceDescriptor(videoEl, readFrame(), true);
                    if (full.status !== "ok" || !full.descriptor) {
                      setHint(faceAlignHint(full.status === "ok" ? "no_face" : full.status));
                      if (running && !cancelled) window.setTimeout(() => void loop(), 80);
                      return;
                    }
                    desc = full.descriptor;
                  }
                  if (mode === "enroll") {
                    samples.push(desc);
                    setProgress(Math.min(samples.length, ENROLL_SAMPLES));
                    setHint(`Jonli yuz ${Math.min(samples.length, ENROLL_SAMPLES)}/${ENROLL_SAMPLES}`);
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
                        setProgress(0);
                        liveness.reset();
                        setLiveOk(false);
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
                        const captured = await onCapturedRef.current(desc);
                        const name =
                          captured && typeof captured === "object" && captured.fullName
                            ? captured.fullName.trim()
                            : "";
                        if (name) {
                          setError(null);
                          setHint(`Xush kelibsiz, ${name}`);
                          setLiveOk(true);
                          await new Promise((r) => window.setTimeout(r, 1100));
                        }
                        stopCamera();
                        onOpenChange(false);
                        return;
                      } catch (err) {
                        setError(
                          (err as Error)?.message ||
                            "Bu yuz aniqlanmadi. Ro‘yxatdan o‘ting.",
                        );
                        setBusy(false);
                        loginStreak = 0;
                        setProgress(0);
                        liveness.reset();
                        setLiveOk(false);
                        running = true;
                      }
                    }
                  }
                }
              }
            } catch (err) {
              if (!cancelled) setError((err as Error)?.message || "Face ID xatosi");
              return;
            }
          }
          if (running && !cancelled) window.setTimeout(() => void loop(), needDescDelay(liveness.isLive));
        };

        function needDescDelay(isLive: boolean) {
          return isLive ? 100 : 55;
        }
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
  const ready = aligned && liveOk;

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
              "Rasm bilan ochilmaydi. Ko‘zni ochiq tuting, keyin buyruqda SEKIN 2 marta yumib oching (tez miltillash o‘tmaydi)."}
          </DialogDescription>
        </DialogHeader>

        <div className="relative mx-auto w-full overflow-hidden rounded-3xl bg-zinc-950 aspect-[3/4] max-h-[min(62dvh,440px)] sm:aspect-[4/3] sm:max-h-[min(52vh,380px)]">
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
                ready
                  ? "border-emerald-400 shadow-[0_0_0_999px_rgba(0,0,0,0.58),0_0_28px_rgba(52,211,153,0.65)]"
                  : aligned
                    ? "border-amber-300 shadow-[0_0_0_999px_rgba(0,0,0,0.58),0_0_20px_rgba(251,191,36,0.45)]"
                    : "border-white/85 shadow-[0_0_0_999px_rgba(0,0,0,0.58)]",
              )}
            />
          </div>
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-medium text-white">
            {ready ? (
              <span className="rounded-full bg-emerald-500/90 px-3 py-1">Jonli yuz ✓</span>
            ) : aligned ? (
              <span className="rounded-full bg-amber-500/90 px-3 py-1">Buyruqni bajaring</span>
            ) : null}
          </div>
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
            error ? "text-red-600" : ready ? "text-emerald-700" : "text-slate-600",
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
