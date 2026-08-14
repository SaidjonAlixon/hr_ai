/** Kameradan Face ID — jonli odam (rasm/spoofingdan himoya) */

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
  | "blink"
  | "photo";

export type FaceDetectResult = {
  descriptor: number[] | null;
  status: FaceAlignStatus;
  ear?: number;
  noseX?: number;
  motion?: number;
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

/** Eye Aspect Ratio — ko‘z yumilganda past */
function eyeAspectRatio(pts: Point[]): number {
  if (pts.length < 6) return 0.3;
  return (dist(pts[1]!, pts[5]!) + dist(pts[2]!, pts[4]!)) / (2 * dist(pts[0]!, pts[3]!));
}

function averageEar(positions: Point[]): number {
  const left = positions.slice(36, 42);
  const right = positions.slice(42, 48);
  return (eyeAspectRatio(left) + eyeAspectRatio(right)) / 2;
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
    const nose = positions[30];
    return {
      ear: averageEar(positions),
      noseX: nose?.x ?? 0.5,
    };
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

  const centerN = ellipseNorm(mapped.cx, mapped.cy, frame);
  if (centerN > 0.55) {
    return { descriptor: null, status: "outside" };
  }

  const fillW = mapped.width / (frame.rx * 2);
  const fillH = mapped.height / (frame.ry * 2);
  if (fillW < 0.42 || fillH < 0.4) {
    return { descriptor: null, status: "too_far" };
  }
  if (fillW > 1.2 || fillH > 1.25) {
    return { descriptor: null, status: "too_close" };
  }

  const { ear, noseX: noseRaw } = earFromLandmarks(result.landmarks);
  // landmarks pikselda — 0..1 ga normallashtirish
  const noseX =
    noseRaw > 1 ? noseRaw / Math.max(1, video.videoWidth) : noseRaw;

  return {
    descriptor: Array.from(result.descriptor),
    status: "ok",
    ear,
    noseX,
  };
}

/** Jonli odam: ko‘z yumish yoki boshni biroz burish (rasmdan himoya) */
export class LivenessTracker {
  private earHistory: number[] = [];
  private noseHistory: number[] = [];
  private baselineEar = 0;
  private sawDip = false;
  private blinkDone = false;
  private headTurnDone = false;
  private noseMin = 1;
  private noseMax = 0;

  reset() {
    this.earHistory = [];
    this.noseHistory = [];
    this.baselineEar = 0;
    this.sawDip = false;
    this.blinkDone = false;
    this.headTurnDone = false;
    this.noseMin = 1;
    this.noseMax = 0;
  }

  get isLive() {
    return this.blinkDone || this.headTurnDone;
  }

  get needsBlink() {
    return !this.isLive;
  }

  update(ear: number | undefined, noseX: number | undefined): FaceAlignStatus {
    if (typeof ear !== "number" || typeof noseX !== "number" || !Number.isFinite(ear)) {
      return "blink";
    }

    this.earHistory.push(ear);
    this.noseHistory.push(noseX);
    if (this.earHistory.length > 30) this.earHistory.shift();
    if (this.noseHistory.length > 30) this.noseHistory.shift();

    // Ochilgan ko‘z uchun bazaviy EAR (yumshoq o‘rtacha)
    if (this.earHistory.length >= 3 && this.baselineEar === 0) {
      const sorted = [...this.earHistory].sort((a, b) => a - b);
      this.baselineEar = sorted[Math.floor(sorted.length / 2)]!;
    } else if (ear > this.baselineEar && !this.sawDip) {
      this.baselineEar = this.baselineEar * 0.85 + ear * 0.15;
    }

    const base = Math.max(this.baselineEar, 0.18);
    // Nisbiy: ochiqdan ~22% pastga tushsa — yumilgan
    const closedThresh = Math.max(0.12, base * 0.78);
    const openThresh = Math.max(closedThresh + 0.02, base * 0.9);
    // Absolyut zaxira: ochiq max dan 0.05 pastga
    const recentMax = Math.max(...this.earHistory.slice(-8));
    const absoluteDip = ear <= recentMax - 0.05;

    if (!this.blinkDone) {
      if (ear <= closedThresh || absoluteDip) this.sawDip = true;
      if (this.sawDip && ear >= openThresh) {
        this.blinkDone = true;
      }
    }

    // Boshni chap-o‘ngga biroz burish (rasm odatda bir xil)
    this.noseMin = Math.min(this.noseMin, noseX);
    this.noseMax = Math.max(this.noseMax, noseX);
    if (this.noseMax - this.noseMin >= 0.035) {
      this.headTurnDone = true;
    }

    if (this.isLive) return "ok";

    // EAR deyarli o‘zgarmasa — rasm ehtimoli
    if (this.earHistory.length >= 18 && this.noseMax - this.noseMin < 0.01) {
      const min = Math.min(...this.earHistory.slice(-18));
      const max = Math.max(...this.earHistory.slice(-18));
      if (max - min < 0.02) return "photo";
    }

    return "blink";
  }
}

export function faceAlignHint(status: FaceAlignStatus): string {
  switch (status) {
    case "ok":
      return "Jonli yuz tasdiqlandi…";
    case "blink":
      return "Ko‘zingizni yumib oching yoki boshni chap-o‘ngga biroz buring";
    case "photo":
      return "Rasm emas — jonli yuz: ko‘zingizni yumib oching yoki boshni buring";
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
