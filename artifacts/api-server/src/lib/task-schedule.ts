/** Muddat oldidan eslatma offset → millisekund */
export function parseReminderOffsetMs(offset: string | null | undefined): number {
  const o = String(offset || "1d").trim().toLowerCase();
  switch (o) {
    case "1h":
      return 60 * 60 * 1000;
    case "3h":
      return 3 * 60 * 60 * 1000;
    case "1d":
      return 24 * 60 * 60 * 1000;
    case "3d":
      return 3 * 24 * 60 * 60 * 1000;
    case "1w":
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

export type TaskRecurrence = "daily" | "weekly" | "monthly";

export function normalizeRecurrence(
  raw: unknown,
): TaskRecurrence | "none" {
  const v = String(raw || "none").trim().toLowerCase();
  if (v === "daily" || v === "weekly" || v === "monthly") return v;
  return "none";
}

/** Keyingi muddat (Asia/Tashkent kuniga yaqinlashmasdan, shunchaki interval qo‘shiladi) */
export function advanceDueAt(
  due: Date | null | undefined,
  recurrence: TaskRecurrence,
  from: Date = new Date(),
): Date {
  const base =
    due && !Number.isNaN(due.getTime()) ? new Date(due.getTime()) : new Date(from.getTime());
  // Agar muddat o‘tgan bo‘lsa, keyingi intervalni «hozir»dan hisobla
  const start = base.getTime() > from.getTime() ? base : new Date(from.getTime());
  const next = new Date(start.getTime());
  if (recurrence === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (recurrence === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}
