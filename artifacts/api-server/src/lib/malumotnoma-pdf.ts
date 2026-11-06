import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFont } from "./discipline-pdf";
import { displayBranchName } from "./geo-location";
import { fmtMalumotnomaDate, type MalumotnomaRow } from "./malumotnoma";

const W = 595.28;
const H = 841.89;
const ML = 48;
const MR = 48;

const INK = rgb(0.09, 0.07, 0.13);
const MUTED = rgb(0.4, 0.38, 0.46);
const FAINT = rgb(0.55, 0.53, 0.6);
const PURPLE = rgb(0.478, 0.243, 0.596);
const GOLD = rgb(1, 0.8, 0);
const HAIR = rgb(0.86, 0.84, 0.9);
const CARD = rgb(0.975, 0.97, 0.99);
const CARD_LINE = rgb(0.82, 0.78, 0.9);

type Fonts = { regular: PDFFont; bold: PDFFont };
type Seg = { text: string; bold?: boolean };

function dataUrlBytes(dataUrl: string | null): Uint8Array | null {
  const m = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ""));
  return m ? Uint8Array.from(Buffer.from(m[2]!, "base64")) : null;
}

async function loadLogoBytes(): Promise<Uint8Array | null> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "assets", "vaksina-med-logo.png"),
    path.join(here, "..", "assets", "vaksina-med-logo.png"),
    path.join(here, "..", "..", "assets", "vaksina-med-logo.png"),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "vaksina-med-logo.png"),
    path.join(process.cwd(), "artifacts", "api-server", "dist", "assets", "vaksina-med-logo.png"),
    path.join(process.cwd(), "assets", "vaksina-med-logo.png"),
    path.join(process.cwd(), "dist", "assets", "vaksina-med-logo.png"),
    "/opt/hr_ai/artifacts/api-server/assets/vaksina-med-logo.png",
    "/opt/hr_ai/artifacts/api-server/dist/assets/vaksina-med-logo.png",
  ];
  for (const p of candidates) {
    try {
      return new Uint8Array(await fs.readFile(p));
    } catch {
      /* next */
    }
  }
  return null;
}

function cleanBranch(raw: string): string {
  const name = displayBranchName(raw).trim();
  if (!name || name === "—") return "asosiy ofis";
  return name;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) <= width) cur = trial;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawCentered(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color = INK) {
  const tw = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (W - tw) / 2, y, size, font, color });
}

/** Rich paragraph: segments can be bold; wraps across fonts. Returns height used. */
function richParagraph(
  page: PDFPage,
  segs: Seg[],
  fonts: Fonts,
  size: number,
  y: number,
  opts: { leading: number; indent?: number; width?: number; x?: number; color?: typeof INK },
): number {
  const x0 = opts.x ?? ML;
  const width = opts.width ?? W - ML - MR;
  const indent = opts.indent ?? 0;
  const color = opts.color ?? INK;

  type Tok = { text: string; bold: boolean };
  const tokens: Tok[] = [];
  for (const s of segs) {
    const parts = s.text.split(/(\s+)/).filter((p) => p.length > 0);
    for (const p of parts) tokens.push({ text: p, bold: !!s.bold });
  }

  const lines: Tok[][] = [];
  let cur: Tok[] = [];
  let curW = 0;
  let firstLine = true;

  const lineMax = () => width - (firstLine ? indent : 0);

  for (const tok of tokens) {
    const font = tok.bold ? fonts.bold : fonts.regular;
    const tw = font.widthOfTextAtSize(tok.text, size);
    if (cur.length && curW + tw > lineMax() && !/^\s+$/.test(tok.text)) {
      lines.push(cur);
      cur = [];
      curW = 0;
      firstLine = false;
    }
    if (!cur.length && /^\s+$/.test(tok.text)) continue;
    cur.push(tok);
    curW += tw;
  }
  if (cur.length) lines.push(cur);

  lines.forEach((line, i) => {
    let x = x0 + (i === 0 ? indent : 0);
    const ly = y - i * opts.leading;
    for (const tok of line) {
      const font = tok.bold ? fonts.bold : fonts.regular;
      page.drawText(tok.text, { x, y: ly, size, font, color });
      x += font.widthOfTextAtSize(tok.text, size);
    }
  });
  return lines.length * opts.leading;
}

function centeredWrapped(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  y: number,
  width: number,
  leading: number,
  color: typeof INK,
): number {
  const lines = wrap(text, font, size, width);
  lines.forEach((line, i) => {
    const tw = font.widthOfTextAtSize(line, size);
    page.drawText(line, { x: (W - tw) / 2, y: y - i * leading, size, font, color });
  });
  return lines.length * leading;
}

