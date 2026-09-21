import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  Clock3,
  MapPin,
  Repeat,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Calendar } from "../../components/ui/calendar";
import { useToast } from "../../hooks/use-toast";
import { useI18n } from "../../i18n/I18nProvider";
import { cn } from "../../lib/utils";
import { dateToYmd, formatYmdDisplay } from "../../lib/javob-olish-api";
import {
  createWorkSlot,
  deleteWorkSlot,
  changeShiftOnly,
  updateWorkSlotShift,
  fetchAllWorkSlots,
  fetchSmenaMe,
  todayTashkentYmd,
  WEEKDAY_OPTIONS,
  type SlotMode,
  type SlotShiftKey,
  type SmenaAssignable,
  type SmenaBranch,
  type WorkSlotItem,
} from "../../lib/smena-api";
import { useCleanupDuplicateBranches } from "../../lib/pharmacy-staff-api";

const SHIFT_KEYS: { value: SlotShiftKey; label: string; hint: string }[] = [
  { value: "one", label: "1-smena", hint: "08:00–17:00" },
  { value: "two", label: "2-smena", hint: "17:00–23:45" },
  { value: "three", label: "3-smena", hint: "23:00–07:00" },
  { value: "one+two", label: "1+2", hint: "08:00–23:45" },
  { value: "two+three", label: "2+3", hint: "17:00–07:00" },
];

function shiftAtoms(key: string): string[] {
  const s = String(key || "").toLowerCase();
  if (s === "one+two" || s === "1+2") return ["one", "two"];
  if (s === "two+three" || s === "2+3") return ["two", "three"];
  return [s];
}

function shiftConflicts(a: string, b: string): boolean {
  if (a === b) return true;
  const aa = shiftAtoms(a);
  const bb = shiftAtoms(b);
  return aa.some((x) => bb.includes(x));
}

type Tab = SlotMode;

function orgLabel(org: string | null) {
  if (org === "pharmacist") return "Farmasevt";
  if (org === "intern") return "Stajyor";
  if (org === "manager") return "Mudir";
  return "Xodim";
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 pl-8" />
    </div>
  );
}

function CompactList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("max-h-48 overflow-y-auto rounded-xl border border-border bg-card", className)}>
      {children}
    </div>
  );
}

function shiftLabelOf(s: WorkSlotItem) {
  return s.shiftLabel || SHIFT_KEYS.find((x) => x.value === s.shiftKey)?.label || s.shiftKey;
}

function shiftHintOf(key: string) {
  return SHIFT_KEYS.find((x) => x.value === key)?.hint || "";
}

function daysTextOf(s: WorkSlotItem) {
  if (s.mode === "weekly") {
    const days = (s.weekdays || [])
      .map((d) => WEEKDAY_OPTIONS.find((w) => w.value === d)?.label || d)
      .join(" · ");
    return days ? `Har: ${days}` : "Hafta kunlari belgilanmagan";
  }
  if (s.mode === "period") {
    return `${formatYmdDisplay(s.validFrom)} → ${s.validTo ? formatYmdDisplay(s.validTo) : "cheksiz"}`;
  }
  if (s.mode === "days") {
    const dates = s.workDates || [];
    if (!dates.length) return "Kunlar yo‘q";
    if (dates.length <= 4) return dates.map(formatYmdDisplay).join(" · ");
    return `${dates.length} kun: ${formatYmdDisplay(dates[0]!)} … ${formatYmdDisplay(dates[dates.length - 1]!)}`;
  }
  if (s.validTo) {
    return `Har kuni · ${formatYmdDisplay(s.validFrom)} → ${formatYmdDisplay(s.validTo)}`;
  }
  return `Har kuni · ${formatYmdDisplay(s.validFrom)} dan`;
}

function modeBadge(s: WorkSlotItem) {
  if (s.mode === "period") return "Muddatli";
  if (s.mode === "weekly") return "Haftalik";
  if (s.mode === "days") return "Kunlik";
  return "Doimiy";
}

