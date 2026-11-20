/**
 * Kamera ochish — mobil brauzerlarda tez va ishonchli.
 * Face ID: old (user); QR: orqa (environment).
 * Parallel getUserMedia yo‘q — bitta navbat.
 */

export type CameraFacing = "user" | "environment";

const GRANT_KEY = "vaksina-camera-granted";
const DEVICE_KEY = "vaksina-camera-devices";

type CacheEntry = {
  facing: CameraFacing;
  deviceId?: string;
  constraints: MediaStreamConstraints;
};

const cache: Partial<Record<CameraFacing, CacheEntry>> = {};
let permissionInflight: Promise<boolean> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("camera_timeout")), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

function markGranted() {
  try {
    localStorage.setItem(GRANT_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function wasCameraGrantedBefore(): boolean {
  try {
    return localStorage.getItem(GRANT_KEY) === "1";
  } catch {
    return false;
  }
}

function loadDeviceCache(): Partial<Record<CameraFacing, string>> {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Record<CameraFacing, string>>;
  } catch {
    return {};
  }
}

function saveDeviceId(facing: CameraFacing, deviceId: string) {
  try {
    const cur = loadDeviceCache();
    cur[facing] = deviceId;
    localStorage.setItem(DEVICE_KEY, JSON.stringify(cur));
  } catch {
    /* ignore */
  }
}

function clearDeviceId(facing: CameraFacing) {
  try {
    const cur = loadDeviceCache();
    delete cur[facing];
    localStorage.setItem(DEVICE_KEY, JSON.stringify(cur));
    delete cache[facing];
  } catch {
    /* ignore */
  }
}

/** Qora preview / timeout — eski deviceId ni tozalash */
export function clearCameraDeviceCache(facing?: CameraFacing) {
  if (facing) {
    clearDeviceId(facing);
    return;
  }
  try {
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* ignore */
  }
  delete cache.user;
  delete cache.environment;
}

export async function queryCameraPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  try {
    const status = await navigator.permissions?.query({
      name: "camera" as PermissionName,
    });
    if (status?.state === "granted" || status?.state === "denied" || status?.state === "prompt") {
      if (status.state === "granted") markGranted();
      return status.state;
    }
  } catch {
    /* Safari / WebView */
  }
  return wasCameraGrantedBefore() ? "granted" : "unknown";
}

function remember(facing: CameraFacing, stream: MediaStream, constraints: MediaStreamConstraints) {
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.() ?? {};
  const deviceId = typeof settings.deviceId === "string" ? settings.deviceId : undefined;
  cache[facing] = { facing, deviceId, constraints };
  if (deviceId) saveDeviceId(facing, deviceId);
  markGranted();
}

async function tryGet(constraints: MediaStreamConstraints, timeoutMs: number): Promise<MediaStream> {
  const request = navigator.mediaDevices.getUserMedia(constraints);
  try {
    return await withTimeout(request, timeoutMs);
  } catch (e) {
    // Kech kelgan stream kamerani band qilib qo‘ymasin
    if (e instanceof Error && e.message === "camera_timeout") {
      void request.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => undefined);
    }
    throw e;
  }
}

/** Faqat ruxsat holatini tekshirish — stream ochib yopmaydi (skaner band bo‘lmasin) */
async function ensurePermissionOnce(): Promise<void> {
  const state = await queryCameraPermission();
  if (state === "granted" || wasCameraGrantedBefore()) return;

  if (permissionInflight) {
    await permissionInflight;
    return;
  }

  permissionInflight = (async () => {
    try {
      const stream = await tryGet({ audio: false, video: true }, 10_000);
      stream.getTracks().forEach((t) => t.stop());
      markGranted();
      return true;
    } catch {
      return false;
    } finally {
      permissionInflight = null;
    }
  })();

  await permissionInflight;
}

/**
 * Tez constraint zanjiri — avval facingMode (iOS/TG ishonchli),
 * keyin keshdagi deviceId. Eski deviceId birinchi bo‘lsa ko‘p telefonda qora/timeout.
 * `exact` ishlatilmaydi.
 */
