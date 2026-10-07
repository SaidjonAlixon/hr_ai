import { PDFDocument, rgb, type Color, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFont } from "./discipline-pdf";
import type { LetterContent } from "./explanation-letter";

const W = 595.28;
const H = 841.89;
const ML = 58;
const MR = 48;
const TOP = 44;
const INK = rgb(0.05, 0.07, 0.12);
const MUTED = rgb(0.42, 0.46, 0.54);
const RULE = rgb(0.2, 0.22, 0.26);
const NAVY = rgb(0.043, 0.227, 0.361);
const HAIR = rgb(0.85, 0.87, 0.9);
const DANGER = rgb(0.68, 0.07, 0.12);
const DANGER_BG = rgb(0.995, 0.94, 0.94);

/** Bosqich ranglari: 1 — ko‘k, 2–3 — sariq, 4 — to‘q sariq, 5 — qizil, 6 — to‘q qizil */
const STAGE_COLORS: Array<[number, number, number]> = [
  [0.15, 0.39, 0.92],
  [0.85, 0.55, 0.05],
  [0.85, 0.55, 0.05],
  [0.92, 0.35, 0.05],
  [0.86, 0.15, 0.15],
  [0.6, 0.05, 0.1],
];

const stageColor = (n: number, mix = 0): Color => {
  const [r, g, b] = STAGE_COLORS[Math.min(STAGE_COLORS.length, Math.max(1, n)) - 1]!;
  return rgb(r + (1 - r) * mix, g + (1 - g) * mix, b + (1 - b) * mix);
};

type Fonts = { regular: PDFFont; bold: PDFFont };

function dataUrlBytes(dataUrl: string | null): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  return m ? Uint8Array.from(Buffer.from(m[1]!, "base64")) : null;
}

