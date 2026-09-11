import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useGetDepartments } from "@workspace/api-client-react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileSpreadsheet,
  Loader2,
  MoveHorizontal,
  Percent,
  Search,
  UserCheck,
  Users,
  Pencil,
  UserX,
  Timer,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { Calendar as DayPickerCalendar } from "../../components/ui/calendar";
import { Label } from "../../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useToast } from "../../hooks/use-toast";
import { cn } from "../../lib/utils";
import {
  downloadDavomatExcel,
  fetchDavomat,
  saveDavomatManual,
  type DavomatDayMetrics,
  type DavomatEmployee,
  type DavomatReport,
} from "../../lib/davomat-api";
import { useAuth } from "../../contexts/AuthContext";
import { useI18n } from "../../i18n/I18nProvider";
import { canViewChecklistStatus, canViewDavomat } from "../../lib/roles";
import {
  type DavomatStaffFilter,
  matchesStaffFilter,
  STAFF_FILTER_OPTIONS,
  staffFilterLabel,
  smenaLabelShort,
  workHoursForEmployee,
  workHoursForStaffFilter,
} from "../../lib/davomat-staff-filter";

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return dt.toISOString().slice(0, 10);
}

/** Dushanba (Toshkent, UTC+5 — YYYY-MM-DD allaqachon kun) */
function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y!, m! - 1, d!);
  const dow = new Date(utc).getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDaysYmd(ymd, offset);
}

function firstOfMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function lastOfMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** 2026-09-07 → 07.09.2026 */
function formatYmdDot(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmdLocal(ymd: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

const MONTH_KEYS = [
  "month.1",
  "month.2",
  "month.3",
  "month.4",
  "month.5",
  "month.6",
  "month.7",
  "month.8",
  "month.9",
  "month.10",
  "month.11",
  "month.12",
] as const;

function monthLabelUz(ymd: string, t: (k: string) => string): string {
  const [y, m] = ymd.split("-").map(Number);
  const name = t(MONTH_KEYS[(m ?? 1) - 1] ?? "ui.month");
  return `${name} ${y}`;
}

const WEEKDAY_KEYS = [
  "ui.weekday.mon",
  "ui.weekday.tue",
  "ui.weekday.wed",
  "ui.weekday.thu",
  "ui.weekday.fri",
  "ui.weekday.sat",
  "ui.weekday.sun",
] as const;

function weekdayShort(ymd: string, t: (k: string) => string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  const idx = dow === 0 ? 6 : dow - 1;
  return t(WEEKDAY_KEYS[idx] ?? "ui.weekday.mon");
}

const STATUS_KEYS: Record<string, string> = {
  present: "davomat.arrived",
  late: "davomat.late",
  incomplete: "davomat.incomplete",
  absent: "davomat.absent",
  leave: "davomat.leave",
  rest: "davomat.rest",
};

const STATUS_STYLE: Record<string, string> = {
  present: "border-emerald-400 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/20 dark:text-emerald-300",
  late: "border-amber-400 bg-amber-500/15 text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-300",
  incomplete: "border-sky-400 bg-sky-500/15 text-sky-900 dark:border-sky-500/50 dark:bg-sky-500/20 dark:text-sky-300",
  absent: "border-rose-400 bg-rose-500/15 text-rose-800 dark:border-rose-500/50 dark:bg-rose-500/20 dark:text-rose-300",
  leave: "border-violet-400 bg-violet-500/15 text-violet-900 dark:border-violet-500/50 dark:bg-violet-500/20 dark:text-violet-300",
  rest: "border-slate-400 bg-slate-500/15 text-slate-700 dark:border-slate-500/50 dark:bg-slate-500/20 dark:text-slate-300",
};

const STATUS_DOT: Record<string, string> = {
  present: "bg-emerald-500",
  late: "bg-amber-500",
  incomplete: "bg-sky-500",
  absent: "bg-rose-500",
  leave: "bg-violet-500",
  rest: "bg-slate-400",
};

/** Haftalik jadval kataklari — qisqa matn */
const WEEK_CELL_STATUS_KEYS: Record<string, string> = {
  present: "davomat.came",
  late: "davomat.late",
  incomplete: "davomat.incompleteShort",
  absent: "davomat.absent",
  leave: "davomat.leaveShort",
  rest: "davomat.restShort",
};

function compactDuration(label: string): string {
  return label
    .replace(/\s*soat\s*/gi, "s ")
    .replace(/\s*daq/gi, "d")
    .replace(/^−/, "-")
    .trim();
}

function weekCellSublineParts(day: DavomatDayMetrics): {
  worked?: string;
  late?: string;
  earlyLeave?: string;
  overtime?: string;
} | null {
  const worked =
    day.workedHours && day.workedHours !== "0:00" && day.workedHours !== "—"
      ? day.workedHours
      : undefined;
  const late =
    day.lateArrivalLabel && day.lateArrivalLabel !== "—"
      ? `-${compactDuration(day.lateArrivalLabel)}`
      : undefined;
  const earlyLeave =
    day.earlyLeaveLabel && day.earlyLeaveLabel !== "—"
      ? `-${compactDuration(day.earlyLeaveLabel)}`
      : undefined;
  const overtime =
    day.overtimeLabel && day.overtimeLabel !== "—"
      ? `+${compactDuration(day.overtimeLabel)}`
      : undefined;

  if (!worked && !late && !earlyLeave && !overtime) return null;
  return { worked, late, earlyLeave, overtime };
}

const STATUS_ROW: Record<string, string> = {
  present: "bg-emerald-50/40 dark:bg-emerald-500/10",
  late: "bg-amber-50/50 dark:bg-amber-500/10",
  incomplete: "bg-sky-50/40 dark:bg-sky-500/10",
  absent: "bg-rose-50/30 dark:bg-rose-500/10",
  leave: "bg-violet-50/40 dark:bg-violet-500/10",
};

function StatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const label = t(STATUS_KEYS[status] || status, status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        STATUS_STYLE[status] || "border-border bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[status] || "bg-slate-400")}
        aria-hidden
      />
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
}

type EditState = {
  employeeId: number;
  fullName: string;
  workDate: string;
  checkIn: string;
  checkOut: string;
  status: string;
  notes: string;
};

type Section = "schedule" | "totals";
type CalMode = "day" | "week" | "month" | "range";
type DayStatusFilter = "all" | "present" | "absent" | "late";

function matchesDayStatusFilter(status: string | undefined, filter: DayStatusFilter): boolean {
  if (filter === "all") return true;
  const st = status || "absent";
  if (filter === "absent") return st === "absent";
  if (filter === "late") return st === "late";
  // Kelgan — kelmagan / tatil / damdan tashqari
  return st !== "absent" && st !== "leave" && st !== "rest";
}

export default function DavomatPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const allowed = canViewDavomat(user?.role);

  const [section, setSection] = useState<Section>("schedule");
  const [calMode, setCalMode] = useState<CalMode>("day");
  const [selectedDay, setSelectedDay] = useState(() => todayYmd());
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayYmd()));
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(() => firstOfMonth(todayYmd()));
  const [rangeFrom, setRangeFrom] = useState(() => addDaysYmd(todayYmd(), -6));
  const [rangeTo, setRangeTo] = useState(() => todayYmd());
  const [periodFrom, setPeriodFrom] = useState(() => addDaysYmd(todayYmd(), -13));
  const [periodTo, setPeriodTo] = useState(() => todayYmd());
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [staffFilter, setStaffFilter] = useState<DavomatStaffFilter>("office");
  const [dayStatusFilter, setDayStatusFilter] = useState<DayStatusFilter>("all");
  const [selectedEmpId, setSelectedEmpId] = useState<number | "all">("all");
  const [report, setReport] = useState<DavomatReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announcePreview, setAnnouncePreview] = useState<{
    text: string;
    recipients: string;
    channels: string[];
    telegramConfigured: boolean;
  } | null>(null);
  const [announcePreviewLoading, setAnnouncePreviewLoading] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: departments } = useGetDepartments();

  const from =
    section === "totals"
      ? periodFrom
      : calMode === "week"
        ? weekStart
        : calMode === "month"
          ? firstOfMonth(monthAnchor)
          : calMode === "range"
            ? rangeFrom <= rangeTo
              ? rangeFrom
              : rangeTo
            : selectedDay;
  const to =
    section === "totals"
      ? periodTo
      : calMode === "week"
        ? addDaysYmd(weekStart, 6)
        : calMode === "month"
          ? lastOfMonth(monthAnchor)
          : calMode === "range"
            ? rangeFrom <= rangeTo
              ? rangeTo
              : rangeFrom
            : selectedDay;

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const data = await fetchDavomat({
        from,
        to,
        search: search.trim() || undefined,
        departmentId: deptFilter !== "all" ? deptFilter : undefined,
      });
      setReport(data);
    } catch (err) {
      toast({
        title: "Yuklanmadi",
        description: (err as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [allowed, from, to, search, deptFilter, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const dayInfo = useMemo(
    () => report?.days.find((d) => d.date === selectedDay) ?? report?.days[0] ?? null,
    [report, selectedDay],
  );

  const farOfficeIds = useMemo(() => {
    const day = report?.days.find((d) => d.date === (dayInfo?.date || selectedDay));
    return new Set((day?.farFromOffice ?? []).map((f) => f.employeeId));
  }, [report, dayInfo?.date, selectedDay]);

  const filteredEmployees = useMemo(() => {
    if (!report) return [];
    return report.employees.filter((emp) => matchesStaffFilter(emp, staffFilter, farOfficeIds));
  }, [report, staffFilter, farOfficeIds]);

  const employeesForDay = useMemo(() => {
    if (!report) return [];
    const date = dayInfo?.date || selectedDay;
    return filteredEmployees
      .map((e) => ({ emp: e, day: e.days.find((d) => d.date === date) }))
      .filter((x) => x.day)
      .sort((a, b) => a.emp.fullName.localeCompare(b.emp.fullName, "uz"));
  }, [report, selectedDay, dayInfo, filteredEmployees]);

  const filteredDayStats = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    let incomplete = 0;
    let leave = 0;
    for (const { day } of employeesForDay) {
      if (!day) continue;
      if (day.status === "absent") absent += 1;
      else if (day.status === "leave") leave += 1;
      else if (day.status === "rest") {
        /* ofis dam — absent emas */
      } else {
        present += 1;
        if (day.status === "late") late += 1;
        if (day.status === "incomplete") incomplete += 1;
      }
    }
    return { present, late, absent, incomplete, leave, total: employeesForDay.length };
  }, [employeesForDay]);

  const visibleEmployeesForDay = useMemo(
    () =>
      employeesForDay.filter(({ day }) => matchesDayStatusFilter(day?.status, dayStatusFilter)),
    [employeesForDay, dayStatusFilter],
  );

  function toggleDayStatusFilter(next: DayStatusFilter) {
    setDayStatusFilter((prev) => (prev === next ? "all" : next));
    setSection("schedule");
    setCalMode("day");
  }

  /** «Xodimlar jami» kartalari — filtrlangan, tushunarli analitika */
  const periodAnalytics = useMemo(() => {
    const emps = filteredEmployees;
    const dayCount = report?.dates?.length || report?.summary.days || 0;
    let presentDays = 0;
    let absentDays = 0;
    let lateDays = 0;
    let workedMin = 0;
    let lateMin = 0;
    let latePeople = 0;
    let everAbsentPeople = 0;
    let perfectPeople = 0;

    for (const e of emps) {
      presentDays += e.totals.present;
      absentDays += e.totals.absent;
      lateDays += e.totals.late;
      workedMin += e.totals.workedMinutes;
      lateMin += e.totals.lateArrivalMin;
      if (e.totals.late > 0 || e.totals.lateArrivalMin > 0) latePeople += 1;
      if (e.totals.absent > 0) everAbsentPeople += 1;
      if (e.totals.absent === 0 && e.totals.present > 0) perfectPeople += 1;
    }

    const trackedDays = presentDays + absentDays;
    const attendancePct = trackedDays > 0 ? Math.round((presentDays / trackedDays) * 100) : 0;
    const avgWorkedMin = emps.length > 0 ? Math.round(workedMin / emps.length) : 0;

    const fmtDur = (min: number) => {
      const m = Math.max(0, Math.round(min));
      const h = Math.floor(m / 60);
      const r = m % 60;
      if (h <= 0) return `${r} daq`;
      if (r === 0) return `${h} soat`;
      return `${h} soat ${r} daq`;
    };

    return {
      employees: emps.length,
      dayCount,
      presentDays,
      absentDays,
      lateDays,
      attendancePct,
      latePeople,
      everAbsentPeople,
      perfectPeople,
      workedLabel: fmtDur(workedMin),
      lateLabel: lateMin > 0 ? fmtDur(lateMin) : "0 daq",
      avgWorkedLabel: fmtDur(avgWorkedMin),
    };
  }, [filteredEmployees, report?.dates?.length, report?.summary.days]);

  const activeWorkHours = useMemo(() => workHoursForStaffFilter(staffFilter), [staffFilter]);

  const dayTiming = useMemo(() => {
    const rows = employeesForDay;
    return {
      lateArrival: rows.filter((x) => (x.day?.lateArrivalMin ?? 0) > 0).length,
      earlyArrival: rows.filter((x) => (x.day?.earlyArrivalMin ?? 0) > 0).length,
      earlyLeave: rows.filter((x) => (x.day?.earlyLeaveMin ?? 0) > 0).length,
      overtime: rows.filter((x) => (x.day?.overtimeMin ?? 0) > 0).length,
    };
  }, [employeesForDay]);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i)),
    [weekStart],
  );

  const periodDates = useMemo(() => {
    if (calMode === "week") return weekDates;
    if (calMode === "month" || calMode === "range") {
      return report?.dates?.length ? report.dates : [];
    }
    return [selectedDay];
  }, [calMode, weekDates, report?.dates, selectedDay]);

  const periodTitle = useMemo(() => {
    if (calMode === "week") {
      return `${t("davomat.weekReport")} · ${weekStart} — ${addDaysYmd(weekStart, 6)}`;
    }
    if (calMode === "month") {
      return `${t("davomat.monthReport")} · ${monthLabelUz(monthAnchor, t)}`;
    }
    if (calMode === "range") {
      return `${t("davomat.rangeReport")} · ${from} — ${to}`;
    }
    return `${t("davomat.dayReport")} · ${selectedDay}`;
  }, [calMode, weekStart, monthAnchor, from, to, selectedDay, t]);

  const periodSubtitle = useMemo(() => {
    if (calMode === "month") {
      return `${firstOfMonth(monthAnchor)} ${t("davomat.rangeSub")} ${lastOfMonth(monthAnchor)} ${t("davomat.rangeSub2")}`;
    }
    if (calMode === "week") {
      return t("davomat.weekSub");
    }
    if (calMode === "range") {
      return t("davomat.monthSub");
    }
    return t("davomat.daySub");
  }, [calMode, monthAnchor, t]);

  const setCalModeSafe = (mode: CalMode) => {
    setCalMode(mode);
    if (mode === "week") setWeekStart(mondayOf(selectedDay));
    if (mode === "month") setMonthAnchor(firstOfMonth(selectedDay));
    if (mode === "range") {
      if (!rangeFrom) setRangeFrom(addDaysYmd(selectedDay, -6));
      if (!rangeTo) setRangeTo(selectedDay);
    }
  };

  const detailEmployee: DavomatEmployee | null = useMemo(() => {
    if (!report || selectedEmpId === "all") return null;
    return filteredEmployees.find((e) => e.id === selectedEmpId) ?? null;
  }, [report, selectedEmpId, filteredEmployees]);

  const detailWorkHours = useMemo(
    () => (detailEmployee ? workHoursForEmployee(detailEmployee) : activeWorkHours),
    [detailEmployee, activeWorkHours],
  );

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    toast({
      title: "Excel tayyorlanmoqda…",
      description: "Katta hisobot 20–40 soniya olishi mumkin. Iltimos, kuting.",
    });
    try {
      const result = await downloadDavomatExcel({
        from,
        to,
        search: search.trim() || undefined,
        departmentId: deptFilter !== "all" ? deptFilter : undefined,
        staffFilter,
      });
      toast({
        title: result.via === "telegram" ? "Telegramga yuborildi" : "Excel yuklandi",
        description:
          result.via === "telegram"
            ? "Fayl bot chatiga yuborildi — Telegramdan oching"
            : `Filtrdagi ${filteredEmployees.length} ta xodim · ${staffFilterLabel(staffFilter)}`,
      });
    } catch (err) {
      toast({
        title: "Excel yuklanmadi",
        description: (err as Error)?.message || "Server bilan bog‘lanib bo‘lmadi",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const openAnnounceDialog = async () => {
    if (announcing) return;
    setAnnounceOpen(true);
    setAnnouncePreviewLoading(true);
    try {
      const res = await fetch("/api/davomat/announce/preview", { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || "Ma'lumot yuklanmadi");
      setAnnouncePreview(body as typeof announcePreview);
    } catch (err) {
      setAnnounceOpen(false);
      toast({
        title: "Xabar oynasi ochilmadi",
        description: (err as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setAnnouncePreviewLoading(false);
    }
  };

  const onAnnounceConfirm = async () => {
    if (announcing) return;
    setAnnouncing(true);
    try {
      const res = await fetch("/api/davomat/announce", {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || "Yuborilmadi");
      setAnnounceOpen(false);
      toast({
        title: "Xabar yuborildi",
        description: (body as { message?: string }).message || "Barcha xodimlarga yetkazildi",
      });
    } catch (err) {
      toast({
        title: "Xabar yuborilmadi",
        description: (err as Error)?.message || "Server bilan bog‘lanib bo‘lmadi",
        variant: "destructive",
      });
    } finally {
      setAnnouncing(false);
    }
  };

  const openEdit = (emp: DavomatEmployee, workDate: string) => {
    const day = emp.days.find((d) => d.date === workDate);
    setEdit({
      employeeId: emp.id,
      fullName: emp.fullName,
      workDate,
      checkIn: day?.checkIn && day.checkIn !== "—" ? day.checkIn : "",
      checkOut: day?.checkOut && day.checkOut !== "—" ? day.checkOut : "",
      status: day?.status === "absent" && !day.recordId ? "auto" : day?.status || "auto",
      notes: day?.notes || "",
    });
  };

  const saveEdit = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      await saveDavomatManual({
        employeeId: edit.employeeId,
        workDate: edit.workDate,
        checkIn: edit.checkIn || null,
        checkOut: edit.checkOut || null,
        status: edit.status === "auto" ? "auto" : edit.status,
        notes: edit.notes || undefined,
      });
      toast({ title: "Saqlandi", description: edit.fullName });
      setEdit(null);
      await load();
    } catch (err) {
      toast({
        title: "Saqlanmadi",
        description: (err as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center text-muted-foreground">
        <p>{t("davomat.accessDenied")}</p>
        <a href="/davomat-face" className="mt-3 inline-block text-[#0b3a5c] underline underline-offset-2 dark:text-sky-400">
          {t("davomat.goMy")}
        </a>
      </div>
    );
  }

  const fieldClass =
    "h-8 rounded-lg border-border bg-card text-xs shadow-none sm:text-sm dark:border-slate-600/50 dark:bg-slate-800/60 dark:text-slate-100";
  const navBtnClass =
    "h-8 w-8 shrink-0 rounded-lg border-border";

  const filters = (
    <div
      className={cn(
        "grid gap-2",
        section === "schedule" && calMode === "day"
          ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
          : section === "schedule" && calMode !== "range"
            ? "sm:grid-cols-2 lg:grid-cols-4"
            : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
      )}
    >
      {section === "schedule" && calMode === "range" ? (
        <>
          <div>
            <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("davomat.from")}</Label>
            <Input
              type="date"
              className={fieldClass}
              value={rangeFrom}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setRangeFrom(v);
                setSelectedDay(v);
              }}
            />
          </div>
          <div>
            <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("davomat.to")}</Label>
            <Input
              type="date"
              className={fieldClass}
              value={rangeTo}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setRangeTo(v);
              }}
            />
          </div>
        </>
      ) : section === "schedule" ? (
        <div>
          <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">
            {calMode === "month"
              ? t("davomat.monthLabel")
              : calMode === "week"
                ? t("davomat.weekLabel")
                : t("davomat.dayLabel")}
          </Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={navBtnClass}
              onClick={() => {
                if (calMode === "week") {
                  const next = addDaysYmd(weekStart, -7);
                  setWeekStart(next);
                  setSelectedDay(next);
                } else if (calMode === "month") {
                  const [y, m] = monthAnchor.split("-").map(Number);
                  const prev =
                    m === 1
                      ? `${y! - 1}-12-01`
                      : `${y}-${String(m! - 1).padStart(2, "0")}-01`;
                  setMonthAnchor(prev);
                  setSelectedDay(prev);
                } else {
                  const next = addDaysYmd(selectedDay, -1);
                  setSelectedDay(next);
                  setWeekStart(mondayOf(next));
                  setMonthAnchor(firstOfMonth(next));
                }
              }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            {calMode === "week" ? (
              <Popover open={weekPickerOpen} onOpenChange={setWeekPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      fieldClass,
                      "inline-flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left transition",
                      "hover:border-primary/45 hover:bg-primary/[0.03]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                      weekPickerOpen && "border-primary/50 bg-primary/5 ring-2 ring-ring/20",
                    )}
                    title={`${formatYmdDot(weekStart)} — ${formatYmdDot(addDaysYmd(weekStart, 6))}`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <CalendarDays className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tabular-nums tracking-tight sm:text-xs">
                      <span className="text-foreground">{formatYmdDot(weekStart)}</span>
                      <span className="mx-1 font-medium text-muted-foreground">—</span>
                      <span className="text-foreground">
                        {formatYmdDot(addDaysYmd(weekStart, 6))}
                      </span>
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        weekPickerOpen && "rotate-180",
                      )}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="z-[90] w-auto rounded-xl border border-border p-0 shadow-lg"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("davomat.pickWeek")}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                        {formatYmdDot(weekStart)} — {formatYmdDot(addDaysYmd(weekStart, 6))}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                      onClick={() => {
                        const mon = mondayOf(todayYmd());
                        setWeekStart(mon);
                        setSelectedDay(mon);
                        setMonthAnchor(firstOfMonth(mon));
                        setWeekPickerOpen(false);
                      }}
                    >
                      {t("davomat.thisWeek")}
                    </button>
                  </div>
                  <DayPickerCalendar
                    key={`week-${weekStart}`}
                    mode="range"
                    className="rounded-xl"
                    defaultMonth={parseYmdLocal(weekStart) ?? new Date()}
                    selected={{
                      from: parseYmdLocal(weekStart),
                      to: parseYmdLocal(addDaysYmd(weekStart, 6)),
                    }}
                    onSelect={(_range, day) => {
                      if (!day) return;
                      const mon = mondayOf(toYmdLocal(day));
                      setWeekStart(mon);
                      setSelectedDay(mon);
                      setMonthAnchor(firstOfMonth(mon));
                      setWeekPickerOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            ) : calMode === "month" ? (
              <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      fieldClass,
                      "inline-flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left transition",
                      "hover:border-primary/45 hover:bg-primary/[0.03]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                      monthPickerOpen && "border-primary/50 bg-primary/5 ring-2 ring-ring/20",
                    )}
                    title={monthLabelUz(monthAnchor, t)}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <CalendarDays className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-tight sm:text-xs">
                      {monthLabelUz(monthAnchor, t)}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        monthPickerOpen && "rotate-180",
                      )}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="z-[90] w-auto rounded-xl border border-border p-0 shadow-lg"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("davomat.pickMonth")}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-foreground">
                        {monthLabelUz(monthAnchor, t)}
                      </p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {formatYmdDot(firstOfMonth(monthAnchor))} —{" "}
                        {formatYmdDot(lastOfMonth(monthAnchor))}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                      onClick={() => {
                        const anchor = firstOfMonth(todayYmd());
                        setMonthAnchor(anchor);
                        setSelectedDay(anchor);
                        setWeekStart(mondayOf(anchor));
                        setMonthPickerOpen(false);
                      }}
                    >
                      {t("davomat.thisMonth")}
                    </button>
                  </div>
                  <DayPickerCalendar
                    key={`month-${monthAnchor.slice(0, 7)}`}
                    mode="range"
                    className="rounded-xl"
                    defaultMonth={parseYmdLocal(monthAnchor) ?? new Date()}
                    selected={{
                      from: parseYmdLocal(firstOfMonth(monthAnchor)),
                      to: parseYmdLocal(lastOfMonth(monthAnchor)),
                    }}
                    onSelect={(_range, day) => {
                      if (!day) return;
                      const ymd = toYmdLocal(day);
                      const anchor = firstOfMonth(ymd);
                      setMonthAnchor(anchor);
                      setSelectedDay(ymd);
                      setWeekStart(mondayOf(ymd));
                      setMonthPickerOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <Popover open={dayPickerOpen} onOpenChange={setDayPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      fieldClass,
                      "inline-flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left transition",
                      "hover:border-primary/45 hover:bg-primary/[0.03]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                      dayPickerOpen && "border-primary/50 bg-primary/5 ring-2 ring-ring/20",
                    )}
                    title={formatYmdDot(selectedDay)}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <CalendarDays className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tabular-nums tracking-tight sm:text-xs">
                      {formatYmdDot(selectedDay)}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        dayPickerOpen && "rotate-180",
                      )}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="z-[90] w-auto rounded-xl border border-border p-0 shadow-lg"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("davomat.pickDay")}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                        {formatYmdDot(selectedDay)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                      onClick={() => {
                        const d = todayYmd();
                        setSelectedDay(d);
                        setWeekStart(mondayOf(d));
                        setMonthAnchor(firstOfMonth(d));
                        setDayPickerOpen(false);
                      }}
                    >
                      {t("davomat.todayPick")}
                    </button>
                  </div>
                  <DayPickerCalendar
                    key={`day-${selectedDay}`}
                    mode="single"
                    className="rounded-xl"
                    defaultMonth={parseYmdLocal(selectedDay) ?? new Date()}
                    selected={parseYmdLocal(selectedDay)}
                    onSelect={(day) => {
                      if (!day) return;
                      const ymd = toYmdLocal(day);
                      setSelectedDay(ymd);
                      setWeekStart(mondayOf(ymd));
                      setMonthAnchor(firstOfMonth(ymd));
                      setDayPickerOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={navBtnClass}
              onClick={() => {
                if (calMode === "week") {
                  const next = addDaysYmd(weekStart, 7);
                  setWeekStart(next);
                  setSelectedDay(next);
                } else if (calMode === "month") {
                  const [y, m] = monthAnchor.split("-").map(Number);
                  const next =
                    m === 12
                      ? `${y! + 1}-01-01`
                      : `${y}-${String(m! + 1).padStart(2, "0")}-01`;
                  setMonthAnchor(next);
                  setSelectedDay(next);
                } else {
                  const next = addDaysYmd(selectedDay, 1);
                  setSelectedDay(next);
                  setWeekStart(mondayOf(next));
                  setMonthAnchor(firstOfMonth(next));
                }
              }}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div>
            <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("davomat.from")}</Label>
            <Input
              type="date"
              className={fieldClass}
              value={periodFrom}
              onChange={(e) => setPeriodFrom(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("davomat.to")}</Label>
            <Input
              type="date"
              className={fieldClass}
              value={periodTo}
              onChange={(e) => setPeriodTo(e.target.value)}
            />
          </div>
        </>
      )}
      <div>
        <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("ui.department")}</Label>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className={cn(fieldClass, "px-2.5")}>
            <SelectValue placeholder={t("ui.allDepartments")} />
          </SelectTrigger>
          <SelectContent position="popper" className="z-[90]">
            <SelectItem value="all">{t("ui.allDepartments")}</SelectItem>
            {(departments ?? []).map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {section === "schedule" && calMode === "day" ? (
        <div>
          <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">Holat</Label>
          <Select
            value={dayStatusFilter}
            onValueChange={(v) => {
              setDayStatusFilter(v as DayStatusFilter);
              setSection("schedule");
              setCalMode("day");
            }}
          >
            <SelectTrigger
              className={cn(
                fieldClass,
                "px-2.5 font-semibold",
                dayStatusFilter === "present" &&
                  "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300",
                dayStatusFilter === "absent" &&
                  "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-300",
                dayStatusFilter === "late" &&
                  "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300",
              )}
            >
              <SelectValue placeholder="Barchasi" />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[90]">
              <SelectItem value="all" className="font-medium text-foreground">
                Barchasi
              </SelectItem>
              <SelectItem
                value="present"
                className="font-semibold text-emerald-700 focus:bg-emerald-50 focus:text-emerald-800 dark:text-emerald-300 dark:focus:bg-emerald-500/15 dark:focus:text-emerald-200"
              >
                Kelgan
              </SelectItem>
              <SelectItem
                value="absent"
                className="font-semibold text-rose-700 focus:bg-rose-50 focus:text-rose-800 dark:text-rose-300 dark:focus:bg-rose-500/15 dark:focus:text-rose-200"
              >
                Kelmagan
              </SelectItem>
              <SelectItem
                value="late"
                className="font-semibold text-amber-700 focus:bg-amber-50 focus:text-amber-900 dark:text-amber-300 dark:focus:bg-amber-500/15 dark:focus:text-amber-200"
              >
                Kechikkan
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div>
        <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("davomat.staffGroup")}</Label>
        <Select value={staffFilter} onValueChange={(v) => setStaffFilter(v as DavomatStaffFilter)}>
          <SelectTrigger className={cn(fieldClass, "px-2.5")}>
            <SelectValue placeholder={t("ui.all")} />
          </SelectTrigger>
          <SelectContent position="popper" className="z-[90]">
            {STAFF_FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.key} value={opt.key}>
                {opt.label} · {opt.hint}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={cn(section === "schedule" && calMode !== "range" ? "sm:col-span-2 lg:col-span-1" : "sm:col-span-2 xl:col-span-1")}>
        <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("ui.search")}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className={cn(fieldClass, "pl-8")}
            placeholder={t("davomat.searchName")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full space-y-5 pb-10">
      <div className="dv-report-hero">
        <div className="dv-report-hero-glow" aria-hidden />
        <div className="relative z-[1] flex flex-col gap-4 p-4 sm:gap-5 sm:p-5 lg:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="dv-report-hero-eyebrow">
                <span className="dv-report-hero-dot" aria-hidden />
                {t("davomat.report")}
              </div>
              <h1 className="dv-report-hero-title">{t("davomat.title")}</h1>
              <p className="dv-report-hero-sub">
                <span className="dv-report-hero-time">
                  {staffFilter === "all"
                    ? "Ofis 09:00–18:00 · 1-smena 08:00–17:00 · 2-smena 17:00–23:45"
                    : `${staffFilterLabel(staffFilter)} ${activeWorkHours.start}–${activeWorkHours.end}`}
                </span>
              </p>
            </div>
            <div className="dv-report-actions relative z-10">
              {canViewChecklistStatus(user?.role) && (
                <Link href="/checklist-holati" className="min-w-0 flex-1 sm:flex-none">
                  <Button type="button" variant="ghost" className="dv-report-btn-ghost">
                    <ClipboardCheck className="h-3.5 w-3.5 shrink-0" />
                    {t("davomat.checklist")}
                  </Button>
                </Link>
              )}
              <Button
                type="button"
                variant="ghost"
                className="dv-report-btn-announce flex-1 sm:flex-none"
                onClick={() => void openAnnounceDialog()}
                disabled={announcing || (loading && !report)}
              >
                {announcing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5 shrink-0" />}
                {t("davomat.message")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="dv-report-btn-excel flex-1 sm:flex-none"
                onClick={() => void onExport()}
                disabled={exporting || (loading && !report)}
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />}
                {t("ui.excel")}
              </Button>
            </div>
          </div>

          <div className="dv-hero-stats" role="group" aria-label="Kunlik statistika">
            {(
              [
                {
                  key: "all" as const,
                  label: "Jami",
                  value: filteredDayStats.total,
                  icon: Users,
                  tone: "dv-hero-stat-total",
                },
                {
                  key: "present" as const,
                  label: "Kelgan",
                  value: filteredDayStats.present,
                  icon: UserCheck,
                  tone: "dv-hero-stat-present",
                },
                {
                  key: "absent" as const,
                  label: "Kelmagan",
                  value: filteredDayStats.absent,
                  icon: UserX,
                  tone: "dv-hero-stat-absent",
                },
                {
                  key: "late" as const,
                  label: "Kechikkan",
                  value: filteredDayStats.late,
                  icon: Timer,
                  tone: "dv-hero-stat-late",
                },
              ] as const
            ).map((card) => {
              const Icon = card.icon;
              const active = dayStatusFilter === card.key;
              const pct =
                filteredDayStats.total > 0 && card.key !== "all"
                  ? Math.round((card.value / filteredDayStats.total) * 100)
                  : null;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => toggleDayStatusFilter(card.key)}
                  className={cn("dv-hero-stat", card.tone, active && "dv-hero-stat-active")}
                >
                  <span className="dv-hero-stat-icon">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="dv-hero-stat-meta">
                    <span className="dv-hero-stat-label">{card.label}</span>
                    <span className="dv-hero-stat-row">
                      <span className="dv-hero-stat-value">
                        {loading && !report ? "…" : card.value}
                      </span>
                      {pct != null ? <span className="dv-hero-stat-pct">{pct}%</span> : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Tabs
        value={section}
        onValueChange={(v) => {
          setSection(v as Section);
          setSelectedEmpId("all");
        }}
      >
        <TabsList className="dv-section-tabs">
          <TabsTrigger value="schedule" className="dv-section-tab">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span className="truncate sm:hidden">{t("davomat.table")}</span>
            <span className="hidden truncate sm:inline">{t("davomat.tableHint")}</span>
          </TabsTrigger>
          <TabsTrigger value="totals" className="dv-section-tab">
            <Users className="h-4 w-4 shrink-0" />
            <span className="truncate sm:hidden">Jami</span>
            <span className="hidden truncate sm:inline">Xodimlar jami</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="mt-4 space-y-4">
          <Card className="border-border shadow-sm">
            <CardContent className="space-y-3 px-3 pb-4 pt-4 sm:space-y-4 sm:px-6 sm:pt-5">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Davr turi — tanlang
                </p>
                <div className="dv-period-bar" role="group" aria-label="Davr turi">
                  {(
                    [
                      { id: "day" as const, short: t("davomat.dayShort"), label: t("davomat.daily"), hint: t("davomat.hint1d") },
                      { id: "week" as const, short: t("ui.week"), label: t("davomat.weekly"), hint: t("davomat.hint7d") },
                      { id: "month" as const, short: t("ui.month"), label: t("davomat.monthly"), hint: t("davomat.hint1m") },
                      { id: "range" as const, short: t("davomat.period"), label: t("ui.fromTo"), hint: t("davomat.hintCustom") },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={calMode === m.id}
                      className={cn(
                        "dv-period-btn",
                        calMode === m.id ? "dv-period-btn-active" : "dv-period-btn-idle",
                      )}
                      onClick={() => setCalModeSafe(m.id)}
                    >
                      <span className="block text-[11px] font-semibold leading-none sm:hidden">{m.short}</span>
                      <span className="hidden text-sm font-semibold leading-none sm:block">{m.label}</span>
                      <span
                        className={cn(
                          "mt-1.5 block text-[10px] sm:mt-1",
                          calMode === m.id ? "dv-period-hint-active" : "text-muted-foreground",
                        )}
                      >
                        {m.hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              {filters}
            </CardContent>
          </Card>

          {loading && !report ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> {t("ui.loading")}
            </div>
          ) : report ? (
            calMode === "day" ? (
              <>
              <Card className="border-border shadow-sm overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Kunlik davomat · {selectedDay}
                    {staffFilter !== "all" ? (
                      <span className="ml-2 text-sm font-medium text-primary">
                        · {staffFilterLabel(staffFilter)}
                      </span>
                    ) : null}
                  </CardTitle>
                  {dayInfo ? (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        Ko‘rsatilmoqda: {visibleEmployeesForDay.length}
                        {dayStatusFilter !== "all" ? ` / ${filteredDayStats.total}` : ""} xodim
                        {staffFilter !== "all" && report ? ` · jami bazada ${report.summary.employees}` : ""}
                      </span>
                      {filteredDayStats.incomplete > 0 ? (
                        <>
                          {" · "}
                          <span className="font-medium stat-sky">
                            Ketish yo‘q: {filteredDayStats.incomplete}
                          </span>
                        </>
                      ) : null}
                      <span className="mt-0.5 block text-muted-foreground">
                        Kech keldi: {dayTiming.lateArrival} · Erta keldi: {dayTiming.earlyArrival} · Erta
                        ketdi: {dayTiming.earlyLeave} · Kech ketdi: {dayTiming.overtime}
                        {staffFilter !== "all" ? (
                          <>
                            {" "}
                            · Reja: {activeWorkHours.start}–{activeWorkHours.end}
                          </>
                        ) : null}
                      </span>
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                        <th className="w-12 px-2 py-2 text-center">№</th>
                        <th className="px-3 py-2">F.I.Sh.</th>
                        <th className="px-3 py-2">Lavozim</th>
                        <th className="px-3 py-2">Holat</th>
                        {staffFilter === "all" ? (
                          <th className="px-3 py-2">Smena / vaqt</th>
                        ) : null}
                        <th className="px-3 py-2">Kelish</th>
                        <th className="px-3 py-2">Ketish</th>
                        <th className="px-3 py-2">Ishlagan</th>
                        <TimingHeaderCells workStart={activeWorkHours.start} workEnd={activeWorkHours.end} />
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEmployeesForDay.length === 0 ? (
                        <tr>
                          <td
                            colSpan={staffFilter === "all" ? 12 : 11}
                            className="px-3 py-10 text-center text-sm text-muted-foreground"
                          >
                            Tanlangan holat bo‘yicha xodim topilmadi
                          </td>
                        </tr>
                      ) : null}
                      {visibleEmployeesForDay.map(({ emp, day }, idx) => (
                        <tr
                          key={emp.id}
                          className={cn(
                            "border-b border-slate-100 dark:border-slate-700/60 hover:brightness-[0.98] dark:hover:bg-slate-800/40",
                            STATUS_ROW[day!.status],
                          )}
                        >
                          <td className="px-2 py-2 text-center text-xs tabular-nums text-muted-foreground">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-2 font-medium text-foreground">{emp.fullName}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {emp.position}
                            {emp.location ? (
                              <div className="text-xs text-muted-foreground">{emp.location}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <StatusPill status={day!.status} />
                          </td>
                          {staffFilter === "all" ? (
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {(() => {
                                const h = workHoursForEmployee(emp);
                                return `${h.start}–${h.end}`;
                              })()}
                            </td>
                          ) : null}
                          <td className="px-3 py-2 tabular-nums">{day!.checkIn}</td>
                          <td className="px-3 py-2 tabular-nums">{day!.checkOut}</td>
                          <td className="px-3 py-2 tabular-nums font-medium">{day!.workedHours}</td>
                          <td className="px-3 py-2 text-amber-700 dark:text-amber-400">
                            <TimeMetric value={day!.lateArrivalLabel} />
                          </td>
                          <td className="px-3 py-2 text-emerald-700 dark:text-emerald-400">
                            <TimeMetric value={day!.earlyArrivalLabel} />
                          </td>
                          <td className="px-3 py-2 text-rose-700 dark:text-rose-400">
                            <TimeMetric value={day!.earlyLeaveLabel} />
                          </td>
                          <td className="px-3 py-2 text-sky-700 dark:text-sky-400">
                            <TimeMetric value={day!.overtimeLabel} />
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => openEdit(emp, selectedDay)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
              </>
            ) : (
              <PeriodAttendanceGrid
                title={periodTitle}
                subtitle={periodSubtitle}
                dates={periodDates}
                employees={filteredEmployees}
                employeeCount={filteredEmployees.length}
                staffFilter={staffFilter}
                onEdit={openEdit}
              />
            )
          ) : null}
        </TabsContent>

        <TabsContent value="totals" className="mt-4 space-y-4">
          <Card className="border-border shadow-sm">
            <CardContent className="pt-5">{filters}</CardContent>
          </Card>

          {loading && !report ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> {t("ui.loading")}
            </div>
          ) : report ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat
                  icon={<Users className="h-4 w-4" />}
                  label="Xodimlar"
                  value={String(periodAnalytics.employees)}
                  sub={`Davr: ${periodAnalytics.dayCount} ish kuni`}
                />
                <Stat
                  icon={<Percent className="h-4 w-4 text-emerald-600" />}
                  label="Davomat foizi"
                  value={`${periodAnalytics.attendancePct}%`}
                  sub={`Kelgan ${periodAnalytics.presentDays} · Kelmagan ${periodAnalytics.absentDays} kun`}
                />
                <Stat
                  icon={<Clock3 className="h-4 w-4 text-amber-600" />}
                  label="Kechikkan xodimlar"
                  value={`${periodAnalytics.latePeople} kishi`}
                  sub={`Jami kech: ${periodAnalytics.lateLabel}`}
                />
                <Stat
                  icon={<UserCheck className="h-4 w-4 text-sky-600" />}
                  label="Ishlangan vaqt"
                  value={periodAnalytics.workedLabel}
                  sub={`O‘rtacha: ${periodAnalytics.avgWorkedLabel} / xodim`}
                />
              </div>

              <Card className="border-border shadow-sm overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Xodimlar jami · {periodFrom} — {periodTo}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Qatorni bosing — shu xodimning kunlari chiqadi</p>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2">№</th>
                        <th className="px-3 py-2">F.I.Sh.</th>
                        <th className="px-3 py-2">Lavozim</th>
                        <th className="px-3 py-2">Kelgan</th>
                        <th className="px-3 py-2">Kelmagan</th>
                        <th className="px-3 py-2">
                          Kech
                          <span className="block font-normal text-[10px] text-muted-foreground">kunlar</span>
                        </th>
                        <th className="px-3 py-2">
                          Ishlagan
                        </th>
                        <TimingHeaderCells workStart={activeWorkHours.start} workEnd={activeWorkHours.end} />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployees.map((e, i) => (
                        <tr
                          key={e.id}
                          className={cn(
                            "border-b border-slate-100 dark:border-slate-700/60 cursor-pointer hover:bg-muted dark:hover:bg-slate-800/50",
                            selectedEmpId === e.id && "bg-sky-50 dark:bg-sky-500/15",
                          )}
                          onClick={() => setSelectedEmpId(selectedEmpId === e.id ? "all" : e.id)}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-[#0b3a5c] dark:text-sky-300">{e.fullName}</td>
                          <td className="px-3 py-2 text-muted-foreground">{e.position}</td>
                          <td className="px-3 py-2">{e.totals.present}</td>
                          <td className="px-3 py-2 text-rose-700 dark:text-rose-400">{e.totals.absent}</td>
                          <td className="px-3 py-2 text-amber-700 dark:text-amber-400">{e.totals.late}</td>
                          <td className="px-3 py-2 font-medium">{e.totals.workedHours}</td>
                          <td className="px-3 py-2 text-amber-700 dark:text-amber-400">{e.totals.lateArrivalLabel}</td>
                          <td className="px-3 py-2 text-emerald-700 dark:text-emerald-400">{e.totals.earlyArrivalLabel}</td>
                          <td className="px-3 py-2 text-rose-700 dark:text-rose-400">{e.totals.earlyLeaveLabel}</td>
                          <td className="px-3 py-2 text-sky-700 dark:text-sky-400">{e.totals.overtimeLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {detailEmployee ? (
                <Card className="border-border shadow-sm overflow-hidden">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{detailEmployee.fullName} — kunlar</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2">Sana</th>
                          <th className="px-3 py-2">Holat</th>
                          <th className="px-3 py-2">Kelish</th>
                          <th className="px-3 py-2">Ketish</th>
                          <th className="px-3 py-2">
                          Ishlagan
                        </th>
                          <TimingHeaderCells workStart={detailWorkHours.start} workEnd={detailWorkHours.end} />
                          <th className="px-3 py-2 w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {detailEmployee.days.map((d) => (
                          <tr key={d.date} className="border-b border-slate-100 dark:border-slate-700/60">
                            <td className="px-3 py-2 tabular-nums">{d.date}</td>
                            <td className="px-3 py-2">
                              <StatusPill status={d.status} />
                            </td>
                            <td className="px-3 py-2 tabular-nums">{d.checkIn}</td>
                            <td className="px-3 py-2 tabular-nums">{d.checkOut}</td>
                            <td className="px-3 py-2 font-medium tabular-nums">{d.workedHours}</td>
                            <td className="px-3 py-2 text-amber-700 dark:text-amber-400">
                              <TimeMetric value={d.lateArrivalLabel} />
                            </td>
                            <td className="px-3 py-2 text-emerald-700 dark:text-emerald-400">
                              <TimeMetric value={d.earlyArrivalLabel} />
                            </td>
                            <td className="px-3 py-2 text-rose-700 dark:text-rose-400">
                              <TimeMetric value={d.earlyLeaveLabel} />
                            </td>
                            <td className="px-3 py-2 text-sky-700 dark:text-sky-400">
                              <TimeMetric value={d.overtimeLabel} />
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                                onClick={() => openEdit(detailEmployee, d.date)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : null}
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(edit)} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("davomat.editTitle")}</DialogTitle>
          </DialogHeader>
          {edit ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{edit.fullName}</span> · {edit.workDate}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Kelish (HH:MM)</Label>
                  <Input
                    placeholder="09:05"
                    value={edit.checkIn}
                    onChange={(e) => setEdit({ ...edit, checkIn: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Ketish (HH:MM)</Label>
                  <Input
                    placeholder="18:10"
                    value={edit.checkOut}
                    onChange={(e) => setEdit({ ...edit, checkOut: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>Holat</Label>
                <Select value={edit.status} onValueChange={(v) => setEdit({ ...edit, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Avto (vaqtdan)</SelectItem>
                    <SelectItem value="present">Kelgan</SelectItem>
                    <SelectItem value="late">Kech</SelectItem>
                    <SelectItem value="absent">Kelmagan</SelectItem>
                    <SelectItem value="leave">Ta’til</SelectItem>
                    <SelectItem value="incomplete">Ketish yo‘q</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Izoh</Label>
                <Input
                  value={edit.notes}
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                  placeholder="Ixtiyoriy"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEdit(null)}>
              Bekor
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={announceOpen}
        onOpenChange={(o) => {
          if (!o && !announcing) setAnnounceOpen(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Xabarni tasdiqlang</DialogTitle>
          </DialogHeader>
          {announcePreviewLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Xabar matni yuklanmoqda…
            </div>
          ) : announcePreview ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm dark:border-amber-900/40 dark:bg-amber-950/30">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/70 dark:text-amber-200/80">
                  Kimga yuboriladi
                </p>
                <p className="mt-1 font-medium text-foreground">{announcePreview.recipients}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Kanallar: {announcePreview.channels.join(" · ")}
                  {!announcePreview.telegramConfigured ? " (Telegram sozlanmagan)" : ""}
                </p>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Yuboriladigan matn
                </p>
                <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm leading-relaxed text-foreground">
                  {announcePreview.text}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Davom etish uchun «Yuborish» tugmasini bosing. Bekor qilish uchun «Bekor qilish».
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAnnounceOpen(false)}
              disabled={announcing}
            >
              Bekor qilish
            </Button>
            <Button
              type="button"
              className="bg-amber-500 text-amber-950 hover:bg-amber-400"
              onClick={() => void onAnnounceConfirm()}
              disabled={announcing || announcePreviewLoading || !announcePreview}
            >
              {announcing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Yuborish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TimingHeaderCells({ workStart, workEnd }: { workStart: string; workEnd: string }) {
  const sub = "block whitespace-nowrap font-normal text-[10px] text-muted-foreground";
  return (
    <>
      <th className="whitespace-nowrap px-3 py-2">
        Kech keldi
        <span className={sub}>{workStart} dan keyin</span>
      </th>
      <th className="whitespace-nowrap px-3 py-2">
        Erta keldi
        <span className={sub}>{workStart} dan oldin</span>
      </th>
      <th className="whitespace-nowrap px-3 py-2">
        Erta ketdi
        <span className={sub}>{workEnd} dan oldin</span>
      </th>
      <th className="whitespace-nowrap px-3 py-2">
        Kech ketdi
        <span className={sub}>{workEnd} dan keyin</span>
      </th>
    </>
  );
}

function TimeMetric({ value }: { value: string }) {
  if (!value || value === "—") return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums font-medium">{value}</span>;
}

const COL_W = 108;
const NUM_W = 48;
const NAME_W = 200;

function PeriodAttendanceGrid({
  title,
  subtitle,
  dates,
  employees,
  employeeCount,
  staffFilter,
  onEdit,
}: {
  title: string;
  subtitle: string;
  dates: string[];
  employees: DavomatEmployee[];
  employeeCount: number;
  staffFilter: DavomatStaffFilter;
  onEdit: (emp: DavomatEmployee, date: string) => void;
}) {
  const { t } = useI18n();
  const topBarRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const tableWidth = NUM_W + NAME_W + dates.length * COL_W;

  const updateArrows = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(max - el.scrollLeft > 2);
  }, []);

  const syncFrom = useCallback(
    (source: HTMLDivElement) => {
      if (syncing.current) return;
      syncing.current = true;
      const left = source.scrollLeft;
      if (topBarRef.current && topBarRef.current !== source) topBarRef.current.scrollLeft = left;
      if (mainRef.current && mainRef.current !== source) mainRef.current.scrollLeft = left;
      if (bottomBarRef.current && bottomBarRef.current !== source) {
        bottomBarRef.current.scrollLeft = left;
      }
      updateArrows();
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    },
    [updateArrows],
  );

  useEffect(() => {
    updateArrows();
    const onResize = () => updateArrows();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [dates.length, employees.length, updateArrows]);

  const scrollByStep = (dir: -1 | 1) => {
    mainRef.current?.scrollBy({ left: dir * COL_W * 3, behavior: "smooth" });
  };

  const ScrollRail = ({
    barRef,
    label,
  }: {
    barRef: React.RefObject<HTMLDivElement | null>;
    label: string;
  }) => (
    <div className="flex items-center gap-2 border-b border-border bg-[#0b3a5c]/[0.03] px-2 py-2 dark:bg-slate-800/40 sm:px-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-9 shrink-0 gap-1 rounded-xl border-[#0b3a5c]/20 bg-card px-2.5 text-[#0b3a5c] hover:bg-[#0b3a5c]/5 disabled:opacity-40 dark:border-sky-500/30 dark:text-sky-300 dark:hover:bg-sky-500/10"
        disabled={!canLeft}
        onClick={() => scrollByStep(-1)}
        aria-label="Chapga"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Orqaga</span>
      </Button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#0b3a5c]/70 dark:text-sky-400/80">
            <MoveHorizontal className="h-3.5 w-3.5" />
            {label}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">{dates.length} kun</span>
        </div>
        <div
          ref={barRef}
          className="overflow-x-auto rounded-lg border border-border bg-card"
          onScroll={(e) => syncFrom(e.currentTarget)}
        >
          <div style={{ width: tableWidth, height: 14 }} aria-hidden />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-9 shrink-0 gap-1 rounded-xl border-[#0b3a5c]/20 bg-card px-2.5 text-[#0b3a5c] hover:bg-[#0b3a5c]/5 disabled:opacity-40 dark:border-sky-500/30 dark:text-sky-300 dark:hover:bg-sky-500/10"
        disabled={!canRight}
        onClick={() => scrollByStep(1)}
        aria-label="O‘ngga"
      >
        <span className="hidden sm:inline">Oldinga</span>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <Card className="overflow-hidden border-border shadow-sm">
      <CardHeader className="border-b border-slate-100 bg-muted/60 pb-3 dark:border-slate-700/60 dark:bg-slate-800/50">
        <CardTitle className="text-base text-[#0b3a5c] dark:text-sky-300">{title}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Katakka bosing — tahrirlash · {employeeCount} xodim
          {staffFilter !== "all" ? ` · ${staffFilterLabel(staffFilter)}` : ""}
          {dates.length ? ` · ${dates.length} kun` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-medium">
          <span className="rounded-md border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300">
            Yashil = Kelgan
          </span>
          <span className="rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300">
            Sariq = Kechikdi
          </span>
          <span className="rounded-md border border-rose-300 bg-rose-100 px-2 py-0.5 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-300">
            Qizil = Kelmagan
          </span>
          <span className="rounded-md border border-violet-300 bg-violet-100 px-2 py-0.5 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-300">
            Binafsha = Ta’til
          </span>
          <span className="rounded-md border border-sky-300 bg-sky-100 px-2 py-0.5 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-300">
            Ko‘k = Ketish —
          </span>
        </div>
      </CardHeader>

      {dates.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Bu davr uchun kunlar yo‘q</p>
      ) : (
        <div className="flex flex-col">
          <ScrollRail barRef={topBarRef} label="Sanalarni surish" />

          <div
            ref={mainRef}
            className="max-h-[min(68vh,720px)] overflow-auto"
            onScroll={(e) => syncFrom(e.currentTarget)}
          >
            <table
              className="border-collapse text-sm"
              style={{ width: tableWidth, minWidth: tableWidth }}
            >
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-border bg-primary text-primary-foreground">
                  <th
                    className="sticky left-0 z-30 bg-[#0b3a5c] px-2 py-2.5 text-center text-xs font-semibold"
                    style={{ width: NUM_W, minWidth: NUM_W, left: 0 }}
                  >
                    №
                  </th>
                  <th
                    className="sticky z-30 bg-[#0b3a5c] px-3 py-2.5 text-left text-xs font-semibold tracking-wide shadow-[4px_0_10px_-4px_rgba(0,0,0,0.25)]"
                    style={{ width: NAME_W, minWidth: NAME_W, left: NUM_W }}
                  >
                    F.I.Sh.
                  </th>
                  {dates.map((date) => (
                    <th
                      key={date}
                      className="px-1 py-2 text-center font-medium"
                      style={{ width: COL_W, minWidth: COL_W }}
                    >
                      <div className="text-[10px] uppercase tracking-wide text-sky-200/90">
                        {weekdayShort(date, t)}
                      </div>
                      <div className="tabular-nums text-[11px]">{date.slice(5)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, rowIdx) => {
                  const zebra = rowIdx % 2 === 0;
                  const stickyBg = zebra ? "bg-card" : "bg-muted";
                  return (
                    <tr
                      key={emp.id}
                      className={cn("border-b border-slate-100 dark:border-slate-700/60", zebra ? "bg-card" : "bg-muted/40 dark:bg-slate-800/30")}
                    >
                      <td
                        className={cn(
                          "sticky left-0 z-10 px-2 py-1.5 text-center text-xs tabular-nums text-muted-foreground",
                          stickyBg,
                        )}
                        style={{ width: NUM_W, minWidth: NUM_W, left: 0 }}
                      >
                        {rowIdx + 1}
                      </td>
                      <td
                        className={cn(
                          "sticky z-10 px-3 py-1.5 shadow-[4px_0_10px_-4px_rgba(15,23,42,0.12)]",
                          stickyBg,
                        )}
                        style={{ width: NAME_W, minWidth: NAME_W, left: NUM_W }}
                      >
                        <div className="truncate font-medium text-foreground" title={emp.fullName}>
                          {emp.fullName}
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {emp.position ? `${emp.position} · ` : ""}
                          {smenaLabelShort(emp)}
                        </div>
                      </td>
                      {dates.map((date) => {
                        const day = emp.days.find((d) => d.date === date);
                        return (
                          <td key={date} className="px-1 py-1 align-middle">
                            <WeekCell
                              day={day}
                              hours={
                                emp.workStart && emp.workEnd
                                  ? { start: emp.workStart, end: emp.workEnd }
                                  : undefined
                              }
                              onClick={() => onEdit(emp, date)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="sticky bottom-0 z-30 border-t border-border bg-white/95 shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.18)] backdrop-blur-sm">
            <ScrollRail barRef={bottomBarRef} label="Sanalarni surish (past)" />
          </div>
        </div>
      )}
    </Card>
  );
}

function dayCellTooltip(day: DavomatDayMetrics, hours: { start: string; end: string } | undefined, t: (k: string) => string) {
  const h = hours ?? { start: "09:00", end: "18:00" };
  if (day.status === "rest") {
    return `${t("davomat.rest")}\n${t("davomat.restExtra")}`;
  }
  const lines = [
    day.restDayWork
      ? t("davomat.restExtra")
      : t(STATUS_KEYS[day.status] || day.status, day.status),
  ];
  lines.push(`${t("davomat.btnIn")}: ${day.checkIn} (${t("davomat.plan")} ${h.start})`);
  lines.push(`${t("davomat.btnOut")}: ${day.checkOut} (${t("davomat.plan")} ${h.end})`);
  if (day.workedHours && day.workedHours !== "0:00" && day.workedHours !== "—") {
    lines.push(`${t("davomat.workedHours")}: ${day.workedHours}`);
  }
  if (!day.restDayWork && day.lateArrivalLabel && day.lateArrivalLabel !== "—") {
    lines.push(`${t("davomat.lateIn")}: ${day.lateArrivalLabel}`);
  }
  if (day.earlyArrivalLabel && day.earlyArrivalLabel !== "—") {
    lines.push(`${t("davomat.earlyIn")}: ${day.earlyArrivalLabel}`);
  }
  if (!day.restDayWork && day.earlyLeaveLabel && day.earlyLeaveLabel !== "—") {
    lines.push(`${t("davomat.earlyOut")}: ${day.earlyLeaveLabel}`);
  }
  if (day.overtimeLabel && day.overtimeLabel !== "—") {
    lines.push(`+${day.overtimeLabel}`);
  }
  return lines.join("\n");
}

function WeekCell({
  day,
  onClick,
  hours,
}: {
  day?: DavomatDayMetrics;
  onClick: () => void;
  hours?: { start: string; end: string };
}) {
  const { t } = useI18n();
  const status = day?.status || "absent";
  const hasIn = Boolean(day?.checkIn && day.checkIn !== "—");
  const hasOut = Boolean(day?.checkOut && day.checkOut !== "—");
  const statusLabel = day?.restDayWork
    ? t("davomat.restExtra")
    : t(WEEK_CELL_STATUS_KEYS[status] || STATUS_KEYS[status] || status, status);
  const showTimes =
    status !== "leave" &&
    status !== "rest" &&
    (hasIn || hasOut || status === "incomplete");
  const subline = day ? weekCellSublineParts(day) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mx-auto flex h-[62px] w-full min-w-[72px] flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 py-1 font-medium transition-colors hover:ring-2 hover:ring-[#0b3a5c]/20",
        STATUS_STYLE[status] || "bg-muted",
      )}
      title={day ? dayCellTooltip(day, hours, t) : t("ui.edit")}
    >
      <span className="w-full whitespace-nowrap text-center text-[10px] font-bold leading-none">
        {statusLabel}
      </span>
      {showTimes ? (
        <span className="w-full whitespace-nowrap text-center text-[10px] font-semibold tabular-nums leading-tight">
          {hasIn ? day!.checkIn : "—"}–{hasOut ? day!.checkOut : "—"}
        </span>
      ) : null}
      {subline ? (
        <span className="flex w-full items-center justify-center gap-0.5 whitespace-nowrap text-center text-[9px] tabular-nums leading-none">
          {subline.worked ? <span className="opacity-75">{subline.worked}</span> : null}
          {subline.worked && subline.late ? <span className="opacity-50">·</span> : null}
          {subline.late ? (
            <span className="font-bold text-red-600 dark:text-red-500">
              Kech {subline.late}
            </span>
          ) : null}
          {(subline.worked || subline.late) && subline.earlyLeave ? (
            <span className="opacity-50">·</span>
          ) : null}
          {subline.earlyLeave ? (
            <span className="font-semibold text-amber-700 dark:text-amber-400 dark:text-amber-500">{subline.earlyLeave}</span>
          ) : null}
          {(subline.worked || subline.late || subline.earlyLeave) && subline.overtime ? (
            <span className="opacity-50">·</span>
          ) : null}
          {subline.overtime ? (
            <span className="font-semibold text-emerald-700 dark:text-emerald-400 dark:text-emerald-500">{subline.overtime}</span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="border-border shadow-sm">
      <CardContent className="flex items-start gap-3 pt-5">
        <div className="rounded-lg bg-slate-100 p-2 text-muted-foreground dark:bg-slate-700/50 dark:text-slate-300">
          {icon}
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
          {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}
