import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  MapPin,
  ScanFace,
  Loader2,
  CheckCircle2,
  Lock,
  LogIn,
  LogOut,
  ShieldCheck,
  Clock3,
  CalendarDays,
  XCircle,
  History,
  ArrowDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FaceScanDialog } from "@/components/FaceScanDialog";
import { useToast } from "@/hooks/use-toast";
import { isFaceIdSupported } from "@/lib/face-id";
import {
  DAVOMAT_GEOFENCE_METERS,
  DAVOMAT_SITE_LABEL,
  DAVOMAT_SITE_LAT,
  DAVOMAT_SITE_LNG,
  DavomatApiError,
  facePunchDavomat,
  faceVerifyDavomat,
  fetchDavomatSite,
  fetchMyDavomat,
  fetchMyWorkplace,
  haversineMeters,
  type DavomatDayMetrics,
  type DavomatEmployee,
  type DavomatSite,
  type WorkplaceInfo,
} from "@/lib/davomat-api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { canViewDavomat } from "@/lib/roles";
import { roleLabel } from "@/lib/candidate-access";
import { useIsMobile } from "@/hooks/use-mobile";

const FACE_SNAP_KEY = "davomat-face-snap";
const PUNCH_GUIDE_KEY = "davomat-punch-guide-done";

type Gps = { lat: number; lng: number; accuracy: number };
type Verified = {
  descriptor: number[];
  fullName: string;
  nextAction: "in" | "out" | "done";
  checkIn: string;
  checkOut: string;
  checkInAt: string | null;
  checkOutAt?: string | null;
  faceImage?: string;
};

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatHoursUz(mins: number): string {
  const n = Math.max(0, Math.round(mins));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h === 0) return `${m} daq`;
  if (m === 0) return `${h} soat`;
  return `${h} soat ${m} daq`;
}

function hmToMinutes(hm: string): number | null {
  if (!hm || hm === "—") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function workedMinutesFromPunch(params: {
  checkIn: string;
  checkOut: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
}): number | null {
  if (params.checkInAt && params.checkOutAt) {
    return Math.max(
      0,
      Math.round(
        (new Date(params.checkOutAt).getTime() - new Date(params.checkInAt).getTime()) / 60000,
      ),
    );
  }
  const a = hmToMinutes(params.checkIn);
  const b = hmToMinutes(params.checkOut);
  if (a == null || b == null) return null;
  return Math.max(0, b - a);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

const STATUS_UZ: Record<string, string> = {
  present: "Kelgan",
  late: "Kech",
  incomplete: "Ketish yo‘q",
  absent: "Kelmagan",
  leave: "Ta’til",
};

const STATUS_STYLE: Record<string, string> = {
  present: "bg-emerald-50 text-emerald-800",
  late: "bg-amber-50 text-amber-900",
  incomplete: "bg-sky-50 text-sky-800",
  absent: "bg-rose-50 text-rose-800",
  leave: "bg-violet-50 text-violet-800",
};

const WEEKDAY_UZ = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const MONTH_UZ = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentabr",
  "oktabr",
  "noyabr",
  "dekabr",
];

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function weekdayIndex(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function splitDayUz(ymd: string): { date: string; weekday: string } {
  const p = parseYmd(ymd);
  if (!p) return { date: ymd, weekday: "" };
  const week = WEEKDAY_UZ[weekdayIndex(p.y, p.m, p.d)]!;
  return {
    date: `${p.d}-${MONTH_UZ[p.m - 1]}`,
    weekday: `${week[0]!.toUpperCase()}${week.slice(1)}`,
  };
}

function formatLongDateUz(ms: number): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
  const p = parseYmd(ymd);
  if (!p) return ymd;
  const week = WEEKDAY_UZ[weekdayIndex(p.y, p.m, p.d)];
  return `${week[0]!.toUpperCase()}${week.slice(1)}, ${p.d}-${MONTH_UZ[p.m - 1]} ${p.y}`;
}

function formatDistanceParts(meters: number): { value: string; unit: string } {
  if (!Number.isFinite(meters)) return { value: "—", unit: "" };
  if (Math.abs(meters) >= 1000) {
    const km = meters / 1000;
    const raw = km >= 10 ? km.toFixed(1) : km.toFixed(2);
    const value = raw.replace(/\.0$/, "").replace(/(\.\d)0$/, "$1");
    return { value, unit: "km" };
  }
  const steps = Math.max(1, Math.round(Math.abs(meters) / 0.75));
  return { value: String(steps), unit: "qadam" };
}

function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  const p = formatDistanceParts(meters);
  return `${p.value} ${p.unit}`;
}

