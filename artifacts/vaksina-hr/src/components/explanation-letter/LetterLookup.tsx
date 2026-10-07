import { useState, type ReactNode } from "react";
import { AlertTriangle, BadgeCheck, Ban, Eye, FileDown, Loader2, QrCode, ScanSearch, ShieldX } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QrScanDialog } from "@/components/QrScanDialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { StatusChip, TestChip } from "./ExplanationLetterDialog";
import { ReviewChip, StageBadge } from "./LetterReviewPanel";
import {
  FINAL_STRIKE,
  LETTER_STAGES,
  downloadLetterPdf,
  fmtLetterDate,
  fmtLetterStamp,
  fmtSum,
  formatLetterNoInput,
  lookupLetter,
  type ExplanationLetter,
  type LetterLookup,
} from "@/lib/explanation-letters-api";

const NO_RE = /^[A-Z]{4}-\d{5}$/;

/** «Tushuntirish xatlari» bo‘limi: QR skaner yoki hujjat raqami bo‘yicha bazadan haqiqiylikni tekshirish */
export function LetterLookupBar({ onOpenLetter }: { onOpenLetter: (id: number) => void }) {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [result, setResult] = useState<LetterLookup | null>(null);

  const check = async () => {
    const q = value.trim();
    if (!NO_RE.test(q)) {
      toast({ title: "Raqam noto‘g‘ri", description: "Hujjat raqami 4 ta harf va 5 ta raqamdan iborat: masalan ABCD-12345", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      setResult(await lookupLetter(q));
    } catch (e) {
      toast({ title: "Tekshirib bo‘lmadi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const onScan = async (payload: string) => {
    const r = await lookupLetter(payload).catch(() => {
      throw new Error("Bu QR tushuntirish xatiga tegishli emas — xatdagi QR kodni skanerlang");
    });
    if (r.found) setValue(r.letter.letterNo);
    setResult(r);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-900">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-2.5 lg:w-[34%]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30">
            <ScanSearch className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white">Hujjatni tekshirish</p>
            <p className="text-[11px] leading-snug text-slate-500">
              QR kodni skanerlang yoki hujjat raqamini yozing — bazada bor-yo‘qligi va haqiqiyligi darhol ko‘rsatiladi
            </p>
          </div>
        </div>
        <form
          className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <Button
            type="button"
            className="h-11 shrink-0 gap-2 rounded-xl bg-emerald-600 px-4 font-semibold text-white hover:bg-emerald-700"
            onClick={() => setScanOpen(true)}
          >
            <QrCode className="h-4 w-4" />
            Skaner qilish
          </Button>
          <div className="flex min-w-0 flex-1 gap-2">
            <input
              value={value}
              onChange={(e) => setValue(formatLetterNoInput(e.target.value).slice(0, 10))}
              placeholder="Hujjat raqami: ABCD-12345"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              aria-label="Hujjat raqami"
              className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 font-mono text-[15px] font-bold uppercase tracking-[0.12em] text-slate-900 outline-none placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:normal-case placeholder:tracking-normal focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:focus:ring-sky-500/20"
            />
            <Button
              type="submit"
              className="h-11 shrink-0 gap-1.5 rounded-xl bg-[#0b3a5c] px-4 font-semibold text-white hover:bg-[#0b3a5c]/90"
              disabled={busy || !value.trim()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              Tekshirish
            </Button>
          </div>
        </form>
      </div>

      <QrScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Tushuntirish xatini tekshirish"
        description="Tushuntirish xatidagi QR kodni ramka ichiga tuting — avtomatik o‘qiladi"
        onDetected={onScan}
      />
      <LookupResultDialog
        result={result}
        onClose={() => setResult(null)}
        onOpen={(id) => {
          setResult(null);
          onOpenLetter(id);
        }}
      />
    </section>
  );
}

type Verdict = { tone: "ok" | "warn" | "bad"; title: string; text: string };

function verdictOf(r: LetterLookup): Verdict {
  if (!r.found) {
    if (r.deleted) {
      return {
        tone: "bad",
        title: "Hujjat bazada yo‘q — o‘chirilgan",
        text: `«${r.query}» raqami${r.issuedAt ? ` ${fmtLetterStamp(r.issuedAt)} da` : ""} berilgan, lekin xat keyinchalik bazadan o‘chirilgan. Bu hujjat kuchga ega emas.`,
      };
    }
    return {
      tone: "bad",
      title: "Hujjat bazada topilmadi — haqiqiy emas",
      text:
        r.by === "qr"
          ? "QR koddagi hujjat tizimda ro‘yxatdan o‘tmagan. Hujjat soxta yoki boshqa tizimga tegishli."
          : `«${r.query}» raqamli tushuntirish xati tizimda hech qachon ro‘yxatdan o‘tmagan. Hujjat soxta yoki raqam noto‘g‘ri yozilgan.`,
    };
  }
  const l = r.letter;
  if (l.status === "signed" && l.reviewStatus === "cancelled") {
    return {
      tone: "warn",
      title: "Hujjat haqiqiy, lekin bekor qilingan",
      text: "Bazada mavjud va xodim imzolagan. Rahbariyat holatni uzrli deb topib bekor qilgan — jarima qo‘llanmaydi.",
    };
  }
  if (l.status === "signed") {
    return {
      tone: "ok",
      title: "Haqiqiy hujjat — bazada mavjud",
      text:
        l.reviewStatus === "approved"
          ? "Xodim shaxsan o‘qib, sababini yozib imzolagan. Rahbariyat tasdiqlagan — hujjat va jarima kuchda."
          : "Xodim shaxsan o‘qib, sababini yozib imzolagan. Hujjat kuchda, rahbariyat qarori kutilmoqda.",
    };
  }
  return {
    tone: "warn",
    title: "Bazada bor, lekin hali imzolanmagan",
    text: "Xat tizimda yaratilgan, ammo xodim hali sababini yozib imzolamagan — hujjat kuchga kirmagan.",
  };
}

const TONE = {
  ok: { box: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100", icon: "bg-emerald-600 text-white", Icon: BadgeCheck },
  warn: { box: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100", icon: "bg-amber-500 text-white", Icon: AlertTriangle },
  bad: { box: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100", icon: "bg-rose-600 text-white", Icon: ShieldX },
} as const;

function eventText(l: ExplanationLetter) {
  if (l.kind === "absent") return `Ishga kelmagan${l.planStart && l.planEnd ? ` · ish vaqti ${l.planStart}–${l.planEnd}` : ""}`;
  const parts = [l.planStart ? `reja ${l.planStart}` : null, l.checkIn ? `keldi ${l.checkIn}` : null, l.lateMinutes ? `${l.lateMinutes} daqiqa` : null];
  return `Kechikish · ${parts.filter(Boolean).join(" · ")}`;
}

function LookupResultDialog({
  result,
  onClose,
  onOpen,
}: {
  result: LetterLookup | null;
  onClose: () => void;
  onOpen: (id: number) => void;
}) {
  const { toast } = useToast();
  const [pdfBusy, setPdfBusy] = useState(false);
  if (!result) return null;
  const v = verdictOf(result);
  const tone = TONE[v.tone];
  const l = result.found ? result.letter : null;

  const pdf = async () => {
    if (!l) return;
    setPdfBusy(true);
    try {
      await downloadLetterPdf(l);
    } catch (e) {
      toast({ title: "PDF", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94dvh] w-[calc(100vw-1rem)] max-w-xl gap-4 overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="text-base sm:text-lg">Hujjat tekshiruvi natijasi</DialogTitle>
          <DialogDescription className="text-xs">
            {result.by === "qr" ? "QR kod orqali" : "Hujjat raqami orqali"} bazadan tekshirildi
            {result.query ? (
              <>
                {" · "}
                <span className="font-mono font-bold tracking-wider text-slate-700 dark:text-slate-200">№ {result.query}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className={cn("flex items-start gap-3 rounded-2xl border p-3.5", tone.box)}>
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tone.icon)}>
            <tone.Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-extrabold leading-snug">{v.title}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed opacity-90">{v.text}</p>
          </div>
        </div>

        {l ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusChip status={l.status} />
              <ReviewChip status={l.reviewStatus} />
              <StageBadge n={l.strikeN} />
              {l.strikeN >= FINAL_STRIKE ? (
                <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">Oxirgi xat</span>
              ) : null}
              {l.isTest ? <TestChip /> : null}
            </div>
            {l.isTest ? (
              <p className="rounded-xl bg-violet-50 px-3 py-2 text-[12px] text-violet-800 dark:bg-violet-500/10 dark:text-violet-200">
                Bu test xati — haqiqiy jarima va oylikka ta’sir qilmaydi.
              </p>
            ) : null}

            <dl className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 text-[13px] dark:divide-white/5 dark:border-white/10">
              <Row label="Hujjat raqami">
                <span className="font-mono font-bold tracking-wider">№ {l.letterNo}</span>
              </Row>
              <Row label="Xodim">
                <span className="font-semibold">{l.fullName}</span>
                <span className="block text-[11px] text-slate-500">{[l.position, l.phone].filter(Boolean).join(" · ") || "—"}</span>
              </Row>
              <Row label="Filial · smena">{[l.branch, l.shift].filter(Boolean).join(" · ") || "—"}</Row>
              <Row label="Holat">
                <span className="font-semibold">{fmtLetterDate(l.eventDate)}</span>
                <span className="block text-[11px] text-slate-500">{eventText(l)}</span>
              </Row>
              <Row label="Bosqich · chora">
                {l.strikeN}-holat · {LETTER_STAGES[Math.min(l.strikeN, FINAL_STRIKE) - 1]?.label}
                {l.amount > 0 ? <span className="block text-[11px] font-semibold text-rose-700 dark:text-rose-300">Jarima: {fmtSum(l.amount)}</span> : null}
              </Row>
              <Row label="Asos (xodim yozgan sabab)">
                {l.reasonText ? (
                  <span className="whitespace-pre-wrap leading-relaxed">{l.reasonText}</span>
                ) : (
                  <span className="italic text-slate-400">Hali yozilmagan</span>
                )}
              </Row>
              <Row label="Imzolangan">{l.signedAt ? fmtLetterStamp(l.signedAt) : <span className="text-slate-400">Imzolanmagan</span>}</Row>
              {l.finalConsentAt ? <Row label="Oxirgi ogohlantirishga rozilik">{fmtLetterStamp(l.finalConsentAt)}</Row> : null}
              <Row label="Rahbariyat qarori">
                {l.reviewStatus ? (
                  <>
                    <span className="font-semibold">{l.reviewStatus === "approved" ? "Tasdiqlangan" : "Bekor qilingan"}</span>
                    <span className="block text-[11px] text-slate-500">
                      {[l.reviewedByName, l.reviewedAt ? fmtLetterStamp(l.reviewedAt) : null].filter(Boolean).join(" · ")}
                    </span>
                    {l.reviewNote ? <span className="mt-0.5 block text-[12px] italic text-slate-600 dark:text-slate-300">«{l.reviewNote}»</span> : null}
                  </>
                ) : (
                  <span className="text-slate-400">Qaror qabul qilinmagan</span>
                )}
              </Row>
            </dl>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" className="h-11 gap-2 rounded-xl bg-[#0b3a5c] text-white hover:bg-[#0b3a5c]/90" onClick={() => onOpen(l.id)}>
                <Eye className="h-4 w-4" />
                Xatni to‘liq ochish
              </Button>
              <Button type="button" variant="outline" className="h-11 gap-2 rounded-xl" disabled={pdfBusy} onClick={() => void pdf()}>
                {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                PDF yuklab olish
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[12px] leading-relaxed text-slate-600 dark:bg-white/5 dark:text-slate-300">
            <Ban className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            Raqamni hujjatdan qayta solishtiring: u 4 ta harf va 5 ta raqamdan iborat (masalan ABCD-12345). QR kod bo‘lsa, «Skaner
            qilish» orqali tekshirish ishonchliroq.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,38%)_minmax(0,1fr)] gap-3 px-3 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-800 dark:text-slate-100">{children}</dd>
    </div>
  );
}
