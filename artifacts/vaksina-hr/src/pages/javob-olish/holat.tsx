import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileDown,
  FileSpreadsheet,
  Loader2,
  PhoneCall,
  Search,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { useToast } from "../../hooks/use-toast";
import { useI18n } from "../../i18n/I18nProvider";
import { useAuth } from "../../contexts/AuthContext";
import { cn } from "../../lib/utils";
import { isDirectorRole } from "../../lib/roles";
import { JavobRequestCard } from "../../components/javob/JavobRequestCard";
import {
  approveJavobRequest,
  fetchJavobRequests,
  formatYmdDisplay,
  groupConsecutiveJavob,
  rejectJavobRequest,
  type JavobRequestItem,
} from "../../lib/javob-olish-api";
import {
  buildJavobApprovedExport,
  exportJavobApprovedExcel,
  exportJavobApprovedPdf,
} from "../../lib/javob-olish-export";

type StatusFilter = "all" | "pending_coord" | "pending_hr" | "approved" | "rejected" | "cancelled";

const MONTHS_UZ = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentabr",
  "Oktabr",
  "Noyabr",
  "Dekabr",
];
const WEEK_UZ = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

function currentMonthKey() {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return ymd.slice(0, 7);
}

function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y!, (m || 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthMeta(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const days = new Date(y!, m!, 0).getDate();
  const startWeekday = (new Date(y!, (m || 1) - 1, 1).getDay() + 6) % 7;
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(days).padStart(2, "0")}`,
    days,
    startWeekday,
    label: `${MONTHS_UZ[(m || 1) - 1]} ${y}`,
  };
}

function fmtMinutes(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} daqiqa`;
  return m ? `${h} soat ${m} daqiqa` : `${h} soat`;
}

function isHourlyItem(it: JavobRequestItem) {
  return it.kind === "hour" || it.fromHm !== it.shiftStartHm || it.toHm !== it.shiftEndHm;
}

function canAccessJavobHolat(role: string) {
  return (
    role === "hr_menejer" ||
    role === "hr_direktor" ||
    role === "hr" ||
    role === "hr_kadr_rahbar" ||
    role === "hr_auditor" ||
    role === "admin" ||
    isDirectorRole(role)
  );
}

