import React, { useState } from "react";
import { Plus, Wrench, Cpu, AlertTriangle, CircleDot, CheckCircle2, Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useReviziyaBranches } from "@/lib/reviziya-api";
import { useOpsDash, useOpsMeta, useOpsMutations, useOpsTickets } from "@/lib/ops-dept-api";
import { isItRole, isTexnikRole, canAddDeptStaff } from "@/lib/roles";
import { AddDeptStaffButton } from "@/components/dept/AddDeptStaffDialog";
import { useI18n } from "../../i18n/I18nProvider";

const STATUS_KEYS: Record<string, string> = {
  new: "ops.status.new",
  assigned: "ops.status.assigned",
  in_progress: "ops.status.in_progress",
  waiting_parts: "ops.status.waiting_parts",
  done: "ops.status.done",
  closed: "ops.status.closed",
};

const PRIO_KEYS: Record<string, string> = {
  low: "ops.prio.low",
  normal: "ops.prio.normal",
  high: "ops.prio.high",
  urgent: "ops.prio.urgent",
};

export default function OpsDeptPage({ dept }: { dept: "it" | "texnik" }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed =
    user?.role === "admin" ||
    user?.role === "mudir" ||
    user?.role === "koordinator" ||
    (dept === "it" ? isItRole(user?.role) : isTexnikRole(user?.role));

  const meta = useOpsMeta(dept);
  const dash = useOpsDash(dept);
  const tickets = useOpsTickets(dept);
  const mut = useOpsMutations(dept);
  const branches = useReviziyaBranches();
  const [tab, setTab] = useState<"board" | "new">("board");
  const [form, setForm] = useState({
    title: "",
    category: "",
    branchName: "",
    priority: "normal",
    description: "",
    assigneeId: "",
  });

  const isIt = dept === "it";
  const title = isIt ? t("ops.title.it") : t("ops.title.texnik");
  const hint = isIt ? t("ops.hint.it") : t("ops.hint.texnik");
  const canAddStaff = canAddDeptStaff(user?.role) && (isIt ? user?.role === "it_rahbar" : user?.role === "texnik_rahbar");

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
      setForm({ title: "", category: "", branchName: "", priority: "normal", description: "", assigneeId: "" });
      setTab("board");
    } catch (e: unknown) {
      toast({ title: e instanceof Error ? e.message : t("ui.error"), variant: "destructive" });
    }
  };

  const d = dash.data;
  const cats: Array<{ value: string; label: string }> = meta.data?.categories || [];

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
              <button
                type="button"
                onClick={() => setTab("board")}
                className={cn("dept-tab", tab === "board" ? "dept-tab--active" : "dept-tab--idle")}
              >
                {t("ops.tab.board")}
              </button>
              <button
                type="button"
                onClick={() => setTab("new")}
                className={cn("dept-tab", tab === "new" ? "dept-tab--active" : "dept-tab--idle")}
              >
                {t("ops.tab.new")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="dept-page-inner">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi icon={CircleDot} label={t("ops.kpi.open")} value={d?.open ?? "—"} />
          <Kpi icon={AlertTriangle} label={t("ops.kpi.urgent")} value={d?.urgent ?? "—"} warn={!!d?.urgent} />
          <Kpi icon={Clock} label={t("ops.kpi.total")} value={d?.total ?? "—"} />
          <Kpi icon={CheckCircle2} label={t("ops.kpi.closed")} value={d?.byStatus?.closed ?? 0} />
        </div>

        {tab === "new" ? (
          <div className="dept-form">
            <p className="mb-4 font-semibold">{t("ops.formTitle")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">{t("ops.field.title")}</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("ops.ph.title")} />
              </div>
              <div>
                <Label className="text-xs">{t("ops.field.category")}</Label>
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {cats.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">{t("ops.field.branch")}</Label>
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.branchName} onChange={(e) => setForm({ ...form, branchName: e.target.value })}>
                  <option value="">{t("ops.pick")}</option>
                  {(branches.data || []).map((b) => (
                    <option key={b.id} value={b.branchName}>{b.branchName}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">{t("ops.field.priority")}</Label>
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="low">{t("ops.prio.low")}</option>
                  <option value="normal">{t("ops.prio.normal")}</option>
                  <option value="high">{t("ops.prio.high")}</option>
                  <option value="urgent">{t("ops.prio.urgent")}</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">{t("ops.field.assignee")}</Label>
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
                  <option value="">{t("ops.assigneeLater")}</option>
                  {(meta.data?.staff || []).map((s: { id: number; fullName: string }) => (
                    <option key={s.id} value={s.id}>{s.fullName}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">{t("ops.field.desc")}</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <Button className="mt-4" onClick={submit} disabled={mut.create.isPending || !form.title.trim()}>
              <Plus className="h-4 w-4" /> {t("ops.submit")}
            </Button>
          </div>
        ) : (
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
                <div key={ticket.id} className="dept-ticket">
                  <div>
                    <p className="text-xs font-mono text-muted-foreground">{ticket.ticketNo}</p>
                    <p className="font-semibold text-foreground">{ticket.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {cats.find((c) => c.value === ticket.category)?.label || ticket.category} · {ticket.branchName || t("ui.branch")} · {t(PRIO_KEYS[ticket.priority] || "ops.prio.normal")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="dept-status">{t(STATUS_KEYS[ticket.status] || ticket.status)}</span>
                    {meta.data?.canManage ? (
                      <select
                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                        value={ticket.status}
                        onChange={(e) => mut.patch.mutate({ id: ticket.id, status: e.target.value })}
                      >
                        {Object.entries(STATUS_KEYS).map(([k, key]) => (
                          <option key={k} value={k}>{t(key)}</option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {!tickets.data?.length && !tickets.isLoading ? (
              <p className="dept-empty">{t("ops.empty")}</p>
            ) : null}
          </div>
        )}
      </div>
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
