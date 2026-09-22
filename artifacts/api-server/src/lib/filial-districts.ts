/**
 * Filial GPS → tuman/hudud (Toshkent tumanlari + viloyat markazlari).
 * Poligon yo‘q — eng yaqin markaz bo‘yicha (Toshkent ichida / tashqarida).
 */

export type DistrictCenter = {
  name: string;
  lat: number;
  lng: number;
};

/** Toshkent shahar tumanlari (taxminiy markazlar) */
export const TASHKENT_DISTRICTS: DistrictCenter[] = [
  { name: "Bektemir", lat: 41.232, lng: 69.335 },
  { name: "Chilonzor", lat: 41.285, lng: 69.203 },
  { name: "Yashnobod", lat: 41.292, lng: 69.335 },
  { name: "Mirobod", lat: 41.295, lng: 69.278 },
  { name: "Mirzo Ulug‘bek", lat: 41.338, lng: 69.335 },
  { name: "Sirg‘ali", lat: 41.218, lng: 69.225 },
  { name: "Olmazor", lat: 41.355, lng: 69.205 },
  { name: "Uchtepa", lat: 41.305, lng: 69.175 },
  { name: "Shayxontohur", lat: 41.318, lng: 69.235 },
  { name: "Yakkasaroy", lat: 41.278, lng: 69.248 },
  { name: "Yunusobod", lat: 41.365, lng: 69.288 },
  { name: "Yangihayot", lat: 41.205, lng: 69.195 },
];

/** Toshkentdan tashqari — viloyat / shahar markazlari */
export const REGION_CENTERS: DistrictCenter[] = [
  { name: "Toshkent viloyati", lat: 41.12, lng: 69.55 },
  { name: "Samarqand", lat: 39.655, lng: 66.96 },
  { name: "Buxoro", lat: 39.775, lng: 64.43 },
  { name: "Andijon", lat: 40.78, lng: 72.34 },
  { name: "Farg‘ona", lat: 40.39, lng: 71.79 },
  { name: "Namangan", lat: 40.998, lng: 71.67 },
  { name: "Qashqadaryo", lat: 38.86, lng: 65.8 },
  { name: "Surxondaryo", lat: 37.94, lng: 67.57 },
  { name: "Xorazm", lat: 41.55, lng: 60.63 },
  { name: "Navoiy", lat: 40.1, lng: 65.37 },
  { name: "Jizzax", lat: 40.12, lng: 67.84 },
  { name: "Sirdaryo", lat: 40.5, lng: 68.78 },
  { name: "Qoraqalpog‘iston", lat: 42.46, lng: 59.61 },
];

const TASHKENT_BBOX = {
  minLat: 41.18,
  maxLat: 41.42,
  minLng: 69.1,
  maxLng: 69.42,
};

export const DISTRICT_NO_GPS = "GPS yo‘q";
export const DISTRICT_UNKNOWN = "Noma’lum hudud";

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function nearestCenter(lat: number, lng: number, centers: DistrictCenter[]): DistrictCenter {
  let best = centers[0]!;
  let bestD = Infinity;
  for (const c of centers) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function inTashkent(lat: number, lng: number): boolean {
  return (
    lat >= TASHKENT_BBOX.minLat &&
    lat <= TASHKENT_BBOX.maxLat &&
    lng >= TASHKENT_BBOX.minLng &&
    lng <= TASHKENT_BBOX.maxLng
  );
}

/**
 * GPS nuqtadan tuman/hudud nomi.
 * Toshkent ichida → shahar tumani; tashqarida → viloyat/shahar.
 */
export function districtFromGps(lat: number | null | undefined, lng: number | null | undefined): string {
  if (
    lat == null ||
    lng == null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return DISTRICT_NO_GPS;
  }

  if (inTashkent(lat, lng)) {
    return nearestCenter(lat, lng, TASHKENT_DISTRICTS).name;
  }

  const region = nearestCenter(lat, lng, REGION_CENTERS);
  // Juda uzoq bo‘lsa (masalan xato GPS)
  const d = haversineKm(lat, lng, region.lat, region.lng);
  if (d > 250) return DISTRICT_UNKNOWN;
  return region.name;
}

const TASHKENT_CITY_SET = new Set(TASHKENT_DISTRICTS.map((d) => d.name));
const TASHKENT_REGION_NAME = "Toshkent viloyati";

/**
 * Tartib: 1) Toshkent shahar tumanlari → 2) Toshkent viloyati → 3) boshqa viloyatlar → GPS yo‘q.
 */
export function sortDistrictNames(names: string[]): string[] {
  const cityOrder = new Map(TASHKENT_DISTRICTS.map((d, i) => [d.name, i]));
  const regionOrder = new Map(REGION_CENTERS.map((d, i) => [d.name, i]));

  const group = (n: string): number => {
    if (TASHKENT_CITY_SET.has(n)) return 0;
    if (n === TASHKENT_REGION_NAME) return 1;
    if (n === DISTRICT_UNKNOWN) return 3;
    if (n === DISTRICT_NO_GPS) return 4;
    return 2; // boshqa viloyatlar
  };

  return [...names].sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) {
      return (cityOrder.get(a) ?? 99) - (cityOrder.get(b) ?? 99);
    }
    if (ga === 2) {
      const ra = regionOrder.get(a);
      const rb = regionOrder.get(b);
      if (ra != null && rb != null && ra !== rb) return ra - rb;
      return a.localeCompare(b, "uz");
    }
    return a.localeCompare(b, "uz");
  });
}
