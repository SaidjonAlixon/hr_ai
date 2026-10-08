import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Copy, MapPin, Navigation, Phone, Search, UserPlus, X } from "lucide-react";
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
  needs: Need[];
  needCount: number;
};

type Need = {
  role: string;
  count: number;
  shift: string;
  openedAt: string;
  daysOpen: number;
  neededBy: string | null;
};

/** "all" — barcha filiallar, "need" — ochiq «Xodim kerak» arizasi borlar, "role:<lavozim>" — shu lavozim kerak bo‘lganlar */
type NeedFilter = "all" | "need" | `role:${string}`;

function initialNeedFilter(): NeedFilter {
  const raw = new URLSearchParams(window.location.search).get("kerak");
  if (raw == null) return "all";
  return raw && raw !== "1" ? `role:${raw}` : "need";
}

function daysLabel(days: number): string {
  return days <= 0 ? "bugun" : `${days} kun`;
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function urgencyClass(days: number): string {
  if (days >= 14) return "bg-red-100 text-red-800";
  if (days >= 7) return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-800";
}

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

function pinHtml(numberLabel: string, name: string, active: boolean, need: number, needMode: boolean): string {
  const bg = needMode ? (active ? "#9a3412" : "#ea580c") : active ? "#9f1239" : "#e11d48";
  const badge =
    need > 0
      ? `<span style="flex:none;background:#fff;color:#c2410c;border-radius:999px;padding:1px 6px;font-weight:800">${need} kerak</span>`
      : "";
  return `<div style="display:inline-flex;align-items:center;gap:5px;max-width:280px;background:${bg};color:#fff;font:700 11px/1.2 system-ui,sans-serif;padding:2px ${need > 0 ? 3 : 8}px 2px 2px;border-radius:999px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"><span style="flex:none;background:rgba(255,255,255,.2);border-radius:999px;padding:2px 6px">${escapePin(numberLabel)}</span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650">${escapePin(name)}</span>${badge}</div>`;
}

function pinSize(numberLabel: string, name: string, need: number): [number, number] {
  const chars = Math.min(name.trim().length, 28);
  const badge = need > 0 ? 50 + String(need).length * 7 : 0;
  const width = Math.min(280, 46 + numberLabel.length * 7 + chars * 7 + badge);
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
  const [needFilter, setNeedFilter] = useState<NeedFilter>(initialNeedFilter);
  const needMode = needFilter !== "all";
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
        setPlaces((data.places || []).map((p) => ({ ...p, needs: p.needs ?? [], needCount: p.needCount ?? 0 })));
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

  const needStats = useMemo(() => {
    const roles = new Map<string, { branches: number; people: number }>();
    let branches = 0;
    let people = 0;
    let withoutGps = 0;
    for (const p of places) {
      if (!p.needCount) continue;
      branches++;
      people += p.needCount;
      if (p.lat == null || p.lng == null) withoutGps++;
      const seen = new Set<string>();
      for (const n of p.needs) {
        const r = roles.get(n.role) ?? { branches: 0, people: 0 };
        r.people += n.count;
        if (!seen.has(n.role)) r.branches++;
        seen.add(n.role);
        roles.set(n.role, r);
      }
    }
    const roleList = Array.from(roles.entries())
      .map(([role, v]) => ({ role, ...v }))
      .sort((a, b) => b.people - a.people || a.role.localeCompare(b.role, "uz"));
    return { branches, people, withoutGps, roles: roleList };
  }, [places]);

  const needRole = needFilter.startsWith("role:") ? needFilter.slice(5) : null;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (needFilter === "all") url.searchParams.delete("kerak");
    else url.searchParams.set("kerak", needRole ?? "1");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [needFilter, needRole]);

  const visible = useMemo(() => {
    const query = foldScript(q.trim());
    const numberQuery = q.replace(/\D/g, "");
    const list = places.filter((p) => {
      if (needMode && !p.needCount) return false;
      if (needRole && !p.needs.some((n) => n.role === needRole)) return false;
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
    if (!needMode) return list;
    const oldest = (p: Place) => p.needs.reduce((m, n) => Math.max(m, n.daysOpen), 0);
    return list.sort((a, b) => oldest(b) - oldest(a) || b.needCount - a.needCount);
  }, [places, q, district, coordinator, boundaryName, needMode, needRole]);

  const visibleNeedStats = useMemo(() => {
    let people = 0;
    let oldest = 0;
    for (const p of visible) {
      for (const n of p.needs) {
        if (needRole && n.role !== needRole) continue;
        people += n.count;
        oldest = Math.max(oldest, n.daysOpen);
      }
    }
    return { people, oldest };
  }, [visible, needRole]);

  const selected = places.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !visible.some((p) => p.id === selectedId)) {
      setSelectedId(null);
    }
  }, [visible, selectedId]);

  const fitKey = `${coordinator}|${needFilter}|${places.length}`;
  const lastFit = useRef("");
  useEffect(() => {
    if (!mapObj.current || !places.length || lastFit.current === fitKey) return;
    const first = lastFit.current === "";
    lastFit.current = fitKey;
    if (coordinator === "all" && !needMode && first) return;
    if (district !== "all" || boundaryGeom.current) return;
    const withGps = visible.filter((p): p is Place & { lat: number; lng: number } => p.lat != null && p.lng != null);
    if (!withGps.length) return;
    const bounds = L.latLngBounds(withGps.map((p) => [p.lat, p.lng]));
    if (bounds.isValid()) {
      mapObj.current.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 });
    }
    // Faqat filtr almashganda moslanadi, qidiruvda xarita sakramasin
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    const map = mapObj.current;
    const group = markers.current;
    if (!map || !group) return;
    group.clearLayers();
    const withGps = visible.filter((p): p is Place & { lat: number; lng: number } => p.lat != null && p.lng != null);
    for (const p of withGps) {
      const label = p.numberLabel || "•";
      const name = p.name.trim() || "Filial";
      const need = needRole ? p.needs.filter((n) => n.role === needRole).reduce((s, n) => s + n.count, 0) : p.needCount;
      const [width, height] = pinSize(label, name, need);
      const icon = L.divIcon({
        className: "filial-public-pin",
        html: pinHtml(label, name, p.id === selectedId, need, needMode),
        iconSize: [width, height],
        iconAnchor: [Math.round(width / 2), height],
      });
      const marker = L.marker([p.lat, p.lng], { icon, zIndexOffset: p.id === selectedId ? 800 : 0 });
      marker.on("click", () => setSelectedId(p.id));
      marker.addTo(group);
    }
  }, [visible, selectedId, needMode, needRole]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map || !selected || selected.lat == null || selected.lng == null) return;
    map.flyTo([selected.lat, selected.lng], Math.max(map.getZoom(), 15), { duration: 0.55 });
  }, [selectedId]);

  const copyLink = async () => {
    const kerak = needFilter === "need" ? "?kerak=1" : needRole ? `?kerak=${encodeURIComponent(needRole)}` : "";
    const url = `${window.location.origin}/filiallar${kerak}`;
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
      <aside className="flex max-h-[52dvh] w-full shrink-0 flex-col overflow-y-auto border-b border-slate-200 bg-white md:max-h-none md:w-[420px] md:overflow-hidden md:border-b-0 md:border-r lg:w-[440px]">
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
          <div className="mt-2 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <UserPlus
                className={`pointer-events-none absolute left-2 top-2.5 h-4 w-4 ${needMode ? "text-orange-600" : "text-slate-400"}`}
              />
              <select
                value={needFilter}
                onChange={(e) => setNeedFilter(e.target.value as NeedFilter)}
                className={`h-9 w-full rounded-lg border pl-8 pr-2 text-xs font-medium outline-none ${
                  needMode
                    ? "border-orange-300 bg-orange-50 text-orange-900 focus:border-orange-500"
                    : "border-slate-200 bg-white text-slate-800 focus:border-rose-400"
                }`}
              >
                <option value="all">Barcha filiallar ({places.length})</option>
                <option value="need">
                  Xodim kerak — ariza berilgan ({needStats.branches} filial · {needStats.people} kishi)
                </option>
                {needStats.roles.map((r) => (
                  <option key={r.role} value={`role:${r.role}`}>
                    {r.role} kerak ({r.branches} filial · {r.people} kishi)
                  </option>
                ))}
              </select>
            </div>
            {needMode ? (
              <button
                type="button"
                onClick={() => setNeedFilter("all")}
                title="«Xodim kerak» filtrini tozalash"
                className="inline-flex h-9 items-center justify-center rounded-lg bg-orange-100 px-2.5 text-xs font-semibold text-orange-800 hover:bg-orange-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {needMode ? (
            <div className="mt-2 rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-2.5">
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-lg bg-white/80 px-1 py-1.5">
                  <p className="text-base font-extrabold leading-none text-orange-700">{visible.length}</p>
                  <p className="mt-0.5 text-[10px] font-medium text-slate-500">filial</p>
                </div>
                <div className="rounded-lg bg-white/80 px-1 py-1.5">
                  <p className="text-base font-extrabold leading-none text-orange-700">{visibleNeedStats.people}</p>
                  <p className="mt-0.5 text-[10px] font-medium text-slate-500">kishi kerak</p>
                </div>
                <div className="rounded-lg bg-white/80 px-1 py-1.5">
                  <p className="text-base font-extrabold leading-none text-orange-700">
                    {visible.length ? daysLabel(visibleNeedStats.oldest) : "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium text-slate-500">eng uzoq kutayotgan</p>
                </div>
              </div>
              {needStats.roles.length > 1 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {needStats.roles.map((r) => {
                    const on = needRole === r.role;
                    return (
                      <button
                        key={r.role}
                        type="button"
                        onClick={() => setNeedFilter(on ? "need" : `role:${r.role}`)}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
                          on ? "bg-orange-600 text-white" : "bg-white text-orange-800 ring-1 ring-orange-200 hover:bg-orange-100"
                        }`}
                      >
                        {r.role} · {r.people}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {needStats.withoutGps > 0 ? (
                <p className="mt-1.5 text-[10px] text-orange-800/80">
                  {needStats.withoutGps} ta arizali filialning GPS nuqtasi yo‘q — ular faqat ro‘yxatda.
                </p>
              ) : null}
            </div>
          ) : null}
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
        <div className="shrink-0 md:min-h-0 md:flex-1 md:shrink md:overflow-y-auto">
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
            <p className="px-4 py-6 text-sm text-slate-500">
              {needMode && !needStats.branches
                ? "Hozir ochiq «Xodim kerak» arizasi yo‘q — barcha filiallar to‘liq."
                : "Filial topilmadi."}
            </p>
          ) : null}
          <ul>
            {visible.map((p) => {
              const needs = needRole ? p.needs.filter((n) => n.role === needRole) : p.needs;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left ${
                      needMode ? "hover:bg-orange-50" : "hover:bg-rose-50"
                    } ${selectedId === p.id ? (needMode ? "bg-orange-50" : "bg-rose-50") : ""}`}
                  >
                    <span
                      className={`mt-0.5 inline-flex min-w-[3.2rem] shrink-0 items-center justify-center rounded-md px-1.5 py-1 text-[11px] font-bold text-white ${
                        needMode ? "bg-orange-600" : "bg-rose-600"
                      }`}
                    >
                      {p.numberLabel || "—"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="block text-sm font-semibold leading-snug">{p.name}</span>
                        {!needMode && p.needCount > 0 ? (
                          <span className="shrink-0 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">
                            {p.needCount} kerak
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {p.district}
                        {p.coordinatorName && p.coordinatorName !== "Tayinlanmagan" ? ` · ${p.coordinatorName}` : ""}
                        {p.lat == null ? " · GPS yo‘q" : ""}
                      </span>
                      {needMode && needs.length ? (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {needs.map((n, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-800"
                            >
                              <span className="text-orange-700">{n.role} ×{n.count}</span>
                              <span className="font-normal text-slate-500">{n.shift}</span>
                              <span className={`rounded px-1 text-[10px] font-semibold ${urgencyClass(n.daysOpen)}`}>
                                {daysLabel(n.daysOpen)}
                              </span>
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
      <div className="relative min-h-0 flex-1">
        <div ref={mapRef} className="h-full w-full" />
        {selected ? (
          <div className="absolute inset-x-3 bottom-3 z-[500] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl md:inset-x-auto md:right-4 md:w-[340px]">
            <div className="flex items-start gap-2">
              <span
                className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-xs font-bold text-white ${
                  selected.needCount > 0 ? "bg-orange-600" : "bg-rose-600"
                }`}
              >
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
            {selected.needs.length ? (
              <div className="mt-2 rounded-xl border border-orange-200 bg-orange-50/70 p-2">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-orange-800">
                  <UserPlus className="h-3.5 w-3.5" />
                  Xodim kerak · {selected.needCount} kishi
                </p>
                <ul className="mt-1.5 space-y-1">
                  {selected.needs.map((n, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 text-xs">
                      <span className="min-w-0">
                        <span className="font-semibold text-slate-900">
                          {n.role} ×{n.count}
                        </span>
                        <span className="text-slate-500"> · {n.shift}</span>
                        {n.neededBy ? <span className="block text-[10.5px] text-slate-500">Kerak: {n.neededBy}</span> : null}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${urgencyClass(n.daysOpen)}`}>
                          {daysLabel(n.daysOpen)}
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          {dateLabel(n.openedAt)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
          <p className="pointer-events-none absolute left-14 right-3 top-3 z-[500] w-fit rounded-lg bg-white/90 px-2.5 py-1.5 text-[11px] text-slate-600 shadow">
            {needMode
              ? "To‘q sariq — xodim kerak filiallar. Bosing: kim, qaysi smena, necha kundan beri."
              : "Filialni bosing. Ko‘k — viloyat, binafsha — tuman chegarasi."}
          </p>
        )}
      </div>
    </div>
  );
}
