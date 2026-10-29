/**
 * Vazifalar eslatmasi (Telegram + platforma):
 *  - 10:00 va 15:00 — ochiq topshirig‘i bor xodimlarga lichka (PDF) + platforma;
 *  - botga ulanmaganlarga — VaksinaMed e’lon / hisobot guruhiga (kuniga 3 marta: 10, 15, 18);
 *  - har digestdan keyin adminlarga PDF: kimga lichka, kimga guruh, kimga yuborilmadi;
 *  - 09 / 12 / 18 — tekshiruvda qolganlar uchun rahbarga alohida eslatma.
 */
import { rgb } from "pdf-lib";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { notifyUser } from "./notify";
import { renderTaskDigestPdf, SECTION_TONES, type DigestPdfSection } from "./task-digest-pdf";
import { getReportGroup } from "./telegram-report-group";
import { escapeHtml, getStickerSet, isTelegramConfigured, publicAppUrl, sendDocument, sendMessage, sendSticker } from "./telegram";

/** Xodimlarga to‘liq digest (lichka + PDF) */
export const DIGEST_HOURS = [10, 15];
/** Botga ulanmaganlar uchun guruh eslatmasi (3 marta) */
export const GROUP_HOURS = [10, 15, 18];
/** Rahbarlarga «tasdiqlang» eslatmasi */
export const REVIEW_HOURS = [9, 12, 18];

const DM_PAUSE_MS = 600;
const FINE_NOTE =
  "⚠️ Diqqat: topshiriq muddatida bajarilmasa yoki e’tiborsiz qoldirilsa — bu jarima qo‘llashga asos bo‘ladi.";

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

type DeliveryChannel = "dm" | "group" | "platform_only" | "failed";

