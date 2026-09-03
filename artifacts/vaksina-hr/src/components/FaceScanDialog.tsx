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
import { useI18n } from "@/i18n/I18nProvider";
import {
  averageDescriptorsRobust,
  detectFaceDescriptor,
  ensureFaceModels,
  fetchFaceChallenge,
  isFaceIdSupported,
  livenessMotion,
  poseMatchesWant,
  type FaceAlignStatus,
  type FaceChallengeStep,
  type FaceLivenessProof,
  type FaceOvalFrame,
  type FacePose,
} from "@/lib/face-id";
import { cn } from "@/lib/utils";

type CaptureResult = { fullName?: string } | void;
type Translate = (key: string, fallback?: string) => string;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "enroll" | "login";
  onCaptured: (
    descriptor: number[] | number[][],
    snapshot?: string,
    liveness?: FaceLivenessProof,
  ) => Promise<CaptureResult>;
  title?: string;
  description?: string;
};

type Challenge = FaceChallengeStep;

const FALLBACK_ENROLL: Challenge[] = [{ key: "center", pose: "center", need: 3 }];
const FALLBACK_LOGIN: Challenge[] = [{ key: "center", pose: "center", need: 2 }];

const MIN_SCORE_ENROLL = 0.5;
const MIN_SCORE_LOGIN = 0.45;

const ALIGN_KEYS: Record<FaceAlignStatus, string> = {
  ok: "davomat.align.ok",
  hold_still: "davomat.align.hold_still",
  low_quality: "davomat.align.low_quality",
  turn_face: "davomat.align.turn_face",
  dark: "davomat.align.dark",
  too_far: "davomat.align.too_far",
  too_close: "davomat.align.too_close",
  covered: "davomat.align.covered",
  low_camera: "davomat.align.low_camera",
  many_faces: "davomat.align.many_faces",
  outside: "davomat.align.outside",
  no_face: "davomat.align.default",
};

function stepHint(t: Translate, step: Challenge): string {
  if (step.blink) return t("davomat.scanBlink");
  const pose = step.pose ?? "center";
  return t(`davomat.pose.${pose}`);
}

function alignHint(t: Translate, status: FaceAlignStatus): string {
  return t(ALIGN_KEYS[status] ?? "davomat.align.default");
}

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
    return canvas.toDataURL("image/jpeg", 0.92);
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
        "flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-foreground dark:text-white ring-1 ring-white/35 backdrop-blur-sm",
        pose !== "center" && "animate-bounce",
      )}
    >
      <Icon className="h-6 w-6" />
    </div>
  );
}

