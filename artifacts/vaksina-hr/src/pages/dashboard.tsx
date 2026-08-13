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
import {
  Users,
  FileText,
  Briefcase,
  TrendingUp,
  CheckCircle,
  Clock,
  AlertCircle,
  Eye,
  ArrowRight,
  Store,
  ClipboardList,
  ClipboardCheck,
  ListTodo,
  AlarmClock,
  Target,
  MessageCircle,
  GraduationCap,
  Calendar,
} from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { Link, useLocation } from 'wouter';
import { PipelineFunnel } from '../components/dashboard/PipelineFunnel';
import { RecentActivityFeed } from '../components/dashboard/RecentActivityFeed';
import { DeadlineCountdown } from '../components/DeadlineCountdown';
import { sortByDeadlineAsc } from '../lib/deadline-countdown';
import { useStaffingAlerts } from '../lib/staffing-api';
import { useBranchNeeds } from '../lib/branch-needs-api';
import { useGetTasks } from '../lib/vazifalar-api';
import { useGetReminders } from '../lib/eslatmalar-api';
import { FaceIdEnroll } from '../components/FaceIdEnroll';
import { useChatList } from '../lib/chat-api';
import { useGoalsMe, GOAL_ROLES } from '../lib/maqsad-api';
import { cn } from '../lib/utils';
import { HR_ROLE_LABELS, isHrRole } from '../lib/roles';

const OPEN_STATUSES = new Set(['submitted', 'reviewing', 'accepted', 'announced']);

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  ...HR_ROLE_LABELS,
  recruiter: 'Rekruter',
  director: 'Direktor',
  department_head: "Bo'lim boshlig'i",
  trainer: 'Trener',
  mentor: 'Mentor',
  mudir: 'Mudir',
  koordinator: 'Koordinator',
  texnik: 'Texnik',
  ombor: 'Ombor',
  farmasevt: 'Farmasevt',
};

type DashKind =
  | 'recruitment' // admin, hr, director, recruiter
  | 'department' // department_head
  | 'trainer'
  | 'mentor'
  | 'pharmacy' // mudir, koordinator
  | 'ops' // texnik, ombor
  | 'intern'; // farmasevt

function dashKindFor(role?: string | null): DashKind {
  if (isHrRole(role)) return 'recruitment';
  switch (role) {
    case 'admin':
    case 'director':
    case 'recruiter':
      return 'recruitment';
    case 'department_head':
      return 'department';
    case 'trainer':
      return 'trainer';
    case 'mentor':
      return 'mentor';
    case 'mudir':
    case 'koordinator':
      return 'pharmacy';
    case 'texnik':
    case 'ombor':
      return 'ops';
    case 'farmasevt':
      return 'intern';
    default:
      return 'ops';
  }
}

