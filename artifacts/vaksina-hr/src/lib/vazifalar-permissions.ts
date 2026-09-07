import type { Vazifa } from "@/lib/vazifalar-api";

/** «Barcha uchun» — faqat shu rollar (oddiy xodim / bo‘lim boshlig‘i emas) */
export const TASK_ALL_VISIBILITY_ROLES = new Set([
  "admin",
  "director",
  "hr_direktor",
  "hr_auditor",
]);

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Kechikkan: muddat kuni o‘tgan, hali tekshiruv/yakun emas */
export function isTaskOverdue(task: Pick<Vazifa, "status" | "dueAt" | "createdAt">, now = new Date()) {
  if (task.status === "verified" || task.status === "cancelled" || task.status === "done") {
    return false;
  }
  const raw = task.dueAt || task.createdAt;
  if (!raw) return false;
  const due = startOfDay(new Date(raw));
  const today = startOfDay(now);
  return due.getTime() < today.getTime();
}

export function isTaskAdmin(role?: string | null) {
  return role === "admin";
}

export function canApproveTaskUi(
  task: Pick<Vazifa, "createdById">,
  userId?: number | null,
  role?: string | null,
) {
  if (!userId) return false;
  return task.createdById === userId || isTaskAdmin(role);
}

export function canDeleteTaskUi(role?: string | null) {
  return isTaskAdmin(role);
}
