import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { RestrictedVideoPlayer } from "@/components/kirish/RestrictedVideoPlayer";
import { DrivePdfViewer } from "@/components/kirish/DrivePdfViewer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  usePreboardingMe,
  usePreboardingSlides,
  usePreboardingTest,
  usePreboardingVideo,
} from "@/lib/preboarding-api";
import { CheckCircle2, Lock } from "lucide-react";

export default function PreboardingPage() {
  const { user } = useAuth();
  const me = usePreboardingMe();
  const markVideo = usePreboardingVideo();
  const markSlides = usePreboardingSlides();
  const submit = usePreboardingTest();
  const stages = me.data?.stages ?? [];
  const [viewId, setViewId] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [watched, setWatched] = useState(false);
  const [percent, setPercent] = useState(0);
  const [result, setResult] = useState<{ score: number; correct: number; total: number; passed: boolean } | null>(null);

  useEffect(() => {
    if (!stages.length || viewId) return;
    const open = [...stages].reverse().find((s) => s.open) || stages[0];
    setViewId(open?.id ?? null);
  }, [stages, viewId]);

  const stage = stages.find((s) => s.id === viewId) || null;

  useEffect(() => {
    setAnswers({});
    setWatched(false);
    setPercent(0);
    setResult(null);
  }, [viewId]);

  if (user?.role !== "farmasevt" && user?.role !== "mudir") {
    return <div className="flex h-full items-center justify-center p-8 text-muted-foreground">Preboarding farmasevt va mudir uchun.</div>;
  }
  if (me.isLoading) return <div className="flex h-full items-center justify-center text-muted-foreground">Yuklanmoqda…</div>;
  if (me.isError) return <div className="p-6 text-red-600">{(me.error as Error).message}</div>;
  if (!stages.length) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-semibold">Preboarding</h1>
        <p className="mt-2 text-sm text-muted-foreground">Hali e’lon qilingan bosqich yo‘q. Material qoralama holatida tayyorlanmoqda.</p>
      </div>
    );
  }
  if (!stage) return null;

  const hasVideo = Boolean(stage.youtubeId || stage.videoDriveFileId);
  const testOpen = !hasVideo || watched || stage.state.videoDone || stage.state.passed;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Preboarding · {me.data?.track}</p>
          <h1 className="text-xl font-semibold">Bosqichma-bosqich kirish</h1>
          <p className="text-sm text-muted-foreground">O‘tgan bosqichga qaytib ko‘rish mumkin. Keyingisi oldingisi topshirilgach ochiladi.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {stages.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={!s.open}
              onClick={() => setViewId(s.id)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-sm font-semibold",
                s.id === stage.id && "bg-sky-600 text-white",
                s.id !== stage.id && s.state.passed && "bg-emerald-50 text-emerald-700",
                s.id !== stage.id && s.open && !s.state.passed && "border bg-white",
                !s.open && "cursor-not-allowed bg-slate-100 text-slate-400",
              )}
            >
              {!s.open ? <Lock className="mr-1 inline h-3 w-3" /> : null}
              {s.position}. {s.title}
              {s.state.passed ? <CheckCircle2 className="ml-1 inline h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </div>

        <section className="overflow-hidden rounded-2xl border bg-white">
          <div className="flex items-center justify-between border-b px-4 py-2 text-sm font-semibold">
            Video
            <span className="text-xs font-medium text-muted-foreground">{stage.state.passed || watched ? "ko‘rildi" : `${percent}%`}</span>
          </div>
          <div className="p-3">
            {hasVideo ? (
              <div className="relative mx-auto aspect-video w-full max-w-lg overflow-hidden rounded-xl bg-black">
                <RestrictedVideoPlayer
                  key={`${stage.id}-${stage.state.attempts}`}
                  youtubeId={stage.youtubeId}
                  driveFileId={stage.videoDriveFileId}
                  onProgress={({ percent: p }) => setPercent(p)}
                  onEnded={() => {
                    setWatched(true);
                    setPercent(100);
                    void markVideo.mutateAsync(stage.id).catch((e) => alert((e as Error).message));
                  }}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Bu bosqichda video yo‘q. Slayd va testga o‘ting.</p>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border bg-white">
          <div className="border-b px-4 py-2 text-sm font-semibold">Slayd</div>
          <div className="p-3">
            {stage.driveFileId ? (
              <>
                <DrivePdfViewer fileId={stage.driveFileId} />
                {!stage.state.slidesDone ? (
                  <Button type="button" className="mt-3 h-9" onClick={() => void markSlides.mutateAsync(stage.id)}>
                    Slaydni ko‘rib chiqdim
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Slayd joylanmagan.</p>
            )}
          </div>
        </section>

        {testOpen && stage.questions.length ? (
          <section className="rounded-2xl border bg-white p-4">
            <h2 className="text-sm font-semibold">Test · o‘tish {me.data?.passScore}%</h2>
            <div className="mt-3 space-y-4">
              {stage.questions.map((q, qi) => (
                <div key={q.id}>
                  <p className="text-sm font-medium">{qi + 1}. {q.text}</p>
                  <div className="mt-2 space-y-1">
                    {q.options.map((opt, oi) => (
                      <label key={oi} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={q.id}
                          checked={answers[q.id] === oi}
                          onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {result ? (
              <p className={cn("mt-3 text-sm font-semibold", result.passed ? "text-emerald-700" : "text-red-600")}>
                {result.correct}/{result.total} · {result.score}% {result.passed ? "o‘tdingiz" : "qayta urinib ko‘ring"}
              </p>
            ) : null}
            <Button
              type="button"
              className="mt-3 h-9"
              disabled={submit.isPending}
              onClick={() => {
                void submit.mutateAsync({ id: stage.id, answers }).then((res) => setResult(res.result)).catch((e) => alert((e as Error).message));
              }}
            >
              Topshirish
            </Button>
          </section>
        ) : null}

        {me.data?.status === "done" ? (
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Barcha bosqichlar topshirildi.</p>
        ) : null}
      </div>
    </div>
  );
}
