import React, { useMemo, useState } from "react";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Search,
  Plus,
  ChevronRight,
  Banknote,
  RefreshCw,
  Play,
  Flag,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  canAssignReviziya,
  canCreateReviziyaVisit,
  canViewAllReviziyaBranches,
  isReviziyaRole,
} from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import {
  useReviziyaBranches,
  useReviziyaBranchDetail,
  useReviziyaCalendar,
  useReviziyaMyTasks,
  useReviziyaRevizors,
  useReviziyaVisitMutations,
  useReviziyaVisitsDashboard,
  useReviziyaVisitsMeta,
} from "@/lib/reviziya-api";
import { CYCLE_STATUS_TONE, formatYmd, moneySoum, WORKFLOW_STATUS_LABEL } from "@/lib/reviziya-cycle";

type SubTab = "branches" | "tasks" | "calendar" | "create";

/** UI preview — server yakunda unique qilib saqlaydi */
function newActNumberPreview(): string {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" }).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AKT-${ymd}-${rand}`;
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-3 sm:p-4", tone)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">{value}</div>
    </div>
  );
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge variant="secondary" className={cn("font-medium", CYCLE_STATUS_TONE[status] || "bg-muted")}>
      {label || status}
    </Badge>
  );
}

export function ReviziyaCyclePanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role;
  const viewAll = canViewAllReviziyaBranches(role);
  const canCreate = canCreateReviziyaVisit(role);
  const canAssign = canAssignReviziya(role);
  const isRevizorOnly = isReviziyaRole(role) && !viewAll;

  const [sub, setSub] = useState<SubTab>(isRevizorOnly ? "tasks" : "branches");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [completeVisitId, setCompleteVisitId] = useState<number | null>(null);

  const meta = useReviziyaVisitsMeta();
  const dash = useReviziyaVisitsDashboard({ q, status: status || undefined, limit: 80 });
  const tasks = useReviziyaMyTasks();
  const branchDetail = useReviziyaBranchDetail(selectedBranchId);
  const branches = useReviziyaBranches();
  const revizors = useReviziyaRevizors();
  const mut = useReviziyaVisitMutations();

  const calMonth = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const from = `${y}-${m}-01`;
    const last = new Date(y, d.getMonth() + 1, 0).getDate();
    const to = `${y}-${m}-${String(last).padStart(2, "0")}`;
    return { from, to, label: `${m}.${y}` };
  }, []);
  const calendar = useReviziyaCalendar(calMonth.from, calMonth.to);

  const [form, setForm] = useState({
    branchId: "",
    revisionDate: new Date().toISOString().slice(0, 10),
    scheduledStartTime: "10:00",
    scheduledEndTime: "12:00",
    assignedEmployeeId: "",
    shortageAmount: "",
    excessAmount: "",
    collectedAmount: "",
    notes: "",
    actNumber: newActNumberPreview(),
    actUrl: "",
    receiptUrl: "",
    responsibleName: "",
    completeImmediately: false,
  });

  const [completeForm, setCompleteForm] = useState({
    shortageAmount: "",
    excessAmount: "",
    collectedAmount: "",
    notes: "",
    actNumber: newActNumberPreview(),
    actUrl: "",
    receiptUrl: "",
  });

  const stats = dash.data?.stats;
  const perms = meta.data?.permissions;

  const onCreate = async () => {
    try {
      await mut.create.mutateAsync({
        branchId: Number(form.branchId),
        revisionDate: form.revisionDate,
        scheduledStartTime: form.scheduledStartTime,
        scheduledEndTime: form.scheduledEndTime,
        assignedEmployeeId: form.assignedEmployeeId ? Number(form.assignedEmployeeId) : null,
        shortageAmount: form.shortageAmount || 0,
        excessAmount: form.excessAmount || 0,
        collectedAmount: form.collectedAmount || 0,
        notes: form.notes || null,
        actNumber: form.actNumber || null,
        actUrl: form.actUrl || null,
        receiptUrl: form.receiptUrl || null,
        responsibleName: form.responsibleName || null,
        completeImmediately: form.completeImmediately,
      });
      toast({ title: "Reviziya saqlandi" });
      setSub("branches");
      setForm((f) => ({
        ...f,
        shortageAmount: "",
        collectedAmount: "",
        notes: "",
        actNumber: newActNumberPreview(),
        actUrl: "",
        receiptUrl: "",
      }));
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  const runAction = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast({ title: ok });
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "branches" as const, label: viewAll ? "Filiallar holati" : "Mening filiallarm", icon: Building2 },
            { id: "tasks" as const, label: "Bugungi / vazifalar", icon: Flag },
            { id: "calendar" as const, label: "Kalendar", icon: CalendarDays },
            ...(canCreate || perms?.create
              ? [{ id: "create" as const, label: "Reviziya qo‘shish", icon: Plus }]
              : []),
          ] as const
        ).map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={sub === t.id ? "default" : "outline"}
            onClick={() => {
              if (t.id === "create") {
                setForm((f) => ({ ...f, actNumber: f.actNumber || newActNumberPreview() }));
              }
              setSub(t.id);
            }}
            className="gap-1.5"
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </Button>
        ))}
      </div>

      {sub === "branches" && (
        <>
          {dash.isLoading ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : dash.isError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
              {(dash.error as Error)?.message || "Yuklashda xato"}
              <Button size="sm" variant="outline" className="ml-3" onClick={() => dash.refetch()}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Qayta
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
                <StatCard label="Jami filiallar" value={stats?.totalBranches ?? 0} />
                <StatCard label="Rejadagidek" value={stats?.completedOk ?? 0} tone="border-emerald-200" />
                <StatCard label="Tez orada" value={stats?.tezOrada ?? 0} tone="border-amber-200" />
                <StatCard label="Muddati o‘tgan" value={stats?.muddatiOtgan ?? 0} tone="border-rose-200" />
                <StatCard label="Sikl o‘tkazilgan" value={stats?.siklOtkazilgan ?? 0} tone="border-fuchsia-200" />
                <StatCard label="Yangi ochilgan" value={stats?.yangiOchilgan ?? 0} tone="border-sky-200" />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <StatCard label="Jami kamomad" value={moneySoum(stats?.totalShortage ?? 0)} />
                <StatCard label="Jami undirilgan" value={moneySoum(stats?.totalCollected ?? 0)} />
                <StatCard label="Jami qolgan" value={moneySoum(stats?.totalRemaining ?? 0)} />
              </div>
            </>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Filial, mudir, revizor..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Barcha statuslar</option>
              {(meta.data?.cycleStatuses || []).map((s: { value: string; label: string }) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {!dash.data?.branches?.length && !dash.isLoading ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Reviziya ma’lumotlari topilmadi
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto rounded-xl border md:block">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="w-10 px-3 py-2 font-medium">№</th>
                      <th className="px-3 py-2 font-medium">Filial</th>
                      <th className="px-3 py-2 font-medium">Koordinator</th>
                      <th className="px-3 py-2 font-medium">Mudir</th>
                      <th className="px-3 py-2 font-medium">Oxirgi</th>
                      <th className="px-3 py-2 font-medium">Keyingi</th>
                      <th className="px-3 py-2 font-medium">Kun</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Kamomad</th>
                      <th className="px-3 py-2 font-medium">Revizor</th>
                      <th className="px-3 py-2 font-medium">Harakat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(dash.data?.branches || []).map((b, i) => (
                      <tr
                        key={b.branchId}
                        className="cursor-pointer border-t hover:bg-muted/40"
                        onClick={() => setSelectedBranchId(b.branchId)}
                      >
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2.5 font-medium">
                          {displayBranchName(b.branchName) || b.branchName || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{b.region || "—"}</td>
                        <td className="px-3 py-2.5">{b.mudirName}</td>
                        <td className="px-3 py-2.5 tabular-nums">{formatYmd(b.lastRevisionDate)}</td>
                        <td className="px-3 py-2.5 tabular-nums">{formatYmd(b.nextRevisionDate)}</td>
                        <td className="px-3 py-2.5 tabular-nums">
                          {b.daysLeft == null ? "—" : b.daysLeft}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={b.cycleStatus} label={b.cycleStatusLabel} />
                        </td>
                        <td className="px-3 py-2.5 tabular-nums">{moneySoum(b.shortageAmount)}</td>
                        <td className="px-3 py-2.5">{b.assignedRevizorName || "—"}</td>
                        <td className="px-3 py-2.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBranchId(b.branchId);
                            }}
                          >
                            Ko‘rish <ChevronRight className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-2 md:hidden">
                {(dash.data?.branches || []).map((b, i) => (
                  <button
                    key={b.branchId}
                    type="button"
                    className="rounded-xl border bg-card p-3 text-left"
                    onClick={() => setSelectedBranchId(b.branchId)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">
                        <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                        {displayBranchName(b.branchName) || b.branchName || "—"}
                      </div>
                      <StatusBadge status={b.cycleStatus} label={b.cycleStatusLabel} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Koordinator: {b.region || "—"} · {b.mudirName}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                      <span>Keyingi: {formatYmd(b.nextRevisionDate)}</span>
                      <span>Kamomad: {moneySoum(b.shortageAmount)}</span>
                      <span>Undirilgan: {moneySoum(b.collectedAmount)}</span>
                      <span>Revizor: {b.assignedRevizorName || "—"}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {sub === "tasks" && (
        <div className="space-y-4">
          {tasks.isLoading ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : (
            <>
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Clock className="h-4 w-4" /> Bugun ({tasks.data?.todayYmd})
                </h3>
                {!tasks.data?.today?.length ? (
                  <p className="text-sm text-muted-foreground">Bugungi reviziya yo‘q</p>
                ) : (
                  <div className="grid gap-2">
                    {tasks.data.today.map((v: any) => (
                      <TaskCard
                        key={v.id}
                        visit={v}
                        canAssign={!!canAssign || !!perms?.assign}
                        onAccept={() => runAction(() => mut.accept.mutateAsync(v.id), "Qabul qilindi")}
                        onStart={() => runAction(() => mut.start.mutateAsync(v.id), "Reviziya boshlandi")}
                        onComplete={() => {
                          setCompleteVisitId(v.id);
                          setCompleteForm({
                            shortageAmount: String(v.shortageAmount || ""),
                            excessAmount: String(v.excessAmount || ""),
                            collectedAmount: String(v.collectedAmount || ""),
                            notes: v.notes || "",
                            actNumber: v.actNumber || newActNumberPreview(),
                            actUrl: v.actUrl || "",
                            receiptUrl: v.receiptUrl || "",
                          });
                        }}
                        onOpenBranch={() => setSelectedBranchId(v.branchId)}
                      />
                    ))}
                  </div>
                )}
              </section>
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <CalendarDays className="h-4 w-4" /> Kelajakda
                </h3>
                {!tasks.data?.upcoming?.length ? (
                  <p className="text-sm text-muted-foreground">Rejalashtirilgan reviziya yo‘q</p>
                ) : (
                  <div className="grid gap-2">
                    {tasks.data.upcoming.map((v: any) => (
                      <TaskCard
                        key={v.id}
                        visit={v}
                        canAssign={!!canAssign || !!perms?.assign}
                        onAccept={() => runAction(() => mut.accept.mutateAsync(v.id), "Qabul qilindi")}
                        onStart={() => runAction(() => mut.start.mutateAsync(v.id), "Reviziya boshlandi")}
                        onComplete={() => {
                          setCompleteVisitId(v.id);
                          setCompleteForm({
                            shortageAmount: String(v.shortageAmount || ""),
                            excessAmount: String(v.excessAmount || ""),
                            collectedAmount: String(v.collectedAmount || ""),
                            notes: v.notes || "",
                            actNumber: v.actNumber || newActNumberPreview(),
                            actUrl: v.actUrl || "",
                            receiptUrl: v.receiptUrl || "",
                          });
                        }}
                        onOpenBranch={() => setSelectedBranchId(v.branchId)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {sub === "calendar" && (
        <div className="rounded-xl border p-4">
          <div className="mb-3 text-sm font-semibold">Kalendar · {calMonth.label}</div>
          {calendar.isLoading ? (
            <Skeleton className="h-32" />
          ) : !calendar.data?.events?.length ? (
            <p className="text-sm text-muted-foreground">Bu oyda reviziya yo‘q</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(
                (calendar.data.events as any[]).reduce((acc: Record<string, any[]>, e) => {
                  const d = e.date || "—";
                  (acc[d] ||= []).push(e);
                  return acc;
                }, {} as Record<string, any[]>),
              ).map(([date, events]) => (
                <div key={date} className="rounded-lg border p-3">
                  <div className="mb-1 text-sm font-medium">
                    {formatYmd(date)} · {(events as any[]).length} ta
                  </div>
                  <ul className="space-y-1 text-sm">
                    {(events as any[]).map((e: any) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {displayBranchName(e.branchName) || e.branchName}
                        </span>
                        <span>{e.startTime || "—"}</span>
                        <span>{e.revizorName || "Revizor yo‘q"}</span>
                        <Badge variant="outline">{WORKFLOW_STATUS_LABEL[e.workflowStatus] || e.workflowStatus}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedBranchId(e.branchId)}>
                          Ochish
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {sub === "create" && (canCreate || perms?.create) && (
        <div className="mx-auto max-w-2xl space-y-3 rounded-xl border p-4">
          <h3 className="font-semibold">Reviziya qo‘shish</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Filial</Label>
              <select
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              >
                <option value="">Tanlang</option>
                {(branches.data || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {displayBranchName(b.branchName) || b.branchName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Reviziya sanasi</Label>
              <Input
                type="date"
                className="mt-1"
                value={form.revisionDate}
                onChange={(e) => setForm({ ...form, revisionDate: e.target.value })}
              />
            </div>
            <div>
              <Label>Revizor</Label>
              <select
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.assignedEmployeeId}
                onChange={(e) => setForm({ ...form, assignedEmployeeId: e.target.value })}
              >
                <option value="">Tanlanmagan</option>
                {(revizors.data || []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Boshlanish</Label>
              <Input
                type="time"
                className="mt-1"
                value={form.scheduledStartTime}
                onChange={(e) => setForm({ ...form, scheduledStartTime: e.target.value })}
              />
            </div>
            <div>
              <Label>Tugash</Label>
              <Input
                type="time"
                className="mt-1"
                value={form.scheduledEndTime}
                onChange={(e) => setForm({ ...form, scheduledEndTime: e.target.value })}
              />
            </div>
            <div>
              <Label>Kamomad</Label>
              <Input
                className="mt-1"
                inputMode="numeric"
                value={form.shortageAmount}
                onChange={(e) => setForm({ ...form, shortageAmount: e.target.value })}
              />
            </div>
            <div>
              <Label>Ortiqcha</Label>
              <Input
                className="mt-1"
                inputMode="numeric"
                value={form.excessAmount}
                onChange={(e) => setForm({ ...form, excessAmount: e.target.value })}
              />
            </div>
            <div>
              <Label>Undirilgan</Label>
              <Input
                className="mt-1"
                inputMode="numeric"
                value={form.collectedAmount}
                onChange={(e) => setForm({ ...form, collectedAmount: e.target.value })}
              />
            </div>
            <div>
              <Label>Akt raqami</Label>
              <div className="mt-1 flex gap-2">
                <Input className="font-mono" readOnly value={form.actNumber} />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Yangi raqam"
                  onClick={() => setForm({ ...form, actNumber: newActNumberPreview() })}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Avto · random · takrorlanmas</p>
            </div>
            <div className="sm:col-span-2">
              <Label>Mas’ul / Izoh</Label>
              <Input
                className="mt-1"
                placeholder="Mas’ul shaxs"
                value={form.responsibleName}
                onChange={(e) => setForm({ ...form, responsibleName: e.target.value })}
              />
              <Input
                className="mt-2"
                placeholder="Izoh"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.completeImmediately}
                onChange={(e) => setForm({ ...form, completeImmediately: e.target.checked })}
              />
              Darhol yakunlangan deb saqlash (natija + keyingi sana hisoblanadi)
            </label>
          </div>
          <Button disabled={!form.branchId || mut.create.isPending} onClick={onCreate}>
            Saqlash
          </Button>
        </div>
      )}

      <Sheet open={!!selectedBranchId} onOpenChange={(o) => !o && setSelectedBranchId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {displayBranchName(branchDetail.data?.branch?.branchName) ||
                branchDetail.data?.branch?.branchName ||
                "Filial"}
            </SheetTitle>
            <SheetDescription>
              Mudir: {branchDetail.data?.branch?.mudirName || "—"} · Koordinator:{" "}
              {branchDetail.data?.branch?.region || "—"}
            </SheetDescription>
          </SheetHeader>
          {branchDetail.isLoading ? (
            <Skeleton className="mt-4 h-40" />
          ) : branchDetail.data ? (
            <BranchDetailBody
              data={branchDetail.data}
              canAssign={!!canAssign || !!perms?.assign}
              revizors={revizors.data || []}
              onAssign={async (visitId, assignedEmployeeId) => {
                await runAction(
                  () => mut.assign.mutateAsync({ id: visitId, assignedEmployeeId }),
                  "Biriktirildi",
                );
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={!!completeVisitId} onOpenChange={(o) => !o && setCompleteVisitId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Reviziyani yakunlash</SheetTitle>
            <SheetDescription>Vaqt serverdan yoziladi. Qolgan summa avtomatik.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {(
              [
                ["shortageAmount", "Kamomad"],
                ["excessAmount", "Ortiqcha"],
                ["collectedAmount", "Undirilgan"],
                ["notes", "Izoh"],
              ] as const
            ).map(([k, label]) => (
              <div key={k}>
                <Label>{label}</Label>
                <Input
                  className="mt-1"
                  value={(completeForm as any)[k]}
                  onChange={(e) => setCompleteForm({ ...completeForm, [k]: e.target.value })}
                />
              </div>
            ))}
            <div>
              <Label>Akt raqami</Label>
              <div className="mt-1 flex gap-2">
                <Input className="font-mono" readOnly value={completeForm.actNumber} />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Yangi raqam"
                  onClick={() => setCompleteForm({ ...completeForm, actNumber: newActNumberPreview() })}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Button
              disabled={mut.complete.isPending}
              onClick={() =>
                runAction(async () => {
                  await mut.complete.mutateAsync({
                    id: completeVisitId!,
                    shortageAmount: completeForm.shortageAmount || 0,
                    excessAmount: completeForm.excessAmount || 0,
                    collectedAmount: completeForm.collectedAmount || 0,
                    notes: completeForm.notes,
                    actNumber: completeForm.actNumber,
                    actUrl: completeForm.actUrl,
                    receiptUrl: completeForm.receiptUrl,
                  });
                  setCompleteVisitId(null);
                }, "Yakunlandi")
              }
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Yakunlash
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TaskCard({
  visit,
  onAccept,
  onStart,
  onComplete,
  onOpenBranch,
}: {
  visit: any;
  canAssign: boolean;
  onAccept: () => void;
  onStart: () => void;
  onComplete: () => void;
  onOpenBranch: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <button type="button" className="font-medium hover:underline" onClick={onOpenBranch}>
            {displayBranchName(visit.branchName) || visit.branchName}
          </button>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {formatYmd(visit.revisionDate || visit.scheduledDate)} · {visit.scheduledStartTime || "—"} ·{" "}
            {WORKFLOW_STATUS_LABEL[visit.workflowStatus] || visit.workflowStatus}
            {visit.priority && visit.priority !== "normal" ? ` · ${visit.priority}` : ""}
          </div>
          {visit.notes ? <p className="mt-1 text-xs text-muted-foreground">{visit.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {visit.workflowStatus === "ASSIGNED" && (
            <Button size="sm" variant="outline" onClick={onAccept}>
              Qabul
            </Button>
          )}
          {["ASSIGNED", "ACCEPTED"].includes(visit.workflowStatus) && (
            <Button size="sm" onClick={onStart}>
              <Play className="mr-1 h-3.5 w-3.5" /> Boshlash
            </Button>
          )}
          {visit.workflowStatus === "IN_PROGRESS" && (
            <Button size="sm" onClick={onComplete}>
              Yakunlash
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function BranchDetailBody({
  data,
  canAssign,
  revizors,
  onAssign,
}: {
  data: any;
  canAssign: boolean;
  revizors: Array<{ id: number; fullName: string }>;
  onAssign: (visitId: number, assignedEmployeeId: number) => Promise<void>;
}) {
  const b = data.branch;
  const [assignId, setAssignId] = useState("");
  const [openHist, setOpenHist] = useState(true);

  return (
    <div className="mt-4 space-y-4 text-sm">
      <div className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-muted-foreground">Holat</span>
          <StatusBadge status={b.cycleStatus} label={b.cycleStatusLabel} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-muted-foreground">Oxirgi reviziya</div>
            <div className="font-medium">{formatYmd(b.lastRevisionDate)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Keyingi reviziya</div>
            <div className="font-medium">{formatYmd(b.nextRevisionDate)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Kechikish</div>
            <div className="font-medium">{b.delayDays ? `${b.delayDays} kun` : "—"}</div>
          </div>
        </div>
      </div>

      {data.active && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 dark:bg-indigo-950/20">
          <div className="mb-1 font-medium">Faol reviziya</div>
          <div>Revizor: {data.active.assignedEmployeeName || "—"}</div>
          <div>Status: {WORKFLOW_STATUS_LABEL[data.active.workflowStatus] || data.active.workflowStatus}</div>
          <div>Sana: {formatYmd(data.active.revisionDate)}</div>
          {canAssign && (
            <div className="mt-2 flex gap-2">
              <select
                className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
                value={assignId}
                onChange={(e) => setAssignId(e.target.value)}
              >
                <option value="">Revizor tanlang</option>
                {revizors.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!assignId}
                onClick={() => onAssign(data.active.id, Number(assignId))}
              >
                <UserPlus className="mr-1 h-3.5 w-3.5" /> Biriktirish
              </Button>
            </div>
          )}
        </div>
      )}

      {data.latest && (
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <Banknote className="h-4 w-4" /> Moliyaviy natija (oxirgi)
          </div>
          <div className="grid grid-cols-1 gap-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Kamomad</span>
              <span className="font-medium tabular-nums">{moneySoum(data.latest.shortageAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Undirilgan</span>
              <span className="font-medium tabular-nums">{moneySoum(data.latest.collectedAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Qolgan</span>
              <span className="font-medium tabular-nums">{moneySoum(data.latest.remainingAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Davomiylik</span>
              <span>{data.latest.durationLabel || "—"}</span>
            </div>
            {data.latest.actUrl ? (
              <a className="text-primary underline" href={data.latest.actUrl} target="_blank" rel="noreferrer">
                Aktni ko‘rish
              </a>
            ) : null}
            {data.latest.receiptUrl ? (
              <a className="text-primary underline" href={data.latest.receiptUrl} target="_blank" rel="noreferrer">
                Tilxatni ko‘rish
              </a>
            ) : null}
            {data.latest.notes ? <p className="mt-1 text-muted-foreground">{data.latest.notes}</p> : null}
          </div>
        </div>
      )}

      <Collapsible open={openHist} onOpenChange={setOpenHist}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full justify-between">
            Reviziya tarixi ({data.history?.length || 0})
            <ChevronRight className={cn("h-4 w-4 transition", openHist && "rotate-90")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {(data.history || []).map((h: any) => (
            <div key={h.id} className="rounded-lg border p-2.5 text-xs">
              <div className="flex justify-between font-medium">
                <span>{formatYmd(h.revisionDate)}</span>
                <span>{WORKFLOW_STATUS_LABEL[h.workflowStatus] || h.workflowStatus}</span>
              </div>
              <div className="mt-1 text-muted-foreground">
                Kamomad {moneySoum(h.shortageAmount)} · Undirilgan {moneySoum(h.collectedAmount)} · Qolgan{" "}
                {moneySoum(h.remainingAmount)}
              </div>
              <div>Revizor: {h.assignedEmployeeName || "—"}</div>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
