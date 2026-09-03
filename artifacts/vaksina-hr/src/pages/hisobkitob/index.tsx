import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  Search,
  Unlock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  canViewHisobkitob,
  currentMonthKey,
  formatSom,
  monthLabelUz,
  shiftMonthKey,
  useHisobMutations,
  useHisobSheet,
  useHisobSheets,
  type SettlementLine,
} from "@/lib/hisobkitob-api";
import { formatMoney, formatMoneyInput, parseMoney } from "@/lib/money-format";
import { useI18n } from "@/i18n/I18nProvider";

function CellInput({
  value,
  disabled,
  className,
  onCommit,
  percent,
}: {
  value: number | string;
  disabled?: boolean;
  className?: string;
  percent?: boolean;
  onCommit: (n: number) => void;
}) {
  const show = (v: number | string) =>
    percent ? String(Number(v) * 100) : formatMoney(Number(v) || 0);
  const [txt, setTxt] = useState(show(value));
  useEffect(() => {
    setTxt(show(value));
  }, [value, percent]);
  return (
    <input
      inputMode="decimal"
      disabled={disabled}
      value={txt}
      onChange={(e) => setTxt(percent ? e.target.value : formatMoneyInput(e.target.value))}
      onBlur={() => {
        const n = parseMoney(txt);
        onCommit(percent ? n / 100 : n);
        setTxt(percent ? String(n) : formatMoney(n));
      }}
      className={cn(
        "h-6 w-full rounded-sm border-0 bg-transparent px-1 text-right text-[11px] leading-none tabular-nums outline-none focus:bg-card focus:ring-1 focus:ring-[#0b3a5c]/30 disabled:opacity-70",
        className,
      )}
    />
  );
}

function roleLabel(p?: string | null) {
  const s = (p || "").trim();
  if (!s) return "";
  return s.split("·")[0]!.trim();
}

function FormulaHint() {
  const { t } = useI18n();
  return (
    <div className="dept-panel text-[11px] leading-relaxed text-muted-foreground">
      <p className="font-semibold dept-accent-value">{t("hisob.formulaTitle")}</p>
      <p className="mt-1">{t("hisob.formula1")}</p>
      <p>{t("hisob.formula2")}</p>
      <p>{t("hisob.formula3")}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{t("hisob.formula4")}</p>
    </div>
  );
}

