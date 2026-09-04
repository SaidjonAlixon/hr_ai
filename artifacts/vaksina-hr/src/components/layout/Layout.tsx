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
  ListTodo,
  ClipboardList,
  ClipboardCheck,
  AlarmClock,
  Network,
  ScanFace,
  ChevronDown,
  ChevronLeft,
  Pin,
  Video,
  Trophy,
  BarChart3,
  Banknote,
  Calculator,
  Cpu,
  Wrench,
  HelpCircle,
  Layers,
  Package,
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
import { DavomatAttendanceBanner } from '@/components/DavomatAttendanceBanner';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { ThemeToggle } from '@/components/theme-toggle';
import { FaceIdEnroll } from '@/components/FaceIdEnroll';
import { HelpAssistantDialog } from '@/components/HelpAssistantDialog';
import { OperatorHeadsetIcon } from '@/components/OperatorHeadsetIcon';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useI18n, navLabelForPath } from '@/i18n/I18nProvider';
import { updateMyProfile } from '@/lib/face-id';
import { isHrManager, isHrRole, isHrOversight, hasHrOversightNav, normalizeUserRole, isStajyor, canSeeHrRecruitment, isHrRecruitmentPath, canViewReviziya, canViewEmployees, canViewDavomat, canManageSettings, userRoleLabel } from '@/lib/roles';
import { useTelegramMiniAppChrome } from '@/pages/tg-entry';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

function splitFullName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] || '', last: '' };
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}

function profileDisplayName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return full.trim() || '—';
  return `${parts[0]} ${parts[1]!.charAt(0).toUpperCase()}.`;
}

type NavIcon = React.ComponentType<{ className?: string }>;

type NavItem = {
  name: string;
  path: string;
  icon: NavIcon;
};

type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
  icon: NavIcon;
};

const NAV_SECTIONS: {
  id: string;
  label: string;
  icon: NavIcon;
  paths: string[];
}[] = [
  {
    id: 'main',
    label: 'Asosiy',
    icon: Layers,
    paths: ['/dashboard', '/kirish', '/tashkiliy-tuzilma', '/oylik', '/hisobkitob', '/reyting', '/reviziya', '/it', '/texnik'],
  },
  {
    id: 'work',
    label: 'Mening ishim',
    icon: Package,
    paths: ['/vazifalar', '/vazifalar/tahlil', '/eslatmalar'],
  },
  {
    id: 'requests',
    label: 'Arizalar',
    icon: FileText,
    paths: ['/requests'],
  },
  {
    id: 'staff',
    label: 'Xodimlar',
    icon: Users,
    paths: ['/employees'],
  },
  {
    id: 'recruitment',
    label: 'Ishga qabul',
    icon: Briefcase,
    paths: [
      '/vacancies',
      '/candidates',
      '/interviews',
      '/internships',
    ],
  },
  {
    id: 'attendance',
    label: 'Davomat',
    icon: AlarmClock,
    paths: ['/davomat/analytics', '/davomat-face', '/davomat', '/smena-filial', '/checklist-holati'],
  },
  {
    id: 'pharmacy',
    label: "Apteka tarmog'i",
    icon: Store,
    paths: ['/pharmacy-network', '/checklist', '/ehtiyoj'],
  },
  {
    id: 'admin',
    label: 'Sozlamalar',
    icon: Settings,
    paths: ['/admin/users', '/admin/holat', '/admin/departments', '/admin/kirish-videolar', '/admin/faces'],
  },
];

function groupNavItems(
  items: NavItem[],
  role: string | undefined,
  t: (key: string, fallback?: string) => string,
): NavSection[] {
  const byPath = new Map(items.map((item) => [item.path, item]));
  const used = new Set<string>();
  const groups: NavSection[] = [];
  for (const sec of NAV_SECTIONS) {
    const paths =
      role === 'director' && sec.id === 'attendance'
        ? ['/davomat', '/davomat/analytics', '/smena-filial', '/checklist-holati', '/davomat-face']
        : sec.paths;
    const list = paths
      .map((path) => byPath.get(path))
      .filter((item): item is NavItem => !!item);
    if (!list.length) continue;
    groups.push({
      id: sec.id,
      label: t(`nav.section.${sec.id}`, sec.label),
      icon: sec.icon,
      items: list,
    });
    for (const item of list) used.add(item.path);
  }
  const rest = items.filter((item) => !used.has(item.path));
  if (rest.length) {
    groups.push({
      id: 'other',
      label: t('nav.section.other', 'Boshqa'),
      icon: HelpCircle,
      items: rest,
    });
  }
  return groups;
}

