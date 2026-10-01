import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { canViewHolat } from "../../lib/roles";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { useToast } from "../../hooks/use-toast";
import {
  fetchFilialReport,
  fetchFilials,
  fetchStaffDays,
  fetchXodimReport,
  searchXodimlar,
  publicVerifyUrl,
  sealXodimReport,
  PLATFORM_START,
  XODIM_STATUS_OPTIONS,
  type FilialEmployeePick,
  type FilialPick,
  type FilialReport,
  type XodimDayStatus,
  type XodimReport,
  type XodimSearchHit,
  type XodimSeal,
} from "../../lib/xodim-hisobot-api";
import { downloadPagesPdf, downloadXodimHisobotPdf } from "../../lib/xodim-hisobot-pdf";
import { isVacancyPlaceholder } from "../../lib/vacancy-slot";
import { FilialHisobotDocument, filialStatusCount, statusCountClass } from "./filial-hisobot-view";
import { XodimHisobotSheet } from "./xodim-hisobot-sheet";
import { Building2, CalendarDays, CalendarRange, Check, FileText, Loader2, Search, UserRound } from "lucide-react";

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const DEFAULT_STATUSES: XodimDayStatus[] = ["present", "late", "absent", "incomplete", "leave", "planned", "rest"];

function showDate(ymd: string) {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}

type PickMode = "filial" | "xodim";
type PeriodId = "full" | "custom";

