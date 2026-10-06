import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileDown,
  Layers,
  Lightbulb,
  Loader2,
  LogOut,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  Store,
  Sunrise,
  Timer,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  ChartColumn,
  ChartLine,
  ChartNoAxesCombined,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
import { useI18n } from "@/i18n/I18nProvider";
import { canViewDavomat, canViewFullDavomatDashboard, normalizeUserRole } from "@/lib/roles";
import {
  type DavomatAnalytics,
  type DavomatSegment,
  type AnalyticsRangePreset,
  addDaysYmd,
  rangeForPreset,
  tashkentTodayYmd,
  useDavomatAnalytics,
  usePrefetchDavomatRanges,
} from "@/lib/davomat-analytics-api";
import { cn } from "@/lib/utils";
import { useChartTheme } from "@/lib/chart-theme";
import { downloadDavomatAnalyticsPdf } from "@/lib/davomat-analytics-pdf";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type RangePreset = AnalyticsRangePreset | "custom";

const PRESET_BUTTONS: { key: AnalyticsRangePreset; labelKey: string }[] = [
  { key: "today", labelKey: "ui.today" },
  { key: "7d", labelKey: "davomat.days7" },
  { key: "30d", labelKey: "davomat.days30" },
  { key: "month", labelKey: "ui.month" },
];

const SEGMENT_OPTIONS: { key: DavomatSegment; labelKey: string; hintKey: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "office", labelKey: "davomat.segOffice", hintKey: "davomat.segOfficeHint", icon: Building2 },
  { key: "pharmacy", labelKey: "davomat.segPharm", hintKey: "davomat.segPharmHint", icon: Store },
  { key: "all", labelKey: "davomat.segAll", hintKey: "davomat.segAllHint", icon: Users },
];

const DASH_TXT = {
  uz: {
    updated: "Yangilandi",
    rate: "Davomat darajasi",
    target: "Maqsad",
    insights: "Asosiy xulosalar",
    avgArrival: "O‘rtacha kelish vaqti",
    earliest: "Eng erta",
    bestDept: "Eng yaxshi bo‘lim",
    bestBranch: "Eng yaxshi filial",
    attention: "E’tibor talab qiladi",
    mostLate: "Eng ko‘p kechikkan",
    noLate: "Kechikish yo‘q",
    noLateHint: "Davr davomida hech kim kechikmagan",
    came: "keldi",
    absentWord: "kelmagan",
    days: "kun",
    hours: "soat",
    employees: "xodim",
    attendance: "davomat",
    allHint: "Ofis va dorixona birgalikda",
    of: "dan",
    dayTitle: "Kunlik taqsimot",
    dayHint: "Dinamikani ko‘rish uchun davrni tanlang",
    dynLoading: "Dinamika yuklanmoqda",
    dynLoadingHint: "Tanlangan davr bo‘yicha kunlik ma’lumotlar hisoblanmoqda",
    periodFrom: "Boshlanish",
    periodTo: "Tugash",
    applyHint: "Sana tanlanishi bilan ma’lumot yangilanadi",
    shiftsCount: "ta smena",
    rolesCount: "ta lavozim",
    lateShort: "kech",
    personDays: "kun-kishi",
    office: "Ofis",
    pharmacy: "Dorixona",
    deptUnit: "ta bo‘lim",
    branchUnit: "ta filial",
    searchDept: "Bo‘lim qidirish…",
    searchBranch: "Filial qidirish…",
    sortRate: "Davomat",
    sortHead: "Xodim",
    sortAbsent: "Kelmagan",
    total: "Jami",
    toneGood: "A’lo",
    toneMid: "O‘rta",
    toneLow: "Past",
    nothingFound: "Hech narsa topilmadi",
  },
  ru: {
    updated: "Обновлено",
    rate: "Уровень посещаемости",
    target: "Цель",
    insights: "Ключевые выводы",
    avgArrival: "Среднее время прихода",
    earliest: "Раньше всех",
    bestDept: "Лучший отдел",
    bestBranch: "Лучший филиал",
    attention: "Требует внимания",
    mostLate: "Чаще всех опаздывает",
    noLate: "Опозданий нет",
    noLateHint: "За период никто не опоздал",
    came: "пришли",
    absentWord: "не пришли",
    days: "дн.",
    hours: "ч",
    employees: "сотр.",
    attendance: "посещ.",
    allHint: "Офис и аптеки вместе",
    of: "из",
    dayTitle: "Распределение за день",
    dayHint: "Выберите период, чтобы увидеть динамику",
    dynLoading: "Загрузка динамики",
    dynLoadingHint: "Считаем данные по дням за выбранный период",
    periodFrom: "Начало",
    periodTo: "Конец",
    applyHint: "Данные обновятся сразу после выбора даты",
    shiftsCount: "смен",
    rolesCount: "должностей",
    lateShort: "опозд.",
    personDays: "чел.-дн.",
    office: "Офис",
    pharmacy: "Аптека",
    deptUnit: "отделов",
    branchUnit: "филиалов",
    searchDept: "Поиск отдела…",
    searchBranch: "Поиск филиала…",
    sortRate: "Посещ.",
    sortHead: "Сотр.",
    sortAbsent: "Не пришли",
    total: "Итого",
    toneGood: "Отлично",
    toneMid: "Средне",
    toneLow: "Низко",
    nothingFound: "Ничего не найдено",
  },
};

