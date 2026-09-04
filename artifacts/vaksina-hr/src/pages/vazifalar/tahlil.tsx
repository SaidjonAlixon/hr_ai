import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetDepartments,
  useGetEmployees,
  useGetUsers,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Gauge,
  ListTodo,
  Plus,
  Search,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/i18n/I18nProvider";
import { useChartTheme } from "@/lib/chart-theme";
import { useGetTasks, type Vazifa } from "@/lib/vazifalar-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_COLORS = {
  completed: "#34d399",
  in_progress: "#60a5fa",
  todo: "#fbbf24",
  overdue: "#f87171",
  cancelled: "#94a3b8",
} as const;

const PRIORITY_COLORS = ["#ef4444", "#f97316", "#3b82f6", "#64748b"];
const TYPE_COLORS = ["#38bdf8", "#818cf8", "#34d399", "#fbbf24", "#fb7185", "#a78bfa", "#2dd4bf", "#94a3b8"];
const SOURCE_COLORS = ["#60a5fa", "#a78bfa", "#34d399", "#fbbf24", "#94a3b8"];

const WEEKDAYS_UZ = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
const WEEKDAYS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isClosed(task: Vazifa) {
  return task.status === "verified" || task.status === "cancelled";
}

function isOverdue(task: Vazifa, now = new Date()) {
  if (!task.dueAt || isClosed(task) || task.status === "verified") return false;
  if (task.status === "cancelled") return false;
  return new Date(task.dueAt).getTime() < startOfDay(now).getTime();
}

function isDueToday(task: Vazifa, now = new Date()) {
  if (!task.dueAt || isClosed(task)) return false;
  return startOfDay(new Date(task.dueAt)).getTime() === startOfDay(now).getTime();
}

function pctDelta(curr: number, prev: number) {
  if (prev <= 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function classifyType(task: Vazifa): string {
  const text = `${task.title} ${task.description || ""} ${task.pipelineStage || ""}`.toLowerCase();
  if (task.candidateId || /nomzod|suhbat|staj|hire|vacanc|ishga/.test(text)) return "employees";
  if (/hisobot|report|oylik|davomat|holat|tahlil/.test(text)) return "report";
  if (/hujjat|document|shartnoma|akt|fayl/.test(text)) return "document";
  if (/filial|apteka|branch|mudir|tarmoq/.test(text)) return "branch";
  if (/moliya|pul|to'?lov|budget|oylik|bonus|finance/.test(text)) return "finance";
  if (/texnik|remont|jihoz|equipment/.test(text)) return "technical";
  if (/operats|ombor|yetkaz|inventar|checklist|reviziya/.test(text)) return "operations";
  return "other";
}

function classifySource(task: Vazifa, creatorRole?: string): string {
  if (task.candidateId || /avto|auto|sistema/i.test(task.title)) return "auto";
  const role = (creatorRole || "").toLowerCase();
  if (role === "director" || role.includes("direktor")) return "director";
  if (role.includes("department") || role.includes("rahbar") || role === "mudir" || role === "koordinator") {
    return "leader";
  }
  if (/reja|plan|kpi|oylik/i.test(`${task.title} ${task.description || ""}`)) return "plan";
  return "other_dept";
}

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; payload?: { fill?: string } }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl backdrop-blur">
      {label ? <p className="mb-1 font-semibold">{label}</p> : null}
      {payload.map((p, i) => (
        <p key={`${p.name}-${i}`} className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: p.color || p.payload?.fill || "#64748b" }}
          />
          {p.name}: <strong>{p.value ?? 0}</strong>
        </p>
      ))}
    </div>
  );
}

function Panel({
  title,
  children,
  className,
  action,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {action}
      </div>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

function KpiCard({
  label,
  value,
  delta,
  icon,
  accent,
}: {
  label: string;
  value: number;
  delta?: number | null;
  icon: React.ReactNode;
  accent: string;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/80 bg-card p-3.5 shadow-sm transition hover:border-border hover:shadow-md">
      <div className={cn("absolute -right-4 -top-4 h-16 w-16 rounded-full opacity-15 blur-2xl dark:opacity-25", accent)} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-foreground">
            {value.toLocaleString()}
          </p>
          {delta != null ? (
            <p
              className={cn(
                "mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold",
                up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
              )}
            >
              {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {up ? "+" : ""}
              {delta}%
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground">—</p>
          )}
        </div>
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-inner",
            accent,
          )}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function Avatar({
  name,
  size = "md",
  online,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  online?: boolean | null;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const palettes = [
    "from-sky-500 to-blue-600",
    "from-violet-500 to-indigo-600",
    "from-emerald-500 to-teal-600",
    "from-amber-500 to-orange-600",
    "from-rose-500 to-pink-600",
    "from-cyan-500 to-sky-600",
    "from-fuchsia-500 to-purple-600",
  ];
  const tone = palettes[hash % palettes.length];
  const dim =
    size === "lg" ? "h-11 w-11 text-sm" : size === "sm" ? "h-8 w-8 text-[10px]" : "h-9 w-9 text-[11px]";
  return (
    <div className="relative shrink-0">
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-gradient-to-br font-bold text-white shadow-sm",
          tone,
          dim,
        )}
      >
        {initials || "?"}
      </div>
      {online != null ? (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-card shadow-sm",
            size === "lg" ? "h-3.5 w-3.5" : "h-3 w-3",
            online
              ? "bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.25)]"
              : "bg-slate-400 dark:bg-slate-500",
          )}
          title={online ? "Online" : "Offline"}
        />
      ) : null}
    </div>
  );
}

