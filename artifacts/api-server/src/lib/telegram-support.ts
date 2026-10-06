/**
 * @vaksinahrbot — guruhdagi (va shaxsiy chatdagi) yordam javoblari.
 * Kalit so‘z bilan nomzod xabar tanlanadi, AI yozishma kontekstini o‘qib javob kerakligini hal qiladi;
 * AI bo‘lmasa — tayyor javoblar. Rasm bo‘lsa — vision bilan xato ekrani tahlili.
 */
import { faqAnswer, faqCatalogForAi, findFaqById, matchHelpFaq } from "./help-faq";
import { listPunchErrorHelp } from "./punch-error-help";
import { logger } from "./logger";
import {
  deleteMessage,
  downloadTelegramFile,
  escapeHtml,
  getMe,
  sendChatAction,
  sendMessage,
  type InlineKeyboardButton,
  type TelegramMessage,
} from "./telegram";

const SITE_URL = "https://vaksinahr.uz";
const SITE_LABEL = "vaksinahr.uz";
const SUPPORT_TG = "@saidmuhammadalixon_hr";
const SUPPORT_PHONE = "+998 70 174 37 22";

const TEXT_MODEL = process.env.OPENAI_SUPPORT_MODEL?.trim() || process.env.OPENAI_HELP_MODEL?.trim() || "gpt-4o-mini";
const VISION_MODEL = process.env.OPENAI_SUPPORT_VISION_MODEL?.trim() || "gpt-4o";
const AI_TIMEOUT_MS = Number(process.env.TELEGRAM_SUPPORT_AI_TIMEOUT_MS || 30_000);

const HISTORY_LIMIT = 30;
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000;
const USER_COOLDOWN_MS = 20_000;
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
const CHAT_WINDOW_MS = 5 * 60 * 1000;
const CHAT_MAX_REPLIES = 15;

type HistoryEntry = {
  id: number;
  name: string;
  text: string;
  replyTo?: string;
  isBot: boolean;
  at: number;
};

const historyByChat = new Map<number, HistoryEntry[]>();
const lastReplyByUser = new Map<string, number>();
const recentQuestions = new Map<string, number>();
const chatReplies = new Map<number, number[]>();
const seenGroups = new Set<number>();

let botInfo: { id: number; username: string } | null = null;

async function getBotInfo(): Promise<{ id: number; username: string }> {
  if (botInfo) return botInfo;
  try {
    const me = await getMe();
    botInfo = { id: me.id, username: me.username || "vaksinahrbot" };
  } catch {
    return { id: 0, username: "vaksinahrbot" };
  }
  return botInfo;
}

export function isGroupChat(chat: { type: string }): boolean {
  return chat.type === "group" || chat.type === "supergroup";
}

