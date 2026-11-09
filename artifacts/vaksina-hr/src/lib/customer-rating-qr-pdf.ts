/**
 * Mijoz baholash QR — A4 portrait.
 * Yuqori: Vaksina logo · Markaz: zamonaviy (nuqta) QR · Past: filial.
 * Markazda logo/dumaloq YO‘Q.
 */
import QRCode from "qrcode";
import { jsPDF } from "jspdf";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;

/** Brend (vaksinahr_logo) */
const PURPLE = "#5c2d91";
const PURPLE_RGB: [number, number, number] = [92, 45, 145];
const YELLOW = "#f5c518";
const YELLOW_RGB: [number, number, number] = [245, 197, 24];
const CYAN = "#22c5e0";
const MUTED = "#64748b";
const LOGO_URL = "/logo_vaksina.png";

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

let logoCache: HTMLCanvasElement | null = null;

/** logo_vaksina.png — qora fonni olib, oq PDF uchun toza logo */
async function loadHeaderLogo(): Promise<HTMLCanvasElement> {
  if (logoCache) return logoCache;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Logo yuklanmadi"));
    el.src = LOGO_URL;
  });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  const sctx = src.getContext("2d");
  if (!sctx) throw new Error("Canvas ishlamaydi");
  sctx.drawImage(img, 0, 0);
  const data = sctx.getImageData(0, 0, w, h);
  const px = data.data;

  // Qora fon → shaffof; qirqish uchun chegarani topish
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      // deyarli qora pixel
      if (r < 35 && g < 35 && b < 35) {
        px[i + 3] = 0;
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  sctx.putImageData(data, 0, 0);

  const pad = Math.round(Math.max(w, h) * 0.02);
  const cw = Math.max(1, maxX - minX + 1 + pad * 2);
  const ch = Math.max(1, maxY - minY + 1 + pad * 2);
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("Canvas ishlamaydi");
  // Oq fon — PDF da qora quti bo‘lmasin
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, cw, ch);
  octx.drawImage(src, minX - pad, minY - pad, cw, ch, 0, 0, cw, ch);
  logoCache = out;
  return out;
}

function isFinderCell(row: number, col: number, n: number): boolean {
  const inTL = row < 7 && col < 7;
  const inTR = row < 7 && col >= n - 7;
  const inBL = row >= n - 7 && col < 7;
  return inTL || inTR || inBL;
}

function isTiming(row: number, col: number): boolean {
  return row === 6 || col === 6;
}

/** Zamonaviy QR: yumaloq nuqtalar + yumaloq finder, markazda hech narsa yo‘q */
async function styledQrPng(url: string, size = 1000): Promise<string> {
  const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
  const modules = qr.modules;
  const n = modules.size;

  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas ishlamaydi");

  // Kartochka
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 0, 0, size, size, size * 0.05);
  ctx.fill();

  // Yengil gradient frame
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, "rgba(92,45,145,0.12)");
  g.addColorStop(0.5, "rgba(245,197,24,0.14)");
  g.addColorStop(1, "rgba(34,197,224,0.12)");
  ctx.strokeStyle = g;
  ctx.lineWidth = size * 0.012;
  roundRect(ctx, size * 0.02, size * 0.02, size * 0.96, size * 0.96, size * 0.042);
  ctx.stroke();

  // Oltin/sariq L-burchaklar
  const tick = size * 0.07;
  const inset = size * 0.03;
  ctx.strokeStyle = YELLOW;
  ctx.lineWidth = size * 0.011;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const corners: Array<[number, number, number, number, number, number]> = [
    [inset, inset + tick, inset, inset, inset + tick, inset],
    [size - inset - tick, inset, size - inset, inset, size - inset, inset + tick],
    [inset, size - inset - tick, inset, size - inset, inset + tick, size - inset],
    [size - inset - tick, size - inset, size - inset, size - inset, size - inset, size - inset - tick],
  ];
  for (const [x1, y1, x2, y2, x3, y3] of corners) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.stroke();
  }

  const margin = size * 0.09;
  const grid = size - margin * 2;
  const cell = grid / n;

  const drawFinder = (originRow: number, originCol: number) => {
    const x = margin + originCol * cell;
    const y = margin + originRow * cell;
    const s = cell * 7;
    const r = cell * 1.15;

    // Tashqi yumaloq kvadrat (binafsha)
    roundRect(ctx, x, y, s, s, r);
    ctx.fillStyle = PURPLE;
    ctx.fill();

    // Oq ichki
    roundRect(ctx, x + cell, y + cell, cell * 5, cell * 5, r * 0.75);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    // Markaziy “ko‘z” — sariq yumaloq kvadrat
    roundRect(ctx, x + cell * 2, y + cell * 2, cell * 3, cell * 3, r * 0.55);
    ctx.fillStyle = YELLOW;
    ctx.fill();

    // Ichki binafsha nuqta
    const cx = x + cell * 3.5;
    const cy = y + cell * 3.5;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = PURPLE;
    ctx.fill();
  };

  drawFinder(0, 0);
  drawFinder(0, n - 7);
  drawFinder(n - 7, 0);

  // Ma’lumot + timing — yumaloq nuqtalar
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!modules.get(row, col)) continue;
      if (isFinderCell(row, col, n)) continue;

      const x = margin + col * cell + cell / 2;
      const y = margin + row * cell + cell / 2;
      const radius = isTiming(row, col) ? cell * 0.32 : cell * 0.38;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      // Timing biroz cyan — brend aksenti
      ctx.fillStyle = isTiming(row, col) ? CYAN : PURPLE;
      ctx.fill();
    }
  }

  return out.toDataURL("image/png");
}

