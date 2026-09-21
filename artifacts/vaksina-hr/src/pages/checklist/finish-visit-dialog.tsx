import React, { useEffect, useState } from "react";
import { CheckCircle2, MapPin, NotebookPen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const MIN_NOTE = 10;
const MAX_NOTE = 2000;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchLabel: string;
  checkInAt?: string | null;
  submitting?: boolean;
  onFinish: (note: string) => void | Promise<void>;
};

export function FinishVisitDialog({
  open,
  onOpenChange,
  branchLabel,
  checkInAt,
  submitting,
  onFinish,
}: Props) {
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setNote("");
      setTouched(false);
    }
  }, [open]);

  const trimmed = note.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_NOTE;
  const canSubmit = trimmed.length >= MIN_NOTE && trimmed.length <= MAX_NOTE && !submitting;

  const checkInLabel = checkInAt
    ? new Date(checkInAt).toLocaleTimeString("uz-UZ", {
        timeZone: "Asia/Tashkent",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="gap-0 overflow-hidden border-0 p-0 sm:max-w-lg">
        <div className="bg-gradient-to-br from-[#0b3a5c] via-[#0d4a73] to-[#0b3a5c] px-5 pb-5 pt-6 text-white sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
              <NotebookPen className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="text-lg font-semibold tracking-tight text-white">
                  Tashrifni yakunlash
                </DialogTitle>
                <DialogDescription className="text-sm text-sky-100/90">
                  Izoh yozib «Tugatish» bosing — filial yopiladi, keyingisiga o‘tishingiz mumkin.
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-200" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-200/80">
                Filial
              </p>
              <p className="truncate text-sm font-medium text-white">{branchLabel}</p>
              {checkInLabel ? (
                <p className="mt-0.5 text-[11px] text-sky-100/75">Keldim: {checkInLabel}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-3 bg-card px-5 py-5 sm:px-6">
          <div className="space-y-2">
            <Label htmlFor="visit-finish-note" className="text-sm font-semibold text-foreground">
              Bugun bu yerda nimalar qildingiz?
            </Label>
            <Textarea
              id="visit-finish-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
              onBlur={() => setTouched(true)}
              placeholder="Masalan: mudir bilan suhbat, vitrina tekshiruvi, kamchiliklar bo‘yicha ogohlantirish…"
              rows={5}
              disabled={submitting}
              className={cn(
                "min-h-[120px] resize-y rounded-xl border-border/80 bg-muted/30 text-sm leading-relaxed focus-visible:ring-[#0b3a5c]/30",
                touched && tooShort && "border-rose-400 focus-visible:ring-rose-300/40",
              )}
            />
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span
                className={cn(
                  "text-muted-foreground",
                  touched && tooShort && "font-medium text-rose-600",
                )}
              >
                {touched && tooShort
                  ? `Kamida ${MIN_NOTE} belgi yozing`
                  : "Qisqa, aniq yozing — monitoringda ko‘rinadi"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {trimmed.length}/{MAX_NOTE}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/80 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              «Tugatish» dan keyin shu filial yopiladi. Keyin boshqa filialni tanlab yangi
              «Keldim» qilishingiz mumkin.
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t bg-muted/40 px-5 py-4 sm:px-6">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            Bekor
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => void onFinish(trimmed)}
            className="rounded-xl bg-[#0b3a5c] hover:bg-[#0d4a73]"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Yopilmoqda…
              </>
            ) : (
              "Tugatish"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
