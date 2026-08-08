import React, { useEffect, useMemo, useState } from "react";
import {
  ClipboardCheck,
  CalendarDays,
  Store,
  User,
  RotateCcw,
  Check,
  X,
  Save,
  FolderOpen,
  TrendingUp,
  History,
  Trash2,
  Info,
  Sparkles,
  MapPin,
  Navigation,
  Crosshair,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  createEmptyAuditTemplate,
  scoreFromCategories,
  useAuditBranches,
  useBranchAudits,
  useCreateBranchAudit,
  useDeleteBranchAudit,
  AUDIT_GEOFENCE_METERS,
  haversineMeters,
  type AuditAnswer,
  type AuditCategory,
  type BranchAudit,
} from "@/lib/branch-audits-api";

const VISIT_NAMES = [
  { value: "1-tashrif", label: "1-tashrif" },
  { value: "2-tashrif", label: "2-tashrif" },
  { value: "3-tashrif", label: "3-tashrif" },
  { value: "nazorat", label: "Nazorat tashrifi" },
  { value: "qayta-tekshiruv", label: "Qayta tekshiruv" },
];

const MONTHS = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentabr",
  "Oktabr",
  "Noyabr",
  "Dekabr",
];

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentMonthLabel() {
  return MONTHS[new Date().getMonth()];
}

function scoreTone(pct: number) {
  if (pct >= 85) return "text-emerald-600";
  if (pct >= 70) return "text-amber-600";
  return "text-rose-600";
}

function scoreBar(pct: number) {
  if (pct >= 85) return "bg-emerald-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-rose-500";
}

