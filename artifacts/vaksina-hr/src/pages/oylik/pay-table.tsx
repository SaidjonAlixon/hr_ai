import React from "react";
import { useLocation } from "wouter";
import { Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MoneyInput } from "@/lib/money";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import { formatSom, monthLabelUz, payrollRowKey, useJarimaSummary, useOylikSlip, useOylikYear, useSaveOylikLine, type PayrollRow } from "@/lib/oylik-api";
import { useI18n } from "@/i18n/I18nProvider";

function cleanBranch(raw: string | null | undefined): string {
  const name = displayBranchName(raw).trim();
  if (!name || name === "—" || name === "-") return "";
  return name;
}

export function DavomatJarimaCard({ month }: { month: string }) {
  const [, setLocation] = useLocation();
  const summary = useJarimaSummary(month);
  const own = Boolean(summary.data?.own);
  const people = summary.data?.people ?? 0;
  const total = summary.data?.total ?? 0;
  const waiting = own && summary.data && !summary.data.approved;
  return (
    <button
      type="button"
      onClick={() => setLocation("/oylik")}
      className="rounded-2xl border-2 border-rose-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-rose-400/30 dark:bg-[#2a1520]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-400/15 dark:text-rose-200">
            <Receipt className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Jarima</div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums leading-none text-[#0f2744] dark:text-white">
              {summary.isLoading ? "…" : own ? formatSom(total) : people}
              {own ? null : <span className="ml-1 text-sm font-medium text-slate-400">xodim</span>}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-rose-100 dark:bg-rose-400/20">
        <div className="h-full rounded-full bg-rose-500" style={{ width: people > 0 || total > 0 ? "100%" : "0%" }} />
      </div>
      <div className="mt-2 text-[11px] font-medium text-rose-700 dark:text-rose-200">
        {waiting ? "Hali tasdiqlanmagan" : own ? "Shu oy sizga yozilgan jarima" : `${formatSom(total)} · shu oy`}
      </div>
    </button>
  );
}

export function MySlip({ month }: { month: string }) {
  const { locale } = useI18n();
  const slip = useOylikSlip(month);
  const year = useOylikYear(month.slice(0, 4));
  if (slip.isLoading) return <Skeleton className="h-48 rounded-2xl" />;
  if (slip.error) return <p className="text-sm text-rose-700">{(slip.error as Error).message}</p>;
  const data = slip.data;
  if (!data?.approved) {
    const returned = data?.status === "returned" || data?.returned;
    return (
      <div className="space-y-3">
        <div className="dept-panel p-6">
          <p className="text-sm font-semibold text-foreground">{monthLabelUz(month, locale)}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {returned
              ? "Bu oyning tasdig‘i qaytarildi. Summa yopildi. Qayta tasdiqlangach yana ko‘rinadi. Oldingi tasdiqlangan oylar o‘z holida qoladi."
              : "Bu oy oyligi hali tasdiqlanmagan. Tasdiqlangach oylik va jarima shu yerda ko‘rinadi."}
          </p>
          <Badge className={cn("mt-3 text-white", returned ? "bg-rose-600 hover:bg-rose-600" : "bg-amber-500 hover:bg-amber-500")}>
            {returned ? "Qaytarilgan" : "Tasdiqlanmagan"}
          </Badge>
        </div>
        <YearLedger year={year.data} />
      </div>
    );
  }
  return (
    <div className="dept-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{monthLabelUz(month, locale)}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{data.fullName}</p>
        </div>
        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Tasdiqlangan</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Oylik</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{formatSom(data.salary || 0)}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-400/30 dark:bg-rose-500/10">
          <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-200">Jarima</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-rose-700 dark:text-rose-200">{formatSom(data.jarima || 0)}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-400/30 dark:bg-emerald-500/10">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-800 dark:text-emerald-200">Qo‘lda qoladi</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-800 dark:text-emerald-100">{formatSom(data.net || 0)}</p>
        </div>
      </div>
      {data.note ? <p className="mt-3 text-sm text-muted-foreground">Jarima izohi: {data.note}</p> : null}
      <YearLedger year={year.data} />
    </div>
  );
}

function YearLedger({ year }: { year?: { year: string; months: Array<{ month: string; status: string; net: number }>; approvedNet: number } }) {
  if (!year?.months.length) return null;
  return (
    <div className="dept-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{year.year} — oylar qo‘shilib boradi</p>
        <p className="text-sm font-bold tabular-nums">{formatSom(year.approvedNet)}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Har oy alohida saqlanadi. Faqat tasdiqlangan oylar summaga qo‘shiladi. Qaytarilgan oy summadan chiqadi, qolgan oylar o‘zgarmaydi.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {year.months.map((item) => (
          <span
            key={item.month}
            className={cn(
              "rounded-xl px-3 py-2 text-xs font-semibold",
              item.status === "approved" && "bg-emerald-50 text-emerald-800",
              item.status === "returned" && "bg-rose-50 text-rose-800",
              item.status !== "approved" && item.status !== "returned" && "bg-amber-50 text-amber-800",
            )}
          >
            {item.month.slice(5)} · {item.status === "approved" ? formatSom(item.net) : item.status === "returned" ? "Qaytarilgan" : "Tasdiqlanmagan"}
          </span>
        ))}
      </div>
    </div>
  );
}

function statusLabel(status: string) {
  if (status === "approved") return "Tasdiqlangan";
  if (status === "returned") return "Qaytarilgan";
  return "Tasdiqlanmagan";
}

function PayLine({
  row,
  month,
  canEdit,
  save,
  selected,
  onToggle,
}: {
  row: PayrollRow;
  month: string;
  canEdit: boolean;
  save: ReturnType<typeof useSaveOylikLine>;
  selected: boolean;
  onToggle: () => void;
}) {
  const [salary, setSalary] = React.useState(row.salary ?? 0);
  const [jarima, setJarima] = React.useState(row.jarima ?? 0);
  const [note, setNote] = React.useState(row.jarimaNote || "");
  React.useEffect(() => {
    setSalary(row.salary ?? 0);
    setJarima(row.jarima ?? 0);
    setNote(row.jarimaNote || "");
  }, [row.userId, row.salary, row.jarima, row.jarimaNote]);

  const persist = (nextSalary: number, nextJarima: number, nextNote: string) => {
    if (!canEdit || !row.userId) return;
    save.mutate({
      userId: row.userId,
      employeeId: row.employeeId,
      month,
      salary: nextSalary,
      jarima: nextJarima,
      note: nextNote,
    });
  };

  const net = salary - jarima;
  return (
    <tr className={cn("border-b border-border/60", selected && "bg-sky-50/70 dark:bg-sky-500/10")}>
      <td className="px-2 py-2">
        <input type="checkbox" className="h-4 w-4 accent-[#0b3a5c]" checked={selected} disabled={!row.userId} onChange={onToggle} />
      </td>
      <td className="px-3 py-2">
        <p className="font-semibold text-foreground">{row.fullName}</p>
        <p className="text-[11px] text-muted-foreground">{row.roleLabel}</p>
      </td>
      <td className="max-w-[180px] px-2 py-2 text-muted-foreground">
        <span className="block truncate">{row.position || "—"}</span>
        {cleanBranch(row.branch) ? <span className="block truncate text-[11px]">{cleanBranch(row.branch)}</span> : null}
      </td>
      <td className="px-2 py-2">
        <MoneyInput
          className="h-8 w-32 rounded-lg border border-border bg-card px-2 text-right text-sm"
          value={salary}
          disabled={!canEdit}
          onLive={setSalary}
          onCommit={(n) => {
            setSalary(n);
            persist(n, jarima, note);
          }}
        />
      </td>
      <td className="px-2 py-2">
        <MoneyInput
          className="h-8 w-32 rounded-lg border border-rose-200 bg-rose-50/60 px-2 text-right text-sm dark:border-rose-400/30 dark:bg-rose-500/10"
          value={jarima}
          disabled={!canEdit}
          onLive={setJarima}
          onCommit={(n) => {
            setJarima(n);
            persist(salary, n, note);
          }}
        />
      </td>
      <td className="px-2 py-2">
        <input
          className="h-8 w-full min-w-[140px] rounded-lg border border-border bg-card px-2 text-sm"
          value={note}
          disabled={!canEdit}
          placeholder="Sabab"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => persist(salary, jarima, note)}
        />
      </td>
      <td className={cn("px-2 py-2 text-right font-bold tabular-nums", net < 0 ? "text-rose-700" : "text-foreground")}>
        {formatSom(net)}
      </td>
      <td className="px-2 py-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold text-white",
            row.status === "approved" && "bg-emerald-600",
            row.status === "returned" && "bg-rose-600",
            row.status !== "approved" && row.status !== "returned" && "bg-amber-500",
          )}
        >
          {statusLabel(row.status)}
        </span>
      </td>
    </tr>
  );
}

