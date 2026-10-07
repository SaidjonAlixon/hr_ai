import { useState } from "react";
import { ChevronLeft, ChevronRight, FileImage, FileSpreadsheet, FileText, Paperclip } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AuthImage, TaskAttachmentViewer, isImageAtt, isPdfAtt } from "@/components/vazifalar/TaskAttachmentViewer";
import { cn } from "@/lib/utils";
import type { TaskAttachment } from "@/lib/vazifalar-api";

type RevisionFile = TaskAttachment & { label: string };

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    const raw = u.searchParams.get("path") || u.pathname.split("/").pop() || "";
    const last = decodeURIComponent(raw).split("/").pop() || "";
    return (last.includes("__") ? last.split("__").pop() : last) || "fayl";
  } catch {
    return "fayl";
  }
}

function toFile(url: string, label: string, name?: string): RevisionFile {
  const fileName = name || fileNameFromUrl(url);
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const mimeType = MIME_BY_EXT[ext] || "";
  return {
    id: url,
    url,
    name: fileName,
    mimeType,
    kind: mimeType.startsWith("image/") ? "image" : "file",
    label,
  };
}

export function revisionFilesOf(v: {
  actUrl?: string | null;
  receiptUrl?: string | null;
  extraDocs?: Array<{ url: string; name?: string }> | null;
}): RevisionFile[] {
  const out: RevisionFile[] = [];
  if (v.actUrl) out.push(toFile(v.actUrl, "Reviziya akti"));
  if (v.receiptUrl) out.push(toFile(v.receiptUrl, "Tilxat"));
  for (const [i, d] of (Array.isArray(v.extraDocs) ? v.extraDocs : []).entries()) {
    if (d?.url) out.push(toFile(d.url, `Qo‘shimcha hujjat ${i + 1}`, d.name));
  }
  return out;
}

function FileTile({ f, onOpen, compact }: { f: RevisionFile; onOpen: () => void; compact?: boolean }) {
  const image = isImageAtt(f);
  const pdf = isPdfAtt(f);
  const sheet = /\.(xlsx?|csv)$/i.test(f.name);
  const Icon = image ? FileImage : sheet ? FileSpreadsheet : FileText;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background text-left shadow-sm transition hover:-translate-y-px hover:border-violet-300 hover:shadow-md"
    >
      <div
        className={cn(
          "relative flex w-full items-center justify-center overflow-hidden bg-muted/60",
          compact ? "h-20" : "h-28",
        )}
      >
        {image ? (
          <AuthImage url={f.url} alt={f.label} loading="lazy" className="h-full w-full object-cover object-top transition group-hover:scale-105" />
        ) : (
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl",
              pdf
                ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                : sheet
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
            )}
          >
            <Icon className="h-6 w-6" />
          </span>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
          {image ? "Rasm" : pdf ? "PDF" : sheet ? "Excel" : "Fayl"}
        </span>
      </div>
      <div className="min-w-0 px-2.5 py-2">
        <p className="truncate text-[12px] font-semibold text-foreground">{f.label}</p>
        <p className="truncate text-[10px] text-muted-foreground">{f.name}</p>
      </div>
    </button>
  );
}

export function RevisionFiles({
  visit,
  compact,
  emptyText,
}: {
  visit: Parameters<typeof revisionFilesOf>[0];
  compact?: boolean;
  emptyText?: string;
}) {
  const files = revisionFilesOf(visit);
  const [index, setIndex] = useState<number | null>(null);
  const current = index != null ? files[index] : null;

  if (!files.length) {
    return emptyText ? (
      <p className="flex items-center gap-1.5 rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
        <Paperclip className="h-3.5 w-3.5" /> {emptyText}
      </p>
    ) : null;
  }

  return (
    <>
      <div className={cn("grid gap-2", compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3")}>
        {files.map((f, i) => (
          <FileTile key={f.id} f={f} compact={compact} onOpen={() => setIndex(i)} />
        ))}
      </div>

      <Dialog open={current != null} onOpenChange={(o) => !o && setIndex(null)}>
        <DialogContent
          hideClose
          className="flex h-[92vh] max-h-[92vh] w-[96vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl"
        >
          <DialogTitle className="sr-only">{current?.label || "Fayl"}</DialogTitle>
          <DialogDescription className="sr-only">{current?.name}</DialogDescription>
          {current ? (
            <div className="relative flex min-h-0 flex-1 flex-col">
              <TaskAttachmentViewer
                file={{ ...current, name: `${current.label} · ${current.name}` }}
                onClose={() => setIndex(null)}
                className="min-h-0 flex-1"
              />
              {files.length > 1 ? (
                <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-background px-3 py-2">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => setIndex((i) => (i == null ? i : Math.max(0, i - 1)))}
                    className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-medium hover:bg-muted disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" /> Oldingi
                  </button>
                  <div className="flex items-center gap-1.5">
                    {files.map((f, i) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setIndex(i)}
                        aria-label={f.label}
                        className={cn(
                          "h-2 rounded-full transition-all",
                          i === index ? "w-6 bg-violet-600" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/60",
                        )}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={index === files.length - 1}
                    onClick={() => setIndex((i) => (i == null ? i : Math.min(files.length - 1, i + 1)))}
                    className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-medium hover:bg-muted disabled:opacity-40"
                  >
                    Keyingi <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
