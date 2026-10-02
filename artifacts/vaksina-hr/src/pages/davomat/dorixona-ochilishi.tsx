import React, { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Loader2, Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { hasFullPlatformAccess, isSbRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { downloadDorixonaExcel, downloadDorixonaPdf, type OpenRowExport } from "@/lib/dorixona-ochilish-export";

type DayCell = {
  date: string;
  systemOpen: string | null;
  systemClose: string | null;
  openNow: boolean;
  sbOpen: string | null;
  sbClose: string | null;
  note: string | null;
  filledBy: string | null;
};

type BranchRow = {
  id: number;
  name: string;
  salesPhone: string;
  coordinatorId: number | null;
  coordinatorName: string;
  days: DayCell[];
};

type Grain = "kun" | "hafta" | "oy";

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
}

function addDays(ymd: string, n: number) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

function mondayOf(ymd: string) {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return addDays(ymd, day === 0 ? -6 : 1 - day);
}

function shiftMonth(ymd: string, delta: number) {
  const [y, m] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m! - 1) + delta, 1));
  return date.toISOString().slice(0, 10);
}

function monthEnd(ymd: string) {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${ymd.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

function bounds(grain: Grain, anchor: string) {
  if (grain === "kun") return { from: anchor, to: anchor };
  if (grain === "hafta") {
    const from = mondayOf(anchor);
    return { from, to: addDays(from, 6) };
  }
  const from = `${anchor.slice(0, 8)}01`;
  return { from, to: monthEnd(anchor) };
}

function minutesBetween(open: string | null, close: string | null) {
  if (!open || !close) return null;
  const [oh, om] = open.split(":").map(Number);
  const [ch, cm] = close.split(":").map(Number);
  let diff = ch! * 60 + cm! - (oh! * 60 + om!);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function formatDur(mins: number | null) {
  if (mins == null) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} daq`;
  return m ? `${h} soat ${m} daq` : `${h} soat`;
}

type OpenStatus = "ochiq" | "ochilmagan" | "yopilgan";

function dayStatus(day: DayCell): OpenStatus {
  if (day.openNow) return "ochiq";
  if (day.systemOpen) return "yopilgan";
  return "ochilmagan";
}

function periodStatus(days: DayCell[]): OpenStatus {
  if (days.some((day) => day.openNow)) return "ochiq";
  if (days.some((day) => day.systemOpen)) return "yopilgan";
  return "ochilmagan";
}

function statusLabel(day: DayCell) {
  const status = dayStatus(day);
  if (status === "ochiq") return "Ochiq";
  if (status === "yopilgan") return "Yopilgan";
  return "Ochilmagan";
}

function dash(value: string | null | undefined) {
  return value?.trim() ? value : "—";
}

function weekday(ymd: string) {
  return ["Ya", "Du", "Se", "Cho", "Pa", "Ju", "Sha"][new Date(`${ymd}T00:00:00Z`).getUTCDay()];
}

function foldScript(input: string): string {
  const cyr: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
    ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", ғ: "g", қ: "q", ҳ: "h",
  };
  let s = input.toLowerCase().replace(/[\u2018\u2019\u02BB\u02BC']/g, "");
  s = s.replace(/g'/g, "g").replace(/o'/g, "o");
  let out = "";
  for (const ch of s) out += cyr[ch] ?? ch;
  return out.replace(/[^a-z0-9]+/g, "");
}

export default function DorixonaOchilishiPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = hasFullPlatformAccess(user?.role) || isSbRole(user?.role);
  const [grain, setGrain] = useState<Grain>("kun");
  const [anchor, setAnchor] = useState(todayYmd);
  const [rows, setRows] = useState<BranchRow[]>([]);
  const [coords, setCoords] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filial, setFilial] = useState("all");
  const [coord, setCoord] = useState("all");
  const [status, setStatus] = useState<"all" | OpenStatus>("all");
  const [edit, setEdit] = useState<{ row: BranchRow; day: DayCell } | null>(null);
  const [sbOpen, setSbOpen] = useState("");
  const [sbClose, setSbClose] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  const { from, to } = bounds(grain, anchor);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/davomat/dorixona-ochilishi?from=${from}&to=${to}`, { credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Yuklanmadi");
      setRows(body.items || []);
      setCoords(body.coordinators || []);
    } catch (err) {
      toast({ title: "Yuklanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) void load();
    else setLoading(false);
  }, [allowed, from, to]);

  const matched = useMemo(() => {
    const words = q.trim().split(/\s+/).map(foldScript).filter(Boolean);
    return rows.filter((row) => {
      if (filial !== "all" && String(row.id) !== filial) return false;
      if (coord !== "all" && String(row.coordinatorId || "") !== coord) return false;
      if (!words.length) return true;
      const hay = foldScript(`${row.name} ${row.coordinatorName} ${row.salesPhone || ""}`);
      return words.every((word) => hay.includes(word));
    });
  }, [rows, q, filial, coord]);

  const statusCounts = useMemo(() => {
    const counts = { all: matched.length, ochiq: 0, ochilmagan: 0, yopilgan: 0 };
    for (const row of matched) counts[periodStatus(row.days)] += 1;
    return counts;
  }, [matched]);

  const filtered = useMemo(
    () => (status === "all" ? matched : matched.filter((row) => periodStatus(row.days) === status)),
    [matched, status],
  );

  const openEdit = (row: BranchRow, day: DayCell) => {
    setEdit({ row, day });
    setSbOpen(day.sbOpen || "");
    setSbClose(day.sbClose || "");
    setNote(day.note || "");
  };

  const save = async () => {
    if (!edit) return;
    if ((sbOpen || sbClose) && note.trim().length < 3) {
      toast({ title: "Izoh kerak", description: "Vaqt yozilganda nima uchunligini yozing.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/davomat/dorixona-ochilishi", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: edit.row.id,
          day: edit.day.date,
          sbOpen: sbOpen || null,
          sbClose: sbClose || null,
          note: note.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Saqlanmadi");
      toast({ title: "Saqlandi", description: `${edit.row.name} · ${edit.day.date}` });
      setEdit(null);
      await load();
    } catch (err) {
      toast({ title: "Saqlanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const exportRows = useMemo<OpenRowExport[]>(() => filtered.map((row, index) => ({
    n: index + 1,
    name: row.name,
    phone: row.salesPhone || "raqam yo‘q",
    coordinator: row.coordinatorName,
    days: row.days.map((day) => ({
      date: day.date,
      weekday: weekday(day.date) || "",
      systemOpen: dash(day.systemOpen),
      systemClose: day.openNow ? "hali ochiq" : dash(day.systemClose),
      systemDur: formatDur(minutesBetween(day.systemOpen, day.systemClose)),
      sbOpen: dash(day.sbOpen),
      sbClose: dash(day.sbClose),
      sbDur: formatDur(minutesBetween(day.sbOpen, day.sbClose)),
      note: dash(day.note),
      filledBy: dash(day.filledBy),
      status: statusLabel(day),
    })),
  })), [filtered]);

  const exportNow = async (kind: "excel" | "pdf") => {
    if (!exportRows.length) {
      toast({ title: "Jadval bo‘sh", description: "Yuklash uchun dorixona qolishi kerak." });
      return;
    }
    const filialName = filial === "all" ? "barcha filiallar" : rows.find((row) => String(row.id) === filial)?.name || "filial";
    const coordName = coord === "all" ? "barcha koordinatorlar" : coords.find((item) => String(item.id) === coord)?.name || "koordinator";
    const payload = {
      grain,
      title: "Dorixona ochilishi",
      period: from === to ? from : `${from} — ${to}`,
      filterLine: `${grain === "kun" ? "Kun" : grain === "hafta" ? "Hafta" : "Oy"} · ${status === "ochiq" ? "Ochiq" : status === "ochilmagan" ? "Ochilmagan" : status === "yopilgan" ? "Yopilgan" : "Barcha holat"} · ${filialName} · ${coordName}${q.trim() ? ` · qidiruv: ${q.trim()}` : ""}`,
      rows: exportRows,
    };
    setExporting(kind);
    try {
      if (kind === "excel") await downloadDorixonaExcel(payload);
      else await downloadDorixonaPdf(payload);
      toast({ title: kind === "excel" ? "Excel tayyor" : "PDF tayyor" });
    } catch (err) {
      toast({ title: "Yuklanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm font-medium text-rose-700">Dorixona ochilishi faqat admin va SB uchun.</p>
        <Link href="/davomat" className="mt-3 inline-block text-sm font-semibold text-[#0b3a5c] underline">Davomatga qaytish</Link>
      </div>
    );
  }

  const step = grain === "kun" ? 1 : grain === "hafta" ? 7 : 0;

  const periodLabel = from === to ? from : `${from} — ${to}`;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Davomat</p>
          <h1 className="text-2xl font-semibold tracking-tight text-[#0f2744]">Dorixona ochilishi</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
            Birinchi xodim «Keldim» qilgan vaqt — ochildi. Oxirgi xodim ketganda — yopildi. SB yozgan vaqt alohida fakt, izoh bilan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-2xl bg-slate-100 p-1">
            {(["kun", "hafta", "oy"] as Grain[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setGrain(key)}
                className={cn(
                  "h-10 rounded-xl px-4 text-sm font-semibold transition",
                  grain === key ? "bg-[#0b3a5c] text-white shadow-sm" : "text-slate-600 hover:bg-white",
                )}
              >
                {key === "kun" ? "Kun" : key === "hafta" ? "Hafta" : "Oy"}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={exporting != null || loading}
            onClick={() => void exportNow("excel")}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-3.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {exporting === "excel" ? "Excel…" : "Excel"}
          </button>
          <button
            type="button"
            disabled={exporting != null || loading}
            onClick={() => void exportNow("pdf")}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-3.5 text-sm font-semibold text-[#0b3a5c] ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            <FileDown className="h-4 w-4" />
            {exporting === "pdf" ? "PDF…" : "PDF"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            aria-label="Oldingi"
            onClick={() => setAnchor((cur) => grain === "oy" ? shiftMonth(cur, -1) : addDays(cur, -step))}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="min-w-[11rem] text-center text-sm font-semibold tabular-nums text-[#0f2744]">{periodLabel}</span>
          <button
            type="button"
            aria-label="Keyingi"
            onClick={() => setAnchor((cur) => grain === "oy" ? shiftMonth(cur, 1) : addDays(cur, step))}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(todayYmd())}
            className="ml-1 h-10 rounded-xl bg-[#0b3a5c] px-4 text-sm font-semibold text-white hover:bg-[#082c46]"
          >
            Bugun
          </button>
        </div>
        <p className="px-2 text-sm font-medium text-slate-500">{filtered.length} ta dorixona</p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Dorixona yoki koordinator nomi" className="h-10 pl-9" />
          </div>
          <select value={filial} onChange={(event) => setFilial(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
            <option value="all">Barcha filiallar</option>
            {rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <select value={coord} onChange={(event) => setCoord(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
            <option value="all">Barcha koordinatorlar</option>
            {coords.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            ["all", "Hammasi", statusCounts.all, "bg-[#0b3a5c] text-white"],
            ["ochiq", "Ochiq", statusCounts.ochiq, "bg-emerald-600 text-white"],
            ["ochilmagan", "Ochilmagan", statusCounts.ochilmagan, "bg-amber-500 text-white"],
            ["yopilgan", "Yopilgan", statusCounts.yopilgan, "bg-slate-700 text-white"],
          ] as const).map(([key, label, count, onClass]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatus(key)}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold ring-1 transition",
                status === key ? onClass : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-white",
                status === key ? "ring-transparent" : "",
              )}
            >
              {label}
              <span className={cn("rounded-md px-1.5 py-0.5 text-xs tabular-nums", status === key ? "bg-white/20" : "bg-white text-slate-500 ring-1 ring-slate-200")}>{count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="flex items-center gap-2 px-4 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-10 text-sm text-slate-500">Dorixona topilmadi.</p>
        ) : grain === "kun" ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] table-fixed border-collapse text-left text-[13px]">
              <colgroup>
                <col className="w-[44px]" />
                <col className="w-[18%]" />
                <col className="w-[13%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col />
                <col className="w-[168px]" />
              </colgroup>
              <thead className="bg-[#0b3a5c] text-[11px] font-semibold uppercase tracking-wide text-white">
                <tr className="h-11">
                  {["№", "Dorixona", "Koordinator", "Tizim ochildi", "Tizim yopildi", "Tizim vaqt", "SB ochildi", "SB yopildi", "SB vaqt", "Izoh", "Holat"].map((head) => (
                    <th key={head} className="h-11 whitespace-nowrap border-r border-white/10 px-3 text-left align-middle last:border-r-0">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, index) => {
                  const day = row.days[0];
                  if (!day) return null;
                  return (
                    <tr key={row.id} className="h-14 cursor-pointer border-t border-slate-100 odd:bg-white even:bg-slate-50/70 hover:bg-sky-50/60" onClick={() => openEdit(row, day)}>
                      <td className="px-3 align-middle text-slate-400">{index + 1}</td>
                      <td className="px-3 align-middle">
                        <p className="truncate font-semibold text-[#0f2744]">{row.name}</p>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] tabular-nums text-slate-500">
                          <Phone className="h-3 w-3 shrink-0" />{row.salesPhone || "raqam yo‘q"}
                        </p>
                      </td>
                      <td className="truncate px-3 align-middle text-[12px] text-slate-600">{row.coordinatorName}</td>
                      <td className="px-3 text-center align-middle tabular-nums">{dash(day.systemOpen)}</td>
                      <td className="px-3 text-center align-middle tabular-nums">{day.openNow ? "hali ochiq" : dash(day.systemClose)}</td>
                      <td className="px-3 text-center align-middle text-[12px]">{formatDur(minutesBetween(day.systemOpen, day.systemClose))}</td>
                      <td className="px-3 text-center align-middle font-semibold tabular-nums text-[#0b3a5c]">{dash(day.sbOpen)}</td>
                      <td className="px-3 text-center align-middle font-semibold tabular-nums text-[#0b3a5c]">{dash(day.sbClose)}</td>
                      <td className="px-3 text-center align-middle text-[12px]">{formatDur(minutesBetween(day.sbOpen, day.sbClose))}</td>
                      <td className="truncate px-3 align-middle text-[12px] text-slate-600">{dash(day.note)}</td>
                      <td className="px-3 align-middle"><Status day={day} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-max min-w-full border-separate border-spacing-0 text-left text-[12px]">
              <thead className="sticky top-0 z-10 bg-[#0b3a5c] text-white">
                <tr>
                  <th className="sticky left-0 z-20 h-12 w-[240px] min-w-[240px] border-r border-white/10 bg-[#0b3a5c] px-3 text-left align-middle">Dorixona</th>
                  {(filtered[0]?.days || []).map((day) => (
                    <th key={day.date} className="h-12 min-w-[148px] border-r border-white/10 px-2 text-center align-middle last:border-r-0">
                      <span className="block text-sm font-bold leading-none">{Number(day.date.slice(8, 10))}</span>
                      <span className="mt-1 block text-[10px] uppercase tracking-wide text-white/70">{weekday(day.date)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td className="sticky left-0 z-10 h-16 border-r border-t border-slate-100 bg-white px-3 align-middle">
                      <p className="truncate font-semibold text-[#0f2744]">{row.name}</p>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] tabular-nums text-slate-500">
                        <Phone className="h-3 w-3 shrink-0" />{row.salesPhone || "raqam yo‘q"}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">{row.coordinatorName}</p>
                    </td>
                    {row.days.map((day) => (
                      <td key={day.date} className="border-t border-slate-100 px-1 py-1">
                        <button type="button" onClick={() => openEdit(row, day)} className="w-full rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-left hover:border-[#0b3a5c]">
                          <Status day={day} compact />
                          <p className="mt-1.5 text-[10px] text-slate-400">Tizim</p>
                          <p className="tabular-nums">{day.systemOpen || "—"}{day.systemClose ? `–${day.systemClose}` : day.openNow ? " · ochiq" : ""}</p>
                          <p className="mt-1 text-[10px] text-slate-400">SB fakt</p>
                          <p className="font-semibold tabular-nums text-[#0b3a5c]">{day.sbOpen || "—"}{day.sbClose ? `–${day.sbClose}` : ""}</p>
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={edit != null} onOpenChange={(open) => { if (!open && !saving) setEdit(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{edit?.row.name}</DialogTitle>
            <DialogDescription>{edit?.day.date} · {edit?.row.coordinatorName} · {edit?.row.salesPhone || "raqam yo‘q"}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] uppercase text-slate-400">Tizim — asli</p>
              <p className="mt-1">Ochildi: <b>{edit?.day.systemOpen || "—"}</b></p>
              <p>Yopildi: <b>{edit?.day.openNow ? "hali ochiq" : edit?.day.systemClose || "—"}</b></p>
              <p className="text-xs text-slate-500">{formatDur(minutesBetween(edit?.day.systemOpen || null, edit?.day.systemClose || null))}</p>
            </div>
            <div className="rounded-xl bg-sky-50 p-3">
              <p className="text-[11px] uppercase text-sky-700">SB — fakt</p>
              <label className="mt-1 block text-xs">Ochildi<input type="time" value={sbOpen} onChange={(event) => setSbOpen(event.target.value)} className="mt-1 h-9 w-full rounded-lg border px-2" /></label>
              <label className="mt-2 block text-xs">Yopildi<input type="time" value={sbClose} onChange={(event) => setSbClose(event.target.value)} className="mt-1 h-9 w-full rounded-lg border px-2" /></label>
            </div>
          </div>
          <label className="block text-sm">
            Izoh
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Nima uchun shu vaqt? Vaqt yozsangiz izoh majburiy." className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" />
          </label>
          {edit?.day.filledBy ? <p className="text-xs text-slate-500">Oxirgi yozuv: {edit.day.filledBy}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setEdit(null)}>Bekor</Button>
            <Button type="button" disabled={saving} onClick={() => void save()}>{saving ? "Saqlanmoqda…" : "Tasdiqlash"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Status({ day, compact = false }: { day: DayCell; compact?: boolean }) {
  const kind = dayStatus(day);
  const fact = Boolean(day.sbOpen || day.sbClose);
  const tone =
    kind === "ochiq"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : kind === "yopilgan"
        ? "bg-slate-100 text-slate-700 ring-slate-200"
        : "bg-amber-50 text-amber-800 ring-amber-200";
  const dot = kind === "ochiq" ? "bg-emerald-500" : kind === "yopilgan" ? "bg-slate-400" : "bg-amber-500";
  return (
    <span className={cn("inline-flex items-center gap-1.5", compact && "flex-wrap")}>
      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1", tone)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", dot, kind === "ochiq" && "animate-pulse")} />
        {statusLabel(day)}
      </span>
      {fact && !compact ? (
        <span className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">SB fakt</span>
      ) : null}
    </span>
  );
}