const PERIODS: Array<{ id: PeriodId; title: string; hint: string }> = [
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
  const [filials, setFilials] = useState<FilialPick[]>([]);
  const [filialsLoading, setFilialsLoading] = useState(true);
  const [pickMode, setPickMode] = useState<PickMode>("filial");
  const [branchId, setBranchId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<XodimSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickedHits, setPickedHits] = useState<XodimSearchHit[]>([]);
  const [picked, setPicked] = useState<XodimSearchHit | null>(null);
  const [filialReport, setFilialReport] = useState<FilialReport | null>(null);
  const [from, setFrom] = useState(() => clampRange(PLATFORM_START, todayYmd()).from);
  const [to, setTo] = useState(() => clampRange(PLATFORM_START, todayYmd()).to);
  const [preset, setPreset] = useState<PeriodId>("full");
  const [statuses, setStatuses] = useState<XodimDayStatus[]>(DEFAULT_STATUSES);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<XodimReport | null>(null);
  const [wantSeal, setWantSeal] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [seal, setSeal] = useState<XodimSeal | null>(null);
  const [pdfing, setPdfing] = useState(false);
  const sheetRoot = useRef<HTMLDivElement>(null);
  const filialRoot = useRef<HTMLDivElement>(null);
  const [focusEmpId, setFocusEmpId] = useState<number | null>(null);

  const sealKey = useMemo(
    () =>
      picked
        ? `${picked.employeeId ?? 0}|${picked.userId ?? 0}|${from}|${to}|${statuses.slice().sort().join(",")}`
        : "",
    [picked, from, to, statuses],
  );

  useEffect(() => {
    let live = true;
    setFilialsLoading(true);
    void fetchFilials()
      .then((rows) => {
        if (!live) return;
        setFilials(rows);
        const first = rows[0];
        if (first) {
          setBranchId(first.id);
          setSelectedIds(first.employees.map((e) => e.employeeId));
        }
      })
      .catch(() => {
        if (live) setFilials([]);
      })
      .finally(() => {
        if (live) setFilialsLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (pickMode !== "xodim") return;
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
          if (!live) return;
          setHits(
            rows.filter(
              (row) =>
                !isVacancyPlaceholder(row) &&
                row.employmentStatus !== "no_manager" &&
                !(row.employmentStatus === "closed" && row.userId == null),
            ),
          );
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
  }, [q, pickMode]);

  const branch = filials.find((f) => f.id === branchId) ?? null;

  function clearResult() {
    setPicked(null);
    setReport(null);
    setFilialReport(null);
    setSeal(null);
    setFocusEmpId(null);
  }

  function chooseBranch(id: number) {
    const next = filials.find((f) => f.id === id) ?? null;
    setBranchId(next?.id ?? null);
    setSelectedIds(next ? next.employees.map((e) => e.employeeId) : []);
    clearResult();
  }

  function sameHit(a: XodimSearchHit, b: XodimSearchHit) {
    return (a.employeeId != null && a.employeeId === b.employeeId) || (a.userId != null && a.userId === b.userId);
  }

  function toggleHit(hit: XodimSearchHit) {
    setPickedHits((prev) => (prev.some((p) => sameHit(p, hit)) ? prev.filter((p) => !sameHit(p, hit)) : [...prev, hit]));
    clearResult();
  }

  function toggleEmployee(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSeal(null);
    setReport(null);
    setFilialReport(null);
  }

  function hitFromEmployee(person: FilialEmployeePick): XodimSearchHit {
    return {
      id: person.employeeId,
      employeeId: person.employeeId,
      userId: person.userId,
      fullName: person.fullName,
      roleLabel: person.roleLabel,
      branch: branch?.name || "—",
      phone: person.phone,
      login: null,
      employmentStatus: "working",
      hiredAt: person.hiredAt,
    };
  }

  function applyPreset(next: PeriodId) {
    setPreset(next);
    setSeal(null);
    if (next === "full") {
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

  async function openOne(person: FilialEmployeePick) {
    const range = clampRange(from, to);
    if (range.from !== from) setFrom(range.from);
    if (range.to !== to) setTo(range.to);
    if (range.from > range.to || range.to < PLATFORM_START) {
      toast({ title: "Sana", description: "Hisobot 01.09.2026 dan boshlanadi" });
      return;
    }
    const hit = hitFromEmployee(person);
    setPicked(hit);
    setLoading(true);
    setSeal(null);
    setWantSeal(false);
    try {
      const data = await fetchXodimReport({
        employeeId: hit.employeeId,
        userId: hit.userId,
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

  async function openReport() {
    const range = clampRange(from, to);
    if (range.from !== from) setFrom(range.from);
    if (range.to !== to) setTo(range.to);
    if (range.to < PLATFORM_START) {
      toast({ title: "Sana", description: "Hisobot 01.09.2026 dan boshlanadi" });
      return;
    }
    if (range.from > range.to) {
      toast({ title: "Sana", description: "Boshlanish tugashdan oldin bo‘lsin" });
      return;
    }
    if (pickMode === "xodim") {
      if (!pickedHits.length) return;
      setLoading(true);
      setSeal(null);
      setWantSeal(false);
      setReport(null);
      setFilialReport(null);
      try {
        if (pickedHits.length === 1) {
          const only = pickedHits[0]!;
          setPicked(only);
          const data = await fetchXodimReport({
            employeeId: only.employeeId,
            userId: only.userId,
            from: range.from,
            to: range.to,
            statuses,
          });
          setReport(data);
        } else {
          const ids = pickedHits.map((h) => h.employeeId).filter((id): id is number => id != null);
          if (ids.length !== pickedHits.length) {
            toast({ title: "Xodim", description: "Ba’zi tanlovlarda xodim yozuvi yo‘q. Ularni alohida oching." });
            return;
          }
          setPicked(null);
          const packs = await fetchStaffDays({ employeeIds: ids, from: range.from, to: range.to });
          const byId = new Map(packs.map((p) => [p.employeeId, p.days]));
          const startMs = Date.parse(`${range.from}T00:00:00Z`);
          const endMs = Date.parse(`${range.to}T00:00:00Z`);
          const dayCount = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
            ? Math.round((endMs - startMs) / 86400000) + 1
            : 0;
          setFilialReport({
            filial: {
              id: 0,
              name: "Tanlangan xodimlar",
              mudirName: null,
              mudirMissing: false,
              coordinatorName: null,
              employees: [],
            },
            from: range.from,
            to: range.to,
            dayCount,
            employees: pickedHits.map((h) => ({
              employeeId: h.employeeId!,
              fullName: h.fullName,
              roleLabel: h.roleLabel,
              phone: h.phone,
              shiftDisplay: h.branch || "—",
              presentDays: 0,
              onTimeDays: 0,
              lateDays: 0,
              absentDays: 0,
              presentRate: 0,
              days: byId.get(h.employeeId!) ?? [],
            })),
          });
        }
      } catch (err) {
        toast({ title: "Hisobot ochilmadi", description: (err as Error).message });
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!branch) return;
    const chosen = branch.employees.filter((e) => selectedIds.includes(e.employeeId));
    if (!chosen.length) return;
    setLoading(true);
    setSeal(null);
    setWantSeal(false);
    setReport(null);
    setFilialReport(null);
    try {
      if (chosen.length === 1) {
        const only = chosen[0]!;
        setPicked(hitFromEmployee(only));
        const data = await fetchXodimReport({
          employeeId: only.employeeId,
          userId: only.userId,
          from: range.from,
          to: range.to,
          statuses,
        });
        setReport(data);
      } else {
        setPicked(null);
        const data = await fetchFilialReport({
          branchId: branch.id,
          employeeIds: chosen.map((e) => e.employeeId),
          from: range.from,
          to: range.to,
        });
        setFilialReport(data);
      }
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
      const verifyUrl = active ? publicVerifyUrl(active.verifyPath) : "";
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
          verifyUrl: publicVerifyUrl(seal.verifyPath),
        }
      : null;

  const activePeriod = PERIODS.find((p) => p.id === preset) ?? PERIODS[0]!;

  return (
    <div className="space-y-5 pb-10">
      <div className="rounded-2xl bg-[#0b3a5c] px-5 py-5 text-white shadow-md">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-100">Hisobot</p>
        <h1 className="mt-1 text-2xl font-semibold">Xodimlar hisoboti</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-sky-50/90">
          Filial bo‘yicha yoki xodim bo‘yicha — bittasini tanlang. Filialda shu dorixona xodimlari chiqadi. Xodimda ism bo‘yicha qidirasiz. Ikkalasi aralashmaydi. Hisobot 01.09.2026 dan boshlanadi.
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <section>
          <h2 className="text-sm font-semibold text-slate-950"><span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-[#0b3a5c] text-xs text-white">1</span>Qanday tanlaysiz</h2>
          <p className="mt-1 text-sm text-slate-500">Bittasini yoqing. Ikkinchisi o‘chiq turadi va hisobotga aralashmaydi.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {([
              { id: "filial" as const, title: "Filial bo‘yicha", hint: "Filialni tanlang, shu dorixona xodimlari chiqadi.", Icon: Building2 },
              { id: "xodim" as const, title: "Xodim bo‘yicha", hint: "Ism, telefon yoki login yozing, odamlar chiqadi.", Icon: UserRound },
            ]).map((item) => {
              const on = pickMode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setPickMode(item.id);
                    clearResult();
                  }}
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    on
                      ? "border-[#0b3a5c] bg-gradient-to-br from-[#0b3a5c] to-[#1a6ea3] text-white shadow-lg shadow-[#0b3a5c]/25"
                      : "border-slate-200 bg-white text-slate-900 shadow-sm hover:border-[#0b3a5c]/30"
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${on ? "bg-white/15" : "bg-sky-50 text-[#0b3a5c]"}`}>
                      <item.Icon className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="flex items-center gap-2 text-base font-semibold">
                        {item.title}
                        {on ? <Check className="h-4 w-4" /> : null}
                      </span>
                      <span className={`mt-1 block text-xs leading-relaxed ${on ? "text-sky-100" : "text-slate-500"}`}>{item.hint}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {pickMode === "filial" ? (
        <section className="border-t border-slate-100 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-950"><span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-[#0b3a5c] text-xs text-white">2</span>Filial va xodimlari</h2>
            <p className="text-xs text-slate-500">{selectedIds.length} tanlangan</p>
          </div>
          <p className="mt-1 text-sm text-slate-500">Filialni tanlang. Pastda faqat shu filial xodimlari chiqadi.</p>
          {filialsLoading ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Filiallar yuklanmoqda</p>
          ) : filials.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Sizga biriktirilgan filial yo‘q.</p>
          ) : (
            <select
              value={branchId ?? ""}
              onChange={(e) => chooseBranch(Number(e.target.value))}
              className="mt-3 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-[#0b3a5c] focus:bg-white"
            >
              {filials.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.employees.length} xodim{f.mudirMissing ? " · mudir yo‘q" : ""}
                </option>
              ))}
            </select>
          )}
          {branch && branch.employees.length > 0 ? (
            <>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
                  onClick={() => {
                    const ids = branch.employees.map((e) => e.employeeId);
                    const allOn = ids.every((id) => selectedIds.includes(id));
                    setSelectedIds(allOn ? [] : ids);
                    clearResult();
                  }}
                >
                  {branch.employees.every((e) => selectedIds.includes(e.employeeId)) ? "Bekor qilish" : "Barchasini tanlash"}
                </button>
              </div>
              <ul className="mt-2 max-h-72 overflow-auto rounded-xl border border-slate-200">
                {branch.employees.map((person) => {
                  const on = selectedIds.includes(person.employeeId);
                  return (
                    <li key={person.employeeId} className="border-t border-slate-100 first:border-t-0">
                      <label className={`flex cursor-pointer items-center gap-3 px-3 py-3 ${on ? "bg-sky-50" : "bg-white"}`}>
                        <Checkbox checked={on} onCheckedChange={() => toggleEmployee(person.employeeId)} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-slate-950">{person.fullName}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">{person.roleLabel} · {person.phone || "telefon yo‘q"}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-500">{branch ? "Bu filialda hisobot uchun xodim yo‘q." : "Filialni tanlang."}</p>
          )}
        </section>
        ) : (
        <section className="border-t border-slate-100 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-950"><span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-[#0b3a5c] text-xs text-white">2</span>Xodim qidirish</h2>
            <p className="text-xs text-slate-500">{pickedHits.length} tanlangan</p>
          </div>
          <p className="mt-1 text-sm text-slate-500">Ism, telefon yoki loginni yozing. Chiqqan odamlardan keraklisini belgilang. Filial tanlovi bu yerda ishlatilmaydi.</p>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Masalan: Said, telefon, login"
              className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-sm outline-none focus:border-[#0b3a5c] focus:bg-white"
            />
            {searching ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" /> : null}
          </div>
          {q.trim().length > 0 && q.trim().length < 2 ? (
            <p className="mt-2 text-xs text-slate-500">Qidirish uchun kamida 2 ta harf yozing.</p>
          ) : null}
          {pickedHits.length > 0 ? (
            <ul className="mt-3 overflow-hidden rounded-xl border border-emerald-200">
              {pickedHits.map((h) => (
                <li key={`picked-${h.employeeId ?? "u"}-${h.userId ?? h.id}`} className="border-t border-emerald-100 bg-emerald-50 first:border-t-0">
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-3">
                    <Checkbox checked onCheckedChange={() => toggleHit(h)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-950">{h.fullName}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{h.roleLabel} · {h.branch} · {h.phone || "telefon yo‘q"}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {hits.filter((h) => !pickedHits.some((p) => sameHit(p, h))).length > 0 ? (
            <ul className="mt-2 max-h-72 overflow-auto rounded-xl border border-slate-200">
              {hits.filter((h) => !pickedHits.some((p) => sameHit(p, h))).map((h) => (
                <li key={`${h.employeeId ?? "u"}-${h.userId ?? h.id}`} className="border-t border-slate-100 first:border-t-0">
                  <label className="flex cursor-pointer items-center gap-3 bg-white px-3 py-3">
                    <Checkbox checked={false} onCheckedChange={() => toggleHit(h)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-950">{h.fullName}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{h.roleLabel} · {h.branch} · {h.phone || "telefon yo‘q"}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {!searching && q.trim().length >= 2 && hits.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Hech kim topilmadi. Ismni boshqacha yozib ko‘ring.</p>
          ) : null}
        </section>
        )}

        <section className="border-t border-slate-100 pt-4">
          <h2 className="text-sm font-semibold text-slate-950"><span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-[#0b3a5c] text-xs text-white">3</span>Davr</h2>
          <p className="mt-1 text-sm text-slate-500">Bitta davr yetarli. Sana maydoni faqat «Sana tanlash»da ochiladi.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {PERIODS.map((item) => {
              const on = preset === item.id;
              const Icon = item.id === "full" ? CalendarRange : CalendarDays;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyPreset(item.id)}
                  className={`group relative overflow-hidden rounded-2xl border px-4 py-4 text-left transition ${
                    on
                      ? "border-[#0b3a5c] bg-gradient-to-br from-[#0b3a5c] to-[#1a6ea3] text-white shadow-lg shadow-[#0b3a5c]/25"
                      : "border-slate-200 bg-white text-slate-900 shadow-sm hover:-translate-y-0.5 hover:border-[#0b3a5c]/30 hover:shadow-md"
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <span
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${
                        on ? "bg-white/15 text-white" : "bg-sky-50 text-[#0b3a5c]"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-base font-semibold">{item.title}</span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            on ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {on ? <Check className="h-3 w-3" /> : null}
                          {on ? "Tanlangan" : "Tanlash"}
                        </span>
                      </span>
                      <span className={`mt-1 block text-xs leading-relaxed ${on ? "text-sky-100" : "text-slate-500"}`}>
                        {item.hint}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {preset === "custom" ? (
            <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Dan</span>
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
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-[#0b3a5c]"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Gacha</span>
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
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-[#0b3a5c]"
                />
              </label>
            </div>
          ) : null}
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-sky-100 bg-sky-50 px-3 py-2.5 text-sm text-[#0b3a5c]">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">{activePeriod.title}</span>
              <span className="text-[#0b3a5c]/70"> · {showDate(from)} — {showDate(to)}</span>
            </span>
          </div>
        </section>

        <section className="border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-sm font-semibold text-slate-950"><span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-[#0b3a5c] text-xs text-white">4</span>Holatlar</h2>
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
          {pickMode === "filial"
            ? selectedIds.length > 0
              ? `«Hisobot olish» ${branch?.name || "filial"} bo‘yicha ${selectedIds.length} xodimni ochadi.`
              : "Avval filial xodimlarini belgilang."
            : pickedHits.length > 0
              ? `«Hisobot olish» tanlangan ${pickedHits.length} xodim bo‘yicha ochiladi.`
              : "Avval xodimni qidirib belgilang."}
        </div>
        <Button type="button" className="h-12 w-full rounded-xl text-base sm:w-auto sm:px-8" disabled={(pickMode === "filial" ? selectedIds.length === 0 : pickedHits.length === 0) || loading} onClick={() => void openReport()}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
          Hisobot olish
        </Button>
      </div>

      {filialReport ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filial hisoboti</p>
                <h2 className="text-lg font-semibold text-slate-950">{filialReport.filial.name}</h2>
                <p className="text-sm text-slate-500">{showDate(filialReport.from)} — {showDate(filialReport.to)} · {filialReport.employees.length} xodim · {filialReport.dayCount} kun</p>
              </div>
              <Button
                type="button"
                className="h-10 rounded-xl"
                disabled={pdfing}
                onClick={() => {
                  if (!filialRoot.current) return;
                  setPdfing(true);
                  const safe = filialReport.filial.name.replace(/[^\w\u0400-\u04FF]+/g, "_").slice(0, 40);
                  void downloadPagesPdf(filialRoot.current, `Filial_hisoboti_${safe}_${filialReport.to.replace(/-/g, "")}.pdf`)
                    .catch((err) => toast({ title: "PDF olinmadi", description: (err as Error).message }))
                    .finally(() => setPdfing(false));
                }}
              >
                {pdfing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                PDF yuklash
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Xodim</th>
                    <th className="px-3 py-2 font-semibold">{filialReport.filial.id === 0 ? "Filial" : "Smena"}</th>
                    {XODIM_STATUS_OPTIONS.filter((s) => statuses.includes(s.id)).map((s) => (
                      <th key={s.id} className="px-3 py-2 font-semibold">
                        <span className={`inline-flex rounded-full px-2 py-0.5 normal-case tracking-normal ${statusCountClass(s.id)}`}>{s.label}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filialReport.employees.map((row) => (
                    <tr key={row.employeeId} className={focusEmpId === row.employeeId ? "bg-sky-50" : ""}>
                      <td className="border-t border-slate-100 px-3 py-2">
                        <button
                          type="button"
                          className="text-left"
                          onClick={() => {
                            setFocusEmpId(row.employeeId);
                            document.getElementById(`filial-emp-${row.employeeId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                        >
                          <span className="block font-medium text-slate-950">{row.fullName}</span>
                          <span className="text-xs text-slate-500">{row.roleLabel}</span>
                        </button>
                      </td>
                      <td className="border-t border-slate-100 px-3 py-2 text-slate-600">{row.shiftDisplay}</td>
                      {XODIM_STATUS_OPTIONS.filter((s) => statuses.includes(s.id)).map((s) => (
                        <td key={s.id} className="border-t border-slate-100 px-3 py-2">
                          <button
                            type="button"
                            className={`inline-flex min-w-7 justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusCountClass(s.id)}`}
                            onClick={() => {
                              setFocusEmpId(row.employeeId);
                              document.getElementById(`filial-emp-${row.employeeId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }}
                          >
                            {filialStatusCount(row, s.id)}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-xs text-slate-500">Son yoki ismni bosing — pastda shu xodimning tanlangan holatlari sana-sana ochiladi. PDF ham shu ro‘yxatni oladi.</p>
          </div>
          <FilialHisobotDocument report={filialReport} statuses={statuses} rootRef={filialRoot} focusId={focusEmpId} />
        </div>
      ) : null}

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
                Belgilansa, hisobot yopiladi: sana, soat va «Tasdiqlaydi platforma masʼuli Saidmuhammadalixon» yozuvi hamda QR chiqadi. QR ochilganda hujjatda yashil «TASDIQLANGAN» pechati turadi.
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
