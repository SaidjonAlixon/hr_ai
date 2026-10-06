import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CircleAlert,
  ClipboardList,
  FileText,
  Loader2,
  Monitor,
  PenLine,
  Printer,
  Search,
  Send,
  Store,
  UserCheck,
  UserPlus,
  Wifi,
  Wrench,
  X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../lib/utils';
import { displayBranchName } from '../../lib/pharmacy-staff-api';
import {
  NEED_ASSIGNEE_GROUPS,
  needAssigneeGroup,
  roleLabel,
  type BranchNeedAssignee,
  type NeedAssigneeGroup,
} from '../../lib/branch-needs-api';

export type NeedManagerOption = { id: number; fullName: string; location?: string | null };

export type NewNeedPayload = {
  needType: string;
  note?: string;
  managerEmployeeId: number | null;
  branchLocation?: string;
  assigneeUserId?: number;
};

const QUICK_NEEDS = [
  { label: 'Printer qog‘ozi', icon: FileText },
  { label: 'Kompyuter', icon: Monitor },
  { label: 'Printer', icon: Printer },
  { label: 'Internet', icon: Wifi },
  { label: 'Ta’mirlash', icon: Wrench },
  { label: 'Mudir', icon: UserPlus },
] as const;

type RoleFilter = 'all' | NeedAssigneeGroup;

const ROLE_FILTERS: Array<[RoleFilter, string]> = [
  ['all', 'Barchasi'],
  ...NEED_ASSIGNEE_GROUPS.map((g): [RoleFilter, string] => [g.key, g.label]),
];

const TITLE_MAX = 120;

