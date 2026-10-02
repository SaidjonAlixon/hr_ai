import { isDeptHeadRole, isDirectorRole } from "../../lib/roles";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Clock, Clock3, Loader2, PhoneCall, Send, Trash2 } from "lucide-react";
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
import { JavobRequestCard } from "../../components/javob/JavobRequestCard";
import { JavobDecisionPanel } from "../../components/javob/JavobDecisionPanel";
import {
  cancelJavobRequest,
  dateToYmd,
  fetchJavobRequests,
  fetchJavobShifts,
  formatYmdDisplay,
  groupConsecutiveJavob,
  isJavobOpenStatus,
  submitJavobRequests,
  type JavobDayInput,
  type JavobShiftInfo,
} from "../../lib/javob-olish-api";

type RequestMode = "day" | "hour";

type DayTimes = { fromHm: string; toHm: string };

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
  const isDept = isDeptHeadRole(role) && !isHr && !isCoord;
  const canDecideQueue = isCoord || isHr || isDeptHeadRole(role);

  const [mode, setMode] = useState<RequestMode>("day");
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [dayTimes, setDayTimes] = useState<Record<string, DayTimes>>({});
  const [note, setNote] = useState("");
  const [shifts, setShifts] = useState<Record<string, JavobShiftInfo>>({});
  const [shiftsLoading, setShiftsLoading] = useState(false);

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

  const openWorkDates = useMemo(() => {
    const set = new Set<string>();
    for (const item of mineQ.data?.items ?? []) {
      if (isJavobOpenStatus(item.status)) set.add(item.workDate);
    }
    return set;
  }, [mineQ.data?.items]);

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
    <div className={cn("mx-auto min-w-0 max-w-full space-y-4 overflow-x-hidden pb-6 sm:space-y-5 sm:p-2", canDecideQueue ? "max-w-5xl" : "max-w-3xl")}>
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
        <CardContent className="flex flex-col items-stretch gap-4 px-3 pt-4 sm:flex-row sm:items-start sm:justify-center sm:px-6">
          <Calendar
            mode="multiple"
            selected={selectedDates}
            onSelect={(days) => {
              const next = days || [];
              const blocked = next.filter((d) => openWorkDates.has(dateToYmd(d)));
              if (blocked.length) {
                toast({
                  title: t("javob.openDayBlocked"),
                  description: blocked.map((d) => formatYmdDisplay(dateToYmd(d))).join(", "),
                  variant: "destructive",
                });
              }
              setSelectedDates(next.filter((d) => !openWorkDates.has(dateToYmd(d))));
            }}
            disabled={(date) => isBefore(date, todayStart) || openWorkDates.has(dateToYmd(date))}
            className="rounded-2xl border border-border"
          />
          <div className="w-full max-w-xs space-y-2 rounded-2xl border border-dashed border-border bg-muted/30 p-3 text-sm">
            {openWorkDates.size > 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950">
                {t("javob.openDayHint")}
              </p>
            ) : null}
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
        <JavobDecisionPanel t={t} isHr={isHr} isCoord={isCoord} isDept={isDept} userId={user?.id ?? null} />
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
            groupConsecutiveJavob(mineQ.data!.items).map((group) => (
              <JavobRequestCard
                key={group.id}
                item={group.head}
                datesLabel={group.datesLabel}
                dayCount={group.dayCount}
                t={t}
                hideName
                actions={
                  isJavobOpenStatus(group.head.status) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-full text-xs text-rose-600"
                      disabled={cancelMut.isPending}
                      onClick={() => cancelMut.mutate(group.id)}
                    >
                      {group.dayCount > 1 ? `${t("javob.cancel")} · ${group.dayCount} kun` : t("javob.cancel")}
                    </Button>
                  ) : null
                }
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

