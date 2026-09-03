import React, { useMemo, useState } from 'react';
import {
  useGetNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getGetNotificationsQueryKey,
  type Notification,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { uz, ru } from 'date-fns/locale';
import {
  Bell,
  CheckCheck,
  FileText,
  Calendar,
  AlertTriangle,
  UserRound,
  Briefcase,
  ChevronRight,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { useToast } from '../../hooks/use-toast';
import { cn } from '../../lib/utils';
import { useI18n } from '../../i18n/I18nProvider';

const TYPE_ICONS: Record<string, { icon: typeof Bell; color: string; soft: string; key: string }> = {
  new_request: {
    icon: FileText,
    color: 'text-sky-700',
    soft: 'bg-sky-100',
    key: 'notif.type.new_request',
  },
  interview_reminder: {
    icon: Calendar,
    color: 'text-violet-700',
    soft: 'bg-violet-100',
    key: 'notif.type.interview_reminder',
  },
  expired_task: {
    icon: AlertTriangle,
    color: 'text-amber-800',
    soft: 'bg-amber-100',
    key: 'notif.type.expired_task',
  },
  stage_change: {
    icon: UserRound,
    color: 'text-indigo-700',
    soft: 'bg-indigo-100',
    key: 'notif.type.stage_change',
  },
  offer_accepted: {
    icon: Briefcase,
    color: 'text-teal-700',
    soft: 'bg-teal-100',
    key: 'notif.type.offer_accepted',
  },
  hired: {
    icon: Briefcase,
    color: 'text-emerald-700',
    soft: 'bg-emerald-100',
    key: 'notif.type.hired',
  },
};

export default function NotificationsPage() {
  const { t, locale } = useI18n();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const dateLocale = locale === 'ru' ? ru : uz;

  const typeMeta = (type: string) => {
    const meta = TYPE_ICONS[type];
    if (!meta) {
      return {
        label: t('notif.type.default'),
        icon: Bell,
        color: 'text-foreground',
        soft: 'bg-slate-100',
      };
    }
    return {
      label: t(meta.key),
      icon: meta.icon,
      color: meta.color,
      soft: meta.soft,
    };
  };

  const formatWhen = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    if (isToday(d)) {
      return formatDistanceToNow(d, { addSuffix: true, locale: dateLocale });
    }
    if (isYesterday(d)) {
      return `${t('notif.yesterday')}, ${format(d, 'HH:mm')}`;
    }
    return format(d, 'dd.MM.yyyy HH:mm');
  };

  const { data, isLoading } = useGetNotifications(
    filter === 'unread' ? { unreadOnly: true } : undefined,
    { query: { refetchInterval: 30_000 } } as any,
  );

  const markOne = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = data ?? [];
  const unreadCount = useMemo(
    () => (filter === 'unread' ? items.length : items.filter((n) => !n.isRead).length),
    [items, filter],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey({ unreadOnly: true }) });
  };

  const openNotification = (n: Notification) => {
    const go = () => {
      if (n.linkUrl) setLocation(n.linkUrl);
    };
    if (!n.isRead) {
      markOne.mutate(
        { id: n.id },
        {
          onSuccess: () => {
            invalidate();
            go();
          },
          onError: () => go(),
        },
      );
    } else {
      go();
    }
  };

  const onMarkAll = () => {
    markAll.mutate(undefined, {
      onSuccess: () => {
        invalidate();
        toast({ title: t('notif.markedAll') });
      },
      onError: () => {
        toast({ title: t('ui.error'), variant: 'destructive' });
      },
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('notif.title')}</h1>
          <p className="mt-1 text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} ${t('notif.unreadCount')}` : t('notif.allItems')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border bg-card p-1">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                filter === 'all' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t('notif.filter.all')}
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                filter === 'unread' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {t('notif.filter.unread')}
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onMarkAll}
            disabled={markAll.isPending || unreadCount === 0}
          >
            <CheckCheck className="h-4 w-4" />
            {t('notif.markAll')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
                <Bell className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="font-medium text-foreground">{t('notif.empty')}</p>
              <p className="text-sm text-muted-foreground">
                {filter === 'unread' ? t('notif.emptyUnread') : t('notif.emptyAll')}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const meta = typeMeta(n.type);
                const Icon = meta.icon;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors',
                        'hover:bg-muted',
                        !n.isRead && 'bg-sky-50/50',
                      )}
                    >
                      <div
                        className={cn(
                          'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                          meta.soft,
                          meta.color,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                            {meta.label}
                          </Badge>
                          {!n.isRead && (
                            <span className="h-2 w-2 rounded-full bg-sky-500" title={t('notif.filter.unread')} />
                          )}
                          <span className="text-[11px] text-muted-foreground">{formatWhen(n.createdAt)}</span>
                        </div>
                        <p
                          className={cn(
                            'mt-1 text-sm leading-snug text-foreground',
                            !n.isRead && 'font-medium',
                          )}
                        >
                          {n.text}
                        </p>
                        {n.linkUrl && (
                          <p className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-sky-700">
                            {t('notif.open')} <ChevronRight className="h-3.5 w-3.5" />
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        {t('notif.footer')}
      </p>
    </div>
  );
}
