import React, { useMemo, useState } from "react";
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
  ShieldAlert,
  Sparkles,
  Info,
  Calendar as CalendarIcon,
  CheckCircle2,
  AlertTriangle,
  Building2,
  ArrowRight,
  RefreshCw,
  Clock,
  Briefcase,
  Layers,
  SlidersHorizontal,
} from "lucide-react";
import ShiftChangeBoard from "./ShiftChangeBoard";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Calendar } from "../../components/ui/calendar";
import { useToast } from "../../hooks/use-toast";
import { useAuth } from "../../contexts/AuthContext";
import { canManageSmenaFilial } from "../../lib/roles";
import { cn } from "../../lib/utils";
import { formatYmdDisplay } from "../../lib/javob-olish-api";
import {
  createWorkSlot,
  deleteWorkSlot,
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
  type StaffMonitoringItem,
} from "../../lib/smena-api";

export const SHIFT_CONFIG: Record<
  SlotShiftKey,
  {
    label: string;
    badge: string;
    hours: string;
    duration: string;
    checkoutHint: string;
    borderTone: string;
    bgTone: string;
  }
> = {
  one: {
    label: "1-smena",
    badge: "Kunduzgi",
    hours: "08:00 – 17:00",
    duration: "9 soat",
    checkoutHint: "Chiqish (Ketdim): 23:55 gacha",
    borderTone: "border-sky-300 dark:border-sky-700",
    bgTone: "bg-sky-500/10 text-sky-800 dark:text-sky-200",
  },
  two: {
    label: "2-smena",
    badge: "Kechki",
    hours: "17:00 – 23:45",
    duration: "6 soat 45 daq",
    checkoutHint: "Chiqish (Ketdim): ertasi 02:00 gacha",
    borderTone: "border-amber-300 dark:border-amber-700",
    bgTone: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
  },
  "one+two": {
    label: "1+2 smena",
    badge: "Kun bo‘yi / To‘liq",
    hours: "08:00 – 23:45",
    duration: "15 soat 45 daq",
    checkoutHint: "Chiqish (Ketdim): ertasi 02:00 gacha",
    borderTone: "border-emerald-300 dark:border-emerald-700",
    bgTone: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  },
  "two+three": {
    label: "2+3 smena",
    badge: "Kechki + Tungi",
    hours: "17:00 – 07:00",
    duration: "14 soat",
    checkoutHint: "Chiqish (Ketdim): ertalab 10:00 gacha",
    borderTone: "border-purple-300 dark:border-purple-700",
    bgTone: "bg-purple-500/10 text-purple-800 dark:text-purple-200",
  },
  three: {
    label: "3-smena",
    badge: "Tungi navbatchilik",
    hours: "23:00 – 07:00",
    duration: "8 soat",
    checkoutHint: "Chiqish (Ketdim): ertalab 10:00 gacha",
    borderTone: "border-indigo-300 dark:border-indigo-700",
    bgTone: "bg-indigo-500/10 text-indigo-800 dark:text-indigo-200",
  },
};

const SHIFT_KEYS: SlotShiftKey[] = ["one", "two", "one+two", "two+three", "three"];

function orgLabel(org: string | null) {
  if (org === "pharmacist") return "Farmasevt";
  if (org === "intern") return "Stajyor";
  if (org === "manager") return "Mudir";
  return "Xodim";
}

function modeLabelUz(mode: SlotMode | string): string {
  if (mode === "permanent") return "Doimiy";
  if (mode === "period") return "Muddatli";
  if (mode === "weekly") return "Haftalik";
  if (mode === "days") return "Kunlik";
  return String(mode);
}

function shiftDisplayLabel(key: string): string {
  const norm = String(key || "").toLowerCase();
  if (norm === "one" || norm === "1") return "1-smena";
  if (norm === "two" || norm === "2") return "2-smena";
  if (norm === "three" || norm === "3") return "3-smena";
  if (norm === "one+two" || norm === "1+2") return "1+2 smena";
  if (norm === "two+three" || norm === "2+3") return "2+3 smena";
  return key;
}

