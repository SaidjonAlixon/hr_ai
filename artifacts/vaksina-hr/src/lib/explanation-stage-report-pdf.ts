/**
 * Tushuntirish xatlari — tanlangan bosqich bo‘yicha to‘liq hisobot PDF
 * (rahbarlar uchun: xodim, filial, muammo, bosqich, chora, jarima, sabab, koordinator, holat).
 */

import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";
import {
  FINAL_STRIKE,
  LETTER_STAGES,
  fmtLetterDate,
  fmtSum,
  type ExplanationLetter,
} from "./explanation-letters-api";

const FONT =
  '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

export type StageReportRow = {
  fullName: string;
  position: string;
  phone: string;
  branch: string;
  shift: string;
  kindLabel: string;
  eventDate: string;
  eventDetail: string;
  stageLabel: string;
  chora: string;
  jarima: string;
  sabab: string;
  coordinator: string;
  statusLabel: string;
  letterNo: string;
};

function mmToPx(mm: number, dpi = 140): number {
  return Math.round((mm / 25.4) * dpi);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  const t = String(text || "—");
  if (ctx.measureText(t).width <= maxW) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number,
): string[] {
  const words = String(text || "—").split(/\s+/).filter(Boolean);
  if (!words.length) return ["—"];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1] || "";
    lines[maxLines - 1] = truncate(ctx, last, maxW);
  }
  return lines.length ? lines : ["—"];
}

