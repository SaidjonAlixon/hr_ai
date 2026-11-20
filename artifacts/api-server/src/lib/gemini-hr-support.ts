/**
 * Vaksina Med HR — Telegram Gemini yordamchi (Google AI Studio bepul token).
 * Matn/rasm/ovoz/video: platforma savollariga qisqa javob; ovoz/videoga ovozli javob.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildHelpSystemPrompt } from "./platform-help-kb";
import {
  buildPersonalBotContext,
  findLinkedUserByTelegram,
  looksPersonalDataQuestion,
} from "./personal-bot-context";
import {
  buildAttendanceReplyUz,
  buildScopedBahoQrPdf,
  loadMajburiyatPdf,
  looksAttendanceQuestion,
  looksAttendanceTrouble,
  looksBahoQrRequest,
  looksMajburiyatRequest,
} from "./bot-attendance-docs";
import {
  attendanceMistakeTeachReply,
  clearStaffingSession,
  escalateStaffingChange,
  escalateToOwnerGroup,
  handleUnpaidSalaryIssue,
  isSimpleAttendanceExcuse,
  looksAttendanceSelfMistake,
  looksNeedsEscalation,
  COMPLAINT_REASSURE_REPLY,
  looksCustomerComplaintConcern,
  looksNonEscalatableQuestion,
  looksSababliAbsence,
  looksStaffingChangeRequest,
  rememberStaffingRequest,
  SHORT_LATE_REPLY,
  SHORT_SABABLI_REPLY,
  takeStaffingContext,
  WAIT_FOR_OWNER_REPLY,
} from "./bot-escalation";
import {
  buildMonthAttendancePack,
  buildMonthAttendancePdf,
  formatMonthAttendanceText,
  formatFineExplainReply,
  looksAttendancePdfRequest,
  looksFineComplaint,
  looksOylikOrJarimaQuestion,
  looksUnpaidSalaryIssue,
  wantsPdf,
} from "./bot-staff-reports";
import {
  ATTENDANCE_TROUBLE_REPLY,
  ATTENDANCE_WRITE_BLOCKED_REPLY,
  clearTaskDraft,
  hasActiveTaskDraft,
  looksAttendanceWriteRequest,
  looksTaskCreateIntent,
} from "./bot-task-agent";
import {
  handleDoMyTasksTurn,
  hasActiveExecSession,
  looksDoMyTasksIntent,
  looksMyAssignedTasksIntent,
} from "./bot-task-execute";
import {
  handleCreatedTasksTurn,
  hasActiveCreatedTasksSession,
  looksTasksICreatedIntent,
} from "./bot-task-created";
import { logger } from "./logger";
import {
  downloadTelegramFile,
  publicAppUrl,
  sendChatAction,
  sendDocument,
  sendMessage,
  sendVoice,
  type InlineKeyboardButton,
  type TelegramMessage,
} from "./telegram";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

type HistTurn = { role: "user" | "model"; text: string; hasImage?: boolean };
type MediaPart = { mimeType: string; base64: string };

type Session = {
  turns: HistTurn[];
  updatedAt: number;
  fullName?: string;
  role?: string;
  userId?: number;
  personalCache?: { at: number; text: string; linked: boolean };
};

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 45 * 60_000;
const MAX_TURNS = 16;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 25;
const recentCalls = new Map<string, number[]>();
const groupChatReplies = new Map<number, number[]>();
const GROUP_WINDOW_MS = 60_000;
const GROUP_MAX_REPLIES = 18;

/** Guruhda: salom / sheyda / platforma / shaxsiy savol — javob */
export function looksPlatformRelated(text: string): boolean {
  const q = text.toLowerCase().trim();
  if (!q) return false;
  // Har qanday qisqa murojaat / «bor misiz» — javob bersin
  if (
    /^(salom|assalom|hello|hi|hey|ваалейкум|привет|sheyda|qale|qalesan|yaxshimisiz|zor\s*mi)\b/.test(
      q,
    )
  ) {
    return true;
  }
  if (/sheyda|bor\s*mi|bormi|eshityapsiz|javob\s*ber|qalesan|yaxshimisiz/.test(q)) return true;
  return /davomat|face|id|qr|smena|shift|login|parol|kirish|kir|sayt|sait|havola|xavola|ssilka|link|oylik|jarima|vazifa|topshiriq|task|apteka|filial|gps|joylashuv|geofence|keldim|ketdim|blok|skrin|screenshot|xato|error|ishlamay|ochilmay|saqlan|platform|vaksina|hr|bot|yordam|help|test|atestat|checklist|ombor|mudir|farmasevt|stajyor|telegram|mini.?app|akkaunt|profil|mening|menda|bor\s*mi|qayerdan|qanday|nima qil|vxod|voyti|saidmuhammad|majburiyat|baho|qaytarib|maosh|pdf|kechik|ushlab|bajaryap/.test(
    q,
  );
}

function tashkentHourNow(): number {
  const raw = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  const h = Number(raw);
  return Number.isFinite(h) ? h : new Date().getUTCHours() + 5;
}

/** 18:00 dan keyin (Toshkent) — HR dam, bot o‘rniga javob beradi */
function isAfterHoursTashkent(hour = tashkentHourNow()): boolean {
  return hour >= 18 || hour < 9;
}

