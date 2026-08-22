import React, { useEffect, useState } from "react";
import {
  Calculator,
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function numOrEmpty(v: string) {
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

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
  const [txt, setTxt] = useState(String(value ?? ""));
  useEffect(() => {
    setTxt(percent ? String(Number(value) * 100) : String(value ?? ""));
  }, [value, percent]);
  return (
    <input
      disabled={disabled}
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => {
        const n = numOrEmpty(txt);
        onCommit(percent ? n / 100 : n);
      }}
      className={cn(
        "h-8 w-full rounded-md border-0 bg-transparent px-1.5 text-right text-[12px] tabular-nums outline-none focus:bg-white focus:ring-1 focus:ring-[#0b3a5c]/30 disabled:opacity-70",
        className,
      )}
    />
  );
}

function FormulaHint() {
  return (
    <div className="rounded-xl border bg-white p-3 text-[11px] leading-relaxed text-slate-600 shadow-sm">
      <p className="font-semibold text-[#0b3a5c]">Hisoblash qoidasi</p>
      <p className="mt-1">
        <b>Oylik %</b> = shaxsiy savdo × bonus foizi (masalan 0.6% = 0.006). Jami savdo ishlatilmaydi.
      </p>
      <p>
        <b>Jami</b> = Oylik % + Fiksa + Reja bonusi − Avans − Pereuchyot − Vaqt jarimasi − Muddat ushlovi.
      </p>
      <p>
        <b>Gross</b> = Kartaga tushadigan / 0.88 (≈12% soliq). Farq = Jami − Karta (0 bo‘lishi kerak).
      </p>
    </div>
  );
}

