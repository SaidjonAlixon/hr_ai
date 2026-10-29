import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  tasksTable,
  usersTable,
  employeesTable,
  type TaskAttachment,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { notifyUser } from "../lib/notify";
import { syncBranchNeedFromTask } from "../lib/sync-branch-need";
import { cancelAllOpenPipelineTasks } from "../lib/pipeline-tasks";
import {
  advanceDueAt,
  normalizeRecurrence,
} from "../lib/task-schedule";

const router: IRouter = Router();

import { isDirectorRole, hasFullPlatformAccess, canSetPrivateTaskVisibility } from "../lib/roles";
import { sendReviewReminder, sendTaskDigest } from "../lib/task-digest";

/** Admin: vazifalar eslatmasini hozir yuborish (kind: digest | review) */
router.post("/tasks/digest/send", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!hasFullPlatformAccess(req.userRole)) {
    res.status(403).json({ error: "Faqat admin uchun" });
    return;
  }
  try {
    const result = req.body?.kind === "review" ? await sendReviewReminder() : await sendTaskDigest();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : "Yuborilmadi" });
  }
});

let pipelineTasksCleaned = false;

async function ensurePipelineTasksHidden() {
  if (pipelineTasksCleaned) return;
  pipelineTasksCleaned = true;
  try {
    await cancelAllOpenPipelineTasks();
  } catch {
    pipelineTasksCleaned = false;
  }
}

function isPipelineRecruitmentTask(row: {
  candidateId?: number | null;
  pipelineStage?: string | null;
}): boolean {
  return row.candidateId != null || Boolean(row.pipelineStage);
}

/** Apteka smena — vazifa qo‘yolmaydi; ofis/rahbar hammasi qo‘ya oladi */
const TASK_ASSIGN_BLOCKED = new Set(["farmasevt", "stajyor"]);

/** «Barcha topshiriqlar» to‘liq kuzatuv — faqat sof admin */
function isStrictAdminRole(role?: string | null) {
  return (role ?? "").trim().toLowerCase() === "admin";
}

function canAssignTasks(role?: string): boolean {
  if (!role) return false;
  return !TASK_ASSIGN_BLOCKED.has(role);
}

function parseId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
}

function isAssignee(row: typeof tasksTable.$inferSelect, userId?: number) {
  return (
    !!userId && row.assigneeKind === "user" && row.assigneeId === userId
  );
}

function isCreator(row: typeof tasksTable.$inferSelect, userId?: number) {
  return !!userId && row.createdById === userId;
}

function isAdminRole(role?: string | null) {
  return hasFullPlatformAccess(role);
}

/** Nazoratchi belgilash — faqat asoschi va korxona direktori */
function canAssignTaskSupervisor(role?: string | null) {
  return isDirectorRole(role);
}