type DeliveryRow = {
  userId: number;
  name: string;
  channel: DeliveryChannel;
  openCount: number;
  action: string;
  detail: string;
};

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
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, hm: `${get("hour")}:${get("minute")}` };
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
     WHERE t.status IN ('todo', 'in_progress', 'done')
       AND t.candidate_id IS NULL AND t.pipeline_stage IS NULL
       AND t.title !~* '^[0-9]+-qadam'`);
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

const overdue = (t: TaskRow, now: number) => !!t.dueAt && t.dueAt.getTime() < now;

function nearestDue(list: TaskRow[]): TaskRow | null {
  return list.find((t) => t.dueAt) ?? list[0] ?? null;
}

function dueLabel(t: TaskRow | null, now: number): string {
  if (!t?.dueAt) return "muddat qo‘yilmagan";
  const late = overdue(t, now);
  return late ? `${stamp(t.dueAt)} (kechikdi: ${dur(now - t.dueAt.getTime())})` : `${stamp(t.dueAt)} (qoldi: ${dur(t.dueAt.getTime() - now)})`;
}

/** Qisqa: xodim nima qilishi kerak */
function actionNeeded(b: Bucket, now: number): string {
  const parts: string[] = [];
  if (b.todo.length) {
    const d = nearestDue(b.todo);
    parts.push(`Qabul qiling: ${b.todo.length} ta${d?.dueAt ? ` · tugash ${dueLabel(d, now)}` : ""}`);
  }
  if (b.doing.length) {
    const d = nearestDue(b.doing);
    parts.push(`Bajaring / natija yuklang: ${b.doing.length} ta${d?.dueAt ? ` · tugash ${dueLabel(d, now)}` : ""}`);
  }
  if (b.toApprove.length) {
    const waited = b.toApprove[0]?.completedAt ? dur(now - b.toApprove[0].completedAt.getTime()) : null;
    parts.push(`Tasdiqlang yoki qaytaring: ${b.toApprove.length} ta${waited ? ` · kutmoqda ${waited}` : ""}`);
  }
  if (b.inReview.length && !b.todo.length && !b.doing.length && !b.toApprove.length) {
    parts.push(`Rahbar tasdig‘ini kutmoqda: ${b.inReview.length} ta`);
  }
  return parts.join("; ") || "Ochilgan topshiriq bor";
}

function actionLinesHtml(b: Bucket, now: number): string[] {
  const lines: string[] = ["<b>Sizdan nima kerak:</b>"];
  if (b.todo.length) {
    const d = nearestDue(b.todo);
    lines.push(`• <b>Qabul qiling</b> — ${b.todo.length} ta yangi topshiriq${d?.dueAt ? ` · tugash: ${escapeHtml(dueLabel(d, now))}` : ""}`);
  }
  if (b.doing.length) {
    const d = nearestDue(b.doing);
    lines.push(
      `• <b>Bajaring va natijani yuklang</b> — ${b.doing.length} ta jarayonda${d?.dueAt ? ` · tugash: ${escapeHtml(dueLabel(d, now))}` : ""}`,
    );
  }
  if (b.toApprove.length) {
    const waited = b.toApprove[0]?.completedAt ? dur(now - b.toApprove[0].completedAt.getTime()) : null;
    lines.push(
      `• <b>Tasdiqlang yoki izoh bilan qaytaring</b> — ${b.toApprove.length} ta bajarilgan${waited ? ` · eng uzoq kutgani ${escapeHtml(waited)}` : ""}`,
    );
  }
  if (b.inReview.length) {
    lines.push(`• Siz bajargan ${b.inReview.length} ta topshiriq <b>rahbar tasdig‘ini</b> kutmoqda`);
  }
  return lines;
}

// ---------------------------------------------------------------- matn va PDF

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

async function personPdf(p: Person | undefined, b: Bucket, people: Map<number, Person>, now: number): Promise<Buffer> {
  const nameOf = (id: number | null) => (id != null && people.get(id)?.name) || "—";
  const sections: DigestPdfSection[] = [
    {
      title: "Jarayonda — bajarishingiz kerak",
      personHead: "Topshiriq beruvchi",
      timeHead: "Muddat (tugash)",
      stateHead: "Qolgan vaqt / kechikish",
      tone: SECTION_TONES.doing,
      rows: b.doing.map((t) => dueRow(t, now, nameOf)),
    },
    {
      title: "Hali qabul qilinmagan — avval qabul qiling",
      personHead: "Topshiriq beruvchi",
      timeHead: "Muddat (tugash)",
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
    subtitle: `${stamp(new Date())} holatiga · shaxsiy hisobot`,
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
      ...actionNeeded(b, now)
        .split("; ")
        .map((x) => `• ${x}`),
      FINE_NOTE,
      "Platforma: /vazifalar",
    ].join("\n"),
  });
}

function personCaption(p: Person | undefined, b: Bucket, now: number, morning: boolean): string {
  const late = [...b.doing, ...b.todo].filter((t) => overdue(t, now)).length;
  const mine = b.doing.length + b.todo.length;
  const lines = [
    `🔔 <b>TOPSHIRIQLAR ESLATMASI</b> · ${escapeHtml(p?.name ?? "")}, ${morning ? "xayrli tong" : "xayrli kun"}!`,
    "",
    mine
      ? `📌 Sizda <b>bajarilmagan topshiriq</b> bor: <b>${mine} ta</b>. Platformaga kirib, holatiga qarab qabul qiling yoki to‘liq bajaring.`
      : "",
    ...actionLinesHtml(b, now),
    late ? `⚠️ Muddati o‘tgan: <b>${late} ta</b> — zudlik bilan yakunlang.` : "",
    "",
    FINE_NOTE,
    "",
    "📎 Har bir topshiriq: muddat, qolgan vaqt, nima qilish kerak — PDF ichida.",
    `🔗 ${publicAppUrl() || ""}/vazifalar`,
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

function groupPersonCaption(p: Person, b: Bucket, now: number): string {
  const mine = b.doing.length + b.todo.length;
  return [
    `📢 <b>E’lon</b> · <b>${escapeHtml(p.name)}</b> — botga hali ulanmagan / lichka yetmadi`,
    mine ? `📌 Bajarilmagan topshiriq: <b>${mine} ta</b>` : "",
    ...actionLinesHtml(b, now),
    "",
    FINE_NOTE,
    `🔗 Botni oching va ${publicAppUrl() || ""}/vazifalar ga kiring.`,
  ]
    .filter(Boolean)
    .join("\n");
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

async function stickerTo(chatId: string, sticker: string | null, threadId?: number | null) {
  if (sticker) await sendSticker(chatId, sticker, { message_thread_id: threadId }).catch((err) => logger.warn({ err, chatId }, "Stiker yuborilmadi"));
}

async function docTo(chatId: string, pdf: Buffer, filename: string, caption: string, threadId?: number | null) {
  await sendDocument(chatId, pdf, filename, {
    caption: caption.slice(0, 1024),
    parseMode: "HTML",
    mimeType: "application/pdf",
    messageThreadId: threadId,
  });
}

// ---------------------------------------------------------------- admin hisobot

async function loadAdmins(): Promise<Person[]> {
  const { rows } = await pool.query(
    `SELECT id, full_name, telegram_id, status FROM users WHERE role = 'admin' AND status = 'active'`,
  );
  return rows.map((u) => ({
    id: Number(u.id),
    name: String(u.full_name || `#${u.id}`),
    telegramId: u.telegram_id && /^-?\d+$/.test(String(u.telegram_id).trim()) ? String(u.telegram_id).trim() : null,
    active: true,
  }));
}

