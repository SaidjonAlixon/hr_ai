import { useMemo, useState } from "react";
import { Building2, Check, ChevronsUpDown, Search } from "lucide-react";
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
}: {
  value: string;
  onChange: (id: string) => void;
  options: BranchOption[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const sorted = useMemo(() => sortBranchOptions(options), [options]);
  const filtered = useMemo(() => (q.trim() ? sorted.filter((o) => scriptIncludes(o.label, q)) : sorted), [sorted, q]);
  const selected = options.find((o) => o.id === value);

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
            selected && "border-emerald-400 dark:border-emerald-700",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <Building2 className="h-3.5 w-3.5" />
            </span>
            <span className={cn("truncate text-left text-sm", !selected && "text-muted-foreground")}>
              {selected?.label || placeholder}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[80] w-[var(--radix-popover-trigger-width)] min-w-[260px] overflow-hidden rounded-xl p-0 shadow-xl"
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered.length === 1) {
                  onChange(filtered[0].id);
                  setOpen(false);
                  setQ("");
                }
              }}
              placeholder="Lotin yoki kirillda yozing…"
              className="h-9 w-full rounded-lg border bg-background pl-8 pr-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:focus:ring-emerald-900/40"
            />
          </div>
          <p className="mt-1.5 px-0.5 text-[10px] text-muted-foreground">
            {filtered.length} ta filial · masalan «andijon» yoki «андижон»
          </p>
        </div>
        <ul className="max-h-72 overflow-y-auto overscroll-contain p-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">Bunday filial topilmadi</li>
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
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted",
                      active && "bg-emerald-50 font-semibold text-emerald-900 hover:bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-100",
                    )}
                  >
                    <Check className={cn("h-4 w-4 shrink-0 text-emerald-600", active ? "opacity-100" : "opacity-0")} />
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
