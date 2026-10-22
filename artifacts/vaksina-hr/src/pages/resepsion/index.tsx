import { useEffect, useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  ConciergeBell,
  FileText,
  Loader2,
  LogOut,
  Package,
  Phone,
  Plus,
  Building2,
  CalendarDays,
  ChevronDown,
  PhoneCall,
  Search,
  Send,
  Store,
  Trash2,
  UserRound,
  Users,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import { callEngine, useCall } from "@/lib/calls/engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar as DayPickerCalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  formatVisitDt,
  formatVisitTime,
  fromLocalInputValue,
  initialsOf,
  toLocalInputValue,
  useReceptionHosts,
  useReceptionLogs,
  useReceptionMeta,
  useReceptionMutations,
  type ReceptionHost,
  type ReceptionLog,
  type ReceptionVisitType,
} from "@/lib/resepsion-api";
import { isPharmacyDeviceStaff, userRoleLabel } from "@/lib/roles";

function isPharmacyHost(role?: string | null) {
  return isPharmacyDeviceStaff(role);
}

type TypeAccent = "sky" | "emerald" | "violet" | "amber" | "rose";

type TypeMeta = {
  value: ReceptionVisitType;
  label: string;
  title: string;
  blurb: string;
  icon: typeof UserRound;
  accent: TypeAccent;
  iconBg: string;
  activeTab: string;
  panel: string;
  chipOn: string;
  chipOff: string;
  btn: string;
  live: string;
  nameLabel: string;
  namePh: string;
  extraLabel?: string;
  extraPh?: string;
  hostLabel: string;
  hostHint: string;
  notesPh: string;
  submit: string;
  purposes: string[];
  topics?: { value: string; label: string }[];
};

const TYPE_TABS: TypeMeta[] = [
  {
    value: "guest",
    label: "Mehmon",
    title: "Mehmon qabuli",
    blurb: "Tashqi mehmon — uchrashuv, hujjat, hamkorlik",
    icon: UserRound,
    accent: "sky",
    iconBg: "bg-sky-500",
    activeTab:
      "border-sky-400/60 bg-sky-50 text-sky-900 shadow-sky-500/10 dark:border-sky-400/40 dark:bg-sky-500/15 dark:text-sky-100",
    panel:
      "border-sky-200/70 bg-gradient-to-br from-sky-50/90 via-card to-card dark:border-sky-500/25 dark:from-sky-950/50 dark:via-card dark:to-card",
    chipOn: "border-sky-500 bg-sky-600 text-white",
    chipOff:
      "border-sky-200 bg-sky-50/80 text-sky-900 hover:border-sky-300 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100",
    btn: "bg-sky-600 hover:bg-sky-700 shadow-sky-600/25",
    live: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
    nameLabel: "Mehmon ismi",
    namePh: "Aliyev Rustam",
    extraLabel: "Tashkilot / kompaniya",
    extraPh: "Masalan: Hamkor MChJ",
    hostLabel: "Kimning oldiga keldi?",
    hostHint: "Sukutda faqat ofis xodimlari",
    notesPh: "Uchrashuv mavzusi, necha kishi, maxsus eslatma…",
    submit: "Mehmonni qayd etish va xabar",
    purposes: [
      "Uchrashuv",
      "Hujjat topshirish",
      "Shartnoma / imzo",
      "Konsultatsiya",
      "Yetkazib berish",
      "Shikoyat",
    ],
  },
  {
    value: "candidate",
    label: "Nomzod",
    title: "Nomzod / suhbat",
    blurb: "Ish suhbatiga kelgan nomzodni qayd etish",
    icon: UserPlus,
    accent: "violet",
    iconBg: "bg-violet-500",
    activeTab:
      "border-violet-400/60 bg-violet-50 text-violet-950 shadow-violet-500/10 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-100",
    panel:
      "border-violet-200/70 bg-gradient-to-br from-violet-50/90 via-card to-card dark:border-violet-500/25 dark:from-violet-950/50 dark:via-card dark:to-card",
    chipOn: "border-violet-600 bg-violet-600 text-white",
    chipOff:
      "border-violet-200 bg-violet-50/80 text-violet-950 hover:border-violet-300 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100",
    btn: "bg-violet-600 hover:bg-violet-700 shadow-violet-600/25",
    live: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
    nameLabel: "Nomzod ismi",
    namePh: "Ism Familiya",
    extraLabel: "Lavozim (ariza)",
    extraPh: "Masalan: Farmasevt, AyTi…",
    hostLabel: "Suhbat oluvchi",
    hostHint: "HR yoki bo‘lim rahbari",
    notesPh: "Tajriba, manba (Telegram/olx), maxsus eslatma…",
    submit: "Nomzodni qayd etish va xabar",
    purposes: ["Ish suhbat", "HR uchrashuv", "Hujjat topshirish", "Sinov / staj", "Takroriy suhbat"],
  },
  {
    value: "staff",
    label: "Xodim",
    title: "Xodim tashrifi",
    blurb: "Boshqa filial / bo‘lim xodimi ofisga kelganda",
    icon: Users,
    accent: "emerald",
    iconBg: "bg-emerald-500",
    activeTab:
      "border-emerald-400/60 bg-emerald-50 text-emerald-950 shadow-emerald-500/10 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-100",
    panel:
      "border-emerald-200/70 bg-gradient-to-br from-emerald-50/90 via-card to-card dark:border-emerald-500/25 dark:from-emerald-950/45 dark:via-card dark:to-card",
    chipOn: "border-emerald-600 bg-emerald-600 text-white",
    chipOff:
      "border-emerald-200 bg-emerald-50/80 text-emerald-950 hover:border-emerald-300 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100",
    btn: "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/25",
    live: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
    nameLabel: "Xodim ismi",
    namePh: "Ism Familiya",
    extraLabel: "Qaysi filial / bo‘limdan",
    extraPh: "Masalan: 12-filial yoki AyTi",
    hostLabel: "Kim bilan uchrashadi?",
    hostHint: "Ofisdagi mas’ul xodim",
    notesPh: "Vazifa, topshiriq yoki qisqa eslatma…",
    submit: "Xodim tashrifini qayd etish",
    purposes: ["Ish / vazifa", "Hujjat", "Suhbat", "Texnik yordam", "Topshiriq", "Yig‘ilish"],
  },
  {
    value: "request",
    label: "Murojaat",
    title: "Murojaat / shikoyat",
    blurb: "Fuqaro murojaati, shikoyat yoki ariza",
    icon: FileText,
    accent: "amber",
    iconBg: "bg-amber-500",
    activeTab:
      "border-amber-400/60 bg-amber-50 text-amber-950 shadow-amber-500/10 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-100",
    panel:
      "border-amber-200/70 bg-gradient-to-br from-amber-50/90 via-card to-card dark:border-amber-500/25 dark:from-amber-950/40 dark:via-card dark:to-card",
    chipOn: "border-amber-600 bg-amber-600 text-white",
    chipOff:
      "border-amber-200 bg-amber-50/80 text-amber-950 hover:border-amber-300 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
    btn: "bg-amber-600 hover:bg-amber-700 shadow-amber-600/25",
    live: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
    nameLabel: "Murojaatchi ismi",
    namePh: "Ism Familiya",
    extraLabel: "Qisqa mavzu",
    extraPh: "Masalan: maosh, grafik…",
    hostLabel: "Kimga yo‘naltiriladi?",
    hostHint: "Mas’ul xodim / rahbar",
    notesPh: "Murojaat matni — batafsil yozing…",
    submit: "Murojaatni qayd etish",
    purposes: ["Murojaat", "Shikoyat", "Taklif", "Ma’lumot so‘rash", "Ariza"],
    topics: [
      { value: "complaint", label: "Shikoyat" },
      { value: "document", label: "Hujjat" },
      { value: "call", label: "Qo‘ng‘iroq" },
      { value: "other", label: "Boshqa" },
    ],
  },
  {
    value: "package",
    label: "Posilka",
    title: "Posilka / kuryer",
    blurb: "Yetkazib berish, hujjat yoki yuk qabuli",
    icon: Package,
    accent: "rose",
    iconBg: "bg-rose-500",
    activeTab:
      "border-rose-400/60 bg-rose-50 text-rose-950 shadow-rose-500/10 dark:border-rose-400/40 dark:bg-rose-500/15 dark:text-rose-100",
    panel:
      "border-rose-200/70 bg-gradient-to-br from-rose-50/90 via-card to-card dark:border-rose-500/25 dark:from-rose-950/45 dark:via-card dark:to-card",
    chipOn: "border-rose-600 bg-rose-600 text-white",
    chipOff:
      "border-rose-200 bg-rose-50/80 text-rose-950 hover:border-rose-300 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100",
    btn: "bg-rose-600 hover:bg-rose-700 shadow-rose-600/25",
    live: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
    nameLabel: "Kuryer / yetkazuvchi",
    namePh: "Ism yoki kompaniya",
    extraLabel: "Trek / buyurtma №",
    extraPh: "Masalan: YC123456",
    hostLabel: "Kimga kelgan?",
    hostHint: "Qabul qiluvchi xodim",
    notesPh: "Nima kelgani, nechta paket, eslatma…",
    submit: "Posilkani qayd etish va xabar",
    purposes: ["Posilka", "Kuryer", "Hujjat", "Qaytarish", "Ombor"],
    topics: [
      { value: "package", label: "Posilka" },
      { value: "delivery", label: "Yetkazib berish" },
      { value: "document", label: "Hujjat" },
      { value: "other", label: "Boshqa" },
    ],
  },
];

