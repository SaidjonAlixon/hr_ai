import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { canViewHolat } from "../../lib/roles";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { useToast } from "../../hooks/use-toast";
import {
  fetchXodimReport,
  searchXodimlar,
  sealXodimReport,
  PLATFORM_START,
  XODIM_STATUS_OPTIONS,
  type XodimDayStatus,
  type XodimReport,
  type XodimSearchHit,
  type XodimSeal,
} from "../../lib/xodim-hisobot-api";
import { downloadXodimHisobotPdf } from "../../lib/xodim-hisobot-pdf";
import { XodimHisobotSheet } from "./xodim-hisobot-sheet";
import { FileText, Loader2, Search } from "lucide-react";

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const DEFAULT_STATUSES: XodimDayStatus[] = ["present", "late", "absent", "incomplete", "leave", "planned", "rest"];

function monthRange(ym: string, capToday = true): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0));
  let to = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(last);
  const today = todayYmd();
  if (capToday && to > today) to = today;
  return { from, to };
}

function shiftMonth(delta: number) {
  const today = todayYmd();
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return monthRange(ym, delta === 0);
}

function showDate(ymd: string) {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}

type PeriodId = "month" | "prev" | "full" | "custom";

const PERIODS: Array<{ id: PeriodId; title: string; hint: string }> = [
  { id: "month", title: "Shu oy", hint: "1-sanadan bugungacha." },
  { id: "prev", title: "O‘tgan oy", hint: "O‘tgan oyning to‘liq kunlari." },
  { id: "full", title: "To‘liq", hint: "01.09.2026 dan bugungacha." },
  { id: "custom", title: "Sana tanlash", hint: "Boshlanish va tugashni o‘zingiz qo‘yasiz." },
];

function clampRange(from: string, to: string) {
  const today = todayYmd();
  let nextTo = to > today ? today : to;
  let nextFrom = from < PLATFORM_START ? PLATFORM_START : from;
  if (nextTo < PLATFORM_START) nextTo = PLATFORM_START;
  if (nextFrom > nextTo) nextFrom = nextTo;
  return { from: nextFrom, to: nextTo, clipped: nextFrom !== from || nextTo !== to };
}

