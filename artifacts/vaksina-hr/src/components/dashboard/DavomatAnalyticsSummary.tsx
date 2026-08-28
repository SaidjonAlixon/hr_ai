import React from "react";
import { Link } from "wouter";
import { ArrowRight, BarChart3, Building2, Clock, Store, TrendingUp, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { rangeForPreset, useDavomatAnalytics } from "@/lib/davomat-analytics-api";
import { cn } from "@/lib/utils";

export function DavomatAnalyticsSummary({ enabled }: { enabled: boolean }) {
  const range = rangeForPreset("30d");
  const { data, isLoading } = useDavomatAnalytics({ ...range, segment: "all" }, enabled);

  if (!enabled) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-[#0a1628] via-[#0f2137] to-[#0a1628] text-foreground dark:text-white shadow-xl">
      <div className="flex flex-col gap-3 border-b border-slate-700/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">Davomat tahlili</p>
          <h2 className="text-lg font-bold md:text-xl">Boshqaruv paneli — davomat KPI</h2>
          <p className="text-sm text-muted-foreground">Ofis va apteka tarmog‘i alohida · 30 kunlik ko‘rinish</p>
        </div>
        <Link href="/davomat/analytics">
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-foreground dark:text-white hover:bg-sky-500">
            To‘liq analitika
            <ArrowRight className="h-4 w-4" />
          </span>
        </Link>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 md:p-6 xl:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl bg-slate-800/80" />)
        ) : (
          <>
            <MiniStat
              icon={Users}
              label="Jami xodim"
              value={String(data?.kpis.headcount ?? 0)}
              sub={`${data?.kpis.attendanceRate ?? 0}% o‘rtacha davomat`}
              accent="text-sky-300"
            />
            <MiniStat
              icon={Building2}
              label="Ofis"
              value={`${data?.segments.office.attendanceRate ?? 0}%`}
              sub={`${data?.segments.office.headcount ?? 0} xodim`}
              accent="text-emerald-300"
            />
            <MiniStat
              icon={Store}
              label="Apteka tarmog‘i"
              value={`${data?.segments.pharmacy.attendanceRate ?? 0}%`}
              sub={`${data?.segments.pharmacy.headcount ?? 0} xodim`}
              accent="text-violet-300"
            />
            <MiniStat
              icon={Clock}
              label="Kechikish"
              value={String(data?.kpis.latePersonDays ?? 0)}
              sub={`${data?.kpis.totalLateMinutes ?? 0} daqiqa jami`}
              accent="text-amber-300"
            />
          </>
        )}
      </div>

      {!isLoading && data?.today ? (
        <div className="border-t border-slate-700/60 px-4 py-3 md:px-6">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              Bugun: <strong className="text-foreground dark:text-white">{data.today.attendanceRate}%</strong>
            </span>
            <span className="text-muted-foreground">{data.today.present} keldi</span>
            <span className="text-amber-400">{data.today.late} kechikdi</span>
            <span className="text-rose-400">{data.today.absent} kelmagan</span>
            {data.alerts[0] ? (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-200">
                {data.alerts[0].title}: {data.alerts[0].count}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 border-t border-slate-700/60 p-4 sm:grid-cols-3 md:p-6">
        <Link
          href="/davomat/analytics?segment=office"
          className="flex items-center gap-2 rounded-xl bg-muted dark:bg-slate-800/50 px-3 py-2.5 text-sm hover:bg-muted dark:bg-slate-800"
        >
          <BarChart3 className="h-4 w-4 text-sky-400" />
          Ofis tahlili
        </Link>
        <Link
          href="/davomat/analytics?segment=pharmacy"
          className="flex items-center gap-2 rounded-xl bg-muted dark:bg-slate-800/50 px-3 py-2.5 text-sm hover:bg-muted dark:bg-slate-800"
        >
          <Store className="h-4 w-4 text-violet-400" />
          Apteka tahlili
        </Link>
        <Link href="/davomat" className="flex items-center gap-2 rounded-xl bg-muted dark:bg-slate-800/50 px-3 py-2.5 text-sm hover:bg-muted dark:bg-slate-800">
          <Users className="h-4 w-4 text-teal-400" />
          Davomat jadvali
        </Link>
      </div>
    </section>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={cn("mt-1 text-2xl font-bold tabular-nums", accent)}>{value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        </div>
        <Icon className={cn("h-5 w-5 opacity-80", accent)} />
      </div>
    </div>
  );
}
