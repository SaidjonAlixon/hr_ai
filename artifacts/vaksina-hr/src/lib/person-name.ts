import { toUzbekLatin } from "./script-search";

function capitalizeWord(word: string): string {
  if (!word) return word;
  // oʻ / gʻ bilan boshlangan so‘zlar
  const soft = word.match(/^(oʻ|gʻ)(.*)$/i);
  if (soft) {
    const prefix = soft[1]!.toLocaleLowerCase("uz-UZ").replace(/^o/, "O").replace(/^g/, "G");
    const rest = soft[2] || "";
    return prefix + rest.toLocaleLowerCase("uz-UZ");
  }
  const lower = word.toLocaleLowerCase("uz-UZ");
  return lower.charAt(0).toLocaleUpperCase("uz-UZ") + lower.slice(1);
}

/** Ism-familiya: o‘zbek lotin + har bir so‘zning bosh harfi katta. */
export function formatPersonName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = toUzbekLatin(String(name)).trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  return trimmed
    .split(/(\s+)/)
    .map((segment) => {
      if (/^\s+$/.test(segment)) return segment;
      return segment
        .split(/(['\u2019\u02BB\u02BCʻʼ-])/)
        .map((part) => {
          if (/^['\u2019\u02BB\u02BCʻʼ-]$/.test(part)) return part;
          return capitalizeWord(part);
        })
        .join("");
    })
    .join("");
}
