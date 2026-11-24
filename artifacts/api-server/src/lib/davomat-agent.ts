/**
 * Davomat agent-chat — platforma + DB (oxirgi 10 kun) asosida.
 * READ-ONLY. HR — faqat eng oxirgi chora.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { desc, eq } from "drizzle-orm";
import { db, attendanceRecordsTable, employeesTable } from "@workspace/db";
import { logger } from "./logger";
import {
  CHECKOUT_DEADLINE_HM,
  CHECKOUT_DEADLINE_SHIFT_THREE_HM,
  CHECKOUT_DEADLINE_SHIFT_TWO_HM,
  checkoutDeadlineHint,
} from "./shift-hours";

export type DavomatAgentContext = {
  fullName?: string | null;
  role?: string | null;
  workDate?: string | null;
  shiftLabel?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  shiftType?: string | null;
  overnight?: boolean;
  deadlineHm?: string | null;
  deadlineHint?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  nextAction?: string | null;
  status?: string | null;
  workplaceTitle?: string | null;
  done?: boolean;
  missingCheckout?: boolean;
};

export type DayPunchRow = {
  date: string;
  checkIn: string;
  checkOut: string;
  status: string;
};

function geminiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim() || null;
}

function geminiModel(): string {
  return (
    process.env.GEMINI_DAVOMAT_AGENT_MODEL?.trim() ||
    process.env.GEMINI_HR_MODEL?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    "gemini-flash-lite-latest"
  );
}

function loadSmenaGuide(): string {
  const candidates = [
    resolve(process.cwd(), "docs/VAKSINA_DAVOMAT_SMENA_QOLLANMA.md"),
    resolve(process.cwd(), "../docs/VAKSINA_DAVOMAT_SMENA_QOLLANMA.md"),
    resolve("/opt/hr_ai/docs/VAKSINA_DAVOMAT_SMENA_QOLLANMA.md"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) return readFileSync(p, "utf8").slice(0, 40_000);
    } catch {
      /* ignore */
    }
  }
  return "";
}

function hmTashkent(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function statusUz(s: string): string {
  const t = String(s || "").toLowerCase();
  if (t === "present") return "kelgan";
  if (t === "late") return "kechikkan";
  if (t === "absent") return "kelmagan/yopilgan";
  if (t === "leave") return "ta’til/ruxsat";
  if (t === "rest") return "dam";
  return t || "—";
}

/** Oxirgi N kun davomat — bazadan */
export async function loadRecentAttendanceDays(
  userId: number,
  limit = 10,
): Promise<DayPunchRow[]> {
  if (!userId || userId <= 0) return [];
  try {
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, userId))
      .limit(1);
    if (!emp?.id) return [];
    const rows = await db
      .select({
        workDate: attendanceRecordsTable.workDate,
        checkInAt: attendanceRecordsTable.checkInAt,
        checkOutAt: attendanceRecordsTable.checkOutAt,
        status: attendanceRecordsTable.status,
      })
      .from(attendanceRecordsTable)
      .where(eq(attendanceRecordsTable.employeeId, emp.id))
      .orderBy(desc(attendanceRecordsTable.workDate))
      .limit(Math.max(1, Math.min(31, limit)));
    return rows.map((r) => ({
      date: r.workDate,
      checkIn: hmTashkent(r.checkInAt),
      checkOut: hmTashkent(r.checkOutAt),
      status: String(r.status || ""),
    }));
  } catch (err) {
    logger.warn(
      { event: "davomat_agent_history", err: err instanceof Error ? err.message : "error" },
      "load recent attendance failed",
    );
    return [];
  }
}

function formatHistory(days: DayPunchRow[]): string {
  if (!days.length) return "Oxirgi 10 kun: yozuv yo‘q.";
  return (
    "Oxirgi kunlar (baza):\n" +
    days
      .map(
        (d) =>
          `· ${d.date}: Keldim ${d.checkIn}, Ketdim ${d.checkOut} — ${statusUz(d.status)}`,
      )
      .join("\n")
  );
}

