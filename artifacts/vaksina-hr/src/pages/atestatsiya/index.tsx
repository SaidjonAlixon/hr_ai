import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Award,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FileDown,
  ListChecks,
  Loader2,
  MapPin,
  PencilRuler,
  Play,
  RotateCcw,
  Send,
  ShieldAlert,
  Timer,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { canLearnDarsliklar, canManageDarsliklar } from "@/lib/roles";
import {
  ATTESTATSIYA_TRACKS,
  ATTEST_STATUS_LABEL,
  formatAttestDt,
  readGps,
  saveAttestProgress,
  scoreAttestPreview,
  startAttestPreview,
  submitAttest,
  useAttestMe,
  useStartAttest,
  type AttestExamCard,
  type AttestLearnerAttempt,
  type AttestReviewItem,
  type AttestTrack,
} from "@/lib/atestatsiya-api";

function printAttemptReview(attempt: AttestLearnerAttempt, examTitle?: string) {
  const items = attempt.review || [];
  const title = examTitle || attempt.examTitle || "Atestatsiya natijasi";
  const rows = items
    .map(
      (it) => `
      <div style="margin:10px 0;padding:12px;border-radius:12px;border:1px solid ${it.ok ? "#a7f3d0" : "#fecdd3"};background:${it.ok ? "#ecfdf5" : "#fff1f2"}">
        <div style="font-weight:700;margin-bottom:6px">${it.number}. ${escapeHtml(it.question)}</div>
        <div style="font-size:13px;margin-bottom:4px"><b>Sizning javobingiz:</b> ${escapeHtml(it.chosenText)} ${it.ok ? "✓" : "✗"}</div>
        ${it.ok ? "" : `<div style="font-size:13px"><b>To‘g‘ri javob:</b> ${escapeHtml(it.correctText)}</div>`}
      </div>`,
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
    <style>body{font-family:system-ui,sans-serif;padding:24px;color:#0f172a;max-width:800px;margin:0 auto}
    h1{font-size:20px;margin:0 0 8px} .meta{color:#64748b;font-size:13px;margin-bottom:16px}</style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">Ball: ${attempt.score ?? "—"}% · To‘g‘ri: ${attempt.correct ?? "—"}/${attempt.total} · ${attempt.passed ? "O‘tdi" : "O‘tmadi"} · ${formatAttestDt(attempt.submittedAt)}</div>
    ${rows || "<p>Tahlil yo‘q</p>"}
    <script>window.onload=function(){window.print()}<\/script>
    </body></html>`;
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ReviewList({ items }: { items: AttestReviewItem[] }) {
  return (
    <div className="mt-3 space-y-2">
      {items.map((it) => (
        <div
          key={`${it.questionId}-${it.number}`}
          className={cn(
            "rounded-2xl border px-3 py-2.5 text-sm",
            it.ok
              ? "border-emerald-200 bg-emerald-50/90 dark:border-emerald-900/40 dark:bg-emerald-950/40"
              : "border-rose-200 bg-rose-50/90 dark:border-rose-900/40 dark:bg-rose-950/40",
          )}
        >
          <p className="font-semibold text-foreground">
            <span className={cn("mr-1.5", it.ok ? "text-emerald-600" : "text-rose-600")}>{it.ok ? "✓" : "✗"}</span>
            {it.number}. {it.question}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sizning javobingiz: <span className="font-semibold text-foreground">{it.chosenText}</span>
          </p>
          {!it.ok ? (
            <p className="mt-0.5 text-xs text-emerald-800 dark:text-emerald-300">
              To‘g‘ri javob: <span className="font-semibold">{it.correctText}</span>
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function useCountdown(deadlineIso: string | null, serverNow: string | null) {
  const offset = useMemo(() => (serverNow ? Date.now() - new Date(serverNow).getTime() : 0), [serverNow]);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!deadlineIso) return;
    const tick = () => setLeft(Math.max(0, new Date(deadlineIso).getTime() - (Date.now() - offset)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [deadlineIso, offset]);
  return left;
}

function clock(ms: number) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function isWindowUpdatedError(e: unknown): e is Error & { code?: string } {
  return e instanceof Error && (e as Error & { code?: string }).code === "window_updated";
}

export function ExamRunner({
  attempt,
  serverNow,
  onDone,
  onRestartFresh,
  practiceExamId,
  practiceMeta,
}: {
  attempt: AttestLearnerAttempt;
  serverNow: string;
  onDone: (result: AttestLearnerAttempt) => void;
  /** Test vaqti yangilanganda — eski urinish yopiladi, yangisini boshlash */
  onRestartFresh?: () => void;
  practiceExamId?: number | null;
  practiceMeta?: { questionOrder?: string[]; optionOrders?: Record<string, number[]> } | null;
}) {
  const { toast } = useToast();
  const questions = attempt.questions || [];
  const [answers, setAnswers] = useState<Record<string, number>>(attempt.answers || {});
  const [index, setIndex] = useState(0);
  const [review, setReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [mustRefresh, setMustRefresh] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState(
    "Test vaqti yangilandi — qayta yangilang va boshidan boshlang",
  );
  const focusLost = useRef(attempt ? 0 : 0);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const left = useCountdown(attempt.deadlineAt, serverNow);
  const submitted = useRef(false);
  const timerArmed = useRef(false);

  const markWindowUpdated = (e: unknown) => {
    if (!isWindowUpdatedError(e)) return false;
    submitted.current = true;
    setMustRefresh(true);
    setRefreshMsg(e.message || refreshMsg);
    return true;
  };

  useEffect(() => {
    const bump = () => {
      if (document.hidden) focusLost.current += 1;
    };
    document.addEventListener("visibilitychange", bump);
    const before = (e: BeforeUnloadEvent) => {
      if (!submitted.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      document.removeEventListener("visibilitychange", bump);
      window.removeEventListener("beforeunload", before);
    };
  }, []);

  useEffect(() => {
    if (practiceExamId || mustRefresh) return;
    const id = window.setInterval(() => {
      setSaveState("saving");
      void saveAttestProgress(attempt.id, answersRef.current, focusLost.current)
        .then(() => setSaveState("saved"))
        .catch((e) => {
          if (markWindowUpdated(e)) return;
          setSaveState("error");
        });
    }, 8000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt.id, practiceExamId, mustRefresh]);

  const finish = async (auto: boolean) => {
    if (submitted.current || mustRefresh) return;
    submitted.current = true;
    setSubmitting(true);
    try {
      const res = practiceExamId
        ? await scoreAttestPreview(practiceExamId, answersRef.current, {
            questionOrder: practiceMeta?.questionOrder || questions.map((q) => q.id),
            optionOrders: practiceMeta?.optionOrders,
          })
        : await submitAttest(attempt.id, answersRef.current, focusLost.current);
      onDone(res.attempt);
    } catch (e) {
      if (markWindowUpdated(e)) {
        setSubmitting(false);
        return;
      }
      submitted.current = false;
      setSubmitting(false);
      toast({
        title: auto ? "Vaqt tugadi, lekin yuborilmadi" : "Yuborilmadi",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (left > 0) timerArmed.current = true;
    if (timerArmed.current && left === 0) void finish(true);
    // finish o‘zi submitted bayrog‘i bilan bir marta ishlaydi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const q = questions[index];
  const answered = Object.keys(answers).length;
  const urgent = left < 60_000;
  const onLast = questions.length > 0 && index === questions.length - 1;
  const showSubmit = review || onLast;

  const submitButton = (
    <Button
      className="h-12 w-full max-w-sm bg-emerald-600 text-base font-semibold shadow-sm hover:bg-emerald-700"
      disabled={submitting}
      onClick={() => void finish(false)}
    >
      {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
      Tugadi, topshirish bosing
    </Button>
  );

  const pick = (qi: number) => {
    if (!q || mustRefresh) return;
    const next = { ...answers, [q.id]: qi };
    setAnswers(next);
    if (practiceExamId) return;
    setSaveState("saving");
    void saveAttestProgress(attempt.id, next, focusLost.current)
      .then(() => setSaveState("saved"))
      .catch((e) => {
        if (markWindowUpdated(e)) return;
        setSaveState("error");
      });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {mustRefresh ? (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-amber-200 bg-white p-5 shadow-xl dark:border-amber-900 dark:bg-slate-950">
            <p className="text-lg font-extrabold tracking-tight text-amber-900 dark:text-amber-100">Qayta yangilang</p>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{refreshMsg}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Joriy urinish yopildi. Natija saqlanmaydi — testni boshidan boshlang.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              {onRestartFresh ? (
                <Button className="h-11 flex-1 bg-sky-600 hover:bg-sky-700" onClick={() => onRestartFresh()}>
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Boshidan boshlash
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="h-11 flex-1"
                onClick={() => {
                  submitted.current = true;
                  onDone({ ...attempt, status: "annulled", annulReason: refreshMsg });
                }}
              >
                Ro‘yxatga qaytish
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <header className="flex items-center gap-3 border-b border-border px-3 py-2.5 sm:px-5">
        <Timer className={cn("h-5 w-5 shrink-0", urgent ? "text-rose-600" : "text-[#2AABEE]")} />
        <span className={cn("text-xl font-bold tabular-nums", urgent && "text-rose-600")}>{clock(left)}</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {answered}/{questions.length} javob
          {practiceExamId
            ? " · sinov, natija saqlanmaydi"
            : ` · ${saveState === "saving" ? "saqlanmoqda…" : saveState === "error" ? "saqlanmadi" : "saqlangan"}`}
        </span>
        {showSubmit ? (
          <span className="ml-auto text-xs text-muted-foreground sm:hidden">
            {answered}/{questions.length}
          </span>
        ) : (
          <Button
            className="ml-auto h-10 bg-emerald-600 hover:bg-emerald-700"
            disabled={submitting}
            onClick={() => void finish(false)}
          >
            {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            Topshirish
          </Button>
        )}
      </header>

      <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden">
        {questions.map((qq, i) => (
          <button
            key={qq.id}
            type="button"
            onClick={() => {
              setReview(false);
              setIndex(i);
            }}
            className={cn(
              "h-8 w-8 shrink-0 rounded-lg text-xs font-bold",
              i === index && "bg-[#2AABEE] text-white",
              i !== index && answers[qq.id] !== undefined && "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
              i !== index && answers[qq.id] === undefined && "bg-muted text-muted-foreground",
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {review ? (
        <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ko‘rib chiqish</p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">Barcha savollar</h2>
            </div>
            <Button variant="outline" className="shrink-0" onClick={() => setReview(false)}>
              Savolga qaytish
            </Button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {answered}/{questions.length} javob belgilangan. Savolni bosib, javobni o‘zgartirish mumkin.
          </p>
          <div className="mt-4 grid gap-2 pb-4">
            {questions.map((qq, i) => {
              const picked = answers[qq.id];
              const chosen = picked === undefined ? null : qq.options[picked];
              return (
                <button
                  key={qq.id}
                  type="button"
                  onClick={() => {
                    setIndex(i);
                    setReview(false);
                  }}
                  className="rounded-2xl border border-border bg-card px-3 py-3 text-left transition hover:border-[#2AABEE]/50"
                >
                  <p className="text-xs font-semibold text-muted-foreground">{i + 1}-savol</p>
                  <p className="mt-0.5 text-sm font-medium leading-snug text-foreground">{qq.text}</p>
                  <p className={cn("mt-1.5 text-sm font-medium", chosen ? "text-sky-700 dark:text-sky-300" : "text-amber-700 dark:text-amber-400")}>
                    {chosen ? `${String.fromCharCode(65 + picked!)}. ${chosen}` : "Javob belgilanmagan"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      ) : q ? (
        <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {index + 1}-savol / {questions.length}
            </p>
            <button
              type="button"
              onClick={() => setReview(true)}
              className="text-sm font-semibold text-[#2AABEE] hover:underline"
            >
              Barchasini ko‘rish
            </button>
          </div>
          <h2 className="mt-2 text-lg font-semibold leading-snug text-foreground">{q.text}</h2>
          <div className="mt-4 grid gap-2">
            {q.options.map((opt, oi) => {
              const selected = answers[q.id] === oi;
              return (
                <button
                  key={oi}
                  type="button"
                  onClick={() => pick(oi)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition",
                    selected ? "border-[#2AABEE] bg-[#2AABEE]/10" : "border-border hover:border-[#2AABEE]/40",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                      selected ? "border-[#2AABEE] bg-[#2AABEE] text-white" : "border-border text-muted-foreground",
                    )}
                  >
                    {String.fromCharCode(65 + oi)}
                  </span>
                  {opt}
                </button>
              );
            })}
          </div>
          {onLast ? (
            <div className="mt-6 flex justify-center">
              <Button variant="outline" className="h-11 min-w-36" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
                Oldingi
              </Button>
            </div>
          ) : (
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
                Oldingi
              </Button>
              <Button className="flex-1 bg-[#2AABEE] hover:bg-[#229ED9]" onClick={() => setIndex((i) => i + 1)}>
                Keyingi
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {showSubmit ? (
        <div className="border-t border-border bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-1.5">
            {submitButton}
            <p className="text-center text-xs text-muted-foreground">
              {answered === questions.length
                ? "Barcha savollarga javob berilgan"
                : `${questions.length - answered} ta savol javobsiz`}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Kartochkada aniq yozuvlar: oyna vaqti, davomiylik, savol/o‘tish — qisqa va tushunarli */
function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}
function fmtHm(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
function windowLabel(startsAt: string, endsAt: string): string {
  return fmtDay(startsAt) === fmtDay(endsAt)
    ? `${fmtDay(startsAt)} · ${fmtHm(startsAt)}–${fmtHm(endsAt)}`
    : `${formatAttestDt(startsAt)} – ${formatAttestDt(endsAt)}`;
}
function durationLabel(min: number): string {
  if (min < 60) return `${min} daqiqa`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} soat ${m} daqiqa` : `${h} soat`;
}

function ResultBanner({
  attempt,
  canRetake,
  examTitle,
}: {
  attempt: AttestLearnerAttempt;
  canRetake?: boolean;
  examTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const review = attempt.review || [];

  if (attempt.status === "annulled") {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
        <p className="font-semibold">Natija bekor qilindi</p>
        {attempt.annulReason ? <p className="mt-0.5">{attempt.annulReason}</p> : null}
        {canRetake ? <p className="mt-1 font-medium text-rose-800 dark:text-rose-300">Qayta topshirishingiz mumkin.</p> : null}
      </div>
    );
  }
  if (attempt.resultHidden) {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Test topshirildi. Natija yashirilgan — uni trener yoki admin ko‘radi.
        {canRetake ? " Qayta topshirishingiz mumkin." : ""}
      </div>
    );
  }
  if (attempt.status === "in_progress") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
        <Clock className="h-8 w-8 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 text-sm">
          <p className="text-base font-extrabold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Test boshlangan — tugatilmagan
          </p>
          <p className="mt-0.5 font-semibold text-foreground">
            {attempt.answeredCount}/{attempt.total} ta savolga javob berdingiz
          </p>
          <p className="text-muted-foreground">Davom ettirish uchun pastdagi tugmani bosing.</p>
        </div>
      </div>
    );
  }
  if (attempt.score == null) return null;
  const ok = attempt.passed;
  const wrong = review.filter((x) => !x.ok).length;
  const right = review.filter((x) => x.ok).length;
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3",
        ok
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
          : "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10",
      )}
    >
      <div className="flex items-start gap-3">
        {ok ? (
          <CheckCircle2 className="mt-0.5 h-8 w-8 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <XCircle className="mt-0.5 h-8 w-8 shrink-0 text-rose-600 dark:text-rose-400" />
        )}
        <div className="min-w-0 flex-1 text-sm">
          <p
            className={cn(
              "text-base font-extrabold uppercase tracking-wide",
              ok ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300",
            )}
          >
            {ok ? "✓ O‘tdingiz" : "✗ O‘tolmadingiz"}
          </p>
          <p className="mt-0.5 font-semibold text-foreground">
            Ball: {attempt.score}%{attempt.correct != null ? ` · To‘g‘ri: ${attempt.correct}/${attempt.total}` : ""}
            {review.length ? ` · ${right} to‘g‘ri · ${wrong} xato` : ""}
          </p>
          <p className="text-muted-foreground">
            {attempt.status === "expired" ? "Vaqt tugagach yopildi. " : ""}
            {canRetake && !ok
              ? "Qayta topshirishingiz mumkin — pastdagi tugmani bosing."
              : attempt.retakeAllowed
                ? "Qayta topshirishga ruxsat berilgan."
                : ATTEST_STATUS_LABEL[attempt.status]}
          </p>
          {review.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 bg-white/80 dark:bg-slate-950/50"
                onClick={() => setOpen((v) => !v)}
              >
                {open ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
                {open ? "Yopish" : "Savollarni ko‘rish"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 bg-white/80 dark:bg-slate-950/50"
                onClick={() => printAttemptReview(attempt, examTitle)}
              >
                <FileDown className="mr-1 h-3.5 w-3.5" /> PDF / chop etish
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {open && review.length ? <ReviewList items={review} /> : null}
    </div>
  );
}

/** Urinish umuman bo‘lmasa ham kartochkada aniq hukm: ishlamadi / hali boshlamadi / hali ochilmagan */
function NotStartedBanner({ exam }: { exam: AttestExamCard }) {
  if (exam.window === "closed") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
        <XCircle className="h-8 w-8 shrink-0 text-rose-600 dark:text-rose-400" />
        <div className="min-w-0 text-sm">
          <p className="text-base font-extrabold uppercase tracking-wide text-rose-700 dark:text-rose-300">
            ✗ Testni ishlamadingiz
          </p>
          <p className="mt-0.5 font-semibold text-foreground">Natija: topshirilmadi</p>
          <p className="text-muted-foreground">Belgilangan vaqtda test boshlanmadi — test vaqti tugagan.</p>
        </div>
      </div>
    );
  }
  if (exam.window === "open") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
        <Clock className="h-8 w-8 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 text-sm">
          <p className="text-base font-extrabold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Hali boshlamadingiz
          </p>
          <p className="mt-0.5 font-semibold text-foreground">Natija: hali yo‘q</p>
          <p className="text-muted-foreground">Test ochiq — boshlash uchun pastdagi tugmani bosing.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-500/30 dark:bg-sky-500/10">
      <Clock className="h-8 w-8 shrink-0 text-sky-600 dark:text-sky-400" />
      <div className="min-w-0 text-sm">
        <p className="text-base font-extrabold uppercase tracking-wide text-sky-700 dark:text-sky-300">
          Test hali boshlanmagan
        </p>
        <p className="mt-0.5 font-semibold text-foreground">Natija: hali yo‘q</p>
        <p className="text-muted-foreground">Vaqti kelganda shu yerda ochiladi.</p>
      </div>
    </div>
  );
}

