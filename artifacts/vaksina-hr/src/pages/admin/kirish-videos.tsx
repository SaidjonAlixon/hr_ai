import { useEffect, useState } from "react";
import { FileText, Link2, Plus, Trash2, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  useClearKirishVideo,
  useKirishAdminVideos,
  useSaveKirishVideo,
  type KirishAdminQuestion,
} from "@/lib/kirish-api";

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
      if (
        (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live" || parts[0] === "v") &&
        parts[1] &&
        /^[\w-]{11}$/.test(parts[1])
      ) {
        return parts[1];
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function emptyQuestion(): KirishAdminQuestion {
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: "",
    options: ["", "", "", ""],
    correctIndex: 0,
  };
}

type Draft = { youtube: string; pdf: string; questions: KirishAdminQuestion[] };

export default function AdminKirishVideosPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";
  const list = useKirishAdminVideos(isAdmin);
  const save = useSaveKirishVideo();
  const clear = useClearKirishVideo();
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [activeStage, setActiveStage] = useState(1);

  useEffect(() => {
    if (!list.data?.videos) return;
    const next: Record<number, Draft> = {};
    for (const v of list.data.videos) {
      next[v.stage] = {
        youtube: v.youtubeUrl,
        pdf: v.pdfUrl || "",
        questions: v.questions?.length ? v.questions : [emptyQuestion()],
      };
    }
    setDrafts(next);
  }, [list.data]);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-bold">Kirish materiallari</h1>
        <p className="mt-2 text-muted-foreground">Bu bo‘lim faqat admin uchun.</p>
      </div>
    );
  }

  const patch = (stage: number, part: Partial<Draft>) => {
    setDrafts((prev) => {
      const cur = prev[stage] || { youtube: "", pdf: "", questions: [emptyQuestion()] };
      return { ...prev, [stage]: { ...cur, ...part } };
    });
  };

  const onSave = (stage: number) => {
    const draft = drafts[stage] || { youtube: "", pdf: "", questions: [] };
    const questions = draft.questions
      .map((q) => ({
        ...q,
        text: q.text.trim(),
        options: q.options.map((o) => o.trim()).filter(Boolean),
      }))
      .filter((q) => q.text && q.options.length >= 2);
    if (!draft.youtube.trim() && !draft.pdf.trim() && questions.length === 0) {
      toast({
        title: "Bo‘sh",
        description: "YouTube, PDF yoki test savolini yozing",
        variant: "destructive",
      });
      return;
    }
    save.mutate(
      {
        stage,
        youtubeUrl: draft.youtube.trim(),
        pdfUrl: draft.pdf.trim(),
        questions,
      },
      {
        onSuccess: () =>
          toast({ title: "Saqlandi", description: `${stage}-bosqich yangilandi` }),
        onError: (err) =>
          toast({
            title: "Xatolik",
            description: err instanceof Error ? err.message : "Saqlanmadi",
            variant: "destructive",
          }),
      },
    );
  };

  const onClear = (stage: number) => {
    clear.mutate(stage, {
      onSuccess: () => {
        setDrafts((prev) => ({
          ...prev,
          [stage]: { youtube: "", pdf: "", questions: [emptyQuestion()] },
        }));
        toast({ title: "O‘chirildi", description: `${stage}-bosqich materiallari olib tashlandi` });
      },
      onError: (err) =>
        toast({
          title: "Xatolik",
          description: err instanceof Error ? err.message : "O‘chirilmadi",
          variant: "destructive",
        }),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Kirish materiallari</h1>
        <p className="mt-1 text-muted-foreground">
          Har bosqichga YouTube video, Google Drive PDF slayd va test savollarini qo‘shing. Drive
          faylini «Havola orqali ko‘ra oladiganlar» qiling.
        </p>
      </div>

      {list.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : list.isError ? (
        <p className="text-red-600">{(list.error as Error)?.message || "Yuklanmadi"}</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {(list.data?.videos ?? []).map((item) => (
              <button
                key={item.stage}
                type="button"
                onClick={() => setActiveStage(item.stage)}
                className={cn(
                  "rounded-2xl border px-2 py-2.5 text-center transition",
                  activeStage === item.stage
                    ? "border-[#2AABEE] bg-[#2AABEE] text-white shadow-md shadow-[#2AABEE]/20"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                )}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                  Bosqich
                </div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums">{item.stage}</div>
              </button>
            ))}
          </div>
          {(() => {
            const v = (list.data?.videos ?? []).find((item) => item.stage === activeStage);
            if (!v) return null;
            const draft = drafts[v.stage] ?? {
              youtube: v.youtubeUrl,
              pdf: v.pdfUrl || "",
              questions: v.questions?.length ? v.questions : [emptyQuestion()],
            };
            const previewId = previewYoutubeId(draft.youtube) || v.youtubeId;
            const busy =
              (save.isPending && save.variables?.stage === v.stage) ||
              (clear.isPending && clear.variables === v.stage);
            return (
              <Card key={v.stage}>
                <CardHeader className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Video className="h-4 w-4 text-[#2AABEE]" />
                    {v.stage}-bosqich
                  </CardTitle>
                  <p className="text-sm font-medium text-slate-700">{v.title}</p>
                </CardHeader>
                <CardContent className="space-y-5">
                  {previewId ? (
                    <img
                      src={`https://img.youtube.com/vi/${previewId}/hqdefault.jpg`}
                      alt={`${v.stage}-bosqich preview`}
                      className="aspect-video max-w-md rounded-lg object-cover border"
                    />
                  ) : (
                    <div className="flex aspect-video max-w-md items-center justify-center rounded-lg border border-dashed bg-slate-50 text-slate-400">
                      <Link2 className="h-8 w-8" />
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`yt-${v.stage}`}>YouTube video</Label>
                      <Input
                        id={`yt-${v.stage}`}
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={draft.youtube}
                        onChange={(e) => patch(v.stage, { youtube: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`pdf-${v.stage}`} className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" />
                        PDF slayd (Google Drive)
                      </Label>
                      <Input
                        id={`pdf-${v.stage}`}
                        placeholder="https://drive.google.com/file/d/..."
                        value={draft.pdf}
                        onChange={(e) => patch(v.stage, { pdf: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Test savollari</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          patch(v.stage, { questions: [...draft.questions, emptyQuestion()] })
                        }
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Savol qo‘shish
                      </Button>
                    </div>
                    {draft.questions.map((q, qi) => (
                      <div
                        key={q.id}
                        className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3"
                      >
                        <div className="flex items-start gap-2">
                          <span className="mt-2 text-xs font-semibold text-[#2AABEE]">{qi + 1}.</span>
                          <Textarea
                            className="min-h-[64px] bg-white"
                            placeholder="Savol matni"
                            value={q.text}
                            onChange={(e) => {
                              const questions = draft.questions.map((item, i) =>
                                i === qi ? { ...item, text: e.target.value } : item,
                              );
                              patch(v.stage, { questions });
                            }}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0 text-slate-500"
                            disabled={draft.questions.length <= 1}
                            onClick={() =>
                              patch(v.stage, {
                                questions: draft.questions.filter((_, i) => i !== qi),
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-[11px] text-slate-500">To‘g‘ri javobni belgilang</p>
                        <div className="grid gap-2">
                          {q.options.map((opt, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`correct-${v.stage}-${q.id}`}
                                className="h-4 w-4 accent-[#2AABEE]"
                                checked={q.correctIndex === oi}
                                onChange={() => {
                                  const questions = draft.questions.map((item, i) =>
                                    i === qi ? { ...item, correctIndex: oi } : item,
                                  );
                                  patch(v.stage, { questions });
                                }}
                              />
                              <Input
                                className="bg-white"
                                placeholder={`${oi + 1}-variant`}
                                value={opt}
                                onChange={(e) => {
                                  const questions = draft.questions.map((item, i) => {
                                    if (i !== qi) return item;
                                    const options = [...item.options];
                                    options[oi] = e.target.value;
                                    return { ...item, options };
                                  });
                                  patch(v.stage, { questions });
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      className="bg-[#2AABEE] hover:bg-[#229ED9]"
                      disabled={busy}
                      onClick={() => onSave(v.stage)}
                    >
                      {busy && save.variables?.stage === v.stage ? "Saqlanmoqda..." : "Saqlash"}
                    </Button>
                    {v.youtubeId || v.driveFileId || (v.questions && v.questions.length > 0) ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onClear(v.stage)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Tozalash
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      )}
    </div>
  );
}