export default function ChecklistPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: branches = [], isLoading: branchesLoading } = useAuditBranches();
  const { data: history = [], isLoading: historyLoading } = useBranchAudits();
  const createAudit = useCreateBranchAudit();
  const deleteAudit = useDeleteBranchAudit();

  const [managerId, setManagerId] = useState<string>("");
  const [visitDate, setVisitDate] = useState(todayIso());
  const [visitName, setVisitName] = useState("1-tashrif");
  const [monthLabel, setMonthLabel] = useState(currentMonthLabel());
  const [generalNote, setGeneralNote] = useState("");
  const [categories, setCategories] = useState<AuditCategory[]>(() =>
    createEmptyAuditTemplate(),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<BranchAudit | null>(null);
  const [gps, setGps] = useState<{
    lat: number;
    lng: number;
    accuracy: number | null;
  } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsWatching, setGpsWatching] = useState(false);
  /** 1 = filialdasiz (to‘ldirish), 2 = hali uzoq (km ko‘rsatish) */
  const [locationTest, setLocationTest] = useState<"near" | "far" | null>(null);

  const canWrite = user?.role === "koordinator" || user?.role === "admin";

  const selectedBranch = useMemo(
    () => branches.find((b) => String(b.id) === managerId) || null,
    [branches, managerId],
  );

  useEffect(() => {
    setLocationTest(null);
  }, [managerId]);

  const branchHasCoords =
    selectedBranch?.latitude != null && selectedBranch?.longitude != null;

  const distanceMeters =
    gps && branchHasCoords
      ? haversineMeters(
          gps.lat,
          gps.lng,
          selectedBranch!.latitude!,
          selectedBranch!.longitude!,
        )
      : null;

  const distanceKm =
    distanceMeters != null ? (distanceMeters / 1000).toFixed(2) : null;

  const withinGeofence =
    locationTest === "near" ||
    (locationTest !== "far" &&
      distanceMeters != null &&
      distanceMeters <= AUDIT_GEOFENCE_METERS);

  const canFillChecklist =
    user?.role === "admin" || locationTest === "near";
  const showFarBlock = locationTest === "far";

  const remainMeters =
    distanceMeters != null
      ? Math.max(0, distanceMeters - AUDIT_GEOFENCE_METERS)
      : null;

  useEffect(() => {
    if (!selectedBranch || !branchHasCoords || !canWrite) {
      setGpsWatching(false);
      return;
    }
    if (!navigator.geolocation) {
      setGpsError("Brauzer GPS ni qo‘llab-quvvatlamaydi");
      return;
    }
    setGpsError(null);
    setGpsWatching(true);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        });
        setGpsError(null);
      },
      (err) => {
        setGpsError(
          err.code === 1
            ? "Joylashuv ruxsati berilmadi — sozlamadan GPS ni yoqing"
            : "GPS olinmadi — qayta urinib ko‘ring",
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => {
      navigator.geolocation.clearWatch(id);
      setGpsWatching(false);
    };
  }, [selectedBranch?.id, branchHasCoords, canWrite]);

  const live = useMemo(() => scoreFromCategories(categories), [categories]);

  function setAnswer(catId: string, itemId: string, answer: AuditAnswer) {
    setCategories((prev) =>
      prev.map((cat) =>
        cat.id !== catId
          ? cat
          : {
              ...cat,
              items: cat.items.map((it) =>
                it.id !== itemId
                  ? it
                  : {
                      ...it,
                      // Qayta bosilsa — tanlov bekor (null)
                      answer: it.answer === answer ? null : answer,
                      note: answer === "yes" ? null : it.note,
                    },
              ),
            },
      ),
    );
  }

  function setItemNote(catId: string, itemId: string, note: string) {
    setCategories((prev) =>
      prev.map((cat) =>
        cat.id !== catId
          ? cat
          : {
              ...cat,
              items: cat.items.map((it) =>
                it.id !== itemId ? it : { ...it, note },
              ),
            },
      ),
    );
  }

  function markAllYes() {
    setCategories((prev) =>
      prev.map((cat) => ({
        ...cat,
        items: cat.items.map((it) => ({ ...it, answer: "yes" as const, note: null })),
      })),
    );
  }

  function clearAnswers() {
    setCategories(createEmptyAuditTemplate());
    setGeneralNote("");
  }

  function resetForm() {
    setManagerId("");
    setVisitDate(todayIso());
    setVisitName("1-tashrif");
    setMonthLabel(currentMonthLabel());
    setGeneralNote("");
    setCategories(createEmptyAuditTemplate());
  }

  async function handleSave() {
    if (!canWrite) {
      toast({ title: "Ruxsat yo‘q", variant: "destructive" });
      return;
    }
    if (!managerId) {
      toast({ title: "Filialni tanlang", variant: "destructive" });
      return;
    }
    if (!visitDate) {
      toast({ title: "Sanani belgilang", variant: "destructive" });
      return;
    }
    if (live.answered === 0) {
      toast({
        title: "Javob belgilang",
        description: "Kamida bitta talabga Ha yoki Yo‘q tanlang",
        variant: "destructive",
      });
      return;
    }

    const mustGps = user?.role === "koordinator";
    if (mustGps) {
      if (!branchHasCoords) {
        toast({
          title: "Filial GPS yo‘q",
          description: "Bu filialga lokatsiya biriktirilmagan",
          variant: "destructive",
        });
        return;
      }
      if (locationTest !== "near") {
        toast({
          title: "Avval 1-testni tanlang",
          description:
            "To‘ldirish uchun «1 · Filialdasiz» ni tanlang. 2-test faqat masofa ko‘rsatadi.",
          variant: "destructive",
        });
        return;
      }
    }

    try {
      const nearLat = selectedBranch?.latitude;
      const nearLng = selectedBranch?.longitude;
      await createAudit.mutateAsync({
        managerEmployeeId: parseInt(managerId, 10),
        visitDate,
        visitName,
        monthLabel,
        generalNote: generalNote.trim() || null,
        categories,
        ...(nearLat != null && nearLng != null
          ? { checkLatitude: nearLat, checkLongitude: nearLng }
          : gps
            ? { checkLatitude: gps.lat, checkLongitude: gps.lng }
            : {}),
      });
      toast({
        title: "Cheklist saqlandi",
        description: `Umumiy ball: ${live.scorePercent}% (${live.yes} Ha / ${live.no} Yo‘q)`,
      });
      resetForm();
      setGps(null);
      setLocationTest(null);
    } catch (e: any) {
      toast({
        title: "Saqlanmadi",
        description: e?.message || "Xato",
        variant: "destructive",
      });
    }
  }

  if (user?.role !== "koordinator" && user?.role !== "admin") {
    return (
      <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
        <Info className="mx-auto h-10 w-10 text-slate-400" />
        <h2 className="mt-3 text-lg font-semibold">Faqat koordinatorlar uchun</h2>
        <p className="mt-1 text-sm text-slate-500">
          Filial audit cheklistini faqat koordinator to‘ldiradi.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-28 sm:space-y-6 sm:pb-10">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0b1a2e] px-4 py-5 text-white shadow-lg sm:px-6 sm:py-7">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-cyan-400/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-48 w-48 rounded-full bg-amber-400/10 blur-2xl" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-cyan-100 sm:px-3 sm:text-xs">
              <ClipboardCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Koordinator · Filial nazorati</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight sm:text-3xl">
              Audit cheklist
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-300 sm:mt-2 sm:max-w-xl sm:text-sm">
              Har bir filialga borib belgilangan talablarni tekshiring:{" "}
              <span className="text-emerald-300">Ha</span> yoki{" "}
              <span className="text-rose-300">Yo‘q</span>. Natija foizda
              hisoblanadi va saqlanadi.
            </p>
          </div>
          <Button
            variant="secondary"
            className="w-full shrink-0 bg-white/10 text-white hover:bg-white/20 sm:w-auto"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="mr-1.5 h-4 w-4" />
            Tarix ({history.length})
          </Button>
        </div>
      </div>

      {/* Live score strip — 2x2 on mobile */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <ScoreCard
          icon={<TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label="Umumiy foiz"
          value={`${live.scorePercent}%`}
          valueClass={scoreTone(live.scorePercent)}
        />
        <ScoreCard
          icon={<Check className="h-3.5 w-3.5 text-emerald-600 sm:h-4 sm:w-4" />}
          label="Ha"
          value={String(live.yes)}
        />
        <ScoreCard
          icon={<X className="h-3.5 w-3.5 text-rose-600 sm:h-4 sm:w-4" />}
          label="Yo‘q"
          value={String(live.no)}
        />
        <ScoreCard
          icon={<ClipboardCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label="Javob"
          value={`${live.answered}/${live.total}`}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="h-1.5 w-full bg-slate-100">
          <div
            className={cn("h-full transition-all duration-500", scoreBar(live.scorePercent))}
            style={{
              width: `${live.answered === 0 ? 0 : live.scorePercent}%`,
            }}
          />
        </div>

        {/* Meta form */}
        <div className="border-b px-3 py-4 sm:px-6 sm:py-5">
          <div className="mb-4 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white sm:h-9 sm:w-9">
                <Store className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold sm:text-base">Tashrif ma’lumotlari</h2>
                <p className="text-[11px] text-slate-500 sm:text-xs">
                  Filial tanlang — mudir avtomatik
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={resetForm}
            >
              <RotateCcw className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Tozalash</span>
            </Button>
          </div>

          {!branchesLoading && branches.length === 0 && (
            <p className="mb-4 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              Sizga biriktirilgan filial topilmadi. Aptekalar tarmog‘ida mudirlar sizning
              koordinatoringizga bog‘langan bo‘lishi kerak.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Filialni tanlang
              </Label>
              <Select
                value={managerId || undefined}
                onValueChange={setManagerId}
                disabled={branchesLoading || branches.length === 0}
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="— Filialni tanlang —" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.branchLocation} — {b.managerName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Filial mudiri
              </Label>
              <div className="flex h-11 items-center gap-2 rounded-md border bg-slate-50 px-3 text-sm">
                <User className="h-4 w-4 shrink-0 text-slate-400" />
                <span className={cn("truncate", !selectedBranch && "text-slate-400")}>
                  {selectedBranch?.managerName || "Avtomatik to‘ldiriladi…"}
                </span>
              </div>
            </div>

            {/* 2 ta lokatsiya testi */}
            {selectedBranch && (
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                  Lokatsiya testi — birini tanlang
                </Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setLocationTest("near")}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left transition",
                      locationTest === "near"
                        ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200"
                        : "border-slate-200 bg-white hover:border-emerald-300",
                    )}
                  >
                    <p className="text-xs font-bold text-emerald-800">
                      1 · Filialdasiz
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
                      Tanlang — cheklistni to‘ldirish va saqlash mumkin
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocationTest("far")}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left transition",
                      locationTest === "far"
                        ? "border-rose-400 bg-rose-50 ring-2 ring-rose-200"
                        : "border-slate-200 bg-white hover:border-rose-300",
                    )}
                  >
                    <p className="text-xs font-bold text-rose-800">
                      2 · Hali bormadingiz
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
                      Tanlang — qancha km uzoqligingiz ko‘rsatiladi
                    </p>
                  </button>
                </div>

                {locationTest === "near" && (
                  <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Filialdasiz — to‘ldirish ochiq</p>
                      <p className="mt-0.5 text-xs text-emerald-800/80">
                        {selectedBranch.branchLocation} · cheklistni belgilab
                        saqlashingiz mumkin.
                      </p>
                    </div>
                  </div>
                )}

                {showFarBlock && branchHasCoords && (
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedBranch.latitude},${selectedBranch.longitude}&travelmode=driving`}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-xl border border-rose-300 bg-rose-50 transition hover:border-rose-400 hover:bg-rose-100/70 hover:shadow-sm"
                    title="Xaritada ochish"
                  >
                    <div className="flex gap-2 p-2.5 sm:gap-3">
                      <div className="relative h-[72px] w-[96px] shrink-0 overflow-hidden rounded-lg border border-rose-200 bg-slate-200 sm:h-[88px] sm:w-[120px]">
                        <iframe
                          title="Filial xaritasi"
                          className="pointer-events-none h-full w-full border-0"
                          loading="lazy"
                          referrerPolicy="no-referrer-when-downgrade"
                          src={`https://www.openstreetmap.org/export/embed.html?bbox=${
                            selectedBranch.longitude! - 0.01
                          }%2C${selectedBranch.latitude! - 0.008}%2C${
                            selectedBranch.longitude! + 0.01
                          }%2C${selectedBranch.latitude! + 0.008}&layer=mapnik&marker=${
                            selectedBranch.latitude
                          }%2C${selectedBranch.longitude}`}
                        />
                        <span className="absolute inset-0 bg-transparent" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-rose-900">
                          Hali bu lokatsiyaga yetib bormadingiz
                        </p>
                        {gpsError ? (
                          <p className="mt-1 text-xs text-rose-700">{gpsError}</p>
                        ) : distanceKm != null ? (
                          <p className="mt-1 text-sm text-rose-800">
                            Uzoqlik:{" "}
                            <strong className="text-base tabular-nums">
                              {distanceKm} km
                            </strong>
                            <span className="ml-1 text-xs text-rose-600">
                              ({distanceMeters} m)
                            </span>
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-rose-700">
                            {gpsWatching
                              ? "Masofa hisoblanmoqda…"
                              : "GPS yoqing — masofa km da chiqadi"}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-rose-700/80">
                          Filialga yetganda (≤{AUDIT_GEOFENCE_METERS} m) 1-testni
                          tanlab to‘ldirasiz. Hozir cheklist yopiq.
                        </p>
                        <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-800 underline-offset-2 hover:underline">
                          <MapPin className="h-3 w-3" />
                          Bosib lokatsiyaga o‘tish
                        </p>
                      </div>
                    </div>
                  </a>
                )}

                {showFarBlock && !branchHasCoords && (
                  <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-3 text-sm text-rose-800">
                    Hali bu lokatsiyaga yetib bormadingiz. Filial GPS si
                    biriktirilmagan.
                  </div>
                )}

                {!locationTest && (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Avval yuqoridagi 1 yoki 2-testni tanlang.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Tashrif sanasi
              </Label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="date"
                  className="h-11 pl-9"
                  value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Tashrif nomi
              </Label>
              <Select value={visitName} onValueChange={setVisitName}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIT_NAMES.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Koordinator F.I.Sh
              </Label>
              <div className="flex h-11 items-center rounded-md border bg-slate-50 px-3 text-sm font-medium">
                <span className="truncate">{user?.fullName || "—"}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Oy
              </Label>
              <Select value={monthLabel} onValueChange={setMonthLabel}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] uppercase tracking-wide text-slate-500">
                Umumiy izoh / eslatma
              </Label>
              <Textarea
                rows={3}
                value={generalNote}
                onChange={(e) => setGeneralNote(e.target.value)}
                placeholder="Masalan: Konditsionerdan suv oqyapti — ustalarga aytilgan"
                className="min-h-[80px] text-base sm:text-sm"
              />
            </div>
          </div>
        </div>

        {/* Checklist */}
        <div className="px-3 py-4 sm:px-6 sm:py-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white sm:h-9 sm:w-9">
                <ClipboardCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold sm:text-base">Audit cheklist</h2>
                <p className="text-[11px] text-slate-500 sm:text-xs">
                  Har bir bandni tanlang — boshida tanlanmagan
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10"
                onClick={clearAnswers}
                disabled={!canFillChecklist}
              >
                Tozalash
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-10"
                onClick={markAllYes}
                disabled={!canFillChecklist}
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Barchasi «Ha»
              </Button>
            </div>
          </div>

          {!canFillChecklist && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              {showFarBlock
                ? `Cheklist yopiq: hali filialga yetmagansiz${
                    distanceKm != null ? ` (${distanceKm} km)` : ""
                  }. 1-testni tanlab to‘ldirasiz.`
                : "Avval filialni tanlang, keyin «1 · Filialdasiz» testini bosing — shunda to‘ldirish ochiladi."}
            </div>
          )}

          <div
            className={cn(
              !canFillChecklist && "pointer-events-none select-none opacity-45",
            )}
          >
          <Accordion
            type="multiple"
            defaultValue={categories.map((c) => c.id)}
            className="space-y-2.5 sm:space-y-3"
          >
            {categories.map((cat) => {
              const catScore = scoreFromCategories([cat]);
              return (
                <AccordionItem
                  key={cat.id}
                  value={cat.id}
                  className="overflow-hidden rounded-xl border bg-slate-50/50 px-0"
                >
                  <AccordionTrigger className="px-3 py-3 hover:no-underline sm:px-4">
                    <div className="flex w-full items-center gap-2 pr-1 text-left sm:gap-3 sm:pr-2">
                      <FolderOpen className="h-4 w-4 shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-slate-800 sm:text-base">
                        {cat.title}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "shrink-0 font-semibold",
                          catScore.answered === 0
                            ? "bg-slate-200 text-slate-600"
                            : scoreTone(catScore.scorePercent),
                        )}
                      >
                        {catScore.answered === 0
                          ? `${cat.items.length}`
                          : `${catScore.scorePercent}%`}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-2 pb-3 pt-0 sm:px-3">
                    <ul className="space-y-2">
                      {cat.items.map((item) => (
                        <li
                          key={item.id}
                          className="rounded-xl border bg-white p-3 shadow-sm"
                        >
                          <p className="text-sm font-medium leading-snug text-slate-800">
                            {item.label}
                          </p>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setAnswer(cat.id, item.id, "yes")}
                              className={cn(
                                "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-all active:scale-[0.98]",
                                item.answer === "yes"
                                  ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50",
                              )}
                            >
                              <Check className="h-4 w-4" />
                              Ha
                            </button>
                            <button
                              type="button"
                              onClick={() => setAnswer(cat.id, item.id, "no")}
                              className={cn(
                                "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-all active:scale-[0.98]",
                                item.answer === "no"
                                  ? "border-rose-600 bg-rose-600 text-white shadow-sm"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-rose-300 hover:bg-rose-50",
                              )}
                            >
                              <X className="h-4 w-4" />
                              Yo‘q
                            </button>
                          </div>
                          {item.answer === "no" && (
                            <Input
                              className="mt-2 h-11 text-base sm:text-sm"
                              placeholder="Kamchilik izohi (ixtiyoriy)…"
                              value={item.note || ""}
                              onChange={(e) =>
                                setItemNote(cat.id, item.id, e.target.value)
                              }
                            />
                          )}
                          {item.answer === null && (
                            <p className="mt-2 text-[11px] text-slate-400">
                              Hali tanlanmagan
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
          </div>
        </div>

        {/* Desktop footer */}
        <div className="hidden border-t bg-slate-50/80 px-6 py-4 sm:flex sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600">
            Joriy natija:{" "}
            <span className={cn("text-lg font-bold", scoreTone(live.scorePercent))}>
              {live.scorePercent}%
            </span>
            <span className="ml-2 text-xs text-slate-400">
              ({live.yes} Ha · {live.no} Yo‘q · {live.total - live.answered} kutilyapti)
            </span>
          </div>
          <Button
            size="lg"
            onClick={() => void handleSave()}
            disabled={
              createAudit.isPending ||
              !canWrite ||
              (user?.role === "koordinator" && !canFillChecklist)
            }
            className="min-w-[160px]"
          >
            <Save className="mr-1.5 h-4 w-4" />
            {createAudit.isPending ? "Saqlanmoqda…" : "Saqlash"}
          </Button>
        </div>
      </div>

      {/* Mobile sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>
            Natija:{" "}
            <span className={cn("text-base font-bold", scoreTone(live.scorePercent))}>
              {live.scorePercent}%
            </span>
          </span>
          {user?.role === "koordinator" && selectedBranch ? (
            <span
              className={cn(
                "font-medium",
                canFillChecklist
                  ? "text-emerald-600"
                  : showFarBlock
                    ? "text-rose-600"
                    : "text-slate-500",
              )}
            >
              {canFillChecklist
                ? "1-test · to‘ldirish OK"
                : showFarBlock
                  ? distanceKm != null
                    ? `2-test · ${distanceKm} km`
                    : "2-test · uzoq"
                  : "Test tanlang"}
            </span>
          ) : (
            <span>
              {live.yes} Ha · {live.no} Yo‘q · {live.total - live.answered} qoldi
            </span>
          )}
        </div>
        <Button
          size="lg"
          className="h-12 w-full text-base"
          onClick={() => void handleSave()}
          disabled={
            createAudit.isPending ||
            !canWrite ||
            (user?.role === "koordinator" && !canFillChecklist)
          }
        >
          <Save className="mr-1.5 h-4 w-4" />
          {createAudit.isPending ? "Saqlanmoqda…" : "Saqlash"}
        </Button>
      </div>

      {/* History dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-2xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Saqlangan auditlar</DialogTitle>
          </DialogHeader>
          {historyLoading ? (
            <p className="text-sm text-slate-500">Yuklanmoqda…</p>
          ) : history.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500 sm:p-8">
              Hali saqlangan cheklist yo‘q
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 rounded-xl border bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-800">
                      {a.branchLocation || "Filial"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {a.visitDate} · {a.visitName} · {a.managerName} ·{" "}
                      {a.monthLabel || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={cn(
                        "font-bold",
                        a.scorePercent >= 85
                          ? "bg-emerald-100 text-emerald-700"
                          : a.scorePercent >= 70
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700",
                      )}
                    >
                      {a.scorePercent}%
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setViewing(a)}
                    >
                      Ko‘rish
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600"
                      onClick={() => {
                        void deleteAudit.mutateAsync(a.id).then(() => {
                          toast({ title: "O‘chirildi" });
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              Yopish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View saved */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[85vh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="pr-6 text-base leading-snug sm:text-lg">
              {viewing?.branchLocation} — {viewing?.scorePercent}%
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <Progress value={viewing.scorePercent} className="h-2" />
              <p className="text-slate-500">
                {viewing.visitDate} · {viewing.visitName} · Mudir:{" "}
                {viewing.managerName}
              </p>
              {viewing.generalNote && (
                <p className="rounded-lg bg-slate-50 p-3">{viewing.generalNote}</p>
              )}
              {viewing.categories?.map((cat) => (
                <div key={cat.id}>
                  <p className="mb-1 font-semibold">{cat.title}</p>
                  <ul className="space-y-1">
                    {cat.items.map((it) => (
                      <li
                        key={it.id}
                        className="flex items-start justify-between gap-2 rounded-md border px-2 py-1.5"
                      >
                        <span className="min-w-0 leading-snug">{it.label}</span>
                        <Badge
                          variant="secondary"
                          className={
                            it.answer === "yes"
                              ? "shrink-0 bg-emerald-100 text-emerald-700"
                              : it.answer === "no"
                                ? "shrink-0 bg-rose-100 text-rose-700"
                                : "shrink-0"
                          }
                        >
                          {it.answer === "yes"
                            ? "Ha"
                            : it.answer === "no"
                              ? "Yo‘q"
                              : "—"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScoreCard({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2.5 shadow-sm sm:rounded-2xl sm:px-4 sm:py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:gap-2 sm:text-xs">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className={cn("mt-0.5 text-xl font-bold tabular-nums text-slate-900 sm:mt-1 sm:text-2xl", valueClass)}>
        {value}
      </p>
    </div>
  );
}