function preferredAttempts(
  facing: CameraFacing,
  deviceId: string | undefined,
  grantedBefore: boolean,
): Array<{ constraints: MediaStreamConstraints; timeoutMs: number; usesStored: boolean }> {
  const firstMs = grantedBefore ? 7_000 : 12_000;
  const nextMs = 4_000;
  // QR uchun yuqoriroq o‘lcham (kichik kodlar uzoqdan o‘qilsin); Face ID uchun yengil 640x480
  const size =
    facing === "environment"
      ? { width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 640 }, height: { ideal: 480 } };
  const list: Array<{ constraints: MediaStreamConstraints; timeoutMs: number; usesStored: boolean }> =
    [];

  // 1) Eng sodda facingMode — Telegram WebView / Android uchun eng barqaror
  list.push({
    usesStored: false,
    timeoutMs: firstMs,
    constraints: {
      audio: false,
      video: {
        facingMode: facing,
        ...size,
      },
    },
  });

  // 2) Keshdagi deviceId — faqat zaxira (noto‘g‘ri bo‘lsa clear qilinadi)
  if (deviceId) {
    list.push({
      usesStored: true,
      timeoutMs: 3_500,
      constraints: {
        audio: false,
        video: {
          deviceId: { ideal: deviceId },
          ...size,
        },
      },
    });
  }

  list.push({
    usesStored: false,
    timeoutMs: nextMs,
    constraints: {
      audio: false,
      video: { facingMode: { ideal: facing } },
    },
  });

  list.push({
    usesStored: false,
    timeoutMs: nextMs,
    constraints: { audio: false, video: true },
  });

  return list;
}

/**
 * Kerakli yaqinlashtirish. Oldin zoom MINIMUMGA (eng keng burchak) qo'yilardi — shu sabab
 * kamera "uzoq" ko'rsatardi. Endi QR uchun ~2x, yuz uchun ~1.3x.
 */
const ZOOM_TARGET: Record<CameraFacing, number> = { environment: 2, user: 1.3 };
/** Qurilma zoom'i yo'q bo'lsa (iOS) — faqat QR preview'ni CSS bilan yaqinlashtiramiz */
const CSS_FALLBACK_SCALE: Record<CameraFacing, number> = { environment: 1.35, user: 1 };

/** Qurilma (hardware) zoom'i haqiqatan qo'llangan oqimlar */
const hwZoom = new WeakMap<MediaStream, number>();
const tuned = new WeakMap<MediaStream, Promise<void>>();

/** Zoom + doimiy avtofokus (bir oqim uchun bir marta). Ochilishni kechiktirmaslik uchun kutilmaydi. */
export function tuneCameraStream(stream: MediaStream, facing: CameraFacing): Promise<void> {
  const prev = tuned.get(stream);
  if (prev) return prev;
  const p = applyZoomAndFocus(stream, facing).catch(() => undefined);
  tuned.set(stream, p);
  return p;
}

/** Preview uchun qo'shimcha CSS scale (qurilma zoom'i ishlagan bo'lsa 1). */
export function cameraViewScale(stream: MediaStream | null | undefined, facing: CameraFacing): number {
  if (!stream) return 1;
  const hw = hwZoom.get(stream);
  if (hw && hw > 1.05) return 1;
  return CSS_FALLBACK_SCALE[facing];
}

async function applyZoomAndFocus(stream: MediaStream, facing: CameraFacing) {
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as
    | { zoom?: { min?: number; max?: number }; focusMode?: string[] }
    | undefined;
  if (!track || !caps) return;
  const zoomMin = typeof caps.zoom?.min === "number" ? caps.zoom.min : 1;
  const zoomMax = caps.zoom?.max;
  const want = typeof zoomMax === "number" ? Math.min(zoomMax, Math.max(zoomMin, ZOOM_TARGET[facing])) : 0;
  if (want > 1.05) {
    try {
      await track.applyConstraints({ advanced: [{ zoom: want } as MediaTrackConstraintSet] });
      const got = (track.getSettings?.() as { zoom?: number } | undefined)?.zoom;
      if (typeof got === "number" && got > 1.05) hwZoom.set(stream, got);
    } catch {
      /* zoom yo‘q */
    }
  }
  // Doimiy avtofokus — QR/yuz aniq bo‘lsin
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
    try {
      await track.applyConstraints({
        advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
      });
    } catch {
      /* fokus boshqarilmaydi */
    }
  }
}

