import React from "react";
import { AlertTriangle, CalendarX2, Clock3, Download, FileText, Gavel, Search, ShieldCheck, Users, Wallet } from "lucide-react";
import { exportJarimaExcel, exportJarimaPdf, type JarimaExportLine } from "@/lib/jarima-export";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatSom, monthLabelUz, useJarimaSummary, type JarimaSelf } from "@/lib/oylik-api";
import { useI18n } from "@/i18n/I18nProvider";
import { StaffGroupTabs, staffGroupOf, type StaffGroup } from "@/components/explanation-letter/StaffGroupTabs";
import { jarimaNoteParts } from "./pay-table";

const JARIMA_RULES = [
  { n: 1, body: "Ogohlantirish va tushuntirish xati" },
  { n: 2, body: "1 kunlik ish haqining 30%" },
  { n: 3, body: "Yana 1 kunlikning 30%" },
  { n: 4, body: "1 kunlik ish haqining 100%" },
  { n: 5, body: "Oylikning 50% va platforma bloki" },
  { n: 6, body: "Yana 50%, oxirgi xat, bo‘shatishga rozilik" },
];

const GROUP_META: Record<StaffGroup, { title: string; who: string; start: string }> = {
  pharmacy: { title: "Dorixona xodimlari", who: "Mudir, farmasevt va stajyor", start: "12.10.2026" },
  office: { title: "Ofis xodimlari", who: "Ofis, ombor, ta’minot va boshqa bo‘limlar", start: "16.10.2026" },
};

type KindFilter = "all" | "absent" | "late";

