import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  PhoneCall,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { isBefore, startOfDay } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
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
  type JavobShiftInfo,
} from "../../lib/javob-olish-api";

function statusBadge(status: string, t: (k: string) => string) {
  if (status === "pending") return { label: t("javob.statusPending"), className: "bg-amber-100 text-amber-900" };
  if (status === "approved") return { label: t("javob.statusApproved"), className: "bg-emerald-100 text-emerald-900" };
  if (status === "rejected") return { label: t("javob.statusRejected"), className: "bg-rose-100 text-rose-900" };
  if (status === "cancelled") return { label: t("javob.statusCancelled"), className: "bg-muted text-muted-foreground" };
  return { label: status, className: "bg-muted text-muted-foreground" };
}

export default function JavobOlishPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const role = user?.role || "";
  const isCoord = role === "koordinator" || role === "admin" || role === "director" || role.startsWith("hr");

  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
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

  const mineQ = useQuery({
    queryKey: ["javob-olish", "mine"],
    queryFn: () => fetchJavobRequests("mine"),
  });

  const pendingQ = useQuery({
    queryKey: ["javob-olish", "pending"],
    queryFn: () => fetchJavobRequests("pending"),
    enabled: isCoord,
  });

  const submitMut = useMutation({
    mutationFn: () => {
      const n = note.trim();
      if (!selectedYmds.length) throw new Error(t("javob.pickDaysHint"));
      if (n.length < 3) throw new Error(t("javob.noteRequired"));
      return submitJavobRequests({
        dates: selectedYmds,
        note: n,
      });
    },
    onSuccess: (r) => {
      toast({ title: t("javob.sentOk"), description: r.message });
      setSelectedDates([]);
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

  const todayStart = startOfDay(new Date());

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 pb-28">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
          <PhoneCall className="h-5 w-5 text-primary" />
          {t("javob.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("javob.subtitle")}</p>
      </div>

      <Card className="overflow-hidden border-primary/15 shadow-sm">
        <CardHeader className="border-b bg-gradient-to-br from-primary/10 via-card to-card py-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-primary" />
            {t("javob.calendarTitle")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{t("javob.calendarHint")}</p>
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
              <ul className="space-y-1.5">
                {selectedYmds.map((ymd) => {
                  const shift = shifts[ymd];
                  return (
                    <li
                      key={ymd}
                      className="flex items-start justify-between gap-2 rounded-lg bg-card px-2.5 py-1.5 text-xs"
                    >
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
              disabled={submitMut.isPending}
              onClick={() => submitMut.mutate()}
            >
              {submitMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {t("javob.submit")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isCoord ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">{t("javob.coordTitle")}</CardTitle>
            <p className="text-xs text-muted-foreground">{t("javob.coordHint")}</p>
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
                          {formatYmdDisplay(item.workDate)} · {t("javob.shift")} {item.shiftStartHm}–
                          {item.shiftEndHm}
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
                        {t("javob.approve")}
                      </Button>
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
                    <p className="text-sm font-medium text-foreground">{formatYmdDisplay(item.workDate)}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {t("javob.shift")} {item.shiftStartHm}–{item.shiftEndHm} · {item.note}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", badge.className)}>
                      {badge.label}
                    </span>
                    {item.status === "pending" ? (
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
