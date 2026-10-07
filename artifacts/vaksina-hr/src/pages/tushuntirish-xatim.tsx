import { useMemo, useState } from "react";
import { AlertTriangle, Ban, CalendarX2, CheckCircle2, Clock3, Eye, FileDown, FileSignature, Loader2, PenLine, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ExplanationLetterDialog, StatusChip } from "@/components/explanation-letter/ExplanationLetterDialog";
import { ReviewChip, StageBadge } from "@/components/explanation-letter/LetterReviewPanel";
import { StageLadder } from "@/components/explanation-letter/StageLadder";
import {
  FINAL_STRIKE,
  LETTER_STAGES,
  currentStage,
  downloadLetterPdf,
  fmtLetterDate,
  fmtLetterStamp,
  fmtSum,
  stageTone,
  useMyLetters,
  type ExplanationLetter,
} from "@/lib/explanation-letters-api";

const MONTHS_UZ = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];

function monthLabel(m: string) {
  const [y, mm] = m.split("-").map(Number);
  return y && mm ? `${MONTHS_UZ[mm - 1]} ${y}` : m;
}

function thisMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

const isOpen = (l: ExplanationLetter) => l.status !== "signed" && l.reviewStatus !== "cancelled";

export default function TushuntirishXatimPage() {
  const { toast } = useToast();
  const my = useMyLetters(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const items = my.data?.items ?? [];
  const month = thisMonth();
  const stage = currentStage(items, month);
  const monthItems = items.filter((l) => l.month === month && l.reviewStatus !== "cancelled");
  const monthSum = monthItems.reduce((s, l) => s + (l.amount || 0), 0);
  const open = items.filter(isOpen);
  const nextStep = monthItems.find((l) => Math.min(l.strikeN, FINAL_STRIKE) === stage)?.content.nextStep;

  const groups = useMemo(() => {
    const map = new Map<string, ExplanationLetter[]>();
    for (const l of items) map.set(l.month, [...(map.get(l.month) ?? []), l]);
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  const pdf = async (l: ExplanationLetter) => {
    setBusyId(l.id);
    try {
      await downloadLetterPdf(l);
    } catch (e) {
      toast({ title: "PDF", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-5 sm:py-6">
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0b3a5c] text-white shadow-sm shadow-sky-900/30">
          <FileSignature className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl dark:text-white">Tushuntirish xatim</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Kechikish va kelmaslik bo‘yicha barcha xatlaringiz — qachon, nima, qanday chora</p>
        </div>
      </header>

      {my.isLoading ? (
        <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
        </p>
      ) : my.isError ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{(my.error as Error).message}</p>
      ) : (
        <>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{monthLabel(month)} · joriy holat</p>
                <p className={cn("mt-0.5 text-lg font-extrabold", stage ? stageTone(stage).text : "text-emerald-700")}>
                  {stage ? `${stage}-bosqich — ${LETTER_STAGES[stage - 1]!.label}` : "Qoidabuzarlik yo‘q"}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Mini label="Bu oy" value={String(monthItems.length)} />
                <Mini label="Imzolanmagan" value={String(open.length)} warn={open.length > 0} />
                <Mini label="Jarima (bu oy)" value={monthSum ? fmtSum(monthSum) : "0"} />
              </div>
            </div>
            <StageLadder current={stage || undefined} />
            {stage >= FINAL_STRIKE ? (
              <div className="flex gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Siz oxirgi ogohlantirish bosqichidasiz. Holat yana takrorlansa — ishdan bo‘shatish uchun asos bo‘ladi.
              </div>
            ) : (
              <p className={cn("rounded-xl border px-3 py-2 text-xs font-semibold", stage ? stageTone(stage + 1).soft : "border-emerald-200 bg-emerald-50 text-emerald-900")}>
                ▶ {stage ? nextStep : "Bu oy hech qanday qoidabuzarlik yo‘q. Shunday davom eting!"}
              </p>
            )}
          </section>

          {open.length ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <b>{open.length} ta</b> xat imzolanmagan. Imzolanmaguncha keyingi davomat («Keldim») belgilanmaydi.
              </span>
              <Button type="button" className="h-9 gap-1.5 rounded-xl bg-[#0b3a5c] text-white hover:bg-[#0b3a5c]/90" onClick={() => setOpenId(open[open.length - 1]!.id)}>
                <PenLine className="h-4 w-4" /> To‘ldirish
              </Button>
            </div>
          ) : null}

          {!items.length ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500 dark:border-white/10">
              <ShieldCheck className="h-8 w-8 text-emerald-500" />
              Sizda hali tushuntirish xati yo‘q.
            </div>
          ) : (
            groups.map(([m, list]) => (
              <section key={m} className="space-y-2">
                <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                  {monthLabel(m)} · {list.length} ta xat
                </h2>
                <ol className="relative space-y-2 border-l-2 border-slate-200 pl-4 dark:border-white/10">
                  {list.map((l) => (
                    <TimelineItem key={l.id} l={l} busy={busyId === l.id} onOpen={() => setOpenId(l.id)} onPdf={() => void pdf(l)} />
                  ))}
                </ol>
              </section>
            ))
          )}
        </>
      )}

      <ExplanationLetterDialog letterId={openId} mode="employee" onClose={() => setOpenId(null)} />
    </div>
  );
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cn("rounded-xl px-2.5 py-1.5 ring-1", warn ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-slate-50 text-slate-800 ring-slate-200 dark:bg-white/5 dark:text-white dark:ring-white/10")}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</p>
      <p className="whitespace-nowrap text-sm font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

function TimelineItem({ l, busy, onOpen, onPdf }: { l: ExplanationLetter; busy: boolean; onOpen: () => void; onPdf: () => void }) {
  const stage = Math.min(l.strikeN, FINAL_STRIKE);
  const cancelled = l.reviewStatus === "cancelled";
  return (
    <li className="relative">
      <span className={cn("absolute -left-[1.4rem] top-3 h-3 w-3 rounded-full ring-4 ring-white dark:ring-slate-950", stageTone(stage).solid)} />
      <div
        className={cn(
          "rounded-2xl border bg-white p-3 shadow-sm dark:bg-slate-900",
          cancelled ? "border-slate-200 opacity-80 dark:border-white/10" : isOpen(l) ? "border-amber-200 dark:border-amber-500/30" : "border-slate-200 dark:border-white/10",
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-sm font-bold text-slate-900 dark:text-white">
            {l.kind === "late" ? <Clock3 className="h-4 w-4 text-amber-600" /> : <CalendarX2 className="h-4 w-4 text-red-600" />}
            {l.kind === "late" ? "Kechikish" : "Ishga kelmaslik"} · {fmtLetterDate(l.eventDate)}
          </span>
          <StageBadge n={l.strikeN} />
          <StatusChip status={l.status} />
          <ReviewChip status={l.reviewStatus} />
        </div>
        <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-300">
          {l.kind === "late"
            ? `Reja ${l.planStart ?? "—"}, keldi ${l.checkIn ?? "—"}${l.lateMinutes ? ` · ${l.lateMinutes} daqiqa kechikish` : ""}`
            : `Ish kuni ${l.planStart && l.planEnd ? `${l.planStart}–${l.planEnd}` : ""} — ishga chiqilmagan`}
          {l.branch ? ` · ${l.branch}` : ""}
        </p>
        <p className={cn("mt-1 text-[12px] font-semibold", cancelled ? "text-slate-500 line-through" : stageTone(stage).text)}>
          Chora: {l.content.penalty}
        </p>
        {l.reasonText ? <p className="mt-1.5 line-clamp-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] italic text-slate-600 dark:bg-white/5 dark:text-slate-300">«{l.reasonText}»</p> : null}
        {l.reviewStatus ? (
          <p className={cn("mt-1.5 flex items-start gap-1.5 text-[11.5px]", cancelled ? "text-slate-600 dark:text-slate-300" : "text-emerald-700 dark:text-emerald-300")}>
            {cancelled ? <Ban className="mt-px h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />}
            <span>
              {cancelled ? "Rahbariyat bekor qildi — jarima olib tashlandi" : "Rahbariyat tasdiqladi — jarima kuchida"}
              {l.reviewedAt ? ` · ${fmtLetterStamp(l.reviewedAt)}` : ""}
              {l.reviewNote ? ` · «${l.reviewNote}»` : ""}
            </span>
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[10.5px] text-slate-400">
            № {l.letterNo}
            {l.signedAt ? ` · imzolangan ${fmtLetterStamp(l.signedAt)}` : ""}
          </p>
          {isOpen(l) ? (
            <Button type="button" size="sm" className="h-8 gap-1 rounded-lg bg-[#0b3a5c] px-3 text-white hover:bg-[#0b3a5c]/90" onClick={onOpen}>
              <PenLine className="h-3.5 w-3.5" /> To‘ldirish
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1 rounded-lg px-3" onClick={onOpen}>
              <Eye className="h-3.5 w-3.5" /> Ochish
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 rounded-lg px-3" disabled={busy} onClick={onPdf}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} PDF
          </Button>
        </div>
      </div>
    </li>
  );
}
