import { createContext, destroyContext, domToCanvas } from "modern-screenshot";

/**
 * «Ilova ko‘rinishi» ulashish: VAKSINA HR oynasini kadrma-kadr canvas'ga chizib, MediaStream qiladi.
 * Telefon brauzerlarida getDisplayMedia yo‘q — shu sabab masofadan boshqaruv va mobil ulashish shu orqali ishlaydi.
 */
export type AppShare = { track: MediaStreamTrack; stop: () => void };

const MAX_SIDE = 1280;
const IS_MOBILE = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const IS_SAFARI =
  typeof navigator !== "undefined" && /AppleWebKit/i.test(navigator.userAgent) && !/Chrome|CriOS|Chromium|Edg|FxiOS/i.test(navigator.userAgent);

function skipCallUi(node: Node): boolean {
  return !(node instanceof Element && node.hasAttribute("data-call-ui"));
}

export function startAppShare(fps = 6, onFail?: () => void): AppShare {
  const out = document.createElement("canvas");
  const g = out.getContext("2d", { alpha: false })!;
  const targetFps = IS_MOBILE ? Math.min(fps, 5) : fps;
  const stream = out.captureStream(targetFps);
  const track = stream.getVideoTracks()[0];
  track.contentHint = "detail";
  let alive = true;
  let ctxKey = "";
  let fails = 0;
  let warned = false;
  let shotCtx: Awaited<ReturnType<typeof createContext<HTMLElement>>> | null = null;

  const sizeFor = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.25 : 1.5, MAX_SIDE / Math.max(w, h));
    return { w, h, scale };
  };

  const paintPlaceholder = () => {
    if (!out.width) {
      out.width = 640;
      out.height = 360;
    }
    g.fillStyle = "#0f172a";
    g.fillRect(0, 0, out.width, out.height);
  };

  const loop = async () => {
    paintPlaceholder();
    while (alive) {
      const t0 = performance.now();
      try {
        const { w, h, scale } = sizeFor();
        const key = `${w}x${h}@${scale.toFixed(2)}`;
        if (!shotCtx || key !== ctxKey) {
          if (shotCtx) destroyContext(shotCtx);
          shotCtx = await createContext(document.body, {
            width: w,
            height: h,
            scale,
            backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
            filter: skipCallUi,
            timeout: 4000,
            // Safari'da har rasm uchun 100 ms dan qayta-qayta chizish bir kadrni soniyalab cho‘zadi — o‘chiriladi
            features: { restoreScrollPosition: true, fixSvgXmlDecode: !IS_SAFARI },
            autoDestruct: false,
          });
          ctxKey = key;
          out.width = Math.round(w * scale);
          out.height = Math.round(h * scale);
        }
        const sy = window.scrollY;
        shotCtx.style = sy > 0 ? { transform: `translateY(${-sy}px)` } : {};
        const shot = await domToCanvas(shotCtx);
        if (!alive) break;
        g.drawImage(shot, 0, 0, out.width, out.height);
        fails = 0;
      } catch {
        if (shotCtx) destroyContext(shotCtx);
        shotCtx = null;
        fails += 1;
        if (fails >= 4 && !warned) {
          warned = true;
          onFail?.();
        }
      }
      const wait = Math.max(30, 1000 / targetFps - (performance.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
    }
  };
  void loop();

  return {
    track,
    stop: () => {
      alive = false;
      track.stop();
      if (shotCtx) destroyContext(shotCtx);
      shotCtx = null;
    },
  };
}

export function canShareScreen(): boolean {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!md || typeof md.getDisplayMedia !== "function") return false;
  return !IS_MOBILE;
}