export function DavomatJarimaPanel({ month }: { month: string }) {
  const { locale } = useI18n();
  const summary = useJarimaSummary(month);
  const data = summary.data;
  const rows = data?.rows ?? [];
  const self = data?.self;
  const own = Boolean(data?.own);
  const people = React.useMemo(() => jarimaPeople(rows.length ? rows : self ? [self] : []), [rows, self]);
  const [group, setGroup] = React.useState<StaffGroup>("pharmacy");
  const [kind, setKind] = React.useState<KindFilter>("all");
  const [query, setQuery] = React.useState("");
  const [exporting, setExporting] = React.useState<"excel" | "pdf" | null>(null);

  const groupCounts = React.useMemo(() => {
    const out: Record<StaffGroup, number> = { pharmacy: 0, office: 0 };
    for (const p of people) out[p.group] += 1;
    return out;
  }, [people]);
  const activeGroup: StaffGroup = own && people[0] ? people[0].group : group;
  const inGroup = React.useMemo(() => people.filter((p) => p.group === activeGroup), [people, activeGroup]);
  const kindCounts = React.useMemo(
    () => ({
      all: inGroup.reduce((s, p) => s + p.events.length, 0),
      late: inGroup.reduce((s, p) => s + p.events.filter((e) => e.kind === "late").length, 0),
      absent: inGroup.reduce((s, p) => s + p.events.filter((e) => e.kind === "absent").length, 0),
    }),
    [inGroup],
  );
  const shown = React.useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("uz");
    const byKind = filterJarimaPeople(inGroup, kind);
    if (!needle) return byKind;
    return byKind.filter((p) => `${p.fullName} ${p.position} ${p.branch} ${p.shift}`.toLocaleLowerCase("uz").includes(needle));
  }, [inGroup, kind, query]);

  const total = own && kind === "all" ? self?.amount ?? 0 : shown.reduce((sum, p) => sum + p.amount, 0);
  const events = shown.reduce((s, p) => s + p.events.length, 0);
  const meta = GROUP_META[activeGroup];
  const kindLabel = kind === "absent" ? "Kelmagan" : kind === "late" ? "Kechikkan" : "Kechikkan va kelmagan";
  const exportLines = React.useMemo(() => jarimaExportLines(shown), [shown]);

  const download = async (format: "excel" | "pdf") => {
    if (!exportLines.length || exporting) return;
    setExporting(format);
    try {
      const payload = { month, filterLabel: `${meta.title} · ${kindLabel}`, lines: exportLines };
      if (format === "excel") await exportJarimaExcel(payload);
      else await exportJarimaPdf(payload);
    } finally {
      setExporting(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_60px_-36px_rgba(15,39,68,0.55)] dark:border-white/10 dark:bg-slate-950">
      <header className="relative overflow-hidden bg-gradient-to-br from-[#0f2744] via-[#14305a] to-[#3b1530] px-5 pb-5 pt-5 text-white sm:px-6">
        <span className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-rose-500/25 blur-3xl" />
        <span className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-sky-400/15 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <Gavel className="h-6 w-6 text-rose-200" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-200/90">
                Jarima · {monthLabelUz(month, locale)}
              </p>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">Kechikkan va kelmagan xodimlar</h2>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-white/65">
                {meta.who}. Hisob {meta.start} dan boshlanadi — har bir holat sana, sabab va summasi bilan.
              </p>
            </div>
          </div>
          <div className="min-w-[200px] rounded-2xl bg-white/[0.08] px-4 py-3 ring-1 ring-white/15 backdrop-blur">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-rose-100/90">Jami jarima</p>
            <p className="mt-1 text-[26px] font-extrabold tabular-nums leading-none">{summary.isLoading ? "…" : formatSom(total)}</p>
            <p className="mt-1.5 text-xs text-white/60">{summary.isLoading ? "Hisoblanmoqda" : `${shown.length} xodim · ${events} holat`}</p>
          </div>
        </div>

        {own ? null : (
          <StaffGroupTabs
            value={group}
            onChange={setGroup}
            counts={summary.isLoading ? undefined : groupCounts}
            tone="dark"
            className="relative mt-5 sm:max-w-xl"
          />
        )}

        <ol className="relative mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">
          {JARIMA_RULES.map((rule) => (
            <li key={rule.n} className="flex items-start gap-2 rounded-xl bg-white/[0.06] px-2.5 py-2 ring-1 ring-white/10">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-extrabold",
                  rule.n === 1 ? "bg-sky-400/25 text-sky-50" : rule.n < 5 ? "bg-amber-400/25 text-amber-50" : "bg-rose-500/35 text-rose-50",
                )}
              >
                {rule.n}
              </span>
              <p className="text-[11.5px] leading-snug text-white/80">{rule.body}</p>
            </li>
          ))}
        </ol>
      </header>

      <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-6 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="inline-flex w-full rounded-xl bg-white p-1 ring-1 ring-slate-200 sm:w-auto dark:bg-slate-900 dark:ring-white/10">
          {(
            [
              ["all", "Hammasi", kindCounts.all, null],
              ["late", "Kechikkan", kindCounts.late, Clock3],
              ["absent", "Kelmagan", kindCounts.absent, CalendarX2],
            ] as const
          ).map(([key, label, count, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setKind(key)}
              className={cn(
                "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:flex-none",
                kind === key
                  ? key === "absent"
                    ? "bg-rose-600 text-white shadow-sm"
                    : key === "late"
                      ? "bg-amber-500 text-white shadow-sm"
                      : "bg-[#0f2744] text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5",
              )}
            >
              {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
              {label}
              <span className={cn("rounded-full px-1.5 text-[10px] font-bold tabular-nums", kind === key ? "bg-white/25" : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300")}>
                {count}
              </span>
            </button>
          ))}
        </div>
        {own ? null : (
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ism, filial yoki lavozim…"
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:focus:ring-sky-500/20"
            />
          </label>
        )}
        <div className="flex gap-1.5 sm:ml-auto">
          <button
            type="button"
            disabled={!exportLines.length || exporting != null}
            onClick={() => void download("excel")}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-40 sm:flex-none"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting === "excel" ? "Excel…" : "Excel"}
          </button>
          <button
            type="button"
            disabled={!exportLines.length || exporting != null}
            onClick={() => void download("pdf")}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0f2744] px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0f2744]/90 disabled:opacity-40 sm:flex-none"
          >
            <FileText className="h-3.5 w-3.5" />
            {exporting === "pdf" ? "PDF…" : "PDF"}
          </button>
        </div>
      </div>

      {summary.isLoading ? (
        <div className="space-y-3 p-5 sm:p-6">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : summary.isError ? (
        <p className="m-5 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{(summary.error as Error).message}</p>
      ) : (
        <div className="space-y-4 p-4 sm:p-6">
          {own ? null : (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat icon={Users} label="Xodim" value={String(shown.length)} tone="slate" />
              <Stat icon={Clock3} label="Kechikish" value={String(shown.reduce((s, p) => s + p.events.filter((e) => e.kind === "late").length, 0))} tone="amber" />
              <Stat icon={CalendarX2} label="Kelmagan" value={String(shown.reduce((s, p) => s + p.events.filter((e) => e.kind === "absent").length, 0))} tone="rose" />
              <Stat icon={Wallet} label="Jarima summasi" value={formatSom(total)} tone="navy" />
            </div>
          )}

          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 px-4 py-12 text-center dark:border-white/10">
              <ShieldCheck className="h-9 w-9 text-emerald-500" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {query.trim()
                  ? "Qidiruv bo‘yicha xodim topilmadi"
                  : inGroup.length === 0
                    ? `${meta.title}da bu oy jarima yo‘q`
                    : `${kindLabel} bo‘yicha yozuv yo‘q`}
              </p>
              <p className="max-w-md text-xs text-slate-500">
                {meta.start} dan boshlab kechikkan va kelmagan {meta.title.toLocaleLowerCase("uz")} shu yerda avtomatik chiqadi.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {shown.map((person) => (
                <PersonCard key={person.key} person={person} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: string; tone: "slate" | "amber" | "rose" | "navy" }) {
  const tones = {
    slate: "bg-slate-50 text-slate-800 ring-slate-200 dark:bg-white/5 dark:text-white dark:ring-white/10",
    amber: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/25",
    rose: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-500/25",
    navy: "bg-[#0f2744] text-white ring-[#0f2744] dark:bg-sky-500/15 dark:text-sky-50 dark:ring-sky-500/25",
  } as const;
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl px-3.5 py-3 ring-1", tones[tone])}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 ring-1 ring-black/5 dark:bg-white/10">
        <Icon className={cn("h-4 w-4", tone === "navy" ? "text-[#0f2744] dark:text-sky-100" : "")} />
      </span>
      <div className="min-w-0">
        <p className="text-[10.5px] font-bold uppercase tracking-wide opacity-70">{label}</p>
        <p className="truncate text-lg font-extrabold tabular-nums leading-tight">{value}</p>
      </div>
    </div>
  );
}

type Person = ReturnType<typeof jarimaPeople>[number];

function PersonCard({ person }: { person: Person }) {
  const warning = jarimaNoteParts(person.note).warning;
  const approved = person.status === "approved";
  const place = [person.branch, person.shift].filter(Boolean).join(" · ");
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-sm",
              person.group === "office" ? "bg-[#0b3a5c]" : "bg-emerald-700",
            )}
          >
            {person.initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-[#0f2744] dark:text-white">{person.fullName}</p>
            <p className="truncate text-[12.5px] text-slate-500 dark:text-slate-400">
              {person.position || "Lavozim yozilmagan"}
              {place ? <span className="text-slate-400 dark:text-slate-500"> · {place}</span> : null}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {person.late ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-900 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-100 dark:ring-amber-400/25">
              <Clock3 className="h-3 w-3" /> {person.late} kech
            </span>
          ) : null}
          {person.absent ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-800 ring-1 ring-rose-200 dark:bg-rose-400/10 dark:text-rose-100 dark:ring-rose-400/25">
              <CalendarX2 className="h-3 w-3" /> {person.absent} kelmagan
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-bold ring-1",
              approved
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-500/25"
                : "bg-slate-50 text-slate-600 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10",
            )}
          >
            {approved ? "Tasdiqlangan" : "Qoralama"}
          </span>
          <span className="ml-1 rounded-xl bg-rose-600 px-3 py-1 text-sm font-extrabold tabular-nums text-white shadow-sm">{formatSom(person.amount)}</span>
        </div>
      </div>
      {warning ? (
        <p className="mx-4 mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-950 ring-1 ring-amber-200/70 dark:bg-amber-400/10 dark:text-amber-100 dark:ring-amber-400/20">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {warning}
        </p>
      ) : null}
      <div className="border-t border-slate-100 dark:border-white/10">
        <div className="hidden grid-cols-[8.5rem_10rem_minmax(0,1fr)_8rem] gap-3 bg-slate-50/80 px-4 py-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400 sm:grid dark:bg-white/[0.03]">
          <span>Sana</span>
          <span>Sabab</span>
          <span>Izoh</span>
          <span className="text-right">Jarima</span>
        </div>
        {person.events.map((event) => (
          <div
            key={event.key}
            className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 border-t border-slate-100 px-4 py-2.5 first:border-t-0 sm:grid-cols-[8.5rem_10rem_minmax(0,1fr)_8rem] sm:items-center dark:border-white/5"
          >
            <div>
              <p className="text-[13px] font-bold tabular-nums text-[#0f2744] dark:text-white">{event.date}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{event.weekday}</p>
            </div>
            <div className="sm:order-none">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                  event.kind === "late"
                    ? "bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-100"
                    : event.kind === "absent"
                      ? "bg-rose-100 text-rose-800 dark:bg-rose-400/20 dark:text-rose-100"
                      : "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200",
                )}
              >
                {event.kind === "late" ? <Clock3 className="h-3 w-3" /> : event.kind === "absent" ? <CalendarX2 className="h-3 w-3" /> : null}
                {event.reason}
              </span>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{event.strike}</p>
            </div>
            <p className="col-span-2 text-[12.5px] leading-relaxed text-slate-600 sm:col-span-1 dark:text-slate-300">{event.note}</p>
            <p
              className={cn(
                "col-start-2 row-start-1 text-right text-[13px] font-extrabold tabular-nums sm:col-start-auto sm:row-start-auto",
                event.amount > 0 ? "text-rose-700 dark:text-rose-300" : "text-slate-400",
              )}
            >
              {formatSom(event.amount)}
            </p>
          </div>
        ))}
      </div>
    </article>
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

function strikeNote(n: number) {
  if (n <= 1) return "Bu oyda birinchi marta. Ogohlantirish — tushuntirish xati yoziladi.";
  if (n === 2) return "Bu oyda ikkinchi marta. 1 kunlik ish haqining 30% jarima.";
  if (n === 3) return "Bu oyda uchinchi marta. Yana 1 kunlik ish haqining 30% jarima.";
  if (n === 4) return "Bu oyda to‘rtinchi marta. 1 kunlik ish haqining 100% jarima.";
  return `Bu oyda ${n}-marta. 1 oylik ish haqining 50% jarima.`;
}

function jarimaPeople(rows: JarimaSelf[]) {
  return rows.map((row, index) => {
    const events = [...(row.events ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
    const built = events.length
      ? events.map((event) => ({
          key: `${row.fullName}-${event.date}-${event.n}`,
          date: formatJarimaDate(event.date),
          weekday: jarimaWeekday(event.date),
          kind: event.kind as "late" | "absent" | "mix",
          reason: event.kind === "late" ? "Kech keldi" : "Kelmagan",
          strike: `${Math.max(1, event.n)}-marta`,
          amount: event.amount,
          note: strikeNote(event.n),
        }))
      : [
          {
            key: `${row.fullName}-${index}-sum`,
            date: "—",
            weekday: "",
            kind: "mix" as const,
            reason: [row.late ? `${row.late} marta kech` : "", row.absent ? `${row.absent} marta kelmagan` : ""].filter(Boolean).join(", ") || "Jarima",
            strike: `${row.late + row.absent} marta`,
            amount: row.amount,
            note: jarimaNoteParts(row.note || "").reason || row.note || "—",
          },
        ];
    return {
      key: `${row.fullName}-${index}`,
      group: staffGroupOf(row),
      fullName: row.fullName,
      position: row.position || "",
      branch: String(row.branch || "").trim().replace(/^—$/, ""),
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
  kind: KindFilter,
): T[] {
  if (kind === "all") return people;
  return people.flatMap((person) => {
    const events = person.events.filter((event) => event.kind === kind);
    if (!events.length) return [];
    return [
      {
        ...person,
        events,
        late: kind === "late" ? events.length : 0,
        absent: kind === "absent" ? events.length : 0,
        amount: events.reduce((sum, event) => sum + event.amount, 0),
      },
    ];
  });
}

function jarimaExportLines(
  people: Array<{ fullName: string; branch: string; shift: string; events: Array<{ date: string; weekday: string; reason: string; amount: number }> }>,
): JarimaExportLine[] {
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
