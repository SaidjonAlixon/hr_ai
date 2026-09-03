import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const KB_FILES = ["PLATFORM.md", "docs/FACE-ID-IMPLEMENTATION.md", "TELEGRAM.md"] as const;

/** Qo‘shimcha aniq faktlar (hujjatda yangilanmagan bo‘lishi mumkin) */
const LIVE_FACTS = `
## Hozirgi texnik faktlar (kod holati)
- Filial davomat / Face ID geofence: **70 metr**
- Ofis geofence: **100 metr**
- Checklist / audit geofence: **70 metr**
- Face ID: brauzerda face-api.js embedding + serverda lokal match; OpenAI ixtiyoriy
- Telegram yordam: @saidmuhammadalixon_hr (https://t.me/saidmuhammadalixon_hr), telefon: +998 70 174 37 22
- Yordam chat-bot faqat platforma hujjatlari asosida javob beradi; shaxsiy ma’lumot / boshqa mavzu emas
`.trim();

let cachedKb: string | null = null;

function resolveKbPath(rel: string): string | null {
  const candidates = [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), "../..", rel),
    resolve(process.cwd(), "../../..", rel),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadPlatformHelpKnowledge(): string {
  if (cachedKb) return cachedKb;
  const parts: string[] = [LIVE_FACTS];
  for (const rel of KB_FILES) {
    const path = resolveKbPath(rel);
    if (!path) continue;
    try {
      const text = readFileSync(path, "utf8").trim();
      if (text) parts.push(`\n\n===== ${rel} =====\n${text}`);
    } catch {
      /* ignore */
    }
  }
  cachedKb = parts.join("\n").slice(0, 120_000);
  return cachedKb;
}

export function buildHelpSystemPrompt(opts: {
  role?: string;
  fullName?: string;
}): string {
  const kb = loadPlatformHelpKnowledge();
  return [
    "Siz VAKSINA MED HR platformasining ichki yordamchi chat-botisiz.",
    "Faqat quyidagi BILIM BAZASI asosida javob bering. Taxmin qilmang.",
    "Agar savol platformaga tegishli bo‘lmasa yoki bazada yo‘q bo‘lsa, aniq ayting: «Bu haqda platforma hujjatida ma’lumot yo‘q» va bog‘lanishni taklif qiling: Telegram @saidmuhammadalixon_hr yoki telefon +998 70 174 37 22",
    "Javoblar o‘zbek tilida, qisqa va aniq. Menyular, rollar, davomat, Face ID, oylik, hisob-kitob, apteka tarmog‘i haqida yordam bering.",
    "Parol, maxfiy kalit, boshqa foydalanuvchi shaxsiy ma’lumotini so‘ramang va uydirmang.",
    opts.fullName || opts.role
      ? `Foydalanuvchi: ${opts.fullName || "—"}, rol: ${opts.role || "—"}.`
      : "",
    "",
    "=== BILIM BAZASI ===",
    kb,
  ]
    .filter(Boolean)
    .join("\n");
}