function stampNow(): string {
  return new Date().toLocaleString("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function statusOf(l: ExplanationLetter): string {
  if (l.reviewStatus === "approved") return "Tasdiqlangan";
  if (l.reviewStatus === "cancelled") return "Bekor";
  if (l.status === "signed") return "Qaror kutilmoqda";
  if (l.status === "confirmed") return "Imzo kutilmoqda";
  return "Kutilmoqda";
}

function eventDetailOf(l: ExplanationLetter): string {
  if (l.kind === "absent") {
    return l.planStart && l.planEnd ? `Ish vaqti ${l.planStart}–${l.planEnd}` : "Ishga kelmagan";
  }
  const parts = [l.planStart ? `Reja ${l.planStart}` : null, l.checkIn ? `keldi ${l.checkIn}` : null].filter(Boolean);
  return `${parts.join(" · ")}${l.lateMinutes ? ` · ${l.lateMinutes} daq.` : ""}` || "Kechikkan";
}

/** Har bir xat — alohida qator (to‘liq ma’lumot) */
export function stageReportRows(
  letters: ExplanationLetter[],
  stage: number,
  coordFallback = "Koordinatorsiz",
): StageReportRow[] {
  const n = Math.min(Math.max(1, stage), FINAL_STRIKE);
  const meta = LETTER_STAGES[n - 1];
  const rows: StageReportRow[] = [];
  for (const l of letters) {
    if (Math.min(l.strikeN, FINAL_STRIKE) !== n) continue;
    const amount = Number(l.amount) || 0;
    rows.push({
      fullName: (l.fullName || "—").trim() || "—",
      position: (l.position || "—").trim() || "—",
      phone: (l.phone || l.contacts?.employeePhone || "—").trim() || "—",
      branch: (l.branch || l.contacts?.branchName || "—").trim() || "—",
      shift: (l.shift || "—").trim() || "—",
      kindLabel: l.kind === "absent" ? "Kelmagan" : "Kechikish",
      eventDate: fmtLetterDate(l.eventDate),
      eventDetail: eventDetailOf(l),
      stageLabel: `${n}-holat`,
      chora: meta?.label || l.content?.penalty || "—",
      jarima: amount > 0 ? fmtSum(amount) : meta?.penalty === "Jarimasiz" ? "Jarimasiz" : meta?.penalty || "—",
      sabab: (l.reasonText || "").trim() || "Hali yozilmagan",
      coordinator: l.coordinator?.name?.trim() || coordFallback,
      statusLabel: statusOf(l),
      letterNo: l.letterNo || "—",
    });
  }
  return rows.sort((a, b) => {
    const byName = a.fullName.localeCompare(b.fullName, "uz");
    if (byName) return byName;
    return a.eventDate.localeCompare(b.eventDate, "uz");
  });
}

export async function downloadStageRosterPdf(opts: {
  stage: number;
  monthLabel: string;
  groupLabel: string;
  rows: StageReportRow[];
  filterNote?: string;
}): Promise<void> {
  const stageMeta = LETTER_STAGES[Math.min(opts.stage, FINAL_STRIKE) - 1];
  const stageTitle = stageMeta
    ? `${stageMeta.n}-holat · ${stageMeta.label}`
    : `${opts.stage}-holat`;

  if (!opts.rows.length) {
    throw new Error("Bu bosqichda hisobot uchun yozuv yo‘q. Avval bosqichni tanlang.");
  }

  // A4 landscape — to‘liq ustunlar
  const pageW = 297;
  const pageH = 210;
  const margin = 7;
  const dpi = 140;
  const canvasW = mmToPx(pageW, dpi);
  const canvasH = mmToPx(pageH, dpi);
  const scale = canvasW / pageW;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });

  const cols = [
    { key: "n", title: "№", w: 8 },
    { key: "name", title: "Xodim", w: 38 },
    { key: "branch", title: "Filial / smena", w: 36 },
    { key: "problem", title: "Muammo", w: 34 },
    { key: "stage", title: "Bosqich · chora", w: 34 },
    { key: "jarima", title: "Jarima", w: 26 },
    { key: "sabab", title: "Sabab (xodim)", w: 52 },
    { key: "coord", title: "Koordinator", w: 30 },
    { key: "status", title: "Holat", w: 25 },
  ] as const;
  const tableW = cols.reduce((s, c) => s + c.w, 0);

  let index = 0;
  let page = 0;
  while (index < opts.rows.length) {
    if (page > 0) doc.addPage();
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PDF chizilmadi");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(0, 0, canvasW, 18 * scale);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(5.4 * scale)}px ${FONT}`;
    ctx.fillText("Hisobot — tushuntirish xatlari (to‘liq)", margin * scale, 7.2 * scale);
    ctx.font = `bold ${Math.round(3.6 * scale)}px ${FONT}`;
    ctx.fillStyle = "#bfdbfe";
    ctx.fillText(stageTitle, margin * scale, 12.4 * scale);
    ctx.font = `${Math.round(2.5 * scale)}px ${FONT}`;
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(
      `${opts.monthLabel}  ·  ${opts.groupLabel}${opts.filterNote ? `  ·  ${opts.filterNote}` : ""}  ·  har bir yozuv: muammo, chora, jarima, sabab`,
      margin * scale,
      16.2 * scale,
    );
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.round(2.5 * scale)}px ${FONT}`;
    ctx.fillText(`${stampNow()}  ·  ${page + 1}-varaq`, (pageW - margin) * scale, 7.2 * scale);
    ctx.fillText(`${opts.rows.length} ta yozuv`, (pageW - margin) * scale, 12 * scale);
    ctx.textAlign = "left";

    let y = 21 * scale;
    const tableX = margin * scale;
    const headH = 6.5 * scale;

    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(tableX, y, tableW * scale, headH);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(2.35 * scale)}px ${FONT}`;
    let x = tableX;
    for (const col of cols) {
      ctx.fillText(col.title, x + 1.4 * scale, y + 4.3 * scale);
      x += col.w * scale;
    }
    y += headH;

    const bottom = (pageH - 8) * scale;
    const minRowH = 11 * scale;

    while (index < opts.rows.length) {
      const r = opts.rows[index]!;
      ctx.font = `${Math.round(2.35 * scale)}px ${FONT}`;
      const sababLines = wrapLines(ctx, r.sabab, cols[6]!.w * scale - 3 * scale, 3);
      const rowH = Math.max(minRowH, (sababLines.length + 1) * 3.2 * scale + 2 * scale);
      if (y + rowH > bottom && index > 0) break;

      ctx.fillStyle = index % 2 === 0 ? "#ffffff" : "#f8fafc";
      ctx.fillRect(tableX, y, tableW * scale, rowH);
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.strokeRect(tableX, y, tableW * scale, rowH);

      if (r.kindLabel === "Kelmagan") {
        ctx.fillStyle = "#e11d48";
        ctx.fillRect(tableX, y, 0.7 * scale, rowH);
      }

      const pad = 1.4 * scale;
      const line1 = y + 3.4 * scale;
      const line2 = y + 6.6 * scale;
      const line3 = y + 9.6 * scale;

      // №
      let cx = tableX;
      ctx.fillStyle = "#0b3a5c";
      ctx.font = `bold ${Math.round(2.5 * scale)}px ${FONT}`;
      ctx.fillText(String(index + 1), cx + pad, line1);
      cx += cols[0]!.w * scale;

      // Xodim
      ctx.fillStyle = "#0f172a";
      ctx.font = `bold ${Math.round(2.55 * scale)}px ${FONT}`;
      ctx.fillText(truncate(ctx, r.fullName, cols[1]!.w * scale - 3 * scale), cx + pad, line1);
      ctx.fillStyle = "#64748b";
      ctx.font = `${Math.round(2.15 * scale)}px ${FONT}`;
      ctx.fillText(truncate(ctx, `${r.position} · ${r.phone}`, cols[1]!.w * scale - 3 * scale), cx + pad, line2);
      cx += cols[1]!.w * scale;

      // Filial
      ctx.fillStyle = "#0f172a";
      ctx.font = `bold ${Math.round(2.35 * scale)}px ${FONT}`;
      ctx.fillText(truncate(ctx, r.branch, cols[2]!.w * scale - 3 * scale), cx + pad, line1);
      ctx.fillStyle = "#64748b";
      ctx.font = `${Math.round(2.15 * scale)}px ${FONT}`;
      ctx.fillText(truncate(ctx, r.shift, cols[2]!.w * scale - 3 * scale), cx + pad, line2);
      cx += cols[2]!.w * scale;

      // Muammo
      ctx.fillStyle = r.kindLabel === "Kelmagan" ? "#be123c" : "#c2410c";
      ctx.font = `bold ${Math.round(2.4 * scale)}px ${FONT}`;
      ctx.fillText(r.kindLabel, cx + pad, line1);
      ctx.fillStyle = "#334155";
      ctx.font = `${Math.round(2.15 * scale)}px ${FONT}`;
      ctx.fillText(truncate(ctx, r.eventDate, cols[3]!.w * scale - 3 * scale), cx + pad, line2);
      ctx.fillText(truncate(ctx, r.eventDetail, cols[3]!.w * scale - 3 * scale), cx + pad, line3);
      cx += cols[3]!.w * scale;

      // Bosqich · chora
      ctx.fillStyle = "#9f1239";
      ctx.font = `bold ${Math.round(2.4 * scale)}px ${FONT}`;
      ctx.fillText(r.stageLabel, cx + pad, line1);
      ctx.fillStyle = "#0f172a";
      ctx.font = `${Math.round(2.2 * scale)}px ${FONT}`;
      const choraLines = wrapLines(ctx, r.chora, cols[4]!.w * scale - 3 * scale, 2);
      choraLines.forEach((ln, i) => ctx.fillText(ln, cx + pad, line2 + i * 3 * scale));
      cx += cols[4]!.w * scale;

      // Jarima
      ctx.fillStyle = r.jarima === "Jarimasiz" || r.jarima === "—" ? "#64748b" : "#9f1239";
      ctx.font = `bold ${Math.round(2.4 * scale)}px ${FONT}`;
      const jarLines = wrapLines(ctx, r.jarima, cols[5]!.w * scale - 3 * scale, 2);
      jarLines.forEach((ln, i) => ctx.fillText(ln, cx + pad, line1 + i * 3.2 * scale));
      cx += cols[5]!.w * scale;

      // Sabab
      ctx.fillStyle = r.sabab === "Hali yozilmagan" ? "#94a3b8" : "#0f172a";
      ctx.font = `${r.sabab === "Hali yozilmagan" ? "italic " : ""}${Math.round(2.2 * scale)}px ${FONT}`;
      sababLines.forEach((ln, i) => ctx.fillText(ln, cx + pad, line1 + i * 3.1 * scale));
      cx += cols[6]!.w * scale;

      // Koordinator
      ctx.fillStyle = r.coordinator === "Koordinatorsiz" ? "#94a3b8" : "#334155";
      ctx.font = `${Math.round(2.25 * scale)}px ${FONT}`;
      const coordLines = wrapLines(ctx, r.coordinator, cols[7]!.w * scale - 3 * scale, 2);
      coordLines.forEach((ln, i) => ctx.fillText(ln, cx + pad, line1 + i * 3.1 * scale));
      cx += cols[7]!.w * scale;

      // Holat
      ctx.fillStyle = "#0f172a";
      ctx.font = `bold ${Math.round(2.2 * scale)}px ${FONT}`;
      const stLines = wrapLines(ctx, r.statusLabel, cols[8]!.w * scale - 3 * scale, 2);
      stLines.forEach((ln, i) => ctx.fillText(ln, cx + pad, line1 + i * 3.1 * scale));
      ctx.fillStyle = "#94a3b8";
      ctx.font = `${Math.round(1.95 * scale)}px ${FONT}`;
      ctx.fillText(truncate(ctx, `№ ${r.letterNo}`, cols[8]!.w * scale - 3 * scale), cx + pad, line1 + stLines.length * 3.1 * scale);

      y += rowH;
      index += 1;
    }

    ctx.fillStyle = "#94a3b8";
    ctx.font = `${Math.round(2.2 * scale)}px ${FONT}`;
    ctx.fillText(
      "VAKSINA MED HR · rahbariyat uchun to‘liq hisobot (muammo, bosqich, chora, jarima, sabab, koordinator)",
      margin * scale,
      (pageH - 3.5) * scale,
    );

    doc.addImage(canvas.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, pageW, pageH);
    page += 1;
  }

  const blob = doc.output("blob");
  await deliverFile(blob, `Hisobot_${opts.stage}-holat_toliq_${opts.monthLabel.replace(/\s+/g, "_")}.pdf`);
}