export default function SmenaFilialPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const isAllowed = canManageSmenaFilial(user?.role);

  // Asosiy yorliq: "create" (Yangi rotatsiya), "shift" (Smena o‘zgartirish) yoki "monitoring" (Baza va tarix)
  const [activeMainTab, setActiveMainTab] = useState<"create" | "shift" | "monitoring">("create");

  // Rotatsiya rejimi: doimiy, muddatli, haftalik, kunlik
  const [mode, setMode] = useState<SlotMode>("permanent");

  // Tanlangan xodim, filial va smena
  const [pickedPersonId, setPickedPersonId] = useState<number | null>(null);
  const [pickedBranchId, setPickedBranchId] = useState<number | null>(null);
  const [pickedShift, setPickedShift] = useState<SlotShiftKey>("one");

  // Qidiruvlar
  const [peopleQ, setPeopleQ] = useState("");
  const [branchQ, setBranchQ] = useState("");

  // Rejimga oid ma'lumotlar
  const todayYmd = useMemo(() => todayTashkentYmd(), []);
  const [validFrom, setValidFrom] = useState(todayYmd);
  const [validTo, setValidTo] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);

  // Monitoring filtrlari
  const [monitoringSearch, setMonitoringSearch] = useState("");
  const [monitoringStatusFilter, setMonitoringStatusFilter] = useState<"all" | "active" | "expired">("all");
  const [monitoringModeFilter, setMonitoringModeFilter] = useState<string>("all");

  // Slot smenasini tahrirlash
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [editShiftKey, setEditShiftKey] = useState<SlotShiftKey>("one");

  // API so'rovlari
  const meQ = useQuery({
    queryKey: ["smena-me"],
    queryFn: fetchSmenaMe,
    enabled: isAllowed,
  });

  const slotsQ = useQuery({
    queryKey: ["smena-slots-all"],
    queryFn: fetchAllWorkSlots,
    enabled: isAllowed,
  });

  const data = meQ.data;
  const staff = data?.assignable ?? [];
  const branches = data?.branches ?? [];
  const allSlots = slotsQ.data?.items ?? [];
  const liveMonitoring = slotsQ.data?.staffMonitoring ?? [];

  // Tanlangan xodim
  const pickedPerson = useMemo(
    () => staff.find((p) => p.id === pickedPersonId) ?? null,
    [staff, pickedPersonId]
  );

  // Tanlangan filial
  const pickedBranch = useMemo(
    () => branches.find((b) => b.id === pickedBranchId) ?? null,
    [branches, pickedBranchId]
  );

  // Xodimlar ro'yxatini filtrlash
  const filteredStaff = useMemo(() => {
    const q = peopleQ.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        (p.assignedBranchName || "").toLowerCase().includes(q)
    );
  }, [staff, peopleQ]);

  // Filiallar ro'yxatini filtrlash
  const filteredBranches = useMemo(() => {
    const q = branchQ.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.managerName || "").toLowerCase().includes(q)
    );
  }, [branches, branchQ]);

  // Tanlangan xodimning mavjud slotlari
  const slotsForPicked = useMemo(() => {
    if (!pickedPersonId) return [];
    return allSlots.filter((s) => s.employeeId === pickedPersonId && s.active);
  }, [allSlots, pickedPersonId]);

  // Rotatsiya saqlash mutatsiyasi
  const saveRotationMutation = useMutation({
    mutationFn: async () => {
      if (!pickedPersonId) throw new Error("Iltimos, avval xodimni tanlang");
      if (!pickedBranchId) throw new Error("Iltimos, filialni tanlang");
      if (!pickedShift) throw new Error("Iltimos, smenani tanlang");

      if (mode === "period") {
        if (!validTo) throw new Error("Muddatli rotatsiyada tugash sanasi majburiy!");
        if (validTo < validFrom) throw new Error("Tugash sanasi boshlanish sanasidan oldin bo‘lmasin!");
      }

      if (mode === "weekly" && !weekdays.length) {
        throw new Error("Haftalik rotatsiyada kamida bitta hafta kunini tanlang!");
      }

      let workDates: string[] | undefined = undefined;
      if (mode === "days") {
        if (!selectedDates.length) throw new Error("Kunlik rotatsiyada kamida 1 ta sana tanlang!");
        workDates = selectedDates
          .map((d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${day}`;
          })
          .sort();
      }

      return createWorkSlot({
        employeeId: pickedPersonId,
        branchId: pickedBranchId,
        shiftKey: pickedShift,
        mode,
        validFrom: mode === "permanent" ? todayYmd : mode === "days" ? workDates![0] : validFrom,
        validTo: mode === "permanent" ? null : mode === "period" ? validTo : null,
        weekdays: mode === "weekly" ? weekdays : undefined,
        workDates: mode === "days" ? workDates : undefined,
      });
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["smena-slots-all"] });
      void qc.invalidateQueries({ queryKey: ["smena-me"] });
      toast({
        title: "Rotatsiya muvaffaqiyatli saqlandi! 🎉",
        description: `${pickedPerson?.fullName} → ${pickedBranch?.name} (${SHIFT_CONFIG[pickedShift]?.label})`,
      });
      // Filialni tozalash
      setPickedBranchId(null);
      setBranchQ("");
    },
    onError: (err: Error) => {
      toast({
        title: "Xatolik yuz berdi",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Slot o'chirish (bekor qilish)
  const removeSlotMutation = useMutation({
    mutationFn: (id: number) => deleteWorkSlot(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["smena-slots-all"] });
      void qc.invalidateQueries({ queryKey: ["smena-me"] });
      toast({ title: "Rotatsiya bekor qilindi (o‘chirildi)" });
    },
    onError: (err: Error) => {
      toast({ title: "O‘chirishda xatolik", description: err.message, variant: "destructive" });
    },
  });

  // Slot smenasini o'zgartirish
  const updateShiftMutation = useMutation({
    mutationFn: ({ slotId, shiftKey }: { slotId: number; shiftKey: SlotShiftKey }) =>
      updateWorkSlotShift(slotId, shiftKey),
    onSuccess: () => {
      setEditingSlotId(null);
      void qc.invalidateQueries({ queryKey: ["smena-slots-all"] });
      void qc.invalidateQueries({ queryKey: ["smena-me"] });
      toast({ title: "Smena muvaffaqiyatli yangilandi!" });
    },
    onError: (err: Error) => {
      toast({ title: "Smenani o‘zgartirishda xatolik", description: err.message, variant: "destructive" });
    },
  });

  function toggleWeekday(d: number) {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );
  }

  // Monitoring filtriga tushadigan slotlar
  const filteredSlots = useMemo(() => {
    return allSlots.filter((s) => {
      // Qidiruv
      if (monitoringSearch) {
        const q = monitoringSearch.toLowerCase();
        const matchesName = (s.fullName || "").toLowerCase().includes(q);
        const matchesBranch = (s.branchLabel || "").toLowerCase().includes(q);
        if (!matchesName && !matchesBranch) return false;
      }
      // Holat filtri
      if (monitoringStatusFilter === "active" && s.isExpired) return false;
      if (monitoringStatusFilter === "expired" && !s.isExpired) return false;
      // Rejim filtri
      if (monitoringModeFilter !== "all" && s.mode !== monitoringModeFilter) return false;
      return true;
    });
  }, [allSlots, monitoringSearch, monitoringStatusFilter, monitoringModeFilter]);

  // Ruxsat yo'q bo'lsa
  if (!isAllowed) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Card className="border-rose-300 bg-rose-50/70 text-center dark:border-rose-900/50 dark:bg-rose-950/20">
          <CardContent className="space-y-3 py-8">
            <ShieldAlert className="mx-auto h-12 w-12 text-rose-600" />
            <h2 className="text-lg font-bold text-rose-900 dark:text-rose-200">
              Ruxsat berilmagan
            </h2>
            <p className="text-sm text-rose-700 dark:text-rose-300">
              Smena va filial boshqaruvi (rotatsiya) faqat <strong>HR menejer</strong> va{" "}
              <strong>Admin</strong> uchun ochiq.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 pb-28 sm:p-6">
      {/* Sarlavha va Umumiy Ma'lumot */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-primary/10 p-2 text-primary">
              <Building2 className="h-5 w-5" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Smena va filial · Rotatsiya boshqaruvi
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Xodimlarni boshqa dorixonaga doimiy yoki vaqtincha biriktirish, smena va ish soatlarini nazorat qilish
          </p>
        </div>

        {/* Asosiy yorliqlar: Yangi rotatsiya / Baza monitoring */}
        <div className="flex rounded-xl border border-border bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => setActiveMainTab("create")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
              activeMainTab === "create"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <RefreshCw className="h-4 w-4" />
            Yangi rotatsiya
          </button>
          <button
            type="button"
            onClick={() => setActiveMainTab("shift")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
              activeMainTab === "shift"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Smena o‘zgartirish
          </button>
          <button
            type="button"
            onClick={() => setActiveMainTab("monitoring")}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition",
              activeMainTab === "monitoring"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Layers className="h-4 w-4" />
            Monitoring va Baza
            {allSlots.length > 0 && (
              <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 py-0.2 text-xs">
                {allSlots.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeMainTab === "shift" && <ShiftChangeBoard />}

      {/* Tushuntirish / Yo'riqnoma bloki */}
      <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4", activeMainTab === "shift" && "hidden")}>
        {/* 1. Doimiy */}
        <div
          onClick={() => {
            setMode("permanent");
            setActiveMainTab("create");
          }}
          className={cn(
            "cursor-pointer rounded-2xl border p-4 transition hover:shadow-md",
            mode === "permanent" && activeMainTab === "create"
              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
              : "border-border bg-card hover:border-primary/40"
          )}
        >
          <div className="flex items-center gap-2.5">
            <span className="rounded-xl bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
              <MapPin className="h-4 w-4" />
            </span>
            <h3 className="font-bold text-foreground">Doimiy rotatsiya</h3>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Xodimni yangi filialga <strong>doimiy o‘tkazish</strong>. Hech qanday muddat talab etilmaydi.
            Shu kundan yangi joyda bemalol davomat qiladi.
          </p>
          <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-primary">
            <span>Tanlash</span>
            <ArrowRight className="h-3 w-3" />
          </div>
        </div>

        {/* 2. Muddatli */}
        <div
          onClick={() => {
            setMode("period");
            setActiveMainTab("create");
          }}
          className={cn(
            "cursor-pointer rounded-2xl border p-4 transition hover:shadow-md",
            mode === "period" && activeMainTab === "create"
              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
              : "border-border bg-card hover:border-primary/40"
          )}
        >
          <div className="flex items-center gap-2.5">
            <span className="rounded-xl bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
              <Clock3 className="h-4 w-4" />
            </span>
            <h3 className="font-bold text-foreground">Muddatli rotatsiya</h3>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Ma'lum <strong>muddatgacha</strong> biriktiriladi. Muddat tugashi bilan xabar chiqadi va
            xodim avtomatik o‘zining asosiy filialiga qaytadi.
          </p>
          <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-primary">
            <span>Tanlash</span>
            <ArrowRight className="h-3 w-3" />
          </div>
        </div>

        {/* 3. Haftalik */}
        <div
          onClick={() => {
            setMode("weekly");
            setActiveMainTab("create");
          }}
          className={cn(
            "cursor-pointer rounded-2xl border p-4 transition hover:shadow-md",
            mode === "weekly" && activeMainTab === "create"
              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
              : "border-border bg-card hover:border-primary/40"
          )}
        >
          <div className="flex items-center gap-2.5">
            <span className="rounded-xl bg-purple-500/10 p-2 text-purple-600 dark:text-purple-400">
              <Repeat className="h-4 w-4" />
            </span>
            <h3 className="font-bold text-foreground">Haftalik rotatsiya</h3>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Haftaning <strong>tanlangan kunlarida</strong> (masalan faqat Shanba/Yakshanba) kelib ishlab beradi.
            Qolgan kunlar asosiy joyida ishlaydi.
          </p>
          <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-primary">
            <span>Tanlash</span>
            <ArrowRight className="h-3 w-3" />
          </div>
        </div>

        {/* 4. Kunlik */}
        <div
          onClick={() => {
            setMode("days");
            setActiveMainTab("create");
          }}
          className={cn(
            "cursor-pointer rounded-2xl border p-4 transition hover:shadow-md",
            mode === "days" && activeMainTab === "create"
              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
              : "border-border bg-card hover:border-primary/40"
          )}
        >
          <div className="flex items-center gap-2.5">
            <span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
              <CalendarDays className="h-4 w-4" />
            </span>
            <h3 className="font-bold text-foreground">Kunlik rotatsiya</h3>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Faqat <strong>belgilangan kun(lar)</strong> uchun amal qiladi. Shu kun o‘tgach avtomatik o‘z
            asosiy filialiga qaytadi.
          </p>
          <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-primary">
            <span>Tanlash</span>
            <ArrowRight className="h-3 w-3" />
          </div>
        </div>
      </div>

      {/* 1-TAB: YANGI ROTATSIYA BIRIKTIRISH */}
      {activeMainTab === "create" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Chap ustun: 3 qadamli forma */}
          <div className="space-y-5 lg:col-span-7">
            <Card className="border-border shadow-sm">
              <CardHeader className="border-b bg-muted/20 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                      {modeLabelUz(mode)}
                    </span>
                    <CardTitle className="text-base">
                      {mode === "permanent" && "Doimiy rotatsiya biriktirish"}
                      {mode === "period" && "Muddatli rotatsiya biriktirish"}
                      {mode === "weekly" && "Haftalik rotatsiya biriktirish"}
                      {mode === "days" && "Kunlik rotatsiya biriktirish"}
                    </CardTitle>
                  </div>
                  {mode === "permanent" && (
                    <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      Muddat talab etilmaydi
                    </span>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-5">
                {/* 1-QADAM: Xodimni tanlash */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-foreground">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                        1
                      </span>
                      Xodimni tanlang (Farmasevt / Stajyor)
                    </label>
                    {pickedPerson && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setPickedPersonId(null);
                          setPickedBranchId(null);
                        }}
                      >
                        Boshqa xodim
                      </Button>
                    )}
                  </div>

                  {pickedPerson ? (
                    <div className="flex items-center justify-between rounded-xl border border-primary/40 bg-primary/5 p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                          {pickedPerson.fullName.charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">{pickedPerson.fullName}</p>
                          <p className="text-xs text-muted-foreground">
                            {orgLabel(pickedPerson.orgRole)} · Hozirgi asosiy filiali:{" "}
                            <span className="font-medium text-foreground">
                              {pickedPerson.assignedBranchName || "Biriktirilmagan"}
                            </span>
                          </p>
                        </div>
                      </div>
                      <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        Tanlandi ✓
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          value={peopleQ}
                          onChange={(e) => setPeopleQ(e.target.value)}
                          placeholder="Xodim ism-familiyasi bo‘yicha qidirish..."
                          className="pl-9"
                        />
                      </div>
                      <div className="max-h-52 overflow-y-auto rounded-xl border border-border bg-card divide-y divide-border/60">
                        {filteredStaff.length === 0 ? (
                          <p className="p-4 text-center text-xs text-muted-foreground">
                            Xodim topilmadi. Qidiruvni o‘zgartiring.
                          </p>
                        ) : (
                          filteredStaff.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setPickedPersonId(p.id);
                                setPeopleQ("");
                              }}
                              className="flex w-full items-center justify-between p-3 text-left transition hover:bg-muted/60"
                            >
                              <div>
                                <p className="text-sm font-semibold text-foreground">{p.fullName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {orgLabel(p.orgRole)} · Filial: {p.assignedBranchName || "Yo‘q"}
                                </p>
                              </div>
                              <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                                Tanlash
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2-QADAM: Yangi filialni tanlash */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-foreground">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                        2
                      </span>
                      Rotatsiya qilinadigan filialni tanlang
                    </label>
                    {pickedBranch && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setPickedBranchId(null)}
                      >
                        Boshqa filial
                      </Button>
                    )}
                  </div>

                  {pickedBranch ? (
                    <div className="flex items-center justify-between rounded-xl border border-primary/40 bg-primary/5 p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Building2 className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">{pickedBranch.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Mudir: {pickedBranch.managerName || "Mudir belgilanmagan"} · GPS:{" "}
                            {pickedBranch.hasGps ? "Mavjud ✓" : "Kiritilmagan"}
                          </p>
                        </div>
                      </div>
                      <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        Tanlandi ✓
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          value={branchQ}
                          onChange={(e) => setBranchQ(e.target.value)}
                          placeholder="Filial nomi yoki mudir bo‘yicha qidirish..."
                          className="pl-9"
                        />
                      </div>
                      <div className="max-h-52 overflow-y-auto rounded-xl border border-border bg-card divide-y divide-border/60">
                        {filteredBranches.length === 0 ? (
                          <p className="p-4 text-center text-xs text-muted-foreground">
                            Filial topilmadi.
                          </p>
                        ) : (
                          filteredBranches.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => {
                                setPickedBranchId(b.id);
                                setBranchQ("");
                              }}
                              className="flex w-full items-center justify-between p-3 text-left transition hover:bg-muted/60"
                            >
                              <div>
                                <p className="text-sm font-semibold text-foreground">{b.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  Mudir: {b.managerName}
                                </p>
                              </div>
                              <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                                Tanlash
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 3-QADAM: Smenani tanlash (Majburiy) */}
                <div className="space-y-3">
                  <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-foreground">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                      3
                    </span>
                    Smena va ish vaqtini belgilang (Majburiy)
                  </label>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {SHIFT_KEYS.map((sk) => {
                      const cfg = SHIFT_CONFIG[sk];
                      const isSelected = pickedShift === sk;
                      return (
                        <button
                          key={sk}
                          type="button"
                          onClick={() => setPickedShift(sk)}
                          className={cn(
                            "flex flex-col items-start rounded-xl border p-3 text-left transition",
                            isSelected
                              ? "border-primary bg-primary/10 shadow-sm ring-2 ring-primary/20"
                              : "border-border bg-card hover:border-primary/40 hover:bg-muted/30"
                          )}
                        >
                          <div className="flex w-full items-center justify-between">
                            <span className="text-sm font-bold text-foreground">{cfg.label}</span>
                            {isSelected && <Check className="h-4 w-4 text-primary" />}
                          </div>
                          <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                            {cfg.badge}
                          </span>
                          <span className="mt-2 text-xs font-bold text-foreground">
                            {cfg.hours}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            Davomiyligi: {cfg.duration}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Dinamik vaqt tafsiloti */}
                  {pickedShift && (
                    <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div>
                        <p className="font-semibold text-foreground">
                          {SHIFT_CONFIG[pickedShift]?.label} ({SHIFT_CONFIG[pickedShift]?.badge}):{" "}
                          <span className="text-primary">{SHIFT_CONFIG[pickedShift]?.hours}</span>
                          {" · "}
                          {SHIFT_CONFIG[pickedShift]?.duration}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          {SHIFT_CONFIG[pickedShift]?.checkoutHint}. Davomat ochilgan filialda qabul qilinadi.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* 4-QADAM (REJIMGA QARAB MUDDAT / KUNLAR) */}
                {mode === "permanent" && (
                  <div className="rounded-xl border border-emerald-300/60 bg-emerald-50/70 p-3.5 dark:border-emerald-800/40 dark:bg-emerald-950/20">
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div>
                        <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                          Doimiy rotatsiya: Muddat kiritish shart emas!
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-800/80 dark:text-emerald-300/80">
                          Xodim bugundan boshlab yangi filialga to‘liq biriktiriladi va o‘sha joydan
                          bemalol doimiy davomat qila oladi. Oldingi ziddiyatli biriktirishlar avtomatik yangilanadi.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {mode === "period" && (
                  <div className="space-y-2 rounded-xl border border-amber-300/60 bg-amber-50/70 p-3.5 dark:border-amber-800/40 dark:bg-amber-950/20">
                    <p className="text-xs font-bold text-amber-950 dark:text-amber-100">
                      Amal qilish muddatini kiriting:
                    </p>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                          Boshlanish sanasi:
                        </label>
                        <Input
                          type="date"
                          value={validFrom}
                          onChange={(e) => setValidFrom(e.target.value)}
                          className="mt-1 h-9 bg-card"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                          Tugash sanasi (Majburiy):
                        </label>
                        <Input
                          type="date"
                          value={validTo}
                          onChange={(e) => setValidTo(e.target.value)}
                          className="mt-1 h-9 bg-card"
                          required
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
                      ⚠️ Belgilangan tugash sanasi o‘tgach, tizimda «Rotatsiya muddati tugadi» statusi
                      chiqadi va xodim o‘zining asosiy filialiga qaytadi.
                    </p>
                  </div>
                )}

                {mode === "weekly" && (
                  <div className="space-y-2 rounded-xl border border-purple-300/60 bg-purple-50/70 p-3.5 dark:border-purple-800/40 dark:bg-purple-950/20">
                    <p className="text-xs font-bold text-purple-950 dark:text-purple-100">
                      Haftaning qaysi kunlarida shu filialda ishlaydi?
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {WEEKDAY_OPTIONS.map((d) => {
                        const on = weekdays.includes(d.value);
                        return (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => toggleWeekday(d.value)}
                            className={cn(
                              "h-9 min-w-10 rounded-lg px-3 text-xs font-bold transition",
                              on
                                ? "bg-purple-600 text-white shadow-sm"
                                : "border border-border bg-card text-foreground hover:bg-muted"
                            )}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-purple-800/80 dark:text-purple-300/80">
                      Xodim haftaning faqat tanlangan kunlarida ushbu filialda ishlaydi, qolgan kunlari esa
                      asosiy filialida davom etadi.
                    </p>
                  </div>
                )}

                {mode === "days" && (
                  <div className="space-y-2 rounded-xl border border-emerald-300/60 bg-emerald-50/70 p-3.5 dark:border-emerald-800/40 dark:bg-emerald-950/20">
                    <p className="text-xs font-bold text-emerald-950 dark:text-emerald-100">
                      Kalendardan belgilangan kunlarni tanlang:
                    </p>
                    <div className="flex justify-center rounded-xl bg-card p-2">
                      <Calendar
                        mode="multiple"
                        selected={selectedDates}
                        onSelect={(days) => setSelectedDates(days || [])}
                      />
                    </div>
                    <p className="text-center text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                      Tanlangan kunlar soni: {selectedDates.length} ta
                    </p>
                  </div>
                )}

                {/* Saqlash tugmasi */}
                <Button
                  className="w-full text-sm font-bold shadow-md"
                  size="lg"
                  disabled={
                    !pickedPersonId ||
                    !pickedBranchId ||
                    !pickedShift ||
                    (mode === "period" && !validTo) ||
                    (mode === "weekly" && !weekdays.length) ||
                    (mode === "days" && !selectedDates.length) ||
                    saveRotationMutation.isPending
                  }
                  onClick={() => saveRotationMutation.mutate()}
                >
                  {saveRotationMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Saqlanmoqda...
                    </span>
                  ) : (
                    <span>Rotatsiyani tasdiqlash va saqlash ✓</span>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* O'ng ustun: Tanlangan xodimning hozirgi kartochkasi va oldindan ko'rish */}
          <div className="space-y-5 lg:col-span-5">
            {/* Oldindan ko'rish (Preview) */}
            <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold text-foreground">
                  Yangi rotatsiya xulosasi
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="space-y-1.5 rounded-xl border border-border/80 bg-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Xodim:</span>
                    <span className="font-semibold text-foreground">
                      {pickedPerson?.fullName || "— Tanlanmagan"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Yangi filial:</span>
                    <span className="font-semibold text-foreground">
                      {pickedBranch?.name || "— Tanlanmagan"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Smena:</span>
                    <span className="font-semibold text-foreground">
                      {SHIFT_CONFIG[pickedShift]?.label} ({SHIFT_CONFIG[pickedShift]?.hours})
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Rotatsiya turi:</span>
                    <span className="font-semibold text-primary">{modeLabelUz(mode)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Amal qilish vaqti:</span>
                    <span className="font-semibold text-foreground">
                      {mode === "permanent" && "Cheksiz (Doimiy)"}
                      {mode === "period" && (validTo ? `${validFrom} dan ${validTo} gacha` : "Kiritilmoqda")}
                      {mode === "weekly" && `${weekdays.length} ta hafta kuni`}
                      {mode === "days" && `${selectedDates.length} ta kun`}
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-xl bg-muted/60 p-2.5 text-[11px] text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>
                    Saqlangandan so‘ng xodim yangi filialda belgilangan smena soatlari bo‘yicha davomat
                    qila oladi.
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Tanlangan xodimning barcha biriktirishlari */}
            {pickedPerson && (
              <Card className="border-border shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold text-foreground">
                    {pickedPerson.fullName} ning joriy slotlari
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5 text-xs">
                  {slotsForPicked.length === 0 ? (
                    <p className="text-muted-foreground">
                      Hozircha qo‘shimcha rotatsiya sloti yo‘q (faqat asosiy filial:{" "}
                      {pickedPerson.assignedBranchName || "yo‘q"}).
                    </p>
                  ) : (
                    slotsForPicked.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-start justify-between rounded-xl border border-border bg-card p-3 shadow-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                              {modeLabelUz(s.mode)}
                            </span>
                            <span className="font-semibold text-foreground">
                              {shiftDisplayLabel(s.shiftKey)}
                            </span>
                          </div>
                          <p className="font-medium text-foreground">
                            {s.branchLabel || `#${s.branchId}`}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {s.mode === "period"
                              ? `${s.validFrom} → ${s.validTo || "cheksiz"}`
                              : s.mode === "weekly"
                              ? `Hafta kunlari: ${(s.weekdays || []).join(", ")}`
                              : "Har kuni"}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                          onClick={() => {
                            if (window.confirm("Rostdan ham ushbu rotatsiyani bekor qilmoqchimisiz?")) {
                              removeSlotMutation.mutate(s.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* 2-TAB: MONITORING VA TARIX BAZASI */}
      {activeMainTab === "monitoring" && (
        <div className="space-y-6">
          {/* Jonli holat: Ayni vaqtda xodimlar qayerda */}
          <Card className="border-border shadow-sm">
            <CardHeader className="border-b bg-muted/20 pb-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-foreground">
                    Ayni vaqtda xodimlar qayerda? (Jonli monitoring)
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Bugungi kun bo‘yicha har bir xodimning ayni paytdagi filiali va smenasi
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    🟢 Bugun: {todayYmd}
                  </span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-2.5 px-3">Xodim (F.I.Sh)</th>
                      <th className="py-2.5 px-3">Lavozimi</th>
                      <th className="py-2.5 px-3">Asosiy filiali</th>
                      <th className="py-2.5 px-3">Bugungi filiali</th>
                      <th className="py-2.5 px-3">Bugungi smenasi</th>
                      <th className="py-2.5 px-3">Ish soati</th>
                      <th className="py-2.5 px-3">Holati</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {liveMonitoring.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-muted-foreground">
                          Xodimlar topilmadi.
                        </td>
                      </tr>
                    ) : (
                      liveMonitoring.map((row) => {
                        const isRotated = row.todayBranchId !== row.primaryBranchId;
                        const shiftCfg = SHIFT_CONFIG[row.todayShiftKey as SlotShiftKey];
                        return (
                          <tr key={row.employeeId} className="hover:bg-muted/30">
                            <td className="py-3 px-3 font-semibold text-foreground">
                              {row.fullName}
                            </td>
                            <td className="py-3 px-3 text-muted-foreground">
                              {orgLabel(row.orgRole)}
                            </td>
                            <td className="py-3 px-3 text-muted-foreground">
                              {row.primaryBranchName || "—"}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={cn(
                                  "font-medium",
                                  isRotated ? "font-bold text-primary" : "text-foreground"
                                )}
                              >
                                {row.todayBranchLabel || "—"}
                              </span>
                              {isRotated && (
                                <span className="ml-1.5 rounded bg-primary/15 px-1 py-0.2 text-[10px] font-bold text-primary">
                                  Rotatsiyada
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 font-semibold text-foreground">
                              {row.todayShiftLabel}
                            </td>
                            <td className="py-3 px-3 text-muted-foreground">
                              {shiftCfg?.hours || "08:00–17:00"}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                                  isRotated
                                    ? "bg-purple-500/15 text-purple-700 dark:text-purple-300"
                                    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                )}
                              >
                                {isRotated ? modeLabelUz(row.todayMode) : "Asosiy joyida"}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Tarix va barcha rotatsiya slotlari bazasi */}
          <Card className="border-border shadow-sm">
            <CardHeader className="border-b bg-muted/20 pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-foreground">
                    Rotatsiyalar bazasi va tarixi
                  </CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Kim qachon biriktirilgan, amal qilish muddati, smenasi va holati
                  </p>
                </div>

                {/* Filtrlar */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[200px]">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={monitoringSearch}
                      onChange={(e) => setMonitoringSearch(e.target.value)}
                      placeholder="Xodim yoki filial qidirish..."
                      className="h-8 pl-8 text-xs"
                    />
                  </div>

                  <select
                    value={monitoringStatusFilter}
                    onChange={(e) => setMonitoringStatusFilter(e.target.value as any)}
                    className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground"
                  >
                    <option value="all">Barcha holatlar</option>
                    <option value="active">🟢 Faol biriktirishlar</option>
                    <option value="expired">🔴 Muddati tugaganlar</option>
                  </select>

                  <select
                    value={monitoringModeFilter}
                    onChange={(e) => setMonitoringModeFilter(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground"
                  >
                    <option value="all">Barcha turlar</option>
                    <option value="permanent">Doimiy</option>
                    <option value="period">Muddatli</option>
                    <option value="weekly">Haftalik</option>
                    <option value="days">Kunlik</option>
                  </select>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-2.5 px-3">Xodim</th>
                      <th className="py-2.5 px-3">Rotatsiya filiali</th>
                      <th className="py-2.5 px-3">Smena va soat</th>
                      <th className="py-2.5 px-3">Rejim</th>
                      <th className="py-2.5 px-3">Amal qilish muddati</th>
                      <th className="py-2.5 px-3">Holati</th>
                      <th className="py-2.5 px-3">Biriktirgan</th>
                      <th className="py-2.5 px-3 text-right">Amallar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredSlots.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-muted-foreground">
                          Rotatsiyalar mavjud emas yoki filterga mos kelmadi.
                        </td>
                      </tr>
                    ) : (
                      filteredSlots.map((slot) => {
                        const shiftCfg = SHIFT_CONFIG[slot.shiftKey as SlotShiftKey];
                        const isExpired = Boolean(slot.isExpired);
                        const isEditingThis = editingSlotId === slot.id;

                        return (
                          <tr
                            key={slot.id}
                            className={cn(
                              "transition hover:bg-muted/30",
                              isExpired && "bg-rose-50/40 dark:bg-rose-950/10"
                            )}
                          >
                            <td className="py-3 px-3">
                              <p className="font-semibold text-foreground">{slot.fullName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                Asosiy joyi: {slot.primaryBranchName || "—"}
                              </p>
                            </td>

                            <td className="py-3 px-3 font-semibold text-foreground">
                              {slot.branchLabel || `#${slot.branchId}`}
                            </td>

                            <td className="py-3 px-3">
                              {isEditingThis ? (
                                <div className="flex items-center gap-1.5">
                                  <select
                                    value={editShiftKey}
                                    onChange={(e) => setEditShiftKey(e.target.value as SlotShiftKey)}
                                    className="h-7 rounded border border-primary bg-card px-1 text-xs"
                                  >
                                    {SHIFT_KEYS.map((k) => (
                                      <option key={k} value={k}>
                                        {SHIFT_CONFIG[k].label}
                                      </option>
                                    ))}
                                  </select>
                                  <Button
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    disabled={updateShiftMutation.isPending}
                                    onClick={() =>
                                      updateShiftMutation.mutate({
                                        slotId: slot.id,
                                        shiftKey: editShiftKey,
                                      })
                                    }
                                  >
                                    Saqlash
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-1.5 text-xs"
                                    onClick={() => setEditingSlotId(null)}
                                  >
                                    Bekor
                                  </Button>
                                </div>
                              ) : (
                                <div>
                                  <p className="font-semibold text-foreground">
                                    {shiftDisplayLabel(slot.shiftKey)}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {shiftCfg?.hours} ({shiftCfg?.duration})
                                  </p>
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-3">
                              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                                {slot.overrideBase ? "Haftalik (smena almashtirish)" : modeLabelUz(slot.mode)}
                              </span>
                            </td>

                            <td className="py-3 px-3 text-muted-foreground">
                              {slot.mode === "permanent" && "Doimiy (Cheksiz)"}
                              {slot.mode === "period" &&
                                `${formatYmdDisplay(slot.validFrom)} → ${
                                  slot.validTo ? formatYmdDisplay(slot.validTo) : "cheksiz"
                                }`}
                              {slot.mode === "weekly" &&
                                `Har: ${(slot.weekdays || [])
                                  .map((w) => WEEKDAY_OPTIONS.find((o) => o.value === w)?.label || w)
                                  .join(", ")}`}
                              {slot.mode === "days" &&
                                `${(slot.workDates || []).length} ta sana`}
                            </td>

                            <td className="py-3 px-3">
                              {isExpired ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-bold text-rose-700 dark:text-rose-300">
                                  🔴 Rotatsiya muddati tugadi
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                                  🟢 Faol
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-3 text-muted-foreground">
                              <p className="font-medium text-foreground">
                                {slot.createdByName || "Admin / HR"}
                              </p>
                              {slot.createdAt && (
                                <p className="text-[10px] text-muted-foreground">
                                  {new Date(slot.createdAt).toLocaleDateString("uz-UZ", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </p>
                              )}
                            </td>

                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                {!isEditingThis && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => {
                                      setEditingSlotId(slot.id);
                                      setEditShiftKey(slot.shiftKey);
                                    }}
                                  >
                                    Smenani o‘zgartirish
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                                  title="Rotatsiyani o‘chirish"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `«${slot.fullName}» ning «${slot.branchLabel}» filialidagi rotatsiyasini bekor qilmoqchimisiz?`
                                      )
                                    ) {
                                      removeSlotMutation.mutate(slot.id);
                                    }
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
