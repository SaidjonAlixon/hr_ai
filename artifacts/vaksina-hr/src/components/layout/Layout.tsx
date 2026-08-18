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
  ScanFace,
  ChevronDown,
  Pin,
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
import { DavomatAttendanceBanner } from '@/components/DavomatAttendanceBanner';
import { FaceIdEnroll } from '@/components/FaceIdEnroll';
import { isHrManager, isHrRole, isStajyor, canSeeHrRecruitment, isHrRecruitmentPath } from '@/lib/roles';

type NavItem = {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
};

type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
  accent: string;
  line: string;
  chip: string;
};

const NAV_SECTIONS: {
  id: string;
  label: string;
  accent: string;
  line: string;
  chip: string;
  paths: string[];
}[] = [
  {
    id: 'main',
    label: 'Asosiy',
    accent: 'bg-sky-400',
    line: 'border-sky-400/55',
    chip: 'text-sky-300',
    paths: ['/dashboard', '/kirish', '/kuzatuv', '/maqsad', '/chat', '/tashkiliy-tuzilma'],
  },
  {
    id: 'work',
    label: 'Mening ishim',
    accent: 'bg-amber-400',
    line: 'border-amber-400/55',
    chip: 'text-amber-300',
    paths: ['/vazifalar', '/eslatmalar'],
  },
  {
    id: 'hr',
    label: 'HR va kadrlar',
    accent: 'bg-indigo-400',
    line: 'border-indigo-400/55',
    chip: 'text-indigo-300',
    paths: [
      '/requests',
      '/vacancies',
      '/candidates',
      '/interviews',
      '/pipeline',
      '/internships',
      '/employees',
    ],
  },
  {
    id: 'attendance',
    label: 'Davomat',
    accent: 'bg-teal-400',
    line: 'border-teal-400/55',
    chip: 'text-teal-300',
    paths: ['/davomat-face', '/davomat'],
  },
  {
    id: 'pharmacy',
    label: "Apteka tarmog'i",
    accent: 'bg-emerald-400',
    line: 'border-emerald-400/55',
    chip: 'text-emerald-300',
    paths: ['/pharmacy-network', '/checklist-holati', '/checklist', '/ehtiyoj'],
  },
  {
    id: 'admin',
    label: 'Sozlamalar',
    accent: 'bg-rose-400',
    line: 'border-rose-400/55',
    chip: 'text-rose-300',
    paths: ['/admin/users', '/admin/departments'],
  },
];

function groupNavItems(items: NavItem[]): NavSection[] {
  const byPath = new Map(items.map((item) => [item.path, item]));
  const used = new Set<string>();
  const groups: NavSection[] = [];
  for (const sec of NAV_SECTIONS) {
    const list = sec.paths
      .map((path) => byPath.get(path))
      .filter((item): item is NavItem => !!item);
    if (!list.length) continue;
    groups.push({
      id: sec.id,
      label: sec.label,
      accent: sec.accent,
      line: sec.line,
      chip: sec.chip,
      items: list,
    });
    for (const item of list) used.add(item.path);
  }
  const rest = items.filter((item) => !used.has(item.path));
  if (rest.length) {
    groups.push({
      id: 'other',
      label: 'Boshqa',
      accent: 'bg-slate-400',
      line: 'border-slate-400/55',
      chip: 'text-slate-300',
      items: rest,
    });
  }
  return groups;
}

function pathIsActive(location: string, path: string) {
  return location === path || location.startsWith(`${path}/`);
}