function supervisorUserIdOf(row: typeof tasksTable.$inferSelect): number | null {
  const meta = taskMeta(row);
  const id = Number(meta.supervisorUserId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return Math.floor(id);
}

function isSupervisor(row: typeof tasksTable.$inferSelect, userId?: number) {
  const sid = supervisorUserIdOf(row);
  return !!userId && sid != null && sid === userId;
}

/** Beruvchi yoki belgilangan nazoratchi */
function isCreatorOrSupervisor(row: typeof tasksTable.$inferSelect, userId?: number) {
  return isCreator(row, userId) || isSupervisor(row, userId);
}

/** To‘liq tahrirlash: admin/direktor — hammasi; beruvchi/nazoratchi — o‘z vazifasi */
function canManageTask(
  row: typeof tasksTable.$inferSelect,
  userId?: number,
  role?: string,
) {
  if (isAdminRole(role) || isDirectorRole(role)) return true;
  return isCreatorOrSupervisor(row, userId);
}

/** Tasdiqlash / muddat: beruvchi, nazoratchi, admin yoki direktor */
function canApproveTask(row: typeof tasksTable.$inferSelect, userId?: number, role?: string) {
  return (
    isCreatorOrSupervisor(row, userId) || isAdminRole(role) || isDirectorRole(role)
  );
}

/** To‘liq boshqaruv (o‘chirish va h.k.) — admin, asoschi va korxona direktori */
function canAdminTaskOps(role?: string | null) {
  return hasFullPlatformAccess(role);
}

const ACCEPT_DEADLINE_MS: Record<string, number> = {
  low: 24 * 60 * 60 * 1000,
  normal: 16 * 60 * 60 * 1000,
  high: 8 * 60 * 60 * 1000,
  urgent: 4 * 60 * 60 * 1000,
};

function acceptDeadlineMs(priority?: string | null) {
  return ACCEPT_DEADLINE_MS[priority || "normal"] ?? ACCEPT_DEADLINE_MS.normal;
}

function taskMeta(row: typeof tasksTable.$inferSelect): Record<string, unknown> {
  return row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
    ? (row.meta as Record<string, unknown>)
    : {};
}

/** meta.acceptWindowEnabled === false → qabul muddati o‘chirilgan */
function isAcceptWindowEnabled(row: typeof tasksTable.$inferSelect) {
  return taskMeta(row).acceptWindowEnabled !== false;
}

function acceptWindowStart(row: typeof tasksTable.$inferSelect): Date {
  const base = taskMeta(row).acceptDeadlineBase;
  if (typeof base === "string" && base) {
    const d = new Date(base);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(row.createdAt);
}

function isAcceptOverdue(row: typeof tasksTable.$inferSelect, now = new Date()) {
  if (!isAcceptWindowEnabled(row)) return false;
  if (
    row.status === "verified" ||
    row.status === "cancelled" ||
    row.status === "done" ||
    row.status === "in_progress"
  ) {
    return false;
  }
  if (row.acceptedAt) return false;
  if (row.status !== "todo") return false;
  const deadline = acceptWindowStart(row).getTime() + acceptDeadlineMs(row.priority);
  return now.getTime() > deadline;
}

function isDueDateOverdue(row: typeof tasksTable.$inferSelect, now = new Date()) {
  if (
    row.status === "verified" ||
    row.status === "cancelled" ||
    row.status === "done"
  ) {
    return false;
  }
  const raw = row.dueAt || row.createdAt;
  if (!raw) return false;
  const due = new Date(raw);
  if (Number.isNaN(due.getTime())) return false;
  return now.getTime() > due.getTime();
}

/**
 * Kechikkan: qabul muddati (muhimlik) yoki bajarish muddati o‘tgan.
 * Ijrochi hech narsani o‘zgartira olmaydi — faqat beruvchi ochishi mumkin.
 */
function isTaskOverdue(row: typeof tasksTable.$inferSelect, now = new Date()) {
  return isAcceptOverdue(row, now) || isDueDateOverdue(row, now);
}

function denyIfAssigneeOverdue(
  row: typeof tasksTable.$inferSelect,
  userId?: number,
  role?: string,
): { ok: true } | { ok: false; error: string; code: string } {
  if (
    isAdminRole(role) ||
    isDirectorRole(role) ||
    isCreatorOrSupervisor(row, userId)
  ) {
    return { ok: true };
  }
  if (isAssignee(row, userId) && isAcceptOverdue(row)) {
    return {
      ok: false,
      code: "accept_overdue_locked",
      error: "Qabul qilish muddati o‘tgan — vazifa kechikkan. Faqat ko‘rish mumkin.",
    };
  }
  if (isAssignee(row, userId) && isTaskOverdue(row)) {
    return {
      ok: false,
      code: "overdue_locked",
      error: "Vaqt tugagan — faqat beruvchi muddatni uzaytirishi mumkin.",
    };
  }
  return { ok: true };
}

/**
 * Ko‘rinish:
 * - sof admin / asoschi / direktor: Maxfiy + oddiy — hammasi (to‘liq kuzatuv va boshqaruv)
 * - HR direktor va HR auditor: oddiy (Maxfiy emas) barcha topshiriqlar — faqat ko‘rish
 * - beruvchi / oluvchi: o‘z vazifasi
 * - boshqalar: faqat o‘ziga tegishli
 */
function isPrivateTask(row: typeof tasksTable.$inferSelect): boolean {
  const meta =
    row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
      ? (row.meta as Record<string, unknown>)
      : {};
  return meta.visibility === "private";
}

function isTaskBrowseRole(role?: string | null) {
  const r = (role ?? "").trim().toLowerCase();
  return r === "hr_auditor" || r === "hr_direktor";
}

function isTaskAuditorRole(role?: string | null) {
  return (role ?? "").trim().toLowerCase() === "hr_auditor";
}

function canViewTask(row: typeof tasksTable.$inferSelect, userId?: number, role?: string) {
  if (isStrictAdminRole(role) || isDirectorRole(role)) return true;
  if (isCreator(row, userId) || isAssignee(row, userId) || isSupervisor(row, userId)) {
    return true;
  }
  // Asosiy topshiriq oluvchisi — shu asosida yaratilgan davomini ham ko‘radi
  if (userId) {
    const srcUid = Number(taskMeta(row).basedOnSourceAssigneeUserId);
    if (Number.isFinite(srcUid) && srcUid > 0 && srcUid === userId) return true;
  }
  // Auditor: Maxfiydan tashqari barcha topshiriqlarni ko‘radi (tahrirlash yo‘q)
  if (isTaskBrowseRole(role) && !isPrivateTask(row)) return true;
  return false;
}

function isAllowedAttachmentUrl(url: string) {
  if (!url) return false;
  if (url.startsWith("https://") || url.startsWith("http://")) return true;
  if (url.startsWith("/api/uploads/")) return true;
  // Eski vazifalar (data URL) — o‘qish uchun qoldiriladi
  if (url.startsWith("data:")) return true;
  return false;
}

function sanitizeMeta(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (Array.isArray(src.checklist)) {
    out.checklist = src.checklist.slice(0, 40).map((item: any, i: number) => ({
      id: String(item?.id || `c-${i}`).slice(0, 64),
      text: String(item?.text || "").slice(0, 300),
      done: !!item?.done,
    })).filter((x: { text: string }) => x.text.trim());
  }
  if (Array.isArray(src.tags)) {
    out.tags = src.tags
      .map((t) => String(t || "").trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 20);
  }
  if (src.taskType != null) out.taskType = String(src.taskType).slice(0, 80);
  if (src.branchOrDept != null) out.branchOrDept = String(src.branchOrDept).slice(0, 120);
  if (src.reminderEnabled != null) out.reminderEnabled = !!src.reminderEnabled;
  if (src.reminderOffset != null) out.reminderOffset = String(src.reminderOffset).slice(0, 40);
  if (src.recurrence != null) out.recurrence = String(src.recurrence).slice(0, 40);
  if (src.lastDueReminderAt != null) {
    out.lastDueReminderAt = String(src.lastDueReminderAt).slice(0, 40);
  }
  if (src.recurrenceParentId != null) {
    const pid = Number(src.recurrenceParentId);
    if (Number.isFinite(pid) && pid > 0) out.recurrenceParentId = Math.floor(pid);
  }
  if (src.recurrenceSeriesId != null) {
    const sid = Number(src.recurrenceSeriesId);
    if (Number.isFinite(sid) && sid > 0) out.recurrenceSeriesId = Math.floor(sid);
  }
  if (src.visibility === "all" || src.visibility === "private") {
    out.visibility = src.visibility;
  }
  if (src.notes != null) out.notes = String(src.notes).slice(0, 500);
  if (src.formStatus != null) out.formStatus = String(src.formStatus).slice(0, 40);
  if (src.verifiedAt != null) out.verifiedAt = String(src.verifiedAt).slice(0, 40);
  if (src.acceptDeadlineBase != null) {
    out.acceptDeadlineBase = String(src.acceptDeadlineBase).slice(0, 40);
  }
  if (src.acceptWindowEnabled != null) {
    out.acceptWindowEnabled = !!src.acceptWindowEnabled;
  }
  if (src.lastReworkNote != null) out.lastReworkNote = String(src.lastReworkNote).slice(0, 500);
  if (src.lastReworkAt != null) out.lastReworkAt = String(src.lastReworkAt).slice(0, 40);
  if (src.lastReworkByName != null) {
    out.lastReworkByName = String(src.lastReworkByName).slice(0, 120);
  }
  if (src.reworkCount != null) {
    const n = Number(src.reworkCount);
    if (Number.isFinite(n) && n >= 0) out.reworkCount = Math.min(Math.floor(n), 999);
  }
  if (Array.isArray(src.lastReturnAttachments)) {
    out.lastReturnAttachments = sanitizeAttachments(src.lastReturnAttachments, 8);
  }
  if (Array.isArray(src.submissionHistory)) {
    out.submissionHistory = src.submissionHistory.slice(0, 30).map((s: any, i: number) => ({
      id: String(s?.id || `sub-${i}`).slice(0, 64),
      note: s?.note != null ? String(s.note).slice(0, 2000) : null,
      attachments: sanitizeAttachments(s?.attachments, 8),
      completedAt: s?.completedAt ? String(s.completedAt).slice(0, 40) : null,
      returnedAt: s?.returnedAt ? String(s.returnedAt).slice(0, 40) : null,
      returnNote: s?.returnNote != null ? String(s.returnNote).slice(0, 500) : null,
      returnAttachments: sanitizeAttachments(s?.returnAttachments, 8),
      returnedByName: s?.returnedByName != null ? String(s.returnedByName).slice(0, 120) : null,
      dueAtBefore: s?.dueAtBefore ? String(s.dueAtBefore).slice(0, 40) : null,
      dueAtAfter: s?.dueAtAfter ? String(s.dueAtAfter).slice(0, 40) : null,
      keepDue: s?.keepDue !== false,
    }));
  }
  if (Array.isArray(src.messages)) {
    out.messages = src.messages.slice(0, 200).map((m: any, i: number) => ({
      id: String(m?.id || `m-${i}`).slice(0, 64),
      text: String(m?.text || "").slice(0, 2000),
      authorName: String(m?.authorName || "").slice(0, 120),
      authorRole:
        m?.authorRole === "assignee" || m?.authorRole === "system" || m?.authorRole === "auditor"
          ? m.authorRole
          : "assigner",
      createdAt: String(m?.createdAt || new Date().toISOString()).slice(0, 40),
      attachment:
        m?.attachment && typeof m.attachment === "object" && m.attachment.url
          ? sanitizeAttachments([m.attachment], 1)[0] || null
          : null,
      mentions: Array.isArray(m?.mentions)
        ? m.mentions
            .map((n: unknown) => String(n || "").trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 20)
        : [],
      replyTo:
        m?.replyTo && typeof m.replyTo === "object"
          ? {
              id: String((m.replyTo as any).id || "").slice(0, 64),
              authorName: String((m.replyTo as any).authorName || "").slice(0, 120),
              text: String((m.replyTo as any).text || "").slice(0, 240),
            }
          : null,
    }));
  }
  if (Array.isArray(src.history)) {
    out.history = src.history.slice(0, 100).map((h: any, i: number) => ({
      id: String(h?.id || `h-${i}`).slice(0, 64),
      text: String(h?.text || "").slice(0, 300),
      createdAt: String(h?.createdAt || new Date().toISOString()).slice(0, 40),
    }));
  }
  if (Array.isArray(src.assigneeHistory)) {
    out.assigneeHistory = src.assigneeHistory.slice(0, 40).map((h: any, i: number) => ({
      id: String(h?.id || `ah-${i}`).slice(0, 64),
      assigneeKind: h?.assigneeKind === "employee" ? "employee" : "user",
      assigneeId: Number(h?.assigneeId) || 0,
      name: String(h?.name || "").slice(0, 120),
      statusAtTransfer: h?.statusAtTransfer
        ? String(h.statusAtTransfer).slice(0, 40)
        : null,
      transferredAt: String(h?.transferredAt || new Date().toISOString()).slice(0, 40),
      byUserId: h?.byUserId != null ? Number(h.byUserId) : null,
      byName: h?.byName != null ? String(h.byName).slice(0, 120) : null,
    })).filter((x: { assigneeId: number; name: string }) => x.assigneeId > 0 || x.name);
  }
  if (src.batchId != null) {
    const bid = String(src.batchId).trim().slice(0, 80);
    if (bid) out.batchId = bid;
  }
  if (src.batchSize != null) {
    const n = Number(src.batchSize);
    if (Number.isFinite(n) && n >= 1) out.batchSize = Math.min(Math.floor(n), 50);
  }
  // Asosiy topshiriq bog‘lanishi (yuborilgan / mavjud vazifadan yaratish)
  if (src.basedOnTaskId != null) {
    const bid = Number(src.basedOnTaskId);
    if (Number.isFinite(bid) && bid > 0) {
      out.basedOnTaskId = Math.floor(bid);
      if (src.basedOnTitle != null) {
        out.basedOnTitle = String(src.basedOnTitle).trim().slice(0, 200) || null;
      }
      if (src.basedOnAssigneeName != null) {
        out.basedOnAssigneeName = String(src.basedOnAssigneeName).trim().slice(0, 120) || null;
      }
      if (src.basedOnStatus != null) {
        out.basedOnStatus = String(src.basedOnStatus).trim().slice(0, 40) || null;
      }
      if (src.basedOnCompletedAt != null) {
        out.basedOnCompletedAt = String(src.basedOnCompletedAt).slice(0, 40);
      }
      if (src.basedOnResultNote != null) {
        out.basedOnResultNote = String(src.basedOnResultNote).trim().slice(0, 400) || null;
      }
      if (src.basedOnSourceAssigneeUserId != null) {
        const suid = Number(src.basedOnSourceAssigneeUserId);
        if (Number.isFinite(suid) && suid > 0) {
          out.basedOnSourceAssigneeUserId = Math.floor(suid);
        }
      }
    }
  }
  // Nazoratchi: null/0 → olib tashlash; musbat id → belgilash
  if (Object.prototype.hasOwnProperty.call(src, "supervisorUserId")) {
    if (
      src.supervisorUserId === null ||
      src.supervisorUserId === "" ||
      src.supervisorUserId === 0 ||
      src.supervisorUserId === "0"
    ) {
      out.supervisorUserId = null;
      out.supervisorName = null;
    } else {
      const sid = Number(src.supervisorUserId);
      if (Number.isFinite(sid) && sid > 0) {
        out.supervisorUserId = Math.floor(sid);
        if (src.supervisorName != null) {
          out.supervisorName = String(src.supervisorName).trim().slice(0, 120) || null;
        }
      }
    }
  }

  return out;
}

/**
 * Nazoratchini faqat asoschi/direktor o‘zgartira oladi.
 * Boshqalar meta yuborsa — avvalgi qiymat saqlanadi.
 */
function applySupervisorAssignPolicy(
  meta: Record<string, unknown>,
  prevMeta: Record<string, unknown>,
  role?: string | null,
): Record<string, unknown> {
  if (canAssignTaskSupervisor(role)) {
    if (meta.supervisorUserId === null) {
      const { supervisorUserId: _a, supervisorName: _b, ...rest } = meta;
      return rest;
    }
    return meta;
  }
  const next = { ...meta };
  delete next.supervisorUserId;
  delete next.supervisorName;
  const prevId = Number(prevMeta.supervisorUserId);
  if (Number.isFinite(prevId) && prevId > 0) {
    next.supervisorUserId = Math.floor(prevId);
    if (prevMeta.supervisorName != null) {
      next.supervisorName = String(prevMeta.supervisorName).slice(0, 120);
    }
  }
  return next;
}

/** Maxfiy faqat admin / asoschi / direktor / direktor yordamchisi */
function applyTaskVisibilityPolicy(
  meta: Record<string, unknown>,
  role?: string | null,
): Record<string, unknown> {
  if (meta.visibility === "private" && !canSetPrivateTaskVisibility(role)) {
    return { ...meta, visibility: "all" };
  }
  return meta;
}

function sanitizeAttachments(raw: unknown, max = 10): TaskAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, max)
    .map((a: TaskAttachment, i: number) => {
      const url = String(a.url || "");
      if (!isAllowedAttachmentUrl(url)) return null;
      const maxUrl = url.startsWith("data:") ? 5_000_000 : 2_000;
      return {
        id: a.id || `att-${Date.now()}-${i}`,
        name: String(a.name || "fayl").slice(0, 200),
        mimeType: String(a.mimeType || "application/octet-stream"),
        kind: (a.kind === "image" ? "image" : "file") as "image" | "file",
        url: url.slice(0, maxUrl),
        size: typeof a.size === "number" ? a.size : undefined,
      };
    })
    .filter(Boolean) as TaskAttachment[];
}

