import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_SYSTEM_PROMPT } from "./agent-system-prompt";

const KB_FILES = [
  "PLATFORM.md",
  "docs/admin-platforma.md",
  "docs/FACE-ID-IMPLEMENTATION.md",
  "docs/ATTENDANCE-SHIFTS.md",
  "TELEGRAM.md",
] as const;

const LIVE_FACTS = `
## Hozirgi texnik faktlar
- Kirish: https://vaksinahr.uz | @vaksinahrbot — boshqa ilova YO‘Q
- Geofence: filial 30m · ofis 100m · checklist 70m
- Davomat: Face ID / QR / barmoq — FAQAT o‘qish; AI yozmaydi
- Vazifa havolasi: /vazifalar?task={id}
- Ish vaqti (Toshkent): 09:00–18:00
`.trim();

let cachedKb: string | null = null;

function resolveKbPath(rel: string): string | null {
  const candidates = [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), "..", rel),
    resolve(process.cwd(), "../..", rel),
    resolve(process.cwd(), "../../..", rel),
    resolve("/opt/hr_ai", rel),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadAgentSystemPrompt(): string {
  return (AGENT_SYSTEM_PROMPT || "").trim();
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
  cachedKb = parts.join("\n").slice(0, 100_000);
  return cachedKb;
}

export function buildHelpSystemPrompt(opts: {
  role?: string;
  fullName?: string;
  detailed?: boolean;
  tashkentHour?: number;
  afterHours?: boolean;
  personalContext?: string | null;
  accountLinked?: boolean;
}): string {
  const kb = loadPlatformHelpKnowledge();
  const agentPrompt = loadAgentSystemPrompt();
  const hour =
    typeof opts.tashkentHour === "number" && Number.isFinite(opts.tashkentHour)
      ? opts.tashkentHour
      : null;
  const personal = (opts.personalContext || "").trim();

  return [
    agentPrompt,
    "",
    "=== OPERATSION QOIDALAR ===",
    "Sen AI Saydman — READ-ONLY chat assistentsan: o‘qish, tahlil, maslahat, suhbat.",
    "HAR QANDAY xabarga javob ber. Tabiiy suhbatlash.",
    "YARATISH/TAHRIRLASH/O‘CHIRISH YO‘Q: vazifa, davomat, KPI, baho, oylik, checklist, smena.",
    "O‘zgartirish so‘ralsa: faqat o‘qish rejimida ekaningni ayt + platformada qanday qilishni tushuntir.",
    "«Platformaga boring» deb har safar undama; faqat amal uchun kerak bo‘lsa qisqa yo‘l-yo‘riq.",
    "Javob: 2–8 qator, o‘zbekcha, odamdek. Fakt/taxmin/tavsiyani farqla.",
    "Isming: AI Saydman. ChatGPT dema. Saidmuhammadalixonni keraksiz aytma.",
    "@saidmuhammadalixon_hr ATMETKA qilma.",
    "Yechilmasa [ESCALATE]. Maxfiylik: vakolatsiz boshqa odam ma’lumotini bermа.",
    "Davomat: holat so‘ralsa o‘qi; muammo bo‘lsa diagnostika; Keldim/Ketdim YOZMA.",
    "Smena/rotatsiya/ko‘chirish: o‘zgartirma; koordinator HR ga asos bilan chiqishini ayt.",
    hour != null ? `Toshkent soati: ${String(hour).padStart(2, "0")}:xx` : "",
    opts.afterHours ? "18:00 dan keyin: o‘zing javob ber." : "",
    opts.fullName || opts.role ? `Kim: ${opts.fullName || "xodim"} (${opts.role || "—"})` : "",
    opts.accountLinked === false
      ? "Akkaunt ulanmagan — shaxsiy ma’lumot BERMA; login+parol bilan ulashni ayt."
      : "",
    "",
    personal ? `=== SHAXSIY JONLI BAZA ===\n${personal}` : "",
    "",
    opts.detailed ? "=== BILIM BAZASI ===" : "=== BILIM BAZASI (qisqa) ===",
    kb.slice(0, opts.detailed ? 55_000 : 35_000),
  ]
    .filter(Boolean)
    .join("\n");
}