export function PayTable({
  rows,
  month,
  canEdit,
  selected,
  onToggle,
  onTogglePage,
}: {
  rows: PayrollRow[];
  month: string;
  canEdit: boolean;
  selected: number[];
  onToggle: (userId: number) => void;
  onTogglePage: (userIds: number[], on: boolean) => void;
}) {
  const save = useSaveOylikLine();
  const totals = React.useMemo(() => {
    return rows.reduce(
      (a, r) => {
        const salary = r.salary ?? 0;
        const jarima = r.jarima ?? 0;
        a.salary += salary;
        a.jarima += jarima;
        a.net += salary - jarima;
        return a;
      },
      { salary: 0, jarima: 0, net: 0 },
    );
  }, [rows]);

  const ids = rows.map((r) => r.userId).filter((id): id is number => Boolean(id));
  const selectedSet = new Set(selected);
  const allOn = ids.length > 0 && ids.every((id) => selectedSet.has(id));
  if (!rows.length) {
    return <div className="dept-empty">Bu tanlovda xodim topilmadi.</div>;
  }

  return (
    <div className="dept-data-table">
      <div className="grid grid-cols-2 gap-px border-b bg-muted/50 sm:grid-cols-4">
        <div className="bg-card px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Xodim</p>
          <p className="text-sm font-bold tabular-nums">{rows.length}</p>
        </div>
        <div className="bg-card px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Oylik</p>
          <p className="text-sm font-bold tabular-nums">{formatSom(totals.salary)}</p>
        </div>
        <div className="bg-card px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Jarima</p>
          <p className="text-sm font-bold tabular-nums text-rose-700">{formatSom(totals.jarima)}</p>
        </div>
        <div className="bg-card px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Qo‘lda qoladi</p>
          <p className="text-sm font-bold tabular-nums">{formatSom(totals.net)}</p>
        </div>
      </div>
      <div className="max-h-[min(70vh,720px)] overflow-auto">
        <table className="w-full min-w-[920px] border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-primary text-primary-foreground dark:bg-slate-800/95 dark:text-slate-100">
            <tr className="text-left">
              <th className="px-2 py-2">
                <input type="checkbox" className="h-4 w-4 accent-white" checked={allOn} onChange={() => onTogglePage(ids, !allOn)} />
              </th>
              <th className="px-3 py-2 font-semibold">Xodim</th>
              <th className="px-2 py-2 font-semibold">Lavozim</th>
              <th className="px-2 py-2 font-semibold">Oylik</th>
              <th className="px-2 py-2 font-semibold">Jarima</th>
              <th className="px-2 py-2 font-semibold">Izoh</th>
              <th className="px-2 py-2 text-right font-semibold">Qo‘lda</th>
              <th className="px-2 py-2 font-semibold">Holat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PayLine
                key={payrollRowKey(row)}
                row={row}
                month={month}
                canEdit={canEdit}
                save={save}
                selected={row.userId != null && selectedSet.has(row.userId)}
                onToggle={() => row.userId && onToggle(row.userId)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {save.isPending ? <p className="px-3 py-2 text-[11px] text-muted-foreground">Saqlanmoqda…</p> : null}
    </div>
  );
}
