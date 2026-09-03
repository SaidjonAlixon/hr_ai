import { Router, type IRouter } from "express";
import { optionalAuth, type AuthRequest } from "../middlewares/auth";
import {
  faqAnswer,
  faqCatalogForAi,
  faqLinksForLocale,
  findFaqById,
  HELP_FAQS,
  matchHelpFaq,
  resolveLocale,
  type HelpFaq,
  type HelpLocale,
} from "../lib/help-faq";

const router: IRouter = Router();

const TELEGRAM_HELP = "@saidmuhammadalixon_hr";
const TELEGRAM_HELP_URL = "https://t.me/saidmuhammadalixon_hr";
const SUPPORT_PHONE = "+998 70 174 37 22";
const HELP_MODEL = process.env.OPENAI_HELP_MODEL?.trim() || "gpt-4o-mini";
const HELP_TIMEOUT_MS = Number(process.env.HELP_AI_TIMEOUT_MS || 20000);
const HELP_AI_ENABLED = process.env.HELP_AI !== "0" && process.env.HELP_AI !== "false";
const MAX_IMAGE_CHARS = 1_800_000;

const recentByKey = new Map<string, number[]>();

function clientKey(req: AuthRequest): string {
  if (req.userId) return `u:${req.userId}`;
  const xf = req.headers["x-forwarded-for"];
  const ip =
    (typeof xf === "string" ? xf.split(",")[0]?.trim() : undefined) ||
    req.socket.remoteAddress ||
    "anon";
  return `ip:${ip}`;
}

function rateLimited(req: AuthRequest): boolean {
  const key = clientKey(req);
  const now = Date.now();
  const windowMs = 60_000;
  const max = req.userId ? 30 : 15;
  const prev = (recentByKey.get(key) || []).filter((t) => now - t < windowMs);
  if (prev.length >= max) {
    recentByKey.set(key, prev);
    return true;
  }
  prev.push(now);
  recentByKey.set(key, prev);
  return false;
}

function localeFromReq(req: AuthRequest): HelpLocale {
  const bodyLoc = typeof req.body?.locale === "string" ? req.body.locale : "";
  const header = String(req.headers["accept-language"] || "");
  return resolveLocale(bodyLoc || header);
}

function faqReplyPayload(faq: HelpFaq, source: string, locale: HelpLocale) {
  const links = faqLinksForLocale(faq, locale);
  return {
    reply: faqAnswer(faq, locale),
    source,
    faqId: faq.id,
    showContacts: false,
    links: links?.length ? links : undefined,
    locale,
  };
}

function contactsReply(locale: HelpLocale) {
  return locale === "ru" ? "Для помощи" : "Yordam uchun";
}

function contactsPayload(locale: HelpLocale) {
  return {
    reply: contactsReply(locale),
    source: "contacts",
    showContacts: true as const,
    phone: SUPPORT_PHONE,
    telegram: TELEGRAM_HELP,
    telegramUrl: TELEGRAM_HELP_URL,
    locale,
  };
}

function looksLikeUiError(question: string): boolean {
  const q = question.toLowerCase();
  return /xato|error|ishlamay|ochilmay|ko.?rinmay|qotib|crash|bug|ekran|screenshot|skrin|rasm|yuklanmay|403|404|500|failed|rad et|tanima|blok|timeout|spinner|yuklanmoqda|ошибк|не работ/.test(
    q,
  );
}

function looksUnsatisfied(question: string): boolean {
  const q = question.toLowerCase();
  return /hal bo.?lmadi|yordam bermadi|tushunmadim|noto.?g.?ri|qoniqmadim|yana savol|bog.?lan|murojaat|telefon|admin kerak|odam kerak|не помог|не понял|связ|человек/.test(
    q,
  );
}

function normalizeImageDataUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s.startsWith("data:image/")) return null;
  if (s.length > MAX_IMAGE_CHARS) return null;
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(s)) return null;
  return s;
}

