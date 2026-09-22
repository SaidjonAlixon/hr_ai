import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  Clock,
  Download,
  FileDown,
  Loader2,
  Store,
  TrendingDown,
  TrendingUp,
  Users,
  ChartColumn,
  ChartLine,
  ChartNoAxesCombined,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
import { useI18n } from "@/i18n/I18nProvider";
import { canViewDavomat, canViewFullDavomatDashboard } from "@/lib/roles";
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
import { Progress } from "@/components/ui/progress";
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

  return (
    <div className="space-y-2">
      {top.map((r, i) => (
        <div key={r.id} className="analytics-inset flex items-center gap-3 !py-2">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
              i === 0 ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground",
            )}
          >
            {i + 1}
          </span>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {(r.fullName || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{r.fullName}</p>
            <p className="truncate text-[11px] text-muted-foreground">{r.position}</p>
          </div>
          <span className="shrink-0 text-sm font-bold tabular-nums text-emerald-600">{r.attendanceRate}%</span>
        </div>
      ))}
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
}: {
  title: string;
  value: string | number;
  sub?: string;
  delta?: number | null;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  loading?: boolean;
}) {
  const { t } = useI18n();
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
          {delta}% {t("davomat.vsPrev")}
        </div>
      ) : null}
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
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <div id={id} className={cn("analytics-panel", className)}>
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

  return (
    <div className={cn("flex min-h-0 flex-col rounded-xl border", toneClass)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-2.5 py-2">
        <span className="text-xs font-semibold">{title}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums", badgeClass)}>{count}</span>
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

function officeStatusStyle(status: OfficeDayItem["status"]) {
  return branchStatusStyle(status);
}

function OfficeDayRow({ item }: { item: OfficeDayItem }) {
  const { t } = useI18n();
  const opened = item.checkIn && item.checkIn !== "—" ? item.checkIn : null;
  const windowLabel = onTimeWindowLabel(item.expectedOpen, item.graceUntil, t);
  const caption =
    item.status === "absent"
      ? t("davomat.absent")
      : item.status === "leave"
        ? item.statusLabel
        : item.status === "late"
          ? t("davomat.lateShort")
          : t("davomat.cameAt");

  return (
    <div
      className={cn(
        "flex w-full items-start gap-2.5 rounded-xl border px-2.5 py-2 text-left",
        officeStatusStyle(item.status),
      )}
    >
      <Users className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
          {item.fullName}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug opacity-75 [overflow-wrap:anywhere]">
          {item.departmentName || item.position}
        </p>
        {item.departmentName ? (
          <p className="text-[10px] leading-snug opacity-60 [overflow-wrap:anywhere]">{item.position}</p>
        ) : null}
      </div>
      <div className="w-[5.5rem] shrink-0 text-right leading-tight sm:w-[6.25rem]">
        <p className="text-[9px] font-medium uppercase tracking-wide opacity-60">{caption}</p>
        {opened ? (
          <>
            <p className="text-base font-bold tabular-nums">{opened}</p>
            <p className="text-[9px] tabular-nums opacity-60">{windowLabel}</p>
            {item.lateMinutes > 0 ? (
              <p className="text-[9px] font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                +{item.lateMinutes} {t("davomat.minShort")}
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
    </div>
  );
}

function OfficeDayColumn({
  title,
  count,
  tone,
  items,
  empty,
}: {
  title: string;
  count: number;
  tone: "emerald" | "amber" | "rose";
  items: OfficeDayItem[];
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
    <div className={cn("flex min-h-0 min-w-0 flex-col rounded-xl border", toneClass)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums", badgeClass)}>{count}</span>
      </div>
      <div className="max-h-[min(52vh,420px)] space-y-1.5 overflow-y-auto p-2.5">
        {items.length ? (
          items.map((item) => <OfficeDayRow key={item.employeeId} item={item} />)
        ) : (
          <p className="py-6 text-center text-[11px] text-muted-foreground">{empty}</p>
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 font-medium text-foreground">
            <CalendarDays className="h-3 w-3" />
            {formatYmdUz(summary.date)}
          </span>
          {rangeLabel ? <span>{rangeLabel}</span> : null}
          <span className="text-muted-foreground">{t("davomat.officeDayHint")}</span>
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
      {!items.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("davomat.noOfficeStaff")}</p>
      ) : (
        <>
          <div className="hidden gap-3 md:grid md:grid-cols-3 md:items-stretch">
            {tabs.map((tb) => (
              <OfficeDayColumn
                key={tb.key}
                title={tb.label}
                count={tb.count}
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
  initialSegment = "office",
}: {
  embedded?: boolean;
  initialSegment?: DavomatSegment;
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const search = useSearch();
  const fullDash = canViewFullDavomatDashboard(user?.role);
  const segmentFromUrl = useMemo(() => {
    if (!fullDash) return "all" as DavomatSegment;
    if (embedded) return initialSegment;
    const seg = new URLSearchParams(search).get("segment");
    if (seg === "office" || seg === "pharmacy" || seg === "all") return seg;
    return "office";
  }, [embedded, initialSegment, search, fullDash]);
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
  const { data, isLoading, isError, error, refetch } = useDavomatAnalytics({ ...range, segment }, true);
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
      <div className={cn("mx-auto max-w-[1600px] space-y-5", embedded ? "p-4 pb-8 md:p-5" : "p-4 pb-10 md:p-6")}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            {embedded ? (
              <>
                <p className="text-xs font-medium uppercase tracking-wider text-primary">Dashboard</p>
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("davomat.analyticsShort")}</h1>
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
                    Dashboard
                  </Link>
                  <span>/</span>
                  <span className="text-muted-foreground">{t("davomat.analyticsShort")}</span>
                </div>
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t("davomat.analytics")}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data ? `${data.from} — ${data.to}` : t("ui.loading")} · {t("davomat.analyticsDesc")}
                </p>
              </>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_BUTTONS.map(({ key, labelKey }) => (
                <Button
                  key={key}
                  size="sm"
                  variant={preset === key ? "default" : "outline"}
                  onClick={() => setPreset(key)}
                >
                  {t(labelKey)}
                </Button>
              ))}
              <Button
                size="sm"
                variant={preset === "custom" ? "default" : "outline"}
                onClick={() => setPreset("custom")}
              >
                <CalendarDays className="mr-1.5 h-4 w-4" />
                {t("davomat.period")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                <Download className="mr-1.5 h-4 w-4" />
                {t("ui.refresh")}
              </Button>
              <Button
                size="sm"
                className="gap-1.5 border border-rose-200/40 bg-gradient-to-b from-rose-500 to-rose-700 text-white shadow-sm hover:from-rose-400 hover:to-rose-600"
                disabled={exportingPdf || isLoading || !data}
                onClick={() => void onExportDashboardPdf()}
              >
                {exportingPdf ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4" />
                )}
                {t("davomat.pdfBtn")}
              </Button>
            </div>
            {preset === "custom" ? (
              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card/60 p-2.5 dark:border-slate-600/40 dark:bg-slate-800/40">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-muted-foreground">{t("davomat.fromShort")}</span>
                  <Input
                    type="date"
                    value={customFrom}
                    max={customTo}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-9 w-[148px] rounded-lg"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-muted-foreground">{t("davomat.toShort")}</span>
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

        {fullDash ? (
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
                    <p className="font-medium">{t(opt.labelKey)}</p>
                    <p className="text-xs text-muted-foreground">{t(opt.hintKey)}</p>
                  </div>
                </div>
                {segStats && opt.key !== "all" ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {segStats.headcount} {t("ui.employees").toLowerCase()} · <span className="font-semibold text-emerald-600 dark:text-emerald-400">{segStats.attendanceRate}%</span> {t("davomat.attRate")}
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
        ) : null}

        {isError ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-6 text-center text-rose-700 dark:text-rose-200">
            <p>{error instanceof Error ? error.message : t("davomat.loadFail")}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              {t("davomat.retry")}
            </Button>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            title={t("davomat.totalStaff")}
            value={data?.kpis.headcount ?? "—"}
            delta={data?.kpis.deltaRate}
            icon={Users}
            accent="bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200"
            loading={isLoading}
          />
          <KpiCard
            title={t("davomat.todayArrived")}
            value={
              officeShare
                ? officeShare.onTime + officeShare.late
                : data?.today
                  ? data.today.present
                  : "—"
            }
            sub={
              officeShare
                ? `${officeShare.onTime} ${t("davomat.onTime").toLowerCase()} · ${officeShare.late} ${t("davomat.lateShort").toLowerCase()}`
                : data?.today
                  ? `${data.today.attendanceRate}%`
                  : undefined
            }
            icon={TrendingUp}
            accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"
            loading={isLoading}
          />
          <KpiCard
            title={t("davomat.todayLate")}
            value={officeShare?.late ?? data?.today?.late ?? "—"}
            sub={
              (officeShare || data?.today) && data?.kpis.headcount
                ? `${Math.round(((officeShare?.late ?? data?.today?.late ?? 0) / Math.max(data.kpis.headcount, 1)) * 1000) / 10}% ${t("davomat.pctOfStaff")}`
                : undefined
            }
            icon={Clock}
            accent="bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200"
            loading={isLoading}
          />
          <KpiCard
            title={t("davomat.todayAbsent")}
            value={officeShare?.absent ?? data?.today?.absent ?? "—"}
            sub={
              (officeShare || data?.today) && data?.kpis.headcount
                ? `${Math.round(((officeShare?.absent ?? data?.today?.absent ?? 0) / Math.max(data.kpis.headcount, 1)) * 1000) / 10}% ${t("davomat.pctOfStaff")}`
                : undefined
            }
            icon={AlertTriangle}
            accent="bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200"
            loading={isLoading}
          />
          <KpiCard
            title={t("davomat.todayEarlyOut")}
            value={data?.today?.incomplete ?? data?.kpis.incompletePersonDays ?? "—"}
            sub={
              data?.today && data.kpis.headcount
                ? `${Math.round((data.today.incomplete / Math.max(data.kpis.headcount, 1)) * 1000) / 10}% ${t("davomat.pctOfStaff")}`
                : t("davomat.personDays")
            }
            icon={CalendarDays}
            accent="bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
            loading={isLoading}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel
            title={t("davomat.attDynamics")}
            className="xl:col-span-2"
            action={
              <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
                <button
                  type="button"
                  onClick={() => setDynamicsChart("line")}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                    dynamicsChart === "line"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
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
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                    dynamicsChart === "bar"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
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
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                    dynamicsChart === "both"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  title={t("davomat.chartBoth")}
                >
                  <ChartNoAxesCombined className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t("davomat.chartBoth")}</span>
                </button>
              </div>
            }
          >
            {isLoading ? (
              <Skeleton className="h-64 w-full rounded-xl" />
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
                    radius={[4, 4, 0, 0]}
                    maxBarSize={dynamicsData.length > 16 ? 12 : 22}
                  />
                  <Bar
                    dataKey="late"
                    name={t("davomat.lateShort")}
                    fill="#eab308"
                    legendType="none"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={dynamicsData.length > 16 ? 12 : 22}
                  />
                  <Bar
                    dataKey="absent"
                    name={t("davomat.absent")}
                    fill="#ef4444"
                    legendType="none"
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
                    radius={[4, 4, 0, 0]}
                    maxBarSize={dynamicsData.length > 16 ? 10 : 18}
                  />
                  <Bar
                    dataKey="late"
                    name={t("davomat.lateShort")}
                    fill="#eab308"
                    fillOpacity={0.85}
                    legendType="none"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={dynamicsData.length > 16 ? 10 : 18}
                  />
                  <Bar
                    dataKey="absent"
                    name={t("davomat.absent")}
                    fill="#ef4444"
                    fillOpacity={0.85}
                    legendType="none"
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

          <Panel title={shareTitle}>
            {isLoading ? (
              <Skeleton className="mx-auto h-64 w-64 rounded-full" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData.length ? pieData : [{ name: "—", value: 1, fill: "#cbd5e1" }]}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={2}
                  >
                    {(pieData.length ? pieData : [{ name: "—", value: 1, fill: "#cbd5e1" }]).map((entry, i) => (
                      <Cell key={`${entry.name}-${i}`} fill={entry.fill} />
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
          <Panel
            title={isPharmacySegment ? t("davomat.byBranchPharm") : t("davomat.byBranch")}
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
                {deptBreakdown.slice(0, 8).map((d) => (
                  <div key={d.name} className="analytics-inset !px-2.5 !py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-semibold">{d.name}</p>
                      <span className="text-sm font-bold tabular-nums text-emerald-600">{d.attendanceRate}%</span>
                    </div>
                    <Progress value={d.attendanceRate} className="h-2" />
                  </div>
                ))}
                {!deptBreakdown.length ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t("ui.empty")}</p>
                ) : null}
              </div>
            )}
          </Panel>

          <Panel title={t("davomat.byShiftCards")}>
            {isLoading ? (
              <Skeleton className="h-56 w-full rounded-xl" />
            ) : (
              <div className="grid gap-2">
                {(data?.byShift ?? []).slice(0, 4).map((s) => (
                  <div key={s.key} className="analytics-inset">
                    <p className="text-xs font-semibold">{s.label}</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{s.attendanceRate}%</p>
                    <p className="text-[11px] text-muted-foreground">
                      {s.present + s.late} / {s.headcount} {t("davomat.ofHeadcount")}
                    </p>
                    <Progress value={s.attendanceRate} className="mt-2 h-1.5" />
                  </div>
                ))}
                {!(data?.byShift ?? []).length ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t("ui.empty")}</p>
                ) : null}
              </div>
            )}
          </Panel>

          <Panel title={t("davomat.topDisciplined")}>
            {isLoading ? <Skeleton className="h-40 w-full rounded-xl" /> : <TopDisciplinedList departments={data?.byDepartment ?? []} />}
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-12">
          <Panel title={t("davomat.byRole")} className="lg:col-span-3">
            <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
              {(data?.byRole ?? []).map((r) => (
                <div key={r.key} className="analytics-inset !py-1.5 !px-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{r.label}</span>
                    <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">{r.attendanceRate}%</span>
                  </div>
                  <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                    <span>{r.headcount} {t("ui.employees").toLowerCase()}</span>
                    <span>{r.late} {t("davomat.lateWord")}</span>
                  </div>
                  <Progress value={r.attendanceRate} className="mt-1 h-1" />
                </div>
              ))}
              {!isLoading && !(data?.byRole ?? []).length ? (
                <p className="text-sm text-muted-foreground">{t("ui.empty")}</p>
              ) : null}
            </div>
          </Panel>

          {segment === "office" ? (
            <Panel title={t("davomat.officeDay")} className="lg:col-span-9">
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
            <Panel title={t("davomat.branchOpen")} className="lg:col-span-9">
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
          <Panel title={t("davomat.topLate")} bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="analytics-table w-full text-sm">
                <thead>
                  <tr>
                    <th>{t("ui.employee")}</th>
                    <th>{t("ui.department")}</th>
                    <th className="text-right">{t("davomat.col.day")}</th>
                    <th className="text-right">{t("davomat.col.min")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.topLate ?? []).map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer transition hover:bg-muted/60"
                      onClick={() => setLatePerson(r)}
                    >
                      <td className="font-medium text-primary underline-offset-2 hover:underline">{r.fullName}</td>
                      <td className="text-muted-foreground">{r.departmentName || "—"}</td>
                      <td className="text-right tabular-nums text-amber-600 dark:text-amber-400">{r.lateDays}</td>
                      <td className="text-right tabular-nums text-muted-foreground">
                        {formatLateHours(r.lateMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

          <Panel title={t("davomat.recentArrivals")} bodyClassName="p-0">
            <div className="max-h-80 overflow-y-auto overflow-x-auto">
              <table className="analytics-table w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>{t("ui.employee")}</th>
                    <th>{t("ui.department")}</th>
                    <th>{t("davomat.col.time")}</th>
                    <th className="text-right">{t("ui.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recentCheckins ?? []).map((r, i) => (
                    <tr
                      key={`${r.id ?? r.fullName}-${i}`}
                      className="cursor-pointer transition hover:bg-muted/60"
                      onClick={() => setArrivalPerson(r)}
                    >
                      <td className="font-medium text-primary underline-offset-2 hover:underline">{r.fullName}</td>
                      <td className="text-muted-foreground">{r.departmentName || "—"}</td>
                      <td className="tabular-nums text-muted-foreground">{r.checkIn}</td>
                      <td className="text-right">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            r.status === "late"
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : r.status === "incomplete"
                                ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
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

        <Panel title={t("davomat.deptTable")} bodyClassName="p-0" className="scroll-mt-24" id="davomat-breakdown-table">
          <div className="overflow-x-auto p-3">
            <table className="analytics-table analytics-table--sheet w-full min-w-[520px] table-fixed text-sm">
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[12%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className="!text-left">{isPharmacySegment ? t("davomat.colBranch") : t("ui.department")}</th>
                  <th className="!text-center">{t("ui.employee")}</th>
                  <th className="!text-center">{t("davomat.arrived")}</th>
                  <th className="!text-center">{t("davomat.lateShort")}</th>
                  <th className="!text-center">{t("davomat.absent")}</th>
                  <th className="!text-center">{t("davomat.chartAtt")}</th>
                </tr>
              </thead>
              <tbody>
                {breakdownRows.map((d) => (
                  <tr
                    key={d.name}
                    className="cursor-pointer transition"
                    onClick={() => setDeptRow(d as DeptRow)}
                  >
                    <td className="text-left font-medium text-primary underline-offset-2 hover:underline">{d.name}</td>
                    <td className="text-center tabular-nums">{d.headcount}</td>
                    <td className="text-center tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{d.present}</td>
                    <td className="text-center tabular-nums font-medium text-amber-600 dark:text-amber-400">{d.late}</td>
                    <td className="text-center tabular-nums font-medium text-rose-600 dark:text-rose-400">{d.absent}</td>
                    <td className="text-center font-semibold tabular-nums text-primary">{d.attendanceRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
