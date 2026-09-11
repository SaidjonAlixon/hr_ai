import { Download, ExternalLink, FileSpreadsheet, FileText, FileImage, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaskAttachment } from "@/lib/vazifalar-api";

function isImageAtt(a?: TaskAttachment | null) {
  if (!a) return false;
  return a.kind === "image" || (a.mimeType || "").startsWith("image/");
}

function isPdfAtt(a: TaskAttachment) {
  const name = (a.name || "").toLowerCase();
  const mime = (a.mimeType || "").toLowerCase();
  return mime.includes("pdf") || name.endsWith(".pdf");
}

function isOfficeAtt(a: TaskAttachment) {
  const name = (a.name || "").toLowerCase();
  const mime = (a.mimeType || "").toLowerCase();
  return (
    mime.includes("word") ||
    mime.includes("officedocument") ||
    mime.includes("msword") ||
    mime.includes("sheet") ||
    mime.includes("excel") ||
    mime.includes("presentation") ||
    mime.includes("powerpoint") ||
    /\.(docx?|xlsx?|pptx?|csv)$/.test(name)
  );
}

function isSpreadsheetAtt(a: TaskAttachment) {
  const name = (a.name || "").toLowerCase();
  const mime = (a.mimeType || "").toLowerCase();
  return mime.includes("sheet") || mime.includes("excel") || /\.(xlsx?|csv)$/.test(name);
}

/** Ko‘rish URL — download=1 bo‘lmasin */
export function attachmentViewUrl(url: string) {
  try {
    if (url.startsWith("blob:") || url.startsWith("data:")) return url;
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://local");
    u.searchParams.delete("download");
    const path = u.pathname + u.search + u.hash;
    return url.startsWith("http") ? u.toString() : path;
  } catch {
    return url.replace(/([?&])download=1&?/g, "$1").replace(/[?&]$/, "");
  }
}

export function attachmentDownloadUrl(url: string) {
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  if (!url.startsWith("/api/uploads/") && !url.includes("/api/uploads/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

function formatSize(bytes?: number) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  file: TaskAttachment;
  onClose: () => void;
  className?: string;
};

/**
 * Topshiriq faylini to‘liq aniq panelda ko‘rsatadi (PDF / rasm / ofis).
 * Yopilganda chaqiruvchi chatga qaytaradi.
 */
export function TaskAttachmentViewer({ file, onClose, className }: Props) {
  const viewUrl = attachmentViewUrl(file.url);
  const downloadUrl = attachmentDownloadUrl(file.url);
  const image = isImageAtt(file);
  const pdf = isPdfAtt(file);
  const office = isOfficeAtt(file);
  const sheet = isSpreadsheetAtt(file);

  const onDownload = async () => {
    try {
      const { deliverFileFromUrl, isTelegramMiniApp } = await import("@/lib/tg-download");
      if (isTelegramMiniApp()) {
        await deliverFileFromUrl(file.url, file.name);
        return;
      }
    } catch (err) {
      console.error(err);
    }
    window.open(downloadUrl, "_blank", "noopener,noreferrer");
  };

  const Icon = image ? FileImage : sheet ? FileSpreadsheet : FileText;
  const kindLabel = image
    ? "Rasm"
    : pdf
      ? "PDF"
      : sheet
        ? "Excel"
        : office
          ? "Word / ofis"
          : "Fayl";

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-gradient-to-b from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950",
        className,
      )}
      role="dialog"
      aria-label={file.name}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200/90 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:px-4">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            image
              ? "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
              : sheet
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : pdf
                  ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                  : "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{file.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {kindLabel}
            {formatSize(file.size) ? ` · ${formatSize(file.size)}` : ""}
            {file.mimeType ? ` · ${file.mimeType}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="outline" size="sm" className="hidden h-8 gap-1.5 rounded-lg sm:inline-flex" asChild>
            <a href={viewUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Yangi oyna
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-lg"
            onClick={() => void onDownload()}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Yuklash</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-9 w-9 rounded-xl bg-[#0b5fff] text-white hover:bg-[#0a54e6] hover:text-white"
            onClick={onClose}
            aria-label="Yopish"
            title="Yopish · chat"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
        <div className="flex h-full min-h-[min(70vh,640px)] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-950 sm:min-h-0">
          {image ? (
            <div className="flex h-full items-center justify-center overflow-auto bg-[radial-gradient(circle_at_center,_#f1f5f9_0%,_#e2e8f0_100%)] p-3 dark:bg-[radial-gradient(circle_at_center,_#0f172a_0%,_#020617_100%)]">
              <img
                src={viewUrl}
                alt={file.name}
                className="max-h-full max-w-full object-contain shadow-2xl"
              />
            </div>
          ) : pdf ? (
            <iframe
              title={file.name}
              src={`${viewUrl}#toolbar=1&navpanes=0&view=FitH`}
              className="h-full w-full flex-1 border-0 bg-slate-100 dark:bg-slate-900"
            />
          ) : office ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 bg-[radial-gradient(ellipse_at_top,_#f8fafc_0%,_#e2e8f0_100%)] px-6 py-10 text-center dark:bg-[radial-gradient(ellipse_at_top,_#0f172a_0%,_#020617_100%)]">
              <span
                className={cn(
                  "flex h-20 w-20 items-center justify-center rounded-3xl shadow-inner",
                  sheet
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
                )}
              >
                <Icon className="h-10 w-10" />
              </span>
              <div className="max-w-md space-y-1.5">
                <p className="text-lg font-semibold tracking-tight text-foreground">{file.name}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Word / Excel fayllar brauzerda to‘liq ochiladi. Pastdagi tugma bilan aniq ko‘ring yoki yuklab oling.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button type="button" size="lg" className="rounded-xl bg-[#0b5fff] px-6 hover:bg-[#0a54e6]" asChild>
                  <a href={viewUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    To‘liq ochish
                  </a>
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="rounded-xl px-6"
                  onClick={() => void onDownload()}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Yuklab olish
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-12 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <FileText className="h-8 w-8" />
              </span>
              <div>
                <p className="text-base font-semibold text-foreground">{file.name}</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Bu fayl turini panelda oldindan ko‘rib bo‘lmaydi. Ochish yoki yuklab oling.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button type="button" className="rounded-xl bg-[#0b5fff] hover:bg-[#0a54e6]" asChild>
                  <a href={viewUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1.5 h-4 w-4" />
                    Ochish
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => void onDownload()}
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  Yuklash
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { isImageAtt, isPdfAtt, isOfficeAtt };
