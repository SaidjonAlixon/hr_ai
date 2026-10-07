import React, { useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Hand,
  Info,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  Search,
  Store,
  Timer,
  Unlock,
  User,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { scriptIncludes } from "@/lib/script-search";
import {
  approveAllPresenceUnlocks,
  approvePresenceUnlock,
  forceCheckoutVisit,
  useVisitMonitor,
  type CoordinatorVisitSession,
  type VisitPhase,
} from "@/lib/branch-audits-api";
import { PHASE_META, PhaseBadge, fmtDateLong, fmtHm, minutesLabel, phaseOf } from "./visit-phase";

type QuickFilter = "all" | "open" | "action" | "no_checklist" | "closed" | "office";
type Preset = "today" | "yesterday" | "week" | "month" | "custom";

const EPOCH = "2026-10-01";

const QUICK: Array<{ key: QuickFilter; label: string; match: (p: VisitPhase) => boolean }> = [
  { key: "all", label: "Hammasi", match: () => true },
  {
    key: "action",
    label: "Ruxsat kerak",
    match: (p) => p === "unlock_requested" || p === "blocked",
  },
  {
    key: "open",
    label: "Hozir filialda",
    match: (p) =>
      p === "need_checklist" || p === "need_checkout" || p === "presence_due" || p === "blocked" || p === "unlock_requested",
  },
  { key: "closed", label: "Yakunlangan", match: (p) => p === "closed_ok" },
  { key: "no_checklist", label: "Cheklistsiz", match: (p) => p === "closed_no_checklist" || p === "auto_closed" },
  { key: "office", label: "Asosiy ofis", match: (p) => p === "office_open" || p === "office_closed" },
];

const HOW_IT_WORKS: Array<{ title: string; text: string; tone: string }> = [
  {
    title: "Keldim",
    text: "Filialda Face ID bilan «Keldim» qiladi — shu daqiqadan vaqt hisoblana boshlaydi.",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  {
    title: "Cheklist",
    text: "Birinchi javobni belgilagan paytdan saqlaguncha — cheklist davomiyligi hisoblanadi.",
    tone: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  },
  {
    title: "Har 30 daqiqada hudud tasdig‘i",
    text: "Tasdiqlamasa 10 daqiqa kutiladi, keyin vaqt to‘xtaydi. Ruxsat bersangiz vaqt to‘liq davom etadi.",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  },
  {
    title: "Ketdim",
    text: "Yashil hududda «Ketdim» qiladi — tashrif yopiladi va filialdagi jami vaqt qotadi.",
    tone: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
  },
];

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentyabr", "oktyabr", "noyabr", "dekabr"];

function ymd(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

function todayYmd() {
  return ymd(new Date());
}

function shiftYmd(day: string, delta: number) {
  const d = new Date(`${day}T12:00:00+05:00`);
  return ymd(new Date(d.getTime() + delta * 86_400_000));
}

function shortDay(day: string) {
  const [, m, d] = day.split("-").map(Number);
  return m && d ? `${d}-${MONTHS[m - 1]}` : day;
}

function rangeLabel(from: string, to: string) {
  if (!from && !to) return "Barcha sanalar";
  if (from === to) return fmtDateLong(from);
  return `${shortDay(from || EPOCH)} — ${shortDay(to || todayYmd())}`;
}

function datePreset(key: Exclude<Preset, "custom">): { from: string; to: string } {
  const today = todayYmd();
  if (key === "today") return { from: today, to: today };
  if (key === "yesterday") {
    const y = shiftYmd(today, -1);
    return { from: y, to: y };
  }
  if (key === "week") {
    const dow = (new Date(`${today}T12:00:00`).getDay() + 6) % 7;
    const start = shiftYmd(today, -dow);
    return { from: start < EPOCH ? EPOCH : start, to: today };
  }
  const start = `${today.slice(0, 7)}-01`;
  return { from: start < EPOCH ? EPOCH : start, to: today };
}

/* ────────────────────────────── KPI ────────────────────────────── */

const KPI_TONES: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300",
};

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone = "slate",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof KPI_TONES;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border bg-card px-4 py-3.5 shadow-sm">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", KPI_TONES[tone])}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium leading-tight text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-bold leading-none tabular-nums text-foreground">{value}</p>
        {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

/* ────────────────────────────── Panel ────────────────────────────── */

export function VisitMonitorPanel({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [from, setFrom] = useState(() => todayYmd());
  const [to, setTo] = useState(() => todayYmd());
  const [preset, setPreset] = useState<Preset>("today");
  const [coordinatorId, setCoordinatorId] = useState("all");
  const [branchId, setBranchId] = useState("all");
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [showHow, setShowHow] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [closingId, setClosingId] = useState<number | null>(null);

  const { data, isLoading, isFetching, refetch } = useVisitMonitor(
    { from: from || undefined, to: to || undefined, coordinatorId, branchId },
    enabled,
  );

  const items = data?.items ?? [];
  const summary = data?.summary;
  const today = todayYmd();
  const singleDay = !!from && from === to;

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["branch-audits", "visit-monitor"] });
    await qc.invalidateQueries({ queryKey: ["branch-audits", "my-visit"] });
  };

  const needAction = useMemo(() => items.filter((v) => PHASE_META[phaseOf(v)].urgent), [items]);

  const approveUnlock = async (v: CoordinatorVisitSession) => {
    setApprovingId(v.id);
    try {
      const res = await approvePresenceUnlock(v.id);
      await invalidate();
      toast({
        title: "Ruxsat berildi",
        description: res.message || `${v.coordinatorName || "Koordinator"} cheklistni davom ettira oladi`,
      });
    } catch (err) {
      toast({ title: "Xato", description: (err as Error)?.message || "Ruxsat berilmadi", variant: "destructive" });
    } finally {
      setApprovingId(null);
    }
  };

  const approveAll = async () => {
    if (!window.confirm(`${needAction.length} ta bloklangan koordinatorga ruxsat berasizmi?`)) return;
    setApprovingAll(true);
    try {
      const res = await approveAllPresenceUnlocks();
      await invalidate();
      toast({ title: "Ruxsat berildi", description: res.message });
    } catch (err) {
      toast({ title: "Xato", description: (err as Error)?.message || "Ruxsat berilmadi", variant: "destructive" });
    } finally {
      setApprovingAll(false);
    }
  };

  const forceKetdim = async (v: CoordinatorVisitSession) => {
    const name = v.coordinatorName || "Koordinator";
    const branch = v.branchLabel || `Filial #${v.branchId}`;
    if (
      !window.confirm(
        `${name} — «${branch}» tashrifini yopasizmi?\n\nKetdim hozirgi vaqt bilan yoziladi va u boshqa filialda Keldim qila oladi.`,
      )
    ) {
      return;
    }
    setClosingId(v.id);
    try {
      const res = await forceCheckoutVisit(v.id);
      await invalidate();
      toast({ title: "Tashrif yopildi", description: res.message || `${name} boshqa filialga o‘ta oladi` });
    } catch (err) {
      toast({ title: "Yopilmadi", description: (err as Error)?.message || "Qayta urinib ko‘ring", variant: "destructive" });
    } finally {
      setClosingId(null);
    }
  };

  const coordinators = useMemo(() => {
    const map = new Map<number, string>();
    for (const v of items) {
      if (v.coordinatorUserId) map.set(v.coordinatorUserId, v.coordinatorName || `#${v.coordinatorUserId}`);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "uz"));
  }, [items]);

  const branches = useMemo(() => {
    const map = new Map<number, string>();
    for (const v of items) map.set(v.branchId, v.branchLabel || `Filial #${v.branchId}`);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "uz"));
  }, [items]);

  const quickCounts = useMemo(() => {
    const out = {} as Record<QuickFilter, number>;
    for (const f of QUICK) out[f.key] = items.filter((v) => f.match(phaseOf(v))).length;
    return out;
  }, [items]);

  const filtered = useMemo(() => {
    const rule = QUICK.find((f) => f.key === quick)!;
    return items.filter((v) => {
      if (!rule.match(phaseOf(v))) return false;
      if (!q.trim()) return true;
      return scriptIncludes(`${v.coordinatorName || ""} ${v.branchLabel || ""} ${v.workDate}`, q);
    });
  }, [items, q, quick]);

  const groups = useMemo(() => {
    const map = new Map<string, CoordinatorVisitSession[]>();
    for (const v of filtered) {
      const list = map.get(v.workDate) ?? [];
      list.push(v);
      map.set(v.workDate, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const applyPreset = (key: Exclude<Preset, "custom">) => {
    const r = datePreset(key);
    setPreset(key);
    setFrom(r.from);
    setTo(r.to);
  };

  const stepDay = (delta: number) => {
    const base = from || today;
    const next = shiftYmd(base, delta);
    if (next > today || next < EPOCH) return;
    setFrom(next);
    setTo(next);
    setPreset(next === today ? "today" : next === shiftYmd(today, -1) ? "yesterday" : "custom");
  };

  const hasFilters = !!(preset !== "today" || coordinatorId !== "all" || branchId !== "all" || q || quick !== "all");
  const resetFilters = () => {
    applyPreset("today");
    setCoordinatorId("all");
    setBranchId("all");
    setQ("");
    setQuick("all");
  };

  if (!enabled) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        Monitoring faqat rahbariyat uchun.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sarlavha + sana */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white">
              <Timer className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-foreground">Vaqt nazorati</h2>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                Koordinator qachon keldi, cheklistni qachon va qancha vaqtda to‘ldirdi, qachon ketdi.
              </p>
              <button
                type="button"
                onClick={() => setShowHow((s) => !s)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline dark:text-sky-300"
              >
                <Info className="h-3.5 w-3.5" />
                Qanday ishlaydi
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showHow && "rotate-180")} />
              </button>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-xl border bg-background">
                <button
                  type="button"
                  onClick={() => stepDay(-1)}
                  disabled={!singleDay || from <= EPOCH}
                  className="flex h-10 w-10 items-center justify-center rounded-l-xl text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                  title="Oldingi kun"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="flex min-w-[11rem] items-center justify-center gap-1.5 border-x px-3 text-sm font-semibold text-foreground">
                  <CalendarDays className="h-4 w-4 text-sky-600" />
                  {rangeLabel(from, to)}
                </div>
                <button
                  type="button"
                  onClick={() => stepDay(1)}
                  disabled={!singleDay || from >= today}
                  className="flex h-10 w-10 items-center justify-center rounded-r-xl text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                  title="Keyingi kun"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-10 shrink-0 gap-1.5 rounded-xl"
                disabled={isFetching}
                onClick={() => void refetch()}
                title="Ma’lumotni yangilash (har daqiqada o‘zi ham yangilanadi)"
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                <span className="hidden sm:inline">Yangilash</span>
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1 rounded-xl bg-muted/60 p-1">
              {(
                [
                  ["today", "Bugun"],
                  ["yesterday", "Kecha"],
                  ["week", "Shu hafta"],
                  ["month", "Shu oy"],
                  ["custom", "Sana tanlash"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => (key === "custom" ? setPreset("custom") : applyPreset(key))}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    preset === key ? "bg-white text-sky-700 shadow-sm dark:bg-slate-900 dark:text-sky-300" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {preset === "custom" ? (
              <div className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2 text-xs">
                <label className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  Dan
                  <Input
                    type="date"
                    value={from}
                    min={EPOCH}
                    max={to || today}
                    onChange={(e) => setFrom(e.target.value)}
                    className="h-8 w-[9.5rem] text-xs"
                  />
                </label>
                <label className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  Gacha
                  <Input
                    type="date"
                    value={to}
                    min={from || EPOCH}
                    max={today}
                    onChange={(e) => setTo(e.target.value)}
                    className="h-8 w-[9.5rem] text-xs"
                  />
                </label>
              </div>
            ) : null}
          </div>
        </div>

        {showHow ? (
          <div className="border-t bg-muted/30 px-4 py-3 sm:px-5">
            <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {HOW_IT_WORKS.map((s, i) => (
                <li key={s.title} className="flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5">
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", s.tone)}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{s.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>

      {/* Ko‘rsatkichlar */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          icon={Store}
          label="Jami tashrif"
          value={String(summary?.total ?? 0)}
          hint={summary?.frozenCount ? `${summary.frozenCount} tasida vaqt to‘xtatilgan` : rangeLabel(from, to)}
        />
        <Kpi
          icon={MapPin}
          label="Hozir filialda"
          value={String(summary?.openCount ?? 0)}
          hint="Keldim bor, Ketdim yo‘q"
          tone={summary?.openCount ? "amber" : "slate"}
        />
        <Kpi
          icon={ClipboardCheck}
          label="Cheklist to‘ldirilgan"
          value={String(summary?.withChecklist ?? 0)}
          hint={summary?.noChecklist ? `${summary.noChecklist} ta cheklistsiz yopilgan` : "Cheklistsiz yopilgan yo‘q"}
          tone="emerald"
        />
        <Kpi
          icon={Clock3}
          label="O‘rtacha filialda"
          value={summary?.avgStayLabel || "—"}
          hint="Keldimdan Ketdimgacha"
          tone="sky"
        />
        <Kpi
          icon={Timer}
          label="O‘rtacha cheklist"
          value={summary?.avgChecklistFillLabel || summary?.avgChecklistLagLabel || "—"}
          hint={
            summary?.avgChecklistFillLabel && summary.avgChecklistFillMinutes != null
              ? `To‘ldirish · Keldimdan ${summary?.avgChecklistLagLabel || "—"} keyin`
              : "Keldimdan cheklistgacha"
          }
          tone="sky"
        />
        <Kpi
          icon={Building2}
          label="Asosiy ofisda"
          value={summary?.officeTotalLabel || "—"}
          hint={
            summary?.officeCount
              ? `${summary.officeCount} marta${summary.officeOpenCount ? ` · hozir ${summary.officeOpenCount} kishi` : ""}`
              : "Ofisda Keldim yo‘q"
          }
          tone="indigo"
        />
      </div>

      {/* Ruxsat kerak */}
      {needAction.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border-2 border-amber-300 bg-amber-50 shadow-sm dark:border-amber-700 dark:bg-amber-950/30">
          <div className="flex flex-col gap-2 border-b border-amber-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-bold text-amber-950 dark:text-amber-100">
                <Hand className="h-4 w-4" />
                Ruxsat kutayotganlar — {needAction.length} ta
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                Hududni vaqtida tasdiqlamadi — vaqti to‘xtatilgan. <b>Ruxsat berish</b>: vaqt to‘liq hisoblanib davom
                etadi. <b>Tashrifni yopish</b>: vaqt to‘xtagan joyida qoladi.
              </p>
            </div>
            {needAction.length > 1 ? (
              <Button
                type="button"
                size="sm"
                className="shrink-0 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={approvingAll}
                onClick={() => void approveAll()}
              >
                <Unlock className="h-3.5 w-3.5" />
                {approvingAll ? "Berilmoqda…" : "Hammasiga ruxsat"}
              </Button>
            ) : null}
          </div>
          <ul className="divide-y divide-amber-200/70 dark:divide-amber-800/60">
            {needAction.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                    {v.coordinatorName || "Koordinator"}
                    <span className="font-normal text-muted-foreground">·</span>
                    <span className="font-medium">{v.branchLabel || `Filial #${v.branchId}`}</span>
                    <PhaseBadge phase={phaseOf(v)} />
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Keldim {fmtHm(v.checkInAt)}
                    {v.stayFrozenAt ? (
                      <>
                        {" · "}
                        <span className="font-semibold text-rose-700 dark:text-rose-300">
                          vaqt {fmtHm(v.stayFrozenAt)} da to‘xtadi ({v.durationLabel})
                        </span>
                      </>
                    ) : (
                      ` · filialda ${v.durationLabel}`
                    )}
                    {v.presenceUnlockRequestAt ? ` · so‘rov ${fmtHm(v.presenceUnlockRequestAt)}` : ""}
                    {v.checklistAt ? " · cheklist bor" : " · cheklist yo‘q"}
                  </p>
                </div>
                <ActionButtons
                  canApprove
                  canClose
                  approving={approvingId === v.id || approvingAll}
                  closing={closingId === v.id}
                  onApprove={() => void approveUnlock(v)}
                  onClose={() => void forceKetdim(v)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Filtr */}
      <div className="space-y-3 rounded-2xl border bg-card p-3 shadow-sm sm:p-4">
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setQuick(f.key)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold ring-1 ring-inset transition-colors",
                quick === f.key
                  ? f.key === "action"
                    ? "bg-amber-500 text-white ring-amber-500"
                    : "bg-primary text-primary-foreground ring-primary"
                  : "bg-card text-muted-foreground ring-border hover:bg-muted",
                f.key === "action" && quickCounts.action > 0 && quick !== "action" && "text-amber-700 ring-amber-300",
              )}
            >
              {f.label}
              <span
                className={cn(
                  "min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] tabular-nums",
                  quick === f.key ? "bg-white/25" : "bg-muted text-foreground/70",
                )}
              >
                {quickCounts[f.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Koordinator yoki filial nomi…"
              className="h-10 pl-9"
            />
          </div>
          <Select value={coordinatorId} onValueChange={setCoordinatorId}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Koordinator" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha koordinatorlar</SelectItem>
              {coordinators.map(([id, name]) => (
                <SelectItem key={id} value={String(id)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Filial" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha filiallar</SelectItem>
              {branches.map(([id, name]) => (
                <SelectItem key={id} value={String(id)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters ? (
            <Button type="button" variant="ghost" className="h-10 gap-1 text-xs" onClick={resetFilters}>
              <X className="h-3.5 w-3.5" />
              Tozalash
            </Button>
          ) : null}
        </div>
      </div>

      {/* Ro‘yxat */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,2.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-5 border-b bg-muted/50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground xl:grid">
          <span>Koordinator · filial</span>
          <span>Keldim → Cheklist → Ketdim</span>
          <span>Filialda jami</span>
          <span>Holat va amallar</span>
        </div>
        {isLoading ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">Yuklanmoqda…</p>
        ) : groups.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <Timer className="mx-auto h-9 w-9 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-semibold text-foreground">
              {singleDay && from === today ? "Bugun hali tashrif yo‘q" : "Tashrif topilmadi"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Koordinator filialda Face ID bilan «Keldim» qilganda shu yerda paydo bo‘ladi.
            </p>
          </div>
        ) : (
          groups.map(([day, list]) => (
            <div key={day}>
              <div className="sticky top-0 z-[1] flex items-center justify-between border-b bg-muted/80 px-5 py-2 text-xs font-semibold text-foreground backdrop-blur">
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  {fmtDateLong(day)}
                </span>
                <span className="font-normal text-muted-foreground">{list.length} ta tashrif</span>
              </div>
              <ul className="divide-y divide-border/60">
                {list.map((v) => (
                  <VisitRow
                    key={v.id}
                    v={v}
                    approving={approvingId === v.id}
                    closing={closingId === v.id}
                    onApprove={() => void approveUnlock(v)}
                    onForceCheckout={() => void forceKetdim(v)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Qator qismlari ─────────────────────────── */

function ActionButtons({
  canApprove,
  canClose,
  approving,
  closing,
  onApprove,
  onClose,
}: {
  canApprove: boolean;
  canClose: boolean;
  approving?: boolean;
  closing?: boolean;
  onApprove?: () => void;
  onClose?: () => void;
}) {
  if (!canApprove && !canClose) return null;
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {canApprove && onApprove ? (
        <Button
          type="button"
          size="sm"
          className="h-9 gap-1.5 bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
          disabled={approving}
          onClick={onApprove}
          title="Vaqt to‘xtamagandek to‘liq hisoblanadi va davom etadi"
        >
          <Unlock className="h-4 w-4" />
          {approving ? "Berilmoqda…" : "Ruxsat berish"}
        </Button>
      ) : null}
      {canClose && onClose ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 border-rose-300 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
          disabled={closing}
          onClick={onClose}
          title="Koordinator o‘rniga Ketdim yoziladi — boshqa filialga o‘ta oladi"
        >
          <LogOut className="h-4 w-4" />
          {closing ? "Yopilmoqda…" : "Tashrifni yopish"}
        </Button>
      ) : null}
    </div>
  );
}

type StepTone = "emerald" | "sky" | "rose" | "slate";

const STEP_TONES: Record<StepTone, { ring: string; text: string }> = {
  emerald: { ring: "bg-emerald-600 text-white", text: "text-emerald-700 dark:text-emerald-400" },
  sky: { ring: "bg-sky-600 text-white", text: "text-sky-700 dark:text-sky-300" },
  rose: { ring: "bg-rose-600 text-white", text: "text-rose-700 dark:text-rose-400" },
  slate: { ring: "border-2 border-dashed border-slate-300 bg-card text-slate-400 dark:border-slate-600", text: "text-muted-foreground" },
};

function Step({
  icon: Icon,
  label,
  time,
  empty,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  time: string | null | undefined;
  empty: string;
  sub?: React.ReactNode;
  tone: StepTone;
}) {
  const t = STEP_TONES[time ? tone : "slate"];
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", t.ring)}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {time ? (
        <span className={cn("text-base font-bold leading-tight tabular-nums", t.text)}>{fmtHm(time)}</span>
      ) : (
        <span className="text-xs font-medium leading-tight text-muted-foreground">{empty}</span>
      )}
      {sub ? <span className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

function Gap({ minutes, active, tone }: { minutes: number | null | undefined; active: boolean; tone: "sky" | "emerald" }) {
  const has = minutes != null && minutes >= 0;
  return (
    <div className="flex min-w-[2.5rem] flex-1 flex-col items-center pt-2.5">
      <div
        className={cn(
          "h-1 w-full rounded-full",
          has ? (tone === "sky" ? "bg-sky-400" : "bg-emerald-400") : active ? "animate-pulse bg-amber-300" : "bg-muted",
        )}
      />
      <span
        className={cn(
          "mt-1 whitespace-nowrap rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
          has ? "bg-muted text-foreground/80" : "text-muted-foreground",
        )}
      >
        {has ? minutesLabel(minutes) : active ? "kutilmoqda" : "—"}
      </span>
    </div>
  );
}

function Timeline({ v }: { v: CoordinatorVisitSession }) {
  const fill = v.checklistFillMinutes;
  const lag = v.checklistAfterCheckInMinutes;
  const afterCheckMin =
    v.checkOutAt && v.checklistAt ? v.checklistToCheckoutMinutes ?? null : v.checkOutAt && !v.checklistAt ? v.durationMinutes : null;
  return (
    <div className="flex items-start gap-1">
      <Step icon={LogIn} label="Keldim" time={v.checkInAt} empty="—" tone="emerald" />
      <Gap minutes={v.checklistAt ? lag : null} active={v.stillOpen && !v.checklistAt} tone="sky" />
      <Step
        icon={ClipboardCheck}
        label="Cheklist"
        time={v.checklistAt}
        empty={v.stillOpen ? "Hali yo‘q" : "To‘ldirilmagan"}
        tone="sky"
        sub={
          v.checklistAt ? (
            fill != null ? (
              <>
                <span className="font-semibold text-sky-700 dark:text-sky-300">{minutesLabel(fill)}</span> davom etdi
                {v.checklistStartedAt ? <span className="block">{fmtHm(v.checklistStartedAt)} da boshlandi</span> : null}
              </>
            ) : (
              "saqlangan vaqti"
            )
          ) : undefined
        }
      />
      <Gap minutes={afterCheckMin} active={v.stillOpen && !!v.checklistAt} tone="emerald" />
      <Step icon={LogOut} label="Ketdim" time={v.checkOutAt} empty={v.stillOpen ? "Hali ketmagan" : "—"} tone="rose" />
    </div>
  );
}

function StayBlock({ v, office }: { v: CoordinatorVisitSession; office: boolean }) {
  const frozen = !office && !!v.stayFrozen;
  const running = v.stillOpen && !frozen;
  const total = Math.max(v.durationMinutes ?? 0, 1);
  const lag = v.checklistAfterCheckInMinutes;
  const fill = v.checklistFillMinutes;
  const beforeStart = lag != null && fill != null ? Math.max(0, lag - fill) : lag;
  const pct = (n: number | null | undefined) => (n == null ? 0 : Math.max(0, Math.min(100, (n / total) * 100)));
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground xl:hidden">
        {office ? "Ofisda jami" : "Filialda jami"}
      </p>
      <p
        className={cn(
          "flex flex-wrap items-center gap-x-2 text-xl font-bold leading-tight tabular-nums",
          frozen ? "text-rose-700 dark:text-rose-300" : "text-foreground",
        )}
      >
        {frozen ? <Lock className="h-4 w-4" /> : <Clock3 className="h-4 w-4 text-muted-foreground" />}
        {v.durationLabel}
        {frozen ? (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
            to‘xtatilgan
          </span>
        ) : running ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            davom etmoqda
          </span>
        ) : null}
      </p>
      {!office ? (
        <>
          <div
            className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-muted"
            title="Kulrang — cheklistgacha, ko‘k — cheklist, yashil — cheklistdan keyin"
          >
            {v.checklistAt ? (
              <>
                <div className="h-full bg-slate-300 dark:bg-slate-600" style={{ width: `${pct(beforeStart)}%` }} />
                {fill != null ? <div className="h-full bg-sky-500" style={{ width: `${Math.max(2, pct(fill))}%` }} /> : null}
                <div className="h-full flex-1 bg-emerald-500" />
              </>
            ) : (
              <div className={cn("h-full w-full", frozen ? "bg-rose-400" : v.stillOpen ? "bg-amber-400" : "bg-slate-300")} />
            )}
          </div>
          {frozen ? (
            <p className="mt-1 text-[11px] leading-tight text-rose-700 dark:text-rose-300">
              {fmtHm(v.stayFrozenAt)} da to‘xtadi{v.stillOpen ? " · ruxsat berilsa davom etadi" : ""}
            </p>
          ) : running && v.presenceOverdue && v.presenceGraceEndsAt ? (
            <p className="mt-1 text-[11px] font-semibold leading-tight text-orange-700 dark:text-orange-300">
              {fmtHm(v.presenceGraceEndsAt)} gacha hududni tasdiqlashi kerak
            </p>
          ) : running && v.presenceDueAt ? (
            <p className="mt-1 text-[11px] leading-tight text-muted-foreground">Keyingi hudud tasdig‘i: {fmtHm(v.presenceDueAt)}</p>
          ) : null}
          {!frozen && v.presenceUnlockedAt ? (
            <p className="mt-0.5 text-[11px] leading-tight text-emerald-700 dark:text-emerald-400">
              {fmtHm(v.presenceUnlockedAt)} da ruxsat berilgan
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function VisitRow({
  v,
  approving,
  closing,
  onApprove,
  onForceCheckout,
}: {
  v: CoordinatorVisitSession;
  approving?: boolean;
  closing?: boolean;
  onApprove?: () => void;
  onForceCheckout?: () => void;
}) {
  const phase = phaseOf(v);
  const meta = PHASE_META[phase];
  const office = phase === "office_open" || phase === "office_closed";
  const canApprove = phase === "unlock_requested" || phase === "blocked";

  return (
    <li className={cn("relative px-4 py-4 transition-colors hover:bg-muted/30 sm:px-5", meta.urgent && "bg-amber-50/60 dark:bg-amber-950/20")}>
      <span className={cn("absolute inset-y-0 left-0 w-1", meta.dot)} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,2.1fr)_minmax(0,1fr)_minmax(0,1fr)] xl:items-center xl:gap-5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
            <User className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{v.coordinatorName || "—"}</span>
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-sm font-medium leading-snug text-foreground/80">
            {office ? (
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            ) : (
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            )}
            <span className="line-clamp-2">{v.branchLabel || `#${v.branchId}`}</span>
          </p>
        </div>

        {office ? (
          <div className="flex items-start gap-1">
            <Step icon={LogIn} label="Keldim" time={v.checkInAt} empty="—" tone="emerald" />
            <Gap minutes={v.checkOutAt ? v.durationMinutes : null} active={v.stillOpen} tone="emerald" />
            <Step icon={LogOut} label="Ketdim" time={v.checkOutAt} empty={v.stillOpen ? "Hali ketmagan" : "—"} tone="rose" />
          </div>
        ) : (
          <Timeline v={v} />
        )}

        <StayBlock v={v} office={office} />

        <div className="flex flex-col items-start gap-2">
          <PhaseBadge phase={phase} className="px-2.5 py-1 text-xs" />
          <ActionButtons
            canApprove={canApprove}
            canClose={v.stillOpen}
            approving={approving}
            closing={closing}
            onApprove={onApprove}
            onClose={onForceCheckout}
          />
        </div>
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">
        {meta.hint}
        {v.checkoutNote ? (
          <>
            {" · "}
            <span className="text-foreground/80">
              <span className="font-semibold">Ketdim izohi:</span> {v.checkoutNote}
            </span>
          </>
        ) : null}
      </p>
    </li>
  );
}