export function FaceScanDialog({ open, onOpenChange, mode, onCaptured, title, description }: Props) {
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  const videoRef = useRef<HTMLVideoElement>(null);
  const ovalRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCapturedRef = useRef(onCaptured);
  onCapturedRef.current = onCaptured;

  const [hint, setHint] = useState(() => t("davomat.scanCamOpening"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aligned, setAligned] = useState(false);
  const [poseIndex, setPoseIndex] = useState(0);
  const [poseFill, setPoseFill] = useState(0);
  const [liveSteps, setLiveSteps] = useState<Challenge[]>(mode === "enroll" ? FALLBACK_ENROLL : FALLBACK_LOGIN);

  const steps = liveSteps;
  const currentStep = steps[Math.min(poseIndex, steps.length - 1)]!;

  useEffect(() => {
    if (!open) {
      setAligned(false);
      setBusy(false);
      setError(null);
      setPoseIndex(0);
      setPoseFill(0);
      setLiveSteps(mode === "enroll" ? FALLBACK_ENROLL : FALLBACK_LOGIN);
      return;
    }

    let cancelled = false;
    let steps = mode === "enroll" ? FALLBACK_ENROLL : FALLBACK_LOGIN;
    let poseBuckets: number[][][] = steps.map(() => []);
    let poseI = 0;
    let running = true;
    let lastDesc: number[] | null = null;
    let lastPhoto: string | undefined;
    let blinkClosed = false;
    let blinkOpen = false;
    let pitchRef: number | null = null;
    let openEar = 0;
    let closedFrames = 0;
    let openFrames = 0;
    let sawOpenEyes = false;
    let lastBlinkDesc: number[] | null = null;
    let challengeToken = "";

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
        setError(tRef.current("davomat.scanCamHttps"));
        return;
      }
      try {
        setHint(tRef.current("davomat.scanModelLoading"));
        await ensureFaceModels();
        if (cancelled) return;
        setHint(tRef.current("davomat.scanCamOpening"));
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setHint(tRef.current("davomat.scanPrep"));
        const issued = await fetchFaceChallenge(mode);
        if (cancelled) return;
        steps = issued.steps?.length ? issued.steps : steps;
        challengeToken = issued.token;
        poseBuckets = steps.map(() => []);
        setLiveSteps(steps);
        setHint(stepHint(tRef.current, steps[0]!));

        const finish = async (videoEl: HTMLVideoElement) => {
          running = false;
          setBusy(true);
          setHint(
            mode === "enroll"
              ? tRef.current("davomat.scanSaving")
              : tRef.current("davomat.scanChecking"),
          );
          const samples = poseBuckets.flat();
          const templates = poseBuckets
            .filter((b) => b.length)
            .map((b) => averageDescriptorsRobust(b));
          const posesDone = steps.filter((s, i) => poseBuckets[i]?.length).map((s) => s.pose ?? s.key);
          const stepKeys = steps.filter((s, i) => poseBuckets[i]?.length).map((s) => s.key);
          const blinked = steps.some((s, i) => s.blink && (poseBuckets[i]?.length ?? 0) > 0);
          const motion = livenessMotion(samples);
          const liveness: FaceLivenessProof = {
            blinked,
            poses: posesDone,
            steps: stepKeys,
            motion,
            score: 0,
            challenge: challengeToken,
          };
          const identityTemplates = poseBuckets
            .map((b, i) => ({ b, s: steps[i] }))
            .filter((x) => x.b.length && !x.s?.blink)
            .map((x) => averageDescriptorsRobust(x.b));
          const payload =
            mode === "enroll"
              ? identityTemplates
              : identityTemplates[0]
                ? [identityTemplates[0]]
                : templates[0]
                  ? [templates[0]]
                  : samples[0]
                    ? [samples[0]]
                    : [];
          try {
            const captured = await onCapturedRef.current(
              payload,
              lastPhoto || grabFaceSnapshot(videoEl),
              liveness,
            );
            const name =
              captured && typeof captured === "object" && captured.fullName ? captured.fullName.trim() : "";
            if (name) {
              setError(null);
              setHint(tRef.current("davomat.scanWelcome").replace("{name}", name));
              await new Promise((r) => window.setTimeout(r, 700));
            }
            stopCamera();
            onOpenChange(false);
          } catch (err) {
            setError((err as Error)?.message || tRef.current("davomat.scanFailed"));
            setBusy(false);
            poseI = 0;
            poseBuckets.forEach((b) => {
              b.length = 0;
            });
            setPoseIndex(0);
            setPoseFill(0);
            lastDesc = null;
            blinkClosed = false;
            blinkOpen = false;
            closedFrames = 0;
            openFrames = 0;
            openEar = 0;
            sawOpenEyes = false;
            running = true;
          }
        };

        const loop = async () => {
          if (!running || cancelled) return;
          const videoEl = videoRef.current;
          const want = steps[poseI];
          if (videoEl && videoEl.readyState >= 2) {
            try {
              if (!want) {
                await finish(videoEl);
                return;
              }
              const result = await detectFaceDescriptor(videoEl, readFrame(), true, {
                allowTurn: Boolean(want.pose && want.pose !== "center"),
                allowBlink: Boolean(want.blink),
              });
              const alignStatus: FaceAlignStatus = result.status;
              const wantPose = want.pose ?? "center";
              if (wantPose === "down" && result.pitch != null && pitchRef == null && result.descriptor) {
                pitchRef = result.pitch;
              }
              const poseOk = want.blink
                ? Boolean(result.descriptor)
                : poseMatchesWant(wantPose, result.pose, result.yaw ?? 0, result.pitch ?? 0, pitchRef ?? undefined);
              const inFrame = Boolean(result.descriptor) && (alignStatus === "ok" || alignStatus === "turn_face");
              setAligned(Boolean(inFrame && poseOk));
              const minScore = mode === "enroll" ? MIN_SCORE_ENROLL : MIN_SCORE_LOGIN;

              if (!want.blink && (!result.descriptor || (result.score ?? 0) < minScore)) {
                setPoseFill(0);
                if (alignStatus !== "ok" && alignStatus !== "turn_face") {
                  setHint(alignHint(tRef.current, alignStatus));
                } else {
                  setHint(stepHint(tRef.current, want));
                }
              } else if (want.blink) {
                if (result.descriptor) lastBlinkDesc = result.descriptor;
                const ear = result.ear;
                const lostFace =
                  !result.descriptor &&
                  (alignStatus === "no_face" || alignStatus === "outside" || alignStatus === "covered");
                if (ear != null && ear >= 0.14) {
                  openEar = openEar > 0 ? openEar * 0.85 + ear * 0.15 : ear;
                  sawOpenEyes = true;
                }
                const baseline = openEar > 0.12 ? openEar : 0.2;
                /** Nisbiy pasayish — kichik ko‘zlar / past EAR ham o‘tadi. */
                const closeAt = Math.max(0.09, baseline * 0.85);
                const openAt = Math.max(closeAt + 0.01, baseline * 0.92);
                const isClosed =
                  (ear != null && ear < closeAt) || (sawOpenEyes && lostFace);
                if (isClosed) {
                  closedFrames += 1;
                  openFrames = 0;
                  if (closedFrames >= 1) {
                    blinkClosed = true;
                    setAligned(true);
                    setHint(tRef.current("davomat.scanBlinkOpen"));
                  }
                } else if (
                  blinkClosed &&
                  ((ear != null && ear > openAt) || (sawOpenEyes && result.descriptor && ear != null && ear >= closeAt))
                ) {
                  openFrames += 1;
                  if (openFrames >= 1) {
                    blinkOpen = true;
                    const bucket = poseBuckets[poseI]!;
                    const vec = result.descriptor ?? lastBlinkDesc;
                    if (vec) bucket.push(vec);
                    poseI += 1;
                    setPoseIndex(poseI);
                    setPoseFill(0);
                    lastDesc = null;
                    blinkClosed = false;
                    closedFrames = 0;
                    openFrames = 0;
                    setHint(
                      poseI >= steps.length
                        ? tRef.current("davomat.scanConfirming")
                        : stepHint(tRef.current, steps[poseI]!),
                    );
                    if (poseI >= steps.length) {
                      await finish(videoEl);
                      return;
                    }
                  }
                } else {
                  if (!isClosed) closedFrames = 0;
                  setAligned(Boolean(result.descriptor) || blinkClosed);
                  setHint(
                    blinkClosed
                      ? tRef.current("davomat.scanOpenEyes")
                      : tRef.current("davomat.scanBlinkHold"),
                  );
                }
              } else if (!poseOk) {
                lastDesc = null;
                setHint(stepHint(tRef.current, want));
              } else {
                const vec = result.descriptor;
                if (!vec) {
                  setHint(stepHint(tRef.current, want));
                } else {
                  lastDesc = vec;
                  if (wantPose === "center") {
                    lastPhoto = grabFaceSnapshot(videoEl) || lastPhoto;
                  }
                  const bucket = poseBuckets[poseI]!;
                  bucket.push(vec);
                  setPoseFill(bucket.length);
                  setHint(`${stepHint(tRef.current, want)}  ·  ${bucket.length}/${want.need}`);
                  if (bucket.length >= want.need) {
                    poseI += 1;
                    setPoseIndex(poseI);
                    setPoseFill(0);
                    lastDesc = null;
                    pitchRef = null;
                    blinkClosed = false;
                    blinkOpen = false;
                    closedFrames = 0;
                    openFrames = 0;
                    openEar = 0;
                    sawOpenEyes = false;
                    if (poseI >= steps.length) {
                      await finish(videoEl);
                      return;
                    }
                    setHint(stepHint(tRef.current, steps[poseI]!));
                  }
                }
              }
            } catch (err) {
              if (!cancelled) setError((err as Error)?.message || tRef.current("davomat.scanError"));
              return;
            }
          }
          if (running && !cancelled) {
            const delay = want?.blink ? 20 : 70;
            window.setTimeout(() => void loop(), delay);
          }
        };

        void loop();
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError") {
          setError(tRef.current("davomat.scanCamDenied"));
        } else {
          setError((err as Error)?.message || tRef.current("davomat.scanCamFailed"));
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
        className="w-[calc(100%-0.75rem)] max-w-sm gap-0 overflow-hidden rounded-[28px] border-0 bg-zinc-950 p-0 text-foreground dark:text-white !max-h-[100dvh] !overflow-hidden"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>
            {title ||
              (mode === "enroll" ? t("davomat.scanTitleEnroll") : t("davomat.scanTitleLogin"))}
          </DialogTitle>
          <DialogDescription>{description || stepHint(t, currentStep)}</DialogDescription>
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
            className="pointer-events-none absolute inset-0 bg-black/50"
            style={{
              WebkitMaskImage:
                "radial-gradient(ellipse 29% 38% at 50% 48%, transparent 96%, #000 100%)",
              maskImage: "radial-gradient(ellipse 29% 38% at 50% 48%, transparent 96%, #000 100%)",
            }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              ref={ovalRef}
              className={cn(
                "aspect-[3/4] w-[58%] max-w-[220px] rounded-full border-[2.5px] bg-transparent",
                aligned ? "border-emerald-400" : "border-white",
              )}
            />
          </div>
          <p className="absolute left-0 right-0 top-5 z-10 text-center text-[15px] font-semibold drop-shadow">
            {stepHint(t, currentStep)}
          </p>
          {currentStep.pose && currentStep.pose !== "center" ? (
            <div className="absolute left-1/2 top-[18%] z-10 -translate-x-1/2">
              <PoseArrow pose={currentStep.pose} />
            </div>
          ) : null}
        </div>

        <div className="space-y-3 bg-zinc-950 px-5 pb-5 pt-4">
          <div className="flex justify-center gap-1.5">
            {steps.map((p, i) => (
              <span
                key={p.key}
                className={cn(
                  "h-1.5 w-6 rounded-full",
                  i < poseIndex ? "bg-emerald-400" : i === poseIndex ? "bg-card" : "bg-white/20",
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
          <p className={cn("min-h-5 text-center text-sm", error ? "text-red-300" : "text-white/80")}>
            {busy ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
            {error || hint}
          </p>
          <Button
            type="button"
            variant="ghost"
            className="w-full rounded-full text-foreground dark:text-white hover:bg-white/10 hover:text-foreground dark:text-white"
            onClick={() => onOpenChange(false)}
          >
            <X className="mr-1.5 h-4 w-4" />
            {t("davomat.scanCancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