async function resolveAssigneeName(
  kind: string,
  assigneeId: number,
): Promise<string | null> {
  if (kind === "employee") {
    const [row] = await db
      .select({ fullName: employeesTable.fullName })
      .from(employeesTable)
      .where(eq(employeesTable.id, assigneeId));
    return row?.fullName ?? null;
  }
  const [row] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, assigneeId));
  return row?.fullName ?? null;
}

/** Bildirishnoma uchun user id (employee → bog‘langan user) */
async function resolveNotifyUserId(
  kind: string,
  assigneeId: number,
): Promise<number | null> {
  if (kind === "user") return assigneeId;
  if (kind === "employee") {
    const [row] = await db
      .select({ userId: employeesTable.userId })
      .from(employeesTable)
      .where(eq(employeesTable.id, assigneeId))
      .limit(1);
    return row?.userId ?? null;
  }
  return null;
}

async function notifyTaskAssignee(opts: {
  kind: string;
  assigneeId: number;
  actorUserId?: number;
  text: string;
  linkUrl?: string;
  type?: string;
  title?: string;
}) {
  const uid = await resolveNotifyUserId(opts.kind, opts.assigneeId);
  if (!uid || uid === opts.actorUserId) return;
  await notifyUser({
    userId: uid,
    text: opts.text,
    type: opts.type || "task_assigned",
    linkUrl: opts.linkUrl || "/vazifalar",
    title: opts.title || "Yangi vazifa",
    telegram: true,
  });
}

/**
 * Tasdiqlangandan keyin takrorlanuvchi vazifaning keyingi nusxasini yaratadi.
 */
async function spawnRecurringTask(
  existing: typeof tasksTable.$inferSelect,
  actorUserId?: number | null,
): Promise<typeof tasksTable.$inferSelect | null> {
  const prevMeta =
    existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
      ? (existing.meta as Record<string, unknown>)
      : {};
  const recurrence = normalizeRecurrence(prevMeta.recurrence);
  if (recurrence === "none") return null;

  const nextDue = advanceDueAt(existing.dueAt, recurrence);
  const seriesId =
    Number(prevMeta.recurrenceSeriesId) > 0
      ? Math.floor(Number(prevMeta.recurrenceSeriesId))
      : existing.id;

  const checklist = Array.isArray(prevMeta.checklist)
    ? (prevMeta.checklist as Array<{ id?: string; text?: string; done?: boolean }>).map(
        (c, i) => ({
          id: String(c?.id || `c-${i}`).slice(0, 64),
          text: String(c?.text || "").slice(0, 300),
          done: false,
        }),
      )
    : undefined;

  const nextMeta = sanitizeMeta({
    checklist,
    tags: prevMeta.tags,
    taskType: prevMeta.taskType,
    branchOrDept: prevMeta.branchOrDept,
    reminderEnabled: prevMeta.reminderEnabled !== false,
    reminderOffset: prevMeta.reminderOffset || "1d",
    recurrence,
    visibility: prevMeta.visibility === "private" ? "private" : "all",
    notes: prevMeta.notes,
    recurrenceParentId: existing.id,
    recurrenceSeriesId: seriesId,
    history: [
      {
        id: `h-recur-${Date.now()}`,
        text: `Takrorlanuvchi topshiriq (${recurrence}) — avvalgi #${existing.id}`,
        createdAt: new Date().toISOString(),
      },
    ],
    messages: [],
  });

  const [created] = await db
    .insert(tasksTable)
    .values({
      title: existing.title,
      description: existing.description,
      status: "todo",
      priority: existing.priority || "normal",
      dueAt: nextDue,
      assigneeKind: existing.assigneeKind,
      assigneeId: existing.assigneeId,
      createdById: existing.createdById,
      attachments: Array.isArray(existing.attachments) ? existing.attachments : [],
      meta: nextMeta,
      acceptedAt: null,
      completedAt: null,
      completionNote: null,
      completionAttachments: [],
    })
    .returning();

  if (created?.assigneeId) {
    const creatorName = await resolveUserDisplayName(existing.createdById);
    await notifyTaskAssignee({
      kind: created.assigneeKind || "user",
      assigneeId: created.assigneeId,
      actorUserId: actorUserId ?? undefined,
      text: buildTaskAssignedText({
        title: created.title,
        fromName: creatorName,
        dueAt: created.dueAt,
        description: created.description,
        extraLine: `🔁 Takrorlanuvchi: ${recurrence}`,
      }),
      linkUrl: `/vazifalar?task=${created.id}`,
      type: "task_assigned",
      title: "Takrorlanuvchi vazifa",
    });
  }

  return created ?? null;
}

function formatTaskDueUz(due: Date | null | undefined): string {
  if (!due || Number.isNaN(due.getTime())) return "belgilanmagan";
  return due.toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function resolveUserDisplayName(userId: number | null | undefined): Promise<string> {
  if (!userId) return "Rahbar";
  const [row] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return (row?.fullName || "").trim() || "Rahbar";
}

function buildTaskAssignedText(opts: {
  title: string;
  fromName: string;
  dueAt?: Date | null;
  description?: string | null;
  extraLine?: string | null;
}): string {
  const lines = [
    `📋 Yangi vazifa: «${opts.title}»`,
    `👤 Kimdan: ${opts.fromName}`,
    `⏰ Muddat: ${formatTaskDueUz(opts.dueAt ?? null)}`,
  ];
  const desc = String(opts.description || "").trim();
  if (desc) lines.push(`📝 ${desc.slice(0, 160)}${desc.length > 160 ? "…" : ""}`);
  if (opts.extraLine) lines.push(opts.extraLine);
  lines.push("👉 Avval qabul qiling — Vazifalar");
  return lines.join("\n");
}

async function assigneeIsOfisStaff(
  kind: string,
  assigneeId: number,
): Promise<boolean> {
  const { isOfisStaffEmp } = await import("../lib/ofis-weekend");
  if (kind === "employee") {
    const [row] = await db
      .select({
        fullName: employeesTable.fullName,
        orgRole: employeesTable.orgRole,
        position: employeesTable.position,
        userId: employeesTable.userId,
      })
      .from(employeesTable)
      .where(eq(employeesTable.id, assigneeId))
      .limit(1);
    if (!row) return false;
    let userRole: string | null = null;
    if (row.userId) {
      const [u] = await db
        .select({ role: usersTable.role })
        .from(usersTable)
        .where(eq(usersTable.id, row.userId))
        .limit(1);
      userRole = u?.role ?? null;
    }
    return isOfisStaffEmp({
      userRole,
      orgRole: row.orgRole,
      position: row.position,
    });
  }
  const [row] = await db
    .select({
      role: usersTable.role,
    })
    .from(usersTable)
    .where(eq(usersTable.id, assigneeId))
    .limit(1);
  if (!row) return false;
  return isOfisStaffEmp({
    userRole: row.role,
    orgRole: null,
    position: null,
  });
}

function dueAtYmdTashkent(dueAt: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dueAt);
}

async function assertOfisWeekendDueOk(
  dueAt: Date | null | undefined,
  assignees: Array<{ kind: "user" | "employee"; id: number }>,
): Promise<string | null> {
  if (!dueAt) return null;
  const { isWeekendYmd } = await import("../lib/ofis-weekend");
  const ymd = dueAtYmdTashkent(dueAt);
  if (!isWeekendYmd(ymd)) return null;
  for (const a of assignees) {
    if (await assigneeIsOfisStaff(a.kind, a.id)) {
      return "Ofis xodimiga shanba/yakshanba (dam kuni)ga vazifa qo‘yib bo‘lmaydi";
    }
  }
  return null;
}

