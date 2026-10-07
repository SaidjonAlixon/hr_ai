import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  CalendarX2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileDown,
  FileSignature,
  Loader2,
  PenLine,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ExplanationLetterDialog, StatusChip, TestChip } from "@/components/explanation-letter/ExplanationLetterDialog";
import { ReviewChip, StageBadge } from "@/components/explanation-letter/LetterReviewPanel";
import { StageLadder } from "@/components/explanation-letter/StageLadder";
import { LetterLookupBar } from "@/components/explanation-letter/LetterLookup";
import {
  FINAL_STRIKE,
  currentStage,
  downloadLetterPdf,
  fmtLetterDate,
  fmtLetterStamp,
  fmtSum,
  stageTone,
  useMonthLetters,
  useMyLetters,
  useReviewLetter,
  type ExplanationLetter,
} from "@/lib/explanation-letters-api";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function eventText(l: ExplanationLetter) {
  if (l.kind === "absent") return `Kelmagan · ${fmtLetterDate(l.eventDate)}`;
  return `Kechikkan · ${fmtLetterDate(l.eventDate)}${l.checkIn ? ` · ${l.checkIn}` : ""}${l.lateMinutes ? ` (${l.lateMinutes} daq.)` : ""}`;
}

const stageOf = (l: ExplanationLetter) => Math.min(l.strikeN, FINAL_STRIKE);
const isOpen = (l: ExplanationLetter) => l.status !== "signed" && l.reviewStatus !== "cancelled";

function Shell({ title, hint, right, children }: { title: string; hint: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-sky-50 via-white to-white px-4 py-3 dark:border-white/5 dark:from-sky-500/10 dark:via-slate-900 dark:to-slate-900">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0b3a5c] text-white shadow-sm shadow-sky-900/30">
            <FileSignature className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
          </div>
        </div>
        {right}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function LetterRow({ l, showName, onOpen, action }: { l: ExplanationLetter; showName: boolean; onOpen: () => void; action?: ReactNode }) {
  const sub = [l.position, l.branch].filter(Boolean).join(" · ");
  const cancelled = l.reviewStatus === "cancelled";
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          "group flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition hover:shadow-sm",
          cancelled
            ? "border-slate-200 bg-slate-50 opacity-75 dark:border-white/10 dark:bg-white/5"
            : l.status === "signed"
              ? "border-slate-200 bg-white hover:border-emerald-200 dark:border-white/10 dark:bg-slate-900"
              : "border-amber-200 bg-amber-50/50 hover:border-amber-300 dark:border-amber-500/20 dark:bg-amber-500/5",
        )}
      >
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", stageTone(stageOf(l)).solid)}>
          {showName ? initials(l.fullName) : l.kind === "late" ? <Clock3 className="h-4 w-4" /> : <CalendarX2 className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-white">
            <span className="min-w-0 truncate">{showName ? l.fullName : eventText(l)}</span>
            <StageBadge n={l.strikeN} />
            <StatusChip status={l.status} />
            <ReviewChip status={l.reviewStatus} />
            {l.isTest ? <TestChip /> : null}
          </p>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            {showName ? eventText(l) : ""}
            {l.amount > 0 ? `${showName ? " · " : ""}jarima ${fmtSum(l.amount)}` : ""}
            {sub ? ` · ${sub}` : ""}
            {l.signedAt ? ` · imzo: ${fmtLetterStamp(l.signedAt)}` : ""}
          </p>
        </div>
        {action}
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
      </div>
    </li>
  );
}

