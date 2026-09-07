/**
 * Davomat: GPS + kamera ruxsatini bitta tugmadan so‘raydi.
 * Ketma-ket so‘raladi — brauzer dialogi ko‘rinsin.
 */

export type DavomatPermResult = {
  gps: GeolocationPosition | null;
  gpsError: string | null;
  camera: boolean;
  cameraError: string | null;
  cameraStream: MediaStream | null;
};

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
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

/** Kamera ruxsatini so‘rash (stream qaytaradi yoki to‘xtatib ok) */
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
  let stream: MediaStream | null = null;
  try {
    // Eng oddiy so‘rov — brauzer dialogini ishonchli chiqaradi
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
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

export async function requestGpsPermission(timeoutMs = 20_000): Promise<{
  pos: GeolocationPosition | null;
  error: string | null;
}> {
  if (!navigator.geolocation) {
    return { pos: null, error: "gps_unsupported" };
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ pos, error: null }),
      (err) =>
        resolve({
          pos: null,
          error: err.code === 1 ? "gps_denied" : "gps_failed",
        }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
  });
}

/** Bitta click: avval kamera, keyin GPS (dialoglar ketma-ket chiqadi) */
export async function requestDavomatPermissions(opts?: {
  gpsTimeoutMs?: number;
  keepCameraStream?: boolean;
}): Promise<DavomatPermResult> {
  const cam = await requestCameraPermission(Boolean(opts?.keepCameraStream));
  const gps = await requestGpsPermission(opts?.gpsTimeoutMs ?? 20_000);

  return {
    gps: gps.pos,
    gpsError: gps.error,
    camera: cam.ok,
    cameraError: cam.error,
    cameraStream: cam.stream,
  };
}
