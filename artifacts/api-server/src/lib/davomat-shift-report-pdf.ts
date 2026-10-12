import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export type ReportListKind = "absent" | "late" | "present";

export type ReportPerson = {
  fullName: string;
  position: string;
  branch: string;
  list: ReportListKind;
  statusLabel: string;
  checkIn: string;
  checkOut: string;
  /** Shu oy: "2-oktabr — kelmagan" yoki "2-oktabr — kechikkan, 09:21 da kelgan" */
  monthNotes: string[];
};

export type ReportShiftBlock = {
  title: string;
  hours: string;
  people: ReportPerson[];
};

export type ReportCoordinatorSection = {
  coordinatorName: string;
  blocks: ReportShiftBlock[];
};

export type DavomatShiftPdfInput = {
  /** Masalan: 2-oktabr 2026 */
  dateLabel: string;
  /** Hisobot soati, masalan 10:00 */
  reportHm: string;
  updated: boolean;
  title?: string;
  warningText?: string;
  filterLine?: string | null;
  sections: ReportCoordinatorSection[];
  /** Faqat shu ro‘yxatlar chiziladi (bo‘sh/yo‘q — hammasi) */
  lists?: ReportListKind[];
  /** Bir nechta koordinator bo‘lsa, boshida koordinatorlar bo‘yicha qisqa jadval */
  summary?: boolean;
};

const ALL_LISTS: ReportListKind[] = ["absent", "late", "present"];

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 28;
const BOTTOM = 34;
const NAVY = rgb(0.043, 0.227, 0.361);
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.886, 0.91, 0.941);
const PAPER = rgb(1, 1, 1);
const WARN_BG = rgb(1, 0.973, 0.882);
const WARN_FG = rgb(0.573, 0.251, 0.055);

const LIST_META: Record<
  ReportListKind,
  { title: string; chip: string; bar: ReturnType<typeof rgb>; fg: ReturnType<typeof rgb> }
> = {
  absent: { title: "Kelmaganlar", chip: "Kelmagan", bar: rgb(0.996, 0.886, 0.898), fg: rgb(0.745, 0.071, 0.235) },
  late: { title: "Kechikkanlar", chip: "Kechikkan", bar: rgb(1, 0.984, 0.922), fg: rgb(0.706, 0.325, 0.035) },
  present: { title: "Kelganlar", chip: "Kelgan", bar: rgb(0.925, 0.992, 0.961), fg: rgb(0.016, 0.471, 0.341) },
};

const COLS = [
  { key: "n", label: "№", w: 24 },
  { key: "name", label: "F.I.Sh.", w: 175 },
  { key: "pos", label: "Lavozim", w: 100 },
  { key: "st", label: "Holat", w: 130 },
  { key: "in", label: "Keldi", w: 55 },
  { key: "out", label: "Ketdi", w: 55 },
] as const;

async function readFont(file: string): Promise<Buffer> {
  const candidates = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts", file),
    path.join(process.cwd(), "dist", "fonts", file),
    path.join(process.cwd(), "assets", "fonts", file),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "fonts", file),
  ];
  for (const p of candidates) {
    try {
      return await readFile(p);
    } catch {
      /* keyingi yo‘l */
    }
  }
  throw new Error(`PDF shrifti topilmadi: ${file}`);
}

function fit(text: string, font: PDFFont, size: number, max: number): string {
  const t = String(text || "").replace(/\s+/g, " ").trim() || "—";
  if (font.widthOfTextAtSize(t, size) <= max) return t;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > max) s = s.slice(0, -1);
  return `${s}…`;
}

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= max) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

type Draw = {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
  pageNo: number;
  dateLabel: string;
  reportHm: string;
  lists: ReportListKind[];
};

function listNo(d: Draw, kind: ReportListKind): string {
  return String(d.lists.indexOf(kind) + 1);
}

function newPage(d: Draw, continued: boolean) {
  d.page = d.doc.addPage([PAGE_W, PAGE_H]);
  d.pageNo += 1;
  d.y = PAGE_H - M;
  if (continued) {
    d.page.drawRectangle({ x: 0, y: PAGE_H - 22, width: PAGE_W, height: 22, color: NAVY });
    d.page.drawText(
      fit(`VAKSINA HR  ·  Davomat hisobot  ·  ${d.dateLabel}  ·  ${d.reportHm}`, d.bold, 8, PAGE_W - M * 2),
      { x: M, y: PAGE_H - 15, size: 8, font: d.bold, color: PAPER },
    );
    d.y = PAGE_H - 36;
  }
  drawFooter(d);
}

