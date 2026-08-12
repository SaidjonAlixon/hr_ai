import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { isHrDirektor, isHrOversight } from "@/lib/roles";
import { useKuzatuv, type KuzatuvTask } from "@/lib/kuzatuv-api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
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

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm", tone)}>
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

function formatDue(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TaskRow({ task, full }: { task: KuzatuvTask; full: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{task.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Kimga: <span className="font-medium text-slate-700">{task.assigneeName}</span>
            {" · "}
            Kimdan: <span className="font-medium text-slate-700">{task.createdByName}</span>
          </p>
          {full && task.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-slate-600">{task.description}</p>
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

export default function KuzatuvPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const allowed = isHrOversight(user?.role) || user?.role === "admin";
  const full = isHrDirektor(user?.role) || user?.role === "admin";
  const { data, isLoading, error } = useKuzatuv(allowed);

  React.useEffect(() => {
    if (user && !allowed) setLocation("/dashboard");
  }, [user, allowed, setLocation]);

  if (!user || !allowed) {
    return <div className="p-8 text-center text-slate-500">Ruxsat yo‘q…</div>;
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
          {full
            ? "Barcha vazifalar, rekruterlar ishi, vakansiyalar va suhbatlar — to‘liq nazorat."
            : "Asosiy ko‘rsatkichlar va rekruterlar ishi — qisqa kuzatuv (direktor darajasidan kamroq)."}
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
            <StatCard label="Ochiq arizalar" value={data.summary.openRequests} icon={Briefcase} tone="" />
            <StatCard
              label="Faol vakansiyalar"
              value={data.summary.activeVacancies}
              icon={Briefcase}
              tone=""
            />
            <StatCard
              label="Faol nomzodlar"
              value={data.summary.activeCandidates}
              icon={Users}
              tone=""
            />
            <StatCard
              label="Ishga olingan"
              value={data.summary.hiredCandidates}
              icon={CheckCircle2}
              tone=""
            />
            <StatCard
              label="Telefon suhbatlar"
              value={data.summary.phoneInterviews}
              icon={Phone}
              tone=""
            />
            {full && data.summary.onlineInterviews != null ? (
              <StatCard
                label="Onlayn suhbatlar"
                value={data.summary.onlineInterviews}
                icon={Phone}
                tone=""
              />
            ) : null}
            {full && data.summary.offlineInterviews != null ? (
              <StatCard
                label="Offline suhbatlar"
                value={data.summary.offlineInterviews}
                icon={Users}
                tone=""
              />
            ) : null}
            <StatCard label="Ochiq vazifalar" value={data.summary.tasksOpen} icon={ListTodo} tone="" />
            <StatCard label="Bajarilgan vazifalar" value={data.summary.tasksDone} icon={Clock3} tone="" />
            <StatCard
              label="Rekruterlar"
              value={data.summary.recruitersCount}
              icon={UserRound}
              tone=""
            />
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">Rekruterlar ishi</h2>
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
                      <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {r.fullName}
                          {full && r.login ? (
                            <span className="mt-0.5 block text-xs font-normal text-slate-400">
                              @{r.login}
                            </span>
                          ) : null}
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
            <h2 className="text-lg font-semibold text-slate-900">
              Vazifalar {full ? "(to‘liq)" : "(so‘nggi)"}
            </h2>
            <div className="space-y-2">
              {data.tasks.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                  Vazifa yo‘q
                </p>
              ) : (
                data.tasks.map((t) => <TaskRow key={t.id} task={t} full={full} />)
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