async function enrichTask(row: typeof tasksTable.$inferSelect) {
  const [creator] = await db
    .select({ fullName: usersTable.fullName })
    .from(usersTable)
    .where(eq(usersTable.id, row.createdById));

  const assigneeName = await resolveAssigneeName(row.assigneeKind, row.assigneeId);

  return {
    ...row,
    attachments: (row.attachments ?? []) as TaskAttachment[],
    completionAttachments: (row.completionAttachments ?? []) as TaskAttachment[],
    meta: (row.meta && typeof row.meta === "object" ? row.meta : {}) as Record<
      string,
      unknown
    >,
    assigneeName,
    createdByName: creator?.fullName ?? null,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    extensionRequestedDueAt: row.extensionRequestedDueAt
      ? row.extensionRequestedDueAt.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/tasks", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { status, board } = req.query as Record<string, string>;

  await ensurePipelineTasksHidden();

  let rows = await db.select().from(tasksTable).orderBy(desc(tasksTable.dueAt));

  // Nomzod pipeline qadamlari Topshiriqlar doskasida ko‘rinmasin
  rows = rows.filter((r) => !isPipelineRecruitmentTask(r));

  // Faqat o'zi belgilagan yoki o'ziga biriktirilgan (admin — hammasi)
  rows = rows.filter((r) => canViewTask(r, req.userId, req.userRole));

  if (status) rows = rows.filter((r) => r.status === status);
  if (board === "active") {
    rows = rows.filter((r) => r.status !== "cancelled");
  }

  res.json(await Promise.all(rows.map(enrichTask)));
});

