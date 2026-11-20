import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const BARS = 28;

type Props = {
  stream: MediaStream | null;
  active?: boolean;
  /** Stream bo‘lmasa ham chaqiruv holatida yolg‘on puls */
  simulated?: boolean;
  className?: string;
  barClassName?: string;
};

/** AnalyserNode — gapirilganda puls qiladigan amplitude bars */
export function VoiceWaveform({ stream, active = true, simulated = false, className, barClassName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || stream) return;
    if (!simulated) return;
    let raf = 0;
    let alive = true;
    const t0 = performance.now();
    const tick = (now: number) => {
      if (!alive) return;
      const root = barsRef.current;
      if (root) {
        const kids = root.children;
        for (let i = 0; i < kids.length; i++) {
          const el = kids[i] as HTMLElement;
          const wave = 0.35 + 0.55 * Math.abs(Math.sin((now - t0) / 280 + i * 0.45));
          el.style.height = `${12 + wave * 78}%`;
          el.style.opacity = String(0.4 + wave * 0.55);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [active, stream, simulated]);

  useEffect(() => {
    if (!active || !stream) return;
    const audioTracks = stream.getAudioTracks().filter((t) => t.readyState === "live");
    if (!audioTracks.length) return;

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    let alive = true;

    const tick = () => {
      if (!alive) return;
      analyser.getByteFrequencyData(data);
      const step = Math.max(1, Math.floor(data.length / BARS));
      const levels: number[] = [];
      for (let i = 0; i < BARS; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += data[i * step + j] ?? 0;
        levels.push(sum / step / 255);
      }

      const root = barsRef.current;
      if (root) {
        const kids = root.children;
        for (let i = 0; i < kids.length; i++) {
          const el = kids[i] as HTMLElement;
          const v = levels[i] ?? 0;
          const h = 12 + v * 88;
          el.style.height = `${h}%`;
          el.style.opacity = String(0.35 + v * 0.65);
        }
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
          canvas.width = Math.floor(w * dpr);
          canvas.height = Math.floor(h * dpr);
        }
        const g = canvas.getContext("2d");
        if (g) {
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.clearRect(0, 0, w, h);
          const mid = h / 2;
          const barW = w / BARS;
          for (let i = 0; i < BARS; i++) {
            const v = levels[i] ?? 0;
            const bh = Math.max(3, v * (h * 0.42));
            const x = i * barW + barW * 0.2;
            const bw = barW * 0.6;
            g.fillStyle = `rgba(255,255,255,${0.25 + v * 0.75})`;
            g.beginPath();
            g.roundRect?.(x, mid - bh, bw, bh * 2, 4);
            if (!g.roundRect) {
              g.fillRect(x, mid - bh, bw, bh * 2);
            } else {
              g.fill();
            }
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    void ctx.resume().catch(() => undefined);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      try {
        source.disconnect();
        analyser.disconnect();
        void ctx.close();
      } catch {
        /* */
      }
    };
  }, [stream, active]);

  return (
    <div className={cn("relative flex h-24 w-full max-w-md items-end justify-center gap-1", className)}>
      <div ref={barsRef} className="flex h-full w-full items-end justify-center gap-[3px] px-2" aria-hidden>
        {Array.from({ length: BARS }, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-1.5 min-h-[12%] rounded-full bg-white/80 transition-[height,opacity] duration-75",
              barClassName,
            )}
            style={{ height: "18%", opacity: 0.4 }}
          />
        ))}
      </div>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 hidden h-full w-full" />
    </div>
  );
}