const TYPE_BADGE: Record<string, string> = {
  guest: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
  staff: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  candidate: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
  request: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
  package: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
  interview: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
  office_visit: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
  other: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
};

const STATUS_BADGE: Record<string, string> = {
  waiting: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
  in_progress: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  done: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200",
  cancelled: "bg-muted text-muted-foreground",
  no_show: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
};

function statusLabel(s: string) {
  if (s === "waiting") return "Kutilmoqda";
  if (s === "in_progress") return "Ofisda";
  if (s === "done") return "Chiqdi";
  if (s === "cancelled") return "Bekor";
  if (s === "no_show") return "Kelmadi";
  return s;
}

function normalizeVisitTypeClient(t: string) {
  if (t === "interview") return "candidate";
  if (t === "office_visit") return "guest";
  if (t === "other") return "request";
  return t;
}

function typeLabel(t: string) {
  const n = normalizeVisitTypeClient(t);
  return TYPE_TABS.find((x) => x.value === n)?.label || t;
}

/** Sukutda +998 — foydalanuvchi qolgan raqamlarni yozadi */
function formatVisitorPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (!digits.startsWith("998")) {
    digits = `998${digits}`;
  }
  digits = digits.slice(0, 12); // 998 + 9 ta raqam
  const rest = digits.slice(3);
  const a = rest.slice(0, 2);
  const b = rest.slice(2, 5);
  const c = rest.slice(5, 7);
  const d = rest.slice(7, 9);
  let out = "+998";
  if (a) out += ` ${a}`;
  if (b) out += ` ${b}`;
  if (c) out += ` ${c}`;
  if (d) out += ` ${d}`;
  return out;
}

const PHONE_DEFAULT = "+998";

function phoneForSubmit(formatted: string): string | null {
  const digits = formatted.replace(/\D/g, "");
  if (digits.length <= 3) return null; // faqat +998
  if (digits.length < 12) return `+${digits}`;
  return `+${digits.slice(0, 12)}`;
}

const PURPOSE_BY_TYPE: Record<string, string[]> = Object.fromEntries(
  TYPE_TABS.map((t) => [t.value, t.purposes]),
);

function typeMetaOf(v: ReceptionVisitType): TypeMeta {
  return TYPE_TABS.find((t) => t.value === v) || TYPE_TABS[0]!;
}