export default function AtestatsiyaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isLearner = canLearnDarsliklar(user?.role);
  const isManager = canManageDarsliklar(user?.role);
  const [previewTrack, setPreviewTrack] = useState<AttestTrack>("stajyor");
  const me = useAttestMe(isLearner ? null : previewTrack);
  const start = useStartAttest();
  const [locatingId, setLocatingId] = useState<number | null>(null);
  const [runner, setRunner] = useState<{
    attempt: AttestLearnerAttempt;
    serverNow: string;
    exam?: AttestExamCard;
    practiceExamId?: number | null;
    practiceMeta?: { questionOrder?: string[]; optionOrders?: Record<string, number[]> };
  } | null>(null);

  if (!isLearner && !isManager) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
        Atestatsiya faqat stajyor, farmasevt va mudir uchun.
      </div>
    );
  }

  const data = me.data;

  const begin = async (exam: AttestExamCard) => {
    setLocatingId(exam.id);
    try {
      if (data?.preview) {
        const res = await startAttestPreview(exam.id);
        setRunner({
          attempt: res.attempt,
          serverNow: res.serverNow,
          exam,
          practiceExamId: exam.id,
          practiceMeta: {
            questionOrder: (res.attempt.questions || []).map((q) => q.id),
            optionOrders: res.optionOrders,
          },
        });
        return;
      }
      if (exam.locationMode === "anywhere") {
        const res = await start.mutateAsync({
          examId: exam.id,
          latitude: 0,
          longitude: 0,
          accuracy: 0,
        });
        setRunner({ attempt: res.attempt, serverNow: res.serverNow, exam });
        return;
      }
      const gps = await readGps();
      const res = await start.mutateAsync({ examId: exam.id, ...gps });
      setRunner({ attempt: res.attempt, serverNow: res.serverNow, exam });
    } catch (e) {
      toast({ title: "Test ochilmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setLocatingId(null);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {runner ? (
        <ExamRunner
          attempt={runner.attempt}
          serverNow={runner.serverNow}
          practiceExamId={runner.practiceExamId}
          practiceMeta={runner.practiceMeta}
          onRestartFresh={
            runner.exam && !runner.practiceExamId
              ? () => {
                  const exam = runner.exam!;
                  setRunner(null);
                  void me.refetch().then(() => void begin(exam));
                }
              : undefined
          }
          onDone={(result) => {
            const practice = Boolean(runner.practiceExamId);
            setRunner(null);
            if (!practice) void me.refetch();
            if (result.status === "annulled") {
              toast({
                title: "Qayta yangilang",
                description: result.annulReason || "Test vaqti yangilandi — boshidan boshlashingiz mumkin.",
              });
              return;
            }
            toast({
              title: practice
                ? result.passed
                  ? "Sinov: o‘tdingiz"
                  : "Sinov yakunlandi"
                : result.passed
                  ? "Tabriklaymiz, o‘tdingiz"
                  : result.resultHidden
                    ? "Test topshirildi"
                    : "Test yakunlandi",
              description:
                result.score != null
                  ? practice
                    ? `Sinov natijasi ${result.score}% — saqlanmadi`
                    : `Natija: ${result.score}%`
                  : undefined,
            });
          }}
        />
      ) : null}

      <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:py-8">
        <section className="hero-dark overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B1B2B] via-[#16324F] to-[#1B4F72] p-5 text-white sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                <BadgeCheck className="h-6 w-6 text-[#F1C40F]" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-200/80">Atestatsiya</p>
                <h1 className="text-xl font-bold sm:text-2xl">{data?.trackLabel ?? "…"} testi</h1>
                <p className="mt-1 max-w-xl text-sm text-sky-100/80">
                  Muddat ichida ochiladi. Ba’zi testlar faqat filial/ofisda, ba’zilari istalgan joydan. Boshlangach taymer ishlaydi.
                </p>
              </div>
            </div>
            {isManager ? (
              <Link
                href="/admin/atestatsiya"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold ring-1 ring-white/25 hover:bg-white/25"
              >
                <PencilRuler className="h-4 w-4" /> Atestatsiya joylash
              </Link>
            ) : null}
          </div>
          {data?.branch ? (
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs">
              <Building2 className="h-3.5 w-3.5" />
              {data.branch.label || "Filial biriktirilmagan"}
              {data.branch.hasGps ? "" : " · GPS nuqtasi yo‘q"}
            </p>
          ) : null}
        </section>

        {isManager && !isLearner ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <Eye className="h-4 w-4 shrink-0" />
            <span className="mr-auto">Ko‘rish rejimi — testni sinab ko‘rish mumkin. Natija saqlanmaydi.</span>
            {ATTESTATSIYA_TRACKS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setPreviewTrack(t.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold",
                  previewTrack === t.key
                    ? "bg-amber-600 text-white"
                    : "bg-white text-amber-900 ring-1 ring-amber-300 dark:bg-white/10 dark:text-amber-200 dark:ring-amber-500/40",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null}

        {me.isLoading ? (
          <Skeleton className="h-40 rounded-3xl" />
        ) : me.isError ? (
          <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-rose-500/10 dark:text-rose-300">{(me.error as Error).message}</p>
        ) : !data?.exams.length ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/70 p-10 text-center">
            <Award className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
            <p className="font-semibold">Hozircha atestatsiya yo‘q</p>
            <p className="mt-1 text-sm text-muted-foreground">Trener yoki admin belgilaganda shu yerda chiqadi.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.exams.map((exam) => {
              const anywhere = exam.locationMode === "anywhere";
              return (
              <article
                key={exam.id}
                className="space-y-3 overflow-hidden rounded-3xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-base font-extrabold tracking-tight text-foreground">{exam.title}</h2>
                    {exam.description ? <p className="mt-1 text-sm text-muted-foreground">{exam.description}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {data.preview && exam.published === false ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
                        E’lon qilinmagan
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                        exam.window === "open" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
                        exam.window === "upcoming" && "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
                        exam.window === "closed" && "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300",
                      )}
                    >
                      {exam.window === "open" ? "Ochiq" : exam.window === "upcoming" ? "Kutilmoqda" : "Yopilgan"}
                    </span>
                    {anywhere ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
                        GPS shart emas
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
                  {[
                    { icon: Clock, label: "Ochiq vaqti", value: windowLabel(exam.startsAt, exam.endsAt) },
                    { icon: Timer, label: "Test davomiyligi", value: durationLabel(exam.durationMinutes) },
                    {
                      icon: ListChecks,
                      label: "Savollar",
                      value:
                        exam.poolCount && exam.poolCount > exam.questionCount
                          ? `${exam.questionCount} ta tushadi (bankda ${exam.poolCount} ta)`
                          : `${exam.questionCount} ta savol`,
                    },
                    {
                      icon: Award,
                      label: "O‘tish bali",
                      value: `${exam.passScore}% · kamida ${Math.ceil((exam.passScore / 100) * exam.questionCount)} ta to‘g‘ri`,
                    },
                    {
                      icon: MapPin,
                      label: "Qayerda",
                      value: anywhere ? "Istalgan joy" : exam.locationMode === "office" ? "Asosiy ofis" : exam.locationTarget || "O‘z filialingiz",
                    },
                  ].map((x) => (
                    <div key={x.label} className="rounded-2xl bg-muted/70 px-2.5 py-2">
                      <p className="flex items-center gap-1 font-medium text-muted-foreground">
                        <x.icon className="h-3 w-3" /> {x.label}
                      </p>
                      <p className="mt-0.5 font-semibold leading-snug text-foreground">{x.value}</p>
                    </div>
                  ))}
                </div>
                {exam.attempt ? (
                  <ResultBanner
                    attempt={exam.attempt}
                    examTitle={exam.title}
                    canRetake={Boolean(exam.canStart && !exam.canResume && exam.attempt.passed !== true)}
                  />
                ) : !data.preview ? (
                  <NotStartedBanner exam={exam} />
                ) : null}
                {exam.reason && (!exam.attempt || exam.attempt.status === "in_progress") ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" /> {exam.reason}
                  </p>
                ) : null}
                {exam.canStart || exam.canResume ? (
                  <Button
                    className={cn(
                      "h-12 w-full text-base font-semibold shadow-sm",
                      anywhere ? "bg-emerald-600 hover:bg-emerald-700" : "bg-sky-600 hover:bg-sky-700",
                    )}
                    disabled={locatingId === exam.id}
                    onClick={() => void begin(exam)}
                  >
                    {locatingId === exam.id ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : exam.canResume ? (
                      <RotateCcw className="mr-1.5 h-4 w-4" />
                    ) : (
                      <Play className="mr-1.5 h-4 w-4" />
                    )}
                    {locatingId === exam.id
                      ? data?.preview
                        ? "Ochilmoqda…"
                        : anywhere
                          ? "Ochilmoqda…"
                          : "Joylashuv tekshirilmoqda…"
                      : data?.preview
                        ? "Sinab ko‘rish"
                        : exam.canResume
                          ? "Davom ettirish"
                          : exam.attempt && exam.attempt.passed === false
                            ? "Qayta topshirish"
                            : anywhere
                              ? "Istalgan joydan boshlash"
                              : "Testni boshlash"}
                  </Button>
                ) : null}
              </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
