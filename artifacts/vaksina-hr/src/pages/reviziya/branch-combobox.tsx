import { useMemo, useState } from "react";
import { Building2, Check, ChevronsUpDown, Search, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { foldScript, scriptIncludes } from "@/lib/script-search";

export type BranchOption = { id: string; label: string };

/** Lotin va kirill nomlar bitta alifboda: «Андижон» va «Andijon» yonma-yon turadi */
export function sortBranchOptions<T extends { label: string }>(options: T[]): T[] {
  return [...options].sort((a, b) => {
    const ka = foldScript(a.label);
    const kb = foldScript(b.label);
    return ka === kb ? a.label.localeCompare(b.label, "uz") : ka.localeCompare(kb, "en");
  });
}

export function BranchCombobox({
  value,
  onChange,
  options,
  placeholder = "Filialni tanlang",
  className,
  allowAll = false,
  allLabel = "Barcha filiallar",
  tone = "emerald",
}: {
  value: string;
  onChange: (id: string) => void;
  options: BranchOption[];
  placeholder?: string;
  className?: string;
  /** Bo‘sh qiymat — barcha filiallar */
  allowAll?: boolean;
  allLabel?: string;
  tone?: "emerald" | "violet";
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sorted = useMemo(() => sortBranchOptions(options), [options]);
  const filtered = useMemo(
    () => (q.trim() ? sorted.filter((o) => scriptIncludes(o.label, q)) : sorted),
    [sorted, q],
  );
  const selected = options.find((o) => o.id === value);
  const showAll = allowAll && !q.trim();
  const isAll = allowAll && !value;
  const displayLabel = isAll ? allLabel : selected?.label || placeholder;

  const tones =
    tone === "violet"
      ? {
          triggerActive: "border-[#5c2d91]/40 ring-1 ring-[#5c2d91]/15",
          iconWrap: "bg-[#5c2d91]/10 text-[#5c2d91] dark:bg-violet-950 dark:text-violet-200",
          inputFocus: "focus:border-[#5c2d91] focus:ring-2 focus:ring-[#5c2d91]/15",
          activeRow:
            "bg-[#f3edfa] font-semibold text-[#5c2d91] hover:bg-[#f3edfa] dark:bg-violet-950/50 dark:text-violet-100",
          check: "text-[#5c2d91]",
          hint: "text-[#5c2d91]/55",
          allRow: "bg-[#5c2d91] text-white hover:bg-[#4a2475]",
        }
      : {
          triggerActive: "border-emerald-400 dark:border-emerald-700",
          iconWrap: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
          inputFocus: "focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:focus:ring-emerald-900/40",
          activeRow:
            "bg-emerald-50 font-semibold text-emerald-900 hover:bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-100",
          check: "text-emerald-600",
          hint: "text-muted-foreground",
          allRow: "bg-emerald-600 text-white hover:bg-emerald-700",
        };

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-11 w-full justify-between rounded-xl bg-white px-3 font-normal shadow-sm dark:bg-background",
            (selected || isAll) && tones.triggerActive,
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                tones.iconWrap,
              )}
            >
              {isAll ? <Store className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
            </span>
            <span className={cn("truncate text-left text-sm font-semibold", !selected && !isAll && "font-normal text-muted-foreground")}>
              {displayLabel}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[80] w-[var(--radix-popover-trigger-width)] min-w-[280px] overflow-hidden rounded-2xl border border-slate-200/80 p-0 shadow-2xl dark:border-white/10"
      >
        <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white p-2.5 dark:border-white/10 dark:from-slate-900 dark:to-slate-950">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (filtered.length === 1) {
                    onChange(filtered[0].id);
                    setOpen(false);
                    setQ("");
                  } else if (showAll && !filtered.length) {
                    onChange("");
                    setOpen(false);
                    setQ("");
                  }
                }
              }}
              placeholder="Yozing: Askiya yoki Аския…"
              className={cn(
                "h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-medium outline-none dark:border-white/10 dark:bg-slate-950",
                tones.inputFocus,
              )}
            />
          </div>
          <p className={cn("mt-1.5 px-0.5 text-[10px] font-medium", tones.hint)}>
            {filtered.length} ta filial · kirill va lotin bir xil ishlaydi
          </p>
        </div>
        <ul className="max-h-72 overflow-y-auto overscroll-contain p-1.5" role="listbox">
          {showAll ? (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={isAll}
                onClick={() => {
                  onChange("");
                  setOpen(false);
                  setQ("");
                }}
                className={cn(
                  "mb-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left text-sm font-bold transition-colors",
                  isAll ? tones.allRow : "hover:bg-muted",
                )}
              >
                <Store className="h-4 w-4 shrink-0 opacity-90" />
                <span className="min-w-0 flex-1 truncate">{allLabel}</span>
                {isAll ? <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
            </li>
          ) : null}
          {filtered.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">
              Bunday filial topilmadi
              <p className="mt-1 text-[11px]">Boshqa yozuvda sinab ko‘ring (lotin ↔ kirill)</p>
            </li>
          ) : (
            filtered.map((o) => {
              const active = o.id === value;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                      setQ("");
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted",
                      active && tones.activeRow,
                    )}
                  >
                    <Check className={cn("h-4 w-4 shrink-0", tones.check, active ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
