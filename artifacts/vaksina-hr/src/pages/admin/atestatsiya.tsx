import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  ClipboardList,
  Eye,
  FileDown,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
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
  ATTESTATSIYA_TRACKS,
  ATTEST_STATUS_LABEL,
  formatAttestDt,
  isoToLocalInput,
  localInputToIso,
  useAnnulAttempt,
  useAttestManage,
  useAttestMonitor,
  useAttestResults,
  useDeleteAttest,
  useFinishAttempt,
  useGrantRetake,
  usePublishAttest,
  useRestoreAttempt,
  useSaveAttestExam,
  startAttestPreview,
  type AttestLearnerAttempt,
  type AttestManageExam,
  type AttestMonitorRow,
  type AttestQuestion,
  type AttestTrack,
} from "@/lib/atestatsiya-api";
import { exportAttestExcel, exportAttestPdf, exportAttestResultsExcel, exportAttestResultsPdf } from "@/lib/atestatsiya-export";
import { ExamRunner } from "@/pages/atestatsiya";

type Draft = {
  id: number | null;
  title: string;
  description: string;
  passScore: number;
  durationMinutes: number;
  locationMode: "branch" | "office";
  startsAt: string;
  endsAt: string;
  shuffleQuestions: boolean;
  showResult: boolean;
  published: boolean;
  questions: AttestQuestion[];
  lockedQuestions: boolean;
};

function audienceTo(track: AttestTrack): string {
  if (track === "farmasevt") return "barcha farmasevtlarga";
  if (track === "mudir") return "barcha mudirlarga";
  return "barcha stajyorlarga";
}

function emptyQuestion(): AttestQuestion {
  return { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: "", options: ["", "", "", ""], correctIndex: 0 };
}

function emptyDraft(): Draft {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 3 * 3_600_000);
  return {
    id: null,
    title: "",
    description: "",
    passScore: 50,
    durationMinutes: 30,
    locationMode: "branch",
    startsAt: isoToLocalInput(start.toISOString()),
    endsAt: isoToLocalInput(end.toISOString()),
    shuffleQuestions: true,
    showResult: true,
    published: true,
    questions: [emptyQuestion()],
    lockedQuestions: false,
  };
}

function fromExam(e: AttestManageExam): Draft {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    passScore: e.passScore,
    durationMinutes: e.durationMinutes,
    locationMode: e.locationMode,
    startsAt: isoToLocalInput(e.startsAt),
    endsAt: isoToLocalInput(e.endsAt),
    shuffleQuestions: e.shuffleQuestions,
    showResult: e.showResult,
    published: e.published,
    questions: e.questions.map((q) => ({ ...q, options: [...q.options] })),
    lockedQuestions: e.stats.hasAttempts,
  };
}

