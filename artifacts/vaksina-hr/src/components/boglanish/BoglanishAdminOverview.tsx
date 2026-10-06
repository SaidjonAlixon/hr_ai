import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AtSign, CheckCircle2, Clock3, FileDown, Loader2, Phone, RefreshCw, Search, Store, Users, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useToast } from "../../hooks/use-toast";
import { userRoleLabel } from "../../lib/roles";
import { cn } from "../../lib/utils";
import { fetchBoglanishOverview, type BoglanishOverviewBranch } from "../../lib/boglanish-api";
import { exportBoglanishPdf, fmtBoglanishWhen, formatUzPhone } from "../../lib/boglanish-pdf";

type Tab = "missing" | "filled" | "all";
const NO_COORD = -1;

function foldText(s: string) {
  return s.toLowerCase().replace(/[‘’ʻʼ'`]/g, "");
}

export default function BoglanishAdminOverview() {
  const { toast } = useToast();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["boglanish", "overview"],
    queryFn: fetchBoglanishOverview,
    staleTime: 30_000,
  });
  const [tab, setTab] = useState<Tab>("missing");
  const [search, setSearch] = useState("");
  const [coordId, setCoordId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const branches = data?.branches ?? [];

  const coordinators = useMemo(() => {
    const map = new Map<number, { id: number; name: string; total: number; filled: number }>();
    for (const b of branches) {
      const id = b.coordinatorId ?? NO_COORD;
      const cur = map.get(id) ?? { id, name: b.coordinatorName || "Koordinator biriktirilmagan", total: 0, filled: 0 };
      cur.total += 1;
      if (b.complete) cur.filled += 1;
      map.set(id, cur);
    }
    return [...map.values()].sort((a, b) => {
      if (a.id === NO_COORD) return 1;
      if (b.id === NO_COORD) return -1;
      return a.filled / a.total - b.filled / b.total || a.name.localeCompare(b.name, "uz");
    });
  }, [branches]);

  const scoped = useMemo(() => {
    const q = foldText(search.trim());
    return branches.filter((b) => {
      if (coordId != null && (b.coordinatorId ?? NO_COORD) !== coordId) return false;
      if (!q) return true;
      return foldText(
        [b.branchName, b.mudirName, b.coordinatorName, b.primaryPhone, b.mudirPhone, b.updatedByName, b.telegramNick].join(" "),
      ).includes(q);
    });
  }, [branches, coordId, search]);

  const counts = useMemo(
    () => ({
      missing: scoped.filter((b) => !b.complete).length,
      filled: scoped.filter((b) => b.complete).length,
      all: scoped.length,
    }),
    [scoped],
  );

  const rows = useMemo(() => {
    const list = tab === "missing" ? scoped.filter((b) => !b.complete) : tab === "filled" ? scoped.filter((b) => b.complete) : scoped;
    if (tab !== "all") return list;
    return [...list].sort((a, b) => Number(a.complete) - Number(b.complete) || a.branchName.localeCompare(b.branchName, "uz"));
  }, [scoped, tab]);

  const total = data?.total ?? 0;
  const filled = data?.filled ?? 0;
  const pct = total ? Math.round((filled / total) * 100) : 0;
  const coordName = coordId == null ? null : coordinators.find((c) => c.id === coordId)?.name;

  const filterLabel = [
    tab === "missing" ? "To‘ldirmagan filiallar" : tab === "filled" ? "To‘ldirgan filiallar" : "Barcha filiallar",
    coordName ? `Koordinator: ${coordName}` : null,
    search.trim() ? `qidiruv: ${search.trim()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const downloadPdf = async () => {
    setExporting(true);
    try {
      await exportBoglanishPdf(rows, { filterLabel, total, filled });
    } catch (err) {
      toast({ title: "PDF tayyorlanmadi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Yuklanmoqda…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center text-sm text-destructive">
        {(error as Error)?.message || "Ma’lumot yuklanmadi"}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 pb-24 sm:p-5 sm:pb-8">
      <div className="relative overflow-hidden rounded-2xl border border-[#0a2540]/15 bg-gradient-to-br from-[#0a2540] via-[#0b3a6e] to-[#0b5fff] p-5 text-white shadow-sm sm:p-6">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/90 ring-1 ring-white/15">
              <Phone className="h-3.5 w-3.5" /> Filiallar nazorati · faqat admin
            </div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Bog‘lanish</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-white/80">
              Qaysi filial raqamini kiritgan, qaysi biri hali kiritmagan — mudiri, koordinatori va kim qachon kiritgani bilan.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              className="h-10 border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            </Button>
            <Button className="h-10 gap-2 bg-white text-[#0b3a6e] hover:bg-white/90" disabled={exporting} onClick={() => void downloadPdf()}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              PDF yuklab olish
            </Button>
          </div>
        </div>
        <div className="relative z-10 mt-5">
          <div className="flex items-center justify-between text-xs text-white/80">
            <span>
              {filled} / {total} filial to‘ldirgan
            </span>
            <span className="font-semibold text-white">{pct}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat icon={Store} label="Jami filial" value={total} tone="slate" onClick={() => setTab("all")} active={tab === "all"} />
        <Stat icon={CheckCircle2} label="To‘ldirgan" value={filled} tone="emerald" onClick={() => setTab("filled")} active={tab === "filled"} />
        <Stat icon={AlertCircle} label="To‘ldirmagan" value={total - filled} tone="rose" onClick={() => setTab("missing")} active={tab === "missing"} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#0f2744]">
            <Users className="h-4 w-4 text-slate-400" /> Koordinatorlar kesimida
          </p>
          {coordId != null ? (
            <button type="button" onClick={() => setCoordId(null)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
              <X className="h-3.5 w-3.5" /> Hammasini ko‘rsatish
            </button>
          ) : (
            <span className="text-xs text-slate-400">Bosing — faqat o‘sha koordinator filiallari</span>
          )}
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {coordinators.map((c) => {
            const p = c.total ? Math.round((c.filled / c.total) * 100) : 0;
            const active = coordId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCoordId(active ? null : c.id)}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition hover:border-slate-300",
                  active ? "border-[#0b3a5c] bg-[#0b3a5c]/5 ring-1 ring-[#0b3a5c]" : "border-slate-200",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm font-semibold", c.id === NO_COORD ? "text-slate-500" : "text-[#0f2744]")}>{c.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">
                    {c.filled}/{c.total}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn("h-full rounded-full", p === 100 ? "bg-emerald-500" : p >= 50 ? "bg-amber-400" : "bg-rose-500")}
                    style={{ width: `${p}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {c.total - c.filled ? `${c.total - c.filled} ta filial kiritmagan` : "Hammasi kiritgan"}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {(
              [
                ["missing", "To‘ldirmagan", counts.missing],
                ["filled", "To‘ldirgan", counts.filled],
                ["all", "Hammasi", counts.all],
              ] as const
            ).map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
                  tab === key
                    ? key === "missing"
                      ? "bg-rose-600 text-white"
                      : key === "filled"
                        ? "bg-emerald-600 text-white"
                        : "bg-[#0b3a5c] text-white"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {label}
                <span className={cn("min-w-[20px] rounded-full px-1.5 text-[11px] tabular-nums", tab === key ? "bg-white/20" : "bg-slate-100 text-slate-500")}>
                  {n}
                </span>
              </button>
            ))}
          </div>
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filial, mudir, koordinator, raqam…" className="h-9 pl-9" />
          </div>
        </div>

        {coordName ? (
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            Koordinator: <span className="font-semibold text-slate-800">{coordName}</span>
          </div>
        ) : null}

        {!rows.length ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            {tab === "missing" ? <CheckCircle2 className="h-9 w-9 text-emerald-400" /> : <Store className="h-9 w-9 text-slate-300" />}
            <p className="text-sm font-medium text-slate-600">
              {tab === "missing" && !search.trim() ? "Barcha filiallar raqamini kiritgan" : "Bu filtr bo‘yicha filial yo‘q"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2.5">№</th>
                  <th className="px-3 py-2.5">Filial</th>
                  <th className="px-3 py-2.5">Mudir</th>
                  <th className="px-3 py-2.5">Koordinator</th>
                  <th className="px-3 py-2.5">Filial raqami</th>
                  <th className="px-3 py-2.5">Qo‘shimcha</th>
                  <th className="px-3 py-2.5">Kim kiritgan</th>
                  <th className="px-3 py-2.5">Holat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b, i) => (
                  <Row key={b.branchEmployeeId} b={b} n={i + 1} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ b, n }: { b: BoglanishOverviewBranch; n: number }) {
  const hasHours = b.contactFromHm && b.contactToHm;
  return (
    <tr className={cn("border-t border-slate-100 align-top", !b.complete && "bg-rose-50/40")}>
      <td className={cn("px-3 py-2.5 text-xs font-semibold tabular-nums text-slate-400", !b.complete && "border-l-2 border-l-rose-500")}>{n}</td>
      <td className="px-3 py-2.5">
        <p className="font-semibold text-[#0f2744]">{b.branchName}</p>
      </td>
      <td className="px-3 py-2.5">
        {b.vacant ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Mudir yo‘q (vakant)</span>
        ) : (
          <>
            <p className="text-slate-800">{b.mudirName || "—"}</p>
            {b.mudirPhone ? <p className="text-[11px] tabular-nums text-slate-500">{formatUzPhone(b.mudirPhone)}</p> : null}
          </>
        )}
      </td>
      <td className="px-3 py-2.5">
        {b.coordinatorName ? (
          <>
            <p className="text-slate-800">{b.coordinatorName}</p>
            {b.coordinatorPhone ? <p className="text-[11px] tabular-nums text-slate-500">{formatUzPhone(b.coordinatorPhone)}</p> : null}
          </>
        ) : (
          <span className="text-xs text-slate-400">Biriktirilmagan</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {b.complete ? (
          <a href={`tel:${b.primaryPhone}`} className="font-semibold tabular-nums text-[#0f2744] hover:underline">
            {formatUzPhone(b.primaryPhone)}
          </a>
        ) : (
          <span className="text-xs font-semibold text-rose-600">Kiritilmagan</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-600">
        {b.extraPhones.length || b.telegramNick || hasHours ? (
          <div className="space-y-0.5">
            {b.extraPhones.map((p) => (
              <p key={p} className="tabular-nums">{formatUzPhone(p)}</p>
            ))}
            {b.telegramNick ? (
              <p className="inline-flex items-center gap-1 text-sky-700">
                <AtSign className="h-3 w-3" />
                {b.telegramNick.replace(/^@/, "")}
              </p>
            ) : null}
            {hasHours ? (
              <p className="inline-flex items-center gap-1 text-slate-500">
                <Clock3 className="h-3 w-3" />
                {b.contactFromHm}–{b.contactToHm}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs">
        {b.updatedByName ? (
          <>
            <p className="font-medium text-slate-800">{b.updatedByName}</p>
            <p className="text-[11px] text-slate-500">
              {b.updatedByRole ? `${userRoleLabel(b.updatedByRole)} · ` : ""}
              {fmtBoglanishWhen(b.updatedAt)}
            </p>
          </>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {b.complete ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <CheckCircle2 className="h-3 w-3" /> To‘ldirgan
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
            <AlertCircle className="h-3 w-3" /> To‘ldirmagan
          </span>
        )}
      </td>
    </tr>
  );
}

const TONES = {
  slate: { icon: "bg-slate-100 text-slate-700", ring: "ring-[#0b3a5c]" },
  emerald: { icon: "bg-emerald-100 text-emerald-700", ring: "ring-emerald-400" },
  rose: { icon: "bg-rose-100 text-rose-700", ring: "ring-rose-400" },
} as const;

function Stat({
  icon: Icon,
  label,
  value,
  tone,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  tone: keyof typeof TONES;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:border-slate-300",
        active && cn("ring-2", TONES[tone].ring),
      )}
    >
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", TONES[tone].icon)}>
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-2xl font-bold leading-none tabular-nums text-[#0f2744]">{value}</span>
        <span className="mt-1 block text-xs font-medium text-slate-500">{label}</span>
      </span>
    </button>
  );
}
