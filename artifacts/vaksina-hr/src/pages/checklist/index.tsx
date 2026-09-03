import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  MapPin,
  Navigation,
  Crosshair,
  Search,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  type AuditBranchOption,
} from "@/lib/branch-audits-api";
import {
  gpsFromLocationField,
  displayBranchName,
} from "@/lib/pharmacy-staff-api";
import { useI18n } from "@/i18n/I18nProvider";

const MONTHS_KEYS = [
  "month.1",
  "month.2",
  "month.3",
  "month.4",
  "month.5",
  "month.6",
  "month.7",
  "month.8",
  "month.9",
  "month.10",
  "month.11",
  "month.12",
] as const;

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function formatDistance(meters: number) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters} m`;
}

function tf(
  t: (key: string, fallback?: string) => string,
  key: string,
  vars: Record<string, string | number>,
) {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
    t(key),
  );
}

function visitLabelKey(n: number) {
  if (n === 1) return "checklist.visit1";
  if (n === 2) return "checklist.visit2";
  if (n === 3) return "checklist.visit3";
  return "checklist.visit4";
}

const MAX_VISITS_PER_MONTH = 4;

type PickerBranch = AuditBranchOption & { hasGps: boolean; label: string };

function normalizeAuditBranches(list: AuditBranchOption[]): PickerBranch[] {
  const counts = new Map<string, number>();
  const cleaned = list.map((b) => {
    const fromField = gpsFromLocationField(b.branchLocation);
    const loc = displayBranchName(b.branchLocation);
    const generic = !loc || loc === "Filial" || loc === b.managerName;
    const label = generic ? b.managerName : loc;
    const lat = b.latitude ?? fromField?.lat ?? null;
    const lng = b.longitude ?? fromField?.lng ?? null;
    counts.set(label, (counts.get(label) || 0) + 1);
    return {
      ...b,
      branchLocation: label,
      latitude: lat,
      longitude: lng,
      hasGps: lat != null && lng != null,
      label,
    };
  });
  return cleaned.sort((a, b) => {
    if (a.hasGps !== b.hasGps) return a.hasGps ? -1 : 1;
    return a.label.localeCompare(b.label, "uz");
  });
}

function BranchPicker({
  branches,
  value,
  onChange,
  disabled,
}: {
  branches: PickerBranch[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = branches.find((b) => String(b.id) === value) || null;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return branches;
    return branches.filter(
      (b) =>
        b.label.toLowerCase().includes(s) ||
        b.managerName.toLowerCase().includes(s),
    );
  }, [branches, q]);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-auto min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm shadow-sm disabled:opacity-50",
          selected?.hasGps
            ? "border-emerald-300 bg-emerald-50"
            : selected
              ? "border-rose-300 bg-rose-50"
              : "border-input bg-background",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 font-semibold leading-snug",
            selected?.hasGps
              ? "text-emerald-800"
              : selected
                ? "text-rose-800"
                : "text-muted-foreground font-normal",
          )}
        >
          {selected ? selected.label : `— ${t("checklist.pickBranch")} —`}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85dvh] w-[calc(100%-1.5rem)] max-w-lg flex-col gap-3 overflow-hidden p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{t("checklist.pickBranch")}</DialogTitle>
          </DialogHeader>
          <p className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-emerald-700">{t("checklist.gpsGreen")}</span> — {t("checklist.gpsHas")} ·{" "}
            <span className="font-semibold text-rose-700">{t("checklist.gpsRed")}</span> — {t("checklist.gpsNone")}
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("checklist.searchBranch")}
              className="h-11 pl-9"
              autoFocus
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("checklist.notFound")}</p>
            ) : (
              <ul className="divide-y">
                {filtered.map((b) => {
                  const active = String(b.id) === value;
                  const dups = branches.filter((x) => x.label === b.label).length > 1;
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(String(b.id));
                          setOpen(false);
                          setQ("");
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-3 text-left active:opacity-90",
                          b.hasGps ? "bg-emerald-50/80" : "bg-rose-50/80",
                          active && "ring-inset ring-2 ring-slate-900/10",
                        )}
                      >
                        <MapPin
                          className={cn(
                            "h-4 w-4 shrink-0",
                            b.hasGps ? "text-emerald-600" : "text-rose-500",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block text-sm font-semibold leading-snug",
                              b.hasGps ? "text-emerald-800" : "text-rose-800",
                            )}
                          >
                            {b.label}
                          </span>
                          {dups ? (
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {b.managerName}
                            </span>
                          ) : null}
                        </span>
                        {active ? <Check className="h-4 w-4 shrink-0 text-foreground" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function ChecklistPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: rawBranches = [], isLoading: branchesLoading } = useAuditBranches();
  const branches = useMemo(() => normalizeAuditBranches(rawBranches), [rawBranches]);
  const { data: history = [], isLoading: historyLoading } = useBranchAudits();
  const createAudit = useCreateBranchAudit();
  const deleteAudit = useDeleteBranchAudit();

  const [managerId, setManagerId] = useState<string>("");
  const [visitDate, setVisitDate] = useState(todayIso());
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
  const [gpsAsking, setGpsAsking] = useState(false);
  const watchRef = useRef<number | null>(null);

  const canWrite = user?.role === "koordinator" || user?.role === "admin";

  const selectedBranch = useMemo(
    () => branches.find((b) => String(b.id) === managerId) || null,
    [branches, managerId],
  );

  const monthKey = visitDate.slice(0, 7);
  const monthLabel = useMemo(() => {
    const m = Number(visitDate.slice(5, 7));
    if (!m || m < 1 || m > 12) return t(MONTHS_KEYS[new Date().getMonth()]);
    return t(MONTHS_KEYS[m - 1]);
  }, [visitDate, t]);

  const visitsThisMonth = useMemo(() => {
    if (!managerId) return [] as BranchAudit[];
    return history.filter(
      (a) =>
        String(a.managerEmployeeId) === managerId &&
        String(a.visitDate || "").startsWith(monthKey),
    );
  }, [history, managerId, monthKey]);

  const doneVisits = visitsThisMonth.length;
  const monthFull = doneVisits >= MAX_VISITS_PER_MONTH;
  const nextVisitNum = monthFull ? MAX_VISITS_PER_MONTH : doneVisits + 1;
  const visitName = `${nextVisitNum}-tashrif`;

  useEffect(() => {
    setGpsError(null);
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

  const withinGeofence =
    distanceMeters != null && distanceMeters <= AUDIT_GEOFENCE_METERS;

  const canFillChecklist =
    !monthFull &&
    (user?.role === "admin" || (Boolean(selectedBranch) && withinGeofence));

  const remainMeters =
    distanceMeters != null
      ? Math.max(0, distanceMeters - AUDIT_GEOFENCE_METERS)
      : null;

  const applyGps = useCallback((pos: GeolocationPosition) => {
    setGps({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
    });
    setGpsError(null);
  }, []);

  const stopWatch = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setGpsWatching(false);
  }, []);

  const startWatch = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError("Brauzer GPS ni qo‘llab-quvvatlamaydi");
      return;
    }
    stopWatch();
    setGpsWatching(true);
    watchRef.current = navigator.geolocation.watchPosition(
      applyGps,
      (err) => {
        setGpsError(
          err.code === 1
            ? "Joylashuv ruxsati berilmadi — «Lokatsiyani yoqish» ni bosing"
            : "GPS olinmadi — ochiq joyda qayta urinib ko‘ring",
        );
        setGpsWatching(false);
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 },
    );
  }, [applyGps, stopWatch]);

  const requestLiveGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError("Brauzer GPS ni qo‘llab-quvvatlamaydi");
      return;
    }
    setGpsAsking(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyGps(pos);
        setGpsAsking(false);
        startWatch();
      },
      (err) => {
        setGpsAsking(false);
        setGpsError(
          err.code === 1
            ? "Lokatsiyaga ruxsat berilmadi — brauzerda «Ruxsat» ni tanlang"
            : "GPS olinmadi — ochiq joyda qayta urinib ko‘ring",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }, [applyGps, startWatch]);

  useEffect(() => {
    if (!selectedBranch || !branchHasCoords || !canWrite) {
      stopWatch();
      return;
    }
    requestLiveGps();
    return () => stopWatch();
  }, [selectedBranch?.id, branchHasCoords, canWrite, requestLiveGps, stopWatch]);

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

  function clearAnswers() {
    setCategories(createEmptyAuditTemplate());
    setGeneralNote("");
  }

  function resetForm() {
    setManagerId("");
    setVisitDate(todayIso());
    setGeneralNote("");
    setCategories(createEmptyAuditTemplate());
  }

  function readFreshGps(): Promise<{ lat: number; lng: number; accuracy: number | null }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error(t("checklist.needLoc")));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          };
          setGps(next);
          resolve(next);
        },
        () => reject(new Error(t("checklist.needLoc"))),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      );
    });
  }

  async function handleSave() {
    if (!canWrite) {
      toast({ title: t("checklist.noPermission"), variant: "destructive" });
      return;
    }
    if (!managerId) {
      toast({ title: t("checklist.pickBranch"), variant: "destructive" });
      return;
    }
    if (!visitDate) {
      toast({ title: t("checklist.pickDate"), variant: "destructive" });
      return;
    }
    if (monthFull) {
      toast({ title: t("checklist.visitFull"), variant: "destructive" });
      return;
    }
    if (live.answered === 0) {
      toast({
        title: t("checklist.pickAnswer"),
        description: t("checklist.checklistHint"),
        variant: "destructive",
      });
      return;
    }

    let saveGps = gps;
    const mustGps = user?.role === "koordinator";
    if (mustGps) {
      if (!branchHasCoords) {
        toast({
          title: t("checklist.noGps"),
          description: t("checklist.gateNoGps"),
          variant: "destructive",
        });
        return;
      }
      try {
        saveGps = await readFreshGps();
      } catch {
        toast({
          title: t("checklist.needLoc"),
          description: t("checklist.enableLoc"),
          variant: "destructive",
        });
        return;
      }
      const dist = haversineMeters(
        saveGps.lat,
        saveGps.lng,
        selectedBranch!.latitude!,
        selectedBranch!.longitude!,
      );
      if (dist > AUDIT_GEOFENCE_METERS) {
        toast({
          title: t("checklist.tooFar"),
          description: tf(t, "checklist.gateFar", {
            dist: formatDistance(dist),
            m: AUDIT_GEOFENCE_METERS,
          }),
          variant: "destructive",
        });
        return;
      }
    }

    try {
      await createAudit.mutateAsync({
        managerEmployeeId: parseInt(managerId, 10),
        visitDate,
        visitName,
        monthLabel,
        generalNote: generalNote.trim() || null,
        categories,
        ...(saveGps
          ? { checkLatitude: saveGps.lat, checkLongitude: saveGps.lng }
          : {}),
      });
      toast({
        title: t("checklist.savedOk"),
        description: `${t(visitLabelKey(nextVisitNum))} · ${live.scorePercent}%`,
      });
      resetForm();
    } catch (e: any) {
      toast({
        title: t("checklist.saveFail"),
        description: e?.message || t("ui.error"),
        variant: "destructive",
      });
    }
  }

  if (user?.role !== "koordinator" && user?.role !== "admin") {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
        <Info className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">{t("checklist.coordOnly")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("checklist.coordOnlyHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-28 sm:space-y-6 sm:pb-10">
      {/* Hero */}
      <div className="hero-dark relative overflow-hidden rounded-2xl bg-[#0b1a2e] px-4 py-5 shadow-lg sm:px-6 sm:py-7">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-cyan-400/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-48 w-48 rounded-full bg-amber-400/10 blur-2xl" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-cyan-100 sm:px-3 sm:text-xs">
              <ClipboardCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t("checklist.subtitle")}</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight sm:text-3xl">
              {t("checklist.title")}
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground sm:mt-2 sm:max-w-xl sm:text-sm">
              {t("checklist.heroHint")}
            </p>
          </div>
          <Button
            variant="secondary"
            className="w-full shrink-0 bg-white/10 text-white hover:bg-white/20 sm:w-auto"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="mr-1.5 h-4 w-4" />
            {t("checklist.history")} ({history.length})
          </Button>
        </div>
      </div>

      {/* Live score strip — 2x2 on mobile */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <ScoreCard
          icon={<TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label={t("checklist.overallPct")}
          value={`${live.scorePercent}%`}
          valueClass={scoreTone(live.scorePercent)}
        />
        <ScoreCard
          icon={<Check className="h-3.5 w-3.5 text-emerald-600 sm:h-4 sm:w-4" />}
          label={t("ui.yes")}
          value={String(live.yes)}
        />
        <ScoreCard
          icon={<X className="h-3.5 w-3.5 text-rose-600 sm:h-4 sm:w-4" />}
          label={t("ui.no")}
          value={String(live.no)}
        />
        <ScoreCard
          icon={<ClipboardCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          label={t("checklist.answers")}
          value={`${live.answered}/${live.total}`}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="h-1.5 w-full bg-slate-100">
          <div
            className={cn("h-full transition-all duration-500", scoreBar(live.scorePercent))}
            style={{
              width: `${live.answered === 0 ? 0 : live.scorePercent}%`,
            }}
          />
        </div>

        {/* Meta form */}
        <div className="border-b bg-gradient-to-b from-slate-50/80 to-transparent px-3 py-5 sm:px-6 sm:py-6 dark:from-slate-900/40">
          <div className="mb-5 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-md shadow-slate-900/20">
                <Store className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold tracking-tight sm:text-lg">{t("checklist.visitInfo")}</h2>
                <p className="text-[11px] text-muted-foreground sm:text-xs">
                  {t("checklist.monthQuota")} · {AUDIT_GEOFENCE_METERS} m
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 rounded-full"
              onClick={resetForm}
            >
              <RotateCcw className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">{t("checklist.reset")}</span>
            </Button>
          </div>

          {!branchesLoading && branches.length === 0 && (
            <p className="mb-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              {t("checklist.gatePick")}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("checklist.pickBranch")}
              </Label>
              <BranchPicker
                branches={branches}
                value={managerId}
                onChange={setManagerId}
                disabled={branchesLoading || branches.length === 0}
              />
              <p className="text-[10px] text-muted-foreground">
                <span className="font-medium text-emerald-700">{t("checklist.gpsGreen")}</span> — {t("checklist.gpsHas")} ·{" "}
                <span className="font-medium text-rose-700">{t("checklist.gpsRed")}</span> — {t("checklist.gpsNone")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("checklist.branchManager")}
              </Label>
              <div className="flex h-11 items-center gap-2 rounded-xl border bg-muted/60 px-3 text-sm">
                <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className={cn("truncate", !selectedBranch && "text-muted-foreground")}>
                  {selectedBranch?.managerName || t("checklist.autoFill")}
                </span>
              </div>
            </div>

            {selectedBranch ? (
              <div className="space-y-3 rounded-2xl border border-border/80 bg-card p-3 shadow-sm sm:col-span-2 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("checklist.visitAuto")}
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-foreground">
                      {tf(t, "checklist.visitProgress", { done: doneVisits })}
                    </p>
                  </div>
                  {!monthFull ? (
                    <Badge className="rounded-full bg-slate-900 px-3 py-1 text-white hover:bg-slate-900">
                      {tf(t, "checklist.visitNext", { name: t(visitLabelKey(nextVisitNum)) })}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="rounded-full">
                      {t("checklist.visitFull")}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((n) => {
                    const done = n <= doneVisits;
                    const next = !monthFull && n === nextVisitNum;
                    return (
                      <div
                        key={n}
                        className={cn(
                          "flex flex-col items-center rounded-xl border px-2 py-2.5 text-center transition",
                          done && "border-emerald-300 bg-emerald-50 text-emerald-900",
                          next && "border-slate-900 bg-slate-900 text-white shadow-md",
                          !done && !next && "border-dashed border-border bg-muted/40 text-muted-foreground",
                        )}
                      >
                        <span className="text-lg font-bold tabular-nums leading-none">{n}</span>
                        <span className="mt-1 text-[10px] font-medium opacity-80">
                          {done ? t("ui.yes") : next ? t("checklist.visitName") : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {selectedBranch && (
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("checklist.liveLoc")} · {AUDIT_GEOFENCE_METERS} m
                </Label>

                {!branchHasCoords ? (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                    {t("checklist.gateNoGps")}
                  </div>
                ) : withinGeofence ? (
                  <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">{t("checklist.inZone")}</p>
                      <p className="mt-0.5 text-xs text-emerald-800/80">
                        {selectedBranch.branchLocation} ·{" "}
                        <strong className="tabular-nums">{formatDistance(distanceMeters!)}</strong>
                        {gps?.accuracy != null ? ` · ±${Math.round(gps.accuracy)} m` : ""}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-rose-300 bg-rose-50 px-3 py-3 text-sm text-rose-900">
                    <div className="flex items-start gap-2">
                      <Navigation className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {gps
                            ? t("checklist.notYet")
                            : gpsAsking || gpsWatching
                              ? t("checklist.gettingGps")
                              : t("checklist.needLocHint")}
                        </p>
                        {gpsError ? (
                          <p className="mt-1 text-xs text-rose-700">{gpsError}</p>
                        ) : distanceMeters != null ? (
                          <p className="mt-1 text-sm">
                            <strong className="text-base tabular-nums">
                              {formatDistance(distanceMeters)}
                            </strong>
                            {remainMeters != null && remainMeters > 0 ? (
                              <span className="ml-1 text-xs">
                                · {formatDistance(remainMeters)}
                              </span>
                            ) : null}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[11px] text-rose-700/80">
                          {tf(t, "checklist.gateGo", { m: AUDIT_GEOFENCE_METERS })}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 border-rose-300 bg-card text-rose-900"
                            onClick={requestLiveGps}
                            disabled={gpsAsking}
                          >
                            <Crosshair className="mr-1.5 h-3.5 w-3.5" />
                            {gpsAsking ? t("checklist.askingGps") : t("checklist.enableLoc")}
                          </Button>
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${selectedBranch.latitude},${selectedBranch.longitude}&travelmode=driving`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-rose-300 bg-card px-2.5 text-xs font-semibold text-rose-900"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            {t("checklist.openMaps")}
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("checklist.visitDate")}
              </Label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  className="h-11 rounded-xl pl-9"
                  value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("checklist.visitName")}
              </Label>
              <div className="flex h-11 items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm dark:border-slate-700 dark:bg-slate-900/50">
                <span className="font-semibold text-foreground">
                  {managerId ? t(visitLabelKey(nextVisitNum)) : "—"}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("checklist.visitAuto")}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("checklist.coordName")}
              </Label>
              <div className="flex h-11 items-center rounded-xl border bg-muted/60 px-3 text-sm font-medium">
                <span className="truncate">{user?.fullName || "—"}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("checklist.month")}
              </Label>
              <div className="flex h-11 items-center rounded-xl border bg-muted/60 px-3 text-sm font-medium">
                {monthLabel}
              </div>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("checklist.note")}
              </Label>
              <Textarea
                rows={3}
                value={generalNote}
                onChange={(e) => setGeneralNote(e.target.value)}
                placeholder={t("checklist.notePh")}
                className="min-h-[80px] rounded-xl text-base sm:text-sm"
                disabled={!canFillChecklist && user?.role === "koordinator"}
              />
            </div>
          </div>
        </div>

        {/* Checklist */}
        <div className="px-3 py-4 sm:px-6 sm:py-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-foreground dark:text-white sm:h-9 sm:w-9">
                <ClipboardCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold sm:text-base">{t("checklist.title")}</h2>
                <p className="text-[11px] text-muted-foreground sm:text-xs">
                  {t("checklist.checklistHint")}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10"
              onClick={clearAnswers}
              disabled={!canFillChecklist}
            >
              {t("checklist.reset")}
            </Button>
          </div>

          {!canFillChecklist && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              {monthFull
                ? t("checklist.visitFull")
                : !selectedBranch
                  ? t("checklist.gatePick")
                  : !branchHasCoords
                    ? t("checklist.gateNoGps")
                    : gpsError
                      ? t("checklist.gateNeedPerm")
                      : distanceMeters != null
                        ? tf(t, "checklist.gateFar", {
                            dist: formatDistance(distanceMeters),
                            m: AUDIT_GEOFENCE_METERS,
                          })
                        : tf(t, "checklist.gateGo", { m: AUDIT_GEOFENCE_METERS })}
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
                  className="overflow-hidden rounded-xl border bg-muted/50 px-0"
                >
                  <AccordionTrigger className="px-3 py-3 hover:no-underline sm:px-4">
                    <div className="flex w-full items-center gap-2 pr-1 text-left sm:gap-3 sm:pr-2">
                      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground sm:text-base">
                        {cat.title}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "shrink-0 font-semibold",
                          catScore.answered === 0
                            ? "bg-slate-200 text-muted-foreground"
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
                          className="rounded-xl border bg-card p-3 shadow-sm"
                        >
                          <p className="text-sm font-medium leading-snug text-foreground">
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
                                  : "border-border bg-card text-muted-foreground hover:border-emerald-300 hover:bg-emerald-50",
                              )}
                            >
                              <Check className="h-4 w-4" />
                              {t("ui.yes")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setAnswer(cat.id, item.id, "no")}
                              className={cn(
                                "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-all active:scale-[0.98]",
                                item.answer === "no"
                                  ? "border-rose-600 bg-rose-600 text-white shadow-sm"
                                  : "border-border bg-card text-muted-foreground hover:border-rose-300 hover:bg-rose-50",
                              )}
                            >
                              <X className="h-4 w-4" />
                              {t("ui.no")}
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
                            <p className="mt-2 text-[11px] text-muted-foreground">
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
        <div className="hidden border-t bg-muted/80 px-6 py-4 sm:flex sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            Joriy natija:{" "}
            <span className={cn("text-lg font-bold", scoreTone(live.scorePercent))}>
              {live.scorePercent}%
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              ({live.yes} {t("ui.yes")} · {live.no} {t("ui.no")} · {live.total - live.answered})
            </span>
          </div>
          <Button
            size="lg"
            onClick={() => void handleSave()}
            disabled={
              createAudit.isPending ||
              !canWrite ||
              monthFull ||
              (user?.role === "koordinator" && !canFillChecklist)
            }
            className="min-w-[160px] rounded-full"
          >
            <Save className="mr-1.5 h-4 w-4" />
            {createAudit.isPending ? t("checklist.saving") : t("checklist.save")}
          </Button>
        </div>
      </div>

      {/* Mobile sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
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
                  : "text-rose-600",
              )}
            >
              {monthFull
                ? t("checklist.visitFull")
                : canFillChecklist
                  ? t("checklist.inZoneShort")
                  : distanceMeters != null
                    ? formatDistance(distanceMeters)
                    : t("checklist.waitingGps")}
            </span>
          ) : (
            <span>
              {live.yes} {t("ui.yes")} · {live.no} {t("ui.no")}
            </span>
          )}
        </div>
        <Button
          size="lg"
          className="h-12 w-full rounded-full text-base"
          onClick={() => void handleSave()}
          disabled={
            createAudit.isPending ||
            !canWrite ||
            monthFull ||
            (user?.role === "koordinator" && !canFillChecklist)
          }
        >
          <Save className="mr-1.5 h-4 w-4" />
          {createAudit.isPending ? t("checklist.saving") : t("checklist.save")}
        </Button>
      </div>

      {/* History dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto rounded-2xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{t("checklist.savedAudits")}</DialogTitle>
          </DialogHeader>
          {historyLoading ? (
            <p className="text-sm text-muted-foreground">{t("ui.loading")}</p>
          ) : history.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground sm:p-8">
              Hali saqlangan cheklist yo‘q
            </p>
          ) : (
            <ul className="space-y-2">
              {history.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">
                      {a.branchLocation || t("ui.branch")}
                    </p>
                    <p className="text-xs text-muted-foreground">
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
              <p className="text-muted-foreground">
                {viewing.visitDate} · {viewing.visitName} · Mudir:{" "}
                {viewing.managerName}
              </p>
              {viewing.generalNote && (
                <p className="rounded-lg bg-muted p-3">{viewing.generalNote}</p>
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
    <div className="rounded-xl border bg-card px-3 py-2.5 shadow-sm sm:rounded-2xl sm:px-4 sm:py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:gap-2 sm:text-xs">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className={cn("mt-0.5 text-xl font-bold tabular-nums text-foreground sm:mt-1 sm:text-2xl", valueClass)}>
        {value}
      </p>
    </div>
  );
}