function ExamEditor({ track, initial, onClose }: { track: AttestTrack; initial: Draft; onClose: () => void }) {
  const { toast } = useToast();
  const save = useSaveAttestExam();
  const [d, setD] = useState(initial);
  const setQ = (i: number, patch: Partial<AttestQuestion>) =>
    setD((p) => ({ ...p, questions: p.questions.map((q, n) => (n === i ? { ...q, ...patch } : q)) }));

  const onSave = async () => {
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
        title: d.title.trim(),
        description: d.description.trim(),
        questions,
        passScore: d.passScore,
        durationMinutes: d.durationMinutes,
        locationMode: d.locationMode,
        startsAt: localInputToIso(d.startsAt),
        endsAt: localInputToIso(d.endsAt),
        shuffleQuestions: d.shuffleQuestions,
        showResult: d.showResult,
        published: d.published,
      });
      toast({ title: d.id ? "Atestatsiya yangilandi" : "Atestatsiya yaratildi" });
      onClose();
    } catch (e) {
      toast({ title: "Saqlanmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 rounded-3xl border border-[#2AABEE]/40 bg-card p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{d.id ? "Atestatsiyani tahrirlash" : "Yangi atestatsiya"}</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Yopish">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label>Nomi *</Label>
        <Input value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Masalan: Sentyabr atestatsiyasi" />
      </div>
      <div className="space-y-1.5">
        <Label>Tavsif</Label>
        <Textarea rows={2} value={d.description} maxLength={3000} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Boshlanish</Label>
          <Input type="datetime-local" value={d.startsAt} onChange={(e) => setD({ ...d, startsAt: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Tugash</Label>
          <Input type="datetime-local" value={d.endsAt} onChange={(e) => setD({ ...d, endsAt: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Test davomiyligi, daqiqa</Label>
          <Input type="number" min={1} max={600} value={d.durationMinutes} onChange={(e) => setD({ ...d, durationMinutes: Math.round(Number(e.target.value) || 0) })} />
        </div>
        <div className="space-y-1.5">
          <Label>O‘tish bali, %</Label>
          <Input type="number" min={1} max={100} value={d.passScore} onChange={(e) => setD({ ...d, passScore: Math.round(Number(e.target.value) || 0) })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["branch", "O‘z filialida", "Xodim faqat biriktirilgan filial hududida boshlaydi"],
            ["office", "Asosiy ofisda", "Xodim faqat ofis hududida boshlaydi"],
          ] as const
        ).map(([key, label, hint]) => (
          <button
            key={key}
            type="button"
            onClick={() => setD({ ...d, locationMode: key })}
            className={cn(
              "rounded-2xl border p-3 text-left",
              d.locationMode === key ? "border-[#2AABEE] bg-[#2AABEE]/10" : "border-border",
            )}
          >
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <MapPin className="h-4 w-4 text-[#2AABEE]" /> {label}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
          </button>
        ))}
      </div>

      <div className="space-y-3 rounded-2xl border border-border p-3">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[#2AABEE]" /> Savollar ({d.questions.length})
          </Label>
          {d.lockedQuestions ? <span className="text-[11px] text-amber-700">Boshlangan — savollar qulflangan</span> : null}
        </div>
        {d.questions.map((q, qi) => (
          <div key={q.id} className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex gap-2">
              <span className="mt-2 text-sm font-bold text-[#2AABEE]">{qi + 1}.</span>
              <Textarea rows={2} disabled={d.lockedQuestions} value={q.text} placeholder="Savol" onChange={(e) => setQ(qi, { text: e.target.value })} />
              <Button variant="ghost" size="icon" className="text-red-600" disabled={d.lockedQuestions} onClick={() => setD({ ...d, questions: d.questions.filter((_, i) => i !== qi) })}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {q.options.map((opt, oi) => (
                <label key={oi} className={cn("flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5", q.correctIndex === oi && "border-emerald-500")}>
                  <input type="radio" disabled={d.lockedQuestions} name={`c-${q.id}`} checked={q.correctIndex === oi} onChange={() => setQ(qi, { correctIndex: oi })} className="accent-emerald-600" />
                  <span className="text-xs font-bold text-muted-foreground">{String.fromCharCode(65 + oi)}</span>
                  <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" disabled={d.lockedQuestions} value={opt} placeholder={`Variant ${String.fromCharCode(65 + oi)}`} onChange={(e) => setQ(qi, { options: q.options.map((o, i) => (i === oi ? e.target.value : o)) })} />
                </label>
              ))}
            </div>
          </div>
        ))}
        <Button variant="outline" className="w-full border-dashed" disabled={d.lockedQuestions} onClick={() => setD({ ...d, questions: [...d.questions, emptyQuestion()] })}>
          <Plus className="mr-1.5 h-4 w-4" /> Savol qo‘shish
        </Button>
      </div>

      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:items-center">
        <label className="flex items-center gap-2"><Switch checked={d.shuffleQuestions} onCheckedChange={(v) => setD({ ...d, shuffleQuestions: v })} /> Savollar aralashsin</label>
        <label className="flex items-center gap-2"><Switch checked={d.showResult} onCheckedChange={(v) => setD({ ...d, showResult: v })} /> Natijani xodim ko‘rsin</label>
        <div className={cn("w-full rounded-2xl border px-3 py-2.5 sm:basis-full", d.published ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold">{d.published ? "E’lon qilingan" : "Hali e’lon qilinmagan"}</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                {d.published
                  ? `Saqlangach test ${audienceTo(track)} ko‘rinadi. Ular muddat ichida topshiradi.`
                  : `Saqlangach test faqat sizda (trenerda) qoladi. ${audienceTo(track)} chiqmaydi. Tayyor bo‘lgach e’lon qilasiz.`}
              </span>
            </span>
            <Switch checked={d.published} onCheckedChange={(v) => setD({ ...d, published: v })} />
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
        <Button variant="outline" onClick={onClose}>Bekor</Button>
        <Button className="bg-[#2AABEE] hover:bg-[#229ED9]" disabled={save.isPending} onClick={() => void onSave()}>
          <Save className="mr-1.5 h-4 w-4" /> {save.isPending ? "Saqlanmoqda…" : "Saqlash"}
        </Button>
      </div>
    </div>
  );
}

const FILTERS = [
  ["all", "Hammasi"],
  ["in_progress", "Ishlayapti"],
  ["passed", "O‘tgan"],
  ["failed", "O‘tmagan"],
  ["not_started", "Boshlamagan"],
  ["annulled", "Bekor"],
] as const;

function Monitor({ examId, onBack }: { examId: number; onBack: () => void }) {
  const { toast } = useToast();
  const q = useAttestMonitor(examId);
  const annul = useAnnulAttempt();
  const restore = useRestoreAttempt();
  const finish = useFinishAttempt();
  const retake = useGrantRetake();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [search, setSearch] = useState("");
  const [annulFor, setAnnulFor] = useState<AttestMonitorRow | null>(null);
  const [reason, setReason] = useState("");
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const data = q.data;

  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    const s = search.trim().toLowerCase();
    return list.filter((r) => {
      if (s && !`${r.fullName} ${r.branchLabel || ""}`.toLowerCase().includes(s)) return false;
      if (filter === "passed") return r.passed === true && (r.status === "submitted" || r.status === "expired");
      if (filter === "failed") return r.passed === false && (r.status === "submitted" || r.status === "expired");
      if (filter === "all") return true;
      return r.status === filter;
    });
  }, [data?.rows, filter, search]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast({ title: ok });
      void q.refetch();
    } catch (e) {
      toast({ title: "Amal bajarilmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const runExport = async (kind: "excel" | "pdf") => {
    if (!data) return;
    setExporting(kind);
    try {
      if (kind === "excel") await exportAttestExcel(data);
      else await exportAttestPdf(data);
      toast({ title: "Fayl yuklandi" });
    } catch (e) {
      toast({ title: "Yuklab bo‘lmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  if (q.isLoading) return <Skeleton className="h-64 rounded-3xl" />;
  if (q.isError || !data) return <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{(q.error as Error)?.message || "Yuklanmadi"}</p>;
  const s = data.stats;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" /> Orqaga</Button>
        <h2 className="min-w-0 flex-1 truncate text-lg font-bold">{data.exam.title}</h2>
        <Button size="sm" variant="outline" disabled={exporting !== null} onClick={() => void runExport("excel")}>
          {exporting === "excel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />} Excel
        </Button>
        <Button size="sm" variant="outline" disabled={exporting !== null} onClick={() => void runExport("pdf")}>
          {exporting === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5 text-rose-700" />} PDF
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {data.trackLabel} · {formatAttestDt(data.exam.startsAt)} – {formatAttestDt(data.exam.endsAt)} · {data.exam.durationMinutes} daq ·{" "}
        {data.exam.locationMode === "office" ? "Asosiy ofis" : "O‘z filiali"} · har 10 soniyada yangilanadi
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {[
          ["Xodim", s.targets],
          ["Boshlamagan", s.notStarted],
          ["Ishlayapti", s.inProgress],
          ["Tugatgan", s.finished],
          ["O‘tgan", s.passed],
          ["O‘tmagan", s.failed],
          ["O‘tish", s.passRate != null ? `${s.passRate}%` : "—"],
          ["O‘rtacha", s.avgScore != null ? `${s.avgScore}%` : "—"],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-2xl border border-border bg-card p-3 text-center">
            <p className="text-lg font-bold tabular-nums">{v}</p>
            <p className="text-[11px] text-muted-foreground">{k}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">Ball taqsimoti</p>
          {s.buckets.map((b) => (
            <div key={b.label} className="mb-1.5 flex items-center gap-2 text-xs">
              <span className="w-14 text-muted-foreground">{b.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-[#2AABEE]" style={{ width: `${s.finished ? (b.count / s.finished) * 100 : 0}%` }} />
              </div>
              <span className="w-6 text-right tabular-nums">{b.count}</span>
            </div>
          ))}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Eng yuqori {s.maxScore ?? "—"} · eng past {s.minScore ?? "—"} · o‘rtacha vaqt {s.avgDurationMin ?? "—"} daq · fokus yo‘qotgan {s.focusLostPeople}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">Filiallar</p>
          <div className="max-h-48 space-y-1 overflow-y-auto text-xs">
            {data.branches.map((b) => (
              <div key={b.label} className="flex items-center justify-between gap-2">
                <span className="truncate">{b.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{b.passed}/{b.finished} o‘tdi · {b.avgScore ?? "—"}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {data.questionStats.length ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">Qaysi savol qiyin</p>
          <div className="space-y-1.5">
            {data.questionStats.map((qq) => (
              <div key={qq.id} className="flex items-center gap-2 text-xs">
                <span className="w-6 font-bold text-[#2AABEE]">{qq.number}</span>
                <span className="min-w-0 flex-1 truncate" title={qq.text}>{qq.text}</span>
                <span className={cn("w-12 text-right font-semibold tabular-nums", (qq.percent ?? 100) < 50 && "text-rose-600")}>{qq.percent ?? "—"}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-9 max-w-xs" placeholder="Xodim yoki filial…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={cn("rounded-full px-3 py-1 text-xs font-semibold", filter === k ? "bg-foreground text-background" : "bg-card text-muted-foreground ring-1 ring-border")}>
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.userId} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{r.fullName}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {r.branchLabel || "Filialsiz"}
                {r.locationLabel ? ` · ${r.locationLabel}${r.distanceM != null ? ` (${r.distanceM} m)` : ""}` : ""}
                {r.focusLost ? ` · fokus ${r.focusLost}` : ""}
              </p>
            </div>
            <div className="text-right text-xs">
              <p className={cn("font-semibold", r.passed ? "text-emerald-700" : r.passed === false ? "text-rose-700" : "text-foreground")}>
                {r.score != null ? `${r.score}%` : ATTEST_STATUS_LABEL[r.status]}
              </p>
              <p className="text-muted-foreground">
                {r.status === "in_progress" && r.remainingSec != null
                  ? `${Math.ceil(r.remainingSec / 60)} daq qoldi · ${r.answeredCount}/${r.total}`
                  : r.attemptsCount
                    ? `${r.attemptsCount}-urinish`
                    : "—"}
                {r.retakeAllowed ? " · qayta ruxsat" : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {r.status === "in_progress" && r.attemptId ? (
                <Button size="sm" variant="outline" className="h-8" disabled={finish.isPending} onClick={() => void act(() => finish.mutateAsync(r.attemptId!), "Yakunlandi")}>Yakunlash</Button>
              ) : null}
              {r.status !== "not_started" && r.status !== "in_progress" ? (
                <Button size="sm" variant="outline" className="h-8" disabled={retake.isPending} onClick={() => void act(() => retake.mutateAsync({ examId, userId: r.userId }), "Qayta topshirishga ruxsat berildi")}>Qayta</Button>
              ) : null}
              {r.status === "annulled" && r.attemptId ? (
                <Button size="sm" variant="outline" className="h-8" onClick={() => void act(() => restore.mutateAsync(r.attemptId!), "Natija tiklandi")}>Tiklash</Button>
              ) : null}
              {r.attemptId && r.status !== "annulled" ? (
                <Button size="sm" variant="ghost" className="h-8 text-rose-600" onClick={() => { setReason(""); setAnnulFor(r); }}>Bekor</Button>
              ) : null}
            </div>
          </div>
        ))}
        {!rows.length ? <p className="py-8 text-center text-sm text-muted-foreground">Hech kim topilmadi</p> : null}
      </div>

      <AlertDialog open={Boolean(annulFor)} onOpenChange={(o) => !o && setAnnulFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Natijani bekor qilasizmi?</AlertDialogTitle>
            <AlertDialogDescription>{annulFor?.fullName} natijasi hisobdan chiqadi. Qayta topshirish alohida ruxsat bilan beriladi.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sabab (ixtiyoriy)" maxLength={400} />
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => {
                if (!annulFor?.attemptId) return;
                void act(() => annul.mutateAsync({ id: annulFor.attemptId!, reason }), "Natija bekor qilindi");
                setAnnulFor(null);
              }}
            >
              Bekor qilish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ResultsBoard({ track }: { track: AttestTrack }) {
  const { toast } = useToast();
  const q = useAttestResults(track, true);
  const [examId, setExamId] = useState<number | "all">("all");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const data = q.data;

  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    const s = search.trim().toLowerCase();
    return list.filter((r) => {
      if (examId !== "all" && r.examId !== examId) return false;
      if (s && !`${r.fullName} ${r.branchLabel || ""} ${r.phone || ""} ${r.examTitle}`.toLowerCase().includes(s)) return false;
      if (filter === "passed") return r.passed === true && (r.status === "submitted" || r.status === "expired");
      if (filter === "failed") return r.passed === false && (r.status === "submitted" || r.status === "expired");
      if (filter === "all") return true;
      return r.status === filter;
    });
  }, [data?.rows, examId, filter, search]);

  const runExport = async (kind: "excel" | "pdf") => {
    if (!data) return;
    const payload = { ...data, rows };
    setExporting(kind);
    try {
      if (kind === "excel") await exportAttestResultsExcel(payload);
      else await exportAttestResultsPdf(payload);
      toast({ title: "Fayl yuklandi" });
    } catch (e) {
      toast({ title: "Yuklab bo‘lmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  if (q.isLoading) return <Skeleton className="h-64 rounded-3xl" />;
  if (q.isError || !data) {
    return <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{(q.error as Error)?.message || "Yuklanmadi"}</p>;
  }
  const s = data.stats;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">Natijalar · {data.trackLabel}</h2>
          <p className="text-xs text-muted-foreground">Har bir xodim va har bir atestatsiya alohida qator. Jadval 20 soniyada yangilanadi.</p>
        </div>
        <Button size="sm" variant="outline" disabled={exporting !== null || !rows.length} onClick={() => void runExport("excel")}>
          {exporting === "excel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />} Excel
        </Button>
        <Button size="sm" variant="outline" disabled={exporting !== null || !rows.length} onClick={() => void runExport("pdf")}>
          {exporting === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5 text-rose-700" />} PDF
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {[
          ["Xodim", s.people],
          ["Test", s.exams],
          ["Boshlamagan", s.notStarted],
          ["Ishlayapti", s.inProgress],
          ["Tugatgan", s.finished],
          ["O‘tgan", s.passed],
          ["O‘tish", s.passRate != null ? `${s.passRate}%` : "—"],
          ["O‘rtacha", s.avgScore != null ? `${s.avgScore}%` : "—"],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-2xl border border-border bg-card p-3 text-center">
            <p className="text-lg font-bold tabular-nums">{v}</p>
            <p className="text-[11px] text-muted-foreground">{k}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-9 max-w-xs" placeholder="Xodim, telefon, filial…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={examId}
          onChange={(e) => setExamId(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">Barcha atestatsiyalar</option>
          {data.exams.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={cn("rounded-full px-3 py-1 text-xs font-semibold", filter === k ? "bg-foreground text-background" : "bg-card text-muted-foreground ring-1 ring-border")}>
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[1100px] text-left text-xs">
          <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <tr>
              {["Xodim", "Filial", "Atestatsiya", "Holat", "Ball", "To‘g‘ri", "Urinish", "Joy", "Masofa", "Fokus", "Vaqt", "Boshlangan", "Topshirilgan"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.examId}-${r.userId}`} className="border-t border-border/70">
                <td className="px-3 py-2">
                  <p className="font-semibold text-foreground">{r.fullName}</p>
                  <p className="text-[10px] text-muted-foreground">{r.phone || "—"}</p>
                </td>
                <td className="px-3 py-2">{r.branchLabel || "—"}</td>
                <td className="max-w-[180px] px-3 py-2">
                  <p className="truncate font-medium" title={r.examTitle}>{r.examTitle}</p>
                  <p className="text-[10px] text-muted-foreground">{r.locationMode === "office" ? "Ofis" : "Filial"} · o‘tish {r.passScore}%</p>
                </td>
                <td className={cn("whitespace-nowrap px-3 py-2 font-semibold", r.passed ? "text-emerald-700" : r.passed === false ? "text-rose-700" : "")}>
                  {r.status === "submitted" || r.status === "expired" ? (r.passed ? "O‘tdi" : "O‘tmadi") : ATTEST_STATUS_LABEL[r.status]}
                  {r.retakeAllowed ? <span className="ml-1 font-normal text-muted-foreground">· qayta</span> : null}
                  {r.annulReason ? <p className="max-w-[140px] truncate font-normal text-muted-foreground" title={r.annulReason}>{r.annulReason}</p> : null}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.score != null ? `${r.score}%` : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{r.correct != null ? `${r.correct}/${r.total}` : `—/${r.total}`}</td>
                <td className="px-3 py-2 tabular-nums">{r.attemptsCount || "—"}</td>
                <td className="max-w-[120px] truncate px-3 py-2" title={r.locationLabel || ""}>{r.locationLabel || "—"}</td>
                <td className="px-3 py-2 tabular-nums">{r.distanceM != null ? `${r.distanceM} m` : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{r.focusLost || "—"}</td>
                <td className="px-3 py-2 tabular-nums">{r.durationSec != null ? `${Math.floor(r.durationSec / 60)}:${String(r.durationSec % 60).padStart(2, "0")}` : "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatAttestDt(r.startedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatAttestDt(r.submittedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="py-8 text-center text-sm text-muted-foreground">Natija topilmadi</p> : null}
      </div>
      <p className="text-[11px] text-muted-foreground">Excelda telefon, GPS aniqligi, bekor sababi va test oynasi ham bor. PDF joriy filtrlangan jadvalni yuklaydi.</p>
    </div>
  );
}

export default function AtestatsiyaAdminPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canManageDarsliklar(user?.role);
  const [track, setTrack] = useState<AttestTrack>("stajyor");
  const [tab, setTab] = useState<"exams" | "results">("exams");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [monitorId, setMonitorId] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<AttestManageExam | null>(null);
  const [tryingId, setTryingId] = useState<number | null>(null);
  const [practice, setPractice] = useState<{
    title: string;
    attempt: AttestLearnerAttempt;
    serverNow: string;
    examId: number;
  } | null>(null);
  const [trial, setTrial] = useState<{
    title: string;
    score: number | null;
    correct: number | null;
    total: number;
    passed: boolean | null;
  } | null>(null);
  const manage = useAttestManage(track, allowed);
  const publish = usePublishAttest();
  const remove = useDeleteAttest();

  useEffect(() => {
    setEditing(null);
    setMonitorId(null);
  }, [track]);

  if (!allowed) {
    return <div className="flex h-full items-center justify-center p-8 text-muted-foreground">Bu bo‘lim faqat admin va trener uchun.</div>;
  }
  const counts = new Map((manage.data?.tracks ?? []).map((t) => [t.key, t]));

  const beginTrial = async (exam: AttestManageExam) => {
    if (!exam.questions.length) {
      toast({ title: "Testda savollar yo‘q", variant: "destructive" });
      return;
    }
    setTryingId(exam.id);
    try {
      const res = await startAttestPreview(exam.id);
      setTrial(null);
      setPractice({ title: exam.title, attempt: res.attempt, serverNow: res.serverNow, examId: exam.id });
    } catch (err) {
      toast({ title: "Test ochilmadi", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setTryingId(null);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {practice ? (
        <ExamRunner
          attempt={practice.attempt}
          serverNow={practice.serverNow}
          practiceExamId={practice.examId}
          onDone={(result) => {
            const title = practice.title;
            setPractice(null);
            setTrial({
              title,
              score: result.score,
              correct: result.correct,
              total: result.total,
              passed: result.passed,
            });
          }}
        />
      ) : null}
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:py-8">
        <section className="surface-brand rounded-3xl p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                <BadgeCheck className="h-6 w-6" />
              </span>
              <div>
                <h1 className="text-xl font-bold sm:text-2xl">Atestatsiya joylash</h1>
                <p className="mt-1 max-w-xl text-sm opacity-80">
                  Stajyor, farmasevt va mudir uchun alohida test. Joy, vaqt va davomiylikni belgilang, natijalarni jonli kuzating.
                </p>
              </div>
            </div>
            <Link href="/atestatsiya" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold ring-1 ring-white/25">
              <Eye className="h-4 w-4" /> Xodim ko‘rinishi
            </Link>
          </div>
        </section>

        <div className="grid grid-cols-3 gap-2">
          {ATTESTATSIYA_TRACKS.map((t) => {
            const c = counts.get(t.key);
            return (
              <button key={t.key} type="button" onClick={() => setTrack(t.key)} className={cn("rounded-2xl border p-3 text-left", track === t.key ? "border-[#2AABEE] bg-[#2AABEE]/10" : "border-border bg-card")}>
                <p className="text-sm font-bold">{t.label}</p>
                <p className="text-xs text-muted-foreground">{c ? `${c.open} ochiq / ${c.total}` : "—"}</p>
              </button>
            );
          })}
        </div>

        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {(
            [
              ["exams", "Atestatsiyalar"],
              ["results", "Natijalar"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                if (key === "results") setMonitorId(null);
              }}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold",
                tab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {key === "results" ? <BarChart3 className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
              {label}
            </button>
          ))}
        </div>

        {tab === "results" ? (
          <ResultsBoard track={track} />
        ) : monitorId ? (
          <Monitor examId={monitorId} onBack={() => setMonitorId(null)} />
        ) : (
          <>
            {editing ? (
              <ExamEditor key={editing.id ?? "new"} track={track} initial={editing} onClose={() => setEditing(null)} />
            ) : (
              <Button className="h-11 w-full rounded-2xl bg-[#2AABEE] hover:bg-[#229ED9]" onClick={() => setEditing(emptyDraft())}>
                <Plus className="mr-1.5 h-4 w-4" /> Yangi atestatsiya
              </Button>
            )}
            {trial ? (
              <div
                className={cn(
                  "rounded-2xl border px-4 py-3 text-sm",
                  trial.passed ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-rose-200 bg-rose-50 text-rose-950",
                )}
              >
                <p className="font-semibold">
                  Sinov natijasi · {trial.title}
                  {trial.score != null ? ` · ${trial.score}%` : ""}
                  {trial.correct != null ? ` (${trial.correct}/${trial.total})` : ""}
                </p>
                <p className="mt-0.5 text-xs opacity-80">
                  {trial.passed ? "O‘tish balidan o‘tdi." : "O‘tish bali yetmadi."} Bu sinov saqlanmadi, xodimlar ro‘yxatiga tushmaydi.
                </p>
              </div>
            ) : null}
            {manage.isLoading ? (
              <Skeleton className="h-24 rounded-2xl" />
            ) : manage.isError ? (
              <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{(manage.error as Error).message}</p>
            ) : (
              <div className="space-y-2">
                {(manage.data?.exams ?? []).map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{e.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatAttestDt(e.startsAt)} – {formatAttestDt(e.endsAt)} · {e.durationMinutes} daq · {e.locationMode === "office" ? "Ofis" : "Filial"} · {e.questions.length} savol · o‘tish {e.passScore}%
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className={cn("rounded-full px-2 py-0.5 font-semibold", e.window === "open" ? "bg-sky-100 text-sky-800" : e.window === "upcoming" ? "bg-slate-100 text-slate-700" : "bg-muted text-muted-foreground")}>
                          {e.window === "open" ? "Muddat ichida" : e.window === "upcoming" ? "Muddat hali boshlanmagan" : "Muddat tugagan"}
                        </span>
                        <span className="text-muted-foreground">{e.stats.passed}/{e.stats.finished} o‘tdi · {e.stats.inProgress} ishlayapti</span>
                      </p>
                      <div className={cn("mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2", e.published ? "bg-emerald-50" : "bg-amber-50")}>
                        <div className="min-w-0">
                          <p className={cn("text-xs font-semibold", e.published ? "text-emerald-800" : "text-amber-900")}>
                            {e.published ? "E’lon qilingan" : "E’lon qilinmagan"}
                          </p>
                          <p className="text-[11px] leading-snug text-muted-foreground">
                            {e.published
                              ? `Test ${audienceTo(track)} ko‘rinadi. Muddat ichida topshirishlari mumkin.`
                              : `Xodimlarga chiqmaydi. Sinab ko‘rish mumkin — natija saqlanmaydi va ro‘yxatga tushmaydi.`}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={e.published ? "outline" : "default"}
                          className={cn("h-8 shrink-0", !e.published && "bg-amber-600 text-white hover:bg-amber-700")}
                          disabled={publish.isPending}
                          onClick={() =>
                            void publish
                              .mutateAsync({ id: e.id, published: !e.published })
                              .then(() =>
                                toast({
                                  title: e.published ? "E’lon yopildi" : "E’lon qilindi",
                                  description: e.published
                                    ? "Test yana faqat trenerda. Xodimlar ko‘rmaydi."
                                    : `Test ${audienceTo(track)} ko‘rinadi.`,
                                }),
                              )
                              .catch((err: Error) => toast({ title: err.message, variant: "destructive" }))
                          }
                        >
                          {e.published ? "E’lonni yopish" : "E’lon qilish"}
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={tryingId === e.id || !e.questions.length}
                        onClick={() => void beginTrial(e)}
                      >
                        {tryingId === e.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                        Sinab ko‘rish
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setMonitorId(e.id)}><BarChart3 className="mr-1 h-3.5 w-3.5" /> Natija</Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditing(fromExam(e))} aria-label="Tahrirlash"><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="text-red-600" onClick={() => setToDelete(e)} aria-label="O‘chirish"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
                {!manage.data?.exams.length ? <p className="py-8 text-center text-sm text-muted-foreground">Bu yo‘nalishda atestatsiya yo‘q.</p> : null}
              </div>
            )}
          </>
        )}
      </div>
      <AlertDialog open={Boolean(toDelete)} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Atestatsiyani o‘chirasizmi?</AlertDialogTitle>
            <AlertDialogDescription>«{toDelete?.title}» va barcha natijalari o‘chadi.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => { if (toDelete) void remove.mutateAsync(toDelete.id).then(() => toast({ title: "O‘chirildi" })); setToDelete(null); }}>O‘chirish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
