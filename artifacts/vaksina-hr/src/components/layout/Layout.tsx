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
  MonitorSmartphone,
  MapPin,
  Navigation,
  Radio,
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
  PhoneCall,
  Phone,
  Truck,
  Fuel,
  GripVertical,
  RotateCcw,
  SlidersHorizontal,
  Check,
  Eye,
  AlertTriangle,
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
import { fetchMyMobileAttendance } from '@/lib/mobile-attendance-api';
import { MobileGpsBackgroundTracker } from '@/components/davomat/MobileGpsBackgroundTracker';
import { DavomatAttendanceBanner } from '@/components/DavomatAttendanceBanner';
import { BoglanishMissingBanner } from '@/components/BoglanishMissingBanner';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { ThemeToggle } from '@/components/theme-toggle';
import { FaceIdEnroll } from '@/components/FaceIdEnroll';
import { HELP_ASSISTANT_ENABLED, HelpAssistantDialog } from '@/components/HelpAssistantDialog';
import { OperatorHeadsetIcon } from '@/components/OperatorHeadsetIcon';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useI18n, navLabelForPath } from '@/i18n/I18nProvider';
import { updateMyProfile } from '@/lib/face-id';
import { isHrManager, isHrRole, isHrOversight, hasHrOversightNav, normalizeUserRole, isStajyor, canSeeHrRecruitment, isHrRecruitmentPath, canViewReviziya, canViewEmployees, canViewDavomat, canViewDavomatXatoliklar, canManageSettings, canManageUsers, canViewDistribyutsiya, canViewOmborxona, canViewLogistika, canViewChecklistStatus, isDeptHeadRole, isLimitedOfficeStaffRole, userRoleLabel, isDirectorRole, hasFullPlatformAccess, usesDavomatDashboardHome } from "@/lib/roles";
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
import {
  type NavLayoutState,
  applyNavLayout,
  clearNavLayout,
  layoutFromSections,
  loadNavLayout,
  moveNavItem,
  moveNavSection,
  saveNavLayout,
} from '@/lib/nav-layout';

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
    paths: ['/dashboard', '/kirish', '/javob-olish', '/javob-olish/holat', '/tashkiliy-tuzilma', '/oylik', '/hisobkitob', '/reyting', '/reviziya', '/it'],
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
      '/internships',
    ],
  },
  {
    id: 'attendance',
    label: 'Davomat',
    icon: AlarmClock,
    paths: ['/davomat/analytics', '/davomat/xatoliklar', '/davomat-face', '/davomat', '/davomat-qr', '/smena-filial', '/checklist-holati'],
  },
  {
    id: 'pharmacy',
    label: "Apteka tarmog'i",
    icon: Store,
    paths: ['/pharmacy-network', '/boglanish', '/checklist', '/ehtiyoj'],
  },
  {
    id: 'logistika',
    label: 'Logistika',
    icon: Truck,
    paths: [
      '/logistika/dashboard',
      '/logistika/boshqaruv',
      '/logistika/live',
      '/logistika/davomat',
      '/logistika/panel',
    ],
  },
  {
    id: 'distribution',
    label: 'Distribyutsiya',
    icon: Truck,
    paths: ['/distribyutsiya'],
  },
  {
    id: 'warehouse',
    label: 'Omborxona',
    icon: Package,
    paths: ['/omborxona-ish'],
  },
  {
    id: 'admin',
    label: 'Sozlamalar',
    icon: Settings,
    paths: ['/admin/users', '/admin/holat', '/admin/departments', '/admin/kirish-videolar', '/admin/faces', '/admin/smena-sozlamalar', '/admin/davomat-qr', '/admin/test', '/admin/qurilmalar', '/admin/kochma-davomat', '/admin/kochma-xarita', '/admin/kochma-live'],
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
        ? ['/davomat', '/davomat/analytics', '/davomat/xatoliklar', '/smena-filial', '/checklist-holati', '/davomat-face']
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
  if (path === '/logistika' && location.startsWith('/logistika/')) return false;
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
  if (path.startsWith('/davomat/xatoliklar')) return '/davomat/xatoliklar';
  if (path.startsWith('/davomat-face')) return '/davomat-face';
  if (path.startsWith('/davomat')) return '/davomat';
  if (path.startsWith('/checklist-holati')) return '/checklist-holati';
  if (path.startsWith('/internships')) return '/internships';
  if (path.startsWith('/pharmacy-network')) return '/pharmacy-network';
  if (path.startsWith('/logistika')) return path;
  if (path.startsWith('/boglanish')) return '/boglanish';
  if (path.startsWith('/tashkiliy-tuzilma')) return '/tashkiliy-tuzilma';
  if (path.startsWith('/ehtiyoj')) return '/ehtiyoj';
  if (path.startsWith('/javob-olish/holat')) return '/javob-olish/holat';
  if (path.startsWith('/javob-olish')) return '/javob-olish';
  if (path.startsWith('/vazifalar/tahlil')) return '/vazifalar/tahlil';
  if (path.startsWith('/vazifalar')) return '/vazifalar';
  if (path.startsWith('/eslatmalar')) return '/eslatmalar';
  if (path.startsWith('/chat')) return '/chat';
  if (path.startsWith('/kirish')) return '/kirish';
  if (path.startsWith('/interviews')) return '/candidates';
  if (path.startsWith('/admin/users')) return '/admin/users';
  if (path.startsWith('/admin/holat')) return '/admin/holat';
  if (path.startsWith('/admin/faces')) return '/admin/faces';
  if (path.startsWith('/admin/smena-sozlamalar')) return '/admin/smena-sozlamalar';
  if (path.startsWith('/admin/davomat-qr')) return '/admin/davomat-qr';
  if (path.startsWith('/admin/test')) return '/admin/test';
  if (path.startsWith('/admin/qurilmalar')) return '/admin/qurilmalar';
  if (path.startsWith('/admin/kochma-davomat')) return '/admin/kochma-davomat';
  if (path.startsWith('/admin/kochma-xarita')) return '/admin/kochma-xarita';
  if (path.startsWith('/admin/kochma-live')) return '/admin/kochma-live';
  if (path.startsWith('/davomat-kochma')) return '/davomat-kochma';
  if (path.startsWith('/admin/departments')) return '/admin/departments';
  if (path.startsWith('/admin/kirish-videolar')) return '/admin/kirish-videolar';
  if (path.startsWith('/dashboard')) return '/dashboard';

  if (
    path.includes('interview') ||
    path.includes('preboarding') ||
    path.includes('final-decision') ||
    path.includes('/offer')
  ) {
    return '/candidates';
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
        tone === 'section' && 'bg-slate-900/10 text-slate-700 dark:bg-white/15 dark:text-white/90',
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
  const [navEditMode, setNavEditMode] = React.useState(false);
  const [navLayout, setNavLayout] = React.useState<NavLayoutState | null>(null);
  const [dragOverKey, setDragOverKey] = React.useState<string | null>(null);
  const navDragRef = useRef<
    | { kind: 'item'; path: string; fromSection: string }
    | { kind: 'section'; sectionId: string }
    | null
  >(null);
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
  const [mobileAttAllowed, setMobileAttAllowed] = React.useState(false);

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

  React.useEffect(() => {
    if (!user?.id) {
      setNavLayout(null);
      setMobileAttAllowed(false);
      return;
    }
    setNavLayout(loadNavLayout(user.id));
  }, [user?.id]);

  // Ko‘chma ruxsat — menyu yo‘q; GPS tracker + /davomat-face geofence bypass uchun
  useEffect(() => {
    if (!user?.id || !isAuthenticated) {
      setMobileAttAllowed(false);
      return;
    }
    let cancelled = false;
    void fetchMyMobileAttendance()
      .then((r) => {
        if (!cancelled) setMobileAttAllowed(Boolean(r.allowed));
      })
      .catch(() => {
        if (!cancelled) setMobileAttAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, isAuthenticated]);

  // Mobil menyu ochiq bo‘lsa body scrollni bloklash
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const isHrLike = isHrRole(user?.role) || user?.role === 'admin' || isDirectorRole(user?.role);
  const isRecruiter = user?.role === 'recruiter';
  const isPharmacyStaff = user?.role === 'koordinator' || user?.role === 'mudir';
  const davomatDashHome = usesDavomatDashboardHome(user?.role);

  const { data: unreadNotifications } = useGetNotifications(
    { unreadOnly: true },
    {
      query: {
        enabled: !!user,
        staleTime: 60_000,
        refetchInterval: 180_000,
        refetchOnWindowFocus: false,
      },
    } as any,
  );

  /** Davomat eslatmalari (faqat start−15m / end−1h) — OS bildirishnomasi */
  const shownOsDavomatRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!user || !unreadNotifications?.length) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const urgent = unreadNotifications.filter((n) => {
      const t = String(n.type || "");
      return (
        t === "davomat_shift_start_15m" ||
        t.startsWith("davomat_checkout_1h_") ||
        t === "notif_test"
      );
    });
    if (!urgent.length) return;

    const fire = () => {
      for (const n of urgent) {
        if (shownOsDavomatRef.current.has(n.id)) continue;
        shownOsDavomatRef.current.add(n.id);
        try {
          new Notification("VAKSINA HR — Davomat", {
            body: n.text,
            tag: `davomat-${n.id}`,
            requireInteraction: true,
          });
        } catch {
          /* ignore */
        }
      }
    };

    if (Notification.permission === "granted") {
      fire();
    } else if (Notification.permission === "default") {
      void Notification.requestPermission().then((p) => {
        if (p === "granted") fire();
      });
    }
  }, [user, unreadNotifications]);

  // Badge uchun — og‘ir so‘rovlarni kam poll qilamiz (RealtimeSync yetarli)
  const { data: dashboardStats } = useGetDashboardStats({
    query: {
      enabled: !!user,
      staleTime: 90_000,
      refetchInterval: 180_000,
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
      staleTime: 90_000,
      refetchInterval: 180_000,
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
    if (isStajyor(user.role)) {
      const stajyorAllowed =
        location.startsWith('/kirish') ||
        location.startsWith('/javob-olish') ||
        location.startsWith('/reyting') ||
        location.startsWith('/davomat-face') ||
        location.startsWith('/davomat-kochma') ||
        location.startsWith('/smena-filial') ||
        location.startsWith('/tashkiliy-tuzilma') ||
        location.startsWith('/vazifalar') ||
        location === '/notifications' ||
        location === '/profile' ||
        location.startsWith('/account');
      if (!stajyorAllowed) {
        setLocation('/kirish');
      }
    }
    if (isHrRecruitmentPath(location) && !canSeeHrRecruitment(user.role)) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/reviziya') && !canViewReviziya(user.role)) {
      setLocation('/dashboard');
    }
    if (
      user.role === 'director' &&
      location.startsWith('/it')
    ) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/employees') && !canViewEmployees(user.role)) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/admin/users') && !canManageUsers(user.role)) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/admin/qurilmalar') && !canManageUsers(user.role)) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/admin/kochma-davomat') && !canManageUsers(user.role)) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/admin/kochma-xarita') && !canManageUsers(user.role)) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/admin/kochma-live') && !canManageUsers(user.role)) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/logistika') && !canViewLogistika(user.role)) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/admin/smena-sozlamalar') && !canManageSettings(user.role)) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/admin/davomat-qr') && !canManageSettings(user.role)) {
      setLocation('/dashboard');
    }
    if (location.startsWith('/admin/test') && !canManageSettings(user.role)) {
      setLocation('/dashboard');
    }
    if (isLimitedOfficeStaffRole(user.role)) {
      const allowed =
        location.startsWith('/vazifalar') ||
        location.startsWith('/eslatmalar') ||
        location.startsWith('/davomat-face') ||
        location.startsWith('/davomat-kochma') ||
        location.startsWith('/omborxona-ish') ||
        location.startsWith('/it') ||
        location === '/notifications';
      if (!allowed) {
        setLocation('/vazifalar');
      }
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
  const davomatXatoliklarNav = { name: 'Xatoliklar', path: '/davomat/xatoliklar', icon: AlertTriangle };
  const davomatFaceNav = { name: 'Davomat', path: '/davomat-face', icon: ScanFace };
  const davomatKochmaNav = { name: "Ko‘chma davomat", path: '/davomat-kochma', icon: MapPin };
  const smenaNav = { name: 'Smena va filial', path: '/smena-filial', icon: AlarmClock };
  const javobNav = { name: 'Javob olish', path: '/javob-olish', icon: PhoneCall };
  const javobHolatNav = { name: 'Javob olish holati', path: '/javob-olish/holat', icon: Eye };
  const davomatQrNav = { name: 'Davomat QR', path: '/davomat-qr', icon: ScanFace };
  const oylikNav = { name: 'Oylik', path: '/oylik', icon: Banknote };
  const hisobNav = { name: 'Oylik hisob', path: '/hisobkitob', icon: Calculator };
  const reytingNav = { name: 'Reyting', path: '/reyting', icon: Trophy };
  const reviziyaNav = { name: 'Reviziya', path: '/reviziya', icon: ClipboardCheck };
  const itNav = { name: 'AyTi', path: '/it', icon: Cpu };
  const distribNav = { name: 'Distribyutsiya', path: '/distribyutsiya', icon: Truck };
  const omborIshNav = { name: 'Omborxona_ish', path: '/omborxona-ish', icon: Package };
  const logistikaNavItems: NavItem[] = [
    { name: 'Dashboard / VHK', path: '/logistika/dashboard', icon: LayoutDashboard },
    { name: 'Boshqaruv', path: '/logistika/boshqaruv', icon: Fuel },
    { name: 'Live', path: '/logistika/live', icon: Radio },
    { name: 'GPS Davomat', path: '/logistika/davomat', icon: ClipboardCheck },
    { name: 'Panel', path: '/logistika/panel', icon: Settings },
  ];

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
    // AyTi zayavka — barcha rollar (farmasevt, mudir, ofis, ...)
    if (!next.some((i) => i.path === '/it')) {
      next = [...next, itNav];
    }
    if (isLimitedOfficeStaffRole(role)) {
    if (canViewOmborxona(role) && !next.some((i) => i.path === '/omborxona-ish')) {
      next = [...next, omborIshNav];
    }
    return next;
  }
    // HR — Javob olish holatini kuzatish (Asosiy)
    if (hasHrOversightNav(role) && !next.some((i) => i.path === '/javob-olish/holat')) {
      const dashIdx = next.findIndex((i) => i.path === '/dashboard');
      const at = dashIdx >= 0 ? dashIdx + 1 : 0;
      next = [...next.slice(0, at), javobHolatNav, ...next.slice(at)];
    }
    // Farmasevt / mudir / stajyor / ofis — Javob olish Asosiyda doim ko‘rinsin
    if (
      (role === 'farmasevt' ||
        role === 'mudir' ||
        role === 'stajyor' ||
        role === 'koordinator' ||
        role === 'admin' ||
        isDirectorRole(role)) &&
      !next.some((i) => i.path === '/javob-olish')
    ) {
      const dashIdx = next.findIndex((i) => i.path === '/dashboard');
      const at = dashIdx >= 0 ? dashIdx + 1 : 0;
      next = [...next.slice(0, at), javobNav, ...next.slice(at)];
    }
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
        const javobIdx = next.findIndex((i) => i.path === '/javob-olish');
        const dashIdx = next.findIndex((i) => i.path === '/dashboard');
        const at = javobIdx >= 0 ? javobIdx + 1 : dashIdx >= 0 ? dashIdx + 1 : 0;
        next = [...next.slice(0, at), oylikNav, ...next.slice(at)];
      }
      if (canViewReviziya(role) && !next.some((i) => i.path === '/reviziya')) {
        const orgIdx = next.findIndex((i) => i.path === '/tashkiliy-tuzilma');
        const at = orgIdx >= 0 ? orgIdx + 1 : next.length;
        next = [...next.slice(0, at), reviziyaNav, ...next.slice(at)];
      }
      if (canViewDavomat(role) && !next.some((i) => i.path === '/davomat/analytics')) {
        const davIdx = next.findIndex((i) => i.path === '/davomat');
        const at = davIdx >= 0 ? davIdx : next.length;
        next = [...next.slice(0, at), davomatAnalyticsNav, ...next.slice(at)];
      }
      if (canViewDavomatXatoliklar(role) && !next.some((i) => i.path === '/davomat/xatoliklar')) {
        const baseIdx = next.findIndex(
          (i) => i.path === '/davomat/analytics' || i.path === '/davomat',
        );
        const insertAt = baseIdx >= 0 ? baseIdx + 1 : next.length;
        next = [...next.slice(0, insertAt), davomatXatoliklarNav, ...next.slice(insertAt)];
      }
      if (canViewDistribyutsiya(role) && !next.some((i) => i.path === '/distribyutsiya')) {
        next = [...next, distribNav];
      }
      if (canViewOmborxona(role) && !next.some((i) => i.path === '/omborxona-ish')) {
        next = [...next, omborIshNav];
      }
    }
    if (isDeptHeadRole(role) && !next.some((i) => i.path === '/davomat-qr') && !next.some((i) => i.path === '/admin/davomat-qr')) {
      const faceIdx = next.findIndex((i) => i.path === '/davomat-face');
      const at = faceIdx >= 0 ? faceIdx + 1 : next.length;
      next = [...next.slice(0, at), davomatQrNav, ...next.slice(at)];
    }
    // Oddiy xodim / mudir / farmasevt — Xodimlar menyusi yo‘q
    if (!canViewEmployees(role)) {
      next = next.filter((i) => i.path !== '/employees');
    }
    // Cheklist holati — auditor/HR/direktor
    if (canViewChecklistStatus(role)) {
      if (!next.some((i) => i.path === '/checklist-holati')) {
        const davIdx = next.findIndex((i) => i.path === '/davomat' || i.path === '/davomat/analytics');
        const at = davIdx >= 0 ? davIdx + 1 : next.length;
        next = [
          ...next.slice(0, at),
          { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
          ...next.slice(at),
        ];
      }
    } else {
      next = next.filter((i) => i.path !== '/checklist-holati');
    }
    // Foydalanuvchilar — faqat admin
    if (canManageUsers(role)) {
      if (!next.some((i) => i.path === '/admin/users')) {
        const holatIdx = next.findIndex((i) => i.path === '/admin/holat');
        const at = holatIdx >= 0 ? holatIdx : next.length;
        next = [
          ...next.slice(0, at),
          { name: 'Foydalanuvchilar', path: '/admin/users', icon: Users },
          ...next.slice(at),
        ];
      }
      if (!next.some((i) => i.path === '/admin/qurilmalar')) {
        const usersIdx = next.findIndex((i) => i.path === '/admin/users');
        const at = usersIdx >= 0 ? usersIdx + 1 : next.length;
        next = [
          ...next.slice(0, at),
          { name: 'Qurilmalar', path: '/admin/qurilmalar', icon: MonitorSmartphone },
          ...next.slice(at),
        ];
      }
      if (!next.some((i) => i.path === '/admin/kochma-davomat')) {
        const qIdx = next.findIndex((i) => i.path === '/admin/qurilmalar');
        const at = qIdx >= 0 ? qIdx + 1 : next.length;
        next = [
          ...next.slice(0, at),
          { name: "Ko‘chma davomat", path: '/admin/kochma-davomat', icon: MapPin },
          { name: "Ko‘chma xarita", path: '/admin/kochma-xarita', icon: Navigation },
          { name: "Jonli kuzatuv", path: '/admin/kochma-live', icon: Radio },
          ...next.slice(at),
        ];
      } else {
        if (!next.some((i) => i.path === '/admin/kochma-xarita')) {
          const kIdx = next.findIndex((i) => i.path === '/admin/kochma-davomat');
          const at = kIdx >= 0 ? kIdx + 1 : next.length;
          next = [
            ...next.slice(0, at),
            { name: "Ko‘chma xarita", path: '/admin/kochma-xarita', icon: Navigation },
            ...next.slice(at),
          ];
        }
        if (!next.some((i) => i.path === '/admin/kochma-live')) {
          const xIdx = next.findIndex((i) => i.path === '/admin/kochma-xarita');
          const at = xIdx >= 0 ? xIdx + 1 : next.length;
          next = [
            ...next.slice(0, at),
            { name: "Jonli kuzatuv", path: '/admin/kochma-live', icon: Radio },
            ...next.slice(at),
          ];
        }
      }
    } else {
      next = next.filter(
        (i) =>
          i.path !== '/admin/users' &&
          i.path !== '/admin/qurilmalar' &&
          i.path !== '/admin/kochma-davomat' &&
          i.path !== '/admin/kochma-xarita' &&
          i.path !== '/admin/kochma-live',
      );
    }
    // Alohida /davomat-kochma menyu yo‘q — ruxsat asosiy Davomatda yashirin
    next = next.filter((i) => i.path !== '/davomat-kochma');
    return ensureTaskAnalyticsNav(next);
  }

  const hrMenejerNav: NavItem[] = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    javobHolatNav,
    { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
    { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
    orgNav,
    { name: 'Arizalar', path: '/requests', icon: FileText },
    { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
    { name: 'Nomzodlar', path: '/candidates', icon: Users },
    { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatFaceNav,
      smenaNav,
      { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Hisobot', path: '/admin/holat', icon: BarChart3 },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
    ];

  const hrOversightNav: NavItem[] = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
    javobHolatNav,
    orgNav,
    oylikNav,
    hisobNav,
    reviziyaNav,
    { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
    { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
    { name: 'Arizalar', path: '/requests', icon: FileText },
    { name: 'Xodimlar', path: '/employees', icon: Users },
    { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
    { name: 'Nomzodlar', path: '/candidates', icon: Users },
    { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
    davomatAnalyticsNav,
    davomatXatoliklarNav,
    davomatFaceNav,
    { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
    smenaNav,
    { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
    { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    { name: 'Hisobot', path: '/admin/holat', icon: BarChart3 },
    { name: "Bo'limlar", path: '/admin/departments', icon: Settings },
    { name: 'Kirish materiallari', path: '/admin/kirish-videolar', icon: Video },
    { name: 'Face ID', path: '/admin/faces', icon: ScanFace },
  ];

  const roleNavigation: Record<string, NavItem[]> = {
    admin: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      javobNav,
      javobHolatNav,
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      oylikNav,
      hisobNav,
      itNav,
      reviziyaNav,
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatAnalyticsNav,
    davomatXatoliklarNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: "Bog'lanish", path: '/boglanish', icon: Phone },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
      omborIshNav,
      { name: 'Foydalanuvchilar', path: '/admin/users', icon: Users },
      { name: 'Qurilmalar', path: '/admin/qurilmalar', icon: MonitorSmartphone },
      { name: "Ko‘chma davomat", path: '/admin/kochma-davomat', icon: MapPin },
      { name: "Ko‘chma xarita", path: '/admin/kochma-xarita', icon: Navigation },
      { name: "Jonli kuzatuv", path: '/admin/kochma-live', icon: Radio },
      { name: 'Face ID', path: '/admin/faces', icon: ScanFace },
      { name: 'Smena sozlamalari', path: '/admin/smena-sozlamalar', icon: AlarmClock },
      { name: 'Davomat QR', path: '/admin/davomat-qr', icon: ScanFace },
      { name: 'Test', path: '/admin/test', icon: Bell },
      { name: 'Hisobot', path: '/admin/holat', icon: BarChart3 },
      { name: "Bo'limlar", path: '/admin/departments', icon: Settings },
      { name: 'Kirish materiallari', path: '/admin/kirish-videolar', icon: Video },
    ],
    asoschi: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      javobNav,
      javobHolatNav,
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      oylikNav,
      hisobNav,
      itNav,
      reviziyaNav,
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatAnalyticsNav,
    davomatXatoliklarNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: "Bog'lanish", path: '/boglanish', icon: Phone },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
      omborIshNav,
      { name: 'Face ID', path: '/admin/faces', icon: ScanFace },
      { name: 'Smena sozlamalari', path: '/admin/smena-sozlamalar', icon: AlarmClock },
      { name: 'Davomat QR', path: '/admin/davomat-qr', icon: ScanFace },
      { name: 'Test', path: '/admin/test', icon: Bell },
      { name: 'Hisobot', path: '/admin/holat', icon: BarChart3 },
      { name: "Bo'limlar", path: '/admin/departments', icon: Settings },
      { name: 'Kirish materiallari', path: '/admin/kirish-videolar', icon: Video },
    ],
    recruiter: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatAnalyticsNav,
    davomatXatoliklarNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    director: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      javobHolatNav,
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      hisobNav,
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatAnalyticsNav,
    davomatXatoliklarNav,
      smenaNav,
      { name: 'Cheklist holati', path: '/checklist-holati', icon: ClipboardList },
      davomatFaceNav,
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: 'Hisobot', path: '/admin/holat', icon: BarChart3 },
      { name: "Bo'limlar", path: '/admin/departments', icon: Settings },
      { name: 'Kirish materiallari', path: '/admin/kirish-videolar', icon: Video },
      { name: 'Face ID', path: '/admin/faces', icon: ScanFace },
      { name: 'Smena sozlamalari', path: '/admin/smena-sozlamalar', icon: AlarmClock },
      { name: 'Davomat QR', path: '/admin/davomat-qr', icon: ScanFace },
      { name: 'Test', path: '/admin/test', icon: Bell },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    hr: hrMenejerNav,
    hr_menejer: hrMenejerNav,
    hr_direktor: hrOversightNav,
    hr_kadr_rahbar: hrOversightNav,
    hr_auditor: hrOversightNav,
    trainer: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
      smenaNav,
      { name: "Ish o'rinlari", path: '/vacancies', icon: Briefcase },
      { name: 'Nomzodlar', path: '/candidates', icon: Users },
      { name: 'Stajirovkalar', path: '/internships', icon: GraduationCap },
    ],
    mudir: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      javobNav,
      { name: 'Reviziya', path: '/reviziya', icon: ClipboardCheck },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      davomatQrNav,
      smenaNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: "Bog'lanish", path: '/boglanish', icon: Phone },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
    ],
    koordinator: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      javobNav,
      { name: 'Reviziya', path: '/reviziya', icon: ClipboardCheck },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      davomatQrNav,
      smenaNav,
      { name: 'Arizalar', path: '/requests', icon: FileText },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
      { name: "Bog'lanish", path: '/boglanish', icon: Phone },
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Cheklist', path: '/checklist', icon: ClipboardCheck },
      { name: 'Reyting', path: '/checklist-holati', icon: Trophy },
    ],
    it: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      itNav,
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    it_dasturchi: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      itNav,
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
    ],
    it_tarmoq: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      itNav,
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
    ],
    it_rahbar: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      itNav,
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    ombor: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      omborIshNav,
      davomatFaceNav,
    ],
    moliya_xodim: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
    taminot: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
    rivojlantirish: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
    mamuriy: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
    kassir: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
    yurist: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
    komunalniy: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
    direktor_yordamchisi: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
    gpp: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
    oshpaz: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
    marketing: [
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
    ombor_rahbar: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      omborIshNav,
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    moliya_rahbar: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Oylik', path: '/oylik', icon: Banknote },
      { name: 'Oylik hisob', path: '/hisobkitob', icon: Calculator },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    taminot_rahbar: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    rivojlantirish_rahbar: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    mamuriy_rahbar: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    gpp_rahbar: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    oshpaz_rahbar: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    marketing_rahbar: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
    ],
    sb: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
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
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
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
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      javobNav,
      { name: 'Oylik', path: '/oylik', icon: Banknote },
      reytingNav,
      { name: 'Ehtiyoj', path: '/ehtiyoj', icon: ClipboardList },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
      smenaNav,
    ],
    moliya: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Oylik', path: '/oylik', icon: Banknote },
      { name: 'Oylik hisob', path: '/hisobkitob', icon: Calculator },
      { name: 'Reviziya', path: '/reviziya', icon: ClipboardCheck },
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
      javobNav,
      reytingNav,
      davomatFaceNav,
      smenaNav,
    ],
    revizor: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Reviziya', path: '/reviziya', icon: ClipboardCheck },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    reviziya_rahbar: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Reviziya', path: '/reviziya', icon: ClipboardCheck },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      orgNav,
      davomatFaceNav,
      smenaNav,
      { name: 'Xodimlar', path: '/employees', icon: Users },
      { name: "Aptekalar tarmog'i", path: '/pharmacy-network', icon: Store },
    ],
    distrib_rahbar: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Distribyutsiya', path: '/distribyutsiya', icon: Truck },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      davomatAnalyticsNav,
    davomatXatoliklarNav,
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatFaceNav,
    ],
    distrib_hr: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Distribyutsiya', path: '/distribyutsiya', icon: Truck },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      { name: 'Xodimlar', path: '/employees', icon: Users },
      davomatAnalyticsNav,
    davomatXatoliklarNav,
      { name: 'Davomat hisobot', path: '/davomat', icon: ClipboardCheck },
      davomatFaceNav,
    ],
    distrib: [
      { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      { name: 'Topshiriqlar', path: '/vazifalar', icon: ListTodo },
      { name: 'Eslatmalarim', path: '/eslatmalar', icon: AlarmClock },
      davomatFaceNav,
    ],
  };

  const userRole = normalizeUserRole(user.role);
  const oversightNav = hasHrOversightNav(userRole);
  // Rolga mos menyu birinchi — Asoschi admin menyusini meros qilmasin (Foydalanuvchilar faqat admin)
  const resolvedBase = oversightNav
    ? hrOversightNav
    : roleNavigation[userRole] ??
      (hasFullPlatformAccess(userRole) ? roleNavigation.admin : null) ??
      (userRole === 'director' ? roleNavigation.director : null) ?? [
        { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
      ];
  const roleNav = injectCommonNav(resolvedBase, userRole);
  const withFace = isLimitedOfficeStaffRole(userRole)
    ? roleNav
    : roleNav.some((item) => item.path === '/davomat-face')
      ? roleNav
      : [...roleNav, davomatFaceNav];
  const navItems = (canSeeHrRecruitment(userRole)
    ? withFace
    : withFace.filter((item) => !isHrRecruitmentPath(item.path))
  )
    .filter((item) => item.path !== '/admin/users' || canManageUsers(userRole))
    .filter((item) => item.path !== '/distribyutsiya' || canViewDistribyutsiya(userRole))
    .filter((item) => item.path !== '/omborxona-ish' || canViewOmborxona(userRole))
    .filter((item) => item.path !== '/davomat/xatoliklar' || canViewDavomatXatoliklar(userRole))
    .filter((item) => item.path !== '/davomat-kochma')
    .concat(canViewLogistika(userRole) ? logistikaNavItems : []);

  const toggleNav = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      setDesktopCollapsed((v) => !v);
    } else {
      setMobileOpen((v) => !v);
    }
  };

  const defaultNavSections = groupNavItems(navItems, userRole, t);
  const navSections = applyNavLayout(defaultNavSections, navLayout, { keepEmpty: navEditMode });
  const pinnedSet = new Set(pinnedIds);
  const navIsCustom = !!navLayout;

  const ensureNavLayout = (): NavLayoutState => {
    if (navLayout) return navLayout;
    return layoutFromSections(defaultNavSections);
  };

  const commitNavLayout = (next: NavLayoutState) => {
    setNavLayout(next);
    if (user?.id != null) saveNavLayout(next, user.id);
  };

  const resetNavLayout = () => {
    setNavLayout(null);
    if (user?.id != null) clearNavLayout(user.id);
    toast({ title: t('nav.layout.resetDone') });
  };

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
    opts: {
      collapsed: boolean;
      onNavigate?: () => void;
      nested?: boolean;
      sectionId?: string;
      itemIndex?: number;
    },
  ) => {
    const count = badgeByPath[item.path] ?? 0;
    const active = pathIsActive(location, item.path);
    const pulse = item.path === '/pharmacy-network' && count > 0;
    const dropKey = `item:${opts.sectionId}:${opts.itemIndex}`;
    const isDropTarget = navEditMode && dragOverKey === dropKey;

    const body = (
      <>
        {navEditMode && !opts.collapsed ? (
          <span
            className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center text-slate-400 active:cursor-grabbing dark:text-white/40"
            aria-hidden
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <span
          className={cn(
            'relative flex shrink-0 items-center justify-center transition-colors',
            opts.nested &&
              cn(
                'h-7 w-7 rounded-md',
                active
                  ? 'bg-violet-500/25 text-violet-100'
                  : 'bg-slate-900/[0.04] text-slate-500 group-hover:bg-slate-900/[0.07] group-hover:text-slate-900 dark:bg-white/[0.06] dark:text-white/55 dark:group-hover:bg-white/10 dark:group-hover:text-white',
              ),
          )}
        >
          {item.icon ? (
            <item.icon
              className={cn(
                'transition-colors',
                opts.nested ? 'h-3.5 w-3.5' : 'h-4 w-4 min-w-[16px]',
                !opts.nested &&
                  (active ? 'text-slate-900 dark:text-white' : 'text-slate-500 group-hover:text-slate-800 dark:text-white/55 dark:group-hover:text-white/90'),
              )}
            />
          ) : (
            <ListTodo
              className={cn(
                'transition-colors',
                opts.nested ? 'h-3.5 w-3.5' : 'h-4 w-4 min-w-[16px]',
                !opts.nested &&
                  (active ? 'text-slate-900 dark:text-white' : 'text-slate-500 group-hover:text-slate-800 dark:text-white/55 dark:group-hover:text-white/90'),
              )}
            />
          )}
          {opts.collapsed && <NavBadge count={count} collapsed pulse={pulse} tone="soft" />}
        </span>
        {!opts.collapsed && (
          <>
            <span
              className={cn(
                'min-w-0 flex-1 text-[12px] font-medium leading-snug break-words',
                opts.nested && active && 'font-semibold text-slate-900 dark:text-white',
                opts.nested && !active && 'text-slate-600 group-hover:text-slate-900 dark:text-white/72 dark:group-hover:text-white',
              )}
            >
              {navLabelForPath(item.path, t, item.name)}
            </span>
            {opts.nested && active && !navEditMode ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300 shadow-[0_0_8px_rgba(196,181,253,0.9)]" aria-hidden />
            ) : (
              <NavBadge count={count} pulse={pulse} tone={opts.nested ? 'soft' : 'rose'} />
            )}
          </>
        )}
      </>
    );

    const className = cn(
      'group relative flex items-center gap-2.5 transition-all duration-200',
      opts.collapsed && 'justify-center px-0 py-2',
      opts.nested
        ? cn(
            'rounded-lg px-2 py-1.5',
            active
              ? 'app-sidebar-nested-item-active'
              : 'app-sidebar-nested-item',
          )
        : cn(
            !opts.collapsed && 'rounded-lg px-2.5 py-2',
            opts.collapsed && 'rounded-xl',
            active ? 'app-sidebar-nav-item-active' : 'app-sidebar-nav-item active:scale-[0.99]',
          ),
      navEditMode && 'cursor-grab active:cursor-grabbing ring-1 ring-transparent',
      isDropTarget && 'ring-violet-400/60 bg-violet-500/15',
    );

    if (navEditMode && opts.sectionId != null && opts.itemIndex != null) {
      return (
        <div
          key={item.path}
          draggable
          onDragStart={(e) => {
            navDragRef.current = {
              kind: 'item',
              path: item.path,
              fromSection: opts.sectionId!,
            };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.path);
            setDragOverKey(null);
          }}
          onDragEnd={() => {
            navDragRef.current = null;
            setDragOverKey(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDragOverKey(dropKey);
          }}
          onDragLeave={() => {
            setDragOverKey((prev) => (prev === dropKey ? null : prev));
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const drag = navDragRef.current;
            setDragOverKey(null);
            if (!drag || drag.kind !== 'item') return;
            const base = ensureNavLayout();
            commitNavLayout(
              moveNavItem(base, drag.path, opts.sectionId!, opts.itemIndex!),
            );
            navDragRef.current = null;
          }}
          className={className}
          role="listitem"
          title={t('nav.layout.dragHint')}
        >
          {body}
        </div>
      );
    }

    return (
      <Link key={item.path} href={item.path}>
        <div
          role="link"
          onClick={opts.onNavigate}
          className={cn(className, 'cursor-pointer')}
        >
          {body}
        </div>
      </Link>
    );
  };

  const renderNavLinks = (opts: { collapsed: boolean; onNavigate?: () => void; mobile?: boolean }) =>
    navSections.map((section, sectionIndex) => {
      const badgeSum = section.items.reduce((sum, item) => sum + (badgeByPath[item.path] ?? 0), 0);
      const hasActive = section.items.some((item) => pathIsActive(location, item.path));
      const pinned = pinnedSet.has(section.id);
      const open = opts.collapsed || pinned || navEditMode || openSectionId === section.id;
      const SectionIcon = section.icon;
      const sectionDropKey = `section:${section.id}`;
      const isSectionDrop = navEditMode && dragOverKey === sectionDropKey;

      if (opts.collapsed) {
        return (
          <div key={section.id} className="flex flex-col gap-0.5">
            {section.id !== navSections[0]?.id ? (
              <div className="mx-2.5 my-1.5 h-px rounded-full bg-slate-900/10 dark:bg-white/10" />
            ) : null}
            {section.items.map((item) => renderNavItem(item, opts))}
          </div>
        );
      }

      return (
        <div
          key={section.id}
          className={cn('mb-1', isSectionDrop && 'rounded-xl ring-1 ring-violet-400/40')}
          onDragOver={(e) => {
            if (!navEditMode) return;
            e.preventDefault();
            setDragOverKey(sectionDropKey);
          }}
          onDrop={(e) => {
            if (!navEditMode) return;
            e.preventDefault();
            const drag = navDragRef.current;
            setDragOverKey(null);
            if (!drag) return;
            const base = ensureNavLayout();
            if (drag.kind === 'item') {
              commitNavLayout(
                moveNavItem(base, drag.path, section.id, section.items.length),
              );
            } else if (drag.kind === 'section') {
              commitNavLayout(moveNavSection(base, drag.sectionId, sectionIndex));
            }
            navDragRef.current = null;
          }}
        >
          <div className="flex items-center gap-0.5">
            {navEditMode ? (
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  navDragRef.current = { kind: 'section', sectionId: section.id };
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', section.id);
                }}
                onDragEnd={() => {
                  navDragRef.current = null;
                  setDragOverKey(null);
                }}
                className="shrink-0 cursor-grab rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-900/5 hover:text-slate-700 active:cursor-grabbing dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
                title={t('nav.layout.moveSection')}
                aria-label={t('nav.layout.moveSection')}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
            ) : null}
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
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-900 dark:text-white">
                {section.label}
              </span>
              {badgeSum > 0 ? <NavBadge count={badgeSum} tone="section" /> : null}
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 dark:text-white/45',
                  open && 'rotate-180 text-slate-700 dark:text-white/80',
                )}
              />
            </button>
            {!navEditMode ? (
              <button
                type="button"
                onClick={() => togglePin(section.id)}
                title={pinned ? t('common.unpinPin') : t('common.pinKeep')}
                aria-label={pinned ? t('common.unpinPin') : t('common.pinKeep')}
                className={cn(
                  'shrink-0 rounded-lg p-1.5 transition-colors',
                  pinned
                    ? 'bg-violet-500/20 text-violet-700 dark:bg-violet-400/30 dark:text-violet-100'
                    : 'text-slate-500 hover:bg-slate-900/5 hover:text-slate-900 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white',
                )}
              >
                <Pin className={cn('h-3.5 w-3.5', pinned && 'fill-current')} />
              </button>
            ) : null}
          </div>
          <div
            className={cn(
              'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
              open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
            )}
          >
            <div className="overflow-hidden">
              <div className="app-sidebar-nested-panel mt-1 ml-0.5 mr-0.5 flex flex-col gap-0.5 p-1">
                {section.items.map((item, itemIndex) =>
                  renderNavItem(item, {
                    ...opts,
                    nested: true,
                    sectionId: section.id,
                    itemIndex,
                  }),
                )}
                {navEditMode && section.items.length === 0 ? (
                  <p className="px-2 py-3 text-center text-[11px] text-slate-400 dark:text-white/40">
                    {t('nav.layout.dropHere')}
                  </p>
                ) : null}
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
          <div
            className={cn(
              'mb-2 rounded-xl border border-indigo-200 bg-white p-1.5 shadow-sm dark:border-white/10 dark:bg-white/[0.06] dark:shadow-none',
              desktopCollapsed && 'md:hidden',
            )}
          >
            {navEditMode ? (
              <div className="space-y-1.5">
                <p className="px-1.5 pt-0.5 text-[10px] font-medium leading-snug text-indigo-800 dark:text-violet-100/85">
                  {t('nav.layout.editHint')}
                </p>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setNavEditMode(false);
                      setDragOverKey(null);
                      navDragRef.current = null;
                      toast({ title: t('nav.layout.saved') });
                    }}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-indigo-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-500 dark:bg-violet-500/90 dark:hover:bg-violet-500"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t('nav.layout.done')}
                  </button>
                  <button
                    type="button"
                    onClick={resetNavLayout}
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-2 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-200 dark:border-transparent dark:bg-white/10 dark:text-white/85 dark:hover:bg-white/15"
                    title={t('nav.layout.reset')}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t('nav.layout.resetShort')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDesktopCollapsed(false);
                  setNavEditMode(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold text-slate-800 transition hover:bg-indigo-50 hover:text-indigo-950 dark:font-medium dark:text-white/75 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-violet-200" />
                <span className="min-w-0 flex-1">{t('nav.layout.customize')}</span>
                {navIsCustom ? (
                  <span className="rounded-md bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-800 dark:bg-violet-400/25 dark:font-semibold dark:text-violet-100">
                    {t('nav.layout.customBadge')}
                  </span>
                ) : null}
              </button>
            )}
          </div>
          <div className="flex flex-col gap-1 md:hidden">
            {renderNavLinks({
              collapsed: false,
              mobile: true,
              onNavigate: () => {
                if (navEditMode) return;
                setMobileOpen(false);
              },
            })}
          </div>
          <div className="hidden md:flex md:flex-col md:gap-0.5">
            {renderNavLinks({ collapsed: desktopCollapsed && !navEditMode })}
          </div>
        </nav>

        <div
          className={cn(
            'shrink-0 space-y-1.5 px-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
            desktopCollapsed && 'md:space-y-2 md:px-1.5',
          )}
        >
          {/* Collapsed rail: vertical stack — no overflow */}
          {desktopCollapsed ? (
            <div className="hidden md:flex md:flex-col md:items-center md:gap-1">
              <button
                type="button"
                onClick={openProfileEditor}
                className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full ring-2 ring-white/20 transition hover:ring-white/40"
                title={t('common.profileEdit')}
              >
                {facePhotoUrl ? (
                  <img src={facePhotoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-500 to-sky-400 text-sm font-bold text-white">
                    {(user.fullName || 'U').slice(0, 1).toUpperCase()}
                  </span>
                )}
              </button>
              <ThemeToggle
                variant="sidebar"
                className="h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-900/5 hover:text-slate-900 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:h-3.5 [&_svg]:w-3.5"
              />
              <button
                type="button"
                onClick={handleLogout}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-900/5 hover:text-slate-900 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
                title={t('common.logout')}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={toggleNav}
                className="mt-0.5 flex h-8 w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white/65 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label={t('common.expandMenu')}
              >
                <ChevronLeft className="h-3.5 w-3.5 rotate-180" />
              </button>
            </div>
          ) : null}

          {/* Expanded / mobile profile card */}
          <div
            className={cn(
              'app-sidebar-profile-card flex items-center gap-1.5',
              desktopCollapsed && 'md:hidden',
            )}
          >
            <button
              type="button"
              onClick={openProfileEditor}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left transition-colors hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.06]"
              title={t('common.profileEdit')}
            >
              <div className="app-sidebar-profile-avatar ring-1 ring-white/15">
                {facePhotoUrl ? (
                  <img src={facePhotoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  (user.fullName || 'U').slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="app-sidebar-profile-name">{profileDisplayName(user.fullName)}</span>
                <span className="mt-px flex min-w-0 items-center gap-1.5">
                  {userRoleLabel(user.role) ? (
                    <span className="truncate text-[10px] font-medium text-slate-600 dark:text-white/50">{userRoleLabel(user.role)}</span>
                  ) : null}
                  <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                    {t('common.online')}
                  </span>
                </span>
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              <ThemeToggle
                variant="sidebar"
                className="app-sidebar-profile-action h-7 w-7 rounded-md [&_svg]:h-3.5 [&_svg]:w-3.5"
              />
              <button
                type="button"
                onClick={handleLogout}
                className="app-sidebar-profile-action h-7 w-7"
                title={t('common.logout')}
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {!davomatDashHome ? (
            <div className={cn(desktopCollapsed && 'md:hidden')}>
              <FaceIdEnroll compact onStatusChange={onFaceStatusChange} />
            </div>
          ) : null}

          <button
            type="button"
            onClick={toggleNav}
            className={cn(
              'app-sidebar-collapse-btn flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors',
              desktopCollapsed && 'md:hidden',
            )}
            aria-label={t('common.collapseMenu')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>{t('common.collapseMenu')}</span>
          </button>
        </div>
      </aside>

      {HELP_ASSISTANT_ENABLED ? (
        <HelpAssistantDialog open={helpOpen} onOpenChange={setHelpOpen} />
      ) : null}

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
            {HELP_ASSISTANT_ENABLED ? (
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
            ) : null}
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
        <BoglanishMissingBanner />

        <main
          className={cn(
            'min-h-0 min-w-0 flex-1',
            'pb-[calc(4.85rem+env(safe-area-inset-bottom))] md:pb-0',
            location === '/vazifalar' ||
              location.startsWith('/vazifalar/tahlil') ||
              location.startsWith('/chat') ||
              location.startsWith('/kirish') ||
              location.startsWith('/tashkiliy-tuzilma') ||
              location.startsWith('/logistika')
              ? 'overflow-hidden p-0'
              : location === '/hisobkitob'
                ? 'overflow-x-hidden overflow-y-auto p-1 sm:p-2'
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
                location.startsWith('/davomat/xatoliklar') ||
                (location === '/dashboard' && davomatDashHome) ||
                location === '/oylik' ||
                location === '/hisobkitob' ||
                location.startsWith('/employees') ||
                location.startsWith('/eslatmalar') ||
                location.startsWith('/chat') ||
                location.startsWith('/kirish') ||
                location.startsWith('/tashkiliy-tuzilma') ||
                location.startsWith('/reviziya') ||
                location.startsWith('/logistika') ||
                location.startsWith('/admin/kochma-live') ||
                location.startsWith('/admin/kochma-xarita')
                ? 'h-full max-w-none'
                : location === '/pharmacy-network'
                  ? 'max-w-none'
                  : 'max-w-7xl',
            )}
          >
            {children}
            <MobileGpsBackgroundTracker />
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
