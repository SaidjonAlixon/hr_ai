/**
 * Viloyat / hudud slug lari — filial GPS (districtFromGps) bilan mos.
 * Toshkent shahar tumanlari → toshkent_shahar; qolganlari REGION_CENTERS.
 */
import { REGION_CENTERS, TASHKENT_DISTRICTS, districtFromGps } from "./filial-districts";

export type ViloyatOption = { slug: string; label: string };

function slugifyViloyatLabel(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’ʻʼ'`´]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_");
}

/** Tanlash uchun to‘liq ro‘yxat (UI + validatsiya) */
export const VILOYAT_OPTIONS: ViloyatOption[] = [
  { slug: "toshkent_shahar", label: "Toshkent shahar" },
  ...REGION_CENTERS.map((r) => ({
    slug: slugifyViloyatLabel(r.name),
    label: r.name,
  })),
];

const LABEL_BY_SLUG = new Map(VILOYAT_OPTIONS.map((v) => [v.slug, v.label]));
const TASHKENT_DISTRICT_NAMES = new Set(TASHKENT_DISTRICTS.map((d) => d.name));

export function isValidViloyatSlug(slug?: string | null): boolean {
  return !!slug && LABEL_BY_SLUG.has(slug);
}

export function viloyatLabel(slug?: string | null): string {
  if (!slug) return "—";
  return LABEL_BY_SLUG.get(slug) || slug;
}

/** districtFromGps natijasidan viloyat slug */
export function districtToViloyatSlug(district?: string | null): string | null {
  if (!district) return null;
  const d = district.trim();
  if (!d || d === "GPS yo‘q" || d === "Noma’lum hudud") return null;
  if (TASHKENT_DISTRICT_NAMES.has(d)) return "toshkent_shahar";
  const slug = slugifyViloyatLabel(d);
  if (LABEL_BY_SLUG.has(slug)) return slug;
  for (const opt of VILOYAT_OPTIONS) {
    if (opt.label === d || slugifyViloyatLabel(opt.label) === slug) return opt.slug;
  }
  return null;
}

export function branchViloyatSlug(lat?: number | null, lng?: number | null): string | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return districtToViloyatSlug(districtFromGps(lat, lng));
}