function contextBlock(ctx: DavomatAgentContext, days: DayPunchRow[]): string {
  const lines = [
    `Xodim: ${ctx.fullName || "—"}`,
    `Rol: ${ctx.role || "—"}`,
    `Ish joyi: ${ctx.workplaceTitle || "—"}`,
    `Bugun: ${ctx.workDate || "—"}`,
    `Smena: ${ctx.shiftLabel || "—"} · ${ctx.shiftStart || "—"}–${ctx.shiftEnd || "—"}`,
    `Ketdim muddati: ${ctx.deadlineHm || CHECKOUT_DEADLINE_HM}`,
    `Hint: ${ctx.deadlineHint || checkoutDeadlineHint({ shiftType: ctx.shiftType, overnight: ctx.overnight })}`,
    `Bugun Keldim: ${ctx.checkIn || "—"} · Ketdim: ${ctx.checkOut || "—"}`,
    `Holat: next=${ctx.nextAction || "—"} status=${ctx.status || "—"} done=${Boolean(ctx.done)} missingCheckout=${Boolean(ctx.missingCheckout)}`,
    formatHistory(days),
  ];
  return lines.join("\n");
}

const CORE_RULES = `
QAT’IY REJIM — FAQAT O‘QISH:
- Sen HECH NARSANI o‘zgartirmaysan: davomat yozma, tuzatma, o‘chirma, vaqtni almashtirma.
- Faqat BAZADAN ko‘r va aniq javob ber (Keldim/Ketdim/status/sanalar).
- Taxmin qilma. Bazada yo‘q bo‘lsa: «Bazada bu kun uchun yozuv yo‘q» de.
- Platforma qoidalari faqat tushuntirish uchun (yozish emas).
- 1-smena 08:00–17:00 Ketdim≤${CHECKOUT_DEADLINE_HM} · 2-smena 17:00–23:59 Ketdim≤ertasi ${CHECKOUT_DEADLINE_SHIFT_TWO_HM} · 3-smena 23:00–07:00 Ketdim≤${CHECKOUT_DEADLINE_SHIFT_THREE_HM} · Ofis 09:00–18:00 Ketdim≤${CHECKOUT_DEADLINE_HM}
- Ketdim muddatida bo‘lmasa: kun yopiladi, Keldim ish kuni sifatida inobatga olinmaydi, jarima xavfi — OGOHLANTIR.
- «HR tekshirib tuzatadi» — FAQAT oxirgi chora (foydalanuvchi tuzatish so‘rasa yoki baza yetmasa).
`.trim();

function findDay(days: DayPunchRow[], hint: string): DayPunchRow | null {
  const q = hint.toLowerCase();
  if (!days.length) return null;
  if (/kecha|kechagi|вчера/.test(q) && days.length >= 2) {
    // days[0] often today; yesterday = next different date or days[1]
    const today = days[0]!;
    const y = days.find((d) => d.date !== today.date);
    return y || days[1] || null;
  }
  const m = q.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return days.find((d) => d.date === m[1]) || null;
  const dm = q.match(/(\d{1,2})[./-](\d{1,2})/);
  if (dm) {
    const dd = dm[1]!.padStart(2, "0");
    const mm = dm[2]!.padStart(2, "0");
    return days.find((d) => d.date.slice(5) === `${mm}-${dd}` || d.date.endsWith(`-${mm}-${dd}`)) || null;
  }
  return null;
}

