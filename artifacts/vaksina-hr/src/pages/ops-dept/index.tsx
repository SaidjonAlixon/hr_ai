import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Wrench,
  Cpu,
  AlertTriangle,
  CircleDot,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Users,
  Check,
  MapPin,
  Send,
  ThumbsUp,
  ThumbsDown,
  MinusCircle,
  UserCheck,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  useOpsDash,
  useOpsMeta,
  useOpsMutations,
  useOpsTickets,
  type OpsTicket,
} from "@/lib/ops-dept-api";
import {
  canAddDeptStaff,
  canCreateOpsTicket,
  canManageOpsDept,
  canViewOpsDept,
  isItRole,
  isOpsDeptHead,
} from "@/lib/roles";
import { AddDeptStaffButton } from "@/components/dept/AddDeptStaffDialog";
import { useI18n } from "../../i18n/I18nProvider";
import {
  useAcceptTask,
  useGetTasks,
  type Vazifa,
} from "@/lib/vazifalar-api";
import { AcceptWindowCountdown } from "@/components/vazifalar/AcceptWindowCountdown";
import { isAcceptOverdue, isTaskOverdue } from "@/lib/vazifalar-permissions";

const STATUS_KEYS: Record<string, string> = {
  new: "ops.status.new",
  accepted: "ops.status.accepted",
  assigned: "ops.status.accepted",
  in_progress: "ops.status.in_progress",
  waiting_parts: "ops.status.waiting_parts",
  done: "ops.status.done",
  verified: "ops.status.verified",
  closed: "ops.status.closed",
};

const VERIFY_LABEL: Record<string, string> = {
  done: "ops.rate.done",
  partial: "ops.rate.partial",
  not_done: "ops.rate.notDone",
};

const TASK_STATUS_LABEL: Record<string, string> = {
  todo: "Yangi",
  in_progress: "Jarayonda",
  done: "Bajarildi",
  verified: "Tasdiqlangan",
  cancelled: "Bekor",
};

type Tab = "tasks" | "board" | "new" | "staff";

