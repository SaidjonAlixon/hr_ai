import React, {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useGetDepartments } from "@workspace/api-client-react";
import { useLocation, useSearch } from "wouter";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileDown,
  FileSpreadsheet,
  LineChart,
  Loader2,
  LogIn,
  LogOut,
  MoveHorizontal,
  Percent,
  Search,
  UserCheck,
  Users,
  Pencil,
  BadgeCheck,
  RotateCcw,
  Receipt,
  UserX,
  Timer,
  MessageSquareText,
  Moon,
  Palmtree,
  AlarmClock,
  ClipboardList,
} from "lucide-react";
import { DavomatJarimaCard, DavomatJarimaPanel } from "../oylik/pay-table";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { Calendar as DayPickerCalendar } from "../../components/ui/calendar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../components/ui/command";
import { Label } from "../../components/ui/label";
import { Tabs, TabsContent } from "../../components/ui/tabs";
import { useToast } from "../../hooks/use-toast";
import { cn } from "../../lib/utils";
import { scriptIncludes } from "../../lib/script-search";
import {
  downloadDavomatExcel,
  downloadDavomatDayPdf,
  fetchDavomat,
  resetDavomatManual,
  type DavomatResetPart,
  saveDavomatExcuse,
  saveDavomatManual,
  fetchEmployeeSchedule,
  saveEmployeeSchedule,
  clearEmployeeSchedule,
  type ScheduleShiftOption,
  type DavomatDayMetrics,
  type DavomatEmployee,
  type DavomatReport,
} from "../../lib/davomat-api";
import { downloadDavomatPdf } from "../../lib/davomat-pdf-export";
import { DavomatAnalyticsDashboard } from "./analytics";
import { useAuth } from "../../contexts/AuthContext";
import { useI18n } from "../../i18n/I18nProvider";
import { displayBranchName } from "../../lib/pharmacy-staff-api";
import {
  canEditDavomatManual,
  canMarkDavomatExcuse,
  canResetDavomatManual,
  canSetEmployeeSchedule,
  canViewChecklistStatus,
  canViewDavomat,
  canViewDavomatNotes,
  normalizeUserRole,
  userRoleLabel,
} from "../../lib/roles";
import {
  type DavomatStaffFilter,
  type OfficeInnerFilter,
  matchesStaffFilter,
  matchesOfficeInner,
  STAFF_FILTER_OPTIONS,
  OFFICE_INNER_OPTIONS,
  staffFilterLabel,
  classifyDavomatStaff,
  isDistribStaff,
  isSecurityStaff,
  isWarehouseStaff,
  smenaLabelShort,
  workHoursForEmployee,
  workHoursForStaffFilter,
  matchesWarehouseShift,
  warehouseShiftOptions,
  matchesPharmacyShift,
  pharmacyShiftBucket,
  PHARMACY_SHIFT_OPTIONS,
  type PharmacyShiftFilter,
} from "../../lib/davomat-staff-filter";

const SmenaFilialPage = lazy(() => import("../smena-filial"));
const ChecklistHolatiPage = lazy(() => import("../checklist-holati"));

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return dt.toISOString().slice(0, 10);
}

/** Dushanba (Toshkent, UTC+5 — YYYY-MM-DD allaqachon kun) */
function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y!, m! - 1, d!);
  const dow = new Date(utc).getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDaysYmd(ymd, offset);
}

function firstOfMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function lastOfMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

const MONTHS_UZ = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS_UZ = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const WEEKDAYS_RU = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

/** 2026-09-28 → 28 sentabr 2026, dushanba / 28 сентября 2026, понедельник */
function formatLongDate(ymd: string, locale: "uz" | "ru"): string {
  const d = parseYmdLocal(ymd);
  if (!d) return ymd;
  const day = d.getDate();
  const month = (locale === "ru" ? MONTHS_RU : MONTHS_UZ)[d.getMonth()];
  const weekday = (locale === "ru" ? WEEKDAYS_RU : WEEKDAYS_UZ)[d.getDay()];
  return `${day} ${month} ${d.getFullYear()}, ${weekday}`;
}

/** ISO vaqt → «2-oktabr 2026-yil, juma, soat 12:34» (Toshkent) */
function formatExcuseStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(pick("year"));
  const month = Number(pick("month"));
  const day = Number(pick("day"));
  if (!year || !month || !day) return iso;
  const monthName = MONTHS_UZ[month - 1] ?? String(month);
  const weekday = WEEKDAYS_UZ[new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()] ?? "";
  return `${day}-${monthName} ${year}-yil, ${weekday}, soat ${pick("hour")}:${pick("minute")}`;
}

/** 2026-09-07 → 07.09.2026 */
function formatYmdDot(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmdLocal(ymd: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

const MONTH_KEYS = [
  "month.1",
  "month.2",
  "month.3",
  "month.4",
  "month.5",
  "month.6",
  "month.7",
  "month.8",
  "month.9",
  "month.10",
  "month.11",
  "month.12",
] as const;

function monthLabelUz(ymd: string, t: (k: string) => string): string {
  const [y, m] = ymd.split("-").map(Number);
  const name = t(MONTH_KEYS[(m ?? 1) - 1] ?? "ui.month");
  return `${name} ${y}`;
}

const WEEKDAY_KEYS = [
  "ui.weekday.mon",
  "ui.weekday.tue",
  "ui.weekday.wed",
  "ui.weekday.thu",
  "ui.weekday.fri",
  "ui.weekday.sat",
  "ui.weekday.sun",
] as const;

function weekdayShort(ymd: string, t: (k: string) => string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  const idx = dow === 0 ? 6 : dow - 1;
  return t(WEEKDAY_KEYS[idx] ?? "ui.weekday.mon");
}

const STATUS_KEYS: Record<string, string> = {
  present: "davomat.arrived",
  late: "davomat.late",
  incomplete: "davomat.incomplete",
  absent: "davomat.absent",
  leave: "davomat.leave",
  rest: "davomat.rest",
};

const STATUS_STYLE: Record<string, string> = {
  present: "border-emerald-400 bg-emerald-500/15 text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/20 dark:text-emerald-300",
  late: "border-amber-400 bg-amber-500/15 text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-300",
  incomplete: "border-sky-400 bg-sky-500/15 text-sky-900 dark:border-sky-500/50 dark:bg-sky-500/20 dark:text-sky-300",
  absent: "border-rose-400 bg-rose-500/15 text-rose-800 dark:border-rose-500/50 dark:bg-rose-500/20 dark:text-rose-300",
  leave: "border-violet-400 bg-violet-500/15 text-violet-900 dark:border-violet-500/50 dark:bg-violet-500/20 dark:text-violet-300",
  rest: "border-slate-400 bg-slate-500/15 text-slate-700 dark:border-slate-500/50 dark:bg-slate-500/20 dark:text-slate-300",
  prehire: "border-rose-500 bg-rose-600/20 text-rose-800 dark:border-rose-500/60 dark:bg-rose-500/25 dark:text-rose-200",
  outside: "border-transparent bg-transparent text-transparent",
};

const STATUS_DOT: Record<string, string> = {
  present: "bg-emerald-500",
  late: "bg-amber-500",
  incomplete: "bg-sky-500",
  absent: "bg-rose-500",
  leave: "bg-violet-500",
  rest: "bg-slate-400",
};

/** Haftalik jadval kataklari — qisqa matn */
const WEEK_CELL_STATUS_KEYS: Record<string, string> = {
  present: "davomat.came",
  late: "davomat.late",
  incomplete: "davomat.incompleteShort",
  absent: "davomat.absent",
  leave: "davomat.leaveShort",
  rest: "davomat.restShort",
};

function compactDuration(label: string): string {
  return label
    .replace(/\s*soat\s*/gi, "s ")
    .replace(/\s*daq/gi, "d")
    .replace(/^−/, "-")
    .trim();
}

function weekCellSublineParts(day: DavomatDayMetrics): {
  worked?: string;
  late?: string;
  earlyLeave?: string;
  overtime?: string;
} | null {
  const worked =
    day.workedHours && day.workedHours !== "0:00" && day.workedHours !== "—"
      ? day.workedHours
      : undefined;
  const late =
    day.lateArrivalLabel && day.lateArrivalLabel !== "—"
      ? `-${compactDuration(day.lateArrivalLabel)}`
      : undefined;
  const earlyLeave =
    day.earlyLeaveLabel && day.earlyLeaveLabel !== "—"
      ? `-${compactDuration(day.earlyLeaveLabel)}`
      : undefined;
  const overtime =
    day.overtimeLabel && day.overtimeLabel !== "—"
      ? `+${compactDuration(day.overtimeLabel)}`
      : undefined;

  if (!worked && !late && !earlyLeave && !overtime) return null;
  return { worked, late, earlyLeave, overtime };
}

const STATUS_ROW: Record<string, string> = {
  present: "bg-emerald-50/40 dark:bg-emerald-500/10",
  late: "bg-amber-50/50 dark:bg-amber-500/10",
  incomplete: "bg-sky-50/40 dark:bg-sky-500/10",
  absent: "bg-rose-50/30 dark:bg-rose-500/10",
  leave: "bg-violet-50/40 dark:bg-violet-500/10",
};

const EXCUSED_ROW = "bg-teal-50/80 dark:bg-teal-500/10";
const EXCUSED_STYLE =
  "border-teal-400 bg-teal-500/15 text-teal-950 dark:border-teal-400/60 dark:bg-teal-500/20 dark:text-teal-200";

function StatusPill({
  status,
  excused,
  onClick,
}: {
  status: string;
  excused?: boolean;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const label = excused
    ? "Sababli"
    : status === "prehire"
      ? "Ishga qabul qilinmagan"
      : status === "outside"
        ? ""
        : t(STATUS_KEYS[status] || status, status);
  const className = cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
    excused ? EXCUSED_STYLE : STATUS_STYLE[status] || "border-border bg-muted text-muted-foreground",
    onClick && "cursor-pointer hover:brightness-95",
  );
  const inner = (
    <>
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          excused ? "bg-teal-500" : STATUS_DOT[status] || "bg-slate-400",
        )}
        aria-hidden
      />
      <span className="whitespace-nowrap">{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} title="Sababli holatni ko‘rish">
        {inner}
      </button>
    );
  }
  return <span className={className}>{inner}</span>;
}

type EditState = {
  employeeId: number;
  fullName: string;
  workDate: string;
  checkIn: string;
  checkOut: string;
  status: string;
  notes: string;
};

type ResetTarget = {
  employeeId: number;
  fullName: string;
  workDate: string;
  checkIn: string | null;
  checkOut: string | null;
};

function dayHasPunch(day?: DavomatDayMetrics | null): boolean {
  if (!day) return false;
  return Boolean(
    day.recordId ||
      (day.checkIn && day.checkIn !== "—") ||
      (day.checkOut && day.checkOut !== "—"),
  );
}

type Section = "schedule" | "totals" | "analytics" | "smena" | "checklist" | "jarima";

function sectionFromLocation(path: string, search: string): Section | null {
  if (path.startsWith("/davomat/analytics")) return "analytics";
  const view = new URLSearchParams(search).get("view");
  if (
    view === "analytics" ||
    view === "totals" ||
    view === "schedule" ||
    view === "smena" ||
    view === "checklist" ||
    view === "jarima"
  ) {
    return view;
  }
  return null;
}
type CalMode = "day" | "week" | "month" | "range";
type DayStatusFilter = "all" | "present" | "absent" | "late" | "leave" | "rest";

function dayHasCheckIn(day?: { checkIn?: string | null } | null): boolean {
  return Boolean(day?.checkIn && day.checkIn !== "—");
}

function matchesDayStatusFilter(
  day: { status?: string; checkIn?: string | null } | null | undefined,
  filter: DayStatusFilter,
): boolean {
  if (filter === "all") return true;
  const st = day?.status || "absent";
  if (st === "prehire" || st === "outside") return false;
  const came = dayHasCheckIn(day);
  if (filter === "absent") return !came && st !== "leave" && st !== "rest";
  if (filter === "late") return came && st === "late";
  if (filter === "leave") return st === "leave" && !came;
  if (filter === "rest") return st === "rest" && !came;
  return came;
}

function branchIdentity(location: string | null | undefined): { key: string; label: string } | null {
  const name = displayBranchName(location).replace(/\s+/g, " ").trim();
  if (!name || name === "—" || name === "-" || /^filial$/i.test(name)) return null;
  return { key: name.toLocaleLowerCase("uz"), label: name };
}

function resolvedBranch(
  emp: DavomatEmployee,
  byId: Map<number, DavomatEmployee>,
): { key: string; label: string } {
  const seen = new Set<number>();
  let cursor: DavomatEmployee | undefined = emp;
  for (let i = 0; i < 6 && cursor; i++) {
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    const hit = branchIdentity(cursor.location);
    if (hit) return hit;
    cursor = cursor.reportsToId != null ? byId.get(cursor.reportsToId) : undefined;
  }
  return { key: "none", label: "Filialsiz" };
}

