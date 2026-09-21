import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, MapPin, NotebookPen, Loader2, LogOut } from "lucide-react";
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
  checklistAt?: string | null;
  submitting?: boolean;
  onFinish: (note: string) => void | Promise<void>;
};

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} daqiqa`;
  if (m === 0) return `${h} soat`;
  return `${h} soat ${m} daq`;
}

function formatHm(iso?: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FinishVisitDialog({
  open,
  onOpenChange,
  branchLabel,
  checkInAt,
  checklistAt,
  submitting,
  onFinish,
}: Props) {
  const [step, setStep] = useState<"confirm" | "note">("confirm");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setStep("confirm");
    setNote("");
    setTouched(false);
    setNowTick(Date.now());
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [open]);

  const checkInMs = checkInAt ? new Date(checkInAt).getTime() : NaN;
  const checklistMs = checklistAt ? new Date(checklistAt).getTime() : NaN;
  const elapsedMs = Number.isFinite(checkInMs) ? Math.max(0, nowTick - checkInMs) : 0;
  const checklistLagMs =
    Number.isFinite(checkInMs) && Number.isFinite(checklistMs)
      ? Math.max(0, checklistMs - checkInMs)
      : null;
  const afterChecklistMs =
    Number.isFinite(checklistMs) ? Math.max(0, nowTick - checklistMs) : null;

  const checkInLabel = formatHm(checkInAt);
  const checklistLabel = formatHm(checklistAt);

  const trimmed = note.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_NOTE;
  const canSubmit = trimmed.length >= MIN_NOTE && trimmed.length <= MAX_NOTE && !submitting;

  const durationLine = useMemo(() => formatDuration(elapsedMs), [elapsedMs]);

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="gap-0 overflow-hidden border-0 p-0 sm:max-w-lg">
        <div className="bg-gradient-to-br from-rose-800 via-rose-700 to-[#7f1d1d] px-5 pb-5 pt-6 text-white sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
              {step === "confirm" ? (
                <LogOut className="h-5 w-5" />
              ) : (
                <NotebookPen className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="text-lg font-semibold tracking-tight text-white">
                  {step === "confirm" ? "Ketdim — vaqt" : "Ketdim — izoh"}
                </DialogTitle>
                <DialogDescription className="text-sm text-rose-100/90">
                  {step === "confirm"
                    ? "Tashrif davomiyligini ko‘ring, keyin «Ha» bosing."
                    : "Izoh yozib «Tugatish» — filial yopiladi, keyingisini tanlashingiz mumkin."}
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-rose-100" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-100/80">
                Filial
              </p>
              <p className="truncate text-sm font-medium text-white">{branchLabel}</p>
              {checkInLabel ? (
                <p className="mt-0.5 text-[11px] text-rose-100/80">
                  Keldim: {checkInLabel}
                  {checklistLabel ? ` · Cheklist: ${checklistLabel}` : ""}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {step === "confirm" ? (
          <div className="space-y-3 bg-card px-5 py-5 sm:px-6">
            <div className="rounded-2xl border border-rose-200/80 bg-rose-50/90 px-4 py-4 dark:border-rose-500/30 dark:bg-rose-950/40">
              <div className="flex items-center gap-2 text-rose-900 dark:text-rose-100">
                <Clock3 className="h-5 w-5 shrink-0" />
                <p className="text-sm font-semibold">Tashrifda o‘tkazgan vaqt</p>
              </div>
              <p className="mt-2 text-3xl font-bold tabular-nums text-rose-800 dark:text-rose-200">
                {durationLine}
              </p>
              <ul className="mt-3 space-y-1 text-xs text-rose-900/80 dark:text-rose-200/80">
                <li>
                  Keldimdan beri: <strong className="tabular-nums">{durationLine}</strong>
                </li>
                {checklistLagMs != null ? (
                  <li>
                    Keldim → cheklist:{" "}
                    <strong className="tabular-nums">{formatDuration(checklistLagMs)}</strong>
                  </li>
                ) : null}
                {afterChecklistMs != null ? (
                  <li>
                    Cheklist saqlangandan beri:{" "}
                    <strong className="tabular-nums">{formatDuration(afterChecklistMs)}</strong>
                  </li>
                ) : null}
              </ul>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              «Ha» bosilgach izoh yozasiz, keyin «Tugatish» — tashrif yopiladi.
            </p>
          </div>
        ) : (
          <div className="space-y-3 bg-card px-5 py-5 sm:px-6">
            <div className="rounded-xl border border-border/80 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Jami vaqt: <strong className="text-foreground tabular-nums">{durationLine}</strong>
            </div>
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
                  "min-h-[120px] resize-y rounded-xl border-border/80 bg-muted/30 text-sm leading-relaxed focus-visible:ring-rose-500/30",
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
        )}

        <DialogFooter className="gap-2 border-t bg-muted/40 px-5 py-4 sm:flex-row sm:px-6">
          {step === "confirm" ? (
            <>
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
                disabled={submitting}
                onClick={() => setStep("note")}
                className="rounded-xl bg-rose-600 text-white hover:bg-rose-700"
              >
                Ha, Ketdim
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => setStep("confirm")}
                className="rounded-xl"
              >
                Orqaga
              </Button>
              <Button
                type="button"
                disabled={!canSubmit}
                onClick={() => void onFinish(trimmed)}
                className="rounded-xl bg-rose-700 hover:bg-rose-800"
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
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
