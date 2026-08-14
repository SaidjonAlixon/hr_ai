import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useGetEmployees, useUpdateEmployee, type Employee } from '@workspace/api-client-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../hooks/use-toast';
import { cn } from '../../lib/utils';
import { isHrManager, isHrRole } from '../../lib/roles';
import {
  EMPLOYMENT_STATUS_LABELS,
  PIPELINE_STEPS,
  useCancelStaffingAlert,
  useConfirmStaffingAlert,
  useStaffingAlerts,
  type EmploymentStatus,
  type StaffingAlert,
} from '../../lib/staffing-api';
import { DeadlineCountdown } from '../../components/DeadlineCountdown';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Dialog,
  DialogContent,
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
import { AlertTriangle, Check, Clock, Pencil, ChevronDown, ChevronUp, MapPin, Store, Search, Users, X, Plus, Copy, Eye, EyeOff } from 'lucide-react';
import { Link } from 'wouter';
import {
  useCreatePharmacyStaff,
  useSaveManagerLocation,
  stripGpsSuffix,
  gpsFromLocationField,
  gpsInputError,
  type PharmacyStaffRole,
  type PharmacyStaffResult,
} from '../../lib/pharmacy-staff-api';
import { Label } from '../../components/ui/label';

type ShiftType = 'one' | 'two' | 'custom';
type BranchEmployee = Employee & {
  latitude?: number | null;
  longitude?: number | null;
};

const BRANCH_ACCENTS = [
  'border-t-sky-500',
  'border-t-emerald-500',
  'border-t-amber-500',
  'border-t-rose-500',
  'border-t-teal-500',
  'border-t-indigo-500',
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function shiftText(shiftType?: string | null, shiftLabel?: string | null) {
  if (shiftType === 'two') return '2-smena';
  if (shiftType === 'custom') return shiftLabel?.trim() || 'Maxsus holat';
  return '1-smena';
}

function empStatus(person: Employee): EmploymentStatus {
  return (person.employmentStatus as EmploymentStatus) || 'working';
}

function googleMapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function isAlertStatus(status?: string | null) {
  return !!status && status !== 'working';
}

function resolvePipelineStep(ph: Employee, linked?: StaffingAlert) {
  const status = empStatus(ph);
  if (
    status === 'searching' ||
    linked?.employmentStatus === 'searching' ||
    linked?.vacancyStatus === 'published' ||
    linked?.pipelineKey === 'searching'
  ) {
    return 5;
  }
  if (linked?.pipelineStep != null && linked.pipelineStep > 0) return linked.pipelineStep;
  if (linked?.vacancyId || linked?.vacancyStatus === 'draft') return 3;
  if (linked?.workflowStatus === 'confirmed' || linked?.requestId) return 2;
  if (
    linked?.workflowStatus === 'pending' ||
    status === 'need_hire' ||
    status === 'dismissed' ||
    status === 'new'
  ) {
    return 1;
  }
  return 0;
}

function deadlineLabel(kind?: StaffingAlert['deadlineKind']) {
  if (kind === 'vacancy') return 'Eʼlon muddati';
  if (kind === 'request') return 'Ariza muddati';
  if (kind === 'confirm') return 'Tasdiq muddati';
  return 'Muddat';
}

function EmploymentBadge({ status }: { status?: string | null }) {
  const s = (status as EmploymentStatus) || 'working';
  const label = EMPLOYMENT_STATUS_LABELS[s] || s;
  const tone =
    s === 'working'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : s === 'new'
        ? 'bg-sky-50 text-sky-700 ring-sky-200'
        : s === 'dismissed'
          ? 'bg-red-100 text-red-800 ring-red-300'
          : s === 'searching'
            ? 'bg-violet-100 text-violet-800 ring-violet-300 animate-pulse'
            : 'bg-orange-100 text-orange-800 ring-orange-300';

  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset', tone)}>
      {label}
    </span>
  );
}

function ShiftBadge({
  shiftType,
  shiftLabel,
  alert,
}: {
  shiftType?: string | null;
  shiftLabel?: string | null;
  alert?: boolean;
}) {
  const label = shiftText(shiftType, shiftLabel);
  const tone = alert
    ? 'bg-red-100 text-red-800 ring-red-300'
    : shiftType === 'two'
      ? 'bg-teal-50 text-teal-700 ring-teal-200'
      : shiftType === 'custom'
        ? 'bg-amber-50 text-amber-800 ring-amber-200'
        : 'bg-sky-50 text-sky-700 ring-sky-200';

  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset', tone)}>
      <Clock className="h-2.5 w-2.5 opacity-70" />
      {label}
    </span>
  );
}

function PipelineStrip({ step }: { step: number }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-0.5">
      {PIPELINE_STEPS.map((s, i) => {
        const active = step >= s.step;
        const current = step === s.step;
        return (
          <React.Fragment key={s.key}>
            {i > 0 && (
              <span className={cn('h-px w-2 shrink-0', active ? 'bg-red-400' : 'bg-slate-200')} />
            )}
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                current
                  ? 'bg-red-600 text-white animate-pulse'
                  : active
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-100 text-slate-400',
              )}
              title={s.label}
            >
              {s.label}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white bg-slate-600',
        size === 'sm' ? 'h-8 w-8 text-[10px]' : 'h-9 w-9 text-xs',
      )}
    >
      {initials(name)}
    </div>
  );
}