function supportEnabled(): boolean {
  const v = process.env.TELEGRAM_SUPPORT_GROUPS?.trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

function aiEnabled(): boolean {
  const v = process.env.TELEGRAM_SUPPORT_AI?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** Bo‘sh bo‘lsa — bot qo‘shilgan har qanday guruhda javob beradi */
function chatAllowed(chatId: number): boolean {
  const raw = process.env.TELEGRAM_SUPPORT_CHAT_IDS?.trim();
  if (!raw) return true;
  return raw
    .split(/[\s,;]+/)
    .filter(Boolean)
    .includes(String(chatId));
}

/* ---------------------------------------------------------------- matn ---- */

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
  ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

/** Kirill → lotin, kichik harf, apostroflarsiz — kalit so‘z qidirish uchun */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u0400-\u04ff]/g, (ch) => CYR[ch] ?? ch)
    .replace(/[‘’ʻʼ`'´]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const QUESTION_RE =
  /\?|qanday|qanaqa|qanaka|kanday|kanaka|qayer|kayer|qaer|kaer|nima uchun|nimaga|nega|qachon|kachon|bormi|bormikan|mumkinmi|kerakmi|boladimi|qilsa|qilay|qilamiz|qilish kerak|yordam|kak |gde|pochemu|chto |mozhno|nujno/;

const PROBLEM_RE =
  /kir ?olma|kirolma|kira olma|kirmay|kirmadi|kirish|kiraman|kirdi|ochilma|ochmay|ishlama|ishlamay|chiqma|chiqmay|xato|hato|oshibk|error|muammo|problem|yuklab|yukla|tashad|skach|app ?stor|play ?market|google play|iphone|ayfon|aifon|android|ilova|prilojen|prilozhen|dastur|progi|programma|parol|login|akkaunt|akaunt|face|fays|yuz|kamera|camera|gps|lokatsiya|lokatsya|joylashuv|geolok|hudud|zona|keldim|ketdim|davomat|qr|bot|sayt|link|ssilka|havola|blok|tasdiq|smena|kod/;

const APP_RE =
  /app ?stor|ap ?stor|eppstor|play ?market|pley ?market|plei ?market|google play|iphone|ayfon|aifon|android|ilova|prilojen|prilozhen|progi|programma|dastur|yuklab|yukla|tashad|skach|ustanov|ornat/;
const LOGIN_RE = /kir|login|parol|link|havola|sayt|qayer|kayer|qaer|kaer|ssilka|vxod|voyti/;
const PASSWORD_RE = /parol|unut|esdan|parolni|reset|sbros/;
/** Bu so‘zlar bo‘lsa javob doim kirish yo‘riqnomasi + koordinator eslatmasi bilan tugaydi */
const ALWAYS_GUIDE_RE =
  /smena|javob ?ol|program|dastur|app ?stor|ap ?stor|eppstor|play ?market|pley ?market|plei ?market|playmarket/;
const METOO_RE = /menda ?(ham|yam|xam)|mendayam|mendaxam|meni ?(ham|xam)da|men ?(ham|xam)|bizda ?(ham|xam)|xuddi shu|shu muammo|u menya tozhe|tozhe/;

const CREDENTIAL_LEAK_RE =
  /(login|логин|логин)\s*[:=]\s*\S+[\s\S]{0,60}?(parol|пароль|парол|password)\s*[:=]\s*\S+/i;

function messageText(msg: TelegramMessage): string {
  return (msg.text ?? msg.caption ?? "").trim();
}

function senderName(msg: TelegramMessage): string {
  const f = msg.from;
  if (!f) return "Foydalanuvchi";
  return [f.first_name, f.last_name].filter(Boolean).join(" ") || f.username || "Foydalanuvchi";
}

function hasImage(msg: TelegramMessage | undefined): boolean {
  if (!msg) return false;
  if (msg.photo?.length) return true;
  return Boolean(msg.document?.mime_type?.startsWith("image/"));
}

function describeForHistory(msg: TelegramMessage): string {
  const text = messageText(msg);
  const img = hasImage(msg) ? "[rasm] " : "";
  return `${img}${text}`.trim().slice(0, 400) || "[media]";
}

/* ------------------------------------------------------------- tarix ---- */

function remember(chatId: number, entry: HistoryEntry) {
  const now = Date.now();
  const list = (historyByChat.get(chatId) ?? []).filter((e) => now - e.at < HISTORY_TTL_MS);
  list.push(entry);
  while (list.length > HISTORY_LIMIT) list.shift();
  historyByChat.set(chatId, list);
}

function rememberIncoming(msg: TelegramMessage, botId: number) {
  const reply = msg.reply_to_message;
  remember(msg.chat.id, {
    id: msg.message_id,
    name: senderName(msg),
    text: describeForHistory(msg),
    replyTo: reply ? `${reply.from?.id === botId ? "Bot" : senderName(reply)}: ${describeForHistory(reply).slice(0, 160)}` : undefined,
    isBot: false,
    at: Date.now(),
  });
}

function historyBlock(chatId: number, excludeId: number): string {
  const list = (historyByChat.get(chatId) ?? []).filter((e) => e.id !== excludeId).slice(-20);
  if (!list.length) return "(yozishma yo‘q)";
  return list
    .map((e) => {
      const who = e.isBot ? "BOT (siz)" : e.name;
      const re = e.replyTo ? ` ↪ (${e.replyTo})` : "";
      return `[${e.id}] ${who}: ${e.text}${re}`;
    })
    .join("\n");
}

/* ------------------------------------------------------------ limitlar ---- */

function chatBudgetOk(chatId: number): boolean {
  const now = Date.now();
  const list = (chatReplies.get(chatId) ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
  chatReplies.set(chatId, list);
  return list.length < CHAT_MAX_REPLIES;
}

function markReplied(chatId: number, userId: number) {
  const now = Date.now();
  lastReplyByUser.set(`${chatId}:${userId}`, now);
  const list = chatReplies.get(chatId) ?? [];
  list.push(now);
  chatReplies.set(chatId, list);
}

function isDuplicate(chatId: number, userId: number, norm: string): boolean {
  if (!norm) return false;
  const now = Date.now();
  for (const [k, t] of recentQuestions) if (now - t > DUPLICATE_WINDOW_MS) recentQuestions.delete(k);
  const key = `${chatId}:${userId}:${norm.slice(0, 200)}`;
  if (recentQuestions.has(key)) return true;
  recentQuestions.set(key, now);
  return false;
}

/* ------------------------------------------------------- bilim bazasi ---- */

let cachedKb: string | null = null;

function supportKnowledge(): string {
  if (cachedKb) return cachedKb;
  const errors = listPunchErrorHelp()
    .map((e) => `- ${e.code} «${e.title}»: ${e.meaning} → ${e.fix}`)
    .join("\n");
  cachedKb = `
## PLATFORMAGA KIRISH — FAQAT 2 USUL (boshqasini HECH QACHON tavsiya qilmang)
1) Sayt: ${SITE_LABEL} — telefon yoki kompyuter brauzerida (iPhone: Safari, Android: Chrome) oching → Login va Parolni kiriting → «Kirish».
2) Telegram bot: @vaksinahrbot — shaxsiy chatda oching → «Start» → login va parolni bitta xabarda yuboring (namuna: \`login parol\` yoki ikki qatorda) → bot «🚀 Platformaga kirish» va «📋 Davomat — Face ID» tugmalarini beradi.
- App Store / Play Market / Google Play da ILOVA YO‘Q, hech narsa yuklab olish yoki o‘rnatish shart emas. iPhone va Android uchun ham shu 2 usul.
- Boshqa havola, APK, boshqa sayt yoki boshqa botlarni tavsiya qilmang.
- Bot buyruqlari: /start, /kirish (yangi kirish havolasi), /davomat (Face ID davomat), /chiqish, /yordam.
- Bot havolasi eskirsa: «🔄 Yangi kirish havolasi» tugmasi yoki /kirish.

## LOGIN / PAROL
- Login/parolni beradi: farmasevt, stajyor, mudir — Koordinator; bo‘lim boshliqlari va rahbariyat — Admin; bo‘lim xodimlari — o‘z bo‘lim boshlig‘i.
- «Login yoki parol noto‘g‘ri»: lotin harflarida, bo‘sh joysiz, katta-kichik harfga e’tibor bilan yozing; bo‘lmasa beruvchidan parolni yangilashni so‘rang.
- «Akkaunt faol emas / bloklangan / ishdan bo‘shatilgan»: HR yoki admin bilan bog‘lanish kerak.
- Parolni GURUHGA YOZMANG — faqat @vaksinahrbot shaxsiy chatiga yoki saytga kiriting.

## DAVOMAT (Keldim / Ketdim)
- Davomat Face ID + GPS bilan. Filial atrofida 70 m, ofisda 100 m ichida bo‘lish kerak. «Yashil hudud» chiqqach Keldim/Ketdim bosiladi.
- Joylashuv ruxsati: iPhone — Sozlamalar → Maxfiylik → Joylashuv xizmatlari YOQILGAN, Safari (yoki Telegram) uchun «Ilovadan foydalanganda»; Android — GPS yoqilgan, Chrome manzil satridagi qulf → Ruxsatlar → Joylashuv/Kamera → Ruxsat.
- Kamera ruxsati Face ID uchun shart (Safari/Chrome yoki Telegram uchun).
- Face ID: profil → «Face ID ni ulash» → yuzni oval ichiga, yorug‘ joyda, bitta yuz, niqob/qora ko‘zoynaksiz.
- Hududdan tashqarida desa: bino yoniga keling, GPS ni yoqing, 10–20 soniya kuting, sahifani yangilang.
- «Bugun bloklandi»: admin ruxsat bermaguncha ochilmaydi — koordinator/admin bilan bog‘laning.

## DAVOMAT XATO KODLARI (ekranda chiqadigan sabablar)
${errors}

## FAQ
${faqCatalogForAi("uz")}

## MUAMMO HAL BO‘LMASA — MUROJAAT TARTIBI
1) Xodim avval o‘z KOORDINATORIGA xabar beradi.
2) Koordinator HR bilan asosli ma’lumot (F.I.Sh., login, filial, muammo skrinshoti va vaqti) bilan bog‘lanadi.
HR kontakti: Telegram ${SUPPORT_TG}, telefon ${SUPPORT_PHONE}
`.trim();
  return cachedKb;
}

