import { useMemo, useState } from "react";
import {
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  ConciergeBell,
  Loader2,
  MessageSquare,
  Package,
  Phone,
  Plus,
  Search,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  formatVisitDt,
  fromLocalInputValue,
  toLocalInputValue,
  useReceptionHosts,
  useReceptionLogs,
  useReceptionMeta,
  useReceptionMutations,
  type ReceptionLog,
  type ReceptionVisitType,
} from "@/lib/resepsion-api";
import { userRoleLabel } from "@/lib/roles";

type FormState = {
  visitType: ReceptionVisitType;
  topic: string;
  visitorFullName: string;
  visitorPhone: string;
  visitorRoleHint: string;
  hostName: string;
  hostUserId: string;
  interviewerName: string;
  interviewerUserId: string;
  purpose: string;
  notes: string;
  status: string;
  visitAt: string;
  leftAt: string;
};

const emptyForm = (type: ReceptionVisitType = "interview"): FormState => ({
  visitType: type,
  topic: "other",
  visitorFullName: "",
  visitorPhone: "",
  visitorRoleHint: "",
  hostName: "",
  hostUserId: "",
  interviewerName: "",
  interviewerUserId: "",
  purpose: "",
  notes: "",
  status: "waiting",
  visitAt: toLocalInputValue(new Date()),
  leftAt: "",
});

const TYPE_META: Record<
  string,
  { label: string; hint: string; icon: typeof ConciergeBell; tone: string }
> = {
  interview: {
    label: "Suhbat",
    hint: "Nomzod / stajyor / farmasevt — ism, raqam, kim suhbat oladi",
    icon: Briefcase,
    tone: "from-sky-500/15 to-sky-500/5 border-sky-500/20",
  },
  office_visit: {
    label: "Ofis tashrifi",
    hint: "Kim keldi, kimning oldiga, nima uchun",
    icon: Building2,
    tone: "from-violet-500/15 to-violet-500/5 border-violet-500/20",
  },
  other: {
    label: "Boshqa murojaat",
    hint: "Posilka, qo‘ng‘iroq, hujjat, shikoyat…",
    icon: Package,
    tone: "from-amber-500/15 to-amber-500/5 border-amber-500/20",
  },
};

const STATUS_STYLE: Record<string, string> = {
  waiting: "bg-amber-100 text-amber-900",
  in_progress: "bg-sky-100 text-sky-900",
  done: "bg-emerald-100 text-emerald-900",
  cancelled: "bg-muted text-muted-foreground",
  no_show: "bg-rose-100 text-rose-900",
};

function statusLabel(v: string, map?: { value: string; label: string }[]) {
  return map?.find((x) => x.value === v)?.label || v;
}