router.post("/tasks", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (!canAssignTasks(req.userRole)) {
    res.status(403).json({ error: "Vazifa belgilash uchun ruxsat yo'q" });
    return;
  }

  const {
    title,
    description,
    status,
    priority,
    dueAt,
    assigneeKind,
    assigneeId,
    assignees,
    attachments,
    meta,
  } = req.body ?? {};

  if (!title || typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "Sarlavha majburiy" });
    return;
  }

  type AssigneeSpec = { kind: "user" | "employee"; id: number };
  const list: AssigneeSpec[] = [];
  const seen = new Set<string>();

  const pushAssignee = (kindRaw: unknown, idRaw: unknown) => {
    const kind = kindRaw === "employee" ? "employee" : "user";
    const id = parseInt(String(idRaw), 10);
    if (!Number.isFinite(id) || id <= 0) return;
    const key = `${kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ kind, id });
  };

  if (Array.isArray(assignees) && assignees.length > 0) {
    for (const a of assignees) {
      if (!a || typeof a !== "object") continue;
      pushAssignee(
        (a as any).assigneeKind ?? (a as any).kind,
        (a as any).assigneeId ?? (a as any).id,
      );
    }
  } else if (assigneeId) {
    pushAssignee(assigneeKind, assigneeId);
  }

  if (list.length === 0) {
    res.status(400).json({ error: "Ijrochi tanlanishi shart" });
    return;
  }
  for (const a of list) {
    const uid = await resolveNotifyUserId(a.kind, a.id);
    if (uid != null && uid === req.userId) {
      res.status(400).json({ error: "O‘zingizga vazifa qo‘yib bo‘lmaydi" });
      return;
    }
  }
  if (list.length > 40) {
    res.status(400).json({ error: "Bir vaqtda 40 tadan ortiq xodimga berib bo‘lmaydi" });
    return;
  }

  for (const a of list) {
    const name = await resolveAssigneeName(a.kind, a.id);
    if (!name) {
      res.status(400).json({
        error: `Ijrochi topilmadi (${a.kind} #${a.id})`,
      });
      return;
    }
  }

  const dueDate = dueAt ? new Date(dueAt) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) {
    res.status(400).json({ error: "Muddat noto‘g‘ri" });
    return;
  }
  const weekendErr = await assertOfisWeekendDueOk(dueDate, list);
  if (weekendErr) {
    res.status(400).json({ error: weekendErr });
    return;
  }

  const statusVal = status || "todo";
  const batchId =
    list.length > 1 ? `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : null;
  const baseMeta = applySupervisorAssignPolicy(
    applyTaskVisibilityPolicy(sanitizeMeta(meta), req.userRole),
    {},
    req.userRole,
  );
  // Asosiy topshiriq — ko‘rish huquqi + snapshot
  {
    const basedId = Number(baseMeta.basedOnTaskId);
    if (Number.isFinite(basedId) && basedId > 0) {
      const [source] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, basedId))
        .limit(1);
      if (!source || isPipelineRecruitmentTask(source)) {
        res.status(400).json({ error: "Asosiy topshiriq topilmadi" });
        return;
      }
      if (!canViewTask(source, req.userId, req.userRole)) {
        res.status(403).json({ error: "Asosiy topshiriqni ko‘rishga ruxsat yo‘q" });
        return;
      }
      baseMeta.basedOnTaskId = source.id;
      baseMeta.basedOnTitle =
        String(baseMeta.basedOnTitle || source.title || "").trim().slice(0, 200) ||
        source.title;
      baseMeta.basedOnStatus = source.status;
      baseMeta.basedOnAssigneeName =
        (await resolveAssigneeName(source.assigneeKind, source.assigneeId)) || null;
      const sourceAssigneeUid = await resolveNotifyUserId(
        source.assigneeKind,
        source.assigneeId,
      );
      if (sourceAssigneeUid) {
        baseMeta.basedOnSourceAssigneeUserId = sourceAssigneeUid;
      }
      if (source.completedAt) {
        baseMeta.basedOnCompletedAt = new Date(source.completedAt).toISOString();
      }
      if (source.completionNote && !baseMeta.basedOnResultNote) {
        baseMeta.basedOnResultNote = String(source.completionNote).trim().slice(0, 400);
      }
      const hist = Array.isArray(baseMeta.history) ? baseMeta.history : [];
      baseMeta.history = [
        ...hist,
        {
          id: `h-based-${Date.now()}`,
          text: `Asos: TK-${source.id} — «${source.title}»`,
          createdAt: new Date().toISOString(),
        },
      ].slice(-100);
    }
  }
  // Nazoratchi ijrochi bo‘lmasin
  {
    const sid = Number(baseMeta.supervisorUserId);
    if (Number.isFinite(sid) && sid > 0) {
      for (const a of list) {
        const uid = await resolveNotifyUserId(a.kind, a.id);
        if (uid === sid) {
          res.status(400).json({
            error: "Nazoratchi va topshiriq oluvchi bir xil bo‘lmasligi kerak",
          });
          return;
        }
      }
      if (!baseMeta.supervisorName) {
        baseMeta.supervisorName = await resolveUserDisplayName(sid);
      }
    }
  }
  const fileAtt = sanitizeAttachments(attachments);
  const creatorName = await resolveUserDisplayName(req.userId);
  const createdRows = [];
  const supervisorId = Number(baseMeta.supervisorUserId);
  const hasSupervisor = Number.isFinite(supervisorId) && supervisorId > 0;

  for (const a of list) {
    const rowMeta = applyTaskVisibilityPolicy(
      sanitizeMeta({
        ...baseMeta,
        ...(batchId
          ? {
              batchId,
              batchSize: list.length,
            }
          : {}),
      }),
      req.userRole,
    );
    const [created] = await db
      .insert(tasksTable)
      .values({
        title: title.trim(),
        description: description ? String(description) : null,
        status: statusVal,
        priority: priority || "normal",
        dueAt: dueAt ? new Date(dueAt) : null,
        assigneeKind: a.kind,
        assigneeId: a.id,
        createdById: req.userId!,
        attachments: fileAtt,
        meta: rowMeta,
        acceptedAt:
          statusVal === "in_progress" || statusVal === "done" || statusVal === "verified"
            ? new Date()
            : null,
      })
      .returning();

    if (a.id) {
      const basedTitle =
        typeof baseMeta.basedOnTitle === "string" ? baseMeta.basedOnTitle : "";
      const basedId = Number(baseMeta.basedOnTaskId);
      await notifyTaskAssignee({
        kind: a.kind,
        assigneeId: a.id,
        actorUserId: req.userId,
        text: buildTaskAssignedText({
          title: created.title,
          fromName: creatorName,
          dueAt: created.dueAt,
          description: created.description,
          extraLine:
            Number.isFinite(basedId) && basedId > 0
              ? `🔗 Asos: TK-${basedId}${basedTitle ? ` — «${basedTitle}»` : ""}`
              : null,
        }),
        linkUrl: `/vazifalar?task=${created.id}`,
        type: "task_assigned",
        title: "Yangi vazifa",
      });
    }
    if (hasSupervisor && supervisorId !== req.userId) {
      await notifyUser({
        userId: supervisorId,
        text: [
          `👁 Nazorat: «${created.title}»`,
          `👤 Belgilagan: ${creatorName}`,
          `⏰ Muddat: ${formatTaskDueUz(created.dueAt)}`,
          "👉 Tasdiqlash va muddat — sizda ham bor (o‘chirishdan tashqari)",
        ].join("\n"),
        type: "task_assigned",
        linkUrl: `/vazifalar?task=${created.id}`,
        title: "Nazoratchi etib belgilandingiz",
        telegram: true,
      });
    }
    createdRows.push(created);
  }

  // Asosiy topshiriq oluvchisiga — davomi yaratilgani haqida
  {
    const srcUid = Number(baseMeta.basedOnSourceAssigneeUserId);
    const basedId = Number(baseMeta.basedOnTaskId);
    const first = createdRows[0];
    if (
      first &&
      Number.isFinite(srcUid) &&
      srcUid > 0 &&
      srcUid !== req.userId &&
      Number.isFinite(basedId) &&
      basedId > 0
    ) {
      const alreadyAssignee = createdRows.some(
        (r) => r.assigneeKind === "user" && r.assigneeId === srcUid,
      );
      if (!alreadyAssignee) {
        await notifyUser({
          userId: srcUid,
          text: [
            `🔗 Sizning TK-${basedId} asosida yangi topshiriq`,
            `📋 «${first.title}»`,
            `👤 Belgilagan: ${creatorName}`,
            "👉 Vazifalar — asosiy va davomini ko‘ring",
          ].join("\n"),
          type: "task_assigned",
          linkUrl: `/vazifalar?task=${first.id}`,
          title: "Asosingizdan yangi topshiriq",
          telegram: true,
        });
      }
    }
  }

  const enriched = await Promise.all(createdRows.map(enrichTask));
  if (enriched.length === 1) {
    res.status(201).json(enriched[0]);
    return;
  }
  res.status(201).json({
    created: enriched.length,
    batchId,
    items: enriched,
    ...enriched[0],
  });
});

router.get("/tasks/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [row] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!row || isPipelineRecruitmentTask(row)) {
    res.status(404).json({ error: "Vazifa topilmadi" });
    return;
  }
  if (!canViewTask(row, req.userId, req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }
  res.json(await enrichTask(row));
});

type TaskRow = typeof tasksTable.$inferSelect;
type TaskChatMsg = { id: string; text: string; authorName: string; createdAt: string; attachment: TaskAttachment | null };
type TaskHistEvent = { id: string; text: string; createdAt: string };

/** Auditor xabari: bir nechta ijrochiga berilgan (batch) topshiriqda hamma ijrochining chatiga yoziladi */
async function postAuditorMessage(
  existing: TaskRow,
  msg: TaskChatMsg & Record<string, unknown>,
  hist: TaskHistEvent,
  attachment: TaskAttachment | null,
): Promise<{ self: TaskRow; rows: TaskRow[] }> {
  const meta0 = metaRecord(existing);
  const batchId = typeof meta0.batchId === "string" && meta0.batchId ? meta0.batchId : null;
  const siblings = batchId
    ? await db.select().from(tasksTable).where(sql`${tasksTable.meta}->>'batchId' = ${batchId}`)
    : [];
  const rows = [existing, ...siblings.filter((r) => r.id !== existing.id && !isPrivateTask(r))];

  const out: TaskRow[] = [];
  for (const row of rows) {
    const meta = metaRecord(row);
    const messages = Array.isArray(meta.messages) ? meta.messages : [];
    const history = Array.isArray(meta.history) ? meta.history : [];
    const nextMeta = sanitizeMeta({
      ...meta,
      messages: [...messages, { ...msg, id: `${msg.id}-${row.id}` }].slice(-200),
      history: [...history, { ...hist, id: `${hist.id}-${row.id}` }].slice(-80),
    });
    const prevAtt = (row.attachments as TaskAttachment[]) || [];
    const [saved] = await db
      .update(tasksTable)
      .set({
        meta: nextMeta,
        attachments: attachment ? sanitizeAttachments([...prevAtt, attachment], 12) : prevAtt,
      })
      .where(eq(tasksTable.id, row.id))
      .returning();
    if (saved) out.push(saved);
  }
  return { self: out.find((r) => r.id === existing.id) ?? existing, rows: out };
}

function metaRecord(row: TaskRow): Record<string, unknown> {
  return row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
    ? (row.meta as Record<string, unknown>)
    : {};
}

async function assigneeUserId(row: TaskRow): Promise<number | null> {
  if (!row.assigneeId) return null;
  if (row.assigneeKind === "user") return row.assigneeId;
  if (row.assigneeKind === "employee") {
    const [emp] = await db
      .select({ userId: employeesTable.userId })
      .from(employeesTable)
      .where(eq(employeesTable.id, row.assigneeId));
    return emp?.userId ?? null;
  }
  return null;
}

/** Ijrochi(lar) va beruvchiga — tizim, Telegram bot va push orqali to‘liq matn bilan */
async function notifyAuditorMessage(rows: TaskRow[], existing: TaskRow, msg: TaskChatMsg, auditorId: number) {
  const body = [
    "⚠️ HR Auditordan xabar",
    `Topshiriq: «${existing.title}»`,
    "",
    msg.text || "",
    msg.attachment ? `📎 Fayl: ${msg.attachment.name}` : "",
    "",
    `— ${msg.authorName}, HR Auditor`,
  ]
    .filter((line, i, arr) => line || (arr[i - 1] ?? "") !== "")
    .join("\n")
    .trim()
    .slice(0, 3500);

  const recipients = new Map<number, number>();
  for (const row of rows) {
    const uid = await assigneeUserId(row);
    if (uid && !recipients.has(uid)) recipients.set(uid, row.id);
  }
  if (existing.createdById && !recipients.has(existing.createdById)) {
    recipients.set(existing.createdById, existing.id);
  }
  {
    const sid = supervisorUserIdOf(existing);
    if (sid && !recipients.has(sid)) recipients.set(sid, existing.id);
  }
  recipients.delete(auditorId);

  for (const [userId, taskId] of recipients) {
    try {
      await notifyUser({
        userId,
        text: body,
        title: "HR Auditordan xabar",
        type: "expired_task",
        linkUrl: `/vazifalar?task=${taskId}`,
      });
    } catch (err) {
      console.error("auditor notify user failed:", userId, err);
    }
  }
}

/** Beruvchi yoki ijrochi — chat xabar qo'shish (tez) */
router.post(
  "/tasks/:id/messages",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Vazifa topilmadi" });
      return;
    }
    if (!canViewTask(existing, req.userId, req.userRole)) {
      res.status(403).json({ error: "Ruxsat yo'q" });
      return;
    }
    const isParty =
      isCreator(existing, req.userId) ||
      isAssignee(existing, req.userId) ||
      isSupervisor(existing, req.userId);
    const asAuditor = !isParty && isTaskAuditorRole(req.userRole);
    if (!isParty && !asAuditor && !isAdminRole(req.userRole)) {
      res.status(403).json({ error: "Faqat beruvchi yoki ijrochi yozishi mumkin" });
      return;
    }

    const overdueGate = denyIfAssigneeOverdue(existing, req.userId, req.userRole);
    if (!overdueGate.ok) {
      res.status(403).json({ error: overdueGate.error, code: overdueGate.code });
      return;
    }

    const text = String(req.body?.text || "").trim().slice(0, 2000);
    const attachmentRaw = req.body?.attachment;
    const attachments = attachmentRaw
      ? sanitizeAttachments([attachmentRaw], 1)
      : [];
    const attachment = attachments[0] || null;
    if (!text && !attachment) {
      res.status(400).json({ error: "Xabar yoki fayl kerak" });
      return;
    }

    const mentions = Array.isArray(req.body?.mentions)
      ? req.body.mentions
          .map((n: unknown) => String(n || "").trim().slice(0, 120))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    const replyRaw = req.body?.replyTo;
    const replyTo =
      replyRaw && typeof replyRaw === "object"
        ? {
            id: String(replyRaw.id || "").slice(0, 64),
            authorName: String(replyRaw.authorName || "").slice(0, 120),
            text: String(replyRaw.text || "").slice(0, 240),
          }
        : null;

    const [me] = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!));

    const role: "assigner" | "assignee" | "auditor" = asAuditor
      ? "auditor"
      : isAssignee(existing, req.userId)
        ? "assignee"
        : "assigner";

    const prevMeta =
      existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
        ? (existing.meta as Record<string, unknown>)
        : {};
    const prevMessages = Array.isArray(prevMeta.messages) ? prevMeta.messages : [];
    const prevHistory = Array.isArray(prevMeta.history) ? prevMeta.history : [];
    const now = new Date().toISOString();
    const msg = {
      id: `m-${Date.now()}`,
      text,
      authorName: me?.fullName || "Foydalanuvchi",
      authorRole: role,
      createdAt: now,
      attachment,
      mentions,
      replyTo,
    };
    const hist = {
      id: `h-${Date.now()}`,
      text: asAuditor
        ? `HR Auditor ogohlantirdi: ${msg.authorName}`
        : attachment
          ? "Chatga fayl yuborildi"
          : "Chatga xabar yuborildi",
      createdAt: now,
    };

    const nextMeta = sanitizeMeta({
      ...prevMeta,
      messages: [...prevMessages, msg].slice(-200),
      history: [...prevHistory, hist].slice(-80),
    });

    if (asAuditor) {
      const updated = await postAuditorMessage(existing, msg, hist, attachment);
      res.json(await enrichTask(updated.self));
      void notifyAuditorMessage(updated.rows, existing, msg, req.userId!).catch((err) =>
        console.error("auditor notify failed:", err),
      );
      return;
    }

    let nextAttachments = (existing.attachments as TaskAttachment[]) || [];
    if (attachment) {
      nextAttachments = sanitizeAttachments([...nextAttachments, attachment], 12);
    }

    const [updated] = await db
      .update(tasksTable)
      .set({
        meta: nextMeta,
        attachments: nextAttachments,
      })
      .where(eq(tasksTable.id, id))
      .returning();

    const notifyId =
      role === "assigner"
        ? existing.assigneeKind === "user"
          ? existing.assigneeId
          : null
        : existing.createdById;
    if (notifyId && notifyId !== req.userId) {
      await notifyUser({
        userId: notifyId,
        text: `Vazifa chat: «${existing.title}» — yangi xabar`,
        type: "expired_task",
        linkUrl: "/vazifalar",
      });
    }

    res.json(await enrichTask(updated));
  },
);

/** Beruvchi / admin / direktor — to'liq tahrirlash (shu jumladan mas'ulni ko'chirish) */
router.patch("/tasks/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Vazifa topilmadi" });
    return;
  }

  if (!canManageTask(existing, req.userId, req.userRole)) {
    res.status(403).json({
      error: "Vazifa ma'lumotini faqat belgilagan shaxs, admin yoki direktor o'zgartira oladi",
    });
    return;
  }

  const body = req.body ?? {};
  const updates: Partial<typeof tasksTable.$inferInsert> = {};

  if (body.title !== undefined) updates.title = String(body.title).trim();
  if (body.description !== undefined) {
    updates.description = body.description ? String(body.description) : null;
  }
  if (body.status !== undefined) updates.status = String(body.status);
  if (body.priority !== undefined) updates.priority = String(body.priority);
  if (body.dueAt !== undefined) {
    updates.dueAt = body.dueAt ? new Date(body.dueAt) : null;
  }
  if (body.attachments !== undefined) {
    updates.attachments = sanitizeAttachments(body.attachments);
  }

  const prevMeta =
    existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
      ? (existing.meta as Record<string, unknown>)
      : {};
  let nextMeta: Record<string, unknown> | undefined;
  if (body.meta !== undefined) {
    nextMeta = applySupervisorAssignPolicy(
      applyTaskVisibilityPolicy(
        sanitizeMeta({ ...prevMeta, ...(body.meta as object) }),
        req.userRole,
      ),
      prevMeta,
      req.userRole,
    );
    const newSid = Number(nextMeta.supervisorUserId);
    const oldSid = Number(prevMeta.supervisorUserId);
    if (
      canAssignTaskSupervisor(req.userRole) &&
      Number.isFinite(newSid) &&
      newSid > 0 &&
      newSid !== oldSid
    ) {
      if (!nextMeta.supervisorName) {
        nextMeta.supervisorName = await resolveUserDisplayName(newSid);
      }
      const aidUid = await resolveNotifyUserId(
        (body.assigneeKind as string) || existing.assigneeKind,
        body.assigneeId !== undefined
          ? parseInt(String(body.assigneeId), 10)
          : existing.assigneeId,
      );
      if (aidUid === newSid) {
        res.status(400).json({
          error: "Nazoratchi va topshiriq oluvchi bir xil bo‘lmasligi kerak",
        });
        return;
      }
    }
  }

  if (body.assigneeKind !== undefined || body.assigneeId !== undefined) {
    const kind =
      body.assigneeKind === "employee"
        ? "employee"
        : body.assigneeKind === "user"
          ? "user"
          : existing.assigneeKind;
    const aid =
      body.assigneeId !== undefined
        ? parseInt(String(body.assigneeId), 10)
        : existing.assigneeId;
    const name = await resolveAssigneeName(kind, aid);
    if (!name) {
      res.status(400).json({ error: "Ijrochi topilmadi" });
      return;
    }
    const assigneeUserId = await resolveNotifyUserId(kind, aid);
    if (assigneeUserId != null && assigneeUserId === req.userId) {
      res.status(400).json({ error: "O‘zingizga vazifa qo‘yib bo‘lmaydi" });
      return;
    }
    const changed =
      kind !== existing.assigneeKind || Number(aid) !== Number(existing.assigneeId);
    updates.assigneeKind = kind;
    updates.assigneeId = aid;

    if (changed) {
      const oldName =
        (await resolveAssigneeName(existing.assigneeKind, existing.assigneeId)) ||
        `#${existing.assigneeId}`;
      const [me] = await db
        .select({ fullName: usersTable.fullName })
        .from(usersTable)
        .where(eq(usersTable.id, req.userId!));
      const now = new Date().toISOString();
      const base = nextMeta
        ? { ...prevMeta, ...nextMeta }
        : { ...prevMeta };
      const prevAHist = Array.isArray(base.assigneeHistory) ? base.assigneeHistory : [];
      const prevHist = Array.isArray(base.history) ? base.history : [];
      const transfer = {
        id: `ah-${Date.now()}`,
        assigneeKind: existing.assigneeKind,
        assigneeId: existing.assigneeId,
        name: oldName,
        statusAtTransfer: existing.status,
        transferredAt: now,
        byUserId: req.userId ?? null,
        byName: me?.fullName || null,
      };
      const histEvt = {
        id: `h-${Date.now()}`,
        text: `Mas'ul ko‘chirildi: ${oldName} → ${name} (${existing.status})`,
        createdAt: now,
      };
      nextMeta = sanitizeMeta({
        ...base,
        assigneeHistory: [...prevAHist, transfer].slice(-40),
        history: [...prevHist, histEvt].slice(-100),
        // Yangi mas’ul uchun qabul oynasini qayta hisoblash (hali qabul qilinmagan bo‘lsa)
        ...(existing.status === "todo" && !existing.acceptedAt
          ? { acceptDeadlineBase: now }
          : {}),
      });

      // Hali qabul qilinmagan vazifa yangi odamga o‘tsa — qabul qilish yana ochiladi
      if (existing.status === "todo" && !existing.acceptedAt) {
        updates.acceptedAt = null;
      }

      if (kind && aid) {
        const byName = me?.fullName || (await resolveUserDisplayName(req.userId));
        await notifyTaskAssignee({
          kind,
          assigneeId: aid,
          actorUserId: req.userId,
          text: buildTaskAssignedText({
            title: existing.title,
            fromName: byName,
            dueAt: existing.dueAt,
            description: existing.description,
            extraLine: `↩️ Avvalgi mas'ul: ${oldName}`,
          }),
          linkUrl: `/vazifalar?task=${existing.id}`,
          type: "task_assigned",
          title: "Vazifa biriktirildi",
        });
      }
      if (
        existing.assigneeKind === "user" &&
        existing.assigneeId !== req.userId &&
        existing.assigneeId !== aid
      ) {
        await notifyUser({
          userId: existing.assigneeId,
          text: `«${existing.title}» boshqa xodimga o‘tkazildi (${name})`,
          type: "stage_change",
          linkUrl: `/vazifalar?task=${existing.id}`,
          title: "Vazifa o‘zgardi",
        });
      } else if (
        existing.assigneeKind === "employee" &&
        existing.assigneeId !== aid
      ) {
        await notifyTaskAssignee({
          kind: "employee",
          assigneeId: existing.assigneeId,
          actorUserId: req.userId,
          text: `«${existing.title}» boshqa xodimga o‘tkazildi (${name})`,
          linkUrl: `/vazifalar?task=${existing.id}`,
          type: "stage_change",
        });
      }
    }
  }

  if (nextMeta !== undefined) {
    updates.meta = nextMeta;
  }

  {
    const nextKind = (updates.assigneeKind as string) || existing.assigneeKind;
    const nextAid = Number(updates.assigneeId ?? existing.assigneeId);
    const nextDue =
      updates.dueAt !== undefined
        ? (updates.dueAt as Date | null)
        : existing.dueAt;
    const weekendErr = await assertOfisWeekendDueOk(nextDue, [
      {
        kind: nextKind === "employee" ? "employee" : "user",
        id: nextAid,
      },
    ]);
    if (weekendErr) {
      res.status(400).json({ error: weekendErr });
      return;
    }
  }

  const [updated] = await db
    .update(tasksTable)
    .set(updates)
    .where(eq(tasksTable.id, id))
    .returning();

  if (nextMeta !== undefined) {
    const newSid = Number(nextMeta.supervisorUserId);
    const oldSid = Number(prevMeta.supervisorUserId);
    if (
      Number.isFinite(newSid) &&
      newSid > 0 &&
      newSid !== oldSid &&
      newSid !== req.userId
    ) {
      const byName = await resolveUserDisplayName(req.userId);
      await notifyUser({
        userId: newSid,
        text: [
          `👁 Nazorat: «${existing.title}»`,
          `👤 Belgilagan: ${byName}`,
          `⏰ Muddat: ${formatTaskDueUz(updated.dueAt ?? existing.dueAt)}`,
          "👉 Tasdiqlash va muddat — sizda ham bor (o‘chirishdan tashqari)",
        ].join("\n"),
        type: "task_assigned",
        linkUrl: `/vazifalar?task=${existing.id}`,
        title: "Nazoratchi etib belgilandingiz",
        telegram: true,
      });
    }
  }

  res.json(await enrichTask(updated));
});