async function sendAdminDeliveryReport(
  deliveries: DeliveryRow[],
  meta: { slotLabel: string; groupTitle: string | null },
): Promise<{ admins: number }> {
  const now = Date.now();
  const dm = deliveries.filter((d) => d.channel === "dm");
  const group = deliveries.filter((d) => d.channel === "group");
  const plat = deliveries.filter((d) => d.channel === "platform_only");
  const fail = deliveries.filter((d) => d.channel === "failed");
  const tone = {
    dm: SECTION_TONES.approve,
    group: SECTION_TONES.todo,
    plat: SECTION_TONES.review,
    fail: { bg: rgb(1, 0.9, 0.9), fg: rgb(0.65, 0.1, 0.1) },
  };
  const toRows = (list: DeliveryRow[]) =>
    list.map((d) => ({
      title: d.name,
      person: d.detail,
      time: `${d.openCount} ta`,
      state: d.action.slice(0, 80),
      bad: d.channel === "failed" || d.channel === "platform_only",
    }));
  const pdf = await renderTaskDigestPdf({
    heading: "Topshiriqlar eslatmasi — yetkazish hisoboti",
    subtitle: `${meta.slotLabel} · ${stamp(new Date())}${meta.groupTitle ? ` · guruh: ${meta.groupTitle}` : ""}`,
    summary: [
      { label: "Jami odam", value: String(deliveries.length), fg: SECTION_TONES.doing.fg },
      { label: "Lichka (bot)", value: String(dm.length), fg: tone.dm.fg },
      { label: "E’lon guruhi", value: String(group.length), fg: tone.group.fg },
      { label: "Faqat platforma", value: String(plat.length), fg: tone.plat.fg },
      { label: "Xato / yuborilmadi", value: String(fail.length), fg: fail.length ? tone.fail.fg : SECTION_TONES.approve.fg },
    ],
    sections: [
      {
        title: "Lichkaga yuborilgan (Telegram bot)",
        personHead: "Kanal",
        timeHead: "Topshiriq",
        stateHead: "Nima qilishi kerak",
        tone: tone.dm,
        rows: toRows(dm),
      },
      {
        title: "E’lon / hisobot guruhiga yuborilgan (botga ulanmagan yoki lichka yetmadi)",
        personHead: "Kanal",
        timeHead: "Topshiriq",
        stateHead: "Nima qilishi kerak",
        tone: tone.group,
        rows: toRows(group),
      },
      {
        title: "Faqat platforma bildirishnomasi (Telegram yo‘q / guruh sozlanmagan)",
        personHead: "Sabab",
        timeHead: "Topshiriq",
        stateHead: "Nima qilishi kerak",
        tone: tone.plat,
        rows: toRows(plat),
      },
      {
        title: "Yuborilmadi (xato)",
        personHead: "Xato",
        timeHead: "Topshiriq",
        stateHead: "Nima qilishi kerak",
        tone: tone.fail,
        rows: toRows(fail),
      },
    ],
    note: [
      "Bu hisobot avtomatik: har kuni 10:00 va 15:00 da xodimlarga eslatma, botga ulanmaganlarga guruh (10 / 15 / 18).",
      FINE_NOTE,
      `Yaratilgan: ${stamp(new Date(now))}`,
    ].join("\n"),
  });

  const caption = [
    `📊 <b>Topshiriqlar eslatmasi — yetkazish hisoboti</b>`,
    escapeHtml(meta.slotLabel),
    "",
    `👥 Jami: <b>${deliveries.length}</b>`,
    `💬 Lichka: <b>${dm.length}</b>`,
    `📢 Guruh: <b>${group.length}</b>`,
    `📱 Faqat platforma: <b>${plat.length}</b>`,
    fail.length ? `❌ Xato: <b>${fail.length}</b>` : "",
    "",
    "📎 To‘liq ro‘yxat PDF ichida: kimga lichka, kimga guruh, nima qilishi kerak.",
  ]
    .filter(Boolean)
    .join("\n");

  const admins = await loadAdmins();
  let sent = 0;
  const file = `vazifa_yetkazish_${tashkentNow().ymd}_${tashkentNow().hm.replace(":", "")}.pdf`;
  for (const a of admins) {
    await notifyUser({
      userId: a.id,
      text: `Topshiriqlar eslatmasi yetkazildi: lichka ${dm.length}, guruh ${group.length}, platforma ${plat.length}, xato ${fail.length}.`,
      type: "task_digest_admin",
      linkUrl: "/vazifalar",
      title: "Topshiriqlar — yetkazish hisoboti",
      telegram: false,
    }).catch((err) => logger.warn({ err, userId: a.id }, "Admin platforma xabari yozilmadi"));
    if (!a.telegramId) continue;
    try {
      await docTo(a.telegramId, pdf, file, caption);
      sent += 1;
      await pause(DM_PAUSE_MS);
    } catch (err) {
      logger.warn({ err, adminId: a.id }, "Admin yetkazish PDF yuborilmadi");
    }
  }
  return { admins: sent };
}

