import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Hand,
  Lock,
  LogOut,
  MinusCircle,
  TimerOff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CoordinatorVisitSession, VisitPhase } from "@/lib/branch-audits-api";

export type PhaseMeta = {
  label: string;
  hint: string;
  icon: LucideIcon;
  badge: string;
  dot: string;
  /** Admin harakati talab qilinadimi */
  urgent?: boolean;
};

export const PHASE_META: Record<VisitPhase, PhaseMeta> = {
  unlock_requested: {
    label: "Ruxsat so‘radi",
    hint: "Hududni vaqtida tasdiqlamadi — vaqti to‘xtatildi, adminga ruxsat so‘rovi yubordi. Ruxsat berilsa vaqt davom etadi",
    icon: Hand,
    badge: "bg-amber-500 text-white",
    dot: "bg-amber-500",
    urgent: true,
  },
  blocked: {
    label: "Bloklangan",
    hint: "Qo‘shimcha 10 daqiqada ham hududni tasdiqlamadi — vaqti to‘xtatildi, cheklist yopiq. Ruxsat berilsa vaqt davom etadi",
    icon: Lock,
    badge: "bg-rose-600 text-white",
    dot: "bg-rose-600",
    urgent: true,
  },
  presence_due: {
    label: "Tasdiq kutilmoqda",
    hint: "30 daqiqa o‘tdi — 10 daqiqa ichida hududni tasdiqlamasa vaqti to‘xtaydi va cheklist yopiladi",
    icon: Clock3,
    badge: "bg-orange-100 text-orange-900 ring-1 ring-inset ring-orange-300",
    dot: "bg-orange-500",
  },
  need_checklist: {
    label: "Filialda · cheklist yo‘q",
    hint: "Keldim qildi, cheklist hali to‘ldirilmagan",
    icon: ClipboardList,
    badge: "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300",
    dot: "bg-amber-400",
  },
  need_checkout: {
    label: "Cheklist tayyor · Ketdim yo‘q",
    hint: "Cheklist saqlandi, endi Ketdim qilishi kerak",
    icon: LogOut,
    badge: "bg-sky-100 text-sky-900 ring-1 ring-inset ring-sky-300",
    dot: "bg-sky-500",
  },
  closed_ok: {
    label: "Yakunlandi",
    hint: "Keldim → cheklist → Ketdim — hammasi joyida",
    icon: CheckCircle2,
    badge: "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-300",
    dot: "bg-emerald-500",
  },
  closed_no_checklist: {
    label: "Cheklistsiz yopildi",
    hint: "Filialga keldi-ketdi, lekin cheklist to‘ldirmadi",
    icon: MinusCircle,
    badge: "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200",
    dot: "bg-rose-400",
  },
  auto_closed: {
    label: "Avto yopildi",
    hint: "Ketdim qilinmagan — tizim kun tugagach yopdi",
    icon: TimerOff,
    badge: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300",
    dot: "bg-slate-400",
  },
  office_open: {
    label: "Asosiy ofisda",
    hint: "Ofisda «Keldim» qilgan, hali ketmagan",
    icon: Building2,
    badge: "bg-indigo-100 text-indigo-900 ring-1 ring-inset ring-indigo-300",
    dot: "bg-indigo-500",
  },
  office_closed: {
    label: "Ofis · yopiq",
    hint: "Asosiy ofisda bo‘lgan vaqt",
    icon: Building2,
    badge: "bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200",
    dot: "bg-indigo-300",
  },
};

export function phaseOf(v: CoordinatorVisitSession): VisitPhase {
  if (v.phase) return v.phase;
  if (v.isOffice) return v.stillOpen ? "office_open" : "office_closed";
  if (v.stillOpen) {
    if (v.presenceBlocked) return v.unlockPending ? "unlock_requested" : "blocked";
    if (!v.checklistAt) return v.presenceOverdue ? "presence_due" : "need_checklist";
    return v.presenceOverdue ? "presence_due" : "need_checkout";
  }
  return v.checklistAt ? "closed_ok" : "closed_no_checklist";
}

export function PhaseBadge({ phase, className }: { phase: VisitPhase; className?: string }) {
  const meta = PHASE_META[phase];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
        meta.badge,
        className,
      )}
      title={meta.hint}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

export function fmtHm(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDateLong(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const months = [
    "yanvar", "fevral", "mart", "aprel", "may", "iyun",
    "iyul", "avgust", "sentyabr", "oktyabr", "noyabr", "dekabr",
  ];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
  const yest = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
  const base = `${d}-${months[m - 1]}`;
  if (ymd === today) return `Bugun · ${base}`;
  if (ymd === yest) return `Kecha · ${base}`;
  return `${base} ${y}`;
}

export function minutesLabel(mins: number | null | undefined) {
  if (mins == null || !Number.isFinite(mins) || mins < 0) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h <= 0) return `${m} daq`;
  if (m === 0) return `${h} soat`;
  return `${h} soat ${m} daq`;
}

/** Filialda qolish: cheklistgacha / cheklistdan keyin — bitta chiziq */
export function StaySplitBar({ v }: { v: CoordinatorVisitSession }) {
  const total = v.durationMinutes ?? 0;
  const before = v.checklistAfterCheckInMinutes;
  if (!total || before == null || before < 0) {
    return (
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            v.stayFrozen ? "bg-rose-400" : v.stillOpen ? "bg-amber-400" : "bg-slate-300",
          )}
          style={{ width: total ? "100%" : "0%" }}
        />
      </div>
    );
  }
  const pct = Math.max(4, Math.min(96, Math.round((before / Math.max(total, 1)) * 100)));
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" title="Ko‘k — cheklistgacha, yashil — cheklistdan keyin">
      <div className="h-full bg-sky-500" style={{ width: `${pct}%` }} />
      <div className="h-full flex-1 bg-emerald-500" />
    </div>
  );
}

export function UrgentIcon() {
  return <AlertTriangle className="h-4 w-4" />;
}
