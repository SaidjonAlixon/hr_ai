import type { Ref } from "react";
import { formatYmd, XODIM_STATUS_OPTIONS, type FilialReport, type XodimDay, type XodimDayStatus } from "../../lib/xodim-hisobot-api";

const LOOK: Record<
  XodimDayStatus,
  { chip: string; wrap: string; bar: string; head: string; zebra: string; hours: string; empty: string; pill: string }
> = {
  present: {
    chip: "bg-emerald-600 text-white",
    wrap: "border-emerald-200",
    bar: "bg-emerald-600 text-white",
    head: "bg-emerald-100 text-emerald-900",
    zebra: "bg-emerald-50",
    hours: "text-emerald-800",
    empty: "bg-emerald-50 text-emerald-800",
    pill: "bg-emerald-600 text-white",
  },
  late: {
    chip: "bg-amber-500 text-white",
    wrap: "border-amber-200",
    bar: "bg-amber-500 text-amber-950",
    head: "bg-amber-100 text-amber-950",
    zebra: "bg-amber-50",
    hours: "text-amber-900",
    empty: "bg-amber-50 text-amber-900",
    pill: "bg-amber-500 text-amber-950",
  },
  absent: {
    chip: "bg-rose-600 text-white",
    wrap: "border-rose-200",
    bar: "bg-rose-600 text-white",
    head: "bg-rose-100 text-rose-900",
    zebra: "bg-rose-50",
    hours: "text-rose-800",
    empty: "bg-rose-50 text-rose-800",
    pill: "bg-rose-600 text-white",
  },
  incomplete: {
    chip: "bg-sky-600 text-white",
    wrap: "border-sky-200",
    bar: "bg-sky-600 text-white",
    head: "bg-sky-100 text-sky-950",
    zebra: "bg-sky-50",
    hours: "text-sky-900",
    empty: "bg-sky-50 text-sky-900",
    pill: "bg-sky-600 text-white",
  },
  leave: {
    chip: "bg-violet-600 text-white",
    wrap: "border-violet-200",
    bar: "bg-violet-600 text-white",
    head: "bg-violet-100 text-violet-950",
    zebra: "bg-violet-50",
    hours: "text-violet-900",
    empty: "bg-violet-50 text-violet-900",
    pill: "bg-violet-600 text-white",
  },
  planned: {
    chip: "bg-slate-600 text-white",
    wrap: "border-slate-200",
    bar: "bg-slate-600 text-white",
    head: "bg-slate-100 text-slate-800",
    zebra: "bg-slate-50",
    hours: "text-slate-700",
    empty: "bg-slate-50 text-slate-600",
    pill: "bg-slate-600 text-white",
  },
  rest: {
    chip: "bg-teal-700 text-white",
    wrap: "border-teal-200",
    bar: "bg-teal-700 text-white",
    head: "bg-teal-100 text-teal-950",
    zebra: "bg-teal-50",
    hours: "text-teal-900",
    empty: "bg-teal-50 text-teal-900",
    pill: "bg-teal-700 text-white",
  },
};

export function statusCountClass(status: XodimDayStatus) {
  return LOOK[status].pill;
}

function countStatus(days: XodimDay[] | undefined, status: XodimDayStatus) {
  return (days ?? []).filter((d) => d.status === status).length;
}

export function filialStatusCount(
  row: { days?: XodimDay[]; onTimeDays: number; lateDays: number; absentDays: number },
  status: XodimDayStatus,
) {
  if (row.days?.length) return countStatus(row.days, status);
  if (status === "present") return row.onTimeDays;
  if (status === "late") return row.lateDays;
  if (status === "absent") return row.absentDays;
  return 0;
}

export function FilialHisobotDocument({
  report,
  statuses,
  rootRef,
  focusId,
}: {
  report: FilialReport;
  statuses: XodimDayStatus[];
  rootRef?: Ref<HTMLDivElement>;
  focusId?: number | null;
}) {
  const chosen = XODIM_STATUS_OPTIONS.filter((s) => statuses.includes(s.id));
  return (
    <div ref={rootRef} className="space-y-4">
      {report.employees.map((row, index) => {
        const days = (row.days ?? []).filter((d) => statuses.includes(d.status));
        return (
          <article
            key={row.employeeId}
            id={`filial-emp-${row.employeeId}`}
            data-hisobot-page
            className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
              focusId === row.employeeId ? "border-[#0b3a5c] ring-2 ring-[#0b3a5c]/30" : "border-slate-200"
            }`}
          >
            <header className="bg-[#0b3a5c] px-5 py-4 text-white">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-100">
                VAKSINA MED HR · Filial hisoboti
              </p>
              <h3 className="mt-1 text-lg font-semibold">{report.filial.name}</h3>
              <p className="mt-0.5 text-xs text-sky-100">
                {formatYmd(report.from)} — {formatYmd(report.to)} · {index + 1}/{report.employees.length} xodim
              </p>
            </header>
            <div className="px-5 py-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-base font-semibold text-slate-950">{row.fullName}</p>
                  <p className="text-xs text-slate-500">
                    {row.roleLabel} · {row.shiftDisplay}
                    {row.phone ? ` · ${row.phone}` : ""}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {chosen.map((s) => {
                  const n = countStatus(row.days, s.id);
                  return (
                    <span key={s.id} className={`inline-flex items-center gap-2 rounded-full py-1 pl-3 pr-1 text-xs font-semibold ${LOOK[s.id].chip}`}>
                      {s.label}
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white/25 px-1.5 text-[11px]">{n}</span>
                    </span>
                  );
                })}
              </div>
              {chosen.map((s) => {
                const list = days.filter((d) => d.status === s.id);
                const look = LOOK[s.id];
                return (
                  <section key={s.id} className={`mt-4 overflow-hidden rounded-xl border ${look.wrap}`}>
                    <div className={`flex items-center justify-between px-3 py-2 ${look.bar}`}>
                      <h4 className="text-sm font-semibold">{s.label}</h4>
                      <span className="rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-semibold">{list.length} kun</span>
                    </div>
                    {list.length === 0 ? (
                      <p className={`px-3 py-2 text-xs ${look.empty}`}>Bu holatda kun yo‘q.</p>
                    ) : (
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className={`text-[10px] uppercase tracking-wide ${look.head}`}>
                            <th className="px-3 py-1.5 font-semibold">Sana</th>
                            <th className="px-2 py-1.5 font-semibold">Kun</th>
                            <th className="px-2 py-1.5 font-semibold">Keldi</th>
                            <th className="px-2 py-1.5 font-semibold">Ketdi</th>
                            <th className="px-3 py-1.5 font-semibold">Soat</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((d, i) => (
                            <tr key={`${row.employeeId}-${d.date}`} className={i % 2 === 0 ? "bg-white" : look.zebra}>
                              <td className="px-3 py-1.5 font-medium text-slate-900">{formatYmd(d.date)}</td>
                              <td className="px-2 py-1.5 text-slate-700">{d.weekday}</td>
                              <td className="px-2 py-1.5 font-medium text-slate-800">{d.checkIn || "—"}</td>
                              <td className="px-2 py-1.5 font-medium text-slate-800">{d.checkOut || "—"}</td>
                              <td className={`px-3 py-1.5 font-semibold ${look.hours}`}>{d.hours || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}
