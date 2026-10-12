/**
 * Tushuntirish xatlari — to‘liq Excel hisobot. Har 3 kunda soat 10:00 da HR guruhiga yuboriladi
 * (har safar barcha xatlar bilan yangilangan holda).
 */
import type ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { pool } from "@workspace/db";
import { newCredWorkbook, paintCredSheet } from "./cred-excel";
import {
  MANUAL_REASON,
  REASONS,
  ensureExplanationSchema,
  getLetterSettings,
  letterContent,
  letterImages,
  lettersForMonth,
  type ExplanationLetterRow,
} from "./explanation-letter";
import { renderExplanationLetterPdf } from "./explanation-letter-pdf";
import { escapeHtml, isTelegramConfigured, publicAppUrl, sendDocument } from "./telegram";
import { logger } from "./logger";

export const REPORT_CHAT_ID = process.env.EXPLANATION_REPORT_CHAT_ID?.trim() || "-1004360169926";
export const REPORT_EVERY_DAYS = 3;
export const REPORT_HOUR = 10;

const GREEN = "FFDCFCE7";
const AMBER = "FFFEF3C7";
const GRAY = "FFE5E7EB";
const RED = "FFFEE2E2";

function tashkentNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dmy(ymd: string | null | undefined): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function decisionLabel(l: ExplanationLetterRow): string {
  if (l.reviewStatus === "approved") return "TASDIQLANGAN";
  if (l.reviewStatus === "cancelled") return "BEKOR QILINGAN";
  return "TASDIQLANMAGAN";
}

function employeeLabel(l: ExplanationLetterRow): string {
  if (l.status === "signed") return "Imzolagan";
  if (l.status === "confirmed") return "Sabab yozgan, imzo yo‘q";
  return "Hali yozmagan";
}

function reasonOf(l: ExplanationLetterRow): string {
  const text = (l.reasonText || "").trim();
  if (!l.reasonCode) return "";
  if (l.reasonCode === MANUAL_REASON) return text;
  const label = REASONS[l.kind].find((r) => r.code === l.reasonCode)?.label ?? "Boshqa sabab";
  return text ? `${label}: ${text}` : label;
}

const HEADERS = [
  "№",
  "Hujjat raqami",
  "Familiya Ism",
  "Lavozim",
  "Filial",
  "Smena",
  "Sana",
  "Holat",
  "Kelgan vaqti",
  "Kechikish (daq.)",
  "Bosqich",
  "Jarima (so‘m)",
  "Rahbariyat qarori",
  "Qaror izohi",
  "Qaror qilgan",
  "Qaror vaqti",
  "Xodim holati",
  "Xodim yozgan sabab",
  "Imzolangan vaqti",
  "Telefon",
];
const WIDTHS = [5, 14, 30, 16, 22, 12, 12, 12, 11, 11, 9, 14, 20, 36, 22, 17, 22, 60, 17, 16];
const DECISION_COL = 13;

function rowOf(l: ExplanationLetterRow, idx: number): Array<string | number> {
  return [
    idx + 1,
    l.letterNo,
    l.fullName,
    l.position,
    l.branch,
    l.shift,
    dmy(l.eventDate),
    l.kind === "late" ? "Kechikish" : "Kelmagan",
    l.kind === "late" ? l.checkIn ?? "" : "",
    l.kind === "late" ? l.lateMinutes ?? "" : "",
    `${l.strikeN}-bosqich`,
    l.amount || 0,
    decisionLabel(l),
    l.reviewNote ?? "",
    l.reviewedByName ?? "",
    dateTime(l.reviewedAt),
    employeeLabel(l),
    reasonOf(l),
    dateTime(l.signedAt),
    l.phone ?? "",
  ];
}

function lettersSheet(wb: ExcelJS.Workbook, name: string, title: string, items: ExplanationLetterRow[]) {
  const sheet = paintCredSheet(wb, {
    name,
    title,
    headers: HEADERS,
    widths: WIDTHS,
    rows: items.map(rowOf),
    monoCols: [2],
  });
  items.forEach((l, i) => {
    const row = sheet.getRow(i + 3);
    const cell = row.getCell(DECISION_COL);
    const argb = l.reviewStatus === "approved" ? GREEN : l.reviewStatus === "cancelled" ? GRAY : AMBER;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    cell.font = { name: "Calibri", size: 10, bold: true };
    row.getCell(18).alignment = { wrapText: true, vertical: "top" };
    row.getCell(14).alignment = { wrapText: true, vertical: "top" };
    if (l.status !== "signed") row.getCell(17).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
  });
  return sheet;
}

