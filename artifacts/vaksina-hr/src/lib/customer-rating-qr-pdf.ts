/**
 * Mijoz baholash QR — A4 bo‘yi (portrait), kitobcha emas.
 * Yuqori: «Xizmatni baholang» · Markaz: katta QR · Past: filial nomi.
 */
import QRCode from "qrcode";
import { jsPDF } from "jspdf";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;
const BRAND = "#0b3a5c";
const ACCENT = "#c9a227";
const MUTED = "#64748b";
const LIGHT = "#e8eef5";

const UNICODE_FONT =
  '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function safeFileBase(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 70)
      .replace(/-+$/g, "") || "baho-qr"
  );
}

type TextBlock = { dataUrl: string; widthMm: number; heightMm: number };

function renderUnicodeTextPng(
  text: string,
  opts: {
    fontSizePx: number;
    fontWeight?: "normal" | "bold" | "800";
    color: string;
    maxWidthMm: number;
    align?: "center" | "left";
    letterSpacingPx?: number;
  },
): TextBlock {
  const dpr = 3;
  const maxWidthPx = Math.round((opts.maxWidthMm / 25.4) * 96 * dpr);
  const fontSize = opts.fontSizePx * dpr;
  const fontWeight = opts.fontWeight || "normal";
  const lineHeight = fontSize * 1.22;
  const padX = 6 * dpr;
  const padY = 4 * dpr;
  const letterSpacing = (opts.letterSpacingPx || 0) * dpr;

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("Canvas ishlamaydi");
  measure.font = `${fontWeight} ${fontSize}px ${UNICODE_FONT}`;

  const measureLine = (line: string) => {
    if (!letterSpacing) return measure.measureText(line).width;
    let w = 0;
    for (const ch of line) w += measure.measureText(ch).width + letterSpacing;
    return w - letterSpacing;
  };

  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (measureLine(trial) <= maxWidthPx - padX * 2) current = trial;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) lines.push(" ");

  const contentW = Math.min(
    maxWidthPx,
    Math.ceil(Math.max(...lines.map((l) => measureLine(l))) + padX * 2),
  );
  const contentH = Math.ceil(lines.length * lineHeight + padY * 2);

  const canvas = document.createElement("canvas");
  canvas.width = contentW;
  canvas.height = contentH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas ishlamaydi");
  ctx.clearRect(0, 0, contentW, contentH);
  ctx.font = `${fontWeight} ${fontSize}px ${UNICODE_FONT}`;
  ctx.fillStyle = opts.color;
  ctx.textBaseline = "top";
  const align = opts.align || "center";

  lines.forEach((line, i) => {
    const tw = measureLine(line);
    let x = align === "center" ? (contentW - tw) / 2 : padX;
    const y = padY + i * lineHeight;
    if (!letterSpacing) {
      ctx.fillText(line, x, y);
      return;
    }
    for (const ch of line) {
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + letterSpacing;
    }
  });

  return {
    dataUrl: canvas.toDataURL("image/png"),
    widthMm: (contentW / dpr / 96) * 25.4,
    heightMm: (contentH / dpr / 96) * 25.4,
  };
}

