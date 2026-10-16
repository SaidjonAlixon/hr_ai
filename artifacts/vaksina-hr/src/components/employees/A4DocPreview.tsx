import React, { useEffect, useState } from "react";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  url: string;
  name: string;
  mimeType?: string;
  className?: string;
};

function viewUrl(url: string) {
  if (url.includes("download=")) return url.replace(/([?&])download=\d/, "$1download=0");
  return url.includes("?") ? `${url}&download=0` : `${url}?download=0`;
}

/**
 * Kartochka ichida A4 varaq ko‘rinishidagi hujjat preview.
 */
export function A4DocPreview({ url, name, mimeType, className }: Props) {
  const href = viewUrl(url);
  const isImage = (mimeType || "").startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [url]);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-medium text-emerald-800 dark:text-emerald-300">
          <FileText className="h-3.5 w-3.5" />
          A4 hujjat
        </span>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Katta oynada
        </a>
      </div>

      {/* A4 shadow sheet */}
      <div className="mx-auto w-full max-w-[340px]">
        <div
          className={cn(
            "relative aspect-[210/297] overflow-hidden rounded-sm bg-white",
            "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_rgba(15,23,42,0.12),0_0_0_1px_rgba(15,23,42,0.06)]",
          )}
        >
          {/* Paper grain / edge */}
          <div className="pointer-events-none absolute inset-0 z-[1] ring-1 ring-inset ring-black/5" />

          {!loaded && !failed ? (
            <div className="absolute inset-0 z-[2] flex items-center justify-center bg-slate-50">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : null}

          {failed ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-50 px-4 text-center">
              <FileText className="h-8 w-8 text-slate-300" />
              <p className="text-xs text-slate-500">Preview ochilmadi — «Katta oynada» yoki Yuklash</p>
            </div>
          ) : isImage ? (
            <img
              src={href}
              alt={name}
              className="h-full w-full object-contain object-top"
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          ) : (
            <iframe
              title={name}
              src={`${href}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
              className="h-full w-full border-0 bg-white"
              onLoad={() => setLoaded(true)}
            />
          )}
        </div>
      </div>

      <p className="truncate text-center text-[10px] text-muted-foreground" title={name}>
        {name}
      </p>
    </div>
  );
}
