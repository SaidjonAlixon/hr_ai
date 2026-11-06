import type { TaskAttachment, TaskChecklistItem } from "@/lib/vazifalar-api";

const LS_KEY = "vazifalar.taskFormDrafts";
const MAX_DRAFTS = 30;

export type TaskFormDraft = {
  id: string;
  savedAt: string;
  title: string;
  description: string;
  priority: string;
  dueDate: string;
  dueTime: string;
  assigneeKey: string;
  multiAssigneeKeys: string[];
  filterOfis: boolean;
  filterDorixona: boolean;
  branchOrDept: string;
  taskType: string;
  tags: string[];
  attachments: TaskAttachment[];
  checklist: TaskChecklistItem[];
  notes: string;
  reminderEnabled: boolean;
  reminderOffset: string;
  acceptWindowEnabled: boolean;
  recurrence: string;
  recurrencePeriod: "daily" | "weekly" | "monthly";
  visibility: "all" | "private";
  supervisorKey: string;
};

export type TaskFormDraftPayload = Omit<TaskFormDraft, "id" | "savedAt">;

function newId(): string {
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function readTaskFormDrafts(): TaskFormDraft[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((d) => d && typeof d === "object" && typeof d.id === "string")
      .map((d) => ({
        id: String(d.id),
        savedAt: String(d.savedAt || new Date().toISOString()),
        title: String(d.title || ""),
        description: String(d.description || ""),
        priority: String(d.priority || "normal"),
        dueDate: String(d.dueDate || ""),
        dueTime: String(d.dueTime || "18:00"),
        assigneeKey: String(d.assigneeKey || ""),
        multiAssigneeKeys: Array.isArray(d.multiAssigneeKeys)
          ? d.multiAssigneeKeys.map(String).filter(Boolean)
          : [],
        filterOfis: d.filterOfis !== false,
        filterDorixona: d.filterDorixona !== false,
        branchOrDept: String(d.branchOrDept || ""),
        taskType: String(d.taskType || "hisobot"),
        tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
        attachments: Array.isArray(d.attachments) ? d.attachments : [],
        checklist: Array.isArray(d.checklist) ? d.checklist : [],
        notes: String(d.notes || ""),
        reminderEnabled: d.reminderEnabled !== false,
        reminderOffset: String(d.reminderOffset || "1d"),
        acceptWindowEnabled: !!d.acceptWindowEnabled,
        recurrence: String(d.recurrence || "none"),
        recurrencePeriod:
          d.recurrencePeriod === "daily" || d.recurrencePeriod === "monthly"
            ? d.recurrencePeriod
            : "weekly",
        visibility: d.visibility === "private" ? "private" : "all",
        supervisorKey: String(d.supervisorKey || ""),
      }))
      .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  } catch {
    return [];
  }
}

function writeAll(list: TaskFormDraft[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_DRAFTS)));
  } catch {
    /* ignore quota */
  }
}

export function upsertTaskFormDraft(
  payload: TaskFormDraftPayload,
  existingId?: string | null,
): TaskFormDraft {
  const list = readTaskFormDrafts();
  const now = new Date().toISOString();
  const id = existingId && list.some((d) => d.id === existingId) ? existingId : newId();
  const next: TaskFormDraft = { ...payload, id, savedAt: now };
  const without = list.filter((d) => d.id !== id);
  writeAll([next, ...without]);
  return next;
}

export function removeTaskFormDraft(id: string) {
  writeAll(readTaskFormDrafts().filter((d) => d.id !== id));
}

export function draftLabel(d: TaskFormDraft): string {
  const t = d.title.trim();
  if (t) return t.slice(0, 80);
  const n = d.multiAssigneeKeys.length || (d.assigneeKey ? 1 : 0);
  if (n > 0) return `Qoralama · ${n} bajaruvchi`;
  return "Bo‘sh qoralama";
}