export async function renderMalumotnomaPdf(row: MalumotnomaRow, verifyUrl: string | null): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts: Fonts = {
    regular: await doc.embedFont(await readFont("DejaVuSans.ttf"), { subset: true }),
    bold: await doc.embedFont(await readFont("DejaVuSans-Bold.ttf"), { subset: true }),
  };
  const page = doc.addPage([W, H]);

  // Chegara chiziqlari
  page.drawRectangle({ x: 0, y: H - 7, width: W, height: 7, color: PURPLE });
  page.drawRectangle({ x: 0, y: H - 11, width: W, height: 4, color: GOLD });
  page.drawRectangle({ x: 0, y: 0, width: W, height: 7, color: PURPLE });
  page.drawRectangle({ x: 0, y: 7, width: W, height: 3, color: GOLD });

  // ——— HEADER: logo + QR ———
  let y = H - 28;
  const qrSize = 72;
  const qrBox = qrSize + 16;
  const qrX = W - MR - qrBox;
  let qrDrawn = false;

  const qrBytes = dataUrlBytes(row.qrPng);
  if (qrBytes) {
    try {
      const qr = await doc.embedPng(qrBytes);
      const boxTop = y + 4;
      const boxY = boxTop - qrBox;
      page.drawRectangle({
        x: qrX,
        y: boxY,
        width: qrBox,
        height: qrBox,
        color: CARD,
        borderColor: CARD_LINE,
        borderWidth: 1,
      });
      page.drawImage(qr, {
        x: qrX + 8,
        y: boxY + 14,
        width: qrSize,
        height: qrSize,
      });
      const tip = "Haqiqiylik QR";
      const tw = fonts.regular.widthOfTextAtSize(tip, 6.5);
      page.drawText(tip, {
        x: qrX + (qrBox - tw) / 2,
        y: boxY + 4,
        size: 6.5,
        font: fonts.regular,
        color: PURPLE,
      });
      qrDrawn = true;
    } catch {
      qrDrawn = false;
    }
  }

  const logoBytes = await loadLogoBytes();
  let logoBottom = y;
  if (logoBytes) {
    try {
      const logo = await doc.embedPng(logoBytes);
      const maxW = 200;
      const maxH = 52;
      const scale = Math.min(maxW / logo.width, maxH / logo.height);
      const lw = logo.width * scale;
      const lh = logo.height * scale;
      page.drawImage(logo, { x: (W - lw) / 2, y: y - lh, width: lw, height: lh });
      logoBottom = y - lh;
    } catch {
      drawCentered(page, "VAKSINA MED", fonts.bold, 20, y - 16, PURPLE);
      logoBottom = y - 28;
    }
  } else {
    const label = "VAKSINA MED";
    const fullW = fonts.bold.widthOfTextAtSize(label, 20);
    const vaksina = "VAKSINA ";
    const vw = fonts.bold.widthOfTextAtSize(vaksina, 20);
    const x0 = (W - fullW) / 2;
    page.drawText(vaksina, { x: x0, y: y - 16, size: 20, font: fonts.bold, color: PURPLE });
    page.drawText("MED", { x: x0 + vw, y: y - 16, size: 20, font: fonts.bold, color: GOLD });
    logoBottom = y - 28;
  }

  y = Math.min(logoBottom, qrDrawn ? H - 28 - qrBox : logoBottom) - 14;

  // Shapka — faqat kompaniya (direktor qatori yo‘q)
  drawCentered(page, row.companyName, fonts.bold, 13, y, INK);
  y -= 12;
  page.drawLine({
    start: { x: ML + 70, y },
    end: { x: W - MR - 70, y },
    thickness: 0.9,
    color: HAIR,
  });
  y -= 26;

  // Sarlavha
  drawCentered(page, "MA’LUMOTNOMA", fonts.bold, 24, y, PURPLE);
  y -= 9;
  page.drawLine({
    start: { x: W / 2 - 56, y },
    end: { x: W / 2 + 56, y },
    thickness: 2.4,
    color: GOLD,
  });
  y -= 20;

  const issued = fmtMalumotnomaDate(row.issuedAt);
  page.drawText(`Hujjat №  ${row.docNo}`, { x: ML, y, size: 9, font: fonts.bold, color: MUTED });
  const dateLabel = `Berilgan: ${issued}`;
  const dw = fonts.regular.widthOfTextAtSize(dateLabel, 9);
  page.drawText(dateLabel, { x: W - MR - dw, y, size: 9, font: fonts.regular, color: MUTED });
  y -= 10;
  page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.6, color: HAIR });
  y -= 24;

  const bodyWidth = W - ML - MR;
  const name = row.fullName;
  const company = row.companyName;
  const branch = cleanBranch(row.branch);
  const position = row.position || "xodim";
  const shift = row.shiftLabel || "belgilangan ish grafigi";
  const timeRange =
    row.workStart && row.workEnd
      ? `${row.workStart} dan ${row.workEnd} gacha`
      : "belgilangan ish vaqti bo‘yicha";

  // Universal, keng matn — ism va ish vaqti qalin
  const bodySize = 11.6;
  const leading = 18.2;
  let textY = y;

  textY -= richParagraph(
    page,
    [
      { text: "Mazkur ma’lumotnoma " },
      { text: name, bold: true },
      {
        text:
          `ga shuni tasdiqlaydi-ki, u ${company} tashkilotida ${branch} filiali / bo‘linmasida ` +
          `${position} lavozimida mehnat faoliyatini olib bormoqda. Ushbu hujjat xodimning ` +
          `mehnat munosabatlari haqida rasmiy tasdiqnoma bo‘lib, bank, davlat organlari, ` +
          `ta’lim muassasalari va boshqa manfaatdor tashkilotlarga taqdim etish uchun mo‘ljallangan.`,
      },
    ],
    fonts,
    bodySize,
    textY,
    { leading, indent: 22, width: bodyWidth },
  );
  textY -= 16;

  textY -= richParagraph(
    page,
    [
      { text: `Xodimning ish grafigi: ${shift}. Ish vaqtining boshlanishi va tugashi: ` },
      { text: timeRange, bold: true },
      { text: "." },
    ],
    fonts,
    bodySize,
    textY,
    { leading, indent: 22, width: bodyWidth },
  );

  // Tafsilotlar kartasi
  textY -= 26;
  const cardH = 92;
  const cardY = textY - cardH;
  page.drawRectangle({
    x: ML,
    y: cardY,
    width: bodyWidth,
    height: cardH,
    color: CARD,
    borderColor: CARD_LINE,
    borderWidth: 1,
  });
  page.drawRectangle({ x: ML, y: cardY, width: 3.5, height: cardH, color: PURPLE });

  const facts: Array<[string, string]> = [
    ["Xodim", name],
    ["Kompaniya", company],
    ["Filial / joy", branch],
    ["Lavozim", position],
    ["Smena", shift],
    ["Ish vaqti", `${row.workStart || "—"} – ${row.workEnd || "—"}`],
  ];
  const colW = bodyWidth / 2;
  facts.forEach(([k, v], i) => {
    const col = i % 2;
    const rowi = Math.floor(i / 2);
    const fx = ML + 16 + col * colW;
    const fy = textY - 18 - rowi * 28;
    page.drawText(k.toLocaleUpperCase("uz"), { x: fx, y: fy, size: 7, font: fonts.regular, color: MUTED });
    const val = v.length > 40 ? `${v.slice(0, 38)}…` : v;
    page.drawText(val, { x: fx, y: fy - 13, size: 10.5, font: fonts.bold, color: INK });
  });

  // Imzo zonasi — chap: lavozim/kompaniya, o‘ng: ism o‘ng burchakka
  const half = (bodyWidth - 40) / 2;
  const footY = Math.max(88, Math.min(cardY - 36, 160));

  page.drawText(row.directorTitle, { x: ML, y: footY + 40, size: 9.5, font: fonts.bold, color: INK });
  page.drawText(row.companyName.replace(/[«»]/g, "").slice(0, 36), {
    x: ML,
    y: footY + 26,
    size: 8,
    font: fonts.regular,
    color: MUTED,
  });
  page.drawLine({
    start: { x: ML, y: footY + 10 },
    end: { x: ML + half - 10, y: footY + 10 },
    thickness: 0.8,
    color: HAIR,
  });

  const nameW = fonts.bold.widthOfTextAtSize(row.directorName, 11.5);
  const nameX = W - MR - nameW;
  page.drawText(row.directorName, {
    x: nameX,
    y: footY + 26,
    size: 11.5,
    font: fonts.bold,
    color: INK,
  });
  page.drawLine({
    start: { x: W - MR - half + 10, y: footY + 10 },
    end: { x: W - MR, y: footY + 10 },
    thickness: 0.8,
    color: HAIR,
  });

  // Pastki yopuvchi matn — kichik, hira, markazda
  const closing =
    "Ushbu ma’lumotnoma talab qilingan joyga taqdim etish uchun berildi. " +
    "Hujjatning haqiqiyligini yuqoridagi QR kod orqali VAKSINA HR platformasida tekshirish mumkin.";
  const closeY = 56;
  centeredWrapped(page, closing, fonts.regular, 8, closeY, bodyWidth - 20, 11.5, FAINT);

  page.drawText("VAKSINA HR · Rasmiy hujjat", {
    x: ML,
    y: 20,
    size: 7,
    font: fonts.regular,
    color: FAINT,
  });
  if (verifyUrl) {
    const short = verifyUrl.length > 52 ? `${verifyUrl.slice(0, 49)}…` : verifyUrl;
    const vw = fonts.regular.widthOfTextAtSize(short, 6.2);
    page.drawText(short, { x: W - MR - vw, y: 20, size: 6.2, font: fonts.regular, color: FAINT });
  }

  return Buffer.from(await doc.save());
}
