import React, { useMemo, useState } from "react";
import {
  CalendarRange,
  ChevronDown,
  FileText,
  Phone,
  Search,
  Store,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { cn } from "../../lib/utils";
import type { HolatReport } from "../../lib/holat-api";
import {
  useCoordinatorHisobot,
  type HisobotEmployeeRow,
} from "../../lib/hisobot-api";
import { Skeleton } from "../../components/ui/skeleton";

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysAgoYmd(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function fmtShort(ymd: string) {
  if (!ymd || ymd.length < 10) return ymd;
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
}

function rateTone(rate: number) {
  if (rate >= 80) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (rate >= 50) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-rose-700 bg-rose-50 border-rose-200";
}

function matchesQuery(parts: Array<string | null | undefined>, q: string) {
  if (!q) return true;
  return parts.filter(Boolean).join(" ").toLowerCase().includes(q);
}

function DateChips({ dates, tone }: { dates: string[]; tone: "ok" | "bad" }) {
  if (!dates.length) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {dates.map((d) => (
        <span
          key={d}
          className={cn(
            "inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
            tone === "ok"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-rose-100 text-rose-800",
          )}
          title={d}
        >
          {fmtShort(d)}
        </span>
      ))}
    </div>
  );
}

function EmployeeReportCard({ e }: { e: HisobotEmployeeRow }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#0b3a5c]">
            {e.roleLabel}
          </p>
          <p className="mt-0.5 font-semibold text-foreground">{e.fullName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {e.branch} · {e.shiftDisplay}
            {e.phone ? ` · ${e.phone}` : ""}
          </p>
        </div>
        <div
          className={cn(
            "shrink-0 rounded-lg border px-2.5 py-1 text-center",
            rateTone(e.presentRate),
          )}
        >
          <p className="text-lg font-bold tabular-nums leading-none">{e.presentRate}%</p>
          <p className="mt-0.5 text-[9px] font-medium uppercase tracking-wide opacity-80">
            davomat
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            Kelgan ({e.presentDays})
          </p>
          <DateChips dates={e.presentDates} tone="ok" />
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
            Kelmagan ({e.absentDays})
          </p>
          <DateChips dates={e.absentDates} tone="bad" />
        </div>
      </div>
    </div>
  );
}

export function HisobotPanel({
  data,
  coordKey,
  onCoordKey,
  from,
  to,
  onFrom,
  onTo,
}: {
  data: HolatReport;
  coordKey: string;
  onCoordKey: (v: string) => void;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [coordSearch, setCoordSearch] = useState("");

  const allCoords = useMemo(
    () => (data.coordinators ?? []).filter((c) => c.employeeId != null),
    [data.coordinators],
  );

  const effectiveKey = useMemo(() => {
    if (coordKey && allCoords.some((c) => String(c.employeeId) === coordKey)) return coordKey;
    if (data.scoped && allCoords[0]?.employeeId != null) return String(allCoords[0].employeeId);
    return "";
  }, [coordKey, data.scoped, allCoords]);

  const selected =
    effectiveKey
      ? allCoords.find((c) => String(c.employeeId) === effectiveKey) ?? null
      : null;

  const coordinatorId = selected?.employeeId ?? null;

  const reportQ = useCoordinatorHisobot(coordinatorId, from, to, Boolean(coordinatorId));

  const coords = useMemo(() => {
    const s = coordSearch.trim().toLowerCase();
    if (!s) return allCoords;
    return allCoords.filter((c) =>
      matchesQuery([c.fullName, c.phone, c.login, String(c.mudirs?.length ?? 0)], s),
    );
  }, [allCoords, coordSearch]);

  function pickCoord(key: string) {
    onCoordKey(key);
    setPickerOpen(false);
    setCoordSearch("");
  }

  const report = reportQ.data;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0b3a5c]">
              Koordinator
            </p>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-xl border border-[#0b3a5c]/25 bg-[#0b3a5c]/5 px-3 py-2.5 text-left transition hover:bg-[#0b3a5c]/10"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">
                  {selected?.fullName || "Koordinator tanlash"}
                </p>
                {selected ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {(selected.mudirs?.length ?? 0)} filial
                    {selected.phone ? ` · ${selected.phone}` : ""}
                    {selected.login ? ` · ${selected.login}` : ""}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Qidiruv va batafsil tanlov
                  </p>
                )}
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-[#0b3a5c]" />
            </button>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Dan
            </p>
            <div className="relative mt-1.5">
              <CalendarRange className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="date"
                value={from}
                max={to}
                onChange={(e) => onFrom(e.target.value)}
                className="h-10 w-[150px] rounded-xl pl-8 text-sm"
              />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Gacha
            </p>
            <Input
              type="date"
              value={to}
              max={todayYmd()}
              min={from}
              onChange={(e) => onTo(e.target.value)}
              className="mt-1.5 h-10 w-[150px] rounded-xl text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 pb-0.5">
            {[
              { label: "7 kun", days: 6 },
              { label: "30 kun", days: 29 },
              { label: "90 kun", days: 89 },
            ].map((p) => (
              <Button
                key={p.label}
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg text-xs"
                onClick={() => {
                  onTo(todayYmd());
                  onFrom(daysAgoYmd(p.days));
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {selected ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-[#0b3a5c]/15 bg-gradient-to-br from-[#0b3a5c]/[0.06] via-white to-slate-50">
            <div className="flex flex-wrap items-center gap-3 border-b border-[#0b3a5c]/10 px-4 py-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0b3a5c] text-lg font-bold text-white shadow-sm">
                {(selected.fullName || "?").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#0b3a5c]/70">
                  Tanlangan koordinator
                </p>
                <p className="truncate text-lg font-semibold text-foreground">{selected.fullName}</p>
              </div>
              <div className="rounded-xl border border-[#0b3a5c]/15 bg-white px-3 py-2 text-center shadow-sm">
                <p className="text-2xl font-bold tabular-nums leading-none text-[#0b3a5c]">
                  {selected.mudirs?.length ?? 0}
                </p>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  filial
                </p>
              </div>
            </div>
            <div className="grid gap-0 sm:grid-cols-2">
              <div className="flex items-start gap-3 border-b border-border/70 px-4 py-3 sm:border-b-0 sm:border-r">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <Phone className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Telefon
                  </p>
                  <p className="text-sm font-semibold tabular-nums text-foreground">
                    {selected.phone || "Ko‘rsatilmagan"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-[#0b3a5c]">
                  <UserRound className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Login
                  </p>
                  <p className="truncate text-sm font-semibold text-foreground">
                    {selected.login || "Ko‘rsatilmagan"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Empty / loading / report */}
      {!selected ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <Users className="h-12 w-12 text-muted-foreground/40" />
          <p className="mt-4 text-base font-semibold text-foreground">Avval koordinatorni tanlang</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Koordinator tanlang — filiallar, mudir / farmasevt / stajyor va davomat hisoboti ochiladi.
          </p>
          <Button
            type="button"
            className="mt-4 rounded-xl bg-[#0b3a5c] hover:bg-[#0f4a73]"
            onClick={() => setPickerOpen(true)}
          >
            Koordinator tanlash
          </Button>
        </div>
      ) : reportQ.isLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      ) : reportQ.isError || !report ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {(reportQ.error as Error)?.message || "Hisobot yuklanmadi"}
          <Button
            className="ml-3"
            size="sm"
            variant="outline"
            onClick={() => void reportQ.refetch()}
          >
            Qayta urinish
          </Button>
        </div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Filial", value: report.summary.branchCount, icon: Store },
              { label: "Mudir", value: report.summary.mudirCount, icon: UserRound },
              { label: "Farmasevt", value: report.summary.pharmacistCount, icon: Users },
              { label: "Stajyor", value: report.summary.internCount, icon: Users },
              {
                label: "O‘rtacha %",
                value: `${report.summary.avgPresentRate}%`,
                icon: FileText,
                tone: rateTone(report.summary.avgPresentRate),
              },
              {
                label: "Kelmaganlar",
                value: report.summary.noShowCount,
                icon: XCircle,
                tone: "text-rose-700 bg-rose-50 border-rose-200",
              },
            ].map((k) => (
              <div
                key={k.label}
                className={cn(
                  "rounded-xl border border-border bg-card p-3 shadow-sm",
                  k.tone,
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                    {k.label}
                  </p>
                  <k.icon className="h-3.5 w-3.5 opacity-60" />
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{k.value}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Davr: <span className="font-medium text-foreground">{report.from}</span> →{" "}
            <span className="font-medium text-foreground">{report.to}</span> · {report.dayCount} kun ·
            yangilangan {report.generatedAt}
          </p>

          {/* Branches */}
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Filiallar va jamoa</h2>
              <p className="text-sm text-muted-foreground">
                Har bir filialda mudir, farmasevt va stajyor alohida; smena va davomat foizi bilan.
              </p>
            </div>

            {report.branches.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Bu koordinatorda filial yo‘q
              </div>
            ) : (
              report.branches.map((b) => (
                <section
                  key={b.branch + (b.mudir?.employeeId ?? "")}
                  className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-[#0b3a5c]/5 to-transparent px-4 py-3">
                    <div>
                      <p className="font-semibold text-foreground">{b.branch}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.staffCount} xodim · farmasevt {b.pharmacists.length} · stajyor{" "}
                        {b.interns.length}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-4 p-4">
                    {b.mudir ? (
                      <div>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0b3a5c]">
                          Mudir
                        </p>
                        <EmployeeReportCard e={b.mudir} />
                      </div>
                    ) : null}
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0b3a5c]">
                        Farmasevtlar ({b.pharmacists.length})
                      </p>
                      {b.pharmacists.length ? (
                        <div className="grid gap-2.5 lg:grid-cols-2">
                          {b.pharmacists.map((e) => (
                            <EmployeeReportCard key={e.employeeId} e={e} />
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Farmasevt yo‘q</p>
                      )}
                    </div>
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0b3a5c]">
                        Stajyorlar ({b.interns.length})
                      </p>
                      {b.interns.length ? (
                        <div className="grid gap-2.5 lg:grid-cols-2">
                          {b.interns.map((e) => (
                            <EmployeeReportCard key={e.employeeId} e={e} />
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Stajyor yo‘q</p>
                      )}
                    </div>
                    {b.others.length ? (
                      <div>
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Boshqa xodimlar ({b.others.length})
                        </p>
                        <div className="grid gap-2.5 lg:grid-cols-2">
                          {b.others.map((e) => (
                            <EmployeeReportCard key={e.employeeId} e={e} />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              ))
            )}
          </div>

          {/* % summary table */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-base font-semibold">Xodimlar davomati — jadval</h2>
              <p className="text-sm text-muted-foreground">
                № · F.I.Sh. · lavozim · filial · smena · kelgan / kelmagan kunlar · foiz. Yashil/qizil sanalar.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-[#0b3a5c] text-[10px] uppercase tracking-wide text-white">
                    <th className="px-3 py-2.5 font-semibold">№</th>
                    <th className="px-3 py-2.5 font-semibold">F.I.Sh.</th>
                    <th className="px-3 py-2.5 font-semibold">Lavozim</th>
                    <th className="px-3 py-2.5 font-semibold">Filial</th>
                    <th className="px-3 py-2.5 font-semibold">Smena</th>
                    <th className="px-3 py-2.5 text-center font-semibold">Kelgan</th>
                    <th className="px-3 py-2.5 text-center font-semibold">Kelmagan</th>
                    <th className="px-3 py-2.5 text-center font-semibold">%</th>
                  </tr>
                </thead>
                <tbody>
                  {report.employees.map((e, i) => (
                    <React.Fragment key={e.employeeId}>
                      <tr className={cn("border-b border-border/60", i % 2 === 1 && "bg-slate-50/80")}>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2.5 font-semibold">{e.fullName}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{e.roleLabel}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{e.branch}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{e.shiftDisplay}</td>
                        <td className="px-3 py-2.5 text-center text-base font-bold tabular-nums text-emerald-700">
                          {e.presentDays}
                        </td>
                        <td className="px-3 py-2.5 text-center text-base font-bold tabular-nums text-rose-700">
                          {e.absentDays}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span
                            className={cn(
                              "inline-flex min-w-[3.25rem] justify-center rounded-md border px-2 py-0.5 text-xs font-bold tabular-nums",
                              rateTone(e.presentRate),
                            )}
                          >
                            {e.presentRate}%
                          </span>
                        </td>
                      </tr>
                      <tr className={cn("border-b border-border/70", i % 2 === 1 && "bg-slate-50/80")}>
                        <td colSpan={8} className="px-3 pb-3 pt-0">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div>
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                Kelgan sanalar ({e.presentDays})
                              </p>
                              <DateChips dates={e.presentDates} tone="ok" />
                            </div>
                            <div>
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                                Kelmagan sanalar ({e.absentDays})
                              </p>
                              <DateChips dates={e.absentDates} tone="bad" />
                            </div>
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* No-shows */}
          <section className="overflow-hidden rounded-2xl border border-rose-200 bg-rose-50/40 shadow-sm">
            <div className="flex items-center gap-2 border-b border-rose-200 px-4 py-3">
              <XCircle className="h-4 w-4 text-rose-600" />
              <div>
                <h2 className="text-base font-semibold text-rose-900">
                  Davomat qilmaganlar ({report.noShows.length})
                </h2>
                <p className="text-sm text-rose-800/80">
                  Tanlangan davrda birorta ham kelmagan xodimlar.
                </p>
              </div>
            </div>
            {report.noShows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-emerald-800">
                Barcha xodimlar kamida bir marta davomat qilgan.
              </p>
            ) : (
              <ul className="divide-y divide-rose-100">
                {report.noShows.map((e) => (
                  <li
                    key={e.employeeId}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <div>
                      <p className="font-semibold text-rose-950">{e.fullName}</p>
                      <p className="text-xs text-rose-800/80">
                        {e.roleLabel} · {e.branch} · {e.shiftDisplay}
                      </p>
                    </div>
                    <span className="rounded-md border border-rose-300 bg-white px-2 py-0.5 text-xs font-bold text-rose-700">
                      0% · {e.absentDays} kun
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle>Koordinator tanlang</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={coordSearch}
                onChange={(e) => setCoordSearch(e.target.value)}
                placeholder="Ism, telefon yoki login…"
                className="h-10 rounded-xl pl-9"
                autoFocus
              />
            </div>
            <div className="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
              {coords.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Topilmadi</p>
              ) : (
                coords.map((c) => {
                  const active = String(c.employeeId) === effectiveKey;
                  const mudirN = c.mudirs?.length ?? 0;
                  const staffN = (c.mudirs ?? []).reduce(
                    (n, m) => n + 1 + (m.staff?.length ?? 0),
                    0,
                  );
                  return (
                    <button
                      key={c.employeeId}
                      type="button"
                      onClick={() => pickCoord(String(c.employeeId))}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                        active
                          ? "border-[#0b3a5c] bg-[#0b3a5c]/8 ring-1 ring-[#0b3a5c]/30"
                          : "border-border bg-card hover:bg-muted/60",
                      )}
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0b3a5c]/10 text-sm font-bold text-[#0b3a5c]">
                        {(c.fullName || "?").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-foreground">
                          {c.fullName}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {mudirN} filial · {staffN} xodim
                          {c.phone ? ` · ${c.phone}` : ""}
                          {c.login ? ` · ${c.login}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { todayYmd, daysAgoYmd };
