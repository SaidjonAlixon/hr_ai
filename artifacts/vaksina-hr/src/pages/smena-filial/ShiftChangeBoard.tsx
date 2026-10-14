import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarRange,
  Check,
  CheckCircle2,
  Clock,
  Info,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { scriptIncludes } from "@/lib/script-search";
import {
  changeShiftOnly,
  clearCustomHours,
  fetchShiftBoard,
  saveAltDays,
  saveCustomHours,
  saveShiftOverride,
  type ShiftBoardOption,
  type ShiftBoardStaff,
  type SlotShiftKey,
} from "@/lib/smena-api";

const WEEKDAYS = [
  { value: 1, short: "Du", full: "Dushanba" },
  { value: 2, short: "Se", full: "Seshanba" },
  { value: 3, short: "Ch", full: "Chorshanba" },
  { value: 4, short: "Pa", full: "Payshanba" },
  { value: 5, short: "Ju", full: "Juma" },
  { value: 6, short: "Sh", full: "Shanba" },
  { value: 7, short: "Ya", full: "Yakshanba" },
] as const;

const SHIFT_TONE: Record<SlotShiftKey, { chip: string; cell: string; dot: string }> = {
  one: {
    chip: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
    cell: "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100",
    dot: "bg-sky-500",
  },
  two: {
    chip: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    cell: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
    dot: "bg-amber-500",
  },
  three: {
    chip: "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200",
    cell: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/50 dark:text-indigo-100",
    dot: "bg-indigo-500",
  },
  "one+two": {
    chip: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    cell: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100",
    dot: "bg-emerald-500",
  },
  "two+three": {
    chip: "border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200",
    cell: "bg-purple-100 text-purple-900 dark:bg-purple-900/50 dark:text-purple-100",
    dot: "bg-purple-500",
  },
};

const SHIFT_SHORT: Record<SlotShiftKey, string> = {
  one: "1",
  two: "2",
  three: "3",
  "one+two": "1+2",
  "two+three": "2+3",
};

function orgLabel(org: string | null) {
  if (org === "pharmacist") return "Farmasevt";
  if (org === "intern") return "Stajyor";
  if (org === "manager") return "Mudir";
  if (org === "supervisor") return "Boshqaruvchi";
  return "Xodim";
}

function optionFor(options: ShiftBoardOption[], key: SlotShiftKey): ShiftBoardOption | undefined {
  return options.find((o) => o.key === key);
}

function shiftText(options: ShiftBoardOption[], key: SlotShiftKey): string {
  const o = optionFor(options, key);
  return o ? `${o.label} (${o.start}–${o.end})` : SHIFT_SHORT[key];
}

/** «Du–Ju, Ya» ko‘rinishida qisqa kunlar ro‘yxati */
function weekdaysText(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    const from = WEEKDAYS[sorted[i]! - 1]!.short;
    const to = WEEKDAYS[sorted[j]! - 1]!.short;
    parts.push(j - i >= 2 ? `${from}–${to}` : j > i ? `${from}, ${to}` : from);
    i = j + 1;
  }
  return parts.join(", ");
}

function ShiftChip({ shiftKey, options, className }: { shiftKey: SlotShiftKey; options: ShiftBoardOption[]; className?: string }) {
  const o = optionFor(options, shiftKey);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        SHIFT_TONE[shiftKey].chip,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", SHIFT_TONE[shiftKey].dot)} />
      {o?.label || SHIFT_SHORT[shiftKey]}
      {o ? <span className="font-normal opacity-80">{o.start}–{o.end}</span> : null}
    </span>
  );
}

function WeekStrip({
  week,
  todayWeekday,
  highlight,
}: {
  week: Array<{ weekday: number; shiftKey: SlotShiftKey; override: boolean }>;
  todayWeekday?: number;
  highlight?: number[];
}) {
  return (
    <div className="flex gap-1">
      {week.map((d) => {
        const meta = WEEKDAYS[d.weekday - 1]!;
        const isToday = todayWeekday === d.weekday;
        const isHighlighted = highlight?.includes(d.weekday);
        return (
          <div
            key={d.weekday}
            title={`${meta.full}: ${SHIFT_SHORT[d.shiftKey]}-smena${d.override ? " (almashtirilgan)" : ""}`}
            className={cn(
              "flex w-9 flex-col items-center rounded-md py-1 text-[10px] leading-tight",
              SHIFT_TONE[d.shiftKey].cell,
              d.override && "ring-2 ring-offset-1 ring-rose-400 ring-offset-background",
              isHighlighted && "ring-2 ring-offset-1 ring-primary ring-offset-background",
            )}
          >
            <span className={cn("font-medium opacity-70", isToday && "font-bold underline opacity-100")}>{meta.short}</span>
            <span className="font-bold">{SHIFT_SHORT[d.shiftKey]}</span>
          </div>
        );
      })}
    </div>
  );
}

