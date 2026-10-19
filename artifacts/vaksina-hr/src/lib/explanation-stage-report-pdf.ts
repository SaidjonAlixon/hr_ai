/**
 * Tushuntirish xatlari — tanlangan bosqich (holat) bo‘yicha
 * ism-familiya + koordinator hisobot PDF.
 */

import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";
import { FINAL_STRIKE, LETTER_STAGES, type ExplanationLetter } from "./explanation-letters-api";

const FONT =
  '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

export type StageReportRow = {
  fullName: string;
  coordinator: string;
};

function mmToPx(mm: number, dpi = 160): number {
  return Math.round((mm / 25.4) * dpi);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  const t = String(text || "—");
  if (ctx.measureText(t).width <= maxW) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
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

/** Filtrlangan xatlardan — xodim bo‘yicha bir marta (ism + koordinator) */
export function stageReportRows(
  letters: ExplanationLetter[],
  stage: number,
  coordFallback = "Koordinatorsiz",
): StageReportRow[] {
  const n = Math.min(Math.max(1, stage), FINAL_STRIKE);
  const byUser = new Map<number, StageReportRow>();
  for (const l of letters) {
    if (Math.min(l.strikeN, FINAL_STRIKE) !== n) continue;
    if (byUser.has(l.userId)) continue;
    byUser.set(l.userId, {
      fullName: (l.fullName || "—").trim() || "—",
      coordinator: l.coordinator?.name?.trim() || coordFallback,
    });
  }
  return [...byUser.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, "uz"));
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
    throw new Error("Bu bosqichda hisobot uchun xodim yo‘q. Avval bosqichni tanlang.");
  }

  const pageW = 210;
  const pageH = 297;
  const margin = 14;
  const dpi = 160;
  const canvasW = mmToPx(pageW, dpi);
  const canvasH = mmToPx(pageH, dpi);
  const scale = canvasW / pageW;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });

  const cols = [
    { title: "№", w: 12 },
    { title: "Ism familiya", w: 95 },
    { title: "Koordinator", w: 75 },
  ];
  const tableW = cols.reduce((s, c) => s + c.w, 0);

  let index = 0;
  let page = 0;
  while (index < opts.rows.length || (opts.rows.length === 0 && page === 0)) {
    if (page > 0) doc.addPage();
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PDF chizilmadi");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Header
    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(0, 0, canvasW, 28 * scale);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(6.2 * scale)}px ${FONT}`;
    ctx.fillText("Hisobot — tushuntirish xatlari", margin * scale, 11 * scale);
    ctx.font = `bold ${Math.round(4.2 * scale)}px ${FONT}`;
    ctx.fillStyle = "#bfdbfe";
    ctx.fillText(stageTitle, margin * scale, 18.5 * scale);
    ctx.font = `${Math.round(2.8 * scale)}px ${FONT}`;
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(
      `${opts.monthLabel}  ·  ${opts.groupLabel}${opts.filterNote ? `  ·  ${opts.filterNote}` : ""}`,
      margin * scale,
      24.5 * scale,
    );
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.round(2.6 * scale)}px ${FONT}`;
    ctx.fillText(`${stampNow()}  ·  ${page + 1}-varaq`, (pageW - margin) * scale, 11 * scale);
    ctx.fillText(`${opts.rows.length} ta xodim`, (pageW - margin) * scale, 16.5 * scale);
    ctx.textAlign = "left";

    let y = 34 * scale;
    const tableX = margin * scale;
    const headH = 8 * scale;
    const rowH = 8.5 * scale;

    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(tableX, y, tableW * scale, headH);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(3.1 * scale)}px ${FONT}`;
    let x = tableX;
    for (const col of cols) {
      ctx.fillText(col.title, x + 2.2 * scale, y + 5.3 * scale);
      x += col.w * scale;
    }
    y += headH;

    const bottom = (pageH - 12) * scale;
    while (index < opts.rows.length && y + rowH <= bottom) {
      const r = opts.rows[index]!;
      ctx.fillStyle = index % 2 === 0 ? "#ffffff" : "#f1f5f9";
      ctx.fillRect(tableX, y, tableW * scale, rowH);
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.strokeRect(tableX, y, tableW * scale, rowH);

      const cells = [
        { text: String(index + 1), bold: true, color: "#0b3a5c", w: cols[0]!.w },
        { text: r.fullName, bold: true, color: "#0f172a", w: cols[1]!.w },
        {
          text: r.coordinator,
          bold: false,
          color: r.coordinator === "Koordinatorsiz" ? "#94a3b8" : "#334155",
          w: cols[2]!.w,
        },
      ];
      let cx = tableX;
      for (const cell of cells) {
        ctx.fillStyle = cell.color;
        ctx.font = `${cell.bold ? "bold " : ""}${Math.round(3.15 * scale)}px ${FONT}`;
        ctx.fillText(truncate(ctx, cell.text, cell.w * scale - 4 * scale), cx + 2.2 * scale, y + 5.6 * scale);
        cx += cell.w * scale;
      }
      y += rowH;
      index += 1;
    }

    ctx.fillStyle = "#94a3b8";
    ctx.font = `${Math.round(2.4 * scale)}px ${FONT}`;
    ctx.fillText("VAKSINA MED HR · faqat tanlangan bosqich xodimlari", margin * scale, (pageH - 6) * scale);

    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, pageH);
    page += 1;
    if (opts.rows.length === 0) break;
  }

  const safeStage = String(opts.stage);
  const blob = doc.output("blob");
  await deliverFile(blob, `Hisobot_${safeStage}-holat_${opts.monthLabel.replace(/\s+/g, "_")}.pdf`);
}