function AvatarBubble({
  name,
  tone = "primary",
  size = "md",
  photoUrl,
  onOpen,
}: {
  name: string;
  tone?: "primary" | "soft" | "violet" | "emerald";
  size?: "sm" | "md" | "lg" | "xl";
  photoUrl?: string | null;
  onOpen?: () => void;
}) {
  const sz =
    size === "xl"
      ? "h-24 w-24 text-2xl"
      : size === "lg"
        ? "h-14 w-14 text-base"
        : size === "sm"
          ? "h-8 w-8 text-[10px]"
          : "h-10 w-10 text-xs";
  const bg =
    tone === "violet"
      ? "bg-violet-500/15 text-violet-700"
      : tone === "emerald"
        ? "bg-emerald-500/15 text-emerald-700"
        : tone === "soft"
          ? "bg-slate-100 text-slate-600"
          : "bg-primary/15 text-primary";
  if (photoUrl) {
    const img = (
      <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
    );
    const shell = cn(
      "inline-flex shrink-0 overflow-hidden rounded-full ring-2 ring-primary/15 ring-offset-2 ring-offset-card",
      sz,
    );
    if (onOpen) {
      return (
        <button
          type="button"
          onClick={onOpen}
          title="Rasmni kattalashtirish"
          className={cn(
            shell,
            "cursor-zoom-in transition hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-primary/50",
          )}
        >
          {img}
        </button>
      );
    }
    return <span className={shell}>{img}</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        sz,
        bg,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

function presenceBadgeClass(status?: string) {
  if (status === "in_office") return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
  if (status === "left") return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  if (status === "leave") return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
  return "bg-rose-100 text-rose-800 ring-1 ring-rose-200";
}

const UZ_WEEKDAY: Record<string, string> = {
  Mon: "Dushanba",
  Tue: "Seshanba",
  Wed: "Chorshanba",
  Thu: "Payshanba",
  Fri: "Juma",
  Sat: "Shanba",
  Sun: "Yakshanba",
};
const UZ_MONTH = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentabr",
  "Oktabr",
  "Noyabr",
  "Dekabr",
];

function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLocalCard(value: string): { date: string; time: string } | null {
  const d = parseLocalDateTime(value);
  if (!d) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getDate()} ${UZ_MONTH[d.getMonth()] || ""} ${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function VisitDateTimeField({
  label,
  icon: Icon,
  value,
  onChange,
  clearable,
  placeholder = "Sana va vaqt tanlang",
  accentClass = "border-border/70 from-card to-muted/40",
  iconClass = "text-primary",
  disabled,
}: {
  label: string;
  icon: typeof Clock3;
  value: string;
  onChange: (v: string) => void;
  clearable?: boolean;
  placeholder?: string;
  accentClass?: string;
  iconClass?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseLocalDateTime(value);
  const shown = formatLocalCard(value);

  function applyDate(base: Date) {
    onChange(toLocalInputValue(base));
  }

  function setDay(day: Date | undefined) {
    if (!day) return;
    const next = selected ? new Date(selected) : new Date();
    next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    if (!selected) {
      const now = new Date();
      next.setHours(now.getHours(), now.getMinutes(), 0, 0);
    }
    applyDate(next);
  }

  function setHour(h: number) {
    const next = selected ? new Date(selected) : new Date();
    next.setHours(h, next.getMinutes(), 0, 0);
    applyDate(next);
  }

  function setMinute(m: number) {
    const next = selected ? new Date(selected) : new Date();
    next.setMinutes(m, 0, 0);
    applyDate(next);
  }

  function presetMinutes(add: number) {
    const next = new Date();
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + add);
    applyDate(next);
    setOpen(false);
  }

  const hour = selected?.getHours() ?? new Date().getHours();
  const minute = selected?.getMinutes() ?? 0;

  return (
    <Popover open={disabled ? false : open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "group flex w-full flex-col gap-1 rounded-2xl border bg-gradient-to-br px-3.5 py-3 text-left shadow-sm transition",
            "hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
            open && "border-primary/40 ring-2 ring-primary/15",
            disabled && "cursor-not-allowed opacity-70 hover:shadow-sm",
            accentClass,
          )}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Icon className={cn("h-3.5 w-3.5", iconClass)} />
              {label}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition group-hover:text-foreground",
                open && "rotate-180",
              )}
            />
          </span>
          {shown ? (
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground">{shown.date}</span>
              <span className="mt-0.5 block text-lg font-bold tabular-nums tracking-tight text-primary">
                {shown.time}
              </span>
            </span>
          ) : (
            <span className="py-1 text-sm text-muted-foreground">{placeholder}</span>
          )}
          <span className="text-[10px] text-muted-foreground/80">Istalgan joyini bosing — tanlash ochiladi</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-50 w-[min(100vw-1.5rem,320px)] rounded-2xl border border-border/70 p-3 shadow-xl"
      >
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => presetMinutes(0)}
            className="rounded-xl border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-semibold hover:bg-primary/10"
          >
            Hozir
          </button>
          <button
            type="button"
            onClick={() => presetMinutes(15)}
            className="rounded-xl border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-semibold hover:bg-primary/10"
          >
            +15 daq
          </button>
          <button
            type="button"
            onClick={() => presetMinutes(30)}
            className="rounded-xl border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-semibold hover:bg-primary/10"
          >
            +30 daq
          </button>
          <button
            type="button"
            onClick={() => presetMinutes(60)}
            className="rounded-xl border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-semibold hover:bg-primary/10"
          >
            +1 soat
          </button>
          <button
            type="button"
            onClick={() => presetMinutes(120)}
            className="rounded-xl border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-semibold hover:bg-primary/10"
          >
            +2 soat
          </button>
        </div>
        <DayPickerCalendar
          mode="single"
          selected={selected ?? undefined}
          onSelect={setDay}
          initialFocus
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Soat</span>
            <select
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              className="h-10 w-full rounded-xl border border-border/70 bg-background px-2 text-sm font-semibold tabular-nums"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>
                  {String(i).padStart(2, "0")}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Daqiqa</span>
            <select
              value={minute}
              onChange={(e) => setMinute(Number(e.target.value))}
              className="h-10 w-full rounded-xl border border-border/70 bg-background px-2 text-sm font-semibold tabular-nums"
            >
              {Array.from({ length: 60 }, (_, i) => (
                <option key={i} value={i}>
                  {String(i).padStart(2, "0")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          {clearable ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 flex-1 rounded-xl"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Tozalash
            </Button>
          ) : null}
          <Button
            type="button"
            className="h-9 flex-1 rounded-xl"
            onClick={() => setOpen(false)}
          >
            Tayyor
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function liveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value || "";
  const wdEn = get("weekday");
  const monthNum = Math.max(1, Number(get("month")) || 1);
  const day = get("day");
  const year = get("year");
  const hh = get("hour").padStart(2, "0");
  const mm = get("minute").padStart(2, "0");
  const ss = get("second").padStart(2, "0");
  return {
    weekday: UZ_WEEKDAY[wdEn] || wdEn,
    dateLine: `${Number(day)} ${UZ_MONTH[monthNum - 1] || ""} ${year}`,
    time: `${hh}:${mm}`,
    seconds: ss,
  };
}

export default function ResepsionPage() {
  const { toast } = useToast();
  const clock = liveClock();
  const callSnap = useCall();
  const metaQ = useReceptionMeta();
  const hostsQ = useReceptionHosts();
  const mut = useReceptionMutations();
  const callBusy = callSnap.phase !== "idle" && callSnap.phase !== "ended";

  const [dayScope, setDayScope] = useState<"today" | "all">("today");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "in_progress" | "done" | "waiting" | "cancelled"
  >("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [hostSearch, setHostSearch] = useState("");
  const [hostPickerOpen, setHostPickerOpen] = useState(false);
  const [editRow, setEditRow] = useState<ReceptionLog | null>(null);
  const [editDraft, setEditDraft] = useState({
    visitorFullName: "",
    visitorPhone: "",
    purpose: "",
    notes: "",
    visitType: "guest" as ReceptionVisitType,
    status: "in_progress",
    visitAt: "",
    leftAt: "",
    hostName: "",
  });

  const range = useMemo(() => {
    if (dayScope !== "today") return {};
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }, [dayScope]);

  const logsQ = useReceptionLogs({
    q: q.trim() || undefined,
    ...range,
  });

  const canWrite = metaQ.data?.canWrite ?? logsQ.data?.canWrite ?? false;
  const canDelete = metaQ.data?.canDelete ?? logsQ.data?.canDelete ?? false;
  const stats = logsQ.data?.stats;
  const allItems = logsQ.data?.items ?? [];

  const statusCounts = useMemo(() => {
    return {
      all: allItems.length,
      in_progress: allItems.filter((r) => r.status === "in_progress").length,
      done: allItems.filter((r) => r.status === "done").length,
      waiting: allItems.filter((r) => r.status === "waiting").length,
      cancelled: allItems.filter((r) => r.status === "cancelled").length,
    };
  }, [allItems]);

  const items = useMemo(() => {
    return allItems.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && normalizeVisitTypeClient(r.visitType) !== typeFilter) return false;
      return true;
    });
  }, [allItems, statusFilter, typeFilter]);

  const liveInOffice = useMemo(
    () => allItems.filter((r) => r.status === "in_progress").slice(0, 5),
    [allItems],
  );
  const liveWaiting = useMemo(
    () => allItems.filter((r) => r.status === "waiting").slice(0, 5),
    [allItems],
  );
  const typeTodayBreakdown = useMemo(() => {
    return TYPE_TABS.map((t) => ({
      ...t,
      count: allItems.filter((r) => normalizeVisitTypeClient(r.visitType) === t.value).length,
    }));
  }, [allItems]);
  const onlineHostsCount = useMemo(
    () => (hostsQ.data?.items ?? []).filter((h) => h.online).length,
    [hostsQ.data?.items],
  );

  function openEdit(row: ReceptionLog) {
    setEditRow(row);
    setEditDraft({
      visitorFullName: row.visitorFullName || "",
      visitorPhone: row.visitorPhone || PHONE_DEFAULT,
      purpose: row.purpose || "",
      notes: row.notes || "",
      visitType: row.visitType || "guest",
      status: String(row.status || "in_progress"),
      visitAt: toLocalInputValue(row.visitAt),
      leftAt: row.leftAt ? toLocalInputValue(row.leftAt) : "",
      hostName: row.hostName || row.hostUserName || "",
    });
  }

  async function saveEdit() {
    if (!editRow) return;
    if (editDraft.visitorFullName.trim().length < 2) {
      toast({ title: "Ism familiya yozing", variant: "destructive" });
      return;
    }
    try {
      await mut.update.mutateAsync({
        id: editRow.id,
        body: {
          visitorFullName: editDraft.visitorFullName.trim(),
          visitorPhone: phoneForSubmit(editDraft.visitorPhone),
          purpose: editDraft.purpose.trim() || null,
          notes: editDraft.notes.trim() || null,
          visitType: editDraft.visitType,
          status: editDraft.status,
          visitAt: fromLocalInputValue(editDraft.visitAt),
          leftAt: fromLocalInputValue(editDraft.leftAt),
          hostName: editDraft.hostName.trim() || null,
        },
      });
      toast({ title: "Saqlandi" });
      setEditRow(null);
    } catch (e) {
      toast({
        title: "Saqlanmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  async function cancelVisit(row: ReceptionLog) {
    if (!confirm(`«${row.visitorFullName}» uchrashuvini bekor qilasizmi?`)) return;
    try {
      await mut.update.mutateAsync({
        id: row.id,
        body: { status: "cancelled" },
      });
      toast({ title: "Bekor qilindi" });
      setEditRow(null);
    } catch (e) {
      toast({
        title: "Bekor qilinmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  async function rescheduleToNow(row: ReceptionLog) {
    const nowLocal = toLocalInputValue(new Date());
    setEditDraft((d) => ({
      ...d,
      visitAt: nowLocal,
      status: d.status === "cancelled" || d.status === "done" ? "waiting" : d.status,
    }));
    try {
      await mut.update.mutateAsync({
        id: row.id,
        body: {
          visitAt: new Date().toISOString(),
          status: row.status === "cancelled" || row.status === "done" ? "waiting" : row.status,
        },
      });
      toast({ title: "Vaqt yangilandi — hozir" });
      openEdit({
        ...row,
        visitAt: new Date().toISOString(),
        status:
          row.status === "cancelled" || row.status === "done" ? "waiting" : row.status,
      });
    } catch (e) {
      toast({
        title: "Ko‘chirilmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  function shiftVisitDays(days: number) {
    const keep = parseLocalDateTime(editDraft.visitAt) || new Date();
    const next = new Date();
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() + days);
    next.setHours(keep.getHours(), keep.getMinutes(), 0, 0);
    setEditDraft((d) => ({
      ...d,
      visitAt: toLocalInputValue(next),
      status: d.status === "cancelled" || d.status === "done" ? "waiting" : d.status,
    }));
  }

  async function applyReschedule() {
    if (!editRow) return;
    const visitAtIso = fromLocalInputValue(editDraft.visitAt);
    if (!visitAtIso) {
      toast({ title: "Yangi sana tanlang", variant: "destructive" });
      return;
    }
    try {
      const nextStatus =
        editDraft.status === "cancelled" || editDraft.status === "done"
          ? "waiting"
          : editDraft.status;
      await mut.update.mutateAsync({
        id: editRow.id,
        body: {
          visitAt: visitAtIso,
          status: nextStatus,
          leftAt: null,
        },
      });
      const shown = formatLocalCard(editDraft.visitAt);
      toast({
        title: "Uchrashuv ko‘chirildi",
        description: shown ? `${shown.date}, ${shown.time}` : undefined,
      });
      setEditDraft((d) => ({ ...d, status: nextStatus, leftAt: "" }));
      setEditRow({
        ...editRow,
        visitAt: visitAtIso,
        status: nextStatus,
        leftAt: null,
      });
    } catch (e) {
      toast({
        title: "Ko‘chirilmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  const [visitType, setVisitType] = useState<ReceptionVisitType>("guest");
  const [visitorFullName, setVisitorFullName] = useState("");
  const [visitorPhone, setVisitorPhone] = useState(PHONE_DEFAULT);
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [visitorRoleHint, setVisitorRoleHint] = useState("");
  const [topic, setTopic] = useState<string>("");
  const [interviewerName, setInterviewerName] = useState("");
  const typeMeta = typeMetaOf(visitType);
  const purposeOptions = typeMeta.purposes;
  const [visitAt, setVisitAt] = useState(() => toLocalInputValue(new Date()));
  const [leftAt, setLeftAt] = useState("");
  const [hostUserId, setHostUserId] = useState("");
  const [hostName, setHostName] = useState("");
  /** Sukutda ofis yoqilgan, dorixona o‘chiq */
  const [showOfisHosts, setShowOfisHosts] = useState(true);
  const [showPharmacyHosts, setShowPharmacyHosts] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<{ url: string; name: string } | null>(null);

  const selectedHost: ReceptionHost | null = useMemo(() => {
    if (!hostUserId) return null;
    return hostsQ.data?.items.find((h) => String(h.id) === hostUserId) || null;
  }, [hostUserId, hostsQ.data?.items]);

  const hostHistoryQ = useReceptionLogs(
    selectedHost ? { hostUserId: selectedHost.id } : undefined,
    { enabled: Boolean(selectedHost), refetchInterval: 15_000 },
  );

  const hostVisitHistory = useMemo(() => {
    const list = hostHistoryQ.data?.items ?? [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let today = 0;
    for (const r of list) {
      if (new Date(r.visitAt).getTime() >= todayStart.getTime()) today += 1;
    }
    return {
      items: list.slice(0, 12),
      total: list.length,
      today,
    };
  }, [hostHistoryQ.data?.items]);

  const filteredHosts = useMemo(() => {
    const list = hostsQ.data?.items || [];
    const s = hostSearch.trim().toLowerCase();
    return list
      .filter((h) => {
        const pharm = isPharmacyHost(h.role);
        if (pharm && !showPharmacyHosts) return false;
        if (!pharm && !showOfisHosts) return false;
        if (!s) return true;
        return (
          h.fullName.toLowerCase().includes(s) ||
          String(h.role || "").toLowerCase().includes(s) ||
          String(h.phone || "").includes(s) ||
          userRoleLabel(h.role).toLowerCase().includes(s)
        );
      });
  }, [hostsQ.data?.items, hostSearch, showOfisHosts, showPharmacyHosts]);

  const hostCounts = useMemo(() => {
    const list = hostsQ.data?.items || [];
    let ofis = 0;
    let pharmacy = 0;
    for (const h of list) {
      if (isPharmacyHost(h.role)) pharmacy += 1;
      else ofis += 1;
    }
    return { ofis, pharmacy };
  }, [hostsQ.data?.items]);

  const telegramPreview = useMemo(() => {
    const name = visitorFullName.trim() || "Mehmon";
    const phone = phoneForSubmit(visitorPhone) || "—";
    const sabab = purpose.trim() || "—";
    const tur = typeLabel(String(visitType));
    const n = String(visitType);
    const headline =
      n === "staff"
        ? "👥 Sizga xodim keldi!"
        : n === "candidate"
          ? "🎯 Sizga nomzod (suhbat) keldi!"
          : n === "request"
            ? "📋 Sizga murojaatchi keldi!"
            : n === "package"
              ? "📦 Sizga posilka / kuryer keldi!"
              : "👋 Sizga mehmon keldi!";
    const lines = [
      "🏢 Qabulxoona",
      "",
      headline,
      "",
      `👤 Kim: ${name}`,
      `📞 Telefon: ${phone}`,
      `🏷️ Tur: ${tur}`,
      `🎯 Sabab: ${sabab}`,
    ];
    const note = notes.trim();
    if (note) lines.push(`📝 Izoh: ${note.slice(0, 300)}`);
    lines.push("", "🔔 Iltimos, qabulxonaga chiqing yoki bog‘laning.");
    return lines.join("\n");
  }, [visitorFullName, visitorPhone, purpose, visitType, notes]);

  function resetForm() {
    setVisitorFullName("");
    setVisitorPhone(PHONE_DEFAULT);
    setPurpose("");
    setNotes("");
    setVisitorRoleHint("");
    setTopic("");
    setInterviewerName("");
    setVisitAt(toLocalInputValue(new Date()));
    setLeftAt("");
    setHostUserId("");
    setHostName("");
    setHostSearch("");
  }

  function selectVisitType(next: ReceptionVisitType) {
    setVisitType(next);
    const prevPresets = PURPOSE_BY_TYPE[visitType] || [];
    if (!purpose.trim() || prevPresets.includes(purpose)) {
      setPurpose("");
    }
    setVisitorRoleHint("");
    setTopic("");
    setInterviewerName("");
    const nextMeta = typeMetaOf(next);
    if (nextMeta.topics?.length) {
      setTopic(nextMeta.topics[0]!.value);
    }
  }

  function pickHost(h: ReceptionHost) {
    setHostUserId(String(h.id));
    setHostName(h.fullName);
    setHostPickerOpen(false);
    setHostSearch("");
  }

  async function onSubmit() {
    if (visitorFullName.trim().length < 2) {
      toast({ title: "Ism familiya yozing", variant: "destructive" });
      return;
    }
    try {
      await mut.create.mutateAsync({
        visitType,
        topic: topic || null,
        visitorFullName: visitorFullName.trim(),
        visitorPhone: phoneForSubmit(visitorPhone),
        visitorRoleHint: visitorRoleHint.trim() || null,
        purpose: purpose.trim() || null,
        notes: notes.trim() || null,
        interviewerName:
          visitType === "candidate"
            ? interviewerName.trim() || selectedHost?.fullName || null
            : null,
        hostName: hostName.trim() || selectedHost?.fullName || null,
        hostUserId: hostUserId ? Number(hostUserId) : null,
        visitAt: fromLocalInputValue(visitAt),
        leftAt: fromLocalInputValue(leftAt),
        status: "in_progress",
      });
      toast({
        title: "Qayd etildi",
        description: selectedHost
          ? `${selectedHost.fullName} ga xabarnoma yuborildi`
          : "Tashrif jurnalga yozildi",
      });
      resetForm();
    } catch (e) {
      toast({
        title: "Saqlanmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  async function markDone(row: ReceptionLog) {
    try {
      await mut.update.mutateAsync({
        id: row.id,
        body: { status: "done", leftAt: new Date().toISOString() },
      });
      toast({ title: "Chiqdi deb belgilandi" });
      if (editRow?.id === row.id) setEditRow(null);
    } catch (e) {
      toast({
        title: "Yangilanmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  async function onDelete(row: ReceptionLog) {
    if (!confirm(`«${row.visitorFullName}» ni o‘chirasizmi?`)) return;
    try {
      await mut.remove.mutateAsync(row.id);
      toast({ title: "O‘chirildi" });
    } catch (e) {
      toast({
        title: "O‘chirilmadi",
        description: e instanceof Error ? e.message : "Xato",
        variant: "destructive",
      });
    }
  }

  function scrollToForm() {
    document.getElementById("resepsion-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="w-full space-y-5 pb-28">
      {/* Header — aniq sana + raqamli soat (glass pill emas) */}
      <div className="relative overflow-hidden rounded-[1.75rem] border border-border/60 bg-card shadow-xl shadow-primary/5 dark:border-white/10 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(56,189,248,0.18),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top_right,rgba(56,189,248,0.22),transparent_50%)]" />
        <div className="pointer-events-none absolute -bottom-20 left-0 h-40 w-40 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-stretch sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-500/30">
              <ConciergeBell className="h-7 w-7" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-600 dark:text-sky-400">
                Vaksina HR · Desk
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Qabulxoona
              </h1>
              <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Mehmon, nomzod, xodim, murojaat va posilka — bitta joyda qayd, xabar va uchrashuv
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {onlineHostsCount} onlayn xodim
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                  Bugun {stats?.today ?? 0} tashrif
                </span>
              </div>
            </div>
          </div>

          <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-white shadow-lg sm:w-[240px] dark:border-slate-700">
            <div className="flex items-center gap-2 border-b border-white/10 bg-slate-900 px-4 py-2.5">
              <CalendarDays className="h-4 w-4 text-sky-400" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {clock.weekday}
                </p>
                <p className="truncate text-sm font-semibold text-white">{clock.dateLine}</p>
              </div>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Toshkent vaqti
              </p>
              <p className="mt-1 font-mono text-4xl font-bold tabular-nums tracking-tight text-white sm:text-[2.65rem] sm:leading-none">
                {clock.time}
                <span className="text-2xl text-sky-400 sm:text-3xl">:{clock.seconds}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <button
          type="button"
          onClick={scrollToForm}
          className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-sky-600 to-indigo-700 px-4 py-3.5 text-left text-white shadow-lg shadow-sky-600/25 transition hover:brightness-110"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/25">
            <Plus className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-bold">Yangi qayd</span>
            <span className="block text-[11px] opacity-85">Tezkor ro‘yxatga olish</span>
          </span>
        </button>
        {(
          [
            {
              label: "Kelayotganlar",
              value: stats?.waiting ?? 0,
              hint: "Kutilmoqda",
              ring: "border-amber-200/80 from-amber-50 to-card dark:border-amber-500/25 dark:from-amber-500/10",
              num: "text-amber-700 dark:text-amber-300",
              onClick: () => {
                setDayScope("today");
                setStatusFilter("waiting");
              },
            },
            {
              label: "Ofisda hozir",
              value: stats?.inProgress ?? 0,
              hint: "Hozir",
              ring: "border-emerald-200/80 from-emerald-50 to-card dark:border-emerald-500/25 dark:from-emerald-500/10",
              num: "text-emerald-700 dark:text-emerald-300",
              onClick: () => {
                setDayScope("today");
                setStatusFilter("in_progress");
              },
            },
            {
              label: "Chiqqanlar",
              value: stats?.done ?? 0,
              hint: "Bugun",
              ring: "border-slate-200/80 from-slate-50 to-card dark:border-slate-500/30 dark:from-slate-500/10",
              num: "text-slate-700 dark:text-slate-200",
              onClick: () => {
                setDayScope("today");
                setStatusFilter("done");
              },
            },
            {
              label: "Barcha tashriflar",
              value: stats?.today ?? 0,
              hint: "Bugun",
              ring: "border-sky-200/80 from-sky-50 to-card dark:border-sky-500/25 dark:from-sky-500/10",
              num: "text-sky-700 dark:text-sky-300",
              onClick: () => {
                setDayScope("today");
                setStatusFilter("all");
              },
            },
          ] as const
        ).map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={s.onClick}
            className={cn(
              "rounded-2xl border bg-gradient-to-br px-4 py-3.5 text-left shadow-sm transition hover:brightness-[1.03]",
              s.ring,
            )}
          >
            <p className="text-[11px] font-semibold text-muted-foreground">{s.label}</p>
            <p className={cn("mt-0.5 text-2xl font-bold tabular-nums", s.num)}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.hint}</p>
          </button>
        ))}
      </div>

      {/* Main workspace */}
      <div className="grid gap-4 xl:grid-cols-12">
        {/* Form — har bir tur o‘z rangi va maydonlari */}
        <section
          id="resepsion-form"
          className={cn(
            "rounded-3xl border p-4 shadow-lg sm:p-5 xl:col-span-5",
            typeMeta.panel,
          )}
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold tracking-tight">{typeMeta.title}</h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{typeMeta.blurb}</p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                typeMeta.live,
              )}
            >
              Live
            </span>
          </div>

          <div className="mb-4 mt-3 grid grid-cols-5 gap-1.5">
            {TYPE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = visitType === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => selectVisitType(tab.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-2xl border px-1 py-2.5 text-center shadow-sm transition",
                    active
                      ? tab.activeTab
                      : "border-border/50 bg-card/80 text-muted-foreground hover:bg-muted/40 dark:border-white/10",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm",
                      tab.iconBg,
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-[10px] font-bold leading-tight">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {typeMeta.nameLabel} *
                </label>
                <Input
                  value={visitorFullName}
                  onChange={(e) => setVisitorFullName(e.target.value)}
                  placeholder={typeMeta.namePh}
                  className="h-11 rounded-2xl border-border/80 bg-white/90 shadow-sm"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Telefon
                </label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={visitorPhone}
                    onChange={(e) => setVisitorPhone(formatVisitorPhone(e.target.value))}
                    onFocus={(e) => {
                      if (!e.target.value.trim()) setVisitorPhone(PHONE_DEFAULT);
                    }}
                    onBlur={() => {
                      if (visitorPhone.replace(/\D/g, "").length <= 3) {
                        setVisitorPhone(PHONE_DEFAULT);
                      }
                    }}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+998 90 111 22 33"
                    className="h-11 rounded-2xl border-border/80 bg-white/90 pl-9 font-medium tabular-nums tracking-wide shadow-sm"
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Prefiks +998 — qolgan raqamlarni yozing
                </p>
              </div>
            </div>

            {typeMeta.extraLabel ? (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {typeMeta.extraLabel}
                </label>
                <Input
                  value={visitorRoleHint}
                  onChange={(e) => setVisitorRoleHint(e.target.value)}
                  placeholder={typeMeta.extraPh}
                  className="h-11 rounded-2xl border-border/80 bg-white/90 shadow-sm"
                />
              </div>
            ) : null}

            {typeMeta.topics?.length ? (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Kategoriya
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {typeMeta.topics.map((t) => {
                    const on = topic === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setTopic(t.value)}
                        className={cn(
                          "rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition",
                          on ? typeMeta.chipOn : typeMeta.chipOff,
                        )}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sabab / maqsad
              </label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {purposeOptions.map((opt) => {
                  const active = purpose === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setPurpose(active ? "" : opt)}
                      className={cn(
                        "rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition",
                        active ? typeMeta.chipOn : typeMeta.chipOff,
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Yoki o‘zingiz yozing: qisqa sabab…"
                className="h-11 rounded-2xl border-border/80 bg-white/90 shadow-sm"
              />
            </div>

            {visitType === "candidate" ? (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Suhbat oluvchi (qo‘lda)
                </label>
                <Input
                  value={interviewerName}
                  onChange={(e) => setInterviewerName(e.target.value)}
                  placeholder="Agar pastdan tanlamasangiz — shu yerga yozing"
                  className="h-11 rounded-2xl border-border/80 bg-white/90 shadow-sm"
                />
              </div>
            ) : null}

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Izoh (batafsil)
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={typeMeta.notesPh}
                className="min-h-[88px] rounded-2xl border-border/80 bg-white/90 shadow-sm"
              />
            </div>

            <div className="relative">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {typeMeta.hostLabel}
              </label>

              {selectedHost ? (
                <div className="mb-2 flex items-center gap-3 rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-card to-card p-2.5 shadow-sm">
                  <AvatarBubble
                    name={selectedHost.fullName}
                    size="md"
                    photoUrl={selectedHost.photoUrl}
                    onOpen={
                      selectedHost.photoUrl
                        ? () =>
                            setPhotoPreview({
                              url: selectedHost.photoUrl!,
                              name: selectedHost.fullName,
                            })
                        : undefined
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {selectedHost.fullName}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {userRoleLabel(selectedHost.role) || selectedHost.role}
                      {isPharmacyHost(selectedHost.role) ? " · Dorixona" : " · Ofis"}
                      {selectedHost.presence?.label
                        ? ` · ${selectedHost.presence.label}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 rounded-xl px-2 text-xs"
                    onClick={() => setHostPickerOpen(true)}
                  >
                    Almashtirish
                  </Button>
                  <button
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted"
                    onClick={() => {
                      setHostUserId("");
                      setHostName("");
                    }}
                    aria-label="Tozalash"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setHostPickerOpen((v) => !v)}
                className={cn(
                  "flex h-12 w-full items-center gap-3 rounded-2xl border bg-background px-3.5 text-left text-sm shadow-sm transition",
                  hostPickerOpen
                    ? "border-primary/40 ring-2 ring-primary/15"
                    : "border-border/80 hover:border-primary/30 hover:bg-muted/30",
                )}
              >
                {!selectedHost ? (
                  <>
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <UserRound className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">Xodimni tanlang</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {typeMeta.hostHint}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                      Ro‘yxatni ochish / qidirish
                    </span>
                  </>
                )}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition",
                    hostPickerOpen && "rotate-180",
                  )}
                />
              </button>

              {hostPickerOpen ? (
                <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl shadow-primary/5 ring-1 ring-black/5">
                  <div className="space-y-2 border-b bg-gradient-to-b from-muted/40 to-card p-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={hostSearch}
                        onChange={(e) => setHostSearch(e.target.value)}
                        placeholder="Ism, lavozim yoki telefon…"
                        className="h-10 rounded-xl border-border/70 bg-background pl-9 text-sm shadow-inner"
                        autoFocus
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <label
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition",
                          showOfisHosts
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-background text-muted-foreground",
                        )}
                      >
                        <Checkbox
                          checked={showOfisHosts}
                          onCheckedChange={(v) => setShowOfisHosts(v === true)}
                        />
                        <Building2 className="h-3.5 w-3.5" />
                        Ofis
                        <span className="rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {hostCounts.ofis}
                        </span>
                      </label>
                      <label
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition",
                          showPharmacyHosts
                            ? "border-violet-400/40 bg-violet-500/10 text-violet-800"
                            : "border-border bg-background text-muted-foreground",
                        )}
                      >
                        <Checkbox
                          checked={showPharmacyHosts}
                          onCheckedChange={(v) => setShowPharmacyHosts(v === true)}
                        />
                        <Store className="h-3.5 w-3.5" />
                        Dorixona
                        <span className="rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {hostCounts.pharmacy}
                        </span>
                      </label>
                    </div>
                    {!showPharmacyHosts ? (
                      <p className="text-[10px] leading-snug text-muted-foreground">
                        Dorixona xodimlari yashirin — kerak bo‘lsa «Dorixona»ni belgilang.
                      </p>
                    ) : null}
                  </div>
                  <div className="max-h-56 overflow-y-auto p-1.5">
                    {filteredHosts.map((h) => {
                      const pharm = isPharmacyHost(h.role);
                      const active = hostUserId === String(h.id);
                      return (
                        <button
                          key={h.id}
                          type="button"
                          onClick={() => pickHost(h)}
                          className={cn(
                            "group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition",
                            active
                              ? "bg-primary/10 ring-1 ring-primary/20"
                              : "hover:bg-muted/70",
                          )}
                        >
                          <span className="relative shrink-0">
                            <AvatarBubble
                              name={h.fullName}
                              size="sm"
                              tone={pharm ? "violet" : "primary"}
                              photoUrl={h.photoUrl}
                            />
                            <span
                              className={cn(
                                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card",
                                h.online ? "bg-emerald-500" : "bg-slate-400 dark:bg-slate-600",
                              )}
                              title={h.online ? "Onlayn" : "Oflayn"}
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-semibold text-foreground">
                                {h.fullName}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                                  pharm
                                    ? "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200"
                                    : "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
                                )}
                              >
                                {pharm ? "Dorixona" : "Ofis"}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {h.online ? "Onlayn" : "Oflayn"}
                              {" · "}
                              {userRoleLabel(h.role) || h.role}
                              {h.phone ? ` · ${h.phone}` : ""}
                            </span>
                          </span>
                          {h.phone ? (
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground group-hover:bg-background">
                              <Phone className="h-3.5 w-3.5" />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    {!filteredHosts.length ? (
                      <div className="px-3 py-8 text-center">
                        <Users className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
                        <p className="text-xs font-medium text-foreground">Xodim topilmadi</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {!showOfisHosts && !showPharmacyHosts
                            ? "Kamida Ofis yoki Dorixona filtrini yoqing"
                            : "Qidiruvni o‘zgartiring yoki Dorixona filtrini yoqing"}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <VisitDateTimeField
                label="Kirish vaqti"
                icon={Clock3}
                value={visitAt}
                onChange={setVisitAt}
                accentClass="border-sky-200/80 from-sky-50/90 to-card dark:border-sky-500/30 dark:from-sky-500/10"
                iconClass="text-sky-600 dark:text-sky-400"
              />
              <VisitDateTimeField
                label="Kutilayotgan chiqish"
                icon={LogOut}
                value={leftAt}
                onChange={setLeftAt}
                clearable
                placeholder="Ixtiyoriy — bosib belgilang"
                accentClass="border-violet-200/80 from-violet-50/80 to-card dark:border-violet-500/30 dark:from-violet-500/10"
                iconClass="text-violet-600 dark:text-violet-400"
              />
            </div>

            <Button
              type="button"
              className={cn(
                "h-12 w-full rounded-2xl text-sm font-bold text-white shadow-lg",
                typeMeta.btn,
              )}
              disabled={!canWrite || mut.create.isPending}
              onClick={() => void onSubmit()}
            >
              {mut.create.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {typeMeta.submit}
            </Button>
          </div>
        </section>

        {/* Host preview */}
        <section className="rounded-3xl border border-border/70 bg-gradient-to-br from-primary/5 via-card to-card p-4 shadow-sm sm:p-5 xl:col-span-4 dark:border-white/10 dark:from-primary/10">
          <h2 className="mb-3 text-base font-semibold">Kimning oldiga</h2>
          {selectedHost ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center sm:flex-row sm:items-start sm:text-left gap-4">
                <AvatarBubble
                  name={selectedHost.fullName}
                  size="xl"
                  photoUrl={selectedHost.photoUrl}
                  onOpen={
                    selectedHost.photoUrl
                      ? () =>
                          setPhotoPreview({
                            url: selectedHost.photoUrl!,
                            name: selectedHost.fullName,
                          })
                      : undefined
                  }
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <p className="text-lg font-semibold leading-tight">{selectedHost.fullName}</p>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        selectedHost.online
                          ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200"
                          : "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          selectedHost.online ? "bg-emerald-500" : "bg-slate-400",
                        )}
                      />
                      {selectedHost.online ? "Onlayn" : "Oflayn"}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        presenceBadgeClass(selectedHost.presence?.status),
                      )}
                    >
                      {selectedHost.presence?.label || "Kelmagan"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {userRoleLabel(selectedHost.role) || selectedHost.role}
                    {isPharmacyHost(selectedHost.role) ? " · Dorixona" : " · Ofis"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Davomat:{" "}
                    {selectedHost.presence?.checkIn
                      ? `keldi ${selectedHost.presence.checkIn}`
                      : "bugun kelmagan"}
                    {selectedHost.presence?.checkOut
                      ? ` · ketdi ${selectedHost.presence.checkOut}`
                      : selectedHost.presence?.status === "in_office"
                        ? " · hali ofisda"
                        : ""}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl border bg-card/80 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Telefon</p>
                  <p className="mt-0.5 text-sm font-medium tabular-nums">
                    {selectedHost.phone || "—"}
                  </p>
                </div>
                <div className="rounded-2xl border bg-card/80 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Tashrif turi
                  </p>
                  <p className="mt-0.5 text-sm font-medium">{typeLabel(String(visitType))}</p>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-[#229ED9]/30 bg-gradient-to-b from-[#E8F6FD] to-card shadow-sm dark:from-[#0B3A4D]/40">
                <div className="flex items-center gap-2 border-b border-[#229ED9]/20 bg-[#229ED9]/10 px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#229ED9] text-white">
                    <Send className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[#0B6B94]">Telegram bot</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {selectedHost.hasTelegram
                        ? "Bog‘langan — qayd etganda yuboriladi"
                        : "Telegram ulanmagan — faqat tizim xabari"}
                    </p>
                  </div>
                </div>
                <div className="space-y-2 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Boradigan xabar ko‘rinishi
                  </p>
                  <div className="rounded-2xl rounded-tl-sm bg-white px-3 py-2.5 text-left shadow-sm ring-1 ring-black/5 dark:bg-slate-900">
                    <p className="text-[11px] font-semibold text-[#229ED9]">Vaksina HR · bot</p>
                    <p className="mt-1.5 whitespace-pre-line text-[12px] leading-[1.65] text-foreground">
                      {telegramPreview}
                    </p>
                  </div>
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    «Qayd etish» bosilganda shu matn xodimga Telegram + tizim bildirishnomasiga
                    ketadi.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Tizim orqali qo‘ng‘iroq
                  </p>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-[11px] font-semibold",
                      selectedHost.online ? "text-emerald-700" : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        selectedHost.online ? "bg-emerald-500" : "bg-slate-400",
                      )}
                    />
                    {selectedHost.online ? "Tizimda onlayn" : "Tizimda yo‘q (oflayn)"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    className="h-11 rounded-2xl bg-emerald-600 font-semibold hover:bg-emerald-700 disabled:opacity-50"
                    disabled={callBusy || !selectedHost.online || callSnap.me?.canCall === false}
                    onClick={() =>
                      void callEngine.call(
                        {
                          id: selectedHost.id,
                          fullName: selectedHost.fullName,
                          role: selectedHost.role,
                        },
                        false,
                      )
                    }
                  >
                    <PhoneCall className="mr-1.5 h-4 w-4" />
                    Ovozli
                  </Button>
                  <Button
                    type="button"
                    className="h-11 rounded-2xl bg-sky-600 font-semibold hover:bg-sky-700 disabled:opacity-50"
                    disabled={callBusy || !selectedHost.online || callSnap.me?.canCall === false}
                    onClick={() =>
                      void callEngine.call(
                        {
                          id: selectedHost.id,
                          fullName: selectedHost.fullName,
                          role: selectedHost.role,
                        },
                        true,
                      )
                    }
                  >
                    <Video className="mr-1.5 h-4 w-4" />
                    Video
                  </Button>
                </div>
                {callBusy ? (
                  <p className="text-center text-[10px] text-amber-700">
                    Joriy qo‘ng‘iroq davom etmoqda…
                  </p>
                ) : null}
              </div>

              {/* Shu xodimga kelganlar tarixi */}
              <div className="overflow-hidden rounded-2xl border border-indigo-200/60 bg-gradient-to-b from-indigo-50/80 via-card to-card shadow-sm">
                <div className="flex items-center justify-between gap-2 border-b border-indigo-100 bg-indigo-500/10 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-indigo-900">Tashriflar tarixi</p>
                    <p className="text-[10px] text-indigo-800/70">
                      Kim kelgani, qachon va qanday mavzu bilan
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <span className="rounded-lg bg-white/80 px-2 py-1 text-center shadow-sm ring-1 ring-indigo-100">
                      <span className="block text-[9px] font-semibold uppercase text-muted-foreground">
                        Bugun
                      </span>
                      <span className="text-sm font-bold tabular-nums text-indigo-700">
                        {hostVisitHistory.today}
                      </span>
                    </span>
                    <span className="rounded-lg bg-white/80 px-2 py-1 text-center shadow-sm ring-1 ring-indigo-100">
                      <span className="block text-[9px] font-semibold uppercase text-muted-foreground">
                        Jami
                      </span>
                      <span className="text-sm font-bold tabular-nums text-indigo-700">
                        {hostVisitHistory.total}
                      </span>
                    </span>
                  </div>
                </div>

                {hostHistoryQ.isLoading ? (
                  <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Tarix yuklanmoqda…
                  </div>
                ) : !hostVisitHistory.items.length ? (
                  <div className="px-3 py-7 text-center">
                    <Users className="mx-auto mb-2 h-7 w-7 text-indigo-300" />
                    <p className="text-xs font-semibold text-foreground">Hali tashrif yo‘q</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Shu xodimga birinchi mehmon qayd etilganda bu yerda ko‘rinadi.
                    </p>
                  </div>
                ) : (
                  <ul className="max-h-64 space-y-0 overflow-y-auto divide-y divide-border/50">
                    {hostVisitHistory.items.map((row) => {
                      const tur = typeLabel(String(row.visitType));
                      const mavzu = row.purpose?.trim() || row.visitorRoleHint?.trim() || "Mavzu ko‘rsatilmagan";
                      const holat = statusLabel(String(row.status));
                      return (
                        <li key={row.id} className="flex gap-2.5 px-3 py-2.5">
                          <AvatarBubble
                            name={row.visitorFullName}
                            size="sm"
                            tone="violet"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {row.visitorFullName}
                              </p>
                              <span
                                className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase",
                                  TYPE_BADGE[row.visitType] || "bg-muted",
                                )}
                              >
                                {tur}
                              </span>
                              <span
                                className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[9px] font-semibold",
                                  STATUS_BADGE[row.status] || "bg-muted",
                                )}
                              >
                                {holat}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-foreground/80">
                              <span className="font-medium text-indigo-700 dark:text-indigo-300">Mavzu:</span>{" "}
                              {mavzu}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
                              <span>{formatVisitDt(row.visitAt)}</span>
                              {row.visitorPhone ? <span>· {row.visitorPhone}</span> : null}
                            </p>
                            {row.notes?.trim() ? (
                              <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                                Izoh: {row.notes.trim()}
                              </p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-4 text-center">
              <BriefcaseBusiness className="mb-2 h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium text-foreground">Xodim tanlanmagan</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Chapdagi formadan «Kimning oldiga» ni tanlang — rasm, davomat, tashriflar tarixi,
                Telegram va qo‘ng‘iroq shu yerda ochiladi.
              </p>
            </div>
          )}
        </section>

        {/* Quick side — bo‘sh joyni to‘ldiruvchi kartalar */}
        <aside className="space-y-3 xl:col-span-3">
          <div className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm dark:border-white/10">
            <p className="mb-2 text-sm font-bold">Tezkor amallar</p>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => {
                  setDayScope("today");
                  setStatusFilter("all");
                }}
                className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left text-sm transition hover:border-border/60 hover:bg-muted/50"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
                  <Clock3 className="h-4 w-4" />
                </span>
                Bugungi jurnal
              </button>
              <button
                type="button"
                onClick={() => {
                  setDayScope("all");
                  setStatusFilter("all");
                }}
                className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left text-sm transition hover:border-border/60 hover:bg-muted/50"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                  <FileText className="h-4 w-4" />
                </span>
                Barcha tashriflar
              </button>
              <button
                type="button"
                onClick={scrollToForm}
                className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left text-sm transition hover:border-border/60 hover:bg-muted/50"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Plus className="h-4 w-4" />
                </span>
                Yangi qayd
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 via-card to-card p-4 shadow-sm dark:border-emerald-500/25 dark:from-emerald-500/10">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">Ofisda hozir</p>
              <span className="rounded-lg bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                {statusCounts.in_progress}
              </span>
            </div>
            {liveInOffice.length ? (
              <ul className="space-y-1.5">
                {liveInOffice.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-emerald-500/10"
                    >
                      <AvatarBubble name={row.visitorFullName} size="sm" tone="emerald" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{row.visitorFullName}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {formatVisitTime(row.visitAt)}
                          {row.hostName || row.hostUserName
                            ? ` · ${row.hostName || row.hostUserName}`
                            : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Hozir ofisda hech kim yo‘q</p>
            )}
          </div>

          <div className="rounded-3xl border border-amber-200/70 bg-gradient-to-br from-amber-50/80 via-card to-card p-4 shadow-sm dark:border-amber-500/25 dark:from-amber-500/10">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-amber-950 dark:text-amber-100">Kutilmoqda</p>
              <span className="rounded-lg bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-amber-800 dark:text-amber-200">
                {statusCounts.waiting}
              </span>
            </div>
            {liveWaiting.length ? (
              <ul className="space-y-1.5">
                {liveWaiting.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-amber-500/10"
                    >
                      <AvatarBubble name={row.visitorFullName} size="sm" tone="soft" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{row.visitorFullName}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {typeLabel(String(row.visitType))} · {formatVisitTime(row.visitAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Navbat bo‘sh</p>
            )}
          </div>

          <div className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm dark:border-white/10">
            <p className="mb-3 text-sm font-bold">Bugungi turlar</p>
            <div className="space-y-2">
              {typeTodayBreakdown.map((t) => {
                const Icon = t.icon;
                const max = Math.max(1, ...typeTodayBreakdown.map((x) => x.count));
                const pct = Math.round((t.count / max) * 100);
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      setDayScope("today");
                      setTypeFilter(t.value);
                      setStatusFilter("all");
                    }}
                    className="block w-full text-left"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                        <span
                          className={cn(
                            "flex h-5 w-5 items-center justify-center rounded-md text-white",
                            t.iconBg,
                          )}
                        >
                          <Icon className="h-3 w-3" />
                        </span>
                        {t.label}
                      </span>
                      <span className="text-[11px] font-bold tabular-nums text-muted-foreground">
                        {t.count}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full transition-all", t.iconBg)}
                        style={{ width: `${t.count ? Math.max(12, pct) : 0}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-sky-200/70 bg-gradient-to-br from-sky-50 via-card to-indigo-50/50 p-4 shadow-sm dark:border-sky-500/25 dark:from-sky-500/10 dark:to-indigo-500/5">
            <p className="flex items-center gap-2 text-sm font-bold text-sky-950 dark:text-sky-100">
              <Send className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              Desk eslatma
            </p>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-sky-950/75 dark:text-sky-100/70">
              <li>· Xodimni tanlang — Telegram + tizim xabari ketadi</li>
              <li>· Qatorni bosing — tahrir, ko‘chirish, bekor</li>
              <li>· Ofisda / Chiqdi filtrlaridan tez saralang</li>
            </ul>
          </div>
        </aside>
      </div>

      {/* Table */}
      <section className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-lg shadow-primary/5 dark:border-white/10">
        <div className="space-y-3 border-b border-border/60 bg-gradient-to-r from-muted/40 via-card to-card px-4 py-4 dark:from-muted/20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold tracking-tight">
                {dayScope === "today" ? "Bugungi tashriflar" : "Barcha tashriflar"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {items.length} ta ko‘rsatilmoqda
                {statusFilter !== "all" || typeFilter !== "all"
                  ? ` · jami ${allItems.length}`
                  : ""}
                {" · "}
                qatorni bosing — ochish / tahrirlash
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Qidirish…"
                  className="h-9 rounded-xl pl-8"
                />
              </div>
              <div className="flex rounded-xl border bg-card p-0.5 text-xs font-semibold shadow-sm">
                <button
                  type="button"
                  className={cn(
                    "rounded-lg px-3 py-1.5",
                    dayScope === "today"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground",
                  )}
                  onClick={() => setDayScope("today")}
                >
                  Bugun
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-lg px-3 py-1.5",
                    dayScope === "all"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground",
                  )}
                  onClick={() => setDayScope("all")}
                >
                  Barchasi
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { key: "all" as const, label: "Hammasi", n: statusCounts.all, tone: "bg-slate-100 text-slate-800" },
                {
                  key: "in_progress" as const,
                  label: "Ofisda",
                  n: statusCounts.in_progress,
                  tone: "bg-emerald-100 text-emerald-800",
                },
                {
                  key: "waiting" as const,
                  label: "Kutilmoqda",
                  n: statusCounts.waiting,
                  tone: "bg-amber-100 text-amber-900",
                },
                {
                  key: "done" as const,
                  label: "Chiqdi",
                  n: statusCounts.done,
                  tone: "bg-sky-100 text-sky-800",
                },
                {
                  key: "cancelled" as const,
                  label: "Bekor",
                  n: statusCounts.cancelled,
                  tone: "bg-rose-100 text-rose-800",
                },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition",
                  statusFilter === f.key
                    ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
                    : "border-border/70 bg-background hover:bg-muted/50",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] tabular-nums",
                    statusFilter === f.key ? "bg-white/20" : f.tone,
                  )}
                >
                  {f.n}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setTypeFilter("all")}
              className={cn(
                "rounded-xl border px-2.5 py-1 text-[11px] font-semibold",
                typeFilter === "all"
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:bg-muted/40",
              )}
            >
              Barcha turlar
            </button>
            {TYPE_TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTypeFilter(String(t.value))}
                className={cn(
                  "rounded-xl border px-2.5 py-1 text-[11px] font-semibold",
                  typeFilter === t.value ? t.activeTab : "border-border/60 text-muted-foreground hover:bg-muted/40",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {logsQ.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Yuklanmoqda…
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">
            Hali tashrif yo‘q yoki filtr bo‘sh. Yuqoridan yangi qayd qo‘shing.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">Vaqt</th>
                  <th className="px-3 py-2.5 font-semibold">Mehmon</th>
                  <th className="px-3 py-2.5 font-semibold">Turi</th>
                  <th className="px-3 py-2.5 font-semibold">Kimning oldiga</th>
                  <th className="px-3 py-2.5 font-semibold">Maqsad</th>
                  <th className="px-3 py-2.5 font-semibold">Holat</th>
                  <th className="px-3 py-2.5 font-semibold">Chiqish</th>
                  <th className="px-3 py-2.5 font-semibold">Tezkor</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-border/50 transition hover:bg-primary/5"
                    onClick={() => openEdit(row)}
                  >
                    <td className="px-3 py-3 tabular-nums text-muted-foreground">{idx + 1}</td>
                    <td className="px-3 py-3 tabular-nums font-medium">
                      {formatVisitTime(row.visitAt)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <AvatarBubble name={row.visitorFullName} size="sm" tone="violet" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.visitorFullName}</p>
                          {row.visitorPhone ? (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {row.visitorPhone}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          TYPE_BADGE[row.visitType] || "bg-muted",
                        )}
                      >
                        {row.visitTypeLabel || typeLabel(String(row.visitType))}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <AvatarBubble
                          name={row.hostName || row.hostUserName || "?"}
                          size="sm"
                          tone="emerald"
                        />
                        <span className="truncate text-xs">
                          {row.hostName || row.hostUserName || "—"}
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-3 text-xs text-muted-foreground">
                      {row.purpose || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          STATUS_BADGE[row.status] || "bg-muted",
                        )}
                      >
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-xs text-muted-foreground">
                      {row.leftAt ? formatVisitTime(row.leftAt) : "—"}
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-1">
                        {canWrite && row.status !== "done" && row.status !== "cancelled" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-7 rounded-lg px-2 text-[11px]"
                            onClick={() => void markDone(row)}
                          >
                            <LogOut className="mr-1 h-3 w-3" />
                            Chiqdi
                          </Button>
                        ) : row.status === "done" ? (
                          <span className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            OK
                          </span>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 rounded-lg px-2 text-[11px]"
                          onClick={() => openEdit(row)}
                        >
                          Ochish
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Sheet open={Boolean(editRow)} onOpenChange={(o) => !o && setEditRow(null)}>
        <SheetContent className="w-full overflow-y-auto border-l border-border/60 bg-gradient-to-b from-slate-50 via-white to-white p-0 sm:max-w-lg">
          <div className="border-b border-border/60 bg-gradient-to-r from-sky-50 via-white to-violet-50 px-5 pb-4 pt-5">
            <SheetHeader className="space-y-1 text-left">
              <SheetTitle className="flex items-center gap-2 text-lg">
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sky-500 text-white shadow-md shadow-sky-500/25">
                  <ConciergeBell className="h-4.5 w-4.5 h-4 w-4" />
                </span>
                Tashrif ma’lumotlari
              </SheetTitle>
              <p className="text-xs text-muted-foreground">
                Tahrirlash, boshqa kunga ko‘chirish yoki bekor qilish
              </p>
            </SheetHeader>
          </div>
          {editRow ? (
            <div className="space-y-4 px-5 py-4">
              <div className="flex flex-wrap gap-1.5">
                {TYPE_TABS.map((t) => {
                  const Icon = t.icon;
                  const active = editDraft.visitType === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      disabled={!canWrite}
                      onClick={() => setEditDraft((d) => ({ ...d, visitType: t.value }))}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition",
                        active ? t.activeTab : "border-border/60 bg-white text-foreground/80 hover:bg-muted/40",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-lg text-white shadow-sm",
                          t.iconBg,
                        )}
                      >
                        <Icon className="h-3 w-3" />
                      </span>
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-border/60 bg-white p-3.5 shadow-sm space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Ism familiya
                  </label>
                  <Input
                    value={editDraft.visitorFullName}
                    disabled={!canWrite}
                    onChange={(e) => setEditDraft((d) => ({ ...d, visitorFullName: e.target.value }))}
                    className="h-10 rounded-xl"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Telefon
                    </label>
                    <Input
                      value={editDraft.visitorPhone}
                      disabled={!canWrite}
                      onChange={(e) =>
                        setEditDraft((d) => ({ ...d, visitorPhone: formatVisitorPhone(e.target.value) }))
                      }
                      className="h-10 rounded-xl font-medium tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Sabab / maqsad
                    </label>
                    <Input
                      value={editDraft.purpose}
                      disabled={!canWrite}
                      onChange={(e) => setEditDraft((d) => ({ ...d, purpose: e.target.value }))}
                      className="h-10 rounded-xl"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Kimning oldiga
                  </label>
                  <Input
                    value={editDraft.hostName}
                    disabled={!canWrite}
                    onChange={(e) => setEditDraft((d) => ({ ...d, hostName: e.target.value }))}
                    className="h-10 rounded-xl"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Izoh
                  </label>
                  <Textarea
                    value={editDraft.notes}
                    disabled={!canWrite}
                    onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                    className="min-h-[72px] rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <VisitDateTimeField
                  label="Kirish / uchrashuv"
                  icon={Clock3}
                  value={editDraft.visitAt}
                  onChange={(v) => setEditDraft((d) => ({ ...d, visitAt: v }))}
                  disabled={!canWrite}
                  accentClass="border-sky-200/80 from-sky-50/90 to-card"
                  iconClass="text-sky-600"
                />
                <VisitDateTimeField
                  label="Chiqish"
                  icon={LogOut}
                  value={editDraft.leftAt}
                  onChange={(v) => setEditDraft((d) => ({ ...d, leftAt: v }))}
                  disabled={!canWrite}
                  clearable
                  placeholder="Ixtiyoriy"
                  accentClass="border-violet-200/80 from-violet-50/80 to-card"
                  iconClass="text-violet-600"
                />
              </div>

              {canWrite ? (
                <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-3.5 shadow-sm">
                  <p className="flex items-center gap-2 text-sm font-bold text-amber-950">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm shadow-amber-500/30">
                      <CalendarDays className="h-4 w-4" />
                    </span>
                    Uchrashuvni ko‘chirish
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-amber-950/70">
                    Boshqa kun yoki vaqtga o‘tkazing — pastdagi kartadan sana tanlang, so‘ng qo‘llang.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(
                      [
                        [0, "Bugun"],
                        [1, "Ertaga"],
                        [2, "+2 kun"],
                        [7, "+1 hafta"],
                      ] as const
                    ).map(([days, lab]) => (
                      <button
                        key={lab}
                        type="button"
                        onClick={() => shiftVisitDays(days)}
                        className="rounded-xl border border-amber-200/90 bg-white/90 px-2.5 py-1.5 text-[11px] font-bold text-amber-950 shadow-sm hover:bg-amber-100/80"
                      >
                        {lab}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => void rescheduleToNow(editRow)}
                      className="rounded-xl border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] font-bold text-sky-900 shadow-sm hover:bg-sky-100"
                    >
                      Hozir
                    </button>
                  </div>
                  <Button
                    type="button"
                    className="mt-3 h-10 w-full rounded-xl bg-amber-600 hover:bg-amber-700 shadow-amber-600/25"
                    disabled={mut.update.isPending}
                    onClick={() => void applyReschedule()}
                  >
                    {mut.update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Ko‘chirishni qo‘llash
                  </Button>
                </div>
              ) : null}

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Holat
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["waiting", "Kutilmoqda", "border-amber-200 bg-amber-50 text-amber-950"],
                      ["in_progress", "Ofisda", "border-sky-200 bg-sky-50 text-sky-900"],
                      ["done", "Chiqdi", "border-emerald-200 bg-emerald-50 text-emerald-900"],
                      ["cancelled", "Bekor", "border-rose-200 bg-rose-50 text-rose-900"],
                    ] as const
                  ).map(([k, lab, idle]) => (
                    <button
                      key={k}
                      type="button"
                      disabled={!canWrite}
                      onClick={() => setEditDraft((d) => ({ ...d, status: k }))}
                      className={cn(
                        "rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition",
                        editDraft.status === k
                          ? "border-primary/40 bg-primary text-primary-foreground shadow-sm"
                          : idle,
                      )}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
              </div>

              {canWrite ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10 rounded-xl"
                    disabled={editDraft.status === "done"}
                    onClick={() => void markDone(editRow)}
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                    Chiqdi
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50"
                    onClick={() => void cancelVisit(editRow)}
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    Bekor qilish
                  </Button>
                  {canDelete ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="col-span-2 h-10 rounded-xl border-rose-300 bg-rose-50/50 text-rose-700 hover:bg-rose-100"
                      onClick={() => void onDelete(editRow).then(() => setEditRow(null))}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      O‘chirish (faqat admin)
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <SheetFooter className="sticky bottom-0 gap-2 border-t border-border/60 bg-white/95 px-5 py-3 backdrop-blur sm:space-x-0">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setEditRow(null)}>
              Yopish
            </Button>
            {canWrite ? (
              <Button
                type="button"
                className="rounded-xl"
                disabled={mut.update.isPending}
                onClick={() => void saveEdit()}
              >
                {mut.update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Saqlash
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {photoPreview ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`${photoPreview.name} rasmi`}
          onClick={() => setPhotoPreview(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPhotoPreview(null);
          }}
        >
          <button
            type="button"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            onClick={() => setPhotoPreview(null)}
            aria-label="Yopish"
          >
            <X className="h-5 w-5" />
          </button>
          <div
            className="flex max-h-[90vh] max-w-[min(92vw,420px)] flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={photoPreview.url}
              alt={photoPreview.name}
              className="max-h-[78vh] w-full rounded-3xl object-cover shadow-2xl ring-1 ring-white/20"
            />
            <p className="text-sm font-semibold text-white drop-shadow">{photoPreview.name}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