function ShiftPicker({
  options,
  value,
  current,
  onChange,
}: {
  options: ShiftBoardOption[];
  value: SlotShiftKey | null;
  current?: SlotShiftKey;
  onChange: (k: SlotShiftKey) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map((o) => {
        const selected = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              "flex flex-col items-start rounded-xl border p-2.5 text-left transition",
              selected
                ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
            )}
          >
            <div className="flex w-full items-center justify-between gap-1">
              <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                <span className={cn("h-2 w-2 rounded-full", SHIFT_TONE[o.key].dot)} />
                {o.label}
              </span>
              {selected ? <Check className="h-4 w-4 text-primary" /> : null}
            </div>
            <span className="mt-1 text-xs font-semibold text-foreground">
              {o.start} – {o.end}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {current === o.key ? "Hozirgi asosiy smena" : o.overnight ? "Tungi (ertasi kun tugaydi)" : "\u00a0"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const ALT_BACKDATE_DAYS = 7;
const ALT_AHEAD_DAYS = 90;

function ymdDays(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

function addDays(ymd: string, n: number): string {
  return new Date((ymdDays(ymd) + n) * 86_400_000).toISOString().slice(0, 10);
}

function ymdUz(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

/** 0=Du … 6=Ya */
function weekdayIdx(ymd: string): number {
  return (ymdDays(ymd) + 3) % 7;
}

function altPreview(anchor: string, from: string, count: number): Array<{ date: string; work: boolean | null }> {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(from, i);
    return { date, work: date < anchor ? null : (ymdDays(date) - ymdDays(anchor)) % 2 === 0 };
  });
}

function AltStrip({ days, today }: { days: Array<{ date: string; work: boolean | null }>; today?: string }) {
  return (
    <div className="flex gap-1">
      {days.map((d) => {
        const wd = WEEKDAYS[weekdayIdx(d.date)]!;
        const isToday = d.date === today;
        return (
          <div
            key={d.date}
            title={`${wd.full}, ${ymdUz(d.date)}: ${d.work == null ? "kunora boshlanmagan" : d.work ? "ish kuni" : "dam kuni"}`}
            className={cn(
              "flex w-9 flex-col items-center rounded-md py-1 text-[10px] leading-tight",
              d.work == null
                ? "bg-muted text-muted-foreground"
                : d.work
                  ? "bg-teal-100 text-teal-900 dark:bg-teal-900/50 dark:text-teal-100"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400",
              isToday && "ring-2 ring-offset-1 ring-teal-500 ring-offset-background",
            )}
          >
            <span className={cn("font-medium opacity-70", isToday && "font-bold underline opacity-100")}>
              {wd.short} {d.date.slice(8)}
            </span>
            <span className="font-bold">{d.work == null ? "·" : d.work ? "Ish" : "Dam"}</span>
          </div>
        );
      })}
    </div>
  );
}

function AltBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-teal-300 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200",
        className,
      )}
    >
      <Repeat className="h-3 w-3" />
      Kunora
    </span>
  );
}

function hmMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function durationText(start: string, end: string): string {
  let d = hmMinutes(end) - hmMinutes(start);
  if (d <= 0) d += 24 * 60;
  const h = Math.floor(d / 60);
  const m = d % 60;
  return m ? `${h} soat ${m} daqiqa` : `${h} soat`;
}

function CustomHoursBadge({ hours, className }: { hours: NonNullable<ShiftBoardStaff["customHours"]>; className?: string }) {
  return (
    <span
      title={
        hours.mode === "period"
          ? `Shaxsiy vaqt ${ymdUz(hours.validFrom)} — ${ymdUz(hours.validTo || hours.validFrom)}`
          : `Shaxsiy vaqt ${ymdUz(hours.validFrom)} dan doimiy`
      }
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200",
        className,
      )}
    >
      <Clock className="h-3 w-3" />
      Shaxsiy {hours.start}–{hours.end}
      {!hours.activeToday ? <span className="font-normal opacity-80">· {ymdUz(hours.validFrom)} dan</span> : null}
    </span>
  );
}

type FilterKey = "all" | SlotShiftKey | "override" | "alt" | "custom";

