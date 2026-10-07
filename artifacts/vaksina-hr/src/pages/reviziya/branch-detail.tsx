import React, { useState } from "react";
import {
  Banknote,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Hash,
  History,
  Paperclip,
  Phone,
  ShieldCheck,
  Sigma,
  Store,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import { CYCLE_STATUS_LABEL, WORKFLOW_STATUS_LABEL, formatYmd, moneySoum } from "@/lib/reviziya-cycle";
import { RevisionFiles, revisionFilesOf } from "./revision-files";
import { DebtPayments, collectState } from "./debt-payments";

type Person = { name: string; phone: string | null };

const STATUS_HERO: Record<string, string> = {
  YANGI_OCHILGAN: "from-sky-600 to-cyan-600",
  REJADAGIDEK: "from-emerald-600 to-teal-600",
  TEZ_ORADA: "from-amber-500 to-orange-500",
  MUDDATI_OTGAN: "from-rose-600 to-red-600",
  SIKL_OTKAZIB_YUBORILGAN: "from-fuchsia-600 to-purple-700",
  REVIZIYA_JARAYONIDA: "from-indigo-600 to-violet-600",
  REVIZIYA_YAKUNLANGAN: "from-teal-600 to-emerald-600",
};

const STATUS_EXPLAIN: Record<string, string> = {
  YANGI_OCHILGAN: "Bu filialda hali yakunlangan reviziya yo‘q — birinchi reviziyani rejalashtiring.",
  REJADAGIDEK: "Reviziya o‘z vaqtida o‘tkazilgan, keyingi sanagacha vaqt yetarli.",
  TEZ_ORADA: "Keyingi reviziyagacha 14 kundan kam qoldi — revizor biriktirish vaqti.",
  MUDDATI_OTGAN: "Keyingi reviziya sanasi o‘tib ketgan — imkon qadar tezroq o‘tkazing.",
  SIKL_OTKAZIB_YUBORILGAN: "Butun bir sikl davomida reviziya qilinmagan — eng yuqori ustuvorlik.",
  REVIZIYA_JARAYONIDA: "Hozir revizor shu filialda ishlayapti yoki reviziyani qabul qilgan.",
  REVIZIYA_YAKUNLANGAN: "Oxirgi reviziya yakunlangan.",
};

function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
  const time = d.toLocaleTimeString("uz-UZ", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" });
  return `${formatYmd(date)} · ${time}`;
}

function durationText(minutes?: number | null, label?: string | null) {
  if (!minutes || minutes <= 0) return "—";
  return label || `${minutes} daqiqa`;
}

function daysText(daysLeft?: number | null) {
  if (daysLeft == null) return "Sana belgilanmagan";
  if (daysLeft < 0) return `${Math.abs(daysLeft)} kun kechikdi`;
  if (daysLeft === 0) return "Bugun";
  return `${daysLeft} kun qoldi`;
}

function PhoneLink({ phone, light }: { phone?: string | null; light?: boolean }) {
  if (!phone) return null;
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium tabular-nums hover:underline",
        light ? "text-white/90" : "text-violet-700 dark:text-violet-300",
      )}
    >
      <Phone className="h-3 w-3" />
      {phone}
    </a>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  right,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border bg-card shadow-sm", className)}>
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {hint ? <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
          </div>
        </div>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function PersonCard({
  role,
  name,
  phone,
  icon: Icon,
  tone,
  sub,
}: {
  role: string;
  name?: string | null;
  phone?: string | null;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  sub?: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-xl border bg-background/60 p-3">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{role}</p>
        <p className="truncate text-sm font-semibold text-foreground">{name || "—"}</p>
        {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
        <PhoneLink phone={phone} />
      </div>
    </div>
  );
}

function InfoCell({
  icon: Icon,
  label,
  value,
  strong,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("break-words text-[13px] text-foreground", strong && "font-semibold")}>{value}</p>
      </div>
    </div>
  );
}

function MoneyTiles({
  shortage,
  collected,
  remaining,
  excess,
}: {
  shortage: number;
  collected: number;
  remaining: number;
  excess?: number;
}) {
  const pct = shortage > 0 ? Math.min(100, Math.round((collected / shortage) * 100)) : 0;
  const state = collectState(shortage, collected);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-rose-50 p-3 ring-1 ring-inset ring-rose-100 dark:bg-rose-950/30 dark:ring-rose-900/50">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-700/80 dark:text-rose-300/80">Kamomad</p>
          <p className="mt-1 text-sm font-bold tabular-nums text-rose-900 dark:text-rose-100 sm:text-base">{moneySoum(shortage)}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-inset ring-emerald-100 dark:bg-emerald-950/30 dark:ring-emerald-900/50">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">Undirilgan</p>
          <p className="mt-1 text-sm font-bold tabular-nums text-emerald-900 dark:text-emerald-100 sm:text-base">{moneySoum(collected)}</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-100 dark:bg-amber-950/30 dark:ring-amber-900/50">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700/80 dark:text-amber-300/80">Qolgan qarz</p>
          <p className="mt-1 text-sm font-bold tabular-nums text-amber-900 dark:text-amber-100 sm:text-base">{moneySoum(remaining)}</p>
        </div>
      </div>
      {shortage > 0 ? (
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              Undirish holati
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", state.tone)}>{state.label}</span>
            </span>
            <span className="font-semibold tabular-nums text-foreground">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-rose-100 dark:bg-rose-950/50">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" /> Kamomad aniqlanmagan
        </p>
      )}
      {excess && excess > 0 ? (
        <p className="text-xs text-muted-foreground">
          Ortiqcha tovar: <b className="tabular-nums text-foreground">{moneySoum(excess)}</b>
        </p>
      ) : null}
    </div>
  );
}

