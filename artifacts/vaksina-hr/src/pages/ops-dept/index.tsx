import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Plus,
  Wrench,
  Cpu,
  AlertTriangle,
  CircleDot,
  CheckCircle2,
  ListTodo,
  ExternalLink,
  Loader2,
  Users,
  Check,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useReviziyaBranches } from "@/lib/reviziya-api";
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

const PRIO_KEYS: Record<string, string> = {
  low: "ops.prio.low",
  normal: "ops.prio.normal",
  high: "ops.prio.high",
  urgent: "ops.prio.urgent",
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
  const isIt = dept === "it";
  const isItStaff = isIt && isItRole(user?.role);
  const canAddStaff =
    canAddDeptStaff(user?.role) &&
    (isIt ? user?.role === "it_rahbar" : user?.role === "texnik_rahbar");

  const meta = useOpsMeta(dept);
  const dash = useOpsDash(dept);
  const tickets = useOpsTickets(dept);
  const mut = useOpsMutations(dept);
  const branches = useReviziyaBranches();

  const defaultTab: Tab = isItStaff ? "tasks" : canCreate ? "new" : "board";
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [form, setForm] = useState({
    title: "",
    category: "",
    branchName: "",
    priority: "normal",
    description: "",
    assigneeId: "",
  });

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
      ? t("ops.hint.it")
      : t("ops.hint.itPublic")
    : t("ops.hint.texnik");

  if (!allowed) {
    return <div className="p-8 text-center text-muted-foreground">{t("ops.noAccess")}</div>;
  }

  const submit = async () => {
    try {
      await mut.create.mutateAsync({
        title: form.title,
        category: form.category || meta.data?.categories?.[0]?.value,
        branchName: form.branchName,
        priority: form.priority,
        description: form.description,
        assigneeId: form.assigneeId ? Number(form.assigneeId) : undefined,
      });
      toast({ title: t("ops.created") });
      setForm({
        title: "",
        category: "",
        branchName: "",
        priority: "normal",
        description: "",
        assigneeId: "",
      });
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
  const cats: Array<{ value: string; label: string }> = meta.data?.categories || [];
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
            <div>
              <h1 className="dept-title flex items-center gap-2">
                {isIt ? <Cpu className="h-6 w-6" /> : <Wrench className="h-6 w-6" />}
                {title}
              </h1>
              <p className="dept-desc">{hint}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <AddDeptStaffButton enabled={canAddStaff} size="sm" className="h-9" />
              {tabs
                .filter((x) => x.show)
                .map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => setTab(x.id)}
                    className={cn("dept-tab", tab === x.id ? "dept-tab--active" : "dept-tab--idle")}
                  >
                    {x.label}
                    {x.badge ? (
                      <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-bold text-white">
                        {x.badge}
                      </span>
                    ) : null}
                  </button>
                ))}
            </div>
          </div>
        </div>
      </div>

      <div className="dept-page-inner">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {isItStaff ? (
            <Kpi
              icon={ListTodo}
              label={t("ops.kpi.tasks")}
              value={myTasks.filter((x) => x.status === "todo" || x.status === "in_progress").length}
            />
          ) : null}
          <Kpi icon={CircleDot} label={t("ops.kpi.open")} value={d?.open ?? "—"} />
          <Kpi icon={AlertTriangle} label={t("ops.kpi.urgent")} value={d?.urgent ?? "—"} warn={!!d?.urgent} />
          <Kpi
            icon={CheckCircle2}
            label={t("ops.kpi.awaitVerify")}
            value={d?.awaitingVerify ?? d?.byStatus?.done ?? 0}
          />
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
            <p className="mb-1 font-semibold">{t("ops.formTitle")}</p>
            <p className="mb-4 text-xs text-muted-foreground">{t("ops.formHint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">{t("ops.field.title")}</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={t("ops.ph.title")}
                />
              </div>
              <div>
                <Label className="text-xs">{t("ops.field.category")}</Label>
                <select
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {cats.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">{t("ops.field.branch")}</Label>
                <select
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={form.branchName}
                  onChange={(e) => setForm({ ...form, branchName: e.target.value })}
                >
                  <option value="">{t("ops.pick")}</option>
                  {(branches.data || []).map((b) => (
                    <option key={b.id} value={b.branchName}>
                      {b.branchName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">{t("ops.field.priority")}</Label>
                <select
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  <option value="low">{t("ops.prio.low")}</option>
                  <option value="normal">{t("ops.prio.normal")}</option>
                  <option value="high">{t("ops.prio.high")}</option>
                  <option value="urgent">{t("ops.prio.urgent")}</option>
                </select>
              </div>
              {canManage ? (
                <div>
                  <Label className="text-xs">{t("ops.field.assignee")}</Label>
                  <select
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={form.assigneeId}
                    onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                  >
                    <option value="">{t("ops.assigneeLater")}</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <Label className="text-xs">{t("ops.field.desc")}</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t("ops.ph.desc")}
                />
              </div>
            </div>
            <Button
              className="mt-4"
              onClick={submit}
              disabled={mut.create.isPending || !form.title.trim()}
            >
              <Plus className="h-4 w-4" /> {t("ops.submit")}
            </Button>
          </div>
        ) : null}

        {tab === "board" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <span key={c.value} className="dept-chip">
                  {c.label}
                  {d?.byCat?.[c.value] ? ` · ${d.byCat[c.value]}` : ""}
                </span>
              ))}
            </div>
            {tickets.isLoading ? (
              <Skeleton className="h-32" />
            ) : (
              (tickets.data || []).map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  cats={cats}
                  staff={staff}
                  canManage={canManage}
                  isCreator={ticket.createdById === user?.id}
                  busy={busyId === ticket.id}
                  t={t}
                  onAccept={() =>
                    runTicketAction(ticket.id, { action: "accept" }, t("ops.toast.accepted"))
                  }
                  onComplete={() =>
                    runTicketAction(ticket.id, { action: "complete" }, t("ops.toast.completed"))
                  }
                  onVerify={() =>
                    runTicketAction(ticket.id, { action: "verify" }, t("ops.toast.verified"))
                  }
                  onStatus={(status) => mut.patch.mutate({ id: ticket.id, status })}
                  onAssignee={(assigneeId) =>
                    mut.patch.mutate({
                      id: ticket.id,
                      assigneeId: assigneeId || null,
                      ...(assigneeId && ticket.status === "new" ? { action: "accept" } : {}),
                    })
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
                  <p className="font-semibold text-foreground flex items-center gap-2">
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
  cats,
  staff,
  canManage,
  isCreator,
  busy,
  t,
  onAccept,
  onComplete,
  onVerify,
  onStatus,
  onAssignee,
}: {
  ticket: OpsTicket;
  cats: Array<{ value: string; label: string }>;
  staff: Array<{ id: number; fullName: string }>;
  canManage: boolean;
  isCreator: boolean;
  busy: boolean;
  t: (k: string) => string;
  onAccept: () => void;
  onComplete: () => void;
  onVerify: () => void;
  onStatus: (status: string) => void;
  onAssignee: (assigneeId: string) => void;
}) {
  const needsAccept = ticket.status === "new" || ticket.status === "assigned";
  const canComplete =
    ticket.status === "accepted" ||
    ticket.status === "in_progress" ||
    ticket.status === "waiting_parts" ||
    ticket.status === "assigned";
  const canVerify = ticket.status === "done" && (isCreator || canManage);
  const isDone = ticket.status === "verified" || ticket.status === "closed";

  return (
    <div className="dept-ticket flex-col items-stretch gap-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-mono text-muted-foreground">{ticket.ticketNo}</p>
        <p className="font-semibold text-foreground">{ticket.title}</p>
        <p className="text-xs text-muted-foreground">
          {cats.find((c) => c.value === ticket.category)?.label || ticket.category}
          {" · "}
          {ticket.branchName || t("ui.branch")}
          {" · "}
          {t(PRIO_KEYS[ticket.priority] || "ops.prio.normal")}
          {ticket.createdByName ? ` · ${ticket.createdByName}` : ""}
        </p>
        {ticket.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{ticket.description}</p>
        ) : null}

        <div className="mt-3 grid gap-1.5 rounded-lg border border-border/70 bg-muted/40 p-2.5 text-[11px]">
          <TimelineRow
            done
            label={t("ops.timeline.created")}
            at={fmtDt(ticket.createdAt)}
            by={ticket.createdByName}
          />
          <TimelineRow
            done={Boolean(ticket.acceptedAt)}
            label={t("ops.timeline.accepted")}
            at={fmtDt(ticket.acceptedAt)}
            by={ticket.acceptedByName || ticket.assigneeName}
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
            by={ticket.verifiedByName}
          />
        </div>
      </div>

      <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[180px]">
        <span className="dept-status self-start">
          {t(STATUS_KEYS[ticket.status] || ticket.status)}
        </span>

        {canManage && needsAccept && !ticket.acceptedAt ? (
          <Button size="sm" disabled={busy} onClick={onAccept} className="gap-1">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t("ops.action.accept")}
          </Button>
        ) : null}

        {canManage && (canComplete || ticket.status === "accepted") && ticket.status !== "done" && !isDone ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={onComplete} className="gap-1">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("ops.action.complete")}
          </Button>
        ) : null}

        {canVerify ? (
          <Button size="sm" disabled={busy} onClick={onVerify} className="gap-1 bg-emerald-600 hover:bg-emerald-700">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {t("ops.action.verify")}
          </Button>
        ) : null}

        {canManage ? (
          <>
            <select
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
              value={ticket.status}
              onChange={(e) => onStatus(e.target.value)}
            >
              {Object.entries(STATUS_KEYS)
                .filter(([k]) => k !== "assigned")
                .map(([k, key]) => (
                  <option key={k} value={k}>
                    {t(key)}
                  </option>
                ))}
            </select>
            <select
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
              value={ticket.assigneeId ? String(ticket.assigneeId) : ""}
              onChange={(e) => onAssignee(e.target.value)}
            >
              <option value="">{t("ops.assigneeLater")}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </>
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

function Kpi({
  icon: Icon,
  label,
  value,
  warn,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  warn?: boolean;
}) {
  return (
    <div className={cn("dept-kpi", warn && "dept-kpi--warn")}>
      <span className={warn ? "dept-icon-amber" : "dept-icon-slate"}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="dept-kpi-label">{label}</p>
      <p className="dept-kpi-value">{value}</p>
    </div>
  );
}