function PharmacyBranchPicker({
  value,
  onChange,
  options,
  total,
}: {
  value: string;
  onChange: (key: string) => void;
  options: { key: string; label: string; count: number }[];
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.key === value);
  const label = value === "all" ? `Barcha filiallar (${total})` : selected ? `${selected.label} (${selected.count})` : "Filial";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-10 w-full justify-between rounded-xl border-border bg-card px-2.5 text-sm font-normal shadow-none hover:bg-emerald-50/70 dark:border-white/10 dark:bg-[#152238] dark:text-slate-100 dark:hover:bg-emerald-500/10",
            value !== "all" &&
              "border-emerald-400 bg-emerald-50 text-emerald-950 dark:border-emerald-400/50 dark:bg-emerald-500/15 dark:text-emerald-100",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
            <span className="truncate text-left">{label}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[90] w-[var(--radix-popover-trigger-width)] min-w-[16rem] overflow-hidden rounded-xl p-0 shadow-lg"
        align="start"
      >
        <Command
          filter={(itemValue, query) => {
            return scriptIncludes(itemValue, query) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Filial nomini yozing…" />
          <CommandList className="max-h-72">
            <CommandEmpty>Bunday filial topilmadi</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="barcha filiallar"
                onSelect={() => {
                  onChange("all");
                  setOpen(false);
                }}
                className={cn("rounded-lg", value === "all" && "bg-emerald-50 text-emerald-950")}
              >
                <Check className={cn("text-emerald-700", value === "all" ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">Barcha filiallar</span>
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">{total}</span>
              </CommandItem>
              {options.map((o) => {
                const active = o.key === value;
                return (
                  <CommandItem
                    key={o.key}
                    value={`${o.label} ${o.key}`}
                    onSelect={() => {
                      onChange(o.key);
                      setOpen(false);
                    }}
                    className={cn("rounded-lg", active && "bg-emerald-50 text-emerald-950")}
                  >
                    <Check className={cn("text-emerald-700", active ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className="text-xs font-semibold tabular-nums text-muted-foreground">{o.count}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PharmacyCoordinatorPicker({
  value,
  onChange,
  options,
  total,
}: {
  value: string;
  onChange: (key: string) => void;
  options: { key: string; label: string; count: number }[];
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.key === value);
  const label = value === "all" ? `Barcha koordinatorlar (${total})` : selected ? `${selected.label} (${selected.count})` : "Koordinator";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-10 w-full justify-between rounded-xl border-border bg-card px-2.5 text-sm font-normal shadow-none hover:bg-indigo-50/70 dark:border-white/10 dark:bg-[#152238] dark:text-slate-100 dark:hover:bg-indigo-500/10",
            value !== "all" &&
              "border-indigo-400 bg-indigo-50 text-indigo-950 dark:border-indigo-400/50 dark:bg-indigo-500/15 dark:text-indigo-100",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Users className="h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-300" />
            <span className="truncate text-left">{label}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[90] w-[var(--radix-popover-trigger-width)] min-w-[16rem] overflow-hidden rounded-xl p-0 shadow-lg"
        align="start"
      >
        <Command
          filter={(itemValue, query) => {
            return scriptIncludes(itemValue, query) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Koordinator ismini yozing…" />
          <CommandList className="max-h-72">
            <CommandEmpty>Bunday koordinator topilmadi</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="barcha koordinatorlar"
                onSelect={() => {
                  onChange("all");
                  setOpen(false);
                }}
                className={cn("rounded-lg", value === "all" && "bg-indigo-50 text-indigo-950")}
              >
                <Check className={cn("text-indigo-700", value === "all" ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">Barcha koordinatorlar</span>
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">{total}</span>
              </CommandItem>
              {options.map((o) => {
                const active = o.key === value;
                return (
                  <CommandItem
                    key={o.key}
                    value={`${o.label} ${o.key}`}
                    onSelect={() => {
                      onChange(o.key);
                      setOpen(false);
                    }}
                    className={cn("rounded-lg", active && "bg-indigo-50 text-indigo-950")}
                  >
                    <Check className={cn("text-indigo-700", active ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className="text-xs font-semibold tabular-nums text-muted-foreground">{o.count}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function DavomatPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [location] = useLocation();
  const urlSearch = useSearch();
  const allowed = canViewDavomat(user?.role);
  const pharmacyScope = normalizeUserRole(user?.role) === "koordinator";
  const canEdit = canEditDavomatManual(user?.role);
  const canReset = canResetDavomatManual(user?.role);
  const canExcuse = canMarkDavomatExcuse(user?.role);
  const canSchedule = canSetEmployeeSchedule(user?.role);
  const canSeeNotes = canViewDavomatNotes(user?.role);
  const canChecklist = canViewChecklistStatus(user?.role);

  const [section, setSection] = useState<Section>(() => sectionFromLocation(location, urlSearch) ?? "schedule");

  useEffect(() => {
    const next = sectionFromLocation(location, urlSearch);
    if (next) setSection(next);
  }, [location, urlSearch]);

  useEffect(() => {
    if (section === "checklist" && !canChecklist) setSection("schedule");
  }, [section, canChecklist]);
  const [calMode, setCalMode] = useState<CalMode>("day");
  const [selectedDay, setSelectedDay] = useState(() => todayYmd());
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayYmd()));
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(() => firstOfMonth(todayYmd()));
  const [rangeFrom, setRangeFrom] = useState(() => addDaysYmd(todayYmd(), -6));
  const [rangeTo, setRangeTo] = useState(() => todayYmd());
  const [periodFrom, setPeriodFrom] = useState(() => addDaysYmd(todayYmd(), -13));
  const [periodTo, setPeriodTo] = useState(() => todayYmd());
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [staffFilter, setStaffFilter] = useState<DavomatStaffFilter>("office");
  const [officeInner, setOfficeInner] = useState<OfficeInnerFilter>("all");
  const [warehouseShift, setWarehouseShift] = useState<string>("all");
  const [pharmacyShift, setPharmacyShift] = useState<PharmacyShiftFilter>("all");
  const [pharmacyCoordinator, setPharmacyCoordinator] = useState("all");
  const [pharmacyBranch, setPharmacyBranch] = useState("all");
  const viewFilter: DavomatStaffFilter = pharmacyScope ? "pharmacy" : staffFilter;

  useEffect(() => {
    if (viewFilter !== "office" || officeInner !== "warehouse") setWarehouseShift("all");
    if (viewFilter !== "pharmacy") {
      setPharmacyShift("all");
      setPharmacyCoordinator("all");
      setPharmacyBranch("all");
    }
  }, [viewFilter, officeInner]);

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const [dayStatusFilter, setDayStatusFilter] = useState<DayStatusFilter>("all");
  const [selectedEmpId, setSelectedEmpId] = useState<number | "all">("all");
  const [report, setReport] = useState<DavomatReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [noteView, setNoteView] = useState<{
    fullName: string;
    workDate: string;
    notes: string;
    excused?: boolean;
    status?: string;
    excusedByName?: string | null;
    excusedAt?: string | null;
  } | null>(null);
  const [excuse, setExcuse] = useState<{
    employeeId: number;
    fullName: string;
    workDate: string;
    status: string;
    note: string;
  } | null>(null);
  const [schedule, setSchedule] = useState<{
    employeeId: number;
    fullName: string;
    workDate: string;
    mode: "permanent" | "period";
    validFrom: string;
    validTo: string;
    shiftKey: string;
    startHm: string;
    endHm: string;
    shifts: ScheduleShiftOption[];
    currentId: number | null;
    loading: boolean;
  } | null>(null);
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState<DavomatResetPart | null>(null);

  const { data: departments } = useGetDepartments();

  const from =
    section === "totals"
      ? periodFrom
      : calMode === "week"
        ? weekStart
        : calMode === "month"
          ? firstOfMonth(monthAnchor)
          : calMode === "range"
            ? rangeFrom <= rangeTo
              ? rangeFrom
              : rangeTo
            : selectedDay;
  const to =
    section === "totals"
      ? periodTo
      : calMode === "week"
        ? addDaysYmd(weekStart, 6)
        : calMode === "month"
          ? lastOfMonth(monthAnchor)
          : calMode === "range"
            ? rangeFrom <= rangeTo
              ? rangeTo
              : rangeFrom
            : selectedDay;

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!allowed) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const data = await fetchDavomat({
        from,
        to,
        search: searchDebounced || undefined,
        departmentId: pharmacyScope || deptFilter === "all" ? undefined : deptFilter,
        staffFilter: viewFilter !== "all" ? viewFilter : undefined,
      });
      if (seq !== loadSeq.current) return;
      startTransition(() => {
        setReport(data);
      });
    } catch (err) {
      if (seq !== loadSeq.current) return;
      toast({
        title: "Yuklanmadi",
        description: (err as Error)?.message,
        variant: "destructive",
      });
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [allowed, from, to, searchDebounced, deptFilter, pharmacyScope, viewFilter, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const dayInfo = useMemo(
    () => report?.days.find((d) => d.date === selectedDay) ?? report?.days[0] ?? null,
    [report, selectedDay],
  );

  const farOfficeIds = useMemo(() => {
    const day = report?.days.find((d) => d.date === (dayInfo?.date || selectedDay));
    return new Set((day?.farFromOffice ?? []).map((f) => f.employeeId));
  }, [report, dayInfo?.date, selectedDay]);

  const pharmacyBranchById = useMemo(() => {
    const map = new Map<number, { key: string; label: string }>();
    if (!report) return map;
    const byId = new Map(report.employees.map((e) => [e.id, e]));
    for (const emp of report.employees) map.set(emp.id, resolvedBranch(emp, byId));
    return map;
  }, [report]);

  const filteredEmployees = useMemo(() => {
    if (!report) return [];
    return report.employees.filter(
      (emp) =>
        matchesStaffFilter(emp, viewFilter, farOfficeIds) &&
        (viewFilter !== "office" || matchesOfficeInner(emp, officeInner)) &&
        (viewFilter !== "office" || officeInner !== "warehouse" || matchesWarehouseShift(emp, warehouseShift)) &&
        (viewFilter !== "pharmacy" || matchesPharmacyShift(emp, pharmacyShift)) &&
        (viewFilter !== "pharmacy" ||
          pharmacyCoordinator === "all" ||
          String(emp.coordinatorId ?? "none") === pharmacyCoordinator) &&
        (viewFilter !== "pharmacy" ||
          pharmacyBranch === "all" ||
          (pharmacyBranchById.get(emp.id)?.key ?? "none") === pharmacyBranch),
    );
  }, [report, viewFilter, officeInner, warehouseShift, pharmacyShift, pharmacyCoordinator, pharmacyBranch, pharmacyBranchById, farOfficeIds]);

  const pharmacyShiftCounts = useMemo(() => {
    const counts = { all: 0, shift_one: 0, shift_two: 0, shift_12: 0, shift_23: 0 };
    if (viewFilter !== "pharmacy" || !report) return counts;
    for (const emp of report.employees) {
      if (!matchesStaffFilter(emp, "pharmacy")) continue;
      if (pharmacyCoordinator !== "all" && String(emp.coordinatorId ?? "none") !== pharmacyCoordinator) continue;
      if (pharmacyBranch !== "all" && (pharmacyBranchById.get(emp.id)?.key ?? "none") !== pharmacyBranch) continue;
      counts.all += 1;
      if (matchesPharmacyShift(emp, "shift_two")) counts.shift_two += 1;
      else if (matchesPharmacyShift(emp, "shift_12")) counts.shift_12 += 1;
      else if (matchesPharmacyShift(emp, "shift_23")) counts.shift_23 += 1;
      else if (matchesPharmacyShift(emp, "shift_one")) counts.shift_one += 1;
    }
    return counts;
  }, [report, viewFilter, pharmacyCoordinator, pharmacyBranch, pharmacyBranchById]);

  const pharmacyBranches = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    if (viewFilter !== "pharmacy" || !report) return [];
    for (const emp of report.employees) {
      if (!matchesStaffFilter(emp, "pharmacy")) continue;
      if (pharmacyCoordinator !== "all" && String(emp.coordinatorId ?? "none") !== pharmacyCoordinator) continue;
      const branch = pharmacyBranchById.get(emp.id) ?? { key: "none", label: "Filialsiz" };
      const cur = map.get(branch.key) ?? { key: branch.key, label: branch.label, count: 0 };
      if (matchesPharmacyShift(emp, pharmacyShift)) cur.count += 1;
      map.set(branch.key, cur);
    }
    return [...map.values()]
      .filter((b) => b.count > 0)
      .sort((a, b) => {
        if (a.key === "none") return 1;
        if (b.key === "none") return -1;
        return a.label.localeCompare(b.label, "uz");
      });
  }, [report, viewFilter, pharmacyShift, pharmacyCoordinator, pharmacyBranchById]);

  const pharmacyCoordinators = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();
    if (viewFilter !== "pharmacy" || !report) return [];
    for (const emp of report.employees) {
      if (!matchesStaffFilter(emp, "pharmacy")) continue;
      if (!matchesPharmacyShift(emp, pharmacyShift)) continue;
      const key = emp.coordinatorId != null ? String(emp.coordinatorId) : "none";
      const label = emp.coordinatorName?.trim() || "Koordinatorsiz";
      const cur = map.get(key) ?? { key, label, count: 0 };
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.values()]
      .filter((c) => c.count > 0 && c.key !== "none")
      .sort((a, b) => a.label.localeCompare(b.label, "uz"));
  }, [report, viewFilter, pharmacyShift]);

  const officeInnerCounts = useMemo(() => {
    const counts = { all: 0, desk: 0, distrib: 0, warehouse: 0, security: 0 };
    if (viewFilter !== "office" || !report) return counts;
    for (const emp of report.employees) {
      if (!matchesStaffFilter(emp, "office")) continue;
      counts.all += 1;
      if (isSecurityStaff(emp)) counts.security += 1;
      else if (isDistribStaff(emp)) counts.distrib += 1;
      else if (isWarehouseStaff(emp)) counts.warehouse += 1;
      else counts.desk += 1;
    }
    return counts;
  }, [report, viewFilter]);

  const selectedPharmacyShift =
    viewFilter === "pharmacy" ? PHARMACY_SHIFT_OPTIONS.find((o) => o.key === pharmacyShift) ?? null : null;
  const selectedPharmacyBranch =
    viewFilter === "pharmacy" && pharmacyBranch !== "all"
      ? pharmacyBranches.find((b) => b.key === pharmacyBranch) ?? null
      : null;
  const selectedPharmacyCoordinator =
    viewFilter === "pharmacy" && pharmacyCoordinator !== "all"
      ? pharmacyCoordinators.find((c) => c.key === pharmacyCoordinator) ?? null
      : null;

  useEffect(() => {
    if (pharmacyBranch === "all" || viewFilter !== "pharmacy") return;
    if (!pharmacyBranches.some((b) => b.key === pharmacyBranch)) setPharmacyBranch("all");
  }, [pharmacyBranches, pharmacyBranch, viewFilter]);

  useEffect(() => {
    if (pharmacyCoordinator === "all" || viewFilter !== "pharmacy") return;
    if (!pharmacyCoordinators.some((c) => c.key === pharmacyCoordinator)) setPharmacyCoordinator("all");
  }, [pharmacyCoordinators, pharmacyCoordinator, viewFilter]);

  const whShiftOptions = useMemo(
    () =>
      viewFilter === "office" && officeInner === "warehouse" && report
        ? warehouseShiftOptions(report.employees)
        : [],
    [report, viewFilter, officeInner],
  );

  useEffect(() => {
    if (warehouseShift === "all" || !report) return;
    if (!whShiftOptions.some((o) => o.key === warehouseShift)) setWarehouseShift("all");
  }, [whShiftOptions, warehouseShift, report]);

  const selectedWhShift = useMemo(
    () => whShiftOptions.find((o) => o.key === warehouseShift) ?? null,
    [whShiftOptions, warehouseShift],
  );

  /** Aralash ish vaqtli ro‘yxat — har bir xodim uchun alohida smena ustuni kerak */
  const showShiftCol =
    viewFilter === "all" ||
    (viewFilter === "office" &&
      (officeInner === "all" ||
        officeInner === "security" ||
        (officeInner === "warehouse" && !selectedWhShift?.hours))) ||
    (viewFilter === "pharmacy" && !selectedPharmacyShift);

  const staffGroupLabel =
    viewFilter === "office" && officeInner === "warehouse" && selectedWhShift
      ? `Ofis · Omborxona · ${selectedWhShift.label}`
      : viewFilter === "office" && officeInner === "warehouse"
        ? "Ofis · Omborxona"
        : viewFilter === "office" && officeInner === "security"
          ? "Ofis · Xavfsizlik"
          : viewFilter === "office" && officeInner === "desk"
            ? "Ofis · 09:00–18:00"
            : selectedPharmacyBranch && selectedPharmacyShift
              ? `Dorixona · ${selectedPharmacyBranch.label} · ${selectedPharmacyShift.label}`
              : selectedPharmacyBranch
                ? `Dorixona · ${selectedPharmacyBranch.label}`
                : selectedPharmacyShift
                  ? `Dorixona · ${selectedPharmacyShift.label}`
                  : pharmacyScope
                    ? "Dorixona · barcha smenalar"
                    : staffFilterLabel(viewFilter);

  const employeesForDay = useMemo(() => {
    if (!report) return [] as Array<{ emp: (typeof filteredEmployees)[number]; day: (typeof filteredEmployees)[number]["days"][number] }>;
    const date = dayInfo?.date || selectedDay;
    const rows: Array<{ emp: (typeof filteredEmployees)[number]; day: (typeof filteredEmployees)[number]["days"][number] }> = [];
    for (const e of filteredEmployees) {
      const day = e.days.find((d) => d.date === date);
      if (day && day.status !== "outside") rows.push({ emp: e, day });
    }
    rows.sort((a, b) => a.emp.fullName.localeCompare(b.emp.fullName, "uz"));
    return rows;
  }, [report, selectedDay, dayInfo, filteredEmployees]);

  const filteredDayStats = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    let incomplete = 0;
    let leave = 0;
    let rest = 0;
    const leaveNames: string[] = [];
    const restNames: string[] = [];
    for (const { emp, day } of employeesForDay) {
      if (!day) continue;
      const came = Boolean(day.checkIn && day.checkIn !== "—");
      if (day.status === "prehire" || day.status === "outside") continue;
      if (day.excused) {
        if (came) present += 1;
        continue;
      }
      if (!came && day.status === "leave") {
        leave += 1;
        leaveNames.push(emp.fullName);
      } else if (!came && day.status === "rest") {
        rest += 1;
        restNames.push(emp.fullName);
      } else if (!came) {
        absent += 1;
      } else {
        present += 1;
        if (day.status === "late") late += 1;
        if (day.status === "incomplete" || day.missingCheckout) incomplete += 1;
      }
    }
    return {
      present,
      late,
      absent,
      incomplete,
      leave,
      rest,
      leaveNames,
      restNames,
      total: employeesForDay.length,
    };
  }, [employeesForDay]);

  const visibleEmployeesForDay = useMemo(
    () =>
      employeesForDay.filter(({ day }) => matchesDayStatusFilter(day, dayStatusFilter)),
    [employeesForDay, dayStatusFilter],
  );

  function toggleDayStatusFilter(next: DayStatusFilter) {
    setDayStatusFilter((prev) => (prev === next ? "all" : next));
    setSection("schedule");
    setCalMode("day");
  }

  /** «Xodimlar jami» kartalari — filtrlangan, tushunarli analitika */
  const periodAnalytics = useMemo(() => {
    const emps = filteredEmployees;
    const dayCount = report?.dates?.length || report?.summary.days || 0;
    let presentDays = 0;
    let absentDays = 0;
    let lateDays = 0;
    let workedMin = 0;
    let lateMin = 0;
    let latePeople = 0;
    let everAbsentPeople = 0;
    let perfectPeople = 0;

    for (const e of emps) {
      presentDays += e.totals.present;
      absentDays += e.totals.absent;
      lateDays += e.totals.late;
      workedMin += e.totals.workedMinutes;
      lateMin += e.totals.lateArrivalMin;
      if (e.totals.late > 0 || e.totals.lateArrivalMin > 0) latePeople += 1;
      if (e.totals.absent > 0) everAbsentPeople += 1;
      if (e.totals.absent === 0 && e.totals.present > 0) perfectPeople += 1;
    }

    const trackedDays = presentDays + absentDays;
    const attendancePct = trackedDays > 0 ? Math.round((presentDays / trackedDays) * 100) : 0;
    const avgWorkedMin = emps.length > 0 ? Math.round(workedMin / emps.length) : 0;

    const fmtDur = (min: number) => {
      const m = Math.max(0, Math.round(min));
      const h = Math.floor(m / 60);
      const r = m % 60;
      if (h <= 0) return `${r} daq`;
      if (r === 0) return `${h} soat`;
      return `${h} soat ${r} daq`;
    };

    return {
      employees: emps.length,
      dayCount,
      presentDays,
      absentDays,
      lateDays,
      attendancePct,
      latePeople,
      everAbsentPeople,
      perfectPeople,
      workedLabel: fmtDur(workedMin),
      lateLabel: lateMin > 0 ? fmtDur(lateMin) : "0 daq",
      avgWorkedLabel: fmtDur(avgWorkedMin),
    };
  }, [filteredEmployees, report?.dates?.length, report?.summary.days]);

  const activeWorkHours = useMemo(() => {
    if (viewFilter === "office" && officeInner === "warehouse") {
      const key = selectedWhShift?.hours ? selectedWhShift.key : null;
      if (key) {
        const [start, end] = key.split("-");
        return { start, end };
      }
      return { start: "smena boshi", end: "smena oxiri" };
    }
    if (viewFilter === "office" && officeInner === "security") {
      return workHoursForStaffFilter("security");
    }
    if (viewFilter === "office" && officeInner === "all") {
      return { start: "smena boshi", end: "smena oxiri" };
    }
    if (viewFilter === "pharmacy") {
      return selectedPharmacyShift
        ? { start: selectedPharmacyShift.start, end: selectedPharmacyShift.end }
        : { start: "smena boshi", end: "smena oxiri" };
    }
    return workHoursForStaffFilter(viewFilter === "office" ? "office" : viewFilter);
  }, [viewFilter, officeInner, selectedWhShift, selectedPharmacyShift]);

  const dayTiming = useMemo(() => {
    const rows = employeesForDay;
    return {
      lateArrival: rows.filter((x) => (x.day?.lateArrivalMin ?? 0) > 0).length,
      earlyArrival: rows.filter((x) => (x.day?.earlyArrivalMin ?? 0) > 0).length,
      earlyLeave: rows.filter((x) => (x.day?.earlyLeaveMin ?? 0) > 0).length,
      overtime: rows.filter((x) => (x.day?.overtimeMin ?? 0) > 0).length,
    };
  }, [employeesForDay]);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i)),
    [weekStart],
  );

  const periodDates = useMemo(() => {
    if (calMode === "week") return weekDates;
    if (calMode === "month" || calMode === "range") {
      return report?.dates?.length ? report.dates : [];
    }
    return [selectedDay];
  }, [calMode, weekDates, report?.dates, selectedDay]);

  const periodTitle = useMemo(() => {
    if (calMode === "week") {
      return `${t("davomat.weekReport")} · ${weekStart} — ${addDaysYmd(weekStart, 6)}`;
    }
    if (calMode === "month") {
      return `${t("davomat.monthReport")} · ${monthLabelUz(monthAnchor, t)}`;
    }
    if (calMode === "range") {
      return `${t("davomat.rangeReport")} · ${from} — ${to}`;
    }
    return `${t("davomat.dayReport")} · ${selectedDay}`;
  }, [calMode, weekStart, monthAnchor, from, to, selectedDay, t]);

  const periodSubtitle = useMemo(() => {
    if (calMode === "month") {
      return `${firstOfMonth(monthAnchor)} ${t("davomat.rangeSub")} ${lastOfMonth(monthAnchor)} ${t("davomat.rangeSub2")}`;
    }
    if (calMode === "week") {
      return t("davomat.weekSub");
    }
    if (calMode === "range") {
      return t("davomat.monthSub");
    }
    return t("davomat.daySub");
  }, [calMode, monthAnchor, t]);

  const setCalModeSafe = (mode: CalMode) => {
    setCalMode(mode);
    if (mode === "week") setWeekStart(mondayOf(selectedDay));
    if (mode === "month") setMonthAnchor(firstOfMonth(selectedDay));
    if (mode === "range") {
      if (!rangeFrom) setRangeFrom(addDaysYmd(selectedDay, -6));
      if (!rangeTo) setRangeTo(selectedDay);
    }
  };

  const detailEmployee: DavomatEmployee | null = useMemo(() => {
    if (!report || selectedEmpId === "all") return null;
    return filteredEmployees.find((e) => e.id === selectedEmpId) ?? null;
  }, [report, selectedEmpId, filteredEmployees]);

  const detailWorkHours = useMemo(
    () => (detailEmployee ? workHoursForEmployee(detailEmployee) : activeWorkHours),
    [detailEmployee, activeWorkHours],
  );

  const onExport = async () => {
    if (exporting) return;
    setExporting("excel");
    toast({
      title: t("davomat.excelPreparing"),
      description: t("davomat.excelPreparingHint"),
    });
    try {
      const result = await downloadDavomatExcel({
        from,
        to,
        search: search.trim() || undefined,
        departmentId: pharmacyScope || deptFilter === "all" ? undefined : deptFilter,
        staffFilter:
          viewFilter === "pharmacy" && pharmacyShift !== "all"
            ? pharmacyShift
            : viewFilter === "office" && officeInner === "warehouse"
              ? "warehouse"
              : viewFilter === "office" && officeInner === "security"
                ? "security"
                : viewFilter === "office" && officeInner === "desk"
                  ? "office_core"
                  : viewFilter,
        warehouseShift:
          viewFilter === "office" && officeInner === "warehouse" ? warehouseShift : undefined,
        branch: viewFilter === "pharmacy" && pharmacyBranch !== "all" ? pharmacyBranch : undefined,
        branchLabel:
          viewFilter === "pharmacy" && pharmacyBranch !== "all" ? selectedPharmacyBranch?.label : undefined,
        coordinatorId:
          viewFilter === "pharmacy" && pharmacyCoordinator !== "all"
            ? Number(pharmacyCoordinator)
            : undefined,
        coordinatorLabel:
          viewFilter === "pharmacy" && pharmacyCoordinator !== "all"
            ? selectedPharmacyCoordinator?.label
            : undefined,
      });
      toast({
        title: result.via === "telegram" ? t("davomat.excelTelegram") : t("davomat.excelDone"),
        description:
          result.via === "telegram"
            ? t("davomat.excelTelegramHint")
            : `${filteredEmployees.length} ${t("davomat.peopleCount")} · ${staffGroupLabel}`,
      });
    } catch (err) {
      toast({
        title: t("davomat.excelFail"),
        description: (err as Error)?.message || t("davomat.exportFailHint"),
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  const onExportPdf = async () => {
    if (exporting || !report) return;
    setExporting("pdf");
    toast({
      title: t("davomat.pdfPreparing"),
      description: t("davomat.pdfPreparingHint"),
    });
    try {
      const filterBits = [
        staffGroupLabel,
        deptFilter !== "all"
          ? departments?.find((d) => String(d.id) === deptFilter)?.name || deptFilter
          : null,
        search.trim() ? `${t("ui.search")}: ${search.trim()}` : null,
        viewFilter === "pharmacy" && selectedPharmacyCoordinator
          ? `Koordinator: ${selectedPharmacyCoordinator.label}`
          : null,
        viewFilter === "pharmacy" && selectedPharmacyBranch
          ? `Filial: ${selectedPharmacyBranch.label}`
          : null,
        section === "schedule" && calMode === "day" && dayStatusFilter !== "all"
          ? dayStatusFilter
          : null,
      ].filter(Boolean);
      const filterLine = filterBits.join(" · ") || t("davomat.filterAll");
      const statusLabel = (status: string) => t(STATUS_KEYS[status] || status, status);
      const statusShort = (status: string) =>
        t(WEEK_CELL_STATUS_KEYS[status] || STATUS_KEYS[status] || status, status);

      const isSingleDay =
        (section === "schedule" && calMode === "day") ||
        (section === "totals" && periodFrom === periodTo);

      if (isSingleDay) {
        const dayYmd = section === "schedule" ? selectedDay : periodFrom;
        const ids = filteredEmployees.map((emp) => emp.id);
        if (!ids.length) throw new Error("PDF uchun xodim yo‘q");
        await downloadDavomatDayPdf({
          date: dayYmd,
          employeeIds: ids,
          filterLine,
        });
      } else {
        const dates = section === "totals" ? report.dates : periodDates;
        const emps =
          section === "totals" && selectedEmpId !== "all"
            ? filteredEmployees.filter((e) => e.id === selectedEmpId)
            : filteredEmployees;
        await downloadDavomatPdf({
          mode: "period",
          title: `${t("davomat.title")} · ${section === "totals" ? t("davomat.empTotals") : periodTitle}`,
          subtitle: section === "totals" ? `${periodFrom} — ${periodTo}` : periodSubtitle,
          filterLine,
          statsLine: `${emps.length} ${t("davomat.peopleCount")} · ${dates.length} ${t("davomat.days")}`,
          fileBase: `davomat_${from}_${to}`,
          statusLabel,
          statusShort,
          periodDates: dates,
          periodEmployees: emps,
        });
      }

      toast({
        title: t("davomat.pdfDone"),
        description: isSingleDay ? t("davomat.pdfPortraitHint") : t("davomat.pdfLandscapeHint"),
      });
    } catch (err) {
      toast({
        title: t("davomat.pdfFail"),
        description: (err as Error)?.message || t("davomat.exportFailHint"),
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  const openEdit = (emp: DavomatEmployee, workDate: string) => {
    if (!canEdit) return;
    const day = emp.days.find((d) => d.date === workDate);
    const hasIn = Boolean(day?.checkIn && day.checkIn !== "—");
    const hasOut = Boolean(day?.checkOut && day.checkOut !== "—");
    setEdit({
      employeeId: emp.id,
      fullName: emp.fullName,
      workDate,
      checkIn: hasIn ? day!.checkIn : "",
      checkOut: hasOut ? day!.checkOut : "",
      status: day?.status === "absent" && !day.recordId ? "auto" : day?.status || "auto",
      notes: day?.notes || "",
    });
  };

  const openDayNote = (fullName: string, workDate: string, day: DavomatDayMetrics) => {
    setNoteView({
      fullName,
      workDate,
      notes: (day.excused ? day.excuseNote || day.notes : day.notes)?.trim() || "",
      excused: Boolean(day.excused),
      status: day.status,
      excusedByName: day.excusedByName || null,
      excusedAt: day.excusedAt || null,
    });
  };

  const openExcuse = (emp: DavomatEmployee, workDate: string) => {
    if (!canExcuse) return;
    const day = emp.days.find((d) => d.date === workDate);
    const current = day?.status && day.status !== "rest" ? day.status : day?.status || "present";
    setExcuse({
      employeeId: emp.id,
      fullName: emp.fullName,
      workDate,
      status: ["present", "late", "absent", "incomplete", "leave", "rest"].includes(current)
        ? current
        : "present",
      note: day?.excuseNote || "",
    });
  };

  const saveExcuse = async () => {
    if (!excuse || !canExcuse) return;
    const note = excuse.note.trim();
    if (note.length < 3) {
      toast({ title: "Izoh majburiy", description: "Kamida 3 ta belgi yozing", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await saveDavomatExcuse({
        employeeId: excuse.employeeId,
        workDate: excuse.workDate,
        status: excuse.status,
        note,
      });
      toast({ title: "Sababli saqlandi", description: `${excuse.fullName} · jarima tushmaydi` });
      setExcuse(null);
      await load();
    } catch (err) {
      toast({
        title: "Saqlanmadi",
        description: (err as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const openSchedule = (emp: DavomatEmployee, workDate: string) => {
    if (!canSchedule) return;
    const day = emp.days.find((d) => d.date === workDate);
    setSchedule({
      employeeId: emp.id,
      fullName: emp.fullName,
      workDate,
      mode: "permanent",
      validFrom: workDate,
      validTo: workDate,
      shiftKey: day?.planShift || "office",
      startHm: day?.planStart || emp.workStart || "09:00",
      endHm: day?.planEnd || emp.workEnd || "18:00",
      shifts: [],
      currentId: null,
      loading: true,
    });
    void fetchEmployeeSchedule(emp.id, workDate)
      .then((data) => {
        const current = data.current;
        const selected = data.shifts.find((s) => s.key === (current?.shiftKey || day?.planShift || "office")) || data.shifts[0];
        setSchedule((prev) =>
          prev && prev.employeeId === emp.id
            ? {
                ...prev,
                loading: false,
                shifts: data.shifts,
                currentId: current?.id ?? null,
                mode: current?.mode || "permanent",
                validFrom: current?.validFrom || workDate,
                validTo: current?.validTo || workDate,
                shiftKey: current?.shiftKey || selected?.key || "office",
                startHm: current?.startHm || selected?.start || prev.startHm,
                endHm: current?.endHm || selected?.end || prev.endHm,
              }
            : prev,
        );
      })
      .catch((err) => {
        setSchedule((prev) => (prev ? { ...prev, loading: false } : prev));
        toast({ title: "Smena vaqti yuklanmadi", description: (err as Error)?.message, variant: "destructive" });
      });
  };

  const saveSchedule = async () => {
    if (!schedule || !canSchedule) return;
    setSaving(true);
    try {
      await saveEmployeeSchedule({
        employeeId: schedule.employeeId,
        mode: schedule.mode,
        validFrom: schedule.validFrom,
        validTo: schedule.mode === "period" ? schedule.validTo : null,
        shiftKey: schedule.shiftKey,
        startHm: schedule.startHm,
        endHm: schedule.endHm,
      });
      toast({
        title: "Smena vaqti saqlandi",
        description: `${schedule.fullName} · faqat shu xodim`,
      });
      setSchedule(null);
      await load();
    } catch (err) {
      toast({ title: "Saqlanmadi", description: (err as Error)?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const clearSchedule = async () => {
    if (!schedule?.currentId || !canSchedule) return;
    setSaving(true);
    try {
      await clearEmployeeSchedule(schedule.employeeId, schedule.currentId);
      toast({ title: "Standart smenaga qaytdi", description: schedule.fullName });
      setSchedule(null);
      await load();
    } catch (err) {
      toast({ title: "Bekor qilinmadi", description: (err as Error)?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const openReset = (emp: DavomatEmployee, workDate: string) => {
    if (!canReset) return;
    const day = emp.days.find((d) => d.date === workDate);
    if (!dayHasPunch(day)) return;
    const hm = (v?: string | null) => (v && v !== "—" ? v : null);
    setResetTarget({
      employeeId: emp.id,
      fullName: emp.fullName,
      workDate,
      checkIn: hm(day?.checkIn),
      checkOut: hm(day?.checkOut),
    });
  };

  const saveEdit = async () => {
    if (!edit || !canEdit) return;
    setSaving(true);
    try {
      await saveDavomatManual({
        employeeId: edit.employeeId,
        workDate: edit.workDate,
        checkIn: edit.checkIn || null,
        checkOut: edit.checkOut || null,
        status: edit.status === "auto" ? "auto" : edit.status,
        notes: edit.notes || undefined,
      });
      toast({ title: "Saqlandi", description: edit.fullName });
      setEdit(null);
      await load();
    } catch (err) {
      toast({
        title: "Saqlanmadi",
        description: (err as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const confirmReset = async (part: DavomatResetPart) => {
    if (!resetTarget || !canReset) return;
    setResetting(part);
    try {
      await resetDavomatManual({
        employeeId: resetTarget.employeeId,
        workDate: resetTarget.workDate,
        part,
      });
      toast({
        title:
          part === "in"
            ? t("davomat.resetInDone")
            : part === "out"
              ? t("davomat.resetOutDone")
              : t("davomat.resetDone"),
        description: `${resetTarget.fullName} · ${resetTarget.workDate}`,
      });
      setResetTarget(null);
      await load();
    } catch (err) {
      toast({
        title: t("davomat.resetFail"),
        description: (err as Error)?.message,
        variant: "destructive",
      });
    } finally {
      setResetting(null);
    }
  };

  const showRowActions = canEdit || canReset || canExcuse || canSchedule;

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center text-muted-foreground">
        <p>{t("davomat.accessDenied")}</p>
        <a href="/davomat-face" className="mt-3 inline-block text-[#0b3a5c] underline underline-offset-2 dark:text-sky-400">
          {t("davomat.goMy")}
        </a>
      </div>
    );
  }

  const fieldClass =
    "h-10 rounded-xl border-border bg-card text-sm shadow-none dark:border-white/10 dark:bg-[#152238] dark:text-slate-100";
  const labelClass = "mb-1 flex h-4 items-center text-[10px] font-medium leading-none text-muted-foreground";
  const navBtnClass =
    "h-10 w-10 shrink-0 rounded-xl border-border dark:border-white/10 dark:bg-[#152238]";

  const filters = (
    <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {section === "schedule" && calMode === "range" ? (
        <>
          <div>
            <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("davomat.from")}</Label>
            <Input
              type="date"
              className={fieldClass}
              value={rangeFrom}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setRangeFrom(v);
                setSelectedDay(v);
              }}
            />
          </div>
          <div>
            <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("davomat.to")}</Label>
            <Input
              type="date"
              className={fieldClass}
              value={rangeTo}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setRangeTo(v);
              }}
            />
          </div>
        </>
      ) : section === "schedule" ? (
        <div>
          <Label className={labelClass}>
            {calMode === "month"
              ? t("davomat.monthLabel")
              : calMode === "week"
                ? t("davomat.weekLabel")
                : t("davomat.dayLabel")}
          </Label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={navBtnClass}
              onClick={() => {
                if (calMode === "week") {
                  const next = addDaysYmd(weekStart, -7);
                  setWeekStart(next);
                  setSelectedDay(next);
                } else if (calMode === "month") {
                  const [y, m] = monthAnchor.split("-").map(Number);
                  const prev =
                    m === 1
                      ? `${y! - 1}-12-01`
                      : `${y}-${String(m! - 1).padStart(2, "0")}-01`;
                  setMonthAnchor(prev);
                  setSelectedDay(prev);
                } else {
                  const next = addDaysYmd(selectedDay, -1);
                  setSelectedDay(next);
                  setWeekStart(mondayOf(next));
                  setMonthAnchor(firstOfMonth(next));
                }
              }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            {calMode === "week" ? (
              <Popover open={weekPickerOpen} onOpenChange={setWeekPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      fieldClass,
                      "inline-flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left transition",
                      "hover:border-primary/45 hover:bg-primary/[0.03]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                      weekPickerOpen && "border-primary/50 bg-primary/5 ring-2 ring-ring/20",
                    )}
                    title={`${formatYmdDot(weekStart)} — ${formatYmdDot(addDaysYmd(weekStart, 6))}`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <CalendarDays className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tabular-nums tracking-tight sm:text-xs">
                      <span className="text-foreground">{formatYmdDot(weekStart)}</span>
                      <span className="mx-1 font-medium text-muted-foreground">—</span>
                      <span className="text-foreground">
                        {formatYmdDot(addDaysYmd(weekStart, 6))}
                      </span>
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        weekPickerOpen && "rotate-180",
                      )}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="z-[90] w-auto rounded-xl border border-border p-0 shadow-lg"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("davomat.pickWeek")}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                        {formatYmdDot(weekStart)} — {formatYmdDot(addDaysYmd(weekStart, 6))}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                      onClick={() => {
                        const mon = mondayOf(todayYmd());
                        setWeekStart(mon);
                        setSelectedDay(mon);
                        setMonthAnchor(firstOfMonth(mon));
                        setWeekPickerOpen(false);
                      }}
                    >
                      {t("davomat.thisWeek")}
                    </button>
                  </div>
                  <DayPickerCalendar
                    key={`week-${weekStart}`}
                    mode="range"
                    className="rounded-xl"
                    defaultMonth={parseYmdLocal(weekStart) ?? new Date()}
                    selected={{
                      from: parseYmdLocal(weekStart),
                      to: parseYmdLocal(addDaysYmd(weekStart, 6)),
                    }}
                    onSelect={(_range, day) => {
                      if (!day) return;
                      const mon = mondayOf(toYmdLocal(day));
                      setWeekStart(mon);
                      setSelectedDay(mon);
                      setMonthAnchor(firstOfMonth(mon));
                      setWeekPickerOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            ) : calMode === "month" ? (
              <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      fieldClass,
                      "inline-flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left transition",
                      "hover:border-primary/45 hover:bg-primary/[0.03]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                      monthPickerOpen && "border-primary/50 bg-primary/5 ring-2 ring-ring/20",
                    )}
                    title={monthLabelUz(monthAnchor, t)}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <CalendarDays className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-tight sm:text-xs">
                      {monthLabelUz(monthAnchor, t)}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        monthPickerOpen && "rotate-180",
                      )}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="z-[90] w-auto rounded-xl border border-border p-0 shadow-lg"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("davomat.pickMonth")}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-foreground">
                        {monthLabelUz(monthAnchor, t)}
                      </p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {formatYmdDot(firstOfMonth(monthAnchor))} —{" "}
                        {formatYmdDot(lastOfMonth(monthAnchor))}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                      onClick={() => {
                        const anchor = firstOfMonth(todayYmd());
                        setMonthAnchor(anchor);
                        setSelectedDay(anchor);
                        setWeekStart(mondayOf(anchor));
                        setMonthPickerOpen(false);
                      }}
                    >
                      {t("davomat.thisMonth")}
                    </button>
                  </div>
                  <DayPickerCalendar
                    key={`month-${monthAnchor.slice(0, 7)}`}
                    mode="range"
                    className="rounded-xl"
                    defaultMonth={parseYmdLocal(monthAnchor) ?? new Date()}
                    selected={{
                      from: parseYmdLocal(firstOfMonth(monthAnchor)),
                      to: parseYmdLocal(lastOfMonth(monthAnchor)),
                    }}
                    onSelect={(_range, day) => {
                      if (!day) return;
                      const ymd = toYmdLocal(day);
                      const anchor = firstOfMonth(ymd);
                      setMonthAnchor(anchor);
                      setSelectedDay(ymd);
                      setWeekStart(mondayOf(ymd));
                      setMonthPickerOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <Popover open={dayPickerOpen} onOpenChange={setDayPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      fieldClass,
                      "inline-flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left transition",
                      "hover:border-primary/45 hover:bg-primary/[0.03]",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                      dayPickerOpen && "border-primary/50 bg-primary/5 ring-2 ring-ring/20",
                    )}
                    title={formatYmdDot(selectedDay)}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <CalendarDays className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tabular-nums tracking-tight sm:text-xs">
                      {formatYmdDot(selectedDay)}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        dayPickerOpen && "rotate-180",
                      )}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="z-[90] w-auto rounded-xl border border-border p-0 shadow-lg"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("davomat.pickDay")}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                        {formatYmdDot(selectedDay)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10"
                      onClick={() => {
                        const d = todayYmd();
                        setSelectedDay(d);
                        setWeekStart(mondayOf(d));
                        setMonthAnchor(firstOfMonth(d));
                        setDayPickerOpen(false);
                      }}
                    >
                      {t("davomat.todayPick")}
                    </button>
                  </div>
                  <DayPickerCalendar
                    key={`day-${selectedDay}`}
                    mode="single"
                    className="rounded-xl"
                    defaultMonth={parseYmdLocal(selectedDay) ?? new Date()}
                    selected={parseYmdLocal(selectedDay)}
                    onSelect={(day) => {
                      if (!day) return;
                      const ymd = toYmdLocal(day);
                      setSelectedDay(ymd);
                      setWeekStart(mondayOf(ymd));
                      setMonthAnchor(firstOfMonth(ymd));
                      setDayPickerOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={navBtnClass}
              onClick={() => {
                if (calMode === "week") {
                  const next = addDaysYmd(weekStart, 7);
                  setWeekStart(next);
                  setSelectedDay(next);
                } else if (calMode === "month") {
                  const [y, m] = monthAnchor.split("-").map(Number);
                  const next =
                    m === 12
                      ? `${y! + 1}-01-01`
                      : `${y}-${String(m! + 1).padStart(2, "0")}-01`;
                  setMonthAnchor(next);
                  setSelectedDay(next);
                } else {
                  const next = addDaysYmd(selectedDay, 1);
                  setSelectedDay(next);
                  setWeekStart(mondayOf(next));
                  setMonthAnchor(firstOfMonth(next));
                }
              }}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div>
            <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("davomat.from")}</Label>
            <Input
              type="date"
              className={fieldClass}
              value={periodFrom}
              onChange={(e) => setPeriodFrom(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("davomat.to")}</Label>
            <Input
              type="date"
              className={fieldClass}
              value={periodTo}
              onChange={(e) => setPeriodTo(e.target.value)}
            />
          </div>
        </>
      )}
      {pharmacyScope ? null : (
      <div>
        <Label className={labelClass}>{t("ui.department")}</Label>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className={cn(fieldClass, "px-2.5")}>
            <SelectValue placeholder={t("ui.allDepartments")} />
          </SelectTrigger>
          <SelectContent position="popper" className="z-[90]">
            <SelectItem value="all">{t("ui.allDepartments")}</SelectItem>
            {(departments ?? []).map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      )}
      {section === "schedule" && calMode === "day" ? (
        <div>
          <Label className={labelClass}>Holat</Label>
          <Select
            value={dayStatusFilter}
            onValueChange={(v) => {
              setDayStatusFilter(v as DayStatusFilter);
              setSection("schedule");
              setCalMode("day");
            }}
          >
            <SelectTrigger
              className={cn(
                fieldClass,
                "px-2.5 font-semibold",
                dayStatusFilter === "present" &&
                  "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300",
                dayStatusFilter === "absent" &&
                  "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-300",
                dayStatusFilter === "late" &&
                  "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300",
                dayStatusFilter === "leave" &&
                  "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200",
                dayStatusFilter === "rest" &&
                  "border-slate-300 bg-slate-100 text-slate-800 dark:border-white/20 dark:bg-white/10 dark:text-slate-100",
              )}
            >
              <SelectValue placeholder="Barchasi" />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[90]">
              <SelectItem value="all" className="font-medium text-foreground">
                Barchasi
              </SelectItem>
              <SelectItem
                value="present"
                className="font-semibold text-emerald-700 focus:bg-emerald-50 focus:text-emerald-800 dark:text-emerald-300 dark:focus:bg-emerald-500/15 dark:focus:text-emerald-200"
              >
                Kelgan
              </SelectItem>
              <SelectItem
                value="absent"
                className="font-semibold text-rose-700 focus:bg-rose-50 focus:text-rose-800 dark:text-rose-300 dark:focus:bg-rose-500/15 dark:focus:text-rose-200"
              >
                Kelmagan
              </SelectItem>
              <SelectItem
                value="late"
                className="font-semibold text-amber-700 focus:bg-amber-50 focus:text-amber-900 dark:text-amber-300 dark:focus:bg-amber-500/15 dark:focus:text-amber-200"
              >
                Kechikkan
              </SelectItem>
              <SelectItem
                value="leave"
                className="font-semibold text-violet-700 focus:bg-violet-50 focus:text-violet-900 dark:text-violet-300 dark:focus:bg-violet-500/15 dark:focus:text-violet-200"
              >
                Ta’tilda
              </SelectItem>
              <SelectItem
                value="rest"
                className="font-semibold text-slate-700 focus:bg-slate-100 focus:text-slate-900 dark:text-slate-200 dark:focus:bg-white/10 dark:focus:text-slate-100"
              >
                Dam kuni
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {pharmacyScope ? (
        <div>
          <Label className={labelClass}>Dorixona</Label>
          <div className={cn(fieldClass, "flex items-center px-2.5 text-sm font-semibold text-emerald-800")}>
            To‘liq dorixona · o‘z filiallaringiz
          </div>
        </div>
      ) : (
      <div>
        <Label className={labelClass}>{t("davomat.staffGroup")}</Label>
        <Select value={staffFilter} onValueChange={(v) => setStaffFilter(v as DavomatStaffFilter)}>
          <SelectTrigger className={cn(fieldClass, "px-2.5")}>
            <SelectValue placeholder={t("ui.all")} />
          </SelectTrigger>
          <SelectContent position="popper" className="z-[90]">
            {STAFF_FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.key} value={opt.key}>
                {opt.label} · {opt.hint}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      )}
      {viewFilter === "office" ? (
        <div className="sm:col-span-2 xl:col-span-4">
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/80 p-2 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="mb-1.5 px-1">
            <Label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Ofis ichida</Label>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {OFFICE_INNER_OPTIONS.map((opt) => {
              const on = officeInner === opt.key;
              const tone =
                opt.key === "distrib"
                  ? {
                      on: "border-transparent bg-gradient-to-br from-orange-600 to-amber-500 text-white shadow-md shadow-orange-500/25",
                      off: "border-orange-200 bg-orange-50 text-orange-950 hover:border-orange-300 hover:bg-orange-100 dark:border-orange-400/35 dark:bg-orange-400/10 dark:text-orange-100",
                      badgeOn: "bg-white/25 text-white",
                      badgeOff: "bg-orange-200/90 text-orange-900 dark:bg-orange-400/20 dark:text-orange-100",
                    }
                  : opt.key === "warehouse"
                  ? {
                      on: "border-transparent bg-gradient-to-br from-lime-600 to-green-500 text-white shadow-md shadow-lime-500/25",
                      off: "border-lime-300 bg-lime-50 text-lime-950 hover:border-lime-400 hover:bg-lime-100 dark:border-lime-400/35 dark:bg-lime-400/10 dark:text-lime-100",
                      badgeOn: "bg-white/25 text-white",
                      badgeOff: "bg-lime-200/90 text-lime-900 dark:bg-lime-400/20 dark:text-lime-100",
                    }
                  : opt.key === "security"
                    ? {
                        on: "border-transparent bg-gradient-to-br from-purple-700 to-violet-600 text-white shadow-md shadow-purple-500/25",
                        off: "border-purple-200 bg-purple-50 text-purple-950 hover:border-purple-300 hover:bg-purple-100 dark:border-purple-400/35 dark:bg-purple-400/10 dark:text-purple-100",
                        badgeOn: "bg-white/25 text-white",
                        badgeOff: "bg-purple-200/80 text-purple-900 dark:bg-purple-400/20 dark:text-purple-100",
                      }
                    : opt.key === "desk"
                      ? {
                          on: "border-transparent bg-gradient-to-br from-red-600 to-rose-600 text-white shadow-md shadow-red-500/25",
                          off: "border-red-200 bg-red-50 text-red-950 hover:border-red-300 hover:bg-red-100 dark:border-red-400/35 dark:bg-red-400/10 dark:text-red-100",
                          badgeOn: "bg-white/25 text-white",
                          badgeOff: "bg-red-200/80 text-red-900 dark:bg-red-400/20 dark:text-red-100",
                        }
                      : {
                          on: "border-transparent bg-gradient-to-br from-cyan-500 to-sky-500 text-white shadow-md shadow-cyan-500/30",
                          off: "border-cyan-200 bg-cyan-50 text-cyan-950 hover:border-cyan-300 hover:bg-cyan-100 dark:border-cyan-400/35 dark:bg-cyan-400/10 dark:text-cyan-100",
                          badgeOn: "bg-white/25 text-white",
                          badgeOff: "bg-cyan-200/80 text-cyan-900 dark:bg-cyan-400/20 dark:text-cyan-100",
                        };
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setOfficeInner(opt.key)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left shadow-sm transition",
                    on ? tone.on : tone.off,
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold leading-tight">{opt.label}</span>
                    <span className={cn("block truncate text-[10px] leading-tight", on ? "opacity-80" : "opacity-70")}>
                      {opt.hint}
                    </span>
                  </span>
                  <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums", on ? tone.badgeOn : tone.badgeOff)}>
                    {officeInnerCounts[opt.key]}
                  </span>
                </button>
              );
            })}
          </div>
          </div>
        </div>
      ) : null}
      {viewFilter === "pharmacy" ? (
        <>
          <div>
            <Label className={labelClass}>Dorixona smenasi</Label>
            <Select value={pharmacyShift} onValueChange={(v) => setPharmacyShift(v as PharmacyShiftFilter)}>
              <SelectTrigger className={cn(fieldClass, "px-2.5")}>
                <SelectValue placeholder="Barcha smenalar" />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[90]">
                <SelectItem value="all">
                  Barcha smenalar ({pharmacyShiftCounts.all})
                </SelectItem>
                {PHARMACY_SHIFT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    {opt.label} · {opt.hours} ({pharmacyShiftCounts[opt.key]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className={labelClass}>Koordinator</Label>
            <PharmacyCoordinatorPicker
              value={pharmacyCoordinator}
              onChange={setPharmacyCoordinator}
              options={pharmacyCoordinators}
              total={pharmacyCoordinators.length}
            />
          </div>
          <div>
            <Label className={labelClass}>Filial</Label>
            <PharmacyBranchPicker
              value={pharmacyBranch}
              onChange={setPharmacyBranch}
              options={pharmacyBranches}
              total={pharmacyBranches.length}
            />
          </div>
          <div>
            <Label className={labelClass}>{t("ui.search")}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className={cn(fieldClass, "pl-9")}
                placeholder="Ism, lavozim yoki telefon bo‘yicha qidirish"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </>
      ) : null}
      {viewFilter === "office" && officeInner === "warehouse" ? (
        <div>
          <Label className={labelClass}>Omborxona smenasi</Label>
          <Select value={warehouseShift} onValueChange={setWarehouseShift}>
            <SelectTrigger className={cn(fieldClass, "px-2.5")}>
              <SelectValue placeholder="Barcha smenalar" />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[90]">
              <SelectItem value="all">Barcha smenalar</SelectItem>
              {whShiftOptions.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  {opt.label}
                  {opt.hours && opt.label !== opt.hours ? ` · ${opt.hours}` : ""} ({opt.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {viewFilter === "pharmacy" ? null : (
      <div className="sm:col-span-2 xl:col-span-4">
        <Label className={labelClass}>{t("ui.search")}</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className={cn(fieldClass, "pl-9")}
            placeholder="Ism, lavozim yoki telefon bo‘yicha qidirish"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      )}
    </div>
  );

  const cardFoot = (key: DayStatusFilter): string => {
    if (key === "all") return "Jami xodimlar ulushi";
    if (key === "late") return "Kelganlar ichida";
    if (key === "leave") return filteredDayStats.leaveNames.join(", ") || "Ta’tilda";
    if (key === "rest") return filteredDayStats.restNames.join(", ") || "Dam kuni";
    return "Shu kundagi ulush";
  };

  const dayCards: Array<{
    key: DayStatusFilter;
    label: string;
    value: number;
    icon: typeof Users;
    bar: string;
    iconBg: string;
    ring: string;
    surface: string;
  }> = [
    {
      key: "all",
      label: "Jami xodim",
      value: filteredDayStats.total,
      icon: Users,
      bar: "bg-[#3b82f6]",
      iconBg: "bg-sky-50 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
      ring: "#38bdf8",
      surface: "dark:border-sky-400/30 dark:bg-[#102743] dark:shadow-[0_16px_36px_-22px_rgba(56,189,248,0.7)]",
    },
    {
      key: "present",
      label: "Kelgan",
      value: filteredDayStats.present,
      icon: UserCheck,
      bar: "bg-emerald-500",
      iconBg: "bg-emerald-50 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
      ring: "#34d399",
      surface: "dark:border-emerald-400/25 dark:bg-[#0d2820] dark:shadow-[0_16px_36px_-22px_rgba(52,211,153,0.55)]",
    },
    {
      key: "absent",
      label: "Kelmagan",
      value: filteredDayStats.absent,
      icon: UserX,
      bar: "bg-rose-500",
      iconBg: "bg-rose-50 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300",
      ring: "#fb7185",
      surface: "dark:border-rose-400/25 dark:bg-[#2a1520] dark:shadow-[0_16px_36px_-22px_rgba(251,113,133,0.5)]",
    },
    {
      key: "late",
      label: "Kechikkan",
      value: filteredDayStats.late,
      icon: Timer,
      bar: "bg-amber-400",
      iconBg: "bg-amber-50 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
      ring: "#fbbf24",
      surface: "dark:border-amber-400/25 dark:bg-[#2a2112] dark:shadow-[0_16px_36px_-22px_rgba(251,191,36,0.45)]",
    },
  ];
  if (filteredDayStats.leave > 0) {
    dayCards.push({
      key: "leave",
      label: "Ta’tilda",
      value: filteredDayStats.leave,
      icon: Palmtree,
      bar: "bg-violet-500",
      iconBg: "bg-violet-50 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
      ring: "#a78bfa",
      surface: "dark:border-violet-400/25 dark:bg-[#241832] dark:shadow-[0_16px_36px_-22px_rgba(167,139,250,0.5)]",
    });
  }
  if (filteredDayStats.rest > 0) {
    dayCards.push({
      key: "rest",
      label: "Dam kuni",
      value: filteredDayStats.rest,
      icon: Moon,
      bar: "bg-slate-400",
      iconBg: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-200",
      ring: "#94a3b8",
      surface: "dark:border-white/15 dark:bg-[#1a2436]",
    });
  }

  return (
    <div className="w-full space-y-4 pb-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#1d4ed8] text-white shadow-sm shadow-blue-600/30">
            <Users className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-[#0f2744] dark:text-white">{t("davomat.title")}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {pharmacyScope
                ? "Faqat sizning filiallaringiz, barcha smenalar va o‘z xodimlaringiz"
                : "Xodimlarning ishga kelish va ketish nazorati"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 shadow-sm dark:border-sky-400/20 dark:bg-[#152238]">
            <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
            <div className="min-w-0 leading-none">
              <div className="text-[10px] font-medium text-slate-400">
                {selectedDay === todayYmd() ? (locale === "ru" ? "Сегодня" : "Bugun") : locale === "ru" ? "Дата" : "Sana"}
              </div>
              <div className="mt-0.5 truncate text-xs font-semibold text-[#0f2744] dark:text-slate-100">{formatLongDate(selectedDay, locale)}</div>
            </div>
          </div>
          <Button
            type="button"
            className="h-11 gap-2 rounded-xl bg-emerald-600 px-4 text-white shadow-sm hover:bg-emerald-700"
            onClick={() => void onExport()}
            disabled={!!exporting || (loading && !report)}
          >
            {exporting === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            {t("davomat.excelBtn")}
          </Button>
          <Button
            type="button"
            className="h-11 gap-2 rounded-xl bg-rose-600 px-4 text-white shadow-sm hover:bg-rose-700"
            onClick={() => void onExportPdf()}
            disabled={!!exporting || (loading && !report)}
          >
            {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            {t("davomat.pdfBtn")}
          </Button>
        </div>
      </div>

      {section === "schedule" || section === "totals" ? (
      <div
        className={cn(
          "grid grid-cols-1 gap-3 sm:grid-cols-2",
          dayCards.length + 1 > 5 ? "xl:grid-cols-6" : dayCards.length + 1 > 4 ? "xl:grid-cols-5" : "xl:grid-cols-4",
        )}
      >
        {dayCards.map((card) => {
          const Icon = card.icon;
          const active = dayStatusFilter === card.key;
          const workPool = filteredDayStats.present + filteredDayStats.absent;
          const pctBase =
            card.key === "late"
              ? filteredDayStats.present
              : card.key === "present" || card.key === "absent"
                ? workPool
                : filteredDayStats.total;
          const pct =
            card.key === "all" ? 100 : pctBase > 0 ? Math.round((card.value / pctBase) * 1000) / 10 : 0;
          const ringPct = card.key === "all" ? 100 : pct;
          const r = 18;
          const c = 2 * Math.PI * r;
          const dash = c - (c * Math.min(100, ringPct)) / 100;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => toggleDayStatusFilter(card.key)}
              className={cn(
                "rounded-2xl border-2 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                card.surface,
                active ? "border-sky-500 ring-2 ring-sky-200 dark:ring-sky-400/40" : "border-slate-300",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", card.iconBg)}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{card.label}</div>
                    <div className="mt-0.5 text-2xl font-bold tabular-nums leading-none text-[#0f2744] dark:text-white">
                      {loading && !report ? "…" : card.value}
                      <span className="ml-1 text-sm font-medium text-slate-400">xodim</span>
                    </div>
                  </div>
                </div>
                {card.key === "all" ? (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sky-500">
                    <Users className="h-4 w-4" />
                  </span>
                ) : (
                  <span className="relative h-12 w-12 shrink-0">
                    <svg viewBox="0 0 44 44" className="h-12 w-12 -rotate-90">
                      <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-slate-100 dark:text-white/10" />
                      <circle
                        cx="22"
                        cy="22"
                        r={r}
                        fill="none"
                        stroke={card.ring}
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={`${c} ${c}`}
                        strokeDashoffset={dash}
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-slate-600 dark:text-slate-200">
                      {Number.isInteger(pct) ? pct : pct.toFixed(1)}%
                    </span>
                  </span>
                )}
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div className={cn("h-full rounded-full", card.bar)} style={{ width: `${Math.min(100, ringPct)}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span className="min-w-0 truncate" title={cardFoot(card.key)}>
                  {cardFoot(card.key)}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-slate-500">{card.key === "all" ? "100%" : `${pct}%`}</span>
              </div>
            </button>
          );
        })}
        <DavomatJarimaCard month={selectedDay.slice(0, 7)} onOpen={() => setSection("jarima")} />
      </div>
      ) : null}

      <Tabs
        value={section}
        onValueChange={(v) => {
          setSection(v as Section);
          setSelectedEmpId("all");
        }}
      >
        <div
          className={cn(
            "grid grid-cols-1 gap-2 rounded-2xl border border-slate-200/90 bg-slate-50/90 p-1.5 shadow-sm dark:border-white/10 dark:bg-[#101a2e]",
            canChecklist ? "sm:grid-cols-2 xl:grid-cols-6" : "sm:grid-cols-2 xl:grid-cols-5",
          )}
        >
          {(
            [
              {
                id: "schedule" as const,
                label: "Jadval (kun / hafta / oy)",
                icon: CalendarDays,
                idle: "border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-300 hover:bg-sky-100 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100 dark:hover:bg-sky-400/20",
                active: "border-transparent bg-gradient-to-br from-[#1e3a8a] to-[#2563eb] text-white shadow-md shadow-blue-500/25",
              },
              {
                id: "analytics" as const,
                label: "Tahlil va grafik",
                icon: LineChart,
                idle: "border-violet-200 bg-violet-50 text-violet-800 hover:border-violet-300 hover:bg-violet-100 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100 dark:hover:bg-violet-400/20",
                active: "border-transparent bg-gradient-to-br from-violet-700 to-fuchsia-600 text-white shadow-md shadow-violet-500/25",
              },
              {
                id: "totals" as const,
                label: "Xodimlar jami",
                icon: Users,
                idle: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100 dark:hover:bg-emerald-400/20",
                active: "border-transparent bg-gradient-to-br from-emerald-700 to-teal-500 text-white shadow-md shadow-emerald-500/25",
              },
              {
                id: "jarima" as const,
                label: "Jarimalar",
                icon: Receipt,
                idle: "border-rose-200 bg-rose-50 text-rose-800 hover:border-rose-300 hover:bg-rose-100 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100 dark:hover:bg-rose-400/20",
                active: "border-transparent bg-gradient-to-br from-rose-800 to-rose-600 text-white shadow-md shadow-rose-500/25",
              },
              {
                id: "smena" as const,
                label: "Smena va filial",
                icon: AlarmClock,
                idle: "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100 dark:hover:bg-amber-400/20",
                active: "border-transparent bg-gradient-to-br from-amber-600 to-orange-500 text-white shadow-md shadow-amber-500/25",
              },
              ...(canChecklist
                ? [
                    {
                      id: "checklist" as const,
                      label: "Cheklist holati",
                      icon: ClipboardList,
                      idle: "border-rose-200 bg-rose-50 text-rose-800 hover:border-rose-300 hover:bg-rose-100 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100 dark:hover:bg-rose-400/20",
                      active: "border-transparent bg-gradient-to-br from-rose-700 to-pink-600 text-white shadow-md shadow-rose-500/25",
                    },
                  ]
                : []),
            ]
          ).map((tab) => {
            const Icon = tab.icon;
            const on = section === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSection(tab.id)}
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition",
                  on ? tab.active : tab.idle,
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <TabsContent value="schedule" className="mt-4 space-y-4">
          <Card className="border-border shadow-sm dark:border-white/10 dark:bg-[#101a2e]">
            <CardContent className="space-y-3 px-3 pb-4 pt-4 sm:space-y-4 sm:px-6 sm:pt-5">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Davr turi</p>
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200/90 bg-slate-50/80 p-1.5 sm:grid-cols-4 dark:border-white/10 dark:bg-white/[0.03]" role="group" aria-label="Davr turi">
                  {(
                    [
                      {
                        id: "day" as const,
                        short: t("davomat.dayShort"),
                        label: t("davomat.daily"),
                        hint: t("davomat.hint1d"),
                        idle: "border-orange-200 bg-orange-50 text-orange-950 hover:border-orange-300 hover:bg-orange-100 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-100",
                        active: "border-transparent bg-gradient-to-br from-orange-600 to-orange-500 text-white shadow-md shadow-orange-500/25",
                      },
                      {
                        id: "week" as const,
                        short: t("ui.week"),
                        label: t("davomat.weekly"),
                        hint: t("davomat.hint7d"),
                        idle: "border-teal-200 bg-teal-50 text-teal-950 hover:border-teal-300 hover:bg-teal-100 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-100",
                        active: "border-transparent bg-gradient-to-br from-teal-700 to-cyan-600 text-white shadow-md shadow-teal-500/25",
                      },
                      {
                        id: "month" as const,
                        short: t("ui.month"),
                        label: t("davomat.monthly"),
                        hint: t("davomat.hint1m"),
                        idle: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-950 hover:border-fuchsia-300 hover:bg-fuchsia-100 dark:border-fuchsia-400/30 dark:bg-fuchsia-400/10 dark:text-fuchsia-100",
                        active: "border-transparent bg-gradient-to-br from-fuchsia-700 to-pink-600 text-white shadow-md shadow-fuchsia-500/25",
                      },
                      {
                        id: "range" as const,
                        short: t("davomat.period"),
                        label: t("ui.fromTo"),
                        hint: t("davomat.hintCustom"),
                        idle: "border-indigo-200 bg-indigo-50 text-indigo-950 hover:border-indigo-300 hover:bg-indigo-100 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-100",
                        active: "border-transparent bg-gradient-to-br from-indigo-700 to-blue-600 text-white shadow-md shadow-indigo-500/25",
                      },
                    ] as const
                  ).map((m) => {
                    const on = calMode === m.id;
                    return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      className={cn(
                        "rounded-xl border px-3.5 py-2.5 text-left transition",
                        on ? m.active : m.idle,
                      )}
                      onClick={() => setCalModeSafe(m.id)}
                    >
                      <span className="block text-[11px] font-semibold leading-none sm:hidden">{m.short}</span>
                      <span className="hidden text-sm font-semibold leading-none sm:block">{m.label}</span>
                      <span className={cn("mt-1 block text-[10px]", on ? "text-white/80" : "opacity-70")}>
                        {m.hint}
                      </span>
                    </button>
                    );
                  })}
                </div>
              </div>
              {filters}
            </CardContent>
          </Card>

          {loading && !report ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> {t("ui.loading")}
            </div>
          ) : report ? (
            calMode === "day" ? (
              <>
              <Card className="border-border shadow-sm overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Kunlik davomat · {selectedDay}
                    {viewFilter !== "all" ? (
                      <span className="ml-2 text-sm font-medium text-primary">
                        · {staffGroupLabel}
                      </span>
                    ) : null}
                  </CardTitle>
                  {dayInfo ? (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        Ko‘rsatilmoqda: {visibleEmployeesForDay.length}
                        {dayStatusFilter !== "all" ? ` / ${filteredDayStats.total}` : ""} xodim
                        {viewFilter !== "all" && report && report.summary.employees > visibleEmployeesForDay.length ? (
                          ` · filtr: ${report.summary.employees}`
                        ) : null}
                      </span>
                      {filteredDayStats.incomplete > 0 ? (
                        <>
                          {" · "}
                          <span className="font-medium stat-sky">
                            Ketish yo‘q: {filteredDayStats.incomplete}
                          </span>
                        </>
                      ) : null}
                      <span className="mt-0.5 block text-muted-foreground">
                        Kech keldi: {dayTiming.lateArrival} · Erta keldi: {dayTiming.earlyArrival} · Erta
                        ketdi: {dayTiming.earlyLeave} · Kech ketdi: {dayTiming.overtime}
                        {!showShiftCol ? (
                          <>
                            {" "}
                            · Reja: {activeWorkHours.start}–{activeWorkHours.end}
                          </>
                        ) : null}
                      </span>
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                        <th className="w-12 px-2 py-2 text-center">№</th>
                        <th className="px-3 py-2">F.I.Sh.</th>
                        <th className="px-3 py-2">Lavozim</th>
                        <th className="px-3 py-2">Holat</th>
                        {showShiftCol ? (
                          <th className="px-3 py-2">Smena / vaqt</th>
                        ) : null}
                        <th className="px-3 py-2">Kelish</th>
                        <th className="px-3 py-2">Ketish</th>
                        <th className="px-3 py-2">Ishlagan</th>
                        <TimingHeaderCells workStart={activeWorkHours.start} workEnd={activeWorkHours.end} />
                        {canSeeNotes ? (
                          <th className="w-14 px-2 py-2 text-center">Izoh</th>
                        ) : null}
                        {showRowActions ? <th className="px-3 py-2 w-20" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEmployeesForDay.length === 0 ? (
                        <tr>
                          <td
                            colSpan={
                              (showShiftCol ? 11 : 10) +
                              (canSeeNotes ? 1 : 0) +
                              (showRowActions ? 1 : 0)
                            }
                            className="px-3 py-10 text-center text-sm text-muted-foreground"
                          >
                            Tanlangan holat bo‘yicha xodim topilmadi
                          </td>
                        </tr>
                      ) : null}
                      {visibleEmployeesForDay.map(({ emp, day }, idx) => (
                        <tr
                          key={emp.id}
                          className={cn(
                            "border-b border-slate-100 dark:border-slate-700/60 hover:brightness-[0.98] dark:hover:bg-slate-800/40",
                            day!.excused ? EXCUSED_ROW : STATUS_ROW[day!.status],
                          )}
                        >
                          <td className="px-2 py-2 text-center text-xs tabular-nums text-muted-foreground">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-2 font-medium text-foreground">{emp.fullName}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {userRoleLabel(emp.position) || "—"}
                          </td>
                          <td className="px-3 py-2">
                            <StatusPill
                              status={day!.status}
                              excused={day!.excused}
                              onClick={
                                day!.excused
                                  ? () => openDayNote(emp.fullName, selectedDay, day!)
                                  : undefined
                              }
                            />
                            {day!.excused && day!.excuseNote ? (
                              <button
                                type="button"
                                className="mt-1 block max-w-[12rem] truncate text-left text-[11px] font-medium text-teal-800 dark:text-teal-200"
                                title={day!.excuseNote}
                                onClick={() => openDayNote(emp.fullName, selectedDay, day!)}
                              >
                                {day!.excuseNote}
                              </button>
                            ) : null}
                          </td>
                          {showShiftCol ? (
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {(() => {
                                const h = {
                                  start: day!.planStart || workHoursForEmployee(emp).start,
                                  end: day!.planEnd || workHoursForEmployee(emp).end,
                                };
                                const plan = String(day!.planShift || "");
                                const shiftName =
                                  plan === "one+two"
                                    ? "1+2"
                                    : plan === "two+three"
                                      ? "2+3"
                                      : plan === "one+three"
                                        ? "1+3"
                                        : plan === "one"
                                          ? "1-smena"
                                          : plan === "two"
                                            ? "2-smena"
                                            : plan === "three"
                                              ? "3-smena"
                                              : plan === "office"
                                                ? "Ofis"
                                                : null;
                                const kind = classifyDavomatStaff(emp);
                                const bucket = pharmacyShiftBucket(emp);
                                const assigned =
                                  bucket === "shift_12"
                                    ? "1+2"
                                    : bucket === "shift_23"
                                      ? "2+3"
                                      : bucket === "shift_three"
                                        ? "3-smena"
                                        : bucket === "shift_two"
                                          ? "2-smena"
                                          : "1-smena";
                                const base =
                                  day!.planCustom && shiftName
                                    ? `${shiftName} · ${h.start}–${h.end}`
                                    : shiftName === "1+2" || shiftName === "2+3" || shiftName === "1+3"
                                      ? `${shiftName} · ${h.start}–${h.end}`
                                      : kind === "shift_one" || kind === "shift_two"
                                        ? `${assigned} · ${h.start}–${h.end}`
                                        : kind === "warehouse" || kind === "security"
                                          ? emp.shiftLabel
                                            ? `${emp.shiftLabel} · ${h.start}–${h.end}`
                                            : `${smenaLabelShort(emp)} · ${h.start}–${h.end}`
                                          : `${h.start}–${h.end}`;
                                return day!.planCustom ? `${base} · o‘zgartirilgan` : base;
                              })()}
                            </td>
                          ) : null}
                          <td className="px-3 py-2 tabular-nums">{day!.checkIn}</td>
                          <td className="px-3 py-2 tabular-nums">{day!.checkOut}</td>
                          <td className="px-3 py-2 tabular-nums font-medium">{day!.workedHours}</td>
                          <td className="px-3 py-2 text-amber-700 dark:text-amber-400">
                            <TimeMetric value={day!.lateArrivalLabel} />
                          </td>
                          <td className="px-3 py-2 text-emerald-700 dark:text-emerald-400">
                            <TimeMetric value={day!.earlyArrivalLabel} />
                          </td>
                          <td className="px-3 py-2 text-rose-700 dark:text-rose-400">
                            <TimeMetric value={day!.earlyLeaveLabel} />
                          </td>
                          <td className="px-3 py-2 text-sky-700 dark:text-sky-400">
                            <TimeMetric value={day!.overtimeLabel} />
                          </td>
                          {canSeeNotes ? (
                            <td className="px-1 py-2 text-center">
                              {day!.notes?.trim() ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40"
                                  title="Izohni o‘qish"
                                  onClick={() => openDayNote(emp.fullName, selectedDay, day!)}
                                >
                                  <MessageSquareText className="h-3.5 w-3.5" />
                                </Button>
                              ) : (
                                <span className="text-[11px] text-muted-foreground/50">—</span>
                              )}
                            </td>
                          ) : null}
                          {showRowActions ? (
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-0.5">
                                {canEdit ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                    title={t("davomat.editTitle")}
                                    onClick={() => openEdit(emp, selectedDay)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                                {canReset && dayHasPunch(day) ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    title={t("davomat.resetBtn")}
                                    onClick={() => openReset(emp, selectedDay)}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                                {canExcuse ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className={cn(
                                      "h-8 w-8 p-0 text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-300 dark:hover:bg-teal-950/40",
                                      day!.excused && "bg-teal-100 dark:bg-teal-950/50",
                                    )}
                                    title="Sababli qilish"
                                    onClick={() => openExcuse(emp, selectedDay)}
                                  >
                                    <BadgeCheck className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                                {canSchedule ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className={cn(
                                      "h-8 w-8 p-0 text-sky-700 hover:bg-sky-50 hover:text-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/40",
                                      day!.planCustom && "bg-sky-100 dark:bg-sky-950/50",
                                    )}
                                    title="Smena va vaqt"
                                    onClick={() => openSchedule(emp, selectedDay)}
                                  >
                                    <Clock3 className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
              </>
            ) : (
              <PeriodAttendanceGrid
                title={periodTitle}
                subtitle={periodSubtitle}
                dates={periodDates}
                employees={filteredEmployees}
                employeeCount={filteredEmployees.length}
                staffFilter={viewFilter}
                canEdit={canEdit}
                canSeeNotes={canSeeNotes}
                canExcuse={canExcuse}
                canSchedule={canSchedule}
                onViewNote={(fullName, workDate, day) => openDayNote(fullName, workDate, day)}
                onExcuse={openExcuse}
                onSchedule={openSchedule}
                onEdit={openEdit}
              />
            )
          ) : null}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <DavomatAnalyticsDashboard embedded bare />
        </TabsContent>

        <TabsContent value="totals" className="mt-4 space-y-4">
          <Card className="border-border shadow-sm">
            <CardContent className="pt-5">{filters}</CardContent>
          </Card>

          {loading && !report ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> {t("ui.loading")}
            </div>
          ) : report ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat
                  icon={<Users className="h-4 w-4" />}
                  label="Xodimlar"
                  value={String(periodAnalytics.employees)}
                  sub={`Davr: ${periodAnalytics.dayCount} ish kuni`}
                />
                <Stat
                  icon={<Percent className="h-4 w-4 text-emerald-600" />}
                  label="Davomat foizi"
                  value={`${periodAnalytics.attendancePct}%`}
                  sub={`Kelgan ${periodAnalytics.presentDays} · Kelmagan ${periodAnalytics.absentDays} kun`}
                />
                <Stat
                  icon={<Clock3 className="h-4 w-4 text-amber-600" />}
                  label="Kechikkan xodimlar"
                  value={`${periodAnalytics.latePeople} kishi`}
                  sub={`Jami kech: ${periodAnalytics.lateLabel}`}
                />
                <Stat
                  icon={<UserCheck className="h-4 w-4 text-sky-600" />}
                  label="Ishlangan vaqt"
                  value={periodAnalytics.workedLabel}
                  sub={`O‘rtacha: ${periodAnalytics.avgWorkedLabel} / xodim`}
                />
              </div>

              <Card className="border-border shadow-sm overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Xodimlar jami · {periodFrom} — {periodTo}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Qatorni bosing — shu xodimning kunlari chiqadi</p>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2">№</th>
                        <th className="px-3 py-2">F.I.Sh.</th>
                        <th className="px-3 py-2">Lavozim</th>
                        <th className="px-3 py-2">Kelgan</th>
                        <th className="px-3 py-2">Kelmagan</th>
                        <th className="px-3 py-2">
                          Kech
                          <span className="block font-normal text-[10px] text-muted-foreground">kunlar</span>
                        </th>
                        <th className="px-3 py-2">
                          Ishlagan
                        </th>
                        <TimingHeaderCells workStart={activeWorkHours.start} workEnd={activeWorkHours.end} />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployees.map((e, i) => (
                        <tr
                          key={e.id}
                          className={cn(
                            "border-b border-slate-100 dark:border-slate-700/60 cursor-pointer hover:bg-muted dark:hover:bg-slate-800/50",
                            selectedEmpId === e.id && "bg-sky-50 dark:bg-sky-500/15",
                          )}
                          onClick={() => setSelectedEmpId(selectedEmpId === e.id ? "all" : e.id)}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-[#0b3a5c] dark:text-sky-300">{e.fullName}</td>
                          <td className="px-3 py-2 text-muted-foreground">{e.position}</td>
                          <td className="px-3 py-2">{e.totals.present}</td>
                          <td className="px-3 py-2 text-rose-700 dark:text-rose-400">{e.totals.absent}</td>
                          <td className="px-3 py-2 text-amber-700 dark:text-amber-400">{e.totals.late}</td>
                          <td className="px-3 py-2 font-medium">{e.totals.workedHours}</td>
                          <td className="px-3 py-2 text-amber-700 dark:text-amber-400">{e.totals.lateArrivalLabel}</td>
                          <td className="px-3 py-2 text-emerald-700 dark:text-emerald-400">{e.totals.earlyArrivalLabel}</td>
                          <td className="px-3 py-2 text-rose-700 dark:text-rose-400">{e.totals.earlyLeaveLabel}</td>
                          <td className="px-3 py-2 text-sky-700 dark:text-sky-400">{e.totals.overtimeLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {detailEmployee ? (
                <Card className="border-border shadow-sm overflow-hidden">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{detailEmployee.fullName} — kunlar</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2">Sana</th>
                          <th className="px-3 py-2">Holat</th>
                          <th className="px-3 py-2">Kelish</th>
                          <th className="px-3 py-2">Ketish</th>
                          <th className="px-3 py-2">
                          Ishlagan
                        </th>
                          <TimingHeaderCells workStart={detailWorkHours.start} workEnd={detailWorkHours.end} />
                          {canSeeNotes ? (
                            <th className="w-14 px-2 py-2 text-center">Izoh</th>
                          ) : null}
                          {showRowActions ? <th className="px-3 py-2 w-20" /> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {detailEmployee.days.map((d) => (
                          <tr
                            key={d.date}
                            className={cn(
                              "border-b border-slate-100 dark:border-slate-700/60",
                              d.excused && EXCUSED_ROW,
                            )}
                          >
                            <td className="px-3 py-2 tabular-nums">{d.date}</td>
                            <td className="px-3 py-2">
                              <StatusPill
                                status={d.status}
                                excused={d.excused}
                                onClick={
                                  d.excused
                                    ? () => openDayNote(detailEmployee.fullName, d.date, d)
                                    : undefined
                                }
                              />
                              {d.excused && d.excuseNote ? (
                                <button
                                  type="button"
                                  className="mt-1 block max-w-[12rem] truncate text-left text-[11px] font-medium text-teal-800 dark:text-teal-200"
                                  title={d.excuseNote}
                                  onClick={() => openDayNote(detailEmployee.fullName, d.date, d)}
                                >
                                  {d.excuseNote}
                                </button>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 tabular-nums">{d.checkIn}</td>
                            <td className="px-3 py-2 tabular-nums">{d.checkOut}</td>
                            <td className="px-3 py-2 font-medium tabular-nums">{d.workedHours}</td>
                            <td className="px-3 py-2 text-amber-700 dark:text-amber-400">
                              <TimeMetric value={d.lateArrivalLabel} />
                            </td>
                            <td className="px-3 py-2 text-emerald-700 dark:text-emerald-400">
                              <TimeMetric value={d.earlyArrivalLabel} />
                            </td>
                            <td className="px-3 py-2 text-rose-700 dark:text-rose-400">
                              <TimeMetric value={d.earlyLeaveLabel} />
                            </td>
                            <td className="px-3 py-2 text-sky-700 dark:text-sky-400">
                              <TimeMetric value={d.overtimeLabel} />
                            </td>
                            {canSeeNotes ? (
                              <td className="px-1 py-2 text-center">
                                {d.notes?.trim() ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40"
                                    title="Izohni o‘qish"
                                    onClick={() => openDayNote(detailEmployee.fullName, d.date, d)}
                                  >
                                    <MessageSquareText className="h-3.5 w-3.5" />
                                  </Button>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground/50">—</span>
                                )}
                              </td>
                            ) : null}
                            {showRowActions ? (
                              <td className="px-2 py-2">
                                <div className="flex items-center gap-0.5">
                                  {canEdit ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0"
                                      title={t("davomat.editTitle")}
                                      onClick={() => openEdit(detailEmployee, d.date)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  ) : null}
                                  {canReset && dayHasPunch(d) ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                      title={t("davomat.resetBtn")}
                                      onClick={() => openReset(detailEmployee, d.date)}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                  ) : null}
                                  {canExcuse ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className={cn(
                                        "h-8 w-8 p-0 text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-300 dark:hover:bg-teal-950/40",
                                        d.excused && "bg-teal-100 dark:bg-teal-950/50",
                                      )}
                                      title="Sababli qilish"
                                      onClick={() => openExcuse(detailEmployee, d.date)}
                                    >
                                      <BadgeCheck className="h-3.5 w-3.5" />
                                    </Button>
                                  ) : null}
                                  {canSchedule ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className={cn(
                                        "h-8 w-8 p-0 text-sky-700 hover:bg-sky-50 hover:text-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/50",
                                        d.planCustom && "bg-sky-100 dark:bg-sky-950/50",
                                      )}
                                      title="Smena va vaqt"
                                      onClick={() => openSchedule(detailEmployee, d.date)}
                                    >
                                      <Clock3 className="h-3.5 w-3.5" />
                                    </Button>
                                  ) : null}
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="jarima" className="mt-4">
          <DavomatJarimaPanel month={selectedDay.slice(0, 7)} />
        </TabsContent>

        <TabsContent value="smena" className="mt-4">
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Yuklanmoqda…
              </div>
            }
          >
            <SmenaFilialPage />
          </Suspense>
        </TabsContent>

        {canChecklist ? (
          <TabsContent value="checklist" className="mt-4">
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" /> Yuklanmoqda…
                </div>
              }
            >
              <ChecklistHolatiPage />
            </Suspense>
          </TabsContent>
        ) : null}
      </Tabs>

      <Dialog open={Boolean(edit) && canEdit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("davomat.editTitle")}</DialogTitle>
          </DialogHeader>
          {edit ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{edit.fullName}</span> · {edit.workDate}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Kelish (HH:MM)</Label>
                  <Input
                    placeholder="09:05"
                    value={edit.checkIn}
                    onChange={(e) => setEdit({ ...edit, checkIn: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Ketish (HH:MM)</Label>
                  <Input
                    placeholder="18:10"
                    value={edit.checkOut}
                    onChange={(e) => setEdit({ ...edit, checkOut: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>Holat</Label>
                <Select value={edit.status} onValueChange={(v) => setEdit({ ...edit, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Avto (vaqtdan)</SelectItem>
                    <SelectItem value="present">Kelgan</SelectItem>
                    <SelectItem value="late">Kech</SelectItem>
                    <SelectItem value="absent">Kelmagan</SelectItem>
                    <SelectItem value="leave">Ta’til</SelectItem>
                    <SelectItem value="incomplete">Ketish yo‘q</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Izoh</Label>
                <Input
                  value={edit.notes}
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                  placeholder="Ixtiyoriy"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEdit(null)}>
              Bekor
            </Button>
            <Button type="button" onClick={() => void saveEdit()} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(schedule) && canSchedule} onOpenChange={(o) => !o && !saving && setSchedule(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Smena va vaqt</DialogTitle>
          </DialogHeader>
          {schedule ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{schedule.fullName}</span>
                {" · "}
                {schedule.workDate}
              </p>
              <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
                Faqat shu xodimga ta’sir qiladi. Smena tanlansa standart vaqt chiqadi. Kelish va ketishni shu xodim uchun o‘zgartirish mumkin. Davomat, jarima va Keldim/Ketdim shu vaqtga qarab hisoblanadi.
              </p>
              {schedule.loading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={schedule.mode === "permanent" ? "default" : "outline"}
                      className="rounded-xl"
                      onClick={() => setSchedule({ ...schedule, mode: "permanent" })}
                    >
                      Doimiy
                    </Button>
                    <Button
                      type="button"
                      variant={schedule.mode === "period" ? "default" : "outline"}
                      className="rounded-xl"
                      onClick={() => setSchedule({ ...schedule, mode: "period" })}
                    >
                      Muddatli
                    </Button>
                  </div>
                  <div className={schedule.mode === "period" ? "grid grid-cols-2 gap-3" : ""}>
                    <div>
                      <Label>{schedule.mode === "period" ? "Boshlanish" : "Shu sanadan"}</Label>
                      <Input
                        type="date"
                        value={schedule.validFrom}
                        onChange={(e) => setSchedule({ ...schedule, validFrom: e.target.value })}
                      />
                    </div>
                    {schedule.mode === "period" ? (
                      <div>
                        <Label>Tugash</Label>
                        <Input
                          type="date"
                          value={schedule.validTo}
                          onChange={(e) => setSchedule({ ...schedule, validTo: e.target.value })}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <Label>Smena</Label>
                    <Select
                      value={schedule.shiftKey}
                      onValueChange={(key) => {
                        const picked = schedule.shifts.find((item) => item.key === key);
                        setSchedule({
                          ...schedule,
                          shiftKey: key,
                          startHm: picked?.start || schedule.startHm,
                          endHm: picked?.end || schedule.endHm,
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(schedule.shifts.length
                          ? schedule.shifts
                          : [
                              { key: "office", label: "Ofis", start: "09:00", end: "18:00" },
                              { key: "one", label: "1-smena", start: "08:00", end: "17:00" },
                              { key: "two", label: "2-smena", start: "17:00", end: "23:45" },
                              { key: "three", label: "3-smena", start: "23:00", end: "07:00" },
                            ]
                        ).map((item) => (
                          <SelectItem key={item.key} value={item.key}>
                            {item.label} · {item.start}–{item.end}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Kelish</Label>
                      <Input
                        value={schedule.startHm}
                        placeholder="09:00"
                        onChange={(e) => setSchedule({ ...schedule, startHm: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Ketish</Label>
                      <Input
                        value={schedule.endHm}
                        placeholder="18:00"
                        onChange={(e) => setSchedule({ ...schedule, endHm: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-between">
            {schedule?.currentId ? (
              <Button type="button" variant="outline" disabled={saving || schedule.loading} onClick={() => void clearSchedule()}>
                Standartga qaytarish
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setSchedule(null)}>
                Bekor
              </Button>
              <Button type="button" disabled={saving || schedule?.loading} onClick={() => void saveSchedule()}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Saqlash
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(excuse) && canExcuse} onOpenChange={(o) => !o && !saving && setExcuse(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Sababli qilish</DialogTitle>
          </DialogHeader>
          {excuse ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{excuse.fullName}</span>
                {" · "}
                {excuse.workDate}
              </p>
              <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-950 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100">
                Sababli kun jarimasiz. Davomatda holat «Sababli» bo‘lib turadi.
              </p>
              <div>
                <Label>Holat</Label>
                <Select value={excuse.status} onValueChange={(v) => setExcuse({ ...excuse, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="present">Kelgan</SelectItem>
                    <SelectItem value="late">Kechikkan</SelectItem>
                    <SelectItem value="incomplete">Ketish yo‘q</SelectItem>
                    <SelectItem value="absent">Kelmagan</SelectItem>
                    <SelectItem value="leave">Ta’til</SelectItem>
                    <SelectItem value="rest">Dam</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Izoh</Label>
                <Textarea
                  value={excuse.note}
                  onChange={(e) => setExcuse({ ...excuse, note: e.target.value })}
                  placeholder="Sababni yozing — majburiy"
                  className="min-h-24"
                  maxLength={500}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setExcuse(null)} disabled={saving}>
              Bekor
            </Button>
            <Button
              type="button"
              className="bg-teal-700 hover:bg-teal-800"
              onClick={() => void saveExcuse()}
              disabled={saving || (excuse?.note.trim().length ?? 0) < 3}
            >
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Sababli saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(noteView)} onOpenChange={(o) => !o && setNoteView(null)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">{noteView?.excused ? "Sababli" : "Izoh"}</DialogTitle>
          </DialogHeader>
          {noteView ? (
            <div className="space-y-2 text-sm">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{noteView.fullName}</span>
                {" · "}
                {formatLongDate(noteView.workDate, "uz")}
              </p>
              {noteView.excused ? (
                <div className="space-y-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-sm leading-relaxed text-teal-950 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100">
                  <p>
                    <span className="font-semibold">Kim belgilagan:</span>{" "}
                    {noteView.excusedByName || "noma’lum"}
                  </p>
                  {noteView.excusedAt ? (
                    <p>
                      <span className="font-semibold">Qachon belgilangan:</span>{" "}
                      {formatExcuseStamp(noteView.excusedAt)}
                    </p>
                  ) : null}
                  <p>Bu kun jarimasiz hisoblanadi.</p>
                </div>
              ) : null}
              <p
                className={cn(
                  "whitespace-pre-wrap rounded-xl border px-3 py-2.5 leading-relaxed text-foreground",
                  noteView.excused
                    ? "border-teal-200/80 bg-teal-50/60 dark:border-teal-800/50 dark:bg-teal-950/30"
                    : "border-violet-200/80 bg-violet-50/60 dark:border-violet-800/50 dark:bg-violet-950/30",
                )}
              >
                {noteView.notes || "—"}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setNoteView(null)}>
              Yopish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(resetTarget)} onOpenChange={(o) => !o && !resetting && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("davomat.resetTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {resetTarget ? (
                <>
                  <span className="font-medium text-foreground">{resetTarget.fullName}</span>
                  {" · "}
                  {resetTarget.workDate}
                  <br />
                </>
              ) : null}
              {t("davomat.resetChoose")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {resetTarget ? (
            <div className="grid gap-2">
              {(
                [
                  {
                    part: "in" as const,
                    icon: LogIn,
                    title: t("davomat.resetIn"),
                    time: resetTarget.checkIn,
                    hint: resetTarget.checkOut ? t("davomat.resetInKeepOut") : t("davomat.resetInHint"),
                    tone: "border-sky-200 hover:bg-sky-50 dark:border-sky-500/30 dark:hover:bg-sky-500/10",
                  },
                  {
                    part: "out" as const,
                    icon: LogOut,
                    title: t("davomat.resetOut"),
                    time: resetTarget.checkOut,
                    hint: t("davomat.resetOutHint"),
                    tone: "border-amber-200 hover:bg-amber-50 dark:border-amber-500/30 dark:hover:bg-amber-500/10",
                  },
                  {
                    part: "all" as const,
                    icon: RotateCcw,
                    title: t("davomat.resetAll"),
                    time: null,
                    hint: t("davomat.resetDesc"),
                    tone: "border-red-200 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10",
                  },
                ]
              ).map((opt) => {
                const unavailable = opt.part !== "all" && !opt.time;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.part}
                    type="button"
                    disabled={Boolean(resetting) || unavailable}
                    onClick={() => void confirmReset(opt.part)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      opt.tone,
                      opt.part === "all" && "text-destructive",
                    )}
                  >
                    {resetting === opt.part ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                        {opt.title}
                        {opt.part !== "all" ? (
                          <span className="tabular-nums text-xs font-medium text-muted-foreground">
                            {opt.time ?? t("davomat.resetNotMarked")}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{opt.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(resetting)}>{t("ui.cancelFull")}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TimingHeaderCells({ workStart, workEnd }: { workStart: string; workEnd: string }) {
  const sub = "block whitespace-nowrap font-normal text-[10px] text-muted-foreground";
  return (
    <>
      <th className="whitespace-nowrap px-3 py-2">
        Kech keldi
        <span className={sub}>{workStart} dan keyin</span>
      </th>
      <th className="whitespace-nowrap px-3 py-2">
        Erta keldi
        <span className={sub}>{workStart} dan oldin</span>
      </th>
      <th className="whitespace-nowrap px-3 py-2">
        Erta ketdi
        <span className={sub}>{workEnd} dan oldin</span>
      </th>
      <th className="whitespace-nowrap px-3 py-2">
        Kech ketdi
        <span className={sub}>{workEnd} dan keyin</span>
      </th>
    </>
  );
}

function TimeMetric({ value }: { value: string }) {
  if (!value || value === "—") return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums font-medium">{value}</span>;
}

const COL_W = 108;
const NUM_W = 48;
const NAME_W = 200;

function PeriodAttendanceGrid({
  title,
  subtitle,
  dates,
  employees,
  employeeCount,
  staffFilter,
  canEdit,
  canSeeNotes = false,
  canExcuse = false,
  canSchedule = false,
  onViewNote,
  onExcuse,
  onSchedule,
  onEdit,
}: {
  title: string;
  subtitle: string;
  dates: string[];
  employees: DavomatEmployee[];
  employeeCount: number;
  staffFilter: DavomatStaffFilter;
  canEdit: boolean;
  canSeeNotes?: boolean;
  canExcuse?: boolean;
  canSchedule?: boolean;
  onViewNote?: (fullName: string, workDate: string, day: DavomatDayMetrics) => void;
  onExcuse?: (emp: DavomatEmployee, date: string) => void;
  onSchedule?: (emp: DavomatEmployee, date: string) => void;
  onEdit: (emp: DavomatEmployee, date: string) => void;
}) {
  const { t } = useI18n();
  const topBarRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const tableWidth = NUM_W + NAME_W + dates.length * COL_W;

  const rows = useMemo(
    () =>
      employees.map((emp) => ({
        emp,
        daysByDate: new Map(emp.days.map((d) => [d.date, d])),
      })),
    [employees],
  );

  const updateArrows = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(max - el.scrollLeft > 2);
  }, []);

  const syncFrom = useCallback(
    (source: HTMLDivElement) => {
      if (syncing.current) return;
      syncing.current = true;
      const left = source.scrollLeft;
      if (topBarRef.current && topBarRef.current !== source) topBarRef.current.scrollLeft = left;
      if (mainRef.current && mainRef.current !== source) mainRef.current.scrollLeft = left;
      if (bottomBarRef.current && bottomBarRef.current !== source) {
        bottomBarRef.current.scrollLeft = left;
      }
      updateArrows();
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    },
    [updateArrows],
  );

  useEffect(() => {
    updateArrows();
    const onResize = () => updateArrows();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [dates.length, employees.length, updateArrows]);

  const scrollByStep = (dir: -1 | 1) => {
    mainRef.current?.scrollBy({ left: dir * COL_W * 3, behavior: "smooth" });
  };

  const ScrollRail = ({
    barRef,
    label,
  }: {
    barRef: React.RefObject<HTMLDivElement | null>;
    label: string;
  }) => (
    <div className="flex items-center gap-2 border-b border-border bg-[#0b3a5c]/[0.03] px-2 py-2 dark:bg-slate-800/40 sm:px-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-9 shrink-0 gap-1 rounded-xl border-[#0b3a5c]/20 bg-card px-2.5 text-[#0b3a5c] hover:bg-[#0b3a5c]/5 disabled:opacity-40 dark:border-sky-500/30 dark:text-sky-300 dark:hover:bg-sky-500/10"
        disabled={!canLeft}
        onClick={() => scrollByStep(-1)}
        aria-label="Chapga"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Orqaga</span>
      </Button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#0b3a5c]/70 dark:text-sky-400/80">
            <MoveHorizontal className="h-3.5 w-3.5" />
            {label}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">{dates.length} kun</span>
        </div>
        <div
          ref={barRef}
          className="overflow-x-auto rounded-lg border border-border bg-card"
          onScroll={(e) => syncFrom(e.currentTarget)}
        >
          <div style={{ width: tableWidth, height: 14 }} aria-hidden />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-9 shrink-0 gap-1 rounded-xl border-[#0b3a5c]/20 bg-card px-2.5 text-[#0b3a5c] hover:bg-[#0b3a5c]/5 disabled:opacity-40 dark:border-sky-500/30 dark:text-sky-300 dark:hover:bg-sky-500/10"
        disabled={!canRight}
        onClick={() => scrollByStep(1)}
        aria-label="O‘ngga"
      >
        <span className="hidden sm:inline">Oldinga</span>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <Card className="overflow-hidden border-border shadow-sm">
      <CardHeader className="border-b border-slate-100 bg-muted/60 pb-3 dark:border-slate-700/60 dark:bg-slate-800/50">
        <CardTitle className="text-base text-[#0b3a5c] dark:text-sky-300">{title}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {canEdit ? "Katakka bosing — tahrirlash · " : ""}
          {employeeCount} xodim
          {staffFilter !== "all" ? ` · ${staffFilterLabel(staffFilter)}` : ""}
          {dates.length ? ` · ${dates.length} kun` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-medium">
          <span className="rounded-md border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300">
            Yashil = Kelgan
          </span>
          <span className="rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300">
            Sariq = Kechikdi
          </span>
          <span className="rounded-md border border-rose-300 bg-rose-100 px-2 py-0.5 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-300">
            Qizil = Kelmagan
          </span>
          <span className="rounded-md border border-violet-300 bg-violet-100 px-2 py-0.5 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-300">
            Binafsha = Ta’til
          </span>
          <span className="rounded-md border border-sky-300 bg-sky-100 px-2 py-0.5 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-300">
            Ko‘k = Ketish —
          </span>
        </div>
      </CardHeader>

      {dates.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Bu davr uchun kunlar yo‘q</p>
      ) : (
        <div className="flex flex-col">
          <ScrollRail barRef={topBarRef} label="Sanalarni surish" />

          <div
            ref={mainRef}
            className="max-h-[min(68vh,720px)] overflow-auto"
            onScroll={(e) => syncFrom(e.currentTarget)}
          >
            <table
              className="border-collapse text-sm"
              style={{ width: tableWidth, minWidth: tableWidth }}
            >
              <thead className="sticky top-0 z-20">
                <tr className="border-b border-border bg-primary text-primary-foreground">
                  <th
                    className="sticky left-0 z-30 bg-[#0b3a5c] px-2 py-2.5 text-center text-xs font-semibold"
                    style={{ width: NUM_W, minWidth: NUM_W, left: 0 }}
                  >
                    №
                  </th>
                  <th
                    className="sticky z-30 bg-[#0b3a5c] px-3 py-2.5 text-left text-xs font-semibold tracking-wide shadow-[4px_0_10px_-4px_rgba(0,0,0,0.25)]"
                    style={{ width: NAME_W, minWidth: NAME_W, left: NUM_W }}
                  >
                    F.I.Sh.
                  </th>
                  {dates.map((date) => (
                    <th
                      key={date}
                      className="px-1 py-2 text-center font-medium"
                      style={{ width: COL_W, minWidth: COL_W }}
                    >
                      <div className="text-[10px] uppercase tracking-wide text-sky-200/90">
                        {weekdayShort(date, t)}
                      </div>
                      <div className="tabular-nums text-[11px]">{date.slice(5)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ emp, daysByDate }, rowIdx) => {
                  const zebra = rowIdx % 2 === 0;
                  const stickyBg = zebra ? "bg-card" : "bg-muted";
                  return (
                    <tr
                      key={emp.id}
                      className={cn("border-b border-slate-100 dark:border-slate-700/60", zebra ? "bg-card" : "bg-muted/40 dark:bg-slate-800/30")}
                    >
                      <td
                        className={cn(
                          "sticky left-0 z-10 px-2 py-1.5 text-center text-xs tabular-nums text-muted-foreground",
                          stickyBg,
                        )}
                        style={{ width: NUM_W, minWidth: NUM_W, left: 0 }}
                      >
                        {rowIdx + 1}
                      </td>
                      <td
                        className={cn(
                          "sticky z-10 px-3 py-1.5 shadow-[4px_0_10px_-4px_rgba(15,23,42,0.12)]",
                          stickyBg,
                        )}
                        style={{ width: NAME_W, minWidth: NAME_W, left: NUM_W }}
                      >
                        <div className="truncate font-medium text-foreground" title={emp.fullName}>
                          {emp.fullName}
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {emp.position ? `${userRoleLabel(emp.position)} · ` : ""}
                          {smenaLabelShort(emp)}
                        </div>
                      </td>
                      {dates.map((date) => {
                        const day = daysByDate.get(date);
                        const noteText = canSeeNotes ? day?.notes?.trim() : "";
                        const canOpenNote = Boolean(day && (day.excused || noteText) && onViewNote);
                        return (
                          <td key={date} className="px-1 py-1 align-middle">
                            <WeekCell
                              day={day}
                              hours={
                                day?.planStart && day?.planEnd
                                  ? { start: day.planStart, end: day.planEnd }
                                  : emp.workStart && emp.workEnd
                                    ? { start: emp.workStart, end: emp.workEnd }
                                    : undefined
                              }
                              canSeeNotes={canSeeNotes}
                              onNoteClick={
                                canOpenNote && day
                                  ? () => onViewNote!(emp.fullName, date, day)
                                  : undefined
                              }
                              onExcuse={canExcuse && onExcuse ? () => onExcuse(emp, date) : undefined}
                              onSchedule={canSchedule && onSchedule ? () => onSchedule(emp, date) : undefined}
                              onClick={canEdit ? () => onEdit(emp, date) : undefined}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="sticky bottom-0 z-30 border-t border-border bg-white/95 shadow-[0_-6px_16px_-8px_rgba(15,23,42,0.18)] backdrop-blur-sm">
            <ScrollRail barRef={bottomBarRef} label="Sanalarni surish (past)" />
          </div>
        </div>
      )}
    </Card>
  );
}

function dayCellTooltip(
  day: DavomatDayMetrics,
  hours: { start: string; end: string } | undefined,
  t: (k: string) => string,
  canSeeNotes = false,
) {
  const h = hours ?? { start: "09:00", end: "18:00" };
  if (day.status === "prehire") return "Ishga qabul qilinmagan";
  if (day.status === "outside") return "";
  if (day.status === "rest" && !day.excused) {
    return `${t("davomat.rest")}\n${t("davomat.restExtra")}`;
  }
  const lines = [
    day.restDayWork
      ? t("davomat.restExtra")
      : t(STATUS_KEYS[day.status] || day.status, day.status),
  ];
  lines.push(`${t("davomat.btnIn")}: ${day.checkIn} (${t("davomat.plan")} ${h.start})`);
  lines.push(`${t("davomat.btnOut")}: ${day.checkOut} (${t("davomat.plan")} ${h.end})`);
  if (day.workedHours && day.workedHours !== "0:00" && day.workedHours !== "—") {
    lines.push(`${t("davomat.workedHours")}: ${day.workedHours}`);
  }
  if (!day.restDayWork && day.lateArrivalLabel && day.lateArrivalLabel !== "—") {
    lines.push(`${t("davomat.lateIn")}: ${day.lateArrivalLabel}`);
  }
  if (day.earlyArrivalLabel && day.earlyArrivalLabel !== "—") {
    lines.push(`${t("davomat.earlyIn")}: ${day.earlyArrivalLabel}`);
  }
  if (!day.restDayWork && day.earlyLeaveLabel && day.earlyLeaveLabel !== "—") {
    lines.push(`${t("davomat.earlyOut")}: ${day.earlyLeaveLabel}`);
  }
  if (day.excused) {
    lines.unshift("Sababli (jarimasiz)");
    if (day.excuseNote?.trim()) lines.push(`Izoh: ${day.excuseNote.trim()}`);
    if (day.excusedByName) lines.push(`Kim belgilagan: ${day.excusedByName}`);
    if (day.excusedAt) lines.push(`Qachon belgilangan: ${formatExcuseStamp(day.excusedAt)}`);
  } else if (canSeeNotes && day.notes?.trim()) {
    lines.push(`Izoh: ${day.notes.trim()}`);
  }
  if (day.overtimeLabel && day.overtimeLabel !== "—") {
    lines.push(`+${day.overtimeLabel}`);
  }
  return lines.join("\n");
}

function WeekCell({
  day,
  onClick,
  hours,
  canSeeNotes = false,
  onNoteClick,
  onExcuse,
  onSchedule,
}: {
  day?: DavomatDayMetrics;
  onClick?: () => void;
  hours?: { start: string; end: string };
  canSeeNotes?: boolean;
  onNoteClick?: () => void;
  onExcuse?: () => void;
  onSchedule?: () => void;
}) {
  const { t } = useI18n();
  const status = day?.status || "absent";
  const excused = Boolean(day?.excused);
  const hasIn = Boolean(day?.checkIn && day.checkIn !== "—");
  const hasOut = Boolean(day?.checkOut && day.checkOut !== "—");
  const statusLabel =
    status === "prehire"
      ? "Ishga qabul qilinmagan"
      : status === "outside"
        ? ""
        : excused
          ? "Sababli"
          : day?.restDayWork
            ? t("davomat.restExtra")
            : t(WEEK_CELL_STATUS_KEYS[status] || STATUS_KEYS[status] || status, status);
  const showTimes =
    status !== "leave" &&
    status !== "rest" &&
    (hasIn || hasOut || status === "incomplete");
  const subline = day ? weekCellSublineParts(day) : null;
  const interactive = Boolean(onClick);
  const hasNote = Boolean((excused && day?.excuseNote) || (canSeeNotes && day?.notes?.trim()));
  const clickable = interactive || Boolean(onExcuse) || Boolean(onSchedule) || Boolean(onNoteClick);

  return (
    <button
      type="button"
      onClick={interactive ? onClick : undefined}
      disabled={!clickable}
      className={cn(
        "relative mx-auto flex w-full min-w-[72px] flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 py-1 font-medium",
        status === "prehire" ? "h-auto min-h-[62px]" : "h-[62px]",
        interactive
          ? "transition-colors hover:ring-2 hover:ring-[#0b3a5c]/20"
          : "cursor-default",
        excused ? EXCUSED_STYLE : STATUS_STYLE[status] || "bg-muted",
      )}
      title={day ? dayCellTooltip(day, hours, t, canSeeNotes) : interactive ? t("ui.edit") : undefined}
    >
      {hasNote ? (
        <span
          role="button"
          tabIndex={0}
          className="absolute right-0.5 top-0.5 rounded p-0.5 text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40"
          title="Izohni o‘qish"
          onClick={(e) => {
            e.stopPropagation();
            onNoteClick?.();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onNoteClick?.();
            }
          }}
        >
          <MessageSquareText className="h-3 w-3" />
        </span>
      ) : null}
      {onExcuse && status !== "prehire" && status !== "outside" ? (
        <span
          role="button"
          tabIndex={0}
          className="absolute bottom-0.5 right-0.5 rounded p-0.5 text-teal-700 hover:bg-teal-50 dark:text-teal-300"
          title="Sababli qilish"
          onClick={(e) => {
            e.stopPropagation();
            onExcuse();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onExcuse();
            }
          }}
        >
          <BadgeCheck className="h-3 w-3" />
        </span>
      ) : null}
      {onSchedule && status !== "prehire" && status !== "outside" ? (
        <span
          role="button"
          tabIndex={0}
          className="absolute bottom-0.5 left-0.5 rounded p-0.5 text-sky-700 hover:bg-sky-50 dark:text-sky-300"
          title="Smena va vaqt"
          onClick={(e) => {
            e.stopPropagation();
            onSchedule();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onSchedule();
            }
          }}
        >
          <Clock3 className="h-3 w-3" />
        </span>
      ) : null}
      <span
        className={cn(
          "w-full text-center font-bold leading-tight",
          status === "prehire" ? "whitespace-normal text-[8px]" : "whitespace-nowrap text-[10px] leading-none",
        )}
      >
        {statusLabel}
      </span>
      {showTimes ? (
        <span className="w-full whitespace-nowrap text-center text-[10px] font-semibold tabular-nums leading-tight">
          {hasIn ? day!.checkIn : "—"}–{hasOut ? day!.checkOut : "—"}
        </span>
      ) : null}
      {subline ? (
        <span className="flex w-full items-center justify-center gap-0.5 whitespace-nowrap text-center text-[9px] tabular-nums leading-none">
          {subline.worked ? <span className="opacity-75">{subline.worked}</span> : null}
          {subline.worked && subline.late ? <span className="opacity-50">·</span> : null}
          {subline.late ? (
            <span className="font-bold text-red-600 dark:text-red-500">
              Kech {subline.late}
            </span>
          ) : null}
          {(subline.worked || subline.late) && subline.earlyLeave ? (
            <span className="opacity-50">·</span>
          ) : null}
          {subline.earlyLeave ? (
            <span className="font-semibold text-amber-700 dark:text-amber-400 dark:text-amber-500">{subline.earlyLeave}</span>
          ) : null}
          {(subline.worked || subline.late || subline.earlyLeave) && subline.overtime ? (
            <span className="opacity-50">·</span>
          ) : null}
          {subline.overtime ? (
            <span className="font-semibold text-emerald-700 dark:text-emerald-400 dark:text-emerald-500">{subline.overtime}</span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="border-border shadow-sm">
      <CardContent className="flex items-start gap-3 pt-5">
        <div className="rounded-lg bg-slate-100 p-2 text-muted-foreground dark:bg-slate-700/50 dark:text-slate-300">
          {icon}
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
          {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}
