import React from 'react';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { useI18n, navLabelForPath } from '@/i18n/I18nProvider';

export type MobileNavItem = {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
};

function ensureVazifalar(paths: string[], byPath: Map<string, MobileNavItem>): string[] {
  if (!byPath.has('/vazifalar') || paths.includes('/vazifalar')) return paths;
  const anchor = paths.findIndex((p) => p === '/dashboard' || p === '/kirish');
  const at = anchor >= 0 ? anchor + 1 : 0;
  return [...paths.slice(0, at), '/vazifalar', ...paths.slice(at)];
}

const ROLE_MOBILE_PATHS: Record<string, string[]> = {
  admin: ['/dashboard', '/vazifalar', '/employees', '/davomat', '/davomat-face', '/chat'],
  director: ['/dashboard', '/vazifalar', '/employees', '/davomat/analytics', '/davomat', '/chat'],
  hr: ['/dashboard', '/vazifalar', '/employees', '/davomat', '/davomat-face', '/chat'],
  hr_menejer: ['/dashboard', '/vazifalar', '/employees', '/davomat', '/davomat-face', '/chat'],
  hr_direktor: ['/dashboard', '/vazifalar', '/employees', '/davomat/analytics', '/davomat-face', '/chat'],
  hr_kadr_rahbar: ['/dashboard', '/vazifalar', '/employees', '/davomat/analytics', '/davomat-face', '/chat'],
  hr_auditor: ['/dashboard', '/vazifalar', '/employees', '/davomat/analytics', '/davomat-face', '/chat'],
  recruiter: ['/dashboard', '/vazifalar', '/davomat-face', '/candidates', '/vacancies', '/chat'],
  trainer: ['/dashboard', '/vazifalar', '/davomat-face', '/candidates', '/internships', '/chat'],
  mentor: ['/dashboard', '/vazifalar', '/davomat-face', '/employees', '/chat'],
  department_head: ['/dashboard', '/vazifalar', '/davomat-face', '/employees', '/pharmacy-network', '/chat'],
  mudir: ['/dashboard', '/vazifalar', '/davomat-face', '/employees', '/pharmacy-network'],
  koordinator: ['/dashboard', '/vazifalar', '/davomat-face', '/employees', '/pharmacy-network', '/checklist'],
  farmasevt: ['/dashboard', '/vazifalar', '/davomat-face', '/ehtiyoj', '/chat'],
  stajyor: ['/kirish', '/vazifalar', '/davomat-face', '/checklist-holati', '/dashboard'],
  moliya: ['/dashboard', '/vazifalar', '/oylik', '/employees', '/davomat', '/chat'],
  sb: ['/dashboard', '/vazifalar', '/davomat-face', '/employees', '/davomat', '/chat'],
  sb_boshliq: ['/dashboard', '/vazifalar', '/davomat-face', '/employees', '/davomat', '/chat'],
  texnik: ['/dashboard', '/vazifalar', '/texnik', '/davomat-face', '/pharmacy-network'],
  texnik_rahbar: ['/dashboard', '/vazifalar', '/texnik', '/employees', '/davomat-face', '/chat'],
  it: ['/dashboard', '/vazifalar', '/it', '/davomat-face', '/pharmacy-network', '/chat'],
  it_rahbar: ['/dashboard', '/vazifalar', '/it', '/employees', '/davomat-face', '/chat'],
  ombor: ['/dashboard', '/vazifalar', '/davomat-face', '/employees', '/ehtiyoj', '/chat'],
  revizor: ['/dashboard', '/vazifalar', '/reviziya', '/davomat-face', '/pharmacy-network'],
  reviziya_rahbar: ['/dashboard', '/vazifalar', '/reviziya', '/employees', '/davomat-face', '/chat'],
};