export default function XodimHisobotPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canViewHolat(user?.role);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<XodimSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<XodimSearchHit | null>(null);
  const [from, setFrom] = useState(() => clampRange(shiftMonth(0).from, shiftMonth(0).to).from);
  const [to, setTo] = useState(() => clampRange(shiftMonth(0).from, shiftMonth(0).to).to);
  const [preset, setPreset] = useState<PeriodId>("month");
  const [statuses, setStatuses] = useState<XodimDayStatus[]>(DEFAULT_STATUSES);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<XodimReport | null>(null);
  const [wantSeal, setWantSeal] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [seal, setSeal] = useState<XodimSeal | null>(null);
  const [pdfing, setPdfing] = useState(false);
  const sheetRoot = useRef<HTMLDivElement>(null);

  const sealKey = useMemo(
    () =>
      picked
        ? `${picked.employeeId ?? 0}|${picked.userId ?? 0}|${from}|${to}|${statuses.slice().sort().join(",")}`
        : "",
    [picked, from, to, statuses],
  );

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchXodimlar(query)
        .then((rows) => {
          if (live) setHits(rows);
        })
        .catch(() => {
          if (live) setHits([]);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  function applyPreset(next: PeriodId) {
    setPreset(next);
    setSeal(null);
    if (next === "month") {
      const r = clampRange(shiftMonth(0).from, shiftMonth(0).to);
      setFrom(r.from);
      setTo(r.to);
    } else if (next === "prev") {
      const raw = shiftMonth(-1);
      const r = clampRange(raw.from, raw.to);
      setFrom(r.from);
      setTo(r.to);
      if (raw.to < PLATFORM_START) toast({ title: "Davr", description: "Hisobot 01.09.2026 dan boshlanadi" });
    } else if (next === "full") {
      const hired = picked?.hiredAt && /^\d{4}-\d{2}-\d{2}/.test(picked.hiredAt) ? picked.hiredAt.slice(0, 10) : PLATFORM_START;
      const range = clampRange(hired, todayYmd());
      setFrom(range.from);
      setTo(range.to);
    }
  }

  function toggleStatus(id: XodimDayStatus) {
    setStatuses((prev) => {
      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      return next.length ? next : prev;
    });
    setSeal(null);
  }

  async function openReport() {
    if (!picked) return;
    const range = clampRange(from, to);
    if (range.from !== from) setFrom(range.from);
    if (range.to !== to) setTo(range.to);
    if (to < PLATFORM_START) {
      toast({ title: "Sana", description: "Hisobot 01.09.2026 dan boshlanadi" });
      return;
    }
    if (range.from > range.to) {
      toast({ title: "Sana", description: "Boshlanish tugashdan oldin bo‘lsin" });
      return;
    }
    setLoading(true);
    setSeal(null);
    setWantSeal(false);
    try {
      const data = await fetchXodimReport({
        employeeId: picked.employeeId,
        userId: picked.userId,
        from: range.from,
        to: range.to,
        statuses,
      });
      setReport(data);
    } catch (err) {
      toast({ title: "Hisobot ochilmadi", description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  async function onSeal(checked: boolean) {
    setWantSeal(checked);
    if (!checked || !picked) return;
    if (seal && sealKey && seal.report.from === from && seal.report.to === to) {
      const same =
        seal.report.from === from &&
        seal.report.to === to &&
        seal.report.statuses.slice().sort().join(",") === statuses.slice().sort().join(",");
      if (same) return;
    }
    setSealing(true);
    try {
      const next = await sealXodimReport({
        employeeId: picked.employeeId,
        userId: picked.userId,
        from,
        to,
        statuses,
      });
      setSeal(next);
      setReport(next.report);
    } catch (err) {
      setWantSeal(false);
      toast({ title: "Tasdiq saqlanmadi", description: (err as Error).message });
    } finally {
      setSealing(false);
    }
  }

  async function onPdf() {
    if (!report || !sheetRoot.current) return;
    setPdfing(true);
    try {
      const active = wantSeal && seal ? seal : null;
      const verifyUrl = active ? `${window.location.origin}${active.verifyPath}` : "";
      await downloadXodimHisobotPdf(
        sheetRoot.current,
        active ? active.report : report,
        active
          ? {
              sealedAt: active.sealedAt,
              title: active.title,
              approverLine: active.approverLine,
              verifyUrl,
            }
          : null,
      );
    } catch (err) {
      toast({ title: "PDF olinmadi", description: (err as Error).message });
    } finally {
      setPdfing(false);
    }
  }

  if (!allowed) {
    return <p className="p-6 text-sm text-muted-foreground">Xodimlar hisoboti sizga ochiq emas</p>;
  }

  const shownSeal =
    wantSeal && seal
      ? {
          sealedAt: seal.sealedAt,
          title: seal.title,
          approverLine: seal.approverLine,
          verifyUrl: `${window.location.origin}${seal.verifyPath}`,
        }
      : null;

  const activePeriod = PERIODS.find((p) => p.id === preset) ?? PERIODS[0]!;

  return (
    <div className="space-y-5 pb-10">
      <div className="rounded-2xl bg-[#0b3a5c] px-5 py-5 text-white shadow-md">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-100">Hisobot</p>
        <h1 className="mt-1 text-2xl font-semibold">Xodimlar hisoboti</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-sky-50/90">
          Uch qadam: xodimni tanlang, davrni belgilang, kerakli holatlarni yoqing. «Hisobot olish» shu tanlov bo‘yicha davomat, topshiriq, javob olish, atestatsiya va darslikni ochadi. Hisobot 01.09.2026 dan boshlanadi.
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-950"><span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-[#0b3a5c] text-xs text-white">1</span>Xodim</h2>
            <p className="text-xs text-slate-500">{picked ? "Tanlandi" : "Tanlanmagan"}</p>
          </div>
          <p className="mt-1 text-sm text-slate-500">Ism, telefon yoki loginni lotin yoki kirillda yozing. Chiqqan odamni bosing — hisobot shu xodimga bog‘lanadi.</p>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPicked(null);
                setReport(null);
                setSeal(null);
              }}
              placeholder="Masalan: Aliyev yoki Алиев, telefon, login"
              className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-sm outline-none focus:border-[#0b3a5c] focus:bg-white"
            />
            {searching ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" /> : null}
          </div>
          {q.trim().length > 0 && q.trim().length < 2 ? (
            <p className="mt-2 text-xs text-slate-500">Qidirish uchun kamida 2 ta harf yozing.</p>
          ) : null}
          {hits.length > 0 && !picked ? (
            <ul className="mt-2 overflow-hidden rounded-xl border border-slate-200">
              {hits.map((h) => (
                <li key={`${h.employeeId ?? "u"}-${h.userId ?? h.id}`} className="border-t border-slate-100 first:border-t-0">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-sky-50"
                    onClick={() => {
                      setPicked(h);
                      setQ(h.fullName);
                      setHits([]);
                      setSeal(null);
                      setReport(null);
                    }}
                  >
                    <span>
                      <span className="block font-medium text-slate-950">{h.fullName}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {h.roleLabel} · {h.branch} · {h.phone || "telefon yo‘q"}
                        {h.employmentStatus && h.employmentStatus !== "working" ? " · arxiv" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-[#0b3a5c] px-3 py-1 text-xs font-semibold text-white">Tanlash</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {!searching && q.trim().length >= 2 && hits.length === 0 && !picked ? (
            <p className="mt-2 text-sm text-slate-500">Hech kim topilmadi. Ismni lotin yoki kirillda qayta yozing.</p>
          ) : null}
          {picked ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Hisobot shu xodim uchun ochiladi</p>
                <p className="mt-0.5 font-semibold text-slate-950">{picked.fullName}</p>
                <p className="text-xs text-slate-600">{picked.roleLabel} · {picked.branch} · {picked.phone || "telefon yo‘q"}</p>
              </div>
              <button
                type="button"
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
                onClick={() => {
                  setPicked(null);
                  setQ("");
                  setReport(null);
                  setSeal(null);
                }}
              >
                Boshqa xodim
              </button>
            </div>
          ) : null}
        </section>

        <section className="border-t border-slate-100 pt-4">
          <h2 className="text-sm font-semibold text-slate-950"><span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-[#0b3a5c] text-xs text-white">2</span>Davr</h2>
          <p className="mt-1 text-sm text-slate-500">Bitta davr yetarli. Sana maydoni faqat «Sana tanlash»da ochiladi.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {PERIODS.map((item) => {
              const on = preset === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyPreset(item.id)}
                  className={`rounded-xl px-3 py-3 text-left ring-1 ${on ? "bg-[#0b3a5c] text-white ring-[#0b3a5c]" : "bg-white text-slate-800 ring-slate-200 hover:bg-slate-50"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{item.title}</span>
                    <span className={`text-[11px] font-semibold ${on ? "text-sky-100" : "text-slate-400"}`}>{on ? "Tanlangan" : "Tanlash"}</span>
                  </span>
                  <span className={`mt-1 block text-xs leading-relaxed ${on ? "text-sky-100" : "text-slate-500"}`}>{item.hint}</span>
                </button>
              );
            })}
          </div>
          {preset === "custom" ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Dan</span>
                <input
                  type="date"
                  min={PLATFORM_START}
                  max={todayYmd()}
                  value={from}
                  onChange={(e) => {
                    const next = e.target.value < PLATFORM_START ? PLATFORM_START : e.target.value;
                    if (e.target.value && e.target.value < PLATFORM_START) {
                      toast({ title: "Sana", description: "Hisobot 01.09.2026 dan boshlanadi" });
                    }
                    setFrom(next);
                    setSeal(null);
                  }}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Gacha</span>
                <input
                  type="date"
                  min={PLATFORM_START}
                  max={todayYmd()}
                  value={to}
                  onChange={(e) => {
                    const next = e.target.value < PLATFORM_START ? PLATFORM_START : e.target.value;
                    if (e.target.value && e.target.value < PLATFORM_START) {
                      toast({ title: "Sana", description: "Hisobot 01.09.2026 dan boshlanadi" });
                    }
                    setTo(next);
                    setSeal(null);
                  }}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm"
                />
              </label>
            </div>
          ) : null}
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Hozir: <span className="font-semibold">{activePeriod.title}</span> · {showDate(from)} — {showDate(to)}
          </p>
        </section>

        <section className="border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-sm font-semibold text-slate-950"><span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-[#0b3a5c] text-xs text-white">3</span>Holatlar</h2>
            <div className="flex flex-wrap gap-1.5">
              {XODIM_STATUS_OPTIONS.map((s) => {
                const on = statuses.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleStatus(s.id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${on ? "bg-emerald-600 text-white ring-emerald-600" : "bg-white text-slate-500 ring-slate-200"}`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">Hammasi yoqilgan. Kerakmasini bossangiz, hisobotdan chiqadi.</p>
        </section>

        <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
          {picked
            ? `«Hisobot olish» ${picked.fullName} uchun ${showDate(from)} — ${showDate(to)} oralig‘idagi yoqilgan holatlarni ochadi.`
            : "«Hisobot olish» hozir ishlamaydi. Avval 1-qadamda xodimni tanlang."}
        </div>
        <Button type="button" className="h-12 w-full rounded-xl text-base sm:w-auto sm:px-8" disabled={!picked || loading} onClick={() => void openReport()}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
          Hisobot olish
        </Button>
      </div>

      {report ? (
        <div className="space-y-3">
          <XodimHisobotSheet rootRef={sheetRoot} report={wantSeal && seal ? seal.report : report} seal={shownSeal} />
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
            <label className={`rounded-xl p-3 ring-1 ${wantSeal ? "bg-emerald-50 ring-emerald-300" : "bg-slate-50 ring-slate-200"}`}>
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Checkbox checked={wantSeal} disabled={sealing} onCheckedChange={(v) => void onSeal(v === true)} />
                Admin tasdig‘i
                {sealing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              </span>
              <span className="mt-2 block text-xs leading-relaxed text-slate-500">
                Belgilansa, hisobot yopiladi: sana, soat va «Tasdiqlaydi platforma mas'uli Saidmuhammadalixon» yozuvi hamda QR chiqadi. QR ochilganda hujjatda yashil «TASDIQLANGAN» pechati turadi.
              </span>
            </label>
            <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
              <Button type="button" disabled={pdfing || sealing} onClick={() => void onPdf()} className="h-11 w-full rounded-xl">
                {pdfing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                PDF yuklash
              </Button>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Ekrandagi hisobotni A4 kitob formatida fayl qilib oladi. Tasdiq yoqilgan bo‘lsa, fayl nomi «Hisobot VAKSINAMEDHR» bo‘ladi va QR ham tushadi.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
