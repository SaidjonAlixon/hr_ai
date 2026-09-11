import React, { useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { useToast } from "../../hooks/use-toast";
import {
  useCompleteReminder,
  useCreateReminder,
  useDeleteReminder,
  useGetReminder,
  useGetReminders,
  usePostponeReminder,
  type Reminder,
  type ReminderAttachment,
  type ReminderCategory,
  type ReminderPriority,
} from "../../lib/eslatmalar-api";
import { fileToAttachment } from "../../lib/vazifalar-api";
import { useGetUsers } from "@workspace/api-client-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  AlertTriangle,
  ArrowUp,
  Bell,
  Briefcase,
  Building2,
  Calendar as CalendarIcon,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  FileText,
  Archive,
  FolderOpen,
  History,
  Kanban,
  LayoutList,
  MoreVertical,
  Plus,
  Save,
  Search,
  Store,
  Tag,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/contexts/AuthContext";
import { staffWorkplaceOf, type StaffWorkplace } from "@/lib/staff-workplace";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type BoardCol = "missed" | "today" | "week" | "done" | "mine";
type ViewMode = "kanban" | "list" | "calendar";
type ScopeTab = "mine" | "others" | "archive";
type FormTab = "main" | "extra" | "repeat" | "notify";
type CalScope = "month" | "year";

/** Brauzer uz-UZ ba'zan "M09" qaytaradi — i18n oy nomlaridan foydalanamiz */
function monthName(monthIndex0: number, t: (key: string) => string) {
  const n = Math.min(12, Math.max(1, monthIndex0 + 1));
  return t(`month.${n}`);
}

function formatMonthYear(d: Date, t: (key: string) => string) {
  return `${monthName(d.getMonth(), t)} ${d.getFullYear()}`;
}

const CATEGORIES: {
  id: ReminderCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}[] = [
  { id: "work", label: "Ish", icon: Briefcase, color: "#3b82f6" },
  { id: "personal", label: "Shaxsiy", icon: User, color: "#a855f7" },
  { id: "meeting", label: "Yig‘ilish", icon: Users, color: "#06b6d4" },
  { id: "check", label: "Tekshiruv", icon: ClipboardCheck, color: "#f59e0b" },
  { id: "finance", label: "Moliya", icon: CircleDollarSign, color: "#10b981" },
  { id: "other", label: "Boshqa", icon: Tag, color: "#64748b" },
];

const PRIORITIES: {
  id: ReminderPriority;
  label: string;
  className: string;
  dot: string;
}[] = [
  { id: "low", label: "Past", className: "bg-muted text-muted-foreground border-border dark:bg-slate-800/80 dark:text-slate-300", dot: "bg-slate-400" },
  { id: "medium", label: "O‘rtacha", className: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30", dot: "bg-sky-500" },
  { id: "high", label: "Yuqori", className: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30", dot: "bg-orange-500" },
  { id: "critical", label: "Juda yuqori", className: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30", dot: "bg-rose-500" },
];

const COLUMNS: {
  id: BoardCol;
  label: string;
  header: string;
  badge: string;
  empty: string;
  allowCreate: boolean;
}[] = [
  {
    id: "missed",
    label: "Bajarilmagan",
    header: "from-rose-500 to-rose-400",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
    empty: "Muddatidan o‘tgan eslatma yo‘q",
    allowCreate: false,
  },
  {
    id: "today",
    label: "Bugun",
    header: "from-amber-500 to-orange-400",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
    empty: "Bugungi eslatma yo‘q",
    allowCreate: true,
  },
  {
    id: "week",
    label: "Kelgusi 7 kun",
    header: "from-sky-500 to-blue-500",
    badge: "bg-sky-100 text-sky-800 dark:text-sky-200 dark:bg-sky-500/20 dark:text-sky-300",
    empty: "Kelgusi haftada yo‘q",
    allowCreate: true,
  },
  {
    id: "done",
    label: "Bajarilgan",
    header: "from-emerald-500 to-teal-500",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
    empty: "Bajarilganlar yo‘q",
    allowCreate: false,
  },
  {
    id: "mine",
    label: "Menga biriktirilgan",
    header: "from-violet-500 to-purple-500",
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
    empty: "Keyinroq uchun eslatma yo‘q",
    allowCreate: true,
  },
];

const INTERVALS: { value: string; label: string }[] = [
  { value: "none", label: "Takrorlanmaydi" },
  { value: "15", label: "Har 15 daqiqa" },
  { value: "30", label: "Har 30 daqiqa" },
  { value: "60", label: "Har 1 soat" },
  { value: "120", label: "Har 2 soat" },
  { value: "360", label: "Har 6 soat" },
  { value: "720", label: "Har 12 soat" },
  { value: "1440", label: "Har kuni" },
];

const LEAD_OPTS: { value: string; label: string }[] = [
  { value: "0", label: "Muddatda" },
  { value: "5", label: "5 daqiqa oldin" },
  { value: "15", label: "15 daqiqa oldin" },
  { value: "30", label: "30 daqiqa oldin" },
  { value: "60", label: "1 soat oldin" },
  { value: "1440", label: "1 kun oldin" },
];

const EVENT_LABELS: Record<string, string> = {
  created: "Yaratildi",
  due_changed: "Muddat o‘zgardi",
  completed: "Bajarildi",
  reopened: "Qayta ochildi",
  missed: "Bajarilmadi",
  notified: "Ogohlantirildi",
  note: "Yangilandi",
};

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function boardColumnFor(r: Reminder, now = new Date()): BoardCol {
  if (r.status === "completed") return "done";
  if (r.status === "missed") return "missed";
  const due = startOfDay(new Date(r.dueAt));
  const today = startOfDay(now);
  const weekEnd = addDays(today, 7);
  if (due.getTime() < today.getTime()) return "missed";
  if (due.getTime() === today.getTime()) return "today";
  if (due.getTime() > today.getTime() && due.getTime() <= weekEnd.getTime()) return "week";
  return "mine";
}

function toDatetimeLocalValue(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function splitDateTime(isoLocal: string) {
  const [date = "", time = "10:00"] = isoLocal.split("T");
  return { date, time: time.slice(0, 5) };
}

function joinDateTime(date: string, time: string) {
  if (!date) return "";
  return `${date}T${time || "10:00"}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShort(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function defaultDueForColumn(col: BoardCol) {
  const now = new Date();
  const setH = (d: Date, h = 10) => {
    d.setHours(h, 0, 0, 0);
    return d;
  };
  if (col === "today") return setH(new Date());
  if (col === "week") return setH(addDays(now, 3));
  if (col === "mine") return setH(addDays(now, 14));
  return setH(new Date());
}

function catMeta(id?: string | null) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[0]!;
}

function priMeta(id?: string | null) {
  return PRIORITIES.find((p) => p.id === id) || PRIORITIES[1]!;
}

async function readFileAsAttachment(file: File): Promise<ReminderAttachment> {
  const att = await fileToAttachment(file);
  return {
    id: att.id || crypto.randomUUID(),
    name: att.name,
    mimeType: att.mimeType,
    kind: att.kind,
    url: att.url,
    size: att.size,
  };
}

export default function EslatmalarPage() {
  const { toast } = useToast();
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: reminders = [], isLoading } = useGetReminders();
  const { data: users = [] } = useGetUsers({ status: "active" } as any);
  const createMut = useCreateReminder();
  const postponeMut = usePostponeReminder();
  const completeMut = useCompleteReminder();
  const deleteMut = useDeleteReminder();

  const [view, setView] = useState<ViewMode>("kanban");
  const [scope, setScope] = useState<ScopeTab>("mine");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");
  const [filterPri, setFilterPri] = useState<string>("all");
  const [calMonth, setCalMonth] = useState(() => startOfDay(new Date()));
  const [calScope, setCalScope] = useState<CalScope>("month");
  const [calSelected, setCalSelected] = useState<Date>(() => startOfDay(new Date()));

  const [createOpen, setCreateOpen] = useState(false);
  const [createCol, setCreateCol] = useState<BoardCol>("today");
  const [formTab, setFormTab] = useState<FormTab>("main");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("10:00");
  const [category, setCategory] = useState<ReminderCategory>("work");
  const [priority, setPriority] = useState<ReminderPriority>("medium");
  const [interval, setInterval] = useState("none");
  const [notifyOn, setNotifyOn] = useState(true);
  const [leadMin, setLeadMin] = useState("15");
  const [chSystem, setChSystem] = useState(true);
  const [chTelegram, setChTelegram] = useState(false);
  const [assignMode, setAssignMode] = useState<"self" | "staff">("self");
  const [targetUserIds, setTargetUserIds] = useState<number[]>([]);
  const [filterOfis, setFilterOfis] = useState(true);
  const [filterDorixona, setFilterDorixona] = useState(true);
  const [staffSearch, setStaffSearch] = useState("");
  const [attachments, setAttachments] = useState<ReminderAttachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [newDue, setNewDue] = useState("");
  const [postponeNote, setPostponeNote] = useState("");

  const { data: detail } = useGetReminder(detailId);

  const staffOptions = useMemo(() => {
    const me = user?.id;
    return (users as any[])
      .filter((u) => {
        if (!u?.id || u.id === me) return false;
        if (String(u.role || "") === "admin") return false;
        const st = String(u.status || "active");
        return st === "active" || st === "on_leave";
      })
      .map((u) => {
        const role = String(u.role || "").replace(/_/g, " ");
        const dept = String(u.departmentName || "").trim();
        const workplace: StaffWorkplace = staffWorkplaceOf({
          role: u.role,
          orgRole: u.orgRole,
          position: u.position,
          departmentName: dept,
          location: u.location,
        });
        const name = String(u.fullName || "").trim() || `User #${u.id}`;
        return {
          id: Number(u.id),
          name,
          meta: [role, dept].filter(Boolean).join(" · "),
          workplace,
        };
      })
      .filter((u) => u.name)
      .sort((a, b) => a.name.localeCompare(b.name, "uz"));
  }, [users, user?.id]);

  const filteredStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    const showOfis = filterOfis;
    const showDorixona = filterDorixona;
    return staffOptions.filter((s) => {
      if (s.workplace === "ofis" && !showOfis) return false;
      if (s.workplace === "dorixona" && !showDorixona) return false;
      if (!q) return true;
      return `${s.name} ${s.meta}`.toLowerCase().includes(q);
    });
  }, [staffOptions, filterOfis, filterDorixona, staffSearch]);

  function toggleTargetUser(id: number) {
    setTargetUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleAllFilteredStaff() {
    const ids = filteredStaff.map((s) => s.id);
    if (ids.length === 0) return;
    setTargetUserIds((prev) => {
      const allOn = ids.every((id) => prev.includes(id));
      if (allOn) return prev.filter((id) => !ids.includes(id));
      return [...new Set([...prev, ...ids])];
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reminders.filter((r) => {
      if (scope === "archive") {
        if (r.status !== "completed") return false;
      } else if (scope === "others") {
        if (!r.forOthers) return false;
      } else {
        if (r.forOthers) return false;
      }
      if (filterCat !== "all" && (r.category || "work") !== filterCat) return false;
      if (filterPri !== "all" && (r.priority || "medium") !== filterPri) return false;
      if (q && !`${r.title} ${r.description || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [reminders, search, scope, filterCat, filterPri]);

  const byCol = useMemo(() => {
    const map: Record<BoardCol, Reminder[]> = {
      missed: [],
      today: [],
      week: [],
      done: [],
      mine: [],
    };
    for (const r of filtered) {
      map[boardColumnFor(r)].push(r);
    }
    return map;
  }, [filtered]);

  const stats = useMemo(() => {
    const now = new Date();
    const today = startOfDay(now).getTime();
    let missed = 0;
    let todayN = 0;
    let weekN = 0;
    let done = 0;
    let mine = 0;
    let todayNew = 0;
    for (const r of reminders) {
      const col = boardColumnFor(r, now);
      if (col === "missed") missed++;
      if (col === "today") todayN++;
      if (col === "week") weekN++;
      if (col === "done") done++;
      if (r.status !== "completed") mine++;
      if (startOfDay(new Date(r.createdAt)).getTime() === today) todayNew++;
    }
    return { missed, todayN, weekN, done, mine, todayNew };
  }, [reminders]);

  const categoryStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reminders) {
      const k = r.category || "work";
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const total = reminders.length || 1;
    return CATEGORIES.map((c) => ({
      name: c.label,
      value: counts.get(c.id) || 0,
      color: c.color,
      pct: Math.round(((counts.get(c.id) || 0) / total) * 100),
    })).filter((x) => x.value > 0);
  }, [reminders]);

  const priorityStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reminders) {
      const k = r.priority || "medium";
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return PRIORITIES.map((p) => ({
      name: p.label,
      value: counts.get(p.id) || 0,
      fill:
        p.id === "critical"
          ? "#e11d48"
          : p.id === "high"
            ? "#f97316"
            : p.id === "medium"
              ? "#0ea5e9"
              : "#94a3b8",
    }));
  }, [reminders]);

  const recentDone = useMemo(
    () =>
      [...reminders]
        .filter((r) => r.status === "completed")
        .sort((a, b) => new Date(b.completedAt || b.updatedAt).getTime() - new Date(a.completedAt || a.updatedAt).getTime())
        .slice(0, 6),
    [reminders],
  );

  function openCreate(col: BoardCol = "today") {
    setCreateCol(col);
    setFormTab("main");
    setTitle("");
    setDescription("");
    const due = toDatetimeLocalValue(defaultDueForColumn(col).toISOString());
    const parts = splitDateTime(due);
    setDueDate(parts.date);
    setDueTime(parts.time);
    setCategory("work");
    setPriority("medium");
    setInterval("none");
    setNotifyOn(true);
    setLeadMin("15");
    setChSystem(true);
    setChTelegram(false);
    setAssignMode("self");
    setTargetUserIds([]);
    setFilterOfis(true);
    setFilterDorixona(true);
    setStaffSearch("");
    setAttachments([]);
    setCreateOpen(true);
  }

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      const next: ReminderAttachment[] = [];
      for (const f of Array.from(files)) {
        if (f.size > 10 * 1024 * 1024) {
          toast({ title: "Fayl 10 MB dan katta", variant: "destructive" });
          continue;
        }
        next.push(await readFileAsAttachment(f));
      }
      setAttachments((prev) => [...prev, ...next]);
    } catch (e: any) {
      toast({ title: "Fayl", description: e.message, variant: "destructive" });
    }
  }

  async function submitCreate() {
    if (!title.trim() || !dueDate) {
      toast({ title: "Nom va sana majburiy", variant: "destructive" });
      setFormTab("main");
      return;
    }
    if (assignMode === "staff" && targetUserIds.length === 0) {
      toast({ title: "Kamida bitta xodimni tanlang", variant: "destructive" });
      setFormTab("main");
      return;
    }
    const dueLocal = joinDateTime(dueDate, dueTime);
    const due = new Date(dueLocal);
    if (Number.isNaN(due.getTime())) {
      toast({ title: "Sana/vaqt noto‘g‘ri", variant: "destructive" });
      return;
    }
    let notifyAt: string | null = null;
    if (notifyOn && (chSystem || chTelegram)) {
      const lead = parseInt(leadMin, 10) || 0;
      notifyAt = new Date(due.getTime() - lead * 60_000).toISOString();
    }
    try {
      const result = await createMut.mutateAsync({
        title: title.trim().slice(0, 100),
        description: description.trim().slice(0, 500) || null,
        dueAt: due.toISOString(),
        notifyAt,
        remindIntervalMinutes: interval === "none" ? null : parseInt(interval, 10),
        attachments,
        category,
        priority,
        notifySystem: notifyOn && chSystem,
        notifyTelegram: notifyOn && chTelegram,
        targetUserIds: assignMode === "staff" ? targetUserIds : undefined,
        targetUserId: null,
      });
      setCreateOpen(false);
      if (assignMode === "staff") {
        setScope("others");
        const n = result.created || targetUserIds.length || 1;
        toast({
          title:
            n > 1
              ? `Eslatma ${n} ta xodimga yuborildi`
              : "Eslatma xodimga biriktirildi",
        });
      } else {
        setScope("mine");
        toast({ title: "Eslatma saqlandi" });
      }
    } catch (e: any) {
      toast({ title: "Xato", description: e.message, variant: "destructive" });
    }
  }

  async function markDone(id: number) {
    try {
      await completeMut.mutateAsync(id);
      setDetailId(null);
      setScope("archive");
      setView("kanban");
      toast({ title: "Bajardim", description: "Eslatma bajarilganlarga o‘tdi" });
    } catch (e: any) {
      toast({ title: "Xato", description: e.message, variant: "destructive" });
    }
  }

  async function submitPostpone() {
    if (!detailId || !newDue) return;
    try {
      await postponeMut.mutateAsync({
        id: detailId,
        dueAt: new Date(newDue).toISOString(),
        note: postponeNote.trim() || undefined,
      });
      setPostponeOpen(false);
      toast({ title: "Muddat yangilandi" });
    } catch (e: any) {
      toast({ title: "Xato", description: e.message, variant: "destructive" });
    }
  }

  const calCells = useMemo(() => {
    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    const first = new Date(y, m, 1);
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: { date: Date | null; items: Reminder[] }[] = [];
    for (let i = 0; i < startPad; i++) cells.push({ date: null, items: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, m, d);
      const key = startOfDay(date).getTime();
      const items = filtered.filter((r) => startOfDay(new Date(r.dueAt)).getTime() === key);
      cells.push({ date, items });
    }
    while (cells.length % 7) cells.push({ date: null, items: [] });
    return cells;
  }, [calMonth, filtered]);

  const calSelectedItems = useMemo(() => {
    const key = startOfDay(calSelected).getTime();
    return filtered
      .filter((r) => startOfDay(new Date(r.dueAt)).getTime() === key)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  }, [filtered, calSelected]);

  const calMonthCount = useMemo(() => {
    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    return filtered.filter((r) => {
      const d = new Date(r.dueAt);
      return d.getFullYear() === y && d.getMonth() === m;
    }).length;
  }, [filtered, calMonth]);

  const todayStart = startOfDay(new Date());

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-[1800px] space-y-5 px-1 pb-10 sm:px-2 md:px-3 lg:px-4">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("reminders.title")}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Muddat, bildirishnoma va Telegram — barcha eslatmalaringiz bitta joyda.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-2 border-border bg-card"
              onClick={() => setView("calendar")}
            >
              <CalendarIcon className="h-4 w-4 text-sky-600" />
              Taqvim ko‘rish
            </Button>
            <Button type="button" className="gap-2 bg-sky-600 hover:bg-sky-700" onClick={() => openCreate("today")}>
              <Plus className="h-4 w-4" />
              Yangi eslatma
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {(
            [
              { id: "missed" as BoardCol, label: "Bajarilmagan", value: stats.missed, tone: "rose", hint: "Muddat o‘tgan", icon: AlertTriangle },
              { id: "today" as BoardCol, label: "Bugun", value: stats.todayN, tone: "amber", hint: `+${stats.todayNew} bugun`, icon: Clock },
              { id: "week" as BoardCol, label: "Kelgusi 7 kun", value: stats.weekN, tone: "sky", hint: "Rejalashtirilgan", icon: CalendarClock },
              { id: "done" as BoardCol, label: "Bajarilgan", value: stats.done, tone: "emerald", hint: "Yopilgan", icon: CheckCircle2 },
              { id: "mine" as BoardCol, label: "Menga biriktirilgan", value: stats.mine, tone: "violet", hint: "Faol", icon: User },
            ] as const
          ).map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => {
                setView("kanban");
                setScope(s.id === "done" ? "archive" : "mine");
                const el = document.getElementById(`esl-col-${s.id}`);
                el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 dark:hover:border-sky-500/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl",
                    s.tone === "rose" && "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
                    s.tone === "amber" && "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
                    s.tone === "sky" && "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
                    s.tone === "emerald" && "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
                    s.tone === "violet" && "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
                  )}
                >
                  <s.icon className="h-5 w-5" />
                </div>
                <p className="text-3xl font-bold tabular-nums text-foreground">{s.value}</p>
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-3">
              <div
                role="tablist"
                aria-label="Ko‘rinish"
                className="inline-flex w-full items-center gap-0.5 rounded-2xl border border-border bg-gradient-to-b from-muted/30 to-muted/50 p-1 shadow-inner sm:w-auto"
              >
                {(
                  [
                    { id: "kanban" as const, label: "Kanban", icon: Kanban },
                    { id: "list" as const, label: "Ro‘yxat", icon: LayoutList },
                    { id: "calendar" as const, label: "Taqvim", icon: CalendarIcon },
                  ] as const
                ).map((v) => {
                  const active = view === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setView(v.id)}
                      className={cn(
                        "inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all sm:flex-none sm:min-w-[7.25rem]",
                        active
                          ? "bg-gradient-to-b from-sky-500 to-sky-600 text-white shadow-[0_6px_16px_rgba(14,165,233,0.35)]"
                          : "text-muted-foreground hover:bg-card hover:text-foreground",
                      )}
                    >
                      <v.icon className={cn("h-4 w-4", active ? "text-white" : "text-muted-foreground")} />
                      {v.label}
                    </button>
                  );
                })}
              </div>

              <div className="hidden h-8 w-px shrink-0 bg-border lg:block" aria-hidden />

              <div
                role="tablist"
                aria-label="Doira"
                className="inline-flex w-full items-center gap-0.5 rounded-2xl border border-border bg-gradient-to-b from-muted/30 to-muted/50 p-1 shadow-inner sm:w-auto"
              >
                {(
                  [
                    { id: "mine" as const, label: "Mening eslatmalarim", short: "Mening", icon: User },
                    { id: "others" as const, label: "Boshqalarning", short: "Boshqa", icon: Users },
                    { id: "archive" as const, label: "Arxiv", short: "Arxiv", icon: Archive },
                  ] as const
                ).map((tab) => {
                  const active = scope === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setScope(tab.id)}
                      className={cn(
                        "inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all sm:flex-none",
                        active
                          ? "bg-foreground text-background shadow-sm"
                          : "text-muted-foreground hover:bg-card hover:text-foreground",
                      )}
                    >
                      <tab.icon className={cn("h-4 w-4 shrink-0", active ? "text-sky-300" : "text-muted-foreground")} />
                      <span className="hidden truncate sm:inline">{tab.label}</span>
                      <span className="sm:hidden">{tab.short}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 xl:ml-auto xl:w-auto xl:flex-nowrap xl:justify-end">
              <Select value={filterCat} onValueChange={setFilterCat}>
                <SelectTrigger className="h-11 w-full min-w-[140px] rounded-xl border-border bg-muted/40 sm:w-[158px]">
                  <SelectValue placeholder="Toifa" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha toifalar</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterPri} onValueChange={setFilterPri}>
                <SelectTrigger className="h-11 w-full min-w-[140px] rounded-xl border-border bg-muted/40 sm:w-[158px]">
                  <SelectValue placeholder="Ustuvorlik" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha ustuvorlik</SelectItem>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative w-full min-w-[180px] flex-1 xl:w-[260px] xl:flex-none">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Qidirish..."
                  className="h-11 rounded-xl border-border bg-muted/40 pl-10"
                />
              </div>
            </div>
          </div>
        </div>

        {scope === "others" && !reminders.some((r) => r.forOthers) ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
            Hozircha boshqa xodimlarga biriktirilgan eslatma yo‘q. Yangi eslatmada «Xodimlar»ni tanlang.
          </div>
        ) : isLoading ? (
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-80 rounded-2xl" />
            ))}
          </div>
        ) : view === "kanban" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 xl:gap-3.5">
            {COLUMNS.map((col) => {
              const items = byCol[col.id];
              return (
                <div
                  id={`esl-col-${col.id}`}
                  key={col.id}
                  className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition hover:shadow-md"
                >
                  <div className={cn("bg-gradient-to-r px-3.5 py-3 text-white", col.header)}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold tracking-tight">{col.label}</p>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums", col.badge)}>
                        {items.length}
                      </span>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-gradient-to-b from-muted/30 to-card p-2.5 sm:p-3">
                    {items.length === 0 ? (
                      <p className="px-2 py-10 text-center text-xs leading-relaxed text-muted-foreground">{col.empty}</p>
                    ) : (
                      items.map((r) => {
                        const pri = priMeta(r.priority);
                        const cat = catMeta(r.category);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setDetailId(r.id)}
                            className="group w-full rounded-xl border border-border bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md dark:hover:border-sky-500/40"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold leading-snug text-foreground group-hover:text-sky-700 dark:group-hover:text-sky-300">
                                {r.title}
                              </p>
                              <MoreVertical className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", pri.className)}>
                                {pri.label}
                              </span>
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {cat.label}
                              </span>
                            </div>
                            <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <CalendarIcon className="h-3 w-3" />
                              {formatShort(r.dueAt)}
                            </div>
                            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <User className="h-3 w-3" />
                              {user?.fullName || "Men"}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                  {col.allowCreate ? (
                    <div className="border-t border-border/70 bg-card p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-full justify-center gap-1.5 rounded-xl text-xs font-semibold text-muted-foreground hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
                        onClick={() => openCreate(col.id)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Eslatma qo‘shish
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : view === "list" ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Eslatma</th>
                  <th className="px-4 py-3">Toifa</th>
                  <th className="px-4 py-3">Ustuvorlik</th>
                  <th className="px-4 py-3">Muddat</th>
                  <th className="px-4 py-3">Holat</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t border-border/70 hover:bg-sky-50 dark:hover:bg-sky-500/10"
                    onClick={() => setDetailId(r.id)}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{r.title}</td>
                    <td className="px-4 py-3 text-muted-foreground">{catMeta(r.category).label}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", priMeta(r.priority).className)}>
                        {priMeta(r.priority).label}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDate(r.dueAt)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.remainingLabel}</td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                      Eslatma topilmadi
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
            <div className="border-b border-border bg-gradient-to-r from-sky-500/10 via-transparent to-violet-500/10 px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-xl border-border bg-card"
                  onClick={() =>
                    setCalMonth(
                      calScope === "year"
                        ? new Date(calMonth.getFullYear() - 1, calMonth.getMonth(), 1)
                        : new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1),
                    )
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <div className="flex min-w-0 flex-1 flex-col items-center gap-2.5">
                  <div className="text-center">
                    <p className="text-xl font-bold capitalize tracking-tight text-foreground sm:text-2xl">
                      {calScope === "year"
                        ? String(calMonth.getFullYear())
                        : formatMonthYear(calMonth, t)}
                    </p>
                    {calScope === "month" ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {calMonthCount
                          ? `${calMonthCount} ta eslatma shu oyda`
                          : "Bu oyda eslatma yo‘q"}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted-foreground">12 oy — oyga bosib oching</p>
                    )}
                  </div>
                  <div className="inline-flex rounded-full border border-border bg-muted/50 p-1 shadow-inner">
                    <button
                      type="button"
                      className={cn(
                        "rounded-full px-4 py-1.5 text-xs font-semibold transition",
                        calScope === "month"
                          ? "bg-sky-600 text-white shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setCalScope("month")}
                    >
                      {t("tasks.cal.monthly")}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded-full px-4 py-1.5 text-xs font-semibold transition",
                        calScope === "year"
                          ? "bg-sky-600 text-white shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setCalScope("year")}
                    >
                      {t("tasks.cal.yearly")}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="hidden h-10 rounded-xl border-border px-3 text-xs font-semibold sm:inline-flex"
                    onClick={() => {
                      const n = startOfDay(new Date());
                      setCalMonth(new Date(n.getFullYear(), n.getMonth(), 1));
                      setCalSelected(n);
                      setCalScope("month");
                    }}
                  >
                    Bugun
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 rounded-xl border-border bg-card"
                    onClick={() =>
                      setCalMonth(
                        calScope === "year"
                          ? new Date(calMonth.getFullYear() + 1, calMonth.getMonth(), 1)
                          : new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1),
                      )
                    }
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {calScope === "month" ? (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> Bugun
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Kechikkan
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Rejalashtirilgan
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Bajarilgan
                  </span>
                </div>
              ) : null}
            </div>

            <div className="p-3 sm:p-4">
              {calScope === "year" ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: 12 }).map((_, monthIdx) => {
                    const y = calMonth.getFullYear();
                    const daysInM = new Date(y, monthIdx + 1, 0).getDate();
                    const startWd = (new Date(y, monthIdx, 1).getDay() + 6) % 7;
                    const monthItems = filtered.filter((r) => {
                      const d = new Date(r.dueAt);
                      return d.getFullYear() === y && d.getMonth() === monthIdx;
                    });
                    const isCurrentMonth =
                      todayStart.getFullYear() === y && todayStart.getMonth() === monthIdx;
                    return (
                      <div
                        key={monthIdx}
                        className={cn(
                          "rounded-2xl border bg-muted/15 p-3 transition hover:border-sky-300 hover:shadow-sm dark:hover:border-sky-500/40",
                          isCurrentMonth ? "border-sky-400/70 ring-1 ring-sky-400/30" : "border-border",
                        )}
                      >
                        <button
                          type="button"
                          className="mb-2 flex w-full items-center justify-between gap-2 text-left"
                          onClick={() => {
                            setCalMonth(new Date(y, monthIdx, 1));
                            setCalSelected(new Date(y, monthIdx, 1));
                            setCalScope("month");
                          }}
                        >
                          <span className="text-sm font-bold capitalize text-foreground">
                            {monthName(monthIdx, t)}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
                              monthItems.length
                                ? "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {monthItems.length}
                          </span>
                        </button>
                        <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[8px] font-semibold uppercase text-muted-foreground">
                          {["D", "S", "C", "P", "J", "S", "Y"].map((d, i) => (
                            <div key={`${monthIdx}-${i}`}>{d}</div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 gap-0.5">
                          {Array.from({ length: startWd }).map((_, i) => (
                            <div key={`pad-${monthIdx}-${i}`} className="h-7" />
                          ))}
                          {Array.from({ length: daysInM }).map((_, i) => {
                            const day = i + 1;
                            const dayStart = startOfDay(new Date(y, monthIdx, day));
                            const dayItems = filtered.filter(
                              (r) => startOfDay(new Date(r.dueAt)).getTime() === dayStart.getTime(),
                            );
                            const isToday = dayStart.getTime() === todayStart.getTime();
                            return (
                              <button
                                key={`d-${monthIdx}-${day}`}
                                type="button"
                                onClick={() => {
                                  setCalMonth(new Date(y, monthIdx, 1));
                                  setCalSelected(dayStart);
                                  setCalScope("month");
                                  if (dayItems[0]) setDetailId(dayItems[0].id);
                                }}
                                className={cn(
                                  "flex h-7 items-center justify-center rounded-md text-[10px] font-semibold transition",
                                  isToday && "ring-1 ring-sky-400",
                                  dayItems.length
                                    ? "bg-sky-500 text-white hover:bg-sky-600"
                                    : "text-muted-foreground hover:bg-muted",
                                )}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
                  <div>
                    <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"].map((d) => (
                        <div key={d} className="py-1">
                          {d}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                      {calCells.map((cell, i) => {
                        if (!cell.date) {
                          return (
                            <div
                              key={i}
                              className="min-h-[88px] rounded-2xl border border-transparent bg-transparent sm:min-h-[100px]"
                            />
                          );
                        }
                        const dayKey = startOfDay(cell.date).getTime();
                        const isToday = dayKey === todayStart.getTime();
                        const isSelected = dayKey === startOfDay(calSelected).getTime();
                        const isWeekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;
                        const hasMissed = cell.items.some(
                          (r) => boardColumnFor(r) === "missed" || r.status === "missed",
                        );
                        const hasDone = cell.items.some((r) => r.status === "completed");
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setCalSelected(startOfDay(cell.date!))}
                            className={cn(
                              "group flex min-h-[88px] flex-col rounded-2xl border p-2 text-left transition sm:min-h-[100px]",
                              isWeekend && !isToday && !isSelected && "bg-muted/20",
                              !isToday &&
                                !isSelected &&
                                "border-border/80 bg-card hover:border-sky-300 hover:bg-sky-50/60 dark:hover:border-sky-500/40 dark:hover:bg-sky-500/10",
                              isToday &&
                                !isSelected &&
                                "border-sky-400 bg-sky-50 shadow-sm ring-1 ring-sky-400/30 dark:bg-sky-500/15",
                              isSelected &&
                                "border-sky-500 bg-sky-100 shadow-md ring-2 ring-sky-400/40 dark:bg-sky-500/20 dark:ring-sky-400/50",
                            )}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span
                                className={cn(
                                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                                  isToday || isSelected
                                    ? "bg-sky-600 text-white"
                                    : "text-foreground/90 group-hover:bg-muted",
                                )}
                              >
                                {cell.date.getDate()}
                              </span>
                              {cell.items.length ? (
                                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                                  {cell.items.length}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1.5 flex min-h-0 flex-1 flex-col gap-1">
                              {cell.items.slice(0, 2).map((r) => {
                                const col = boardColumnFor(r);
                                return (
                                  <span
                                    key={r.id}
                                    className={cn(
                                      "truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-tight",
                                      col === "missed" &&
                                        "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
                                      col === "done" &&
                                        "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
                                      col === "today" &&
                                        "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                                      col !== "missed" &&
                                        col !== "done" &&
                                        col !== "today" &&
                                        "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
                                    )}
                                  >
                                    {r.title}
                                  </span>
                                );
                              })}
                              {cell.items.length > 2 ? (
                                <span className="text-[10px] font-medium text-muted-foreground">
                                  +{cell.items.length - 2} yana
                                </span>
                              ) : null}
                              {!cell.items.length ? (
                                <span className="mt-auto text-[10px] text-muted-foreground/50 opacity-0 transition group-hover:opacity-100">
                                  + qo‘shish
                                </span>
                              ) : null}
                            </div>
                            {cell.items.length ? (
                              <div className="mt-1 flex gap-0.5">
                                {hasMissed ? <span className="h-1 w-1 rounded-full bg-rose-500" /> : null}
                                {hasDone ? <span className="h-1 w-1 rounded-full bg-emerald-500" /> : null}
                                {!hasMissed && !hasDone ? (
                                  <span className="h-1 w-1 rounded-full bg-sky-500" />
                                ) : null}
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <aside className="flex min-h-[280px] flex-col overflow-hidden rounded-2xl border border-border bg-muted/20">
                    <div className="border-b border-border bg-card/80 px-4 py-3">
                      <p className="text-sm font-bold text-foreground">
                        {calSelected.getDate()}{" "}
                        {monthName(calSelected.getMonth(), t)} {calSelected.getFullYear()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {startOfDay(calSelected).getTime() === todayStart.getTime()
                          ? "Bugun"
                          : calSelectedItems.length
                            ? `${calSelectedItems.length} ta eslatma`
                            : "Eslatma yo‘q"}
                      </p>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                      {calSelectedItems.length === 0 ? (
                        <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 px-4 text-center">
                          <CalendarIcon className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-sm font-medium text-muted-foreground">Shu kunda eslatma yo‘q</p>
                          <Button
                            type="button"
                            size="sm"
                            className="mt-1 gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-700"
                            onClick={() => {
                              setCreateCol("today");
                              setFormTab("main");
                              setTitle("");
                              setDescription("");
                              const due = toDatetimeLocalValue(
                                new Date(
                                  calSelected.getFullYear(),
                                  calSelected.getMonth(),
                                  calSelected.getDate(),
                                  10,
                                  0,
                                ).toISOString(),
                              );
                              const parts = splitDateTime(due);
                              setDueDate(parts.date);
                              setDueTime(parts.time || "10:00");
                              setCategory("work");
                              setPriority("medium");
                              setInterval("none");
                              setNotifyOn(true);
                              setLeadMin("15");
                              setChSystem(true);
                              setChTelegram(false);
                              setAttachments([]);
                              setCreateOpen(true);
                            }}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Eslatma qo‘shish
                          </Button>
                        </div>
                      ) : (
                        calSelectedItems.map((r) => {
                          const col = boardColumnFor(r);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => setDetailId(r.id)}
                              className="w-full rounded-xl border border-border bg-card p-3 text-left shadow-sm transition hover:border-sky-300 hover:shadow-md dark:hover:border-sky-500/40"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-semibold text-foreground">{r.title}</p>
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                                    col === "missed" && "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
                                    col === "done" &&
                                      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
                                    col === "today" &&
                                      "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                                    col !== "missed" &&
                                      col !== "done" &&
                                      col !== "today" &&
                                      "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
                                  )}
                                >
                                  {col === "missed"
                                    ? "Kechikkan"
                                    : col === "done"
                                      ? "Bajarilgan"
                                      : col === "today"
                                        ? "Bugun"
                                        : "Reja"}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(r.dueAt)}</p>
                            </button>
                          );
                        })
                      )}
                    </div>
                    {calSelectedItems.length ? (
                      <div className="border-t border-border p-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 w-full gap-1.5 rounded-xl text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10"
                          onClick={() => {
                            const due = toDatetimeLocalValue(
                              new Date(
                                calSelected.getFullYear(),
                                calSelected.getMonth(),
                                calSelected.getDate(),
                                10,
                                0,
                              ).toISOString(),
                            );
                            const parts = splitDateTime(due);
                            setCreateCol("today");
                            setFormTab("main");
                            setTitle("");
                            setDescription("");
                            setDueDate(parts.date);
                            setDueTime(parts.time || "10:00");
                            setCategory("work");
                            setPriority("medium");
                            setInterval("none");
                            setNotifyOn(true);
                            setLeadMin("15");
                            setChSystem(true);
                            setChTelegram(false);
                            setAttachments([]);
                            setCreateOpen(true);
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Shu kunga qo‘shish
                        </Button>
                      </div>
                    ) : null}
                  </aside>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Analytics footer */}
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-sm font-semibold text-foreground">Kategoriyalar bo‘yicha taqsimot</p>
            <p className="text-xs text-muted-foreground">Jami {reminders.length} eslatma</p>
            <div className="mt-3 flex items-center gap-4">
              <div className="h-40 w-40">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryStats.length ? categoryStats : [{ name: "Bo‘sh", value: 1, color: "#e2e8f0" }]} dataKey="value" innerRadius={42} outerRadius={68} paddingAngle={2}>
                      {(categoryStats.length ? categoryStats : [{ color: "#e2e8f0" }]).map((e, i) => (
                        <Cell key={i} fill={e.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-0 flex-1 space-y-1.5">
                {categoryStats.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                      {c.name}
                    </span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {c.value} · {c.pct}%
                    </span>
                  </li>
                ))}
                {!categoryStats.length ? <li className="text-xs text-muted-foreground">Hali ma’lumot yo‘q</li> : null}
              </ul>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-sm font-semibold text-foreground">Ustuvorlik bo‘yicha</p>
            <div className="mt-4 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={priorityStats} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {priorityStats.map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-sm font-semibold text-foreground">So‘nggi bajarilganlar</p>
            <ul className="mt-3 space-y-2">
              {recentDone.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/70 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatShort(r.completedAt || r.updatedAt)}</span>
                </li>
              ))}
              {!recentDone.length ? <li className="py-8 text-center text-xs text-muted-foreground">Hali bajarilganlar yo‘q</li> : null}
            </ul>
          </div>
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          hideClose
          className="flex max-h-[92vh] w-[calc(100%-1.25rem)] flex-col gap-0 overflow-hidden rounded-3xl border-border p-0 shadow-2xl sm:max-w-2xl"
        >
          <div className="relative border-b border-border/70 bg-gradient-to-br from-sky-50 via-background to-violet-50/40 px-5 pb-0 pt-5 dark:from-sky-950/40 dark:to-violet-950/30 sm:px-6">
            <div className="flex items-start gap-3 pr-10">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card text-sky-600 shadow-sm ring-1 ring-sky-100 dark:ring-sky-500/30">
                <Bell className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-xl font-bold tracking-tight text-foreground">Yangi eslatma</DialogTitle>
                <DialogDescription className="mt-0.5 text-sm text-muted-foreground">
                  Muhim ishni unutmang
                </DialogDescription>
              </div>
            </div>
            <button
              type="button"
              aria-label="Yopish"
              className="absolute right-4 top-4 rounded-xl p-2 text-muted-foreground transition hover:bg-card hover:text-foreground"
              onClick={() => setCreateOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="mt-4 flex gap-1 overflow-x-auto">
              {(
                [
                  { id: "main" as const, label: "Asosiy" },
                  { id: "extra" as const, label: "Fayl biriktirish" },
                  { id: "repeat" as const, label: "Takrorlash" },
                  { id: "notify" as const, label: "Bildirishnoma" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFormTab(tab.id)}
                  className={cn(
                    "relative shrink-0 rounded-t-xl px-3.5 py-2.5 text-sm font-semibold transition",
                    formTab === tab.id
                      ? "bg-card text-sky-700 dark:text-sky-300"
                      : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {formTab === tab.id ? (
                    <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-sky-500" />
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[58vh] space-y-4 overflow-y-auto px-5 py-4">
            {formTab === "main" ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground/90">
                    Eslatma nomi <span className="text-rose-500">*</span>
                  </label>
                  <Input
                    value={title}
                    maxLength={100}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Masalan: Hisobot tayyorlash, Majlis, Tekshiruv..."
                    className="h-11"
                  />
                  <p className="text-right text-[11px] text-muted-foreground">{title.length}/100</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground/90">Tavsif</label>
                  <Textarea
                    value={description}
                    maxLength={500}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Eslatma haqida batafsil ma’lumot..."
                    rows={3}
                  />
                  <p className="text-right text-[11px] text-muted-foreground">{description.length}/500</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">
                    Toifa <span className="text-rose-500">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {CATEGORIES.map((c) => {
                      const Icon = c.icon;
                      const on = category === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setCategory(c.id)}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-medium transition",
                            on ? "border-violet-400 bg-violet-50 text-violet-700 ring-1 ring-violet-200" : "border-border bg-card text-muted-foreground hover:border-border",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground/90">
                    Kimga? <span className="text-rose-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAssignMode("self");
                        setTargetUserIds([]);
                      }}
                      className={cn(
                        "flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-left text-sm font-semibold transition",
                        assignMode === "self"
                          ? "border-sky-400 bg-sky-50 text-sky-800 ring-2 ring-sky-200/80 dark:bg-sky-500/15 dark:text-sky-200"
                          : "border-border bg-card text-muted-foreground hover:border-border",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                          assignMode === "self" ? "border-sky-500 bg-sky-500 text-white" : "border-border bg-card",
                        )}
                      >
                        {assignMode === "self" ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      <User className="h-4 w-4 text-sky-600" />
                      O‘zim uchun
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignMode("staff")}
                      className={cn(
                        "flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-left text-sm font-semibold transition",
                        assignMode === "staff"
                          ? "border-violet-400 bg-violet-50 text-violet-800 ring-2 ring-violet-200/80 dark:bg-violet-500/15 dark:text-violet-200"
                          : "border-border bg-card text-muted-foreground hover:border-border",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                          assignMode === "staff" ? "border-violet-500 bg-violet-500 text-white" : "border-border bg-card",
                        )}
                      >
                        {assignMode === "staff" ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      <Users className="h-4 w-4 text-violet-600" />
                      Xodimlar
                    </button>
                  </div>
                  {assignMode === "self" ? (
                    <p className="text-xs text-muted-foreground">Bu eslatma faqat sizga ko‘rinadi</p>
                  ) : (
                    <div className="space-y-3 rounded-2xl border border-violet-300/60 bg-violet-50/60 p-3 dark:border-violet-500/40 dark:bg-violet-950/40">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="text-xs font-bold uppercase tracking-wide text-violet-800 dark:text-violet-100">
                          Xodimlarni tanlang
                        </label>
                        <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">
                          {targetUserIds.length} tanlangan
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                          <Checkbox
                            checked={filterOfis}
                            onCheckedChange={(v) => setFilterOfis(v === true)}
                          />
                          <Building2 className="h-3.5 w-3.5 text-sky-600" />
                          Ofis
                        </label>
                        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                          <Checkbox
                            checked={filterDorixona}
                            onCheckedChange={(v) => setFilterDorixona(v === true)}
                          />
                          <Store className="h-3.5 w-3.5 text-emerald-600" />
                          Dorixona
                        </label>
                        <button
                          type="button"
                          onClick={toggleAllFilteredStaff}
                          className="ml-auto text-[11px] font-bold text-violet-700 underline-offset-2 hover:underline dark:text-violet-200"
                        >
                          {filteredStaff.length > 0 &&
                          filteredStaff.every((s) => targetUserIds.includes(s.id))
                            ? "Filtrdan olib tashlash"
                            : "Filtrdagilarni tanlash"}
                        </button>
                      </div>

                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-violet-500" />
                        <Input
                          value={staffSearch}
                          onChange={(e) => setStaffSearch(e.target.value)}
                          placeholder="Qidirish: ism, lavozim..."
                          className="h-10 rounded-xl border-violet-200 bg-white pl-9 text-sm dark:border-violet-500/30 dark:bg-slate-950"
                        />
                      </div>

                      {targetUserIds.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {targetUserIds.map((id) => {
                            const s = staffOptions.find((x) => x.id === id);
                            if (!s) return null;
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => toggleTargetUser(id)}
                                className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-300 bg-white px-2 py-1 text-[11px] font-semibold text-violet-900 dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-50"
                              >
                                <span className="truncate">{s.name}</span>
                                <X className="h-3 w-3 shrink-0 opacity-70" />
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

                      <div className="max-h-52 overflow-y-auto rounded-xl border border-violet-200/80 bg-white dark:border-violet-700/40 dark:bg-slate-950">
                        {filteredStaff.length === 0 ? (
                          <p className="px-3 py-6 text-center text-xs font-medium text-rose-600 dark:text-rose-300">
                            {!filterOfis && !filterDorixona
                              ? "Ofis yoki Dorixona filtrini yoqing"
                              : staffOptions.length === 0
                                ? "Faol xodimlar topilmadi"
                                : "Qidiruv bo‘yicha xodim yo‘q"}
                          </p>
                        ) : (
                          <ul className="divide-y divide-violet-100 dark:divide-violet-900/50">
                            {filteredStaff.map((s) => {
                              const on = targetUserIds.includes(s.id);
                              return (
                                <li key={s.id}>
                                  <button
                                    type="button"
                                    onClick={() => toggleTargetUser(s.id)}
                                    className={cn(
                                      "flex w-full items-center gap-3 px-3 py-2.5 text-left transition",
                                      on
                                        ? "bg-violet-50 dark:bg-violet-500/20"
                                        : "hover:bg-violet-50/70 dark:hover:bg-violet-500/10",
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                                        on
                                          ? "border-violet-600 bg-violet-600 text-white"
                                          : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900",
                                      )}
                                    >
                                      {on ? <Check className="h-3.5 w-3.5" /> : null}
                                    </span>
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0a2540] to-[#0b5fff] text-[11px] font-bold text-white">
                                      {s.name.charAt(0).toUpperCase()}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">
                                        {s.name}
                                      </span>
                                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                                        <span
                                          className={cn(
                                            "rounded-md px-1.5 py-0.5",
                                            s.workplace === "ofis"
                                              ? "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200"
                                              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
                                          )}
                                        >
                                          {s.workplace === "ofis" ? "Ofis" : "Dorixona"}
                                        </span>
                                        {s.meta ? <span className="truncate">{s.meta}</span> : null}
                                      </span>
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      <p className="text-xs font-medium leading-snug text-violet-900/90 dark:text-violet-100">
                        Bitta yoki bir nechta xodimga eslatma yuboriladi va «Boshqalarning»da
                        ko‘rinadi.
                      </p>
                    </div>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground/90">
                      Sana <span className="text-rose-500">*</span>
                    </label>
                    <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground/90">
                      Vaqt <span className="text-rose-500">*</span>
                    </label>
                    <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="h-11" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/90">Ustuvorlik</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {PRIORITIES.map((p) => {
                      const on = priority === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPriority(p.id)}
                          className={cn(
                            "inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold transition",
                            on ? p.className + " ring-2 ring-offset-1 ring-sky-300" : "border-border bg-card text-muted-foreground",
                          )}
                        >
                          <span className={cn("h-2 w-2 rounded-full", p.dot)} />
                          {p.label}
                          {p.id === "high" ? <ArrowUp className="h-3 w-3" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : null}

            {formTab === "extra" ? (
              <>
                <FileDropzone inputRef={fileRef} onPick={onPickFiles} />
                {attachments.length > 0 ? (
                  <ul className="space-y-1.5">
                    {attachments.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm">
                        <span className="truncate">{a.name}</span>
                        <button type="button" className="text-muted-foreground hover:text-rose-600" onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}

            {formTab === "repeat" ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground/90">Takrorlash</label>
                <Select value={interval} onValueChange={setInterval}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVALS.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Takroriy eslatma muddatgacha davom etadi.</p>
              </div>
            ) : null}

            {formTab === "notify" ? (
              <>
                <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Bildirishnoma yuborish</p>
                    <p className="text-xs text-muted-foreground">Muddat yaqinlashganda ogohlantirish</p>
                  </div>
                  <Switch checked={notifyOn} onCheckedChange={setNotifyOn} />
                </div>
                {notifyOn ? (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground/90">Qachon</label>
                      <Select value={leadMin} onValueChange={setLeadMin}>
                        <SelectTrigger className="h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LEAD_OPTS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground/90">Eslatma kanallari</p>
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                        <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={chSystem} onChange={(e) => setChSystem(e.target.checked)} />
                        <div>
                          <p className="text-sm font-medium text-foreground">Tizim ichida</p>
                          <p className="text-xs text-muted-foreground">Ilova bildirishnomalari</p>
                        </div>
                      </label>
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                        <input type="checkbox" className="h-4 w-4 accent-sky-600" checked={chTelegram} onChange={(e) => setChTelegram(e.target.checked)} />
                        <div>
                          <p className="text-sm font-medium text-foreground">Telegram</p>
                          <p className="text-xs text-muted-foreground">Bot orqali xabar</p>
                        </div>
                      </label>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-3 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Bekor qilish
            </Button>
            <Button type="button" className="gap-2 bg-sky-600 hover:bg-sky-700" onClick={submitCreate} disabled={createMut.isPending}>
              <Save className="h-4 w-4" />
              Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail */}
      <Dialog open={detailId != null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.title || "Eslatma"}</DialogTitle>
          </DialogHeader>
          {!detail ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-4 py-1">
              {detail.description ? <p className="whitespace-pre-wrap text-sm text-foreground/90">{detail.description}</p> : null}
              <div className="flex flex-wrap gap-2">
                <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", priMeta(detail.priority).className)}>
                  {priMeta(detail.priority).label}
                </span>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {catMeta(detail.category).label}
                </span>
                {detail.notifySystem ? (
                  <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">Tizim</span>
                ) : null}
                {detail.notifyTelegram ? (
                  <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-medium text-cyan-700">Telegram</span>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl border bg-muted/40 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Muddat</p>
                  <p className="font-medium">{formatDate(detail.dueAt)}</p>
                </div>
                <div className="rounded-xl border bg-muted/40 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">Qolgan</p>
                  <p className="font-medium">{detail.remainingLabel}</p>
                </div>
              </div>
              {detail.attachments?.length ? (
                <ul className="space-y-1">
                  {detail.attachments.map((a) => (
                    <li key={a.id}>
                      <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm hover:bg-muted/40">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{a.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <History className="h-3.5 w-3.5" />
                  Tarix
                </p>
                <ul className="max-h-40 space-y-2 overflow-y-auto">
                  {(detail.events ?? []).map((ev) => (
                    <li key={ev.id} className="rounded-lg border px-3 py-2 text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="font-semibold">{EVENT_LABELS[ev.eventType] || ev.eventType}</span>
                        <span className="text-muted-foreground">{formatDate(ev.createdAt)}</span>
                      </div>
                      {ev.note ? <p className="mt-0.5 text-muted-foreground">{ev.note}</p> : null}
                    </li>
                  ))}
                  {!detail.events?.length ? <li className="text-center text-muted-foreground">Tarix bo‘sh</li> : null}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {detail.status !== "completed" && detail.forMe !== false ? (
                  <Button
                    size="sm"
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                    disabled={completeMut.isPending}
                    onClick={() => markDone(detail.id)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Bajardim
                  </Button>
                ) : detail.status === "completed" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    <Check className="h-3.5 w-3.5" />
                    Bajarilgan
                  </span>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    setNewDue(toDatetimeLocalValue(detail.dueAt));
                    setPostponeNote("");
                    setPostponeOpen(true);
                  }}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  Muddatni ko‘chirish
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-rose-600"
                  onClick={async () => {
                    if (!confirm("Eslatmani o‘chirasizmi?")) return;
                    try {
                      await deleteMut.mutateAsync(detail.id);
                      setDetailId(null);
                      toast({ title: "O‘chirildi" });
                    } catch (e: any) {
                      toast({ title: "Xato", description: e.message, variant: "destructive" });
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  O‘chirish
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={postponeOpen} onOpenChange={setPostponeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Muddatni ko‘chirish</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Input type="datetime-local" value={newDue} onChange={(e) => setNewDue(e.target.value)} />
            <Textarea value={postponeNote} onChange={(e) => setPostponeNote(e.target.value)} placeholder="Izoh..." rows={2} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPostponeOpen(false)}>
              Bekor
            </Button>
            <Button onClick={submitPostpone} disabled={postponeMut.isPending}>
              Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FileDropzone({
  inputRef,
  onPick,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (files: FileList | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground/90">Fayl biriktirish</p>
      <label
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onPick(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition",
          dragging ? "border-sky-400 bg-sky-50" : "border-border bg-muted/40 hover:border-sky-300",
        )}
      >
        <FolderOpen className="h-8 w-8 text-sky-500" />
        <p className="text-sm font-medium text-foreground/90">Faylni tanlang yoki bu yerga sudrab tashlang</p>
        <p className="text-xs text-muted-foreground">PDF, DOC, XLS, PNG — max 10 MB</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
          onChange={(e) => onPick(e.target.files)}
        />
      </label>
    </div>
  );
}
