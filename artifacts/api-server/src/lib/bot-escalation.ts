/**
 * AI yecha olmagan platforma muammolarini egaga (AI+admin guruh) yuborish.
 * Guruh: -1003919162525 — faqat holat + nima qilish; suhbat matni emas.
 * «Bajarildi» tugmasi / «bajardim» — xodimga xabar.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, employeesTable, usersTable } from "@workspace/db";
import { coordinatorsFor } from "./davomat-shift-report";
import { logger } from "./logger";
import {
  answerCallbackQuery,
  editMessageReplyMarkup,
  sendMessage,
  type InlineKeyboardButton,
  type TelegramCallbackQuery,
} from "./telegram";

/** AI + Saidmuhammad ish guruh */
export const AI_OWNER_GROUP_ID = -1003919162525;

const TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_OPEN = 200;

export type EscalationTicket = {
  id: string;
  createdAt: number;
  userChatId: number;
  userTelegramId: string;
  userName: string;
  role: string;
  issueSummary: string;
  actionNeeded: string;
  platformHint: string;
  businessConnectionId?: string | null;
  resolved: boolean;
};

const tickets = new Map<string, EscalationTicket>();

function prune() {
  const now = Date.now();
  for (const [id, t] of tickets) {
    if (t.resolved || now - t.createdAt > TTL_MS) tickets.delete(id);
  }
  if (tickets.size > MAX_OPEN) {
    const oldest = [...tickets.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (let i = 0; i < oldest.length - MAX_OPEN; i++) {
      tickets.delete(oldest[i]![0]);
    }
  }
}

function newId(): string {
  return randomBytes(4).toString("hex");
}

/** Gemini javobida yoki matnda — yechilmagan / egaga uzatish */
export function looksNeedsEscalation(reply: string, userText: string): boolean {
  const r = reply.toLowerCase();
  const u = userText.toLowerCase();
  if (/\[ESCALATE\]|ESCALATE_NEEDED|egaga\s*yubor|admin\s*guruhga/i.test(reply)) return true;
  if (/men\s*hal\s*qila\s*olmadim|qo['‘’]?lda\s*kerak|texnik\s*xato.*yubor/i.test(r)) return true;
  // Xodim qayta-qayta «ishlamayapti / ochilmayapti / xato» + yechim yo‘q
  if (
    /ishlamay|ochilmay|xato|error|saqlanmay|yuz\s*tan|face.*ishlam|gps|geofence|bloklangan|kirilmay/i.test(
      u,
    ) &&
    /bilmadim|aniq\s*ayta\s*olmadim|skrinshot|qayta\s*urin|admin/i.test(r)
  ) {
    return true;
  }
  return false;
}

/** Oddiy kech/davomat — escalate qilmaslik */
export function isSimpleAttendanceExcuse(text: string): boolean {
  const t = text.toLowerCase();
  return /kech\s*qol|kechik|guruhga\s*yoz|davomatni\s*tuzat|vaqtni\s*tuzat|kelmadim|kelmagan/.test(t);
}

export function shortActionFromIssue(userText: string): string {
  const t = userText.toLowerCase();
  if (/face|yuz|kamera/.test(t)) return "Face ID / kamerani tekshirish yoki qayta ulash.";
  if (/login|parol|kirish|kirilmay/.test(t)) return "Login/parol yoki akkaunt holatini tekshirish.";
  if (/gps|geofence|joylashuv|30\s*metr|100\s*metr/.test(t)) return "GPS/geofence / filial koordinatasini tekshirish.";
  if (/qr/.test(t)) return "QR token / filial QR holatini tekshirish.";
  if (/oylik|maosh/.test(t)) return "Oylik hisob / ruxsatni tekshirish.";
  if (/test|atestat/.test(t)) return "Atestatsiya ochiqligi / urinishni tekshirish.";
  if (/blok/.test(t)) return "Blok sababini ochish yoki yechish.";
  if (looksStaffingChangeRequest(t)) {
    return "Hurmatli koordinator, iltimos HR ga chiqing: smena/rotatsiya/ko‘chirish bo‘yicha asos bilan so‘rov bering.";
  }
  return "Platforma holatini tekshirib, kerakli tuzatishni qilish.";
}

/** Smena qo‘yish, rotatsiya, filialga ko‘chirish — AI o‘zgartirmaydi */
export function looksStaffingChangeRequest(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`']/g, "'");
  return /smena(ga)?\s*(qo.?y|o'?zgart|almashtir)|(\d-?\s*smena)|rotatsiya|ko'?chir|filial(ga|dan)|boshqa\s*filial|smenaga\s*qo.?y|faqat\s*bugun.*(smena)|smena.*bugun|xodimni\s*(ko'?chir|almashtir)|dostup\s*yo'?q|ruxsat\s*yo'?q\s*mudir|mudirda\s*(dostup|ruxsat)\s*yo'?q/.test(
    t,
  );
}

const staffingSessions = new Map<string, { at: number; lastText: string }>();
const STAFFING_TTL = 20 * 60_000;

export function rememberStaffingRequest(sessionKey: string, text: string) {
  staffingSessions.set(sessionKey, { at: Date.now(), lastText: text.slice(0, 400) });
}

export function takeStaffingContext(sessionKey: string): string | null {
  const s = staffingSessions.get(sessionKey);
  if (!s || Date.now() - s.at > STAFFING_TTL) {
    staffingSessions.delete(sessionKey);
    return null;
  }
  return s.lastText;
}

export function clearStaffingSession(sessionKey: string) {
  staffingSessions.delete(sessionKey);
}

export type CoordinatorContact = {
  name: string;
  phone: string | null;
  employeeId: number;
};

/** Xodimning koordinatori (ism + telefon) */
export async function resolveCoordinatorContactForUser(
  userId: number | null | undefined,
): Promise<CoordinatorContact | null> {
  if (!userId) return null;
  try {
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, userId))
      .limit(1);
    if (!emp) return null;
    const map = await coordinatorsFor([emp.id]);
    const hit = map.get(emp.id);
    if (!hit?.name) return null;
    let phone: string | null = null;
    if (hit.userId) {
      const [u] = await db
        .select({ phone: usersTable.phone })
        .from(usersTable)
        .where(eq(usersTable.id, hit.userId))
        .limit(1);
      phone = u?.phone?.trim() || null;
    }
    return { name: hit.name, phone, employeeId: hit.id };
  } catch (err) {
    logger.warn({ err, userId }, "bot-escalation: coordinator contact");
    return null;
  }
}

export function isPharmacyLineRole(role?: string | null): boolean {
  const r = String(role || "").toLowerCase();
  return /farmasevt|stajyor|mudir|sotuvchi|kassir|apteka/.test(r);
}

function pickVariant(seed: string, variants: string[]): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 1)) % 9973;
  return variants[h % variants.length]!;
}

/**
 * Oylik muammo — hisobot/tasdiq statusi aytilmaydi.
 * Farmasevt/mudir/stajyor: «Koordinatoringizni xabardor qiling».
 * Ofis: «HR ga murojaat qiling».
 */
export async function handleUnpaidSalaryIssue(input: {
  userChatId: number;
  userTelegramId: string;
  userName: string;
  role?: string;
  userId?: number | null;
  userText: string;
  businessConnectionId?: string | null;
}): Promise<{ sent: boolean; userReply: string }> {
  const pharmacy = isPharmacyLineRole(input.role);
  const coord = await resolveCoordinatorContactForUser(input.userId ?? null);
  const coordLine = coord
    ? [
        `Koordinatoringiz: ${coord.name}`,
        coord.phone ? `Telefon: ${coord.phone}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "Filial koordinatoringizga murojaat qiling.";

  if (pharmacy) {
    // Mas’ullarga qisqa signal (xodimga draft/tasdiq demaymiz)
    const esc = await escalateToOwnerGroup({
      userChatId: input.userChatId,
      userTelegramId: input.userTelegramId,
      userName: input.userName,
      role: input.role,
      userText: input.userText,
      platformHint: coord
        ? `OYLIK MUAMMO — Koordinator: ${coord.name}${coord.phone ? ` · ${coord.phone}` : ""}`
        : "OYLIK MUAMMO — koordinator/HR",
      businessConnectionId: input.businessConnectionId,
    });

    const userReply = pickVariant(input.userText + String(input.userChatId), [
      [
        "Tushundim — oylik bo‘yicha muammo borligini aytdingiz.",
        "",
        "Iltimos, koordinatoringizni xabardor qiling — ular vaziyatni ko‘rib chiqadi.",
        "",
        coordLine,
      ].join("\n"),
      [
        "Oylik masalasini eshitdim.",
        "",
        "Farmasevt / mudir / stajyor uchun: koordinatoringizni xabardor qiling.",
        "",
        coordLine,
      ].join("\n"),
      [
        "Aniq tushundim.",
        "",
        "Bu bo‘yicha koordinatoringizni xabardor qiling.",
        coordLine,
        "",
        "Men faqat yordamchiman — oylikni o‘zim hal qila olmayman.",
      ].join("\n"),
    ]);

    return { sent: esc.sent, userReply };
  }

  const userReply = pickVariant(input.userText + (input.role || ""), [
    [
      "Tushundim — oylik bo‘yicha muammo borligini aytdingiz.",
      "",
      "Ofis xodimi sifatida iltimos HR ga murojaat qiling.",
      "Men faqat yordamchiman — to‘lovni o‘zim qila olmayman.",
    ].join("\n"),
    [
      "Oylik masalasini eshitdim.",
      "",
      "HR ga murojaat qiling — ular tekshirib javob beradi.",
      "Men AI yordamchiman.",
    ].join("\n"),
    [
      "Aniq tushundim.",
      "",
      "Bu masala HR orqali hal qilinadi. Iltimos, HR ga murojaat qiling.",
      "Men faqat yordamchiman.",
    ].join("\n"),
  ]);

  return { sent: false, userReply };
}

/** Koordinator → HR (asos bilan rotatsiya/ko‘chirish/smena) */
export async function escalateStaffingChange(input: {
  userChatId: number;
  userTelegramId: string;
  userName: string;
  role?: string;
  userId?: number | null;
  userText: string;
  priorText?: string | null;
  businessConnectionId?: string | null;
}): Promise<{ sent: boolean; ticketId: string; userReply: string }> {
  const combined = [input.priorText, input.userText].filter(Boolean).join(" | ").slice(0, 500);
  const coord = await resolveCoordinatorContactForUser(input.userId ?? null);
  const coordLine = coord
    ? [
        `Sizning koordinatoringiz: ${coord.name}`,
        coord.phone ? `Telefon: ${coord.phone}` : "Telefon: bazada ko‘rsatilmagan",
      ].join("\n")
    : "Koordinatoringiz bazada topilmadi — filial bo‘yicha koordinatoringizga murojaat qiling.";

  const pharmacy = isPharmacyLineRole(input.role);
  const esc = await escalateToOwnerGroup({
    userChatId: input.userChatId,
    userTelegramId: input.userTelegramId,
    userName: input.userName,
    role: input.role,
    userText: combined || input.userText,
    platformHint: coord
      ? `SMENA/ROTATSIYA — Koordinator: ${coord.name}${coord.phone ? ` · ${coord.phone}` : ""}. Iltimos HR ga asos bilan chiqing.`
      : "SMENA / ROTATSIYA / KO‘CHIRISH — AI o‘zgartirmaydi. Hurmatli koordinator, iltimos HR ga asos bilan chiqing.",
    businessConnectionId: input.businessConnectionId,
  });

  // Farmasevt / mudir / stajyor: avval koordinatorni xabardor qiling + kontakt
  const userReply = pharmacy
    ? [
        "Tushundim.",
        "",
        "Avval koordinatoringizni xabardor qiling.",
        "Ularga ayting: iltimos, HR ga chiqing va asos bilan so‘rov bering",
        "(rotatsiya, smena o‘zgartirish yoki ko‘chirish).",
        "",
        coordLine,
        "",
        "Men smenani o‘zim o‘zgartira olmayman (faqat o‘qish).",
        esc.sent ? "Shu bilan HR/admin guruhiga ham xabar ketdi." : "",
      ]
        .filter(Boolean)
        .join("\n")
    : [
        "Tushundim. Men smena, rotatsiya yoki ko‘chirishni o‘zim o‘zgartira olmayman.",
        "",
        "Avval koordinatorni xabardor qiling.",
        "Koordinator HR ga asos bilan chiqishi kerak (rotatsiya / smena / ko‘chirish).",
        "",
        coordLine,
        "",
        esc.sent ? "So‘rov HR/admin guruhiga yuborildi." : "Iltimos, yuqoridagi koordinatorga yetkazing.",
      ].join("\n");

  return { sent: esc.sent, ticketId: esc.ticketId, userReply };
}

export async function escalateToOwnerGroup(input: {
  userChatId: number;
  userTelegramId: string;
  userName: string;
  role?: string;
  userText: string;
  platformHint?: string;
  businessConnectionId?: string | null;
}): Promise<{ ticketId: string; sent: boolean }> {
  prune();
  const id = newId();
  const actionNeeded = shortActionFromIssue(input.userText);
  const issueSummary = String(input.userText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
  const ticket: EscalationTicket = {
    id,
    createdAt: Date.now(),
    userChatId: input.userChatId,
    userTelegramId: input.userTelegramId,
    userName: input.userName || "Xodim",
    role: input.role || "—",
    issueSummary,
    actionNeeded,
    platformHint: (input.platformHint || "Platforma jarayoni").slice(0, 200),
    businessConnectionId: input.businessConnectionId || null,
    resolved: false,
  };
  tickets.set(id, ticket);

  const text = [
    `<b>🛠 AI → qo‘lda</b> · #${id}`,
    "",
    `<b>Kim:</b> ${escapeHtml(ticket.userName)} (${escapeHtml(ticket.role)})`,
    `<b>TG:</b> <code>${escapeHtml(ticket.userTelegramId)}</code>`,
    `<b>Holat:</b> ${escapeHtml(ticket.platformHint)}`,
    `<b>Muammo (qisqa):</b> ${escapeHtml(issueSummary || "—")}`,
    "",
    `<b>Sizdan:</b> ${escapeHtml(actionNeeded)}`,
    "",
    "Tugatgach «Bajarildi» ni bosing yoki shu yerga <code>bajardim #" + id + "</code> yozing.",
  ].join("\n");

  const keyboard: { inline_keyboard: InlineKeyboardButton[][] } = {
    inline_keyboard: [[{ text: "✅ Bajarildi", callback_data: `esc_done:${id}` }]],
  };

  try {
    await sendMessage(AI_OWNER_GROUP_ID, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    return { ticketId: id, sent: true };
  } catch (err) {
    logger.warn({ err, id }, "bot-escalation: send group failed");
    tickets.delete(id);
    return { ticketId: id, sent: false };
  }
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function resolveTicket(
  ticket: EscalationTicket,
  resolverName: string,
): Promise<boolean> {
  if (ticket.resolved) return false;
  ticket.resolved = true;
  const msg =
    "✅ <b>Hal qilindi.</b>\nMuammo qo‘lda ko‘rib chiqildi. Qayta urinib ko‘ring.";
  try {
    await sendMessage(ticket.userChatId, msg, {
      parse_mode: "HTML",
      business_connection_id: ticket.businessConnectionId || undefined,
    });
  } catch (err) {
    logger.warn({ err, id: ticket.id }, "bot-escalation: notify user");
  }
  logger.info(
    { id: ticket.id, by: resolverName, user: ticket.userTelegramId },
    "bot-escalation: resolved",
  );
  return true;
}

/** Callback: esc_done:hex */
export async function handleEscalationCallback(cq: TelegramCallbackQuery): Promise<boolean> {
  const data = cq.data || "";
  const m = /^esc_done:([a-f0-9]+)$/i.exec(data);
  if (!m) return false;
  const id = m[1]!;
  const ticket = tickets.get(id);
  await answerCallbackQuery(cq.id, ticket?.resolved ? "Allaqachon bajarilgan" : "OK").catch(
    () => {},
  );
  if (!ticket) {
    if (cq.message?.chat.id) {
      await sendMessage(cq.message.chat.id, `Ticket #${id} topilmadi yoki eskirgan.`, {
        reply_to_message_id: cq.message.message_id,
      }).catch(() => {});
    }
    return true;
  }
  const who = [cq.from.first_name, cq.from.last_name].filter(Boolean).join(" ") || "admin";
  const ok = await resolveTicket(ticket, who);
  if (cq.message?.chat.id && cq.message.message_id) {
    await editMessageReplyMarkup(cq.message.chat.id, cq.message.message_id, {
      inline_keyboard: [[{ text: ok ? "✅ Bajarildi ✓" : "Allaqachon ✓", callback_data: `esc_done:${id}` }]],
    }).catch(() => {});
    if (ok) {
      await sendMessage(
        cq.message.chat.id,
        `✅ #${id} — xodimga «Hal qilindi» yuborildi.`,
        { reply_to_message_id: cq.message.message_id },
      ).catch(() => {});
    }
  }
  return true;
}

/** Guruhda «bajardim #id» yoki «bajarildi #id» */
export async function handleEscalationGroupText(
  chatId: number,
  text: string,
  fromName: string,
): Promise<boolean> {
  if (Number(chatId) !== AI_OWNER_GROUP_ID) return false;
  const m = /(?:bajardim|bajarildi|done)\s*#?\s*([a-f0-9]{6,10})/i.exec(text || "");
  if (!m) return false;
  const ticket = tickets.get(m[1]!);
  if (!ticket) {
    await sendMessage(chatId, `Ticket #${m[1]} topilmadi.`).catch(() => {});
    return true;
  }
  const ok = await resolveTicket(ticket, fromName || "admin");
  await sendMessage(
    chatId,
    ok ? `✅ #${ticket.id} — xodimga xabar ketdi.` : `Ticket #${ticket.id} allaqachon yopilgan.`,
  ).catch(() => {});
  return true;
}

export const WAIT_FOR_OWNER_REPLY =
  "So‘rovingizni mas’ulga yetkazdim — biroz kuting.\nHal bo‘lgach shu yerda xabar beraman.";

/** Texnik escalate qilinmasin (jarima/shikoyat/tushuntirish; oylik OLINMAGAN — alohida yo‘l) */
export function looksNonEscalatableQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`']/g, "'");
  // «oylik ololmadim» — handleUnpaidSalaryIssue da alohida; bu yerda bloklamaymiz
  if (
    /oylik.*(olol|olmadi|kelmadi|berilmadi)|maosh.*(olol|olmadi|kelmadi)/.test(t)
  ) {
    return false;
  }
  return /shtraf|штраф|jarima|oylik|nima(ni)?\s*tuzat|nima\s*qilding|hal\s*qilindi|ushlab|kechik.*nega|nega\s*jarima|shiko[y']?at|шикоят|norozi|норози|mijoz.*shik|klient.*shik|nima\s*b[ou]ladi|что\s*будет|endi\s*manda|к[уў]п\s*б[уў]лади/.test(
    t,
  );
}

/** Mijoz shikoyati / «nima bo‘ladi» — tinchlantirish, escalate emas */
export function looksCustomerComplaintConcern(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`']/g, "'");
  return /shiko[y']?at|шикоят|norozi|норози|mijoz.*(norozi|shik)|klient.*(norozi|shik)|mandan\s*norozi|menda\s*shik|nima\s*b[ou]ladi|что\s*будет|endi\s*manda.*(kup|ko'?p)|к[уў]п\s*б[уў]лади/.test(
    t,
  );
}

export const COMPLAINT_REASSURE_REPLY = [
  "Hech qisi yo‘q — xavotir olmang.",
  "Barcha shikoyat va fikrlarni HR lar nazorat qiladi, tahlil qiladi, keyin xulosa beradi.",
  "Siz ishlashda davom eting, odatdagidek mijozlarga yaxshi xizmat qiling.",
  "Agar aniq holat bo‘lsa, koordinatoringizga xabar berishingiz mumkin — lekin panika kerak emas.",
].join("\n");

export const SHORT_LATE_REPLY = [
  "Davomat faqat platformada (vaksinahr.uz / Face ID / QR).",
  "Guruhga yozilgan davomat qabul qilinmaydi.",
  "Vaqtida platformadan «Keldim» qiling.",
].join("\n");

export const SHORT_SABABLI_REPLY = [
  "Sababli kechikish / kelmaslik bo‘lsa:",
  "1) Koordinator va HR ni oldindan ogohlantiring.",
  "2) Davomat baribir faqat platformadan o‘tadi.",
  "3) Tasdiqlovchi sababni (kerak bo‘lsa) tayyorlab turing.",
].join("\n");

export function looksSababliAbsence(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`]/g, "'");
  if (looksAttendanceSelfMistake(t)) return false;
  return /sabab(li)?|kasal|shifokor|to'y|vafot|ruxsat|ogohlantir|kelolmay|chiqa\s*olmay|uzr/.test(
    t,
  );
}

/**
 * Xodim o‘zi tugmani noto‘g‘ri bosgan / bir vaqtda Keldim+Ketdim /
 * smenani yopishda xato — davomat TUZATILMAYDI, sabab + o‘rgatish.
 */
export function looksAttendanceSelfMistake(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`']/g, "'");
  if (
    /davomatni\s*(tuzat|to'?g'?rila|o'?zgart)|vaqtni\s*(tuzat|to'?g'?rila)|исправ.*(давом|посещ|время)|поправ.*(давом|время)|tuzatib\s*ber/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /(keldim|ketdim|келдим|кетдим|приш|уш[её]л).{0,40}(bir\s*vaqt|одновременно|сразу|ikkita|два\s*раза|двух|xato|ошиб|неправиль|noto'?g'?ri)/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /(smena|смен).{0,40}(yop|закры|продолж|davom\s*et)|продолжить|davom\s*etish|tugma.*(bos|нажал)|нажал.*(кнопк|продолж)/.test(
      t,
    ) &&
    /(kel|приш|вечером|kechqurun|ertalab|утр|xato|ошиб|получилось|chiqib|закрыл)/.test(t)
  ) {
    return true;
  }
  if (
    /(ertalab|утр).{0,80}(kechqurun|вечером|вечер).{0,80}(keldim|ketdim|приш|закрыл|yozilib|записа)/.test(
      t,
    ) ||
    /(kechqurun|вечером).{0,60}(keldim|приш).{0,40}(ketdim|закрыл|уш[её]л)/.test(t)
  ) {
    return true;
  }
  return false;
}

function pickTeach(seed: string, variants: string[]): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * (i + 1)) % 9973;
  return variants[h % variants.length]!;
}

/** Davomat umuman tuzatilmaydi — sabab + e’tibor */
export function attendanceMistakeTeachReply(userText = ""): string {
  return pickTeach(userText || "davomat", [
    [
      "Tushundim.",
      "",
      "Sabab: siz bir vaqtda «Keldim» va «Ketdim» qilib yuborgansiz (yoki smenani yopishda tugmani noto‘g‘ri bosgansiz). Shu uchun tizimda qisqa vaqt ko‘rinadi.",
      "",
      "Muhim: davomat KEYIN tuzatilmaydi — HR ham «to‘g‘rilab qo‘ymaydi».",
      "Iltimos, e’tiborli bo‘ling: doim o‘z vaqtida, to‘g‘ri tugma bilan davomat qiling.",
      "Ertalab — faqat Keldim; smena oxirida — faqat Ketdim. Bir marta, aniq bosing.",
    ].join("\n"),
    [
      "Holat aniq: bir vaqtda Keldim va Ketdim bo‘lib qolgan.",
      "",
      "Davomat tuzatilmaydi. Bu platforma qoidasi — hech kim keyin qo‘lda «tuzatib» bermaydi.",
      "",
      "E’tiborli bo‘ling. Keyingi safar har bir tugmani o‘z vaqtida bosing: kelishda Keldim, ketishda Ketdim.",
    ].join("\n"),
    [
      "Siz bir vaqtda kelish va ketishni belgilab yuborgansiz — shu sababdan yozuv chalkash ko‘rinadi.",
      "",
      "Davomat umuman to‘g‘rilanmaydi. «HR tuzatadi» deb kutmang.",
      "Doim o‘z vaqtida davomat qiling va tugmalarni e’tibor bilan bosing.",
    ].join("\n"),
  ]);
}

