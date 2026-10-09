import { useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { conferenceApi, conferenceLink, copyText } from "@/lib/conference/api";

/** Yangi taklif havolasi: eski havola darhol eskiradi, xonadagilar uzilmaydi */
export function RotateLinkDialog({
  code,
  title,
  open,
  onOpenChange,
  onRotated,
}: {
  code: string | null;
  title?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRotated: (newCode: string) => void;
}) {
  const { toast } = useToast();
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setNewCode(null);
      setCopied(false);
      setNotify(true);
    }
  }, [open]);

  const rotate = async () => {
    if (!code) return;
    setBusy(true);
    try {
      const out = await conferenceApi.rotateLink(code, notify);
      setNewCode(out.code);
      onRotated(out.code);
      if (await copyText(conferenceLink(out.code))) setCopied(true);
    } catch (e) {
      toast({ title: "Havola yangilanmadi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md rounded-3xl">
        {newCode ? (
          <>
            <DialogHeader>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Check className="h-7 w-7" />
              </div>
              <DialogTitle className="text-center">Yangi havola tayyor</DialogTitle>
              <DialogDescription className="text-center">
                Eski havola bekor qilindi — u orqali endi hech kim kira olmaydi.
                {notify ? " Taklif qilinganlarga yangi havola bot orqali yuborildi." : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-2xl border bg-muted/40 p-2 pl-3">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{conferenceLink(newCode)}</span>
              <button
                type="button"
                onClick={async () => {
                  if (await copyText(conferenceLink(newCode))) {
                    setCopied(true);
                    toast({ title: "Havola nusxalandi" });
                  }
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Nusxalandi" : "Nusxalash"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="w-full rounded-2xl border px-4 py-2.5 text-sm font-semibold transition hover:bg-muted"
            >
              Yopish
            </button>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <RefreshCw className="h-7 w-7" />
              </div>
              <DialogTitle className="text-center">Yangi havola yaratilsinmi?</DialogTitle>
              <DialogDescription className="text-center">
                {title ? `«${title}» uchun ` : ""}yangi taklif havolasi yaratiladi. Istalgancha yangilash mumkin.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Eski havola <b>darhol eskiradi</b> — u orqali kirmoqchi bo‘lganlarga «Havola eskirgan» chiqadi. Hozir ichkarida o‘tirganlar
                uzilmaydi.
              </span>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-3 py-2.5">
              <span className="text-sm">Taklif qilinganlarga yangi havolani bot orqali yuborish</span>
              <Switch checked={notify} onCheckedChange={setNotify} />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpenChange(false)}
                className="flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                disabled={busy || !code}
                onClick={() => void rotate()}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Yangi havola
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