function presenceOnline(lastActiveAt: string | null | undefined, now: Date) {
  if (!lastActiveAt) return false;
  return now.getTime() - new Date(lastActiveAt).getTime() <= 30 * 60 * 1000;
}

function statusMeta(
  task: Vazifa,
  now: Date,
  t: (key: string, fallback?: string) => string,
): { label: string; tone: string; dot: string } {
  if (isOverdue(task, now)) {
    return {
      label: t("tasks.analytics.status.overdue"),
      tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
      dot: "bg-rose-500",
    };
  }
  if (task.extensionStatus === "pending") {
    return {
      label: t("tasks.analytics.act.extension"),
      tone: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
      dot: "bg-amber-500",
    };
  }
  switch (task.status) {
    case "verified":
      return {
        label: t("tasks.analytics.act.verified"),
        tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
        dot: "bg-emerald-500",
      };
    case "done":
      return {
        label: t("tasks.analytics.act.done"),
        tone: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
        dot: "bg-cyan-500",
      };
    case "in_progress":
      return {
        label: t("tasks.analytics.act.progress"),
        tone: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
        dot: "bg-sky-500",
      };
    case "cancelled":
      return {
        label: t("tasks.analytics.act.cancelled"),
        tone: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
        dot: "bg-slate-400",
      };
    default:
      return {
        label: t("tasks.analytics.status.new"),
        tone: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
        dot: "bg-violet-500",
      };
  }
}

function kpiTone(kpi: number, good?: boolean) {
  if (good || kpi >= 85) return "bg-emerald-500";
  if (kpi >= 60) return "bg-sky-500";
  if (kpi >= 40) return "bg-amber-500";
  return "bg-rose-500";
}

