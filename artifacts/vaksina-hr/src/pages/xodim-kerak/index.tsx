import React, { useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../hooks/use-toast";
import {
  isHrManager,
  isDirectorRole,
  isDeptHeadRole,
  hasFullPlatformAccess,
  isHrRole,
} from "../../lib/roles";
import {
  useApproveStaffNeed,
  useCancelStaffNeed,
  useCreateStaffNeed,
  useRejectStaffNeed,
  useStaffNeedBranches,
  useStaffNeeds,
  type StaffNeedRequest,
} from "../../lib/staff-needs-api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  Inbox,
  MapPin,
  Plus,
  Send,
  User,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";

type TabId = "searching" | "found" | "rejected";

function fmtDt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("uz-UZ", {
      timeZone: "Asia/Tashkent",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtNeededBy(value: string | null | undefined) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    try {
      return new Date(`${value}T12:00:00`).toLocaleDateString("uz-UZ", {
        timeZone: "Asia/Tashkent",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    } catch {
      return value;
    }
  }
  return value;
}

function isAsosiyOfisName(name?: string | null) {
  const s = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/['‘’`]/g, "'");
  return (
    s === "asosiy ofis" ||
    s === "ofis / bo'lim" ||
    s === "ofis / bolim" ||
    s.includes("asosiy ofis") ||
    s === "ofis"
  );
}

function displayBranchTitle(n: { branchName: string; sourceType?: string; branchLocation?: string | null }) {
  if (n.sourceType === "office" || isAsosiyOfisName(n.branchName) || isAsosiyOfisName(n.branchLocation)) {
    return "ASOSIY OFIS";
  }
  return n.branchName;
}

function statusMeta(status: string) {
  if (["open", "pending_hr", "searching", "approved"].includes(status)) {
    return {
      label: "Ochiq ariza",
      className: "bg-sky-500/15 text-sky-800 ring-sky-500/25 dark:text-sky-200",
    };
  }
  if (status === "found") {
    return {
      label: "Topildi",
      className: "bg-emerald-500/15 text-emerald-800 ring-emerald-500/25 dark:text-emerald-200",
    };
  }
  if (status === "rejected") {
    return {
      label: "Rad etilgan",
      className: "bg-rose-500/15 text-rose-800 ring-rose-500/25 dark:text-rose-200",
    };
  }
  return { label: status, className: "bg-muted text-muted-foreground ring-border" };
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <p className="min-w-0 leading-snug">
        <span className="font-medium text-foreground/70">{label}: </span>
        <span className="text-foreground">{value}</span>
      </p>
    </div>
  );
}

function NeedCard({
  n,
  index,
  isHr,
  canCancelOwn,
  onApprove,
  onReject,
  onCancel,
  busy,
}: {
  n: StaffNeedRequest;
  index: number;
  isHr: boolean;
  canCancelOwn: boolean;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onCancel: (id: number) => void;
  busy: boolean;
}) {
  const open = ["open", "pending_hr", "approved", "searching"].includes(n.status);
  const st = statusMeta(n.status);
  const accent =
    n.status === "found"
      ? "border-l-emerald-500"
      : n.status === "rejected"
        ? "border-l-rose-500"
        : "border-l-sky-500";
  const maps = n.googleMapsUrl || n.yandexMapsUrl;

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-sm border-l-[3px]",
        accent,
      )}
    >
      <div className="space-y-3.5 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary">
              {index}
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
                {displayBranchTitle(n)}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {n.sourceType === "office" || isAsosiyOfisName(n.branchName) || isAsosiyOfisName(n.branchLocation)
                  ? "ASOSIY OFIS"
                  : "Apteka filiali"}{" "}
                · #{n.id}
              </p>
            </div>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
              st.className,
            )}
          >
            {n.statusLabel || st.label}
          </span>
        </div>

        <div className="space-y-2 rounded-xl bg-muted/40 px-3 py-3">
          <InfoRow
            icon={<Building2 className="h-3.5 w-3.5" />}
            label="Filial"
            value={displayBranchTitle(n)}
          />
          <InfoRow
            icon={<MapPin className="h-3.5 w-3.5" />}
            label="Tuman"
            value={
              n.sourceType === "office" || isAsosiyOfisName(n.branchName)
                ? "ASOSIY OFIS"
                : n.district || "—"
            }
          />
          <InfoRow
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Smena"
            value={n.shiftDisplay || "—"}
          />
          <InfoRow
            icon={<User className="h-3.5 w-3.5" />}
            label="Lavozim"
            value={n.roleDisplay}
          />
          <InfoRow
            icon={<Users className="h-3.5 w-3.5" />}
            label="Xodim"
            value={`${n.roleDisplay} ×${n.count}`}
          />
          <InfoRow
            icon={<Send className="h-3.5 w-3.5" />}
            label="Holat"
            value={n.statusLabel || st.label}
          />
          {n.neededBy ? (
            <InfoRow
              icon={<CalendarDays className="h-3.5 w-3.5" />}
              label="Qachon"
              value={fmtNeededBy(n.neededBy)}
            />
          ) : null}
          {n.managerName ? (
            <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Mudir" value={n.managerName} />
          ) : null}
          {n.coordinatorName ? (
            <InfoRow
              icon={<UserPlus className="h-3.5 w-3.5" />}
              label="Yuboruvchi"
              value={n.coordinatorName}
            />
          ) : null}
        </div>

        {n.note ? (
          <div className="rounded-xl border border-border bg-card px-3 py-2 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Izoh
            </p>
            <p className="mt-0.5 leading-snug text-foreground">{n.note}</p>
          </div>
        ) : null}

        {n.rejectReason ? (
          <div className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
              Rad izohi
            </p>
            <p className="mt-0.5 leading-snug">{n.rejectReason}</p>
          </div>
        ) : null}

        {maps ? (
          <div className="flex flex-wrap gap-2">
            {n.googleMapsUrl ? (
              <a
                href={n.googleMapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary hover:bg-muted"
              >
                <MapPin className="h-3.5 w-3.5" />
                Google Maps
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            ) : null}
            {n.yandexMapsUrl ? (
              <a
                href={n.yandexMapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-primary hover:bg-muted"
              >
                <MapPin className="h-3.5 w-3.5" />
                Yandex Maps
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-1 text-xs text-muted-foreground">
          <p>Yuborilgan: {fmtDt(n.createdAt)}</p>
          {n.foundAt ? (
            <p className="text-emerald-700 dark:text-emerald-300">
              Yopilgan: {fmtDt(n.foundAt)}
              {n.foundByName || n.hrApprovedByName
                ? ` · ${n.foundByName || n.hrApprovedByName}`
                : ""}
            </p>
          ) : null}
          {n.rejectedAt ? (
            <p className="text-rose-700 dark:text-rose-300">Rad: {fmtDt(n.rejectedAt)}</p>
          ) : null}
        </div>

        {(isHr && open) || (canCancelOwn && open && !isHr) ? (
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3 sm:flex sm:flex-wrap">
            {isHr && open ? (
              <>
                <Button
                  size="sm"
                  className="w-full gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
                  disabled={busy}
                  onClick={() => onApprove(n.id)}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Topildi
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 rounded-xl border-rose-300 text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 sm:w-auto"
                  disabled={busy}
                  onClick={() => onReject(n.id)}
                >
                  <X className="h-4 w-4" />
                  Rad etish
                </Button>
              </>
            ) : null}
            {canCancelOwn && open && !isHr ? (
              <Button
                size="sm"
                variant="outline"
                className="col-span-2 w-full gap-1.5 rounded-xl border-amber-400/60 bg-amber-500/10 font-semibold text-amber-900 hover:bg-amber-500/20 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-950/50 sm:col-span-1 sm:w-auto"
                disabled={busy}
                onClick={() => onCancel(n.id)}
              >
                <X className="h-4 w-4" />
                Bekor qilish
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Inbox className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function XodimKerakPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isCoord = user?.role === "koordinator";
  const isRecruiter = user?.role === "recruiter";
  const isOfficeHead =
    !!user &&
    (isDeptHeadRole(user.role) || hasFullPlatformAccess(user.role)) &&
    !isCoord;
  const isHr =
    isHrRole(user?.role) ||
    hasFullPlatformAccess(user?.role) ||
    isDirectorRole(user?.role);
  const canCreate = isCoord || isOfficeHead;
  const canView =
    canCreate ||
    isHr ||
    isRecruiter ||
    isHrManager(user?.role);

  const [tab, setTab] = useState<TabId>("searching");

  const { data: branches = [], isLoading: loadingBranches } = useStaffNeedBranches(isCoord);
  const { data: searching = [], isLoading: loadingSearch } = useStaffNeeds("open", {
    enabled: canView && tab === "searching",
  });
  const { data: found = [], isLoading: loadingFound } = useStaffNeeds("found", {
    enabled: canView && tab === "found",
  });
  const { data: rejected = [], isLoading: loadingRejected } = useStaffNeeds("rejected", {
    enabled: canView && tab === "rejected",
  });

  // Badge counts — parallel light fetches
  const { data: openCountList = [] } = useStaffNeeds("open", { enabled: canView });
  const { data: foundCountList = [] } = useStaffNeeds("found", { enabled: canView });
  const { data: rejectedCountList = [] } = useStaffNeeds("rejected", { enabled: canView });

  const createMut = useCreateStaffNeed();
  const approveMut = useApproveStaffNeed();
  const rejectMut = useRejectStaffNeed();
  const cancelMut = useCancelStaffNeed();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [branchId, setBranchId] = useState("");
  const [shiftType, setShiftType] = useState("one");
  const [roleNeeded, setRoleNeeded] = useState("farmasevt");
  const [count, setCount] = useState("1");
  const [neededBy, setNeededBy] = useState("");
  const [positionText, setPositionText] = useState("");
  const [note, setNote] = useState("");

  const list = useMemo(() => {
    if (tab === "found") return found;
    if (tab === "rejected") return rejected;
    return searching.filter((n) =>
      ["open", "pending_hr", "approved", "searching"].includes(n.status),
    );
  }, [tab, searching, found, rejected]);

  const loading =
    tab === "searching" ? loadingSearch : tab === "found" ? loadingFound : loadingRejected;

  const busy =
    createMut.isPending ||
    approveMut.isPending ||
    rejectMut.isPending ||
    cancelMut.isPending;

  const tabs: { id: TabId; label: string; count: number }[] = [
    {
      id: "searching",
      label: "Qidirilmoqda",
      count: openCountList.filter((n) =>
        ["open", "pending_hr", "approved", "searching"].includes(n.status),
      ).length,
    },
    { id: "found", label: "Topilgan", count: foundCountList.length },
    { id: "rejected", label: "Rad etilgan", count: rejectedCountList.length },
  ];

  if (!canView) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-sm text-destructive">
        Bu bo‘limga ruxsat yo‘q.
      </div>
    );
  }

  const submit = () => {
    const cnt = Math.max(1, Math.min(20, parseInt(count, 10) || 1));
    if (isCoord) {
      const managerEmployeeId = parseInt(branchId, 10);
      if (!Number.isFinite(managerEmployeeId)) {
        toast({ title: "Filial tanlang", variant: "destructive" });
        return;
      }
      createMut.mutate(
        {
          managerEmployeeId,
          shiftType,
          roleNeeded,
          count: cnt,
          neededBy: neededBy.trim() || undefined,
          note: note.trim() || undefined,
        },
        {
          onSuccess: () => {
            toast({ title: "Ariza ochildi — HR va botga yuborildi" });
            setDialogOpen(false);
            setBranchId("");
            setNote("");
            setNeededBy("");
            setCount("1");
            setTab("searching");
          },
          onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
        },
      );
      return;
    }

    if (positionText.trim().length < 3) {
      toast({ title: "Qanday xodim kerakligini yozing", variant: "destructive" });
      return;
    }
    createMut.mutate(
      {
        positionText: positionText.trim(),
        count: cnt,
        neededBy: neededBy.trim() || undefined,
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: "Ariza ochildi — HR va botga yuborildi" });
          setDialogOpen(false);
          setPositionText("");
          setNote("");
          setNeededBy("");
          setCount("1");
          setTab("searching");
        },
        onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
      },
    );
  };

  const submitReject = () => {
    if (rejectId == null) return;
    if (rejectReason.trim().length < 3) {
      toast({ title: "Rad izohi majburiy", variant: "destructive" });
      return;
    }
    rejectMut.mutate(
      { id: rejectId, reason: rejectReason.trim() },
      {
        onSuccess: () => {
          toast({ title: "Rad etildi — ariza yopildi" });
          setRejectId(null);
          setRejectReason("");
          setTab("rejected");
        },
        onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-3 py-4 pb-28 sm:space-y-6 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <UserPlus className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Xodim kerak
            </h1>
            <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
              {isRecruiter
                ? "Ochiq, topilgan va rad etilgan arizalar — botdagi bilan bir xil ma’lumot."
                : isHr
                  ? "Topildi / Rad etish — ikkalasi arizani yopadi. Har bir yangi ariza botga ham boradi."
                  : canCreate
                    ? "Filial, kim, smena, son — yuboring. Ariza darhol ochiladi."
                    : "Xodim ehtiyojlari."}
            </p>
          </div>
        </div>
        {canCreate ? (
          <Button
            className="w-full shrink-0 gap-1.5 rounded-xl sm:w-auto"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Yangi so‘rov
          </Button>
        ) : null}
      </header>

      <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:overflow-visible sm:px-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max gap-1 rounded-2xl border border-border bg-muted/30 p-1 sm:min-w-0 sm:w-full">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition sm:min-w-0 sm:flex-1 sm:justify-center",
                tab === t.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="whitespace-nowrap">{t.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                  tab === t.id ? "bg-white/20" : "bg-muted text-muted-foreground",
                )}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <section className="space-y-3">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            title={
              tab === "searching"
                ? "Qidirilayotgan ariza yo‘q"
                : tab === "found"
                  ? "Topilgan yo‘q"
                  : "Rad etilgan yo‘q"
            }
            hint="Birinchi yuborilgan yuqorida, oxirgisi pastida."
          />
        ) : (
          <div className="space-y-3">
            {list.map((n, i) => (
              <NeedCard
                key={n.id}
                n={n}
                index={i + 1}
                isHr={isHr}
                canCancelOwn={canCreate && n.coordinatorUserId === user?.id}
                busy={busy}
                onApprove={(id) =>
                  approveMut.mutate(
                    { id },
                    {
                      onSuccess: () => {
                        toast({ title: "Topildi — ariza yopildi" });
                        setTab("found");
                      },
                      onError: (e: Error) =>
                        toast({ title: e.message, variant: "destructive" }),
                    },
                  )
                }
                onReject={(id) => {
                  setRejectId(id);
                  setRejectReason("");
                }}
                onCancel={(id) =>
                  cancelMut.mutate(id, {
                    onSuccess: () => toast({ title: "Bekor qilindi" }),
                    onError: (e: Error) =>
                      toast({ title: e.message, variant: "destructive" }),
                  })
                }
              />
            ))}
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              {isCoord ? "Yangi so‘rov" : "Yangi so‘rov — ASOSIY OFIS"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5 py-1">
            {isCoord ? (
              <>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">1. Filial</label>
                  {loadingBranches ? (
                    <Skeleton className="mt-1.5 h-10 w-full rounded-xl" />
                  ) : (
                    <Select value={branchId} onValueChange={setBranchId}>
                      <SelectTrigger className="mt-1.5 rounded-xl">
                        <SelectValue placeholder="Tanlang…" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={String(b.id)}>
                            {b.branchLocation}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">2. Kim</label>
                    <Select value={roleNeeded} onValueChange={setRoleNeeded}>
                      <SelectTrigger className="mt-1.5 rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mudir">Mudir</SelectItem>
                        <SelectItem value="farmasevt">Farmasevt</SelectItem>
                        <SelectItem value="stajyor">Stajyor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground">3. Smena</label>
                    <Select value={shiftType} onValueChange={setShiftType}>
                      <SelectTrigger className="mt-1.5 rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="one">1-smena</SelectItem>
                        <SelectItem value="two">2-smena</SelectItem>
                        <SelectItem value="three">3-smena</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="text-xs font-semibold text-muted-foreground">1. Qanday xodim?</label>
                <Textarea
                  className="mt-1.5 rounded-xl"
                  rows={3}
                  value={positionText}
                  onChange={(e) => setPositionText(e.target.value)}
                  placeholder="Masalan: IT dasturchi…"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">
                  {isCoord ? "4. Nechta" : "2. Nechta"}
                </label>
                <Input
                  className="mt-1.5 rounded-xl"
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">
                  {isCoord ? "5. Qachon" : "3. Qachon"}
                </label>
                <Input
                  className="mt-1.5 rounded-xl"
                  type="date"
                  value={neededBy}
                  min={new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" })}
                  onChange={(e) => setNeededBy(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Izoh (ixtiyoriy)</label>
              <Textarea
                className="mt-1.5 rounded-xl"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              variant="outline"
              className="w-full rounded-xl"
              onClick={() => setDialogOpen(false)}
            >
              Bekor
            </Button>
            <Button
              className="w-full rounded-xl"
              disabled={busy || (isCoord ? !branchId : positionText.trim().length < 3)}
              onClick={submit}
            >
              Yuborish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rejectId != null}
        onOpenChange={(o) => {
          if (!o) {
            setRejectId(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rad etish</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Izoh majburiy — ariza yopiladi.</p>
          <Textarea
            className="rounded-xl"
            rows={4}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Nima uchun rad etilayotganini yozing…"
          />
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              variant="outline"
              className="w-full rounded-xl"
              onClick={() => {
                setRejectId(null);
                setRejectReason("");
              }}
            >
              Bekor
            </Button>
            <Button
              className="w-full rounded-xl bg-rose-600 hover:bg-rose-700"
              disabled={busy || rejectReason.trim().length < 3}
              onClick={submitReject}
            >
              Rad etish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
