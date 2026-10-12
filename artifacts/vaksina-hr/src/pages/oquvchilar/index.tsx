import { useMemo, useState } from "react";
import {
  Ban,
  BarChart3,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  GraduationCap,
  KeyRound,
  ListPlus,
  MoreVertical,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { canManageStudents, canManageKirishContent } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  downloadStudentResultsExcel,
  downloadStudentsExcel,
  useBulkCreateStudents,
  useCreateStudent,
  useDeleteStudent,
  useResetStudentPassword,
  useResetStudentProgress,
  useStudents,
  useUpdateStudent,
  type Student,
  type StudentCred,
} from "@/lib/oquvchilar-api";
import { GroupPicker } from "@/components/student/GroupPicker";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Boshlamagan", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  in_progress: { label: "O‘qimoqda", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  completed: { label: "Yakunlagan", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
};

type StatusFilter = "all" | "not_started" | "in_progress" | "completed" | "blocked";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function copyText(text: string, toast: ReturnType<typeof useToast>["toast"]) {
  void navigator.clipboard?.writeText(text).then(
    () => toast({ title: "Nusxa olindi", description: text.length > 60 ? undefined : text }),
    () => toast({ title: "Nusxa olinmadi", variant: "destructive" }),
  );
}

function credText(c: { fullName: string; login: string; password: string }) {
  return `${c.fullName}\nLogin: ${c.login}\nParol: ${c.password}\nSayt: ${window.location.origin}`;
}

function StatCard({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", tone)}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-emerald-500" : "bg-[#2AABEE]")}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

