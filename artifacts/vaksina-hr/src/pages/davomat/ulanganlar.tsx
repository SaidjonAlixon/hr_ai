import React, { useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Download,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  Send,
  Store,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { canViewUlanganlar } from "@/lib/roles";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import {
  downloadUlanganlarExcel,
  useUlanganlar,
  type UlanganCategory,
  type UlanganItem,
} from "@/lib/ulanganlar-api";

type LinkTab = "linked" | "unlinked";
type CatFilter = UlanganCategory | "all";

const CATEGORY_META: Record<UlanganCategory, { label: string; icon: typeof Building2; tone: string }> = {
  ofis: { label: "Ofis", icon: Building2, tone: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  dorixona: { label: "Dorixona", icon: Store, tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  boshqa: { label: "Boshqa", icon: Users, tone: "bg-slate-100 text-slate-700 border-slate-200" },
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("uz-UZ", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function placeOf(i: UlanganItem): string {
  if (i.category === "dorixona") return displayBranchName(i.branch).trim() || i.department || "—";
  return i.department || displayBranchName(i.branch).trim() || "—";
}

function pct(part: number, total: number): number {
  return total ? Math.round((part / total) * 100) : 0;
}

function CategoryBadge({ category }: { category: UlanganCategory }) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", meta.tone)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function LinkBadge({ linked }: { linked: boolean }) {
  return linked ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      <CheckCircle2 className="h-3 w-3" />
      Ulangan
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      <XCircle className="h-3 w-3" />
      Ulanmagan
    </span>
  );
}

function StatCard(props: {
  label: string;
  value: number;
  hint?: string;
  icon: typeof Users;
  tone: string;
  progress?: number;
}) {
  const Icon = props.icon;
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{props.label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", props.tone)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{props.value}</p>
      {props.progress != null ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${props.progress}%` }} />
        </div>
      ) : null}
      {props.hint ? <p className="mt-1.5 text-[11px] text-muted-foreground">{props.hint}</p> : null}
    </div>
  );
}

export default function UlanganlarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canViewUlanganlar(user?.role);
  const { data, isLoading, isFetching, error, refetch } = useUlanganlar(allowed);
  const [tab, setTab] = useState<LinkTab>("linked");
  const [cat, setCat] = useState<CatFilter>("all");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);

  const items = data?.items ?? [];
  const inCat = useMemo(() => (cat === "all" ? items : items.filter((i) => i.category === cat)), [items, cat]);
  const linkedCount = inCat.filter((i) => i.linked).length;
  const unlinkedCount = inCat.length - linkedCount;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inCat
      .filter((i) => (tab === "linked" ? i.linked : !i.linked))
      .filter((i) => {
        if (!needle) return true;
        return [i.fullName, i.login, i.phone, i.roleLabel, i.department, i.branch]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle));
      })
      .sort((a, b) =>
        tab === "linked"
          ? String(b.linkedAt || "").localeCompare(String(a.linkedAt || "")) || a.fullName.localeCompare(b.fullName)
          : a.fullName.localeCompare(b.fullName),
      );
  }, [inCat, tab, q]);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadUlanganlarExcel(cat);
    } catch (err) {
      toast({
        title: "Excel yuklanmadi",
        description: err instanceof Error ? err.message : "Qayta urinib ko‘ring",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  if (!allowed) {
    return (
      <div className="mx-auto max-w-xl p-6 text-center text-sm text-muted-foreground">
        Bu bo‘lim faqat admin va asoschi uchun.
      </div>
    );
  }

  const totals = data?.totals;
  const catChips: Array<{ id: CatFilter; label: string; count: number; linked: number }> = [
    { id: "all", label: "Barchasi", count: totals?.all ?? 0, linked: totals?.linked ?? 0 },
    ...(["ofis", "dorixona", "boshqa"] as const).map((c) => ({
      id: c,
      label: CATEGORY_META[c].label,
      count: totals?.byCategory[c].total ?? 0,
      linked: totals?.byCategory[c].linked ?? 0,
    })),
  ];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-3 sm:p-5">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#0a2540] via-[#0b3a5c] to-[#0f4c75] p-5 text-white shadow-md sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <Send className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">Telegram bot</p>
              <h1 className="text-xl font-bold sm:text-2xl">Ulanganlar</h1>
              <p className="mt-1 max-w-2xl text-sm text-white/75">
                Akkauntini {data?.botUsername ? `@${data.botUsername}` : "botga"} ulagan va hali ulamagan xodimlar —
                ofis va dorixona kesimida.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="gap-2 rounded-xl bg-white/10 text-white hover:bg-white/20"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              Yangilash
            </Button>
            <Button className="gap-2 rounded-xl bg-white text-[#0a2540] hover:bg-white/90" onClick={() => void onExport()} disabled={exporting || !data}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Excel
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error instanceof Error ? error.message : "Ro‘yxat yuklanmadi"}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Jami xodim" value={totals?.all ?? 0} icon={Users} tone="bg-slate-100 text-slate-700" />
            <StatCard
              label="Botga ulangan"
              value={totals?.linked ?? 0}
              icon={CheckCircle2}
              tone="bg-emerald-50 text-emerald-700"
              progress={pct(totals?.linked ?? 0, totals?.all ?? 0)}
              hint={`${pct(totals?.linked ?? 0, totals?.all ?? 0)}% ulangan`}
            />
            <StatCard
              label="Ofis — ulangan"
              value={totals?.byCategory.ofis.linked ?? 0}
              icon={Building2}
              tone="bg-indigo-50 text-indigo-700"
              progress={pct(totals?.byCategory.ofis.linked ?? 0, totals?.byCategory.ofis.total ?? 0)}
              hint={`${totals?.byCategory.ofis.total ?? 0} tadan`}
            />
            <StatCard
              label="Dorixona — ulangan"
              value={totals?.byCategory.dorixona.linked ?? 0}
              icon={Store}
              tone="bg-emerald-50 text-emerald-700"
              progress={pct(totals?.byCategory.dorixona.linked ?? 0, totals?.byCategory.dorixona.total ?? 0)}
              hint={`${totals?.byCategory.dorixona.total ?? 0} tadan`}
            />
          </div>

          <div className="rounded-2xl border border-border/70 bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b border-border/60 p-3 sm:p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:inline-flex sm:w-auto">
                  {(
                    [
                      { id: "linked", label: "Ulanganlar", count: linkedCount, icon: CheckCircle2 },
                      { id: "unlinked", label: "Ulanmaganlar", count: unlinkedCount, icon: XCircle },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
                        tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <t.icon className={cn("h-4 w-4", t.id === "linked" ? "text-emerald-600" : "text-amber-600")} />
                      {t.label}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] tabular-nums",
                          t.id === "linked" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900",
                        )}
                      >
                        {t.count}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="relative w-full lg:w-80">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Ism, login, telefon, filial…"
                    className="h-10 rounded-xl pl-9"
                  />
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-0.5">
                {catChips.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCat(c.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-medium transition",
                      cat === c.id
                        ? "border-[#0b3a5c] bg-[#0b3a5c] text-white"
                        : "border-border bg-background text-foreground hover:border-[#0b3a5c]/40",
                    )}
                  >
                    {c.label}
                    <span className={cn("text-[11px] tabular-nums", cat === c.id ? "text-white/75" : "text-muted-foreground")}>
                      {c.linked}/{c.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
                {tab === "unlinked" && !q ? (
                  <>
                    <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                    <p className="text-sm font-semibold">Hamma botga ulangan</p>
                  </>
                ) : (
                  <>
                    <Search className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Hech kim topilmadi</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">#</th>
                        <th className="px-4 py-2.5 font-semibold">Xodim</th>
                        <th className="px-4 py-2.5 font-semibold">Lavozim</th>
                        <th className="px-4 py-2.5 font-semibold">Turi</th>
                        <th className="px-4 py-2.5 font-semibold">Bo‘lim / filial</th>
                        <th className="px-4 py-2.5 font-semibold">Telefon</th>
                        <th className="px-4 py-2.5 font-semibold">Holat</th>
                        <th className="px-4 py-2.5 font-semibold">Ulangan vaqti</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {rows.map((i, idx) => (
                        <tr key={i.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">{idx + 1}</td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-foreground">{i.fullName}</p>
                            <p className="text-[11px] text-muted-foreground">{i.login}</p>
                          </td>
                          <td className="px-4 py-3 text-foreground/90">{i.roleLabel}</td>
                          <td className="px-4 py-3">
                            <CategoryBadge category={i.category} />
                          </td>
                          <td className="max-w-[240px] truncate px-4 py-3 text-foreground/90" title={placeOf(i)}>
                            {placeOf(i)}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-foreground/90">
                            {i.phone ? (
                              <a href={`tel:${i.phone}`} className="hover:underline">
                                {i.phone}
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <LinkBadge linked={i.linked} />
                          </td>
                          <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatWhen(i.linkedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <ul className="divide-y divide-border/60 md:hidden">
                  {rows.map((i) => (
                    <li key={i.id} className="space-y-2 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{i.fullName}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {i.roleLabel} · {i.login}
                          </p>
                        </div>
                        <LinkBadge linked={i.linked} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-foreground/80">
                        <CategoryBadge category={i.category} />
                        <span className="truncate">{placeOf(i)}</span>
                      </div>
                      <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                        {i.phone ? (
                          <a href={`tel:${i.phone}`} className="inline-flex items-center gap-1 hover:underline">
                            <Phone className="h-3 w-3" />
                            {i.phone}
                          </a>
                        ) : (
                          <span>—</span>
                        )}
                        {i.linked ? <span className="tabular-nums">{formatWhen(i.linkedAt)}</span> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <p className="px-1 text-[11px] text-muted-foreground">
            Faol xodimlar (admin va o‘quvchilarsiz). Ulangan vaqti shu yangilanishdan keyin ulanganlar uchun yoziladi;
            avval ulanganlarda «—».
          </p>
        </>
      )}
    </div>
  );
}
