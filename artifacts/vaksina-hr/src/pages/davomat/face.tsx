import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
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
  ArrowLeft,
  Banknote,
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
import { enrollFace, fetchFaceIdStatus, isFaceIdSupported } from "@/lib/face-id";
import {
  DAVOMAT_GEOFENCE_METERS,
  DAVOMAT_OFFICE_GEOFENCE_METERS,
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
import type { User } from "@workspace/api-client-react";
import { canViewDavomat } from "@/lib/roles";
import { roleLabel } from "@/lib/candidate-access";
import { useTelegramMiniAppChrome } from "@/pages/tg-entry";
import { formatSom, useOylikMe } from "@/lib/oylik-api";
import { PUNCH_FINE_HINT, punchPlanLabel, workShiftForUserRole, workplaceDisplayTitle } from "@/lib/work-schedule";

const FACE_SNAP_KEY = "davomat-face-snap";

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
  liveness?: { blinked?: boolean; poses?: string[]; motion?: number; score?: number };
};

type GuideStep = "enroll" | "permission" | "zone" | "face" | "keldim" | "ketdim" | "done";

function tashkentHour(now: number): number {
  const raw = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "numeric",
    hour12: false,
  }).format(new Date(now));
  return Number(raw);
}

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
  present: "bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",
  late: "bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  incomplete: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  absent: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  leave: "bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
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
  tone = "amber",
}: {
  step: number;
  label: string;
  tone?: "amber" | "rose" | "emerald";
}) {
  return (
    <div
      className={cn(
        "dv-step-hint border-l-[3px]",
        tone === "amber" && "border-l-primary",
        tone === "rose" && "border-l-rose-500",
        tone === "emerald" && "border-l-teal-500",
      )}
    >
      <span
        className={cn(
          "dv-step-badge",
          tone === "amber" && "dv-step-badge-warn",
          tone === "rose" && "dv-step-badge-danger",
          tone === "emerald" && "dv-step-badge-success",
        )}
      >
        {step}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{step}-qadam</p>
        <p className="text-sm font-medium leading-snug text-foreground">{label}</p>
      </div>
      <ArrowDown className="h-4 w-4 shrink-0 animate-bounce text-muted-foreground" aria-hidden />
    </div>
  );
}

