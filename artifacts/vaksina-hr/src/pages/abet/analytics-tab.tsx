import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileDown, Loader2, MessageSquareText, QrCode, Smartphone, Star, TrendingDown, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  SCORE_LABEL,
  downloadAbetExcel,
  fmtDay,
  fmtTime,
  scoreTone,
  shiftDay,
  useAbetDayAnalytics,
  useAbetRangeAnalytics,
  type AbetToday,
  type DayAnalytics,
} from "@/lib/abet-api";
import { StarsView } from "./stars";

const BAR_TONE: Record<number, string> = {
  5: "bg-emerald-500",
  4: "bg-lime-500",
  3: "bg-amber-400",
  2: "bg-orange-500",
  1: "bg-red-500",
};

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: typeof Users; label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-white/50">
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", tone)}>
          <Icon className="h-4 w-4" />
        </span>
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      {sub ? <p className="text-xs text-slate-500 dark:text-white/50">{sub}</p> : null}
    </div>
  );
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5", className)}>
      <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-white/90">{title}</h4>
      {children}
    </section>
  );
}

function AvgBar({ label, sub, value, count }: { label: string; sub?: string; value: number | null; count: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate text-slate-700 dark:text-white/80">
          {label}
          {sub ? <span className="ml-1 text-xs text-slate-400">· {sub}</span> : null}
        </span>
        <span className={cn("shrink-0 font-semibold", scoreTone(value))}>
          {value != null ? value.toFixed(2) : "—"} <span className="text-xs font-normal text-slate-400">({count})</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500" style={{ width: `${((value ?? 0) / 5) * 100}%` }} />
      </div>
    </div>
  );
}

const CRITERIA_LABEL: Record<string, string> = {
  taste: "Ta’mi",
  portion: "Porsiya",
  temperature: "Issiqligi",
  cleanliness: "Tozalik",
  service: "Xizmat",
};