async function openaiJson(opts: {
  messages: Array<Record<string, unknown>>;
  maxTokens: number;
}): Promise<Record<string, unknown> | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || !HELP_AI_ENABLED) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HELP_TIMEOUT_MS);
  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: HELP_MODEL,
        temperature: 0.2,
        max_tokens: opts.maxTokens,
        response_format: { type: "json_object" },
        messages: opts.messages,
      }),
    });
    if (!aiRes.ok) return null;
    const body = (await aiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function pickFaqIdWithCheapAi(question: string, locale: HelpLocale): Promise<string | null> {
  const catalog = faqCatalogForAi(locale);
  const parsed = await openaiJson({
    maxTokens: 40,
    messages: [
      {
        role: "system",
        content:
          'You only pick FAQ id. Return JSON: {"id":"faq_id_or_null"}. No other text.',
      },
      { role: "user", content: `Q: ${question}\n\nCatalog:\n${catalog}` },
    ],
  });
  const id = typeof parsed?.id === "string" ? parsed.id.trim() : "";
  if (!id || id === "null") return null;
  return findFaqById(id) ? id : null;
}

type AiHelpAction = "answer" | "ask_photo" | "contacts";

async function aiShortOrPhoto(
  question: string,
  allowAskPhoto: boolean,
  locale: HelpLocale,
): Promise<{ action: AiHelpAction; reply: string } | null> {
  const catalog = faqCatalogForAi(locale);
  const contactPhrase = contactsReply(locale);
  const langLine =
    locale === "ru"
      ? "You are VAKSINA MED HR assistant. Reply in Russian, short (2-5 sentences)."
      : "Siz VAKSINA MED HR yordamchisisiz. O‘zbekcha, qisqa (2–5 jumla).";
  const parsed = await openaiJson({
    maxTokens: 220,
    messages: [
      {
        role: "system",
        content: [
          langLine,
          "Only platform topics. If unknown: action=contacts.",
          allowAskPhoto
            ? "For UI/error without screenshot clarity: action=ask_photo."
            : "Do not use ask_photo.",
          'JSON only: {"action":"answer"|"ask_photo"|"contacts","reply":"..."}',
          `If contacts, reply exactly: "${contactPhrase}".`,
        ].join("\n"),
      },
      { role: "user", content: `Q: ${question}\n\nFacts:\n${catalog}` },
    ],
  });
  if (!parsed) return null;
  const actionRaw = String(parsed.action || "answer");
  let action: AiHelpAction =
    actionRaw === "ask_photo" || actionRaw === "contacts" ? actionRaw : "answer";
  if (!allowAskPhoto && action === "ask_photo") action = "answer";
  const reply = String(parsed.reply || "").trim().slice(0, 900);
  if (!reply) return null;
  return { action, reply };
}

async function aiVisionAnswer(
  question: string,
  imageDataUrl: string,
  locale: HelpLocale,
): Promise<{ action: "answer" | "contacts" | "off_topic"; reply: string } | null> {
  const catalog = faqCatalogForAi(locale);
  const contactPhrase = contactsReply(locale);
  const offTopicLead =
    locale === "ru"
      ? "Это не скриншот платформы VAKSINA MED HR (похоже на Telegram/другой мессенджер или внешнее приложение)."
      : "Bu VAKSINA MED HR platformasi skrinshoti emas (Telegram yoki boshqa dasturga o‘xshaydi).";
  const askPlatformShot =
    locale === "ru"
      ? "Пришлите скриншот именно из веб/приложения платформы (ошибка, Face ID, посещаемость и т.д.)."
      : "Platformaning o‘zidan skrinshot yuboring (xato, Face ID, davomat va hokazo).";
  const langLine =
    locale === "ru"
      ? "VAKSINA MED HR helper. Short Russian reply (2-6 sentences)."
      : "VAKSINA MED HR yordamchi. Qisqa o‘zbekcha javob (2–6 jumla).";
  const parsed = await openaiJson({
    maxTokens: 320,
    messages: [
      {
        role: "system",
        content: [
          langLine,
          "First classify the image:",
          "- PLATFORM: UI of VAKSINA MED HR / vaksinahr (login, dashboard, Face ID enroll, davomat, checklist, menus of this HR app).",
          "- OFF_TOPIC: Telegram, WhatsApp, Instagram, phone home screen, unrelated websites/apps, chat lists, messengers.",
          "If OFF_TOPIC: action=off_topic. reply MUST: (1) clearly say it is NOT a platform screenshot, (2) briefly describe what you see if useful, (3) answer the user question using Facts catalog about the REAL platform, (4) ask for a screenshot from the platform itself.",
          "If PLATFORM: action=answer with concrete help from the image + Facts. Do not invent.",
          "If cannot help even on platform: action=contacts.",
          'JSON: {"action":"answer"|"off_topic"|"contacts","reply":"..."}',
          `If contacts, reply: "${contactPhrase}".`,
          `Off-topic replies should start near: "${offTopicLead}" and end with asking for a platform screenshot: "${askPlatformShot}"`,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Q: ${question || (locale === "ru" ? "Объясните ошибку" : "Xatoni tushuntiring")}\n\nFacts (platform):\n${catalog}`,
          },
          { type: "image_url", image_url: { url: imageDataUrl, detail: "low" } },
        ],
      },
    ],
  });
  if (!parsed) return null;
  const raw = String(parsed.action || "answer");
  const action =
    raw === "contacts" || raw === "off_topic" ? raw : "answer";
  let reply = String(parsed.reply || "").trim().slice(0, 1200);
  if (!reply) return null;
  if (action === "off_topic" && !/platform|VAKSINA|vaksinahr|Telegram|мессенджер|dastur/i.test(reply)) {
    const faqHint = matchHelpFaq(question || "");
    const extra = faqHint
      ? `\n\n${faqAnswer(faqHint.faq, locale)}`
      : "";
    reply = `${offTopicLead}${extra}\n\n${askPlatformShot}`;
  }
  return { action, reply };
}

function photoAskReply(question: string, locale: HelpLocale): string {
  const q = question.toLowerCase();
  if (locale === "ru") {
    if (/face|yuz|kamera|skan|камер|лиц/.test(q)) {
      return "Отправьте скриншот экрана с ошибкой Face ID / камеры.";
    }
    if (/gps|davomat|hudud|keldim|ketdim|посещаем|зона/.test(q)) {
      return "Отправьте скриншот ошибки посещаемости/GPS или «вне зоны».";
    }
    if (/login|parol|kirish|парол|вход/.test(q)) {
      return "Отправьте скриншот экрана входа с текстом ошибки (пароль не присылайте).";
    }
    return "Отправьте скриншот экрана с проблемой (кнопка изображения ниже).";
  }
  if (/face|yuz|kamera|skan/.test(q)) {
    return "Face ID / kamera xatosi uchun skrinshot yuboring (pastdagi rasm tugmasi).";
  }
  if (/gps|davomat|hudud|keldim|ketdim/.test(q)) {
    return "Davomat/GPS xatosi yoki «hudud tashqarida» skrinshotini yuboring.";
  }
  if (/login|parol|kirish/.test(q)) {
    return "Login ekrani skrinshotini yuboring — parolni yubormang.";
  }
  return "Muammo ekranining skrinshotini yuboring (pastdagi rasm tugmasi).";
}

function errTooMany(locale: HelpLocale) {
  return locale === "ru"
    ? "Слишком много запросов. Попробуйте через минуту."
    : "Juda ko‘p so‘rov. Bir daqiqadan keyin urinib ko‘ring.";
}

function errNeedInput(locale: HelpLocale) {
  return locale === "ru" ? "Напишите вопрос или отправьте фото" : "Savol yozing yoki rasm yuboring";
}

router.get("/help/meta", optionalAuth, (req, res): void => {
  const locale = localeFromReq(req);
  res.json({
    telegramUrl: TELEGRAM_HELP_URL,
    telegram: TELEGRAM_HELP,
    phone: SUPPORT_PHONE,
    aiEnabled: Boolean(process.env.OPENAI_API_KEY?.trim()) && HELP_AI_ENABLED,
    locale,
    faqs: HELP_FAQS.map((f) => ({
      id: f.id,
      title: locale === "ru" ? f.titleRu : f.titleUz,
    })),
  });
});

router.post("/help/chat", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const locale = localeFromReq(req);
  try {
    if (rateLimited(req)) {
      res.status(429).json({ error: errTooMany(locale) });
      return;
    }

    const message = String(req.body?.message || "").trim().slice(0, 800);
    const context = String(req.body?.context || "").trim().slice(0, 800);
    const imageDataUrl = normalizeImageDataUrl(req.body?.imageDataUrl);

    if (!message && !imageDataUrl) {
      res.status(400).json({ error: errNeedInput(locale) });
      return;
    }

    if (imageDataUrl) {
      const q =
        message ||
        context ||
        (locale === "ru" ? "Объясните проблему на экране" : "Ekrandagi muammoni tushuntiring");
      const vision = await aiVisionAnswer(q, imageDataUrl, locale);
      if (!vision || vision.action === "contacts") {
        res.json(contactsPayload(locale));
        return;
      }
      res.json({
        reply: vision.reply,
        source: vision.action === "off_topic" ? "vision-offtopic" : "vision",
        needPhoto: vision.action === "off_topic",
        showContacts: false,
        locale,
      });
      return;
    }

    if (looksUnsatisfied(message)) {
      res.json(contactsPayload(locale));
      return;
    }

    const matched = matchHelpFaq(message);
    if (matched && matched.score >= 3) {
      res.json(faqReplyPayload(matched.faq, "faq", locale));
      return;
    }

    const direct = findFaqById(message);
    if (direct) {
      res.json(faqReplyPayload(direct, "faq", locale));
      return;
    }

    const aiId = await pickFaqIdWithCheapAi(message, locale);
    if (aiId) {
      res.json(faqReplyPayload(findFaqById(aiId)!, "faq-ai", locale));
      return;
    }

    if (matched && matched.score >= 2) {
      res.json(faqReplyPayload(matched.faq, "faq-weak", locale));
      return;
    }

    if (looksLikeUiError(message)) {
      const tailored = await aiShortOrPhoto(message, true, locale);
      if (tailored?.action === "ask_photo") {
        res.json({
          reply: tailored.reply,
          source: "ask-photo",
          needPhoto: true,
          showContacts: false,
          locale,
        });
        return;
      }
      if (tailored?.action === "contacts") {
        res.json(contactsPayload(locale));
        return;
      }
      if (tailored?.action === "answer") {
        res.json({
          reply: tailored.reply,
          source: "ai",
          needPhoto: false,
          showContacts: false,
          locale,
        });
        return;
      }
      res.json({
        reply: photoAskReply(message, locale),
        source: "ask-photo",
        needPhoto: true,
        showContacts: false,
        locale,
      });
      return;
    }

    const short = await aiShortOrPhoto(message, false, locale);
    if (short?.action === "contacts") {
      res.json(contactsPayload(locale));
      return;
    }
    if (short?.reply) {
      res.json({ reply: short.reply, source: "ai", showContacts: false, locale });
      return;
    }

    res.json(contactsPayload(locale));
  } catch (err) {
    console.error("POST /help/chat", err);
    res.status(503).json({
      error: locale === "ru" ? "Помощь временно недоступна." : "Yordam vaqtincha ishlamayapti.",
      ...contactsPayload(locale),
    });
  }
});

export default router;
