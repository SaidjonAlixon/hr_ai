import { isDirectorRole } from "../../lib/roles";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Clock3,
  FileDown,
  FileSpreadsheet,
  Loader2,
  PhoneCall,
  Send,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { isBefore, startOfDay } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Calendar } from "../../components/ui/calendar";
import { useToast } from "../../hooks/use-toast";
import { useI18n } from "../../i18n/I18nProvider";
import { useAuth } from "../../contexts/AuthContext";
import { cn } from "../../lib/utils";
import {
  approveJavobRequest,
  cancelJavobRequest,
  dateToYmd,
  fetchJavobRequests,
  fetchJavobShifts,
  formatYmdDisplay,
  rejectJavobRequest,
  submitJavobRequests,
  type JavobDayInput,
  type JavobRequestItem,
  type JavobShiftInfo,
} from "../../lib/javob-olish-api";
import {
  buildJavobApprovedExport,
  exportJavobApprovedExcel,
  exportJavobApprovedPdf,
} from "../../lib/javob-olish-export";

type RequestMode = "day" | "hour";

type DayTimes = { fromHm: string; toHm: string };

function statusBadge(status: string, t: (k: string) => string) {
  if (status === "pending" || status === "pending_coord") {
    return { label: t("javob.statusPendingCoord"), className: "bg-amber-100 text-amber-900" };
  }
  if (status === "pending_hr") {
    return { label: t("javob.statusPendingHr"), className: "bg-sky-100 text-sky-900" };
  }
  if (status === "approved") return { label: t("javob.statusApproved"), className: "bg-emerald-100 text-emerald-900" };
  if (status === "rejected") return { label: t("javob.statusRejected"), className: "bg-rose-100 text-rose-900" };
  if (status === "cancelled") return { label: t("javob.statusCancelled"), className: "bg-muted text-muted-foreground" };
  return { label: status, className: "bg-muted text-muted-foreground" };
}

function isHourlyRequest(item: JavobRequestItem) {
  return item.kind === "hour" || item.fromHm !== item.shiftStartHm || item.toHm !== item.shiftEndHm;
}

function requestKindLabel(item: JavobRequestItem, t: (k: string) => string) {
  return isHourlyRequest(item) ? t("javob.modeHour") : t("javob.modeDay");
}

function isOpenStatus(status: string) {
  return status === "pending" || status === "pending_coord" || status === "pending_hr";
}

