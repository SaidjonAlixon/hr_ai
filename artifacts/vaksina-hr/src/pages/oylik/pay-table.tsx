import React from "react";
import { useLocation } from "wouter";
import { ArrowUpRight, Download, FileText, Receipt } from "lucide-react";
import { exportJarimaExcel, exportJarimaPdf, type JarimaExportLine } from "@/lib/jarima-export";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MoneyInput } from "@/lib/money";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import { formatSom, monthLabelUz, payrollRowKey, useJarimaSummary, useOylikSlip, useOylikYear, useSaveOylikLine, type PayrollRow } from "@/lib/oylik-api";
import { datesFromTo, resolveDay, weekdayShort, type PayrollSlice } from "@/lib/oylik-period";
import { useI18n } from "@/i18n/I18nProvider";

function cleanBranch(raw: string | null | undefined): string {
  const name = displayBranchName(raw).trim();
  if (!name || name === "—" || name === "-") return "";
  return name;
}

export function DavomatJarimaCard({ month, onOpen }: { month: string; onOpen?: () => void }) {
  const [, setLocation] = useLocation();
  const summary = useJarimaSummary(month);
  const own = Boolean(summary.data?.own);
  const people = summary.data?.people ?? 0;
  const total = summary.data?.total ?? 0;
  const self = summary.data?.self;
  const waiting = own ? summary.data?.self?.status !== "approved" : true;
  return (
    <button
      type="button"
      onClick={() => (onOpen ? onOpen() : setLocation("/oylik"))}
      className="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,39,68,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-20px_rgba(225,29,72,0.45)] dark:border-rose-400/25 dark:bg-[#2a1520]"
    >
      <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-500 to-pink-600" />
      <span className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-rose-500 opacity-[0.12] blur-2xl transition-opacity group-hover:opacity-25" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-400/15 dark:text-rose-200">
            <Receipt className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">Jarima</div>
            <div className="mt-1 text-[28px] font-extrabold tabular-nums leading-none tracking-tight text-[#0f2744] dark:text-white">
              {summary.isLoading ? "…" : own ? formatSom(self?.amount ?? total) : people}
              {own ? null : <span className="ml-1 text-xs font-semibold tracking-normal text-slate-400">xodim</span>}
            </div>
          </div>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500 transition group-hover:bg-rose-500 group-hover:text-white dark:bg-rose-400/15 dark:text-rose-200">
          <ArrowUpRight className="h-4 w-4" />
        </span>
      </div>
      <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-rose-100 dark:bg-rose-400/20">
        <div className="h-full rounded-full bg-gradient-to-r from-rose-400 to-rose-600" style={{ width: people > 0 || total > 0 ? "100%" : "0%" }} />
      </div>
      <div className="relative mt-2 truncate text-[11px] font-semibold text-rose-700 dark:text-rose-200">
        {summary.isLoading
          ? "Hisoblanmoqda"
          : own
            ? self
              ? `${self.strikes} marta · ${waiting ? "qoralama" : "tasdiqlangan"}`
              : "01.10.2026 dan kechikkan va kelmagan"
            : `${formatSom(total)} · ${waiting ? "qoralama" : "shu oy"}`}
      </div>
    </button>
  );
}

const JARIMA_RULE_CARDS = [
  { n: "1", title: "1-marta", body: "Ogohlantirish va tushuntirish xati" },
  { n: "2", title: "2-marta", body: "1 kunlik ish haqining 30%" },
  { n: "3", title: "3-marta", body: "Yana 1 kunlikning 30%" },
  { n: "4", title: "4-marta", body: "1 kunlik ish haqining 100%" },
  { n: "5", title: "5-marta", body: "1 oylikning 50% va o‘sha kuni platforma bloki" },
  { n: "6", title: "6-marta — oxirgi", body: "Yana oylikning 50%, oxirgi xat va ishdan bo‘shatishga rozilik" },
];

type JarimaKindFilter = "all" | "absent" | "late";