function systemPrompt(mode: "group" | "private"): string {
  return [
    "Siz VAKSINA MED HR platformasining rasmiy Telegram yordam botisiz (@vaksinahrbot).",
    mode === "group"
      ? "Siz xodimlar guruhida turibsiz. Guruh yozishmasini o‘qing va faqat platformaga (kirish, login/parol, davomat, Face ID, GPS, xatolar, menyular) oid savol yoki muammoga javob bering."
      : "Siz foydalanuvchi bilan shaxsiy chatdasiz. Savoliga platforma bo‘yicha javob bering.",
    "QOIDALAR:",
    "- Platformaga kirish uchun FAQAT 2 usulni tavsiya qiling: 1) vaksinahr.uz saytida login va parol bilan; 2) @vaksinahrbot botiga login va parol yuborib. Boshqa usul, ilova, APK, havola aytmang.",
    "- App Store / Play Market da ilova yo‘qligini aniq ayting, agar so‘ralsa.",
    "- Faqat BILIM BAZASI dagi faktlarga tayaning, uydirmang. Bilmasangiz yoki muammo hal bo‘lmasa: koordinatorga xabar berishni, koordinator esa HR bilan asosli ma’lumot bilan bog‘lanishini ayting.",
    "- Javob qisqa va aniq: 2–6 jumla yoki qisqa qadamlar ro‘yxati. Salom-alik, uzun kirish so‘zlarisiz.",
    "- Foydalanuvchi qaysi tilda/yozuvda yozgan bo‘lsa, shu tilda javob bering (o‘zbek lotin, o‘zbek kirill yoki rus). Odatiy holda o‘zbek lotin.",
    "- Parol so‘ramang; kimdir parolini guruhga yozsa, o‘chirishni va faqat botga shaxsiy yuborishni ayting.",
    "- Rasm bo‘lsa: ekrandagi matn va holatni o‘qing, ANIQ muammoni ayting (masalan: joylashuv ruxsati o‘chiq, hududdan tashqarida, login xato, kamera ruxsati yo‘q, Telegram brauzerida emas, eski havola) va qanday tuzatishni qadamma-qadam yozing. Rasm platformaga aloqasiz bo‘lsa — reply=false (guruhda) yoki buni qisqa ayting (shaxsiyda).",
    mode === "group"
      ? "- Javob BERMANG (reply=false): salomlashish, rahmat, hazil, platformaga aloqasiz suhbat, admin/xodim allaqachon to‘g‘ri javob bergan savol, siz yaqinda aynan shu odamga shu javobni bergan bo‘lsangiz, odamlar o‘zaro gaplashayotgan bo‘lsa. Shubhali bo‘lsa va savol platformaga oid bo‘lsa — javob bering."
      : "- Shaxsiy chatda doim reply=true.",
    "- Agar boshqa odam ham «menda ham chiqmadi» kabi yozsa, kontekstdagi muammoni tushunib, unga ham yechim bering.",
    "- Kirish/ilova/havola/qayerdan kirish haqida bo‘lsa login_buttons=true.",
    'Faqat JSON qaytaring: {"reply": true|false, "answer": "matn", "login_buttons": true|false}',
    "",
    "=== BILIM BAZASI ===",
    supportKnowledge(),
  ].join("\n");
}