/** Xodim: o‘z tushuntirish xatlari — imzolanmaganlari tepada */
export function MyLettersCard() {
  const my = useMyLetters(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const all = my.data?.items ?? [];
  const items = useMemo(() => [...all.filter(isOpen), ...all.filter((l) => !isOpen(l))], [all]);
  const pending = items.filter(isOpen).length;
  const stage = currentStage(all);

  if (my.isLoading || (!items.length && !my.isError)) return null;

  return (
    <Shell
      title="Tushuntirish xatlarim"
      hint="Har bir kechikish yoki kelmaslik bo‘yicha xat — o‘qing, sababini yozing va imzolang"
      right={
        <Link
          href="/tushuntirish-xatim"
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-sky-300 hover:text-sky-800 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
        >
          Batafsil <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {my.isError ? (
        <p className="text-xs text-red-600">{(my.error as Error).message}</p>
      ) : (
        <>
          {stage ? (
            <div className={cn("rounded-xl border px-3 py-2 text-xs", stageTone(stage).soft)}>
              <b>Joriy oy: {stage}-bosqich.</b> {items.find((l) => stageOf(l) === stage)?.content.nextStep}
            </div>
          ) : null}
          {pending ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <b>{pending} ta</b> tushuntirish xati imzolanmagan. Sababni yozib, imzo qo‘ying.
              </span>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 rounded-lg bg-[#0b3a5c] text-white hover:bg-[#0b3a5c]/90"
                onClick={() => setOpenId(items[pending - 1]?.id ?? items[0]!.id)}
              >
                <PenLine className="h-3.5 w-3.5" /> To‘ldirish
              </Button>
            </div>
          ) : null}
          <ul className="max-h-80 space-y-1.5 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
            {items.map((l) => (
              <LetterRow key={l.id} l={l} showName={false} onOpen={() => setOpenId(l.id)} />
            ))}
          </ul>
        </>
      )}
      <ExplanationLetterDialog letterId={openId} mode="employee" onClose={() => setOpenId(null)} />
    </Shell>
  );
}

type Tab = "waiting" | "decide" | "approved" | "cancelled" | "all";

/** Admin/HR: oy bo‘yicha barcha tushuntirish xatlari */
export function LettersAdminPanel({ month }: { month: string }) {
  const { toast } = useToast();
  const q = useMonthLetters(month, true);
  const review = useReviewLetter();
  const [tab, setTab] = useState<Tab>("waiting");
  const [stage, setStage] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const items = q.data?.items ?? [];

  const counts = useMemo(
    () => ({
      all: items.length,
      waiting: items.filter(isOpen).length,
      decide: items.filter((l) => l.status === "signed" && !l.reviewStatus).length,
      approved: items.filter((l) => l.reviewStatus === "approved").length,
      cancelled: items.filter((l) => l.reviewStatus === "cancelled").length,
    }),
    [items],
  );

  const stageCounts = useMemo(() => {
    const out: Record<number, number> = {};
    for (const l of items) out[stageOf(l)] = (out[stageOf(l)] ?? 0) + 1;
    return out;
  }, [items]);

  const list = useMemo(() => {
    const s = query.trim().toLowerCase();
    return items.filter((l) => {
      if (tab === "waiting" && !isOpen(l)) return false;
      if (tab === "decide" && (l.status !== "signed" || l.reviewStatus)) return false;
      if (tab === "approved" && l.reviewStatus !== "approved") return false;
      if (tab === "cancelled" && l.reviewStatus !== "cancelled") return false;
      if (stage != null && stageOf(l) !== stage) return false;
      return !s || `${l.fullName} ${l.branch} ${l.position} ${l.letterNo}`.toLowerCase().includes(s);
    });
  }, [items, tab, stage, query]);

  const pdf = async (l: ExplanationLetter) => {
    setBusyId(l.id);
    try {
      await downloadLetterPdf(l);
    } catch (e) {
      toast({ title: "PDF", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const approve = (l: ExplanationLetter) =>
    review.mutate(
      { id: l.id, action: "approve", note: "" },
      {
        onSuccess: () => toast({ title: "Tasdiqlandi", description: `${l.fullName} — jarima kuchida qoladi.` }),
        onError: (e) => toast({ title: "Qaror saqlanmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );

  return (
    <Shell
      title="Tushuntirish xatlari"
      hint="Jarima qayd etilgan har bir holat bo‘yicha xodim xati — bosqich, imzo, qaror va PDF"
      right={
        <Link
          href="/admin/tushuntirish-xatlari"
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-sky-300 hover:text-sky-800 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
        >
          Batafsil sahifa <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <LetterLookupBar onOpenLetter={setOpenId} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Bosqichlar (bosib filtrlang)</p>
          {stage ? (
            <button type="button" className="text-[11px] font-semibold text-sky-700 hover:underline" onClick={() => setStage(null)}>
              Filtrni olib tashlash
            </button>
          ) : null}
        </div>
        <StageLadder counts={stageCounts} value={stage} onChange={setStage} />
        <div className="grid gap-1.5 text-[11px] leading-snug sm:grid-cols-2">
          <p className="flex gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
            <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              <b>Tasdiqlash</b> — sabab uzrli emas, jarima oylikda qoladi.
            </span>
          </p>
          <p className="flex gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-700 dark:bg-white/5 dark:text-slate-200">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              <b>Bekor qilish</b> — sabab uzrli: holat jarimadan chiqadi, keyingilari bir bosqich pastga tushadi (xatni ochib, izoh bilan).
            </span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-white/5">
            {(
              [
                ["waiting", "Imzo kutilmoqda", counts.waiting],
                ["decide", "Qaror kutilmoqda", counts.decide],
                ["approved", "Tasdiqlangan", counts.approved],
                ["cancelled", "Bekor", counts.cancelled],
                ["all", "Barchasi", counts.all],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  tab === key ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white",
                )}
              >
                {label}
                <span className="min-w-[1.25rem] rounded-full bg-slate-200 px-1.5 text-[10px] font-bold tabular-nums text-slate-700 dark:bg-white/10 dark:text-slate-200">{count}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="relative ml-auto min-w-[10rem] flex-1 sm:max-w-[16rem]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ism, filial yoki №…"
            className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:focus:ring-sky-500/20"
          />
        </label>
      </div>

      {q.isError ? (
        <p className="text-xs text-red-600">{(q.error as Error).message}</p>
      ) : q.isLoading ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Yuklanmoqda…
        </p>
      ) : !list.length ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          {query.trim() || stage
            ? "Filtr bo‘yicha hech narsa topilmadi."
            : !items.length
              ? "Bu oyda tushuntirish xati talab qilingan holat yo‘q."
              : tab === "waiting"
                ? "Barcha xatlar imzolangan."
                : tab === "decide"
                  ? "Qaror kutayotgan xat yo‘q."
                  : "Bu bo‘limda xat yo‘q."}
        </div>
      ) : (
        <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
          {list.map((l) => (
            <LetterRow
              key={l.id}
              l={l}
              showName
              onOpen={() => setOpenId(l.id)}
              action={
                <div className="flex shrink-0 gap-1">
                  {l.status === "signed" && !l.reviewStatus ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 w-8 gap-1 rounded-lg bg-emerald-600 p-0 text-xs text-white hover:bg-emerald-700 sm:h-7 sm:w-auto sm:px-2"
                      disabled={review.isPending}
                      title="Tasdiqlash (jarima qoladi)"
                      onClick={(e) => {
                        e.stopPropagation();
                        approve(l);
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Tasdiqlash</span>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 gap-1 rounded-lg p-0 text-xs sm:h-7 sm:w-auto sm:px-2"
                    disabled={busyId === l.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void pdf(l);
                    }}
                  >
                    {busyId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">PDF</span>
                  </Button>
                </div>
              }
            />
          ))}
        </ul>
      )}
      <ExplanationLetterDialog letterId={openId} mode="admin" onClose={() => setOpenId(null)} />
    </Shell>
  );
}
