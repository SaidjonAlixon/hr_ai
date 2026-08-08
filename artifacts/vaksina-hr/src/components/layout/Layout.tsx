import React, { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useLocation } from 'wouter';
import {
  Users,
  Briefcase,
  FileText,
  LayoutDashboard,
  Calendar,
  LogOut,
  Bell,
  Settings,
  Menu,
  GraduationCap,
  Store,
  Kanban,
  ListTodo,
  ClipboardList,
  ClipboardCheck,
  AlarmClock,
  Target,
  MessageCircle,
} from 'lucide-react';
import {
  useLogout,
  useGetNotifications,
  useGetRequests,
  useGetVacancies,
  useGetDashboardStats,
  getGetNotificationsQueryKey,
  getGetDashboardStatsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useStaffingAlerts } from '@/lib/staffing-api';
import { cn } from '@/lib/utils';
import { DailyGoalPrompt } from '@/components/DailyGoalPrompt';

type NavItem = {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
};

/** Map notification linkUrl → sidebar path */
function linkToNavPath(linkUrl?: string | null): string | null {
  if (!linkUrl) return null;
  const path = linkUrl.split('?')[0];

  if (path.startsWith('/requests') || path.startsWith('/nazorat')) return '/requests';
  if (path.startsWith('/vacancies')) return '/vacancies';
  if (path.startsWith('/employees')) return '/employees';
  if (path.startsWith('/internships')) return '/internships';
  if (path.startsWith('/pharmacy-network')) return '/pharmacy-network';
  if (path.startsWith('/ehtiyoj')) return '/ehtiyoj';
  if (path.startsWith('/pipeline')) return '/pipeline';
  if (path.startsWith('/vazifalar')) return '/vazifalar';
  if (path.startsWith('/eslatmalar')) return '/eslatmalar';
  if (path.startsWith('/maqsad')) return '/maqsad';
  if (path.startsWith('/chat')) return '/chat';
  if (path.startsWith('/interviews')) return '/interviews';
  if (path.startsWith('/admin/users')) return '/admin/users';
  if (path.startsWith('/admin/departments')) return '/admin/departments';
  if (path.startsWith('/dashboard')) return '/dashboard';

  if (
    path.includes('interview') ||
    path.includes('preboarding') ||
    path.includes('final-decision') ||
    path.includes('/offer')
  ) {
    return '/interviews';
  }
  if (path.startsWith('/candidates')) return '/candidates';

  return null;
}

