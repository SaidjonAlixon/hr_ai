import { useEffect, useState } from "react";
import { ArrowLeft, FileText, Link2, Plus, Sparkles, Trash2, Video, X } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { canManageKirishContent } from "@/lib/roles";
import { useI18n } from "@/i18n/I18nProvider";
import {
  useClearKirishVideo,
  useCreateKirishStage,
  useDeleteKirishStage,
  useKirishAdminVideos,
  useSaveKirishVideo,
  type KirishAdminQuestion,
  type KirishAdminVideo,
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

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyQuestion(): KirishAdminQuestion {
  return { id: uid("q"), text: "", options: ["", "", "", ""], correctIndex: 0 };
}

type DraftPdf = { id: string; title: string; url: string };
type Draft = {
  title: string;
  subtitle: string;
  youtube: string;
  pdfs: DraftPdf[];
  questions: KirishAdminQuestion[];
};

function draftFrom(v: KirishAdminVideo): Draft {
  return {
    title: v.title,
    subtitle: v.subtitle,
    youtube: v.youtubeUrl || (v.videoDriveFileId ? `https://drive.google.com/file/d/${v.videoDriveFileId}/view` : ""),
    pdfs: v.pdfs?.length
      ? v.pdfs.map((p) => ({ id: p.id, title: p.id === "main" || /^Slayd( \d+)?$/.test(p.title) ? "" : p.title, url: p.url }))
      : [{ id: uid("pdf"), title: "", url: "" }],
    questions: v.questions?.length ? v.questions : [emptyQuestion()],
  };
}

export default function AdminKirishVideosPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const canEdit = canManageKirishContent(user?.role);
  const list = useKirishAdminVideos(canEdit);
  const save = useSaveKirishVideo();
  const clear = useClearKirishVideo();
  const createStage = useCreateKirishStage();
  const deleteStage = useDeleteKirishStage();
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [activeStage, setActiveStage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSubtitle, setNewSubtitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<KirishAdminVideo | null>(null);

  useEffect(() => {
    if (!list.data?.videos) return;
    const next: Record<number, Draft> = {};
    for (const v of list.data.videos) next[v.stage] = draftFrom(v);
    setDrafts(next);
    if (!list.data.videos.some((v) => v.stage === activeStage) && list.data.videos.length) {
      setActiveStage(list.data.videos[list.data.videos.length - 1]!.stage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- faqat yangi ma’lumot kelganda
  }, [list.data]);

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-bold">{t("admin.kirishVideos")}</h1>
        <p className="mt-2 text-muted-foreground">{t("admin.restricted")}</p>
      </div>
    );
  }

  const videos = list.data?.videos ?? [];
  const customCount = videos.filter((v) => v.isCustom).length;

  const patch = (stage: number, part: Partial<Draft>) => {
    setDrafts((prev) => {
      const v = videos.find((x) => x.stage === stage);
      const cur = prev[stage] || (v ? draftFrom(v) : { title: "", subtitle: "", youtube: "", pdfs: [], questions: [] });
      return { ...prev, [stage]: { ...cur, ...part } };
    });
  };

  const errToast = (err: unknown, fallback: string) =>
    toast({
      title: "Xatolik",
      description: err instanceof Error ? err.message : fallback,
      variant: "destructive",
    });

  const onSave = (v: KirishAdminVideo) => {
    const draft = drafts[v.stage] ?? draftFrom(v);
    const questions = draft.questions
      .map((q) => ({ ...q, text: q.text.trim(), options: q.options.map((o) => o.trim()).filter(Boolean) }))
      .filter((q) => q.text && q.options.length >= 2);
    const pdfs = draft.pdfs
      .map((p) => ({ id: p.id, title: p.title.trim(), url: p.url.trim() }))
      .filter((p) => p.url);
    for (const p of pdfs) {
      if (!previewDriveFileId(p.url)) {
        toast({ title: "Slayd havolasi noto‘g‘ri", description: p.url, variant: "destructive" });
        return;
      }
    }
    if (v.isCustom && !draft.title.trim()) {
      toast({ title: "Dars nomi bo‘sh", description: "Dars nomini yozing", variant: "destructive" });
      return;
    }
    save.mutate(
      {
        stage: v.stage,
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim(),
        youtubeUrl: draft.youtube.trim(),
        pdfs,
        questions,
      },
      {
        onSuccess: () => toast({ title: "Saqlandi", description: `${v.stage}-dars yangilandi` }),
        onError: (err) => errToast(err, "Saqlanmadi"),
      },
    );
  };

  const onClear = (v: KirishAdminVideo) => {
    clear.mutate(v.stage, {
      onSuccess: () =>
        toast({ title: "Tozalandi", description: `${v.stage}-dars materiallari olib tashlandi` }),
      onError: (err) => errToast(err, "Tozalanmadi"),
    });
  };

  const onCreate = () => {
    const title = newTitle.trim();
    if (!title) {
      toast({ title: "Dars nomini yozing", variant: "destructive" });
      return;
    }
    createStage.mutate(
      { title, subtitle: newSubtitle.trim() },
      {
        onSuccess: (r) => {
          setNewOpen(false);
          setNewTitle("");
          setNewSubtitle("");
          setActiveStage(r.stage);
          toast({ title: "Yangi dars qo‘shildi", description: `${r.stage}-dars: video, slayd va test qo‘shing` });
        },
        onError: (err) => errToast(err, "Qo‘shilmadi"),
      },
    );
  };

  const onDeleteStage = () => {
    if (!deleteTarget) return;
    const n = deleteTarget.stage;
    deleteStage.mutate(n, {
      onSuccess: () => {
        setDeleteTarget(null);
        setActiveStage(Math.max(1, n - 1));
        toast({ title: "Dars o‘chirildi", description: "Keyingi darslar raqami bittaga surildi" });
      },
      onError: (err) => errToast(err, "O‘chirilmadi"),
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10 sm:space-y-5">
      <div className="surface-brand shadow-sm sm:px-6 sm:py-5">
        <Link
          href="/dashboard"
          className="mb-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 px-3 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/25"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("ui.exit")}
        </Link>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t("admin.kirishVideos")}</h1>
        <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-sky-100/85 sm:text-sm">
          Har bir dars: video (YouTube yoki Google Drive) → slaydlar (Drive PDF) → test. Stajyorlar va o‘quvchilar
          bir xil darslarni ko‘radi. Jami {videos.length} ta dars{customCount ? `, ${customCount} tasi qo‘shilgan` : ""}.
        </p>
      </div>

      {list.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-14 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      ) : list.isError ? (
        <p className="text-red-600">{(list.error as Error)?.message || "Yuklanmadi"}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {videos.map((item) => (
              <button
                key={item.stage}
                type="button"
                onClick={() => setActiveStage(item.stage)}
                title={item.title}
                className={cn(
                  "relative flex h-12 w-[3.35rem] shrink-0 flex-col items-center justify-center rounded-xl px-2 text-center transition",
                  activeStage === item.stage
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "border border-border bg-card text-foreground hover:border-[#0b3a5c]/30 hover:bg-muted",
                )}
              >
                <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">Dars</span>
                <span className="text-base font-bold tabular-nums leading-none">{item.stage}</span>
                {item.isCustom ? (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-background" />
                ) : null}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="flex h-12 shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-[#0b3a5c]/40 px-3 text-sm font-semibold text-[#0b3a5c] transition hover:bg-[#0b3a5c]/5 dark:text-sky-300"
            >
              <Plus className="h-4 w-4" />
              Yangi dars
            </button>
          </div>

          {(() => {
            const v = videos.find((item) => item.stage === activeStage);
            if (!v) return null;
            const draft = drafts[v.stage] ?? draftFrom(v);
            const previewId = previewYoutubeId(draft.youtube);
            const driveId = previewId ? null : previewDriveFileId(draft.youtube);
            const busy =
              (save.isPending && save.variables?.stage === v.stage) ||
              (clear.isPending && clear.variables === v.stage);
            const hasContent =
              Boolean(v.youtubeId || v.videoDriveFileId || v.pdfs.length) || (v.questions?.length ?? 0) > 0;
            return (
              <Card key={v.stage} className="overflow-hidden border-border shadow-sm">
                <CardHeader className="space-y-1 px-4 pb-3 pt-4 sm:px-6">
                  <CardTitle className="flex items-center gap-2 text-base text-[#0b3a5c] dark:text-sky-300">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <Video className="h-3.5 w-3.5" />
                    </span>
                    {v.stage}-dars
                    {v.isCustom ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        <Sparkles className="h-3 w-3" />
                        Qo‘shilgan dars
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Standart bosqich
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5 px-4 pb-5 sm:px-6">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor={`title-${v.stage}`}>Dars nomi</Label>
                      <Input
                        id={`title-${v.stage}`}
                        className="h-11 rounded-xl text-base md:h-9 md:text-sm"
                        placeholder="Masalan: Dorilarni saqlash qoidalari"
                        value={draft.title}
                        onChange={(e) => patch(v.stage, { title: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor={`sub-${v.stage}`}>Qisqa tavsif</Label>
                      <Input
                        id={`sub-${v.stage}`}
                        className="h-11 rounded-xl text-base md:h-9 md:text-sm"
                        placeholder="Dars haqida bir-ikki gap"
                        value={draft.subtitle}
                        onChange={(e) => patch(v.stage, { subtitle: e.target.value })}
                      />
                    </div>
                  </div>

                  <section className="space-y-2">
                    <Label htmlFor={`yt-${v.stage}`} className="flex items-center gap-1.5">
                      <Video className="h-3.5 w-3.5" />
                      Video — YouTube yoki Google Drive havolasi
                    </Label>
                    <Input
                      id={`yt-${v.stage}`}
                      className="h-11 rounded-xl text-base md:h-9 md:text-sm"
                      placeholder="https://youtu.be/... yoki https://drive.google.com/file/d/..."
                      value={draft.youtube}
                      onChange={(e) => patch(v.stage, { youtube: e.target.value })}
                    />
                    {previewId ? (
                      <img
                        src={`https://img.youtube.com/vi/${previewId}/hqdefault.jpg`}
                        alt={`${v.stage}-dars preview`}
                        className="aspect-video w-full rounded-xl border object-cover"
                      />
                    ) : driveId ? (
                      <div className="overflow-hidden rounded-xl border bg-slate-900">
                        <iframe
                          title={`${v.stage}-dars video`}
                          src={`https://drive.google.com/file/d/${driveId}/preview`}
                          className="aspect-video w-full border-0"
                          allow="autoplay; fullscreen"
                          allowFullScreen
                        />
                      </div>
                    ) : draft.youtube.trim() ? (
                      <p className="text-xs text-red-600">Havola tanilmadi — YouTube yoki Google Drive havolasini qo‘ying</p>
                    ) : (
                      <div className="flex aspect-[16/6] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed bg-muted text-xs text-muted-foreground">
                        <Link2 className="h-6 w-6" />
                        Video yo‘q — o‘quvchi «Davom etish» bilan slaydga o‘tadi
                      </div>
                    )}
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5" />
                        Slaydlar (Google Drive PDF) — {draft.pdfs.filter((p) => p.url.trim()).length} ta
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-xl border-[#0b3a5c]/20 text-[#0b3a5c] dark:text-sky-300"
                        onClick={() => patch(v.stage, { pdfs: [...draft.pdfs, { id: uid("pdf"), title: "", url: "" }] })}
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Slayd
                      </Button>
                    </div>
                    {v.textSlides > 0 && !v.isCustom ? (
                      <p className="text-[11px] text-muted-foreground">
                        PDF bo‘lmasa, standart {v.textSlides} ta matnli slayd ko‘rsatiladi.
                      </p>
                    ) : null}
                    {draft.pdfs.map((p, pi) => {
                      const ok = !p.url.trim() || Boolean(previewDriveFileId(p.url));
                      return (
                        <div key={p.id} className="grid gap-2 rounded-xl border border-border bg-muted/60 p-2.5 sm:grid-cols-[1fr_2fr_auto]">
                          <Input
                            className="h-10 rounded-lg bg-card text-sm"
                            placeholder={pi === 0 ? "Asosiy slayd" : `Slayd ${pi + 1} nomi`}
                            value={p.title}
                            onChange={(e) =>
                              patch(v.stage, {
                                pdfs: draft.pdfs.map((x, i) => (i === pi ? { ...x, title: e.target.value } : x)),
                              })
                            }
                          />
                          <Input
                            className={cn("h-10 rounded-lg bg-card text-sm", !ok && "border-red-400")}
                            placeholder="https://drive.google.com/file/d/..."
                            value={p.url}
                            onChange={(e) =>
                              patch(v.stage, {
                                pdfs: draft.pdfs.map((x, i) => (i === pi ? { ...x, url: e.target.value } : x)),
                              })
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-muted-foreground"
                            onClick={() => patch(v.stage, { pdfs: draft.pdfs.filter((_, i) => i !== pi) })}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-muted-foreground">
                      Drive faylini «Havolaga ega har kim ko‘ra oladi» qilib ulashing.
                    </p>
                  </section>

                  <section className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label>Test savollari — {draft.questions.length} ta (o‘tish: 50%)</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-xl border-[#0b3a5c]/20 text-[#0b3a5c] dark:text-sky-300"
                        onClick={() => patch(v.stage, { questions: [...draft.questions, emptyQuestion()] })}
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Savol
                      </Button>
                    </div>
                    {draft.questions.length === 0 ? (
                      <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                        Test yo‘q — o‘quvchi video va slaydni ko‘rib, darsni yakunlaydi.
                      </p>
                    ) : null}
                    {draft.questions.map((q, qi) => (
                      <div key={q.id} className="space-y-2 rounded-xl border border-border bg-muted/80 p-3">
                        <div className="flex items-start gap-2">
                          <span className="mt-2 text-xs font-semibold text-[#0b3a5c] dark:text-sky-300">{qi + 1}.</span>
                          <Textarea
                            className="min-h-[64px] bg-card"
                            placeholder={t("admin.kirish.question")}
                            value={q.text}
                            onChange={(e) =>
                              patch(v.stage, {
                                questions: draft.questions.map((item, i) => (i === qi ? { ...item, text: e.target.value } : item)),
                              })
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="shrink-0 text-muted-foreground"
                            onClick={() => patch(v.stage, { questions: draft.questions.filter((_, i) => i !== qi) })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{t("admin.kirish.correct")}</p>
                        <div className="grid gap-2">
                          {q.options.map((opt, oi) => (
                            <div key={oi} className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`correct-${v.stage}-${q.id}`}
                                className="h-4 w-4 accent-[#0b3a5c]"
                                checked={q.correctIndex === oi}
                                onChange={() =>
                                  patch(v.stage, {
                                    questions: draft.questions.map((item, i) => (i === qi ? { ...item, correctIndex: oi } : item)),
                                  })
                                }
                              />
                              <Input
                                className="h-11 rounded-xl bg-card text-base md:h-9 md:text-sm"
                                placeholder={`${oi + 1}-variant`}
                                value={opt}
                                onChange={(e) =>
                                  patch(v.stage, {
                                    questions: draft.questions.map((item, i) => {
                                      if (i !== qi) return item;
                                      const options = [...item.options];
                                      options[oi] = e.target.value;
                                      return { ...item, options };
                                    }),
                                  })
                                }
                              />
                              {q.options.length > 2 ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 shrink-0 text-muted-foreground"
                                  onClick={() =>
                                    patch(v.stage, {
                                      questions: draft.questions.map((item, i) => {
                                        if (i !== qi) return item;
                                        const options = item.options.filter((_, j) => j !== oi);
                                        const correctIndex =
                                          item.correctIndex === oi ? 0 : item.correctIndex > oi ? item.correctIndex - 1 : item.correctIndex;
                                        return { ...item, options, correctIndex };
                                      }),
                                    })
                                  }
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          ))}
                          {q.options.length < 6 ? (
                            <button
                              type="button"
                              className="justify-self-start text-xs font-medium text-[#0b3a5c] hover:underline dark:text-sky-300"
                              onClick={() =>
                                patch(v.stage, {
                                  questions: draft.questions.map((item, i) =>
                                    i === qi ? { ...item, options: [...item.options, ""] } : item,
                                  ),
                                })
                              }
                            >
                              + variant
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </section>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="h-11 min-w-[8rem] rounded-xl bg-[#0b3a5c] hover:bg-[#0a314d]"
                      disabled={busy}
                      onClick={() => onSave(v)}
                    >
                      {busy && save.variables?.stage === v.stage ? t("ui.saving") : t("ui.save")}
                    </Button>
                    {hasContent ? (
                      <Button type="button" variant="outline" className="h-11 rounded-xl" disabled={busy} onClick={() => onClear(v)}>
                        <Trash2 className="mr-1 h-4 w-4" />
                        Materiallarni tozalash
                      </Button>
                    ) : null}
                    {v.isCustom ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        disabled={busy}
                        onClick={() => setDeleteTarget(v)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Darsni o‘chirish
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      )}

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Yangi dars</DialogTitle>
            <DialogDescription>
              Dars oxiriga qo‘shiladi ({videos.length + 1}-dars). Keyin video, slayd va test qo‘shasiz.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-title">Dars nomi</Label>
              <Input
                id="new-title"
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Masalan: Mijoz bilan muloqot — 2-qism"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCreate();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-sub">Qisqa tavsif (ixtiyoriy)</Label>
              <Input id="new-sub" value={newSubtitle} onChange={(e) => setNewSubtitle(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Bekor qilish
            </Button>
            <Button className="bg-[#0b3a5c] hover:bg-[#0a314d]" disabled={createStage.isPending} onClick={onCreate}>
              {createStage.isPending ? "Qo‘shilmoqda…" : "Qo‘shish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget != null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Darsni o‘chirasizmi?</DialogTitle>
            <DialogDescription>
              «{deleteTarget?.title}» ({deleteTarget?.stage}-dars) butunlay o‘chiriladi. Shu darsdagi natijalar ham
              o‘chadi, keyingi darslar raqami bittaga suriladi.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Bekor qilish
            </Button>
            <Button variant="destructive" disabled={deleteStage.isPending} onClick={onDeleteStage}>
              {deleteStage.isPending ? "O‘chirilmoqda…" : "O‘chirish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