async function reportLetters(): Promise<ExplanationLetterRow[]> {
  await ensureExplanationSchema();
  return (await lettersForMonth(null))
    .filter((l) => !l.isTest)
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate) || a.fullName.localeCompare(b.fullName, "uz"));
}

export async function buildExplanationReport(): Promise<{
  buffer: Buffer;
  filename: string;
  totals: { all: number; approved: number; notApproved: number; cancelled: number; signed: number; unsigned: number; deleted: number };
}> {
  const items = await reportLetters();
  const approved = items.filter((l) => l.reviewStatus === "approved");
  const cancelled = items.filter((l) => l.reviewStatus === "cancelled");
  const notApproved = items.filter((l) => !l.reviewStatus);
  const { rows: deleted } = await pool.query(
    `SELECT letter_no, full_name, event_date, kind, deleted_by_name, deleted_at FROM explanation_letter_deletions ORDER BY deleted_at DESC`,
  );
  const { ymd } = tashkentNow();
  const stamp = `${dmy(ymd)} holatiga`;

  const wb = newCredWorkbook();
  const byBranch = new Map<string, ExplanationLetterRow[]>();
  for (const l of items) byBranch.set(l.branch || "—", [...(byBranch.get(l.branch || "—") ?? []), l]);
  paintCredSheet(wb, {
    name: "Umumiy",
    title: `Tushuntirish xatlari — umumiy hisobot · ${stamp}`,
    headers: ["Ko‘rsatkich", "Soni"],
    widths: [44, 14],
    rows: [
      ["Jami xatlar", items.length],
      ["Tasdiqlangan (jarima qoladi)", approved.length],
      ["Tasdiqlanmagan (qaror kutilmoqda)", notApproved.length],
      ["Bekor qilingan (uzrli)", cancelled.length],
      ["Xodim imzolagan", items.filter((l) => l.status === "signed").length],
      ["Xodim hali imzolamagan", items.filter((l) => l.status !== "signed").length],
      ["Kechikish bo‘yicha", items.filter((l) => l.kind === "late").length],
      ["Kelmaganlik bo‘yicha", items.filter((l) => l.kind === "absent").length],
      ["Jami jarima (tasdiqlangan), so‘m", approved.reduce((s, l) => s + (l.amount || 0), 0)],
      ["Admin o‘chirgan xatlar", deleted.length],
    ],
    monoCols: [],
  });
  paintCredSheet(wb, {
    name: "Filiallar",
    title: `Filiallar bo‘yicha · ${stamp}`,
    headers: ["Filial", "Jami", "Tasdiqlangan", "Tasdiqlanmagan", "Bekor qilingan", "Imzolanmagan"],
    widths: [30, 10, 14, 16, 15, 14],
    rows: [...byBranch.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "uz"))
      .map(([branch, list]) => [
        branch,
        list.length,
        list.filter((l) => l.reviewStatus === "approved").length,
        list.filter((l) => !l.reviewStatus).length,
        list.filter((l) => l.reviewStatus === "cancelled").length,
        list.filter((l) => l.status !== "signed").length,
      ]),
    monoCols: [],
  });
  lettersSheet(wb, "Barcha xatlar", `Barcha tushuntirish xatlari (${items.length}) · ${stamp}`, items);
  lettersSheet(wb, "Tasdiqlangan", `Tasdiqlangan xatlar (${approved.length}) · ${stamp}`, approved);
  lettersSheet(wb, "Tasdiqlanmagan", `Tasdiqlanmagan — qaror kutilmoqda (${notApproved.length}) · ${stamp}`, notApproved);
  lettersSheet(wb, "Bekor qilingan", `Bekor qilingan — uzrli (${cancelled.length}) · ${stamp}`, cancelled);
  if (deleted.length) {
    paintCredSheet(wb, {
      name: "O‘chirilganlar",
      title: `Admin o‘chirgan xatlar (${deleted.length})`,
      headers: ["№", "Hujjat raqami", "Familiya Ism", "Sana", "Holat", "Kim o‘chirdi", "Qachon"],
      widths: [5, 14, 30, 12, 12, 24, 18],
      rows: deleted.map((d, i) => [
        i + 1,
        String(d.letter_no || ""),
        String(d.full_name || ""),
        dmy(String(d.event_date)),
        d.kind === "late" ? "Kechikish" : "Kelmagan",
        String(d.deleted_by_name || ""),
        dateTime(d.deleted_at instanceof Date ? d.deleted_at.toISOString() : String(d.deleted_at)),
      ]),
      monoCols: [2],
    });
  }

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    buffer,
    filename: `tushuntirish_xatlari_${ymd}.xlsx`,
    totals: {
      all: items.length,
      approved: approved.length,
      notApproved: notApproved.length,
      cancelled: cancelled.length,
      signed: items.filter((l) => l.status === "signed").length,
      unsigned: items.filter((l) => l.status !== "signed").length,
      deleted: deleted.length,
    },
  };
}