function kpiText(kpi: number, good?: boolean) {
  if (good || kpi >= 85) return "text-emerald-600 dark:text-emerald-400";
  if (kpi >= 60) return "text-sky-600 dark:text-sky-400";
  if (kpi >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  const pts = data
    .map((v, i) => {
      const x = data.length <= 1 ? 0 : (i / (data.length - 1)) * 100;
      const y = 28 - (v / max) * 24;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 32" className="h-8 w-full" preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

export default function VazifalarTahlilPage() {
  const { t, locale } = useI18n();
  const chart = useChartTheme();
  const { data: tasks = [], isLoading } = useGetTasks({ board: "all" });
  const { data: users = [] } = useGetUsers({ status: "active" } as any);
  const { data: employees = [] } = useGetEmployees();
  const { data: departments = [] } = useGetDepartments();

  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<"today" | "7d" | "30d" | "all">("30d");
  const [branch, setBranch] = useState("all");
  const [dept, setDept] = useState("all");
  const [calMonth, setCalMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const now = useMemo(() => new Date(), []);
  const weekdays = locale === "ru" ? WEEKDAYS_RU : WEEKDAYS_UZ;

  const tr = (key: string, vars?: Record<string, string | number>, fallback?: string) => {
    let s = t(key, fallback);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replaceAll(`{${k}}`, String(v));
      }
    }
    return s;
  };

  const userById = useMemo(() => {
    const m = new Map<number, any>();
    for (const u of users as any[]) m.set(u.id, u);
    return m;
  }, [users]);

  const empById = useMemo(() => {
    const m = new Map<number, any>();
    for (const e of employees as any[]) m.set(e.id, e);
    return m;
  }, [employees]);

  const branches = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees as any[]) {
      const loc = (e.location || "").trim();
      if (loc) set.add(loc);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "uz"));
  }, [employees]);

  const periodWindow = useMemo(() => {
    if (period === "all") return { from: null as Date | null, prevFrom: null as Date | null, prevTo: null as Date | null };
    if (period === "today") {
      const from = startOfDay(now);
      return { from, prevFrom: addDays(from, -1), prevTo: from };
    }
    const days = period === "7d" ? 7 : 30;
    const from = addDays(startOfDay(now), -days);
    return { from, prevFrom: addDays(from, -days), prevTo: from };
  }, [period, now]);

  const enriched = useMemo(() => {
    return tasks.map((task) => {
      const assigneeEmp =
        task.assigneeKind === "employee" ? empById.get(task.assigneeId) : null;
      const assigneeUser =
        task.assigneeKind === "user" ? userById.get(task.assigneeId) : null;
      const creator = userById.get(task.createdById);
      const location =
        assigneeEmp?.location ||
        assigneeUser?.location ||
        creator?.location ||
        "";
      const departmentId =
        assigneeEmp?.departmentId ??
        assigneeUser?.departmentId ??
        creator?.departmentId ??
        null;
      return {
        task,
        location: String(location || ""),
        departmentId: departmentId as number | null,
        creatorRole: String(creator?.role || ""),
        type: classifyType(task),
        source: classifySource(task, creator?.role),
      };
    });
  }, [tasks, empById, userById]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return enriched.filter(({ task, location, departmentId }) => {
      if (periodWindow.from) {
        if (new Date(task.createdAt).getTime() < periodWindow.from.getTime()) return false;
      }
      if (branch !== "all" && location !== branch) return false;
      if (dept !== "all" && String(departmentId || "") !== dept) return false;
      if (!s) return true;
      return (
        task.title.toLowerCase().includes(s) ||
        (task.assigneeName || "").toLowerCase().includes(s) ||
        (task.createdByName || "").toLowerCase().includes(s) ||
        String(task.id).includes(s) ||
        (task.description || "").toLowerCase().includes(s)
      );
    });
  }, [enriched, q, periodWindow, branch, dept]);

  const prevFiltered = useMemo(() => {
    if (!periodWindow.prevFrom || !periodWindow.prevTo) return [] as typeof enriched;
    return enriched.filter(({ task, location, departmentId }) => {
      const created = new Date(task.createdAt).getTime();
      if (created < periodWindow.prevFrom!.getTime() || created >= periodWindow.prevTo!.getTime()) {
        return false;
      }
      if (branch !== "all" && location !== branch) return false;
      if (dept !== "all" && String(departmentId || "") !== dept) return false;
      return true;
    });
  }, [enriched, periodWindow, branch, dept]);

  const stats = useMemo(() => {
    const list = filtered.map((x) => x.task);
    const prev = prevFiltered.map((x) => x.task);
    const count = (arr: Vazifa[], fn: (t: Vazifa) => boolean) => arr.filter(fn).length;
    const total = list.length;
    const todo = count(list, (x) => x.status === "todo" && !isOverdue(x, now));
    const inProgress = count(list, (x) => x.status === "in_progress" && !isOverdue(x, now));
    const completed = count(list, (x) => x.status === "verified" || x.status === "done");
    const overdue = count(list, (x) => isOverdue(x, now));
    const dueToday = count(list, (x) => isDueToday(x, now));
    const awaiting = count(list, (x) => x.status === "done");
    const atRisk = count(list, (x) => {
      if (!x.dueAt || isClosed(x)) return false;
      const due = startOfDay(new Date(x.dueAt)).getTime();
      const today = startOfDay(now).getTime();
      const in3 = addDays(startOfDay(now), 3).getTime();
      return due >= today && due <= in3 && (x.priority === "high" || x.priority === "urgent");
    });
    const cancelled = count(list, (x) => x.status === "cancelled");
    const verified = count(list, (x) => x.status === "verified");
    const doneOnly = count(list, (x) => x.status === "done");

    const pTotal = prev.length;
    const pTodo = count(prev, (x) => x.status === "todo");
    const pIn = count(prev, (x) => x.status === "in_progress");
    const pDone = count(prev, (x) => x.status === "verified" || x.status === "done");
    const pOver = count(prev, (x) => isOverdue(x, periodWindow.prevTo || now));

    return {
      total,
      todo,
      inProgress,
      completed,
      overdue,
      dueToday,
      awaiting,
      atRisk,
      cancelled,
      verified,
      doneOnly,
      dTotal: period === "all" ? null : pctDelta(total, pTotal),
      dTodo: period === "all" ? null : pctDelta(todo, pTodo),
      dIn: period === "all" ? null : pctDelta(inProgress, pIn),
      dDone: period === "all" ? null : pctDelta(completed, pDone),
      dOver: period === "all" ? null : pctDelta(overdue, pOver),
    };
  }, [filtered, prevFiltered, now, period, periodWindow.prevTo]);

  const statusPie = useMemo(() => {
    const rows = [
      { name: t("tasks.analytics.completed"), value: stats.completed, color: STATUS_COLORS.completed },
      { name: t("tasks.analytics.inProgress"), value: stats.inProgress, color: STATUS_COLORS.in_progress },
      { name: t("tasks.analytics.new"), value: stats.todo, color: STATUS_COLORS.todo },
      { name: t("tasks.analytics.overdue"), value: stats.overdue, color: STATUS_COLORS.overdue },
      { name: t("tasks.analytics.cancelled"), value: stats.cancelled, color: STATUS_COLORS.cancelled },
    ].filter((x) => x.value > 0);
    return rows;
  }, [stats, t]);

  const dynamics = useMemo(() => {
    const days = period === "7d" || period === "today" ? 7 : 30;
    const rows: { day: string; created: number; completed: number; overdue: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(startOfDay(now), -i);
      const key = dayKey(d);
      const label = `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
      const created = filtered.filter((x) => dayKey(new Date(x.task.createdAt)) === key).length;
      const completed = filtered.filter(
        (x) => x.task.completedAt && dayKey(new Date(x.task.completedAt)) === key,
      ).length;
      const overdue = filtered.filter((x) => {
        if (!x.task.dueAt) return false;
        return dayKey(new Date(x.task.dueAt)) === key && isOverdue(x.task, addDays(d, 1));
      }).length;
      rows.push({ day: label, created, completed, overdue });
    }
    return rows;
  }, [filtered, now, period]);

  const deadlineBars = useMemo(() => {
    const buckets = [
      { key: "today", label: t("ui.today"), count: 0, fill: "#fbbf24" },
      { key: "tomorrow", label: t("tasks.tomorrow"), count: 0, fill: "#60a5fa" },
      { key: "3d", label: t("tasks.analytics.in3d"), count: 0, fill: "#a78bfa" },
      { key: "week", label: t("tasks.analytics.in7d"), count: 0, fill: "#34d399" },
      { key: "overdue", label: t("tasks.overdue"), count: 0, fill: "#f87171" },
    ];
    const today = startOfDay(now).getTime();
    for (const { task } of filtered) {
      if (isClosed(task) || task.status === "verified") continue;
      if (task.status === "cancelled") continue;
      if (!task.dueAt) continue;
      const due = startOfDay(new Date(task.dueAt)).getTime();
      if (due < today) buckets[4]!.count += 1;
      else if (due === today) buckets[0]!.count += 1;
      else if (due === addDays(startOfDay(now), 1).getTime()) buckets[1]!.count += 1;
      else if (due <= addDays(startOfDay(now), 3).getTime()) buckets[2]!.count += 1;
      else if (due <= addDays(startOfDay(now), 7).getTime()) buckets[3]!.count += 1;
    }
    return buckets;
  }, [filtered, now, t]);

  const priorityBars = useMemo(() => {
    const order = ["urgent", "high", "normal", "low"] as const;
    const labels: Record<(typeof order)[number], string> = {
      urgent: t("tasks.analytics.critical"),
      high: t("tasks.priority.high"),
      normal: t("tasks.analytics.medium"),
      low: t("tasks.priority.low"),
    };
    return order.map((p, i) => ({
      name: labels[p],
      value: filtered.filter((x) => x.task.priority === p).length,
      fill: PRIORITY_COLORS[i],
    }));
  }, [filtered, t]);

  const typeBars = useMemo(() => {
    const keys = [
      "report",
      "document",
      "employees",
      "branch",
      "finance",
      "operations",
      "technical",
      "other",
    ] as const;
    const labels: Record<(typeof keys)[number], string> = {
      report: t("tasks.analytics.type.report"),
      document: t("tasks.analytics.type.document"),
      employees: t("tasks.analytics.type.employees"),
      branch: t("tasks.analytics.type.branch"),
      finance: t("tasks.analytics.type.finance"),
      operations: t("tasks.analytics.type.operations"),
      technical: t("tasks.analytics.type.technical"),
      other: t("tasks.analytics.type.other"),
    };
    const max = Math.max(1, ...keys.map((k) => filtered.filter((x) => x.type === k).length));
    return keys.map((k, i) => {
      const value = filtered.filter((x) => x.type === k).length;
      return { key: k, name: labels[k], value, pct: Math.round((value / max) * 100), fill: TYPE_COLORS[i]! };
    });
  }, [filtered, t]);

  const sourcePie = useMemo(() => {
    const keys = ["leader", "director", "plan", "auto", "other_dept"] as const;
    const labels: Record<(typeof keys)[number], string> = {
      leader: t("tasks.analytics.source.leader"),
      director: t("tasks.analytics.source.director"),
      plan: t("tasks.analytics.source.plan"),
      auto: t("tasks.analytics.source.auto"),
      other_dept: t("tasks.analytics.source.other"),
    };
    return keys
      .map((k, i) => ({
        name: labels[k],
        value: filtered.filter((x) => x.source === k).length,
        color: SOURCE_COLORS[i]!,
      }))
      .filter((x) => x.value > 0);
  }, [filtered, t]);

  const calendarCells = useMemo(() => {
    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    const first = new Date(y, m, 1);
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const dueMap = new Map<string, { count: number; urgent: boolean }>();
    for (const { task } of filtered) {
      if (!task.dueAt) continue;
      const d = new Date(task.dueAt);
      if (d.getFullYear() !== y || d.getMonth() !== m) continue;
      const key = dayKey(d);
      const cur = dueMap.get(key) || { count: 0, urgent: false };
      cur.count += 1;
      if (task.priority === "urgent" || task.priority === "high" || isOverdue(task, now)) cur.urgent = true;
      dueMap.set(key, cur);
    }
    const cells: { day: number | null; key?: string; count: number; urgent: boolean; isToday: boolean }[] = [];
    for (let i = 0; i < startPad; i++) cells.push({ day: null, count: 0, urgent: false, isToday: false });
    const todayKey = dayKey(now);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = dayKey(new Date(y, m, d));
      const info = dueMap.get(key);
      cells.push({
        day: d,
        key,
        count: info?.count || 0,
        urgent: !!info?.urgent,
        isToday: key === todayKey,
      });
    }
    while (cells.length % 7 !== 0) cells.push({ day: null, count: 0, urgent: false, isToday: false });
    return cells;
  }, [calMonth, filtered, now]);

  const people = useMemo(() => {
    // Period filtrisiz — doskadagi ijrochi filtri bilan bir xil hisob
    const source = enriched.filter(({ location, departmentId, task }) => {
      if (branch !== "all" && location !== branch) return false;
      if (dept !== "all" && String(departmentId || "") !== dept) return false;
      if (!(task.assigneeName || "").trim()) return false;
      return true;
    });
    const map = new Map<
      string,
      {
        name: string;
        total: number;
        done: number;
        overdue: number;
        open: number;
        lastActiveAt: string | null;
        href: string;
      }
    >();
    for (const { task } of source) {
      const name = (task.assigneeName || "").trim();
      const key = `${task.assigneeKind}:${task.assigneeId}`;
      const cur = map.get(key) || {
        name,
        total: 0,
        done: 0,
        overdue: 0,
        open: 0,
        lastActiveAt: null as string | null,
        href: `/vazifalar?assigneeKind=${encodeURIComponent(task.assigneeKind)}&assigneeId=${task.assigneeId}`,
      };
      cur.total += 1;
      if (task.status === "verified" || task.status === "done") cur.done += 1;
      else if (task.status !== "cancelled") cur.open += 1;
      if (isOverdue(task, now)) cur.overdue += 1;
      if (!cur.lastActiveAt || new Date(task.updatedAt) > new Date(cur.lastActiveAt)) {
        cur.lastActiveAt = task.updatedAt;
      }
      map.set(key, cur);
    }
    const rows = [...map.values()].map((r) => ({
      ...r,
      kpi: r.total ? Math.round((r.done / r.total) * 100) : 0,
      online: presenceOnline(r.lastActiveAt, now),
    }));
    const ranked = rows.filter((r) => r.total >= 1);
    return {
      top: [...ranked]
        .sort((a, b) => b.kpi - a.kpi || b.done - a.done || a.overdue - b.overdue)
        .slice(0, 5),
      worst: [...ranked]
        .sort((a, b) => a.kpi - b.kpi || b.overdue - a.overdue || b.open - a.open)
        .slice(0, 5),
      unique: ranked.length,
    };
  }, [enriched, branch, dept, now]);

  const recent = useMemo(() => {
    return [...filtered]
      .map((x) => x.task)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 8)
      .map((task) => ({
        task,
        meta: statusMeta(task, now, t),
        online: presenceOnline(task.updatedAt, now),
        href: `/vazifalar?task=${task.id}`,
      }));
  }, [filtered, now, t]);

  const footer = useMemo(() => {
    const completedTasks = filtered
      .map((x) => x.task)
      .filter((t) => t.completedAt && t.createdAt);
    let avgDays = 0;
    if (completedTasks.length) {
      const sum = completedTasks.reduce((acc, t) => {
        const ms = new Date(t.completedAt!).getTime() - new Date(t.createdAt).getTime();
        return acc + ms / (1000 * 60 * 60 * 24);
      }, 0);
      avgDays = Math.round((sum / completedTasks.length) * 10) / 10;
    }
    const discipline = stats.total ? Math.round(((stats.total - stats.overdue) / stats.total) * 100) : 100;
    const efficiency = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
    const spark = dynamics.map((d) => d.completed);
    const sparkCreate = dynamics.map((d) => d.created);
    return { avgDays, discipline, efficiency, spark, sparkCreate };
  }, [filtered, stats, dynamics]);

  const aiLines = useMemo(() => {
    const lines: string[] = [];
    lines.push(
      tr("tasks.analytics.ai.line1", {
        total: stats.total,
        done: stats.completed,
        pct: footer.efficiency,
      }),
    );
    if (stats.overdue > 0) {
      lines.push(tr("tasks.analytics.ai.lineOverdue", { n: stats.overdue }));
    } else {
      lines.push(tr("tasks.analytics.ai.lineOk"));
    }
    if (stats.dueToday > 0) {
      lines.push(tr("tasks.analytics.ai.lineToday", { n: stats.dueToday }));
    }
    lines.push(tr("tasks.analytics.ai.lineDiscipline", { pct: footer.discipline }));
    return lines;
  }, [stats, footer, t, locale]);

  const alerts = useMemo(() => {
    const items: string[] = [];
    const in24 = filtered.filter(({ task }) => {
      if (!task.dueAt || isClosed(task)) return false;
      const ms = new Date(task.dueAt).getTime() - now.getTime();
      return ms > 0 && ms <= 24 * 60 * 60 * 1000;
    }).length;
    if (in24) items.push(tr("tasks.analytics.alert.in24", { n: in24 }));
    if (stats.overdue) items.push(tr("tasks.analytics.alert.overdue", { n: stats.overdue }));
    const stale = filtered.filter(({ task }) => {
      if (isClosed(task) || task.status === "verified") return false;
      const idle = now.getTime() - new Date(task.updatedAt).getTime();
      return idle > 5 * 24 * 60 * 60 * 1000;
    }).length;
    if (stale) items.push(tr("tasks.analytics.alert.stale", { n: stale }));
    const overloaded = people.worst.filter((p) => p.overdue >= 2 || p.kpi < 50).length;
    if (overloaded) items.push(tr("tasks.analytics.alert.load", { n: overloaded }));
    if (stats.awaiting) items.push(tr("tasks.analytics.alert.await", { n: stats.awaiting }));
    return items;
  }, [filtered, now, stats, people.worst, t, locale]);

  const monthLabel = calMonth.toLocaleDateString(locale === "ru" ? "ru-RU" : "uz-UZ", {
    month: "long",
    year: "numeric",
  });

  const selectCls =
    "h-9 rounded-full border-border bg-background text-xs text-foreground focus:ring-sky-500/40";

  return (
    <div className="relative h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(14,165,233,0.06),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(99,102,241,0.05),_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.08),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(129,140,248,0.07),_transparent_50%)]" />

      <div className="relative border-b border-border/80 bg-card/90 px-3 py-3 backdrop-blur-xl sm:px-5">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-400/80">
              {t("nav.section.work")}
            </p>
            <h1 className="mt-0.5 flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/15 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300">
                <BarChart3 className="h-4 w-4" />
              </span>
              {t("tasks.analytics.panelTitle")}
            </h1>
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 xl:justify-center">
            <div className="relative min-w-[200px] flex-1 xl:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("tasks.analytics.search")}
                className="h-9 rounded-full bg-background pl-9 text-sm"
              />
            </div>
            <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
              <SelectTrigger className={cn(selectCls, "w-[120px]")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">{t("ui.today")}</SelectItem>
                <SelectItem value="7d">{t("davomat.days7")}</SelectItem>
                <SelectItem value="30d">{t("davomat.days30")}</SelectItem>
                <SelectItem value="all">{t("ui.all")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={branch} onValueChange={setBranch}>
              <SelectTrigger className={cn(selectCls, "w-[150px]")}>
                <SelectValue placeholder={t("ui.allBranches")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ui.allBranches")}</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className={cn(selectCls, "w-[150px]")}>
                <SelectValue placeholder={t("ui.allDepartments")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ui.allDepartments")}</SelectItem>
                {(departments as any[]).map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild className="h-9 rounded-full bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-400">
              <Link href="/vazifalar">
                <Plus className="mr-1.5 h-4 w-4" />
                {t("tasks.analytics.assign")}
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-[1480px] space-y-4 p-3 sm:space-y-5 sm:p-5">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[92px] rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
            <KpiCard label={t("tasks.analytics.total")} value={stats.total} delta={stats.dTotal} icon={<ListTodo className="h-4 w-4" />} accent="bg-sky-500" />
            <KpiCard label={t("tasks.analytics.new")} value={stats.todo} delta={stats.dTodo} icon={<Plus className="h-4 w-4" />} accent="bg-amber-500" />
            <KpiCard label={t("tasks.analytics.inProgress")} value={stats.inProgress} delta={stats.dIn} icon={<Clock3 className="h-4 w-4" />} accent="bg-blue-500" />
            <KpiCard label={t("tasks.analytics.completed")} value={stats.completed} delta={stats.dDone} icon={<CheckCircle2 className="h-4 w-4" />} accent="bg-emerald-500" />
            <KpiCard label={t("tasks.analytics.overdue")} value={stats.overdue} delta={stats.dOver} icon={<AlertTriangle className="h-4 w-4" />} accent="bg-rose-500" />
            <KpiCard label={t("tasks.analytics.dueToday")} value={stats.dueToday} delta={null} icon={<CalendarDays className="h-4 w-4" />} accent="bg-orange-500" />
            <KpiCard label={t("tasks.analytics.atRisk")} value={stats.atRisk} delta={null} icon={<Zap className="h-4 w-4" />} accent="bg-violet-500" />
            <KpiCard label={t("tasks.analytics.awaiting")} value={stats.awaiting} delta={null} icon={<FileText className="h-4 w-4" />} accent="bg-cyan-500" />
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-12">
          <Panel title={t("tasks.analytics.statusTitle")} className="xl:col-span-3">
            <div className="relative h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusPie}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={58}
                    outerRadius={82}
                    paddingAngle={3}
                    stroke="transparent"
                  >
                    {statusPie.map((s) => (
                      <Cell key={s.name} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-2xl font-bold tabular-nums text-foreground">{stats.total}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("tasks.analytics.totalShort")}
                </p>
              </div>
            </div>
            <ul className="mt-1 space-y-1.5">
              {statusPie.map((s) => {
                const pct = stats.total ? Math.round((s.value / stats.total) * 100) : 0;
                return (
                  <li key={s.name} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-2 text-foreground/80">
                      <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </span>
                    <span className="tabular-nums">
                      {s.value} · {pct}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title={t("tasks.analytics.dynamics")} className="xl:col-span-5">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dynamics}>
                  <defs>
                    <linearGradient id="gCreated" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#60a5fa" stopOpacity={chart.isDark ? 0.45 : 0.3} />
                      <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gDone" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={chart.isDark ? 0.4 : 0.28} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="day" tick={{ fill: chart.tick, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: chart.tick, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Area type="monotone" dataKey="created" name={t("tasks.analytics.created")} stroke="#60a5fa" fill="url(#gCreated)" strokeWidth={2} />
                  <Area type="monotone" dataKey="completed" name={t("tasks.analytics.completedSeries")} stroke="#34d399" fill="url(#gDone)" strokeWidth={2} />
                  <Line type="monotone" dataKey="overdue" name={t("tasks.overdue")} stroke="#f87171" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" /> {t("tasks.analytics.created")}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> {t("tasks.analytics.completedSeries")}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" /> {t("tasks.overdue")}</span>
            </div>
          </Panel>

          <Panel title={t("tasks.analytics.deadlines")} className="xl:col-span-2">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deadlineBars} layout="vertical" margin={{ left: 4, right: 8 }}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: chart.tick, fontSize: 10 }} axisLine={false} />
                  <YAxis type="category" dataKey="label" width={72} tick={{ fill: chart.tick, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="count" name={t("tasks.analytics.total")} radius={[0, 8, 8, 0]}>
                    {deadlineBars.map((b) => (
                      <Cell key={b.key} fill={b.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel
            title={t("tasks.analytics.calendar")}
            className="xl:col-span-2"
            action={
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-md px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="rounded-md px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
                >
                  ›
                </button>
              </div>
            }
          >
            <p className="mb-2 text-center text-xs font-semibold capitalize text-foreground/80">{monthLabel}</p>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
              {weekdays.map((d) => (
                <div key={d} className="py-1 font-semibold">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarCells.map((c, i) => (
                <div
                  key={i}
                  className={cn(
                    "relative flex aspect-square flex-col items-center justify-center rounded-lg text-[11px]",
                    c.day ? "bg-muted/50 text-foreground/80" : "opacity-0",
                    c.isToday && "bg-sky-500/15 text-sky-700 ring-1 ring-sky-400/80 dark:text-sky-200",
                  )}
                >
                  {c.day}
                  {c.count > 0 ? (
                    <span
                      className={cn(
                        "absolute bottom-1 h-1.5 w-1.5 rounded-full",
                        c.urgent ? "bg-amber-400" : "bg-sky-400",
                      )}
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> {t("tasks.analytics.calTasks")}</span>
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> {t("tasks.analytics.calImportant")}</span>
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
          <Panel title={t("tasks.analytics.byPriority")} className="xl:col-span-3">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={priorityBars}>
                  <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: chart.tick, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: chart.tick, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="value" name={t("tasks.analytics.total")} radius={[8, 8, 0, 0]}>
                    {priorityBars.map((p) => (
                      <Cell key={p.name} fill={p.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title={t("tasks.analytics.byType")} className="xl:col-span-3">
            <div className="space-y-2.5">
              {typeBars.map((row) => (
                <div key={row.key}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{row.name}</span>
                    <span className="tabular-nums font-semibold text-foreground">{row.value}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${row.pct}%`, background: row.fill }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={t("tasks.analytics.bySource")} className="xl:col-span-3">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sourcePie} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2} stroke="transparent">
                    {sourcePie.map((s) => (
                      <Cell key={s.name} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-1 space-y-1">
              {sourcePie.map((s) => (
                <li key={s.name} className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-2 text-foreground/80">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.name}
                  </span>
                  <span className="tabular-nums">{s.value}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="flex flex-col gap-4 xl:col-span-3">
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-50/80 p-4 shadow-sm dark:border-emerald-400/20 dark:bg-gradient-to-br dark:from-emerald-500/15 dark:to-emerald-900/10">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                  <Bot className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">{t("tasks.analytics.summary")}</p>
                  <p className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70">{t("tasks.analytics.aiBadge")}</p>
                </div>
                <Sparkles className="ml-auto h-4 w-4 text-emerald-600/50 dark:text-emerald-300/60" />
              </div>
              <ul className="space-y-1.5 text-xs leading-relaxed text-emerald-950/90 dark:text-emerald-50/90">
                {aiLines.map((line, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-300" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative flex-1 rounded-2xl border border-rose-500/25 bg-rose-50/80 p-4 shadow-sm dark:border-rose-400/25 dark:bg-gradient-to-br dark:from-rose-500/15 dark:to-rose-950/20">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/15 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">{t("tasks.analytics.attention")}</p>
                {alerts.length ? (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                    {alerts.length}
                  </span>
                ) : null}
              </div>
              {alerts.length ? (
                <ul className="space-y-1.5 text-xs text-rose-950/90 dark:text-rose-50/90">
                  {alerts.map((a, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rose-500 dark:bg-rose-300" />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-rose-800/70 dark:text-rose-100/70">{t("tasks.analytics.noAlerts")}</p>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
          <PeopleTable
            title={t("tasks.analytics.topPeople")}
            rows={people.top}
            empty={t("tasks.analytics.emptyPeople")}
            good
            className="xl:col-span-4"
          />
          <PeopleTable
            title={t("tasks.analytics.problemPeople")}
            rows={people.worst}
            empty={t("tasks.analytics.emptyPeople")}
            className="xl:col-span-4"
          />
          <Panel title={t("tasks.analytics.recent")} className="xl:col-span-4">
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("ui.empty")}</p>
            ) : (
              <ul className="space-y-2">
                {recent.map(({ task, meta, online, href }) => (
                  <li key={task.id}>
                    <Link
                      href={href}
                      className="group flex gap-3 rounded-2xl border border-border/70 bg-gradient-to-r from-muted/30 to-transparent px-3 py-3 transition hover:border-sky-300/60 hover:from-sky-500/10 hover:shadow-sm dark:hover:border-sky-500/40"
                    >
                      <Avatar
                        name={task.assigneeName || task.createdByName || "?"}
                        size="lg"
                        online={online}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground group-hover:text-sky-700 dark:group-hover:text-sky-300">
                              {task.assigneeName || task.createdByName || "—"}
                            </p>
                            <p className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 font-semibold",
                                  online
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-muted-foreground",
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    online ? "bg-emerald-500 animate-pulse" : "bg-slate-400",
                                  )}
                                />
                                {online ? t("common.onlineStatus") : t("tasks.analytics.offline")}
                              </span>
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                            {new Date(task.updatedAt).toLocaleString(locale === "ru" ? "ru-RU" : "uz-UZ", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                          {task.title}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", meta.tone)}>
                            {meta.label}
                          </span>
                          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
                            TK-{task.id}
                          </span>
                          <span className="ml-auto text-[10px] font-medium text-sky-600 opacity-0 transition group-hover:opacity-100 dark:text-sky-400">
                            {t("tasks.analytics.openTask")} →
                          </span>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <FooterStat
            label={t("tasks.analytics.staffCount")}
            value={String(people.unique)}
            delta={null}
            icon={<Users className="h-4 w-4" />}
          >
            <Sparkline data={footer.sparkCreate.length ? footer.sparkCreate : [0, 1, 0]} color="#38bdf8" />
          </FooterStat>
          <FooterStat
            label={t("tasks.analytics.avgTime")}
            value={`${footer.avgDays} ${t("tasks.analytics.days")}`}
            delta={null}
            icon={<Timer className="h-4 w-4" />}
          >
            <Sparkline data={footer.spark.length ? footer.spark : [1, 2, 1]} color="#818cf8" />
          </FooterStat>
          <FooterStat
            label={t("tasks.analytics.discipline")}
            value={`${footer.discipline}%`}
            delta={null}
            icon={<Gauge className="h-4 w-4" />}
          >
            <div className="flex h-8 items-end gap-0.5">
              {[40, 55, 48, 70, 62, 80, footer.discipline].map((v, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-emerald-400/80"
                  style={{ height: `${Math.max(12, v)}%` }}
                />
              ))}
            </div>
          </FooterStat>
          <FooterStat
            label={t("tasks.analytics.efficiency")}
            value={`${footer.efficiency}%`}
            delta={null}
            icon={<TrendingUp className="h-4 w-4" />}
          >
            <Sparkline data={footer.spark.length ? footer.spark : [2, 3, 4]} color="#34d399" />
          </FooterStat>
        </div>
      </div>
    </div>
  );
}

function FooterStat({
  label,
  value,
  icon,
  children,
}: {
  label: string;
  value: string;
  delta: number | null;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{value}</p>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground">{icon}</div>
      </div>
      {children}
    </div>
  );
}

function PeopleTable({
  title,
  rows,
  empty,
  good,
  className,
}: {
  title: string;
  rows: {
    name: string;
    total: number;
    done: number;
    overdue: number;
    kpi: number;
    online?: boolean;
    href?: string;
  }[];
  empty: string;
  good?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Panel
      title={title}
      className={className}
      action={
        <Link
          href="/vazifalar"
          className="text-[11px] font-semibold text-sky-600 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300"
        >
          {t("tasks.analytics.details")}
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, idx) => {
            const body = (
              <div className="flex w-full min-w-0 items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-background text-[11px] font-bold tabular-nums text-muted-foreground shadow-sm ring-1 ring-border/60">
                  {idx + 1}
                </span>
                <Avatar name={r.name} size="md" online={r.online ?? false} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-foreground group-hover:text-sky-700 dark:group-hover:text-sky-300">
                      {r.name}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                        kpiText(r.kpi, good),
                        "bg-muted/80",
                      )}
                    >
                      {r.kpi}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[10px]">
                    <span className="rounded-md bg-muted px-1.5 py-1 text-center text-muted-foreground">
                      {t("tasks.analytics.col.total")}{" "}
                      <strong className="text-foreground">{r.total}</strong>
                    </span>
                    <span className="rounded-md bg-emerald-500/10 px-1.5 py-1 text-center text-emerald-700 dark:text-emerald-300">
                      {t("tasks.analytics.col.done")} <strong>{r.done}</strong>
                    </span>
                    <span className="rounded-md bg-rose-500/10 px-1.5 py-1 text-center text-rose-700 dark:text-rose-300">
                      {t("tasks.analytics.col.late")} <strong>{r.overdue}</strong>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full transition-all", kpiTone(r.kpi, good))}
                      style={{ width: `${Math.max(r.kpi, r.kpi > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
            return (
              <li key={`${r.name}-${idx}`}>
                {r.href ? (
                  <Link
                    href={r.href}
                    className="group block rounded-2xl border border-border/70 bg-muted/15 px-3 py-2.5 transition hover:border-sky-300/70 hover:bg-sky-500/5 hover:shadow-sm dark:hover:border-sky-500/40"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="rounded-2xl border border-border/70 bg-muted/15 px-3 py-2.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
