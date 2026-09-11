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
  RotateCcw,
  Reply,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
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
  type TaskChatReplyTo,
  type TaskChecklistItem,
  type TaskHistoryEvent,
  type TaskMeta,
  type TaskSubmissionHistoryItem,
  type Vazifa,
  type VazifaInput,
} from "@/lib/vazifalar-api";
import { useToast } from "@/hooks/use-toast";
import { DeadlineCountdown } from "@/components/DeadlineCountdown";
import { AcceptWindowCountdown } from "@/components/vazifalar/AcceptWindowCountdown";
import {
  TaskAttachmentViewer,
  isImageAtt as isImageAttShared,
} from "@/components/vazifalar/TaskAttachmentViewer";
import { isTaskOverdue, isAcceptOverdue, acceptDeadlineAt } from "@/lib/vazifalar-permissions";
import { isOfisWorkplace, isWeekendYmd } from "@/lib/ofis-weekend";

const CHAT_PALETTE = [
  "#0b5fff",
  "#7c3aed",
  "#059669",
  "#ea580c",
  "#db2777",
  "#0891b2",
  "#4f46e5",
  "#ca8a04",
];

function chatColorFor(name: string): string {
  const s = String(name || "").trim() || "?";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CHAT_PALETTE[h % CHAT_PALETTE.length];
}

function extractMentions(text: string, names: string[]): string[] {
  const found: string[] = [];
  for (const name of names) {
    if (!name) continue;
    const re = new RegExp(
      `@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$|[.,!?;:])`,
      "i",
    );
    if (re.test(text)) found.push(name);
  }
  return found;
}

function renderMentionText(text: string, mentions?: string[]) {
  if (!text) return null;
  const names = (mentions || []).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length) {
    let hit: { name: string; at: number } | null = null;
    for (const name of names) {
      const idx = rest.toLowerCase().indexOf(`@${name.toLowerCase()}`);
      if (idx >= 0 && (!hit || idx < hit.at)) hit = { name, at: idx };
    }
    if (!hit) {
      parts.push(rest);
      break;
    }
    if (hit.at > 0) parts.push(rest.slice(0, hit.at));
    const token = rest.slice(hit.at, hit.at + hit.name.length + 1);
    const color = chatColorFor(hit.name);
    parts.push(
      <span
        key={`m-${key++}`}
        className="rounded px-0.5 font-bold"
        style={{ color, backgroundColor: `${color}22` }}
      >
        {token}
      </span>,
    );
    rest = rest.slice(hit.at + hit.name.length + 1);
  }
  return parts;
}

export type AssigneeOption = {
  key: string;
  name: string;
  label: string;
  kind: "user" | "employee";
  id: number;
  meta: string;
  workplace?: "ofis" | "dorixona";
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
  /** Bir batchdagi boshqa vazifalar (yaratuvchi uchun holat) */
  batchSiblings?: Vazifa[];
  onOpenBatchTask?: (task: Vazifa) => void;
};

const TITLE_MAX = 200;
const DESC_MAX = 2000;
const NOTES_MAX = 500;

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
  "rounded-2xl border border-white/80 bg-white/95 p-4 shadow-[0_1px_2px_rgba(10,37,64,0.04),0_10px_28px_rgba(11,95,255,0.07)] ring-1 ring-slate-900/[0.04] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95 dark:ring-white/5";

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
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r",
          tintBar,
        )}
      />
      <p className={cn("mb-3 pt-1 text-[11px] font-bold uppercase tracking-[0.14em]", titleTone)}>
        {title}
      </p>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

function isImageAtt(a?: TaskAttachment | null) {
  return isImageAttShared(a);
}

