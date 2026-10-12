/**
 * Vazifalar eslatmasi (Telegram):
 *  - har kuni 10:00 va 17:00 — har bir xodimga alohida xabar + PDF: jarayondagi va tasdiqlashi kerak bo‘lgan topshiriqlar.
 *    Shaxsan (Maxfiy bilan) va «Vaksinamed UZ» guruhining General bo‘limiga (Maxfiy topshiriqlarsiz), har kim belgilangan holda;
 *  - har 3 soatda (09, 12, 15, 18) — tekshiruvda qolib ketgan topshiriqlar: har bir rahbarga alohida, tasdiqlang yoki qaytaring.
 */
import { rgb } from "pdf-lib";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { notifyUser } from "./notify";
import { renderTaskDigestPdf, SECTION_TONES, type DigestPdfSection } from "./task-digest-pdf";
import { escapeHtml, getStickerSet, isTelegramConfigured, publicAppUrl, sendDocument, sendMessage, sendSticker } from "./telegram";

export const TASK_GROUP_CHAT_ID = process.env.TASK_DIGEST_CHAT_ID?.trim() || "-1004337392139";
export const DIGEST_HOURS = [10, 17];
export const REVIEW_HOURS = [9, 12, 15, 18];

/** Telegram: bitta guruhga daqiqasiga ~20 xabar */
const GROUP_PAUSE_MS = 3_200;
const DM_PAUSE_MS = 600;

type TaskRow = {
  id: number;
  title: string;
  status: "todo" | "in_progress" | "done";
  dueAt: Date | null;
  completedAt: Date | null;
  createdById: number;
  assigneeUid: number | null;
  isPrivate: boolean;
};

type Person = { id: number; name: string; telegramId: string | null; active: boolean };

type Bucket = { todo: TaskRow[]; doing: TaskRow[]; inReview: TaskRow[]; toApprove: TaskRow[] };

// ---------------------------------------------------------------- vaqt

function tashkentNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

function stamp(d: Date | null): string {
  if (!d) return "";
  return d
    .toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .replace(",", "");
}

function dur(ms: number): string {
  const min = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return h ? `${d} kun ${h} soat` : `${d} kun`;
  if (h) return m ? `${h} soat ${m} daq.` : `${h} soat`;
  return `${m} daq.`;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- ma’lumot

async function loadOpen(): Promise<{ tasks: TaskRow[]; people: Map<number, Person> }> {
  const { rows } = await pool.query(`
    SELECT t.id, t.title, t.status, t.due_at, t.completed_at, t.created_by_id,
           COALESCE(t.meta->>'visibility', 'all') = 'private' AS is_private,
           CASE WHEN t.assignee_kind = 'employee' THEN e.user_id ELSE t.assignee_id END AS assignee_uid
      FROM tasks t
      LEFT JOIN employees e ON t.assignee_kind = 'employee' AND e.id = t.assignee_id
     WHERE t.status IN ('todo', 'in_progress', 'done')`);
  const tasks: TaskRow[] = rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title || "").replace(/\s+/g, " ").trim().slice(0, 160) || `Vazifa #${r.id}`,
    status: r.status,
    dueAt: r.due_at ? new Date(r.due_at) : null,
    completedAt: r.completed_at ? new Date(r.completed_at) : null,
    createdById: Number(r.created_by_id),
    assigneeUid: r.assignee_uid != null ? Number(r.assignee_uid) : null,
    isPrivate: Boolean(r.is_private),
  }));
  const ids = [...new Set(tasks.flatMap((t) => [t.createdById, t.assigneeUid]).filter((x): x is number => x != null))];
  const people = new Map<number, Person>();
  if (ids.length) {
    const { rows: users } = await pool.query(`SELECT id, full_name, telegram_id, status FROM users WHERE id = ANY($1::int[])`, [ids]);
    for (const u of users) {
      people.set(Number(u.id), {
        id: Number(u.id),
        name: String(u.full_name || `#${u.id}`),
        telegramId: u.telegram_id && /^-?\d+$/.test(String(u.telegram_id).trim()) ? String(u.telegram_id).trim() : null,
        active: u.status !== "terminated",
      });
    }
  }
  return { tasks, people };
}

