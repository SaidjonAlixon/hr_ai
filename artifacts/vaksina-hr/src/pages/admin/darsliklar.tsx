import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileText,
  GraduationCap,
  ImageIcon,
  Pencil,
  Plus,
  Save,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { canManageDarsliklar } from "@/lib/roles";
import {
  DARSLIK_TRACKS,
  previewDriveFileId,
  previewYoutubeId,
  useDarsliklarManage,
  useDarsliklarResults,
  useDeleteDarslik,
  useDeleteDarslikSection,
  usePublishDarslik,
  useReorderDarsliklar,
  useReorderDarslikSections,
  useSaveDarslik,
  useSaveDarslikSection,
  type DarslikManageLesson,
  type DarslikQuestion,
  type DarslikSection,
  type DarslikTrack,
} from "@/lib/darsliklar-api";
import { fileToAttachment } from "@/lib/vazifalar-api";
import { AuthImage } from "@/components/vazifalar/TaskAttachmentViewer";

type Draft = {
  id: number | null;
  title: string;
  description: string;
  videoUrl: string;
  pdfUrl: string;
  passScore: number;
  published: boolean;
  questions: DarslikQuestion[];
};

function emptyQuestion(): DarslikQuestion {
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: "",
    options: ["", "", "", ""],
    correctIndex: 0,
  };
}

function emptyDraft(): Draft {
  return { id: null, title: "", description: "", videoUrl: "", pdfUrl: "", passScore: 50, published: true, questions: [] };
}

function draftFromLesson(l: DarslikManageLesson): Draft {
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    videoUrl: l.videoUrl,
    pdfUrl: l.pdfUrl,
    passScore: l.passScore,
    published: l.published,
    questions: l.questions.map((q) => ({ ...q, options: [...q.options] })),
  };
}

function validateDraft(d: Draft): string | null {
  if (!d.title.trim()) return "Dars nomini kiriting";
  const video = d.videoUrl.trim();
  if (video && !previewYoutubeId(video) && !previewDriveFileId(video)) {
    return "Video havolasi YouTube yoki Google Drive bo‘lishi kerak";
  }
  if (d.pdfUrl.trim() && !previewDriveFileId(d.pdfUrl)) return "Slayd havolasi Google Drive bo‘lishi kerak";
  if (!video && !d.pdfUrl.trim() && d.questions.length === 0) {
    return "Kamida video, slayd yoki test qo‘shing";
  }
  for (const [i, q] of d.questions.entries()) {
    if (!q.text.trim()) return `${i + 1}-savol matnini kiriting`;
    const filled = q.options.filter((o) => o.trim());
    if (filled.length < 2) return `${i + 1}-savolda kamida 2 ta variant bo‘lsin`;
    if (!q.options[q.correctIndex]?.trim()) return `${i + 1}-savolda to‘g‘ri javob bo‘sh variantda`;
  }
  if (d.passScore < 1 || d.passScore > 100) return "O‘tish bali 1–100 oralig‘ida bo‘lsin";
  return null;
}

