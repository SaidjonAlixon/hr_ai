import React, { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { type Employee } from '@workspace/api-client-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../hooks/use-toast';
import { isHrManager } from '../../lib/roles';
import { displayBranchName } from '../../lib/pharmacy-staff-api';
import { useI18n } from '../../i18n/I18nProvider';
import { fetchStaff, staffQueryKey } from '../../lib/staff-api';
import {
  NEED_ASSIGNEE_GROUPS,
  needAssigneeGroup,
  type NeedAssigneeGroup,
  needLabel,
  roleLabel,
  useBranchNeedAssignees,
  useBranchNeeds,
  useBranchNeedsHistory,
  useCloseBranchNeed,
  useConfirmBranchNeed,
  useCreateBranchNeed,
  useVerifyBranchNeed,
  useMyNeedBranch,
  type BranchNeed,
  type MyNeedBranch,
} from '../../lib/branch-needs-api';
import { useAuditBranches } from '../../lib/branch-audits-api';
import { NewNeedDialog, type NewNeedPayload } from './new-need-dialog';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  Hourglass,
  Inbox,
  Loader2,
  Plus,
  Search,
  Store,
  User,
  Wrench,
  X,
} from 'lucide-react';

const TZ = 'Asia/Tashkent';

type Tab = 'active' | 'pending' | 'progress' | 'done' | 'history';

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  pending: { label: 'Tasdiq kutilmoqda', cls: 'bg-amber-50 text-amber-800 ring-amber-200', dot: 'bg-amber-500' },
  assigned: { label: 'Ijrochiga yuborildi', cls: 'bg-sky-50 text-sky-800 ring-sky-200', dot: 'bg-sky-500' },
  in_progress: { label: 'Bajarilmoqda', cls: 'bg-indigo-50 text-indigo-800 ring-indigo-200', dot: 'bg-indigo-500' },
  done: { label: 'Yakuniy tasdiq kerak', cls: 'bg-orange-50 text-orange-800 ring-orange-200', dot: 'bg-orange-500' },
  verified: { label: 'Yakunlangan', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', dot: 'bg-emerald-500' },
  closed: { label: 'Yopilgan', cls: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400' },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400' };
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset', s.cls)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

function shortDt(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

function fullDt(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

function ago(iso?: string | null): string {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(min) || min < 0) return '';
  if (min < 1) return 'hozirgina';
  if (min < 60) return `${min} daqiqa oldin`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} soat oldin`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} kun oldin`;
  return fullDt(iso);
}

function stepsOf(n: BranchNeed) {
  return [
    { key: 'sent', label: 'Yuborildi', at: n.createdAt, who: n.createdByName ? `${n.createdByName}${n.createdByRole ? ` · ${roleLabel(n.createdByRole)}` : ''}` : null },
    { key: 'confirmed', label: 'Tasdiqlandi', at: n.confirmedAt || n.assignedAt, who: n.confirmedByName },
    { key: 'accepted', label: 'Qabul qilindi', at: n.acceptedAt, who: n.assignedUserName },
    { key: 'completed', label: 'Bajarildi', at: n.completedAt, who: n.assignedUserName },
    { key: 'verified', label: 'Yakunlandi', at: n.verifiedAt, who: n.verifiedByName },
  ];
}

function Stepper({ n }: { n: BranchNeed }) {
  const steps = stepsOf(n);
  const closed = n.status === 'closed';
  const current = closed ? -1 : steps.findIndex((s) => !s.at);
  return (
    <ol className="flex w-full items-start">
      {steps.map((s, i) => {
        const done = Boolean(s.at);
        const isCurrent = i === current;
        return (
          <li key={s.key} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
            {i > 0 && (
              <span
                className={cn('absolute left-[-50%] right-1/2 top-[9px] h-0.5', done ? 'bg-emerald-400' : 'bg-slate-200')}
              />
            )}
            <span
              className={cn(
                'relative z-[1] flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-white',
                done && 'bg-emerald-500 text-white',
                isCurrent && 'bg-white ring-[3px] ring-sky-400',
                !done && !isCurrent && 'bg-slate-200',
              )}
            >
              {done ? <Check className="h-3 w-3" strokeWidth={3} /> : isCurrent ? <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" /> : null}
            </span>
            <span className={cn('mt-1.5 text-[11px] font-semibold leading-tight', done ? 'text-slate-800' : isCurrent ? 'text-sky-700' : 'text-slate-400')}>
              {s.label}
            </span>
            <span className="mt-0.5 text-[10px] tabular-nums text-slate-400">{done ? shortDt(s.at) : isCurrent ? 'kutilmoqda' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DetailTimeline({ n }: { n: BranchNeed }) {
  const steps = stepsOf(n);
  return (
    <dl className="grid gap-x-4 gap-y-1.5 rounded-lg bg-slate-50 px-3 py-2.5 text-xs sm:grid-cols-[150px_1fr]">
      {steps.map((s) => (
        <React.Fragment key={s.key}>
          <dt className={cn('font-medium', s.at ? 'text-slate-700' : 'text-slate-400')}>{s.label}</dt>
          <dd className={s.at ? 'text-slate-700' : 'text-slate-400'}>
            {s.at ? fullDt(s.at) : '—'}
            {s.at && s.who ? <span className="text-slate-500"> · {s.who}</span> : null}
          </dd>
        </React.Fragment>
      ))}
      {n.closedAt ? (
        <>
          <dt className="font-medium text-slate-700">Yopildi</dt>
          <dd className="text-slate-700">{fullDt(n.closedAt)}</dd>
        </>
      ) : null}
    </dl>
  );
}

export default function EhtiyojPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();

  const canWrite = user?.role === 'mudir' || user?.role === 'koordinator' || isHrManager(user?.role);
  const canConfirm = user?.role === 'koordinator' || isHrManager(user?.role);
  const canVerify = user?.role === 'mudir' || user?.role === 'koordinator' || isHrManager(user?.role);
  const isMudir = user?.role === 'mudir';
  const isKoordinator = user?.role === 'koordinator';
  const rawRole = String(user?.role ?? '');
  const isAssigneeOnly = rawRole === 'texnik' || rawRole === 'ombor';
  const isBranchStaff = BRANCH_STAFF_ROLES.has(rawRole);
  const { data: myBranch, isLoading: myBranchLoading } = useMyNeedBranch(isBranchStaff);

  const { data: needs, isLoading, refetch } = useBranchNeeds();
  const { data: history, isLoading: historyLoading, refetch: refetchHistory } = useBranchNeedsHistory();
  const { data: employees, isLoading: employeesLoading } = useQuery({
    queryKey: staffQueryKey('active', '', 'all', 'dorixona'),
    queryFn: () => fetchStaff('active', { workplace: 'dorixona' }),
    enabled: canWrite && !isMudir && !isKoordinator,
    staleTime: 30_000,
  });
  const { data: auditBranches = [], isLoading: branchesLoading } = useAuditBranches();
  const {
    data: assignees,
    isLoading: assigneesLoading,
    isError: assigneesError,
    refetch: refetchAssignees,
  } = useBranchNeedAssignees(canConfirm);
  const { mutate: createNeed, isPending: creating } = useCreateBranchNeed();
  const { mutate: confirmNeed, isPending: confirming } = useConfirmBranchNeed();
  const { mutate: verifyNeed, isPending: verifying } = useVerifyBranchNeed();
  const { mutate: closeNeed, isPending: closing } = useCloseBranchNeed();

  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<BranchNeed | null>(null);
  const [confirmAssigneeId, setConfirmAssigneeId] = useState<string>('none');
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | NeedAssigneeGroup>('all');
  const [closeTarget, setCloseTarget] = useState<BranchNeed | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);

  const managers = useMemo(() => {
    if (isKoordinator) {
      return auditBranches.map((b) => ({ id: b.id, fullName: b.managerName, location: b.branchLocation }));
    }
    return (employees ?? [])
      .filter((e: Employee) => e.orgRole === 'manager')
      .sort((a: Employee, b: Employee) => (a.location ?? '').localeCompare(b.location ?? '', 'uz'));
  }, [auditBranches, employees, isKoordinator]);
  const managersLoading = isKoordinator ? branchesLoading : employeesLoading;

  const filteredAssignees = useMemo(() => {
    const list = assignees ?? [];
    if (assigneeFilter === 'all') return list;
    return list.filter((a) => needAssigneeGroup(a.role) === assigneeFilter);
  }, [assignees, assigneeFilter]);

  const active = needs ?? [];
  const counts = useMemo(
    () => ({
      active: active.length,
      pending: active.filter((n) => n.status === 'pending').length,
      progress: active.filter((n) => n.status === 'assigned' || n.status === 'in_progress').length,
      done: active.filter((n) => n.status === 'done').length,
      history: (history ?? []).length,
    }),
    [active, history],
  );

  const list = useMemo(() => {
    let base: BranchNeed[];
    if (tab === 'history') base = history ?? [];
    else if (tab === 'pending') base = active.filter((n) => n.status === 'pending');
    else if (tab === 'progress') base = active.filter((n) => n.status === 'assigned' || n.status === 'in_progress');
    else if (tab === 'done') base = active.filter((n) => n.status === 'done');
    else base = active;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((n) =>
      [needLabel(n.needType), displayBranchName(n.branchLocation), n.managerName, n.note, n.createdByName, n.assignedUserName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [tab, active, history, search]);

  const listLoading = tab === 'history' ? historyLoading : isLoading;

  const refreshAll = () => {
    refetch();
    refetchHistory();
  };

  const submit = (payload: NewNeedPayload, done: () => void) => {
    createNeed(
      { ...payload, assigneeUserId: canConfirm ? payload.assigneeUserId : undefined },
      {
        onSuccess: (created) => {
          toast({
            title: created.status === 'assigned' ? 'Ehtiyoj belgilandi' : 'Ehtiyoj yuborildi',
            description:
              created.status === 'assigned'
                ? 'Ijrochiga vazifa ochildi — Topshiriqlar bo‘limida'
                : 'Tasdiq kutilmoqda — ijrochi tanlangach vazifa ochiladi',
          });
          done();
          setFormOpen(false);
          setTab('active');
          refreshAll();
        },
        onError: (err: Error) => {
          toast({ title: 'Xatolik', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  const handleConfirm = () => {
    if (!confirmTarget || confirmAssigneeId === 'none') {
      toast({ title: 'Ijrochini tanlang', variant: 'destructive' });
      return;
    }
    confirmNeed(
      { id: confirmTarget.id, assigneeUserId: Number(confirmAssigneeId) },
      {
        onSuccess: (result) => {
          toast({ title: 'Tasdiqlandi', description: `Topshiriq #${result.taskId} yuborildi` });
          setConfirmTarget(null);
          setConfirmAssigneeId('none');
          refreshAll();
        },
        onError: (err: Error) => {
          toast({ title: 'Xatolik', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  const handleVerify = (id: number) => {
    setVerifyingId(id);
    verifyNeed(id, {
      onSuccess: () => {
        toast({ title: 'Yakuniy tasdiqlandi', description: 'Ehtiyoj yakunlandi va tarixga o‘tdi' });
        refreshAll();
      },
      onError: (err: Error) => {
        toast({ title: 'Xatolik', description: err.message, variant: 'destructive' });
      },
      onSettled: () => setVerifyingId(null),
    });
  };

  const handleClose = () => {
    if (!closeTarget) return;
    closeNeed(closeTarget.id, {
      onSuccess: () => {
        toast({ title: 'Yopildi', description: 'Ehtiyoj tarixga o‘tdi' });
        setCloseTarget(null);
        refreshAll();
      },
      onError: (err: Error) => {
        toast({ title: 'Xatolik', description: err.message, variant: 'destructive' });
      },
    });
  };

  const subtitle = isAssigneeOnly
    ? 'Sizga biriktirilgan ehtiyojlar. Qabul qilish va bajarish — Topshiriqlar bo‘limida.'
    : isMudir
      ? 'Filialingizga kerakli narsani yuboring. Koordinator tasdiqlaydi, ijrochi bajaradi, siz yakuniy tasdiqlaysiz.'
      : isBranchStaff
        ? 'Filialingiz ehtiyojlari va ularning holati. Yangi ehtiyojni filial mudiri yuboradi.'
        : isKoordinator
        ? 'Filial va ijrochini tanlab ehtiyoj belgilang yoki mudirlardan kelganlarini tasdiqlang.'
        : 'Filiallar ehtiyojlari: yuborilgandan yakuniy tasdiqgacha. Yozuvlar o‘chirilmaydi.';

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'active', label: 'Faol', count: counts.active },
    { key: 'pending', label: 'Tasdiq kutmoqda', count: counts.pending },
    { key: 'progress', label: 'Jarayonda', count: counts.progress },
    { key: 'done', label: 'Yakuniy tasdiq', count: counts.done },
    { key: 'history', label: 'Tarix', count: counts.history },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-[#0f2744] sm:text-[28px]">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0b3a5c]/10">
              <ClipboardList className="h-5 w-5 text-[#0b3a5c]" />
            </span>
            {t('ehtiyoj.title')}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-slate-500">{subtitle}</p>
        </div>
        {canWrite && (
          <Button onClick={() => setFormOpen(true)} className="h-10 gap-2 bg-[#0b3a5c] px-4 hover:bg-[#0b3a5c]/90">
            <Plus className="h-4 w-4" />
            {isKoordinator ? t('ehtiyoj.set') : t('ehtiyoj.new')}
          </Button>
        )}
      </div>

      {isBranchStaff ? <MyBranchCard branch={myBranch ?? null} loading={myBranchLoading} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Hourglass}
          label="Tasdiq kutmoqda"
          value={counts.pending}
          tone="amber"
          active={tab === 'pending'}
          onClick={() => setTab('pending')}
          hint={canConfirm && counts.pending ? 'Sizning tasdig‘ingiz kerak' : undefined}
        />
        <StatCard icon={Wrench} label="Jarayonda" value={counts.progress} tone="sky" active={tab === 'progress'} onClick={() => setTab('progress')} />
        <StatCard
          icon={Clock}
          label="Yakuniy tasdiq kerak"
          value={counts.done}
          tone="orange"
          active={tab === 'done'}
          onClick={() => setTab('done')}
          hint={canVerify && counts.done ? 'Bajarilgan — tekshirib tasdiqlang' : undefined}
        />
        <StatCard icon={CheckCircle2} label="Yakunlangan" value={counts.history} tone="emerald" active={tab === 'history'} onClick={() => setTab('history')} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {tabs.map((x) => (
              <button
                key={x.key}
                type="button"
                onClick={() => setTab(x.key)}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors',
                  tab === x.key ? 'bg-[#0b3a5c] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {x.label}
                <span
                  className={cn(
                    'min-w-[20px] rounded-full px-1.5 text-[11px] tabular-nums',
                    tab === x.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {x.count}
                </span>
              </button>
            ))}
          </div>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filial, ehtiyoj, odam…" className="h-9 pl-9" />
          </div>
        </div>

        <div className="p-3">
          {listLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl" />
            </div>
          ) : !list.length ? (
            <EmptyState tab={tab} searching={Boolean(search.trim())} canWrite={canWrite} onCreate={() => setFormOpen(true)} />
          ) : (
            <div className="space-y-3">
              {list.map((n) => (
                <NeedCard
                  key={n.id}
                  n={n}
                  showConfirm={canConfirm && n.status === 'pending'}
                  showVerify={canVerify && n.status === 'done'}
                  showClose={
                    (canWrite && n.status === 'pending' && (isMudir || canConfirm)) ||
                    (canConfirm && (n.status === 'assigned' || n.status === 'in_progress' || n.status === 'done'))
                  }
                  closeLabel={n.status === 'pending' ? 'Yopish' : 'Bekor qilish'}
                  verifying={verifying && verifyingId === n.id}
                  onConfirm={() => {
                    setConfirmTarget(n);
                    setConfirmAssigneeId('none');
                    setAssigneeFilter('all');
                  }}
                  onVerify={() => handleVerify(n.id)}
                  onClose={() => setCloseTarget(n)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <NewNeedDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        isMudir={isMudir}
        isKoordinator={isKoordinator}
        canConfirm={canConfirm}
        managers={managers}
        managersLoading={managersLoading}
        assignees={assignees ?? []}
        assigneesLoading={assigneesLoading}
        assigneesError={assigneesError}
        onRetryAssignees={() => void refetchAssignees()}
        creating={creating}
        onSubmit={submit}
        myBranchName={myBranch?.branchName ?? null}
      />

      {/* Tasdiqlash — ijrochi tanlash */}
      <Dialog
        open={!!confirmTarget}
        onOpenChange={(open) => {
          if (!open && !confirming) {
            setConfirmTarget(null);
            setConfirmAssigneeId('none');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('ehtiyoj.confirm')}</DialogTitle>
            <DialogDescription>Ijrochini tanlang — vazifa uning Topshiriqlar bo‘limiga tushadi.</DialogDescription>
          </DialogHeader>
          {confirmTarget ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-sm font-semibold text-[#0f2744]">{needLabel(confirmTarget.needType)}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {displayBranchName(confirmTarget.branchLocation) || 'Filial'}
                {confirmTarget.managerName ? ` · ${confirmTarget.managerName}` : ''}
              </p>
              {confirmTarget.note ? <p className="mt-1 text-xs text-slate-600">{confirmTarget.note}</p> : null}
            </div>
          ) : null}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'all' as const, label: 'Barchasi' },
                ...NEED_ASSIGNEE_GROUPS,
              ].map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setAssigneeFilter(key);
                    setConfirmAssigneeId('none');
                  }}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
                    assigneeFilter === key ? 'bg-[#0b3a5c] text-white ring-[#0b3a5c]' : 'bg-white text-slate-600 ring-slate-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Select value={confirmAssigneeId} onValueChange={setConfirmAssigneeId}>
              <SelectTrigger>
                <SelectValue placeholder="Ijrochini tanlang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Tanlanmagan</SelectItem>
                {filteredAssignees.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.fullName} · {roleLabel(a.role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" disabled={confirming} onClick={() => setConfirmTarget(null)}>
              Bekor qilish
            </Button>
            <Button onClick={handleConfirm} disabled={confirming || confirmAssigneeId === 'none'} className="gap-2 bg-[#0b3a5c] hover:bg-[#0b3a5c]/90">
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Tasdiqlash va yuborish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Yopish — tasdiq */}
      <Dialog open={!!closeTarget} onOpenChange={(o) => !o && !closing && setCloseTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{closeTarget?.status === 'pending' ? 'Ehtiyojni yopasizmi?' : 'Ehtiyojni bekor qilasizmi?'}</DialogTitle>
            <DialogDescription>
              {closeTarget ? (
                <>
                  <span className="font-semibold text-slate-700">{needLabel(closeTarget.needType)}</span>
                  {' — '}
                  {displayBranchName(closeTarget.branchLocation) || 'Filial'}.{' '}
                </>
              ) : null}
              Ehtiyoj «Yopilgan» bo‘lib tarixga o‘tadi. Buni qaytarib bo‘lmaydi.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" disabled={closing} onClick={() => setCloseTarget(null)}>
              Yo‘q, qolsin
            </Button>
            <Button variant="destructive" disabled={closing} onClick={handleClose} className="gap-2">
              {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              {closeTarget?.status === 'pending' ? 'Ha, yopish' : 'Ha, bekor qilish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const BRANCH_STAFF_ROLES = new Set(['mudir', 'farmasevt', 'stajyor', 'stajor']);

function MyBranchCard({ branch, loading }: { branch: MyNeedBranch | null; loading: boolean }) {
  if (loading) return <Skeleton className="h-[76px] w-full rounded-2xl" />;
  if (!branch) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <Store className="h-5 w-5 shrink-0" />
        Siz hali biror filialga biriktirilmagansiz. Koordinator yoki HR bilan bog‘laning.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-[#0b3a5c]/15 bg-gradient-to-r from-[#0b3a5c] to-[#14527f] px-4 py-3.5 text-white shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <Store className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Sizning filialingiz</p>
          <p className="truncate text-lg font-bold leading-tight">{branch.branchName}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <User className="h-4 w-4 text-white/60" />
          <span className="text-white/70">Mudir:</span>
          <span className="font-semibold">{branch.managerName || 'tayinlanmagan'}</span>
        </span>
        {branch.coordinatorName ? (
          <span className="inline-flex items-center gap-1.5">
            <User className="h-4 w-4 text-white/60" />
            <span className="text-white/70">Koordinator:</span>
            <span className="font-semibold">{branch.coordinatorName}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

const TONES = {
  amber: { icon: 'bg-amber-100 text-amber-700', ring: 'ring-amber-300' },
  sky: { icon: 'bg-sky-100 text-sky-700', ring: 'ring-sky-300' },
  orange: { icon: 'bg-orange-100 text-orange-700', ring: 'ring-orange-300' },
  emerald: { icon: 'bg-emerald-100 text-emerald-700', ring: 'ring-emerald-300' },
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  active,
  hint,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone: keyof typeof TONES;
  active: boolean;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:border-slate-300 hover:shadow',
        active && cn('ring-2', TONES[tone].ring),
      )}
    >
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', TONES[tone].icon)}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-none tabular-nums text-[#0f2744]">{value}</span>
        <span className="mt-1 block text-xs font-medium text-slate-500">{label}</span>
        {hint && value > 0 ? <span className="mt-0.5 block text-[10px] font-semibold text-slate-700">{hint}</span> : null}
      </span>
    </button>
  );
}

function NeedCard({
  n,
  showConfirm,
  showVerify,
  showClose,
  closeLabel,
  verifying,
  onConfirm,
  onVerify,
  onClose,
}: {
  n: BranchNeed;
  showConfirm: boolean;
  showVerify: boolean;
  showClose: boolean;
  closeLabel: string;
  verifying: boolean;
  onConfirm: () => void;
  onVerify: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const branch = displayBranchName(n.branchLocation) || 'Filial';
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-[#0f2744]">{needLabel(n.needType)}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Store className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-medium text-slate-700">{branch}</span>
            </span>
            {n.managerName ? (
              <span className="inline-flex items-center gap-1">
                <User className="h-3.5 w-3.5 text-slate-400" />
                {n.managerName}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusPill status={n.status} />
          <span className="text-[11px] text-slate-400" title={fullDt(n.createdAt)}>
            #{n.id} · {ago(n.createdAt)}
          </span>
        </div>
      </div>

      {n.note ? <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{n.note}</p> : null}

      <div className="mt-4 overflow-x-auto pb-1">
        <div className="min-w-[420px]">
          <Stepper n={n} />
        </div>
      </div>

      {n.assignedUserName || n.taskId ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-slate-600">
          <Wrench className="h-3.5 w-3.5 text-slate-400" />
          Ijrochi:
          <span className="font-semibold text-slate-800">
            {n.assignedUserName || '—'}
            {n.assignedUserRole ? <span className="font-normal text-slate-500"> ({roleLabel(n.assignedUserRole)})</span> : null}
          </span>
          {n.taskId ? (
            <Link href="/vazifalar" className="font-medium text-[#0b3a5c] underline-offset-2 hover:underline">
              Vazifa #{n.taskId}
            </Link>
          ) : null}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          {open ? 'Yashirish' : 'Batafsil: kim va qachon'}
        </button>
        <div className="flex flex-wrap gap-2">
          {showClose && (
            <Button size="sm" variant="outline" className="h-8 gap-1 text-slate-600" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
              {closeLabel}
            </Button>
          )}
          {showConfirm && (
            <Button size="sm" className="h-8 gap-1 bg-[#0b3a5c] hover:bg-[#0b3a5c]/90" onClick={onConfirm}>
              <Check className="h-3.5 w-3.5" />
              Tasdiqlash
            </Button>
          )}
          {showVerify && (
            <Button size="sm" className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700" disabled={verifying} onClick={onVerify}>
              {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Yakuniy tasdiq
            </Button>
          )}
        </div>
      </div>
      {open ? (
        <div className="mt-3">
          <DetailTimeline n={n} />
        </div>
      ) : null}
    </article>
  );
}

function EmptyState({ tab, searching, canWrite, onCreate }: { tab: Tab; searching: boolean; canWrite: boolean; onCreate: () => void }) {
  const text = searching
    ? 'Qidiruv bo‘yicha hech narsa topilmadi'
    : tab === 'history'
      ? 'Hali yakunlangan yoki yopilgan ehtiyoj yo‘q'
      : tab === 'pending'
        ? 'Tasdiq kutayotgan ehtiyoj yo‘q'
        : tab === 'progress'
          ? 'Hozir bajarilayotgan ehtiyoj yo‘q'
          : tab === 'done'
            ? 'Yakuniy tasdiq kutayotgan ehtiyoj yo‘q'
            : 'Hozircha faol ehtiyoj yo‘q';
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
        <Inbox className="h-6 w-6 text-slate-400" />
      </span>
      <p className="text-sm font-medium text-slate-600">{text}</p>
      {canWrite && !searching && tab === 'active' ? (
        <Button size="sm" variant="outline" className="mt-1 gap-1.5" onClick={onCreate}>
          <Plus className="h-4 w-4" /> Yangi ehtiyoj qo‘shish
        </Button>
      ) : null}
    </div>
  );
}