/* --------------------------------------------------------------- AI ---- */

type AiDecision = { reply: boolean; answer: string; loginButtons: boolean };

async function askAi(opts: {
  mode: "group" | "private";
  userText: string;
  imageDataUrl?: string | null;
}): Promise<AiDecision | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || !aiEnabled()) return null;
  const content: Array<Record<string, unknown>> = [{ type: "text", text: opts.userText }];
  if (opts.imageDataUrl) {
    content.push({ type: "image_url", image_url: { url: opts.imageDataUrl, detail: "high" } });
  }
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      body: JSON.stringify({
        model: opts.imageDataUrl ? VISION_MODEL : TEXT_MODEL,
        temperature: 0.2,
        max_tokens: 550,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(opts.mode) },
          { role: "user", content },
        ],
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "telegram-support: OpenAI xato");
      return null;
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const answer = String(parsed.answer ?? "").trim().slice(0, 1800);
    return {
      reply: parsed.reply === true || parsed.reply === "true",
      answer,
      loginButtons: parsed.login_buttons === true || parsed.login_buttons === "true",
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "telegram-support: AI chaqiruvi muvaffaqiyatsiz");
    return null;
  }
}

async function imageDataUrlFrom(msg: TelegramMessage | undefined): Promise<string | null> {
  if (!msg) return null;
  try {
    if (msg.photo?.length) {
      const sizes = [...msg.photo].sort((a, b) => a.width * a.height - b.width * b.height);
      const pick =
        [...sizes].reverse().find((p) => Math.max(p.width, p.height) <= 2000 && (p.file_size ?? 0) <= 4_500_000) ??
        sizes[0];
      const buf = await downloadTelegramFile(pick.file_id);
      return buf ? `data:image/jpeg;base64,${buf.toString("base64")}` : null;
    }
    const doc = msg.document;
    if (doc && /^image\/(png|jpeg|jpg|webp)$/i.test(doc.mime_type ?? "")) {
      const buf = await downloadTelegramFile(doc.file_id);
      return buf ? `data:${doc.mime_type};base64,${buf.toString("base64")}` : null;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "telegram-support: rasm yuklanmadi");
  }
  return null;
}

