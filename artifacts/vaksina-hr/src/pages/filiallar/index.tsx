import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Copy, MapPin, Navigation, Phone, Search, X } from "lucide-react";
import { foldScript } from "@/lib/script-fold";
import { yandexNavigatorUrl, yandexPointUrl } from "@/lib/external-maps";

type Place = {
  id: number;
  branchNo: number | null;
  numberLabel: string | null;
  name: string;
  officialName: string | null;
  district: string;
  lat: number | null;
  lng: number | null;
  hours: string;
  phone: string;
  mudirName: string;
  coordinatorName: string;
  coordinatorPhone: string;
};

type Ring = number[][];
type Geom = { type: string; coordinates: Ring[] | Ring[][] };

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0] ?? 0;
    const yi = ring[i]?.[1] ?? 0;
    const xj = ring[j]?.[0] ?? 0;
    const yj = ring[j]?.[1] ?? 0;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function geometryContains(geometry: Geom | null | undefined, lat: number, lng: number): boolean {
  if (!geometry) return false;
  const polys: Ring[][] =
    geometry.type === "Polygon"
      ? [geometry.coordinates as Ring[]]
      : geometry.type === "MultiPolygon"
        ? (geometry.coordinates as Ring[][])
        : [];
  for (const poly of polys) {
    const outer = poly[0];
    if (!outer || !pointInRing(lng, lat, outer)) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h++) {
      const ring = poly[h];
      if (ring && pointInRing(lng, lat, ring)) {
        hole = true;
        break;
      }
    }
    if (!hole) return true;
  }
  return false;
}

