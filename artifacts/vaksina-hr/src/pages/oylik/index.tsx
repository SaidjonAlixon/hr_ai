import React, { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  CalendarDays,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { userRoleLabel } from "@/lib/roles";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import { staffWorkplaceOf, type StaffWorkplace } from "@/lib/staff-workplace";
import { isVacancyPlaceholder } from "@/lib/vacancy-slot";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/I18nProvider";
import { MySlip, PayTable } from "./pay-table";
import {
  canApprovePayroll,
  canEditKpiSettings,
  canManagePayroll,
  currentMonthKey,
  monthLabelUz,
  shiftMonthKey,
  useApproveOylik,
  useReturnOylik,
  useOylikEmployees,
  useToggleWorkDay,
  downloadOylikExcel,
  type PayrollRow,
} from "@/lib/oylik-api";

function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const { locale } = useI18n();
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-white/10 p-0.5">
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/15 hover:text-white" onClick={() => onChange(shiftMonthKey(month, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[118px] px-1 text-center text-[13px] font-semibold">{monthLabelUz(month, locale)}</span>
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-white hover:bg-white/15 hover:text-white" onClick={() => onChange(shiftMonthKey(month, 1))} disabled={month >= currentMonthKey()}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function cleanBranch(raw: string | null | undefined): string {
  const name = displayBranchName(raw).trim();
  if (!name || name === "—" || name === "-") return "";
  return name;
}

function isPayrollPerson(row: PayrollRow): boolean {
  if (isVacancyPlaceholder({ fullName: row.fullName, userId: row.userId })) return false;
  if (!row.userId) {
    const name = row.fullName.trim().toLowerCase();
    const branch = cleanBranch(row.branch).toLowerCase();
    if (name && branch && name === branch) return false;
  }
  return true;
}

function rowWorkplace(row: PayrollRow): StaffWorkplace {
  return staffWorkplaceOf({
    role: row.roleLabel,
    position: row.position,
    location: cleanBranch(row.branch) || row.branch,
  });
}

function payrollShift(row: PayrollRow): { key: string; label: string } {
  const rawLabel = String(row.shiftLabel || "").trim();
  const compact = rawLabel.toLowerCase().replace(/\s+/g, "");
  const t = String(row.shiftType || "").trim().toLowerCase();
  const named = (key: string, label: string) => ({ key, label });
  if (compact.includes("1+2") || compact.includes("1-2") || t === "one_two" || t === "12") return named("12", "1+2");
  if (compact.includes("2+3") || compact.includes("2-3") || t === "two_three" || t === "23") return named("23", "2+3");
  if (t === "three" || t === "3" || compact.includes("3-smena") || compact === "3smena") return named("3", "3-smena");
  if (t === "two" || t === "2" || compact.includes("2-smena") || compact === "2smena") return named("2", "2-smena");
  if (rowWorkplace(row) === "ofis") {
    if (rawLabel && !compact.includes("ofis") && t !== "one" && t !== "1" && t !== "office" && t !== "") {
      return named(compact || "other", rawLabel);
    }
    return named("office", "Asosiy ofis");
  }
  if (t === "office" || compact.includes("ofis")) return named("office", "Asosiy ofis");
  if (t === "one" || t === "1" || compact.includes("1-smena") || compact === "1smena" || !t) return named("1", "1-smena");
  return named("other", rawLabel || "Boshqa");
}

function rowScope(row: PayrollRow): string {
  if (row.calendarScope) return row.calendarScope;
  const hay = `${row.roleLabel} ${row.position || ""}`.toLowerCase();
  if (/xavfsiz/.test(hay)) return "xavfsizlik";
  if (rowWorkplace(row) === "dorixona") return `dorixona:${payrollShift(row).key}`;
  return "ofis";
}

const DORIXONA_SHIFT_CHIPS = [
  { key: "1", label: "1-smena" },
  { key: "2", label: "2-smena" },
  { key: "3", label: "3-smena" },
  { key: "12", label: "1+2" },
  { key: "23", label: "2+3" },
];

