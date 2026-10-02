import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  haversineMeters,
  sampleArrowPositions,
  snapRouteToRoads,
  type LatLng,
} from "@/lib/osrm-route";
import { DAVOMAT_SITE_LAT, DAVOMAT_SITE_LNG } from "@/lib/davomat-api";
import { yandexNavigatorUrl, yandexPointUrl } from "@/lib/external-maps";

export type RoutePoint = {
  lat: number;
  lng: number;
  label?: string;
  kind: "start" | "end" | "track" | "live";
  time?: string | null;
  accuracy?: number | null;
};

/** Dorixona nuqtasi — saqlangan GPS, taxminiy joy emas */
export type MapPlace = {
  id: number;
  lat: number;
  lng: number;
  name: string;
  mudirName: string;
  coordinatorName: string;
  phone: string;
  hours: string;
  /** Dorixona qizil, asosiy ofis ko‘k */
  tone?: "branch" | "office";
};

/** Asosiy ofis — davomatdagi belgilangan nuqta: 41°13'09.3"N 69°16'22.9"E */
export const OFFICE_MAP_PLACE: MapPlace = {
  id: -1,
  lat: DAVOMAT_SITE_LAT,
  lng: DAVOMAT_SITE_LNG,
  name: "Asosiy ofis",
  mudirName: "",
  coordinatorName: "",
  phone: "",
  hours: "09:00–18:00",
  tone: "office",
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
  /** «Xodimni top» tugmasi matni */
  locateLabel?: string;
  /** Dorixona filiallari — doim xaritada */
  places?: MapPlace[];
  /** Tashqaridan tanlangan filial (qidiruv) */
  focusPlaceId?: number | null;
  /** Har tanlovda oshadi — bir filialni qayta tanlasa ham nuqtaga boradi */
  focusToken?: number;
  onPlaceSelect?: (place: MapPlace) => void;
};

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TASHKENT: [number, number] = [41.3111, 69.2797];
const ARROW_EVERY_M = 15;

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

export function routeDistanceMeters(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1]!, points[i]!);
  }
  return total;
}