function DayBreakdown({
  items,
  hint,
  actions,
}: {
  items: Array<{ label: string; value: number; color: string }>;
  hint: string;
  actions: React.ReactNode;
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div className="flex flex-col justify-center gap-5 py-1 xl:min-h-[300px]">
      <div className="grid grid-cols-3 gap-3">
        {items.map((i) => {
          const pct = total ? Math.round((i.value / total) * 1000) / 10 : 0;
          return (
            <div
              key={i.label}
              className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-700/50 dark:bg-slate-800/40"
            >
              <span className="absolute inset-y-0 left-0 w-1" style={{ background: i.color }} />
              <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ background: i.color }} />
                {i.label}
              </p>
              <p className="mt-2 text-[32px] font-extrabold leading-none tabular-nums">{i.value}</p>
              <p className="mt-1 text-xs font-semibold tabular-nums" style={{ color: i.color }}>
                {pct}%
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex h-3.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {items.map((i) =>
          i.value > 0 ? (
            <div
              key={i.label}
              className="h-full transition-all duration-700 first:rounded-l-full last:rounded-r-full"
              style={{ width: `${total ? (i.value / total) * 100 : 0}%`, background: i.color }}
              title={`${i.label}: ${i.value}`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-muted-foreground dark:bg-slate-800/50">
        <Activity className="h-4 w-4 text-[#0b3a5c] dark:text-sky-300" />
        <span>{hint}</span>
        {actions}
      </div>
    </div>
  );
}

function DynamicsLoading({ days, title, hint }: { days: number; title: string; hint: string }) {
  const count = Math.min(31, Math.max(7, days));
  return (
    <div className="relative h-[330px] overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-b from-slate-50/80 to-white px-4 pb-8 pt-6 dark:border-slate-700/50 dark:from-slate-800/40 dark:to-transparent">
      <div className="absolute inset-x-4 top-6 bottom-8 flex flex-col justify-between">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-px w-full border-t border-dashed border-slate-200 dark:border-slate-700/60" />
        ))}
      </div>
      <div className="relative flex h-full items-end justify-around gap-[3px] sm:gap-1.5">
        {Array.from({ length: count }, (_, i) => {
          const h = 38 + Math.round(Math.abs(Math.sin(i * 1.7 + 0.6)) * 48);
          return (
            <div key={i} className="flex h-full max-w-[36px] flex-1 flex-col justify-end gap-[2px]">
              <span
                className="w-full animate-pulse rounded-t-md bg-gradient-to-t from-emerald-400/45 to-emerald-300/20 dark:from-emerald-400/30 dark:to-emerald-300/10"
                style={{ height: `${h}%`, animationDelay: `${(i % 7) * 120}ms` }}
              />
              <span
                className="w-full animate-pulse rounded-b-sm bg-amber-300/40 dark:bg-amber-300/25"
                style={{ height: `${6 + (i % 3) * 3}%`, animationDelay: `${(i % 7) * 120 + 60}ms` }}
              />
            </div>
          );
        })}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-[0_12px_32px_-16px_rgba(15,39,68,0.35)] backdrop-blur dark:border-white/10 dark:bg-[#101a2e]/90">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-[#0f2744] text-white dark:bg-sky-500/20 dark:text-sky-300">
            <Activity className="h-4 w-4" />
            <span className="absolute inset-0 animate-ping rounded-xl bg-sky-400/25" />
          </span>
          <div className="leading-tight">
            <p className="flex items-center gap-1.5 text-sm font-bold text-[#0f2744] dark:text-white">
              {title}
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatLateHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0";
  const h = minutes / 60;
  if (h < 10) return h.toFixed(1).replace(/\.0$/, "");
  return String(Math.round(h * 10) / 10);
}

type TopLateRow = DavomatAnalytics["topLate"][number];
type RecentCheckinRow = DavomatAnalytics["recentCheckins"][number];
type DeptRow = DavomatAnalytics["byDepartment"][number];

function TopDisciplinedList({
  departments,
}: {
  departments: DavomatAnalytics["byDepartment"];
}) {
  const { t } = useI18n();
  const top = useMemo(() => {
    const rows: Array<{ id: number; fullName: string; position: string; attendanceRate: number }> = [];
    for (const d of departments) {
      for (const s of d.staff ?? []) {
        rows.push({
          id: s.id,
          fullName: s.fullName,
          position: s.position || d.name,
          attendanceRate: s.attendanceRate,
        });
      }
    }
    return rows
      .sort((a, b) => b.attendanceRate - a.attendanceRate || a.fullName.localeCompare(b.fullName))
      .slice(0, 5);
  }, [departments]);

  if (!top.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("ui.empty")}</p>;
  }

  const medals = [
    "bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 ring-amber-300/60",
    "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800 ring-slate-300/60",
    "bg-gradient-to-br from-orange-300 to-orange-500 text-orange-950 ring-orange-300/60",
  ];

  return (
    <div className="space-y-1">
      {top.map((r, i) => {
        const initials = (r.fullName || "?")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((p) => p[0]?.toUpperCase())
          .join("");
        return (
          <div key={r.id} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <span className="relative shrink-0">
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold ring-2 ring-offset-2 ring-offset-card",
                  medals[i] ?? "bg-[#0b3a5c]/10 text-[#0b3a5c] ring-transparent dark:bg-sky-400/10 dark:text-sky-300",
                )}
              >
                {initials}
              </span>
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-card text-[9px] font-extrabold text-foreground ring-1 ring-border">
                {i + 1}
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[13px] font-semibold">{r.fullName}</p>
                <span className={cn("shrink-0 text-[13px] font-extrabold tabular-nums", branchAttendanceTone(r.attendanceRate).text)}>
                  {r.attendanceRate}%
                </span>
              </div>
              <p className="truncate text-[11px] text-muted-foreground">{r.position}</p>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={cn("h-full rounded-full", branchAttendanceTone(r.attendanceRate).bar)}
                  style={{ width: `${Math.min(100, r.attendanceRate)}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

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

function DynamicsChartLegend({
  items,
}: {
  items: { color: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 pb-2 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function DynamicsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string; payload?: { fullDate?: string } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const fullDate = payload[0]?.payload?.fullDate;
  const title = fullDate
    ? (() => {
        const [y, m, d] = fullDate.split("-");
        return `${d}.${m}.${y}`;
      })()
    : label;
  const rows = payload.filter((p) => Number.isFinite(p.value));
  const unique: typeof rows = [];
  const seen = new Set<string>();
  for (const p of rows) {
    const key = String((p as { dataKey?: string }).dataKey ?? p.name ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  if (!unique.length) return null;
  return (
    <div className="rounded-xl bg-slate-900 px-3.5 py-2.5 text-xs text-white shadow-xl ring-1 ring-white/10">
      {title ? <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-100">{title}</p> : null}
      <div className="space-y-1.5">
        {unique.map((p) => (
          <div key={p.name} className="flex items-center gap-2 tabular-nums">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="text-slate-300">{p.name}:</span>
            <span className="font-semibold text-white">{p.value}</span>
          </div>
        ))}
      </div>
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
  progress,
  bar,
}: {
  title: string;
  value: string | number;
  sub?: string;
  delta?: number | null;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  loading?: boolean;
  progress?: number | null;
  bar?: string;
}) {
  const { t } = useI18n();
  if (loading) return <Skeleton className="analytics-kpi h-[132px]" />;
  return (
    <div className="analytics-kpi flex flex-col">
      <span className={cn("pointer-events-none absolute inset-x-0 top-0 h-[3px] opacity-80", bar ?? "bg-slate-300")} />
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", accent)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="mt-2 text-[30px] font-extrabold leading-none tracking-tight tabular-nums">{value}</p>
      {sub ? <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground">{sub}</p> : null}
      <div className="mt-auto pt-3">
        {progress != null ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={cn("h-full rounded-full transition-all duration-700", bar ?? "bg-slate-400")}
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        ) : null}
        {delta != null ? (
          <div
            className={cn(
              "mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
              delta >= 0
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
            )}
          >
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta >= 0 ? "+" : ""}
            {delta}% {t("davomat.vsPrev")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RateRing({ value, size = 76, stroke = 8, color }: { value: number; size?: number; stroke?: number; color: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, value));
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-100 dark:stroke-slate-800" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        stroke={color}
        strokeDasharray={c}
        strokeDashoffset={c - (pct / 100) * c}
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
    </svg>
  );
}

function rateColor(rate: number) {
  if (rate >= 85) return "#10b981";
  if (rate >= 70) return "#f59e0b";
  return "#ef4444";
}

function RateKpiCard({
  rate,
  target,
  label,
  targetLabel,
  loading,
}: {
  rate: number | null;
  target: number | null;
  label: string;
  targetLabel: string;
  loading?: boolean;
}) {
  if (loading) return <Skeleton className="analytics-kpi h-[132px]" />;
  const value = rate ?? 0;
  const color = rateColor(value);
  const gap = target != null && rate != null ? Math.round((rate - target) * 10) / 10 : null;
  return (
    <div className="analytics-kpi flex items-center gap-3">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-[3px] opacity-80" style={{ background: color }} />
      <div className="relative shrink-0">
        <RateRing value={value} size={70} stroke={7} color={color} />
        <span className="absolute inset-0 flex items-center justify-center text-[14px] font-extrabold tabular-nums">
          {rate != null ? `${value}%` : "—"}
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground" title={label}>{label}</p>
        {target != null ? (
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            {targetLabel}: <span className="font-semibold text-foreground">{target}%</span>
          </p>
        ) : null}
        {gap != null ? (
          <span
            className={cn(
              "mt-1.5 inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
              gap >= 0
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
            )}
          >
            {gap >= 0 ? "+" : ""}
            {gap}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

function branchAttendanceTone(rate: number) {
  if (rate >= 84) return { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" };
  if (rate >= 78) return { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" };
  return { bar: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" };
}

function BranchAttendanceList({
  rows,
  preview = 6,
  expanded,
  onToggleExpand,
  viewAllLabel,
}: {
  rows: Array<{ name: string; attendanceRate: number }>;
  preview?: number;
  expanded: boolean;
  onToggleExpand: () => void;
  viewAllLabel: string;
}) {
  const visible = expanded ? rows : rows.slice(0, preview);
  const canExpand = rows.length > preview;
  return (
    <div className="space-y-3">
      {visible.map((row) => {
        const tone = branchAttendanceTone(row.attendanceRate);
        const pct = Math.min(100, Math.max(0, row.attendanceRate));
        return (
          <div key={row.name} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
              <span className={cn("shrink-0 text-sm font-bold tabular-nums", tone.text)}>{row.attendanceRate}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/80">
              <div
                className={cn("h-full rounded-full transition-all duration-500", tone.bar)}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
      {canExpand && !expanded ? (
        <button
          type="button"
          onClick={onToggleExpand}
          className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-primary hover:underline"
        >
          {viewAllLabel}
          <ArrowRight className="h-4 w-4" />
        </button>
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
  id,
  icon: Icon,
  subtitle,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
  bodyClassName?: string;
  id?: string;
  icon?: React.ComponentType<{ className?: string }>;
  subtitle?: string;
}) {
  return (
    <div id={id} className={cn("analytics-panel", className)}>
      <div className="analytics-panel-header">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon ? (
            <span className="analytics-panel-icon">
              <Icon className="h-4 w-4" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="analytics-panel-title truncate">{title}</h3>
            {subtitle ? <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
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

function onTimeWindowLabel(expectedOpen: string, graceUntil: string, t: (k: string) => string) {
  if (graceUntil && graceUntil !== expectedOpen) {
    return `${t("davomat.normaUntil")}: ${expectedOpen}–${graceUntil}`;
  }
  return `${t("davomat.normaUntil")}: ${expectedOpen} ${t("davomat.normaTo")}`;
}

function staffStatusStyle(status: string) {
  if (status === "on_time" || status === "present") {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "late") return "bg-amber-500/15 text-amber-800 dark:text-amber-300";
  if (status === "leave") return "bg-violet-500/15 text-violet-700 dark:text-violet-300";
  if (status === "incomplete") return "bg-sky-500/15 text-sky-700 dark:text-sky-300";
  return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
}

type BranchOpening = DavomatAnalytics["branchOpenings"][number];

function BranchStaffDialog({
  branch,
  open,
  onOpenChange,
}: {
  branch: BranchOpening | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  if (!branch) return null;
  const staff = branch.staff ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-left text-base">{branch.branchName}</DialogTitle>
          <p className="text-left text-xs text-muted-foreground">
            {t("davomat.mudir")}: {branch.managerName} · {branch.shiftLabel} · {onTimeWindowLabel(branch.expectedOpen, branch.graceUntil, t)}
          </p>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {staff.length ? (
            <table className="analytics-table w-full text-sm">
              <thead>
                <tr>
                  <th>{t("ui.employee")}</th>
                  <th>{t("davomat.shift")}</th>
                  <th>{t("davomat.came")}</th>
                  <th>{t("davomat.btnOut")}</th>
                  <th>{t("ui.status")}</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <p className="font-medium leading-tight">{s.fullName}</p>
                      <p className="text-[10px] text-muted-foreground">{s.position}</p>
                    </td>
                    <td className="text-xs text-muted-foreground">{s.shiftLabel}</td>
                    <td className="tabular-nums font-medium">{s.checkIn || "—"}</td>
                    <td className="tabular-nums text-muted-foreground">{s.checkOut || "—"}</td>
                    <td>
                      <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", staffStatusStyle(s.status))}>
                        {s.statusLabel}
                        {s.lateMinutes > 0 ? ` (+${s.lateMinutes})` : ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("davomat.noStaffBranch")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BranchRow({ b, onSelect }: { b: BranchOpening; onSelect: (b: BranchOpening) => void }) {
  const { t } = useI18n();
  const opened = b.checkIn && b.checkIn !== "—" ? b.checkIn : null;
  const windowLabel = onTimeWindowLabel(b.expectedOpen, b.graceUntil, t);
  const statusCaption =
    b.status === "absent"
      ? t("davomat.notOpened")
      : b.status === "leave"
        ? b.statusLabel
        : b.status === "late"
          ? t("davomat.lateShort")
          : t("davomat.opened");

  return (
    <button
      type="button"
      onClick={() => onSelect(b)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition hover:brightness-110",
        branchStatusStyle(b.status),
      )}
    >
      <Store className="h-3.5 w-3.5 shrink-0 opacity-80" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold leading-tight">{b.branchName}</p>
        <p className="truncate text-[10px] leading-tight opacity-75">{b.managerName}</p>
        {(b.staff?.length ?? 0) > 1 ? (
          <p className="text-[9px] opacity-60">
            {b.staff.length} {t("davomat.staffDetail")}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 text-right leading-tight">
        <p className="text-[9px] font-medium uppercase tracking-wide opacity-60">{statusCaption}</p>
        {opened ? (
          <>
            <p className="text-sm font-bold tabular-nums">{opened}</p>
            <p className="text-[9px] tabular-nums opacity-60">{windowLabel}</p>
            {b.lateMinutes > 0 ? (
              <p className="text-[9px] font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                +{b.lateMinutes} {t("davomat.minShort")}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-xs font-semibold opacity-70">—</p>
            <p className="text-[9px] tabular-nums opacity-60">{windowLabel}</p>
          </>
        )}
      </div>
    </button>
  );
}

type BranchStatusTab = "on_time" | "late" | "absent";

function BranchStatusColumn({
  title,
  count,
  tone,
  items,
  empty,
  onSelectBranch,
}: {
  title: string;
  count: number;
  tone: "emerald" | "amber" | "rose";
  items: DavomatAnalytics["branchOpenings"];
  empty: string;
  onSelectBranch: (b: BranchOpening) => void;
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

  const ToneIcon = tone === "emerald" ? CheckCircle2 : tone === "amber" ? Clock : XCircle;
  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl border", toneClass)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2.5">
        <span className="flex items-center gap-2 text-xs font-bold">
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-lg", badgeClass)}>
            <ToneIcon className="h-3.5 w-3.5" />
          </span>
          {title}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-extrabold tabular-nums", badgeClass)}>{count}</span>
      </div>
      <div className="max-h-[220px] space-y-1 overflow-y-auto p-2">
        {items.length ? (
          items.map((b) => <BranchRow key={b.branchId} b={b} onSelect={onSelectBranch} />)
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
  const { t } = useI18n();
  const [tab, setTab] = useState<BranchStatusTab>("late");
  const [selectedBranch, setSelectedBranch] = useState<BranchOpening | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);

  const openBranchStaff = (b: BranchOpening) => {
    setSelectedBranch(b);
    setStaffOpen(true);
  };

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
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("ui.empty")}</p>;
  }

  const tabs: { key: BranchStatusTab; label: string; count: number; tone: "emerald" | "amber" | "rose"; items: DavomatAnalytics["branchOpenings"]; empty: string }[] = [
    { key: "on_time", label: t("davomat.onTime"), count: summary.onTime, tone: "emerald", items: grouped.onTime, empty: t("davomat.emptyOnTime") },
    { key: "late", label: t("davomat.lateShort"), count: summary.late, tone: "amber", items: grouped.late, empty: t("davomat.emptyLate") },
    { key: "absent", label: t("davomat.notOpened"), count: summary.absent + summary.leave, tone: "rose", items: grouped.absent, empty: t("davomat.emptyAllOpen") },
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
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              className={cn(
                "rounded-lg px-2 py-1 text-[11px] font-semibold transition",
                tab === tb.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {tb.label} ({tb.count})
            </button>
          ))}
        </div>
      </div>
      {!openings.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("davomat.noMudirBranch")}</p>
      ) : (
        <>
          <div className="hidden gap-3 md:grid md:grid-cols-3">
            {tabs.map((tb) => (
              <BranchStatusColumn
                key={tb.key}
                title={tb.label}
                count={tb.count}
                tone={tb.tone}
                items={tb.items}
                empty={tb.empty}
                onSelectBranch={openBranchStaff}
              />
            ))}
          </div>
          <div className="md:hidden">
            {tabs
              .filter((tb) => tb.key === tab)
              .map((tb) => (
                <BranchStatusColumn
                  key={tb.key}
                  title={tb.label}
                  count={tb.count}
                  tone={tb.tone}
                  items={tb.items}
                  empty={tb.empty}
                  onSelectBranch={openBranchStaff}
                />
              ))}
          </div>
          <BranchStaffDialog branch={selectedBranch} open={staffOpen} onOpenChange={setStaffOpen} />
        </>
      )}
    </div>
  );
}

type OfficeDayItem = DavomatAnalytics["officeDayBoard"][number];

type DayTone = "emerald" | "amber" | "rose";

const DAY_TONE: Record<
  DayTone,
  { solid: string; soft: string; text: string; bar: string; avatar: string; icon: React.ComponentType<{ className?: string }> }
> = {
  emerald: {
    solid: "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/30",
    soft: "bg-emerald-50/70 ring-emerald-200/70 dark:bg-emerald-500/[0.06] dark:ring-emerald-500/20",
    text: "text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500",
    avatar: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  amber: {
    solid: "bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/30",
    soft: "bg-amber-50/70 ring-amber-200/70 dark:bg-amber-500/[0.06] dark:ring-amber-500/20",
    text: "text-amber-600 dark:text-amber-400",
    bar: "bg-amber-500",
    avatar: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    icon: Clock,
  },
  rose: {
    solid: "bg-gradient-to-br from-rose-500 to-pink-600 shadow-rose-500/30",
    soft: "bg-rose-50/70 ring-rose-200/70 dark:bg-rose-500/[0.06] dark:ring-rose-500/20",
    text: "text-rose-600 dark:text-rose-400",
    bar: "bg-rose-500",
    avatar: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    icon: XCircle,
  },
};

function personInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function formatLateMinutes(min: number, t: (k: string) => string) {
  if (min < 60) return `${min} ${t("davomat.minShort")}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ${t("davomat.hourShort")} ${m} ${t("davomat.minShort")}` : `${h} ${t("davomat.hourShort")}`;
}

type BreakdownItem = {
  name: string;
  headcount: number;
  present: number;
  late: number;
  absent: number;
  attendanceRate: number;
};
type BreakdownSort = "rate" | "head" | "absent";
type RateToneKey = "good" | "mid" | "low";

const RATE_TONE: Record<RateToneKey, { bar: string; text: string; avatar: string; dot: string }> = {
  good: {
    bar: "bg-gradient-to-r from-emerald-400 to-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    avatar: "from-emerald-500 to-teal-500",
    dot: "bg-emerald-500",
  },
  mid: {
    bar: "bg-gradient-to-r from-amber-300 to-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    avatar: "from-amber-400 to-orange-500",
    dot: "bg-amber-500",
  },
  low: {
    bar: "bg-gradient-to-r from-rose-400 to-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    avatar: "from-rose-500 to-pink-500",
    dot: "bg-rose-500",
  },
};

function rateToneKey(rate: number): RateToneKey {
  if (rate >= 85) return "good";
  if (rate >= 70) return "mid";
  return "low";
}

const COUNT_TONE = {
  present: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  late: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  absent: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
} as const;

function CountPill({ value, tone }: { value: number; tone: keyof typeof COUNT_TONE }) {
  if (!value) return <span className="tabular-nums text-muted-foreground/50">0</span>;
  return (
    <span className={cn("inline-flex min-w-[2rem] justify-center rounded-md px-2 py-0.5 text-[13px] font-semibold tabular-nums", COUNT_TONE[tone])}>
      {value}
    </span>
  );
}

function RateBar({ rate }: { rate: number }) {
  const tone = RATE_TONE[rateToneKey(rate)];
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
        <div className={cn("h-full rounded-full transition-all duration-700", tone.bar)} style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} />
      </div>
      <span className={cn("w-12 text-right text-[13px] font-bold tabular-nums", tone.text)}>{rate}%</span>
    </div>
  );
}

function BreakdownTable<T extends BreakdownItem>({
  rows,
  isBranch,
  onSelect,
  X,
  t,
}: {
  rows: T[];
  isBranch: boolean;
  onSelect: (row: T) => void;
  X: typeof DASH_TXT.uz;
  t: (k: string) => string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<BreakdownSort>("rate");

  const toneCounts = useMemo(() => {
    const out: Record<RateToneKey, number> = { good: 0, mid: 0, low: 0 };
    for (const r of rows) if (r.headcount > 0) out[rateToneKey(r.attendanceRate)] += 1;
    return out;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : [...rows];
    list.sort((a, b) => {
      if (sort === "head") return b.headcount - a.headcount || b.attendanceRate - a.attendanceRate;
      if (sort === "absent") return b.absent - a.absent || a.attendanceRate - b.attendanceRate;
      return b.attendanceRate - a.attendanceRate || b.headcount - a.headcount;
    });
    return list;
  }, [rows, query, sort]);

  const totals = useMemo(() => {
    const sum = { headcount: 0, present: 0, late: 0, absent: 0, weighted: 0 };
    for (const r of visible) {
      sum.headcount += r.headcount;
      sum.present += r.present;
      sum.late += r.late;
      sum.absent += r.absent;
      sum.weighted += r.attendanceRate * r.headcount;
    }
    const rate = sum.headcount ? Math.round((sum.weighted / sum.headcount) * 10) / 10 : 0;
    return { ...sum, rate };
  }, [visible]);

  const sortOptions: Array<{ key: BreakdownSort; label: string }> = [
    { key: "rate", label: X.sortRate },
    { key: "head", label: X.sortHead },
    { key: "absent", label: X.sortAbsent },
  ];
  const toneLegend: Array<{ key: RateToneKey; label: string; hint: string }> = [
    { key: "good", label: X.toneGood, hint: "≥85%" },
    { key: "mid", label: X.toneMid, hint: "70–85%" },
    { key: "low", label: X.toneLow, hint: "<70%" },
  ];

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between dark:border-slate-700/60">
        <div className="flex flex-wrap items-center gap-1.5">
          {toneLegend.map((tone) => (
            <span
              key={tone.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[11.5px] dark:border-slate-700/60 dark:bg-slate-800/40"
              title={tone.hint}
            >
              <span className={cn("h-2 w-2 rounded-full", RATE_TONE[tone.key].dot)} />
              <span className="text-muted-foreground">{tone.label}</span>
              <b className="tabular-nums text-foreground">{toneCounts[tone.key]}</b>
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isBranch ? X.searchBranch : X.searchDept}
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <div className="inline-flex rounded-lg border border-border/70 bg-muted/40 p-0.5 dark:border-slate-700/60 dark:bg-slate-800/50">
            {sortOptions.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setSort(o.key)}
                className={cn(
                  "flex-1 rounded-md px-2.5 py-1 text-[12px] font-medium transition sm:flex-none",
                  sort === o.key
                    ? "bg-background text-foreground shadow-sm dark:bg-slate-700"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Search className="h-5 w-5 opacity-50" />
          {X.nothingFound}
        </div>
      ) : (
        <>
          <div className="hidden max-h-[560px] overflow-auto sm:block">
            <table className="analytics-table analytics-table--pin w-full min-w-[680px] table-fixed text-sm">
              <colgroup>
                <col className="w-12" />
                <col />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[11%]" />
                <col className="w-[24%]" />
                <col className="w-9" />
              </colgroup>
              <thead>
                <tr>
                  <th className="!text-center">#</th>
                  <th className="!text-left">{isBranch ? t("davomat.colBranch") : t("ui.department")}</th>
                  <th className="!text-center">{t("ui.employee")}</th>
                  <th className="!text-center">{t("davomat.arrived")}</th>
                  <th className="!text-center">{t("davomat.lateShort")}</th>
                  <th className="!text-center">{t("davomat.absent")}</th>
                  <th className="!text-left">{t("davomat.chartAtt")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((d, i) => {
                  const tone = RATE_TONE[rateToneKey(d.attendanceRate)];
                  return (
                    <tr key={d.name} className="group cursor-pointer hover:!bg-primary/5" onClick={() => onSelect(d)}>
                      <td className="text-center text-[12px] font-semibold tabular-nums text-muted-foreground">{i + 1}</td>
                      <td>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[11px] font-bold text-white shadow-sm",
                              tone.avatar,
                            )}
                          >
                            {personInitials(d.name)}
                          </span>
                          <span className="truncate font-medium text-foreground group-hover:text-primary">{d.name}</span>
                        </div>
                      </td>
                      <td className="text-center font-semibold tabular-nums">{d.headcount}</td>
                      <td className="text-center"><CountPill value={d.present} tone="present" /></td>
                      <td className="text-center"><CountPill value={d.late} tone="late" /></td>
                      <td className="text-center"><CountPill value={d.absent} tone="absent" /></td>
                      <td><RateBar rate={d.attendanceRate} /></td>
                      <td className="text-center">
                        <ChevronRight className="mx-auto h-4 w-4 text-muted-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="text-[13px] font-semibold">
                  <td className="sticky bottom-0 border-t border-border bg-slate-50 dark:border-slate-700 dark:bg-slate-900" />
                  <td className="sticky bottom-0 border-t border-border bg-slate-50 text-foreground dark:border-slate-700 dark:bg-slate-900">
                    {X.total}
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      {visible.length} {isBranch ? X.branchUnit : X.deptUnit}
                    </span>
                  </td>
                  <td className="sticky bottom-0 border-t border-border bg-slate-50 text-center tabular-nums dark:border-slate-700 dark:bg-slate-900">{totals.headcount}</td>
                  <td className="sticky bottom-0 border-t border-border bg-slate-50 text-center tabular-nums text-emerald-600 dark:border-slate-700 dark:bg-slate-900 dark:text-emerald-400">{totals.present}</td>
                  <td className="sticky bottom-0 border-t border-border bg-slate-50 text-center tabular-nums text-amber-600 dark:border-slate-700 dark:bg-slate-900 dark:text-amber-400">{totals.late}</td>
                  <td className="sticky bottom-0 border-t border-border bg-slate-50 text-center tabular-nums text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-rose-400">{totals.absent}</td>
                  <td className="sticky bottom-0 border-t border-border bg-slate-50 dark:border-slate-700 dark:bg-slate-900"><RateBar rate={totals.rate} /></td>
                  <td className="sticky bottom-0 border-t border-border bg-slate-50 dark:border-slate-700 dark:bg-slate-900" />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="max-h-[560px] divide-y divide-border/70 overflow-auto sm:hidden dark:divide-slate-700/60">
            {visible.map((d, i) => {
              const tone = RATE_TONE[rateToneKey(d.attendanceRate)];
              return (
                <button
                  key={d.name}
                  type="button"
                  onClick={() => onSelect(d)}
                  className="flex w-full flex-col gap-2 px-4 py-3 text-left transition active:bg-primary/5"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-[11px] font-bold text-white",
                        tone.avatar,
                      )}
                    >
                      {personInitials(d.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        <span className="mr-1 text-muted-foreground">{i + 1}.</span>
                        {d.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {d.headcount} {X.employees}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                  </div>
                  <RateBar rate={d.attendanceRate} />
                  <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">{t("davomat.arrived")} <CountPill value={d.present} tone="present" /></span>
                    <span className="inline-flex items-center gap-1">{t("davomat.lateShort")} <CountPill value={d.late} tone="late" /></span>
                    <span className="inline-flex items-center gap-1">{t("davomat.absent")} <CountPill value={d.absent} tone="absent" /></span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function OfficeDayRow({ item, tone }: { item: OfficeDayItem; tone: DayTone }) {
  const { t } = useI18n();
  const opened = item.checkIn && item.checkIn !== "—" ? item.checkIn : null;
  const norma =
    item.graceUntil && item.graceUntil !== item.expectedOpen
      ? `${item.expectedOpen}–${item.graceUntil}`
      : item.expectedOpen;
  const sub = [item.departmentName, item.position].filter(Boolean).join(" · ");
  const style = DAY_TONE[tone];

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/80 bg-white px-2.5 py-2 shadow-[0_1px_2px_rgb(15_39_68/0.05)] transition hover:-translate-y-px hover:shadow-md dark:border-slate-700/50 dark:bg-slate-900/70">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
          style.avatar,
        )}
      >
        {personInitials(item.fullName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold leading-tight text-foreground" title={item.fullName}>
          {item.fullName}
        </p>
        <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground" title={sub}>
          {sub || "—"}
        </p>
      </div>
      <div className="shrink-0 text-right" title={onTimeWindowLabel(item.expectedOpen, item.graceUntil, t)}>
        {opened ? (
          <p className={cn("text-[15px] font-extrabold leading-none tabular-nums", style.text)}>{opened}</p>
        ) : item.status === "leave" ? (
          <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
            {item.statusLabel}
          </span>
        ) : null}
        {item.lateMinutes > 0 ? (
          <p className="mt-1 text-[10px] font-bold tabular-nums text-amber-600 dark:text-amber-400">
            +{formatLateMinutes(item.lateMinutes, t)}
          </p>
        ) : (
          <p
            className={cn(
              "inline-flex items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground",
              (opened || item.status === "leave") && "mt-1",
            )}
          >
            <Clock className="h-2.5 w-2.5" />
            {norma}
          </p>
        )}
      </div>
    </div>
  );
}

function OfficeDayColumn({
  title,
  count,
  total,
  tone,
  items,
  empty,
}: {
  title: string;
  count: number;
  total: number;
  tone: DayTone;
  items: OfficeDayItem[];
  empty: string;
}) {
  const style = DAY_TONE[tone];
  const Icon = style.icon;
  const pct = total ? Math.round((count * 100) / total) : 0;
  return (
    <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-2xl ring-1", style.soft)}>
      <div className="flex items-center gap-2.5 px-3 pb-2 pt-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md", style.solid)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold leading-tight text-foreground">{title}</p>
          <p className="text-[10.5px] font-medium tabular-nums text-muted-foreground">
            {count} / {total} · {pct}%
          </p>
        </div>
        <span className={cn("text-2xl font-extrabold leading-none tabular-nums", style.text)}>{count}</span>
      </div>
      <div className="mx-3 mb-2.5 h-1.5 overflow-hidden rounded-full bg-white dark:bg-slate-800">
        <div className={cn("h-full rounded-full transition-all duration-500", style.bar)} style={{ width: `${pct}%` }} />
      </div>
      <div className="h-[340px] space-y-1.5 overflow-y-auto px-2.5 pb-2.5">
        {items.length ? (
          items.map((item) => <OfficeDayRow key={item.employeeId} item={item} tone={tone} />)
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-full bg-white dark:bg-slate-800", style.text)}>
              <Icon className="h-5 w-5" />
            </span>
            <p className="max-w-[180px] text-[11px] text-muted-foreground">{empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function OfficeDayPanel({
  items,
  summary,
  loading,
  rangeLabel,
}: {
  items: DavomatAnalytics["officeDayBoard"];
  summary: DavomatAnalytics["officeDaySummary"];
  loading?: boolean;
  rangeLabel?: string;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<BranchStatusTab>("late");

  const grouped = useMemo(() => {
    const onTime = items.filter((b) => b.status === "on_time");
    const late = items.filter((b) => b.status === "late");
    const absent = items.filter((b) => b.status === "absent" || b.status === "leave");
    return { onTime, late, absent };
  }, [items]);

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
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("ui.empty")}</p>;
  }

  const tabs: {
    key: BranchStatusTab;
    label: string;
    count: number;
    tone: "emerald" | "amber" | "rose";
    items: OfficeDayItem[];
    empty: string;
  }[] = [
    {
      key: "on_time",
      label: t("davomat.onTime"),
      count: summary.onTime,
      tone: "emerald",
      items: grouped.onTime,
      empty: t("davomat.emptyOfficeOnTime"),
    },
    {
      key: "late",
      label: t("davomat.lateShort"),
      count: summary.late,
      tone: "amber",
      items: grouped.late,
      empty: t("davomat.emptyOfficeLate"),
    },
    {
      key: "absent",
      label: t("davomat.absent"),
      count: summary.absent + summary.leave,
      tone: "rose",
      items: grouped.absent,
      empty: t("davomat.emptyOfficeAbsent"),
    },
  ];

  const total = tabs.reduce((s, tb) => s + tb.count, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <CalendarDays className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
            {formatYmdUz(summary.date)}
          </span>
          {rangeLabel ? <span>{rangeLabel}</span> : null}
          <span className="truncate">{t("davomat.officeDayHint")}</span>
        </div>
        {total ? (
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100 sm:w-48 dark:bg-slate-800">
            {tabs.map((tb) =>
              tb.count ? (
                <div
                  key={tb.key}
                  className={cn("h-full transition-all duration-500", DAY_TONE[tb.tone].bar)}
                  style={{ width: `${(tb.count * 100) / total}%` }}
                  title={`${tb.label}: ${tb.count}`}
                />
              ) : null,
            )}
          </div>
        ) : null}
      </div>
      {!items.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("davomat.noOfficeStaff")}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 md:hidden dark:bg-slate-800/70">
            {tabs.map((tb) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition",
                  tab === tb.key
                    ? "bg-white text-foreground shadow-sm dark:bg-slate-900"
                    : "text-muted-foreground",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", DAY_TONE[tb.tone].bar)} />
                {tb.label}
                <span className="tabular-nums opacity-70">{tb.count}</span>
              </button>
            ))}
          </div>
          <div className="hidden gap-3 md:grid md:grid-cols-3">
            {tabs.map((tb) => (
              <OfficeDayColumn
                key={tb.key}
                title={tb.label}
                count={tb.count}
                total={total}
                tone={tb.tone}
                items={tb.items}
                empty={tb.empty}
              />
            ))}
          </div>
          <div className="md:hidden">
            {tabs
              .filter((tb) => tb.key === tab)
              .map((tb) => (
                <OfficeDayColumn
                  key={tb.key}
                  title={tb.label}
                  count={tb.count}
                  total={total}
                  tone={tb.tone}
                  items={tb.items}
                  empty={tb.empty}
                />
              ))}
          </div>
        </>
      )}
    </div>
  );
}

export function DavomatAnalyticsDashboard({
  embedded = false,
  bare = false,
  initialSegment = "office",
}: {
  embedded?: boolean;
  bare?: boolean;
  initialSegment?: DavomatSegment;
}) {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const X = locale === "ru" ? DASH_TXT.ru : DASH_TXT.uz;
  const search = useSearch();
  const fullDash = canViewFullDavomatDashboard(user?.role);
  const pharmacyScope = normalizeUserRole(user?.role) === "koordinator";
  const segmentFromUrl = useMemo(() => {
    if (pharmacyScope) return "pharmacy" as DavomatSegment;
    if (!fullDash) return "all" as DavomatSegment;
    if (embedded) return initialSegment;
    const seg = new URLSearchParams(search).get("segment");
    if (seg === "office" || seg === "pharmacy" || seg === "all") return seg;
    return "office";
  }, [embedded, initialSegment, search, fullDash, pharmacyScope]);
  const [preset, setPreset] = useState<RangePreset>("today");
  const [dynamicsChart, setDynamicsChart] = useState<"line" | "bar" | "both">("both");
  const [customFrom, setCustomFrom] = useState(() => addDaysYmd(tashkentTodayYmd(), -6));
  const [customTo, setCustomTo] = useState(() => tashkentTodayYmd());
  const [segment, setSegment] = useState<DavomatSegment>(segmentFromUrl);
  const [latePerson, setLatePerson] = useState<TopLateRow | null>(null);
  const [arrivalPerson, setArrivalPerson] = useState<RecentCheckinRow | null>(null);
  const [deptRow, setDeptRow] = useState<DeptRow | null>(null);
  const [branchListExpanded, setBranchListExpanded] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const { toast } = useToast();
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
  const { data, isLoading, isFetching, isPlaceholderData, isError, error, refetchFresh, dataUpdatedAt } = useDavomatAnalytics(
    { ...range, segment },
    true,
  );
  const prefetchPreset = usePrefetchDavomatRanges(segment, !!data && !isPlaceholderData);
  const dynamicsPending = isPlaceholderData && range.from !== range.to;
  const chart = useChartTheme();
  const fillId = embedded ? "presentFillDash" : "presentFillPage";

  /** Ofis doskasi (Vaqtida/Kech/Kelmagan) — asosiy manba */
  const officeShare = useMemo(() => {
    const s = data?.officeDaySummary;
    if (s) {
      return {
        date: s.date,
        onTime: s.onTime,
        late: s.late,
        absent: s.absent,
      };
    }
    const board = data?.officeDayBoard ?? [];
    if (!board.length) return null;
    return {
      date: board[0]!.date,
      onTime: board.filter((b) => b.status === "on_time").length,
      late: board.filter((b) => b.status === "late").length,
      absent: board.filter((b) => b.status === "absent").length,
    };
  }, [data?.officeDaySummary, data?.officeDayBoard]);

  /** Ulush va dinamika — ofis doskasi + kunlik trend (bir xil) */
  const shareByDay = useMemo(() => {
    const days = (data?.dailyTrend ?? []).map((d) => ({
      date: d.date,
      label: d.label,
      onTime: Math.max(0, d.present - d.late),
      late: d.late,
      absent: d.absent,
    }));

    // Oxirgi / doska kuni — aniq ofis davomatidan
    if (officeShare) {
      const label =
        days.find((d) => d.date === officeShare.date)?.label ??
        officeShare.date.slice(8, 10) + "." + officeShare.date.slice(5, 7);
      const patched = {
        date: officeShare.date,
        label,
        onTime: officeShare.onTime,
        late: officeShare.late,
        absent: officeShare.absent,
      };
      const idx = days.findIndex((d) => d.date === officeShare.date);
      if (idx >= 0) days[idx] = patched;
      else days.push(patched);
    }

    return days;
  }, [data?.dailyTrend, officeShare]);

  const pieData = useMemo(() => {
    let onTime = 0;
    let late = 0;
    let absent = 0;

    // Bugun / bitta kun yoki ofis doskasi bor — shu aniq sonlar
    if (officeShare && (range.from === range.to || range.to === officeShare.date)) {
      onTime = officeShare.onTime;
      late = officeShare.late;
      absent = officeShare.absent;
    } else if (range.from === range.to) {
      const day =
        shareByDay.find((d) => d.date === range.to) ?? shareByDay[shareByDay.length - 1];
      if (day) {
        onTime = day.onTime;
        late = day.late;
        absent = day.absent;
      }
    } else if (shareByDay.length) {
      for (const d of shareByDay) {
        onTime += d.onTime;
        late += d.late;
        absent += d.absent;
      }
    }

    return [
      { name: t("davomat.onTime"), value: onTime, fill: "#22c55e" },
      { name: t("davomat.lateShort"), value: late, fill: "#eab308" },
      { name: t("davomat.absent"), value: absent, fill: "#ef4444" },
    ].filter((s) => s.value > 0);
  }, [officeShare, shareByDay, range.from, range.to, t]);

  const shareTitle =
    officeShare && (range.from === range.to || range.to === officeShare.date)
      ? t("davomat.attShareToday")
      : range.from === range.to
        ? t("davomat.attShareToday")
        : t("davomat.attSharePeriod");

  /** Tanlangan filtr bo‘yicha barcha kunlar (7/30/oy — to‘liq) */
  const dynamicsData = useMemo(() => {
    return shareByDay.map((d) => ({
      label: d.label,
      fullDate: d.date,
      arrived: d.onTime,
      late: d.late,
      absent: d.absent,
    }));
  }, [shareByDay]);

  const dynamicsTickInterval = dynamicsData.length > 16 ? Math.ceil(dynamicsData.length / 10) - 1 : 0;
  const dynamicsShowDots = dynamicsData.length <= 14;
  const isPharmacySegment = segment === "pharmacy";
  const branchBreakdown = useMemo(
    () => [...(data?.byBranch ?? [])].sort((a, b) => b.attendanceRate - a.attendanceRate),
    [data?.byBranch],
  );
  const deptBreakdown = useMemo(
    () => [...(data?.byDepartment ?? [])].sort((a, b) => b.attendanceRate - a.attendanceRate),
    [data?.byDepartment],
  );
  const breakdownRows = isPharmacySegment ? branchBreakdown : deptBreakdown;

  useEffect(() => {
    setBranchListExpanded(false);
  }, [segment, range.from, range.to]);

  const dynamicsLegendItems = useMemo(
    () => [
      { color: "#22c55e", label: t("davomat.onTime") },
      { color: "#eab308", label: t("davomat.lateShort") },
      { color: "#ef4444", label: t("davomat.absent") },
    ],
    [t],
  );

  const headcount = data?.kpis.headcount ?? 0;
  const arrivedNow = officeShare ? officeShare.onTime + officeShare.late : (data?.today?.present ?? null);
  const lateNow = officeShare?.late ?? data?.today?.late ?? null;
  const absentNow = officeShare?.absent ?? data?.today?.absent ?? null;
  const earlyNow = data?.today?.incomplete ?? data?.kpis.incompletePersonDays ?? null;
  const dayBase = officeShare ? officeShare.onTime + officeShare.late + officeShare.absent : headcount;
  const pctOf = (n: number | null) =>
    n != null && dayBase > 0 ? Math.round((n / dayBase) * 1000) / 10 : null;
  const attRate =
    range.from === range.to && arrivedNow != null && dayBase > 0
      ? pctOf(arrivedNow)
      : (data?.kpis.attendanceRate ?? data?.today?.attendanceRate ?? null);

  const updatedAt = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })
    : "—";
  const rangeText = range.from === range.to ? formatYmdUz(range.from) : `${formatYmdUz(range.from)} — ${formatYmdUz(range.to)}`;

  const segmentStats = (key: DavomatSegment) => {
    const s = data?.segments;
    if (!s) return null;
    if (key === "office") return s.office;
    if (key === "pharmacy") return s.pharmacy;
    const hc = s.office.headcount + s.pharmacy.headcount;
    if (!hc) return { headcount: 0, attendanceRate: 0 };
    const rate =
      (s.office.attendanceRate * s.office.headcount + s.pharmacy.attendanceRate * s.pharmacy.headcount) / hc;
    return { headcount: hc, attendanceRate: Math.round(rate * 10) / 10 };
  };

  const insights = useMemo(() => {
    if (!data) return [];
    const out: Array<{
      key: string;
      icon: React.ComponentType<{ className?: string }>;
      tone: string;
      label: string;
      value: string;
      hint: string;
    }> = [];

    const arrivals = (data.officeDayBoard ?? [])
      .filter((b) => b.status === "on_time" || b.status === "late")
      .map((b) => {
        const m = /^(\d{1,2}):(\d{2})/.exec(b.checkIn ?? "");
        return m ? { name: b.fullName, time: b.checkIn as string, min: Number(m[1]) * 60 + Number(m[2]) } : null;
      })
      .filter((x): x is { name: string; time: string; min: number } => !!x);
    if (arrivals.length) {
      const avg = Math.round(arrivals.reduce((s, a) => s + a.min, 0) / arrivals.length);
      const earliest = arrivals.reduce((a, b) => (b.min < a.min ? b : a));
      out.push({
        key: "avg",
        icon: Timer,
        tone: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
        label: X.avgArrival,
        value: `${String(Math.floor(avg / 60)).padStart(2, "0")}:${String(avg % 60).padStart(2, "0")}`,
        hint: `${X.earliest}: ${earliest.name} · ${earliest.time}`,
      });
    }

    const rows = breakdownRows.filter((r) => r.headcount > 0);
    if (rows.length) {
      const best = rows[0]!;
      out.push({
        key: "best",
        icon: Award,
        tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
        label: isPharmacySegment ? X.bestBranch : X.bestDept,
        value: best.name,
        hint: `${best.attendanceRate}% · ${best.present}/${best.headcount} ${X.came}`,
      });
      const worst = rows[rows.length - 1]!;
      if (rows.length > 1 && worst.attendanceRate < best.attendanceRate) {
        out.push({
          key: "worst",
          icon: AlertTriangle,
          tone: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
          label: X.attention,
          value: worst.name,
          hint: `${worst.attendanceRate}% · ${worst.absent} ${X.absentWord}`,
        });
      }
    }

    const topLate = data.topLate?.[0];
    out.push(
      topLate
        ? {
            key: "late",
            icon: Clock,
            tone: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
            label: X.mostLate,
            value: topLate.fullName,
            hint: `${topLate.lateDays} ${X.days} · ${formatLateHours(topLate.lateMinutes)} ${X.hours}`,
          }
        : {
            key: "late",
            icon: CheckCircle2,
            tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
            label: X.mostLate,
            value: X.noLate,
            hint: X.noLateHint,
          },
    );
    return out.slice(0, 4);
  }, [data, breakdownRows, isPharmacySegment, X]);

  const onExportDashboardPdf = async () => {
    if (exportingPdf || !data) return;
    setExportingPdf(true);
    toast({
      title: t("davomat.dashPdfPreparing"),
      description: t("davomat.dashPdfPreparingHint"),
    });
    try {
      const segLabel =
        segment === "office"
          ? t("davomat.segOffice")
          : segment === "pharmacy"
            ? t("davomat.segPharm")
            : t("davomat.segAll");
      const presetLabel =
        preset === "today"
          ? t("ui.today")
          : preset === "7d"
            ? t("davomat.days7")
            : preset === "30d"
              ? t("davomat.days30")
              : preset === "month"
                ? t("ui.month")
                : t("davomat.period");
      const officeBoard = data.officeDayBoard ?? [];
      const openings = data.branchOpenings ?? [];

      await downloadDavomatAnalyticsPdf({
        title: `VAKSINA MED — ${t("davomat.analyticsShort")}`,
        subtitle: `${data.from} — ${data.to}`,
        filterLine: `${segLabel} · ${presetLabel} · ${user?.fullName || ""}`.trim(),
        fileBase: `davomat_dashboard_${segment}_${data.from}_${data.to}`,
        singleDay: data.from === data.to,
        kpis: [
          { label: t("davomat.totalStaff"), value: String(data.kpis.headcount) },
          {
            label: t("davomat.todayArrived"),
            value: String(
              officeShare ? officeShare.onTime + officeShare.late : data.today?.present ?? "—",
            ),
            sub: officeShare
              ? `${officeShare.onTime} ${t("davomat.onTime")} · ${officeShare.late} ${t("davomat.lateShort")}`
              : undefined,
          },
          { label: t("davomat.todayLate"), value: String(officeShare?.late ?? data.today?.late ?? "—") },
          { label: t("davomat.todayAbsent"), value: String(officeShare?.absent ?? data.today?.absent ?? "—") },
          {
            label: t("davomat.todayEarlyOut"),
            value: String(data.today?.incomplete ?? data.kpis.incompletePersonDays ?? "—"),
          },
        ],
        share: {
          onTime: pieData.find((p) => p.fill === "#22c55e")?.value ?? officeShare?.onTime ?? 0,
          late: pieData.find((p) => p.fill === "#eab308")?.value ?? officeShare?.late ?? 0,
          absent: pieData.find((p) => p.fill === "#ef4444")?.value ?? officeShare?.absent ?? 0,
        },
        shareTitle,
        dynamics: dynamicsData.map((d) => ({
          date: d.fullDate,
          label: d.label,
          onTime: d.arrived,
          late: d.late,
          absent: d.absent,
        })),
        branches: breakdownRows.map((b) => ({
          name: b.name,
          attendanceRate: b.attendanceRate,
          headcount: b.headcount,
          present: b.present,
          late: b.late,
          absent: b.absent,
        })),
        branchTitle: isPharmacySegment ? t("davomat.byBranchPharm") : t("davomat.byBranch"),
        shifts: (data.byShift ?? []).map((s) => ({
          name: s.label,
          attendanceRate: s.attendanceRate,
          headcount: s.headcount,
        })),
        roles: (data.byRole ?? []).map((r) => ({
          name: r.label,
          attendanceRate: r.attendanceRate,
          headcount: r.headcount,
          late: r.late,
        })),
        officeTitle: segment === "office" ? t("davomat.officeDay") : undefined,
        officeOnTime: officeBoard
          .filter((b) => b.status === "on_time")
          .map((b) => ({
            fullName: b.fullName,
            meta: b.departmentName || b.position,
            checkIn: b.checkIn,
            status: b.statusLabel,
          })),
        officeLate: officeBoard
          .filter((b) => b.status === "late")
          .map((b) => ({
            fullName: b.fullName,
            meta: b.departmentName || b.position,
            checkIn: b.checkIn,
            status: b.statusLabel,
            lateMinutes: b.lateMinutes,
          })),
        officeAbsent: officeBoard
          .filter((b) => b.status === "absent" || b.status === "leave")
          .map((b) => ({
            fullName: b.fullName,
            meta: b.departmentName || b.position,
            checkIn: b.checkIn,
            status: b.statusLabel,
          })),
        branchOpenTitle: segment !== "office" ? t("davomat.branchOpen") : undefined,
        branchOpenings: openings.map((b) => ({
          fullName: `${b.branchName} · ${b.managerName}`,
          status: b.statusLabel,
          checkIn: b.checkIn,
          lateMinutes: b.lateMinutes,
        })),
        topLate: (data.topLate ?? []).map((r) => ({
          fullName: r.fullName,
          departmentName: r.departmentName,
          lateDays: r.lateDays,
          lateMinutes: Number(formatLateHours(r.lateMinutes)) || r.lateMinutes,
        })),
        recent: (data.recentCheckins ?? []).map((r) => ({
          fullName: r.fullName,
          departmentName: r.departmentName,
          checkIn: r.checkIn,
          statusLabel: r.statusLabel,
        })),
        // Ekrandagi pastki jadval = shu breakdown; PDF da `branches` bo‘limida bir marta
        deptTable: [],
      });
      toast({
        title: t("davomat.dashPdfDone"),
        description: data.from === data.to ? t("davomat.pdfPortraitHint") : t("davomat.pdfLandscapeHint"),
      });
    } catch (err) {
      toast({
        title: t("davomat.dashPdfFail"),
        description: (err as Error)?.message || t("davomat.exportFailHint"),
        variant: "destructive",
      });
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div
      className={cn(
        "analytics-shell",
        embedded && "rounded-2xl",
      )}
    >
      <div className={cn("mx-auto max-w-[1600px] space-y-5", bare ? "p-0" : embedded ? "p-4 pb-8 md:p-5" : "p-4 pb-10 md:p-6")}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          {bare ? null : (
            <div className="min-w-0">
              {embedded ? (
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#0b3a5c]/70 dark:text-sky-300/80">
                  Dashboard
                </p>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-muted hover:text-foreground"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Dashboard
                  </Link>
                  <span>/</span>
                  <span>{t("davomat.analyticsShort")}</span>
                </div>
              )}
              <h1 className="mt-1 text-[26px] font-extrabold tracking-tight text-slate-900 dark:text-white md:text-[30px]">
                {embedded ? t("davomat.analyticsShort") : t("davomat.analytics")}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-card px-2.5 font-semibold text-foreground dark:border-slate-700">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  {rangeText}
                </span>
                <span className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 font-semibold text-emerald-700 dark:text-emerald-300">
                  <span className="relative flex h-2 w-2">
                    {isFetching ? (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                    ) : null}
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  {X.updated}: {updatedAt}
                </span>
                {user?.fullName ? (
                  <span className="hidden text-muted-foreground sm:inline">{user.fullName}</span>
                ) : null}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 xl:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                className="analytics-toolbar-group max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {PRESET_BUTTONS.map(({ key, labelKey }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={preset === key}
                    onMouseEnter={() => prefetchPreset(key)}
                    onFocus={() => prefetchPreset(key)}
                    onClick={() => setPreset(key)}
                    className={cn("analytics-toolbar-btn", preset === key && "analytics-toolbar-btn-active")}
                  >
                    {t(labelKey)}
                  </button>
                ))}
                <button
                  type="button"
                  role="tab"
                  aria-selected={preset === "custom"}
                  onClick={() => setPreset("custom")}
                  className={cn("analytics-toolbar-btn", preset === "custom" && "analytics-toolbar-btn-active")}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  {t("davomat.period")}
                </button>
              </div>
              <button
                type="button"
                onClick={() => void refetchFresh()}
                disabled={isFetching}
                className="analytics-action-btn border-slate-200 bg-card text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                {t("ui.refresh")}
              </button>
              <button
                type="button"
                disabled={exportingPdf || isLoading || !data}
                onClick={() => void onExportDashboardPdf()}
                className="analytics-action-btn border-rose-600 bg-rose-600 text-white shadow-rose-600/25 hover:bg-rose-700 dark:border-rose-500 dark:bg-rose-500 dark:hover:bg-rose-600"
              >
                {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                {t("davomat.pdfBtn")}
              </button>
            </div>
            {preset === "custom" ? (
              <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200/90 bg-card p-3 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-semibold text-muted-foreground">{X.periodFrom}</span>
                  <Input
                    type="date"
                    value={customFrom}
                    max={customTo}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-10 w-[160px] rounded-xl"
                  />
                </label>
                <ArrowRight className="mb-3 h-4 w-4 text-muted-foreground" />
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-semibold text-muted-foreground">{X.periodTo}</span>
                  <Input
                    type="date"
                    value={customTo}
                    min={customFrom}
                    max={tashkentTodayYmd()}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-10 w-[160px] rounded-xl"
                  />
                </label>
                <p className="pb-2.5 text-[11px] text-muted-foreground">{X.applyHint}</p>
              </div>
            ) : null}
          </div>
        </div>

        {fullDash ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {SEGMENT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = segment === opt.key;
              const stats = segmentStats(opt.key);
              const color = stats ? rateColor(stats.attendanceRate) : "#94a3b8";
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setSegment(opt.key)}
                  className={cn("analytics-segment", active && "analytics-segment-active")}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition",
                        active
                          ? "bg-[#0b3a5c] text-white shadow-md shadow-[#0b3a5c]/25 dark:bg-sky-500 dark:text-slate-950"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-bold text-foreground">{t(opt.labelKey)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {opt.key === "all" ? X.allHint : t(opt.hintKey)}
                      </p>
                    </div>
                    {active ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[#0b3a5c] dark:text-sky-400" /> : null}
                  </div>
                  {stats ? (
                    <div className="mt-3.5">
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="text-muted-foreground">
                          <span className="font-semibold text-foreground">{stats.headcount}</span> {X.employees}
                        </span>
                        <span className="font-bold tabular-nums" style={{ color }}>
                          {stats.attendanceRate}% {X.attendance}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${Math.min(100, stats.attendanceRate)}%`, background: color }}
                        />
                      </div>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        {isError ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-6 text-center text-rose-700 dark:text-rose-200">
            <p>{error instanceof Error ? error.message : t("davomat.loadFail")}</p>
            <Button size="sm" variant="outline" onClick={() => void refetchFresh()}>
              {t("davomat.retry")}
            </Button>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <RateKpiCard
            rate={attRate}
            target={data?.kpis.targetRate ?? null}
            label={X.rate}
            targetLabel={X.target}
            loading={isLoading}
          />
          <KpiCard
            title={t("davomat.totalStaff")}
            value={data?.kpis.headcount ?? "—"}
            delta={data?.kpis.deltaRate}
            icon={Users}
            accent="bg-sky-500/10 text-sky-600 dark:text-sky-300"
            bar="bg-sky-500"
            loading={isLoading}
          />
          <KpiCard
            title={t("davomat.todayArrived")}
            value={arrivedNow ?? "—"}
            sub={
              officeShare
                ? `${officeShare.onTime} ${t("davomat.onTime").toLowerCase()} · ${officeShare.late} ${t("davomat.lateShort").toLowerCase()}`
                : pctOf(arrivedNow) != null
                  ? `${pctOf(arrivedNow)}% ${t("davomat.pctOfStaff")}`
                  : undefined
            }
            progress={pctOf(arrivedNow)}
            icon={UserCheck}
            accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
            bar="bg-emerald-500"
            loading={isLoading}
          />
          <KpiCard
            title={t("davomat.todayLate")}
            value={lateNow ?? "—"}
            sub={pctOf(lateNow) != null ? `${pctOf(lateNow)}% ${t("davomat.pctOfStaff")}` : undefined}
            progress={pctOf(lateNow)}
            icon={Clock}
            accent="bg-amber-500/10 text-amber-600 dark:text-amber-300"
            bar="bg-amber-500"
            loading={isLoading}
          />
          <KpiCard
            title={t("davomat.todayAbsent")}
            value={absentNow ?? "—"}
            sub={pctOf(absentNow) != null ? `${pctOf(absentNow)}% ${t("davomat.pctOfStaff")}` : undefined}
            progress={pctOf(absentNow)}
            icon={AlertTriangle}
            accent="bg-rose-500/10 text-rose-600 dark:text-rose-300"
            bar="bg-rose-500"
            loading={isLoading}
          />
          <KpiCard
            title={t("davomat.todayEarlyOut")}
            value={earlyNow ?? "—"}
            sub={
              data?.today && pctOf(earlyNow) != null
                ? `${pctOf(earlyNow)}% ${t("davomat.pctOfStaff")}`
                : t("davomat.personDays")
            }
            progress={data?.today ? pctOf(earlyNow) : null}
            icon={LogOut}
            accent="bg-violet-500/10 text-violet-600 dark:text-violet-300"
            bar="bg-violet-500"
            loading={isLoading}
          />
        </div>

        {insights.length ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
              {X.insights}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {insights.map((it) => {
                const Icon = it.icon;
                return (
                  <div
                    key={it.key}
                    className="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-card p-3.5 transition hover:shadow-md dark:border-slate-700/50 dark:bg-slate-900/60"
                  >
                    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", it.tone)}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                        {it.label}
                      </p>
                      <p className="mt-0.5 truncate text-[14px] font-bold text-foreground" title={it.value}>
                        {it.value}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground" title={it.hint}>
                        {it.hint}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel
            title={dynamicsData.length > 1 || dynamicsPending ? t("davomat.attDynamics") : X.dayTitle}
            subtitle={rangeText}
            icon={Activity}
            className="xl:col-span-2"
            action={
              dynamicsData.length <= 1 || dynamicsPending ? null :
              <div className="analytics-toolbar-group !h-9">
                <button
                  type="button"
                  onClick={() => setDynamicsChart("line")}
                  className={cn(
                    "analytics-toolbar-btn !h-7 !min-w-0 !px-2.5 !text-[11px]",
                    dynamicsChart === "line" && "analytics-toolbar-btn-active",
                  )}
                  title={t("davomat.chartLine")}
                >
                  <ChartLine className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("davomat.chartLine")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDynamicsChart("bar")}
                  className={cn(
                    "analytics-toolbar-btn !h-7 !min-w-0 !px-2.5 !text-[11px]",
                    dynamicsChart === "bar" && "analytics-toolbar-btn-active",
                  )}
                  title={t("davomat.chartBar")}
                >
                  <ChartColumn className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("davomat.chartBar")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDynamicsChart("both")}
                  className={cn(
                    "analytics-toolbar-btn !h-7 !min-w-0 !px-2.5 !text-[11px]",
                    dynamicsChart === "both" && "analytics-toolbar-btn-active",
                  )}
                  title={t("davomat.chartBoth")}
                >
                  <ChartNoAxesCombined className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("davomat.chartBoth")}</span>
                </button>
              </div>
            }
          >
            {isLoading || dynamicsPending ? (
              <DynamicsLoading
                days={Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1}
                title={X.dynLoading}
                hint={X.dynLoadingHint}
              />
            ) : dynamicsData.length <= 1 ? (
              <DayBreakdown
                items={[
                  { label: t("davomat.onTime"), value: dynamicsData[0]?.arrived ?? 0, color: "#22c55e" },
                  { label: t("davomat.lateShort"), value: dynamicsData[0]?.late ?? 0, color: "#eab308" },
                  { label: t("davomat.absent"), value: dynamicsData[0]?.absent ?? 0, color: "#ef4444" },
                ]}
                hint={X.dayHint}
                actions={
                  <span className="analytics-toolbar-group !h-8">
                    {(["7d", "30d", "month"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onMouseEnter={() => prefetchPreset(p)}
                        onFocus={() => prefetchPreset(p)}
                        onClick={() => setPreset(p)}
                        className="analytics-toolbar-btn !h-6 !min-w-0 !px-2.5 !text-[11px]"
                      >
                        {t(PRESET_BUTTONS.find((b) => b.key === p)?.labelKey ?? "")}
                      </button>
                    ))}
                  </span>
                }
              />
            ) : (
              <>
                <DynamicsChartLegend items={dynamicsLegendItems} />
            {dynamicsChart === "line" ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={dynamicsData}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: chart.tick, fontSize: 11 }}
                    interval={dynamicsTickInterval}
                    minTickGap={8}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: chart.tick, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(148, 163, 184, 0.45)", strokeWidth: 1 }}
                    content={<DynamicsTooltip />}
                  />
                  <Line
                    type="monotone"
                    dataKey="arrived"
                    name={t("davomat.onTime")}
                    stroke="#22c55e"
                    strokeWidth={2.5}
                    legendType="none"
                    animationDuration={650}
                    animationEasing="ease-out"
                    dot={dynamicsShowDots ? { r: 3.5, fill: "#22c55e", strokeWidth: 0 } : false}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="late"
                    name={t("davomat.lateShort")}
                    stroke="#eab308"
                    strokeWidth={2.5}
                    legendType="none"
                    animationDuration={650}
                    animationEasing="ease-out"
                    dot={dynamicsShowDots ? { r: 3.5, fill: "#eab308", strokeWidth: 0 } : false}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="absent"
                    name={t("davomat.absent")}
                    stroke="#ef4444"
                    strokeWidth={2.5}
                    legendType="none"
                    animationDuration={650}
                    animationEasing="ease-out"
                    dot={dynamicsShowDots ? { r: 3.5, fill: "#ef4444", strokeWidth: 0 } : false}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : dynamicsChart === "bar" ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={dynamicsData}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  barCategoryGap={dynamicsData.length > 16 ? "18%" : "28%"}
                  barGap={2}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: chart.tick, fontSize: 11 }}
                    interval={dynamicsTickInterval}
                    minTickGap={8}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: chart.tick, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
                    content={<DynamicsTooltip />}
                  />
                  <Bar
                    dataKey="arrived"
                    name={t("davomat.onTime")}
                    fill="#22c55e"
                    legendType="none"
                    animationDuration={650}
                    animationEasing="ease-out"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={dynamicsData.length > 16 ? 12 : 22}
                  />
                  <Bar
                    dataKey="late"
                    name={t("davomat.lateShort")}
                    fill="#eab308"
                    legendType="none"
                    animationDuration={650}
                    animationEasing="ease-out"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={dynamicsData.length > 16 ? 12 : 22}
                  />
                  <Bar
                    dataKey="absent"
                    name={t("davomat.absent")}
                    fill="#ef4444"
                    legendType="none"
                    animationDuration={650}
                    animationEasing="ease-out"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={dynamicsData.length > 16 ? 12 : 22}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart
                  data={dynamicsData}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  barCategoryGap={dynamicsData.length > 16 ? "22%" : "32%"}
                  barGap={2}
                >
                  <defs>
                    <linearGradient id={`${fillId}-g`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id={`${fillId}-y`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#eab308" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#eab308" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id={`${fillId}-r`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: chart.tick, fontSize: 11 }}
                    interval={dynamicsTickInterval}
                    minTickGap={8}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: chart.tick, fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                  />
                  <Tooltip content={<DynamicsTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="arrived"
                    stroke="none"
                    fill={`url(#${fillId}-g)`}
                    legendType="none"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="late"
                    stroke="none"
                    fill={`url(#${fillId}-y)`}
                    legendType="none"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="absent"
                    stroke="none"
                    fill={`url(#${fillId}-r)`}
                    legendType="none"
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="arrived"
                    name={t("davomat.onTime")}
                    fill="#22c55e"
                    fillOpacity={0.85}
                    legendType="none"
                    animationDuration={650}
                    animationEasing="ease-out"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={dynamicsData.length > 16 ? 10 : 18}
                  />
                  <Bar
                    dataKey="late"
                    name={t("davomat.lateShort")}
                    fill="#eab308"
                    fillOpacity={0.85}
                    legendType="none"
                    animationDuration={650}
                    animationEasing="ease-out"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={dynamicsData.length > 16 ? 10 : 18}
                  />
                  <Bar
                    dataKey="absent"
                    name={t("davomat.absent")}
                    fill="#ef4444"
                    fillOpacity={0.85}
                    legendType="none"
                    animationDuration={650}
                    animationEasing="ease-out"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={dynamicsData.length > 16 ? 10 : 18}
                  />
                  <Line
                    type="monotone"
                    dataKey="arrived"
                    name={t("davomat.onTime")}
                    stroke="#16a34a"
                    strokeWidth={2.25}
                    dot={dynamicsShowDots ? { r: 3, fill: "#16a34a", strokeWidth: 0 } : false}
                    activeDot={{ r: 5 }}
                    legendType="none"
                  />
                  <Line
                    type="monotone"
                    dataKey="late"
                    name={t("davomat.lateShort")}
                    stroke="#ca8a04"
                    strokeWidth={2.25}
                    dot={dynamicsShowDots ? { r: 3, fill: "#ca8a04", strokeWidth: 0 } : false}
                    activeDot={{ r: 5 }}
                    legendType="none"
                  />
                  <Line
                    type="monotone"
                    dataKey="absent"
                    name={t("davomat.absent")}
                    stroke="#dc2626"
                    strokeWidth={2.25}
                    dot={dynamicsShowDots ? { r: 3, fill: "#dc2626", strokeWidth: 0 } : false}
                    activeDot={{ r: 5 }}
                    legendType="none"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
              </>
            )}
          </Panel>

          <Panel
            title={shareTitle}
            icon={PieChartIcon}
            subtitle={
              officeShare && (range.from === range.to || range.to === officeShare.date)
                ? formatYmdUz(officeShare.date)
                : rangeText
            }
          >
            {isLoading ? (
              <Skeleton className="mx-auto h-64 w-64 rounded-full" />
            ) : (
              (() => {
                const total = pieData.reduce((s, p) => s + p.value, 0);
                const came = pieData
                  .filter((p) => p.fill !== "#ef4444")
                  .reduce((s, p) => s + p.value, 0);
                const cameRate = total ? Math.round((came / total) * 1000) / 10 : 0;
                const legend = [
                  { name: t("davomat.onTime"), fill: "#22c55e" },
                  { name: t("davomat.lateShort"), fill: "#eab308" },
                  { name: t("davomat.absent"), fill: "#ef4444" },
                ].map((l) => ({ ...l, value: pieData.find((p) => p.fill === l.fill)?.value ?? 0 }));
                return (
                  <div className="flex flex-col items-center">
                    <div className="relative h-[220px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData.length ? pieData : [{ name: "—", value: 1, fill: chart.isDark ? "#334155" : "#e2e8f0" }]}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={70}
                            outerRadius={98}
                            paddingAngle={pieData.length > 1 ? 3 : 0}
                            cornerRadius={6}
                            stroke="none"
                          >
                            {(pieData.length ? pieData : [{ name: "—", value: 1, fill: chart.isDark ? "#334155" : "#e2e8f0" }]).map((entry, i) => (
                              <Cell key={`${entry.name}-${i}`} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[28px] font-extrabold leading-none tabular-nums" style={{ color: rateColor(cameRate) }}>
                          {total ? `${cameRate}%` : "—"}
                        </span>
                        <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {t("davomat.arrived")}
                        </span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {came} / {total}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 w-full space-y-1.5">
                      {legend.map((l) => {
                        const pct = total ? Math.round((l.value / total) * 1000) / 10 : 0;
                        return (
                          <div
                            key={l.fill}
                            className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/50"
                          >
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.fill }} />
                            <span className="flex-1 font-medium text-foreground">{l.name}</span>
                            <span className="font-bold tabular-nums text-foreground">{l.value}</span>
                            <span className="w-12 text-right tabular-nums text-muted-foreground">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            )}
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel
            title={isPharmacySegment ? t("davomat.byBranchPharm") : t("davomat.byBranch")}
            icon={Layers}
            action={
              isPharmacySegment && branchBreakdown.length > 6 ? (
                <button
                  type="button"
                  onClick={() => setBranchListExpanded((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {branchListExpanded ? t("ui.close") : t("davomat.viewAllBranches")}
                  {!branchListExpanded ? <ArrowRight className="h-3.5 w-3.5" /> : null}
                </button>
              ) : null
            }
          >
            {isLoading ? (
              <Skeleton className="h-56 w-full rounded-xl" />
            ) : isPharmacySegment ? (
              branchBreakdown.length ? (
                <BranchAttendanceList
                  rows={branchBreakdown}
                  expanded={branchListExpanded}
                  onToggleExpand={() => {
                    setBranchListExpanded(true);
                    requestAnimationFrame(() => {
                      document.getElementById("davomat-breakdown-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }}
                  viewAllLabel={t("davomat.viewAllBranches")}
                />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("ui.empty")}</p>
              )
            ) : (
              <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                {deptBreakdown.slice(0, 8).map((d) => {
                  const tone = branchAttendanceTone(d.attendanceRate);
                  return (
                    <div key={d.name} className="analytics-inset !px-3 !py-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-semibold">{d.name}</p>
                        <span className={cn("shrink-0 text-[13px] font-extrabold tabular-nums", tone.text)}>{d.attendanceRate}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/60">
                        <div className={cn("h-full rounded-full transition-all duration-700", tone.bar)} style={{ width: `${Math.min(100, d.attendanceRate)}%` }} />
                      </div>
                      <p className="mt-1 text-[10.5px] tabular-nums text-muted-foreground">
                        {range.from === range.to
                          ? `${d.present} / ${d.headcount} ${X.came}`
                          : `${d.headcount} ${X.employees}`}
                        {d.late ? ` · ${d.late} ${t("davomat.lateWord")}` : ""}
                      </p>
                    </div>
                  );
                })}
                {!deptBreakdown.length ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t("ui.empty")}</p>
                ) : null}
              </div>
            )}
          </Panel>

          <Panel title={t("davomat.topDisciplined")} icon={Award}>
            {isLoading ? <Skeleton className="h-40 w-full rounded-xl" /> : <TopDisciplinedList departments={data?.byDepartment ?? []} />}
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-12">
          <Panel
            title={t("davomat.byRole")}
            icon={UserCheck}
            subtitle={data?.byRole?.length ? `${data.byRole.length} ${X.rolesCount}` : undefined}
            className="flex flex-col lg:col-span-3"
            bodyClassName="relative min-h-[280px] flex-1 !p-0"
          >
            <div className="space-y-1 overflow-y-auto p-2.5 lg:absolute lg:inset-0">
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)
                : (data?.byRole ?? []).map((r, i) => {
                    const tone = branchAttendanceTone(r.attendanceRate);
                    return (
                      <div
                        key={r.key}
                        className="flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-bold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-[12.5px] font-semibold text-foreground" title={r.label}>
                              {r.label}
                            </p>
                            <span className={cn("shrink-0 text-[12.5px] font-extrabold tabular-nums", tone.text)}>
                              {r.attendanceRate}%
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                              className={cn("h-full rounded-full transition-all duration-500", tone.bar)}
                              style={{ width: `${Math.min(100, r.attendanceRate)}%` }}
                            />
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-[10.5px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              <b className="font-semibold text-foreground">{r.headcount}</b>
                            </span>
                            {r.late ? (
                              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                <Timer className="h-3 w-3" />
                                <b className="font-semibold">{r.late}</b> {t("davomat.lateWord")}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              {!isLoading && !(data?.byRole ?? []).length ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{t("ui.empty")}</p>
              ) : null}
            </div>
          </Panel>

          {segment === "office" ? (
            <Panel title={t("davomat.officeDay")} icon={Building2} className="lg:col-span-9" bodyClassName="!p-4">
              <OfficeDayPanel
                items={data?.officeDayBoard ?? []}
                summary={data?.officeDaySummary ?? null}
                loading={isLoading}
                rangeLabel={
                  range.from !== range.to ? `${t("davomat.periodLastDay")} · ${formatYmdUz(range.to)}` : undefined
                }
              />
            </Panel>
          ) : (
            <Panel title={t("davomat.branchOpen")} icon={Store} className="lg:col-span-9">
              <BranchOpeningsPanel
                openings={data?.branchOpenings ?? []}
                summary={data?.branchOpeningSummary ?? null}
                loading={isLoading}
                rangeLabel={
                  range.from !== range.to ? `${t("davomat.periodLastDay")} · ${formatYmdUz(range.to)}` : undefined
                }
              />
            </Panel>
          )}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel
            title={t("davomat.topLate")}
            icon={Timer}
            subtitle={data?.topLate?.length ? `${data.topLate.length} ${X.employees}` : undefined}
            bodyClassName="!p-0"
          >
            <div className="h-[380px] overflow-auto">
              <table className="analytics-table analytics-table--pin w-full text-sm">
                <thead>
                  <tr>
                    <th className="w-10 text-center">#</th>
                    <th className="text-left">{t("ui.employee")}</th>
                    <th className="text-left">{t("ui.department")}</th>
                    <th className="text-right">{t("davomat.col.day")}</th>
                    <th className="text-right">{t("davomat.col.min")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.topLate ?? []).map((r, i) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => setLatePerson(r)}>
                      <td className="text-center">
                        <span
                          className={cn(
                            "inline-flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-bold tabular-nums",
                            i < 3
                              ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm"
                              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300",
                          )}
                        >
                          {i + 1}
                        </span>
                      </td>
                      <td>
                        <div className="flex min-w-0 max-w-[260px] items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10.5px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            {personInitials(r.fullName)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">{r.fullName}</p>
                            {r.position ? <p className="truncate text-[11px] text-muted-foreground">{r.position}</p> : null}
                          </div>
                        </div>
                      </td>
                      <td>
                        {r.departmentName ? (
                          <span className="inline-block max-w-[160px] truncate rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {r.departmentName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="text-right">
                        <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[12px] font-bold tabular-nums text-amber-700 dark:text-amber-300">
                          {r.lateDays}
                        </span>
                      </td>
                      <td className="text-right font-semibold tabular-nums text-foreground">
                        {formatLateHours(r.lateMinutes)}
                        <span className="ml-0.5 text-[10.5px] font-normal text-muted-foreground">{t("davomat.hourShort")}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!isLoading && !(data?.topLate ?? []).length ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("ui.empty")}</p>
              ) : null}
            </div>
            <Dialog open={!!latePerson} onOpenChange={(open) => !open && setLatePerson(null)}>
              <DialogContent className="max-h-[85vh] max-w-md overflow-hidden p-0">
                <DialogHeader className="border-b border-border px-4 py-3">
                  <DialogTitle className="text-left text-base">
                    {t("davomat.lateDetailTitle")}
                  </DialogTitle>
                  {latePerson ? (
                    <p className="text-left text-xs text-muted-foreground">
                      {latePerson.fullName}
                      {latePerson.departmentName ? ` · ${latePerson.departmentName}` : ""}
                      {latePerson.position ? ` · ${latePerson.position}` : ""}
                    </p>
                  ) : null}
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto p-3">
                  <p className="mb-3 text-[11px] text-muted-foreground">{t("davomat.lateDetailHint")}</p>
                  {latePerson?.lateDetails?.length ? (
                    <ul className="space-y-2">
                      {latePerson.lateDetails.map((d) => (
                        <li
                          key={d.date}
                          className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold tabular-nums">{formatYmdUz(d.date)}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {t("davomat.checkInTime")}: {d.checkIn}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[10px] uppercase text-muted-foreground">{t("davomat.lateBy")}</p>
                            <p className="text-sm font-bold tabular-nums text-amber-700 dark:text-amber-300">
                              {formatLateHours(d.lateMinutes)} {t("davomat.hourShort")}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {t("davomat.lateDetailEmpty")}
                    </p>
                  )}
                  {latePerson ? (
                    <div className="mt-4 rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      {t("davomat.col.day")}: <span className="font-semibold text-foreground">{latePerson.lateDays}</span>
                      {" · "}
                      {t("davomat.col.min")}:{" "}
                      <span className="font-semibold text-foreground">
                        {formatLateHours(latePerson.lateMinutes)} {t("davomat.hourShort")}
                      </span>
                    </div>
                  ) : null}
                </div>
              </DialogContent>
            </Dialog>
          </Panel>

          <Panel
            title={t("davomat.recentArrivals")}
            icon={Sunrise}
            subtitle={data?.recentCheckins?.length ? `${data.recentCheckins.length} ${X.employees}` : undefined}
            bodyClassName="!p-0"
          >
            <div className="h-[380px] overflow-auto">
              <table className="analytics-table analytics-table--pin w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">{t("ui.employee")}</th>
                    <th className="text-left">{t("ui.department")}</th>
                    <th className="text-left">{t("davomat.col.time")}</th>
                    <th className="text-right">{t("ui.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recentCheckins ?? []).map((r, i) => {
                    const tone =
                      r.status === "late"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                        : r.status === "incomplete"
                          ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
                          : r.status === "present" || r.status === "on_time"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
                    return (
                      <tr key={`${r.id ?? r.fullName}-${i}`} className="cursor-pointer" onClick={() => setArrivalPerson(r)}>
                        <td>
                          <div className="flex min-w-0 max-w-[260px] items-center gap-2.5">
                            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold", tone)}>
                              {personInitials(r.fullName)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">{r.fullName}</p>
                              {r.position ? <p className="truncate text-[11px] text-muted-foreground">{r.position}</p> : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          {r.departmentName ? (
                            <span className="inline-block max-w-[160px] truncate rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {r.departmentName}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td>
                          {r.checkIn && r.checkIn !== "—" ? (
                            <span className="inline-flex items-center gap-1 font-bold tabular-nums text-foreground">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              {r.checkIn}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="text-right">
                          <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", tone)}>{r.statusLabel}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!isLoading && !(data?.recentCheckins ?? []).length ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("ui.empty")}</p>
              ) : null}
            </div>
            <Dialog open={!!arrivalPerson} onOpenChange={(open) => !open && setArrivalPerson(null)}>
              <DialogContent className="max-h-[85vh] max-w-md overflow-hidden p-0">
                <DialogHeader className="border-b border-border px-4 py-3">
                  <DialogTitle className="text-left text-base">{t("davomat.arrivalDetailTitle")}</DialogTitle>
                  {arrivalPerson ? (
                    <p className="text-left text-xs text-muted-foreground">
                      {arrivalPerson.fullName}
                      {arrivalPerson.departmentName ? ` · ${arrivalPerson.departmentName}` : ""}
                      {arrivalPerson.position ? ` · ${arrivalPerson.position}` : ""}
                    </p>
                  ) : null}
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto p-3">
                  {arrivalPerson ? (
                    <div className="mb-3 rounded-xl border bg-muted/40 px-3 py-2.5 text-xs">
                      <p className="text-[10px] uppercase text-muted-foreground">{t("davomat.lastDay")}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="tabular-nums font-semibold">{formatYmdUz(arrivalPerson.date)}</span>
                        <span>
                          {t("davomat.checkInTime")}:{" "}
                          <span className="font-semibold tabular-nums">{arrivalPerson.checkIn}</span>
                        </span>
                        <span>
                          {t("davomat.checkOut")}:{" "}
                          <span className="font-semibold tabular-nums">{arrivalPerson.checkOut || "—"}</span>
                        </span>
                        <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", staffStatusStyle(arrivalPerson.status))}>
                          {arrivalPerson.statusLabel}
                          {(arrivalPerson.lateMinutes ?? 0) > 0
                            ? ` (+${formatLateHours(arrivalPerson.lateMinutes ?? 0)} ${t("davomat.hourShort")})`
                            : ""}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <p className="mb-3 text-[11px] text-muted-foreground">{t("davomat.arrivalDetailHint")}</p>
                  {arrivalPerson?.dayDetails?.length ? (
                    <ul className="space-y-2">
                      {arrivalPerson.dayDetails.map((d) => (
                        <li
                          key={d.date}
                          className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold tabular-nums">{formatYmdUz(d.date)}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {t("davomat.checkInTime")}: {d.checkIn}
                              {" · "}
                              {t("davomat.checkOut")}: {d.checkOut}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", staffStatusStyle(d.status))}>
                              {d.statusLabel}
                            </span>
                            {d.lateMinutes > 0 ? (
                              <p className="mt-1 text-xs font-bold tabular-nums text-amber-700 dark:text-amber-300">
                                +{formatLateHours(d.lateMinutes)} {t("davomat.hourShort")}
                              </p>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-8 text-center text-sm text-muted-foreground">{t("davomat.lateDetailEmpty")}</p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </Panel>
        </div>

        <Panel
          title={t("davomat.deptTable")}
          icon={Layers}
          subtitle={
            breakdownRows.length
              ? `${breakdownRows.length} ${isPharmacySegment ? X.branchUnit : X.deptUnit} · ${breakdownRows.reduce((n, r) => n + r.headcount, 0)} ${X.employees}`
              : undefined
          }
          bodyClassName="!p-0"
          className="scroll-mt-24"
          id="davomat-breakdown-table"
        >
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          ) : breakdownRows.length ? (
            <BreakdownTable
              rows={breakdownRows as BreakdownItem[]}
              isBranch={isPharmacySegment}
              onSelect={(d) => setDeptRow(d as DeptRow)}
              X={X}
              t={t}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("ui.empty")}</p>
          )}
          <Dialog open={!!deptRow} onOpenChange={(open) => !open && setDeptRow(null)}>
            <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden p-0">
              <DialogHeader className="border-b border-border px-4 py-3">
                <DialogTitle className="text-left text-base">{t("davomat.deptStaffTitle")}</DialogTitle>
                {deptRow ? (
                  <p className="text-left text-xs text-muted-foreground">
                    {deptRow.name}
                    {" · "}
                    {deptRow.headcount} {t("davomat.peopleCount")}
                    {" · "}
                    {t("davomat.chartAtt")}: {deptRow.attendanceRate}%
                  </p>
                ) : null}
              </DialogHeader>
              <div className="max-h-[60vh] overflow-y-auto p-3">
                <p className="mb-3 text-[11px] text-muted-foreground">{t("davomat.deptStaffHint")}</p>
                {(deptRow?.staff?.length ?? 0) > 0 ? (
                  <table className="analytics-table w-full text-sm">
                    <thead>
                      <tr>
                        <th>{t("ui.employee")}</th>
                        <th className="text-right">{t("davomat.arrived")}</th>
                        <th className="text-right">{t("davomat.lateShort")}</th>
                        <th className="text-right">{t("davomat.absent")}</th>
                        <th className="text-right">{t("davomat.col.min")}</th>
                        <th className="text-right">{t("davomat.lastDay")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(deptRow?.staff ?? []).map((s) => (
                        <tr key={s.id}>
                          <td>
                            <p className="font-medium leading-tight">{s.fullName}</p>
                            <p className="text-[10px] text-muted-foreground">{s.position}</p>
                          </td>
                          <td className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{s.present}</td>
                          <td className="text-right tabular-nums text-amber-600 dark:text-amber-400">{s.late}</td>
                          <td className="text-right tabular-nums text-rose-600 dark:text-rose-400">{s.absent}</td>
                          <td className="text-right tabular-nums text-muted-foreground">
                            {formatLateHours(s.lateMinutes)}
                          </td>
                          <td className="text-right">
                            <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", staffStatusStyle(s.lastStatus))}>
                              {s.lastStatusLabel}
                            </span>
                            {s.lastCheckIn ? (
                              <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">{s.lastCheckIn}</p>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t("davomat.deptStaffEmpty")}</p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </Panel>
      </div>
    </div>
  );
}

export default function DavomatAnalyticsPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  if (!canViewDavomat(user?.role)) {
    return <div className="p-8 text-center text-muted-foreground">{t("davomat.noAccess")}</div>;
  }
  return <DavomatAnalyticsDashboard />;
}
