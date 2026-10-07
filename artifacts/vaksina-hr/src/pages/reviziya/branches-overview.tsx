import React from "react";
import {
  AlertTriangle,
  Banknote,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import type { VisitDashBranch, VisitDashResponse } from "@/lib/reviziya-api";
import { CYCLE_STATUS_TONE, formatYmd, moneySoum } from "@/lib/reviziya-cycle";

type StatusCard = {
  value: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  count: (s: VisitDashResponse["stats"]) => number;
  ring: string;
  iconTone: string;
};

const STATUS_CARDS: StatusCard[] = [
  {
    value: "MUDDATI_OTGAN",
    label: "Muddati o‘tgan",
    hint: "Sana o‘tib ketgan",
    icon: AlertTriangle,
    count: (s) => s.muddatiOtgan,
    ring: "ring-rose-400 bg-rose-50 dark:bg-rose-950/30",
    iconTone: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  },
  {
    value: "SIKL_OTKAZIB_YUBORILGAN",
    label: "Sikl o‘tkazilgan",
    hint: "Butun sikl reviziyasiz",
    icon: RefreshCw,
    count: (s) => s.siklOtkazilgan,
    ring: "ring-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-950/30",
    iconTone: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  },
  {
    value: "TEZ_ORADA",
    label: "Tez orada",
    hint: "14 kundan kam qoldi",
    icon: Clock,
    count: (s) => s.tezOrada,
    ring: "ring-amber-400 bg-amber-50 dark:bg-amber-950/30",
    iconTone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  {
    value: "REVIZIYA_JARAYONIDA",
    label: "Jarayonda",
    hint: "Revizor ishlayapti",
    icon: Loader2,
    count: (s) => s.jarayonda ?? 0,
    ring: "ring-indigo-400 bg-indigo-50 dark:bg-indigo-950/30",
    iconTone: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  },
  {
    value: "REJADAGIDEK",
    label: "Rejadagidek",
    hint: "Vaqtida o‘tkazilgan",
    icon: CheckCircle2,
    count: (s) => s.completedOk,
    ring: "ring-emerald-400 bg-emerald-50 dark:bg-emerald-950/30",
    iconTone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  {
    value: "YANGI_OCHILGAN",
    label: "Hali reviziyasiz",
    hint: "Birinchi reviziya kerak",
    icon: Sparkles,
    count: (s) => s.yangiOchilgan,
    ring: "ring-sky-400 bg-sky-50 dark:bg-sky-950/30",
    iconTone: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
];

const STRIPE: Record<string, string> = {
  YANGI_OCHILGAN: "bg-sky-400",
  REJADAGIDEK: "bg-emerald-500",
  TEZ_ORADA: "bg-amber-400",
  MUDDATI_OTGAN: "bg-rose-500",
  SIKL_OTKAZIB_YUBORILGAN: "bg-fuchsia-500",
  REVIZIYA_JARAYONIDA: "bg-indigo-500",
  REVIZIYA_YAKUNLANGAN: "bg-teal-500",
};

function DaysChip({ b }: { b: VisitDashBranch }) {
  if (b.cycleStatus === "REVIZIYA_JARAYONIDA" && b.activeRevisionDate) {
    return (
      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
        {formatYmd(b.activeRevisionDate)} da
      </span>
    );
  }
  if (b.daysLeft == null) {
    return <span className="text-[11px] text-muted-foreground">Sana yo‘q</span>;
  }
  if (b.daysLeft < 0) {
    return (
      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">
        {Math.abs(b.daysLeft)} kun kechikdi
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
        b.daysLeft <= 14 ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
      )}
    >
      {b.daysLeft === 0 ? "Bugun" : `${b.daysLeft} kun qoldi`}
    </span>
  );
}

function CollectBar({ b }: { b: VisitDashBranch }) {
  if (!b.shortageAmount) {
    return <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Kamomad yo‘q</span>;
  }
  const pct = Math.min(100, Math.round(((b.collectedAmount || 0) / b.shortageAmount) * 100));
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-bold tabular-nums text-rose-700 dark:text-rose-300">{moneySoum(b.shortageAmount)}</p>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-rose-100 dark:bg-rose-950/50">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        Undirildi {pct}% · qoldi <span className="tabular-nums">{moneySoum(b.remainingAmount)}</span>
      </p>
    </div>
  );
}

export function BranchesOverview({
  data,
  isLoading,
  isError,
  error,
  onRetry,
  q,
  onQ,
  status,
  onStatus,
  page,
  onPage,
  onOpen,
}: {
  data?: VisitDashResponse;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry: () => void;
  q: string;
  onQ: (v: string) => void;
  status: string;
  onStatus: (v: string) => void;
  page: number;
  onPage: (p: number) => void;
  onOpen: (branchId: number) => void;
}) {
  const stats = data?.stats;
  const rows = data?.branches || [];
  const pg = data?.pagination;
  const total = stats?.totalBranches ?? 0;
  const covered =
    (stats?.completedOk ?? 0) + (stats?.tezOrada ?? 0) + (stats?.muddatiOtgan ?? 0) + (stats?.siklOtkazilgan ?? 0);
  const coveragePct = total ? Math.round((covered / total) * 100) : 0;
  const collectPct = stats?.totalShortage ? Math.min(100, Math.round((stats.totalCollected / stats.totalShortage) * 100)) : 0;
  const offset = pg ? (pg.page - 1) * pg.limit : 0;

  if (isError) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
        {(error as Error)?.message || "Yuklashda xato"}
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Qayta
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isLoading && !stats ? (
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-700 via-violet-600 to-indigo-600 p-5 text-white shadow-sm">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-16 right-16 h-40 w-40 rounded-full bg-white/5" />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Reviziya qamrovi</p>
                <p className="mt-1 text-3xl font-bold tabular-nums">
                  {covered}
                  <span className="text-lg font-semibold text-white/70"> / {total}</span>
                </p>
                <p className="text-xs text-white/80">filialda kamida bitta reviziya o‘tkazilgan</p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/25">
                <Building2 className="h-5 w-5" />
              </span>
            </div>
            <div className="relative mt-4">
              <div className="mb-1 flex justify-between text-[11px] text-white/80">
                <span>Qamrov</span>
                <span className="font-bold text-white">{coveragePct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white" style={{ width: `${coveragePct}%` }} />
              </div>
              <p className="mt-2 text-[11px] text-white/75">
                {stats?.yangiOchilgan ?? 0} ta filialda hali reviziya bo‘lmagan · {(stats?.muddatiOtgan ?? 0) + (stats?.siklOtkazilgan ?? 0)} ta
                filial muddatidan o‘tgan
              </p>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Moliyaviy natija</p>
                <p className="mt-1 text-xs text-muted-foreground">Har filialning oxirgi reviziyasi bo‘yicha</p>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                <Banknote className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-700/80 dark:text-rose-300/80">Kamomad</p>
                <p className="text-sm font-bold tabular-nums text-foreground sm:text-base">{moneySoum(stats?.totalShortage ?? 0)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">Undirilgan</p>
                <p className="text-sm font-bold tabular-nums text-foreground sm:text-base">{moneySoum(stats?.totalCollected ?? 0)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700/80 dark:text-amber-300/80">Qolgan</p>
                <p className="text-sm font-bold tabular-nums text-foreground sm:text-base">{moneySoum(stats?.totalRemaining ?? 0)}</p>
              </div>
            </div>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                <span>Undirish</span>
                <span className="font-bold text-foreground">{collectPct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-rose-100 dark:bg-rose-950/50">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${collectPct}%` }} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {STATUS_CARDS.map((c) => {
          const active = status === c.value;
          const Icon = c.icon;
          const n = stats ? c.count(stats) : 0;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => onStatus(active ? "" : c.value)}
              className={cn(
                "group flex items-start gap-2.5 rounded-2xl border bg-card p-3 text-left shadow-sm transition hover:-translate-y-px hover:shadow",
                active && cn("ring-2", c.ring),
                !n && !active && "opacity-60",
              )}
            >
              <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", c.iconTone)}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xl font-bold leading-tight tabular-nums text-foreground">{n}</p>
                <p className="truncate text-[12px] font-semibold text-foreground">{c.label}</p>
                <p className="truncate text-[10px] text-muted-foreground">{c.hint}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-10 rounded-xl pl-9"
            placeholder="Filial, mudir, koordinator, revizor yoki javobgar…"
            value={q}
            onChange={(e) => onQ(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          {status ? (
            <button
              type="button"
              onClick={() => onStatus("")}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-violet-100 px-3 text-xs font-semibold text-violet-800 dark:bg-violet-500/15 dark:text-violet-200"
            >
              {STATUS_CARDS.find((c) => c.value === status)?.label || status}
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {pg?.total ?? rows.length} ta filial
          </span>
        </div>
      </div>

      {isLoading && !rows.length ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !rows.length ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <Building2 className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm font-medium">Filial topilmadi</p>
          <p className="mt-1 text-xs text-muted-foreground">Qidiruv yoki holat filtrini o‘zgartirib ko‘ring</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="hidden grid-cols-[2.3rem_1.6fr_1.15fr_0.95fr_1.15fr_1.2fr_1.5rem] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
            <span>№</span>
            <span>Filial va mas’ullar</span>
            <span>Reviziya sanalari</span>
            <span>Holat</span>
            <span>Kamomad</span>
            <span>Revizor / javobgar</span>
            <span />
          </div>
          <ul className="divide-y">
            {rows.map((b, i) => (
              <li key={b.branchId}>
                <button
                  type="button"
                  onClick={() => onOpen(b.branchId)}
                  className={cn(
                    "relative grid w-full grid-cols-1 gap-3 px-4 py-3.5 text-left transition hover:bg-violet-50/50 dark:hover:bg-violet-950/20 lg:grid-cols-[2.3rem_1.6fr_1.15fr_0.95fr_1.15fr_1.2fr_1.5rem] lg:items-center",
                    b.daysLeft != null && b.daysLeft < 0 && "bg-rose-50/40 dark:bg-rose-950/10",
                  )}
                >
                  <span className={cn("absolute inset-y-0 left-0 w-1", STRIPE[b.cycleStatus] || "bg-slate-300")} />
                  <span className="hidden text-xs tabular-nums text-muted-foreground lg:block">{offset + i + 1}</span>

                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2 lg:block">
                      <p className="truncate text-sm font-bold text-foreground">
                        {displayBranchName(b.branchName) || b.branchName || "—"}
                      </p>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold lg:hidden",
                          CYCLE_STATUS_TONE[b.cycleStatus] || "bg-muted",
                        )}
                      >
                        {b.cycleStatusLabel}
                      </span>
                    </div>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                      <UserRound className="h-3 w-3 shrink-0" />
                      Mudir: <span className="truncate font-medium text-foreground/80">{b.mudirName}</span>
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">Koordinator: {b.region || "—"}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 lg:block lg:space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="w-12 text-muted-foreground">Oxirgi</span>
                      <span className="font-semibold tabular-nums text-foreground">{formatYmd(b.lastRevisionDate)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="w-12 text-muted-foreground">Keyingi</span>
                      <span className="font-semibold tabular-nums text-foreground">{formatYmd(b.nextRevisionDate)}</span>
                    </div>
                    <div className="col-span-2">
                      <DaysChip b={b} />
                    </div>
                  </div>

                  <div className="hidden lg:block">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold",
                        CYCLE_STATUS_TONE[b.cycleStatus] || "bg-muted",
                      )}
                    >
                      {b.cycleStatusLabel}
                    </span>
                    {b.cycleMonths ? (
                      <p className="mt-1 text-[10px] text-muted-foreground">Har {b.cycleMonths} oyda</p>
                    ) : null}
                  </div>

                  <CollectBar b={b} />

                  <div className="min-w-0 space-y-0.5">
                    <p className="flex items-center gap-1 truncate text-[12px] font-semibold text-foreground">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                      {b.assignedRevizorName || <span className="font-normal text-muted-foreground">Revizor yo‘q</span>}
                    </p>
                    {b.responsibleNames ? (
                      <p className="truncate text-[11px] text-muted-foreground">
                        Javobgar: <span className="font-medium text-foreground/80">{b.responsibleNames}</span>
                      </p>
                    ) : null}
                    {b.lastActNumber ? (
                      <p className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                        <CalendarClock className="h-3 w-3" /> Akt {b.lastActNumber}
                      </p>
                    ) : null}
                  </div>

                  <ChevronRight className="hidden h-4 w-4 text-muted-foreground lg:block" />
                </button>
              </li>
            ))}
          </ul>
          {pg && pg.pages > 1 ? (
            <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5">
              <span className="text-xs text-muted-foreground">
                {offset + 1}–{Math.min(offset + pg.limit, pg.total)} / {pg.total}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-lg"
                  disabled={page <= 1}
                  onClick={() => onPage(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 text-xs font-semibold tabular-nums">
                  {page} / {pg.pages}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-lg"
                  disabled={page >= pg.pages}
                  onClick={() => onPage(page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