function GuideBoard({
  active,
  faceRegistered,
  inside,
  hasGps,
  hasIn,
  afterSix,
  done,
}: {
  active: GuideStep;
  faceRegistered: boolean | null;
  inside: boolean;
  hasGps: boolean;
  hasIn: boolean;
  afterSix: boolean;
  done: boolean;
}) {
  const items: Array<{
    id: GuideStep;
    n: number;
    title: string;
    detail: string;
  }> = [
    {
      id: "enroll",
      n: 0,
      title: "Yuzni ro‘yxatdan o‘tkazing",
      detail: "Davomatdan oldin Face ID bir marta ulanishi shart",
    },
    {
      id: "permission",
      n: 1,
      title: "Ruxsat berish",
      detail: "Lokatsiya ruxsatini yoqing",
    },
    {
      id: "zone",
      n: 1,
      title: "Yashil hududga kiring",
      detail: "Belgilangan zonaga kirmasangiz — kelmagan deb belgilanadi",
    },
    {
      id: "face",
      n: 2,
      title: "Face ID ni bosing",
      detail: "Yashil hududdasiz — yuzni tasdiqlang",
    },
    {
      id: "keldim",
      n: 3,
      title: "Keldim ni bosing",
      detail: "Yuz o‘tgach kelishni belgilang",
    },
    {
      id: "ketdim",
      n: 4,
      title: "Ketdim ni bosing",
      detail: "Ishdan chiqishni belgilang (tasdiq so‘raladi)",
    },
  ];

  const visible = items.filter((it) => {
    if (it.id === "enroll") return faceRegistered === false;
    if (it.id === "zone") return faceRegistered !== false && hasGps && !inside && !hasIn && !done;
    if (it.id === "permission") return faceRegistered !== false && (!hasGps || !inside) && !hasIn && !done;
    if (it.id === "face") return faceRegistered !== false;
    if (it.id === "keldim") return faceRegistered !== false;
    if (it.id === "ketdim") return faceRegistered !== false && (hasIn || afterSix || done);
    return true;
  });

  // Deduplicate permission/zone for board display as sequential unique steps
  const board = (() => {
    const out: typeof items = [];
    const seen = new Set<number>();
    for (const it of visible) {
      if (it.id === "enroll") {
        out.push(it);
        continue;
      }
      if (it.id === "permission" || it.id === "zone") {
        if (seen.has(1)) continue;
        seen.add(1);
        out.push(
          !hasGps
            ? items.find((x) => x.id === "permission")!
            : inside
              ? items.find((x) => x.id === "permission")!
              : items.find((x) => x.id === "zone")!,
        );
        continue;
      }
      if (seen.has(it.n)) continue;
      seen.add(it.n);
      out.push(it);
    }
    return out;
  })();

  return (
    <section className="dv-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Yo‘riqnoma
          </p>
          <h2 className="mt-0.5 text-base font-semibold text-foreground">Davomat qadamlari</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Har kirganingizda shu tartibda boring — aniq va tartibli
          </p>
        </div>
        {done ? (
          <span className="dv-tone-emerald rounded-full border px-2.5 py-1 text-[11px] font-semibold">
            Bugun yakunlandi
          </span>
        ) : null}
      </div>
      <ol className="space-y-2">
        {board.map((it) => {
          const isActive =
            active === it.id ||
            (active === "zone" && it.id === "zone") ||
            (active === "permission" && it.id === "permission");
          const passed =
            done ||
            (it.id === "enroll" && faceRegistered) ||
            (it.n === 1 && hasGps && inside) ||
            (it.id === "face" && (Boolean(hasIn) || active === "keldim" || active === "ketdim")) ||
            (it.id === "keldim" && hasIn) ||
            (it.id === "ketdim" && done);

          return (
            <li
              key={`${it.id}-${it.n}`}
              className={cn(
                "flex gap-3 rounded-2xl border px-3 py-2.5 transition-colors",
                isActive && !passed && it.id !== "zone" && "dv-guide-active",
                passed && "dv-guide-passed",
                !isActive && !passed && "dv-guide-idle",
                it.id === "zone" && isActive && "dv-guide-danger",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                  passed && "dv-step-badge-success",
                  isActive && !passed && it.id === "zone" && "dv-step-badge-danger",
                  isActive && !passed && it.id !== "zone" && "dv-step-badge-warn",
                  !isActive && !passed && "bg-muted text-muted-foreground",
                )}
              >
                {passed ? "✓" : it.n === 0 ? "!" : it.n}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {it.n === 0 ? "Avval" : `${it.n}-qadam`}: {it.title}
                </p>
                <p
                  className={cn(
                    "mt-0.5 text-xs leading-snug",
                    it.id === "zone" && isActive ? "font-medium text-rose-700 dark:text-rose-300" : "text-muted-foreground",
                  )}
                >
                  {it.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {active === "zone" ? (
        <p className="dv-tone-rose mt-3 rounded-xl border px-3 py-2 text-center text-sm font-semibold">
          Yashil hududga kirmasangiz — bugun kelmagan deb belgilanasiz
        </p>
      ) : null}
      {active === "ketdim" ? (
        <p className="dv-tone-rose mt-3 rounded-xl border px-3 py-2 text-center text-sm font-semibold">
          4-qadam: «Ketdim» ni bosing — tasdiqlang
        </p>
      ) : null}
    </section>
  );
}

function isTelegramMiniAppContext(): boolean {
  if (typeof window === "undefined") return false;
  if (window.Telegram?.WebApp) return true;
  try {
    return new URL(window.location.href).searchParams.get("tg") === "1";
  } catch {
    return false;
  }
}

export default function DavomatFacePage() {
  const { user, isAuthenticated, switchToUser } = useAuth();
  const [, setLocation] = useLocation();
  const oylikMe = useOylikMe();
  const isTgMiniApp = useMemo(() => isTelegramMiniAppContext(), []);
  useTelegramMiniAppChrome();
  const { toast } = useToast();
  const canReport = canViewDavomat(user?.role);
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsSharing, setGpsSharing] = useState(false);
  const [site, setSite] = useState<DavomatSite>({
    allowedMeters: DAVOMAT_OFFICE_GEOFENCE_METERS,
    label: DAVOMAT_SITE_LABEL,
    latitude: DAVOMAT_SITE_LAT,
    longitude: DAVOMAT_SITE_LNG,
    kind: "office",
  });
  const [workplace, setWorkplace] = useState<WorkplaceInfo | null>(null);
  const [historyDays, setHistoryDays] = useState<DavomatDayMetrics[]>([]);
  const [historyRange, setHistoryRange] = useState<"day" | "week" | "month">("week");
  const [faceRegistered, setFaceRegistered] = useState<boolean | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
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
  const tgBootRef = useRef(false);
  const tgScanRef = useRef(false);

  const applyHistory = useCallback((emp?: DavomatEmployee | null) => {
    if (!emp?.days?.length) return;
    setHistoryDays(sortDaysDesc(emp.days));
  }, []);

  const refreshFaceStatus = useCallback(async () => {
    if (!isAuthenticated) {
      setFaceRegistered(null);
      return;
    }
    try {
      const s = await fetchFaceIdStatus();
      setFaceRegistered(s.registered);
    } catch {
      setFaceRegistered(null);
    }
  }, [isAuthenticated]);

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
    void refreshFaceStatus();
  }, [refreshFaceStatus]);

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

  const allowedMeters = workplace?.allowedMeters || site.allowedMeters || DAVOMAT_GEOFENCE_METERS;
  const remain = distance != null ? Math.max(0, distance - allowedMeters) : null;
  /** Filial GPS yo‘q bo‘lsa ofis nuqtasiga tushib «Hududdasiz» deb yolg‘on yashil ko‘rsatilmasin */
  const workplaceGpsMissing = workplace?.employee.hasGps === false;
  const inside =
    !workplaceGpsMissing && distance != null ? distance <= allowedMeters : false;

  /**
   * Face ID skani davomat profilini aniqlaydi (tizim login emas).
   * faceRegistered === false kutish — status 401 bo‘lsa tugma abadiy yopiq qolardi.
   */
  const canOpenFace =
    faceRegistered !== false &&
    Boolean(gps) &&
    !gpsError &&
    isFaceIdSupported() &&
    inside;

  const nextAction = verified?.nextAction || workplace?.today.nextAction || "in";
  const done = nextAction === "done" || workplace?.today.complete;
  const hasIn = nextAction === "out" || done || Boolean(checkInAtIso);
  const afterSix = tashkentHour(nowTick) >= 18;

  const guideStep = useMemo((): GuideStep => {
    if (done) return "done";
    if (faceRegistered === false) return "enroll";
    if (!gps || gpsError) return "permission";
    if (!inside) return "zone";
    if (!verified) return "face";
    if (!hasIn) return "keldim";
    return "ketdim";
  }, [done, faceRegistered, gps, gpsError, inside, verified, hasIn]);

  /** Mobil: doim aktiv qadamni ko‘rsat; desktopda ham panel ochiq */
  const showGuide = guideStep !== "done";

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
    if (faceRegistered === false) return "Avval yuzni ro‘yxatdan o‘tkazing";
    if (gpsError) return gpsError;
    if (!gps) return "1-qadam: «Ruxsat berish» ni bosing";
    if (!isFaceIdSupported()) return "Face ID bu brauzerda ishlamaydi (HTTPS/localhost kerak)";
    if (workplaceGpsMissing) {
      return (
        workplace?.gpsError ||
        "Filial lokatsiyasi kiritilmagan. Koordinator avval GPS kiritsin."
      );
    }
    if (remain != null && remain > 0) {
      return `Yashil hududga kirmadingiz (${formatDistance(distance)}). Kelmagan deb belgilanasiz. ${formatApproach(remain)}.`;
    }
    return null;
  }, [faceRegistered, gps, gpsError, remain, distance, workplaceGpsMissing, workplace?.gpsError]);

  useEffect(() => {
    if (!isTgMiniApp || tgBootRef.current) return;
    tgBootRef.current = true;
    void requestLocationPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTgMiniApp]);

  useEffect(() => {
    if (!isTgMiniApp || tgScanRef.current || done || verified || faceRegistered === false) return;
    if (canOpenFace) {
      tgScanRef.current = true;
      setScanOpen(true);
    }
  }, [isTgMiniApp, canOpenFace, done, verified, faceRegistered]);

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

  const adoptRecognizedProfile = useCallback(
    (sessionUser: User | null | undefined, fullName: string) => {
      if (!sessionUser?.id) return;
      switchToUser(sessionUser as User);
      toast({
        title: fullName || sessionUser.fullName,
        description: "Yuz aniqlandi — tizim shu profilga o‘tdi",
      });
    },
    [switchToUser, toast],
  );

  const onCaptured = async (
    descriptor: number[] | number[][],
    snapshot?: string,
    liveness?: { blinked?: boolean; poses?: string[]; motion?: number; score?: number },
  ) => {
    if (!gps) throw new Error("GPS yo‘q");
    if (!inside) {
      throw new Error(`Hududdan tashqarida (${formatDistance(distance)}). Yana ${formatDistance(remain)} yaqinlashing.`);
    }
    try {
      const list = (Array.isArray(descriptor[0]) ? descriptor : [descriptor]) as number[][];
      const vec = list[0]!;
      const result = await faceVerifyDavomat({
        descriptor: vec,
        descriptors: list,
        snapshot,
        liveness,
        ...geoPayload(),
      });
      saveFaceImage(snapshot);
      setVerified({
        descriptor: vec,
        fullName: result.fullName,
        nextAction: result.nextAction,
        checkIn: result.checkIn,
        checkOut: result.checkOut,
        checkInAt: result.checkInAt,
        checkOutAt: result.checkOutAt,
        faceImage: snapshot,
        liveness,
      });
      applyHistory(result.employee);
      if (result.user) {
        if (result.ownerVerified) {
          toast({
            title: result.fullName,
            description: "Yuz tasdiqlandi — bu sizning akkauntingiz",
          });
          void loadWorkplace();
          void loadHistory();
        } else {
          adoptRecognizedProfile(result.user as User, result.fullName);
          void loadWorkplace();
          void loadHistory();
        }
      } else {
        toast({
          title: result.fullName,
          description:
            result.nextAction === "done"
              ? "Bugun Keldim va Ketdim allaqachon belgilangan"
              : result.nextAction === "out"
                ? "Bugun Keldim belgilangan — faqat Ketdim qolgan"
                : "Yuz tasdiqlandi — Keldim ni bosing",
        });
      }
      return { fullName: result.fullName };
    } catch (err) {
      if (err instanceof DavomatApiError && err.code === "face_not_owner") {
        const msg =
          err.message ||
          (err.fullName ? `Siz ${err.fullName} emassiz` : "Bu yuz kirgan akkauntga tegishli emas");
        toast({ title: "Boshqa odam", description: msg, variant: "destructive" });
        throw new Error(msg);
      }
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
        snapshot: verified.faceImage,
        liveness: verified.liveness,
      });
      setVerified({
        ...verified,
        nextAction: action === "in" ? "out" : "done",
        checkIn: result.checkIn,
        checkOut: result.checkOut,
        checkInAt: result.checkInAt ?? verified.checkInAt,
        checkOutAt: result.checkOutAt ?? verified.checkOutAt,
      });
      if (result.user) {
        adoptRecognizedProfile(result.user as User, result.fullName || verified.fullName);
      }
      toast({
        title: action === "in" ? "Keldim" : "Ketdi",
        description: result.message,
      });
      if (action === "in") {
        /* guide stays live for Ketdim */
      }
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
  const displayShift = useMemo(() => {
    if (workplace?.shift) return workplace.shift;
    if (!user?.role) return null;
    return workShiftForUserRole(user.role);
  }, [workplace?.shift, user?.role]);
  const workplaceTitle = useMemo(
    () =>
      workplaceDisplayTitle(
        user?.role,
        workplace?.site ?? (site.kind ? { kind: site.kind, label: site.label } : null),
        workplace?.employee?.location,
      ),
    [user?.role, workplace?.site, workplace?.employee?.location, site.kind, site.label],
  );
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

  const filteredHistoryDays = useMemo(() => {
    const sorted = sortDaysDesc(historyDays);
    if (historyRange === "day") {
      return sorted.filter((d) => d.date === todayStamp).slice(0, 1);
    }
    if (historyRange === "week") {
      return sorted.slice(0, 7);
    }
    return sorted.slice(0, 31);
  }, [historyDays, historyRange, todayStamp]);

  const historySummary = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    let minutes = 0;
    for (const d of filteredHistoryDays) {
      if (d.status === "present") present += 1;
      else if (d.status === "late") late += 1;
      else if (d.status === "absent") absent += 1;
      const w =
        d.checkIn !== "—" && d.checkOut !== "—"
          ? workedMinutesFromPunch({ checkIn: d.checkIn, checkOut: d.checkOut })
          : null;
      if (w != null) minutes += w;
      else if (typeof d.workedMinutes === "number") minutes += d.workedMinutes;
    }
    return { present, late, absent, minutes, count: filteredHistoryDays.length };
  }, [filteredHistoryDays]);

  const ringClass = inside
    ? "ring-4 ring-teal-400/70"
    : gps
      ? "ring-4 ring-rose-400/60"
      : "ring-4 ring-primary-foreground/25";

  const locationReady = Boolean(gps) && inside && !gpsError && faceRegistered !== false;
  const showFaceStep =
    faceRegistered !== false &&
    (locationReady || Boolean(verified) || Boolean(gps) || (hasIn && !done));
  const showPunchStep = Boolean(verified) && !done && !dayComplete;
  const canPunchOut = hasIn && !done;

  const onEnrollCaptured = async (
    descriptor: number[] | number[][],
    snapshot?: string,
    liveness?: { blinked?: boolean; poses?: string[]; motion?: number; score?: number },
  ) => {
    await enrollFace(descriptor, snapshot, liveness);
    setFaceRegistered(true);
    saveFaceImage(snapshot);
    toast({
      title: "Yuz ro‘yxatdan o‘tdi",
      description: "Endi 1-qadamdan davomatni boshlang",
    });
    await refreshFaceStatus();
  };

  return (
    <div className="davomat-face-page">
      <div className="mx-auto max-w-lg px-3 pb-10 pt-4 sm:px-4 md:max-w-3xl lg:max-w-4xl">
        <section className="dv-hero">
          <div className="relative px-5 pb-6 pt-5">
            <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/[0.06]" />
            <div className="pointer-events-none absolute -bottom-10 -left-8 h-28 w-28 rounded-full bg-white/[0.04]" />

            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={user?.role === "stajyor" ? "/kirish" : "/dashboard"}
                  className="mb-2.5 inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 px-3 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/25"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Chiqish
                </Link>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] dv-hero-muted">
                  Davomat
                </p>
                <div className="mt-1 flex items-center gap-2 dv-hero-muted">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span className="text-xs">{dateLabel}</span>
                </div>
              </div>
              <div className="dv-hero-stat px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-1.5 text-[10px] uppercase tracking-wide dv-hero-muted">
                  <Clock3 className="h-3 w-3" />
                  Ayni vaqt
                </div>
                <div className="mt-0.5 font-mono text-2xl font-semibold tabular-nums leading-none">{clockLabel}</div>
              </div>
            </div>

            <div className="relative mt-6 flex items-center gap-4">
              <div className={cn("relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-full dv-hero-stat", ringClass)}>
                {shownFace ? (
                  <img src={shownFace} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-white">
                    {initials(displayName)}
                  </div>
                )}
                <span
                  className={cn(
                    "absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full border-2 border-primary",
                    inside ? "bg-teal-400" : gps ? "bg-rose-400" : "bg-slate-400",
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-xl font-semibold leading-tight">{displayName}</h1>
                <p className="mt-0.5 truncate text-sm dv-hero-muted">{position}</p>
                {department ? <p className="truncate text-xs dv-hero-muted opacity-80">{department}</p> : null}
                {displayShift ? (
                  <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.06] px-2.5 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium uppercase tracking-wide dv-hero-muted">
                          Ish joyi
                        </p>
                        <p className="truncate text-sm font-semibold text-white">{workplaceTitle}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] font-medium uppercase tracking-wide dv-hero-muted">
                          {displayShift.type === "office" ? "Ish vaqti" : "Smena · ish vaqti"}
                        </p>
                        {displayShift.type !== "office" ? (
                          <p className="text-[11px] font-medium text-white/90">{displayShift.label}</p>
                        ) : null}
                        <p className="font-mono text-sm font-semibold tabular-nums text-white">
                          {displayShift.start} – {displayShift.end}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="mt-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                      done || todayStatus === "complete"
                        ? "bg-white/12 text-white"
                        : hasIn || inside
                          ? "bg-teal-400/20 text-teal-100"
                          : "bg-slate-400/25 text-slate-100",
                    )}
                  >
                    Holat: {holatLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="relative mt-4 grid grid-cols-2 gap-2 text-[11px]">
              <div className="dv-punch-in">
                <div className="dv-punch-label">
                  Keldim{displayShift ? ` ${punchPlanLabel("in", displayShift.start)}` : ""}
                </div>
                <div className="dv-punch-value mt-0.5 text-sm font-semibold tabular-nums">
                  {verified?.checkIn || workplace?.today.checkIn || "—"}
                </div>
              </div>
              <div className="dv-punch-out">
                <div className="dv-punch-label">
                  Ketdim{displayShift ? ` ${punchPlanLabel("out", displayShift.end)}` : ""}
                </div>
                <div className="dv-punch-value mt-0.5 text-sm font-semibold tabular-nums">
                  {verified?.checkOut || workplace?.today.checkOut || "—"}
                </div>
              </div>
            </div>
            {displayShift ? (
              <p className="relative mt-2 text-center text-[10px] font-medium leading-snug text-rose-400">
                {PUNCH_FINE_HINT}
              </p>
            ) : null}
            {phone ? (
              <p className="relative mt-2 text-[11px] dv-hero-muted">Tel: {phone}</p>
            ) : null}
          </div>
        </section>

        <div className="mt-4">
          <GuideBoard
            active={guideStep}
            faceRegistered={faceRegistered}
            inside={inside}
            hasGps={Boolean(gps) && !gpsError}
            hasIn={hasIn}
            afterSix={afterSix}
            done={Boolean(done)}
          />
        </div>

        {faceRegistered === false ? (
          <section className="dv-card dv-tone-info mt-4 border-l-[3px] border-l-primary">
            {showGuide && guideStep === "enroll" ? (
              <MobileStepHint step={0} label="Face ID ni ulashni bosing" tone="amber" />
            ) : null}
            <div className={cn("flex items-center gap-2", showGuide && guideStep === "enroll" ? "mt-3" : "mb-3")}>
              <span className="dv-step-badge dv-step-badge-warn">!</span>
              <h2 className="text-sm font-semibold">Avval yuzni ro‘yxatdan o‘tkazing</h2>
            </div>
            <p className="mb-3 text-sm opacity-90">
              Davomat qilishdan oldin bir marta Face ID ulashing. Keyin yo‘riqnoma 1–4 qadam bilan ochiladi.
            </p>
            <Button
              type="button"
              size="lg"
              className={cn(
                "h-14 w-full gap-2 rounded-2xl text-base",
                showGuide && guideStep === "enroll" && "dv-focus",
              )}
              disabled={!isFaceIdSupported()}
              onClick={() => setEnrollOpen(true)}
            >
              <ScanFace className="h-5 w-5" />
              Face ID ni ulash
            </Button>
            {!isFaceIdSupported() ? (
              <p className="mt-2 text-center text-xs opacity-80">Kamera va HTTPS/localhost kerak</p>
            ) : null}
          </section>
        ) : null}

        <section className="dv-card mt-4">
          {showGuide && guideStep === "permission" ? (
            <MobileStepHint step={1} label="Ruxsat berish ni bosing" tone="amber" />
          ) : null}
          <div className={cn("flex items-center gap-2", showGuide && guideStep === "permission" ? "mt-3 mb-3" : "mb-3")}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              1
            </span>
            <div className="flex flex-1 items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <MapPin className="h-4 w-4" />
                Joylashuv
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={cn(
                  "h-9 shrink-0 gap-1.5 rounded-full border-border text-foreground hover:bg-muted",
                  showGuide && guideStep === "permission" && "dv-focus",
                )}
                disabled={gpsSharing || faceRegistered === false}
                onClick={() => void requestLocationPermission()}
              >
                {gpsSharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                Ruxsat berish
              </Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-3">
            <div
              className={cn(
                "flex h-16 w-16 flex-col items-center justify-center rounded-2xl text-center",
                inside ? "dv-tone-emerald border-0 bg-teal-500/15" : gps ? "dv-tone-rose border-0 bg-rose-500/15" : "bg-muted text-muted-foreground",
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
                <p className="font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="mr-1 inline h-4 w-4" />
                  Hududdasiz
                </p>
              ) : gps && remain != null ? (
                <p className="font-medium text-rose-700 dark:text-rose-300">
                  <XCircle className="mr-1 inline h-4 w-4" />
                  Hududdan tashqarida
                </p>
              ) : (
                <p className="text-muted-foreground">«Ruxsat berish» ni bosing — lokatsiya so‘raladi</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {workplace?.site?.kind === "branch" ? "Belgilangan filial" : "Asosiy ofis"} · ruxsat {allowedMeters} m
              </p>
              {displayShift ? (
                <p className="mt-1 rounded-lg dv-tone-amber border-0 px-2 py-1 text-[11px] font-medium">
                  {displayShift.label}: {displayShift.start}–{displayShift.end}. Kechikish — jarima.
                </p>
              ) : null}
              {site.label ? (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{site.label}</p>
              ) : null}
              {gps ? (
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} · ±{gps.accuracy} m
                </p>
              ) : null}
            </div>
          </div>

          {workplace && workplace.employee.hasGps === false ? (
            <p className="dv-tone-amber mt-3 rounded-2xl border px-3 py-2 text-center text-sm">
              {workplace.gpsError ||
                "Filial lokatsiyasi kiritilmagan. Koordinator GPS kiritsin."}
            </p>
          ) : null}

          {gps && distance != null ? (
            <div
              className={cn(
                "mt-3 rounded-2xl border px-3 py-2.5 text-center text-sm font-medium",
                inside
                  ? "dv-tone-emerald"
                  : "dv-tone-rose",
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
                  <span className="mt-1 block text-sm font-semibold">
                    Yashil hududga kirmasangiz — kelmagan deb belgilanasiz
                  </span>
                  <span className="mt-0.5 block text-xs font-normal opacity-90">
                    Davomat faqat {workplace?.site?.kind === "branch" ? "filial" : "asosiy ofis"}dan{" "}
                    {allowedMeters} m ichida
                  </span>
                </>
              )}
            </div>
          ) : null}

          {showGuide && guideStep === "zone" ? (
            <div className="mt-3">
              <MobileStepHint
                step={1}
                label="Yashil hududga kiring — aks holda kelmagan"
                tone="rose"
              />
            </div>
          ) : null}

          {gpsError ? <p className="mt-2 text-sm text-rose-600">{gpsError}</p> : null}
          {locationReady ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-teal-700 dark:text-teal-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Joylashuv tasdiqlandi — keyingi qadam: Face ID
            </p>
          ) : null}
        </section>

        {showFaceStep ? (
          <section className="dv-card mt-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                2
              </span>
              <h2 className="text-sm font-semibold text-foreground">Face ID</h2>
            </div>
            {verified ? (
              <div className="space-y-3">
                <div className="dv-tone-emerald flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Yuz tasdiqlandi</p>
                    <p className="text-xs opacity-80">{verified.fullName}</p>
                    <p className="mt-0.5 text-[11px] opacity-70">
                      Tizim shu xodim profiliga o‘tdi
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full gap-2 rounded-2xl"
                  onClick={() => {
                    const role = user?.role;
                    setLocation(role === "stajyor" ? "/kirish" : "/dashboard");
                  }}
                >
                  <LogIn className="h-4 w-4" />
                  {verified.fullName} profiliga o‘tish
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {showGuide && guideStep === "face" ? (
                  <MobileStepHint step={2} label="Face ID ni bosing" tone="amber" />
                ) : null}
                {guideStep === "zone" || (gps && !inside) ? (
                  <p className="dv-tone-rose rounded-2xl border px-3 py-2.5 text-center text-sm font-semibold">
                    2-qadam yopiq: avval yashil hududga kiring. Aks holda kelmagan deb belgilanasiz.
                  </p>
                ) : null}
                <Button
                  type="button"
                  size="lg"
                  className={cn(
                    "h-14 w-full gap-2 rounded-2xl text-base",
                    showGuide && guideStep === "face" && "dv-focus",
                  )}
                  disabled={!canOpenFace}
                  onClick={() => setScanOpen(true)}
                >
                  {canOpenFace ? <ScanFace className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                  {canOpenFace ? "Face ID" : "Face ID yopiq"}
                </Button>
                {!canOpenFace && faceLockedReason ? (
                  <p className="dv-tone-rose rounded-2xl border px-3 py-2 text-center text-sm">
                    {faceLockedReason}
                  </p>
                ) : (
                  <p className="text-center text-xs text-muted-foreground">
                    3-qadam: yuz tasdiqlangach «Keldim» ni bosing
                  </p>
                )}
              </div>
            )}
          </section>
        ) : null}

        {showPunchStep ? (
          <section className="dv-card mt-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                {hasIn ? 4 : 3}
              </span>
              <h2 className="text-sm font-semibold text-foreground">
                {hasIn ? "Ketdim" : "Keldim"}
              </h2>
            </div>
            {hasIn ? (
              <div className="space-y-3">
                {showGuide && guideStep === "ketdim" ? (
                  <MobileStepHint step={4} label="Ketdim ni bosing" tone="rose" />
                ) : null}
                <Button
                  type="button"
                  size="lg"
                  className={cn(
                    "dv-btn-out",
                    showGuide && guideStep === "ketdim" && "dv-focus",
                  )}
                  disabled={busy || !canPunchOut}
                  onClick={() => setConfirmOut(true)}
                >
                  <LogOut className="h-5 w-5" />
                  Ketdim
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Bosilganda ketishni tasdiqlash so‘raladi. 18:00 dan oldin ham chiqish mumkin.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {showGuide && guideStep === "keldim" ? (
                  <MobileStepHint step={3} label="Keldim ni bosing" tone="emerald" />
                ) : null}
                <Button
                  type="button"
                  size="lg"
                  className={cn(
                    "dv-btn-in",
                    showGuide && guideStep === "keldim" && "dv-focus",
                  )}
                  disabled={busy}
                  onClick={() => void punch("in")}
                >
                  <LogIn className="h-5 w-5" />
                  Keldim
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Keldim dan keyin «Ketdim» ochiladi — tasdiqlab chiqishingiz mumkin
                </p>
              </div>
            )}
          </section>
        ) : null}

        {working ? (
          <section className="dv-tone-emerald mt-4 rounded-[24px] border px-4 py-4 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wide opacity-80">Ishlayotgan vaqt</p>
            <p className="mt-1 font-mono text-4xl font-semibold tabular-nums">{elapsedLabel}</p>
            <p className="mt-1 text-xs opacity-80">Keldim: {verified?.checkIn || workplace?.today.checkIn}</p>
          </section>
        ) : null}

        <section className="mt-4 overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Bugungi davomatim</h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                {dateLabel}
              </p>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                done
                  ? "bg-muted text-muted-foreground"
                  : hasIn
                    ? "dv-tone-emerald border-0 px-2.5 py-1"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {holatLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            <div className="dv-punch-card-in">
              <div className="dv-punch-card-label flex items-center gap-1.5 text-xs font-medium">
                <LogIn className="h-3.5 w-3.5" />
                Keldim{displayShift ? ` ${punchPlanLabel("in", displayShift.start)}` : ""}
              </div>
              <div className="dv-punch-card-value mt-1 font-mono text-2xl font-semibold tabular-nums">
                {checkInLabel}
              </div>
            </div>
            <div className="dv-punch-card-out">
              <div className="dv-punch-card-label flex items-center gap-1.5 text-xs font-medium">
                <LogOut className="h-3.5 w-3.5" />
                Ketdim{displayShift ? ` ${punchPlanLabel("out", displayShift.end)}` : ""}
              </div>
              <div className="dv-punch-card-value mt-1 font-mono text-2xl font-semibold tabular-nums">
                {checkOutLabel}
              </div>
            </div>
          </div>
          {displayShift ? (
            <p className="px-4 pb-3 text-center text-[11px] font-medium leading-snug text-red-600">
              {PUNCH_FINE_HINT}
            </p>
          ) : null}
          {done && closedWork != null ? (
            <div className="mx-4 mb-4 rounded-2xl border border-border bg-muted px-3 py-3 text-center">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ishlangan vaqt</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {formatHoursUz(closedWork)}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Kuniga faqat 1 marta Keldim va 1 marta Ketdim
              </p>
            </div>
          ) : done ? (
            <p className="px-4 pb-3 text-center text-xs text-muted-foreground">
              Kuniga faqat 1 marta Keldim va 1 marta Ketdim
            </p>
          ) : null}
        </section>

        <section className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm md:rounded-lg">
          <div className="flex flex-col gap-2 border-b border-border bg-muted/50 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                <History className="h-3.5 w-3.5 shrink-0" />
                {isTgMiniApp ? "Davomat holati" : "Tarix"}
              </h2>
              <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground sm:text-[11px]">
                {historyRange === "day"
                  ? "Bugungi kun"
                  : historyRange === "week"
                    ? "So‘nggi 7 kun"
                    : "So‘nggi 31 kun"}
                {" · "}
                {historySummary.count} qator
                {historySummary.minutes > 0
                  ? ` · jami ${formatHoursUz(historySummary.minutes)}`
                  : ""}
              </p>
            </div>
            <div
              className="grid grid-cols-3 gap-0.5 rounded-md border border-border bg-card p-0.5 sm:inline-flex sm:w-auto"
              role="tablist"
              aria-label="Davomat oralig‘i"
            >
              {(
                [
                  { id: "day" as const, label: "Kunlik" },
                  { id: "week" as const, label: "Haftalik" },
                  { id: "month" as const, label: "Oylik" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={historyRange === opt.id}
                  onClick={() => setHistoryRange(opt.id)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] font-semibold transition-colors sm:px-2.5 sm:text-xs",
                    historyRange === opt.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {historyDays.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-muted-foreground sm:text-sm">
              Hali yozuv yo‘q. Face ID bilan belgilang — tarix shu yerda chiqadi.
            </p>
          ) : filteredHistoryDays.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-muted-foreground sm:text-sm">
              Tanlangan oralikda yozuv yo‘q.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 border-b border-border px-2.5 py-1.5 text-[10px] sm:px-3 sm:text-[11px]">
                <span className="dv-tone-emerald rounded border-0 px-1.5 py-0.5 font-medium">
                  Kelgan {historySummary.present}
                </span>
                <span className="dv-tone-amber rounded border-0 px-1.5 py-0.5 font-medium">
                  Kech {historySummary.late}
                </span>
                <span className="dv-tone-rose rounded border-0 px-1.5 py-0.5 font-medium">
                  Kelmagan {historySummary.absent}
                </span>
              </div>

              {/* Mobile: compact sheet rows */}
              <div
                className={cn(
                  "md:hidden overflow-y-auto overscroll-contain",
                  historyRange === "day" ? "max-h-[220px]" : "max-h-[280px]",
                )}
              >
                <table className="w-full border-collapse text-[11px]">
                  <thead className="sticky top-0 z-10 bg-muted shadow-[inset_0_-1px_0_hsl(var(--border))] dark:bg-slate-800">
                    <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="border-r border-border px-2 py-1.5">Sana</th>
                      <th className="border-r border-border px-1.5 py-1.5 text-center">Kel</th>
                      <th className="border-r border-border px-1.5 py-1.5 text-center">Ket</th>
                      <th className="border-r border-border px-1.5 py-1.5 text-center">Holat</th>
                      <th className="px-1.5 py-1.5 text-right">Vaqt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistoryDays.map((d, i) => {
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
                            "border-b border-border",
                            isToday
                              ? "dv-history-today"
                              : i % 2 === 1
                                ? "bg-muted/70"
                                : "bg-card",
                          )}
                        >
                          <td className="border-r border-border px-2 py-1.5">
                            <div className="leading-tight">
                              <span className="font-semibold text-foreground">{dayParts.date}</span>
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                {dayParts.weekday.slice(0, 2)}
                              </span>
                              {isToday ? (
                                <span className="ml-1 text-[9px] font-semibold text-teal-700 dark:text-teal-300">
                                  bugun
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="border-r border-border px-1.5 py-1.5 text-center font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                            {d.checkIn}
                          </td>
                          <td className="border-r border-border px-1.5 py-1.5 text-center font-mono tabular-nums text-rose-700 dark:text-rose-400">
                            {d.checkOut}
                          </td>
                          <td className="border-r border-border px-1.5 py-1.5 text-center">
                            <span
                              className={cn(
                                "inline-flex whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-semibold",
                                STATUS_STYLE[d.status] || "bg-slate-100 text-muted-foreground",
                              )}
                            >
                              {STATUS_UZ[d.status] || d.status}
                            </span>
                          </td>
                          <td className="px-1.5 py-1.5 text-right font-medium tabular-nums text-foreground">
                            {worked != null ? formatHoursUz(worked) : d.workedHours || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Desktop: wide spreadsheet */}
              <div
                className={cn(
                  "hidden md:block overflow-auto overscroll-contain",
                  historyRange === "day" ? "max-h-[260px]" : "max-h-[340px]",
                )}
              >
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-muted shadow-[inset_0_-1px_0_hsl(var(--border))] dark:bg-slate-800">
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="sticky left-0 z-[1] border-r border-border bg-muted px-3 py-2 dark:bg-slate-800">
                        Sana
                      </th>
                      <th className="border-r border-border px-3 py-2">Hafta kuni</th>
                      <th className="border-r border-border px-3 py-2 text-center">Keldim</th>
                      <th className="border-r border-border px-3 py-2 text-center">Ketdim</th>
                      <th className="border-r border-border px-3 py-2 text-center">Holat</th>
                      <th className="px-3 py-2 text-right">Ishlangan vaqt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistoryDays.map((d, i) => {
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
                            "border-b border-border hover:bg-muted/50",
                            isToday
                              ? "dv-history-today"
                              : i % 2 === 1
                                ? "bg-muted/80"
                                : "bg-card",
                          )}
                        >
                          <td
                            className={cn(
                              "sticky left-0 z-[1] border-r border-border px-3 py-1.5 font-semibold tabular-nums text-foreground",
                              isToday ? "dv-history-today-cell" : i % 2 === 1 ? "bg-muted/80" : "bg-card",
                            )}
                          >
                            {dayParts.date}
                            {isToday ? (
                              <span className="ml-2 rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:text-teal-300">
                                bugun
                              </span>
                            ) : null}
                          </td>
                          <td className="border-r border-border px-3 py-1.5 capitalize text-muted-foreground">
                            {dayParts.weekday}
                          </td>
                          <td className="border-r border-border px-3 py-1.5 text-center font-mono text-[13px] tabular-nums text-emerald-700 dark:text-emerald-400">
                            {d.checkIn}
                          </td>
                          <td className="border-r border-border px-3 py-1.5 text-center font-mono text-[13px] tabular-nums text-rose-700 dark:text-rose-400">
                            {d.checkOut}
                          </td>
                          <td className="border-r border-border px-3 py-1.5 text-center">
                            <span
                              className={cn(
                                "inline-flex whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold",
                                STATUS_STYLE[d.status] || "bg-slate-100 text-muted-foreground",
                              )}
                            >
                              {STATUS_UZ[d.status] || d.status}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium tabular-nums text-foreground">
                            {worked != null ? formatHoursUz(worked) : d.workedHours || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {isAuthenticated && oylikMe.data ? (
          <Link href="/oylik">
            <div className="mt-3 rounded-xl border border-border bg-card p-3 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Banknote className="h-4 w-4" />
                Mening oyligim · {oylikMe.data.monthLabel}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Faqat o‘zingizning KPI. Batafsil — Oylik.</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <p>Fiks maosh: <span className="font-semibold">{formatSom(oylikMe.data.fixedSalary)}</span></p>
                <p>KPI: <span className="font-semibold">{oylikMe.data.kpiPercent}%</span></p>
                <p>Bonus: <span className="font-semibold">{formatSom(oylikMe.data.bonusAmount)}</span></p>
                <p>Jami: <span className="font-bold text-primary">{formatSom(oylikMe.data.totalAmount)}</span></p>
              </div>
            </div>
          </Link>
        ) : null}

        <div className="mt-5 flex justify-center gap-4 text-sm">
          {!isTgMiniApp ? (
            <Link href="/login" className="text-primary underline-offset-2 hover:underline">
              Login
            </Link>
          ) : null}
          {isAuthenticated && canReport ? (
            <Link href="/davomat" className="text-primary underline-offset-2 hover:underline">
              Hisobot
            </Link>
          ) : null}
        </div>
      </div>

      <FaceScanDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        mode="enroll"
        title="Davomat · Yuzni ulash"
        description="Kameraga to‘g‘ri qarang — bir marta ro‘yxatdan o‘ting"
        onCaptured={onEnrollCaptured}
      />

      <FaceScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        mode="login"
        title="Davomat · Face ID"
        description="Lokatsiya tasdiqlangan. Yuzni oval ichiga tuting."
        onCaptured={onCaptured}
      />

      <AlertDialog open={confirmOut} onOpenChange={setConfirmOut}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ketishni tasdiqlaysizmi?</AlertDialogTitle>
            <AlertDialogDescription>
              {afterSix
                ? `${elapsedLabel} ishladingiz. Ha desangiz, bugungi ketish vaqti yoziladi.`
                : `Hozir 18:00 dan oldin. ${elapsedLabel} ishladingiz. Ha desangiz, erta ketish sifatida yoziladi.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Yo‘q</AlertDialogCancel>
            <AlertDialogAction className="dv-btn-out h-10 px-4" onClick={() => void punch("out")}>
              Ha
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