function fmtDt(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("uz-UZ", {
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

export default function OpsDeptPage({ dept }: { dept: "it" | "texnik" }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canViewOpsDept(dept, user?.role);
  const canManage = canManageOpsDept(dept, user?.role);
  const canCreate = canCreateOpsTicket(dept, user?.role);
  const isHead = isOpsDeptHead(dept, user?.role);
  const isIt = dept === "it";
  const isItStaff = isIt && isItRole(user?.role);
  const canAddStaff =
    canAddDeptStaff(user?.role) &&
    (isIt ? user?.role === "it_rahbar" : user?.role === "texnik_rahbar");

  const meta = useOpsMeta(dept);
  const dash = useOpsDash(dept);
  const tickets = useOpsTickets(dept);
  const mut = useOpsMutations(dept);

  const formMode = meta.data?.formMode || "office";
  const myBranch = meta.data?.myBranch || null;
  const canAssign = Boolean(meta.data?.canAssign || isHead);

  const defaultTab: Tab = isItStaff && !isHead ? "board" : canCreate ? "new" : "board";
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [form, setForm] = useState({ title: "", description: "" });

  const tasksQ = useGetTasks(
    { board: "active" },
    { query: { enabled: allowed && isItStaff } },
  );
  const acceptTask = useAcceptTask();
  const [acceptingId, setAcceptingId] = useState<number | null>(null);

  const myTasks = useMemo(() => {
    const list = tasksQ.data || [];
    if (!user?.id) return [];
    return list
      .filter(
        (task) =>
          (task.assigneeKind === "user" && task.assigneeId === user.id) ||
          task.createdById === user.id,
      )
      .sort((a, b) => {
        const aNeed = a.status === "todo" && !a.acceptedAt ? 0 : 1;
        const bNeed = b.status === "todo" && !b.acceptedAt ? 0 : 1;
        if (aNeed !== bNeed) return aNeed - bNeed;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [tasksQ.data, user?.id]);

  const pendingAcceptCount = myTasks.filter(
    (task) =>
      task.assigneeKind === "user" &&
      task.assigneeId === user?.id &&
      task.status === "todo" &&
      !task.acceptedAt,
  ).length;

  const title = isIt ? t("ops.title.it") : t("ops.title.texnik");
  const hint = isIt
    ? isItStaff
      ? isHead
        ? t("ops.hint.itHead")
        : t("ops.hint.itStaff")
      : formMode === "pharmacy"
        ? t("ops.hint.itPharmacy")
        : t("ops.hint.itOffice")
    : t("ops.hint.texnik");

  if (!allowed) {
    return <div className="p-8 text-center text-muted-foreground">{t("ops.noAccess")}</div>;
  }

  const submit = async () => {
    try {
      await mut.create.mutateAsync({
        title: form.title.trim(),
        description: form.description.trim(),
      });
      toast({ title: t("ops.created") });
      setForm({ title: "", description: "" });
      setTab("board");
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : t("ui.error"), variant: "destructive" });
    }
  };

  const runTicketAction = async (
    id: number,
    body: Record<string, unknown>,
    okTitle: string,
  ) => {
    setBusyId(id);
    try {
      await mut.patch.mutateAsync({ id, ...body });
      toast({ title: okTitle });
    } catch (e: unknown) {
      toast({
        title: e instanceof Error ? e.message : t("ui.error"),
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleAccept = async (task: Vazifa) => {
    if (isTaskOverdue(task) || isAcceptOverdue(task)) {
      toast({
        title: "Vaqt tugagan",
        description: "Faqat beruvchi muddatni uzaytirishi mumkin.",
        variant: "destructive",
      });
      return;
    }
    setAcceptingId(task.id);
    try {
      await acceptTask.mutateAsync(task.id);
      toast({ title: "Vazifa qabul qilindi" });
    } catch (e: unknown) {
      toast({
        title: "Qabul qilinmadi",
        description: e instanceof Error ? e.message : t("ui.error"),
        variant: "destructive",
      });
    } finally {
      setAcceptingId(null);
    }
  };

  const d = dash.data;
  const staff: Array<{ id: number; fullName: string }> = meta.data?.staff || [];

  const tabs: Array<{ id: Tab; label: string; badge?: number; show?: boolean }> = [
    {
      id: "tasks",
      label: t("ops.tab.tasks"),
      badge: pendingAcceptCount || undefined,
      show: isItStaff,
    },
    { id: "board", label: t("ops.tab.board"), show: true },
    { id: "new", label: t("ops.tab.new"), show: canCreate },
    {
      id: "staff",
      label: t("ops.tab.staff"),
      show: isIt && (canAddStaff || canManage),
    },
  ];

  return (
    <div className="dept-page">
      <div className={cn("dept-hero", isIt ? "dept-hero-cyan" : "dept-hero-amber")}>
        <div className="dept-hero-glow" />
        <div className="dept-hero-body">
          <p className="dept-eyebrow">{isIt ? t("ops.eyebrow.it") : t("ops.eyebrow.texnik")}</p>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="dept-title flex items-center gap-2.5">
                {isIt ? <Cpu className="h-6 w-6 shrink-0 opacity-90" /> : <Wrench className="h-6 w-6 shrink-0 opacity-90" />}
                {title}
              </h1>
              <p className="dept-desc">{hint}</p>
            </div>
            {canAddStaff ? <AddDeptStaffButton enabled={canAddStaff} size="sm" className="h-9" /> : null}
          </div>
          <div className="dept-nav-pills">
            {tabs
              .filter((x) => x.show)
              .map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setTab(x.id)}
                  className={cn(
                    "dept-nav-pill",
                    tab === x.id ? "dept-nav-pill--active" : "dept-nav-pill--idle",
                  )}
                >
                  {x.label}
                  {x.badge ? (
                    <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-bold text-white">
                      {x.badge}
                    </span>
                  ) : null}
                </button>
              ))}
          </div>
        </div>
      </div>

      <div className="dept-page-inner">
        <div className="dept-kpi-row">
          <div className="dept-kpi-modern">
            <span className="dept-icon-slate">
              <CircleDot className="h-4 w-4" />
            </span>
            <p className="dept-kpi-label">{t("ops.kpi.open")}</p>
            <p className="dept-kpi-value">{d?.open ?? "—"}</p>
          </div>
          <div className={cn("dept-kpi-modern", !!d?.urgent && "dept-kpi-modern--warn")}>
            <span className={d?.urgent ? "dept-icon-amber" : "dept-icon-slate"}>
              <AlertTriangle className="h-4 w-4" />
            </span>
            <p className="dept-kpi-label">{t("ops.kpi.urgent")}</p>
            <p className="dept-kpi-value">{d?.urgent ?? "—"}</p>
          </div>
          <div className="dept-kpi-modern">
            <span className="dept-icon-slate">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <p className="dept-kpi-label">{t("ops.kpi.awaitVerify")}</p>
            <p className="dept-kpi-value">{d?.awaitingVerify ?? 0}</p>
          </div>
        </div>

        {tab === "tasks" && isItStaff ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">{t("ops.tasks.title")}</p>
              <Link href="/vazifalar">
                <Button variant="outline" size="sm" className="gap-1.5">
                  {t("ops.tasks.openAll")} <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
            {tasksQ.isLoading ? (
              <Skeleton className="h-32" />
            ) : myTasks.length === 0 ? (
              <p className="dept-empty">{t("ops.tasks.empty")}</p>
            ) : (
              myTasks.map((task) => {
                const isAssignee =
                  task.assigneeKind === "user" && task.assigneeId === user?.id;
                const needsAccept = isAssignee && task.status === "todo" && !task.acceptedAt;
                const frozen = needsAccept && isAcceptOverdue(task);
                return (
                  <div key={task.id} className="dept-ticket">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-foreground">{task.title}</p>
                        <span className="dept-status">
                          {TASK_STATUS_LABEL[task.status] || task.status}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {isAssignee
                          ? t("ops.tasks.assignedToMe")
                          : `${t("ops.tasks.createdByMe")} · ${task.assigneeName || "—"}`}
                      </p>
                      {needsAccept ? (
                        <AcceptWindowCountdown task={task} compact className="mt-2 max-w-xs" />
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {needsAccept ? (
                        <Button
                          size="sm"
                          disabled={frozen || acceptingId === task.id}
                          onClick={() => handleAccept(task)}
                          className="gap-1.5"
                        >
                          {acceptingId === task.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          {frozen ? t("ops.tasks.acceptLate") : t("ops.tasks.accept")}
                        </Button>
                      ) : null}
                      <Link href="/vazifalar">
                        <Button variant="outline" size="sm" className="gap-1">
                          {t("ops.tasks.view")} <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : null}

        {tab === "new" && canCreate ? (
          <div className="dept-form">
            <div className="dept-form-head">
              <p className="dept-form-title">{t("ops.formTitle")}</p>
              <p className="dept-form-hint">
                {formMode === "pharmacy" ? t("ops.formHintPharmacy") : t("ops.formHintOffice")}
              </p>
            </div>

            {formMode === "pharmacy" ? (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-teal-200/70 bg-teal-50/80 px-3.5 py-2.5 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>
                  <span className="font-semibold">{t("ops.field.branch")}: </span>
                  {myBranch || t("ops.branchMissing")}
                </span>
              </div>
            ) : null}

            <div className="grid gap-4">
              <div className="dept-field">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("ops.field.title")}
                </Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={t("ops.ph.title")}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="dept-field">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("ops.field.desc")}
                </Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={
                    formMode === "pharmacy" ? t("ops.ph.descPharmacy") : t("ops.ph.descOffice")
                  }
                  className="min-h-[120px] resize-y rounded-xl"
                  maxLength={1000}
                />
              </div>
            </div>

            <Button
              className="mt-6 h-11 w-full gap-2 rounded-xl text-sm font-semibold sm:w-auto sm:min-w-[220px]"
              onClick={submit}
              disabled={
                mut.create.isPending ||
                !form.title.trim() ||
                form.description.trim().length < 3 ||
                (formMode === "pharmacy" && !myBranch)
              }
            >
              {mut.create.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {t("ops.submit")}
            </Button>
          </div>
        ) : null}

        {tab === "board" ? (
          <div className="space-y-3">
            {tickets.isLoading ? (
              <Skeleton className="h-32" />
            ) : (
              (tickets.data || []).map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  staff={staff}
                  canManage={canManage}
                  canAssign={canAssign}
                  isCreator={ticket.createdById === user?.id}
                  isAssignee={ticket.assigneeId === user?.id}
                  busy={busyId === ticket.id}
                  t={t}
                  onAccept={() =>
                    runTicketAction(ticket.id, { action: "accept" }, t("ops.toast.accepted"))
                  }
                  onClose={() =>
                    runTicketAction(ticket.id, { action: "close" }, t("ops.toast.closed"))
                  }
                  onAssign={(assigneeId) =>
                    runTicketAction(
                      ticket.id,
                      { action: "assign", assigneeId },
                      t("ops.toast.assigned"),
                    )
                  }
                  onComplete={() =>
                    runTicketAction(ticket.id, { action: "complete" }, t("ops.toast.completed"))
                  }
                  onRate={(verifyResult) =>
                    runTicketAction(
                      ticket.id,
                      { action: "verify", verifyResult },
                      t("ops.toast.rated"),
                    )
                  }
                />
              ))
            )}
            {!tickets.data?.length && !tickets.isLoading ? (
              <p className="dept-empty">{t("ops.empty")}</p>
            ) : null}
          </div>
        ) : null}

        {tab === "staff" && isIt ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-semibold text-foreground">
                    <Users className="h-4 w-4" /> {t("ops.staff.title")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{t("ops.staff.hint")}</p>
                </div>
                <AddDeptStaffButton enabled={canAddStaff} />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {staff.map((s) => (
                <div key={s.id} className="rounded-xl border border-border bg-card px-3 py-2.5">
                  <p className="text-sm font-medium">{s.fullName}</p>
                  <p className="text-xs text-muted-foreground">ID · {s.id}</p>
                </div>
              ))}
              {!staff.length ? <p className="dept-empty sm:col-span-2">{t("ops.staff.empty")}</p> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TicketCard({
  ticket,
  staff,
  canManage,
  canAssign,
  isCreator,
  isAssignee,
  busy,
  t,
  onAccept,
  onClose,
  onAssign,
  onComplete,
  onRate,
}: {
  ticket: OpsTicket;
  staff: Array<{ id: number; fullName: string }>;
  canManage: boolean;
  canAssign: boolean;
  isCreator: boolean;
  isAssignee: boolean;
  busy: boolean;
  t: (k: string) => string;
  onAccept: () => void;
  onClose: () => void;
  onAssign: (assigneeId: number) => void;
  onComplete: () => void;
  onRate: (verifyResult: "done" | "partial" | "not_done") => void;
}) {
  const canComplete =
    (canManage || isAssignee) &&
    ticket.status !== "done" &&
    ticket.status !== "verified" &&
    ticket.status !== "closed";
  const needsRate = isCreator && ticket.status === "done";
  const isDone = ticket.status === "verified" || ticket.status === "closed";
  const canAcceptHead = canAssign && ticket.status === "new" && !ticket.acceptedAt;
  const canCloseHead = canAssign && !isDone;

  return (
    <div className="dept-ticket flex-col items-stretch gap-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-mono text-muted-foreground">{ticket.ticketNo}</p>
          <span className="dept-status">{t(STATUS_KEYS[ticket.status] || ticket.status)}</span>
          {ticket.escalatedAt ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-200">
              <AlertTriangle className="h-3 w-3" />
              {t("ops.escalated")}
            </span>
          ) : null}
          {ticket.verifyResult ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                ticket.verifyResult === "done" && "bg-emerald-100 text-emerald-800",
                ticket.verifyResult === "partial" && "bg-amber-100 text-amber-900",
                ticket.verifyResult === "not_done" && "bg-rose-100 text-rose-800",
              )}
            >
              {t(VERIFY_LABEL[ticket.verifyResult] || ticket.verifyResult)}
            </span>
          ) : null}
        </div>
        <p className="text-base font-semibold text-foreground">{ticket.title}</p>
        {ticket.description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{ticket.description}</p>
        ) : null}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {ticket.branchName ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {ticket.branchName}
            </span>
          ) : null}
          {ticket.createdByName ? <span>{ticket.createdByName}</span> : null}
          {ticket.assigneeName ? (
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <UserCheck className="h-3 w-3 text-teal-600" />
              {t("ops.assignedTo")}: {ticket.assigneeName}
              {ticket.assignedByName ? ` (${t("ops.assignedBy")} ${ticket.assignedByName})` : ""}
            </span>
          ) : canAssign && ticket.status === "new" ? (
            <span className="text-amber-700">{t("ops.awaitAssign")}</span>
          ) : null}
          {ticket.taskId ? (
            <Link
              href={`/vazifalar?task=${ticket.taskId}`}
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {t("ops.taskOpen")} #{ticket.taskId}
            </Link>
          ) : null}
        </div>

        <div className="grid gap-1.5 rounded-xl border border-border/70 bg-muted/30 p-2.5 text-[11px]">
          <TimelineRow done label={t("ops.timeline.created")} at={fmtDt(ticket.createdAt)} by={ticket.createdByName} />
          <TimelineRow
            done={Boolean(ticket.acceptedAt || ticket.assigneeId)}
            label={t("ops.timeline.accepted")}
            at={fmtDt(ticket.acceptedAt)}
            by={ticket.assigneeName || ticket.acceptedByName}
          />
          <TimelineRow
            done={Boolean(ticket.completedAt)}
            label={t("ops.timeline.completed")}
            at={fmtDt(ticket.completedAt)}
            by={ticket.completedByName}
          />
          <TimelineRow
            done={Boolean(ticket.verifiedAt) || isDone}
            label={t("ops.timeline.verified")}
            at={fmtDt(ticket.verifiedAt)}
            by={
              ticket.verifyResult
                ? `${ticket.verifiedByName || ""} · ${t(VERIFY_LABEL[ticket.verifyResult] || "")}`
                : ticket.verifiedByName
            }
          />
        </div>
      </div>

      <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[200px]">
        {canAcceptHead ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={onAccept}
            className="gap-1 bg-sky-600 hover:bg-sky-700"
            title={t("ops.acceptHint")}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t("ops.action.accept")}
          </Button>
        ) : null}

        {canAssign && !isDone && ticket.status !== "done" ? (
          <select
            className="dept-select h-10 text-xs"
            value={ticket.assigneeId ? String(ticket.assigneeId) : ""}
            disabled={busy}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v) onAssign(v);
            }}
          >
            <option value="">{t("ops.pickAssignee")}</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        ) : null}

        {canComplete ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onComplete} className="gap-1">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t("ops.action.complete")}
          </Button>
        ) : null}

        {canCloseHead ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onClose}
            className="gap-1 border-emerald-300 text-emerald-800 hover:bg-emerald-50"
            title={t("ops.closeHint")}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {t("ops.action.close")}
          </Button>
        ) : null}

        {needsRate ? (
          <div className="space-y-1.5 rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
            <p className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-100">
              {t("ops.rateTitle")}
            </p>
            <div className="grid gap-1.5">
              <Button
                size="sm"
                disabled={busy}
                className="h-9 justify-start gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => onRate("done")}
              >
                <ThumbsUp className="h-3.5 w-3.5" /> {t("ops.rate.done")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                className="h-9 justify-start gap-1.5 border-amber-300 text-amber-900"
                onClick={() => onRate("partial")}
              >
                <MinusCircle className="h-3.5 w-3.5" /> {t("ops.rate.partial")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                className="h-9 justify-start gap-1.5 border-rose-300 text-rose-800"
                onClick={() => onRate("not_done")}
              >
                <ThumbsDown className="h-3.5 w-3.5" /> {t("ops.rate.notDone")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TimelineRow({
  done,
  label,
  at,
  by,
}: {
  done: boolean;
  label: string;
  at: string;
  by?: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className={cn("font-medium", done ? "text-foreground" : "text-muted-foreground")}>
        {done ? "✓ " : "○ "}
        {label}
      </span>
      <span className="text-right tabular-nums text-muted-foreground">
        {at}
        {by ? <span className="block text-[10px]">{by}</span> : null}
      </span>
    </div>
  );
}