/** 0–59 daq → "N daq"; 60+ → "H soat M daq" */
export function formatRouteDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} daq`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (r === 0) return `${h} soat`;
  return `${h} soat ${r} daq`;
}

/** A → B yo‘l masofasi */
export function formatRouteDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters) || meters <= 0) return "0 m";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
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

function escHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

function pharmacyIcon(name: string, tone: "branch" | "office" = "branch") {
  const office = tone === "office";
  const pin = office ? "#1d4ed8" : "#E53935";
  const labelBg = office ? "#1d4ed8" : "rgba(255,255,255,.94)";
  const labelColor = office ? "#ffffff" : "#0f172a";
  const labelBorder = office ? "#1e3a8a" : "rgba(15,23,42,.16)";
  return L.divIcon({
    className: "kochma-pin",
    iconSize: [30, 42],
    iconAnchor: [15, 40],
    popupAnchor: [0, -38],
    html: `<div style="position:relative;width:30px;height:42px;overflow:visible">
      <div style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))">
        <svg width="30" height="42" viewBox="0 0 30 42" aria-hidden>
          <path d="M15 1.5C7.6 1.5 1.6 7.5 1.6 14.9 1.6 25.2 15 40.5 15 40.5S28.4 25.2 28.4 14.9C28.4 7.5 22.4 1.5 15 1.5z" fill="${pin}" stroke="#fff" stroke-width="1.6"/>
          <circle cx="15" cy="14.6" r="5.2" fill="#fff"/>
        </svg>
      </div>
      <span style="position:absolute;left:32px;top:6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 7px;border-radius:6px;background:${labelBg};border:1px solid ${labelBorder};color:${labelColor};font:800 12px/1.3 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.22)">${escHtml(name)}</span>
    </div>`,
  });
}

function placeNavHtml(p: MapPlace): string {
  const yandex = escHtml(yandexPointUrl(p.lat, p.lng, p.name));
  const navi = escHtml(yandexNavigatorUrl(p.lat, p.lng));
  const btn = "display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:1;min-width:0;padding:7px 8px;border-radius:10px;font:700 12px/1 system-ui,sans-serif;text-decoration:none";
  return `<div style="display:flex;gap:6px;margin-top:10px">
    <a href="${yandex}" target="_blank" rel="noopener noreferrer" style="${btn};background:#fc3f1d;color:#fff">Yandex</a>
    <a href="${navi}" target="_blank" rel="noopener noreferrer" style="${btn};background:#1d4ed8;color:#fff">Navigator</a>
  </div>`;
}

function placePopupHtml(p: MapPlace): string {
  if (p.tone === "office") {
    return `<div style="font-family:system-ui,sans-serif;min-width:220px;color:#0f172a">
      <div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#1d4ed8;font-weight:800">Asosiy ofis</div>
      <div style="font-size:15px;font-weight:800;line-height:1.25;margin:2px 0 8px;color:#1e3a8a">${escHtml(p.name)}</div>
      <div style="font-size:13px;line-height:1.5"><span style="color:#64748b">Ish vaqti:</span> <b>${escHtml(p.hours || "09:00–18:00")}</b></div>
      ${placeNavHtml(p)}
    </div>`;
  }
  const phone = escHtml(p.phone);
  const dial = p.phone.replace(/[^\d+]/g, "");
  const phoneHtml = dial.startsWith("+")
    ? `<a href="tel:${escHtml(dial)}" style="color:#0f766e;font-weight:700;text-decoration:none">${phone}</a>`
    : `<b>${phone}</b>`;
  return `<div style="font-family:system-ui,sans-serif;min-width:220px;color:#0f172a">
    <div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#0f766e;font-weight:700">Dorixona</div>
    <div style="font-size:15px;font-weight:800;line-height:1.25;margin:2px 0 8px">${escHtml(p.name)}</div>
    <div style="font-size:13px;line-height:1.5">
      <div><span style="color:#64748b">Mudir:</span> <b>${escHtml(p.mudirName)}</b></div>
      <div><span style="color:#64748b">Koordinator:</span> <b>${escHtml(p.coordinatorName)}</b></div>
      <div><span style="color:#64748b">Dorixona raqami:</span> ${phoneHtml}</div>
      <div><span style="color:#64748b">Ish vaqti:</span> <b>${escHtml(p.hours || "Belgilanmagan")}</b></div>
    </div>
    ${placeNavHtml(p)}
  </div>`;
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

/** Yo‘nalish strelkasi — yo‘l markazida, har ~15 m */
function arrowIcon(bearing: number, liveMode: boolean) {
  const fill = liveMode ? "#0369a1" : "#0369a1";
  return L.divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<div style="
      width:18px;height:18px;display:flex;align-items:center;justify-content:center;
      transform:rotate(${bearing}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));
    ">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3 L20 19 L12 15 L4 19 Z" fill="${fill}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>
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
  locateLabel = "Xodimni top",
  places = [],
  focusPlaceId = null,
  focusToken = 0,
  onPlaceSelect,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const placesLayerRef = useRef<L.LayerGroup | null>(null);
  const placeMarkersRef = useRef<Map<number, L.Marker>>(new Map());
  const onPlaceSelectRef = useRef(onPlaceSelect);
  onPlaceSelectRef.current = onPlaceSelect;
  const userPanned = useRef(false);
  const [roadPath, setRoadPath] = useState<LatLng[][]>([]);
  const [snapped, setSnapped] = useState(false);
  const [routing, setRouting] = useState(false);

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

  const locateTarget = useMemo(() => {
    if (cleanPoints.length === 0) return null;
    const live = [...cleanPoints].reverse().find((p) => p.kind === "live");
    return live || cleanPoints[cleanPoints.length - 1]!;
  }, [cleanPoints]);

  const goToEmployee = () => {
    const map = mapRef.current;
    const target = locateTarget;
    if (!map || !target) return;
    userPanned.current = false;
    map.setView([target.lat, target.lng], Math.max(map.getZoom(), 17), { animate: true });
  };

  const hasWalkedTrack = cleanPoints.some((p) => p.kind === "track");

  const distanceLabel = useMemo(() => {
    const path = roadPath.flat();
    if (!hasWalkedTrack || path.length < 2) return null;
    let meters = 0;
    for (const seg of roadPath) {
      if (seg.length >= 2) meters += routeDistanceMeters(seg as RoutePoint[]);
    }
    return formatRouteDistance(meters);
  }, [roadPath, hasWalkedTrack]);

  // Faqat yurilgan GPS izi. Ikki nuqta (keldi/ketdi) orasida yo‘l o‘ylab chizilmaydi.
  useEffect(() => {
    if (!hasWalkedTrack || cleanPoints.length < 2) {
      setRoadPath([]);
      setSnapped(false);
      setRouting(false);
      return;
    }

    const ac = new AbortController();
    setRouting(true);
    void snapRouteToRoads(
      cleanPoints.map((p) => ({ lat: p.lat, lng: p.lng })),
      ac.signal,
    ).then((r) => {
      if (ac.signal.aborted) return;
      setRoadPath(r.segments.filter((s) => s.length >= 2));
      setSnapped(r.snapped);
      setRouting(false);
    });

    return () => ac.abort();
  }, [cleanPoints, hasWalkedTrack]);

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
    placesLayerRef.current = L.layerGroup().addTo(map);
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
      placesLayerRef.current = null;
      placeMarkersRef.current = new Map();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerRef.current;
    if (!map || !group) return;

    group.clearLayers();

    if (!cleanPoints.length) {
      if (!places.length) map.setView(emptyCenter, emptyZoom);
      window.setTimeout(() => map.invalidateSize(), 40);
      return;
    }

    const drawSegments = roadPath.filter((s) => s.length >= 2);
    const latLngs: L.LatLngExpression[] = (
      drawSegments.length ? drawSegments.flat() : cleanPoints
    ).map((p) => [p.lat, p.lng]);

    for (const seg of drawSegments) {
      const line = seg.map((p) => [p.lat, p.lng] as L.LatLngExpression);
      L.polyline(line, {
        color: "#0ea5e9",
        weight: 14,
        opacity: 0.28,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);
      L.polyline(line, {
        color: liveMode ? "#0284c7" : "#0369a1",
        weight: 7,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(group);
      L.polyline(line, {
        color: "#ffffff",
        weight: 1.8,
        opacity: 0.85,
        dashArray: "10 10",
        lineCap: "butt",
        lineJoin: "round",
      }).addTo(group);

      const arrows = sampleArrowPositions(seg, ARROW_EVERY_M);
      for (const a of arrows) {
        L.marker([a.lat, a.lng], {
          icon: arrowIcon(a.bearing, liveMode),
          interactive: false,
          keyboard: false,
          zIndexOffset: 200,
        }).addTo(group);
      }
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
          icon: pinIcon("B", "#dc2626", liveMode ? "Hozir" : "Tugash"),
          zIndexOffset: 650,
        })
          .bindPopup(popupHtml({ ...endCand, kind: "end" }))
          .addTo(group);
      }

      if (latLngs.length === 1 && places.length > 1) {
        const bounds = L.latLngBounds([
          ...places.map((p) => [p.lat, p.lng] as L.LatLngTuple),
          latLngs[0] as L.LatLngTuple,
        ]);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
      } else if (latLngs.length === 1) map.setView(latLngs[0]!, 17);
      else map.fitBounds(L.latLngBounds(latLngs), { padding: [56, 56], maxZoom: 18 });
    }

    window.setTimeout(() => map.invalidateSize(), 40);
  }, [cleanPoints, roadPath, emptyCenter, emptyZoom, liveMode, followLive, places]);

  const cleanPlaces = useMemo(
    () =>
      places.filter(
        (p) =>
          validCoord(p.lat, p.lng) &&
          p.lat >= 37.1 &&
          p.lat <= 45.6 &&
          p.lng >= 55.9 &&
          p.lng <= 73.2,
      ),
    [places],
  );

  useEffect(() => {
    const map = mapRef.current;
    const group = placesLayerRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const markers = new Map<number, L.Marker>();
    for (const p of cleanPlaces) {
      const marker = L.marker([p.lat, p.lng], {
        icon: pharmacyIcon(p.name, p.tone),
        zIndexOffset: p.tone === "office" ? 720 : 400,
        title: p.name,
      })
        .bindPopup(placePopupHtml(p), { maxWidth: 300, closeButton: true })
        .on("click", () => {
          onPlaceSelectRef.current?.(p);
        });
      marker.addTo(group);
      markers.set(p.id, marker);
    }
    placeMarkersRef.current = markers;

    if (!cleanPoints.length && cleanPlaces.length && !userPanned.current) {
      const bounds = L.latLngBounds(cleanPlaces.map((p) => [p.lat, p.lng] as L.LatLngTuple));
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13 });
    }
    window.setTimeout(() => map.invalidateSize(), 40);
  }, [cleanPlaces, cleanPoints.length]);

  useEffect(() => {
    if (focusPlaceId == null) return;
    const map = mapRef.current;
    const marker = placeMarkersRef.current.get(focusPlaceId);
    const place = cleanPlaces.find((p) => p.id === focusPlaceId);
    if (!map || !place) return;
    userPanned.current = true;
    map.flyTo([place.lat, place.lng], 17, { duration: 0.55 });
    marker?.openPopup();
  }, [focusPlaceId, focusToken, cleanPlaces]);

  return (
    <div className={className} style={{ height, position: "relative", minHeight: 360 }}>
      <div
        ref={ref}
        style={{ height: "100%", width: "100%", borderRadius: 16, overflow: "hidden" }}
      />
      {distanceLabel ? (
        <div className="pointer-events-none absolute left-3 top-3 z-[1000] rounded-xl border border-border/80 bg-background/95 px-3 py-1.5 text-xs font-semibold shadow-md backdrop-blur">
          A → {liveMode ? "●" : "B"}: {distanceLabel}
          {snapped ? (
            <span className="ml-1.5 font-normal text-emerald-700 dark:text-emerald-400">· yurgan iz</span>
          ) : roadPath.length ? (
            <span className="ml-1.5 font-normal text-emerald-700 dark:text-emerald-400">· GPS izi</span>
          ) : routing ? (
            <span className="ml-1.5 font-normal text-muted-foreground">· hisoblanmoqda…</span>
          ) : null}
        </div>
      ) : null}
      {cleanPlaces.length > 0 ? (
        <div className="pointer-events-none absolute bottom-4 left-3 z-[1000] inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-background/95 px-3 py-1.5 text-[11px] font-semibold text-teal-800 shadow-md backdrop-blur dark:border-teal-800 dark:text-teal-100">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" aria-hidden />
          Dorixona
          <span className="ml-1 inline-block h-2.5 w-2.5 rounded-full bg-blue-700" aria-hidden />
          Asosiy ofis
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
          <span className="text-[10px] text-muted-foreground">▲ har {ARROW_EVERY_M} m</span>
        </div>
      ) : emptyHint ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[1000] max-w-[90%] -translate-x-1/2 rounded-xl border border-border bg-background/95 px-4 py-2 text-center text-xs text-muted-foreground shadow-md backdrop-blur">
          {emptyHint}
        </div>
      ) : null}
      {locateTarget ? (
        <button
          type="button"
          className="absolute bottom-4 right-3 z-[1000] inline-flex items-center gap-1.5 rounded-xl border border-sky-300 bg-sky-600 px-3 py-2 text-xs font-semibold text-white shadow-md hover:bg-sky-700"
          onClick={goToEmployee}
          title={locateLabel}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          {locateLabel}
        </button>
      ) : null}
    </div>
  );
}
