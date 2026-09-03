import React, { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { isHrDirektor, isHrOversight, HR_ROLE_LABELS } from "@/lib/roles";
import {
  useKuzatuv,
  useKuzatuvPerson,
  useKuzatuvPeople,
  type KuzatuvTask,
  type PersonDetail,
  type KuzatuvPersonListItem,
} from "@/lib/kuzatuv-api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Eye,
  Briefcase,
  Users,
  Phone,
  ListTodo,
  CheckCircle2,
  Clock3,
  UserRound,
  Kanban,
  ArrowLeft,
  MapPin,
  Calendar,
  FileText,
  GraduationCap,
  Search,
  Building2,
  Network,
  UserCog,
} from "lucide-react";
import type { OrgEmployeeView } from "@/lib/kuzatuv-api";
import { useI18n } from "../../i18n/I18nProvider";

const STAGE_KEYS: Record<string, string> = {
  phone_interview: "kuzatuv.stage.phone_interview",
  online_interview: "kuzatuv.stage.online_interview",
  preboarding: "kuzatuv.stage.preboarding",
  offline_interview: "kuzatuv.stage.offline_interview",
  final_decision: "kuzatuv.stage.final_decision",
  offer: "kuzatuv.stage.offer",
  documents: "kuzatuv.stage.documents",
  internship: "kuzatuv.stage.internship",
  hired: "kuzatuv.stage.hired",
};

const STATUS_KEYS: Record<string, string> = {
  todo: "kuzatuv.task.todo",
  in_progress: "kuzatuv.task.in_progress",
  done: "kuzatuv.task.done",
  verified: "kuzatuv.task.verified",
  cancelled: "kuzatuv.task.cancelled",
};

const PRIORITY_KEYS: Record<string, string> = {
  low: "kuzatuv.prio.low",
  normal: "kuzatuv.prio.normal",
  high: "kuzatuv.prio.high",
  urgent: "kuzatuv.prio.urgent",
};

const ROLE_LABELS: Record<string, string> = {
  ...HR_ROLE_LABELS,
  admin: "Admin",
  recruiter: "Rekruter",
  trainer: "Trener",
  mentor: "Mentor",
  director: "Direktor",
  department_head: "Bo‘lim boshlig‘i",
  mudir: "Mudir",
  koordinator: "Koordinator",
  texnik: "Texnik",
  texnik_rahbar: "Texnik bo‘limi rahbari",
  it: "IT mutaxassisi",
  it_rahbar: "IT bo‘limi rahbari",
  ombor: "Ombor",
  sb: "SB operatori",
  sb_boshliq: "SB bo‘limi boshlig‘i",
  farmasevt: "Farmasevt",
  stajyor: "Stajyor",
  moliya: "Moliyachi",
  revizor: "Revizor-yig‘uvchi",
  reviziya_rahbar: "Reviziya bo‘limi rahbari",
};

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-2xl font-semibold text-foreground">{value}</p>
        </div>
        <span className="rounded-xl bg-muted p-2 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function formatDt(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDue(iso: string | null, noDue = "Muddat yo‘q") {
  if (!iso) return noDue;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function empStatusClass(status: string) {
  switch (status) {
    case "working":
      return "bg-emerald-50 text-emerald-800";
    case "new":
      return "bg-sky-50 text-sky-800";
    case "dismissed":
      return "bg-slate-200 text-foreground";
    case "need_hire":
      return "bg-amber-50 text-amber-900";
    case "searching":
      return "bg-orange-50 text-orange-900";
    default:
      return "bg-slate-100 text-foreground";
  }
}