export default function HisobkitobPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canViewHisobkitob(user?.role);
  const [month, setMonth] = useState("2026-08");
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const sheets = useHisobSheets(month);
  const detail = useHisobSheet(sheetId);
  const mut = useHisobMutations();

  useEffect(() => {
    const items = sheets.data?.items ?? [];
    if (!items.length) {
      setSheetId(null);
      return;
    }
    if (!sheetId || !items.some((s) => s.id === sheetId)) {
      setSheetId(items[0]!.id);
    }
  }, [sheets.data, sheetId]);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-xl font-bold">Hisob-kitob</h1>
        <p className="mt-2 text-sm text-slate-500">Faqat admin, direktor va moliyachi ko‘radi.</p>
      </div>
    );
  }

  const d = detail.data;
  const edit = Boolean(d?.canEdit);
  const admin = Boolean(d?.canAdmin);

  const saveLine = (id: number, body: Record<string, unknown>) => {
    mut.patchLine.mutate(
      { id, body },
      { onError: (e) => toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" }) },
    );
  };

  return (
    <div className="space-y-3 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#0b3a5c] px-4 py-3 text-white shadow">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <Calculator className="h-5 w-5" /> Hisob-kitob
          </h1>
          <p className="text-xs text-white/70">Savdo, fiksa, bonus va jarimalar — Excel uslubida</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-white/10 p-0.5">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/15 hover:text-white" onClick={() => setMonth(shiftMonthKey(month, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[120px] text-center text-[13px] font-semibold">{monthLabelUz(month)}</span>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/15 hover:text-white" onClick={() => setMonth(shiftMonthKey(month, 1))} disabled={month >= currentMonthKey() && month >= "2026-08"}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(sheets.data?.items ?? []).map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSheetId(s.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold",
              sheetId === s.id ? "bg-[#0b3a5c] text-white" : "bg-white text-slate-700 ring-1 ring-slate-200",
            )}
          >
            {s.branchName}
            {s.status === "approved" ? " ✓" : ""}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            placeholder="Yangi varaq nomi"
            className="h-8 w-40 text-xs"
          />
          <Button
            type="button"
            size="sm"
            className="h-8 bg-[#0b3a5c]"
            disabled={mut.create.isPending}
            onClick={() =>
              mut.create.mutate(
                { branchName: newBranch || "Oylik", month },
                {
                  onSuccess: (row) => {
                    setNewBranch("");
                    setSheetId(row.id);
                    toast({ title: "Varaq ochildi" });
                  },
                  onError: (e) => toast({ title: "Xato", description: (e as Error).message, variant: "destructive" }),
                },
              )
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Varaq
          </Button>
        </div>
      </div>

      {sheets.isLoading || detail.isLoading ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : detail.error ? (
        <p className="text-sm text-rose-700">{(detail.error as Error).message}</p>
      ) : !d ? (
        <p className="rounded-xl border bg-white px-4 py-10 text-center text-sm text-slate-500">
          Bu oyda varaq yo‘q — nom yozib «Varaq» bosing.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
            {[
              { l: "Avgust reja", v: formatSom(d.planCurrent) },
              { l: "Iyul reja", v: formatSom(d.planPrev) },
              { l: "Bir oylik savdo", v: formatSom(d.totals.salesTotal) },
              { l: "Iyuldan farq", v: formatSom(d.totals.overPrev) },
              { l: "Iyulga %", v: `${d.totals.vsPrevPct}%` },
              { l: "Jami karta", v: formatSom(d.totals.cardTotal) },
            ].map((c) => (
              <div key={c.l} className="rounded-xl border bg-white px-3 py-2 shadow-sm">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">{c.l}</p>
                <p className="text-sm font-bold tabular-nums text-[#0b3a5c]">{c.v}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
            <label className="text-[11px] text-slate-500">
              Varaq
              <Input
                className="mt-0.5 h-8 w-40"
                defaultValue={d.branchName}
                disabled={!edit}
                onBlur={(e) => mut.patchSheet.mutate({ id: d.id, body: { branchName: e.target.value } })}
              />
            </label>
            <label className="text-[11px] text-slate-500">
              Joriy reja
              <Input
                className="mt-0.5 h-8 w-36"
                defaultValue={d.planCurrent}
                disabled={!edit}
                onBlur={(e) => mut.patchSheet.mutate({ id: d.id, body: { planCurrent: numOrEmpty(e.target.value) } })}
              />
            </label>
            <label className="text-[11px] text-slate-500">
              Oldingi oy reja
              <Input
                className="mt-0.5 h-8 w-36"
                defaultValue={d.planPrev}
                disabled={!edit}
                onBlur={(e) => mut.patchSheet.mutate({ id: d.id, body: { planPrev: numOrEmpty(e.target.value) } })}
              />
            </label>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", d.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900")}>
              {d.status === "approved" ? "Tasdiqlangan" : "Qoralama"}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              {edit ? (
                <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => mut.addLine.mutate({ sheetId: d.id, body: { fullName: "Yangi xodim" } })}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Xodim
                </Button>
              ) : null}
              <Button type="button" size="sm" className="h-8 bg-[#0b3a5c]" onClick={() => { window.location.href = `/api/hisobkitob/sheets/${d.id}/export`; }}>
                <Download className="mr-1 h-3.5 w-3.5" /> Excel
              </Button>
              {d.status !== "approved" ? (
                <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => mut.approve.mutate(d.id, { onSuccess: () => toast({ title: "Tasdiqlandi" }) })}>
                  <Lock className="mr-1 h-3.5 w-3.5" /> Tasdiqlash
                </Button>
              ) : admin ? (
                <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => mut.unlock.mutate(d.id)}>
                  <Unlock className="mr-1 h-3.5 w-3.5" /> Qayta ochish
                </Button>
              ) : null}
              {admin ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-rose-700"
                  onClick={() => {
                    if (window.confirm("Varaq o‘chirilsinmi?")) mut.delSheet.mutate(d.id, { onSuccess: () => setSheetId(null) });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
            <div className="max-h-[min(72vh,760px)] overflow-auto">
              <table className="w-full min-w-[1480px] border-collapse text-[12px]">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {[
                      { t: "Xodim", a: "left" },
                      { t: "Telefon", a: "left" },
                      { t: "Savdo", a: "right" },
                      { t: "Bonus %", a: "right" },
                      { t: "Oylik %", a: "right" },
                      { t: "Fiksa", a: "right" },
                      { t: "Reja bonusi", a: "right" },
                      { t: "Avans", a: "right" },
                      { t: "Pereuchyot", a: "right" },
                      { t: "Vaqt jarimasi", a: "right" },
                      { t: "Muddat ushlovi", a: "right" },
                      { t: "Jami", a: "right" },
                      { t: "Karta", a: "right" },
                      { t: "Farq", a: "right" },
                      { t: "Gross", a: "right" },
                      { t: "", a: "center" },
                    ].map((h) => (
                      <th
                        key={h.t || "x"}
                        className={cn(
                          "border border-slate-400 bg-[#f4c430] px-2 py-2 text-[11px] font-bold leading-tight text-slate-900",
                          h.a === "right" ? "text-right" : h.a === "center" ? "text-center" : "text-left",
                        )}
                      >
                        {h.t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((row: SettlementLine) => (
                    <tr key={row.id} className="hover:bg-sky-50/60">
                      <td className="border border-slate-300 px-1 py-0.5">
                        {edit ? (
                          <input
                            defaultValue={row.fullName}
                            className="h-8 w-full min-w-[160px] bg-transparent px-1.5 text-left text-[12px] font-semibold outline-none focus:bg-white"
                            onBlur={(e) => saveLine(row.id, { fullName: e.target.value })}
                          />
                        ) : (
                          <span className="block px-1.5 py-1.5 font-semibold">{row.fullName}</span>
                        )}
                      </td>
                      <td className="border border-slate-300 px-1 py-0.5">
                        {edit ? (
                          <input
                            defaultValue={row.phone || ""}
                            className="h-8 w-28 bg-transparent px-1.5 text-[12px] outline-none focus:bg-white"
                            onBlur={(e) => saveLine(row.id, { phone: e.target.value })}
                          />
                        ) : (
                          <span className="px-1.5 text-slate-600">{row.phone || "—"}</span>
                        )}
                      </td>
                      <td className="border border-slate-300 px-1 py-0.5"><CellInput value={row.sales} disabled={!edit} onCommit={(n) => saveLine(row.id, { sales: n })} /></td>
                      <td className="border border-slate-300 px-1 py-0.5" title="0.6 yozing = 0.6%">
                        <CellInput value={row.percent} percent disabled={!edit} onCommit={(n) => saveLine(row.id, { percent: n })} />
                      </td>
                      <td className="border border-slate-300 px-2 py-1.5 text-right font-medium tabular-nums text-emerald-800">{formatSom(row.oylikPct)}</td>
                      <td className="border border-slate-300 px-1 py-0.5"><CellInput value={row.fiksa} disabled={!edit} onCommit={(n) => saveLine(row.id, { fiksa: n })} /></td>
                      <td className="border border-slate-300 px-1 py-0.5"><CellInput value={row.planBonus} disabled={!edit} onCommit={(n) => saveLine(row.id, { planBonus: n })} /></td>
                      <td className="border border-slate-300 px-1 py-0.5"><CellInput value={row.avans} disabled={!edit} onCommit={(n) => saveLine(row.id, { avans: n })} /></td>
                      <td className="border border-slate-300 px-1 py-0.5"><CellInput value={row.inventoryFine} disabled={!edit} onCommit={(n) => saveLine(row.id, { inventoryFine: n })} /></td>
                      <td className="border border-slate-300 px-1 py-0.5"><CellInput value={row.timeFine} disabled={!edit} onCommit={(n) => saveLine(row.id, { timeFine: n })} /></td>
                      <td className="border border-slate-300 px-1 py-0.5"><CellInput value={row.expiryHold} disabled={!edit} onCommit={(n) => saveLine(row.id, { expiryHold: n })} /></td>
                      <td className="border border-slate-300 px-2 py-1.5 text-right font-bold tabular-nums text-[#0b3a5c]">{formatSom(row.net)}</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums">{formatSom(row.card)}</td>
                      <td className={cn("border border-slate-300 px-2 py-1.5 text-right tabular-nums", row.diff === 0 ? "text-emerald-700" : "text-rose-700")}>{formatSom(row.diff)}</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-right tabular-nums text-slate-600">{formatSom(row.gross)}</td>
                      <td className="border border-slate-300 px-1 text-center">
                        {edit ? (
                          <button type="button" className="rounded p-1 text-rose-600 hover:bg-rose-50" onClick={() => mut.delLine.mutate(row.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0">
                  <tr className="bg-orange-100 font-semibold">
                    <td className="border border-slate-400 px-2 py-1.5">Jami</td>
                    <td className="border border-slate-400 px-2 py-1.5 text-[11px] text-slate-600">{d.lines.length} xodim</td>
                    <td className="border border-slate-400 px-2 py-1.5 text-right tabular-nums">{formatSom(d.totals.salesTotal)}</td>
                    <td className="border border-slate-400" />
                    <td className="border border-slate-400 px-2 py-1.5 text-right tabular-nums">{formatSom(d.totals.oylikPctTotal)}</td>
                    <td className="border border-slate-400 px-2 py-1.5 text-[11px] text-slate-600" colSpan={6}>
                      Oldingi rejaga {d.totals.vsPrevPct}% · joriy rejaga {d.totals.vsCurrentPct}%
                    </td>
                    <td className="border border-slate-400 px-2 py-1.5 text-right tabular-nums">{formatSom(d.totals.netTotal)}</td>
                    <td className="border border-slate-400 px-2 py-1.5 text-right tabular-nums">{formatSom(d.totals.cardTotal)}</td>
                    <td className={cn("border border-slate-400 px-2 py-1.5 text-right tabular-nums", d.totals.diffTotal === 0 ? "text-emerald-700" : "text-rose-700")}>
                      {formatSom(d.totals.diffTotal)}
                    </td>
                    <td className="border border-slate-400 px-2 py-1.5 text-right tabular-nums">{formatSom(d.totals.grossTotal)}</td>
                    <td className="border border-slate-400" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <FormulaHint />
        </>
      )}
    </div>
  );
}
