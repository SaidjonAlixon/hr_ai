import React, { useState } from "react";
import { Link } from "wouter";
import {
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileQuestion,
  ListChecks,
  ScanFace,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  canAssignReviziya,
  canApproveReviziyaRequest,
  canViewAllReviziyaBranches,
  isReviziyaRole,
} from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { ConductDialog, formatSomInput, visitMetaOf, type ConductValues } from "./conduct-form";
import { BranchDetailSheet } from "./branch-detail";
import { BranchesOverview } from "./branches-overview";
import { RequestsPanel } from "./requests-panel";
import { TasksBoard } from "./tasks-board";
import { CalendarPanel } from "./calendar-panel";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import {
  useReviziyaBranches,
  useReviziyaBranchDetail,
  useReviziyaMyTasks,
  useReviziyaRequests,
  useReviziyaRevizors,
  useReviziyaVisitMutations,
  useReviziyaVisitsDashboard,
  useReviziyaVisitsMeta,
} from "@/lib/reviziya-api";
import { formatYmd } from "@/lib/reviziya-cycle";

type SubTab = "branches" | "tasks" | "requests" | "calendar" | "conduct";

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
    pulledStatus: v.workflowStatus ?? null,
    pulledMeta: visitMetaOf(v),
    collectStatus,
    shortageFound,
  };
}

const CLEARED_FORM: Partial<ConductValues> = {
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
  pulledStatus: null,
  pulledMeta: null,
};

