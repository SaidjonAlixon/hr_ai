import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { MobileRouteMap, type RoutePoint } from "@/components/davomat/MobileRouteMap";
import {
  endMobileAttendance,
  fetchMyMobileAttendance,
  fetchMobileSessionDetail,
  getCurrentPosition,
  startMobileAttendance,
  trackMobilePoint,
} from "@/lib/mobile-attendance-api";
import { Loader2, MapPin, Navigation, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

export default function DavomatKochmaPage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [gpsLabel, setGpsLabel] = useState("Aniqlanmoqda…");
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [me, setMe] = useState<Awaited<ReturnType<typeof fetchMyMobileAttendance>> | null>(null);
  const [mapPoints, setMapPoints] = useState<RoutePoint[]>([]);
  const trackTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const data = await fetchMyMobileAttendance();
      setMe(data);
      if (data.openSession) {
        try {
          const d = await fetchMobileSessionDetail(data.openSession.id);
          const pts: RoutePoint[] = [
            {
              lat: d.session.startLatitude,
              lng: d.session.startLongitude,
              kind: "start",
              time: d.session.startTime,
              accuracy: d.session.startAccuracy,
            },
          ];
          for (const p of d.points) {
            if (p.pointType === "start" || p.pointType === "end") continue;
            pts.push({
              lat: p.latitude,
              lng: p.longitude,
              kind: "track",
              time: p.recordedAt,
              accuracy: p.accuracy,
            });
          }
          if (d.session.endLatitude != null && d.session.endLongitude != null) {
            pts.push({
              lat: d.session.endLatitude,
              lng: d.session.endLongitude,
              kind: "end",
              time: d.session.endTime,
              accuracy: d.session.endAccuracy,
            });
          }
          setMapPoints(pts);
        } catch {
          setMapPoints([
            {
              lat: data.openSession.startLatitude,
              lng: data.openSession.startLongitude,
              kind: "start",
              time: data.openSession.startTime,
              accuracy: data.openSession.startAccuracy,
            },
          ]);
        }
      } else {
        setMapPoints([]);
      }
    } catch (e) {
      toast({ title: "Xato", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, toast]);

  const refreshGps = useCallback(async () => {
    try {
      setGpsLabel("Aniqlanmoqda…");
      const pos = await getCurrentPosition();
      setGps({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy || 0,
      });
      setGpsLabel(
        `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)} (±${Math.round(pos.coords.accuracy || 0)} m)`,
      );
    } catch {
      setGps(null);
      setGpsLabel("Lokatsiyani aniqlab bo‘lmadi — ruxsat bering");
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshGps();
  }, [refresh, refreshGps]);

  // Yo‘nalish: har ~15s yoki 5m siljishda GPS (qisqa masofa ham)
  useEffect(() => {
    if (trackTimer.current) {
      window.clearInterval(trackTimer.current);
      trackTimer.current = null;
    }
    const open = me?.openSession;
    if (!open?.routeTrackingEnabled || !open.id) return;
    if (!navigator.geolocation) return;

    let lastLat: number | null = null;
    let lastLng: number | null = null;
    let lastSent = 0;
    const MIN_METERS = 5;
    const MIN_MS = 15_000;

    const toRad = (d: number) => (d * Math.PI) / 180;
    const distM = (aLat: number, aLng: number, bLat: number, bLng: number) => {
      const R = 6371000;
      const dLat = toRad(bLat - aLat);
      const dLon = toRad(bLng - aLng);
      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(x));
    };

    const send = async (lat: number, lng: number, accuracy?: number) => {
      const now = Date.now();
      const moved =
        lastLat == null || lastLng == null || distM(lastLat, lastLng, lat, lng) >= MIN_METERS;
      const timedOut = now - lastSent >= MIN_MS;
      if (!moved && !timedOut) return;
      lastLat = lat;
      lastLng = lng;
      lastSent = now;
      try {
        await trackMobilePoint({
          sessionId: open.id,
          latitude: lat,
          longitude: lng,
          accuracy,
        });
        setMapPoints((prev) => [
          ...prev,
          {
            lat,
            lng,
            kind: "track",
            time: new Date().toISOString(),
            accuracy: accuracy ?? null,
          },
        ]);
      } catch {
        /* ignore */
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        void send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      () => {
        /* ignore */
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 12_000 },
    );

    // zaxira interval
    trackTimer.current = window.setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        },
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 10_000 },
      );
    }, MIN_MS);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (trackTimer.current) {
        window.clearInterval(trackTimer.current);
        trackTimer.current = null;
      }
    };
  }, [me?.openSession?.id, me?.openSession?.routeTrackingEnabled]);

  const onStart = async () => {
    setBusy(true);
    try {
      const pos = gps ? null : await getCurrentPosition();
      const lat = gps?.lat ?? pos!.coords.latitude;
      const lng = gps?.lng ?? pos!.coords.longitude;
      const accuracy = gps?.accuracy ?? pos!.coords.accuracy;
      const r = await startMobileAttendance({
        latitude: lat,
        longitude: lng,
        accuracy,
        locationTimestamp: Date.now(),
      });
      toast({ title: "Boshlandi", description: r.message });
      await refresh();
    } catch (e) {
      const err = e as Error & { code?: string };
      toast({
        title: err.code === "GPS_ACCURACY_LOW" ? "Aniqlik past" : "Boshlanmadi",
        description: err.message,
        variant: "destructive",
      });
      void refreshGps();
    } finally {
      setBusy(false);
    }
  };

  const onEnd = async () => {
    if (!window.confirm("Davomatni yakunlaysizmi?")) return;
    setBusy(true);
    try {
      const pos = await getCurrentPosition();
      const r = await endMobileAttendance({
        sessionId: me?.openSession?.id,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        locationTimestamp: Date.now(),
      });
      toast({ title: "Yakunlandi", description: `${r.message} · ${r.durationMin} daq` });
      setMapPoints([
        {
          lat: r.startLatitude,
          lng: r.startLongitude,
          kind: "start",
          time: r.startTime,
        },
        {
          lat: r.endLatitude,
          lng: r.endLongitude,
          kind: "end",
          time: r.endTime,
        },
      ]);
      await refresh();
    } catch (e) {
      toast({ title: "Yakunlanmadi", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="p-6 text-sm">
        Avval <Link href="/login" className="text-sky-400 underline">kirish</Link> qiling.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!me?.allowed) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <MapPin className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Ko‘chma davomat</h1>
            <p className="text-sm text-muted-foreground">
              Sizga ruxsat berilmagan. Admindan so‘rang.
            </p>
            <Button asChild variant="outline">
              <Link href="/dashboard">Orqaga</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const open = me.openSession;

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-28">
      <div>
        <h1 className="text-xl font-bold">📍 Ko‘chma davomat</h1>
        <p className="text-sm text-muted-foreground">
          {me.employee?.fullName} · {me.employee?.position || user?.role}
        </p>
      </div>

      <Card className="border-sky-500/20 bg-sky-500/5">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-2 text-sm">
            <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
            <div>
              <p className="font-medium">Lokatsiya</p>
              <p className="text-muted-foreground">{gpsLabel}</p>
              <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void refreshGps()}>
                Qayta aniqlash
              </Button>
            </div>
          </div>
          {me.privacyNote ? (
            <p className="rounded-lg bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
              {me.privacyNote}
            </p>
          ) : null}
          {open?.routeTrackingEnabled ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Lokatsiya qayd qilinmoqda (sahifa ochiq bo‘lsin)
            </p>
          ) : null}

          {!open ? (
            <Button className="w-full" size="lg" disabled={busy || !gps} onClick={() => void onStart()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Davomatni boshlash
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
                🟢 Ish jarayonida
                <div className="mt-1 font-mono text-xs opacity-80">
                  Boshlangan: {open.startTime ? new Date(open.startTime).toLocaleTimeString("uz-UZ") : "—"}
                </div>
              </div>
              <Button
                className="w-full"
                size="lg"
                variant="destructive"
                disabled={busy}
                onClick={() => void onEnd()}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Davomatni yakunlash
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {mapPoints.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Xarita</h2>
          <MobileRouteMap points={mapPoints} height={280} />
        </div>
      ) : null}
    </div>
  );
}
