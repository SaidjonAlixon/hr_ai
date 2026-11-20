import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Loader2,
  RefreshCw,
  ScanFace,
  SwitchCamera,
  X,
} from "lucide-react";
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
  isFaceModelsReady,
  livenessMotion,
  poseMatchesWant,
  type FaceAlignStatus,
  type FaceChallengeStep,
  type FaceLivenessProof,
  type FaceOvalFrame,
  type FacePose,
} from "@/lib/face-id";
import {
  openCameraFast,
  prefetchCamera,
  cameraErrorCode,
  clearCameraDeviceCache,
  type CameraFacing,
} from "@/lib/camera-fast";
import { cn } from "@/lib/utils";

type CaptureResult = { fullName?: string } | void;
type Translate = (key: string, fallback?: string) => string;

function mapCameraError(err: unknown, t: Translate): string {
  const code = cameraErrorCode(err);
  switch (code) {
    case "camera_denied":
      return t("davomat.scanCamDenied");
    case "secure_context":
      return t("davomat.scanCamHttps");
    case "camera_busy":
      return t("davomat.scanCamBusy");
    case "camera_not_found":
      return t("davomat.scanCamNotFound");
    case "camera_timeout":
    case "camera_unsupported":
    case "camera_failed":
    default:
      return t("davomat.scanCamFailed");
  }
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "enroll" | "login";
  onCaptured: (
    descriptor: number[] | number[][],
    snapshot?: string,
    liveness?: FaceLivenessProof,
  ) => Promise<CaptureResult>;
  /** Kamera oqimi muvaffaqiyatli ulanganda (ruxsat + preview) */
  onStreamReady?: () => void;
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

function grabFaceSnapshot(video: HTMLVideoElement | null, mirror: boolean): string | undefined {
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
    if (mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
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

export function FaceScanDialog({ open, onOpenChange, mode, onCaptured, onStreamReady, title, description }: Props) {
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  const videoRef = useRef<HTMLVideoElement>(null);
  const ovalRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onCapturedRef = useRef(onCaptured);
  onCapturedRef.current = onCaptured;
  // Parent may pass an inline callback; the camera effect must not restart on every parent render.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const onStreamReadyRef = useRef(onStreamReady);
  onStreamReadyRef.current = onStreamReady;

  const [hint, setHint] = useState(() => t("davomat.scanCamOpening"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aligned, setAligned] = useState(false);
  const [poseIndex, setPoseIndex] = useState(0);
  const [poseFill, setPoseFill] = useState(0);
  const [liveSteps, setLiveSteps] = useState<Challenge[]>(mode === "enroll" ? FALLBACK_ENROLL : FALLBACK_LOGIN);
  /** Default: old (selfie) kamera — almashtirish mumkin */
  const [facing, setFacing] = useState<CameraFacing>("user");
  const [switching, setSwitching] = useState(false);
  /** Preview haqiqatan kadr bera boshlaganda true */
  const [camReady, setCamReady] = useState(false);
  const [camRetryKey, setCamRetryKey] = useState(0);
  /** Kadr kelmasa (qora ekran) avtomatik qayta ochishlar soni */
  const autoReopenRef = useRef(0);
  const facingRef = useRef<CameraFacing>("user");
  facingRef.current = facing;

  const steps = liveSteps;
  const currentStep = steps[Math.min(poseIndex, steps.length - 1)]!;
  const mirrorPreview = facing === "user";

  useEffect(() => {
    if (!open) {
      setAligned(false);
      setBusy(false);
      setError(null);
      setPoseIndex(0);
      setPoseFill(0);
      setLiveSteps(mode === "enroll" ? FALLBACK_ENROLL : FALLBACK_LOGIN);
      setFacing("user");
      facingRef.current = "user";
      setSwitching(false);
      setCamReady(false);
      setCamRetryKey(0);
      autoReopenRef.current = 0;
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

    // Detection runs every frame; throttle hint text and debounce the oval so the UI doesn't flicker.
    const HINT_MIN_MS = 400;
    const ALIGN_MISS_FRAMES = 4;
    let hintShown = "";
    let hintAt = 0;
    let hintTimer: number | null = null;
    let alignMisses = 0;
    const setAlignedState = setAligned;
    const smoothHint = (text: string, force = false) => {
      if (text === hintShown && !force) {
        if (hintTimer != null) {
          window.clearTimeout(hintTimer);
          hintTimer = null;
        }
        return;
      }
      const wait = HINT_MIN_MS - (performance.now() - hintAt);
      const apply = () => {
        hintTimer = null;
        if (cancelled) return;
        hintShown = text;
        hintAt = performance.now();
        setHint(text);
      };
      if (hintTimer != null) window.clearTimeout(hintTimer);
      if (force || wait <= 0) apply();
      else hintTimer = window.setTimeout(apply, wait);
    };
    const smoothAligned = (value: boolean) => {
      if (value) {
        alignMisses = 0;
        setAligned(true);
        return;
      }
      alignMisses += 1;
      if (alignMisses >= ALIGN_MISS_FRAMES) setAligned(false);
    };

    let frameWatch: number | null = null;
    const stopCamera = () => {
      running = false;
      if (hintTimer != null) {
        window.clearTimeout(hintTimer);
        hintTimer = null;
      }
      if (frameWatch != null) {
        window.clearTimeout(frameWatch);
        frameWatch = null;
      }
      const video = videoRef.current;
      if (video) {
        try {
          video.srcObject = null;
        } catch {
          /* ignore */
        }
      }
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
      const setHint = smoothHint;
      const setAligned = smoothAligned;
      setError(null);
      setBusy(false);
      setCamReady(false);
      alignMisses = ALIGN_MISS_FRAMES;
      setAlignedState(false);
      lastDesc = null;
      poseI = 0;
      setPoseIndex(0);
      setPoseFill(0);
      if (!isFaceIdSupported()) {
        setError(tRef.current("davomat.scanCamHttps"));
        return;
      }
      try {
        const modelsP = ensureFaceModels();
        const challengeP = fetchFaceChallenge(mode).catch(() => null);
        setHint(tRef.current("davomat.scanCamOpening"));
        let stream: MediaStream;
        try {
          stream = await openCameraFast(facingRef.current);
        } catch (openErr) {
          const code = cameraErrorCode(openErr);
          // Ruxsat yo‘q / kamera yo‘q — qayta urinish befoyda; boshqa holatda keshni tozalab yana bir marta
          if (code === "camera_denied" || code === "camera_not_found" || code === "secure_context" || code === "camera_unsupported") {
            throw openErr;
          }
          clearCameraDeviceCache(facingRef.current);
          await new Promise((r) => window.setTimeout(r, 250));
          if (cancelled) return;
          stream = await openCameraFast(facingRef.current);
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener("ended", () => {
            if (!cancelled && running && streamRef.current === stream) {
              setCamRetryKey((k) => k + 1);
            }
          });
        });
        // Dialog animatsiyasi paytida <video> hali DOMda bo‘lmasligi mumkin — qisqa kutamiz
        let video = videoRef.current;
        for (let i = 0; !video && i < 30 && !cancelled; i++) {
          await new Promise((r) => window.setTimeout(r, 50));
          video = videoRef.current;
        }
        if (cancelled || !video) {
          stream.getTracks().forEach((track) => track.stop());
          if (!cancelled) setError(tRef.current("davomat.scanCamFailed"));
          return;
        }
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");
        video.setAttribute("webkit-playsinline", "true");
        video.setAttribute("autoplay", "true");
        // Metadata/kadr kelguncha play — iOS qora ekranni kamaytiradi
        const waitPlay = async () => {
          if (video.readyState < 1) {
            await Promise.race([
              new Promise<void>((resolve) => {
                const onMeta = () => {
                  video.removeEventListener("loadedmetadata", onMeta);
                  resolve();
                };
                video.addEventListener("loadedmetadata", onMeta);
              }),
              new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
            ]);
          }
          try {
            await video.play();
          } catch {
            /* ignore — keyinroq qayta */
          }
          if (typeof (video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback === "function") {
            await Promise.race([
              new Promise<void>((resolve) => {
                (video as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }).requestVideoFrameCallback(
                  () => resolve(),
                );
              }),
              new Promise<void>((resolve) => window.setTimeout(resolve, 2000)),
            ]);
          }
        };
        await waitPlay();
        // Ba’zi telefonlarda birinchi play ishlamaydi — darhol qayta
        if (!cancelled && (video.paused || video.readyState < 2)) {
          try {
            video.srcObject = stream;
            await video.play();
          } catch {
            /* keyin frame check */
          }
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.onloadedmetadata = () => {
          if (video.paused) void video.play().catch(() => undefined);
        };
        // iOS/Android/Telegram: track.muted tez-tez true — o‘lik emas. Kadr kelmasa qayta ulaymiz.
        let reattached = false;
        const scheduleFrameCheck = (ms: number) => {
          if (frameWatch != null) window.clearTimeout(frameWatch);
          frameWatch = window.setTimeout(() => {
            frameWatch = null;
            if (cancelled || !running || streamRef.current !== stream) return;
            const track = stream.getVideoTracks()[0];
            const hasFrames = video.readyState >= 2 && video.videoWidth >= 8;
            const trackDead = !track || track.readyState === "ended" || track.readyState !== "live";
            if (hasFrames && !trackDead) {
              autoReopenRef.current = 0;
              return;
            }
            if (video.paused && !trackDead) {
              void video.play().catch(() => undefined);
            }
            if (!trackDead && !hasFrames && !reattached) {
              reattached = true;
              try {
                video.srcObject = null;
                video.srcObject = stream;
                video.muted = true;
                video.playsInline = true;
                void video.play().catch(() => undefined);
              } catch {
                /* ignore */
              }
              scheduleFrameCheck(2200);
              return;
            }
            if (autoReopenRef.current < 3) {
              autoReopenRef.current += 1;
              clearCameraDeviceCache(facingRef.current);
              stream.getTracks().forEach((t) => t.stop());
              streamRef.current = null;
              setHint(tRef.current("davomat.scanCamOpening"), true);
              setCamRetryKey((k) => k + 1);
            } else {
              setError(tRef.current("davomat.scanCamFailed"));
            }
          }, ms);
        };
        scheduleFrameCheck(2200);
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener("unmute", () => {
            if (video.paused) void video.play().catch(() => undefined);
          });
          track.addEventListener("mute", () => {
            // Faqat uzoq muted + kadr yo‘q bo‘lsa tekshiramiz
            scheduleFrameCheck(2500);
          });
        });
        onStreamReadyRef.current?.();
        setCamReady(true);
        setSwitching(false);
        setHint(
          isFaceModelsReady()
            ? tRef.current("davomat.align.default")
            : tRef.current("davomat.scanModelLoading"),
          true,
        );

        await Promise.race([
          modelsP,
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("model_timeout")), 18000)),
        ]);
        if (cancelled) return;

        const issued = await Promise.race([
          challengeP,
          new Promise<null>((r) => window.setTimeout(() => r(null), 800)),
        ]);
        if (cancelled) return;
        if (issued?.steps?.length) {
          steps = issued.steps;
          challengeToken = issued.token;
          poseBuckets = steps.map(() => []);
          setLiveSteps(steps);
        } else {
          void challengeP.then((late) => {
            if (cancelled || !late?.steps?.length || poseI > 0) return;
            steps = late.steps;
            challengeToken = late.token;
            poseBuckets = steps.map(() => []);
            setLiveSteps(steps);
            setHint(stepHint(tRef.current, steps[0]!));
          });
        }
        setHint(stepHint(tRef.current, steps[0]!));

        const finish = async (videoEl: HTMLVideoElement) => {
          running = false;
          setBusy(true);
          setHint(
            mode === "enroll"
              ? tRef.current("davomat.scanSaving")
              : tRef.current("davomat.scanChecking"),
            true,
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
              lastPhoto || grabFaceSnapshot(videoEl, facingRef.current === "user"),
              liveness,
            );
            const name =
              captured && typeof captured === "object" && captured.fullName ? captured.fullName.trim() : "";
            if (name) {
              setError(null);
              setHint(tRef.current("davomat.scanWelcome").replace("{name}", name), true);
              await new Promise((r) => window.setTimeout(r, 700));
            }
            stopCamera();
            onOpenChangeRef.current(false);
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

        let detectFailures = 0;
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
                fit: "cover",
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
                    lastPhoto =
                      grabFaceSnapshot(videoEl, facingRef.current === "user") || lastPhoto;
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
              detectFailures = 0;
            } catch (err) {
              detectFailures += 1;
              if (detectFailures >= 5) {
                if (!cancelled) setError((err as Error)?.message || tRef.current("davomat.scanError"));
                return;
              }
            }
          }
          if (running && !cancelled) {
            const delay = want?.blink ? 20 : 40;
            window.setTimeout(() => void loop(), delay);
          }
        };

        void loop();
      } catch (err) {
        if (cancelled) return;
        setSwitching(false);
        const message = (err as Error)?.message === "model_timeout"
          ? "Model yuklanmadi. Internetni tekshirib, qayta urinib ko‘ring."
          : mapCameraError(err, tRef.current);
        setError(message);
      }
    };

    // iOS/Android pause the preview when the tab is backgrounded; resume or reopen on return.
    const onVisible = () => {
      if (cancelled || document.visibilityState !== "visible" || !streamRef.current) return;
      const video = videoRef.current;
      const live = streamRef.current.getVideoTracks().some((tr) => tr.readyState === "live");
      if (!live) {
        setCamRetryKey((k) => k + 1);
        return;
      }
      if (video && video.paused) void video.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);

    void start();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      stopCamera();
    };
  }, [open, mode, facing, camRetryKey]);

  const switchCamera = () => {
    if (busy || switching) return;
    setSwitching(true);
    setError(null);
    setHint(t("davomat.scanCamOpening"));
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  };

  const retryCamera = () => {
    if (busy || switching) return;
    setError(null);
    setHint(t("davomat.scanCamOpening"));
    clearCameraDeviceCache();
    // Eski oqim yopiladi, so‘ng bosish paytida kamerani darhol boshlaymiz (iOS/Android ishonchli)
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    prefetchCamera("user");
    setFacing("user");
    facingRef.current = "user";
    autoReopenRef.current = 0;
    setCamRetryKey((k) => k + 1);
  };

  const totalSteps = Math.max(1, steps.length);
  const stepProgress = Math.min(
    100,
    ((poseIndex + (currentStep.need ? Math.min(1, poseFill / currentStep.need) : 0)) / totalSteps) * 100,
  );
  const hasError = Boolean(error);
  const statusText = error || hint;
  const camLabel = facing === "environment" ? "Orqa kamera" : "Old kamera";
  const ringPath = "M 50 1.5 A 48.5 48.5 0 1 1 49.99 1.5";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="flex h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-zinc-950 p-0 text-white !max-h-[100dvh] !overflow-hidden z-[110] sm:h-[min(94dvh,780px)] sm:max-w-[26rem] sm:rounded-[32px] sm:border sm:border-white/10"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>
            {title ||
              (mode === "enroll" ? t("davomat.scanTitleEnroll") : t("davomat.scanTitleLogin"))}
          </DialogTitle>
          <DialogDescription>{description || stepHint(t, currentStep)}</DialogDescription>
        </DialogHeader>

        {/* Kamera maydoni */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
          <video
            ref={videoRef}
            className={cn(
              "absolute inset-0 h-full w-full bg-black object-cover transition-opacity duration-300",
              camReady ? "opacity-100" : "opacity-0",
              mirrorPreview && "-scale-x-100",
            )}
            playsInline
            muted
            autoPlay
          />

          {/* Oval ramka: tashqarisi qoraytirilgan, ichi ochiq */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              ref={ovalRef}
              className="relative aspect-[3/4] h-[62%] max-h-[430px] max-w-[84%] rounded-[50%] shadow-[0_0_0_9999px_rgba(0,0,0,0.62)]"
            >
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute -inset-[5px] h-[calc(100%+10px)] w-[calc(100%+10px)] overflow-visible"
                aria-hidden
              >
                <path
                  d={ringPath}
                  fill="none"
                  stroke={aligned ? "rgb(52 211 153 / 0.55)" : "rgb(255 255 255 / 0.4)"}
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                  pathLength={100}
                />
                <path
                  d={ringPath}
                  fill="none"
                  stroke="rgb(52 211 153)"
                  strokeWidth={5}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  pathLength={100}
                  strokeDasharray={`${stepProgress} 100`}
                  style={{ transition: "stroke-dasharray 0.25s ease-out" }}
                />
              </svg>
            </div>
          </div>

          {/* Yuqori panel */}
          <div className="absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-10 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="flex items-center justify-between gap-3 px-4">
              <button
                type="button"
                aria-label="Yopish"
                onClick={() => onOpenChange(false)}
                className="cam-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white active:scale-95"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="cam-glass flex min-w-0 items-center gap-2 rounded-full px-3.5 py-2">
                <ScanFace className="h-4 w-4 shrink-0 text-emerald-300" />
                <p className="truncate text-sm font-semibold">{stepHint(t, currentStep)}</p>
              </div>
              <button
                type="button"
                aria-label={facing === "environment" ? "Old kamera" : "Orqa kamera"}
                disabled={busy || switching}
                onClick={switchCamera}
                className="cam-glass flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white active:scale-95 disabled:opacity-50"
              >
                {switching ? <Loader2 className="h-5 w-5 animate-spin" /> : <SwitchCamera className="h-5 w-5" />}
              </button>
            </div>
            {currentStep.pose && currentStep.pose !== "center" ? (
              <div className="mt-3 flex justify-center">
                <PoseArrow pose={currentStep.pose} />
              </div>
            ) : null}
          </div>

          {/* Kamera ochilmoqda / xato */}
          {!camReady ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black px-6 text-center">
              <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
                {!hasError ? <span className="cam-pulse-ring absolute inset-0 rounded-full ring-2 ring-emerald-400/50" /> : null}
                {hasError ? (
                  <AlertCircle className="h-10 w-10 text-rose-300" />
                ) : (
                  <Loader2 className="h-10 w-10 animate-spin text-white" />
                )}
              </span>
              <p className="max-w-[17rem] text-[15px] font-semibold leading-snug text-white">
                {hasError ? error : t("davomat.scanCamOpening")}
              </p>
            </div>
          ) : (
            <div className="absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
              <div
                className={cn(
                  "cam-glass flex max-w-full items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold shadow-lg",
                  hasError
                    ? "!border-rose-400/40 !bg-rose-600/80 text-white"
                    : aligned
                      ? "!border-emerald-400/50 !bg-emerald-600/70 text-white"
                      : "text-white",
                )}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : hasError ? (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                ) : (
                  <span
                    className={cn("h-2 w-2 shrink-0 rounded-full", aligned ? "bg-emerald-300" : "animate-pulse bg-white/80")}
                  />
                )}
                <span className="truncate">{statusText}</span>
              </div>
            </div>
          )}
        </div>

        {/* Pastki panel */}
        <div className="space-y-3 bg-zinc-950 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <div className="flex justify-center gap-1.5">
            {steps.map((p, i) => (
              <span
                key={p.key}
                className={cn(
                  "h-1.5 w-8 rounded-full transition-colors",
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

          {hasError ? (
            <Button
              type="button"
              className="h-12 w-full rounded-2xl bg-white text-[15px] font-bold text-zinc-900 hover:bg-white/90"
              disabled={busy || switching}
              onClick={retryCamera}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("davomat.scanCamRetry")}
            </Button>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-white/50">
              <SwitchCamera className="h-3.5 w-3.5" />
              {camLabel} · Face ID uchun old kamera tavsiya etiladi
            </span>
            <button
              type="button"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
              {t("davomat.scanCancel")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
