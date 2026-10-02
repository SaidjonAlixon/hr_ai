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

function validPoint(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

/** Nuqtadan kesmagacha masofa, metr. */
function pointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const latM = 111_320;
  const lngM = 111_320 * Math.cos(toRad((a.lat + b.lat) / 2));
  const bx = (b.lng - a.lng) * lngM;
  const by = (b.lat - a.lat) * latM;
  const px = (p.lng - a.lng) * lngM;
  const py = (p.lat - a.lat) * latM;
  const ab2 = bx * bx + by * by;
  if (ab2 < 1) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / ab2));
  return Math.hypot(px - bx * t, py - by * t);
}

function pathLengthMeters(points: LatLng[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += haversineMeters(points[i - 1]!, points[i]!);
  return n;
}

/** GPS sakrashini tashlaydi — borib qaytmagan nuqta chiziqqa kirmaydi. */
export function cleanWalkedPoints(raw: LatLng[]): LatLng[] {
  const collapsed: LatLng[] = [];
  for (const p of raw) {
    if (!validPoint(p)) continue;
    const prev = collapsed[collapsed.length - 1];
    if (!prev || haversineMeters(prev, p) >= 8) collapsed.push(p);
  }
  let guard = 0;
  let changed = true;
  while (changed && collapsed.length >= 3 && guard++ < 8) {
    changed = false;
    for (let i = 1; i < collapsed.length - 1; i++) {
      const a = collapsed[i - 1]!;
      const b = collapsed[i]!;
      const c = collapsed[i + 1]!;
      const ac = haversineMeters(a, c);
      const ab = haversineMeters(a, b);
      const bc = haversineMeters(b, c);
      const off = pointToSegmentMeters(b, a, c);
      const spike = off > 28 && ac + 20 < ab + bc && ac < Math.max(ab, bc) * 0.7;
      if (spike) {
        collapsed.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return collapsed;
}

/** Uzoq uzilishni ulamaydi — oradagi joy yurilgan deb chizilmaydi. */
export function splitWalkGaps(points: LatLng[], gapM = 120): LatLng[][] {
  if (!points.length) return [];
  const segs: LatLng[][] = [[points[0]!]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (haversineMeters(prev, cur) > gapM) segs.push([cur]);
    else segs[segs.length - 1]!.push(cur);
  }
  return segs.filter((s) => s.length >= 2);
}

function maxOffTrace(snapped: LatLng[], raw: LatLng[]): number {
  let max = 0;
  for (const p of snapped) {
    let best = Infinity;
    if (raw.length < 2) {
      best = raw[0] ? haversineMeters(p, raw[0]) : Infinity;
    } else {
      for (let i = 1; i < raw.length; i++) {
        best = Math.min(best, pointToSegmentMeters(p, raw[i - 1]!, raw[i]!));
      }
    }
    if (best > max) max = best;
  }
  return max;
}

/**
 * Faqat yurilgan GPS izi.
 * Yo‘lga yopishtirish faqat izdan chiqmasa qabul qilinadi.
 * Ikki nuqta orasida yangi marshrut o‘ylab chizilmaydi.
 */
export async function snapRouteToRoads(
  raw: LatLng[],
  signal?: AbortSignal,
): Promise<{ path: LatLng[]; segments: LatLng[][]; snapped: boolean }> {
  const cleaned = cleanWalkedPoints(raw);
  const segments = splitWalkGaps(cleaned);
  const walked = segments.flat();
  if (walked.length < 2) return { path: cleaned, segments, snapped: false };

  const pts = decimateRoutePoints(walked, 18, 80);
  const key = pathKey(pts);
  const hit = cache.get(key);
  if (hit) return { path: hit, segments: splitWalkGaps(hit), snapped: true };

  const coordStr = pts.map((p) => `${p.lng},${p.lat}`).join(";");
  const matchUrl =
    `${OSRM_BASE}/match/v1/foot/${coordStr}` +
    `?geometries=geojson&overview=full&tidy=true&gaps=split`;
  const matchJson = (await fetchOsrmJson(matchUrl, signal)) as {
    code?: string;
    matchings?: Array<{ geometry?: OsrmGeometry; confidence?: number }>;
  } | null;

  if (matchJson?.code === "Ok" && matchJson.matchings?.length) {
    const pieces: LatLng[][] = [];
    for (const m of matchJson.matchings) {
      if ((m.confidence ?? 1) < 0.45) continue;
      const coords = m.geometry?.coordinates;
      if (!coords?.length) continue;
      const piece = coordsToLatLng(coords);
      if (piece.length < 2) continue;
      const off = maxOffTrace(piece, pts);
      const rawLen = pathLengthMeters(pts);
      const snapLen = pathLengthMeters(piece);
      if (off > 30) continue;
      if (rawLen > 20 && snapLen > rawLen * 1.2) continue;
      pieces.push(piece);
    }
    if (pieces.length) {
      const path = pieces.flat();
      cache.set(key, path);
      return { path, segments: pieces, snapped: true };
    }
  }

  return { path: walked, segments, snapped: false };
}