export default function PharmacyNetworkPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: employees, isLoading, refetch } = useGetEmployees();
  const { mutate: updateEmployee, isPending } = useUpdateEmployee();
  const { data: alerts, refetch: refetchAlerts } = useStaffingAlerts('open', {
    enabled: !!user,
  });
  const { mutate: confirmAlert, isPending: confirming } = useConfirmStaffingAlert();
  const { mutate: cancelAlert, isPending: cancelling } = useCancelStaffingAlert();
  const createStaff = useCreatePharmacyStaff();
  const saveBranchGps = useSaveManagerLocation();

  const canAddMudir = user?.role === 'koordinator' || user?.role === 'admin' || isHrManager(user?.role);
  const canAddTeam = user?.role === 'mudir';
  const canAddStaff = canAddMudir || canAddTeam;

  const canSeeFullNetwork =
    isHrRole(user?.role) ||
    user?.role === 'director' ||
    user?.role === 'admin' ||
    user?.role === 'recruiter' ||
    user?.role === 'koordinator' ||
    user?.role === 'department_head';

  const isMudirOnly = user?.role === 'mudir';
  const isKoordinatorOnly = user?.role === 'koordinator';

  const canEditShift =
    isHrRole(user?.role) ||
    user?.role === 'director' ||
    user?.role === 'admin' ||
    user?.role === 'department_head' ||
    user?.role === 'mudir' ||
    user?.role === 'koordinator';

  const canEditStatus =
    user?.role === 'mudir' ||
    isHrRole(user?.role) ||
    user?.role === 'admin' ||
    user?.role === 'director' ||
    user?.role === 'koordinator';

  const canSeeAlerts =
    user?.role === 'koordinator' ||
    user?.role === 'mudir' ||
    user?.role === 'admin' ||
    isHrRole(user?.role) ||
    user?.role === 'director';

  const canConfirmAlerts = user?.role === 'koordinator' || isHrManager(user?.role);
  const canSetBranchGps = user?.role === 'koordinator' || user?.role === 'admin' || isHrManager(user?.role);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const teamPanelRef = useRef<HTMLDivElement>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [shiftType, setShiftType] = useState<ShiftType>('one');
  const [shiftLabel, setShiftLabel] = useState('');
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>('working');
  const [search, setSearch] = useState('');
  const [coordinatorFilter, setCoordinatorFilter] = useState<string>('all');
  const [shiftFilter, setShiftFilter] = useState<string>('all');

  const [addOpen, setAddOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [staffRole, setStaffRole] = useState<PharmacyStaffRole>('mudir');
  const [branchLocation, setBranchLocation] = useState('');
  const [createdCreds, setCreatedCreds] = useState<PharmacyStaffResult | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [gpsDraft, setGpsDraft] = useState<Record<number, string>>({});
  const [gpsEditingId, setGpsEditingId] = useState<number | null>(null);
  const [savedGps, setSavedGps] = useState<Record<number, { lat: number; lng: number }>>({});

  const orgPeople = useMemo(
    () => (employees ?? []).filter((e) => !!e.orgRole),
    [employees],
  );

  const coordinators = useMemo(() => {
    let list = orgPeople.filter((e) => e.orgRole === 'coordinator');
    // Koordinator faqat o‘z kartasini ko‘radi — boshqa koordinatorlarning mudirlari aralashmasin
    if (isKoordinatorOnly && user?.id) {
      list = list.filter((e) => e.userId === user.id);
    }
    return list;
  }, [orgPeople, isKoordinatorOnly, user?.id]);

  const allManagers = useMemo(() => {
    let list = orgPeople.filter((e) => e.orgRole === 'manager');
    // Mudir faqat o‘z kartasini ko‘radi
    if (isMudirOnly && user?.id) {
      list = list.filter((e) => e.userId === user.id);
    }
    // Koordinator — faqat o‘zi qo‘shgan (reportsToId = o‘z coordinator employee id)
    if (isKoordinatorOnly && user?.id) {
      const myCoord = orgPeople.find((e) => e.orgRole === 'coordinator' && e.userId === user.id);
      list = myCoord ? list.filter((m) => m.reportsToId === myCoord.id) : [];
    }
    return list.sort((a, b) => (a.location ?? '').localeCompare(b.location ?? '', 'uz'));
  }, [orgPeople, isMudirOnly, isKoordinatorOnly, user?.id]);

  const pharmacistsByManager = useMemo(() => {
    const map = new Map<number, Employee[]>();
    for (const p of orgPeople.filter(
      (e) => e.orgRole === 'pharmacist' || e.orgRole === 'intern' || e.orgRole === 'supervisor',
    )) {
      if (!p.reportsToId) continue;
      const list = map.get(p.reportsToId) ?? [];
      list.push(p);
      map.set(p.reportsToId, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        const rank = (r?: string | null) =>
          r === 'intern' ? 0 : r === 'supervisor' ? 1 : 2;
        const d = rank(a.orgRole) - rank(b.orgRole);
        if (d !== 0) return d;
        return a.fullName.localeCompare(b.fullName, 'uz');
      });
    }
    return map;
  }, [orgPeople]);

  const alertByEmployee = useMemo(() => {
    const map = new Map<number, StaffingAlert>();
    for (const a of alerts ?? []) {
      const prev = map.get(a.employeeId);
      if (!prev || new Date(a.createdAt) > new Date(prev.createdAt)) {
        map.set(a.employeeId, a);
      }
    }
    return map;
  }, [alerts]);

  const branchHasAlert = (managerId: number) => {
    const mgr = allManagers.find((m) => m.id === managerId);
    if (mgr && (isAlertStatus(empStatus(mgr)) || alertByEmployee.has(mgr.id))) return true;
    return (pharmacistsByManager.get(managerId) ?? []).some(
      (p) => isAlertStatus(empStatus(p)) || alertByEmployee.has(p.id),
    );
  };

  const nameMatch = (person: Employee, q: string) =>
    person.fullName.toLowerCase().includes(q);

  const shiftMatch = (person: Employee) => {
    if (shiftFilter === 'all') return true;
    return (person.shiftType || 'one') === shiftFilter;
  };

  const filteredCoordinators = useMemo(() => {
    const q = search.trim().toLowerCase();
    return coordinators.filter((c) => {
      if (coordinatorFilter !== 'all' && String(c.id) !== coordinatorFilter) return false;

      const managersUnder = allManagers.filter((m) => m.reportsToId === c.id);
      const personShiftOk = (p: Employee) => shiftFilter === 'all' || (p.shiftType || 'one') === shiftFilter;
      const underMatchesShift = managersUnder.some((m) => {
        if (personShiftOk(m)) return true;
        return (pharmacistsByManager.get(m.id) ?? []).some((p) => personShiftOk(p));
      });
      if (shiftFilter !== 'all' && !personShiftOk(c) && !underMatchesShift) return false;

      if (!q) return true;
      if (c.fullName.toLowerCase().includes(q)) return true;
      return managersUnder.some((m) => {
        if (m.fullName.toLowerCase().includes(q)) return true;
        return (pharmacistsByManager.get(m.id) ?? []).some((p) => p.fullName.toLowerCase().includes(q));
      });
    });
  }, [coordinators, coordinatorFilter, search, shiftFilter, allManagers, pharmacistsByManager]);

  const managers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const allowedCoordIds = new Set(filteredCoordinators.map((c) => c.id));
    let list = allManagers.filter((m) => m.reportsToId != null && allowedCoordIds.has(m.reportsToId));

    if (shiftFilter !== 'all') {
      list = list.filter((m) => {
        if (shiftMatch(m)) return true;
        return (pharmacistsByManager.get(m.id) ?? []).some((p) => shiftMatch(p));
      });
    }

    if (q) {
      list = list.filter((m) => {
        if (nameMatch(m, q)) return true;
        return (pharmacistsByManager.get(m.id) ?? []).some((p) => nameMatch(p, q));
      });
    }

    return list;
  }, [allManagers, filteredCoordinators, shiftFilter, search, pharmacistsByManager]);

  const filterTeam = (managerId: number) => {
    let team = pharmacistsByManager.get(managerId) ?? [];
    const q = search.trim().toLowerCase();
    if (shiftFilter !== 'all') {
      team = team.filter((p) => shiftMatch(p));
    }
    if (q) {
      const manager = allManagers.find((m) => m.id === managerId);
      if (manager && nameMatch(manager, q)) {
        return team;
      }
      team = team.filter((p) => nameMatch(p, q));
    }
    return team;
  };

  const pendingAlerts = useMemo(
    () => (alerts ?? []).filter((a) => a.workflowStatus === 'pending'),
    [alerts],
  );

  const confirmedAlerts = useMemo(
    () => (alerts ?? []).filter((a) => a.workflowStatus === 'confirmed'),
    [alerts],
  );

  /** Koordinator: avval tasdiq kutilayotganlar, keyin ariza jarayonidagilar — yig‘ilib turadi */
  const openAlerts = useMemo(() => {
    const list = alerts ?? [];
    return [...list].sort((a, b) => {
      if (a.workflowStatus === 'pending' && b.workflowStatus !== 'pending') return -1;
      if (a.workflowStatus !== 'pending' && b.workflowStatus === 'pending') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [alerts]);

  const openEditor = (person: Employee, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditTarget(person);
    setShiftType((person.shiftType as ShiftType) || 'one');
    setShiftLabel(person.shiftLabel ?? '');
    setEmploymentStatus(empStatus(person));
  };

  const openAddStaff = () => {
    setFirstName('');
    setLastName('');
    setPhone('');
    setBranchLocation('');
    setStaffRole(canAddMudir ? 'mudir' : 'farmasevt');
    setShowPwd(false);
    setAddOpen(true);
  };

  const handleCreateStaff = () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast({ title: 'Ism va familiya kiriting', variant: 'destructive' });
      return;
    }
    if (!phone.trim()) {
      toast({ title: 'Telefon raqam kiriting', variant: 'destructive' });
      return;
    }
    createStaff.mutate(
      {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        role: staffRole,
        location: staffRole === 'mudir' ? branchLocation.trim() || undefined : undefined,
      },
      {
        onSuccess: (data) => {
          setAddOpen(false);
          setCreatedCreds(data);
          void refetch();
          toast({ title: 'Yaratildi', description: `${data.fullName} qo‘shildi` });
        },
        onError: (e: any) => {
          toast({
            title: 'Yaratilmadi',
            description: e?.message || 'Xato',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} nusxalandi` });
    } catch {
      toast({ title: 'Nusxalanmadi', variant: 'destructive' });
    }
  };

  const saveEditor = () => {
    if (!editTarget) return;
    updateEmployee(
      {
        id: editTarget.id,
        data: {
          shiftType,
          shiftLabel: shiftType === 'custom' ? shiftLabel.trim() || 'Maxsus holat' : '',
          ...(canEditStatus ? { employmentStatus } : {}),
        },
      },
      {
        onSuccess: () => {
          toast({
            title: 'Saqlandi',
            description:
              canEditStatus && employmentStatus !== 'working'
                ? 'Holat yangilandi — ogohlantirish yuborildi'
                : 'Maʼlumot yangilandi',
          });
          setEditTarget(null);
          refetch();
          refetchAlerts();
        },
        onError: (err: any) => {
          toast({
            title: 'Xatolik',
            description: err?.message || 'Saqlashda xatolik',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const saveBranchLocation = (manager: BranchEmployee) => {
    const coordinates = (gpsDraft[manager.id] || '').trim();
    const bad = gpsInputError(coordinates);
    if (bad) {
      toast({
        title: 'Koordinata to‘liq emas',
        description: bad,
        variant: 'destructive',
      });
      return;
    }
    saveBranchGps.mutate(
      {
        employeeId: manager.id,
        coordinates,
        keepLocation: stripGpsSuffix(manager.location),
      },
      {
        onSuccess: (data) => {
          if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
            setSavedGps((prev) => ({
              ...prev,
              [manager.id]: { lat: data.latitude!, lng: data.longitude! },
            }));
          }
          toast({
            title: 'Lokatsiya saqlandi',
            description: 'Pinni bosing — xarita ochiladi',
          });
          setGpsEditingId(null);
          setGpsDraft((prev) => {
            const next = { ...prev };
            delete next[manager.id];
            return next;
          });
          void refetch();
        },
        onError: (err: Error) => {
          toast({ title: 'Saqlanmadi', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  const handleConfirm = (alertId: number) => {
    confirmAlert(alertId, {
      onSuccess: (result) => {
        toast({
          title: 'Tasdiqlandi',
          description: `Ariza #${result.requestId} yaratildi — HR, direktor va rekruterlarga koʻrinadi`,
        });
        refetchAlerts();
      },
      onError: (err: Error) => {
        toast({ title: 'Xatolik', description: err.message, variant: 'destructive' });
      },
    });
  };

  const handleCancelAlert = (alertId: number) => {
    cancelAlert(alertId, {
      onSuccess: () => {
        toast({ title: 'Bekor qilindi' });
        refetchAlerts();
      },
      onError: (err: Error) => {
        toast({ title: 'Xatolik', description: err.message, variant: 'destructive' });
      },
    });
  };

  const toggleBranch = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  useEffect(() => {
    if (expandedId == null) return;
    const id = window.requestAnimationFrame(() => {
      teamPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [expandedId]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (isMudirOnly) {
    if (allManagers.length === 0) {
      return (
        <div className="mx-auto max-w-md rounded-2xl border border-dashed bg-white p-8 text-center">
          <Store className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Filial bog‘lanmagan</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sizning akkauntingiz hali filial mudiriga ulanmagan. Koordinator/HR bilan bog‘laning.
          </p>
        </div>
      );
    }
  }

  const networkEmpty = !isMudirOnly && coordinators.length === 0 && allManagers.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Aptekalar tarmog‘i</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isMudirOnly
              ? 'Yuqorida koordinatoringiz, pastda o‘z filialingiz. Farmasevt va stajyor qo‘shishingiz mumkin.'
              : 'Mudir qo‘shing — tizim login/parol beradi. Mudir keyin farmasevt va stajyor qo‘shadi.'}
          </p>
        </div>
        {canAddStaff && (
          <Button className="gap-2 shrink-0" onClick={openAddStaff}>
            <Plus className="h-4 w-4" />
            {canAddMudir ? 'Mudir qo‘shish' : 'Xodim qo‘shish'}
          </Button>
        )}
      </div>

      {networkEmpty ? (
        <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
          <Store className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Tarmoq maʼlumoti yo‘q</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {canAddMudir
              ? 'Birinchi mudirni qo‘shing — ism, familiya, raqam. Tizim login va parol yaratadi.'
              : 'Koordinator va mudirlar hali qo‘shilmagan.'}
          </p>
          {canAddMudir && (
            <Button className="mt-4 gap-2" onClick={openAddStaff}>
              <Plus className="h-4 w-4" /> Mudir qo‘shish
            </Button>
          )}
        </div>
      ) : null}

        {canSeeAlerts && (
          <div
            className={cn(
              'rounded-xl border p-3 sm:p-4 transition-colors',
              openAlerts.length > 0
                ? 'border-red-300 bg-red-50/70'
                : 'border-slate-200 bg-slate-50/80',
            )}
          >
            <button
              type="button"
              onClick={() => setAlertsOpen((o) => !o)}
              className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
            >
              <div className="flex min-w-0 items-center gap-2">
                {alertsOpen ? (
                  <ChevronUp className={cn('h-4 w-4 shrink-0', openAlerts.length ? 'text-red-600' : 'text-slate-500')} />
                ) : (
                  <ChevronDown className={cn('h-4 w-4 shrink-0', openAlerts.length ? 'text-red-600' : 'text-slate-500')} />
                )}
                <span className="relative inline-flex">
                  <AlertTriangle
                    className={cn(
                      'h-4 w-4 shrink-0',
                      openAlerts.length > 0 ? 'text-red-600' : 'text-slate-400',
                      openAlerts.length > 0 && 'animate-pulse',
                    )}
                  />
                  {openAlerts.length > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white animate-pulse ring-2 ring-red-100">
                      {openAlerts.length > 99 ? '99+' : openAlerts.length}
                    </span>
                  )}
                </span>
                <h2
                  className={cn(
                    'text-sm font-semibold',
                    openAlerts.length > 0 ? 'text-red-900' : 'text-slate-700',
                  )}
                >
                  {user?.role === 'koordinator'
                    ? 'Ogohlantirishlar va arizalar'
                    : 'Ogohlantirishlar'}
                  {openAlerts.length ? ` (${openAlerts.length})` : ''}
                </h2>
                {openAlerts.length > 0 && !alertsOpen && (
                  <span className="hidden rounded-full bg-red-600/15 px-2 py-0.5 text-[10px] font-semibold text-red-700 animate-pulse sm:inline">
                    Yangi xabar bor — oching
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {user?.role === 'koordinator' && openAlerts.length > 0 && (
                  <p className="text-[11px] text-red-700/80">
                    {pendingAlerts.length > 0 && (
                      <span className="font-medium">Tasdiq: {pendingAlerts.length}</span>
                    )}
                    {pendingAlerts.length > 0 && confirmedAlerts.length > 0 && ' · '}
                    {confirmedAlerts.length > 0 && (
                      <span>Ariza jarayonida: {confirmedAlerts.length}</span>
                    )}
                  </p>
                )}
                <span
                  className={cn(
                    'text-[11px] font-medium',
                    openAlerts.length > 0 ? 'text-red-700/70' : 'text-slate-500',
                  )}
                >
                  {alertsOpen ? 'Yig‘ish' : 'Ochish'}
                </span>
              </div>
            </button>

            {alertsOpen && (
              <div className="mt-3">
                {!openAlerts.length ? (
                  <p className="text-sm text-slate-500">Hozircha ochiq ogohlantirish yoʻq.</p>
                ) : (
                  <div className="max-h-[min(50vh,380px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
                    {user?.role === 'koordinator' && pendingAlerts.length > 0 && (
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        Tasdiq kutilmoqda
                      </p>
                    )}
                    {openAlerts.map((a, idx) => {
                      const showArizaDivider =
                        user?.role === 'koordinator' &&
                        a.workflowStatus === 'confirmed' &&
                        (idx === 0 || openAlerts[idx - 1]?.workflowStatus === 'pending');

                      return (
                        <React.Fragment key={a.id}>
                          {showArizaDivider && (
                            <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              Ariza jarayonida
                            </p>
                          )}
                          <div className="rounded-lg border border-red-200 bg-white px-3 py-2">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-900">
                                  {a.branchLocation || 'Filial'} — {a.employeeName}
                                </p>
                                <p className="truncate text-xs text-slate-500">
                                  {a.employmentStatusLabel}
                                  {' · '}
                                  {shiftText(a.shiftType, a.shiftLabel)}
                                  {a.managerName ? ` · Mudir: ${a.managerName}` : ''}
                                  {' · '}
                                  {a.pipelineLabel}
                                </p>
                                <PipelineStrip
                                  step={
                                    typeof a.pipelineStep === 'number' && a.pipelineStep > 0
                                      ? a.pipelineStep
                                      : 1
                                  }
                                />
                              </div>
                              <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:w-52 sm:items-end">
                                {a.displayDeadline && (
                                  <DeadlineCountdown
                                    deadline={a.displayDeadline}
                                    compact
                                    showDate
                                    dateLabel={deadlineLabel(a.deadlineKind)}
                                    className="w-full"
                                  />
                                )}
                                {a.workflowStatus === 'pending' && canConfirmAlerts && (
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      className="h-8 gap-1"
                                      disabled={confirming}
                                      onClick={() => handleConfirm(a.id)}
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                      Tasdiqlash
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 gap-1"
                                      disabled={cancelling}
                                      onClick={() => handleCancelAlert(a.id)}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                      Bekor
                                    </Button>
                                  </div>
                                )}
                                {a.workflowStatus === 'pending' && !canConfirmAlerts && (
                                  <span className="text-[11px] font-medium text-amber-700">
                                    Koordinator tasdiǧi kutilmoqda
                                  </span>
                                )}
                                {a.workflowStatus === 'confirmed' && a.requestId && (
                                  <Link
                                    href={`/requests/${a.requestId}`}
                                    className="inline-flex h-8 items-center justify-center rounded-md border border-primary/30 bg-primary/5 px-2.5 text-[11px] font-semibold text-primary hover:bg-primary/10"
                                  >
                                    Ariza #{a.requestId}
                                  </Link>
                                )}
                                {a.workflowStatus === 'confirmed' && !a.requestId && (
                                  <span className="text-[11px] font-medium text-slate-500">
                                    Ariza yaratilgan
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
                {user?.role === 'mudir' && pendingAlerts.length > 0 && (
                  <p className="mt-2 text-[11px] text-red-700/80">
                    Tasdiqlash faqat koordinator tomonidan bajariladi.
                  </p>
                )}
                {user?.role === 'koordinator' && openAlerts.length > 0 && (
                  <p className="mt-2 text-[11px] text-red-700/80">
                    «Tasdiqlash» → ariza ochiladi; yopilmaguncha shu yerda qoladi.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {canSeeFullNetwork && (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ism yoki familiya bo‘yicha qidirish..."
              className="pl-9"
            />
          </div>
          {!isKoordinatorOnly ? (
            <Select value={coordinatorFilter} onValueChange={setCoordinatorFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Koordinatorlar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha koordinatorlar</SelectItem>
                {coordinators.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select value={shiftFilter} onValueChange={setShiftFilter}>
            <SelectTrigger className="w-full sm:w-[170px]">
              <SelectValue placeholder="Smena" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha smenalar</SelectItem>
              <SelectItem value="one">1-smena</SelectItem>
              <SelectItem value="two">2-smena</SelectItem>
              <SelectItem value="custom">Maxsus</SelectItem>
            </SelectContent>
          </Select>
        </div>
        )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-b from-[#f4f7fa] to-white">
        {(canSeeFullNetwork || isMudirOnly) && (
        <div className="border-b border-slate-200/80 px-4 py-4 sm:px-5">
          <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            1 · Koordinator
          </p>
          {!filteredCoordinators.length ? (
            <p className="py-4 text-center text-sm text-slate-400">
              {isMudirOnly ? 'Koordinator topilmadi' : 'Filter bo‘yicha koordinator topilmadi'}
            </p>
          ) : (
            <div className="flex flex-wrap justify-center gap-2.5">
              {(isMudirOnly ? coordinators : filteredCoordinators).map((coordinator) => {
                const alert = isAlertStatus(empStatus(coordinator));
                return (
                  <div
                    key={coordinator.id}
                    className="w-full max-w-[calc((100%-2.5rem)/2)] sm:max-w-[calc((100%-1.25rem)/3)] lg:max-w-[calc((100%-3.125rem)/6)]"
                  >
                    <div
                      className={cn(
                        'flex min-w-0 flex-col overflow-hidden rounded-lg border bg-white shadow-sm',
                        alert ? 'border-red-300 ring-1 ring-red-200' : 'border-[#0b3a5c]/25',
                      )}
                    >
                      <div
                        className={cn(
                          'flex flex-1 flex-col border-t-[3px] p-2.5',
                          alert ? 'border-t-red-500' : 'border-t-[#0b3a5c]',
                        )}
                      >
                        <span className="mb-2 truncate rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 w-fit">
                          Markaz
                        </span>
                        <div className="flex items-start gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0b3a5c] text-[9px] font-semibold text-white">
                            {initials(coordinator.fullName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold leading-snug text-slate-900">{coordinator.fullName}</p>
                            <p className="mt-0.5 truncate text-[10px] text-slate-500">Koordinator</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              <EmploymentBadge status={empStatus(coordinator)} />
                              {canSeeFullNetwork && (canEditShift || canEditStatus) && (
                                <button
                                  type="button"
                                  onClick={(e) => openEditor(coordinator, e)}
                                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-primary"
                                >
                                  <Pencil className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        <div className="px-3 py-3 sm:px-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {isMudirOnly ? 'Mening filiali' : '2 · Filial mudirlari'}
            </p>
            <p className="text-xs text-slate-400">{managers.length} ta filial</p>
          </div>

          {expandedId != null && (() => {
            const manager = managers.find((m) => m.id === expandedId);
            const team = filterTeam(expandedId);
            const alert = manager ? branchHasAlert(manager.id) : false;
            if (!manager) return null;

            return (
              <div
                ref={teamPanelRef}
                className={cn(
                  'mb-4 flex max-h-[min(55vh,480px)] scroll-mt-20 flex-col rounded-xl border bg-white shadow-sm',
                  alert ? 'border-red-300' : 'border-slate-200',
                )}
              >
                <div className="mb-0 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Farmatsevtlar — eʼlon holati
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">
                      {manager.location} — {manager.fullName}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setExpandedId(null)}
                  >
                    Yopish
                  </Button>
                </div>

                {team.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">Filter bo‘yicha farmatsevt yo‘q</p>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {team.map((ph) => {
                        const linked = alertByEmployee.get(ph.id);
                        const phAlert = isAlertStatus(empStatus(ph)) || !!linked;
                        const pipelineStep = resolvePipelineStep(ph, linked);

                        return (
                          <div
                            key={ph.id}
                            className={cn(
                              'rounded-lg border px-3 py-2.5',
                              phAlert ? 'border-red-300 bg-red-50/80' : 'border-slate-200 bg-slate-50/70',
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <Avatar name={ph.fullName} size="sm" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="truncate text-sm font-medium text-slate-900">{ph.fullName}</p>
                                  {ph.orgRole === 'intern' ? (
                                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
                                      Stajyor
                                    </span>
                                  ) : ph.orgRole === 'supervisor' ? (
                                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
                                      Boshqaruvchi
                                    </span>
                                  ) : (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                                      Farmasevt
                                    </span>
                                  )}
                                  {(canEditShift || canEditStatus) && (
                                    <button
                                      type="button"
                                      onClick={(e) => openEditor(ph, e)}
                                      className="rounded p-1.5 text-slate-400 hover:bg-white hover:text-primary"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <ShiftBadge
                                    shiftType={ph.shiftType}
                                    shiftLabel={ph.shiftLabel}
                                    alert={phAlert}
                                  />
                                  <EmploymentBadge status={empStatus(ph)} />
                                </div>
                                <PipelineStrip step={pipelineStep} />
                                {linked?.displayDeadline && (
                                  <div className="mt-2">
                                    <DeadlineCountdown
                                      deadline={linked.displayDeadline}
                                      compact
                                      showDate
                                      dateLabel={deadlineLabel(linked.deadlineKind)}
                                    />
                                  </div>
                                )}
                                {linked?.requestId && (
                                  <Link
                                    href={`/requests/${linked.requestId}`}
                                    className="mt-1 inline-block text-[11px] font-medium text-primary hover:underline"
                                  >
                                    Ariza #{linked.requestId}
                                    {linked.vacancyId ? ` · Vakansiya #${linked.vacancyId}` : ''}
                                  </Link>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {managers.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Filter bo‘yicha mudir topilmadi</p>
          ) : (
            <div
              className={cn(
                isMudirOnly
                  ? 'mx-auto flex w-full max-w-sm justify-center'
                  : 'grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
              )}
            >
              {managers.map((manager, idx) => {
                const fullTeam = pharmacistsByManager.get(manager.id) ?? [];
                const open = expandedId === manager.id;
                const alert = branchHasAlert(manager.id);
                const accent = alert
                  ? 'border-t-red-500'
                  : BRANCH_ACCENTS[idx % BRANCH_ACCENTS.length];

                return (
                  <div
                    key={manager.id}
                    className={cn(
                      'group flex min-w-0 flex-col overflow-hidden rounded-xl border border-t-[3px] bg-white shadow-sm transition-all hover:shadow-md',
                      accent,
                      alert && 'border-red-300 bg-red-50/30 ring-1 ring-red-200',
                      open
                        ? alert
                          ? 'shadow-md ring-2 ring-red-200'
                          : 'border-primary/40 shadow-md ring-2 ring-primary/20'
                        : !alert && 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    <div className="flex flex-1 flex-col gap-3 p-3.5 sm:p-4">
                      <div className="flex items-start justify-between gap-2">
                        {(() => {
                          const branch = manager as BranchEmployee;
                          const fromField = gpsFromLocationField(manager.location);
                          const gps = savedGps[manager.id];
                          const lat =
                            typeof branch.latitude === 'number'
                              ? branch.latitude
                              : gps?.lat ?? fromField?.lat;
                          const lng =
                            typeof branch.longitude === 'number'
                              ? branch.longitude
                              : gps?.lng ?? fromField?.lng;
                          const hasGps = typeof lat === 'number' && typeof lng === 'number';
                          const displayName = stripGpsSuffix(manager.location);
                          const hasName = Boolean(displayName && displayName !== 'Filial');
                          const editing =
                            gpsEditingId === manager.id || (canSetBranchGps && !hasGps && !hasName);
                          if (canSetBranchGps && editing) {
                            return (
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                  Filial koordinatasi
                                </label>
                                <textarea
                                  value={gpsDraft[manager.id] ?? ''}
                                  onChange={(e) =>
                                    setGpsDraft((prev) => ({ ...prev, [manager.id]: e.target.value }))
                                  }
                                  placeholder={`41°18'23.3"N 69°18'28.0"E`}
                                  rows={2}
                                  className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs leading-snug"
                                />
                                <p className="text-[10px] leading-snug text-slate-500">
                                  Google Maps dan to‘liq nusxa: kenglik (N) va uzunlik (E)
                                </p>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-8 w-full sm:w-auto"
                                  disabled={saveBranchGps.isPending}
                                  onClick={() => saveBranchLocation(branch)}
                                >
                                  {saveBranchGps.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
                                </Button>
                              </div>
                            );
                          }
                          const label = hasName ? displayName : hasGps ? 'Lokatsiya' : 'Lokatsiya ko‘rsatilmagan';
                          return (
                            <div className="flex min-w-0 max-w-[calc(100%-3rem)] items-start gap-1">
                              {hasGps ? (
                                <a
                                  href={googleMapsUrl(lat, lng)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Xaritada ochish"
                                  onClick={(e) => e.stopPropagation()}
                                  className={cn(
                                    'inline-flex min-w-0 items-start gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-sky-50 hover:text-sky-800',
                                    alert ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700',
                                  )}
                                >
                                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />
                                  <span className="text-[11px] font-semibold leading-snug tracking-wide underline decoration-slate-300 underline-offset-2">
                                    {label}
                                  </span>
                                </a>
                              ) : (
                                <div
                                  className={cn(
                                    'inline-flex min-w-0 items-start gap-1.5 rounded-lg px-2 py-1',
                                    alert ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700',
                                  )}
                                >
                                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" />
                                  <span className="text-[11px] font-semibold leading-snug tracking-wide">
                                    {label}
                                  </span>
                                </div>
                              )}
                              {canSetBranchGps ? (
                                <button
                                  type="button"
                                  className="mt-1 shrink-0 text-slate-400 hover:text-primary"
                                  title="Koordinatani o‘zgartirish"
                                  onClick={() => {
                                    setGpsEditingId(manager.id);
                                    setGpsDraft((prev) => ({
                                      ...prev,
                                      [manager.id]:
                                        prev[manager.id] || (hasGps ? `${lat}, ${lng}` : ''),
                                    }));
                                  }}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              ) : null}
                            </div>
                          );
                        })()}
                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                              alert ? 'bg-red-100 text-red-700' : 'bg-slate-50 text-slate-500',
                            )}
                            title={`${fullTeam.length} ta xodim`}
                          >
                            <Users className="h-3 w-3" />
                            {fullTeam.length}
                          </span>
                          {(canEditShift || canEditStatus) && (
                            <button
                              type="button"
                              onClick={(e) => openEditor(manager, e)}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-primary"
                              title="Holatni o'zgartirish"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex min-w-0 items-start gap-3">
                        <div
                          className={cn(
                            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white',
                            alert ? 'bg-red-600' : 'bg-slate-700',
                          )}
                        >
                          {initials(manager.fullName)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-snug text-slate-900">
                            {manager.fullName}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">Mudir (zav.aptek)</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span
                              className={cn(
                                'inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                                alert
                                  ? 'bg-red-100 text-red-800 ring-red-300'
                                  : manager.shiftType === 'two'
                                    ? 'bg-teal-50 text-teal-700 ring-teal-200'
                                    : manager.shiftType === 'custom'
                                      ? 'bg-amber-50 text-amber-800 ring-amber-200'
                                      : 'bg-sky-50 text-sky-700 ring-sky-200',
                              )}
                            >
                              {shiftText(manager.shiftType, manager.shiftLabel)}
                            </span>
                            <span
                              className={cn(
                                'inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                                empStatus(manager) === 'working'
                                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                  : empStatus(manager) === 'searching'
                                    ? 'bg-violet-100 text-violet-800 ring-violet-300'
                                    : empStatus(manager) === 'dismissed'
                                      ? 'bg-red-100 text-red-800 ring-red-300'
                                      : empStatus(manager) === 'new'
                                        ? 'bg-sky-50 text-sky-700 ring-sky-200'
                                        : 'bg-orange-100 text-orange-800 ring-orange-300',
                              )}
                            >
                              {EMPLOYMENT_STATUS_LABELS[empStatus(manager)]}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleBranch(manager.id)}
                        className={cn(
                          'mt-auto flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors',
                          open
                            ? 'bg-primary text-primary-foreground'
                            : alert
                              ? 'bg-red-100 text-red-700 hover:bg-red-200'
                              : 'bg-slate-50 text-slate-700 hover:bg-slate-100',
                        )}
                      >
                        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {open ? 'Yopish' : 'Batafsil'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Holat — {editTarget?.fullName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {canEditStatus && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Xodim holati</p>
                <Select
                  value={employmentStatus}
                  onValueChange={(v) => setEmploymentStatus(v as EmploymentStatus)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="working">Ishlamoqda</SelectItem>
                    <SelectItem value="new">Yangi</SelectItem>
                    <SelectItem value="dismissed">Bo'shatilgan</SelectItem>
                    <SelectItem value="need_hire">Xodim kerak</SelectItem>
                    <SelectItem value="searching">Qidirilmoqda</SelectItem>
                  </SelectContent>
                </Select>
                {employmentStatus !== 'working' && (
                  <p className="text-xs text-red-600">
                    Bu holat filialni qizil qiladi va ogohlantirish yuboradi.
                  </p>
                )}
              </div>
            )}
            {canEditShift && editTarget?.orgRole !== 'coordinator' && (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Smena</p>
                  <Select value={shiftType} onValueChange={(v) => setShiftType(v as ShiftType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="one">1-smena</SelectItem>
                      <SelectItem value="two">2-smena</SelectItem>
                      <SelectItem value="custom">Mudir belgilagan holat</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {shiftType === 'custom' && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Maxsus smena</p>
                    <Input
                      value={shiftLabel}
                      onChange={(e) => setShiftLabel(e.target.value)}
                      placeholder="Masalan: Navbatchi..."
                    />
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTarget(null)}>Bekor qilish</Button>
            <Button onClick={saveEditor} disabled={isPending}>Saqlash</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {canAddMudir ? 'Yangi mudir' : 'Yangi xodim'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ism</Label>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Dilnoza"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Familiya</Label>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Xushboqova"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Telefon raqam</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+998 90 123 45 67"
              />
            </div>
            {canAddMudir ? (
              <>
                <div className="space-y-1.5">
                  <Label>Rol</Label>
                  <Select value="mudir" disabled>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mudir">Mudir</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Filial koordinatasi</Label>
                  <Input
                    value={branchLocation}
                    onChange={(e) => setBranchLocation(e.target.value)}
                    placeholder={`41°18'23.3"N 69°18'28.0"E`}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Google Maps dan nusxa — tizim lokatsiya nomini o‘zi topadi.
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label>Rol</Label>
                <Select
                  value={staffRole}
                  onValueChange={(v) => setStaffRole(v as PharmacyStaffRole)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="farmasevt">Farmasevt</SelectItem>
                    <SelectItem value="stajyor">Stajyor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Yaratilgach tizim avtomatik login va parol beradi.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Bekor
            </Button>
            <Button onClick={handleCreateStaff} disabled={createStaff.isPending}>
              {createStaff.isPending ? 'Yaratilmoqda...' : 'Yaratish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdCreds} onOpenChange={(o) => !o && setCreatedCreds(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Login va parol</DialogTitle>
          </DialogHeader>
          {createdCreds && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{createdCreds.fullName}</span>
                {' · '}
                {createdCreds.role}
              </p>
              <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] uppercase text-slate-500">Login</p>
                    <p className="font-mono text-sm font-semibold">{createdCreds.login}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => void copyText(createdCreds.login, 'Login')}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] uppercase text-slate-500">Parol</p>
                    <p className="font-mono text-sm font-semibold">
                      {showPwd ? createdCreds.temporaryPassword : '••••••••'}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowPwd((v) => !v)}
                    >
                      {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void copyText(createdCreds.temporaryPassword, 'Parol')
                      }
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() =>
                  void copyText(
                    `Login: ${createdCreds.login}\nParol: ${createdCreds.temporaryPassword}`,
                    'Login/parol',
                  )
                }
              >
                Hammasini nusxalash
              </Button>
              <p className="text-xs text-amber-700">
                Parolni hozir saqlang — keyin ko‘rinmaydi.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreatedCreds(null)}>Yopish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
