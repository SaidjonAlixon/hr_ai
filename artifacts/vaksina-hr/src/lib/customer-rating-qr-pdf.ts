/**
 * Mijoz baholash QR — A4 portrait (kassa oldi).
 * Yuqori: Vaksina logo · CTA banner · Markaz: solid premium QR · Past: filial.
 * Markazda logo YO‘Q. Logo fayli o‘zgartirilmaydi.
 */
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { toUzbekLatinUpper } from "@/lib/script-search";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;

/** Brend (vaksinahr_logo) */
const PURPLE = "#5c2d91";
const PURPLE_DEEP = "#4a1f78";
const PURPLE_RGB: [number, number, number] = [92, 45, 145];
const YELLOW = "#f5c518";
const YELLOW_RGB: [number, number, number] = [245, 197, 24];
const MUTED = "#5b6478";
const LOGO_URL = "/logo_vaksina.png";

/** Logo VAKSINA MED bilan bir xil — Montserrat ExtraBold */
const UNICODE_FONT =
  '"Montserrat", "Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

async function ensureBrandFont(): Promise<void> {
  try {
    if (typeof document !== "undefined" && document.fonts?.load) {
      await Promise.all([
        document.fonts.load("800 48px Montserrat"),
        document.fonts.load("700 32px Montserrat"),
        document.fonts.load("600 24px Montserrat"),
      ]);
      await document.fonts.ready;
    }
  } catch {
    /* offline — Segoe UI fallback */
  }
}

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

let logoCache: HTMLImageElement | null = null;

/** Aynan logo_vaksina.png — rasmga tegilmaydi */
async function loadHeaderLogo(): Promise<HTMLImageElement> {
  if (logoCache) return logoCache;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Logo yuklanmadi"));
    el.src = LOGO_URL;
  });
  logoCache = img;
  return img;
}

function isFinderCell(row: number, col: number, n: number): boolean {
  const inTL = row < 7 && col < 7;
  const inTR = row < 7 && col >= n - 7;
  const inBL = row >= n - 7 && col < 7;
  return inTL || inTR || inBL;
}

/**
 * Premium solid QR — klassik modul (skaner uchun ishonchli),
 * yumshoq burchakli binafsha kvadratlar, sariq/cyan dekor YO‘Q.
 */
async function styledQrPng(url: string, size = 1000): Promise<string> {
  const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
  const modules = qr.modules;
  const n = modules.size;

  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas ishlamaydi");

  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 0, 0, size, size, size * 0.04);
  ctx.fill();

  // Yupqa binafsha ramka
  ctx.strokeStyle = "rgba(92,45,145,0.22)";
  ctx.lineWidth = Math.max(2, size * 0.008);
  roundRect(ctx, size * 0.018, size * 0.018, size * 0.964, size * 0.964, size * 0.032);
  ctx.stroke();

  const margin = size * 0.08;
  const grid = size - margin * 2;
  const cell = grid / n;
  const gap = cell * 0.08;
  const moduleR = cell * 0.18;

  const drawFinder = (originRow: number, originCol: number) => {
    const x = margin + originCol * cell;
    const y = margin + originRow * cell;
    const s = cell * 7;
    const rOuter = cell * 0.55;

    roundRect(ctx, x, y, s, s, rOuter);
    ctx.fillStyle = PURPLE;
    ctx.fill();

    roundRect(ctx, x + cell, y + cell, cell * 5, cell * 5, rOuter * 0.7);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    roundRect(ctx, x + cell * 2, y + cell * 2, cell * 3, cell * 3, rOuter * 0.45);
    ctx.fillStyle = PURPLE;
    ctx.fill();
  };

  drawFinder(0, 0);
  drawFinder(0, n - 7);
  drawFinder(n - 7, 0);

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!modules.get(row, col)) continue;
      if (isFinderCell(row, col, n)) continue;

      const x = margin + col * cell + gap / 2;
      const y = margin + row * cell + gap / 2;
      const s = cell - gap;
      roundRect(ctx, x, y, s, s, moduleR);
      ctx.fillStyle = PURPLE;
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

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  color: string,
) {
  const spikes = 5;
  const innerR = outerR * 0.42;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function measureSpacedWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  spacing: number,
): number {
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + spacing;
  return Math.max(0, total - spacing);
}

function fillSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  spacing: number,
) {
  const total = measureSpacedWidth(ctx, text, spacing);
  let x = centerX - total / 2;
  for (const ch of text) {
    const cw = ctx.measureText(ch).width;
    ctx.fillText(ch, x + cw / 2, y);
    x += cw + spacing;
  }
}

/**
 * Logo ostidagi CTA — pill + motto + 5 yulduz.
 * Balandlik kontentdan hisoblanadi; elementlar bir-biriga tegmaydi.
 */
