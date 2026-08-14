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
            landmarks: { positions: Point[] };
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
  if (centerN > 0.42) {
    return { descriptor: null, status: "outside" };
  }

  const fillW = mapped.width / (frame.rx * 2);
  const fillH = mapped.height / (frame.ry * 2);
  if (fillW < 0.52 || fillH < 0.48) {
    return { descriptor: null, status: "too_far" };
  }
  if (fillW > 1.08 || fillH > 1.12) {
    return { descriptor: null, status: "too_close" };
  }

  const positions = result.landmarks?.positions ?? [];
  const ear = positions.length >= 48 ? averageEar(positions) : 0.3;
  const nose = positions[30];
  const noseX = nose ? nose.x / Math.max(1, video.videoWidth) : 0.5;

  return {
    descriptor: Array.from(result.descriptor),
    status: "ok",
    ear,
    noseX,
  };
}

/** Jonli odam: ko‘z yumish + tabiiy harakat (rasm/staticdan himoya) */
export class LivenessTracker {
  private earHistory: number[] = [];
  private noseHistory: number[] = [];
  private sawClosed = false;
  private blinkDone = false;
  private motionScore = 0;

  reset() {
    this.earHistory = [];
    this.noseHistory = [];
    this.sawClosed = false;
    this.blinkDone = false;
    this.motionScore = 0;
  }

  get isLive() {
    return this.blinkDone && this.motionScore >= 0.012;
  }

  get needsBlink() {
    return !this.blinkDone;
  }

  update(ear: number | undefined, noseX: number | undefined): FaceAlignStatus {
    if (typeof ear !== "number" || typeof noseX !== "number") {
      return "blink";
    }

    this.earHistory.push(ear);
    this.noseHistory.push(noseX);
    if (this.earHistory.length > 24) this.earHistory.shift();
    if (this.noseHistory.length > 24) this.noseHistory.shift();

    // Ko‘z yumilgan (EAR past) → ochilgan (EAR yuqori) = blink
    const EAR_CLOSED = 0.19;
    const EAR_OPEN = 0.24;
    if (!this.blinkDone) {
      if (ear < EAR_CLOSED) this.sawClosed = true;
      if (this.sawClosed && ear > EAR_OPEN) {
        this.blinkDone = true;
      }
    }

    // Burun joylashuvi o‘zgarishi — rasm qimirlamasa past
    if (this.noseHistory.length >= 4) {
      let motion = 0;
      for (let i = 1; i < this.noseHistory.length; i++) {
        motion += Math.abs(this.noseHistory[i]! - this.noseHistory[i - 1]!);
      }
      this.motionScore = Math.max(this.motionScore, motion / (this.noseHistory.length - 1));
    }

    // Juda barqaror EAR (rasm) — blinksiz uzoq turib qolsa photo
    if (!this.blinkDone && this.earHistory.length >= 14) {
      const min = Math.min(...this.earHistory.slice(-14));
      const max = Math.max(...this.earHistory.slice(-14));
      if (max - min < 0.025 && this.motionScore < 0.004) {
        return "photo";
      }
      return "blink";
    }

    if (!this.blinkDone) return "blink";
    if (this.motionScore < 0.012) return "blink";
    return "ok";
  }
}

export function faceAlignHint(status: FaceAlignStatus): string {
  switch (status) {
    case "ok":
      return "Jonli yuz tasdiqlandi…";
    case "blink":
      return "Ko‘zingizni yumib oching (rasm emas — jonli)";
    case "photo":
      return "Rasm emas — jonli yuzingizni ko‘rsating va ko‘zingizni yumib oching";
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