/** Map notification linkUrl → sidebar path */
function linkToNavPath(linkUrl?: string | null): string | null {
  if (!linkUrl) return null;
  const path = linkUrl.split('?')[0];

  if (path.startsWith('/requests') || path.startsWith('/nazorat')) return '/requests';
  if (path.startsWith('/vacancies')) return '/vacancies';
  if (path.startsWith('/employees')) return '/employees';
  if (path.startsWith('/davomat')) return '/davomat';
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
  const [openSectionId, setOpenSectionId] = React.useState<string | null>(null);
  const [pinnedIds, setPinnedIds] = React.useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('vaksina-nav-pins');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });
  const markedPathsRef = useRef<Set<string>>(new Set());

  // Sahifa o‘zgaganda mobil menyuni yopish
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    const sec = NAV_SECTIONS.find((s) => s.paths.some((p) => pathIsActive(location, p)));
    if (sec) setOpenSectionId(sec.id);
  }, [location]);

  useEffect(() => {
    try {
      localStorage.setItem('vaksina-nav-pins', JSON.stringify(pinnedIds));
    } catch {
      /* ignore */
    }
  }, [pinnedIds]);

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
      isStajyor(user.role) &&
      !location.startsWith('/kirish') &&
      !location.startsWith('/tashkiliy-tuzilma') &&
      !location.startsWith('/davomat-face') &&
      location !== '/notifications'
    ) {
      setLocation('/kirish');
    }
    if (isHrRecruitmentPath(location) && !canSeeHrRecruitment(user.role)) {
      setLocation('/dashboard');
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
  const davomatFaceNav = { name: 'Davomat', path: '/davomat-face', icon: ScanFace };

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
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatFaceNav,
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Pipeline', path: '/pipeline', icon: Kanban },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
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
    { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
    davomatFaceNav,
    { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
    { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Pipeline', path: '/pipeline', icon: Kanban },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
    ];

  const hrAuditorNav: NavItem[] = [
    { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
    kuzatuvNav,
    { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
    { name: 'Maqsad', path: '/maqsad', icon: Target },
    chatNav,
    orgNav,
    davomatFaceNav,
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
      orgNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatFaceNav,
      { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
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
      davomatFaceNav,
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
      orgNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatFaceNav,
      { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
      { name: 'Pipeline', path: '/pipeline', icon: Kanban },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
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
      davomatFaceNav,
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
      { name: 'Pipeline', path: '/pipeline', icon: Kanban },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
    ],
    mentor: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      chatNav,
      davomatFaceNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    department_head: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      davomatFaceNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
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
      davomatFaceNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
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
      davomatFaceNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
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
      davomatFaceNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    ombor: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Maqsad', path: '/maqsad', icon: Target },
      chatNav,
      davomatFaceNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    farmasevt: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      davomatFaceNav,
      orgNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    stajyor: [
      { name: 'Kirish', path: '/kirish', icon: GraduationCap },
      davomatFaceNav,
      orgNav,
    ],
  };

  const roleNav = roleNavigation[user.role] || [
    { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
  ];
  const withFace = roleNav.some((item) => item.path === '/davomat-face')
    ? roleNav
    : [...roleNav, davomatFaceNav];
  const navItems = canSeeHrRecruitment(user.role)
    ? withFace
    : withFace.filter((item) => !isHrRecruitmentPath(item.path));

  const toggleNav = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      setDesktopCollapsed((v) => !v);
    } else {
      setMobileOpen((v) => !v);
    }
  };

  const navSections = groupNavItems(navItems);
  const pinnedSet = new Set(pinnedIds);

  const togglePin = (id: string) => {
    setPinnedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setOpenSectionId(id);
  };

  const renderNavItem = (
    item: NavItem,
    opts: { collapsed: boolean; onNavigate?: () => void; nested?: boolean },
  ) => {
    const count = badgeByPath[item.path] ?? 0;
    const active = pathIsActive(location, item.path);
    const pulse = item.path === '/pharmacy-network' && count > 0;
    return (
      <Link key={item.path} href={item.path}>
        <div
          role="link"
          onClick={opts.onNavigate}
          className={cn(
            'relative flex items-center rounded-lg hover:bg-white/10 cursor-pointer transition-colors',
            opts.nested ? 'px-2.5 py-2' : 'px-3 py-3',
            active && 'bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]',
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
  };

  const renderNavLinks = (opts: { collapsed: boolean; onNavigate?: () => void }) =>
    navSections.map((section) => {
      const badgeSum = section.items.reduce((sum, item) => sum + (badgeByPath[item.path] ?? 0), 0);
      const hasActive = section.items.some((item) => pathIsActive(location, item.path));
      const pinned = pinnedSet.has(section.id);
      const open = opts.collapsed || pinned || openSectionId === section.id;

      if (opts.collapsed) {
        return (
          <div key={section.id} className="flex flex-col gap-1">
            {section.id !== navSections[0]?.id ? (
              <div className={cn('mx-2 my-1.5 h-0.5 rounded-full opacity-70', section.accent)} />
            ) : null}
            {section.items.map((item) => renderNavItem(item, opts))}
          </div>
        );
      }

      return (
        <div
          key={section.id}
          className={cn(
            'mb-1 overflow-hidden rounded-xl transition-colors',
            open ? 'bg-white/[0.05] ring-1 ring-white/10' : 'hover:bg-white/[0.03]',
          )}
        >
          <div className="flex items-center gap-0.5 pr-1">
            <button
              type="button"
              onClick={() =>
                setOpenSectionId((prev) => (prev === section.id && !pinned ? null : section.id))
              }
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left',
                hasActive || open ? section.chip : 'text-white/50',
              )}
            >
              <span className={cn('h-4 w-1 shrink-0 rounded-full', section.accent)} />
              <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.14em]">
                {section.label}
              </span>
              {badgeSum > 0 ? (
                <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                  {badgeSum > 99 ? '99+' : badgeSum}
                </span>
              ) : null}
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-white/45 transition-transform',
                  open && 'rotate-180',
                )}
              />
            </button>
            <button
              type="button"
              onClick={() => togglePin(section.id)}
              title={pinned ? 'Pinni yechish' : 'Ochiq tutib turish'}
              aria-label={pinned ? 'Pinni yechish' : 'Ochiq tutib turish'}
              className={cn(
                'shrink-0 rounded-md p-1.5 transition-colors',
                pinned
                  ? 'bg-amber-400/15 text-amber-300'
                  : 'text-white/30 hover:bg-white/10 hover:text-white/70',
              )}
            >
              <Pin className={cn('h-3.5 w-3.5', pinned && 'fill-current')} />
            </button>
          </div>
          {open ? (
            <div className={cn('mb-1.5 ml-3 mr-1.5 flex flex-col gap-0.5 border-l-2 pl-2', section.line)}>
              {section.items.map((item) => renderNavItem(item, { ...opts, nested: true }))}
            </div>
          ) : null}
        </div>
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

        <DavomatAttendanceBanner />

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
              location === '/pipeline' ||
                location === '/vazifalar' ||
                location === '/davomat' ||
                location.startsWith('/chat') ||
                location.startsWith('/kirish') ||
                location.startsWith('/tashkiliy-tuzilma')
                ? 'max-w-none h-full'
                : location === '/pharmacy-network'
                  ? 'max-w-none'
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
