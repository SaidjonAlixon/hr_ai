/**
 * Davomat: GPS + kamera ruxsatini bitta tugmadan so‘raydi.
 * Kamera va GPS — bir marta ruxsat, keyin qayta dialog yo‘q; joylashuv tez olinadi.
 */

export type DavomatPermResult = {
  gps: GeolocationPosition | null;
  gpsError: string | null;
  camera: boolean;
  cameraError: string | null;
  cameraStream: MediaStream | null;
};

const GPS_GRANT_KEY = "vaksina-gps-granted";

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

function markGpsGranted() {
  try {
    localStorage.setItem(GPS_GRANT_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Watch / muvaffaqiyatli fix — keyingi safar tugmasiz ishlasin */
export function rememberGpsGranted() {
  markGpsGranted();
}

export function wasGpsGrantedBefore(): boolean {
  try {
    return localStorage.getItem(GPS_GRANT_KEY) === "1";
  } catch {
    return false;
  }
}

export type MobileOs = "ios" | "android" | "other";

/** Qurilma turi — lokatsiya yo‘riqnomasi uchun */
export function detectMobileOs(): MobileOs {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS desktop UA
  if (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** Telefonda lokatsiya o‘chiq / olinmasa — qisqa yo‘riqnoma kaliti */
export function gpsEnableTipKey(os: MobileOs = detectMobileOs()): string {
  if (os === "android") return "davomat.gpsEnableAndroid";
  if (os === "ios") return "davomat.gpsEnableIos";
  return "davomat.gpsEnableGeneric";
}

export async function queryCameraPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  try {
    const status = await navigator.permissions?.query({
      name: "camera" as PermissionName,
    });
    if (status?.state === "granted" || status?.state === "denied" || status?.state === "prompt") {
      return status.state;
    }
  } catch {
    /* Safari / ba’zi brauzerlar camera permission query qilmaydi */
  }
  return "unknown";
}

export async function queryGeolocationPermission(): Promise<
  "granted" | "denied" | "prompt" | "unknown"
> {
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" });
    if (status?.state === "granted" || status?.state === "denied" || status?.state === "prompt") {
      if (status.state === "granted") markGpsGranted();
      return status.state;
    }
  } catch {
    /* Safari ba’zan geolocation query qilmaydi */
  }
  return wasGpsGrantedBefore() ? "granted" : "unknown";
}

/** Kamera ruxsatini so‘rash — allaqachon berilgan bo‘lsa qayta dialog yo‘q */
export async function requestCameraPermission(keepStream = false): Promise<{
  ok: boolean;
  error: string | null;
  stream: MediaStream | null;
}> {
  if (!window.isSecureContext) {
    return { ok: false, error: "insecure", stream: null };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, error: "camera_unsupported", stream: null };
  }

  const state = await queryCameraPermission();
  if (state === "denied") {
    return { ok: false, error: "camera_denied", stream: null };
  }
  // Allaqachon ruxsat bor va stream kerak emas — qayta getUserMedia yo‘q
  if ((state === "granted" || localStorage.getItem("vaksina-camera-granted") === "1") && !keepStream) {
    return { ok: true, error: null, stream: null };
  }

  let stream: MediaStream | null = null;
  try {
    // Bitta oddiy so‘rov — qayta-qayta facingMode urinishlari yo‘q
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    try {
      localStorage.setItem("vaksina-camera-granted", "1");
    } catch {
      /* ignore */
    }
    if (!keepStream) {
      stopStream(stream);
      stream = null;
    }
    return { ok: true, error: null, stream };
  } catch (e) {
    stopStream(stream);
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return { ok: false, error: "camera_denied", stream: null };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { ok: false, error: "camera_missing", stream: null };
    }
    return { ok: false, error: "camera_denied", stream: null };
  }
}

function getPositionOnce(opts: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, opts);
  });
}

function mapGpsError(err: GeolocationPositionError): string {
  if (err.code === 1) return "gps_denied";
  // 2 = unavailable (ko‘pincha telefon lokatsiyasi o‘chiq), 3 = timeout
  if (err.code === 2 || err.code === 3) return "gps_services_off";
  return "gps_failed";
}

/**
 * Joylashuvni tez olish:
 * 1) kesh / tarmoq (kutmasdan)
 * 2) aniqroq, lekin qisqa timeout
 * Ruxsat berilgandan keyin UI bloklanmasin.
 */
export async function requestGpsPermission(timeoutMs = 10_000): Promise<{
  pos: GeolocationPosition | null;
  error: string | null;
}> {
  if (!navigator.geolocation) {
    return { pos: null, error: "gps_unsupported" };
  }

  const perm = await queryGeolocationPermission();
  if (perm === "denied") {
    return { pos: null, error: "gps_denied" };
  }

  // 1) Tez: keshlangan yoki past aniqlik (Allow dan keyin darhol)
  try {
    const fast = await getPositionOnce({
      enableHighAccuracy: false,
      maximumAge: 120_000,
      timeout: Math.min(4_000, timeoutMs),
    });
    markGpsGranted();
    return { pos: fast, error: null };
  } catch {
    /* keyingi urinish */
  }

  // 2) Aniqroq — qisqa kutish (20s emas)
  try {
    const precise = await getPositionOnce({
      enableHighAccuracy: true,
      maximumAge: 15_000,
      timeout: Math.min(timeoutMs, 8_000),
    });
    markGpsGranted();
    return { pos: precise, error: null };
  } catch (e) {
    const err = e as GeolocationPositionError;
    if (err && typeof err.code === "number") {
      return { pos: null, error: mapGpsError(err) };
    }
    return { pos: null, error: "gps_failed" };
  }
}

/** Bitta click: avval kamera, keyin GPS (dialoglar ketma-ket chiqadi) */
export async function requestDavomatPermissions(opts?: {
  gpsTimeoutMs?: number;
  keepCameraStream?: boolean;
}): Promise<DavomatPermResult> {
  const cam = await requestCameraPermission(Boolean(opts?.keepCameraStream));
  const gps = await requestGpsPermission(opts?.gpsTimeoutMs ?? 10_000);

  return {
    gps: gps.pos,
    gpsError: gps.error,
    camera: cam.ok,
    cameraError: cam.error,
    cameraStream: cam.stream,
  };
}
