import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Building2,
  ClipboardList,
  Copy,
  Eye,
  FileDown,
  FileSpreadsheet,
  Globe2,
  Loader2,
  MapPin,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  Users,
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
  useAttestBankQuestions,
  useSaveAttestExam,
  startAttestPreview,
  type AttestLearnerAttempt,
  type AttestManageExam,
  type AttestMonitorRow,
  type AttestQuestion,
  type AttestResultRow,
  type AttestResults,
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
  questionsPerAttempt: number | null;
  poolTracks: AttestTrack[];
  targetTracks: AttestTrack[];
  locationMode: "branch" | "office" | "anywhere";
  startsAt: string;
  endsAt: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showResult: boolean;
  retakeIfFailed: boolean;
  published: boolean;
  questions: AttestQuestion[];
  lockedQuestions: boolean;
};

/** Qisqa oyna (≤10 soat) → davomiylik = oyna; aks holda ~1 daq/savol (oynadan oshmasin) */
function autoDurationMinutes(startsAt: string, endsAt: string, askCount: number): number {
  const byAsk = Math.max(15, Math.min(180, Math.max(1, askCount) * 1));
  try {
    const a = new Date(localInputToIso(startsAt)).getTime();
    const b = new Date(localInputToIso(endsAt)).getTime();
    const span = Math.round((b - a) / 60_000);
    if (!Number.isFinite(span) || span < 1) return byAsk;
    if (span <= 600) return span;
    return Math.min(byAsk, span);
  } catch {
    return byAsk;
  }
}

function windowSpanLabel(startsAt: string, endsAt: string): string {
  try {
    const a = new Date(localInputToIso(startsAt)).getTime();
    const b = new Date(localInputToIso(endsAt)).getTime();
    const min = Math.round((b - a) / 60_000);
    if (!Number.isFinite(min) || min <= 0) return "";
    if (min < 60) return `${min} daqiqa ochiq`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h < 48) return m ? `${h} soat ${m} daq ochiq` : `${h} soat ochiq`;
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? `${d} kun ${rh} soat ochiq` : `${d} kun ochiq`;
  } catch {
    return "";
  }
}

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
  const startsAt = isoToLocalInput(start.toISOString());
  const endsAt = isoToLocalInput(end.toISOString());
  return {
    id: null,
    title: "",
    description: "",
    passScore: 50,
    durationMinutes: autoDurationMinutes(startsAt, endsAt, 1),
    questionsPerAttempt: null,
    poolTracks: [],
    targetTracks: [],
    locationMode: "branch",
    startsAt,
    endsAt,
    shuffleQuestions: true,
    shuffleOptions: true,
    showResult: true,
    retakeIfFailed: true,
    published: false,
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
    questionsPerAttempt: e.questionsPerAttempt ?? null,
    poolTracks: e.poolTracks?.length ? [...e.poolTracks] : [e.track],
    targetTracks: e.targetTracks?.length ? [...e.targetTracks] : [e.track],
    locationMode: e.locationMode,
    startsAt: isoToLocalInput(e.startsAt),
    endsAt: isoToLocalInput(e.endsAt),
    shuffleQuestions: e.shuffleQuestions,
    shuffleOptions: e.shuffleOptions !== false,
    showResult: e.showResult,
    retakeIfFailed: e.retakeIfFailed !== false,
    published: e.published,
    questions: e.questions.map((q) => ({ ...q, options: [...q.options] })),
    lockedQuestions: e.stats.hasAttempts,
  };
}

/** Mavjud testdan yangi nusxa (id yo‘q, e’lon yopiq) */
function copyAsNew(e: AttestManageExam, forTrack: AttestTrack): Draft {
  const base = fromExam(e);
  return {
    ...base,
    id: null,
    title: `${e.title} (nusxa)`.slice(0, 200),
    published: false,
    lockedQuestions: false,
    targetTracks: base.targetTracks.includes("mudir") ? base.targetTracks : [...base.targetTracks, "mudir"],
    poolTracks: base.poolTracks.length ? base.poolTracks : [forTrack],
  };
}

