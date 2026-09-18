/**
 * Kamera ochish — mobil brauzerlarda ruxsat dialogini bir marta so‘raydi.
 * Ketma-ket getUserMedia (exact facingMode fail’lari) qayta-promptni keltirib chiqarmasligi uchun
 * avval Permissions API / localStorage, keyin bitta oddiy so‘rov.
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

async function tryGet(constraints: MediaStreamConstraints, timeoutMs = 8000): Promise<MediaStream> {
  return withTimeout(navigator.mediaDevices.getUserMedia(constraints), timeoutMs);
}

/** Birinchi marta — eng oddiy so‘rov (dialog 1 marta). Keyin facing/deviceId. */
async function ensurePermissionOnce(): Promise<void> {
  const state = await queryCameraPermission();
  if (state === "granted") return;
  if (state === "denied") throw new Error("camera_denied");

  if (permissionInflight) {
    const ok = await permissionInflight;
    if (!ok) throw new Error("camera_denied");
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

  const ok = await permissionInflight;
  if (!ok) throw new Error("camera_denied");
}

function preferredConstraints(facing: CameraFacing, deviceId?: string): MediaStreamConstraints[] {
  const list: MediaStreamConstraints[] = [];
  if (deviceId) {
    list.push({
      audio: false,
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: facing === "user" ? 640 : 1280 },
      },
    });
    list.push({
      audio: false,
      video: {
        deviceId: { ideal: deviceId },
        width: { ideal: facing === "user" ? 640 : 1280 },
      },
    });
  }
  // Avvalo exact facingMode — QR/Face ID noto‘g‘ri kameraga tushmasin
  list.push({
    audio: false,
    video: {
      facingMode: { exact: facing },
      width: { ideal: facing === "user" ? 640 : 1280 },
      height: { ideal: facing === "user" ? 480 : 720 },
    },
  });
  list.push({
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: facing === "user" ? 640 : 1280 },
      height: { ideal: facing === "user" ? 480 : 720 },
    },
  });
  list.push({ audio: false, video: { facingMode: facing } });
  // Umumiy video:true YO‘Q — old/orqa aralashib ketmasin
  return list;
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

/** Face ID — standart old (selfie) kamera */
export async function openFaceCamera(): Promise<MediaStream> {
  return openCameraFast("user");
}

/** QR — orqa */
export async function openScanCamera(): Promise<MediaStream> {
  return openCameraFast("environment");
}

export async function openCameraFast(facing: CameraFacing): Promise<MediaStream> {
  if (!window.isSecureContext) throw new Error("secure_context");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera_unsupported");

  await ensurePermissionOnce();

  const stored = loadDeviceCache()[facing] || cache[facing]?.deviceId;
  let lastErr: unknown;

  for (const constraints of preferredConstraints(facing, stored)) {
    try {
      const stream = await tryGet(constraints, 8000);
      const got = reportedFacing(stream);
      if (got && got !== facing) {
        stream.getTracks().forEach((t) => t.stop());
        continue;
      }
      remember(facing, stream, constraints);
      return stream;
    } catch (e) {
      lastErr = e;
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        throw e;
      }
    }
  }

  // enumerateDevices — faqat ruxsat berilgandan keyin label’lar chiqadi
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
      const stream = await tryGet(constraints, 8000);
      remember(facing, stream, constraints);
      return stream;
    }
  } catch (e) {
    lastErr = e;
  }

  throw lastErr || new Error("camera_denied");
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
    // Faqat birinchi marta — bitta oddiy so‘rov
    await ensurePermissionOnce();
    return true;
  } catch {
    return false;
  }
}
