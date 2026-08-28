function capitalizeWord(word: string): string {
  if (!word) return word;
  const lower = word.toLocaleLowerCase("uz-UZ");
  return lower.charAt(0).toLocaleUpperCase("uz-UZ") + lower.slice(1);
}

/** Ism-familiya: har bir so‘zning faqat bosh harfi katta. */
export function formatPersonName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = String(name).trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  return trimmed
    .split(/(\s+)/)
    .map((segment) => {
      if (/^\s+$/.test(segment)) return segment;
      return segment
        .split(/(['\u2019-])/)
        .map((part) => {
          if (part === "'" || part === "\u2019" || part === "-") return part;
          return capitalizeWord(part);
        })
        .join("");
    })
    .join("");
}