/* ------------------------------------------------------ tayyor javoblar ---- */

const TWO_WAYS = [
  `Platformaga faqat 2 usulda kiriladi:`,
  `1) <b>${SITE_LABEL}</b> — telefon brauzerida (iPhone: Safari, Android: Chrome) oching, login va parolingizni kiriting.`,
  `2) <b>@vaksinahrbot</b> — botni oching, «Start» bosing va login hamda parolingizni bitta xabarda yuboring: <code>login parol</code>`,
].join("\n");

const COORDINATOR_NOTE =
  "❗️ Muammo bo‘lsa — <b>koordinatoringizga</b> xabar bering. Koordinator HR bilan asosli ma’lumot (F.I.Sh., login, filial, muammo skrinshoti va vaqti) bilan bog‘lanadi.";

function withLoginGuide(html: string): string {
  const parts = [html.trim()];
  if (!html.includes(TWO_WAYS)) parts.push(TWO_WAYS);
  parts.push(COORDINATOR_NOTE);
  return parts.filter(Boolean).join("\n\n");
}

function lastBotAnswer(chatId: number): string | null {
  const list = historyByChat.get(chatId) ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (Date.now() - e.at > DUPLICATE_WINDOW_MS) break;
    if (e.isBot) return e.text;
  }
  return null;
}

