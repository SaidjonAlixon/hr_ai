import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link2,
  Image as ImageIcon,
  Code2,
  Sparkles,
  Calendar,
  Clock,
  Tag,
  Plus,
  X,
  Check,
  ChevronsUpDown,
  Send,
  Maximize2,
  Minimize2,
  Wand2,
  FileText,
  Settings2,
  Paperclip,
  MessageCircle,
  History,
  CheckCheck,
  Smile,
  AtSign,
  CloudUpload,
  FileSpreadsheet,
  FileImage,
  CheckCircle2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { isSbRole, userRoleLabel } from "@/lib/roles";
import { SB_TASK_TEMPLATES } from "@/lib/sb";
import {
  fileToAttachment,
  useSendTaskMessage,
  type TaskAttachment,
  type TaskChatMessage,
  type TaskChecklistItem,
  type TaskHistoryEvent,
  type TaskMeta,
  type Vazifa,
  type VazifaInput,
} from "@/lib/vazifalar-api";
import { useToast } from "@/hooks/use-toast";
import { DeadlineCountdown } from "@/components/DeadlineCountdown";

export type AssigneeOption = {
  key: string;
  name: string;
  label: string;
  kind: "user" | "employee";
  id: number;
  meta: string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Vazifa | null;
  assigneeOptions: AssigneeOption[];
  branchOptions: string[];
  currentUserName?: string | null;
  currentUserRole?: string | null;
  /** manage = yaratish/tahrirlash; work = ijrochi (asoslar o‘qish) */
  mode?: "manage" | "work";
  /** Ijrochi rejimida beruvchi ismi / lavozimi */
  assignerName?: string | null;
  assignerRole?: string | null;
  saving?: boolean;
  defaultDueAt?: string | null;
  onSave: (payload: VazifaInput) => Promise<void>;
  /** Tahrirlashda chat xabarini darhol saqlash */
  onPersistChat?: (patch: {
    meta: TaskMeta;
    attachments: TaskAttachment[];
  }) => Promise<void>;
  onWorkAccept?: () => Promise<void>;
  onWorkComplete?: (note: string, files: TaskAttachment[]) => Promise<void>;
  onWorkExtend?: () => void;
  onTaskUpdated?: (task: Vazifa) => void;
  onVerify?: (action: "approve" | "rework") => Promise<void> | void;
};

const TITLE_MAX = 200;
const DESC_MAX = 2000;
const NOTES_MAX = 500;

const TASK_TYPES = [
  { value: "hisobot", labelKey: "tasks.form.type.report" },
  { value: "tekshiruv", labelKey: "tasks.form.type.audit" },
  { value: "suhbat", labelKey: "tasks.form.type.call" },
  { value: "hujjat", labelKey: "tasks.form.type.doc" },
  { value: "boshqa", labelKey: "tasks.form.type.other" },
] as const;

