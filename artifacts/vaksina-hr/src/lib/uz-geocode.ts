/**
 * O‘zbekiston manzilini xaritadan topish — Nominatim + Photon,
 * qisman moslash (tuman/shahar) va so‘rovni soddalashtirish.
 */

export type GeocodeHit = {
  lat: number;
  lng: number;
  label: string;
  /** full | district | city | fallback */
  precision: "full" | "area" | "fallback";
};

const UA = "VaksinaHR-Dossier/1.5 (internal; contact=hr)";

/** Tez-tez uchraydigan joylar (OSM zaif bo‘lsa ham) */
const KNOWN_PLACES: Array<{ keys: string[]; lat: number; lng: number; label: string }> = [
  { keys: ["muborak"], lat: 39.2615, lng: 65.158, label: "Muborak, Qashqadaryo" },
  { keys: ["qarshi", "karshi"], lat: 38.8606, lng: 65.7891, label: "Qarshi, Qashqadaryo" },
  { keys: ["samarqand", "samarkand"], lat: 39.6542, lng: 66.9597, label: "Samarqand" },
  { keys: ["buxoro", "bukhara"], lat: 39.7681, lng: 64.4556, label: "Buxoro" },
  { keys: ["navoiy", "navoi"], lat: 40.1039, lng: 65.3686, label: "Navoiy" },
  { keys: ["andijon", "andijan"], lat: 40.7821, lng: 72.3442, label: "Andijon" },
  { keys: ["namangan"], lat: 40.9983, lng: 71.6726, label: "Namangan" },
  { keys: ["farg'ona", "fargona", "fergana"], lat: 40.3864, lng: 71.7864, label: "Farg‘ona" },
  { keys: ["xorazm", "urganch", "urgench"], lat: 41.55, lng: 60.6333, label: "Urganch, Xorazm" },
  { keys: ["nukus"], lat: 42.4531, lng: 59.6103, label: "Nukus" },
  { keys: ["jizzax", "jizzakh"], lat: 40.1158, lng: 67.8422, label: "Jizzax" },
  { keys: ["sirdaryo", "guliston"], lat: 40.4897, lng: 68.7842, label: "Guliston, Sirdaryo" },
  { keys: ["termiz", "termez"], lat: 37.2242, lng: 67.2783, label: "Termiz" },
  { keys: ["toshkent", "tashkent"], lat: 41.3111, lng: 69.2797, label: "Toshkent" },
  { keys: ["chirchiq", "chirchik"], lat: 41.4689, lng: 69.5822, label: "Chirchiq" },
  { keys: ["angren"], lat: 41.0167, lng: 70.1436, label: "Angren" },
  { keys: ["olmaliq", "almalyk"], lat: 40.8447, lng: 69.5983, label: "Olmaliq" },
  { keys: ["shahrisabz"], lat: 39.0578, lng: 66.8342, label: "Shahrisabz" },
  { keys: ["kitob"], lat: 39.1397, lng: 66.8814, label: "Kitob" },
  { keys: ["koson"], lat: 39.0375, lng: 65.675, label: "Koson" },
  { keys: ["g'uzor", "guzor"], lat: 38.6203, lng: 66.2481, label: "G‘uzor" },
  { keys: ["dehqonobod", "dehkanabad"], lat: 38.35, lng: 66.55, label: "Dehqonobod" },
  { keys: ["nishon"], lat: 38.9333, lng: 65.6833, label: "Nishon" },
  { keys: ["yakkabog'", "yakkabog", "yakkabagh"], lat: 38.9764, lng: 66.6828, label: "Yakkabog‘" },
  { keys: ["kasbi"], lat: 38.95, lng: 65.5, label: "Kasbi" },
  { keys: ["mirishkor"], lat: 39.0, lng: 64.85, label: "Mirishkor" },
];

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[ʼ'`‘’ʻ]/g, "'")
    .replace(/ʻ/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripNoise(q: string): string {
  return q
    .replace(/\b(mfy|mfy\.|mahalla|ko'chasi|kochasi|ko‘chasi|kocha|uy|kvartira|dom)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Qidiruv variantlari — batafsildan umumiyga */
function buildQueries(raw: string): string[] {
  const q = raw.trim();
  const n = norm(q);
  const cleaned = stripNoise(q);
  const out: string[] = [];

  const push = (s: string) => {
    const t = s.trim();
    if (t.length >= 2 && !out.some((x) => norm(x) === norm(t))) out.push(t);
  };

  push(q);
  push(`${q}, O‘zbekiston`);
  push(`${q}, Uzbekistan`);
  push(cleaned);
  push(`${cleaned}, O‘zbekiston`);

  // "muborak tumani ..." → "Muborak tumani", "Muborak"
  const tuman = n.match(/([a-z'ʻʼ`]+)\s+tuman(i)?/);
  if (tuman?.[1]) {
    const name = tuman[1];
    push(`${name} tumani`);
    push(`${name} District`);
    push(`${name}, Qashqadaryo`);
    push(name);
  }

  // Birinchi so‘z (shahar/tuman nomi)
  const first = cleaned.split(/[\s,]+/).filter(Boolean)[0];
  if (first && first.length >= 3) {
    push(first);
    push(`${first}, Uzbekistan`);
    push(`${first} Uzbekistan`);
  }

  // Viloyat ishorasi
  if (/qashqa|қашқа/i.test(n)) {
    push("Qashqadaryo");
  }

  return out.slice(0, 12);
}

async function nominatimSearch(q: string): Promise<GeocodeHit | null> {
  const params = new URLSearchParams({
    format: "jsonv2",
    q,
    limit: "5",
    countrycodes: "uz",
    addressdetails: "0",
  });
  // Viewbox roughly Uzbekistan
  params.set("viewbox", "55.9,45.6,73.2,37.1");
  params.set("bounded", "0");

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { Accept: "application/json", "Accept-Language": "uz,ru,en", "User-Agent": UA },
  });
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    importance?: number;
  }>;
  if (!arr?.length) return null;
  // Eng muhimi birinchi
  const best = [...arr].sort((a, b) => (b.importance || 0) - (a.importance || 0))[0]!;
  return {
    lat: Number(best.lat),
    lng: Number(best.lon),
    label: best.display_name,
    precision: "full",
  };
}

async function photonSearch(q: string): Promise<GeocodeHit | null> {
  const params = new URLSearchParams({
    q: `${q} Uzbekistan`,
    limit: "5",
    lang: "en",
  });
  // Uzbekistan bbox
  params.set("bbox", "55.9,37.1,73.2,45.6");

  const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: {
        name?: string;
        city?: string;
        county?: string;
        state?: string;
        country?: string;
        countrycode?: string;
      };
    }>;
  };
  const feats = (data.features || []).filter(
    (f) => !f.properties?.countrycode || f.properties.countrycode === "UZ",
  );
  const f = feats[0];
  const coords = f?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const p = f.properties || {};
  const label = [p.name, p.county, p.city, p.state, p.country].filter(Boolean).join(", ");
  return { lat: coords[1], lng: coords[0], label: label || q, precision: "area" };
}

function knownPlaceHit(raw: string): GeocodeHit | null {
  const n = norm(raw);
  let best: (typeof KNOWN_PLACES)[number] | null = null;
  let bestLen = 0;
  for (const place of KNOWN_PLACES) {
    for (const key of place.keys) {
      if (n.includes(norm(key)) && key.length > bestLen) {
        best = place;
        bestLen = key.length;
      }
    }
  }
  if (!best) return null;
  return {
    lat: best.lat,
    lng: best.lng,
    label: best.label,
    precision: "fallback",
  };
}

/**
 * Manzilni topish: to‘liq → soddalashtirilgan → Photon → lokal bazadan.
 */
export async function geocodeUzbekistan(raw: string): Promise<GeocodeHit | null> {
  const q = raw.trim();
  if (q.length < 2) return null;

  const queries = buildQueries(q);

  for (const query of queries) {
    try {
      const hit = await nominatimSearch(query);
      if (hit) {
        // Agar so‘rov juda qisqa bo‘lsa — area
        const short = stripNoise(query).split(/\s+/).length <= 2;
        return { ...hit, precision: short ? "area" : hit.precision };
      }
    } catch {
      /* next */
    }
    // Nominatim rate-limit
    await new Promise((r) => setTimeout(r, 200));
  }

  for (const query of queries.slice(0, 5)) {
    try {
      const hit = await photonSearch(query);
      if (hit) return hit;
    } catch {
      /* next */
    }
  }

  return knownPlaceHit(q);
}

export async function reverseGeocodeUz(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=uz,ru,en`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    if (!res.ok) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const data = (await res.json()) as { display_name?: string };
    return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}
