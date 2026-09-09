import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CheckCircle2, LocateFixed, MapPin, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  siteLat: number;
  siteLng: number;
  userLat?: number | null;
  userLng?: number | null;
  /** Degrees clockwise from north — GPS / compass / bearing */
  headingDeg?: number | null;
  accuracyMeters?: number | null;
  inside: boolean;
  allowedMeters: number;
  label: string;
  addressHint?: string | null;
  distanceMeters?: number | null;
  onEnableGps?: () => void;
  needsGps?: boolean;
  gpsDenied?: boolean;
  baseTag?: string;
};

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function branchIcon() {
  return L.divIcon({
    className: "dv-lf-branch",
    html: `<div class="dv-lf-branch-pin" title="Filial">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 34],
  });
}

/** Yandex Maps uslubidagi navigatsiya kursori: konus + o‘q (0° = shimol / yuqori) */
function userNavIcon(heading: number, inside: boolean) {
  const rot = Number.isFinite(heading) ? heading : 0;
  return L.divIcon({
    className: "dv-lf-user",
    html: `<div class="dv-lf-user-wrap ${inside ? "is-in" : "is-out"}">
      <div class="dv-lf-nav" data-dv-nav="1" style="transform:rotate(${rot}deg)">
        <div class="dv-lf-nav-cone" aria-hidden="true">
          <svg viewBox="0 0 120 120" width="120" height="120">
            <defs>
              <radialGradient id="dvConeGrad" cx="50%" cy="78%" r="72%">
                <stop offset="0%" stop-color="rgba(59,130,246,0.55)"/>
                <stop offset="55%" stop-color="rgba(59,130,246,0.18)"/>
                <stop offset="100%" stop-color="rgba(59,130,246,0)"/>
              </radialGradient>
            </defs>
            <path d="M60 60 L18 8 Q60 -6 102 8 Z" fill="url(#dvConeGrad)"/>
          </svg>
        </div>
        <div class="dv-lf-nav-core">
          <div class="dv-lf-nav-ring"></div>
          <div class="dv-lf-nav-dot"></div>
          <svg class="dv-lf-nav-arrow" viewBox="0 0 24 24" width="18" height="18">
            <path d="M12 2.5 L19.5 20.5 L12 16.2 L4.5 20.5 Z" fill="#fff" stroke="#1d4ed8" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
    </div>`,
    iconSize: [120, 120],
    iconAnchor: [60, 60],
  });
}

function setMarkerHeading(marker: L.Marker | null, heading: number) {
  if (!marker) return;
  const el = marker.getElement();
  const nav = el?.querySelector<HTMLElement>("[data-dv-nav]");
  if (nav) nav.style.transform = `rotate(${heading}deg)`;
}

/** Dark OSM map + green zone + live Yandex-style nav cursor */
export function DavomatZoneMap({
  siteLat,
  siteLng,
  userLat,
  userLng,
  headingDeg,
  accuracyMeters,
  inside,
  allowedMeters,
  label,
  addressHint,
  distanceMeters,
  onEnableGps,
  needsGps,
  gpsDenied,
  baseTag = "Asos",
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const branchRef = useRef<L.Marker | null>(null);
  const userRef = useRef<L.Marker | null>(null);
  const accuracyRef = useRef<L.Circle | null>(null);
  const followRef = useRef(true);
  const fittedKey = useRef<string>("");
  const lastUser = useRef<{ lat: number; lng: number; heading: number } | null>(null);
  const lastHeading = useRef<number>(0);
  const animRef = useRef<number | null>(null);

  const hasUser =
    typeof userLat === "number" &&
    typeof userLng === "number" &&
    Number.isFinite(userLat) &&
    Number.isFinite(userLng);

  function fitStandardView(map?: L.Map | null, circle?: L.Circle | null) {
    const m = map ?? mapRef.current;
    const c = circle ?? circleRef.current;
    if (!m || !c) return;
    followRef.current = false;
    m.fitBounds(c.getBounds(), {
      padding: [22, 22],
      maxZoom: 18,
      animate: true,
    });
  }

  function panToUser(lat: number, lng: number, zoomFollow = true) {
    const map = mapRef.current;
    if (!map) return;
    followRef.current = true;
    if (zoomFollow && map.getZoom() < 17) {
      map.setView([lat, lng], Math.max(map.getZoom(), 17), { animate: true });
    } else {
      map.panTo([lat, lng], { animate: true, duration: 0.35 });
    }
  }

  useEffect(() => {
    if (!shellRef.current || mapRef.current) return;

    const map = L.map(shellRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false,
      doubleClickZoom: true,
      boxZoom: false,
      keyboard: false,
    }).setView([siteLat, siteLng], 17);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      subdomains: "abc",
      maxZoom: 19,
      className: "dv-lf-tiles",
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);

    const circle = L.circle([siteLat, siteLng], {
      radius: allowedMeters,
      color: "#34d399",
      weight: 2.5,
      dashArray: "8 7",
      fillColor: "#10b981",
      fillOpacity: 0.28,
      opacity: 0.95,
    }).addTo(map);
    circleRef.current = circle;

    const branch = L.marker([siteLat, siteLng], {
      icon: branchIcon(),
      interactive: true,
      keyboard: false,
      zIndexOffset: 200,
      title: "Standart ko‘rinish",
    }).addTo(map);
    branch.on("click", () => fitStandardView(map, circle));
    branchRef.current = branch;

    map.on("dragstart zoomstart", () => {
      followRef.current = false;
    });

    mapRef.current = map;

    const onResize = () => {
      map.invalidateSize();
      fitStandardView(map, circle);
    };
    window.addEventListener("resize", onResize);
    requestAnimationFrame(() => {
      map.invalidateSize();
      fitStandardView(map, circle);
    });

    return () => {
      window.removeEventListener("resize", onResize);
      if (animRef.current != null) cancelAnimationFrame(animRef.current);
      map.remove();
      mapRef.current = null;
      circleRef.current = null;
      branchRef.current = null;
      userRef.current = null;
      accuracyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const circle = circleRef.current;
    const branch = branchRef.current;
    if (!map || !circle || !branch) return;

    circle.setLatLng([siteLat, siteLng]);
    circle.setRadius(allowedMeters);
    branch.setLatLng([siteLat, siteLng]);

    const fitKey = `${siteLat.toFixed(5)}:${siteLng.toFixed(5)}:${allowedMeters}`;
    if (fittedKey.current !== fitKey) {
      fittedKey.current = fitKey;
      fitStandardView(map, circle);
    }
  }, [siteLat, siteLng, allowedMeters]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!hasUser) {
      if (animRef.current != null) cancelAnimationFrame(animRef.current);
      userRef.current?.remove();
      userRef.current = null;
      accuracyRef.current?.remove();
      accuracyRef.current = null;
      lastUser.current = null;
      return;
    }

    const targetLat = userLat!;
    const targetLng = userLng!;

    let heading =
      typeof headingDeg === "number" && Number.isFinite(headingDeg) ? headingDeg : null;
    if (heading == null && lastUser.current) {
      const moved =
        Math.abs(targetLat - lastUser.current.lat) > 1.2e-6 ||
        Math.abs(targetLng - lastUser.current.lng) > 1.2e-6;
      if (moved) {
        heading = bearingDeg(lastUser.current.lat, lastUser.current.lng, targetLat, targetLng);
      } else {
        heading = lastUser.current.heading;
      }
    }
    if (heading == null) heading = lastHeading.current;
    lastHeading.current = heading;

    // Heading — darhol (telefon bilan sync), animatsiyasiz
    setMarkerHeading(userRef.current, heading);

    const acc = Math.max(
      8,
      Math.min(80, typeof accuracyMeters === "number" && accuracyMeters > 0 ? accuracyMeters : 18),
    );

    const from = lastUser.current ?? { lat: targetLat, lng: targetLng, heading };
    const to = { lat: targetLat, lng: targetLng, heading };
    const distMoved = Math.hypot(to.lat - from.lat, to.lng - from.lng) * 111_320;

    if (animRef.current != null) cancelAnimationFrame(animRef.current);

    const duration = distMoved > 0.4 ? Math.min(700, Math.max(220, distMoved * 40)) : 0;
    const t0 = performance.now();
    const insideChanged =
      !!userRef.current?.getElement()?.querySelector(".dv-lf-user-wrap") &&
      ((inside && !userRef.current.getElement()?.querySelector(".is-in")) ||
        (!inside && !userRef.current.getElement()?.querySelector(".is-out")));

    const applyFrame = (lat: number, lng: number, h: number, done: boolean) => {
      if (!userRef.current) {
        userRef.current = L.marker([lat, lng], {
          icon: userNavIcon(h, inside),
          interactive: false,
          zIndexOffset: 900,
          keyboard: false,
        }).addTo(map);
      } else {
        userRef.current.setLatLng([lat, lng]);
        if (insideChanged) {
          userRef.current.setIcon(userNavIcon(h, inside));
        } else {
          setMarkerHeading(userRef.current, h);
        }
      }

      if (!accuracyRef.current) {
        accuracyRef.current = L.circle([lat, lng], {
          radius: acc,
          color: "#60a5fa",
          weight: 1,
          fillColor: "#3b82f6",
          fillOpacity: 0.14,
          interactive: false,
        }).addTo(map);
      } else {
        accuracyRef.current.setLatLng([lat, lng]);
        accuracyRef.current.setRadius(acc);
      }

      if (followRef.current) {
        map.panTo([lat, lng], { animate: !done, duration: 0.25 });
      }

      if (done) lastUser.current = { lat, lng, heading: h };
    };

    if (duration <= 0 || !userRef.current) {
      applyFrame(to.lat, to.lng, heading, true);
      return;
    }

    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const ease = 1 - (1 - p) * (1 - p);
      const lat = from.lat + (to.lat - from.lat) * ease;
      const lng = from.lng + (to.lng - from.lng) * ease;
      // Joylashuv silliq; heading — joriy kompas (kechikmasin)
      applyFrame(lat, lng, lastHeading.current, p >= 1);
      if (p < 1) animRef.current = requestAnimationFrame(tick);
      else animRef.current = null;
    };
    animRef.current = requestAnimationFrame(tick);
  }, [hasUser, userLat, userLng, headingDeg, inside, accuracyMeters]);

  function locateMe() {
    if (hasUser) {
      panToUser(userLat!, userLng!, true);
      return;
    }
    fitStandardView();
  }

  return (
    <div className="dv-map-shell">
      <div ref={shellRef} className="dv-map-leaflet" />

      {hasUser ? (
        <div
          className={cn(
            "dv-map-status",
            inside ? "dv-map-status-ok" : "dv-map-status-far",
          )}
        >
          {inside ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Siz bu hududasiz
            </>
          ) : (
            <>
              <Navigation className="h-3.5 w-3.5" />
              {distanceMeters != null
                ? `Yana ${Math.max(0, Math.round(distanceMeters - allowedMeters))} m`
                : "Hududdan tashqarida"}
            </>
          )}
        </div>
      ) : null}

      <button
        type="button"
        className={cn("dv-map-locate", hasUser && "is-on")}
        title={hasUser ? "Meni top" : "Standart ko‘rinish"}
        aria-label={hasUser ? "Meni top" : "Standart ko‘rinish"}
        onClick={locateMe}
      >
        <LocateFixed className="h-[18px] w-[18px]" />
      </button>

      <div className="dv-map-footer">
        <div className="dv-map-place">
          <span className="dv-map-place-icon">
            <MapPin className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold leading-tight text-white">{label}</p>
            {addressHint ? (
              <p className="truncate text-[9px] leading-tight text-white/55">{addressHint}</p>
            ) : null}
          </div>
        </div>
        <div className="dv-map-radius">
          <p className="text-[8px] font-medium uppercase tracking-wide text-white/50">Radius</p>
          <p className="text-[11px] font-bold tabular-nums leading-tight text-emerald-300">{allowedMeters} m</p>
        </div>
      </div>

      {needsGps ? (
        <div className="dv-map-gps-stack">
          <div className="dv-map-base-tag" aria-hidden>
            <MapPin className="h-3.5 w-3.5" />
            {baseTag}
          </div>
          <button type="button" id="dv-coach-gps" className="dv-map-gps-cta dv-map-gps-cta-alert" onClick={onEnableGps}>
            <span className="dv-map-gps-pulse" aria-hidden />
            Yoqing
          </button>
          <p className="dv-map-gps-warn">
            {gpsDenied
              ? "Joylashuvga ruxsat bermadingiz — sozlamadan yoqing"
              : "Davomat uchun joylashuvni yoqing"}
          </p>
        </div>
      ) : null}
    </div>
  );
}
