import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Clock,
  Search,
  Plus,
  ChevronRight,
  Banknote,
  RefreshCw,
  Play,
  Flag,
  UserPlus,
  MapPin,
  ScanFace,
  ClipboardCheck,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  canAssignReviziya,
  canApproveReviziyaRequest,
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
import { ConductDialog, formatSomInput, type ConductValues } from "./conduct-form";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { CYCLE_STATUS_LABEL, CYCLE_STATUS_TONE, formatYmd, moneySoum, WORKFLOW_STATUS_LABEL } from "@/lib/reviziya-cycle";

type SubTab = "branches" | "tasks" | "calendar" | "create" | "conduct";

/** UI preview — server yakunda unique qilib saqlaydi */
function newActNumberPreview(): string {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" }).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AKT-${ymd}-${rand}`;
}

function visitToForm(v: any, prev: ConductValues): ConductValues {
  const sh = Number(String(v.shortageAmount ?? "0").replace(/\s/g, "")) || 0;
  const col = Number(String(v.collectedAmount ?? "0").replace(/\s/g, "")) || 0;
  const parts = String(v.responsibleName || "")
    .split("; ")
    .map((s: string) => s.trim())
    .filter(Boolean);
  const [first, ...rest] = parts;
  const [name, phone] = (first || "").split(" · ");
  const shortageFound: ConductValues["shortageFound"] = sh > 0 ? "yes" : v.shortageAmount != null ? "no" : "unset";
  const collectStatus: ConductValues["collectStatus"] =
    shortageFound !== "yes" ? "unset" : col <= 0 ? "none" : col >= sh ? "full" : "partial";
  return {
    ...prev,
    branchId: v.branchId != null ? String(v.branchId) : "",
    revisionDate: String(v.revisionDate || v.scheduledDate || prev.revisionDate).slice(0, 10),
    scheduledStartTime: String(v.scheduledStartTime || "10:00").slice(0, 5),
    scheduledEndTime: String(v.scheduledEndTime || "12:00").slice(0, 5),
    assignedEmployeeId: v.assignedEmployeeId != null ? String(v.assignedEmployeeId) : "",
    shortageAmount: sh > 0 ? formatSomInput(String(Math.round(sh))) : "",
    excessAmount: Number(v.excessAmount || 0) > 0 ? formatSomInput(String(v.excessAmount)) : "",
    collectedAmount: col > 0 ? formatSomInput(String(Math.round(col))) : "",
    notes: String(v.notes || ""),
    actNumber: String(v.actNumber || ""),
    actUrl: String(v.actUrl || ""),
    receiptUrl: String(v.receiptUrl || ""),
    responsibleId: first ? "saved" : "",
    responsibleName: (name || "").trim(),
    responsiblePhone: (phone || "").trim(),
    extraResponsibles: rest.map((item: string) => {
      const [n, p] = item.split(" · ");
      return { name: (n || "").trim(), phone: (p || "").trim() };
    }),
    pickedStaff: [],
    pulledId: Number(v.id) || null,
    collectStatus,
    shortageFound,
  };
}