/** Faqat aniq «qanday kiraman / login / parol» — oddiy suhbatni ushlamaydi */
function looksLikeLoginHelp(text: string): boolean {
  const q = text.toLowerCase().replace(/[‘’ʻ`']/g, "'");
  return /qanday\s*kir|qayerdan\s*kir|login|parol|mini.?app|vaksinahr\.uz|sayt(ga)?\s*kir|havola\s*(ber|kerak)|ssilka|vxod|voyti|zayti|kirish\s*(havola|link|qanday)|akkaunt(ni)?\s*ula/.test(
    q,
  );
}

function platformLoginKeyboard(): { inline_keyboard: InlineKeyboardButton[][] } {
  const site = (publicAppUrl() || "https://vaksinahr.uz").replace(/\/$/, "") || "https://vaksinahr.uz";
  return {
    inline_keyboard: [
      [
        { text: "🌐 vaksinahr.uz", url: site.startsWith("http") ? site : "https://vaksinahr.uz" },
        { text: "🤖 @vaksinahrbot", url: "https://t.me/vaksinahrbot" },
      ],
    ],
  };
}

function geminiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim() || null;
}

function geminiModel(): string {
  return (
    process.env.GEMINI_HR_MODEL?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    "gemini-flash-lite-latest"
  );
}

function geminiTtsModel(): string {
  return process.env.GEMINI_TTS_MODEL?.trim() || "gemini-2.5-flash-preview-tts";
}

function geminiTtsVoice(): string {
  return process.env.GEMINI_TTS_VOICE?.trim() || "Kore";
}

/** GEMINI_HR_ENABLED=0 bo‘lmasa va kalit bo‘lsa — yoqilgan */
export function geminiHrEnabled(): boolean {
  const flag = process.env.GEMINI_HR_ENABLED?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return Boolean(geminiKey());
}

function looksLikeUiError(text: string): boolean {
  const q = text.toLowerCase();
  return /xato|error|ishlamay|ochilmay|ko.?rinmay|qotib|crash|bug|ekran|skrin|screenshot|rasm|yuklanmay|403|404|500|failed|rad et|tanima|blok|timeout|spinner|kelmay|saqlanmay|o.?zgarmay|не работ|ошибк/.test(
    q,
  );
}

function rateLimited(key: string): boolean {
  const now = Date.now();
  const prev = (recentCalls.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX) {
    recentCalls.set(key, prev);
    return true;
  }
  prev.push(now);
  recentCalls.set(key, prev);
  return false;
}

function getSession(key: string): Session {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now - s.updatedAt > SESSION_TTL_MS) sessions.delete(k);
  }
  let s = sessions.get(key);
  if (!s) {
    s = { turns: [], updatedAt: now };
    sessions.set(key, s);
  }
  s.updatedAt = now;
  return s;
}

const PERSONAL_CACHE_MS = 45_000;

async function getPersonalContext(
  session: Session,
  telegramId: string,
): Promise<{ linked: boolean; text: string }> {
  const cached = session.personalCache;
  if (cached && Date.now() - cached.at < PERSONAL_CACHE_MS) {
    return { linked: cached.linked, text: cached.text };
  }
  const ctx = await buildPersonalBotContext(telegramId);
  if (ctx.user) {
    session.fullName = ctx.user.fullName;
    session.role = ctx.user.role;
    session.userId = ctx.user.id;
  }
  session.personalCache = { at: Date.now(), text: ctx.text, linked: ctx.linked };
  return { linked: ctx.linked, text: ctx.text };
}

function largestPhotoFileId(msg: TelegramMessage): string | null {
  const photos = msg.photo;
  if (photos?.length) {
    const best = [...photos].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
    return best?.file_id || null;
  }
  const doc = msg.document;
  if (doc?.mime_type?.startsWith("image/") && doc.file_id) return doc.file_id;
  return null;
}

function mediaFileFromMessage(msg: TelegramMessage): {
  fileId: string;
  kind: "voice" | "video" | "audio";
  hintMime?: string;
} | null {
  if (msg.voice?.file_id) {
    return { fileId: msg.voice.file_id, kind: "voice", hintMime: msg.voice.mime_type || "audio/ogg" };
  }
  if (msg.video_note?.file_id) {
    return { fileId: msg.video_note.file_id, kind: "video", hintMime: "video/mp4" };
  }
  if (msg.video?.file_id) {
    return {
      fileId: msg.video.file_id,
      kind: "video",
      hintMime: msg.video.mime_type || "video/mp4",
    };
  }
  if (msg.audio?.file_id) {
    return {
      fileId: msg.audio.file_id,
      kind: "audio",
      hintMime: msg.audio.mime_type || "audio/mpeg",
    };
  }
  return null;
}

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr?.on("data", (d) => {
      err += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${err.slice(0, 240)}`));
    });
  });
}

