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
  Share2,
  Clock3,
  CalendarDays,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  type DavomatEmployee,
  type DavomatSite,
  type WorkplaceInfo,
} from "@/lib/davomat-api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { canViewDavomat } from "@/lib/roles";
import { roleLabel } from "@/lib/candidate-access";

const FACE_SNAP_KEY = "davomat-face-snap";

type Gps = { lat: number; lng: number; accuracy: number };
type Verified = {
  descriptor: number[];
  fullName: string;
  nextAction: "in" | "out" | "done";
  checkIn: string;
  checkOut: string;
  checkInAt: string | null;
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
  present: "bg-emerald-50 text-emerald-800 border-emerald-200",
  late: "bg-amber-50 text-amber-900 border-amber-200",
  incomplete: "bg-sky-50 text-sky-800 border-sky-200",
  absent: "bg-rose-50 text-rose-800 border-rose-200",
  leave: "bg-violet-50 text-violet-800 border-violet-200",
};

export default function DavomatFacePage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
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
  const [mine, setMine] = useState<DavomatEmployee | null>(null);
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

  const loadMine = useCallback(async () => {
    if (!isAuthenticated) {
      setMine(null);
      return;
    }
    try {
      const data = await fetchMyDavomat();
      setMine(data.employee);
    } catch {
      setMine(null);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void fetchDavomatSite().then(setSite);
  }, []);

  useEffect(() => {
    void loadWorkplace();
    void loadMine();
  }, [loadWorkplace, loadMine]);

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

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("Brauzer GPS ni qo‘llab-quvvatlamaydi");
      return;
    }
    watchRef.current = navigator.geolocation.watchPosition(
      applyGps,
      (err) => {
        setGpsError(
          err.code === 1
            ? "Lokatsiyaga ruxsat bering — aks holda davomat ishlamaydi"
            : "GPS olinmadi — ochiq joyda qayta urinib ko‘ring",
        );
      },
      { enableHighAccuracy: true, maximumAge: 3_000, timeout: 20_000 },
    );
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  const shareLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: "GPS yo‘q", description: "Brauzer lokatsiyani qo‘llab-quvvatlamaydi", variant: "destructive" });
      return;
    }
    setGpsSharing(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyGps(pos);
        setGpsSharing(false);
        toast({
          title: "Joylashuv ulashildi",
          description: `Aniqlik ±${Math.round(pos.coords.accuracy || 0)} m`,
        });
      },
      (err) => {
        setGpsSharing(false);
        const msg =
          err.code === 1
            ? "Brauzerda lokatsiyaga ruxsat bering"
            : "GPS olinmadi — ochiq joyda qayta urinib ko‘ring";
        setGpsError(msg);
        toast({ title: "Joylashuv olinmadi", description: msg, variant: "destructive" });
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

  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("uz-UZ", {
        timeZone: "Asia/Tashkent",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(nowTick),
    [nowTick],
  );

  const distance = useMemo(() => {
    if (!gps) return null;
    return haversineMeters(gps.lat, gps.lng, site.latitude, site.longitude);
  }, [gps, site.latitude, site.longitude]);

  const allowedMeters = site.allowedMeters || DAVOMAT_GEOFENCE_METERS;
  const remain = distance != null ? Math.max(0, distance - allowedMeters) : null;
  const inside = distance != null ? distance <= allowedMeters : false;

  const canOpenFace = Boolean(gps) && !gpsError && isFaceIdSupported() && inside;

  const nextAction = verified?.nextAction || workplace?.today.nextAction || "in";
  const done = nextAction === "done" || workplace?.today.complete;
  const hasIn = nextAction === "out" || done || Boolean(checkInAtIso);

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
    if (!gps) return "Avval joylashuvni ulashing";
    if (!isFaceIdSupported()) return "Face ID bu brauzerda ishlamaydi (HTTPS/localhost kerak)";
    if (remain != null && remain > 0) {
      return `Siz ${distance} m uzoqdasiz. Ruxsat 15 m. Yana ${remain} m yaqinlashishingiz kerak.`;
    }
    return null;
  }, [gps, gpsError, remain, distance]);

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
      throw new Error(`Hududdan tashqarida (${distance} m). Yana ${remain} m yaqinlashing.`);
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
        faceImage: snapshot,
      });
      if (result.employee) setMine(result.employee);
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
        const text = err.message || `Uzoqdasiz: ${err.distanceMeters} m`;
        toast({ title: "Hududdan tashqarida", description: text, variant: "destructive" });
        throw new Error(text);
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
      });
      if (result.employee) setMine(result.employee);
      toast({
        title: action === "in" ? "Keldim" : "Ketdi",
        description: result.message,
      });
      await loadWorkplace();
      await loadMine();
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
        });
        toast({ title: "Allaqachon belgilangan", description: err.message });
        await loadWorkplace();
        await loadMine();
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
  const position = mine?.position || roleLabel(user?.role) || "Xodim";
  const department = mine?.departmentName || user?.departmentName;
  const phone = user?.phone;
  const shownFace = verified?.faceImage || faceImage;
  const dayComplete = !verified && Boolean(workplace?.today.complete);

  const ringClass = inside
    ? "ring-4 ring-emerald-400/80"
    : gps
      ? "ring-4 ring-rose-400/80"
      : "ring-4 ring-white/40";

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
                  <span className="text-xs capitalize">{dateLabel}</span>
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

            <div className="relative mt-4 grid grid-cols-2 gap-2 text-[11px] text-sky-100/90">
              <div className="rounded-2xl bg-white/10 px-3 py-2">
                <div className="text-sky-200/70">Kelish</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-white">
                  {verified?.checkIn || workplace?.today.checkIn || "—"}
                </div>
              </div>
              <div className="rounded-2xl bg-white/10 px-3 py-2">
                <div className="text-sky-200/70">Ketish</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-white">
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0b3a5c]">
              <MapPin className="h-4 w-4" />
              Joylashuv
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 rounded-full border-[#0b3a5c]/20 text-[#0b3a5c]"
              disabled={gpsSharing}
              onClick={shareLocation}
            >
              {gpsSharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
              Joylashuv ulashish
            </Button>
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
                  <span className="text-lg font-semibold tabular-nums leading-none">{distance}</span>
                  <span className="text-[10px]">metr</span>
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
                <p className="text-slate-500">Joylashuv kutilmoqda…</p>
              )}
              <p className="mt-0.5 text-xs text-slate-500">Ruxsat faqat {allowedMeters} m</p>
              {gps ? (
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                  {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} · ±{gps.accuracy} m
                </p>
              ) : null}
            </div>
          </div>

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
                  Hududdasiz · {distance} m (ruxsat {allowedMeters} m)
                </>
              ) : (
                <>
                  <XCircle className="mr-1 inline h-4 w-4" />
                  Siz {distance} m uzoqdasiz · yana{" "}
                  <span className="tabular-nums font-semibold">{remain}</span> m yaqinlashishingiz kerak
                  <span className="mt-0.5 block text-xs font-normal text-rose-700">
                    Davomat faqat {allowedMeters} m ichida
                  </span>
                </>
              )}
            </div>
          ) : null}
          {gpsError ? <p className="mt-2 text-sm text-rose-600">{gpsError}</p> : null}
        </section>

        {working ? (
          <section className="mt-4 rounded-[24px] border border-emerald-200 bg-emerald-50/80 px-4 py-4 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Ishlayotgan vaqt</p>
            <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-emerald-950">{elapsedLabel}</p>
            <p className="mt-1 text-xs text-emerald-700">Kelish: {verified?.checkIn || workplace?.today.checkIn}</p>
          </section>
        ) : null}

        <section className="mt-4 space-y-3">
          {dayComplete ? (
            <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-5 text-center shadow-sm">
              <p className="font-medium text-slate-800">Bugungi davomat yopilgan</p>
              <p className="mt-1 text-sm text-slate-500">
                Kelish {workplace?.today.checkIn} · Ketish {workplace?.today.checkOut}
              </p>
              <p className="mt-2 text-xs text-slate-400">Kuniga faqat 1 marta Keldim va 1 marta Ketdim</p>
            </div>
          ) : !verified ? (
            <>
              <Button
                type="button"
                size="lg"
                className="h-14 w-full gap-2 rounded-2xl bg-[#0b3a5c] text-base hover:bg-[#0a314d]"
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
                  Yuz tasdiqlangach yashil Keldim va qizil Ketdim chiqadi
                </p>
              )}
            </>
          ) : done ? (
            <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-5 text-center shadow-sm">
              <p className="font-medium text-slate-800">Bugun yopilgan</p>
              <p className="mt-1 text-sm text-slate-500">
                Kelish {verified.checkIn} · Ketish {verified.checkOut}
              </p>
            </div>
          ) : hasIn ? (
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
              <Button
                type="button"
                size="lg"
                className="h-14 gap-2 rounded-2xl bg-emerald-600 text-base text-white hover:bg-emerald-700"
                disabled={busy}
                onClick={() => void punch("in")}
              >
                <LogIn className="h-5 w-5" />
                Keldim
              </Button>
              <Button type="button" size="lg" className="h-14 gap-2 rounded-2xl bg-red-600 text-base text-white" disabled>
                <LogOut className="h-5 w-5" />
                Ketdim
              </Button>
            </div>
          )}
        </section>

        {mine ? (
          <section className="mt-5 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-[#0b3a5c]">Mening davomatim</h2>
              <p className="text-xs text-slate-500">Faqat o‘zingizning yozuvlaringiz</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="bg-emerald-50 text-emerald-800">
                  Kelgan: {mine.totals.present}
                </Badge>
                <Badge variant="outline" className="bg-rose-50 text-rose-800">
                  Kelmagan: {mine.totals.absent}
                </Badge>
                <Badge variant="outline">Ishlangan: {mine.totals.workedHours}</Badge>
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto px-2 py-1 text-sm">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="px-2 py-2">Sana</th>
                    <th>Holat</th>
                    <th>Kelish</th>
                    <th>Ketish</th>
                    <th>Soat</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.days.map((d) => (
                    <tr key={d.date} className="border-t border-slate-50">
                      <td className="px-2 py-2 tabular-nums text-slate-700">{d.date.slice(5)}</td>
                      <td>
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2 py-0.5 text-[11px]",
                            STATUS_STYLE[d.status] || "bg-slate-50",
                          )}
                        >
                          {STATUS_UZ[d.status] || d.status}
                        </span>
                      </td>
                      <td className="tabular-nums">{d.checkIn}</td>
                      <td className="tabular-nums">{d.checkOut}</td>
                      <td className="tabular-nums">{d.workedHours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

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
