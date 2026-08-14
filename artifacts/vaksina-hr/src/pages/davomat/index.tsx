import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useGetDepartments } from "@workspace/api-client-react";
import {
  CalendarDays,
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
import { useToast } from "../../hooks/use-toast";
import { cn } from "../../lib/utils";
import {
  downloadDavomatExcel,
  fetchDavomat,
  saveDavomatManual,
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

export default function DavomatPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canViewDavomat(user?.role);

  const [from, setFrom] = useState(() => addDaysYmd(todayYmd(), -13));
  const [to, setTo] = useState(() => todayYmd());
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [selectedDay, setSelectedDay] = useState(() => todayYmd());
  const [selectedEmpId, setSelectedEmpId] = useState<number | "all">("all");
  const [report, setReport] = useState<DavomatReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: departments } = useGetDepartments();

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
      setSelectedDay((prev) => (data.dates.includes(prev) ? prev : data.dates[data.dates.length - 1] || prev));
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
    () => report?.days.find((d) => d.date === selectedDay) ?? null,
    [report, selectedDay],
  );

  const employeesForDay = useMemo(() => {
    if (!report) return [];
    return report.employees
      .map((e) => ({ emp: e, day: e.days.find((d) => d.date === selectedDay) }))
      .filter((x) => x.day)
      .sort((a, b) => a.emp.fullName.localeCompare(b.emp.fullName, "uz"));
  }, [report, selectedDay]);

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
        description: "3 varaq: kunlik xulosa, batafsil, xodimlar jami",
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

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center text-slate-600">
        Davomat bo‘limi faqat Direktor, HR Direktor va HR Menejer uchun.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0b3a5c]">Davomat</h1>
          <p className="mt-1 text-sm text-slate-600">
            Norma: <span className="font-medium text-slate-800">09:00 – 18:00</span> · kelish/ketish
            Face ID orqali, ish joyidan{" "}
            <span className="font-medium">15 m</span> ichida.{" "}
            <a href="/davomat-face" className="text-[#0b3a5c] underline underline-offset-2">
              Face ID davomat →
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
            Excel yuklab olish
          </Button>
        </div>
      </div>

      <Card className="border-slate-200/80 shadow-sm">
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label className="text-xs text-slate-500">Dan</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-slate-500">Gacha</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
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
          <div className="sm:col-span-2">
            <Label className="text-xs text-slate-500">Qidiruv</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                className="pl-8"
                placeholder="Ism, lavozim, filial…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && !report ? (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Yuklanmoqda…
        </div>
      ) : report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={<Users className="h-4 w-4" />}
              label="Xodimlar"
              value={String(report.summary.employees)}
            />
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

          <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
            <Card className="border-slate-200/80 shadow-sm h-fit">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="h-4 w-4 text-[#0b3a5c]" />
                  Kunlar
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {report.days.map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setSelectedDay(d.date)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition",
                      selectedDay === d.date
                        ? "bg-[#0b3a5c] text-white"
                        : "hover:bg-slate-50 text-slate-700",
                    )}
                  >
                    <span className="font-medium">{d.date}</span>
                    <span
                      className={cn(
                        "text-xs",
                        selectedDay === d.date ? "text-white/80" : "text-slate-500",
                      )}
                    >
                      {d.present}/{report.summary.employees}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 shadow-sm overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {selectedDay} — kunlik davomat
                </CardTitle>
                {dayInfo ? (
                  <p className="text-xs text-slate-500">
                    Kelgan: {dayInfo.present} · Kech: {dayInfo.late} · Kelmagan: {dayInfo.absent} ·
                    Ketish yo‘q: {dayInfo.incomplete}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2">Xodim</th>
                      <th className="px-2 py-2">Lavozim / Joy</th>
                      <th className="px-2 py-2">Holat</th>
                      <th className="px-2 py-2">Kelish</th>
                      <th className="px-2 py-2">Ketish</th>
                      <th className="px-2 py-2">Ishlagan</th>
                      <th className="px-2 py-2">Erta keldi</th>
                      <th className="px-2 py-2">Kech qoldi</th>
                      <th className="px-2 py-2">Erta ketdi</th>
                      <th className="px-2 py-2">Kech ketdi</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {employeesForDay.map(({ emp, day }) => (
                      <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                        <td className="px-2 py-2 font-medium text-slate-800">{emp.fullName}</td>
                        <td className="px-2 py-2 text-slate-600">
                          <div>{emp.position}</div>
                          <div className="text-xs text-slate-400">{emp.location || emp.departmentName || "—"}</div>
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            variant="outline"
                            className={cn("font-normal", STATUS_STYLE[day!.status])}
                          >
                            {STATUS_UZ[day!.status] || day!.status}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 tabular-nums">{day!.checkIn}</td>
                        <td className="px-2 py-2 tabular-nums">{day!.checkOut}</td>
                        <td className="px-2 py-2 tabular-nums font-medium">{day!.workedHours}</td>
                        <td className="px-2 py-2 text-emerald-700">{day!.earlyArrivalLabel}</td>
                        <td className="px-2 py-2 text-amber-700">{day!.lateArrivalLabel}</td>
                        <td className="px-2 py-2 text-rose-700">{day!.earlyLeaveLabel}</td>
                        <td className="px-2 py-2 text-sky-700">{day!.overtimeLabel}</td>
                        <td className="px-2 py-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1"
                            onClick={() => openEdit(emp, selectedDay)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Yozish
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-2">
              <div>
                <CardTitle className="text-base">Xodim bo‘yicha to‘liq tarix</CardTitle>
                <p className="text-xs text-slate-500">Tanlangan davrdagi barcha kunlar</p>
              </div>
              <Select
                value={selectedEmpId === "all" ? "all" : String(selectedEmpId)}
                onValueChange={(v) => setSelectedEmpId(v === "all" ? "all" : Number(v))}
              >
                <SelectTrigger className="w-full sm:w-[280px]">
                  <SelectValue placeholder="Xodim tanlang" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Xodim tanlang…</SelectItem>
                  {report.employees.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {!detailEmployee ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  Yuqoridan xodimni tanlang — barcha kunlar, soatlar va kechikishlar chiqadi.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-800">
                      Kelgan: {detailEmployee.totals.present}
                    </Badge>
                    <Badge variant="outline" className="bg-rose-50 text-rose-800">
                      Kelmagan: {detailEmployee.totals.absent}
                    </Badge>
                    <Badge variant="outline" className="bg-amber-50 text-amber-900">
                      Kech: {detailEmployee.totals.late}
                    </Badge>
                    <Badge variant="outline">Ishlangan: {detailEmployee.totals.workedHours}</Badge>
                    <Badge variant="outline">Kech qolish: {detailEmployee.totals.lateArrivalLabel}</Badge>
                    <Badge variant="outline">Erta kelish: {detailEmployee.totals.earlyArrivalLabel}</Badge>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[800px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
                          <th className="px-2 py-2">Sana</th>
                          <th className="px-2 py-2">Holat</th>
                          <th className="px-2 py-2">Kelish</th>
                          <th className="px-2 py-2">Ketish</th>
                          <th className="px-2 py-2">Soat</th>
                          <th className="px-2 py-2">Erta / Kech / Erta ketish</th>
                          <th className="px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {detailEmployee.days.map((d) => (
                          <tr key={d.date} className="border-b border-slate-100">
                            <td className="px-2 py-2 tabular-nums">{d.date}</td>
                            <td className="px-2 py-2">
                              <Badge
                                variant="outline"
                                className={cn("font-normal", STATUS_STYLE[d.status])}
                              >
                                {STATUS_UZ[d.status] || d.status}
                              </Badge>
                            </td>
                            <td className="px-2 py-2 tabular-nums">{d.checkIn}</td>
                            <td className="px-2 py-2 tabular-nums">{d.checkOut}</td>
                            <td className="px-2 py-2 font-medium tabular-nums">{d.workedHours}</td>
                            <td className="px-2 py-2 text-xs text-slate-600">
                              Erta: {d.earlyArrivalLabel} · Kech: {d.lateArrivalLabel} · Erta ketdi:{" "}
                              {d.earlyLeaveLabel} · Kech ketdi: {d.overtimeLabel}
                            </td>
                            <td className="px-2 py-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => openEdit(detailEmployee, d.date)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Xodimlar jami (davr)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <th className="px-2 py-2">№</th>
                    <th className="px-2 py-2">F.I.Sh.</th>
                    <th className="px-2 py-2">Lavozim</th>
                    <th className="px-2 py-2">Kelgan</th>
                    <th className="px-2 py-2">Kelmagan</th>
                    <th className="px-2 py-2">Kech</th>
                    <th className="px-2 py-2">Ishlagan</th>
                    <th className="px-2 py-2">Kech qolish</th>
                    <th className="px-2 py-2">Erta kelish</th>
                    <th className="px-2 py-2">Erta ketish</th>
                  </tr>
                </thead>
                <tbody>
                  {report.employees.map((e, i) => (
                    <tr
                      key={e.id}
                      className="border-b border-slate-100 cursor-pointer hover:bg-slate-50"
                      onClick={() => setSelectedEmpId(e.id)}
                    >
                      <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                      <td className="px-2 py-2 font-medium text-[#0b3a5c]">{e.fullName}</td>
                      <td className="px-2 py-2 text-slate-600">{e.position}</td>
                      <td className="px-2 py-2">{e.totals.present}</td>
                      <td className="px-2 py-2 text-rose-700">{e.totals.absent}</td>
                      <td className="px-2 py-2 text-amber-700">{e.totals.late}</td>
                      <td className="px-2 py-2 font-medium">{e.totals.workedHours}</td>
                      <td className="px-2 py-2">{e.totals.lateArrivalLabel}</td>
                      <td className="px-2 py-2">{e.totals.earlyArrivalLabel}</td>
                      <td className="px-2 py-2">{e.totals.earlyLeaveLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}

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
