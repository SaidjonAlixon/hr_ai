import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type RoutePoint = {
  lat: number;
  lng: number;
  label?: string;
  kind: "start" | "end" | "track" | "live";
  time?: string | null;
  accuracy?: number | null;
};

type Props = {
  points: RoutePoint[];
  className?: string;
  height?: number | string;
  emptyCenter?: [number, number];
  emptyZoom?: number;
  emptyHint?: string;
  /** Real-vaqt: B o‘rniga pulsatsiyali joriy nuqta */
  liveMode?: boolean;
  /** Live da oxirgi nuqtaga kuzatib borsin */
  followLive?: boolean;
};

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TASHKENT: [number, number] = [41.3111, 69.2797];

function popupHtml(p: RoutePoint): string {
  const kind =
    p.kind === "start"
      ? "🟢 Boshlanish (A)"
      : p.kind === "end"
        ? "🔴 Tugash (B)"
        : p.kind === "live"
          ? "📡 Hozirgi joy"
          : "GPS nuqta";
  const acc = p.accuracy != null ? `Aniqlik: ${Math.round(p.accuracy)} m` : "";
  return `<div style="font:12px/1.45 system-ui,sans-serif"><b>${kind}</b><br/>${
    p.time || ""
  }<br/>${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}${
    acc ? `<br/>${acc}` : ""
  }</div>`;
}

function haversineM(a: RoutePoint, b: RoutePoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function routeDistanceMeters(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineM(points[i - 1]!, points[i]!);
  }
  return total;
}

function pinIcon(letter: string, color: string, subtitle: string) {
  return L.divIcon({
    className: "",
    iconSize: [40, 52],
    iconAnchor: [20, 50],
    popupAnchor: [0, -42],
    html: `<div style="text-align:center;filter:drop-shadow(0 2px 5px rgba(0,0,0,.4))">
      <div style="
        width:32px;height:32px;margin:0 auto;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
        background:${color};border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;
      "><span style="transform:rotate(45deg);color:#fff;font:800 14px/1 system-ui,sans-serif">${letter}</span></div>
      <div style="
        margin-top:2px;padding:1px 6px;border-radius:6px;background:rgba(15,23,42,.88);color:#fff;
        font:600 10px/1.2 system-ui,sans-serif;white-space:nowrap
      ">${subtitle}</div>
    </div>`,
  });
}

function liveIcon() {
  return L.divIcon({
    className: "",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -16],
    html: `<div style="position:relative;width:44px;height:44px">
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(14,165,233,.25);animation:kochmaPulse 1.6s ease-out infinite"></div>
      <div style="position:absolute;inset:8px;border-radius:50%;background:#0ea5e9;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>
      <style>@keyframes kochmaPulse{0%{transform:scale(.55);opacity:.9}100%{transform:scale(1.35);opacity:0}}</style>
    </div>`,
  });
}

function validCoord(lat: unknown, lng: unknown): lat is number {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
}

