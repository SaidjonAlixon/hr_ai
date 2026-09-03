import React, { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Settings2,
  Users,
  Lock,
  CalendarDays,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { userRoleLabel } from "@/lib/roles";
import { useToast } from "@/hooks/use-toast";
import { formatMoney, MoneyInput, parseMoney } from "@/lib/money";
import { useI18n } from "@/i18n/I18nProvider";
import {
  canApprovePayroll,
  canEditKpiSettings,
  canManagePayroll,
  currentMonthKey,
  formatSom,
  monthLabelUz,
  shiftMonthKey,
  useApproveOylik,
  useOylikEmployee,
  useOylikEmployees,
  useOylikMe,
  useOylikSettings,
  useRecalculateOylik,
  useSaveOylikSettings,
  useSaveSalary,
  useSaveSalaryBulk,
  useToggleWorkDay,
  downloadOylikExcel,
  payrollRowKey,
  type PayrollReport,
  type PayrollRow,
} from "@/lib/oylik-api";

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

function pct(available: boolean, value: number) {
  if (!available) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{value}%</span>;
}

function pctAtt(row: PayrollRow, t: (key: string, fallback?: string) => string) {
  const closed = row.closedWorkDays ?? 0;
  const expected = row.expectedWorkDays ?? 0;
  if (!row.attendanceAvailable) {
    return (
      <span className="text-[11px] text-amber-700" title={t("oylik.attHint")}>
        {t("oylik.attOpen")} {closed}/{expected}
      </span>
    );
  }
  return <span className="tabular-nums">{row.attendance}%</span>;
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
          <CalendarDays className="h-4 w-4" /> {t("ui.workDaysCalendar")}
        </p>
        <p className="text-xs text-muted-foreground">
          {canEdit
            ? `${workDays.length} ${t("ui.workDaysHint")}`
            : `${workDays.length} ${t("ui.workDay")} · ${t("ui.weekday.sun")} ${t("ui.dayOff")}`}
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

function KpiRow({
  name,
  percent,
  weight,
  available,
  onOpen,
}: {
  name: string;
  percent: number;
  weight: number;
  available: boolean;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
      <span className="text-sm font-medium text-foreground">{name}</span>
      <span className="tabular-nums text-sm">
        {available ? `${percent}%` : t("oylik.excluded")}
        <span className="ml-2 text-xs text-muted-foreground">{available ? `${weight}%` : "—"}</span>
      </span>
    </button>
  );
}

function ReportCard({
  data,
  detail,
  setDetail,
}: {
  data: PayrollReport;
  detail: "att" | "task" | "check" | null;
  setDetail: (v: "att" | "task" | "check" | null) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="dept-panel p-3 lg:col-span-1">
        <p className="text-xs text-muted-foreground">
          {data.fullName} · {data.position || data.roleLabel}
          {data.branch ? ` · ${data.branch}` : ""}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{t("oylik.fixedSalary")}</p>
            <p className="text-sm font-bold dept-accent-value">{formatSom(data.fixedSalary)}</p>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{t("oylik.bonusPercent")}</p>
            <p className="text-sm font-bold">{data.bonusPercent}%</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">{t("oylik.kpiBonus")}</p>
        <p className="text-lg font-bold text-emerald-700">{formatSom(data.bonusAmount)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{t("oylik.totalFormula")}</p>
        <p className="text-xl font-bold tabular-nums dept-accent-value">{formatSom(data.totalAmount)}</p>
        <Badge className="mt-2" variant={data.status === "approved" ? "default" : "outline"}>
          {data.status === "approved" ? t("ui.approved") : t("ui.draft")}
        </Badge>
      </div>

      <div className="dept-panel p-3 lg:col-span-2">
        <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("oylik.kpiTap")}</p>
        <KpiRow
          name={t("oylik.attendance")}
          percent={data.attendance?.percent ?? 0}
          weight={data.attendance?.effectiveWeight ?? 0}
          available={Boolean(data.attendance?.available)}
          onOpen={() => setDetail(detail === "att" ? null : "att")}
        />
        <KpiRow
          name={t("oylik.tasks")}
          percent={data.tasks?.percent ?? 0}
          weight={data.tasks?.effectiveWeight ?? 0}
          available={Boolean(data.tasks?.available)}
          onOpen={() => setDetail(detail === "task" ? null : "task")}
        />
        <KpiRow
          name={t("oylik.col.checklist")}
          percent={data.checklist?.percent ?? 0}
          weight={data.checklist?.effectiveWeight ?? 0}
          available={Boolean(data.checklist?.available)}
          onOpen={() => setDetail(detail === "check" ? null : "check")}
        />
        <div className="mt-1 flex items-center justify-between border-t px-2 pt-2">
          <span className="text-sm font-semibold">{t("oylik.overallKpi")}</span>
          <span className="text-base font-bold tabular-nums dept-accent-value">
            {data.attendance?.available ? `${data.kpiPercent}%` : t("oylik.notExact")}
          </span>
        </div>
        {detail === "att" ? (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border bg-muted p-2 text-xs">
            <p className="mb-1 font-semibold">
              {t("oylik.attendance")}: {data.attendance?.points ?? 0}
              {data.attendance?.complete
                ? ` · ${data.attendance.percent}%`
                : ` · ${t("oylik.notExact")} (${t("oylik.attOpen")} ${data.attendance?.closedDays ?? 0}/${data.attendance?.expectedDays ?? 0})`}
            </p>
            {(data.attendance?.days ?? []).map((d) => (
              <p key={d.date} className="flex justify-between gap-2 py-0.5">
                <span>{d.date}</span>
                <span>{d.counted ? `${d.points} · ${d.note}` : d.note}</span>
              </p>
            ))}
          </div>
        ) : null}
        {detail === "task" ? (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border bg-muted p-2 text-xs">
            <p className="mb-1 font-semibold">{t("oylik.col.task")}: {data.tasks?.points ?? 0} / {data.tasks?.total ?? 0}</p>
            {(data.tasks?.items ?? []).map((item) => (
              <p key={item.id} className="py-0.5">{item.title} — {item.label} ({item.points})</p>
            ))}
            {!data.tasks?.items?.length ? <p className="text-muted-foreground">{t("oylik.noTasks")}</p> : null}
          </div>
        ) : null}
        {detail === "check" ? (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border bg-muted p-2 text-xs">
            {(data.checklist?.items ?? []).map((c) => (
              <p key={c.id} className="py-0.5">{c.visitDate} · {c.visitName}: {c.percent}% ({c.yesCount}/{c.totalCount})</p>
            ))}
            {!data.checklist?.items?.length ? <p className="text-muted-foreground">{t("oylik.noChecklist")}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TeamTable({
  rows,
  openId,
  setOpenId,
  one,
  fix,
  setFix,
  bp,
  setBp,
  detail,
  setDetail,
  userRole,
  month,
  saveSal,
  approve,
  toast,
}: {
  rows: PayrollRow[];
  openId: number | null;
  setOpenId: (id: number | null) => void;
  one: ReturnType<typeof useOylikEmployee>;
  fix: string;
  setFix: (v: string) => void;
  bp: string;
  setBp: (v: string) => void;
  detail: "att" | "task" | "check" | null;
  setDetail: (v: "att" | "task" | "check" | null) => void;
  userRole?: string | null;
  month: string;
  saveSal: ReturnType<typeof useSaveSalary>;
  approve: ReturnType<typeof useApproveOylik>;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const { t } = useI18n();
  const live = React.useRef({ fix: parseMoney(fix), bp: parseMoney(bp) });
  live.current.fix = parseMoney(fix);
  live.current.bp = parseMoney(bp);

  const persist = (row: PayrollRow, nextFix?: number, nextBp?: number) => {
    const fixedSalary = nextFix ?? live.current.fix;
    const bonusPercent = nextBp ?? live.current.bp;
    live.current = { fix: fixedSalary, bp: bonusPercent };
    saveSal.mutate({
      userId: row.userId || 0,
      employeeId: row.employeeId,
      month,
      fixedSalary,
      bonusPercent,
    });
  };

  const totals = useMemo(() => {
    return rows.reduce(
      (a, r) => {
        a.fix += r.fixedSalary;
        a.bonus += r.bonusAmount;
        a.total += r.totalAmount;
        return a;
      },
      { fix: 0, bonus: 0, total: 0 },
    );
  }, [rows]);

  if (!rows.length) {
    return (
      <div className="dept-empty">
        {t("oylik.empty", "Bu oy uchun xodim topilmadi. Qidiruvni tozalang yoki API qayta ishga tushganini tekshiring.")}
      </div>
    );
  }

  return (
    <div className="dept-data-table">
      <div className="grid grid-cols-2 gap-px border-b bg-muted/50 sm:grid-cols-4">
        <div className="bg-card px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("oylik.stat.employees")}</p>
          <p className="dept-accent-value text-sm font-bold tabular-nums">{rows.length} {t("oylik.count")}</p>
        </div>
        <div className="bg-card px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("oylik.stat.fixed")}</p>
          <p className="text-sm font-bold tabular-nums">{formatSom(totals.fix)}</p>
        </div>
        <div className="bg-card px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("oylik.stat.bonus")}</p>
          <p className="text-sm font-bold tabular-nums text-emerald-700">{formatSom(totals.bonus)}</p>
        </div>
        <div className="bg-card px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("oylik.stat.total")}</p>
          <p className="dept-accent-value text-sm font-bold tabular-nums">{formatSom(totals.total)}</p>
        </div>
      </div>
      <div className="max-h-[min(70vh,720px)] overflow-auto">
        <table className="w-full min-w-[1080px] border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-primary text-primary-foreground dark:bg-slate-800/95 dark:text-slate-100">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold">{t("oylik.col.employee")}</th>
              <th className="px-2 py-2 font-semibold">{t("oylik.col.positionBranch")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("oylik.col.attendance")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("oylik.col.task")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("oylik.col.checklist")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("oylik.col.kpi")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("oylik.col.fixed")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("oylik.col.bonusPct")}</th>
              <th className="px-2 py-2 text-right font-semibold">{t("oylik.col.bonus")}</th>
              <th className="px-3 py-2 text-right font-semibold">{t("oylik.col.total")}</th>
              <th className="px-2 py-2 font-semibold">{t("oylik.col.status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rid = payrollRowKey(row);
              const open = openId === rid;
              return (
                <React.Fragment key={rid}>
                  <tr
                    className={cn("cursor-pointer border-b border-border/60 hover:bg-muted/40 dark:hover:bg-slate-800/45", open && "bg-primary/5 dark:bg-sky-500/10")}
                    onClick={() => setOpenId(open ? null : rid)}
                  >
                    <td className="px-3 py-1.5">
                      <p className="font-semibold text-foreground">{row.fullName}</p>
                      <p className="text-[11px] text-muted-foreground">{row.roleLabel}</p>
                    </td>
                    <td className="max-w-[180px] truncate px-2 py-1.5 text-muted-foreground">
                      {row.position || "—"}
                      {row.branch ? <span className="block truncate text-[11px] text-muted-foreground">{row.branch}</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-right">{pctAtt(row, t)}</td>
                    <td className="px-2 py-1.5 text-right">{pct(row.tasksAvailable, row.tasks)}</td>
                    <td className="px-2 py-1.5 text-right">{pct(row.checklistAvailable, row.checklist)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums dept-accent-value">
                      {row.attendanceAvailable ? `${row.kpiPercent}%` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatSom(row.fixedSalary)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.bonusPercent}%</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{formatSom(row.bonusAmount)}</td>
                    <td className="px-3 py-1.5 text-right font-bold tabular-nums">{formatSom(row.totalAmount)}</td>
                    <td className="px-2 py-1.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", row.status === "approved" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
                        {row.status === "approved" ? t("ui.approved") : t("ui.draft")}
                      </span>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="border-b bg-muted/80">
                      <td colSpan={11} className="px-3 py-3">
                        {canEditKpiSettings(userRole) ? (
                          <div className="mb-3 flex flex-wrap items-end gap-2">
                            <div>
                              <Label className="text-[11px]">{t("oylik.fixedSalary")} ({t("oylik.som")})</Label>
                              <MoneyInput
                                className="h-8 w-44 rounded-lg border border-border text-sm"
                                value={parseMoney(fix)}
                                onLive={(n) => {
                                  live.current.fix = n;
                                  setFix(formatMoney(n));
                                }}
                                onCommit={(n) => {
                                  live.current.fix = n;
                                  setFix(formatMoney(n));
                                  persist(row, n, live.current.bp);
                                }}
                              />
                            </div>
                            <div>
                              <Label className="text-[11px]">{t("oylik.bonusPercent")}</Label>
                              <MoneyInput
                                grouped={false}
                                className="h-8 w-24 rounded-lg border border-border text-sm"
                                value={parseMoney(bp)}
                                onLive={(n) => {
                                  live.current.bp = n;
                                  setBp(String(n));
                                }}
                                onCommit={(n) => {
                                  live.current.bp = n;
                                  setBp(String(n));
                                  persist(row, live.current.fix, n);
                                }}
                              />
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 rounded-lg"
                              onClick={() =>
                                saveSal.mutate(
                                  {
                                    userId: row.userId || 0,
                                    employeeId: row.employeeId,
                                    month,
                                    fixedSalary: live.current.fix,
                                    bonusPercent: live.current.bp,
                                  },
                                  { onSuccess: () => toast({ title: t("common.saved") }) },
                                )
                              }
                            >
                              {t("common.save")}
                            </Button>
                            {canApprovePayroll(userRole) && one.data?.status !== "approved" ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg"
                                disabled={approve.isPending}
                                onClick={() => {
                                  if (!row.userId) {
                                    toast({
                                      title: t("common.notSaved"),
                                      description: t("oylik.noLogin", "Bu xodimda login yo‘q"),
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  approve.mutate({ userId: row.userId, month }, { onSuccess: () => toast({ title: t("ui.approved") }) });
                                }}
                              >
                                {t("ui.approve")}
                              </Button>
                            ) : null}
                          </div>
                        ) : canApprovePayroll(userRole) && one.data?.status !== "approved" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mb-3 h-8 rounded-lg"
                            disabled={approve.isPending}
                                onClick={() => {
                                  if (!row.userId) {
                                    toast({
                                      title: t("common.notSaved"),
                                      description: t("oylik.noLogin", "Bu xodimda login yo‘q"),
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  approve.mutate({ userId: row.userId, month }, { onSuccess: () => toast({ title: t("ui.approved") }) });
                                }}
                          >
                            {t("ui.approve")}
                          </Button>
                        ) : null}
                        {one.isLoading && payrollRowKey(one.data ?? {}) !== rid ? (
                          <Skeleton className="h-32 rounded-xl" />
                        ) : payrollRowKey(one.data ?? {}) === rid ? (
                          <ReportCard data={one.data} detail={detail} setDetail={setDetail} />
                        ) : one.error ? (
                          <p className="text-sm text-rose-700">{(one.error as Error).message}</p>
                        ) : (
                          <Skeleton className="h-32 rounded-xl" />
                        )}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function OylikPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(currentMonthKey());
  const manage = canManagePayroll(user?.role);
  const [tab, setTab] = useState("team");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<"att" | "task" | "check" | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const me = useOylikMe(month);
  const list = useOylikEmployees(month, q, manage);
  const settings = useOylikSettings(manage);
  const saveW = useSaveOylikSettings();
  const saveSal = useSaveSalary();
  const saveBulk = useSaveSalaryBulk();
  const recalc = useRecalculateOylik();
  const approve = useApproveOylik();
  const toggleDay = useToggleWorkDay();
  const [wAtt, setWAtt] = useState<string>("");
  const [wTask, setWTask] = useState<string>("");
  const [wCheck, setWCheck] = useState<string>("");
  const [fix, setFix] = useState("");
  const [bp, setBp] = useState("");
  const [exporting, setExporting] = useState(false);
  const [posFilter, setPosFilter] = useState("");
  const [bulkFix, setBulkFix] = useState("");
  const [bulkBp, setBulkBp] = useState("");

  const positions = useMemo(() => {
    const set = new Set<string>();
    for (const r of list.data?.items ?? []) {
      const p = (r.position || "").trim();
      if (p) set.add(p);
    }
    return [...set].sort((a, b) => a.localeCompare(b, locale === "ru" ? "ru" : "uz"));
  }, [list.data?.items, locale]);

  const filteredRows = useMemo(() => {
    const items = list.data?.items ?? [];
    if (!posFilter) return items;
    return items.filter((r) => (r.position || "").trim() === posFilter);
  }, [list.data?.items, posFilter]);
  const openRow = filteredRows.find((r) => payrollRowKey(r) === openId) ?? null;
  const one = useOylikEmployee(openRow?.userId ?? null, month);

  React.useEffect(() => {
    if (!settings.data) return;
    setWAtt(String(settings.data.weights.attendance));
    setWTask(String(settings.data.weights.tasks));
    setWCheck(String(settings.data.weights.checklist));
  }, [settings.data]);

  React.useEffect(() => {
    if (!one.data) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && el.tagName === "INPUT" && el.closest("table")) return;
    setFix(formatMoney(one.data.fixedSalary));
    setBp(String(one.data.bonusPercent));
  }, [one.data]);

  return (
    <div className="dept-page">
      <div className="dept-hero dept-hero-primary">
        <div className="dept-hero-glow" />
        <div className="dept-hero-body flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="dept-eyebrow">{t("oylik.eyebrow", "KPI · fiks maosh")}</p>
            <h1 className="dept-title">{t("oylik.title")}</h1>
            <p className="dept-desc truncate">
              {user?.fullName} · {userRoleLabel(user?.role)} · KPI {t("oylik.attendance")} / {t("oylik.col.task")} / {t("oylik.col.checklist")}
            </p>
          </div>
          <MonthNav month={month} onChange={(m) => { setMonth(m); setOpenId(null); }} />
        </div>
      </div>

      <div className="dept-page-inner">

      {manage ? (
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-center gap-2">
            <TabsList className="h-9">
              <TabsTrigger value="team" className="h-8 px-3 text-xs sm:text-sm">
                <Users className="mr-1 h-3.5 w-3.5" /> {t("oylik.tab.employees")}
              </TabsTrigger>
              <TabsTrigger value="mine" className="h-8 px-3 text-xs sm:text-sm">{t("oylik.tab.mine")}</TabsTrigger>
              <TabsTrigger value="set" className="h-8 px-3 text-xs sm:text-sm">
                <Settings2 className="mr-1 h-3.5 w-3.5" /> {t("oylik.tab.weights")}
              </TabsTrigger>
            </TabsList>
            {tab === "team" ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ui.search")} className="h-9 max-w-xs rounded-lg" />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg"
                  disabled={recalc.isPending}
                  onClick={() => {
                    if (!window.confirm(t("oylik.recalcConfirm", "Shu oy uchun KPI qayta hisoblansinmi? (Fiks maosh o‘zgarmaydi)"))) return;
                    recalc.mutate(
                      { month },
                      {
                        onSuccess: (data) =>
                          toast({
                            title: t("ui.recalc"),
                            description: `${(data as { recalculated?: number })?.recalculated ?? 0} ${t("oylik.count")}`,
                          }),
                      },
                    );
                  }}
                >
                  <RefreshCw className={cn("mr-1 h-4 w-4", recalc.isPending && "animate-spin")} />
                  {t("ui.recalc")}
                </Button>
                {canApprovePayroll(user?.role) ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg"
                    disabled={approve.isPending}
                    onClick={() => {
                      if (posFilter) {
                        if (!window.confirm(`${t("oylik.approvePosConfirm")} «${posFilter}»`)) return;
                        approve.mutate(
                          { month, all: true, position: posFilter },
                          { onSuccess: () => toast({ title: t("ui.approved") }) },
                        );
                        return;
                      }
                      if (!window.confirm(t("oylik.approveAllConfirm", "Shu oydagi barcha xodimlar tasdiqlansinmi?"))) return;
                      approve.mutate({ month, all: true }, { onSuccess: () => toast({ title: t("ui.approved") }) });
                    }}
                  >
                    <Lock className={cn("mr-1 h-4 w-4", approve.isPending && "animate-spin")} />
                    {t("ui.approve")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  className="h-9 rounded-lg"
                  disabled={exporting}
                  onClick={async () => {
                    setExporting(true);
                    try {
                      await downloadOylikExcel(month);
                      toast({ title: t("ui.excel") });
                    } catch (e) {
                      toast({ title: t("ui.excel"), description: (e as Error).message, variant: "destructive" });
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  <Download className="mr-1 h-4 w-4" /> {t("ui.excel")}
                </Button>
                <select
                  className="h-9 max-w-[200px] rounded-lg border border-border bg-card px-2 text-sm"
                  value={posFilter}
                  onChange={(e) => setPosFilter(e.target.value)}
                >
                  <option value="">{t("ui.allPositions")}</option>
                  {positions.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                {canEditKpiSettings(user?.role) ? (
                  <>
                    <span className="text-xs text-muted-foreground">{t("oylik.col.fixed")}</span>
                    <MoneyInput
                      className="h-9 w-36 rounded-lg border border-border text-sm"
                      value={parseMoney(bulkFix)}
                      onLive={(n) => setBulkFix(formatMoney(n))}
                      onCommit={(n) => setBulkFix(formatMoney(n))}
                    />
                    <span className="text-xs text-muted-foreground">{t("oylik.col.bonusPct")}</span>
                    <MoneyInput
                      grouped={false}
                      className="h-9 w-24 rounded-lg border border-border text-sm"
                      value={parseMoney(bulkBp)}
                      onLive={(n) => setBulkBp(String(n))}
                      onCommit={(n) => setBulkBp(String(n))}
                    />
                    <Button
                      type="button"
                      className="h-9 rounded-lg"
                      disabled={saveBulk.isPending || !posFilter}
                      onClick={() => {
                        if (!posFilter) {
                          toast({ title: t("oylik.selectPosition", "Avval lavozim tanlang"), variant: "destructive" });
                          return;
                        }
                        saveBulk.mutate(
                          {
                            month,
                            position: posFilter,
                            fixedSalary: parseMoney(bulkFix),
                            bonusPercent: parseMoney(bulkBp),
                          },
                          { onSuccess: () => toast({ title: t("ui.writeToPosition") }) },
                        );
                      }}
                    >
                      {t("ui.writeToPosition")}
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          <TabsContent value="mine" className="mt-3">
            {me.isLoading ? <Skeleton className="h-64 rounded-xl" /> : me.data ? <ReportCard data={me.data} detail={detail} setDetail={setDetail} /> : me.error ? <p className="text-sm text-rose-700">{(me.error as Error).message}</p> : null}
          </TabsContent>
          <TabsContent value="team" className="mt-3">
            {list.isLoading ? (
              <Skeleton className="h-72 rounded-xl" />
            ) : list.error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{(list.error as Error).message}</p>
            ) : (
              <div className="space-y-3">
                <WorkCalendar
                  month={month}
                  workDays={list.data?.workDays ?? []}
                  canEdit={canEditKpiSettings(user?.role)}
                  pending={toggleDay.isPending}
                  onToggle={(day, isWork) => {
                    toggleDay.mutate(
                      { day, isWork },
                      {
                        onSuccess: () =>
                          toast({
                            title: isWork ? `${day} — ${t("ui.workDay")}` : `${day} — ${t("ui.dayOff")}`,
                          }),
                        onError: (e) =>
                          toast({ title: t("ui.workDaysCalendar"), description: (e as Error).message, variant: "destructive" }),
                      },
                    );
                  }}
                />
                <TeamTable
                rows={filteredRows}
                openId={openId}
                setOpenId={setOpenId}
                one={one}
                fix={fix}
                setFix={setFix}
                bp={bp}
                setBp={setBp}
                detail={detail}
                setDetail={setDetail}
                userRole={user?.role}
                month={month}
                saveSal={saveSal}
                approve={approve}
                toast={toast}
              />
              </div>
            )}
          </TabsContent>
          <TabsContent value="set" className="mt-3">
            <div className="max-w-xl dept-form">
              <p className="text-sm font-semibold">{t("oylik.weightsTitle", "KPI og‘irliklari")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("oylik.weightsHint", "Yo‘q komponent avtomatik chiqariladi, qolganlari proporsional oshadi.")}</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[11px]">{t("oylik.attendance")} %</Label>
                  <Input className="h-9 rounded-lg" value={wAtt} onChange={(e) => setWAtt(e.target.value)} disabled={!canEditKpiSettings(user?.role)} />
                </div>
                <div>
                  <Label className="text-[11px]">{t("oylik.col.task")} %</Label>
                  <Input className="h-9 rounded-lg" value={wTask} onChange={(e) => setWTask(e.target.value)} disabled={!canEditKpiSettings(user?.role)} />
                </div>
                <div>
                  <Label className="text-[11px]">{t("oylik.col.checklist")} %</Label>
                  <Input className="h-9 rounded-lg" value={wCheck} onChange={(e) => setWCheck(e.target.value)} disabled={!canEditKpiSettings(user?.role)} />
                </div>
              </div>
              {canEditKpiSettings(user?.role) ? (
                <Button type="button" className="mt-3 h-9 rounded-lg" disabled={saveW.isPending} onClick={() => saveW.mutate({ attendance: Number(wAtt), tasks: Number(wTask), checklist: Number(wCheck) }, { onSuccess: () => toast({ title: t("common.saved") }) })}>
                  {t("common.save")}
                </Button>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">{t("oylik.weightsLocked", "O‘zgartirish: admin, HR direktor, direktor, moliyachi")}</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      ) : me.isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : me.data ? (
        <ReportCard data={me.data} detail={detail} setDetail={setDetail} />
      ) : me.error ? (
        <p className="text-sm text-rose-700">{(me.error as Error).message}</p>
      ) : null}
      </div>
    </div>
  );
}
