/**
 * Rekruter nomzod qadamlari — sodda, aniq, orqaga qaytish mumkin.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  GraduationCap,
  Loader2,
  MessageSquare,
  Plus,
  Trash2,
  ThumbsDown,
  ThumbsUp,
  UserCheck,
  Video,
  MapPin,
  Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PIPELINE_ORDER,
  defaultIntroChecklist,
  defaultQuestionsForPosition,
  parsePipeline,
  resolvePipelineStep,
  stepIndex,
  type HireTrack,
  type InterviewMode,
  type MatchVerdict,
  type PipelineQuestion,
  type PipelineStep,
  INTRO_CHECKLIST_KEYS,
} from "@/lib/hire-pipeline";
import { useI18n } from "@/i18n/I18nProvider";

type CandidateLike = {
  id: number;
  fullName: string;
  experience?: string | null;
  education?: string | null;
  expectedSalary?: string | null;
  notes?: string | null;
  vacancyTitle?: string | null;
  vacancyDescription?: string | null;
  vacancySalary?: string | null;
  vacancySchedule?: string | null;
  vacancyLocation?: string | null;
  status?: string | null;
  stage?: string | null;
  pipelineStep?: string | null;
  pipelineJson?: unknown;
};

type Props = {
  candidate: CandidateLike;
  canEdit: boolean;
  busy?: boolean;
  onAction: (body: Record<string, unknown>) => void;
};

const STEP_ICON: Record<PipelineStep, React.ReactNode> = {
  match: <Briefcase className="h-4 w-4" />,
  recommend: <ThumbsUp className="h-4 w-4" />,
  questions: <MessageSquare className="h-4 w-4" />,
  interview: <Video className="h-4 w-4" />,
  decision: <UserCheck className="h-4 w-4" />,
  intro: <ClipboardList className="h-4 w-4" />,
  done: <CheckCircle2 className="h-4 w-4" />,
};

function ChoiceButton({
  active,
  onClick,
  children,
  tone = "sky",
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "sky" | "emerald" | "amber" | "rose" | "violet";
  disabled?: boolean;
}) {
  const tones = {
    sky: "border-sky-300 bg-sky-50 text-sky-900 ring-sky-400",
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-900 ring-emerald-400",
    amber: "border-amber-300 bg-amber-50 text-amber-950 ring-amber-400",
    rose: "border-rose-300 bg-rose-50 text-rose-900 ring-rose-400",
    violet: "border-violet-300 bg-violet-50 text-violet-900 ring-violet-400",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50",
        active ? cn("ring-2", tones[tone]) : "border-border bg-card hover:bg-muted/50",
      )}
    >
      {children}
    </button>
  );
}

export function HirePipelinePanel({ candidate, canEdit, busy, onAction }: Props) {
  const { t } = useI18n();
  const step = resolvePipelineStep(candidate);
  const data = parsePipeline(candidate.pipelineJson);
  const position = candidate.vacancyTitle || t("hire.unknownJob");
  const rejected = candidate.status === "rejected";
  const done = step === "done" || candidate.status === "hired";

  const [matchVerdict, setMatchVerdict] = useState<MatchVerdict | null>(data.match?.verdict ?? null);
  const [matchNote, setMatchNote] = useState(data.match?.note ?? "");
  const [recommendYes, setRecommendYes] = useState<boolean | null>(
    data.recommend ? data.recommend.yes : null,
  );
  const [recommendNote, setRecommendNote] = useState(data.recommend?.note ?? "");
  const [questions, setQuestions] = useState<PipelineQuestion[]>(() => {
    if (data.questions?.items?.length) return data.questions.items;
    return defaultQuestionsForPosition(position).map((q) => ({ q, a: "" }));
  });
  const [interviewMode, setInterviewMode] = useState<InterviewMode | null>(data.interview?.mode ?? null);
  const [interviewNote, setInterviewNote] = useState(data.interview?.note ?? "");
  const [interviewResult, setInterviewResult] = useState(data.interview?.result ?? "");
  const [track, setTrack] = useState<HireTrack | null>(data.decision?.track ?? null);
  const [decisionNote, setDecisionNote] = useState(data.decision?.note ?? "");
  const [introNote, setIntroNote] = useState(data.intro?.note ?? "");
  const [checklist, setChecklist] = useState<Record<string, boolean>>(
    () => data.intro?.checklist || defaultIntroChecklist(),
  );

  useEffect(() => {
    setMatchVerdict(data.match?.verdict ?? null);
    setMatchNote(data.match?.note ?? "");
    setRecommendYes(data.recommend ? data.recommend.yes : null);
    setRecommendNote(data.recommend?.note ?? "");
    setQuestions(
      data.questions?.items?.length
        ? data.questions.items
        : defaultQuestionsForPosition(position).map((q) => ({ q, a: "" })),
    );
    setInterviewMode(data.interview?.mode ?? null);
    setInterviewNote(data.interview?.note ?? "");
    setInterviewResult(data.interview?.result ?? "");
    setTrack(data.decision?.track ?? null);
    setDecisionNote(data.decision?.note ?? "");
    setIntroNote(data.intro?.note ?? "");
    setChecklist(data.intro?.checklist || defaultIntroChecklist());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.id, candidate.pipelineStep, candidate.status, JSON.stringify(candidate.pipelineJson)]);

  const labels = useMemo(
    () => ({
      match: t("hire.pipe.match"),
      recommend: t("hire.pipe.recommend"),
      questions: t("hire.pipe.questions"),
      interview: t("hire.pipe.interview"),
      decision: t("hire.pipe.decision"),
      intro: t("hire.pipe.intro"),
      done: t("hire.pipe.done"),
    }),
    [t],
  );

  const goBack = () => onAction({ pipelineAction: "back" });

  const advance = (patch: Record<string, unknown>) => {
    onAction({ pipelineAction: "advance", pipelinePatch: patch });
  };

  const currentIdx = stepIndex(step);

  return (
    <div className="overflow-hidden rounded-3xl border border-sky-200/80 bg-gradient-to-b from-sky-50/80 to-white shadow-sm dark:border-sky-900/40 dark:from-sky-950/30 dark:to-card">
      <div className="border-b border-sky-100 px-4 py-4 sm:px-6 dark:border-sky-900/50">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
          {t("hire.pipe.title")}
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-tight">{labels[step]}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("hire.pipe.sub")}</p>

        <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
          {PIPELINE_ORDER.filter((s) => s !== "done").map((s, i) => {
            const active = s === step;
            const passed = i < currentIdx || done;
            return (
              <div
                key={s}
                className={cn(
                  "flex min-w-[2.25rem] flex-col items-center gap-1",
                )}
                title={labels[s]}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                    active && "bg-sky-600 text-white",
                    passed && !active && "bg-emerald-500 text-white",
                    !active && !passed && "bg-muted text-muted-foreground",
                  )}
                >
                  {passed && !active ? <CheckCircle2 className="h-4 w-4" /> : STEP_ICON[s]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4 px-4 py-5 sm:px-6">
        {rejected && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
            {t("hire.pipe.rejectedBanner")}
            {canEdit && (
              <Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={goBack}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("hire.pipe.backUndo")}
              </Button>
            )}
          </div>
        )}

        {done && !rejected && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 dark:border-emerald-900/40 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-semibold">{t("hire.pipe.doneTitle")}</p>
            </div>
            <p className="mt-1 text-sm text-emerald-700/90 dark:text-emerald-300/90">
              {data.decision?.track === "intern"
                ? t("hire.pipe.doneIntern")
                : t("hire.pipe.doneSkilled")}
            </p>
            {canEdit && (
              <Button variant="outline" size="sm" className="mt-3" disabled={busy} onClick={goBack}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("hire.pipe.back")}
              </Button>
            )}
          </div>
        )}

        {/* MATCH */}
        {step === "match" && !rejected && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border bg-card p-4">
                <p className="text-xs font-semibold uppercase text-muted-foreground">{t("hire.pipe.jobCard")}</p>
                <p className="mt-1 text-base font-bold">{position}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {candidate.vacancyDescription?.trim() || t("hire.pipe.noJobDesc")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {candidate.vacancySalary ? <Badge variant="secondary">{candidate.vacancySalary}</Badge> : null}
                  {candidate.vacancySchedule ? <Badge variant="secondary">{candidate.vacancySchedule}</Badge> : null}
                  {candidate.vacancyLocation ? (
                    <Badge variant="secondary" className="gap-1">
                      <MapPin className="h-3 w-3" />
                      {candidate.vacancyLocation}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="rounded-2xl border bg-card p-4">
                <p className="text-xs font-semibold uppercase text-muted-foreground">{t("hire.pipe.candCard")}</p>
                <p className="mt-1 text-base font-bold">{candidate.fullName}</p>
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">{t("hire.field.expOpt")}: </span>
                  {candidate.experience?.trim() || "—"}
                </p>
                <p className="mt-1 text-sm">
                  <span className="text-muted-foreground">{t("hire.field.eduOpt")}: </span>
                  {candidate.education?.trim() || "—"}
                </p>
                <p className="mt-1 text-sm">
                  <span className="text-muted-foreground">{t("hire.field.salaryOpt")}: </span>
                  {candidate.expectedSalary?.trim() || "—"}
                </p>
              </div>
            </div>
            <p className="text-sm font-medium">{t("hire.pipe.matchAsk")}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <ChoiceButton active={matchVerdict === "yes"} tone="emerald" disabled={!canEdit || busy} onClick={() => setMatchVerdict("yes")}>
                {t("hire.pipe.matchYes")}
              </ChoiceButton>
              <ChoiceButton active={matchVerdict === "partial"} tone="amber" disabled={!canEdit || busy} onClick={() => setMatchVerdict("partial")}>
                {t("hire.pipe.matchPartial")}
              </ChoiceButton>
              <ChoiceButton active={matchVerdict === "no"} tone="rose" disabled={!canEdit || busy} onClick={() => setMatchVerdict("no")}>
                {t("hire.pipe.matchNo")}
              </ChoiceButton>
            </div>
            <Textarea
              value={matchNote}
              onChange={(e) => setMatchNote(e.target.value)}
              placeholder={t("hire.pipe.matchNotePh")}
              disabled={!canEdit || busy}
              rows={3}
            />
            {canEdit && (
              <Button
                className="w-full sm:w-auto"
                disabled={busy || !matchVerdict}
                onClick={() => advance({ match: { verdict: matchVerdict, note: matchNote } })}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                {t("hire.pipe.next")}
              </Button>
            )}
          </div>
        )}

        {/* RECOMMEND */}
        {step === "recommend" && !rejected && (
          <div className="space-y-4">
            {data.match && (
              <p className="text-sm text-muted-foreground">
                {t("hire.pipe.matchSummary")}:{" "}
                <Badge variant="secondary">
                  {data.match.verdict === "yes"
                    ? t("hire.pipe.matchYes")
                    : data.match.verdict === "partial"
                      ? t("hire.pipe.matchPartial")
                      : t("hire.pipe.matchNo")}
                </Badge>
              </p>
            )}
            <p className="text-sm font-medium">{t("hire.pipe.recommendAsk")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <ChoiceButton active={recommendYes === true} tone="emerald" disabled={!canEdit || busy} onClick={() => setRecommendYes(true)}>
                <span className="flex items-center gap-2">
                  <ThumbsUp className="h-4 w-4" />
                  {t("hire.pipe.recommendYes")}
                </span>
              </ChoiceButton>
              <ChoiceButton active={recommendYes === false} tone="rose" disabled={!canEdit || busy} onClick={() => setRecommendYes(false)}>
                <span className="flex items-center gap-2">
                  <ThumbsDown className="h-4 w-4" />
                  {t("hire.pipe.recommendNo")}
                </span>
              </ChoiceButton>
            </div>
            <Textarea
              value={recommendNote}
              onChange={(e) => setRecommendNote(e.target.value)}
              placeholder={t("hire.pipe.recommendNotePh")}
              disabled={!canEdit || busy}
              rows={3}
            />
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button variant="outline" disabled={busy} onClick={goBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("hire.pipe.back")}
                </Button>
              )}
              {canEdit && (
                <Button
                  disabled={busy || recommendYes === null}
                  onClick={() => advance({ recommend: { yes: recommendYes, note: recommendNote } })}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                  {recommendYes === false ? t("hire.pipe.rejectConfirm") : t("hire.pipe.next")}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* QUESTIONS */}
        {step === "questions" && !rejected && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("hire.pipe.questionsHint")}</p>
            <div className="space-y-3">
              {questions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("hire.pipe.questionsEmpty")}</p>
              ) : null}
              {questions.map((item, idx) => (
                <div key={idx} className="rounded-2xl border bg-card p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("hire.pipe.questionCard")} {idx + 1}
                    </span>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        disabled={busy}
                        aria-label={t("hire.pipe.removeQuestion")}
                        onClick={() => setQuestions((q) => q.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Input
                      value={item.q}
                      disabled={!canEdit || busy}
                      onChange={(e) => {
                        const next = [...questions];
                        next[idx] = { ...item, q: e.target.value };
                        setQuestions(next);
                      }}
                      placeholder={t("hire.pipe.questionPh")}
                    />
                    <Textarea
                      value={item.a}
                      disabled={!canEdit || busy}
                      onChange={(e) => {
                        const next = [...questions];
                        next[idx] = { ...item, a: e.target.value };
                        setQuestions(next);
                      }}
                      placeholder={t("hire.pipe.answerPh")}
                      rows={2}
                    />
                  </div>
                </div>
              ))}
            </div>
            {canEdit && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                className="gap-2"
                onClick={() => setQuestions((q) => [...q, { q: "", a: "" }])}
              >
                <Plus className="h-4 w-4" />
                {t("hire.pipe.addQuestion")}
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button variant="outline" disabled={busy} onClick={goBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("hire.pipe.back")}
                </Button>
              )}
              {canEdit && (
                <Button disabled={busy} onClick={() => advance({ questions: { items: questions } })}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                  {t("hire.pipe.next")}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* INTERVIEW */}
        {step === "interview" && !rejected && (
          <div className="space-y-4">
            <p className="text-sm font-medium">{t("hire.pipe.interviewAsk")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <ChoiceButton active={interviewMode === "offline"} tone="violet" disabled={!canEdit || busy} onClick={() => setInterviewMode("offline")}>
                <span className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  {t("hire.pipe.interviewOffline")}
                </span>
                <p className="mt-1 text-xs font-normal opacity-80">{t("hire.pipe.interviewOfflineHint")}</p>
              </ChoiceButton>
              <ChoiceButton active={interviewMode === "online"} tone="sky" disabled={!canEdit || busy} onClick={() => setInterviewMode("online")}>
                <span className="flex items-center gap-2">
                  <Video className="h-4 w-4" />
                  {t("hire.pipe.interviewOnline")}
                </span>
                <p className="mt-1 text-xs font-normal opacity-80">{t("hire.pipe.interviewOnlineHint")}</p>
              </ChoiceButton>
            </div>
            <Textarea
              value={interviewNote}
              onChange={(e) => setInterviewNote(e.target.value)}
              placeholder={t("hire.pipe.interviewNotePh")}
              disabled={!canEdit || busy}
              rows={2}
            />
            <Textarea
              value={interviewResult}
              onChange={(e) => setInterviewResult(e.target.value)}
              placeholder={t("hire.pipe.interviewResultPh")}
              disabled={!canEdit || busy}
              rows={3}
            />
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button variant="outline" disabled={busy} onClick={goBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("hire.pipe.back")}
                </Button>
              )}
              {canEdit && (
                <Button
                  disabled={busy || !interviewMode}
                  onClick={() =>
                    advance({
                      interview: { mode: interviewMode, note: interviewNote, result: interviewResult },
                    })
                  }
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                  {t("hire.pipe.next")}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* DECISION */}
        {step === "decision" && !rejected && (
          <div className="space-y-4">
            <p className="text-sm font-medium">{t("hire.pipe.decisionAsk")}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <ChoiceButton active={track === "intern"} tone="amber" disabled={!canEdit || busy} onClick={() => setTrack("intern")}>
                <span className="flex items-center gap-2">
                  <GraduationCap className="h-4 w-4" />
                  {t("hire.pipe.trackIntern")}
                </span>
              </ChoiceButton>
              <ChoiceButton active={track === "skilled"} tone="emerald" disabled={!canEdit || busy} onClick={() => setTrack("skilled")}>
                <span className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4" />
                  {t("hire.pipe.trackSkilled")}
                </span>
              </ChoiceButton>
              <ChoiceButton active={track === "reject"} tone="rose" disabled={!canEdit || busy} onClick={() => setTrack("reject")}>
                <span className="flex items-center gap-2">
                  <ThumbsDown className="h-4 w-4" />
                  {t("hire.pipe.trackReject")}
                </span>
              </ChoiceButton>
            </div>
            <Textarea
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder={t("hire.pipe.decisionNotePh")}
              disabled={!canEdit || busy}
              rows={3}
            />
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button variant="outline" disabled={busy} onClick={goBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("hire.pipe.back")}
                </Button>
              )}
              {canEdit && (
                <Button
                  disabled={busy || !track}
                  onClick={() => advance({ decision: { track, note: decisionNote } })}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                  {track === "reject" ? t("hire.pipe.rejectConfirm") : t("hire.pipe.next")}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* INTRO */}
        {step === "intro" && !rejected && (
          <div className="space-y-4">
            <p className="text-sm font-medium">{t("hire.pipe.introAsk")}</p>
            <p className="text-sm text-muted-foreground">
              {position} ·{" "}
              {data.decision?.track === "intern" ? t("hire.pipe.trackIntern") : t("hire.pipe.trackSkilled")}
            </p>
            <div className="space-y-2">
              {INTRO_CHECKLIST_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-sm"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={Boolean(checklist[key])}
                    disabled={!canEdit || busy}
                    onChange={(e) => setChecklist((c) => ({ ...c, [key]: e.target.checked }))}
                  />
                  <span>{t(`hire.pipe.intro.${key}`)}</span>
                </label>
              ))}
            </div>
            <Textarea
              value={introNote}
              onChange={(e) => setIntroNote(e.target.value)}
              placeholder={t("hire.pipe.introNotePh")}
              disabled={!canEdit || busy}
              rows={3}
            />
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button variant="outline" disabled={busy} onClick={goBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("hire.pipe.back")}
                </Button>
              )}
              {canEdit && (
                <Button
                  disabled={busy}
                  onClick={() => advance({ intro: { note: introNote, checklist } })}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  {t("hire.pipe.finish")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
