import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CalendarDays,
  Check,
  Clock3,
  Info,
  Loader2,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { monthLabelUz, useToggleWorkDay } from "@/lib/oylik-api";
import { formatDayUz, todayYmd } from "@/lib/oylik-period";
import {
  WEEKDAYS_UZ,
  hoursText,
  restSummary,
  spanLabel,
  useCancelSwap,
  useClearStaffHours,
  useCreateSwap,
  useDecideSwap,
  useDeleteRestRule,
  useSaveGraceMinutes,
  useSaveRestRule,
  useSaveShiftHours,
  useSaveStaffHours,
  useScopeStaff,
  useSwapStaff,
  useWorkCalendar,
  type ScopeHours,
  type ScopeSchedule,
  type ScopeStaffMember,
  type ShiftSwap,
  type SwapPayTo,
  type SwapStaff,
  type WorkCalendarData,
} from "@/lib/work-calendar-api";
import { useQueryClient } from "@tanstack/react-query";

const dmy = (ymd: string) => ymd.split("-").reverse().join(".");

function scopeHint(scope: string): string {
  if (scope === "dorixona:1") return "Standart: yakshanba dam. Dam kuni ishlasa — qo‘shimcha ish, jarimasiz.";
  if (scope === "dorixona:2") return "Doimiy ishlaydi. Dam faqat boshqa xodim bilan almashuv orqali.";
  if (scope === "ofis") return "Standart: shanba va yakshanba dam. Qaysi kunlar ish, qaysi kunlar dam ekanini belgilang.";
  if (scope === "xavfsizlik") return "Xavfsizlik o‘z navbatchilik jadvali bo‘yicha ishlaydi.";
  return "Haftada qaysi kun dam ekanini belgilang. Belgilanmasa — har kuni ish.";
}

