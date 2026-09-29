import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { qrPngDataUrl } from "../../lib/qr-render";
import { formatSealWhen, formatYmd, PLATFORM_START, type XodimDay, type XodimDayStatus, type XodimReport, type XodimTaskItem } from "../../lib/xodim-hisobot-api";

const STATUS_STYLE: Record<XodimDayStatus, string> = {
  present: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  late: "bg-amber-50 text-amber-900 ring-amber-200",
  absent: "bg-rose-50 text-rose-800 ring-rose-200",
  incomplete: "bg-sky-50 text-sky-900 ring-sky-200",
  leave: "bg-violet-50 text-violet-800 ring-violet-200",
  planned: "bg-slate-100 text-slate-600 ring-slate-200",
  rest: "bg-slate-100 text-slate-600 ring-slate-200",
};

const DAY_GRID = "104px 108px 124px 72px 72px minmax(132px,1fr)";
const JAVOB_GRID = "76px 92px minmax(0,0.8fr) minmax(0,1fr) minmax(0,1fr)";

type FlowAtom = {
  key: string;
  title: string;
  table?: "day" | "javob";
  stick?: boolean;
  node: ReactNode;
};

function samePages(a: number[][] | null, b: number[][]) {
  if (!a || a.length !== b.length) return false;
  return a.every((page, i) => page.length === b[i]!.length && page.every((n, j) => n === b[i]![j]));
}

function measureEl(className: string, html: string, width = "210mm") {
  const el = document.createElement("div");
  el.className = className;
  el.style.cssText = `position:absolute;left:-12000px;top:0;width:${width};`;
  el.innerHTML = html;
  document.body.appendChild(el);
  const h = el.offsetHeight;
  el.remove();
  return h;
}

function measureMm(height: string) {
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;left:-12000px;top:0;width:210mm;height:${height};`;
  document.body.appendChild(el);
  const h = el.getBoundingClientRect().height;
  el.remove();
  return h;
}

function measureGap() {
  const el = document.createElement("div");
  el.className = "flex flex-col gap-3";
  el.style.cssText = "position:absolute;left:-12000px;top:0;width:80px;";
  const a = document.createElement("div");
  const b = document.createElement("div");
  a.style.height = "8px";
  b.style.height = "8px";
  el.append(a, b);
  document.body.appendChild(el);
  const h = el.offsetHeight - 16;
  el.remove();
  return Math.max(0, h);
}

function packAtoms(atoms: FlowAtom[], heights: number[], limit: number, gapPx: number, headPx: number) {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  const cost = (index: number, page: number[]) => {
    const atom = atoms[index]!;
    const prev = page.length ? atoms[page[page.length - 1]!] : undefined;
    const same = Boolean(atom.table && prev?.table === atom.table);
    const gap = page.length === 0 || same ? 0 : gapPx;
    const head = atom.table && !same ? headPx : 0;
    return (heights[index] ?? 0) + gap + head;
  };
  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i]!;
    if (atom.stick && i + 1 < atoms.length && cur.length) {
      const headCost = cost(i, cur);
      const nextCost = cost(i + 1, [...cur, i]);
      if (used + headCost + nextCost > limit) {
        pages.push(cur);
        cur = [];
        used = 0;
      }
    }
    if (cur.length && used + cost(i, cur) > limit) {
      pages.push(cur);
      cur = [];
      used = 0;
    }
    used += cost(i, cur);
    cur.push(i);
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

function usePackedPages(atoms: FlowAtom[]) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [indexes, setIndexes] = useState<number[][] | null>(null);

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-atom]")];
    if (nodes.length !== atoms.length) return;
    const pageH = Math.max(measureMm("297mm"), 980);
    const headH = measureEl(
      "flex items-start justify-between gap-3 px-6 py-3",
      `<div><p class="text-[10px] font-bold tracking-[0.16em]">VAKSINA MED HR</p><p class="text-sm font-semibold">Shaxsiy ma'lumot · 07.09.2026 — 29.09.2026 · davomi</p></div><p class="shrink-0 rounded-full px-3 py-1 text-xs font-semibold">List 1 / 1</p>`,
    );
    const footH = measureEl(
      "flex items-center justify-between border-t border-slate-200 px-6 py-2 text-[11px]",
      "<span>01.09.2026 dan · A4 list</span><span>List 1 / 1</span>",
    );
    const padH = measureEl("px-6 py-5", "");
    const gapPx = measureGap();
    const headPx = measureEl("bg-slate-50 px-2 py-2 text-[11px] font-semibold uppercase", "Sana", "160mm") + 2;
    const limit = Math.max(320, pageH - headH - footH - padH - 16);
    const next = packAtoms(atoms, nodes.map((node) => node.offsetHeight), limit, gapPx, headPx);
    setIndexes((prev) => (samePages(prev, next) ? prev : next));
  }, [atoms]);

  return { measureRef, pages: indexes ?? [atoms.map((_, i) => i)] };
}

