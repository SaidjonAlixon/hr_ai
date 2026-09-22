import React, { useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../hooks/use-toast";
import { isHrManager, isDirectorRole, isDeptHeadRole, hasFullPlatformAccess } from "../../lib/roles";
import {
  statusLabel,
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
import { Badge } from "../../components/ui/badge";
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
import { CheckCircle2, Plus, UserPlus, X } from "lucide-react";

function statusBadge(status: string) {
  if (status === "open" || status === "pending_hr" || status === "searching" || status === "approved") {
    return <Badge className="bg-sky-100 text-sky-900 hover:bg-sky-100">Ochiq</Badge>;
  }
  if (status === "found") {
    return <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Topildi</Badge>;
  }
  if (status === "rejected") {
    return <Badge className="bg-rose-100 text-rose-900 hover:bg-rose-100">Rad etilgan</Badge>;
  }
  if (status === "cancelled") {
    return <Badge variant="secondary">Bekor</Badge>;
  }
  return <Badge variant="secondary">{statusLabel(status)}</Badge>;
}

function fmtDt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
  } catch {
    return iso;
  }
}

function NeedCard({
  n,
  isHr,
  canCancelOwn,
  onApprove,
  onReject,
  onCancel,
  busy,
}: {
  n: StaffNeedRequest;
  isHr: boolean;
  canCancelOwn: boolean;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onCancel: (id: number) => void;
  busy: boolean;
}) {
  const open = ["open", "pending_hr", "approved", "searching"].includes(n.status);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-slate-900">{n.branchName}</p>
          <p className="text-sm text-slate-600">
            {n.sourceType === "office" ? (
              <>
                {n.roleDisplay} · <b>×{n.count}</b>
              </>
            ) : (
              <>
                {n.shiftDisplay} · {n.roleDisplay} · <b>×{n.count}</b>
              </>
            )}
          </p>
          {n.neededBy && <p className="text-xs text-amber-800 mt-0.5">Qachon: {n.neededBy}</p>}
          {n.managerName && (
            <p className="text-xs text-slate-500 mt-0.5">Mudir: {n.managerName}</p>
          )}
          {n.coordinatorName && (
            <p className="text-xs text-slate-500">Yuboruvchi: {n.coordinatorName}</p>
          )}
        </div>
        {statusBadge(n.status)}
      </div>

      {n.note && <p className="mt-2 text-sm text-slate-700">{n.note}</p>}
      {n.rejectReason && <p className="mt-2 text-sm text-rose-700">Rad izohi: {n.rejectReason}</p>}

      <div className="mt-3 grid gap-1 text-xs text-slate-500">
        <p>Yuborilgan: {fmtDt(n.createdAt)}</p>
        {n.foundAt && (
          <p>
            Yopilgan: {fmtDt(n.foundAt)}
            {n.foundByName || n.hrApprovedByName
              ? ` · ${n.foundByName || n.hrApprovedByName}`
              : ""}
          </p>
        )}
        {n.rejectedAt && <p>Rad: {fmtDt(n.rejectedAt)}</p>}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {isHr && open && (
          <>
            <Button
              size="sm"
              className="w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto"
              disabled={busy}
              onClick={() => onApprove(n.id)}
            >
              <CheckCircle2 className="mr-1 h-4 w-4" />
              Topildi
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full border-rose-300 text-rose-700 hover:bg-rose-50 sm:w-auto"
              disabled={busy}
              onClick={() => onReject(n.id)}
            >
              <X className="mr-1 h-4 w-4" />
              Rad etish
            </Button>
          </>
        )}
        {canCancelOwn && open && !isHr && (
          <Button size="sm" variant="ghost" className="w-full sm:w-auto" disabled={busy} onClick={() => onCancel(n.id)}>
            Bekor qilish
          </Button>
        )}
      </div>
    </div>
  );
}