/** Gemini TTS PCM (24kHz mono s16le) yoki WAV → Telegram OGG/Opus */
async function toOggOpus(raw: Buffer, mimeHint?: string): Promise<Buffer | null> {
  const id = randomBytes(8).toString("hex");
  const tmp = os.tmpdir();
  const inPath = path.join(tmp, `hr-tts-in-${id}`);
  const outPath = path.join(tmp, `hr-tts-out-${id}.ogg`);
  try {
    await fs.writeFile(inPath, raw);
    const isWav =
      mimeHint?.includes("wav") ||
      (raw.length > 12 && raw.subarray(0, 4).toString("ascii") === "RIFF");
    if (isWav) {
      await runCmd("ffmpeg", ["-y", "-i", inPath, "-c:a", "libopus", "-b:a", "48k", outPath]);
    } else {
      await runCmd("ffmpeg", [
        "-y",
        "-f",
        "s16le",
        "-ar",
        "24000",
        "-ac",
        "1",
        "-i",
        inPath,
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        outPath,
      ]);
    }
    return await fs.readFile(outPath);
  } catch (err) {
    logger.warn({ err }, "gemini-hr: ffmpeg ogg");
    return null;
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}

function plainForSpeech(text: string): string {
  return stripHrMentions(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`~#]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

async function synthesizeVoiceOgg(text: string): Promise<Buffer | null> {
  const key = geminiKey();
  if (!key) return null;
  const speak = plainForSpeech(text);
  if (!speak) return null;

  const model = geminiTtsModel();
  const url = `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(55_000),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `O‘zbek tilida, tabiiy va qisqa ohangda ayt: ${speak}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: geminiTtsVoice() },
            },
          },
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      logger.warn({ status: res.status, errText: errText.slice(0, 280) }, "gemini-hr: tts http");
      return null;
    }
    const body = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
      }>;
    };
    const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const b64 = part?.inlineData?.data;
    if (!b64) return null;
    const raw = Buffer.from(b64, "base64");
    return await toOggOpus(raw, part?.inlineData?.mimeType);
  } catch (err) {
    logger.warn({ err }, "gemini-hr: tts");
    return null;
  }
}

async function callGemini(opts: {
  system: string;
  history: HistTurn[];
  userText: string;
  image?: MediaPart | null;
  media?: MediaPart | null;
}): Promise<string | null> {
  const key = geminiKey();
  if (!key) return null;
  const model = geminiModel();

  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
  for (const t of opts.history.slice(-MAX_TURNS)) {
    contents.push({
      role: t.role === "model" ? "model" : "user",
      parts: [{ text: t.text }],
    });
  }

  const userParts: Array<Record<string, unknown>> = [];
  if (opts.image) {
    userParts.push({
      inline_data: {
        mime_type: opts.image.mimeType,
        data: opts.image.base64,
      },
    });
  }
  if (opts.media) {
    userParts.push({
      inline_data: {
        mime_type: opts.media.mimeType,
        data: opts.media.base64,
      },
    });
  }
  userParts.push({
    text:
      opts.userText ||
      (opts.image
        ? "Skrinshotni ko‘rib chiqing va muammoni tushuntiring."
        : opts.media
          ? "Ovoz/videoni tinglang va qisqa javob bering."
          : ""),
  });
  contents.push({ role: "user", parts: userParts });

  const url = `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(22_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents,
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 520,
          topP: 0.9,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      logger.warn({ status: res.status, errText: errText.slice(0, 300) }, "gemini-hr: http");
      return null;
    }
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
    return text || null;
  } catch (err) {
    logger.warn({ err }, "gemini-hr: fetch");
    return null;
  }
}

/** HR’ni Telegram’da atmetka qilmaslik */
function stripHrMentions(text: string): string {
  return text
    .replace(/@saidmuhammadalixon_hr\b/gi, "Saidmuhammadalixon")
    .replace(/@saidmuhammadalixon\b/gi, "Saidmuhammadalixon")
    .replace(/\bsaidmuhammadalixon_hr\b/gi, "Saidmuhammadalixon");
}

function escapeForTelegramHtml(text: string): string {
  return stripHrMentions(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^#{1,3}\s+/gm, "")
    .slice(0, 3900);
}

/** «Kech qoldim, guruhga yozdim / vaqtni tuzating» — qat’iy rad */
export function looksLikeLateGroupExcuse(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`]/g, "'");
  if (!t.trim()) return false;
  const lateOrFix =
    /kech\s*qol|kechik|kech\s*qolib|опозд|vaqtni\s*(to'?g'?ri|tuzat|o'?zgart|otkaz|o'tkaz)|ertalabki\s*vaqt|bazadagi\s*vaqt|davomatni\s*(tuzat|o'?zgart)/i.test(
      t,
    );
  const outsidePlatform =
    /guruh|xavfsizlik|telegram|yozdim|yozgan|xabar\s*yubor|skrin\s*tash|skrinshot\s*tash|guruhga/i.test(t);
  if (lateOrFix && outsidePlatform) return true;
  if (/kech\s*qol|kechik/.test(t) && /guruh|yozdim|yozgan/.test(t)) return true;
  if (/guruhga\s*yoz/.test(t) && /davomat|kech|vaqt|keldim/.test(t)) return true;
  return false;
}

export const LATE_PLATFORM_ONLY_REPLY = SHORT_LATE_REPLY;

export const AI_SAYDMAN_INTRO = [
  "Mening ismim AI Saydman.",
  "Men HR PRO / VAKSINA HR platformasida o‘qish va tahlil qiluvchi sun’iy intellekt yordamchiman.",
  "Ma’lumotlarni o‘qiyman, tushuntiraman va maslahat beraman — platformani o‘zgartirmayman.",
].join(" ");

export const AI_SAYDMAN_SALAM =
  "Assalomu alaykum! Men AI Saydman. Sizga qanday yordam bera olaman?";

export function looksNameQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`]/g, "'").trim();
  return /isming\s*nima|ismingni\s*ayt|o'?zingni\s*tanishtir|kim\s*bilan\s*gaplash|kim\s*san|sen\s*kim|who\s*are\s*you|what('?s|\s+is)\s*your\s*name|ismi\s*nima|qanday\s*ism/.test(
    t,
  );
}

