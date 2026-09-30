import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Award,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Eye,
  GraduationCap,
  Lock,
  PencilRuler,
  Presentation,
  RotateCcw,
  Video,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RestrictedVideoPlayer } from "@/components/kirish/RestrictedVideoPlayer";
import { DrivePdfViewer } from "@/components/kirish/DrivePdfViewer";
import { useToast } from "@/hooks/use-toast";
import { AuthImage } from "@/components/vazifalar/TaskAttachmentViewer";
import { cn } from "@/lib/utils";
import { canLearnDarsliklar, canManageDarsliklar } from "@/lib/roles";
import {
  DARSLIK_TRACKS,
  useCompleteDarslikVideo,
  useDarsliklarMe,
  useSubmitDarslikTest,
  type DarslikLessonPublic,
  type DarslikTestResult,
  type DarslikTrack,
} from "@/lib/darsliklar-api";

type StepState = "done" | "active" | "todo";

function StepPill({ n, label, state }: { n: number; label: string; state: StepState }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold",
        state === "done" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        state === "active" && "bg-[#2AABEE]/15 text-[#1583bd] dark:text-sky-300",
        state === "todo" && "bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
          state === "done" && "bg-emerald-500 text-white",
          state === "active" && "bg-[#2AABEE] text-white",
          state === "todo" && "bg-muted-foreground/20",
        )}
      >
        {state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
      </span>
      {label}
    </div>
  );
}

function LessonListItem({
  lesson,
  active,
  onSelect,
}: {
  lesson: DarslikLessonPublic;
  active: boolean;
  onSelect: () => void;
}) {
  const passed = lesson.state.passed;
  return (
    <button
      type="button"
      disabled={lesson.locked}
      onClick={onSelect}
      className={cn(
        "flex w-full min-w-[15rem] items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition lg:min-w-0",
        active && "border-[#2AABEE] bg-[#2AABEE]/10 shadow-sm",
        !active && !lesson.locked && "border-border bg-card hover:border-[#2AABEE]/40",
        lesson.locked && "cursor-not-allowed border-dashed border-border bg-muted/50 opacity-70",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold tabular-nums",
          passed && "bg-emerald-500 text-white",
          !passed && active && "bg-[#2AABEE] text-white",
          !passed && !active && !lesson.locked && "bg-muted text-foreground",
          lesson.locked && "bg-muted text-muted-foreground",
        )}
      >
        {passed ? <CheckCircle2 className="h-4 w-4" /> : lesson.locked ? <Lock className="h-4 w-4" /> : lesson.number}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{lesson.title}</span>
        <span className="block text-[11px] text-muted-foreground">
          {passed
            ? `O‘tildi · ${lesson.state.score ?? 100}%`
            : lesson.locked
              ? "Yopiq — oldingi darsni tugating"
              : lesson.state.attempts > 0
                ? `Urinish: ${lesson.state.attempts} · ${lesson.state.score ?? 0}%`
                : "Boshlanmagan"}
        </span>
      </span>
    </button>
  );
}

