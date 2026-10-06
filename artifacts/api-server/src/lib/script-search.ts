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