function ResponsibleList({ people }: { people: Person[] }) {
  if (!people.length) {
    return (
      <p className="rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
        Reviziya vaqtida javobgar shaxs ko‘rsatilmagan
      </p>
    );
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {people.map((p, i) => (
        <li
          key={`${p.name}-${i}`}
          className="flex items-center gap-2.5 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 dark:border-violet-800/60 dark:bg-violet-950/20"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11px] font-bold text-white">
            {p.name.slice(0, 1).toUpperCase() || "?"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-foreground">{p.name}</p>
            {p.phone ? <PhoneLink phone={p.phone} /> : <p className="text-[11px] text-muted-foreground">Telefon yo‘q</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function CycleTimeline({ b }: { b: any }) {
  const last = b.lastRevisionDate as string | null;
  const next = b.nextRevisionDate as string | null;
  let pct = 0;
  if (last && next) {
    const a = Date.parse(last);
    const z = Date.parse(next);
    const now = Date.now();
    pct = z > a ? Math.max(0, Math.min(100, Math.round(((now - a) / (z - a)) * 100))) : 100;
  }
  const late = b.daysLeft != null && b.daysLeft < 0;
  return (
    <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-inset ring-white/20 backdrop-blur">
      <div className="flex items-end justify-between gap-3 text-white">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">Oxirgi reviziya</p>
          <p className="text-sm font-bold tabular-nums">{formatYmd(last)}</p>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-bold",
            late ? "bg-white text-rose-700" : "bg-white/20 text-white",
          )}
        >
          {daysText(b.daysLeft)}
        </span>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">Keyingi reviziya</p>
          <p className="text-sm font-bold tabular-nums">{formatYmd(next)}</p>
        </div>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/25">
        <div className={cn("h-full rounded-full", late ? "bg-white" : "bg-white/90")} style={{ width: `${last && next ? pct : 0}%` }} />
      </div>
      {b.cycleMonths ? (
        <p className="mt-1.5 text-[11px] text-white/75">Sikl: har {b.cycleMonths} oyda bir marta reviziya</p>
      ) : null}
    </div>
  );
}

function HistoryItem({
  h,
  last,
  defaultOpen = false,
  isLatest = false,
  canRecordPayment = false,
}: {
  h: any;
  last: boolean;
  defaultOpen?: boolean;
  isLatest?: boolean;
  canRecordPayment?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const done = h.workflowStatus === "COMPLETED";
  const cancelled = h.workflowStatus === "CANCELLED";
  const responsibles: Person[] = h.responsibles || [];
  const fileCount = revisionFilesOf(h).length;
  return (
    <li className="relative pl-7">
      {!last ? <span className="absolute left-[11px] top-6 h-[calc(100%-12px)] w-px bg-border" /> : null}
      <span
        className={cn(
          "absolute left-0 top-1 flex h-[22px] w-[22px] items-center justify-center rounded-full ring-4 ring-background",
          done ? "bg-emerald-500 text-white" : cancelled ? "bg-slate-300 text-slate-700" : "bg-indigo-500 text-white",
        )}
      >
        {done ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-xl border bg-background/60 p-3 text-left transition hover:border-violet-300 hover:bg-violet-50/40 dark:hover:bg-violet-950/20"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {formatYmd(h.revisionDate || h.scheduledDate)}
          </span>
          <span className="flex items-center gap-1.5">
            {fileCount ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-500/15 dark:text-violet-200">
                <Paperclip className="h-3 w-3" /> {fileCount} fayl
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                done
                  ? "bg-emerald-100 text-emerald-800"
                  : cancelled
                    ? "bg-slate-100 text-slate-600"
                    : "bg-indigo-100 text-indigo-800",
              )}
            >
              {WORKFLOW_STATUS_LABEL[h.workflowStatus] || h.workflowStatus}
            </span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition", open && "rotate-180")} />
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>
            Kamomad <b className="tabular-nums text-rose-700 dark:text-rose-300">{moneySoum(h.shortageAmount)}</b>
          </span>
          <span>
            Undirilgan <b className="tabular-nums text-emerald-700 dark:text-emerald-400">{moneySoum(h.collectedAmount)}</b>
          </span>
          <span>
            Qolgan <b className="tabular-nums text-amber-700 dark:text-amber-300">{moneySoum(h.remainingAmount)}</b>
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Revizor: <span className="font-medium text-foreground">{h.assignedEmployeeName || "—"}</span>
          {responsibles.length ? (
            <>
              {" · "}Javobgar:{" "}
              <span className="font-medium text-foreground">{responsibles.map((p) => p.name).join(", ")}</span>
            </>
          ) : null}
        </p>
      </button>
      {open ? (
        <div className="mt-2 space-y-3 rounded-xl border border-dashed p-3">
          <div className="grid grid-cols-2 gap-3">
            <InfoCell icon={Hash} label="Akt raqami" value={h.actNumber || "—"} />
            <InfoCell
              icon={Clock}
              label="Reja vaqti"
              value={h.scheduledStartTime ? `${h.scheduledStartTime}${h.scheduledEndTime ? `–${h.scheduledEndTime}` : ""}` : "—"}
            />
            <InfoCell icon={CalendarClock} label="Boshlandi" value={fmtDateTime(h.startedAt)} />
            <InfoCell icon={CheckCircle2} label="Yakunlandi" value={fmtDateTime(h.completedAt)} />
            <InfoCell icon={Clock} label="Davomiyligi" value={durationText(h.durationMinutes, h.durationLabel)} />
            <InfoCell icon={UserCheck} label="Yakunlagan" value={h.completedByName || "—"} />
            {h.reviewedByName ? (
              <InfoCell
                icon={UserCheck}
                label={h.reviewDecision === "approved" ? "Tasdiqlagan" : "Rad etgan"}
                value={`${h.reviewedByName}${h.reviewedAt ? ` · ${fmtDateTime(h.reviewedAt)}` : ""}`}
              />
            ) : null}
          </div>
          {h.rejectReason && (cancelled || h.reviewDecision === "rejected_redo") ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-900 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-100">
              <b>{cancelled ? "Bekor qilish sababi:" : "Rad etish sababi:"}</b> {h.rejectReason}
            </p>
          ) : null}
          {responsibles.length ? <ResponsibleList people={responsibles} /> : null}
          {done && Number(h.shortageAmount) > 0 ? (
            isLatest ? (
              <p className="text-[11px] text-muted-foreground">Undirish tarixi yuqorida — «Oxirgi reviziya natijasi» bo‘limida.</p>
            ) : (
              <DebtPayments visit={h} canRecord={canRecordPayment} compact />
            )
          ) : null}
          {h.notes ? (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-foreground/90">{h.notes}</p>
          ) : null}
          <RevisionFiles visit={h} compact emptyText="Fayl yuklanmagan" />
        </div>
      ) : null}
    </li>
  );
}

export function BranchDetailSheet({
  open,
  onClose,
  data,
  isLoading,
  canAssign,
  revizors,
  onAssign,
}: {
  open: boolean;
  onClose: () => void;
  data: any;
  isLoading: boolean;
  canAssign: boolean;
  revizors: Array<{ id: number; fullName: string }>;
  onAssign: (visitId: number, assignedEmployeeId: number) => Promise<void>;
}) {
  const [assignId, setAssignId] = useState("");
  const [staffOpen, setStaffOpen] = useState(false);
  const b = data?.branch;
  const latest = data?.latest;
  const active = data?.active;
  const totals = data?.totals;
  const history: any[] = data?.history || [];
  const staff: Array<{ id: number; fullName: string; position: string; phone: string | null }> = b?.staff || [];
  const status = b?.cycleStatus || "";
  const name = displayBranchName(b?.branchName) || b?.branchName || "Filial";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl [&>button]:hidden">
        {isLoading || !b ? (
          <div className="space-y-3 p-5">
            <SheetTitle className="sr-only">Filial</SheetTitle>
            <SheetDescription className="sr-only">Yuklanmoqda</SheetDescription>
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
          </div>
        ) : (
          <>
            <div className={cn("relative bg-gradient-to-br px-5 pb-5 pt-5 text-white", STATUS_HERO[status] || "from-violet-700 to-indigo-600")}>
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
                aria-label="Yopish"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-start gap-3 pr-10">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/25">
                  <Store className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <SheetTitle className="text-lg font-bold leading-tight text-white sm:text-xl">{name}</SheetTitle>
                  <SheetDescription className="mt-1 text-xs text-white/80">
                    {STATUS_EXPLAIN[status] || "Filial reviziya holati"}
                  </SheetDescription>
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-slate-900">
                    <ShieldCheck className="h-3 w-3" />
                    {b.cycleStatusLabel || CYCLE_STATUS_LABEL[status] || status}
                  </span>
                </div>
              </div>
              <div className="mt-4">
                <CycleTimeline b={b} />
              </div>
            </div>

            <div className="space-y-4 p-4 sm:p-5">
              <Section icon={Users} title="Mas’ul shaxslar" hint="Filial uchun kim javob beradi va kim bilan bog‘lanish kerak">
                <div className="grid gap-2 sm:grid-cols-2">
                  <PersonCard
                    role="Filial mudiri"
                    name={b.mudirName}
                    phone={b.mudirPhone}
                    icon={UserRound}
                    tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"
                  />
                  <PersonCard
                    role="Koordinator"
                    name={b.region}
                    phone={b.coordinatorPhone}
                    icon={UserCheck}
                    tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
                  />
                  <PersonCard
                    role={active ? "Biriktirilgan revizor" : "Oxirgi revizor"}
                    name={active?.assignedEmployeeName || latest?.assignedEmployeeName}
                    icon={ShieldCheck}
                    tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
                    sub={
                      active
                        ? `${formatYmd(active.revisionDate || active.scheduledDate)} · ${WORKFLOW_STATUS_LABEL[active.workflowStatus] || active.workflowStatus}`
                        : latest
                          ? `${formatYmd(latest.revisionDate)} da o‘tkazgan`
                          : undefined
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setStaffOpen((o) => !o)}
                    disabled={!staff.length}
                    className="flex min-w-0 items-start gap-3 rounded-xl border bg-background/60 p-3 text-left transition enabled:hover:border-violet-300"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">
                      <Users className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Filial jamoasi</p>
                      <p className="text-sm font-semibold text-foreground">{staff.length} nafar xodim</p>
                      <p className="text-[11px] text-violet-700 dark:text-violet-300">
                        {staff.length ? (staffOpen ? "Yashirish" : "Ro‘yxatni ko‘rish") : "Xodim biriktirilmagan"}
                      </p>
                    </div>
                  </button>
                </div>
                {staffOpen && staff.length ? (
                  <ul className="mt-3 divide-y rounded-xl border">
                    {staff.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-foreground">{s.fullName}</p>
                          <p className="text-[11px] text-muted-foreground">{s.position}</p>
                        </div>
                        <PhoneLink phone={s.phone} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Section>

              {active ? (
                <Section
                  icon={CalendarClock}
                  title="Faol reviziya"
                  hint="Rejalashtirilgan yoki hozir ketayotgan reviziya"
                  className="border-indigo-200 dark:border-indigo-900/60"
                  right={
                    <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-800">
                      {WORKFLOW_STATUS_LABEL[active.workflowStatus] || active.workflowStatus}
                    </span>
                  }
                >
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <InfoCell icon={CalendarDays} label="Sana" value={formatYmd(active.revisionDate || active.scheduledDate)} strong />
                    <InfoCell
                      icon={Clock}
                      label="Vaqti"
                      value={
                        active.scheduledStartTime
                          ? `${active.scheduledStartTime}${active.scheduledEndTime ? `–${active.scheduledEndTime}` : ""}`
                          : "—"
                      }
                    />
                    <InfoCell icon={ShieldCheck} label="Revizor" value={active.assignedEmployeeName || "Biriktirilmagan"} strong />
                    <InfoCell icon={CalendarClock} label="Boshlandi" value={fmtDateTime(active.startedAt)} />
                    <InfoCell icon={UserRound} label="Ariza bergan" value={active.createdByName || "—"} />
                    <InfoCell icon={Hash} label="Akt raqami" value={active.actNumber || "—"} />
                  </div>
                  {active.notes ? (
                    <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed">{active.notes}</p>
                  ) : null}
                  {revisionFilesOf(active).length ? (
                    <div className="mt-3">
                      <RevisionFiles visit={active} compact />
                    </div>
                  ) : null}
                  {canAssign ? (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <select
                        className="h-10 flex-1 rounded-xl border bg-background px-3 text-sm"
                        value={assignId}
                        onChange={(e) => setAssignId(e.target.value)}
                      >
                        <option value="">Boshqa revizorni tanlang</option>
                        {revizors.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.fullName}
                          </option>
                        ))}
                      </select>
                      <Button
                        className="h-10 gap-1.5 rounded-xl bg-violet-700 hover:bg-violet-800"
                        disabled={!assignId}
                        onClick={() => void onAssign(active.id, Number(assignId))}
                      >
                        <UserPlus className="h-4 w-4" /> Biriktirish
                      </Button>
                    </div>
                  ) : null}
                </Section>
              ) : null}

              {latest ? (
                <Section
                  icon={Banknote}
                  title="Oxirgi reviziya natijasi"
                  hint={`${formatYmd(latest.revisionDate)} da o‘tkazilgan${latest.actNumber ? ` · Akt ${latest.actNumber}` : ""}`}
                >
                  <MoneyTiles
                    shortage={latest.shortageAmount || 0}
                    collected={latest.collectedAmount || 0}
                    remaining={latest.remainingAmount || 0}
                    excess={latest.excessAmount || 0}
                  />

                  {Number(latest.shortageAmount) > 0 ? (
                    <div className="mt-4">
                      <DebtPayments visit={latest} canRecord={!!data?.canRecordPayment || canAssign} />
                    </div>
                  ) : null}

                  <div className="mt-4">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <UserRound className="h-3.5 w-3.5 text-violet-600" />
                      Reviziya vaqtida filialda javobgar
                    </p>
                    <ResponsibleList people={latest.responsibles || []} />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-3 sm:grid-cols-3">
                    <InfoCell icon={ShieldCheck} label="Revizor" value={latest.assignedEmployeeName || "—"} strong />
                    <InfoCell icon={CalendarDays} label="Reviziya kuni" value={formatYmd(latest.revisionDate)} />
                    <InfoCell
                      icon={Clock}
                      label="Reja vaqti"
                      value={
                        latest.scheduledStartTime
                          ? `${latest.scheduledStartTime}${latest.scheduledEndTime ? `–${latest.scheduledEndTime}` : ""}`
                          : "—"
                      }
                    />
                    <InfoCell icon={CalendarClock} label="Boshlandi" value={fmtDateTime(latest.startedAt)} />
                    <InfoCell icon={CheckCircle2} label="Yakunlandi" value={fmtDateTime(latest.completedAt)} />
                    <InfoCell icon={Clock} label="Davomiyligi" value={durationText(latest.durationMinutes, latest.durationLabel)} />
                    <InfoCell icon={UserCheck} label="Yakunlagan" value={latest.completedByName || "—"} />
                    <InfoCell icon={UserRound} label="Ariza / yaratgan" value={latest.createdByName || "—"} />
                    <InfoCell icon={CalendarDays} label="Keyingi reviziya" value={formatYmd(b.nextRevisionDate)} strong />
                  </div>

                  {latest.notes ? (
                    <div className="mt-4 rounded-xl border-l-4 border-violet-500 bg-violet-50/60 px-3 py-2.5 dark:bg-violet-950/20">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                        Revizor izohi
                      </p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-foreground">{latest.notes}</p>
                    </div>
                  ) : null}

                  <div className="mt-4">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Paperclip className="h-3.5 w-3.5 text-violet-600" />
                      Reviziya vaqtida yuklangan fayllar
                      <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                        {revisionFilesOf(latest).length}
                      </span>
                    </p>
                    <RevisionFiles visit={latest} emptyText="Bu reviziyada fayl yuklanmagan" />
                  </div>
                </Section>
              ) : (
                <Section icon={Banknote} title="Reviziya natijasi">
                  <p className="text-sm text-muted-foreground">Bu filialda hali yakunlangan reviziya yo‘q.</p>
                </Section>
              )}

              {totals && totals.completedCount > 1 ? (
                <Section icon={Sigma} title="Butun tarix bo‘yicha" hint={`${totals.completedCount} ta yakunlangan reviziya jami`}>
                  <MoneyTiles
                    shortage={totals.totalShortage}
                    collected={totals.totalCollected}
                    remaining={totals.totalRemaining}
                    excess={totals.totalExcess}
                  />
                </Section>
              ) : null}

              <Section
                icon={History}
                title="Reviziya tarixi"
                hint="Batafsil ko‘rish uchun qatorni bosing"
                right={
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-foreground">
                    {history.length} ta
                  </span>
                }
              >
                {history.length ? (
                  <ol className="space-y-3">
                    {history.map((h, i) => (
                      <HistoryItem
                        key={h.id}
                        h={h}
                        last={i === history.length - 1}
                        defaultOpen={i === 0}
                        isLatest={h.id === latest?.id}
                        canRecordPayment={!!data?.canRecordPayment || canAssign}
                      />
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">Tarix bo‘sh</p>
                )}
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}