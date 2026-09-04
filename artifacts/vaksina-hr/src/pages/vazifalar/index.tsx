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
  Image as ImageIcon,
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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { CardStack } from "@/components/CardStack";
import { DeadlineCountdown } from "@/components/DeadlineCountdown";
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

type BoardCol = "past" | "today" | "tomorrow" | "week" | "completed";

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
  countBg: string;
  emptyKey: string;
  allowCreate?: boolean;
}[] = [
  {
    id: "past",
    labelKey: "tasks.overdue",
    hintKey: "tasks.overdueHint",
    top: "bg-rose-500",
    countBg: "bg-rose-100 text-rose-800",
    emptyKey: "tasks.empty.overdue",
    allowCreate: true,
  },
  {
    id: "today",
    labelKey: "tasks.today",
    hintKey: "tasks.todayHint",
    top: "bg-amber-500",
    countBg: "bg-amber-100 text-amber-900",
    emptyKey: "tasks.empty.today",
    allowCreate: true,
  },
  {
    id: "tomorrow",
    labelKey: "tasks.tomorrow",
    hintKey: "tasks.tomorrowHint",
    top: "bg-sky-500",
    countBg: "bg-sky-100 text-sky-800",
    emptyKey: "tasks.empty.tomorrow",
    allowCreate: true,
  },
  {
    id: "week",
    labelKey: "tasks.nextWeek",
    hintKey: "tasks.weekHint",
    top: "bg-emerald-500",
    countBg: "bg-emerald-100 text-emerald-800",
    emptyKey: "tasks.empty.week",
    allowCreate: true,
  },
  {
    id: "completed",
    labelKey: "tasks.done",
    hintKey: "tasks.doneHint",
    top: "bg-violet-500",
    countBg: "bg-violet-100 text-violet-800",
    emptyKey: "tasks.empty.done",
    allowCreate: false,
  },
];

