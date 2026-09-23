/** OSRM — GPS nuqtalarni yo‘l tarmog‘iga yopishtirish (snap-to-road). */

export type LatLng = { lat: number; lng: number };

const OSRM_BASE = "https://router.project-osrm.org";

function toRad(d: number) {
  return (d * Math.PI) / 180;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Ikki nuqta orasidagi yo‘nalish (gradus, 0 = shimol). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Yaqin nuqtalarni siqib, OSRM limitiga moslash. */
export function decimateRoutePoints(points: LatLng[], minDistM = 22, maxPoints = 90): LatLng[] {
  if (points.length <= 2) return points.slice();
  const out: LatLng[] = [points[0]!];
  let last = points[0]!;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    if (haversineMeters(last, p) >= minDistM) {
      out.push(p);
      last = p;
    }
  }
  const end = points[points.length - 1]!;
  if (out[out.length - 1] !== end) out.push(end);

  if (out.length <= maxPoints) return out;
  const step = (out.length - 1) / (maxPoints - 1);
  const sampled: LatLng[] = [];
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(out[Math.round(i * step)]!);
  }
  return sampled;
}

/** Marshrut bo‘ylab har `everyM` metrda strelka joylari. */
export function sampleArrowPositions(
  path: LatLng[],
  everyM = 15,
): Array<{ lat: number; lng: number; bearing: number }> {
  if (path.length < 2) return [];
  const arrows: Array<{ lat: number; lng: number; bearing: number }> = [];
  let traveled = 0;
  let nextMark = everyM;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const segLen = haversineMeters(a, b);
    if (segLen < 0.5) continue;
    const br = bearingDegrees(a, b);

    while (nextMark <= traveled + segLen) {
      const t = (nextMark - traveled) / segLen;
      arrows.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        bearing: br,
      });
      nextMark += everyM;
    }
    traveled += segLen;
  }
  return arrows;
}

type OsrmGeometry = {
  type: "LineString";
  coordinates: [number, number][];
};

function coordsToLatLng(coords: [number, number][]): LatLng[] {
  return coords
    .map(([lng, lat]) => ({ lat, lng }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

async function fetchOsrmJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function pathKey(points: LatLng[]): string {
  return points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(";");
}

const cache = new Map<string, LatLng[]>();

/**
 * GPS breadcrumb → yo‘l bo‘ylab polyline.
 * Avval match, keyin route; muvaffaqiyatsiz bo‘lsa asl nuqtalar.
 */
export async function snapRouteToRoads(
  raw: LatLng[],
  signal?: AbortSignal,
): Promise<{ path: LatLng[]; snapped: boolean }> {
  const valid = raw.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      Math.abs(p.lat) <= 90 &&
      Math.abs(p.lng) <= 180 &&
      !(p.lat === 0 && p.lng === 0),
  );
  if (valid.length < 2) return { path: valid, snapped: false };

  const pts = decimateRoutePoints(valid);
  const key = pathKey(pts);
  const hit = cache.get(key);
  if (hit) return { path: hit, snapped: true };

  const coordStr = pts.map((p) => `${p.lng},${p.lat}`).join(";");

  // 1) Match — GPS izini yo‘lga yopishtirish
  const matchUrl =
    `${OSRM_BASE}/match/v1/driving/${coordStr}` +
    `?geometries=geojson&overview=full&tidy=true&gaps=ignore`;
  const matchJson = (await fetchOsrmJson(matchUrl, signal)) as {
    code?: string;
    matchings?: Array<{ geometry?: OsrmGeometry }>;
  } | null;

  if (matchJson?.code === "Ok" && matchJson.matchings?.length) {
    const merged: LatLng[] = [];
    for (const m of matchJson.matchings) {
      const coords = m.geometry?.coordinates;
      if (coords?.length) merged.push(...coordsToLatLng(coords));
    }
    if (merged.length >= 2) {
      cache.set(key, merged);
      return { path: merged, snapped: true };
    }
  }

  // 2) Route — ketma-ket yo‘nalish (A→…→B)
  const routeUrl =
    `${OSRM_BASE}/route/v1/driving/${coordStr}` +
    `?geometries=geojson&overview=full&continue_straight=false`;
  const routeJson = (await fetchOsrmJson(routeUrl, signal)) as {
    code?: string;
    routes?: Array<{ geometry?: OsrmGeometry }>;
  } | null;

  if (routeJson?.code === "Ok" && routeJson.routes?.[0]?.geometry?.coordinates?.length) {
    const path = coordsToLatLng(routeJson.routes[0].geometry.coordinates);
    if (path.length >= 2) {
      cache.set(key, path);
      return { path, snapped: true };
    }
  }

  // 3) Fallback — asl GPS chiziq
  return { path: pts, snapped: false };
}