function calendarMeta(scope: string): { title: string; hint: string } {
  if (scope === "ofis") {
    return {
      title: "Ofis ish kuni",
      hint: "Oddiy ofis xodimlarining hammasi shu kunlarda ishlaydi",
    };
  }
  if (scope === "xavfsizlik") {
    return {
      title: "Xavfsizlik ish kuni",
      hint: "Faqat xavfsizlik xodimlari. Ofis kalendaridan alohida",
    };
  }
  const shift = scope.replace(/^dorixona:/, "");
  const label = DORIXONA_SHIFT_CHIPS.find((s) => s.key === shift)?.label || shift;
  return {
    title: `${label} ish kuni`,
    hint: "Faqat shu dorixona smenasi. Boshqa smenalar o‘zgarmaydi",
  };
}

function WorkCalendar({
  month,
  workDays,
  canEdit,
  onToggle,
  pending,
  title,
  hint,
}: {
  month: string;
  workDays: string[];
  canEdit: boolean;
  onToggle: (day: string, isWork: boolean) => void;
  pending: boolean;
  title: string;
  hint: string;
}) {
  const { t } = useI18n();
  const set = new Set(workDays);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y!, m!, 0).getDate();
  const first = new Date(`${month}-01T12:00:00+05:00`);
  const pad = (first.getDay() + 6) % 7;
  const cells: Array<{ d: number | null; iso: string | null }> = [];
  for (let i = 0; i < pad; i++) cells.push({ d: null, iso: null });
  for (let d = 1; d <= last; d++) {
    const iso = `${month}-${String(d).padStart(2, "0")}`;
    cells.push({ d, iso });
  }
  const labels = [
    t("ui.weekday.mon"),
    t("ui.weekday.tue"),
    t("ui.weekday.wed"),
    t("ui.weekday.thu"),
    t("ui.weekday.fri"),
    t("ui.weekday.sat"),
    t("ui.weekday.sun"),
  ];
  return (
    <div className="dept-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold dept-accent-value">
          <CalendarDays className="h-4 w-4" /> {title}
        </p>
        <p className="text-xs text-muted-foreground">
          {hint} · {workDays.length} ish kuni
        </p>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted-foreground">
        {labels.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c.d || !c.iso) return <div key={`e-${i}`} />;
          const work = set.has(c.iso);
          const cls = cn(
            "flex h-8 items-center justify-center rounded-md text-[12px] font-semibold tabular-nums",
            work ? "bg-emerald-500 text-white dark:bg-emerald-600" : "bg-muted text-muted-foreground",
            canEdit && "cursor-pointer hover:ring-2 hover:ring-primary/30",
            pending && "opacity-70",
          );
          if (!canEdit) {
            return (
              <div key={c.iso} className={cls} title={work ? t("ui.workDay") : t("ui.dayOff")}>
                {c.d}
              </div>
            );
          }
          return (
            <button
              key={c.iso}
              type="button"
              disabled={pending}
              className={cls}
              title={work ? `${t("ui.workDay")} — ${t("ui.dayOff")}` : `${t("ui.dayOff")} — ${t("ui.workDay")}`}
              onClick={() => onToggle(c.iso!, !work)}
            >
              {c.d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function OylikPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [month, setMonth] = useState(currentMonthKey());
  const manage = canManagePayroll(user?.role);
  const [q, setQ] = useState("");
  const list = useOylikEmployees(month, q, manage);
  const approve = useApproveOylik();
  const ret = useReturnOylik();
  const toggleDay = useToggleWorkDay();
  const [exporting, setExporting] = useState(false);
  const [place, setPlace] = useState<StaffWorkplace | "">("");
  const [shift, setShift] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "approved" | "draft" | "returned">("");
  const [selected, setSelected] = useState<number[]>([]);

  const people = useMemo(
    () => (list.data?.items ?? []).filter(isPayrollPerson),
    [list.data?.items],
  );

  const placeCounts = useMemo(() => {
    let dorixona = 0;
    let ofis = 0;
    for (const r of people) {
      if (rowWorkplace(r) === "dorixona") dorixona += 1;
      else ofis += 1;
    }
    return { dorixona, ofis };
  }, [people]);

  const inPlace = useMemo(
    () => (place ? people.filter((r) => rowWorkplace(r) === place) : []),
    [people, place],
  );

  const shiftOptions = useMemo(() => {
    const countOf = (match: (scope: string) => boolean) => inPlace.filter((r) => match(rowScope(r))).length;
    if (place === "ofis") {
      return [
        { key: "office", label: "Asosiy ofis", count: countOf((s) => s === "ofis") },
        { key: "xavfsizlik", label: "Xavfsizlik", count: countOf((s) => s === "xavfsizlik") },
      ];
    }
    if (place === "dorixona") {
      const extras = new Map<string, string>();
      for (const r of inPlace) {
        const scope = rowScope(r);
        if (!scope.startsWith("dorixona:")) continue;
        const key = scope.slice("dorixona:".length);
        if (!DORIXONA_SHIFT_CHIPS.some((s) => s.key === key)) extras.set(key, payrollShift(r).label);
      }
      return [
        ...DORIXONA_SHIFT_CHIPS.map((s) => ({
          ...s,
          count: countOf((scope) => scope === `dorixona:${s.key}`),
        })),
        ...[...extras.entries()].map(([key, label]) => ({
          key,
          label,
          count: countOf((scope) => scope === `dorixona:${key}`),
        })),
      ];
    }
    return [];
  }, [inPlace, place]);

  const inShift = useMemo(() => {
    if (!shift) return inPlace;
    return inPlace.filter((r) => {
      const scope = rowScope(r);
      if (place === "ofis") return shift === "xavfsizlik" ? scope === "xavfsizlik" : scope === "ofis";
      return scope === `dorixona:${shift}`;
    });
  }, [inPlace, place, shift]);

  const statusCounts = useMemo(() => {
    let approved = 0;
    let draft = 0;
    let returned = 0;
    for (const r of inShift) {
      if (r.status === "approved") approved += 1;
      else if (r.status === "returned") returned += 1;
      else draft += 1;
    }
    return { approved, draft, returned, all: inShift.length };
  }, [inShift]);

  const filteredRows = useMemo(() => {
    if (!place) return [];
    let rows = inShift;
    if (statusFilter === "approved") rows = rows.filter((r) => r.status === "approved");
    if (statusFilter === "returned") rows = rows.filter((r) => r.status === "returned");
    if (statusFilter === "draft") rows = rows.filter((r) => r.status !== "approved" && r.status !== "returned");
    return rows;
  }, [inShift, place, statusFilter]);

  const activeScope = !place || !shift
    ? ""
    : place === "ofis"
      ? shift === "xavfsizlik" ? "xavfsizlik" : "ofis"
      : `dorixona:${shift}`;
  const activeCalendar = activeScope ? calendarMeta(activeScope) : null;

  return (
    <div className="dept-page">
      <div className="dept-hero dept-hero-primary">
        <div className="dept-hero-glow" />
        <div className="dept-hero-body flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="dept-eyebrow">Oylik · jarima</p>
            <h1 className="dept-title">Oylik</h1>
            <p className="dept-desc truncate">
              {user?.fullName} · {userRoleLabel(user?.role)} · Tasdiqlangach xodim o‘z oyligi va jarimasini ko‘radi
            </p>
          </div>
          <MonthNav month={month} onChange={setMonth} />
        </div>
      </div>

      <div className="dept-page-inner">

      {manage ? (
        <div className="space-y-3">
          <div className="dept-panel space-y-3 p-3">
            <div className="flex min-w-0 flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1">
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">Qidiruv</p>
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism, lavozim..." className="h-9 rounded-lg" />
                </div>
                {canApprovePayroll(user?.role) ? (
                  <>
                    <div>
                      <p className="mb-1 text-[11px] font-medium text-muted-foreground">Belgilanganlar · {selected.length}</p>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg"
                          disabled={approve.isPending || !selected.length}
                          onClick={() => {
                            const ids = filteredRows.filter((r) => r.userId && selected.includes(r.userId) && r.status !== "approved").map((r) => r.userId as number);
                            if (!ids.length) {
                              toast({ title: "Belgilanganlar orasida tasdiqlanadigani yo‘q" });
                              return;
                            }
                            approve.mutate({ month, userIds: ids }, { onSuccess: () => { setSelected([]); toast({ title: "Tasdiqlandi", description: `${ids.length} xodim. Shu oy xodimga ko‘rinadi.` }); } });
                          }}
                        >
                          <Lock className="mr-1 h-4 w-4" /> Tasdiqlash
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg"
                          disabled={ret.isPending || !selected.length}
                          onClick={() => {
                            const ids = filteredRows.filter((r) => r.userId && selected.includes(r.userId) && r.status === "approved").map((r) => r.userId as number);
                            if (!ids.length) {
                              toast({ title: "Qaytarish uchun tasdiqlanganlarni belgilang" });
                              return;
                            }
                            if (!window.confirm(`${ids.length} ta tasdiq qaytarilsinmi? Xodimda bu oy yopiladi. Boshqa oylar qoladi.`)) return;
                            ret.mutate({ month, userIds: ids }, { onSuccess: () => { setSelected([]); toast({ title: "Tasdiq qaytarildi", description: `${ids.length} xodim` }); } });
                          }}
                        >
                          Qaytarish
                        </Button>
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-medium text-muted-foreground">Shu tanlovdagi hammasi</p>
                      <Button
                        type="button"
                        className="h-9 rounded-lg"
                        disabled={approve.isPending || !place}
                        onClick={() => {
                          const ids = filteredRows.filter((r) => r.userId && r.status !== "approved").map((r) => r.userId as number);
                          if (!ids.length) {
                            toast({ title: "Hammasi tasdiqlangan" });
                            return;
                          }
                          if (!window.confirm(`${ids.length} ta xodim to‘liq tasdiqlansinmi? Faqat shu oy.`)) return;
                          approve.mutate({ month, userIds: ids }, { onSuccess: () => toast({ title: "To‘liq tasdiqlandi", description: `${ids.length} xodim` }) });
                        }}
                      >
                        To‘liq tasdiqlash
                      </Button>
                    </div>
                  </>
                ) : null}
                <div>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">Shu oy jadvali</p>
                  <Button
                    type="button"
                    className="h-9 rounded-lg"
                    disabled={exporting}
                    onClick={async () => {
                      setExporting(true);
                      try {
                        await downloadOylikExcel(month);
                        toast({ title: "Excel yuklandi" });
                      } catch (e) {
                        toast({ title: "Excel", description: (e as Error).message, variant: "destructive" });
                      } finally {
                        setExporting(false);
                      }
                    }}
                  >
                    <Download className="mr-1 h-4 w-4" /> Excel
                  </Button>
                </div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { key: "ofis" as const, label: "Ofis xodimlari", hint: "Oylik va jarima shu jadvalda", count: placeCounts.ofis },
                { key: "dorixona" as const, label: "Dorixona", hint: "Smena bo‘yicha oylik va jarima", count: placeCounts.dorixona },
              ]
            ).map((opt) => {
              const on = place === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    setPlace(on ? "" : opt.key);
                    setShift("");
                    setStatusFilter("");
                  }}
                  className={cn(
                    "flex items-center justify-between rounded-2xl border px-4 py-3 text-left",
                    on && opt.key === "dorixona" && "border-emerald-600 bg-emerald-700 text-white",
                    on && opt.key === "ofis" && "border-[#0b3a5c] bg-[#0b3a5c] text-white",
                    !on && "border-border bg-card text-foreground hover:bg-muted",
                  )}
                >
                  <span>
                    <span className="block text-sm font-semibold">{opt.label}</span>
                    <span className={cn("text-xs", on ? "text-white/75" : "text-muted-foreground")}>{opt.hint}</span>
                  </span>
                  <span className={cn("text-lg font-bold tabular-nums", on ? "text-white" : "text-foreground")}>
                    {list.isLoading ? "…" : opt.count}
                  </span>
                </button>
              );
            })}
          </div>
            {list.isLoading ? (
              <Skeleton className="h-72 rounded-xl" />
            ) : list.error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{(list.error as Error).message}</p>
            ) : (
              <div className="space-y-3">
                {place ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Smena</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShift("");
                        setStatusFilter("");
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold",
                        !shift ? "border-[#0b3a5c] bg-[#0b3a5c] text-white" : "border-border bg-card",
                      )}
                    >
                      Barcha smenalar
                      <span className="ml-1 tabular-nums opacity-80">{inPlace.length}</span>
                    </button>
                    {shiftOptions.map((opt) => {
                      const on = shift === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => {
                            setShift(on ? "" : opt.key);
                            setStatusFilter("");
                          }}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-semibold",
                            on ? "border-emerald-600 bg-emerald-700 text-white" : "border-border bg-card hover:bg-muted",
                          )}
                        >
                          {opt.label}
                          <span className={cn("ml-1 tabular-nums", on ? "text-white/80" : "text-muted-foreground")}>{opt.count}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {activeCalendar && activeScope ? (
                <WorkCalendar
                  month={month}
                  title={activeCalendar.title}
                  hint={activeCalendar.hint}
                  workDays={list.data?.calendars?.[activeScope] ?? []}
                  canEdit={canEditKpiSettings(user?.role)}
                  pending={toggleDay.isPending}
                  onToggle={(day, isWork) => {
                    toggleDay.mutate(
                      { day, isWork, scope: activeScope },
                      {
                        onSuccess: () =>
                          toast({
                            title: isWork ? `${day} — ish kuni` : `${day} — dam kuni`,
                            description: activeCalendar.title,
                          }),
                        onError: (e) =>
                          toast({ title: "Ish kuni saqlanmadi", description: (e as Error).message, variant: "destructive" }),
                      },
                    );
                  }}
                />
                ) : place ? (
                  <div className="dept-empty">
                    Ish kunini qo‘yish uchun smenani tanlang. Ofisda oddiy xodimlar bir kalendarda, xavfsizlik alohida, dorixonada har smena alohida.
                  </div>
                ) : null}
                {place ? (
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { key: "" as const, label: "Barchasi", count: statusCounts.all, on: "border-[#0b3a5c] bg-[#0b3a5c] text-white" },
                        { key: "approved" as const, label: "Tasdiqlangan", count: statusCounts.approved, on: "border-emerald-600 bg-emerald-600 text-white" },
                        { key: "draft" as const, label: "Tasdiqlanmagan", count: statusCounts.draft, on: "border-amber-500 bg-amber-500 text-white" },
                        { key: "returned" as const, label: "Qaytarilgan", count: statusCounts.returned, on: "border-rose-600 bg-rose-600 text-white" },
                      ]
                    ).map((opt) => {
                      const on = statusFilter === opt.key;
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => {
                            setStatusFilter(opt.key);
                          }}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-semibold",
                            on ? opt.on : "border-border bg-card",
                          )}
                        >
                          {opt.label}
                          <span className="ml-1 tabular-nums opacity-80">{opt.count}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {!place ? (
                  <div className="dept-empty">
                    Ofis xodimlari yoki dorixonani tanlang. Ichida smena bo‘yicha ajratiladi.
                  </div>
                ) : (
                <>
                <p className="text-xs text-muted-foreground">Har oy alohida saqlanadi. Tasdiqlangan oy xodimda qoladi va keyingi oylar unga qo‘shiladi. Qaytarilsa faqat shu oy yopiladi.</p>
                <PayTable
                  rows={filteredRows}
                  month={month}
                  canEdit={canEditKpiSettings(user?.role)}
                  selected={selected}
                  onToggle={(id) => setSelected((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])}
                  onTogglePage={(ids, on) => setSelected((cur) => on ? [...new Set([...cur, ...ids])] : cur.filter((id) => !ids.includes(id)))}
                />
                </>
                )}
              </div>
            )}
        </div>
      ) : (
        <MySlip month={month} />
      )}
      </div>
    </div>
  );
}
