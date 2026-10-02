import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Clock3,
  Hourglass,
  Send,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";
import { cn } from "../../lib/utils";
import {
  JAVOB_COORD_ESCALATE_HOURS,
  formatYmdDisplay,
  type JavobRequestItem,
} from "../../lib/javob-olish-api";

function isHourlyRequest(item: JavobRequestItem) {
  return item.kind === "hour" || item.fromHm !== item.shiftStartHm || item.toHm !== item.shiftEndHm;
}

export function javobStatusBadge(status: string, t: (k: string) => string) {
  if (status === "pending" || status === "pending_coord") {
    return { label: t("javob.statusPendingCoord"), className: "bg-amber-100 text-amber-900" };
  }
  if (status === "pending_dept") {
    return { label: t("javob.statusPendingDept"), className: "bg-violet-100 text-violet-900" };
  }
  if (status === "pending_hr") {
    return { label: t("javob.statusPendingHr"), className: "bg-sky-100 text-sky-900" };
  }
  if (status === "approved") {
    return { label: t("javob.statusApproved"), className: "bg-emerald-100 text-emerald-900" };
  }
  if (status === "rejected") {
    return { label: t("javob.statusRejected"), className: "bg-rose-100 text-rose-900" };
  }
  if (status === "cancelled") {
    return { label: t("javob.statusCancelled"), className: "bg-muted text-muted-foreground" };
  }
  return { label: status, className: "bg-muted text-muted-foreground" };
}

function useNow(enabled: boolean, stepMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(id);
  }, [enabled, stepMs]);
  return now;
}