export function looksGreetingOnly(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`]/g, "'").trim();
  return /^(salom|assalomu?\s*alaykum|assalom|hello|hi|hey|привет|nima\s*gap|qale(ysz|san)?|yaxshimisiz|zor\s*mi)[\s!.?]*$/i.test(
    t,
  );
}

/** Gemini ishlamasa ham mavzuga mos javob — hech qachon jim qolmasin */
function offlineFallbackReply(userText: string, _afterHours: boolean): string {
  const t = userText.toLowerCase();
  if (looksAttendanceSelfMistake(userText)) return attendanceMistakeTeachReply(userText);
  if (looksSababliAbsence(userText)) return SHORT_SABABLI_REPLY;
  if (looksLikeLateGroupExcuse(userText) || isSimpleAttendanceExcuse(userText)) {
    return SHORT_LATE_REPLY;
  }
  if (looksAttendanceWriteRequest(userText)) return ATTENDANCE_WRITE_BLOCKED_REPLY;
  if (looksAttendanceTrouble(userText)) return ATTENDANCE_TROUBLE_REPLY;
  if (looksLikeLoginHelp(userText)) {
    return [
      "Kirish uchun login va parolni shu chatga yuboring — ulayman.",
      "Yoki pastdagi «Tizimga kirish» tugmasi.",
      "Ishlamasa skrinshot yuboring — tushuntiraman.",
      "Men AI Saydman.",
    ].join("\n");
  }
  if (/^(davomat|holatim)[\s!.?]*$/i.test(t.trim())) {
    return "Davomat holati uchun akkaunt ulangan bo‘lishi kerak. Ulangach «davomat» deb yozing.\nMen AI Saydman.";
  }
  if (looksUnpaidSalaryIssue(t)) {
    return [
      "Tushundim — oylik muammosini aytdingiz.",
      "Farmasevt / mudir / stajyor: koordinatoringizni xabardor qiling.",
      "Ofis: HR ga murojaat qiling — men faqat yordamchiman.",
    ].join("\n");
  }
  if (/oylik|jarima|kechik/i.test(t)) {
    return "Oylik/jarima bo‘yicha qisqa savolingizni yozing — shu yerda tushuntiraman.";
  }
  if (/men\s*(qo.?ygan|bergan)|boshqalarga/i.test(t)) {
    return [
      "Siz qo‘ygan topshiriqlar uchun: «men qo‘ygan topshiriqlar» deb yozing.",
      "Bitta xodim: masalan «nurislomgachi» yoki «Nuraliyev Nurislom».",
      "Men AI Saydman.",
    ].join("\n");
  }
  if (/vazifa|topshiriq|zadacha|task/i.test(t)) {
    return [
      "Vazifa bo‘yicha:",
      "• «vazifalarim» — menga qo‘yilganlar",
      "• «men qo‘ygan topshiriqlar» — men boshqalarga qo‘yganlar",
      "• «bajar» — bajarishga yordam",
      "• «topshiriq yarat» — yangi (faqat shunda xodim so‘raladi)",
      "Men AI Saydman.",
    ].join("\n");
  }
  if (/ishlamay|xato|error|skrin|ochilmay/i.test(t)) {
    return [
      "Muammoni shu chatda yechamiz.",
      "Qaysi joyda xato — yozing yoki skrinshot yuboring.",
      "Men AI Saydman.",
    ].join("\n");
  }
  return [
    "Yozganingizni oldim — shu yerda javob beraman.",
    "Davomat, vazifa, QR yoki boshqa savol — bemalol yozing.",
    "Men AI Saydman.",
  ].join("\n");
}

function groupBudgetOk(chatId: number): boolean {
  const now = Date.now();
  const list = (groupChatReplies.get(chatId) || []).filter((t) => now - t < GROUP_WINDOW_MS);
  groupChatReplies.set(chatId, list);
  return list.length < GROUP_MAX_REPLIES;
}

function markGroupReply(chatId: number) {
  const now = Date.now();
  const list = (groupChatReplies.get(chatId) || []).filter((t) => now - t < GROUP_WINDOW_MS);
  list.push(now);
  groupChatReplies.set(chatId, list);
}

/**
 * @returns true — javob yuborildi / suhbat qabul qilindi
 * Har qanday matn/media uchun jim qolmaslik kafolati.
 */
export async function handleGeminiHrSupport(
  msg: TelegramMessage,
  opts?: { businessConnectionId?: string | null; force?: boolean },
): Promise<boolean> {
  try {
    return await handleGeminiHrSupportInner(msg, opts);
  } catch (err) {
    logger.warn({ err }, "gemini-hr: unhandled");
    try {
      if (!msg.from || msg.from.is_bot) return false;
      const chatId = msg.chat.id;
      const businessConnectionId = opts?.businessConnectionId || msg.business_connection_id || null;
      const sendOpts = businessConnectionId
        ? { business_connection_id: businessConnectionId, reply_to_message_id: msg.message_id }
        : { reply_to_message_id: msg.message_id };
      await sendMessage(
        chatId,
        "Yozganingizni oldim. Qayta qisqa yozing — javob beraman.\nMen AI Saydman.",
        sendOpts,
      );
      return true;
    } catch {
      return false;
    }
  }
}

async function handleGeminiHrSupportInner(
  msg: TelegramMessage,
  opts?: { businessConnectionId?: string | null; force?: boolean },
): Promise<boolean> {
  // Kalit bo‘lmasa ham offline javob beramiz (jim qolmaymiz)
  if (!msg.from || msg.from.is_bot) return false;

  const chatId = msg.chat.id;
  const fromId = String(msg.from.id);
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
  const businessConnectionId = opts?.businessConnectionId || msg.business_connection_id || null;
  const sendOpts = businessConnectionId
    ? { business_connection_id: businessConnectionId, reply_to_message_id: msg.message_id }
    : { reply_to_message_id: msg.message_id };

  const text = (msg.text ?? msg.caption ?? "").trim();
  const photoId = largestPhotoFileId(msg);
  const mediaMeta = mediaFileFromMessage(msg);
  const wantsVoiceReply = Boolean(mediaMeta);

  if ((!text || text.startsWith("/")) && !photoId && !mediaMeta) return false;

  const mentioned =
    /@vaksinahrbot\b/i.test(text) ||
    msg.reply_to_message?.from?.username?.toLowerCase() === "vaksinahrbot";

  // Guruh: har bir so‘z/matn/media ga javob (budget bilan)
  if (isGroup && !opts?.force && !mentioned) {
    if (!(photoId || mediaMeta || text)) return false;
  }
  if (isGroup && !groupBudgetOk(chatId)) {
    await sendMessage(chatId, "Biroz bandman — 1 daqiqadan keyin yozing.\nMen AI Saydman.", sendOpts).catch(
      () => {},
    );
    return true;
  }

  if (rateLimited(`${isGroup ? "g" : "p"}:${fromId}`)) {
    await sendMessage(chatId, "Biroz kutib qayta yozing 🙂\nMen AI Saydman.", sendOpts).catch(() => {});
    return true;
  }

  const sessionKey = isGroup ? `g:${chatId}:${fromId}` : fromId;
  const session = getSession(sessionKey);

  // Ulangan akkaunt: faqat shu odamning jonli bazasi (topshiriq, davomat…)
  let personal: { linked: boolean; text: string } = { linked: false, text: "" };
  try {
    personal = await getPersonalContext(session, fromId);
  } catch (err) {
    logger.warn({ err }, "gemini-hr: personal context");
  }

  let image: MediaPart | null = null;
  if (photoId) {
    const file = await downloadTelegramFile(photoId);
    if (file) {
      image = { mimeType: file.mimeType, base64: file.buffer.toString("base64") };
    }
  }

  let media: MediaPart | null = null;
  if (mediaMeta) {
    const file = await downloadTelegramFile(mediaMeta.fileId, { maxBytes: 16_000_000 });
    if (file) {
      media = {
        mimeType: mediaMeta.hintMime || file.mimeType,
        base64: file.buffer.toString("base64"),
      };
    }
  }

  const cleanText = text.replace(/@vaksinahrbot\b/gi, "").trim();
  const userText =
    cleanText ||
    (image
      ? "Skrinshot. Platformadagi muammo nima — qisqa aytib, yechim ber."
      : media
        ? mediaMeta?.kind === "video"
          ? "Video xabar. Eshitib/ko‘rib, o‘zbekcha qisqa javob ber (1–3 gap)."
          : "Ovozli xabar. Eshitib, o‘zbekcha qisqa javob ber (1–3 gap)."
        : "");

  const needPhotoHint =
    !image &&
    !media &&
    looksLikeUiError(userText) &&
    !session.turns.some((t) => t.hasImage) &&
    !/skrin|screenshot|rasm/i.test(session.turns.map((t) => t.text).join(" "));

  void sendChatAction(chatId, wantsVoiceReply ? "record_voice" : "typing", {
    business_connection_id: businessConnectionId || undefined,
  }).catch(() => {});

  const hour = tashkentHourNow();
  const afterHours = isAfterHoursTashkent(hour);
  const personalQ = looksPersonalDataQuestion(cleanText || userText);
  const system = buildHelpSystemPrompt({
    fullName: session.fullName,
    role: session.role,
    detailed: true,
    tashkentHour: hour,
    afterHours,
    personalContext: personal.text,
    accountLinked: personal.linked,
  });

  const guidedUserText = personalQ
    ? `${userText}\n\n(Faqat SHAXSIY JONLI BAZA. Qisqa 2–5 qator. Saidmuhammadalixonni keraksiz aytma. Bo‘sh javob berma.)`
    : needPhotoHint
      ? `${userText}\n\n(1 qisqa savol + skrinshot. Uzun yozma. Har doim javob matni yoz.)`
      : `${userText}\n\n(HAR DOIM chatda aniq javob ber. Har gap oxirida «Men AI Saydman» dema. «Platformaga boring» dema. Shikoyat: hech qisi yo‘q, HR nazorat+tahlil qilib xulosa beradi, ishlashda davom eting. Jarima: kech/kelmagan bo‘lsa mumkin, holatni ayt, ijobiy yakunla. Faqat haqiqiy texnik yechilmas holatda [ESCALATE].)`;

  const askText = cleanText || userText;
  const linkedUser =
    personal.linked && session.userId
      ? await findLinkedUserByTelegram(fromId)
      : null;

  // 0−) Ism / salom — AI Saydman
  if (looksNameQuestion(askText)) {
    await sendMessage(chatId, AI_SAYDMAN_INTRO, sendOpts).catch(() => {});
    if (isGroup) markGroupReply(chatId);
    return true;
  }
  if (looksGreetingOnly(askText)) {
    await sendMessage(chatId, AI_SAYDMAN_SALAM, sendOpts).catch(() => {});
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 0) Davomatga YOZISH — mutlaq rad (admin ham)
  if (looksAttendanceWriteRequest(askText)) {
    await sendMessage(chatId, ATTENDANCE_WRITE_BLOCKED_REPLY, sendOpts).catch(() => {});
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 0s) Smena / rotatsiya / ko‘chirish — o‘zgartirmaydi; koordinator→HR eskalatsiya
  const staffingKey = `${fromId}:staff`;
  const accessDeniedFollow =
    /dostup\s*yo'?q|ruxsat\s*yo'?q|mudirda.*(yo'?q|dostup|ruxsat)|ochilmaydi\s*mudir/i.test(
      askText,
    ) && Boolean(takeStaffingContext(staffingKey));
  if (looksStaffingChangeRequest(askText) || accessDeniedFollow) {
    const prior = takeStaffingContext(staffingKey);
    if (looksStaffingChangeRequest(askText) && !accessDeniedFollow) {
      rememberStaffingRequest(staffingKey, askText);
    }
    const whoName =
      linkedUser?.fullName ||
      [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") ||
      "Xodim";
    const esc = await escalateStaffingChange({
      userChatId: chatId,
      userTelegramId: fromId,
      userName: whoName,
      role: linkedUser?.role || session.role || "—",
      userId: linkedUser?.id ?? session.userId ?? null,
      userText: askText,
      priorText: accessDeniedFollow ? prior : null,
      businessConnectionId,
    });
    if (accessDeniedFollow || esc.sent) clearStaffingSession(staffingKey);
    await sendMessage(chatId, esc.userReply, sendOpts).catch(() => {});
    session.turns.push({ role: "user", text: askText });
    session.turns.push({ role: "model", text: esc.userReply });
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 0+) Davomat muammo — hisobot tashlamaydi, chatda yordam
  if (looksAttendanceTrouble(askText)) {
    let troubleReply = ATTENDANCE_TROUBLE_REPLY;
    if (geminiHrEnabled()) {
      const ai = await callGemini({
        system,
        history: session.turns,
        userText: `${askText}\n\n(Davomat MUAMMO. Hisobot jadvali tashlama. Platformaga «boring» dema. Chatda qisqa diagnostika: GPS/kamera/geofence/smena. Keldim yozma. Oxirida Men AI Saydman.)`,
        image,
        media,
      });
      if (ai?.trim()) troubleReply = ai.trim();
    }
    await sendMessage(chatId, escapeForTelegramHtml(troubleReply), {
      ...sendOpts,
      parse_mode: "HTML",
    }).catch(() => {});
    session.turns.push({ role: "user", text: askText, hasImage: Boolean(image) });
    session.turns.push({ role: "model", text: troubleReply });
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 0a+) Men qo‘ygan topshiriqlar — faqat shu intent / ochiq filtr sessiyasi
  const createdKey = `${fromId}:created`;
  if (
    linkedUser &&
    !hasActiveTaskDraft(`${fromId}:task`) &&
    (looksTasksICreatedIntent(askText) ||
      hasActiveCreatedTasksSession(createdKey) ||
      /\S+gachi\b/i.test(askText.trim()))
  ) {
    const createdTurn = await handleCreatedTasksTurn({
      sessionKey: createdKey,
      text: askText,
      actor: linkedUser,
    });
    if (createdTurn.handled) {
      await sendMessage(chatId, createdTurn.reply, sendOpts).catch(() => {});
      if (isGroup) markGroupReply(chatId);
      return true;
    }
  }

  // 0b) Mening vazifalarim — faqat O‘QISH + tahlil (platformaga yozilmaydi)
  const execKey = `${fromId}:exec`;
  if (
    linkedUser &&
    (looksDoMyTasksIntent(askText) ||
      looksMyAssignedTasksIntent(askText) ||
      hasActiveExecSession(execKey))
  ) {
    if (hasActiveTaskDraft(`${fromId}:task`)) {
      clearTaskDraft(`${fromId}:task`);
    }
    const execTurn = await handleDoMyTasksTurn({
      sessionKey: execKey,
      text: askText,
      actor: linkedUser,
    });
    if (execTurn.handled) {
      await sendMessage(chatId, execTurn.reply, sendOpts).catch(() => {});
      if (isGroup) markGroupReply(chatId);
      return true;
    }
  }

  // 0c) Vazifa YARATISH — READ-ONLY: yaratilmaydi, faqat tushuntiriladi
  const taskKey = `${fromId}:task`;
  if (linkedUser && (looksTaskCreateIntent(askText) || hasActiveTaskDraft(taskKey))) {
    clearTaskDraft(taskKey);
    await sendMessage(
      chatId,
      [
        "Men AI Saydman — platformadagi ma’lumotlarni tahlil qilish va tushuntirish uchun ishlayman.",
        "Hozirgi vakolatim faqat o‘qish rejimida. Yangi vazifa yaratolmayman.",
        "Yaratish: Vazifalar → + Vazifa → xodim, mazmun, muddat → saqlash.",
        "O‘qish uchun: «men qo‘ygan topshiriqlar» yoki «vazifalarim».",
        "Men AI Saydman.",
      ].join("\n"),
      sendOpts,
    ).catch(() => {});
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 1) Majburiyat PDF (dori/mahsulot qaytarib olinmaslik)
  if (looksMajburiyatRequest(askText)) {
    const pdf = loadMajburiyatPdf();
    const caption =
      "📄 <b>Majburiyat</b> — mijozlar dori / mahsulotni qaytarib olmaslik haqida (A4).\nChop etib dorixonaga yopishtiring.";
    await sendMessage(chatId, caption, { ...sendOpts, parse_mode: "HTML" }).catch(() => {});
    if (pdf?.buffer?.length) {
      await sendDocument(chatId, pdf.buffer, pdf.filename, {
        mimeType: "application/pdf",
        caption: "VAKSINA MED · Majburiyat PDF",
        businessConnectionId: businessConnectionId || undefined,
      }).catch((err) => logger.warn({ err }, "gemini-hr: majburiyat send"));
    } else {
      await sendMessage(
        chatId,
        "PDF hozir topilmadi. Platformada: Apteka tarmog‘i → Majburiyat → PDF yuklab olish.",
        sendOpts,
      ).catch(() => {});
    }
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 2) Mijoz baholash QR — faqat o‘z doirasi (koordinator/mudir/admin)
  if (looksBahoQrRequest(askText)) {
    if (!linkedUser) {
      await sendMessage(
        chatId,
        "Avval @vaksinahrbot orqali login+parol bilan akkauntingizni ulang — keyin o‘z filiallaringiz QR sini yuboraman.",
        sendOpts,
      ).catch(() => {});
      return true;
    }
    await sendMessage(chatId, "QR tayyorlanmoqda…", sendOpts).catch(() => {});
    try {
      const pack = await buildScopedBahoQrPdf(linkedUser);
      if (!pack) {
        await sendMessage(
          chatId,
          "Mijoz baholash QR ni koordinator, mudir yoki admin so‘rashi mumkin. Sizning rolingiz uchun ochiq emas.",
          sendOpts,
        ).catch(() => {});
        return true;
      }
      if (!pack.count || !pack.buffer.length) {
        await sendMessage(chatId, pack.caption, { ...sendOpts, parse_mode: "HTML" }).catch(
          () => {},
        );
        return true;
      }
      await sendDocument(chatId, pack.buffer, pack.filename, {
        mimeType: "application/pdf",
        caption: pack.caption.replace(/<[^>]+>/g, ""),
        parseMode: "HTML",
        businessConnectionId: businessConnectionId || undefined,
      }).catch(async (err) => {
        logger.warn({ err }, "gemini-hr: baho-qr send");
        await sendMessage(chatId, pack.caption, { ...sendOpts, parse_mode: "HTML" }).catch(
          () => {},
        );
      });
    } catch (err) {
      logger.warn({ err }, "gemini-hr: baho-qr");
      await sendMessage(
        chatId,
        "QR PDF tayyorlanmadi. Platformada: Mijozlar baholashi → Tanlanganlar A4 PDF.",
        sendOpts,
      ).catch(() => {});
    }
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 3a) Davomat xato (bir vaqtda Keldim/Ketdim) — tuzatilmaydi, o‘rgatish (HR «to‘g‘rilamaydi»)
  if (looksAttendanceSelfMistake(askText)) {
    const teach = attendanceMistakeTeachReply(askText);
    await sendMessage(chatId, teach, sendOpts).catch(() => {});
    session.turns.push({ role: "user", text: askText });
    session.turns.push({ role: "model", text: teach });
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 3a+) Mijoz shikoyati / «nima bo‘ladi» — tinchlantirish (escalate YO‘Q)
  if (looksCustomerComplaintConcern(askText) && !looksAttendanceSelfMistake(askText)) {
    await sendMessage(chatId, COMPLAINT_REASSURE_REPLY, sendOpts).catch(() => {});
    session.turns.push({ role: "user", text: askText });
    session.turns.push({ role: "model", text: COMPLAINT_REASSURE_REPLY });
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 3a++) «Oylik ololmadim» — hisobot EMAS; filial→koordinator, ofis→HR
  if (looksUnpaidSalaryIssue(askText)) {
    const whoName =
      linkedUser?.fullName ||
      [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") ||
      "Xodim";
    const unpaid = await handleUnpaidSalaryIssue({
      userChatId: chatId,
      userTelegramId: fromId,
      userName: whoName,
      role: linkedUser?.role || session.role || "—",
      userId: linkedUser?.id ?? session.userId ?? null,
      userText: askText,
      businessConnectionId,
    });
    await sendMessage(chatId, unpaid.userReply, sendOpts).catch(() => {});
    session.turns.push({ role: "user", text: askText });
    session.turns.push({ role: "model", text: unpaid.userReply });
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 3b) Shtraf/jarima — escalate emas; holatdan tushuntirish + ijobiy yakun
  if (linkedUser && looksFineComplaint(askText)) {
    try {
      const pack = await buildMonthAttendancePack(linkedUser);
      const text = formatFineExplainReply(pack);
      await sendMessage(chatId, text, sendOpts).catch(() => {});
    } catch (err) {
      logger.warn({ err }, "gemini-hr: fine explain");
      await sendMessage(
        chatId,
        "Agar kech qolgan yoki kelmagan kuningiz bo‘lsa, jarima qo‘llanilgan bo‘lishi mumkin. Hozirgi holatni «davomat» deb yozib ko‘ring.",
        sendOpts,
      ).catch(() => {});
    }
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 3b2) 1 oylik davomat / oylik hisobi — faqat aniq so‘rov (ololmadim emas)
  if (
    linkedUser &&
    !looksUnpaidSalaryIssue(askText) &&
    (looksAttendancePdfRequest(askText) || looksOylikOrJarimaQuestion(askText))
  ) {
    try {
      const pack = await buildMonthAttendancePack(linkedUser);
      const text = formatMonthAttendanceText(pack);
      await sendMessage(chatId, text, { ...sendOpts, parse_mode: "HTML" }).catch(() => {});
      if (wantsPdf(askText) || looksAttendancePdfRequest(askText)) {
        await sendMessage(chatId, "📄 PDF tayyorlanmoqda…", sendOpts).catch(() => {});
        const pdf = await buildMonthAttendancePdf(pack);
        await sendDocument(chatId, pdf, `davomat-${pack.month}.pdf`, {
          mimeType: "application/pdf",
          caption: `${pack.fullName} · ${pack.month} davomat`,
          businessConnectionId: businessConnectionId || undefined,
        }).catch((err) => logger.warn({ err }, "gemini-hr: davomat pdf"));
      }
    } catch (err) {
      logger.warn({ err }, "gemini-hr: month pack");
      await sendMessage(
        chatId,
        "Hisobotni hozir chiqara olmadim. Keyinroq «davomat pdf» deb yozing.",
        sendOpts,
      ).catch(() => {});
    }
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // «Nima tuzatdingiz?» — noto‘g‘ri escalate javobiga tushuntirish
  if (/nima(ni)?\s*tuzat|nima\s*qilding|qanday\s*tuzat/i.test(askText)) {
    await sendMessage(
      chatId,
      "Avvalgi xabar texnik so‘rov bo‘yicha edi — men platformada hech narsani o‘zgartirmayman (faqat o‘qish).\nJarima/davomat bo‘yicha aniq holat kerak bo‘lsa: «shtraf» yoki «davomat» deb yozing — raqamlar bilan tushuntiraman.",
      sendOpts,
    ).catch(() => {});
    if (isGroup) markGroupReply(chatId);
    return true;
  }

  // 3) Davomat / kech / sababli — qisqa qat’iy javob
  let replyHtml = false;
  let reply: string | null = null;
  let doEscalate = false;

  if (looksAttendanceSelfMistake(askText)) {
    reply = attendanceMistakeTeachReply(askText);
  } else if (looksSababliAbsence(askText) && !looksAttendanceQuestion(askText)) {
    reply = SHORT_SABABLI_REPLY;
  } else if (
    looksLikeLateGroupExcuse(askText) ||
    (/kech\s*qol|kechik|vaqtni\s*tuzat|davomatni\s*tuzat/i.test(askText) &&
      !looksAttendanceQuestion(askText) &&
      !looksOylikOrJarimaQuestion(askText))
  ) {
    // «davomatni tuzat» — tuzatilmaydi, o‘rgatish
    reply = /davomatni\s*tuzat|vaqtni\s*tuzat|to'?g'?rila/i.test(askText)
      ? attendanceMistakeTeachReply(askText)
      : SHORT_LATE_REPLY;
  } else if (looksAttendanceQuestion(askText)) {
    if (!linkedUser) {
      reply = "Akkauntni ulang (login+parol), keyin «davomat» deb yozing.";
    } else {
      reply = await buildAttendanceReplyUz(linkedUser.id, linkedUser.fullName);
      replyHtml = true;
    }
  }

  if (!reply) {
    // Gemini yoqilgan bo‘lsa chaqiramiz; yo‘q/xato bo‘lsa offline
    if (geminiHrEnabled()) {
      reply = await callGemini({
        system,
        history: session.turns,
        userText: guidedUserText,
        image,
        media,
      });
    }
  }

  if (!reply || !String(reply).trim()) {
    reply = offlineFallbackReply(askText || userText, afterHours);
  }

  reply = stripHrMentions(reply).replace(/\n{3,}/g, "\n\n").trim();
  // Ism/brend: AI Saydman; Saidmuhammadni keraksiz qisqartirish
  reply = reply
    .replace(/\bChatGPT\b/gi, "AI Saydman")
    .replace(/\bGPT-?\d*\b/gi, "AI Saydman");
  if (!/saidmuhammad|hr\s*kim|kim\s*hr|menejer\s*kim/i.test(askText)) {
    reply = reply
      .replace(/Saidmuhammadalixon HR damda[^.]*\./gi, "")
      .replace(/Xato qilgan bo['‘’]?lsam Saidmuhammadalixon HR tuzatadi\.?/gi, "Men AI Saydman.")
      .replace(/Men AI yordamchiman\.?/gi, "Men AI Saydman.")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  if (/men\s+ai\s+yordamchi/i.test(reply) && !/saydman/i.test(reply)) {
    reply = reply.replace(/Men AI yordamchiman\.?/gi, "Men AI Saydman.");
  }
  if (
    /bazadagi\s*vaqt|ertalabki\s*vaqt|vaqtni\s*to['‘’]?g['‘’]?ril|xavfsizlik.*(guruh|xabar).*ko['‘’]?rsat/i.test(
      reply,
    )
  ) {
    reply = SHORT_LATE_REPLY;
    replyHtml = false;
  }
  // Gemini «HR to‘g‘rilab qo‘yadi» demasin — davomat tuzatilmaydi
  if (
    /to['‘’]?g['‘’]?rilab\s*qo['‘’]?y|HR\s*(buz|tuzat|to['‘’]?g['‘’]?rila)|davomatni\s*(tuzat|to['‘’]?g['‘’]?rila)|исправ.*(HR|отдел)/i.test(
      reply,
    ) &&
    /davomat|keldim|ketdim|smena|посещ|смен|vaqt/i.test(askText + " " + reply)
  ) {
    reply = attendanceMistakeTeachReply(askText);
    replyHtml = false;
  }

  // Har javob oxirida «Men AI Saydman» spamini olib tashlash (salom/ismdan tashqari)
  reply = reply
    .replace(/\n*Men AI Saydman\.?\s*$/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const escalateFlag = /\[ESCALATE\]/i.test(reply);
  reply = reply.replace(/\[ESCALATE\]/gi, "").trim();
  const blockEscalate =
    looksNonEscalatableQuestion(askText) ||
    looksCustomerComplaintConcern(askText) ||
    looksAttendanceSelfMistake(askText) ||
    looksFineComplaint(askText) ||
    looksOylikOrJarimaQuestion(askText) ||
    looksAttendanceQuestion(askText);
  if (
    !blockEscalate &&
    (escalateFlag ||
      (!isGroup &&
        !isSimpleAttendanceExcuse(askText) &&
        !looksSababliAbsence(askText) &&
        looksNeedsEscalation(reply, askText)))
  ) {
    doEscalate = true;
  }

  if (reply.length > 900) reply = reply.slice(0, 880).replace(/\s+\S*$/, "") + "…";

  // Login tugmasi — faqat aniq «qanday kiraman» so‘rovida
  const wantLoginBtns = looksLikeLoginHelp(cleanText) || looksLikeLoginHelp(userText);

  // Yechilmasa — egaga guruhga (suhbat emas, faqat holat) + xodimga kutish
  if (doEscalate && !isGroup) {
    const esc = await escalateToOwnerGroup({
      userChatId: chatId,
      userTelegramId: fromId,
      userName:
        linkedUser?.fullName ||
        [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") ||
        "Xodim",
      role: linkedUser?.role || session.role || "—",
      userText: askText,
      platformHint: personal.linked ? "Akkaunt ulangan" : "Akkaunt ulanmagan / umumiy",
      businessConnectionId,
    });
    if (esc.sent) {
      reply = WAIT_FOR_OWNER_REPLY;
      replyHtml = false;
    }
  }

  session.turns.push({
    role: "user",
    text: media ? `[${mediaMeta?.kind || "media"}] ${userText}` : userText,
    hasImage: Boolean(image),
  });
  session.turns.push({ role: "model", text: reply.replace(/<[^>]+>/g, "") });
  if (session.turns.length > MAX_TURNS * 2) {
    session.turns = session.turns.slice(-MAX_TURNS * 2);
  }
  if (isGroup) markGroupReply(chatId);

  const markup = wantLoginBtns ? platformLoginKeyboard() : undefined;
  const outgoing = replyHtml ? reply : escapeForTelegramHtml(reply);

  if (wantsVoiceReply && !replyHtml) {
    void sendChatAction(chatId, "record_voice", {
      business_connection_id: businessConnectionId || undefined,
    }).catch(() => {});
    const ogg = await synthesizeVoiceOgg(reply);
    if (ogg?.length) {
      await sendVoice(chatId, ogg, {
        filename: "javob.ogg",
        reply_to_message_id: msg.message_id,
        business_connection_id: businessConnectionId || undefined,
      }).catch(async (err) => {
        logger.warn({ err }, "gemini-hr: sendVoice");
        await sendMessage(chatId, escapeForTelegramHtml(reply), {
          ...sendOpts,
          parse_mode: "HTML",
          reply_markup: markup,
        }).catch(() => {});
      });
      if (markup) {
        await sendMessage(chatId, "Kirish ↓", {
          business_connection_id: businessConnectionId || undefined,
          reply_to_message_id: msg.message_id,
          reply_markup: markup,
        }).catch(() => {});
      }
      return true;
    }
  }

  await sendMessage(chatId, outgoing, {
    ...sendOpts,
    parse_mode: "HTML",
    reply_markup: markup,
  }).catch(async () => {
    await sendMessage(chatId, reply.replace(/<[^>]+>/g, "").slice(0, 900), {
      business_connection_id: businessConnectionId || undefined,
      reply_to_message_id: msg.message_id,
      reply_markup: markup,
    }).catch(() => {});
  });

  return true;
}
