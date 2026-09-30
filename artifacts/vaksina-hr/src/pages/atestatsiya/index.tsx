import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Award,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock,
  Eye,
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
  type AttestTrack,
} from "@/lib/atestatsiya-api";

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

export function ExamRunner({
  attempt,
  serverNow,
  onDone,
  practiceExamId,
}: {
  attempt: AttestLearnerAttempt;
  serverNow: string;
  onDone: (result: AttestLearnerAttempt) => void;
  practiceExamId?: number | null;
}) {
  const { toast } = useToast();
  const questions = attempt.questions || [];
  const [answers, setAnswers] = useState<Record<string, number>>(attempt.answers || {});
  const [index, setIndex] = useState(0);
  const [review, setReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const focusLost = useRef(attempt ? 0 : 0);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const left = useCountdown(attempt.deadlineAt, serverNow);
  const submitted = useRef(false);
  const timerArmed = useRef(false);

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
    if (practiceExamId) return;
    const id = window.setInterval(() => {
      setSaveState("saving");
      void saveAttestProgress(attempt.id, answersRef.current, focusLost.current)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 8000);
    return () => window.clearInterval(id);
  }, [attempt.id, practiceExamId]);

  const finish = async (auto: boolean) => {
    if (submitted.current) return;
    submitted.current = true;
    setSubmitting(true);
    try {
      const res = practiceExamId
        ? await scoreAttestPreview(practiceExamId, answersRef.current)
        : await submitAttest(attempt.id, answersRef.current, focusLost.current);
      onDone(res.attempt);
    } catch (e) {
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
    if (!q) return;
    const next = { ...answers, [q.id]: qi };
    setAnswers(next);
    if (practiceExamId) return;
    setSaveState("saving");
    void saveAttestProgress(attempt.id, next, focusLost.current)
      .then(() => setSaveState("saved"))
      .catch(() => setSaveState("error"));
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
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
              i !== index && answers[qq.id] !== undefined && "bg-emerald-100 text-emerald-800",
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
                  <p className={cn("mt-1.5 text-sm", chosen ? "text-[#0B3A5C]" : "text-amber-700")}>
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

function ResultBanner({ attempt }: { attempt: AttestLearnerAttempt }) {
  if (attempt.status === "annulled") {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
        <p className="font-semibold">Natija bekor qilindi</p>
        {attempt.annulReason ? <p className="mt-0.5">{attempt.annulReason}</p> : null}
      </div>
    );
  }
  if (attempt.resultHidden) {
    return (
      <div className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Test topshirildi. Natija yashirilgan — uni trener yoki admin ko‘radi.
      </div>
    );
  }
  if (attempt.score == null) return null;
  const ok = attempt.passed;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-4 py-3",
        ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50",
      )}
    >
      {ok ? <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" /> : <XCircle className="h-6 w-6 shrink-0 text-rose-600" />}
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-foreground">
          {ok ? "O‘tdingiz" : "O‘tish bali yetmadi"} · {attempt.score}%
          {attempt.correct != null ? ` (${attempt.correct}/${attempt.total})` : ""}
        </p>
        <p className="text-muted-foreground">
          {attempt.status === "expired" ? "Vaqt tugagach yopildi. " : ""}
          {attempt.retakeAllowed ? "Qayta topshirishga ruxsat berilgan." : ATTEST_STATUS_LABEL[attempt.status]}
        </p>
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
    practiceExamId?: number | null;
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
        setRunner({ attempt: res.attempt, serverNow: res.serverNow, practiceExamId: exam.id });
        return;
      }
      const gps = await readGps();
      const res = await start.mutateAsync({ examId: exam.id, ...gps });
      setRunner({ attempt: res.attempt, serverNow: res.serverNow });
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
          onDone={(result) => {
            const practice = Boolean(runner.practiceExamId);
            setRunner(null);
            if (!practice) void me.refetch();
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
                  Test faqat belgilangan joyda va belgilangan vaqtda ochiladi. Boshlangach taymer ishlaydi.
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
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Eye className="h-4 w-4 shrink-0" />
            <span className="mr-auto">Ko‘rish rejimi — testni sinab ko‘rish mumkin. Natija saqlanmaydi.</span>
            {ATTESTATSIYA_TRACKS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setPreviewTrack(t.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold",
                  previewTrack === t.key ? "bg-amber-600 text-white" : "bg-white text-amber-900 ring-1 ring-amber-300",
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
          <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{(me.error as Error).message}</p>
        ) : !data?.exams.length ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/70 p-10 text-center">
            <Award className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
            <p className="font-semibold">Hozircha atestatsiya yo‘q</p>
            <p className="mt-1 text-sm text-muted-foreground">Trener yoki admin belgilaganda shu yerda chiqadi.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.exams.map((exam) => (
              <article key={exam.id} className="space-y-3 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-foreground">{exam.title}</h2>
                    {exam.description ? <p className="mt-1 text-sm text-muted-foreground">{exam.description}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {data.preview && exam.published === false ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900">
                        E’lon qilinmagan
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                        exam.window === "open" && "bg-emerald-100 text-emerald-800",
                        exam.window === "upcoming" && "bg-sky-100 text-sky-800",
                        exam.window === "closed" && "bg-muted text-muted-foreground",
                      )}
                    >
                      {exam.window === "open" ? "Ochiq" : exam.window === "upcoming" ? "Kutilmoqda" : "Yopilgan"}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                  {[
                    { icon: Clock, label: "Vaqt", value: `${formatAttestDt(exam.startsAt)} – ${formatAttestDt(exam.endsAt)}` },
                    { icon: Timer, label: "Davomiylik", value: `${exam.durationMinutes} daqiqa` },
                    { icon: MapPin, label: exam.locationMode === "office" ? "Ofis" : "Filial", value: exam.locationTarget },
                    { icon: Award, label: "O‘tish", value: `${exam.passScore}% · ${exam.questionCount} savol` },
                  ].map((x) => (
                    <div key={x.label} className="rounded-xl bg-muted/50 px-2.5 py-2">
                      <p className="flex items-center gap-1 text-muted-foreground">
                        <x.icon className="h-3 w-3" /> {x.label}
                      </p>
                      <p className="mt-0.5 font-semibold leading-snug text-foreground">{x.value}</p>
                    </div>
                  ))}
                </div>
                {exam.attempt ? <ResultBanner attempt={exam.attempt} /> : null}
                {exam.reason ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" /> {exam.reason}
                  </p>
                ) : null}
                {exam.canStart || exam.canResume ? (
                  <Button
                    className="h-11 w-full bg-[#2AABEE] hover:bg-[#229ED9]"
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
                        : "Joylashuv tekshirilmoqda…"
                      : data?.preview
                        ? "Sinab ko‘rish"
                        : exam.canResume
                          ? "Davom ettirish"
                          : "Testni boshlash"}
                  </Button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