export default function XodimKerakPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isCoord = user?.role === "koordinator";
  const isOfficeHead =
    !!user &&
    (isDeptHeadRole(user.role) || hasFullPlatformAccess(user.role)) &&
    !isCoord;
  const isHr = isHrManager(user?.role) || isDirectorRole(user?.role);
  const canCreate = isCoord || isOfficeHead;

  const { data: branches = [], isLoading: loadingBranches } = useStaffNeedBranches(isCoord);
  const { data: openNeeds = [], isLoading: loadingOpen } = useStaffNeeds("open");
  const { data: history = [], isLoading: loadingHist } = useStaffNeeds("history");

  const createMut = useCreateStaffNeed();
  const approveMut = useApproveStaffNeed();
  const rejectMut = useRejectStaffNeed();
  const cancelMut = useCancelStaffNeed();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [branchId, setBranchId] = useState<string>("");
  const [shiftType, setShiftType] = useState("one");
  const [roleNeeded, setRoleNeeded] = useState("farmasevt");
  const [count, setCount] = useState("1");
  const [neededBy, setNeededBy] = useState("");
  const [positionText, setPositionText] = useState("");
  const [note, setNote] = useState("");

  const openList = useMemo(
    () =>
      openNeeds.filter((n) =>
        ["open", "pending_hr", "approved", "searching"].includes(n.status),
      ),
    [openNeeds],
  );

  const busy =
    createMut.isPending ||
    approveMut.isPending ||
    rejectMut.isPending ||
    cancelMut.isPending;

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
            toast({ title: "Ariza ochildi — tizim va botda ko‘rinadi" });
            setDialogOpen(false);
            setBranchId("");
            setNote("");
            setNeededBy("");
            setCount("1");
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
          toast({ title: "Ariza ochildi — tizimda ko‘rinadi" });
          setDialogOpen(false);
          setPositionText("");
          setNote("");
          setNeededBy("");
          setCount("1");
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
        },
        onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <UserPlus className="h-7 w-7 text-sky-700" />
            Xodim kerak
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-xl">
            {isCoord
              ? "Filial → kim kerak → smena → nechta → Yuborish. Ariza darhol ochiladi."
              : isOfficeHead
                ? "Qanday xodim kerakligini yozing, nechtasini tanlang va yuboring."
                : "Zayavkalar: Topildi yoki Rad etish — ikkalasi ham arizani yopadi."}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Yangi so‘rov
          </Button>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-sky-800">
          Zayavkalar ({openList.length})
        </h2>
        {loadingOpen ? (
          <Skeleton className="h-24 w-full" />
        ) : openList.length === 0 ? (
          <p className="text-sm text-slate-500">Hozircha ochiq ariza yo‘q.</p>
        ) : (
          openList.map((n) => (
            <NeedCard
              key={n.id}
              n={n}
              isHr={isHr}
              canCancelOwn={canCreate && n.coordinatorUserId === user?.id}
              busy={busy}
              onApprove={(id) =>
                approveMut.mutate(
                  { id },
                  {
                    onSuccess: () => toast({ title: "Topildi — ariza yopildi" }),
                    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
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
                  onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
                })
              }
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Yopilgan ({history.length})
        </h2>
        {loadingHist ? (
          <Skeleton className="h-16 w-full" />
        ) : history.length === 0 ? (
          <p className="text-sm text-slate-400">Hali yopilgan so‘rov yo‘q.</p>
        ) : (
          history.slice(0, 40).map((n) => (
            <NeedCard
              key={n.id}
              n={n}
              isHr={false}
              canCancelOwn={false}
              busy={false}
              onApprove={() => {}}
              onReject={() => {}}
              onCancel={() => {}}
            />
          ))
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isCoord ? "Yangi so‘rov" : "Yangi so‘rov (ofis)"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {isCoord ? (
              <>
                <div>
                  <label className="text-xs font-medium text-slate-600">1. Filial</label>
                  {loadingBranches ? (
                    <Skeleton className="mt-1 h-10 w-full" />
                  ) : (
                    <Select value={branchId} onValueChange={setBranchId}>
                      <SelectTrigger className="mt-1">
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
                    <label className="text-xs font-medium text-slate-600">2. Kim kerak</label>
                    <Select value={roleNeeded} onValueChange={setRoleNeeded}>
                      <SelectTrigger className="mt-1">
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
                    <label className="text-xs font-medium text-slate-600">3. Smena</label>
                    <Select value={shiftType} onValueChange={setShiftType}>
                      <SelectTrigger className="mt-1">
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
                <label className="text-xs font-medium text-slate-600">1. Qanday xodim?</label>
                <Textarea
                  className="mt-1"
                  rows={3}
                  value={positionText}
                  onChange={(e) => setPositionText(e.target.value)}
                  placeholder="Masalan: IT dasturchi…"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600">
                  {isCoord ? "4. Nechta" : "2. Nechta"}
                </label>
                <Input
                  className="mt-1"
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">
                  {isCoord ? "5. Qachon" : "3. Qachon"}
                </label>
                <Input
                  className="mt-1"
                  value={neededBy}
                  onChange={(e) => setNeededBy(e.target.value)}
                  placeholder="ixtiyoriy"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Izoh (ixtiyoriy)</label>
              <Textarea
                className="mt-1"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="outline" className="w-full" onClick={() => setDialogOpen(false)}>
              Bekor
            </Button>
            <Button
              className="w-full"
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rad etish — izoh majburiy</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={4}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Nima uchun rad etilayotganini yozing…"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectId(null);
                setRejectReason("");
              }}
            >
              Bekor
            </Button>
            <Button disabled={busy || rejectReason.trim().length < 3} onClick={submitReject}>
              Rad etish va yopish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
