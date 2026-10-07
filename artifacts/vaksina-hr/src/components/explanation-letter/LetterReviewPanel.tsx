import { useState } from "react";
import { Ban, CheckCircle2, Gavel, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  FINAL_STRIKE,
  fmtLetterStamp,
  fmtSum,
  useReviewLetter,
  type ExplanationLetter,
  type ReviewAction,
} from "@/lib/explanation-letters-api";

/** Rahbariyat qarori: tasdiqlash — jarima qoladi; bekor qilish — holat hisobdan chiqadi */
export function LetterReviewPanel({ letter: l, compact }: { letter: ExplanationLetter; compact?: boolean }) {
  const { toast } = useToast();
  const review = useReviewLetter();
  const [mode, setMode] = useState<"cancel" | null>(null);
  const [note, setNote] = useState("");
  const final = l.strikeN >= FINAL_STRIKE;
  const amount = l.amount > 0 ? fmtSum(l.amount) : null;

  const run = (action: ReviewAction) =>
    review.mutate(
      { id: l.id, action, note: action === "cancel" ? note.trim() : "" },
      {
        onSuccess: () => {
          setMode(null);
          setNote("");
          toast({
            title: action === "approve" ? "Tasdiqlandi" : action === "cancel" ? "Bekor qilindi" : "Qaror qaytarildi",
            description:
              action === "approve"
                ? "Jarima kuchida qoladi."
                : action === "cancel"
                  ? "Holat jarima hisobidan chiqarildi, keyingi bosqichlar qayta hisoblanadi."
                  : "Xat yana qaror kutilmoqda holatiga qaytdi.",
          });
        },
        onError: (e) => toast({ title: "Qaror saqlanmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );

  return (
    <div className={cn("space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-900", compact && "p-3")}>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900">
          <Gavel className="h-3.5 w-3.5" />
        </span>
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">Rahbariyat qarori</p>
          <p className="text-[11px] text-slate-500">Admin yoki HR hal qiladi</p>
        </div>
      </div>

      {l.reviewStatus ? (
        <div
          className={cn(
            "rounded-xl p-3 text-xs leading-relaxed ring-1",
            l.reviewStatus === "approved"
              ? "bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-500/30"
              : "bg-slate-100 text-slate-800 ring-slate-300 dark:bg-white/5 dark:text-slate-100 dark:ring-white/15",
          )}
        >
          <p className="flex items-center gap-1.5 text-sm font-bold">
            {l.reviewStatus === "approved" ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
            {l.reviewStatus === "approved" ? "Tasdiqlangan — jarima kuchida" : "Bekor qilingan — holat hisobdan chiqarilgan"}
          </p>
          <p className="mt-1">
            {l.reviewedByName || "Admin"} · {fmtLetterStamp(l.reviewedAt)}
          </p>
          {l.reviewNote ? <p className="mt-1 italic">«{l.reviewNote}»</p> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-8 gap-1.5 rounded-lg bg-white text-xs dark:bg-slate-950"
            disabled={review.isPending}
            onClick={() => run("reset")}
          >
            {review.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Qarorni qaytarish
          </Button>
        </div>
      ) : (
        <>
          <ul className="space-y-1.5 text-[11.5px] leading-snug text-slate-600 dark:text-slate-300">
            <li className="flex gap-1.5">
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span>
                <b className="text-slate-800 dark:text-white">Tasdiqlash</b> — sabab uzrli emas, jarima
                {amount ? ` (${amount})` : ""} oylikda qoladi{final ? ", oxirgi ogohlantirish kuchga kiradi" : ""}.
              </span>
            </li>
            <li className="flex gap-1.5">
              <Ban className="mt-px h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span>
                <b className="text-slate-800 dark:text-white">Bekor qilish</b> — sabab uzrli. Holat jarimadan chiqariladi, keyingi
                holatlar bir bosqich pastga tushadi. Tasdiqlangan (yopilgan) oylik o‘zgarmaydi.
              </span>
            </li>
          </ul>

          {mode === "cancel" ? (
            <div className="space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={3}
                autoFocus
                placeholder="Bekor qilish sababi (majburiy)"
                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-10 flex-1 rounded-xl" onClick={() => setMode(null)} disabled={review.isPending}>
                  Ortga
                </Button>
                <Button
                  type="button"
                  className="h-10 flex-1 gap-1.5 rounded-xl bg-slate-800 text-white hover:bg-slate-900"
                  disabled={note.trim().length < 10 || review.isPending}
                  onClick={() => run("cancel")}
                >
                  {review.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                  Bekor qilish
                </Button>
              </div>
              {note.trim().length < 10 ? <p className="text-[11px] text-slate-400">Kamida 10 belgi yozing</p> : null}
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                type="button"
                className="h-10 flex-1 gap-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={l.status !== "signed" || review.isPending}
                onClick={() => run("approve")}
              >
                {review.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Tasdiqlash
              </Button>
              <Button type="button" variant="outline" className="h-10 flex-1 gap-1.5 rounded-xl" onClick={() => setMode("cancel")}>
                <Ban className="h-4 w-4" /> Bekor qilish
              </Button>
            </div>
          )}
          {l.status !== "signed" && mode !== "cancel" ? (
            <p className="text-[11px] text-slate-400">Tasdiqlash xodim imzolagandan keyin ochiladi. Bekor qilish istalgan vaqtda mumkin.</p>
          ) : null}
        </>
      )}
    </div>
  );
}

export function ReviewChip({ status }: { status?: ExplanationLetter["reviewStatus"] }) {
  if (!status) return null;
  return status === "approved" ? (
    <span className="whitespace-nowrap rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">Tasdiqlangan</span>
  ) : (
    <span className="whitespace-nowrap rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-bold text-white">Bekor qilingan</span>
  );
}

export function StageBadge({ n }: { n: number }) {
  const final = n >= FINAL_STRIKE;
  const tone =
    n <= 1
      ? "bg-blue-100 text-blue-800"
      : n <= 3
        ? "bg-amber-100 text-amber-800"
        : n === 4
          ? "bg-orange-100 text-orange-800"
          : n === 5
            ? "bg-red-100 text-red-800"
            : "bg-rose-900 text-white";
  return (
    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold", tone)}>
      {final ? `${n}-holat · oxirgi` : `${n}-holat`}
    </span>
  );
}
