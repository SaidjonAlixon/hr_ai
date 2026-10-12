/**
 * Vazifalar eslatmasi (Telegram):
 *  - har kuni 10:00 va 17:00 — har bir xodimga shaxsan: jarayondagi va tasdiqlashi kerak bo‘lgan topshiriqlar;
 *    xuddi shu jamlanma «Vaksinamed UZ» guruhining General bo‘limiga (Maxfiy topshiriqlarsiz), har kim belgilangan holda;
 *  - har 3 soatda (09, 12, 15, 18) — tekshiruvda qolib ketgan topshiriqlar: tasdiqlang yoki qaytaring.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { notifyUser } from "./notify";
import { escapeHtml, getStickerSet, isTelegramConfigured, publicAppUrl, sendMessage, sendSticker } from "./telegram";

export const TASK_GROUP_CHAT_ID = process.env.TASK_DIGEST_CHAT_ID?.trim() || "-1004337392139";
export const DIGEST_HOURS = [10, 17];
export const REVIEW_HOURS = [9, 12, 15, 18];

const MSG_MAX = 3800;
const GROUP_LIST_MAX = 10;
const DM_LIST_MAX = 20;

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
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, minute: Number(get("minute")) };
}

function stamp(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "");
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

function dueText(t: TaskRow, now: number): string {
  if (!t.dueAt) return "muddatsiz";
  const diff = t.dueAt.getTime() - now;
  return diff < 0
    ? `muddat ${stamp(t.dueAt)} — <b>⚠️ ${dur(diff)} kechikdi</b>`
    : `muddat ${stamp(t.dueAt)} — ⏳ ${dur(diff)} qoldi`;
}

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
    title: String(r.title || "").replace(/\s+/g, " ").trim().slice(0, 90) || `Vazifa #${r.id}`,
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
        telegramId: u.telegram_id ? String(u.telegram_id).trim() || null : null,
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

// ---------------------------------------------------------------- matn

function mention(p: Person | undefined, fallbackId: number): string {
  const name = escapeHtml(p?.name ?? `Foydalanuvchi #${fallbackId}`);
  return p?.telegramId && /^\d+$/.test(p.telegramId) ? `<a href="tg://user?id=${p.telegramId}">${name}</a>` : `<b>${name}</b>`;
}

function taskLink(t: TaskRow): string {
  const base = publicAppUrl();
  const title = `«${escapeHtml(t.title)}»`;
  return base ? `<a href="${base}/vazifalar?task=${t.id}">${title}</a>` : title;
}

function listLines(items: TaskRow[], max: number, line: (t: TaskRow) => string): string[] {
  const out = items.slice(0, max).map((t, i) => `${i + 1}. ${line(t)}`);
  if (items.length > max) out.push(`… va yana <b>${items.length - max}</b> ta`);
  return out;
}

function bucketLines(b: Bucket, people: Map<number, Person>, max: number, now: number): string[] {
  const nameOf = (id: number | null) => escapeHtml((id != null && people.get(id)?.name) || "—");
  const lines: string[] = [];
  if (b.doing.length) {
    lines.push(`🛠 <b>Jarayonda — bajarishingiz kerak: ${b.doing.length} ta</b>`);
    lines.push(...listLines(b.doing, max, (t) => `${taskLink(t)} — ${dueText(t, now)}`));
  }
  if (b.todo.length) {
    lines.push(`📥 <b>Hali qabul qilinmagan: ${b.todo.length} ta</b>`);
    lines.push(...listLines(b.todo, max, (t) => `${taskLink(t)} — ${dueText(t, now)}`));
  }
  if (b.toApprove.length) {
    lines.push(`✅ <b>Tasdiqlashingiz kerak: ${b.toApprove.length} ta</b>`);
    lines.push(
      ...listLines(b.toApprove, max, (t) =>
        `${taskLink(t)} — ijrochi: ${nameOf(t.assigneeUid)}${t.completedAt ? ` · topshirdi ${stamp(t.completedAt)} · <b>${dur(now - t.completedAt.getTime())} kutmoqda</b>` : ""}`,
      ),
    );
  }
  if (b.inReview.length) {
    lines.push(`🔎 <b>Tekshiruvda — rahbar tasdig‘ini kutmoqda: ${b.inReview.length} ta</b>`);
    lines.push(
      ...listLines(b.inReview, max, (t) =>
        `${taskLink(t)} — tasdiqlovchi: ${nameOf(t.createdById)}${t.completedAt ? ` · ${dur(now - t.completedAt.getTime())} kutmoqda` : ""}`,
      ),
    );
  }
  return lines;
}

/** Bloklarni Telegram chegarasidan oshirmay bir nechta xabarga bo‘ladi */
function pack(header: string, blocks: string[], footer: string): string[] {
  const out: string[] = [];
  let cur = header;
  for (const block of blocks) {
    if (cur.length + block.length + 2 > MSG_MAX && cur !== header) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${block}` : block;
  }
  if (cur.length + footer.length + 2 > MSG_MAX) {
    out.push(cur);
    cur = footer;
  } else cur = `${cur}\n\n${footer}`;
  out.push(cur);
  return out;
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

async function deliver(chatId: string, messages: string[], sticker: string | null): Promise<void> {
  if (sticker) await sendSticker(chatId, sticker).catch((err) => logger.warn({ err, chatId }, "Stiker yuborilmadi"));
  for (const text of messages) {
    await sendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true });
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ---------------------------------------------------------------- 10:00 / 17:00 jamlanma

export async function sendTaskDigest(): Promise<{ people: number; dms: number; groupMessages: number }> {
  if (!isTelegramConfigured()) throw new Error("Telegram bot sozlanmagan");
  const { tasks, people } = await loadOpen();
  const buckets = bucketize(tasks);
  const now = Date.now();
  const { hour } = tashkentNow();
  const morning = hour < 14;
  const when = `${stamp(new Date())} holatiga`;
  const sticker = await pickSticker(morning ? ["👋", "☀", "😊"] : ["🌙", "👋", "😊"]);

  const order = [...buckets.entries()]
    .filter(([id]) => people.get(id)?.active !== false)
    .sort((a, b) => bucketSize(b[1]) - bucketSize(a[1]) || (people.get(a[0])?.name ?? "").localeCompare(people.get(b[0])?.name ?? "", "uz"));

  let dms = 0;
  for (const [id, b] of order) {
    const p = people.get(id);
    if (!bucketSize(b)) continue;
    const parts = [`👤 <b>${escapeHtml(p?.name ?? "")}</b>, ${morning ? "xayrli tong" : "xayrli kech"}!`, ...bucketLines(b, people, DM_LIST_MAX, now)];
    const tips: string[] = [];
    if (b.toApprove.length)
      tips.push("✅ Bajarilgan topshiriqlarni bugun tasdiqlang yoki izoh bilan qaytaring — tasdiq kechikkani uchun bajargan xodimga minus yozilmasin.");
    if (b.doing.length || b.todo.length) tips.push("🛠 Topshiriqlarni muddatidan oldin bajarib, natijani tizimga yuklang — kechiksa minus yoziladi.");
    const header = `🔔 <b>Vazifalar eslatmasi</b> · ${when}`;
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
      await deliver(p.telegramId, pack(header, [parts.join("\n")], `${tips.join("\n")}\n\n📋 Barchasi: ${publicAppUrl() || ""}/vazifalar`), sticker);
      dms += 1;
    } catch (err) {
      logger.warn({ err, userId: id }, "Vazifa eslatmasi shaxsan yuborilmadi");
    }
  }

  const blocks: string[] = [];
  let totDoing = 0;
  let totTodo = 0;
  let totApprove = 0;
  for (const [id, raw] of order) {
    const b = withoutPrivate(raw);
    b.inReview = [];
    if (!bucketSize(b)) continue;
    totDoing += b.doing.length;
    totTodo += b.todo.length;
    totApprove += b.toApprove.length;
    blocks.push([`👤 ${mention(people.get(id), id)}`, ...bucketLines(b, people, GROUP_LIST_MAX, now)].join("\n"));
  }
  let groupMessages = 0;
  if (blocks.length) {
    const header = [
      `🔔 <b>Vazifalar jamlanmasi</b> · ${when}`,
      `🛠 Jarayonda: <b>${totDoing}</b> · 📥 Qabul qilinmagan: <b>${totTodo}</b> · ✅ Tasdiqlash kutilmoqda: <b>${totApprove}</b>`,
    ].join("\n");
    const footer = [
      "💡 <b>Izoh:</b> har kim o‘z ro‘yxatini ko‘rib chiqsin.",
      "• Ijrochilar — muddat o‘tmasdan bajarib, natijani yuklang.",
      "• Rahbarlar — bajarilgan topshiriqlarni tasdiqlang yoki izoh bilan qaytaring, bajargan xodimga nohaq minus tushmasin.",
      "🔒 Maxfiy topshiriqlar guruhga chiqarilmaydi — ular faqat shaxsiy xabarda.",
    ].join("\n");
    const msgs = pack(header, blocks, footer);
    await deliver(TASK_GROUP_CHAT_ID, msgs, sticker);
    groupMessages = msgs.length;
  }
  return { people: order.length, dms, groupMessages };
}

// ---------------------------------------------------------------- har 3 soatda: tekshiruvda qolganlar

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
  const nameOf = (id: number | null) => escapeHtml((id != null && people.get(id)?.name) || "—");
  const line = (t: TaskRow) =>
    `${taskLink(t)} — ijrochi: ${nameOf(t.assigneeUid)}${t.completedAt ? ` · <b>${dur(now - t.completedAt.getTime())} kutmoqda</b>` : ""}`;
  const footer =
    "🙏 Iltimos, ko‘rib chiqib <b>tasdiqlang</b> yoki izoh bilan <b>qaytaring</b>. Topshiriq qolib ketmasin va uni bajargan xodimga minus yozilmasin.";

  let dms = 0;
  for (const [id, list] of order) {
    const p = people.get(id);
    if (!p?.telegramId || !p.active) continue;
    const body = [`⏰ <b>Tasdiqlashingizni kutayotgan topshiriqlar: ${list.length} ta</b>`, ...listLines(list, DM_LIST_MAX, line)].join("\n");
    try {
      await deliver(p.telegramId, pack(`👤 <b>${escapeHtml(p.name)}</b>`, [body], footer), sticker);
      dms += 1;
    } catch (err) {
      logger.warn({ err, userId: id }, "Tasdiqlash eslatmasi shaxsan yuborilmadi");
    }
  }

  const blocks: string[] = [];
  let total = 0;
  for (const [id, all] of order) {
    const list = all.filter((t) => !t.isPrivate);
    if (!list.length) continue;
    total += list.length;
    blocks.push([`👤 ${mention(people.get(id), id)} — tasdiqlashi kerak: <b>${list.length} ta</b>`, ...listLines(list, GROUP_LIST_MAX, line)].join("\n"));
  }
  if (blocks.length) {
    const header = `⏰ <b>Tekshiruvda qolib ketgan topshiriqlar: ${total} ta</b> · ${stamp(new Date())}\nTasdiqlang yoki bekor qilib qaytaring:`;
    await deliver(TASK_GROUP_CHAT_ID, pack(header, blocks, footer), sticker);
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

/** Har daqiqada chaqiriladi */
export async function taskDigestTick(): Promise<void> {
  if (!isTelegramConfigured()) return;
  await ensureSchema();
  const { ymd, hour } = tashkentNow();
  const { rows } = await pool.query(`SELECT 1 FROM task_digest_log WHERE slot LIKE 'digest:%' LIMIT 1`);
  if (!rows.length) await runSlot(`digest:${ymd}:start`, sendTaskDigest);
  if (DIGEST_HOURS.includes(hour)) await runSlot(`digest:${ymd}:${hour}`, sendTaskDigest);
  if (REVIEW_HOURS.includes(hour)) await runSlot(`review:${ymd}:${hour}`, sendReviewReminder);
}