function reportedFacing(stream: MediaStream): CameraFacing | null {
  try {
    const fm = stream.getVideoTracks()[0]?.getSettings?.()?.facingMode;
    if (fm === "user" || fm === "environment") return fm;
  } catch {
    /* ignore */
  }
  return null;
}

function isPermissionDenied(e: unknown): boolean {
  if (e instanceof DOMException) {
    return e.name === "NotAllowedError" || e.name === "PermissionDeniedError";
  }
  if (e instanceof Error && e.message === "camera_denied") return true;
  return false;
}

function isCameraBusy(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "NotReadableError" || e.name === "TrackStartError" || e.name === "AbortError")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Face ID — old (selfie) */
export async function openFaceCamera(): Promise<MediaStream> {
  return openCameraFast("user");
}

/** QR — orqa */
export async function openScanCamera(): Promise<MediaStream> {
  return openCameraFast("environment");
}

/** Bir vaqtda faqat bitta kamera so‘rovi */
let openChain: Promise<unknown> = Promise.resolve();

/** Bosish paytida (user gesture) boshlangan, dialog hali olmagan kamera */
const pendingOpen: Partial<Record<CameraFacing, Promise<MediaStream>>> = {};

/**
 * Tugma bosilgan zahoti chaqiring: kamera dialog chizilguncha parallel ochila boshlaydi.
 * Dialog `openCameraFast` chaqirganda tayyor (yoki yo‘ldagi) oqimni oladi.
 * 10 soniyada olinmasa — avtomatik yopiladi (kamera band qolmasin).
 */
export function prefetchCamera(facing: CameraFacing): void {
  if (typeof window === "undefined") return;
  if (pendingOpen[facing]) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return;
  const p = runOpen(facing);
  pendingOpen[facing] = p;
  const timer = window.setTimeout(() => {
    if (pendingOpen[facing] !== p) return;
    delete pendingOpen[facing];
    void p.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => undefined);
  }, 10_000);
  p.catch(() => {
    window.clearTimeout(timer);
    if (pendingOpen[facing] === p) delete pendingOpen[facing];
  });
}

function isHardFailure(e: unknown): boolean {
  if (e instanceof DOMException) {
    return (
      e.name === "NotAllowedError" ||
      e.name === "PermissionDeniedError" ||
      e.name === "NotFoundError" ||
      e.name === "DevicesNotFoundError" ||
      e.name === "SecurityError"
    );
  }
  return (
    e instanceof Error &&
    (e.message === "camera_denied" ||
      e.message === "secure_context" ||
      e.message === "camera_unsupported" ||
      e.message === "camera_not_found")
  );
}

function runOpen(facing: CameraFacing): Promise<MediaStream> {
  const run = openChain.then(
    async () => {
      try {
        return await openCameraOnce(facing);
      } catch (e) {
        // Ruxsat yo‘q / kamera yo‘q — qayta urinish befoyda
        if (isHardFailure(e)) throw e;
        // Timeout / band / qora kesh — tozalab bitta qayta urinish
        clearCameraDeviceCache(facing);
        await sleep(isCameraBusy(e) ? 500 : 250);
        return openCameraOnce(facing);
      }
    },
    () => openCameraOnce(facing),
  );
  openChain = run.catch(() => undefined);
  return run;
}

export async function openCameraFast(facing: CameraFacing): Promise<MediaStream> {
  const pending = pendingOpen[facing];
  if (pending) {
    delete pendingOpen[facing];
    try {
      const s = await pending;
      if (s.getVideoTracks().some((t) => t.readyState === "live")) return s;
      s.getTracks().forEach((t) => t.stop());
    } catch (e) {
      if (isHardFailure(e)) throw e;
    }
  }
  return runOpen(facing);
}

