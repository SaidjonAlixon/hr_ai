import React, { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import { formatYmd, WORKFLOW_STATUS_LABEL } from "@/lib/reviziya-cycle";
import { useReviziyaCalendar } from "@/lib/reviziya-api";

const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
const WEEKDAYS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

const TONE: Record<string, { dot: string; chip: string; label: string }> = {
  REQUESTED: { dot: "bg-amber-400", chip: "bg-amber-100 text-amber-900", label: "Ariza" },
  ASSIGNED: { dot: "bg-violet-500", chip: "bg-violet-100 text-violet-900", label: "Biriktirilgan" },
  ACCEPTED: { dot: "bg-sky-500", chip: "bg-sky-100 text-sky-900", label: "Qabul qilingan" },
  IN_PROGRESS: { dot: "bg-indigo-500", chip: "bg-indigo-100 text-indigo-900", label: "Jarayonda" },
  REVIEW: { dot: "bg-orange-500", chip: "bg-orange-100 text-orange-900", label: "Tasdiqlash kutilmoqda" },
  COMPLETED: { dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-900", label: "Yakunlangan" },
  CANCELLED: { dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600 line-through", label: "Bekor qilingan" },
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function tashkentToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

export function CalendarPanel({ onOpenBranch }: { onOpenBranch: (branchId: number) => void }) {
  const today = tashkentToday();
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [selected, setSelected] = useState<string>(today);

  const { from, to, cells } = useMemo(() => {
    const first = new Date(Date.UTC(ym.y, ym.m, 1));
    const days = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;
    const list: (string | null)[] = [];
    for (let i = 0; i < lead; i++) list.push(null);
    for (let d = 1; d <= days; d++) list.push(`${ym.y}-${pad(ym.m + 1)}-${pad(d)}`);
    while (list.length % 7) list.push(null);
    return { from: `${ym.y}-${pad(ym.m + 1)}-01`, to: `${ym.y}-${pad(ym.m + 1)}-${pad(days)}`, cells: list };
  }, [ym]);

  const cal = useReviziyaCalendar(from, to);
  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const e of cal.data?.events || []) {
      const d = String(e.date || "");
      if (!d) continue;
      const arr = map.get(d) || [];
      arr.push(e);
      map.set(d, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")));
    return map;
  }, [cal.data]);

  const monthEvents = cal.data?.events || [];
  const counts = monthEvents.reduce<Record<string, number>>((acc, e) => {
    acc[e.workflowStatus] = (acc[e.workflowStatus] || 0) + 1;
    return acc;
  }, {});
  const dayEvents = byDay.get(selected) || [];

  const shift = (delta: number) => {
    setYm((p) => {
      const d = new Date(Date.UTC(p.y, p.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="rounded-3xl border bg-card p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-lg font-semibold leading-tight">
                {MONTHS[ym.m]} {ym.y}
              </h3>
              <p className="text-xs text-muted-foreground">{monthEvents.length} ta reviziya rejada</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" className="h-9 w-9 rounded-xl" onClick={() => shift(-1)} aria-label="Oldingi oy">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 rounded-xl px-3"
              onClick={() => {
                setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 });
                setSelected(today);
              }}
            >
              Bugun
            </Button>
            <Button size="icon" variant="outline" className="h-9 w-9 rounded-xl" onClick={() => shift(1)} aria-label="Keyingi oy">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={cn("py-1", i >= 5 && "text-rose-500/80")}>
              {w}
            </div>
          ))}
        </div>

        {cal.isLoading ? (
          <Skeleton className="mt-1 h-[420px] rounded-2xl" />
        ) : (
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} className="min-h-[72px] rounded-xl bg-muted/20 sm:min-h-[92px]" />;
              const evs = byDay.get(d) || [];
              const isToday = d === today;
              const isSel = d === selected;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelected(d)}
                  className={cn(
                    "flex min-h-[72px] flex-col rounded-xl border p-1.5 text-left transition sm:min-h-[92px]",
                    isSel ? "border-violet-500 bg-violet-50 ring-1 ring-violet-300 dark:bg-violet-500/10" : "border-transparent bg-muted/40 hover:border-violet-200 hover:bg-violet-50/50 dark:hover:bg-violet-500/5",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                      isToday ? "bg-violet-600 text-white" : "text-foreground/80",
                    )}
                  >
                    {Number(d.slice(8))}
                  </span>
                  <span className="mt-1 hidden w-full flex-col gap-0.5 sm:flex">
                    {evs.slice(0, 2).map((e) => (
                      <span key={e.id} className={cn("truncate rounded-md px-1 py-0.5 text-[10px] font-medium", (TONE[e.workflowStatus] || TONE.ASSIGNED).chip)}>
                        {e.startTime ? `${String(e.startTime).slice(0, 5)} ` : ""}
                        {displayBranchName(e.branchName) || e.branchName}
                      </span>
                    ))}
                    {evs.length > 2 ? <span className="px-1 text-[10px] font-semibold text-muted-foreground">+{evs.length - 2} ta</span> : null}
                  </span>
                  {evs.length ? (
                    <span className="mt-auto flex flex-wrap gap-0.5 sm:hidden">
                      {evs.slice(0, 4).map((e) => (
                        <span key={e.id} className={cn("h-1.5 w-1.5 rounded-full", (TONE[e.workflowStatus] || TONE.ASSIGNED).dot)} />
                      ))}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          {Object.entries(TONE)
            .filter(([k]) => k !== "REQUESTED" || counts[k])
            .map(([k, t]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className={cn("h-2 w-2 rounded-full", t.dot)} /> {t.label}
                {counts[k] ? <b className="tabular-nums text-foreground">{counts[k]}</b> : null}
              </span>
            ))}
        </div>
      </div>

      <aside className="rounded-3xl border bg-card p-4 shadow-sm">
        <h4 className="text-sm font-semibold">{formatYmd(selected)}</h4>
        <p className="text-xs text-muted-foreground">
          {dayEvents.length ? `${dayEvents.length} ta reviziya` : "Bu kunga reviziya rejalashtirilmagan"}
        </p>
        <div className="mt-3 space-y-2">
          {dayEvents.map((e) => {
            const t = TONE[e.workflowStatus] || TONE.ASSIGNED;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onOpenBranch(e.branchId)}
                className="block w-full rounded-2xl border bg-background p-3 text-left transition hover:border-violet-300 hover:shadow-sm"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold">{displayBranchName(e.branchName) || e.branchName}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", t.chip)}>
                    {WORKFLOW_STATUS_LABEL[e.workflowStatus] || e.workflowStatus}
                  </span>
                </span>
                <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-3.5 w-3.5" />
                    {e.startTime ? `${String(e.startTime).slice(0, 5)}${e.endTime ? `–${String(e.endTime).slice(0, 5)}` : ""}` : "Vaqt belgilanmagan"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <UserRound className="h-3.5 w-3.5" /> {e.revizorName || "Revizor yo‘q"}
                  </span>
                </span>
                {e.notes ? <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{e.notes}</span> : null}
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
