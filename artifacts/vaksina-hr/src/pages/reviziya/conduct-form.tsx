import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  Hourglass,
  Info,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Send,
  Store,
  Upload,
  UserRound,
  Phone,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fileToAttachment } from "@/lib/vazifalar-api";
import { fetchBranchStaff, fetchNextActNumber, fetchVisitByAct } from "@/lib/reviziya-api";
import { useToast } from "@/hooks/use-toast";
import { BranchCombobox } from "./branch-combobox";

export type ConductValues = {
  branchId: string;
  revisionDate: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  assignedEmployeeId: string;
  shortageAmount: string;
  excessAmount: string;
  collectedAmount: string;
  notes: string;
  actNumber: string;
  actUrl: string;
  receiptUrl: string;
  responsibleName: string;
  responsibleId: string;
  responsiblePhone: string;
  extraResponsibles: { name: string; phone: string }[];
  pickedStaff: { id: string; name: string; phone: string; role: string }[];
  pulledId: number | null;
  pulledStatus: string | null;
  pulledMeta: VisitMeta | null;
  collectStatus: "unset" | "none" | "partial" | "full";
  shortageFound: "unset" | "no" | "yes";
};

export type VisitMeta = {
  assignedEmployeeId: number | null;
  assignedEmployeeName: string | null;
  createdByName: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  reviewedByName: string | null;
  reviewDecision: string | null;
  rejectReason: string | null;
  rejectCount: number;
};

export function visitMetaOf(v: any): VisitMeta {
  return {
    assignedEmployeeId: v.assignedEmployeeId != null ? Number(v.assignedEmployeeId) : null,
    assignedEmployeeName: v.assignedEmployeeName ?? null,
    createdByName: v.createdByName ?? null,
    submittedByName: v.submittedByName ?? null,
    submittedAt: v.submittedAt ?? null,
    reviewedByName: v.reviewedByName ?? null,
    reviewDecision: v.reviewDecision ?? null,
    rejectReason: v.rejectReason ?? null,
    rejectCount: Number(v.rejectCount || 0),
  };
}

const ACTIVE_WORK = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"];

type SectionId = "asosiy" | "tekshiruv" | "kamomad" | "hujjat" | "qoshimcha" | "masul";

const SECTIONS: { id: SectionId; label: string; hint: string; icon: typeof Store }[] = [
  { id: "asosiy", label: "Asosiy ma’lumotlar", hint: "Filial, akt va sana", icon: Store },
  { id: "tekshiruv", label: "Tekshiruv ma’lumotlari", hint: "Vaqt va keyingi muddat", icon: CalendarDays },
  { id: "kamomad", label: "Kamomad va undirish", hint: "Avval kamomad bormi", icon: Wallet },
  { id: "hujjat", label: "Hujjatlar", hint: "Akt va kvitansiya", icon: FileText },
  { id: "qoshimcha", label: "Qo‘shimcha ma’lumotlar", hint: "Izoh", icon: Info },
  { id: "masul", label: "Mas’ul shaxs", hint: "Revizor va rahbar", icon: UserRound },
];

