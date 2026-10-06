import React, { useMemo, useState } from "react";
import {
  Building2,
  ClipboardCheck,
  Clock3,
  Hand,
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
import {
  PHASE_META,
  PhaseBadge,
  StaySplitBar,
  fmtDateLong,
  fmtHm,
  minutesLabel,
  phaseOf,
} from "./visit-phase";

type QuickFilter = "all" | "open" | "action" | "no_checklist" | "closed" | "office";

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
  { key: "no_checklist", label: "Cheklistsiz", match: (p) => p === "closed_no_checklist" || p === "auto_closed" },
  { key: "closed", label: "Yakunlangan", match: (p) => p === "closed_ok" },
  { key: "office", label: "Asosiy ofis", match: (p) => p === "office_open" || p === "office_closed" },
];

function ymd(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

function datePreset(key: "today" | "yesterday" | "week" | "month"): { from: string; to: string } {
  const now = new Date();
  const today = ymd(now);
  if (key === "today") return { from: today, to: today };
  if (key === "yesterday") {
    const y = ymd(new Date(now.getTime() - 86_400_000));
    return { from: y, to: y };
  }
  if (key === "week") {
    const dow = (new Date(`${today}T12:00:00`).getDay() + 6) % 7;
    return { from: ymd(new Date(now.getTime() - dow * 86_400_000)), to: today };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

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
  tone?: "slate" | "amber" | "emerald" | "rose" | "sky" | "indigo";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
    sky: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
    indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300",
  };
  return (
    <div className="flex items-start gap-3 rounded-2xl border bg-card px-3.5 py-3 shadow-sm">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium leading-tight text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-lg font-bold leading-tight tabular-nums text-foreground">{value}</p>
        {hint ? <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

export function VisitMonitorPanel({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preset, setPreset] = useState<"" | "today" | "yesterday" | "week" | "month">("");
  const [coordinatorId, setCoordinatorId] = useState("all");
  const [branchId, setBranchId] = useState("all");
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const [closingId, setClosingId] = useState<number | null>(null);

  const { data, isLoading, isFetching, refetch } = useVisitMonitor(
    { from: from || undefined, to: to || undefined, coordinatorId, branchId },
    enabled,
  );

  const items = data?.items ?? [];
  const summary = data?.summary;

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["branch-audits", "visit-monitor"] });
    await qc.invalidateQueries({ queryKey: ["branch-audits", "my-visit"] });
  };

  const needAction = useMemo(
    () => items.filter((v) => PHASE_META[phaseOf(v)].urgent),
    [items],
  );

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
        `${name} — «${branch}» tashrifini Ketdim bilan yopasizmi?\n\nKeyin u boshqa filialda Keldim qila oladi.`,
      )
    ) {
      return;
    }
    setClosingId(v.id);
    try {
      const res = await forceCheckoutVisit(v.id);
      await invalidate();
      toast({ title: "Ketdim yopildi", description: res.message || `${name} boshqa filialga o‘ta oladi` });
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

  const applyPreset = (key: "today" | "yesterday" | "week" | "month") => {
    if (preset === key) {
      setPreset("");
      setFrom("");
      setTo("");
      return;
    }
    const r = datePreset(key);
    setPreset(key);
    setFrom(r.from);
    setTo(r.to);
  };

  const hasFilters = !!(from || to || coordinatorId !== "all" || branchId !== "all" || q || quick !== "all");
  const resetFilters = () => {
    setFrom("");
    setTo("");
    setPreset("");
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
      {/* Sarlavha */}
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white">
            <Timer className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">Vaqt nazorati</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Har bir tashrif: <b>Keldim</b> → <b>Cheklist</b> → <b>Ketdim</b>. Filialda va asosiy ofisda qancha
              vaqt o‘tgani alohida. Ma’lumot 1-oktyabrdan boshlab, har daqiqada yangilanadi.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          Yangilash
        </Button>
      </div>

      {/* Ko‘rsatkichlar */}
      <div className="space-y-2">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Filial tashriflari
        </p>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi icon={Store} label="Jami tashrif" value={String(summary?.total ?? 0)} />
          <Kpi
            icon={MapPin}
            label="Hozir filialda"
            value={String(summary?.openCount ?? 0)}
            hint="Keldim qilgan, Ketdim hali yo‘q"
            tone={summary?.openCount ? "amber" : "slate"}
          />
          <Kpi
            icon={ClipboardCheck}
            label="Cheklist to‘ldirilgan"
            value={String(summary?.withChecklist ?? 0)}
            tone="emerald"
          />
          <Kpi
            icon={X}
            label="Cheklistsiz yopilgan"
            value={String(summary?.noChecklist ?? 0)}
            hint="Keldi-ketdi, cheklist yo‘q"
            tone={summary?.noChecklist ? "rose" : "slate"}
          />
        </div>
        <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Vaqt (o‘rtacha)
        </p>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi
            icon={Clock3}
            label="Filialda qolish"
            value={summary?.avgStayLabel || "—"}
            hint="Keldimdan Ketdimgacha"
            tone="sky"
          />
          <Kpi
            icon={ClipboardCheck}
            label="Keldim → cheklist"
            value={summary?.avgChecklistLagLabel || "—"}
            hint="Cheklistni qancha vaqtda yakunlaydi"
            tone="sky"
          />
          <Kpi
            icon={LogOut}
            label="Cheklistdan keyin"
            value={summary?.avgAfterChecklistLabel || "—"}
            hint="Cheklistdan Ketdimgacha"
            tone="emerald"
          />
          <Kpi
            icon={Building2}
            label="Asosiy ofisda"
            value={summary?.officeTotalLabel || "—"}
            hint={
              summary?.officeCount
                ? `${summary.officeCount} marta · o‘rtacha ${summary.officeAvgLabel || "—"}${
                    summary.officeOpenCount ? ` · hozir ${summary.officeOpenCount} kishi` : ""
                  }`
                : "Ofisda Keldim qilinmagan"
            }
            tone="indigo"
          />
        </div>
      </div>

      {/* Ruxsat kerak */}
      {needAction.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-amber-300 bg-amber-50 shadow-sm dark:border-amber-700 dark:bg-amber-950/30">
          <div className="flex flex-col gap-2 border-b border-amber-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-bold text-amber-950 dark:text-amber-100">
                <Hand className="h-4 w-4" />
                Ruxsat kutayotganlar — {needAction.length} ta
              </p>
              <p className="mt-0.5 text-[11px] text-amber-900/80 dark:text-amber-200/80">
                Koordinator 30 daqiqada hududni tasdiqlashi kerak. 10 daqiqa kechiksa cheklist bloklanadi —
                ruxsat bersangiz darhol davom etadi.
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
              <li key={v.id} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                    {v.coordinatorName || "Koordinator"}
                    <span className="font-normal text-muted-foreground">·</span>
                    <span className="font-medium">{v.branchLabel || `Filial #${v.branchId}`}</span>
                    <PhaseBadge phase={phaseOf(v)} />
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Keldim {fmtHm(v.checkInAt)} · filialda {v.durationLabel}
                    {v.presenceBlockedAt ? ` · blok ${fmtHm(v.presenceBlockedAt)}` : ""}
                    {v.presenceUnlockRequestAt ? ` · so‘rov ${fmtHm(v.presenceUnlockRequestAt)}` : ""}
                    {v.checklistAt ? " · cheklist bor" : " · cheklist yo‘q"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={approvingId === v.id || approvingAll}
                    onClick={() => void approveUnlock(v)}
                  >
                    <Unlock className="h-3.5 w-3.5" />
                    {approvingId === v.id ? "…" : "Ruxsat berish"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
                    disabled={closingId === v.id}
                    onClick={() => void forceKetdim(v)}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    {closingId === v.id ? "…" : "Ketdim"}
                  </Button>
                </div>
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
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors",
                quick === f.key
                  ? f.key === "action"
                    ? "bg-amber-500 text-white ring-amber-500"
                    : "bg-primary text-primary-foreground ring-primary"
                  : "bg-card text-muted-foreground ring-border hover:bg-muted",
              )}
            >
              {f.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
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
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["today", "Bugun"],
              ["yesterday", "Kecha"],
              ["week", "Shu hafta"],
              ["month", "Shu oy"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset",
                preset === key
                  ? "bg-sky-600 text-white ring-sky-600"
                  : "bg-card text-foreground/80 ring-border hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Input
              type="date"
              value={from}
              min="2026-10-01"
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset("");
              }}
              className="h-8 w-[9.5rem] text-xs"
            />
            —
            <Input
              type="date"
              value={to}
              min="2026-10-01"
              onChange={(e) => {
                setTo(e.target.value);
                setPreset("");
              }}
              className="h-8 w-[9.5rem] text-xs"
            />
          </div>
        </div>
      </div>

      {/* Ro‘yxat */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="hidden grid-cols-[1.25fr_1.3fr_0.7fr_0.95fr_0.7fr_1fr_1.15fr] gap-3 border-b bg-muted/50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
          <span>Koordinator</span>
          <span>Filial</span>
          <span>Keldim</span>
          <span>Cheklist</span>
          <span>Ketdim</span>
          <span>Qolish vaqti</span>
          <span>Holat</span>
        </div>
        {isLoading ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">Yuklanmoqda…</p>
        ) : groups.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Timer className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium text-foreground">Tashrif topilmadi</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Koordinator filialda Face ID bilan «Keldim» qilganda shu yerda paydo bo‘ladi.
            </p>
          </div>
        ) : (
          groups.map(([day, list]) => (
            <div key={day}>
              <div className="sticky top-0 z-[1] flex items-center justify-between border-b bg-muted/80 px-4 py-1.5 text-xs font-semibold text-foreground backdrop-blur">
                <span>{fmtDateLong(day)}</span>
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

function TimeCell({
  icon: Icon,
  label,
  iso,
  tone,
  empty,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  iso: string | null | undefined;
  tone: string;
  empty: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">{label}</p>
      {iso ? (
        <p className={cn("flex items-center gap-1 text-sm font-bold tabular-nums", tone)}>
          <Icon className="h-3.5 w-3.5 opacity-70" />
          {fmtHm(iso)}
        </p>
      ) : (
        <p className="text-xs font-medium text-muted-foreground">{empty}</p>
      )}
      {sub ? <p className="text-[10px] leading-tight text-muted-foreground">{sub}</p> : null}
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
    <li
      className={cn(
        "relative px-4 py-3 transition-colors hover:bg-muted/30",
        meta.urgent && "bg-amber-50/60 dark:bg-amber-950/20",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", meta.dot)} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 lg:grid-cols-[1.25fr_1.3fr_0.7fr_0.95fr_0.7fr_1fr_1.15fr] lg:items-center">
        <div className="col-span-2 min-w-0 lg:col-span-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
            <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {v.coordinatorName || "—"}
          </p>
        </div>
        <div className="col-span-2 min-w-0 lg:col-span-1">
          <p className="flex items-start gap-1.5 text-sm font-medium leading-snug text-foreground">
            {office ? (
              <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
            ) : (
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            )}
            <span className="line-clamp-2">{v.branchLabel || `#${v.branchId}`}</span>
          </p>
        </div>
        <TimeCell
          icon={LogIn}
          label="Keldim"
          iso={v.checkInAt}
          tone="text-emerald-700 dark:text-emerald-400"
          empty="—"
        />
        {office ? (
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">Cheklist</p>
            <p className="text-xs text-muted-foreground">Ofis — talab qilinmaydi</p>
          </div>
        ) : (
          <TimeCell
            icon={ClipboardCheck}
            label="Cheklist"
            iso={v.checklistAt}
            tone="text-sky-700 dark:text-sky-300"
            empty={v.stillOpen ? "Hali yo‘q" : "To‘ldirilmagan"}
            sub={v.checklistAt ? `Keldimdan ${v.checklistAfterCheckInLabel} keyin` : undefined}
          />
        )}
        <TimeCell
          icon={LogOut}
          label="Ketdim"
          iso={v.checkOutAt}
          tone="text-rose-700 dark:text-rose-400"
          empty={v.stillOpen ? "Hali ketmagan" : "—"}
        />
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">Qolish vaqti</p>
          <p className="flex items-center gap-1 text-sm font-bold tabular-nums text-foreground">
            <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
            {v.durationLabel}
            {v.stillOpen ? <span className="text-[10px] font-medium text-amber-600">· davom etmoqda</span> : null}
          </p>
          {!office ? (
            <>
              <div className="mt-1">
                <StaySplitBar v={v} />
              </div>
              {v.checklistAt ? (
                <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                  <span className="text-sky-700 dark:text-sky-300">{minutesLabel(v.checklistAfterCheckInMinutes)}</span>{" "}
                  cheklistgacha ·{" "}
                  <span className="text-emerald-700 dark:text-emerald-400">
                    {minutesLabel(v.checklistToCheckoutMinutes)}
                  </span>{" "}
                  keyin
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-1.5 lg:col-span-1">
          <PhaseBadge phase={phase} />
          {canApprove && onApprove ? (
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 bg-emerald-600 px-2 text-[11px] text-white hover:bg-emerald-700"
              disabled={approving}
              onClick={onApprove}
            >
              <Unlock className="h-3 w-3" />
              {approving ? "…" : "Ruxsat"}
            </Button>
          ) : null}
          {v.stillOpen && onForceCheckout ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-rose-300 px-2 text-[11px] text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300"
              disabled={closing}
              onClick={onForceCheckout}
            >
              <LogOut className="h-3 w-3" />
              {closing ? "…" : "Ketdim"}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground lg:pl-0">
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
