import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { SCORE_LABEL } from "@/lib/abet-api";

export function StarInput({
  value,
  onChange,
  size = "md",
  disabled,
  showLabel,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  size?: "md" | "lg";
  disabled?: boolean;
  showLabel?: boolean;
}) {
  const px = size === "lg" ? "h-10 w-10" : "h-6 w-6";
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5" role="radiogroup">
        {[1, 2, 3, 4, 5].map((s) => {
          const on = (value ?? 0) >= s;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={value === s}
              aria-label={`${s} — ${SCORE_LABEL[s]}`}
              disabled={disabled}
              onClick={() => onChange(value === s && size !== "lg" ? undefined : s)}
              className={cn(
                "rounded-md p-0.5 transition-transform active:scale-90 disabled:cursor-not-allowed disabled:opacity-60",
                !disabled && "hover:scale-110",
              )}
            >
              <Star className={cn(px, on ? "fill-amber-400 text-amber-400" : "text-slate-300 dark:text-white/20")} />
            </button>
          );
        })}
      </div>
      {showLabel && value ? <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">{SCORE_LABEL[value]}</span> : null}
    </div>
  );
}

export function StarsView({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-px", className)} aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} className={cn("h-3.5 w-3.5", value >= s ? "fill-amber-400 text-amber-400" : "text-slate-300 dark:text-white/20")} />
      ))}
    </span>
  );
}
