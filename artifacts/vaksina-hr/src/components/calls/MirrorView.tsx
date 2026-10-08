import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Replayer, type eventWithTime } from "rrweb";
import { callEngine } from "@/lib/calls/engine";

export type MirrorRect = { left: number; top: number; width: number; height: number };

/**
 * Xodim ilovasining jonli nusxasi (admin tomoni). Voqealar kelishi bilanoq qo‘llanadi — kechikish faqat tarmoqqa bog‘liq.
 * Nusxa xodim oynasi o‘lchamida quriladi va konteynerga sig‘diriladi; boshqaruv koordinatalari shu to‘rtburchakka nisbatan.
 */
export default function MirrorView({ onRect }: { onRect: (r: MirrorRect | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const rectCb = useRef(onRect);
  rectCb.current = onRect;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const boxEl = box.current;
    const hostEl = host.current;
    if (!boxEl || !hostEl) return;
    let rp: Replayer | null = null;
    let size = { w: 0, h: 0 };

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
