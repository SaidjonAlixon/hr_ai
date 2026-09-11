import { useEffect, useRef, useState } from "react";
import {
  Calendar,
  Clock,
  Paperclip,
  RotateCcw,
  Upload,
  X,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { TaskAttachment, Vazifa } from "@/lib/vazifalar-api";

export type TaskReturnPayload = {
  note: string;
  keepDue: boolean;
  dueAt?: string | null;
  attachments: TaskAttachment[];
};

type Props = {
  open: boolean;
  task: Vazifa | null;
  busy?: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (payload: TaskReturnPayload) => Promise<void>;
  onPickFiles: (files: FileList | null) => Promise<TaskAttachment[]>;
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatShort(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TaskReturnDialog({
  open,
  task,
  busy,
  onOpenChange,
  onSubmit,
  onPickFiles,
}: Props) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [keepDue, setKeepDue] = useState(true);
  const [dueLocal, setDueLocal] = useState("");
  const [files, setFiles] = useState<TaskAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !task) return;
    setNote("");
    setKeepDue(true);
    setDueLocal(toLocalInput(task.dueAt));
    setFiles([]);
    setError(null);
  }, [open, task?.id]);

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    setError(null);
    try {
      const added = await onPickFiles(list);
      setFiles((prev) => [...prev, ...added].slice(0, 8));
    } catch (e: any) {
      setError(e?.message || "Fayl yuklanmadi");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    const text = note.trim();
    if (!text) {
      setError(t("tasks.return.needNote"));
      return;
    }
    if (!keepDue) {
      if (!dueLocal) {
        setError(t("tasks.return.needDue"));
        return;
      }
      const d = new Date(dueLocal);
      if (Number.isNaN(d.getTime())) {
        setError(t("tasks.return.needDue"));
        return;
      }
    }
    setError(null);
    await onSubmit({
      note: text,
      keepDue,
      dueAt: keepDue ? null : new Date(dueLocal).toISOString(),
      attachments: files,
    });
  }

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border/80 bg-card p-0 sm:max-w-lg">
        {/* Brand: navy #0a2540 · blue #0b5fff · MED amber accent */}
        <div className="relative overflow-hidden rounded-t-lg bg-gradient-to-br from-[#0a2540] via-[#0b5fff] to-[#3dd6f5] px-5 pb-5 pt-6 text-white">
          <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10" />
          <div className="absolute -bottom-10 left-8 h-24 w-24 rounded-full bg-[#0a2540]/25" />
          <div className="absolute right-10 top-1/2 h-16 w-16 -translate-y-1/2 rounded-full bg-[#ffb020]/25 blur-xl" />
          <DialogHeader className="relative space-y-2 text-left">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 shadow-sm ring-1 ring-white/30 backdrop-blur">
              <RotateCcw className="h-5 w-5" />
            </div>
            <DialogTitle className="text-lg font-bold tracking-tight text-white drop-shadow-sm">
              {t("tasks.return.title")}
            </DialogTitle>
            <DialogDescription className="text-sm font-medium text-white">
              {t("tasks.return.subtitle")}
            </DialogDescription>
          </DialogHeader>
          <div className="relative mt-3 rounded-xl border border-white/30 bg-[#061428]/55 px-3 py-2.5 backdrop-blur">
            <p className="truncate text-sm font-semibold text-white">{task.title}</p>
            <p className="mt-0.5 text-[11px] font-medium text-white/95">
              TK-{task.id} · {task.assigneeName || "—"} ·{" "}
              {t("tasks.deadline")}: {formatShort(task.dueAt)}
            </p>
          </div>
        </div>

        <div className="space-y-4 bg-card px-5 py-4 text-foreground">
          {(task.completionNote || (task.completionAttachments?.length ?? 0) > 0) && (
            <div className="rounded-xl border border-[#0b5fff]/30 bg-[#eef4ff] p-3 dark:border-[#5b9dff]/40 dark:bg-[#102a4a]">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#0b5fff] dark:text-[#7eb6ff]">
                {t("tasks.return.currentResult")}
              </p>
              <p className="mt-1 text-[12px] font-medium leading-snug text-[#0a2540] dark:text-white">
                {task.completionNote ||
                  `${task.completionAttachments.length} ta fayl`}
              </p>
              <p className="mt-1 text-[10px] font-medium text-slate-600 dark:text-slate-200">
                {t("tasks.return.keepHistory")}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-100">
              {t("tasks.return.note")} *
            </Label>
            <Textarea
              value={note}
              rows={4}
              disabled={busy}
              placeholder={t("tasks.return.notePh")}
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
              className="min-h-[96px] resize-none rounded-xl border-slate-300 bg-white text-sm font-medium text-slate-900 placeholder:text-slate-500 focus-visible:border-[#0b5fff] focus-visible:ring-[#0b5fff]/25 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-400"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-100">
              {t("tasks.return.evidence")}
            </Label>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy || uploading}
              onClick={() => fileRef.current?.click()}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#0b5fff]/50 bg-[#eef4ff] px-3 py-3 text-[12px] font-bold text-[#0a2540] transition hover:border-[#0b5fff] hover:bg-[#dde9ff] dark:border-[#5b9dff]/50 dark:bg-[#102a4a] dark:text-white",
                (busy || uploading) && "opacity-60",
              )}
            >
              {uploading ? (
                <Upload className="h-4 w-4 animate-pulse text-[#0b5fff] dark:text-[#7eb6ff]" />
              ) : (
                <Paperclip className="h-4 w-4 text-[#0b5fff] dark:text-[#7eb6ff]" />
              )}
              {uploading ? t("ui.loading") : t("tasks.return.attach")}
            </button>
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 rounded-lg border border-[#0b5fff]/25 bg-[#eef4ff] px-2.5 py-1.5 text-[11px] font-medium text-slate-800 dark:border-[#5b9dff]/35 dark:bg-[#102a4a] dark:text-white"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-[#0b5fff] dark:text-[#7eb6ff]" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-300"
                      onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-[#f4f7fb] p-3 dark:border-slate-600 dark:bg-slate-900">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-100">
              {t("tasks.return.deadlineSection")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setKeepDue(true);
                  setError(null);
                }}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition",
                  keepDue
                    ? "border-[#0b5fff] bg-[#eef4ff] ring-2 ring-[#0b5fff]/30 dark:bg-[#0b5fff]/25"
                    : "border-slate-300 bg-white hover:border-[#0b5fff]/50 dark:border-slate-600 dark:bg-slate-950 dark:hover:border-[#5b9dff]/60",
                )}
              >
                <p className="text-[12px] font-bold text-[#0a2540] dark:text-white">
                  {t("tasks.return.keepDue")}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                  {formatShort(task.dueAt)}
                </p>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setKeepDue(false);
                  setError(null);
                }}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition",
                  !keepDue
                    ? "border-[#ffb020] bg-[#fff6e8] ring-2 ring-[#ffb020]/35 dark:bg-[#ffb020]/20"
                    : "border-slate-300 bg-white hover:border-[#ffb020]/60 dark:border-slate-600 dark:bg-slate-950 dark:hover:border-[#ffb020]/50",
                )}
              >
                <p className="text-[12px] font-bold text-[#0a2540] dark:text-white">
                  {t("tasks.return.changeDue")}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                  {t("tasks.return.changeDueHint")}
                </p>
              </button>
            </div>
            {!keepDue && (
              <div className="relative pt-1">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#ffb020]" />
                <Input
                  type="datetime-local"
                  value={dueLocal}
                  disabled={busy}
                  onChange={(e) => setDueLocal(e.target.value)}
                  className="h-11 rounded-xl border-[#ffb020]/60 bg-white pl-10 font-medium text-slate-900 dark:bg-slate-950 dark:text-white focus-visible:border-[#0b5fff] focus-visible:ring-[#0b5fff]/25"
                />
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#0b5fff]/35 bg-[#eef4ff] px-3 py-2.5 text-[12px] font-medium leading-snug text-[#0a2540] dark:border-[#5b9dff]/45 dark:bg-[#102a4a] dark:text-white">
            <Clock className="mr-1 inline h-3.5 w-3.5 text-[#0b5fff] dark:text-[#7eb6ff]" />
            {t("tasks.return.flowHint")}
          </div>

          {error ? (
            <p className="text-[12px] font-bold text-rose-600 dark:text-rose-300">{error}</p>
          ) : null}

          <div className="flex gap-2 pb-1">
            <Button
              type="button"
              disabled={busy || uploading}
              onClick={() => void handleSubmit()}
              className="h-11 flex-1 rounded-xl bg-gradient-to-r from-[#0a2540] to-[#0b5fff] text-sm font-bold text-white shadow-md shadow-[#0b5fff]/25 hover:opacity-95"
            >
              {busy ? "…" : t("tasks.return.submit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              className="h-11 rounded-xl border-slate-300 bg-white px-4 font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-500 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
            >
              {t("tasks.return.cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