function wrap(text: string, font: PDFFont, size: number, width: number, firstIndent = 0): string[][] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[][] = [];
  let cur: string[] = [];
  let curW = 0;
  const space = font.widthOfTextAtSize(" ", size);
  for (const word of words) {
    const ww = font.widthOfTextAtSize(word, size);
    const limit = width - (lines.length === 0 ? firstIndent : 0);
    if (cur.length && curW + space + ww > limit) {
      lines.push(cur);
      cur = [word];
      curW = ww;
    } else {
      curW += (cur.length ? space : 0) + ww;
      cur.push(word);
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** Ikki tomonga tekislangan xatboshi; balandligini qaytaradi */
function paragraph(
  page: PDFPage | null,
  text: string,
  font: PDFFont,
  size: number,
  y: number,
  opts: { indent?: number; leading: number; x?: number; width?: number; color?: Color; ragged?: boolean },
): number {
  const x0 = opts.x ?? ML;
  const width = opts.width ?? W - ML - MR;
  const indent = opts.indent ?? 0;
  const color = opts.color ?? INK;
  const lines = wrap(text, font, size, width, indent);
  const space = font.widthOfTextAtSize(" ", size);
  lines.forEach((words, i) => {
    const lineY = y - i * opts.leading;
    const startX = x0 + (i === 0 ? indent : 0);
    const avail = width - (i === 0 ? indent : 0);
    const isLast = i === lines.length - 1;
    if (!page) return;
    if (isLast || words.length === 1 || opts.ragged) {
      page.drawText(words.join(" "), { x: startX, y: lineY, size, font, color });
      return;
    }
    const wordsW = words.reduce((s, w) => s + font.widthOfTextAtSize(w, size), 0);
    const gap = Math.min((avail - wordsW) / (words.length - 1), space * 6);
    let cx = startX;
    for (const w of words) {
      page.drawText(w, { x: cx, y: lineY, size, font, color });
      cx += font.widthOfTextAtSize(w, size) + gap;
    }
  });
  return lines.length * opts.leading;
}

function blankLines(page: PDFPage | null, y: number, count: number, leading: number): number {
  if (page) {
    for (let i = 0; i < count; i += 1) {
      const ly = y - i * leading - 2;
      page.drawLine({ start: { x: ML, y: ly }, end: { x: W - MR, y: ly }, thickness: 0.6, color: RULE });
    }
  }
  return count * leading;
}

/** Oxirgi xatdagi rozilik bandi — qizil ramkada */
function consentBox(page: PDFPage | null, text: string, f: Fonts, size: number, y: number): number {
  const pad = 8;
  const titleSize = size * 0.8;
  const ts = size * 0.92;
  const lead = ts * 1.4;
  const inner = W - ML - MR - pad * 2;
  const lines = wrap(text, f.bold, ts, inner).length;
  const top = y + size * 0.8;
  const titleY = top - pad - titleSize * 0.8;
  const firstY = titleY - 6 - ts;
  const bottom = firstY - (lines - 1) * lead - ts * 0.3 - pad;
  if (page) {
    page.drawRectangle({ x: ML, y: bottom, width: W - ML - MR, height: top - bottom, color: DANGER_BG, borderColor: DANGER, borderWidth: 0.9 });
    page.drawText("ISHDAN BO‘SHATISHGA ROZILIK", { x: ML + pad, y: titleY, size: titleSize, font: f.bold, color: DANGER });
    paragraph(page, text, f.bold, ts, firstY, { leading: lead, x: ML + pad, width: inner, color: DANGER });
  }
  return y - bottom + size * 0.8;
}

function body(page: PDFPage | null, c: LetterContent, f: Fonts, size: number, startY: number): number {
  const lead = size * 1.42;
  const gap = size * 0.55;
  const indent = 30;
  let y = startY;
  y -= paragraph(page, c.intro, f.regular, size, y, { indent, leading: lead }) + gap;
  y -= paragraph(page, c.facts, f.regular, size, y, { indent, leading: lead }) + gap;
  if (c.reason) y -= paragraph(page, c.reason, f.regular, size, y, { indent, leading: lead }) + gap;
  else y -= blankLines(page, y, 4, lead) + gap;
  y -= paragraph(page, c.commitment, f.regular, size, y, { indent, leading: lead }) + gap;
  if (c.finalConsent) y -= consentBox(page, c.finalConsent, f, size, y) + gap * 1.6;
  for (const line of c.closing) y -= paragraph(page, line, f.regular, size, y, { indent, leading: lead }) + gap;
  return startY - y;
}

function fitText(font: PDFFont, text: string, size: number, maxW: number): { text: string; size: number } {
  let s = size;
  while (s > 5.6 && font.widthOfTextAtSize(text, s) > maxW) s -= 0.2;
  let t = text;
  while (t.length > 3 && font.widthOfTextAtSize(t, s) > maxW) t = `${t.slice(0, -2)}…`;
  return { text: t, size: s };
}

function header(page: PDFPage, c: LetterContent, f: Fonts, qr: PDFImage | null): number {
  const x = 296;
  const right = W - MR;
  const width = right - x;
  const size = 11;
  const lead = 16.5;
  let y = H - TOP;

  page.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: c.final ? DANGER : NAVY });

  for (const line of c.addressee.slice(0, 4)) {
    const t = fitText(f.bold, line, size + 0.5, width);
    page.drawText(t.text, { x: right - f.bold.widthOfTextAtSize(t.text, t.size), y, size: t.size, font: f.bold, color: INK });
    y -= lead;
  }
  y -= 4;

  const field = (label: string, value: string, opts: { bold?: boolean; after?: string } = {}) => {
    const lw = label ? f.regular.widthOfTextAtSize(`${label} `, size) : 0;
    if (label) page.drawText(label, { x, y, size, font: f.regular, color: INK });
    const font = opts.bold ? f.bold : f.regular;
    const afterW = opts.after ? f.regular.widthOfTextAtSize(opts.after, size) : 0;
    const t = fitText(font, value, size, width - lw - afterW - 4);
    page.drawText(t.text, { x: x + lw + 2, y, size: t.size, font, color: INK });
    page.drawLine({ start: { x: x + lw, y: y - 3 }, end: { x: right - afterW, y: y - 3 }, thickness: 0.6, color: RULE });
    if (opts.after) page.drawText(opts.after, { x: right - afterW, y, size, font: f.regular, color: INK });
    y -= lead;
  };

  field("jamiyatning", c.sender.position);
  page.drawText("lavozimida faoliyat yurituvchi xodim", { x, y, size, font: f.regular, color: INK });
  y -= lead;
  field("", c.sender.branch);
  field("", c.sender.fullName, { bold: true, after: "dan" });
  field("Tel:", c.sender.phone || " ");

  const qs = 74;
  const qTop = H - TOP + 10;
  if (qr) {
    page.drawRectangle({ x: ML - 4, y: qTop - qs - 4, width: qs + 8, height: qs + 8, borderColor: HAIR, borderWidth: 0.8 });
    page.drawImage(qr, { x: ML, y: qTop - qs, width: qs, height: qs });
    page.drawText("Haqiqiyligini tekshirish", { x: ML - 4, y: qTop - qs - 16, size: 6.8, font: f.regular, color: MUTED });
    page.drawText("uchun QR kodni skanerlang", { x: ML - 4, y: qTop - qs - 25, size: 6.8, font: f.regular, color: MUTED });
  }
  const noY = qr ? qTop - qs - 42 : H - TOP;
  page.drawText("Hujjat raqami", { x: ML - (qr ? 4 : 0), y: noY, size: 6.8, font: f.regular, color: MUTED });
  page.drawText(`№ ${c.letterNo}`, { x: ML - (qr ? 4 : 0), y: noY - 11, size: 8.8, font: f.bold, color: NAVY });

  const bottom = Math.min(y + lead - 14, noY - 22);
  page.drawLine({ start: { x: ML, y: bottom }, end: { x: right, y: bottom }, thickness: 1.1, color: c.final ? DANGER : NAVY });
  page.drawLine({ start: { x: ML, y: bottom - 2.6 }, end: { x: right, y: bottom - 2.6 }, thickness: 0.4, color: c.final ? DANGER : NAVY });
  return bottom - 4;
}

