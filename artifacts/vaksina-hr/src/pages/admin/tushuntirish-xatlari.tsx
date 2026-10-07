import { useMemo, useState, type ReactNode } from "react";
import {
  CalendarX2,
  CheckCircle2,
  Clock3,
  Eye,
  FileDown,
  FileSignature,
  Heading,
  Loader2,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { ExplanationLetterDialog, StatusChip, TestChip } from "@/components/explanation-letter/ExplanationLetterDialog";
import { ReviewChip, StageBadge } from "@/components/explanation-letter/LetterReviewPanel";
import { StageLadder } from "@/components/explanation-letter/StageLadder";
import { LetterHeaderDialog } from "@/components/explanation-letter/LetterHeaderDialog";
import { LetterLookupBar } from "@/components/explanation-letter/LetterLookup";
import {
  FINAL_STRIKE,
  LETTER_STAGES,
  canManageLetters,
  downloadLetterPdf,
  downloadLettersBulk,
  fmtLetterDate,
  fmtLetterStamp,
  fmtSum,
  useMonthLetters,
  useReviewLetter,
  type ExplanationLetter,
} from "@/lib/explanation-letters-api";

type StatusTab = "all" | "waiting" | "decide" | "approved" | "cancelled";
type KindTab = "all" | "late" | "absent";

const MONTHS_UZ = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
const BULK_MAX = 300;

function thisMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

function monthLabel(m: string) {
  if (m === "all") return "Barcha oylar";
  const [y, mm] = m.split("-").map(Number);
  return y && mm ? `${MONTHS_UZ[mm - 1]} ${y}` : m;
}

function penaltyLabel(n: number) {
  return LETTER_STAGES[Math.min(n, FINAL_STRIKE) - 1]?.label ?? "";
}

const stageOf = (l: ExplanationLetter) => Math.min(l.strikeN, FINAL_STRIKE);

function eventDetail(l: ExplanationLetter) {
  if (l.kind === "absent") return l.planStart && l.planEnd ? `Ish vaqti ${l.planStart}–${l.planEnd}` : "Ishga kelmagan";
  const parts = [l.planStart ? `Reja ${l.planStart}` : null, l.checkIn ? `keldi ${l.checkIn}` : null].filter(Boolean);
  return `${parts.join(" · ")}${l.lateMinutes ? ` · ${l.lateMinutes} daq.` : ""}` || "Kechikkan";
}

export default function TushuntirishXatlariPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canManageLetters(user?.role);
  const [month, setMonth] = useState(thisMonth);
  const [status, setStatus] = useState<StatusTab>("all");
  const [kind, setKind] = useState<KindTab>("all");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const q = useMonthLetters(month, allowed);
  const review = useReviewLetter();

  const items = q.data?.items ?? [];
  const months = useMemo(() => {
    const set = new Set([thisMonth(), ...(q.data?.months ?? [])]);
    if (month !== "all") set.add(month);
    return [...set].sort().reverse();
  }, [q.data?.months, month]);

  const stats = useMemo(
    () => ({
      all: items.length,
      signed: items.filter((l) => l.status === "signed").length,
      waiting: items.filter((l) => l.status !== "signed" && l.reviewStatus !== "cancelled").length,
      decide: items.filter((l) => l.status === "signed" && !l.reviewStatus).length,
      approved: items.filter((l) => l.reviewStatus === "approved").length,
      cancelled: items.filter((l) => l.reviewStatus === "cancelled").length,
      late: items.filter((l) => l.kind === "late").length,
      absent: items.filter((l) => l.kind === "absent").length,
    }),
    [items],
  );

  const stageCounts = useMemo(() => {
    const out: Record<number, number> = {};
    for (const l of items) out[stageOf(l)] = (out[stageOf(l)] ?? 0) + 1;
    return out;
  }, [items]);

  const list = useMemo(() => {
    const s = query.trim().toLocaleLowerCase("uz");
    return items.filter((l) => {
      if (status === "waiting" && (l.status === "signed" || l.reviewStatus === "cancelled")) return false;
      if (status === "decide" && (l.status !== "signed" || l.reviewStatus)) return false;
      if (status === "approved" && l.reviewStatus !== "approved") return false;
      if (status === "cancelled" && l.reviewStatus !== "cancelled") return false;
      if (kind !== "all" && l.kind !== kind) return false;
      if (stage != null && stageOf(l) !== stage) return false;
      if (!s) return true;
      return `${l.fullName} ${l.branch} ${l.position} ${l.letterNo} ${l.phone ?? ""} ${l.reasonText ?? ""}`
        .toLocaleLowerCase("uz")
        .includes(s);
    });
  }, [items, status, kind, stage, query]);

  const approve = (l: ExplanationLetter) =>
    review.mutate(
      { id: l.id, action: "approve", note: "" },
      {
        onSuccess: () => toast({ title: "Tasdiqlandi", description: `${l.fullName} — jarima kuchida qoladi.` }),
        onError: (e) => toast({ title: "Qaror saqlanmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );

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

  const bulk = async () => {
    if (!list.length) return;
    setBulkBusy(true);
    try {
      await downloadLettersBulk({ month, status: "all", ids: list.slice(0, BULK_MAX).map((l) => l.id) });
      if (list.length > BULK_MAX) toast({ title: "Birinchi 300 ta xat yuklandi", description: "Qolganlari uchun filtrni toraytiring." });
    } catch (e) {
      toast({ title: "PDF", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBulkBusy(false);
    }
  };

  if (!allowed) {
    return <div className="p-6 text-sm text-muted-foreground">Faqat admin va HR uchun.</div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-3 py-4 sm:px-5 sm:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0b3a5c] text-white shadow-sm shadow-sky-900/30">
          <FileSignature className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl dark:text-white">Tushuntirish xatlari</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Har bir kechikish va kelmaslik bo‘yicha xodim xati — sabab, imzo, QR va PDF bir joyda
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button type="button" variant="outline" className="h-10 shrink-0 gap-1.5 rounded-xl" onClick={() => setHeaderOpen(true)}>
            <Heading className="h-4 w-4" />
            <span className="hidden sm:inline">Xat shapkasi</span>
          </Button>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 sm:flex-none dark:border-white/10 dark:bg-slate-900 dark:text-white"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
            <option value="all">Barcha oylar</option>
          </select>
          <Button
            type="button"
            className="h-10 shrink-0 gap-1.5 rounded-xl bg-[#0b3a5c] text-white hover:bg-[#0b3a5c]/90"
            disabled={!list.length || bulkBusy}
            onClick={() => void bulk()}
          >
            {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            <span className="hidden sm:inline">Ro‘yxatni PDF</span>
            <span className="sm:hidden">PDF</span>
            <span className="rounded-full bg-white/20 px-1.5 text-[11px] tabular-nums">{Math.min(list.length, BULK_MAX)}</span>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Jami" value={stats.all} loading={q.isLoading} tone="bg-slate-50 text-slate-800 ring-slate-200 dark:bg-white/5 dark:text-white dark:ring-white/10" />
        <Stat label="Imzo kutilmoqda" value={stats.waiting} loading={q.isLoading} tone="bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30" />
        <Stat label="Qaror kutilmoqda" value={stats.decide} loading={q.isLoading} tone="bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/30" />
        <Stat label="Tasdiqlangan" value={stats.approved} loading={q.isLoading} tone="bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/30" />
        <Stat
          label="Bekor qilingan"
          value={stats.cancelled}
          loading={q.isLoading}
          tone="col-span-2 bg-slate-100 text-slate-700 ring-slate-300 sm:col-span-1 dark:bg-white/5 dark:text-slate-200 dark:ring-white/15"
        />
      </div>

      <LetterLookupBar onOpenLetter={setOpenId} />

      <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-900">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm font-bold text-slate-900 dark:text-white">Bosqichlar bo‘yicha</p>
          <p className="text-[11px] text-slate-500">
            {stage ? (
              <button type="button" className="font-semibold text-sky-700 hover:underline" onClick={() => setStage(null)}>
                Filtrni olib tashlash
              </button>
            ) : (
              "Bosqichni bosib, ro‘yxatni filtrlang"
            )}
          </p>
        </div>
        <StageLadder counts={stageCounts} value={stage} onChange={setStage} />
        <p className="text-[11px] leading-snug text-slate-500">
          <b className="text-slate-700 dark:text-slate-200">Tasdiqlash</b> — jarima oylikda qoladi.{" "}
          <b className="text-slate-700 dark:text-slate-200">Bekor qilish</b> — holat uzrli deb topiladi, jarimadan chiqariladi va
          keyingi holatlar bir bosqich pastga tushadi. Qaror xatni ochib, o‘ng paneldagi «Rahbariyat qarori» bo‘limida qabul qilinadi.
        </p>
      </section>

      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 sm:flex-row sm:flex-wrap sm:items-center dark:border-white/10 dark:bg-slate-900">
        <div className="-mx-0.5 max-w-full overflow-x-auto px-0.5 [scrollbar-width:none]">
          <Segmented<StatusTab>
            value={status}
            onChange={setStatus}
            options={[
              ["all", "Barchasi", stats.all],
              ["waiting", "Imzo kutilmoqda", stats.waiting],
              ["decide", "Qaror kutilmoqda", stats.decide],
              ["approved", "Tasdiqlangan", stats.approved],
              ["cancelled", "Bekor", stats.cancelled],
            ] as const}
          />
        </div>
        <Segmented<KindTab>
          value={kind}
          onChange={setKind}
          options={[
            ["all", "Hammasi", null],
            ["late", "Kechikish", stats.late],
            ["absent", "Kelmagan", stats.absent],
          ] as const}
        />
        <label className="relative min-w-0 flex-1 sm:ml-auto sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ism, filial, telefon yoki №…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:focus:ring-sky-500/20"
          />
        </label>
      </div>

      {q.isError ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{(q.error as Error).message}</p>
      ) : q.isLoading ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
        </p>
      ) : !list.length ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500 dark:border-white/10">
          <ShieldCheck className="h-8 w-8 text-emerald-500" />
          {items.length ? "Filtr bo‘yicha xat topilmadi." : `${monthLabel(month)} — tushuntirish xati talab qilingan holat yo‘q.`}
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block dark:border-white/10 dark:bg-slate-900">
            <table className="w-full table-fixed text-left text-[13px]">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="w-[19%] px-3 py-2.5">Xodim</th>
                  <th className="w-[12%] px-3 py-2.5">Filial</th>
                  <th className="w-[14%] px-3 py-2.5">Muammo</th>
                  <th className="w-[13%] px-3 py-2.5">Bosqich · chora</th>
                  <th className="px-3 py-2.5">Sabab (xodim yozgan)</th>
                  <th className="w-[15%] px-3 py-2.5">Holati · qaror</th>
                  <th className="w-[120px] px-3 py-2.5 text-right">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {list.map((l) => (
                  <tr key={l.id} onClick={() => setOpenId(l.id)} className="cursor-pointer align-top transition hover:bg-sky-50/50 dark:hover:bg-white/5">
                    <td className="px-3 py-2.5">
                      <p className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                        <span className="truncate">{l.fullName}</span>
                        {l.isTest ? <TestChip /> : null}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">{l.position || "—"}</p>
                      {l.phone ? <p className="text-[11px] tabular-nums text-slate-400">{l.phone}</p> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="line-clamp-2 text-slate-700 dark:text-slate-200">{l.branch || "—"}</p>
                      <p className="truncate text-[11px] text-slate-400">{l.shift}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <KindBadge l={l} />
                      <p className="mt-1 text-[11px] text-slate-500">{fmtLetterDate(l.eventDate)}</p>
                      <p className="text-[11px] text-slate-400">{eventDetail(l)}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <StageBadge n={l.strikeN} />
                      <p className="mt-1 text-[11px] text-slate-500">{penaltyLabel(l.strikeN)}</p>
                      {l.amount > 0 ? <p className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtSum(l.amount)}</p> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      {l.reasonText ? (
                        <p className="line-clamp-3 text-[12px] text-slate-600 dark:text-slate-300">{l.reasonText}</p>
                      ) : (
                        <p className="text-[12px] italic text-slate-400">Hali yozilmagan</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        <StatusChip status={l.status} />
                        <ReviewChip status={l.reviewStatus} />
                      </div>
                      {l.signedAt ? <p className="mt-1 text-[11px] tabular-nums text-slate-500">{fmtLetterStamp(l.signedAt)}</p> : null}
                      {l.reviewedByName ? <p className="truncate text-[10px] text-slate-500">Qaror: {l.reviewedByName}</p> : null}
                      <p className="text-[10px] text-slate-400">№ {l.letterNo}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        {l.status === "signed" && !l.reviewStatus ? (
                          <IconBtn title="Tasdiqlash (jarima qoladi)" disabled={review.isPending} onClick={() => approve(l)} tone="success">
                            <CheckCircle2 className="h-4 w-4" />
                          </IconBtn>
                        ) : null}
                        <IconBtn title="Ko‘rish" onClick={() => setOpenId(l.id)}>
                          <Eye className="h-4 w-4" />
                        </IconBtn>
                        <IconBtn title="PDF yuklab olish" disabled={busyId === l.id} onClick={() => void pdf(l)}>
                          {busyId === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {list.map((l) => (
              <li
                key={l.id}
                onClick={() => setOpenId(l.id)}
                className={cn(
                  "rounded-2xl border bg-white p-3 shadow-sm active:scale-[0.99] dark:bg-slate-900",
                  l.status === "signed" ? "border-slate-200 dark:border-white/10" : "border-amber-200 dark:border-amber-500/30",
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
                      {l.fullName}
                      {l.isTest ? <TestChip /> : null}
                    </p>
                    <p className="text-[11px] text-slate-500">{l.position || "—"}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusChip status={l.status} />
                    <ReviewChip status={l.reviewStatus} />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                  <KindBadge l={l} />
                  <span className="font-semibold">{fmtLetterDate(l.eventDate)}</span>
                  <span>{eventDetail(l)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  {l.branch ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {l.branch}
                    </span>
                  ) : null}
                  {l.phone ? (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Phone className="h-3 w-3" /> {l.phone}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <StageBadge n={l.strikeN} />
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{penaltyLabel(l.strikeN)}</span>
                  {l.amount > 0 ? <span className="tabular-nums text-slate-500">· {fmtSum(l.amount)}</span> : null}
                </div>
                <div className="mt-2 rounded-xl bg-slate-50 px-2.5 py-2 text-[12px] dark:bg-white/5">
                  {l.reasonText ? (
                    <p className="line-clamp-3 text-slate-600 dark:text-slate-300">{l.reasonText}</p>
                  ) : (
                    <p className="italic text-slate-400">Sabab hali yozilmagan</p>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
                    № {l.letterNo}
                    {l.signedAt ? ` · imzo ${fmtLetterStamp(l.signedAt)}` : ""}
                  </p>
                  {l.status === "signed" && !l.reviewStatus ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 gap-1 rounded-xl bg-emerald-600 px-3 text-white hover:bg-emerald-700"
                      disabled={review.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        approve(l);
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Tasdiqlash
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1 rounded-xl px-3"
                    disabled={busyId === l.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void pdf(l);
                    }}
                  >
                    {busyId === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                    PDF
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ExplanationLetterDialog letterId={openId} mode="admin" onClose={() => setOpenId(null)} />
      <LetterHeaderDialog open={headerOpen} onClose={() => setHeaderOpen(false)} />
    </div>
  );
}

function KindBadge({ l }: { l: ExplanationLetter }) {
  return l.kind === "late" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800 dark:bg-orange-500/20 dark:text-orange-200">
      <Clock3 className="h-3 w-3" /> Kechikish
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-500/20 dark:text-red-200">
      <CalendarX2 className="h-3 w-3" /> Kelmagan
    </span>
  );
}

function IconBtn({
  title,
  onClick,
  disabled,
  tone,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "success";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg border transition disabled:opacity-50",
        tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
          : "border-slate-200 text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<readonly [T, string, number | null]>;
}) {
  return (
    <div className="grid w-max min-w-full auto-cols-fr grid-flow-col rounded-xl bg-slate-100 p-1 dark:bg-white/5">
      {options.map(([key, label, count]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
            value === key ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white",
          )}
        >
          {label}
          {count != null ? (
            <span className="min-w-[1.25rem] rounded-full bg-slate-200 px-1.5 text-[10px] font-bold tabular-nums text-slate-700 dark:bg-white/10 dark:text-slate-200">{count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, loading, tone }: { label: string; value: number; loading: boolean; tone: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 ring-1", tone)}>
      <p className="text-[11px] font-bold uppercase tracking-wide">{label}</p>
      <span className="text-xl font-extrabold tabular-nums">{loading ? "…" : value}</span>
    </div>
  );
}
