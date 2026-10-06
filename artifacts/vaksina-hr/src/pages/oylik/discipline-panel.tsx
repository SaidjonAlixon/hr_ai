import { useState } from "react";
import { FileDown, Loader2, Lock, LockOpen, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { downloadDisciplinePdf, useClearDisciplineLock, useDisciplineSummary } from "@/lib/discipline-api";

function fmtYmd(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

const LEVELS = [
  { key: "level3", label: "3 marta", note: "1 kunlik ish haqining 100%", tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" },
  { key: "level4", label: "4 marta", note: "1 oylikning 50%", tone: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200" },
  { key: "level5", label: "5+ marta", note: "Ishdan bo‘shatish masalasi", tone: "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200" },
] as const;

/** Admin/HR: jarima eskalatsiyasi, bugungi bloklar va yig‘ma PDF */
export function DisciplinePanel({ month }: { month: string }) {
  const { toast } = useToast();
  const summary = useDisciplineSummary(month, true);
  const clear = useClearDisciplineLock();
  const [downloading, setDownloading] = useState(false);
  const data = summary.data;
  const activeLocks = data?.locks.filter((l) => !l.clearedAt) ?? [];
  const clearedLocks = data?.locks.filter((l) => l.clearedAt) ?? [];

  const pdf = async () => {
    setDownloading(true);
    try {
      await downloadDisciplinePdf(month);
    } catch (e) {
      toast({ title: "Intizom PDF", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  const unlock = (id: number, name: string) => {
    if (!window.confirm(`${name} — bugun tizimga kirishga ruxsat berilsinmi?`)) return;
    clear.mutate(id, {
      onSuccess: () => toast({ title: "Ruxsat berildi", description: `${name} tizimga kira oladi` }),
      onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
    });
  };

  return (
    <section className="rounded-2xl border border-red-200 bg-white p-4 shadow-sm dark:border-red-500/20 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Intizom nazorati</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              3-marta jarimadan boshlab adminga PDF ogohlantirish boradi. 5-marta va undan keyin xodim o‘sha kuni tizimga kira olmaydi.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" className="h-9 gap-1.5 rounded-xl border-red-200 text-red-700 hover:bg-red-50" disabled={downloading} onClick={() => void pdf()}>
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          Intizom PDF
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {LEVELS.map((lv) => (
          <div key={lv.key} className={cn("rounded-xl border px-3 py-2.5", lv.tone)}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide">{lv.label}</span>
              <span className="text-2xl font-extrabold tabular-nums">{summary.isLoading ? "…" : data?.[lv.key] ?? 0}</span>
            </div>
            <p className="text-[11px] opacity-80">{lv.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Bugun bloklangan xodimlar</p>
        {summary.isError ? (
          <p className="text-xs text-red-600">{(summary.error as Error).message}</p>
        ) : !activeLocks.length && !clearedLocks.length ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-500 dark:border-white/10">
            Bugun bloklangan xodim yo‘q.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
            {[...activeLocks, ...clearedLocks].map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                {l.clearedAt ? <LockOpen className="h-4 w-4 text-emerald-600" /> : <Lock className="h-4 w-4 text-red-600" />}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white">{l.fullName}</span>
                <span className="text-xs text-slate-500">
                  {l.strikeN}-marta · {l.kind === "late" ? "kech keldi" : "kelmadi"} · {fmtYmd(l.eventDate)}
                </span>
                {l.clearedAt ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    Ochildi{l.clearedByName ? ` · ${l.clearedByName}` : ""}
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 gap-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={clear.isPending}
                    onClick={() => unlock(l.id, l.fullName)}
                  >
                    <LockOpen className="h-3.5 w-3.5" />
                    Ruxsat berish
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
