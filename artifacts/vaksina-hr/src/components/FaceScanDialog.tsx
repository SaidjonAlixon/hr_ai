import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Loader2, ScanFace, X } from "lucide-react";
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
  poseHint,
  poseMatchesWant,
  type FaceAlignStatus,
  type FaceOvalFrame,
  type FacePose,
} from "@/lib/face-id";
import { cn } from "@/lib/utils";

type CaptureResult = { fullName?: string } | void;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "enroll" | "login";
  onCaptured: (descriptor: number[] | number[][], snapshot?: string) => Promise<CaptureResult>;
  title?: string;
  description?: string;
};

const ENROLL_POSES: { pose: FacePose; need: number }[] = [
  { pose: "center", need: 3 },
  { pose: "left", need: 2 },
  { pose: "right", need: 2 },
  { pose: "up", need: 1 },
  { pose: "down", need: 1 },
];
const LOGIN_STREAK = 3;
const MIN_SCORE_ENROLL = 0.62;
const MIN_SCORE_LOGIN = 0.62;

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

function PoseArrow({ pose }: { pose: FacePose }) {
  const Icon =
    pose === "left" ? ArrowLeft : pose === "right" ? ArrowRight : pose === "up" ? ArrowUp : pose === "down" ? ArrowDown : ScanFace;
  return (
    <div
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white ring-1 ring-white/35 backdrop-blur-sm",
        pose !== "center" && "animate-bounce",
      )}
    >
      <Icon className="h-6 w-6" />
    </div>
  );
}

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
  const [poseIndex, setPoseIndex] = useState(0);
  const [poseFill, setPoseFill] = useState(0);
  const [loginFill, setLoginFill] = useState(0);

  const enrollPose = ENROLL_POSES[Math.min(poseIndex, ENROLL_POSES.length - 1)]!;

  useEffect(() => {
    if (!open) {
      setAligned(false);
      setBusy(false);
      setError(null);
      setPoseIndex(0);
      setPoseFill(0);
      setLoginFill(0);
      return;
    }

    let cancelled = false;
    const poseBuckets: number[][][] = ENROLL_POSES.map(() => []);
    let poseI = 0;
    let loginStreak = 0;
    let running = true;
    let poseHold = 0;
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
      lastDesc = null;
      poseI = 0;
      setPoseIndex(0);
      setPoseFill(0);
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
        setHint(mode === "enroll" ? poseHint("center") : "Yuzni oval ichiga tuting");

        const loop = async () => {
          if (!running || cancelled) return;
          const videoEl = videoRef.current;
          if (videoEl && videoEl.readyState >= 2) {
            try {
              const want = ENROLL_POSES[poseI];
              const result = await detectFaceDescriptor(videoEl, readFrame(), true, {
                allowTurn: mode === "enroll" && want?.pose !== "center",
              });
              const alignStatus: FaceAlignStatus = result.status;
              const poseOk =
                mode === "login" ||
                poseMatchesWant(want?.pose ?? "center", result.pose, result.yaw ?? 0, result.pitch ?? 0) ||
                (mode === "enroll" && want?.pose !== "center" && poseHold >= 8);
              const inFrame = Boolean(result.descriptor) && (alignStatus === "ok" || alignStatus === "turn_face");
              setAligned(Boolean(inFrame && poseOk));
              const minScore = mode === "enroll" ? MIN_SCORE_ENROLL : MIN_SCORE_LOGIN;

              if (!result.descriptor || (result.score ?? 0) < minScore) {
                loginStreak = 0;
                if (mode === "login") setLoginFill(0);
                if (alignStatus !== "ok" && alignStatus !== "turn_face") setHint(faceAlignHint(alignStatus));
                else if (mode === "enroll" && want) setHint(poseHint(want.pose));
                else setHint(faceAlignHint(alignStatus));
              } else if (mode === "enroll" && want) {
                if (result.descriptor) poseHold += 1;
                else poseHold = 0;
                const poseOkNow =
                  poseMatchesWant(want.pose, result.pose, result.yaw ?? 0, result.pitch ?? 0) ||
                  (want.pose !== "center" && poseHold >= 8);
                if (!poseOkNow) {
                  lastDesc = null;
                  setHint(poseHint(want.pose));
                } else if (
                  want.pose === "center" &&
                  !isStableSample(lastDesc, result.descriptor, 0.28)
                ) {
                  lastDesc = result.descriptor;
                  setHint("Bir soniya turing…");
                } else {
                  lastDesc = result.descriptor;
                  const bucket = poseBuckets[poseI]!;
                  bucket.push(result.descriptor);
                  setPoseFill(bucket.length);
                  setHint(`${poseHint(want.pose)}  ·  ${bucket.length}/${want.need}`);
                  if (bucket.length >= want.need) {
                    poseI += 1;
                    setPoseIndex(poseI);
                    setPoseFill(0);
                    lastDesc = null;
                    poseHold = 0;
                    if (poseI >= ENROLL_POSES.length) {
                      running = false;
                      setBusy(true);
                      setHint("Yuz saqlanmoqda…");
                      const templates = poseBuckets.map((b) => averageDescriptorsRobust(b));
                      try {
                        await onCapturedRef.current(templates, grabFaceSnapshot(videoEl));
                        stopCamera();
                        onOpenChange(false);
                        return;
                      } catch (err) {
                        setError((err as Error)?.message || "Saqlanmadi");
                        setBusy(false);
                        poseI = 0;
                        poseBuckets.forEach((b) => {
                          b.length = 0;
                        });
                        setPoseIndex(0);
                        setPoseFill(0);
                        lastDesc = null;
                        poseHold = 0;
                        running = true;
                      }
                    } else {
                      setHint(poseHint(ENROLL_POSES[poseI]!.pose));
                    }
                  }
                }
              } else if (mode === "login") {
                if (!isStableSample(lastDesc, result.descriptor, 0.22)) {
                  lastDesc = result.descriptor;
                  loginStreak = 0;
                  setLoginFill(0);
                  setHint(faceAlignHint("hold_still"));
                } else {
                  lastDesc = result.descriptor;
                  loginStreak += 1;
                  setLoginFill(loginStreak);
                  setHint(faceAlignHint("ok"));
                  if (loginStreak >= LOGIN_STREAK) {
                    running = false;
                    setBusy(true);
                    setHint("Yuz tekshirilmoqda…");
                    try {
                      const captured = await onCapturedRef.current(result.descriptor, grabFaceSnapshot(videoEl));
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
                      setLoginFill(0);
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
          if (running && !cancelled) window.setTimeout(() => void loop(), 70);
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
      <DialogContent
        hideClose
        className="w-[calc(100%-0.75rem)] max-w-sm gap-0 overflow-hidden rounded-[28px] border-0 bg-zinc-950 p-0 text-white !max-h-[100dvh] !overflow-hidden"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title || (mode === "enroll" ? "Face ID" : "Face ID kirish")}</DialogTitle>
          <DialogDescription>{description || poseHint(enrollPose.pose)}</DialogDescription>
        </DialogHeader>

        <div className="relative aspect-[4/5] w-full overflow-hidden bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover -scale-x-100"
            playsInline
            muted
            autoPlay
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 42% 48% at 50% 44%, transparent 62%, rgba(0,0,0,0.62) 68%)",
            }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6">
            <div
              ref={ovalRef}
              className={cn(
                "aspect-[3/4] w-[58%] max-w-[220px] rounded-full border-[2.5px] bg-transparent",
                aligned ? "border-emerald-400" : "border-white",
              )}
            />
          </div>
          <p className="absolute left-0 right-0 top-5 z-10 text-center text-[15px] font-semibold drop-shadow">
            {mode === "enroll" ? poseHint(enrollPose.pose) : "Yuzni oval ichiga tuting"}
          </p>
          {mode === "enroll" && enrollPose.pose !== "center" ? (
            <div className="absolute left-1/2 top-[18%] z-10 -translate-x-1/2">
              <PoseArrow pose={enrollPose.pose} />
            </div>
          ) : null}
        </div>

        <div className="space-y-3 bg-zinc-950 px-5 pb-5 pt-4">
          {mode === "enroll" ? (
            <div className="flex justify-center gap-1.5">
              {ENROLL_POSES.map((p, i) => (
                <span
                  key={p.pose}
                  className={cn(
                    "h-1.5 w-7 rounded-full",
                    i < poseIndex ? "bg-emerald-400" : i === poseIndex ? "bg-white" : "bg-white/20",
                  )}
                  style={
                    i === poseIndex && poseFill
                      ? {
                          background: `linear-gradient(90deg, rgb(52 211 153) ${(poseFill / p.need) * 100}%, rgba(255,255,255,0.95) ${(poseFill / p.need) * 100}%)`,
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="flex justify-center gap-1.5">
              {Array.from({ length: LOGIN_STREAK }).map((_, i) => (
                <span
                  key={i}
                  className={cn("h-1.5 w-6 rounded-full", i < loginFill ? "bg-emerald-400" : "bg-white/20")}
                />
              ))}
            </div>
          )}
          <p className={cn("min-h-5 text-center text-sm", error ? "text-red-300" : "text-white/80")}>
            {busy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
            {error || hint}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="w-full rounded-full text-white hover:bg-white/10 hover:text-white"
            onClick={() => onOpenChange(false)}
          >
            <X className="mr-1.5 h-4 w-4" />
            Bekor qilish
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
