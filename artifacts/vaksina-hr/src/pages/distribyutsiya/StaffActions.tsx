import { useState } from "react";
import { Loader2, MessageSquareText, Send, Trash2, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  DISTRIB_STATUS_LABEL,
  STAFF_COMMENT_KIND_LABEL,
  useDistribStaffActions,
  useStaffComments,
  type DistribEmploymentStatus,
  type DistribStaffRow,
  type StaffCommentKind,
} from "@/lib/distribyutsiya-api";

const STATUS_TONE: Record<string, string> = {
  working: "border-emerald-300 bg-emerald-50 text-emerald-800",
  on_leave: "border-amber-300 bg-amber-50 text-amber-900",
  dismissed: "border-rose-300 bg-rose-50 text-rose-800",
};

export const KIND_TONE: Record<StaffCommentKind, string> = {
  note: "bg-slate-100 text-slate-700",
  late: "bg-amber-100 text-amber-900",
  early: "bg-orange-100 text-orange-900",
  warning: "bg-rose-100 text-rose-800",
  praise: "bg-emerald-100 text-emerald-800",
};

function todayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

export function fmtYmd(ymd?: string | null) {
  if (!ymd) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function fmtStamp(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${fmtYmd(d.toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" }))} ${d.toLocaleTimeString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function currentStatus(row: DistribStaffRow): DistribEmploymentStatus {
  if (row.employmentStatus === "on_leave" || row.status === "on_leave") return "on_leave";
  return "working";
}

/** Jadvaldagi holat tanlovi: o‘zgartirish darhol (bo‘shatish — sabab so‘raladi) */
export function StatusSelect({ row, canEdit }: { row: DistribStaffRow; canEdit: boolean }) {
  const { toast } = useToast();
  const actions = useDistribStaffActions();
  const [pending, setPending] = useState<DistribEmploymentStatus | null>(null);
  const value = currentStatus(row);

  if (!canEdit) {
    return (
      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[value])}>
        {DISTRIB_STATUS_LABEL[value]}
      </span>
    );
  }

  return (
    <>
      <select
        value={value}
        disabled={actions.setStatus.isPending}
        onChange={(e) => setPending(e.target.value as DistribEmploymentStatus)}
        className={cn("h-8 rounded-lg border px-2 text-xs font-semibold", STATUS_TONE[value])}
        aria-label="Holat"
      >
        {(Object.keys(DISTRIB_STATUS_LABEL) as DistribEmploymentStatus[]).map((s) => (
          <option key={s} value={s}>
            {DISTRIB_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {pending && pending !== value ? (
        <ReasonDialog
          title={pending === "dismissed" ? `${row.fullName} — ishdan bo‘shatish` : `Holat: ${DISTRIB_STATUS_LABEL[pending]}`}
          description={
            pending === "dismissed"
              ? "Login va parol bekor bo‘ladi, xodim ro‘yxatdan chiqib «Bo‘shatilganlar» arxiviga o‘tadi."
              : "Xodimga bildirishnoma boradi va izohlar tarixiga yoziladi."
          }
          required={pending === "dismissed"}
          confirmLabel={pending === "dismissed" ? "Bo‘shatish" : "Saqlash"}
          destructive={pending === "dismissed"}
          busy={actions.setStatus.isPending}
          onClose={() => setPending(null)}
          onConfirm={(reason) =>
            actions.setStatus.mutate(
              { userId: row.userId, status: pending, reason },
              {
                onSuccess: (d) => {
                  toast({ title: d.message });
                  setPending(null);
                },
                onError: (e: Error) => toast({ title: "Saqlanmadi", description: e.message, variant: "destructive" }),
              },
            )
          }
        />
      ) : null}
    </>
  );
}

export function RemoveStaffButton({ row }: { row: DistribStaffRow }) {
  const { toast } = useToast();
  const actions = useDistribStaffActions();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
        title="O‘chirish"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      {open ? (
        <ReasonDialog
          title={`${row.fullName} — o‘chirish`}
          description="Xodim to‘liq o‘chiriladi: login, parol, sessiyalar, yuz va barmoq izi o‘chadi, hech qayerda ko‘rinmaydi. Faqat «Bo‘shatilganlar» arxivida sabab bilan yozuv qoladi."
          required
          confirmLabel="To‘liq o‘chirish"
          destructive
          busy={actions.removeStaff.isPending}
          onClose={() => setOpen(false)}
          onConfirm={(reason) =>
            actions.removeStaff.mutate(
              { userId: row.userId, reason },
              {
                onSuccess: (d) => {
                  toast({ title: d.message });
                  setOpen(false);
                },
                onError: (e: Error) => toast({ title: "O‘chirilmadi", description: e.message, variant: "destructive" }),
              },
            )
          }
        />
      ) : null}
    </>
  );
}

function ReasonDialog({
  title,
  description,
  required,
  confirmLabel,
  destructive,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  required?: boolean;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const ok = !required || reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {destructive ? <UserX className="h-4 w-4 text-rose-600" /> : null}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs">Sabab{required ? " *" : " (ixtiyoriy)"}</Label>
          <Textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Masalan: o‘z xohishi bilan ketdi"
            className="mt-1 min-h-[80px]"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!ok || busy}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Izoh yozish formasi — jadvaldan ham, kechikish ro‘yxatidan ham ishlatiladi */
export function CommentForm({
  userId,
  defaultKind = "note",
  defaultDate,
  compact,
  onDone,
}: {
  userId: number;
  defaultKind?: StaffCommentKind;
  defaultDate?: string;
  compact?: boolean;
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const actions = useDistribStaffActions();
  const [kind, setKind] = useState<StaffCommentKind>(defaultKind);
  const [date, setDate] = useState(defaultDate || todayYmd());
  const [text, setText] = useState("");
  const [notify, setNotify] = useState(false);

  const submit = () => {
    if (text.trim().length < 2) return;
    actions.addComment.mutate(
      { userId, text: text.trim(), kind, relatedDate: date, notify },
      {
        onSuccess: () => {
          toast({ title: "Izoh saqlandi", description: notify ? "Xodimga ham yuborildi" : undefined });
          setText("");
          onDone?.();
        },
        onError: (e: Error) => toast({ title: "Saqlanmadi", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <div className={cn("space-y-2", !compact && "rounded-xl border bg-muted/30 p-3")}>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(STAFF_COMMENT_KIND_LABEL) as StaffCommentKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
              kind === k ? cn(KIND_TONE[k], "border-transparent ring-1 ring-current") : "hover:bg-muted",
            )}
          >
            {STAFF_COMMENT_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Izoh: sababi, kelishuv, ogohlantirish…"
        className="min-h-[64px] bg-background"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Sana
            <Input type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)} className="h-8 w-[140px] text-xs" />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Xodimga ham yuborilsin
          </label>
        </div>
        <Button size="sm" className="h-8 gap-1.5" disabled={text.trim().length < 2 || actions.addComment.isPending} onClick={submit}>
          {actions.addComment.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Saqlash
        </Button>
      </div>
    </div>
  );
}

export function CommentsButton({ row, canWrite }: { row: DistribStaffRow; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const count = row.commentCount || 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={row.lastComment ? `${row.lastComment.authorName || ""}: ${row.lastComment.text}` : "Izohlar"}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition hover:border-primary/40 hover:bg-primary/5",
          count ? "border-primary/30 text-primary" : "text-muted-foreground",
        )}
      >
        <MessageSquareText className="h-3.5 w-3.5" />
        {count ? `${count} ta` : canWrite ? "Yozish" : "—"}
      </button>
      {open ? <CommentsSheet userId={row.userId} fullName={row.fullName} canWrite={canWrite} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function CommentsSheet({
  userId,
  fullName,
  canWrite,
  onClose,
}: {
  userId: number;
  fullName: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const q = useStaffComments(userId);
  const actions = useDistribStaffActions();
  const items = q.data?.items || [];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{fullName}</SheetTitle>
          <SheetDescription>HR izohlari: kech kelish, erta ketish, ogohlantirish va boshqalar</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {canWrite ? <CommentForm userId={userId} /> : null}
          {q.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yuklanmoqda…
            </div>
          ) : !items.length ? (
            <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Hali izoh yo‘q</p>
          ) : (
            <ul className="space-y-2">
              {items.map((c) => (
                <li key={c.id} className="rounded-xl border bg-background p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", KIND_TONE[c.kind] || KIND_TONE.note)}>
                      {STAFF_COMMENT_KIND_LABEL[c.kind] || c.kind}
                      {c.relatedDate ? ` · ${fmtYmd(c.relatedDate)}` : ""}
                    </span>
                    {c.canDelete ? (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-rose-600"
                        title="O‘chirish"
                        onClick={() =>
                          actions.deleteComment.mutate(c.id, {
                            onSuccess: () => toast({ title: "Izoh o‘chirildi" }),
                            onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{c.text}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {c.authorName || "—"} · {fmtStamp(c.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