async function openCameraOnce(facing: CameraFacing): Promise<MediaStream> {
  if (!window.isSecureContext) throw new Error("secure_context");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera_unsupported");
  if (permissionInflight) await permissionInflight.catch(() => undefined);

  const grantedBefore = wasCameraGrantedBefore();
  const stored = loadDeviceCache()[facing] || cache[facing]?.deviceId;
  let lastErr: unknown;
  let denied = false;
  let busyRetried = false;
  /** Noto‘g‘ri facing bilan ochilgan, lekin ishlayotgan stream — oxirgi zaxira */
  let fallbackStream: MediaStream | null = null;

  const accept = async (stream: MediaStream, constraints: MediaStreamConstraints, got: CameraFacing | null) => {
    // Zoom/fokus fonda qo'llanadi — kamera ochilishini kechiktirmaydi
    void tuneCameraStream(stream, facing);
    if (got === facing) remember(facing, stream, constraints);
    else markGranted();
    return stream;
  };

  for (const attempt of preferredAttempts(facing, stored, grantedBefore)) {
    const { constraints, timeoutMs, usesStored } = attempt;
    try {
      let stream: MediaStream;
      try {
        stream = await tryGet(constraints, timeoutMs);
      } catch (e) {
        if (e instanceof DOMException && e.name === "OverconstrainedError") {
          lastErr = e;
          if (usesStored) clearDeviceId(facing);
          continue;
        }
        if (!isCameraBusy(e) || busyRetried) throw e;
        busyRetried = true;
        await sleep(450);
        stream = await tryGet(constraints, Math.min(timeoutMs, 6_000));
      }

      const got = reportedFacing(stream);
      // Ko‘p telefonda facingMode noto‘g‘ri/yo‘q — ishlayotgan streamni rad etmaymiz
      if (got && got !== facing) {
        if (!fallbackStream) fallbackStream = stream;
        else stream.getTracks().forEach((t) => t.stop());
        if (usesStored) clearDeviceId(facing);
        continue;
      }
      if (fallbackStream && fallbackStream !== stream) {
        fallbackStream.getTracks().forEach((t) => t.stop());
        fallbackStream = null;
      }
      return await accept(stream, constraints, got);
    } catch (e) {
      lastErr = e;
      if (isPermissionDenied(e)) {
        denied = true;
        break;
      }
      if (usesStored) clearDeviceId(facing);
    }
  }

  // EnumerateDevices — oxirgi urinish
  if (!denied) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((d) => d.kind === "videoinput" && d.deviceId);
      const pick =
        facing === "environment"
          ? videos.find((d) => /back|rear|environment|orqa|задн|world/i.test(d.label)) ||
            (videos.length > 1 ? videos[videos.length - 1] : undefined) ||
            videos[0]
          : videos.find((d) => /front|user|face|old|перед|selfie/i.test(d.label)) || videos[0];
      if (pick?.deviceId) {
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: {
            deviceId: { ideal: pick.deviceId },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
        };
        const stream = await tryGet(constraints, 5_000);
        if (fallbackStream) {
          fallbackStream.getTracks().forEach((t) => t.stop());
          fallbackStream = null;
        }
        return await accept(stream, constraints, reportedFacing(stream));
      }
    } catch (e) {
      lastErr = e;
      if (isPermissionDenied(e)) denied = true;
    }
  }

  // Hech bo‘lmasa ishlayotgan (facing nomuvofiq) stream
  if (fallbackStream) {
    markGranted();
    return fallbackStream;
  }

  if (denied || isPermissionDenied(lastErr)) {
    throw new Error("camera_denied");
  }
  if (lastErr instanceof Error && lastErr.message === "camera_timeout") {
    throw lastErr;
  }
  throw lastErr instanceof Error ? lastErr : new Error("camera_denied");
}

/**
 * Ruxsatni fonida tekshirish — granted bo‘lsa getUserMedia chaqirmaydi.
 */
export async function warmCamera(_facing: CameraFacing = "user"): Promise<boolean> {
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return false;
    const state = await queryCameraPermission();
    if (state === "granted" || wasCameraGrantedBefore()) {
      markGranted();
      return true;
    }
    if (state === "denied") return false;
    await ensurePermissionOnce();
    return true;
  } catch {
    return false;
  }
}

/** UI uchun xato kodi */
export function cameraErrorCode(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") return "camera_denied";
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") return "camera_not_found";
    if (err.name === "NotReadableError" || err.name === "TrackStartError") return "camera_busy";
  }
  if (err instanceof Error) {
    const m = err.message;
    if (
      m === "camera_denied" ||
      m === "secure_context" ||
      m === "camera_unsupported" ||
      m === "camera_timeout" ||
      m === "camera_not_found" ||
      m === "camera_busy"
    ) {
      return m;
    }
  }
  return "camera_failed";
}
