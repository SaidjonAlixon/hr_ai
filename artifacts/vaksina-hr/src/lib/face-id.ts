/** Kameradan Face ID — faqat jonli odam (rasm bilan ochilmaydi) */

const FACE_API_SRC = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights";

type Point = { x: number; y: number };

type FaceApi = {
  nets: {
    tinyFaceDetector: { loadFromUri: (u: string) => Promise<void>; isLoaded?: boolean };
    faceLandmark68Net: { loadFromUri: (u: string) => Promise<void>; isLoaded?: boolean };
    faceRecognitionNet: { loadFromUri: (u: string) => Promise<void>; isLoaded?: boolean };
  };
  TinyFaceDetectorOptions: new (opts: { inputSize?: number; scoreThreshold?: number }) => unknown;
  detectSingleFace: (
    input: HTMLVideoElement,
    options: unknown,
  ) => {
    withFaceLandmarks: () => {
      withFaceDescriptor: () => Promise<
        | {
            detection: {
              score: number;
              box: { x: number; y: number; width: number; height: number };
            };
            landmarks: {
              positions?: Point[];
              getLeftEye?: () => Point[];
              getRightEye?: () => Point[];
              getNose?: () => Point[];
            };
            descriptor: Float32Array;
          }
        | undefined
      >;
    };
  };
};

declare global {
  interface Window {
    faceapi?: FaceApi;
  }
}

