import { createContext, destroyContext, domToCanvas } from "modern-screenshot";

/**
 * «Ilova ko‘rinishi» ulashish: VAKSINA HR oynasini kadrma-kadr canvas'ga chizib, MediaStream qiladi.
 * Telefon brauzerlarida getDisplayMedia yo‘q — shu sabab masofadan boshqaruv va mobil ulashish shu orqali ishlaydi.
 */
export type AppShare = { track: MediaStreamTrack; stop: () => void };

const MAX_SIDE = 1280;

function skipCallUi(node: Node): boolean {
  return !(node instanceof Element && node.hasAttribute("data-call-ui"));
}

export function startAppShare(fps = 6): AppShare {
  const out = document.createElement("canvas");
  const g = out.getContext("2d", { alpha: false })!;
  const stream = out.captureStream(fps);
  const track = stream.getVideoTracks()[0];
  let alive = true;
  let ctxKey = "";
  let shotCtx: Awaited<ReturnType<typeof createContext<HTMLElement>>> | null = null;

  const sizeFor = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, 1.5, MAX_SIDE / Math.max(w, h));
    return { w, h, scale };
  };

  const loop = async () => {
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
            features: { restoreScrollPosition: true },
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
      } catch {
        if (shotCtx) destroyContext(shotCtx);
        shotCtx = null;
      }
      const wait = Math.max(30, 1000 / fps - (performance.now() - t0));
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
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}
