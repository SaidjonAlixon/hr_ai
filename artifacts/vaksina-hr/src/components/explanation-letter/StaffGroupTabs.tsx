import { Building2, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StaffGroup } from "@/lib/oylik-api";

export type { StaffGroup };

export const staffGroupOf = (row: { group?: StaffGroup | null }): StaffGroup => row.group ?? "pharmacy";

const GROUPS: ReadonlyArray<{ key: StaffGroup; label: string; hint: string; Icon: typeof Store }> = [
  { key: "pharmacy", label: "Dorixona xodimlari", hint: "Mudir, farmasevt, stajyor", Icon: Store },
  { key: "office", label: "Ofis xodimlari", hint: "Bo‘limlar, ombor, ta’minot", Icon: Building2 },
];

/** Dorixona va ofis xodimlarini alohida ko‘rsatish uchun katta tanlagich */
export function StaffGroupTabs({
  value,
  onChange,
  counts,
  className,
  tone = "light",
}: {
  value: StaffGroup;
  onChange: (g: StaffGroup) => void;
  counts?: Partial<Record<StaffGroup, number | null>>;
  className?: string;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <div
      role="tablist"
      className={cn(
        "grid grid-cols-2 gap-1 rounded-2xl p-1",
        dark ? "bg-white/10 ring-1 ring-white/10" : "bg-slate-100 ring-1 ring-slate-200/70 dark:bg-white/5 dark:ring-white/10",
        className,
      )}
    >
      {GROUPS.map(({ key, label, hint, Icon }) => {
        const on = value === key;
        const count = counts?.[key];
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(key)}
            className={cn(
              "group flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left transition",
              on
                ? dark
                  ? "bg-white text-[#172033] shadow-sm"
                  : "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-white/10"
                : dark
                  ? "text-white/70 hover:bg-white/10 hover:text-white"
                  : "text-slate-500 hover:bg-white/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition",
                on
                  ? key === "pharmacy"
                    ? "bg-emerald-600 text-white"
                    : "bg-[#0b3a5c] text-white"
                  : dark
                    ? "bg-white/10 text-white/80"
                    : "bg-white text-slate-500 ring-1 ring-slate-200 dark:bg-white/10 dark:text-slate-300 dark:ring-white/10",
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold leading-tight">{label}</span>
              <span className={cn("block truncate text-[10.5px] leading-tight", on ? (dark ? "text-slate-500" : "text-slate-500 dark:text-slate-400") : "opacity-80")}>
                {hint}
              </span>
            </span>
            {count != null ? (
              <span
                className={cn(
                  "min-w-[1.75rem] shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-extrabold tabular-nums",
                  on
                    ? key === "pharmacy"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                      : "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
                    : dark
                      ? "bg-white/10 text-white/80"
                      : "bg-slate-200/80 text-slate-600 dark:bg-white/10 dark:text-slate-300",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