let modelsReady = false;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-face-api="1"]`);
    if (existing && window.faceapi) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.faceApi = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Face ID moduli yuklanmadi — internetni tekshiring"));
    document.head.appendChild(s);
  });
}

export async function ensureFaceModels(): Promise<FaceApi> {
  await loadScript(FACE_API_SRC);
  const faceapi = window.faceapi;
  if (!faceapi) throw new Error("Face ID moduli yuklanmadi");
  if (!modelsReady) {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsReady = true;
  }
  return faceapi;
}

export type FaceAlignStatus =
  | "no_face"
  | "too_far"
  | "too_close"
  | "outside"
  | "ok"
  | "hold_open"
  | "blink_now"
  | "blink_again"
  | "blink_timeout"
  | "photo";

export type FaceDetectResult = {
  descriptor: number[] | null;
  status: FaceAlignStatus;
  ear?: number;
  noseX?: number;
};

export type FaceOvalFrame = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function eyeAspectRatio(pts: Point[]): number {
  if (pts.length < 6) return 0.3;
  return (dist(pts[1]!, pts[5]!) + dist(pts[2]!, pts[4]!)) / (2 * dist(pts[0]!, pts[3]!));
}

function averageEar(positions: Point[]): number {
  return (eyeAspectRatio(positions.slice(36, 42)) + eyeAspectRatio(positions.slice(42, 48))) / 2;
}

function earFromLandmarks(landmarks: {
  positions?: Point[];
  getLeftEye?: () => Point[];
  getRightEye?: () => Point[];
  getNose?: () => Point[];
}): { ear: number; noseX: number } {
  const left = landmarks.getLeftEye?.();
  const right = landmarks.getRightEye?.();
  if (left && right && left.length >= 6 && right.length >= 6) {
    const ear = (eyeAspectRatio(left) + eyeAspectRatio(right)) / 2;
    const nose = landmarks.getNose?.();
    const tip = nose?.[nose.length - 1] ?? nose?.[3];
    return { ear, noseX: tip ? tip.x : 0.5 };
  }
  const positions = landmarks.positions ?? [];
  if (positions.length >= 48) {
    return { ear: averageEar(positions), noseX: positions[30]?.x ?? 0.5 };
  }
  return { ear: 0.28, noseX: 0.5 };
}

function mapVideoBoxToElement(
  video: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
  mirrored: boolean,
) {
  const cw = video.clientWidth;
  const ch = video.clientHeight;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!cw || !ch || !vw || !vh) return null;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;
  let x = ox + box.x * scale;
  const y = oy + box.y * scale;
  const w = box.width * scale;
  const h = box.height * scale;
  if (mirrored) x = cw - x - w;
  return { x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 };
}

function ellipseNorm(px: number, py: number, frame: FaceOvalFrame): number {
  const dx = (px - frame.cx) / frame.rx;
  const dy = (py - frame.cy) / frame.ry;
  return dx * dx + dy * dy;
}

export async function detectFaceDescriptor(
  video: HTMLVideoElement,
  frame?: FaceOvalFrame | null,
  mirrored = true,
): Promise<FaceDetectResult> {
  const faceapi = await ensureFaceModels();
  const result = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!result || result.detection.score < 0.62) {
    return { descriptor: null, status: "no_face" };
  }
  if (!frame || frame.rx < 8 || frame.ry < 8) {
    return { descriptor: null, status: "outside" };
  }

  const mapped = mapVideoBoxToElement(video, result.detection.box, mirrored);
  if (!mapped) return { descriptor: null, status: "no_face" };

  if (ellipseNorm(mapped.cx, mapped.cy, frame) > 0.55) {
    return { descriptor: null, status: "outside" };
  }

  const fillW = mapped.width / (frame.rx * 2);
  const fillH = mapped.height / (frame.ry * 2);
  if (fillW < 0.42 || fillH < 0.4) return { descriptor: null, status: "too_far" };
  if (fillW > 1.2 || fillH > 1.25) return { descriptor: null, status: "too_close" };

  const { ear, noseX: noseRaw } = earFromLandmarks(result.landmarks);
  const noseX = noseRaw > 1 ? noseRaw / Math.max(1, video.videoWidth) : noseRaw;

  return {
    descriptor: Array.from(result.descriptor),
    status: "ok",
    ear,
    noseX,
  };
}

/**
 * Aktiv liveness: rasm egilishi bilan ochilmaydi.
 * 1) Ko‘z ochiq holda kutish
 * 2) Buyruq: HOZIR yuming
 * 3) Yumish + ochish (2 marta)
 */
export class LivenessTracker {
  private phase: "warmup" | "challenge" | "done" = "warmup";
  private earHistory: number[] = [];
  private baselineEar = 0;
  private openFrames = 0;
  private sawClosedAfterChallenge = false;
  private closedFrames = 0;
  private challengeAt = 0;
  private blinkCount = 0;

  reset() {
    this.phase = "warmup";
    this.earHistory = [];
    this.baselineEar = 0;
    this.openFrames = 0;
    this.sawClosedAfterChallenge = false;
    this.closedFrames = 0;
    this.challengeAt = 0;
    this.blinkCount = 0;
  }

  get isLive() {
    return this.phase === "done";
  }

  get phaseName() {
    return this.phase;
  }

  update(ear: number | undefined): FaceAlignStatus {
    if (typeof ear !== "number" || !Number.isFinite(ear)) return "hold_open";

    this.earHistory.push(ear);
    if (this.earHistory.length > 40) this.earHistory.shift();

    if (this.earHistory.length >= 4 && this.baselineEar === 0) {
      const sorted = [...this.earHistory].sort((a, b) => a - b);
      this.baselineEar = sorted[Math.floor(sorted.length * 0.6)]!;
    } else if (this.phase === "warmup" && ear > this.baselineEar) {
      this.baselineEar = this.baselineEar * 0.9 + ear * 0.1;
    }

    const base = Math.max(this.baselineEar || ear, 0.2);
    const closedThresh = Math.max(0.11, base * 0.72);
    const openThresh = Math.max(closedThresh + 0.035, base * 0.88);
    const isClosed = ear <= closedThresh;
    const isOpen = ear >= openThresh;

    if (this.phase === "warmup") {
      if (isOpen) this.openFrames += 1;
      else this.openFrames = Math.max(0, this.openFrames - 1);

      if (this.openFrames >= 8) {
        this.phase = "challenge";
        this.challengeAt = Date.now();
        this.sawClosedAfterChallenge = false;
        this.closedFrames = 0;
        return "blink_now";
      }
      return "hold_open";
    }

    if (this.phase === "challenge") {
      if (Date.now() - this.challengeAt > 8000) {
        this.phase = "warmup";
        this.openFrames = 0;
        this.sawClosedAfterChallenge = false;
        this.closedFrames = 0;
        return "blink_timeout";
      }

      if (!this.sawClosedAfterChallenge) {
        if (isClosed) {
          this.closedFrames += 1;
          if (this.closedFrames >= 2) this.sawClosedAfterChallenge = true;
        } else {
          this.closedFrames = 0;
        }
        return this.blinkCount > 0 ? "blink_again" : "blink_now";
      }

      if (isOpen) {
        this.blinkCount += 1;
        if (this.blinkCount >= 2) {
          this.phase = "done";
          return "ok";
        }
        this.challengeAt = Date.now();
        this.sawClosedAfterChallenge = false;
        this.closedFrames = 0;
        return "blink_again";
      }
      return this.blinkCount > 0 ? "blink_again" : "blink_now";
    }

    return "ok";
  }
}

export function faceAlignHint(status: FaceAlignStatus): string {
  switch (status) {
    case "ok":
      return "Jonli yuz tasdiqlandi…";
    case "hold_open":
      return "Ko‘zingizni ochiq tuting…";
    case "blink_now":
      return "HOZIR ko‘zingizni yumib oching!";
    case "blink_again":
      return "Yana bir marta yumib oching!";
    case "blink_timeout":
      return "Vaqt tugadi — qayta: ochiq tuting, keyin yuming";
    case "photo":
      return "Rasm bilan ochilmaydi — jonli yuz kerak";
    case "too_far":
      return "Yuzingizni ramkaga yaqinroq tuting";
    case "too_close":
      return "Biroz orqaga turing";
    case "outside":
      return "Yuzni oval ramka ichiga joylashtiring";
    default:
      return "Yuzingizni ramka ichiga tuting";
  }
}

export function averageDescriptors(list: number[][]): number[] {
  const n = list[0]?.length ?? 0;
  const out = new Array<number>(n).fill(0);
  for (const d of list) {
    for (let i = 0; i < n; i++) out[i] += d[i]!;
  }
  for (let i = 0; i < n; i++) out[i] /= list.length;
  return out;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || "Face ID xatosi");
  }
  return body as T;
}

export function isFaceIdSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

export type FaceIdStatus = {
  registered: boolean;
  count: number;
};

export async function fetchFaceIdStatus(): Promise<FaceIdStatus> {
  return apiJson<FaceIdStatus>("/auth/face/status");
}

export async function enrollFace(descriptor: number[]): Promise<void> {
  await apiJson("/auth/face/enroll", {
    method: "POST",
    body: JSON.stringify({ descriptor }),
  });
}

export async function loginWithFace<TUser>(descriptor: number[]): Promise<{ user: TUser }> {
  return apiJson<{ user: TUser }>("/auth/face/login", {
    method: "POST",
    body: JSON.stringify({ descriptor }),
  });
}

export async function removeFaceId(): Promise<void> {
  await apiJson("/auth/face", { method: "DELETE" });
}

export function isFaceIdCancelled(err: unknown): boolean {
  const name = err instanceof DOMException ? err.name : "";
  return name === "NotAllowedError" || name === "AbortError";
}
