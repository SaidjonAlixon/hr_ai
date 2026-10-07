import React, { useMemo, useState } from "react";
import {
  useGetDepartments,
  useGetUsers,
  useCreateDepartment,
  useUpdateDepartment,
  useDeleteDepartment,
  getGetDepartmentsQueryKey,
  type Department,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  Crown,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Skeleton } from "../../components/ui/skeleton";
import { useToast } from "../../hooks/use-toast";
import { useAuth } from "../../contexts/AuthContext";
import { isHrManager, isDirectorRole } from "../../lib/roles";
import { useI18n } from "../../i18n/I18nProvider";
import { cn } from "../../lib/utils";
import {
  DEFAULT_DEPARTMENT_TITLES,
  TITLE_SUGGESTIONS,
  invalidateDepartmentTitles,
  useAddDepartmentTitle,
  useDepartmentTitles,
  useRemoveDepartmentTitle,
  useUpdateDepartmentTitle,
  type DepartmentJobTitle,
} from "../../lib/department-titles-api";

const TONES = [
  "from-sky-500 to-blue-600",
  "from-emerald-500 to-teal-600",
  "from-violet-500 to-indigo-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-sky-600",
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : parts[0]!.slice(0, 2)).toLocaleUpperCase("uz");
}

const isLeadTitle = (title: string) => /boshli[gq]/i.test(title.replace(/[ʻʼ'`´’‘]/g, ""));

function errMessage(err: unknown, fallback: string) {
  const e = err as { message?: string; data?: { error?: string } } | null;
  return e?.data?.error || e?.message || fallback;
}

function StatTile({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm dark:border-white/10 dark:bg-slate-900">
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm", tone)}>
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-xl font-bold tabular-nums leading-tight text-[#0f2744] dark:text-white">{value}</span>
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      </span>
    </div>
  );
}

function TitleRow({
  item,
  canManage,
  departmentId,
}: {
  item: DepartmentJobTitle;
  canManage: boolean;
  departmentId: number;
}) {
  const { toast } = useToast();
  const update = useUpdateDepartmentTitle();
  const remove = useRemoveDepartmentTitle();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.title);
  const lead = isLeadTitle(item.title);

  const save = () => {
    const title = value.trim();
    if (title.length < 2) {
      toast({ title: "Lavozim nomini kiriting", variant: "destructive" });
      return;
    }
    if (title === item.title) {
      setEditing(false);
      return;
    }
    update.mutate(
      { departmentId, id: item.id, title },
      {
        onSuccess: () => {
          toast({ title: "Lavozim yangilandi", description: title });
          setEditing(false);
        },
        onError: (e) => toast({ title: "Saqlanmadi", description: errMessage(e, "Xato"), variant: "destructive" }),
      },
    );
  };

  const toggleActive = () =>
    update.mutate(
      { departmentId, id: item.id, active: !item.active },
      {
        onSuccess: () => toast({ title: item.active ? "Lavozim yashirildi" : "Lavozim qayta ochildi", description: item.title }),
        onError: (e) => toast({ title: "Saqlanmadi", description: errMessage(e, "Xato"), variant: "destructive" }),
      },
    );

  const onRemove = () => {
    const msg = item.staffCount
      ? `«${item.title}» lavozimida ${item.staffCount} ta xodim bor. U o‘chirilmaydi, faqat yangi tanlovlardan yashiriladi. Davom etilsinmi?`
      : `«${item.title}» lavozimi o‘chirilsinmi?`;
    if (!window.confirm(msg)) return;
    remove.mutate(
      { departmentId, id: item.id },
      {
        onSuccess: (r) =>
          toast({
            title: r.deleted ? "Lavozim o‘chirildi" : "Lavozim yashirildi",
            description: r.deleted ? item.title : `${item.title} · ${r.staff ?? 0} ta xodim saqlanib qoldi`,
          }),
        onError: (e) => toast({ title: "O‘chirilmadi", description: errMessage(e, "Xato"), variant: "destructive" }),
      },
    );
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition",
        item.active
          ? "border-slate-200 bg-white hover:border-[#0b3a5c]/30 hover:shadow-sm dark:border-white/10 dark:bg-slate-950"
          : "border-dashed border-slate-200 bg-slate-50/60 opacity-70 dark:border-white/10 dark:bg-white/5",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          lead ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "bg-[#0b3a5c]/[0.07] text-[#0b3a5c] dark:bg-white/10 dark:text-sky-200",
        )}
      >
        {lead ? <Crown className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
      </span>
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input value={value} maxLength={80} autoFocus onChange={(e) => setValue(e.target.value)} className="h-9" />
          <Button type="submit" size="icon" className="h-9 w-9 shrink-0 bg-[#0b3a5c] hover:bg-[#0b3a5c]/90" disabled={update.isPending}>
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => { setEditing(false); setValue(item.title); }}>
            <X className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[#0f2744] dark:text-white">{item.title}</p>
            <p className="text-[11px] text-muted-foreground">
              {item.staffCount ? `${item.staffCount} ta xodim` : "Hozircha xodim yo‘q"}
              {!item.active ? " · yashirilgan" : ""}
            </p>
          </div>
          {item.staffCount ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              <UserRound className="h-3 w-3" />
              {item.staffCount}
            </span>
          ) : null}
          {canManage ? (
            <span className="flex shrink-0 items-center gap-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
              <button type="button" onClick={() => setEditing(true)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#0b3a5c] dark:hover:bg-white/10" title="Nomini o‘zgartirish">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={toggleActive} disabled={update.isPending} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-[#0b3a5c] dark:hover:bg-white/10" title={item.active ? "Yashirish" : "Qayta ochish"}>
                {item.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button type="button" onClick={onRemove} disabled={remove.isPending} className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10" title="O‘chirish">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

function TitlesPanel({
  department,
  titles,
  canManage,
}: {
  department: Department;
  titles: DepartmentJobTitle[];
  canManage: boolean;
}) {
  const { toast } = useToast();
  const add = useAddDepartmentTitle();
  const [value, setValue] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const active = titles.filter((t) => t.active);
  const hidden = titles.filter((t) => !t.active);
  const taken = new Set(titles.map((t) => t.title.toLocaleLowerCase("uz")));
  const suggestions = TITLE_SUGGESTIONS.filter((s) => !taken.has(s.toLocaleLowerCase("uz"))).slice(0, 5);
  const missingDefaults = DEFAULT_DEPARTMENT_TITLES.filter((d) => !taken.has(d.toLocaleLowerCase("uz")));

  const submit = (title: string) => {
    const clean = title.trim();
    if (clean.length < 2) {
      toast({ title: "Lavozim nomini kiriting", variant: "destructive" });
      return;
    }
    add.mutate(
      { departmentId: department.id, title: clean },
      {
        onSuccess: (r) => {
          toast({ title: r.reactivated ? "Lavozim qayta ochildi" : "Lavozim qo‘shildi", description: `${department.name} · ${clean}` });
          setValue("");
        },
        onError: (e) => toast({ title: "Qo‘shilmadi", description: errMessage(e, "Xato"), variant: "destructive" }),
      },
    );
  };

  const addDefaults = () =>
    add.mutate(
      { departmentId: department.id, defaults: true },
      {
        onSuccess: () => toast({ title: "Standart lavozimlar qo‘shildi", description: DEFAULT_DEPARTMENT_TITLES.join(", ") }),
        onError: (e) => toast({ title: "Qo‘shilmadi", description: errMessage(e, "Xato"), variant: "destructive" }),
      },
    );

  return (
    <div className="border-t border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-4 pb-4 pt-3 dark:border-white/10 dark:from-white/[0.03] dark:to-transparent sm:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <Briefcase className="h-3.5 w-3.5" /> Lavozimlar · {active.length}
        </p>
        {hidden.length ? (
          <button type="button" onClick={() => setShowHidden((v) => !v)} className="text-[11px] font-semibold text-slate-500 hover:text-[#0b3a5c]">
            {showHidden ? "Yashirilganlarni berkitish" : `Yashirilganlar (${hidden.length})`}
          </button>
        ) : null}
      </div>

      {active.length || (showHidden && hidden.length) ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {[...active, ...(showHidden ? hidden : [])].map((t) => (
            <TitleRow key={t.id} item={t} canManage={canManage} departmentId={department.id} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center dark:border-white/15">
          <Briefcase className="h-7 w-7 text-slate-300" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Bu bo‘limda hali lavozim yo‘q</p>
          <p className="text-xs text-muted-foreground">Standart lavozimlarni bir bosishda qo‘shing yoki o‘zingiz yozing.</p>
        </div>
      )}

      {canManage && missingDefaults.length ? (
        <button
          type="button"
          onClick={addDefaults}
          disabled={add.isPending}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Standart lavozimlar: {missingDefaults.join(", ")}
        </button>
      ) : null}

      {canManage ? (
        <form
          className="mt-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950"
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
        >
          <Label className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Yangi lavozim</Label>
          <div className="mt-1.5 flex gap-2">
            <Input value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} placeholder="Masalan: Bosh mutaxassis" className="h-10" />
            <Button type="submit" className="h-10 shrink-0 gap-1.5 bg-[#0b3a5c] hover:bg-[#0b3a5c]/90" disabled={add.isPending || value.trim().length < 2}>
              {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Qo‘shish
            </Button>
          </div>
          {suggestions.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-400">Tez tanlash:</span>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setValue(s)}
                  className={cn(
                    "h-7 rounded-full border px-2.5 text-[11px] font-semibold transition",
                    value === s
                      ? "border-[#0b3a5c] bg-[#0b3a5c] text-white"
                      : "border-slate-200 text-slate-600 hover:border-[#0b3a5c]/40 hover:text-[#0b3a5c] dark:border-white/10 dark:text-slate-300",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          <p className="mt-2 text-[11px] text-muted-foreground">Lavozim faqat shu bo‘limga ochiladi — boshliq tanlash shart emas.</p>
        </form>
      ) : null}
    </div>
  );
}

export default function AdminDepartmentsPage() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();

  const canManage = isHrManager(me?.role) || isDirectorRole(me?.role);

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<Department | null>(null);
  const [editName, setEditName] = useState("");
  const [headId, setHeadId] = useState<string>("none");
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);

  const { data: departments, isLoading } = useGetDepartments();
  const { data: users } = useGetUsers();
  const titlesQ = useDepartmentTitles();
  const createMutation = useCreateDepartment();
  const updateMutation = useUpdateDepartment();
  const deleteMutation = useDeleteDepartment();

  const titlesByDept = useMemo(() => {
    const map = new Map<number, DepartmentJobTitle[]>();
    for (const tt of titlesQ.data?.titles ?? []) {
      const list = map.get(tt.departmentId) ?? [];
      list.push(tt);
      map.set(tt.departmentId, list);
    }
    return map;
  }, [titlesQ.data]);
  const staffByDept = titlesQ.data?.staffByDepartment ?? {};

  const headCandidates = useMemo(
    () =>
      (users ?? [])
        .filter((u) => u.status === "active" && u.role !== "admin")
        .sort((a, b) => a.fullName.localeCompare(b.fullName, "uz")),
    [users],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("uz");
    const list = [...(departments ?? [])].sort((a, b) => a.name.localeCompare(b.name, "uz"));
    if (!q) return list;
    return list.filter(
      (d) =>
        d.name.toLocaleLowerCase("uz").includes(q) ||
        (d.headName || "").toLocaleLowerCase("uz").includes(q) ||
        (titlesByDept.get(d.id) ?? []).some((x) => x.title.toLocaleLowerCase("uz").includes(q)),
    );
  }, [departments, search, titlesByDept]);

  const totals = useMemo(() => {
    const all = titlesQ.data?.titles ?? [];
    return {
      departments: departments?.length ?? 0,
      titles: all.filter((x) => x.active).length,
      staff: Object.values(staffByDept).reduce((s, n) => s + Number(n || 0), 0),
    };
  }, [departments, titlesQ.data, staffByDept]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getGetDepartmentsQueryKey() });
    invalidateDepartmentTitles(qc);
  };

  const openCreate = () => {
    setNewName("");
    setCreateOpen(true);
  };

  const openEdit = (d: Department) => {
    setEditing(d);
    setEditName(d.name);
    setHeadId(d.headId != null ? String(d.headId) : "none");
  };

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim().replace(/\s+/g, " ");
    if (trimmed.length < 2) {
      toast({ title: "Bo‘lim nomini yozing", variant: "destructive" });
      return;
    }
    createMutation.mutate(
      { data: { name: trimmed } },
      {
        onSuccess: (dept) => {
          const created = (dept as Department & { jobTitles?: Array<{ title: string }> }).jobTitles ?? [];
          toast({
            title: `«${trimmed}» bo‘limi ochildi`,
            description: created.length
              ? `Lavozimlar avtomatik yaratildi: ${created.map((x) => x.title).join(", ")}`
              : "Lavozimlarni bo‘lim ichidan qo‘shing",
          });
          setCreateOpen(false);
          setExpanded(dept.id);
          invalidate();
        },
        onError: (err) => toast({ title: "Yaratilmadi", description: errMessage(err, "Xato"), variant: "destructive" }),
      },
    );
  };

  const onEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      toast({ title: "Bo‘lim nomini yozing", variant: "destructive" });
      return;
    }
    updateMutation.mutate(
      { id: editing.id, data: { name: trimmed, headId: headId === "none" ? null : Number(headId) } },
      {
        onSuccess: () => {
          toast({ title: "Saqlandi", description: `«${trimmed}» yangilandi` });
          setEditing(null);
          invalidate();
        },
        onError: (err) => toast({ title: "Saqlanmadi", description: errMessage(err, "Xato"), variant: "destructive" }),
      },
    );
  };

  const onDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          toast({ title: "O‘chirildi", description: `«${deleteTarget.name}»` });
          setDeleteTarget(null);
          invalidate();
        },
        onError: (err) =>
          toast({ title: "O‘chirilmadi", description: errMessage(err, "Bo‘limda xodim yoki ariza bo‘lishi mumkin"), variant: "destructive" }),
      },
    );
  };

  const previewName = newName.trim();

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="overflow-hidden rounded-3xl bg-[#0b3a5c] text-white shadow-lg">
        <div className="relative px-5 py-6 sm:px-7">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/[0.06]" />
          <div className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-sky-400/10" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-200/80">Tashkiliy tuzilma</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{t("admin.departments")}</h1>
              <p className="mt-1 max-w-xl text-sm text-white/75">Bo‘limlar, ularning boshliqlari va lavozimlari. Yangi bo‘lim ochilganda asosiy lavozimlar o‘zi yaratiladi.</p>
            </div>
            {canManage ? (
              <Button onClick={openCreate} className="h-11 gap-2 rounded-xl bg-white px-5 font-semibold text-[#0b3a5c] shadow-md hover:bg-sky-50">
                <Plus className="h-4 w-4" />
                {t("admin.newDept")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile icon={Building2} label="Bo‘limlar" value={totals.departments} tone="bg-gradient-to-br from-sky-500 to-blue-600" />
        <StatTile icon={Briefcase} label="Lavozimlar" value={totals.titles} tone="bg-gradient-to-br from-violet-500 to-indigo-600" />
        <StatTile icon={Users} label="Xodimlar" value={totals.staff} tone="bg-gradient-to-br from-emerald-500 to-teal-600" />
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-sm font-semibold text-[#0f2744] dark:text-white">
            Ro‘yxat <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-600 dark:bg-white/10 dark:text-slate-300">{filtered.length}</span>
          </p>
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="h-10 rounded-xl pl-9" placeholder="Bo‘lim, boshliq yoki lavozim…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center text-muted-foreground">
            <Building2 className="h-10 w-10 opacity-40" />
            <p className="font-semibold">{search ? "Hech narsa topilmadi" : t("admin.deptEmpty")}</p>
            {canManage && !search ? (
              <Button variant="outline" size="sm" onClick={openCreate}>
                {t("admin.deptAddFirst")}
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/10">
            {filtered.map((d, idx) => {
              const titles = titlesByDept.get(d.id) ?? [];
              const activeTitles = titles.filter((x) => x.active);
              const staff = Number(staffByDept[String(d.id)] ?? 0);
              const open = expanded === d.id;
              return (
                <li key={d.id} className={cn("transition", open && "bg-slate-50/40 dark:bg-white/[0.02]")}>
                  <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : d.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      aria-expanded={open}
                    >
                      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-sm", TONES[idx % TONES.length])}>
                        {initials(d.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-[#0f2744] dark:text-white">{d.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Crown className="h-3 w-3 text-amber-500" />
                            {d.headName ? <span className="text-slate-700 dark:text-slate-200">{d.headName}</span> : <span className="italic">Boshliq belgilanmagan</span>}
                          </span>
                          <span className="hidden text-slate-300 sm:inline">•</span>
                          <span className="inline-flex items-center gap-1">
                            <Briefcase className="h-3 w-3" /> {activeTitles.length} lavozim
                          </span>
                          <span className="text-slate-300">•</span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3" /> {staff} xodim
                          </span>
                        </span>
                      </span>
                      <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
                    </button>
                    {canManage ? (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => openEdit(d)} title="Tahrirlash">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => setDeleteTarget(d)} title="O‘chirish">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {open ? <TitlesPanel department={d} titles={titles} canManage={canManage} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent hideClose className="gap-0 overflow-hidden p-0 sm:max-w-lg">
          <div className="relative bg-[#0b3a5c] px-6 py-5 text-white">
            <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/[0.07]" />
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                  <Building2 className="h-5 w-5" />
                </span>
                <div>
                  <DialogTitle className="text-lg font-semibold text-white">{t("admin.newDept")}</DialogTitle>
                  <p className="text-xs text-white/70">Faqat nomini yozing — qolganini tizim tayyorlaydi</p>
                </div>
              </div>
              <button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Yopish">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <form onSubmit={onCreate} className="space-y-5 px-6 py-5">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Bo‘lim nomi</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Masalan: Sotuv bo‘limi"
                maxLength={80}
                autoFocus
                className="h-12 rounded-xl text-base"
              />
            </div>
            <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/60 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/5">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                <Sparkles className="h-4 w-4" /> Avtomatik yaratiladigan lavozimlar
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {DEFAULT_DEPARTMENT_TITLES.map((title) => (
                  <div key={title} className="flex items-center gap-2.5 rounded-xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-emerald-100 dark:bg-slate-950 dark:ring-white/10">
                    <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", isLeadTitle(title) ? "bg-amber-100 text-amber-700" : "bg-[#0b3a5c]/[0.08] text-[#0b3a5c] dark:text-sky-200")}>
                      {isLeadTitle(title) ? <Crown className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[#0f2744] dark:text-white">{title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{previewName || "Yangi bo‘lim"}</span>
                    </span>
                    <Check className="ml-auto h-4 w-4 shrink-0 text-emerald-600" />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-emerald-800/80 dark:text-emerald-200/70">
                Boshqa lavozimlarni keyin bo‘lim ichidan qo‘shasiz. Bo‘lim boshlig‘ini xohlagan payt «Tahrirlash» orqali tayinlaysiz.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                {t("ui.cancel")}
              </Button>
              <Button type="submit" className="min-w-[140px] gap-1.5 bg-[#0b3a5c] hover:bg-[#0b3a5c]/90" disabled={createMutation.isPending || newName.trim().length < 2}>
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Bo‘lim ochish
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>{t("admin.editDept")}</DialogTitle>
          <form onSubmit={onEdit} className="space-y-4">
            <div className="space-y-2">
              <Label>Bo‘lim nomi</Label>
              <Input value={editName} maxLength={80} onChange={(e) => setEditName(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-2">
              <Label>Bo‘lim boshlig‘i (ixtiyoriy)</Label>
              <Select value={headId} onValueChange={setHeadId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Tanlang" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Belgilanmagan</SelectItem>
                  {headCandidates.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {t("ui.cancel")}
              </Button>
              <Button type="submit" className="gap-1.5 bg-[#0b3a5c] hover:bg-[#0b3a5c]/90" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t("ui.save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.dept.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleteTarget?.name}» va uning lavozimlari o‘chiriladi. Bo‘limga bog‘langan xodim yoki ariza bo‘lsa, o‘chirilmaydi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("ui.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-rose-600 hover:bg-rose-700">
              O‘chirish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