// ---------------------------------------------------------------- 10:00 / 15:00 jamlanma + guruh

export async function sendTaskDigest(): Promise<{
  people: number;
  dms: number;
  group: number;
  platform: number;
  failed: number;
  admins: number;
}> {
  if (!isTelegramConfigured()) throw new Error("Telegram bot sozlanmagan");
  const { tasks, people } = await loadOpen();
  const buckets = bucketize(tasks);
  const now = Date.now();
  const morning = tashkentNow().hour < 14;
  const sticker = await pickSticker(morning ? ["👋", "☀", "😊"] : ["🔔", "👋", "😊"]);
  const reportGroup = await getReportGroup().catch(() => null);

  const order = [...buckets.entries()]
    .filter(([id, b]) => people.get(id)?.active !== false && bucketSize(b) > 0)
    .sort((a, b) => bucketSize(b[1]) - bucketSize(a[1]) || (people.get(a[0])?.name ?? "").localeCompare(people.get(b[0])?.name ?? "", "uz"));

  const deliveries: DeliveryRow[] = [];
  let dms = 0;
  let groupN = 0;
  let platform = 0;
  let failed = 0;

  const sendGroupFor = async (p: Person, b: Bucket, reason: string) => {
    if (!reportGroup) {
      deliveries.push({
        userId: p.id,
        name: p.name,
        channel: "platform_only",
        openCount: bucketSize(b),
        action: actionNeeded(b, now),
        detail: reason + " · e’lon guruhi sozlanmagan (/hisobot_guruh)",
      });
      return false;
    }
    try {
      const pdf = await personPdf(p, b, people, now);
      await docTo(reportGroup.chatId, pdf, pdfName(p, "Vazifa_elon"), groupPersonCaption(p, b, now), reportGroup.threadId);
      groupN += 1;
      deliveries.push({
        userId: p.id,
        name: p.name,
        channel: "group",
        openCount: bucketSize(b),
        action: actionNeeded(b, now),
        detail: `Guruh: ${reportGroup.chatTitle || reportGroup.chatId}${reason ? ` · ${reason}` : ""}`,
      });
      return true;
    } catch (err) {
      failed += 1;
      deliveries.push({
        userId: p.id,
        name: p.name,
        channel: "failed",
        openCount: bucketSize(b),
        action: actionNeeded(b, now),
        detail: `Guruh xato: ${err instanceof Error ? err.message : "yuborilmadi"}`,
      });
      logger.warn({ err, userId: p.id }, "Vazifa eslatmasi guruhga yuborilmadi");
      return false;
    }
  };

  for (const [id, b] of order) {
    const p = people.get(id) ?? { id, name: `#${id}`, telegramId: null, active: true };
    const mine = b.doing.length + b.todo.length;
    const warn = [
      mine ? `Sizga ${mine} ta topshiriq bor — kirib qabul qiling yoki bajaring.` : "",
      b.toApprove.length ? `Siz qo‘ygan ${b.toApprove.length} ta topshiriq bajarildi — tasdiqlang yoki qaytaring.` : "",
      !mine && !b.toApprove.length && b.inReview.length ? `Siz bajargan ${b.inReview.length} ta topshiriq rahbar tasdig‘ini kutmoqda.` : "",
      FINE_NOTE,
    ]
      .filter(Boolean)
      .join(" ");
    try {
      await notifyUser({
        userId: id,
        text: `🔔 ${warn}`,
        type: "task_digest",
        linkUrl: "/vazifalar",
        title: "Topshiriqlar — eslatma",
        telegram: false,
      });
      platform += 1;
    } catch (err) {
      logger.warn({ err, userId: id }, "Platforma ogohlantirishi yozilmadi");
    }

    if (p.telegramId) {
      try {
        const pdf = await personPdf(p, b, people, now);
        await stickerTo(p.telegramId, sticker);
        await docTo(p.telegramId, pdf, pdfName(p, "Vazifalarim"), personCaption(p, b, now, morning));
        dms += 1;
        deliveries.push({
          userId: id,
          name: p.name,
          channel: "dm",
          openCount: bucketSize(b),
          action: actionNeeded(b, now),
          detail: "Telegram lichka + PDF",
        });
      } catch (err) {
        logger.warn({ err, userId: id }, "Vazifa eslatmasi lichkaga yuborilmadi — guruhga uriniladi");
        await sendGroupFor(p, b, "lichka yetmadi (blok / bot ochilmagan)");
      }
    } else {
      await sendGroupFor(p, b, "botga ulanmagan");
    }
    await pause(DM_PAUSE_MS);
  }

  // Guruhda qisqa umumiy xulosa (agar kimdir guruhga tushgan bo‘lsa)
  if (reportGroup && groupN > 0) {
    const summary = [
      `📢 <b>Topshiriqlar eslatmasi</b> · ${escapeHtml(stamp(new Date()))}`,
      `Botga ulanmagan / lichka yetmagan: <b>${groupN} nafar</b> — har birining PDF yuqorida.`,
      FINE_NOTE,
      `🔗 ${publicAppUrl() || ""}/vazifalar`,
    ].join("\n");
    await sendMessage(reportGroup.chatId, summary, {
      parse_mode: "HTML",
      message_thread_id: reportGroup.threadId,
    }).catch((err) => logger.warn({ err }, "Guruh xulosa xabari yuborilmadi"));
  }

  const { admins } = await sendAdminDeliveryReport(deliveries, {
    slotLabel: `Digest ${tashkentNow().hm} (Toshkent)`,
    groupTitle: reportGroup ? `${reportGroup.chatTitle}${reportGroup.topicName ? ` / ${reportGroup.topicName}` : ""}` : null,
  });

  return { people: order.length, dms, group: groupN, platform, failed, admins };
}