/**
 * Mavjud topshiriqqa boshqa oluvchilar qo‘shish.
 * Har biri uchun alohida vazifa ochiladi (bir batch), yangilariga xabar ketadi.
 */
router.post("/tasks/:id/add-assignees", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!existing || isPipelineRecruitmentTask(existing)) {
    res.status(404).json({ error: "Vazifa topilmadi" });
    return;
  }
  if (!canManageTask(existing, req.userId, req.userRole)) {
    res.status(403).json({
      error: "Oluvchi qo‘shish faqat belgilagan shaxs, admin yoki direktor uchun",
    });
    return;
  }
  if (existing.status === "cancelled") {
    res.status(400).json({ error: "Bekor qilingan topshiriqqa oluvchi qo‘shib bo‘lmaydi" });
    return;
  }

  type AssigneeSpec = { kind: "user" | "employee"; id: number };
  const list: AssigneeSpec[] = [];
  const seen = new Set<string>();
  const pushAssignee = (kindRaw: unknown, idRaw: unknown) => {
    const kind = kindRaw === "employee" ? "employee" : "user";
    const aid = parseInt(String(idRaw), 10);
    if (!Number.isFinite(aid) || aid <= 0) return;
    const key = `${kind}:${aid}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ kind, id: aid });
  };
  const raw = req.body?.assignees;
  if (Array.isArray(raw)) {
    for (const a of raw) {
      if (!a || typeof a !== "object") continue;
      pushAssignee(
        (a as { assigneeKind?: unknown; kind?: unknown }).assigneeKind ??
          (a as { kind?: unknown }).kind,
        (a as { assigneeId?: unknown; id?: unknown }).assigneeId ?? (a as { id?: unknown }).id,
      );
    }
  }
  if (list.length === 0) {
    res.status(400).json({ error: "Kamida bitta yangi oluvchi tanlang" });
    return;
  }
  if (list.length > 40) {
    res.status(400).json({ error: "Bir vaqtda 40 tadan ortiq qo‘shib bo‘lmaydi" });
    return;
  }

  const meta0 = metaRecord(existing);
  let batchId =
    typeof meta0.batchId === "string" && meta0.batchId.trim() ? meta0.batchId.trim() : null;
  const siblings = batchId
    ? await db.select().from(tasksTable).where(sql`${tasksTable.meta}->>'batchId' = ${batchId}`)
    : [existing];
  const occupied = new Set(
    siblings.map((r) => `${r.assigneeKind}:${r.assigneeId}`),
  );
  occupied.add(`${existing.assigneeKind}:${existing.assigneeId}`);

  const toAdd: AssigneeSpec[] = [];
  for (const a of list) {
    if (occupied.has(`${a.kind}:${a.id}`)) continue;
    const uid = await resolveNotifyUserId(a.kind, a.id);
    if (uid != null && uid === req.userId) {
      res.status(400).json({ error: "O‘zingizni oluvchi qilib qo‘shib bo‘lmaydi" });
      return;
    }
    const name = await resolveAssigneeName(a.kind, a.id);
    if (!name) {
      res.status(400).json({ error: `Oluvchi topilmadi (${a.kind} #${a.id})` });
      return;
    }
    toAdd.push(a);
  }
  if (toAdd.length === 0) {
    res.status(400).json({ error: "Tanlanganlar allaqachon shu topshiriqda" });
    return;
  }

  const weekendErr = await assertOfisWeekendDueOk(existing.dueAt, toAdd);
  if (weekendErr) {
    res.status(400).json({ error: weekendErr });
    return;
  }

  if (!batchId) {
    batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const creatorName = await resolveUserDisplayName(req.userId);
  const nowIso = new Date().toISOString();
  const addedNames: string[] = [];
  const createdRows: (typeof tasksTable.$inferSelect)[] = [];

  const baseMetaClean = { ...meta0 };
  delete baseMetaClean.messages;
  delete baseMetaClean.assigneeHistory;
  delete baseMetaClean.acceptDeadlineBase;
  delete baseMetaClean.verifiedAt;
  delete baseMetaClean.lastReworkNote;
  delete baseMetaClean.lastReworkAt;
  delete baseMetaClean.lastReworkByName;
  delete baseMetaClean.reworkCount;
  delete baseMetaClean.lastReturnAttachments;
  delete baseMetaClean.submissionHistory;

  for (const a of toAdd) {
    const name = (await resolveAssigneeName(a.kind, a.id)) || `#${a.id}`;
    addedNames.push(name);
    const histEvt = {
      id: `h-add-${Date.now()}-${a.id}`,
      text: `Topshiriqqa qo‘shildi (mavjud vazifadan). Kimdan: ${creatorName}`,
      createdAt: nowIso,
    };
    const rowMeta = applyTaskVisibilityPolicy(
      sanitizeMeta({
        ...baseMetaClean,
        batchId,
        batchSize: siblings.length + toAdd.length,
        history: [histEvt],
      }),
      req.userRole,
    );
    const [created] = await db
      .insert(tasksTable)
      .values({
        title: existing.title,
        description: existing.description,
        status: "todo",
        priority: existing.priority || "normal",
        dueAt: existing.dueAt,
        assigneeKind: a.kind,
        assigneeId: a.id,
        createdById: existing.createdById,
        attachments: (existing.attachments as TaskAttachment[]) || [],
        meta: rowMeta,
        acceptedAt: null,
      })
      .returning();
    createdRows.push(created);
    await notifyTaskAssignee({
      kind: a.kind,
      assigneeId: a.id,
      actorUserId: req.userId,
      text: buildTaskAssignedText({
        title: existing.title,
        fromName: creatorName,
        dueAt: existing.dueAt,
        description: existing.description,
        extraLine: "➕ Mavjud topshiriqqa qo‘shildingiz",
      }),
      linkUrl: `/vazifalar?task=${created.id}`,
      type: "task_assigned",
      title: "Yangi vazifa",
    });
  }

  const finalSize = siblings.length + createdRows.length;
  const addHist = {
    id: `h-batch-add-${Date.now()}`,
    text: `Yangi oluvchilar qo‘shildi: ${addedNames.join(", ")}`,
    createdAt: nowIso,
  };

  // Barcha batch a’zolarida batchId / batchSize / history yangilansin
  const allInBatch = [...siblings.filter((r) => r.id !== existing.id), existing, ...createdRows];
  for (const row of allInBatch) {
    const m = metaRecord(row);
    const history = Array.isArray(m.history) ? m.history : [];
    const nextMeta = sanitizeMeta({
      ...m,
      batchId,
      batchSize: finalSize,
      history: row.id === existing.id || createdRows.some((c) => c.id === row.id)
        ? [...history, addHist].slice(-100)
        : [...history, addHist].slice(-100),
    });
    await db.update(tasksTable).set({ meta: nextMeta }).where(eq(tasksTable.id, row.id));
  }

  const [fresh] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  const enrichedCreated = await Promise.all(createdRows.map(enrichTask));
  res.status(201).json({
    ok: true,
    added: enrichedCreated.length,
    batchId,
    batchSize: finalSize,
    names: addedNames,
    items: enrichedCreated,
    task: fresh ? await enrichTask(fresh) : null,
  });
});