function moneyNum(raw: string): number {
  const n = Number(String(raw || "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function addMonths(ymd: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(Number(m[3]), last));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatMoney(n: number): string {
  const digits = String(Math.max(0, Math.round(n)));
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatSomInput(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const fieldClass =
  "h-11 rounded-xl border-slate-200 bg-white shadow-sm focus-visible:ring-emerald-500/30 dark:border-white/10 dark:bg-[#101a2e]";

function DropSlot({
  label,
  hint,
  value,
  busy,
  onFile,
  onClear,
}: {
  label: string;
  hint: string;
  value: string;
  busy: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-no-pick]")) return;
        inputRef.current?.click();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={cn(
        "cursor-pointer rounded-2xl border border-dashed px-4 py-4 transition",
        over ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-slate-50/70 dark:border-white/10 dark:bg-white/[0.03]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</p>
          <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
          {value ? (
            <p className="mt-2 truncate text-xs font-medium text-emerald-700">{value.split("/").pop()}</p>
          ) : (
            <p className="mt-2 text-xs text-slate-400">Faylni shu yerga tashlang yoki tanlang</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {value ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-no-pick
              className="h-8 rounded-lg"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg"
            data-no-pick
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Fayl tanlash
          </Button>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="image/*,.pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function ConductDialog({
  open,
  onOpenChange,
  form,
  setForm,
  branches,
  revizors,
  saving,
  onSave,
  onHandOff,
  onFinish,
  finishing = false,
  currentUserId,
  canReview,
  onApprove,
  onReject,
  reviewBusy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ConductValues;
  setForm: React.Dispatch<React.SetStateAction<ConductValues>>;
  branches: { id: number; branchName: string; responsibleName: string }[];
  revizors: { id: number; fullName: string }[];
  saving: boolean;
  /** Qoralama saqlash (o‘zi to‘ldirayotganda) */
  onSave: () => void;
  /** Boshqa xodimga ruxsat berish — qolganini o‘sha xodim to‘ldiradi */
  onHandOff: () => void;
  /** Reviziya tayyor / tasdiqlashga yuborish */
  onFinish: () => void;
  finishing?: boolean;
  currentUserId: number | null;
  /** Bo‘lim boshlig‘i: tasdiqlash / rad etish huquqi */
  canReview: boolean;
  onApprove: () => void;
  onReject: (reason: string, action: "redo" | "cancel") => void;
  reviewBusy?: boolean;
}) {
  const { toast } = useToast();
  const [section, setSection] = useState<SectionId>("asosiy");
  const [showMissing, setShowMissing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectAction, setRejectAction] = useState<"redo" | "cancel">("redo");
  const [pullQuery, setPullQuery] = useState("");
  const [pulling, setPulling] = useState(false);
  const [uploading, setUploading] = useState<"act" | "receipt" | null>(null);
  const [staff, setStaff] = useState<
    Array<{ id: number; fullName: string; orgRole: string; roleLabel: string; phone: string }>
  >([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [extraName, setExtraName] = useState("");
  const [extraPhone, setExtraPhone] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShowMissing(false);
  }, [form.pulledId, open]);

  useEffect(() => {
    if (!open || form.pulledId) return;
    let cancelled = false;
    void fetchNextActNumber()
      .then((res) => {
        if (!cancelled) setForm((f) => (f.pulledId ? f : { ...f, actNumber: res.actNumber }));
      })
      .catch(() => {
        if (cancelled) return;
        const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" }).replace(/-/g, "");
        const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
        setForm((f) => (f.pulledId || f.actNumber ? f : { ...f, actNumber: `AKT-${ymd}-${rand}` }));
      });
    return () => {
      cancelled = true;
    };
  }, [open, form.pulledId, setForm]);

  useEffect(() => {
    if (!open || !form.branchId) {
      setStaff([]);
      setStaffLoading(false);
      return;
    }
    let cancelled = false;
    setStaffLoading(true);
    const load = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled) return;
        try {
          const res = await fetchBranchStaff(Number(form.branchId));
          if (cancelled) return;
          const people = res.people || [];
          setStaff(people);
          setForm((f) => {
            if (f.branchId !== form.branchId || f.responsibleId) return f;
            const mudir = people.find((p) => p.orgRole === "manager") || people[0];
            if (!mudir) return f;
            return {
              ...f,
              responsibleId: String(mudir.id),
              responsibleName: mudir.fullName,
              responsiblePhone: mudir.phone || "",
              pickedStaff: [
                {
                  id: String(mudir.id),
                  name: mudir.fullName,
                  phone: mudir.phone || "",
                  role: mudir.roleLabel,
                },
              ],
            };
          });
          return;
        } catch (err) {
          lastError = err;
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
      if (!cancelled) {
        console.warn("branch staff", lastError);
        setStaff([]);
      }
    };
    void load().finally(() => {
      if (!cancelled) setStaffLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, form.branchId, setForm]);

  const shortage = moneyNum(form.shortageAmount);
  const collectedRaw = moneyNum(form.collectedAmount);
  const collected =
    form.collectStatus === "full" ? shortage : form.collectStatus === "none" || form.collectStatus === "unset" ? 0 : Math.min(collectedRaw, shortage || collectedRaw);
  const remaining = Math.max(0, shortage - Math.min(collected, shortage));
  const months = form.shortageFound !== "yes" ? 6 : shortage >= 2_000_000 ? 3 : shortage > 0 ? 4 : 6;
  const nextDate = form.revisionDate ? addMonths(form.revisionDate, months) : "";
  const branchRow = branches.find((b) => String(b.id) === String(form.branchId));
  const branchOptions = useMemo(
    () => branches.map((b) => ({ id: String(b.id), label: b.branchName })),
    [branches],
  );
  const shownStaff =
    staff.length > 0
      ? staff
      : !staffLoading && branchRow?.responsibleName
        ? [
            {
              id: branchRow.id,
              fullName: branchRow.responsibleName,
              orgRole: "manager",
              roleLabel: "Mudir",
              phone: "",
            },
          ]
        : [];

  const isNew = !form.pulledId;
  const status = form.pulledStatus;
  const meta = form.pulledMeta;
  const selfId = currentUserId != null ? String(currentUserId) : "";
  const otherRevizors = revizors.filter((r) => String(r.id) !== selfId);
  const handOff = isNew && !!form.assignedEmployeeId && form.assignedEmployeeId !== selfId;
  const handOffName = handOff ? otherRevizors.find((r) => String(r.id) === form.assignedEmployeeId)?.fullName || "" : "";
  const working = !isNew && ACTIVE_WORK.includes(String(status));
  const inReview = status === "REVIEW";
  const locked = inReview || status === "CANCELLED";
  const assignedToOther =
    !isNew && meta?.assignedEmployeeId != null && currentUserId != null && meta.assignedEmployeeId !== currentUserId;
  const visibleSections = handOff ? SECTIONS.filter((s) => s.id === "asosiy" || s.id === "tekshiruv") : SECTIONS;

  const hasResponsible =
    form.pickedStaff.length > 0 || !!form.responsibleName.trim() || form.extraResponsibles.some((p) => p.name.trim());
  const missing: { section: SectionId; label: string }[] = [];
  if (!form.branchId) missing.push({ section: "asosiy", label: "Filial" });
  if (!form.revisionDate) missing.push({ section: "asosiy", label: "Sana" });
  if (!form.scheduledStartTime || !form.scheduledEndTime) missing.push({ section: "tekshiruv", label: "Boshlanish va tugash vaqti" });
  if (form.shortageFound === "unset") missing.push({ section: "kamomad", label: "Kamomad topildimi?" });
  if (form.shortageFound === "yes" && shortage <= 0) missing.push({ section: "kamomad", label: "Kamomad summasi" });
  if (form.shortageFound === "yes" && form.collectStatus === "partial" && collectedRaw <= 0)
    missing.push({ section: "kamomad", label: "Undirilgan summa" });
  if (!form.actUrl) missing.push({ section: "hujjat", label: "Tekshiruv akti (fayl)" });
  if (collected > 0 && !form.receiptUrl) missing.push({ section: "hujjat", label: "Undirish kvitansiyasi (fayl)" });
  if (!hasResponsible) missing.push({ section: "masul", label: "Mas’ul shaxs" });
  const missingSections = new Set(showMissing ? missing.map((m) => m.section) : []);

  const tryFinish = () => {
    if (missing.length) {
      setShowMissing(true);
      jump(missing[0].section);
      toast({
        title: "Hamma joy to‘ldirilmagan",
        description: missing.map((m) => m.label).join(", "),
        variant: "destructive",
      });
      return;
    }
    onFinish();
  };

  const tryHandOff = () => {
    if (!form.branchId || !form.revisionDate) {
      toast({ title: "Filial va sanani tanlang", variant: "destructive" });
      return;
    }
    onHandOff();
  };

  const finishLabel = canReview ? "Reviziya tayyor" : "Tasdiqlashga yuborish";
  const sectionRing = (id: SectionId) => (missingSections.has(id) ? "ring-2 ring-rose-300 border-rose-200" : "");

  const setShortageFound = (next: ConductValues["shortageFound"]) => {
    setForm((f) => {
      if (next === "unset") {
        return { ...f, shortageFound: next, collectStatus: "unset", shortageAmount: "", collectedAmount: "" };
      }
      if (next === "no") {
        return { ...f, shortageFound: next, collectStatus: "unset", shortageAmount: "", collectedAmount: "" };
      }
      return {
        ...f,
        shortageFound: next,
        collectStatus: f.collectStatus === "unset" ? "none" : f.collectStatus,
      };
    });
  };

  const setStatus = (next: ConductValues["collectStatus"]) => {
    setForm((f) => {
      if (next === "none") return { ...f, collectStatus: next, collectedAmount: "" };
      if (next === "full") return { ...f, collectStatus: next, collectedAmount: f.shortageAmount };
      return { ...f, collectStatus: next };
    });
  };

  const jump = (id: SectionId) => {
    setSection(id);
    scroller.current?.querySelector(`#rev-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onBranch = (id: string) => {
    setForm((f) => ({
      ...f,
      branchId: id,
      responsibleId: "",
      responsibleName: "",
      responsiblePhone: "",
      extraResponsibles: [],
      pickedStaff: [],
    }));
  };

  const upload = async (kind: "act" | "receipt", file: File) => {
    setUploading(kind);
    try {
      const att = await fileToAttachment(file);
      setForm((f) => ({ ...f, [kind === "act" ? "actUrl" : "receiptUrl"]: att.url }));
      toast({ title: "Hujjat biriktirildi" });
    } catch (e: any) {
      toast({ title: e?.message || "Fayl yuklanmadi", variant: "destructive" });
    } finally {
      setUploading(null);
    }
  };

  const pull = async () => {
    const code = pullQuery.trim();
    if (!code) return;
    setPulling(true);
    try {
      const row = await fetchVisitByAct(code);
      const hm = (v: unknown) => String(v || "").slice(0, 5);
      setForm((f) => ({
        ...f,
        pulledId: Number(row.id) || null,
        pulledStatus: row.workflowStatus != null ? String(row.workflowStatus) : null,
        pulledMeta: visitMetaOf(row),
        branchId: row.branchId != null ? String(row.branchId) : f.branchId,
        revisionDate: String(row.revisionDate || f.revisionDate).slice(0, 10),
        scheduledStartTime: hm(row.scheduledStartTime) || f.scheduledStartTime,
        scheduledEndTime: hm(row.scheduledEndTime) || f.scheduledEndTime,
        assignedEmployeeId: row.assignedEmployeeId != null ? String(row.assignedEmployeeId) : "",
        shortageAmount: row.shortageAmount != null ? formatSomInput(String(row.shortageAmount)) : "",
        excessAmount: row.excessAmount != null ? formatSomInput(String(row.excessAmount)) : "",
        collectedAmount: row.collectedAmount != null ? formatSomInput(String(row.collectedAmount)) : "",
        ...(() => {
          const sh = Number(row.shortageAmount || 0);
          const col = Number(row.collectedAmount || 0);
          if (sh <= 0) {
            return { shortageFound: "no" as const, collectStatus: "unset" as const };
          }
          return {
            shortageFound: "yes" as const,
            collectStatus: (col <= 0 ? "none" : col >= sh ? "full" : "partial") as ConductValues["collectStatus"],
          };
        })(),
        notes: String(row.notes || ""),
        actNumber: String(row.actNumber || code),
        actUrl: String(row.actUrl || ""),
        receiptUrl: String(row.receiptUrl || ""),
        ...(() => {
          const parts = String(row.responsibleName || "")
            .split("; ")
            .map((s) => s.trim())
            .filter(Boolean);
          const [first, ...rest] = parts;
          const [name, phone] = (first || "").split(" · ");
          return {
            responsibleId: first ? "saved" : "",
            responsibleName: (name || "").trim(),
            responsiblePhone: (phone || "").trim(),
            extraResponsibles: rest.map((item) => {
              const [n, p] = item.split(" · ");
              return { name: (n || "").trim(), phone: (p || "").trim() };
            }),
            pickedStaff: [],
          };
        })(),
      }));
      toast({ title: "Reviziya akt bo‘yicha tortildi" });
    } catch (e: any) {
      toast({ title: e?.message || "Topilmadi", variant: "destructive" });
    } finally {
      setPulling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,860px)] w-[min(1100px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden rounded-3xl border-0 p-0 shadow-2xl">
        <div className="flex items-center gap-3 border-b bg-white px-5 py-4 dark:bg-[#0d1728]">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {inReview && canReview ? "Reviziyani tekshirish" : "Reviziya qilish"}
            </DialogTitle>
            <p className="text-xs text-slate-500">Akt raqami ochilishi bilan beriladi. Barcha ma’lumot shu raqamga bog‘lanadi.</p>
          </div>
          {status ? <StatusPill status={status} /> : null}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="hidden flex-col gap-1 border-r bg-emerald-50/40 p-3 md:flex dark:bg-emerald-500/5">
            {visibleSections.map((s) => {
              const Icon = s.icon;
              const on = section === s.id;
              const bad = missingSections.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jump(s.id)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-left transition",
                    on ? "bg-white text-emerald-900 shadow-sm ring-1 ring-emerald-100 dark:bg-[#152238] dark:text-emerald-100" : "text-slate-600 hover:bg-white/70 dark:text-slate-300",
                  )}
                >
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", bad ? "text-rose-500" : on ? "text-emerald-600" : "text-slate-400")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight">{s.label}</span>
                    <span className={cn("block text-[11px]", bad ? "font-medium text-rose-600" : "text-slate-400")}>
                      {bad ? "To‘ldirilmagan" : s.hint}
                    </span>
                  </span>
                </button>
              );
            })}
            {handOff ? (
              <div className="mt-2 rounded-2xl border border-dashed border-violet-200 bg-white/70 px-3 py-2.5 text-[11px] leading-snug text-violet-800 dark:bg-white/5 dark:text-violet-200">
                Kamomad, hujjatlar, izoh va mas’ul shaxsni <b>{handOffName || "revizor"}</b> o‘zi to‘ldiradi.
              </div>
            ) : null}
            <p className="mt-auto px-2 pt-4 text-[11px] leading-snug text-slate-500">
              Ma’lumotlar saqlangach akt raqami orqali qayta tortiladi.
            </p>
          </aside>

          <div ref={scroller} className="min-h-0 overflow-y-auto bg-slate-50/60 px-4 py-4 sm:px-6 dark:bg-[#0b1220]">
            <div className="mb-3 flex gap-2 overflow-x-auto md:hidden">
              {visibleSections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jump(s.id)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                    section === s.id ? "bg-emerald-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <StateBanner
              status={status}
              meta={meta}
              canReview={canReview}
              assignedToOther={assignedToOther}
            />

            {showMissing && missing.length > 0 && !locked ? (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" /> Yuborishdan oldin to‘ldiring
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {missing.map((m) => (
                    <button
                      key={m.label}
                      type="button"
                      onClick={() => jump(m.section)}
                      className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100 dark:bg-white/10 dark:text-rose-100"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <fieldset disabled={locked} className={cn("min-w-0", locked && "pointer-events-none select-text opacity-95")}>
            <section id="rev-asosiy" className={cn("mb-4 rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#101a2e]", sectionRing("asosiy"))}>
              <SectionHead icon={Store} tone="text-emerald-600 bg-emerald-50" title="Asosiy ma’lumotlar" subtitle="Filial, revizor va akt raqami" />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Filial">
                  <BranchCombobox
                    value={String(form.branchId || "")}
                    onChange={onBranch}
                    options={branchOptions}
                  />
                </Field>
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Revizor</span>
                  {isNew ? (
                    <div className="flex gap-2">
                      <select
                        className={cn(fieldClass, "min-w-0 flex-1 border px-3 text-sm", handOff && "border-violet-300 ring-1 ring-violet-200")}
                        value={handOff ? form.assignedEmployeeId : ""}
                        onChange={(e) => setForm((f) => ({ ...f, assignedEmployeeId: e.target.value }))}
                      >
                        <option value="">O‘zim (bo‘lim boshlig‘i)</option>
                        {otherRevizors.map((r) => (
                          <option key={r.id} value={String(r.id)}>
                            {r.fullName}
                          </option>
                        ))}
                      </select>
                      {handOff ? (
                        <Button
                          type="button"
                          className="h-11 shrink-0 gap-1.5 rounded-xl bg-violet-700 px-4 text-white hover:bg-violet-800"
                          disabled={saving || !form.branchId}
                          onClick={tryHandOff}
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          Ruxsat berish
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <Input
                      className={fieldClass}
                      readOnly
                      value={meta?.assignedEmployeeName || "—"}
                    />
                  )}
                  {isNew ? (
                    <p className="text-[11px] leading-snug text-slate-500">
                      {handOff
                        ? `Ruxsat bersangiz reviziya ${handOffName}ga o‘tadi. Qolgan joylarni u o‘zi to‘ldiradi va sizga tasdiqlash uchun yuboradi.`
                        : "O‘zingiz o‘tkazsangiz hammasini shu yerda to‘ldirasiz."}
                    </p>
                  ) : null}
                </div>
                <Field label="Sana">
                  <Input className={fieldClass} type="date" value={form.revisionDate} onChange={(e) => setForm((f) => ({ ...f, revisionDate: e.target.value }))} />
                </Field>
                <Field label="Akt raqami">
                  <Input className={fieldClass + " font-mono"} readOnly value={form.actNumber} />
                </Field>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Akt bo‘yicha tortish</Label>
                  <div className="flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        className={fieldClass + " pl-9 font-mono"}
                        placeholder="AKT-..."
                        value={pullQuery}
                        onChange={(e) => setPullQuery(e.target.value)}
                      />
                    </div>
                    <Button type="button" variant="outline" className="h-11 rounded-xl" disabled={pulling || !pullQuery.trim()} onClick={() => void pull()}>
                      {pulling ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tortish"}
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            <section id="rev-tekshiruv" className={cn("mb-4 rounded-2xl border border-sky-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#101a2e]", sectionRing("tekshiruv"))}>
              <SectionHead icon={CalendarDays} tone="text-sky-600 bg-sky-50" title="Tekshiruv ma’lumotlari" subtitle="Boshlanish, tugash va keyingi muddat" />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Boshlanish">
                  <Input
                    className={fieldClass + " cursor-pointer"}
                    type="time"
                    value={form.scheduledStartTime}
                    onChange={(e) => setForm((f) => ({ ...f, scheduledStartTime: e.target.value }))}
                    onClick={(e) => {
                      const el = e.currentTarget as HTMLInputElement;
                      if (typeof el.showPicker === "function") {
                        try {
                          el.showPicker();
                        } catch {
                          /* picker allaqachon ochiq */
                        }
                      }
                    }}
                  />
                </Field>
                <Field label="Tugash">
                  <Input
                    className={fieldClass + " cursor-pointer"}
                    type="time"
                    value={form.scheduledEndTime}
                    onChange={(e) => setForm((f) => ({ ...f, scheduledEndTime: e.target.value }))}
                    onClick={(e) => {
                      const el = e.currentTarget as HTMLInputElement;
                      if (typeof el.showPicker === "function") {
                        try {
                          el.showPicker();
                        } catch {
                          /* picker allaqachon ochiq */
                        }
                      }
                    }}
                  />
                </Field>
              </div>
              <div className="mt-3 flex gap-2 rounded-xl bg-sky-50 px-3 py-2.5 text-xs leading-relaxed text-sky-900 dark:bg-sky-500/10 dark:text-sky-100">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Keyingi tekshiruv avtomatik hisoblanadi</p>
                  <p>2 000 000 so‘m va undan yuqori — 3 oy. Undan kam — 4 oy. Kamomad yo‘q — 6 oy.</p>
                  {nextDate && !handOff ? <p className="mt-1 font-medium">Keyingi sana: {nextDate} ({months} oy)</p> : null}
                </div>
              </div>
            </section>

            {handOff ? (
              <section className="mb-2 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5 shadow-sm dark:border-violet-500/30 dark:from-violet-500/10 dark:to-transparent">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white">
                    <Send className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-violet-950 dark:text-violet-100">
                      Qolgan joylarni {handOffName} to‘ldiradi
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-violet-900/80 dark:text-violet-200/80">
                      «Ruxsat berish»ni bossangiz reviziya shu xodimning vazifalariga tushadi va unga xabar boradi.
                    </p>
                  </div>
                </div>
                <ol className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[
                    ["1", "Ruxsat berasiz", "Filial, sana va xodim — shu yetarli"],
                    ["2", `${handOffName || "Xodim"} to‘ldiradi`, "Kamomad, akt, kvitansiya, mas’ul — majburiy"],
                    ["3", "Siz tasdiqlaysiz", "Yoki sababini yozib rad etasiz"],
                  ].map(([n, t, d]) => (
                    <li key={n} className="rounded-xl bg-white/80 px-3 py-2.5 ring-1 ring-violet-100 dark:bg-white/5 dark:ring-white/10">
                      <span className="flex items-center gap-2 text-xs font-semibold text-violet-900 dark:text-violet-100">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-[10px] text-white">{n}</span>
                        {t}
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-slate-500">{d}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {!handOff ? (
            <>
            <section id="rev-kamomad" className={cn("mb-4 rounded-2xl border border-orange-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#101a2e]", sectionRing("kamomad"))}>
              <SectionHead icon={Wallet} tone="text-orange-600 bg-orange-50" title="Kamomad va undirish" subtitle="Avval kamomad topilganini belgilang" />
              <div className="mt-4 space-y-3">
                <Field label="Kamomad topildimi?">
                  <select
                    className={fieldClass + " w-full px-3 text-sm"}
                    value={form.shortageFound}
                    onChange={(e) => setShortageFound(e.target.value as ConductValues["shortageFound"])}
                  >
                    <option value="unset">Tanlanmagan</option>
                    <option value="no">Yo‘q — kamomad yo‘q</option>
                    <option value="yes">Ha — kamomad bor</option>
                  </select>
                </Field>

                {form.shortageFound === "unset" ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600 dark:bg-white/5 dark:text-slate-300">
                    Kamomad — filialda yetishmayotgan pul yoki tovar. Topilmasa undirish ham bo‘lmaydi. Ortiqcha esa alohida: hisobdan ko‘p chiqqan summa, u qarz emas.
                  </p>
                ) : null}

                {form.shortageFound === "no" ? (
                  <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-xs leading-relaxed text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
                    <p className="font-semibold">Kamomad yo‘q — undirish shart emas</p>
                    <p className="mt-1">Hech narsa yig‘ilmaydi, qolgan 0 so‘m. Keyingi tekshiruv 6 oydan keyin qo‘yiladi.</p>
                  </div>
                ) : null}

                {form.shortageFound === "yes" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Kamomad summasi (so‘m)">
                      <Input
                        className={fieldClass + " tabular-nums"}
                        inputMode="numeric"
                        placeholder="Masalan, 1 500 000"
                        value={form.shortageAmount}
                        onChange={(e) => {
                          const shortageAmount = formatSomInput(e.target.value);
                          setForm((f) => ({
                            ...f,
                            shortageAmount,
                            collectedAmount: f.collectStatus === "full" ? shortageAmount : f.collectedAmount,
                          }));
                        }}
                      />
                    </Field>
                    <Field label="Undirish holati">
                      <select
                        className={fieldClass + " w-full px-3 text-sm"}
                        value={form.collectStatus === "unset" ? "none" : form.collectStatus}
                        onChange={(e) => setStatus(e.target.value as ConductValues["collectStatus"])}
                      >
                        <option value="none">Undirilmagan — hali olinmagan</option>
                        <option value="partial">Qisman to‘langan</option>
                        <option value="full">To‘liq undirilgan</option>
                      </select>
                    </Field>
                    {form.collectStatus === "partial" ? (
                      <Field label="Undirilgan summa (so‘m)">
                        <Input
                          className={fieldClass + " tabular-nums"}
                          inputMode="numeric"
                          placeholder="Hozir olingan qismi"
                          value={form.collectedAmount}
                          onChange={(e) => setForm((f) => ({ ...f, collectedAmount: formatSomInput(e.target.value) }))}
                        />
                      </Field>
                    ) : null}
                    {form.collectStatus === "full" ? (
                      <Field label="Undirilgan summa (so‘m)">
                        <Input className={fieldClass + " tabular-nums"} readOnly value={form.shortageAmount || "0"} />
                      </Field>
                    ) : null}
                  </div>
                ) : null}

                {form.shortageFound === "yes" ? (
                  <p className="text-xs leading-relaxed text-slate-500">
                    {form.collectStatus === "none"
                      ? "Hali pul olinmagan. Qolgan summa kamomadning o‘ziga teng."
                      : form.collectStatus === "partial"
                        ? "Qolgan — kamomaddan hozir olinganini ayirganda qoladigan qarz."
                        : "To‘liq olingan. Qolgan 0 so‘m."}{" "}
                    Qolgan: <span className="font-semibold text-slate-800 dark:text-slate-100">{formatMoney(remaining)} so‘m</span>
                    {shortage >= 2_000_000 ? " Keyingi tekshiruv 3 oydan keyin." : shortage > 0 ? " Keyingi tekshiruv 4 oydan keyin." : " Summani yozing — muddat shunga qarab qo‘yiladi."}
                  </p>
                ) : null}

                {form.shortageFound !== "unset" ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-3 dark:border-white/10">
                    <Field label="Ortiqcha summa (so‘m), ixtiyoriy">
                      <Input
                        className={fieldClass + " tabular-nums"}
                        inputMode="numeric"
                        placeholder="Yo‘q bo‘lsa bo‘sh qoldiring"
                        value={form.excessAmount}
                        onChange={(e) => setForm((f) => ({ ...f, excessAmount: formatSomInput(e.target.value) }))}
                      />
                    </Field>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      Ortiqcha — kassa yoki tovar hisobdan ko‘p chiqqanda. Bu kamomad emas va undirilmaydi. Bo‘lmasa bu yerni bo‘sh qoldiring.
                    </p>
                  </div>
                ) : null}
              </div>
            </section>

            <section id="rev-hujjat" className={cn("mb-4 rounded-2xl border border-violet-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#101a2e]", sectionRing("hujjat"))}>
              <SectionHead icon={FileText} tone="text-violet-600 bg-violet-50" title="Hujjatlar" subtitle="Akt va kvitansiya" />
              <div className="mt-4 space-y-3">
                <DropSlot
                  label="Tekshiruv akti"
                  hint="Rasm yoki PDF, 10 MB gacha"
                  value={form.actUrl}
                  busy={uploading === "act"}
                  onFile={(file) => void upload("act", file)}
                  onClear={() => setForm((f) => ({ ...f, actUrl: "" }))}
                />
                <DropSlot
                  label="Undirish kvitansiyasi"
                  hint="Rasm yoki PDF, 10 MB gacha"
                  value={form.receiptUrl}
                  busy={uploading === "receipt"}
                  onFile={(file) => void upload("receipt", file)}
                  onClear={() => setForm((f) => ({ ...f, receiptUrl: "" }))}
                />
              </div>
            </section>

            <section id="rev-qoshimcha" className="mb-4 rounded-2xl border border-amber-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#101a2e]">
              <SectionHead icon={Info} tone="text-amber-600 bg-amber-50" title="Qo‘shimcha ma’lumotlar" subtitle="Izoh" />
              <textarea
                className="mt-4 min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-white/10 dark:bg-[#0d1728]"
                placeholder="Kechikish sababi, ko‘rilgan choralar yoki boshqa izoh..."
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </section>

            <section id="rev-masul" className={cn("mb-2 rounded-2xl border border-teal-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#101a2e]", sectionRing("masul"))}>
              <SectionHead icon={UserRound} tone="text-teal-600 bg-teal-50" title="Mas’ul shaxs" subtitle="Bir nechtasini tanlash mumkin. Standart — filial mudiri" />
              {!form.branchId ? (
                <p className="mt-4 text-sm text-slate-500">Avval filialni tanlang.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Filial mas’ullari</p>
                  {staffLoading && staff.length === 0 ? (
                    <div className="space-y-2">
                      <div className="h-16 animate-pulse rounded-2xl bg-teal-50" />
                      <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
                    </div>
                  ) : null}
                  {!staffLoading && shownStaff.length === 0 ? (
                    <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Bu filial bo‘yicha mudir, stajyor, farmasevt yoki koordinator topilmadi.
                    </p>
                  ) : null}
                  <div className="grid grid-cols-1 gap-2">
                    {shownStaff.map((p) => {
                      const id = String(p.id);
                      const on = form.pickedStaff.some((s) => s.id === id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            setForm((f) => {
                              const exists = f.pickedStaff.some((s) => s.id === id);
                              const pickedStaff = exists
                                ? f.pickedStaff.filter((s) => s.id !== id)
                                : [
                                    ...f.pickedStaff,
                                    {
                                      id,
                                      name: p.fullName,
                                      phone: p.phone || "",
                                      role: p.roleLabel,
                                    },
                                  ];
                              const first = pickedStaff[0];
                              return {
                                ...f,
                                pickedStaff,
                                responsibleId: first?.id || "",
                                responsibleName: first?.name || "",
                                responsiblePhone: first?.phone || "",
                              };
                            })
                          }
                          className={cn(
                            "flex w-full flex-col gap-1 rounded-2xl border px-3 py-3 text-left transition",
                            on
                              ? "border-teal-500 bg-teal-50 ring-1 ring-teal-200 dark:bg-teal-500/10"
                              : "border-slate-200 bg-white hover:border-teal-200 dark:border-white/10 dark:bg-[#0d1728]",
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-700">{p.roleLabel}</span>
                            <span className={cn("shrink-0 text-[11px] font-semibold", on ? "text-teal-700" : "text-slate-400")}>
                              {on ? "Tanlangan" : "Qo‘shish"}
                            </span>
                          </span>
                          <span className="block whitespace-normal break-words text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
                            {p.fullName}
                          </span>
                          <span className="flex items-start gap-1 text-xs text-slate-500">
                            <Phone className="mt-0.5 h-3 w-3 shrink-0" />
                            <span className="whitespace-normal break-all">{p.phone || "Raqam yo‘q"}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {form.pickedStaff.length > 0 ? (
                    <p className="text-xs text-slate-500">
                      Tanlangan: {form.pickedStaff.map((p) => p.name).join(", ")}
                    </p>
                  ) : form.responsibleId ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Mas’ul">
                        <Input
                          className={fieldClass}
                          value={form.responsibleName}
                          onChange={(e) => setForm((f) => ({ ...f, responsibleName: e.target.value, responsibleId: f.responsibleId || "custom" }))}
                        />
                      </Field>
                      <Field label="Telefon raqami">
                        <Input
                          className={fieldClass}
                          value={form.responsiblePhone}
                          placeholder="+998"
                          onChange={(e) => setForm((f) => ({ ...f, responsiblePhone: e.target.value }))}
                        />
                      </Field>
                    </div>
                  ) : null}
                  <div className="rounded-2xl border border-dashed border-slate-200 p-3 dark:border-white/10">
                    <p className="text-xs font-semibold text-slate-600">Yana mas’ul qo‘shish</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <Input className={fieldClass} placeholder="Ism, familiya" value={extraName} onChange={(e) => setExtraName(e.target.value)} />
                      <Input className={fieldClass} placeholder="Telefon" value={extraPhone} onChange={(e) => setExtraPhone(e.target.value)} />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl"
                        disabled={!extraName.trim()}
                        onClick={() => {
                          setForm((f) => ({
                            ...f,
                            extraResponsibles: [...f.extraResponsibles, { name: extraName.trim(), phone: extraPhone.trim() }],
                          }));
                          setExtraName("");
                          setExtraPhone("");
                        }}
                      >
                        Qo‘shish
                      </Button>
                    </div>
                    {form.extraResponsibles.length > 0 ? (
                      <ul className="mt-3 space-y-1.5">
                        {form.extraResponsibles.map((p, i) => (
                          <li key={`${p.name}-${i}`} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-white/5">
                            <span className="min-w-0 truncate">
                              {p.name}
                              {p.phone ? <span className="text-slate-500"> · {p.phone}</span> : null}
                            </span>
                            <button
                              type="button"
                              className="text-xs font-semibold text-rose-600"
                              onClick={() =>
                                setForm((f) => ({
                                  ...f,
                                  extraResponsibles: f.extraResponsibles.filter((_, idx) => idx !== i),
                                }))
                              }
                            >
                              Olib tashlash
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {form.pickedStaff.length ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-slate-500 underline-offset-2 hover:underline"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          pickedStaff: [],
                          responsibleId: "",
                          responsibleName: "",
                          responsiblePhone: "",
                        }))
                      }
                    >
                      Tanlovni bo‘shatish
                    </button>
                  ) : (
                    <p className="text-xs text-slate-400">Hech kim tanlanmasa, saqlanganda filial mudiri yoziladi.</p>
                  )}
                </div>
              )}
            </section>
            </>
            ) : null}
            </fieldset>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-white px-5 py-3 dark:bg-[#0d1728]">
          <Button type="button" variant="outline" className="h-11 rounded-xl px-5" onClick={() => onOpenChange(false)}>
            {isNew ? "Bekor qilish" : "Yopish"}
          </Button>
          {inReview && canReview ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 rounded-xl border-rose-200 px-5 text-rose-700 hover:bg-rose-50"
                disabled={reviewBusy}
                onClick={() => {
                  setRejectReason("");
                  setRejectAction("redo");
                  setRejectOpen(true);
                }}
              >
                <XCircle className="h-4 w-4" /> Rad etish
              </Button>
              <Button
                type="button"
                className="h-11 gap-2 rounded-xl bg-emerald-600 px-5 text-white hover:bg-emerald-700"
                disabled={reviewBusy}
                onClick={onApprove}
              >
                {reviewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Tasdiqlash
              </Button>
            </>
          ) : null}
          {handOff ? (
            <Button
              type="button"
              className="h-11 gap-2 rounded-xl bg-violet-700 px-5 text-white hover:bg-violet-800"
              disabled={!form.branchId || saving}
              onClick={tryHandOff}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Ruxsat berish
            </Button>
          ) : null}
          {!handOff && !locked ? (
            <Button
              type="button"
              variant={isNew || working ? "outline" : "default"}
              className={cn(
                "h-11 gap-2 rounded-xl px-5",
                !(isNew || working) && "bg-emerald-600 text-white hover:bg-emerald-700",
              )}
              disabled={!form.branchId || saving || finishing}
              onClick={onSave}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isNew ? "Qoralama saqlash" : "Saqlash"}
            </Button>
          ) : null}
          {!handOff && (isNew || working) ? (
            <Button
              type="button"
              className="h-11 gap-2 rounded-xl bg-emerald-600 px-5 text-white hover:bg-emerald-700"
              disabled={!form.branchId || saving || finishing}
              onClick={tryFinish}
            >
              {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : canReview ? <ClipboardCheck className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {finishLabel}
            </Button>
          ) : null}
        </div>

        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent className="max-w-md rounded-3xl">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <XCircle className="h-5 w-5 text-rose-600" /> Reviziyani rad etish
            </DialogTitle>
            <p className="text-xs text-slate-500">
              Sabab {meta?.assignedEmployeeName || "revizor"}ga xabar bo‘lib boradi va tarixda saqlanadi.
            </p>
            <label className="mt-2 block space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sabab (majburiy)</span>
              <textarea
                autoFocus
                className="min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-rose-500/30 dark:border-white/10 dark:bg-[#0d1728]"
                placeholder="Masalan: akt rasmi o‘qilmaydi, kamomad summasi aktga mos emas…"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </label>
            <div className="grid gap-2">
              {(
                [
                  ["redo", RotateCcw, "Qayta reviziya qilsin", "Revizorga qaytadi — tuzatib qayta yuboradi"],
                  ["cancel", Ban, "Butunlay bekor qilish", "Reviziya yopiladi, lekin o‘chmaydi — tarixda sababi bilan qoladi"],
                ] as const
              ).map(([id, Icon, title, hint]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRejectAction(id)}
                  className={cn(
                    "flex items-start gap-3 rounded-2xl border px-3 py-3 text-left transition",
                    rejectAction === id
                      ? id === "cancel"
                        ? "border-rose-400 bg-rose-50 ring-1 ring-rose-200 dark:bg-rose-500/10"
                        : "border-amber-400 bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-500/10"
                      : "border-slate-200 hover:border-slate-300 dark:border-white/10",
                  )}
                >
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", id === "cancel" ? "text-rose-600" : "text-amber-600")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="block text-xs text-slate-500">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setRejectOpen(false)}>
                Orqaga
              </Button>
              <Button
                type="button"
                className={cn(
                  "gap-2 rounded-xl text-white",
                  rejectAction === "cancel" ? "bg-rose-600 hover:bg-rose-700" : "bg-amber-600 hover:bg-amber-700",
                )}
                disabled={rejectReason.trim().length < 3 || reviewBusy}
                onClick={() => {
                  onReject(rejectReason.trim(), rejectAction);
                  setRejectOpen(false);
                }}
              >
                {reviewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {rejectAction === "cancel" ? "Bekor qilish" : "Qayta qilishga qaytarish"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    ASSIGNED: ["Biriktirilgan", "bg-violet-100 text-violet-800"],
    ACCEPTED: ["Qabul qilingan", "bg-sky-100 text-sky-800"],
    IN_PROGRESS: ["Jarayonda", "bg-indigo-100 text-indigo-800"],
    REVIEW: ["Tasdiqlash kutilmoqda", "bg-amber-100 text-amber-900"],
    COMPLETED: ["Tasdiqlangan", "bg-emerald-100 text-emerald-800"],
    CANCELLED: ["Bekor qilingan", "bg-rose-100 text-rose-800"],
    REQUESTED: ["Ariza", "bg-amber-100 text-amber-900"],
  };
  const [label, tone] = map[status] || [status, "bg-slate-100 text-slate-700"];
  return <span className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-semibold", tone)}>{label}</span>;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StateBanner({
  status,
  meta,
  canReview,
  assignedToOther,
}: {
  status: string | null;
  meta: VisitMeta | null;
  canReview: boolean;
  assignedToOther: boolean;
}) {
  if (!status || !meta) return null;
  const box = "mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm";
  const redo = meta.reviewDecision === "rejected_redo" && meta.rejectReason;

  if (ACTIVE_WORK.includes(status)) {
    return (
      <>
        {redo ? (
          <div className={cn(box, "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100")}>
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">
                Rad etildi{meta.reviewedByName ? ` — ${meta.reviewedByName}` : ""}. Tuzatib qayta yuboring
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed">Sabab: {meta.rejectReason}</p>
            </div>
          </div>
        ) : null}
        {canReview && assignedToOther ? (
          <div className={cn(box, "border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100")}>
            <UserRound className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs leading-relaxed">
              <b>{meta.assignedEmployeeName || "Revizor"}</b> to‘ldirmoqda. Tayyor bo‘lgach sizga tasdiqlash uchun keladi.
            </p>
          </div>
        ) : !canReview ? (
          <div className={cn(box, "border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100")}>
            <Send className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 text-xs leading-relaxed">
              <p className="text-sm font-semibold">
                {meta.createdByName ? `${meta.createdByName} sizga topshirdi` : "Reviziya sizga topshirildi"}
              </p>
              <p className="mt-0.5">
                Barcha joylarni to‘ldiring: kamomad, akt fayli, kerak bo‘lsa kvitansiya va mas’ul shaxs. Keyin «Tasdiqlashga yuborish»ni bosing — bo‘lim boshlig‘i tasdiqlaydi.
              </p>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (status === "REVIEW") {
    return (
      <div className={cn(box, "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100")}>
        <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 text-xs leading-relaxed">
          <p className="text-sm font-semibold">
            {canReview
              ? `${meta.submittedByName || meta.assignedEmployeeName || "Revizor"} tasdiqlashga yubordi${meta.submittedAt ? ` · ${fmtDateTime(meta.submittedAt)}` : ""}`
              : "Tasdiqlashga yuborildi — bo‘lim boshlig‘i tekshiryapti"}
          </p>
          <p className="mt-0.5">
            {canReview
              ? "Hamma joyni ko‘rib chiqing. To‘g‘ri bo‘lsa «Tasdiqlash», xato bo‘lsa «Rad etish» — sababini yozasiz."
              : "Qaror chiqquncha o‘zgartirib bo‘lmaydi. Rad etilsa sababi bilan sizga qaytadi."}
          </p>
          {meta.rejectCount > 0 && meta.rejectReason ? (
            <p className="mt-1 font-medium">
              Oldin {meta.rejectCount} marta rad etilgan. Oxirgi sabab: {meta.rejectReason}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (status === "CANCELLED") {
    return (
      <div className={cn(box, "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100")}>
        <Ban className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 text-xs leading-relaxed">
          <p className="text-sm font-semibold">
            Bekor qilingan{meta.reviewedByName ? ` — ${meta.reviewedByName}` : ""}
          </p>
          <p className="mt-0.5">
            {meta.rejectReason ? `Sabab: ${meta.rejectReason}. ` : ""}Ma’lumotlar o‘chirilmagan, tarixda saqlanadi.
          </p>
        </div>
      </div>
    );
  }

  if (status === "COMPLETED" && meta.reviewedByName) {
    return (
      <div className={cn(box, "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100")}>
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-xs leading-relaxed">
          Tasdiqlagan: <b>{meta.reviewedByName}</b>
        </p>
      </div>
    );
  }
  return null;
}

function SectionHead({
  icon: Icon,
  tone,
  title,
  subtitle,
}: {
  icon: typeof Store;
  tone: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}