export default function DarsliklarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isLearner = canLearnDarsliklar(user?.role);
  const isManager = canManageDarsliklar(user?.role);
  const [previewTrack, setPreviewTrack] = useState<DarslikTrack>("stajyor");
  const me = useDarsliklarMe(isLearner ? null : previewTrack);
  const completeVideo = useCompleteDarslikVideo();
  const submitTest = useSubmitDarslikTest();

  const data = me.data;
  const preview = Boolean(data?.preview);
  const [sectionId, setSectionId] = useState<number | null>(null);
  const sections = data?.sections ?? [];
  const section = sections.find((s) => s.id === sectionId) ?? null;
  const lessons = section?.lessons ?? [];

  const [activeId, setActiveId] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [lastResult, setLastResult] = useState<DarslikTestResult | null>(null);
  const [sessionWatched, setSessionWatched] = useState(false);
  const [watchPercent, setWatchPercent] = useState(0);
  const [playerKey, setPlayerKey] = useState(0);
  const testRef = useRef<HTMLElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const firstOpen = useMemo(
    () => lessons.find((l) => !l.locked && !l.state.passed) ?? lessons.filter((l) => !l.locked).at(-1) ?? null,
    [lessons],
  );

  useEffect(() => {
    if (!lessons.length) {
      setActiveId(null);
      return;
    }
    if (activeId == null || !lessons.some((l) => l.id === activeId && !l.locked)) {
      setActiveId(firstOpen?.id ?? lessons[0]!.id);
    }
  }, [lessons, activeId, firstOpen]);

  useEffect(() => {
    setSectionId(null);
  }, [previewTrack, data?.track]);

  useEffect(() => {
    setAnswers({});
    setLastResult(null);
    setSessionWatched(false);
    setWatchPercent(0);
  }, [activeId, previewTrack]);

  const lesson = lessons.find((l) => l.id === activeId) ?? null;
  const hasVideo = Boolean(lesson?.youtubeId || lesson?.videoDriveFileId);
  const hasSlides = Boolean(lesson?.driveFileId);
  const hasTest = (lesson?.questions.length ?? 0) > 0;
  const passed = Boolean(lesson?.state.passed);
  const videoDone = !hasVideo || sessionWatched || Boolean(lesson?.state.videoDone) || passed;
  const testVisible = hasTest && (videoDone || preview);
  const nextLesson = lesson ? lessons.find((l) => l.number === lesson.number + 1) : undefined;

  useEffect(() => {
    if (!sessionWatched || !hasTest) return;
    const t = window.setTimeout(() => testRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => window.clearTimeout(t);
  }, [sessionWatched, hasTest]);

  if (!isLearner && !isManager) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
        Darsliklar faqat stajyor, farmasevt va mudir uchun.
      </div>
    );
  }

  const selectLesson = (id: number) => {
    setActiveId(id);
    window.setTimeout(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const onVideoEnded = async () => {
    if (!lesson) return;
    setSessionWatched(true);
    setWatchPercent(100);
    if (preview || lesson.state.videoDone) return;
    try {
      await completeVideo.mutateAsync(lesson.id);
    } catch (e) {
      toast({ title: "Xatolik", description: e instanceof Error ? e.message : "Saqlanmadi", variant: "destructive" });
    }
  };

  const onMarkRead = async () => {
    if (!lesson || preview) return;
    try {
      await completeVideo.mutateAsync(lesson.id);
      toast({ title: "Dars yakunlandi", description: nextLesson ? "Keyingi dars ochildi" : "Barakalla!" });
    } catch (e) {
      toast({ title: "Xatolik", description: e instanceof Error ? e.message : "Saqlanmadi", variant: "destructive" });
    }
  };

  const onSubmit = async () => {
    if (!lesson) return;
    if (Object.keys(answers).length < lesson.questions.length) {
      toast({ title: "Barcha savollarga javob bering", variant: "destructive" });
      return;
    }
    try {
      const res = await submitTest.mutateAsync({ lessonId: lesson.id, answers });
      setLastResult(res.result);
      if (!res.result.passed) {
        setAnswers({});
        if (hasVideo) {
          setSessionWatched(false);
          setWatchPercent(0);
          setPlayerKey((k) => k + 1);
        }
      }
      window.setTimeout(() => testRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e) {
      toast({ title: "Xatolik", description: e instanceof Error ? e.message : "Tekshirilmadi", variant: "destructive" });
    }
  };

  const summary = data?.summary;
  const showResult = Boolean(lastResult) || passed;
  const resultPassed = lastResult?.passed ?? passed;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[radial-gradient(ellipse_at_top,#e8f4fc_0%,#f8fafc_45%,#eef2f7_100%)] dark:bg-none">
      <div ref={topRef} className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:py-8">
        <section className="hero-dark overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B1B2B] via-[#16324F] to-[#1B4F72] p-5 text-white shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                <GraduationCap className="h-6 w-6 text-[#F1C40F]" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-200/80">Darsliklar</p>
                <h1 className="text-xl font-bold sm:text-2xl">{data?.trackLabel ?? "…"} kursi</h1>
                <p className="mt-1 max-w-xl text-sm text-sky-100/80">
                  Avval bo‘limni tanlang. Ichidagi darslar ketma-ket ochiladi: video, slayd, test.
                </p>
              </div>
            </div>
            {isManager ? (
              <Link
                href="/admin/darsliklar"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold ring-1 ring-white/25 hover:bg-white/25"
              >
                <PencilRuler className="h-4 w-4" />
                Darslik joylash
              </Link>
            ) : null}
          </div>

          {summary && summary.total > 0 ? (
            <div className="mt-5">
              <div className="flex items-end justify-between text-sm">
                <span className="font-medium">
                  {summary.passed} / {summary.total} dars o‘tildi
                </span>
                <span className="text-2xl font-extrabold tabular-nums">{summary.percent}%</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#2AABEE] to-emerald-400 transition-all"
                  style={{ width: `${summary.percent}%` }}
                />
              </div>
              {summary.averageScore != null ? (
                <p className="mt-2 text-xs text-sky-100/75">O‘rtacha test natijasi: {summary.averageScore}%</p>
              ) : null}
            </div>
          ) : null}
        </section>

        {isManager && !isLearner ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <Eye className="h-4 w-4 shrink-0" />
            <span className="mr-auto">Ko‘rish rejimi — xodim nimani ko‘rishini tekshiring. Natija saqlanmaydi.</span>
            <div className="flex gap-1.5">
              {DARSLIK_TRACKS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setPreviewTrack(t.key)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold transition",
                    previewTrack === t.key
                      ? "bg-amber-600 text-white"
                      : "bg-white text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100 dark:bg-transparent dark:text-amber-200",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {summary?.completed && !preview ? (
          <section className="flex items-center gap-4 rounded-3xl border border-emerald-200 bg-card p-5 shadow-sm">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <Award className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Kurs to‘liq yakunlandi</h2>
              <p className="text-sm text-muted-foreground">
                Barcha {summary.total} ta darsdan o‘tdingiz. Yangi dars qo‘shilsa, shu yerda paydo bo‘ladi.
              </p>
            </div>
          </section>
        ) : null}

        {me.isLoading ? (
          <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
            <Skeleton className="h-64 rounded-3xl" />
            <Skeleton className="h-96 rounded-3xl" />
          </div>
        ) : me.isError ? (
          <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            {(me.error as Error)?.message || "Yuklanmadi"}
          </p>
        ) : !sections.length ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/70 p-10 text-center">
            <BookOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
            <p className="font-semibold text-foreground">Hozircha bo‘lim yo‘q</p>
            <p className="mt-1 text-sm text-muted-foreground">Trener yoki admin bo‘lim ochganda shu yerda muqova chiqadi.</p>
          </div>
        ) : !section ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((s, i) => (
              <button
                key={s.id}
                type="button"
                disabled={s.locked}
                onClick={() => setSectionId(s.id)}
                className={cn(
                  "overflow-hidden rounded-3xl border text-left shadow-sm transition",
                  s.locked ? "cursor-not-allowed border-dashed border-border opacity-70" : "border-border bg-card hover:-translate-y-0.5 hover:border-[#2AABEE]/50",
                )}
              >
                <div className={cn("relative h-40 bg-gradient-to-br", ["from-[#16324F] to-[#2AABEE]", "from-emerald-700 to-teal-500", "from-violet-700 to-indigo-500", "from-amber-600 to-orange-500"][i % 4])}>
                  {s.coverUrl ? <AuthImage url={s.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
                  <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
                  {s.locked ? (
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[11px] font-semibold text-white">
                      <Lock className="h-3 w-3" /> Yopiq
                    </span>
                  ) : null}
                </div>
                <div className="space-y-1 p-4">
                  <p className="text-base font-bold text-foreground">{s.title}</p>
                  {s.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{s.description}</p> : null}
                  <p className="text-xs font-medium text-[#1583bd]">
                    {s.locked ? "Oldingi bo‘limni tugating" : `${s.summary.passed}/${s.summary.total} dars · ${s.summary.percent}%`}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : !lessons.length ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/70 p-10 text-center">
            <button type="button" className="mb-4 text-sm font-semibold text-[#2AABEE]" onClick={() => setSectionId(null)}>
              Bo‘limlarga qaytish
            </button>
            <p className="font-semibold text-foreground">Bu bo‘limda hali dars yo‘q</p>
          </div>
        ) : (
          <div className="space-y-4">
            <button type="button" className="text-sm font-semibold text-[#2AABEE] hover:underline" onClick={() => setSectionId(null)}>
              ← {section.title}
            </button>
          <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
            <aside className="lg:sticky lg:top-4 lg:self-start">
              <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Darslar ({lessons.length})
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-col lg:overflow-visible [&::-webkit-scrollbar]:hidden">
                {lessons.map((l) => (
                  <LessonListItem
                    key={l.id}
                    lesson={l}
                    active={l.id === activeId}
                    onSelect={() => selectLesson(l.id)}
                  />
                ))}
              </div>
            </aside>

            {lesson ? (
              <div className="min-w-0 space-y-5">
                <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#2AABEE]">
                    {lesson.number}-dars
                  </p>
                  <h2 className="mt-1 text-lg font-bold text-foreground sm:text-xl">{lesson.title}</h2>
                  {lesson.description ? (
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                      {lesson.description}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {hasVideo ? (
                      <StepPill n={1} label="Video" state={videoDone ? "done" : "active"} />
                    ) : null}
                    {hasSlides ? (
                      <StepPill n={hasVideo ? 2 : 1} label="Slayd" state={videoDone ? (passed ? "done" : "active") : "todo"} />
                    ) : null}
                    {hasTest ? (
                      <StepPill
                        n={(hasVideo ? 1 : 0) + (hasSlides ? 1 : 0) + 1}
                        label={`Test · ${lesson.passScore}%`}
                        state={passed ? "done" : videoDone ? "active" : "todo"}
                      />
                    ) : null}
                  </div>
                </div>

                {hasVideo ? (
                  <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
                    <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
                      <Video className="h-4 w-4 text-[#2AABEE]" />
                      <h3 className="text-sm font-semibold text-foreground">Video dars</h3>
                      {videoDone ? (
                        <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-500" />
                      ) : (
                        <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
                          {watchPercent}%
                        </span>
                      )}
                    </div>
                    <div className="p-4 sm:p-5">
                      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-slate-900">
                        <RestrictedVideoPlayer
                          key={`${lesson.id}-${playerKey}`}
                          youtubeId={lesson.youtubeId}
                          driveFileId={lesson.videoDriveFileId}
                          onProgress={({ percent }) => setWatchPercent(Math.min(100, Math.round(percent)))}
                          onEnded={() => void onVideoEnded()}
                        />
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Oldinga o‘tkazib bo‘lmaydi, orqaga qaytish mumkin.{" "}
                        {videoDone
                          ? hasTest
                            ? "Video ko‘rildi — pastda test ochildi."
                            : "Video ko‘rildi — dars yakunlandi."
                          : `Test ochilishi uchun videoni oxirigacha ko‘ring (${watchPercent}%).`}
                      </p>
                    </div>
                  </section>
                ) : null}

                {hasSlides ? (
                  <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
                    <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
                      <Presentation className="h-4 w-4 text-[#2AABEE]" />
                      <h3 className="text-sm font-semibold text-foreground">Slaydlar</h3>
                    </div>
                    <div className="p-4 sm:p-5">
                      <DrivePdfViewer fileId={lesson.driveFileId!} />
                    </div>
                  </section>
                ) : null}

                {!hasTest && !hasVideo && !passed && !preview ? (
                  <div className="flex flex-col items-center justify-between gap-3 rounded-3xl border border-[#2AABEE]/30 bg-card p-5 sm:flex-row">
                    <p className="text-sm text-muted-foreground">Slaydlar bilan tanishib chiqqach, darsni yakunlang.</p>
                    <Button
                      className="h-11 rounded-full bg-[#2AABEE] px-6 hover:bg-[#229ED9]"
                      disabled={completeVideo.isPending}
                      onClick={() => void onMarkRead()}
                    >
                      Tanishib chiqdim
                    </Button>
                  </div>
                ) : null}

                {hasTest && !testVisible ? (
                  <div className="flex items-center gap-3 rounded-3xl border border-dashed border-border bg-card/70 p-5 text-sm text-muted-foreground">
                    <Lock className="h-5 w-5 shrink-0" />
                    Test videoni oxirigacha ko‘rgandan so‘ng ochiladi.
                  </div>
                ) : null}

                {testVisible ? (
                  <section ref={testRef} className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
                    <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
                      <ClipboardList className="h-4 w-4 text-[#2AABEE]" />
                      <h3 className="text-sm font-semibold text-foreground">Test</h3>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {lesson.questions.length} savol · o‘tish {lesson.passScore}%
                      </span>
                    </div>
                    <div className="p-4 sm:p-5">
                      {showResult ? (
                        <div
                          className={cn(
                            "mb-5 rounded-2xl border p-5 text-center",
                            resultPassed ? "border-emerald-200 bg-emerald-50/60 dark:bg-emerald-500/10" : "border-red-200 bg-red-50/60 dark:bg-red-500/10",
                          )}
                        >
                          <div
                            className={cn(
                              "mx-auto flex h-20 w-20 items-center justify-center rounded-full text-xl font-bold tabular-nums",
                              resultPassed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
                            )}
                          >
                            {lastResult ? `${lastResult.correct}/${lastResult.total}` : `${lesson.state.score ?? 100}%`}
                          </div>
                          <h4 className="mt-3 text-lg font-semibold text-foreground">
                            {resultPassed ? "Tabriklaymiz, testdan o‘tdingiz!" : "Afsuski, o‘tish bali yetmadi"}
                          </h4>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {lastResult ? `Natija: ${lastResult.score}% (kerak: ${lastResult.passScore}%). ` : ""}
                            {resultPassed
                              ? nextLesson
                                ? "Keyingi dars ochildi."
                                : "Bu kursdagi oxirgi dars edi."
                              : hasVideo
                                ? "Videoni qayta ko‘rib, testni yana topshiring."
                                : "Slaydlarni qayta ko‘rib, testni yana topshiring."}
                          </p>
                          {resultPassed && nextLesson && !nextLesson.locked ? (
                            <Button
                              className="mt-4 rounded-full bg-[#0B1B2B] hover:bg-[#16324F]"
                              onClick={() => selectLesson(nextLesson.id)}
                            >
                              Keyingi dars <ChevronRight className="ml-1 h-4 w-4" />
                            </Button>
                          ) : null}
                          {!resultPassed ? (
                            <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <RotateCcw className="h-3.5 w-3.5" /> Urinishlar: {lesson.state.attempts}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {!resultPassed || preview ? (
                        <div className="space-y-4">
                          {lesson.questions.map((q, qi) => (
                            <div key={q.id} className="rounded-2xl border border-border p-4 sm:p-5">
                              <p className="font-medium text-foreground">
                                <span className="mr-2 text-[#2AABEE]">{qi + 1}.</span>
                                {q.text}
                              </p>
                              <div className="mt-3 grid gap-2">
                                {q.options.map((opt, oi) => {
                                  const selected = answers[q.id] === oi;
                                  return (
                                    <button
                                      key={oi}
                                      type="button"
                                      onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                                      className={cn(
                                        "flex items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition",
                                        selected
                                          ? "border-[#2AABEE] bg-[#2AABEE]/10 text-foreground"
                                          : "border-border text-foreground hover:border-[#2AABEE]/40",
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
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
                            </div>
                          ))}
                          <div className="flex flex-col items-stretch justify-between gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center">
                            <span className="text-xs text-muted-foreground">
                              Javob berildi: {Object.keys(answers).length} / {lesson.questions.length}
                            </span>
                            <Button
                              className="h-11 rounded-full bg-[#2AABEE] px-6 hover:bg-[#229ED9]"
                              disabled={preview || submitTest.isPending}
                              onClick={() => void onSubmit()}
                            >
                              {preview ? "Ko‘rish rejimi" : submitTest.isPending ? "Tekshirilmoqda…" : "Javoblarni yuborish"}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
