import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
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

const router: IRouter = Router();

import { HR_ROLES } from "../lib/roles";
import { DEPT_HEAD_ROLES } from "../lib/dept-staff";

/** Rahbar / boshqaruv rollari — vazifa belgilash huquqi */
const MANAGER_ROLES = new Set<string>([
  "admin",
  ...HR_ROLES,
  "director",
  ...DEPT_HEAD_ROLES,
  "recruiter",
  "trainer",
  "mudir",
  "koordinator",
  "sb",
  "sb_boshliq",
]);

/** «Barcha uchun» — faqat shu rahbarlar (oddiy xodim / bo‘lim boshlig‘i emas) */
const TASK_ALL_VISIBILITY_ROLES = new Set([
  "admin",
  "director",
  "hr_direktor",
  "hr_auditor",
]);

function canAssignTasks(role?: string): boolean {
  return !!role && MANAGER_ROLES.has(role);
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
  return role === "admin";
}

function isDirectorRole(role?: string | null) {
  return role === "director";
}

/** To‘liq tahrirlash: admin/direktor — hammasi; qolganlar — faqat o‘zi yaratgani */
function canManageTask(
  row: typeof tasksTable.$inferSelect,
  userId?: number,
  role?: string,
) {
  if (isAdminRole(role) || isDirectorRole(role)) return true;
  return isCreator(row, userId);
}

/** Tasdiqlash: beruvchi, admin yoki direktor */
function canApproveTask(row: typeof tasksTable.$inferSelect, userId?: number, role?: string) {
  return isCreator(row, userId) || isAdminRole(role) || isDirectorRole(role);
}

/** To‘liq boshqaruv (o‘chirish va h.k.) — faqat admin */
function canAdminTaskOps(role?: string | null) {
  return isAdminRole(role);
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const ACCEPT_DEADLINE_MS: Record<string, number> = {
  low: 6 * 60 * 60 * 1000,
  normal: 3 * 60 * 60 * 1000,
  high: 1 * 60 * 60 * 1000,
  urgent: 10 * 60 * 1000,
};

function acceptDeadlineMs(priority?: string | null) {
  return ACCEPT_DEADLINE_MS[priority || "normal"] ?? ACCEPT_DEADLINE_MS.normal;
}

function acceptWindowStart(row: typeof tasksTable.$inferSelect): Date {
  const meta =
    row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
      ? (row.meta as Record<string, unknown>)
      : {};
  const base = meta.acceptDeadlineBase;
  if (typeof base === "string" && base) {
    const d = new Date(base);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(row.createdAt);
}

function isAcceptOverdue(row: typeof tasksTable.$inferSelect, now = new Date()) {
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
  const due = startOfDay(new Date(raw));
  const today = startOfDay(now);
  return due.getTime() < today.getTime();
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
  if (isAdminRole(role) || isDirectorRole(role) || isCreator(row, userId)) return { ok: true };
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
 * - admin: hammasi
 * - beruvchi / oluvchi: o‘z vazifasi
 * - private: faqat yuqoridagilar
 * - all: + director, hr_direktor, hr_auditor
 */
function canViewTask(row: typeof tasksTable.$inferSelect, userId?: number, role?: string) {
  if (isAdminRole(role)) return true;
  if (isCreator(row, userId) || isAssignee(row, userId)) return true;
  const meta = (row.meta && typeof row.meta === "object" ? row.meta : {}) as Record<
    string,
    unknown
  >;
  if (meta.visibility === "private") return false;
  return !!role && TASK_ALL_VISIBILITY_ROLES.has(role);
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
  if (src.visibility === "all" || src.visibility === "private") {
    out.visibility = src.visibility;
  }
  if (src.notes != null) out.notes = String(src.notes).slice(0, 500);
  if (src.formStatus != null) out.formStatus = String(src.formStatus).slice(0, 40);
  if (src.verifiedAt != null) out.verifiedAt = String(src.verifiedAt).slice(0, 40);
  if (src.acceptDeadlineBase != null) {
    out.acceptDeadlineBase = String(src.acceptDeadlineBase).slice(0, 40);
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
        m?.authorRole === "assignee" || m?.authorRole === "system"
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

  return out;
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

  let rows = await db.select().from(tasksTable).orderBy(desc(tasksTable.dueAt));

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
    res.status(403).json({ error: "Vazifa belgilash faqat rahbarlar uchun" });
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
  const baseMeta = sanitizeMeta(meta);
  const fileAtt = sanitizeAttachments(attachments);
  const createdRows = [];

  for (const a of list) {
    const rowMeta = sanitizeMeta({
      ...baseMeta,
      ...(batchId
        ? {
            batchId,
            batchSize: list.length,
          }
        : {}),
    });
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

    if (a.kind === "user" && a.id !== req.userId) {
      await notifyUser({
        userId: a.id,
        text: `Sizga yangi vazifa: «${created.title}» — avval qabul qiling`,
        type: "expired_task",
        linkUrl: "/vazifalar",
      });
    }
    createdRows.push(created);
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
  if (!row) {
    res.status(404).json({ error: "Vazifa topilmadi" });
    return;
  }
  if (!canViewTask(row, req.userId, req.userRole)) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }
  res.json(await enrichTask(row));
});

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
    if (
      !isCreator(existing, req.userId) &&
      !isAssignee(existing, req.userId) &&
      !isAdminRole(req.userRole)
    ) {
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

    const role: "assigner" | "assignee" = isAssignee(existing, req.userId)
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
      text: attachment ? "Chatga fayl yuborildi" : "Chatga xabar yuborildi",
      createdAt: now,
    };

    const nextMeta = sanitizeMeta({
      ...prevMeta,
      messages: [...prevMessages, msg].slice(-200),
      history: [...prevHistory, hist].slice(-80),
    });

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
    nextMeta = sanitizeMeta({ ...prevMeta, ...(body.meta as object) });
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

      if (kind === "user" && aid !== req.userId) {
        await notifyUser({
          userId: aid,
          text: `Sizga vazifa biriktirildi: «${existing.title}» (avval: ${oldName})`,
          type: "expired_task",
          linkUrl: "/vazifalar",
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
          linkUrl: "/vazifalar",
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

  res.json(await enrichTask(updated));
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

  if (existing.createdById !== req.userId) {
    await notifyUser({
      userId: existing.createdById,
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

  // Belgilagan odamga har doim xabar
  await notifyUser({
    userId: existing.createdById,
    text: `✅ «${existing.title}» bajarildi — natijani ko‘rib tasdiqlang`,
    type: "stage_change",
    linkUrl: "/vazifalar",
  });

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

    if (existing.assigneeKind === "user") {
      await notifyUser({
        userId: existing.assigneeId,
        text: `✔ «${existing.title}» tasdiqlandi — vazifa yakunlandi`,
        type: "stage_change",
        linkUrl: "/vazifalar",
      });
    }

    res.json(await enrichTask(updated));
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

    if (existing.createdById !== req.userId) {
      await notifyUser({
        userId: existing.createdById,
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
  if (!canAdminTaskOps(req.userRole)) {
    res.status(403).json({ error: "Vazifani o‘chirish faqat admin uchun" });
    return;
  }

  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  res.status(204).send();
});

export default router;
