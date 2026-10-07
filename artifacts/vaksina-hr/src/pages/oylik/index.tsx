import React, { useCallback, useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FilterX,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Store,
  Users,
  Wallet,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import { staffWorkplaceOf, type StaffWorkplace } from "@/lib/staff-workplace";
import { isVacancyPlaceholder } from "@/lib/vacancy-slot";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/I18nProvider";
import { MySlip, PayTable, WeekBoard } from "./pay-table";
import { FiksaDialog } from "./fiksa-dialog";
import { DisciplinePanel } from "./discipline-panel";
import { LettersAdminPanel, MyLettersCard } from "./explanation-letters";
import { canManageLetters } from "@/lib/explanation-letters-api";
import { ShiftScheduleDialog } from "./shift-schedule";
import { PeriodPicker, ScheduleHint, ScheduleStrip, ShiftCards } from "./selection-panels";
import { canSeeDiscipline } from "@/lib/discipline-api";
import { canViewWorkSchedule, useWorkCalendar } from "@/lib/work-calendar-api";
import {
  canApprovePayroll,
  canEditKpiSettings,
  canManagePayroll,
  currentMonthKey,
  formatSom,
  monthLabelUz,
  shiftMonthKey,
  useApproveOylikDay,
  useRefreshOylikDay,
  useReturnOylik,
  useSaveOylikDay,
  useOylikEmployees,
  useToggleWorkDay,
  downloadOylikViewExcel,
  type PayrollRow,
} from "@/lib/oylik-api";
import {
  clampToMonth,
  daysInMonth,
  formatDayUz,
  monthEnd,
  projectPayroll,
  todayYmd,
  weeksOfMonth,
  type PayGrain,
} from "@/lib/oylik-period";

function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const { locale } = useI18n();
  return (
    <div className="flex items-center gap-0.5 rounded-xl bg-white/10 p-1 ring-1 ring-white/15">
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/15 hover:text-white" onClick={() => onChange(shiftMonthKey(month, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[130px] px-1 text-center text-sm font-semibold capitalize">{monthLabelUz(month, locale)}</span>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/15 hover:text-white" onClick={() => onChange(shiftMonthKey(month, 1))} disabled={month >= currentMonthKey()}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function StepTitle({ n, title, hint, right }: { n: number; title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0b3a5c] text-[11px] font-bold text-white">{n}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#0f2744] dark:text-white">{title}</p>
          {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      {right}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; count: number }>;
}) {
  const active = value !== "";
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <Select value={value || "__all"} onValueChange={(v) => onChange(v === "__all" ? "" : v)}>
        <SelectTrigger className={cn("h-9 rounded-lg bg-white dark:bg-slate-900", active && "border-[#0b3a5c] ring-1 ring-[#0b3a5c]/30 font-semibold text-[#0b3a5c] dark:text-sky-200")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value || "__all"} value={o.value || "__all"}>
              <span className="flex w-full items-center justify-between gap-3">
                {o.label}
                <span className="text-xs tabular-nums text-muted-foreground">{o.count}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  tone: "navy" | "blue" | "rose" | "emerald";
}) {
  const tones = {
    navy: "bg-slate-100 text-[#0b3a5c] dark:bg-white/10 dark:text-white",
    blue: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200",
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-slate-900">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tones)}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className={cn("truncate text-lg font-bold leading-tight tabular-nums text-[#0f2744] dark:text-white", tone === "rose" && "text-rose-700 dark:text-rose-200")}>{value}</p>
        {sub ? <p className="truncate text-[11px] text-muted-foreground">{sub}</p> : null}
      </div>
    </div>
  );
}

function cleanBranch(raw: string | null | undefined): string {
  const name = displayBranchName(raw).trim();
  if (!name || name === "—" || name === "-") return "";
  return name;
}

function isPayrollPerson(row: PayrollRow): boolean {
  if (isVacancyPlaceholder({ fullName: row.fullName, userId: row.userId })) return false;
  if (!row.userId) {
    const name = row.fullName.trim().toLowerCase();
    const branch = cleanBranch(row.branch).toLowerCase();
    if (name && branch && name === branch) return false;
  }
  return true;
}

function rowWorkplace(row: PayrollRow): StaffWorkplace {
  return staffWorkplaceOf({
    role: row.userRole || row.roleLabel,
    orgRole: row.orgRole,
    position: row.position,
    departmentName: row.departmentName,
  });
}

function payrollShift(row: PayrollRow): { key: string; label: string } {
  const rawLabel = String(row.shiftLabel || "").trim();
  const compact = rawLabel.toLowerCase().replace(/\s+/g, "");
  const t = String(row.shiftType || "").trim().toLowerCase();
  const named = (key: string, label: string) => ({ key, label });
  const apos = compact.replace(/[‘’ʻʼ`]/g, "'");
  const has1 = compact.includes("1-smena");
  const has2 = compact.includes("2-smena");
  const has3 = compact.includes("3-smena");
  if (t === "orta" || t === "middle" || /(^|[^a-z])o'?rta/.test(apos)) return named("orta", "O‘rta smena");
  if (compact.includes("1+2") || compact.includes("1-2") || t === "one+two" || t === "one_two" || t === "12" || (has1 && has2)) return named("12", "1+2");
  if (compact.includes("2+3") || compact.includes("2-3") || t === "two+three" || t === "two_three" || t === "23" || (has2 && has3)) return named("23", "2+3");
  if (t === "three" || t === "3" || has3 || compact === "3smena") return named("3", "3-smena");
  if (t === "two" || t === "2" || has2 || compact === "2smena") return named("2", "2-smena");
  if (rowWorkplace(row) === "ofis") {
    if (rawLabel && !compact.includes("ofis") && t !== "one" && t !== "1" && t !== "office" && t !== "") {
      return named(compact || "other", rawLabel);
    }
    return named("office", "Asosiy ofis");
  }
  if (t === "office" || compact.includes("ofis")) return named("office", "Asosiy ofis");
  if (t === "one" || t === "1" || compact.includes("1-smena") || compact === "1smena" || !t) return named("1", "1-smena");
  return named("other", rawLabel || "Boshqa");
}

function lavozimOf(row: PayrollRow): { key: string; label: string } {
  const hay = `${row.roleLabel} ${row.position || ""}`.toLowerCase();
  if (/mudir/.test(hay)) return { key: "mudir", label: "Mudir" };
  if (/farmasevt/.test(hay)) return { key: "farmasevt", label: "Farmasevt" };
  if (/staj[yo]r/.test(hay)) return { key: "stajyor", label: "Stajyor" };
  const label = (row.position || row.roleLabel || "Boshqa").trim() || "Boshqa";
  return { key: label.toLowerCase(), label };
}

function rowScope(row: PayrollRow): string {
  if (row.calendarScope === "dorixona:other" && payrollShift(row).key === "orta") return "dorixona:orta";
  if (row.calendarScope) return row.calendarScope;
  const hay = `${row.roleLabel} ${row.position || ""}`.toLowerCase();
  if (/xavfsiz/.test(hay)) return "xavfsizlik";
  if (rowWorkplace(row) === "dorixona") return `dorixona:${payrollShift(row).key}`;
  return "ofis";
}

const DORIXONA_SHIFT_CHIPS = [
  { key: "1", label: "1-smena" },
  { key: "2", label: "2-smena" },
  { key: "3", label: "3-smena" },
  { key: "12", label: "1+2" },
  { key: "23", label: "2+3" },
  { key: "orta", label: "O‘rta smena" },
];

function calendarTitle(scope: string): string {
  if (scope === "ofis") return "Ofis ish kunlari";
  if (scope === "xavfsizlik") return "Xavfsizlik ish kunlari";
  const shift = scope.replace(/^dorixona:/, "");
  const label = DORIXONA_SHIFT_CHIPS.find((s) => s.key === shift)?.label
    || (shift === "office" ? "Dorixona (ofis vaqti)" : shift === "other" ? "Boshqa smena" : shift);
  return `${label} ish kunlari`;
}

function WorkCalendar({
  month,
  workDays,
  canEdit,
  onToggle,
  pending,
}: {
  month: string;
  workDays: string[];
  canEdit: boolean;
  onToggle: (day: string, isWork: boolean) => void;
  pending: boolean;
}) {
  const { t } = useI18n();
  const set = new Set(workDays);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y!, m!, 0).getDate();
  const first = new Date(`${month}-01T12:00:00+05:00`);
  const pad = (first.getDay() + 6) % 7;
  const today = todayYmd();
  const cells: Array<{ d: number | null; iso: string | null }> = [];
  for (let i = 0; i < pad; i++) cells.push({ d: null, iso: null });
  for (let d = 1; d <= last; d++) {
    cells.push({ d, iso: `${month}-${String(d).padStart(2, "0")}` });
  }
  const labels = [
    t("ui.weekday.mon"),
    t("ui.weekday.tue"),
    t("ui.weekday.wed"),
    t("ui.weekday.thu"),
    t("ui.weekday.fri"),
    t("ui.weekday.sat"),
    t("ui.weekday.sun"),
  ];
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-white/10 dark:bg-slate-950/40">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-500" /> Ish kuni</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-slate-200 dark:bg-slate-700" /> Dam olish — jarima yozilmaydi</span>
        {canEdit ? <span className="ml-auto">Kunni bosib ish ↔ dam qiling</span> : null}
      </div>
      <div className="mx-auto max-w-xl">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-muted-foreground">
        {labels.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.d || !c.iso) return <div key={`e-${i}`} />;
          const work = set.has(c.iso);
          const cls = cn(
              "flex h-8 items-center justify-center rounded-lg text-[12px] font-semibold tabular-nums transition",
              work ? "bg-emerald-500 text-white dark:bg-emerald-600" : "bg-slate-200/70 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
              c.iso === today && "ring-2 ring-[#0b3a5c] ring-offset-1",
              canEdit && "cursor-pointer hover:opacity-80",
              pending && "opacity-60",
          );
          if (!canEdit) {
            return (
              <div key={c.iso} className={cls} title={work ? t("ui.workDay") : t("ui.dayOff")}>
                {c.d}
              </div>
            );
          }
          return (
              <button key={c.iso} type="button" disabled={pending} className={cls} onClick={() => onToggle(c.iso!, !work)}>
              {c.d}
            </button>
          );
        })}
        </div>
      </div>
    </div>
  );
}

export default function OylikPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [month, setMonth] = useState(currentMonthKey());
  const manage = canManagePayroll(user?.role);
  const canApprove = canApprovePayroll(user?.role);
  const canEdit = canEditKpiSettings(user?.role);
  const [q, setQ] = useState("");
  const list = useOylikEmployees(month, q, manage);
  const approveDay = useApproveOylikDay();
  const refreshDay = useRefreshOylikDay();
  const saveDay = useSaveOylikDay();
  const ret = useReturnOylik();
  const toggleDay = useToggleWorkDay();
  const [exporting, setExporting] = useState(false);
  const [place, setPlace] = useState<StaffWorkplace | "">("");
  const [shift, setShift] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "approved" | "draft" | "returned">("");
  const [fiksaFilter, setFiksaFilter] = useState<"" | "written" | "empty">("");
  const [jarimaFilter, setJarimaFilter] = useState<"" | "fined" | "clear">("");
  const [lavozimFilter, setLavozimFilter] = useState("");
  const [grain, setGrain] = useState<PayGrain>("kun");
  const [focusDate, setFocusDate] = useState(todayYmd);
  const [selected, setSelected] = useState<number[]>([]);
  const [fiksaOpen, setFiksaOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("jadval"),
  );
  const [schedTab, setSchedTab] = useState<"smena" | "almashuv">("smena");
  const canSchedule = canViewWorkSchedule(user?.role);
  const schedule = useWorkCalendar(month, manage && canSchedule);
  const anchor = clampToMonth(month, focusDate);
  const weeks = useMemo(() => weeksOfMonth(month), [month]);
  const activeWeek = weeks.find((week) => anchor >= week.from && anchor <= week.to) ?? weeks[0];
  const periodFrom = grain === "kun" ? anchor : grain === "hafta" ? activeWeek?.from ?? anchor : `${month}-01`;
  const periodTo = grain === "kun" ? anchor : grain === "hafta" ? activeWeek?.to ?? anchor : monthEnd(month);
  const moneyLabel = grain === "kun" ? "Kunlik" : grain === "hafta" ? "Haftalik" : "Fiksa";
  const periodLabel = grain === "kun" ? formatDayUz(anchor) : grain === "hafta" ? (activeWeek?.label ?? monthLabelUz(month)) : monthLabelUz(month);
  const present = useCallback(
    (row: PayrollRow) => projectPayroll(row, month, grain, periodFrom, periodTo),
    [month, grain, periodFrom, periodTo],
  );

  const people = useMemo(
    () => (list.data?.items ?? []).filter(isPayrollPerson),
    [list.data?.items],
  );

  const placeCounts = useMemo(() => {
    let dorixona = 0;
    let ofis = 0;
    for (const r of people) {
      if (rowWorkplace(r) === "dorixona") dorixona += 1;
      else ofis += 1;
    }
    return { dorixona, ofis };
  }, [people]);

  const inPlace = useMemo(
    () => (place ? people.filter((r) => rowWorkplace(r) === place) : []),
    [people, place],
  );

  const shiftOptions = useMemo(() => {
    const countOf = (match: (scope: string) => boolean) => inPlace.filter((r) => match(rowScope(r))).length;
    if (place === "ofis") {
      return [
        { key: "office", label: "Asosiy ofis", count: countOf((s) => s === "ofis"), scope: "ofis" },
        { key: "xavfsizlik", label: "Xavfsizlik", count: countOf((s) => s === "xavfsizlik"), scope: "xavfsizlik" },
      ];
    }
    if (place === "dorixona") {
      const extras = new Map<string, string>();
      for (const r of inPlace) {
        const scope = rowScope(r);
        if (!scope.startsWith("dorixona:")) continue;
        const key = scope.slice("dorixona:".length);
        if (!DORIXONA_SHIFT_CHIPS.some((s) => s.key === key)) extras.set(key, payrollShift(r).label);
      }
      return [
        ...DORIXONA_SHIFT_CHIPS.map((s) => ({
          ...s,
          count: countOf((scope) => scope === `dorixona:${s.key}`),
          scope: `dorixona:${s.key}`,
        })),
        ...[...extras.entries()].map(([key, label]) => ({
          key,
          label,
          count: countOf((scope) => scope === `dorixona:${key}`),
          scope: `dorixona:${key}`,
        })),
      ];
    }
    return [];
  }, [inPlace, place]);

  const inShift = useMemo(() => {
    if (!shift) return inPlace;
    return inPlace.filter((r) => {
      const scope = rowScope(r);
      if (place === "ofis") return shift === "xavfsizlik" ? scope === "xavfsizlik" : scope === "ofis";
      return scope === `dorixona:${shift}`;
    });
  }, [inPlace, place, shift]);

  const hasFiksa = (row: PayrollRow) => Math.round(Number(row.salary) || 0) > 0;
  const matchesStatus = (row: PayrollRow) => {
    if (statusFilter === "approved") return row.status === "approved";
    if (statusFilter === "returned") return row.status === "returned";
    if (statusFilter === "draft") return row.status !== "approved" && row.status !== "returned";
    return true;
  };
  const matchesFiksa = (row: PayrollRow) => {
    if (fiksaFilter === "written") return hasFiksa(row);
    if (fiksaFilter === "empty") return !hasFiksa(row);
    return true;
  };
  const rowFined = (row: PayrollRow) => present(row).jarima > 0;
  const matchesJarima = (row: PayrollRow) => {
    if (jarimaFilter === "fined") return rowFined(row);
    if (jarimaFilter === "clear") return !rowFined(row);
    return true;
  };
  const matchesLavozim = (row: PayrollRow) => !lavozimFilter || lavozimOf(row).key === lavozimFilter;

  const statusCounts = useMemo(() => {
    let approved = 0;
    let draft = 0;
    let returned = 0;
    for (const row of inShift) {
      if (!matchesFiksa(row) || !matchesJarima(row) || !matchesLavozim(row)) continue;
      if (row.status === "approved") approved += 1;
      else if (row.status === "returned") returned += 1;
      else draft += 1;
    }
    return { approved, draft, returned, all: approved + draft + returned };
  }, [inShift, fiksaFilter, jarimaFilter, lavozimFilter, present]);

  const fiksaCounts = useMemo(() => {
    let written = 0;
    let empty = 0;
    for (const row of inShift) {
      if (!matchesStatus(row) || !matchesJarima(row) || !matchesLavozim(row)) continue;
      if (hasFiksa(row)) written += 1;
      else empty += 1;
    }
    return { written, empty, all: written + empty };
  }, [inShift, statusFilter, jarimaFilter, lavozimFilter, present]);

  const jarimaCounts = useMemo(() => {
    let fined = 0;
    let clear = 0;
    for (const row of inShift) {
      if (!matchesStatus(row) || !matchesFiksa(row) || !matchesLavozim(row)) continue;
      if (rowFined(row)) fined += 1;
      else clear += 1;
    }
    return { fined, clear, all: fined + clear };
  }, [inShift, statusFilter, fiksaFilter, lavozimFilter, present]);

  const lavozimOptions = useMemo(() => {
    const rank = ["mudir", "farmasevt", "stajyor"];
    const counts = new Map<string, { label: string; count: number }>();
    for (const row of inShift) {
      if (!matchesStatus(row) || !matchesFiksa(row) || !matchesJarima(row)) continue;
      const item = lavozimOf(row);
      const prev = counts.get(item.key);
      if (prev) prev.count += 1;
      else counts.set(item.key, { label: item.label, count: 1 });
    }
    return [...counts.entries()]
      .map(([key, value]) => ({ key, label: value.label, count: value.count }))
      .sort((a, b) => {
        const ar = rank.indexOf(a.key);
        const br = rank.indexOf(b.key);
        if (ar !== -1 || br !== -1) return (ar === -1 ? 99 : ar) - (br === -1 ? 99 : br);
        return b.count - a.count || a.label.localeCompare(b.label, "uz");
      });
  }, [inShift, statusFilter, fiksaFilter, jarimaFilter, present]);

  const filteredRows = useMemo(() => {
    if (!place) return [];
    return inShift.filter((row) => matchesStatus(row) && matchesFiksa(row) && matchesJarima(row) && matchesLavozim(row));
  }, [inShift, place, statusFilter, fiksaFilter, jarimaFilter, lavozimFilter, present]);

  const dirtyIds = useMemo(() => {
    if (grain !== "kun") return [];
    return filteredRows.filter((row) => row.userId && present(row).dirty).map((row) => row.userId as number);
  }, [filteredRows, grain, present]);

  const actionIds = useMemo(() => {
    const visible = filteredRows.filter((row) => row.userId).map((row) => row.userId as number);
    if (grain === "kun" && selected.length) return visible.filter((id) => selected.includes(id));
    return visible;
  }, [filteredRows, grain, selected]);

  const totals = useMemo(() => {
    const out = { salary: 0, jarima: 0, net: 0, fined: 0, dayApproved: 0 };
    for (const row of filteredRows) {
      const view = present(row);
      out.salary += view.salary;
      out.jarima += view.jarima;
      out.net += view.net;
      if (view.jarima > 0) out.fined += 1;
      if (view.dayStatus === "approved") out.dayApproved += 1;
    }
    return out;
  }, [filteredRows, present]);

  const activeScope = !place || !shift
    ? ""
    : place === "ofis"
      ? shift === "xavfsizlik" ? "xavfsizlik" : "ofis"
      : `dorixona:${shift}`;
  const scheduleOf = (scope: string) => schedule.data?.scopes.find((item) => item.scope === scope);
  const activeSchedule = activeScope ? scheduleOf(activeScope) : undefined;
  const workDays = !activeScope
    ? []
    : activeSchedule?.month.workDays
      ?? list.data?.calendars?.[activeScope]
      ?? (activeScope === "dorixona:orta" ? list.data?.calendars?.["dorixona:other"] : undefined)
      ?? [];
  const extraFiltersOn = !!(statusFilter || fiksaFilter || jarimaFilter || lavozimFilter);

  const resetFilters = () => {
    setStatusFilter("");
    setFiksaFilter("");
    setJarimaFilter("");
    setLavozimFilter("");
  };

  const pickPlace = (next: StaffWorkplace) => {
    setPlace(place === next ? "" : next);
    setShift("");
    setSelected([]);
    setCalOpen(false);
    resetFilters();
  };

  const exportExcel = async () => {
    if (!filteredRows.length) {
      toast({ title: "Bu filtrda xodim yo‘q" });
      return;
    }
    const shiftLabel = shift ? (shiftOptions.find((item) => item.key === shift)?.label || shift) : "Barcha smenalar";
    const holatLabel = statusFilter === "approved" ? "Tasdiqlangan" : statusFilter === "returned" ? "Bekor qilingan" : statusFilter === "draft" ? "Tasdiqlanmagan" : "Barcha holat";
    const fiksaLabel = fiksaFilter === "written" ? "Fiksa yozilgan" : fiksaFilter === "empty" ? "Fiksa yozilmagan" : "Fiksa hammasi";
    const jarimaLabel = jarimaFilter === "fined" ? "Jarima qilingan" : jarimaFilter === "clear" ? "Jarima qilinmagan" : "Jarima hammasi";
    const lavozimLabel = lavozimFilter ? (lavozimOptions.find((item) => item.key === lavozimFilter)?.label || lavozimFilter) : "Barcha lavozim";
    const filterLine = [
      monthLabelUz(month),
      periodLabel,
      place === "dorixona" ? "Dorixona" : "Ofis",
      shiftLabel,
      lavozimLabel,
      holatLabel,
      jarimaLabel,
      fiksaLabel,
      q.trim() ? `Qidiruv: ${q.trim()}` : "",
      `${filteredRows.length} xodim`,
    ].filter(Boolean).join(" · ");
    setExporting(true);
    try {
      await downloadOylikViewExcel({
      month,
        filterLine,
        rows: filteredRows,
        grain,
        from: periodFrom,
        to: periodTo,
        fileName: grain === "oy" ? `oylik-${month}.xls` : `oylik-${month}-${grain}-${periodFrom}.xls`,
      });
      toast({ title: "Excel yuklandi", description: `${filteredRows.length} xodim · ${periodLabel}` });
    } catch (e) {
      toast({ title: "Excel", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const approveAll = () => {
    if (!actionIds.length) return;
    if (!window.confirm(`${formatDayUz(anchor)} — ${actionIds.length} xodim tasdiqlansinmi?\nTasdiqlangach xodim shu kunning oyligi va jarimasini ko‘radi.`)) return;
    approveDay.mutate(
      { month, day: anchor, userIds: actionIds },
      { onSuccess: () => { setSelected([]); toast({ title: "Tasdiqlandi", description: `${formatDayUz(anchor)} · ${actionIds.length} xodim` }); } },
    );
  };
  const cancelAll = () => {
    if (!actionIds.length) return;
    if (!window.confirm(`${formatDayUz(anchor)} — ${actionIds.length} xodimning jarimasi 0 qilinsinmi?\nXodimda ham 0 ko‘rinadi. Keyin tahrirlab yana tasdiqlash mumkin.`)) return;
    ret.mutate(
      { month, userIds: actionIds, day: anchor },
      { onSuccess: () => { setSelected([]); toast({ title: "Bekor qilindi", description: `${formatDayUz(anchor)} · jarima 0` }); } },
    );
  };
  const refreshAll = () => {
    if (!actionIds.length) return;
    if (!window.confirm(`${formatDayUz(anchor)} — ${actionIds.length} xodim davomat bo‘yicha qayta hisoblansinmi?\nQo‘lda kiritilgan summalar tizim hisobi bilan almashadi.`)) return;
    refreshDay.mutate(
      { month, day: anchor, userIds: actionIds },
      { onSuccess: (res) => { setSelected([]); toast({ title: "Yangilandi", description: `${formatDayUz(anchor)} · ${(res as { count?: number }).count ?? actionIds.length} xodim` }); } },
    );
  };

  return (
    <div className="dept-page">
      <div className="dept-hero dept-hero-primary">
        <div className="dept-hero-glow" />
        <div className="dept-hero-body !mx-0 flex w-full !max-w-none flex-wrap items-center justify-between gap-3 !px-3 sm:!px-4">
          <div className="min-w-0">
            <p className="dept-eyebrow">Oylik · jarima</p>
            <h1 className="dept-title">Oylik va jarima</h1>
            <p className="dept-desc">
              {manage
                ? "Bo‘limni tanlang, davrni belgilang, tekshirib tasdiqlang — tasdiqlangach xodim o‘z oyligini ko‘radi."
                : "Tasdiqlangan oylik va jarimangiz shu yerda ko‘rinadi."}
            </p>
        </div>
          <div className="flex flex-wrap items-center gap-2">
            <MonthNav month={month} onChange={(m) => { setMonth(m); setSelected([]); }} />
            {canSchedule ? (
              <Button
                type="button"
                variant="ghost"
                className="h-10 gap-1.5 rounded-xl bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20 hover:text-white"
                onClick={() => { setSchedTab("smena"); setSchedOpen(true); }}
              >
                <CalendarDays className="h-4 w-4" />
                Ish jadvali
              </Button>
            ) : null}
            {manage ? (
              <Button
                type="button"
                className="h-10 gap-1.5 rounded-xl bg-white text-[#0b3a5c] hover:bg-white/90"
                disabled={exporting || !place}
                title={place ? "Ekrandagi ro‘yxatni Excelga yuklash" : "Avval bo‘limni tanlang"}
                onClick={() => void exportExcel()}
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Excel
              </Button>
            ) : null}
        </div>
        </div>
        </div>

      <div className="dept-page-inner !mx-0 w-full !max-w-none space-y-3 !px-2 sm:!px-3 md:!px-4">
        {canSeeDiscipline(user?.role) ? <DisciplinePanel month={month} /> : null}
        {canManageLetters(user?.role) ? <LettersAdminPanel month={month} /> : null}
        {!manage ? (
          <>
            <MyLettersCard />
            <MySlip month={month} />
          </>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
              <StepTitle n={1} title="Bo‘limni tanlang" hint="Ofis va dorixona alohida hisoblanadi" />
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_minmax(220px,0.9fr)]">
                {(
                  [
                    { key: "ofis" as const, label: "Ofis xodimlari", hint: "Asosiy ofis va xavfsizlik", icon: Building2, count: placeCounts.ofis },
                    { key: "dorixona" as const, label: "Dorixona", hint: "Smenalar bo‘yicha", icon: Store, count: placeCounts.dorixona },
                  ]
                ).map((opt) => {
                  const on = place === opt.key;
                  const Icon = opt.icon;
              return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => pickPlace(opt.key)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 text-left transition",
                        on
                          ? "border-[#0b3a5c] bg-[#0b3a5c] text-white shadow-md"
                          : "border-slate-200 bg-white hover:border-[#0b3a5c]/40 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-950",
                      )}
                    >
                      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", on ? "bg-white/15" : "bg-slate-100 text-[#0b3a5c] dark:bg-white/10 dark:text-white")}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{opt.label}</span>
                        <span className={cn("block text-[11px]", on ? "text-white/70" : "text-muted-foreground")}>{opt.hint}</span>
                      </span>
                      <span className="text-xl font-bold tabular-nums">{list.isLoading ? "…" : opt.count}</span>
                    </button>
                  );
                })}
                <div className="relative self-center">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xodim ismi yoki lavozimi…" className="h-11 rounded-xl pl-9" />
                </div>
              </div>
            </section>

            {list.isLoading ? (
              <Skeleton className="h-72 rounded-2xl" />
            ) : list.error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{(list.error as Error).message}</p>
            ) : !place ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-14 text-center dark:border-white/15 dark:bg-slate-900">
                <Wallet className="h-10 w-10 text-slate-300" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Boshlash uchun yuqoridan bo‘limni tanlang</p>
                <p className="max-w-md text-xs text-muted-foreground">Ofis xodimlari yoki Dorixona. Keyin smena va davrni tanlab, oylik va jarimani tekshirasiz.</p>
              </div>
            ) : (
              <>
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <StepTitle
                    n={2}
                    title="Smena va filtr"
                    hint={`${filteredRows.length} xodim ko‘rsatilmoqda`}
                    right={
                      extraFiltersOn ? (
                        <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">
                          <FilterX className="h-3.5 w-3.5" /> Filtrlarni tozalash
                        </button>
                      ) : null
                    }
                  />
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{place === "ofis" ? "Bo‘lim" : "Smena"}</p>
                  <ShiftCards
                    allLabel={place === "ofis" ? "Hammasi" : "Barcha smenalar"}
                    total={inPlace.length}
                    options={shiftOptions}
                    value={shift}
                    onChange={(key) => { setShift(key); if (!key) setCalOpen(false); }}
                    scheduleOf={scheduleOf}
                  />

                  <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Filtr</p>
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <FilterSelect
                      label="Lavozim"
                      value={lavozimFilter}
                      onChange={setLavozimFilter}
                      options={[
                        { value: "", label: "Barcha lavozim", count: lavozimOptions.reduce((sum, item) => sum + item.count, 0) },
                        ...lavozimOptions.map((o) => ({ value: o.key, label: o.label, count: o.count })),
                      ]}
                    />
                    <FilterSelect
                      label="Holat"
                      value={statusFilter}
                      onChange={(v) => setStatusFilter(v as typeof statusFilter)}
                      options={[
                        { value: "", label: "Barcha holat", count: statusCounts.all },
                        { value: "approved", label: "Tasdiqlangan", count: statusCounts.approved },
                        { value: "draft", label: "Tasdiqlanmagan", count: statusCounts.draft },
                        { value: "returned", label: "Bekor qilingan", count: statusCounts.returned },
                      ]}
                    />
                    <FilterSelect
                      label="Jarima"
                      value={jarimaFilter}
                      onChange={(v) => setJarimaFilter(v as typeof jarimaFilter)}
                      options={[
                        { value: "", label: "Hammasi", count: jarimaCounts.all },
                        { value: "fined", label: "Jarimasi bor", count: jarimaCounts.fined },
                        { value: "clear", label: "Jarimasi yo‘q", count: jarimaCounts.clear },
                      ]}
                    />
                    <FilterSelect
                      label="Fiksa (oylik summa)"
                      value={fiksaFilter}
                      onChange={(v) => setFiksaFilter(v as typeof fiksaFilter)}
                      options={[
                        { value: "", label: "Hammasi", count: fiksaCounts.all },
                        { value: "written", label: "Kiritilgan", count: fiksaCounts.written },
                        { value: "empty", label: "Kiritilmagan", count: fiksaCounts.empty },
                      ]}
                              />
                            </div>

                  {activeScope ? (
                    <ScheduleStrip
                      title={calendarTitle(activeScope).replace(/ish kunlari$/, "ish jadvali")}
                      scope={activeScope}
                      schedule={activeSchedule}
                      workCount={workDays.length}
                      totalDays={daysInMonth(month)}
                      calOpen={calOpen}
                      onToggleCal={() => setCalOpen((v) => !v)}
                      canSchedule={canSchedule}
                      onOpenSchedule={() => { setSchedTab("smena"); setSchedOpen(true); }}
                      onOpenSwaps={() => { setSchedTab("almashuv"); setSchedOpen(true); }}
                    >
                      {calOpen ? (
                          <WorkCalendar
                            month={month}
                            workDays={workDays}
                            canEdit={canEdit}
                            pending={toggleDay.isPending}
                            onToggle={(day, isWork) => {
                              toggleDay.mutate(
                                { day, isWork, scope: activeScope },
                                {
                                  onSuccess: () => toast({ title: isWork ? `${day} — ish kuni` : `${day} — dam kuni`, description: calendarTitle(activeScope) }),
                                  onError: (e) => toast({ title: "Ish kuni saqlanmadi", description: (e as Error).message, variant: "destructive" }),
                                },
                              );
                            }}
                          />
                      ) : null}
                    </ScheduleStrip>
                  ) : (
                    <ScheduleHint />
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <StepTitle
                    n={3}
                    title="Davrni tanlang"
                    hint="Qaysi kunning, haftaning yoki butun oyning oylik va jarimasini ko‘rmoqchisiz?"
                  />

                  <PeriodPicker
                    month={month}
                    grain={grain}
                    onGrain={setGrain}
                    weeks={weeks}
                    activeWeek={activeWeek}
                    anchor={anchor}
                    onPick={setFocusDate}
                    isRest={activeScope ? (date) => !workDays.includes(date) : null}
                    periodLabel={periodLabel}
                    canEditFiksa={canEdit}
                    onFiksa={() => setFiksaOpen(true)}
                  />
                </section>

                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <SummaryCard icon={Users} tone="navy" label="Xodimlar" value={String(filteredRows.length)} sub={periodLabel} />
                  <SummaryCard icon={Wallet} tone="blue" label={`${moneyLabel} jami`} value={formatSom(totals.salary)} sub={grain === "oy" ? "Oylik summa" : "Shu davr ulushi"} />
                  <SummaryCard icon={AlertCircle} tone="rose" label="Jarima jami" value={formatSom(totals.jarima)} sub={`${totals.fined} xodimda jarima`} />
                  <SummaryCard
                    icon={CheckCircle2}
                    tone="emerald"
                    label="Qo‘lda qoladi"
                    value={formatSom(totals.net)}
                    sub={grain === "kun" ? `${totals.dayApproved} / ${filteredRows.length} tasdiqlangan` : `${statusCounts.approved} / ${statusCounts.all} oy tasdiqlangan`}
                  />
                </div>

                {canApprove ? (
                  grain === "kun" ? (
                    <div className="flex flex-col gap-3 rounded-2xl border border-[#0b3a5c]/20 bg-[#0b3a5c]/[0.04] p-3 dark:border-white/10 dark:bg-white/5 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0f2744] dark:text-white">
                          {formatDayUz(anchor)} · {actionIds.length} xodim
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {selected.length
                            ? `Faqat belgilangan ${actionIds.length} xodimga qo‘llanadi`
                            : "Belgilanmasa — ro‘yxatdagi hamma xodimga qo‘llanadi"}
                          {selected.length ? (
                            <button type="button" className="ml-2 font-semibold text-[#0b3a5c] underline-offset-2 hover:underline dark:text-sky-200" onClick={() => setSelected([])}>
                              Belgini olib tashlash
                            </button>
                          ) : null}
                        </p>
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                <Button
                  type="button"
                          className="h-auto flex-col gap-0 rounded-xl bg-[#0b3a5c] px-4 py-2 text-white hover:bg-[#0b3a5c]/90 sm:flex-row sm:gap-1.5"
                          disabled={approveDay.isPending || !actionIds.length}
                          onClick={approveAll}
                          title="Tasdiqlangach xodim shu kunni ko‘radi"
                        >
                          <Lock className="h-4 w-4" /> Tasdiqlash
                </Button>
                  <Button
                    type="button"
                    variant="outline"
                          className="h-auto flex-col gap-0 rounded-xl border-rose-300 bg-white px-4 py-2 text-rose-700 hover:bg-rose-50 sm:flex-row sm:gap-1.5"
                          disabled={ret.isPending || !actionIds.length}
                          onClick={cancelAll}
                          title="Shu kun jarimasi 0 bo‘ladi"
                        >
                          <XCircle className="h-4 w-4" /> Jarimani bekor qilish
                  </Button>
                <Button
                  type="button"
                          variant="outline"
                          className="h-auto flex-col gap-0 rounded-xl bg-white px-4 py-2 sm:flex-row sm:gap-1.5"
                          disabled={refreshDay.isPending || !actionIds.length}
                          onClick={refreshAll}
                          title="Davomat bo‘yicha qayta hisoblash"
                        >
                          <RefreshCw className={cn("h-4 w-4", refreshDay.isPending && "animate-spin")} />
                          Qayta hisoblash
                          {dirtyIds.length ? (
                            <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800">{dirtyIds.length}</span>
                ) : null}
                        </Button>
              </div>
          </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-2.5 text-xs text-muted-foreground dark:border-white/15 dark:bg-slate-900">
                      <span>Bu ko‘rinish faqat o‘qish uchun. Summani o‘zgartirish va tasdiqlash — «Kun» rejimida. Jadvaldagi kunni bossangiz o‘sha kun ochiladi.</span>
                      <Button type="button" variant="outline" className="h-8 rounded-lg" onClick={() => setGrain("kun")}>
                        Kun rejimiga o‘tish
                      </Button>
                    </div>
                  )
                ) : null}

                {grain === "kun" ? (
                  <PayTable
                    rows={filteredRows}
                  month={month}
                    canEdit={canEdit}
                    canApprove={canApprove}
                    moneyLabel={moneyLabel}
                    present={present}
                    onSaveDay={(row, salary, jarima, note) => {
                      if (!row.userId) return;
                      saveDay.mutate({ userId: row.userId, employeeId: row.employeeId, day: anchor, salary, jarima, note });
                    }}
                    onApprove={(row) => {
                      if (!row.userId) return;
                      approveDay.mutate(
                        { month, day: anchor, userIds: [row.userId] },
                        { onSuccess: () => toast({ title: "Tasdiqlandi", description: `${row.fullName} · ${formatDayUz(anchor)}` }) },
                      );
                    }}
                    onCancel={(row) => {
                      if (!row.userId) return;
                      if (!window.confirm(`${row.fullName} — ${formatDayUz(anchor)} jarimasi 0 bo‘lsinmi? Xodimda ham 0 ko‘rinadi.`)) return;
                      ret.mutate(
                        { month, day: anchor, userIds: [row.userId] },
                        { onSuccess: () => toast({ title: "Bekor qilindi", description: `${row.fullName} · jarima 0` }) },
                      );
                    }}
                    selected={selected}
                    onToggle={(id) => setSelected((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])}
                    onTogglePage={(ids, on) => setSelected((cur) => on ? [...new Set([...cur, ...ids])] : cur.filter((id) => !ids.includes(id)))}
                  />
                ) : (
                  <WeekBoard
                rows={filteredRows}
                month={month}
                    from={grain === "hafta" && activeWeek ? activeWeek.from : `${month}-01`}
                    to={grain === "hafta" && activeWeek ? activeWeek.to : monthEnd(month)}
                    scope={grain === "hafta" ? "hafta" : "oy"}
                    onOpenDay={(day) => {
                      setFocusDate(day);
                      setGrain("kun");
                    }}
                  />
                )}
              </>
            )}
          </>
        )}
        <FiksaDialog
          open={fiksaOpen}
          onOpenChange={setFiksaOpen}
          month={month}
          rows={filteredRows}
          onSaved={(saved) => toast({ title: "Fiksa saqlandi", description: `${saved} xodim. Kunlik summalar shu oylikdan hisoblanadi.` })}
        />
        {canSchedule ? (
          <ShiftScheduleDialog
            open={schedOpen}
            onOpenChange={setSchedOpen}
            month={month}
            initialScope={activeScope && activeScope !== "xavfsizlik" ? activeScope : undefined}
            initialTab={schedTab}
          />
        ) : null}
      </div>
    </div>
  );
}
