/**
 * O‘zbek lotin va kirill yozuvini bitta kalitga tushiradi.
 * «Aliyev» va «Алиев», «O‘zbek» va «Ўзбек» bir xil qidiruvda chiqadi.
 */
const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
  ў: "o", ғ: "g", қ: "q", ҳ: "h",
};

export function foldScript(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/[\u2018\u2019\u02BB\u02BC\u0060\u00B4\u02BE\u02BF']/g, "'");
  s = s.replace(/g'/g, "g").replace(/o'/g, "o");
  let out = "";
  for (const ch of s) out += CYR_TO_LAT[ch] ?? ch;
  out = out.replace(/([aeiou])y([aeiou])/g, "$1$2");
  out = out.replace(/ye/g, "e");
  out = out.replace(/x/g, "h");
  // Ruscha yozuvda o‘zbekcha «q» ko‘pincha «к»: «Samarqand» = «Самарканд»
  out = out.replace(/q/g, "k");
  return out.replace(/[^a-z0-9]+/g, "");
}

/** Har bir so‘z lotin yoki kirillda yozilgan bo‘lishi mumkin. */
export function scriptIncludes(haystack: string, query: string): boolean {
  const words = query
    .trim()
    .split(/\s+/)
    .map(foldScript)
    .filter((w) => w.length > 0);
  if (!words.length) return true;
  const hay = foldScript(haystack);
  return words.every((w) => hay.includes(w));
}

/**
 * Ko‘rinadigan tarjima: kirill → o‘zbek lotin (PDF va chop etish uchun).
 * «Аския» → «Askiya», «ЮНУСОБОД-7» → «Yunusobod-7», «ДАРХОН» → «Darxon».
 */
const CYR_TO_UZ_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "j",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "x",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sh",
  ъ: "",
  ы: "i",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  ў: "oʻ",
  ғ: "gʻ",
  қ: "q",
  ҳ: "h",
};

export function toUzbekLatin(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  let out = "";
  for (const ch of raw) {
    const lower = ch.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CYR_TO_UZ_LATIN, lower)) {
      out += CYR_TO_UZ_LATIN[lower];
    } else {
      out += ch;
    }
  }
  // Allaqachon lotin bo‘lsa: o'/g' → oʻ/gʻ
  out = out.replace(/[oO][''`ʹʻʼ]/g, "oʻ").replace(/[gG][''`ʹʻʼ]/g, "gʻ");
  return out;
}

/** PDF uchun: to‘liq o‘zbek lotin + BOSH HARFLAR */
export function toUzbekLatinUpper(input: string): string {
  const latin = toUzbekLatin(input);
  return latin
    .replace(/oʻ/g, "\u0001")
    .replace(/gʻ/g, "\u0002")
    .toLocaleUpperCase("en-US")
    .replace(/\u0001/g, "Oʻ")
    .replace(/\u0002/g, "Gʻ");
}