function BranchPicker({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "mt-1 h-11 w-full justify-between rounded-xl border-violet-200 bg-white px-3 font-normal shadow-sm hover:bg-violet-50/60 dark:border-violet-800/60 dark:bg-background",
            selected && "border-violet-400",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-200">
              <Building2 className="h-3.5 w-3.5" />
            </span>
            <span className={cn("truncate text-left text-sm", !selected && "text-muted-foreground")}>
              {selected?.label || "Filialni yozib qidiring"}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[80] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-xl p-0 shadow-lg"
        align="start"
      >
        <Command
          filter={(itemValue, query) => {
            const q = query.trim().toLowerCase();
            if (!q) return 1;
            return itemValue.toLowerCase().includes(q) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Filial nomini yozing…" />
          <CommandList className="max-h-72">
            <CommandEmpty>Bunday filial topilmadi</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const active = o.id === value;
                return (
                  <CommandItem
                    key={o.id}
                    value={`${o.label} ${o.id}`}
                    onSelect={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                    className={cn(
                      "rounded-lg py-2",
                      active && "bg-violet-100 text-violet-950 data-[selected=true]:bg-violet-100 data-[selected=true]:text-violet-950",
                    )}
                  >
                    <Check className={cn("text-violet-700", active ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  tone?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className={cn("rounded-2xl border bg-card p-3.5 shadow-sm", tone)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        {Icon ? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
            <Icon className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 text-lg font-semibold tabular-nums sm:text-xl">{value}</div>
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
  const canApprove = canApproveReviziyaRequest(role);
  const isRevizorOnly = isReviziyaRole(role) && !viewAll;
  const isCoordinator = role === "koordinator";

  const [sub, setSub] = useState<SubTab>(isRevizorOnly ? "tasks" : isCoordinator ? "create" : "branches");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [completeVisitId, setCompleteVisitId] = useState<number | null>(null);
  const [approveVisitId, setApproveVisitId] = useState<number | null>(null);
  const [approveForm, setApproveForm] = useState({
    revisionDate: new Date().toISOString().slice(0, 10),
    scheduledStartTime: "10:00",
    scheduledEndTime: "14:00",
    assignedEmployeeId: "",
    notes: "",
  });

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

  const [form, setForm] = useState<ConductValues>({
    branchId: "",
    revisionDate: new Date().toISOString().slice(0, 10),
    scheduledStartTime: "10:00",
    scheduledEndTime: "12:00",
    assignedEmployeeId: "",
    shortageAmount: "",
    excessAmount: "",
    collectedAmount: "",
    notes: "",
    actNumber: "",
    actUrl: "",
    receiptUrl: "",
    responsibleName: "",
    responsibleId: "",
    responsiblePhone: "",
    extraResponsibles: [],
    pickedStaff: [],
    pulledId: null,
    collectStatus: "unset",
    shortageFound: "unset",
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
  const canConduct = canAssign || !!perms?.conduct || !!perms?.assign;

  const onCreate = async () => {
    try {
      await mut.create.mutateAsync({
        branchId: Number(form.branchId),
        revisionDate: form.revisionDate,
        notes: form.notes || null,
      });
      toast({ title: "Ariza yuborildi — reviziya rahbari kun belgilaydi" });
      setSub("tasks");
      setForm((f) => ({
        ...f,
        notes: "",
        actNumber: newActNumberPreview(),
      }));
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  const onConduct = async () => {
    if (!form.pulledId && !form.assignedEmployeeId) {
      toast({ title: "Revizorni tanlang — ruxsat shu odamga ketadi", variant: "destructive" });
      return;
    }
    const body = {
      branchId: Number(form.branchId),
      revisionDate: form.revisionDate,
      scheduledStartTime: form.scheduledStartTime,
      scheduledEndTime: form.scheduledEndTime,
      assignedEmployeeId: form.assignedEmployeeId ? Number(form.assignedEmployeeId) : undefined,
      notes: form.notes || null,
      actNumber: form.actNumber || null,
      shortageAmount: form.shortageAmount || 0,
      excessAmount: form.excessAmount || 0,
      collectedAmount: form.collectedAmount || 0,
      actUrl: form.actUrl || null,
      receiptUrl: form.receiptUrl || null,
      responsibleName: [
        ...(form.pickedStaff.length
          ? form.pickedStaff.map((p) => `${p.name}${p.phone.trim() ? ` · ${p.phone.trim()}` : ""}`)
          : form.responsibleName.trim()
            ? [`${form.responsibleName.trim()}${form.responsiblePhone.trim() ? ` · ${form.responsiblePhone.trim()}` : ""}`]
            : []),
        ...form.extraResponsibles
          .filter((p) => p.name.trim())
          .map((p) => `${p.name.trim()}${p.phone.trim() ? ` · ${p.phone.trim()}` : ""}`),
      ]
        .filter(Boolean)
        .join("; ") || null,
    };
    try {
      if (form.pulledId) {
        await mut.update.mutateAsync({ id: form.pulledId, ...body });
        toast({ title: "Saqlandi. Istalgan joyini yana o‘zgartirish mumkin." });
        return;
      }
      await mut.create.mutateAsync(body);
      toast({ title: "Ruxsat berildi — tanlangan revizorning vazifasiga tushdi" });
      setSub("tasks");
      setForm((f) => ({
        ...f,
        notes: "",
        assignedEmployeeId: "",
        shortageAmount: "",
        excessAmount: "",
        collectedAmount: "",
        collectStatus: "unset",
        shortageFound: "unset",
        actUrl: "",
        receiptUrl: "",
        responsibleName: "",
        responsibleId: "",
        responsiblePhone: "",
        extraResponsibles: [],
        pickedStaff: [],
        actNumber: "",
        pulledId: null,
      }));
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  const onFinish = async () => {
    if (!form.pulledId) return;
    const body = {
      revisionDate: form.revisionDate,
      scheduledStartTime: form.scheduledStartTime,
      scheduledEndTime: form.scheduledEndTime,
      notes: form.notes || null,
      actNumber: form.actNumber || null,
      shortageAmount: form.shortageAmount || 0,
      excessAmount: form.excessAmount || 0,
      collectedAmount: form.collectedAmount || 0,
      actUrl: form.actUrl || null,
      receiptUrl: form.receiptUrl || null,
      responsibleName: [
        ...(form.pickedStaff.length
          ? form.pickedStaff.map((p) => `${p.name}${p.phone.trim() ? ` · ${p.phone.trim()}` : ""}`)
          : form.responsibleName.trim()
            ? [`${form.responsibleName.trim()}${form.responsiblePhone.trim() ? ` · ${form.responsiblePhone.trim()}` : ""}`]
            : []),
        ...form.extraResponsibles
          .filter((p) => p.name.trim())
          .map((p) => `${p.name.trim()}${p.phone.trim() ? ` · ${p.phone.trim()}` : ""}`),
      ]
        .filter(Boolean)
        .join("; ") || null,
    };
    try {
      const saved = (await mut.complete.mutateAsync({ id: form.pulledId, ...body })) as {
        nextRevisionDate?: string | null;
      };
      toast({
        title: saved?.nextRevisionDate
          ? `Reviziya qabul qilindi. Qaytish: ${formatYmd(saved.nextRevisionDate)}`
          : "Reviziya qabul qilindi va navbatga qo‘shildi",
      });
      setSub("tasks");
      setForm((f) => ({
        ...f,
        notes: "",
        assignedEmployeeId: "",
        shortageAmount: "",
        excessAmount: "",
        collectedAmount: "",
        collectStatus: "unset",
        shortageFound: "unset",
        actUrl: "",
        receiptUrl: "",
        responsibleName: "",
        responsibleId: "",
        responsiblePhone: "",
        extraResponsibles: [],
        pickedStaff: [],
        actNumber: "",
        pulledId: null,
      }));
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  const openVisit = (v: any) => {
    setForm((f) => visitToForm(v, f));
    setSub("conduct");
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
      {isReviziyaRole(role) ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-violet-200/80 bg-white p-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-violet-800/50 dark:bg-slate-950">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
              <ScanFace className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold text-violet-950 dark:text-violet-100">
                Filialda davomat
              </p>
              <p className="text-xs leading-snug text-violet-800/80 dark:text-violet-200/80">
                Ofis yoki borgan filial GPS hududida «Keldim / Ketdim» qilishingiz mumkin.
              </p>
            </div>
          </div>
          <Button asChild size="sm" className="h-9 shrink-0 gap-1.5 rounded-full bg-violet-700 px-4 hover:bg-violet-800">
            <Link href="/davomat-face">
              <ScanFace className="h-3.5 w-3.5" /> Davomatga o‘tish
            </Link>
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-1.5 dark:border-slate-800 dark:bg-slate-900/50">
        {(
          [
            { id: "branches" as const, label: viewAll ? "Filiallar holati" : "Mening filiallarim", icon: Building2 },
            { id: "tasks" as const, label: "Bugungi / vazifalar", icon: Flag },
            { id: "calendar" as const, label: "Kalendar", icon: CalendarDays },
            ...(canConduct
              ? [{ id: "conduct" as const, label: "Reviziya qilish", icon: ClipboardCheck }]
              : []),
            ...(canCreate || perms?.create
              ? [{ id: "create" as const, label: "Ariza qoldirish", icon: Plus }]
              : []),
          ] as const
        ).map((t) => {
          const active = sub === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setSub(t.id);
              }}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition",
                active
                  ? t.id === "conduct"
                    ? "bg-gradient-to-br from-violet-700 to-indigo-600 text-white shadow-sm"
                    : "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700"
                  : "text-slate-600 hover:bg-white/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-white",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
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
                <StatCard label="Jami filiallar" value={stats?.totalBranches ?? 0} icon={Building2} />
                <StatCard label="Rejadagidek" value={stats?.completedOk ?? 0} tone="border-emerald-200" icon={CheckCircle2} />
                <StatCard label="Tez orada" value={stats?.tezOrada ?? 0} tone="border-amber-200" icon={Clock} />
                <StatCard label="Muddati o‘tgan" value={stats?.muddatiOtgan ?? 0} tone="border-rose-200" icon={Flag} />
                <StatCard label="Sikl o‘tkazilgan" value={stats?.siklOtkazilgan ?? 0} tone="border-fuchsia-200" icon={RefreshCw} />
                <StatCard label="Yangi ochilgan" value={stats?.yangiOchilgan ?? 0} tone="border-sky-200" icon={Plus} />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <StatCard label="Jami kamomad" value={moneySoum(stats?.totalShortage ?? 0)} icon={Banknote} />
                <StatCard label="Jami undirilgan" value={moneySoum(stats?.totalCollected ?? 0)} icon={CheckCircle2} />
                <StatCard label="Jami qolgan" value={moneySoum(stats?.totalRemaining ?? 0)} icon={Banknote} />
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                {(meta.data?.cycleStatuses || Object.entries(CYCLE_STATUS_LABEL).map(([value, label]) => ({ value, label }))).map(
                  (s: { value: string; label: string }) => (
                    <span
                      key={s.value}
                      className={cn(
                        "rounded-full px-2 py-0.5 font-medium",
                        CYCLE_STATUS_TONE[s.value] || "bg-muted",
                      )}
                    >
                      {s.label}
                    </span>
                  ),
                )}
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
                        className={cn(
                          "cursor-pointer border-t hover:bg-muted/40",
                          b.daysLeft != null && b.daysLeft < 0 && "bg-rose-50/80 dark:bg-rose-950/20",
                        )}
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
                          {b.daysLeft == null
                            ? "—"
                            : b.daysLeft < 0
                              ? `Kechikkan ${Math.abs(b.daysLeft)} kun`
                              : `${b.daysLeft} kun`}
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
                      <span>
                        Qaytish: {formatYmd(b.nextRevisionDate)}
                        {b.daysLeft != null && b.daysLeft < 0 ? ` · kechikkan ${Math.abs(b.daysLeft)} kun` : ""}
                      </span>
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
              {(canApprove || perms?.approveRequest || isCoordinator) &&
              (tasks.data?.pending?.length || 0) > 0 ? (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Flag className="h-4 w-4 text-amber-600" /> Kutayotgan arizalar
                  </h3>
                  <div className="grid gap-2">
                    {(tasks.data?.pending || []).map((v: any) => (
                      <TaskCard
                        key={v.id}
                        visit={v}
                        todayYmd={tasks.data?.todayYmd}
                        onOpen={() => openVisit(v)}
                        canAssign={!!canAssign || !!perms?.assign}
                        canApprove={!!canApprove || !!perms?.approveRequest}
                        onAccept={() => runAction(() => mut.accept.mutateAsync(v.id), "Qabul qilindi")}
                        onStart={() => runAction(() => mut.start.mutateAsync(v.id), "Reviziya boshlandi")}
                        onComplete={() => openVisit(v)}
                        onApprove={() => {
                          setApproveVisitId(v.id);
                          setApproveForm({
                            revisionDate: v.revisionDate || new Date().toISOString().slice(0, 10),
                            scheduledStartTime: v.scheduledStartTime || "10:00",
                            scheduledEndTime: v.scheduledEndTime || "14:00",
                            assignedEmployeeId: "",
                            notes: v.notes || "",
                          });
                        }}
                        onOpenBranch={() => setSelectedBranchId(v.branchId)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {(tasks.data?.overdue?.length || 0) > 0 ? (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-700">
                    <Clock className="h-4 w-4" /> Kechikkan · eng avval shu filiallar
                  </h3>
                  <div className="grid gap-2">
                    {(tasks.data?.overdue || []).map((v: any) => (
                      <TaskCard
                        key={v.id}
                        visit={v}
                        todayYmd={tasks.data?.todayYmd}
                        onOpen={() => openVisit(v)}
                        canAssign={!!canAssign || !!perms?.assign}
                        canApprove={!!canApprove || !!perms?.approveRequest}
                        onAccept={() => runAction(() => mut.accept.mutateAsync(v.id), "Qabul qilindi")}
                        onStart={() => openVisit(v)}
                        onComplete={() => openVisit(v)}
                        onApprove={() => {
                          setApproveVisitId(v.id);
                          setApproveForm({
                            revisionDate: v.revisionDate || new Date().toISOString().slice(0, 10),
                            scheduledStartTime: v.scheduledStartTime || "10:00",
                            scheduledEndTime: v.scheduledEndTime || "14:00",
                            assignedEmployeeId: "",
                            notes: v.notes || "",
                          });
                        }}
                        onOpenBranch={() => setSelectedBranchId(v.branchId)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Clock className="h-4 w-4" /> Bugun ({tasks.data?.todayYmd}) · muddat tartibida
                </h3>
                {!tasks.data?.today?.length ? (
                  <p className="text-sm text-muted-foreground">Bugungi reviziya yo‘q</p>
                ) : (
                  <div className="grid gap-2">
                    {tasks.data.today.map((v: any) => (
                      <TaskCard
                        key={v.id}
                        visit={v}
                        todayYmd={tasks.data?.todayYmd}
                        onOpen={() => openVisit(v)}
                        canAssign={!!canAssign || !!perms?.assign}
                        canApprove={!!canApprove || !!perms?.approveRequest}
                        onAccept={() => runAction(() => mut.accept.mutateAsync(v.id), "Qabul qilindi")}
                        onStart={() => runAction(() => mut.start.mutateAsync(v.id), "Reviziya boshlandi")}
                        onComplete={() => openVisit(v)}
                        onApprove={() => {
                          setApproveVisitId(v.id);
                          setApproveForm({
                            revisionDate: v.revisionDate || new Date().toISOString().slice(0, 10),
                            scheduledStartTime: v.scheduledStartTime || "10:00",
                            scheduledEndTime: v.scheduledEndTime || "14:00",
                            assignedEmployeeId: "",
                            notes: v.notes || "",
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
                  <CalendarDays className="h-4 w-4" /> Kelajakda · muddat tartibida
                </h3>
                {!tasks.data?.upcoming?.length ? (
                  <p className="text-sm text-muted-foreground">Rejalashtirilgan reviziya yo‘q</p>
                ) : (
                  <div className="grid gap-2">
                    {tasks.data.upcoming.map((v: any) => (
                      <TaskCard
                        key={v.id}
                        visit={v}
                        todayYmd={tasks.data?.todayYmd}
                        onOpen={() => openVisit(v)}
                        canAssign={!!canAssign || !!perms?.assign}
                        canApprove={!!canApprove || !!perms?.approveRequest}
                        onAccept={() => runAction(() => mut.accept.mutateAsync(v.id), "Qabul qilindi")}
                        onStart={() => runAction(() => mut.start.mutateAsync(v.id), "Reviziya boshlandi")}
                        onComplete={() => openVisit(v)}
                        onApprove={() => {
                          setApproveVisitId(v.id);
                          setApproveForm({
                            revisionDate: v.revisionDate || new Date().toISOString().slice(0, 10),
                            scheduledStartTime: v.scheduledStartTime || "10:00",
                            scheduledEndTime: v.scheduledEndTime || "14:00",
                            assignedEmployeeId: "",
                            notes: v.notes || "",
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

      {sub === "conduct" && (canConduct || form.pulledId) ? (
        <ConductDialog
          open
          onOpenChange={(next) => {
            if (!next) setSub("tasks");
          }}
          form={form}
          setForm={setForm}
          branches={(branches.data || []).map((b) => ({
            id: b.id,
            branchName: displayBranchName(b.branchName) || b.branchName,
            responsibleName: b.responsibleName || "",
          }))}
          revizors={revizors.data || []}
          saving={mut.create.isPending || mut.update.isPending}
          saveLabel={form.pulledId ? "Saqlash" : "Ruxsat berish"}
          onFinish={form.pulledId ? () => void onFinish() : undefined}
          finishing={mut.complete.isPending}
          onSave={() => void onConduct()}
        />
      ) : null}

      {sub === "create" && (canCreate || perms?.create) && (
        <div className="mx-auto max-w-xl space-y-3 rounded-xl border p-4">
          <h3 className="font-semibold">Reviziya arizasi</h3>
          <p className="text-xs text-muted-foreground">
            Filialni tanlang — ariza reviziya rahbariga yuboriladi. Kun va revizor keyin belgilanadi.
          </p>
          <div className="space-y-3">
            <div>
              <Label>Filial</Label>
              <BranchPicker
                value={form.branchId}
                onChange={(id) => setForm({ ...form, branchId: id })}
                options={(branches.data || []).map((b) => ({
                  id: String(b.id),
                  label: displayBranchName(b.branchName) || b.branchName,
                }))}
              />
            </div>
            <div>
              <Label>Taklif etilgan sana (ixtiyoriy)</Label>
              <Input
                type="date"
                className="mt-1"
                value={form.revisionDate}
                onChange={(e) => setForm({ ...form, revisionDate: e.target.value })}
              />
            </div>
            <div>
              <Label>Izoh / sabab</Label>
              <Input
                className="mt-1"
                placeholder="Nima uchun reviziya kerak…"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <Button disabled={!form.branchId || mut.create.isPending} onClick={onCreate}>
            Ariza yuborish
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

      <Sheet open={!!approveVisitId} onOpenChange={(o) => !o && setApproveVisitId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Arizani qabul qilish</SheetTitle>
            <SheetDescription>Reviziya kunini belgilang va revizor biriktiring.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <div>
              <Label>Reviziya kuni</Label>
              <Input
                type="date"
                className="mt-1"
                value={approveForm.revisionDate}
                onChange={(e) => setApproveForm({ ...approveForm, revisionDate: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Boshlanish</Label>
                <Input
                  type="time"
                  className="mt-1"
                  value={approveForm.scheduledStartTime}
                  onChange={(e) => setApproveForm({ ...approveForm, scheduledStartTime: e.target.value })}
                />
              </div>
              <div>
                <Label>Tugash</Label>
                <Input
                  type="time"
                  className="mt-1"
                  value={approveForm.scheduledEndTime}
                  onChange={(e) => setApproveForm({ ...approveForm, scheduledEndTime: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Revizor</Label>
              <select
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={approveForm.assignedEmployeeId}
                onChange={(e) => setApproveForm({ ...approveForm, assignedEmployeeId: e.target.value })}
              >
                <option value="">Keyin biriktiriladi</option>
                {(revizors.data || []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Izoh</Label>
              <Input
                className="mt-1"
                value={approveForm.notes}
                onChange={(e) => setApproveForm({ ...approveForm, notes: e.target.value })}
              />
            </div>
            <Button
              disabled={!approveForm.revisionDate || mut.approveRequest.isPending}
              onClick={() =>
                runAction(async () => {
                  await mut.approveRequest.mutateAsync({
                    id: approveVisitId!,
                    revisionDate: approveForm.revisionDate,
                    scheduledStartTime: approveForm.scheduledStartTime,
                    scheduledEndTime: approveForm.scheduledEndTime,
                    assignedEmployeeId: approveForm.assignedEmployeeId
                      ? Number(approveForm.assignedEmployeeId)
                      : null,
                    notes: approveForm.notes || null,
                  });
                  setApproveVisitId(null);
                }, "Ariza qabul qilindi")
              }
            >
              Qabul qilish
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TaskCard({
  visit,
  todayYmd,
  canApprove,
  onAccept,
  onComplete,
  onApprove,
  onOpen,
  onOpenBranch,
}: {
  visit: any;
  todayYmd?: string;
  canAssign: boolean;
  canApprove?: boolean;
  onAccept: () => void;
  onStart: () => void;
  onComplete: () => void;
  onApprove?: () => void;
  onOpen?: () => void;
  onOpenBranch: () => void;
}) {
  const wf = visit.workflowStatus as string;
  const plan = String(visit.revisionDate || visit.scheduledDate || "");
  const late = Boolean(todayYmd && plan && plan < todayYmd);
  const lateDays = late && todayYmd ? Math.round((Date.parse(todayYmd) - Date.parse(plan)) / 86400000) : 0;
  const returnOn = visit.nextRevisionDateEffective || visit.nextRevisionDate;
  const wfTone =
    late
      ? "bg-rose-100 text-rose-900"
      : wf === "COMPLETED"
      ? "bg-teal-100 text-teal-900"
      : wf === "IN_PROGRESS"
        ? "bg-indigo-100 text-indigo-900"
        : wf === "ACCEPTED"
          ? "bg-sky-100 text-sky-900"
          : wf === "REQUESTED"
            ? "bg-amber-100 text-amber-950"
            : wf === "CANCELLED"
              ? "bg-rose-100 text-rose-900"
              : "bg-violet-100 text-violet-900";

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 shadow-sm",
        late && "border-rose-200 bg-rose-50/60",
        onOpen && "cursor-pointer",
      )}
      onClick={() => onOpen?.()}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="text-left font-medium hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              (onOpen || onOpenBranch)();
            }}
          >
            {displayBranchName(visit.branchName) || visit.branchName}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {formatYmd(visit.revisionDate || visit.scheduledDate)} · {visit.scheduledStartTime || "—"}
              {visit.scheduledEndTime ? `–${visit.scheduledEndTime}` : ""}
            </span>
            <Badge variant="secondary" className={cn("font-medium", wfTone)}>
              {late ? `Kechikkan${lateDays > 0 ? ` · ${lateDays} kun` : ""}` : WORKFLOW_STATUS_LABEL[wf] || wf}
            </Badge>
            {visit.assignedEmployeeName ? <span>{visit.assignedEmployeeName}</span> : null}
          </div>
          {returnOn ? (
            <p className="mt-1 text-xs font-medium text-slate-700">Qaytish: {formatYmd(returnOn)}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Qaytish sanasi «Reviziya tayyor»dan keyin hisoblanadi</p>
          )}
          {visit.notes ? <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{visit.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
          {wf === "REQUESTED" && canApprove && onApprove ? (
            <Button size="sm" onClick={onApprove}>
              Qabul + kun
            </Button>
          ) : null}
          {wf === "ASSIGNED" && (
            <Button size="sm" variant="outline" onClick={onAccept}>
              Qabul
            </Button>
          )}
          {["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(wf) && onOpen ? (
            <Button size="sm" onClick={onOpen}>
              <Play className="mr-1 h-3.5 w-3.5" /> Ochish
            </Button>
          ) : null}
          {wf === "IN_PROGRESS" ? (
            <Button size="sm" variant="outline" onClick={onComplete}>
              Yakunlash
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" asChild>
            <Link href="/davomat-face">
              <MapPin className="mr-1 h-3.5 w-3.5" /> Filialda
            </Link>
          </Button>
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