function drawFooter(d: Draw) {
  const legend = d.lists.map((k) => `${listNo(d, k)} ${LIST_META[k].title}`).join("  ·  ");
  d.page.drawText(`VAKSINA HR  ·  ${d.pageNo}-sahifa  ·  ${legend}`, {
    x: M,
    y: 16,
    size: 7.5,
    font: d.font,
    color: MUTED,
  });
}

function ensure(d: Draw, need: number) {
  if (d.y - need >= BOTTOM) return;
  newPage(d, true);
}

function drawTableHead(d: Draw) {
  ensure(d, 18);
  const y = d.y - 16;
  d.page.drawRectangle({ x: M, y, width: PAGE_W - M * 2, height: 16, color: NAVY });
  let x = M;
  for (const col of COLS) {
    d.page.drawText(col.label, {
      x: x + 3,
      y: y + 4.5,
      size: 7.5,
      font: d.bold,
      color: PAPER,
    });
    x += col.w;
  }
  d.y = y;
}

function statusColor(label: string) {
  if (label === "Kelmagan") return rgb(0.745, 0.071, 0.235);
  if (label === "Kechikkan") return rgb(0.706, 0.325, 0.035);
  if (label === "Sababli") return rgb(0.059, 0.463, 0.431);
  if (label.startsWith("Keldi, ketishi")) return rgb(0.012, 0.412, 0.631);
  if (label === "Ta’til" || label === "Tatil") return rgb(0.427, 0.157, 0.851);
  return rgb(0.016, 0.471, 0.341);
}

function monthLines(d: Draw, person: ReportPerson): string[] {
  const max = PAGE_W - M * 2 - 28;
  if (!person.monthNotes.length) {
    return wrap("Shu oyda kelmagan va kechikkan kuni yo‘q", d.font, 7.5, max);
  }
  return wrap(`Shu oyda: ${person.monthNotes.join(" · ")}`, d.font, 7.5, max);
}

function drawPerson(d: Draw, person: ReportPerson, index: number) {
  const notes = monthLines(d, person);
  const mainH = person.branch ? 24 : 16;
  const noteH = 6 + notes.length * 10;
  const rowH = mainH + noteH;
  if (d.y - rowH < BOTTOM) {
    newPage(d, true);
    drawTableHead(d);
  }
  const y = d.y - rowH;
  d.page.drawRectangle({
    x: M,
    y,
    width: PAGE_W - M * 2,
    height: rowH,
    color: index % 2 === 1 ? rgb(0.973, 0.98, 0.988) : PAPER,
  });
  const cells = [
    String(index),
    person.fullName,
    person.position || "—",
    person.statusLabel,
    person.checkIn || "—",
    person.checkOut || "—",
  ];
  let x = M;
  const textY = y + noteH + (person.branch ? 11 : 4.5);
  for (let i = 0; i < COLS.length; i++) {
    const col = COLS[i]!;
    const value = cells[i]!;
    const color = col.key === "st" ? statusColor(value) : col.key === "n" ? MUTED : INK;
    const font = col.key === "name" || col.key === "st" ? d.bold : d.font;
    const size = col.key === "st" && value.length > 14 ? 7 : 8;
    d.page.drawText(fit(value, font, size, col.w - 6), {
      x: x + 3,
      y: textY,
      size,
      font,
      color,
    });
    if (col.key === "name" && person.branch) {
      d.page.drawText(fit(person.branch, d.font, 7, col.w - 6), {
        x: x + 3,
        y: y + noteH + 3,
        size: 7,
        font: d.font,
        color: MUTED,
      });
    }
    x += col.w;
  }
  notes.forEach((line, i) => {
    d.page.drawText(line, {
      x: M + 27,
      y: y + 4 + (notes.length - 1 - i) * 10,
      size: 7.5,
      font: d.font,
      color: person.monthNotes.length ? rgb(0.29, 0.33, 0.41) : MUTED,
    });
  });
  d.page.drawLine({
    start: { x: M, y },
    end: { x: PAGE_W - M, y },
    thickness: 0.4,
    color: LINE,
  });
  d.y = y;
}