function fallbackAnswer(text: string, chatId: number): { html: string; loginButtons: boolean } | null {
  const n = normalizeForMatch(text);
  if (!n) return null;
  if (METOO_RE.test(n)) {
    const prev = lastBotAnswer(chatId);
    if (prev) return { html: `Sizga ham shu yechim:\n\n${escapeHtml(prev)}`, loginButtons: true };
  }
  if (APP_RE.test(n)) {
    return {
      html: `App Store / Play Market'da ilova yo‘q — hech narsa yuklab olish shart emas (iPhone va Android uchun ham).\n\n${TWO_WAYS}`,
      loginButtons: true,
    };
  }
  if (PASSWORD_RE.test(n)) {
    const faq = findFaqById("login-parol");
    return {
      html: `${faq ? `${escapeHtml(faqAnswer(faq, "uz"))}\n\n` : ""}${TWO_WAYS}\n\n⚠️ Parolni guruhga yozmang.`,
      loginButtons: true,
    };
  }
  if (LOGIN_RE.test(n)) {
    return { html: TWO_WAYS, loginButtons: true };
  }
  const faq = matchHelpFaq(n);
  if (faq && faq.score >= 3) {
    if (faq.faq.id === "telegram") return { html: TWO_WAYS, loginButtons: true };
    return { html: escapeHtml(faqAnswer(faq.faq, "uz")), loginButtons: false };
  }
  return null;
}

/* ------------------------------------------------------------ yuborish ---- */

