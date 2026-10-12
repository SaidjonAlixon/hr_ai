import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFont } from "./discipline-pdf";

const PAGE_W = 841.89;
const PAGE_H = 595.28;
const M = 28;
const BOTTOM = 34;
const NAVY = rgb(0.043, 0.227, 0.361);
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.886, 0.91, 0.941);
const ZEBRA = rgb(0.973, 0.98, 0.988);
const RED = rgb(0.75, 0.1, 0.12);
const GREEN = rgb(0.02, 0.45, 0.25);
const WHITE = rgb(1, 1, 1);

export type DigestPdfRow = {
  title: string;
  person: string;
  time: string;
  state: string;
  bad?: boolean;
  isPrivate?: boolean;
};

export type DigestPdfSection = {
  title: string;
  personHead: string;
  timeHead: string;
  stateHead: string;
  tone: { bg: RGB; fg: RGB };
  rows: DigestPdfRow[];
};

export const SECTION_TONES = {
  doing: { bg: rgb(0.86, 0.93, 1), fg: rgb(0.05, 0.3, 0.6) },
  todo: { bg: rgb(1, 0.95, 0.85), fg: rgb(0.6, 0.35, 0.02) },
  approve: { bg: rgb(0.86, 0.97, 0.9), fg: rgb(0.02, 0.4, 0.2) },
  review: { bg: rgb(0.94, 0.91, 1), fg: rgb(0.38, 0.2, 0.65) },
};

const COLS = [
  { key: "n", w: 26 },
  { key: "title", w: 370 },
  { key: "person", w: 150 },
  { key: "time", w: 105 },
  { key: "state", w: 135 },
] as const;

function fit(text: string, font: PDFFont, size: number, max: number): string {
  const t = String(text || "").replace(/\s+/g, " ").trim() || "—";
  if (font.widthOfTextAtSize(t, size) <= max) return t;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > max) s = s.slice(0, -1);
  return `${s}…`;
}

function wrap(text: string, font: PDFFont, size: number, max: number, lines = 2): string[] {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= max) cur = next;
    else {
      if (cur) out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const rest = out.slice(lines - 1).join(" ");
    return [...out.slice(0, lines - 1), fit(rest, font, size, max)];
  }
  return out.length ? out.map((l) => fit(l, font, size, max)) : ["—"];
}

/** Sarlavhadagi emoji va boshqa shriftda yo‘q belgilarni olib tashlaydi */
function clean(s: string): string {
  return String(s || "").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").trim();
}

export async function renderTaskDigestPdf(input: {
  heading: string;
  subtitle: string;
  summary: Array<{ label: string; value: string; fg: RGB }>;
  sections: DigestPdfSection[];
  note: string;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFont("DejaVuSans.ttf"), { subset: true });
  const bold = await doc.embedFont(await readFont("DejaVuSans-Bold.ttf"), { subset: true });
  const width = PAGE_W - M * 2;
  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;
  let pageNo = 1;

  const footer = () => {
    const t = `${clean(input.heading)} · ${pageNo}-varaq`;
    page.drawText(fit(t, font, 7.5, width), { x: M, y: 16, size: 7.5, font, color: MUTED });
  };
  const newPage = () => {
    footer();
    page = doc.addPage([PAGE_W, PAGE_H]);
    pageNo += 1;
    y = PAGE_H - M;
  };

  page.drawRectangle({ x: 0, y: PAGE_H - 70, width: PAGE_W, height: 70, color: NAVY });
  page.drawText(fit(clean(input.heading), bold, 17, width), { x: M, y: PAGE_H - 34, size: 17, font: bold, color: WHITE });
  page.drawText(fit(clean(input.subtitle), font, 9.5, width), { x: M, y: PAGE_H - 54, size: 9.5, font, color: rgb(0.85, 0.9, 0.97) });
  y = PAGE_H - 84;

  if (input.summary.length) {
    const cw = (width - (input.summary.length - 1) * 8) / input.summary.length;
    input.summary.forEach((c, i) => {
      const x = M + i * (cw + 8);
      page.drawRectangle({ x, y: y - 44, width: cw, height: 44, color: ZEBRA, borderColor: LINE, borderWidth: 1 });
      page.drawText(fit(c.label, font, 8, cw - 16), { x: x + 8, y: y - 14, size: 8, font, color: MUTED });
      page.drawText(fit(c.value, bold, 15, cw - 16), { x: x + 8, y: y - 35, size: 15, font: bold, color: c.fg });
    });
    y -= 56;
  }

  for (const s of input.sections) {
    if (!s.rows.length) continue;
    if (y - 60 < BOTTOM) newPage();
    page.drawRectangle({ x: M, y: y - 22, width, height: 22, color: s.tone.bg });
    page.drawText(fit(`${clean(s.title)} — ${s.rows.length} ta`, bold, 11, width - 16), { x: M + 8, y: y - 15, size: 11, font: bold, color: s.tone.fg });
    y -= 22;

    const head = () => {
      page.drawRectangle({ x: M, y: y - 16, width, height: 16, color: rgb(0.945, 0.957, 0.973) });
      const heads = ["№", "Topshiriq", s.personHead, s.timeHead, s.stateHead];
      let x = M;
      COLS.forEach((c, i) => {
        page.drawText(fit(heads[i]!, bold, 7.5, c.w - 8), { x: x + 4, y: y - 11, size: 7.5, font: bold, color: MUTED });
        x += c.w;
      });
      y -= 16;
    };
    head();

    s.rows.forEach((r, idx) => {
      const titleLines = wrap(`${r.isPrivate ? "[Maxfiy] " : ""}${r.title}`, font, 8.5, COLS[1].w - 8);
      const h = 8 + titleLines.length * 11;
      if (y - h < BOTTOM) {
        newPage();
        head();
      }
      if (idx % 2 === 1) page.drawRectangle({ x: M, y: y - h, width, height: h, color: ZEBRA });
      page.drawLine({ start: { x: M, y: y - h }, end: { x: M + width, y: y - h }, thickness: 0.5, color: LINE });
      let x = M;
      const top = y - 11;
      page.drawText(String(idx + 1), { x: x + 4, y: top, size: 8.5, font, color: MUTED });
      x += COLS[0].w;
      titleLines.forEach((l, i) => page.drawText(l, { x: x + 4, y: top - i * 11, size: 8.5, font: i === 0 ? bold : font, color: INK }));
      x += COLS[1].w;
      page.drawText(fit(r.person, font, 8.5, COLS[2].w - 8), { x: x + 4, y: top, size: 8.5, font, color: INK });
      x += COLS[2].w;
      page.drawText(fit(r.time, font, 8.5, COLS[3].w - 8), { x: x + 4, y: top, size: 8.5, font, color: INK });
      x += COLS[3].w;
      page.drawText(fit(r.state, bold, 8.5, COLS[4].w - 8), { x: x + 4, y: top, size: 8.5, font: bold, color: r.bad ? RED : GREEN });
      y -= h;
    });
    y -= 12;
  }

  if (input.note) {
    const lines = input.note.split("\n").flatMap((l) => wrap(clean(l), font, 8.5, width - 16, 4));
    const h = 12 + lines.length * 11;
    if (y - h < BOTTOM) newPage();
    page.drawRectangle({ x: M, y: y - h, width, height: h, color: rgb(1, 0.98, 0.9), borderColor: rgb(0.98, 0.85, 0.5), borderWidth: 1 });
    lines.forEach((l, i) => page.drawText(l, { x: M + 8, y: y - 14 - i * 11, size: 8.5, font, color: INK }));
    y -= h;
  }
  footer();
  return Buffer.from(await doc.save());
}
