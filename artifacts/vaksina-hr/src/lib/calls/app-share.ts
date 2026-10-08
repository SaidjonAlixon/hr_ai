import { createContext, destroyContext, domToCanvas } from "modern-screenshot";

/**
 * «Ilova ko‘rinishi» ulashish: VAKSINA HR oynasini kadrma-kadr canvas'ga chizib, MediaStream qiladi.
 * Telefon brauzerlarida getDisplayMedia yo‘q — shu sabab masofadan boshqaruv va mobil ulashish shu orqali ishlaydi.
 * Kadr faqat sahifa o‘zgarganda olinadi; oradagi vaqtda oxirgi kadr qayta chiziladi (oqim uzilmasin).
 */
export type AppShare = { track: MediaStreamTrack; stop: () => void; kick: () => void };

const MAX_SIDE = 1280;
const HEARTBEAT_MS = 500;
const IS_MOBILE = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const IS_SAFARI =
  typeof navigator !== "undefined" && /AppleWebKit/i.test(navigator.userAgent) && !/Chrome|CriOS|Chromium|Edg|FxiOS/i.test(navigator.userAgent);

function insideCallUi(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement;
  return Boolean(el?.closest("[data-call-ui]"));
}

export function startAppShare(fps = 6, onFail?: () => void): AppShare {
  const out = document.createElement("canvas");
  const g = out.getContext("2d", { alpha: false })!;
  const targetFps = IS_MOBILE ? Math.min(fps, 6) : fps;
  const minGap = 1000 / targetFps;
  const stream = out.captureStream(targetFps);
  const track = stream.getVideoTracks()[0];
  track.contentHint = "detail";
  let alive = true;
  let dirty = true;
  let ctxKey = "";
  let fails = 0;
  let warned = false;
  let lastShot: HTMLCanvasElement | null = null;
  let wake: (() => void) | null = null;
  let shotCtx: Awaited<ReturnType<typeof createContext<HTMLElement>>> | null = null;

  const kick = () => {
    dirty = true;
    wake?.();
  };

  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (!insideCallUi(m.target)) {
        kick();
        return;
      }
    }
  });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  const onScroll = (e: Event) => {
    if (!insideCallUi(e.target as Node | null)) kick();
  };
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", kick);
  document.addEventListener("input", onScroll, true);
  document.addEventListener("focusin", onScroll, true);

  // Ekrandan to‘liq pastda/o‘ngda turgan elementlar nusxalanmaydi — uzun jadvallarda kadr bir necha barobar tezlashadi.
  // Yuqoridagilar qoldiriladi: ularni olib tashlash sahifa joylashuvini siljitadi.
  const filter = (node: Node): boolean => {
    if (!(node instanceof Element)) return true;
    if (node.hasAttribute("data-call-ui")) return false;
    const r = node.getBoundingClientRect();
    return !(r.top > window.innerHeight + 40 || r.left > window.innerWidth + 40);
  };

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

  const capture = async () => {
    const { w, h, scale } = sizeFor();
    const key = `${w}x${h}@${scale.toFixed(2)}`;
    if (!shotCtx || key !== ctxKey) {
      if (shotCtx) destroyContext(shotCtx);
      shotCtx = await createContext(document.body, {
        width: w,
        height: h,
        scale,
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
        filter,
        timeout: 4000,
        // Shriftlarni har kadrga base64 qilib joylash eng og‘ir qism — tizim shrifti yetarli
        font: false,
        // Safari'da har rasm uchun 100 ms dan qayta-qayta chizish bir kadrni soniyalab cho‘zadi — o‘chiriladi
        features: { restoreScrollPosition: true, fixSvgXmlDecode: !IS_SAFARI, copyScrollbar: false },
        autoDestruct: false,
      });
      ctxKey = key;
      out.width = Math.round(w * scale);
      out.height = Math.round(h * scale);
    }
    const sy = window.scrollY;
    shotCtx.style = sy > 0 ? { transform: `translateY(${-sy}px)` } : {};
    const shot = await domToCanvas(shotCtx);
    if (!alive) return;
    g.drawImage(shot, 0, 0, out.width, out.height);
    lastShot = shot;
  };

  const loop = async () => {
    paintPlaceholder();
    while (alive) {
      const t0 = performance.now();
      if (dirty) {
        dirty = false;
        try {
          await capture();
          fails = 0;
        } catch {
          if (shotCtx) destroyContext(shotCtx);
          shotCtx = null;
          dirty = true;
          fails += 1;
          if (fails >= 4 && !warned) {
            warned = true;
            onFail?.();
          }
        }
      } else if (lastShot) {
        g.drawImage(lastShot, 0, 0, out.width, out.height);
      }
      if (!alive) break;
      const spent = performance.now() - t0;
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const done = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
        timer = setTimeout(done, dirty ? Math.max(16, minGap - spent) : HEARTBEAT_MS);
        wake = () => {
          clearTimeout(timer);
          timer = setTimeout(done, Math.max(0, minGap - (performance.now() - t0)));
        };
      });
    }
  };
  void loop();

  return {
    track,
    kick,
    stop: () => {
      alive = false;
      wake?.();
      mo.disconnect();
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", kick);
      document.removeEventListener("input", onScroll, true);
      document.removeEventListener("focusin", onScroll, true);
      track.stop();
      if (shotCtx) destroyContext(shotCtx);
      shotCtx = null;
      lastShot = null;
    },
  };
}

export function canShareScreen(): boolean {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!md || typeof md.getDisplayMedia !== "function") return false;
  return !IS_MOBILE;
}

/** Chromium (Chrome/Edge/Yandex/Opera) kompyuterda joriy tabni real vaqtda uzata oladi */
export function canCaptureTab(): boolean {
  return canShareScreen() && typeof (window as unknown as { CaptureController?: unknown }).CaptureController === "function";
}
