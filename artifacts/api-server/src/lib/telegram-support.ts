/**
 * @vaksinahrbot — guruh va shaxsiy chatdagi yordam javoblari.
 * AI ishlatilmaydi: xabar kalit so‘zlar (lotin + kirill) bo‘yicha mavzuga ajratiladi va tayyor javob reply qilinadi.
 */
import { faqAnswer, matchHelpFaq } from "./help-faq";
import { logger } from "./logger";
import {
  deleteMessage,
  escapeHtml,
  getMe,
  sendMessage,
  type InlineKeyboardButton,
  type TelegramMessage,
} from "./telegram";

const SITE_URL = "https://vaksinahr.uz";
const SITE_LABEL = "vaksinahr.uz";

const USER_COOLDOWN_MS = 20_000;
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
const CHAT_WINDOW_MS = 5 * 60 * 1000;
const CHAT_MAX_REPLIES = 15;

const lastReplyByUser = new Map<string, number>();
const recentQuestions = new Map<string, number>();
const chatReplies = new Map<number, number[]>();
const lastAnswerByChat = new Map<number, { html: string; loginButtons: boolean; at: number }>();
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

/** Kirill → lotin, kichik harf, apostrof/belgilarsiz, cho‘zilgan harflar qisqartirilgan */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u0400-\u04ff]/g, (ch) => CYR[ch] ?? ch)
    .replace(/[‘’ʻʼ`'´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/(\p{L})\1{2,}/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function re(parts: string[]): RegExp {
  return new RegExp(parts.join("|"));
}

/** Ilova do‘konlari / yuklab olish */
const STORE_RE = re([
  "app ?stor", "ap ?stor", "eppstor", "epp stor", "play ?market", "pley ?market", "plei ?market", "plemarket",
  "google play", "gugl ?pley", "gugl ?play", "yuklab ol", "yuklash", "yuklayman", "yuklasa", "yukladim",
  "skacha", "skachat", "ustanov", "ornat", "tashad", "iphone", "ayfon", "aifon", "ayfonda", "android", "androyd", "apk",
]);

/** Dastur / programma / ilova so‘zlari */
const PROGRAM_RE = re([
  "dastur", "programm", "progra", "progi", "progy", "prog ", "prilojen", "prilozhen", "ilova", "ilovasi", "soft",
]);

const SMENA_RE = re([
  "smena", "smen", "shift", "grafik", "jadval", "ish vaqt", "ish soat", "ish kuni", "nechida", "nechchida",
  "nechada", "kechki", "tungi", "kunduzgi", "ertalabki", "navbatchi", "dam olish kun", "vixodnoy", "vyhodnoy",
]);

const JAVOB_RE = re([
  "javob", "jovob", "ruxsat ol", "ruxsat so", "ruxsat ber", "ruhsat", "otpros", "otgul", "otpusk", "tatil",
  "bolnichn", "bolnichniy", "kasal", "sababli", "ariza",
]);

const PASSWORD_ISSUER_RE = re([
  "parol(i|im|ni|ingiz)? ?(unut|esdan|esim|qayer|kayer|qaer|kaer|yoq|berilmagan|bermagan|kim|kimdan|olsam|olaman|olish)",
  "login(i|im|ni|ingiz)? ?(unut|esdan|esim|qayer|kayer|qaer|kaer|yoq|berilmagan|bermagan|kim|kimdan|olsam|olaman|olish)",
  "unutdim", "unitdim", "unutib", "esdan chiq", "esimdan chiq", "yodimdan", "zabil", "sbros", "reset",
  "yangi parol", "parol almash", "parolni almash", "parolni ozgart", "parol ozgart", "login parol ber",
]);

const BLOCK_RE = re(["blok", "bloklandi", "bloklangan", "zablok", "qulf", "kulf", "qulfla", "lock"]);

const FACE_RE = re([
  "face", "feys", "feis", "fays", "fejs", "\\byuz(im|ni|ingiz|imni|ni)?\\b", "tanima", "tanimadi", "tanimayapti",
  "kamera", "camera", "kamira", "selfi", "surat ol", "skaner", "litso", "\\bliso\\b",
]);

const GPS_RE = re([
  "gps", "jps", "jipies", "lokatsiya", "lokatsya", "lokasiya", "lokatsiy", "lakatsiya", "geolok", "geo ",
  "joylashuv", "joylashuvni", "joylashuvga", "hudud", "xudud", "hududdan", "zona", "zonada", "tashqarida",
  "uzoqda", "masofa", "metr", "mestopoloj", "manzil aniqlan",
]);

const DAVOMAT_RE = re([
  "davomat", "davomad", "keldim", "ketdim", "otmetka", "otmetit", "otmechat", "belgila",
  "check", "chek in", "chekin", "\\bqr\\b", "kyuar", "\\bkuar\\b",
]);

const LOGIN_FAIL_RE = re([
  "kirmadi", "kirmadim", "kirmayapti", "kirmayap", "kirmaypti", "kirmayvot", "kirmayabdi", "kirolma", "kira olma",
  "kiraolma", "kiromad", "kirib bolma", "kirib bulma", "kirish bolma", "kirishda", "kira olmay", "kirgiza olma",
  "ochilmadi", "ochilmayapti", "ochilmay", "ochmayapti", "ochmadi", "ishlamadi", "ishlamayapti", "ishlamayap",
  "ishlamaypti", "ishlamay", "ishlamayvot", "ishlamiyapti", "bolmadi", "bulmadi", "bolmayapti", "bulmayapti",
  "bolmayvot", "bolid", "chiqmadi", "chiqmayapti", "chikmadi", "chikmayapti", "chiqmayvot", "xato", "hato",
  "xatolik", "oshibka", "oshibk", "error", "notogri", "natogri", "nevern", "ne rabotaet", "ne vxodit",
  "ne mogu voyti", "ne otkriva", "zavis", "qotib", "kotib", "qotyapti", "kotyapti", "yuklanmayapti",
  "yuklanmadi", "muammo", "problem", "parol xato", "login xato", "parol notogri", "login notogri",
]);

const WHERE_RE = re([
  "qayerdan", "qayerga", "qaerdan", "qaerga", "kayerdan", "kayerga", "kaerdan", "kaerga", "qayerda", "kayerda",
  "qanday kir", "kanday kir", "qanaqa kir", "kanaka kir", "qanday ochil", "qanday qilib kir", "kirdiz",
  "kirdingiz", "kirdinglar", "kiriladi", "kirsa bolad", "kirish kerak", "kirish uchun", "link", "linki",
  "ssilka", "ssilk", "silka", "havola", "xavola", "sayt", "sait", "adres", "qaysi bot", "bot qaysi",
  "qaysi sayt", "vxod", "voyti", "kak zayti", "zayti", "kirish", "login", "parol",
]);

const METOO_RE = re([
  "menda ?(ham|yam|xam)", "mendayam", "mendaxam", "mendaham", "meni ?(ham|xam)", "men ?(ham|xam)",
  "bizda ?(ham|xam)", "bizdayam", "xuddi shu", "shu muammo", "huddi shu", "u menya tozhe", "tozhe",
]);

const CREDENTIAL_LEAK_RE =
  /(login|логин)\s*[:=]\s*\S+[\s\S]{0,60}?(parol|пароль|парол|password)\s*[:=]\s*\S+/i;

/* ------------------------------------------------------ tayyor javoblar ---- */

const TWO_WAYS = [
  `🌐 Platformaga faqat 2 usulda kiriladi:`,
  `1) <b>${SITE_LABEL}</b> — telefon brauzerida (iPhone: Safari, Android: Chrome) oching, login va parolingizni kiriting.`,
  `2) <b>@vaksinahrbot</b> — botni oching, «Start» bosing va login hamda parolingizni bitta xabarda yuboring: <code>login parol</code>`,
].join("\n");

const COORDINATOR_NOTE =
  "❗️ Muammo bo‘lsa — <b>koordinatoringizga</b> xabar bering. Koordinator HR bilan asosli ma’lumot (F.I.Sh., login, filial, muammo skrinshoti va vaqti) bilan bog‘lanadi.";

type Answer = { html: string; loginButtons: boolean };

function compose(body: string | null, withLogin: boolean): Answer {
  const parts = [body, withLogin ? TWO_WAYS : null, COORDINATOR_NOTE].filter(Boolean);
  return { html: parts.join("\n\n"), loginButtons: withLogin };
}

const ANSWERS = {
  app: () =>
    compose(
      "📱 App Store / Play Market'da ilova yo‘q — hech narsa yuklab olish yoki o‘rnatish shart emas (iPhone va Android uchun ham).",
      true,
    ),
  smena: () =>
    compose(
      [
        "🕒 <b>Smena vaqtlari (apteka):</b>",
        "• 1-smena: 08:00–17:00",
        "• 2-smena: 17:00–23:45",
        "• 3-smena: 23:00–07:00",
        "Ofis: odatda 09:00–18:00.",
        "",
        "Smenangiz va filialingizni <b>koordinator</b> belgilaydi, platformadagi «Davomat» bo‘limida ko‘rinadi. Smena ko‘rinmasa yoki noto‘g‘ri bo‘lsa — koordinatorga ayting.",
      ].join("\n"),
      true,
    ),
  javob: () =>
    compose(
      [
        "📝 <b>Javob olish</b> (ruxsat so‘rash) platformadagi «Javob olish» bo‘limida:",
        "1) «Javob olish» → sana, vaqt (soat yoki kun) va sababni yozing → yuboring.",
        "2) So‘rov avval <b>koordinatorga</b> (ofis xodimlari uchun — bo‘lim boshlig‘iga), keyin HR'ga boradi.",
        "3) Javobingiz nima bo‘lganini «Javob olish holati» bo‘limida ko‘rasiz: kutilmoqda / tasdiqlandi / rad etildi.",
        "Tasdiqlangan vaqt uchun davomat jarimasi yozilmaydi.",
      ].join("\n"),
      true,
    ),
  password: () =>
    compose(
      [
        "🔑 <b>Login va parolni beradi:</b>",
        "• farmasevt, stajyor, mudir — <b>koordinator</b>;",
        "• bo‘lim xodimlari — o‘z bo‘lim boshlig‘i;",
        "• bo‘lim boshliqlari va rahbariyat — admin.",
        "Parolni unutgan bo‘lsangiz — shu odamdan yangilab berishni so‘rang.",
        "⚠️ Login va parolni guruhga yozmang.",
      ].join("\n"),
      true,
    ),
  loginFail: () =>
    compose(
      [
        "🔐 <b>Kirish yoki ishlashda muammo bo‘lsa, tekshiring:</b>",
        `1) Faqat <b>${SITE_LABEL}</b> yoki <b>@vaksinahrbot</b> orqali kiryapsizmi (boshqa ilova/havola yo‘q).`,
        "2) Login va parol lotin harflarida, bo‘sh joysiz, katta-kichik harflari to‘g‘ri yozilganmi.",
        "3) Internet ishlayaptimi — sahifani yangilang yoki brauzerni yopib qayta oching (iPhone: Safari, Android: Chrome).",
        "4) Botdagi havola eskirgan bo‘lsa — /kirish yoki «🔄 Yangi kirish havolasi».",
        "5) «Login yoki parol noto‘g‘ri» chiqsa — parolni koordinatordan yangilatib oling.",
      ].join("\n"),
      true,
    ),
  where: () => compose(null, true),
  gps: () =>
    compose(
      [
        "📍 <b>Joylashuv (GPS):</b> davomat uchun GPS yoqilgan va filial yonida (70 m, ofisda 100 m) bo‘lishingiz kerak.",
        "• iPhone: Sozlamalar → Maxfiylik → Joylashuv xizmatlari → yoqing; Safari (yoki Telegram) → «Ilovadan foydalanganda».",
        "• Android: GPS ni yoqing; Chrome → manzil satridagi qulf belgisi → Ruxsatlar → Joylashuv → Ruxsat.",
        "Keyin 10–20 soniya kuting va sahifani yangilang. «Hududdan tashqarida» chiqsa — binoga yaqinroq keling.",
      ].join("\n"),
      false,
    ),
  face: () =>
    compose(
      [
        "🙂 <b>Face ID uchun:</b>",
        "1) Kamera ruxsatini bering (Safari/Chrome yoki Telegram uchun).",
        "2) Yorug‘ joyda turing, kadrda faqat siz bo‘ling, niqob va qora ko‘zoynakni yeching.",
        "3) Yuzni oval ichiga to‘g‘ri joylashtiring.",
        "4) Face ID hali ulanmagan bo‘lsa — Profil → «Face ID ni ulash».",
        "Tanimasa — sahifani yangilab, qayta urinib ko‘ring.",
      ].join("\n"),
      false,
    ),
  davomat: () =>
    compose(
      "📋 <b>Davomat (Keldim / Ketdim):</b> platformaga kiring → «Davomat» → joylashuv va kamera ruxsatini bering → «Yashil hudud» chiqqach Face ID bilan Keldim yoki Ketdim bosing. Botda: /davomat.",
      true,
    ),
  block: () =>
    compose(
      "⛔️ <b>«Bugun bloklandi»</b> — yashil hudud tasdig‘i vaqtida qilinmagan. Shu kun Keldim/Ketdim yopiq bo‘ladi va faqat admin ochib beradi.",
      false,
    ),
} satisfies Record<string, () => Answer>;

type Topic = keyof typeof ANSWERS;

function detectTopic(norm: string): Topic | null {
  if (!norm) return null;
  if (PASSWORD_ISSUER_RE.test(norm)) return "password";
  if (STORE_RE.test(norm)) return "app";
  if (JAVOB_RE.test(norm)) return "javob";
  if (SMENA_RE.test(norm)) return "smena";
  if (BLOCK_RE.test(norm)) return "block";
  if (FACE_RE.test(norm)) return "face";
  if (GPS_RE.test(norm)) return "gps";
  if (DAVOMAT_RE.test(norm)) return "davomat";
  if (LOGIN_FAIL_RE.test(norm)) return "loginFail";
  if (PROGRAM_RE.test(norm)) return "app";
  if (WHERE_RE.test(norm)) return "where";
  return null;
}

function answerFor(text: string, chatId: number): Answer | null {
  const norm = normalizeForMatch(text);
  if (METOO_RE.test(norm)) {
    const prev = lastAnswerByChat.get(chatId);
    if (prev && Date.now() - prev.at < DUPLICATE_WINDOW_MS) return { html: prev.html, loginButtons: prev.loginButtons };
  }
  const topic = detectTopic(norm);
  if (topic) return ANSWERS[topic]();
  const faq = matchHelpFaq(norm);
  if (faq && faq.score >= 3) {
    if (faq.faq.id === "telegram") return ANSWERS.where();
    return compose(escapeHtml(faqAnswer(faq.faq, "uz")), false);
  }
  return null;
}

/* ------------------------------------------------------------- yordamchi ---- */

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

export function messageHasImage(msg: TelegramMessage): boolean {
  return hasImage(msg);
}

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

async function replyTo(msg: TelegramMessage, answer: Answer) {
  await sendMessage(msg.chat.id, answer.html, {
    reply_to_message_id: msg.message_id,
    reply_markup: answer.loginButtons ? await loginKeyboard() : undefined,
  });
  lastAnswerByChat.set(msg.chat.id, { ...answer, at: Date.now() });
}

function isDirectToBot(msg: TelegramMessage, bot: { id: number; username: string }): boolean {
  if (msg.reply_to_message?.from?.id && msg.reply_to_message.from.id === bot.id) return true;
  return messageText(msg).toLowerCase().includes(`@${bot.username.toLowerCase()}`);
}

/* ------------------------------------------------------------- buyruqlar ---- */

async function handleGroupCommand(msg: TelegramMessage, text: string): Promise<void> {
  const m = text.match(/^\/([a-z_]+)(?:@(\w+))?/i);
  if (!m) return;
  const { username } = await getBotInfo();
  if (m[2] && m[2].toLowerCase() !== username.toLowerCase()) return;
  const cmd = m[1].toLowerCase();
  if (cmd === "guruhid" || cmd === "chatid" || cmd === "id") {
    await sendMessage(
      msg.chat.id,
      `🆔 Guruh ID: <code>${msg.chat.id}</code>\n${escapeHtml(msg.chat.title ?? "")}`,
      { reply_to_message_id: msg.message_id },
    );
    return;
  }
  if (["start", "yordam", "help", "kirish", "davomat"].includes(cmd) && chatAllowed(msg.chat.id)) {
    await replyTo(msg, ANSWERS.where());
  }
}

/* ------------------------------------------------------- asosiy oqim ---- */

/** Guruh xabari: mavzu aniqlansa shu odamga reply bilan tayyor javob */
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
  if (!chatAllowed(chatId)) return;

  if (CREDENTIAL_LEAK_RE.test(text)) {
    await deleteMessage(chatId, msg.message_id).catch(() => {});
    await sendMessage(
      chatId,
      `⚠️ ${escapeHtml(senderName(msg))}, login va parolni guruhga yozmang — xavfsizlik uchun xabar o‘chirildi.\nUlarni faqat <b>@${bot.username}</b> shaxsiy chatiga yuboring yoki <b>${SITE_LABEL}</b> saytida kiriting.`,
      { reply_markup: await loginKeyboard() },
    );
    return;
  }

  const direct = isDirectToBot(msg, bot);
  let answer = answerFor(text, chatId);
  if (!answer && direct) answer = ANSWERS.where();
  if (!answer) return;

  const norm = normalizeForMatch(text);
  if (!direct) {
    const last = lastReplyByUser.get(`${chatId}:${msg.from.id}`) ?? 0;
    if (Date.now() - last < USER_COOLDOWN_MS) return;
    if (isDuplicate(chatId, msg.from.id, norm)) return;
  }
  if (!chatBudgetOk(chatId)) return;

  await replyTo(msg, answer);
  markReplied(chatId, msg.from.id);
}

/**
 * Shaxsiy chat: login/parol bo‘lmagan matn (yoki rasm izohi).
 * true — javob yuborildi.
 */
export async function handlePrivateSupportMessage(msg: TelegramMessage): Promise<boolean> {
  if (!msg.from || msg.from.is_bot) return false;
  const answer = answerFor(messageText(msg), msg.chat.id);
  if (!answer) return false;
  await replyTo(msg, answer);
  return true;
}