function MonthGrid({
  month,
  schedule,
  canEdit,
  pending,
  onToggle,
}: {
  month: string;
  schedule: ScopeSchedule;
  canEdit: boolean;
  pending: boolean;
  onToggle: (day: string, isWork: boolean) => void;
}) {
  const work = new Set(schedule.month.workDays);
  const overridden = new Set(schedule.month.overrides.map((o) => o.day));
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y!, m!, 0).getDate();
  const pad = (new Date(`${month}-01T12:00:00+05:00`).getDay() + 6) % 7;
  const today = todayYmd();
  const cells: Array<string | null> = Array.from({ length: pad }, () => null);
  for (let d = 1; d <= last; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-muted-foreground">
        {WEEKDAYS_UZ.map((w) => <div key={w.day}>{w.short}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <div key={`e-${i}`} />;
          const isWork = work.has(iso);
          const cls = cn(
            "relative flex h-10 flex-col items-center justify-center rounded-lg text-[13px] font-semibold tabular-nums transition",
            isWork ? "bg-emerald-500 text-white dark:bg-emerald-600" : "bg-slate-200/80 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
            iso === today && "ring-2 ring-[#0b3a5c] ring-offset-1 dark:ring-sky-300",
            canEdit && "cursor-pointer hover:opacity-80",
            pending && "opacity-60",
          );
          const body = (
            <>
              {Number(iso.slice(8))}
              <span className={cn("text-[8px] font-bold uppercase leading-none", isWork ? "text-white/75" : "text-slate-400")}>{isWork ? "ish" : "dam"}</span>
              {overridden.has(iso) ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" title="Qo‘lda o‘zgartirilgan" /> : null}
            </>
          );
          return canEdit ? (
            <button key={iso} type="button" disabled={pending} className={cls} onClick={() => onToggle(iso, !isWork)} title={isWork ? "Dam kuni qilish" : "Ish kuni qilish"}>
              {body}
            </button>
          ) : (
            <div key={iso} className={cls}>{body}</div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-500" /> Ish kuni</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-slate-200 dark:bg-slate-700" /> Dam — jarima yozilmaydi</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> Qo‘lda o‘zgartirilgan kun</span>
        {canEdit ? <span className="ml-auto">Kunni bosib ish ↔ dam qiling</span> : null}
      </div>
    </div>
  );
}

const toMin = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const isHm = (v: string) => /^\d{2}:\d{2}$/.test(v);
const isOvernight = (start: string, end: string) => toMin(end) <= toMin(start);

const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES_5 = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

/** Brauzer tilidan qat’i nazar 24 soatlik HH:MM tanlash */
function HmPicker({ value, onChange, size = "lg" }: { value: string; onChange: (v: string) => void; size?: "lg" | "sm" }) {
  const [h = "", m = ""] = value.split(":");
  const minutes = MINUTES_5.includes(m) || !m ? MINUTES_5 : [...MINUTES_5, m].sort();
  const cls = cn(
    "appearance-none rounded-lg border border-slate-200 bg-white text-center font-semibold tabular-nums text-[#0f2744] outline-none transition focus:border-[#0b3a5c] focus:ring-2 focus:ring-[#0b3a5c]/15 dark:border-white/10 dark:bg-slate-900 dark:text-white",
    size === "lg" ? "h-11 w-[52px] text-base" : "h-9 w-[46px] text-sm",
  );
  return (
    <span className="inline-flex items-center gap-1">
      <select aria-label="Soat" value={h} onChange={(e) => onChange(`${e.target.value}:${m || "00"}`)} className={cls}>
        {!h ? <option value="">--</option> : null}
        {HOURS_24.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <span className="font-bold text-slate-400">:</span>
      <select aria-label="Daqiqa" value={m} onChange={(e) => onChange(`${h || "00"}:${e.target.value}`)} className={cls}>
        {!m ? <option value="">--</option> : null}
        {minutes.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </span>
  );
}

/** 24 soatlik chiziq: smena oynasi (tun smenasi ikki bo‘lakda) */
function DayTimeline({ start, end, tone = "emerald" }: { start: string; end: string; tone?: "emerald" | "violet" }) {
  if (!isHm(start) || !isHm(end)) return null;
  const s = (toMin(start) / 1440) * 100;
  const e = (toMin(end) / 1440) * 100;
  const fill = tone === "violet" ? "bg-violet-500" : "bg-emerald-500";
  const parts = e > s ? [[s, e - s]] : [[s, 100 - s], [0, e]];
  return (
    <div>
      <div className="relative h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
        {parts.map(([left, width], i) => (
          <span key={i} className={cn("absolute inset-y-0 rounded-full", fill)} style={{ left: `${left}%`, width: `${width}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-semibold tabular-nums text-slate-400">
        {["00", "06", "12", "18", "24"].map((h) => <span key={h}>{h}:00</span>)}
      </div>
    </div>
  );
}

const ORTA_PRESETS: Array<[string, string]> = [
  ["09:00", "18:00"],
  ["10:00", "19:00"],
  ["11:00", "20:00"],
  ["12:00", "21:00"],
  ["13:00", "22:00"],
];

function hoursHint(scope: string, hours: ScopeHours): string {
  if (scope === "dorixona:orta") {
    return hours.custom
      ? "O‘rta smena vaqti alohida belgilangan. Istalgan soatdan istalgan soatgacha qo‘yish mumkin — tunga o‘tsa ham."
      : "Hozircha 1-smena vaqti bilan ishlaydi. Kerakli soatni qo‘ying — O‘rta smenadagi barcha xodimlarga qo‘llanadi.";
  }
  if (hours.kind === "derived") return `${hours.from || "Boshqa smenalardan"} — avtomatik. O‘zgartirish uchun o‘sha smenalar vaqtini o‘zgartiring.`;
  if (scope === "dorixona:3") return "Tun smenasi — tugash vaqti ertasi kuni bo‘lishi mumkin.";
  return "Bu vaqt shu smenadagi barcha xodimlarning kelish-ketishi, kechikish va jarimasi uchun asos.";
}

const BREAK_PRESETS = [0, 30, 45, 60, 90];

const durationText = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h && m ? `${h} soat ${m} daq` : h ? `${h} soat` : `${m} daq`;
};

function HoursEditor({ data, schedule }: { data: WorkCalendarData; schedule: ScopeSchedule }) {
  const { toast } = useToast();
  const save = useSaveShiftHours();
  const hours = schedule.hours;
  const [start, setStart] = useState(hours?.start ?? "");
  const [end, setEnd] = useState(hours?.end ?? "");
  const [brk, setBrk] = useState(String(hours?.breakMin ?? 0));
  useEffect(() => {
    setStart(hours?.start ?? "");
    setEnd(hours?.end ?? "");
    setBrk(String(hours?.breakMin ?? 0));
  }, [schedule.scope, hours?.start, hours?.end, hours?.breakMin]);

  if (schedule.scope === "xavfsizlik") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
        <p className="text-sm font-semibold text-[#0f2744] dark:text-white">Ish vaqti</p>
        <p className="mt-1 text-[12px] text-muted-foreground">Xavfsizlik navbatchilik jadvali bo‘yicha: 09:00 dan ertasi kuni 09:00 gacha.</p>
      </div>
    );
  }
  if (!hours) return null;

  const isOrta = schedule.scope === "dorixona:orta";
  const editable = Boolean(data.canEditHours) && hours.kind !== "derived";
  const overnight = isHm(start) && isHm(end) && isOvernight(start, end);
  const nightAllowed = isOrta || schedule.scope === "dorixona:3";
  const breakEditable = editable && Boolean(hours.breakEditable);
  const breakNum = /^\d{1,3}$/.test(brk) ? Number(brk) : NaN;
  const span = isHm(start) && isHm(end) ? (toMin(end) - toMin(start) + 1440) % 1440 : 0;
  const breakBad = breakEditable && (!Number.isFinite(breakNum) || breakNum > 240 || (span > 0 && breakNum >= span));
  const dirty = start !== hours.start || end !== hours.end || (breakEditable && breakNum !== (hours.breakMin ?? 0));
  const invalid = !isHm(start) || !isHm(end) || start === end || (overnight && !nightAllowed) || breakBad;
  const usedBreak = breakEditable && Number.isFinite(breakNum) ? breakNum : hours.breakMin ?? 0;
  const netMin = Math.max(0, span - usedBreak);

  const submit = () => {
    if (invalid) {
      toast({
        title: breakBad ? "Tushlik noto‘g‘ri" : "Vaqt noto‘g‘ri",
        description: breakBad
          ? "Tushlik 0–240 daqiqa va smena davomiyligidan kam bo‘lsin"
          : overnight && !nightAllowed
            ? "Bu smena shu kunning o‘zida tugashi kerak"
            : "Boshlanish va tugashni to‘g‘ri kiriting",
        variant: "destructive",
      });
      return;
    }
    save.mutate(
      { scope: schedule.scope, start, end, ...(breakEditable ? { breakMin: breakNum } : {}) },
      {
        onSuccess: () =>
          toast({
            title: "Smena vaqti saqlandi",
            description: `${schedule.label} · ${start}–${end}${breakEditable ? ` · tushlik ${breakNum} daq` : ""}. Davomat shu vaqt bo‘yicha hisoblanadi.`,
          }),
        onError: (e) => toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );
  };

  const reset = () => {
    if (!window.confirm("O‘rta smena yana 1-smena vaqti bilan ishlasinmi?")) return;
    save.mutate(
      { scope: schedule.scope, reset: true },
      {
        onSuccess: () => toast({ title: "O‘rta smena 1-smena vaqtiga qaytarildi" }),
        onError: (e) => toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );
  };

  const shownStart = isHm(start) ? start : hours.start;
  const shownEnd = isHm(end) ? end : hours.end;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#0f2744] dark:text-white">Ish vaqti (soat)</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{hoursHint(schedule.scope, hours)}</p>
        </div>
        <span className="flex flex-wrap gap-1.5 text-[11px] font-bold">
          {hours.kind === "derived" ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-white/10 dark:text-slate-300">Avtomatik</span>
          ) : isOrta ? (
            <span className={cn("rounded-full px-2.5 py-1", hours.custom ? "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200" : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300")}>
              {hours.custom ? "Alohida vaqt" : "1-smena vaqti"}
            </span>
          ) : null}
          <span className="rounded-full bg-[#0b3a5c]/[0.07] px-2.5 py-1 text-[#0b3a5c] dark:bg-white/10 dark:text-sky-200">{spanLabel(shownStart, shownEnd)}</span>
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="flex items-center gap-2">
          {editable ? (
            <>
              <div>
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Boshlanadi</span>
                <HmPicker value={start} onChange={setStart} />
              </div>
              <span className="mt-5 text-slate-400">→</span>
              <div>
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Tugaydi</span>
                <HmPicker value={end} onChange={setEnd} />
              </div>
            </>
          ) : (
            <p className="text-2xl font-bold tabular-nums text-[#0f2744] dark:text-white">
              {hours.start} <span className="text-slate-400">→</span> {hours.end}
            </p>
          )}
        </div>
        <div className="min-w-0">
          <DayTimeline start={shownStart} end={shownEnd} tone={isOrta ? "violet" : "emerald"} />
          {overnight || (!editable && hours.overnight) ? (
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300">
              <Moon className="h-3 w-3" /> Ertasi kuni tugaydi
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-400">Tushlik (to‘lanmaydi):</span>
          {breakEditable ? (
            <>
              {BREAK_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setBrk(String(m))}
                  className={cn(
                    "h-7 rounded-lg border px-2 text-[11px] font-semibold tabular-nums transition",
                    breakNum === m
                      ? "border-[#0b3a5c] bg-[#0b3a5c] text-white"
                      : "border-slate-200 text-slate-600 hover:border-[#0b3a5c]/40 dark:border-white/10 dark:text-slate-300",
                  )}
                >
                  {m ? `${m} daq` : "Yo‘q"}
                </button>
              ))}
              <span className="inline-flex items-center gap-1">
                <Input
                  value={brk}
                  inputMode="numeric"
                  maxLength={3}
                  onChange={(e) => setBrk(e.target.value.replace(/\D/g, ""))}
                  className={cn("h-7 w-14 px-2 text-center text-[12px] font-semibold tabular-nums", breakBad && "border-rose-400 focus-visible:ring-rose-300")}
                  aria-label="Tushlik daqiqasi"
                />
                <span className="text-[11px] text-muted-foreground">daq</span>
              </span>
            </>
          ) : (
            <span className="text-[12px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
              {hours.breakMin ? `${hours.breakMin} daq` : "yo‘q"}
              {!hours.breakEditable ? <span className="ml-1 font-normal text-muted-foreground">· {isOrta ? "1-smena tushligi" : "asosiy smenalardan"}</span> : null}
            </span>
          )}
        </div>
        {span ? (
          <span className="inline-flex items-center gap-1.5 justify-self-start rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200 sm:justify-self-end">
            <Clock3 className="h-3 w-3" /> Sof ish vaqti: {durationText(netMin)}
          </span>
        ) : null}
      </div>

      {editable && isOrta ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-400">Tez tanlash:</span>
          {ORTA_PRESETS.map(([s, e]) => (
            <button
              key={s}
              type="button"
              onClick={() => { setStart(s); setEnd(e); }}
              className={cn(
                "h-7 rounded-lg border px-2 text-[11px] font-semibold tabular-nums transition",
                start === s && end === e ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200" : "border-slate-200 text-slate-600 hover:border-violet-300 dark:border-white/10 dark:text-slate-300",
              )}
            >
              {s}–{e}
            </button>
          ))}
        </div>
      ) : null}

      {editable ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-white/10">
          <Button type="button" className="h-9 gap-1.5 bg-[#0b3a5c] hover:bg-[#0b3a5c]/90" disabled={!dirty || invalid || save.isPending} onClick={submit}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Vaqtni saqlash
          </Button>
          {dirty ? (
            <Button type="button" variant="ghost" className="h-9" onClick={() => { setStart(hours.start); setEnd(hours.end); setBrk(String(hours.breakMin ?? 0)); }}>
              Bekor qilish
            </Button>
          ) : null}
          {isOrta && hours.custom ? (
            <Button type="button" variant="outline" className="h-9 gap-1.5" disabled={save.isPending} onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> 1-smena vaqtiga qaytarish
            </Button>
          ) : null}
          {hours.updatedByName ? <span className="ml-auto text-[11px] text-muted-foreground">Oxirgi o‘zgartirish: {hours.updatedByName}</span> : null}
        </div>
      ) : hours.kind !== "derived" ? (
        <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-muted-foreground dark:border-white/10">Smena vaqtini admin yoki direktor o‘zgartiradi.</p>
      ) : null}
    </div>
  );
}

const GRACE_PRESETS = [0, 5, 10, 15, 30];

function GraceCard({ data }: { data: WorkCalendarData }) {
  const { toast } = useToast();
  const save = useSaveGraceMinutes();
  const current = data.graceMinutes ?? 15;
  const [value, setValue] = useState(String(current));
  useEffect(() => setValue(String(current)), [current]);
  const num = /^\d{1,3}$/.test(value) ? Number(value) : NaN;
  const bad = !Number.isFinite(num) || num > 120;
  const dirty = !bad && num !== current;
  const editable = Boolean(data.canEditHours);

  const submit = () =>
    save.mutate(num, {
      onSuccess: () => toast({ title: "Kechikish chegarasi saqlandi", description: `${num} daqiqadan keyin kelganlar «kechikdi» deb belgilanadi` }),
      onError: (e) => toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" }),
    });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-[#0f2744] dark:text-white">Kechikish chegarasi</p>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">{current} daq</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">Smena boshlanganidan shuncha daqiqa o‘tib kelsa — kechikish. Barcha smena va ofisga amal qiladi.</p>
      {editable ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1">
            {GRACE_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setValue(String(m))}
                className={cn(
                  "h-7 min-w-[38px] rounded-lg border px-1.5 text-[11px] font-semibold tabular-nums transition",
                  num === m ? "border-[#0b3a5c] bg-[#0b3a5c] text-white" : "border-slate-200 text-slate-600 hover:border-[#0b3a5c]/40 dark:border-white/10 dark:text-slate-300",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              value={value}
              inputMode="numeric"
              maxLength={3}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              className={cn("h-8 w-16 text-center text-sm font-semibold tabular-nums", bad && "border-rose-400")}
              aria-label="Kechikish daqiqasi"
            />
            <span className="text-[11px] text-muted-foreground">daq</span>
            <Button type="button" size="sm" className="ml-auto h-8 gap-1 bg-[#0b3a5c] hover:bg-[#0b3a5c]/90" disabled={!dirty || save.isPending} onClick={submit}>
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Saqlash
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StaffHoursRow({
  member,
  scope,
  canEdit,
  defaultHours,
}: {
  member: ScopeStaffMember;
  scope: string;
  canEdit: boolean;
  defaultHours: ScopeHours | null | undefined;
}) {
  const { toast } = useToast();
  const save = useSaveStaffHours();
  const clear = useClearStaffHours();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(member.start);
  const [end, setEnd] = useState(member.end);
  const [period, setPeriod] = useState(false);
  const [from, setFrom] = useState(todayYmd());
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const ov = member.override;
  const differs = Boolean(ov) || Boolean(defaultHours && (member.start !== defaultHours.start || member.end !== defaultHours.end));

  const open = () => {
    setStart(member.start);
    setEnd(member.end);
    setPeriod(false);
    setFrom(todayYmd());
    setTo("");
    setNote("");
    setEditing(true);
  };

  const submit = () => {
    if (!isHm(start) || !isHm(end) || start === end) {
      toast({ title: "Vaqtni to‘g‘ri kiriting", variant: "destructive" });
      return;
    }
    if (period && (!to || to < from)) {
      toast({ title: "Muddat tugash sanasini to‘g‘ri tanlang", variant: "destructive" });
      return;
    }
    save.mutate(
      { employeeId: member.id, scope, start, end, validFrom: from, validTo: period ? to : null, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: "Shaxsiy vaqt saqlandi", description: `${member.fullName} · ${start}–${end}` });
          setEditing(false);
        },
        onError: (e) => toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );
  };

  const reset = () => {
    if (!window.confirm(`${member.fullName} yana smenaning umumiy vaqtiga qaytsinmi?`)) return;
    clear.mutate(member.id, {
      onSuccess: () => toast({ title: "Umumiy vaqtga qaytarildi", description: member.fullName }),
      onError: (e) => toast({ title: "Bekor qilinmadi", description: (e as Error).message, variant: "destructive" }),
    });
  };

  return (
    <div className={cn("rounded-lg border px-3 py-2", ov ? "border-amber-200 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-500/5" : "border-slate-200 dark:border-white/10")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#0f2744] dark:text-white">{member.fullName}</p>
          <p className="truncate text-[11px] text-muted-foreground">{[member.branch, member.position].filter(Boolean).join(" · ") || member.shiftLabel}</p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-bold tabular-nums",
            differs ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100" : "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200",
          )}
          title={ov ? `Shaxsiy vaqt · ${ov.mode === "period" ? `${dmy(ov.validFrom)} — ${ov.validTo ? dmy(ov.validTo) : ""}` : `${dmy(ov.validFrom)} dan`}` : "Smenaning umumiy vaqti"}
        >
          <Clock3 className="h-3 w-3" />
          {member.start}–{member.end}
          {member.overnight ? <Moon className="h-3 w-3 text-indigo-500" /> : null}
        </span>
        {ov ? (
          <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-950">
            {ov.mode === "period" ? `${dmy(ov.validFrom).slice(0, 5)}–${ov.validTo ? dmy(ov.validTo).slice(0, 5) : ""}` : "Shaxsiy"}
          </span>
        ) : null}
        {canEdit ? (
          <span className="flex gap-1">
            <button type="button" onClick={editing ? () => setEditing(false) : open} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-700 hover:border-[#0b3a5c]/50 dark:border-white/10 dark:text-slate-200">
              <Pencil className="h-3.5 w-3.5" /> Vaqt
            </button>
            {ov ? (
              <button type="button" disabled={clear.isPending} onClick={reset} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10" title="Umumiy vaqtga qaytarish">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {ov?.note ? <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-200">{ov.note}</p> : null}
      {editing ? (
        <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 dark:border-white/10">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Keladi</span>
              <HmPicker value={start} onChange={setStart} size="sm" />
            </div>
            <div>
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ketadi</span>
              <HmPicker value={end} onChange={setEnd} size="sm" />
            </div>
            <div className="flex h-9 overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold dark:border-white/10">
              {([false, true] as const).map((p) => (
                <button key={String(p)} type="button" onClick={() => setPeriod(p)} className={cn("px-2.5", period === p ? "bg-[#0b3a5c] text-white" : "text-slate-600 dark:text-slate-300")}>
                  {p ? "Muddatli" : "Doimiy"}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Qaysi sanadan</span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value || from)} className="h-9 w-[150px]" />
            </label>
            {period ? (
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Qaysi sanagacha</span>
                <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px]" />
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} placeholder="Izoh (ixtiyoriy): masalan, o‘qishi sababli" className="h-9 min-w-[200px] flex-1" />
            {isHm(start) && isHm(end) && start !== end ? (
              <span className="text-[11px] font-semibold text-muted-foreground">{spanLabel(start, end)}{isOvernight(start, end) ? " · ertasi tugaydi" : ""}</span>
            ) : null}
            <Button type="button" className="h-9 gap-1.5 bg-[#0b3a5c] hover:bg-[#0b3a5c]/90" disabled={save.isPending} onClick={submit}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Saqlash
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StaffHoursPanel({ data, schedule }: { data: WorkCalendarData; schedule: ScopeSchedule }) {
  const q = useScopeStaff(schedule.scope, schedule.staffCount > 0);
  const [needle, setNeedle] = useState("");
  const [onlyCustom, setOnlyCustom] = useState(false);
  const [limit, setLimit] = useState(30);
  const items = q.data?.items ?? [];
  const canEdit = Boolean(q.data?.canEditHours ?? data.canEditHours);
  const customCount = items.filter((m) => m.override).length;
  const shown = useMemo(() => {
    const n = needle.trim().toLowerCase();
    return items
      .filter((m) => !onlyCustom || m.override)
      .filter((m) => !n || `${m.fullName} ${m.branch} ${m.position}`.toLowerCase().includes(n));
  }, [items, needle, onlyCustom]);

  if (schedule.scope === "xavfsizlik") return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[#0f2744] dark:text-white">Xodimlar va ularning vaqti</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Har bir xodimga alohida kelish-ketish vaqti qo‘yish mumkin — doimiy yoki muddatli. Davomat, kechikish va jarima shu vaqtdan hisoblanadi.
          </p>
        </div>
        <span className="flex gap-1.5 text-[11px] font-bold">
          <button type="button" onClick={() => setOnlyCustom(false)} className={cn("rounded-full px-2.5 py-1", !onlyCustom ? "bg-[#0b3a5c] text-white" : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300")}>
            Hammasi {items.length}
          </button>
          <button type="button" onClick={() => setOnlyCustom(true)} className={cn("rounded-full px-2.5 py-1", onlyCustom ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200")}>
            Shaxsiy vaqtli {customCount}
          </button>
        </span>
      </div>
      {schedule.staffCount === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-muted-foreground dark:border-white/15">Bu smenada hozircha xodim yo‘q</p>
      ) : q.isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Xodimlar yuklanmoqda…</p>
      ) : q.error ? (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{(q.error as Error).message}</p>
      ) : (
        <>
          {items.length > 6 ? (
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={needle} onChange={(e) => { setNeedle(e.target.value); setLimit(30); }} placeholder="Ism, filial yoki lavozim…" className="h-9 pl-9" />
            </div>
          ) : null}
          <div className="mt-3 space-y-1.5">
            {shown.slice(0, limit).map((m) => (
              <StaffHoursRow key={m.id} member={m} scope={schedule.scope} canEdit={canEdit} defaultHours={schedule.hours} />
            ))}
            {!shown.length ? <p className="px-1 py-3 text-xs text-muted-foreground">Topilmadi</p> : null}
          </div>
          {shown.length > limit ? (
            <Button type="button" variant="outline" className="mt-2 h-8 w-full text-xs" onClick={() => setLimit((l) => l + 50)}>
              Yana {Math.min(50, shown.length - limit)} ta ko‘rsatish ({shown.length - limit} qoldi)
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function RuleEditor({ data, schedule, month }: { data: WorkCalendarData; schedule: ScopeSchedule; month: string }) {
  const { toast } = useToast();
  const save = useSaveRestRule();
  const remove = useDeleteRestRule();
  const monthStart = `${data.today.slice(0, 7)}-01`;
  const current = schedule.rule?.restWeekdays ?? (schedule.legacy ? (schedule.scope === "ofis" ? [6, 7] : [7]) : []);
  const [days, setDays] = useState<number[]>(current);
  const [from, setFrom] = useState(data.today);
  const [note, setNote] = useState("");
  const currentKey = current.join(",");
  useEffect(() => {
    setDays(current);
    setFrom(data.today);
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.scope, currentKey, data.today]);

  const dirty = days.slice().sort().join(",") !== current.slice().sort().join(",") || from !== data.today;
  const locked = schedule.scope === "xavfsizlik" || !data.canEdit;
  const workPerWeek = 7 - days.length;

  const toggle = (d: number) => {
    if (locked) return;
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const submit = () => {
    if (days.length > 6) {
      toast({ title: "Haftada kamida bitta ish kuni bo‘lishi kerak", variant: "destructive" });
      return;
    }
    save.mutate(
      { scope: schedule.scope, restWeekdays: days, effectiveFrom: from, note: note.trim() || undefined, month },
      {
        onSuccess: () => toast({ title: "Ish jadvali saqlandi", description: `${schedule.label} · ${dmy(from)} dan` }),
        onError: (e) => toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[#0f2744] dark:text-white">Haftalik dam kunlari</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{scopeHint(schedule.scope)}</p>
        </div>
        <span className="rounded-full bg-[#0b3a5c]/[0.07] px-2.5 py-1 text-[11px] font-bold text-[#0b3a5c] dark:bg-white/10 dark:text-sky-200">
          Haftada {workPerWeek} kun ish · {days.length} kun dam
        </span>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {WEEKDAYS_UZ.map((w) => {
          const rest = days.includes(w.day);
          return (
            <button
              key={w.day}
              type="button"
              disabled={locked}
              onClick={() => toggle(w.day)}
              title={w.label}
              className={cn(
                "flex h-14 flex-col items-center justify-center rounded-xl border-2 text-sm font-bold transition disabled:cursor-default",
                rest
                  ? "border-dashed border-slate-300 bg-slate-100 text-slate-500 dark:border-white/20 dark:bg-slate-800 dark:text-slate-300"
                  : "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
                !locked && "hover:shadow-sm",
              )}
            >
              {w.short}
              <span className="text-[9px] font-bold uppercase">{rest ? "dam" : "ish"}</span>
            </button>
          );
        })}
      </div>

      {!locked ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Qaysi sanadan</span>
            <Input type="date" value={from} min={monthStart} onChange={(e) => setFrom(e.target.value || data.today)} className="h-9" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Izoh (ixtiyoriy)</span>
            <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: yozgi jadval" className="h-9" />
          </label>
          <Button type="button" className="h-9 gap-1.5 bg-[#0b3a5c] hover:bg-[#0b3a5c]/90" disabled={!dirty || save.isPending} onClick={submit}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Saqlash
          </Button>
        </div>
      ) : null}

      <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-[12px] dark:border-white/10">
        <p className="flex flex-wrap items-center gap-1.5 text-slate-600 dark:text-slate-300">
          <Clock3 className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-semibold">Hozir:</span> {restSummary(schedule.rule, schedule.legacy, schedule.scope)}
          {schedule.rule ? <span className="text-muted-foreground">· {dmy(schedule.rule.effectiveFrom)} dan{schedule.rule.updatedByName ? ` · ${schedule.rule.updatedByName}` : ""}</span> : null}
        </p>
        {schedule.upcoming.map((r) => (
          <p key={r.id} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="font-semibold">{dmy(r.effectiveFrom)} dan:</span> {restSummary(r, false, schedule.scope)}
            {r.note ? <span className="opacity-75">· {r.note}</span> : null}
            {data.canEdit ? (
              <button
                type="button"
                className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:underline"
                disabled={remove.isPending}
                onClick={() => {
                  if (!window.confirm(`${dmy(r.effectiveFrom)} dan boshlanadigan jadval o‘chirilsinmi?`)) return;
                  remove.mutate(r.id, {
                    onSuccess: () => toast({ title: "Kelgusi jadval o‘chirildi" }),
                    onError: (e) => toast({ title: "O‘chirilmadi", description: (e as Error).message, variant: "destructive" }),
                  });
                }}
              >
                <Trash2 className="h-3 w-3" /> O‘chirish
              </button>
            ) : null}
          </p>
        ))}
      </div>
    </div>
  );
}

function ScopeDetail({ data, schedule, month }: { data: WorkCalendarData; schedule: ScopeSchedule; month: string }) {
  const { toast } = useToast();
  const toggleDay = useToggleWorkDay();
  const qc = useQueryClient();
  return (
    <div className="space-y-3">
      <HoursEditor data={data} schedule={schedule} />
      <RuleEditor data={data} schedule={schedule} month={month} />
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[#0f2744] dark:text-white"><span className="capitalize">{monthLabelUz(month)}</span> kalendari</p>
          <span className="flex gap-1.5 text-[11px] font-bold">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">{schedule.month.workDays.length} ish kuni</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-white/10 dark:text-slate-300">{schedule.month.restDays.length} dam kuni</span>
          </span>
        </div>
        <MonthGrid
          month={month}
          schedule={schedule}
          canEdit={data.canEdit}
          pending={toggleDay.isPending}
          onToggle={(day, isWork) =>
            toggleDay.mutate(
              { day, isWork, scope: schedule.scope },
              {
                onSuccess: () => {
                  void qc.invalidateQueries({ queryKey: ["work-calendar"] });
                  toast({ title: `${formatDayUz(day)} — ${isWork ? "ish kuni" : "dam kuni"}`, description: schedule.label });
                },
                onError: (e) => toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" }),
              },
            )
          }
        />
      </div>
      <StaffHoursPanel data={data} schedule={schedule} />
    </div>
  );
}

function StaffPicker({
  label,
  staff,
  value,
  onChange,
  exclude,
}: {
  label: string;
  staff: SwapStaff[];
  value: number | null;
  onChange: (id: number | null) => void;
  exclude?: number | null;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const picked = staff.find((s) => s.id === value) || null;
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return staff
      .filter((s) => s.id !== exclude)
      .filter((s) => !needle || `${s.fullName} ${s.branch} ${s.shift} ${s.position}`.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [staff, q, exclude]);
  return (
    <div className="relative">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {picked ? (
        <div className="flex h-11 items-center gap-2 rounded-lg border border-[#0b3a5c]/40 bg-[#0b3a5c]/[0.04] px-3 dark:bg-white/5">
          <UserRound className="h-4 w-4 shrink-0 text-[#0b3a5c] dark:text-sky-200" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[#0f2744] dark:text-white">{picked.fullName}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{[picked.shift, picked.branch].filter(Boolean).join(" · ")}</span>
          </span>
          <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => onChange(null)} aria-label="Tozalash">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder="Ism, filial yoki smena…"
              className="h-11 pl-9"
            />
          </div>
          {open ? (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-white/10 dark:bg-slate-900">
              {hits.length ? hits.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(s.id); setQ(""); setOpen(false); }}
                  className="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <span className="block text-sm font-semibold text-[#0f2744] dark:text-white">{s.fullName}</span>
                  <span className="block text-[11px] text-muted-foreground">{[s.shift, s.position, s.branch].filter(Boolean).join(" · ")}</span>
                </button>
              )) : <p className="px-3 py-3 text-xs text-muted-foreground">Topilmadi</p>}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

const PAY_OPTIONS: Array<{ key: SwapPayTo | ""; title: string; hint: string }> = [
  { key: "replacement", title: "O‘rniga chiqqanga", hint: "Shu kungi kun haqi ishlagan xodimga o‘tadi" },
  { key: "self", title: "O‘ziga", hint: "Dam olgan xodimning kun haqi saqlanadi" },
  { key: "", title: "Keyin hal qilinadi", hint: "Admin, moliyachi yoki HR keyin tanlaydi" },
];

function payBadge(swap: ShiftSwap) {
  if (swap.payTo === "replacement") return { text: "Kun haqi o‘rniga chiqqanga", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" };
  if (swap.payTo === "self") return { text: "Kun haqi o‘ziga", cls: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200" };
  return { text: "Qaror kutilmoqda", cls: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200" };
}

function SwapsTab({ data, month }: { data: WorkCalendarData; month: string }) {
  const { toast } = useToast();
  const staffQ = useSwapStaff(data.canSwap);
  const create = useCreateSwap();
  const decide = useDecideSwap();
  const cancel = useCancelSwap();
  const staff = staffQ.data?.items ?? [];
  const [date, setDate] = useState(() => (data.today.startsWith(month) ? data.today : `${month}-01`));
  const [restId, setRestId] = useState<number | null>(null);
  const [replId, setReplId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [payTo, setPayTo] = useState<SwapPayTo | "">("");
  const resting = staff.find((s) => s.id === restId);

  const submit = () => {
    if (!restId || !replId) {
      toast({ title: "Ikkala xodimni tanlang", variant: "destructive" });
      return;
    }
    create.mutate(
      { workDate: date, employeeId: restId, replacementEmployeeId: replId, reason: reason.trim() || undefined, payTo: data.canDecide && payTo ? payTo : null },
      {
        onSuccess: () => {
          toast({ title: "Almashuv saqlandi", description: `${formatDayUz(date)} · ikkala xodimga xabar yuborildi` });
          setRestId(null);
          setReplId(null);
          setReason("");
          setPayTo("");
        },
        onError: (e) => toast({ title: "Almashuv saqlanmadi", description: (e as Error).message, variant: "destructive" }),
      },
    );
  };

  const swaps = [...data.swaps].sort((a, b) => a.workDate.localeCompare(b.workDate) || a.id - b.id);
  const pending = swaps.filter((s) => !s.payTo).length;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(300px,400px)_1fr]">
      {data.canSwap ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-[#0f2744] dark:text-white"><Plus className="h-4 w-4" /> Yangi almashuv</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Xodim shu kuni dam oladi, o‘rniga boshqasi chiqadi. Dam oluvchiga davomatda «Dam kuni» chiqadi va jarima yozilmaydi; o‘rniga chiquvchi shu filialda smena ochadi.
            </p>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sana</span>
            <Input type="date" value={date} min={`${data.today.slice(0, 7)}-01`} onChange={(e) => setDate(e.target.value || date)} className="h-10" />
          </label>
          {staffQ.isLoading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Xodimlar yuklanmoqda…</p>
          ) : (
            <>
              <StaffPicker label="Dam oladigan xodim" staff={staff} value={restId} onChange={setRestId} exclude={replId} />
              <div className="flex justify-center text-slate-400"><ArrowRightLeft className="h-4 w-4 rotate-90" /></div>
              <StaffPicker label="O‘rniga chiqadigan xodim" staff={staff} value={replId} onChange={setReplId} exclude={restId} />
              {resting ? <p className="text-[11px] text-muted-foreground">O‘rniga chiquvchi «{resting.shift}» vaqtida{resting.branch ? ` ${resting.branch} filialida` : ""} ishlaydi.</p> : null}
            </>
          )}
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sabab (ixtiyoriy)</span>
            <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: oilaviy sabab" className="h-10" />
          </label>
          {data.canDecide ? (
            <div>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Shu kunning oyligi kimga yoziladi</span>
              <div className="grid gap-1.5">
                {PAY_OPTIONS.map((opt) => (
                  <button
                    key={opt.key || "later"}
                    type="button"
                    onClick={() => setPayTo(opt.key)}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition",
                      payTo === opt.key ? "border-[#0b3a5c] bg-[#0b3a5c]/[0.05] ring-1 ring-[#0b3a5c] dark:bg-white/5" : "border-slate-200 hover:border-slate-300 dark:border-white/10",
                    )}
                  >
                    <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", payTo === opt.key ? "border-[#0b3a5c] bg-[#0b3a5c]" : "border-slate-300")}>
                      {payTo === opt.key ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-[#0f2744] dark:text-white">{opt.title}</span>
                      <span className="block text-[11px] text-muted-foreground">{opt.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-muted-foreground dark:bg-white/5">Kun haqi kimga yozilishini admin, moliyachi yoki HR hal qiladi.</p>
          )}
          <Button type="button" className="h-10 w-full gap-1.5 bg-[#0b3a5c] hover:bg-[#0b3a5c]/90" disabled={create.isPending || !restId || !replId} onClick={submit}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            Almashuvni saqlash
          </Button>
        </div>
      ) : null}

      <div className={cn("min-w-0", !data.canSwap && "md:col-span-2")}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[#0f2744] dark:text-white"><span className="capitalize">{monthLabelUz(month)}</span> almashuvlari</p>
          {pending ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">{pending} ta qaror kutilmoqda</span> : null}
        </div>
        {!swaps.length ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-12 text-center dark:border-white/15">
            <ArrowRightLeft className="h-8 w-8 text-slate-300" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Bu oyda almashuv yo‘q</p>
            <p className="max-w-sm text-xs text-muted-foreground">2-smena xodimi dam olishi uchun shu yerda o‘rniga chiqadigan xodimni belgilang.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {swaps.map((swap) => {
              const badge = payBadge(swap);
              return (
                <div key={swap.id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{formatDayUz(swap.workDate)}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-[#0f2744] dark:text-white">
                        <span className="font-semibold">{swap.employeeName}</span>
                        <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold uppercase text-slate-500 dark:bg-white/10">dam</span>
                        <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" />
                        <span className="font-semibold">{swap.replacementName}</span>
                        <span className="rounded bg-emerald-50 px-1.5 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">chiqadi</span>
                      </p>
                      {swap.reason ? <p className="mt-0.5 text-[12px] text-muted-foreground">Sabab: {swap.reason}</p> : null}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {swap.createdByName ? `Qo‘shdi: ${swap.createdByName}` : ""}
                        {swap.decidedByName ? ` · Qaror: ${swap.decidedByName}` : ""}
                      </p>
                    </div>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", badge.cls)}>{badge.text}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {data.canDecide ? (
                      <>
                        {(["replacement", "self"] as const).map((key) => (
                          <button
                            key={key}
                            type="button"
                            disabled={decide.isPending || swap.payTo === key}
                            onClick={() =>
                              decide.mutate(
                                { id: swap.id, payTo: key },
                                {
                                  onSuccess: () => toast({ title: "Qaror saqlandi", description: key === "replacement" ? `Kun haqi ${swap.replacementName}ga` : `Kun haqi ${swap.employeeName}ga` }),
                                  onError: (e) => toast({ title: "Saqlanmadi", description: (e as Error).message, variant: "destructive" }),
                                },
                              )
                            }
                            className={cn(
                              "h-8 rounded-lg border px-2.5 text-xs font-semibold transition disabled:cursor-default",
                              swap.payTo === key ? "border-[#0b3a5c] bg-[#0b3a5c] text-white" : "border-slate-200 text-slate-700 hover:border-[#0b3a5c]/50 dark:border-white/10 dark:text-slate-200",
                            )}
                          >
                            {key === "replacement" ? "Kun haqi o‘rniga chiqqanga" : "Kun haqi o‘ziga"}
                          </button>
                        ))}
                      </>
                    ) : null}
                    {data.canSwap ? (
                      <button
                        type="button"
                        disabled={cancel.isPending}
                        onClick={() => {
                          if (!window.confirm(`${formatDayUz(swap.workDate)} almashuvi bekor qilinsinmi?\n${swap.employeeName} yana ish kuniga qaytadi.`)) return;
                          cancel.mutate(swap.id, {
                            onSuccess: () => toast({ title: "Almashuv bekor qilindi" }),
                            onError: (e) => toast({ title: "Bekor qilinmadi", description: (e as Error).message, variant: "destructive" }),
                          });
                        }}
                        className="ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Bekor qilish
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function ShiftScheduleDialog({
  open,
  onOpenChange,
  month,
  initialScope,
  initialTab = "smena",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  initialScope?: string;
  initialTab?: "smena" | "almashuv";
}) {
  const q = useWorkCalendar(month, open);
  const [tab, setTab] = useState<"smena" | "almashuv">(initialTab);
  const [scope, setScope] = useState(initialScope || "dorixona:1");
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    if (initialScope) setScope(initialScope);
  }, [open, initialScope, initialTab]);

  const data = q.data;
  const scopes = data?.scopes ?? [];
  const active = scopes.find((s) => s.scope === scope) ?? scopes[0];
  const pendingSwaps = (data?.swaps ?? []).filter((s) => !s.payTo).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="flex h-[min(920px,calc(100vh-1.5rem))] w-[min(1240px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <div className="shrink-0 bg-[#0b3a5c] px-6 py-4 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-xl font-semibold tracking-tight text-white">Smenalar ish jadvali</DialogTitle>
              <p className="mt-1 text-sm text-white/80"><span className="capitalize">{monthLabelUz(month)}</span> · har smenaning ish vaqti, ish va dam kunlari alohida</p>
            </div>
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Yopish">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-3 flex gap-1.5">
            {([
              { key: "smena", label: "Smenalar", icon: CalendarDays },
              { key: "almashuv", label: "Almashuvlar", icon: ArrowRightLeft },
            ] as const).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition",
                  tab === t.key ? "bg-white text-[#0b3a5c]" : "bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20",
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
                {t.key === "almashuv" && pendingSwaps ? (
                  <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{pendingSwaps}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 dark:bg-slate-900 sm:p-5">
          {q.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…</p>
          ) : q.error ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{(q.error as Error).message}</p>
          ) : !data ? null : tab === "almashuv" ? (
            <SwapsTab data={data} month={month} />
          ) : (
            <div className="grid gap-4 md:grid-cols-[250px_1fr] lg:grid-cols-[290px_1fr]">
              <div className="space-y-1.5">
                {scopes.map((s) => {
                  const on = active?.scope === s.scope;
                  return (
                    <button
                      key={s.scope}
                      type="button"
                      onClick={() => setScope(s.scope)}
                      className={cn(
                        "block w-full rounded-xl border px-3 py-2.5 text-left transition",
                        on ? "border-[#0b3a5c] bg-white shadow-sm ring-1 ring-[#0b3a5c] dark:bg-slate-950" : "border-slate-200 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-slate-950",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#0f2744] dark:text-white">{s.label}</span>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground"><Users className="h-3 w-3" />{s.staffCount}</span>
                      </span>
                      {s.hours ? (
                        <span className={cn("mt-1 inline-flex items-center gap-1 text-[12px] font-bold tabular-nums", s.scope === "dorixona:orta" ? "text-violet-700 dark:text-violet-300" : "text-[#0b3a5c] dark:text-sky-200")}>
                          <Clock3 className="h-3 w-3" />
                          {hoursText(s.hours)}
                        </span>
                      ) : s.scope === "xavfsizlik" ? (
                        <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-bold tabular-nums text-[#0b3a5c] dark:text-sky-200">
                          <Clock3 className="h-3 w-3" /> 09:00–09:00 (ertasi)
                        </span>
                      ) : null}
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{restSummary(s.rule, s.legacy, s.scope)}</span>
                      <span className="mt-1 flex gap-1 text-[10px] font-bold">
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">{s.month.workDays.length} ish</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-white/10 dark:text-slate-300">{s.month.restDays.length} dam</span>
                        {s.upcoming.length ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">yangi jadval</span> : null}
                      </span>
                    </button>
                  );
                })}
                <GraceCard data={data} />
                <div className="flex gap-2 rounded-xl bg-[#0b3a5c]/[0.05] p-3 text-[11px] leading-relaxed text-slate-600 ring-1 ring-[#0b3a5c]/10 dark:bg-white/5 dark:text-slate-300">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0b3a5c] dark:text-sky-200" />
                  <span>Dam kunida davomatda «Dam kuni» ko‘rinadi, kelmaganlik va kechikish jarimasi yozilmaydi. Xodim o‘zi ishga chiqsa — qo‘shimcha ish, jarimasiz. Oylik ham shu jadval bo‘yicha hisoblanadi.</span>
                </div>
              </div>
              {active ? <ScopeDetail key={active.scope} data={data} schedule={active} month={month} /> : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}