function formatApproach(remain: number | null | undefined): string {
  if (remain == null || !Number.isFinite(remain) || remain <= 0) return "Hududdasiz";
  if (remain >= 1000) return `yana ${formatDistance(remain)} yaqinlashishingiz kerak`;
  return `yana ${formatDistanceParts(remain).value} qadam bosing`;
}

function sortDaysDesc(days: DavomatDayMetrics[]): DavomatDayMetrics[] {
  return [...days].sort((a, b) => b.date.localeCompare(a.date));
}

function MobileStepHint({
  step,
  label,
  align = "center",
}: {
  step: number;
  label: string;
  align?: "left" | "center" | "right";
}) {
  return (
    <div
      className={cn(
        "mb-2 flex flex-col gap-0.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 shadow-sm md:hidden",
        align === "right" && "items-end text-right",
        align === "left" && "items-start text-left",
        align === "center" && "items-center text-center",
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
        {step}-qadam
      </span>
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <span>{label}</span>
        <ArrowDown className="h-4 w-4 shrink-0 animate-bounce text-amber-600" aria-hidden />
      </div>
    </div>
  );
}

export default function DavomatFacePage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const canReport = canViewDavomat(user?.role);
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsSharing, setGpsSharing] = useState(false);
  const [site, setSite] = useState<DavomatSite>({
    allowedMeters: DAVOMAT_GEOFENCE_METERS,
    label: DAVOMAT_SITE_LABEL,
    latitude: DAVOMAT_SITE_LAT,
    longitude: DAVOMAT_SITE_LNG,
  });
  const [workplace, setWorkplace] = useState<WorkplaceInfo | null>(null);
  const [historyDays, setHistoryDays] = useState<DavomatDayMetrics[]>([]);
  const [guideDone, setGuideDone] = useState(() => {
    try {
      return localStorage.getItem(PUNCH_GUIDE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [scanOpen, setScanOpen] = useState(false);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [faceImage, setFaceImage] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(FACE_SNAP_KEY);
    } catch {
      return null;
    }
  });
  const watchRef = useRef<number | null>(null);
  const punchLockRef = useRef(false);

  const applyHistory = useCallback((emp?: DavomatEmployee | null) => {
    if (!emp?.days?.length) return;
    setHistoryDays(sortDaysDesc(emp.days));
  }, []);

  const completeGuide = useCallback(() => {
    setGuideDone(true);
    try {
      localStorage.setItem(PUNCH_GUIDE_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const loadWorkplace = useCallback(async () => {
    if (!isAuthenticated) {
      setWorkplace(null);
      return;
    }
    try {
      const w = await fetchMyWorkplace();
      setWorkplace(w);
    } catch {
      setWorkplace(null);
    }
  }, [isAuthenticated]);

  const loadHistory = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const mine = await fetchMyDavomat();
      applyHistory(mine.employee);
    } catch {
      /* Face ID dan keyin ham keladi */
    }
  }, [isAuthenticated, applyHistory]);

  useEffect(() => {
    void fetchDavomatSite().then(setSite);
  }, []);

  useEffect(() => {
    if (!workplace?.site) return;
    if (
      typeof workplace.site.latitude !== "number" ||
      typeof workplace.site.longitude !== "number"
    ) {
      return;
    }
    setSite({
      allowedMeters: workplace.allowedMeters || DAVOMAT_GEOFENCE_METERS,
      label: workplace.site.label,
      latitude: workplace.site.latitude,
      longitude: workplace.site.longitude,
    });
  }, [workplace]);

  useEffect(() => {
    void loadWorkplace();
  }, [loadWorkplace]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const applyGps = (pos: GeolocationPosition) => {
    setGps({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: Math.round(pos.coords.accuracy || 0),
    });
    setGpsError(null);
  };

  const startWatch = useCallback(() => {
    if (!navigator.geolocation) return;
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      applyGps,
      (err) => {
        setGpsError(
          err.code === 1
            ? "Lokatsiyaga ruxsat berilmadi — tugmani bosing va Ruxsatni tanlang"
            : "GPS olinmadi — ochiq joyda qayta urinib ko‘ring",
        );
      },
      { enableHighAccuracy: true, maximumAge: 3_000, timeout: 20_000 },
    );
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("Brauzer GPS ni qo‘llab-quvvatlamaydi");
    }
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  const requestLocationPermission = async () => {
    if (!navigator.geolocation) {
      toast({ title: "GPS yo‘q", description: "Brauzer lokatsiyani qo‘llab-quvvatlamaydi", variant: "destructive" });
      return;
    }
    setGpsSharing(true);
    try {
      const permissions = navigator.permissions;
      if (permissions?.query) {
        const status = await permissions.query({ name: "geolocation" });
        if (status.state === "denied") {
          const msg =
            "Brauzer lokatsiyani bloklagan. Manzil qatoridagi qulfni bosing va «Joylashuv»ga ruxsat bering.";
          setGpsError(msg);
          toast({ title: "Ruxsat yo‘q", description: msg, variant: "destructive" });
          setGpsSharing(false);
          return;
        }
      }
    } catch {
      /* Permissions API yo‘q — getCurrentPosition o‘zi so‘raydi */
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyGps(pos);
        startWatch();
        setGpsSharing(false);
        toast({
          title: "Ruxsat berildi",
          description: `Lokatsiya ochiq · ±${Math.round(pos.coords.accuracy || 0)} m`,
        });
      },
      (err) => {
        setGpsSharing(false);
        const msg =
          err.code === 1
            ? "Lokatsiyaga ruxsat so‘raldi — brauzer oynasida «Ruxsat» ni bosing"
            : "GPS olinmadi — ochiq joyda qayta urinib ko‘ring";
        setGpsError(msg);
        toast({ title: "Ruxsat olinmadi", description: msg, variant: "destructive" });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  };

  const checkInAtIso = verified?.checkInAt || workplace?.today.checkInAt || null;
  const working = Boolean(checkInAtIso) && !(verified?.nextAction === "done" || workplace?.today.complete);

  const elapsedLabel = useMemo(() => {
    if (!checkInAtIso) return "0:00:00";
    return formatElapsed(nowTick - new Date(checkInAtIso).getTime());
  }, [checkInAtIso, nowTick]);

  const clockLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("uz-UZ", {
        timeZone: "Asia/Tashkent",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(nowTick),
    [nowTick],
  );

  const dateLabel = useMemo(() => formatLongDateUz(nowTick), [nowTick]);

  const distance = useMemo(() => {
    if (!gps) return null;
    return haversineMeters(gps.lat, gps.lng, site.latitude, site.longitude);
  }, [gps, site.latitude, site.longitude]);

  const allowedMeters = DAVOMAT_GEOFENCE_METERS;
  const remain = distance != null ? Math.max(0, distance - allowedMeters) : null;
  const inside = distance != null ? distance <= allowedMeters : false;
  const officeDistance = useMemo(() => {
    if (!gps) return null;
    return haversineMeters(gps.lat, gps.lng, DAVOMAT_SITE_LAT, DAVOMAT_SITE_LNG);
  }, [gps]);

  const canOpenFace = Boolean(gps) && !gpsError && isFaceIdSupported() && (workplace ? workplace.employee.hasGps && inside : true);

  const nextAction = verified?.nextAction || workplace?.today.nextAction || "in";
  const done = nextAction === "done" || workplace?.today.complete;
  const hasIn = nextAction === "out" || done || Boolean(checkInAtIso);

  const guideStep = useMemo((): "permission" | "face" | "keldim" | null => {
    if (guideDone || done) return null;
    if (!gps || !inside) return "permission";
    if (!verified) return "face";
    if (!hasIn) return "keldim";
    return null;
  }, [guideDone, done, gps, inside, verified, hasIn]);

  const showGuide = isMobile && guideStep != null;

  useEffect(() => {
    if (guideDone) return;
    const punchedBefore =
      historyDays.some((d) => d.checkIn !== "—") ||
      (workplace?.today.checkIn && workplace.today.checkIn !== "—");
    if (punchedBefore) completeGuide();
  }, [guideDone, historyDays, workplace?.today.checkIn, completeGuide]);

  const todayStatus = done
    ? "complete"
    : hasIn
      ? workplace?.today.status || "present"
      : gpsError
        ? "no_gps"
        : !gps
          ? "waiting_gps"
          : inside
            ? "inside"
            : "outside";

  const holatLabel =
    todayStatus === "complete"
      ? "Bugun yopilgan"
      : hasIn
        ? STATUS_UZ[workplace?.today.status || "present"] || "Ishda"
        : todayStatus === "inside"
          ? "Hududda"
          : todayStatus === "outside"
            ? "Hududdan tashqarida"
            : todayStatus === "no_gps"
              ? "Lokatsiya yo‘q"
              : "GPS kutilmoqda";

  const faceLockedReason = useMemo(() => {
    if (gpsError) return gpsError;
    if (!gps) return "Avval «Ruxsat berish» ni bosing — brauzer lokatsiya so‘raydi";
    if (!isFaceIdSupported()) return "Face ID bu brauzerda ishlamaydi (HTTPS/localhost kerak)";
    if (remain != null && remain > 0) {
      return `Siz ${formatDistance(distance)} uzoqdasiz. Ruxsat ${allowedMeters} m. ${formatApproach(remain)}.`;
    }
    return null;
  }, [gps, gpsError, remain, distance, allowedMeters]);

  const geoPayload = () => {
    if (!gps) throw new Error("GPS yo‘q");
    return { latitude: gps.lat, longitude: gps.lng, accuracy: gps.accuracy };
  };

  const saveFaceImage = (snap?: string) => {
    if (!snap) return;
    setFaceImage(snap);
    try {
      sessionStorage.setItem(FACE_SNAP_KEY, snap);
    } catch {
      /* ignore quota */
    }
  };

  const onCaptured = async (descriptor: number[], snapshot?: string) => {
    if (!gps) throw new Error("GPS yo‘q");
    if (!inside) {
      throw new Error(`Hududdan tashqarida (${formatDistance(distance)}). Yana ${formatDistance(remain)} yaqinlashing.`);
    }
    try {
      const result = await faceVerifyDavomat({
        descriptor,
        ...geoPayload(),
      });
      saveFaceImage(snapshot);
      setVerified({
        descriptor,
        fullName: result.fullName,
        nextAction: result.nextAction,
        checkIn: result.checkIn,
        checkOut: result.checkOut,
        checkInAt: result.checkInAt,
        checkOutAt: result.checkOutAt,
        faceImage: snapshot,
      });
      applyHistory(result.employee);
      toast({
        title: result.fullName,
        description:
          result.nextAction === "done"
            ? "Bugun Keldim va Ketdim allaqachon belgilangan"
            : result.nextAction === "out"
              ? "Bugun Keldim belgilangan — faqat Ketdim qolgan"
              : "Yuz tasdiqlandi — Keldim ni bosing",
      });
      return { fullName: result.fullName };
    } catch (err) {
      if (err instanceof DavomatApiError && err.code === "outside_geofence") {
        if (
          err.workplace &&
          typeof err.workplace.latitude === "number" &&
          typeof err.workplace.longitude === "number"
        ) {
          setSite({
            allowedMeters: err.allowedMeters || DAVOMAT_GEOFENCE_METERS,
            label: err.workplace.location || site.label,
            latitude: err.workplace.latitude,
            longitude: err.workplace.longitude,
          });
        }
        const text =
          err.remainMeters != null && err.remainMeters < 1000
            ? formatApproach(err.remainMeters)
            : err.distanceMeters != null
              ? `Siz ${formatDistance(err.distanceMeters)} uzoqdasiz. ${formatApproach(err.remainMeters)}.`
              : err.message || "Hududdan tashqarida";
        toast({ title: "Hududdan tashqarida", description: text, variant: "destructive" });
        throw new Error(text);
      }
      if (err instanceof DavomatApiError && err.code === "branch_gps_missing") {
        toast({ title: "Filial GPS yo‘q", description: err.message, variant: "destructive" });
        throw err;
      }
      throw err;
    }
  };

  const punch = async (action: "in" | "out") => {
    if (!verified || !gps) return;
    if (punchLockRef.current || busy) return;
    punchLockRef.current = true;
    setBusy(true);
    try {
      const result = await facePunchDavomat({
        descriptor: verified.descriptor,
        ...geoPayload(),
        action,
      });
      setVerified({
        ...verified,
        nextAction: action === "in" ? "out" : "done",
        checkIn: result.checkIn,
        checkOut: result.checkOut,
        checkInAt: result.checkInAt ?? verified.checkInAt,
        checkOutAt: result.checkOutAt ?? verified.checkOutAt,
      });
      toast({
        title: action === "in" ? "Keldim" : "Ketdi",
        description: result.message,
      });
      if (action === "in") completeGuide();
      applyHistory(result.employee);
      await loadWorkplace();
      await loadHistory();
    } catch (err) {
      if (
        err instanceof DavomatApiError &&
        (err.code === "already_in" || err.code === "already_complete")
      ) {
        setVerified({
          ...verified,
          nextAction: err.code === "already_complete" ? "done" : "out",
          checkIn: err.checkIn || verified.checkIn,
          checkOut: err.checkOut || verified.checkOut,
          checkInAt: err.checkInAt || verified.checkInAt,
          checkOutAt: err.checkOutAt || verified.checkOutAt,
        });
        toast({ title: "Allaqachon belgilangan", description: err.message });
        await loadWorkplace();
        await loadHistory();
        return;
      }
      toast({
        title: "Xatolik",
        description: (err as Error)?.message,
        variant: "destructive",
      });
    } finally {
      punchLockRef.current = false;
      setBusy(false);
      setConfirmOut(false);
    }
  };

  const displayName =
    verified?.fullName || workplace?.employee.fullName || user?.fullName || "Xodim";
  const position = roleLabel(user?.role) || "Xodim";
  const department = user?.departmentName;
  const phone = user?.phone;
  const shownFace = verified?.faceImage || faceImage;
  const dayComplete = !verified && Boolean(workplace?.today.complete);
  const checkInLabel = verified?.checkIn || workplace?.today.checkIn || "—";
  const checkOutLabel = verified?.checkOut || workplace?.today.checkOut || "—";
  const closedWork = done
    ? workedMinutesFromPunch({
        checkIn: checkInLabel,
        checkOut: checkOutLabel,
        checkInAt: verified?.checkInAt || workplace?.today.checkInAt,
        checkOutAt: verified?.checkOutAt || workplace?.today.checkOutAt,
      })
    : null;
  const todayStamp =
    workplace?.workDate ||
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(nowTick);

  const ringClass = inside
    ? "ring-4 ring-emerald-400/80"
    : gps
      ? "ring-4 ring-rose-400/80"
      : "ring-4 ring-white/40";

  const locationReady = Boolean(gps) && inside && !gpsError;
  const showFaceStep = locationReady || Boolean(verified);
  const showPunchStep = Boolean(verified) && !done && !dayComplete;

  return (
    <div className="min-h-[100dvh] bg-[linear-gradient(180deg,#e8f1f7_0%,#f8fafc_42%,#ffffff_100%)]">
      <div className="mx-auto max-w-lg px-3 pb-10 pt-4 sm:px-4">
        <section className="overflow-hidden rounded-[28px] bg-[#0b3a5c] text-white shadow-[0_20px_50px_-24px_rgba(11,58,92,0.7)]">
          <div className="relative px-5 pb-6 pt-5">
            <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-10 -left-8 h-28 w-28 rounded-full bg-sky-300/10" />

            <div className="relative flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-sky-200/90">Davomat</p>
                <div className="mt-1 flex items-center gap-2 text-sky-100/90">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span className="text-xs">{dateLabel}</span>
                </div>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-2 text-right backdrop-blur-sm">
                <div className="flex items-center justify-end gap-1.5 text-[10px] uppercase tracking-wide text-sky-200">
                  <Clock3 className="h-3 w-3" />
                  Ayni vaqt
                </div>
                <div className="mt-0.5 font-mono text-2xl font-semibold tabular-nums leading-none">{clockLabel}</div>
              </div>
            </div>

            <div className="relative mt-6 flex items-center gap-4">
              <div className={cn("relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-full bg-white/15", ringClass)}>
                {shownFace ? (
                  <img src={shownFace} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-white">
                    {initials(displayName)}
                  </div>
                )}
                <span
                  className={cn(
                    "absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full border-2 border-[#0b3a5c]",
                    inside ? "bg-emerald-400" : gps ? "bg-rose-500" : "bg-slate-300",
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-xl font-semibold leading-tight">{displayName}</h1>
                <p className="mt-0.5 truncate text-sm text-sky-100/90">{position}</p>
                {department ? <p className="truncate text-xs text-sky-200/80">{department}</p> : null}
                <div className="mt-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                      done || todayStatus === "complete"
                        ? "bg-white/15 text-white"
                        : hasIn
                          ? "bg-emerald-400/20 text-emerald-100"
                          : inside
                            ? "bg-emerald-400/20 text-emerald-100"
                            : "bg-rose-400/25 text-rose-100",
                    )}
                  >
                    Holat: {holatLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="relative mt-4 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-2xl bg-emerald-500/20 px-3 py-2">
                <div className="text-emerald-200">Keldim</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-50">
                  {verified?.checkIn || workplace?.today.checkIn || "—"}
                </div>
              </div>
              <div className="rounded-2xl bg-rose-500/20 px-3 py-2">
                <div className="text-rose-200">Ketdim</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-rose-50">
                  {verified?.checkOut || workplace?.today.checkOut || "—"}
                </div>
              </div>
            </div>
            {phone ? (
              <p className="relative mt-2 text-[11px] text-sky-200/80">Tel: {phone}</p>
            ) : null}
          </div>
        </section>

        <section className="mt-4 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0b3a5c] text-[11px] font-bold text-white">
              1
            </span>
            <div className="flex flex-1 items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0b3a5c]">
                <MapPin className="h-4 w-4" />
                Joylashuv
              </div>
            <div className="relative shrink-0">
              {showGuide && guideStep === "permission" ? (
                <MobileStepHint step={1} label="Ruxsat berish ni bosing" align="right" />
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn(
                  "h-9 gap-1.5 rounded-full border-[#0b3a5c]/20 text-[#0b3a5c]",
                  showGuide && guideStep === "permission" && "ring-2 ring-amber-400 ring-offset-2",
                )}
                disabled={gpsSharing}
                onClick={() => void requestLocationPermission()}
              >
                {gpsSharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Ruxsat berish
              </Button>
            </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-3">
            <div
              className={cn(
                "flex h-16 w-16 flex-col items-center justify-center rounded-2xl text-center",
                inside ? "bg-emerald-50 text-emerald-800" : gps ? "bg-rose-50 text-rose-800" : "bg-slate-100 text-slate-500",
              )}
            >
              {gps && distance != null ? (
                <>
                  <span className="text-lg font-semibold tabular-nums leading-none">
                    {formatDistanceParts(distance).value}
                  </span>
                  <span className="text-[10px]">{formatDistanceParts(distance).unit}</span>
                </>
              ) : (
                <Loader2 className="h-5 w-5 animate-spin" />
              )}
            </div>
            <div className="min-w-0 text-sm">
              {inside ? (
                <p className="font-medium text-emerald-800">
                  <CheckCircle2 className="mr-1 inline h-4 w-4" />
                  Hududdasiz
                </p>
              ) : gps && remain != null ? (
                <p className="font-medium text-rose-800">
                  <XCircle className="mr-1 inline h-4 w-4" />
                  Hududdan tashqarida
                </p>
              ) : (
                <p className="text-slate-500">«Ruxsat berish» ni bosing — lokatsiya so‘raladi</p>
              )}
              <p className="mt-0.5 text-xs text-slate-500">
                {workplace?.site?.kind === "branch" ? "O‘z filiali" : "Asosiy ofis"} · ruxsat {allowedMeters} m
              </p>
              {site.label ? (
                <p className="mt-0.5 truncate text-[11px] text-slate-400">{site.label}</p>
              ) : null}
              {gps ? (
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                  {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} · ±{gps.accuracy} m
                </p>
              ) : null}
            </div>
          </div>

          {workplace && workplace.employee.hasGps === false ? (
            <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-950">
              {workplace.gpsError ||
                "Filial lokatsiyasi kiritilmagan. Koordinator GPS kiritsin."}
            </p>
          ) : null}

          {gps && distance != null ? (
            <div
              className={cn(
                "mt-3 rounded-2xl border px-3 py-2.5 text-center text-sm font-medium",
                inside
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800",
              )}
            >
              {inside ? (
                <>
                  <CheckCircle2 className="mr-1 inline h-4 w-4" />
                  Hududdasiz · {formatDistance(distance)} (ruxsat {allowedMeters} m)
                </>
              ) : (
                <>
                  <XCircle className="mr-1 inline h-4 w-4" />
                  Siz {formatDistance(distance)} uzoqdasiz · {formatApproach(remain)}
                  <span className="mt-0.5 block text-xs font-normal text-rose-700">
                    Davomat faqat {workplace?.site?.kind === "branch" ? "filial" : "asosiy ofis"}dan {allowedMeters} m ichida
                  </span>
                </>
              )}
            </div>
          ) : null}

          {officeDistance != null && officeDistance > 1000 ? (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800">
              <p className="font-semibold">
                Asosiy ofisdan {formatDistance(officeDistance)} · {1} kishi
              </p>
              <p className="mt-1 text-slate-700">{displayName}</p>
            </div>
          ) : null}
          {gpsError ? <p className="mt-2 text-sm text-rose-600">{gpsError}</p> : null}
          {locationReady ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Joylashuv tasdiqlandi — keyingi qadam: Face ID
            </p>
          ) : null}
        </section>

        {showFaceStep ? (
          <section className="mt-4 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0b3a5c] text-[11px] font-bold text-white">
                2
              </span>
              <h2 className="text-sm font-semibold text-[#0b3a5c]">Face ID</h2>
            </div>
            {verified ? (
              <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold">Yuz tasdiqlandi</p>
                  <p className="text-xs text-emerald-700">{verified.fullName}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {showGuide && guideStep === "face" ? (
                  <MobileStepHint step={2} label="Face ID ni bosing" />
                ) : null}
                <Button
                  type="button"
                  size="lg"
                  className={cn(
                    "h-14 w-full gap-2 rounded-2xl bg-[#0b3a5c] text-base hover:bg-[#0a314d]",
                    showGuide && guideStep === "face" && "ring-2 ring-amber-400 ring-offset-2",
                  )}
                  disabled={!canOpenFace}
                  onClick={() => setScanOpen(true)}
                >
                  {canOpenFace ? <ScanFace className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                  {canOpenFace ? "Face ID" : "Face ID yopiq"}
                </Button>
                {!canOpenFace && faceLockedReason ? (
                  <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-sm text-rose-800">
                    {faceLockedReason}
                  </p>
                ) : (
                  <p className="text-center text-xs text-slate-500">
                    Yuz tasdiqlangach Keldim / Ketdim ochiladi
                  </p>
                )}
              </div>
            )}
          </section>
        ) : null}

        {showPunchStep ? (
          <section className="mt-4 rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0b3a5c] text-[11px] font-bold text-white">
                3
              </span>
              <h2 className="text-sm font-semibold text-[#0b3a5c]">Keldim / Ketdim</h2>
            </div>
            {hasIn ? (
              <Button
                type="button"
                size="lg"
                className="h-14 w-full gap-2 rounded-2xl bg-red-600 text-base text-white hover:bg-red-700"
                disabled={busy}
                onClick={() => setConfirmOut(true)}
              >
                <LogOut className="h-5 w-5" />
                Ketdim
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  {showGuide && guideStep === "keldim" ? (
                    <MobileStepHint step={3} label="Keldim ni bosing" align="left" />
                  ) : null}
                  <Button
                    type="button"
                    size="lg"
                    className={cn(
                      "h-14 w-full gap-2 rounded-2xl bg-emerald-600 text-base text-white hover:bg-emerald-700",
                      showGuide && guideStep === "keldim" && "ring-2 ring-amber-400 ring-offset-2",
                    )}
                    disabled={busy}
                    onClick={() => void punch("in")}
                  >
                    <LogIn className="h-5 w-5" />
                    Keldim
                  </Button>
                </div>
                <Button type="button" size="lg" className="h-14 w-full gap-2 rounded-2xl bg-red-600 text-base text-white" disabled>
                  <LogOut className="h-5 w-5" />
                  Ketdim
                </Button>
              </div>
            )}
          </section>
        ) : null}

        {working ? (
          <section className="mt-4 rounded-[24px] border border-emerald-200 bg-emerald-50/80 px-4 py-4 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Ishlayotgan vaqt</p>
            <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-emerald-950">{elapsedLabel}</p>
            <p className="mt-1 text-xs text-emerald-700">Keldim: {verified?.checkIn || workplace?.today.checkIn}</p>
          </section>
        ) : null}

        <section className="mt-4 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-[#0b3a5c]">Bugungi davomatim</h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                <CalendarDays className="h-3.5 w-3.5" />
                {dateLabel}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                done
                  ? "bg-slate-100 text-slate-600"
                  : hasIn
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-slate-50 text-slate-500",
              )}
            >
              {holatLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <LogIn className="h-3.5 w-3.5" />
                Keldim
              </div>
              <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-950">
                {checkInLabel}
              </div>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-rose-700">
                <LogOut className="h-3.5 w-3.5" />
                Ketdim
              </div>
              <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-rose-950">
                {checkOutLabel}
              </div>
            </div>
          </div>
          {done && closedWork != null ? (
            <div className="mx-4 mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-center">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Ishlangan vaqt</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#0b3a5c]">
                {formatHoursUz(closedWork)}
              </p>
              <p className="mt-2 text-[11px] text-slate-400">
                Kuniga faqat 1 marta Keldim va 1 marta Ketdim
              </p>
            </div>
          ) : done ? (
            <p className="px-4 pb-3 text-center text-xs text-slate-400">
              Kuniga faqat 1 marta Keldim va 1 marta Ketdim
            </p>
          ) : null}
        </section>

        <section className="mt-4 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[#0b3a5c]">
              <History className="h-4 w-4" />
              Tarix
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Bugundan orqaga · Keldim/Ketdim saqlanadi
            </p>
          </div>
          {historyDays.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              Hali yozuv yo‘q. Face ID bilan belgilang — tarix shu yerda chiqadi.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-[11px] text-slate-500">
                    <th className="px-3 py-2 font-medium">Sana</th>
                    <th className="px-3 py-2 font-medium">Keldim</th>
                    <th className="px-3 py-2 font-medium">Ketdim</th>
                    <th className="px-3 py-2 font-medium">Holat</th>
                    <th className="px-3 py-2 font-medium">Ishlagan</th>
                  </tr>
                </thead>
                <tbody>
                  {historyDays.map((d) => {
                    const isToday = d.date === todayStamp;
                    const dayParts = splitDayUz(d.date);
                    const worked =
                      d.checkIn !== "—" && d.checkOut !== "—"
                        ? workedMinutesFromPunch({
                            checkIn: d.checkIn,
                            checkOut: d.checkOut,
                          })
                        : null;
                    return (
                      <tr
                        key={d.date}
                        className={cn(
                          "border-b border-slate-100",
                          isToday ? "bg-sky-50/70" : "bg-white",
                        )}
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 align-middle">
                          <div className="flex items-baseline gap-2">
                            <span className="font-semibold text-slate-800">{dayParts.date}</span>
                            <span className="font-medium text-sky-600">{dayParts.weekday}</span>
                            {isToday ? (
                              <span className="text-[11px] font-medium text-emerald-700">bugun</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-emerald-800">{d.checkIn}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-rose-800">{d.checkOut}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                              STATUS_STYLE[d.status] || "bg-slate-100 text-slate-600",
                            )}
                          >
                            {STATUS_UZ[d.status] || d.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium tabular-nums text-slate-800">
                            {worked != null ? formatHoursUz(worked) : d.workedHours}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="mt-5 flex justify-center gap-4 text-sm">
          <Link href="/login" className="text-[#0b3a5c] underline-offset-2 hover:underline">
            Login
          </Link>
          {isAuthenticated && canReport ? (
            <Link href="/davomat" className="text-[#0b3a5c] underline-offset-2 hover:underline">
              Hisobot
            </Link>
          ) : null}
        </div>
      </div>

      <FaceScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        mode="login"
        title="Davomat · Face ID"
        description="Lokatsiya tasdiqlangan. Ko‘zni ochiq tuting, keyin sekin 2 marta yumib oching."
        onCaptured={onCaptured}
      />

      <AlertDialog open={confirmOut} onOpenChange={setConfirmOut}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ketdim ni tasdiqlaysizmi?</AlertDialogTitle>
            <AlertDialogDescription>
              {elapsedLabel} ishladingiz. Ha desangiz, bugungi ketish vaqti yoziladi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Yo‘q</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void punch("out")}>
              Ha
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