function ruleBasedReply(
  question: string,
  ctx: DavomatAgentContext,
  days: DayPunchRow[],
): string | null {
  const q = question.toLowerCase();
  const shift = ctx.shiftLabel || "Smena";
  const start = ctx.shiftStart || "—";
  const end = ctx.shiftEnd || "—";
  const deadline = ctx.deadlineHm || CHECKOUT_DEADLINE_HM;

  const ketdimWarn =
    `Diqqat: «Ketdim»ni ${deadline} gacha bosmasangiz kun yopiladi — ` +
    `shu kungi Keldim ish kuni sifatida inobatga olinmaydi va jarimaga sabab bo‘lishi mumkin.`;

  if (/bosmas|bosmasam|bosmasdan|ketdim.*yo.?q|yopilsa|nima\s*bo.?ladi/.test(q)) {
    return (
      `${ketdimWarn}\n` +
      `Sizniki: ${shift} ${start}–${end}. Ideal: smena tugagach Ketdim, lekin kechiqsa ham ${deadline} gacha yetkazing.`
    );
  }

  if (/kecha|kechagi|oxirgi|tarix|10\s*kun|o.?tgan|statistika|necha\s*marta|qachon\s*kel/.test(q) || findDay(days, q)) {
    const one = findDay(days, q);
    if (one) {
      return (
        `${one.date}: Keldim ${one.checkIn}, Ketdim ${one.checkOut} — ${statusUz(one.status)}.\n` +
        (one.status === "absent" && one.checkIn !== "—" && one.checkOut === "—"
          ? "Ketdim bo‘lmagani uchun kun «kelmagan/yopilgan» — Keldim ish kuni sifatida hisoblanmagan, jarima xavfi bor."
          : "") +
        (days.length > 1 ? `\n\n${formatHistory(days.slice(0, 10))}` : "")
      ).trim();
    }
    if (days.length) {
      return `${formatHistory(days.slice(0, 10))}\n\nAniq sana yozsangiz (masalan 2026-03-22) shu kunni ochib beraman.`;
    }
    return "Bazada oxirgi kunlar uchun yozuv topilmadi. Agar platformada ko‘rinsa, sahifani yangilang.";
  }

  if (/smena|ish\s*vaqt|qachon\s*kel|qachon\s*ket|muddat|ketdim|keldim/.test(q)) {
    return (
      `Sizning smenangiz: ${shift} (${start}–${end}).\n` +
      `Keldim ≈ ${start} (15 daqiqadan keyin kechikish).\n` +
      `Ketdim: smena tugagach, oxirgi muddat ${deadline}.\n` +
      ketdimWarn
    );
  }

  if (/face\s*id|yuz|kamera|qr|barmoq/.test(q)) {
    return (
      `Davomat tartibi: 1) GPS + yashil hudud 2) Face ID yoki QR 3) «Keldim»/«Ketdim».\n` +
      `Face ID ulanmagan bo‘lsa avval yuzni ro‘yxatdan o‘tkazing. Kamera ochilmasa Telegram/brauzerda kamera ruxsatini bering.`
    );
  }

  if (/kechik|kech\s*qol|jarima|shtraf/.test(q)) {
    return (
      `Kechikish: ${start} dan 15 daqiqadan keyin Keldim.\n` +
      `Davomat (Keldim/Ketdim) qilmasangiz shu kun jarimaga sabab bo‘lishi mumkin.\n` +
      ketdimWarn
    );
  }

  if (/yopil|bugun\s*yop|nima\s*bo.?ldi|nega/.test(q)) {
    if (ctx.missingCheckout || (ctx.done && (!ctx.checkOut || ctx.checkOut === "—"))) {
      return (
        `${shift} uchun «Ketdim» ${deadline} gacha bosilmagani uchun kun yopildi` +
        (ctx.checkIn ? ` (Keldim ${ctx.checkIn} saqlangan, lekin` : " (") +
        ` ish kuni sifatida inobatga olinmaydi — jarima xavfi).\n` +
        `Keyingi smenada yana «Keldim» dan boshlang.`
      );
    }
    if (ctx.done) {
      return `Bugun yakunlandi: Keldim ${ctx.checkIn || "—"}, Ketdim ${ctx.checkOut || "—"}. ${shift}: ${start}–${end}.`;
    }
  }

  if (/gps|hudud|zona|filial|ofis/.test(q)) {
    return `Davomat faqat yashil hududda: filial ~30 m, ofis ~100 m. GPS yoqing, «Ruxsat etilgan hudud» chiqsin, so‘ng Face ID/QR.`;
  }

  if (/hr|admin|tuzat|o.?zgartir|vaqtni\s*to.?g/.test(q)) {
    return (
      `Avval o‘zingiz: GPS → Face ID/QR → Keldim/Ketdim (${deadline} gacha).\n` +
      `Vaqtni chatdan o‘zgartirib bo‘lmaydi. Agar baza xato ko‘rsatayotganini aniq bilsangiz — eng oxirgi chorada HR tekshirib tuzatadi.`
    );
  }

  return null;
}

