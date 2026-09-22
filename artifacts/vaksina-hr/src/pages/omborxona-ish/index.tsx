import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Clock,
  Loader2,
  Package,
  Pencil,
  Plus,
  UserPlus,
  Users,
  Eye,
  CalendarDays,
  ArrowRight,
  LogIn,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { canManageOmborxona, canViewOmborxona } from "@/lib/roles";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useOmborHolat,
  useOmborHistory,
  useOmborMe,
  useOmborMutations,
  useOmborShifts,
  useOmborStaff,
  type OmborHistoryFilter,
  type OmborHistoryPeriod,
  type WarehouseShift,
} from "@/lib/omborxona-api";

type Tab = "ish" | "smenalar" | "xodimlar" | "holat";

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatIsoHm(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("uz-UZ", {
      timeZone: "Asia/Tashkent",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function statusTone(status: string) {
  const s = status.toLowerCase();
  if (s.includes("present") || s.includes("kelgan") || s === "ok") {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  }
  if (s.includes("late") || s.includes("kech")) {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  }
  if (s.includes("absent") || s.includes("kelmagan")) {
    return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  }
  if (s.includes("kutil")) {
    return "bg-muted text-muted-foreground";
  }
  return "bg-primary/10 text-primary";
}

export default function OmborxonaIshPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canView = canViewOmborxona(user?.role);
  const canManage = canManageOmborxona(user?.role);
  const [tab, setTab] = useState<Tab>(canManage ? "smenalar" : "ish");
  const [holatDate, setHolatDate] = useState(todayYmd());
  const [assignOpen, setAssignOpen] = useState(false);

  const meQ = useOmborMe(canView);
  const shiftsQ = useOmborShifts(
    canView && canManage && (tab === "smenalar" || tab === "xodimlar" || tab === "holat" || assignOpen),
  );
  const staffQ = useOmborStaff(canView && canManage && (tab === "xodimlar" || tab === "smenalar" || assignOpen));
  const holatQ = useOmborHolat(holatDate, canManage && tab === "holat");
  const mut = useOmborMutations();

  const [createOpen, setCreateOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<WarehouseShift | null>(null);
  const [shiftName, setShiftName] = useState("");
  const [startHm, setStartHm] = useState("09:00");
  const [endHm, setEndHm] = useState("18:00");

  const [assignShiftId, setAssignShiftId] = useState<string>("");
  const [assignEmpIds, setAssignEmpIds] = useState<number[]>([]);
  const [histPeriod, setHistPeriod] = useState<OmborHistoryPeriod>("week");
  const [histFilter, setHistFilter] = useState<OmborHistoryFilter>("all");

  const showPersonal = !canManage || tab === "ish";
  const historyQ = useOmborHistory(histPeriod, histFilter, canView && showPersonal);

  const activeShifts = useMemo(
    () => (shiftsQ.data?.shifts || []).filter((s) => s.active),
    [shiftsQ.data?.shifts],
  );

  const staffList = staffQ.data?.staff || [];
  const allStaffSelected =
    staffList.length > 0 && assignEmpIds.length === staffList.length;

  const toggleAssignEmp = (employeeId: number, checked: boolean) => {
    setAssignEmpIds((prev) =>
      checked ? [...new Set([...prev, employeeId])] : prev.filter((id) => id !== employeeId),
    );
  };

  const toggleAllAssignEmp = (checked: boolean) => {
    setAssignEmpIds(checked ? staffList.map((s) => s.employeeId) : []);
  };

  const tabs: { id: Tab; label: string; short: string; show: boolean }[] = [
    { id: "ish", label: "Ish vaqtlari", short: "Ish", show: true },
    { id: "smenalar", label: "Smenalar", short: "Smena", show: canManage },
    { id: "xodimlar", label: "Xodimlar", short: "Xodim", show: canManage },
    { id: "holat", label: "Holat / nazorat", short: "Holat", show: canManage },
  ];

  if (!canView) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center">
        <p className="text-sm text-destructive">Omborxona bo‘limiga ruxsat yo‘q.</p>
        <Link href="/dashboard" className="mt-3 inline-block text-sm text-primary underline">
          ← Bosh sahifa
        </Link>
      </div>
    );
  }

  const resetShiftForm = () => {
    setEditingShift(null);
    setShiftName("");
    setStartHm("09:00");
    setEndHm("18:00");
  };

  const openCreateShift = () => {
    resetShiftForm();
    setCreateOpen(true);
  };

  const openEditShift = (s: WarehouseShift) => {
    setEditingShift(s);
    setShiftName(s.name);
    setStartHm(s.startHm);
    setEndHm(s.endHm);
    setCreateOpen(true);
  };

  const submitCreate = () => {
    if (!shiftName.trim()) {
      toast({ title: "Smena nomini kiriting", variant: "destructive" });
      return;
    }
    if (editingShift) {
      mut.updateShift.mutate(
        {
          id: editingShift.id,
          name: shiftName.trim(),
          startHm,
          endHm,
        },
        {
          onSuccess: () => {
            toast({ title: "Smena yangilandi" });
            setCreateOpen(false);
            resetShiftForm();
          },
          onError: (e) =>
            toast({ title: "Xatolik", description: (e as Error).message, variant: "destructive" }),
        },
      );
      return;
    }
    mut.createShift.mutate(
      { name: shiftName.trim(), startHm, endHm },
      {
        onSuccess: () => {
          toast({ title: "Smena yaratildi" });
          setCreateOpen(false);
          resetShiftForm();
        },
        onError: (e) =>
          toast({ title: "Xatolik", description: (e as Error).message, variant: "destructive" }),
      },
    );
  };

  const submitAssign = () => {
    const shiftId = Number(assignShiftId);
    if (!shiftId || assignEmpIds.length === 0) {
      toast({ title: "Smena va kamida bitta xodimni tanlang", variant: "destructive" });
      return;
    }
    mut.assign.mutate(
      { shiftId, employeeIds: assignEmpIds },
      {
        onSuccess: (data) => {
          toast({
            title: "Biriktirildi",
            description: `${data.count} ta xodim smenaga qo‘shildi`,
          });
          setAssignOpen(false);
          setAssignEmpIds([]);
          setAssignShiftId("");
        },
        onError: (e) =>
          toast({ title: "Xatolik", description: (e as Error).message, variant: "destructive" }),
      },
    );
  };

  const today = meQ.data?.today;
  const myShift = meQ.data?.shift;
  const nextActionHint =
    today?.nextAction === "in"
      ? "Davomatda «Keldim» bosing"
      : today?.nextAction === "out"
        ? "Davomatda «Ketdim» bosing"
        : today?.nextAction === "done"
          ? "Bugungi davomat yakunlangan"
          : null;

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 pb-28 sm:space-y-5 sm:px-6 sm:py-5">
      <header className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Package className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                Omborxona
              </h1>
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                {canManage
                  ? "Smena, xodimlar va nazorat"
                  : "Sizning smenangiz va bugungi keldi / ketdi"}
              </p>
            </div>
          </div>
          {canManage && (
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0">
              <Button
                type="button"
                size="sm"
                className="w-full gap-1.5 rounded-xl sm:w-auto"
                onClick={openCreateShift}
              >
                <Plus className="h-4 w-4" />
                Smena
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="w-full gap-1.5 rounded-xl sm:w-auto"
                onClick={() => setAssignOpen(true)}
              >
                <UserPlus className="h-4 w-4" />
                Biriktirish
              </Button>
            </div>
          )}
        </div>
      </header>

      {canManage && (
        <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:overflow-visible sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max gap-1 rounded-2xl border border-border bg-muted/30 p-1 sm:min-w-0 sm:w-full">
            {tabs
              .filter((t) => t.show)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold transition sm:min-w-0 sm:flex-1",
                    tab === t.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="sm:hidden">{t.short}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Xodim yoki boshliqning «Ish vaqtlari» — shaxsiy smena + keldi/ketdi */}
      {(!canManage || tab === "ish") && (
        <div className="space-y-4">
          {meQ.isLoading ? (
            <div className="flex items-center gap-2 rounded-2xl border bg-card p-6 text-sm text-muted-foreground shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </div>
          ) : (
            <>
              {/* Smena kartasi */}
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between gap-2 border-b border-border bg-primary/5 px-4 py-3">
                  <div className="flex items-center gap-2 text-primary">
                    <Clock className="h-4 w-4" />
                    <span className="text-sm font-semibold">Mening smenam</span>
                  </div>
                  {meQ.data?.workDate ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {meQ.data.workDate}
                    </span>
                  ) : null}
                </div>
                {myShift ? (
                  <div className="space-y-3 p-4 sm:p-5">
                    <div>
                      <p className="text-lg font-semibold text-foreground">{myShift.name}</p>
                      <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                        {myShift.workHours}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Ketdim muddati:{" "}
                      <span className="font-medium text-foreground">{myShift.checkoutDeadlineHm}</span>
                      {" "}(tugash + {myShift.checkoutGraceHours} soat)
                    </p>
                  </div>
                ) : (
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    Smena hali biriktirilmagan. Bo‘lim boshlig‘i tayinlasin.
                  </p>
                )}
              </div>

              {/* Keldi / Ketdi */}
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-3">
                  <span className="text-sm font-semibold text-foreground">Bugungi davomat</span>
                  {today ? (
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                        statusTone(today.statusLabel),
                      )}
                    >
                      {today.statusLabel}
                    </span>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3 p-4 sm:gap-4 sm:p-5">
                  <div className="rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <LogIn className="h-3.5 w-3.5 text-primary" />
                      Keldim
                    </div>
                    <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                      {today?.checkInHm || "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <LogOut className="h-3.5 w-3.5 text-primary" />
                      Ketdim
                    </div>
                    <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                      {today?.checkOutHm || "—"}
                    </p>
                  </div>
                </div>
                {nextActionHint ? (
                  <div className="border-t border-border px-4 py-3 sm:px-5">
                    <p className="mb-3 text-sm text-muted-foreground">{nextActionHint}</p>
                    <Button asChild className="w-full rounded-xl sm:w-auto">
                      <Link href="/davomat-face" className="inline-flex items-center justify-center gap-2">
                        Davomat
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* Tarix: haftalik / oylik / yillik + kechikkan / kelmagan */}
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="border-b border-border bg-muted/30 px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">Davomat tarixi</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {historyQ.data?.from} — {historyQ.data?.to}
                  </p>
                </div>

                <div className="space-y-3 p-4">
                  <div className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
                    {(
                      [
                        ["week", "Haftalik"],
                        ["month", "Oylik"],
                        ["year", "Yillik"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setHistPeriod(id)}
                        className={cn(
                          "flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition sm:text-sm",
                          histPeriod === id
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["all", "Barchasi", historyQ.data?.summary.total],
                        ["late", "Kechikkan", historyQ.data?.summary.late],
                        ["absent", "Kelmagan", historyQ.data?.summary.absent],
                      ] as const
                    ).map(([id, label, count]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setHistFilter(id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                          histFilter === id
                            ? id === "late"
                              ? "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                              : id === "absent"
                                ? "border-rose-500/40 bg-rose-500/15 text-rose-800 dark:text-rose-200"
                                : "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground hover:bg-muted/50",
                        )}
                      >
                        {label}
                        <span className="tabular-nums opacity-80">{count ?? 0}</span>
                      </button>
                    ))}
                  </div>

                  {historyQ.isLoading ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
                    </div>
                  ) : (historyQ.data?.days || []).length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {histFilter === "late"
                        ? "Bu davrda kechikkan kun yo‘q"
                        : histFilter === "absent"
                          ? "Bu davrda kelmagan kun yo‘q"
                          : "Bu davrda yozuv yo‘q"}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                      {(historyQ.data?.days || []).map((d) => (
                        <li
                          key={d.workDate}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                        >
                          <div>
                            <p className="font-medium tabular-nums text-foreground">{d.workDate}</p>
                            <p className="text-xs tabular-nums text-muted-foreground">
                              {d.checkInHm || "—"} → {d.checkOutHm || "—"}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              statusTone(d.statusLabel),
                            )}
                          >
                            {d.statusLabel}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "smenalar" && canManage && (
        <div className="space-y-3">
          {shiftsQ.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : activeShifts.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Hali smena yo‘q — «Smena» tugmasi bilan yarating.
            </div>
          ) : (
            activeShifts.map((s) => (
              <div
                key={s.id}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{s.name}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    <span className="tabular-nums font-medium text-foreground/80">
                      {s.startHm}–{s.endHm}
                    </span>
                    {s.overnight ? (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                        keyingi kun
                      </span>
                    ) : null}
                    <span className="text-border">·</span>
                    <span>{s.memberCount ?? 0} xodim</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-nowrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-1 rounded-xl sm:w-auto"
                    onClick={() => openEditShift(s)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Tahrirlash
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 sm:w-auto"
                    disabled={mut.updateShift.isPending}
                    onClick={() =>
                      mut.updateShift.mutate(
                        { id: s.id, active: false },
                        {
                          onSuccess: () => toast({ title: "Smena yopildi" }),
                          onError: (e) =>
                            toast({
                              title: "Xatolik",
                              description: (e as Error).message,
                              variant: "destructive",
                            }),
                        },
                      )
                    }
                  >
                    Yopish
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "xodimlar" && canManage && (
        <div className="space-y-2.5">
          {staffQ.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : staffList.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Omborxona xodimlari topilmadi.
            </div>
          ) : (
            staffList.map((row) => (
              <div
                key={row.employeeId}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <Users className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{row.fullName}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {row.position || "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.assignedShift
                        ? `${row.assignedShift.name} · ${row.assignedShift.startHm}–${row.assignedShift.endHm}`
                        : "Smena yo‘q"}
                    </p>
                  </div>
                </div>
                {row.assignedShift ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full rounded-xl sm:w-auto sm:shrink-0"
                    disabled={mut.unassign.isPending}
                    onClick={() =>
                      mut.unassign.mutate(
                        { employeeId: row.employeeId },
                        {
                          onSuccess: () => toast({ title: "Smena olib tashlandi" }),
                          onError: (e) =>
                            toast({
                              title: "Xatolik",
                              description: (e as Error).message,
                              variant: "destructive",
                            }),
                        },
                      )
                    }
                  >
                    Ajratish
                  </Button>
                ) : (
                  <span className="inline-flex w-fit rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    Biriktirilmagan
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "holat" && canManage && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-3 py-3 shadow-sm sm:gap-3 sm:px-4">
            <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
            <Label htmlFor="holat-date" className="text-sm font-medium">
              Sana
            </Label>
            <Input
              id="holat-date"
              type="date"
              className="h-9 min-w-0 flex-1 rounded-xl sm:w-auto sm:flex-none"
              value={holatDate}
              onChange={(e) => setHolatDate(e.target.value)}
            />
          </div>

          {holatQ.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (holatQ.data?.groups || []).length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              Smena yoki xodim yo‘q.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-1">
              {(holatQ.data?.groups || []).map((g) => (
                <div
                  key={g.shift.id}
                  className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  <div className="flex flex-col gap-2 border-b border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Eye className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground">
                          <span className="block truncate sm:inline">{g.shift.name}</span>{" "}
                          <span className="font-normal tabular-nums text-muted-foreground">
                            {g.shift.startHm}–{g.shift.endHm}
                          </span>
                        </h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Ketdim muddati:{" "}
                          <span className="font-medium text-foreground">
                            {g.shift.checkoutDeadlineHm}
                          </span>{" "}
                          (tugash + 2 soat)
                        </p>
                      </div>
                    </div>
                    <span className="w-fit rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                      {g.members.length} xodim
                    </span>
                  </div>

                  {g.members.length === 0 ? (
                    <p className="px-4 py-5 text-sm text-muted-foreground">
                      Xodim biriktirilmagan — «Biriktirish» orqali qo‘shing.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {g.members.map((m) => (
                        <li
                          key={m.employeeId}
                          className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="min-w-0 truncate font-medium text-foreground">
                            {m.fullName}
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="tabular-nums text-muted-foreground">
                              {formatIsoHm(m.checkInAt)} → {formatIsoHm(m.checkOutAt)}
                            </span>
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                                statusTone(m.status),
                              )}
                            >
                              {m.status}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetShiftForm();
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingShift ? "Smenani tahrirlash" : "Yangi ombor smenasi"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Nomi</Label>
              <Input
                className="rounded-xl"
                value={shiftName}
                onChange={(e) => setShiftName(e.target.value)}
                placeholder="Masalan: 1-smena"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Boshlanish</Label>
                <Input
                  type="time"
                  className="rounded-xl"
                  value={startHm}
                  onChange={(e) => setStartHm(e.target.value)}
                />
              </div>
              <div>
                <Label>Tugash</Label>
                <Input
                  type="time"
                  className="rounded-xl"
                  value={endHm}
                  onChange={(e) => setEndHm(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Xodimlar shu soatlar bo‘yicha ishlaydi. Ketdim — tugashdan keyin 2 soatgacha.
              {startHm && endHm && startHm >= endHm ? " Tugash keyingi kunga o‘tadi." : ""}
            </p>
          </div>
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              variant="outline"
              className="w-full rounded-xl"
              onClick={() => {
                setCreateOpen(false);
                resetShiftForm();
              }}
            >
              Bekor
            </Button>
            <Button
              className="w-full rounded-xl"
              onClick={submitCreate}
              disabled={mut.createShift.isPending || mut.updateShift.isPending}
            >
              {mut.createShift.isPending || mut.updateShift.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : editingShift ? (
                "Saqlash"
              ) : (
                "Yaratish"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assignOpen}
        onOpenChange={(open) => {
          setAssignOpen(open);
          if (!open) {
            setAssignEmpIds([]);
            setAssignShiftId("");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-md overflow-hidden rounded-2xl">
          <DialogHeader>
            <DialogTitle>Xodimlarni smenaga biriktirish</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Smena</Label>
              <Select value={assignShiftId} onValueChange={setAssignShiftId}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Tanlang" />
                </SelectTrigger>
                <SelectContent>
                  {activeShifts.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} ({s.startHm}–{s.endHm})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <Label>Xodimlar</Label>
                <button
                  type="button"
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => toggleAllAssignEmp(!allStaffSelected)}
                >
                  {allStaffSelected ? "Belgilanmasin" : "Barchasini belgilash"}
                </button>
              </div>
              <div className="max-h-[40vh] space-y-1 overflow-y-auto rounded-xl border border-border bg-muted/20 p-2">
                {staffQ.isLoading ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
                  </div>
                ) : staffList.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">Xodim yo‘q</p>
                ) : (
                  staffList.map((s) => {
                    const checked = assignEmpIds.includes(s.employeeId);
                    return (
                      <label
                        key={s.employeeId}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition hover:bg-muted/70",
                          checked && "bg-primary/10 ring-1 ring-primary/20",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleAssignEmp(s.employeeId, v === true)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium leading-tight">{s.fullName}</span>
                          {s.assignedShift ? (
                            <span className="text-[11px] text-muted-foreground">
                              hozir: {s.assignedShift.name}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Tanlangan: {assignEmpIds.length} ta · qo‘shilganda shu smena soatlari amal qiladi
              </p>
            </div>
          </div>
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              variant="outline"
              className="w-full rounded-xl"
              onClick={() => setAssignOpen(false)}
            >
              Bekor
            </Button>
            <Button
              className="w-full rounded-xl"
              onClick={submitAssign}
              disabled={mut.assign.isPending || assignEmpIds.length === 0 || !assignShiftId}
            >
              {mut.assign.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                `Qo‘shish (${assignEmpIds.length})`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
