import type { RoutePoint } from "@/components/davomat/MobileRouteMap";

/** Oraliq nuqtalarni URL limiga moslab siqish (boshlanish + oxir saqlanadi) */
function samplePoints(points: RoutePoint[], max = 20): RoutePoint[] {
  if (points.length <= max) return points;
  const out: RoutePoint[] = [points[0]!];
  const mid = max - 2;
  for (let i = 1; i <= mid; i++) {
    const idx = Math.round((i * (points.length - 1)) / (mid + 1));
    out.push(points[idx]!);
  }
  out.push(points[points.length - 1]!);
  return out;
}

function ll(p: RoutePoint): string {
  return `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`;
}

/** Google Maps — yo‘nalish (A → waypoints → B) */
export function googleMapsRouteUrl(points: RoutePoint[]): string | null {
  const clean = points.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0),
  );
  if (!clean.length) return null;
  if (clean.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${ll(clean[0]!)}`;
  }
  const sampled = samplePoints(clean, 10);
  const path = sampled.map(ll).join("/");
  return `https://www.google.com/maps/dir/${path}`;
}

/** Yandex Maps — rtext marshrut (piyoda) */
export function yandexMapsRouteUrlFixed(points: RoutePoint[]): string | null {
  const clean = points.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0),
  );
  if (!clean.length) return null;
  if (clean.length === 1) {
    const p = clean[0]!;
    return `https://yandex.ru/maps/?pt=${p.lng},${p.lat}&z=16&l=map`;
  }
  const sampled = samplePoints(clean, 25);
  const rtext = sampled.map((p) => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`).join("~");
  return `https://yandex.ru/maps/?rtext=${rtext}&rtt=pedestrian`;
}