function BlockTitle({ title, count, tone }: { title: string; count: string; tone: string }) {
  return (
    <div className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${tone}`}>
      <p className="text-sm font-semibold tracking-wide">{title}</p>
      <p className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">{count}</p>
    </div>
  );
}

const ROW_TONE: Record<XodimDayStatus, string> = {
  present: "bg-white",
  late: "bg-amber-50/80",
  absent: "bg-rose-50/70",
  incomplete: "bg-sky-50/80",
  leave: "bg-violet-50/80",
  planned: "bg-slate-50",
  rest: "bg-slate-50",
};

function hoursLabel(day: XodimDay) {
  if (day.hours) return day.hours;
  if (day.status === "incomplete") return "ketish yo‘q";
  if (day.status === "absent") return "kelmagan";
  if (day.status === "leave") return "ta’til";
  if (day.status === "planned") return "reja";
  if (day.status === "rest") return "dam";
  return "—";
}

function DayHead() {
  const cells = [
    { label: "Sana", align: "" },
    { label: "Kun", align: "" },
    { label: "Holat", align: "" },
    { label: "Kelish", align: "text-right" },
    { label: "Ketish", align: "text-right" },
    { label: "Vaqt", align: "text-right" },
  ];
  return (
    <div className="grid bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500" style={{ gridTemplateColumns: DAY_GRID }}>
      {cells.map((cell) => (
        <div key={cell.label} className={`whitespace-nowrap px-2.5 py-2 ${cell.align}`}>{cell.label}</div>
      ))}
    </div>
  );
}

function DayRow({ day }: { day: XodimDay }) {
  return (
    <div className={`grid items-center text-sm ${ROW_TONE[day.status]}`} style={{ gridTemplateColumns: DAY_GRID }}>
      <div className="whitespace-nowrap px-2.5 py-2 font-medium tabular-nums">{formatYmd(day.date)}</div>
      <div className="whitespace-nowrap px-2.5 py-2 text-slate-600">{day.weekday}</div>
      <div className="px-2.5 py-2">
        <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${STATUS_STYLE[day.status]}`}>{day.statusLabel}</span>
      </div>
      <div className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{day.checkIn || "—"}</div>
      <div className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">{day.checkOut || "—"}</div>
      <div className="whitespace-nowrap px-2.5 py-2 text-right text-[13px] font-medium tabular-nums text-slate-700">{hoursLabel(day)}</div>
    </div>
  );
}

function JavobHead() {
  return (
    <div className="grid bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500" style={{ gridTemplateColumns: JAVOB_GRID }}>
      {["Sana", "Vaqt", "Holat", "Koordinator", "HR"].map((cell) => (
        <div key={cell} className="px-2 py-2">{cell}</div>
      ))}
    </div>
  );
}

