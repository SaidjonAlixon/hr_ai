const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "s", ч: "ch", ш: "sh",
  ъ: "", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

/** Krill va lotin bir xil: «Uch» = «Уч», «Yunusobod» = «Юнусобод». */
export function foldScript(raw: string): string {
  const s = raw.toLowerCase().replace(/[ʻʼ’'`‘]/g, "");
  let out = "";
  for (const ch of s) out += CYR_TO_LAT[ch] ?? ch;
  return out.replace(/[^a-z0-9]/g, "");
}
