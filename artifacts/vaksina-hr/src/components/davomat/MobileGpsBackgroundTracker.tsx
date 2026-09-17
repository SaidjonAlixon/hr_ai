import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ensureMobileTrack, trackMobilePoint } from "@/lib/mobile-attendance-api";

export const MOBILE_GPS_GRANTED_EVENT = "vaksina-mobile-gps-granted";

/**
 * Admin ko‘chma ruxsat bergan xodimda — asosiy ilovada yashirin GPS kuzatuv.
 * Davomat (/davomat-face) lokatsiya ruxsatidan keyin avtomatik boshlanadi.
 * Lokatsiya o‘chsa / GPS yo‘qolsa nuqtalar to‘xtaydi → live da offline.
 */
export function MobileGpsBackgroundTracker() {
  const { isAuthenticated, user } = useAuth();
  const sessionRef = useRef<number | null>(null);
  const lastSent = useRef(0);
  const lastLat = useRef<number | null>(null);
  const lastLng = useRef<number | null>(null);
  const restartRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      sessionRef.current = null;
      return;
    }
    if (!navigator.geolocation) return;

    let cancelled = false;
    let watchId: number | null = null;
    let intervalId: number | null = null;
    let bootToken = 0;

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

    const clearWatchers = () => {
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const send = async (lat: number, lng: number, accuracy?: number) => {
      if (cancelled || !sessionRef.current) return;
      const now = Date.now();
      const moved =
        lastLat.current == null ||
        lastLng.current == null ||
        distM(lastLat.current, lastLng.current, lat, lng) >= 5;
      if (!moved && now - lastSent.current < 15_000) return;
      lastLat.current = lat;
      lastLng.current = lng;
      lastSent.current = now;
      try {
        await trackMobilePoint({
          sessionId: sessionRef.current,
          latitude: lat,
          longitude: lng,
          accuracy,
        });
      } catch {
        /* ignore */
      }
    };

    const startWatchers = () => {
      clearWatchers();
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          void send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        },
        () => {
          /* GPS yo‘qolsa — nuqta yuborilmaydi → offline */
        },
        { enableHighAccuracy: true, maximumAge: 8_000, timeout: 15_000 },
      );

      intervalId = window.setInterval(() => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            void send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
          },
          () => undefined,
          { enableHighAccuracy: true, maximumAge: 10_000, timeout: 12_000 },
        );
      }, 20_000);
    };

    const boot = async (forced?: { latitude: number; longitude: number; accuracy?: number }) => {
      const token = ++bootToken;
      try {
        let lat = forced?.latitude;
        let lng = forced?.longitude;
        let accuracy = forced?.accuracy;
        if (lat == null || lng == null) {
          try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                maximumAge: 30_000,
                timeout: 12_000,
              });
            });
            if (cancelled || token !== bootToken) return;
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
            accuracy = pos.coords.accuracy;
          } catch {
            sessionRef.current = null;
            return;
          }
        }
        if (cancelled || token !== bootToken || lat == null || lng == null) return;

        const r = await ensureMobileTrack({ latitude: lat, longitude: lng, accuracy });
        if (cancelled || token !== bootToken) return;
        if (!r.allowed || !r.sessionId) {
          sessionRef.current = null;
          return;
        }
        sessionRef.current = r.sessionId;
        void send(lat, lng, accuracy);
        startWatchers();
      } catch {
        if (token === bootToken) sessionRef.current = null;
      }
    };

    restartRef.current = () => {
      void boot();
    };

    void boot();

    const onGranted = (ev: Event) => {
      const detail = (ev as CustomEvent<{ latitude?: number; longitude?: number; accuracy?: number }>)
        .detail;
      if (
        detail &&
        typeof detail.latitude === "number" &&
        typeof detail.longitude === "number" &&
        Number.isFinite(detail.latitude) &&
        Number.isFinite(detail.longitude)
      ) {
        void boot({
          latitude: detail.latitude,
          longitude: detail.longitude,
          accuracy: detail.accuracy,
        });
      } else {
        void boot();
      }
    };

    const onVis = () => {
      if (document.visibilityState === "visible") {
        if (sessionRef.current) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              void send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
            },
            () => undefined,
            { enableHighAccuracy: true, maximumAge: 5_000, timeout: 10_000 },
          );
        } else {
          void boot();
        }
      }
    };

    window.addEventListener(MOBILE_GPS_GRANTED_EVENT, onGranted);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      restartRef.current = null;
      window.removeEventListener(MOBILE_GPS_GRANTED_EVENT, onGranted);
      document.removeEventListener("visibilitychange", onVis);
      clearWatchers();
    };
  }, [isAuthenticated, user?.id]);

  return null;
}
