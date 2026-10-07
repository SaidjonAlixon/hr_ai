import React, { useEffect, useMemo, useState } from 'react';
import {
  useGetUsers,
  useGetDepartments,
  useCreateUser,
  useUpdateUser,
  getGetUsersQueryKey,
  type User,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { VerifiedName } from '@/components/VerifiedBadge';
import { Plus, Search, Copy, Check, ChevronDown, Eye, EyeOff, Trash2, UserPlus, UserX, FileSpreadsheet, Loader2, Pencil, KeyRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Checkbox } from '../../components/ui/checkbox';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useToast } from '../../hooks/use-toast';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/utils';
import { PhoneInput } from '../../components/ui/phone-input';
import {
  isOptionalUzPhoneValid,
  normalizeUzPhone,
  UZ_PHONE_HINT,
} from '../../lib/phone';
import { userRoleLabel, canManageUsers, canDeleteUsers, canChangeStaffStatus, isLimitedOfficeStaffRole, isReviziyaRole, isStajyor } from '../../lib/roles';
import { useI18n } from '../../i18n/I18nProvider';
import { dismissUser } from '../../lib/dismissed-staff-api';
import { Link, useLocation } from 'wouter';

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'hr_direktor', label: 'HR Direktor' },
  { value: 'hr_kadr_rahbar', label: 'HR kadr b/m' },
  { value: 'hr_auditor', label: 'HR Auditor' },
  { value: 'hr_menejer', label: 'HR Menejer' },
  { value: 'recruiter', label: 'Rekruter' },
  { value: 'trainer', label: 'Trener' },
  { value: 'director', label: 'Direktor' },
  { value: 'asoschi', label: 'Asoschi' },
  { value: 'mudir', label: 'Mudir' },
  { value: 'koordinator', label: 'Koordinator' },
  { value: 'it_rahbar', label: 'AyTi bo‘lim boshlig‘i' },
  { value: 'it', label: 'AyTi mutaxassisi' },
  { value: 'it_dasturchi', label: 'Dasturchi' },
  { value: 'it_tarmoq', label: 'Tarmoq administratori' },
  { value: 'ombor', label: 'Omborxona xodimi' },
  { value: 'ombor_rahbar', label: 'Omborxona bo‘lim boshlig‘i' },
  { value: 'sb', label: 'SB operatori' },
  { value: 'sb_boshliq', label: "SB bo‘limi boshlig‘i" },
  { value: 'farmasevt', label: 'Farmasevt' },
  { value: 'stajyor', label: 'Stajyor' },
  { value: 'moliya', label: 'Moliyachi' },
  { value: 'moliya_rahbar', label: 'Moliya bo‘lim boshlig‘i' },
  { value: 'moliya_xodim', label: 'Moliya xodimi' },
  { value: 'taminot_rahbar', label: 'Ta’minot bo‘lim boshlig‘i' },
  { value: 'taminot', label: 'Ta’minot xodimi' },
  { value: 'rivojlantirish_rahbar', label: 'Rivojlantirish bo‘lim boshlig‘i' },
  { value: 'rivojlantirish', label: 'Rivojlantirish xodimi' },
  { value: 'mamuriy_rahbar', label: 'Ma’muriy-xo‘jalik bo‘lim boshlig‘i' },
  { value: 'mamuriy', label: 'Ma’muriy-xo‘jalik xodimi' },
  { value: 'gpp_rahbar', label: 'GPP bo‘lim boshlig‘i' },
  { value: 'gpp', label: 'GPP xodimi' },
  { value: 'oshpaz_rahbar', label: 'Oshpaz bo‘lim boshlig‘i' },
  { value: 'oshpaz', label: 'Oshpaz' },
  { value: 'marketing_rahbar', label: 'Marketing bo‘lim boshlig‘i' },
  { value: 'marketing', label: 'Marketing xodimi' },
  { value: 'revizor', label: 'Revizor-yig‘uvchi (Reviziya)' },
  { value: 'reviziya_rahbar', label: 'Reviziya bo‘limi rahbari' },
  { value: 'distrib_rahbar', label: 'Distribyutsiya rahbari' },
  { value: 'distrib_hr', label: 'Distribyutsiya HR' },
  { value: 'distrib', label: 'Distribyutsiya xodimi' },
  { value: 'tamojni_rahbar', label: 'Tamojni sklad bo‘lim boshlig‘i' },
  { value: 'tamojni', label: 'Tamojni sklad xodimi' },
  { value: 'kassir', label: 'Kassir' },
  { value: 'yurist', label: 'Yurist' },
  { value: 'komunalniy', label: 'Kommunal' },
  { value: 'farrosh', label: 'Farrosh' },
  { value: 'mexanik', label: 'Mexanik' },
  { value: 'direktor_yordamchisi', label: 'Direktor yordamchisi' },
] as const;

