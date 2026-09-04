import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetUsers,
  useGetEmployees,
} from "@workspace/api-client-react";
import {
  Plus,
  Calendar,
  Paperclip,
  FileText,
  Trash2,
  CheckCircle2,
  X,
  User,
  Flag,
  Search,
  Check,
  ChevronsUpDown,
  Clock,
  Send,
  BarChart3,
  LayoutGrid,
  List,
  CalendarDays,
  Folder,
  MessageSquare,
  MoreHorizontal,
  FileSpreadsheet,
  Archive,
  LayoutTemplate,
  AlertTriangle,
  PlayCircle,
  CircleDot,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  useGetTasks,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  useCompleteTask,
  useAcceptTask,
  useRequestExtension,
  useResolveExtension,
  useVerifyTask,
  useSendTaskMessage,
  fileToAttachment,
  type Vazifa,
  type TaskAttachment,
} from "@/lib/vazifalar-api";

import { HR_ROLES, userRoleLabel } from "@/lib/roles";
import { useI18n } from "@/i18n/I18nProvider";
import { TaskFormDialog } from "@/components/vazifalar/TaskFormDialog";

type BoardCol = "past" | "today" | "progress" | "review" | "completed";
type BoardView = "kanban" | "list" | "calendar";

const ASSIGNER_ROLES = new Set([
  "admin",
  ...HR_ROLES,
  "director",
  "department_head",
  "recruiter",
  "trainer",
  "mudir",
  "koordinator",
  "sb",
  "sb_boshliq",
  "reviziya_rahbar",
  "it_rahbar",
  "texnik_rahbar",
]);

const COLUMNS: {
  id: BoardCol;
  labelKey: string;
  hintKey: string;
  top: string;
  headerBg: string;
  countBg: string;
  emptyKey: string;
  allowCreate?: boolean;
  accentDot: string;
}[] = [
  {
    id: "past",
    labelKey: "tasks.overdue",
    hintKey: "tasks.overdueHint",
    top: "bg-rose-500",
    headerBg: "bg-rose-50/90 dark:bg-rose-500/10",
    countBg: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
    emptyKey: "tasks.empty.overdue",
    allowCreate: true,
    accentDot: "bg-rose-500",
  },
  {
    id: "today",
    labelKey: "tasks.today",
    hintKey: "tasks.todayHint",
    top: "bg-amber-500",
    headerBg: "bg-amber-50/90 dark:bg-amber-500/10",
    countBg: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
    emptyKey: "tasks.empty.today",
    allowCreate: true,
    accentDot: "bg-amber-500",
  },
  {
    id: "progress",
    labelKey: "tasks.inProgress",
    hintKey: "tasks.inProgressHint",
    top: "bg-sky-500",
    headerBg: "bg-sky-50/90 dark:bg-sky-500/10",
    countBg: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
    emptyKey: "tasks.empty.progress",
    allowCreate: true,
    accentDot: "bg-sky-500",
  },
  {
    id: "review",
    labelKey: "tasks.review",
    hintKey: "tasks.reviewHint",
    top: "bg-violet-500",
    headerBg: "bg-violet-50/90 dark:bg-violet-500/10",
    countBg: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
    emptyKey: "tasks.empty.review",
    allowCreate: false,
    accentDot: "bg-violet-500",
  },
  {
    id: "completed",
    labelKey: "tasks.done",
    hintKey: "tasks.doneHint",
    top: "bg-emerald-500",
    headerBg: "bg-emerald-50/90 dark:bg-emerald-500/10",
    countBg: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
    emptyKey: "tasks.empty.done",
    allowCreate: false,
    accentDot: "bg-emerald-500",
  },
];

const PRIORITY_CLASS: Record<string, string> = {
  low: "bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/30",
  normal: "bg-amber-50 text-amber-800 border-amber-200/80 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30",
  high: "bg-orange-50 text-orange-800 border-orange-200/80 dark:bg-orange-500/15 dark:text-orange-200 dark:border-orange-500/30",
  urgent: "bg-rose-50 text-rose-800 border-rose-200/80 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-500/30",
};

const surface =
  "rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm shadow-black/[0.03] dark:shadow-black/20";
const control =
  "h-9 border-border bg-muted/40 text-xs text-foreground dark:bg-muted/30";

const PRIORITY_KEYS: Record<string, string> = {
  low: "tasks.priority.low",
  normal: "tasks.priority.normal",
  high: "tasks.priority.high",
  urgent: "tasks.priority.urgent",
};

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function boardColumnFor(task: Vazifa, now = new Date()): BoardCol {
  if (task.status === "verified" || task.status === "cancelled") return "completed";
  if (task.status === "done") return "review";

  const dueAt = task.dueAt || task.createdAt;
  if (dueAt) {
    const due = startOfDay(new Date(dueAt));
    const today = startOfDay(now);
    if (due.getTime() < today.getTime()) return "past";
    if (due.getTime() === today.getTime()) return "today";
  }
  return "progress";
}

function initialsFromName(name: string | null | undefined) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

function checklistProgress(task: Vazifa) {
  const list = task.meta?.checklist;
  if (!Array.isArray(list) || list.length === 0) {
    if (task.status === "todo") return 10;
    if (task.status === "in_progress") return 55;
    if (task.status === "done") return 90;
    if (task.status === "verified") return 100;
    return 0;
  }
  const done = list.filter((c) => c.done).length;
  return Math.round((done / list.length) * 100);
}

function taskTypeLabel(type: string | undefined, t: (k: string) => string) {
  if (!type) return "";
  const key = `tasks.form.type.${type}`;
  const labeled = t(key);
  return labeled === key ? type : labeled;
}

function toDatetimeLocalValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VazifalarPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useI18n();
  const [location] = useLocation();
  const deepLinkParams = useMemo(() => {
    const qs = typeof window !== "undefined" ? window.location.search : "";
    return new URLSearchParams(qs.startsWith("?") ? qs.slice(1) : qs);
  }, [location]);
  const deepTaskId = deepLinkParams.get("task");
  const deepQ = deepLinkParams.get("q");
  const deepAssigneeKind = deepLinkParams.get("assigneeKind");
  const deepAssigneeId = deepLinkParams.get("assigneeId");
  const canAssign = !!user && ASSIGNER_ROLES.has(user.role);

  const [search, setSearch] = useState(deepQ || "");
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewMode, setViewMode] = useState<BoardView>(() => {
    const v = deepLinkParams.get("view");
    if (v === "list" || v === "calendar" || v === "kanban") return v;
    return "kanban";
  });
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [calMonth, setCalMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selectedCalDay, setSelectedCalDay] = useState(() => startOfDay(new Date()));
  const [assigneeFilter, setAssigneeFilter] = useState<{
    kind: "user" | "employee";
    id: number;
    name: string;
  } | null>(null);

  const needsAllBoard = !!(deepTaskId || deepAssigneeKind || assigneeFilter);
  const { data: tasks = [], isLoading } = useGetTasks({
    board: needsAllBoard ? "all" : "active",
  });
  const { data: users = [] } = useGetUsers({ status: "active" } as any);
  const { data: employees = [] } = useGetEmployees(undefined as any);

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const completeTask = useCompleteTask();
  const acceptTask = useAcceptTask();
  const requestExtension = useRequestExtension();
  const resolveExtension = useResolveExtension();
  const verifyTask = useVerifyTask();
  const sendTaskMessage = useSendTaskMessage();

  const [editOpen, setEditOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [editing, setEditing] = useState<Vazifa | null>(null);
  const [activeTask, setActiveTask] = useState<Vazifa | null>(null);
  const [createDueAt, setCreateDueAt] = useState<string | null>(null);
  const deepLinkHandled = useRef<string | null>(null);

  const [completionNote, setCompletionNote] = useState("");
  const [completionFiles, setCompletionFiles] = useState<TaskAttachment[]>([]);
  const [completeUploading, setCompleteUploading] = useState(false);
  const completeFileRef = useRef<HTMLInputElement>(null);

  const [extendDue, setExtendDue] = useState("");
  const [extendNote, setExtendNote] = useState("");
  const [viewChatDraft, setViewChatDraft] = useState("");
  const [viewChatBusy, setViewChatBusy] = useState(false);

  useEffect(() => {
    if (deepQ && !deepAssigneeKind) setSearch(deepQ);
  }, [deepQ, deepAssigneeKind]);

  useEffect(() => {
    if (!deepTaskId || !tasks.length) return;
    if (deepLinkHandled.current === deepTaskId) return;
    const found = tasks.find((t) => String(t.id) === deepTaskId);
    if (!found) return;
    deepLinkHandled.current = deepTaskId;
    setActiveTask(found);
    setViewOpen(true);
  }, [deepTaskId, tasks]);

  const assigneeOptions = useMemo(() => {
    const normName = (s: string) =>
      String(s || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    const activeUserStatuses = new Set(["active", "on_leave"]);
    const activeEmpStatuses = new Set(["working", "new", "on_leave"]);

    const activeUsers = (users as any[]).filter((x) =>
      activeUserStatuses.has(String(x.status || "")),
    );
    const linkedUserIds = new Set<number>(
      activeUsers.map((x) => Number(x.id)).filter((id) => Number.isFinite(id)),
    );
    const linkedNames = new Set(
      activeUsers.map((x) => normName(x.fullName)).filter(Boolean),
    );

    const u = activeUsers.map((x) => {
      const roleMeta = userRoleLabel(x.role) || String(x.role || "").replace(/_/g, " ");
      return {
        key: `user:${x.id}`,
        name: String(x.fullName || "").trim(),
        label: `${x.fullName} · ${roleMeta}`,
        kind: "user" as const,
        id: x.id as number,
        meta: roleMeta,
      };
    });

    const e = (employees as any[])
      .filter((x) => activeEmpStatuses.has(String(x.employmentStatus || "working")))
      .filter((x) => {
        const uid = x.userId != null ? Number(x.userId) : null;
        if (uid != null && linkedUserIds.has(uid)) return false;
        const name = normName(x.fullName);
        if (name && linkedNames.has(name)) return false;
        return true;
      })
      .map((x) => ({
        key: `employee:${x.id}`,
        name: String(x.fullName || "").trim(),
        label: `${x.fullName} · ${x.position || ""}${x.location ? ` (${x.location})` : ""}`,
        kind: "employee" as const,
        id: x.id as number,
        meta: `${x.position || ""}${x.location ? ` · ${x.location}` : ""}`.trim(),
      }));

    return [...u, ...e].filter((o) => o.name);
  }, [users, employees]);

  useEffect(() => {
    if (!deepAssigneeKind || !deepAssigneeId) return;
    if (deepAssigneeKind !== "user" && deepAssigneeKind !== "employee") return;
    const id = Number(deepAssigneeId);
    if (!Number.isFinite(id)) return;
    const opt = assigneeOptions.find((o) => o.kind === deepAssigneeKind && o.id === id);
    if (opt) {
      setAssigneeFilter({ kind: opt.kind, id: opt.id, name: opt.name });
      setSearch(opt.name);
      return;
    }
    setAssigneeFilter((prev) =>
      prev && prev.kind === deepAssigneeKind && prev.id === id
        ? prev
        : { kind: deepAssigneeKind, id, name: deepQ || prev?.name || `#${id}` },
    );
  }, [deepAssigneeKind, deepAssigneeId, deepQ, assigneeOptions]);

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees as any[]) {
      const loc = String(e?.location || "").trim();
      if (loc) set.add(loc);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uz"));
  }, [employees]);

  const searchStaffList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assigneeOptions.slice(0, 80);
    return assigneeOptions
      .filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.label.toLowerCase().includes(q) ||
          o.meta.toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [assigneeOptions, search]);

  const isCreatorOf = (t: Vazifa) => !!user && t.createdById === user.id;
  const isAssigneeOf = (t: Vazifa) =>
    !!user && t.assigneeKind === "user" && t.assigneeId === user.id;

  const filtered = useMemo(() => {
    let list = tasks.filter((t) => t.status !== "cancelled");
    if (assigneeFilter) {
      list = list.filter(
        (t) =>
          t.assigneeKind === assigneeFilter.kind && t.assigneeId === assigneeFilter.id,
      );
      const q = search.trim().toLowerCase();
      if (q && q !== assigneeFilter.name.toLowerCase()) {
        list = list.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.description || "").toLowerCase().includes(q) ||
            String(t.id).includes(q),
        );
      }
    } else {
      const q = search.trim().toLowerCase();
      if (q) {
        list = list.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.assigneeName || "").toLowerCase().includes(q) ||
            (t.description || "").toLowerCase().includes(q) ||
            String(t.id).includes(q),
        );
      }
    }
    if (priorityFilter !== "all") {
      list = list.filter((t) => t.priority === priorityFilter);
    }
    if (typeFilter !== "all") {
      list = list.filter((t) => (t.meta?.taskType || "other") === typeFilter);
    }
    if (branchFilter !== "all") {
      list = list.filter(
        (t) => String(t.meta?.branchOrDept || "").trim() === branchFilter,
      );
    }
    if (dateFrom) {
      const from = startOfDay(new Date(dateFrom)).getTime();
      list = list.filter((t) => {
        const due = t.dueAt || t.createdAt;
        return due ? new Date(due).getTime() >= from : true;
      });
    }
    if (dateTo) {
      const to = addDays(startOfDay(new Date(dateTo)), 1).getTime();
      list = list.filter((t) => {
        const due = t.dueAt || t.createdAt;
        return due ? new Date(due).getTime() < to : true;
      });
    }
    return list;
  }, [tasks, search, assigneeFilter, priorityFilter, typeFilter, branchFilter, dateFrom, dateTo]);

  function clearSearchFilter() {
    setSearch("");
    setAssigneeFilter(null);
  }

  const byColumn = useMemo(() => {
    const map: Record<BoardCol, Vazifa[]> = {
      past: [],
      today: [],
      progress: [],
      review: [],
      completed: [],
    };
    for (const t of filtered) {
      map[boardColumnFor(t)].push(t);
    }
    for (const k of Object.keys(map) as BoardCol[]) {
      map[k].sort((a, b) => {
        if (k === "completed" || k === "review") {
          const ca = a.completedAt ? new Date(a.completedAt).getTime() : 0;
          const cb = b.completedAt ? new Date(b.completedAt).getTime() : 0;
          return cb - ca;
        }
        const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
        const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
        return da - db;
      });
    }
    return map;
  }, [filtered]);

  const kpi = useMemo(
    () => ({
      total: filtered.length,
      overdue: byColumn.past.length,
      today: byColumn.today.length,
      progress: byColumn.progress.length,
      done: byColumn.completed.length,
    }),
    [filtered.length, byColumn],
  );

  const taskTypes = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.meta?.taskType) set.add(t.meta.taskType);
    }
    return Array.from(set).sort();
  }, [tasks]);

  const topAssignees = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const t of filtered) {
      const name = (t.assigneeName || "").trim() || "—";
      const prev = map.get(name);
      if (prev) prev.count += 1;
      else map.set(name, { name, count: 1 });
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filtered]);

  const todaySchedule = useMemo(() => {
    return [...byColumn.today, ...byColumn.past.filter((t) => {
      if (!t.dueAt) return false;
      return startOfDay(new Date(t.dueAt)).getTime() === startOfDay(new Date()).getTime();
    })]
      .slice(0, 6)
      .sort((a, b) => {
        const da = a.dueAt ? new Date(a.dueAt).getTime() : 0;
        const db = b.dueAt ? new Date(b.dueAt).getTime() : 0;
        return da - db;
      });
  }, [byColumn.today, byColumn.past]);

  function openCreate(presetCol?: BoardCol) {
    setEditing(null);
    const base = startOfDay(new Date());
    let target = base;
    if (presetCol === "past") target = addDays(base, -1);
    if (presetCol === "progress") target = addDays(base, 2);
    target.setHours(18, 0, 0, 0);
    setCreateDueAt(target.toISOString());
    setEditOpen(true);
  }

  function exportCsv() {
    const rows = [
      ["ID", "Title", "Status", "Priority", "Assignee", "Due", "CreatedBy"].join(","),
      ...filtered.map((t) =>
        [
          t.id,
          `"${(t.title || "").replace(/"/g, '""')}"`,
          t.status,
          t.priority,
          `"${(t.assigneeName || "").replace(/"/g, '""')}"`,
          t.dueAt || "",
          `"${(t.createdByName || "").replace(/"/g, '""')}"`,
        ].join(","),
      ),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `topshiriqlar-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: t("tasks.exportDone") });
  }

  function openEdit(task: Vazifa) {
    if (!isCreatorOf(task) && user?.role !== "admin") {
      setActiveTask(task);
      setViewOpen(true);
      return;
    }
    setEditing(task);
    setCreateDueAt(null);
    setEditOpen(true);
  }

  function openComplete(task: Vazifa) {
    setActiveTask(task);
    setCompletionNote("");
    setCompletionFiles([]);
    setCompleteOpen(true);
  }

  function openExtend(task: Vazifa) {
    setActiveTask(task);
    const base = task.dueAt ? new Date(task.dueAt) : new Date();
    base.setDate(base.getDate() + 1);
    setExtendDue(toDatetimeLocalValue(base.toISOString()));
    setExtendNote("");
    setExtendOpen(true);
  }

  async function onPickFiles(
    files: FileList | null,
    setter: React.Dispatch<React.SetStateAction<TaskAttachment[]>>,
    setUploading: React.Dispatch<React.SetStateAction<boolean>>,
  ) {
    if (!files?.length) return;
    const picked = Array.from(files);
    setUploading(true);
    try {
      const converted: TaskAttachment[] = [];
      for (const file of picked) {
        converted.push(await fileToAttachment(file));
      }
      setter((prev) => {
        const next = [...prev];
        for (const att of converted) {
          if (next.length >= 8) break;
          next.push(att);
        }
        return next;
      });
      toast({
        title: "Fayl yuklandi",
        description: `${picked.length} ta fayl qo‘shildi`,
      });
    } catch (e: any) {
      toast({
        title: "Fayl qo'shilmadi",
        description: e?.message || "Xato",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleSave(payload: import("@/lib/vazifalar-api").VazifaInput) {
    try {
      if (editing) {
        await updateTask.mutateAsync({ id: editing.id, data: payload });
        toast({ title: "Vazifa yangilandi" });
      } else {
        await createTask.mutateAsync(payload);
        toast({ title: "Vazifa yaratildi" });
      }
      setEditOpen(false);
    } catch (e: any) {
      toast({
        title: "Saqlanmadi",
        description: e?.message || "Xato",
        variant: "destructive",
      });
    }
  }

  async function handlePersistChat(patch: {
    meta: import("@/lib/vazifalar-api").TaskMeta;
    attachments: import("@/lib/vazifalar-api").TaskAttachment[];
  }) {
    if (!editing) return;
    const updated = await updateTask.mutateAsync({
      id: editing.id,
      data: {
        meta: patch.meta,
        attachments: patch.attachments,
      },
    });
    setEditing(updated);
  }

  async function handleComplete() {
    if (!activeTask) return;
    if (!completionNote.trim() && completionFiles.length === 0) {
      toast({
        title: "Natija qo'shing",
        description: "Matn, rasm yoki fayl majburiy",
        variant: "destructive",
      });
      return;
    }
    try {
      await completeTask.mutateAsync({
        id: activeTask.id,
        completionNote: completionNote.trim() || null,
        completionAttachments: completionFiles,
      });
      toast({ title: "Bajarildi — belgilovchiga yuborildi" });
      setCompleteOpen(false);
    } catch (e: any) {
      toast({
        title: "Yuborilmadi",
        description: e?.message,
        variant: "destructive",
      });
    }
  }

  async function handleExtend() {
    if (!activeTask || !extendDue) return;
    try {
      await requestExtension.mutateAsync({
        id: activeTask.id,
        dueAt: new Date(extendDue).toISOString(),
        note: extendNote.trim() || undefined,
      });
      toast({ title: "Muddat so'rovi yuborildi" });
      setExtendOpen(false);
    } catch (e: any) {
      toast({
        title: "So'rov yuborilmadi",
        description: e?.message,
        variant: "destructive",
      });
    }
  }

  async function handleAccept(task: Vazifa) {
    try {
      await acceptTask.mutateAsync(task.id);
      toast({ title: "Vazifa qabul qilindi" });
    } catch (e: any) {
      toast({
        title: "Qabul qilinmadi",
        description: e?.message,
        variant: "destructive",
      });
    }
  }

  async function handleVerify(task: Vazifa, action: "approve" | "rework") {
    let note: string | undefined;
    if (action === "rework") {
      note =
        prompt("Qayta ishlash sababi (ixtiyoriy):") || undefined;
    }
    try {
      await verifyTask.mutateAsync({ id: task.id, action, note });
      toast({
        title:
          action === "approve"
            ? "Tasdiqlandi — vazifa yakunlandi"
            : "Qayta ishlashga qaytarildi",
      });
    } catch (e: any) {
      toast({
        title: "Xato",
        description: e?.message,
        variant: "destructive",
      });
    }
  }

  async function handleResolveExtension(
    task: Vazifa,
    action: "approve" | "reject",
  ) {
    try {
      await resolveExtension.mutateAsync({ id: task.id, action });
      toast({
        title: action === "approve" ? "Muddat uzaytirildi" : "So'rov rad etildi",
      });
    } catch (e: any) {
      toast({
        title: "Xato",
        description: e?.message,
        variant: "destructive",
      });
    }
  }

  async function removeTask(task: Vazifa) {
    if (!confirm(`«${task.title}» o'chirilsinmi?`)) return;
    try {
      await deleteTask.mutateAsync(task.id);
      toast({ title: "Vazifa o'chirildi" });
    } catch (e: any) {
      toast({
        title: "O'chirilmadi",
        description: e?.message,
        variant: "destructive",
      });
    }
  }

  function renderTaskCard(task: Vazifa, colId: BoardCol) {
    return (
      <TaskCard
        key={task.id}
        task={task}
        column={colId}
        overdue={colId === "past"}
        isCreator={isCreatorOf(task)}
        isAssignee={isAssigneeOf(task)}
        onOpen={() => openEdit(task)}
        onComplete={() => openComplete(task)}
        onExtend={() => openExtend(task)}
        onDelete={() => removeTask(task)}
        onApproveExt={() => void handleResolveExtension(task, "approve")}
        onRejectExt={() => void handleResolveExtension(task, "reject")}
        onVerify={() => void handleVerify(task, "approve")}
        onRework={() => void handleVerify(task, "rework")}
        onAccept={() => void handleAccept(task)}
      />
    );
  }

  const viewTabs: { id: BoardView | "analytics"; labelKey: string; icon: React.ReactNode }[] = [
    { id: "kanban", labelKey: "tasks.view.kanban", icon: <LayoutGrid className="h-3.5 w-3.5" /> },
    { id: "list", labelKey: "tasks.view.list", icon: <List className="h-3.5 w-3.5" /> },
    { id: "calendar", labelKey: "tasks.view.calendar", icon: <CalendarDays className="h-3.5 w-3.5" /> },
    { id: "analytics", labelKey: "tasks.view.analytics", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  ];

  const kpiCards = [
    {
      key: "total",
      label: t("tasks.kpi.total"),
      value: kpi.total,
      icon: CircleDot,
      tone: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
    },
    {
      key: "overdue",
      label: t("tasks.kpi.overdue"),
      value: kpi.overdue,
      icon: AlertTriangle,
      tone: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
    },
    {
      key: "today",
      label: t("tasks.kpi.today"),
      value: kpi.today,
      icon: Calendar,
      tone: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
    },
    {
      key: "progress",
      label: t("tasks.kpi.progress"),
      value: kpi.progress,
      icon: PlayCircle,
      tone: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
    },
    {
      key: "done",
      label: t("tasks.kpi.done"),
      value: kpi.done,
      icon: CheckCircle2,
      tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    },
  ];

  const calYear = calMonth.getFullYear();
  const calMo = calMonth.getMonth();
  const calDaysInMonth = new Date(calYear, calMo + 1, 0).getDate();
  const calStartWeekday = (new Date(calYear, calMo, 1).getDay() + 6) % 7;
  const maxTopCount = Math.max(1, ...topAssignees.map((x) => x.count));
  const weekDays = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];

  function switchView(next: BoardView) {
    setViewMode(next);
    try {
      const url = new URL(window.location.href);
      if (next === "kanban") url.searchParams.delete("view");
      else url.searchParams.set("view", next);
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch {
      /* ignore */
    }
  }

  const selectedDayTasks = useMemo(() => {
    const dayTs = startOfDay(selectedCalDay).getTime();
    return filtered
      .filter((task) => {
        if (!task.dueAt) return false;
        return startOfDay(new Date(task.dueAt)).getTime() === dayTs;
      })
      .sort((a, b) => {
        const da = a.dueAt ? new Date(a.dueAt).getTime() : 0;
        const db = b.dueAt ? new Date(b.dueAt).getTime() : 0;
        return da - db;
      });
  }, [filtered, selectedCalDay]);

  function pickCalendarDay(day: Date) {
    const d = startOfDay(day);
    setSelectedCalDay(d);
    setCalMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  return (
    <div className="flex h-full min-h-0 bg-background">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border/70 bg-card/80 px-4 pb-4 pt-5 backdrop-blur-md supports-[backdrop-filter]:bg-card/70 md:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[1.65rem] font-bold tracking-tight text-foreground md:text-[1.75rem]">
              {t("tasks.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {t("tasks.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label={t("tasks.title")}
              className="inline-flex rounded-xl border border-border/80 bg-muted/60 p-1 dark:bg-muted/40"
            >
              {viewTabs.map((tab) => {
                const active = tab.id !== "analytics" && viewMode === tab.id;
                const className = cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                  active
                    ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                    : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                );
                if (tab.id === "analytics") {
                  return (
                    <Link key={tab.id} href="/vazifalar/tahlil" className={className}>
                      {tab.icon}
                      {t(tab.labelKey)}
                    </Link>
                  );
                }
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={className}
                    onClick={() => switchView(tab.id as BoardView)}
                  >
                    {tab.icon}
                    {t(tab.labelKey)}
                  </button>
                );
              })}
            </div>
            {canAssign && (
              <Button onClick={() => openCreate("today")} className="gap-2 shadow-sm">
                <Plus className="h-4 w-4" />
                {t("tasks.new")}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
          {kpiCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.key}
                className={cn(surface, "flex items-center gap-3 px-3.5 py-3")}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    card.tone,
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {card.label}
                  </p>
                  <p className="text-xl font-bold tabular-nums text-foreground">{card.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className={cn(surface, "mt-4 flex flex-col gap-2 p-2.5 lg:flex-row lg:items-center")}>
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className={cn(control, "w-full lg:w-[150px]")}>
              <SelectValue placeholder={t("tasks.filter.allBranches")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tasks.filter.allBranches")}</SelectItem>
              {branchOptions.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={assigneeFilter ? `${assigneeFilter.kind}:${assigneeFilter.id}` : "all"}
            onValueChange={(v) => {
              if (v === "all") {
                clearSearchFilter();
                return;
              }
              const [kind, idStr] = v.split(":");
              const opt = assigneeOptions.find(
                (o) => o.kind === kind && String(o.id) === idStr,
              );
              if (opt) {
                setAssigneeFilter({ kind: opt.kind, id: opt.id, name: opt.name });
                setSearch(opt.name);
              }
            }}
          >
            <SelectTrigger className={cn(control, "w-full lg:w-[150px]")}>
              <SelectValue placeholder={t("tasks.filter.allStaff")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tasks.filter.allStaff")}</SelectItem>
              {assigneeOptions.slice(0, 60).map((o) => (
                <SelectItem key={o.key} value={`${o.kind}:${o.id}`}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className={cn(control, "w-full lg:w-[145px]")}>
              <SelectValue placeholder={t("tasks.filter.allPriority")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tasks.filter.allPriority")}</SelectItem>
              <SelectItem value="urgent">{t("tasks.priority.urgent")}</SelectItem>
              <SelectItem value="high">{t("tasks.priority.high")}</SelectItem>
              <SelectItem value="normal">{t("tasks.priority.normal")}</SelectItem>
              <SelectItem value="low">{t("tasks.priority.low")}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className={cn(control, "w-full lg:w-[140px]")}>
              <SelectValue placeholder={t("tasks.filter.allTypes")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("tasks.filter.allTypes")}</SelectItem>
              {(taskTypes.length
                ? taskTypes
                : ["report", "audit", "call", "doc", "other"]
              ).map((tp) => (
                <SelectItem key={tp} value={tp}>
                  {taskTypeLabel(tp, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div
            className={cn(
              control,
              "flex items-center gap-1.5 rounded-md border px-2 text-muted-foreground lg:min-w-[210px]",
            )}
          >
            <Calendar className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[95px] bg-transparent text-[11px] text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]"
            />
            <span className="opacity-40">–</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[95px] bg-transparent text-[11px] text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark]"
            />
          </div>

          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  control,
                  "flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 text-left transition",
                  "hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  (searchOpen || assigneeFilter) && "border-primary/50 ring-2 ring-ring/25",
                )}
              >
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    search || assigneeFilter ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {assigneeFilter?.name || search || t("tasks.searchShort")}
                </span>
                {search || assigneeFilter ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      clearSearchFilter();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        clearSearchFilter();
                      }
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="z-[80] w-[var(--radix-popover-trigger-width)] p-0"
              align="start"
              sideOffset={6}
            >
              <Command shouldFilter={false}>
                <CommandInput
                  value={search}
                  onValueChange={(v) => {
                    setSearch(v);
                    setAssigneeFilter(null);
                  }}
                  placeholder={t("tasks.searchEmployee")}
                />
                <CommandList className="max-h-72">
                  <CommandEmpty>{t("tasks.noEmployee")}</CommandEmpty>
                  <CommandGroup heading={t("tasks.filterByAssignee")}>
                    {searchStaffList.map((o) => {
                      const initials = initialsFromName(o.name);
                      const active =
                        !!assigneeFilter &&
                        assigneeFilter.kind === o.kind &&
                        assigneeFilter.id === o.id;
                      return (
                        <CommandItem
                          key={o.key}
                          value={o.label}
                          onSelect={() => {
                            setAssigneeFilter({ kind: o.kind, id: o.id, name: o.name });
                            setSearch(o.name);
                            setSearchOpen(false);
                          }}
                          className="gap-2.5 py-2"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                            {initials || "?"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{o.name}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {o.meta}
                            </span>
                          </span>
                          <Check
                            className={cn(
                              "h-4 w-4 shrink-0 text-primary",
                              active ? "opacity-100" : "opacity-0",
                            )}
                          />
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-5">
        <div key={viewMode} className="min-h-0 min-w-0 animate-in fade-in-0 duration-200">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              {t("ui.loading")}
            </div>
          ) : viewMode === "list" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-foreground">{t("tasks.view.list")}</h2>
                  <p className="text-xs text-muted-foreground">
                    {filtered.length} {t("tasks.filteredCount")}
                  </p>
                </div>
                {canAssign && (
                  <Button size="sm" variant="outline" onClick={() => openCreate("today")}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t("tasks.new")}
                  </Button>
                )}
              </div>
              <div className={cn(surface, "overflow-hidden")}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-semibold">ID</th>
                        <th className="px-4 py-3 font-semibold">{t("tasks.field.title")}</th>
                        <th className="px-4 py-3 font-semibold">{t("tasks.assignee")}</th>
                        <th className="px-4 py-3 font-semibold">{t("tasks.deadline")}</th>
                        <th className="px-4 py-3 font-semibold">{t("tasks.priorityLabel")}</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((task) => {
                        const col = boardColumnFor(task);
                        return (
                          <tr
                            key={task.id}
                            className="cursor-pointer border-b border-border/60 hover:bg-muted/40"
                            onClick={() => openEdit(task)}
                          >
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              TK-{task.id}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-foreground">{task.title}</div>
                              {task.description ? (
                                <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                                  {task.description}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                                  {initialsFromName(task.assigneeName) || "?"}
                                </span>
                                <span className="truncate text-muted-foreground">
                                  {task.assigneeName || "—"}
                                </span>
                              </div>
                            </td>
                            <td
                              className={cn(
                                "px-4 py-3 text-muted-foreground",
                                col === "past" && "font-semibold text-rose-600 dark:text-rose-400",
                              )}
                            >
                              {formatDate(task.dueAt)}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={cn(
                                  "rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                                  PRIORITY_CLASS[task.priority],
                                )}
                              >
                                {t(PRIORITY_KEYS[task.priority] || PRIORITY_KEYS.normal!)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {t(`tasks.status.${task.status}`)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEdit(task);
                                }}
                              >
                                {t("tasks.analytics.openTask")}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filtered.length === 0 && (
                  <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {t("tasks.empty.done")}
                  </div>
                )}
              </div>
            </div>
          ) : viewMode === "calendar" ? (
            <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
              <div className={cn(surface, "p-4")}>
                <div className="mb-4 flex items-center justify-between">
                  <button
                    type="button"
                    className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted"
                    onClick={() => setCalMonth(new Date(calYear, calMo - 1, 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <h3 className="text-sm font-semibold capitalize text-foreground">
                    {calMonth.toLocaleDateString("uz-UZ", { month: "long", year: "numeric" })}
                  </h3>
                  <button
                    type="button"
                    className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted"
                    onClick={() => setCalMonth(new Date(calYear, calMo + 1, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-muted-foreground">
                  {weekDays.map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {Array.from({ length: calStartWeekday }).map((_, i) => (
                    <div key={`e-${i}`} className="min-h-[88px] rounded-lg bg-muted/20" />
                  ))}
                  {Array.from({ length: calDaysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const dayStart = startOfDay(new Date(calYear, calMo, day));
                    const dayTasks = filtered.filter((task) => {
                      if (!task.dueAt) return false;
                      return startOfDay(new Date(task.dueAt)).getTime() === dayStart.getTime();
                    });
                    const isToday = dayStart.getTime() === startOfDay(new Date()).getTime();
                    const isSelected = dayStart.getTime() === startOfDay(selectedCalDay).getTime();
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => pickCalendarDay(dayStart)}
                        className={cn(
                          "min-h-[88px] rounded-lg border border-border/70 bg-card p-1.5 text-left transition hover:border-primary/40 hover:bg-primary/5",
                          isToday && "border-primary/40",
                          isSelected && "border-primary bg-primary/10 ring-2 ring-primary/30",
                        )}
                      >
                        <div
                          className={cn(
                            "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : isToday
                                ? "text-primary"
                                : "text-foreground",
                          )}
                        >
                          {day}
                        </div>
                        <div className="space-y-0.5">
                          {dayTasks.slice(0, 2).map((task) => (
                            <div
                              key={task.id}
                              className="truncate rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEdit(task);
                              }}
                            >
                              {task.title}
                            </div>
                          ))}
                          {dayTasks.length > 2 && (
                            <div className="text-[9px] text-muted-foreground">
                              +{dayTasks.length - 2}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={cn(surface, "flex flex-col p-4")}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">
                      {selectedCalDay.toLocaleDateString("uz-UZ", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {selectedDayTasks.length} {t("tasks.filteredCount")}
                    </p>
                  </div>
                  {canAssign && (
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => {
                        const d = new Date(selectedCalDay);
                        d.setHours(18, 0, 0, 0);
                        setCreateDueAt(d.toISOString());
                        setEditing(null);
                        setEditOpen(true);
                      }}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      {t("tasks.new")}
                    </Button>
                  )}
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                  {selectedDayTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border px-3 py-10 text-center text-sm text-muted-foreground">
                      {t("tasks.empty.today")}
                    </div>
                  ) : (
                    selectedDayTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        className="w-full rounded-xl border border-border/80 bg-muted/20 p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
                        onClick={() => openEdit(task)}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "rounded-md border px-1.5 py-0.5 text-[10px] font-bold",
                              PRIORITY_CLASS[task.priority],
                            )}
                          >
                            {t(PRIORITY_KEYS[task.priority] || PRIORITY_KEYS.normal!)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">TK-{task.id}</span>
                        </div>
                        <div className="text-sm font-semibold text-foreground">{task.title}</div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDate(task.dueAt)}
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                            {initialsFromName(task.assigneeName) || "?"}
                          </span>
                          {task.assigneeName || "—"}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-w-max gap-3 pb-1">
              {COLUMNS.map((col) => (
                <section
                  key={col.id}
                  className={cn(
                    surface,
                    "flex w-[270px] shrink-0 flex-col overflow-hidden md:w-[286px]",
                  )}
                >
                  <header className="shrink-0">
                    <div className={cn("h-1", col.top)} />
                    <div
                      className={cn(
                        "flex items-start justify-between gap-2 px-3 py-3",
                        col.headerBg,
                      )}
                    >
                      <div>
                        <h2 className="text-[14px] font-bold text-foreground">
                          {t(col.labelKey)}
                        </h2>
                        <p className="text-[11px] text-muted-foreground">{t(col.hintKey)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                            col.countBg,
                          )}
                        >
                          {byColumn[col.id].length}
                        </span>
                        <button
                          type="button"
                          className="rounded-md p-1 text-muted-foreground hover:bg-card/80 hover:text-foreground"
                          aria-label="more"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </header>

                  <div className="flex-1 space-y-2.5 overflow-y-auto bg-muted/20 px-2.5 py-2.5 dark:bg-muted/10">
                    {byColumn[col.id].length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border bg-card/60 px-3 py-10 text-center text-sm text-muted-foreground">
                        {t(col.emptyKey)}
                      </div>
                    ) : (
                      byColumn[col.id].map((task) => renderTaskCard(task, col.id))
                    )}
                  </div>

                  {canAssign && (
                    <div className="border-t border-border/60 bg-card p-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          openCreate(
                            col.id === "review" || col.id === "completed" ? "today" : col.id,
                          )
                        }
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t("tasks.new")}
                      </button>
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>

        <aside className="hidden w-[288px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/70 bg-card/40 px-3 pb-4 pt-5 xl:flex">
          <div className={cn(surface, "p-3.5")}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold capitalize text-foreground">
                {calMonth.toLocaleDateString("uz-UZ", { month: "long", year: "numeric" })}
              </h3>
              <div className="flex gap-0.5">
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                  onClick={() => setCalMonth(new Date(calYear, calMo - 1, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                  onClick={() => setCalMonth(new Date(calYear, calMo + 1, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[9px] font-semibold text-muted-foreground">
              {weekDays.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: calStartWeekday }).map((_, i) => (
                <div key={`s-${i}`} className="h-8" />
              ))}
              {Array.from({ length: calDaysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayStart = startOfDay(new Date(calYear, calMo, day));
                const dots = filtered.filter((task) => {
                  if (!task.dueAt) return false;
                  return startOfDay(new Date(task.dueAt)).getTime() === dayStart.getTime();
                });
                const isToday = dayStart.getTime() === startOfDay(new Date()).getTime();
                const isSelected = dayStart.getTime() === startOfDay(selectedCalDay).getTime();
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      pickCalendarDay(dayStart);
                      switchView("calendar");
                    }}
                    className={cn(
                      "flex h-8 flex-col items-center justify-center rounded-md text-[11px] text-foreground transition hover:bg-muted",
                      isSelected && "bg-primary font-bold text-primary-foreground hover:bg-primary",
                      !isSelected && isToday && "font-bold text-primary",
                    )}
                  >
                    {day}
                    {dots.length > 0 && !isSelected && (
                      <span className="mt-0.5 flex gap-0.5">
                        {dots.slice(0, 3).map((task) => {
                          const c = boardColumnFor(task);
                          return (
                            <span
                              key={task.id}
                              className={cn(
                                "h-1 w-1 rounded-full",
                                COLUMNS.find((x) => x.id === c)?.accentDot,
                              )}
                            />
                          );
                        })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={cn(surface, "p-3.5")}>
            <h3 className="mb-3 text-sm font-bold text-foreground">
              {t("tasks.sidebar.schedule")}
            </h3>
            <div className="space-y-2.5">
              {(todaySchedule.length ? todaySchedule : byColumn.today.slice(0, 5)).map(
                (task) => {
                  const time = task.dueAt
                    ? new Date(task.dueAt).toLocaleTimeString("uz-UZ", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—";
                  const col = boardColumnFor(task);
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className="flex w-full gap-2.5 rounded-lg p-1 text-left transition hover:bg-muted/50"
                      onClick={() => openEdit(task)}
                    >
                      <span className="w-10 shrink-0 pt-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                        {time}
                      </span>
                      <span
                        className={cn(
                          "mt-1 h-8 w-0.5 shrink-0 rounded-full",
                          COLUMNS.find((x) => x.id === col)?.accentDot,
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-foreground">
                          {task.title}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {task.assigneeName || "—"}
                        </span>
                      </span>
                    </button>
                  );
                },
              )}
              {todaySchedule.length === 0 && byColumn.today.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("tasks.empty.today")}</p>
              )}
            </div>
          </div>

          <div className={cn(surface, "p-3.5")}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-foreground">{t("tasks.sidebar.topStaff")}</h3>
              <span className="text-[10px] font-medium text-muted-foreground">
                {t("tasks.sidebar.thisWeek")}
              </span>
            </div>
            <div className="space-y-3">
              {topAssignees.map((person, idx) => (
                <div key={person.name} className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {initialsFromName(person.name) || idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {person.name}
                      </span>
                      <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
                        {person.count}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.round((person.count / maxTopCount) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {topAssignees.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("tasks.analytics.emptyPeople")}
                </p>
              )}
            </div>
          </div>

          <div className={cn(surface, "p-3.5")}>
            <h3 className="mb-3 text-sm font-bold text-foreground">{t("tasks.sidebar.quick")}</h3>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  {
                    key: "excel",
                    icon: FileSpreadsheet,
                    label: t("tasks.quick.excel"),
                    tone: "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10",
                    onClick: exportCsv,
                  },
                  {
                    key: "pdf",
                    icon: FileText,
                    label: t("tasks.quick.pdf"),
                    tone: "text-rose-600 dark:text-rose-400 hover:bg-rose-500/10",
                    onClick: () => window.print(),
                  },
                  {
                    key: "tpl",
                    icon: LayoutTemplate,
                    label: t("tasks.quick.templates"),
                    tone: "text-sky-600 dark:text-sky-400 hover:bg-sky-500/10",
                    onClick: () => canAssign && openCreate("today"),
                  },
                  {
                    key: "arch",
                    icon: Archive,
                    label: t("tasks.quick.archive"),
                    tone: "text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10",
                    onClick: () => {
                      setPriorityFilter("all");
                      setTypeFilter("all");
                      setBranchFilter("all");
                      setDateFrom("");
                      setDateTo("");
                      clearSearchFilter();
                      toast({ title: t("tasks.quick.archiveDone") });
                    },
                  },
                ] as const
              ).map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.key}
                    type="button"
                    onClick={action.onClick}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl border border-border/70 bg-muted/30 px-2 py-3 text-center transition",
                      action.tone,
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-[10px] font-semibold text-foreground">
                      {action.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

      <TaskFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={editing}
        assigneeOptions={assigneeOptions}
        branchOptions={branchOptions}
        currentUserName={user?.fullName}
        currentUserRole={user?.role}
        saving={createTask.isPending || updateTask.isPending}
        defaultDueAt={createDueAt}
        onSave={handleSave}
        onPersistChat={handlePersistChat}
      />

      {/* Ijrochi: faqat ko'rish */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{activeTask?.title}</DialogTitle>
          </DialogHeader>
          {activeTask && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground whitespace-pre-wrap">
                {activeTask.description || "Tavsif yo'q"}
              </p>
              <p className="text-muted-foreground">
                Belgilagan: {activeTask.createdByName || "—"}
              </p>
              <p className="text-muted-foreground">
                Muddat: {formatDate(activeTask.dueAt)}
              </p>
              {!!(activeTask.meta as any)?.branchOrDept && (
                <p className="text-muted-foreground">
                  Filial: {String((activeTask.meta as any).branchOrDept)}
                </p>
              )}
              {Array.isArray((activeTask.meta as any)?.tags) &&
                (activeTask.meta as any).tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {((activeTask.meta as any).tags as string[]).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              {Array.isArray((activeTask.meta as any)?.checklist) &&
                (activeTask.meta as any).checklist.length > 0 && (
                  <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-2">
                    {((activeTask.meta as any).checklist as Array<{ id: string; text: string; done: boolean }>).map(
                      (c) => (
                        <li key={c.id} className="flex items-center gap-2 text-xs">
                          <CheckCircle2
                            className={cn(
                              "h-3.5 w-3.5",
                              c.done ? "text-emerald-600" : "text-muted-foreground/40",
                            )}
                          />
                          <span className={cn(c.done && "line-through text-muted-foreground")}>
                            {c.text}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              <AttachmentList items={activeTask.attachments || []} readOnly />

              {/* Task chat (beruvchi / ijrochi) */}
              <div className="space-y-2 rounded-xl border border-border overflow-hidden">
                <div
                  className="relative max-h-56 space-y-2 overflow-y-auto p-3"
                  style={{
                    backgroundImage:
                      "linear-gradient(to bottom, rgba(255,255,255,0.9), rgba(255,255,255,0.88)), url(https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=800&q=60)",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                >
                  <p className="text-center text-[10px] font-semibold text-slate-600">Chat</p>
                  {(!Array.isArray((activeTask.meta as any)?.messages) ||
                    (activeTask.meta as any).messages.length === 0) && (
                    <p className="rounded-lg bg-white/95 px-2 py-4 text-center text-xs text-muted-foreground shadow-sm">
                      Hali xabar yo‘q
                    </p>
                  )}
                  {Array.isArray((activeTask.meta as any)?.messages) &&
                    ((activeTask.meta as any).messages as Array<{
                      id: string;
                      text: string;
                      authorName: string;
                      authorRole?: string;
                      createdAt: string;
                      attachment?: TaskAttachment | null;
                    }>).map((m) => {
                      const mine =
                        (m.authorRole === "assignee" && isAssigneeOf(activeTask)) ||
                        (m.authorRole !== "assignee" &&
                          (isCreatorOf(activeTask) || user?.role === "admin"));
                      return (
                        <div
                          key={m.id}
                          className={cn(
                            "max-w-[90%] rounded-2xl px-2.5 py-1.5 text-xs shadow-sm",
                            mine
                              ? "ml-auto rounded-br-md bg-[#0b5fff] text-white"
                              : "rounded-bl-md bg-white text-foreground",
                          )}
                        >
                          {!mine && (
                            <p className="mb-0.5 text-[10px] font-semibold opacity-80">
                              {m.authorName}
                            </p>
                          )}
                          {m.text ? <p className="whitespace-pre-wrap">{m.text}</p> : null}
                          {m.attachment?.url && (
                            m.attachment.kind === "image" ||
                            (m.attachment.mimeType || "").startsWith("image/") ? (
                              <a href={m.attachment.url} target="_blank" rel="noreferrer">
                                <img
                                  src={m.attachment.url}
                                  alt={m.attachment.name}
                                  className="mt-1 max-h-28 rounded-md object-cover"
                                />
                              </a>
                            ) : (
                              <a
                                href={m.attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 block underline"
                              >
                                {m.attachment.name}
                              </a>
                            )
                          )}
                        </div>
                      );
                    })}
                </div>
                {(isAssigneeOf(activeTask) || isCreatorOf(activeTask) || user?.role === "admin") && (
                  <div className="flex gap-2 border-t border-border bg-background p-2">
                    <Input
                      value={viewChatDraft}
                      onChange={(e) => setViewChatDraft(e.target.value)}
                      placeholder="Xabar yozing..."
                      className="h-9"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void (async () => {
                            if (!viewChatDraft.trim() || !activeTask) return;
                            setViewChatBusy(true);
                            try {
                              const updated = await sendTaskMessage.mutateAsync({
                                id: activeTask.id,
                                text: viewChatDraft.trim(),
                              });
                              setActiveTask(updated);
                              setViewChatDraft("");
                            } catch (err: any) {
                              toast({
                                title: "Chat yuborilmadi",
                                description: err?.message || "Xato",
                                variant: "destructive",
                              });
                            } finally {
                              setViewChatBusy(false);
                            }
                          })();
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      className="h-9 shrink-0"
                      disabled={viewChatBusy || !viewChatDraft.trim()}
                      onClick={() => {
                        void (async () => {
                          if (!viewChatDraft.trim() || !activeTask) return;
                          setViewChatBusy(true);
                          try {
                            const updated = await sendTaskMessage.mutateAsync({
                              id: activeTask.id,
                              text: viewChatDraft.trim(),
                            });
                            setActiveTask(updated);
                            setViewChatDraft("");
                          } catch (err: any) {
                            toast({
                              title: "Chat yuborilmadi",
                              description: err?.message || "Xato",
                              variant: "destructive",
                            });
                          } finally {
                            setViewChatBusy(false);
                          }
                        })();
                      }}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {(activeTask.status === "done" ||
                activeTask.completionNote ||
                (activeTask.completionAttachments?.length ?? 0) > 0) && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-3 space-y-2">
                  <p className="text-xs font-semibold text-emerald-800">
                    Sizning natijangiz
                  </p>
                  {activeTask.completionNote && (
                    <p className="whitespace-pre-wrap">
                      {activeTask.completionNote}
                    </p>
                  )}
                  <AttachmentList
                    items={activeTask.completionAttachments || []}
                    readOnly
                  />
                </div>
              )}
              {isAssigneeOf(activeTask) && activeTask.status === "todo" && (
                <Button
                  className="w-full"
                  onClick={() => {
                    setViewOpen(false);
                    void handleAccept(activeTask);
                  }}
                  disabled={acceptTask.isPending}
                >
                  Qabul qilish
                </Button>
              )}
              {isAssigneeOf(activeTask) &&
                activeTask.status === "in_progress" && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      className="flex-1"
                      onClick={() => {
                        setViewOpen(false);
                        openComplete(activeTask);
                      }}
                    >
                      <Send className="h-4 w-4 mr-1.5" />
                      Bajarildi
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setViewOpen(false);
                        openExtend(activeTask);
                      }}
                    >
                      <Clock className="h-4 w-4 mr-1.5" />
                      Muddat
                    </Button>
                  </div>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Ijrochi: bajarish */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent
          className="max-w-lg"
          onFocusOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Vazifani bajarish</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            «{activeTask?.title}» — matn, rasm yoki fayl qo‘shing va
            yuboring. Belgilagan odamga qaytadi.
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Natija matni</Label>
              <Textarea
                value={completionNote}
                onChange={(e) => setCompletionNote(e.target.value)}
                rows={4}
                placeholder="Nima qilganingizni yozing..."
              />
            </div>
            <div className="space-y-2">
              <FileDropzone
                inputRef={completeFileRef}
                label="RASM / FAYL"
                title="Rasm yoki fayl biriktiring"
                hint="PDF, DOCX, rasm — 10 MB gacha. Bosib tanlang yoki shu yerga tortib tashlang"
                uploading={completeUploading}
                uploadedCount={completionFiles.length}
                onPick={(files) =>
                  void onPickFiles(files, setCompletionFiles, setCompleteUploading)
                }
              />
              <AttachmentList
                items={completionFiles}
                onRemove={(id) =>
                  setCompletionFiles((prev) => prev.filter((x) => x.id !== id))
                }
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCompleteOpen(false)}>
              Bekor
            </Button>
            <Button
              onClick={() => void handleComplete()}
              disabled={completeTask.isPending}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Yuborish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ijrochi: muddat so'rovi */}
      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("tasks.extendDialog")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Yangi muddat belgilovchi tasdiqlasa qo‘llanadi.
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Yangi muddat</Label>
              <Input
                type="datetime-local"
                value={extendDue}
                onChange={(e) => setExtendDue(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Izoh</Label>
              <Textarea
                value={extendNote}
                onChange={(e) => setExtendNote(e.target.value)}
                rows={3}
                placeholder="Nima uchun kerak..."
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExtendOpen(false)}>
              Bekor
            </Button>
            <Button
              onClick={() => void handleExtend()}
              disabled={requestExtension.isPending}
            >
              So‘rov yuborish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FileDropzone({
  inputRef,
  label,
  title,
  hint,
  onPick,
  uploading,
  uploadedCount = 0,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  label: string;
  title: string;
  hint: string;
  onPick: (files: FileList | null) => void;
  uploading?: boolean;
  uploadedCount?: number;
}) {
  const [dragging, setDragging] = useState(false);
  const success = !uploading && uploadedCount > 0;

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <label
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          if (!uploading) onPick(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 transition-colors",
          uploading && "pointer-events-none opacity-80 border-sky-400 bg-sky-50",
          !uploading &&
            dragging &&
            "border-primary bg-primary/5",
          !uploading &&
            success &&
            "border-emerald-500 bg-emerald-50 hover:border-emerald-600 hover:bg-emerald-50/90",
          !uploading &&
            !success &&
            !dragging &&
            "border-slate-300 bg-muted/80 hover:border-primary/50 hover:bg-muted",
        )}
      >
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-foreground dark:text-white",
            success ? "bg-emerald-600" : uploading ? "bg-sky-600" : "bg-muted dark:bg-slate-800",
          )}
        >
          {success ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <FileText className="h-5 w-5" />
          )}
        </span>
        <span className="min-w-0 text-left">
          <span
            className={cn(
              "block text-sm font-semibold",
              success ? "text-emerald-800" : "text-foreground",
            )}
          >
            {uploading
              ? "Yuklanmoqda..."
              : success
                ? `${uploadedCount} ta fayl yuklandi`
                : title}
          </span>
          <span
            className={cn(
              "mt-0.5 block text-xs",
              success ? "text-emerald-700" : "text-muted-foreground",
            )}
          >
            {uploading
              ? "Kuting, fayl serverga yuborilmoqda"
              : success
                ? "Yana qo‘shish uchun bosing yoki tortib tashlang"
                : hint}
          </span>
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf"
          className="sr-only"
          disabled={uploading}
          onChange={(e) => {
            onPick(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

function AttachmentList({
  items,
  onRemove,
  readOnly,
}: {
  items: TaskAttachment[];
  onRemove?: (id: string) => void;
  readOnly?: boolean;
}) {
  if (!items.length) return null;

  const downloadHref = (url: string) => {
    if (url.startsWith("/api/uploads/")) {
      return url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
    }
    return url;
  };

  return (
    <ul className="space-y-1.5">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-sm"
        >
          {a.kind === "image" ? (
            <a href={a.url} target="_blank" rel="noreferrer" className="shrink-0">
              <img
                src={a.url}
                alt=""
                className="h-8 w-8 rounded object-cover"
              />
            </a>
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate flex-1" title={a.name}>
            {a.name}
          </span>
          <a
            href={downloadHref(a.url)}
            download={a.name}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            Yuklab olish
          </a>
          {!readOnly && onRemove && (
            <button
              type="button"
              className="p-1 text-muted-foreground hover:text-red-600"
              onClick={() => onRemove(a.id)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function TaskCard({
  task,
  column,
  overdue,
  isCreator,
  isAssignee,
  onOpen,
  onComplete,
  onExtend,
  onDelete,
  onApproveExt,
  onRejectExt,
  onVerify,
  onRework,
  onAccept,
}: {
  task: Vazifa;
  column: BoardCol;
  overdue?: boolean;
  isCreator: boolean;
  isAssignee: boolean;
  onOpen: () => void;
  onComplete: () => void;
  onExtend: () => void;
  onDelete: () => void;
  onApproveExt: () => void;
  onRejectExt: () => void;
  onVerify: () => void;
  onRework: () => void;
  onAccept: () => void;
}) {
  const { t } = useI18n();
  const priClass = PRIORITY_CLASS[task.priority] || PRIORITY_CLASS.normal;
  const priLabel = t(PRIORITY_KEYS[task.priority] || PRIORITY_KEYS.normal!);
  const files = task.attachments?.filter((a) => a.kind === "file" || a.kind === "image") ?? [];
  const pendingExt = task.extensionStatus === "pending";
  const awaitingReview = task.status === "done";
  const isVerified = task.status === "verified";
  const needsAccept = task.status === "todo";
  const isAccepted = task.status === "in_progress";
  const progress = checklistProgress(task);
  const typeLbl = taskTypeLabel(task.meta?.taskType, t);
  const tag = Array.isArray(task.meta?.tags) && task.meta!.tags!.length > 0 ? task.meta!.tags![0] : typeLbl;
  const msgCount = Array.isArray(task.meta?.messages) ? task.meta!.messages!.length : 0;
  const initials = initialsFromName(task.assigneeName);

  return (
    <article
      className={cn(
        "group relative cursor-pointer rounded-xl border border-border/80 bg-card p-3 shadow-sm shadow-black/[0.03] transition",
        "hover:border-border hover:shadow-md dark:shadow-black/20",
        overdue && !awaitingReview && !isVerified && "border-rose-300/80 dark:border-rose-500/40",
        needsAccept && isAssignee && "border-sky-400/80 dark:border-sky-500/40",
        awaitingReview && "border-violet-300/80 dark:border-violet-500/40",
        isVerified && "border-emerald-300/80 dark:border-emerald-500/40",
        pendingExt && "border-amber-400/80 dark:border-amber-500/40",
      )}
      onClick={onOpen}
    >
      {isVerified && (
        <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1.5 pr-6">
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold",
            priClass,
          )}
        >
          <Flag className="mr-0.5 h-2.5 w-2.5" />
          {priLabel}
        </span>
        {tag ? (
          <span className="inline-flex items-center gap-0.5 rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Folder className="h-2.5 w-2.5 opacity-70" />
            {tag}
          </span>
        ) : null}
      </div>

      <h3 className="mb-1 text-[13px] font-bold leading-snug text-foreground">{task.title}</h3>

      {task.description ? (
        <p className="mb-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {task.description}
        </p>
      ) : null}

      {task.candidateId && task.pipelineStage && (
        <a
          href={
            task.pipelineStage === "hired"
              ? `/candidates/${task.candidateId}`
              : `/candidates/${task.candidateId}/${
                  task.pipelineStage === "offline_interview"
                    ? "offline-interview"
                    : task.pipelineStage === "final_decision"
                      ? "final-decision"
                      : task.pipelineStage
                }`
          }
          className="mb-1.5 inline-flex text-[10px] font-medium text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Nomzod formasini ochish →
        </a>
      )}

      <div
        className={cn(
          "mb-2 flex items-center gap-1.5 text-[11px]",
          overdue && !awaitingReview && !isVerified
            ? "font-semibold text-rose-600 dark:text-rose-400"
            : "text-muted-foreground",
        )}
      >
        <Calendar className="h-3 w-3 shrink-0" />
        <span>{task.dueAt ? formatDate(task.dueAt) : t("tasks.noDue")}</span>
      </div>

      {(column === "progress" || isAccepted || column === "today") &&
        !awaitingReview &&
        !isVerified && (
          <div className="mb-2.5">
            <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
              <span>{t("tasks.progress")}</span>
              <span className="tabular-nums text-primary">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

      {(awaitingReview || isVerified) &&
        (task.completionNote || (task.completionAttachments?.length ?? 0) > 0) && (
          <div className="mb-2 rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-2 py-1 text-[10px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
            <span className="font-semibold">{t("tasks.result")} </span>
            {task.completionNote
              ? task.completionNote.slice(0, 60) +
                (task.completionNote.length > 60 ? "…" : "")
              : `${task.completionAttachments.length} ta fayl`}
          </div>
        )}

      {pendingExt && (
        <div className="mb-2 rounded-lg border border-amber-200/80 bg-amber-50 px-2 py-1 text-[10px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Muddat so‘ralgan: {formatDate(task.extensionRequestedDueAt)}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border/60 pt-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
          {initials || "?"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
          {task.assigneeName || "—"}
        </span>
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <MessageSquare className="h-3 w-3" />
          {msgCount}
        </span>
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <Paperclip className="h-3 w-3" />
          {files.length + (task.completionAttachments?.length ?? 0)}
        </span>
        <span className="text-[10px] font-medium tabular-nums text-muted-foreground/50">
          TK-{task.id}
        </span>
      </div>

      <div
        className="mt-2 flex flex-wrap gap-1 border-t border-border/40 pt-2 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        {isAssignee && needsAccept && (
          <button
            type="button"
            className="flex-1 rounded-md bg-primary py-1.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
            onClick={onAccept}
          >
            {t("tasks.accept")}
          </button>
        )}
        {isAssignee && isAccepted && (
          <>
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-[11px] text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
              onClick={onComplete}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("tasks.markDone")}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-amber-800 hover:bg-amber-500/10 dark:text-amber-300"
              onClick={onExtend}
            >
              <Clock className="h-3.5 w-3.5" />
              {t("tasks.deadline")}
            </button>
          </>
        )}
        {isCreator && awaitingReview && (
          <>
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
              onClick={onVerify}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("ui.approve")}
            </button>
            <button
              type="button"
              className="flex flex-1 items-center justify-center rounded-md border border-amber-300/70 py-1.5 text-[11px] text-amber-800 hover:bg-amber-500/10 dark:border-amber-500/40 dark:text-amber-200"
              onClick={onRework}
            >
              {t("tasks.rework")}
            </button>
          </>
        )}
        {isCreator && pendingExt && (
          <>
            <button
              type="button"
              className="flex-1 rounded-md py-1.5 text-[11px] text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
              onClick={onApproveExt}
            >
              {t("ui.approve")}
            </button>
            <button
              type="button"
              className="flex-1 rounded-md py-1.5 text-[11px] text-rose-700 hover:bg-rose-500/10 dark:text-rose-300"
              onClick={onRejectExt}
            >
              {t("tasks.rejectExt")}
            </button>
          </>
        )}
        {isCreator && (
          <button
            type="button"
            className="ml-auto rounded-md p-1.5 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
            onClick={onDelete}
            title={t("ui.delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </article>
  );
}