export async function sendExplanationReport(chatId: string = REPORT_CHAT_ID) {
  if (!isTelegramConfigured()) throw new Error("Telegram bot sozlanmagan");
  const report = await buildExplanationReport();
  const { ymd } = tashkentNow();
  const t = report.totals;
  const caption = [
    `<b>📄 Tushuntirish xatlari — to‘liq hisobot</b>`,
    `${escapeHtml(dmy(ymd))} holatiga (har ${REPORT_EVERY_DAYS} kunda yangilanadi)`,
    "",
    `Jami: <b>${t.all}</b>`,
    `✅ Tasdiqlangan: <b>${t.approved}</b>`,
    `⏳ Tasdiqlanmagan: <b>${t.notApproved}</b>`,
    `🚫 Bekor qilingan: <b>${t.cancelled}</b>`,
    `✍️ Imzolagan: <b>${t.signed}</b> · imzolamagan: <b>${t.unsigned}</b>`,
    "",
    "Excel ichida har bir varaqda filtr bor: ism, filial, sana, qaror bo‘yicha qidiring.",
    "Asl xatlar PDF ko‘rinishida quyida — qaror bo‘yicha alohida fayllarda.",
  ].join("\n");
  await sendDocument(chatId, report.buffer, report.filename, {
    caption,
    parseMode: "HTML",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  return report.totals;
}

/** Bitta PDF faylda nechta xat — Telegram 50 MB chegarasidan oshmasligi uchun */
const PDF_CHUNK = 40;
const PDF_MAX_BYTES = 45 * 1024 * 1024;

const PDF_GROUPS: Array<{ key: string; title: string; icon: string; pick: (l: ExplanationLetterRow) => boolean }> = [
  { key: "Tasdiqlangan", title: "Tasdiqlangan", icon: "✅", pick: (l) => l.reviewStatus === "approved" },
  { key: "Tasdiqlanmagan", title: "Tasdiqlanmagan (qaror kutilmoqda)", icon: "⏳", pick: (l) => !l.reviewStatus },
  { key: "Bekor_qilingan", title: "Bekor qilingan (uzrli)", icon: "🚫", pick: (l) => l.reviewStatus === "cancelled" },
];

async function mergeLetterPdfs(items: ExplanationLetterRow[]): Promise<Buffer> {
  const settings = await getLetterSettings();
  const origin = publicAppUrl() || null;
  const merged = await PDFDocument.create();
  for (const l of items) {
    const doc = await PDFDocument.load(await renderExplanationLetterPdf(letterContent(l, origin, settings), await letterImages(l.id)));
    for (const page of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(page);
  }
  return Buffer.from(await merged.save());
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asl tushuntirish xatlari (sayt/yuklab olishdagi PDF bilan bir xil) — qaror bo‘yicha guruhlab yuboriladi */
export async function sendOriginalLetterPdfs(chatId: string = REPORT_CHAT_ID): Promise<number> {
  if (!isTelegramConfigured()) throw new Error("Telegram bot sozlanmagan");
  const items = await reportLetters();
  const { ymd } = tashkentNow();
  let files = 0;

  const sendPart = async (group: (typeof PDF_GROUPS)[number], part: ExplanationLetterRow[], from: number, total: number) => {
    const buffer = await mergeLetterPdfs(part);
    if (buffer.length > PDF_MAX_BYTES && part.length > 1) {
      const half = Math.ceil(part.length / 2);
      await sendPart(group, part.slice(0, half), from, total);
      await sendPart(group, part.slice(half), from + half, total);
      return;
    }
    const range = total > part.length ? ` · ${from + 1}–${from + part.length} / ${total}` : ` · ${total} ta`;
    const names = part
      .slice(0, 12)
      .map((l) => `• ${escapeHtml(l.fullName)} — ${dmy(l.eventDate)}`)
      .join("\n");
    await sendDocument(chatId, buffer, `${group.key}_xatlar_${ymd}${total > part.length ? `_${from + 1}-${from + part.length}` : ""}.pdf`, {
      caption: [`${group.icon} <b>${escapeHtml(group.title)} — asl xatlar</b>${range}`, names, part.length > 12 ? `… va yana ${part.length - 12} ta` : ""]
        .filter(Boolean)
        .join("\n"),
      parseMode: "HTML",
      mimeType: "application/pdf",
    });
    files += 1;
    await pause(1500);
  };

  for (const group of PDF_GROUPS) {
    const list = items.filter(group.pick).sort((a, b) => a.fullName.localeCompare(b.fullName, "uz") || b.eventDate.localeCompare(a.eventDate));
    for (let i = 0; i < list.length; i += PDF_CHUNK) {
      try {
        await sendPart(group, list.slice(i, i + PDF_CHUNK), i, list.length);
      } catch (err) {
        logger.error({ err, group: group.key, from: i }, "Asl tushuntirish xatlari PDF yuborilmadi");
      }
    }
  }
  return files;
}

export async function reportSchedule(): Promise<{ lastSentOn: string | null; nextSendOn: string; chatId: string; everyDays: number; hour: number }> {
  await ensureExplanationSchema();
  const { rows } = await pool.query(`SELECT sent_on FROM explanation_report_log ORDER BY sent_on DESC LIMIT 1`);
  const last = rows[0]?.sent_on ? String(rows[0].sent_on) : null;
  const { ymd, hour } = tashkentNow();
  let next = last ? addDays(last, REPORT_EVERY_DAYS) : hour < REPORT_HOUR ? ymd : addDays(ymd, 1);
  if (next < ymd || (next === ymd && hour > REPORT_HOUR)) next = hour < REPORT_HOUR ? ymd : addDays(ymd, 1);
  return { lastSentOn: last, nextSendOn: next, chatId: REPORT_CHAT_ID, everyDays: REPORT_EVERY_DAYS, hour: REPORT_HOUR };
}

/** Har daqiqada: soat 10:00–10:59 oralig‘ida, oxirgi yuborilgandan 3 kun o‘tgan bo‘lsa — yuboradi */
export async function explanationReportTick(): Promise<void> {
  if (!isTelegramConfigured()) return;
  const { ymd, hour } = tashkentNow();
  if (hour !== REPORT_HOUR) return;
  await ensureExplanationSchema();
  const { rows } = await pool.query(`SELECT sent_on FROM explanation_report_log ORDER BY sent_on DESC LIMIT 1`);
  const last = rows[0]?.sent_on ? String(rows[0].sent_on) : null;
  if (last && daysBetween(last, ymd) < REPORT_EVERY_DAYS) return;
  const claim = await pool.query(
    `INSERT INTO explanation_report_log (sent_on, chat_id) VALUES ($1, $2) ON CONFLICT (sent_on) DO NOTHING`,
    [ymd, REPORT_CHAT_ID],
  );
  if (!claim.rowCount) return;
  try {
    const totals = await sendExplanationReport();
    await pool.query(`UPDATE explanation_report_log SET total = $2, sent_at = NOW() WHERE sent_on = $1`, [ymd, totals.all]);
    logger.info({ totals }, "Tushuntirish xatlari hisoboti yuborildi");
  } catch (err) {
    await pool.query(`DELETE FROM explanation_report_log WHERE sent_on = $1`, [ymd]).catch(() => undefined);
    throw err;
  }
  const files = await sendOriginalLetterPdfs();
  logger.info({ files }, "Asl tushuntirish xatlari PDF yuborildi");
}
