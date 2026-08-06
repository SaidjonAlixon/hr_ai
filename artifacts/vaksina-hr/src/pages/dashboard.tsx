import React, { useMemo } from 'react';
import {
  useGetDashboardStats,
  useGetRecentActivity,
  useGetRecruiterTasks,
  useGetPipelineOverview,
  useGetRequests,
  useGetVacancies,
  RequestStatus,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Users, FileText, Briefcase, TrendingUp, CheckCircle, Clock, AlertCircle, Eye, ArrowRight } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'wouter';
import { PipelineFunnel } from '../components/dashboard/PipelineFunnel';
import { RecentActivityFeed } from '../components/dashboard/RecentActivityFeed';
import { DeadlineCountdown } from '../components/DeadlineCountdown';
import { sortByDeadlineAsc } from '../lib/deadline-countdown';

const OPEN_STATUSES = new Set(['submitted', 'reviewing', 'accepted', 'announced']);

function requestStatusBadge(status: RequestStatus | string) {
  switch (status) {
    case 'submitted': return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">Yangi</Badge>;
    case 'reviewing': return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Ko'rib chiqilmoqda</Badge>;
    case 'accepted': return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Qabul qilingan</Badge>;
    case 'announced': return <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-100">E'lon qilingan</Badge>;
    case 'closed': return <Badge className="bg-gray-800 text-white hover:bg-gray-800">Yopilgan</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

export default function Dashboard() {
  const { user } = useAuth();
  const canWatchRequests = user?.role === 'director' || user?.role === 'hr' || user?.role === 'admin';

  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: activities, isLoading: activitiesLoading } = useGetRecentActivity();
  const { data: tasks, isLoading: tasksLoading } = useGetRecruiterTasks();
  const { data: pipeline, isLoading: pipelineLoading } = useGetPipelineOverview();
  const { data: allRequests, isLoading: requestsLoading } = useGetRequests(undefined, {
    query: { enabled: !!canWatchRequests },
  });
  const { data: vacancies, isLoading: vacanciesLoading } = useGetVacancies({
    status: undefined,
  } as any);

  const deadlineVacancies = useMemo(() => {
    const list = (vacancies ?? []).filter(
      (v) =>
        (v.status === 'published' || v.status === 'draft') &&
        !!(v as any).deadline &&
        (user?.role !== 'recruiter' || (v as any).recruiterId === user?.id),
    );
    return sortByDeadlineAsc(list as Array<(typeof list)[number] & { deadline?: string | null }>).slice(0, 8);
  }, [vacancies, user?.id, user?.role]);

  const openRequests = useMemo(
    () => (allRequests ?? [])
      .filter((r) => OPEN_STATUSES.has(r.status))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [allRequests],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      submitted: 0,
      reviewing: 0,
      accepted: 0,
      announced: 0,
    };
    for (const r of openRequests) {
      if (counts[r.status] !== undefined) counts[r.status] += 1;
    }
    return counts;
  }, [openRequests]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Boshqaruv paneli</h1>
          <p className="text-muted-foreground mt-1">Xush kelibsiz, {user?.fullName}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/requests">
          <StatsCard
            title="Ochiq Arizalar"
            value={stats?.openRequests}
            icon={FileText}
            loading={statsLoading}
            color="text-blue-500"
            clickable
          />
        </Link>
        <Link href="/vacancies">
          <StatsCard
            title="Faol ish o'rinlari"
            value={stats?.activeVacancies}
            icon={Briefcase}
            loading={statsLoading}
            color="text-indigo-500"
            clickable
          />
        </Link>
        <Link href="/candidates">
          <StatsCard
            title="Faol nomzodlar"
            value={stats?.activeCandidates}
            icon={Users}
            loading={statsLoading}
            color="text-amber-500"
            clickable
          />
        </Link>
        <Link href="/candidates?stage=hired">
          <StatsCard
            title="Bu oy ishga qabul"
            value={stats?.hiredThisMonth}
            icon={TrendingUp}
            loading={statsLoading}
            color="text-emerald-500"
            clickable
          />
        </Link>
      </div>

      {deadlineVacancies.length > 0 && (
        <Card className="overflow-hidden border-amber-200/80 shadow-sm">
          <CardHeader className="bg-gradient-to-r from-amber-50 via-orange-50 to-white pb-3">
            <CardTitle className="flex items-center justify-between gap-3 flex-wrap text-base">
              <span className="inline-flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                </span>
                E'lon muddati — qancha vaqt qoldi
              </span>
              <Badge variant="secondary" className="bg-amber-100 text-amber-900">
                {deadlineVacancies.length} ta
              </Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Kam qolgan muddat birinchi. Biriktirilgan rekruter uchun yonib turadi.
            </p>
          </CardHeader>
          <CardContent className="pt-3">
            {vacanciesLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {deadlineVacancies.map((v) => (
                  <Link key={v.id} href={`/vacancies/${v.id}`}>
                    <div className="flex h-full flex-col gap-2 rounded-xl border border-amber-100 bg-white p-3 transition hover:border-amber-300 hover:shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{v.title}</p>
                          {(v as any).recruiterName && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {(v as any).recruiterName}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant="secondary"
                          className={
                            v.status === 'published'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }
                        >
                          {v.status === 'published' ? 'Faol' : 'Yangi'}
                        </Badge>
                      </div>
                      <DeadlineCountdown deadline={(v as any).deadline} showDate className="w-full" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canWatchRequests && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Ochiq Arizalar holati</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Direktor va HR uchun — barcha ochiq Arizalar va ularning statusi
              </p>
            </div>
            <Link href="/requests">
              <Button variant="outline" size="sm" className="gap-1">
                Barchasi <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="bg-gray-50">Yangi: {statusCounts.submitted}</Badge>
              <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">Ko'rib chiqilmoqda: {statusCounts.reviewing}</Badge>
              <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-200">Qabul qilingan: {statusCounts.accepted}</Badge>
              <Badge variant="outline" className="bg-violet-50 text-violet-800 border-violet-200">E'lon qilingan: {statusCounts.announced}</Badge>
            </div>

            {requestsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : openRequests.length > 0 ? (
              <div className="divide-y rounded-md border">
                {openRequests.map((request) => (
                  <Link key={request.id} href={`/requests/${request.id}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 hover:bg-muted/40 transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">#{request.id} · {request.position}</span>
                          {request.priority === 'urgent' && (
                            <span className="inline-flex items-center text-xs text-destructive font-medium">
                              <AlertCircle className="w-3 h-3 mr-1" /> Shoshilinch
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {request.departmentName || "Bo'lim noma'lum"}
                          {request.assignedToName ? ` · Mas'ul: ${request.assignedToName}` : ' · Tayinlanmagan'}
                          {' · '}
                          {format(new Date(request.createdAt), 'dd.MM.yyyy')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {requestStatusBadge(request.status)}
                        <Eye className="w-4 h-4 text-primary" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground border border-dashed rounded-md">
                Hozircha ochiq Ariza yo'q
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden border-t-4 border-t-primary shadow-sm">
            <CardHeader className="bg-gradient-to-r from-slate-50 to-white">
              <CardTitle className="flex items-center justify-between gap-3 flex-wrap">
                <span>Tanlov voronkasi</span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
                  <span className="tabular-nums font-semibold">9</span>
                  <span>ta bosqich</span>
                  <span className="text-primary/35" aria-hidden>·</span>
                  <span className="text-primary/80">Yig‘ma hisob</span>
                </span>
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Har bir qatorda shu bosqichgacha yetgan nomzodlar soni ko‘rsatiladi
              </p>
            </CardHeader>
            <CardContent className="pt-4">
              <PipelineFunnel
                pipeline={pipeline as Array<{ stage: string; label: string; count: number; currentCount?: number; rejectedCount?: number }> | undefined}
                loading={pipelineLoading || statsLoading}
                summary={{
                  total: (stats as { totalCandidates?: number } | undefined)?.totalCandidates ?? pipeline?.[0]?.count ?? 0,
                  pending: stats?.activeCandidates ?? 0,
                  hired: stats?.hiredThisMonth ?? 0,
                  rejected: (stats as { rejectedCandidates?: number } | undefined)?.rejectedCandidates ?? 0,
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Bugungi vazifalar</CardTitle>
              <Badge variant="secondary">{tasks?.length || 0}</Badge>
            </CardHeader>
            <CardContent>
              {tasksLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : tasks && tasks.length > 0 ? (
                <div className="space-y-3">
                  {tasks.map((task) => {
                    const href = (task as { linkUrl?: string }).linkUrl
                      || (task.candidateId ? `/candidates/${task.candidateId}` : '/candidates');
                    const dueLabel = (task as { dueLabel?: string }).dueLabel
                      || (task.dueDate ? format(new Date(task.dueDate), 'dd.MM HH:mm') : '');
                    const deadline = (task as { deadline?: string }).deadline || task.dueDate;
                    const isVacancyDeadline = task.type === 'find_candidate' && !!(task as any).vacancyId;
                    return (
                      <Link key={task.id} href={href}>
                        <div
                          className={`flex items-start p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer ${
                            isVacancyDeadline && task.priority === 'high'
                              ? 'border-amber-300 bg-amber-50/70 animate-pulse'
                              : ''
                          }`}
                        >
                          <div className="mt-0.5">
                            {task.priority === 'high' ? (
                              <AlertCircle className="w-5 h-5 text-destructive" />
                            ) : task.priority === 'medium' ? (
                              <Clock className="w-5 h-5 text-amber-500" />
                            ) : (
                              <CheckCircle className="w-5 h-5 text-emerald-500" />
                            )}
                          </div>
                          <div className="ml-3 flex-1 min-w-0">
                            <p className="text-sm font-medium">{task.description}</p>
                            {task.candidateName && (
                              <p className="text-xs text-muted-foreground mt-1">Nomzod: {task.candidateName}</p>
                            )}
                            {isVacancyDeadline && deadline ? (
                              <div className="mt-2">
                                <DeadlineCountdown deadline={deadline} compact showDate />
                              </div>
                            ) : null}
                          </div>
                          {!isVacancyDeadline && (
                            <div className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-2">
                              {dueLabel}
                            </div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="w-12 h-12 mx-auto text-emerald-500/50 mb-3" />
                  <p>Barcha vazifalar bajarilgan!</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="h-[calc(100vh-12rem)] flex flex-col overflow-hidden border-t-4 border-t-sky-500 shadow-sm">
            <CardHeader className="bg-gradient-to-r from-sky-50/80 to-white shrink-0">
              <CardTitle>So'nggi faollik</CardTitle>
              <p className="text-sm text-muted-foreground">
                Bosib tegishli Ariza yoki nomzodni oching
              </p>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto pr-1">
              <RecentActivityFeed
                activities={activities as Array<{ id: number; text: string; type: string; actorName?: string | null; createdAt: string; linkUrl?: string }> | undefined}
                loading={activitiesLoading}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatsCard({
  title,
  value,
  icon: Icon,
  loading,
  color,
  clickable,
}: {
  title: string;
  value?: number;
  icon: any;
  loading: boolean;
  color: string;
  clickable?: boolean;
}) {
  return (
    <Card className={clickable ? 'hover:border-primary/40 transition-colors cursor-pointer h-full' : ''}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-16 mt-2" />
            ) : (
              <p className="text-3xl font-bold mt-1">{value || 0}</p>
            )}
          </div>
          <div className={`p-3 rounded-xl bg-muted ${color}`}>
            <Icon className="w-6 h-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
