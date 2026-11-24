/**
 * Kun yopilganda — smena / Ketdim muddati izohi (Gemini + aniq fallback).
 */
import { logger } from "./logger";

export type ClosedExplainFacts = {
  workDate: string;
  shiftLabel: string;
  shiftStart: string;
  shiftEnd: string;
  deadlineHm: string;
  deadlineHint: string;
  checkIn: string | null;
  checkOut: string | null;
  missingCheckout: boolean;
  status?: string | null;
  overnight?: boolean;
};

function geminiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim() || null;
}

function geminiModel(): string {
  return (
    process.env.GEMINI_CLOSED_EXPLAIN_MODEL?.trim() ||
    process.env.GEMINI_HR_MODEL?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    "gemini-flash-lite-latest"
  );
}

/** Aniq, mobilga mos fallback — Gemini ishlamasa ham to‘g‘ri */
export function buildClosedExplainFallback(f: ClosedExplainFacts): {
  title: string;
  body: string;
  bullets: string[];
  rules: string[];
} {
  const shiftName = f.shiftLabel || "Smena";
  const inHm = f.checkIn && f.checkIn !== "—" ? f.checkIn : null;
  const outHm = f.checkOut && f.checkOut !== "—" ? f.checkOut : null;
  const title = f.missingCheckout ? "Nega bugun yopildi?" : "Bugungi davomat yakunlandi";

  const body = f.missingCheckout
    ? `${shiftName}: ish vaqti ${f.shiftStart}–${f.shiftEnd}. ` +
      `«Ketdim»ni ${f.deadlineHm} gacha bosish shart edi` +
      (inHm ? ` (siz ${inHm} da keldingiz)` : "") +
      `, lekin bosilmadi — shuning uchun kun avtomatik yopildi.`
    : `${shiftName} (${f.shiftStart}–${f.shiftEnd}) yakunlandi` +
      (inHm && outHm ? `: kelish ${inHm}, ketish ${outHm}.` : ".");

  const bullets = [
    `${shiftName}: ${f.shiftStart}–${f.shiftEnd}`,
    `Ketdim muddati: ${f.deadlineHm}`,
    `Keldim ${inHm || "—"} · Ketdim ${outHm || "bosilmadi"}`,
  ];

  /** Faqat o‘z smenasi — barcha smenalar ro‘yxati chiqarilmaydi */
  const rules: string[] = [];

  return { title, body, bullets, rules };
}

async function callGeminiClosedExplain(f: ClosedExplainFacts): Promise<string | null> {
  const key = geminiKey();
  if (!key) return null;
  const fb = buildClosedExplainFallback(f);
  const prompt =
    "Sen VAKSINA HR davomat yordamchisisan. O‘zbekcha, juda qisqa (2–3 jumla), aniq soatlar. " +
    "Faqat SHU xodimning smenasi haqida yoz — boshqa smenalarni sanama. " +
    "Faktlarni o‘zgartirma. Nima bo‘ldi va nima qilish kerakligini sodda ayting.\n\n" +
    `Faktlar (JSON):\n${JSON.stringify(f)}\n\n` +
    `Asos:\n${fb.body}\n` +
    "Javob: faqat yakuniy matn.";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const model = geminiModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 320 },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`gemini_http_${res.status}:${errText.slice(0, 120)}`);
    }
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || "";
    if (text.length < 40) return null;
    return text.slice(0, 900);
  } catch (err) {
    logger.warn(
      { event: "davomat_closed_explain_gemini", err: err instanceof Error ? err.message : "error" },
      "closed explain gemini failed",
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function explainClosedDay(f: ClosedExplainFacts): Promise<{
  title: string;
  body: string;
  bullets: string[];
  rules: string[];
  source: "gemini" | "rules";
}> {
  const fb = buildClosedExplainFallback(f);
  const ai = await callGeminiClosedExplain(f);
  if (ai) {
    return { ...fb, body: ai, source: "gemini" };
  }
  return { ...fb, source: "rules" };
}