function drawList(d: Draw, kind: ReportListKind, people: ReportPerson[]) {
  const meta = LIST_META[kind];
  ensure(d, 22);
  const y = d.y - 18;
  d.page.drawRectangle({ x: M, y, width: PAGE_W - M * 2, height: 18, color: meta.bar });
  d.page.drawText(`${listNo(d, kind)}. ${meta.title}`, {
    x: M + 8,
    y: y + 5,
    size: 10,
    font: d.bold,
    color: meta.fg,
  });
  const count = `${people.length} kishi`;
  const cw = d.bold.widthOfTextAtSize(count, 9);
  d.page.drawText(count, {
    x: PAGE_W - M - 8 - cw,
    y: y + 5,
    size: 9,
    font: d.bold,
    color: meta.fg,
  });
  d.y = y - 4;
  if (!people.length) {
    ensure(d, 16);
    d.page.drawText("Bu ro‘yxatda xodim yo‘q", {
      x: M + 8,
      y: d.y - 14,
      size: 8.5,
      font: d.font,
      color: MUTED,
    });
    d.y -= 20;
    return;
  }
  drawTableHead(d);
  people.forEach((p, i) => drawPerson(d, p, i + 1));
  d.y -= 8;
}

function counts(people: ReportPerson[]) {
  return {
    absent: people.filter((p) => p.list === "absent").length,
    late: people.filter((p) => p.list === "late").length,
    present: people.filter((p) => p.list === "present").length,
  };
}

/** Koordinatorlar kesimida qisqa jadval: har biri bo‘yicha sanoq */
function drawSummary(d: Draw, sections: ReportCoordinatorSection[]) {
  const width = PAGE_W - M * 2;
  const numW = 70;
  const nameW = width - numW * (d.lists.length + 1);
  const cols = [
    { label: "Koordinator", w: nameW },
    ...d.lists.map((k) => ({ label: LIST_META[k].chip, w: numW })),
    { label: "Jami", w: numW },
  ];
  ensure(d, 40);
  d.page.drawText("Koordinatorlar bo‘yicha qisqacha", { x: M, y: d.y - 14, size: 11, font: d.bold, color: NAVY });
  d.y -= 20;
  const head = d.y - 16;
  d.page.drawRectangle({ x: M, y: head, width, height: 16, color: NAVY });
  let x = M;
  for (const c of cols) {
    d.page.drawText(c.label, { x: x + 4, y: head + 4.5, size: 8, font: d.bold, color: PAPER });
    x += c.w;
  }
  d.y = head;
  const rows = sections.map((s) => {
    const people = s.blocks.flatMap((b) => b.people);
    return { name: s.coordinatorName, c: counts(people), total: people.length };
  });
  rows.forEach((row, i) => {
    ensure(d, 16);
    const y = d.y - 15;
    d.page.drawRectangle({ x: M, y, width, height: 15, color: i % 2 ? rgb(0.973, 0.98, 0.988) : PAPER });
    let cx = M;
    d.page.drawText(fit(row.name, d.bold, 8.5, nameW - 8), { x: cx + 4, y: y + 4, size: 8.5, font: d.bold, color: INK });
    cx += nameW;
    for (const k of d.lists) {
      const v = row.c[k];
      d.page.drawText(String(v), {
        x: cx + 4,
        y: y + 4,
        size: 9,
        font: v ? d.bold : d.font,
        color: v ? LIST_META[k].fg : MUTED,
      });
      cx += numW;
    }
    d.page.drawText(String(row.total), { x: cx + 4, y: y + 4, size: 9, font: d.bold, color: INK });
    d.page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.4, color: LINE });
    d.y = y;
  });
  d.y -= 16;
}

/** Ogohlantirish: bugungi kun, keyingi vaqt, shu vaqtgacha sababli qilish. */
export function reportWarning(dateLabel: string, reportHm: string, nextWhen: string): string {
  return `Bugungi kun: ${dateLabel}. Hisobot vaqti: soat ${reportHm}. Keyingi vaqt: ${nextWhen}. Shu vaqtgacha kelmagan va kechikkan xodimlarni HR menejerlarga yozib, sababli qildiring. Aks holda bu bir kunlik jarimaga sabab bo‘ladi.`;
}