/** Faqat botga ulanmaganlar — guruhga 3-chi eslatma (masalan 18:00) */
export async function sendNoBotGroupReminders(): Promise<{ people: number; group: number; admins: number }> {
  if (!isTelegramConfigured()) throw new Error("Telegram bot sozlanmagan");
  const { tasks, people } = await loadOpen();
  const buckets = bucketize(tasks);
  const now = Date.now();
  const reportGroup = await getReportGroup().catch(() => null);
  if (!reportGroup) {
    logger.warn("Vazifa guruh eslatmasi: hisobot/e’lon guruhi sozlanmagan (/hisobot_guruh)");
    return { people: 0, group: 0, admins: 0 };
  }

  const targets = [...buckets.entries()]
    .map(([id, b]) => ({ p: people.get(id), b }))
    .filter((x) => x.p && x.p.active !== false && bucketSize(x.b) > 0 && !x.p.telegramId) as Array<{ p: Person; b: Bucket }>;

  const deliveries: DeliveryRow[] = [];
  let groupN = 0;
  for (const { p, b } of targets) {
    try {
      const pdf = await personPdf(p, b, people, now);
      await docTo(reportGroup.chatId, pdf, pdfName(p, "Vazifa_elon"), groupPersonCaption(p, b, now), reportGroup.threadId);
      groupN += 1;
      deliveries.push({
        userId: p.id,
        name: p.name,
        channel: "group",
        openCount: bucketSize(b),
        action: actionNeeded(b, now),
        detail: `Guruh eslatma (bot yo‘q) · ${reportGroup.chatTitle || reportGroup.chatId}`,
      });
    } catch (err) {
      deliveries.push({
        userId: p.id,
        name: p.name,
        channel: "failed",
        openCount: bucketSize(b),
        action: actionNeeded(b, now),
        detail: err instanceof Error ? err.message : "xato",
      });
      logger.warn({ err, userId: p.id }, "No-bot guruh eslatmasi yuborilmadi");
    }
    await pause(DM_PAUSE_MS);
  }

  if (groupN > 0) {
    await sendMessage(
      reportGroup.chatId,
      [
        `📢 <b>Topshiriq eslatmasi (botga ulanmaganlar)</b>`,
        `Bugun 3-marta · ${escapeHtml(stamp(new Date()))}`,
        `Ro‘yxat: <b>${groupN} nafar</b> — PDF lar yuqorida.`,
        FINE_NOTE,
      ].join("\n"),
      { parse_mode: "HTML", message_thread_id: reportGroup.threadId },
    ).catch(() => undefined);
  }

  const { admins } = await sendAdminDeliveryReport(deliveries, {
    slotLabel: `Guruh eslatma (bot yo‘q) ${tashkentNow().hm}`,
    groupTitle: `${reportGroup.chatTitle}${reportGroup.topicName ? ` / ${reportGroup.topicName}` : ""}`,
  });

  return { people: targets.length, group: groupN, admins };
}

