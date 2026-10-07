import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { PenLine } from "lucide-react";
import { cn } from "@/lib/utils";

export type SignaturePadHandle = {
  clear: () => void;
  isEmpty: () => boolean;
  /** Bo‘sh chetlari kesilgan, shaffof fonli PNG */
  toPng: () => string | null;
};

type Point = { x: number; y: number; t: number };

const INK = "#0b2a6b";
const MAX_EXPORT_W = 640;

export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (empty: boolean) => void; className?: string }>(
  function SignaturePad({ onChange, className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const last = useRef<Point | null>(null);
    const lastWidth = useRef(2.6);
    const strokes = useRef(0);
    const [empty, setEmpty] = useState(true);

    const setEmptyState = useCallback(
      (v: boolean) => {
        setEmpty(v);
        onChange?.(v);
      },
      [onChange],
    );

    const fit = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const { width, height } = canvas.getBoundingClientRect();
      const prev = strokes.current ? canvas.toDataURL() : null;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      if (prev) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, width, height);
        img.src = prev;
      }
    }, []);

    useEffect(() => {
      fit();
      const ro = new ResizeObserver(() => fit());
      if (canvasRef.current) ro.observe(canvasRef.current);
      return () => ro.disconnect();
    }, [fit]);

    const pos = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
      const r = e.currentTarget.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
    };

    const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = true;
      const p = pos(e);
      last.current = p;
      lastWidth.current = 2.6;
      const ctx = e.currentTarget.getContext("2d");
      if (ctx) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current || !last.current) return;
      e.preventDefault();
      const ctx = e.currentTarget.getContext("2d");
      if (!ctx) return;
      const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
      const r = e.currentTarget.getBoundingClientRect();
      const pts: Point[] = events.length
        ? events.map((ev) => ({ x: ev.clientX - r.left, y: ev.clientY - r.top, t: performance.now() }))
        : [pos(e)];
      for (const p of pts) {
        const prev = last.current!;
        const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (dist < 0.8) continue;
        const speed = dist / Math.max(1, p.t - prev.t);
        const target = Math.max(1.4, Math.min(3.4, 3.4 - speed * 0.9));
        const w = lastWidth.current * 0.7 + target * 0.3;
        const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        lastWidth.current = w;
        last.current = p;
      }
    };

    const onUp = () => {
      if (!drawing.current) return;
      drawing.current = false;
      last.current = null;
      strokes.current += 1;
      if (empty) setEmptyState(false);
    };

    useImperativeHandle(
      ref,
      () => ({
        clear() {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (canvas && ctx) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
          }
          strokes.current = 0;
          setEmptyState(true);
        },
        isEmpty: () => strokes.current === 0,
        toPng() {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx || !strokes.current) return null;
          const { width, height } = canvas;
          const data = ctx.getImageData(0, 0, width, height).data;
          let minX = width, minY = height, maxX = -1, maxY = -1;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              if (data[(y * width + x) * 4 + 3]! > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (maxX < 0) return null;
          const pad = 12;
          minX = Math.max(0, minX - pad);
          minY = Math.max(0, minY - pad);
          maxX = Math.min(width - 1, maxX + pad);
          maxY = Math.min(height - 1, maxY + pad);
          const w = maxX - minX + 1;
          const h = maxY - minY + 1;
          const k = Math.min(1, MAX_EXPORT_W / w);
          const out = document.createElement("canvas");
          out.width = Math.max(1, Math.round(w * k));
          out.height = Math.max(1, Math.round(h * k));
          out.getContext("2d")?.drawImage(canvas, minX, minY, w, h, 0, 0, out.width, out.height);
          return out.toDataURL("image/png");
        },
      }),
      [setEmptyState],
    );

    return (
      <div className={cn("relative overflow-hidden rounded-2xl border-2 border-dashed border-sky-300 bg-white dark:border-sky-500/40", className)}>
        <canvas
          ref={canvasRef}
          className="block h-full w-full cursor-crosshair touch-none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={onUp}
        />
        <div className="pointer-events-none absolute inset-x-8 bottom-[28%] border-b border-slate-300" />
        {empty ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-slate-400">
            <PenLine className="h-6 w-6" />
            <span className="text-sm font-medium">Shu yerga barmoq yoki sichqoncha bilan imzo chizing</span>
          </div>
        ) : null}
        <span className="pointer-events-none absolute bottom-[28%] left-3 mb-0.5 text-[13px] font-semibold text-slate-300">✕</span>
      </div>
    );
  },
);
