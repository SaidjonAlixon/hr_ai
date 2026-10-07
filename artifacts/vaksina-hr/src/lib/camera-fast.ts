/**
 * Kamera ochish — mobil brauzerlarda ruxsat dialogini bir marta so‘raydi.
 * Face ID: old (user) kamera; QR: orqa (environment).
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

async function tryGet(constraints: MediaStreamConstraints, timeoutMs = 10000): Promise<MediaStream> {
  const request = navigator.mediaDevices.getUserMedia(constraints);
  try {
    return await withTimeout(request, timeoutMs);
  } catch (e) {
    // Kech kelgan stream kamerani band qilib, keyingi preview’ni qora qilib qo‘ymasin (iOS)
    if (e instanceof Error && e.message === "camera_timeout") {
      void request.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => undefined);
    }
    throw e;
  }
}

/** Birinchi marta — eng oddiy so‘rov (dialog 1 marta). Denied bo‘lsa ham keyinroq qayta urinish mumkin. */
async function ensurePermissionOnce(): Promise<void> {
  const state = await queryCameraPermission();
  if (state === "granted") return;
  // "denied" — brauzer yolg‘on aytishi mumkin; baribir getUserMedia urinib ko‘ramiz

  if (permissionInflight) {
    await permissionInflight;
    return;
  }

  permissionInflight = (async () => {
    try {
      const stream = await tryGet({ audio: false, video: true }, 12000);
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

function preferredConstraints(facing: CameraFacing, deviceId?: string): MediaStreamConstraints[] {
  const list: MediaStreamConstraints[] = [
    // exact — telefonda aynan old/orqa kamera; kompyuter webkamerasida tez rad etiladi va keyingisiga o‘tadi
    {
      audio: false,
      video: {
        facingMode: { exact: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    {
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    { audio: false, video: { facingMode: { ideal: facing } } },
  ];
  if (deviceId) {
    list.push({
      audio: false,
      video: { deviceId: { ideal: deviceId } },
    });
  }
  if (facing === "user") list.push({ audio: false, video: true });
  return list;
}

async function resetDigitalZoom(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as { zoom?: { min?: number } } | undefined;
  const min = caps?.zoom?.min;
  if (!track || typeof min !== "number") return;
  try {
    await track.applyConstraints({ advanced: [{ zoom: min } as MediaTrackConstraintSet] });
  } catch {
    /* ba’zi telefonlar zoom bermaydi */
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

/** Face ID — standart old (selfie) kamera */
export async function openFaceCamera(): Promise<MediaStream> {
  return openCameraFast("user");
}

/** QR — orqa */
export async function openScanCamera(): Promise<MediaStream> {
  return openCameraFast("environment");
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

/** Bir vaqtda faqat bitta kamera so‘rovi — parallel getUserMedia telefonda «kamera band» yoki qora ekran beradi */
let openChain: Promise<unknown> = Promise.resolve();

export function openCameraFast(facing: CameraFacing): Promise<MediaStream> {
  const run = openChain.then(
    () => openCameraOnce(facing),
    () => openCameraOnce(facing),
  );
  openChain = run.catch(() => undefined);
  return run;
}

async function openCameraOnce(facing: CameraFacing): Promise<MediaStream> {
  if (!window.isSecureContext) throw new Error("secure_context");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera_unsupported");
  if (permissionInflight) await permissionInflight.catch(() => undefined);

  const stored = loadDeviceCache()[facing] || cache[facing]?.deviceId;
  let lastErr: unknown;
  let denied = false;
  let busyRetried = false;

  let attempt = 0;
  for (const constraints of preferredConstraints(facing, stored)) {
    const usesStored = Boolean(stored && JSON.stringify(constraints.video).includes(stored));
    try {
      // Ruxsat oynasi chiqishi mumkin — foydalanuvchiga vaqt beramiz
      const firstTime = attempt++ === 0 || !wasCameraGrantedBefore();
      let stream: MediaStream;
      try {
        stream = await tryGet(constraints, firstTime ? 20000 : 8000);
      } catch (e) {
        // Oldingi oqim hali bo‘shamagan — biroz kutib aynan shu so‘rovni qaytaramiz
        if (!isCameraBusy(e) || busyRetried) throw e;
        busyRetried = true;
        await sleep(600);
        stream = await tryGet(constraints, 8000);
      }
      await resetDigitalZoom(stream);
      const got = reportedFacing(stream);
      // Faqat aniq noto‘g‘ri kamerani rad etamiz; facing noma’lum bo‘lsa qabul (kompyuter webkamerasi)
      if (got && got !== facing) {
        stream.getTracks().forEach((t) => t.stop());
        if (usesStored) clearDeviceId(facing);
        continue;
      }
      if (got === facing) remember(facing, stream, constraints);
      else markGranted();
      return stream;
    } catch (e) {
      lastErr = e;
      if (isPermissionDenied(e)) {
        denied = true;
        break;
      }
      // Eski deviceId ishlamasa — cache tozalab davom etamiz
      if (usesStored) clearDeviceId(facing);
    }
  }

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
          video: { deviceId: { ideal: pick.deviceId } },
        };
        const stream = await tryGet(constraints, 6000);
        await resetDigitalZoom(stream);
        remember(facing, stream, constraints);
        return stream;
      }
    } catch (e) {
      lastErr = e;
      if (isPermissionDenied(e)) denied = true;
    }
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
 * Ruxsatni fonida tekshirish — agar allaqachon granted bo‘lsa getUserMedia chaqirmaydi
 * (mobil’da qayta dialog chiqmasin).
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

/** UI uchun xato kodini o‘qiladigan qilish */
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