function formatDecidedAt(v?: string | null) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("uz-UZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function JavobOlishPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const role = user?.role || "";
  const isCoord = role === "koordinator";
  const isHr =
    role === "hr_menejer" ||
    role === "hr_direktor" ||
    role === "hr" ||
    role === "hr_kadr_rahbar" ||
    role === "admin" ||
    isDirectorRole(role);
  const canDecideQueue = isCoord || isHr;

  const [mode, setMode] = useState<RequestMode>("day");
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [dayTimes, setDayTimes] = useState<Record<string, DayTimes>>({});
  const [note, setNote] = useState("");
  const [shifts, setShifts] = useState<Record<string, JavobShiftInfo>>({});
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  const selectedYmds = useMemo(
    () => selectedDates.map(dateToYmd).sort((a, b) => a.localeCompare(b)),
    [selectedDates],
  );

  useEffect(() => {
    if (!selectedYmds.length) {
      setShifts({});
      return;
    }
    let cancelled = false;
    setShiftsLoading(true);
    void fetchJavobShifts(selectedYmds)
      .then((r) => {
        if (cancelled) return;
        const map: Record<string, JavobShiftInfo> = {};
        for (const item of r.items) map[item.workDate] = item;
        setShifts(map);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          toast({ title: t("javob.shiftFail"), description: e.message, variant: "destructive" });
        }
      })
      .finally(() => {
        if (!cancelled) setShiftsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedYmds.join("|")]);

  // Tanlangan kunlar o‘zgasa — soatlik rejimda bo‘sh slotlar
  useEffect(() => {
    setDayTimes((prev) => {
      const next: Record<string, DayTimes> = {};
      for (const ymd of selectedYmds) {
        next[ymd] = prev[ymd] || { fromHm: "", toHm: "" };
      }
      return next;
    });
  }, [selectedYmds.join("|")]);

  const mineQ = useQuery({
    queryKey: ["javob-olish", "mine"],
    queryFn: () => fetchJavobRequests("mine"),
  });

  const pendingQ = useQuery({
    queryKey: ["javob-olish", "pending"],
    queryFn: () => fetchJavobRequests("pending"),
    enabled: canDecideQueue,
  });

  const approvedByMeQ = useQuery({
    queryKey: ["javob-olish", "approved-by-me"],
    queryFn: () => fetchJavobRequests("approved-by-me"),
    enabled: isHr,
  });

  async function runApprovedExport(kind: "excel" | "pdf") {
    const items = approvedByMeQ.data?.items ?? [];
    if (!items.length) {
      toast({ title: t("javob.exportEmpty"), variant: "destructive" });
      return;
    }
    setExporting(kind);
    try {
      const payload = buildJavobApprovedExport(items);
      if (kind === "excel") await exportJavobApprovedExcel(payload);
      else await exportJavobApprovedPdf(payload);
      toast({ title: t("javob.exportOk") });
    } catch (e) {
      toast({
        title: t("javob.exportFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  }

  const submitMut = useMutation({
    mutationFn: () => {
      const n = note.trim();
      if (!selectedYmds.length) throw new Error(t("javob.pickDaysHint"));
      if (n.length < 3) throw new Error(t("javob.noteRequired"));

      if (mode === "hour") {
        for (const ymd of selectedYmds) {
          const tm = dayTimes[ymd];
          if (!tm?.fromHm || !tm?.toHm) {
            throw new Error(`${formatYmdDisplay(ymd)}: ${t("javob.timeRequired")}`);
          }
          if (tm.fromHm === tm.toHm) {
            throw new Error(`${formatYmdDisplay(ymd)}: ${t("javob.timeRangeInvalid")}`);
          }
        }
      }

      const days: JavobDayInput[] = selectedYmds.map((ymd) => {
        const base: JavobDayInput = { workDate: ymd, note: n };
        if (mode === "hour") {
          base.fromHm = dayTimes[ymd]?.fromHm;
          base.toHm = dayTimes[ymd]?.toHm;
        }
        return base;
      });

      return submitJavobRequests(days);
    },
    onSuccess: (r) => {
      toast({ title: t("javob.sentOk"), description: r.message });
      setSelectedDates([]);
      setDayTimes({});
      setNote("");
      void qc.invalidateQueries({ queryKey: ["javob-olish"] });
    },
    onError: (e: Error) => toast({ title: t("javob.sentFail"), description: e.message, variant: "destructive" }),
  });

  const decideMut = useMutation({
    mutationFn: (p: { id: number; action: "approve" | "reject" }) =>
      p.action === "approve" ? approveJavobRequest(p.id) : rejectJavobRequest(p.id),
    onSuccess: (_, p) => {
      toast({
        title: p.action === "approve" ? t("javob.approved") : t("javob.rejected"),
      });
      void qc.invalidateQueries({ queryKey: ["javob-olish"] });
    },
    onError: (e: Error) => toast({ title: t("javob.decideFail"), description: e.message, variant: "destructive" }),
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) => cancelJavobRequest(id),
    onSuccess: () => {
      toast({ title: t("javob.cancelled") });
      void qc.invalidateQueries({ queryKey: ["javob-olish"] });
    },
    onError: (e: Error) => toast({ title: t("javob.decideFail"), description: e.message, variant: "destructive" }),
  });

  function removeDay(ymd: string) {
    setSelectedDates((prev) => prev.filter((d) => dateToYmd(d) !== ymd));
  }

  function setTime(ymd: string, field: "fromHm" | "toHm", value: string) {
    setDayTimes((prev) => ({
      ...prev,
      [ymd]: { fromHm: prev[ymd]?.fromHm || "", toHm: prev[ymd]?.toHm || "", [field]: value },
    }));
  }

  function switchMode(next: RequestMode) {
    setMode(next);
    if (next === "day") {
      setDayTimes((prev) => {
        const cleared: Record<string, DayTimes> = {};
        for (const ymd of Object.keys(prev)) cleared[ymd] = { fromHm: "", toHm: "" };
        return cleared;
      });
    }
  }

  const todayStart = startOfDay(new Date());
  const hourTimesReady =
    mode === "day" ||
    (selectedYmds.length > 0 &&
      selectedYmds.every((ymd) => {
        const tm = dayTimes[ymd];
        return Boolean(tm?.fromHm && tm?.toHm && tm.fromHm !== tm.toHm);
      }));

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 pb-28">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
          <PhoneCall className="h-5 w-5 text-primary" />
          {t("javob.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("javob.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-muted/40 p-1">
        <button
          type="button"
          onClick={() => switchMode("day")}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
            mode === "day"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0" />
          {t("javob.modeDay")}
        </button>
        <button
          type="button"
          onClick={() => switchMode("hour")}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition",
            mode === "hour"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Clock className="h-4 w-4 shrink-0" />
          {t("javob.modeHour")}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === "day" ? t("javob.modeDayHint") : t("javob.modeHourHint")}
      </p>

      <Card className="overflow-hidden border-primary/15 shadow-sm">
        <CardHeader className="border-b bg-gradient-to-br from-primary/10 via-card to-card py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-primary" />
            {t("javob.calendarTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {mode === "day" ? t("javob.calendarHintDay") : t("javob.calendarHintHour")}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 pt-4 sm:flex-row sm:items-start sm:justify-center">
          <Calendar
            mode="multiple"
            selected={selectedDates}
            onSelect={(days) => setSelectedDates(days || [])}
            disabled={(date) => isBefore(date, todayStart)}
            className="rounded-2xl border border-border"
          />
          <div className="w-full max-w-xs space-y-2 rounded-2xl border border-dashed border-border bg-muted/30 p-3 text-sm">
            <p className="font-semibold text-foreground">
              {t("javob.selectedCount")}: {selectedYmds.length} {t("javob.pcs")}
            </p>
            {selectedYmds.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("javob.pickDaysHint")}</p>
            ) : (
              <ul className="space-y-2">
                {selectedYmds.map((ymd) => {
                  const shift = shifts[ymd];
                  const tm = dayTimes[ymd] || { fromHm: "", toHm: "" };
                  return (
                    <li key={ymd} className="space-y-1.5 rounded-lg bg-card px-2.5 py-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            {formatYmdDisplay(ymd)}
                          </span>
                          {shift ? (
                            <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Clock3 className="h-3 w-3" />
                              {t("javob.shift")} {shift.shiftStartHm}–{shift.shiftEndHm}
                            </span>
                          ) : null}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-muted-foreground hover:text-rose-600"
                          onClick={() => removeDay(ymd)}
                          aria-label={t("ui.cancel")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {mode === "hour" ? (
                        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                          <div>
                            <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                              {t("javob.from")}
                            </label>
                            <Input
                              type="time"
                              value={tm.fromHm}
                              onChange={(e) => setTime(ymd, "fromHm", e.target.value)}
                              className="h-8 px-2 text-xs"
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                              {t("javob.to")}
                            </label>
                            <Input
                              type="time"
                              value={tm.toHm}
                              onChange={(e) => setTime(ymd, "toHm", e.target.value)}
                              className="h-8 px-2 text-xs"
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">{t("javob.fullShiftHint")}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {shiftsLoading ? (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("javob.loadingShifts")}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {selectedYmds.length > 0 ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">{t("javob.noteStepTitle")}</CardTitle>
            <p className="text-xs text-muted-foreground">{t("javob.noteStepHint")}</p>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("javob.noteLabel")} <span className="text-rose-600">*</span>
              </label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("javob.notePh")}
                className="min-h-[96px] resize-y"
                maxLength={800}
              />
            </div>
            <Button
              type="button"
              className="h-11 w-full text-sm font-semibold"
              disabled={submitMut.isPending || !hourTimesReady}
              onClick={() => submitMut.mutate()}
            >
              {submitMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {mode === "hour" ? t("javob.submitHour") : t("javob.submitDay")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {canDecideQueue ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">
              {isHr && !isCoord ? t("javob.hrTitle") : t("javob.coordTitle")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {isHr && !isCoord ? t("javob.hrHint") : t("javob.coordHint")}
            </p>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {(pendingQ.data?.items.length ?? 0) === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {t("javob.noPending")}
              </p>
            ) : (
              pendingQ.data!.items.map((item) => {
                const badge = statusBadge(item.status, t);
                return (
                  <div key={item.id} className="space-y-2 rounded-xl border border-border bg-card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {item.fullName || `#${item.employeeId}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatYmdDisplay(item.workDate)} · {requestKindLabel(item, t)} · {item.fromHm}–
                          {item.toHm}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {t("javob.shift")} {item.shiftStartHm}–{item.shiftEndHm}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {t("javob.sentAt")}: {item.createdAtLabel || "—"}
                        </p>
                      </div>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", badge.className)}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-foreground">
                      <span className="font-semibold">{t("javob.note")}: </span>
                      {item.note}
                    </p>
                    {item.escalatedNote ? (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-950">
                        {item.escalatedNote}
                      </p>
                    ) : null}
                    {item.coordDecidedAt && item.status === "pending_hr" && !item.escalatedAt ? (
                      <p className="text-[11px] text-emerald-800">
                        {t("javob.coordApprovedWaitingHr")}
                      </p>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-rose-200 text-rose-700 hover:bg-rose-50"
                        disabled={decideMut.isPending}
                        onClick={() => decideMut.mutate({ id: item.id, action: "reject" })}
                      >
                        <XCircle className="mr-1.5 h-4 w-4" />
                        {t("javob.reject")}
                      </Button>
                      <Button
                        type="button"
                        disabled={decideMut.isPending}
                        onClick={() => decideMut.mutate({ id: item.id, action: "approve" })}
                      >
                        <CheckCircle2 className="mr-1.5 h-4 w-4" />
                        {item.status === "pending_hr" ? t("javob.approveFinal") : t("javob.approve")}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      ) : null}

      {isHr ? (
        <Card className="overflow-hidden border-emerald-200/60 shadow-sm">
          <CardHeader className="border-b bg-gradient-to-br from-emerald-50 via-card to-card py-3 dark:from-emerald-950/30">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  {t("javob.approvedByMeTitle")}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{t("javob.approvedByMeHint")}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5"
                  disabled={exporting !== null || !(approvedByMeQ.data?.items.length)}
                  onClick={() => void runApprovedExport("excel")}
                >
                  {exporting === "excel" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                  )}
                  {t("javob.exportExcel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1.5"
                  disabled={exporting !== null || !(approvedByMeQ.data?.items.length)}
                  onClick={() => void runApprovedExport("pdf")}
                >
                  {exporting === "pdf" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileDown className="h-3.5 w-3.5 text-rose-700" />
                  )}
                  {t("javob.exportPdf")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-3">
            {approvedByMeQ.isLoading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                …
              </p>
            ) : (approvedByMeQ.data?.items.length ?? 0) === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {t("javob.approvedByMeEmpty")}
              </p>
            ) : (
              approvedByMeQ.data!.items.map((item) => {
                const hourly = isHourlyRequest(item);
                return (
                  <div
                    key={item.id}
                    className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {item.fullName || `#${item.employeeId}`}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                            {hourly ? (
                              <Clock className="h-3 w-3" />
                            ) : (
                              <CalendarDays className="h-3 w-3" />
                            )}
                            {requestKindLabel(item, t)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {formatYmdDisplay(item.workDate)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3 w-3" />
                            {item.fromHm}–{item.toHm}
                          </span>
                          {item.durationLabel ? (
                            <span>· {t("javob.duration")}: {item.durationLabel}</span>
                          ) : null}
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {t("javob.shift")}: {item.shiftStartHm}–{item.shiftEndHm}
                          {item.shiftOvernight ? ` (${t("javob.nextDay")})` : ""}
                        </p>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-900">
                        {t("javob.statusApproved")}
                      </span>
                    </div>
                    <p className="rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-foreground">
                      <span className="font-semibold">{t("javob.note")}: </span>
                      {item.note || "—"}
                    </p>
                    {item.decisionNote ? (
                      <p className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-2.5 py-2 text-[11px] text-emerald-950">
                        <span className="font-semibold">{t("javob.hrDecisionNote")}: </span>
                        {item.decisionNote}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span>
                        {t("javob.sentAt")}: {item.createdAtLabel || "—"}
                      </span>
                      <span>
                        {t("javob.approvedAt")}: {formatDecidedAt(item.decidedAt)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">{t("javob.myRequests")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {(mineQ.data?.items.length ?? 0) === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              {t("javob.noMine")}
            </p>
          ) : (
            mineQ.data!.items.map((item) => {
              const badge = statusBadge(item.status, t);
              return (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-2 rounded-xl border border-border px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {formatYmdDisplay(item.workDate)} · {requestKindLabel(item, t)}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {item.fromHm}–{item.toHm} · {item.note}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {t("javob.sentAt")}: {item.createdAtLabel || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", badge.className)}>
                      {badge.label}
                    </span>
                    {isOpenStatus(item.status) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-rose-600"
                        disabled={cancelMut.isPending}
                        onClick={() => cancelMut.mutate(item.id)}
                      >
                        {t("javob.cancel")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