export function MobileRouteMap({
  points,
  className,
  height = 320,
  emptyCenter = TASHKENT,
  emptyZoom = 13,
  emptyHint = "Xodim/sessiya tanlang — yo‘nalish shu yerda chiqadi",
  liveMode = false,
  followLive = true,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const userPanned = useRef(false);

  const cleanPoints = useMemo(
    () =>
      points
        .filter((p) => validCoord(p.lat, p.lng))
        .map((p) => ({
          ...p,
          lat: Number(p.lat),
          lng: Number(p.lng),
        })),
    [points],
  );

  const distanceLabel = useMemo(() => {
    if (cleanPoints.length < 2) return null;
    const m = routeDistanceMeters(cleanPoints);
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(2)} km`;
  }, [cleanPoints]);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;

    const map = L.map(ref.current, {
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;

    L.tileLayer(OSM_URL, {
      subdomains: "abc",
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    map.setView(emptyCenter, emptyZoom);

    const markPanned = () => {
      userPanned.current = true;
    };
    map.on("dragstart", markPanned);
    map.on("zoomstart", markPanned);

    const onResize = () => map.invalidateSize();
    window.setTimeout(onResize, 50);
    window.setTimeout(onResize, 300);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      map.off("dragstart", markPanned);
      map.off("zoomstart", markPanned);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerRef.current;
    if (!map || !group) return;

    group.clearLayers();

    if (!cleanPoints.length) {
      map.setView(emptyCenter, emptyZoom);
      window.setTimeout(() => map.invalidateSize(), 40);
      return;
    }

    const latLngs: L.LatLngExpression[] = cleanPoints.map((p) => [p.lat, p.lng]);

    if (latLngs.length >= 2) {
      L.polyline(latLngs, {
        color: liveMode ? "#38bdf8" : "#38bdf8",
        weight: 8,
        opacity: 0.3,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);
      L.polyline(latLngs, {
        color: liveMode ? "#0369a1" : "#0284c7",
        weight: 4,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);
    }

    for (const p of cleanPoints) {
      if (p.kind === "start" || p.kind === "end" || p.kind === "live") continue;
      L.circleMarker([p.lat, p.lng], {
        radius: liveMode ? 3.5 : 5,
        color: "#fff",
        fillColor: "#0ea5e9",
        fillOpacity: 0.9,
        weight: 1.5,
      })
        .bindPopup(popupHtml(p))
        .addTo(group);
    }

    const start = cleanPoints.find((p) => p.kind === "start") || cleanPoints[0]!;
    L.marker([start.lat, start.lng], {
      icon: pinIcon("A", "#16a34a", "Boshlanish"),
      zIndexOffset: 600,
    })
      .bindPopup(popupHtml({ ...start, kind: "start" }))
      .addTo(group);

    const last = cleanPoints[cleanPoints.length - 1]!;

    if (liveMode) {
      L.marker([last.lat, last.lng], {
        icon: liveIcon(),
        zIndexOffset: 800,
      })
        .bindPopup(popupHtml({ ...last, kind: "live" }))
        .addTo(group);

      if (followLive && !userPanned.current) {
        map.setView([last.lat, last.lng], Math.max(map.getZoom(), 16), { animate: true });
      } else if (latLngs.length === 1) {
        map.setView(latLngs[0]!, 16);
      } else if (!userPanned.current) {
        map.fitBounds(L.latLngBounds(latLngs), { padding: [56, 56], maxZoom: 17 });
      }
    } else {
      const endCand =
        cleanPoints.find((p) => p.kind === "end") ||
        (cleanPoints.length > 1 ? cleanPoints[cleanPoints.length - 1]! : null);

      if (endCand && (endCand.lat !== start.lat || endCand.lng !== start.lng || cleanPoints.length > 1)) {
        L.marker([endCand.lat, endCand.lng], {
          icon: pinIcon("B", "#dc2626", "Tugash"),
          zIndexOffset: 650,
        })
          .bindPopup(popupHtml({ ...endCand, kind: "end" }))
          .addTo(group);
      }

      if (latLngs.length === 1) map.setView(latLngs[0]!, 17);
      else map.fitBounds(L.latLngBounds(latLngs), { padding: [56, 56], maxZoom: 18 });
    }

    window.setTimeout(() => map.invalidateSize(), 40);
  }, [cleanPoints, emptyCenter, emptyZoom, liveMode, followLive]);

  return (
    <div className={className} style={{ height, position: "relative", minHeight: 360 }}>
      <div
        ref={ref}
        style={{ height: "100%", width: "100%", borderRadius: 16, overflow: "hidden" }}
      />
      {distanceLabel ? (
        <div className="pointer-events-none absolute left-3 top-3 z-[1000] rounded-xl border border-border/80 bg-background/95 px-3 py-1.5 text-xs font-semibold shadow-md backdrop-blur">
          Yo‘l: {distanceLabel}
        </div>
      ) : null}
      {cleanPoints.length > 0 ? (
        <div className="pointer-events-none absolute right-3 top-3 z-[1000] flex flex-col gap-1 rounded-xl border border-border/80 bg-background/95 px-3 py-2 text-[11px] shadow-md backdrop-blur">
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">A · Boshlanish</span>
          {liveMode ? (
            <span className="font-semibold text-sky-700 dark:text-sky-300">● · Hozirgi joy</span>
          ) : (
            <span className="font-semibold text-rose-700 dark:text-rose-400">B · Tugash</span>
          )}
        </div>
      ) : emptyHint ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[1000] max-w-[90%] -translate-x-1/2 rounded-xl border border-border bg-background/95 px-4 py-2 text-center text-xs text-muted-foreground shadow-md backdrop-blur">
          {emptyHint}
        </div>
      ) : null}
      {liveMode && cleanPoints.length > 0 ? (
        <button
          type="button"
          className="absolute bottom-4 right-3 z-[1000] rounded-xl border border-sky-300 bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:bg-sky-700"
          onClick={() => {
            userPanned.current = false;
            const last = cleanPoints[cleanPoints.length - 1];
            if (last && mapRef.current) mapRef.current.setView([last.lat, last.lng], 16, { animate: true });
          }}
        >
          Kuzatish
        </button>
      ) : null}
    </div>
  );
}