export default function OquvchilarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canManageStudents(user?.role);
  const roster = useStudents();
  const create = useCreateStudent();
  const bulk = useBulkCreateStudents();
  const update = useUpdateStudent();
  const resetPwd = useResetStudentPassword();
  const resetProgress = useResetStudentProgress();
  const remove = useDeleteStudent();

  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showPasswords, setShowPasswords] = useState(false);
  const [exporting, setExporting] = useState<"creds" | "results" | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const emptyForm = { lastName: "", firstName: "", phone: "+998 ", groupName: "", note: "" };
  const [form, setForm] = useState(emptyForm);
  const phoneDigits = form.phone.replace(/\D/g, "");
  const formValid = form.lastName.trim().length >= 2 && form.firstName.trim().length >= 2 && phoneDigits.length >= 12;
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkGroup, setBulkGroup] = useState("");
  const [creds, setCreds] = useState<{ title: string; list: StudentCred[]; errors?: Array<{ line: string; error: string }> } | null>(null);
  const [edit, setEdit] = useState<Student | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", phone: "", groupName: "", login: "", password: "", note: "" });
  const [detail, setDetail] = useState<Student | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "delete" | "progress"; student: Student } | null>(null);

  const data = roster.data;
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.items ?? []).filter((s) => {
      if (group && (s.groupName ?? "") !== group) return false;
      if (statusFilter === "blocked" && s.status === "active") return false;
      if (statusFilter !== "all" && statusFilter !== "blocked" && s.kirish.status !== statusFilter) return false;
      if (!needle) return true;
      return [s.fullName, s.login, s.phone, s.groupName].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [data, q, group, statusFilter]);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-bold">O‘quvchilar</h1>
        <p className="mt-2 text-muted-foreground">Bu bo‘lim faqat trenerlar uchun.</p>
      </div>
    );
  }

  const errToast = (err: unknown, fallback: string) =>
    toast({ title: "Xatolik", description: err instanceof Error ? err.message : fallback, variant: "destructive" });

  const onExport = async (kind: "creds" | "results") => {
    setExporting(kind);
    try {
      const r =
        kind === "creds"
          ? await downloadStudentsExcel(group || undefined)
          : await downloadStudentResultsExcel(group || undefined);
      toast({
        title: r.via === "telegram" ? "Telegramga yuborildi" : "Excel yuklandi",
        description: kind === "creds" ? "Login-parollar" : `Natijalar${group ? ` — ${group}` : ""}`,
      });
    } catch (err) {
      errToast(err, "Excel yuklanmadi");
    } finally {
      setExporting(null);
    }
  };

  const onAdd = () => {
    if (!formValid) {
      toast({ title: "Familiya, ism va telefonni to‘liq kiriting", variant: "destructive" });
      return;
    }
    create.mutate(
      {
        fullName: `${form.lastName.trim()} ${form.firstName.trim()}`,
        phone: `+${phoneDigits}`,
        groupName: form.groupName || undefined,
        note: form.note || undefined,
      },
      {
        onSuccess: (r) => {
          setAddOpen(false);
          setForm({ ...emptyForm, groupName: form.groupName });
          setCreds({ title: "O‘quvchi qo‘shildi", list: [r.student] });
        },
        onError: (err) => errToast(err, "Qo‘shilmadi"),
      },
    );
  };

  const onBulk = () => {
    bulk.mutate(
      { text: bulkText, groupName: bulkGroup || undefined },
      {
        onSuccess: (r) => {
          setBulkOpen(false);
          setBulkText("");
          setCreds({ title: `${r.created.length} ta o‘quvchi qo‘shildi`, list: r.created, errors: r.errors });
        },
        onError: (err) => errToast(err, "Qo‘shilmadi"),
      },
    );
  };

  const openEdit = (s: Student) => {
    setEdit(s);
    setEditForm({
      fullName: s.fullName,
      phone: s.phone ?? "",
      groupName: s.groupName ?? "",
      login: s.login,
      password: "",
      note: s.note ?? "",
    });
  };

  const onEditSave = () => {
    if (!edit) return;
    update.mutate(
      {
        id: edit.id,
        fullName: editForm.fullName,
        phone: editForm.phone,
        groupName: editForm.groupName,
        note: editForm.note,
        login: editForm.login !== edit.login ? editForm.login : undefined,
        password: editForm.password || undefined,
      },
      {
        onSuccess: () => {
          setEdit(null);
          toast({ title: "Saqlandi" });
        },
        onError: (err) => errToast(err, "Saqlanmadi"),
      },
    );
  };

  const onResetPwd = (s: Student) =>
    resetPwd.mutate(s.id, {
      onSuccess: (r) => setCreds({ title: "Yangi parol", list: [{ id: s.id, fullName: s.fullName, login: r.login, password: r.password }] }),
      onError: (err) => errToast(err, "Parol yangilanmadi"),
    });

  const onToggleBlock = (s: Student) =>
    update.mutate(
      { id: s.id, status: s.status === "active" ? "blocked" : "active" },
      {
        onSuccess: () => toast({ title: s.status === "active" ? "Bloklandi — kira olmaydi" : "Faollashtirildi" }),
        onError: (err) => errToast(err, "O‘zgarmadi"),
      },
    );

  const onConfirm = () => {
    if (!confirm) return;
    const { kind, student } = confirm;
    const opts = {
      onSuccess: () => {
        setConfirm(null);
        toast({ title: kind === "delete" ? "O‘quvchi o‘chirildi" : "Natijalar nolga tushirildi" });
      },
      onError: (err: unknown) => errToast(err, "Bajarilmadi"),
    };
    if (kind === "delete") remove.mutate(student.id, opts);
    else resetProgress.mutate(student.id, opts);
  };

  const groupsList = data?.groups ?? [];
  const groupCounts = Object.fromEntries((data?.groupCounts ?? []).map((g) => [g.name, g.count]));
  const sum = data?.summary;

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-10">
      <div className="surface-brand shadow-sm sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
              <GraduationCap className="h-6 w-6" />
              O‘quvchilar
            </h1>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-sky-100/85 sm:text-sm">
              O‘quvchilar faqat «Kirish» darslarini ko‘radi — xodimlar, davomat va boshqa ro‘yxatlarga qo‘shilmaydi.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="h-10 rounded-xl bg-white text-[#0b3a5c] hover:bg-sky-50" onClick={() => setAddOpen(true)}>
              <UserPlus className="mr-1.5 h-4 w-4" />
              Qo‘shish
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => setBulkOpen(true)}
            >
              <ListPlus className="mr-1.5 h-4 w-4" />
              Ro‘yxat bilan
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              disabled={exporting != null || !data?.items.length}
              onClick={() => void onExport("creds")}
            >
              <Download className="mr-1.5 h-4 w-4" />
              {exporting === "creds" ? "Tayyorlanmoqda…" : "Excel: login-parol"}
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              disabled={exporting != null || !data?.items.length}
              onClick={() => void onExport("results")}
            >
              <BarChart3 className="mr-1.5 h-4 w-4" />
              {exporting === "results" ? "Tayyorlanmoqda…" : "Excel: natijalar"}
            </Button>
            {canManageKirishContent(user?.role) ? (
              <Link
                href="/admin/kirish-videolar?for=students"
                className="inline-flex h-10 items-center rounded-xl border border-white/30 bg-white/10 px-3 text-sm font-medium text-white hover:bg-white/20"
              >
                Dars, slayd va test qo‘shish
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {roster.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : roster.isError ? (
        <p className="text-red-600">{(roster.error as Error)?.message || "Yuklanmadi"}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard icon={Users} label="Jami" value={sum?.total ?? 0} tone="bg-sky-100 text-sky-700" />
            <StatCard icon={Clock} label="O‘qimoqda" value={sum?.inProgress ?? 0} tone="bg-blue-100 text-blue-700" />
            <StatCard icon={CheckCircle2} label="Yakunlagan" value={sum?.completed ?? 0} tone="bg-emerald-100 text-emerald-700" />
            <StatCard icon={Ban} label="Boshlamagan" value={sum?.notStarted ?? 0} tone="bg-slate-100 text-slate-700" />
            <StatCard icon={BarChart3} label="O‘rtacha progress" value={`${sum?.avgProgress ?? 0}%`} tone="bg-violet-100 text-violet-700" />
            <StatCard
              icon={GraduationCap}
              label="O‘rtacha ball"
              value={sum?.avgScore != null ? `${sum.avgScore}%` : "—"}
              tone="bg-amber-100 text-amber-700"
            />
          </div>

          {data && data.stages.length > 0 && data.summary.total > 0 ? (
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-foreground">Darslar bo‘yicha o‘tganlar</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {data.stages.map((st, idx) => {
                  const pct = data.summary.total ? Math.round((st.passed / data.summary.total) * 100) : 0;
                  return (
                    <div key={st.stage} className="rounded-xl bg-muted/60 p-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-medium text-foreground" title={st.title}>
                          {idx + 1}. {st.title.replace(/^\d+-bosqich:\s*/, "")}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {st.passed}/{data.summary.total}
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <ProgressBar pct={pct} />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        O‘rtacha ball: {st.avgScore != null ? `${st.avgScore}%` : "—"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-10 rounded-xl pl-9"
                placeholder="Ism, login, telefon yoki guruh…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="">Barcha guruhlar</option>
              {groupsList.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded-xl border border-input bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">Barcha holatlar</option>
              <option value="not_started">Boshlamagan</option>
              <option value="in_progress">O‘qimoqda</option>
              <option value="completed">Yakunlagan</option>
              <option value="blocked">Bloklangan</option>
            </select>
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => setShowPasswords((v) => !v)}>
              <KeyRound className="mr-1.5 h-4 w-4" />
              {showPasswords ? "Parollarni yashirish" : "Parollarni ko‘rsatish"}
            </Button>
          </div>

          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              {data?.items.length ? "Filtr bo‘yicha o‘quvchi topilmadi" : "Hali o‘quvchi yo‘q — «Qo‘shish» tugmasini bosing"}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5">#</th>
                      <th className="px-3 py-2.5">O‘quvchi</th>
                      <th className="px-3 py-2.5">Login / parol</th>
                      <th className="px-3 py-2.5">Progress</th>
                      <th className="px-3 py-2.5">O‘rt. ball</th>
                      <th className="px-3 py-2.5">Holat</th>
                      <th className="px-3 py-2.5">Oxirgi faollik</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((s, i) => {
                      const meta = STATUS_META[s.kirish.status] ?? STATUS_META.not_started!;
                      return (
                        <tr key={s.id} className="border-t border-border/70 hover:bg-muted/40">
                          <td className="px-3 py-2.5 text-xs tabular-nums text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-2.5">
                            <button type="button" className="text-left" onClick={() => setDetail(s)}>
                              <p className="font-medium text-foreground hover:underline">{s.fullName}</p>
                              <p className="text-xs text-muted-foreground">
                                {[s.groupName, s.phone].filter(Boolean).join(" · ") || "—"}
                              </p>
                            </button>
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              className="group flex items-center gap-1.5 font-mono text-xs"
                              onClick={() => copyText(credText(s), toast)}
                              title="Login va parolni nusxalash"
                            >
                              <span>{s.login}</span>
                              <span className="text-muted-foreground">/</span>
                              <span>{showPasswords ? s.password : "••••••"}</span>
                              <Copy className="h-3 w-3 opacity-0 transition group-hover:opacity-60" />
                            </button>
                          </td>
                          <td className="w-44 px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <ProgressBar pct={s.kirish.progressPct} />
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {s.kirish.passed}/{s.kirish.stageCount}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">
                            {s.kirish.avgScore != null ? `${s.kirish.avgScore}%` : "—"}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", meta.cls)}>{meta.label}</span>
                              {s.status !== "active" ? (
                                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                  Bloklangan
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-foreground">
                            {s.kirish.lastActivityAt ? fmtDate(s.kirish.lastActivityAt) : "—"}
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem onClick={() => setDetail(s)}>
                                  <Eye className="mr-2 h-4 w-4" /> Batafsil natijalar
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openEdit(s)}>
                                  <Pencil className="mr-2 h-4 w-4" /> Tahrirlash
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => copyText(credText(s), toast)}>
                                  <Copy className="mr-2 h-4 w-4" /> Login-parolni nusxalash
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onResetPwd(s)}>
                                  <KeyRound className="mr-2 h-4 w-4" /> Yangi parol berish
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onToggleBlock(s)}>
                                  <Ban className="mr-2 h-4 w-4" /> {s.status === "active" ? "Bloklash" : "Faollashtirish"}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => setConfirm({ kind: "progress", student: s })}>
                                  <RotateCcw className="mr-2 h-4 w-4" /> Natijalarni nolga tushirish
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-700"
                                  onClick={() => setConfirm({ kind: "delete", student: s })}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> O‘chirish
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">
                Ko‘rsatilgan: {items.length} / {data?.items.length ?? 0}
              </p>
            </div>
          )}
        </>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>O‘quvchi qo‘shish</DialogTitle>
            <DialogDescription>
              Familiya, ism va telefonni kiriting — login va parol avtomatik yaratilib, darhol ko‘rsatiladi.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              onAdd();
            }}
          >
            <div className="space-y-1.5">
              <Label>Familiya *</Label>
              <Input
                autoFocus
                value={form.lastName}
                placeholder="Aliyev"
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ism *</Label>
              <Input
                value={form.firstName}
                placeholder="Sardor"
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Telefon raqam *</Label>
              <Input
                inputMode="tel"
                value={form.phone}
                placeholder="+998 90 123 45 67"
                onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^\d+\s()-]/g, "") })}
              />
              {form.phone.trim() && phoneDigits.length > 3 && phoneDigits.length < 12 ? (
                <p className="text-[11px] text-red-600">Raqam to‘liq emas (+998 XX XXX XX XX)</p>
              ) : null}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Guruh</Label>
              <GroupPicker
                groups={groupsList}
                counts={groupCounts}
                value={form.groupName}
                allowDelete
                onChange={(g) => setForm({ ...form, groupName: g })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Izoh</Label>
              <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Bekor qilish
              </Button>
              <Button type="submit" className="bg-[#0b3a5c] hover:bg-[#0a314d]" disabled={create.isPending || !formValid}>
                {create.isPending ? "Yaratilmoqda…" : "Yaratish va login-parol olish"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ro‘yxat bilan qo‘shish</DialogTitle>
            <DialogDescription>
              Har qatorga bitta o‘quvchi: «Ism Familiya» yoki «Ism Familiya; telefon». Login-parollar avtomatik.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              rows={8}
              value={bulkText}
              placeholder={"Aliyev Sardor; +998901234567\nKarimova Dilnoza"}
              onChange={(e) => setBulkText(e.target.value)}
            />
            <div className="space-y-1.5">
              <Label>Guruh (ixtiyoriy)</Label>
              <GroupPicker groups={groupsList} counts={groupCounts} value={bulkGroup} onChange={setBulkGroup} />
            </div>
            <p className="text-xs text-muted-foreground">
              {bulkText.split(/\r?\n/).filter((l) => l.trim()).length} ta qator
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              Bekor qilish
            </Button>
            <Button className="bg-[#0b3a5c] hover:bg-[#0a314d]" disabled={bulk.isPending || !bulkText.trim()} onClick={onBulk}>
              {bulk.isPending ? "Qo‘shilmoqda…" : "Qo‘shish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creds != null} onOpenChange={(o) => !o && setCreds(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{creds?.title}</DialogTitle>
            <DialogDescription>Login va parollarni o‘quvchiga bering. Keyin ham Excel orqali olish mumkin.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {creds?.list.map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-muted/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{c.fullName}</p>
                  <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => copyText(credText(c), toast)}>
                    <Copy className="mr-1 h-3.5 w-3.5" /> Nusxalash
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    { label: "Login", value: c.login },
                    { label: "Parol", value: c.password },
                  ].map((f) => (
                    <button
                      key={f.label}
                      type="button"
                      className="rounded-lg border border-border bg-card px-3 py-2 text-left hover:border-[#2AABEE]"
                      onClick={() => copyText(f.value, toast)}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</p>
                      <p className="break-all font-mono text-base font-bold text-foreground">{f.value}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {creds?.errors?.length ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <p className="mb-1 font-semibold">Qo‘shilmaganlar:</p>
                {creds.errors.map((e, i) => (
                  <p key={i}>
                    {e.line} — {e.error}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            {creds && creds.list.length > 1 ? (
              <Button variant="outline" onClick={() => copyText(creds.list.map(credText).join("\n\n"), toast)}>
                <Copy className="mr-1.5 h-4 w-4" /> Hammasini nusxalash
              </Button>
            ) : null}
            <Button className="bg-[#0b3a5c] hover:bg-[#0a314d]" onClick={() => setCreds(null)}>
              Tayyor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={edit != null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Tahrirlash</DialogTitle>
            <DialogDescription>{edit?.fullName}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Ism-familiya</Label>
              <Input value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Telefon</Label>
              <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Guruh</Label>
              <GroupPicker
                groups={groupsList}
                counts={groupCounts}
                value={editForm.groupName}
                onChange={(g) => setEditForm({ ...editForm, groupName: g })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Login</Label>
              <Input value={editForm.login} onChange={(e) => setEditForm({ ...editForm, login: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Yangi parol (ixtiyoriy)</Label>
              <Input value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Izoh</Label>
              <Textarea rows={2} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Bekor qilish
            </Button>
            <Button className="bg-[#0b3a5c] hover:bg-[#0a314d]" disabled={update.isPending} onClick={onEditSave}>
              {update.isPending ? "Saqlanmoqda…" : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detail != null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.fullName}</DialogTitle>
            <DialogDescription>
              {[detail?.groupName, detail?.phone, detail ? `qo‘shilgan: ${fmtDate(detail.createdAt)}` : null, detail?.createdByName ? `trener: ${detail.createdByName}` : null]
                .filter(Boolean)
                .join(" · ")}
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-muted/60 p-2.5">
                  <p className="text-[11px] text-muted-foreground">Progress</p>
                  <p className="text-lg font-bold">{detail.kirish.progressPct}%</p>
                </div>
                <div className="rounded-xl bg-muted/60 p-2.5">
                  <p className="text-[11px] text-muted-foreground">O‘tilgan darslar</p>
                  <p className="text-lg font-bold">
                    {detail.kirish.passed}/{detail.kirish.stageCount}
                  </p>
                </div>
                <div className="rounded-xl bg-muted/60 p-2.5">
                  <p className="text-[11px] text-muted-foreground">O‘rtacha ball</p>
                  <p className="text-lg font-bold">{detail.kirish.avgScore != null ? `${detail.kirish.avgScore}%` : "—"}</p>
                </div>
                <div className="rounded-xl bg-muted/60 p-2.5">
                  <p className="text-[11px] text-muted-foreground">Test urinishlari</p>
                  <p className="text-lg font-bold">{detail.kirish.attempts}</p>
                </div>
              </div>
              {detail.note ? <p className="rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900">{detail.note}</p> : null}
              <div className="max-h-[45vh] overflow-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                    <tr>
                      <th className="px-2.5 py-2">Dars</th>
                      <th className="px-2 py-2 text-center">Video</th>
                      <th className="px-2 py-2 text-center">Slayd</th>
                      <th className="px-2 py-2 text-center">Ball</th>
                      <th className="px-2 py-2 text-center">Urinish</th>
                      <th className="px-2.5 py-2">O‘tgan sana</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.kirish.stages.map((st, idx) => (
                      <tr key={st.stage} className={cn("border-t border-border/70", st.passed && "bg-emerald-50/50 dark:bg-emerald-900/10")}>
                        <td className="px-2.5 py-2">
                          <span className="font-semibold">{idx + 1}.</span> {st.title.replace(/^\d+-bosqich:\s*/, "")}
                        </td>
                        <td className="px-2 py-2 text-center">{st.videoDone || st.passed ? "✓" : "—"}</td>
                        <td className="px-2 py-2 text-center">{st.slidesDone || st.passed ? "✓" : "—"}</td>
                        <td
                          className={cn(
                            "px-2 py-2 text-center font-semibold tabular-nums",
                            st.score == null ? "text-muted-foreground" : st.passed ? "text-emerald-700" : "text-red-600",
                          )}
                        >
                          {st.score != null ? `${st.score}%` : "—"}
                        </td>
                        <td className="px-2 py-2 text-center tabular-nums">{st.attempts}</td>
                        <td className="px-2.5 py-2 text-muted-foreground">{fmtDate(st.passedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm != null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "delete" ? "O‘quvchini o‘chirasizmi?" : "Natijalarni nolga tushirasizmi?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "delete"
                ? `«${confirm?.student.fullName}» akkaunti va barcha natijalari butunlay o‘chiriladi.`
                : `«${confirm?.student.fullName}» darslarni 1-darsdan qayta boshlaydi.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction
              className={confirm?.kind === "delete" ? "bg-red-600 hover:bg-red-700" : undefined}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {confirm?.kind === "delete" ? "O‘chirish" : "Nolga tushirish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