/** Beruvchi / bajaruvchi uchun yuborilgan natijani aniq ko‘rsatish */
function SubmittedResultView({
  note,
  files,
  assigneeName,
  completedAt,
  awaitingReview,
  onOpenFile,
  onVerify,
  t,
}: {
  note?: string | null;
  files?: TaskAttachment[] | null;
  assigneeName?: string | null;
  completedAt?: string | null;
  awaitingReview?: boolean;
  onOpenFile?: (file: TaskAttachment) => void;
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
                    onClick={() => onOpenFile?.(a)}
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
                {docs.map((a) => {
                  const { Icon, className: iconCls } = attachmentIcon(a);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onOpenFile?.(a)}
                        className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left text-xs font-medium text-[#0a2540] transition hover:border-emerald-300 hover:bg-emerald-50/60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                            iconCls,
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{a.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatSize(a.size) || "ko‘rish"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {awaitingReview && onVerify ? (
          <div className="space-y-2 border-t border-emerald-100 pt-3 dark:border-emerald-900">
            <Button
              type="button"
              size="lg"
              className="h-11 w-full gap-2 rounded-xl bg-emerald-600 text-base font-bold shadow-md hover:bg-emerald-700"
              onClick={() => onVerify("approve")}
            >
              <CheckCircle2 className="h-5 w-5" />
              {t("ui.approve")} — bajarildi
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 w-full gap-2 rounded-xl border-[#0b5fff]/40 bg-gradient-to-r from-[#eef4ff] to-[#e8f1ff] text-base font-bold text-[#0a2540] shadow-sm hover:border-[#0b5fff] hover:from-[#dde9ff] hover:to-[#d4e4ff] dark:border-[#0b5fff]/50 dark:from-[#0a2540]/60 dark:to-[#0b5fff]/20 dark:text-sky-100"
              onClick={() => onVerify("rework")}
            >
              <RotateCcw className="h-5 w-5" />
              {t("tasks.rework")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SubmissionHistoryPanel({
  items,
  onOpenFile,
  t,
}: {
  items: TaskSubmissionHistoryItem[];
  onOpenFile?: (file: TaskAttachment) => void;
  t: (k: string) => string;
}) {
  if (!items.length) return null;
  const ordered = [...items].reverse();
  return (
    <div className="space-y-2.5 rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/90 via-white to-orange-50/50 p-3 dark:border-amber-800/50 dark:from-amber-950/40 dark:via-slate-900 dark:to-orange-950/20">
      <div className="flex items-center gap-2">
        <RotateCcw className="h-4 w-4 text-amber-700 dark:text-amber-300" />
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-900 dark:text-amber-100">
          {t("tasks.return.history")}
          <span className="ml-1.5 rounded-full bg-amber-200/80 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-amber-800/60">
            {items.length}
          </span>
        </p>
      </div>
      <ul className="max-h-56 space-y-2 overflow-y-auto pr-0.5">
        {ordered.map((s, idx) => (
          <li
            key={s.id || `sub-${idx}`}
            className="rounded-xl border border-amber-200/70 bg-white/90 px-3 py-2.5 text-xs dark:border-amber-800/40 dark:bg-slate-950/50"
          >
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-semibold text-amber-800/90 dark:text-amber-200/90">
              <span>#{items.length - idx}</span>
              {s.completedAt ? (
                <span className="tabular-nums opacity-80">
                  {formatStatusTime(s.completedAt)}
                </span>
              ) : null}
              {s.returnedAt ? (
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                  {t("tasks.rework")} · {formatStatusTime(s.returnedAt)}
                </span>
              ) : null}
            </div>
            {s.note?.trim() ? (
              <p className="whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-slate-100">
                {s.note}
              </p>
            ) : (
              <p className="text-muted-foreground">{t("tasks.form.resultNoText")}</p>
            )}
            {(s.attachments?.length ?? 0) > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {s.attachments!.slice(0, 6).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onOpenFile?.(a)}
                    className="inline-flex max-w-[140px] items-center gap-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium hover:border-amber-300 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <Paperclip className="h-3 w-3 shrink-0" />
                    <span className="truncate">{a.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {s.returnNote?.trim() ? (
              <p className="mt-2 rounded-lg border border-rose-200/70 bg-rose-50/80 px-2 py-1.5 text-[11px] leading-snug text-rose-900 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-100">
                <span className="font-bold">{t("tasks.return.note")}: </span>
                {s.returnNote}
                {s.returnedByName ? (
                  <span className="opacity-80"> · {s.returnedByName}</span>
                ) : null}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
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
  /** Kechikkan bosqich — qizil uslub */
  danger?: boolean;
};

function formatStatusTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Muddatdan keyin yakunlangan / hozir kechikkan (qabul yoki due) */
function taskHitOverdue(task: Vazifa): {
  hit: boolean;
  currently: boolean;
  at: string | null;
  reason: "accept" | "due" | null;
} {
  if (isAcceptOverdue(task)) {
    return {
      hit: true,
      currently: true,
      at: acceptDeadlineAt(task).toISOString(),
      reason: "accept",
    };
  }
  const dueIso = task.dueAt || null;
  const currently = isTaskOverdue(task);
  if (!dueIso) {
    return {
      hit: currently,
      currently,
      at: currently ? task.createdAt || null : null,
      reason: currently ? "due" : null,
    };
  }
  let lateCompletion = false;
  if (task.completedAt) {
    lateCompletion =
      startOfLocalDay(new Date(task.completedAt)).getTime() >
      startOfLocalDay(new Date(dueIso)).getTime();
  }
  return {
    hit: currently || lateCompletion,
    currently,
    at: currently || lateCompletion ? dueIso : null,
    reason: currently || lateCompletion ? "due" : null,
  };
}

function buildStatusTimeline(task: Vazifa | null): StatusStep[] {
  const empty: StatusStep[] = [
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
      key: "overdue",
      labelKey: "tasks.form.status.overdue",
      hintKey: "tasks.form.status.overdueHint",
      done: false,
      current: false,
      at: null,
      danger: true,
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

  if (!task) return empty;

  const status = task.status || "todo";
  const meta = (task.meta || {}) as TaskMeta;
  const createdAt = task.createdAt || null;
  const acceptedAt = task.acceptedAt || null;
  const completedAt = task.completedAt || null;
  const verifiedAt =
    meta.verifiedAt || (status === "verified" ? task.updatedAt || null : null);

  const hasAccepted =
    !!acceptedAt ||
    status === "in_progress" ||
    status === "done" ||
    status === "verified";
  const hasProgress =
    status === "in_progress" || status === "done" || status === "verified";
  const hasReview = !!completedAt || status === "done" || status === "verified";
  const hasDone = status === "verified";
  const overdueInfo = taskHitOverdue(task);
  const acceptMissed = overdueInfo.reason === "accept";

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
      labelKey: acceptMissed
        ? "tasks.form.status.notAccepted"
        : "tasks.form.status.accepted",
      hintKey: acceptMissed
        ? "tasks.form.status.notAcceptedHint"
        : "tasks.form.status.acceptedHint",
      done: hasAccepted,
      current: false,
      at: hasAccepted ? acceptedAt : acceptMissed ? overdueInfo.at : null,
      danger: acceptMissed,
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
      key: "overdue",
      labelKey: "tasks.form.status.overdue",
      hintKey: acceptMissed
        ? "tasks.form.status.notAcceptedHint"
        : "tasks.form.status.overdueHint",
      done: overdueInfo.hit && !overdueInfo.currently,
      current: overdueInfo.currently,
      at: overdueInfo.at,
      danger: true,
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

  if (overdueInfo.currently) {
    return steps.map((s) => ({
      ...s,
      current: s.key === "overdue",
    }));
  }

  const allMainDone = steps.filter((s) => s.key !== "overdue").every((s) => s.done);
  const currentIdx = allMainDone
    ? steps.length - 1
    : Math.max(0, steps.findIndex((s) => s.key !== "overdue" && !s.done));

  return steps.map((s, i) => ({
    ...s,
    current: s.key === "overdue" ? false : i === currentIdx,
  }));
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
  batchSiblings = [],
  onOpenBatchTask,
}: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const sendTaskMessage = useSendTaskMessage();
  const isWork = mode === "work";
  const descRef = useRef<HTMLTextAreaElement>(null);
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
  const [multiAssigneeKeys, setMultiAssigneeKeys] = useState<string[]>([]);
  const [multiAssigneeOpen, setMultiAssigneeOpen] = useState(false);
  const [batchDetailId, setBatchDetailId] = useState<number | null>(null);
  const [filterOfis, setFilterOfis] = useState(true);
  const [filterDorixona, setFilterDorixona] = useState(true);
  const [branchOrDept, setBranchOrDept] = useState("");
  const [taskType, setTaskType] = useState("hisobot");
  const [tags, setTags] = useState<string[]>([]);
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
  const [mobilePanel, setMobilePanel] = useState<"main" | "settings" | "side">("main");
  const [messages, setMessages] = useState<TaskChatMessage[]>([]);
  const [history, setHistory] = useState<TaskHistoryEvent[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatUploading, setChatUploading] = useState(false);
  const [chatPersisting, setChatPersisting] = useState(false);
  const [replyTo, setReplyTo] = useState<TaskChatMessage | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<{
    file: File;
    url: string;
    kind: "image" | "file";
  } | null>(null);
  const [viewerFile, setViewerFile] = useState<TaskAttachment | null>(null);
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
      setMultiAssigneeKeys([]);
      setBatchDetailId(null);
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
      setReplyTo(null);
      setMentionOpen(false);
      setSideTab("chat");
      setMobilePanel("main");
      setExpanded(false);
      setViewerFile(null);
      setWorkNote(editing.completionNote || "");
      setWorkFiles(editing.completionAttachments || []);
      return;
    }
    setTitle("");
    setDescription("");
    setPriority("normal");
    setAssigneeKey("");
    setMultiAssigneeKeys([]);
    setBatchDetailId(null);
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
    setReplyTo(null);
    setMentionOpen(false);
    setSideTab("chat");
    setMobilePanel("main");
    setExpanded(false);
    setViewerFile(null);
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
  const selectedMultiAssignees = useMemo(
    () =>
      multiAssigneeKeys
        .map((k) => assigneeOptions.find((o) => o.key === k))
        .filter(Boolean) as AssigneeOption[],
    [assigneeOptions, multiAssigneeKeys],
  );
  const batchMembers = useMemo(() => {
    if (!editing?.meta?.batchId) return [] as Vazifa[];
    const self = editing;
    const others = batchSiblings.filter(
      (t) => t.id !== self.id && t.meta?.batchId === self.meta?.batchId,
    );
    return [self, ...others].sort((a, b) =>
      String(a.assigneeName || "").localeCompare(String(b.assigneeName || ""), "uz"),
    );
  }, [editing, batchSiblings]);
  const batchDetail = useMemo(
    () => batchMembers.find((t) => t.id === batchDetailId) || null,
    [batchMembers, batchDetailId],
  );

  function toggleMultiAssignee(key: string) {
    setAssigneeKey("");
    setMultiAssigneeKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function pickSingleAssignee(key: string) {
    setMultiAssigneeKeys([]);
    setAssigneeKey(key);
    setAssigneeOpen(false);
  }

  function batchStatusLabel(task: Vazifa) {
    if (task.status === "verified") return t("tasks.batch.status.verified");
    if (task.status === "done") return t("tasks.batch.status.done");
    if (task.status === "in_progress" || task.acceptedAt) {
      return t("tasks.batch.status.accepted");
    }
    if (task.status === "todo") return t("tasks.batch.status.pending");
    return t(`tasks.status.${task.status}` as any) || task.status;
  }

  function batchStatusClass(task: Vazifa) {
    if (task.status === "verified")
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200";
    if (task.status === "done")
      return "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200";
    if (task.status === "in_progress" || task.acceptedAt)
      return "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200";
    return "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100";
  }

  const filteredAssigneeOptions = useMemo(() => {
    const showOfis = filterOfis;
    const showDorixona = filterDorixona;
    if (showOfis && showDorixona) return assigneeOptions;
    if (!showOfis && !showDorixona) return [];
    return assigneeOptions.filter((o) => {
      const wp = o.workplace || "ofis";
      if (showOfis && wp === "ofis") return true;
      if (showDorixona && wp === "dorixona") return true;
      return false;
    });
  }, [assigneeOptions, filterOfis, filterDorixona]);

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
    const multiSpecs = multiAssigneeKeys
      .map((key) => {
        const [kind, idStr] = key.split(":");
        const id = parseInt(idStr, 10);
        if (!kind || !Number.isFinite(id)) return null;
        return {
          assigneeKind: (kind === "employee" ? "employee" : "user") as
            | "user"
            | "employee",
          assigneeId: id,
        };
      })
      .filter(Boolean) as Array<{
      assigneeKind: "user" | "employee";
      assigneeId: number;
    }>;

    const useMulti = !editing && multiSpecs.length > 0;
    if (!useMulti && !assigneeKey) {
      toast({ title: t("tasks.form.needAssignee"), variant: "destructive" });
      return;
    }
    const dueLocal = joinDue(dueDate, dueTime);
    if (dueLocal && isWeekendYmd(dueDate)) {
      const ofisHit = useMulti
        ? multiSpecs.some((s) => {
            const o = assigneeOptions.find(
              (x) => x.key === `${s.assigneeKind}:${s.assigneeId}`,
            );
            return isOfisWorkplace(o?.workplace);
          })
        : isOfisWorkplace(selectedAssignee?.workplace);
      if (ofisHit) {
        toast({
          title: t("tasks.form.ofisWeekendBlocked"),
          description: t("tasks.form.ofisWeekendHint"),
          variant: "destructive",
        });
        return;
      }
    }
    const [kind, idStr] = useMulti
      ? [
          multiSpecs[0].assigneeKind,
          String(multiSpecs[0].assigneeId),
        ]
      : assigneeKey.split(":");
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
      batchId: (editing?.meta as TaskMeta | null | undefined)?.batchId,
      batchSize: (editing?.meta as TaskMeta | null | undefined)?.batchSize,
    };
    await onSave({
      title: title.trim().slice(0, TITLE_MAX),
      description: description.trim().slice(0, DESC_MAX) || null,
      priority,
      status: editing?.status || "todo",
      dueAt: dueLocal ? new Date(dueLocal).toISOString() : null,
      assigneeKind: kind as "user" | "employee",
      assigneeId: parseInt(idStr, 10),
      assignees: useMulti ? multiSpecs : undefined,
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
    if (!hasChatAssignees && !editing) {
      toast({ title: t("tasks.form.chat.needAssignee"), variant: "destructive" });
      return;
    }
    const body = text.trim();
    if (!body && !attachment) return;

    const mentionNames = chatParticipantNames;
    const mentions = extractMentions(body, mentionNames);
    const replyPayload: TaskChatReplyTo | null = replyTo
      ? {
          id: replyTo.id,
          authorName: replyTo.authorName,
          text: (replyTo.text || "").slice(0, 240),
        }
      : null;

    const msg: TaskChatMessage = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: body,
      authorName: currentUserName || t("tasks.form.you"),
      authorRole: isWork ? "assignee" : "assigner",
      createdAt: new Date().toISOString(),
      attachment: attachment || null,
      mentions,
      replyTo: replyPayload,
    };
    const nextMessages = [...messagesRef.current, msg].slice(-200);
    setMessages(nextMessages);
    setChatDraft("");
    setReplyTo(null);
    setMentionOpen(false);
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

    if (!editing) return;

    setChatPersisting(true);
    try {
      try {
        const updated = await sendTaskMessage.mutateAsync({
          id: editing.id,
          text: body,
          attachment: attachment || null,
          mentions,
          replyTo: replyPayload,
        });
        const meta = (updated.meta || {}) as TaskMeta;
        setMessages(Array.isArray(meta.messages) ? meta.messages : nextMessages);
        setHistory(Array.isArray(meta.history) ? meta.history : nextHistory);
        setAttachments(updated.attachments || nextAttachments);
        onTaskUpdated?.(updated);
      } catch {
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
  const chatParticipants = useMemo(() => {
    if (isWork) {
      return [
        {
          key: "assigner",
          name: assignerDisplayName,
          color: chatColorFor(assignerDisplayName),
        },
      ].filter((p) => p.name);
    }
    if (editing) {
      const list = [
        {
          key: `a-${editing.assigneeKind}:${editing.assigneeId}`,
          name: editing.assigneeName || assigneeLabel,
          color: chatColorFor(editing.assigneeName || assigneeLabel),
        },
      ];
      if (selectedMultiAssignees.length) {
        for (const o of selectedMultiAssignees) {
          if (!list.some((x) => x.name === o.name)) {
            list.push({ key: o.key, name: o.name, color: chatColorFor(o.name) });
          }
        }
      }
      return list;
    }
    if (selectedMultiAssignees.length > 0) {
      return selectedMultiAssignees.map((o) => ({
        key: o.key,
        name: o.name,
        color: chatColorFor(o.name),
      }));
    }
    if (selectedAssignee) {
      return [
        {
          key: selectedAssignee.key,
          name: selectedAssignee.name,
          color: chatColorFor(selectedAssignee.name),
        },
      ];
    }
    return [];
  }, [
    isWork,
    editing,
    assignerDisplayName,
    assigneeLabel,
    selectedAssignee,
    selectedMultiAssignees,
  ]);
  const chatParticipantNames = useMemo(
    () => chatParticipants.map((p) => p.name),
    [chatParticipants],
  );
  const hasChatAssignees = chatParticipants.length > 0 || !!editing;
  const chatPartnerName = isWork
    ? assignerDisplayName
    : chatParticipants.length > 1
      ? t("tasks.form.chat.group")
          .replace("{n}", String(chatParticipants.length))
      : chatParticipants[0]?.name || assigneeLabel;
  const chatPartnerReady = isWork ? !!assignerDisplayName : hasChatAssignees;
  const singleModeLocked = !editing && multiAssigneeKeys.length > 0;
  const multiModeLocked = !editing && !!assigneeKey;
  const EMOJIS = ["👍", "✅", "🙏", "😊", "🔥", "📎", "📷", "⏰", "❗", "👏"];
  const canWorkComplete =
    isWork && editing?.status === "in_progress" && !(editing && isTaskOverdue(editing));
  const needsWorkAccept =
    isWork && editing?.status === "todo" && !(editing && isTaskOverdue(editing));
  const workOverdueLocked = isWork && !!editing && isTaskOverdue(editing);
  const workAcceptLocked = isWork && !!editing && isAcceptOverdue(editing);
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
  const submissionHistory = Array.isArray(editing?.meta?.submissionHistory)
    ? editing!.meta!.submissionHistory!
    : [];
  const lastReworkNote =
    typeof editing?.meta?.lastReworkNote === "string"
      ? editing.meta.lastReworkNote.trim()
      : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className={cn(
          "flex flex-col gap-0 overflow-hidden border-0 bg-transparent p-0 shadow-none",
          // Mobile: fullscreen sheet; desktop: centered modal
          "inset-0 left-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-full translate-x-0 translate-y-0 rounded-none",
          "sm:inset-auto sm:left-[50%] sm:top-[50%] sm:h-auto sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-3xl",
          expanded
            ? "sm:h-[96vh] sm:max-h-[96vh] sm:w-[98vw] sm:max-w-[98vw]"
            : "sm:max-h-[94vh] sm:w-[96vw] sm:max-w-7xl",
        )}
      >
        <div
          className={cn(
            "relative flex h-full min-h-0 flex-col overflow-hidden border shadow-[0_24px_80px_rgba(10,37,64,0.18)] sm:rounded-3xl",
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
          <DialogHeader className="space-y-1 border-b border-slate-200/70 bg-white/75 px-4 py-3 text-left backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80 sm:px-5 sm:py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
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
                  "bg-clip-text text-base font-bold tracking-tight text-transparent sm:text-xl",
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
              <DialogDescription className="hidden text-sm text-slate-500 dark:text-slate-400 sm:block">
                {isWork ? t("tasks.work.subtitle") : t("tasks.form.createSubtitle")}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
              {!isWork && (
              <Popover open={templateOpen} onOpenChange={setTemplateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 rounded-full border-blue-200 bg-[#eef4ff] px-2.5 text-xs font-semibold text-[#0b5fff] hover:bg-[#dde9ff] dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300 sm:px-3"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t("tasks.form.fromTemplate")}</span>
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
              <div className="ml-0.5 flex items-center gap-0.5 rounded-full border border-slate-200/80 bg-white/90 p-0.5 shadow-sm dark:border-slate-700 dark:bg-slate-900/90">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hidden h-8 w-8 rounded-full text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:inline-flex"
                  onClick={() => setExpanded((v) => !v)}
                  title={expanded ? t("tasks.form.collapse") : t("tasks.form.expand")}
                >
                  {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    title={t("ui.close") !== "ui.close" ? t("ui.close") : "Yopish"}
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                  </Button>
                </DialogClose>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="shrink-0 border-b border-slate-200/70 bg-white/90 px-2 py-2 dark:border-slate-800 dark:bg-slate-900/90 xl:hidden">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/70 p-1">
            {(
              [
                { id: "main" as const, label: t("tasks.form.panel.main"), icon: FileText },
                { id: "settings" as const, label: t("tasks.form.panel.settings"), icon: Settings2 },
                { id: "side" as const, label: t("tasks.form.panel.side"), icon: MessageCircle },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = mobilePanel === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMobilePanel(tab.id)}
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-bold transition",
                    active
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border/70"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={cn(
            "grid min-h-0 flex-1 gap-3 overflow-hidden p-3 sm:gap-3.5 sm:p-3.5",
            "grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.78fr)_minmax(300px,0.85fr)]",
          )}
        >
          {/* LEFT */}
          <div
            className={cn(
              "min-h-0 space-y-3 overflow-y-auto rounded-2xl border border-white/50 bg-white/35 p-3 shadow-sm backdrop-blur-[2px] dark:border-slate-800/60 dark:bg-slate-950/30 sm:p-3.5",
              mobilePanel === "main" ? "block" : "hidden xl:block",
            )}
          >
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
                {editing.status === "todo" && !editing.acceptedAt ? (
                  <AcceptWindowCountdown task={editing} className="!mt-2" />
                ) : null}
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
                <div className="rounded-xl border border-teal-200/70 bg-teal-50/50 px-3 py-2 dark:border-teal-800/50 dark:bg-teal-950/30">
                  <p className={cn(LABEL, "mb-1")}>{t("tasks.form.assignee")}</p>
                  <p className="text-sm font-semibold text-foreground">
                    {editing?.assigneeName || "—"}
                  </p>
                  {Array.isArray(editing?.meta?.assigneeHistory) &&
                  editing!.meta!.assigneeHistory!.length > 0 ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t("tasks.transferredFrom")}:{" "}
                      {editing!.meta!.assigneeHistory!
                        .map((h) => h.name)
                        .filter(Boolean)
                        .join(" → ")}
                    </p>
                  ) : null}
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

                {workOverdueLocked ? (
                  <div className="rounded-2xl border border-rose-300 bg-rose-50 px-3.5 py-3 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">
                    <p className="font-bold">
                      {workAcceptLocked
                        ? t("tasks.form.status.notAccepted")
                        : "Vaqt tugagan"}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed opacity-90">
                      {workAcceptLocked
                        ? t("tasks.form.acceptLocked")
                        : "O‘zgartirish yopiq — faqat beruvchi muddatni uzaytirishi mumkin."}
                    </p>
                  </div>
                ) : null}

                {lastReworkNote && editing?.status === "in_progress" ? (
                  <div className="rounded-2xl border border-amber-300/80 bg-gradient-to-r from-amber-50 to-orange-50 px-3.5 py-3 dark:border-amber-700/50 dark:from-amber-950/40 dark:to-orange-950/30">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-900 dark:text-amber-100">
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t("tasks.rework")}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-amber-950 dark:text-amber-50">
                      {lastReworkNote}
                    </p>
                    <p className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-200/80">
                      {t("tasks.return.flowHint")}
                    </p>
                  </div>
                ) : null}

                {submissionHistory.length > 0 ? (
                  <SubmissionHistoryPanel
                    items={submissionHistory}
                    onOpenFile={setViewerFile}
                    t={t}
                  />
                ) : null}

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
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                onClick={() => setViewerFile(a)}
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
                              </button>
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
                    onOpenFile={setViewerFile}
                    t={t}
                  />
                ) : null}
              </>
            ) : (
              <>
            <SectionCard title={t("tasks.form.section.assign")} tint="teal">
              <div
                className={cn(
                  "space-y-1.5",
                  singleModeLocked && "pointer-events-none opacity-45",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className={LABEL}>{t("tasks.form.assignee")}</Label>
                  <div className="flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-foreground">
                      <Checkbox
                        checked={filterOfis}
                        onCheckedChange={(v) => setFilterOfis(v === true)}
                        disabled={singleModeLocked}
                      />
                      {t("tasks.form.filterOfis")}
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-foreground">
                      <Checkbox
                        checked={filterDorixona}
                        onCheckedChange={(v) => setFilterDorixona(v === true)}
                        disabled={singleModeLocked}
                      />
                      {t("tasks.form.filterDorixona")}
                    </label>
                  </div>
                </div>
                {singleModeLocked ? (
                  <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    {t("tasks.form.assignExclusiveMulti")}
                  </p>
                ) : editing ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {t("tasks.form.reassignHint")}
                  </p>
                ) : null}
                <Popover
                  modal
                  open={assigneeOpen && !singleModeLocked}
                  onOpenChange={(v) => !singleModeLocked && setAssigneeOpen(v)}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      disabled={singleModeLocked}
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
                            <span
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                              style={{ backgroundColor: chatColorFor(selectedAssignee.name) }}
                            >
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
                          {filteredAssigneeOptions.map((o) => (
                            <CommandItem
                              key={o.key}
                              value={o.label}
                              onSelect={() => pickSingleAssignee(o.key)}
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
                {Array.isArray(editing?.meta?.assigneeHistory) &&
                editing!.meta!.assigneeHistory!.length > 0 ? (
                  <div className="mt-2 space-y-1.5 rounded-xl border border-border/70 bg-muted/30 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {t("tasks.form.assigneeHistory")}
                    </p>
                    <ul className="space-y-1">
                      {[...editing!.meta!.assigneeHistory!]
                        .slice()
                        .reverse()
                        .map((h) => (
                          <li
                            key={h.id}
                            className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px]"
                          >
                            <span className="font-medium text-foreground">{h.name}</span>
                            <span className="text-muted-foreground">
                              {h.statusAtTransfer
                                ? t(`tasks.status.${h.statusAtTransfer}` as any) ||
                                  h.statusAtTransfer
                                : ""}
                              {h.transferredAt
                                ? ` · ${new Date(h.transferredAt).toLocaleString("uz-UZ", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}`
                                : ""}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </SectionCard>

            {!editing ? (
              <SectionCard title={t("tasks.form.section.assignees")} tint="teal">
                <div
                  className={cn(
                    "space-y-2",
                    multiModeLocked && "pointer-events-none opacity-45",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className={LABEL}>{t("tasks.form.assignees")}</Label>
                    <span className="rounded-full bg-teal-600/90 px-2 py-0.5 text-[10px] font-bold text-white">
                      {multiAssigneeKeys.length} {t("tasks.form.selectedCount")}
                    </span>
                  </div>
                  {multiModeLocked ? (
                    <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {t("tasks.form.assignExclusiveSingle")}
                    </p>
                  ) : (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {t("tasks.form.assigneesHint")}
                    </p>
                  )}
                  <Popover
                    modal
                    open={multiAssigneeOpen && !multiModeLocked}
                    onOpenChange={(v) => !multiModeLocked && setMultiAssigneeOpen(v)}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        disabled={multiModeLocked}
                        className={cn(FIELD, "h-12 w-full justify-between px-3.5 font-normal")}
                      >
                        <span
                          className={cn(
                            "truncate text-left text-sm",
                            selectedMultiAssignees.length === 0 && "text-muted-foreground",
                          )}
                        >
                          {selectedMultiAssignees.length === 0
                            ? t("tasks.form.pickAssignees")
                            : selectedMultiAssignees
                                .slice(0, 3)
                                .map((o) => o.name)
                                .join(", ") +
                              (selectedMultiAssignees.length > 3
                                ? ` +${selectedMultiAssignees.length - 3}`
                                : "")}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="z-[100] w-[var(--radix-popover-trigger-width)] p-0"
                      align="start"
                    >
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
                            {filteredAssigneeOptions.map((o) => {
                              const on = multiAssigneeKeys.includes(o.key);
                              return (
                                <CommandItem
                                  key={o.key}
                                  value={o.label}
                                  onSelect={() => toggleMultiAssignee(o.key)}
                                >
                                  <span
                                    className={cn(
                                      "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                      on
                                        ? "border-teal-600 bg-teal-600 text-white"
                                        : "border-slate-300",
                                    )}
                                  >
                                    {on ? <Check className="h-3 w-3" /> : null}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">
                                    <span className="block truncate font-medium">{o.name}</span>
                                    {o.meta ? (
                                      <span className="block truncate text-[11px] text-muted-foreground">
                                        {o.meta}
                                        {o.workplace
                                          ? ` · ${
                                              o.workplace === "ofis"
                                                ? t("tasks.form.filterOfis")
                                                : t("tasks.form.filterDorixona")
                                            }`
                                          : ""}
                                      </span>
                                    ) : null}
                                  </span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedMultiAssignees.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedMultiAssignees.map((o) => (
                        <button
                          key={o.key}
                          type="button"
                          onClick={() => toggleMultiAssignee(o.key)}
                          className="inline-flex max-w-full items-center gap-1 rounded-full border border-teal-300 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-900 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-100"
                        >
                          <span className="truncate">{o.name}</span>
                          <X className="h-3 w-3 shrink-0 opacity-70" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            ) : null}

            {editing && batchMembers.length > 1 ? (
              <SectionCard title={t("tasks.form.section.batchStatus")} tint="teal">
                <div className="space-y-2">
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {t("tasks.batch.hint")}
                  </p>
                  <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                    {batchMembers.map((member) => {
                      const active = batchDetailId === member.id;
                      return (
                        <li key={member.id}>
                          <button
                            type="button"
                            onClick={() =>
                              setBatchDetailId((id) =>
                                id === member.id ? null : member.id,
                              )
                            }
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition",
                              active
                                ? "border-teal-400 bg-teal-50 ring-1 ring-teal-200 dark:border-teal-600 dark:bg-teal-950/40"
                                : "border-border bg-card hover:border-teal-300",
                            )}
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0a2540] to-[#0b5fff] text-[11px] font-bold text-white">
                              {(member.assigneeName || "?").charAt(0).toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-[#0a2540] dark:text-slate-50">
                                {member.assigneeName || `TK-${member.id}`}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                TK-{member.id}
                                {member.id === editing.id
                                  ? ` · ${t("tasks.batch.current")}`
                                  : ""}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                                batchStatusClass(member),
                              )}
                            >
                              {batchStatusLabel(member)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {batchDetail ? (
                    <div className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/70 p-3 dark:border-teal-800 dark:bg-teal-950/30">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-[#0a2540] dark:text-slate-50">
                          {batchDetail.assigneeName}
                        </p>
                        {batchDetail.id !== editing.id && onOpenBatchTask ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg text-xs"
                            onClick={() => onOpenBatchTask(batchDetail)}
                          >
                            {t("tasks.batch.open")}
                          </Button>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {t("tasks.batch.accept")}:{" "}
                        <span className="font-semibold text-foreground">
                          {batchDetail.acceptedAt
                            ? formatStatusTime(batchDetail.acceptedAt)
                            : t("tasks.batch.notAccepted")}
                        </span>
                      </p>
                      {(batchDetail.completionNote ||
                        (batchDetail.completionAttachments?.length ?? 0) > 0) && (
                        <div className="rounded-lg border border-emerald-200 bg-white/90 px-2.5 py-2 dark:border-emerald-800 dark:bg-slate-950/50">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                            {t("tasks.form.assigneeResult")}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                            {batchDetail.completionNote?.trim() ||
                              t("tasks.form.resultNoText")}
                          </p>
                          {(batchDetail.completionAttachments?.length ?? 0) > 0 ? (
                            <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                              {t("tasks.form.resultFiles")}:{" "}
                              {batchDetail.completionAttachments.length}
                            </p>
                          ) : null}
                        </div>
                      )}
                      {!batchDetail.completionNote &&
                      !(batchDetail.completionAttachments?.length ?? 0) ? (
                        <p className="text-[11px] text-muted-foreground">
                          {t("tasks.batch.noResultYet")}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      {t("tasks.batch.tapHint")}
                    </p>
                  )}
                </div>
              </SectionCard>
            ) : null}

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
              {dueDate && isWeekendYmd(dueDate) ? (
                <p className="text-[10px] font-medium leading-snug text-amber-700 dark:text-amber-300">
                  {t("tasks.form.ofisWeekendHint")}
                </p>
              ) : null}
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
              <p className="text-[10px] leading-snug text-muted-foreground">
                {t("tasks.form.acceptWindow")}:{" "}
                <span className="font-semibold text-foreground">
                  {priority === "low"
                    ? "6 soat"
                    : priority === "high"
                      ? "1 soat"
                      : priority === "urgent"
                        ? "10 daqiqa"
                        : "3 soat"}
                </span>
                {" "}ichida qabul qilinmasa —{" "}
                <span className="font-bold text-rose-600 dark:text-rose-400">
                  Kechikkanga o‘tadi
                </span>
              </p>
            </div>

            </SectionCard>

            {hasSubmittedResult && (
              <SubmittedResultView
                note={editing?.completionNote}
                files={editing?.completionAttachments}
                assigneeName={editing?.assigneeName || selectedAssignee?.name}
                completedAt={editing?.completedAt}
                awaitingReview={editing?.status === "done"}
                onOpenFile={setViewerFile}
                onVerify={
                  editing?.status === "done" && onVerify
                    ? (action) => void onVerify(action)
                    : undefined
                }
                t={t}
              />
            )}

            {submissionHistory.length > 0 ? (
              <SubmissionHistoryPanel
                items={submissionHistory}
                onOpenFile={setViewerFile}
                t={t}
              />
            ) : null}

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
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                onClick={() => setViewerFile(a)}
                                title="Ko‘rish"
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
                              </button>
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
          <div
            className={cn(
              "min-h-0 flex-col overflow-y-auto rounded-2xl border border-white/50 bg-white/35 p-3 shadow-sm backdrop-blur-[2px] dark:border-slate-800/60 dark:bg-slate-950/30 sm:p-3.5",
              mobilePanel === "settings" ? "flex" : "hidden xl:flex",
            )}
          >
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
            <div className={cn(CARD, "relative mb-3 shrink-0 !p-3")}>
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r",
                  isWork ? "from-teal-700 to-emerald-500" : "from-[#0a2540] to-[#0b5fff]",
                )}
              />
              <div className="flex items-center gap-3 pt-1">
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

            <div className={cn(CARD, "relative mb-3 shrink-0 !p-3.5")}>
              <div className="pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r from-emerald-400 to-[#0b5fff]" />
              <div className="mb-3 flex items-center justify-between gap-2 pt-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#0a2540]/65 dark:text-slate-400">
                  {t("tasks.form.taskStatus")}
                </p>
                <span className="rounded-full bg-[#eef4ff] px-2 py-0.5 text-[9px] font-bold text-[#0b5fff] ring-1 ring-blue-200 dark:bg-blue-950 dark:text-blue-300">
                  {t("tasks.form.statusAuto")}
                </span>
              </div>
              <ol className="relative m-0 list-none space-y-0">
                {statusTimeline.map((s, idx) => {
                  const isLast = idx === statusTimeline.length - 1;
                  const active = s.done || s.current;
                  const danger = Boolean(
                    s.danger && (s.done || s.current || (s.key === "accepted" && !s.done)),
                  );
                  return (
                    <li key={s.key} className="relative flex gap-2.5 pb-3 last:pb-0">
                      {!isLast && (
                        <span
                          className={cn(
                            "absolute left-[9px] top-6 bottom-0 w-0.5",
                            s.done || (s.danger && s.current)
                              ? danger
                                ? "bg-rose-400"
                                : "bg-emerald-400"
                              : "bg-slate-200 dark:bg-slate-700",
                          )}
                        />
                      )}
                      <span
                        className={cn(
                          "relative z-[1] mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                          s.done &&
                            !danger &&
                            "border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/30",
                          s.done &&
                            danger &&
                            "border-rose-500 bg-rose-500 text-white shadow-sm shadow-rose-500/30",
                          s.current &&
                            !s.done &&
                            !danger &&
                            "border-[#0b5fff] bg-white text-[#0b5fff] ring-2 ring-blue-500/20 dark:bg-slate-900",
                          s.current &&
                            !s.done &&
                            danger &&
                            "border-rose-500 bg-white text-rose-600 ring-2 ring-rose-500/25 dark:bg-slate-900",
                          !s.done &&
                            !s.current &&
                            "border-slate-300 bg-white text-transparent dark:border-slate-600 dark:bg-slate-900",
                        )}
                      >
                        {s.done ? <Check className="h-3 w-3 stroke-[3]" /> : null}
                        {s.current && !s.done ? (
                          <span
                            className={cn(
                              "h-1.5 w-1.5 animate-pulse rounded-full",
                              danger ? "bg-rose-500" : "bg-[#0b5fff]",
                            )}
                          />
                        ) : null}
                      </span>
                      <div
                        className={cn(
                          "min-w-0 flex-1 rounded-lg px-2.5 py-1.5 transition-colors",
                          s.current && !s.done && !danger
                            ? "border border-blue-200 bg-[#eef4ff] dark:border-blue-900 dark:bg-blue-950/30"
                            : s.current && !s.done && danger
                              ? "border border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40"
                              : s.done && danger
                                ? "border border-rose-200/90 bg-rose-50/70 dark:border-rose-900/50 dark:bg-rose-950/25"
                                : s.done
                                  ? "border border-emerald-100/80 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/15"
                                  : "border border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={cn(
                              "text-[13px] font-semibold leading-tight",
                              danger && active
                                ? "text-rose-800 dark:text-rose-200"
                                : active
                                  ? "text-[#0a2540] dark:text-slate-50"
                                  : "text-slate-500 dark:text-slate-400",
                            )}
                          >
                            {t(s.labelKey)}
                          </p>
                          {s.at ? (
                            <span
                              className={cn(
                                "shrink-0 text-[9px] font-semibold tabular-nums",
                                danger ? "text-rose-600 dark:text-rose-300" : "text-slate-500",
                              )}
                            >
                              {formatStatusTime(s.at)}
                            </span>
                          ) : s.current ? (
                            <span
                              className={cn(
                                "shrink-0 text-[9px] font-bold",
                                danger ? "text-rose-600" : "text-[#0b5fff]",
                              )}
                            >
                              {t("tasks.form.statusNow")}
                            </span>
                          ) : null}
                        </div>
                        <p
                          className={cn(
                            "mt-0.5 text-[10px] leading-snug",
                            danger && active
                              ? "text-rose-700/80 dark:text-rose-300/80"
                              : active
                                ? "text-slate-500"
                                : "text-slate-400",
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
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setVisibility("all")}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                    visibility === "all"
                      ? "border-[#0b5fff]/60 bg-[#0b5fff]/8 ring-1 ring-[#0b5fff]/25"
                      : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                      visibility === "all"
                        ? "border-[#0b5fff] bg-[#0b5fff]"
                        : "border-slate-300 dark:border-slate-600",
                    )}
                  >
                    {visibility === "all" ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    ) : null}
                  </span>
                  <span className="text-sm font-medium text-[#0a2540] dark:text-slate-100">
                    {t("tasks.form.vis.all")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility("private")}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                    visibility === "private"
                      ? "border-[#0b5fff]/60 bg-[#0b5fff]/8 ring-1 ring-[#0b5fff]/25"
                      : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                      visibility === "private"
                        ? "border-[#0b5fff] bg-[#0b5fff]"
                        : "border-slate-300 dark:border-slate-600",
                    )}
                  >
                    {visibility === "private" ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    ) : null}
                  </span>
                  <span className="text-sm font-medium text-[#0a2540] dark:text-slate-100">
                    {t("tasks.form.vis.private")}
                  </span>
                </button>
              </div>
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
                {editing.status === "todo" && !editing.acceptedAt ? (
                  <AcceptWindowCountdown task={editing} className="!mt-1" />
                ) : null}
              </div>
            )}

            <div className="mt-auto hidden flex-col gap-2 border-t border-slate-200/80 pt-4 dark:border-slate-800 sm:flex-row xl:flex">
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
          <div
            className={cn(
              "relative min-h-0 flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-[0_1px_2px_rgba(10,37,64,0.04),0_10px_28px_rgba(11,95,255,0.07)] ring-1 ring-slate-900/[0.04] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95 dark:ring-white/5",
              mobilePanel === "side" ? "flex min-h-[calc(100dvh-11rem)]" : "hidden xl:flex",
            )}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-1 rounded-t-2xl bg-gradient-to-r from-[#0b5fff] to-sky-400" />
            <div className="relative flex border-b border-slate-200/70 bg-white/90 pt-1 dark:border-slate-800 dark:bg-slate-900/90">
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
                    {chatParticipants.length > 1 ? (
                      <div className="flex -space-x-2">
                        {chatParticipants.slice(0, 4).map((p) => (
                          <span
                            key={p.key}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white shadow ring-2 ring-white dark:ring-slate-950"
                            style={{ backgroundColor: p.color }}
                            title={p.name}
                          >
                            {p.name.slice(0, 1).toUpperCase()}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow"
                        style={{
                          backgroundColor: chatColorFor(chatPartnerName || "?"),
                        }}
                      >
                        {(chatPartnerName || "?").slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {chatPartnerReady ? chatPartnerName : t("tasks.form.chat.pickFirst")}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {chatPartnerReady
                          ? chatParticipants.length > 1
                            ? chatParticipants.map((p) => p.name).join(" · ")
                            : t("tasks.form.chat.withAssignee")
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
                      const authorColor = chatColorFor(m.authorName || "?");
                      const bubbleColor =
                        m.authorRole === "assigner" ? "#0b5fff" : authorColor;
                      return (
                        <div
                          key={m.id}
                          className={cn("group flex gap-2", mine ? "justify-end" : "justify-start")}
                        >
                          {!mine && (
                            <span
                              className="mt-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow"
                              style={{ backgroundColor: authorColor }}
                            >
                              {(m.authorName || "?").slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <div className={cn("max-w-[88%] space-y-1")}>
                            <div className="flex items-center gap-1.5 px-1">
                              {!mine && (
                                <p
                                  className="text-[10px] font-bold drop-shadow-sm"
                                  style={{ color: authorColor }}
                                >
                                  {m.authorName}
                                </p>
                              )}
                              {mine && (
                                <p className="ml-auto text-[10px] font-bold text-[#0b5fff]">
                                  {t("tasks.form.you")}
                                </p>
                              )}
                            </div>
                            <div
                              className={cn(
                                "rounded-2xl px-3 py-2 text-sm shadow-md ring-1",
                                mine
                                  ? "rounded-br-md text-white ring-black/5"
                                  : "rounded-bl-md bg-white text-slate-900 ring-black/10 dark:bg-slate-900 dark:text-slate-50 dark:ring-white/10",
                                m.authorRole === "system" &&
                                  "border-dashed bg-white/95 text-center text-xs text-muted-foreground",
                              )}
                              style={
                                mine && m.authorRole !== "system"
                                  ? { backgroundColor: bubbleColor }
                                  : undefined
                              }
                            >
                              {m.replyTo ? (
                                <div
                                  className={cn(
                                    "mb-1.5 rounded-lg border-l-4 px-2 py-1 text-[11px]",
                                    mine
                                      ? "border-white/70 bg-white/15 text-white/95"
                                      : "bg-slate-50 dark:bg-slate-800",
                                  )}
                                  style={
                                    !mine
                                      ? {
                                          borderLeftColor: chatColorFor(
                                            m.replyTo.authorName || "?",
                                          ),
                                        }
                                      : undefined
                                  }
                                >
                                  <p
                                    className="font-bold"
                                    style={
                                      !mine
                                        ? {
                                            color: chatColorFor(m.replyTo.authorName || "?"),
                                          }
                                        : undefined
                                    }
                                  >
                                    {m.replyTo.authorName}
                                  </p>
                                  <p className="line-clamp-2 opacity-90">{m.replyTo.text}</p>
                                </div>
                              ) : null}
                              {m.text && m.text !== "📷" ? (
                                <p className="whitespace-pre-wrap break-words">
                                  {renderMentionText(m.text, m.mentions)}
                                </p>
                              ) : null}
                              {m.attachment && img && (
                                <button
                                  type="button"
                                  className="mt-1.5 block overflow-hidden rounded-lg"
                                  onClick={() => setViewerFile(m.attachment!)}
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
                                <button
                                  type="button"
                                  className={cn(
                                    "mt-1.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium",
                                    mine ? "bg-white/20 hover:bg-white/30" : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800",
                                  )}
                                  onClick={() => setViewerFile(m.attachment!)}
                                >
                                  <FileText className="h-3.5 w-3.5 shrink-0" />
                                  <span className="min-w-0 truncate">{m.attachment.name}</span>
                                  <span className="shrink-0 opacity-70">{formatSize(m.attachment.size)}</span>
                                </button>
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
                              {m.authorRole !== "system" ? (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 opacity-70 hover:bg-white/90 hover:opacity-100 dark:hover:bg-slate-900"
                                  onClick={() => setReplyTo(m)}
                                  title={t("tasks.form.chat.reply")}
                                >
                                  <Reply className="h-3 w-3" />
                                  {t("tasks.form.chat.reply")}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                  </div>
                </div>

                <div className="relative z-[2] border-t border-border bg-background p-2.5">
                  {workOverdueLocked ? (
                    <p className="rounded-xl bg-rose-50 px-3 py-2 text-center text-[11px] font-medium text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                      {workAcceptLocked
                        ? t("tasks.form.acceptLocked")
                        : "Vaqt tugagan — o‘zgartirish yopiq"}
                    </p>
                  ) : (
                  <>
                  {replyTo ? (
                    <div className="mb-2 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50/90 px-2.5 py-2 dark:border-sky-800 dark:bg-sky-950/40">
                      <div
                        className="mt-0.5 h-8 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: chatColorFor(replyTo.authorName) }}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-[11px] font-bold"
                          style={{ color: chatColorFor(replyTo.authorName) }}
                        >
                          {t("tasks.form.chat.replyTo")} {replyTo.authorName}
                        </p>
                        <p className="line-clamp-2 text-[11px] text-muted-foreground">
                          {replyTo.text || "📎"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setReplyTo(null)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : null}
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
                        onChange={(e) => {
                          const v = e.target.value;
                          setChatDraft(v);
                          const at = v.lastIndexOf("@");
                          if (at >= 0 && !/\s/.test(v.slice(at + 1))) {
                            setMentionOpen(true);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void sendPendingOrText();
                          }
                          if (e.key === "Escape") setMentionOpen(false);
                        }}
                        rows={2}
                        disabled={!chatPartnerReady && !editing}
                        placeholder={
                          chatPartnerReady
                            ? t("tasks.form.chat.phTo").replace("{name}", chatPartnerName)
                            : t("tasks.form.chat.ph")
                        }
                        className="w-full resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
                      />
                      <div className="flex items-center gap-0.5 pb-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          disabled={chatUploading || (!chatPartnerReady && !editing)}
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
                        <Popover open={mentionOpen} onOpenChange={setMentionOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground"
                              disabled={!chatPartnerReady && !editing}
                              title={t("tasks.form.chat.mention")}
                              onClick={() => setMentionOpen(true)}
                            >
                              <AtSign className="h-3.5 w-3.5" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="z-[120] w-64 p-1.5" align="start">
                            <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                              {t("tasks.form.chat.mentionList")}
                            </p>
                            {chatParticipants.length === 0 ? (
                              <p className="px-2 py-3 text-xs text-muted-foreground">
                                {t("tasks.form.chat.needAssignee")}
                              </p>
                            ) : (
                              <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                                {chatParticipants.map((p) => (
                                  <li key={p.key}>
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                                      onClick={() => {
                                        setChatDraft((v) => {
                                          const at = v.lastIndexOf("@");
                                          const base =
                                            at >= 0 && !/\s/.test(v.slice(at + 1))
                                              ? v.slice(0, at)
                                              : v;
                                          const sep =
                                            base && !base.endsWith(" ") ? " " : "";
                                          return `${base}${sep}@${p.name} `;
                                        });
                                        setMentionOpen(false);
                                      }}
                                    >
                                      <span
                                        className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                        style={{ backgroundColor: p.color }}
                                      >
                                        {p.name.slice(0, 1).toUpperCase()}
                                      </span>
                                      <span className="min-w-0 flex-1 truncate font-medium">
                                        {p.name}
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </PopoverContent>
                        </Popover>
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
                        (!chatPartnerReady && !editing) ||
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
                  </>
                  )}
                </div>
              </>
            )}

            {sideTab === "files" && (
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {attachments.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {t("tasks.form.filesEmpty")}
                  </p>
                ) : (
                  attachments.map((a) => {
                    const { Icon, className: iconCls } = attachmentIcon(a);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setViewerFile(a)}
                        className="flex w-full items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-left text-sm transition hover:border-[#0b5fff]/40 hover:bg-[#0b5fff]/5"
                      >
                        {isImageAtt(a) ? (
                          <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                            <img
                              src={a.url}
                              alt={a.name}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg",
                              iconCls,
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{a.name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatSize(a.size) || a.mimeType || "Ko‘rish"}
                          </span>
                        </span>
                      </button>
                    );
                  })
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

          {mobilePanel !== "side" ? (
            <div className="shrink-0 border-t border-slate-200/80 bg-white/95 px-3 py-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 xl:hidden">
              <div className="flex flex-col gap-2 sm:flex-row">
                {isWork ? (
                  <>
                    {needsWorkAccept && (
                      <Button
                        type="button"
                        className="flex-1 gap-1.5 rounded-xl bg-[#0b5fff]"
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
                          className="flex-1 gap-1.5 rounded-xl bg-[#0b5fff]"
                          disabled={workBusy || saving}
                          onClick={() => void submitWorkComplete()}
                        >
                          <Send className="h-4 w-4" />
                          {t("tasks.markDone")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl"
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
                      className="flex-1 rounded-xl"
                      onClick={() => onOpenChange(false)}
                    >
                      {t("ui.cancel")}
                    </Button>
                    <Button
                      type="button"
                      className="flex-1 gap-1.5 rounded-xl bg-[#0b5fff]"
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
          ) : null}

          {viewerFile ? (
            <TaskAttachmentViewer
              file={viewerFile}
              className="absolute inset-0 z-[80] rounded-none sm:rounded-2xl"
              onClose={() => {
                setViewerFile(null);
                setSideTab("chat");
              }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