function NavBadge({
  count,
  collapsed,
  pulse,
}: {
  count: number;
  collapsed?: boolean;
  pulse?: boolean;
}) {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-red-500 text-white font-semibold leading-none',
        pulse && 'animate-pulse ring-2 ring-red-300/80',
        collapsed
          ? 'absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-[10px]'
          : 'ml-auto min-w-[20px] h-5 px-1.5 text-[11px]',
      )}
    >
      {label}
    </span>
  );
}

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user, isAuthenticated, isLoading, setUser } = useAuth();
  const [location, setLocation] = useLocation();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const markedPathsRef = useRef<Set<string>>(new Set());

  const isHrLike = user?.role === 'hr' || user?.role === 'admin' || user?.role === 'director';
  const isRecruiter = user?.role === 'recruiter';
  const isPharmacyStaff = user?.role === 'koordinator' || user?.role === 'mudir';

  const { data: unreadNotifications } = useGetNotifications(
    { unreadOnly: true },
    { query: { enabled: !!user, refetchInterval: 30_000 } } as any,
  );

  const { data: dashboardStats } = useGetDashboardStats({
    query: { enabled: !!user, refetchInterval: 30_000 },
  } as any);

  const { data: staffingAlerts } = useStaffingAlerts('open', {
    enabled: !!user && isPharmacyStaff,
    refetchInterval: 30_000,
  });

  const { data: requests } = useGetRequests(undefined, {
    query: { enabled: !!user && isHrLike, refetchInterval: 30_000 },
  } as any);

  const { data: draftVacancies } = useGetVacancies(
    { status: 'draft' },
    {
      query: {
        enabled: !!user && (isRecruiter || user?.role === 'hr' || user?.role === 'admin'),
        refetchInterval: 30_000,
      },
    } as any,
  );

  // Bo'limga kirganda shu bo'limga bog'liq bildirishnomalarni o'qilgan qilish
  useEffect(() => {
    if (!user || !unreadNotifications?.length) return;

    // Bildirishnomalar sahifasida hammasini o'qilgan qilish
    if (location.startsWith('/notifications')) {
      const ids = unreadNotifications.map((n) => n.id);
      const markKey = `all:${ids.slice().sort((a, b) => a - b).join(',')}`;
      if (markedPathsRef.current.has(markKey)) return;
      markedPathsRef.current.add(markKey);
      void fetch('/api/notifications/read-all', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
        .then((res) => {
          if (!res.ok) {
            markedPathsRef.current.delete(markKey);
            return;
          }
          queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getGetNotificationsQueryKey({ unreadOnly: true }),
          });
          queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
        })
        .catch(() => {
          markedPathsRef.current.delete(markKey);
        });
      return;
    }

    const currentNav = linkToNavPath(location);
    if (!currentNav) return;

    const ids = unreadNotifications
      .filter((n) => linkToNavPath(n.linkUrl) === currentNav)
      .map((n) => n.id);
    if (ids.length === 0) return;

    const markKey = `${currentNav}:${ids.slice().sort((a, b) => a - b).join(',')}`;
    if (markedPathsRef.current.has(markKey)) return;
    markedPathsRef.current.add(markKey);

    void fetch('/api/notifications/read-many', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
      .then((res) => {
        if (!res.ok) {
          markedPathsRef.current.delete(markKey);
          return;
        }
        queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetNotificationsQueryKey({ unreadOnly: true }),
        });
        queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
      })
      .catch(() => {
        markedPathsRef.current.delete(markKey);
      });
  }, [location, unreadNotifications, user, queryClient]);

  const badgeByPath = useMemo(() => {
    const counts: Record<string, number> = {};

    // Bildirishnomalar — Arizalar/Ish o'rinlaridan tashqari
    for (const n of unreadNotifications ?? []) {
      const navPath = linkToNavPath(n.linkUrl);
      if (!navPath || navPath === '/requests' || navPath === '/vacancies') {
        continue;
      }
      // Aptekalar badge — ochiq ogohlantirish/ariza soni (koordinator/mudir)
      if (navPath === '/pharmacy-network' && isPharmacyStaff) continue;
      counts[navPath] = (counts[navPath] ?? 0) + 1;
    }

    // Koordinator/mudir: ochiq ogohlantirishlar + ariza jarayonidagilar yig‘ilib turadi
    if (isPharmacyStaff) {
      const openCount = staffingAlerts?.length ?? 0;
      if (openCount > 0) counts['/pharmacy-network'] = openCount;
    }

    // Arizalar (eski Nazorat ham shu yerda): Yangi + Ko'rib chiqilmoqda
    if (isHrLike && requests) {
      const pendingHr = requests.filter(
        (r) => r.status === 'submitted' || r.status === 'reviewing',
      ).length;
      if (pendingHr > 0) counts['/requests'] = pendingHr;
    }

    // Ish o'rinlari: qabul qilinmagan (draft) — yangi ish o'rinlari
    const draftCount = draftVacancies?.length ?? 0;
    if (draftCount > 0) counts['/vacancies'] = draftCount;

    return counts;
  }, [unreadNotifications, requests, isHrLike, draftVacancies, isPharmacyStaff, staffingAlerts]);

  const totalUnread =
    dashboardStats?.unreadNotifications ??
    unreadNotifications?.length ??
    0;

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated || !user) {
      setLocation('/login');
    }
  }, [isLoading, isAuthenticated, user, setLocation]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Yuklanmoqda...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="min-h-screen flex items-center justify-center">Yuklanmoqda...</div>;
  }

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setUser(null);
        window.location.href = '/login';
      },
      onError: () => {
        setUser(null);
        window.location.href = '/login';
      },
    });
  };

  const chatNav = { name: 'Chat', path: '/chat', icon: MessageCircle };

  const roleNavigation: Record<string, NavItem[]> = {
    admin: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
      { name: 'Foydalanuvchilar', path: '/admin/users', icon: Settings },
      { name: "Bo'limlar", path: '/admin/departments', icon: Settings },
      { name: 'Pipeline', path: '/pipeline', icon: Kanban },
    ],
    recruiter: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Pipeline', path: '/pipeline', icon: Kanban },
    ],
    director: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    hr: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Pipeline', path: '/pipeline', icon: Kanban },
    ],
    trainer: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
    ],
    mentor: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      chatNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    department_head: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    mudir: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    koordinator: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Cheklist', path: '/checklist', icon: ClipboardCheck },
    ],
    texnik: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    ombor: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
  };

  const navItems = roleNavigation[user.role] || [];

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <aside
        className={cn(
          'text-sidebar-foreground w-64 flex flex-col transition-all duration-300',
          !sidebarOpen && 'w-20',
        )}
        style={{ backgroundColor: '#081323' }}
      >
        <div
          className={cn(
            'h-6 shrink-0',
            !sidebarOpen && 'h-4',
          )}
          style={{ backgroundColor: '#081323' }}
        />

        <nav className="flex-1 py-6 flex flex-col gap-1 px-3 overflow-y-auto">
          {navItems.map((item) => {
            const count = badgeByPath[item.path] ?? 0;
            const active = location === item.path || location.startsWith(item.path + '/');
            const pulse = item.path === '/pharmacy-network' && count > 0;
            return (
              <Link key={item.path} href={item.path}>
                <div
                  className={cn(
                    'relative flex items-center px-3 py-3 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer transition-colors group',
                    active && 'bg-sidebar-accent text-sidebar-accent-foreground',
                  )}
                >
                  <span className="relative">
                    <item.icon className="w-5 h-5 min-w-[20px]" />
                    {!sidebarOpen && <NavBadge count={count} collapsed pulse={pulse} />}
                  </span>
                  {sidebarOpen && (
                    <>
                      <span className="ml-3 font-medium text-sm">{item.name}</span>
                      <NavBadge count={count} pulse={pulse} />
                    </>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center justify-between">
            {sidebarOpen && (
              <div className="flex flex-col">
                <span className="text-sm font-semibold truncate w-40">{user.fullName}</span>
                <span className="text-xs text-sidebar-foreground/70 truncate">
                  {user.role.replace('_', ' ')}
                </span>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="text-sidebar-foreground/70 hover:text-white transition-colors"
              title="Chiqish"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 bg-white border-b flex items-center justify-between px-3 shrink-0 z-10 sm:h-20 sm:px-6">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 -ml-1 rounded-md text-gray-500 hover:bg-gray-100 sm:-ml-2"
            >
              <Menu className="w-5 h-5" />
            </button>
            <img
              src={`${import.meta.env.BASE_URL}vaksinahr_logo1.png?v=11`}
              alt="VAKSINA HR"
              className="h-12 w-auto max-w-[200px] object-contain sm:h-16 sm:max-w-[340px]"
            />
          </div>

          <div className="flex items-center gap-4">
            <Link href="/notifications">
              <div className="relative p-2 rounded-full text-gray-500 hover:bg-gray-100 cursor-pointer">
                <Bell className="w-5 h-5" />
                {totalUnread > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-white text-[10px] font-semibold flex items-center justify-center leading-none">
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </span>
                )}
              </div>
            </Link>
          </div>
        </header>

        <main
          className={cn(
            'flex-1 min-h-0',
            location === '/vazifalar' || location === '/pipeline' || location.startsWith('/chat')
              ? 'overflow-hidden p-0'
              : 'overflow-y-auto p-3 sm:p-6',
          )}
        >
          <div
            className={cn(
              'mx-auto w-full',
              location === '/pharmacy-network' ||
                location === '/pipeline' ||
                location === '/vazifalar' ||
                location.startsWith('/chat')
                ? 'max-w-none h-full'
                : 'max-w-7xl',
            )}
          >
            {children}
          </div>
        </main>
      </div>
      <DailyGoalPrompt />
    </div>
  );
};