/** Ijrochi — vazifani qabul qilish (todo → in_progress) */
router.post("/tasks/:id/accept", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Vazifa topilmadi" });
    return;
  }
  if (!isAssignee(existing, req.userId)) {
    res.status(403).json({ error: "Faqat ijrochi qabul qila oladi" });
    return;
  }
  const overdueGate = denyIfAssigneeOverdue(existing, req.userId, req.userRole);
  if (!overdueGate.ok) {
    res.status(403).json({ error: overdueGate.error, code: overdueGate.code });
    return;
  }
  if (existing.status !== "todo") {
    res.status(400).json({
      error:
        existing.status === "in_progress"
          ? "Vazifa allaqachon qabul qilingan"
          : "Bu vazifani qabul qilib bo'lmaydi",
    });
    return;
  }

  const [updated] = await db
    .update(tasksTable)
    .set({ status: "in_progress", acceptedAt: new Date() })
    .where(eq(tasksTable.id, id))
    .returning();

  await syncBranchNeedFromTask({ taskId: id, event: "accepted" });

  const acceptRecipients = new Set<number>();
  if (existing.createdById && existing.createdById !== req.userId) {
    acceptRecipients.add(existing.createdById);
  }
  {
    const sid = supervisorUserIdOf(existing);
    if (sid && sid !== req.userId) acceptRecipients.add(sid);
  }
  for (const uid of acceptRecipients) {
    await notifyUser({
      userId: uid,
      text: `📥 «${existing.title}» qabul qilindi`,
      type: "stage_change",
      linkUrl: "/vazifalar",
    });
  }

  res.json(await enrichTask(updated));
});

/** Ijrochi — natija bilan bajarildi */
router.post("/tasks/:id/complete", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Vazifa topilmadi" });
    return;
  }
  if (!isAssignee(existing, req.userId)) {
    res.status(403).json({ error: "Faqat ijrochi bajarilgan deb yubora oladi" });
    return;
  }
  const overdueGate = denyIfAssigneeOverdue(existing, req.userId, req.userRole);
  if (!overdueGate.ok) {
    res.status(403).json({ error: overdueGate.error, code: overdueGate.code });
    return;
  }
  if (existing.status === "todo") {
    res.status(400).json({ error: "Avval vazifani qabul qiling" });
    return;
  }
  if (
    existing.status === "done" ||
    existing.status === "verified" ||
    existing.status === "cancelled"
  ) {
    res.status(400).json({ error: "Vazifa allaqachon yakunlangan" });
    return;
  }

  const note = req.body?.completionNote ? String(req.body.completionNote) : null;
  const files = sanitizeAttachments(req.body?.completionAttachments);
  if (!note?.trim() && files.length === 0) {
    res.status(400).json({
      error: "Bajarish uchun matn, rasm yoki fayl qo'shing",
    });
    return;
  }

  const [updated] = await db
    .update(tasksTable)
    .set({
      status: "done",
      completionNote: note?.trim() || null,
      completionAttachments: files,
      completedAt: new Date(),
    })
    .where(eq(tasksTable.id, id))
    .returning();

  await syncBranchNeedFromTask({ taskId: id, event: "completed" });

  // Belgilagan va nazoratchiga xabar
  const doneRecipients = new Set<number>();
  if (existing.createdById) doneRecipients.add(existing.createdById);
  {
    const sid = supervisorUserIdOf(existing);
    if (sid) doneRecipients.add(sid);
  }
  for (const uid of doneRecipients) {
    if (uid === req.userId) continue;
    await notifyUser({
      userId: uid,
      text: `✅ «${existing.title}» bajarildi — natijani ko‘rib tasdiqlang`,
      type: "stage_change",
      linkUrl: "/vazifalar",
    });
  }

  res.json(await enrichTask(updated));
});

