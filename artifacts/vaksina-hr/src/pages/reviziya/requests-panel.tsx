import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  Ban,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileQuestion,
  Hourglass,
  Inbox,
  Loader2,
  Search,
  Send,
  UserCheck,
  UserRound,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { scriptIncludes } from "@/lib/script-search";
import { displayBranchName } from "@/lib/pharmacy-staff-api";
import { formatYmd, WORKFLOW_STATUS_LABEL } from "@/lib/reviziya-cycle";
import {
  useReviziyaRequests,
  useReviziyaVisitMutations,
  type RequestState,
  type ReviziyaRequest,
} from "@/lib/reviziya-api";
import { BranchCombobox, type BranchOption } from "./branch-combobox";

type Filter = RequestState | "all";

const FILTERS: { id: Filter; label: string; tone: string; icon: typeof Inbox }[] = [
  { id: "pending", label: "Kutilmoqda", tone: "amber", icon: Hourglass },
  { id: "approved", label: "Tasdiqlangan", tone: "emerald", icon: CheckCircle2 },
  { id: "rejected", label: "Rad etilgan", tone: "rose", icon: XCircle },
  { id: "all", label: "Hammasi", tone: "slate", icon: Inbox },
];

const STATE_STYLE: Record<RequestState, { stripe: string; pill: string; label: string }> = {
  pending: { stripe: "bg-amber-400", pill: "bg-amber-100 text-amber-900", label: "Kutilmoqda" },
  approved: { stripe: "bg-emerald-500", pill: "bg-emerald-100 text-emerald-800", label: "Tasdiqlangan" },
  rejected: { stripe: "bg-rose-500", pill: "bg-rose-100 text-rose-800", label: "Rad etilgan" },
};

function todayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function branchTitle(name: string) {
  return displayBranchName(name) || name;
}

export function RequestsPanel({
  branches,
  revizors,
  myId,
  onOpenBranch,
}: {
  branches: BranchOption[];
  revizors: { id: number; fullName: string }[];
  myId: number | null;
  onOpenBranch: (branchId: number) => void;
}) {
  const { toast } = useToast();
  const q = useReviziyaRequests();
  const mut = useReviziyaVisitMutations();
  const [filter, setFilter] = useState<Filter | null>(null);
  const [search, setSearch] = useState("");
  const [approveFor, setApproveFor] = useState<ReviziyaRequest | null>(null);
  const [rejectFor, setRejectFor] = useState<ReviziyaRequest | null>(null);

  const counts = q.data?.counts || { pending: 0, approved: 0, rejected: 0 };
  const canDecide = !!q.data?.canDecide;
  const canCreate = !!q.data?.canCreate;
  const active: Filter = filter ?? (counts.pending > 0 ? "pending" : "all");

  const items = useMemo(() => {
    const all = q.data?.items || [];
    return all.filter(
      (i) =>
        (active === "all" || i.requestState === active) &&
        (!search.trim() ||
          scriptIncludes(i.branchName, search) ||
          scriptIncludes(i.requestedByName || "", search) ||
          scriptIncludes(i.assignedEmployeeName || "", search)),
    );
  }, [q.data, active, search]);

  return (
    <div className="space-y-4">
      <FlowHeader canDecide={canDecide} canCreate={canCreate} pending={counts.pending} />

      {canCreate ? <NewRequestCard branches={branches} /> : null}

      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const n = f.id === "all" ? counts.pending + counts.approved + counts.rejected : counts[f.id];
            const on = active === f.id;
            const Icon = f.icon;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition",
                  on
                    ? f.tone === "amber"
                      ? "bg-amber-500 text-white shadow-sm"
                      : f.tone === "emerald"
                        ? "bg-emerald-600 text-white shadow-sm"
                        : f.tone === "rose"
                          ? "bg-rose-600 text-white shadow-sm"
                          : "bg-slate-800 text-white shadow-sm dark:bg-white dark:text-slate-900"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {f.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[11px] tabular-nums",
                    on ? "bg-white/25" : "bg-background text-foreground/70",
                  )}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 rounded-xl pl-9"
            placeholder="Filial, koordinator yoki revizor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : q.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          Arizalar yuklanmadi.{" "}
          <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>
            Qayta urinish
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState filter={active} canCreate={canCreate} />
      ) : (
        <div className="grid gap-3">
          {items.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              canDecide={canDecide}
              onApprove={() => setApproveFor(r)}
              onReject={() => setRejectFor(r)}
              onOpenBranch={() => onOpenBranch(r.branchId)}
            />
          ))}
        </div>
      )}

      <ApproveDialog
        request={approveFor}
        onClose={() => setApproveFor(null)}
        revizors={revizors}
        myId={myId}
        busy={mut.approveRequest.isPending}
        onSubmit={async (body) => {
          if (!approveFor) return;
          try {
            await mut.approveRequest.mutateAsync({ id: approveFor.id, ...body });
            toast({
              title: "Ariza tasdiqlandi",
              description: `${approveFor.requestedByName || "Koordinator"} va o‘tkazuvchi xodimga xabar yuborildi.`,
            });
            setApproveFor(null);
          } catch (e: any) {
            toast({ title: e?.message || "Xatolik", variant: "destructive" });
          }
        }}
      />

      <RejectDialog
        request={rejectFor}
        onClose={() => setRejectFor(null)}
        busy={mut.rejectRequest.isPending}
        onSubmit={async (reason) => {
          if (!rejectFor) return;
          try {
            await mut.rejectRequest.mutateAsync({ id: rejectFor.id, reason });
            toast({ title: "Ariza rad etildi", description: "Sabab koordinatorga yuborildi." });
            setRejectFor(null);
          } catch (e: any) {
            toast({ title: e?.message || "Xatolik", variant: "destructive" });
          }
        }}
      />
    </div>
  );
}