function responsibleOf(form: ConductValues): string | null {
  return (
    [
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
      .join("; ") || null
  );
}

function resultBody(form: ConductValues) {
  return {
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
    responsibleName: responsibleOf(form),
  };
}

function todayTashkent() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

export function ReviziyaCyclePanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role;
  const myId = user?.id != null ? Number(user.id) : null;
  const viewAll = canViewAllReviziyaBranches(role);
  const canAssign = canAssignReviziya(role);
  const canApprove = canApproveReviziyaRequest(role);
  const isRevizorOnly = isReviziyaRole(role) && !viewAll;
  const isCoordinator = role === "koordinator";

  const [sub, setSub] = useState<SubTab>(isRevizorOnly ? "tasks" : isCoordinator ? "requests" : "branches");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);

  const meta = useReviziyaVisitsMeta();
  const dash = useReviziyaVisitsDashboard({ q, status: status || undefined, limit: 50, page });
  const tasks = useReviziyaMyTasks();
  const requests = useReviziyaRequests();
  const branchDetail = useReviziyaBranchDetail(selectedBranchId);
  const branches = useReviziyaBranches();
  const revizors = useReviziyaRevizors();
  const mut = useReviziyaVisitMutations();

  const [form, setForm] = useState<ConductValues>({
    branchId: "",
    revisionDate: todayTashkent(),
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
    pulledStatus: null,
    pulledMeta: null,
    collectStatus: "unset",
    shortageFound: "unset",
  });

  const perms = meta.data?.permissions;
  const canConduct = canAssign || !!perms?.conduct || !!perms?.assign;
  const canReview = !!canAssign || !!perms?.assign;
  const showRequests = isCoordinator || canApprove || !!perms?.approveRequest || viewAll;

  const branchOptions = (branches.data || []).map((b) => ({
    id: String(b.id),
    label: displayBranchName(b.branchName) || b.branchName,
  }));

  const closeConduct = () => {
    setSub("tasks");
    setForm((f) => ({ ...f, ...CLEARED_FORM }));
  };

  /** Yangi reviziya — o‘zimga (bo‘lim boshlig‘i o‘zi o‘tkazadi) */
  const createForSelf = async () =>
    (await mut.create.mutateAsync({
      branchId: Number(form.branchId),
      assignedEmployeeId: myId ?? undefined,
      ...resultBody(form),
    })) as any;

  const onConduct = async () => {
    try {
      if (form.pulledId) {
        await mut.update.mutateAsync({ id: form.pulledId, ...resultBody(form) });
        toast({ title: "Saqlandi. Istalgan joyini yana o‘zgartirish mumkin." });
        return;
      }
      const created = await createForSelf();
      setForm((f) => visitToForm(created, f));
      toast({ title: "Qoralama saqlandi — keyin davom ettirib «Reviziya tayyor»ni bosasiz" });
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  const onHandOff = async () => {
    const name = (revizors.data || []).find((r) => String(r.id) === form.assignedEmployeeId)?.fullName || "Xodim";
    try {
      await mut.create.mutateAsync({
        branchId: Number(form.branchId),
        revisionDate: form.revisionDate,
        scheduledStartTime: form.scheduledStartTime,
        scheduledEndTime: form.scheduledEndTime,
        assignedEmployeeId: Number(form.assignedEmployeeId),
        actNumber: form.actNumber || null,
      });
      toast({
        title: `Ruxsat berildi — reviziya ${name}ga o‘tdi`,
        description: "U qolgan joylarni to‘ldirib, sizga tasdiqlash uchun yuboradi.",
      });
      closeConduct();
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  const onFinish = async () => {
    try {
      let id = form.pulledId;
      if (!id) {
        const created = await createForSelf();
        id = Number(created.id);
        setForm((f) => visitToForm(created, f));
      }
      const saved = (await mut.complete.mutateAsync({ id, ...resultBody(form) })) as {
        workflowStatus?: string;
        nextRevisionDate?: string | null;
      };
      if (saved?.workflowStatus === "REVIEW") {
        toast({
          title: "Tasdiqlashga yuborildi",
          description: "Bo‘lim boshlig‘i tekshiradi. Rad etilsa sababi bilan sizga qaytadi.",
        });
      } else {
        toast({
          title: saved?.nextRevisionDate
            ? `Reviziya yakunlandi. Qaytish: ${formatYmd(saved.nextRevisionDate)}`
            : "Reviziya yakunlandi",
        });
      }
      closeConduct();
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  const onApprove = async () => {
    if (!form.pulledId) return;
    try {
      await mut.reviewApprove.mutateAsync(form.pulledId);
      toast({ title: "Tasdiqlandi — reviziya yakunlandi" });
      closeConduct();
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  const onReject = async (reason: string, action: "redo" | "cancel") => {
    if (!form.pulledId) return;
    try {
      await mut.reviewReject.mutateAsync({ id: form.pulledId, reason, action });
      toast({
        title: action === "cancel" ? "Reviziya bekor qilindi (tarixda saqlanadi)" : "Revizorga qayta qilish uchun qaytarildi",
      });
      closeConduct();
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  const openVisit = (v: any) => {
    setForm((f) => visitToForm(v, f));
    setSub("conduct");
    const mine = myId != null && Number(v.assignedEmployeeId) === myId;
    if (mine && (v.workflowStatus === "ASSIGNED" || v.workflowStatus === "ACCEPTED")) {
      void mut.start
        .mutateAsync(Number(v.id))
        .then(() => setForm((f) => (f.pulledId === Number(v.id) ? { ...f, pulledStatus: "IN_PROGRESS" } : f)))
        .catch(() => undefined);
    }
  };

  const reviewCount = tasks.data?.review?.length || 0;
  const activeCount =
    (tasks.data?.overdue?.length || 0) + (tasks.data?.today?.length || 0) + (tasks.data?.upcoming?.length || 0);
  const overdueCount = tasks.data?.overdue?.length || 0;
  const pendingRequests = requests.data?.counts?.pending || 0;

  const tabs: { id: SubTab; label: string; hint: string; icon: LucideIcon; badge?: number; badgeTone?: string }[] = [
    {
      id: "branches",
      label: viewAll ? "Filiallar holati" : "Mening filiallarim",
      hint: "Sikl, natija va tarix",
      icon: Building2,
    },
    {
      id: "tasks",
      label: "Vazifalar",
      hint: canReview && reviewCount ? `${reviewCount} ta tasdiq kutmoqda` : overdueCount ? `${overdueCount} ta kechikkan` : "Bugungi va navbatdagi",
      icon: ListChecks,
      badge: canReview ? reviewCount || activeCount : activeCount + reviewCount,
      badgeTone: (canReview && reviewCount) || overdueCount ? "amber" : "slate",
    },
    ...(showRequests
      ? [
          {
            id: "requests" as const,
            label: "Arizalar",
            hint: isCoordinator ? "Reviziya so‘rash" : pendingRequests ? `${pendingRequests} ta javob kutmoqda` : "Koordinatorlardan",
            icon: FileQuestion,
            badge: pendingRequests,
            badgeTone: "amber",
          },
        ]
      : []),
    { id: "calendar", label: "Kalendar", hint: "Oy bo‘yicha reja", icon: CalendarDays },
  ];

  return (
    <div className="space-y-4">
      {isReviziyaRole(role) ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-violet-200/80 bg-white p-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-violet-800/50 dark:bg-slate-950">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
              <ScanFace className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold text-violet-950 dark:text-violet-100">Filialda davomat</p>
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

      <nav className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          {tabs.map((t) => {
            const on = sub === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSub(t.id)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition",
                  on
                    ? "border-slate-900 bg-slate-900 text-white shadow-md dark:border-white dark:bg-white dark:text-slate-900"
                    : "border-border bg-card hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    on ? "bg-white/15 dark:bg-slate-900/10" : "bg-muted text-foreground/70",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold leading-tight">{t.label}</span>
                  <span className={cn("block truncate text-[11px]", on ? "text-white/70 dark:text-slate-600" : "text-muted-foreground")}>
                    {t.hint}
                  </span>
                </span>
                {t.badge ? (
                  <span
                    className={cn(
                      "absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums shadow-sm ring-2 ring-background",
                      t.badgeTone === "amber" ? "bg-amber-500 text-white" : "bg-slate-700 text-white",
                    )}
                  >
                    {t.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {canConduct ? (
          <button
            type="button"
            onClick={() => {
              setForm((f) => ({ ...f, ...CLEARED_FORM, revisionDate: todayTashkent() }));
              setSub("conduct");
            }}
            className="flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 px-5 py-3 text-left text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg lg:w-56"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
              <ClipboardCheck className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold leading-tight">Reviziya qilish</span>
              <span className="block text-[11px] text-white/80">O‘zim yoki xodimga topshirish</span>
            </span>
          </button>
        ) : null}
      </nav>

      {sub === "branches" && (
        <BranchesOverview
          data={dash.data}
          isLoading={dash.isLoading}
          isError={dash.isError}
          error={dash.error}
          onRetry={() => void dash.refetch()}
          q={q}
          onQ={(v) => {
            setQ(v);
            setPage(1);
          }}
          status={status}
          onStatus={(v) => {
            setStatus(v);
            setPage(1);
          }}
          page={page}
          onPage={setPage}
          onOpen={setSelectedBranchId}
        />
      )}

      {(sub === "tasks" || sub === "conduct") && (
        <TasksBoard
          data={tasks.data}
          isLoading={tasks.isLoading}
          canReview={canReview}
          myId={myId}
          onOpen={openVisit}
          onOpenBranch={setSelectedBranchId}
        />
      )}

      {sub === "requests" && showRequests && (
        <RequestsPanel
          branches={branchOptions}
          revizors={revizors.data || []}
          myId={myId}
          onOpenBranch={setSelectedBranchId}
        />
      )}

      {sub === "calendar" && <CalendarPanel onOpenBranch={setSelectedBranchId} />}

      {sub === "conduct" && (canConduct || form.pulledId) ? (
        <ConductDialog
          open
          onOpenChange={(next) => {
            if (!next) closeConduct();
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
          onSave={() => void onConduct()}
          onHandOff={() => void onHandOff()}
          onFinish={() => void onFinish()}
          finishing={mut.complete.isPending}
          currentUserId={myId}
          canReview={canReview}
          onApprove={() => void onApprove()}
          onReject={(reason, action) => void onReject(reason, action)}
          reviewBusy={mut.reviewApprove.isPending || mut.reviewReject.isPending}
        />
      ) : null}

      <BranchDetailSheet
        open={!!selectedBranchId}
        onClose={() => setSelectedBranchId(null)}
        data={branchDetail.data}
        isLoading={branchDetail.isLoading}
        canAssign={canReview}
        revizors={revizors.data || []}
        onAssign={async (visitId, assignedEmployeeId) => {
          try {
            await mut.assign.mutateAsync({ id: visitId, assignedEmployeeId });
            toast({ title: "Biriktirildi" });
          } catch (e: any) {
            toast({ title: e?.message || "Xatolik", variant: "destructive" });
          }
        }}
      />
    </div>
  );
}
