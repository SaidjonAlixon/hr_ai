import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCompleteKirishSlides,
  useCompleteKirishVideo,
  useFinishKirish,
  useKirishMe,
  useSubmitKirishTest,
  type KirishFinishReport,
  type KirishStagePublic,
  type KirishStageState,
} from "@/lib/kirish-api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { canAccessKirish } from "@/lib/roles";
import {
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Lock,
  Play,
  Presentation,
  Sparkles,
  Video,
} from "lucide-react";

type Phase = "video" | "slides" | "test" | "result";

function stageState(
  stages: Record<string, KirishStageState> | undefined,
  n: number,
): KirishStageState {
  return (
    stages?.[String(n)] || {
      videoDone: false,
      slidesDone: false,
      score: null,
      attempts: 0,
      passed: false,
      passedAt: null,
    }
  );
}

export default function KirishPage() {
  const { user } = useAuth();
  const me = useKirishMe();
  const completeVideo = useCompleteKirishVideo();
  const completeSlides = useCompleteKirishSlides();
  const submitTest = useSubmitKirishTest();
  const finish = useFinishKirish();

  const progress = me.data?.progress;
  const stageDefs = me.data?.stages ?? [];
  const activeStageNum = progress?.currentStage ?? 1;
  const [viewStage, setViewStage] = useState(1);
  const [phase, setPhase] = useState<Phase>("video");
  const [slideIdx, setSlideIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [lastResult, setLastResult] = useState<{
    score: number;
    passed: boolean;
    correct: number;
    total: number;
  } | null>(null);
  const [report, setReport] = useState<KirishFinishReport | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    if (progress?.currentStage) setViewStage(progress.currentStage);
  }, [progress?.currentStage]);

  useEffect(() => {
    const st = stageState(progress?.stages, viewStage);
    setSlideIdx(0);
    setAnswers({});
    setLastResult(null);
    setVideoFailed(false);
    if (st.passed) setPhase("result");
    else if (st.slidesDone) setPhase("test");
    else if (st.videoDone) setPhase("slides");
    else setPhase("video");
  }, [viewStage, progress?.stages]);

  const stageContent: KirishStagePublic | undefined = stageDefs.find(
    (s) => s.stage === viewStage,
  );
  const st = stageState(progress?.stages, viewStage);
  const locked = viewStage > (progress?.currentStage ?? 1);
  const canFinish = Boolean(progress?.allPassed);
  const finished = progress?.status === "ready_for_hire" || progress?.status === "hired";

  const slide = stageContent?.slides[slideIdx];
  const isLastSlide = slideIdx >= (stageContent?.slides.length ?? 1) - 1;

  const answeredCount = useMemo(
    () => Object.keys(answers).length,
    [answers],
  );

  if (!canAccessKirish(user?.role)) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-slate-500">
        Bu bo‘lim faqat stajyor uchun.
      </div>
    );
  }

  if (me.isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        Yuklanmoqda...
      </div>
    );
  }

  if (me.isError) {
    return (
      <div className="h-full flex items-center justify-center text-red-600 p-6">
        {(me.error as Error)?.message || "Xato"}
      </div>
    );
  }

  const onMarkVideo = async () => {
    try {
      await completeVideo.mutateAsync(viewStage);
      setPhase("slides");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Xato");
    }
  };

  const onSlidesDone = async () => {
    try {
      await completeSlides.mutateAsync(viewStage);
      setPhase("test");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Xato");
    }
  };

  const onSubmit = async () => {
    if (!stageContent) return;
    if (answeredCount < stageContent.questions.length) {
      alert("Barcha savollarga javob bering");
      return;
    }
    try {
      const res = await submitTest.mutateAsync({
        stage: viewStage,
        answers,
      });
      setLastResult(res.result);
      setPhase("result");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Xato");
    }
  };

  const onFinish = async () => {
    try {
      const res = await finish.mutateAsync();
      setReport(res.report);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Xato");
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[radial-gradient(ellipse_at_top,#e8f4fc_0%,#f8fafc_45%,#eef2f7_100%)]">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8 space-y-6">
        {/* Hero */}
        <header className="relative overflow-hidden rounded-3xl bg-[#0B1B2B] text-white px-6 py-7 sm:px-8 shadow-xl">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#2AABEE]/20 blur-2xl" />
          <div className="absolute bottom-0 left-1/3 h-24 w-48 rounded-full bg-[#6C5CE7]/20 blur-2xl" />
          <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-[#8ec8f0] text-xs font-semibold tracking-[0.2em] uppercase mb-2">
                Stajyor
              </p>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight flex items-center gap-2">
                <Sparkles className="h-7 w-7 text-[#F1C40F]" />
                Kirish
              </h1>
              <p className="mt-2 text-sm text-slate-300 max-w-xl">
                Video, slayd va test orqali bosqichma-bosqich. Har bosqichda{" "}
                <span className="text-white font-medium">50% dan yuqori</span>{" "}
                natija keyingisini ochadi.
              </p>
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm">
              <div className="text-slate-400 text-xs">Holat</div>
              <div className="font-medium mt-0.5">
                {finished
                  ? "Ishga qabulga tayyor"
                  : `Bosqich ${progress?.currentStage ?? 1} / ${progress?.stageCount ?? 3}`}
              </div>
            </div>
          </div>

          {/* Stepper */}
          <div className="relative mt-7 flex gap-2 sm:gap-3">
            {(progress
              ? Array.from({ length: progress.stageCount }, (_, i) => i + 1)
              : [1, 2, 3]
            ).map((n) => {
              const s = stageState(progress?.stages, n);
              const isCurrent = n === viewStage;
              const isLocked = n > (progress?.currentStage ?? 1);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={isLocked}
                  onClick={() => setViewStage(n)}
                  className={cn(
                    "flex-1 rounded-2xl border px-3 py-3 text-left transition",
                    isCurrent
                      ? "bg-[#2AABEE] border-[#2AABEE] text-white shadow-lg shadow-[#2AABEE]/25"
                      : s.passed
                        ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-100"
                        : isLocked
                          ? "bg-white/5 border-white/10 text-slate-500 cursor-not-allowed"
                          : "bg-white/5 border-white/10 text-slate-200 hover:bg-white/10",
                  )}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-80">
                    {isLocked ? <Lock className="h-3.5 w-3.5" /> : null}
                    {s.passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                    Bosqich {n}
                  </div>
                  <div className="text-sm font-medium mt-1 truncate">
                    {stageDefs.find((x) => x.stage === n)?.title.split(":")[0] ||
                      `${n}-bosqich`}
                  </div>
                </button>
              );
            })}
          </div>
        </header>

        {finished || report ? (
          <section className="rounded-3xl border border-emerald-200 bg-white p-6 sm:p-8 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <Award className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {(report || { statusLabel: "Ishga qabulga tayyor" }).statusLabel}
                </h2>
                <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                  {report?.message ||
                    "Barcha bosqichlar yakunlangan. HR/admin ishga olishni ko‘rib chiqishi mumkin."}
                </p>
              </div>
            </div>
            <div className="mt-6 grid sm:grid-cols-3 gap-3">
              {(report?.stages ||
                [1, 2, 3].map((n) => ({
                  stage: n,
                  score: stageState(progress?.stages, n).score,
                  attempts: stageState(progress?.stages, n).attempts,
                  passedAt: stageState(progress?.stages, n).passedAt,
                }))).map((row) => (
                <div
                  key={row.stage}
                  className="rounded-2xl bg-slate-50 border border-slate-100 p-4"
                >
                  <div className="text-xs text-slate-500">Bosqich {row.stage}</div>
                  <div className="text-2xl font-semibold text-slate-900 mt-1">
                    {row.score ?? "—"}%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Urinishlar: {row.attempts}
                  </div>
                </div>
              ))}
            </div>
            {report && (
              <p className="mt-4 text-sm font-medium text-emerald-700">
                O‘rtacha natija: {report.averageScore}%
              </p>
            )}
          </section>
        ) : null}

        {!finished && stageContent && !locked ? (
          <section className="rounded-3xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {stageContent.title}
                </h2>
                <p className="text-sm text-slate-500">{stageContent.subtitle}</p>
              </div>
              <div className="flex gap-1.5">
                {(
                  [
                    ["video", Video, "Video"],
                    ["slides", Presentation, "Slayd"],
                    ["test", ClipboardList, "Test"],
                  ] as const
                ).map(([key, Icon, label]) => (
                  <div
                    key={key}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                      phase === key || (phase === "result" && key === "test")
                        ? "bg-[#0B1B2B] text-white"
                        : "bg-slate-100 text-slate-600",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 sm:p-6">
              {/* VIDEO */}
              {phase === "video" && (
                <div className="flex flex-col items-center">
                  <div className="w-full max-w-xl rounded-2xl overflow-hidden border border-slate-200 shadow-md bg-slate-900 aspect-video relative">
                    {!videoFailed ? (
                      <video
                        className="h-full w-full object-cover"
                        controls
                        poster={`${import.meta.env.BASE_URL}kirish/stage1/poster.svg`}
                        onEnded={() => void onMarkVideo()}
                        onError={() => setVideoFailed(true)}
                        src={stageContent.videoUrl}
                      >
                        Brauzeringiz video qo‘llab-quvvatlamaydi.
                      </video>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-[#0B1B2B] via-[#16324F] to-[#1B4F72]">
                        <div className="h-16 w-16 rounded-full bg-white/10 flex items-center justify-center mb-4 ring-2 ring-[#2AABEE]/40">
                          <Play className="h-7 w-7 text-[#F1C40F]" />
                        </div>
                        <p className="text-white font-medium">
                          {stageContent.videoPosterHint}
                        </p>
                        <p className="text-slate-300 text-sm mt-2 max-w-sm">
                          Demo rejim: real video fayl qo‘yilganda shu yerda ochiladi.
                          Hozir «Ko‘rildi» bilan davom eting.
                        </p>
                      </div>
                    )}
                  </div>
                  <Button
                    className="mt-5 h-11 px-6 rounded-full bg-[#2AABEE] hover:bg-[#229ED9]"
                    onClick={() => void onMarkVideo()}
                    disabled={completeVideo.isPending}
                  >
                    {completeVideo.isPending ? "..." : "Ko‘rildi — slaydlarga"}
                  </Button>
                </div>
              )}

              {/* SLIDES */}
              {phase === "slides" && slide && (
                <div>
                  <div
                    className="relative rounded-3xl p-6 sm:p-10 min-h-[280px] text-white overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${slide.accent} 0%, #0B1B2B 100%)`,
                    }}
                  >
                    <div className="absolute right-4 top-4 text-xs font-semibold bg-white/15 rounded-full px-3 py-1">
                      {slideIdx + 1} / {stageContent.slides.length}
                    </div>
                    <p className="text-white/70 text-xs tracking-widest uppercase mb-3">
                      Slayd
                    </p>
                    <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                      {slide.title}
                    </h3>
                    <p className="mt-4 text-base sm:text-lg leading-relaxed text-white/90 max-w-2xl">
                      {slide.body}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <Button
                      variant="outline"
                      className="rounded-full"
                      disabled={slideIdx === 0}
                      onClick={() => setSlideIdx((i) => Math.max(0, i - 1))}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Orqaga
                    </Button>
                    <div className="flex gap-1.5">
                      {stageContent.slides.map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          className={cn(
                            "h-2 rounded-full transition-all",
                            i === slideIdx
                              ? "w-6 bg-[#2AABEE]"
                              : "w-2 bg-slate-300",
                          )}
                          onClick={() => setSlideIdx(i)}
                        />
                      ))}
                    </div>
                    {!isLastSlide ? (
                      <Button
                        className="rounded-full bg-[#0B1B2B] hover:bg-slate-800"
                        onClick={() => setSlideIdx((i) => i + 1)}
                      >
                        Keyingi
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    ) : (
                      <Button
                        className="rounded-full bg-[#2AABEE] hover:bg-[#229ED9]"
                        onClick={() => void onSlidesDone()}
                        disabled={completeSlides.isPending}
                      >
                        {completeSlides.isPending
                          ? "..."
                          : "Testni boshlash"}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* TEST */}
              {phase === "test" && (
                <div className="space-y-4">
                  {stageContent.questions.map((q, qi) => (
                    <div
                      key={q.id}
                      className="rounded-2xl border border-slate-200 p-4 sm:p-5"
                    >
                      <p className="font-medium text-slate-900">
                        <span className="text-[#2AABEE] mr-2">{qi + 1}.</span>
                        {q.text}
                      </p>
                      <div className="mt-3 grid gap-2">
                        {q.options.map((opt, oi) => {
                          const selected = answers[q.id] === oi;
                          return (
                            <button
                              key={oi}
                              type="button"
                              onClick={() =>
                                setAnswers((prev) => ({ ...prev, [q.id]: oi }))
                              }
                              className={cn(
                                "text-left rounded-xl border px-3 py-2.5 text-sm transition",
                                selected
                                  ? "border-[#2AABEE] bg-[#2AABEE]/10 text-slate-900"
                                  : "border-slate-200 hover:border-slate-300 text-slate-700",
                              )}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-end pt-2">
                    <Button
                      className="rounded-full h-11 px-6 bg-[#2AABEE] hover:bg-[#229ED9]"
                      onClick={() => void onSubmit()}
                      disabled={submitTest.isPending}
                    >
                      {submitTest.isPending ? "Tekshirilmoqda..." : "Javoblarni yuborish"}
                    </Button>
                  </div>
                </div>
              )}

              {/* RESULT */}
              {phase === "result" && (
                <div className="text-center py-4">
                  {(lastResult || st.passed) && (
                    <>
                      <div
                        className={cn(
                          "mx-auto h-24 w-24 rounded-full flex items-center justify-center text-3xl font-bold",
                          (lastResult?.passed ?? st.passed)
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700",
                        )}
                      >
                        {lastResult?.score ?? st.score ?? 0}%
                      </div>
                      <h3 className="mt-4 text-xl font-semibold text-slate-900">
                        {(lastResult?.passed ?? st.passed)
                          ? "Tabriklaymiz — bosqich o‘tildi!"
                          : "50% dan yuqori kerak — qayta urinib ko‘ring"}
                      </h3>
                      <p className="text-sm text-slate-500 mt-2">
                        {(lastResult?.passed ?? st.passed)
                          ? viewStage < (progress?.stageCount ?? 3)
                            ? "Keyingi bosqich ochildi."
                            : "Barcha bosqichlar tayyor — pastda «Tugatish»."
                          : `To‘g‘ri: ${lastResult?.correct ?? "—"} / ${lastResult?.total ?? "—"}. Slayd va testni qayta ko‘rib chiqing.`}
                      </p>
                      <div className="mt-6 flex flex-wrap justify-center gap-2">
                        {!(lastResult?.passed ?? st.passed) && (
                          <Button
                            variant="outline"
                            className="rounded-full"
                            onClick={() => {
                              setAnswers({});
                              setLastResult(null);
                              setPhase("test");
                            }}
                          >
                            Testni qayta topshirish
                          </Button>
                        )}
                        {(lastResult?.passed ?? st.passed) &&
                          viewStage < (progress?.stageCount ?? 3) && (
                            <Button
                              className="rounded-full bg-[#0B1B2B] hover:bg-slate-800"
                              onClick={() => setViewStage(viewStage + 1)}
                            >
                              Keyingi bosqich
                            </Button>
                          )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {!finished && locked && (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 p-10 text-center text-slate-500">
            <Lock className="h-8 w-8 mx-auto mb-3 opacity-50" />
            Avval {viewStage - 1}-bosqichni 50% dan yuqori natija bilan yakunlang.
          </div>
        )}

        {!finished && canFinish && (
          <div className="rounded-3xl border border-[#2AABEE]/30 bg-gradient-to-r from-[#e8f6fd] to-white p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-900">Barcha bosqichlar yakunlandi</h3>
              <p className="text-sm text-slate-600">
                «Tugatish» — to‘liq holatni tizimga chiqaradi (ishga qabulga tayyor).
              </p>
            </div>
            <Button
              className="rounded-full h-11 px-8 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => void onFinish()}
              disabled={finish.isPending}
            >
              {finish.isPending ? "..." : "Tugatish"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