async function callGeminiAgent(
  question: string,
  ctx: DavomatAgentContext,
  days: DayPunchRow[],
  history: Array<{ role: "user" | "assistant"; text: string }>,
): Promise<string | null> {
  const key = geminiKey();
  if (!key) return null;
  const guide = loadSmenaGuide();
  const hist = history
    .slice(-8)
    .map((h) => `${h.role === "user" ? "Xodim" : "Agent"}: ${h.text}`)
    .join("\n");
  const system =
    "Sen VAKSINA HR davomat agenti. O‘zbekcha, sodda, aniq soat/sana. " +
    "FAQAT BAZANI KO‘R VA JAVOB BER — hech narsani to‘g‘rilama, yozma, o‘zgartirma. " +
    "Javob = baza (oxirgi kunlar) + shu smena faktlari. Yo‘q bo‘lsa «bazada yo‘q» de. " +
    "Ketdim bosilmasa ogohlantir (kun yopiladi, Keldim inobatga olinmaydi, jarima xavfi). " +
    "HR — faqat oxirgi chora. 2–7 qisqa jumla.\n\n" +
    CORE_RULES +
    "\n\n=== XODIM + BAZA ===\n" +
    contextBlock(ctx, days) +
    (guide ? `\n\n=== QO‘LLANMA ===\n${guide.slice(0, 10_000)}` : "");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  try {
    const model = geminiModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  (hist ? `Oldingi suhbat:\n${hist}\n\n` : "") + `Savol: ${question}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 520 },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`gemini_http_${res.status}:${errText.slice(0, 120)}`);
    }
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() || "";
    if (text.length < 20) return null;
    return text.slice(0, 1400);
  } catch (err) {
    logger.warn(
      { event: "davomat_agent_gemini", err: err instanceof Error ? err.message : "error" },
      "davomat agent gemini failed",
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function answerDavomatAgent(opts: {
  message: string;
  context: DavomatAgentContext;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  userId?: number;
}): Promise<{ reply: string; source: "gemini" | "rules" }> {
  const msg = String(opts.message || "").trim().slice(0, 1000);
  const days = opts.userId ? await loadRecentAttendanceDays(opts.userId, 10) : [];
  if (!msg) {
    return {
      reply: "Savolingizni yozing — smena, Face ID, GPS, oxirgi kunlar yoki Ketdim haqida tushuntiraman.",
      source: "rules",
    };
  }

  // Tarix / kecha savollari — avval baza (aniq)
  if (/kecha|kechagi|oxirgi|tarix|10\s*kun|\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}/.test(msg.toLowerCase())) {
    const rbHist = ruleBasedReply(msg, opts.context, days);
    if (rbHist) return { reply: rbHist, source: "rules" };
  }

  const ai = await callGeminiAgent(msg, opts.context, days, opts.history || []);
  if (ai) return { reply: ai, source: "gemini" };
  const rb = ruleBasedReply(msg, opts.context, days);
  if (rb) return { reply: rb, source: "rules" };
  return {
    reply:
      `Sizniki: ${opts.context.shiftLabel || "—"} ` +
      `(${opts.context.shiftStart || "—"}–${opts.context.shiftEnd || "—"}), ` +
      `Ketdim ≤ ${opts.context.deadlineHm || CHECKOUT_DEADLINE_HM}. ` +
      `Ketdim bosilmasa kun yopiladi — Keldim ish kuni sifatida inobatga olinmaydi, jarima xavfi. ` +
      `Aniqroq yozing (masalan «kecha» yoki sana).`,
    source: "rules",
  };
}

export function davomatAgentGreeting(ctx: DavomatAgentContext, days: DayPunchRow[] = []): string {
  const shift = ctx.shiftLabel || "Smena";
  const start = ctx.shiftStart || "—";
  const end = ctx.shiftEnd || "—";
  const deadline = ctx.deadlineHm || CHECKOUT_DEADLINE_HM;
  const warn =
    `Ketdimni ${deadline} gacha bosmasangiz kun yopiladi — Keldim ish kuni sifatida inobatga olinmaydi va jarimaga sabab bo‘lishi mumkin.`;

  if (ctx.missingCheckout) {
    return (
      `Salom${ctx.fullName ? `, ${String(ctx.fullName).split(" ")[0]}` : ""}. ` +
      `${shift} (${start}–${end}): Ketdim ${deadline} gacha bo‘lmagani uchun kun yopilgan. ` +
      `Keldim ish kuni sifatida hisoblanmagan — jarima xavfi. Savol yozing.`
    );
  }
  if (ctx.done) {
    return (
      `Bugun: Keldim ${ctx.checkIn || "—"}, Ketdim ${ctx.checkOut || "—"}. ` +
      `${shift} ${start}–${end}. ` +
      (days[1]
        ? `Kecha: ${days[1].date} · ${days[1].checkIn}–${days[1].checkOut}. `
        : "") +
      `Smena, Face ID yoki oxirgi kunlar haqida so‘rang.`
    );
  }
  return (
    `Davomat agenti. Sizniki: ${shift} ${start}–${end}. ${warn} ` +
    `Oxirgi kunlar, Face ID, GPS — so‘rang.`
  );
}