/** Chiroyli QR: navy + yumshoq oq fon + tashqi ramka canvas ichida */
async function styledQrPng(url: string, size = 900): Promise<string> {
  const pad = Math.round(size * 0.08);
  const qrSize = size - pad * 2;
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, url, {
    width: qrSize,
    margin: 1,
    errorCorrectionLevel: "H",
    color: { dark: BRAND, light: "#ffffff" },
  });

  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas ishlamaydi");

  // Soft card background
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 0, 0, size, size, size * 0.04);
  ctx.fill();

  // Outer decorative frame
  ctx.strokeStyle = LIGHT;
  ctx.lineWidth = size * 0.018;
  roundRect(ctx, size * 0.02, size * 0.02, size * 0.96, size * 0.96, size * 0.035);
  ctx.stroke();

  // Accent corner ticks
  const tick = size * 0.07;
  const inset = size * 0.035;
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = size * 0.012;
  ctx.lineCap = "round";
  // TL
  ctx.beginPath();
  ctx.moveTo(inset, inset + tick);
  ctx.lineTo(inset, inset);
  ctx.lineTo(inset + tick, inset);
  ctx.stroke();
  // TR
  ctx.beginPath();
  ctx.moveTo(size - inset - tick, inset);
  ctx.lineTo(size - inset, inset);
  ctx.lineTo(size - inset, inset + tick);
  ctx.stroke();
  // BL
  ctx.beginPath();
  ctx.moveTo(inset, size - inset - tick);
  ctx.lineTo(inset, size - inset);
  ctx.lineTo(inset + tick, size - inset);
  ctx.stroke();
  // BR
  ctx.beginPath();
  ctx.moveTo(size - inset - tick, size - inset);
  ctx.lineTo(size - inset, size - inset);
  ctx.lineTo(size - inset, size - inset - tick);
  ctx.stroke();

  ctx.drawImage(qrCanvas, pad, pad, qrSize, qrSize);

  // Center brand disc (errorCorrection H allows overlay)
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.085;
  ctx.beginPath();
  ctx.arc(cx, cy, r + size * 0.012, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = BRAND;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${Math.round(size * 0.038)}px ${UNICODE_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("V", cx, cy + 1);

  return out.toDataURL("image/png");
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawPageDecor(doc: jsPDF) {
  // Top brand bar
  doc.setFillColor(11, 58, 92);
  doc.rect(0, 0, PAGE_W, 8, "F");
  // Thin accent line under bar
  doc.setFillColor(201, 162, 39);
  doc.rect(0, 8, PAGE_W, 1.2, "F");
  // Bottom bar
  doc.setFillColor(11, 58, 92);
  doc.rect(0, PAGE_H - 8, PAGE_W, 8, "F");
  doc.setFillColor(201, 162, 39);
  doc.rect(0, PAGE_H - 9.2, PAGE_W, 1.2, "F");

  // Side soft guides (wide feel)
  doc.setDrawColor(232, 238, 245);
  doc.setLineWidth(0.6);
  doc.line(MARGIN * 0.55, 22, MARGIN * 0.55, PAGE_H - 22);
  doc.line(PAGE_W - MARGIN * 0.55, 22, PAGE_W - MARGIN * 0.55, PAGE_H - 22);
}

function placeText(doc: jsPDF, block: TextBlock, cx: number, y: number) {
  doc.addImage(block.dataUrl, "PNG", cx - block.widthMm / 2, y, block.widthMm, block.heightMm);
  return y + block.heightMm;
}

export type BahoQrPage = {
  branchLabel: string;
  publicUrl: string;
  branchNo?: number | null;
};

function drawBahoQrPage(doc: jsPDF, png: string, item: BahoQrPage, pageMeta?: string) {
  drawPageDecor(doc);
  const cx = PAGE_W / 2;
  const contentW = PAGE_W - MARGIN * 2;
  let y = 22;

  if (pageMeta) {
    const meta = renderUnicodeTextPng(pageMeta, {
      fontSizePx: 10,
      color: MUTED,
      maxWidthMm: contentW,
      align: "center",
      letterSpacingPx: 0.4,
    });
    y = placeText(doc, meta, cx, y) + 4;
  }

  const brand = renderUnicodeTextPng("VAKSINA MED", {
    fontSizePx: 12,
    fontWeight: "bold",
    color: ACCENT,
    maxWidthMm: contentW,
    align: "center",
    letterSpacingPx: 2.2,
  });
  y = placeText(doc, brand, cx, y) + 6;

  const title = renderUnicodeTextPng("Xizmatni baholang", {
    fontSizePx: 28,
    fontWeight: "800",
    color: BRAND,
    maxWidthMm: contentW,
    align: "center",
  });
  y = placeText(doc, title, cx, y) + 4;

  const sub = renderUnicodeTextPng("Dorixonamizga tashrifingiz uchun rahmat!", {
    fontSizePx: 13,
    color: MUTED,
    maxWidthMm: contentW,
    align: "center",
  });
  y = placeText(doc, sub, cx, y) + 10;

  // Wide QR — A4 ichida maksimal aniq
  const qrMm = 152;
  const qrX = (PAGE_W - qrMm) / 2;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(qrX - 6, y - 6, qrMm + 12, qrMm + 12, 4, 4, "F");
  doc.addImage(png, "PNG", qrX, y, qrMm, qrMm, undefined, "FAST");
  y += qrMm + 14;

  const hint = renderUnicodeTextPng("Kamerani QR-kodga qarating", {
    fontSizePx: 11,
    color: MUTED,
    maxWidthMm: contentW,
    align: "center",
  });
  y = placeText(doc, hint, cx, y) + 8;

  // Branch plate
  const plateW = contentW;
  const plateH = 28;
  const plateX = MARGIN;
  if (y + plateH > PAGE_H - 18) y = PAGE_H - 18 - plateH;
  doc.setFillColor(11, 58, 92);
  doc.roundedRect(plateX, y, plateW, plateH, 3, 3, "F");
  doc.setFillColor(201, 162, 39);
  doc.rect(plateX, y, 3.2, plateH, "F");

  const branchLine =
    item.branchNo != null && item.branchNo > 0
      ? `№${item.branchNo}  ·  ${item.branchLabel}`
      : item.branchLabel;

  const branchTitle = renderUnicodeTextPng(branchLine, {
    fontSizePx: 16,
    fontWeight: "bold",
    color: "#ffffff",
    maxWidthMm: plateW - 16,
    align: "center",
  });
  placeText(doc, branchTitle, cx, y + (plateH - branchTitle.heightMm) / 2);
}

export async function downloadBahoQrPdf(item: BahoQrPage) {
  if (!item.publicUrl?.trim()) throw new Error("QR havola yo‘q");
  const png = await styledQrPng(item.publicUrl, 1000);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  drawBahoQrPage(doc, png, item);
  downloadBlob(doc.output("blob"), `${safeFileBase(`baho-${item.branchLabel}`)}.pdf`);
}

export async function downloadAllBahoQrPdf(items: BahoQrPage[]) {
  const list = items.filter((it) => it.publicUrl?.trim());
  if (!list.length) throw new Error("Yuklash uchun faol QR yo‘q");

  const pngs = await Promise.all(
    list.map(async (it) => ({
      item: it,
      png: await styledQrPng(it.publicUrl, 1000),
    })),
  );

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  pngs.forEach((row, idx) => {
    if (idx > 0) doc.addPage();
    drawBahoQrPage(doc, row.png, row.item, `Mijoz baholash QR · ${idx + 1} / ${pngs.length}`);
  });
  downloadBlob(doc.output("blob"), "baho-qr-barcha-filiallar.pdf");
}

/** Preview PNG (modal uchun) — A4 emas, faqat stylized QR */
export async function bahoQrPreviewPng(url: string): Promise<string> {
  return styledQrPng(url, 640);
}