function formatElapsed(ms: number) {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m} daq`;
  return m ? `${h} soat ${m} daq` : `${h} soat`;
}

type CoordState = {
  tone: "ok" | "bad" | "warn" | "wait" | "none";
  title: string;
  detail: string | null;
  note: string | null;
};

function coordinatorState(item: JavobRequestItem, now: number): CoordState {
  const who = item.coordDecidedByName || item.coordinatorName || null;
  const coordRejected =
    item.status === "rejected" && Boolean(item.coordDecidedAt) && !item.escalatedAt &&
    (!item.decidedById || item.decidedById === item.coordDecidedById);

  if (item.coordDecidedAt && !item.escalatedAt) {
    return {
      tone: coordRejected ? "bad" : "ok",
      title: coordRejected ? "Koordinator rad etdi" : "Koordinator tasdiqladi",
      detail: [who, item.coordDecidedAtLabel].filter(Boolean).join(" · ") || null,
      note: item.coordDecisionNote || null,
    };
  }
  if (item.escalatedAt) {
    return {
      tone: "warn",
      title: `Koordinator ${JAVOB_COORD_ESCALATE_HOURS} soat javob bermadi — HR ga o‘tdi`,
      detail: [item.coordinatorName, item.escalatedAtLabel].filter(Boolean).join(" · ") || null,
      note: null,
    };
  }
  if (item.status === "pending_coord" || item.status === "pending") {
    const created = item.createdAt ? new Date(item.createdAt).getTime() : NaN;
    const elapsed = Number.isFinite(created) ? now - created : 0;
    const left = JAVOB_COORD_ESCALATE_HOURS * 3_600_000 - elapsed;
    return {
      tone: item.coordinatorUserId ? "wait" : "none",
      title: item.coordinatorUserId ? "Koordinator hali javob bermadi" : "Koordinator biriktirilmagan",
      detail: Number.isFinite(created)
        ? `${formatElapsed(elapsed)} o‘tdi${left > 0 ? ` · ${formatElapsed(left)} dan so‘ng HR ga o‘tadi` : " · HR ga o‘tkazilmoqda"}`
        : null,
      note: null,
    };
  }
  if (item.decidedAt && !item.coordDecidedAt) {
    return {
      tone: "none",
      title: "Koordinator bosqichisiz hal qilindi",
      detail: item.coordinatorName || null,
      note: null,
    };
  }
  return { tone: "none", title: "Koordinator javobi yo‘q", detail: item.coordinatorName || null, note: null };
}

const TONE: Record<CoordState["tone"], { box: string; icon: typeof CheckCircle2; iconCls: string }> = {
  ok: { box: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10", icon: CheckCircle2, iconCls: "text-emerald-600" },
  bad: { box: "border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10", icon: XCircle, iconCls: "text-rose-600" },
  warn: { box: "border-orange-200 bg-orange-50/70 dark:border-orange-500/30 dark:bg-orange-500/10", icon: AlertTriangle, iconCls: "text-orange-600" },
  wait: { box: "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10", icon: Hourglass, iconCls: "text-amber-600" },
  none: { box: "border-border bg-muted/40", icon: UserRound, iconCls: "text-muted-foreground" },
};

function initials(name: string | null | undefined) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

type Props = {
  item: JavobRequestItem;
  t: (k: string) => string;
  /** Hide employee name (e.g. «Mening so‘rovlarim») */
  hideName?: boolean;
  /** Ketma-ket kunlar bitta so‘rov sifatida */
  datesLabel?: string;
  dayCount?: number;
  actions?: ReactNode;
  /** Qaror yuborilayotganda karta xiralashadi */
  busy?: boolean;
  className?: string;
};

export function JavobRequestCard({ item, t, hideName, datesLabel, dayCount = 1, actions, busy, className }: Props) {
  const badge = javobStatusBadge(item.status, t);
  const hourly = isHourlyRequest(item);
  const kindLabel = hourly ? t("javob.modeHour") : t("javob.modeDay");
  const waitingCoord = item.status === "pending_coord" || item.status === "pending";
  const now = useNow(waitingCoord);
  const coord = coordinatorState(item, now);
  const tone = TONE[coord.tone];
  const ToneIcon = tone.icon;
  const finalDecided = (item.status === "approved" || item.status === "rejected") && item.decidedAt;
  const timeline = item.timeline?.length
    ? item.timeline
    : [{ key: "sent", label: t("javob.timelineSent"), atLabel: item.createdAtLabel || "—", by: item.fullName, note: null as string | null }];

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-sm transition sm:p-4",
        busy && "pointer-events-none opacity-60",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {!hideName ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
            {initials(item.fullName)}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground sm:text-[15px]">
              {hideName ? `${formatYmdDisplay(item.workDate)} · ${kindLabel}` : item.fullName || `#${item.employeeId}`}
            </p>
            <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold", badge.className)}>
              {badge.label}
            </span>
          </div>
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-medium text-foreground/80">{item.branchLabel || "Filial aniqlanmagan"}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl bg-muted/50 px-2.5 py-2">
          <p className="flex items-center gap-1 text-muted-foreground">
            <CalendarDays className="h-3 w-3" /> {t("javob.date")}
          </p>
          <p className="mt-0.5 break-words font-semibold text-foreground">
            {datesLabel || formatYmdDisplay(item.workDate)}
            {dayCount > 1 ? (
              <span className="ml-1 font-medium text-muted-foreground">· {dayCount} kun</span>
            ) : null}
          </p>
        </div>
        <div className="rounded-xl bg-muted/50 px-2.5 py-2">
          <p className="flex items-center gap-1 text-muted-foreground">
            {hourly ? <Clock className="h-3 w-3" /> : <CalendarDays className="h-3 w-3" />} {kindLabel}
          </p>
          <p className="mt-0.5 break-words font-semibold tabular-nums text-foreground">
            {item.fromHm}–{item.toHm}
            {item.durationLabel ? <span className="font-normal text-muted-foreground"> · {item.durationLabel}</span> : null}
          </p>
        </div>
        <div className="rounded-xl bg-muted/50 px-2.5 py-2">
          <p className="flex items-center gap-1 text-muted-foreground">
            <Clock3 className="h-3 w-3" /> {t("javob.shift")}
          </p>
          <p className="mt-0.5 font-semibold tabular-nums text-foreground">
            {item.shiftStartHm}–{item.shiftEndHm}
            {item.shiftOvernight ? <span className="font-normal text-muted-foreground"> ({t("javob.nextDay")})</span> : null}
          </p>
        </div>
        <div className="rounded-xl bg-muted/50 px-2.5 py-2">
          <p className="flex items-center gap-1 text-muted-foreground">
            <Send className="h-3 w-3" /> {t("javob.sentAt")}
          </p>
          <p className="mt-0.5 font-semibold tabular-nums text-foreground">{item.createdAtLabel || "—"}</p>
        </div>
      </div>

      <div className={cn("rounded-xl border px-3 py-2.5", tone.box)}>
        <div className="flex items-start gap-2">
          <ToneIcon className={cn("mt-0.5 h-4 w-4 shrink-0", tone.iconCls)} />
          <div className="min-w-0 text-xs">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("javob.coordinator")}: <span className="normal-case tracking-normal text-foreground">{item.coordinatorName || "—"}</span>
            </p>
            <p className="mt-0.5 font-semibold text-foreground">{coord.title}</p>
            {coord.detail ? <p className="mt-0.5 text-muted-foreground">{coord.detail}</p> : null}
            {coord.note ? <p className="mt-1 italic text-foreground/80">«{coord.note}»</p> : null}
          </div>
        </div>
      </div>

      {finalDecided ? (
        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs",
            item.status === "approved" ? TONE.ok.box : TONE.bad.box,
          )}
        >
          <ShieldCheck className={cn("mt-0.5 h-4 w-4 shrink-0", item.status === "approved" ? "text-emerald-600" : "text-rose-600")} />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">
              {item.status === "approved" ? "Yakuniy ruxsat berildi" : "Yakuniy rad etildi"}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {[item.decidedByName, item.decidedAtLabel].filter(Boolean).join(" · ") || "—"}
            </p>
            {item.decisionNote ? <p className="mt-1 italic text-foreground/80">«{item.decisionNote}»</p> : null}
          </div>
        </div>
      ) : null}

      <p className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-relaxed text-foreground">
        <span className="font-semibold">{t("javob.note")}: </span>
        <span className="break-words">{item.note || "—"}</span>
      </p>

      <details className="group rounded-xl border border-border/70 px-3 py-2 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer select-none items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("javob.timeline")} ({timeline.length})
          <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
        </summary>
        <ol className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
          {timeline.map((step, i) => (
            <li key={`${step.key}-${i}`} className="relative text-[11px]">
              <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-primary/70" />
              <p className="font-medium text-foreground">{step.label}</p>
              <p className="text-muted-foreground">
                {step.atLabel || "—"}
                {step.by ? ` · ${step.by}` : ""}
              </p>
              {step.note ? <p className="mt-0.5 text-[10px] text-muted-foreground">{step.note}</p> : null}
            </li>
          ))}
        </ol>
      </details>

      {actions ? <div className="mt-auto pt-0.5">{actions}</div> : null}
    </div>
  );
}