function LessonEditor({
  track,
  sectionId,
  initial,
  onClose,
}: {
  track: DarslikTrack;
  sectionId: number;
  initial: Draft;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const save = useSaveDarslik();
  const [d, setD] = useState<Draft>(initial);

  const ytId = previewYoutubeId(d.videoUrl);
  const videoDriveId = ytId ? null : previewDriveFileId(d.videoUrl);
  const pdfId = previewDriveFileId(d.pdfUrl);

  const updateQuestion = (qi: number, patch: Partial<DarslikQuestion>) =>
    setD((prev) => ({ ...prev, questions: prev.questions.map((q, i) => (i === qi ? { ...q, ...patch } : q)) }));

  const onSave = async () => {
    const err = validateDraft(d);
    if (err) {
      toast({ title: err, variant: "destructive" });
      return;
    }
    const questions = d.questions.map((q) => {
      const kept = q.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
      return {
        id: q.id,
        text: q.text.trim(),
        options: kept.map((x) => x.o),
        correctIndex: Math.max(0, kept.findIndex((x) => x.i === q.correctIndex)),
      };
    });
    try {
      await save.mutateAsync({
        id: d.id,
        track,
        sectionId,
        title: d.title.trim(),
        description: d.description.trim(),
        videoUrl: d.videoUrl.trim(),
        pdfUrl: d.pdfUrl.trim(),
        passScore: d.passScore,
        published: d.published,
        questions,
      });
      toast({ title: d.id ? "Dars yangilandi" : "Dars qo‘shildi" });
      onClose();
    } catch (e) {
      toast({ title: "Saqlanmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5 rounded-3xl border border-[#2AABEE]/40 bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-foreground">{d.id ? "Darsni tahrirlash" : "Yangi dars"}</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Yopish">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4">
        <div className="space-y-1.5">
          <Label>Dars nomi *</Label>
          <Input
            value={d.title}
            maxLength={200}
            placeholder="Masalan: Dori vositalarini saqlash qoidalari"
            onChange={(e) => setD({ ...d, title: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Qisqacha tavsif</Label>
          <Textarea
            value={d.description}
            rows={3}
            maxLength={2000}
            placeholder="Dars nimani o‘rgatadi, nimalarga e’tibor berish kerak"
            onChange={(e) => setD({ ...d, description: e.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-2xl border border-border p-4">
          <Label className="flex items-center gap-2">
            <Video className="h-4 w-4 text-[#2AABEE]" /> Video (YouTube yoki Google Drive)
          </Label>
          <Input
            value={d.videoUrl}
            placeholder="https://youtu.be/… yoki https://drive.google.com/file/d/…"
            onChange={(e) => setD({ ...d, videoUrl: e.target.value })}
          />
          {ytId ? (
            <div className="aspect-video overflow-hidden rounded-xl border border-border bg-black">
              <img src={`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`} alt="" className="h-full w-full object-cover" />
            </div>
          ) : videoDriveId ? (
            <p className="flex items-center gap-1.5 text-xs text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> Drive video aniqlandi. Fayl “havolaga ega hamma” uchun ochiq bo‘lsin.
            </p>
          ) : d.videoUrl.trim() ? (
            <p className="text-xs text-red-600">Havola tanilmadi</p>
          ) : (
            <p className="text-xs text-muted-foreground">Ixtiyoriy. Xodim videoni 100% ko‘rmaguncha test ochilmaydi.</p>
          )}
        </div>

        <div className="space-y-2 rounded-2xl border border-border p-4">
          <Label className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#2AABEE]" /> Slayd (PDF, Google Drive)
          </Label>
          <Input
            value={d.pdfUrl}
            placeholder="https://drive.google.com/file/d/…"
            onChange={(e) => setD({ ...d, pdfUrl: e.target.value })}
          />
          {pdfId ? (
            <div className="aspect-video overflow-hidden rounded-xl border border-border">
              <iframe
                title="Slayd"
                src={`https://drive.google.com/file/d/${pdfId}/preview`}
                className="h-full w-full"
                allow="autoplay"
              />
            </div>
          ) : d.pdfUrl.trim() ? (
            <p className="text-xs text-red-600">Havola tanilmadi</p>
          ) : (
            <p className="text-xs text-muted-foreground">Ixtiyoriy. PDF faylni Drive’ga yuklab, havolasini qo‘ying.</p>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Label className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[#2AABEE]" /> Test ({d.questions.length} savol)
          </Label>
          <div className="ml-auto flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">O‘tish bali, %</Label>
            <Input
              type="number"
              min={1}
              max={100}
              className="h-9 w-20"
              value={d.passScore}
              onChange={(e) => setD({ ...d, passScore: Math.round(Number(e.target.value) || 0) })}
            />
          </div>
        </div>

        {d.questions.map((q, qi) => (
          <div key={q.id} className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 text-sm font-bold text-[#2AABEE]">{qi + 1}.</span>
              <Textarea
                rows={2}
                value={q.text}
                placeholder="Savol matni"
                onChange={(e) => updateQuestion(qi, { text: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-red-600"
                aria-label="Savolni o‘chirish"
                onClick={() => setD({ ...d, questions: d.questions.filter((_, i) => i !== qi) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {q.options.map((opt, oi) => (
                <label
                  key={oi}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5",
                    q.correctIndex === oi ? "border-emerald-500 ring-1 ring-emerald-500/30" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name={`correct-${q.id}`}
                    checked={q.correctIndex === oi}
                    onChange={() => updateQuestion(qi, { correctIndex: oi })}
                    className="accent-emerald-600"
                  />
                  <span className="text-xs font-bold text-muted-foreground">{String.fromCharCode(65 + oi)}</span>
                  <input
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    value={opt}
                    placeholder={`Variant ${String.fromCharCode(65 + oi)}`}
                    onChange={(e) =>
                      updateQuestion(qi, { options: q.options.map((o, i) => (i === oi ? e.target.value : o)) })
                    }
                  />
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Yashil belgilangan variant — to‘g‘ri javob.</p>
          </div>
        ))}

        <Button
          variant="outline"
          className="w-full border-dashed"
          onClick={() => setD({ ...d, questions: [...d.questions, emptyQuestion()] })}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Savol qo‘shish
        </Button>
      </div>

      <div className="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={d.published} onCheckedChange={(v) => setD({ ...d, published: v })} />
          {d.published ? "Xodimlarga ko‘rinadi" : "Qoralama (yashirin)"}
        </label>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button className="bg-[#2AABEE] hover:bg-[#229ED9]" disabled={save.isPending} onClick={() => void onSave()}>
            <Save className="mr-1.5 h-4 w-4" />
            {save.isPending ? "Saqlanmoqda…" : "Saqlash"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ResultsPanel({ track }: { track: DarslikTrack }) {
  const results = useDarsliklarResults(track, true);
  const data = results.data;
  const [picked, setPicked] = useState<number | null>(null);

  if (results.isLoading) return <Skeleton className="h-64 rounded-3xl" />;
  if (results.isError) {
    return <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{(results.error as Error)?.message}</p>;
  }
  if (!data || !data.learners.length) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-card/70 p-10 text-center text-sm text-muted-foreground">
        Bu yo‘nalishda faol xodim topilmadi.
      </div>
    );
  }

  const sections = data.sections ?? [];
  const active = sections.find((s) => s.id === picked) ?? null;
  const lessons = active ? data.lessons.filter((l) => l.sectionId === active.id) : data.lessons;

  const rows = data.learners.map((u) => {
    const cells = lessons.map((l) => u.lessons.find((x) => x.lessonId === l.id));
    const passed = cells.filter((s) => s?.passed).length;
    const scores = cells.map((s) => s?.score).filter((s): s is number => typeof s === "number");
    return {
      ...u,
      passed,
      total: lessons.length,
      percent: lessons.length ? Math.round((passed / lessons.length) * 100) : 0,
      completed: lessons.length > 0 && passed === lessons.length,
      averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    };
  });
  const completed = rows.filter((l) => l.completed).length;
  const started = rows.filter((l) => l.lessons.some((x) => lessons.some((l2) => l2.id === x.lessonId) && (x.passed || x.attempts > 0))).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => {
          const ids = new Set(data.lessons.filter((l) => l.sectionId === s.id).map((l) => l.id));
          const done = data.learners.filter((u) => {
            const mine = u.lessons.filter((x) => ids.has(x.lessonId));
            return ids.size > 0 && mine.filter((x) => x.passed).length === ids.size;
          }).length;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setPicked(s.id)}
              className={cn(
                "rounded-2xl border p-3 text-left transition",
                picked === s.id ? "border-[#2AABEE] bg-[#2AABEE]/10" : "border-border bg-card hover:border-[#2AABEE]/40",
              )}
            >
              <p className="font-semibold text-foreground">{s.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {done}/{data.learners.length} xodim tugatgan · {ids.size} dars
              </p>
            </button>
          );
        })}
      </div>
      {!active ? (
        <p className="text-sm text-muted-foreground">Natijani alohida ko‘rish uchun bo‘limni tanlang.</p>
      ) : null}
      {active ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{active.title}</p>
            <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
              Barcha bo‘limlar
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Xodimlar", value: rows.length },
              { label: "Boshlagan", value: started },
              { label: "Tugatgan", value: completed },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-border bg-card p-4 text-center">
                <p className="text-2xl font-bold tabular-nums text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-3xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Xodim</th>
                  <th className="px-3 py-3 text-left font-semibold">Progress</th>
                  {lessons.map((l, i) => (
                    <th key={l.id} className="px-2 py-3 text-center font-semibold" title={l.title}>
                      {i + 1}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center font-semibold">O‘rtacha</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.userId} className="border-t border-border/60">
                    <td className="px-4 py-2.5 font-medium text-foreground">{u.fullName}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn("h-full rounded-full", u.completed ? "bg-emerald-500" : "bg-[#2AABEE]")}
                            style={{ width: `${u.percent}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {u.passed}/{u.total}
                        </span>
                      </div>
                    </td>
                    {lessons.map((l) => {
                      const s = u.lessons.find((x) => x.lessonId === l.id);
                      return (
                        <td key={l.id} className="px-2 py-2.5 text-center text-xs tabular-nums">
                          {s?.passed ? (
                            <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-700">
                              {s.score ?? "✓"}
                            </span>
                          ) : s && s.attempts > 0 ? (
                            <span className="rounded-md bg-red-100 px-1.5 py-0.5 font-semibold text-red-700" title={`${s.attempts} urinish`}>
                              {s.score ?? 0}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center text-xs font-semibold tabular-nums">
                      {u.averageScore != null ? `${u.averageScore}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Yashil — o‘tgan ball, qizil — o‘tolmagan oxirgi natija. Hisob faqat shu bo‘lim darslari.</p>
        </>
      ) : null}
    </div>
  );
}

export default function DarsliklarAdminPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canManageDarsliklar(user?.role);
  const [track, setTrack] = useState<DarslikTrack>("stajyor");
  const [tab, setTab] = useState<"lessons" | "results">("lessons");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<DarslikManageLesson | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [sectionForm, setSectionForm] = useState<{
    id: number | null;
    title: string;
    description: string;
    coverUrl: string;
    published: boolean;
  } | null>(null);
  const [deleteSection, setDeleteSection] = useState<DarslikSection | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickVideo, setQuickVideo] = useState("");
  const [coverBusy, setCoverBusy] = useState(false);

  const manage = useDarsliklarManage(track, allowed);
  const publish = usePublishDarslik();
  const remove = useDeleteDarslik();
  const reorder = useReorderDarsliklar();
  const saveSection = useSaveDarslikSection();
  const removeSection = useDeleteDarslikSection();
  const reorderSections = useReorderDarslikSections();
  const saveLesson = useSaveDarslik();

  useEffect(() => {
    setEditing(null);
    setOpenId(null);
    setSectionForm(null);
    setQuickTitle("");
    setQuickVideo("");
  }, [track]);

  const allLessons = manage.data?.lessons ?? [];
  const sections = manage.data?.sections ?? [];
  const openSection = sections.find((s) => s.id === openId) ?? null;
  const lessons = openSection ? allLessons.filter((l) => l.sectionId === openSection.id) : [];
  const counts = useMemo(
    () => new Map((manage.data?.tracks ?? []).map((t) => [t.key, t])),
    [manage.data?.tracks],
  );

  if (!allowed) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
        Bu bo‘lim faqat admin va trener uchun.
      </div>
    );
  }

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= lessons.length) return;
    const ids = lessons.map((l) => l.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    try {
      await reorder.mutateAsync({ track, sectionId: openSection!.id, ids });
    } catch (e) {
      toast({ title: "Tartib saqlanmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const togglePublish = async (l: DarslikManageLesson) => {
    try {
      await publish.mutateAsync({ id: l.id, published: !l.published });
    } catch (e) {
      toast({ title: "Xatolik", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await remove.mutateAsync(toDelete.id);
      toast({ title: "Dars o‘chirildi" });
    } catch (e) {
      toast({ title: "O‘chirilmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setToDelete(null);
    }
  };

  const moveSection = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sections.length) return;
    const ids = sections.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    try {
      await reorderSections.mutateAsync({ track, ids });
    } catch (e) {
      toast({ title: "Tartib saqlanmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const onCoverFile = async (file: File | undefined) => {
    if (!file || !sectionForm) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Faqat rasm yuklang (JPG, PNG, WEBP)", variant: "destructive" });
      return;
    }
    setCoverBusy(true);
    try {
      const att = await fileToAttachment(file);
      setSectionForm({ ...sectionForm, coverUrl: att.url });
    } catch (e) {
      toast({ title: "Rasm yuklanmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setCoverBusy(false);
    }
  };

  const saveSectionForm = async () => {
    if (!sectionForm) return;
    if (!sectionForm.title.trim()) {
      toast({ title: "Bo‘lim nomini yozing", variant: "destructive" });
      return;
    }
    try {
      await saveSection.mutateAsync({
        id: sectionForm.id,
        track,
        title: sectionForm.title.trim(),
        description: sectionForm.description.trim(),
        coverUrl: sectionForm.coverUrl.trim(),
        published: sectionForm.published,
      });
      toast({ title: sectionForm.id ? "Bo‘lim yangilandi" : "Bo‘lim ochildi" });
      setSectionForm(null);
    } catch (e) {
      toast({ title: "Saqlanmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const quickAdd = async () => {
    if (!openSection || !quickTitle.trim()) {
      toast({ title: "Dars nomini yozing", variant: "destructive" });
      return;
    }
    const video = quickVideo.trim();
    if (video && !previewYoutubeId(video) && !previewDriveFileId(video)) {
      toast({ title: "Video havolasi YouTube yoki Google Drive bo‘lsin", variant: "destructive" });
      return;
    }
    try {
      await saveLesson.mutateAsync({
        track,
        sectionId: openSection.id,
        title: quickTitle.trim(),
        description: "",
        videoUrl: video,
        pdfUrl: "",
        questions: [],
        passScore: 50,
        published: Boolean(video),
      });
      setQuickTitle("");
      setQuickVideo("");
      toast({ title: video ? "Dars qo‘shildi" : "Qoralama qo‘shildi", description: video ? undefined : "Video yoki test qo‘shib e’lon qiling" });
    } catch (e) {
      toast({ title: "Qo‘shilmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:py-8">
        <section className="surface-brand rounded-3xl p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                <GraduationCap className="h-6 w-6" />
              </span>
              <div>
                <h1 className="text-xl font-bold sm:text-2xl">Darslik joylash</h1>
                <p className="mt-1 max-w-xl text-sm opacity-80">
                  Stajyor, farmasevt va mudir uchun avval bo‘lim ochiladi. Muqovaga bosilganda ichidagi darslar ketma-ket joylanadi.
                </p>
              </div>
            </div>
            <Link
              href="/darsliklar"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold ring-1 ring-white/25 hover:bg-white/25"
            >
              <Eye className="h-4 w-4" /> Xodim ko‘rinishi
            </Link>
          </div>
        </section>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {DARSLIK_TRACKS.map((t) => {
            const c = counts.get(t.key);
            const active = track === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTrack(t.key)}
                className={cn(
                  "rounded-2xl border p-3 text-left transition sm:p-4",
                  active ? "border-[#2AABEE] bg-[#2AABEE]/10 shadow-sm" : "border-border bg-card hover:border-[#2AABEE]/40",
                )}
              >
                <p className={cn("text-sm font-bold sm:text-base", active ? "text-[#1583bd] dark:text-sky-300" : "text-foreground")}>
                  {t.label}
                </p>
                <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{t.hint}</p>
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {c ? `${c.sections} bo‘lim · ${c.published}/${c.total} dars` : "—"}
                </p>
              </button>
            );
          })}
        </div>

        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {(
            [
              { key: "lessons", label: "Darslar", icon: GraduationCap },
              { key: "results", label: "Natijalar", icon: BarChart3 },
            ] as const
          ).map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => setTab(x.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition",
                tab === x.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <x.icon className="h-4 w-4" /> {x.label}
            </button>
          ))}
        </div>

        {tab === "results" ? (
          <ResultsPanel track={track} />
        ) : manage.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-36 rounded-3xl" />
            <Skeleton className="h-36 rounded-3xl" />
          </div>
        ) : manage.isError ? (
          <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{(manage.error as Error)?.message}</p>
        ) : !openSection ? (
          <div className="space-y-4">
            {sectionForm ? (
              <div className="space-y-3 rounded-3xl border border-[#2AABEE]/40 bg-card p-4 shadow-sm sm:p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">{sectionForm.id ? "Bo‘limni tahrirlash" : "Yangi bo‘lim"}</h2>
                  <Button variant="ghost" size="icon" onClick={() => setSectionForm(null)} aria-label="Yopish">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Bo‘lim nomi *</Label>
                    <Input value={sectionForm.title} maxLength={140} placeholder="Masalan: Dori saqlash" onChange={(e) => setSectionForm({ ...sectionForm, title: e.target.value })} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Qisqa tavsif</Label>
                    <Input value={sectionForm.description} maxLength={600} placeholder="Bo‘lim nima haqida" onChange={(e) => setSectionForm({ ...sectionForm, description: e.target.value })} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="flex items-center gap-2"><ImageIcon className="h-4 w-4" /> Muqova rasmi</Label>
                    <label className="flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-dashed border-border bg-muted/30">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="sr-only"
                        disabled={coverBusy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          void onCoverFile(file);
                        }}
                      />
                      {sectionForm.coverUrl ? (
                        <AuthImage url={sectionForm.coverUrl} alt="Muqova" className="h-40 w-full object-cover" />
                      ) : (
                        <span className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                          {coverBusy ? "Yuklanmoqda…" : "Rasmni tanlang"}
                        </span>
                      )}
                    </label>
                    {sectionForm.coverUrl ? (
                      <button
                        type="button"
                        className="text-xs font-semibold text-rose-600"
                        onClick={() => setSectionForm({ ...sectionForm, coverUrl: "" })}
                      >
                        Rasmni olib tashlash
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={sectionForm.published} onCheckedChange={(v) => setSectionForm({ ...sectionForm, published: v })} />
                    {sectionForm.published ? "Xodimlarga ko‘rinadi" : "Yashirin"}
                  </label>
                  <Button className="bg-[#2AABEE] hover:bg-[#229ED9]" disabled={saveSection.isPending} onClick={() => void saveSectionForm()}>
                    <Save className="mr-1.5 h-4 w-4" /> Saqlash
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                className="h-11 w-full rounded-2xl bg-[#2AABEE] hover:bg-[#229ED9]"
                onClick={() => setSectionForm({ id: null, title: "", description: "", coverUrl: "", published: true })}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Bo‘lim ochish
              </Button>
            )}
            {!sections.length ? (
              <div className="rounded-3xl border border-dashed border-border bg-card/70 p-10 text-center text-sm text-muted-foreground">
                Avval bo‘lim oching. Xodim muqovani bosib, shu bo‘limdagi darslarga kiradi.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sections.map((s, i) => (
                  <article key={s.id} className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
                    <button type="button" className="block w-full text-left" onClick={() => { setOpenId(s.id); setEditing(null); }}>
                      <div className="relative h-36 bg-gradient-to-br from-[#16324F] to-[#2AABEE]">
                        {s.coverUrl ? (
                          <AuthImage url={s.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        ) : null}
                        <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/75 to-transparent" />
                        <span className="absolute bottom-2 left-3 right-3 text-base font-bold text-white drop-shadow">{s.title}</span>
                      </div>
                      <div className="space-y-1 p-3">
                        {s.description ? <p className="line-clamp-2 text-xs text-muted-foreground">{s.description}</p> : null}
                        <p className="text-xs font-medium text-foreground">{s.lessonCount} dars · {s.publishedCount} faol</p>
                      </div>
                    </button>
                    <div className="flex items-center justify-between border-t border-border px-2 py-1">
                      <div>
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === 0 || reorderSections.isPending} onClick={() => void moveSection(i, -1)} aria-label="Oldinga">
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={i === sections.length - 1 || reorderSections.isPending} onClick={() => void moveSection(i, 1)} aria-label="Keyinga">
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                      <div>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Tahrirlash" onClick={() => setSectionForm({ id: s.id, title: s.title, description: s.description, coverUrl: s.coverUrl, published: s.published })}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" aria-label="O‘chirish" onClick={() => setDeleteSection(s)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="h-10" onClick={() => { setOpenId(null); setEditing(null); }}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Bo‘limlar
              </Button>
              <div className="min-w-0">
                <p className="truncate text-lg font-bold text-foreground">{openSection.title}</p>
                <p className="text-xs text-muted-foreground">{lessons.length} dars · ketma-ket</p>
              </div>
            </div>
            <form
              className="grid gap-2 rounded-3xl border border-border bg-card p-3 shadow-sm sm:grid-cols-[1fr_1fr_auto]"
              onSubmit={(e) => { e.preventDefault(); void quickAdd(); }}
            >
              <Input value={quickTitle} placeholder="Yangi dars nomi" onChange={(e) => setQuickTitle(e.target.value)} />
              <Input value={quickVideo} placeholder="Video havolasi (ixtiyoriy)" onChange={(e) => setQuickVideo(e.target.value)} />
              <Button type="submit" className="bg-[#2AABEE] hover:bg-[#229ED9]" disabled={saveLesson.isPending}>
                <Plus className="mr-1.5 h-4 w-4" /> Qo‘shish
              </Button>
            </form>
            {editing ? (
              <LessonEditor key={editing.id ?? "new"} track={track} sectionId={openSection.id} initial={editing} onClose={() => setEditing(null)} />
            ) : (
              <button type="button" className="text-sm font-semibold text-[#2AABEE] hover:underline" onClick={() => setEditing(emptyDraft())}>
                To‘liq forma: tavsif, slayd va test
              </button>
            )}
            {!lessons.length ? (
              <div className="rounded-3xl border border-dashed border-border bg-card/70 p-10 text-center text-sm text-muted-foreground">
                Bu bo‘limda hali dars yo‘q. Nomini yozib, Qo‘shish ni bosing.
              </div>
            ) : (
              <div className="space-y-2.5">
                {lessons.map((l, i) => (
                  <div
                    key={l.id}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm sm:flex-nowrap sm:p-4",
                      editing?.id === l.id ? "border-[#2AABEE]" : "border-border",
                      !l.published && "opacity-70",
                    )}
                  >
                    <div className="flex flex-col">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={i === 0 || reorder.isPending}
                        onClick={() => void move(i, -1)}
                        aria-label="Yuqoriga"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={i === lessons.length - 1 || reorder.isPending}
                        onClick={() => void move(i, 1)}
                        aria-label="Pastga"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2AABEE]/10 text-sm font-bold text-[#1583bd]">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-foreground">{l.title}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                        {l.videoKind ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">
                            <Video className="h-3 w-3" /> {l.videoKind === "youtube" ? "YouTube" : "Drive video"}
                          </span>
                        ) : null}
                        {l.driveFileId ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-violet-800">
                            <FileText className="h-3 w-3" /> Slayd
                          </span>
                        ) : null}
                        {l.questions.length ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                            <ClipboardList className="h-3 w-3" /> {l.questions.length} savol · {l.passScore}%
                          </span>
                        ) : null}
                        {!l.published ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Qoralama</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={l.published}
                        disabled={publish.isPending}
                        onCheckedChange={() => void togglePublish(l)}
                        aria-label="Ko‘rinishi"
                      />
                      <Button variant="ghost" size="icon" onClick={() => setEditing(draftFromLesson(l))} aria-label="Tahrirlash">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-600"
                        onClick={() => setToDelete(l)}
                        aria-label="O‘chirish"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <AlertDialog open={Boolean(toDelete)} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Darsni o‘chirasizmi?</AlertDialogTitle>
            <AlertDialogDescription>
              “{toDelete?.title}” butunlay o‘chiriladi. Xodimlarning shu dars bo‘yicha natijalari ham hisobdan chiqadi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void confirmDelete()}>
              O‘chirish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={Boolean(deleteSection)} onOpenChange={(o) => !o && setDeleteSection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bo‘limni o‘chirasizmi?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteSection?.title}” o‘chadi. Ichida dars bo‘lsa, avval darslarni o‘chirish kerak.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor qilish</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (!deleteSection) return;
                void removeSection.mutateAsync(deleteSection.id).then(
                  () => toast({ title: "Bo‘lim o‘chirildi" }),
                  (e: Error) => toast({ title: e.message, variant: "destructive" }),
                );
                setDeleteSection(null);
              }}
            >
              O‘chirish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
