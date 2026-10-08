import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Replayer, type eventWithTime } from "rrweb";
import { callEngine } from "@/lib/calls/engine";

export type MirrorRect = { left: number; top: number; width: number; height: number };
/** Nusxadagi nuqta (0..1) → xodim sahifasidagi element id si va undagi nisbiy joy */
export type MirrorPicker = (nx: number, ny: number) => { id: number; rx: number; ry: number } | null;

/**
 * Xodim ilovasining jonli nusxasi (admin tomoni). Voqealar kelishi bilanoq qo‘llanadi — kechikish faqat tarmoqqa bog‘liq.
 * Nusxa xodim oynasi o‘lchamida quriladi va konteynerga sig‘diriladi; boshqaruv koordinatalari shu to‘rtburchakka nisbatan.
 */
export default function MirrorView({
  onRect,
  onPicker,
}: {
  onRect: (r: MirrorRect | null) => void;
  onPicker?: (fn: MirrorPicker | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const rectCb = useRef(onRect);
  rectCb.current = onRect;
  const pickerCb = useRef(onPicker);
  pickerCb.current = onPicker;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const boxEl = box.current;
    const hostEl = host.current;
    if (!boxEl || !hostEl) return;
    let rp: Replayer | null = null;
    let size = { w: 0, h: 0 };

    const pick: MirrorPicker = (nx, ny) => {
      const doc = hostEl.querySelector("iframe")?.contentDocument;
      if (!rp || !doc || !size.w || !size.h) return null;
      const px = nx * size.w;
      const py = ny * size.h;
      const mirror = rp.getMirror();
      let el: Element | null = doc.elementFromPoint(px, py);
      while (el && el !== doc.documentElement && mirror.getId(el) <= 0) el = el.parentElement;
      if (!el || el === doc.documentElement || el === doc.body) return null;
      const id = mirror.getId(el);
      if (id <= 0) return null;
      const r = el.getBoundingClientRect();
      const rx = r.width ? (px - r.left) / r.width : 0.5;
      const ry = r.height ? (py - r.top) / r.height : 0.5;
      return { id, rx: Math.min(1, Math.max(0, rx)), ry: Math.min(1, Math.max(0, ry)) };
    };
    pickerCb.current?.(pick);

    const layout = () => {
      if (!size.w || !size.h) {
        rectCb.current(null);
        return;
      }
      const cw = boxEl.clientWidth;
      const ch = boxEl.clientHeight;
      const k = Math.min(cw / size.w, ch / size.h);
      const w = size.w * k;
      const h = size.h * k;
      const left = (cw - w) / 2;
      const top = (ch - h) / 2;
      hostEl.style.width = `${size.w}px`;
      hostEl.style.height = `${size.h}px`;
      hostEl.style.transform = `translate(${left}px, ${top}px) scale(${k})`;
      rectCb.current({ left, top, width: w, height: h });
    };

    const destroy = () => {
      try {
        rp?.destroy();
      } catch {
        /* */
      }
      rp = null;
      hostEl.replaceChildren();
      size = { w: 0, h: 0 };
      setReady(false);
      rectCb.current(null);
    };

    const onEvent = (ev: eventWithTime | null) => {
      if (!ev) {
        destroy();
        return;
      }
      // Meta — yangi to‘liq nusxa boshlanadi (birinchi marta yoki qayta sinxronlash)
      if (ev.type === 4) {
        destroy();
        rp = new Replayer([], {
          root: hostEl,
          liveMode: true,
          useVirtualDom: false,
          mouseTail: false,
          showWarning: false,
          showDebug: false,
          triggerFocus: false,
          pauseAnimation: false,
        });
        rp.on("resize", (d) => {
          const dim = d as { width: number; height: number };
          size = { w: dim.width, h: dim.height };
          layout();
        });
        rp.on("fullsnapshot-rebuilded", () => setReady(true));
        // Kelgan har bir voqea darhol qo‘llansin (vaqt jadvali bo‘yicha kutmasin)
        rp.startLive(Number.MAX_SAFE_INTEGER);
      }
      rp?.addEvent(ev);
    };

    const unsubscribe = callEngine.subscribeMirror(onEvent);
    const ro = new ResizeObserver(layout);
    ro.observe(boxEl);
    return () => {
      unsubscribe();
      ro.disconnect();
      destroy();
      pickerCb.current?.(null);
    };
  }, []);

  return (
    <div ref={box} className="bg-slate-950" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        ref={host}
        className="bg-white shadow-2xl [&_.replayer-mouse]:hidden [&_iframe]:block [&_iframe]:border-0"
        style={{ position: "absolute", left: 0, top: 0, overflow: "hidden", transformOrigin: "0 0" }}
      />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3.5 py-1.5 text-xs text-white/90 backdrop-blur-md">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Ekran tasviri yuklanmoqda…
          </span>
        </div>
      ) : null}
    </div>
  );
}
