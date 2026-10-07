import React from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Clock3,
  Eye,
  Hourglass,
  MapPin,
  Play,
  RotateCcw,
  Send,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import { formatYmd, WORKFLOW_STATUS_LABEL } from "@/lib/reviziya-cycle";

const MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];

type SectionKey = "review" | "overdue" | "today" | "upcoming";

const STATUS_PILL: Record<string, string> = {
  ASSIGNED: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200",
  ACCEPTED: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200",
  IN_PROGRESS: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200",
  REVIEW: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
};

export function TasksBoard({
  data,
  isLoading,
  canReview,
  myId,
  onOpen,
  onOpenBranch,
}: {
  data: any;
  isLoading: boolean;
  canReview: boolean;
  myId: number | null;
  onOpen: (visit: any) => void;
  onOpenBranch: (branchId: number) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );
  }

  const review: any[] = data?.review || [];
  const overdue: any[] = data?.overdue || [];
  const today: any[] = data?.today || [];
  const upcoming: any[] = data?.upcoming || [];
  const todayYmd: string | undefined = data?.todayYmd;

  const tiles: { key: SectionKey; label: string; hint: string; n: number; icon: LucideIcon; tone: string }[] = [
    {
      key: "review",
      label: canReview ? "Tasdiqlash kutilmoqda" : "Tekshiruvda",
      hint: canReview ? "Siz ko‘rib chiqasiz" : "Boshliq tekshiryapti",
      n: review.length,
      icon: Hourglass,
      tone: "amber",
    },
    { key: "overdue", label: "Kechikkan", hint: "Muddati o‘tgan", n: overdue.length, icon: AlertTriangle, tone: "rose" },
    { key: "today", label: "Bugun", hint: todayYmd ? formatYmd(todayYmd) : "", n: today.length, icon: Sun, tone: "sky" },
    { key: "upcoming", label: "Kelajakda", hint: "Rejalashtirilgan", n: upcoming.length, icon: CalendarDays, tone: "slate" },
  ];

  const jump = (key: SectionKey) =>
    document.getElementById(`rev-tasks-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const total = review.length + overdue.length + today.length + upcoming.length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => jump(t.key)}
              disabled={t.n === 0}
              className={cn(
                "group flex items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-sm transition enabled:hover:-translate-y-0.5 enabled:hover:shadow-md disabled:opacity-60",
                t.n > 0 && t.tone === "amber" && "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10",
                t.n > 0 && t.tone === "rose" && "border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10",
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  t.tone === "amber" && "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
                  t.tone === "rose" && "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
                  t.tone === "sky" && "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
                  t.tone === "slate" && "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-2xl font-bold leading-none tabular-nums">{t.n}</span>
                <span className="mt-1 block truncate text-xs font-semibold">{t.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{t.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
          <CalendarDays className="h-9 w-9 text-muted-foreground/50" />
          <p className="text-sm font-medium">Hozircha vazifa yo‘q</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {canReview
              ? "Yangi reviziya uchun «Reviziya qilish»ni bosing yoki «Arizalar»dan koordinator arizasini tasdiqlang."
              : "Bo‘lim boshlig‘i reviziya topshirsa shu yerda paydo bo‘ladi va sizga xabar keladi."}
          </p>
        </div>
      ) : null}

      <Section
        id="review"
        title={canReview ? "Tasdiqlash kutilmoqda — siz tekshirasiz" : "Tasdiqlashga yuborilgan"}
        hint={
          canReview
            ? "Revizor to‘ldirib yubordi. «Ko‘rib chiqish»ni bosing — tasdiqlang yoki sababini yozib rad eting."
            : "Bo‘lim boshlig‘i tekshiryapti. Rad etilsa sababi bilan qaytadi."
        }
        tone="amber"
        items={review}
        render={(v) => (
          <TaskCard key={v.id} visit={v} todayYmd={todayYmd} canReview={canReview} myId={myId} onOpen={() => onOpen(v)} onOpenBranch={() => onOpenBranch(v.branchId)} />
        )}
      />
      <Section
        id="overdue"
        title="Kechikkan — eng avval shular"
        hint="Reja kuni o‘tib ketgan, hali yakunlanmagan reviziyalar."
        tone="rose"
        items={overdue}
        render={(v) => (
          <TaskCard key={v.id} visit={v} todayYmd={todayYmd} canReview={canReview} myId={myId} onOpen={() => onOpen(v)} onOpenBranch={() => onOpenBranch(v.branchId)} />
        )}
      />
      <Section
        id="today"
        title="Bugun"
        hint="Vaqt tartibida."
        tone="sky"
        items={today}
        render={(v) => (
          <TaskCard key={v.id} visit={v} todayYmd={todayYmd} canReview={canReview} myId={myId} onOpen={() => onOpen(v)} onOpenBranch={() => onOpenBranch(v.branchId)} />
        )}
      />
      <Section
        id="upcoming"
        title="Kelajakda"
        hint="Kun tartibida."
        tone="slate"
        items={upcoming}
        render={(v) => (
          <TaskCard key={v.id} visit={v} todayYmd={todayYmd} canReview={canReview} myId={myId} onOpen={() => onOpen(v)} onOpenBranch={() => onOpenBranch(v.branchId)} />
        )}
      />
    </div>
  );
}

function Section({
  id,
  title,
  hint,
  tone,
  items,
  render,
}: {
  id: SectionKey;
  title: string;
  hint: string;
  tone: "amber" | "rose" | "sky" | "slate";
  items: any[];
  render: (v: any) => React.ReactNode;
}) {
  if (!items.length) return null;
  return (
    <section id={`rev-tasks-${id}`} className="scroll-mt-4">
      <div className="mb-2 flex items-end justify-between gap-2">
        <div>
          <h3
            className={cn(
              "flex items-center gap-2 text-sm font-semibold",
              tone === "amber" && "text-amber-900 dark:text-amber-200",
              tone === "rose" && "text-rose-800 dark:text-rose-200",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                tone === "amber" && "bg-amber-500",
                tone === "rose" && "bg-rose-500",
                tone === "sky" && "bg-sky-500",
                tone === "slate" && "bg-slate-400",
              )}
            />
            {title}
            <span className="rounded-full bg-muted px-2 text-[11px] font-semibold tabular-nums text-muted-foreground">{items.length}</span>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      <div className="grid gap-2">{items.map(render)}</div>
    </section>
  );
}

function primaryAction(visit: any, canReview: boolean, mine: boolean): { label: string; icon: LucideIcon; tone: string } {
  const wf = visit.workflowStatus;
  if (wf === "REVIEW") return canReview ? { label: "Ko‘rib chiqish", icon: Eye, tone: "amber" } : { label: "Ko‘rish", icon: Eye, tone: "outline" };
  if (mine && (wf === "ASSIGNED" || wf === "ACCEPTED")) return { label: "Boshlash", icon: Play, tone: "emerald" };
  if (mine && wf === "IN_PROGRESS")
    return visit.reviewDecision === "rejected_redo"
      ? { label: "Tuzatish", icon: RotateCcw, tone: "rose" }
      : { label: "Davom ettirish", icon: Play, tone: "emerald" };
  return { label: "Ochish", icon: Eye, tone: "outline" };
}

function TaskCard({
  visit,
  todayYmd,
  canReview,
  myId,
  onOpen,
  onOpenBranch,
}: {
  visit: any;
  todayYmd?: string;
  canReview: boolean;
  myId: number | null;
  onOpen: () => void;
  onOpenBranch: () => void;
}) {
  const wf = String(visit.workflowStatus);
  const plan = String(visit.revisionDate || visit.scheduledDate || "");
  const late = Boolean(todayYmd && plan && plan < todayYmd && wf !== "REVIEW");
  const lateDays = late && todayYmd ? Math.round((Date.parse(todayYmd) - Date.parse(plan)) / 86400000) : 0;
  const mine = myId != null && Number(visit.assignedEmployeeId) === myId;
  const action = primaryAction(visit, canReview, mine);
  const ActionIcon = action.icon;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(plan);
  const rejected = wf === "IN_PROGRESS" && visit.reviewDecision === "rejected_redo" && visit.rejectReason;
  const time = visit.scheduledStartTime
    ? `${String(visit.scheduledStartTime).slice(0, 5)}${visit.scheduledEndTime ? `–${String(visit.scheduledEndTime).slice(0, 5)}` : ""}`
    : null;

  return (
    <article
      className={cn(
        "group flex cursor-pointer flex-col gap-3 rounded-2xl border bg-card p-3 shadow-sm transition hover:border-violet-200 hover:shadow-md sm:flex-row sm:items-center",
        late && "border-rose-200 bg-rose-50/40 dark:border-rose-500/30 dark:bg-rose-500/5",
        wf === "REVIEW" && canReview && "border-amber-200 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-500/5",
      )}
      onClick={onOpen}
    >
      <div
        className={cn(
          "flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl text-center",
          late ? "bg-rose-600 text-white" : "bg-slate-900 text-white dark:bg-white dark:text-slate-900",
        )}
      >
        <span className="text-lg font-bold leading-none tabular-nums">{m ? Number(m[3]) : "—"}</span>
        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-80">{m ? MONTHS_SHORT[Number(m[2]) - 1] : ""}</span>
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="truncate text-[15px] font-semibold">{displayBranchName(visit.branchName) || visit.branchName}</h4>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", late ? "bg-rose-100 text-rose-800" : STATUS_PILL[wf] || "bg-muted text-muted-foreground")}>
            {late ? `Kechikkan${lateDays > 0 ? ` · ${lateDays} kun` : ""}` : WORKFLOW_STATUS_LABEL[wf] || wf}
          </span>
          {mine ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
              Sizga
            </span>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {time ? (
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" /> {time}
            </span>
          ) : null}
          {visit.assignedEmployeeName && !mine ? <span>Revizor: <b className="font-medium text-foreground">{visit.assignedEmployeeName}</b></span> : null}
          {visit.createdByName && visit.createdByName !== visit.assignedEmployeeName ? (
            <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300">
              <Send className="h-3 w-3" /> {visit.createdByName} topshirdi
            </span>
          ) : null}
          {wf === "REVIEW" && visit.submittedByName ? (
            <span className="font-medium text-amber-800 dark:text-amber-200">{visit.submittedByName} yubordi</span>
          ) : null}
        </p>
        {rejected ? (
          <p className="rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-800 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/20">
            Rad etildi — qayta qiling. Sabab: {visit.rejectReason}
          </p>
        ) : visit.notes ? (
          <p className="line-clamp-1 text-xs text-muted-foreground">{visit.notes}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant={action.tone === "outline" ? "outline" : "default"}
          className={cn(
            "h-9 gap-1.5 rounded-xl px-4",
            action.tone === "emerald" && "bg-emerald-600 text-white hover:bg-emerald-700",
            action.tone === "amber" && "bg-amber-600 text-white hover:bg-amber-700",
            action.tone === "rose" && "bg-rose-600 text-white hover:bg-rose-700",
          )}
          onClick={onOpen}
        >
          <ActionIcon className="h-4 w-4" /> {action.label}
        </Button>
        <Button size="sm" variant="ghost" className="h-9 gap-1.5 rounded-xl px-3" onClick={onOpenBranch} title="Filial ma’lumotlari">
          <Building2 className="h-4 w-4" /> Filial
        </Button>
        {mine ? (
          <Button size="sm" variant="ghost" className="h-9 gap-1.5 rounded-xl px-3" asChild title="Filialda davomat">
            <Link href="/davomat-face">
              <MapPin className="h-4 w-4" /> Davomat
            </Link>
          </Button>
        ) : null}
      </div>
    </article>
  );
}