/** Rol qaysi bo‘limga tegishli. Yangi foydalanuvchida bo‘lim tanlansa shu rol qo‘yiladi. */
const ROLE_DEPARTMENT: Record<string, string> = {
  admin: "Rahbariyat",
  director: "Rahbariyat",
  asoschi: "Rahbariyat",
  moliya: "Rahbariyat",
  moliya_rahbar: "Moliya",
  moliya_xodim: "Moliya",
  taminot_rahbar: "Ta’minot",
  taminot: "Ta’minot",
  rivojlantirish_rahbar: "Rivojlantirish",
  rivojlantirish: "Rivojlantirish",
  mamuriy_rahbar: "Ma’muriy-xo‘jalik",
  mamuriy: "Ma’muriy-xo‘jalik",
  gpp_rahbar: "GPP",
  gpp: "GPP",
  ombor_rahbar: "Omborxona",
  oshpaz_rahbar: "Oshpaz",
  oshpaz: "Oshpaz",
  marketing_rahbar: "Marketing",
  marketing: "Marketing",
  mudir: "Farmasevt",
  farmasevt: "Farmasevt",
  stajyor: "Farmasevt",
  kassir: "Moliya",
  yurist: "Rahbariyat",
  komunalniy: "Ma’muriy-xo‘jalik",
  farrosh: "Farrosh",
  mexanik: "Mexanik",
  direktor_yordamchisi: "Rahbariyat",
  hr: "HR",
  hr_direktor: "HR",
  hr_kadr_rahbar: "HR",
  hr_menejer: "HR",
  hr_auditor: "HR",
  recruiter: "Rekruting",
  trainer: "Trening",
  koordinator: "Koordinator",
  it: "AyTi",
  it_rahbar: "AyTi",
  it_dasturchi: "AyTi",
  it_tarmoq: "AyTi",
  revizor: "Reviziya",
  reviziya_rahbar: "Reviziya",
  sb: "Xavfsizlik",
  sb_boshliq: "Xavfsizlik",
  ombor: "Omborxona",
  distrib_rahbar: "Distribyutsiya",
  distrib_hr: "Distribyutsiya",
  distrib: "Distribyutsiya",
  tamojni_rahbar: "Tamojni sklad",
  tamojni: "Tamojni sklad",
};

const DEPT_DEFAULT_ROLE: Record<string, string> = {
  farmasevt: "farmasevt",
  hr: "hr_menejer",
  rekruting: "recruiter",
  trening: "trainer",
  rahbariyat: "director",
  koordinator: "koordinator",
  ayti: "it",
  "ta'minot": "taminot",
  moliya: "moliya_xodim",
  rivojlantirish: "rivojlantirish",
  "ma'muriy-xo'jalik": "mamuriy",
  gpp: "gpp",
  omborxona: "ombor",
  oshpaz: "oshpaz",
  marketing: "marketing",
  reviziya: "revizor",
  xavfsizlik: "sb",
  distribyutsiya: "distrib",
  farrosh: "farrosh",
  mexanik: "mexanik",
};