export default function ResepsionPage() {
  const { toast } = useToast();
  const metaQ = useReceptionMeta();
  const [visitTypeFilter, setVisitTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [dayScope, setDayScope] = useState<"today" | "all">("today");

  const range = useMemo(() => {
    if (dayScope !== "today") return {};
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }, [dayScope]);

  const logsQ = useReceptionLogs({
    visitType: visitTypeFilter === "all" ? undefined : visitTypeFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
    q: q.trim() || undefined,
    ...range,
  });

  const hostsQ = useReceptionHosts();
  const mut = useReceptionMutations();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReceptionLog | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const canWrite = metaQ.data?.canWrite ?? logsQ.data?.canWrite ?? false;
  const stats = logsQ.data?.stats;
  const items = logsQ.data?.items ?? [];

  function openCreate(type: ReceptionVisitType) {
    setEditing(null);
    setForm(emptyForm(type));
    setOpen(true);
  }

  function openEdit(row: ReceptionLog) {
    setEditing(row);
    setForm({
      visitType: (row.visitType as ReceptionVisitType) || "interview",
      topic: row.topic || "other",
      visitorFullName: row.visitorFullName || "",
      visitorPhone: row.visitorPhone || "",
      visitorRoleHint: row.visitorRoleHint || "",
      hostName: row.hostName || "",
      hostUserId: row.hostUserId ? String(row.hostUserId) : "",
      interviewerName: row.interviewerName || "",
      interviewerUserId: row.interviewerUserId ? String(row.interviewerUserId) : "",
      purpose: row.purpose || "",
      notes: row.notes || "",
      status: row.status || "waiting",
      visitAt: toLocalInputValue(row.visitAt),
      leftAt: row.leftAt ? toLocalInputValue(row.leftAt) : "",
    });
    setOpen(true);
  }

  function pickHost(userId: string, field: "host" | "interviewer") {
    const u = hostsQ.data?.items.find((x) => String(x.id) === userId);
    if (field === "host") {
      setForm((f) => ({
        ...f,
        hostUserId: userId,
        hostName: u?.fullName || f.hostName,
      }));
    } else {
      setForm((f) => ({
        ...f,
        interviewerUserId: userId,
        interviewerName: u?.fullName || f.interviewerName,
      }));
    }
  }

  async function onSave() {
    if (form.visitorFullName.trim().length < 2) {
      toast({ title: "Ism familiya yozing", variant: "destructive" });
      return;
    }
    const body = {
      visitType: form.visitType,
      topic: form.visitType === "other" ? form.topic : null,
      visitorFullName: form.visitorFullName.trim(),
      visitorPhone: form.visitorPhone.trim() || null,
      visitorRoleHint: form.visitorRoleHint.trim() || null,
      hostName: form.hostName.trim() || null,
      hostUserId: form.hostUserId ? Number(form.hostUserId) : null,
      interviewerName: form.interviewerName.trim() || null,
      interviewerUserId: form.interviewerUserId ? Number(form.interviewerUserId) : null,
      purpose: form.purpose.trim() || null,
      notes: form.notes.trim() || null,
      status: form.status,
      visitAt: fromLocalInputValue(form.visitAt),
      leftAt: fromLocalInputValue(form.leftAt),
    };
    try {
      if (editing) {
        await mut.update.mutateAsync({ id: editing.id, body });
        toast({ title: "Yangilandi" });
      } else {
        await mut.create.mutateAsync(body);
        toast({ title: "Qayd qo‘shildi" });
      }
      setOpen(false);
    } catch (e) {
      toast({
        title: "Saqlanmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  async function onDelete(row: ReceptionLog) {
    if (!confirm(`«${row.visitorFullName}» yozuvini o‘chirasizmi?`)) return;
    try {
      await mut.remove.mutateAsync(row.id);
      toast({ title: "O‘chirildi" });
    } catch (e) {
      toast({
        title: "O‘chirilmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  async function quickStatus(row: ReceptionLog, status: string) {
    try {
      await mut.update.mutateAsync({ id: row.id, body: { status } });
    } catch (e) {
      toast({
        title: "Holat o‘zgarmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="w-full space-y-5 pb-28">
      <header className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <ConciergeBell className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Resepshin</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Suhbatlar, ofis tashriflari va boshqa murojaatlarni bitta joyda qayd eting — ism,
              telefon, kimning oldiga, sabab, sana va soat.
            </p>
          </div>
          {canWrite ? (
            <Button className="rounded-xl gap-1.5" onClick={() => openCreate("interview")}>
              <Plus className="h-4 w-4" />
              Yangi qayd
            </Button>
          ) : null}
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Bugun", value: stats?.today ?? 0, icon: CalendarClock },
            { label: "Suhbat", value: stats?.interviewsToday ?? 0, icon: Briefcase },
            { label: "Tashrif", value: stats?.visitsToday ?? 0, icon: Users },
            { label: "Kutilmoqda", value: stats?.waiting ?? 0, icon: MessageSquare },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-border/70 bg-card/80 px-3 py-2.5 backdrop-blur"
            >
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <s.icon className="h-3.5 w-3.5" />
                {s.label}
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      </header>

      {canWrite ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(TYPE_META) as ReceptionVisitType[]).map((key) => {
            const m = TYPE_META[key];
            const Icon = m.icon;
            return (
              <button
                key={key}
                type="button"
                onClick={() => openCreate(key)}
                className={cn(
                  "group rounded-2xl border bg-gradient-to-br p-4 text-left transition hover:shadow-md",
                  m.tone,
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-card shadow-sm">
                    <Icon className="h-5 w-5 text-foreground" />
                  </span>
                  <div>
                    <p className="font-semibold text-foreground">{m.label}</p>
                    <p className="text-xs text-muted-foreground">{m.hint}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="space-y-3 border-b bg-muted/30 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Qaydlar jadvasi</CardTitle>
            <div className="flex rounded-xl border border-border bg-card p-0.5 text-xs font-semibold">
              <button
                type="button"
                className={cn(
                  "rounded-lg px-3 py-1.5",
                  dayScope === "today" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
                onClick={() => setDayScope("today")}
              >
                Bugun
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-lg px-3 py-1.5",
                  dayScope === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
                onClick={() => setDayScope("all")}
              >
                Barchasi
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ism, telefon, kimning oldiga…"
                className="h-9 rounded-xl pl-8"
              />
            </div>
            <Select value={visitTypeFilter} onValueChange={setVisitTypeFilter}>
              <SelectTrigger className="h-9 w-[160px] rounded-xl">
                <SelectValue placeholder="Tur" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha turlar</SelectItem>
                <SelectItem value="interview">Suhbat</SelectItem>
                <SelectItem value="office_visit">Ofis tashrifi</SelectItem>
                <SelectItem value="other">Boshqa</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[150px] rounded-xl">
                <SelectValue placeholder="Holat" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha holat</SelectItem>
                {(metaQ.data?.statuses || []).map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {logsQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Yuklanmoqda…
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">
              Hali qayd yo‘q. Yuqoridan yangi suhbat yoki tashrif qo‘shing.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Sana / soat</th>
                    <th className="px-3 py-2.5 font-semibold">Tur</th>
                    <th className="px-3 py-2.5 font-semibold">Mehmon</th>
                    <th className="px-3 py-2.5 font-semibold">Kimning oldiga</th>
                    <th className="px-3 py-2.5 font-semibold">Suhbat / sabab</th>
                    <th className="px-3 py-2.5 font-semibold">Holat</th>
                    <th className="px-3 py-2.5 font-semibold">Amal</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const typeLabel = TYPE_META[row.visitType]?.label || row.visitType;
                    return (
                      <tr key={row.id} className="border-b border-border/60 hover:bg-muted/20">
                        <td className="px-3 py-3 align-top tabular-nums text-xs">
                          {formatVisitDt(row.visitAt)}
                          {row.leftAt ? (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              chiqish: {formatVisitDt(row.leftAt)}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span className="rounded-lg bg-muted px-2 py-0.5 text-[11px] font-medium">
                            {typeLabel}
                          </span>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="font-medium">{row.visitorFullName}</div>
                          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                            {row.visitorPhone ? (
                              <span className="inline-flex items-center gap-0.5">
                                <Phone className="h-3 w-3" />
                                {row.visitorPhone}
                              </span>
                            ) : null}
                            {row.visitorRoleHint ? <span>{row.visitorRoleHint}</span> : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top text-xs">
                          <div className="inline-flex items-center gap-1">
                            <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                            {row.hostName || row.hostUserName || "—"}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top text-xs">
                          {row.visitType === "interview" ? (
                            <div>
                              <span className="text-muted-foreground">Suhbat: </span>
                              {row.interviewerName || row.interviewerUserName || "—"}
                            </div>
                          ) : null}
                          <div className="mt-0.5 line-clamp-2 text-muted-foreground">
                            {row.purpose || "—"}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              STATUS_STYLE[row.status] || "bg-muted",
                            )}
                          >
                            {statusLabel(row.status, metaQ.data?.statuses)}
                          </span>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex flex-wrap gap-1">
                            {canWrite && row.status === "waiting" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="h-7 rounded-lg px-2 text-[11px]"
                                onClick={() => void quickStatus(row, "in_progress")}
                              >
                                Boshlash
                              </Button>
                            ) : null}
                            {canWrite && (row.status === "waiting" || row.status === "in_progress") ? (
                              <Button
                                type="button"
                                size="sm"
                                className="h-7 rounded-lg px-2 text-[11px]"
                                onClick={() => void quickStatus(row, "done")}
                              >
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                Tugatish
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 rounded-lg px-2 text-[11px]"
                              onClick={() => openEdit(row)}
                            >
                              Ochish
                            </Button>
                            {canWrite ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 rounded-lg px-2 text-[11px] text-rose-600"
                                onClick={() => void onDelete(row)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100%-1rem)] max-w-lg overflow-y-auto rounded-2xl p-0 sm:max-w-xl">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>
              {editing ? "Qaydni tahrirlash" : TYPE_META[form.visitType]?.label || "Yangi qayd"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-5 py-4">
            {!editing ? (
              <div className="grid grid-cols-3 gap-1.5 rounded-xl border bg-muted/40 p-1">
                {(Object.keys(TYPE_META) as ReceptionVisitType[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      "rounded-lg px-2 py-2 text-xs font-semibold",
                      form.visitType === key
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground",
                    )}
                    onClick={() => setForm((f) => ({ ...f, visitType: key }))}
                  >
                    {TYPE_META[key].label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">
                  Ism familiya *
                </label>
                <Input
                  value={form.visitorFullName}
                  onChange={(e) => setForm((f) => ({ ...f, visitorFullName: e.target.value }))}
                  placeholder="Masalan: Karimova Dilnoza"
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">
                  Telefon
                </label>
                <Input
                  value={form.visitorPhone}
                  onChange={(e) => setForm((f) => ({ ...f, visitorPhone: e.target.value }))}
                  placeholder="+998…"
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">
                  Lavozim / kim
                </label>
                <Select
                  value={form.visitorRoleHint || "__none"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, visitorRoleHint: v === "__none" ? "" : v }))
                  }
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Tanlang" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {(metaQ.data?.roleHints || []).map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">
                  Kelish sana / soat *
                </label>
                <Input
                  type="datetime-local"
                  value={form.visitAt}
                  onChange={(e) => setForm((f) => ({ ...f, visitAt: e.target.value }))}
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">
                  Chiqish sana / soat
                </label>
                <Input
                  type="datetime-local"
                  value={form.leftAt}
                  onChange={(e) => setForm((f) => ({ ...f, leftAt: e.target.value }))}
                  className="rounded-xl"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">
                Kimning oldiga
              </label>
              <Select
                value={form.hostUserId || "__manual"}
                onValueChange={(v) => {
                  if (v === "__manual") {
                    setForm((f) => ({ ...f, hostUserId: "" }));
                    return;
                  }
                  pickHost(v, "host");
                }}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Xodim tanlang" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__manual">Qo‘lda yozish</SelectItem>
                  {(hostsQ.data?.items || []).map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.fullName} · {userRoleLabel(u.role) || u.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="mt-2 rounded-xl"
                value={form.hostName}
                onChange={(e) => setForm((f) => ({ ...f, hostName: e.target.value }))}
                placeholder="Ism (agar ro‘yxatda yo‘q)"
              />
            </div>

            {form.visitType === "interview" ? (
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">
                  Suhbatni kim oladi
                </label>
                <Select
                  value={form.interviewerUserId || "__manual"}
                  onValueChange={(v) => {
                    if (v === "__manual") {
                      setForm((f) => ({ ...f, interviewerUserId: "" }));
                      return;
                    }
                    pickHost(v, "interviewer");
                  }}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Suhbatchi" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__manual">Qo‘lda yozish</SelectItem>
                    {(hostsQ.data?.items || []).map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.fullName} · {userRoleLabel(u.role) || u.role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="mt-2 rounded-xl"
                  value={form.interviewerName}
                  onChange={(e) => setForm((f) => ({ ...f, interviewerName: e.target.value }))}
                  placeholder="Suhbatchi ismi"
                />
              </div>
            ) : null}

            {form.visitType === "other" ? (
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">
                  Murojaat turi
                </label>
                <Select
                  value={form.topic}
                  onValueChange={(v) => setForm((f) => ({ ...f, topic: v }))}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(metaQ.data?.topics || []).map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">
                Nima uchun kelgan
              </label>
              <Textarea
                value={form.purpose}
                onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                placeholder="Qisqa sabab…"
                className="min-h-[72px] rounded-xl"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">
                  Holat
                </label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(metaQ.data?.statuses || []).map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase text-muted-foreground">
                  Izoh
                </label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Ixtiyoriy"
                  className="rounded-xl"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="border-t px-5 py-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Bekor
            </Button>
            <Button
              type="button"
              className="rounded-xl"
              disabled={mut.create.isPending || mut.update.isPending || !canWrite}
              onClick={() => void onSave()}
            >
              {mut.create.isPending || mut.update.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
