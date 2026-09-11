import type { Vazifa } from "@/lib/vazifalar-api";

/** Barcha xodimlar topshiriqlarini ko‘rish / filtr (O‘zim | Barcha | shaxs) */
export const TASK_ALL_VISIBILITY_ROLES = new Set([
  "admin",
  "director",
  "hr_direktor",
  "hr_auditor",
]);

/** Qabul qilish muddati — yaratilgan (yoki qayta biriktirilgan) vaqtdan */
export const ACCEPT_DEADLINE_MS: Record<string, number> = {
  low: 6 * 60 * 60 * 1000,
  normal: 3 * 60 * 60 * 1000,
  high: 1 * 60 * 60 * 1000,
  urgent: 10 * 60 * 1000,
};

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function acceptDeadlineMs(priority?: string | null) {
  return ACCEPT_DEADLINE_MS[priority || "normal"] ?? ACCEPT_DEADLINE_MS.normal;
}

/** Qabul oynasi boshlanishi: meta.acceptDeadlineBase yoki createdAt */
export function acceptWindowStart(
  task: Pick<Vazifa, "createdAt" | "meta">,
): Date {
  const base = (task.meta as { acceptDeadlineBase?: string } | null | undefined)
    ?.acceptDeadlineBase;
  if (base) {
    const d = new Date(base);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(task.createdAt);
}

export function acceptDeadlineAt(
  task: Pick<Vazifa, "createdAt" | "priority" | "meta">,
): Date {
  return new Date(acceptWindowStart(task).getTime() + acceptDeadlineMs(task.priority));
}

/**
 * Muhimlik bo‘yicha qabul muddati o‘tgan va hali qabul qilinmagan (todo).
 * Past 6s · O‘rta 3s · Yuqori 1s · Shoshilinch 10d.
 */
export function isAcceptOverdue(
  task: Pick<Vazifa, "status" | "createdAt" | "priority" | "acceptedAt" | "meta">,
  now = new Date(),
) {
  if (
    task.status === "verified" ||
    task.status === "cancelled" ||
    task.status === "done" ||
    task.status === "in_progress"
  ) {
    return false;
  }
  if (task.acceptedAt) return false;
  if (task.status !== "todo") return false;
  return now.getTime() > acceptDeadlineAt(task).getTime();
}

/** Muddat kuni o‘tgan (dueAt), hali yakunlanmagan */
export function isDueDateOverdue(
  task: Pick<Vazifa, "status" | "dueAt" | "createdAt">,
  now = new Date(),
) {
  if (task.status === "verified" || task.status === "cancelled" || task.status === "done") {
    return false;
  }
  const raw = task.dueAt || task.createdAt;
  if (!raw) return false;
  const due = startOfDay(new Date(raw));
  const today = startOfDay(now);
  return due.getTime() < today.getTime();
}

/** Kechikkan: qabul muddati yoki bajarish muddati o‘tgan */
export function isTaskOverdue(
  task: Pick<
    Vazifa,
    "status" | "dueAt" | "createdAt" | "priority" | "acceptedAt" | "meta"
  >,
  now = new Date(),
) {
  return isAcceptOverdue(task, now) || isDueDateOverdue(task, now);
}

export function isTaskAdmin(role?: string | null) {
  return role === "admin";
}

export function isTaskDirector(role?: string | null) {
  return role === "director";
}

/** Direktor / admin / HR direktor / HR auditor — barcha topshiriqlarni ko‘rish */
export function canBrowseAllTasks(role?: string | null) {
  return !!role && TASK_ALL_VISIBILITY_ROLES.has(role);
}

/**
 * To‘liq tahrirlash (forma, mas’ulni o‘zgartirish):
 * - admin, director — barcha
 * - qolganlar (shu jumladan hr_direktor / hr_auditor) — faqat o‘zi yaratgani
 */
export function canManageTaskUi(
  task: Pick<Vazifa, "createdById">,
  userId?: number | null,
  role?: string | null,
) {
  if (!userId) return false;
  if (isTaskAdmin(role) || isTaskDirector(role)) return true;
  return task.createdById === userId;
}

export function canApproveTaskUi(
  task: Pick<Vazifa, "createdById">,
  userId?: number | null,
  role?: string | null,
) {
  if (!userId) return false;
  return task.createdById === userId || isTaskAdmin(role) || isTaskDirector(role);
}

export function canDeleteTaskUi(role?: string | null) {
  return isTaskAdmin(role);
}
