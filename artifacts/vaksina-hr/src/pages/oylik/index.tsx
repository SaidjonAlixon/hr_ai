import React, { useCallback, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  CalendarDays,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { userRoleLabel } from "@/lib/roles";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import { staffWorkplaceOf, type StaffWorkplace } from "@/lib/staff-workplace";
import { isVacancyPlaceholder } from "@/lib/vacancy-slot";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/I18nProvider";
import { MySlip, PayTable, WeekBoard } from "./pay-table";
import { FiksaDialog } from "./fiksa-dialog";
import {
  canApprovePayroll,
  canEditKpiSettings,
  canManagePayroll,
  currentMonthKey,
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
  datesFromTo,
  formatDayUz,
  formatShortUz,
  monthEnd,
  projectPayroll,
  todayYmd,
  weekdayShort,
  weeksOfMonth,
  type PayGrain,
} from "@/lib/oylik-period";

function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const { locale } = useI18n();
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-white/10 p-0.5">
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/15 hover:text-white" onClick={() => onChange(shiftMonthKey(month, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[118px] px-1 text-center text-[13px] font-semibold">{monthLabelUz(month, locale)}</span>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/15 hover:text-white" onClick={() => onChange(shiftMonthKey(month, 1))} disabled={month >= currentMonthKey()}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function FilterChip({
  on,
  tone,
  label,
  count,
  onClick,
}: {
  on: boolean;
  tone: "navy" | "emerald" | "amber" | "rose" | "slate";
  label: string;
  count: number;
  onClick: () => void;
}) {
  const active = {
    navy: "border-[#0b3a5c] bg-[#0b3a5c] text-white shadow-sm",
    emerald: "border-emerald-700 bg-emerald-700 text-white shadow-sm",
    amber: "border-amber-500 bg-amber-500 text-white shadow-sm",
    rose: "border-rose-600 bg-rose-600 text-white shadow-sm",
    slate: "border-slate-700 bg-slate-700 text-white shadow-sm",
  }[tone];
    return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        on ? active : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800",
      )}
    >
      {label}
      <span className={cn("min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold tabular-nums", on ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-200")}>
        {count}
      </span>
    </button>
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
  if (compact.includes("1+2") || compact.includes("1-2") || t === "one_two" || t === "12") return named("12", "1+2");
  if (compact.includes("2+3") || compact.includes("2-3") || t === "two_three" || t === "23") return named("23", "2+3");
  if (t === "three" || t === "3" || compact.includes("3-smena") || compact === "3smena") return named("3", "3-smena");
  if (t === "two" || t === "2" || compact.includes("2-smena") || compact === "2smena") return named("2", "2-smena");
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
];

function calendarMeta(scope: string): { title: string; hint: string } {
  if (scope === "ofis") {
    return {
      title: "Ofis ish kuni",
      hint: "Oddiy ofis xodimlari. Yashil — ish kuni, kulrang — dam. Dam kuniga jarima yozilmaydi",
    };
  }
  if (scope === "xavfsizlik") {
    return {
      title: "Xavfsizlik ish kuni",
      hint: "Faqat xavfsizlik. Yashil — ish kuni, kulrang — dam. Dam kuniga jarima yozilmaydi",
    };
  }
  const shift = scope.replace(/^dorixona:/, "");
  const label = DORIXONA_SHIFT_CHIPS.find((s) => s.key === shift)?.label || shift;
  return {
    title: `${label} ish kuni`,
      hint: "Faqat shu dorixona smenasi. Yashil — ish kuni, kulrang — dam. Dam kuniga jarima yozilmaydi",
  };
}

function WorkCalendar({
  month,
  workDays,
  canEdit,
  onToggle,
  pending,
  title,
  hint,
}: {
  month: string;
  workDays: string[];
  canEdit: boolean;
  onToggle: (day: string, isWork: boolean) => void;
  pending: boolean;
  title: string;
  hint: string;
}) {
  const { t } = useI18n();
  const set = new Set(workDays);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y!, m!, 0).getDate();
  const first = new Date(`${month}-01T12:00:00+05:00`);
  const pad = (first.getDay() + 6) % 7;
  const cells: Array<{ d: number | null; iso: string | null }> = [];
  for (let i = 0; i < pad; i++) cells.push({ d: null, iso: null });
  for (let d = 1; d <= last; d++) {
    const iso = `${month}-${String(d).padStart(2, "0")}`;
    cells.push({ d, iso });
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
    <div className="dept-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold dept-accent-value">
          <CalendarDays className="h-4 w-4" /> {title}
        </p>
        <p className="text-xs text-muted-foreground">
          {hint} · {workDays.length} ish kuni
        </p>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted-foreground">
        {labels.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.d || !c.iso) return <div key={`e-${i}`} />;
          const work = set.has(c.iso);
          const cls = cn(
            "flex h-8 items-center justify-center rounded-md text-[12px] font-semibold tabular-nums",
            work ? "bg-emerald-500 text-white dark:bg-emerald-600" : "bg-muted text-muted-foreground",
            canEdit && "cursor-pointer hover:ring-2 hover:ring-primary/30",
            pending && "opacity-70",
          );
          if (!canEdit) {
            return (
              <div key={c.iso} className={cls} title={work ? t("ui.workDay") : t("ui.dayOff")}>
                {c.d}
              </div>
            );
          }
          return (
            <button
              key={c.iso}
              type="button"
              disabled={pending}
              className={cls}
              title={work ? `${t("ui.workDay")} — ${t("ui.dayOff")}` : `${t("ui.dayOff")} — ${t("ui.workDay")}`}
              onClick={() => onToggle(c.iso!, !work)}
            >
              {c.d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function OylikPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [month, setMonth] = useState(currentMonthKey());
  const manage = canManagePayroll(user?.role);
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
  const [grain, setGrain] = useState<PayGrain>("oy");
  const [focusDate, setFocusDate] = useState(todayYmd);
  const [selected, setSelected] = useState<number[]>([]);
  const [fiksaOpen, setFiksaOpen] = useState(false);
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
        { key: "office", label: "Asosiy ofis", count: countOf((s) => s === "ofis") },
        { key: "xavfsizlik", label: "Xavfsizlik", count: countOf((s) => s === "xavfsizlik") },
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
        })),
        ...[...extras.entries()].map(([key, label]) => ({
          key,
          label,
          count: countOf((scope) => scope === `dorixona:${key}`),
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

  const activeScope = !place || !shift
    ? ""
    : place === "ofis"
      ? shift === "xavfsizlik" ? "xavfsizlik" : "ofis"
      : `dorixona:${shift}`;
  const activeCalendar = activeScope ? calendarMeta(activeScope) : null;

  return (
    <div className="dept-page">
      <div className="dept-hero dept-hero-primary">
        <div className="dept-hero-glow" />
        <div className="dept-hero-body !mx-0 flex w-full !max-w-none flex-wrap items-center justify-between gap-3 !px-3 sm:!px-4">
          <div className="min-w-0">
            <p className="dept-eyebrow">Oylik · jarima</p>
            <h1 className="dept-title">Oylik</h1>
            <p className="dept-desc truncate">
              {user?.fullName} · {userRoleLabel(user?.role)} · Tasdiqlangach xodim o‘z oyligi va jarimasini ko‘radi
            </p>
          </div>
          <MonthNav month={month} onChange={setMonth} />
        </div>
      </div>

      <div className="dept-page-inner !mx-0 w-full !max-w-none !px-2 sm:!px-3 md:!px-4">

      {manage ? (
        <div className="space-y-3">
          <div className="dept-panel space-y-3 p-3">
            <div className="flex min-w-0 flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1">
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">Qidiruv</p>
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism, lavozim..." className="h-9 rounded-lg" />
                </div>
                {canApprovePayroll(user?.role) ? (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                      {grain === "kun" ? formatDayUz(anchor) : "Avval Kun ni tanlang"} · {actionIds.length} xodim
                      {grain === "kun" && selected.length ? " · belgilanganlar" : grain === "kun" ? " · ekrandagilar" : ""}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        className="h-9 rounded-lg bg-[#0b3a5c] text-white hover:bg-[#0b3a5c]/90"
                        disabled={grain !== "kun" || approveDay.isPending || !actionIds.length}
                        onClick={() => {
                          if (!actionIds.length) return;
                          if (!window.confirm(`${formatDayUz(anchor)} — ${actionIds.length} xodim tasdiqlansinmi? Xodim shu kunni ko‘radi.`)) return;
                          approveDay.mutate({ month, day: anchor, userIds: actionIds }, { onSuccess: () => { setSelected([]); toast({ title: "Tasdiqlandi", description: `${formatDayUz(anchor)} · ${actionIds.length} xodim` }); } });
                        }}
                      >
                        <Lock className="mr-1 h-4 w-4" /> Tasdiqlash
                      </Button>
                <Button
                  type="button"
                  variant="outline"
                        className="h-9 rounded-lg border-rose-300 text-rose-700 hover:bg-rose-50"
                        disabled={grain !== "kun" || ret.isPending || !actionIds.length}
                  onClick={() => {
                          if (!actionIds.length) return;
                          if (!window.confirm(`${formatDayUz(anchor)} — ${actionIds.length} xodimning jarimasi 0 bo‘lsinmi? Xodimda ham 0 ko‘rinadi. Keyin tahrirlab yana tasdiqlash mumkin.`)) return;
                          ret.mutate({ month, userIds: actionIds, day: anchor }, { onSuccess: () => { setSelected([]); toast({ title: "Bekor qilindi", description: `${formatDayUz(anchor)} · jarima 0` }); } });
                        }}
                      >
                        Bekor qilish
                </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg"
                        disabled={grain !== "kun" || refreshDay.isPending || !actionIds.length}
                    onClick={() => {
                          if (!actionIds.length) return;
                          if (!window.confirm(`${formatDayUz(anchor)} — ${actionIds.length} xodim tizim hisobi bilan yangilansinmi? Dam kunida jarima yo‘q.`)) return;
                          refreshDay.mutate({ month, day: anchor, userIds: actionIds }, { onSuccess: (res) => { setSelected([]); toast({ title: "Yangilandi", description: `${formatDayUz(anchor)} · ${(res as { count?: number }).count ?? actionIds.length} xodim` }); } });
                        }}
                      >
                        Yangilash{dirtyIds.length ? ` · ${dirtyIds.length}` : ""}
                  </Button>
                    </div>
                  </div>
                ) : null}
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">Ekrandagi filtr · {place ? filteredRows.length : 0}</p>
                <Button
                  type="button"
                  className="h-9 rounded-lg"
                    disabled={exporting || !place}
                  onClick={async () => {
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
                      const rows = filteredRows;
                    setExporting(true);
                    try {
                        await downloadOylikViewExcel({
                          month,
                          filterLine,
                          rows,
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
                  }}
                >
                    <Download className="mr-1 h-4 w-4" /> Excel
                </Button>
                </div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { key: "ofis" as const, label: "Ofis xodimlari", hint: "Oylik va jarima shu jadvalda", count: placeCounts.ofis },
                { key: "dorixona" as const, label: "Dorixona", hint: "Smena bo‘yicha oylik va jarima", count: placeCounts.dorixona },
              ]
            ).map((opt) => {
              const on = place === opt.key;
              return (
                <button
                  key={opt.key}
                      type="button"
                      onClick={() => {
                    setPlace(on ? "" : opt.key);
                    setShift("");
                    setStatusFilter("");
                    setFiksaFilter("");
                    setJarimaFilter("");
                    setLavozimFilter("");
                  }}
                  className={cn(
                    "flex items-center justify-between rounded-2xl border px-4 py-3 text-left",
                    on && opt.key === "dorixona" && "border-emerald-600 bg-emerald-700 text-white",
                    on && opt.key === "ofis" && "border-[#0b3a5c] bg-[#0b3a5c] text-white",
                    !on && "border-border bg-card text-foreground hover:bg-muted",
                  )}
                >
                  <span>
                    <span className="block text-sm font-semibold">{opt.label}</span>
                    <span className={cn("text-xs", on ? "text-white/75" : "text-muted-foreground")}>{opt.hint}</span>
                  </span>
                  <span className={cn("text-lg font-bold tabular-nums", on ? "text-white" : "text-foreground")}>
                    {list.isLoading ? "…" : opt.count}
                  </span>
                </button>
              );
            })}
              </div>
            {list.isLoading ? (
              <Skeleton className="h-72 rounded-xl" />
            ) : list.error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{(list.error as Error).message}</p>
            ) : (
              <div className="space-y-3">
                {place ? (
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-slate-900/50">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <span className="w-[4.5rem] shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Smena</span>
                      <div className="flex flex-wrap gap-1.5">
                        <FilterChip on={!shift} tone="navy" label="Barcha smenalar" count={inPlace.length} onClick={() => { setShift(""); setStatusFilter(""); }} />
                        {shiftOptions.map((opt) => (
                          <FilterChip
                            key={opt.key}
                            on={shift === opt.key}
                            tone="emerald"
                            label={opt.label}
                            count={opt.count}
                            onClick={() => {
                              setShift(shift === opt.key ? "" : opt.key);
                              setStatusFilter("");
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="h-px bg-slate-100 dark:bg-white/10" />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <span className="w-[4.5rem] shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Lavozim</span>
                      <div className="flex flex-wrap gap-1.5">
                        <FilterChip on={lavozimFilter === ""} tone="navy" label="Hammasi" count={lavozimOptions.reduce((sum, item) => sum + item.count, 0)} onClick={() => setLavozimFilter("")} />
                        {lavozimOptions.map((opt) => (
                          <FilterChip
                            key={opt.key}
                            on={lavozimFilter === opt.key}
                            tone="emerald"
                            label={opt.label}
                            count={opt.count}
                            onClick={() => setLavozimFilter(lavozimFilter === opt.key ? "" : opt.key)}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="h-px bg-slate-100 dark:bg-white/10" />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <span className="w-[4.5rem] shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Holat</span>
                      <div className="flex flex-wrap gap-1.5">
                        <FilterChip on={statusFilter === ""} tone="navy" label="Barchasi" count={statusCounts.all} onClick={() => setStatusFilter("")} />
                        <FilterChip on={statusFilter === "approved"} tone="emerald" label="Tasdiqlangan" count={statusCounts.approved} onClick={() => setStatusFilter("approved")} />
                        <FilterChip on={statusFilter === "draft"} tone="amber" label="Tasdiqlanmagan" count={statusCounts.draft} onClick={() => setStatusFilter("draft")} />
                        <FilterChip on={statusFilter === "returned"} tone="rose" label="Bekor qilingan" count={statusCounts.returned} onClick={() => setStatusFilter("returned")} />
                      </div>
                    </div>
                    <div className="h-px bg-slate-100 dark:bg-white/10" />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <span className="w-[4.5rem] shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Jarima</span>
                      <div className="flex flex-wrap gap-1.5">
                        <FilterChip on={jarimaFilter === ""} tone="navy" label="Hammasi" count={jarimaCounts.all} onClick={() => setJarimaFilter("")} />
                        <FilterChip on={jarimaFilter === "fined"} tone="rose" label="Qilingan" count={jarimaCounts.fined} onClick={() => setJarimaFilter("fined")} />
                        <FilterChip on={jarimaFilter === "clear"} tone="slate" label="Qilinmagan" count={jarimaCounts.clear} onClick={() => setJarimaFilter("clear")} />
                      </div>
                    </div>
                    <div className="h-px bg-slate-100 dark:bg-white/10" />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <span className="w-[4.5rem] shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Fiksa</span>
                      <div className="flex flex-wrap gap-1.5">
                        <FilterChip on={fiksaFilter === ""} tone="navy" label="Hammasi" count={fiksaCounts.all} onClick={() => setFiksaFilter("")} />
                        <FilterChip on={fiksaFilter === "written"} tone="emerald" label="Yozilgan" count={fiksaCounts.written} onClick={() => setFiksaFilter("written")} />
                        <FilterChip on={fiksaFilter === "empty"} tone="slate" label="Yozilmagan" count={fiksaCounts.empty} onClick={() => setFiksaFilter("empty")} />
                      </div>
                    </div>
                  </div>
                ) : null}
                {activeCalendar && activeScope ? (
                <WorkCalendar
                  month={month}
                  title={activeCalendar.title}
                  hint={activeCalendar.hint}
                  workDays={list.data?.calendars?.[activeScope] ?? []}
                  canEdit={canEditKpiSettings(user?.role)}
                  pending={toggleDay.isPending}
                  onToggle={(day, isWork) => {
                    toggleDay.mutate(
                      { day, isWork, scope: activeScope },
                      {
                        onSuccess: () =>
                          toast({
                            title: isWork ? `${day} — ish kuni` : `${day} — dam kuni`,
                            description: activeCalendar.title,
                          }),
                        onError: (e) =>
                          toast({ title: "Ish kuni saqlanmadi", description: (e as Error).message, variant: "destructive" }),
                      },
                    );
                  }}
                />
                ) : place ? (
                  <div className="dept-empty">
                    Ish kunini qo‘yish uchun smenani tanlang. Ofisda oddiy xodimlar bir kalendarda, xavfsizlik alohida, dorixonada har smena alohida.
              </div>
                ) : null}
                {!place ? (
                  <div className="dept-empty">
                    Ofis xodimlari yoki dorixonani tanlang. Ichida smena bo‘yicha ajratiladi.
                  </div>
                ) : (
                <>
                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="inline-flex flex-wrap items-stretch gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-slate-800">
                      {(
                        [
                          { key: "kun" as const, label: "Kun", hint: "Shu kun jadvali" },
                          { key: "hafta" as const, label: "Hafta", hint: "Yig‘indi" },
                          { key: "oy" as const, label: "Oy", hint: "Har kun" },
                        ]
                      ).map((opt) => {
                        const on = grain === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setGrain(opt.key)}
                            className={cn(
                              "flex h-14 w-[9.75rem] flex-col items-center justify-center rounded-xl px-3 text-center transition",
                              on ? "bg-[#0b3a5c] text-white shadow-sm" : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-950",
                            )}
                          >
                            <span className="whitespace-nowrap text-sm font-semibold leading-none">{opt.label}</span>
                            <span className={cn("mt-1 text-[10px] leading-none", on ? "text-white/75" : "text-slate-400")}>{opt.hint}</span>
                          </button>
                        );
                      })}
                      {canEditKpiSettings(user?.role) ? (
                        <button
                          type="button"
                          onClick={() => setFiksaOpen(true)}
                          className="flex h-14 w-[9.75rem] flex-col items-center justify-center rounded-xl px-3 text-center text-slate-600 transition hover:bg-white dark:text-slate-300 dark:hover:bg-slate-950"
                        >
                          <span className="whitespace-nowrap text-sm font-semibold leading-none">Fiksa kiritish</span>
                          <span className="mt-1 text-[10px] leading-none text-slate-400">1 oylik summa</span>
                        </button>
                      ) : null}
                </div>
                    <p className="text-sm font-semibold text-[#0f2744] dark:text-white">{periodLabel}</p>
                </div>
                  {grain !== "oy" ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      {weeks.map((week, index) => {
                        const on = activeWeek?.from === week.from;
                        return (
                          <button
                            key={week.from}
                            type="button"
                            onClick={() => {
                              setFocusDate(week.from);
                              if (grain === "oy") setGrain("hafta");
                            }}
                            className={cn(
                              "rounded-2xl border px-3 py-2.5 text-left transition",
                              on
                                ? "border-[#0b3a5c] bg-[#0b3a5c] text-white shadow-md"
                                : "border-slate-200 bg-slate-50 text-slate-800 hover:border-[#0b3a5c]/40 hover:bg-white dark:border-white/10 dark:bg-slate-950 dark:text-slate-100",
                            )}
                          >
                            <span className={cn("block text-[10px] font-semibold uppercase tracking-wide", on ? "text-white/70" : "text-slate-400")}>Hafta {index + 1}</span>
                            <span className="mt-0.5 block text-sm font-semibold leading-tight">{week.label}</span>
                            <span className={cn("mt-1 block text-[11px] tabular-nums", on ? "text-white/80" : "text-slate-500")}>{week.days} kun</span>
                          </button>
                        );
                      })}
                </div>
                  ) : null}
                  {grain === "kun" && activeWeek ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {datesFromTo(activeWeek.from, activeWeek.to).map((date) => {
                        const on = date === anchor;
                        const today = date === todayYmd();
                        return (
                          <button
                            key={date}
                            type="button"
                            onClick={() => setFocusDate(date)}
                            className={cn(
                              "flex h-16 w-[4.5rem] flex-col items-center justify-center rounded-2xl border transition",
                              on
                                ? "border-[#0b3a5c] bg-[#0b3a5c] text-white shadow-md"
                                : "border-slate-200 bg-white text-slate-800 hover:border-[#0b3a5c]/40 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100",
                              today && !on && "ring-2 ring-emerald-500/70",
                            )}
                          >
                            <span className={cn("text-[10px] font-semibold uppercase", on ? "text-white/70" : "text-slate-400")}>{weekdayShort(date)}</span>
                            <span className="text-lg font-bold leading-none tabular-nums">{Number(date.slice(8, 10))}</span>
                          </button>
                        );
                      })}
              </div>
                  ) : null}
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    Kun jadvalida uchta tugma: Tasdiqlash — xodim ko‘radi. Bekor qilish — shu kun jarimasi 0, xodimda ham 0. Yangilash — tizim hisobini qayta yozadi. Belgilamasangiz ekrandagi hamma xodim olinadi. Yashil kun — ish, kulrang — dam. Dam kuniga jarima yozilmaydi.
                  </p>
                </div>
                {grain === "kun" ? (
                <PayTable
                  rows={filteredRows}
                  month={month}
                  canEdit={canEditKpiSettings(user?.role)}
                  canApprove={canApprovePayroll(user?.role)}
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
            </div>
            )}
        </div>
      ) : (
        <MySlip month={month} />
      )}
      <FiksaDialog
        open={fiksaOpen}
        onOpenChange={setFiksaOpen}
        month={month}
        rows={filteredRows}
        onSaved={(saved) => toast({ title: "Fiksa saqlandi", description: `${saved} xodim. Kunlik summalar shu oylikdan hisoblanadi.` })}
      />
      </div>
    </div>
  );
}
