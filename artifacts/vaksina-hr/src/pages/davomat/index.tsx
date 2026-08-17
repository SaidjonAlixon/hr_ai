import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useGetDepartments } from "@workspace/api-client-react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  Loader2,
  Search,
  UserCheck,
  UserX,
  Users,
  Pencil,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
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
import { canViewDavomat } from "../../lib/roles";

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

const WEEKDAY_UZ = ["Du", "Se", "Cho", "Pay", "Ju", "Sha", "Yak"];

const STATUS_UZ: Record<string, string> = {
  present: "Kelgan",
  late: "Kech",
  incomplete: "Ketish yo‘q",
  absent: "Kelmagan",
  leave: "Ta’til",
};

const STATUS_STYLE: Record<string, string> = {
  present: "bg-emerald-50 text-emerald-800 border-emerald-200",
  late: "bg-amber-50 text-amber-900 border-amber-200",
  incomplete: "bg-sky-50 text-sky-800 border-sky-200",
  absent: "bg-rose-50 text-rose-800 border-rose-200",
  leave: "bg-violet-50 text-violet-800 border-violet-200",
};

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
type CalMode = "day" | "week";

export default function DavomatPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canViewDavomat(user?.role);

  const [section, setSection] = useState<Section>("schedule");
  const [calMode, setCalMode] = useState<CalMode>("day");
  const [selectedDay, setSelectedDay] = useState(() => todayYmd());
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayYmd()));
  const [periodFrom, setPeriodFrom] = useState(() => addDaysYmd(todayYmd(), -13));
  const [periodTo, setPeriodTo] = useState(() => todayYmd());
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [selectedEmpId, setSelectedEmpId] = useState<number | "all">("all");
  const [report, setReport] = useState<DavomatReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: departments } = useGetDepartments();

  const from =
    section === "totals" ? periodFrom : calMode === "week" ? weekStart : selectedDay;
  const to =
    section === "totals"
      ? periodTo
      : calMode === "week"
        ? addDaysYmd(weekStart, 6)
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

  const employeesForDay = useMemo(() => {
    if (!report) return [];
    const date = dayInfo?.date || selectedDay;
    return report.employees
      .map((e) => ({ emp: e, day: e.days.find((d) => d.date === date) }))
      .filter((x) => x.day)
      .sort((a, b) => a.emp.fullName.localeCompare(b.emp.fullName, "uz"));
  }, [report, selectedDay, dayInfo]);

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

  const detailEmployee: DavomatEmployee | null = useMemo(() => {
    if (!report || selectedEmpId === "all") return null;
    return report.employees.find((e) => e.id === selectedEmpId) ?? null;
  }, [report, selectedEmpId]);

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await downloadDavomatExcel({
        from,
        to,
        search: search.trim() || undefined,
        departmentId: deptFilter !== "all" ? deptFilter : undefined,
      });
      toast({
        title: "Excel yuklandi",
        description: "5 varaq: xulosa, batafsil, jami, kelganlar, kelmaganlar",
      });
    } catch (err) {
      toast({
        title: "Xatolik",
        description: (err as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const onAnnounce = async () => {
    if (announcing) return;
    setAnnouncing(true);
    try {
      const res = await fetch("/api/davomat/announce", {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || "Yuborilmadi");
      toast({
        title: "Xabar yuborildi",
        description: (body as { message?: string }).message || "Barcha xodimlarga yetkazildi",
      });
    } catch (err) {
      toast({
        title: "Xatolik",
        description: (err as Error)?.message,
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

  const setCalModeSafe = (mode: CalMode) => {
    setCalMode(mode);
    if (mode === "week") setWeekStart(mondayOf(selectedDay));
  };

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center text-slate-600">
        <p>Umumiy hisobot faqat Direktor va HR uchun.</p>
        <a href="/davomat-face" className="mt-3 inline-block text-[#0b3a5c] underline underline-offset-2">
          O‘z davomatingiz →
        </a>
      </div>
    );
  }

  const filters = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {section === "schedule" ? (
        <div className="sm:col-span-2">
          <Label className="text-xs text-slate-500">Sana</Label>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => {
                if (calMode === "week") {
                  const next = addDaysYmd(weekStart, -7);
                  setWeekStart(next);
                  setSelectedDay(next);
                } else {
                  const next = addDaysYmd(selectedDay, -1);
                  setSelectedDay(next);
                  setWeekStart(mondayOf(next));
                }
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              value={calMode === "week" ? weekStart : selectedDay}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setSelectedDay(v);
                setWeekStart(mondayOf(v));
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => {
                if (calMode === "week") {
                  const next = addDaysYmd(weekStart, 7);
                  setWeekStart(next);
                  setSelectedDay(next);
                } else {
                  const next = addDaysYmd(selectedDay, 1);
                  setSelectedDay(next);
                  setWeekStart(mondayOf(next));
                }
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {calMode === "week" ? (
            <p className="mt-1 text-[11px] text-slate-500">
              Hafta: {weekStart} — {addDaysYmd(weekStart, 6)}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div>
            <Label className="text-xs text-slate-500">Dan</Label>
            <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-slate-500">Gacha</Label>
            <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
          </div>
        </>
      )}
      <div>
        <Label className="text-xs text-slate-500">Bo‘lim</Label>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Barchasi" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Barcha bo‘limlar</SelectItem>
            {(departments ?? []).map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-slate-500">Qidiruv</Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            className="pl-8"
            placeholder="Ism, lavozim…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full space-y-4 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0b3a5c]">Davomat hisobot</h1>
          <p className="mt-1 text-sm text-slate-600">
            Norma 09:00–18:00 ·{" "}
            <a href="/davomat-face" className="text-[#0b3a5c] underline underline-offset-2">
              Keldim / Ketdim →
            </a>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={() => void onAnnounce()}
            disabled={announcing || loading}
          >
            {announcing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            Barchaga xabar
          </Button>
          <Button
            type="button"
            className="gap-2 bg-[#0b3a5c] hover:bg-[#0a314d]"
            onClick={() => void onExport()}
            disabled={exporting || loading}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Excel
          </Button>
        </div>
      </div>

      <Tabs
        value={section}
        onValueChange={(v) => {
          setSection(v as Section);
          setSelectedEmpId("all");
        }}
      >
        <TabsList className="grid h-11 w-full grid-cols-2">
          <TabsTrigger value="schedule" className="gap-1.5">
            <CalendarDays className="h-4 w-4" />
            Kunlik va haftalik
          </TabsTrigger>
          <TabsTrigger value="totals" className="gap-1.5">
            <Users className="h-4 w-4" />
            Xodimlar jami (davr)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="mt-4 space-y-4">
          <Card className="border-slate-200/80 shadow-sm">
            <CardContent className="space-y-3 pt-5">
              <div className="inline-flex rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium",
                    calMode === "day" ? "bg-white text-[#0b3a5c] shadow-sm" : "text-slate-600",
                  )}
                  onClick={() => setCalModeSafe("day")}
                >
                  Kunlik
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium",
                    calMode === "week" ? "bg-white text-[#0b3a5c] shadow-sm" : "text-slate-600",
                  )}
                  onClick={() => setCalModeSafe("week")}
                >
                  Haftalik
                </button>
              </div>
              {filters}
            </CardContent>
          </Card>

          {loading && !report ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Yuklanmoqda…
            </div>
          ) : report ? (
            calMode === "day" ? (
              <Card className="border-slate-200/80 shadow-sm overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Kunlik davomat · {selectedDay}</CardTitle>
                  {dayInfo ? (
                    <p className="text-xs text-slate-500">
                      Kelgan: {dayInfo.present} · Kech: {dayInfo.late} · Kelmagan: {dayInfo.absent} ·
                      Ketish yo‘q: {dayInfo.incomplete}
                      <span className="mt-0.5 block">
                        Kech keldi: {dayTiming.lateArrival} · Erta keldi: {dayTiming.earlyArrival} · Erta
                        ketdi: {dayTiming.earlyLeave} · Kech ketdi: {dayTiming.overtime}
                      </span>
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
                        <th className="px-3 py-2">F.I.Sh.</th>
                        <th className="px-3 py-2">Lavozim</th>
                        <th className="px-3 py-2">Holat</th>
                        <th className="px-3 py-2">Kelish</th>
                        <th className="px-3 py-2">Ketish</th>
                        <th className="px-3 py-2">
                          Ishlagan
                        </th>
                        <th className="px-3 py-2">
                          Kech keldi
                          <span className="block font-normal text-[10px] text-slate-400">09:00 dan keyin</span>
                        </th>
                        <th className="px-3 py-2">
                          Erta keldi
                          <span className="block font-normal text-[10px] text-slate-400">09:00 dan oldin</span>
                        </th>
                        <th className="px-3 py-2">
                          Erta ketdi
                          <span className="block font-normal text-[10px] text-slate-400">18:00 dan oldin</span>
                        </th>
                        <th className="px-3 py-2">
                          Kech ketdi
                          <span className="block font-normal text-[10px] text-slate-400">18:00 dan keyin</span>
                        </th>
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {employeesForDay.map(({ emp, day }) => (
                        <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                          <td className="px-3 py-2 font-medium text-slate-800">{emp.fullName}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {emp.position}
                            {emp.location ? (
                              <div className="text-xs text-slate-400">{emp.location}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className={cn("font-normal", STATUS_STYLE[day!.status])}>
                              {STATUS_UZ[day!.status] || day!.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 tabular-nums">{day!.checkIn}</td>
                          <td className="px-3 py-2 tabular-nums">{day!.checkOut}</td>
                          <td className="px-3 py-2 tabular-nums font-medium">{day!.workedHours}</td>
                          <td className="px-3 py-2 text-amber-700">
                            <TimeMetric value={day!.lateArrivalLabel} />
                          </td>
                          <td className="px-3 py-2 text-emerald-700">
                            <TimeMetric value={day!.earlyArrivalLabel} />
                          </td>
                          <td className="px-3 py-2 text-rose-700">
                            <TimeMetric value={day!.earlyLeaveLabel} />
                          </td>
                          <td className="px-3 py-2 text-sky-700">
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
            ) : (
              <Card className="border-slate-200/80 shadow-sm overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Haftalik davomat · {weekStart} — {addDaysYmd(weekStart, 6)}
                  </CardTitle>
                  <p className="text-xs text-slate-500">
                    Katakka bosing — yozish. {report.summary.employees} xodim
                  </p>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
                        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2">F.I.Sh.</th>
                        {weekDates.map((date, i) => (
                          <th key={date} className="px-2 py-2 text-center font-medium">
                            <div>{WEEKDAY_UZ[i]}</div>
                            <div className="font-normal tabular-nums text-[11px]">{date.slice(5)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.employees.map((emp) => (
                        <tr key={emp.id} className="border-b border-slate-100">
                          <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-slate-800">
                            {emp.fullName}
                          </td>
                          {weekDates.map((date) => {
                            const day = emp.days.find((d) => d.date === date);
                            return (
                              <td key={date} className="px-1 py-1 text-center">
                                <WeekCell day={day} onClick={() => openEdit(emp, date)} />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )
          ) : null}
        </TabsContent>

        <TabsContent value="totals" className="mt-4 space-y-4">
          <Card className="border-slate-200/80 shadow-sm">
            <CardContent className="pt-5">{filters}</CardContent>
          </Card>

          {loading && !report ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" /> Yuklanmoqda…
            </div>
          ) : report ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat icon={<Users className="h-4 w-4" />} label="Xodimlar" value={String(report.summary.employees)} />
                <Stat
                  icon={<UserCheck className="h-4 w-4 text-emerald-600" />}
                  label="Kelgan (kun×odam)"
                  value={String(report.summary.presentPersonDays)}
                />
                <Stat
                  icon={<UserX className="h-4 w-4 text-rose-600" />}
                  label="Kelmagan (kun×odam)"
                  value={String(report.summary.absentPersonDays)}
                />
                <Stat
                  icon={<Clock3 className="h-4 w-4 text-amber-600" />}
                  label="Jami kech qolish"
                  value={report.summary.totalLateLabel}
                  sub={`Ishlangan: ${report.summary.totalWorkedHours}`}
                />
              </div>

              <Card className="border-slate-200/80 shadow-sm overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Xodimlar jami · {periodFrom} — {periodTo}
                  </CardTitle>
                  <p className="text-xs text-slate-500">Qatorni bosing — shu xodimning kunlari chiqadi</p>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
                        <th className="px-3 py-2">№</th>
                        <th className="px-3 py-2">F.I.Sh.</th>
                        <th className="px-3 py-2">Lavozim</th>
                        <th className="px-3 py-2">Kelgan</th>
                        <th className="px-3 py-2">Kelmagan</th>
                        <th className="px-3 py-2">
                          Kech
                          <span className="block font-normal text-[10px] text-slate-400">kunlar</span>
                        </th>
                        <th className="px-3 py-2">
                          Ishlagan
                        </th>
                        <th className="px-3 py-2">
                          Kech keldi
                          <span className="block font-normal text-[10px] text-slate-400">09:00 dan keyin</span>
                        </th>
                        <th className="px-3 py-2">
                          Erta keldi
                          <span className="block font-normal text-[10px] text-slate-400">09:00 dan oldin</span>
                        </th>
                        <th className="px-3 py-2">
                          Erta ketdi
                          <span className="block font-normal text-[10px] text-slate-400">18:00 dan oldin</span>
                        </th>
                        <th className="px-3 py-2">
                          Kech ketdi
                          <span className="block font-normal text-[10px] text-slate-400">18:00 dan keyin</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.employees.map((e, i) => (
                        <tr
                          key={e.id}
                          className={cn(
                            "border-b border-slate-100 cursor-pointer hover:bg-slate-50",
                            selectedEmpId === e.id && "bg-sky-50",
                          )}
                          onClick={() => setSelectedEmpId(selectedEmpId === e.id ? "all" : e.id)}
                        >
                          <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-[#0b3a5c]">{e.fullName}</td>
                          <td className="px-3 py-2 text-slate-600">{e.position}</td>
                          <td className="px-3 py-2">{e.totals.present}</td>
                          <td className="px-3 py-2 text-rose-700">{e.totals.absent}</td>
                          <td className="px-3 py-2 text-amber-700">{e.totals.late}</td>
                          <td className="px-3 py-2 font-medium">{e.totals.workedHours}</td>
                          <td className="px-3 py-2 text-amber-700">{e.totals.lateArrivalLabel}</td>
                          <td className="px-3 py-2 text-emerald-700">{e.totals.earlyArrivalLabel}</td>
                          <td className="px-3 py-2 text-rose-700">{e.totals.earlyLeaveLabel}</td>
                          <td className="px-3 py-2 text-sky-700">{e.totals.overtimeLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {detailEmployee ? (
                <Card className="border-slate-200/80 shadow-sm overflow-hidden">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{detailEmployee.fullName} — kunlar</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b bg-slate-50 text-left text-xs text-slate-500">
                          <th className="px-3 py-2">Sana</th>
                          <th className="px-3 py-2">Holat</th>
                          <th className="px-3 py-2">Kelish</th>
                          <th className="px-3 py-2">Ketish</th>
                          <th className="px-3 py-2">
                          Ishlagan
                        </th>
                          <th className="px-3 py-2">
                            Kech keldi
                            <span className="block font-normal text-[10px] text-slate-400">09:00 dan keyin</span>
                          </th>
                          <th className="px-3 py-2">
                            Erta keldi
                            <span className="block font-normal text-[10px] text-slate-400">09:00 dan oldin</span>
                          </th>
                          <th className="px-3 py-2">
                            Erta ketdi
                            <span className="block font-normal text-[10px] text-slate-400">18:00 dan oldin</span>
                          </th>
                          <th className="px-3 py-2">
                            Kech ketdi
                            <span className="block font-normal text-[10px] text-slate-400">18:00 dan keyin</span>
                          </th>
                          <th className="px-3 py-2 w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {detailEmployee.days.map((d) => (
                          <tr key={d.date} className="border-b border-slate-100">
                            <td className="px-3 py-2 tabular-nums">{d.date}</td>
                            <td className="px-3 py-2">
                              <Badge variant="outline" className={cn("font-normal", STATUS_STYLE[d.status])}>
                                {STATUS_UZ[d.status] || d.status}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{d.checkIn}</td>
                            <td className="px-3 py-2 tabular-nums">{d.checkOut}</td>
                            <td className="px-3 py-2 font-medium tabular-nums">{d.workedHours}</td>
                            <td className="px-3 py-2 text-amber-700">
                              <TimeMetric value={d.lateArrivalLabel} />
                            </td>
                            <td className="px-3 py-2 text-emerald-700">
                              <TimeMetric value={d.earlyArrivalLabel} />
                            </td>
                            <td className="px-3 py-2 text-rose-700">
                              <TimeMetric value={d.earlyLeaveLabel} />
                            </td>
                            <td className="px-3 py-2 text-sky-700">
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
            <DialogTitle>Davomat yozish</DialogTitle>
          </DialogHeader>
          {edit ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                <span className="font-medium text-slate-900">{edit.fullName}</span> · {edit.workDate}
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
    </div>
  );
}

function TimeMetric({ value }: { value: string }) {
  if (!value || value === "—") return <span className="text-slate-300">—</span>;
  return <span className="tabular-nums font-medium">{value}</span>;
}

function WeekCell({
  day,
  onClick,
}: {
  day?: DavomatDayMetrics;
  onClick: () => void;
}) {
  const status = day?.status || "absent";
  const label =
    day?.checkIn && day.checkIn !== "—"
      ? day.checkIn
      : STATUS_UZ[status]?.slice(0, 3) || "—";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mx-auto block min-w-[52px] rounded-md border px-1 py-1 text-[11px] tabular-nums leading-tight",
        STATUS_STYLE[status] || "bg-slate-50",
      )}
      title={day ? `${STATUS_UZ[status] || status} ${day.checkIn}–${day.checkOut}` : "Yozish"}
    >
      {label}
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
    <Card className="border-slate-200/80 shadow-sm">
      <CardContent className="flex items-start gap-3 pt-5">
        <div className="rounded-lg bg-slate-100 p-2 text-slate-600">{icon}</div>
        <div>
          <div className="text-xs text-slate-500">{label}</div>
          <div className="text-xl font-semibold text-slate-900 tabular-nums">{value}</div>
          {sub ? <div className="text-xs text-slate-500">{sub}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}