function requestStatusBadge(status: RequestStatus | string) {
  switch (status) {
    case 'submitted':
      return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-100">Yangi</Badge>;
    case 'reviewing':
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Ko'rib chiqilmoqda</Badge>;
    case 'accepted':
      return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Qabul qilingan</Badge>;
    case 'announced':
      return <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-100">E'lon qilingan</Badge>;
    case 'closed':
      return <Badge className="bg-gray-800 text-white hover:bg-gray-800">Yopilgan</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function QuickLink({
  href,
  title,
  desc,
  icon: Icon,
}: {
  href: string;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link href={href}>
      <div className="flex items-start gap-3 rounded-xl border bg-white p-4 hover:border-primary/40 hover:shadow-sm transition cursor-pointer h-full">
        <div className="p-2.5 rounded-lg bg-slate-100 text-slate-700">
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
        </div>
      </div>
    </Link>
  );
}

function StatsCard({
  title,
  value,
  icon: Icon,
  loading,
  color,
  clickable,
  href,
}: {
  title: string;
  value?: number;
  icon: any;
  loading?: boolean;
  color: string;
  clickable?: boolean;
  href?: string;
}) {
  const inner = (
    <Card className={clickable ? 'hover:border-primary/40 transition-colors cursor-pointer h-full' : 'h-full'}>
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted-foreground break-words">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-16 mt-2" />
            ) : (
              <p className="text-2xl sm:text-3xl font-bold mt-1 tabular-nums">{value ?? 0}</p>
            )}
          </div>
          <div className={`p-2.5 sm:p-3 rounded-xl bg-muted shrink-0 ${color}`}>
            <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const role = user?.role;
  const kind = dashKindFor(role);

  React.useEffect(() => {
    if (kind === 'intern') setLocation('/kirish');
  }, [kind, setLocation]);

  const isRecruitment = kind === 'recruitment';
  const isPharmacy = kind === 'pharmacy';
  const canWatchRequests = role === 'director' || isHrRole(role) || role === 'admin';
  const canSeePipeline = role === 'admin' || isHrRole(role) || role === 'recruiter' || role === 'director';
  const canSeeRecruiterTasks = role === 'admin' || isHrRole(role) || role === 'recruiter';
  const canFetchVacancies =
    role === 'admin' ||
    role === 'director' ||
    role === 'recruiter' ||
    isHrRole(role) ||
    role === 'department_head';

  const { data: stats, isLoading: statsLoading } = useGetDashboardStats({
    query: { enabled: isRecruitment || kind === 'department' || kind === 'trainer' },
  } as any);
  const { data: activities, isLoading: activitiesLoading } = useGetRecentActivity({
    query: { enabled: isRecruitment || kind === 'department' },
  } as any);
  const { data: tasks, isLoading: tasksLoading } = useGetRecruiterTasks({
    query: { enabled: canSeeRecruiterTasks },
  } as any);
  const { data: pipeline, isLoading: pipelineLoading } = useGetPipelineOverview({
    query: { enabled: canSeePipeline },
  } as any);
  const { data: allRequests, isLoading: requestsLoading } = useGetRequests(undefined, {
    query: { enabled: !!canWatchRequests || kind === 'department' },
  });
  const { data: vacancies, isLoading: vacanciesLoading } = useGetVacancies(
    { status: undefined } as any,
    { query: { enabled: !!canFetchVacancies } } as any,
  );

  const { data: staffingAlerts, isLoading: staffingLoading } = useStaffingAlerts(
    undefined,
    { enabled: isPharmacy },
  );
  const { data: branchNeeds, isLoading: needsLoading } = useBranchNeeds({
    enabled: isPharmacy || kind === 'ops',
  });
  const { data: myTasks, isLoading: myTasksLoading } = useGetTasks(undefined, {
    enabled: kind !== 'intern' && kind !== 'mentor',
  } as any);
  const { data: reminders, isLoading: remindersLoading } = useGetReminders({
    query: { enabled: kind !== 'intern' },
  });
  const { data: chats } = useChatList({ enabled: kind !== 'intern' } as any);
  const { data: goalsMe } = useGoalsMe({
    query: { enabled: !!role && GOAL_ROLES.has(role) },
  });

  const deadlineVacancies = useMemo(() => {
    const uid = user?.id;
    const seen = new Set<number>();
    const list = (vacancies ?? []).filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      if (!(v.status === 'published' || v.status === 'draft')) return false;
      if (!(v as any).deadline) return false;
      if (role === 'admin' || role === 'director') return true;
      if (role === 'recruiter') return (v as any).recruiterId === uid;
      return (v as any).requestCreatedById === uid;
    });
    return sortByDeadlineAsc(list as Array<(typeof list)[number] & { deadline?: string | null }>);
  }, [vacancies, user?.id, role]);

  const canSeeDeadlineVacancies =
    role === 'admin' || role === 'director' || role === 'recruiter' || deadlineVacancies.length > 0;

  const openRequests = useMemo(
    () =>
      (allRequests ?? [])
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

  const openTaskCount = useMemo(
    () => (myTasks ?? []).filter((t) => t.status === 'todo' || t.status === 'in_progress').length,
    [myTasks],
  );
  const activeReminders = useMemo(
    () => (reminders ?? []).filter((r: any) => r.status === 'active').length,
    [reminders],
  );
  const unreadChats = useMemo(
    () => (chats?.chats ?? []).reduce((a, c) => a + (c.unreadCount || 0), 0),
    [chats],
  );
  const pendingNeeds = useMemo(() => {
    const list = branchNeeds ?? [];
    if (role === 'koordinator') {
      return list.filter((n) => n.status === 'pending' || n.status === 'done').length;
    }
    if (role === 'mudir') {
      return list.filter((n) => ['pending', 'assigned', 'in_progress', 'done'].includes(String(n.status))).length;
    }
    return list.filter((n) => n.status !== 'verified' && n.status !== 'closed').length;
  }, [branchNeeds, role]);
  const pendingStaffing = useMemo(
    () => (staffingAlerts ?? []).filter((a) => a.workflowStatus === 'pending').length,
    [staffingAlerts],
  );

  if (kind === 'intern') {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground">
        Kirish bo‘limiga yo‘naltirilmoqda...
      </div>
    );
  }

  const subtitle = ROLE_LABELS[role || ''] || role;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight break-words">Boshqaruv paneli</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base break-words">
            Xush kelibsiz, {user?.fullName}
            {subtitle ? (
              <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 align-middle">
                {subtitle}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <FaceIdEnroll />

      {/* ===== RECRUITMENT (admin / hr / director / recruiter) ===== */}
      {isRecruitment && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(role === 'admin' || isHrRole(role) || role === 'director') && (
              <StatsCard
                title="Ochiq Arizalar"
                value={stats?.openRequests}
                icon={FileText}
                loading={statsLoading}
                color="text-blue-500"
                clickable
                href="/requests"
              />
            )}
            <StatsCard
              title="Faol ish o'rinlari"
              value={stats?.activeVacancies}
              icon={Briefcase}
              loading={statsLoading}
              color="text-indigo-500"
              clickable
              href="/vacancies"
            />
            <StatsCard
              title="Faol nomzodlar"
              value={stats?.activeCandidates}
              icon={Users}
              loading={statsLoading}
              color="text-amber-500"
              clickable
              href="/candidates"
            />
            <StatsCard
              title="Bu oy ishga qabul"
              value={stats?.hiredThisMonth}
              icon={TrendingUp}
              loading={statsLoading}
              color="text-emerald-500"
              clickable
              href="/candidates?stage=hired"
            />
            {role === 'recruiter' && (
              <StatsCard
                title="Ochiq topshiriqlar"
                value={openTaskCount}
                icon={ListTodo}
                loading={myTasksLoading}
                color="text-sky-500"
                clickable
                href="/vazifalar"
              />
            )}
          </div>

          {canSeeDeadlineVacancies && (deadlineVacancies.length > 0 || vacanciesLoading) && (
            <DeadlineBlock
              loading={vacanciesLoading}
              items={deadlineVacancies}
            />
          )}

          {canWatchRequests && (
            <RequestsBlock
              loading={requestsLoading}
              openRequests={openRequests}
              statusCounts={statusCounts}
            />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {canSeePipeline && (
                <PipelineCard
                  pipeline={pipeline}
                  loading={pipelineLoading || statsLoading}
                  stats={stats}
                />
              )}
              {canSeeRecruiterTasks && (
                <RecruiterTasksCard tasks={tasks} loading={tasksLoading} />
              )}
            </div>
            <ActivityCard activities={activities} loading={activitiesLoading} />
          </div>
        </>
      )}

      {/* ===== DEPARTMENT HEAD ===== */}
      {kind === 'department' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard
              title="Ochiq Arizalar"
              value={openRequests.length}
              icon={FileText}
              loading={requestsLoading}
              color="text-blue-500"
              clickable
              href="/requests"
            />
            <StatsCard
              title="Topshiriqlar"
              value={openTaskCount}
              icon={ListTodo}
              loading={myTasksLoading}
              color="text-sky-500"
              clickable
              href="/vazifalar"
            />
            <StatsCard
              title="Eslatmalar"
              value={activeReminders}
              icon={AlarmClock}
              loading={remindersLoading}
              color="text-amber-500"
              clickable
              href="/eslatmalar"
            />
            <StatsCard
              title="Chat (o‘qilmagan)"
              value={unreadChats}
              icon={MessageCircle}
              color="text-violet-500"
              clickable
              href="/chat"
            />
          </div>
          {deadlineVacancies.length > 0 && <DeadlineBlock loading={false} items={deadlineVacancies} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <QuickLink href="/requests" title="Arizalar" desc="Bo‘lim arizalarini kuzating" icon={FileText} />
            <QuickLink href="/candidates" title="Nomzodlar" desc="Tanlov jarayoniga nazar" icon={Users} />
            <QuickLink href="/pharmacy-network" title="Aptekalar" desc="Tarmoq holati" icon={Store} />
            <QuickLink href="/vazifalar" title="Topshiriqlar" desc="Jamoa topshiriqlari" icon={ListTodo} />
            <QuickLink href="/maqsad" title="Maqsad" desc="Kunlik intizom" icon={Target} />
            <QuickLink href="/chat" title="Chat" desc="Xodimlar bilan aloqa" icon={MessageCircle} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MyTasksPreview tasks={myTasks} loading={myTasksLoading} />
            <ActivityCard activities={activities} loading={activitiesLoading} />
          </div>
        </>
      )}

      {/* ===== TRAINER ===== */}
      {kind === 'trainer' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard
              title="Topshiriqlar"
              value={openTaskCount}
              icon={ListTodo}
              loading={myTasksLoading}
              color="text-sky-500"
              clickable
              href="/vazifalar"
            />
            <StatsCard
              title="Eslatmalar"
              value={activeReminders}
              icon={AlarmClock}
              loading={remindersLoading}
              color="text-amber-500"
              clickable
              href="/eslatmalar"
            />
            <StatsCard
              title="Chat"
              value={unreadChats}
              icon={MessageCircle}
              color="text-violet-500"
              clickable
              href="/chat"
            />
            <StatsCard
              title="Maqsad"
              value={goalsMe?.todaySubmitted ? 1 : 0}
              icon={Target}
              color="text-emerald-500"
              clickable
              href="/maqsad"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <QuickLink href="/interviews" title="Suhbatlar" desc="Rejalashtirilgan suhbatlar" icon={Calendar} />
            <QuickLink href="/internships" title="Stajirovkalar" desc="Stajorlar bilan ishlash" icon={GraduationCap} />
            <QuickLink href="/vazifalar" title="Topshiriqlar" desc="Kunlik vazifalar" icon={ListTodo} />
          </div>
          <MyTasksPreview tasks={myTasks} loading={myTasksLoading} />
        </>
      )}

      {/* ===== MENTOR ===== */}
      {kind === 'mentor' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatsCard
              title="Eslatmalar"
              value={activeReminders}
              icon={AlarmClock}
              loading={remindersLoading}
              color="text-amber-500"
              clickable
              href="/eslatmalar"
            />
            <StatsCard
              title="Chat"
              value={unreadChats}
              icon={MessageCircle}
              color="text-violet-500"
              clickable
              href="/chat"
            />
            <StatsCard
              title="Xodimlar"
              value={undefined}
              icon={Users}
              color="text-blue-500"
              clickable
              href="/employees"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <QuickLink href="/employees" title="Xodimlar" desc="Mentorlik qilinadigan xodimlar" icon={Users} />
            <QuickLink href="/eslatmalar" title="Eslatmalarim" desc="Shaxsiy eslatmalar" icon={AlarmClock} />
            <QuickLink href="/chat" title="Chat" desc="Jamoa bilan muloqot" icon={MessageCircle} />
          </div>
        </>
      )}

      {/* ===== PHARMACY (mudir / koordinator) ===== */}
      {isPharmacy && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard
              title="Kadr ogohlantirish"
              value={pendingStaffing}
              icon={AlertCircle}
              loading={staffingLoading}
              color="text-red-500"
              clickable
              href="/pharmacy-network"
            />
            <StatsCard
              title="Ehtiyoj"
              value={pendingNeeds}
              icon={ClipboardList}
              loading={needsLoading}
              color="text-orange-500"
              clickable
              href="/ehtiyoj"
            />
            <StatsCard
              title="Topshiriqlar"
              value={openTaskCount}
              icon={ListTodo}
              loading={myTasksLoading}
              color="text-sky-500"
              clickable
              href="/vazifalar"
            />
            <StatsCard
              title={role === 'koordinator' ? 'Cheklist' : 'Eslatmalar'}
              value={role === 'koordinator' ? undefined : activeReminders}
              icon={role === 'koordinator' ? ClipboardCheck : AlarmClock}
              color="text-emerald-500"
              clickable
              href={role === 'koordinator' ? '/checklist' : '/eslatmalar'}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <QuickLink
              href="/pharmacy-network"
              title="Aptekalar tarmog'i"
              desc="Filiallar va xodim holati"
              icon={Store}
            />
            <QuickLink href="/ehtiyoj" title="Ehtiyoj" desc="Filial ehtiyojlari va topshiriqlar" icon={ClipboardList} />
            <QuickLink href="/vazifalar" title="Topshiriqlar" desc="Kunlik ishlar" icon={ListTodo} />
            {role === 'koordinator' && (
              <QuickLink href="/checklist" title="Cheklist" desc="Filial audit / GPS" icon={ClipboardCheck} />
            )}
            <QuickLink href="/maqsad" title="Maqsad" desc="Kunlik natija" icon={Target} />
            <QuickLink href="/chat" title="Chat" desc="Jamoa bilan suhbat" icon={MessageCircle} />
          </div>

          {(pendingStaffing > 0 || staffingLoading) && (
            <Card className="border-red-200 bg-red-50/50">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Kadr ogohlantirishlari</CardTitle>
                  <p className="text-sm text-muted-foreground">Aptekalar tarmog‘idan kelgan holatlar</p>
                </div>
                <Link href="/pharmacy-network">
                  <Button variant="outline" size="sm" className="gap-1">
                    Ochish <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="space-y-2">
                {staffingLoading ? (
                  <Skeleton className="h-14 w-full" />
                ) : (
                  (staffingAlerts ?? [])
                    .filter((a) => a.workflowStatus === 'pending')
                    .slice(0, 5)
                    .map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-white px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {a.branchLocation || 'Filial'} · {a.employmentStatusLabel}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {a.shiftLabel || a.shiftType || 'Smena'}
                          </p>
                        </div>
                        <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Kutilmoqda</Badge>
                      </div>
                    ))
                )}
                {!staffingLoading && pendingStaffing === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Hozircha ogohlantirish yo‘q</p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MyTasksPreview tasks={myTasks} loading={myTasksLoading} />
            <NeedsPreview needs={branchNeeds} loading={needsLoading} />
          </div>
        </>
      )}

      {/* ===== OPS (texnik / ombor) ===== */}
      {kind === 'ops' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard
              title="Topshiriqlar"
              value={openTaskCount}
              icon={ListTodo}
              loading={myTasksLoading}
              color="text-sky-500"
              clickable
              href="/vazifalar"
            />
            <StatsCard
              title="Ehtiyoj"
              value={pendingNeeds}
              icon={ClipboardList}
              loading={needsLoading}
              color="text-orange-500"
              clickable
              href="/ehtiyoj"
            />
            <StatsCard
              title="Eslatmalar"
              value={activeReminders}
              icon={AlarmClock}
              loading={remindersLoading}
              color="text-amber-500"
              clickable
              href="/eslatmalar"
            />
            <StatsCard
              title="Chat"
              value={unreadChats}
              icon={MessageCircle}
              color="text-violet-500"
              clickable
              href="/chat"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <QuickLink href="/vazifalar" title="Topshiriqlar" desc="Sizga berilgan ishlar" icon={ListTodo} />
            <QuickLink href="/ehtiyoj" title="Ehtiyoj" desc="Filialdan kelgan so‘rovlar" icon={ClipboardList} />
            <QuickLink href="/maqsad" title="Maqsad" desc="Kunlik natija yozuvi" icon={Target} />
            <QuickLink href="/eslatmalar" title="Eslatmalarim" desc="Shaxsiy eslatmalar" icon={AlarmClock} />
            <QuickLink href="/chat" title="Chat" desc="Jamoa bilan muloqot" icon={MessageCircle} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MyTasksPreview tasks={myTasks} loading={myTasksLoading} />
            <NeedsPreview needs={branchNeeds} loading={needsLoading} />
          </div>
        </>
      )}
    </div>
  );
}

