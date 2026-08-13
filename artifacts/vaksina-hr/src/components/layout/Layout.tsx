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
  X,
  GraduationCap,
  Store,
  Kanban,
  ListTodo,
  ClipboardList,
  ClipboardCheck,
  AlarmClock,
  Target,
  MessageCircle,
  Network,
  Eye,
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
import { FaceIdEnroll } from '@/components/FaceIdEnroll';
import { isHrManager, isHrRole } from '@/lib/roles';

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
  if (path.startsWith('/tashkiliy-tuzilma')) return '/tashkiliy-tuzilma';
  if (path.startsWith('/kuzatuv')) return '/kuzatuv';
  if (path.startsWith('/ehtiyoj')) return '/ehtiyoj';
  if (path.startsWith('/pipeline')) return '/pipeline';
  if (path.startsWith('/vazifalar')) return '/vazifalar';
  if (path.startsWith('/eslatmalar')) return '/eslatmalar';
  if (path.startsWith('/maqsad')) return '/maqsad';
  if (path.startsWith('/chat')) return '/chat';
  if (path.startsWith('/kirish')) return '/kirish';
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
  /** Mobil: drawer ochiq/yopiq. Desktop: kengaytirilgan/icon-only. */
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = React.useState(false);
  const markedPathsRef = useRef<Set<string>>(new Set());

  // Sahifa o‘zgaganda mobil menyuni yopish
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  // Mobil menyu ochiq bo‘lsa body scrollni bloklash
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const isHrLike = isHrRole(user?.role) || user?.role === 'admin' || user?.role === 'director';
  const isRecruiter = user?.role === 'recruiter';
  const isPharmacyStaff = user?.role === 'koordinator' || user?.role === 'mudir';

  const { data: unreadNotifications } = useGetNotifications(
    { unreadOnly: true },
    { query: { enabled: !!user, refetchInterval: 30_000 } } as any,
  );

  const { data: dashboardStats } = useGetDashboardStats({
    query: { enabled: !!user, refetchInterval: 45_000 },
  } as any);

  const { data: staffingAlerts } = useStaffingAlerts('open', {
    enabled: !!user && isPharmacyStaff,
    refetchInterval: 45_000,
  });

  const { data: requests } = useGetRequests(undefined, {
    query: { enabled: !!user && isHrLike, refetchInterval: 45_000 },
  } as any);

  const { data: draftVacancies } = useGetVacancies(
    { status: 'draft' },
    {
      query: {
        enabled: !!user && (isRecruiter || isHrManager(user?.role)),
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
      return;
    }
    if (
      user.role === 'farmasevt' &&
      !location.startsWith('/kirish') &&
      !location.startsWith('/tashkiliy-tuzilma') &&
      location !== '/notifications'
    ) {
      setLocation('/kirish');
    }
  }, [isLoading, isAuthenticated, user, setLocation, location]);

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
  const orgNav = { name: 'Tashkiliy tuzilma', path: '/tashkiliy-tuzilma', icon: Network };
  const kuzatuvNav = { name: 'Kuzatuv', path: '/kuzatuv', icon: Eye };

  const hrMenejerNav: NavItem[] = [
    { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
    { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
    { name: 'Maqsad', path: '/maqsad', icon: Target },
    chatNav,
    orgNav,
    { name: 'Arizalar', path: '/requests', icon: FileText },
    { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
    { name: 'Nomzodlar', path: '/candidates', icon: Users },
    { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
    { name: 'Xodimlar', path: '/employees', icon: Users },
    { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    { name: 'Pipeline', path: '/pipeline', icon: Kanban },
  ];

  const hrDirektorNav: NavItem[] = [
    { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
    kuzatuvNav,
    { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
    { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
    { name: 'Maqsad', path: '/maqsad', icon: Target },
    chatNav,
    orgNav,
    { name: 'Arizalar', path: '/requests', icon: FileText },
    { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
    { name: 'Nomzodlar', path: '/candidates', icon: Users },
    { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
    { name: 'Xodimlar', path: '/employees', icon: Users },
    { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    { name: 'Pipeline', path: '/pipeline', icon: Kanban },
  ];

  const hrAuditorNav: NavItem[] = [
    { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
    kuzatuvNav,
    { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
    { name: 'Maqsad', path: '/maqsad', icon: Target },
    chatNav,
    orgNav,
    { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
    { name: 'Nomzodlar', path: '/candidates', icon: Users },
    { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
    { name: 'Pipeline', path: '/pipeline', icon: Kanban },
  ];

  const roleNavigation: Record<string, NavItem[]> = {
    admin: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      kuzatuvNav,
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
      orgNav,
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
    hr: hrMenejerNav,
    hr_menejer: hrMenejerNav,
    hr_direktor: hrDirektorNav,
    hr_auditor: hrAuditorNav,
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
      orgNav,
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    koordinator: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      orgNav,
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
    farmasevt: [
      { name: 'Kirish', path: '/kirish', icon: GraduationCap },
      orgNav,
    ],
  };

  const navItems = roleNavigation[user.role] || [];

  const toggleNav = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      setDesktopCollapsed((v) => !v);
    } else {
      setMobileOpen((v) => !v);
    }
  };

  const renderNavLinks = (opts: { collapsed: boolean; onNavigate?: () => void }) =>
    navItems.map((item) => {
      const count = badgeByPath[item.path] ?? 0;
      const active = location === item.path || location.startsWith(item.path + '/');
      const pulse = item.path === '/pharmacy-network' && count > 0;
      return (
        <Link key={item.path} href={item.path}>
          <div
            role="link"
            onClick={opts.onNavigate}
            className={cn(
              'relative flex items-center px-3 py-3 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer transition-colors group',
              active && 'bg-sidebar-accent text-sidebar-accent-foreground',
            )}
          >
            <span className="relative shrink-0">
              <item.icon className="w-5 h-5 min-w-[20px]" />
              {opts.collapsed && <NavBadge count={count} collapsed pulse={pulse} />}
            </span>
            {!opts.collapsed && (
              <>
                <span className="ml-3 font-medium text-sm min-w-0 break-words">{item.name}</span>
                <NavBadge count={count} pulse={pulse} />
              </>
            )}
          </div>
        </Link>
      );
    });

  return (
    <div className="flex h-[100dvh] bg-gray-50 overflow-hidden">
      {/* Mobil: fon (overlay) */}
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Menyuni yopish"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* Sidebar: mobilda drawer, desktopda doimiy */}
      <aside
        className={cn(
          'text-sidebar-foreground flex flex-col transition-transform duration-300 ease-out',
          'fixed inset-y-0 left-0 z-50 w-[min(18rem,88vw)]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:static md:z-auto md:translate-x-0 md:transition-[width] md:duration-300',
          desktopCollapsed ? 'md:w-20' : 'md:w-64',
        )}
        style={{ backgroundColor: '#081323' }}
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 md:pt-3 shrink-0">
          <div className={cn('min-w-0', desktopCollapsed && 'md:hidden')}>
            <p className="text-sm font-semibold text-white truncate">VAKSINA MED</p>
            <p className="text-[11px] text-sidebar-foreground/60 truncate">HR platforma</p>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="p-2 rounded-md text-sidebar-foreground/80 hover:bg-white/10 hover:text-white md:hidden"
            aria-label="Yopish"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-2 flex flex-col gap-1 px-3 overflow-y-auto overscroll-contain">
          {/* Mobil: har doim to‘liq matn */}
          <div className="flex flex-col gap-1 md:hidden">
            {renderNavLinks({ collapsed: false, onNavigate: () => setMobileOpen(false) })}
          </div>
          {/* Desktop */}
          <div className="hidden md:flex md:flex-col md:gap-1">
            {renderNavLinks({ collapsed: desktopCollapsed })}
          </div>
        </nav>

        <div className="p-4 border-t border-sidebar-border pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between gap-2">
            <div className={cn('flex flex-col min-w-0', desktopCollapsed && 'md:hidden')}>
              <span className="text-sm font-semibold truncate">{user.fullName}</span>
              <span className="text-xs text-sidebar-foreground/70 truncate">
                {user.role.replace('_', ' ')}
              </span>
              <FaceIdEnroll compact />
            </div>
            <button
              onClick={handleLogout}
              className="shrink-0 text-sidebar-foreground/70 hover:text-white transition-colors p-2 rounded-md hover:bg-white/10"
              title="Chiqish"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full">
        <header className="h-14 bg-white border-b flex items-center justify-between gap-2 px-3 shrink-0 z-10 sm:h-16 sm:px-5 safe-top">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={toggleNav}
              className="shrink-0 p-2 -ml-1 rounded-md text-gray-600 hover:bg-gray-100"
              aria-label="Menyu"
              aria-expanded={mobileOpen || !desktopCollapsed}
            >
              <Menu className="w-6 h-6" />
            </button>
            <img
              src={`${import.meta.env.BASE_URL}logo3d.png`}
              alt="VAKSINA MED HR"
              className="h-8 w-auto max-w-[min(48vw,168px)] object-contain object-left sm:h-10 sm:max-w-[200px]"
            />
          </div>

          <div className="flex items-center shrink-0">
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
            'flex-1 min-h-0 min-w-0',
            location === '/vazifalar' ||
              location === '/pipeline' ||
              location.startsWith('/chat') ||
              location.startsWith('/kirish') ||
              location.startsWith('/tashkiliy-tuzilma')
              ? 'overflow-hidden p-0'
              : 'overflow-y-auto overflow-x-hidden p-3 sm:p-6',
          )}
        >
          <div
            className={cn(
              'mx-auto w-full min-w-0',
              location === '/pharmacy-network' ||
                location === '/pipeline' ||
                location === '/vazifalar' ||
                location.startsWith('/chat') ||
                location.startsWith('/kirish') ||
                location.startsWith('/tashkiliy-tuzilma')
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
