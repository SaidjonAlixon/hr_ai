import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Ban,
  CalendarX2,
  CheckCircle2,
  Clock3,
  Eraser,
  FileDown,
  FileSignature,
  Loader2,
  Lock,
  MapPin,
  PenLine,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { qrPngDataUrl } from "@/lib/qr-render";
import {
  FINAL_STRIKE,
  REASON_MAX,
  REASON_MIN,
  REASON_MIN_WORDS,
  downloadLetterPdf,
  fmtLetterDate,
  fmtLetterStamp,
  fmtSum,
  letterVerifyUrl,
  reasonProblem,
  reasonWords,
  useConfirmLetter,
  useLetter,
  useSignLetter,
  type ExplanationLetter,
} from "@/lib/explanation-letters-api";
import { LetterSheet } from "./LetterSheet";
import { LetterReviewPanel, ReviewChip, StageBadge } from "./LetterReviewPanel";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";

type Props = {
  letterId: number | null;
  onClose: () => void;
  /** admin — faqat ko‘rish va PDF; employee — tasdiqlash va imzolash */
  mode: "employee" | "admin";
  /** Avtomatik chiqqan oynada «Keyinroq» tugmasi */
  onSnooze?: () => void;
};

const STEPS = [
  { n: 1, label: "O‘qish va sabab" },
  { n: 2, label: "Tasdiqlash · QR" },
  { n: 3, label: "Imzo" },
] as const;