const STRIP_H = 70;

/** Bosqichlar qatori + keyingi qadam; `top` — yuqori chegarasi */
function stageStrip(page: PDFPage, c: LetterContent, f: Fonts, top: number) {
  const gap = 4;
  const total = W - ML - MR;
  const n = c.stages.length;
  const bw = (total - gap * (n - 1)) / n;
  const bh = 26;
  page.drawText("INTIZOMIY CHORALAR BOSQICHLARI (joriy oy davomida)", { x: ML, y: top - 7, size: 6.8, font: f.bold, color: MUTED });
  const by = top - 12 - bh;
  c.stages.forEach((s, i) => {
    const bx = ML + i * (bw + gap);
    const cur = s.n === c.stage;
    const past = s.n < c.stage;
    const col = stageColor(s.n);
    page.drawRectangle({
      x: bx,
      y: by,
      width: bw,
      height: bh,
      color: cur ? col : past ? stageColor(s.n, 0.82) : rgb(1, 1, 1),
      borderColor: cur || past ? col : HAIR,
      borderWidth: cur ? 1.2 : 0.7,
    });
    const ink = cur ? rgb(1, 1, 1) : past ? stageColor(s.n, 0.0) : MUTED;
    const head = `${s.n}-holat${cur ? " · SIZ" : ""}`;
    const h = fitText(f.bold, head, 7.2, bw - 8);
    page.drawText(h.text, { x: bx + 4, y: by + bh - 10, size: h.size, font: f.bold, color: ink });
    const l = fitText(cur ? f.bold : f.regular, s.label, 6.6, bw - 8);
    page.drawText(l.text, { x: bx + 4, y: by + 5, size: l.size, font: cur ? f.bold : f.regular, color: ink });
  });
  const color = stageColor(Math.min(6, c.stage + 1));
  page.drawText("▶", { x: ML, y: by - 13, size: 7.4, font: f.bold, color });
  paragraph(page, c.nextStep, f.bold, 7.8, by - 13, { leading: 10, x: ML + 11, width: total - 11, color, ragged: true });
}

