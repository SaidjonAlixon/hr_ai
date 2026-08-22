import React, { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Settings2,
  Users,
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
  downloadOylikExcel,
  type PayrollReport,
  type PayrollRow,
} from "@/lib/oylik-api";

function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-white/10 p-0.5">
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/15 hover:text-white" onClick={() => onChange(shiftMonthKey(month, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[118px] px-1 text-center text-[13px] font-semibold">{monthLabelUz(month)}</span>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/15 hover:text-white" onClick={() => onChange(shiftMonthKey(month, 1))} disabled={month >= currentMonthKey()}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function pct(available: boolean, value: number) {
  if (!available) return <span className="text-slate-400">—</span>;
  return <span className="tabular-nums">{value}%</span>;
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
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50">
      <span className="text-sm font-medium text-slate-800">{name}</span>
      <span className="tabular-nums text-sm">
        {available ? `${percent}%` : "hisobdan tashqari"}
        <span className="ml-2 text-xs text-slate-400">{available ? `${weight}%` : "—"}</span>
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
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl border bg-white p-3 shadow-sm lg:col-span-1">
        <p className="text-xs text-slate-500">
          {data.fullName} · {data.position || data.roleLabel}
          {data.branch ? ` · ${data.branch}` : ""}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-[11px] text-slate-500">Fiks maosh</p>
            <p className="text-sm font-bold text-[#0b3a5c]">{formatSom(data.fixedSalary)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-[11px] text-slate-500">Bonus foizi</p>
            <p className="text-sm font-bold">{data.bonusPercent}%</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">KPI asosidagi bonus</p>
        <p className="text-lg font-bold text-emerald-700">{formatSom(data.bonusAmount)}</p>
        <p className="mt-1 text-[11px] text-slate-500">Jami = fiks + bonus</p>
        <p className="text-xl font-bold tabular-nums text-[#0b3a5c]">{formatSom(data.totalAmount)}</p>
        <Badge className="mt-2" variant={data.status === "approved" ? "default" : "outline"}>
          {data.status === "approved" ? "Tasdiqlangan" : "Qoralama"}
        </Badge>
      </div>

      <div className="rounded-xl border bg-white p-3 shadow-sm lg:col-span-2">
        <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">KPI (bosing — batafsil)</p>
        <KpiRow
          name="Davomat"
          percent={data.attendance?.percent ?? 0}
          weight={data.attendance?.effectiveWeight ?? 0}
          available={Boolean(data.attendance?.available)}
          onOpen={() => setDetail(detail === "att" ? null : "att")}
        />
        <KpiRow
          name="Topshiriqlar"
          percent={data.tasks?.percent ?? 0}
          weight={data.tasks?.effectiveWeight ?? 0}
          available={Boolean(data.tasks?.available)}
          onOpen={() => setDetail(detail === "task" ? null : "task")}
        />
        <KpiRow
          name="Checklist"
          percent={data.checklist?.percent ?? 0}
          weight={data.checklist?.effectiveWeight ?? 0}
          available={Boolean(data.checklist?.available)}
          onOpen={() => setDetail(detail === "check" ? null : "check")}
        />
        <div className="mt-1 flex items-center justify-between border-t px-2 pt-2">
          <span className="text-sm font-semibold">Umumiy KPI</span>
          <span className="text-base font-bold tabular-nums text-[#0b3a5c]">{data.kpiPercent}%</span>
        </div>
        {detail === "att" ? (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border bg-slate-50 p-2 text-xs">
            <p className="mb-1 font-semibold">Davomat: {data.attendance?.points ?? 0} ball / {data.attendance?.countedDays ?? 0} kun</p>
            {(data.attendance?.days ?? []).map((d) => (
              <p key={d.date} className="flex justify-between gap-2 py-0.5">
                <span>{d.date}</span>
                <span>{d.counted ? `${d.points} · ${d.note}` : d.note}</span>
              </p>
            ))}
          </div>
        ) : null}
        {detail === "task" ? (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border bg-slate-50 p-2 text-xs">
            <p className="mb-1 font-semibold">Topshiriq: {data.tasks?.points ?? 0} / {data.tasks?.total ?? 0}</p>
            {(data.tasks?.items ?? []).map((t) => (
              <p key={t.id} className="py-0.5">{t.title} — {t.label} ({t.points})</p>
            ))}
            {!data.tasks?.items?.length ? <p className="text-slate-500">Bu oyda topshiriq yo‘q — KPI dan chiqarilgan.</p> : null}
          </div>
        ) : null}
        {detail === "check" ? (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border bg-slate-50 p-2 text-xs">
            {(data.checklist?.items ?? []).map((c) => (
              <p key={c.id} className="py-0.5">{c.visitDate} · {c.visitName}: {c.percent}% ({c.yesCount}/{c.totalCount})</p>
            ))}
            {!data.checklist?.items?.length ? <p className="text-slate-500">Bu oyda checklist yo‘q — KPI dan chiqarilgan.</p> : null}
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
      <div className="rounded-xl border bg-white px-4 py-10 text-center text-sm text-slate-500">
        Bu oy uchun xodim topilmadi. Qidiruvni tozalang yoki API qayta ishga tushganini tekshiring.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="grid grid-cols-2 gap-px border-b bg-slate-100 sm:grid-cols-4">
        <div className="bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Xodim</p>
          <p className="text-sm font-bold tabular-nums text-[#0b3a5c]">{rows.length} ta</p>
        </div>
        <div className="bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Jami fiks</p>
          <p className="text-sm font-bold tabular-nums">{formatSom(totals.fix)}</p>
        </div>
        <div className="bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Jami bonus</p>
          <p className="text-sm font-bold tabular-nums text-emerald-700">{formatSom(totals.bonus)}</p>
        </div>
        <div className="bg-white px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Jami oylik</p>
          <p className="text-sm font-bold tabular-nums text-[#0b3a5c]">{formatSom(totals.total)}</p>
        </div>
      </div>
      <div className="max-h-[min(70vh,720px)] overflow-auto">
        <table className="w-full min-w-[1080px] border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-[#0b3a5c] text-white">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold">Xodim</th>
              <th className="px-2 py-2 font-semibold">Lavozim / filial</th>
              <th className="px-2 py-2 text-right font-semibold">Davomat</th>
              <th className="px-2 py-2 text-right font-semibold">Topshiriq</th>
              <th className="px-2 py-2 text-right font-semibold">Checklist</th>
              <th className="px-2 py-2 text-right font-semibold">KPI</th>
              <th className="px-2 py-2 text-right font-semibold">Fiks</th>
              <th className="px-2 py-2 text-right font-semibold">Bonus %</th>
              <th className="px-2 py-2 text-right font-semibold">Bonus</th>
              <th className="px-3 py-2 text-right font-semibold">Jami</th>
              <th className="px-2 py-2 font-semibold">Holat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const open = openId === row.userId;
              return (
                <React.Fragment key={row.userId}>
                  <tr
                    className={cn("cursor-pointer border-b border-slate-100 hover:bg-slate-50", open && "bg-sky-50/70")}
                    onClick={() => setOpenId(open ? null : row.userId)}
                  >
                    <td className="px-3 py-1.5">
                      <p className="font-semibold text-slate-900">{row.fullName}</p>
                      <p className="text-[11px] text-slate-500">{row.roleLabel}</p>
                    </td>
                    <td className="max-w-[180px] truncate px-2 py-1.5 text-slate-600">
                      {row.position || "—"}
                      {row.branch ? <span className="block truncate text-[11px] text-slate-400">{row.branch}</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-right">{pct(row.attendanceAvailable, row.attendance)}</td>
                    <td className="px-2 py-1.5 text-right">{pct(row.tasksAvailable, row.tasks)}</td>
                    <td className="px-2 py-1.5 text-right">{pct(row.checklistAvailable, row.checklist)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-[#0b3a5c]">{row.kpiPercent}%</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatSom(row.fixedSalary)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.bonusPercent}%</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{formatSom(row.bonusAmount)}</td>
                    <td className="px-3 py-1.5 text-right font-bold tabular-nums">{formatSom(row.totalAmount)}</td>
                    <td className="px-2 py-1.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", row.status === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600")}>
                        {row.status === "approved" ? "Tasdiq" : "Qoralama"}
                      </span>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="border-b bg-slate-50/80">
                      <td colSpan={11} className="px-3 py-3">
                        {canEditKpiSettings(userRole) ? (
                          <div className="mb-3 flex flex-wrap items-end gap-2">
                            <div>
                              <Label className="text-[11px]">Fiks maosh (so‘m)</Label>
                              <Input className="h-8 w-40 rounded-lg text-sm" value={fix} onChange={(e) => setFix(e.target.value)} />
                            </div>
                            <div>
                              <Label className="text-[11px]">Bonus foizi</Label>
                              <Input className="h-8 w-24 rounded-lg text-sm" value={bp} onChange={(e) => setBp(e.target.value)} />
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 rounded-lg bg-[#0b3a5c]"
                              disabled={saveSal.isPending}
                              onClick={() =>
                                saveSal.mutate(
                                  { userId: row.userId, month, fixedSalary: Number(fix), bonusPercent: Number(bp) },
                                  { onSuccess: () => toast({ title: "Saqlandi" }) },
                                )
                              }
                            >
                              Saqlash
                            </Button>
                            {canApprovePayroll(userRole) && one.data?.status !== "approved" ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg"
                                disabled={approve.isPending}
                                onClick={() => approve.mutate({ userId: row.userId, month }, { onSuccess: () => toast({ title: "Tasdiqlandi" }) })}
                              >
                                Tasdiqlash
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
                            onClick={() => approve.mutate({ userId: row.userId, month }, { onSuccess: () => toast({ title: "Tasdiqlandi" }) })}
                          >
                            Tasdiqlash
                          </Button>
                        ) : null}
                        {one.isLoading && one.data?.userId !== row.userId ? (
                          <Skeleton className="h-32 rounded-xl" />
                        ) : one.data?.userId === row.userId ? (
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
  const [month, setMonth] = useState(currentMonthKey());
  const manage = canManagePayroll(user?.role);
  const [tab, setTab] = useState("team");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<"att" | "task" | "check" | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const me = useOylikMe(month);
  const list = useOylikEmployees(month, q, manage);
  const one = useOylikEmployee(openId, month);
  const settings = useOylikSettings(manage);
  const saveW = useSaveOylikSettings();
  const saveSal = useSaveSalary();
  const recalc = useRecalculateOylik();
  const approve = useApproveOylik();
  const [wAtt, setWAtt] = useState<string>("");
  const [wTask, setWTask] = useState<string>("");
  const [wCheck, setWCheck] = useState<string>("");
  const [fix, setFix] = useState("");
  const [bp, setBp] = useState("");
  const [exporting, setExporting] = useState(false);

  React.useEffect(() => {
    if (!settings.data) return;
    setWAtt(String(settings.data.weights.attendance));
    setWTask(String(settings.data.weights.tasks));
    setWCheck(String(settings.data.weights.checklist));
  }, [settings.data]);

  React.useEffect(() => {
    if (!one.data) return;
    setFix(String(one.data.fixedSalary));
    setBp(String(one.data.bonusPercent));
  }, [one.data]);

  return (
    <div className="space-y-3 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#0b3a5c] px-4 py-3 text-white shadow">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight sm:text-xl">Oylik · Fiks maosh + bonus</h1>
          <p className="truncate text-xs text-white/70">
            {user?.fullName} · {userRoleLabel(user?.role)} · KPI davomat / topshiriq / checklist
          </p>
        </div>
        <MonthNav month={month} onChange={(m) => { setMonth(m); setOpenId(null); }} />
      </div>

      {manage ? (
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-center gap-2">
            <TabsList className="h-9">
              <TabsTrigger value="team" className="h-8 px-3 text-xs sm:text-sm">
                <Users className="mr-1 h-3.5 w-3.5" /> Xodimlar
              </TabsTrigger>
              <TabsTrigger value="mine" className="h-8 px-3 text-xs sm:text-sm">Mening</TabsTrigger>
              <TabsTrigger value="set" className="h-8 px-3 text-xs sm:text-sm">
                <Settings2 className="mr-1 h-3.5 w-3.5" /> Og‘irlik
              </TabsTrigger>
            </TabsList>
            {tab === "team" ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidiruv…" className="h-9 max-w-xs rounded-lg" />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg"
                  disabled={recalc.isPending}
                  onClick={() => recalc.mutate({ month }, { onSuccess: () => toast({ title: "Qayta hisoblandi" }) })}
                >
                  <RefreshCw className={cn("mr-1 h-4 w-4", recalc.isPending && "animate-spin")} />
                  Qayta hisoblash
                </Button>
                <Button
                  type="button"
                  className="h-9 rounded-lg bg-[#0b3a5c]"
                  disabled={exporting}
                  onClick={async () => {
                    setExporting(true);
                    try {
                      await downloadOylikExcel(month);
                      toast({ title: "Excel yuklandi" });
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
              <TeamTable
                rows={list.data?.items ?? []}
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
            )}
          </TabsContent>
          <TabsContent value="set" className="mt-3">
            <div className="max-w-xl rounded-xl border bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold">KPI og‘irliklari</p>
              <p className="mt-1 text-xs text-slate-500">Yo‘q komponent avtomatik chiqariladi, qolganlari proporsional oshadi.</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[11px]">Davomat %</Label>
                  <Input className="h-9 rounded-lg" value={wAtt} onChange={(e) => setWAtt(e.target.value)} disabled={!canEditKpiSettings(user?.role)} />
                </div>
                <div>
                  <Label className="text-[11px]">Topshiriq %</Label>
                  <Input className="h-9 rounded-lg" value={wTask} onChange={(e) => setWTask(e.target.value)} disabled={!canEditKpiSettings(user?.role)} />
                </div>
                <div>
                  <Label className="text-[11px]">Checklist %</Label>
                  <Input className="h-9 rounded-lg" value={wCheck} onChange={(e) => setWCheck(e.target.value)} disabled={!canEditKpiSettings(user?.role)} />
                </div>
              </div>
              {canEditKpiSettings(user?.role) ? (
                <Button type="button" className="mt-3 h-9 rounded-lg bg-[#0b3a5c]" disabled={saveW.isPending} onClick={() => saveW.mutate({ attendance: Number(wAtt), tasks: Number(wTask), checklist: Number(wCheck) }, { onSuccess: () => toast({ title: "Og‘irliklar saqlandi" }) })}>
                  Saqlash
                </Button>
              ) : (
                <p className="mt-2 text-xs text-slate-500">O‘zgartirish: admin, HR direktor, direktor, moliyachi</p>
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
  );
}
