/** Face ID — faqat kamera orqali yuz vektori */

const FACE_API_SRC = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights";

type Point = { x: number; y: number };

type FaceLandmarksResult = {
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
  descriptor?: Float32Array;
};

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
    withFaceLandmarks: () => Promise<FaceLandmarksResult | undefined> & {
      withFaceDescriptor: () => Promise<(FaceLandmarksResult & { descriptor: Float32Array }) | undefined>;
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
  | "hold_still"
  | "low_quality"
  | "turn_face";

export type FaceDetectResult = {
  descriptor: number[] | null;
  status: FaceAlignStatus;
  score?: number;
};

export type FaceOvalFrame = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};

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

function noseOffsetRatio(landmarks: FaceLandmarksResult["landmarks"], box: { x: number; width: number }): number {
  const nose = landmarks.getNose?.();
  const tip = nose?.[nose.length - 1] ?? nose?.[3];
  const positions = landmarks.positions;
  const nx = tip?.x ?? positions?.[30]?.x;
  if (nx == null || !box.width) return 0;
  const mid = box.x + box.width / 2;
  return Math.abs(nx - mid) / box.width;
}

/** Yuqori sifat: katta inputSize + qattiq score */
const DETECT_OPTS = { inputSize: 512 as const, scoreThreshold: 0.55 };
const MIN_DETECT_SCORE = 0.68;

export async function detectFaceDescriptor(
  video: HTMLVideoElement,
  frame?: FaceOvalFrame | null,
  mirrored = true,
): Promise<FaceDetectResult> {
  const faceapi = await ensureFaceModels();
  const result = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions(DETECT_OPTS))
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!result || result.detection.score < MIN_DETECT_SCORE) {
    return { descriptor: null, status: "no_face" };
  }
  if (!frame || frame.rx < 8 || frame.ry < 8) {
    return { descriptor: null, status: "outside" };
  }

  const mapped = mapVideoBoxToElement(video, result.detection.box, mirrored);
  if (!mapped) return { descriptor: null, status: "no_face" };

  if (ellipseNorm(mapped.cx, mapped.cy, frame) > 0.48) {
    return { descriptor: null, status: "outside" };
  }

  const fillW = mapped.width / (frame.rx * 2);
  const fillH = mapped.height / (frame.ry * 2);
  if (fillW < 0.48 || fillH < 0.46) return { descriptor: null, status: "too_far" };
  if (fillW > 1.18 || fillH > 1.2) return { descriptor: null, status: "too_close" };

  // Yon tomonga burilgan yuz — descriptor sifatini pasaytiradi
  if (noseOffsetRatio(result.landmarks, result.detection.box) > 0.18) {
    return { descriptor: null, status: "turn_face", score: result.detection.score };
  }

  if (!result.descriptor) {
    return { descriptor: null, status: "low_quality", score: result.detection.score };
  }

  return {
    descriptor: Array.from(result.descriptor),
    status: "ok",
    score: result.detection.score,
  };
}

