/**
 * Davomat uchun GPS + kamera ruxsatini bitta bosishda so‘raydi.
 * (Brauzer alohida dialog ko‘rsatishi mumkin, lekin ikkalasi ham shu click dan boshlanadi.)
 */

export type DavomatPermResult = {
  gps: GeolocationPosition | null;
  gpsError: string | null;
  camera: boolean;
  cameraError: string | null;
};

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Bitta user gesture ichida kamera + GPS so‘rash */
export async function requestDavomatPermissions(opts?: {
  gpsTimeoutMs?: number;
}): Promise<DavomatPermResult> {
  const timeout = opts?.gpsTimeoutMs ?? 20_000;

  // Kamera: old/orqa farqi yo‘q — umumiy camera ruxsati
  const cameraPromise = (async (): Promise<{ ok: boolean; error: string | null }> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, error: "camera_unsupported" };
    }
    let stream: MediaStream | null = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      }
      stopStream(stream);
      return { ok: true, error: null };
    } catch {
      stopStream(stream);
      return { ok: false, error: "camera_denied" };
    }
  })();

  const gpsPromise = (async (): Promise<{
    pos: GeolocationPosition | null;
    error: string | null;
  }> => {
    if (!navigator.geolocation) {
      return { pos: null, error: "gps_unsupported" };
    }
    // getCurrentPosition ni darhol boshlash — user gesture (iOS) saqlansin
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ pos, error: null }),
        (err) =>
          resolve({
            pos: null,
            error: err.code === 1 ? "gps_denied" : "gps_failed",
          }),
        { enableHighAccuracy: true, maximumAge: 0, timeout },
      );
    });
  })();

  // Parallel — bitta click gesture ichida
  const [cam, gps] = await Promise.all([cameraPromise, gpsPromise]);

  return {
    gps: gps.pos,
    gpsError: gps.error,
    camera: cam.ok,
    cameraError: cam.error,
  };
}