const PRIORITY_CLASS: Record<string, string> = {
  low: "bg-slate-100 text-foreground",
  normal: "bg-blue-50 text-blue-700",
  high: "bg-orange-100 text-orange-800",
  urgent: "bg-red-100 text-red-800",
};

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
  if (task.status === "verified") return "completed";
  // Muddat yo‘q bo‘lsa — vazifa berilgan kun (ehtiyoj tasdig‘i) bo‘yicha
  const dueAt = task.dueAt || task.createdAt;
  if (!dueAt) return "week";
  const due = startOfDay(new Date(dueAt));
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  if (due.getTime() < today.getTime()) return "past";
  if (due.getTime() === today.getTime()) return "today";
  if (due.getTime() === tomorrow.getTime()) return "tomorrow";
  if (due.getTime() > tomorrow.getTime() && due.getTime() <= weekEnd.getTime()) {
    return "week";
  }
  return "week";
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
    let list = tasks;
    if (assigneeFilter) {
      list = list.filter(
        (t) =>
          t.assigneeKind === assigneeFilter.kind && t.assigneeId === assigneeFilter.id,
      );
      const q = search.trim().toLowerCase();
      // When assignee is locked, only further filter by title/description (not creator name)
      if (q && q !== assigneeFilter.name.toLowerCase()) {
        list = list.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.description || "").toLowerCase().includes(q) ||
            String(t.id).includes(q),
        );
      }
      return list;
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.assigneeName || "").toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        String(t.id).includes(q),
    );
  }, [tasks, search, assigneeFilter]);

  function clearSearchFilter() {
    setSearch("");
    setAssigneeFilter(null);
  }

  const byColumn = useMemo(() => {
    const map: Record<BoardCol, Vazifa[]> = {
      past: [],
      today: [],
      tomorrow: [],
      week: [],
      completed: [],
    };
    for (const t of filtered) {
      map[boardColumnFor(t)].push(t);
    }
    for (const k of Object.keys(map) as BoardCol[]) {
      map[k].sort((a, b) => {
        if (k === "completed") {
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

  function openCreate(presetCol?: BoardCol) {
    setEditing(null);
    const base = startOfDay(new Date());
    let target = base;
    if (presetCol === "tomorrow") target = addDays(base, 1);
    if (presetCol === "week") target = addDays(base, 3);
    if (presetCol === "past") target = addDays(base, -1);
    target.setHours(18, 0, 0, 0);
    setCreateDueAt(target.toISOString());
    setEditOpen(true);
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

  return (
    <div className="h-full flex flex-col min-h-0 bg-gradient-to-br from-slate-50 via-white to-sky-50/40">
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border bg-white/70 backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-sky-700/80 mb-1">
              {t("tasks.eyebrow")}
            </p>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              {t("tasks.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              {t("tasks.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" className="gap-2 shadow-sm">
              <Link href="/vazifalar/tahlil">
                <BarChart3 className="h-4 w-4" />
                {t("nav.taskAnalytics")}
              </Link>
            </Button>
            {canAssign && (
              <Button
                onClick={() => openCreate("today")}
                className="gap-2 shadow-sm"
              >
                <Plus className="h-4 w-4" />
                {t("tasks.new")}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 max-w-md space-y-2">
          <Popover open={searchOpen} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-10 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-sm transition",
                  "hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30",
                  (searchOpen || assigneeFilter) && "border-sky-400 ring-2 ring-sky-500/20",
                )}
              >
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    search || assigneeFilter ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {assigneeFilter?.name || search || t("tasks.search")}
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
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
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
                      const initials = o.name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((p) => p[0]?.toUpperCase() || "")
                        .join("");
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
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-[10px] font-bold text-white">
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
                              "h-4 w-4 shrink-0 text-sky-600",
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
          {assigneeFilter ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
                <User className="h-3 w-3" />
                {t("tasks.assigneeOnly")}: {assigneeFilter.name}
                <button
                  type="button"
                  className="ml-0.5 rounded-full p-0.5 hover:bg-sky-100 dark:hover:bg-sky-500/20"
                  onClick={clearSearchFilter}
                  aria-label={t("ui.clear")}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
              <span className="text-muted-foreground">
                {filtered.length} {t("tasks.filteredCount")}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-4 md:p-6">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            {t("ui.loading")}
          </div>
        ) : (
          <div className="h-full flex gap-4 min-w-max">
            {COLUMNS.map((col) => (
              <section
                key={col.id}
                className="w-[280px] md:w-[300px] flex flex-col rounded-2xl bg-slate-100/80 border border-border overflow-hidden shadow-sm"
              >
                <header className="shrink-0">
                  <div className={cn("h-1.5", col.top)} />
                  <div className="px-3 py-3 flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold text-foreground text-[15px]">
                        {t(col.labelKey)}
                      </h2>
                      <p className="text-xs text-muted-foreground">{t(col.hintKey)}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "text-xs font-semibold px-2 py-0.5 rounded-full",
                          col.countBg,
                        )}
                      >
                        {byColumn[col.id].length}
                      </span>
                      {canAssign && col.allowCreate !== false && (
                        <button
                          type="button"
                          onClick={() => openCreate(col.id)}
                          className="p-1 rounded-md text-muted-foreground hover:bg-card hover:text-foreground transition"
                          title={t("tasks.addToColumn")}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </header>

                <div className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-2.5">
                  {byColumn[col.id].length === 0 ? (
                    <div className="mx-0.5 mt-1 rounded-xl border border-dashed border-slate-300 bg-white/50 px-3 py-8 text-center text-sm text-muted-foreground">
                      {t(col.emptyKey)}
                    </div>
                  ) : (
                    <CardStack
                      items={byColumn[col.id]}
                      stackSize={3}
                      getKey={(task) => task.id}
                      renderCard={(task) => (
                        <TaskCard
                          task={task}
                          overdue={col.id === "past"}
                          isCreator={isCreatorOf(task)}
                          isAssignee={isAssigneeOf(task)}
                          onOpen={() => openEdit(task)}
                          onComplete={() => openComplete(task)}
                          onExtend={() => openExtend(task)}
                          onDelete={() => removeTask(task)}
                          onApproveExt={() =>
                            void handleResolveExtension(task, "approve")
                          }
                          onRejectExt={() =>
                            void handleResolveExtension(task, "reject")
                          }
                          onVerify={() => void handleVerify(task, "approve")}
                          onRework={() => void handleVerify(task, "rework")}
                          onAccept={() => void handleAccept(task)}
                        />
                      )}
                    />
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

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
  const images = task.attachments?.filter((a) => a.kind === "image") ?? [];
  const files = task.attachments?.filter((a) => a.kind === "file") ?? [];
  const pendingExt = task.extensionStatus === "pending";
  const awaitingReview = task.status === "done";
  const isVerified = task.status === "verified";
  const needsAccept = task.status === "todo";
  const isAccepted = task.status === "in_progress";
  const hideCountdown = awaitingReview || isVerified;

  return (
    <article
      className={cn(
        "group rounded-lg border bg-card p-2.5 shadow-sm hover:shadow transition cursor-pointer",
        overdue && !hideCountdown && "border-rose-200 ring-1 ring-rose-100",
        needsAccept && isAssignee && "border-sky-300 ring-1 ring-sky-100",
        isAccepted && "border-blue-200 bg-blue-50/20",
        awaitingReview && "border-emerald-200 bg-emerald-50/30",
        isVerified && "border-violet-200 bg-violet-50/40",
        pendingExt && "border-amber-300",
      )}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-1.5 mb-1.5">
        {isVerified ? (
          <Badge className="text-[9px] h-5 px-1.5 font-medium bg-violet-100 text-violet-800 hover:bg-violet-100">
            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
            Bajarilgan
          </Badge>
        ) : awaitingReview ? (
          <Badge className="text-[9px] h-5 px-1.5 font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
            Bajarilgan
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            className={cn("text-[9px] h-5 px-1.5 font-medium", priClass)}
          >
            <Flag className="h-2.5 w-2.5 mr-0.5" />
            {priLabel}
          </Badge>
        )}
        <span
          className={cn(
            "text-[9px] font-semibold shrink-0 rounded-full px-1.5 py-0.5",
            awaitingReview && "bg-emerald-100 text-emerald-800",
            pendingExt && !awaitingReview && "bg-orange-100 text-orange-800",
            needsAccept && "bg-sky-100 text-sky-800",
            isAccepted && "bg-amber-100 text-amber-900",
            isVerified && "bg-violet-100 text-violet-800",
            task.status === "cancelled" && "bg-slate-200 text-muted-foreground",
          )}
        >
          {awaitingReview
            ? "Tasdiq kutilmoqda"
            : pendingExt
              ? "Muddat so'rovi"
              : needsAccept
                ? "Qabul kutilmoqda"
                : isVerified
                  ? "Tasdiqlangan"
                  : isAccepted
                    ? "Bajarilmoqda"
                    : task.status === "cancelled"
                      ? "Bekor qilingan"
                      : "Yangi"}
        </span>
      </div>

      <h3 className="text-[13px] font-semibold text-foreground leading-snug mb-1">
        {task.title}
      </h3>

      {Array.isArray(task.meta?.tags) && task.meta!.tags!.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {task.meta!.tags!.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-200"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {Array.isArray(task.meta?.checklist) && task.meta!.checklist!.length > 0 && (
        <p className="mb-1.5 text-[10px] text-muted-foreground">
          Checklist: {task.meta!.checklist!.filter((c) => c.done).length}/
          {task.meta!.checklist!.length}
        </p>
      )}

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
          className="inline-flex text-[10px] font-medium text-sky-700 hover:underline mb-1"
          onClick={(e) => e.stopPropagation()}
        >
          Nomzod formasini ochish →
        </a>
      )}

      {task.description && (
        <p className="text-[11px] text-muted-foreground line-clamp-2 mb-1.5">
          {task.description}
        </p>
      )}

      {images.length > 0 && (
        <div className="flex gap-1 mb-1.5 overflow-hidden">
          {images.slice(0, 3).map((img) => (
            <img
              key={img.id}
              src={img.url}
              alt=""
              className="h-9 w-9 rounded object-cover border"
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground mb-1.5">
        <div className="flex items-center gap-1.5">
          <User className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">
            {t("tasks.assignee")}: {task.assigneeName || "—"}
          </span>
        </div>
        {task.createdByName ? (
          <div className="truncate pl-4">
            {t("tasks.givenBy")}: {task.createdByName}
          </div>
        ) : null}
      </div>

      <div className="mb-1.5 space-y-1">
        {task.dueAt ? (
          <div
            className={cn(
              "flex items-center gap-1 text-[10px]",
              overdue && !hideCountdown
                ? "font-semibold text-rose-600"
                : "text-muted-foreground",
            )}
          >
            <Calendar className="h-3 w-3 shrink-0" />
            <span>
              {t("tasks.deadline")}: {formatDate(task.dueAt)}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {t("tasks.noDue")}
          </div>
        )}
        {hideCountdown ? (
          <div
            className={cn(
              "rounded-md border px-2 py-1 text-[10px] font-semibold",
              isVerified
                ? "border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200"
                : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
            )}
          >
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              {isVerified ? t("tasks.status.verifiedFull") : t("tasks.status.awaitingFull")}
            </div>
          </div>
        ) : null}
      </div>

      {(awaitingReview || isVerified) &&
        (task.completionNote || (task.completionAttachments?.length ?? 0) > 0) && (
        <div className="mb-1.5 rounded-md bg-emerald-50 border border-emerald-100 px-2 py-1 text-[10px] text-emerald-800">
          <span className="font-semibold">Natija: </span>
          {task.completionNote
            ? task.completionNote.slice(0, 60) +
              (task.completionNote.length > 60 ? "…" : "")
            : `${task.completionAttachments.length} ta fayl`}
        </div>
      )}

      {pendingExt && (
        <div className="mb-1.5 rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-[10px] text-amber-900">
          Muddat so‘ralgan: {formatDate(task.extensionRequestedDueAt)}
        </div>
      )}

      {(images.length > 0 || files.length > 0) && !hideCountdown && (
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {images.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px]">
              <ImageIcon className="h-3 w-3" />
              {images.length}
            </span>
          )}
          {files.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px]">
              <Paperclip className="h-3 w-3" />
              {files.length}
            </span>
          )}
        </div>
      )}

      <div
        className="mt-1.5 pt-1.5 border-t border-slate-100 flex flex-wrap gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition"
        onClick={(e) => e.stopPropagation()}
      >
        {isAssignee && needsAccept && (
          <button
            type="button"
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-md text-[11px] py-1.5 bg-sky-600 text-white hover:bg-sky-700"
            onClick={onAccept}
          >
            {t("tasks.accept")}
          </button>
        )}
        {isAssignee && isAccepted && (
          <>
            <button
              type="button"
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-md text-[11px] py-1.5 hover:bg-emerald-50 text-emerald-700"
              onClick={onComplete}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("tasks.markDone")}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 rounded-md text-[11px] px-2 py-1.5 hover:bg-amber-50 text-amber-800"
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
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-md text-[11px] py-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={onVerify}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("ui.approve")}
            </button>
            <button
              type="button"
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-md text-[11px] py-1.5 hover:bg-amber-50 text-amber-800 border border-amber-200"
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
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-md text-[11px] py-1.5 hover:bg-emerald-50 text-emerald-700"
              onClick={onApproveExt}
            >
              {t("ui.approve")}
            </button>
            <button
              type="button"
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-md text-[11px] py-1.5 hover:bg-rose-50 text-rose-700"
              onClick={onRejectExt}
            >
              {t("tasks.rejectExt")}
            </button>
          </>
        )}
        {isCreator && (
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-1.5 hover:bg-rose-50 text-rose-600 ml-auto"
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