export default function JavobOlishHolatPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const role = user?.role || "";
  const allowed = canAccessJavobHolat(role);
  const canDecide =
    role === "hr_menejer" ||
    role === "hr_direktor" ||
    role === "hr" ||
    role === "hr_kadr_rahbar" ||
    role === "admin" ||
    isDirectorRole(role);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const [historyPdf, setHistoryPdf] = useState(false);
  const [dismissed, setDismissed] = useState<Set<number>>(() => new Set());
  const [month, setMonth] = useState(currentMonthKey);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [personId, setPersonId] = useState<number | null>(null);
  const range = useMemo(() => monthMeta(month), [month]);

  const holatKey = ["javob-olish", "all", "holat", month] as const;

  const allQ = useQuery({
    queryKey: holatKey,
    queryFn: () => fetchJavobRequests("all", { from: range.from, to: range.to }),
    enabled: allowed,
  });

  const personQ = useQuery({
    queryKey: ["javob-olish", "person", personId],
    queryFn: () => fetchJavobRequests("all", { employeeId: personId! }),
    enabled: allowed && personId != null,
  });

  const decideMut = useMutation({
    mutationFn: (p: { ids: number[]; action: "approve" | "reject" }) =>
      p.action === "approve" ? approveJavobRequest(p.ids[0]!) : rejectJavobRequest(p.ids[0]!),
    onMutate: async (p) => {
      const ids = new Set(p.ids);
      setDismissed((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      await qc.cancelQueries({ queryKey: holatKey });
      const snapshot = qc.getQueryData<{ items: JavobRequestItem[] }>(holatKey);
      const nextStatus = p.action === "approve" ? "approved" : "rejected";
      qc.setQueryData<{ items: JavobRequestItem[] }>(holatKey, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((it) =>
                ids.has(it.id) ? { ...it, status: nextStatus, canAct: false } : it,
              ),
            }
          : old,
      );
      return { snapshot };
    },
    onSuccess: (_res, p) => {
      toast({
        title: p.action === "approve" ? t("javob.approved") : t("javob.rejected"),
        description: p.ids.length > 1 ? `${p.ids.length} ketma-ket kun birga yopildi` : undefined,
      });
      void qc.invalidateQueries({ queryKey: ["javob-olish"] });
    },
    onError: (e: Error, p, ctx) => {
      setDismissed((prev) => {
        const next = new Set(prev);
        for (const id of p.ids) next.delete(id);
        return next;
      });
      if (ctx?.snapshot) qc.setQueryData(holatKey, ctx.snapshot);
      toast({ title: t("javob.decideFail"), description: e.message, variant: "destructive" });
    },
  });

  const items = allQ.data?.items ?? [];

  const stats = useMemo(() => {
    let pendingCoord = 0;
    let pendingHr = 0;
    let approved = 0;
    let rejected = 0;
    let cancelled = 0;
    for (const it of items) {
      if (it.status === "pending" || it.status === "pending_coord") pendingCoord += 1;
      else if (it.status === "pending_hr") pendingHr += 1;
      else if (it.status === "approved") approved += 1;
      else if (it.status === "rejected") rejected += 1;
      else if (it.status === "cancelled") cancelled += 1;
    }
    return { total: items.length, pendingCoord, pendingHr, approved, rejected, cancelled };
  }, [items]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items.filter((it) => {
      if (statusFilter === "pending_coord") {
        if (it.status !== "pending" && it.status !== "pending_coord") return false;
      } else if (statusFilter !== "all" && it.status !== statusFilter) {
        return false;
      }
      if (!qq) return true;
      const hay =
        `${it.fullName || ""} ${it.note || ""} ${it.workDate} ${it.branchLabel || ""} ${it.coordinatorName || ""}`.toLowerCase();
      return hay.includes(qq);
    });
  }, [items, statusFilter, q]);

  const visibleGroups = useMemo(() => {
    const queue = statusFilter === "all" || statusFilter === "pending_coord" || statusFilter === "pending_hr";
    const base = queue ? filtered.filter((it) => !dismissed.has(it.id)) : filtered;
    return groupConsecutiveJavob(base).filter((group) => {
      if (pickedDay && !group.items.some((it) => it.workDate === pickedDay)) return false;
      if (personId != null && group.head.employeeId !== personId) return false;
      return true;
    });
  }, [filtered, dismissed, statusFilter, pickedDay, personId]);
  const visible = useMemo(() => visibleGroups.flatMap((group) => group.items), [visibleGroups]);

  const dayCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) map.set(it.workDate, (map.get(it.workDate) || 0) + 1);
    return map;
  }, [items]);

  const people = useMemo(() => {
    const map = new Map<
      number,
      { id: number; name: string; branch: string; count: number; minutes: number; daily: number; hourly: number }
    >();
    for (const it of items) {
      const cur = map.get(it.employeeId) || {
        id: it.employeeId,
        name: it.fullName || `#${it.employeeId}`,
        branch: it.branchLabel || "",
        count: 0,
        minutes: 0,
        daily: 0,
        hourly: 0,
      };
      cur.count += 1;
      cur.minutes += it.durationMinutes || 0;
      if (isHourlyItem(it)) cur.hourly += 1;
      else cur.daily += 1;
      if (!cur.branch && it.branchLabel) cur.branch = it.branchLabel;
      map.set(it.employeeId, cur);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "uz"));
  }, [items]);

  const history = personQ.data?.items ?? [];
  const historyName = history[0]?.fullName || people.find((p) => p.id === personId)?.name || "Xodim";
  const historyMinutes = history.reduce((s, it) => s + (it.durationMinutes || 0), 0);
  const monthPerson = people.find((p) => p.id === personId) || null;

  async function runExport(kind: "excel" | "pdf") {
    if (!visible.length) {
      toast({ title: t("javob.exportEmpty"), variant: "destructive" });
      return;
    }
    setExporting(kind);
    try {
      const payload = buildJavobApprovedExport(visible, t("javob.holatExportTitle"));
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

  async function exportPersonHistory() {
    if (!history.length) {
      toast({ title: t("javob.exportEmpty"), variant: "destructive" });
      return;
    }
    setHistoryPdf(true);
    try {
      const payload = buildJavobApprovedExport(
        [...history].sort((a, b) => b.workDate.localeCompare(a.workDate)),
        `${historyName} — javob olish istoriyasi`,
      );
      await exportJavobApprovedPdf(payload);
      toast({ title: t("javob.exportOk") });
    } catch (e) {
      toast({
        title: t("javob.exportFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setHistoryPdf(false);
    }
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center text-sm text-muted-foreground">
        {t("javob.holatNoAccess")}
      </div>
    );
  }

  const filters: { id: StatusFilter; label: string; count?: number }[] = [
    { id: "all", label: t("javob.holatFilterAll"), count: stats.total },
    { id: "pending_coord", label: t("javob.statusPendingCoord"), count: stats.pendingCoord },
    { id: "pending_hr", label: t("javob.statusPendingHr"), count: stats.pendingHr },
    { id: "approved", label: t("javob.holatFilterApproved"), count: stats.approved },
    { id: "rejected", label: t("javob.holatFilterRejected"), count: stats.rejected },
    { id: "cancelled", label: t("javob.statusCancelled") },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <Eye className="h-5 w-5 text-primary" />
            {t("javob.holatTitle")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("javob.holatSubtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={exporting !== null || !visible.length}
            onClick={() => void runExport("excel")}
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
            disabled={exporting !== null || !visible.length}
            onClick={() => void runExport("pdf")}
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: t("javob.holatStatTotal"), value: stats.total },
          { label: t("javob.statusPendingCoord"), value: stats.pendingCoord },
          { label: t("javob.statusPendingHr"), value: stats.pendingHr },
          { label: t("javob.holatFilterApproved"), value: stats.approved },
          { label: t("javob.holatFilterRejected"), value: stats.rejected },
          { label: t("javob.statusCancelled"), value: stats.cancelled },
        ].map((s) => (
          <Card key={s.label} className="shadow-sm">
            <CardContent className="p-3">
              <div className="text-2xl font-bold tabular-nums">{s.value}</div>
              <div className="text-[11px] font-medium text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => {
                setMonth((m) => shiftMonth(m, -1));
                setPickedDay(null);
                setPersonId(null);
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-center">
              <p className="flex items-center justify-center gap-1.5 text-sm font-semibold">
                <CalendarDays className="h-4 w-4 text-primary" />
                {range.label}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {items.length} ta so‘rov · {people.length} kishi
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={() => {
                setMonth((m) => shiftMonth(m, 1));
                setPickedDay(null);
                setPersonId(null);
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground">
            {WEEK_UZ.map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: range.startWeekday }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {Array.from({ length: range.days }).map((_, i) => {
              const ymd = `${month}-${String(i + 1).padStart(2, "0")}`;
              const n = dayCounts.get(ymd) || 0;
              const on = pickedDay === ymd;
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => setPickedDay((cur) => (cur === ymd ? null : ymd))}
                  className={cn(
                    "flex h-11 flex-col items-center justify-center rounded-lg text-xs",
                    on ? "bg-primary text-primary-foreground" : n ? "bg-sky-50 text-sky-950 hover:bg-sky-100" : "hover:bg-muted",
                  )}
                >
                  <span className="font-semibold">{i + 1}</span>
                  {n ? <span className={cn("text-[10px] leading-none", on ? "text-primary-foreground" : "text-sky-700")}>{n}</span> : null}
                </button>
              );
            })}
          </div>
          {pickedDay ? (
            <button type="button" className="text-xs font-medium text-primary" onClick={() => setPickedDay(null)}>
              Kun filtri o‘chirilsin · {formatYmdDisplay(pickedDay)}
            </button>
          ) : null}
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Shu oyda kim necha marta javob olgan</p>
            {people.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bu oyda so‘rov yo‘q</p>
            ) : (
              <div className="flex max-h-48 flex-col gap-1.5 overflow-auto">
                {people.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPersonId(p.id)}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left",
                      personId === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {p.branch || "Filial yo‘q"} · kunlik {p.daily} · soatlik {p.hourly} · {fmtMinutes(p.minutes)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-sky-100 px-2 py-1 text-xs font-bold text-sky-900">{p.count} marta</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("javob.holatSearch")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatusFilter(f.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              statusFilter === f.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            {typeof f.count === "number" ? ` · ${f.count}` : ""}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PhoneCall className="h-4 w-4 text-primary" />
            {t("javob.holatListTitle")}
            <span className="text-sm font-normal text-muted-foreground">({visibleGroups.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {allQ.isLoading ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              …
            </p>
          ) : visibleGroups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
              {t("javob.holatEmpty")}
            </p>
          ) : (
            visibleGroups.map((group) => {
              const item = group.head;
              const needsHr = canDecide && item.status === "pending_hr";
              const ids = group.items.map((it) => it.id);
              return (
                <JavobRequestCard
                  key={group.id}
                  item={item}
                  datesLabel={group.datesLabel}
                  dayCount={group.dayCount}
                  t={t}
                  actions={
                    needsHr ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="border-rose-200 text-rose-700 hover:bg-rose-50"
                          disabled={decideMut.isPending}
                          onClick={() => decideMut.mutate({ ids, action: "reject" })}
                        >
                          <XCircle className="mr-1.5 h-4 w-4" />
                          {t("javob.reject")}
                        </Button>
                        <Button
                          type="button"
                          disabled={decideMut.isPending}
                          onClick={() => decideMut.mutate({ ids, action: "approve" })}
                        >
                          <CheckCircle2 className="mr-1.5 h-4 w-4" />
                          {t("javob.approveFinal")}
                        </Button>
                      </div>
                    ) : null
                  }
                />
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={personId != null} onOpenChange={(open) => { if (!open) setPersonId(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{historyName}</DialogTitle>
            <DialogDescription>
              {monthPerson
                ? `${range.label}: ${monthPerson.count} marta · ${fmtMinutes(monthPerson.minutes)} · kunlik ${monthPerson.daily}, soatlik ${monthPerson.hourly}`
                : range.label}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Jami istoriya: {history.length} marta · {fmtMinutes(historyMinutes)}
            </p>
            <Button type="button" size="sm" disabled={historyPdf || personQ.isLoading || !history.length} onClick={() => void exportPersonHistory()}>
              {historyPdf ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
              PDF
            </Button>
          </div>
          {personQ.isLoading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </p>
          ) : (
            <div className="space-y-2">
              {history.map((it) => (
                <div key={it.id} className="rounded-xl border border-border px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{formatYmdDisplay(it.workDate)}</p>
                    <span className="text-[11px] font-semibold text-muted-foreground">{it.status === "approved" ? "Ruxsat berilgan" : it.status === "rejected" ? "Rad etilgan" : it.status === "pending_hr" ? "HR kutmoqda" : it.status === "cancelled" ? "Bekor" : "Koordinator kutmoqda"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isHourlyItem(it) ? "Soatlik" : "Kunlik"} · {it.fromHm}–{it.toHm} · {it.durationLabel}
                    {it.branchLabel ? ` · ${it.branchLabel}` : ""}
                  </p>
                  {it.note ? <p className="mt-1 text-xs">{it.note}</p> : null}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