function FlowHeader({ canDecide, canCreate, pending }: { canDecide: boolean; canCreate: boolean; pending: number }) {
  const steps = [
    { icon: Send, title: "Koordinator ariza yuboradi", hint: "Filial va sabab" },
    { icon: CalendarDays, title: "Bo‘lim boshlig‘i belgilaydi", hint: "Kun, vaqt va kim o‘tkazadi" },
    { icon: UserCheck, title: "Xabar boradi", hint: "Koordinatorga va revizorga" },
  ];
  return (
    <div className="overflow-hidden rounded-3xl border bg-gradient-to-br from-amber-50 via-white to-violet-50 p-4 shadow-sm dark:from-amber-500/10 dark:via-transparent dark:to-violet-500/10 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <FileQuestion className="h-5 w-5 text-amber-600" /> Reviziya arizalari
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {canDecide
              ? "Koordinatorlar reviziya so‘raydi. Siz kun, vaqt va o‘tkazuvchini belgilab tasdiqlaysiz yoki sababini yozib rad etasiz."
              : canCreate
                ? "Filialda reviziya kerak bo‘lsa shu yerdan ariza yuboring. Bo‘lim boshlig‘i kun va revizorni belgilaydi — sizga xabar keladi."
                : "Koordinatorlardan kelgan reviziya arizalari."}
          </p>
        </div>
        {canDecide && pending > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow-sm">
            <Hourglass className="h-3.5 w-3.5" /> {pending} ta ariza javob kutmoqda
          </span>
        ) : null}
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.title} className="flex items-center gap-2.5 rounded-2xl bg-white/80 px-3 py-2.5 ring-1 ring-black/5 dark:bg-white/5 dark:ring-white/10">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold">
                  {i + 1}. {s.title}
                </span>
                <span className="block text-[11px] text-muted-foreground">{s.hint}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function NewRequestCard({ branches }: { branches: BranchOption[] }) {
  const { toast } = useToast();
  const mut = useReviziyaVisitMutations();
  const [branchId, setBranchId] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");

  const submit = async () => {
    try {
      await mut.create.mutateAsync({
        branchId: Number(branchId),
        revisionDate: date || undefined,
        notes: reason.trim(),
      });
      toast({ title: "Ariza yuborildi", description: "Bo‘lim boshlig‘i kun va revizorni belgilagach sizga xabar keladi." });
      setBranchId("");
      setDate("");
      setReason("");
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  const ready = !!branchId && reason.trim().length >= 3;

  return (
    <div className="rounded-3xl border border-amber-200 bg-card p-4 shadow-sm dark:border-amber-500/30 sm:p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Send className="h-4 w-4 text-amber-600" /> Yangi ariza
      </h3>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <label className="block space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Filial</span>
          <BranchCombobox value={branchId} onChange={setBranchId} options={branches} placeholder="Filialni yozib qidiring" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Taklif etilgan kun (ixtiyoriy)</span>
          <Input type="date" className="h-11 rounded-xl" min={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block space-y-1.5 md:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sabab (majburiy)</span>
          <textarea
            className="min-h-20 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-amber-500/30"
            placeholder="Nima uchun reviziya kerak: kassada kamomad shubhasi, mudir almashdi, tovar qoldig‘i mos emas…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Ariza bo‘lim boshlig‘iga boradi. Javobi shu ro‘yxatda va xabarnomada ko‘rinadi.</p>
        <Button
          type="button"
          className="h-10 gap-2 rounded-xl bg-amber-600 px-5 text-white hover:bg-amber-700"
          disabled={!ready || mut.create.isPending}
          onClick={() => void submit()}
        >
          {mut.create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Ariza yuborish
        </Button>
      </div>
    </div>
  );
}

function RequestCard({
  r,
  canDecide,
  onApprove,
  onReject,
  onOpenBranch,
}: {
  r: ReviziyaRequest;
  canDecide: boolean;
  onApprove: () => void;
  onReject: () => void;
  onOpenBranch: () => void;
}) {
  const st = STATE_STYLE[r.requestState];
  return (
    <article className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
      <span className={cn("absolute inset-y-0 left-0 w-1.5", st.stripe)} />
      <div className="flex flex-col gap-3 p-4 pl-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onOpenBranch} className="text-left text-base font-semibold hover:underline">
              {branchTitle(r.branchName)}
            </button>
            <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", st.pill)}>{st.label}</span>
            {r.requestState === "approved" && WORKFLOW_STATUS_LABEL[r.workflowStatus] ? (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                Hozir: {WORKFLOW_STATUS_LABEL[r.workflowStatus]}
              </span>
            ) : null}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <UserRound className="h-3.5 w-3.5" /> {r.requestedByName || "Koordinator"}
            </span>
            {r.requestedAt ? (
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" /> {fmtWhen(r.requestedAt)}
              </span>
            ) : null}
            {r.requestState === "pending" && r.revisionDate ? (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" /> Taklif: {formatYmd(r.revisionDate)}
              </span>
            ) : null}
          </p>
          {r.notes ? (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm leading-relaxed text-foreground/90">«{r.notes.trim()}»</p>
          ) : null}

          {r.requestState === "approved" ? (
            <div className="grid gap-2 rounded-xl bg-emerald-50/70 p-3 text-xs ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:ring-emerald-500/20 sm:grid-cols-4">
              <Info label="Kun" value={formatYmd(r.revisionDate)} />
              <Info
                label="Vaqt"
                value={r.scheduledStartTime ? `${r.scheduledStartTime.slice(0, 5)}${r.scheduledEndTime ? `–${r.scheduledEndTime.slice(0, 5)}` : ""}` : "—"}
              />
              <Info label="O‘tkazadi" value={r.assignedEmployeeName || "—"} />
              <Info label="Tasdiqladi" value={r.requestDecidedByName || "—"} sub={fmtWhen(r.requestDecidedAt)} />
            </div>
          ) : null}

          {r.requestState === "rejected" ? (
            <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-900 ring-1 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-500/20">
              <b>Rad etildi{r.requestDecidedByName ? ` — ${r.requestDecidedByName}` : ""}</b>
              {r.requestDecidedAt ? <span className="text-rose-700/80"> · {fmtWhen(r.requestDecidedAt)}</span> : null}
              <p className="mt-0.5">Sabab: {r.requestRejectReason}</p>
            </div>
          ) : null}
        </div>

        {canDecide && r.requestState === "pending" ? (
          <div className="flex shrink-0 gap-2 lg:flex-col lg:items-stretch">
            <Button type="button" className="h-10 gap-2 rounded-xl bg-emerald-600 px-4 text-white hover:bg-emerald-700" onClick={onApprove}>
              <CheckCircle2 className="h-4 w-4" /> Tasdiqlash va belgilash
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 gap-2 rounded-xl border-rose-200 px-4 text-rose-700 hover:bg-rose-50"
              onClick={onReject}
            >
              <Ban className="h-4 w-4" /> Rad etish
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800/70 dark:text-emerald-200/70">{label}</p>
      <p className="truncate text-sm font-semibold text-foreground">{value}</p>
      {sub ? <p className="text-[10px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function EmptyState({ filter, canCreate }: { filter: Filter; canCreate: boolean }) {
  const text =
    filter === "pending"
      ? "Javob kutayotgan ariza yo‘q."
      : filter === "approved"
        ? "Tasdiqlangan ariza hali yo‘q."
        : filter === "rejected"
          ? "Rad etilgan ariza yo‘q."
          : canCreate
            ? "Hali ariza yubormagansiz. Yuqoridagi formadan yuboring."
            : "Hali ariza kelmagan.";
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card px-6 py-10 text-center">
      <Inbox className="h-8 w-8 text-muted-foreground/60" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function ApproveDialog({
  request,
  onClose,
  revizors,
  myId,
  busy,
  onSubmit,
}: {
  request: ReviziyaRequest | null;
  onClose: () => void;
  revizors: { id: number; fullName: string }[];
  myId: number | null;
  busy: boolean;
  onSubmit: (body: {
    revisionDate: string;
    scheduledStartTime: string;
    scheduledEndTime: string;
    assignedEmployeeId: number;
    comment: string;
  }) => void;
}) {
  const [date, setDate] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("14:00");
  const [who, setWho] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [seenId, setSeenId] = useState<number | null>(null);

  if (request && request.id !== seenId) {
    setSeenId(request.id);
    const proposed = request.revisionDate && request.revisionDate >= todayYmd() ? request.revisionDate : todayYmd();
    setDate(proposed);
    setStart("10:00");
    setEnd("14:00");
    setWho(null);
    setComment("");
  }

  const people = [
    ...(myId != null ? [{ id: myId, fullName: "O‘zim (bo‘lim boshlig‘i)" }] : []),
    ...revizors.filter((r) => r.id !== myId),
  ];
  const ready = !!date && who != null;
  const whoName = people.find((p) => p.id === who)?.fullName;

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto rounded-3xl">
        <DialogTitle className="flex items-center gap-2 text-base font-semibold">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Arizani tasdiqlash
        </DialogTitle>
        {request ? (
          <div className="rounded-2xl bg-muted/60 px-3 py-2.5 text-sm">
            <p className="font-semibold">{branchTitle(request.branchName)}</p>
            <p className="text-xs text-muted-foreground">
              {request.requestedByName || "Koordinator"}
              {request.notes ? ` · «${request.notes.trim()}»` : ""}
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="col-span-2 block space-y-1.5 sm:col-span-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kun</span>
            <Input type="date" className="h-11 rounded-xl" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Boshlanish</span>
            <Input type="time" className="h-11 rounded-xl" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tugash</span>
            <Input type="time" className="h-11 rounded-xl" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kim o‘tkazadi</span>
          <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-1">
            {people.map((p) => {
              const on = who === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setWho(p.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                    on
                      ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-500/10"
                      : "border-border hover:border-emerald-300",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                      on ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground/40",
                    )}
                  >
                    {on ? <CheckCircle2 className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0 truncate font-medium">{p.fullName}</span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Koordinatorga izoh (ixtiyoriy)</span>
          <Input
            className="h-11 rounded-xl"
            placeholder="Masalan: mudir joyida bo‘lsin"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>

        <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-900 dark:bg-sky-500/10 dark:text-sky-100">
          Tasdiqlasangiz {request?.requestedByName || "koordinator"}ga kun va vaqt
          {whoName ? `, ${whoName}ga esa vazifa` : " va tanlangan xodimga vazifa"} xabari boradi.
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="rounded-xl" onClick={onClose}>
            Orqaga
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!ready || busy}
            onClick={() =>
              who != null &&
              onSubmit({ revisionDate: date, scheduledStartTime: start, scheduledEndTime: end, assignedEmployeeId: who, comment })
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Tasdiqlash va xabar yuborish
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  request,
  onClose,
  busy,
  onSubmit,
}: {
  request: ReviziyaRequest | null;
  onClose: () => void;
  busy: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [seenId, setSeenId] = useState<number | null>(null);
  if (request && request.id !== seenId) {
    setSeenId(request.id);
    setReason("");
  }
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogTitle className="flex items-center gap-2 text-base font-semibold">
          <Ban className="h-5 w-5 text-rose-600" /> Arizani rad etish
        </DialogTitle>
        <p className="text-xs text-muted-foreground">
          {request ? branchTitle(request.branchName) : ""} · sabab {request?.requestedByName || "koordinator"}ga yuboriladi. Ariza o‘chmaydi, «Rad etilgan»da qoladi.
        </p>
        <textarea
          autoFocus
          className="min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-rose-500/30"
          placeholder="Masalan: shu oy reja to‘liq, keyingi oyga qoldiramiz"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="rounded-xl" onClick={onClose}>
            Orqaga
          </Button>
          <Button
            type="button"
            className="gap-2 rounded-xl bg-rose-600 text-white hover:bg-rose-700"
            disabled={reason.trim().length < 3 || busy}
            onClick={() => onSubmit(reason.trim())}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            Rad etish
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