function bucketize(tasks: TaskRow[]): Map<number, Bucket> {
  const out = new Map<number, Bucket>();
  const get = (id: number) => {
    let b = out.get(id);
    if (!b) out.set(id, (b = { todo: [], doing: [], inReview: [], toApprove: [] }));
    return b;
  };
  for (const t of tasks) {
    if (t.status === "done") {
      get(t.createdById).toApprove.push(t);
      if (t.assigneeUid != null && t.assigneeUid !== t.createdById) get(t.assigneeUid).inReview.push(t);
    } else if (t.assigneeUid != null) {
      get(t.assigneeUid)[t.status === "todo" ? "todo" : "doing"].push(t);
    }
  }
  const byDue = (a: TaskRow, b: TaskRow) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity);
  const byWait = (a: TaskRow, b: TaskRow) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0);
  for (const b of out.values()) {
    b.todo.sort(byDue);
    b.doing.sort(byDue);
    b.inReview.sort(byWait);
    b.toApprove.sort(byWait);
  }
  return out;
}

const bucketSize = (b: Bucket) => b.todo.length + b.doing.length + b.inReview.length + b.toApprove.length;

function withoutPrivate(b: Bucket): Bucket {
  const f = (l: TaskRow[]) => l.filter((t) => !t.isPrivate);
  return { todo: f(b.todo), doing: f(b.doing), inReview: f(b.inReview), toApprove: f(b.toApprove) };
}

// ---------------------------------------------------------------- matn va PDF

function mention(p: Person | undefined, fallbackId: number): string {
  const name = escapeHtml(p?.name ?? `Foydalanuvchi #${fallbackId}`);
  return p?.telegramId ? `<a href="tg://user?id=${p.telegramId}">${name}</a>` : `<b>${name}</b>`;
}

const overdue = (t: TaskRow, now: number) => !!t.dueAt && t.dueAt.getTime() < now;

function dueRow(t: TaskRow, now: number, nameOf: (id: number | null) => string) {
  const late = overdue(t, now);
  return {
    title: t.title,
    person: nameOf(t.createdById),
    time: t.dueAt ? stamp(t.dueAt) : "muddatsiz",
    state: !t.dueAt ? "muddat qo‘yilmagan" : late ? `${dur(now - t.dueAt.getTime())} kechikdi` : `${dur(t.dueAt.getTime() - now)} qoldi`,
    bad: late,
    isPrivate: t.isPrivate,
  };
}

function waitRow(t: TaskRow, now: number, who: string) {
  const waited = t.completedAt ? now - t.completedAt.getTime() : 0;
  return {
    title: t.title,
    person: who,
    time: t.completedAt ? stamp(t.completedAt) : "—",
    state: t.completedAt ? `${dur(waited)} kutmoqda` : "kutmoqda",
    bad: waited > 86_400_000,
    isPrivate: t.isPrivate,
  };
}