export function euclideanDescriptor(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

export function isStableSample(prev: number[] | null, next: number[], maxDist = 0.2): boolean {
  if (!prev) return true;
  return euclideanDescriptor(prev, next) <= maxDist;
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

/** Chetki namunalarni tashlab o‘rtacha olish */
export function averageDescriptorsRobust(list: number[][]): number[] {
  if (list.length <= 2) return averageDescriptors(list);
  const mean = averageDescriptors(list);
  const scored = list.map((d) => ({ d, dist: euclideanDescriptor(d, mean) }));
  scored.sort((a, b) => a.dist - b.dist);
  const keep = scored.slice(0, Math.max(4, Math.ceil(scored.length * 0.65))).map((x) => x.d);
  return averageDescriptors(keep.length ? keep : list);
}

export function faceAlignHint(status: FaceAlignStatus): string {
  switch (status) {
    case "ok":
      return "Yuz aniq — harakatsiz turing…";
    case "hold_still":
      return "Biroz to‘xtang — aniqroq olinmoqda…";
    case "low_quality":
      return "Yuz aniq emas — yorug‘likni yaxshilang";
    case "turn_face":
      return "Kameraga to‘g‘ri qarang (yon tomonga emas)";
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
    const err = new Error((body as { error?: string }).error || "Face ID xatosi") as Error & {
      code?: string;
      fullName?: string;
      neighbors?: unknown;
    };
    err.code = (body as { code?: string }).code;
    err.fullName = (body as { fullName?: string }).fullName;
    err.neighbors = (body as { neighbors?: unknown }).neighbors;
    throw err;
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
  hasPhoto?: boolean;
  photoUrl?: string | null;
  createdAt?: string | null;
};

export async function fetchFaceIdStatus(): Promise<FaceIdStatus> {
  return apiJson<FaceIdStatus>("/auth/face/status");
}

export async function updateMyProfile(input: {
  firstName: string;
  lastName: string;
  password: string;
}): Promise<{ user: { id: number; fullName: string; role: string; login?: string }; message?: string }> {
  return apiJson("/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function compressFaceSnapshotAsync(
  dataUrl: string | undefined,
  maxSide = 480,
  quality = 0.82,
): Promise<string | undefined> {
  if (!dataUrl?.startsWith("data:image/")) return undefined;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image"));
      el.src = dataUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl.startsWith("data:image/") ? dataUrl : undefined;
  }
}

export async function enrollFace(descriptor: number[], snapshot?: string): Promise<{ photoUrl?: string | null }> {
  if (!snapshot?.startsWith("data:image/")) {
    throw new Error("Yuz rasmi olinmadi — qayta urinib ko‘ring");
  }
  const photo = (await compressFaceSnapshotAsync(snapshot)) || snapshot;
  const res = await apiJson<{ photoUrl?: string | null }>("/auth/face/enroll", {
    method: "POST",
    body: JSON.stringify({ descriptor, snapshot: photo, photo }),
  });
  return res;
}

export async function loginWithFace<TUser>(
  descriptor: number[],
  snapshot?: string,
): Promise<{ user: TUser; fullName?: string; message?: string }> {
  const photo = snapshot ? await compressFaceSnapshotAsync(snapshot) : undefined;
  return apiJson<{ user: TUser; fullName?: string; message?: string }>("/auth/face/login", {
    method: "POST",
    body: JSON.stringify({ descriptor, snapshot: photo }),
  });
}

export async function removeFaceId(): Promise<void> {
  await apiJson("/auth/face", { method: "DELETE" });
}

export type AdminFaceRow = {
  id: number;
  userId: number;
  fullName: string;
  login: string;
  role: string;
  roleLabel: string;
  status: string;
  phone: string | null;
  departmentName: string | null;
  photoUrl: string | null;
  hasPhoto: boolean;
  faceRegistered: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastUsedAt: string | null;
  nearest: {
    userId: number;
    fullName: string;
    login: string;
    distance: number;
  } | null;
  similarRisk: "none" | "medium" | "high";
};

export type AdminFacesResponse = {
  total: number;
  registered: number;
  notRegistered: number;
  withPhoto: number;
  similarPairs: number;
  enrollBlockMax: number;
  faces: AdminFaceRow[];
  duplicates: Array<{
    a: { userId: number; fullName: string; login: string };
    b: { userId: number; fullName: string; login: string };
    distance: number;
  }>;
};

export async function fetchAdminFaces(): Promise<AdminFacesResponse> {
  return apiJson<AdminFacesResponse>("/admin/faces");
}

export async function downloadAdminFacesExcel(params?: {
  q?: string;
  status?: "all" | "yes" | "no";
  onlyRisk?: boolean;
}): Promise<void> {
  const sp = new URLSearchParams();
  if (params?.q?.trim()) sp.set("q", params.q.trim());
  if (params?.status && params.status !== "all") sp.set("status", params.status);
  if (params?.onlyRisk) sp.set("onlyRisk", "1");
  const qs = sp.toString();
  const res = await fetch(`/api/admin/faces/export${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "Excel yuklanmadi");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `face-id_${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function adminResetFace(userId: number): Promise<{ message: string }> {
  return apiJson(`/admin/faces/${userId}`, { method: "DELETE" });
}

export function isFaceIdCancelled(err: unknown): boolean {
  const name = err instanceof DOMException ? err.name : "";
  return name === "NotAllowedError" || name === "AbortError";
}
