import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { MapPin, Navigation, ScanFace, Loader2, CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  fetchDavomatSite,
  fetchMyWorkplace,
  haversineMeters,
  type DavomatSite,
  type WorkplaceInfo,
} from "@/lib/davomat-api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

type Gps = { lat: number; lng: number; accuracy: number };

export default function DavomatFacePage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [site, setSite] = useState<DavomatSite>({
    allowedMeters: DAVOMAT_GEOFENCE_METERS,
    label: DAVOMAT_SITE_LABEL,
    latitude: DAVOMAT_SITE_LAT,
    longitude: DAVOMAT_SITE_LNG,
  });
  const [workplace, setWorkplace] = useState<WorkplaceInfo | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const watchRef = useRef<number | null>(null);

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

  useEffect(() => {
    void fetchDavomatSite().then(setSite);
  }, []);

  useEffect(() => {
    void loadWorkplace();
  }, [loadWorkplace]);

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

  const faceLockedReason = useMemo(() => {
    if (gpsError) return gpsError;
    if (!gps) return "GPS kutilmoqda…";
    if (!isFaceIdSupported()) return "Face ID bu brauzerda ishlamaydi (HTTPS/localhost kerak)";
    if (remain != null && remain > 0) {
      return `Hududdan ${distance} m uzoqdasiz. Yana ${remain} m yaqinlashgach Face ID ochiladi. Hududdan tashqarida davomat qabul qilinmaydi.`;
    }
    return null;
  }, [gps, gpsError, remain, distance]);

  const onCaptured = async (descriptor: number[]) => {
    if (!gps) throw new Error("GPS yo‘q");
    if (!inside) {
      throw new Error(
        `Hududdan tashqarida (${distance} m). Yana ${remain} m yaqinlashing.`,
      );
    }
    try {
      const result = await facePunchDavomat({
        descriptor,
        latitude: gps.lat,
        longitude: gps.lng,
        accuracy: gps.accuracy,
      });
      const msg =
        result.message ||
        `${result.fullName}: ${result.action === "in" ? "kelish" : "ketish"} belgilandi`;
      setLastResult(msg);
      toast({ title: "Davomat", description: msg });
      await loadWorkplace();
    } catch (err) {
      if (err instanceof DavomatApiError && err.code === "outside_geofence") {
        const text =
          err.message ||
          `Uzoqdasiz: ${err.distanceMeters} m. Yana ${err.remainMeters} m yaqinlashing.`;
        toast({ title: "Hududdan tashqarida", description: text, variant: "destructive" });
        throw new Error(text);
      }
      throw err;
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 px-3 py-6 sm:px-0">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-[#0b3a5c]">Davomat · Face ID</h1>
        <p className="mt-1 text-sm text-slate-600">
          Faqat <strong>{site.label}</strong> atrofida{" "}
          <strong>{site.allowedMeters} m</strong> — tashqarida qabul qilinmaydi
        </p>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Navigation className="h-4 w-4 text-[#0b3a5c]" />
            Lokatsiya
          </CardTitle>
          <CardDescription>
            {user?.fullName
              ? `Kirgan: ${user.fullName}`
              : "Login shart emas — Face ID kimligingizni aniqlaydi"}
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
                  <span className="tabular-nums">{remain}</span> m yaqinlashgach Face ID ochiladi
                </>
              )}
            </div>
          ) : null}

          {workplace?.today ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border px-2 py-1.5">
                Kelish: <span className="font-semibold">{workplace.today.checkIn}</span>
              </div>
              <div className="rounded-lg border px-2 py-1.5">
                Ketish: <span className="font-semibold">{workplace.today.checkOut}</span>
              </div>
            </div>
          ) : null}

          {gpsError ? <p className="text-sm text-rose-600">{gpsError}</p> : null}
        </CardContent>
      </Card>

      <Button
        type="button"
        size="lg"
        className="w-full gap-2 bg-[#0b3a5c] hover:bg-[#0a314d] h-12"
        disabled={!canOpenFace}
        onClick={() => setScanOpen(true)}
      >
        {canOpenFace ? <ScanFace className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
        {canOpenFace ? "Face ID bilan belgilash" : "Face ID yopiq"}
      </Button>

      {!canOpenFace && faceLockedReason ? (
        <p className="text-center text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          {faceLockedReason}
        </p>
      ) : null}

      {lastResult ? (
        <p className="text-center text-sm text-emerald-700 font-medium">{lastResult}</p>
      ) : null}

      <div className="flex justify-center gap-4 text-sm">
        <Link href="/login" className="text-[#0b3a5c] underline-offset-2 hover:underline">
          Login
        </Link>
        {isAuthenticated ? (
          <Link href="/davomat" className="text-[#0b3a5c] underline-offset-2 hover:underline">
            Davomat hisobot
          </Link>
        ) : null}
      </div>

      <FaceScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        mode="login"
        onCaptured={onCaptured}
      />
    </div>
  );
}
