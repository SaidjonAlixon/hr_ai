import React, { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { isHrDirektor, isHrOversight, HR_ROLE_LABELS } from "@/lib/roles";
import {
  useKuzatuv,
  useKuzatuvPerson,
  type KuzatuvTask,
  type PersonDetail,
} from "@/lib/kuzatuv-api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";

const STAGE_LABELS: Record<string, string> = {
  phone_interview: "Tanishuv",
  online_interview: "Onlayn suhbat",
  preboarding: "Pre-boarding",
  offline_interview: "Offline suhbat",
  final_decision: "Yakuniy qaror",
  offer: "Job offer",
  documents: "Hujjatlar",
  internship: "Stajirovka",
  hired: "Ishga qabul",
};

const STATUS_LABEL: Record<string, string> = {
  todo: "Yangi",
  in_progress: "Jarayonda",
  done: "Bajarildi",
  verified: "Tasdiqlangan",
  cancelled: "Bekor",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "Past",
  normal: "Oddiy",
  high: "Yuqori",
  urgent: "Shoshilinch",
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
  ombor: "Ombor",
  farmasevt: "Farmasevt",
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
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
        </div>
        <span className="rounded-xl bg-slate-50 p-2 text-slate-600">
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

function formatDue(iso: string | null) {
  if (!iso) return "Muddat yo‘q";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
      <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        {title}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {count}
        </span>
      </h3>
      {count === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-400">
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
  if (!onClick) return <span className="font-medium text-slate-700">{name}</span>;
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
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{task.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
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
            <p className="mt-1 text-sm text-slate-600">{task.description}</p>
          ) : null}
          {full && task.completionNote ? (
            <p className="mt-1 text-xs text-emerald-700">Natija: {task.completionNote}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
            {STATUS_LABEL[task.status] || task.status}
          </span>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {PRIORITY_LABEL[task.priority] || task.priority}
          </span>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">Muddat: {formatDue(task.dueAt)}</p>
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
  const { data, isLoading, error } = useKuzatuvPerson(personId, true);
  const [tab, setTab] = useState<"all" | "tasks" | "vacancies" | "candidates" | "interviews">(
    "all",
  );

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
          <ArrowLeft className="h-4 w-4" /> Orqaga
        </Button>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {(error as Error)?.message || "Yuklanmadi"}
        </div>
      </div>
    );
  }

  const p = data as PersonDetail;
  const tabs = [
    { id: "all" as const, label: "Hammasi" },
    { id: "tasks" as const, label: `Vazifalar (${p.summary.tasksAssignedOpen + p.summary.tasksAssignedDone})` },
    { id: "vacancies" as const, label: `Vakansiyalar (${p.summary.vacanciesTotal})` },
    { id: "candidates" as const, label: `Nomzodlar (${p.summary.candidatesTotal})` },
    { id: "interviews" as const, label: `Suhbatlar (${p.summary.phoneInterviews + p.summary.onlineInterviews + p.summary.offlineInterviews})` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button type="button" variant="ghost" onClick={onBack} className="-ml-2 mb-2 gap-2 text-slate-600">
            <ArrowLeft className="h-4 w-4" /> Kuzatuvga qaytish
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0b3a5c] text-lg font-bold text-white">
              {p.person.fullName
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                {p.person.fullName}
              </h1>
              <p className="text-sm text-slate-500">
                {ROLE_LABELS[p.person.role] || p.person.role}
                {full && p.person.login ? ` · @${p.person.login}` : ""}
                {full && p.person.phone ? ` · ${p.person.phone}` : ""}
                {" · "}
                {p.person.status === "active" ? "Faol" : p.person.status}
              </p>
            </div>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Ushbu odamga biriktirilgan vazifalar, vakansiyalar, nomzodlar, suhbatlar va natijalar —
            to‘liq ko‘rinish.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Vakansiyalar" value={p.summary.vacanciesTotal} icon={Briefcase} />
        <StatCard label="Faol vakansiya" value={p.summary.vacanciesPublished} icon={Briefcase} />
        <StatCard label="Nomzodlar" value={p.summary.candidatesTotal} icon={Users} />
        <StatCard label="Ishga olingan" value={p.summary.candidatesHired} icon={CheckCircle2} />
        <StatCard label="Telefon suhbat" value={p.summary.phoneInterviews} icon={Phone} />
        <StatCard label="Onlayn suhbat" value={p.summary.onlineInterviews} icon={Phone} />
        <StatCard label="Offline suhbat" value={p.summary.offlineInterviews} icon={GraduationCap} />
        <StatCard
          label="Vazifa (ochiq / bajarilgan)"
          value={`${p.summary.tasksAssignedOpen} / ${p.summary.tasksAssignedDone}`}
          icon={ListTodo}
        />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-[#0b3a5c] text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(tab === "all" || tab === "tasks") && (
        <>
          <Section
            title="Biriktirilgan vazifalar (unga qo‘yilgan)"
            count={p.tasksAssigned.length}
            empty="Bu odamga vazifa biriktirilmagan"
          >
            {p.tasksAssigned.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{t.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Kimdan: <span className="font-medium text-slate-700">{t.createdByName}</span>
                    </p>
                    {t.description ? (
                      <p className="mt-1 text-sm text-slate-600">{t.description}</p>
                    ) : null}
                    {t.completionNote ? (
                      <p className="mt-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                        Natija / hisobot: {t.completionNote}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                      {t.statusLabel}
                    </span>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      {PRIORITY_LABEL[t.priority] || t.priority}
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                  <span>Muddat: {formatDue(t.dueAt)}</span>
                  <span>Yaratilgan: {formatDt(t.createdAt)}</span>
                  {t.acceptedAt ? <span>Qabul: {formatDt(t.acceptedAt)}</span> : null}
                  {t.completedAt ? <span>Bajarilgan: {formatDt(t.completedAt)}</span> : null}
                </div>
              </div>
            ))}
          </Section>

          {full ? (
            <Section
              title="U bergan vazifalar (boshqalarga)"
              count={p.tasksCreated.length}
              empty="Bu odam boshqalarga vazifa bermagan"
            >
              {p.tasksCreated.map((t) => (
                <div key={t.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{t.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Kimga: <span className="font-medium text-slate-700">{t.assigneeName}</span>
                      </p>
                      {t.description ? (
                        <p className="mt-1 text-sm text-slate-600">{t.description}</p>
                      ) : null}
                      {t.completionNote ? (
                        <p className="mt-1 text-xs text-emerald-700">Natija: {t.completionNote}</p>
                      ) : null}
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium">
                      {t.statusLabel}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">Muddat: {formatDue(t.dueAt)}</p>
                </div>
              ))}
            </Section>
          ) : null}
        </>
      )}

      {(tab === "all" || tab === "vacancies") && (
        <Section
          title="Vakansiyalar"
          count={p.vacancies.length}
          empty="Vakansiya biriktirilmagan"
        >
          {p.vacancies.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
            >
              <div>
                <Link href={`/vacancies/${v.id}`} className="font-medium text-[#0b3a5c] hover:underline">
                  {v.title}
                </Link>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
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
                      ? "bg-slate-800 text-white"
                      : "bg-amber-50 text-amber-800",
                )}
              >
                {v.statusLabel}
              </span>
            </div>
          ))}
        </Section>
      )}

      {(tab === "all" || tab === "candidates") && (
        <Section title="Nomzodlar" count={p.candidates.length} empty="Nomzod yo‘q">
          {p.candidates.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
            >
              <div>
                <Link
                  href={`/candidates/${c.id}`}
                  className="font-medium text-[#0b3a5c] hover:underline"
                >
                  {c.fullName}
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">
                  {c.vacancyTitle}
                  {c.phone ? ` · ${c.phone}` : ""}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Yangilangan: {formatDt(c.updatedAt)}
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
                        : "bg-slate-100 text-slate-700",
                  )}
                >
                  {c.statusLabel}
                </span>
              </div>
            </div>
          ))}
        </Section>
      )}

      {(tab === "all" || tab === "interviews") && (
        <>
          <Section
            title="Telefon suhbatlar"
            count={p.phoneInterviews.length}
            empty="Telefon suhbat yo‘q"
          >
            {p.phoneInterviews.map((i) => (
              <div key={i.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/candidates/${i.candidateId}`}
                      className="font-medium text-[#0b3a5c] hover:underline"
                    >
                      {i.candidateName}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Sana: {i.interviewDate || "—"} · {formatDt(i.createdAt)}
                    </p>
                    {i.notes ? <p className="mt-1 text-sm text-slate-600">{i.notes}</p> : null}
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
            title="Onlayn suhbatlar"
            count={p.onlineInterviews.length}
            empty="Onlayn suhbat yo‘q"
          >
            {p.onlineInterviews.map((i) => (
              <div key={i.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/candidates/${i.candidateId}`}
                      className="font-medium text-[#0b3a5c] hover:underline"
                    >
                      {i.candidateName}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Sana: {i.interviewDate || "—"}
                      {i.experienceLevel ? ` · ${i.experienceLevel}` : ""}
                    </p>
                    {i.notes ? <p className="mt-1 text-sm text-slate-600">{i.notes}</p> : null}
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
            title="Offline suhbatlar"
            count={p.offlineInterviews.length}
            empty="Offline suhbat yo‘q"
          >
            {p.offlineInterviews.map((i) => (
              <div key={`${i.roleInInterview}-${i.id}`} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/candidates/${i.candidateId}`}
                      className="font-medium text-[#0b3a5c] hover:underline"
                    >
                      {i.candidateName}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <Calendar className="mr-1 inline h-3 w-3" />
                      {i.scheduledDate}
                      {i.scheduledTime ? ` ${i.scheduledTime}` : ""}
                      {" · "}
                      Rol: {i.roleInInterview === "hr" ? "HR" : "Trener"}
                    </p>
                    {i.resultNotes ? (
                      <p className="mt-1 text-sm text-slate-600">{i.resultNotes}</p>
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
                    {i.hrScore != null ? <span>HR ball: {i.hrScore}</span> : null}
                    {i.trainerScore != null ? <span>Trener ball: {i.trainerScore}</span> : null}
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
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const allowed = isHrOversight(user?.role) || user?.role === "admin";
  const full = isHrDirektor(user?.role) || user?.role === "admin";
  const { data, isLoading, error } = useKuzatuv(allowed);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);

  React.useEffect(() => {
    if (user && !allowed) setLocation("/dashboard");
  }, [user, allowed, setLocation]);

  if (!user || !allowed) {
    return <div className="p-8 text-center text-slate-500">Ruxsat yo‘q…</div>;
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

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 flex items-center gap-2 text-[#0b3a5c]">
          <Eye className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {full ? "HR Direktor" : "HR Auditor"}
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Kuzatuv</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Rekruter yoki istalgan ishtirokchini bosing — vazifalar, ish hajmi, suhbatlar va natijalar
          to‘liq ochiladi.
        </p>
      </div>

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
            <StatCard label="Ochiq arizalar" value={data.summary.openRequests} icon={Briefcase} />
            <StatCard
              label="Faol vakansiyalar"
              value={data.summary.activeVacancies}
              icon={Briefcase}
            />
            <StatCard
              label="Faol nomzodlar"
              value={data.summary.activeCandidates}
              icon={Users}
            />
            <StatCard
              label="Ishga olingan"
              value={data.summary.hiredCandidates}
              icon={CheckCircle2}
            />
            <StatCard
              label="Telefon suhbatlar"
              value={data.summary.phoneInterviews}
              icon={Phone}
            />
            {full && data.summary.onlineInterviews != null ? (
              <StatCard
                label="Onlayn suhbatlar"
                value={data.summary.onlineInterviews}
                icon={Phone}
              />
            ) : null}
            {full && data.summary.offlineInterviews != null ? (
              <StatCard
                label="Offline suhbatlar"
                value={data.summary.offlineInterviews}
                icon={Users}
              />
            ) : null}
            <StatCard label="Ochiq vazifalar" value={data.summary.tasksOpen} icon={ListTodo} />
            <StatCard label="Bajarilgan vazifalar" value={data.summary.tasksDone} icon={Clock3} />
            <StatCard
              label="Rekruterlar"
              value={data.summary.recruitersCount}
              icon={UserRound}
            />
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">Rekruterlar ishi</h2>
            <p className="text-xs text-slate-500">Qatorni bosing — to‘liq dossier ochiladi</p>
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Rekruter</th>
                    <th className="px-4 py-3 font-medium">Vakansiya</th>
                    <th className="px-4 py-3 font-medium">Faol</th>
                    <th className="px-4 py-3 font-medium">Suhbat</th>
                    <th className="px-4 py-3 font-medium">Ishga olindi</th>
                    <th className="px-4 py-3 font-medium">Vazifa</th>
                    {full ? <th className="px-4 py-3 font-medium">Qo‘shimcha</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.recruiters.length === 0 ? (
                    <tr>
                      <td colSpan={full ? 7 : 6} className="px-4 py-8 text-center text-slate-400">
                        Rekruter topilmadi
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
                          {full && r.login ? (
                            <span className="mt-0.5 block text-xs font-normal text-slate-400">
                              @{r.login}
                            </span>
                          ) : null}
                          <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                            Batafsil ochish →
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {r.vacanciesPublished}
                          <span className="text-slate-400"> / {r.vacanciesTotal}</span>
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
                          <td className="px-4 py-3 text-xs text-slate-500">
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
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Kanban className="h-5 w-5" /> Pipeline
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {data.pipeline.map((p) => (
                  <div
                    key={p.stage}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                  >
                    <p className="text-xs text-slate-500">{STAGE_LABELS[p.stage] || p.stage}</p>
                    <p className="mt-1 text-xl font-semibold text-slate-900">{p.count}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <FileText className="h-5 w-5" />
              Vazifalar {full ? "(to‘liq)" : "(so‘nggi)"}
            </h2>
            <p className="text-xs text-slate-500">Ismni bosing — shu odamning dossieri ochiladi</p>
            <div className="space-y-2">
              {data.tasks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                  Vazifa yo‘q
                </p>
              ) : (
                data.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
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