export function ExplanationLetterDialog({ letterId, onClose, mode, onSnooze }: Props) {
  const { toast } = useToast();
  const q = useLetter(letterId);
  const l = q.data;
  const employee = mode === "employee";
  const confirm = useConfirmLetter();
  const sign = useSignLetter();
  const padRef = useRef<SignaturePadHandle>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const [text, setText] = useState("");
  const [agree, setAgree] = useState(false);
  const [finalAgree, setFinalAgree] = useState(false);
  const [pasteWarn, setPasteWarn] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [padEmpty, setPadEmpty] = useState(true);
  const [localSig, setLocalSig] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setText("");
    setAgree(false);
    setFinalAgree(false);
    setPasteWarn(false);
    setQr(null);
    setSignOpen(false);
    setLocalSig(null);
  }, [letterId]);

  const token = l?.verifyToken ?? null;
  useEffect(() => {
    if (!token || l?.qrPng) return;
    let alive = true;
    void qrPngDataUrl(letterVerifyUrl(token), 360).then((png) => alive && setQr(png));
    return () => {
      alive = false;
    };
  }, [token, l?.qrPng]);

  const step = !l ? 1 : l.status === "signed" ? 4 : l.status === "confirmed" ? 3 : 1;
  const cleanLen = text.trim().replace(/\s+/g, " ").length;
  const words = reasonWords(text);
  const problem = reasonProblem(text);
  const final = !!l && l.strikeN >= FINAL_STRIKE;
  const cancelled = l?.reviewStatus === "cancelled";
  const canFill = employee && !!l && l.status === "pending" && !cancelled;
  const canConfirm = !problem && agree && (!final || finalAgree);
  const missing = problem ? "reason" : !agree ? "agree" : final && !finalAgree ? "final" : null;

  const doConfirm = () => {
    if (!l || !canConfirm) return;
    confirm.mutate(
      { id: l.id, reasonText: text.trim().replace(/\s+/g, " "), finalConsent: final && finalAgree },
      {
        onSuccess: () => setSignOpen(true),
        onError: (e) => toast({ title: "Tasdiqlanmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );
  };

  const doSign = () => {
    if (!l) return;
    const png = padRef.current?.toPng();
    if (!png) {
      toast({ title: "Imzo chizilmagan", description: "Avval maydonga imzoingizni chizing.", variant: "destructive" });
      return;
    }
    sign.mutate(
      { id: l.id, signature: png, qr },
      {
        onSuccess: () => {
          setLocalSig(png);
          setSignOpen(false);
          toast({ title: "Tushuntirish xati imzolandi", description: "Xat saqlandi. PDF nusxasini yuklab olishingiz mumkin." });
        },
        onError: (e) => toast({ title: "Imzolanmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );
  };

  const pdf = async () => {
    if (!l) return;
    setDownloading(true);
    try {
      await downloadLetterPdf(l);
    } catch (e) {
      toast({ title: "PDF", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  const qrShown = l?.qrPng ?? (l && l.status !== "pending" ? qr : null);
  const sigShown = l?.signaturePng ?? localSig;
  const draft = l && l.status === "pending" && text.trim() ? `Mazkur holat quyidagi sabab bilan yuz berdi: ${text.trim()}` : null;

  return (
    <Dialog open={letterId != null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[94vh] sm:max-h-[94vh] sm:w-[calc(100vw-2rem)] sm:max-w-6xl sm:rounded-2xl sm:border">
        <DialogHeader className="space-y-1 border-b border-slate-100 bg-gradient-to-r from-sky-50 via-white to-white px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] text-left sm:px-5 sm:pt-4 dark:border-white/10 dark:from-sky-500/10 dark:via-slate-900 dark:to-slate-900">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-base sm:text-lg">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#0b3a5c] text-white">
              <FileSignature className="h-4 w-4" />
            </span>
            {final ? "Oxirgi tushuntirish xati" : "Tushuntirish xati"}
            {l ? <StatusChip status={l.status} /> : null}
            {l ? <StageBadge n={l.strikeN} /> : null}
            <ReviewChip status={l?.reviewStatus} />
            {l?.isTest ? <TestChip /> : null}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {l ? (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{l.fullName}</span>
                {l.amount > 0 ? <span>· jarima {fmtSum(l.amount)}</span> : null}
                <span className="inline-flex items-center gap-1">
                  · {l.kind === "late" ? <Clock3 className="h-3 w-3" /> : <CalendarX2 className="h-3 w-3" />}
                  {l.kind === "late" ? "Kechikish" : "Kelmagan"} {fmtLetterDate(l.eventDate)}
                </span>
                {l.branch ? (
                  <span className="inline-flex items-center gap-1">
                    · <MapPin className="h-3 w-3" />
                    {l.branch}
                  </span>
                ) : null}
              </span>
            ) : (
              "Yuklanmoqda…"
            )}
          </DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
          </div>
        ) : q.isError || !l ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-red-600">
            {(q.error as Error | null)?.message || "Xat topilmadi"}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
            <div className="min-h-0 overflow-y-auto overscroll-contain bg-slate-100/80 p-3 sm:p-5 dark:bg-slate-950">
              <div className="mx-auto max-w-[794px]">
                <LetterSheet
                  content={l.content}
                  qrPng={qrShown}
                  signaturePng={sigShown}
                  reasonDraft={draft}
                  highlightSignature={employee && l.status === "confirmed"}
                />
              </div>
              {canFill ? (
                <div ref={formRef} className="mx-auto mt-4 max-w-[794px] scroll-mt-3 lg:hidden">
                  {renderReasonForm()}
                </div>
              ) : null}
              {!employee ? (
                <div className="mx-auto mt-4 max-w-[794px] lg:hidden">
                  <LetterReviewPanel letter={l} />
                </div>
              ) : null}
            </div>

            <aside className="hidden min-h-0 flex-col border-l border-slate-100 bg-white lg:flex dark:border-white/10 dark:bg-slate-900">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                <Stepper step={step} />
                {canFill ? renderReasonForm() : <SideInfo letter={l} employee={employee} />}
                {!employee ? <LetterReviewPanel letter={l} /> : null}
              </div>
              <div className="border-t border-slate-100 p-4 dark:border-white/10">
                {renderActions()}
              </div>
            </aside>

            <div className="border-t border-slate-100 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden dark:border-white/10 dark:bg-slate-900">
              {renderActions()}
            </div>
          </div>
        )}

        <Dialog open={signOpen} onOpenChange={(v) => !sign.isPending && setSignOpen(v)}>
          <DialogContent className="w-[calc(100vw-1rem)] max-w-xl gap-3 rounded-2xl p-4 sm:p-6">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="flex items-center gap-2 text-base">
                <PenLine className="h-4 w-4 text-sky-600" /> Imzo qo‘yish
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed">
                Xat tasdiqlandi va QR kod qo‘yildi. Endi pastdagi maydonga imzoingizni chizing — u tushuntirish xatidagi
                «(imzo)» qatoriga joylashtiriladi.
              </DialogDescription>
            </DialogHeader>
            <SignaturePad ref={padRef} onChange={setPadEmpty} className="h-[min(15rem,42vh)] sm:h-60" />
            <p className="text-[11px] leading-relaxed text-slate-500">
              «Imzoni tasdiqlash» tugmasini bosish orqali {l?.fullName ? <b>{l.fullName}</b> : "siz"} ushbu xatni o‘qib
              chiqqaningizni va rozilik bilan imzolaganingizni tasdiqlaysiz. Imzo vaqti va qurilma ma’lumoti saqlanadi.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" className="gap-1.5 rounded-xl" onClick={() => padRef.current?.clear()} disabled={sign.isPending}>
                <Eraser className="h-4 w-4" /> Tozalash
              </Button>
              <Button
                type="button"
                className="gap-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={padEmpty || sign.isPending}
                onClick={doSign}
              >
                {sign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Imzoni tasdiqlash
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );

  function renderReasonForm() {
    const amount = l && l.amount > 0 ? fmtSum(l.amount) : null;
    return (
      <div className="space-y-3">
        {final ? (
          <div className="rounded-2xl border border-rose-300 bg-rose-50 p-3.5 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
            <p className="flex items-center gap-1.5 text-sm font-extrabold">
              <AlertTriangle className="h-4 w-4" /> Oxirgi tushuntirish xati
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[11.5px] leading-snug">
              <li>Bu oy davomida {l?.strikeN}-marta qoidabuzarlik — oxirgi (yakuniy) ogohlantirish.</li>
              <li>1 oylik ish haqining 50% jarima{amount ? `: ${amount}` : ""}.</li>
              <li>Yana takrorlansa — ishdan bo‘shatish uchun asos bo‘ladi.</li>
            </ul>
          </div>
        ) : null}

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">Sababni o‘zingiz yozing</p>
            <p className="text-[11px] leading-snug text-slate-500">
              Nima bo‘lganini aniq, o‘z so‘zlaringiz bilan yozing: qachon, nima sababdan va kimni ogohlantirganingiz. Matn xatga
              aynan shunday tushadi. Nusxa ko‘chirib qo‘yish o‘chirilgan.
            </p>
          </div>
          <div>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value.slice(0, REASON_MAX + 50));
                setPasteWarn(false);
              }}
              onPaste={(e) => {
                e.preventDefault();
                setPasteWarn(true);
              }}
              onDrop={(e) => e.preventDefault()}
              rows={5}
              autoComplete="off"
              spellCheck
              lang="uz"
              placeholder="Sababni shu yerga yozing…"
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:focus:ring-sky-500/20"
            />
            <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] tabular-nums">
              <span className={cn(problem && text.trim() ? "text-amber-700 dark:text-amber-300" : "text-emerald-600")}>
                {pasteWarn ? "Nusxa qo‘yib bo‘lmaydi — qo‘lda yozing" : text.trim() ? problem ?? "Yaxshi — sabab yetarli" : ""}
              </span>
              <span className={cn(cleanLen > REASON_MAX ? "text-red-600" : "text-slate-400")}>
                {words}/{REASON_MIN_WORDS} so‘z · {cleanLen}/{REASON_MIN}+ belgi
              </span>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:bg-white/5 dark:text-slate-300">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#0b3a5c]" />
            Tushuntirish xatini to‘liq o‘qib chiqdim. Undagi ma’lumotlar to‘g‘ri, takrorlansa bosqichlarda ko‘rsatilgan jarima va
            intizomiy jazo qo‘llanilishiga roziman.
          </label>
          {final ? (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-rose-50 p-3 text-xs font-semibold leading-relaxed text-rose-900 ring-1 ring-rose-300 dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-500/40">
              <input
                type="checkbox"
                checked={finalAgree}
                onChange={(e) => setFinalAgree(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-rose-700"
              />
              Bu oxirgi ogohlantirish ekanini tushunaman. Holat yana takrorlansa, mehnat shartnomasi bekor qilinishiga (ishdan
              bo‘shatilishimga) roziman.
            </label>
          ) : null}
        </div>
      </div>
    );
  }

  function renderActions() {
    if (!l) return null;
    const pdfBtn = (
      <Button type="button" variant="outline" className="h-11 flex-1 gap-1.5 rounded-xl" disabled={downloading} onClick={() => void pdf()}>
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        PDF
      </Button>
    );
    if (!employee || l.status === "signed" || cancelled) {
      return (
        <div className="flex gap-2">
          {pdfBtn}
          {l.status === "signed" && l.verifyToken ? (
            <Button asChild type="button" variant="outline" className="h-11 flex-1 gap-1.5 rounded-xl">
              <a href={`/tx/${l.verifyToken}`} target="_blank" rel="noreferrer">
                <QrCode className="h-4 w-4" /> Tekshirish
              </a>
            </Button>
          ) : null}
          <Button type="button" className="h-11 flex-1 rounded-xl" variant="secondary" onClick={onClose}>
            Yopish
          </Button>
        </div>
      );
    }
    const gate = (
      <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30">
        <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
        Xat imzolanmaguncha keyingi davomat («Keldim») belgilanmaydi.
      </p>
    );
    if (l.status === "confirmed") {
      return (
        <div className="space-y-2">
          {gate}
          <Button
            type="button"
            className="h-12 w-full gap-2 rounded-xl bg-emerald-600 text-base font-bold text-white hover:bg-emerald-700"
            onClick={() => setSignOpen(true)}
          >
            <PenLine className="h-5 w-5" /> Imzo qo‘yish
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {gate}
        {missing ? (
          <button
            type="button"
            onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-sky-300 bg-sky-50 py-2 text-xs font-bold text-sky-800 lg:hidden dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200"
          >
            <ArrowDown className="h-3.5 w-3.5" /> {missing === "reason" ? "Sababni yozish" : "Rozilik belgisini qo‘yish"}
          </button>
        ) : null}
        <Button
          type="button"
          className={cn(
            "h-12 w-full gap-2 rounded-xl text-base font-bold text-white",
            final ? "bg-rose-800 hover:bg-rose-900" : "bg-[#0b3a5c] hover:bg-[#0b3a5c]/90",
          )}
          disabled={!canConfirm || confirm.isPending}
          onClick={doConfirm}
        >
          {confirm.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
          {final ? "Roziman va tasdiqlayman" : "Tasdiqlash"}
        </Button>
        {missing ? (
          <p className="hidden text-center text-[11px] text-slate-500 lg:block">
            {missing === "reason"
              ? `Sababni qo‘lda yozing: kamida ${REASON_MIN_WORDS} so‘z, ${REASON_MIN} belgi`
              : missing === "agree"
                ? "Rozilik belgisini qo‘ying"
                : "Ishdan bo‘shatish sharti bilan roziligingizni belgilang"}
          </p>
        ) : null}
        {onSnooze ? (
          <button type="button" onClick={onSnooze} className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">
            Keyinroq to‘ldiraman
          </button>
        ) : null}
      </div>
    );
  }
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5">
      {STEPS.map((s, i) => {
        const done = step > s.n;
        const active = step === s.n;
        return (
          <li key={s.n} className="flex flex-1 items-center gap-1.5">
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                done ? "bg-emerald-600 text-white" : active ? "bg-[#0b3a5c] text-white ring-4 ring-sky-100 dark:ring-sky-500/20" : "bg-slate-100 text-slate-400 dark:bg-white/10",
              )}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : s.n}
            </span>
            <span className={cn("text-[11px] font-semibold leading-tight", active ? "text-slate-900 dark:text-white" : "text-slate-400")}>{s.label}</span>
            {i < STEPS.length - 1 ? <span className={cn("h-px flex-1", done ? "bg-emerald-400" : "bg-slate-200 dark:bg-white/10")} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function SideInfo({ letter: l, employee }: { letter: ExplanationLetter; employee: boolean }) {
  if (l.reviewStatus === "cancelled" && employee) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-800 ring-1 ring-slate-300 dark:bg-white/5 dark:text-slate-100 dark:ring-white/15">
          <p className="flex items-center gap-2 font-bold">
            <Ban className="h-5 w-5" /> Rahbariyat bekor qildi
          </p>
          <p className="mt-1 text-xs leading-relaxed">
            Bu holat jarima hisobidan chiqarildi{l.reviewNote ? `: «${l.reviewNote}»` : "."}
          </p>
        </div>
        <InfoRows l={l} />
      </div>
    );
  }
  if (l.status === "signed") {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-500/30">
          <p className="flex items-center gap-2 font-bold">
            <CheckCircle2 className="h-5 w-5" /> Imzolangan va saqlangan
          </p>
          <p className="mt-1 text-xs leading-relaxed">
            {fmtLetterStamp(l.signedAt)} da elektron imzo qo‘yildi. Hujjat № {l.letterNo}.
          </p>
        </div>
        <InfoRows l={l} />
      </div>
    );
  }
  if (l.status === "confirmed") {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-sky-50 p-4 text-sm text-sky-900 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
          <p className="flex items-center gap-2 font-bold">
            <QrCode className="h-5 w-5" /> Tasdiqlandi — QR qo‘yildi
          </p>
          <p className="mt-1 text-xs leading-relaxed">
            {employee ? "Oxirgi qadam: «Imzo qo‘yish» tugmasini bosib, imzoingizni chizing." : "Xodim imzo qo‘yishi kutilmoqda."}
          </p>
        </div>
        <InfoRows l={l} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30">
        <p className="font-bold">Xodim hali to‘ldirmagan</p>
        <p className="mt-1 text-xs leading-relaxed">Xat xodimning akkauntida chiqib turibdi. U sababni yozib, imzolagach shu yerda ko‘rinadi.</p>
      </div>
      <InfoRows l={l} />
    </div>
  );
}

function InfoRows({ l }: { l: ExplanationLetter }) {
  const rows: [string, string][] = [
    ["Xodim", l.fullName],
    ["Lavozim", l.position || "—"],
    ["Filial", l.branch || "—"],
    ["Smena", l.shift || "—"],
    ["Holat", l.kind === "late" ? `Kechikish${l.checkIn ? ` · ${l.checkIn} da keldi` : ""}${l.lateMinutes ? ` (${l.lateMinutes} daq.)` : ""}` : "Ishga kelmagan"],
    ["Sana", fmtLetterDate(l.eventDate)],
    ["Qoidabuzarlik", `${l.strikeN}-marta (joriy oy)`],
    ["Chora", l.content.penalty],
  ];
  if (l.finalConsentAt) rows.push(["Ishdan bo‘shatishga rozilik", fmtLetterStamp(l.finalConsentAt)]);
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-slate-100 rounded-2xl border border-slate-200 text-xs dark:divide-white/5 dark:border-white/10">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 px-3 py-2">
            <dt className="shrink-0 text-slate-500">{k}</dt>
            <dd className="text-right font-semibold text-slate-800 dark:text-slate-100">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-semibold leading-snug text-slate-600 dark:bg-white/5 dark:text-slate-300">
        ▶ {l.content.nextStep}
      </p>
    </div>
  );
}

export function StatusChip({ status }: { status: ExplanationLetter["status"] }) {
  const map = {
    pending: ["Kutilmoqda", "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"],
    confirmed: ["Imzo kutilmoqda", "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200"],
    signed: ["Imzolangan", "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"],
  } as const;
  const [label, tone] = map[status];
  return <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold", tone)}>{label}</span>;
}

export function TestChip() {
  return (
    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">
      TEST
    </span>
  );
}