export function NewNeedDialog({
  open,
  onOpenChange,
  isMudir,
  isKoordinator,
  canConfirm,
  managers,
  managersLoading,
  assignees,
  assigneesLoading,
  assigneesError,
  onRetryAssignees,
  creating,
  onSubmit,
  myBranchName,
}: {
  myBranchName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isMudir: boolean;
  isKoordinator: boolean;
  canConfirm: boolean;
  managers: NeedManagerOption[];
  managersLoading: boolean;
  assignees: BranchNeedAssignee[];
  assigneesLoading: boolean;
  assigneesError: boolean;
  onRetryAssignees: () => void;
  creating: boolean;
  onSubmit: (payload: NewNeedPayload, done: () => void) => void;
}) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [managerId, setManagerId] = useState<number | null>(null);
  const [manualBranch, setManualBranch] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branchQuery, setBranchQuery] = useState('');
  const [assignNow, setAssignNow] = useState(isKoordinator);
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const titleRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle('');
    setNote('');
    setManagerId(null);
    setManualBranch(false);
    setBranchName('');
    setBranchQuery('');
    setAssignNow(isKoordinator);
    setAssigneeId(null);
    setAssigneeQuery('');
    setRoleFilter('all');
  };

  useEffect(() => {
    if (open) setAssignNow(isKoordinator);
  }, [open, isKoordinator]);

  const showBranch = !isMudir;
  const branchRequired = isKoordinator;
  const showAssignee = canConfirm;
  const assigneeRequired = isKoordinator;
  const willAssign = showAssignee && assignNow && assigneeId != null;

  const selectedManager = managers.find((m) => m.id === managerId) ?? null;
  const selectedAssignee = assignees.find((a) => a.id === assigneeId) ?? null;

  const branchList = useMemo(() => {
    const q = branchQuery.trim().toLowerCase();
    const list = managers.map((m) => ({ ...m, name: displayBranchName(m.location) || 'Filial' }));
    const filtered = q
      ? list.filter((m) => `${m.name} ${m.fullName}`.toLowerCase().includes(q))
      : list;
    return filtered.sort((a, b) => a.name.localeCompare(b.name, 'uz'));
  }, [managers, branchQuery]);

  const assigneeList = useMemo(() => {
    const q = assigneeQuery.trim().toLowerCase();
    return assignees
      .filter((a) => roleFilter === 'all' || needAssigneeGroup(a.role) === roleFilter)
      .filter((a) => !q || `${a.fullName} ${roleLabel(a.role)}`.toLowerCase().includes(q));
  }, [assignees, assigneeQuery, roleFilter]);

  const missing: string[] = [];
  if (!title.trim()) missing.push('nima kerakligini yozing');
  if (branchRequired && managerId == null) missing.push('filialni tanlang');
  if (showAssignee && (assigneeRequired || assignNow) && assigneeId == null) missing.push('ijrochini tanlang');
  const canSubmit = !creating && missing.length === 0;

  const flow = isMudir
    ? ['Siz yuborasiz', 'Koordinator tasdiqlaydi', 'Ijrochi bajaradi', 'Siz yakunlaysiz']
    : willAssign || isKoordinator
      ? ['Siz belgilaysiz', 'Vazifa ochiladi', 'Ijrochi bajaradi', 'Yakuniy tasdiq']
      : ['Siz qo‘shasiz', 'Ijrochi tanlanadi', 'Ijrochi bajaradi', 'Yakuniy tasdiq'];

  const outcome = isMudir
    ? 'Ehtiyoj koordinatorga boradi. U tasdiqlab ijrochi tayinlaydi.'
    : willAssign
      ? `vazifa darhol ochiladi va ${selectedAssignee?.fullName ?? 'ijrochi'}ning Topshiriqlar bo‘limiga tushadi.`
      : isKoordinator
        ? 'Ijrochini tanlang — vazifa darhol unga tushadi.'
        : 'Ehtiyoj «Tasdiq kutmoqda» ro‘yxatiga tushadi. Ijrochini keyin tanlaysiz.';

  const submitLabel = isMudir ? 'Koordinatorga yuborish' : willAssign ? 'Ijrochiga yuborish' : 'Ehtiyojni qo‘shish';

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(
      {
        needType: title.trim(),
        note: note.trim() || undefined,
        managerEmployeeId: manualBranch ? null : managerId,
        branchLocation: manualBranch
          ? branchName.trim() || undefined
          : selectedManager?.location || undefined,
        assigneeUserId: willAssign ? assigneeId! : undefined,
      },
      reset,
    );
  };

  let step = 0;
  const nextStep = () => ++step;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (creating) return;
        onOpenChange(o);
      }}
    >
      <DialogContent hideClose className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl sm:rounded-2xl">
        <div className="relative bg-[#0b3a5c] px-5 pb-4 pt-5 text-white">
          <button
            type="button"
            aria-label="Yopish"
            disabled={creating}
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-3 pr-8">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <ClipboardList className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold text-white">
                {isKoordinator ? 'Ehtiyoj belgilash' : 'Yangi ehtiyoj'}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] text-white/75">
                Filialga nima kerakligini yozing. Quyidagi yo‘l bilan bajariladi:
              </DialogDescription>
            </div>
          </div>
          <ol className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {flow.map((label, i) => (
              <li
                key={label}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold',
                  i === 0 ? 'bg-white text-[#0b3a5c]' : 'bg-white/10 text-white/85',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]',
                    i === 0 ? 'bg-[#0b3a5c] text-white' : 'bg-white/20',
                  )}
                >
                  {i + 1}
                </span>
                <span className="truncate">{label}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <Section n={nextStep()} title="Nima kerak?" required done={!!title.trim()}>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {QUICK_NEEDS.map(({ label, icon: Icon }) => {
                const on = title === label;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setTitle(on ? '' : label)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl border-2 px-1.5 py-2.5 text-[11px] font-semibold transition',
                      on
                        ? 'border-[#0b3a5c] bg-[#0b3a5c] text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-[#0b3a5c]/40 hover:bg-slate-50',
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="leading-tight">{label}</span>
                  </button>
                );
              })}
            </div>
            <div className="relative mt-2.5">
              <PenLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
                placeholder="Yoki o‘zingiz yozing: masalan, kassa apparati uchun lenta"
                className="h-11 pl-9 pr-16"
                autoFocus
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-slate-400">
                {title.length}/{TITLE_MAX}
              </span>
            </div>
          </Section>

          {showBranch ? (
            <Section
              n={nextStep()}
              title="Qaysi filial uchun?"
              required={branchRequired}
              optional={!branchRequired}
              done={manualBranch ? !!branchName.trim() : managerId != null}
            >
              {selectedManager && !manualBranch ? (
                <SelectedCard
                  icon={Store}
                  title={displayBranchName(selectedManager.location) || 'Filial'}
                  subtitle={`Mudir: ${selectedManager.fullName}`}
                  onChange={() => setManagerId(null)}
                />
              ) : manualBranch ? (
                <div className="space-y-1.5">
                  <Input
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="Filial nomini yozing: masalan, FARM LYUKS"
                    className="h-11"
                  />
                  <button
                    type="button"
                    className="text-xs font-medium text-[#0b3a5c] hover:underline"
                    onClick={() => {
                      setManualBranch(false);
                      setBranchName('');
                    }}
                  >
                    ← Ro‘yxatdan tanlash
                  </button>
                </div>
              ) : (
                <PickerList
                  query={branchQuery}
                  onQuery={setBranchQuery}
                  placeholder="Filial yoki mudir ismini qidiring…"
                  loading={managersLoading}
                  empty={
                    managers.length === 0
                      ? 'Filial topilmadi. Aptekalar tarmog‘ida mudirlar bog‘langanini tekshiring.'
                      : 'Qidiruv bo‘yicha filial topilmadi'
                  }
                  items={branchList.map((m) => ({
                    id: m.id,
                    title: m.name,
                    subtitle: m.fullName,
                    icon: Store,
                  }))}
                  onPick={(id) => setManagerId(id)}
                  footer={
                    !isKoordinator ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-[#0b3a5c] hover:underline"
                        onClick={() => {
                          setManualBranch(true);
                          setManagerId(null);
                        }}
                      >
                        Ro‘yxatda yo‘qmi? Nomini qo‘lda yozing
                      </button>
                    ) : null
                  }
                />
              )}
            </Section>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-[#0b3a5c]/20 bg-[#0b3a5c]/5 px-3 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0b3a5c] text-white">
                <Store className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Filial</span>
                <span className="block truncate text-sm font-bold text-[#0f2744]">
                  {myBranchName || 'O‘z filialingiz'}
                </span>
              </span>
            </div>
          )}

          {showAssignee ? (
            <Section
              n={nextStep()}
              title="Kim bajaradi?"
              required={assigneeRequired}
              done={!assignNow ? true : assigneeId != null}
            >
              {!assigneeRequired ? (
                <div className="mb-2.5 grid grid-cols-2 gap-2">
                  {[
                    { on: true, label: 'Hozir tanlayman', hint: 'Vazifa darhol ochiladi', icon: UserCheck },
                    { on: false, label: 'Keyinroq tasdiqlayman', hint: '«Tasdiq kutmoqda»ga tushadi', icon: ClipboardList },
                  ].map((opt) => {
                    const active = assignNow === opt.on;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => {
                          setAssignNow(opt.on);
                          if (!opt.on) setAssigneeId(null);
                        }}
                        className={cn(
                          'flex items-start gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition',
                          active
                            ? 'border-[#0b3a5c] bg-[#0b3a5c]/5'
                            : 'border-slate-200 bg-white hover:border-[#0b3a5c]/40',
                        )}
                      >
                        <opt.icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-[#0b3a5c]' : 'text-slate-400')} />
                        <span className="min-w-0">
                          <span className={cn('block text-sm font-semibold', active ? 'text-[#0b3a5c]' : 'text-slate-700')}>
                            {opt.label}
                          </span>
                          <span className="block text-[11px] text-slate-500">{opt.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {assignNow ? (
                selectedAssignee ? (
                  <SelectedCard
                    icon={UserCheck}
                    title={selectedAssignee.fullName}
                    subtitle={roleLabel(selectedAssignee.role)}
                    onChange={() => setAssigneeId(null)}
                  />
                ) : assigneesError ? (
                  <button
                    type="button"
                    className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-left text-xs font-medium text-rose-700"
                    onClick={onRetryAssignees}
                  >
                    Ijrochilar ro‘yxati yuklanmadi — qayta urinish uchun bosing
                  </button>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {ROLE_FILTERS.map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setRoleFilter(key)}
                          className={cn(
                            'rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition',
                            roleFilter === key
                              ? 'bg-[#0b3a5c] text-white ring-[#0b3a5c]'
                              : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <PickerList
                      query={assigneeQuery}
                      onQuery={setAssigneeQuery}
                      placeholder="Ijrochi ismini qidiring…"
                      loading={assigneesLoading}
                      empty={
                        assignees.length === 0
                          ? 'Faol ijrochi topilmadi (IT, kommunal yoki hudud mas’ullari).'
                          : 'Bu bo‘limda ijrochi topilmadi'
                      }
                      items={assigneeList.map((a) => ({
                        id: a.id,
                        title: a.fullName,
                        subtitle: roleLabel(a.role),
                        icon: UserCheck,
                      }))}
                      onPick={(id) => setAssigneeId(id)}
                    />
                  </>
                )
              ) : null}
            </Section>
          ) : null}

          <Section n={nextStep()} title="Izoh" optional>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Qancha kerak, qaysi model, qachongacha, qo‘shimcha ma’lumot…"
              rows={3}
              className="resize-none"
            />
          </Section>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          <div
            className={cn(
              'mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs',
              missing.length ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800',
            )}
          >
            {missing.length ? (
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {missing.length ? (
                <>
                  Yuborish uchun: <strong>{missing.join(', ')}</strong>.
                </>
              ) : (
                <>
                  <strong>Yuborilgach:</strong> {outcome}
                </>
              )}
            </span>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={creating} onClick={() => onOpenChange(false)} className="h-10">
              Bekor qilish
            </Button>
            <Button
              onClick={submit}
              disabled={!canSubmit}
              className="h-10 gap-2 bg-[#0b3a5c] px-5 hover:bg-[#0b3a5c]/90"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  n,
  title,
  required,
  optional,
  done,
  children,
}: {
  n: number;
  title: string;
  required?: boolean;
  optional?: boolean;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
            done ? 'bg-emerald-500 text-white' : 'bg-[#0b3a5c] text-white',
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
        </span>
        <h3 className="text-sm font-bold text-[#0f2744]">{title}</h3>
        {required ? (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">majburiy</span>
        ) : optional ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">ixtiyoriy</span>
        ) : null}
      </div>
      <div className="pl-8">{children}</div>
    </section>
  );
}

function SelectedCard({
  icon: Icon,
  title,
  subtitle,
  onChange,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-50/60 px-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-slate-900">{title}</span>
        <span className="block truncate text-xs text-slate-600">{subtitle}</span>
      </span>
      <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={onChange}>
        O‘zgartirish
      </Button>
    </div>
  );
}

function PickerList({
  query,
  onQuery,
  placeholder,
  loading,
  empty,
  items,
  onPick,
  footer,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  loading: boolean;
  empty: string;
  items: Array<{ id: number; title: string; subtitle: string; icon: React.ElementType }>;
  onPick: (id: number) => void;
  footer?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="relative border-b border-slate-100">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-slate-400"
        />
      </div>
      <div className="max-h-52 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-4 text-xs text-slate-500">{empty}</p>
        ) : (
          items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onPick(it.id)}
              className="flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2 text-left transition last:border-0 hover:bg-[#0b3a5c]/5"
            >
              <it.icon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">{it.title}</span>
                <span className="block truncate text-[11px] text-slate-500">{it.subtitle}</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
            </button>
          ))
        )}
      </div>
      {footer ? <div className="border-t border-slate-100 px-3 py-2">{footer}</div> : null}
    </div>
  );
}