function MissedCard({ day }: { day: XodimDay }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{formatYmd(day.date)}</p>
        <p className="text-xs text-slate-500">{day.weekday}</p>
      </div>
      <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">Kelmagan</span>
    </div>
  );
}

function TaskRow({ item }: { item: XodimTaskItem }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-sm font-medium text-slate-900">{item.title}</p>
      <p className="text-xs text-slate-500">{item.statusLabel} · muddat {item.dueLabel}</p>
    </div>
  );
}

function SheetPage({ index, total, title, children }: { index: number; total: number; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-[210mm] shadow-[0_12px_32px_rgba(15,23,42,0.14)]">
      <article data-hisobot-page className="flex min-h-[297mm] w-full flex-col bg-white text-slate-900">
        <header className="flex items-start justify-between gap-3 bg-[#0b3a5c] px-6 py-3 text-white">
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.16em] text-sky-100">VAKSINA MED HR</p>
            <p className="text-sm font-semibold">{title}</p>
          </div>
          <p className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">List {index} / {total}</p>
        </header>
        <div className="flex-1 px-6 py-5">{children}</div>
        <footer className="mt-auto flex items-center justify-between border-t border-slate-200 px-6 py-2 text-[11px] text-slate-500">
          <span>01.09.2026 dan · A4 list</span>
          <span>List {index} / {total}</span>
        </footer>
      </article>
    </div>
  );
}

function PageBody({ atoms }: { atoms: FlowAtom[] }) {
  const chunks: ReactNode[] = [];
  let i = 0;
  while (i < atoms.length) {
    const atom = atoms[i]!;
    if (!atom.table) {
      chunks.push(<div key={atom.key}>{atom.node}</div>);
      i += 1;
      continue;
    }
    const table = atom.table;
    const rows: FlowAtom[] = [];
    while (i < atoms.length && atoms[i]?.table === table) {
      rows.push(atoms[i]!);
      i += 1;
    }
    chunks.push(
      <div key={`${table}-${rows[0]!.key}`} className="overflow-hidden rounded-xl border border-slate-200">
        {table === "javob" ? <JavobHead /> : <DayHead />}
        {rows.map((row) => (
          <div key={row.key} className="border-t border-slate-100">{row.node}</div>
        ))}
      </div>,
    );
  }
  return <div className="flex flex-col gap-3">{chunks}</div>;
}