function drawPageDecor(doc: jsPDF) {
  doc.setFillColor(...PURPLE_RGB);
  doc.rect(0, 0, PAGE_W, 7, "F");
  doc.setFillColor(...YELLOW_RGB);
  doc.rect(0, 7, PAGE_W, 1.4, "F");

  doc.setFillColor(...PURPLE_RGB);
  doc.rect(0, PAGE_H - 7, PAGE_W, 7, "F");
  doc.setFillColor(...YELLOW_RGB);
  doc.rect(0, PAGE_H - 8.4, PAGE_W, 1.4, "F");
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

async function drawBahoQrPage(doc: jsPDF, png: string, item: BahoQrPage, pageMeta?: string) {
  drawPageDecor(doc);
  const cx = PAGE_W / 2;
  const contentW = PAGE_W - MARGIN * 2;
  let y = 18;

  if (pageMeta) {
    const meta = renderUnicodeTextPng(pageMeta, {
      fontSizePx: 10,
      color: MUTED,
      maxWidthMm: contentW,
      align: "center",
      letterSpacingPx: 0.4,
    });
    y = placeText(doc, meta, cx, y) + 2;
  }

  // Yuqori: logo_vaksina.png (qora fon olib tashlangan, oq PDF)
  try {
    const logo = await loadHeaderLogo();
    const maxW = 128;
    const maxH = 40;
    const iw = logo.width;
    const ih = logo.height;
    const scale = Math.min(maxW / iw, maxH / ih);
    const wMm = iw * scale;
    const hMm = ih * scale;
    doc.addImage(logo.toDataURL("image/png"), "PNG", cx - wMm / 2, y, wMm, hMm);
    y += hMm + 10;
  } catch {
    const brand = renderUnicodeTextPng("VAKSINA MED", {
      fontSizePx: 14,
      fontWeight: "bold",
      color: PURPLE,
      maxWidthMm: contentW,
      align: "center",
      letterSpacingPx: 2.5,
    });
    y = placeText(doc, brand, cx, y) + 6;
  }

  const title = renderUnicodeTextPng("XIZMATNI BAHOLANG", {
    fontSizePx: 24,
    fontWeight: "800",
    color: PURPLE,
    maxWidthMm: contentW,
    align: "center",
    letterSpacingPx: 2.8,
  });
  y = placeText(doc, title, cx, y) + 4;

  const sub = renderUnicodeTextPng("Dorixonamizga tashrifingiz uchun rahmat!", {
    fontSizePx: 12,
    color: MUTED,
    maxWidthMm: contentW,
    align: "center",
  });
  y = placeText(doc, sub, cx, y) + 8;

  const qrMm = 148;
  const qrX = (PAGE_W - qrMm) / 2;
  doc.setFillColor(250, 248, 255);
  doc.roundedRect(qrX - 5, y - 5, qrMm + 10, qrMm + 10, 5, 5, "F");
  doc.addImage(png, "PNG", qrX, y, qrMm, qrMm, undefined, "FAST");
  y += qrMm + 12;

  const hint = renderUnicodeTextPng("Kamerani QR-kodga qarating", {
    fontSizePx: 11,
    color: MUTED,
    maxWidthMm: contentW,
    align: "center",
  });
  y = placeText(doc, hint, cx, y) + 8;

  const plateW = contentW;
  const plateH = 26;
  const plateX = MARGIN;
  if (y + plateH > PAGE_H - 16) y = PAGE_H - 16 - plateH;
  doc.setFillColor(...PURPLE_RGB);
  doc.roundedRect(plateX, y, plateW, plateH, 3.5, 3.5, "F");
  doc.setFillColor(...YELLOW_RGB);
  doc.rect(plateX, y, 3.2, plateH, "F");

  const branchLine =
    item.branchNo != null && item.branchNo > 0
      ? `№${item.branchNo}  ·  ${item.branchLabel}`
      : item.branchLabel;

  const branchTitle = renderUnicodeTextPng(branchLine, {
    fontSizePx: 15,
    fontWeight: "bold",
    color: "#ffffff",
    maxWidthMm: plateW - 16,
    align: "center",
  });
  placeText(doc, branchTitle, cx, y + (plateH - branchTitle.heightMm) / 2);
}

export async function downloadBahoQrPdf(item: BahoQrPage) {
  if (!item.publicUrl?.trim()) throw new Error("QR havola yo‘q");
  const png = await styledQrPng(item.publicUrl, 1100);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await drawBahoQrPage(doc, png, item);
  downloadBlob(doc.output("blob"), `${safeFileBase(`baho-${item.branchLabel}`)}.pdf`);
}

export async function downloadAllBahoQrPdf(items: BahoQrPage[]) {
  const list = items.filter((it) => it.publicUrl?.trim());
  if (!list.length) throw new Error("Yuklash uchun faol QR yo‘q");

  const pngs = await Promise.all(
    list.map(async (it) => ({
      item: it,
      png: await styledQrPng(it.publicUrl, 1100),
    })),
  );

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  for (let idx = 0; idx < pngs.length; idx++) {
    if (idx > 0) doc.addPage();
    const row = pngs[idx];
    await drawBahoQrPage(doc, row.png, row.item, `Mijoz baholash QR · ${idx + 1} / ${pngs.length}`);
  }
  downloadBlob(doc.output("blob"), "baho-qr-barcha-filiallar.pdf");
}

/** Preview PNG (modal) */
export async function bahoQrPreviewPng(url: string): Promise<string> {
  return styledQrPng(url, 720);
}