export async function renderExplanationLetterPdf(
  c: LetterContent,
  images: { qr: string | null; signature: string | null },
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts: Fonts = {
    regular: await doc.embedFont(await readFont("DejaVuSans.ttf"), { subset: true }),
    bold: await doc.embedFont(await readFont("DejaVuSans-Bold.ttf"), { subset: true }),
  };
  doc.setTitle(`Tushuntirish xati ${c.letterNo}`);
  doc.setAuthor(c.sender.fullName);
  doc.setSubject(c.final ? `${c.kindLabel} — oxirgi ogohlantirish` : c.kindLabel);
  doc.setProducer("VAKSINA HR");

  const qrBytes = dataUrlBytes(images.qr);
  const sigBytes = dataUrlBytes(images.signature);
  const qr = qrBytes ? await doc.embedPng(qrBytes) : null;
  const sig = sigBytes ? await doc.embedPng(sigBytes) : null;

  const page = doc.addPage([W, H]);
  let y = header(page, c, fonts, qr) - 26;

  const title = "T U SH U N T I R I SH   X A T I";
  const ts = 15;
  page.drawText(title, { x: (W - fonts.bold.widthOfTextAtSize(title, ts)) / 2, y, size: ts, font: fonts.bold, color: c.final ? DANGER : INK });
  y -= 18;
  const sub = fitText(fonts.bold, c.subtitle, 8.4, W - ML - MR - 20);
  const sw = fonts.bold.widthOfTextAtSize(sub.text, sub.size);
  if (c.final) {
    page.drawRectangle({ x: (W - sw) / 2 - 8, y: y - 4.5, width: sw + 16, height: sub.size + 8, color: DANGER });
    page.drawText(sub.text, { x: (W - sw) / 2, y, size: sub.size, font: fonts.bold, color: rgb(1, 1, 1) });
  } else {
    page.drawText(sub.text, { x: (W - sw) / 2, y, size: sub.size, font: fonts.bold, color: stageColor(c.stage) });
  }
  y -= c.final ? 19 : 16;
  const label = "Belgilangan chora: ";
  const pen = fitText(fonts.bold, c.penalty, 8.6, W - ML - MR - fonts.regular.widthOfTextAtSize(label, 8.6) - 10);
  const lw = fonts.regular.widthOfTextAtSize(label, pen.size);
  const pw = fonts.bold.widthOfTextAtSize(pen.text, pen.size);
  const px = (W - lw - pw) / 2;
  page.drawText(label, { x: px, y, size: pen.size, font: fonts.regular, color: MUTED });
  page.drawText(pen.text, { x: px + lw, y, size: pen.size, font: fonts.bold, color: c.final ? DANGER : INK });
  y -= 22;

  const lineY = 76;
  const stripTop = lineY + 48 + STRIP_H;
  const avail = y - stripTop - 6;
  let size = 12;
  for (const s of [12, 11.5, 11, 10.5, 10, 9.6, 9.2, 8.8, 8.4, 8]) {
    size = s;
    if (body(null, c, fonts, s, y) <= avail) break;
  }
  body(page, c, fonts, size, y);
  stageStrip(page, c, fonts, stripTop);

  const cols = [
    { x: ML + 6, w: 120, label: "(sana)", value: c.footer.date },
    { x: 250, w: 100, label: "(imzo)", value: "" },
    { x: 380, w: W - MR - 380, label: "(F.I.Sh.)", value: c.footer.signer },
  ];
  for (const col of cols) {
    page.drawLine({ start: { x: col.x, y: lineY }, end: { x: col.x + col.w, y: lineY }, thickness: 0.7, color: RULE });
    const lw = fonts.regular.widthOfTextAtSize(col.label, 7.5);
    page.drawText(col.label, { x: col.x + (col.w - lw) / 2, y: lineY - 11, size: 7.5, font: fonts.regular, color: MUTED });
    if (col.value) {
      const vw = fonts.regular.widthOfTextAtSize(col.value, 10.5);
      page.drawText(col.value, { x: col.x + (col.w - vw) / 2, y: lineY + 5, size: 10.5, font: fonts.regular, color: INK });
    }
  }
  if (sig) {
    const maxW = 118;
    const maxH = 44;
    const ratio = Math.min(maxW / sig.width, maxH / sig.height);
    const sw2 = sig.width * ratio;
    const sh = sig.height * ratio;
    page.drawImage(sig, { x: 250 + (100 - sw2) / 2, y: lineY - 4, width: sw2, height: sh });
  }

  const meta = c.footer.signedAt
    ? `Elektron imzolangan: ${c.footer.signedAt} (Toshkent vaqti) · Hujjat № ${c.letterNo} · VAKSINA HR platformasi`
    : `Hujjat № ${c.letterNo} · imzolanmagan nusxa · VAKSINA HR platformasi`;
  const mw = fonts.regular.widthOfTextAtSize(meta, 7);
  page.drawLine({ start: { x: ML, y: 42 }, end: { x: W - MR, y: 42 }, thickness: 0.4, color: HAIR });
  page.drawText(meta, { x: (W - mw) / 2, y: 30, size: 7, font: fonts.regular, color: MUTED });

  return Buffer.from(await doc.save());
}