function renderWelcomeBannerPng(widthMm: number): TextBlock {
  const dpr = 3;
  const w = Math.round((widthMm / 25.4) * 96 * dpr);

  // —— Layout o‘lchamlari (px @ dpr) — oraliqlar aniq
  const padTop = Math.round(6 * dpr);
  const padBottom = Math.round(10 * dpr);
  const gapPillMotto = Math.round(14 * dpr);
  const gapMottoStars = Math.round(12 * dpr);

  const pillH = Math.round(38 * dpr);
  const titleSize = Math.round(15.5 * dpr);
  const titleSpacing = titleSize * 0.07;

  const mottoSize = Math.round(11.5 * dpr);
  const mottoSpacing = mottoSize * 0.16;

  const starPillH = Math.round(28 * dpr);
  const starR = Math.round(starPillH * 0.32);
  const starGap = Math.round(starR * 0.85);
  const starPadX = Math.round(starR * 1.25);
  const starCount = 5;
  const starPillW =
    starCount * (starR * 2) + (starCount - 1) * starGap + starPadX * 2;

  const h =
    padTop +
    pillH +
    gapPillMotto +
    mottoSize +
    gapMottoStars +
    starPillH +
    padBottom;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return renderUnicodeTextPng("XIZMATNI BAHOLANG", {
      fontSizePx: 24,
      fontWeight: "800",
      color: PURPLE,
      maxWidthMm: widthMm,
      align: "center",
      letterSpacingPx: 2,
    });
  }

  // Sof fon — elementlar ajralib tursin
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "rgba(245, 240, 255, 0)");
  bg.addColorStop(0.5, "rgba(245, 240, 255, 0.4)");
  bg.addColorStop(1, "rgba(255, 252, 245, 0.25)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // —— 1) Purple pill
  const title = "XIZMATNI BAHOLANG";
  ctx.font = `800 ${titleSize}px ${UNICODE_FONT}`;
  const titleW = measureSpacedWidth(ctx, title, titleSpacing);
  const pillPadX = titleSize * 1.35;
  const pillW = Math.min(w * 0.72, titleW + pillPadX * 2);
  const pillX = (w - pillW) / 2;
  const pillY = padTop;
  const pillR = pillH / 2;

  ctx.save();
  ctx.shadowColor = "rgba(74, 31, 120, 0.22)";
  ctx.shadowBlur = 14 * dpr;
  ctx.shadowOffsetY = 5 * dpr;
  const grad = ctx.createLinearGradient(pillX, pillY, pillX, pillY + pillH);
  grad.addColorStop(0, "#7a45b8");
  grad.addColorStop(0.5, PURPLE);
  grad.addColorStop(1, PURPLE_DEEP);
  roundRect(ctx, pillX, pillY, pillW, pillH, pillR);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, pillX + 3 * dpr, pillY + 2.5 * dpr, pillW - 6 * dpr, pillH * 0.32, pillR * 0.4);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fill();
  ctx.restore();

  ctx.font = `800 ${titleSize}px ${UNICODE_FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fillSpacedText(ctx, title, w / 2, pillY + pillH / 2 + 0.5 * dpr, titleSpacing);

  // —— 2) Motto (pill ostida, alohida)
  const motto = "SIZNING FIKRINGIZ BIZ UCHUN MUHIM!";
  const mottoY = pillY + pillH + gapPillMotto + mottoSize / 2;
  ctx.font = `700 ${mottoSize}px ${UNICODE_FONT}`;
  ctx.fillStyle = PURPLE_DEEP;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fillSpacedText(ctx, motto, w / 2, mottoY, mottoSpacing);

  // —— 3) Yulduzlar (motto ostida, alohida)
  const starPillX = (w - starPillW) / 2;
  const starPillY = mottoY + mottoSize / 2 + gapMottoStars;

  ctx.save();
  ctx.shadowColor = "rgba(92, 45, 145, 0.1)";
  ctx.shadowBlur = 10 * dpr;
  ctx.shadowOffsetY = 3 * dpr;
  roundRect(ctx, starPillX, starPillY, starPillW, starPillH, starPillH / 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
  roundRect(ctx, starPillX, starPillY, starPillW, starPillH, starPillH / 2);
  ctx.strokeStyle = "rgba(92, 45, 145, 0.14)";
  ctx.lineWidth = 1.2 * dpr;
  ctx.stroke();

  const starsCy = starPillY + starPillH / 2;
  for (let i = 0; i < starCount; i++) {
    const sx = starPillX + starPadX + starR + i * (starR * 2 + starGap);
    drawStar(ctx, sx, starsCy, starR, YELLOW);
  }

  return {
    dataUrl: canvas.toDataURL("image/png"),
    widthMm,
    heightMm: (h / dpr / 96) * 25.4,
  };
}

export type BahoQrPage = {
  branchLabel: string;
  publicUrl: string;
  branchNo?: number | null;
};

async function drawBahoQrPage(doc: jsPDF, png: string, item: BahoQrPage) {
  await ensureBrandFont();
  drawPageDecor(doc);
  const cx = PAGE_W / 2;
  const contentW = PAGE_W - MARGIN * 2;

  /** Pastki lenta — A4 pastiga mahkam (footer ustida) */
  const plateH = 13;
  const plateBottomGap = 11;
  const plateY = PAGE_H - plateBottomGap - plateH;
  const plateW = contentW;
  const plateX = MARGIN;

  const branchLatin =
    toUzbekLatinUpper(String(item.branchLabel || "").trim()) || "FILIAL";
  const branchTitle = renderUnicodeTextPng(branchLatin, {
    fontSizePx: 13,
    fontWeight: "800",
    color: "#ffffff",
    maxWidthMm: plateW - 12,
    align: "center",
  });

  const hint = renderUnicodeTextPng("Kamerani QR-kodga qarating — 5 soniyada baholaysiz", {
    fontSizePx: 11,
    fontWeight: "bold",
    color: PURPLE,
    maxWidthMm: contentW,
    align: "center",
  });

  /** Yuqori blok — har bir qatlam alohida nafas oladi */
  let y = 11;

  try {
    const logo = await loadHeaderLogo();
    const maxW = 142;
    const maxH = 38;
    const iw = logo.naturalWidth || logo.width;
    const ih = logo.naturalHeight || logo.height;
    const scale = Math.min(maxW / iw, maxH / ih);
    const wMm = iw * scale;
    const hMm = ih * scale;
    doc.addImage(logo, "PNG", cx - wMm / 2, y, wMm, hMm);
    y += hMm + 4;
  } catch {
    const brand = renderUnicodeTextPng("VAKSINA MED", {
      fontSizePx: 15,
      fontWeight: "800",
      color: PURPLE,
      maxWidthMm: contentW,
      align: "center",
      letterSpacingPx: 2.5,
    });
    y = placeText(doc, brand, cx, y) + 4;
  }

  const banner = renderWelcomeBannerPng(contentW * 0.86);
  y = placeText(doc, banner, cx, y) + 4;

  const thanks = renderUnicodeTextPng("Dorixonamizga tashrifingiz uchun rahmat!", {
    fontSizePx: 14,
    fontWeight: "bold",
    color: PURPLE_DEEP,
    maxWidthMm: contentW * 0.95,
    align: "center",
  });
  y = placeText(doc, thanks, cx, y) + 2.2;

  const invite = renderUnicodeTextPng("Iltimos, QR-kodni skanerlab baholang — bu biz uchun juda qadrli!", {
    fontSizePx: 11,
    color: MUTED,
    maxWidthMm: contentW * 0.9,
    align: "center",
  });
  y = placeText(doc, invite, cx, y) + 5;

  /** QR — o‘rtada, matn va pastki lentadan ajratilgan */
  const qrPad = 5;
  const gapAboveHint = 4;
  const gapAbovePlate = 5;
  const qrZoneBottom = plateY - gapAbovePlate - hint.heightMm - gapAboveHint;
  const qrZoneTop = y;
  const availForQrFrame = Math.max(70, qrZoneBottom - qrZoneTop);
  const qrMm = Math.max(88, Math.min(112, availForQrFrame - qrPad * 2));

  const frameH = qrMm + qrPad * 2;
  const qrBlockTop = qrZoneTop + Math.max(0, (availForQrFrame - frameH) / 2);
  const qrX = (PAGE_W - qrMm) / 2;
  const qrY = qrBlockTop + qrPad;

  doc.setFillColor(250, 248, 255);
  doc.roundedRect(qrX - qrPad, qrY - qrPad, qrMm + qrPad * 2, qrMm + qrPad * 2, 6, 6, "F");
  doc.setDrawColor(...PURPLE_RGB);
  doc.setLineWidth(0.35);
  doc.roundedRect(qrX - qrPad, qrY - qrPad, qrMm + qrPad * 2, qrMm + qrPad * 2, 6, 6, "S");
  doc.addImage(png, "PNG", qrX, qrY, qrMm, qrMm, undefined, "FAST");

  const hintY = qrY + qrMm + qrPad + gapAboveHint;
  placeText(doc, hint, cx, Math.min(hintY, plateY - gapAbovePlate - hint.heightMm));

  doc.setFillColor(...PURPLE_RGB);
  doc.roundedRect(plateX, plateY, plateW, plateH, 3, 3, "F");
  doc.setFillColor(...YELLOW_RGB);
  doc.rect(plateX, plateY, 2.6, plateH, "F");
  placeText(doc, branchTitle, cx, plateY + (plateH - branchTitle.heightMm) / 2);
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
    await drawBahoQrPage(doc, row.png, row.item);
  }
  downloadBlob(doc.output("blob"), "baho-qr-barcha-filiallar.pdf");
}

/** Preview PNG (modal) */
export async function bahoQrPreviewPng(url: string): Promise<string> {
  return styledQrPng(url, 720);
}
