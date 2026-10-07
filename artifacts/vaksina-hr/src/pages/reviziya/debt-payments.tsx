import React, { useRef, useState } from "react";
import {
  ArrowRight,
  Ban,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  Paperclip,
  Plus,
  ReceiptText,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fileToAttachment } from "@/lib/vazifalar-api";
import { formatYmd, moneySoum } from "@/lib/reviziya-cycle";
import {
  PAYMENT_METHOD_LABEL,
  useReviziyaVisitMutations,
  type PaymentMethod,
  type VisitPayment,
} from "@/lib/reviziya-api";
import { formatSomInput } from "./conduct-form";

function todayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

function fmtStamp(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
  const time = d.toLocaleTimeString("uz-UZ", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" });
  return `${formatYmd(date)} ${time}`;
}

export function collectState(shortage: number, collected: number) {
  if (shortage <= 0) return { key: "none", label: "Kamomad yo‘q", tone: "bg-emerald-100 text-emerald-800" };
  if (collected >= shortage) return { key: "full", label: "To‘liq undirildi", tone: "bg-emerald-100 text-emerald-800" };
  if (collected > 0) return { key: "partial", label: "Qisman undirildi", tone: "bg-amber-100 text-amber-900" };
  return { key: "unpaid", label: "Undirilmagan", tone: "bg-rose-100 text-rose-800" };
}

const METHODS: PaymentMethod[] = ["cash", "card", "transfer", "salary", "other"];

export function DebtPayments({
  visit,
  canRecord,
  compact,
}: {
  visit: any;
  canRecord: boolean;
  compact?: boolean;
}) {
  const shortage = Number(visit?.shortageAmount || 0);
  const collected = Number(visit?.collectedAmount || 0);
  const remaining = Number(visit?.remainingAmount || 0);
  const initial = Number(visit?.initialCollected ?? collected);
  const payments: VisitPayment[] = visit?.payments || [];
  const [addOpen, setAddOpen] = useState(false);
  const [voidFor, setVoidFor] = useState<VisitPayment | null>(null);

  if (shortage <= 0) return null;
  const canAdd = canRecord && visit?.workflowStatus === "COMPLETED" && remaining > 0;
  const activeCount = payments.filter((p) => !p.voidedAt).length;

  return (
    <div className={cn("rounded-xl border", compact ? "bg-background/60" : "bg-card")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <ReceiptText className="h-3.5 w-3.5 text-violet-600" />
          Undirish tarixi
          <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{activeCount + (initial > 0 ? 1 : 0)}</span>
        </p>
        {canAdd ? (
          <Button size="sm" className="h-8 gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> To‘lov kiritish
          </Button>
        ) : remaining <= 0 ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Qarz yopilgan
          </span>
        ) : null}
      </div>

      <ol className="divide-y">
        <li className="flex items-start gap-3 px-3 py-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700">
            <ShieldCheck className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground">
              Reviziya kuni: kamomad <b className="tabular-nums text-rose-700">{moneySoum(shortage)}</b>
              {initial > 0 ? (
                <>
                  , joyida undirildi <b className="tabular-nums text-emerald-700">{moneySoum(initial)}</b>
                </>
              ) : null}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {formatYmd(visit?.revisionDate)} · {visit?.assignedEmployeeName || "Revizor"} · qoldiq{" "}
              <b className="tabular-nums text-foreground">{moneySoum(Math.max(0, shortage - initial))}</b>
            </p>
          </div>
        </li>
        {payments.map((p) => {
          const voided = !!p.voidedAt;
          return (
            <li key={p.id} className={cn("flex items-start gap-3 px-3 py-2.5", voided && "bg-muted/30")}>
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  voided ? "bg-slate-200 text-slate-500" : "bg-emerald-100 text-emerald-700",
                )}
              >
                {voided ? <Ban className="h-3.5 w-3.5" /> : <CircleDollarSign className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-2">
                  <p className={cn("text-[13px] font-semibold tabular-nums", voided ? "text-muted-foreground line-through" : "text-emerald-700")}>
                    +{moneySoum(p.amount)}
                    <span className="ml-1.5 text-[11px] font-medium text-muted-foreground no-underline">
                      {PAYMENT_METHOD_LABEL[p.method] || p.method}
                    </span>
                  </p>
                  {voided ? (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Bekor qilingan</span>
                  ) : p.remainingAfter != null ? (
                    <span className="text-[11px] text-muted-foreground">
                      Qoldiq{" "}
                      <b className={cn("tabular-nums", p.remainingAfter > 0 ? "text-amber-700" : "text-emerald-700")}>
                        {p.remainingAfter > 0 ? moneySoum(p.remainingAfter) : "0 — yopildi"}
                      </b>
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" /> To‘langan: <b className="text-foreground">{formatYmd(p.paidAt)}</b>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <UserRound className="h-3 w-3" /> Kiritdi: <b className="text-foreground">{p.createdByName || "—"}</b>
                    {p.createdAt ? ` · ${fmtStamp(p.createdAt)}` : ""}
                  </span>
                  {p.receiptUrl ? (
                    <a
                      href={p.receiptUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-medium text-violet-700 hover:underline"
                    >
                      <Paperclip className="h-3 w-3" /> Kvitansiya
                    </a>
                  ) : null}
                </p>
                {p.note ? <p className="mt-1 text-xs text-foreground/90">{p.note}</p> : null}
                {voided ? (
                  <p className="mt-1 text-[11px] text-rose-700">
                    Bekor qildi: {p.voidedByName || "—"}
                    {p.voidedAt ? ` · ${fmtStamp(p.voidedAt)}` : ""}. Sabab: {p.voidReason}
                  </p>
                ) : canRecord ? (
                  <button
                    type="button"
                    onClick={() => setVoidFor(p)}
                    className="mt-1 text-[11px] font-medium text-rose-600 hover:underline"
                  >
                    Xato kiritilgan — bekor qilish
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
        {!payments.length && remaining > 0 && !canAdd ? (
          <li className="px-3 py-2.5 text-[11px] text-muted-foreground">Reviziyadan keyin hali to‘lov kiritilmagan.</li>
        ) : null}
        {canAdd ? (
          <li className="px-3 py-3">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/60 px-3 py-2.5 text-left transition hover:border-emerald-500 hover:bg-emerald-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                <Plus className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-emerald-900">Undirilgan summani kiritish</span>
                <span className="block text-[11px] text-emerald-800/80">
                  Qolgan qarz {moneySoum(remaining)} — qancha to‘langan bo‘lsa kiriting, natija avtomatik yangilanadi
                </span>
              </span>
            </button>
          </li>
        ) : null}
      </ol>

      {addOpen ? (
        <AddPaymentDialog visit={visit} remaining={remaining} collected={collected} shortage={shortage} onClose={() => setAddOpen(false)} />
      ) : null}
      {voidFor ? <VoidPaymentDialog payment={voidFor} onClose={() => setVoidFor(null)} /> : null}
    </div>
  );
}

function AddPaymentDialog({
  visit,
  remaining,
  collected,
  shortage,
  onClose,
}: {
  visit: any;
  remaining: number;
  collected: number;
  shortage: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const mut = useReviziyaVisitMutations();
  const today = todayYmd();
  const [amountText, setAmountText] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const amount = Number(amountText.replace(/\s/g, "")) || 0;
  const tooMuch = amount > remaining;
  const minDate = String(visit?.revisionDate || "").slice(0, 10) || undefined;
  const dateBad = !paidAt || paidAt > today || (!!minDate && paidAt < minDate);
  const valid = amount > 0 && !tooMuch && !dateBad;
  const nextCollected = collected + (tooMuch ? 0 : amount);
  const nextRemaining = Math.max(0, shortage - nextCollected);
  const nextState = collectState(shortage, nextCollected);
  const pctNow = shortage ? Math.round((collected / shortage) * 100) : 0;
  const pctNext = shortage ? Math.min(100, Math.round((nextCollected / shortage) * 100)) : 0;

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const att = await fileToAttachment(file);
      setReceiptUrl(att.url);
    } catch (e: any) {
      toast({ title: e?.message || "Fayl yuklanmadi", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!valid) return;
    try {
      await mut.addPayment.mutateAsync({
        id: Number(visit.id),
        amount,
        paidAt,
        method,
        note: note.trim() || null,
        receiptUrl: receiptUrl || null,
      });
      toast({
        title: nextRemaining > 0 ? `${moneySoum(amount)} kiritildi` : "Qarz to‘liq yopildi",
        description: nextRemaining > 0 ? `Qolgan qarz: ${moneySoum(nextRemaining)}` : "Mudir, koordinator va revizorga xabar yuborildi.",
      });
      onClose();
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  const quick = [
    { label: "Qolgan hammasi", value: remaining },
    ...(remaining >= 2 ? [{ label: "Yarmi", value: Math.round(remaining / 2) }] : []),
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Undirilgan summani kiritish</DialogTitle>
          <DialogDescription>
            Qarz qancha to‘langan bo‘lsa, shuni kiriting — undirilgan summa, qolgan qarz va holat avtomatik yangilanadi.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-rose-50 p-2.5">
            <p className="text-[10px] font-semibold uppercase text-rose-700/80">Kamomad</p>
            <p className="text-sm font-bold tabular-nums text-rose-900">{moneySoum(shortage)}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-2.5">
            <p className="text-[10px] font-semibold uppercase text-emerald-700/80">Undirilgan</p>
            <p className="text-sm font-bold tabular-nums text-emerald-900">{moneySoum(collected)}</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-2.5">
            <p className="text-[10px] font-semibold uppercase text-amber-700/80">Qolgan qarz</p>
            <p className="text-sm font-bold tabular-nums text-amber-900">{moneySoum(remaining)}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">To‘langan summa (so‘m) *</Label>
            <Input
              autoFocus
              inputMode="numeric"
              value={amountText}
              onChange={(e) => setAmountText(formatSomInput(e.target.value))}
              placeholder="Masalan: 500 000"
              className={cn("mt-1 h-11 text-base font-semibold tabular-nums", tooMuch && "border-rose-400 ring-1 ring-rose-300")}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {quick.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setAmountText(formatSomInput(String(q.value)))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition hover:border-emerald-400 hover:bg-emerald-50",
                    amount === q.value && "border-emerald-500 bg-emerald-50 text-emerald-800",
                  )}
                >
                  {q.label}: {moneySoum(q.value)}
                </button>
              ))}
            </div>
            {tooMuch ? (
              <p className="mt-1 text-[11px] font-medium text-rose-600">Summa qolgan qarzdan ({moneySoum(remaining)}) oshmasin</p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">To‘langan sana *</Label>
              <Input
                type="date"
                value={paidAt}
                max={today}
                min={minDate}
                onChange={(e) => setPaidAt(e.target.value)}
                className={cn("mt-1 h-10", dateBad && "border-rose-400")}
              />
            </div>
            <div>
              <Label className="text-xs">Kvitansiya / chek</Label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                  e.target.value = "";
                }}
              />
              {receiptUrl ? (
                <div className="mt-1 flex h-10 items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 text-xs text-emerald-800">
                  <a href={receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 truncate hover:underline">
                    <Paperclip className="h-3.5 w-3.5" /> Biriktirildi
                  </a>
                  <button type="button" onClick={() => setReceiptUrl("")} aria-label="Olib tashlash">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-1 h-10 w-full gap-1.5"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  Fayl biriktirish
                </Button>
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs">To‘lov usuli</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                    method === m ? "border-violet-500 bg-violet-50 text-violet-800" : "hover:border-violet-300",
                  )}
                >
                  {PAYMENT_METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Izoh</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Kim to‘ladi, qanday kelishuv bo‘ldi…"
              className="mt-1 min-h-[64px]"
            />
          </div>

          {amount > 0 && !tooMuch ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs">
              <p className="mb-1.5 font-semibold text-emerald-900">Saqlangandan keyin</p>
              <div className="grid gap-1 text-foreground/90">
                <p className="flex items-center gap-1.5">
                  Undirilgan: <b className="tabular-nums">{moneySoum(collected)}</b>
                  <ArrowRight className="h-3 w-3" /> <b className="tabular-nums text-emerald-700">{moneySoum(nextCollected)}</b>
                  <span className="text-muted-foreground">
                    ({pctNow}% → {pctNext}%)
                  </span>
                </p>
                <p className="flex items-center gap-1.5">
                  Qolgan qarz: <b className="tabular-nums">{moneySoum(remaining)}</b>
                  <ArrowRight className="h-3 w-3" />
                  <b className={cn("tabular-nums", nextRemaining > 0 ? "text-amber-700" : "text-emerald-700")}>{moneySoum(nextRemaining)}</b>
                </p>
                <p className="flex items-center gap-1.5">
                  Holat: <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", nextState.tone)}>{nextState.label}</span>
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Bekor
          </Button>
          <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={!valid || mut.addPayment.isPending} onClick={() => void submit()}>
            {mut.addPayment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Saqlash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidPaymentDialog({ payment, onClose }: { payment: VisitPayment; onClose: () => void }) {
  const { toast } = useToast();
  const mut = useReviziyaVisitMutations();
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;

  const submit = async () => {
    if (!ok) return;
    try {
      await mut.voidPayment.mutateAsync({ paymentId: payment.id, reason: reason.trim() });
      toast({ title: "To‘lov bekor qilindi", description: "Qolgan qarz qayta hisoblandi. Yozuv tarixda qoladi." });
      onClose();
    } catch (e: any) {
      toast({ title: e?.message || "Xatolik", variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>To‘lovni bekor qilish</DialogTitle>
          <DialogDescription>
            {moneySoum(payment.amount)} · {formatYmd(payment.paidAt)}. Yozuv o‘chmaydi, «bekor qilingan» bo‘lib tarixda qoladi va
            summa qolgan qarzga qaytadi.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs">Sabab *</Label>
          <Textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Masalan: summa noto‘g‘ri kiritilgan"
            className="mt-1 min-h-[80px]"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            Ortga
          </Button>
          <Button variant="destructive" disabled={!ok || mut.voidPayment.isPending} onClick={() => void submit()}>
            {mut.voidPayment.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Bekor qilish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