export default function HisobkitobPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const allowed = canViewHisobkitob(user?.role);
  const [month, setMonth] = useState("2026-08");
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<"name" | "role">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [nameQuery, setNameQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [bulkFiks, setBulkFiks] = useState("0");
  const [bulkBonus, setBulkBonus] = useState("0");
  const sheets = useHisobSheets(month);
  const detail = useHisobSheet(sheetId);
  const mut = useHisobMutations();
  const creatingRef = React.useRef(false);
  const ml = (ym: string) => monthLabelUz(ym, locale);

  useEffect(() => {
    const items = sheets.data?.items ?? [];
    if (sheets.isLoading || sheets.isFetching) return;
    if (!items.length) {
      setSheetId(null);
      if (!creatingRef.current && !mut.create.isPending) {
        creatingRef.current = true;
        mut.create.mutate(
          { branchName: t("hisob.sheetName"), month },
          { onSettled: () => { creatingRef.current = false; } },
        );
      }
      return;
    }
    creatingRef.current = false;
    if (!sheetId || !items.some((s) => s.id === sheetId)) setSheetId(items[0]!.id);
  }, [sheets.data, sheets.isLoading, sheets.isFetching, sheetId, month, mut.create, t]);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-xl font-bold">{t("hisob.subtitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("hisob.accessDenied")}</p>
      </div>
    );
  }

  const d = detail.data;
  const edit = Boolean(d?.canEdit);
  const admin = Boolean(d?.canAdmin);
  const roles = useMemo(() => {
    const set = new Set<string>();
    for (const r of d?.lines ?? []) {
      const p = roleLabel(r.position);
      if (p) set.add(p);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "uz"));
  }, [d?.lines]);
  const rows = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    let list = [...(d?.lines ?? [])];
    if (q) list = list.filter((r) => r.fullName.toLowerCase().includes(q));
    if (roleFilter) list = list.filter((r) => roleLabel(r.position) === roleFilter);
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const av = sortKey === "role" ? roleLabel(a.position) : a.fullName;
      const bv = sortKey === "role" ? roleLabel(b.position) : b.fullName;
      return dir * av.localeCompare(bv, "uz", { sensitivity: "base" });
    });
    return list;
  }, [d?.lines, sortKey, sortDir, nameQuery, roleFilter]);

  const toggleSort = (key: "name" | "role") => {
    if (sortKey === key) setSortDir((x) => (x === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const saveLine = (id: number, body: Record<string, unknown>) => {
    mut.patchLine.mutate(
      { id, body },
      { onError: (e) => toast({ title: t("common.notSaved"), description: (e as Error).message, variant: "destructive" }) },
    );
  };

  return (
    <div className="dept-page">
      <div className="dept-hero dept-hero-primary">
        <div className="dept-hero-glow" />
        <div className="dept-hero-body flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="dept-eyebrow">{t("hisob.finance")}</p>
            <h1 className="dept-title flex items-center gap-2">
              <Calculator className="h-6 w-6" /> {t("hisob.title")}
            </h1>
            <p className="dept-desc">
              {t("hisob.desc")}
            </p>
          </div>
          <div className="dept-month-nav">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/15 hover:text-white" onClick={() => setMonth(shiftMonthKey(month, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[120px] px-1 text-center text-[13px] font-semibold text-white">{ml(month)}</span>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/15 hover:text-white" onClick={() => setMonth(shiftMonthKey(month, 1))} disabled={month >= currentMonthKey() && month >= "2026-08"}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="dept-page-inner">

      {sheets.isLoading || detail.isLoading || (!d && mut.create.isPending) ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : detail.error ? (
        <p className="text-sm text-rose-700">{(detail.error as Error).message}</p>
      ) : !d ? (
        <p className="dept-empty">{ml(month)} {t("hisob.empty")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
            {[
              { l: t("hisob.employees"), v: `${d.lines.length} ${t("hisob.count")}` },
              { l: `${ml(d.month)} ${t("hisob.plan")}`, v: formatSom(d.planCurrent) },
              { l: `${ml(shiftMonthKey(d.month, -1))} ${t("hisob.plan")}`, v: formatSom(d.planPrev) },
              { l: t("hisob.monthSales"), v: formatSom(d.totals.salesTotal) },
              { l: t("hisob.overPlan"), v: formatSom((d.totals as { overPlanTotal?: number }).overPlanTotal ?? d.totals.overPrev) },
              { l: `${ml(shiftMonthKey(d.month, -1))}${t("hisob.vsPrev")}`, v: `${d.totals.vsPrevPct}%` },
              { l: t("hisob.cashCard"), v: formatSom(d.totals.cardTotal) },
            ].map((c) => (
              <div key={c.l} className="dept-kpi !p-3">
                <p className="dept-kpi-label !mt-0">{c.l}</p>
                <p className="dept-kpi-value !text-sm md:!text-base">{c.v}</p>
              </div>
            ))}
          </div>

          <div className="dept-toolbar">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder={t("hisob.searchName")}
                className="h-8 w-48 rounded-lg border border-border bg-card pl-7 pr-2 text-sm outline-none focus:ring-1 focus:ring-[#0b3a5c]/30"
              />
            </div>
            <select
              className="h-8 max-w-[220px] rounded-lg border border-border bg-card px-2 text-sm"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">{t("ui.allPositions")}</option>
              {roles.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {edit ? (
              <>
                <span className="text-xs text-muted-foreground">{t("hisob.fiksa")}</span>
                <input
                  inputMode="numeric"
                  value={bulkFiks}
                  onChange={(e) => setBulkFiks(formatMoneyInput(e.target.value) || "0")}
                  className="h-8 w-36 rounded-lg border border-border px-2 text-sm tabular-nums"
                />
                <span className="text-xs text-muted-foreground">{t("hisob.bonusPct")}</span>
                <input
                  value={bulkBonus}
                  onChange={(e) => setBulkBonus(e.target.value)}
                  className="h-8 w-20 rounded-lg border border-border px-2 text-sm tabular-nums"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8"
                  disabled={mut.applyPosition.isPending || !roleFilter}
                  onClick={() => {
                    if (!roleFilter) {
                      toast({ title: t("hisob.pickPosition"), variant: "destructive" });
                      return;
                    }
                    mut.applyPosition.mutate(
                      {
                        id: d.id,
                        position: roleFilter,
                        fiksa: parseMoney(bulkFiks),
                        bonusPercent: parseMoney(bulkBonus),
                      },
                      {
                        onSuccess: () => toast({ title: `${roleFilter} ${t("hisob.writtenFor")}` }),
                        onError: (e) => toast({ title: t("hisob.notWritten"), description: (e as Error).message, variant: "destructive" }),
                      },
                    );
                  }}
                >
                  {t("ui.writeToPosition")}
                </Button>
              </>
            ) : null}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button type="button" size="sm" className="h-8" onClick={() => { window.location.href = `/api/hisobkitob/sheets/${d.id}/export`; }}>
                <Download className="mr-1 h-3.5 w-3.5" /> {t("ui.excel")}
              </Button>
              {d.status !== "approved" ? (
                <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => mut.approve.mutate(d.id, { onSuccess: () => toast({ title: t("hisob.approved") }) })}>
                  <Lock className="mr-1 h-3.5 w-3.5" /> {t("ui.approve")}
                </Button>
              ) : admin ? (
                <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => mut.unlock.mutate(d.id)}>
                  <Unlock className="mr-1 h-3.5 w-3.5" /> {t("ui.reopen")}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="dept-data-table">
            <div className="max-h-[min(72vh,760px)] overflow-auto">
              <table className="w-full min-w-[2100px] border-collapse text-[11px] leading-tight">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {[
                      { t: t("hisob.col.num"), a: "center", k: "num" },
                      { t: t("hisob.col.employee"), a: "left", k: "name" },
                      { t: t("hisob.col.position"), a: "left", k: "role" },
                      { t: t("hisob.col.phone"), a: "left", k: "phone" },
                      { t: t("hisob.col.plan"), a: "right" },
                      { t: t("hisob.col.planPrev"), a: "right" },
                      { t: t("hisob.col.actual"), a: "right" },
                      { t: t("hisob.col.overPlan"), a: "right" },
                      { t: t("hisob.col.planPct"), a: "right" },
                      { t: t("hisob.col.salesPct"), a: "right" },
                      { t: t("hisob.col.pctSum"), a: "right" },
                      { t: t("hisob.col.fixed"), a: "right" },
                      { t: t("hisob.col.planBonus"), a: "right" },
                      { t: t("hisob.col.kpiBonus"), a: "right" },
                      { t: t("hisob.col.advance"), a: "right" },
                      { t: t("hisob.col.recalc"), a: "right" },
                      { t: t("hisob.col.timeFine"), a: "right" },
                      { t: t("hisob.col.expiryFine"), a: "right" },
                      { t: t("hisob.col.calc"), a: "right" },
                      { t: t("hisob.cashCard"), a: "right", k: "card" },
                    ].map((h) => (
                      <th
                        key={h.k || h.t}
                        className={cn(
                          "whitespace-nowrap px-1.5 py-1 text-[10px] font-semibold leading-tight",
                          h.a === "right" ? "text-right" : h.a === "center" ? "text-center" : "text-left",
                        )}
                      >
                        {h.k === "name" || h.k === "role" ? (
                          <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort(h.k as "name" | "role")}>
                            {h.t}
                            <ArrowUpDown className={cn("h-3 w-3 opacity-70", sortKey === h.k && "opacity-100")} />
                          </button>
                        ) : (
                          h.t
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: SettlementLine, idx) => (
                    <tr key={row.id}>
                      <td className="sticky left-0 z-[1] w-8 bg-muted px-0.5 py-0 text-center text-[10px] tabular-nums text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="sticky left-8 z-[1] min-w-[220px] whitespace-nowrap bg-card px-1 py-0">
                        {edit ? (
                          <input
                            defaultValue={row.fullName}
                            className="h-6 w-full min-w-[200px] bg-transparent px-1 text-left text-[11px] font-semibold leading-none outline-none focus:bg-card"
                            onBlur={(e) => saveLine(row.id, { fullName: e.target.value })}
                          />
                        ) : (
                          <span className="block px-1 py-0 font-semibold whitespace-nowrap">{row.fullName}</span>
                        )}
                      </td>
                      <td className="min-w-[140px] whitespace-nowrap px-1 py-0">
                        {edit ? (
                          <input
                            defaultValue={roleLabel(row.position)}
                            className="h-6 w-full min-w-[120px] bg-transparent px-1 text-[11px] leading-none outline-none focus:bg-card"
                            onBlur={(e) => saveLine(row.id, { position: e.target.value })}
                          />
                        ) : (
                          <span className="block px-1 py-0 text-foreground whitespace-nowrap">{roleLabel(row.position) || "—"}</span>
                        )}
                      </td>
                      <td className="px-1 py-0">
                        {edit ? (
                          <input
                            defaultValue={row.phone || ""}
                            className="h-6 w-28 bg-transparent px-1 text-[11px] leading-none outline-none focus:bg-card"
                            onBlur={(e) => saveLine(row.id, { phone: e.target.value })}
                          />
                        ) : (
                          <span className="px-1 text-muted-foreground">{row.phone || "—"}</span>
                        )}
                      </td>
                      <td className="px-1 py-0"><CellInput value={row.planCurrent ?? 0} disabled={!edit} onCommit={(n) => saveLine(row.id, { planCurrent: n })} /></td>
                      <td className="px-1 py-0"><CellInput value={row.planPrev ?? 0} disabled={!edit} onCommit={(n) => saveLine(row.id, { planPrev: n })} /></td>
                      <td className="px-1 py-0"><CellInput value={row.sales} disabled={!edit} onCommit={(n) => saveLine(row.id, { sales: n })} /></td>
                      <td className="px-1 py-0 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatSom(row.overPlan ?? 0)}</td>
                      <td className="border border-slate-300 px-1 py-0 text-right tabular-nums">{row.planPct ?? 0}%</td>
                      <td className="border border-slate-300 px-1 py-0" title="0 = foiz yo‘q; 0.6 = 0.6%">
                        <CellInput value={row.percent} percent disabled={!edit} onCommit={(n) => saveLine(row.id, { percent: n })} />
                      </td>
                      <td className="px-1 py-0 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{formatSom(row.oylikPct)}</td>
                      <td className="px-1 py-0"><CellInput value={row.fiksa} disabled={!edit} onCommit={(n) => saveLine(row.id, { fiksa: n })} /></td>
                      <td className="px-1 py-0"><CellInput value={row.planBonus} disabled={!edit} onCommit={(n) => saveLine(row.id, { planBonus: n })} /></td>
                      <td className="px-1 py-0"><CellInput value={row.extraBonus ?? 0} disabled={!edit} onCommit={(n) => saveLine(row.id, { extraBonus: n })} /></td>
                      <td className="px-1 py-0"><CellInput value={row.avans} disabled={!edit} onCommit={(n) => saveLine(row.id, { avans: n })} /></td>
                      <td className="px-1 py-0"><CellInput value={row.inventoryFine} disabled={!edit} onCommit={(n) => saveLine(row.id, { inventoryFine: n })} /></td>
                      <td className="px-1 py-0"><CellInput value={row.timeFine} disabled={!edit} onCommit={(n) => saveLine(row.id, { timeFine: n })} /></td>
                      <td className="px-1 py-0"><CellInput value={row.expiryHold} disabled={!edit} onCommit={(n) => saveLine(row.id, { expiryHold: n })} /></td>
                      <td className="px-1 py-0 text-right font-bold tabular-nums dept-accent-value">{formatSom(row.grossPay ?? row.net)}</td>
                      <td className="border border-slate-300 px-1 py-0 text-right font-bold tabular-nums">{formatSom(row.card)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0">
                  <tr>
                    <td className="px-1 py-0 text-center">—</td>
                    <td className="px-1 py-0">{t("ui.total")}</td>
                    <td className="px-1 py-0 text-[11px] text-muted-foreground">{rows.length} / {d.lines.length} {t("hisob.employeesOf")}</td>
                    <td />
                    <td />
                    <td />
                    <td className="px-1 py-0 text-right tabular-nums">{formatSom(d.totals.salesTotal)}</td>
                    <td className="px-1 py-0 text-right tabular-nums">{formatSom((d.totals as { overPlanTotal?: number }).overPlanTotal ?? 0)}</td>
                    <td className="px-1 py-0 text-right">{d.totals.vsCurrentPct}%</td>
                    <td />
                    <td className="px-1 py-0 text-right tabular-nums">{formatSom(d.totals.oylikPctTotal)}</td>
                    <td colSpan={7} />
                    <td className="px-1 py-0 text-right tabular-nums">{formatSom((d.totals as { grossPayTotal?: number }).grossPayTotal ?? d.totals.netTotal)}</td>
                    <td className="px-1 py-0 text-right tabular-nums">{formatSom(d.totals.cardTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <FormulaHint />
        </>
      )}
      </div>
    </div>
  );
}
