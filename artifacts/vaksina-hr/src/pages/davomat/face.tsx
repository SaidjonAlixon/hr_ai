import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { MapPin, Navigation, ScanFace, Loader2, CheckCircle2, Lock, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

type Gps = { lat: number; lng: number; accuracy: number };
type Verified = {
  descriptor: number[];
  fullName: string;
  nextAction: "in" | "out" | "done";
  checkIn: string;
  checkOut: string;
  checkInAt: string | null;
};

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STATUS_UZ: Record<string, string> = {
  present: "Kelgan",
  late: "Kech",
  incomplete: "Ketish yo‘q",
  absent: "Kelmagan",
  leave: "Ta’til",
};

export default function DavomatFacePage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const canReport = canViewDavomat(user?.role);
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
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
    if (!navigator.geolocation) {
      setGpsError("Brauzer GPS ni qo‘llab-quvvatlamaydi");
      return;
    }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 0),
        });
        setGpsError(null);
      },
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

  const checkInAtIso =
    verified?.checkInAt || workplace?.today.checkInAt || null;
  const working = Boolean(checkInAtIso) && !(verified?.nextAction === "done" || workplace?.today.complete);

  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [working]);

  const elapsedLabel = useMemo(() => {
    if (!checkInAtIso) return "0:00:00";
    return formatElapsed(nowTick - new Date(checkInAtIso).getTime());
  }, [checkInAtIso, nowTick]);

  const distance = useMemo(() => {
    if (!gps) return null;
    return haversineMeters(gps.lat, gps.lng, site.latitude, site.longitude);
  }, [gps, site.latitude, site.longitude]);

  const effectiveRadius =
    site.allowedMeters + Math.min(Math.max(0, gps?.accuracy ?? 0), 50);
  const remain =
    distance != null ? Math.max(0, distance - effectiveRadius) : null;
  const inside = distance != null ? distance <= effectiveRadius : false;

  const canOpenFace = Boolean(gps) && !gpsError && isFaceIdSupported() && inside;

  const nextAction =
    verified?.nextAction || workplace?.today.nextAction || "in";
  const done = nextAction === "done" || workplace?.today.complete;
  const hasIn = nextAction === "out" || done || Boolean(checkInAtIso);

  const faceLockedReason = useMemo(() => {
    if (gpsError) return gpsError;
    if (!gps) return "GPS kutilmoqda…";
    if (!isFaceIdSupported()) return "Face ID bu brauzerda ishlamaydi (HTTPS/localhost kerak)";
    if (remain != null && remain > 0) {
      return `Hududdan ${distance} m uzoqdasiz. Yana ${remain} m yaqinlashgach Face ID ochiladi.`;
    }
    return null;
  }, [gps, gpsError, remain, distance]);

  const geoPayload = () => {
    if (!gps) throw new Error("GPS yo‘q");
    return { latitude: gps.lat, longitude: gps.lng, accuracy: gps.accuracy };
  };

  const onCaptured = async (descriptor: number[]) => {
    if (!gps) throw new Error("GPS yo‘q");
    if (!inside) {
      throw new Error(`Hududdan tashqarida (${distance} m). Yana ${remain} m yaqinlashing.`);
    }
    try {
      const result = await faceVerifyDavomat({
        descriptor,
        ...geoPayload(),
      });
      setVerified({
        descriptor,
        fullName: result.fullName,
        nextAction: result.nextAction,
        checkIn: result.checkIn,
        checkOut: result.checkOut,
        checkInAt: result.checkInAt,
      });
      if (result.employee) setMine(result.employee);
      toast({
        title: result.fullName,
        description:
          result.nextAction === "done"
            ? "Bugun Keldim va Ketdim allaqachon belgilangan — qayta yozilmaydi"
            : result.nextAction === "out"
              ? "Bugun Keldim belgilangan — faqat Ketdim qolgan"
              : "Yuz tasdiqlandi — Keldim ni bosing (kuniga 1 marta)",
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
        toast({
          title: "Allaqachon belgilangan",
          description: err.message,
        });
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

  const displayName = verified?.fullName || workplace?.employee.fullName || user?.fullName;

  return (
    <div className="mx-auto max-w-lg space-y-4 px-3 py-6 sm:px-0">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-[#0b3a5c]">Davomat</h1>
        <p className="mt-1 text-sm text-slate-600">
          Kuniga faqat <strong>1 marta Keldim</strong> va <strong>1 marta Ketdim</strong>
        </p>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Navigation className="h-4 w-4 text-[#0b3a5c]" />
            Lokatsiya holati
          </CardTitle>
          <CardDescription>
            {displayName ? displayName : "Avval Face ID bilan yuzingizni tasdiqlang"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {gps ? (
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-slate-700">
              Siz: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
              <span className="ml-2 text-xs text-slate-500">±{gps.accuracy} m</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> GPS olinmoqda…
            </div>
          )}

          <div className="flex items-start gap-2 text-slate-700">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0b3a5c]" />
            <div>
              <div className="font-medium">Belgilangan nuqta</div>
              <div className="text-xs text-slate-500">{site.label}</div>
              <div className="text-xs text-slate-400 tabular-nums">
                {site.latitude.toFixed(6)}, {site.longitude.toFixed(6)}
              </div>
            </div>
          </div>

          {gps && distance != null ? (
            <div
              className={cn(
                "rounded-xl px-3 py-3 text-center font-medium",
                inside
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-amber-50 text-amber-950 border border-amber-200",
              )}
            >
              {inside ? (
                <>
                  <CheckCircle2 className="mr-1 inline h-4 w-4" />
                  Hududdasiz · {distance} m (ruxsat {effectiveRadius} m)
                </>
              ) : (
                <>
                  <Lock className="mr-1 inline h-4 w-4" />
                  {distance} m uzoqdasiz — yana{" "}
                  <span className="tabular-nums">{remain}</span> m yaqinlashgach ochiladi
                </>
              )}
            </div>
          ) : null}

          {gpsError ? <p className="text-sm text-rose-600">{gpsError}</p> : null}
        </CardContent>
      </Card>

      {!verified && workplace?.today.complete ? (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="pt-5 text-center text-sm">
            <p className="font-medium text-slate-800">{workplace.employee.fullName}</p>
            <p className="mt-2 rounded-2xl bg-slate-50 border px-4 py-3">
              Bugun yopilgan · Kelish {workplace.today.checkIn} · Ketish {workplace.today.checkOut}
            </p>
            <p className="mt-2 text-xs text-slate-500">Kuniga faqat 1 marta Keldim va 1 marta Ketdim</p>
          </CardContent>
        </Card>
      ) : !verified ? (
        <>
          <Button
            type="button"
            size="lg"
            className="w-full gap-2 bg-[#0b3a5c] hover:bg-[#0a314d] h-12"
            disabled={!canOpenFace}
            onClick={() => setScanOpen(true)}
          >
            {canOpenFace ? <ScanFace className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
            {canOpenFace ? "Face ID" : "Face ID yopiq"}
          </Button>
          {!canOpenFace && faceLockedReason ? (
            <p className="text-center text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              {faceLockedReason}
            </p>
          ) : null}
        </>
      ) : (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="space-y-4 pt-5">
            <p className="text-center text-sm font-medium text-slate-800">
              {verified.fullName}
            </p>
            {hasIn && !done ? (
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-4 text-center">
                <div className="text-xs uppercase tracking-wide text-emerald-700">Ishlayotgan vaqt</div>
                <div className="mt-1 text-3xl font-semibold tabular-nums text-emerald-900">
                  {elapsedLabel}
                </div>
                <div className="mt-1 text-xs text-emerald-700">Kelish: {verified.checkIn}</div>
              </div>
            ) : done ? (
              <div className="rounded-2xl bg-slate-50 border px-4 py-3 text-center text-sm">
                Bugun yopilgan · Kelish {verified.checkIn} · Ketish {verified.checkOut}
                <div className="mt-1 text-xs text-slate-500">Kuniga faqat 1 marta — qayta belgilab bo‘lmaydi</div>
              </div>
            ) : null}

            {!done ? (
              hasIn ? (
                <Button
                  type="button"
                  size="lg"
                  className="w-full h-14 gap-2 bg-red-600 hover:bg-red-700 text-white text-base"
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
                    className="h-14 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-base"
                    disabled={busy}
                    onClick={() => void punch("in")}
                  >
                    <LogIn className="h-5 w-5" />
                    Keldim
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    className="h-14 gap-2 bg-red-600 hover:bg-red-700 text-white text-base"
                    disabled
                  >
                    <LogOut className="h-5 w-5" />
                    Ketdim
                  </Button>
                </div>
              )
            ) : null}
          </CardContent>
        </Card>
      )}

      {mine ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Mening davomatim</CardTitle>
            <CardDescription>Faqat o‘zingizning kelish / ketish yozuvlaringiz</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Kelgan: {mine.totals.present}</Badge>
              <Badge variant="outline">Kelmagan: {mine.totals.absent}</Badge>
              <Badge variant="outline">Ishlangan: {mine.totals.workedHours}</Badge>
            </div>
            <div className="max-h-56 overflow-y-auto text-sm">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-slate-500">
                    <th className="py-1">Sana</th>
                    <th>Holat</th>
                    <th>Kelish</th>
                    <th>Ketish</th>
                    <th>Soat</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.days.map((d) => (
                    <tr key={d.date} className="border-t border-slate-100">
                      <td className="py-1.5 tabular-nums">{d.date.slice(5)}</td>
                      <td>{STATUS_UZ[d.status] || d.status}</td>
                      <td className="tabular-nums">{d.checkIn}</td>
                      <td className="tabular-nums">{d.checkOut}</td>
                      <td className="tabular-nums">{d.workedHours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex justify-center gap-4 text-sm">
        <Link href="/login" className="text-[#0b3a5c] underline-offset-2 hover:underline">
          Login
        </Link>
        {isAuthenticated && canReport ? (
          <Link href="/davomat" className="text-[#0b3a5c] underline-offset-2 hover:underline">
            Barcha xodimlar hisoboti
          </Link>
        ) : null}
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
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => void punch("out")}
            >
              Ha
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