function normDept(name: string) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("uz")
    .replace(/[\u2018\u2019\u02BB\u02BC'`]/g, "'");
}

function rolesForDepartment(name: string) {
  const key = normDept(name);
  return ROLES.map((r) => r.value).filter((role) => normDept(ROLE_DEPARTMENT[role] || "") === key);
}

function primaryRoleForDepartment(name: string): string | null {
  const roles = rolesForDepartment(name);
  const key = normDept(name);
  const byLabel = ROLES.find((r) => normDept(r.label) === key)?.value;
  if (byLabel && (roles.length === 0 || roles.includes(byLabel))) return byLabel;
  if (roles.length === 1) return roles[0]!;
  const preferred = DEPT_DEFAULT_ROLE[key];
  if (preferred && roles.includes(preferred)) return preferred;
  const worker = roles.find((r) => !/rahbar|boshliq|direktor|admin|asoschi/.test(r));
  return worker || roles[0] || null;
}

const STATUSES = [
  { value: 'active', labelKey: 'admin.status.active' },
  { value: 'vacant', labelKey: 'admin.status.idle' },
  { value: 'terminated', labelKey: 'admin.status.terminated' },
  { value: 'on_leave', labelKey: 'admin.status.leave' },
] as const;

type UserStatusValue = (typeof STATUSES)[number]['value'];

function normalizeUserStatus(status?: string | null) {
  if (status === 'inactive' || status === 'blocked') return 'vacant';
  if (STATUSES.some((s) => s.value === status)) return status as UserStatusValue;
  return 'active';
}

function statusLabelKey(status?: string | null) {
  const key = normalizeUserStatus(status);
  return STATUSES.find((s) => s.value === key)?.labelKey || 'admin.status.active';
}

function statusClass(status?: string | null) {
  const key = normalizeUserStatus(status);
  if (key === 'active') return 'bg-emerald-100 text-emerald-800';
  if (key === 'on_leave') return 'bg-amber-100 text-amber-900';
  if (key === 'terminated') return 'bg-rose-100 text-rose-800';
  return 'bg-slate-100 text-foreground';
}

type CreatedCredentials = {
  fullName: string;
  role: string;
  login: string;
  temporaryPassword: string;
};

function homeForRole(role?: string | null) {
  if (isStajyor(role)) return '/kirish';
  if (isLimitedOfficeStaffRole(role)) return '/vazifalar';
  if (role === 'it_rahbar') return '/it';
  if (isReviziyaRole(role)) return '/reviziya';
  return '/dashboard';
}

export default function AdminUsersPage() {
  const { user: me, switchToUser } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  /** Bo‘sh = barcha holatlar; belgilanganlar = faqat shular */
  const [statusFilter, setStatusFilter] = useState<UserStatusValue[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [credsOpen, setCredsOpen] = useState(false);
  const [created, setCreated] = useState<CreatedCredentials | null>(null);
  const [showPwd, setShowPwd] = useState(true);
  const [copied, setCopied] = useState<'login' | 'password' | 'both' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [enteringId, setEnteringId] = useState<number | null>(null);

  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('');
  const [rolePick, setRolePick] = useState('');
  const [phone, setPhone] = useState('');
  const [departmentId, setDepartmentId] = useState<string>('none');
  const [status, setStatus] = useState('active');

  const { data: users, isLoading } = useGetUsers({
    search: search || undefined,
    role: roleFilter !== 'all' ? roleFilter : undefined,
  });
  const { data: departments, refetch: refetchDepartments } = useGetDepartments();
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const [dismissTarget, setDismissTarget] = useState<User | null>(null);
  const [dismissReason, setDismissReason] = useState('');
  const [dismissing, setDismissing] = useState(false);

  const deptChoices = useMemo(
    () => [...(departments ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'uz')),
    [departments],
  );

  useEffect(() => {
    if (createOpen || editOpen) void refetchDepartments();
  }, [createOpen, editOpen, refetchDepartments]);

  function applyDepartment(id: string) {
    setDepartmentId(id);
    if (id === 'none') return;
    const dept = deptChoices.find((d) => String(d.id) === id);
    const next = dept ? primaryRoleForDepartment(dept.name) : null;
    if (next) {
      setRole(next);
      setRolePick(next);
      return;
    }
    setRole('');
    setRolePick(`dept:${id}`);
  }

  function onCreateRole(value: string) {
    if (value.startsWith('dept:')) {
      applyDepartment(value.slice(5));
      return;
    }
    setRolePick(value);
    setRole(value);
    const deptName = ROLE_DEPARTMENT[value];
    if (!deptName) return;
    const hit = deptChoices.find((d) => normDept(d.name) === normDept(deptName));
    if (!hit) return;
    const current = deptChoices.find((d) => String(d.id) === departmentId);
    const currentIsKnown = current ? rolesForDepartment(current.name).length > 0 : false;
    if (departmentId === 'none' || currentIsKnown) setDepartmentId(String(hit.id));
  }

  const canManage = canManageUsers(me?.role);
  const canChangeStatus = canChangeStaffStatus(me?.role);
  const canDelete = canDeleteUsers(me?.role);
  const isAdmin = canManage;

  const sorted = useMemo(() => {
    let list = [...(users ?? [])];
    if (statusFilter.length > 0) {
      const allowed = new Set(statusFilter);
      list = list.filter((u) => allowed.has(normalizeUserStatus(u.status)));
    }
    return list.sort((a, b) => a.fullName.localeCompare(b.fullName, 'uz'));
  }, [users, statusFilter]);

  const statusFilterLabel = useMemo(() => {
    if (statusFilter.length === 0 || statusFilter.length === STATUSES.length) {
      return t("admin.allStatuses");
    }
    if (statusFilter.length === 1) {
      const key = STATUSES.find((s) => s.value === statusFilter[0])?.labelKey;
      return key ? t(key) : t("admin.col.status");
    }
    return `${statusFilter.length}`;
  }, [statusFilter, t]);

  const toggleStatusFilter = (value: UserStatusValue, checked: boolean) => {
    setStatusFilter((prev) => {
      if (checked) {
        if (prev.includes(value)) return prev;
        return [...prev, value];
      }
      return prev.filter((s) => s !== value);
    });
  };

  const onExportExcel = async () => {
    if (!isAdmin || exporting) return;
    setExporting(true);
    try {
      const res = await fetch('/api/users/export', { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || 'Excel yuklanmadi');
      }
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 10);
      const { deliverFile } = await import('../../lib/tg-download');
      const result = await deliverFile(blob, `foydalanuvchilar_${stamp}.xlsx`);
      toast({
        title: result.via === 'telegram' ? 'Telegramga yuborildi' : 'Excel yuklandi',
        description:
          result.via === 'telegram'
            ? 'Fayl bot chatiga yuborildi'
            : 'Login va parollar bilan to‘liq ro‘yxat',
      });
    } catch (err: any) {
      toast({
        title: 'Xatolik',
        description: err?.message || 'Export amalga oshmadi',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  const resetForm = () => {
    setFullName('');
    setRole('');
    setRolePick('');
    setPhone('');
    setDepartmentId('none');
    setStatus('active');
    setEditing(null);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setFullName(u.fullName);
    // Eski «hr» roli ro‘yxatdan olib tashlangan — tahrirda HR Menejer
    setRole(u.role === 'hr' ? 'hr_menejer' : u.role);
    setRolePick(u.role === 'hr' ? 'hr_menejer' : u.role);
    setPhone(u.phone || '');
    setDepartmentId(u.departmentId != null ? String(u.departmentId) : 'none');
    setStatus(normalizeUserStatus(u.status));
    setEditOpen(true);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetUsersQueryKey() });
  };

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      toast({ title: 'Ruxsat yo‘q', description: 'Faqat admin yaratishi mumkin', variant: 'destructive' });
      return;
    }
    if (!fullName.trim() || fullName.trim().split(/\s+/).length < 2) {
      toast({ title: 'Xatolik', description: 'Ism va familiyani to‘liq yozing', variant: 'destructive' });
      return;
    }
    if (!role) {
      const deptName = deptChoices.find((d) => String(d.id) === departmentId)?.name;
      toast({
        title: 'Rol tanlanmagan',
        description: deptName
          ? `«${deptName}» bo‘limi saqlanadi. Shu bo‘limga mos rolni tanlang — Rekruter avtomatik yozilmaydi.`
          : 'Rol yoki bo‘limni tanlang',
        variant: 'destructive',
      });
      return;
    }
    if (!isOptionalUzPhoneValid(phone)) {
      toast({
        title: 'Telefon noto‘g‘ri',
        description: UZ_PHONE_HINT,
        variant: 'destructive',
      });
      return;
    }

    createMutation.mutate(
      {
        data: {
          fullName: fullName.trim(),
          role,
          phone: normalizeUzPhone(phone) || undefined,
          departmentId: departmentId === 'none' ? null : Number(departmentId),
        } as any,
      },
      {
        onSuccess: (data: any) => {
          invalidate();
          setCreateOpen(false);
          resetForm();
          setCreated({
            fullName: data.fullName,
            role: data.role,
            login: data.login,
            temporaryPassword: data.temporaryPassword || '',
          });
          setShowPwd(true);
          setCopied(null);
          setCredsOpen(true);
          toast({ title: 'Yaratildi', description: 'Login va parol tayyor' });
        },
        onError: (err: any) => {
          toast({
            title: 'Xatolik',
            description: err?.message || 'Foydalanuvchi yaratilmadi',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const onUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !editing) return;
    if (!fullName.trim() || fullName.trim().split(/\s+/).length < 2) {
      toast({ title: 'Xatolik', description: 'Ism va familiyani to‘liq yozing', variant: 'destructive' });
      return;
    }
    if (!role) {
      toast({ title: 'Xatolik', description: 'Rolni tanlang', variant: 'destructive' });
      return;
    }
    if (!isOptionalUzPhoneValid(phone)) {
      toast({
        title: 'Telefon noto‘g‘ri',
        description: UZ_PHONE_HINT,
        variant: 'destructive',
      });
      return;
    }
    if (
      status === 'terminated' &&
      normalizeUserStatus(editing.status) !== 'terminated' &&
      !window.confirm(
        `${editing.fullName} «Bo‘shatilganlar»ga o‘tadi: login va parol bekor bo‘ladi, boshqa hech qayerda ko‘rinmaydi. Davom etasizmi?`,
      )
    ) {
      return;
    }

    updateMutation.mutate(
      {
        id: editing.id,
        data: {
          fullName: fullName.trim(),
          role,
          phone: normalizeUzPhone(phone) || null,
          departmentId: departmentId === 'none' ? null : Number(departmentId),
          status,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setEditOpen(false);
          resetForm();
          toast({ title: 'Saqlandi', description: 'Foydalanuvchi yangilandi' });
        },
        onError: (err: any) => {
          toast({
            title: 'Xatolik',
            description: err?.message || 'Saqlanmadi',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const copyText = async (text: string, kind: 'login' | 'password' | 'both') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      toast({ title: 'Nusxa olindi' });
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({ title: 'Nusxa olinmadi', variant: 'destructive' });
    }
  };

  const setUserStatus = (u: User, next: string) => {
    if (!canChangeStatus) return;
    if (u.id === me?.id && next !== 'active') {
      toast({ title: 'O‘zingizni faoldan chiqara olmaysiz', variant: 'destructive' });
      return;
    }
    const current = normalizeUserStatus(u.status);
    if (current === next) return;
    if (next === 'terminated') {
      // Tugatilgan = Bo‘shatilganlarga o‘tkazish (tasdiqlash oynasi bilan)
      onDelete(u);
      return;
    }
    updateMutation.mutate(
      { id: u.id, data: { status: next } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Holat yangilandi', description: t(statusLabelKey(next)) });
        },
        onError: (err: any) => {
          toast({ title: 'Xatolik', description: err?.message || 'Holat saqlanmadi', variant: 'destructive' });
        },
      },
    );
  };

  const enterAccount = async (u: User) => {
    if (!isAdmin || enteringId) return;
    const status = normalizeUserStatus(u.status);
    if (status !== 'active' && status !== 'on_leave') {
      toast({ title: 'Bu holatdagi akkauntga kirib bo‘lmaydi', variant: 'destructive' });
      return;
    }
    setEnteringId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}/enter`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Kirib bo‘lmadi');
      const next = (data as { user?: User }).user;
      if (!next) throw new Error('Profil ochilmadi');
      switchToUser(next);
      setLocation(homeForRole(next.role));
    } catch (err) {
      toast({ title: 'Akkaunt ochilmadi', description: (err as Error).message, variant: 'destructive' });
      setEnteringId(null);
    }
  };

  const onRegenerateLogin = async (u: User) => {
    if (!isAdmin) return;
    if (u.id === me?.id) {
      toast({ title: 'O‘zingizning loginni shu yerda yangilay olmaysiz', variant: 'destructive' });
      return;
    }
    const ok = window.confirm(
      `${u.fullName} uchun yangi login va parol yaratilsinmi?\nEski login/parol ishlamay qoladi.`,
    );
    if (!ok) return;
    setRegeneratingId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}/regenerate-login`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Yaratilmadi');
      }
      invalidate();
      setCreated({
        fullName: data.fullName,
        role: data.role,
        login: data.login,
        temporaryPassword: data.temporaryPassword || '',
      });
      setShowPwd(true);
      setCopied(null);
      setCredsOpen(true);
      toast({ title: 'Yangi login va parol', description: 'Foydalanuvchiga bering — eski kirish yopildi' });
    } catch (err: any) {
      toast({
        title: 'Xatolik',
        description: err?.message || 'Login/parol yaratilmadi',
        variant: 'destructive',
      });
    } finally {
      setRegeneratingId(null);
    }
  };

  const onDelete = (u: User) => {
    if (!canDelete) return;
    if (u.id === me?.id) {
      toast({ title: 'O‘zingizni o‘chira olmaysiz', variant: 'destructive' });
      return;
    }
    setDismissReason('');
    setDismissTarget(u);
  };

  const confirmDismiss = async (mode: 'archive' | 'purge') => {
    if (!dismissTarget || dismissing) return;
    if (mode === 'purge') {
      const ok = window.confirm(
        `${dismissTarget.fullName} hamma joydan o‘chadi: login, davomat, javob, darslik, atestatsiya va Bo‘shatilganlar. Qaytarib bo‘lmaydi. Davom etasizmi?`,
      );
      if (!ok) return;
    }
    setDismissing(true);
    try {
      await dismissUser(dismissTarget.id, dismissReason, mode);
      invalidate();
      void queryClient.invalidateQueries();
      toast({
        title: mode === 'purge' ? 'Butunlay o‘chirildi' : 'Bo‘shatilganlarga o‘tkazildi',
        description:
          mode === 'purge'
            ? `${dismissTarget.fullName} hech qayerda qolmadi`
            : `${dismissTarget.fullName} — faqat Bo‘shatilganlarda qoldi`,
      });
      setDismissTarget(null);
    } catch (err) {
      toast({
        title: 'Xatolik',
        description: (err as Error)?.message || 'O‘chirilmadi',
        variant: 'destructive',
      });
    } finally {
      setDismissing(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-bold">{t("admin.users")}</h1>
        <p className="mt-2 text-muted-foreground">{t("admin.restricted")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("admin.users")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("admin.usersSubtitle")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild type="button" variant="outline" className="gap-2">
            <Link href="/admin/boshatilganlar">
              <UserX className="h-4 w-4 text-rose-600" />
              Bo‘shatilganlar
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={exporting || !sorted.length}
            onClick={() => void onExportExcel()}
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
            )}
            {t("admin.excelExport")}
          </Button>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4" />
            {t("admin.newUser")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:flex-wrap">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("admin.searchName")}
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder={t("admin.col.role")} />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="all">{t("admin.allRoles")}</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={cn(
                'w-full justify-between font-normal sm:w-[200px]',
                statusFilter.length > 0 && statusFilter.length < STATUSES.length && 'border-primary/40 bg-primary/5',
              )}
            >
              <span className="truncate">{statusFilterLabel}</span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[220px] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">Holat bo‘yicha</p>
              {statusFilter.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setStatusFilter([])}
                >
                  Tozalash
                </button>
              )}
            </div>
            <div className="space-y-2">
              {STATUSES.map((s) => {
                const checked = statusFilter.includes(s.value);
                return (
                  <label
                    key={s.value}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleStatusFilter(s.value, v === true)}
                    />
                    <span className="text-sm">{t(s.labelKey)}</span>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Belgilangan holatlar ko‘rsatiladi. Hech narsa belgilanmasa — barchasi.
            </p>
          </PopoverContent>
        </Popover>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            {t("admin.listCount")} {sorted.length ? `(${sorted.length})` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("admin.col.user")}</th>
                  <th className="px-4 py-3 font-medium">{t("admin.col.role")}</th>
                  <th className="px-4 py-3 font-medium">{t("admin.col.login")}</th>
                  <th className="px-4 py-3 font-medium">{t("admin.col.dept")}</th>
                  <th className="px-4 py-3 font-medium">{t("admin.col.status")}</th>
                  <th className="px-4 py-3 font-medium text-right">{t("admin.col.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      {t("ui.loading")}
                    </td>
                  </tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      {t("ui.empty")}
                    </td>
                  </tr>
                ) : (
                  sorted.map((u) => (
                    <tr key={u.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <VerifiedName name={u.fullName} role={u.role} userId={u.id} className="flex font-medium" />
                        {u.phone && <div className="text-xs text-muted-foreground">{u.phone}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{userRoleLabel(u.role) || u.role}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{u.login}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.departmentName || '—'}</td>
                      <td className="px-4 py-3">
                        {canChangeStatus ? (
                          <Select
                            value={normalizeUserStatus(u.status)}
                            onValueChange={(v) => setUserStatus(u, v)}
                            disabled={u.id === me?.id}
                          >
                            <SelectTrigger
                              className={cn(
                                'h-8 w-[132px] rounded-full border-0 px-2.5 text-xs font-semibold shadow-none focus:ring-0',
                                statusClass(u.status),
                              )}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUSES.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                  {t(s.labelKey)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span
                            className={cn(
                              'inline-flex h-8 items-center rounded-full px-2.5 text-xs font-semibold',
                              statusClass(u.status),
                            )}
                          >
                            {t(statusLabelKey(u.status))}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void enterAccount(u)}
                            disabled={enteringId != null || (normalizeUserStatus(u.status) !== 'active' && normalizeUserStatus(u.status) !== 'on_leave')}
                            title="Shu akkauntga kirish"
                          >
                            {enteringId === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(u)}
                            title="Tahrirlash"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void onRegenerateLogin(u)}
                            disabled={u.id === me?.id || regeneratingId === u.id}
                            title="Yangi login va parol"
                          >
                            {regeneratingId === u.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <KeyRound className="h-4 w-4" />
                            )}
                          </Button>
                          {canDelete ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => onDelete(u)}
                              disabled={u.id === me?.id}
                              title="O‘chirish"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={Boolean(dismissTarget)} onOpenChange={(o) => !o && !dismissing && setDismissTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2">
              <UserX className="h-5 w-5 text-rose-600" />
              Foydalanuvchini o‘chirish
            </DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">{dismissTarget?.fullName}</span>{' '}
              <span className="font-mono text-xs">({dismissTarget?.login})</span>
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            <li>• Login va parol darhol bekor bo‘ladi, ochiq sessiyalar yopiladi</li>
            <li>• Face ID, passkey va Telegram bog‘lanishi o‘chiriladi</li>
            <li>• Xodimlar, davomat va boshqa ro‘yxatlardan olib tashlanadi</li>
            <li>• Bo‘shatish — faqat «Bo‘shatilganlar»da qoladi</li>
            <li>• Butunlay o‘chirish — hech qayerda qolmaydi, qaytarib bo‘lmaydi</li>
          </ul>
          <div className="space-y-1.5">
            <Label htmlFor="dismiss-reason" className="text-xs">Sabab (ixtiyoriy)</Label>
            <Input
              id="dismiss-reason"
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="Masalan: o‘z xohishi bilan ketdi"
              maxLength={500}
              disabled={dismissing}
            />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <Button variant="outline" onClick={() => setDismissTarget(null)} disabled={dismissing} className="w-full">
              Bekor qilish
            </Button>
            <Button
              variant="outline"
              onClick={() => void confirmDismiss('archive')}
              disabled={dismissing}
              className="w-full gap-2 border-rose-300 text-rose-700 hover:bg-rose-50"
            >
              {dismissing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
              Bo‘shatish — arxivda qoladi
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDismiss('purge')}
              disabled={dismissing}
              className="w-full gap-2"
            >
              {dismissing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Butunlay o‘chirish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b px-5 py-4 text-left">
            <DialogTitle>Yangi foydalanuvchi</DialogTitle>
            <DialogDescription>
              Ism-familiya va rolni tanlang — login va parol avtomatik beriladi.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreate} className="flex max-h-[min(70vh,32rem)] flex-col">
            <div className="space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="space-y-2">
                <Label htmlFor="create-fullName">Ism familiya *</Label>
                <Input
                  id="create-fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Masalan: Aziza Karimova"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Rol *</Label>
                <Select value={rolePick || undefined} onValueChange={onCreateRole}>
                  <SelectTrigger>
                    <SelectValue placeholder="Rol yoki bo‘lim" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[100] max-h-80">
                    {deptChoices.length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>Bo‘limlar</SelectLabel>
                        {deptChoices.map((d) => (
                          <SelectItem key={`dept-${d.id}`} value={`dept:${d.id}`}>{d.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Rollar</SelectLabel>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {role
                    ? `Rol: ${ROLES.find((r) => r.value === role)?.label || role}`
                    : "Bo‘limni tanlang — rol shu bo‘limga mos qo‘yiladi. Rekruter avtomatik yozilmaydi."}
                  {departmentId !== 'none'
                    ? ` · Bo‘lim: ${deptChoices.find((d) => String(d.id) === departmentId)?.name || ''}`
                    : ''}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Telefon (ixtiyoriy)</Label>
                <PhoneInput value={phone} onChange={setPhone} />
                <p className="text-xs text-muted-foreground">{UZ_PHONE_HINT}</p>
              </div>
              <div className="space-y-2">
                <Label>Bo‘lim (ixtiyoriy)</Label>
                <Select value={departmentId} onValueChange={applyDepartment}>
                  <SelectTrigger>
                    <SelectValue placeholder="Bo‘lim" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[100]">
                    <SelectItem value="none">Belgilanmagan</SelectItem>
                    {(deptChoices).map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="gap-2 border-t bg-muted/30 px-5 py-3 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Bekor qilish
              </Button>
              <Button type="submit" disabled={createMutation.isPending} className="gap-2">
                <Plus className="h-4 w-4" />
                {createMutation.isPending ? 'Yaratilmoqda...' : 'Yaratish'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b px-5 py-4 text-left">
            <DialogTitle>Foydalanuvchini tahrirlash</DialogTitle>
            <DialogDescription>
              {editing?.login ? (
                <>
                  Login: <span className="font-mono font-medium text-foreground">{editing.login}</span>
                </>
              ) : (
                'Ism, rol, telefon va bo‘limni o‘zgartiring.'
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onUpdate} className="flex max-h-[min(70vh,36rem)] flex-col">
            <div className="space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-fullName">Ism familiya *</Label>
                <Input
                  id="edit-fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Masalan: Aziza Karimova"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Rol *</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue placeholder="Rolni tanlang" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[100]">
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Telefon (ixtiyoriy)</Label>
                <PhoneInput value={phone} onChange={setPhone} />
                <p className="text-xs text-muted-foreground">{UZ_PHONE_HINT}</p>
              </div>
              <div className="space-y-2">
                <Label>Bo‘lim (ixtiyoriy)</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Bo‘lim" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[100]">
                    <SelectItem value="none">Belgilanmagan</SelectItem>
                    {(deptChoices).map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Holat</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Holat" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[100]">
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{t(s.labelKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="gap-2 border-t bg-muted/30 px-5 py-3 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
                Bekor qilish
              </Button>
              <Button type="submit" disabled={updateMutation.isPending} className="gap-2">
                <Pencil className="h-4 w-4" />
                {updateMutation.isPending ? 'Saqlanmoqda...' : 'Saqlash'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Credentials dialog */}
      <Dialog open={credsOpen} onOpenChange={setCredsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Yangi login va parol</DialogTitle>
            <DialogDescription>
              {created?.fullName} ({userRoleLabel(created?.role || '') || created?.role}) uchun
              kirish ma’lumotlari. Parol faqat hozir ko‘rsatiladi — foydalanuvchiga bering.
            </DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted p-3">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Login</div>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-sm font-semibold">{created.login}</code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1"
                    onClick={() => copyText(created.login, 'login')}
                  >
                    {copied === 'login' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Nusxa
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border bg-muted p-3">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Parol</div>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-sm font-semibold tracking-wide">
                    {showPwd ? created.temporaryPassword : '••••••••'}
                  </code>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setShowPwd((v) => !v)}
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      onClick={() => copyText(created.temporaryPassword, 'password')}
                    >
                      {copied === 'password' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      Nusxa
                    </Button>
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="w-full gap-2"
                onClick={() =>
                  copyText(
                    `Login: ${created.login}\nParol: ${created.temporaryPassword}`,
                    'both',
                  )
                }
              >
                {copied === 'both' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                Ikkalasini nusxalash
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCredsOpen(false)}>Yopish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