export default function ShiftChangeBoard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const boardQ = useQuery({ queryKey: ["smena-shift-board"], queryFn: fetchShiftBoard });

  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [shiftFilter, setShiftFilter] = useState<FilterKey>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const options = boardQ.data?.shiftOptions ?? [];
  const staff = boardQ.data?.staff ?? [];
  const todayWeekday = boardQ.data?.todayWeekday;
  const selected = useMemo(() => staff.find((s) => s.employeeId === selectedId) ?? null, [staff, selectedId]);

  const branchNames = useMemo(
    () => [...new Set(staff.map((s) => s.branchName).filter((n): n is string => Boolean(n)))].sort((a, b) => a.localeCompare(b, "uz")),
    [staff],
  );

  const byBranchAndSearch = useMemo(() => {
    const q = search.trim();
    return staff.filter((s) => {
      if (branchFilter !== "all" && s.branchName !== branchFilter) return false;
      if (!q) return true;
      return scriptIncludes(`${s.fullName} ${s.branchName || ""}`, q);
    });
  }, [staff, search, branchFilter]);

  const filtered = useMemo(() => {
    if (shiftFilter === "all") return byBranchAndSearch;
    if (shiftFilter === "override") return byBranchAndSearch.filter((s) => s.overrides.length > 0);
    if (shiftFilter === "alt") return byBranchAndSearch.filter((s) => s.altDays);
    if (shiftFilter === "custom") return byBranchAndSearch.filter((s) => s.customHours);
    return byBranchAndSearch.filter((s) => s.baseShiftKey === shiftFilter);
  }, [byBranchAndSearch, shiftFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: byBranchAndSearch.length, override: 0, alt: 0, custom: 0 };
    for (const s of byBranchAndSearch) {
      c[s.baseShiftKey] = (c[s.baseShiftKey] || 0) + 1;
      if (s.overrides.length) c.override! += 1;
      if (s.altDays) c.alt! += 1;
      if (s.customHours) c.custom! += 1;
    }
    return c;
  }, [byBranchAndSearch]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["smena-shift-board"] });
    void qc.invalidateQueries({ queryKey: ["smena-slots-all"] });
    void qc.invalidateQueries({ queryKey: ["smena-me"] });
    void qc.invalidateQueries({ queryKey: ["smena-history"] });
  };

  return (
    <div className="space-y-5">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card shadow-sm">
        <CardContent className="grid gap-4 pt-5 md:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <SlidersHorizontal className="h-4 w-4" />
              </span>
              <h2 className="text-base font-bold text-foreground">Smena o‘zgartirish</h2>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Bu bo‘limda faqat <strong>smena</strong> o‘zgaradi. Xodimning filiali, rotatsiyalari va boshqa
              ma’lumotlari tegilmaydi. Har bir xodimning asosiy smenasi, bugungi smenasi va haftalik rejasi
              ko‘rinib turadi.
            </p>
          </div>
          <ol className="space-y-1.5 text-xs text-foreground">
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">1</span>
              <span>Xodimni qidiring va <strong>«O‘zgartirish»</strong> tugmasini bosing.</span>
            </li>
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">2</span>
              <span><strong>Asosiy smena</strong> — xodim har kuni ishlaydigan smena.</span>
            </li>
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">3</span>
              <span>
                <strong>Haftalik almashtirish</strong> — masalan faqat Shanba kuni 2-smena, qolgan kunlar asosiy smena.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">4</span>
              <span>
                <strong>Kunora (cherez den)</strong> — smena o‘sha-o‘sha, xodim bir kun ishlaydi, bir kun dam oladi.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">5</span>
              <span>
                <strong>Shaxsiy ish vaqti</strong> — faqat shu xodimga o‘z kelish–ketish soati (masalan 09:30–18:30).
              </span>
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card className="border-border shadow-sm">
        <CardHeader className="space-y-3 border-b bg-muted/20 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" />
              Xodimlar smenasi
              <span className="text-sm font-normal text-muted-foreground">· {filtered.length} ta</span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px]">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Ism yoki filial bo‘yicha qidirish..."
                  className="h-9 pl-8 text-xs"
                />
              </div>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="h-9 max-w-[200px] rounded-lg border border-border bg-card px-2.5 text-xs text-foreground"
              >
                <option value="all">Barcha filiallar</option>
                {branchNames.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                className="h-9"
                onClick={() => void boardQ.refetch()}
                disabled={boardQ.isFetching}
                title="Yangilash"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", boardQ.isFetching && "animate-spin")} />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["all", ...options.map((o) => o.key), "override", "alt", "custom"] as FilterKey[]).map((k) => {
              const active = shiftFilter === k;
              const label =
                k === "all"
                  ? "Hammasi"
                  : k === "override"
                    ? "Haftalik almashtirishi bor"
                    : k === "alt"
                      ? "Kunora (cherez den)"
                      : k === "custom"
                        ? "Shaxsiy vaqt"
                        : optionFor(options, k)?.label || k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setShiftFilter(k)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
                    active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted",
                  )}
                >
                  {k !== "all" && k !== "override" && k !== "alt" && k !== "custom" ? (
                    <span className={cn("h-1.5 w-1.5 rounded-full", SHIFT_TONE[k].dot)} />
                  ) : null}
                  {k === "alt" ? <Repeat className="h-3 w-3" /> : null}
                  {k === "custom" ? <Clock className="h-3 w-3" /> : null}
                  {label} · {counts[k] || 0}
                </button>
              );
            })}
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {boardQ.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Yuklanmoqda...</p>
          ) : boardQ.isError ? (
            <p className="py-8 text-center text-sm text-rose-600">{(boardQ.error as Error).message}</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Xodim topilmadi. Qidiruv yoki filtrni o‘zgartiring.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5">Xodim</th>
                    <th className="px-3 py-2.5">Filial</th>
                    <th className="px-3 py-2.5">Asosiy smena</th>
                    <th className="px-3 py-2.5">Bugun</th>
                    <th className="px-3 py-2.5">Hafta rejasi</th>
                    <th className="px-3 py-2.5 text-right">Amal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.map((s) => (
                    <tr key={s.employeeId} className="hover:bg-muted/30">
                      <td className="px-3 py-3">
                        <p className="font-semibold text-foreground">{s.fullName}</p>
                        <p className="text-[11px] text-muted-foreground">{orgLabel(s.orgRole)}</p>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {s.branchName || "—"}
                        {s.otherRotations > 0 ? (
                          <span className="ml-1.5 rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 dark:text-purple-300">
                            +{s.otherRotations} rotatsiya
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <ShiftChip shiftKey={s.baseShiftKey} options={options} />
                          {s.altDays ? <AltBadge /> : null}
                          {s.customHours ? <CustomHoursBadge hours={s.customHours} /> : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {s.altDays?.todayWork === false ? (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                            Dam kuni (kunora)
                          </span>
                        ) : s.customHours?.activeToday ? (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-cyan-300 bg-cyan-50 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200">
                            <Clock className="h-3 w-3" />
                            {s.customHours.start}–{s.customHours.end}
                          </span>
                        ) : (
                          <ShiftChip shiftKey={s.todayShiftKey} options={options} />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {s.altDays ? (
                          <div className="space-y-1">
                            <AltStrip days={s.altDays.days.slice(0, 7)} today={boardQ.data?.today} />
                            {s.altDays.anchor > (boardQ.data?.today ?? "") ? (
                              <p className="text-[10px] text-muted-foreground">{ymdUz(s.altDays.anchor)} dan boshlanadi</p>
                            ) : null}
                          </div>
                        ) : (
                          <WeekStrip week={s.week} todayWeekday={todayWeekday} />
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button size="sm" className="h-8 text-xs" onClick={() => setSelectedId(s.employeeId)}>
                          O‘zgartirish
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Belgilar:</span>
            {options.map((o) => (
              <span key={o.key} className="flex items-center gap-1">
                <span className={cn("h-2.5 w-2.5 rounded", SHIFT_TONE[o.key].dot)} />
                {o.label} {o.start}–{o.end}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded ring-2 ring-rose-400" />
              Almashtirilgan kun
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded bg-teal-400" />
              Kunora — ish kuni
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded bg-slate-300 dark:bg-slate-600" />
              Kunora — dam kuni
            </span>
          </div>
        </CardContent>
      </Card>

      <ShiftEditorDialog
        person={selected}
        options={options}
        todayWeekday={todayWeekday}
        today={boardQ.data?.today ?? ""}
        onClose={() => setSelectedId(null)}
        onSaved={invalidate}
        notify={(title, description, destructive) =>
          toast({ title, description, variant: destructive ? "destructive" : undefined })
        }
      />
    </div>
  );
}

function ShiftEditorDialog({
  person,
  options,
  todayWeekday,
  today,
  onClose,
  onSaved,
  notify,
}: {
  person: ShiftBoardStaff | null;
  options: ShiftBoardOption[];
  todayWeekday?: number;
  today: string;
  onClose: () => void;
  onSaved: () => void;
  notify: (title: string, description?: string, destructive?: boolean) => void;
}) {
  const [baseKey, setBaseKey] = useState<SlotShiftKey | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [dayShift, setDayShift] = useState<SlotShiftKey | null>(null);
  const [altAnchor, setAltAnchor] = useState("");
  const [chStart, setChStart] = useState("");
  const [chEnd, setChEnd] = useState("");
  const [chPeriod, setChPeriod] = useState(false);
  const [chFrom, setChFrom] = useState("");
  const [chTo, setChTo] = useState("");
  const [chNote, setChNote] = useState("");

  const resetCustomHours = () => {
    const ch = person?.customHours;
    const base = person ? optionFor(options, person.baseShiftKey) : undefined;
    setChStart(ch?.start ?? base?.start ?? "09:00");
    setChEnd(ch?.end ?? base?.end ?? "18:00");
    setChPeriod(ch?.mode === "period");
    setChFrom(ch?.validFrom && ch.validFrom > today ? ch.validFrom : today);
    setChTo(ch?.validTo ?? "");
    setChNote(ch?.note ?? "");
  };

  const personId = person?.employeeId ?? null;
  useEffect(() => {
    setBaseKey(person?.baseShiftKey ?? null);
    setDays([]);
    setDayShift(null);
    setAltAnchor(person?.altDays?.anchor ?? today);
    resetCustomHours();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  useEffect(() => {
    if (person) setBaseKey(person.baseShiftKey);
  }, [person?.baseShiftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (person) setAltAnchor(person.altDays?.anchor ?? today);
  }, [person?.altDays?.anchor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (person) resetCustomHours();
  }, [person?.customHours?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hoursMut = useMutation({
    mutationFn: () =>
      saveCustomHours({
        employeeId: person!.employeeId,
        start: chStart,
        end: chEnd,
        validFrom: chFrom || today,
        validTo: chPeriod ? chTo : null,
        note: chNote.trim() || undefined,
      }),
    onSuccess: (res) => {
      notify("Shaxsiy vaqt saqlandi ✓", res.message);
      onSaved();
    },
    onError: (e: Error) => notify("Shaxsiy vaqt saqlanmadi", e.message, true),
  });

  const clearHoursMut = useMutation({
    mutationFn: () => clearCustomHours(person!.employeeId),
    onSuccess: (res) => {
      notify("Shaxsiy vaqt bekor qilindi ✓", res.message);
      onSaved();
    },
    onError: (e: Error) => notify("Bekor qilinmadi", e.message, true),
  });

  const baseMut = useMutation({
    mutationFn: () => changeShiftOnly(person!.employeeId, baseKey!),
    onSuccess: () => {
      notify("Asosiy smena saqlandi ✓", `${person?.fullName}: ${shiftText(options, baseKey!)}. Filial o‘zgarmadi.`);
      onSaved();
    },
    onError: (e: Error) => notify("Asosiy smena saqlanmadi", e.message, true),
  });

  const overrideMut = useMutation({
    mutationFn: (shiftKey: SlotShiftKey | null) =>
      saveShiftOverride({ employeeId: person!.employeeId, weekdays: days, shiftKey }),
    onSuccess: (res) => {
      notify(res.cleared ? "Kunlar asosiy smenaga qaytarildi ✓" : "Haftalik smena saqlandi ✓", res.message);
      setDays([]);
      setDayShift(null);
      onSaved();
    },
    onError: (e: Error) => notify("Saqlanmadi", e.message, true),
  });

  const clearOneMut = useMutation({
    mutationFn: (weekdays: number[]) => saveShiftOverride({ employeeId: person!.employeeId, weekdays, shiftKey: null }),
    onSuccess: (res) => {
      notify("Asosiy smenaga qaytarildi ✓", res.message);
      onSaved();
    },
    onError: (e: Error) => notify("Saqlanmadi", e.message, true),
  });

  const altMut = useMutation({
    mutationFn: (anchorDate: string | null) => saveAltDays({ employeeId: person!.employeeId, anchorDate }),
    onSuccess: (res) => {
      notify(res.cleared ? "Kunora bekor qilindi ✓" : "Kunora saqlandi ✓", res.message);
      onSaved();
    },
    onError: (e: Error) => notify("Kunora saqlanmadi", e.message, true),
  });

  const altMin = today ? addDays(today, -ALT_BACKDATE_DAYS) : "";
  const altMax = today ? addDays(today, ALT_AHEAD_DAYS) : "";
  const altValid = /^\d{4}-\d{2}-\d{2}$/.test(altAnchor) && altAnchor >= altMin && altAnchor <= altMax;
  const altDaysPreview = useMemo(
    () => (altValid && today ? altPreview(altAnchor, today, 14) : []),
    [altAnchor, altValid, today],
  );

  const previewWeek = useMemo(() => {
    if (!person) return [];
    return person.week.map((d) =>
      days.includes(d.weekday) && dayShift
        ? { ...d, shiftKey: dayShift, override: dayShift !== person.baseShiftKey }
        : d,
    );
  }, [person, days, dayShift]);

  const summary = useMemo(() => {
    const groups = new Map<SlotShiftKey, number[]>();
    for (const d of previewWeek) {
      const list = groups.get(d.shiftKey) || [];
      list.push(d.weekday);
      groups.set(d.shiftKey, list);
    }
    return [...groups.entries()];
  }, [previewWeek]);

  if (!person) return null;
  const busy =
    baseMut.isPending ||
    overrideMut.isPending ||
    clearOneMut.isPending ||
    altMut.isPending ||
    hoursMut.isPending ||
    clearHoursMut.isPending;
  const chCurrent = person.customHours;
  const hmOk = (v: string) => /^\d{2}:\d{2}$/.test(v);
  const chMinFrom = today ? addDays(today, -7) : "";
  const chError = !hmOk(chStart) || !hmOk(chEnd)
    ? "Kelish va ketish vaqtini kiriting"
    : chStart === chEnd
      ? "Kelish va ketish vaqti bir xil bo‘lmasin"
      : !chFrom || chFrom < chMinFrom
        ? `Boshlanish sanasi ${chMinFrom ? ymdUz(chMinFrom) : ""} dan oldin bo‘lmasin`
        : chPeriod && (!chTo || chTo < chFrom)
          ? "Muddatli uchun tugash sanasini to‘g‘ri tanlang"
          : null;
  const chOvernight = hmOk(chStart) && hmOk(chEnd) && hmMinutes(chEnd) <= hmMinutes(chStart);
  const altCurrent = person.altDays;
  const altChanged = altValid && altAnchor !== altCurrent?.anchor;
  const baseChanged = baseKey != null && baseKey !== person.baseShiftKey;

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));

  return (
    <Dialog open={Boolean(person)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">{person.fullName}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span>{orgLabel(person.orgRole)}</span>
              <span>·</span>
              <span>Filial: <strong className="text-foreground">{person.branchName || "—"}</strong></span>
              <span>·</span>
              <span>Asosiy:</span>
              <ShiftChip shiftKey={person.baseShiftKey} options={options} />
              <span>Bugun:</span>
              <ShiftChip shiftKey={person.todayShiftKey} options={options} />
              {person.customHours ? <CustomHoursBadge hours={person.customHours} /> : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* 1. Asosiy smena */}
          <section className="space-y-3 rounded-xl border border-border p-3.5">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">1</span>
                Asosiy smena — har kuni
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Xodim haftaning barcha kunlarida shu smenada ishlaydi (almashtirilgan kunlardan tashqari).
              </p>
              {person.customHours ? (
                <p className="mt-1.5 rounded-md bg-cyan-50 px-2 py-1 text-[11px] text-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-100">
                  Diqqat: shaxsiy vaqt ({person.customHours.start}–{person.customHours.end}) qo‘yilgan — davomat shu vaqtdan
                  hisoblanadi (4-bo‘lim).
                </p>
              ) : null}
            </div>
            <ShiftPicker options={options} value={baseKey} current={person.baseShiftKey} onChange={setBaseKey} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                {baseChanged ? (
                  <>
                    <strong className="text-foreground">{shiftText(options, person.baseShiftKey)}</strong>
                    <ArrowRight className="mx-1 inline h-3 w-3" />
                    <strong className="text-primary">{shiftText(options, baseKey!)}</strong>
                  </>
                ) : (
                  "Yangi asosiy smenani tanlang."
                )}
              </p>
              <Button size="sm" disabled={!baseChanged || busy} onClick={() => baseMut.mutate()}>
                {baseMut.isPending ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Asosiy smenani saqlash
              </Button>
            </div>
          </section>

          {/* 2. Haftalik almashtirish */}
          <section className="space-y-3 rounded-xl border border-border p-3.5">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">2</span>
                Haftaning ayrim kunlari — boshqa smena
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Kun(lar)ni belgilang va smenani tanlang. Faqat shu kunlar o‘zgaradi, qolgan kunlar asosiy smenada qoladi.
                Har hafta takrorlanadi.
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {person.week.map((d) => {
                const meta = WEEKDAYS[d.weekday - 1]!;
                const on = days.includes(d.weekday);
                return (
                  <button
                    key={d.weekday}
                    type="button"
                    onClick={() => toggleDay(d.weekday)}
                    className={cn(
                      "flex min-w-[64px] flex-col items-center rounded-lg border px-2 py-1.5 text-xs transition",
                      on ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-card hover:bg-muted",
                    )}
                  >
                    <span className="font-bold">{meta.short}</span>
                    <span className={cn("text-[10px]", on ? "opacity-90" : "text-muted-foreground")}>
                      hozir {SHIFT_SHORT[d.shiftKey]}
                      {d.override ? " ⟲" : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            <ShiftPicker options={options} value={dayShift} onChange={setDayShift} />

            <div className="rounded-xl bg-muted/50 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                <CalendarRange className="h-3.5 w-3.5 text-primary" />
                Natija (saqlangandan keyin shunday bo‘ladi):
              </p>
              <WeekStrip week={previewWeek} todayWeekday={todayWeekday} highlight={dayShift ? days : []} />
              <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                {summary.map(([key, wds]) => (
                  <li key={key}>
                    <strong className="text-foreground">{weekdaysText(wds)}</strong> — {shiftText(options, key)}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!days.length || busy}
                onClick={() => overrideMut.mutate(null)}
                title="Tanlangan kunlarni asosiy smenaga qaytarish"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Tanlangan kunlarni asosiyga qaytarish
              </Button>
              <Button size="sm" disabled={!days.length || !dayShift || busy} onClick={() => overrideMut.mutate(dayShift)}>
                {overrideMut.isPending ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Tanlangan kunlarga saqlash
              </Button>
            </div>

            {person.overrides.length > 0 ? (
              <div className="space-y-1.5 border-t pt-3">
                <p className="text-[11px] font-semibold text-foreground">Hozirgi haftalik almashtirishlar:</p>
                {person.overrides.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5">
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      <strong>{o.weekdays.map((d) => WEEKDAYS[d - 1]?.full).join(", ")}</strong>
                      <ShiftChip shiftKey={o.shiftKey} options={options} />
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                      disabled={busy}
                      onClick={() => clearOneMut.mutate(o.weekdays)}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Asosiyga qaytarish
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {/* 3. Kunora */}
          <section className="space-y-3 rounded-xl border border-teal-300/70 p-3.5 dark:border-teal-800/60">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-600 text-[11px] font-bold text-white">3</span>
                  Kunora (cherez den) — bir kun ish, bir kun dam
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Smena o‘zgarmaydi ({shiftText(options, person.baseShiftKey)}). Faqat ish kunlari o‘zgaradi: birinchi ish
                  kunini tanlang — undan keyin har ikkinchi kun ish kuni bo‘ladi. Dam kunlari davomatda «dam» hisoblanadi
                  (kelmagan / jarima yo‘q), ish kunlari esa majburiy.
                </p>
              </div>
              {altCurrent ? <AltBadge className="mt-0.5" /> : null}
            </div>

            {altCurrent ? (
              <p className="rounded-lg bg-teal-50 px-2.5 py-1.5 text-[11px] text-teal-900 dark:bg-teal-950/30 dark:text-teal-100">
                Hozir: <strong>{ymdUz(altCurrent.anchor)}</strong> dan kunora
                {altCurrent.todayWork === true ? " · bugun ish kuni" : altCurrent.todayWork === false ? " · bugun dam kuni" : ""}.
              </p>
            ) : null}

            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-foreground">Birinchi ish kuni</span>
                <Input
                  type="date"
                  value={altAnchor}
                  min={altMin}
                  max={altMax}
                  onChange={(e) => setAltAnchor(e.target.value)}
                  className="h-9 w-[170px] text-xs"
                />
              </label>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => setAltAnchor(today)}>
                  Bugundan
                </Button>
                <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => setAltAnchor(addDays(today, 1))}>
                  Ertadan
                </Button>
              </div>
            </div>
            {!altValid && altAnchor ? (
              <p className="text-[11px] text-rose-600">
                Sana {ymdUz(altMin)} — {ymdUz(altMax)} oralig‘ida bo‘lishi kerak.
              </p>
            ) : null}

            {altDaysPreview.length ? (
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                  <CalendarRange className="h-3.5 w-3.5 text-teal-600" />
                  Keyingi 14 kun (saqlangandan keyin):
                </p>
                <div className="space-y-1 overflow-x-auto">
                  <AltStrip days={altDaysPreview.slice(0, 7)} today={today} />
                  <AltStrip days={altDaysPreview.slice(7)} today={today} />
                </div>
                {altAnchor < today ? (
                  <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                    Diqqat: o‘tgan kundan boshlanadi — {ymdUz(altAnchor)} dan bugungacha bo‘lgan davomat ham kunora bo‘yicha
                    qayta hisoblanadi.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              {altCurrent ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                  disabled={busy}
                  onClick={() => altMut.mutate(null)}
                  title="Bugundan boshlab odatiy jadvalga qaytarish (oldingi kunlar o‘zgarmaydi)"
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Kunorani bekor qilish
                </Button>
              ) : null}
              <Button
                size="sm"
                className="bg-teal-600 text-white hover:bg-teal-700"
                disabled={!altChanged || busy}
                onClick={() => altMut.mutate(altAnchor)}
              >
                {altMut.isPending ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Repeat className="mr-1.5 h-3.5 w-3.5" />}
                {altCurrent ? "Kunorani yangilash" : "Kunorani yoqish"}
              </Button>
            </div>
          </section>

          {/* 4. Shaxsiy ish vaqti */}
          <section className="space-y-3 rounded-xl border border-cyan-300/70 p-3.5 dark:border-cyan-800/60">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-600 text-[11px] font-bold text-white">4</span>
                Shaxsiy ish vaqti — faqat shu xodim uchun
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Xodim qachon kelib, qachon ketishini kiriting. Bu vaqt <strong>faqat {person.fullName}</strong> uchun
                amal qiladi va asosiy smena hamda haftalik almashtirish vaqti o‘rniga ishlaydi. Keldim/Ketdim,
                kechikish, tushuntirish xati, jarima, eslatmalar va hisobotlar shu vaqtdan hisoblanadi.
              </p>
            </div>

            {chCurrent ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-cyan-50 px-2.5 py-2 text-[11px] text-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-100">
                <span>
                  Hozir: <strong>{chCurrent.start} – {chCurrent.end}</strong>
                  {chCurrent.overnight ? " (ertasi kun tugaydi)" : ""} ·{" "}
                  {chCurrent.mode === "period"
                    ? `${ymdUz(chCurrent.validFrom)} — ${ymdUz(chCurrent.validTo || chCurrent.validFrom)}`
                    : `${ymdUz(chCurrent.validFrom)} dan doimiy`}
                  {chCurrent.note ? ` · ${chCurrent.note}` : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                  disabled={busy}
                  onClick={() => clearHoursMut.mutate()}
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Bekor qilish (smena vaqtiga qaytarish)
                </Button>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              <span className="self-center text-[11px] text-muted-foreground">Tez tanlash:</span>
              {options.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => {
                    setChStart(o.start);
                    setChEnd(o.end);
                  }}
                  className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] hover:bg-muted"
                >
                  {o.start}–{o.end}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-foreground">Kelish vaqti</span>
                <Input type="time" value={chStart} onChange={(e) => setChStart(e.target.value)} className="h-9 text-sm" />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-foreground">Ketish vaqti</span>
                <Input type="time" value={chEnd} onChange={(e) => setChEnd(e.target.value)} className="h-9 text-sm" />
              </label>
            </div>
            {hmOk(chStart) && hmOk(chEnd) && chStart !== chEnd ? (
              <p className="text-[11px] text-muted-foreground">
                Ish davomiyligi: <strong className="text-foreground">{durationText(chStart, chEnd)}</strong>
                {chOvernight ? " · tungi (ertasi kun tugaydi)" : ""}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              {[
                { v: false, label: "Doimiy" },
                { v: true, label: "Muddatli (sanadan–sanagacha)" },
              ].map((m) => (
                <button
                  key={String(m.v)}
                  type="button"
                  onClick={() => setChPeriod(m.v)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                    chPeriod === m.v ? "border-cyan-600 bg-cyan-600 text-white" : "border-border bg-card hover:bg-muted",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-foreground">Boshlanish sanasi</span>
                <Input type="date" value={chFrom} min={chMinFrom} onChange={(e) => setChFrom(e.target.value)} className="h-9 text-xs" />
              </label>
              {chPeriod ? (
                <label className="space-y-1">
                  <span className="block text-[11px] font-semibold text-foreground">Tugash sanasi</span>
                  <Input type="date" value={chTo} min={chFrom} onChange={(e) => setChTo(e.target.value)} className="h-9 text-xs" />
                </label>
              ) : null}
            </div>

            <label className="block space-y-1">
              <span className="block text-[11px] font-semibold text-foreground">Izoh (ixtiyoriy)</span>
              <Input
                value={chNote}
                onChange={(e) => setChNote(e.target.value)}
                maxLength={160}
                placeholder="Masalan: o‘qishi sababli"
                className="h-9 text-xs"
              />
            </label>

            {chError ? <p className="text-[11px] text-rose-600">{chError}</p> : null}

            <div className="flex justify-end">
              <Button
                size="sm"
                className="bg-cyan-600 text-white hover:bg-cyan-700"
                disabled={Boolean(chError) || busy}
                onClick={() => hoursMut.mutate()}
              >
                {hoursMut.isPending ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Clock className="mr-1.5 h-3.5 w-3.5" />}
                {chCurrent ? "Shaxsiy vaqtni yangilash" : "Shaxsiy vaqtni saqlash"}
              </Button>
            </div>
          </section>

          <div className="space-y-1 rounded-xl border border-emerald-300/60 bg-emerald-50/70 p-3 text-[11px] text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-200">
            <p className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saqlangandan keyin nima bo‘ladi?
            </p>
            <p className="flex gap-1.5"><Clock className="mt-0.5 h-3 w-3 shrink-0" /> Davomat (Keldim / Ketdim, kechikish) yangi smena vaqtiga qarab hisoblanadi.</p>
            <p className="flex gap-1.5"><Info className="mt-0.5 h-3 w-3 shrink-0" /> Filial va rotatsiyalar o‘zgarmaydi. Xodimga bildirishnoma yuboriladi.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