/** Belgilovchi — bajarilganini tasdiqlash yoki qaytarish */
router.post("/tasks/:id/verify", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Vazifa topilmadi" });
    return;
  }
  if (!canApproveTask(existing, req.userId, req.userRole)) {
    res.status(403).json({ error: "Faqat belgilagan shaxs (yoki admin) tasdiqlay oladi" });
    return;
  }
  if (existing.status !== "done") {
    res.status(400).json({ error: "Faqat bajarilgan vazifani tasdiqlash mumkin" });
    return;
  }

  const action = String(req.body?.action || "");
  const reviewNote = req.body?.note ? String(req.body.note) : null;

  if (action === "approve") {
    const prevMeta =
      existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
        ? (existing.meta as Record<string, unknown>)
        : {};
    const nowIso = new Date().toISOString();
    const [updated] = await db
      .update(tasksTable)
      .set({
        status: "verified",
        meta: sanitizeMeta({ ...prevMeta, verifiedAt: nowIso }),
      })
      .where(eq(tasksTable.id, id))
      .returning();

    await syncBranchNeedFromTask({
      taskId: id,
      event: "verified",
      verifiedById: req.userId ?? null,
    });

    if (existing.assigneeId) {
      await notifyTaskAssignee({
        kind: existing.assigneeKind || "user",
        assigneeId: existing.assigneeId,
        actorUserId: req.userId,
        text: `✔ «${existing.title}» tasdiqlandi — vazifa yakunlandi`,
        type: "stage_change",
        title: "Vazifa tasdiqlandi",
        linkUrl: `/vazifalar?task=${existing.id}`,
      });
    }

    let nextTask: typeof tasksTable.$inferSelect | null = null;
    try {
      nextTask = await spawnRecurringTask(existing, req.userId);
    } catch (err) {
      req.log?.error({ err, taskId: id }, "Recurring task spawn failed");
    }

    const enriched = await enrichTask(updated);
    res.json(
      nextTask
        ? { ...enriched, nextRecurringTaskId: nextTask.id }
        : enriched,
    );
    return;
  }

  if (action === "rework") {
    const body = req.body ?? {};
    const prevMeta =
      existing.meta && typeof existing.meta === "object" && !Array.isArray(existing.meta)
        ? (existing.meta as Record<string, unknown>)
        : {};
    const nowIso = new Date().toISOString();
    const prevHistory = Array.isArray(prevMeta.history) ? prevMeta.history : [];
    const prevMessages = Array.isArray(prevMeta.messages) ? prevMeta.messages : [];
    const prevSubs = Array.isArray(prevMeta.submissionHistory)
      ? prevMeta.submissionHistory
      : [];
    const reworkCount = Number(prevMeta.reworkCount || 0) + 1;
    const [me] = await db
      .select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!));
    const reviewer = me?.fullName || "Rahbar";
    const noteText = (reviewNote || "").trim();
    if (!noteText) {
      res.status(400).json({ error: "Qaytarish sababi (izoh) majburiy" });
      return;
    }

    const keepDue =
      body.keepDue === true || body.keepDue === "true" || body.keepDue === 1;
    let nextDue: Date | null | undefined = undefined;
    if (!keepDue) {
      if (!body.dueAt) {
        res.status(400).json({
          error: "Yangi muddat kiriting yoki vaqtni o‘zgartirmasdan qaytaring",
        });
        return;
      }
      const d = new Date(String(body.dueAt));
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "Muddat noto‘g‘ri" });
        return;
      }
      nextDue = d;
    }

    const returnAttachments = sanitizeAttachments(body.attachments, 8);
    const archived = {
      id: `sub-${Date.now()}`,
      note: existing.completionNote,
      attachments: sanitizeAttachments(existing.completionAttachments, 8),
      completedAt: existing.completedAt
        ? new Date(existing.completedAt).toISOString()
        : null,
      returnedAt: nowIso,
      returnNote: noteText,
      returnAttachments,
      returnedByName: reviewer,
      dueAtBefore: existing.dueAt ? new Date(existing.dueAt).toISOString() : null,
      dueAtAfter: nextDue
        ? nextDue.toISOString()
        : existing.dueAt
          ? new Date(existing.dueAt).toISOString()
          : null,
      keepDue,
    };

    const histText = keepDue
      ? `Qaytarildi (#${reworkCount}): ${noteText} · muddat o‘zgarmadi`
      : `Qaytarildi (#${reworkCount}): ${noteText} · yangi muddat belgilangan`;

    const nextMeta = sanitizeMeta({
      ...prevMeta,
      lastReworkNote: noteText,
      lastReworkAt: nowIso,
      lastReworkByName: reviewer,
      lastReturnAttachments: returnAttachments,
      reworkCount,
      submissionHistory: [...prevSubs, archived].slice(-30),
      history: [
        ...prevHistory,
        { id: `h-return-${Date.now()}`, text: histText.slice(0, 300), createdAt: nowIso },
      ].slice(-100),
      messages: [
        ...prevMessages,
        {
          id: `m-return-${Date.now()}`,
          text: `↩ Qaytarildi: ${noteText}${
            keepDue ? " (muddat o‘zgarmadi)" : " · yangi muddat belgilangan"
          }`,
          authorName: reviewer,
          authorRole: "assigner",
          createdAt: nowIso,
          attachment: returnAttachments[0] || null,
        },
      ].slice(-200),
    });

    const updates: Partial<typeof tasksTable.$inferInsert> = {
      status: "in_progress",
      completionNote: null,
      completionAttachments: [],
      completedAt: null,
      meta: nextMeta,
    };
    if (!keepDue && nextDue) {
      const weekendErr = await assertOfisWeekendDueOk(nextDue, [
        {
          kind: existing.assigneeKind === "employee" ? "employee" : "user",
          id: existing.assigneeId,
        },
      ]);
      if (weekendErr) {
        res.status(400).json({ error: weekendErr });
        return;
      }
      updates.dueAt = nextDue;
    }

    const [updated] = await db
      .update(tasksTable)
      .set(updates)
      .where(eq(tasksTable.id, id))
      .returning();

    await syncBranchNeedFromTask({ taskId: id, event: "rework" });

    if (existing.assigneeKind === "user") {
      await notifyUser({
        userId: existing.assigneeId,
        text: `↩ «${existing.title}» qaytarildi: ${noteText}`,
        type: "stage_change",
        linkUrl: "/vazifalar",
      });
    }

    res.json(await enrichTask(updated));
    return;
  }

  res.status(400).json({ error: "action: approve yoki rework" });
});

/** Ijrochi — muddatni surish so'rovi */
router.post(
  "/tasks/:id/request-extension",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Vazifa topilmadi" });
      return;
    }
    if (!isAssignee(existing, req.userId)) {
      res.status(403).json({ error: "Faqat ijrochi muddat so'ray oladi" });
      return;
    }
    const overdueGate = denyIfAssigneeOverdue(existing, req.userId, req.userRole);
    if (!overdueGate.ok) {
      res.status(403).json({ error: overdueGate.error, code: overdueGate.code });
      return;
    }
    if (existing.status === "todo") {
      res.status(400).json({ error: "Avval vazifani qabul qiling" });
      return;
    }
    if (
      existing.status === "done" ||
      existing.status === "verified" ||
      existing.status === "cancelled"
    ) {
      res.status(400).json({ error: "Yakunlangan vazifa uchun muddat so'ralmaydi" });
      return;
    }

    const { dueAt, note } = req.body ?? {};
    if (!dueAt) {
      res.status(400).json({ error: "Yangi muddat majburiy" });
      return;
    }
    const proposed = new Date(dueAt);
    if (Number.isNaN(proposed.getTime())) {
      res.status(400).json({ error: "Noto'g'ri muddat" });
      return;
    }

    const [updated] = await db
      .update(tasksTable)
      .set({
        extensionRequestedDueAt: proposed,
        extensionNote: note ? String(note) : null,
        extensionStatus: "pending",
      })
      .where(eq(tasksTable.id, id))
      .returning();

    const extRecipients = new Set<number>();
    if (existing.createdById && existing.createdById !== req.userId) {
      extRecipients.add(existing.createdById);
    }
    {
      const sid = supervisorUserIdOf(existing);
      if (sid && sid !== req.userId) extRecipients.add(sid);
    }
    for (const uid of extRecipients) {
      await notifyUser({
        userId: uid,
        text: `«${existing.title}» uchun muddat uzaytirish so'raldi`,
        type: "expired_task",
        linkUrl: "/vazifalar",
      });
    }

    res.json(await enrichTask(updated));
  },
);

/** Beruvchi — muddat so'rovini tasdiqlash / rad etish */
router.post(
  "/tasks/:id/extension",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Vazifa topilmadi" });
      return;
    }
    if (!canApproveTask(existing, req.userId, req.userRole)) {
      res.status(403).json({ error: "Faqat belgilagan shaxs (yoki admin) muddatni tasdiqlay oladi" });
      return;
    }
    if (existing.extensionStatus !== "pending" || !existing.extensionRequestedDueAt) {
      res.status(400).json({ error: "Kutilayotgan muddat so'rovi yo'q" });
      return;
    }

    const action = String(req.body?.action || "");
    if (action !== "approve" && action !== "reject") {
      res.status(400).json({ error: "action: approve yoki reject" });
      return;
    }

    const updates: Partial<typeof tasksTable.$inferInsert> =
      action === "approve"
        ? {
            dueAt: existing.extensionRequestedDueAt,
            extensionStatus: "approved",
          }
        : { extensionStatus: "rejected" };

    const [updated] = await db
      .update(tasksTable)
      .set(updates)
      .where(eq(tasksTable.id, id))
      .returning();

    if (isAssignee(existing, existing.assigneeId) && existing.assigneeKind === "user") {
      await notifyUser({
        userId: existing.assigneeId,
        text:
          action === "approve"
            ? `«${existing.title}» muddati uzaytirildi`
            : `«${existing.title}» muddat so'rovi rad etildi`,
        type: "expired_task",
        linkUrl: "/vazifalar",
      });
    }

    res.json(await enrichTask(updated));
  },
);

router.delete("/tasks/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Vazifa topilmadi" });
    return;
  }
  // Admin — ko‘rinadigan har qanday; qolganlar — faqat o‘zi qo‘ygani
  const allowed =
    canAdminTaskOps(req.userRole) || isCreator(existing, req.userId);
  if (!allowed) {
    res.status(403).json({
      error: "Faqat o‘zingiz qo‘ygan vazifani o‘chira olasiz",
    });
    return;
  }

  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  res.status(204).send();
});

export default router;