async function personPdf(p: Person | undefined, b: Bucket, people: Map<number, Person>, now: number, opts: { group: boolean }): Promise<Buffer> {
  const nameOf = (id: number | null) => (id != null && people.get(id)?.name) || "—";
  const sections: DigestPdfSection[] = [
    {
      title: "Jarayonda — bajarishingiz kerak",
      personHead: "Topshiriq beruvchi",
      timeHead: "Muddat",
      stateHead: "Qolgan vaqt / kechikish",
      tone: SECTION_TONES.doing,
      rows: b.doing.map((t) => dueRow(t, now, nameOf)),
    },
    {
      title: "Hali qabul qilinmagan",
      personHead: "Topshiriq beruvchi",
      timeHead: "Muddat",
      stateHead: "Qolgan vaqt / kechikish",
      tone: SECTION_TONES.todo,
      rows: b.todo.map((t) => dueRow(t, now, nameOf)),
    },
    {
      title: "Tasdiqlashingiz kerak (bajarilgan, tekshiruvda)",
      personHead: "Ijrochi (bajargan)",
      timeHead: "Topshirgan vaqti",
      stateHead: "Tasdiq kutmoqda",
      tone: SECTION_TONES.approve,
      rows: b.toApprove.map((t) => waitRow(t, now, nameOf(t.assigneeUid))),
    },
    {
      title: "Tekshiruvda — rahbar tasdig‘ini kutmoqda",
      personHead: "Tasdiqlovchi",
      timeHead: "Topshirgan vaqti",
      stateHead: "Tasdiq kutmoqda",
      tone: SECTION_TONES.review,
      rows: b.inReview.map((t) => waitRow(t, now, nameOf(t.createdById))),
    },
  ];
  const late = [...b.doing, ...b.todo].filter((t) => overdue(t, now)).length;
  const red = rgb(0.75, 0.1, 0.12);
  return renderTaskDigestPdf({
    heading: `Vazifalar hisoboti — ${p?.name ?? ""}`,
    subtitle: `${stamp(new Date())} holatiga${opts.group ? " · Maxfiy topshiriqlar kiritilmagan" : ""}`,
    summary: [
      { label: "Jarayonda", value: String(b.doing.length), fg: SECTION_TONES.doing.fg },
      { label: "Qabul qilinmagan", value: String(b.todo.length), fg: SECTION_TONES.todo.fg },
      { label: "Muddati o‘tgan", value: String(late), fg: late ? red : SECTION_TONES.approve.fg },
      { label: "Tasdiqlashingiz kerak", value: String(b.toApprove.length), fg: SECTION_TONES.approve.fg },
      { label: "Tekshiruvda (sizniki)", value: String(b.inReview.length), fg: SECTION_TONES.review.fg },
    ],
    sections,
    note: [
      "Izoh:",
      b.toApprove.length
        ? "Bajarilgan topshiriqlarni bugun tasdiqlang yoki izoh bilan qaytaring — tasdiq kechikkani uchun bajargan xodimga minus yozilmasin."
        : "",
      b.doing.length || b.todo.length ? "Topshiriqlarni muddatidan oldin bajarib, natijani tizimga yuklang — muddat o‘tsa minus yoziladi." : "",
      b.inReview.length ? "Tekshiruvdagi topshiriqlaringiz rahbar tasdig‘ini kutmoqda — kerak bo‘lsa rahbaringizga eslating." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

function personCaption(p: Person | undefined, id: number, b: Bucket, now: number, opts: { group: boolean; morning: boolean }): string {
  const late = [...b.doing, ...b.todo].filter((t) => overdue(t, now)).length;
  const oldest = b.toApprove[0]?.completedAt ? dur(now - b.toApprove[0].completedAt.getTime()) : null;
  const lines = [
    opts.group ? `👤 ${mention(p, id)}` : `👤 <b>${escapeHtml(p?.name ?? "")}</b>, ${opts.morning ? "xayrli tong" : "xayrli kech"}!`,
    "",
    b.doing.length ? `🛠 Jarayonda — bajarishingiz kerak: <b>${b.doing.length} ta</b>` : "",
    b.todo.length ? `📥 Hali qabul qilinmagan: <b>${b.todo.length} ta</b>` : "",
    late ? `⚠️ Muddati o‘tgan: <b>${late} ta</b>` : "",
    b.toApprove.length ? `✅ Tasdiqlashingiz kerak: <b>${b.toApprove.length} ta</b>${oldest ? ` (eng uzoq kutgani ${oldest})` : ""}` : "",
    b.inReview.length ? `🔎 Tekshiruvda — rahbar tasdig‘ini kutmoqda: <b>${b.inReview.length} ta</b>` : "",
    "",
    "📎 To‘liq ro‘yxat (muddat, qolgan vaqt, kim bajargan) — PDF ichida.",
    b.toApprove.length ? "💡 Bajarilganlarni tasdiqlang yoki izoh bilan qaytaring — bajargan xodimga minus yozilmasin." : "",
    b.doing.length || b.todo.length ? "💡 Muddatidan oldin bajarib, natijani tizimga yuklang." : "",
  ];
  return lines
    .filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i > 0))
    .join("\n")
    .trim();
}

function pdfName(p: Person | undefined, prefix: string): string {
  const safe = (p?.name ?? "xodim").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40);
  return `${prefix}_${safe}_${tashkentNow().ymd}.pdf`;
}

// ---------------------------------------------------------------- stiker

const STICKER_SETS = ["UtyaDuck", "HotCherry"];
let stickerCache: Array<{ file_id: string; emoji?: string }> | null = null;

async function pickSticker(wanted: string[]): Promise<string | null> {
  try {
    if (!stickerCache) {
      for (const name of STICKER_SETS) {
        const set = await getStickerSet(name).catch(() => null);
        if (set?.stickers?.length) {
          stickerCache = set.stickers;
          break;
        }
      }
    }
    if (!stickerCache?.length) return null;
    for (const e of wanted) {
      const hit = stickerCache.find((s) => s.emoji?.includes(e));
      if (hit) return hit.file_id;
    }
    return stickerCache[0]!.file_id;
  } catch {
    return null;
  }
}

async function stickerTo(chatId: string, sticker: string | null) {
  if (sticker) await sendSticker(chatId, sticker).catch((err) => logger.warn({ err, chatId }, "Stiker yuborilmadi"));
}

async function docTo(chatId: string, pdf: Buffer, filename: string, caption: string) {
  await sendDocument(chatId, pdf, filename, { caption, parseMode: "HTML", mimeType: "application/pdf" });
}

// ---------------------------------------------------------------- 10:00 / 17:00 jamlanma

export async function sendTaskDigest(): Promise<{ people: number; dms: number; groupPeople: number }> {
  if (!isTelegramConfigured()) throw new Error("Telegram bot sozlanmagan");
  const { tasks, people } = await loadOpen();
  const buckets = bucketize(tasks);
  const now = Date.now();
  const morning = tashkentNow().hour < 14;
  const sticker = await pickSticker(morning ? ["👋", "☀", "😊"] : ["🌙", "👋", "😊"]);

  const order = [...buckets.entries()]
    .filter(([id, b]) => people.get(id)?.active !== false && bucketSize(b) > 0)
    .sort((a, b) => bucketSize(b[1]) - bucketSize(a[1]) || (people.get(a[0])?.name ?? "").localeCompare(people.get(b[0])?.name ?? "", "uz"));

  // Shaxsan — har kimga o‘z xabari va PDF (Maxfiy topshiriqlar ham)
  let dms = 0;
  for (const [id, b] of order) {
    const p = people.get(id);
    const short = [
      b.doing.length ? `jarayonda ${b.doing.length}` : "",
      b.todo.length ? `qabul qilinmagan ${b.todo.length}` : "",
      b.toApprove.length ? `tasdiqlashingiz kerak ${b.toApprove.length}` : "",
      b.inReview.length ? `tekshiruvda ${b.inReview.length}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    await notifyUser({ userId: id, text: `🔔 Vazifalar: ${short}`, type: "task_digest", linkUrl: "/vazifalar", title: "Vazifalar eslatmasi", telegram: false }).catch(
      () => undefined,
    );
    if (!p?.telegramId) continue;
    try {
      const pdf = await personPdf(p, b, people, now, { group: false });
      await stickerTo(p.telegramId, sticker);
      await docTo(p.telegramId, pdf, pdfName(p, "Vazifalarim"), personCaption(p, id, b, now, { group: false, morning }));
      dms += 1;
    } catch (err) {
      logger.warn({ err, userId: id }, "Vazifa eslatmasi shaxsan yuborilmadi");
    }
    await pause(DM_PAUSE_MS);
  }

  // Guruhga — umumiy sarlavha, keyin har bir xodimga alohida xabar + PDF (Maxfiysiz)
  const groupList = order
    .map(([id, raw]) => {
      const b = withoutPrivate(raw);
      b.inReview = [];
      return [id, b] as const;
    })
    .filter(([, b]) => bucketSize(b) > 0);
  if (groupList.length) {
    const sum = (k: keyof Bucket) => groupList.reduce((s, [, b]) => s + b[k].length, 0);
    const late = groupList.reduce((s, [, b]) => s + [...b.doing, ...b.todo].filter((t) => overdue(t, now)).length, 0);
    await stickerTo(TASK_GROUP_CHAT_ID, sticker);
    await sendMessage(
      TASK_GROUP_CHAT_ID,
      [
        `🔔 <b>Vazifalar jamlanmasi</b> · ${stamp(new Date())} holatiga`,
        "",
        `🛠 Jarayonda: <b>${sum("doing")}</b>`,
        `📥 Qabul qilinmagan: <b>${sum("todo")}</b>`,
        `⚠️ Muddati o‘tgan: <b>${late}</b>`,
        `✅ Tasdiqlash kutilmoqda: <b>${sum("toApprove")}</b>`,
        "",
        `👥 Quyida har bir xodimga <b>alohida</b> xabar va to‘liq ro‘yxat PDF (${groupList.length} kishi).`,
        "🔒 Maxfiy topshiriqlar guruhga chiqarilmaydi — ular faqat shaxsiy xabarda.",
      ].join("\n"),
    );
    await pause(GROUP_PAUSE_MS);
    for (const [id, b] of groupList) {
      const p = people.get(id);
      try {
        const pdf = await personPdf(p, b, people, now, { group: true });
        await docTo(TASK_GROUP_CHAT_ID, pdf, pdfName(p, "Vazifalar"), personCaption(p, id, b, now, { group: true, morning }));
      } catch (err) {
        logger.warn({ err, userId: id }, "Vazifa eslatmasi guruhga yuborilmadi");
      }
      await pause(GROUP_PAUSE_MS);
    }
  }
  return { people: order.length, dms, groupPeople: groupList.length };
}

// ---------------------------------------------------------------- har 3 soatda: tekshiruvda qolganlar

function reviewCaption(p: Person | undefined, id: number, list: TaskRow[], now: number, group: boolean): string {
  const oldest = list[0]?.completedAt ? dur(now - list[0].completedAt.getTime()) : null;
  const overDay = list.filter((t) => t.completedAt && now - t.completedAt.getTime() > 86_400_000).length;
  return [
    `⏰ ${group ? mention(p, id) : `<b>${escapeHtml(p?.name ?? "")}</b>`}, tasdiqlashingizni kutayotgan topshiriqlar: <b>${list.length} ta</b>`,
    oldest ? `⌛ Eng uzoq kutgani: <b>${oldest}</b>` : "",
    overDay ? `⚠️ 1 kundan ortiq kutayotgani: <b>${overDay} ta</b>` : "",
    "",
    "📎 Qaysi topshiriq, kim bajargan va qancha kutayotgani — PDF ichida.",
    "🙏 Iltimos, ko‘rib chiqib <b>tasdiqlang</b> yoki izoh bilan <b>qaytaring</b> — topshiriq qolib ketmasin va bajargan xodimga minus yozilmasin.",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

export async function sendReviewReminder(): Promise<{ approvers: number; tasks: number; dms: number }> {
  if (!isTelegramConfigured()) throw new Error("Telegram bot sozlanmagan");
  const { tasks, people } = await loadOpen();
  const now = Date.now();
  const byApprover = new Map<number, TaskRow[]>();
  for (const t of tasks) if (t.status === "done") byApprover.set(t.createdById, [...(byApprover.get(t.createdById) ?? []), t]);
  if (!byApprover.size) return { approvers: 0, tasks: 0, dms: 0 };
  for (const list of byApprover.values()) list.sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0));
  const order = [...byApprover.entries()].sort((a, b) => b[1].length - a[1].length);
  const sticker = await pickSticker(["⏰", "⏳", "🙏", "❗"]);
  const only = (list: TaskRow[]): Bucket => ({ todo: [], doing: [], inReview: [], toApprove: list });

  let dms = 0;
  for (const [id, list] of order) {
    const p = people.get(id);
    if (!p?.telegramId || !p.active) continue;
    try {
      const pdf = await personPdf(p, only(list), people, now, { group: false });
      await stickerTo(p.telegramId, sticker);
      await docTo(p.telegramId, pdf, pdfName(p, "Tasdiqlash_kutilmoqda"), reviewCaption(p, id, list, now, false));
      dms += 1;
    } catch (err) {
      logger.warn({ err, userId: id }, "Tasdiqlash eslatmasi shaxsan yuborilmadi");
    }
    await pause(DM_PAUSE_MS);
  }

  const groupList = order.map(([id, all]) => [id, all.filter((t) => !t.isPrivate)] as const).filter(([, l]) => l.length > 0);
  const total = groupList.reduce((s, [, l]) => s + l.length, 0);
  if (groupList.length) {
    await stickerTo(TASK_GROUP_CHAT_ID, sticker);
    await sendMessage(
      TASK_GROUP_CHAT_ID,
      [
        `⏰ <b>Tekshiruvda qolib ketgan topshiriqlar: ${total} ta</b> · ${stamp(new Date())}`,
        "",
        ...groupList.map(([id, l], i) => `${i + 1}. ${mention(people.get(id), id)} — <b>${l.length} ta</b>`),
        "",
        "Tasdiqlang yoki bekor qilib qaytaring. Har bir rahbarga alohida xabar va PDF quyida.",
      ].join("\n"),
    );
    await pause(GROUP_PAUSE_MS);
    for (const [id, list] of groupList) {
      const p = people.get(id);
      try {
        const pdf = await personPdf(p, only([...list]), people, now, { group: true });
        await docTo(TASK_GROUP_CHAT_ID, pdf, pdfName(p, "Tasdiqlash_kutilmoqda"), reviewCaption(p, id, [...list], now, true));
      } catch (err) {
        logger.warn({ err, userId: id }, "Tasdiqlash eslatmasi guruhga yuborilmadi");
      }
      await pause(GROUP_PAUSE_MS);
    }
  }
  return { approvers: order.length, tasks: total, dms };
}

// ---------------------------------------------------------------- jadval

let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool
      .query(`CREATE TABLE IF NOT EXISTS task_digest_log (slot TEXT PRIMARY KEY, info JSONB, sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
      .then(() => undefined)
      .catch((err) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

async function runSlot(slot: string, fn: () => Promise<unknown>): Promise<void> {
  const claim = await pool.query(`INSERT INTO task_digest_log (slot) VALUES ($1) ON CONFLICT (slot) DO NOTHING`, [slot]);
  if (!claim.rowCount) return;
  try {
    const info = await fn();
    await pool.query(`UPDATE task_digest_log SET info = $2, sent_at = NOW() WHERE slot = $1`, [slot, JSON.stringify(info ?? null)]);
    logger.info({ slot, info }, "Vazifalar eslatmasi yuborildi");
  } catch (err) {
    await pool.query(`DELETE FROM task_digest_log WHERE slot = $1`, [slot]).catch(() => undefined);
    throw err;
  }
}

let running = false;

/** Har daqiqada chaqiriladi */
export async function taskDigestTick(): Promise<void> {
  if (!isTelegramConfigured() || running) return;
  running = true;
  try {
    await ensureSchema();
    const { ymd, hour } = tashkentNow();
    const { rows } = await pool.query(`SELECT 1 FROM task_digest_log WHERE slot LIKE 'digest:%:pdf%' LIMIT 1`);
    if (!rows.length) await runSlot(`digest:${ymd}:pdf-start`, sendTaskDigest);
    if (DIGEST_HOURS.includes(hour)) await runSlot(`digest:${ymd}:${hour}`, sendTaskDigest);
    if (REVIEW_HOURS.includes(hour)) await runSlot(`review:${ymd}:${hour}`, sendReviewReminder);
  } finally {
    running = false;
  }
}