function DeadlineBlock({
  loading,
  items,
}: {
  loading: boolean;
  items: any[];
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
            </span>
            E'lon muddati — qancha vaqt qoldi
          </h2>
          <p className="mt-1 text-xs text-amber-900/70">
            Sizga tegishli ochiq eʼlonlar. Kam qolgan muddat birinchi.
          </p>
        </div>
        <Badge variant="secondary" className="bg-amber-100 text-amber-900">
          {items.length} ta
        </Badge>
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="max-h-[min(55vh,420px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
          {items.map((v) => (
            <Link key={v.id} href={`/vacancies/${v.id}`}>
              <div className="flex flex-col gap-2 rounded-lg border border-amber-200/80 bg-white px-3 py-2.5 transition hover:border-amber-400 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">{v.title}</p>
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
                  {v.recruiterName && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{v.recruiterName}</p>
                  )}
                </div>
                <div className="w-full shrink-0 sm:w-56">
                  <DeadlineCountdown deadline={v.deadline} compact showDate className="w-full" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestsBlock({
  loading,
  openRequests,
  statusCounts,
}: {
  loading: boolean;
  openRequests: any[];
  statusCounts: Record<string, number>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Ochiq Arizalar holati</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Direktor, HR va admin uchun — ochiq arizalar
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
          <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
            Ko'rib chiqilmoqda: {statusCounts.reviewing}
          </Badge>
          <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-200">
            Qabul qilingan: {statusCounts.accepted}
          </Badge>
          <Badge variant="outline" className="bg-violet-50 text-violet-800 border-violet-200">
            E'lon qilingan: {statusCounts.announced}
          </Badge>
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : openRequests.length > 0 ? (
          <div className="divide-y rounded-md border">
            {openRequests.slice(0, 8).map((request) => (
              <Link key={request.id} href={`/requests/${request.id}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 hover:bg-muted/40 transition-colors cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">
                        #{request.id} · {request.position}
                      </span>
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
  );
}

function PipelineCard({ pipeline, loading, stats }: any) {
  return (
    <Card className="overflow-hidden border-t-4 border-t-primary shadow-sm">
      <CardHeader className="bg-gradient-to-r from-slate-50 to-white">
        <CardTitle className="flex items-center justify-between gap-3 flex-wrap">
          <span>Tanlov voronkasi</span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
            <span className="tabular-nums font-semibold">9</span>
            <span>ta bosqich</span>
          </span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Har bir qatorda shu bosqichgacha yetgan nomzodlar soni
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        <PipelineFunnel
          pipeline={pipeline}
          loading={loading}
          summary={{
            total: stats?.totalCandidates ?? pipeline?.[0]?.count ?? 0,
            pending: stats?.activeCandidates ?? 0,
            hired: stats?.hiredThisMonth ?? 0,
            rejected: stats?.rejectedCandidates ?? 0,
          }}
        />
      </CardContent>
    </Card>
  );
}

function RecruiterTasksCard({ tasks, loading }: { tasks?: any[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Bugungi vazifalar</CardTitle>
        <Badge variant="secondary">{tasks?.length || 0}</Badge>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : tasks && tasks.length > 0 ? (
          <div className="space-y-3">
            {tasks.map((task) => {
              const href =
                task.linkUrl ||
                (task.candidateId ? `/candidates/${task.candidateId}` : '/candidates');
              const dueLabel =
                task.dueLabel ||
                (task.dueDate ? format(new Date(task.dueDate), 'dd.MM HH:mm') : '');
              const deadline = task.deadline || task.dueDate;
              const isVacancyDeadline = task.type === 'find_candidate' && !!task.vacancyId;
              return (
                <Link key={task.id} href={href}>
                  <div
                    className={cn(
                      'flex items-start p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer',
                      isVacancyDeadline && task.priority === 'high'
                        ? 'border-amber-300 bg-amber-50/70 animate-pulse'
                        : '',
                    )}
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
                        <p className="text-xs text-muted-foreground mt-1">
                          Nomzod: {task.candidateName}
                        </p>
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
  );
}

function ActivityCard({ activities, loading }: { activities?: any[]; loading: boolean }) {
  return (
    <Card className="h-[calc(100vh-12rem)] min-h-[320px] flex flex-col overflow-hidden border-t-4 border-t-sky-500 shadow-sm">
      <CardHeader className="bg-gradient-to-r from-sky-50/80 to-white shrink-0">
        <CardTitle>So'nggi faollik</CardTitle>
        <p className="text-sm text-muted-foreground">Bosib tegishli yozuvni oching</p>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto pr-1">
        <RecentActivityFeed activities={activities} loading={loading} />
      </CardContent>
    </Card>
  );
}

function MyTasksPreview({ tasks, loading }: { tasks?: any[]; loading: boolean }) {
  const open = (tasks ?? [])
    .filter((t) => t.status === 'todo' || t.status === 'in_progress')
    .slice(0, 6);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Mening topshiriqlarim</CardTitle>
        <Link href="/vazifalar">
          <Button variant="outline" size="sm" className="gap-1">
            Barchasi <ArrowRight className="w-4 h-4" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : open.length ? (
          open.map((t) => (
            <Link key={t.id} href="/vazifalar">
              <div className="rounded-lg border px-3 py-2.5 hover:bg-muted/40 cursor-pointer">
                <p className="text-sm font-medium truncate">{t.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t.status === 'in_progress' ? 'Jarayonda' : 'Yangi'}
                  {t.dueAt ? ` · ${format(new Date(t.dueAt), 'dd.MM.yyyy')}` : ''}
                </p>
              </div>
            </Link>
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-6">Ochiq topshiriq yo‘q</p>
        )}
      </CardContent>
    </Card>
  );
}

function NeedsPreview({ needs, loading }: { needs?: any[]; loading: boolean }) {
  const list = (needs ?? [])
    .filter((n) => n.status !== 'verified' && n.status !== 'closed')
    .slice(0, 6);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Ehtiyojlar</CardTitle>
        <Link href="/ehtiyoj">
          <Button variant="outline" size="sm" className="gap-1">
            Barchasi <ArrowRight className="w-4 h-4" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : list.length ? (
          list.map((n) => (
            <Link key={n.id} href="/ehtiyoj">
              <div className="rounded-lg border px-3 py-2.5 hover:bg-muted/40 cursor-pointer">
                <p className="text-sm font-medium truncate">{n.needType}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {n.branchLocation || 'Filial'} · {n.status}
                </p>
              </div>
            </Link>
          ))
        ) : (
          <p className="text-sm text-muted-foreground text-center py-6">Ochiq ehtiyoj yo‘q</p>
        )}
      </CardContent>
    </Card>
  );
}