function minutesOf(hm: string | null) {
  if (!hm || !/^\d{2}:\d{2}$/.test(hm)) return null;
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function share(part: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function Metric({ label, value, hint, note, tone }: { label: string; value: string; hint?: string; note: string; tone: string }) {
  return (
    <div className={`rounded-lg px-2 py-1.5 ring-1 ${tone}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-[15px] font-semibold leading-tight text-slate-950">
        {value}
        {hint ? <span className="ml-1 text-[11px] font-medium text-slate-500">{hint}</span> : null}
      </p>
      <p className="text-[10px] leading-tight text-slate-500">{note}</p>
    </div>
  );
}

function filialName(value: string | null | undefined) {
  const name = String(value || "")
    .replace(/(?:\s*[|·｜│]\s*)?gps:\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)?/gi, "")
    .replace(/\s*[|·｜│]\s*$/g, "")
    .trim();
  return name || "—";
}

function InfoTile({ label, value }: { label: string; value: string }) {
  const empty = !value || value === "—" || value === "kiritilmagan" || value === "yo‘q";
  return (
    <div className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-slate-200/80">
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">{label}</p>
      <p className={`truncate text-[13px] leading-tight ${empty ? "font-medium text-slate-400" : "font-semibold text-slate-900"}`}>{value || "—"}</p>
    </div>
  );
}

function InfoGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#0b3a5c]">{title}</p>
      <div className="grid grid-cols-2 gap-1.5">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-900">{value || "—"}</p>
    </div>
  );
}

function buildAtoms(report: XodimReport, seal: XodimSealView | null | undefined, qr: string): FlowAtom[] {
  const emp = report.employee;
  const days = report.days.filter((d) => d.date >= PLATFORM_START);
  const came = days.filter((d) => d.status === "present" || d.status === "late" || d.status === "incomplete");
  const missed = days.filter((d) => d.status === "absent");
  const offDays = days.filter((d) => d.status === "rest");
  const rest = days.filter((d) => d.status === "leave" || d.status === "planned");
  const presentN = days.filter((d) => d.status === "present").length;
  const lateN = days.filter((d) => d.status === "late").length;
  const incompleteN = days.filter((d) => d.status === "incomplete").length;
  const cameN = presentN + lateN + incompleteN;
  const baseN = cameN + missed.length;
  const presentRate = baseN > 0 ? Math.round((cameN / baseN) * 1000) / 10 : null;
  const workDays = presentN + lateN + missed.length + incompleteN;
  const initials = emp.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  let totalMin = 0;
  let workedDays = 0;
  for (const d of came) {
    const a = minutesOf(d.checkIn);
    const b = minutesOf(d.checkOut);
    if (a != null && b != null) {
      totalMin += b >= a ? b - a : b + 24 * 60 - a;
      workedDays += 1;
    }
  }
  const hours = Math.round(totalMin / 60);
  const avgWorkMin = workedDays ? Math.round(totalMin / workedDays) : 0;
  const avgWorkH = Math.floor(avgWorkMin / 60);
  const avgWorkM = avgWorkMin % 60;
  const avgWork = !workedDays ? "—" : avgWorkH > 0 && avgWorkM > 0 ? `${avgWorkH} soat ${avgWorkM} daq` : avgWorkH > 0 ? `${avgWorkH} soat` : `${avgWorkM} daq`;
  const taskTotal = report.tasks ? Math.max(0, report.tasks.total - report.tasks.cancelled) : 0;
  const taskPct = taskTotal ? Math.round((report.tasks.done / taskTotal) * 100) : null;
  const kpi = presentRate == null ? null : taskPct == null ? Math.round(presentRate) : Math.round(presentRate * 0.6 + taskPct * 0.4);
  const active = /ishlay|faol/i.test(emp.statusLabel || "");
  const periodFrom = report.from < PLATFORM_START ? PLATFORM_START : report.from;
  const period = `${formatYmd(periodFrom)} — ${formatYmd(report.to)}`;
  const profileTitle = `Shaxsiy ma'lumot · ${period}`;
  const davomatTitle = `Davomat · ${period}`;
  const atoms: FlowAtom[] = [];

  atoms.push({
    key: "profile",
    title: profileTitle,
    node: (
      <>
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-sky-50 to-white px-4 py-4 ring-1 ring-sky-100">
          {emp.photoUrl ? (
            <img src={emp.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover ring-4 ring-white" />
          ) : (
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#0b3a5c] text-lg font-semibold text-white ring-4 ring-white">{initials || "HR"}</div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">{emp.fullName}</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{emp.statusLabel || "—"}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{emp.roleLabel}{emp.department ? ` · ${emp.department}` : ""}</p>
            <p className="mt-0.5 font-mono text-xs text-slate-400">{emp.staffCode || "—"}</p>
          </div>
        </div>
        <div className="mt-3 space-y-2.5">
          <InfoGroup title="Shaxs">
            <InfoTile label="Lavozim" value={emp.roleLabel} />
            <InfoTile label="Filial" value={filialName(emp.branch)} />
            <InfoTile label="Telefon" value={emp.phone || "—"} />
            <InfoTile label="Tug‘ilgan sana" value={emp.birthDate ? formatYmd(emp.birthDate) : "kiritilmagan"} />
            <InfoTile label="JSHShIR" value="kiritilmagan" />
            <InfoTile label="Shaxsiy ID" value={emp.staffCode || "—"} />
          </InfoGroup>
          <InfoGroup title="Ish">
            <InfoTile label="Bo‘lim" value={emp.department || "—"} />
            <InfoTile label="Smena" value={emp.shift || "—"} />
            <InfoTile label="Ishga kirgan" value={emp.hiredAt ? formatYmd(emp.hiredAt) : "—"} />
            <InfoTile label="Login" value={emp.login || "—"} />
          </InfoGroup>
          <InfoGroup title="Platforma">
            <InfoTile label="Platformaga yozilgan" value={report.access?.joinedAt || "—"} />
            <InfoTile label="Birinchi kirish" value={report.access?.firstSeenAt || "—"} />
            <InfoTile label="Oxirgi kirish" value={report.access?.lastLoginAt || "—"} />
            <InfoTile label="Oxirgi faollik" value={report.access?.lastSeenAt || "—"} />
          </InfoGroup>
          <InfoGroup title="Holat">
            <InfoTile label="Javob olish" value={report.javob ? `${report.javob.approved}/${report.javob.total} tasdiq` : "—"} />
            <InfoTile label="Atestatsiya" value={report.attestatsiya ? `${report.attestatsiya.passed}/${report.attestatsiya.total} o‘tgan` : "—"} />
            <InfoTile label="Darslik" value={report.darslik?.tracks.length ? report.darslik.tracks.map((t) => `${t.track} ${t.percent}%`).join(", ") : "yo‘q"} />
          </InfoGroup>
        </div>
      </>
    ),
  });

  atoms.push({
    key: "metrics",
    title: profileTitle,
    node: (
      <div>
        <p className="mb-1.5 text-[11px] leading-snug text-slate-500">
          Ish kuni — shu odamning smenasi bo‘yicha kelishi kerak bo‘lgan kun. Dam kuni ish kuniga va «kelmagan»ga kirmaydi. Foiz ish kunidan.
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <Metric label="Ish kuni" value={String(workDays)} note="Dam kunisiz" tone="bg-sky-50 ring-sky-100" />
          <Metric label="Kelgan" value={String(presentN)} hint={share(presentN, workDays)} note="Vaqtida kelgan" tone="bg-emerald-50 ring-emerald-100" />
          <Metric label="Kechikkan" value={String(lateN)} hint={share(lateN, workDays)} note="Smena boshlanishidan keyin" tone="bg-amber-50 ring-amber-100" />
          <Metric label="Kelmagan" value={String(missed.length)} hint={share(missed.length, workDays)} note="Ish kunida kelmagan" tone="bg-rose-50 ring-rose-100" />
          <Metric label="Dam kuni" value={String(offDays.length)} note="Jadval bo‘yicha dam" tone="bg-slate-50 ring-slate-200" />
          <Metric label="Ish soati" value={`${hours} soat`} note={incompleteN ? `Chala kun: ${incompleteN}` : "Kelgan kunlar yig‘indisi"} tone="bg-sky-50 ring-sky-100" />
          <Metric label="O‘rtacha ish" value={avgWork} note="Ketish yozilgan kunga" tone="bg-sky-50 ring-sky-100" />
          <Metric label="Vazifalar" value={report.tasks ? `${report.tasks.done}/${taskTotal || report.tasks.total}` : "—"} hint={taskPct == null ? undefined : `${taskPct}%`} note="Bajargan / jami" tone="bg-emerald-50 ring-emerald-100" />
          <Metric label="KPI" value={kpi == null ? "—" : `${kpi}%`} note={presentRate == null ? "Hali hisob yo‘q" : `Davomat ${presentRate}%`} tone="bg-sky-50 ring-sky-100" />
        </div>
      </div>
    ),
  });

  if (emp.attendanceTracked === false) {
    atoms.push({
      key: "davomat-empty",
      title: davomatTitle,
      node: <p className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">Bu foydalanuvchida davomat yozuvi yo‘q</p>,
    });
  } else {
    atoms.push({
      key: "came-title",
      title: davomatTitle,
      stick: true,
      node: <BlockTitle title="Kelgan, kechikkan va chala kunlar" count={String(came.length)} tone="bg-emerald-700 text-white" />,
    });
    if (!came.length) {
      atoms.push({ key: "came-empty", title: davomatTitle, node: <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Bu davrda kelgan kun yo‘q</p> });
    } else {
      for (const day of came) {
        atoms.push({ key: `came-${day.date}`, title: davomatTitle, table: "day", node: <DayRow day={day} /> });
      }
    }
    atoms.push({
      key: "miss-title",
      title: davomatTitle,
      stick: true,
      node: <BlockTitle title="Kelmagan kunlar" count={String(missed.length)} tone="bg-rose-700 text-white" />,
    });
    if (!missed.length) {
      atoms.push({ key: "miss-empty", title: davomatTitle, node: <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">Kelmagan kun yo‘q</p> });
    } else {
      for (let i = 0; i < missed.length; i += 2) {
        const pair = missed.slice(i, i + 2);
        atoms.push({
          key: `miss-${pair[0]!.date}`,
          title: davomatTitle,
          node: (
            <div className="grid grid-cols-2 gap-2">
              {pair.map((day) => <MissedCard key={day.date} day={day} />)}
            </div>
          ),
        });
      }
    }
    if (offDays.length) {
      atoms.push({
        key: "off-title",
        title: davomatTitle,
        stick: true,
        node: <BlockTitle title="Dam kunlari" count={String(offDays.length)} tone="bg-slate-600 text-white" />,
      });
      for (let i = 0; i < offDays.length; i += 2) {
        const pair = offDays.slice(i, i + 2);
        atoms.push({
          key: `off-${pair[0]!.date}`,
          title: davomatTitle,
          node: (
            <div className="grid grid-cols-2 gap-2">
              {pair.map((day) => (
                <div key={day.date} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{formatYmd(day.date)}</p>
                    <p className="text-xs text-slate-500">{day.weekday}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">Dam kuni</span>
                </div>
              ))}
            </div>
          ),
        });
      }
    }
    if (rest.length) {
      atoms.push({
        key: "rest-title",
        title: davomatTitle,
        stick: true,
        node: <BlockTitle title="Ta’til va hali kelmagan" count={String(rest.length)} tone="bg-violet-700 text-white" />,
      });
      for (const day of rest) {
        atoms.push({ key: `rest-${day.date}`, title: davomatTitle, table: "day", node: <DayRow day={day} /> });
      }
    }
  }

  if (report.tasks) {
    const taskTitle = `Topshiriqlar · jami ${report.tasks.total}`;
    const remaining = report.tasks.items.filter((t) => t.bucket === "remaining");
    const done = report.tasks.items.filter((t) => t.bucket === "done");
    atoms.push({
      key: "task-facts",
      title: taskTitle,
      node: (
        <div className="grid grid-cols-2 gap-2">
          <Fact label="Qolgan" value={String(report.tasks.remaining)} />
          <Fact label="Jarayonda" value={String(report.tasks.inProgress)} />
          <Fact label="Bajarilmagan" value={String(report.tasks.notDone)} />
          <Fact label="Bajargan" value={String(report.tasks.done)} />
        </div>
      ),
    });
    atoms.push({
      key: "task-left-title",
      title: taskTitle,
      stick: true,
      node: <BlockTitle title="Qolgan" count={String(remaining.length)} tone="bg-amber-700 text-white" />,
    });
    if (!remaining.length) atoms.push({ key: "task-left-empty", title: taskTitle, node: <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Qolgan topshiriq yo‘q</p> });
    for (const item of remaining) atoms.push({ key: `task-r-${item.id}`, title: taskTitle, node: <TaskRow item={item} /> });
    atoms.push({
      key: "task-done-title",
      title: taskTitle,
      stick: true,
      node: <BlockTitle title="Bajargan" count={String(done.length)} tone="bg-emerald-700 text-white" />,
    });
    if (!done.length) atoms.push({ key: "task-done-empty", title: taskTitle, node: <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Bajarilgan topshiriq yo‘q</p> });
    for (const item of done) atoms.push({ key: `task-d-${item.id}`, title: taskTitle, node: <TaskRow item={item} /> });
  }

  if (report.javob) {
    const rows = report.javob.items.filter((j) => !j.date || j.date >= PLATFORM_START);
    const title = `Javob olish · tasdiq ${report.javob.approved}/${report.javob.total}`;
    atoms.push({
      key: "javob-title",
      title,
      stick: true,
      node: <BlockTitle title="Javob olish" count={`${report.javob.approved}/${report.javob.total}`} tone="bg-[#0b3a5c] text-white" />,
    });
    if (!rows.length) {
      atoms.push({ key: "javob-empty", title, node: <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Bu davrda javob olish so‘rovi yo‘q</p> });
    } else {
      for (const row of rows) {
        atoms.push({
          key: `javob-${row.id}`,
          title,
          table: "javob",
          node: (
            <div className="grid items-start text-sm" style={{ gridTemplateColumns: JAVOB_GRID }}>
              <div className="whitespace-nowrap px-2 py-2 font-medium">{formatYmd(row.date)}</div>
              <div className="whitespace-nowrap px-2 py-2">{row.fromHm}–{row.toHm}</div>
              <div className="px-2 py-2">{row.statusLabel}</div>
              <div className="px-2 py-2">
                <p>{row.coordinator || "—"}</p>
                <p className="text-xs text-slate-500">{row.coordinatorAt || ""}</p>
              </div>
              <div className="px-2 py-2">
                <p>{row.hr || "—"}</p>
                <p className="text-xs text-slate-500">{row.hrAt || ""}</p>
              </div>
            </div>
          ),
        });
      }
    }
  }

  if (report.attestatsiya) {
    const title = `Atestatsiya · o‘tgan ${report.attestatsiya.passed}/${report.attestatsiya.total}`;
    atoms.push({
      key: "attest-title",
      title,
      stick: true,
      node: <BlockTitle title="Atestatsiya" count={`${report.attestatsiya.passed}/${report.attestatsiya.total}`} tone="bg-violet-700 text-white" />,
    });
    if (!report.attestatsiya.items.length) {
      atoms.push({ key: "attest-empty", title, node: <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Bu davrda atestatsiya topshirilmagan</p> });
    } else {
      for (const item of report.attestatsiya.items) {
        atoms.push({
          key: `attest-${item.id}`,
          title,
          node: (
            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <p className="font-medium">{item.title}</p>
              <p className="mt-1 text-sm text-slate-600">
                {item.statusLabel}
                {item.score != null ? ` · ${item.score}%` : ""}
                {item.passed === true ? " · o‘tgan" : item.passed === false ? " · o‘tolmagan" : ""}
                {item.total ? ` · ${item.correct ?? 0}/${item.total}` : ""}
              </p>
              <p className="text-xs text-slate-500">{item.when || ""}</p>
            </div>
          ),
        });
      }
    }
  }

  if (report.darslik) {
    atoms.push({
      key: "darslik-title",
      title: "Darslik",
      stick: true,
      node: <BlockTitle title="Darslik" count={String(report.darslik.tracks.length)} tone="bg-[#0b3a5c] text-white" />,
    });
    if (!report.darslik.tracks.length) {
      atoms.push({ key: "darslik-empty", title: "Darslik", node: <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Darslik yozuvi yo‘q</p> });
    } else {
      for (const track of report.darslik.tracks) {
        atoms.push({
          key: `track-${track.track}`,
          title: "Darslik",
          node: (
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-semibold">{track.track}</p>
              <p className="mt-1 text-2xl font-semibold text-[#0b3a5c]">{track.percent}%</p>
              <p className="text-xs text-slate-500">{track.passed}/{track.total} dars · {track.done ? "tugallangan" : "jarayonda"}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-[#0b3a5c]" style={{ width: `${Math.min(100, track.percent)}%` }} />
              </div>
            </div>
          ),
        });
      }
    }
  }

  if (seal) {
    atoms.push({
      key: "seal",
      title: seal.title,
      node: (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-end gap-3">
              {qr ? (
                <img src={qr} alt="Asligini tasdiqlash belgisi" className="h-28 w-28 rounded-lg bg-white p-1 ring-1 ring-slate-200" />
              ) : (
                <div className="h-28 w-28 rounded-lg bg-white ring-1 ring-slate-200" />
              )}
              <div className="max-w-sm pb-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Asligini tasdiqlash belgisi</p>
                <p className="mt-1 text-sm font-semibold">Tasdiqlangan: {formatSealWhen(seal.sealedAt)}</p>
                <p className="mt-1 text-sm">{seal.approverLine}</p>
              </div>
            </div>
            <div className="grid h-32 w-32 place-items-center rounded-full border-[6px] border-double border-emerald-700 text-center text-emerald-700" style={{ transform: "rotate(-14deg)" }}>
              <div>
                <p className="text-[10px] font-bold tracking-[0.2em]">VAKSINA</p>
                <p className="text-sm font-black tracking-wide">TASDIQLANGAN</p>
                <p className="text-[10px] font-semibold">MED HR</p>
              </div>
            </div>
          </div>
        </div>
      ),
    });
  }

  return atoms;
}

export type XodimSealView = {
  sealedAt: string;
  title: string;
  approverLine: string;
  verifyUrl: string;
};

export function XodimHisobotSheet({
  report,
  seal,
  rootRef,
}: {
  report: XodimReport;
  seal?: XodimSealView | null;
  rootRef?: Ref<HTMLDivElement>;
}) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    if (!seal?.verifyUrl) {
      setQr("");
      return;
    }
    let live = true;
    void qrPngDataUrl(seal.verifyUrl, 280).then((url) => {
      if (live) setQr(url);
    });
    return () => {
      live = false;
    };
  }, [seal?.verifyUrl]);

  const atoms = useMemo(() => buildAtoms(report, seal, qr), [report, seal, qr]);
  const { measureRef, pages } = usePackedPages(atoms);
  const periodFrom = report.from < PLATFORM_START ? PLATFORM_START : report.from;
  const period = `${formatYmd(periodFrom)} — ${formatYmd(report.to)}`;

  return (
    <div ref={rootRef} className="relative mx-auto overflow-x-auto bg-[#d9e3ea] px-2 py-6 sm:px-4">
      <div ref={measureRef} className="pointer-events-none absolute left-[-14000px] top-0 w-[calc(210mm-3rem)]" aria-hidden>
        {atoms.map((atom) => (
          <div key={atom.key} data-atom className={atom.table ? "border-t border-slate-100" : undefined}>{atom.node}</div>
        ))}
      </div>
      <p className="mb-4 text-center text-sm font-medium text-slate-600">Jami {pages.length} list · {period}</p>
      <div className="space-y-8">
        {pages.map((group, pageIndex) => {
          const pageAtoms = group.map((index) => atoms[index]).filter((atom): atom is FlowAtom => Boolean(atom));
          const title = pageAtoms[0]?.title ?? "Hisobot";
          const prev = pageIndex > 0 ? atoms[pages[pageIndex - 1]?.at(-1) ?? -1] : undefined;
          const shown = prev?.title === title ? `${title} · davomi` : title;
          return (
            <SheetPage key={`${pageAtoms[0]?.key ?? pageIndex}-${pageIndex}`} index={pageIndex + 1} total={pages.length} title={shown}>
              <PageBody atoms={pageAtoms} />
            </SheetPage>
          );
        })}
      </div>
    </div>
  );
}