/** Path → short mobile label key (mobile.*) */
const MOBILE_SHORT_KEYS: Record<string, string> = {
  '/dashboard': 'mobile.main',
  '/davomat': 'mobile.report',
  '/davomat/analytics': 'mobile.analytics',
  '/pharmacy-network': 'mobile.network',
  '/vazifalar': 'mobile.task',
  '/eslatmalar': 'mobile.reminder',
  '/checklist-holati': 'mobile.checklist',
  '/checklist': 'mobile.checklist',
  '/hisobkitob': 'mobile.payroll',
  '/oylik': 'mobile.payroll',
  '/admin/users': 'mobile.users',
  '/admin/departments': 'mobile.dept',
  '/vacancies': 'mobile.vacancy',
  '/candidates': 'mobile.candidate',
  '/interviews': 'mobile.interview',
  '/internships': 'mobile.intern',
  '/kirish': 'mobile.kirish',
  '/reyting': 'mobile.rating',
  '/smena-filial': 'mobile.shift',
  '/employees': 'mobile.employees',
  '/chat': 'mobile.chat',
  '/davomat-face': 'mobile.face',
  '/tashkiliy-tuzilma': 'mobile.org',
};

function pathIsActive(location: string, path: string) {
  return location === path || location.startsWith(`${path}/`);
}

function pickMobileItems(role: string, navItems: MobileNavItem[]): MobileNavItem[] {
  const byPath = new Map(navItems.map((item) => [item.path, item]));
  const base =
    ROLE_MOBILE_PATHS[role] ?? [
      '/dashboard',
      '/vazifalar',
      '/davomat-face',
      '/employees',
      '/davomat',
      '/chat',
    ];
  const preferred = ensureVazifalar(base, byPath);
  const maxItems = 6;

  const picked: MobileNavItem[] = [];
  for (const path of preferred) {
    const item = byPath.get(path);
    if (item) picked.push(item);
    if (picked.length >= maxItems) break;
  }

  if (picked.length < 4) {
    for (const item of navItems) {
      if (picked.some((p) => p.path === item.path)) continue;
      picked.push(item);
      if (picked.length >= maxItems) break;
    }
  }

  return picked;
}

function labelFor(
  item: MobileNavItem,
  t: (key: string, fallback?: string) => string,
): string {
  const shortKey = MOBILE_SHORT_KEYS[item.path];
  if (shortKey) return t(shortKey);
  return navLabelForPath(item.path, t, item.name);
}

type Props = {
  role: string;
  location: string;
  navItems: MobileNavItem[];
  hidden?: boolean;
};

export function MobileBottomNav({ role, location, navItems, hidden }: Props) {
  const { t } = useI18n();
  const items = React.useMemo(() => pickMobileItems(role, navItems), [role, navItems]);
  if (!items.length) return null;

  return (
    <nav
      aria-label={t('mobile.nav')}
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-30 px-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] md:hidden',
        'transition-all duration-300 ease-out',
        hidden ? 'translate-y-[110%] opacity-0' : 'translate-y-0 opacity-100',
      )}
    >
      <div
        className={cn(
          'pointer-events-auto mx-auto flex max-w-md items-stretch justify-between gap-0.5',
          'rounded-[1.65rem] border px-1.5 py-1.5 backdrop-blur-xl',
          'border-border bg-card/95 shadow-lg',
          'dark:border-white/20 dark:bg-[#0b1728]/90 dark:shadow-[0_14px_44px_-12px_rgba(0,0,0,0.55)]',
        )}
      >
        {items.map((item) => {
          const active = pathIsActive(location, item.path);
          const Icon = item.icon;
          return (
            <Link key={item.path} href={item.path}>
              <div
                className={cn(
                  'flex min-w-[3.1rem] flex-col items-center justify-center gap-0.5 rounded-2xl px-1.5 py-1.5 transition-all',
                  active
                    ? 'bg-primary/10 ring-1 ring-primary/40 dark:bg-white/10 dark:ring-white/75'
                    : 'text-muted-foreground active:scale-95 dark:text-white/70',
                )}
              >
                <Icon
                  className={cn(
                    'h-[1.15rem] w-[1.15rem] shrink-0',
                    active ? 'text-primary dark:text-foreground dark:text-white' : 'text-muted-foreground dark:text-white/80',
                  )}
                />
                <span
                  className={cn(
                    'max-w-[3.25rem] truncate text-center text-[8.5px] font-bold uppercase leading-tight tracking-wide',
                    active ? 'text-primary dark:text-foreground dark:text-white' : 'text-muted-foreground dark:text-white/75',
                  )}
                >
                  {labelFor(item, t)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