function ExamEditor({
  track,
  initial,
  onClose,
  bankCounts,
}: {
  track: AttestTrack;
  initial: Draft;
  onClose: () => void;
  bankCounts?: Partial<Record<AttestTrack, number>>;
}) {
  const { toast } = useToast();
  const save = useSaveAttestExam();
  const [d, setD] = useState(() => ({
    ...initial,
    poolTracks: initial.poolTracks.length ? initial.poolTracks : [track],
    targetTracks: initial.targetTracks.length ? initial.targetTracks : [track],
  }));
  const [bankTab, setBankTab] = useState<AttestTrack | "all">("all");
  const setQ = (i: number, patch: Partial<AttestQuestion>) =>
    setD((p) => ({ ...p, questions: p.questions.map((q, n) => (n === i ? { ...q, ...patch } : q)) }));

  const selectedPools = d.poolTracks.length ? d.poolTracks : [track];
  const selectedTargets = d.targetTracks.length ? d.targetTracks : [track];
  const bankQ = useAttestBankQuestions(selectedPools, true);
  const localPool = d.questions.filter((q) => q.text.trim()).length;
  useEffect(() => {
    if (bankTab !== "all" && !selectedPools.includes(bankTab)) setBankTab("all");
  }, [selectedPools, bankTab]);
  const estimatedPool =
    bankQ.data?.total ??
    ATTESTATSIYA_TRACKS.reduce((sum, t) => {
      if (!selectedPools.includes(t.key)) return sum;
      if (t.key === track) return sum + Math.max(bankCounts?.[t.key] ?? 0, localPool);
      return sum + (bankCounts?.[t.key] ?? 0);
    }, 0);
  const pool = Math.max(1, estimatedPool || localPool);
  const askCount = d.questionsPerAttempt && d.questionsPerAttempt > 0 && d.questionsPerAttempt < pool ? d.questionsPerAttempt : pool;
  const spanHint = windowSpanLabel(d.startsAt, d.endsAt);

  const togglePool = (key: AttestTrack) => {
    setD((p) => {
      const cur = p.poolTracks.length ? p.poolTracks : [track];
      if (cur.includes(key)) {
        if (cur.length <= 1) return p;
        return { ...p, poolTracks: cur.filter((x) => x !== key) };
      }
      return { ...p, poolTracks: [...cur, key] };
    });
  };

  const toggleTarget = (key: AttestTrack) => {
    setD((p) => {
      const cur = p.targetTracks.length ? p.targetTracks : [track];
      if (cur.includes(key)) {
        if (cur.length <= 1) return p;
        return { ...p, targetTracks: cur.filter((x) => x !== key) };
      }
      return { ...p, targetTracks: [...cur, key] };
    });
  };

  const patchWindow = (patch: Partial<Pick<Draft, "startsAt" | "endsAt" | "questionsPerAttempt" | "questions">>) => {
    setD((p) => {
      const next = { ...p, ...patch };
      const nextPool = (patch.questions || next.questions).length;
      const nextAsk =
        next.questionsPerAttempt && next.questionsPerAttempt > 0 && next.questionsPerAttempt < nextPool
          ? next.questionsPerAttempt
          : nextPool;
      return {
        ...next,
        durationMinutes: autoDurationMinutes(next.startsAt, next.endsAt, nextAsk),
      };
    });
  };

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
      const saved = await save.mutateAsync({
        id: d.id,
        track,
        title: d.title.trim(),
        description: d.description.trim(),
        questions,
        passScore: d.passScore,
        durationMinutes: d.durationMinutes,
        questionsPerAttempt: d.questionsPerAttempt,
        poolTracks: selectedPools,
        targetTracks: selectedTargets,
        locationMode: d.locationMode,
        startsAt: localInputToIso(d.startsAt),
        endsAt: localInputToIso(d.endsAt),
        shuffleQuestions: d.shuffleQuestions,
        shuffleOptions: d.shuffleOptions,
        showResult: d.showResult,
        retakeIfFailed: d.retakeIfFailed,
        published: d.published,
      });
      toast({
        title: d.id ? "Atestatsiya yangilandi" : "Atestatsiya yaratildi",
        description: saved.windowChanged
          ? "Vaqt o‘zgardi: ishlayotganlar qayta boshlashi kerak. Ishlamagan/o‘tmaganlarga bildirishnoma yuborildi."
          : undefined,
      });
      onClose();
    } catch (e) {
      toast({ title: "Saqlanmadi", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-white/10 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">
            {d.id ? "Atestatsiyani tahrirlash" : "Yangi atestatsiya"}
          </h2>
          <p className="text-xs text-slate-500">{audienceTo(track)} · aniq va sodda sozlama</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Yopish">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label>Nomi *</Label>
        <Input value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Masalan: Mudirlar uchun atestatsiya" />
      </div>
      <div className="space-y-1.5">
        <Label>Tavsif</Label>
        <Textarea rows={2} value={d.description} maxLength={3000} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 sm:p-4 dark:border-white/10 dark:bg-white/5">
        <p className="mb-1 text-sm font-bold text-slate-900 dark:text-white">1. Ochiq muddat va test vaqti</p>
        <p className="mb-3 text-[11px] leading-snug text-slate-500">
          Vaqt yoki davomiylikni o‘zgartirsangiz: ishlayotganlarga «qayta yangilang» chiqadi va boshidan boshlashi mumkin;
          ishlamagan / o‘tmaganlarga bildirishnoma ketadi. O‘tganlarga qayta chiqmaydi.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Boshlanish</Label>
            <Input type="datetime-local" value={d.startsAt} onChange={(e) => patchWindow({ startsAt: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Tugash</Label>
            <Input type="datetime-local" value={d.endsAt} onChange={(e) => patchWindow({ endsAt: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Test davomiyligi (avto), daqiqa</Label>
            <Input
              type="number"
              min={1}
              max={600}
              value={d.durationMinutes}
              onChange={(e) => setD({ ...d, durationMinutes: Math.round(Number(e.target.value) || 0) })}
            />
            <p className="text-[11px] leading-snug text-slate-500">
              {spanHint
                ? `Oyna: ${spanHint}. Qisqa oyna (≤10 soat) bo‘lsa davomiylik oynadan, aks holda ${askCount} savol × 1 daq.`
                : `Davomiylik avtomatik: ${askCount} savol × ~1 daqiqa (o‘zgartirish mumkin).`}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>O‘tish bali, %</Label>
            <Input type="number" min={1} max={100} value={d.passScore} onChange={(e) => setD({ ...d, passScore: Math.round(Number(e.target.value) || 0) })} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-3 sm:p-4 dark:border-violet-900/40 dark:bg-violet-950/30">
        <p className="mb-1 text-sm font-bold text-slate-900 dark:text-white">2. Qaysi bazalardan savol kelsin</p>
        <p className="mb-3 text-[11px] text-slate-600 dark:text-slate-400">
          Ptichka qo‘yilgan bazadan random savol keladi. Olib tashlansa — o‘sha bazadan kelmaydi. Har bir xodimga har xil to‘plam.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {ATTESTATSIYA_TRACKS.map((t) => {
            const on = selectedPools.includes(t.key);
            const live = bankQ.data?.tracks.find((x) => x.key === t.key)?.count;
            const count =
              live ?? (t.key === track ? Math.max(bankCounts?.[t.key] ?? 0, localPool) : bankCounts?.[t.key] ?? 0);
            return (
              <label
                key={t.key}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-2xl border px-3 py-2.5 transition",
                  on
                    ? "border-violet-500 bg-white shadow-sm ring-1 ring-violet-200 dark:bg-slate-900 dark:ring-violet-900"
                    : "border-slate-200 bg-white/60 opacity-80 dark:border-white/10 dark:bg-slate-950/40",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-violet-600"
                  checked={on}
                  onChange={() => {
                    togglePool(t.key);
                    setBankTab(t.key);
                  }}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-900 dark:text-white">{t.label}</span>
                  <span className="block text-[11px] text-slate-500">{count} ta savol bazada</span>
                </span>
              </label>
            );
          })}
        </div>

        {selectedPools.length ? (
          <div className="mt-3 rounded-2xl border border-violet-200/80 bg-white p-3 dark:border-violet-900/40 dark:bg-slate-950">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold text-violet-900 dark:text-violet-200">
                Tanlangan bazalar savollari
                {bankQ.data ? ` · ${bankQ.data.total} ta` : ""}
              </p>
              <div className="ml-auto flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setBankTab("all")}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    bankTab === "all" ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-800 dark:bg-violet-950",
                  )}
                >
                  Hammasi
                </button>
                {selectedPools.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setBankTab(k)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                      bankTab === k ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-800 dark:bg-violet-950",
                    )}
                  >
                    {ATTESTATSIYA_TRACKS.find((t) => t.key === k)?.label || k}
                  </button>
                ))}
              </div>
            </div>
            {bankQ.isLoading ? (
              <p className="py-4 text-center text-xs text-slate-500">Bazalar yuklanmoqda…</p>
            ) : bankQ.isError ? (
              <p className="py-3 text-center text-xs text-rose-600">{(bankQ.error as Error).message}</p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {(bankQ.data?.tracks || [])
                  .filter((g) => bankTab === "all" || g.key === bankTab)
                  .flatMap((g) =>
                    g.questions.map((q, i) => (
                      <div
                        key={q.id}
                        className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-white/10 dark:bg-white/5"
                      >
                        <p className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                          {g.label}
                          {q.sourceTitle ? ` · ${q.sourceTitle}` : ""}
                        </p>
                        <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-white">
                          {i + 1}. {q.text}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          To‘g‘ri: {q.options[q.correctIndex] || "—"}
                        </p>
                      </div>
                    )),
                  )}
                {!bankQ.data?.total ? (
                  <p className="py-4 text-center text-xs text-slate-500">Tanlangan bazalarda savol yo‘q.</p>
                ) : null}
              </div>
            )}
            <p className="mt-2 text-[10px] text-slate-500">
              Bu yerda ko‘rinadi — xodimga har safar shu pooldan random tanlanadi. Tahrirlash uchun pastga qo‘shing yoki manba testda o‘zgartiring.
            </p>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 sm:p-4 dark:border-emerald-900/40 dark:bg-emerald-950/30">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
          <Users className="h-4 w-4 text-emerald-600" /> 3. Kimga e’lon qilinadi
        </p>
        <p className="mb-3 text-[11px] text-slate-600 dark:text-slate-400">
          Ptichka qo‘yilgan lavozimlar testni ko‘radi va topshiradi. E’lon qilinganda ularga bildirishnoma boradi (masalan barcha mudirlar).
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {ATTESTATSIYA_TRACKS.map((t) => {
            const on = selectedTargets.includes(t.key);
            return (
              <label
                key={t.key}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-2xl border px-3 py-2.5 transition",
                  on
                    ? t.key === "mudir"
                      ? "border-emerald-500 bg-white shadow-sm ring-1 ring-emerald-200 dark:bg-slate-900"
                      : "border-emerald-400 bg-white shadow-sm dark:bg-slate-900"
                    : "border-slate-200 bg-white/60 opacity-80 dark:border-white/10 dark:bg-slate-950/40",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-emerald-600"
                  checked={on}
                  onChange={() => toggleTarget(t.key)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-900 dark:text-white">{t.label}</span>
                  <span className="block text-[11px] text-slate-500">
                    {t.key === "mudir" ? "Barcha mudirlarga boradi" : `Barcha ${t.label.toLowerCase()}larga`}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-3 sm:p-4 dark:border-sky-900/50 dark:bg-sky-950/30">
        <p className="mb-1 text-sm font-bold text-slate-900 dark:text-white">4. Har bir xodimga nechta savol</p>
        <p className="mb-3 text-[11px] text-slate-600 dark:text-slate-400">
          Belgilangan bazalarda ~{pool} ta. Masalan 51 ta bo‘lsa — har biriga 20 tasini tasodifiy berish mumkin.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Ko‘rinadigan savol soni</Label>
            <Input
              type="number"
              min={1}
              max={Math.max(1, pool)}
              placeholder={String(pool || 1)}
              value={d.questionsPerAttempt ?? ""}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (!v) {
                  patchWindow({ questionsPerAttempt: null });
                  return;
                }
                patchWindow({ questionsPerAttempt: Math.round(Number(v) || 0) });
              }}
            />
            <p className="text-[11px] text-slate-500">
              Bo‘sh = hammasi ({pool}). Hozir har biriga: <b>{askCount}</b> ta
            </p>
          </div>
          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2 rounded-xl border border-white/60 bg-white/80 px-3 py-2 dark:bg-slate-900/60">
              <Switch checked={d.shuffleQuestions} onCheckedChange={(v) => setD({ ...d, shuffleQuestions: v })} />
              Savollar aralashsin
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-white/60 bg-white/80 px-3 py-2 dark:bg-slate-900/60">
              <Switch checked={d.shuffleOptions} onCheckedChange={(v) => setD({ ...d, shuffleOptions: v })} />
              Javob variantlari aralashsin
            </label>
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 sm:p-4 dark:border-white/10 dark:bg-white/5">
        <p className="mb-1 text-sm font-bold text-slate-900 dark:text-white">5. Qayerda ochiladi</p>
        <p className="mb-3 text-[11px] text-slate-500">
          «Istalgan joy» — aptekada bo‘lmaganlar ham GPS’siz test ishlay oladi.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ["branch", "O‘z filialida", "Faqat biriktirilgan filial hududida", MapPin],
              ["office", "Asosiy ofisda", "Faqat ofis hududida", Building2],
              ["anywhere", "Istalgan joy", "Uydan, yo‘ldan — GPS shart emas", Globe2],
            ] as const
          ).map(([key, label, hint, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setD({ ...d, locationMode: key })}
              className={cn(
                "rounded-2xl border p-3 text-left transition",
                d.locationMode === key
                  ? key === "anywhere"
                    ? "border-emerald-500 bg-emerald-50 shadow-sm ring-1 ring-emerald-200 dark:bg-emerald-950/40"
                    : "border-sky-500 bg-sky-50 shadow-sm dark:bg-sky-950/40"
                  : "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900",
              )}
            >
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Icon className={cn("h-4 w-4", key === "anywhere" ? "text-emerald-600" : "text-sky-600")} /> {label}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-center justify-between gap-2">
          <Label className="flex items-center gap-2 text-sm font-bold">
            <ClipboardList className="h-4 w-4 text-sky-600" /> 6. Shu testning o‘z savollari ({localPool})
          </Label>
          <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-200">
            Pool ~{pool} · har biriga {askCount}
          </span>
        </div>
        {d.lockedQuestions ? <p className="text-[11px] text-amber-700">Boshlangan — savollar qulflangan</p> : null}
        {d.questions.map((q, qi) => (
          <div key={q.id} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-white/10 dark:bg-white/5">
            <div className="flex gap-2">
              <span className="mt-2 text-sm font-bold text-sky-600">{qi + 1}.</span>
              <Textarea rows={2} disabled={d.lockedQuestions} value={q.text} placeholder="Savol" onChange={(e) => setQ(qi, { text: e.target.value })} />
              <Button
                variant="ghost"
                size="icon"
                className="text-red-600"
                disabled={d.lockedQuestions || d.questions.length <= 1}
                onClick={() => patchWindow({ questions: d.questions.filter((_, i) => i !== qi) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {q.options.map((opt, oi) => (
                <label key={oi} className={cn("flex items-center gap-2 rounded-lg border bg-white px-2 py-1.5 dark:bg-slate-900", q.correctIndex === oi && "border-emerald-500")}>
                  <input type="radio" disabled={d.lockedQuestions} name={`c-${q.id}`} checked={q.correctIndex === oi} onChange={() => setQ(qi, { correctIndex: oi })} className="accent-emerald-600" />
                  <span className="text-xs font-bold text-muted-foreground">{String.fromCharCode(65 + oi)}</span>
                  <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" disabled={d.lockedQuestions} value={opt} placeholder={`Variant ${String.fromCharCode(65 + oi)}`} onChange={(e) => setQ(qi, { options: q.options.map((o, i) => (i === oi ? e.target.value : o)) })} />
                </label>
              ))}
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          className="w-full border-dashed"
          disabled={d.lockedQuestions}
          onClick={() => patchWindow({ questions: [...d.questions, emptyQuestion()] })}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Savol qo‘shish
        </Button>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
          <Switch checked={d.showResult} onCheckedChange={(v) => setD({ ...d, showResult: v })} />
          Natijani xodim ko‘rsin (foiz va o‘tdi/o‘tmadi)
        </label>
        <div
          className={cn(
            "w-full rounded-2xl border px-3 py-2.5",
            d.retakeIfFailed ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-slate-50",
          )}
        >
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold">
                {d.retakeIfFailed ? "Qayta topshirish yoqilgan" : "Qayta topshirish o‘chiq"}
              </span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                {d.retakeIfFailed
                  ? "Ishlamagan va o‘tmaganlarga shu test yana chiqadi — qayta ishlashi mumkin. O‘tganlarga chiqmaydi."
                  : "Har kim faqat bir marta topshiradi (admin alohida ruxsat bersa qayta ochiladi)."}
              </span>
            </span>
            <Switch checked={d.retakeIfFailed} onCheckedChange={(v) => setD({ ...d, retakeIfFailed: v })} />
          </label>
        </div>
        <div className={cn("w-full rounded-2xl border px-3 py-2.5", d.published ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-semibold">{d.published ? "E’lon qilingan" : "Hali e’lon qilinmagan"}</span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                {d.published
                  ? `Saqlangach test ${selectedTargets.map((k) => ATTESTATSIYA_TRACKS.find((t) => t.key === k)?.label || k).join(", ")} ga chiqadi.`
                  : `Saqlangach e’lon yopiq qoladi. Tayyor bo‘lgach «E’lon qilish» — belgilangan lavozimlarga (jumladan mudir) boradi.`}
              </span>
            </span>
            <Switch checked={d.published} onCheckedChange={(v) => setD({ ...d, published: v })} />
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-white/10">
        <Button variant="outline" onClick={onClose}>Bekor</Button>
        <Button className="bg-sky-600 hover:bg-sky-700" disabled={save.isPending} onClick={() => void onSave()}>
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
  const [openSheet, setOpenSheet] = useState<number | null>(null);
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
        {data.exam.locationMode === "anywhere"
          ? "Istalgan joy"
          : data.exam.locationMode === "office"
            ? "Asosiy ofis"
            : "O‘z filiali"}{" "}
        · pool {data.exam.poolCount} · har biriga {data.exam.askCount} savol ·
        Excelda har bir xodimning foizi va har bir javobi bor · har 10 soniyada yangilanadi
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
        {rows.map((r) => {
          const sheet = (data.answerSheets || []).find((s) => s.userId === r.userId);
          const opened = openSheet === r.userId;
          return (
            <div key={r.userId} className="rounded-2xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.fullName}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {r.branchLabel || "Filialsiz"}
                    {r.locationLabel ? ` · ${r.locationLabel}${r.distanceM != null ? ` (${r.distanceM} m)` : ""}` : ""}
                    {r.focusLost ? ` · fokus ${r.focusLost}` : ""}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <p className={cn("text-base font-bold tabular-nums", r.passed ? "text-emerald-700" : r.passed === false ? "text-rose-700" : "text-foreground")}>
                    {r.score != null ? `${r.score}%` : ATTEST_STATUS_LABEL[r.status]}
                  </p>
                  <p className="text-muted-foreground">
                    {r.correct != null ? `${r.correct}/${r.total} to‘g‘ri` : r.status === "in_progress" && r.remainingSec != null
                      ? `${Math.ceil(r.remainingSec / 60)} daq · ${r.answeredCount}/${r.total}`
                      : r.attemptsCount
                        ? `${r.attemptsCount}-urinish`
                        : "—"}
                    {r.retakeAllowed ? " · qayta" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {sheet?.items.length ? (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setOpenSheet(opened ? null : r.userId)}>
                      {opened ? "Yopish" : "Javoblar"}
                    </Button>
                  ) : null}
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
              {opened && sheet ? (
                <div className="mt-3 space-y-1.5 border-t border-border/70 pt-3">
                  <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
                    {sheet.fullName} · {sheet.score ?? "—"}% · {sheet.correct ?? "—"}/{sheet.total}
                    {sheet.passed == null ? "" : sheet.passed ? " · O‘tdi" : " · O‘tmadi"}
                  </p>
                  {sheet.items.map((it) => (
                    <div
                      key={`${sheet.userId}-${it.number}`}
                      className={cn(
                        "rounded-xl px-3 py-2 text-xs",
                        it.ok ? "bg-emerald-50 text-emerald-950" : "bg-rose-50 text-rose-950",
                      )}
                    >
                      <p className="font-semibold">
                        {it.number}. {it.question}
                      </p>
                      <p className="mt-0.5 opacity-90">
                        Tanlagan: {it.chosenText}
                        {!it.ok ? ` · To‘g‘ri: ${it.correctText}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
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

type ResultFilter = "finished" | "passed" | "failed" | "in_progress" | "not_started" | "annulled" | "all";

const RESULT_FILTERS: Array<[ResultFilter, string]> = [
  ["finished", "Tugatganlar"],
  ["passed", "O‘tgan"],
  ["failed", "O‘tmagan"],
  ["in_progress", "Ishlayapti"],
  ["not_started", "Boshlamagan"],
  ["annulled", "Bekor"],
  ["all", "Hammasi"],
];

const TRACK_FILTERS: Array<[AttestTrack | "all", string]> = [
  ["all", "Hammasi"],
  ["stajyor", "Stajyor"],
  ["farmasevt", "Farmasevt"],
  ["mudir", "Mudir"],
];

function resultStatusBadge(r: AttestResultRow): { label: string; cls: string } {
  if (r.status === "submitted" || r.status === "expired")
    return r.passed
      ? { label: "O‘tdi", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" }
      : { label: "O‘tmadi", cls: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" };
  if (r.status === "in_progress")
    return { label: "Ishlayapti", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" };
  if (r.status === "annulled")
    return { label: "Bekor qilingan", cls: "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300" };
  return { label: "Boshlamagan", cls: "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400" };
}

function ResultsBoard() {
  const { toast } = useToast();
  const qStajyor = useAttestResults("stajyor", true);
  const qFarmasevt = useAttestResults("farmasevt", true);
  const qMudir = useAttestResults("mudir", true);
  const queries = [qStajyor, qFarmasevt, qMudir];
  const [scope, setScope] = useState<AttestTrack | "all">("all");
  const [examId, setExamId] = useState<number | "all">("all");
  const [filter, setFilter] = useState<ResultFilter>("finished");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  type RowX = AttestResultRow & { track: AttestTrack; trackLabel: string };
  const allRows: RowX[] = queries.flatMap((q) =>
    (q.data?.rows ?? []).map((r) => ({ ...r, track: q.data!.track, trackLabel: q.data!.trackLabel })),
  );
  const allExams = queries.flatMap((q) =>
    (q.data?.exams ?? []).map((e) => ({ ...e, track: q.data!.track, trackLabel: q.data!.trackLabel })),
  );
  const scopedRows = scope === "all" ? allRows : allRows.filter((r) => r.track === scope);
  const scopedExams = scope === "all" ? allExams : allExams.filter((e) => e.track === scope);

  const isFinished = (r: AttestResultRow) => r.status === "submitted" || r.status === "expired";
  const finishedRows = scopedRows.filter(isFinished);
  const passedRows = finishedRows.filter((r) => r.passed);
  const scoreList = finishedRows.map((r) => r.score ?? 0);
  const s = {
    people: new Set(scopedRows.map((r) => r.userId)).size,
    exams: scopedExams.length,
    rows: scopedRows.length,
    notStarted: scopedRows.filter((r) => r.status === "not_started").length,
    inProgress: scopedRows.filter((r) => r.status === "in_progress").length,
    finished: finishedRows.length,
    passed: passedRows.length,
    failed: finishedRows.length - passedRows.length,
    annulled: scopedRows.filter((r) => r.status === "annulled").length,
    passRate: finishedRows.length ? Math.round((passedRows.length / finishedRows.length) * 100) : null,
    avgScore: scoreList.length ? Math.round(scoreList.reduce((a, b) => a + b, 0) / scoreList.length) : null,
  };

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rank = (r: AttestResultRow) => (isFinished(r) ? 0 : r.status === "in_progress" ? 1 : r.status === "annulled" ? 3 : 2);
    return scopedRows
      .filter((r) => {
        if (examId !== "all" && r.examId !== examId) return false;
        if (needle && !`${r.fullName} ${r.branchLabel || ""} ${r.phone || ""} ${r.examTitle}`.toLowerCase().includes(needle)) return false;
        if (filter === "finished") return isFinished(r);
        if (filter === "passed") return isFinished(r) && r.passed === true;
        if (filter === "failed") return isFinished(r) && r.passed === false;
        if (filter === "all") return true;
        return r.status === filter;
      })
      .sort((a, b) => rank(a) - rank(b) || String(b.submittedAt || b.startedAt || "").localeCompare(String(a.submittedAt || a.startedAt || "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedRows, examId, filter, search]);

  const runExport = async (kind: "excel" | "pdf") => {
    const payload = {
      track: scope === "all" ? ("stajyor" as AttestTrack) : scope,
      trackLabel: scope === "all" ? "Barcha yo‘nalishlar" : scopedRows[0]?.trackLabel || "",
      exams: scopedExams.map((e) => ({ id: e.id, title: e.title })),
      stats: s,
      rows,
    } as AttestResults;
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

  if (queries.some((q) => q.isLoading)) return <Skeleton className="h-64 rounded-3xl" />;
  const errQ = queries.find((q) => q.isError);
  if (errQ) {
    return <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-rose-500/10 dark:text-rose-300">{(errQ.error as Error)?.message || "Yuklanmadi"}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">Natijalar · barcha attestatsiyalar</h2>
          <p className="text-xs text-muted-foreground">
            Kim qaysi testni ishlagani: nechta savolga javob bergani (ishlagani), nechtasi to‘g‘ri, foizi va o‘tgan/o‘tmagani. 20 soniyada yangilanadi.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={exporting !== null || !rows.length} onClick={() => void runExport("excel")}>
          {exporting === "excel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />} Excel
        </Button>
        <Button size="sm" variant="outline" disabled={exporting !== null || !rows.length} onClick={() => void runExport("pdf")}>
          {exporting === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5 text-rose-700" />} PDF
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TRACK_FILTERS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => { setScope(k); setExamId("all"); }}
            className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", scope === k ? "bg-foreground text-background" : "bg-card text-muted-foreground ring-1 ring-border")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {[
          ["Tugatgan", s.finished],
          ["O‘tgan", s.passed],
          ["O‘tmagan", s.failed],
          ["Ishlayapti", s.inProgress],
          ["Boshlamagan", s.notStarted],
          ["Xodim", s.people],
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
          {scopedExams.map((e) => (
            <option key={e.id} value={e.id}>{e.title}</option>
          ))}
        </select>
        {RESULT_FILTERS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={cn("rounded-full px-3 py-1 text-xs font-semibold", filter === k ? "bg-foreground text-background" : "bg-card text-muted-foreground ring-1 ring-border")}>
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[860px] text-left text-xs">
          <thead className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <tr>
              {["Xodim", "Test", "Ishlagani", "To‘g‘ri", "Ball", "Holat", "Urinish", "Topshirgan"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const badge = resultStatusBadge(r);
              return (
                <tr key={`${r.examId}-${r.userId}`} className="border-t border-border/70">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-foreground">{r.fullName}</p>
                    <p className="text-[10px] text-muted-foreground">{r.branchLabel || "Filialsiz"}{r.phone ? ` · ${r.phone}` : ""}</p>
                  </td>
                  <td className="max-w-[200px] px-3 py-2">
                    <p className="truncate font-medium" title={r.examTitle}>{r.examTitle}</p>
                    <p className="text-[10px] text-muted-foreground">{r.trackLabel} · o‘tish {r.passScore}%</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums font-semibold">{r.answered}/{r.total}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.correct != null ? `${r.correct}/${r.total}` : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={cn("text-sm font-bold tabular-nums", r.passed ? "text-emerald-600 dark:text-emerald-400" : r.passed === false ? "text-rose-600 dark:text-rose-400" : "text-foreground")}>
                      {r.score != null ? `${r.score}%` : "—"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", badge.cls)}>{badge.label}</span>
                    {r.retakeAllowed ? <span className="ml-1 text-muted-foreground">· qayta</span> : null}
                    {r.annulReason ? <p className="max-w-[140px] truncate font-normal text-muted-foreground" title={r.annulReason}>{r.annulReason}</p> : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.attemptsCount || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.submittedAt ? formatAttestDt(r.submittedAt) : r.startedAt ? formatAttestDt(r.startedAt) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length ? <p className="py-8 text-center text-sm text-muted-foreground">Natija topilmadi</p> : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        «Ishlagani» — nechta savolga javob bergani / jami savol. «To‘g‘ri» — to‘g‘ri javoblar soni. Excel/PDF da ham shu ustunlar bor.
        Bitta testni «Atestatsiyalar»da ochsangiz — har bir xodimning har bir javobi ham ko‘rinadi.
      </p>
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
    practiceMeta: { questionOrder?: string[]; optionOrders?: Record<string, number[]> };
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
      setPractice({
        title: exam.title,
        attempt: res.attempt,
        serverNow: res.serverNow,
        examId: exam.id,
        practiceMeta: {
          questionOrder: (res.attempt.questions || []).map((q) => q.id),
          optionOrders: res.optionOrders,
        },
      });
    } catch (err) {
      toast({ title: "Test ochilmadi", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setTryingId(null);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      {practice ? (
        <ExamRunner
          attempt={practice.attempt}
          serverNow={practice.serverNow}
          practiceExamId={practice.examId}
          practiceMeta={practice.practiceMeta}
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
                <h1 className="text-xl font-bold sm:text-2xl">Atestatsiya</h1>
                <p className="mt-1 max-w-xl text-sm opacity-80">
                  Muddat, avto davomiylik, har biriga nechta savol, tasodifiy tartib — natija foizi va Excel to‘liq.
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
              <button
                key={t.key}
                type="button"
                onClick={() => setTrack(t.key)}
                className={cn(
                  "rounded-2xl border p-3 text-left transition",
                  track === t.key
                    ? "border-sky-500 bg-sky-50 shadow-sm dark:bg-sky-950/40"
                    : "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950",
                )}
              >
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
          <ResultsBoard />
        ) : monitorId ? (
          <Monitor examId={monitorId} onBack={() => setMonitorId(null)} />
        ) : (
          <>
            {!editing ? (
              <Button className="h-11 w-full rounded-2xl bg-sky-600 text-base font-semibold hover:bg-sky-700" onClick={() => setEditing(emptyDraft())}>
                <Plus className="mr-1.5 h-4 w-4" /> Yangi atestatsiya
              </Button>
            ) : (
              <ExamEditor
                key={editing.id ?? `new-${editing.title}`}
                track={track}
                initial={editing}
                onClose={() => setEditing(null)}
                bankCounts={
                  manage.data?.bankCounts ||
                  (Object.fromEntries((manage.data?.tracks || []).map((t) => [t.key, t.questions ?? 0])) as Partial<
                    Record<AttestTrack, number>
                  >)
                }
              />
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
              <div className="space-y-3">
                {(manage.data?.exams ?? []).map((e) => (
                  <div
                    key={e.id}
                    className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950"
                  >
                    <div className="flex flex-wrap items-start gap-3 p-4 sm:p-5">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-base font-extrabold tracking-tight text-slate-900 dark:text-white">{e.title}</p>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              e.window === "open"
                                ? "bg-sky-100 text-sky-800"
                                : e.window === "upcoming"
                                  ? "bg-slate-100 text-slate-700"
                                  : "bg-slate-100 text-slate-500",
                            )}
                          >
                            {e.window === "open" ? "Muddat ichida" : e.window === "upcoming" ? "Hali ochilmagan" : "Tugagan"}
                          </span>
                        </div>
                        <p className="text-[12px] leading-relaxed text-slate-500">
                          {formatAttestDt(e.startsAt)} – {formatAttestDt(e.endsAt)}
                          <span className="mx-1.5 text-slate-300">·</span>
                          {e.durationMinutes} daq
                          <span className="mx-1.5 text-slate-300">·</span>
                          {e.locationMode === "anywhere" ? "Istalgan joy" : e.locationMode === "office" ? "Ofis" : "Filial"}
                          <span className="mx-1.5 text-slate-300">·</span>
                          o‘tish {e.passScore}%
                        </p>
                        <div className="flex flex-wrap gap-2 text-[11px]">
                          <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-200">
                            Pool ~{e.poolCount} · har biriga {e.askCount}
                          </span>
                          <span className="rounded-lg bg-slate-50 px-2.5 py-1 font-semibold text-slate-600 dark:bg-white/5">
                            Baza: {(e.poolTracks?.length ? e.poolTracks : [e.track])
                              .map((pt) => ATTESTATSIYA_TRACKS.find((t) => t.key === pt)?.label || pt)
                              .join(", ")}
                          </span>
                          <span className="rounded-lg bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                            Kimga: {(e.targetTracks?.length ? e.targetTracks : [e.track])
                              .map((pt) => ATTESTATSIYA_TRACKS.find((t) => t.key === pt)?.label || pt)
                              .join(", ")}
                          </span>
                          <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                            {e.stats.passed}/{e.stats.finished} o‘tdi · {e.stats.inProgress} ishlayapti
                          </span>
                          {e.retakeIfFailed !== false ? (
                            <span className="rounded-lg bg-sky-50 px-2.5 py-1 font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-200">
                              O‘tmaganlar qayta ishlaydi
                            </span>
                          ) : null}
                        </div>
                        <div
                          className={cn(
                            "flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2.5",
                            e.published ? "bg-emerald-50" : "bg-amber-50",
                          )}
                        >
                          <div className="min-w-0">
                            <p className={cn("text-xs font-semibold", e.published ? "text-emerald-800" : "text-amber-900")}>
                              {e.published ? "E’lon qilingan" : "E’lon qilinmagan"}
                            </p>
                            <p className="text-[11px] leading-snug text-slate-600">
                              {e.published
                                ? `Test ${(e.targetTracks?.length ? e.targetTracks : [e.track])
                                    .map((k) => ATTESTATSIYA_TRACKS.find((t) => t.key === k)?.label || k)
                                    .join(", ")} ga chiqadi.`
                                : "Xodimlarga chiqmaydi. Sinab ko‘rish mumkin — natija saqlanmaydi."}
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
                                      ? "Test yana faqat trenerda."
                                      : `Bildirishnoma: ${(e.targetTracks?.length ? e.targetTracks : [e.track])
                                          .map((k) => ATTESTATSIYA_TRACKS.find((t) => t.key === k)?.label || k)
                                          .join(", ")}.`,
                                  }),
                                )
                                .catch((err: Error) => toast({ title: err.message, variant: "destructive" }))
                            }
                          >
                            {e.published ? "E’lonni yopish" : "E’lon qilish"}
                          </Button>
                        </div>
                      </div>
                      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-col sm:items-stretch">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9"
                          disabled={tryingId === e.id || !e.questions.length}
                          onClick={() => void beginTrial(e)}
                        >
                          {tryingId === e.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                          Sinab ko‘rish
                        </Button>
                        <Button size="sm" variant="outline" className="h-9" onClick={() => setMonitorId(e.id)}>
                          <BarChart3 className="mr-1 h-3.5 w-3.5" /> Natija
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9"
                          onClick={() => {
                            setEditing(copyAsNew(e, track));
                            toast({ title: "Nusxa ochildi", description: "Yangidan saqlang — alohida atestatsiya bo‘ladi." });
                          }}
                        >
                          <Copy className="mr-1 h-3.5 w-3.5" /> Yangidan
                        </Button>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => setEditing(fromExam(e))} aria-label="Tahrirlash">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="text-red-600" onClick={() => setToDelete(e)} aria-label="O‘chirish">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {!manage.data?.exams.length ? (
                  <p className="py-10 text-center text-sm text-slate-500">Bu yo‘nalishda atestatsiya yo‘q.</p>
                ) : null}
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