export function DavomatJarimaPanel({ month }: { month: string }) {
  const summary = useJarimaSummary(month);
  const data = summary.data;
  const rows = data?.rows ?? [];
  const self = data?.self;
  const people = jarimaPeople(rows.length ? rows : self ? [self] : []);
  const [kind, setKind] = React.useState<JarimaKindFilter>("all");
  const [exporting, setExporting] = React.useState<"excel" | "pdf" | null>(null);
  const shown = React.useMemo(() => filterJarimaPeople(people, kind), [people, kind]);
  const total = data?.own && kind === "all" ? self?.amount ?? 0 : shown.reduce((sum, person) => sum + person.amount, 0);
  const filterLabel = kind === "absent" ? "Kelmagan" : kind === "late" ? "Kechikkan" : "Kechikkan va kelmagan";
  const exportLines = React.useMemo(() => jarimaExportLines(shown), [shown]);
  const download = async (format: "excel" | "pdf") => {
    if (!exportLines.length || exporting) return;
    setExporting(format);
    try {
      const payload = { month, filterLabel, lines: exportLines };
      if (format === "excel") await exportJarimaExcel(payload);
      else await exportJarimaPdf(payload);
    } finally {
      setExporting(null);
    }
  };
  return (
    <section className="overflow-hidden rounded-3xl border border-rose-200/80 bg-white shadow-[0_18px_50px_-28px_rgba(159,18,57,0.55)] dark:border-rose-400/25 dark:bg-[#241018]">
      <header className="bg-[#172033] px-5 py-5 text-white sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-200">Jarima · 01.10.2026 dan</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Kechikkan va kelmagan</h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-white/70">
              Mudir, farmasevt va stajyor. Har bir qatorda kim, lavozimi, qaysi sana, nima sabab va izoh to‘liq yozilgan.
            </p>
          </div>
          <div className="min-w-[180px] rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-100">Jami jarima</p>
            <p className="mt-1 text-2xl font-bold tabular-nums leading-none">{summary.isLoading ? "…" : formatSom(total)}</p>
            <p className="mt-1.5 text-xs text-white/60">{summary.isLoading ? "Hisoblanmoqda" : `${shown.length} xodim · ${filterLabel}`}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {JARIMA_RULE_CARDS.map((rule) => (
            <div key={rule.n} className="rounded-2xl bg-white/10 px-3.5 py-3 ring-1 ring-white/10">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-400/25 text-xs font-bold text-rose-50">{rule.n}</span>
                <p className="text-sm font-semibold">{rule.title}</p>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-white/75">{rule.body}</p>
            </div>
          ))}
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 bg-rose-50/80 px-5 py-2.5 dark:border-rose-400/15 dark:bg-rose-500/10 sm:px-6">
        <p className="text-xs leading-relaxed text-slate-600 dark:text-rose-100/80">
          Kunlik ish haqi = oylik ÷ shu oyning kunlari. Tanlangan holat PDF va Excelga tushadi.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            ["all", "Hammasi"],
            ["absent", "Kelmagan"],
            ["late", "Kechikkan"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setKind(key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                kind === key
                  ? key === "absent"
                    ? "bg-rose-700 text-white"
                    : key === "late"
                      ? "bg-amber-600 text-white"
                      : "bg-[#172033] text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-white/10 dark:text-white/80 dark:ring-white/10",
              )}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={!exportLines.length || exporting != null}
            onClick={() => void download("excel")}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting === "excel" ? "Excel…" : "Excel"}
          </button>
          <button
            type="button"
            disabled={!exportLines.length || exporting != null}
            onClick={() => void download("pdf")}
            className="inline-flex items-center gap-1 rounded-full bg-[#172033] px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          >
            <FileText className="h-3.5 w-3.5" />
            {exporting === "pdf" ? "PDF…" : "PDF"}
          </button>
        </div>
      </div>
      {summary.isLoading ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : shown.length === 0 ? (
        <p className="px-5 py-8 text-sm text-slate-500 sm:px-6">
          {people.length === 0
            ? "Bu oyda jarima yo‘q. 01.10.2026 dan kechikkan va kelmagan xodimlar shu yerda chiqadi."
            : `${filterLabel} bo‘yicha yozuv yo‘q.`}
        </p>
      ) : (
        <div>
          {shown.map((person) => {
            const warning = jarimaNoteParts(person.note).warning;
            return (
              <article key={person.key} className="border-b border-slate-100 last:border-b-0 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#172033] text-sm font-bold text-white">{person.initials}</span>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-[#0f2744] dark:text-white">{person.fullName}</p>
                      <p className="text-sm text-slate-500 dark:text-rose-100/70">{person.position || "Lavozim yozilmagan"}</p>
                      <p className="text-xs text-slate-400 dark:text-white/45">{[person.branch, person.shift].filter(Boolean).join(" · ") || "Filial va smena yozilmagan"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-400/15 dark:text-amber-100">{person.late} kech</span>
                    <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800 dark:bg-rose-400/15 dark:text-rose-100">{person.absent} kelmagan</span>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", person.status === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/70")}>
                      {person.status === "approved" ? "Tasdiqlangan" : "Qoralama"}
                    </span>
                    <span className="text-base font-bold tabular-nums text-rose-700 dark:text-rose-200">{formatSom(person.amount)}</span>
                  </div>
                </div>
                {warning ? (
                  <p className="mx-5 mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-950 dark:bg-amber-400/10 dark:text-amber-100 sm:mx-6">{warning}</p>
                ) : null}
                <div className="mx-5 mb-4 overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 sm:mx-6">
                  <div className="hidden grid-cols-[9.5rem_11rem_minmax(0,1fr)_8.5rem] gap-3 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:bg-white/5 sm:grid">
                    <span>Sana</span>
                    <span>Sabab</span>
                    <span>Izoh</span>
                    <span className="text-right">Jarima</span>
                  </div>
                  {person.events.map((event) => (
                    <div key={event.key} className="grid gap-2 border-t border-slate-100 px-4 py-3 first:border-t-0 dark:border-white/10 sm:grid-cols-[9.5rem_11rem_minmax(0,1fr)_8.5rem] sm:items-start sm:gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">Sana</p>
                        <p className="text-sm font-semibold tabular-nums text-[#0f2744] dark:text-white">{event.date}</p>
                        <p className="text-xs text-slate-500 dark:text-white/50">{event.weekday}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">Sabab</p>
                        <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", event.kind === "late" ? "bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-100" : event.kind === "absent" ? "bg-rose-100 text-rose-800 dark:bg-rose-400/20 dark:text-rose-100" : "bg-slate-100 text-slate-700")}>
                          {event.reason}
                        </span>
                        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">{event.strike}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">Izoh</p>
                        <p className="text-sm leading-relaxed text-slate-600 dark:text-rose-50/80">{event.note}</p>
                      </div>
                      <div className="sm:text-right">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:hidden">Jarima</p>
                        <p className="text-sm font-bold tabular-nums text-rose-700 dark:text-rose-200">{formatSom(event.amount)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
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

const JARIMA_WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];

function formatJarimaDate(ymd: string) {
  const [year, month, day] = ymd.split("-");
  if (!year || !month || !day) return ymd || "—";
  return `${day}.${month}.${year}`;
}

function jarimaWeekday(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return "";
  return JARIMA_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] || "";
}

function jarimaInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "•";
}

function strikeLabel(n: number) {
  if (n <= 1) return "1-marta";
  if (n === 2) return "2-marta";
  if (n === 3) return "3-marta";
  return `${n}-marta`;
}

function strikeNote(n: number) {
  if (n <= 1) return "Bu oyda birinchi marta. Ogohlantirish — tushuntirish xati yoziladi.";
  if (n === 2) return "Bu oyda ikkinchi marta. 1 kunlik ish haqining 30% jarima.";
  if (n === 3) return "Bu oyda uchinchi marta. Yana 1 kunlik ish haqining 30% jarima.";
  if (n === 4) return "Bu oyda to‘rtinchi marta. 1 kunlik ish haqining 100% jarima.";
  return `Bu oyda ${n}-marta. 1 oylik ish haqining 50% jarima.`;
}

type JarimaPanelRow = {
  fullName: string;
  position?: string | null;
  branch?: string | null;
  shift?: string | null;
  amount: number;
  note: string | null;
  late: number;
  absent: number;
  status?: string;
  events?: Array<{ date: string; kind: "late" | "absent"; n: number; amount: number }>;
};

function jarimaPeople(rows: JarimaPanelRow[]) {
  return rows.map((row, index) => {
    const events = [...(row.events ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
    const built = events.length
      ? events.map((event) => ({
          key: `${row.fullName}-${event.date}-${event.n}`,
          date: formatJarimaDate(event.date),
          weekday: jarimaWeekday(event.date),
          kind: event.kind as "late" | "absent" | "mix",
          reason: event.kind === "late" ? "Kech keldi" : "Kelmagan",
          strike: strikeLabel(event.n),
          amount: event.amount,
          note: strikeNote(event.n),
        }))
      : [{
          key: `${row.fullName}-${index}-sum`,
          date: "—",
          weekday: "",
          kind: "mix" as const,
          reason: [row.late ? `${row.late} marta kech` : "", row.absent ? `${row.absent} marta kelmagan` : ""].filter(Boolean).join(", ") || "Jarima",
          strike: `${row.late + row.absent} marta`,
          amount: row.amount,
          note: jarimaNoteParts(row.note || "").reason || row.note || "—",
        }];
    return {
      key: `${row.fullName}-${index}`,
      fullName: row.fullName,
      position: row.position || "",
      branch: String(row.branch || "").trim(),
      shift: String(row.shift || "").trim(),
      initials: jarimaInitials(row.fullName),
      late: row.late,
      absent: row.absent,
      amount: row.amount,
      status: row.status || "draft",
      note: row.note || "",
      events: built,
    };
  });
}

function filterJarimaPeople<T extends { events: Array<{ kind: string; amount: number }>; late: number; absent: number; amount: number }>(
  people: T[],
  kind: "all" | "absent" | "late",
): T[] {
  if (kind === "all") return people;
  return people.flatMap((person) => {
    const events = person.events.filter((event) => event.kind === kind);
    if (!events.length) return [];
    return [{
      ...person,
      events,
      late: kind === "late" ? events.length : 0,
      absent: kind === "absent" ? events.length : 0,
      amount: events.reduce((sum, event) => sum + event.amount, 0),
    }];
  });
}

function jarimaExportLines(people: Array<{
  fullName: string;
  branch: string;
  shift: string;
  events: Array<{ date: string; weekday: string; reason: string; amount: number }>;
}>): JarimaExportLine[] {
  return people.flatMap((person) =>
    person.events.map((event) => ({
      fullName: person.fullName,
      branch: person.branch || "—",
      shift: person.shift || "—",
      date: event.date,
      weekday: event.weekday,
      status: event.reason,
      amount: event.amount,
    })),
  );
}

function jarimaNoteParts(note: string): { reason: string; warning: string } {
  const mark = "Ogohlantirish:";
  const idx = note.indexOf(mark);
  if (idx < 0) return { reason: note, warning: "" };
  return {
    reason: note.slice(0, idx).trim().replace(/\.\s*$/, ""),
    warning: note.slice(idx).trim(),
  };
}

function PayLine({
  row,
  month,
  canEdit,
  canApprove,
  view,
  save,
  onSaveDay,
  onApprove,
  onCancel,
  selected,
  onToggle,
}: {
  row: PayrollRow;
  month: string;
  canEdit: boolean;
  canApprove: boolean;
  view: PayrollSlice;
  save: ReturnType<typeof useSaveOylikLine>;
  onSaveDay?: (salary: number, jarima: number, note: string) => void;
  onApprove?: () => void;
  onCancel?: () => void;
  selected: boolean;
  onToggle: () => void;
}) {
  const [salary, setSalary] = React.useState(row.salary ?? 0);
  const [jarima, setJarima] = React.useState(row.jarima ?? 0);
  const [note, setNote] = React.useState(row.jarimaNote || "");
  React.useEffect(() => {
    setSalary(view.dayStatus === "summary" ? (row.salary ?? 0) : view.salary);
    setJarima(view.jarima);
    setNote(view.dayStatus === "summary" ? (row.jarimaNote || "") : view.note);
  }, [row.userId, row.salary, row.jarimaNote, view.salary, view.jarima, view.note, view.dayStatus]);

  const persist = (nextSalary: number, nextJarima: number, nextNote: string) => {
    if (!canEdit || !row.userId) return;
    if (view.dayStatus !== "summary") {
      onSaveDay?.(nextSalary, nextJarima, nextNote);
      return;
    }
    save.mutate({
      userId: row.userId,
      employeeId: row.employeeId,
      month,
      salary: nextSalary,
      jarima: row.jarima ?? 0,
      note: row.jarimaNote || "",
    });
  };

  const shownSalary = view.editSalary ? salary : view.salary;
  const shownJarima = view.editJarima ? jarima : view.jarima;
  const net = shownSalary - shownJarima;
  const parts = jarimaNoteParts(view.readOnly ? view.note : note);
  const autoNote = !view.readOnly && Boolean(parts.warning);
  return (
    <tr className={cn("border-b border-border/60", selected && "bg-sky-50/70 dark:bg-sky-500/10")}>
      <td className="px-2 py-2">
        <input type="checkbox" className="h-4 w-4 accent-[#0b3a5c]" checked={selected} disabled={!row.userId} onChange={onToggle} />
      </td>
      <td className="px-3 py-2">
        <p className="truncate font-semibold text-foreground">{row.fullName}</p>
        <p className="truncate text-[11px] text-muted-foreground">{row.roleLabel}</p>
      </td>
      <td className="px-2 py-2 text-muted-foreground">
        <span className="block truncate">{row.position || "—"}</span>
        {cleanBranch(row.branch) ? <span className="block truncate text-[11px]">{cleanBranch(row.branch)}</span> : null}
      </td>
      <td className="px-2 py-2 text-right">
        {!view.editSalary ? (
          <span className="tabular-nums font-semibold">{shownSalary.toLocaleString("ru-RU")}</span>
        ) : (
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
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {!view.editJarima ? (
          <span className={cn("tabular-nums font-semibold", shownJarima > 0 && "text-rose-700")}>{shownJarima.toLocaleString("ru-RU")}</span>
        ) : (
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
        )}
      </td>
      <td className="px-2 py-2">
        {!view.editNote ? (
          <span className={cn("text-sm", !view.note || view.note === "Jarima yo‘q" ? "text-muted-foreground" : "font-medium text-foreground")}>{view.note || "—"}</span>
        ) : (
          <div className="flex min-w-0 items-start gap-1.5">
            <input
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-sm"
              value={autoNote ? parts.reason : note}
              title={note || "Sabab"}
              disabled={!canEdit}
              placeholder="Sabab"
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (note === (row.jarimaNote || "")) return;
                persist(salary, jarima, note);
              }}
            />
            {parts.warning ? (
              <span className="max-w-[220px] shrink-0 rounded-md bg-amber-100 px-1.5 py-1 text-[10px] font-semibold leading-tight text-amber-900 dark:bg-amber-400/15 dark:text-amber-100">
                {parts.warning}
              </span>
            ) : null}
          </div>
        )}
      </td>
      <td className={cn("px-2 py-2 text-right font-bold tabular-nums", net < 0 ? "text-rose-700" : "text-foreground")}>
        {formatSom(net)}
      </td>
      <td className="px-2 py-2">
        {view.dayStatus === "summary" ? (
          <span className="flex flex-col gap-1">
            {view.returnedLabel.split(" · ").filter(Boolean).map((part) => (
              <span key={part} className="w-fit rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-200">
                {part}
              </span>
            ))}
          </span>
        ) : (
          <div className="flex flex-col items-start gap-1.5">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold text-white",
                view.dayStatus === "approved" && "bg-emerald-600",
                view.dayStatus === "returned" && "bg-rose-600",
                view.dayStatus === "draft" && "bg-amber-500",
              )}
            >
              {view.dayStatus === "approved" ? "Tasdiqlangan" : view.dayStatus === "returned" ? "Bekor qilingan" : "Tasdiqlanmagan"}
            </span>
            {canApprove && view.dayStatus !== "approved" && row.userId ? (
              <button
                type="button"
                onClick={onApprove}
                className="h-7 rounded-lg bg-[#0b3a5c] px-2.5 text-[11px] font-semibold text-white hover:bg-[#0b3a5c]/90"
              >
                Tasdiqlash
              </button>
            ) : null}
            {canApprove && view.dayStatus === "approved" && row.userId ? (
              <button
                type="button"
                onClick={onCancel}
                className="h-7 rounded-lg border border-rose-300 px-2.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
              >
                Bekor qilish
              </button>
            ) : null}
            {view.dirty ? <span className="text-[10px] font-semibold text-amber-700">Yangilash kerak</span> : null}
          </div>
        )}
      </td>
    </tr>
  );
}

export function PayTable({
  rows,
  month,
  canEdit,
  canApprove,
  moneyLabel,
  present,
  onSaveDay,
  onApprove,
  onCancel,
  selected,
  onToggle,
  onTogglePage,
}: {
  rows: PayrollRow[];
  month: string;
  canEdit: boolean;
  canApprove?: boolean;
  moneyLabel: string;
  present: (row: PayrollRow) => PayrollSlice;
  onSaveDay?: (row: PayrollRow, salary: number, jarima: number, note: string) => void;
  onApprove?: (row: PayrollRow) => void;
  onCancel?: (row: PayrollRow) => void;
  selected: number[];
  onToggle: (userId: number) => void;
  onTogglePage: (userIds: number[], on: boolean) => void;
}) {
  const save = useSaveOylikLine();
  const ids = rows.map((r) => r.userId).filter((id): id is number => Boolean(id));
  const selectedSet = new Set(selected);
  const allOn = ids.length > 0 && ids.every((id) => selectedSet.has(id));
  if (!rows.length) {
    return <div className="dept-empty">Bu tanlovda xodim topilmadi.</div>;
  }

  return (
    <div className="dept-data-table">
      <div className="max-h-[min(70vh,720px)] overflow-auto">
        <table className="w-full min-w-[920px] table-fixed border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-[#0b3a5c] text-white dark:bg-slate-800/95 dark:text-slate-100">
            <tr className="text-left">
              <th className="w-10 px-2 py-2">
                <input type="checkbox" className="h-4 w-4 accent-white" checked={allOn} onChange={() => onTogglePage(ids, !allOn)} />
              </th>
              <th className="w-[22%] px-3 py-2 font-semibold">Xodim</th>
              <th className="w-[20%] px-2 py-2 font-semibold">Lavozim</th>
              <th className="w-36 px-2 py-2 text-right font-semibold">{moneyLabel}</th>
              <th className="w-36 px-2 py-2 text-right font-semibold">Jarima</th>
              <th className="px-2 py-2 font-semibold">Izoh</th>
              <th className="w-28 px-2 py-2 text-right font-semibold">Qo‘lda qoladi</th>
              <th className="w-40 px-2 py-2 font-semibold">Holat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PayLine
                key={payrollRowKey(row)}
                row={row}
                month={month}
                canEdit={canEdit}
                canApprove={Boolean(canApprove)}
                view={present(row)}
                save={save}
                onSaveDay={(salary, jarima, note) => onSaveDay?.(row, salary, jarima, note)}
                onApprove={() => onApprove?.(row)}
                onCancel={() => onCancel?.(row)}
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

function dayCellTone(status: string, jarima: number): string {
  if (status === "returned") return "border-rose-300 bg-rose-50 text-rose-900";
  if (status === "approved") return "border-emerald-300 bg-emerald-50 text-emerald-950";
  if (jarima > 0) return "border-amber-300 bg-amber-50 text-amber-950";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function dayStatusWord(status: string): string {
  if (status === "approved") return "Tasdiq";
  if (status === "returned") return "Bekor";
  return "Kutiladi";
}

export function WeekBoard({
  rows,
  month,
  from,
  to,
  scope,
  onOpenDay,
}: {
  rows: PayrollRow[];
  month: string;
  from: string;
  to: string;
  scope: "hafta" | "oy";
  onOpenDay: (day: string) => void;
}) {
  const dates = React.useMemo(() => datesFromTo(from, to), [from, to]);
  const dense = scope === "oy";
  const grid = React.useMemo(
    () => rows.map((row) => dates.map((date) => resolveDay(row, month, date))),
    [rows, month, dates],
  );
  const dayTotals = dates.map((_, index) =>
    grid.reduce(
      (sum, cells) => {
        const cell = cells[index];
        sum.salary += cell?.salary ?? 0;
        sum.jarima += cell?.jarima ?? 0;
        if (cell?.status === "approved") sum.approved += 1;
        else if (cell?.status === "returned") sum.returned += 1;
        else sum.waiting += 1;
        return sum;
      },
      { salary: 0, jarima: 0, approved: 0, returned: 0, waiting: 0 },
    ),
  );
  const jarimaTotal = dayTotals.reduce((sum, total) => sum + total.jarima, 0);
  if (!rows.length) return <div className="dept-empty">Bu tanlovda xodim topilmadi.</div>;

  return (
    <div className="dept-data-table">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b bg-card px-3 py-2 text-[11px] font-semibold">
        <span className="text-slate-400">Holat:</span>
        <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200"><span className="h-3 w-3 rounded border border-amber-300 bg-amber-50" /> Kutiladi</span>
        <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200"><span className="h-3 w-3 rounded border border-emerald-300 bg-emerald-50" /> Tasdiqlangan</span>
        <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200"><span className="h-3 w-3 rounded border border-rose-300 bg-rose-50" /> Bekor (jarima 0)</span>
        <span className="text-slate-400">Katakda:</span>
        <span className="text-blue-700">kunlik</span>
        <span className="text-emerald-700">qo‘lda qoladi</span>
        <span className="text-rose-600">−jarima</span>
        <span className="ml-auto font-medium text-muted-foreground">Kunni bossangiz — o‘sha kun ochiladi</span>
      </div>
      <div className="max-h-[min(70vh,720px)] overflow-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-left text-[12px]">
          <thead className="sticky top-0 z-50 bg-[#0b3a5c] text-white">
            <tr>
              <th className="sticky top-0 left-0 z-50 w-11 min-w-11 max-w-11 bg-[#0b3a5c] !px-0 py-2 text-center font-semibold">№</th>
              <th className="sticky top-0 left-11 z-50 min-w-[200px] bg-[#0b3a5c] px-3 py-2 font-semibold shadow-[6px_0_10px_-6px_rgba(0,0,0,0.45)]">Xodim</th>
              {dates.map((date) => (
                <th key={date} className="sticky top-0 z-50 bg-[#0b3a5c] px-1 py-2 text-center font-semibold">
                  <button type="button" onClick={() => onOpenDay(date)} className="rounded-lg px-1.5 py-1 hover:bg-white/10">
                    <span className="block text-base font-bold leading-none tabular-nums">{Number(date.slice(8, 10))}</span>
                    <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-white/70">{weekdayShort(date)}</span>
                  </button>
                </th>
              ))}
              <th className="sticky top-0 right-0 z-50 min-w-[128px] bg-[#7f1d1d] px-3 py-2 text-right font-semibold">Jarima</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const cells = grid[rowIndex] ?? [];
              const jarima = cells.reduce((sum, cell) => sum + cell.jarima, 0);
              const net = cells.reduce((sum, cell) => sum + cell.salary - cell.jarima, 0);
              const finedDays = cells.filter((cell) => cell.jarima > 0).length;
              return (
                <tr key={payrollRowKey(row)} className="border-b border-border/60">
                  <td className="sticky left-0 z-10 w-11 min-w-11 max-w-11 bg-white !px-0 py-2 text-center text-sm font-semibold tabular-nums text-slate-500 dark:bg-slate-950">{rowIndex + 1}</td>
                  <td className="sticky left-11 z-10 min-w-[200px] bg-white px-3 py-2 shadow-[6px_0_10px_-6px_rgba(15,23,42,0.28)] dark:bg-slate-950">
                    <p className="truncate font-semibold">{row.fullName}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{row.position || row.roleLabel}</p>
                  </td>
                  {cells.map((cell, index) => {
                    const left = cell.salary - cell.jarima;
                    return (
                    <td key={dates[index]} className="relative z-0 !px-1 !py-1 align-top">
                      <button
                        type="button"
                        title={`${dayStatusWord(cell.status)}${cell.note ? ` · ${cell.note}` : ""}`}
                        onClick={() => onOpenDay(dates[index])}
                        className={cn(
                          "flex flex-col items-center justify-center gap-0.5 rounded-xl border px-1.5 py-1.5 text-center",
                          dense ? "h-[92px] w-[108px]" : "h-[108px] w-[128px]",
                          dayCellTone(cell.status, cell.jarima),
                        )}
                      >
                        <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{dayStatusWord(cell.status)}</span>
                        <span className="whitespace-nowrap text-[12px] font-semibold tabular-nums leading-none text-blue-700">{cell.salary.toLocaleString("ru-RU")}</span>
                        <span className="whitespace-nowrap text-[13px] font-bold tabular-nums leading-none text-emerald-700">{left.toLocaleString("ru-RU")}</span>
                        <span className={cn("whitespace-nowrap text-[12px] font-semibold tabular-nums leading-none", cell.jarima > 0 ? "text-rose-600" : "text-slate-400")}>
                          −{cell.jarima.toLocaleString("ru-RU")}
                        </span>
                      </button>
                    </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 bg-rose-50 px-3 py-2 text-right dark:bg-[#2a1520]">
                    <p className={cn("text-sm font-bold tabular-nums", jarima > 0 ? "text-rose-700" : "text-slate-500")}>{formatSom(jarima)}</p>
                    <p className="text-[11px] font-semibold tabular-nums text-foreground">{formatSom(net)}</p>
                    <p className="text-[10px] text-muted-foreground">{finedDays} kun jarima</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-20 bg-slate-50 text-[11px] dark:bg-slate-900">
            <tr>
              <td className="sticky left-0 z-20 w-11 min-w-11 max-w-11 bg-slate-50 !px-0 dark:bg-slate-900" />
              <td className="sticky left-11 z-20 min-w-[200px] bg-slate-50 px-3 py-2 font-semibold shadow-[6px_0_10px_-6px_rgba(15,23,42,0.28)] dark:bg-slate-900">{scope === "oy" ? "Shu oy" : "Shu hafta"}</td>
              {dayTotals.map((total, index) => (
                <td key={dates[index]} className="px-1 py-2 text-center">
                  <p className="font-semibold tabular-nums text-rose-700">{total.jarima > 0 ? total.jarima.toLocaleString("ru-RU") : "0"}</p>
                  <p className="text-emerald-800 tabular-nums">{total.approved} tasdiq</p>
                  <p className="text-amber-800 tabular-nums">{total.waiting} kutiladi</p>
                </td>
              ))}
              <td className="sticky right-0 z-10 bg-rose-100 px-3 py-2 text-right font-bold tabular-nums text-rose-800 dark:bg-[#3a1520]">
                {formatSom(jarimaTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}