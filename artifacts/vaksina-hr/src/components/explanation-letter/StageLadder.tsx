import { cn } from "@/lib/utils";
import { LETTER_STAGES, stageTone } from "@/lib/explanation-letters-api";

type Props = {
  /** Har bir bosqichdagi xatlar soni (admin) */
  counts?: Record<number, number>;
  /** Filtr sifatida — tanlangan bosqich */
  value?: number | null;
  onChange?: (n: number | null) => void;
  /** Xodim sahifasi — joriy bosqich (0 — hali yo‘q) */
  current?: number;
  className?: string;
};

/** 6 bosqich: 1 — ogohlantirish … 6 — oxirgi ogohlantirish */
export function StageLadder({ counts, value, onChange, current, className }: Props) {
  const interactive = !!onChange;
  return (
    <div className={cn("grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6", className)}>
      {LETTER_STAGES.map((s) => {
        const t = stageTone(s.n);
        const selected = value === s.n;
        const isCurrent = current === s.n;
        const passed = current != null && s.n < current;
        const count = counts?.[s.n] ?? 0;
        const Tag = interactive ? "button" : "div";
        return (
          <Tag
            key={s.n}
            type={interactive ? "button" : undefined}
            onClick={interactive ? () => onChange!(selected ? null : s.n) : undefined}
            className={cn(
              "relative flex min-w-0 flex-col rounded-xl border px-2.5 py-2 text-left transition",
              isCurrent || selected ? cn(t.solid, "border-transparent shadow-sm") : passed ? t.soft : "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900",
              interactive && !selected && "hover:border-slate-300 hover:shadow-sm",
              selected && cn("ring-2 ring-offset-1", t.ring),
            )}
          >
            <span className="flex items-center justify-between gap-1">
              <span className={cn("text-[11px] font-extrabold", !(isCurrent || selected || passed) && t.text)}>
                {s.n}-holat{isCurrent ? " · siz" : ""}
              </span>
              {counts ? (
                <span
                  className={cn(
                    "min-w-[1.4rem] rounded-full px-1.5 text-center text-[11px] font-bold tabular-nums",
                    selected ? "bg-white/25" : count ? cn(t.solid) : "bg-slate-100 text-slate-400 dark:bg-white/10",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </span>
            <span className={cn("mt-0.5 truncate text-[12px] font-bold", !(isCurrent || selected) && "text-slate-800 dark:text-slate-100", passed && t.text)}>
              {s.label}
            </span>
            <span className={cn("line-clamp-2 text-[10.5px] leading-snug", isCurrent || selected ? "opacity-90" : "text-slate-500 dark:text-slate-400")}>
              {s.detail}
            </span>
          </Tag>
        );
      })}
    </div>
  );
}
