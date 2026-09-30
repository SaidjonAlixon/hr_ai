import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, FileText, Link2, Plus, Trash2, Video } from "lucide-react";
import { Link } from "wouter";
import { RestrictedVideoPlayer } from "@/components/kirish/RestrictedVideoPlayer";
import { DrivePdfViewer } from "@/components/kirish/DrivePdfViewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  useDeletePreboardingStage,
  usePreboardingAdmin,
  useSavePreboardingStage,
  type PreboardingAdminStage,
  type PreboardingQuestion,
} from "@/lib/preboarding-api";

type Track = "farmasevt" | "mudir";
type Mode = "edit" | "preview" | "results";

const TRACKS: { id: Track; label: string; hint: string }[] = [
  { id: "farmasevt", label: "Farmasevt", hint: "Dorixona farmasevtlari" },
  { id: "mudir", label: "Mudir", hint: "Filial mudirlari" },
];

function previewYoutubeId(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return s;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0] || "";
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      if ((parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live" || parts[0] === "v") && parts[1] && /^[\w-]{11}$/.test(parts[1])) {
        return parts[1];
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function previewDriveFileId(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s) && !s.includes("/")) return s;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "drive.google.com" && host !== "docs.google.com") return null;
    const fromPath = u.pathname.match(/\/(?:file|document|presentation|spreadsheets)\/d\/([a-zA-Z0-9_-]{20,})/);
    if (fromPath?.[1]) return fromPath[1];
    const qid = u.searchParams.get("id");
    if (qid && /^[a-zA-Z0-9_-]{20,}$/.test(qid)) return qid;
  } catch {
    /* ignore */
  }
  return null;
}

function emptyQuestion(): PreboardingQuestion {
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text: "",
    options: ["", "", "", ""],
    correctIndex: 0,
  };
}

type Draft = {
  title: string;
  subtitle: string;
  youtube: string;
  pdf: string;
  questions: PreboardingQuestion[];
};

function draftOf(stage: PreboardingAdminStage): Draft {
  return {
    title: stage.title,
    subtitle: stage.subtitle || "",
    youtube: stage.youtubeUrl || (stage.videoDriveFileId ? `https://drive.google.com/file/d/${stage.videoDriveFileId}/view` : ""),
    pdf: stage.pdfUrl || "",
    questions: stage.questionsJson?.length
      ? stage.questionsJson.map((q) => {
          const options = [...(q.options || [])];
          while (options.length < 4) options.push("");
          return { ...q, options: options.slice(0, 4), correctIndex: q.correctIndex ?? 0 };
        })
      : [emptyQuestion()],
  };
}

