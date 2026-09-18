/**
 * GPS kuzatuv — React remount / tab yashirin bo‘lsa ham o‘chmasin.
 * Brauzer OS force-stop qilsa to‘xtaydi; ochiq qolsa qayta urinib turadi.
 */
import {
  ensureMobileTrack,
  trackMobilePoint,
  trackMobilePointKeepalive,
} from "@/lib/mobile-attendance-api";
import {
  queryGeolocationPermission,
  rememberGpsGranted,
  wasGpsGrantedBefore,
} from "@/lib/davomat-permissions";

export const MOBILE_GPS_GRANTED_EVENT = "vaksina-mobile-gps-granted";

const SESSION_KEY = "vaksina-live-gps-session";
const LAST_POS_KEY = "vaksina-live-gps-last";
const TRACK_FLAG = "vaksina-live-gps-want";
const FG_MS = 12_000;
const BG_MS = 20_000;
const RETRY_MS = 8_000;

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener?: (t: string, fn: () => void) => void;
};

type Pos = { latitude: number; longitude: number; accuracy?: number };

let started = false;
let cancelled = false;
let watchId: number | null = null;
let intervalId: number | null = null;
let retryId: number | null = null;
let bootToken = 0;
let sessionId: number | null = null;
let lastSent = 0;
let lastLat: number | null = null;
let lastLng: number | null = null;
let lastAcc: number | undefined;
let wake: WakeLockSentinelLike | null = null;
let permStatus: PermissionStatus | null = null;
let onPermChange: (() => void) | null = null;
let notifShown = false;

function wantTracking(): boolean {
  try {
    return localStorage.getItem(TRACK_FLAG) === "1" || wasGpsGrantedBefore();
  } catch {
    return wasGpsGrantedBefore();
  }
}

function setWantTracking(v: boolean) {
  try {
    if (v) localStorage.setItem(TRACK_FLAG, "1");
    else localStorage.removeItem(TRACK_FLAG);
  } catch {
    /* ignore */
  }
}