function pathIsActive(location: string, path: string) {
  if (location === path) return true;
  if (!location.startsWith(`${path}/`)) return false;
  // /vazifalar should not highlight when on /vazifalar/tahlil
  if (path === '/vazifalar' && location.startsWith('/vazifalar/tahlil')) return false;
  return true;
}

/** Map notification linkUrl → sidebar path */
function linkToNavPath(linkUrl?: string | null): string | null {
  if (!linkUrl) return null;
  const path = linkUrl.split('?')[0];

  if (path.startsWith('/requests') || path.startsWith('/nazorat')) return '/requests';
  if (path.startsWith('/vacancies')) return '/vacancies';
  if (path.startsWith('/employees')) return '/employees';
  if (path.startsWith('/smena-filial')) return '/smena-filial';
  if (path.startsWith('/davomat/analytics')) return '/davomat/analytics';
  if (path.startsWith('/davomat-face')) return '/davomat-face';
  if (path.startsWith('/davomat')) return '/davomat';
  if (path.startsWith('/checklist-holati')) return '/checklist-holati';
  if (path.startsWith('/internships')) return '/internships';
  if (path.startsWith('/pharmacy-network')) return '/pharmacy-network';
  if (path.startsWith('/tashkiliy-tuzilma')) return '/tashkiliy-tuzilma';
  if (path.startsWith('/ehtiyoj')) return '/ehtiyoj';
  if (path.startsWith('/vazifalar/tahlil')) return '/vazifalar/tahlil';
  if (path.startsWith('/vazifalar')) return '/vazifalar';
  if (path.startsWith('/eslatmalar')) return '/eslatmalar';
  if (path.startsWith('/chat')) return '/chat';
  if (path.startsWith('/kirish')) return '/kirish';
  if (path.startsWith('/interviews')) return '/interviews';
  if (path.startsWith('/admin/users')) return '/admin/users';
  if (path.startsWith('/admin/holat')) return '/admin/holat';
  if (path.startsWith('/admin/faces')) return '/admin/faces';
  if (path.startsWith('/admin/departments')) return '/admin/departments';
  if (path.startsWith('/admin/kirish-videolar')) return '/admin/kirish-videolar';
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
  tone = 'rose',
}: {
  count: number;
  collapsed?: boolean;
  pulse?: boolean;
  tone?: 'rose' | 'soft' | 'section';
}) {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold leading-none',
        pulse && 'animate-pulse ring-2 ring-violet-300/50',
        tone === 'soft' && 'bg-white text-[#5b4cdb] shadow-sm',
        tone === 'section' && 'bg-white/15 text-white/90',
        tone === 'rose' && 'bg-rose-500 text-white',
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
  useTelegramMiniAppChrome();
  const { t } = useI18n();
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
      const raw = localStorage.getItem('vaksina-nav-pins-v2');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });
  const markedPathsRef = useRef<Set<string>>(new Set());
  const { toast } = useToast();
  const [facePhotoUrl, setFacePhotoUrl] = React.useState<string | null>(null);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [profileFirst, setProfileFirst] = React.useState('');
  const [profileLast, setProfileLast] = React.useState('');
  const [profilePassword, setProfilePassword] = React.useState('');
  const [profilePassword2, setProfilePassword2] = React.useState('');
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  const onFaceStatusChange = React.useCallback(
    (status: { registered: boolean; photoUrl?: string | null }) => {
      setFacePhotoUrl(status.photoUrl ?? null);
    },
    [],
  );

  const openProfileEditor = () => {
    const parts = splitFullName(user?.fullName || '');
    setProfileFirst(parts.first);
    setProfileLast(parts.last);
    setProfilePassword('');
    setProfilePassword2('');
    setProfileOpen(true);
  };

  const saveProfile = async () => {
    if (!profileFirst.trim() || !profileLast.trim()) {
      toast({ title: t('common.enterName'), variant: 'destructive' });
      return;
    }
    if (!profilePassword.trim()) {
      toast({ title: t('common.enterNewPassword'), variant: 'destructive' });
      return;
    }
    if (profilePassword !== profilePassword2) {
      toast({ title: t('common.passwordMismatch'), variant: 'destructive' });
      return;
    }
    setProfileSaving(true);
    try {
      const res = await updateMyProfile({
        firstName: profileFirst.trim(),
        lastName: profileLast.trim(),
        password: profilePassword.trim(),
      });
      if (res.user && user) {
        setUser({
          ...user,
          fullName: res.user.fullName,
          id: res.user.id,
          role: (res.user.role as typeof user.role) || user.role,
        });
      }
      setProfileOpen(false);
      toast({
        title: t('common.saved'),
        description: t('common.profileSavedDesc'),
      });
    } catch (err: unknown) {
      toast({
        title: t('common.notSaved'),
        description: err instanceof Error ? err.message : t('common.error'),
        variant: 'destructive',
      });
    } finally {
      setProfileSaving(false);
    }
  };

  // Sahifa o‘zgaganda mobil menyuni yopish
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  // Yangi sahifaga o‘tganda tegishli bo‘limni ochish (faqat o‘sha bo‘lim)
  useEffect(() => {
    const sec = NAV_SECTIONS.find((s) => s.paths.some((p) => pathIsActive(location, p)));
    if (sec) setOpenSectionId(sec.id);
  }, [location]);

  useEffect(() => {
    try {
      localStorage.setItem('vaksina-nav-pins-v2', JSON.stringify(pinnedIds));
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
    {
      query: {
        enabled: !!user,
        staleTime: 45_000,
        refetchInterval: 90_000,
        refetchOnWindowFocus: false,
      },
    } as any,
  );

  // Badge uchun — og‘ir so‘rovlarni kam poll qilamiz (RealtimeSync yetarli)
  const { data: dashboardStats } = useGetDashboardStats({
    query: {
      enabled: !!user,
      staleTime: 60_000,
      refetchInterval: 120_000,
      refetchOnWindowFocus: false,
    },
  } as any);

  const { data: staffingAlerts } = useStaffingAlerts('open', {
    enabled: !!user && isPharmacyStaff,
    staleTime: 60_000,
    refetchInterval: 90_000,
    refetchOnWindowFocus: false,
  });

  const { data: requests } = useGetRequests(undefined, {
    query: {
      enabled: !!user && isHrLike,
      staleTime: 60_000,
      refetchInterval: 120_000,
      refetchOnWindowFocus: false,
    },
  } as any);

  const { data: draftVacancies } = useGetVacancies(
    { status: 'draft' },
    {
      query: {
        enabled: !!user && (isRecruiter || isHrManager(user?.role)),
        staleTime: 60_000,
        refetchInterval: 120_000,
        refetchOnWindowFocus: false,
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
    if (location.startsWith('/reviziya') && !canViewReviziya(user.role)) {
      setLocation('/dashboard');
    }
    if (
      user.role === 'director' &&
      (location.startsWith('/it') || location.startsWith('/texnik'))
    ) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/employees') && !canViewEmployees(user.role)) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/admin/users') && !canManageSettings(user.role)) {
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
  const orgNav = { name: 'Tashkiliy tuzilma', path: '/tashkiliy-tuzilma', icon: Network };
  const davomatAnalyticsNav = { name: 'Davomat tahlili', path: '/davomat/analytics', icon: BarChart3 };
  const davomatFaceNav = { name: 'Davomat', path: '/davomat-face', icon: ScanFace };
  const smenaNav = { name: 'Smena va filial', path: '/smena-filial', icon: AlarmClock };
  const oylikNav = { name: 'Oylik', path: '/oylik', icon: Banknote };
  const hisobNav = { name: 'Oylik hisob', path: '/hisobkitob', icon: Calculator };
  const reytingNav = { name: 'Reyting', path: '/reyting', icon: Trophy };
  const reviziyaNav = { name: 'Reviziya', path: '/reviziya', icon: ClipboardCheck };
  const itNav = { name: 'IT', path: '/it', icon: Cpu };
  const texnikNav = { name: 'Texnik', path: '/texnik', icon: Wrench };

  const taskAnalyticsNav: NavItem = {
    name: 'Topshiriqlar tahlili',
    path: '/vazifalar/tahlil',
    icon: BarChart3,
  };

  function ensureTaskAnalyticsNav(items: NavItem[]): NavItem[] {
    if (items.some((i) => i.path === '/vazifalar/tahlil')) return items;
    const idx = items.findIndex((i) => i.path === '/vazifalar');
    if (idx < 0) return items;
    return [...items.slice(0, idx + 1), taskAnalyticsNav, ...items.slice(idx + 1)];
  }

  function injectCommonNav(items: NavItem[], role: string): NavItem[] {
    let next = [...items];
    if (!hasHrOversightNav(role)) {
      if (!next.some((i) => i.path === '/vazifalar')) {
        const dashIdx = next.findIndex((i) => i.path === '/dashboard');
        const kirishIdx = next.findIndex((i) => i.path === '/kirish');
        const anchor = dashIdx >= 0 ? dashIdx : kirishIdx;
        const at = anchor >= 0 ? anchor + 1 : 0;
        next = [
          ...next.slice(0, at),
          { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
          ...next.slice(at),
        ];
      }
      if (!next.some((i) => i.path === '/oylik')) {
        const dashIdx = next.findIndex((i) => i.path === '/dashboard');
        const at = dashIdx >= 0 ? dashIdx + 1 : 0;
        next = [...next.slice(0, at), oylikNav, ...next.slice(at)];
      }
      if (canViewReviziya(user.role) && !next.some((i) => i.path === '/reviziya')) {
        const orgIdx = next.findIndex((i) => i.path === '/tashkiliy-tuzilma');
        const at = orgIdx >= 0 ? orgIdx + 1 : next.length;
        next = [...next.slice(0, at), reviziyaNav, ...next.slice(at)];
      }
      if (canViewDavomat(user.role) && !next.some((i) => i.path === '/davomat/analytics')) {
        const davIdx = next.findIndex((i) => i.path === '/davomat');
        const at = davIdx >= 0 ? davIdx : next.length;
        next = [...next.slice(0, at), davomatAnalyticsNav, ...next.slice(at)];
      }
      if ((user.role === 'admin' || user.role === 'mudir' || user.role === 'koordinator') && !next.some((i) => i.path === '/it')) {
        next = [...next, itNav, texnikNav];
      }
    }
    return ensureTaskAnalyticsNav(next);
  }

  const hrMenejerNav: NavItem[] = [
    { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
    { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
    orgNav,
    { name: 'Arizalar', path: '/requests', icon: FileText },
    { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
    { name: 'Nomzodlar', path: '/candidates', icon: Users },
    { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatFaceNav,
      smenaNav,
      { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Holat', path: '/admin/holat', icon: BarChart3 },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
    ];

  const hrOversightNav: NavItem[] = [
    { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
    orgNav,
    oylikNav,
    hisobNav,
    reviziyaNav,
    itNav,
    texnikNav,
    { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
    { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
    { name: 'Arizalar', path: '/requests', icon: FileText },
    { name: 'Xodimlar', path: '/employees', icon: Users },
    { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
    { name: 'Nomzodlar', path: '/candidates', icon: Users },
    { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
    { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
    davomatAnalyticsNav,
    davomatFaceNav,
    { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
    smenaNav,
    { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
    { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    { name: 'Holat', path: '/admin/holat', icon: BarChart3 },
    { name: "Bo'limlar", path: '/admin/departments', icon: Settings },
    { name: 'Kirish materiallari', path: '/admin/kirish-videolar', icon: Video },
    { name: 'Face ID', path: '/admin/faces', icon: ScanFace },
  ];

  const roleNavigation: Record<string, NavItem[]> = {
    admin: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      hisobNav,
      { name: 'IT', path: '/it', icon: Cpu },
      { name: 'Texnik', path: '/texnik', icon: Wrench },
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatFaceNav,
      smenaNav,
      { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
      { name: 'Foydalanuvchilar', path: '/admin/users', icon: Settings },
      { name: 'Face ID', path: '/admin/faces', icon: ScanFace },
      { name: 'Holat', path: '/admin/holat', icon: BarChart3 },
      { name: "Bo'limlar", path: '/admin/departments', icon: Settings },
      { name: 'Kirish materiallari', path: '/admin/kirish-videolar', icon: Video },
    ],
    recruiter: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    director: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      hisobNav,
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatAnalyticsNav,
      smenaNav,
      { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
      davomatFaceNav,
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Foydalanuvchilar', path: '/admin/users', icon: Settings },
      { name: 'Holat', path: '/admin/holat', icon: BarChart3 },
      { name: "Bo'limlar", path: '/admin/departments', icon: Settings },
      { name: 'Kirish materiallari', path: '/admin/kirish-videolar', icon: Video },
      { name: 'Face ID', path: '/admin/faces', icon: ScanFace },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    hr: hrMenejerNav,
    hr_menejer: hrMenejerNav,
    hr_direktor: hrOversightNav,
    hr_kadr_rahbar: hrOversightNav,
    hr_auditor: hrOversightNav,
    trainer: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
      smenaNav,
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Suhbatlar', path: '/interviews', icon: Calendar },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
    ],
    mentor: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
      smenaNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    department_head: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
      smenaNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    mudir: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    koordinator: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Cheklist', path: '/checklist', icon: ClipboardCheck },
      { name: 'Reyting', path: '/checklist-holati', icon: Trophy },
    ],
    texnik: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Texnik', path: '/texnik', icon: Wrench },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    texnik_rahbar: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Texnik', path: '/texnik', icon: Wrench },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    it: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'IT', path: '/it', icon: Cpu },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    it_rahbar: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'IT', path: '/it', icon: Cpu },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    ombor: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
      smenaNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    sb: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    sb_boshliq: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    farmasevt: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      reytingNav,
      davomatFaceNav,
      smenaNav,
    ],
    moliya: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Oylik', path: '/oylik', icon: Banknote },
      { name: 'Oylik hisob', path: '/hisobkitob', icon: Calculator },
      { name: 'Reviziya', path: '/reviziya', icon: ClipboardCheck },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      orgNav,
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatFaceNav,
      smenaNav,
      { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
    ],
    stajyor: [
      { name: 'Kirish', path: '/kirish', icon: GraduationCap },
      reytingNav,
      davomatFaceNav,
      smenaNav,
    ],
    revizor: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Reviziya', path: '/reviziya', icon: ClipboardCheck },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    reviziya_rahbar: [
      { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Reviziya', path: '/reviziya', icon: ClipboardCheck },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
  };

  const userRole = normalizeUserRole(user.role);
  const oversightNav = hasHrOversightNav(userRole);
  const roleNav = injectCommonNav(
    oversightNav
      ? hrOversightNav
      : roleNavigation[userRole] || [
          { name: 'Boshqaruv', path: '/dashboard', icon: LayoutDashboard },
        ],
    userRole,
  );
  const withFace = roleNav.some((item) => item.path === '/davomat-face')
    ? roleNav
    : [...roleNav, davomatFaceNav];
  const navItems = (canSeeHrRecruitment(userRole)
    ? withFace
    : withFace.filter((item) => !isHrRecruitmentPath(item.path))
  );

  const toggleNav = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      setDesktopCollapsed((v) => !v);
    } else {
      setMobileOpen((v) => !v);
    }
  };

  const navSections = groupNavItems(navItems, userRole, t);
  const pinnedSet = new Set(pinnedIds);

  const togglePin = (id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      return next;
    });
    setOpenSectionId(id);
  };

  const toggleSection = (id: string, pinned: boolean) => {
    if (pinned) return;
    setOpenSectionId((prev) => (prev === id ? null : id));
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
            'group relative flex items-center gap-2.5 cursor-pointer transition-all duration-200',
            opts.nested
              ? cn(
                  'rounded-lg px-2 py-1.5',
                  active
                    ? 'app-sidebar-nested-item-active'
                    : 'app-sidebar-nested-item',
                )
              : cn(
                  'rounded-lg px-2.5 py-2',
                  active ? 'app-sidebar-nav-item-active' : 'app-sidebar-nav-item active:scale-[0.99]',
                ),
          )}
        >
          <span
            className={cn(
              'relative flex shrink-0 items-center justify-center transition-colors',
              opts.nested &&
                cn(
                  'h-7 w-7 rounded-md',
                  active
                    ? 'bg-violet-500/25 text-violet-100'
                    : 'bg-white/[0.06] text-white/55 group-hover:bg-white/10 group-hover:text-white',
                ),
            )}
          >
            <item.icon
              className={cn(
                'transition-colors',
                opts.nested ? 'h-3.5 w-3.5' : 'h-4 w-4 min-w-[16px]',
                !opts.nested &&
                  (active ? 'text-white' : 'text-white/55 group-hover:text-white/90'),
              )}
            />
            {opts.collapsed && <NavBadge count={count} collapsed pulse={pulse} tone="soft" />}
          </span>
          {!opts.collapsed && (
            <>
              <span
                className={cn(
                  'min-w-0 flex-1 text-[12px] font-medium leading-snug break-words',
                  opts.nested && active && 'font-semibold text-white',
                  opts.nested && !active && 'text-white/72 group-hover:text-white',
                )}
              >
                {navLabelForPath(item.path, t, item.name)}
              </span>
              {opts.nested && active ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300 shadow-[0_0_8px_rgba(196,181,253,0.9)]" aria-hidden />
              ) : (
                <NavBadge count={count} pulse={pulse} tone={opts.nested ? 'soft' : 'rose'} />
              )}
            </>
          )}
        </div>
      </Link>
    );
  };

  const renderNavLinks = (opts: { collapsed: boolean; onNavigate?: () => void; mobile?: boolean }) =>
    navSections.map((section) => {
      const badgeSum = section.items.reduce((sum, item) => sum + (badgeByPath[item.path] ?? 0), 0);
      const hasActive = section.items.some((item) => pathIsActive(location, item.path));
      const pinned = pinnedSet.has(section.id);
      const open = opts.collapsed || pinned || openSectionId === section.id;
      const SectionIcon = section.icon;

      if (opts.collapsed) {
        return (
          <div key={section.id} className="flex flex-col gap-0.5">
            {section.id !== navSections[0]?.id ? (
              <div className="mx-2.5 my-1.5 h-px rounded-full bg-white/10" />
            ) : null}
            {section.items.map((item) => renderNavItem(item, opts))}
          </div>
        );
      }

      return (
        <div key={section.id} className="mb-1">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => toggleSection(section.id, pinned)}
              aria-expanded={open}
              className={cn(
                'app-sidebar-section-trigger flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-all duration-200',
                open && 'app-sidebar-section-trigger-open',
                hasActive && !open && 'ring-1 ring-violet-400/25',
              )}
            >
              <span className="app-sidebar-section-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                <SectionIcon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-white">
                {section.label}
              </span>
              {badgeSum > 0 ? <NavBadge count={badgeSum} tone="section" /> : null}
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-white/45 transition-transform duration-200',
                  open && 'rotate-180 text-white/80',
                )}
              />
            </button>
            <button
              type="button"
              onClick={() => togglePin(section.id)}
              title={pinned ? t('common.unpinPin') : t('common.pinKeep')}
              aria-label={pinned ? t('common.unpinPin') : t('common.pinKeep')}
              className={cn(
                'shrink-0 rounded-lg p-1.5 transition-colors',
                pinned
                  ? 'bg-violet-400/30 text-violet-100'
                  : 'text-white/70 hover:bg-white/10 hover:text-white',
              )}
            >
              <Pin className={cn('h-3.5 w-3.5', pinned && 'fill-current')} />
            </button>
          </div>
          <div
            className={cn(
              'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
              open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
            )}
          >
            <div className="overflow-hidden">
              <div className="app-sidebar-nested-panel mt-1 ml-0.5 mr-0.5 flex flex-col gap-0.5 p-1">
                {section.items.map((item) =>
                  renderNavItem(item, { ...opts, nested: true }),
                )}
              </div>
            </div>
          </div>
        </div>
      );
    });

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden">
      {/* Mobil: fon (overlay) */}
      {mobileOpen ? (
        <button
          type="button"
          aria-label={t('common.closeMenu')}
          className="fixed inset-0 z-40 bg-[#06101c]/55 backdrop-blur-[2px] md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* Sidebar: mobilda drawer, desktopda doimiy */}
      <aside
        className={cn(
          'app-sidebar flex flex-col transition-[transform,width] duration-300 ease-out',
          'fixed inset-y-0 left-0 z-50 w-[min(19.5rem,92vw)]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:static md:z-auto md:translate-x-0',
          desktopCollapsed ? 'md:w-[4.75rem]' : 'md:w-[17rem]',
          mobileOpen && 'rounded-r-[1.35rem]',
        )}
      >
        <div className="app-sidebar-brand relative shrink-0 pt-[env(safe-area-inset-top)]">
          <div className="relative flex items-center gap-1 px-2.5 py-2 md:px-3">
            <div className={cn('min-w-0 flex-1', desktopCollapsed && 'md:hidden')}>
              <img
                src={`${import.meta.env.BASE_URL}logo3d-light.png`}
                alt="VAKSINA MED HR"
                width={800}
                height={220}
                decoding="async"
                className="app-sidebar-logo"
              />
            </div>
            {desktopCollapsed ? (
              <div className="mx-auto hidden h-10 w-10 items-center justify-center rounded-xl bg-white/90 shadow-sm ring-1 ring-violet-200/60 md:flex">
                <img
                  src={`${import.meta.env.BASE_URL}faviconni.png`}
                  alt="VM"
                  width={72}
                  height={72}
                  decoding="async"
                  className="h-8 w-8 object-contain"
                />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 md:hidden"
              aria-label="Yopish"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain px-2.5 py-2 md:px-2.5">
          <div className="flex flex-col gap-1 md:hidden">
            {renderNavLinks({
              collapsed: false,
              mobile: true,
              onNavigate: () => setMobileOpen(false),
            })}
          </div>
          <div className="hidden md:flex md:flex-col md:gap-0.5">
            {renderNavLinks({ collapsed: desktopCollapsed })}
          </div>
        </nav>

        <div className={cn('shrink-0 space-y-1.5 px-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]', desktopCollapsed && 'md:px-2')}>
          <div
            className={cn(
              'app-sidebar-profile-card flex items-center gap-1.5',
              desktopCollapsed && 'md:justify-center md:p-1.5',
            )}
          >
            <button
              type="button"
              onClick={openProfileEditor}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left transition-colors hover:bg-white/[0.06]',
                desktopCollapsed && 'md:justify-center md:flex-none',
              )}
              title={t('common.profileEdit')}
            >
              <div
                className={cn(
                  'app-sidebar-profile-avatar ring-1 ring-white/15',
                  desktopCollapsed && 'md:h-8 md:w-8',
                )}
              >
                {facePhotoUrl ? (
                  <img src={facePhotoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  (user.fullName || 'U').slice(0, 1).toUpperCase()
                )}
              </div>
              <div className={cn('min-w-0 flex-1', desktopCollapsed && 'md:hidden')}>
                <span className="app-sidebar-profile-name">{profileDisplayName(user.fullName)}</span>
                <span className="mt-px flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[10px] text-white/50">{userRoleLabel(user.role)}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {t('common.online')}
                  </span>
                </span>
              </div>
            </button>
            <div className={cn('flex shrink-0 items-center', desktopCollapsed && 'md:flex-col')}>
              <ThemeToggle
                variant="sidebar"
                className="app-sidebar-profile-action h-7 w-7 rounded-md border-0"
              />
              <button
                onClick={handleLogout}
                className="app-sidebar-profile-action"
                title={t('common.logout')}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {user.role !== 'director' ? (
            <div className={cn(desktopCollapsed && 'md:hidden')}>
              <FaceIdEnroll compact onStatusChange={onFaceStatusChange} />
            </div>
          ) : null}

          <button
            type="button"
            onClick={toggleNav}
            className={cn(
              'app-sidebar-collapse-btn flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/65 transition-colors hover:bg-white/10 hover:text-white',
              desktopCollapsed && 'md:px-0',
            )}
            aria-label={desktopCollapsed ? t('common.expandMenu') : t('common.collapseMenu')}
          >
            <ChevronLeft className={cn('h-3.5 w-3.5 transition-transform', desktopCollapsed && 'rotate-180')} />
            <span className={cn(desktopCollapsed && 'md:hidden')}>{t('common.collapseMenu')}</span>
          </button>
        </div>
      </aside>

      <HelpAssistantDialog open={helpOpen} onOpenChange={setHelpOpen} />

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="w-[calc(100%-1.25rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>{t('common.profile')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-3 rounded-xl border bg-muted p-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-lg font-bold text-muted-foreground">
                {facePhotoUrl ? (
                  <img src={facePhotoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  (user.fullName || 'U').slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{user.fullName}</p>
                <p className="truncate text-xs text-muted-foreground">{user.login}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="profile-first">{t('common.firstName')}</Label>
                <Input
                  id="profile-first"
                  value={profileFirst}
                  onChange={(e) => setProfileFirst(e.target.value)}
                  placeholder={t('common.firstName')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-last">{t('common.lastName')}</Label>
                <Input
                  id="profile-last"
                  value={profileLast}
                  onChange={(e) => setProfileLast(e.target.value)}
                  placeholder={t('common.lastName')}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-pass">{t('common.newPassword')}</Label>
              <Input
                id="profile-pass"
                type="text"
                autoComplete="new-password"
                value={profilePassword}
                onChange={(e) => setProfilePassword(e.target.value)}
                placeholder={t('common.newPassword')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-pass2">{t('common.confirmPassword')}</Label>
              <Input
                id="profile-pass2"
                type="text"
                autoComplete="new-password"
                value={profilePassword2}
                onChange={(e) => setProfilePassword2(e.target.value)}
                placeholder={t('common.retype')}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('common.profileHint')}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProfileOpen(false)}>
              {t('common.cancelShort')}
            </Button>
            <Button type="button" disabled={profileSaving} onClick={() => void saveProfile()}>
              {profileSaving ? t('common.saving') : t('common.changePassword')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden w-full">
        <header className="safe-top z-10 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/95 px-3 backdrop-blur-md sm:h-14 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleNav}
              className="shrink-0 -ml-1 rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t('common.menu')}
              aria-expanded={mobileOpen || !desktopCollapsed}
            >
              <Menu className="h-6 w-6" />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="shrink-0"
              aria-label={t('common.help')}
            >
              <span className="app-header-help-chip group inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2.5 py-1 sm:gap-2 sm:pl-1.5 sm:pr-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/20 transition group-hover:bg-white/20">
                  <OperatorHeadsetIcon className="h-5 w-5" />
                </span>
                <span className="flex min-w-0 flex-col leading-none text-left">
                  <span className="text-[11px] font-semibold text-white sm:text-[12px]">{t('common.help')}</span>
                  <span className="mt-0.5 hidden text-[9px] font-medium text-violet-100/75 sm:block">
                    {t('common.contact')}
                  </span>
                </span>
              </span>
            </button>
            <ThemeToggle />
            <Link href="/notifications">
              <div className="relative cursor-pointer rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <Bell className="h-5 w-5" />
                {totalUnread > 0 && (
                  <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
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
            'min-h-0 min-w-0 flex-1',
            'pb-[calc(4.85rem+env(safe-area-inset-bottom))] md:pb-0',
            location === '/vazifalar' ||
              location.startsWith('/vazifalar/tahlil') ||
              location.startsWith('/chat') ||
              location.startsWith('/kirish') ||
              location.startsWith('/tashkiliy-tuzilma')
              ? 'overflow-hidden p-0'
              : 'overflow-x-hidden overflow-y-auto p-3 sm:p-6',
          )}
        >
          <div
            className={cn(
              'mx-auto w-full min-w-0',
              location === '/vazifalar' ||
                location.startsWith('/vazifalar/tahlil') ||
                location === '/davomat' ||
                location.startsWith('/davomat/analytics') ||
                (location === '/dashboard' && user.role === 'director') ||
                location === '/oylik' ||
                location === '/hisobkitob' ||
                location.startsWith('/employees') ||
                location.startsWith('/chat') ||
                location.startsWith('/kirish') ||
                location.startsWith('/tashkiliy-tuzilma')
                ? 'h-full max-w-none'
                : location === '/pharmacy-network'
                  ? 'max-w-none'
                  : 'max-w-7xl',
            )}
          >
            {children}
          </div>
        </main>

        <MobileBottomNav
          role={user.role}
          location={location}
          navItems={navItems}
          hidden={mobileOpen}
        />
      </div>
    </div>
  );
};
