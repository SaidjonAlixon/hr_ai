/**
 * Tezkor kamera ochish — exact facingMode ketma-ket fail’larni oldini oladi,
 * oxirgi muvaffaqiyatli sozlamani keshlaydi.
 */

export type CameraFacing = "user" | "environment";

type CacheEntry = {
  facing: CameraFacing;
  deviceId?: string;
  constraints: MediaStreamConstraints;
};

const cache: Partial<Record<CameraFacing, CacheEntry>> = {};

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

function remember(facing: CameraFacing, stream: MediaStream, constraints: MediaStreamConstraints) {
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.() ?? {};
  cache[facing] = {
    facing,
    deviceId: typeof settings.deviceId === "string" ? settings.deviceId : undefined,
    constraints,
  };
}

async function tryGet(constraints: MediaStreamConstraints, timeoutMs = 2200): Promise<MediaStream> {
  return withTimeout(
    navigator.mediaDevices.getUserMedia(constraints),
    timeoutMs,
  );
}

function buildAttempts(facing: CameraFacing): MediaStreamConstraints[] {
  if (facing === "user") {
    return [
      {
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      },
      { audio: false, video: { facingMode: "user" } },
      { audio: false, video: true },
    ];
  }
  return [
    {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    { audio: false, video: { facingMode: "environment" } },
    { audio: false, video: true },
  ];
}

/** Face ID — old kamera */
export async function openFaceCamera(): Promise<MediaStream> {
  return openCameraFast("user");
}

/** QR — orqa (bo‘lmasa old) */
export async function openScanCamera(): Promise<MediaStream> {
  return openCameraFast("environment");
}

export async function openCameraFast(facing: CameraFacing): Promise<MediaStream> {
  if (!window.isSecureContext) throw new Error("secure_context");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera_unsupported");

  const hit = cache[facing];
  if (hit?.deviceId) {
    try {
      const stream = await tryGet(
        {
          audio: false,
          video: {
            deviceId: { ideal: hit.deviceId },
            facingMode: { ideal: facing },
            width: { ideal: facing === "user" ? 640 : 1280 },
          },
        },
        1800,
      );
      remember(facing, stream, hit.constraints);
      return stream;
    } catch {
      /* cache eskirgan */
    }
  }
  if (hit?.constraints) {
    try {
      const stream = await tryGet(hit.constraints, 1800);
      remember(facing, stream, hit.constraints);
      return stream;
    } catch {
      /* fall through */
    }
  }

  let lastErr: unknown;
  for (const constraints of buildAttempts(facing)) {
    try {
      const stream = await tryGet(constraints, 2200);
      remember(facing, stream, constraints);
      return stream;
    } catch (e) {
      lastErr = e;
    }
  }

  // Oxirgi urinish: enumerateDevices orqali
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter((d) => d.kind === "videoinput");
    const pick =
      facing === "environment"
        ? videos.find((d) => /back|rear|environment|orqa|задн/i.test(d.label)) ||
          videos[videos.length - 1] ||
          videos[0]
        : videos.find((d) => /front|user|face|old|перед/i.test(d.label)) || videos[0];
    if (pick?.deviceId) {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: { deviceId: { ideal: pick.deviceId } },
      };
      const stream = await tryGet(constraints, 2500);
      remember(facing, stream, constraints);
      return stream;
    }
  } catch (e) {
    lastErr = e;
  }

  throw lastErr || new Error("camera_denied");
}

/** Ruxsat + kesh isitish (stream darhol yopiladi) */
export async function warmCamera(facing: CameraFacing = "user"): Promise<boolean> {
  try {
    const s = await openCameraFast(facing);
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}