export async function renderDavomatShiftPdf(input: DavomatShiftPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFont("DejaVuSans.ttf"), { subset: true });
  const bold = await doc.embedFont(await readFont("DejaVuSans-Bold.ttf"), { subset: true });
  const d: Draw = {
    doc,
    font,
    bold,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H,
    pageNo: 1,
    dateLabel: input.dateLabel,
    reportHm: input.reportHm,
    lists: input.lists?.length ? ALL_LISTS.filter((k) => input.lists!.includes(k)) : ALL_LISTS,
  };

  d.page.drawRectangle({ x: 0, y: PAGE_H - 78, width: PAGE_W, height: 78, color: NAVY });
  d.page.drawText("VAKSINA HR", { x: M, y: PAGE_H - 22, size: 9, font: bold, color: rgb(0.73, 0.85, 0.95) });
  const title =
    input.title || (input.updated ? "Davomat · yangilangan hisobot" : "Davomat · ogohlantirish hisoboti");
  d.page.drawText(title, { x: M, y: PAGE_H - 42, size: 16, font: bold, color: PAPER });
  d.page.drawText(`${input.dateLabel}   ·   hisobot vaqti ${input.reportHm}`, {
    x: M,
    y: PAGE_H - 62,
    size: 10,
    font,
    color: rgb(0.86, 0.92, 0.97),
  });
  d.y = PAGE_H - 96;
  drawFooter(d);

  if (input.filterLine) {
    const lines = wrap(input.filterLine, font, 9, PAGE_W - M * 2);
    for (const line of lines) {
      d.page.drawText(line, { x: M, y: d.y - 12, size: 9, font, color: INK });
      d.y -= 13;
    }
    d.y -= 4;
  }

  const warn =
    input.warningText ||
    reportWarning(input.dateLabel, input.reportHm, "hisobotdagi keyingi muddat");
  const warnLines = wrap(warn, font, 9, PAGE_W - M * 2 - 16);
  const boxH = 12 + warnLines.length * 12;
  d.page.drawRectangle({
    x: M,
    y: d.y - boxH,
    width: PAGE_W - M * 2,
    height: boxH,
    color: WARN_BG,
  });
  d.page.drawText(input.updated ? "YANGILANGAN HISOBOT" : "OGOHLANTIRISH", {
    x: M + 8,
    y: d.y - 14,
    size: 8,
    font: bold,
    color: WARN_FG,
  });
  warnLines.forEach((line, i) => {
    d.page.drawText(line, {
      x: M + 8,
      y: d.y - 28 - i * 12,
      size: 9,
      font,
      color: rgb(0.47, 0.21, 0.06),
    });
  });
  d.y -= boxH + 14;

  const all = input.sections.flatMap((s) => s.blocks.flatMap((b) => b.people));
  const sum = counts(all);
  let cx = M;
  for (const kind of d.lists) {
    const text = `${LIST_META[kind].chip}: ${sum[kind]}`;
    d.page.drawText(text, { x: cx, y: d.y - 12, size: 10, font: bold, color: LIST_META[kind].fg });
    cx += bold.widthOfTextAtSize(text, 10) + 16;
  }
  const total = `Jami: ${all.length}`;
  d.page.drawText(total, { x: cx, y: d.y - 12, size: 10, font: bold, color: INK });
  d.y -= 18;
  const legendParts: string[] = [];
  if (d.lists.includes("absent")) legendParts.push("Kelmagan — bugun ishga kelmagan");
  if (d.lists.includes("late")) legendParts.push("Kechikkan — smena boshlanishidan kech kelgan");
  if (d.lists.includes("present")) legendParts.push("Kelgan — o‘z vaqtida kelgan (Keldi, ketishi yo‘q — Ketdim bosilmagan)");
  legendParts.push("Xodim ostidagi qator — shu oyda kelmagan/kechikkan kunlari");
  for (const line of wrap(`${legendParts.join(". ")}.`, font, 8, PAGE_W - M * 2)) {
    d.page.drawText(line, { x: M, y: d.y - 11, size: 8, font, color: MUTED });
    d.y -= 11;
  }
  d.y -= 8;

  if (input.summary && input.sections.length > 1) drawSummary(d, input.sections);

  if (!input.sections.length) {
    d.page.drawText("Tanlangan filtr bo‘yicha xodim topilmadi", {
      x: M,
      y: d.y - 16,
      size: 11,
      font,
      color: MUTED,
    });
  }

  for (const section of input.sections) {
    ensure(d, 36);
    d.page.drawText(fit(`Koordinator: ${section.coordinatorName}`, bold, 12, PAGE_W - M * 2), {
      x: M,
      y: d.y - 16,
      size: 12,
      font: bold,
      color: NAVY,
    });
    d.y -= 22;
    for (const block of section.blocks) {
      ensure(d, 28);
      d.page.drawText(fit(`${block.title}   ·   ${block.hours}`, bold, 11, PAGE_W - M * 2), {
        x: M,
        y: d.y - 14,
        size: 11,
        font: bold,
        color: INK,
      });
      d.y -= 20;
      for (const kind of d.lists) {
        drawList(
          d,
          kind,
          block.people.filter((p) => p.list === kind),
        );
      }
      d.y -= 6;
    }
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