function DayView({ a }: { a: DayAnalytics }) {
  const [scoreFilter, setScoreFilter] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const maxDist = Math.max(1, ...a.distribution.map((d) => d.count));
  const maxHour = Math.max(1, ...a.hourly.map((h) => h.count));
  const comments = a.ratings.filter((r) => r.comment);
  const rows = useMemo(
    () =>
      a.ratings.filter(
        (r) =>
          (scoreFilter == null || r.overall === scoreFilter) &&
          (!q.trim() || `${r.fullName} ${r.department ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [a.ratings, scoreFilter, q],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Users}
          label="Baholaganlar"
          value={`${a.responded} / ${a.eligible}`}
          sub={`Qamrov ${a.responseRate}%`}
          tone="bg-sky-100 text-sky-700"
        />
        <Kpi
          icon={Star}
          label="O‘rtacha baho"
          value={a.average != null ? `${a.average.toFixed(2)} ★` : "—"}
          sub={a.average != null ? SCORE_LABEL[Math.round(a.average)] : "Hali baho yo‘q"}
          tone="bg-amber-100 text-amber-700"
        />
        <Kpi icon={QrCode} label="QR orqali" value={String(a.sources.qr)} sub={`Ilovada: ${a.sources.app}`} tone="bg-teal-100 text-teal-700" />
        <Kpi icon={MessageSquareText} label="Izohlar" value={String(comments.length)} sub="Yozma fikr qoldirganlar" tone="bg-violet-100 text-violet-700" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Menyu">
          {a.menu?.items.length ? (
            <ul className="space-y-1 text-sm">
              {a.menu.items.map((it) => (
                <li key={it.name} className="flex justify-between gap-2">
                  <span className="text-slate-800 dark:text-white/90">{it.name}</span>
                  <span className="text-xs text-slate-400">{CATEGORY_LABEL[it.category]}</span>
                </li>
              ))}
              <li className="pt-2 text-xs text-slate-500">
                {a.menu.status === "approved" ? `Tasdiqlagan: ${a.menu.approvedByName ?? "—"}` : "Qoralama (tasdiqlanmagan)"}
              </li>
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Menyu kiritilmagan</p>
          )}
        </Panel>

        <Panel title="Baholar taqsimoti">
          <div className="space-y-1.5">
            {a.distribution.map((d) => (
              <button
                key={d.score}
                type="button"
                onClick={() => setScoreFilter((p) => (p === d.score ? null : d.score))}
                className={cn("flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left", scoreFilter === d.score && "bg-slate-100 dark:bg-white/10")}
              >
                <span className="w-8 shrink-0 text-sm font-semibold text-slate-700 dark:text-white/80">{d.score}★</span>
                <span className="h-4 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-white/10">
                  <span className={cn("block h-full rounded", BAR_TONE[d.score])} style={{ width: `${(d.count / maxDist) * 100}%` }} />
                </span>
                <span className="w-14 shrink-0 text-right text-xs text-slate-500">
                  {d.count} · {a.responded ? Math.round((d.count / a.responded) * 100) : 0}%
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Baholash vaqti (yarim soatlik)">
          <div className="flex h-28 items-end gap-2">
            {a.hourly.map((h) => (
              <div key={h.hm} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-white/70">{h.count || ""}</span>
                <span className="w-full rounded-t bg-teal-500/80" style={{ height: `${(h.count / maxHour) * 80}px`, minHeight: h.count ? 4 : 1 }} />
                <span className="text-[10px] text-slate-400">{h.hm}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Taomlar bo‘yicha">
          {a.dishes.length ? (
            <div className="space-y-3">
              {a.dishes.map((d) => (
                <AvgBar key={d.name} label={d.name} sub={CATEGORY_LABEL[d.category]} value={d.average} count={d.count} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Taom bo‘yicha baho yo‘q</p>
          )}
        </Panel>
        <Panel title="Mezonlar bo‘yicha">
          <div className="space-y-3">
            {a.criteria.map((c) => (
              <AvgBar key={c.key} label={CRITERIA_LABEL[c.key] ?? c.key} value={c.average} count={c.count} />
            ))}
          </div>
        </Panel>
        <Panel title="Belgilar va bo‘limlar">
          {a.tags.length ? (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {a.tags.map((t) => (
                <span key={t.tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 dark:bg-white/10 dark:text-white/80">
                  {t.tag} <b>{t.count}</b>
                </span>
              ))}
            </div>
          ) : (
            <p className="mb-4 text-sm text-slate-500">Belgi tanlanmagan</p>
          )}
          <div className="space-y-1 text-sm">
            {a.byDepartment.map((d) => (
              <div key={d.department} className="flex justify-between gap-2">
                <span className="truncate text-slate-700 dark:text-white/80">{d.department}</span>
                <span className="shrink-0 text-slate-500">
                  {d.count} ta · <b className={scoreTone(d.average)}>{d.average.toFixed(1)}</b>
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title={`Barcha baholar (${rows.length}${scoreFilter ? ` · ${scoreFilter}★` : ""})`}>
        <div className="mb-3 flex flex-wrap gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim yoki bo‘lim bo‘yicha qidirish" className="max-w-xs" />
          {scoreFilter ? (
            <Button variant="ghost" size="sm" onClick={() => setScoreFilter(null)}>
              Filtrni olib tashlash
            </Button>
          ) : null}
        </div>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-white/10">
                  <th className="py-2 pr-2">Xodim</th>
                  <th className="py-2 pr-2">Vaqt</th>
                  <th className="py-2 pr-2">Baho</th>
                  <th className="py-2 pr-2">Mezonlar</th>
                  <th className="py-2 pr-2">Taomlar</th>
                  <th className="py-2 pr-2">Belgilar / izoh</th>
                  <th className="py-2">Usul</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 align-top last:border-0 dark:border-white/5">
                    <td className="py-2 pr-2">
                      <p className="font-medium text-slate-900 dark:text-white">{r.fullName}</p>
                      <p className="text-xs text-slate-500">{r.department ?? "—"}</p>
                    </td>
                    <td className="py-2 pr-2 text-slate-600 dark:text-white/70">{fmtTime(r.createdAt)}</td>
                    <td className="py-2 pr-2">
                      <StarsView value={r.overall} />
                    </td>
                    <td className="py-2 pr-2 text-xs text-slate-600 dark:text-white/70">
                      {Object.entries(r.criteria).map(([k, v]) => (
                        <span key={k} className="mr-2 inline-block">
                          {CRITERIA_LABEL[k] ?? k}: <b>{v}</b>
                        </span>
                      ))}
                    </td>
                    <td className="py-2 pr-2 text-xs text-slate-600 dark:text-white/70">
                      {Object.entries(r.dishes).map(([k, v]) => (
                        <span key={k} className="mr-2 inline-block">
                          {k}: <b>{v}</b>
                        </span>
                      ))}
                    </td>
                    <td className="max-w-[280px] py-2 pr-2 text-xs">
                      {r.tags.length ? <p className="text-slate-500">{r.tags.join(", ")}</p> : null}
                      {r.comment ? <p className="mt-0.5 text-slate-800 dark:text-white/90">“{r.comment}”</p> : null}
                    </td>
                    <td className="py-2">
                      {r.source === "qr" ? (
                        <span className="inline-flex items-center gap-1 rounded bg-teal-50 px-1.5 py-0.5 text-xs text-teal-700">
                          <QrCode className="h-3 w-3" /> QR
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-orange-50 px-1.5 py-0.5 text-xs text-orange-700">
                          <Smartphone className="h-3 w-3" /> Ilova
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Bu kun uchun baho yo‘q</p>
        )}
      </Panel>
    </div>
  );
}

function RangeView({ from, to, onPick }: { from: string; to: string; onPick: (day: string) => void }) {
  const r = useAbetRangeAnalytics(from, to, true);
  if (r.isLoading) return <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-slate-400" />;
  if (r.error || !r.data) return <p className="text-sm text-red-600">{(r.error as Error)?.message ?? "Xatolik"}</p>;
  const a = r.data;
  const chronological = [...a.days].reverse();
  const maxCount = Math.max(1, ...a.days.map((d) => d.responded));
  const ratedDays = a.days.filter((d) => d.responded);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Users} label="Jami baholar" value={String(a.totalResponses)} sub={`${ratedDays.length} kun`} tone="bg-sky-100 text-sky-700" />
        <Kpi
          icon={Star}
          label="Davr o‘rtachasi"
          value={a.average != null ? `${a.average.toFixed(2)} ★` : "—"}
          tone="bg-amber-100 text-amber-700"
        />
        <Kpi
          icon={Users}
          label="Kunlik o‘rtacha qamrov"
          value={ratedDays.length && a.eligible ? `${Math.round((a.totalResponses / ratedDays.length / a.eligible) * 100)}%` : "—"}
          sub={`${a.eligible} ofis xodimi`}
          tone="bg-teal-100 text-teal-700"
        />
        <Kpi
          icon={TrendingUp}
          label="Eng yaxshi kun"
          value={
            ratedDays.length
              ? fmtDay([...ratedDays].sort((x, y) => (y.average ?? 0) - (x.average ?? 0))[0]!.day, false)
              : "—"
          }
          sub={ratedDays.length ? `${[...ratedDays].sort((x, y) => (y.average ?? 0) - (x.average ?? 0))[0]!.average?.toFixed(2)} ★` : undefined}
          tone="bg-emerald-100 text-emerald-700"
        />
      </div>

      <Panel title="Kunlik dinamika (ustun — baholar soni, rang — o‘rtacha baho). Kunni bosing — batafsil">
        {chronological.length ? (
          <div className="flex h-44 items-end gap-1 overflow-x-auto pb-1">
            {chronological.map((d) => (
              <button
                key={d.day}
                type="button"
                onClick={() => onPick(d.day)}
                title={`${fmtDay(d.day)}: ${d.responded} ta baho, o‘rtacha ${d.average ?? "—"}`}
                className="flex min-w-[28px] flex-1 flex-col items-center gap-1"
              >
                <span className={cn("text-[10px] font-semibold", scoreTone(d.average))}>{d.average != null ? d.average.toFixed(1) : ""}</span>
                <span
                  className={cn("w-full rounded-t", d.average == null ? "bg-slate-200" : BAR_TONE[Math.max(1, Math.min(5, Math.round(d.average)))])}
                  style={{ height: `${(d.responded / maxCount) * 110}px`, minHeight: 3 }}
                />
                <span className="text-[10px] text-slate-400">{d.day.slice(8)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Bu davrda ma’lumot yo‘q</p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Eng yuqori baholangan taomlar">
          {a.topDishes.length ? (
            <div className="space-y-3">
              {a.topDishes.map((d) => (
                <AvgBar key={d.name} label={d.name} sub={`${d.days} kun`} value={d.average} count={d.count} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Yetarli ma’lumot yo‘q</p>
          )}
        </Panel>
        <Panel title="E’tibor talab qiladigan taomlar">
          {a.bottomDishes.length ? (
            <div className="space-y-3">
              {a.bottomDishes.map((d) => (
                <AvgBar key={d.name} label={d.name} sub={`${d.days} kun`} value={d.average} count={d.count} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Yetarli ma’lumot yo‘q</p>
          )}
        </Panel>
      </div>

      <Panel title="Kunlar ro‘yxati">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-white/10">
                <th className="py-2 pr-2">Sana</th>
                <th className="py-2 pr-2">Menyu</th>
                <th className="py-2 pr-2">Baholar</th>
                <th className="py-2">O‘rtacha</th>
              </tr>
            </thead>
            <tbody>
              {a.days.map((d) => (
                <tr
                  key={d.day}
                  onClick={() => onPick(d.day)}
                  className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 last:border-0 dark:border-white/5 dark:hover:bg-white/5"
                >
                  <td className="py-2 pr-2 font-medium text-slate-900 dark:text-white">{fmtDay(d.day)}</td>
                  <td className="py-2 pr-2 text-slate-600 dark:text-white/70">
                    {d.items.join(", ") || "—"}
                    {!d.approved && d.items.length ? <span className="ml-1 text-xs text-amber-600">(qoralama)</span> : null}
                  </td>
                  <td className="py-2 pr-2">{d.responded}</td>
                  <td className={cn("py-2 font-semibold", scoreTone(d.average))}>{d.average != null ? d.average.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function AnalyticsTab({ data }: { data: AbetToday }) {
  const { toast } = useToast();
  const today = data.window.day;
  const [mode, setMode] = useState<"day" | "range">("day");
  const [day, setDay] = useState(today);
  const [from, setFrom] = useState(shiftDay(today, -29));
  const [to, setTo] = useState(today);
  const [exporting, setExporting] = useState(false);
  const dayQ = useAbetDayAnalytics(day, mode === "day");

  const exportXlsx = async () => {
    setExporting(true);
    try {
      if (mode === "day") await downloadAbetExcel(day, day);
      else await downloadAbetExcel(from, to);
    } catch (e) {
      toast({ title: "Excel", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-white/10 dark:bg-white/5">
          {(["day", "range"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                mode === m ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-white/70 dark:hover:bg-white/10",
              )}
            >
              {m === "day" ? "Kunlik" : "Davr bo‘yicha"}
            </button>
          ))}
        </div>

        {mode === "day" ? (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Oldingi kun" onClick={() => setDay(shiftDay(day, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-[160px]" />
            <Button variant="outline" size="icon" aria-label="Keyingi kun" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {day !== today ? (
              <Button variant="ghost" size="sm" onClick={() => setDay(today)}>
                Bugun
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-[160px]" />
            <span className="text-slate-400">—</span>
            <Input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-[160px]" />
          </div>
        )}

        <Button variant="outline" className="ml-auto" onClick={() => void exportXlsx()} disabled={exporting}>
          {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
          Excel
        </Button>
      </div>

      {mode === "day" ? (
        <>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            {fmtDay(day)}
            {day === today ? (
              <span className="ml-2 align-middle text-xs font-normal text-slate-500">
                {data.window.state === "open" ? "· baholash davom etmoqda" : data.window.state === "before" ? "· baholash hali ochilmagan" : "· baholash yakunlangan"}
              </span>
            ) : null}
          </h3>
          {dayQ.isLoading ? (
            <Loader2 className="mx-auto my-10 h-6 w-6 animate-spin text-slate-400" />
          ) : dayQ.error || !dayQ.data ? (
            <p className="text-sm text-red-600">{(dayQ.error as Error)?.message ?? "Xatolik"}</p>
          ) : (
            <DayView a={dayQ.data} />
          )}
        </>
      ) : (
        <RangeView
          from={from}
          to={to}
          onPick={(d) => {
            setDay(d);
            setMode("day");
          }}
        />
      )}
      {mode === "day" && dayQ.data && dayQ.data.average != null && dayQ.data.average < 3 ? (
        <p className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          <TrendingDown className="h-4 w-4" /> Bu kungi o‘rtacha baho past — oshxona bilan muhokama qilish tavsiya etiladi.
        </p>
      ) : null}
    </div>
  );
}