function OrgPersonCard({ e }: { e: OrgEmployeeView }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{e.fullName}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-foreground">
              {e.orgRoleLabel}
            </span>
            {e.position ? <span>{e.position}</span> : null}
            {e.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {e.location}
              </span>
            ) : null}
            {e.managerName ? <span>Mudir: {e.managerName}</span> : null}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Smena: {e.shiftDisplay}
            {e.hiredAt ? ` · Ishga kirgan: ${e.hiredAt}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            empStatusClass(e.employmentStatus),
          )}
        >
          {e.employmentStatusLabel}
        </span>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
  empty,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
        {title}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {count}
        </span>
      </h3>
      {count === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function PersonChip({
  name,
  onClick,
}: {
  name: string;
  onClick?: () => void;
}) {
  if (!onClick) return <span className="font-medium text-foreground">{name}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-medium text-[#0b3a5c] underline-offset-2 hover:underline"
    >
      {name}
    </button>
  );
}

function TaskRow({
  task,
  full,
  onOpenPerson,
}: {
  task: KuzatuvTask;
  full: boolean;
  onOpenPerson?: (id: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{task.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Kimga:{" "}
            <PersonChip
              name={task.assigneeName}
              onClick={
                task.assigneeId && onOpenPerson
                  ? () => onOpenPerson(task.assigneeId!)
                  : undefined
              }
            />
            {" · "}
            Kimdan:{" "}
            <PersonChip
              name={task.createdByName}
              onClick={
                task.createdById && onOpenPerson
                  ? () => onOpenPerson(task.createdById!)
                  : undefined
              }
            />
          </p>
          {full && task.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
          ) : null}
          {full && task.completionNote ? (
            <p className="mt-1 text-xs text-emerald-700">Natija: {task.completionNote}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-foreground">
            {t(STATUS_KEYS[task.status] || task.status)}
          </span>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {t(PRIORITY_KEYS[task.priority] || task.priority)}
          </span>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{t("kuzatuv.due")} {formatDue(task.dueAt, t("kuzatuv.noDue"))}</p>
    </div>
  );
}

function PersonDossier({
  personId,
  onBack,
  full,
}: {
  personId: number;
  onBack: () => void;
  full: boolean;
}) {
  const { t } = useI18n();
  const { data, isLoading, error } = useKuzatuvPerson(personId, true);
  const [tab, setTab] = useState<
    "all" | "org" | "branches" | "audits" | "needs" | "tasks" | "vacancies" | "candidates" | "interviews"
  >("all");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Button type="button" variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> {t("kuzatuv.back")}
        </Button>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {(error as Error)?.message || t("kuzatuv.loadFail")}
        </div>
      </div>
    );
  }

  const p = data as PersonDetail;
  const managers = p.managedManagers ?? [];
  const staff = p.managedStaff ?? [];
  const branches = p.branches ?? [];
  const audits = p.audits ?? [];
  const needs = p.needs ?? [];
  const networkTasks = p.networkTasks ?? [];
  const isCoordOrMudir = p.person.role === "koordinator" || p.person.role === "mudir";
  const hasNetwork =
    isCoordOrMudir ||
    Boolean(p.employee) ||
    managers.length > 0 ||
    staff.length > 0 ||
    branches.length > 0 ||
    audits.length > 0 ||
    needs.length > 0 ||
    Boolean(p.person.departmentName);

  const staffByManager = new Map<number | "other", OrgEmployeeView[]>();
  for (const m of managers) staffByManager.set(m.id, []);
  for (const s of staff) {
    const mid = s.reportsToId && staffByManager.has(s.reportsToId) ? s.reportsToId : "other";
    const list = staffByManager.get(mid) ?? [];
    list.push(s);
    staffByManager.set(mid, list);
  }

  const tabs = [
    { id: "all" as const, label: t("kuzatuv.tab.all") },
    ...(hasNetwork
      ? [
          {
            id: "branches" as const,
            label: `${t("kuzatuv.tab.branches")} (${p.summary.branchesCount ?? branches.length})`,
          },
          {
            id: "audits" as const,
            label: `${t("kuzatuv.tab.audits")} (${p.summary.auditsCount ?? audits.length})`,
          },
          {
            id: "needs" as const,
            label: `${t("kuzatuv.tab.needs")} (${p.summary.needsOpen ?? 0}/${p.summary.needsTotal ?? needs.length})`,
          },
          {
            id: "org" as const,
            label: `${t("kuzatuv.tab.staff")} (${staff.length})`,
          },
        ]
      : []),
    {
      id: "tasks" as const,
      label: `${t("kuzatuv.tab.tasks")} (${
        isCoordOrMudir
          ? (p.summary.networkTasksOpen ?? 0) + (p.summary.networkTasksDone ?? 0) +
            p.summary.tasksAssignedOpen +
            p.summary.tasksAssignedDone
          : p.summary.tasksAssignedOpen + p.summary.tasksAssignedDone
      })`,
    },
    ...(!isCoordOrMudir
      ? [
          { id: "vacancies" as const, label: `${t("kuzatuv.tab.vacancies")} (${p.summary.vacanciesTotal})` },
          { id: "candidates" as const, label: `${t("kuzatuv.tab.candidates")} (${p.summary.candidatesTotal})` },
          {
            id: "interviews" as const,
            label: `${t("kuzatuv.tab.interviews")} (${p.summary.phoneInterviews + p.summary.onlineInterviews + p.summary.offlineInterviews})`,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button type="button" variant="ghost" onClick={onBack} className="-ml-2 mb-2 gap-2 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Kuzatuvga qaytish
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground">
              {p.person.fullName
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {p.person.fullName}
              </h1>
              <p className="text-sm text-muted-foreground">
                {p.person.roleLabel || ROLE_LABELS[p.person.role] || p.person.role}
                {p.person.departmentName ? ` · ${p.person.departmentName}` : ""}
                {full && p.person.login ? ` · @${p.person.login}` : ""}
                {full && p.person.phone ? ` · ${p.person.phone}` : ""}
                {" · "}
                {p.person.status === "active" ? "Faol" : p.person.status}
              </p>
              {p.employee ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.employee.orgRoleLabel}
                  {p.employee.location ? ` · ${p.employee.location}` : ""}
                  {" · "}
                  <span className={cn("rounded-full px-2 py-0.5 font-medium", empStatusClass(p.employee.employmentStatus))}>
                    {p.employee.employmentStatusLabel}
                  </span>
                </p>
              ) : null}
              {p.person.role === "mudir" && (p.coordinator || p.reportsTo) ? (
                <p className="mt-1.5 text-sm font-medium text-[#0b3a5c]">
                  Koordinator:{" "}
                  <span className="font-semibold">
                    {(p.coordinator || p.reportsTo)!.fullName}
                  </span>
                  {(p.coordinator || p.reportsTo)!.location
                    ? ` · ${(p.coordinator || p.reportsTo)!.location}`
                    : ""}
                </p>
              ) : null}
            </div>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {isCoordOrMudir
              ? "Shu koordinator/mudirga bog‘liq filiallar, mudirlar, checklist holati, ehtiyojlar va topshiriqlar — to‘liq kuzatuv."
              : t("kuzatuv.dossier.hint")}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isCoordOrMudir ? (
          <>
            <StatCard
              label={t("kuzatuv.stat.branches")}
              value={p.summary.branchesCount ?? branches.length}
              icon={Building2}
            />
            <StatCard
              label={t("kuzatuv.stat.audits")}
              value={p.summary.auditsCount ?? audits.length}
              icon={FileText}
            />
            <StatCard
              label={t("kuzatuv.stat.avgCheck")}
              value={p.summary.auditsAvgScore != null ? `${p.summary.auditsAvgScore}%` : "—"}
              icon={CheckCircle2}
            />
            <StatCard
              label={t("kuzatuv.stat.needs")}
              value={`${p.summary.needsOpen ?? 0} / ${p.summary.needsTotal ?? 0}`}
              icon={Briefcase}
            />
            <StatCard
              label={t("kuzatuv.stat.mudirTasks")}
              value={`${p.summary.networkTasksOpen ?? 0} / ${p.summary.networkTasksDone ?? 0}`}
              icon={ListTodo}
            />
            <StatCard label={t("kuzatuv.tab.staff")} value={p.summary.staffCount ?? staff.length} icon={Users} />
            {(p.summary.staffNeedHire ?? 0) > 0 ? (
              <StatCard label={t("kuzatuv.stat.staffNeed")} value={p.summary.staffNeedHire!} icon={UserCog} />
            ) : null}
          </>
        ) : (
          <>
            {p.person.departmentName ? (
              <StatCard label={t("kuzatuv.stat.dept")} value={p.person.departmentName} icon={Building2} />
            ) : null}
            <StatCard label={t("kuzatuv.stat.vacancies")} value={p.summary.vacanciesTotal} icon={Briefcase} />
            <StatCard label={t("kuzatuv.stat.activeVacancy")} value={p.summary.vacanciesPublished} icon={Briefcase} />
            <StatCard label={t("kuzatuv.stat.candidates")} value={p.summary.candidatesTotal} icon={Users} />
            <StatCard label={t("kuzatuv.stat.hired")} value={p.summary.candidatesHired} icon={CheckCircle2} />
            <StatCard label={t("kuzatuv.stat.phoneOne")} value={p.summary.phoneInterviews} icon={Phone} />
            <StatCard label={t("kuzatuv.stat.onlineOne")} value={p.summary.onlineInterviews} icon={Phone} />
            <StatCard label={t("kuzatuv.stat.offlineOne")} value={p.summary.offlineInterviews} icon={GraduationCap} />
            <StatCard
              label={t("kuzatuv.stat.taskOpenDone")}
              value={`${p.summary.tasksAssignedOpen} / ${p.summary.tasksAssignedDone}`}
              icon={ListTodo}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setTab(tabItem.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              tab === tabItem.id
                ? "bg-primary text-primary-foreground"
                : "bg-slate-100 text-muted-foreground hover:bg-slate-200",
            )}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {(tab === "all" || tab === "branches") && hasNetwork ? (
        <Section
          title={t("kuzatuv.sec.branches")}
          count={branches.length || managers.length}
          empty={t("kuzatuv.sec.branchesEmpty")}
        >
          {(branches.length ? branches : managers.map((m) => ({
            managerEmployeeId: m.id,
            managerName: m.fullName,
            location: m.location,
            employmentStatusLabel: m.employmentStatusLabel,
            employmentStatus: m.employmentStatus,
            shiftDisplay: m.shiftDisplay,
            staffCount: staffByManager.get(m.id)?.length ?? 0,
            auditsCount: 0,
            needsOpen: 0,
            needsTotal: 0,
            tasksOpen: 0,
            tasksDone: 0,
            latestAudit: null as null,
          }))).map((b) => (
            <div
              key={b.managerEmployeeId}
              className="rounded-2xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-foreground">{b.managerName}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {b.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {b.location}
                      </span>
                    ) : (
                      <span>{t("kuzatuv.noBranchShown")}</span>
                    )}
                    <span>{t("kuzatuv.staffLabel")} {b.staffCount}</span>
                    <span>Smena: {b.shiftDisplay}</span>
                  </p>
                </div>
                {"employmentStatus" in b && b.employmentStatus ? (
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      empStatusClass(String(b.employmentStatus)),
                    )}
                  >
                    {b.employmentStatusLabel}
                  </span>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-muted px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Checklist</p>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">
                    {b.latestAudit
                      ? `${b.latestAudit.scorePercent}% · ${b.latestAudit.visitDate}`
                      : "Tashrif yo‘q"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{b.auditsCount} ta tashrif</p>
                </div>
                <div className="rounded-xl bg-amber-50/70 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-amber-700/70">Ehtiyoj</p>
                  <p className="mt-0.5 text-sm font-semibold text-amber-950">
                    {b.needsOpen} ochiq / {b.needsTotal} jami
                  </p>
                </div>
                <div className="rounded-xl bg-sky-50/70 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-sky-700/70">Topshiriqlar</p>
                  <p className="mt-0.5 text-sm font-semibold text-sky-950">
                    {b.tasksOpen} ochiq / {b.tasksDone} bajarilgan
                  </p>
                </div>
              </div>
              {b.latestAudit ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Oxirgi checklist: {b.latestAudit.visitName} · Ha {b.latestAudit.yesCount} / Yo‘q{" "}
                  {b.latestAudit.noCount} (jami {b.latestAudit.totalCount})
                </p>
              ) : null}
            </div>
          ))}
        </Section>
      ) : null}

      {(tab === "all" || tab === "audits") && hasNetwork ? (
        <Section
          title={t("kuzatuv.sec.audits")}
          count={audits.length}
          empty={t("kuzatuv.sec.auditsEmpty")}
        >
          {audits.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div>
                <p className="font-medium text-foreground">
                  {a.branchLocation || t("ui.branch")} · {a.managerName || t("admin.holatDash.mudir")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {a.visitDate} · {a.visitName}
                  {a.createdAt ? ` · ${formatDt(a.createdAt)}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ha: {a.yesCount} · Yo‘q: {a.noCount} · Javob: {a.answeredCount}/{a.totalCount}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                  a.scorePercent >= 80
                    ? "bg-emerald-50 text-emerald-800"
                    : a.scorePercent >= 50
                      ? "bg-amber-50 text-amber-900"
                      : "bg-red-50 text-red-700",
                )}
              >
                {a.scorePercent}%
              </span>
            </div>
          ))}
        </Section>
      ) : null}

      {(tab === "all" || tab === "needs") && hasNetwork ? (
        <Section title={t("kuzatuv.sec.needs")} count={needs.length} empty={t("kuzatuv.sec.needsEmpty")}>
          {needs.map((n) => (
            <div
              key={n.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div>
                <p className="font-medium text-foreground">{n.needType}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {n.branchLocation || "—"}
                  {n.managerName ? ` · ${n.managerName}` : ""}
                </p>
                {n.note ? <p className="mt-1 text-sm text-muted-foreground">{n.note}</p> : null}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Yaratilgan: {formatDt(n.createdAt)}
                  {n.verifiedAt ? ` · Tasdiq: ${formatDt(n.verifiedAt)}` : ""}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-foreground">
                {n.statusLabel}
              </span>
            </div>
          ))}
        </Section>
      ) : null}

      {(tab === "all" || tab === "org") && hasNetwork ? (
        <>
          {p.person.departmentName || p.employee ? (
            <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
                <Building2 className="h-4 w-4 text-[#0b3a5c]" />
                {t("kuzatuv.profileTitle")}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Bo‘lim</p>
                  <p className="font-medium text-foreground">{p.person.departmentName || "—"}</p>
                </div>
                {p.employee ? (
                  <>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Org rol</p>
                      <p className="font-medium text-foreground">{p.employee.orgRoleLabel}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Lavozim</p>
                      <p className="font-medium text-foreground">{p.employee.position || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Filial / joy</p>
                      <p className="font-medium text-foreground">{p.employee.location || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Holat</p>
                      <p>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                            empStatusClass(p.employee.employmentStatus),
                          )}
                        >
                          {p.employee.employmentStatusLabel}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Smena</p>
                      <p className="font-medium text-foreground">{p.employee.shiftDisplay}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Ishga kirgan</p>
                      <p className="font-medium text-foreground">{p.employee.hiredAt || "—"}</p>
                    </div>
                  </>
                ) : null}
                {p.reportsTo || p.coordinator ? (
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {p.person.role === "mudir" ? "Koordinator" : "Kimga bo‘ysunadi"}
                    </p>
                    <p className="font-medium text-foreground">
                      {(p.coordinator || p.reportsTo)!.fullName}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ({(p.coordinator || p.reportsTo)!.orgRoleLabel}
                        {(p.coordinator || p.reportsTo)!.location
                          ? ` · ${(p.coordinator || p.reportsTo)!.location}`
                          : ""}
                        )
                      </span>
                    </p>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {managers.length > 0 ? (
            <Section
              title={t("kuzatuv.sec.managers")}
              count={managers.length}
              empty={t("kuzatuv.sec.managersEmpty")}
            >
              {managers.map((m) => {
                const under = staffByManager.get(m.id) ?? [];
                return (
                  <div key={m.id} className="space-y-2 rounded-2xl border border-border bg-muted/80 p-3">
                    <OrgPersonCard e={m} />
                    {under.length > 0 ? (
                      <div className="ml-2 space-y-2 border-l-2 border-[#0b3a5c]/20 pl-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Shu mudirning xodimlari ({under.length})
                        </p>
                        {under.map((s) => (
                          <OrgPersonCard key={s.id} e={s} />
                        ))}
                      </div>
                    ) : (
                      <p className="px-2 text-xs text-muted-foreground">
                        Bu mudir ostida hali farmasevt/stajyor yo‘q
                      </p>
                    )}
                  </div>
                );
              })}
            </Section>
          ) : null}

          {managers.length === 0 && staff.length > 0 ? (
            <Section
              title={t("kuzatuv.sec.managedStaff")}
              count={staff.length}
              empty={t("kuzatuv.sec.managedEmpty")}
            >
              {staff.map((s) => (
                <OrgPersonCard key={s.id} e={s} />
              ))}
            </Section>
          ) : null}

          {managers.length > 0 && (staffByManager.get("other")?.length ?? 0) > 0 ? (
            <Section
              title={t("kuzatuv.sec.otherStaff")}
              count={staffByManager.get("other")!.length}
              empty=""
            >
              {staffByManager.get("other")!.map((s) => (
                <OrgPersonCard key={s.id} e={s} />
              ))}
            </Section>
          ) : null}
        </>
      ) : null}

      {(tab === "all" || tab === "tasks") && (
        <>
          {networkTasks.length > 0 || isCoordOrMudir ? (
            <Section
              title={t("kuzatuv.sec.networkTasks")}
              count={networkTasks.length}
              empty={t("kuzatuv.sec.networkEmpty")}
            >
              {networkTasks.map((task) => (
                <div key={task.id} className="rounded-xl border border-border bg-card px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">{task.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Mudir: <span className="font-medium text-foreground">{task.assigneeName}</span>
                        {" · "}
                        Kimdan: {task.createdByName}
                      </p>
                      {task.completionNote ? (
                        <p className="mt-1 text-xs text-emerald-700">Natija: {task.completionNote}</p>
                      ) : null}
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium">
                      {task.statusLabel}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {t("kuzatuv.due")} {formatDue(task.dueAt, t("kuzatuv.noDue"))}
                    {task.completedAt ? ` · Bajarilgan: ${formatDt(task.completedAt)}` : ""}
                  </p>
                </div>
              ))}
            </Section>
          ) : null}

          <Section
            title={t("kuzatuv.sec.assigned")}
            count={p.tasksAssigned.length}
            empty={t("kuzatuv.sec.assignedEmpty")}
          >
            {p.tasksAssigned.map((task) => (
              <div key={task.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Kimdan: <span className="font-medium text-foreground">{task.createdByName}</span>
                    </p>
                    {task.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                    ) : null}
                    {task.completionNote ? (
                      <p className="mt-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                        Natija / hisobot: {task.completionNote}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-foreground">
                      {task.statusLabel}
                    </span>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      {t(PRIORITY_KEYS[task.priority] || task.priority)}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{t("kuzatuv.due")} {formatDue(task.dueAt, t("kuzatuv.noDue"))}</span>
                  <span>Yaratilgan: {formatDt(task.createdAt)}</span>
                  {task.acceptedAt ? <span>Qabul: {formatDt(task.acceptedAt)}</span> : null}
                  {task.completedAt ? <span>Bajarilgan: {formatDt(task.completedAt)}</span> : null}
                </div>
              </div>
            ))}
          </Section>

          {full ? (
            <Section
              title={t("kuzatuv.sec.given")}
              count={p.tasksCreated.length}
              empty={t("kuzatuv.sec.givenEmpty")}
            >
              {p.tasksCreated.map((task) => (
                <div key={task.id} className="rounded-xl border border-border bg-card px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">{task.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Kimga: <span className="font-medium text-foreground">{task.assigneeName}</span>
                      </p>
                      {task.description ? (
                        <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                      ) : null}
                      {task.completionNote ? (
                        <p className="mt-1 text-xs text-emerald-700">Natija: {task.completionNote}</p>
                      ) : null}
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium">
                      {task.statusLabel}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">{t("kuzatuv.due")} {formatDue(task.dueAt, t("kuzatuv.noDue"))}</p>
                </div>
              ))}
            </Section>
          ) : null}
        </>
      )}

      {!isCoordOrMudir && (tab === "all" || tab === "vacancies") && (
        <Section
          title={t("kuzatuv.sec.vacancies")}
          count={p.vacancies.length}
          empty={t("kuzatuv.sec.vacanciesEmpty")}
        >
          {p.vacancies.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div>
                <Link href={`/vacancies/${v.id}`} className="font-medium text-[#0b3a5c] hover:underline">
                  {v.title}
                </Link>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {v.location ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {v.location}
                    </span>
                  ) : null}
                  <span>Yaratilgan: {formatDt(v.createdAt)}</span>
                  {v.deadline ? <span>Muddat: {formatDt(v.deadline)}</span> : null}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                  v.status === "published"
                    ? "bg-emerald-50 text-emerald-800"
                    : v.status === "closed"
                      ? "bg-muted dark:bg-slate-800 text-foreground dark:text-white"
                      : "bg-amber-50 text-amber-800",
                )}
              >
                {v.statusLabel}
              </span>
            </div>
          ))}
        </Section>
      )}

      {!isCoordOrMudir && (tab === "all" || tab === "candidates") && (
        <Section title={t("kuzatuv.sec.candidates")} count={p.candidates.length} empty={t("kuzatuv.sec.candidatesEmpty")}>
          {p.candidates.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <div>
                <Link
                  href={`/candidates/${c.id}`}
                  className="font-medium text-[#0b3a5c] hover:underline"
                >
                  {c.fullName}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {c.vacancyTitle}
                  {c.phone ? ` · ${c.phone}` : ""}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("kuzatuv.updated")} {formatDt(c.updatedAt)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800">
                  {c.stageLabel}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    c.status === "hired"
                      ? "bg-emerald-50 text-emerald-800"
                      : c.status === "rejected"
                        ? "bg-red-50 text-red-700"
                        : "bg-slate-100 text-foreground",
                  )}
                >
                  {c.statusLabel}
                </span>
              </div>
            </div>
          ))}
        </Section>
      )}

      {!isCoordOrMudir && (tab === "all" || tab === "interviews") && (
        <>
          <Section
            title={t("kuzatuv.sec.phone")}
            count={p.phoneInterviews.length}
            empty={t("kuzatuv.sec.phoneEmpty")}
          >
            {p.phoneInterviews.map((i) => (
              <div key={i.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/candidates/${i.candidateId}`}
                      className="font-medium text-[#0b3a5c] hover:underline"
                    >
                      {i.candidateName}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Sana: {i.interviewDate || "—"} · {formatDt(i.createdAt)}
                    </p>
                    {i.notes ? <p className="mt-1 text-sm text-muted-foreground">{i.notes}</p> : null}
                    {i.rejectReason ? (
                      <p className="mt-1 text-xs text-red-600">Sabab: {i.rejectReason}</p>
                    ) : null}
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium">
                    {i.statusLabel}
                  </span>
                </div>
              </div>
            ))}
          </Section>

          <Section
            title={t("kuzatuv.sec.online")}
            count={p.onlineInterviews.length}
            empty={t("kuzatuv.sec.onlineEmpty")}
          >
            {p.onlineInterviews.map((i) => (
              <div key={i.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/candidates/${i.candidateId}`}
                      className="font-medium text-[#0b3a5c] hover:underline"
                    >
                      {i.candidateName}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Sana: {i.interviewDate || "—"}
                      {i.experienceLevel ? ` · ${i.experienceLevel}` : ""}
                    </p>
                    {i.notes ? <p className="mt-1 text-sm text-muted-foreground">{i.notes}</p> : null}
                  </div>
                  {i.score != null ? (
                    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                      Ball: {i.score}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </Section>

          <Section
            title={t("kuzatuv.sec.offline")}
            count={p.offlineInterviews.length}
            empty={t("kuzatuv.sec.offlineEmpty")}
          >
            {p.offlineInterviews.map((i) => (
              <div key={`${i.roleInInterview}-${i.id}`} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/candidates/${i.candidateId}`}
                      className="font-medium text-[#0b3a5c] hover:underline"
                    >
                      {i.candidateName}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <Calendar className="mr-1 inline h-3 w-3" />
                      {i.scheduledDate}
                      {i.scheduledTime ? ` ${i.scheduledTime}` : ""}
                      {" · "}
                      {t("kuzatuv.roleIn")} {i.roleInInterview === "hr" ? "HR" : "Trener"}
                    </p>
                    {i.resultNotes ? (
                      <p className="mt-1 text-sm text-muted-foreground">{i.resultNotes}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1 text-[11px]">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">
                      {i.attendanceStatus}
                    </span>
                    {i.result ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
                        {i.result}
                      </span>
                    ) : null}
                    {i.hrScore != null ? <span>{t("kuzatuv.hrScore")} {i.hrScore}</span> : null}
                    {i.trainerScore != null ? <span>{t("kuzatuv.trainerScore")} {i.trainerScore}</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </Section>
        </>
      )}
    </div>
  );
}

export default function KuzatuvPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const allowed = isHrOversight(user?.role) || user?.role === "admin";
  const full = isHrDirektor(user?.role) || user?.role === "admin";
  const { data, isLoading, error } = useKuzatuv(allowed);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [peopleQ, setPeopleQ] = useState("");
  const [peopleRole, setPeopleRole] = useState("all");
  const [debouncedQ, setDebouncedQ] = useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(peopleQ.trim()), 250);
    return () => clearTimeout(t);
  }, [peopleQ]);

  const { data: peopleData, isLoading: peopleLoading } = useKuzatuvPeople(
    { q: debouncedQ || undefined, role: peopleRole },
    allowed,
  );

  React.useEffect(() => {
    if (user && !allowed) setLocation("/dashboard");
  }, [user, allowed, setLocation]);

  if (!user || !allowed) {
    return <div className="p-8 text-center text-muted-foreground">{t("kuzatuv.noAccess")}</div>;
  }

  if (selectedPersonId != null) {
    return (
      <div className="space-y-6">
        <PersonDossier
          personId={selectedPersonId}
          onBack={() => setSelectedPersonId(null)}
          full={full}
        />
      </div>
    );
  }

  const people = peopleData?.people ?? [];
  const roleOptions = peopleData?.roles ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 flex items-center gap-2 text-[#0b3a5c]">
          <Eye className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {full ? t("kuzatuv.eyebrow.dir") : t("kuzatuv.eyebrow.aud")}
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{t("kuzatuv.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t("kuzatuv.subtitle")}
        </p>
      </div>

      {/* Xodim tanlash */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">{t("kuzatuv.pickStaff")}</h2>
          <span className="text-xs text-muted-foreground">
            {peopleLoading ? t("ui.loading") : `${people.length} ${t("kuzatuv.staffCount")}`}
          </span>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={peopleQ}
              onChange={(e) => setPeopleQ(e.target.value)}
              placeholder={t("kuzatuv.search")}
              className="h-11 pl-9"
            />
          </div>
          <Select value={peopleRole} onValueChange={setPeopleRole}>
            <SelectTrigger className="h-11 w-full sm:w-[220px]">
              <SelectValue placeholder={t("ui.position")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("ui.allPositions")}</SelectItem>
              {roleOptions.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-4 max-h-[360px] space-y-1 overflow-y-auto rounded-xl border border-slate-100 bg-muted/60 p-1.5">
          {peopleLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : people.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("kuzatuv.noStaff")}
            </p>
          ) : (
            people.map((p: KuzatuvPersonListItem) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedPersonId(p.id)}
                className="flex w-full items-center gap-3 rounded-xl bg-card px-3 py-3 text-left shadow-sm ring-1 ring-slate-200/70 transition hover:ring-[#0b3a5c]/40 hover:shadow-md"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
                  {p.fullName
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-foreground">{p.fullName}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-foreground">
                      {p.roleLabel}
                    </span>
                    {p.departmentName ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Building2 className="h-3 w-3" />
                        {p.departmentName}
                      </span>
                    ) : null}
                    {full && p.login ? <span>@{p.login}</span> : null}
                    <span>
                      {t("kuzatuv.tasksShort")}{" "}
                      <span className="text-amber-700">{p.tasksOpen}</span>
                      {" / "}
                      <span className="text-emerald-700">{p.tasksDone}</span>
                    </span>
                  </span>
                </span>
                <span className="hidden shrink-0 text-xs font-medium text-[#0b3a5c] sm:inline">
                  {t("kuzatuv.openFull")}
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {(error as Error).message}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t("kuzatuv.stat.openReq")} value={data.summary.openRequests} icon={Briefcase} />
            <StatCard
              label={t("kuzatuv.stat.activeVac")}
              value={data.summary.activeVacancies}
              icon={Briefcase}
            />
            <StatCard
              label={t("kuzatuv.stat.activeCand")}
              value={data.summary.activeCandidates}
              icon={Users}
            />
            <StatCard
              label={t("kuzatuv.stat.hired")}
              value={data.summary.hiredCandidates}
              icon={CheckCircle2}
            />
            <StatCard
              label={t("kuzatuv.stat.phone")}
              value={data.summary.phoneInterviews}
              icon={Phone}
            />
            {full && data.summary.onlineInterviews != null ? (
              <StatCard
                label={t("kuzatuv.stat.online")}
                value={data.summary.onlineInterviews}
                icon={Phone}
              />
            ) : null}
            {full && data.summary.offlineInterviews != null ? (
              <StatCard
                label={t("kuzatuv.stat.offline")}
                value={data.summary.offlineInterviews}
                icon={Users}
              />
            ) : null}
            <StatCard label={t("kuzatuv.stat.tasksOpen")} value={data.summary.tasksOpen} icon={ListTodo} />
            <StatCard label={t("kuzatuv.stat.tasksDone")} value={data.summary.tasksDone} icon={Clock3} />
            <StatCard
              label={t("kuzatuv.stat.recruiters")}
              value={data.summary.recruitersCount}
              icon={UserRound}
            />
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">{t("kuzatuv.recruitersTitle")}</h2>
            <p className="text-xs text-muted-foreground">{t("kuzatuv.recruitersHint")}</p>
            <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t("kuzatuv.col.recruiter")}</th>
                    <th className="px-4 py-3 font-medium">{t("kuzatuv.col.vacancy")}</th>
                    <th className="px-4 py-3 font-medium">{t("kuzatuv.col.active")}</th>
                    <th className="px-4 py-3 font-medium">{t("kuzatuv.col.interview")}</th>
                    <th className="px-4 py-3 font-medium">{t("kuzatuv.col.hired")}</th>
                    <th className="px-4 py-3 font-medium">{t("kuzatuv.col.task")}</th>
                    {full ? <th className="px-4 py-3 font-medium">{t("kuzatuv.col.extra")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.recruiters.length === 0 ? (
                    <tr>
                      <td colSpan={full ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">
                        {t("kuzatuv.noRecruiter")}
                      </td>
                    </tr>
                  ) : (
                    data.recruiters.map((r) => (
                      <tr
                        key={r.id}
                        className="cursor-pointer border-b last:border-0 hover:bg-[#0b3a5c]/5"
                        onClick={() => setSelectedPersonId(r.id)}
                      >
                        <td className="px-4 py-3 font-medium text-[#0b3a5c]">
                          {r.fullName}
                          <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                            Rekruter · Batafsil →
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {r.vacanciesPublished}
                          <span className="text-muted-foreground"> / {r.vacanciesTotal}</span>
                        </td>
                        <td className="px-4 py-3">{r.candidatesActive}</td>
                        <td className="px-4 py-3">{r.phoneInterviews}</td>
                        <td className="px-4 py-3">{r.candidatesHired}</td>
                        <td className="px-4 py-3">
                          <span className="text-amber-700">{r.tasksOpen}</span>
                          {" / "}
                          <span className="text-emerald-700">{r.tasksDone}</span>
                        </td>
                        {full ? (
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            rad: {r.candidatesRejected ?? 0}
                            {r.offlineInterviews != null ? ` · offline: ${r.offlineInterviews}` : ""}
                            {r.vacanciesClosed != null ? ` · yopilgan: ${r.vacanciesClosed}` : ""}
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {full && data.pipeline && data.pipeline.length > 0 ? (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Kanban className="h-5 w-5" /> Pipeline
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {data.pipeline.map((p) => (
                  <div
                    key={p.stage}
                    className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm"
                  >
                    <p className="text-xs text-muted-foreground">{t(STAGE_KEYS[p.stage] || p.stage)}</p>
                    <p className="mt-1 text-xl font-semibold text-foreground">{p.count}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <FileText className="h-5 w-5" />
              Vazifalar {full ? "(to‘liq)" : "(so‘nggi)"}
            </h2>
            <p className="text-xs text-muted-foreground">Ismni bosing — shu odamning dossieri ochiladi</p>
            <div className="space-y-2">
              {data.tasks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Vazifa yo‘q
                </p>
              ) : (
                data.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    full={full}
                    onOpenPerson={setSelectedPersonId}
                  />
                ))
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