// ---------------------------------------------------------------- har 3 soatda: tekshiruvda qolganlar

function reviewCaption(p: Person | undefined, list: TaskRow[], now: number): string {
  const oldest = list[0]?.completedAt ? dur(now - list[0].completedAt.getTime()) : null;
  const overDay = list.filter((t) => t.completedAt && now - t.completedAt.getTime() > 86_400_000).length;
  return [
    `⏰ <b>TASDIQLASH KERAK</b> · ${escapeHtml(p?.name ?? "")}`,
    "",
    `✅ Siz qo‘ygan <b>${list.length} ta</b> topshiriq bajarildi va tekshiruvda turibdi.`,
    "<b>Nima qilish kerak:</b> platformaga kiring — <b>tasdiqlang</b> yoki izoh bilan <b>qaytaring</b>.",
    oldest ? `⌛ Eng uzoq kutgani: <b>${oldest}</b>` : "",
    overDay ? `⚠️ 1 kundan ortiq kutayotgani: <b>${overDay} ta</b>` : "",
    "",
    FINE_NOTE,
    "📎 Tafsilotlar PDF ichida.",
    `🔗 ${publicAppUrl() || ""}/vazifalar`,
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
  let total = 0;
  for (const [id, list] of order) {
    const p = people.get(id);
    if (p?.active === false) continue;
    total += list.length;
    await notifyUser({
      userId: id,
      text: `⏰ Siz qo‘ygan ${list.length} ta topshiriq bajarildi — kirib tasdiqlang yoki qaytaring. ${FINE_NOTE}`,
      type: "task_review_reminder",
      linkUrl: "/vazifalar",
      title: "Tasdiqlash kutilmoqda",
      telegram: false,
    }).catch((err) => logger.warn({ err, userId: id }, "Platforma ogohlantirishi yozilmadi"));
    if (!p?.telegramId) continue;
    try {
      const pdf = await personPdf(p, only(list), people, now);
      await stickerTo(p.telegramId, sticker);
      await docTo(p.telegramId, pdf, pdfName(p, "Tasdiqlash_kutilmoqda"), reviewCaption(p, list, now));
      dms += 1;
    } catch (err) {
      logger.warn({ err, userId: id }, "Tasdiqlash eslatmasi shaxsan yuborilmadi");
    }
    await pause(DM_PAUSE_MS);
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
    // To‘liq digest: 10:00 va 15:00
    if (DIGEST_HOURS.includes(hour)) await runSlot(`digest:${ymd}:${hour}`, sendTaskDigest);
    // Botga ulanmaganlar uchun qo‘shimcha (18:00) — 10/15 da allaqachon digest ichida guruhga ketadi
    if (hour === 18) await runSlot(`nobot-group:${ymd}:${hour}`, sendNoBotGroupReminders);
    if (REVIEW_HOURS.includes(hour)) await runSlot(`review:${ymd}:${hour}`, sendReviewReminder);
  } finally {
    running = false;
  }
}
