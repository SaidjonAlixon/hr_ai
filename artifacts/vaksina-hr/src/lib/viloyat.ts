/** Regional menejer — viloyat tanlash (API bilan bir xil slug lar) */

export type ViloyatOption = { slug: string; label: string };

export const VILOYAT_OPTIONS: ViloyatOption[] = [
  { slug: "toshkent_shahar", label: "Toshkent shahar" },
  { slug: "toshkent_viloyati", label: "Toshkent viloyati" },
  { slug: "samarqand", label: "Samarqand" },
  { slug: "buxoro", label: "Buxoro" },
  { slug: "andijon", label: "Andijon" },
  { slug: "fargona", label: "Farg‘ona" },
  { slug: "namangan", label: "Namangan" },
  { slug: "qashqadaryo", label: "Qashqadaryo" },
  { slug: "surxondaryo", label: "Surxondaryo" },
  { slug: "xorazm", label: "Xorazm" },
  { slug: "navoiy", label: "Navoiy" },
  { slug: "jizzax", label: "Jizzax" },
  { slug: "sirdaryo", label: "Sirdaryo" },
  { slug: "qoraqalpogiston", label: "Qoraqalpog‘iston" },
];

export function viloyatLabel(slug?: string | null): string {
  if (!slug) return "—";
  return VILOYAT_OPTIONS.find((v) => v.slug === slug)?.label || slug;
}

export function isRegionalManagerRole(role?: string | null): boolean {
  return (role ?? "").trim().toLowerCase() === "regional_menejer";
}