const PRIORITIES = [
  {
    value: "low",
    labelKey: "tasks.priority.low",
    active: "bg-slate-800 text-white border-slate-800 shadow-lg shadow-slate-800/25",
    idle: "border-slate-200/80 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
  {
    value: "normal",
    labelKey: "tasks.priority.normal",
    active: "bg-[#0b5fff] text-white border-[#0b5fff] shadow-lg shadow-blue-500/35",
    idle: "border-blue-100 bg-[#eef4ff] text-[#0b5fff] hover:border-blue-200 hover:bg-[#e0ebff] dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  },
  {
    value: "high",
    labelKey: "tasks.priority.high",
    active: "bg-amber-500 text-white border-amber-500 shadow-lg shadow-amber-500/35",
    idle: "border-amber-100 bg-amber-50 text-amber-700 hover:border-amber-200 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  },
  {
    value: "urgent",
    labelKey: "tasks.priority.urgent",
    active: "bg-rose-600 text-white border-rose-600 shadow-lg shadow-rose-600/35",
    idle: "border-rose-100 bg-rose-50 text-rose-700 hover:border-rose-200 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
  },
] as const;

const FIELD =
  "h-10 rounded-xl border-slate-200/90 bg-[#f4f7fb] text-slate-900 shadow-none transition-all placeholder:text-slate-400 focus-visible:border-[#0b5fff] focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-[#0b5fff]/25 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50";

const LABEL =
  "text-[13px] font-semibold text-[#0a2540] dark:text-slate-100";

const CARD =
  "rounded-2xl border border-white/70 bg-white/95 p-4 shadow-[0_1px_2px_rgba(10,37,64,0.05),0_12px_32px_rgba(11,95,255,0.08)] ring-1 ring-slate-900/5 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95 dark:ring-white/5";

function SectionCard({
  title,
  tint,
  children,
  className,
}: {
  title: string;
  tint?: "blue" | "teal" | "violet" | "amber" | "emerald";
  children: React.ReactNode;
  className?: string;
}) {
  const tintBar =
    tint === "teal"
      ? "from-teal-400 to-cyan-500"
      : tint === "violet"
        ? "from-violet-400 to-fuchsia-500"
        : tint === "amber"
          ? "from-amber-400 to-orange-500"
          : tint === "emerald"
            ? "from-emerald-500 to-teal-400"
            : "from-[#0b5fff] to-sky-400";
  const titleTone =
    tint === "emerald"
      ? "text-emerald-800 dark:text-emerald-300"
      : "text-[#0a2540]/65 dark:text-slate-400";
  return (
    <section className={cn(CARD, "relative overflow-hidden", className)}>
      <div className={cn("absolute inset-y-0 left-0 w-1 bg-gradient-to-b", tintBar)} />
      <p className={cn("mb-3.5 pl-2 text-[11px] font-bold uppercase tracking-[0.14em]", titleTone)}>
        {title}
      </p>
      <div className="space-y-3.5 pl-2">{children}</div>
    </section>
  );
}

function isImageAtt(a?: TaskAttachment | null) {
  if (!a) return false;
  return a.kind === "image" || (a.mimeType || "").startsWith("image/");
}

/** Beruvchi / bajaruvchi uchun yuborilgan natijani aniq ko‘rsatish */
function SubmittedResultView({
  note,
  files,
  assigneeName,
  completedAt,
  awaitingReview,
  onOpenImage,
  onVerify,
  t,
}: {
  note?: string | null;
  files?: TaskAttachment[] | null;
  assigneeName?: string | null;
  completedAt?: string | null;
  awaitingReview?: boolean;
  onOpenImage?: (url: string) => void;
  onVerify?: (action: "approve" | "rework") => void;
  t: (k: string) => string;
}) {
  const list = files || [];
  const images = list.filter((a) => isImageAtt(a));
  const docs = list.filter((a) => !isImageAtt(a));

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50 via-white to-teal-50/60 shadow-sm dark:border-emerald-800/60 dark:from-emerald-950/40 dark:via-slate-900 dark:to-teal-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 bg-emerald-600/95 px-3.5 py-2.5 text-white dark:border-emerald-800 dark:bg-emerald-700">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <p className="text-[12px] font-bold uppercase tracking-[0.12em]">
            {t("tasks.form.assigneeResult")}
          </p>
        </div>
        {awaitingReview ? (
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold">
            {t("tasks.badge.awaitingReview")}
          </span>
        ) : null}
      </div>

      <div className="space-y-3 p-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
          {assigneeName ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#0a2540] dark:text-slate-100">
              <UserRound className="h-3.5 w-3.5 text-emerald-600" />
              {assigneeName}
            </span>
          ) : null}
          {completedAt ? (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              {formatStatusTime(completedAt)}
            </span>
          ) : null}
        </div>

        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {t("tasks.resultText")}
          </p>
          {note?.trim() ? (
            <div className="whitespace-pre-wrap rounded-xl border border-emerald-100 bg-white/90 px-3.5 py-3 text-sm leading-relaxed text-slate-800 dark:border-emerald-900 dark:bg-slate-950/60 dark:text-slate-100">
              {note}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900">
              {t("tasks.form.resultNoText")}
            </p>
          )}
        </div>

        {(images.length > 0 || docs.length > 0) && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {t("tasks.form.resultFiles")}
              <span className="ml-1 font-semibold normal-case text-emerald-700">
                ({list.length})
              </span>
            </p>
            {images.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {images.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onOpenImage?.(a.url)}
                    className="group relative overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-sm transition hover:ring-2 hover:ring-emerald-400 dark:border-emerald-900 dark:bg-slate-950"
                  >
                    <img
                      src={a.url}
                      alt={a.name}
                      className="aspect-[4/3] w-full object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[9px] text-white opacity-0 transition group-hover:opacity-100">
                      {a.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {docs.length > 0 && (
              <ul className="space-y-1.5">
                {docs.map((a) => (
                  <li key={a.id}>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-[#0a2540] transition hover:border-emerald-300 hover:bg-emerald-50/60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatSize(a.size) || "ochish"}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {awaitingReview && onVerify ? (
          <div className="flex flex-col gap-2 border-t border-emerald-100 pt-3 sm:flex-row dark:border-emerald-900">
            <Button
              type="button"
              className="flex-1 gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700"
              onClick={() => onVerify("approve")}
            >
              <CheckCircle2 className="h-4 w-4" />
              {t("ui.approve")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1 gap-1.5 rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50"
              onClick={() => onVerify("rework")}
            >
              {t("tasks.rework")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type StatusStep = {
  key: string;
  labelKey: string;
  hintKey: string;
  done: boolean;
  current: boolean;
  at: string | null;
};

function formatStatusTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildStatusTimeline(task: Vazifa | null): StatusStep[] {
  const status = task?.status || "todo";
  const meta = (task?.meta || {}) as TaskMeta;
  const createdAt = task?.createdAt || null;
  const acceptedAt = task?.acceptedAt || null;
  const completedAt = task?.completedAt || null;
  const verifiedAt =
    meta.verifiedAt || (status === "verified" ? task?.updatedAt || null : null);

  if (!task) {
    return [
      {
        key: "new",
        labelKey: "tasks.form.status.new",
        hintKey: "tasks.form.status.newHint",
        done: false,
        current: true,
        at: null,
      },
      {
        key: "accepted",
        labelKey: "tasks.form.status.accepted",
        hintKey: "tasks.form.status.acceptedHint",
        done: false,
        current: false,
        at: null,
      },
      {
        key: "progress",
        labelKey: "tasks.form.status.progress",
        hintKey: "tasks.form.status.progressHint",
        done: false,
        current: false,
        at: null,
      },
      {
        key: "review",
        labelKey: "tasks.form.status.review",
        hintKey: "tasks.form.status.reviewHint",
        done: false,
        current: false,
        at: null,
      },
      {
        key: "done",
        labelKey: "tasks.form.status.done",
        hintKey: "tasks.form.status.doneHint",
        done: false,
        current: false,
        at: null,
      },
    ];
  }

  const hasAccepted =
    !!acceptedAt ||
    status === "in_progress" ||
    status === "done" ||
    status === "verified";
  const hasProgress =
    status === "in_progress" || status === "done" || status === "verified";
  const hasReview = !!completedAt || status === "done" || status === "verified";
  const hasDone = status === "verified";

  const steps: StatusStep[] = [
    {
      key: "new",
      labelKey: "tasks.form.status.new",
      hintKey: "tasks.form.status.newHint",
      done: true,
      current: false,
      at: createdAt,
    },
    {
      key: "accepted",
      labelKey: "tasks.form.status.accepted",
      hintKey: "tasks.form.status.acceptedHint",
      done: hasAccepted,
      current: false,
      at: acceptedAt,
    },
    {
      key: "progress",
      labelKey: "tasks.form.status.progress",
      hintKey: "tasks.form.status.progressHint",
      done: hasProgress,
      current: false,
      at: hasProgress ? acceptedAt || createdAt : null,
    },
    {
      key: "review",
      labelKey: "tasks.form.status.review",
      hintKey: "tasks.form.status.reviewHint",
      done: hasReview,
      current: false,
      at: completedAt,
    },
    {
      key: "done",
      labelKey: "tasks.form.status.done",
      hintKey: "tasks.form.status.doneHint",
      done: hasDone,
      current: false,
      at: verifiedAt,
    },
  ];

  const allDone = steps.every((s) => s.done);
  const currentIdx = allDone
    ? steps.length - 1
    : Math.max(0, steps.findIndex((s) => !s.done));

  return steps.map((s, i) => ({ ...s, current: i === currentIdx }));
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function splitDue(local: string): { date: string; time: string } {
  if (!local) return { date: "", time: "18:00" };
  const [date, time] = local.split("T");
  return { date: date || "", time: (time || "18:00").slice(0, 5) };
}

function joinDue(date: string, time: string): string {
  if (!date) return "";
  return `${date}T${time || "18:00"}`;
}

function newChecklistId() {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function formatSize(bytes?: number) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentIcon(a: TaskAttachment) {
  const name = (a.name || "").toLowerCase();
  const mime = (a.mimeType || "").toLowerCase();
  if (a.kind === "image" || mime.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/.test(name)) {
    return { Icon: FileImage, className: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300" };
  }
  if (mime.includes("sheet") || mime.includes("excel") || /\.(xlsx?|csv)$/.test(name)) {
    return { Icon: FileSpreadsheet, className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };
  }
  if (mime.includes("pdf") || name.endsWith(".pdf")) {
    return { Icon: FileText, className: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300" };
  }
  return { Icon: FileText, className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };
}

function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
) {
  const selected = value.slice(start, end) || "matn";
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  return { next, cursor: start + before.length + selected.length + after.length };
}

export function TaskFormDialog({
  open,
  onOpenChange,
  editing,
  assigneeOptions,
  branchOptions: _branchOptions,
  currentUserName,
  currentUserRole,
  mode = "manage",
  assignerName,
  assignerRole,
  saving,
  defaultDueAt,
  onSave,
  onPersistChat,
  onWorkAccept,
  onWorkComplete,
  onWorkExtend,
  onTaskUpdated,
  onVerify,
}: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const sendTaskMessage = useSendTaskMessage();
  const isWork = mode === "work";
  const descRef = useRef<HTMLTextAreaElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const workFileRef = useRef<HTMLInputElement>(null);

  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("18:00");
  const [assigneeKey, setAssigneeKey] = useState("");
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [branchOrDept, setBranchOrDept] = useState("");
  const [taskType, setTaskType] = useState("hisobot");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [attachUploading, setAttachUploading] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>([]);
  const [notes, setNotes] = useState("");
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderOffset, setReminderOffset] = useState("1d");
  const [recurrence, setRecurrence] = useState("none");
  const [visibility, setVisibility] = useState<"all" | "private">("all");
  const [extraOpen, setExtraOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [sideTab, setSideTab] = useState<"chat" | "files" | "history">("chat");
  const [messages, setMessages] = useState<TaskChatMessage[]>([]);
  const [history, setHistory] = useState<TaskHistoryEvent[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatUploading, setChatUploading] = useState(false);
  const [chatPersisting, setChatPersisting] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<{
    file: File;
    url: string;
    kind: "image" | "file";
  } | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [workNote, setWorkNote] = useState("");
  const [workFiles, setWorkFiles] = useState<TaskAttachment[]>([]);
  const [workBusy, setWorkBusy] = useState(false);
  const [workUploading, setWorkUploading] = useState(false);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<TaskChatMessage[]>([]);
  const historyRef = useRef<TaskHistoryEvent[]>([]);
  const attachmentsRef = useRef<TaskAttachment[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    return () => {
      if (pendingPreview?.url) URL.revokeObjectURL(pendingPreview.url);
    };
  }, [pendingPreview?.url]);

  // To‘liq hydrate — faqat ochilganda / vazifa id o‘zgaganda (chat yangilanishi natija matnini o‘chirmasin)
  useEffect(() => {
    if (!open) return;
    if (editing) {
      const meta = (editing.meta || {}) as TaskMeta;
      const due = splitDue(toDatetimeLocalValue(editing.dueAt));
      setTitle(editing.title);
      setDescription(editing.description || "");
      setPriority(editing.priority);
      setDueDate(due.date);
      setDueTime(due.time);
      setAssigneeKey(`${editing.assigneeKind}:${editing.assigneeId}`);
      setBranchOrDept(meta.branchOrDept || "");
      setTaskType(meta.taskType || "hisobot");
      setTags(meta.tags || []);
      setAttachments(editing.attachments || []);
      setChecklist(meta.checklist || []);
      setNotes(meta.notes || "");
      setReminderEnabled(meta.reminderEnabled ?? true);
      setReminderOffset(meta.reminderOffset || "1d");
      setRecurrence(meta.recurrence || "none");
      setVisibility(meta.visibility === "private" ? "private" : "all");
      setMessages(Array.isArray(meta.messages) ? meta.messages : []);
      setHistory(
        Array.isArray(meta.history) && meta.history.length
          ? meta.history
          : [
              {
                id: "h-created",
                text: t("tasks.form.hist.created"),
                createdAt: editing.createdAt,
              },
            ],
      );
      setChatDraft("");
      setSideTab("chat");
      setExpanded(false);
      setWorkNote(editing.completionNote || "");
      setWorkFiles(editing.completionAttachments || []);
      return;
    }
    setTitle("");
    setDescription("");
    setPriority("normal");
    setAssigneeKey("");
    setBranchOrDept("");
    setTaskType("hisobot");
    setTags([]);
    setAttachments([]);
    setChecklist([]);
    setNotes("");
    setReminderEnabled(true);
    setReminderOffset("1d");
    setRecurrence("none");
    setVisibility("all");
    setMessages([]);
    setHistory([
      {
        id: "h-draft",
        text: t("tasks.form.hist.draft"),
        createdAt: new Date().toISOString(),
      },
    ]);
    setChatDraft("");
    setSideTab("chat");
    setExpanded(false);
    setWorkNote("");
    setWorkFiles([]);
    const due = splitDue(toDatetimeLocalValue(defaultDueAt || null));
    if (due.date) {
      setDueDate(due.date);
      setDueTime(due.time || "18:00");
    } else {
      const base = new Date();
      base.setHours(18, 0, 0, 0);
      const d = splitDue(toDatetimeLocalValue(base.toISOString()));
      setDueDate(d.date);
      setDueTime(d.time || "18:00");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: hydrate by id only
  }, [open, editing?.id, defaultDueAt]);

  // Status / natija / chat serverdan yangilanganda (id o‘zgarmasa ham)
  useEffect(() => {
    if (!open || !editing) return;
    const meta = (editing.meta || {}) as TaskMeta;
    if (Array.isArray(meta.messages)) setMessages(meta.messages);
    if (Array.isArray(meta.history) && meta.history.length) setHistory(meta.history);
    setAttachments(editing.attachments || []);
    if (editing.completionNote) setWorkNote(editing.completionNote);
    if ((editing.completionAttachments?.length ?? 0) > 0) {
      setWorkFiles(editing.completionAttachments || []);
    }
  }, [
    open,
    editing?.id,
    editing?.status,
    editing?.completionNote,
    editing?.completedAt,
    editing?.meta,
    editing?.attachments,
    editing?.completionAttachments,
  ]);

  const selectedAssignee = useMemo(
    () => assigneeOptions.find((o) => o.key === assigneeKey),
    [assigneeOptions, assigneeKey],
  );

  const statusTimeline = useMemo(() => buildStatusTimeline(editing), [editing]);

  function applyDescFormat(before: string, after: string) {
    const el = descRef.current;
    if (!el) {
      setDescription((v) => `${before}${v}${after}`);
      return;
    }
    const start = el.selectionStart ?? description.length;
    const end = el.selectionEnd ?? description.length;
    const { next, cursor } = wrapSelection(description, start, end, before, after);
    setDescription(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  function insertBullet() {
    const el = descRef.current;
    const start = el?.selectionStart ?? description.length;
    const lineStart = description.lastIndexOf("\n", start - 1) + 1;
    const next =
      description.slice(0, lineStart) + "• " + description.slice(lineStart);
    setDescription(next);
  }

  function addTag() {
    const v = tagDraft.trim().toLowerCase();
    if (!v) return;
    if (tags.includes(v)) {
      setTagDraft("");
      return;
    }
    setTags((prev) => [...prev, v].slice(0, 20));
    setTagDraft("");
  }

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return;
    const picked = Array.from(files);
    setAttachUploading(true);
    try {
      const converted: TaskAttachment[] = [];
      for (const file of picked) {
        converted.push(await fileToAttachment(file));
      }
      setAttachments((prev) => {
        const next = [...prev];
        for (const att of converted) {
          if (next.length >= 10) break;
          next.push(att);
        }
        return next;
      });
      toast({
        title: t("tasks.form.fileUploaded"),
        description: `${picked.length}`,
      });
    } catch (e: any) {
      toast({
        title: t("tasks.form.fileFail"),
        description: e?.message || "Xato",
        variant: "destructive",
      });
    } finally {
      setAttachUploading(false);
    }
  }

  function applyTemplate(idx: number) {
    const tpl = SB_TASK_TEMPLATES[idx];
    if (!tpl) return;
    setTitle(tpl.title.slice(0, TITLE_MAX));
    setDescription(tpl.description.slice(0, DESC_MAX));
    setTemplateOpen(false);
  }

  function applyAiAssist() {
    if (!title.trim()) {
      toast({ title: t("tasks.form.aiNeedTitle"), variant: "destructive" });
      return;
    }
    const bullets = [
      `• ${title.trim()} bo‘yicha ma’lumotlarni yig‘ish`,
      "• Tekshiruv va tahlil qilish",
      "• Natijani hisobot ko‘rinishida tayyorlash",
      "• Mas’ul rahbarga yuborish",
    ].join("\n");
    setDescription((prev) => {
      const base = prev.trim();
      const next = base ? `${base}\n\n${bullets}` : bullets;
      return next.slice(0, DESC_MAX);
    });
    if (!checklist.length) {
      setChecklist([
        { id: newChecklistId(), text: "Ma’lumotlarni yig‘ish", done: false },
        { id: newChecklistId(), text: "Tahlil qilish", done: false },
        { id: newChecklistId(), text: "Hisobot tayyorlash", done: false },
        { id: newChecklistId(), text: "Yuborish / tasdiqlash", done: false },
      ]);
    }
    toast({ title: t("tasks.form.aiDone") });
  }

  async function handleSubmit() {
    if (!title.trim()) {
      toast({ title: t("tasks.form.needTitle"), variant: "destructive" });
      return;
    }
    if (!assigneeKey) {
      toast({ title: t("tasks.form.needAssignee"), variant: "destructive" });
      return;
    }
    const [kind, idStr] = assigneeKey.split(":");
    const dueLocal = joinDue(dueDate, dueTime);
    const meta: TaskMeta = {
      checklist: checklist.filter((c) => c.text.trim()),
      tags,
      taskType,
      branchOrDept: branchOrDept || undefined,
      reminderEnabled,
      reminderOffset,
      recurrence,
      visibility,
      notes: notes.trim() || undefined,
      verifiedAt: (editing?.meta as TaskMeta | null | undefined)?.verifiedAt,
      messages,
      history: [
        ...history,
        ...(editing
          ? []
          : [
              {
                id: `h-save-${Date.now()}`,
                text: t("tasks.form.hist.saved"),
                createdAt: new Date().toISOString(),
              },
            ]),
      ].slice(-80),
    };
    await onSave({
      title: title.trim().slice(0, TITLE_MAX),
      description: description.trim().slice(0, DESC_MAX) || null,
      priority,
      status: editing?.status || "todo",
      dueAt: dueLocal ? new Date(dueLocal).toISOString() : null,
      assigneeKind: kind as "user" | "employee",
      assigneeId: parseInt(idStr, 10),
      attachments,
      meta,
    });
  }

  function buildLiveMeta(
    nextMessages: TaskChatMessage[],
    nextHistory: TaskHistoryEvent[],
  ): TaskMeta {
    return {
      checklist: checklist.filter((c) => c.text.trim()),
      tags,
      taskType,
      branchOrDept: branchOrDept || undefined,
      reminderEnabled,
      reminderOffset,
      recurrence,
      visibility,
      notes: notes.trim() || undefined,
      verifiedAt: (editing?.meta as TaskMeta | null | undefined)?.verifiedAt,
      messages: nextMessages,
      history: nextHistory,
    };
  }

  async function persistChatNow(
    nextMessages: TaskChatMessage[],
    nextHistory: TaskHistoryEvent[],
    nextAttachments: TaskAttachment[],
  ) {
    if (!editing || !onPersistChat) {
      throw new Error("Chat saqlash uchun vazifa kerak");
    }
    await onPersistChat({
      meta: buildLiveMeta(nextMessages, nextHistory),
      attachments: nextAttachments,
    });
  }

  function pushHistory(text: string): TaskHistoryEvent[] {
    const next = [
      ...historyRef.current,
      { id: `h-${Date.now()}`, text, createdAt: new Date().toISOString() },
    ].slice(-80);
    setHistory(next);
    return next;
  }

  async function sendChat(text: string, attachment?: TaskAttachment | null) {
    if (!selectedAssignee && !editing) {
      toast({ title: t("tasks.form.chat.needAssignee"), variant: "destructive" });
      return;
    }
    const body = text.trim();
    if (!body && !attachment) return;

    const msg: TaskChatMessage = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: body,
      authorName: currentUserName || t("tasks.form.you"),
      authorRole: isWork ? "assignee" : "assigner",
      createdAt: new Date().toISOString(),
      attachment: attachment || null,
    };
    const nextMessages = [...messagesRef.current, msg].slice(-200);
    setMessages(nextMessages);
    setChatDraft("");
    const nextHistory = pushHistory(
      attachment ? t("tasks.form.hist.fileSent") : t("tasks.form.hist.msgSent"),
    );
    let nextAttachments = attachmentsRef.current;
    if (attachment && !nextAttachments.some((a) => a.id === attachment.id)) {
      nextAttachments = [...nextAttachments, attachment].slice(0, 12);
      setAttachments(nextAttachments);
    }
    requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });

    // Yangi vazifa — xabar forma bilan birga saqlanadi
    if (!editing) return;

    // Mavjud vazifa — darhol serverga (blob URL allaqachon /api/uploads da)
    setChatPersisting(true);
    try {
      try {
        const updated = await sendTaskMessage.mutateAsync({
          id: editing.id,
          text: body,
          attachment: attachment || null,
        });
        const meta = (updated.meta || {}) as TaskMeta;
        setMessages(Array.isArray(meta.messages) ? meta.messages : nextMessages);
        setHistory(Array.isArray(meta.history) ? meta.history : nextHistory);
        setAttachments(updated.attachments || nextAttachments);
        onTaskUpdated?.(updated);
      } catch {
        // Eski API / 404 bo‘lsa — meta orqali saqlash
        await persistChatNow(nextMessages, nextHistory, nextAttachments);
      }
    } catch (e: any) {
      toast({
        title: t("tasks.form.chat.persistFail"),
        description: e?.message || "Xato",
        variant: "destructive",
      });
    } finally {
      setChatPersisting(false);
    }
  }

  function clearPendingPreview() {
    setPendingPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  function onPickChatBlob(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: t("tasks.form.fileFail"),
        description: `«${file.name}» 10 MB dan katta`,
        variant: "destructive",
      });
      return;
    }
    clearPendingPreview();
    const url = URL.createObjectURL(file);
    setPendingPreview({
      file,
      url,
      kind: file.type.startsWith("image/") ? "image" : "file",
    });
  }

  async function sendPendingOrText() {
    if (pendingPreview) {
      setChatUploading(true);
      try {
        const att = await fileToAttachment(pendingPreview.file);
        const caption = chatDraft.trim();
        clearPendingPreview();
        await sendChat(caption || (att.kind === "image" ? "📷" : att.name), att);
      } catch (e: any) {
        toast({
          title: t("tasks.form.fileFail"),
          description: e?.message || "Xato",
          variant: "destructive",
        });
      } finally {
        setChatUploading(false);
      }
      return;
    }
    await sendChat(chatDraft);
  }

  const roleLabel = userRoleLabel(currentUserRole) || (currentUserRole || "").replace(/_/g, " ");
  const assignerDisplayName = assignerName || editing?.createdByName || t("tasks.form.you");
  const assignerDisplayRole =
    userRoleLabel(assignerRole) || (assignerRole || "").replace(/_/g, " ");
  const assigneeLabel = selectedAssignee?.name || t("tasks.form.assignee");
  const chatPartnerName = isWork ? assignerDisplayName : assigneeLabel;
  const chatPartnerReady = isWork ? !!assignerDisplayName : !!selectedAssignee;
  const EMOJIS = ["👍", "✅", "🙏", "😊", "🔥", "📎", "📷", "⏰", "❗", "👏"];
  const canWorkComplete = isWork && editing?.status === "in_progress";
  const needsWorkAccept = isWork && editing?.status === "todo";
  const workDoneLocked =
    isWork &&
    (editing?.status === "done" ||
      editing?.status === "verified" ||
      (!!editing?.completionNote && editing?.status !== "in_progress"));

  async function pickWorkFiles(files: FileList | null) {
    if (!files?.length) return;
    setWorkUploading(true);
    try {
      const next = [...workFiles];
      for (const file of Array.from(files)) {
        if (next.length >= 8) break;
        if (file.size > 10 * 1024 * 1024) {
          toast({
            title: t("tasks.form.fileFail"),
            description: `«${file.name}» 10 MB dan katta`,
            variant: "destructive",
          });
          continue;
        }
        next.push(await fileToAttachment(file));
      }
      setWorkFiles(next);
    } catch (e: any) {
      toast({
        title: t("tasks.form.fileFail"),
        description: e?.message || "Xato",
        variant: "destructive",
      });
    } finally {
      setWorkUploading(false);
    }
  }

  async function submitWorkComplete() {
    if (!onWorkComplete) return;
    if (!workNote.trim() && workFiles.length === 0) {
      toast({
        title: "Natija qo‘shing",
        description: "Matn, rasm yoki fayl majburiy",
        variant: "destructive",
      });
      return;
    }
    setWorkBusy(true);
    try {
      await onWorkComplete(workNote.trim(), workFiles);
    } finally {
      setWorkBusy(false);
    }
  }

  function formatMsgTime(iso: string) {
    try {
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    } catch {
      return "";
    }
  }

  const CHAT_BG =
    "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=70";

  const hasSubmittedResult =
    !!editing?.completionNote || (editing?.completionAttachments?.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden border-0 bg-transparent p-0 shadow-none",
          expanded
            ? "h-[96vh] w-[98vw] max-w-[98vw] sm:max-w-[98vw]"
            : "max-h-[94vh] w-[96vw] max-w-7xl sm:max-w-7xl",
        )}
      >
        <div
          className={cn(
            "flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border shadow-[0_24px_80px_rgba(10,37,64,0.18)]",
            isWork
              ? "border-teal-200/70 bg-gradient-to-br from-teal-50 via-emerald-50/40 to-slate-50 dark:border-teal-900 dark:from-slate-950 dark:via-emerald-950/30 dark:to-slate-950"
              : "border-slate-200/60 bg-gradient-to-br from-[#eef4ff] via-[#f7f9fc] to-[#e8fff7] dark:border-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950",
          )}
        >
          <div
            className={cn(
              "h-1.5 w-full bg-gradient-to-r",
              isWork
                ? "from-teal-700 via-emerald-500 to-cyan-400"
                : "from-[#0a2540] via-[#0b5fff] to-teal-400",
            )}
          />
          <DialogHeader className="space-y-1 border-b border-slate-200/70 bg-white/75 px-5 py-4 pr-14 text-left backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    isWork
                      ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800"
                      : "bg-sky-100 text-sky-800 ring-1 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800",
                  )}
                >
                  {isWork ? t("tasks.work.roleBadge") : t("tasks.form.assignerBadge")}
                </span>
              </div>
              <DialogTitle
                className={cn(
                  "bg-clip-text text-lg font-bold tracking-tight text-transparent sm:text-xl",
                  isWork
                    ? "bg-gradient-to-r from-teal-800 to-emerald-600 dark:from-emerald-200 dark:to-teal-300"
                    : "bg-gradient-to-r from-[#0a2540] to-[#0b5fff] dark:from-white dark:to-sky-300",
                )}
              >
                {isWork
                  ? t("tasks.work.title")
                  : editing
                    ? t("tasks.edit")
                    : t("tasks.form.createTitle")}
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 dark:text-slate-400">
                {isWork ? t("tasks.work.subtitle") : t("tasks.form.createSubtitle")}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              {!isWork && (
              <Popover open={templateOpen} onOpenChange={setTemplateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-full border-blue-200 bg-[#eef4ff] text-xs font-semibold text-[#0b5fff] hover:bg-[#dde9ff] dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    {t("tasks.form.fromTemplate")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="z-[100] w-80 p-0">
                  <Command>
                    <CommandInput placeholder={t("tasks.form.searchTemplate")} />
                    <CommandList className="max-h-64">
                      <CommandEmpty>{t("tasks.form.noTemplate")}</CommandEmpty>
                      <CommandGroup>
                        {(isSbRole(currentUserRole)
                          ? SB_TASK_TEMPLATES
                          : [
                              {
                                group: "Umumiy",
                                title: "Haftalik hisobot",
                                description:
                                  "• Ma’lumotlarni yig‘ish\n• Tahlil qilish\n• Hisobotni tayyorlash\n• Rahbarga yuborish",
                              },
                              {
                                group: "Umumiy",
                                title: "Filial tekshiruvi",
                                description:
                                  "• Joyida ko‘rik\n• Kamchiliklarni qayd etish\n• Chora-tadbirlar\n• Natijani yuborish",
                              },
                              {
                                group: "Umumiy",
                                title: "Xodim bilan suhbat",
                                description:
                                  "• Suhbatni rejalashtirish\n• Savollarni tayyorlash\n• Natijani yozib qo‘yish",
                              },
                            ]
                        ).map((tpl, i) => (
                          <CommandItem
                            key={`${tpl.group}-${tpl.title}-${i}`}
                            value={`${tpl.group} ${tpl.title}`}
                            onSelect={() => {
                              if (isSbRole(currentUserRole)) applyTemplate(i);
                              else {
                                setTitle(tpl.title.slice(0, TITLE_MAX));
                                setDescription(tpl.description.slice(0, DESC_MAX));
                                setTemplateOpen(false);
                              }
                            }}
                          >
                            <span className="truncate text-xs text-muted-foreground">{tpl.group}:</span>
                            <span className="ml-1 truncate">{tpl.title}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? t("tasks.form.collapse") : t("tasks.form.expand")}
              >
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div
          className={cn(
            "grid min-h-0 flex-1 overflow-y-auto lg:overflow-hidden",
            "grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.78fr)_minmax(300px,0.85fr)]",
          )}
        >
          {/* LEFT */}
          <div className="space-y-3.5 overflow-y-auto border-b border-slate-200/60 bg-transparent p-3.5 sm:p-4 xl:border-b-0 xl:border-r xl:border-slate-200/60 dark:border-slate-800">
            {editing && (
              <div
                className={cn(
                  CARD,
                  "border-l-4 p-3",
                  isWork ? "border-l-emerald-500" : "border-l-sky-500",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      "text-[11px] font-bold uppercase tracking-wide",
                      isWork
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-sky-700 dark:text-sky-300",
                    )}
                  >
                    {isWork ? t("tasks.work.roleBadge") : t("tasks.form.tracking")}
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
                      isWork
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                        : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
                    )}
                  >
                    {t(
                      editing.status === "todo"
                        ? "tasks.status.todo"
                        : editing.status === "in_progress"
                          ? "tasks.status.in_progress"
                          : editing.status === "done"
                            ? "tasks.status.done"
                            : editing.status === "verified"
                              ? "tasks.status.verified"
                              : editing.status === "cancelled"
                                ? "tasks.status.cancelled"
                                : "tasks.status.todo",
                    )}
                  </span>
                </div>
                {editing.dueAt && editing.status !== "verified" && editing.status !== "cancelled" && (
                  <DeadlineCountdown deadline={editing.dueAt} showDate className="!mt-1" />
                )}
              </div>
            )}

            <SectionCard title={t("tasks.form.section.main")} tint="blue">
            {isWork ? (
              <div className="space-y-3">
                <div>
                  <p className={cn(LABEL, "mb-1")}>{t("tasks.form.taskName")}</p>
                  <p className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 text-sm font-semibold text-[#0a2540] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50">
                    {title || "—"}
                  </p>
                </div>
                <div>
                  <p className={cn(LABEL, "mb-1")}>{t("tasks.field.desc")}</p>
                  <div className="min-h-[100px] whitespace-pre-wrap rounded-xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-3 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                    {description || "Tavsif yo‘q"}
                  </div>
                </div>
                {checklist.length > 0 && (
                  <ul className="space-y-1.5 rounded-xl border border-slate-200/70 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                    {checklist.map((c) => (
                      <li key={c.id} className="flex items-start gap-2 text-sm">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0b5fff]" />
                        <span className={cn(c.done && "text-muted-foreground line-through")}>
                          {c.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className={LABEL}>{t("tasks.form.taskName")}</Label>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500 dark:bg-slate-800">
                  {title.length}/{TITLE_MAX}
                </span>
              </div>
              <Input
                value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("tasks.form.phTitle")}
                className={FIELD}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className={LABEL}>{t("tasks.field.desc")}</Label>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500 dark:bg-slate-800">
                  {description.length}/{DESC_MAX}
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-[#f4f7fb] shadow-inner dark:border-slate-700 dark:bg-slate-950">
                <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200/80 bg-gradient-to-r from-[#eef4ff] to-white px-1.5 py-1 dark:from-slate-900 dark:to-slate-950 dark:border-slate-700">
                  {[
                    { icon: Bold, action: () => applyDescFormat("**", "**"), tip: "Bold" },
                    { icon: Italic, action: () => applyDescFormat("_", "_"), tip: "Italic" },
                    { icon: Underline, action: () => applyDescFormat("__", "__"), tip: "Underline" },
                    { icon: List, action: insertBullet, tip: "List" },
                    { icon: ListOrdered, action: () => applyDescFormat("1. ", ""), tip: "Ordered" },
                    { icon: Link2, action: () => applyDescFormat("[", "](url)"), tip: "Link" },
                    { icon: ImageIcon, action: () => applyDescFormat("![", "](url)"), tip: "Image" },
                    { icon: Code2, action: () => applyDescFormat("`", "`"), tip: "Code" },
                  ].map(({ icon: Icon, action, tip }) => (
                    <Button
                      key={tip}
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-500 hover:bg-white hover:text-[#0b5fff]"
                      onClick={action}
                      title={tip}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </Button>
                  ))}
                  <div className="mx-1 h-4 w-px bg-slate-200" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 rounded-full bg-violet-50 px-2.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-300"
                    onClick={applyAiAssist}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    AI
                  </Button>
                </div>
                <Textarea
                  ref={descRef}
                  value={description}
                  maxLength={DESC_MAX}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  placeholder={t("tasks.form.phDesc")}
                  className="min-h-[120px] resize-y rounded-none border-0 bg-transparent focus-visible:ring-0"
                />
              </div>
            </div>
              </>
            )}
            </SectionCard>

            {isWork ? (
              <>
                <SectionCard title={t("tasks.form.assigner")} tint="teal">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0a2540] to-[#0b5fff] text-sm font-bold text-white shadow-md">
                      {assignerDisplayName.trim().charAt(0).toUpperCase() || "B"}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[#0a2540] dark:text-slate-50">
                        {assignerDisplayName}
                      </p>
                      {assignerDisplayRole ? (
                        <p className="truncate text-[12px] font-medium capitalize text-slate-500">
                          {assignerDisplayRole}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title={t("tasks.form.section.schedule")} tint="amber">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className={cn(LABEL, "mb-1")}>{t("tasks.deadline")}</p>
                      <p className="inline-flex items-center gap-2 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                        <Calendar className="h-3.5 w-3.5" />
                        {editing?.dueAt
                          ? formatStatusTime(editing.dueAt) || "—"
                          : t("tasks.noDue")}
                      </p>
                    </div>
                    <div>
                      <p className={cn(LABEL, "mb-1")}>{t("tasks.priorityLabel")}</p>
                      <span
                        className={cn(
                          "inline-flex rounded-lg border px-2.5 py-1.5 text-xs font-bold",
                          PRIORITIES.find((p) => p.value === priority)?.idle,
                        )}
                      >
                        {t(PRIORITIES.find((p) => p.value === priority)?.labelKey || "tasks.priority.normal")}
                      </span>
                    </div>
                  </div>
                </SectionCard>

                {canWorkComplete ? (
                  <SectionCard
                    title={t("tasks.result")}
                    tint="emerald"
                    className="ring-1 ring-emerald-200/80 dark:ring-emerald-800/50"
                  >
                    <div className="space-y-3">
                      <p className="text-xs leading-snug text-slate-600 dark:text-slate-300">
                        {t("tasks.work.resultHint")}
                      </p>
                      <div className="space-y-1.5">
                        <Label className={LABEL}>{t("tasks.resultText")}</Label>
                        <Textarea
                          value={workNote}
                          onChange={(e) => setWorkNote(e.target.value)}
                          rows={4}
                          placeholder={t("tasks.ph.result")}
                          className="min-h-[110px] resize-y rounded-xl border-slate-300 bg-white text-sm shadow-none focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/25 dark:border-slate-600 dark:bg-slate-950"
                        />
                      </div>
                      <input
                        ref={workFileRef}
                        type="file"
                        multiple
                        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
                        className="hidden"
                        onChange={(e) => {
                          void pickWorkFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        disabled={workUploading}
                        onClick={() => workFileRef.current?.click()}
                        className="flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-teal-400/80 bg-white px-3 py-5 text-sm text-teal-800 transition hover:border-teal-500 hover:bg-teal-50/50 dark:border-teal-500/50 dark:bg-slate-950 dark:text-teal-200"
                      >
                        <Paperclip className="h-5 w-5 text-teal-600" />
                        <span className="font-bold">
                          {workUploading ? t("ui.loading") : t("tasks.work.attachFile")}
                        </span>
                        <span className="text-[11px] font-medium text-slate-500">
                          {t("tasks.work.attachHint")}
                        </span>
                      </button>
                      {workFiles.length > 0 && (
                        <ul className="space-y-1.5">
                          {workFiles.map((a) => (
                            <li
                              key={a.id}
                              className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/50 px-2.5 py-1.5 text-xs dark:border-emerald-900 dark:bg-emerald-950/30"
                            >
                              {isImageAtt(a) ? (
                                <img
                                  src={a.url}
                                  alt=""
                                  className="h-8 w-8 rounded object-cover"
                                />
                              ) : (
                                <FileText className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                              )}
                              <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setWorkFiles((prev) => prev.filter((x) => x.id !== a.id))
                                }
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </SectionCard>
                ) : workDoneLocked || hasSubmittedResult ? (
                  <SubmittedResultView
                    note={editing?.completionNote || workNote}
                    files={
                      (editing?.completionAttachments?.length
                        ? editing.completionAttachments
                        : workFiles) || []
                    }
                    assigneeName={editing?.assigneeName || currentUserName}
                    completedAt={editing?.completedAt}
                    awaitingReview={editing?.status === "done"}
                    onOpenImage={setLightboxUrl}
                    t={t}
                  />
                ) : null}
              </>
            ) : (
              <>
            <SectionCard title={t("tasks.form.section.assign")} tint="teal">
              <div className="space-y-1.5">
                <Label className={LABEL}>{t("tasks.form.assignee")}</Label>
                <Popover modal open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      className={cn(
                        FIELD,
                        "h-12 w-full justify-between px-3.5 font-normal",
                      )}
                    >
                      <span
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-3 text-left",
                          !selectedAssignee && "text-muted-foreground",
                        )}
                      >
                        {selectedAssignee ? (
                          <>
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
                              {selectedAssignee.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-[#0a2540] dark:text-slate-50">
                                {selectedAssignee.name}
                              </span>
                              {selectedAssignee.meta ? (
                                <span className="block truncate text-[11px] text-slate-500">
                                  {selectedAssignee.meta}
                                </span>
                              ) : null}
                            </span>
                          </>
                        ) : (
                          <span className="text-sm">{t("tasks.pickEmployee")}</span>
                        )}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="z-[100] w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command
                      filter={(value, searchQ) => {
                        const q = searchQ.trim().toLowerCase();
                        if (!q) return 1;
                        return value.toLowerCase().includes(q) ? 1 : 0;
                      }}
                    >
                      <CommandInput placeholder={t("tasks.searchEmployee")} />
                      <CommandList className="max-h-64">
                        <CommandEmpty>{t("tasks.noEmployee")}</CommandEmpty>
                        <CommandGroup>
                          {assigneeOptions.map((o) => (
                            <CommandItem
                              key={o.key}
                              value={o.label}
                              onSelect={() => {
                                setAssigneeKey(o.key);
                                setAssigneeOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4 shrink-0",
                                  assigneeKey === o.key ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <span className="min-w-0 flex-1 truncate">
                                <span className="block truncate font-medium">{o.name}</span>
                                {o.meta ? (
                                  <span className="block truncate text-[11px] text-muted-foreground">
                                    {o.meta}
                                  </span>
                                ) : null}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </SectionCard>

            <SectionCard title={t("tasks.form.section.schedule")} tint="amber">
            <div className="space-y-1.5">
              <Label className={LABEL}>{t("tasks.deadline")}</Label>
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#0b5fff]" />
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={cn(FIELD, "pl-8")} />
                </div>
                <div className="relative">
                  <Clock className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#0b5fff]" />
                  <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={cn(FIELD, "pl-8")} />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className={LABEL}>{t("tasks.priorityLabel")}</Label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className={cn(
                      "rounded-xl border px-2 py-2.5 text-xs font-bold tracking-wide transition-all",
                      priority === p.value ? p.active : p.idle,
                    )}
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className={LABEL}>{t("tasks.form.taskType")}</Label>
                <Select value={taskType} onValueChange={setTaskType}>
                  <SelectTrigger className={FIELD}>
                    <div className="flex items-center gap-2">
                      <Tag className="h-3.5 w-3.5 text-[#0b5fff]" />
                      <SelectValue />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map((x) => (
                      <SelectItem key={x.value} value={x.value}>
                        {t(x.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className={LABEL}>{t("tasks.form.tags")}</Label>
                <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-slate-200/90 bg-[#f4f7fb] px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-[#0b5fff] px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm"
                    >
                      {tag}
                      <button type="button" onClick={() => setTags((prev) => prev.filter((x) => x !== tag))}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    ref={tagInputRef}
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder={tags.length ? "" : t("tasks.form.addTag")}
                    className="min-w-[72px] flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400"
                  />
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] font-semibold text-[#0b5fff]" onClick={addTag}>
                    <Plus className="mr-0.5 h-3 w-3" />
                    {t("tasks.form.add")}
                  </Button>
                </div>
              </div>
            </div>
            </SectionCard>

            {hasSubmittedResult && (
              <SubmittedResultView
                note={editing?.completionNote}
                files={editing?.completionAttachments}
                assigneeName={editing?.assigneeName || selectedAssignee?.name}
                completedAt={editing?.completedAt}
                awaitingReview={editing?.status === "done"}
                onOpenImage={setLightboxUrl}
                onVerify={
                  editing?.status === "done" && onVerify
                    ? (action) => void onVerify(action)
                    : undefined
                }
                t={t}
              />
            )}

            <SectionCard title={t("tasks.form.section.files")} tint="violet">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className={LABEL}>{t("tasks.form.filesOptional")}</Label>
                    {attachments.length > 0 ? (
                      <span className="rounded-full bg-[#eef4ff] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#0b5fff]">
                        {attachments.length}/10
                      </span>
                    ) : null}
                  </div>

                  <div
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setFileDragOver(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setFileDragOver(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                      setFileDragOver(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setFileDragOver(false);
                      if (!attachUploading) void onPickFiles(e.dataTransfer.files);
                    }}
                    className={cn(
                      "rounded-2xl border border-dashed px-4 py-5 transition-all",
                      fileDragOver || attachUploading
                        ? "border-[#0b5fff] bg-[#e8f0ff] shadow-inner"
                        : "border-blue-200/90 bg-gradient-to-b from-[#f3f7ff] to-white dark:border-blue-900 dark:from-blue-950/25 dark:to-slate-900",
                    )}
                  >
                    <button
                      type="button"
                      disabled={attachUploading || attachments.length >= 10}
                      onClick={() => fileRef.current?.click()}
                      className="flex w-full flex-col items-center justify-center gap-2 text-center outline-none disabled:opacity-60"
                    >
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b5fff]/10 text-[#0b5fff] ring-1 ring-[#0b5fff]/20">
                        <CloudUpload className="h-6 w-6" />
                      </span>
                      <p className="text-sm font-semibold text-[#0a2540] dark:text-slate-100">
                        {attachUploading ? (
                          t("tasks.form.uploading")
                        ) : (
                          <>
                            {t("tasks.form.dropOr")}{" "}
                            <span className="text-[#0b5fff] underline decoration-[#0b5fff]/40 underline-offset-2">
                              {t("tasks.form.selectLink")}
                            </span>
                          </>
                        )}
                      </p>
                      <p className="max-w-md text-[11px] leading-relaxed text-slate-500">
                        {t("tasks.form.dropHint")}
                      </p>
                    </button>

                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.mp4,application/pdf,video/mp4"
                      className="sr-only"
                      disabled={attachUploading}
                      onChange={(e) => {
                        void onPickFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />

                    {(attachments.length > 0 || !attachUploading) && (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {attachments.map((a) => {
                          const { Icon, className: iconCls } = attachmentIcon(a);
                          return (
                            <div
                              key={a.id}
                              className="flex max-w-full items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-2.5 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                            >
                              <span
                                className={cn(
                                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                                  iconCls,
                                )}
                              >
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 max-w-[160px]">
                                <span className="block truncate text-xs font-semibold text-[#0a2540] dark:text-slate-100">
                                  {a.name}
                                </span>
                                <span className="block text-[10px] text-slate-500">
                                  {formatSize(a.size) || a.mimeType || "—"}
                                </span>
                              </span>
                              <button
                                type="button"
                                className="ml-0.5 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                                onClick={() =>
                                  setAttachments((prev) => prev.filter((x) => x.id !== a.id))
                                }
                                aria-label="Remove"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                        {attachments.length < 10 ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={attachUploading}
                            className="h-9 gap-1.5 rounded-xl border-blue-200 bg-[#eef4ff] text-xs font-semibold text-[#0b5fff] hover:bg-[#dde9ff] dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
                            onClick={() => fileRef.current?.click()}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {t("tasks.form.addFile")}
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className={LABEL}>{t("tasks.form.extraNotes")}</Label>
                    <span className="text-[11px] tabular-nums text-slate-400">
                      {notes.length}/{NOTES_MAX}
                    </span>
                  </div>
                  <Textarea
                    value={notes}
                    maxLength={NOTES_MAX}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder={t("tasks.form.phNotes")}
                    className="min-h-[88px] resize-y rounded-xl border-slate-200/90 bg-[#f4f7fb] text-sm shadow-none focus-visible:border-[#0b5fff] focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-[#0b5fff]/25 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
            </SectionCard>

              </>
            )}
          </div>

          {/* MIDDLE (settings) */}
          <div className="flex min-h-0 flex-col overflow-y-auto border-b border-slate-200/60 bg-transparent p-3.5 sm:p-4 dark:border-slate-800 xl:border-b-0 xl:border-r">
            {!isWork && hasSubmittedResult && (
              <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-2.5 dark:border-emerald-800 dark:bg-emerald-950/40">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
                  {t("tasks.form.assigneeResult")}
                </p>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-emerald-950 dark:text-emerald-100">
                  {editing?.completionNote?.trim() ||
                    t("tasks.form.resultNoText")}
                </p>
                {(editing?.completionAttachments?.length ?? 0) > 0 && (
                  <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                    {t("tasks.form.resultFiles")}: {editing!.completionAttachments.length}
                  </p>
                )}
              </div>
            )}
            <div className={cn(CARD, "mb-3 relative shrink-0 !p-3")}>
              <div
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-2xl bg-gradient-to-b",
                  isWork ? "from-teal-700 to-emerald-500" : "from-[#0a2540] to-[#0b5fff]",
                )}
              />
              <div className="flex items-center gap-3 pl-2.5">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0a2540] to-[#0b5fff] text-sm font-bold text-white shadow-md shadow-blue-500/25 ring-2 ring-white dark:ring-slate-800"
                  aria-hidden
                >
                  {(isWork ? assignerDisplayName : currentUserName || t("tasks.form.you"))
                    .trim()
                    .charAt(0)
                    .toUpperCase() || "S"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0b5fff]">
                      {t("tasks.form.assigner")}
                    </p>
                    {!isWork && (
                      <span className="rounded-full bg-emerald-50 px-1.5 py-px text-[9px] font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800">
                        {t("tasks.form.auto")}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm font-bold leading-tight text-[#0a2540] dark:text-slate-50">
                    {isWork ? (
                      assignerDisplayName
                    ) : (
                      <>
                        {t("tasks.form.you")}
                        {currentUserName ? (
                          <span className="font-semibold text-slate-700 dark:text-slate-200">
                            {" · "}
                            {currentUserName}
                          </span>
                        ) : null}
                      </>
                    )}
                  </p>
                  {(isWork ? assignerDisplayRole : roleLabel) ? (
                    <p className="truncate text-[11px] font-medium capitalize text-slate-500 dark:text-slate-400">
                      {isWork ? assignerDisplayRole : roleLabel}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className={cn(CARD, "mb-3 relative shrink-0 !p-3.5")}>
              <div className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-gradient-to-b from-emerald-400 to-[#0b5fff]" />
              <div className="mb-3 flex items-center justify-between gap-2 pl-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#0a2540]/65 dark:text-slate-400">
                  {t("tasks.form.taskStatus")}
                </p>
                <span className="rounded-full bg-[#eef4ff] px-2 py-0.5 text-[9px] font-bold text-[#0b5fff] ring-1 ring-blue-200 dark:bg-blue-950 dark:text-blue-300">
                  {t("tasks.form.statusAuto")}
                </span>
              </div>
              <ol className="relative m-0 list-none space-y-0 pl-2.5">
                {statusTimeline.map((s, idx) => {
                  const isLast = idx === statusTimeline.length - 1;
                  const active = s.done || s.current;
                  return (
                    <li key={s.key} className="relative flex gap-2.5 pb-3 last:pb-0">
                      {!isLast && (
                        <span
                          className={cn(
                            "absolute left-[9px] top-6 bottom-0 w-0.5",
                            s.done ? "bg-emerald-400" : "bg-slate-200 dark:bg-slate-700",
                          )}
                        />
                      )}
                      <span
                        className={cn(
                          "relative z-[1] mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                          s.done &&
                            "border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/30",
                          s.current &&
                            !s.done &&
                            "border-[#0b5fff] bg-white text-[#0b5fff] ring-2 ring-blue-500/20 dark:bg-slate-900",
                          !s.done &&
                            !s.current &&
                            "border-slate-300 bg-white text-transparent dark:border-slate-600 dark:bg-slate-900",
                        )}
                      >
                        {s.done ? <Check className="h-3 w-3 stroke-[3]" /> : null}
                        {s.current && !s.done ? (
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0b5fff]" />
                        ) : null}
                      </span>
                      <div
                        className={cn(
                          "min-w-0 flex-1 rounded-lg px-2.5 py-1.5 transition-colors",
                          s.current && !s.done
                            ? "border border-blue-200 bg-[#eef4ff] dark:border-blue-900 dark:bg-blue-950/30"
                            : s.done
                              ? "border border-emerald-100/80 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/15"
                              : "border border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={cn(
                              "text-[13px] font-semibold leading-tight",
                              active
                                ? "text-[#0a2540] dark:text-slate-50"
                                : "text-slate-500 dark:text-slate-400",
                            )}
                          >
                            {t(s.labelKey)}
                          </p>
                          {s.at ? (
                            <span className="shrink-0 text-[9px] font-semibold tabular-nums text-slate-500">
                              {formatStatusTime(s.at)}
                            </span>
                          ) : s.current ? (
                            <span className="shrink-0 text-[9px] font-bold text-[#0b5fff]">
                              {t("tasks.form.statusNow")}
                            </span>
                          ) : null}
                        </div>
                        <p
                          className={cn(
                            "mt-0.5 text-[10px] leading-snug",
                            active ? "text-slate-500" : "text-slate-400",
                          )}
                        >
                          {t(s.hintKey)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            {!isWork && (
              <>
            <div className={cn(CARD, "mb-3 space-y-2")}>
              <label className="flex items-center gap-2 text-sm font-semibold text-[#0a2540] dark:text-slate-100">
                <Checkbox checked={reminderEnabled} onCheckedChange={(v) => setReminderEnabled(!!v)} />
                {t("tasks.form.setReminder")}
              </label>
              <Select value={reminderOffset} onValueChange={setReminderOffset} disabled={!reminderEnabled}>
                <SelectTrigger className={cn(FIELD, "h-9")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1h">{t("tasks.form.remind.1h")}</SelectItem>
                  <SelectItem value="3h">{t("tasks.form.remind.3h")}</SelectItem>
                  <SelectItem value="1d">{t("tasks.form.remind.1d")}</SelectItem>
                  <SelectItem value="3d">{t("tasks.form.remind.3d")}</SelectItem>
                  <SelectItem value="1w">{t("tasks.form.remind.1w")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500">{t("tasks.form.remindHint")}</p>
            </div>

            <div className={cn(CARD, "mb-3 space-y-2")}>
              <label className="flex items-center gap-2 text-sm font-semibold text-[#0a2540] dark:text-slate-100">
                <Checkbox
                  checked={recurrence !== "none"}
                  onCheckedChange={(v) => setRecurrence(v ? "weekly" : "none")}
                />
                {t("tasks.form.recurring")}
              </label>
              <Select value={recurrence} onValueChange={setRecurrence}>
                <SelectTrigger className={cn(FIELD, "h-9")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("tasks.form.recur.none")}</SelectItem>
                  <SelectItem value="daily">{t("tasks.form.recur.daily")}</SelectItem>
                  <SelectItem value="weekly">{t("tasks.form.recur.weekly")}</SelectItem>
                  <SelectItem value="monthly">{t("tasks.form.recur.monthly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className={cn(CARD, "mb-3 space-y-2")}>
              <p className="text-sm font-semibold text-[#0a2540] dark:text-slate-100">{t("tasks.form.visibility")}</p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  className="mt-1 accent-[#0b5fff]"
                  checked={visibility === "all"}
                  onChange={() => setVisibility("all")}
                />
                <span>
                  <span className="font-medium">{t("tasks.form.vis.all")}</span>
                  <span className="block text-[11px] text-slate-500">{t("tasks.form.vis.allHint")}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  className="mt-1 accent-[#0b5fff]"
                  checked={visibility === "private"}
                  onChange={() => setVisibility("private")}
                />
                <span>
                  <span className="font-medium">{t("tasks.form.vis.private")}</span>
                  <span className="block text-[11px] text-slate-500">{t("tasks.form.vis.privateHint")}</span>
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={() => setExtraOpen((v) => !v)}
              className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              <Settings2 className="h-4 w-4" />
              {t("tasks.form.extraSettings")}
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </button>
            {extraOpen && (
              <div className="mb-4 rounded-2xl border border-dashed border-slate-300 bg-white p-3 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                {t("tasks.form.extraSettingsHint")}
              </div>
            )}
              </>
            )}

            {isWork && editing?.dueAt && (
              <div className={cn(CARD, "mb-3 space-y-2")}>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  {t("tasks.deadline")}
                </p>
                <p className="flex items-center gap-2 text-sm font-semibold text-[#0a2540] dark:text-slate-50">
                  <Calendar className="h-4 w-4 text-[#0b5fff]" />
                  {formatStatusTime(editing.dueAt)}
                </p>
                {editing.status !== "verified" && editing.status !== "cancelled" && (
                  <DeadlineCountdown deadline={editing.dueAt} showDate className="!mt-1" />
                )}
              </div>
            )}

            <div className="mt-auto flex flex-col gap-2 border-t border-slate-200/80 pt-4 dark:border-slate-800 sm:flex-row">
              {isWork ? (
                <>
                  {needsWorkAccept && (
                    <Button
                      type="button"
                      className="flex-1 gap-1.5 rounded-xl bg-[#0b5fff] shadow-md shadow-blue-500/25 hover:bg-[#0a54e6]"
                      disabled={workBusy}
                      onClick={() => {
                        void (async () => {
                          if (!onWorkAccept) return;
                          setWorkBusy(true);
                          try {
                            await onWorkAccept();
                          } finally {
                            setWorkBusy(false);
                          }
                        })();
                      }}
                    >
                      {t("tasks.accept")}
                    </Button>
                  )}
                  {canWorkComplete && (
                    <>
                      <Button
                        type="button"
                        className="flex-1 gap-1.5 rounded-xl bg-[#0b5fff] shadow-md shadow-blue-500/25 hover:bg-[#0a54e6]"
                        disabled={workBusy || saving}
                        onClick={() => void submitWorkComplete()}
                      >
                        <Send className="h-4 w-4" />
                        {t("tasks.markDone")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl border-slate-200 px-4"
                        onClick={() => onWorkExtend?.()}
                      >
                        <Clock className="h-4 w-4" />
                        {t("tasks.deadline")}
                      </Button>
                    </>
                  )}
                  {!needsWorkAccept && !canWorkComplete && (
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 rounded-xl"
                      onClick={() => onOpenChange(false)}
                    >
                      {t("ui.close") !== "ui.close" ? t("ui.close") : "Yopish"}
                    </Button>
                  )}
                </>
              ) : (
                <>
              <Button
                type="button"
                variant="outline"
                className="flex-1 rounded-xl border-slate-200"
                onClick={() => onOpenChange(false)}
              >
                {t("ui.cancel")}
              </Button>
              <Button
                type="button"
                className="flex-1 gap-1.5 rounded-xl bg-[#0b5fff] shadow-md shadow-blue-500/25 hover:bg-[#0a54e6]"
                disabled={saving}
                onClick={() => void handleSubmit()}
              >
                {saving ? (
                  t("tasks.form.saving")
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    {editing ? t("ui.save") : t("tasks.form.createAction")}
                  </>
                )}
              </Button>
                </>
              )}
            </div>
          </div>

          {/* RIGHT: Chat / Files / History */}
          <div className="flex min-h-[360px] flex-col overflow-hidden rounded-none bg-white/70 backdrop-blur-sm dark:bg-slate-900/70 xl:min-h-0 xl:rounded-br-2xl">
            <div className="flex border-b border-slate-200/70 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
              {(
                [
                  { id: "chat" as const, label: t("tasks.form.tab.chat"), icon: MessageCircle },
                  {
                    id: "files" as const,
                    label: `${t("tasks.form.tab.files")}${attachments.length ? ` (${attachments.length})` : ""}`,
                    icon: Paperclip,
                  },
                  { id: "history" as const, label: t("tasks.form.tab.history"), icon: History },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = sideTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSideTab(tab.id)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-semibold transition-colors",
                      active
                        ? "border-[#0b5fff] text-[#0b5fff]"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {sideTab === "chat" && (
              <>
                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                  {/* Mountain background — messages stay opaque & clear */}
                  <div
                    className="pointer-events-none absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${CHAT_BG})` }}
                    aria-hidden
                  />
                  <div
                    className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/88 via-white/82 to-white/90 dark:from-slate-950/88 dark:via-slate-950/84 dark:to-slate-950/92"
                    aria-hidden
                  />

                  <div className="relative z-[1] flex items-center gap-2 border-b border-white/50 bg-white/70 px-3 py-2 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/70">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white shadow">
                      {(chatPartnerName || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {chatPartnerReady ? chatPartnerName : t("tasks.form.chat.pickFirst")}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {chatPartnerReady
                          ? t("tasks.form.chat.withAssignee")
                          : t("tasks.form.chat.emptyHint")}
                      </p>
                    </div>
                    {chatPersisting && (
                      <span className="text-[10px] font-medium text-sky-700">{t("tasks.form.chat.saving")}</span>
                    )}
                  </div>

                  <div className="relative z-[1] flex-1 space-y-3 overflow-y-auto p-3">
                    <div className="flex justify-center">
                      <span className="rounded-full bg-white/95 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm ring-1 ring-black/5 dark:bg-slate-900/95 dark:text-slate-300">
                        {t("tasks.form.chat.today")}
                      </span>
                    </div>

                    {messages.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-300/80 bg-white/95 px-3 py-8 text-center shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95">
                        <MessageCircle className="mx-auto mb-2 h-8 w-8 text-slate-400" />
                        <p className="text-sm font-semibold text-foreground">{t("tasks.form.chat.empty")}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {chatPartnerReady
                            ? t("tasks.form.chat.emptyWith").replace("{name}", chatPartnerName)
                            : t("tasks.form.chat.emptyHint")}
                        </p>
                      </div>
                    )}

                    {messages.map((m) => {
                      const mine = isWork
                        ? m.authorRole === "assignee"
                        : m.authorRole !== "assignee" && m.authorRole !== "system";
                      const img = isImageAtt(m.attachment);
                      return (
                        <div
                          key={m.id}
                          className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}
                        >
                          {!mine && (
                            <span className="mt-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white shadow">
                              {(m.authorName || "?").slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <div className={cn("max-w-[88%] space-y-1")}>
                            {!mine && (
                              <p className="px-1 text-[10px] font-semibold text-slate-700 drop-shadow-sm dark:text-slate-200">
                                {m.authorName}
                              </p>
                            )}
                            <div
                              className={cn(
                                "rounded-2xl px-3 py-2 text-sm shadow-md ring-1",
                                mine
                                  ? "rounded-br-md bg-[#0b5fff] text-white ring-black/5"
                                  : "rounded-bl-md bg-white text-slate-900 ring-black/10 dark:bg-slate-900 dark:text-slate-50 dark:ring-white/10",
                                m.authorRole === "system" &&
                                  "border-dashed bg-white/95 text-center text-xs text-muted-foreground",
                              )}
                            >
                              {m.text && m.text !== "📷" ? (
                                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                              ) : null}
                              {m.attachment && img && (
                                <button
                                  type="button"
                                  className="mt-1.5 block overflow-hidden rounded-lg"
                                  onClick={() => setLightboxUrl(m.attachment!.url)}
                                >
                                  <img
                                    src={m.attachment.url}
                                    alt={m.attachment.name}
                                    loading="lazy"
                                    className="max-h-48 max-w-full object-cover"
                                  />
                                </button>
                              )}
                              {m.attachment && !img && (
                                <a
                                  href={
                                    m.attachment.url.startsWith("/api/uploads/")
                                      ? `${m.attachment.url}${m.attachment.url.includes("?") ? "&" : "?"}download=1`
                                      : m.attachment.url
                                  }
                                  target="_blank"
                                  rel="noreferrer"
                                  className={cn(
                                    "mt-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium",
                                    mine ? "bg-white/20 hover:bg-white/30" : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800",
                                  )}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <FileText className="h-3.5 w-3.5 shrink-0" />
                                  <span className="min-w-0 truncate">{m.attachment.name}</span>
                                  <span className="shrink-0 opacity-70">{formatSize(m.attachment.size)}</span>
                                </a>
                              )}
                            </div>
                            <div
                              className={cn(
                                "flex items-center gap-1 px-1 text-[10px] font-medium text-slate-600 dark:text-slate-300",
                                mine && "justify-end",
                              )}
                            >
                              <span className="rounded bg-white/80 px-1 dark:bg-slate-900/80">{formatMsgTime(m.createdAt)}</span>
                              {mine && <CheckCheck className="h-3 w-3 text-sky-600" />}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>
                </div>

                <div className="relative z-[2] border-t border-border bg-background p-2.5">
                  {pendingPreview && (
                    <div className="mb-2 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/90 px-2 py-1.5 dark:border-sky-900 dark:bg-sky-950/50">
                      {pendingPreview.kind === "image" ? (
                        <img src={pendingPreview.url} alt="" className="h-12 w-12 rounded-md object-cover" />
                      ) : (
                        <span className="flex h-12 w-12 items-center justify-center rounded-md bg-white dark:bg-slate-900">
                          <FileText className="h-5 w-5 text-sky-700" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">{pendingPreview.file.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatSize(pendingPreview.file.size)} · blob
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={clearPendingPreview}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  <div className="flex items-end gap-2 rounded-xl border border-border bg-muted/30 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <textarea
                        value={chatDraft}
                        onChange={(e) => setChatDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void sendPendingOrText();
                          }
                        }}
                        rows={2}
                        placeholder={
                          chatPartnerReady
                            ? t("tasks.form.chat.phTo").replace("{name}", chatPartnerName)
                            : t("tasks.form.chat.ph")
                        }
                        className="w-full resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
                      />
                      <div className="flex items-center gap-0.5 pb-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          disabled={chatUploading}
                          onClick={() => chatFileRef.current?.click()}
                          title={t("tasks.form.chat.attach")}
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                        </Button>
                        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                          <PopoverTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                              <Smile className="h-3.5 w-3.5" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="z-[120] w-auto p-2" align="start">
                            <div className="grid grid-cols-5 gap-1">
                              {EMOJIS.map((e) => (
                                <button
                                  key={e}
                                  type="button"
                                  className="rounded-md p-1.5 text-lg hover:bg-muted"
                                  onClick={() => {
                                    setChatDraft((v) => v + e);
                                    setEmojiOpen(false);
                                  }}
                                >
                                  {e}
                                </button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          onClick={() =>
                            setChatDraft((v) =>
                              `${v}${v && !v.endsWith(" ") ? " " : ""}@${selectedAssignee?.name || ""}`.trimEnd(),
                            )
                          }
                          title="Mention"
                        >
                          <AtSign className="h-3.5 w-3.5" />
                        </Button>
                        <input
                          ref={chatFileRef}
                          type="file"
                          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf"
                          className="sr-only"
                          onChange={(e) => {
                            onPickChatBlob(e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      className="mb-0.5 h-9 w-9 shrink-0 rounded-xl bg-[#0b5fff] hover:bg-[#0a54e6]"
                      disabled={
                        chatUploading ||
                        chatPersisting ||
                        (!chatDraft.trim() && !pendingPreview)
                      }
                      onClick={() => void sendPendingOrText()}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
                    {editing
                      ? t("tasks.form.chat.liveNote")
                      : t("tasks.form.chat.saveNote")}
                  </p>
                </div>

                {lightboxUrl && (
                  <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
                    onClick={() => setLightboxUrl(null)}
                  >
                    <img
                      src={lightboxUrl}
                      alt=""
                      className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="absolute right-4 top-4"
                      onClick={() => setLightboxUrl(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}

            {sideTab === "files" && (
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {attachments.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {t("tasks.form.filesEmpty")}
                  </p>
                ) : (
                  attachments.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm"
                    >
                      {isImageAtt(a) ? (
                        <button
                          type="button"
                          className="h-12 w-12 shrink-0 overflow-hidden rounded-lg"
                          onClick={() => setLightboxUrl(a.url)}
                        >
                          <img src={a.url} alt={a.name} className="h-full w-full object-cover" loading="lazy" />
                        </button>
                      ) : (
                        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          <FileText className="h-4 w-4" />
                        </span>
                      )}
                      <a
                        href={
                          a.url.startsWith("/api/uploads/")
                            ? `${a.url}${a.url.includes("?") ? "&" : "?"}download=1`
                            : a.url
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 hover:underline"
                      >
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatSize(a.size) || a.mimeType}
                        </span>
                      </a>
                    </div>
                  ))
                )}
              </div>
            )}

            {sideTab === "history" && (
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {[...history].reverse().map((h) => (
                  <div
                    key={h.id}
                    className="relative rounded-xl border border-border bg-muted/20 px-3 py-2.5 pl-4"
                  >
                    <span className="absolute left-0 top-3 h-2 w-2 -translate-x-1/2 rounded-full bg-[#0b5fff]" />
                    <p className="text-sm text-foreground">{h.text}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatMsgTime(h.createdAt)} · {new Date(h.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
