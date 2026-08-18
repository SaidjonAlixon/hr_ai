import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  Store,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useGetEmployees } from "@workspace/api-client-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useBranchAuditsList, type BranchAudit } from "@/lib/branch-audits-api";
import { buildCoverage } from "./coverage-panel";

type RangeKey = "all" | "today" | "7d" | "30d";

const RANGE_LABEL: Record<RangeKey, string> = {
  all: "Barchasi",
  today: "Bugun",
  "7d": "7 kun",
  "30d": "30 kun",
};

const COORD_BAR = ["#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#f43f5e", "#06b6d4", "#f97316", "#6366f1"];

function tashkentYmd(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDaysYmd(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return dt.toISOString().slice(0, 10);
}

function formatShort(ymd: string) {
  const [, m, d] = ymd.split("-");
  return `${d}.${m}`;
}

function scoreTone(pct: number) {
  if (pct >= 85) return "text-emerald-600";
  if (pct >= 70) return "text-amber-600";
  return "text-rose-600";
}

function scoreBand(pct: number) {
  if (pct >= 85) return "a'lo";
  if (pct >= 70) return "o'rtacha";
  return "past";
}

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white px-2.5 py-1.5 text-xs shadow-md">
      {label ? <p className="mb-0.5 font-semibold text-slate-800">{label}</p> : null}
      {payload.map((p) => (
        <p key={p.name} className="tabular-nums text-slate-600">
          {p.name}: <span className="font-semibold text-slate-900">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function ChecklistDashboard({ enabled }: { enabled: boolean }) {
  const [range, setRange] = useState<RangeKey>("all");
  const today = tashkentYmd();

  const { data: audits = [], isLoading: auditsLoading } = useBranchAuditsList({}, enabled);
  const { data: employees, isLoading: empLoading } = useGetEmployees(undefined, {
    query: { enabled },
  });
  const isLoading = auditsLoading || empLoading;

  const from =
    range === "today" ? today : range === "7d" ? addDaysYmd(today, -6) : range === "30d" ? addDaysYmd(today, -29) : "";

  const sliced = useMemo(() => {
    if (!from) return audits;
    return audits.filter((a) => a.visitDate >= from && a.visitDate <= today);
  }, [audits, from, today]);

  const coverage = useMemo(() => {
    if (!employees) return undefined;
    return buildCoverage(employees as Parameters<typeof buildCoverage>[0], audits, from || undefined, today);
  }, [employees, audits, from, today]);

  const dash = useMemo(() => computeDashboard(sliced, coverage), [sliced, coverage]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border bg-white px-4 py-16 text-center text-sm text-slate-500">
        Dashboard yuklanmoqda…
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 sm:text-lg">Umumiy holat</h2>
          <p className="text-xs text-slate-500 sm:text-sm">
            Tashriflar, ball, qamrov, GPS va cheklist jarayonlari — bir joyda.
          </p>
        </div>
        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-medium sm:px-3",
                range === key ? "bg-white text-[#0b1a2e] shadow-sm" : "text-slate-600 hover:text-slate-900",
              )}
            >
              {RANGE_LABEL[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 sm:gap-3">
        <Kpi icon={ClipboardCheck} label="Tashriflar" value={String(dash.visits)} tone="bg-sky-50 text-sky-700" />
        <Kpi icon={Store} label="Filial (tashrif)" value={String(dash.visitedBranches)} tone="bg-indigo-50 text-indigo-700" />
        <Kpi icon={Users} label="Koordinator" value={String(dash.coordinators)} tone="bg-violet-50 text-violet-700" />
        <Kpi
          icon={TrendingUp}
          label="O‘rtacha ball"
          value={`${dash.avg}%`}
          tone="bg-emerald-50"
          valueClass={scoreTone(dash.avg)}
        />
        <Kpi
          icon={CheckCircle2}
          label="Qamrov"
          value={`${dash.coveragePct}%`}
          tone="bg-cyan-50 text-cyan-800"
          hint={coverage ? `${coverage.totals.filled}/${coverage.totals.branches}` : undefined}
        />
        <Kpi
          icon={MapPin}
          label="GPS"
          value={`${dash.gpsPct}%`}
          tone="bg-amber-50 text-amber-800"
          hint={`${dash.withGps} ta tashrif`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatusCard
          title="Ball holati"
          items={[
            { label: "A’lo ≥85%", value: dash.bands.excellent, color: "bg-emerald-500", text: "text-emerald-700" },
            { label: "O‘rtacha 70–84%", value: dash.bands.mid, color: "bg-amber-500", text: "text-amber-700" },
            { label: "Past <70%", value: dash.bands.low, color: "bg-rose-500", text: "text-rose-700" },
          ]}
          total={dash.visits}
        />
        <StatusCard
          title="Javoblar"
          items={[
            { label: "Ha", value: dash.yes, color: "bg-emerald-500", text: "text-emerald-700" },
            { label: "Yo‘q", value: dash.no, color: "bg-rose-500", text: "text-rose-700" },
          ]}
          total={dash.yes + dash.no}
        />
        <StatusCard
          title="Jarayon"
          items={[
            { label: "GPS bor", value: dash.withGps, color: "bg-sky-500", text: "text-sky-700" },
            { label: "GPS yo‘q", value: dash.visits - dash.withGps, color: "bg-slate-400", text: "text-slate-600" },
            {
              label: "Kiritilmagan filial",
              value: coverage?.totals.missing ?? 0,
              color: "bg-rose-400",
              text: "text-rose-700",
            },
          ]}
          total={Math.max(dash.visits, coverage?.totals.branches ?? 0)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-2xl border bg-white p-4 shadow-sm lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Kunlik tashriflar</h3>
              <p className="text-[11px] text-slate-500">Oxirgi 14 kun · nechta cheklist</p>
            </div>
            <CalendarDays className="h-4 w-4 text-slate-400" />
          </div>
          <div className="h-52">
            {dash.byDay.every((d) => d.tashrif === 0) ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dash.byDay} barSize={14}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} width={24} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="tashrif" name="Tashrif" radius={[6, 6, 0, 0]} fill="#0ea5e9" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-semibold">Ball taqsimoti</h3>
          <p className="mb-2 text-[11px] text-slate-500">Tashriflar qanday baholangan</p>
          <div className="h-52">
            {dash.visits === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={dash.pie}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={74}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {dash.pie.map((p) => (
                      <Cell key={p.name} fill={p.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-3 text-[11px]">
            {dash.pie.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-1.5 text-slate-600">
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                {p.name} · {p.value}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Koordinatorlar reytingi</h3>
            <p className="text-[11px] text-slate-500">Tashrif soni va o‘rtacha ball</p>
          </div>
          <ul className="divide-y">
            {dash.byCoordinator.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-slate-400">Ma’lumot yo‘q</li>
            ) : (
              dash.byCoordinator.map((c, i) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">{c.name}</p>
                    <p className="shrink-0 text-xs tabular-nums text-slate-500">
                      {c.visits} tashrif · <span className={cn("font-semibold", scoreTone(c.avg))}>{c.avg}%</span>
                    </p>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${dash.maxVisits ? Math.max(8, (c.visits / dash.maxVisits) * 100) : 0}%`,
                        background: COORD_BAR[i % COORD_BAR.length],
                      }}
                    />
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Cheklist jarayonlari</h3>
            <p className="text-[11px] text-slate-500">Bo‘limlar bo‘yicha “Ha” ulushi</p>
          </div>
          <ul className="divide-y">
            {dash.categories.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-slate-400">Ma’lumot yo‘q</li>
            ) : (
              dash.categories.map((cat) => (
                <li key={cat.title} className="px-4 py-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium">{cat.title}</p>
                    <p className={cn("shrink-0 text-xs font-semibold tabular-nums", scoreTone(cat.pct))}>{cat.pct}%</p>
                  </div>
                  <Progress value={cat.pct} className="h-2" />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Ha {cat.yes} · Yo‘q {cat.no}
                  </p>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Eng past ball — filiallar</h3>
            <p className="text-[11px] text-slate-500">Nazorat kerak bo‘lgan joylar</p>
          </div>
          <ul className="divide-y">
            {dash.weakBranches.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-slate-400">Ma’lumot yo‘q</li>
            ) : (
              dash.weakBranches.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{b.name}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      {b.visits} tashrif · {b.manager}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold tabular-nums",
                      b.avg >= 85
                        ? "bg-emerald-50 text-emerald-700"
                        : b.avg >= 70
                          ? "bg-amber-50 text-amber-800"
                          : "bg-rose-50 text-rose-700",
                    )}
                  >
                    {b.avg < 70 ? <AlertTriangle className="h-3 w-3" /> : null}
                    {b.avg}%
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Oxirgi tashriflar</h3>
            <p className="text-[11px] text-slate-500">Eng yangi cheklistlar</p>
          </div>
          <ul className="divide-y">
            {dash.recent.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-slate-400">Hali tashrif yo‘q</li>
            ) : (
              dash.recent.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.branchLocation || "Filial"}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      {a.coordinatorName || "Koordinator"} · {formatShort(a.visitDate)} · {a.visitName}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs">
                    {a.checkLatitude != null ? (
                      <MapPin className="h-3 w-3 text-sky-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-slate-300" />
                    )}
                    <span className={cn("font-bold tabular-nums", scoreTone(a.scorePercent))}>{a.scorePercent}%</span>
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function computeDashboard(
  audits: BranchAudit[],
  coverage:
    | ReturnType<typeof buildCoverage>
    | undefined,
) {
  const today = tashkentYmd();
  const byDay = Array.from({ length: 14 }, (_, i) => {
    const ymd = addDaysYmd(today, i - 13);
    return { ymd, label: formatShort(ymd), tashrif: 0 };
  });
  const dayIndex = new Map(byDay.map((d, i) => [d.ymd, i]));

  const bands = { excellent: 0, mid: 0, low: 0 };
  let yes = 0;
  let no = 0;
  let withGps = 0;
  const coordMap = new Map<string, { id: string; name: string; visits: number; scores: number[] }>();
  const branchMap = new Map<
    string,
    { id: string; name: string; manager: string; visits: number; scores: number[] }
  >();
  const catMap = new Map<string, { title: string; yes: number; no: number }>();

  for (const a of audits) {
    const di = dayIndex.get(a.visitDate);
    if (di != null) byDay[di]!.tashrif += 1;
    const band = scoreBand(a.scorePercent);
    if (band === "a'lo") bands.excellent += 1;
    else if (band === "o'rtacha") bands.mid += 1;
    else bands.low += 1;
    yes += a.yesCount ?? 0;
    no += a.noCount ?? 0;
    if (a.checkLatitude != null && a.checkLongitude != null) withGps += 1;

    const ck = String(a.coordinatorId);
    const c = coordMap.get(ck) ?? {
      id: ck,
      name: a.coordinatorName || "Koordinator",
      visits: 0,
      scores: [],
    };
    c.visits += 1;
    c.scores.push(a.scorePercent);
    coordMap.set(ck, c);

    const bk = String(a.managerEmployeeId);
    const b = branchMap.get(bk) ?? {
      id: bk,
      name: a.branchLocation || "Filial",
      manager: a.managerName || "—",
      visits: 0,
      scores: [],
    };
    b.visits += 1;
    b.scores.push(a.scorePercent);
    branchMap.set(bk, b);

    for (const cat of a.categories ?? []) {
      const row = catMap.get(cat.title) ?? { title: cat.title, yes: 0, no: 0 };
      for (const it of cat.items ?? []) {
        if (it.answer === "yes") row.yes += 1;
        if (it.answer === "no") row.no += 1;
      }
      catMap.set(cat.title, row);
    }
  }

  const avg =
    audits.length === 0 ? 0 : Math.round(audits.reduce((s, a) => s + a.scorePercent, 0) / audits.length);
  const coveragePct =
    coverage && coverage.totals.branches > 0
      ? Math.round((coverage.totals.filled / coverage.totals.branches) * 100)
      : 0;
  const gpsPct = audits.length === 0 ? 0 : Math.round((withGps / audits.length) * 100);

  const byCoordinator = [...coordMap.values()]
    .map((c) => ({
      ...c,
      avg: Math.round(c.scores.reduce((s, n) => s + n, 0) / c.scores.length),
    }))
    .sort((a, b) => b.visits - a.visits);

  const weakBranches = [...branchMap.values()]
    .map((b) => ({
      ...b,
      avg: Math.round(b.scores.reduce((s, n) => s + n, 0) / b.scores.length),
    }))
    .sort((a, b) => a.avg - b.avg || b.visits - a.visits)
    .slice(0, 6);

  const categories = [...catMap.values()]
    .map((c) => {
      const answered = c.yes + c.no;
      return { ...c, pct: answered === 0 ? 0 : Math.round((c.yes / answered) * 100) };
    })
    .sort((a, b) => a.pct - b.pct);

  const recent = [...audits]
    .sort((a, b) => String(b.createdAt || b.visitDate).localeCompare(String(a.createdAt || a.visitDate)))
    .slice(0, 7);

  return {
    visits: audits.length,
    visitedBranches: branchMap.size,
    coordinators: coordMap.size,
    avg,
    coveragePct,
    gpsPct,
    yes,
    no,
    withGps,
    bands,
    byDay,
    pie: [
      { name: "A’lo", value: bands.excellent, color: "#10b981" },
      { name: "O‘rtacha", value: bands.mid, color: "#f59e0b" },
      { name: "Past", value: bands.low, color: "#f43f5e" },
    ].filter((p) => p.value > 0),
    byCoordinator,
    maxVisits: byCoordinator[0]?.visits ?? 0,
    categories,
    weakBranches,
    recent,
  };
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
  valueClass,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-3 shadow-sm">
      <div className={cn("mb-2 inline-flex rounded-lg p-1.5", tone)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("mt-0.5 text-xl font-bold tabular-nums text-slate-900 sm:text-2xl", valueClass)}>{value}</p>
      {hint ? <p className="text-[10px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

function StatusCard({
  title,
  items,
  total,
}: {
  title: string;
  items: { label: string; value: number; color: string; text: string }[];
  total: number;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-slate-100">
        {items.map((it) =>
          it.value <= 0 || total <= 0 ? null : (
            <div key={it.label} className={it.color} style={{ width: `${(it.value / total) * 100}%` }} />
          ),
        )}
      </div>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.label} className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-2 text-slate-600">
              <span className={cn("h-2 w-2 rounded-full", it.color)} />
              {it.label}
            </span>
            <span className={cn("font-semibold tabular-nums", it.text)}>{it.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">Hali ma’lumot yo‘q</div>
  );
}
