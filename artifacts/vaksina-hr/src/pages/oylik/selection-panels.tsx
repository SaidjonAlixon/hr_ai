import type { ReactNode } from "react";
import {
  ArrowRightLeft,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  PencilLine,
  Settings2,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { datesFromTo, formatShortUz, todayYmd, weekdayShort, type PayGrain, type PayWeek } from "@/lib/oylik-period";
import { WEEKDAYS_UZ, hoursText, type ScopeSchedule } from "@/lib/work-calendar-api";

export type ShiftOption = { key: string; label: string; count: number; scope: string };

/** Haftalik dam kunlari (ISO 1–7). Jadval yuklanmagan bo‘lsa — standart. */
export function restWeekdaysOf(schedule: ScopeSchedule | undefined, scope: string): number[] | null {
  if (scope === "xavfsizlik") return null;
  if (!schedule) return null;
  if (schedule.rule) return schedule.rule.restWeekdays;
  if (schedule.legacy) return scope === "ofis" ? [6, 7] : [7];
  return [];
}

function ruleText(rest: number[] | null, scope: string): string {
  if (scope === "xavfsizlik") return "Navbatchilik grafigi";
  if (rest == null) return "Jadval yuklanmoqda…";
  if (!rest.length) return "Har kuni ish";
  return `${rest.map((d) => WEEKDAYS_UZ[d - 1]?.short).join(", ")} — dam`;
}

function WeekDots({ rest, on }: { rest: number[] | null; on: boolean }) {
  if (!rest) return null;
  return (
    <span className="flex gap-[3px]" aria-hidden>
      {WEEKDAYS_UZ.map((w) => {
        const off = rest.includes(w.day);
        return (
          <span
            key={w.day}
            title={`${w.label}: ${off ? "dam" : "ish"}`}
            className={cn(
              "h-1.5 w-3 rounded-full",
              off
                ? on ? "bg-white/25" : "bg-slate-200 dark:bg-slate-700"
                : on ? "bg-emerald-300" : "bg-emerald-500",
            )}
          />
        );
      })}
    </span>
  );
}

export function ShiftCards({
  allLabel,
  total,
  options,
  value,
  onChange,
  scheduleOf,
}: {
  allLabel: string;
  total: number;
  options: ShiftOption[];
  value: string;
  onChange: (key: string) => void;
  scheduleOf: (scope: string) => ScopeSchedule | undefined;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
      <button
        type="button"
        onClick={() => onChange("")}
        className={cn(
          "group relative flex min-h-[76px] flex-col justify-between rounded-xl border-2 px-3 py-2.5 text-left transition",
          !value
            ? "border-[#0b3a5c] bg-[#0b3a5c] text-white shadow-md"
            : "border-slate-200 bg-white hover:border-[#0b3a5c]/40 hover:shadow-sm dark:border-white/10 dark:bg-slate-950",
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="text-sm font-bold leading-tight">{allLabel}</span>
          {!value ? <Check className="h-4 w-4 shrink-0" /> : null}
        </span>
        <span className={cn("text-xl font-bold tabular-nums leading-none", !value ? "text-white" : "text-[#0f2744] dark:text-white")}>
          {total}
          <span className={cn("ml-1 text-[11px] font-semibold", !value ? "text-white/70" : "text-muted-foreground")}>xodim</span>
        </span>
      </button>
      {options.map((opt) => {
        const on = value === opt.key;
        const empty = opt.count === 0;
        const rest = restWeekdaysOf(scheduleOf(opt.scope), opt.scope);
        const hours = opt.scope === "xavfsizlik" ? "09:00–09:00" : hoursText(scheduleOf(opt.scope)?.hours);
        return (
          <button
            key={opt.key}
            type="button"
            disabled={empty && !on}
            onClick={() => onChange(on ? "" : opt.key)}
            className={cn(
              "relative flex min-h-[76px] flex-col justify-between gap-1.5 rounded-xl border-2 px-3 py-2.5 text-left transition",
              on
                ? "border-[#0b3a5c] bg-[#0b3a5c] text-white shadow-md"
                : "border-slate-200 bg-white hover:border-[#0b3a5c]/40 hover:shadow-sm dark:border-white/10 dark:bg-slate-950",
              empty && !on && "cursor-not-allowed border-dashed opacity-50 hover:border-slate-200 hover:shadow-none",
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="text-sm font-bold leading-tight">{opt.label}</span>
              <span
                className={cn(
                  "min-w-[1.75rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums",
                  on ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
                )}
              >
                {opt.count}
              </span>
            </span>
            <span className="space-y-1">
              {hours ? (
                <span className={cn("flex items-center gap-1 text-[12px] font-bold tabular-nums", on ? "text-white" : "text-[#0b3a5c] dark:text-sky-200")}>
                  <Clock3 className="h-3 w-3" />
                  {hours}
                </span>
              ) : null}
              <WeekDots rest={rest} on={on} />
              <span className={cn("block truncate text-[11px] font-medium", on ? "text-white/75" : "text-muted-foreground")}>
                {empty && !on ? "Xodim yo‘q" : ruleText(rest, opt.scope)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ScheduleStrip({
  title,
  scope,
  schedule,
  workCount,
  totalDays,
  calOpen,
  onToggleCal,
  canSchedule,
  onOpenSchedule,
  onOpenSwaps,
  children,
}: {
  title: string;
  scope: string;
  schedule: ScopeSchedule | undefined;
  workCount: number;
  totalDays: number;
  calOpen: boolean;
  onToggleCal: () => void;
  canSchedule: boolean;
  onOpenSchedule: () => void;
  onOpenSwaps: () => void;
  children?: ReactNode;
}) {
  const rest = restWeekdaysOf(schedule, scope);
  const restCount = Math.max(0, totalDays - workCount);
  const pharmacy = scope.startsWith("dorixona:");
  const upcoming = schedule?.upcoming[0];
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-emerald-200/70 bg-gradient-to-r from-emerald-50/80 via-white to-white dark:border-emerald-500/20 dark:from-emerald-500/10 dark:via-slate-900 dark:to-slate-900">
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
          {scope === "xavfsizlik" ? <ShieldCheck className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[#0f2744] dark:text-white">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            {schedule?.hours ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#0b3a5c] px-2 py-0.5 tabular-nums text-white">
                <Clock3 className="h-3 w-3" /> {hoursText(schedule.hours)}
              </span>
            ) : null}
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-white">{workCount} ish kuni</span>
            <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-slate-700 dark:bg-white/10 dark:text-slate-200">{restCount} dam kuni</span>
            {scope !== "xavfsizlik" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-white/10">
                <Sun className="h-3 w-3 text-amber-500" /> Haftalik: {ruleText(rest, scope)}
              </span>
            ) : null}
            {upcoming ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                {upcoming.effectiveFrom.split("-").reverse().join(".")} dan yangi jadval
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleCal}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition",
              calOpen
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-emerald-500 hover:text-emerald-700 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200",
            )}
          >
            <CalendarRange className="h-4 w-4" />
            Kalendar
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", calOpen && "rotate-180")} />
          </button>
          {canSchedule && pharmacy ? (
            <button
              type="button"
              onClick={onOpenSwaps}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[#0b3a5c]/50 hover:text-[#0b3a5c] dark:border-white/10 dark:bg-slate-950 dark:text-slate-200"
            >
              <ArrowRightLeft className="h-4 w-4" />
              Almashuvlar
            </button>
          ) : null}
          {canSchedule && scope !== "xavfsizlik" ? (
            <button
              type="button"
              onClick={onOpenSchedule}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0b3a5c] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0b3a5c]/90"
            >
              <Settings2 className="h-4 w-4" />
              Jadvalni sozlash
            </button>
          ) : null}
        </div>
      </div>
      {children ? <div className="border-t border-emerald-100 bg-white px-3.5 pb-3.5 dark:border-white/10 dark:bg-slate-900">{children}</div> : null}
    </div>
  );
}

export function ScheduleHint() {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-slate-300 px-3.5 py-3 text-xs text-muted-foreground dark:border-white/15">
      <CalendarDays className="h-5 w-5 shrink-0 text-slate-400" />
      <span>Smenani tanlang — shu smenaning ish va dam kunlari, haftalik jadvali va kalendari shu yerda chiqadi.</span>
    </div>
  );
}

const GRAINS: Array<{ key: PayGrain; label: string; sub: string; icon: typeof CalendarDays }> = [
  { key: "kun", label: "Kun", sub: "Bitta kun", icon: CalendarDays },
  { key: "hafta", label: "Hafta", sub: "7 kun jadvali", icon: CalendarRange },
  { key: "oy", label: "Oy", sub: "Butun oy", icon: CalendarDays },
];

const GRAIN_TEXT: Record<PayGrain, { mode: string; editable: boolean; text: string }> = {
  kun: {
    mode: "Tahrirlash va tasdiqlash",
    editable: true,
    text: "Summa yoki jarimani o‘zgartirsangiz darhol saqlanadi. Tekshirib bo‘lgach «Tasdiqlash» ni bosing — shundan keyin xodim o‘z oyligini ko‘radi.",
  },
  hafta: {
    mode: "Faqat ko‘rish",
    editable: false,
    text: "Har katakda kunlik summa, jarima va qo‘lda qoladigan pul. Kunni bossangiz — o‘sha kunni tahrirlashga o‘tasiz.",
  },
  oy: {
    mode: "Faqat ko‘rish",
    editable: false,
    text: "Oyning hamma kuni bitta jadvalda. Kunni bossangiz — o‘sha kunni tahrirlashga o‘tasiz.",
  },
};

export function PeriodPicker({
  month,
  grain,
  onGrain,
  weeks,
  activeWeek,
  anchor,
  onPick,
  isRest,
  periodLabel,
  canEditFiksa,
  onFiksa,
}: {
  month: string;
  grain: PayGrain;
  onGrain: (g: PayGrain) => void;
  weeks: PayWeek[];
  activeWeek: PayWeek | undefined;
  anchor: string;
  onPick: (date: string) => void;
  isRest: ((date: string) => boolean) | null;
  periodLabel: string;
  canEditFiksa: boolean;
  onFiksa: () => void;
}) {
  const today = todayYmd();
  const weekIndex = activeWeek ? weeks.findIndex((w) => w.from === activeWeek.from) : -1;
  const info = GRAIN_TEXT[grain];
  const goWeek = (delta: number) => {
    const next = weeks[weekIndex + delta];
    if (next) onPick(next.from);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-white/5">
          {GRAINS.map((g) => {
            const on = grain === g.key;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => onGrain(g.key)}
                className={cn(
                  "flex min-w-[96px] items-center gap-2 rounded-lg px-3.5 py-2 text-left transition",
                  on ? "bg-[#0b3a5c] text-white shadow-md" : "text-slate-600 hover:bg-white hover:text-[#0b3a5c] dark:text-slate-300 dark:hover:bg-white/10",
                )}
              >
                <g.icon className="h-4 w-4 shrink-0" />
                <span>
                  <span className="block text-sm font-bold leading-tight">{g.label}</span>
                  <span className={cn("block text-[10px] font-medium leading-tight", on ? "text-white/70" : "text-slate-400")}>{g.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
            info.editable ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300",
          )}
        >
          {info.editable ? <PencilLine className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {info.mode}
        </span>
      </div>

      {grain !== "oy" ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Hafta</p>
          <div className="flex items-stretch gap-1.5">
            <button
              type="button"
              onClick={() => goWeek(-1)}
              disabled={weekIndex <= 0}
              className="flex w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-[#0b3a5c]/40 hover:text-[#0b3a5c] disabled:opacity-30 dark:border-white/10"
              aria-label="Oldingi hafta"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(135px,1fr))]">
              {weeks.map((week, index) => {
                const on = activeWeek?.from === week.from;
                const hasToday = today >= week.from && today <= week.to;
                return (
                  <button
                    key={week.from}
                    type="button"
                    onClick={() => onPick(anchor >= week.from && anchor <= week.to ? anchor : hasToday ? today : week.from)}
                    className={cn(
                      "rounded-xl border-2 px-3 py-2 text-left transition",
                      on
                        ? "border-[#0b3a5c] bg-[#0b3a5c]/[0.06] dark:bg-white/5"
                        : "border-slate-200 hover:border-[#0b3a5c]/30 dark:border-white/10",
                    )}
                  >
                    <span className="flex items-center justify-between gap-1">
                      <span className={cn("text-[11px] font-bold", on ? "text-[#0b3a5c] dark:text-sky-200" : "text-slate-400")}>{index + 1}-hafta</span>
                      {hasToday ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Bugun shu haftada" /> : null}
                    </span>
                    <span className="block truncate text-sm font-semibold text-[#0f2744] dark:text-white">
                      {week.from === week.to ? formatShortUz(week.from) : `${Number(week.from.slice(8))}–${formatShortUz(week.to)}`}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">{week.days} kun</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => goWeek(1)}
              disabled={weekIndex < 0 || weekIndex >= weeks.length - 1}
              className="flex w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-[#0b3a5c]/40 hover:text-[#0b3a5c] disabled:opacity-30 dark:border-white/10"
              aria-label="Keyingi hafta"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {grain === "kun" && activeWeek ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Kun</p>
            {today.startsWith(month) && anchor !== today ? (
              <button type="button" onClick={() => onPick(today)} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Bugunga o‘tish
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {datesFromTo(activeWeek.from, activeWeek.to).map((date) => {
              const on = date === anchor;
              const isToday = date === today;
              const rest = isRest ? isRest(date) : false;
              const future = date > today;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => onPick(date)}
                  className={cn(
                    "relative flex h-[74px] flex-col items-center justify-center rounded-xl border-2 transition",
                    on
                      ? "border-[#0b3a5c] bg-[#0b3a5c] text-white shadow-md"
                      : rest
                        ? "border-dashed border-slate-300 bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgba(148,163,184,0.12)_6px,rgba(148,163,184,0.12)_12px)] text-slate-400 hover:border-slate-400 dark:border-white/15"
                        : "border-slate-200 bg-white text-slate-800 hover:border-[#0b3a5c]/40 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100",
                    future && !on && "opacity-60",
                  )}
                >
                  <span className={cn("text-[10px] font-bold uppercase tracking-wide", on ? "text-white/70" : "text-slate-400")}>{weekdayShort(date)}</span>
                  <span className="text-xl font-bold leading-tight tabular-nums">{Number(date.slice(8, 10))}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[9px] font-bold uppercase leading-4",
                      on
                        ? "bg-white/15 text-white"
                        : isToday
                          ? "bg-emerald-500 text-white"
                          : rest
                            ? "bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-slate-300"
                            : "text-transparent",
                    )}
                  >
                    {isToday ? "bugun" : rest ? "dam" : "ish"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border-l-4 border-[#0b3a5c] bg-[#0b3a5c]/[0.04] px-3.5 py-3 dark:border-sky-300 dark:bg-white/5">
        <CalendarDays className="h-5 w-5 shrink-0 text-[#0b3a5c] dark:text-sky-200" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[#0f2744] dark:text-white">
            Tanlangan davr: <span className="font-bold">{periodLabel}</span>
            {grain === "kun" && weekIndex >= 0 ? <span className="text-muted-foreground"> · {weekIndex + 1}-hafta</span> : null}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{info.text}</p>
        </div>
        {canEditFiksa ? (
          <button
            type="button"
            onClick={onFiksa}
            title="Fiksa — xodimning 1 oylik maoshi. Kunlik summa shundan avtomatik hisoblanadi."
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#0b3a5c]/30 bg-white px-3 text-xs font-semibold text-[#0b3a5c] transition hover:bg-[#0b3a5c] hover:text-white dark:bg-slate-950 dark:text-sky-200"
          >
            <PencilLine className="h-4 w-4" /> Fiksa kiritish
          </button>
        ) : null}
      </div>
    </div>
  );
}