function googleDir(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function escapePin(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pinHtml(numberLabel: string, name: string, active: boolean): string {
  const bg = active ? "#9f1239" : "#e11d48";
  return `<div style="display:inline-flex;align-items:center;gap:5px;max-width:240px;background:${bg};color:#fff;font:700 11px/1.2 system-ui,sans-serif;padding:2px 8px 2px 2px;border-radius:999px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"><span style="flex:none;background:rgba(255,255,255,.2);border-radius:999px;padding:2px 6px">${escapePin(numberLabel)}</span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650">${escapePin(name)}</span></div>`;
}

function pinSize(numberLabel: string, name: string): [number, number] {
  const chars = Math.min(name.trim().length, 28);
  const width = Math.min(240, 46 + numberLabel.length * 7 + chars * 7);
  return [width, 26];
}

function foldPlace(value: string): string {
  return value
    .toLocaleLowerCase("uz")
    .replace(/[\u2018\u2019\u02bb\u02bc'`´]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Ro‘yxatdagi hudud → GeoJSON shapeName */
const SHAPE_BY_PLACE: Record<string, string> = {
  bektemir: "Bektemir",
  chilonzor: "Chilanzar",
  yashnobod: "Yashnobod",
  mirobod: "Mirabad",
  mirzoulugbek: "Mirzo Ulugbek",
  sirgali: "Sergeli",
  olmazor: "Almazar",
  uchtepa: "Uchtepa",
  shayxontohur: "Shaykhantokhur",
  yakkasaroy: "Yakkasaray",
  yunusobod: "Yunusabad",
  yangihayot: "Yangihayot",
  toshkentviloyati: "Tashkent Region",
  samarqand: "Samarqand Region",
  buxoro: "Bukhara Region",
  andijon: "Andijan Region",
  fargona: "Fergana Region",
  namangan: "Namangan Region",
  qashqadaryo: "Qashqadaryo Region",
  surxondaryo: "Surxondaryo Region",
  xorazm: "Xorazm Region",
  navoiy: "Navoiy Region",
  jizzax: "Jizzakh Region",
  sirdaryo: "Sirdaryo Region",
  qoraqalpogiston: "Republic of Karakalpakstan",
};

const REGION_SHAPE_KEYS = new Set([
  "toshkentviloyati",
  "samarqand",
  "buxoro",
  "andijon",
  "fargona",
  "namangan",
  "qashqadaryo",
  "surxondaryo",
  "xorazm",
  "navoiy",
  "jizzax",
  "sirdaryo",
  "qoraqalpogiston",
]);

type BorderRec = { name: string; kind: "region" | "district"; poly: L.Polygon; geom: Geom | null };

function outerRings(geom: Geom | null | undefined): Ring[] {
  if (!geom) return [];
  if (geom.type === "Polygon") {
    const outer = (geom.coordinates as Ring[])[0];
    return outer ? [outer] : [];
  }
  if (geom.type === "MultiPolygon") {
    return (geom.coordinates as Ring[][]).map((poly) => poly[0]).filter((ring): ring is Ring => !!ring && ring.length > 2);
  }
  return [];
}

function shapeForPlace(place: string): { shape: string; kind: "region" | "district" } | null {
  const key = foldPlace(place);
  const shape = SHAPE_BY_PLACE[key];
  if (!shape) return null;
  return { shape, kind: REGION_SHAPE_KEYS.has(key) ? "region" : "district" };
}

export default function PublicFilialMapPage() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const regionLayer = useRef<L.GeoJSON | null>(null);
  const districtLayer = useRef<L.GeoJSON | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [district, setDistrict] = useState("all");
  const [coordinator, setCoordinator] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRegions, setShowRegions] = useState(true);
  const [showDistricts, setShowDistricts] = useState(true);
  const [boundaryName, setBoundaryName] = useState<string | null>(null);
  const boundaryGeom = useRef<Geom | null>(null);
  const showRegionsRef = useRef(true);
  const showDistrictsRef = useRef(true);
  const districtRef = useRef("all");
  const borders = useRef<BorderRec[]>([]);
  const maskLayer = useRef<L.Polygon | null>(null);
  const paintBordersRef = useRef<() => void>(() => undefined);
  showRegionsRef.current = showRegions;
  showDistrictsRef.current = showDistricts;
  districtRef.current = district;

  const loadData = () => {
    setLoading(true);
    setError("");
    fetch("/api/public/filiallar")
      .then(async (res) => {
        if (!res.ok) throw new Error("Xarita yuklanmadi");
        return res.json() as Promise<{ places: Place[]; districts: string[] }>;
      })
      .then((data) => {
        setPlaces(data.places || []);
        setDistricts(data.districts || []);
      })
      .catch(() => {
        setError("Filiallar yuklanmadi. Sahifani yangilang.");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    document.title = "Vaksina filiallari";
    loadData();
  }, []);

  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;
    const map = L.map(mapRef.current, { zoomControl: true }).setView([41.3, 64.6], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    markers.current = L.layerGroup().addTo(map);
    mapObj.current = map;

    const styleRegion = { color: "#1d4ed8", weight: 2, fillColor: "#1d4ed8", fillOpacity: 0.04 };
    const styleDistrict = { color: "#6d28d9", weight: 1.5, fillColor: "#6d28d9", fillOpacity: 0.05 };
    const styleFocus = { color: "#6d28d9", weight: 3.5, fillColor: "#7c3aed", fillOpacity: 0.16 };

    const paintBorders = () => {
      const live = mapObj.current;
      if (!live) return;
      const selected = districtRef.current;
      const target = selected === "all" ? null : shapeForPlace(selected);
      if (maskLayer.current) {
        maskLayer.current.remove();
        maskLayer.current = null;
      }
      let focusPoly: L.Polygon | null = null;
      for (const rec of borders.current) {
        const group = rec.kind === "region" ? regionLayer.current : districtLayer.current;
        if (!group) continue;
        const wanted =
          target == null
            ? rec.kind === "region"
              ? showRegionsRef.current
              : showDistrictsRef.current
            : rec.kind === target.kind && foldPlace(rec.name) === foldPlace(target.shape);
        if (!wanted) {
          if (group.hasLayer(rec.poly)) group.removeLayer(rec.poly);
          continue;
        }
        if (!group.hasLayer(rec.poly)) group.addLayer(rec.poly);
        rec.poly.setStyle(target ? styleFocus : rec.kind === "region" ? styleRegion : styleDistrict);
        if (target) focusPoly = rec.poly;
      }
      if (target && focusPoly) {
        const geom = borders.current.find((r) => r.poly === focusPoly)?.geom;
        const holes = outerRings(geom).map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number]).reverse());
        if (holes.length) {
          if (!live.getPane("filial-mask")) {
            const pane = live.createPane("filial-mask");
            pane.style.zIndex = "350";
          }
          const mask = L.polygon(
            [
              [
                [46.2, 55.5],
                [46.2, 73.8],
                [37, 73.8],
                [37, 55.5],
              ],
              ...holes,
            ],
            { pane: "filial-mask", stroke: false, fillColor: "#eef2f6", fillOpacity: 0.92, interactive: false },
          );
          mask.addTo(live);
          maskLayer.current = mask;
        }
        const bounds = focusPoly.getBounds();
        if (bounds.isValid()) live.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });
      }
      if (regionLayer.current) {
        const show = target ? target.kind === "region" : showRegionsRef.current;
        if (show) regionLayer.current.addTo(live);
        else regionLayer.current.remove();
      }
      if (districtLayer.current) {
        const show = target ? target.kind === "district" : showDistrictsRef.current;
        if (show) districtLayer.current.addTo(live);
        else districtLayer.current.remove();
      }
      if (maskLayer.current) maskLayer.current.bringToBack();
    };
    paintBordersRef.current = paintBorders;

    const bind = (layer: L.GeoJSON, kind: "region" | "district") => {
      layer.eachLayer((item) => {
        const poly = item as L.Polygon;
        const feature = (poly as L.Polygon & { feature?: { properties?: { shapeName?: string }; geometry?: Geom } }).feature;
        const name = feature?.properties?.shapeName || "Hudud";
        borders.current.push({ name, kind, poly, geom: feature?.geometry ?? null });
        poly.bindTooltip(name, { sticky: true, opacity: 0.9 });
        poly.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (districtRef.current !== "all") return;
          boundaryGeom.current = feature?.geometry ?? null;
          setBoundaryName(name);
          const bounds = poly.getBounds();
          if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
        });
      });
    };

    void fetch("/geo/uz-viloyat.geojson")
      .then((r) => r.json())
      .then((geo) => {
        if (!mapObj.current) return;
        const layer = L.geoJSON(geo, { style: styleRegion });
        bind(layer, "region");
        regionLayer.current = layer;
        if (showRegionsRef.current) layer.addTo(map);
        paintBordersRef.current();
      })
      .catch(() => undefined);

    void fetch("/geo/uz-tuman.geojson")
      .then((r) => r.json())
      .then((geo) => {
        if (!mapObj.current) return;
        const layer = L.geoJSON(geo, { style: styleDistrict });
        bind(layer, "district");
        districtLayer.current = layer;
        if (showDistrictsRef.current) layer.addTo(map);
        paintBordersRef.current();
      })
      .catch(() => undefined);

    return () => {
      map.remove();
      mapObj.current = null;
    };
    // Chegara qatlamlari alohida yoqiladi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    paintBordersRef.current();
  }, [district, showRegions, showDistricts]);

  const coordinators = useMemo(() => {
    const map = new Map<string, number>();
    let unassigned = 0;
    for (const p of places) {
      const name = p.coordinatorName?.trim();
      if (!name || name === "Tayinlanmagan") {
        unassigned++;
        continue;
      }
      map.set(name, (map.get(name) || 0) + 1);
    }
    const list = Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, "uz"));
    if (unassigned > 0) {
      list.push({ name: "Tayinlanmagan", count: unassigned });
    }
    return list;
  }, [places]);

  const visible = useMemo(() => {
    const query = foldScript(q.trim());
    const numberQuery = q.replace(/\D/g, "");
    return places.filter((p) => {
      if (district !== "all" && p.district !== district) return false;
      if (coordinator !== "all" && p.coordinatorName !== coordinator) return false;
      if (boundaryGeom.current && p.lat != null && p.lng != null) {
        if (!geometryContains(boundaryGeom.current, p.lat, p.lng)) return false;
      } else if (boundaryGeom.current && (p.lat == null || p.lng == null)) {
        return false;
      }
      if (!query && !numberQuery) return true;
      const hay = foldScript(`${p.name} ${p.officialName || ""} ${p.district} ${p.coordinatorName} ${p.mudirName}`);
      if (query && hay.includes(query)) return true;
      if (numberQuery && p.branchNo != null && String(p.branchNo) === numberQuery) return true;
      return false;
    });
  }, [places, q, district, coordinator, boundaryName]);

  const selected = places.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !visible.some((p) => p.id === selectedId)) {
      setSelectedId(null);
    }
  }, [visible, selectedId]);

  useEffect(() => {
    if (coordinator === "all" || !mapObj.current) return;
    const withGps = visible.filter((p): p is Place & { lat: number; lng: number } => p.lat != null && p.lng != null);
    if (!withGps.length) return;
    const bounds = L.latLngBounds(withGps.map((p) => [p.lat, p.lng]));
    if (bounds.isValid()) {
      mapObj.current.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 });
    }
  }, [coordinator]);

  useEffect(() => {
    const map = mapObj.current;
    const group = markers.current;
    if (!map || !group) return;
    group.clearLayers();
    const withGps = visible.filter((p): p is Place & { lat: number; lng: number } => p.lat != null && p.lng != null);
    for (const p of withGps) {
      const label = p.numberLabel || "•";
      const name = p.name.trim() || "Filial";
      const [width, height] = pinSize(label, name);
      const icon = L.divIcon({
        className: "filial-public-pin",
        html: pinHtml(label, name, p.id === selectedId),
        iconSize: [width, height],
        iconAnchor: [Math.round(width / 2), height],
      });
      const marker = L.marker([p.lat, p.lng], { icon, zIndexOffset: p.id === selectedId ? 800 : 0 });
      marker.on("click", () => setSelectedId(p.id));
      marker.addTo(group);
    }
  }, [visible, selectedId]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map || !selected || selected.lat == null || selected.lng == null) return;
    map.flyTo([selected.lat, selected.lng], Math.max(map.getZoom(), 15), { duration: 0.55 });
  }, [selectedId]);

  const copyLink = async () => {
    const url = `${window.location.origin}/filiallar`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-slate-50 text-slate-900 md:flex-row">
      <style>{`.filial-public-pin{background:transparent!important;border:none!important}`}</style>
      <aside className="flex max-h-[48dvh] w-full shrink-0 flex-col border-b border-slate-200 bg-white md:max-h-none md:w-[400px] md:border-b-0 md:border-r">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">Vaksina</p>
              <h1 className="text-lg font-bold leading-tight">Filiallar xaritasi</h1>
              <p className="mt-0.5 text-xs text-slate-500">Kirish shart emas. Qidiring, bosing, yo‘l oling.</p>
            </div>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Nusxalandi" : "Havola"}
            </button>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom, raqam, tuman — krill yoki lotin"
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-sm outline-none focus:border-rose-400"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <select
              value={district}
              onChange={(e) => {
                boundaryGeom.current = null;
                setBoundaryName(null);
                setDistrict(e.target.value);
              }}
              className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs"
            >
              <option value="all">Barcha hududlar</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span className="inline-flex h-9 items-center rounded-lg bg-slate-100 px-2 text-xs font-semibold text-slate-600">
              {visible.length}
            </span>
          </div>
          <div className="mt-2 flex gap-2">
            <select
              value={coordinator}
              onChange={(e) => setCoordinator(e.target.value)}
              className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-rose-400"
            >
              <option value="all">Barcha koordinatorlar</option>
              {coordinators.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
            {coordinator !== "all" ? (
              <button
                type="button"
                onClick={() => setCoordinator("all")}
                title="Koordinator filtrini tozalash"
                className="inline-flex h-9 items-center justify-center rounded-lg bg-slate-100 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setShowRegions((v) => !v)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${showRegions ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Viloyat chegarasi
            </button>
            <button
              type="button"
              onClick={() => setShowDistricts((v) => !v)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${showDistricts ? "bg-violet-700 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Tuman chegarasi
            </button>
            {coordinator !== "all" ? (
              <button
                type="button"
                onClick={() => setCoordinator("all")}
                className="inline-flex items-center gap-1 rounded-full bg-rose-700 px-2.5 py-1 text-[11px] font-semibold text-white"
              >
                {coordinator}
                <X className="h-3 w-3" />
              </button>
            ) : null}
            {boundaryName ? (
              <button
                type="button"
                onClick={() => {
                  boundaryGeom.current = null;
                  setBoundaryName(null);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white"
              >
                {boundaryName}
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? <p className="px-4 py-6 text-sm text-slate-500">Yuklanmoqda…</p> : null}
          {error ? (
            <div className="px-4 py-6 text-sm text-rose-700">
              <p>{error}</p>
              <button
                type="button"
                onClick={loadData}
                className="mt-2.5 inline-flex items-center rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-800 transition hover:bg-rose-200"
              >
                Qayta urinish
              </button>
            </div>
          ) : null}
          {!loading && !error && visible.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">Filial topilmadi.</p>
          ) : null}
          <ul>
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left hover:bg-rose-50 ${selectedId === p.id ? "bg-rose-50" : ""}`}
                >
                  <span className="mt-0.5 inline-flex min-w-[3.2rem] shrink-0 items-center justify-center rounded-md bg-rose-600 px-1.5 py-1 text-[11px] font-bold text-white">
                    {p.numberLabel || "—"}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-snug">{p.name}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {p.district}
                      {p.coordinatorName && p.coordinatorName !== "Tayinlanmagan" ? ` · ${p.coordinatorName}` : ""}
                      {p.lat == null ? " · GPS yo‘q" : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="relative min-h-0 flex-1">
        <div ref={mapRef} className="h-full w-full" />
        {selected ? (
          <div className="absolute inset-x-3 bottom-3 z-[500] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl md:inset-x-auto md:right-4 md:w-[340px]">
            <div className="flex items-start gap-2">
              <span className="inline-flex shrink-0 items-center rounded-md bg-rose-600 px-2 py-1 text-xs font-bold text-white">
                {selected.numberLabel || "—"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-snug">{selected.name}</p>
                {selected.officialName ? (
                  <p className="mt-0.5 text-[11px] text-slate-500">{selected.officialName}</p>
                ) : null}
              </div>
              <button type="button" onClick={() => setSelectedId(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="mt-2 space-y-1 text-xs text-slate-700">
              <div className="flex gap-2">
                <dt className="w-[5.6rem] shrink-0 text-slate-400">Filial</dt>
                <dd>{selected.branchNo === 0 ? "Asosiy filial" : selected.branchNo != null ? `${selected.branchNo}-filial` : "Raqam yozilmagan"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[5.6rem] shrink-0 text-slate-400">Hudud</dt>
                <dd>{selected.district}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[5.6rem] shrink-0 text-slate-400">Ish vaqti</dt>
                <dd>{selected.hours}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[5.6rem] shrink-0 text-slate-400">Telefon</dt>
                <dd className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {selected.phone}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[5.6rem] shrink-0 text-slate-400">Zavedushi</dt>
                <dd>{selected.mudirName}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[5.6rem] shrink-0 text-slate-400">Koordinator</dt>
                <dd className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-slate-900">{selected.coordinatorName || "Tayinlanmagan"}</p>
                    {selected.coordinatorName && selected.coordinatorName !== "Tayinlanmagan" && coordinator !== selected.coordinatorName ? (
                      <button
                        type="button"
                        onClick={() => setCoordinator(selected.coordinatorName)}
                        className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 hover:bg-rose-100"
                      >
                        Filiallarini ko‘rish
                      </button>
                    ) : null}
                  </div>
                  {selected.coordinatorPhone && selected.coordinatorPhone !== "Raqam kiritilmagan" ? (
                    <a href={`tel:${selected.coordinatorPhone.replace(/\s/g, "")}`} className="mt-0.5 inline-flex items-center gap-1 font-medium text-slate-900">
                      <Phone className="h-3 w-3" />
                      {selected.coordinatorPhone}
                    </a>
                  ) : (
                    <p className="text-slate-400">Raqam kiritilmagan</p>
                  )}
                </dd>
              </div>
              {selected.lat != null && selected.lng != null ? (
                <div className="flex gap-2">
                  <dt className="w-[5.6rem] shrink-0 text-slate-400">GPS</dt>
                  <dd className="font-mono">
                    {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
                  </dd>
                </div>
              ) : null}
            </dl>
            {selected.lat != null && selected.lng != null ? (
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <a
                  href={yandexPointUrl(selected.lat, selected.lng, selected.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-[#fc3f1d] text-[11px] font-bold text-white"
                >
                  Yandex
                </a>
                <a
                  href={yandexNavigatorUrl(selected.lat, selected.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-blue-700 text-[11px] font-bold text-white"
                >
                  <Navigation className="h-3 w-3" />
                  Yo‘l
                </a>
                <a
                  href={googleDir(selected.lat, selected.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-emerald-700 text-[11px] font-bold text-white"
                >
                  <MapPin className="h-3 w-3" />
                  Google
                </a>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">Bu filialning GPS nuqtasi hali yo‘q.</p>
            )}
          </div>
        ) : (
          <p className="pointer-events-none absolute left-3 top-3 z-[500] rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] text-slate-600 shadow">
            Filialni bosing. Ko‘k — viloyat, binafsha — tuman chegarasi.
          </p>
        )}
      </div>
    </div>
  );
}