function toTelegramHtml(answer: string): string {
  return escapeHtml(answer)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

async function loginKeyboard(): Promise<{ inline_keyboard: InlineKeyboardButton[][] }> {
  const { username } = await getBotInfo();
  return {
    inline_keyboard: [
      [
        { text: `🌐 ${SITE_LABEL}`, url: SITE_URL },
        { text: `🤖 @${username}`, url: `https://t.me/${username}?start=guruh` },
      ],
    ],
  };
}

async function replyTo(msg: TelegramMessage, html: string, loginButtons: boolean) {
  const sent = await sendMessage(msg.chat.id, html, {
    reply_to_message_id: msg.message_id,
    reply_markup: loginButtons ? await loginKeyboard() : undefined,
  });
  remember(msg.chat.id, {
    id: sent?.message_id ?? Date.now(),
    name: "BOT",
    text: html.replace(/<[^>]+>/g, "").slice(0, 400),
    replyTo: `${senderName(msg)}: ${describeForHistory(msg).slice(0, 120)}`,
    isBot: true,
    at: Date.now(),
  });
}

/* ------------------------------------------------------------- buyruqlar ---- */

async function handleGroupCommand(msg: TelegramMessage, text: string): Promise<boolean> {
  const m = text.match(/^\/([a-z_]+)(?:@(\w+))?/i);
  if (!m) return false;
  const { username } = await getBotInfo();
  if (m[2] && m[2].toLowerCase() !== username.toLowerCase()) return true;
  const cmd = m[1].toLowerCase();
  if (cmd === "guruhid" || cmd === "chatid" || cmd === "id") {
    await sendMessage(
      msg.chat.id,
      `🆔 Guruh ID: <code>${msg.chat.id}</code>\n${escapeHtml(msg.chat.title ?? "")}`,
      { reply_to_message_id: msg.message_id },
    );
    return true;
  }
  if (["start", "yordam", "help", "kirish", "davomat"].includes(cmd)) {
    if (!chatAllowed(msg.chat.id)) return true;
    await replyTo(
      msg,
      `${TWO_WAYS}\n\nSavolingizni shu guruhga yozing yoki xato ekranining rasmini yuboring — javob beraman.`,
      true,
    );
    return true;
  }
  return true;
}

/* ------------------------------------------------------- asosiy oqim ---- */

function isDirectToBot(msg: TelegramMessage, bot: { id: number; username: string }): boolean {
  if (msg.reply_to_message?.from?.id && msg.reply_to_message.from.id === bot.id) return true;
  const text = messageText(msg).toLowerCase();
  return text.includes(`@${bot.username.toLowerCase()}`);
}

function buildUserPrompt(msg: TelegramMessage, mode: "group" | "private", imageFrom: "self" | "reply" | null): string {
  const reply = msg.reply_to_message;
  const lines = [
    mode === "group" ? `Guruh: ${msg.chat.title ?? msg.chat.id}` : "Shaxsiy chat",
    "",
    "So‘nggi yozishmalar (eskidan yangiga):",
    historyBlock(msg.chat.id, msg.message_id),
    "",
    "YANGI XABAR:",
    `[${msg.message_id}] ${senderName(msg)}: ${messageText(msg) || "(matnsiz)"}`,
  ];
  if (reply) {
    lines.push(`Bu xabar quyidagiga javob: ${senderName(reply)}: ${describeForHistory(reply)}`);
  }
  if (imageFrom === "self") lines.push("Xabarga rasm (skrinshot) biriktirilgan — uni tahlil qiling.");
  if (imageFrom === "reply") lines.push("Rasm — javob berilgan xabardagi skrinshot; savol shu rasm haqida.");
  if (ALWAYS_GUIDE_RE.test(normalizeForMatch(messageText(msg)))) {
    lines.push(
      "MUHIM: bu xabarga albatta javob bering (reply=true). Kirish usullari va koordinator eslatmasi javob oxiriga avtomatik qo‘shiladi — ularni takrorlamang, faqat savolning o‘ziga qisqa javob yozing (bo‘lmasa answer bo‘sh qolsin).",
    );
  }
  return lines.join("\n");
}

async function answerWithAi(
  msg: TelegramMessage,
  mode: "group" | "private",
  direct: boolean,
): Promise<boolean> {
  const text = messageText(msg);
  const norm = normalizeForMatch(text);
  const forceGuide = ALWAYS_GUIDE_RE.test(norm);
  let imageFrom: "self" | "reply" | null = null;
  let imageDataUrl: string | null = null;

  if (aiEnabled()) {
    if (hasImage(msg)) {
      imageFrom = "self";
    } else if (hasImage(msg.reply_to_message) && (QUESTION_RE.test(norm) || PROBLEM_RE.test(norm) || direct)) {
      imageFrom = "reply";
    }
    if (imageFrom) {
      void sendChatAction(msg.chat.id).catch(() => {});
      imageDataUrl = await imageDataUrlFrom(imageFrom === "self" ? msg : msg.reply_to_message);
      if (!imageDataUrl) imageFrom = null;
    } else {
      void sendChatAction(msg.chat.id).catch(() => {});
    }

    const ai = await askAi({ mode, userText: buildUserPrompt(msg, mode, imageFrom), imageDataUrl });
    if (ai) {
      if (forceGuide) {
        await replyTo(msg, withLoginGuide(ai.answer ? toTelegramHtml(ai.answer) : ""), true);
        return true;
      }
      if ((ai.reply || direct || mode === "private") && ai.answer) {
        await replyTo(msg, toTelegramHtml(ai.answer), ai.loginButtons);
        return true;
      }
      if (!direct && mode === "group") return false;
    }
  }

  const fb = fallbackAnswer(text, msg.chat.id);
  if (forceGuide) {
    await replyTo(msg, withLoginGuide(fb?.html ?? ""), true);
    return true;
  }
  if (fb) {
    await replyTo(msg, fb.html, fb.loginButtons);
    return true;
  }
  if (direct && mode === "group") {
    await replyTo(
      msg,
      `${TWO_WAYS}\n\n${COORDINATOR_NOTE}`,
      true,
    );
    return true;
  }
  return false;
}

/** Guruh xabari: kontekstga yozadi va kerak bo‘lsa reply bilan javob beradi */
export async function handleGroupSupportMessage(msg: TelegramMessage): Promise<void> {
  if (!supportEnabled() || !msg.from || msg.from.is_bot) return;
  const chatId = msg.chat.id;
  if (!seenGroups.has(chatId)) {
    seenGroups.add(chatId);
    logger.info({ chatId, title: msg.chat.title }, "telegram-support: guruh aniqlandi");
  }

  const bot = await getBotInfo();
  const text = messageText(msg);

  if (text.startsWith("/")) {
    await handleGroupCommand(msg, text);
    return;
  }

  rememberIncoming(msg, bot.id);
  if (!chatAllowed(chatId)) return;

  if (CREDENTIAL_LEAK_RE.test(text)) {
    await deleteMessage(chatId, msg.message_id).catch(() => {});
    const name = escapeHtml(senderName(msg));
    await sendMessage(
      chatId,
      `⚠️ ${name}, login va parolni guruhga yozmang — xavfsizlik uchun xabar o‘chirildi.\nUlarni faqat <b>@${bot.username}</b> shaxsiy chatiga yuboring yoki <b>${SITE_LABEL}</b> saytida kiriting.`,
      { reply_markup: await loginKeyboard() },
    );
    return;
  }

  const norm = normalizeForMatch(text);
  const direct = isDirectToBot(msg, bot);
  const image = hasImage(msg);
  const imageReplyQuestion = hasImage(msg.reply_to_message) && (QUESTION_RE.test(norm) || PROBLEM_RE.test(norm));
  const candidate =
    direct ||
    image ||
    imageReplyQuestion ||
    ALWAYS_GUIDE_RE.test(norm) ||
    PROBLEM_RE.test(norm) ||
    (QUESTION_RE.test(norm) && norm.length >= 8);
  if (!candidate) return;
  if (!direct && !image && norm.length < 4) return;

  const userKey = `${chatId}:${msg.from.id}`;
  if (!direct) {
    const last = lastReplyByUser.get(userKey) ?? 0;
    if (Date.now() - last < USER_COOLDOWN_MS) return;
    if (!image && isDuplicate(chatId, msg.from.id, norm)) return;
  }
  if (!chatBudgetOk(chatId)) return;

  // AI bo‘lmasa kalit so‘zli javob faqat aniq holatlarda (spam bo‘lmasin)
  if (!aiEnabled() && !direct) {
    const strong =
      ALWAYS_GUIDE_RE.test(norm) ||
      (PROBLEM_RE.test(norm) && (QUESTION_RE.test(norm) || APP_RE.test(norm) || LOGIN_RE.test(norm))) ||
      (METOO_RE.test(norm) && lastBotAnswer(chatId) !== null);
    if (!strong) return;
  }

  const answered = await answerWithAi(msg, "group", direct);
  if (answered) markReplied(chatId, msg.from.id);
}

/**
 * Shaxsiy chat: login/parol bo‘lmagan matn yoki rasm.
 * true — javob yuborildi.
 */
export async function handlePrivateSupportMessage(msg: TelegramMessage): Promise<boolean> {
  if (!msg.from || msg.from.is_bot) return false;
  const bot = await getBotInfo();
  rememberIncoming(msg, bot.id);
  const key = `${msg.chat.id}:${msg.from.id}`;
  const last = lastReplyByUser.get(key) ?? 0;
  if (Date.now() - last < 3_000) return true;
  const answered = await answerWithAi(msg, "private", true);
  if (answered) markReplied(msg.chat.id, msg.from.id);
  return answered;
}

export function messageHasImage(msg: TelegramMessage): boolean {
  return hasImage(msg);
}
