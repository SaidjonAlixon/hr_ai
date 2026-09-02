import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  Clock,
  Download,
  MapPin,
  Store,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { canViewDavomat } from "@/lib/roles";
import {
  type DavomatAnalytics,
  type DavomatSegment,
  type AnalyticsRangePreset,
  addDaysYmd,
  rangeForPreset,
  tashkentTodayYmd,
  useDavomatAnalytics,
} from "@/lib/davomat-analytics-api";
import { cn } from "@/lib/utils";
import { useChartTheme } from "@/lib/chart-theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

type RangePreset = AnalyticsRangePreset | "custom";

const PRESET_BUTTONS: { key: AnalyticsRangePreset; label: string }[] = [
  { key: "today", label: "Bugun" },
  { key: "7d", label: "7 kun" },
  { key: "30d", label: "30 kun" },
  { key: "month", label: "Oy" },
];

const SEGMENT_OPTIONS: { key: DavomatSegment; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "all", label: "Hammasi", hint: "Barcha xodimlar", icon: Users },
  { key: "office", label: "Ofis", hint: "Ofis xodimlari", icon: Building2 },
  { key: "pharmacy", label: "Apteka tarmog'i", hint: "Mudir, farmasevt, stajyor, koordinator", icon: Store },
];

const PIE_COLORS = ["#34d399", "#fbbf24", "#f87171", "#a78bfa", "#60a5fa"];

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {label ? <p className="mb-1 font-semibold">{label}</p> : null}
      {payload.map((p) => (
        <p key={p.name} className="tabular-nums text-muted-foreground">
          {p.name}: <span className="font-semibold text-foreground">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

function KpiCard({
  title,
  value,
  sub,
  delta,
  icon: Icon,
  accent,
  loading,
}: {
  title: string;
  value: string | number;
  sub?: string;
  delta?: number | null;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="analytics-kpi h-[108px]" />;
  return (
    <div className="analytics-kpi">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        <div className={cn("rounded-lg p-2.5", accent)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {delta != null ? (
        <div className={cn("mt-2 flex items-center gap-1 text-xs font-medium", delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
          {delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {delta >= 0 ? "+" : ""}
          {delta}% oldingi davrga nisbatan
        </div>
      ) : null}
    </div>
  );
}

function Panel({
  title,
  children,
  className,
  action,
  bodyClassName,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("analytics-panel", className)}>
      <div className="analytics-panel-header">
        <h3 className="analytics-panel-title">{title}</h3>
        {action}
      </div>
      <div className={cn("analytics-panel-body", bodyClassName)}>{children}</div>
    </div>
  );
}

function formatYmdUz(ymd: string) {
  const [y, m, d] = ymd.split("-");
  const months = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];
  return `${Number(d)}-${months[Number(m) - 1]} ${y}`;
}

function branchStatusStyle(status: "on_time" | "late" | "absent" | "leave") {
  if (status === "on_time") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "late") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300";
  }
  if (status === "leave") {
    return "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-300";
  }
  return "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-300";
}

function BranchRow({ b }: { b: DavomatAnalytics["branchOpenings"][number] }) {
  const opened = b.checkIn && b.checkIn !== "—" ? b.checkIn : null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2 py-1.5",
        branchStatusStyle(b.status),
      )}
    >
      <Store className="h-3.5 w-3.5 shrink-0 opacity-80" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold leading-tight">{b.branchName}</p>
        <p className="truncate text-[10px] leading-tight opacity-75">{b.managerName}</p>
      </div>
      <div className="shrink-0 text-right leading-tight">
        <p className="text-[9px] font-medium uppercase tracking-wide opacity-60">Ochildi</p>
        {opened ? (
          <>
            <p className="text-sm font-bold tabular-nums">{opened}</p>
            <p className="text-[9px] tabular-nums opacity-60">
              vaqtida {b.expectedOpen}–{b.graceUntil ?? b.expectedOpen}
            </p>
            {b.lateMinutes > 0 ? (
              <p className="text-[9px] font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                +{b.lateMinutes} daq
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-xs font-semibold opacity-70">—</p>
            <p className="text-[9px] tabular-nums opacity-60">
              vaqtida {b.expectedOpen}–{b.graceUntil ?? b.expectedOpen}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

type BranchStatusTab = "on_time" | "late" | "absent";

function BranchStatusColumn({
  title,
  count,
  tone,
  items,
  empty,
}: {
  title: string;
  count: number;
  tone: "emerald" | "amber" | "rose";
  items: DavomatAnalytics["branchOpenings"];
  empty: string;
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-rose-500/30 bg-rose-500/5";
  const badgeClass =
    tone === "emerald"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : tone === "amber"
        ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
        : "bg-rose-500/15 text-rose-800 dark:text-rose-300";

  return (
    <div className={cn("flex min-h-0 flex-col rounded-xl border", toneClass)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-2.5 py-2">
        <span className="text-xs font-semibold">{title}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums", badgeClass)}>{count}</span>
      </div>
      <div className="max-h-[220px] space-y-1 overflow-y-auto p-2">
        {items.length ? (
          items.map((b) => <BranchRow key={b.branchId} b={b} />)
        ) : (
          <p className="py-6 text-center text-[11px] text-muted-foreground">{empty}</p>
        )}
      </div>
    </div>
  );
}

function BranchOpeningsPanel({
  openings,
  summary,
  loading,
  rangeLabel,
}: {
  openings: DavomatAnalytics["branchOpenings"];
  summary: DavomatAnalytics["branchOpeningSummary"];
  loading?: boolean;
  rangeLabel?: string;
}) {
  const [tab, setTab] = useState<BranchStatusTab>("late");

  const grouped = useMemo(() => {
    const onTime = openings.filter((b) => b.status === "on_time");
    const late = openings.filter((b) => b.status === "late");
    const absent = openings.filter((b) => b.status === "absent" || b.status === "leave");
    return { onTime, late, absent };
  }, [openings]);

  if (loading) {
    return (
      <div className="grid gap-2 md:grid-cols-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!summary) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Ma’lumot yo‘q</p>;
  }

  const tabs: { key: BranchStatusTab; label: string; count: number; tone: "emerald" | "amber" | "rose"; items: DavomatAnalytics["branchOpenings"]; empty: string }[] = [
    { key: "on_time", label: "Vaqtida", count: summary.onTime, tone: "emerald", items: grouped.onTime, empty: "Vaqtida ochilgan filial yo‘q" },
    { key: "late", label: "Kech", count: summary.late, tone: "amber", items: grouped.late, empty: "Kech ochilgan filial yo‘q" },
    { key: "absent", label: "Ochilmagan", count: summary.absent + summary.leave, tone: "rose", items: grouped.absent, empty: "Barcha filiallar ochilgan" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 font-medium text-foreground">
            <CalendarDays className="h-3 w-3" />
            {formatYmdUz(summary.date)}
          </span>
          {rangeLabel ? <span>{rangeLabel}</span> : null}
        </div>
        <div className="flex gap-1 md:hidden">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-lg px-2 py-1 text-[11px] font-semibold transition",
                tab === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
      </div>

      {!openings.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Mudir biriktirilgan filial topilmadi</p>
      ) : (
        <>
          <div className="hidden gap-3 md:grid md:grid-cols-3">
            {tabs.map((t) => (
              <BranchStatusColumn key={t.key} title={t.label} count={t.count} tone={t.tone} items={t.items} empty={t.empty} />
            ))}
          </div>
          <div className="md:hidden">
            {tabs
              .filter((t) => t.key === tab)
              .map((t) => (
                <BranchStatusColumn key={t.key} title={t.label} count={t.count} tone={t.tone} items={t.items} empty={t.empty} />
              ))}
          </div>
        </>
      )}
    </div>
  );
}

export function DavomatAnalyticsDashboard({
  embedded = false,
  initialSegment = "all",
}: {
  embedded?: boolean;
  initialSegment?: DavomatSegment;
}) {
  const { user } = useAuth();
  const search = useSearch();
  const segmentFromUrl = useMemo(() => {
    if (embedded) return initialSegment;
    const seg = new URLSearchParams(search).get("segment");
    return seg === "office" || seg === "pharmacy" ? seg : "all";
  }, [embedded, initialSegment, search]);
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [customFrom, setCustomFrom] = useState(() => addDaysYmd(tashkentTodayYmd(), -6));
  const [customTo, setCustomTo] = useState(() => tashkentTodayYmd());
  const [segment, setSegment] = useState<DavomatSegment>(segmentFromUrl);
  useEffect(() => {
    setSegment(segmentFromUrl);
  }, [segmentFromUrl]);
  const range = useMemo(() => {
    if (preset === "custom") {
      const from = customFrom <= customTo ? customFrom : customTo;
      const to = customFrom <= customTo ? customTo : customFrom;
      return { from, to };
    }
    return rangeForPreset(preset);
  }, [preset, customFrom, customTo]);
  const { data, isLoading, isError, error, refetch } = useDavomatAnalytics({ ...range, segment }, true);
  const chart = useChartTheme();
  const fillId = embedded ? "presentFillDash" : "presentFillPage";

  const pieData = (data?.statusBreakdown ?? []).filter((s) => s.count > 0).map((s) => ({ name: s.label, value: s.count }));

  return (
    <div
      className={cn(
        "analytics-shell",
        embedded && "rounded-2xl",
      )}
    >
      <div className={cn("mx-auto max-w-[1600px] space-y-5", embedded ? "p-4 pb-8 md:p-5" : "p-4 pb-10 md:p-6")}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            {embedded ? (
              <>
                <p className="text-xs font-medium uppercase tracking-wider text-primary">Boshqaruv paneli</p>
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Davomat tahlili</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {user?.fullName}
                  {data ? ` · ${data.from} — ${data.to}` : ""}
                </p>
              </>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Link href="/dashboard" className="inline-flex items-center gap-1 hover:text-foreground">
                    <ArrowLeft className="h-4 w-4" />
                    Boshqaruv
                  </Link>
                  <span>/</span>
                  <span className="text-muted-foreground">Davomat tahlili</span>
                </div>
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Davomat analitikasi</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data ? `${data.from} — ${data.to}` : "Yuklanmoqda…"} · To‘liq KPI, diagramma va solishtirma
                </p>
              </>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_BUTTONS.map(({ key, label }) => (
                <Button
                  key={key}
                  size="sm"
                  variant={preset === key ? "default" : "outline"}
                  onClick={() => setPreset(key)}
                >
                  {label}
                </Button>
              ))}
              <Button
                size="sm"
                variant={preset === "custom" ? "default" : "outline"}
                onClick={() => setPreset("custom")}
              >
                <CalendarDays className="mr-1.5 h-4 w-4" />
                Davr
              </Button>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                <Download className="mr-1.5 h-4 w-4" />
                Yangilash
              </Button>
              <Link href="/davomat">
                <Button size="sm" variant="outline">
                  Batafsil jadval
                </Button>
              </Link>
            </div>
            {preset === "custom" ? (
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card/60 p-2.5 dark:border-slate-600/40 dark:bg-slate-800/40">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-muted-foreground">Dan</span>
                  <Input
                    type="date"
                    value={customFrom}
                    max={customTo}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-9 w-[148px] rounded-lg"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-muted-foreground">Gacha</span>
                  <Input
                    type="date"
                    value={customTo}
                    min={customFrom}
                    max={tashkentTodayYmd()}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-9 w-[148px] rounded-lg"
                  />
                </label>
                <p className="pb-1 text-xs text-muted-foreground">
                  {range.from === range.to ? formatYmdUz(range.from) : `${formatYmdUz(range.from)} — ${formatYmdUz(range.to)}`}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {SEGMENT_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = segment === opt.key;
            const segStats =
              opt.key === "office"
                ? data?.segments.office
                : opt.key === "pharmacy"
                  ? data?.segments.pharmacy
                  : null;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSegment(opt.key)}
                className={cn(
                  "analytics-segment",
                  active && "analytics-segment-active",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn("rounded-lg p-2", active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.hint}</p>
                  </div>
                </div>
                {segStats && opt.key !== "all" ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {segStats.headcount} xodim · <span className="font-semibold text-emerald-600 dark:text-emerald-400">{segStats.attendanceRate}%</span> davomat
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>

        {isError ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-6 text-center text-rose-700 dark:text-rose-200">
            <p>{error instanceof Error ? error.message : "Ma'lumot yuklanmadi. Qayta urinib ko‘ring."}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Qayta urinish
            </Button>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          <KpiCard title="Jami xodim" value={data?.kpis.headcount ?? "—"} icon={Users} accent="bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200" loading={isLoading} />
          <KpiCard
            title="O‘rtacha davomat"
            value={data ? `${data.kpis.attendanceRate}%` : "—"}
            delta={data?.kpis.deltaRate}
            sub={`Maqsad: ${data?.kpis.targetRate ?? 95}%`}
            icon={BarChart3}
            accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"
            loading={isLoading}
          />
          <KpiCard title="Kelgan" value={data?.kpis.presentPersonDays ?? "—"} sub="kun-xodim" icon={TrendingUp} accent="bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-200" loading={isLoading} />
          <KpiCard title="Kechikkan" value={data?.kpis.latePersonDays ?? "—"} sub={`${data?.kpis.totalLateMinutes ?? 0} daqiqa`} icon={Clock} accent="bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200" loading={isLoading} />
          <KpiCard title="Kelmagan" value={data?.kpis.absentPersonDays ?? "—"} icon={AlertTriangle} accent="bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200" loading={isLoading} />
          <KpiCard title="Ta'til" value={data?.kpis.leavePersonDays ?? "—"} icon={CalendarDays} accent="bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200" loading={isLoading} />
          <KpiCard
            title="Bugun davomat"
            value={data?.today ? `${data.today.attendanceRate}%` : "—"}
            sub={data?.today ? `${data.today.present} keldi · ${data.today.late} kech` : undefined}
            icon={MapPin}
            accent="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200"
            loading={isLoading}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Kunlik dinamika" className="xl:col-span-2">
            {isLoading ? (
              <Skeleton className="h-64 w-full rounded-xl" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={data?.dailyTrend ?? []}>
                  <defs>
                    <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chart.area} stopOpacity={chart.areaFill} />
                      <stop offset="100%" stopColor={chart.area} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: chart.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: chart.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Legend wrapperStyle={{ color: chart.legend, fontSize: 12 }} />
                  <Area type="monotone" dataKey="attendanceRate" name="Davomat %" stroke={chart.area} fill={`url(#${fillId})`} strokeWidth={2} />
                  <Line type="monotone" dataKey="late" name="Kechikish" stroke={chart.lineLate} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="absent" name="Kelmagan" stroke={chart.lineAbsent} strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Holat taqsimoti">
            {isLoading ? (
              <Skeleton className="mx-auto h-64 w-64 rounded-full" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                  <Legend wrapperStyle={{ color: chart.legend, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Panel title="Bo‘limlar bo‘yicha">
            {isLoading ? (
              <Skeleton className="h-56 w-full rounded-xl" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={(data?.byDepartment ?? []).slice(0, 8)} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: chart.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fill: chart.tick, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="attendanceRate" name="Davomat %" fill={chart.barPrimary} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Smena bo‘yicha">
            {isLoading ? (
              <Skeleton className="h-56 w-full rounded-xl" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data?.byShift ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: chart.tick, fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={50} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: chart.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="attendanceRate" name="Davomat %" fill={chart.barSecondary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="late" name="Kechikish" fill={chart.lineLate} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Oylik solishtirma">
            {isLoading ? (
              <Skeleton className="h-56 w-full rounded-xl" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data?.monthlyTrend ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: chart.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: chart.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Line type="monotone" dataKey="attendanceRate" name="Davomat %" stroke={chart.area} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-12">
          <Panel title="Lavozim / rol bo‘yicha" className="lg:col-span-3">
            <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
              {(data?.byRole ?? []).map((r) => (
                <div key={r.key} className="analytics-inset !py-1.5 !px-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{r.label}</span>
                    <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">{r.attendanceRate}%</span>
                  </div>
                  <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                    <span>{r.headcount} xodim</span>
                    <span>{r.late} kech</span>
                  </div>
                  <Progress value={r.attendanceRate} className="mt-1 h-1" />
                </div>
              ))}
              {!isLoading && !(data?.byRole ?? []).length ? (
                <p className="text-sm text-muted-foreground">Ma'lumot yo‘q</p>
              ) : null}
            </div>
          </Panel>

          <Panel title="Filiallar ochilishi" className="lg:col-span-6">
            <BranchOpeningsPanel
              openings={data?.branchOpenings ?? []}
              summary={data?.branchOpeningSummary ?? null}
              loading={isLoading}
              rangeLabel={
                range.from !== range.to ? `Davr oxirgi kuni · ${formatYmdUz(range.to)}` : undefined
              }
            />
          </Panel>

          <Panel title="Ko‘rsatkichlar" className="lg:col-span-3">
            <div className="space-y-3 text-sm">
              <div className="analytics-inset">
                <p className="text-muted-foreground">Eng yaxshi kun</p>
                <p className="font-medium text-emerald-600 dark:text-emerald-400">
                  {data?.bestDay ? `${data.bestDay.date} · ${data.bestDay.rate}%` : "—"}
                </p>
              </div>
              <div className="analytics-inset">
                <p className="text-muted-foreground">Eng past kun</p>
                <p className="font-medium text-rose-600 dark:text-rose-400">
                  {data?.worstDay ? `${data.worstDay.date} · ${data.worstDay.rate}%` : "—"}
                </p>
              </div>
              <div className="analytics-inset">
                <p className="text-muted-foreground">Ishlangan soat (jami)</p>
                <p className="font-medium">{data?.kpis.totalWorkedHours ?? "—"} soat</p>
              </div>
              <div className="analytics-inset">
                <p className="mb-1 text-muted-foreground">Maqsadga erishish</p>
                <Progress value={data?.kpis.attendanceRate ?? 0} className="h-2" />
                <p className="mt-1 text-xs text-muted-foreground">
                  {data?.kpis.attendanceRate ?? 0}% / {data?.kpis.targetRate ?? 95}%
                </p>
              </div>
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Top 10 kechikuvchilar" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="analytics-table w-full text-sm">
                <thead>
                  <tr>
                    <th>Xodim</th>
                    <th>Bo‘lim</th>
                    <th className="text-right">Kun</th>
                    <th className="text-right">Daqiqa</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.topLate ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.fullName}</td>
                      <td className="text-muted-foreground">{r.departmentName || "—"}</td>
                      <td className="text-right tabular-nums text-amber-600 dark:text-amber-400">{r.lateDays}</td>
                      <td className="text-right tabular-nums text-muted-foreground">{r.lateMinutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="So‘nggi kelishlar" bodyClassName="p-0">
            <div className="max-h-80 overflow-y-auto overflow-x-auto">
              <table className="analytics-table w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Xodim</th>
                    <th>Bo‘lim</th>
                    <th>Vaqt</th>
                    <th className="text-right">Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recentCheckins ?? []).map((r, i) => (
                    <tr key={`${r.fullName}-${i}`}>
                      <td className="font-medium">{r.fullName}</td>
                      <td className="text-muted-foreground">{r.departmentName || "—"}</td>
                      <td className="tabular-nums text-muted-foreground">{r.checkIn}</td>
                      <td className="text-right">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            r.status === "late"
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                          )}
                        >
                          {r.statusLabel}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <Panel title="Bo‘limlar jadvali" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="analytics-table w-full text-sm">
              <thead>
                <tr>
                  <th>Bo‘lim</th>
                  <th className="text-right">Xodim</th>
                  <th className="text-right">Kelgan</th>
                  <th className="text-right">Kech</th>
                  <th className="text-right">Kelmagan</th>
                  <th className="text-right">Davomat %</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byDepartment ?? []).map((d) => (
                  <tr key={d.name}>
                    <td className="font-medium">{d.name}</td>
                    <td className="text-right tabular-nums">{d.headcount}</td>
                    <td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{d.present}</td>
                    <td className="text-right tabular-nums text-amber-600 dark:text-amber-400">{d.late}</td>
                    <td className="text-right tabular-nums text-rose-600 dark:text-rose-400">{d.absent}</td>
                    <td className="text-right font-medium tabular-nums text-primary">{d.attendanceRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default function DavomatAnalyticsPage() {
  const { user } = useAuth();
  if (!canViewDavomat(user?.role)) {
    return <div className="p-8 text-center text-muted-foreground">Bu sahifa uchun ruxsat yo‘q.</div>;
  }
  return <DavomatAnalyticsDashboard />;
}