export default function AdminPreboardingPage() {
  const { toast } = useToast();
  const [track, setTrack] = useState<Track>("farmasevt");
  const [mode, setMode] = useState<Mode>("edit");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState("");
  const data = usePreboardingAdmin(track);
  const save = useSavePreboardingStage();
  const remove = useDeletePreboardingStage();
  const stages = data.data?.stages ?? [];
  const results = data.data?.results ?? [];
  const active = stages.find((s) => s.id === activeId) || stages[0] || null;

  useEffect(() => {
    if (!stages.length) {
      setActiveId(null);
      setDraft(null);
      return;
    }
    if (!activeId || !stages.some((s) => s.id === activeId)) setActiveId(stages[0]!.id);
  }, [stages, activeId]);

  useEffect(() => {
    if (!active) return;
    setDraft(draftOf(active));
  }, [active?.id, track]);

  const onSave = (published?: boolean) => {
    if (!active || !draft) return;
    const questions = draft.questions
      .map((item) => ({ ...item, text: item.text.trim(), options: item.options.map((o) => o.trim()).filter(Boolean) }))
      .filter((item) => item.text && item.options.length >= 2);
    save.mutate(
      {
        id: active.id,
        title: draft.title.trim() || active.title,
        subtitle: draft.subtitle.trim(),
        youtubeUrl: draft.youtube.trim(),
        pdfUrl: draft.pdf.trim(),
        questions,
        published: published ?? active.published,
      },
      {
        onSuccess: () => toast({ title: published ? "E’lon qilindi" : "Saqlandi", description: `${draft.title || active.title}` }),
        onError: (err) => toast({ title: "Saqlanmadi", description: (err as Error).message, variant: "destructive" }),
      },
    );
  };

  const addStage = () => {
    const n = stages.length + 1;
    save.mutate(
      { track, title: `${n}-bosqich`, subtitle: "", youtubeUrl: "", pdfUrl: "", questions: [], published: false },
      {
        onSuccess: (row) => {
          const created = row as { id?: number };
          if (created.id) setActiveId(created.id);
          toast({ title: "Bosqich qo‘shildi", description: "Hali qoralama. E’lon qilmaguncha xodim ko‘rmaydi." });
        },
        onError: (err) => toast({ title: "Qo‘shilmadi", description: (err as Error).message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10 sm:space-y-5">
      <div className="surface-brand rounded-2xl px-4 py-4 shadow-sm sm:px-6 sm:py-5">
        <Link href="/dashboard" className="mb-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 px-3 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/25">
          <ArrowLeft className="h-4 w-4" /> Chiqish
        </Link>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Preboarding</h1>
        <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-sky-100/85 sm:text-sm">
          {track === "farmasevt" ? "Farmasevt" : "Mudir"} yo‘nalishi alohida. Bosqichga YouTube, Drive PDF va test qo‘shing. Havolani qo‘yish bilan video rasmi chiqadi.
        </p>
        <div className="mt-4 flex gap-2">
          {TRACKS.map((item) => {
            const on = track === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTrack(item.id);
                  setActiveId(null);
                  setMode("edit");
                }}
                className={cn(
                  "rounded-xl px-4 py-2 text-sm font-semibold",
                  on ? "bg-white text-[#0b3a5c]" : "bg-white/15 text-white ring-1 ring-white/20",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "edit" as const, label: "Bosqich" },
            { id: "preview" as const, label: "Ko‘rish" },
            { id: "results" as const, label: "Natijalar" },
          ]
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setMode(item.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold",
              mode === item.id ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {data.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      ) : data.isError ? (
        <p className="text-red-600">{(data.error as Error).message}</p>
      ) : mode === "preview" ? (
        <ReadyPreview stages={stages} />
      ) : mode === "results" ? (
        <ResultsList results={results} query={q} onQuery={setQ} />
      ) : (
        <div className="space-y-4">
          <div className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            {stages.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveId(item.id)}
                className={cn(
                  "flex h-12 min-w-[3.35rem] shrink-0 flex-col items-center justify-center rounded-xl px-2 text-center transition",
                  active?.id === item.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "border border-border bg-card text-foreground hover:border-[#0b3a5c]/30 hover:bg-muted",
                )}
              >
                <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">Bosqich</span>
                <span className="text-base font-bold tabular-nums leading-none">{index + 1}</span>
              </button>
            ))}
            <button type="button" onClick={addStage} disabled={save.isPending} className="flex h-12 min-w-[3.35rem] shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card text-muted-foreground">
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {!active || !draft ? (
            <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              Bu yo‘nalishda bosqich yo‘q. Yuqoridagi + bilan qo‘shing.
            </div>
          ) : (
            <Card className="overflow-hidden border-border shadow-sm">
              <CardHeader className="space-y-2 px-4 pb-3 pt-4 sm:px-6">
                <CardTitle className="flex items-center gap-2 text-base text-[#0b3a5c]">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Video className="h-3.5 w-3.5" />
                  </span>
                  {stages.findIndex((s) => s.id === active.id) + 1}-bosqich
                  <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold text-white", active.published ? "bg-emerald-600" : "bg-amber-500")}>
                    {active.published ? "E’lon" : "Qoralama"}
                  </span>
                </CardTitle>
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={`${stages.findIndex((s) => s.id === active.id) + 1}-bosqich: nom`} className="h-9 border-0 bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0" />
              </CardHeader>
              <CardContent className="space-y-4 px-4 pb-5 sm:space-y-5 sm:px-6">
                <StagePreview youtube={draft.youtube} fallbackYoutube={active.youtubeId} fallbackDrive={active.videoDriveFileId} title={draft.title} />
                <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor={`yt-${active.id}`}>YouTube / Google Drive video</Label>
                    <Input
                      id={`yt-${active.id}`}
                      className="h-11 rounded-xl text-base md:h-9 md:text-sm"
                      placeholder="YouTube yoki https://drive.google.com/file/d/..."
                      value={draft.youtube}
                      onChange={(e) => setDraft({ ...draft, youtube: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`pdf-${active.id}`} className="flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> PDF slayd (Google Drive)
                    </Label>
                    <Input
                      id={`pdf-${active.id}`}
                      className="h-11 rounded-xl text-base md:h-9 md:text-sm"
                      placeholder="https://drive.google.com/file/d/..."
                      value={draft.pdf}
                      onChange={(e) => setDraft({ ...draft, pdf: e.target.value })}
                    />
                  </div>
                </div>
                <QuestionEditor draft={draft} setDraft={setDraft} stageId={active.id} />
                <div className="grid grid-cols-2 gap-2 sm:flex sm:max-w-xl">
                  <Button className="h-11 rounded-xl bg-[#0b3a5c] hover:bg-[#0a314d] sm:min-w-[8rem]" disabled={save.isPending} onClick={() => onSave()}>
                    {save.isPending ? "Saqlanmoqda…" : "Saqlash"}
                  </Button>
                  <Button type="button" variant="outline" className="h-11 rounded-xl" disabled={save.isPending} onClick={() => onSave(!active.published)}>
                    {active.published ? "Qoralama" : "E’lon qilish"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-xl text-rose-700"
                    onClick={() => {
                      if (!window.confirm(`“${active.title}” o‘chirilsinmi?`)) return;
                      void remove.mutateAsync(active.id).then(() => toast({ title: "O‘chirildi" }));
                    }}
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> O‘chirish
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function StagePreview({ youtube, fallbackYoutube, fallbackDrive, title }: { youtube: string; fallbackYoutube?: string | null; fallbackDrive?: string | null; title: string }) {
  const previewId = previewYoutubeId(youtube) || fallbackYoutube || null;
  const driveId = previewDriveFileId(youtube) || fallbackDrive || null;
  if (previewId) {
    return <img src={`https://img.youtube.com/vi/${previewId}/hqdefault.jpg`} alt={title || "video"} className="aspect-video w-full rounded-xl border object-cover" />;
  }
  if (driveId) {
    return (
      <div className="overflow-hidden rounded-xl border bg-slate-900">
        <iframe title={title || "video"} src={`https://drive.google.com/file/d/${driveId}/preview`} className="aspect-video w-full border-0" allow="autoplay; fullscreen" allowFullScreen />
      </div>
    );
  }
  return (
    <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed bg-muted text-muted-foreground">
      <Link2 className="h-8 w-8" />
    </div>
  );
}

function QuestionEditor({ draft, setDraft, stageId }: { draft: Draft; setDraft: (d: Draft) => void; stageId: number }) {
  const patchQuestions = (questions: PreboardingQuestion[]) => setDraft({ ...draft, questions });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Test savollari</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 rounded-xl border-[#0b3a5c]/20 text-[#0b3a5c]"
          onClick={() => patchQuestions([...draft.questions, emptyQuestion()])}
        >
          <Plus className="mr-1 h-4 w-4" />
          Savol
        </Button>
      </div>
      {draft.questions.map((question, qi) => (
        <div key={question.id} className="space-y-2 rounded-xl border border-border bg-muted/80 p-3">
          <div className="flex items-start gap-2">
            <span className="mt-2 text-xs font-semibold text-[#0b3a5c]">{qi + 1}.</span>
            <Textarea
              className="min-h-[64px] bg-card"
              placeholder="Savol matni"
              value={question.text}
              onChange={(e) => patchQuestions(draft.questions.map((item, i) => i === qi ? { ...item, text: e.target.value } : item))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              disabled={draft.questions.length <= 1}
              onClick={() => patchQuestions(draft.questions.filter((_, i) => i !== qi))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">To‘g‘ri javobni belgilang</p>
          <div className="grid gap-2">
            {question.options.map((opt, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${stageId}-${question.id}`}
                  className="h-4 w-4 accent-[#0b3a5c]"
                  checked={(question.correctIndex ?? 0) === oi}
                  onChange={() => patchQuestions(draft.questions.map((item, i) => i === qi ? { ...item, correctIndex: oi } : item))}
                />
                <Input
                  className="h-11 rounded-xl bg-card text-base md:h-9 md:text-sm"
                  placeholder={`${oi + 1}-variant`}
                  value={opt}
                  onChange={(e) => patchQuestions(draft.questions.map((item, i) => {
                    if (i !== qi) return item;
                    const options = [...item.options];
                    options[oi] = e.target.value;
                    return { ...item, options };
                  }))}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultsList({
  results,
  query,
  onQuery,
}: {
  results: Array<{ userId: number; fullName: string; status: string; stages: Array<{ id: number; title: string; score: number | null; attempts: number; passed: boolean }> }>;
  query: string;
  onQuery: (v: string) => void;
}) {
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? results.filter((r) => r.fullName.toLowerCase().includes(needle)) : results;
  }, [query, results]);
  return (
    <div className="space-y-2">
      <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Xodim ismi" className="h-11 rounded-xl" />
      {rows.map((r) => (
        <Card key={r.userId}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{r.fullName}</p>
              <span className="text-xs text-muted-foreground">{r.status === "done" ? "Tugatgan" : r.status === "in_progress" ? "Jarayonda" : "Boshlamagan"}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {r.stages.map((s) => (
                <span key={s.id} className={cn("rounded-full px-2 py-0.5 text-[11px]", s.passed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800")}>
                  {s.title}: {s.passed ? `${s.score}%` : "—"}
                </span>
              ))}
              {!r.stages.length ? <span className="text-xs text-muted-foreground">E’lon qilingan bosqich yo‘q</span> : null}
            </div>
          </CardContent>
        </Card>
      ))}
      {!rows.length ? <p className="py-8 text-center text-sm text-muted-foreground">Xodim topilmadi.</p> : null}
    </div>
  );
}

function ReadyPreview({ stages }: { stages: PreboardingAdminStage[] }) {
  const [view, setView] = useState<"ready" | "draft">("ready");
  const [viewId, setViewId] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState(false);
  const shown = stages.filter((s) => (view === "ready" ? s.published : !s.published));
  const stage = shown.find((s) => s.id === viewId) || shown[0] || null;
  const local = useMemo(() => {
    if (!stage || !checked) return null;
    const questions = stage.questionsJson || [];
    let correct = 0;
    for (const item of questions) if (answers[item.id] === (item.correctIndex ?? 0)) correct += 1;
    const score = questions.length ? Math.round((correct / questions.length) * 100) : 100;
    return { correct, total: questions.length, score, passed: score >= 50 };
  }, [answers, checked, stage]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => { setView("ready"); setViewId(null); setAnswers({}); setChecked(false); }}
          className={cn("rounded-2xl border px-4 py-3 text-left", view === "ready" ? "border-emerald-600 bg-emerald-50" : "border-border bg-card")}
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><Eye className="h-4 w-4" /> Tayyor holat</p>
          <p className="mt-1 text-xs text-muted-foreground">E’lon qilingan bosqichlar. Farmasevt yoki mudir akkauntida aynan shu ko‘rinadi.</p>
        </button>
        <button
          type="button"
          onClick={() => { setView("draft"); setViewId(null); setAnswers({}); setChecked(false); }}
          className={cn("rounded-2xl border px-4 py-3 text-left", view === "draft" ? "border-amber-500 bg-amber-50" : "border-border bg-card")}
        >
          <p className="text-sm font-semibold text-amber-800">E’lon qilinmagan</p>
          <p className="mt-1 text-xs text-muted-foreground">Qoralama. Faqat siz ko‘rasiz. Xodimga ochilmaydi, toki E’lon qilish bosilmaguncha.</p>
        </button>
      </div>
      {!shown.length ? (
        <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {view === "ready"
            ? "Hali e’lon qilingan bosqich yo‘q. Bosqichni saqlang, keyin E’lon qilish ni bosing."
            : "E’lon qilinmagan qoralama yo‘q. Yangi bosqich saqlanganda shu yerda ko‘rinadi."}
        </div>
      ) : stage ? (
        <>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {shown.map((item, index) => (
          <button key={item.id} type="button" onClick={() => { setViewId(item.id); setAnswers({}); setChecked(false); }} className={cn("flex h-12 min-w-[3.35rem] shrink-0 flex-col items-center justify-center rounded-xl px-2", stage.id === item.id ? "bg-primary text-primary-foreground" : "border bg-card")}>
            <span className="text-[9px] font-semibold uppercase opacity-70">Bosqich</span>
            <span className="text-base font-bold leading-none">{index + 1}</span>
          </button>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            {stage.title}
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold text-white", view === "ready" ? "bg-emerald-600" : "bg-amber-500")}>
              {view === "ready" ? "Xodim ko‘radi" : "Xodim ko‘rmaydi"}
            </span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {view === "ready"
              ? "Tayyor holat: e’lon qilingan. Shu lavozimdagi xodim bosqichni shunday ochadi."
              : "E’lon qilinmagan qoralama. Ko‘rib chiqing, keyin Bosqichda E’lon qilish ni bosing."}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {stage.youtubeId || stage.videoDriveFileId ? (
            <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-xl bg-black">
              <RestrictedVideoPlayer youtubeId={stage.youtubeId || null} driveFileId={stage.videoDriveFileId} />
            </div>
          ) : <p className="text-sm text-muted-foreground">Video yo‘q.</p>}
          {stage.driveFileId ? <DrivePdfViewer fileId={stage.driveFileId} /> : <p className="text-sm text-muted-foreground">Slayd yo‘q.</p>}
          {stage.questionsJson?.length ? (
            <div className="space-y-3">
              {stage.questionsJson.map((question, qi) => (
                <div key={question.id}>
                  <p className="text-sm font-medium">{qi + 1}. {question.text}</p>
                  {question.options.map((opt, oi) => {
                    const right = checked && (question.correctIndex ?? 0) === oi;
                    return (
                      <label key={oi} className={cn("mt-1 flex items-center gap-2 text-sm", right && "text-emerald-700")}>
                        <input type="radio" checked={answers[question.id] === oi} onChange={() => setAnswers((a) => ({ ...a, [question.id]: oi }))} />
                        {opt}
                        {right ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                      </label>
                    );
                  })}
                </div>
              ))}
              {local ? <p className={cn("text-sm font-semibold", local.passed ? "text-emerald-700" : "text-rose-700")}>{local.correct}/{local.total} · {local.score}%</p> : null}
              <Button type="button" className="h-9" onClick={() => setChecked(true)}>Tekshirish</Button>
            </div>
          ) : <p className="text-sm text-muted-foreground">Test yo‘q.</p>}
        </CardContent>
      </Card>
        </>
      ) : null}
    </div>
  );
}