function slotSummary(s: WorkSlotItem) {
  const shift = shiftLabelOf(s);
  const branch = s.branchLabel || `#${s.branchId}`;
  return `${branch} · ${shift} · ${daysTextOf(s)}`;
}

/** Tanlangan xodimning 1–2+ filial rejasini aniq ko‘rsatadi */
function PersonPlanBoard({
  name,
  slots,
  onRemove,
  onChangeShift,
  changingSlotId,
  confirmRemove,
}: {
  name: string;
  slots: WorkSlotItem[];
  onRemove: (id: number) => void;
  onChangeShift: (slotId: number, shiftKey: SlotShiftKey) => void;
  changingSlotId: number | null;
  confirmRemove: string;
}) {
  const [editSlotId, setEditSlotId] = useState<number | null>(null);
  const branchCount = new Set(slots.map((s) => s.branchId)).size;
  const shiftCount = new Set(slots.map((s) => s.shiftKey)).size;
  const sorted = [...slots].sort((a, b) => {
    const order = { one: 1, "one+two": 1.5, two: 2, "two+three": 2.5, three: 3 } as Record<string, number>;
    const oa = order[a.shiftKey] || 9;
    const ob = order[b.shiftKey] || 9;
    if (oa !== ob) return oa - ob;
    return String(a.branchLabel || "").localeCompare(String(b.branchLabel || ""), "uz");
  });

  if (!slots.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-3 py-3">
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Hali filial/smena biriktirilmagan. Pastdan 1-filial + smena saqlang, keyin 2-filialni qo‘shing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/5 via-card to-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {branchCount} filial · {shiftCount} smena · {slots.length} biriktirish
          </p>
        </div>
        {branchCount >= 2 ? (
          <span className="rounded-full bg-emerald-600/15 px-2.5 py-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
            2+ FILIAL
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            1 filial
          </span>
        )}
      </div>

      <div className="space-y-2">
        {sorted.map((s, idx) => {
          const editing = editSlotId === s.id;
          const busy = changingSlotId === s.id;
          return (
            <div
              key={s.id}
              className="relative overflow-hidden rounded-xl border border-border/80 bg-card px-3 py-2.5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background">
                      #{idx + 1}
                    </span>
                    <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                      {modeBadge(s)}
                    </span>
                    <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                      {shiftLabelOf(s)}
                    </span>
                  </div>
                  <p className="flex items-start gap-1.5 text-sm font-semibold leading-snug text-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="min-w-0 break-words">{s.branchLabel || `Filial #${s.branchId}`}</span>
                  </p>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock3 className="h-3 w-3 shrink-0" />
                    {shiftHintOf(s.shiftKey) || shiftLabelOf(s)}
                  </p>
                  <p className="flex items-start gap-1.5 text-[11px] font-medium text-foreground/80">
                    <CalendarDays className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{daysTextOf(s)}</span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-2 text-[11px]"
                    disabled={busy}
                    onClick={() => setEditSlotId(editing ? null : s.id)}
                  >
                    {editing ? "Yopish" : "Smena"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-rose-600"
                    onClick={() => {
                      if (window.confirm(confirmRemove)) onRemove(s.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {editing ? (
                <div className="mt-2 border-t border-border/60 pt-2">
                  <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                    Filial o‘zgarmaydi · faqat smenani tanlang
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {SHIFT_KEYS.map((opt) => (
                      <Button
                        key={opt.value}
                        size="sm"
                        type="button"
                        variant={s.shiftKey === opt.value ? "default" : "outline"}
                        disabled={busy || s.shiftKey === opt.value}
                        className="h-auto flex-col gap-0.5 py-1.5 text-[11px]"
                        onClick={() => {
                          onChangeShift(s.id, opt.value);
                          setEditSlotId(null);
                        }}
                      >
                        <span>{opt.label}</span>
                        <span className="text-[9px] font-normal opacity-80">{opt.hint}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {branchCount >= 2 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Bir kunda: smena rejasiga qarab tegishli filialda davomat. Keldim/Ketdim istalgan vaqtda; soat smena bo‘yicha hisoblanadi.
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-muted-foreground">
          2-filial qo‘shish: boshqa filial + boshqa smena tanlab «Biriktirishni saqlash».
        </p>
      )}
    </div>
  );
}

export default function SmenaFilialPage() {
  const { toast } = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["smena-me"], queryFn: fetchSmenaMe });
  const data = q.data;

  const canManage = Boolean(data?.canManageSlots || data?.canAssignOthers || data?.canDayRotate);
  const [tab, setTab] = useState<Tab>("permanent");
  const [branchQ, setBranchQ] = useState("");
  const [peopleQ, setPeopleQ] = useState("");
  const [pickedBranchId, setPickedBranchId] = useState<number | null>(null);
  const [pickedPersonId, setPickedPersonId] = useState<number | null>(null);
  const [pickedShift, setPickedShift] = useState<SlotShiftKey>("one");
  const [validFrom, setValidFrom] = useState(todayTashkentYmd());
  const [validTo, setValidTo] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [selectedDates, setSelectedDates] = useState<Date[]>(() => {
    const [y, m, d] = todayTashkentYmd().split("-").map(Number);
    return [new Date(y!, m! - 1, d!, 12, 0, 0)];
  });

  const workDates = useMemo(
    () => selectedDates.map(dateToYmd).sort((a, b) => a.localeCompare(b)),
    [selectedDates],
  );

  const cleanupDupBranches = useCleanupDuplicateBranches();
  const orphanCleanupDone = useRef(false);

  useEffect(() => {
    if (!data || !canManage || orphanCleanupDone.current) return;
    orphanCleanupDone.current = true;
    cleanupDupBranches.mutate(
      { name: "йиллик", purgeEmptyBranches: true },
      {
        onSuccess: (res) => {
          if (res.removedCount > 0) {
            void qc.invalidateQueries({ queryKey: ["smena-me"] });
            toast({
              title: "Bo‘sh filial kartalari o‘chirildi",
              description: res.message,
            });
          }
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, canManage]);

  const staff = useMemo(() => {
    return (data?.assignable ?? []).filter((p) => {
      if (!(p.orgRole === "pharmacist" || p.orgRole === "intern" || p.orgRole === "manager")) {
        return false;
      }
      // Bo‘sh filial kartalari (masalan «16-йиллик · filial yo‘q») — xodim tanlashda kerak emas
      if (p.orgRole === "manager" && !p.assignedBranchName) return false;
      return true;
    });
  }, [data?.assignable]);

  const branches = useMemo(() => {
    const list = data?.branches ?? [];
    const s = branchQ.trim().toLowerCase();
    if (!s) return list;
    return list.filter((b) => `${b.name} ${b.managerName}`.toLowerCase().includes(s));
  }, [data?.branches, branchQ]);

  const people = useMemo(() => {
    const s = peopleQ.trim().toLowerCase();
    if (!s) return staff;
    return staff.filter((p) =>
      `${p.fullName} ${orgLabel(p.orgRole)} ${p.assignedBranchName || ""}`.toLowerCase().includes(s),
    );
  }, [staff, peopleQ]);

  const slotsQ = useQuery({
    queryKey: ["smena-slots-all"],
    queryFn: fetchAllWorkSlots,
    enabled: canManage,
  });

  const picked = staff.find((p) => p.id === pickedPersonId) ?? null;

  const slotsForPicked = useMemo(() => {
    const items = slotsQ.data?.items ?? [];
    if (!pickedPersonId) return [];
    return items.filter((s) => s.employeeId === pickedPersonId);
  }, [slotsQ.data?.items, pickedPersonId]);

  const allSlotsList = useMemo(() => {
    const items = slotsQ.data?.items ?? [];
    if (pickedPersonId) return [];
    return items;
  }, [slotsQ.data?.items, pickedPersonId]);

  const slotStatsByEmp = useMemo(() => {
    const map = new Map<number, { branches: Set<number>; shifts: Set<string>; count: number }>();
    for (const s of slotsQ.data?.items ?? []) {
      const cur = map.get(s.employeeId) || { branches: new Set<number>(), shifts: new Set<string>(), count: 0 };
      cur.branches.add(s.branchId);
      cur.shifts.add(s.shiftKey);
      cur.count += 1;
      map.set(s.employeeId, cur);
    }
    return map;
  }, [slotsQ.data?.items]);

  const saveSlot = useMutation({
    mutationFn: async () => {
      if (!pickedPersonId) throw new Error("Avval xodimni tanlang");
      if (!pickedBranchId) throw new Error("Filialni ro‘yxatdan tanlang (pastdagi filiallar)");
      if (tab === "period" && !validTo) throw new Error("Muddatli rejimda tugash sanasini kiriting");
      if (tab === "weekly" && !weekdays.length) throw new Error("Hafta kunlarini tanlang (Du–Ya)");
      if (tab === "days" && !workDates.length) throw new Error(t("smena.pickDates"));
      const alreadySame = slotsForPicked.some(
        (s) => s.branchId === pickedBranchId && s.shiftKey === pickedShift && s.mode === tab,
      );
      if (alreadySame) throw new Error("Shu filial + smena allaqachon biriktirilgan");
      return createWorkSlot({
        employeeId: pickedPersonId,
        branchId: pickedBranchId,
        shiftKey: pickedShift,
        mode: tab,
        validFrom: tab === "days" ? workDates[0] : validFrom,
        validTo: tab === "permanent" ? validTo || null : tab === "period" ? validTo : tab === "weekly" ? validTo || null : null,
        weekdays: tab === "weekly" ? weekdays : undefined,
        workDates: tab === "days" ? workDates : undefined,
      });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["smena-slots-all"] });
      void qc.invalidateQueries({ queryKey: ["smena-me"] });
      toast({
        title: t("smena.slotSaved"),
        description: slotSummary(r.item),
      });
      setPickedBranchId(null);
      setBranchQ("");
      // Keyingi smena uchun avtomatik taklif
      const used = new Set(
        [...slotsForPicked, r.item].map((s) => s.shiftKey),
      );
      const next = (["one", "two", "three"] as SlotShiftKey[]).find((k) => !used.has(k));
      setPickedShift(next || "two");
    },
    onError: (e: Error) => toast({ title: t("smena.saveFail"), description: e.message, variant: "destructive" }),
  });

  const removeSlot = useMutation({
    mutationFn: (id: number) => deleteWorkSlot(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["smena-slots-all"] });
      toast({ title: t("smena.slotRemoved") });
    },
    onError: (e: Error) => toast({ title: t("smena.saveFail"), description: e.message, variant: "destructive" }),
  });

  const [shiftOnlyKey, setShiftOnlyKey] = useState<SlotShiftKey>("one");
  const [changingSlotId, setChangingSlotId] = useState<number | null>(null);

  const changeSlotShift = useMutation({
    mutationFn: ({ slotId, shiftKey }: { slotId: number; shiftKey: SlotShiftKey }) => {
      setChangingSlotId(slotId);
      return updateWorkSlotShift(slotId, shiftKey);
    },
    onSuccess: (r) => {
      setChangingSlotId(null);
      void qc.invalidateQueries({ queryKey: ["smena-slots-all"] });
      void qc.invalidateQueries({ queryKey: ["smena-me"] });
      toast({
        title: "Smena o‘zgardi",
        description: r.message || `${r.item.branchLabel || "Filial"} · ${shiftLabelOf(r.item)}`,
      });
    },
    onError: (e: Error) => {
      setChangingSlotId(null);
      toast({ title: t("smena.saveFail"), description: e.message, variant: "destructive" });
    },
  });

  const saveShiftOnly = useMutation({
    mutationFn: async () => {
      if (!pickedPersonId) throw new Error("Avval xodimni tanlang");
      return changeShiftOnly(pickedPersonId, shiftOnlyKey);
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["smena-slots-all"] });
      void qc.invalidateQueries({ queryKey: ["smena-me"] });
      toast({ title: "Smena o‘zgardi", description: r.message });
    },
    onError: (e: Error) => toast({ title: t("smena.saveFail"), description: e.message, variant: "destructive" }),
  });

  function pickPerson(p: SmenaAssignable) {
    setPickedPersonId(p.id);
    setPickedBranchId(null);
    setBranchQ("");
    setPeopleQ("");
    const cur = String(p.shiftType || "one").toLowerCase() as SlotShiftKey;
    setShiftOnlyKey(
      SHIFT_KEYS.some((x) => x.value === cur) ? cur : "one",
    );
    setPickedShift(
      SHIFT_KEYS.some((x) => x.value === cur) ? cur : "one",
    );
  }

  function cancelEdit() {
    setPickedPersonId(null);
    setPickedBranchId(null);
    setPickedShift("one");
    setBranchQ("");
    setPeopleQ("");
  }

  function toggleWeekday(d: number) {
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  }

  /** Filialda kim ishlaydi (barcha slotlardan) */
  const occupancyByBranch = useMemo(() => {
    const map = new Map<number, Array<{ shiftKey: string; name: string; employeeId: number }>>();
    for (const s of slotsQ.data?.items ?? []) {
      const list = map.get(s.branchId) || [];
      list.push({
        shiftKey: s.shiftKey,
        name: s.fullName || `#${s.employeeId}`,
        employeeId: s.employeeId,
      });
      map.set(s.branchId, list);
    }
    return map;
  }, [slotsQ.data?.items]);

  const nextSlotNo = slotsForPicked.length + 1;
  const pickedBranch = (data?.branches ?? []).find((b) => b.id === pickedBranchId) ?? null;
  const usedShiftsByPicked = useMemo(
    () => new Set(slotsForPicked.map((s) => s.shiftKey)),
    [slotsForPicked],
  );

  function renderBranchRow(b: SmenaBranch) {
    const on = pickedBranchId === b.id;
    const occ = occupancyByBranch.get(b.id) || [];
    const shiftLines = SHIFT_KEYS.map((sk) => {
      const who = occ.filter((o) => shiftConflicts(o.shiftKey, sk.value));
      const mine = who.some((w) => w.employeeId === pickedPersonId);
      if (!who.length) return { key: sk.value, label: sk.label, text: "bo‘sh", tone: "empty" as const };
      if (mine) return { key: sk.value, label: sk.label, text: "shu xodim", tone: "mine" as const };
      return {
        key: sk.value,
        label: sk.label,
        text: who.map((w) => w.name.split(" ")[0]).join(", "),
        tone: "busy" as const,
      };
    });
    return (
      <button
        key={b.id}
        type="button"
        onClick={() => setPickedBranchId(b.id)}
        className={cn(
          "flex w-full flex-col gap-1 border-b border-border/60 px-3 py-2.5 text-left last:border-0",
          on ? "bg-primary/10" : "hover:bg-muted/70",
        )}
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{b.name}</span>
            <span className="text-[11px] text-muted-foreground">Mudir: {b.managerName}</span>
          </span>
          {on ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
        </span>
        <span className="flex flex-wrap gap-1">
          {shiftLines.map((line) => (
            <span
              key={line.key}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                line.tone === "empty" && "bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
                line.tone === "mine" && "bg-primary/15 text-primary",
                line.tone === "busy" && "bg-amber-500/15 text-amber-900 dark:text-amber-200",
              )}
            >
              {line.label}: {line.text}
            </span>
          ))}
        </span>
      </button>
    );
  }

  if (q.isLoading) return <p className="p-6 text-sm text-muted-foreground">{t("ui.loading")}</p>;
  if (!data) return <p className="p-6 text-sm text-rose-600">{t("smena.loadFail")}</p>;

  const tabs: { id: Tab; label: string; icon: ReactNode; hint: string }[] = [
    {
      id: "permanent",
      label: t("smena.tabPermanent"),
      icon: <MapPin className="h-3.5 w-3.5" />,
      hint: t("smena.hintPermanent"),
    },
    {
      id: "period",
      label: t("smena.tabPeriod"),
      icon: <Clock3 className="h-3.5 w-3.5" />,
      hint: t("smena.hintPeriod"),
    },
    {
      id: "weekly",
      label: t("smena.tabWeekly"),
      icon: <Repeat className="h-3.5 w-3.5" />,
      hint: t("smena.hintWeekly"),
    },
    {
      id: "days",
      label: t("smena.tabDays"),
      icon: <CalendarDays className="h-3.5 w-3.5" />,
      hint: t("smena.hintDays"),
    },
  ];

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-28">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("smena.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("smena.subtitleNew")}</p>
      </div>

      {data.employee ? (
        <Card className="border-border/80 shadow-sm">
          <CardContent className="flex items-start gap-3 py-4">
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <Users className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{data.employee.fullName}</p>
              <p className="text-xs text-muted-foreground">
                {data.employee.assignedBranchName || t("smena.noBranch")} · {data.shift.label}{" "}
                ({data.shift.start}–{data.shift.end})
              </p>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t("smena.attendanceRule")}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/40 p-1 sm:grid-cols-4">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                onClick={() => {
                  setTab(tb.id);
                  cancelEdit();
                }}
                className={cn(
                  "flex items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-xs font-semibold transition sm:text-sm",
                  tab === tb.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {tb.icon}
                {tb.label}
              </button>
            ))}
          </div>

          <Card className="overflow-hidden border-primary/20 shadow-sm">
            <CardHeader className="space-y-2 border-b bg-gradient-to-br from-primary/10 via-card to-card py-4">
              <CardTitle className="text-base">{tabs.find((x) => x.id === tab)?.label}</CardTitle>
              <p className="text-xs leading-relaxed text-muted-foreground">{tabs.find((x) => x.id === tab)?.hint}</p>
            </CardHeader>
            <CardContent className="space-y-4 py-4">
              {/* 1-QADAM: xodim */}
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  1. {t("smena.pickStaff")}
                </label>
                {picked ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{picked.fullName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {orgLabel(picked.orgRole)} · hozir: {picked.assignedBranchName || t("smena.noBranch")}
                      </p>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                      Almashtirish
                    </Button>
                  </div>
                ) : (
                  <>
                    <SearchBox value={peopleQ} onChange={setPeopleQ} placeholder={t("smena.searchName")} />
                    <CompactList className="mt-2 max-h-56">
                      {people.length === 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-muted-foreground">{t("smena.noPeople")}</p>
                      ) : (
                        people.map((p) => {
                          const st = slotStatsByEmp.get(p.id);
                          const branchN = st?.branches.size || 0;
                          const shiftN = st?.shifts.size || 0;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => pickPerson(p)}
                              className="flex w-full items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-left last:border-0 hover:bg-muted/70"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">{p.fullName}</span>
                                <span className="text-[11px] text-muted-foreground">
                                  {orgLabel(p.orgRole)} · {p.assignedBranchName || t("smena.noBranch")}
                                  {branchN > 0 ? ` · ${branchN} filial / ${shiftN} smena` : ""}
                                </span>
                              </span>
                              {branchN >= 2 ? (
                                <span className="rounded-md bg-emerald-600/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                                  2F
                                </span>
                              ) : null}
                            </button>
                          );
                        })
                      )}
                    </CompactList>
                  </>
                )}
              </div>

              {picked ? (
                <>
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("smena.planTitle")}
                    </label>
                    <PersonPlanBoard
                      name={picked.fullName}
                      slots={slotsForPicked}
                      onRemove={(id) => removeSlot.mutate(id)}
                      onChangeShift={(slotId, shiftKey) =>
                        changeSlotShift.mutate({ slotId, shiftKey })
                      }
                      changingSlotId={changingSlotId}
                      confirmRemove={t("smena.confirmRemoveSlot")}
                    />
                  </div>

                  {/* Filialni ko‘chirmasdan faqat smena */}
                  {(picked.assignedBranchId ||
                    slotsForPicked.length > 0 ||
                    picked.orgRole === "manager") && (
                    <div className="rounded-2xl border border-amber-300/60 bg-amber-50/80 p-3 dark:border-amber-500/30 dark:bg-amber-950/30">
                      <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                        Faqat smenani o‘zgartirish
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-amber-900/80 dark:text-amber-200/80">
                        Hozirgi filial qoladi — boshqa filialga ko‘chirilmaydi.
                        {picked.assignedBranchName
                          ? ` Filial: ${picked.assignedBranchName}.`
                          : ""}
                      </p>
                      <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {SHIFT_KEYS.map((opt) => (
                          <Button
                            key={opt.value}
                            size="sm"
                            type="button"
                            variant={shiftOnlyKey === opt.value ? "default" : "outline"}
                            onClick={() => setShiftOnlyKey(opt.value)}
                            className="h-auto flex-col gap-0.5 py-1.5"
                          >
                            <span className="text-xs">{opt.label}</span>
                            <span className="text-[9px] font-normal opacity-80">{opt.hint}</span>
                          </Button>
                        ))}
                      </div>
                      <Button
                        className="mt-2.5 w-full"
                        variant="secondary"
                        disabled={saveShiftOnly.isPending}
                        onClick={() => saveShiftOnly.mutate()}
                      >
                        {saveShiftOnly.isPending
                          ? t("ui.loading")
                          : "Smenani saqlash (filial o‘zgarmaydi)"}
                      </Button>
                    </div>
                  )}

                  {/* 2-QADAM: filial */}
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      2. {nextSlotNo === 1 ? "Yangi filial qo‘shish (ixtiyoriy)" : `${nextSlotNo}-filialni tanlang`}
                    </label>
                    <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
                      Faqat smena kerak bo‘lsa — yuqoridagi sariq blokdan foydalaning. Bu yerda yangi filial qo‘shiladi.
                    </p>
                    <SearchBox value={branchQ} onChange={setBranchQ} placeholder={t("smena.searchBranch")} />
                    <CompactList className="mt-2 max-h-64">
                      {branches.length === 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                          Filial topilmadi. Qidiruvni tozalang.
                        </p>
                      ) : (
                        branches.map(renderBranchRow)
                      )}
                    </CompactList>
                    {pickedBranch ? (
                      <p className="mt-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-foreground">
                        Tanlangan filial: <span className="text-primary">{pickedBranch.name}</span>
                      </p>
                    ) : (
                      <p className="mt-2 text-[11px] font-medium text-rose-600">Filialni bosing — tanlanmagan</p>
                    )}
                  </div>

                  {/* 3-QADAM: smena */}
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      3. Bu filialda qaysi smena?
                    </label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {SHIFT_KEYS.map((opt) => {
                        const taken = [...usedShiftsByPicked].some((u) => shiftConflicts(u, opt.value));
                        return (
                          <Button
                            key={opt.value}
                            size="sm"
                            type="button"
                            variant={pickedShift === opt.value ? "default" : "outline"}
                            disabled={taken}
                            onClick={() => setPickedShift(opt.value)}
                            className="flex h-auto flex-col gap-0.5 py-2"
                          >
                            <span>{opt.label}</span>
                            <span className="text-[10px] font-normal opacity-80">
                              {taken ? "band" : opt.hint}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      1+2 = 08:00–23:45 · 2+3 = 17:00–07:00. Yoki 1-filialga 1-smena, 2-filialga 2-smena.
                    </p>
                  </div>

                  {tab === "permanent" || tab === "period" || tab === "weekly" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                          {t("smena.validFrom")}
                        </label>
                        <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="h-9" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                          {tab === "permanent" ? t("smena.validToOptional") : t("smena.validTo")}
                        </label>
                        <Input
                          type="date"
                          value={validTo}
                          onChange={(e) => setValidTo(e.target.value)}
                          className="h-9"
                          required={tab === "period"}
                        />
                      </div>
                    </div>
                  ) : null}

                  {tab === "weekly" ? (
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("smena.weekdays")}
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {WEEKDAY_OPTIONS.map((d) => (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => toggleWeekday(d.value)}
                            className={cn(
                              "h-9 min-w-9 rounded-lg border px-2 text-xs font-semibold",
                              weekdays.includes(d.value)
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card text-muted-foreground",
                            )}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {tab === "days" ? (
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t("smena.workDates")}
                      </label>
                      <Calendar
                        mode="multiple"
                        selected={selectedDates}
                        onSelect={(days) => setSelectedDates(days || [])}
                        className="rounded-xl border"
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {workDates.length
                          ? `${workDates.length} kun · ${formatYmdDisplay(workDates[0]!)}${
                              workDates.length > 1 ? ` … ${formatYmdDisplay(workDates[workDates.length - 1]!)}` : ""
                            }`
                          : t("smena.pickDates")}
                      </p>
                    </div>
                  ) : null}

                  {/* Oldindan ko‘rinish */}
                  <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-2.5 text-xs">
                    <p className="font-semibold text-foreground">Saqlanadi:</p>
                    <p className="mt-1 text-muted-foreground">
                      {picked.fullName}
                      {" → "}
                      <span className="font-semibold text-foreground">
                        {pickedBranch?.name || "filial tanlanmagan"}
                      </span>
                      {" → "}
                      <span className="font-semibold text-foreground">
                        {SHIFT_KEYS.find((o) => o.value === pickedShift)?.label}
                      </span>
                      {" · "}
                      {tabs.find((x) => x.id === tab)?.label}
                      {nextSlotNo >= 2 ? ` · bu ${nextSlotNo}-filial` : " · bu 1-filial"}
                    </p>
                  </div>

                  <Button
                    className="w-full"
                    disabled={saveSlot.isPending || !pickedBranchId}
                    onClick={() => saveSlot.mutate()}
                  >
                    {saveSlot.isPending
                      ? t("ui.loading")
                      : nextSlotNo >= 2
                        ? `${nextSlotNo}-filialni saqlash`
                        : "1-filialni saqlash"}
                  </Button>
                </>
              ) : (
                <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  Avval yuqoridan xodimni tanlang — keyin filial va smena ochiladi.
                </p>
              )}
            </CardContent>
          </Card>

          {!pickedPersonId ? (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">{t("smena.slotsList")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pb-4">
                {slotsQ.isLoading ? (
                  <p className="text-xs text-muted-foreground">{t("ui.loading")}</p>
                ) : allSlotsList.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("smena.noSlots")}</p>
                ) : (
                  Object.entries(
                    allSlotsList.reduce<Record<string, WorkSlotItem[]>>((acc, s) => {
                      const key = String(s.employeeId);
                      (acc[key] ||= []).push(s);
                      return acc;
                    }, {}),
                  ).map(([empId, list]) => {
                    const first = list[0]!;
                    return (
                      <button
                        key={empId}
                        type="button"
                        className="w-full rounded-xl border border-border/80 px-3 py-2.5 text-left hover:bg-muted/40"
                        onClick={() => {
                          const person = staff.find((p) => p.id === Number(empId));
                          if (person) pickPerson(person);
                          else setPickedPersonId(Number(empId));
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">{first.fullName}</p>
                          <span className="shrink-0 text-[10px] font-bold text-muted-foreground">
                            {new Set(list.map((x) => x.branchId)).size}F / {list.length}S
                          </span>
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {list
                            .slice()
                            .sort((a, b) => String(a.shiftKey).localeCompare(String(b.shiftKey)))
                            .map((s) => (
                              <p key={s.id} className="truncate text-[11px] text-muted-foreground">
                                <span className="font-semibold text-foreground/80">{shiftLabelOf(s)}</span>
                                {" → "}
                                {s.branchLabel || `#${s.branchId}`}
                                {" · "}
                                {daysTextOf(s)}
                              </p>
                            ))}
                        </div>
                      </button>
                    );
                  })
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">{t("smena.viewOnlyHint")}</CardContent>
        </Card>
      )}
    </div>
  );
}
