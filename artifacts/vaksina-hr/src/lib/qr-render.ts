/** QR PNG/PDF — `qrcode` + haqiqiy PDF (`jspdf`), kirillcha matn canvas orqali. */

import QRCode from "qrcode";
import { jsPDF } from "jspdf";

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function renderQrToCanvas(canvas: HTMLCanvasElement, text: string, size = 280): Promise<void> {
  if (!text?.trim()) throw new Error("QR matn bo‘sh");
  await QRCode.toCanvas(canvas, text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0b3a5c", light: "#ffffff" },
  });
}

export async function qrPngDataUrl(text: string, size = 512): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0b3a5c", light: "#ffffff" },
  });
}

export async function downloadQrPng(text: string, filename: string) {
  const url = await qrPngDataUrl(text);
  downloadDataUrl(url, filename);
}

function safeFileBase(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .replace(/-+$/g, "") || "davomat-qr";
}

/** A4 mm — har sahifada 1 ta katta QR */
const PAGE_W = 210;
const QR_MM = 140;
const COLOR_DARK = "#0b3a5c";
const COLOR_MUTED = "#64748b";

/** Brauzer shrifti — kirill / lotin / o‘zbek */
const UNICODE_FONT =
  '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

type TextBlock = {
  dataUrl: string;
  widthMm: number;
  heightMm: number;
};

/**
 * Matnni PNG ga chizadi — jsPDF Helvetica kirillchani o‘qimaydi.
 * px → mm: 96dpi taxminan (1 inch = 25.4 mm).
 */
function renderUnicodeTextPng(
  text: string,
  opts: {
    fontSizePx: number;
    fontWeight?: "normal" | "bold";
    color: string;
    maxWidthMm: number;
    align?: "center" | "left";
  },
): TextBlock {
  const dpr = 2;
  const maxWidthPx = Math.round((opts.maxWidthMm / 25.4) * 96 * dpr);
  const fontSize = opts.fontSizePx * dpr;
  const fontWeight = opts.fontWeight || "normal";
  const lineHeight = fontSize * 1.25;
  const padX = 4 * dpr;
  const padY = 2 * dpr;

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("Canvas ishlamaydi");
  measure.font = `${fontWeight} ${fontSize}px ${UNICODE_FONT}`;

  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (measure.measureText(trial).width <= maxWidthPx - padX * 2) {
      current = trial;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) lines.push(" ");

  const contentW = Math.min(
    maxWidthPx,
    Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width)) + padX * 2),
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
    const tw = ctx.measureText(line).width;
    const x =
      align === "center" ? (contentW - tw) / 2 : padX;
    ctx.fillText(line, x, padY + i * lineHeight);
  });

  const widthMm = (contentW / dpr / 96) * 25.4;
  const heightMm = (contentH / dpr / 96) * 25.4;
  return {
    dataUrl: canvas.toDataURL("image/png"),
    widthMm,
    heightMm,
  };
}

function drawQrPage(
  doc: jsPDF,
  opts: {
    png: string;
    title: string;
    subtitle?: string;
    meta?: string;
  },
) {
  const { png, title, subtitle = "VAKSINA MED · Davomat QR", meta } = opts;
  const cx = PAGE_W / 2;
  let y = 22;
  const maxTextW = PAGE_W - 28;

  if (meta) {
    const block = renderUnicodeTextPng(meta, {
      fontSizePx: 10,
      color: COLOR_MUTED,
      maxWidthMm: maxTextW,
      align: "center",
    });
    doc.addImage(block.dataUrl, "PNG", cx - block.widthMm / 2, y, block.widthMm, block.heightMm);
    y += block.heightMm + 6;
  }

  const titleBlock = renderUnicodeTextPng(title.trim() || "Davomat QR", {
    fontSizePx: 18,
    fontWeight: "bold",
    color: COLOR_DARK,
    maxWidthMm: maxTextW,
    align: "center",
  });
  doc.addImage(
    titleBlock.dataUrl,
    "PNG",
    cx - titleBlock.widthMm / 2,
    y,
    titleBlock.widthMm,
    titleBlock.heightMm,
  );
  y += titleBlock.heightMm + 5;

  const subBlock = renderUnicodeTextPng(subtitle, {
    fontSizePx: 12,
    color: COLOR_MUTED,
    maxWidthMm: maxTextW,
    align: "center",
  });
  doc.addImage(subBlock.dataUrl, "PNG", cx - subBlock.widthMm / 2, y, subBlock.widthMm, subBlock.heightMm);
  y += subBlock.heightMm + 10;

  const qrX = (PAGE_W - QR_MM) / 2;
  doc.addImage(png, "PNG", qrX, y, QR_MM, QR_MM, undefined, "FAST");
}

export async function downloadQrPdf(text: string, title: string, filename: string) {
  const png = await qrPngDataUrl(text, 720);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  drawQrPage(doc, { png, title: title.trim() || "Davomat QR" });
  const base = safeFileBase(filename.replace(/\.pdf$/i, "") || title);
  downloadBlob(doc.output("blob"), `${base}.pdf`);
}

export type BulkQrItem = {
  n: number;
  title: string;
  payload: string;
};

/** Barcha QR lar — haqiqiy .pdf, har A4 sahifada 1 ta katta QR. */
export async function downloadAllQrPdf(items: BulkQrItem[], docTitle = "Davomat QR — barcha filiallar") {
  const list = items.filter((it) => it.payload?.trim());
  if (!list.length) throw new Error("Yuklash uchun faol QR yo‘q");

  const pngs = await Promise.all(
    list.map(async (it) => ({
      ...it,
      png: await qrPngDataUrl(it.payload, 720),
    })),
  );

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const total = pngs.length;

  pngs.forEach((it, idx) => {
    if (idx > 0) doc.addPage();
    drawQrPage(doc, {
      png: it.png,
      title: `${it.n}. ${it.title}`.trim(),
      meta: `${docTitle} · ${idx + 1} / ${total}`,
    });
  });

  downloadBlob(doc.output("blob"), `${safeFileBase(docTitle)}.pdf`);
}