function loadSession(): number | null {
  try {
    const n = Number(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function saveSession(id: number | null) {
  sessionId = id;
  try {
    if (id != null) {
      localStorage.setItem(SESSION_KEY, String(id));
      sessionStorage.setItem(SESSION_KEY, String(id));
    } else {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

function saveLastPos(lat: number, lng: number, accuracy?: number) {
  lastLat = lat;
  lastLng = lng;
  lastAcc = accuracy;
  try {
    localStorage.setItem(
      LAST_POS_KEY,
      JSON.stringify({ lat, lng, accuracy, at: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

function loadLastPos(): Pos | null {
  try {
    const raw = localStorage.getItem(LAST_POS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { lat?: number; lng?: number; accuracy?: number };
    if (typeof j.lat === "number" && typeof j.lng === "number") {
      return { latitude: j.lat, longitude: j.lng, accuracy: j.accuracy };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function distM(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function releaseWake() {
  const w = wake;
  wake = null;
  if (!w) return;
  try {
    await w.release();
  } catch {
    /* ignore */
  }
}

async function requestWake() {
  if (cancelled || typeof navigator === "undefined") return;
  const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } })
    .wakeLock;
  if (!wl?.request) return;
  if (document.visibilityState !== "visible") return;
  try {
    await releaseWake();
    const sentinel = await wl.request("screen");
    if (cancelled) {
      await sentinel.release().catch(() => undefined);
      return;
    }
    wake = sentinel;
    sentinel.addEventListener?.("release", () => {
      if (wake === sentinel) wake = null;
      // Uyquga ketganda qayta so‘rash
      if (!cancelled && document.visibilityState === "visible") {
        window.setTimeout(() => void requestWake(), 1500);
      }
    });
  } catch {
    /* ignore */
  }
}

async function ensureStickyNotification() {
  if (notifShown || typeof Notification === "undefined") return;
  if (Notification.permission === "denied") return;
  try {
    if (Notification.permission !== "granted") {
      // Faqat avval GPS berilgan bo‘lsa so‘raymiz — spam qilmaslik
      if (!wasGpsGrantedBefore()) return;
      const p = await Notification.requestPermission();
      if (p !== "granted") return;
    }
    if (!("serviceWorker" in navigator)) {
      // Service worker yo‘q — oddiy notification (ba’zi brauzerlarda yopiladi)
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("VAKSINA · GPS kuzatuv", {
      body: "Lokatsiya orqa fonda ishlamoqda. Ilovani yopmang.",
      icon: "/faviconni.png",
      badge: "/faviconni.png",
      tag: "vaksina-gps-keepalive",
      silent: true,
      renotify: false,
      requireInteraction: true,
      data: { url: "/davomat-face" },
    } as NotificationOptions);
    notifShown = true;
  } catch {
    /* ignore */
  }
}

function clearWatchersOnly() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (intervalId != null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
}

function scheduleRetry() {
  if (cancelled || retryId != null) return;
  retryId = window.setTimeout(() => {
    retryId = null;
    if (!cancelled && wantTracking()) void boot();
  }, RETRY_MS);
}

function flushKeepalive() {
  if (sessionId && lastLat != null && lastLng != null) {
    trackMobilePointKeepalive({
      sessionId,
      latitude: lastLat,
      longitude: lastLng,
      accuracy: lastAcc,
    });
  }
}

async function send(lat: number, lng: number, accuracy?: number, force = false) {
  if (cancelled || !sessionId) return;
  const now = Date.now();
  const moved =
    lastLat == null || lastLng == null || distM(lastLat, lastLng, lat, lng) >= 4;
  const minGap = document.visibilityState === "hidden" ? 10_000 : 6_000;
  if (!force && !moved && now - lastSent < minGap) return;
  saveLastPos(lat, lng, accuracy);
  lastSent = now;
  try {
    await trackMobilePoint({
      sessionId,
      latitude: lat,
      longitude: lng,
      accuracy,
    });
  } catch {
    // Sessiya o‘lgan bo‘lishi mumkin — qayta boot
    scheduleRetry();
  }
}

function pollOnce() {
  if (cancelled || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      void send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    () => {
      scheduleRetry();
    },
    {
      enableHighAccuracy: true,
      maximumAge: document.visibilityState === "hidden" ? 45_000 : 5_000,
      timeout: document.visibilityState === "hidden" ? 25_000 : 15_000,
    },
  );
}

function startWatchers() {
  if (cancelled || !navigator.geolocation) return;
  // Mavjud watch’ni saqlab qolish — faqat yo‘q bo‘lsa yangilash
  if (watchId == null) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        rememberGpsGranted();
        setWantTracking(true);
        void send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      () => {
        scheduleRetry();
      },
      { enableHighAccuracy: true, maximumAge: 8_000, timeout: 25_000 },
    );
  }

  if (intervalId != null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
  const tickMs = document.visibilityState === "hidden" ? BG_MS : FG_MS;
  intervalId = window.setInterval(() => pollOnce(), tickMs);
  pollOnce();
  void requestWake();
  void ensureStickyNotification();
}

async function boot(forced?: Pos) {
  if (cancelled || !navigator.geolocation) return;
  const token = ++bootToken;
  try {
    let lat = forced?.latitude;
    let lng = forced?.longitude;
    let accuracy = forced?.accuracy;

    if (lat == null || lng == null) {
      const cached = loadLastPos();
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 90_000,
            timeout: 18_000,
          });
        });
        if (cancelled || token !== bootToken) return;
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        accuracy = pos.coords.accuracy;
        rememberGpsGranted();
        setWantTracking(true);
      } catch {
        if (cached) {
          lat = cached.latitude;
          lng = cached.longitude;
          accuracy = cached.accuracy;
        } else {
          scheduleRetry();
          return;
        }
      }
    }

    if (cancelled || token !== bootToken || lat == null || lng == null) return;

    const r = await ensureMobileTrack({ latitude: lat, longitude: lng, accuracy });
    if (cancelled || token !== bootToken) return;
    if (!r.allowed || !r.sessionId) {
      // Hali ruxsat yo‘q — lekin keyinroq qayta urinadi
      scheduleRetry();
      return;
    }
    saveSession(r.sessionId);
    void send(lat, lng, accuracy, true);
    startWatchers();
  } catch {
    scheduleRetry();
  }
}

function onGranted(ev: Event) {
  const detail = (ev as CustomEvent<Pos>).detail;
  rememberGpsGranted();
  setWantTracking(true);
  if (
    detail &&
    typeof detail.latitude === "number" &&
    typeof detail.longitude === "number" &&
    Number.isFinite(detail.latitude) &&
    Number.isFinite(detail.longitude)
  ) {
    void boot(detail);
  } else {
    void boot();
  }
}

function onVis() {
  if (document.visibilityState === "visible") {
    void requestWake();
    if (sessionId) {
      startWatchers();
      pollOnce();
    } else if (wantTracking()) {
      void boot();
    }
  } else {
    // Orqa fon: watch’ni O‘CHIRMAYMIZ — faqat keepalive + interval
    void releaseWake();
    flushKeepalive();
    if (sessionId) {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      intervalId = window.setInterval(() => pollOnce(), BG_MS);
      pollOnce();
    } else if (wantTracking()) {
      scheduleRetry();
    }
  }
}

function onFocusOrOnline() {
  if (cancelled) return;
  if (sessionId) {
    pollOnce();
    void requestWake();
    startWatchers();
  } else if (wantTracking()) {
    void boot();
  }
}

function onPageHide(ev: PageTransitionEvent | Event) {
  flushKeepalive();
  // bfcache — tracker’ni o‘chirmaymiz
  const persisted = "persisted" in ev && Boolean((ev as PageTransitionEvent).persisted);
  if (persisted) return;
}

function onPageShow() {
  onFocusOrOnline();
}

/** Ilova ichida bir marta ishga tushirish (remount’da qayta yaratilmaydi) */
export function startMobileGpsKeepalive() {
  if (typeof window === "undefined" || !navigator.geolocation) return;
  cancelled = false;
  sessionId = loadSession();

  if (!started) {
    started = true;
    window.addEventListener(MOBILE_GPS_GRANTED_EVENT, onGranted);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide as EventListener);
    window.addEventListener("focus", onFocusOrOnline);
    window.addEventListener("online", onFocusOrOnline);
    document.addEventListener("resume", onFocusOrOnline as EventListener);
    document.addEventListener("freeze", () => flushKeepalive());

    // Service worker nudge — orqa fonda uyg‘otish
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (ev) => {
        const data = ev.data || {};
        if (data.type === "vaksina-gps-nudge" && wantTracking()) {
          if (sessionId) pollOnce();
          else void boot();
        }
      });
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }

    onPermChange = () => {
      if (permStatus?.state === "granted") {
        rememberGpsGranted();
        setWantTracking(true);
        void boot();
      }
    };
    void navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        permStatus = status;
        if (onPermChange) status.addEventListener("change", onPermChange);
      })
      .catch(() => undefined);
  }

  void (async () => {
    const state = await queryGeolocationPermission();
    if (state === "granted" || wantTracking()) {
      setWantTracking(true);
      void boot();
    }
  })();
}

/** Logout — to‘liq to‘xtatish */
export function stopMobileGpsKeepalive() {
  cancelled = true;
  setWantTracking(false);
  flushKeepalive();
  clearWatchersOnly();
  if (retryId != null) {
    window.clearTimeout(retryId);
    retryId = null;
  }
  void releaseWake();
  saveSession(null);
  notifShown = false;
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.ready
      .then((reg) => reg.getNotifications({ tag: "vaksina-gps-keepalive" }))
      .then((list) => list.forEach((n) => n.close()))
      .catch(() => undefined);
  }
}

export function isMobileGpsKeepaliveRunning() {
  return started && !cancelled && sessionId != null;
}
