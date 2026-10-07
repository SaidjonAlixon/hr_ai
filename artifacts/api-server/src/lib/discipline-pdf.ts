import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { DisciplinePerson, DisciplineReport, TodayLock } from "./discipline";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 28;
const BOTTOM = 36;
const NAVY = rgb(0.043, 0.227, 0.361);
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.886, 0.91, 0.941);
const PAPER = rgb(1, 1, 1);
const ZEBRA = rgb(0.973, 0.98, 0.988);

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];

const LEVELS: Array<{
  key: string;
  title: string;
  note: string;
  match: (p: DisciplinePerson) => boolean;
  bg: RGB;
  fg: RGB;
}> = [
  {
    key: "5",
    title: "5 va undan ko‘p marta — ishdan bo‘shatish masalasi",
    note: "Har safar 1 oylik ish haqining 50% jarima. Hodisa kuni xodim tizimga kira olmaydi.",
    match: (p) => p.strikes >= 5,
    bg: rgb(0.996, 0.886, 0.898),
    fg: rgb(0.62, 0.05, 0.16),
  },
  {
    key: "4",
    title: "4 marta — 1 kunlik ish haqining 100% jarima",
    note: "Keyingi (5-) safar — 1 oylik ish haqining 50% jarima, ishdan bo‘shatish masalasi va tizim bloklanadi.",
    match: (p) => p.strikes === 4,
    bg: rgb(1, 0.929, 0.835),
    fg: rgb(0.65, 0.27, 0.02),
  },
  {
    key: "3",
    title: "3 marta — xavf zonasi",
    note: "3-marta 1 kunlik ish haqining 30%. Keyingi safar — 1 kunlik ish haqining 100%.",
    match: (p) => p.strikes === 3,
    bg: rgb(1, 0.973, 0.882),
    fg: rgb(0.57, 0.38, 0.03),
  },
];

export async function readFont(file: string): Promise<Buffer> {
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

function som(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/\u00a0/g, " ")} so‘m`;
}

function dmy(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

function weekday(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return "";
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || "";
}

function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

function stamp(d: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function rule(n: number): string {
  if (n <= 1) return "Ogohlantirish";
  if (n <= 3) return "Kunlikning 30%";
  if (n === 4) return "Kunlikning 100%";
  if (n === 5) return "Oylik 50% · blok";
  return "Oylik 50% · oxirgi ogohl.";
}

/** Xodim yana kech qolsa / kelmasa nima bo‘lishi */
export function disciplineNextStep(strikes: number): string {
  if (strikes <= 2) return "yana 1 marta — 1 kunlik ish haqining 30% jarima";
  if (strikes === 3) return "yana 1 marta — 1 kunlik ish haqining 100% jarima";
  if (strikes === 4) return "yana 1 marta — 1 oylik ish haqining 50% jarima, o‘sha kuni tizim bloklanadi";
  if (strikes === 5) return "yana 1 marta — 50% jarima, oxirgi ogohlantirish va ishdan bo‘shatishga rozilik xati";
  return "oxirgi ogohlantirish berilgan — yana takrorlansa ishdan bo‘shatish uchun asos";
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
  headLine: string;
  audience: string;
};

function footer(d: Draw) {
  d.page.drawText(`VAKSINA HR  ·  Intizom hisoboti  ·  ${d.pageNo}-sahifa  ·  Maxfiy — ${d.audience}`, {
    x: M,
    y: 16,
    size: 7.5,
    font: d.font,
    color: MUTED,
  });
}

function newPage(d: Draw) {
  d.page = d.doc.addPage([PAGE_W, PAGE_H]);
  d.pageNo += 1;
  d.page.drawRectangle({ x: 0, y: PAGE_H - 22, width: PAGE_W, height: 22, color: NAVY });
  d.page.drawText(fit(d.headLine, d.bold, 8, PAGE_W - M * 2), { x: M, y: PAGE_H - 15, size: 8, font: d.bold, color: PAPER });
  d.y = PAGE_H - 36;
  footer(d);
}

function ensure(d: Draw, need: number) {
  if (d.y - need < BOTTOM) newPage(d);
}

const COLS = [
  { label: "№", w: 26 },
  { label: "Sana", w: 70 },
  { label: "Hafta kuni", w: 78 },
  { label: "Sabab", w: 78 },
  { label: "Filial", w: 98 },
  { label: "Qoida", w: 104 },
  { label: "Jarima", w: 85 },
];

function drawPerson(d: Draw, p: DisciplinePerson, index: number, fg: RGB) {
  const width = PAGE_W - M * 2;
  const info = [p.position, p.branch, p.shift].filter(Boolean).join("  ·  ") || "—";
  const historyText = p.history.length
    ? `Oldingi oylar: ${summarizeHistory(p)}`
    : "Oldingi oylarda jarima yo‘q.";
  const historyLines = wrap(historyText, d.font, 8, width - 16);
  const lockText = p.locks.length
    ? `Tizim bloklangan kunlar: ${p.locks
        .map((l) => `${dmy(l.day)} (${l.strikeN}-marta${l.cleared ? `, ochib berdi: ${l.clearedBy || "admin"}` : ""})`)
        .join("; ")}`
    : "";
  const lockLines = lockText ? wrap(lockText, d.bold, 8, width - 16) : [];

  const headH = 44;
  ensure(d, headH + 16 + 15 * Math.min(p.events.length, 3));

  const top = d.y;
  d.page.drawRectangle({ x: M, y: top - headH, width, height: headH, color: rgb(0.965, 0.973, 0.984) });
  d.page.drawRectangle({ x: M, y: top - headH, width: 3, height: headH, color: fg });
  d.page.drawText(fit(`${index}. ${p.fullName}`, d.bold, 11.5, width - 190), { x: M + 10, y: top - 16, size: 11.5, font: d.bold, color: INK });
  const right = `${p.strikes} marta  ·  ${som(p.monthAmount)}`;
  const rw = d.bold.widthOfTextAtSize(right, 10.5);
  d.page.drawText(right, { x: M + width - 10 - rw, y: top - 16, size: 10.5, font: d.bold, color: fg });
  d.page.drawText(fit(info, d.font, 8.5, width - 20), { x: M + 10, y: top - 29, size: 8.5, font: d.font, color: INK });
  d.page.drawText(fit(`Koordinator: ${p.coordinator || "biriktirilmagan"}`, d.font, 8.5, width - 20), {
    x: M + 10,
    y: top - 40,
    size: 8.5,
    font: d.font,
    color: MUTED,
  });
  d.y = top - headH - 2;

  const drawHead = () => {
    const y = d.y - 14;
    d.page.drawRectangle({ x: M, y, width, height: 14, color: NAVY });
    let x = M;
    for (const c of COLS) {
      d.page.drawText(c.label, { x: x + 4, y: y + 4, size: 7.5, font: d.bold, color: PAPER });
      x += c.w;
    }
    d.y = y;
  };
  drawHead();
  p.events.forEach((ev, i) => {
    if (d.y - 14 < BOTTOM) {
      newPage(d);
      drawHead();
    }
    const y = d.y - 14;
    if (i % 2 === 1) d.page.drawRectangle({ x: M, y, width, height: 14, color: ZEBRA });
    const cells = [
      `${ev.n}`,
      dmy(ev.date),
      weekday(ev.date),
      ev.kind === "late" ? "Kech keldi" : "Kelmadi",
      ev.branch || p.branch || "—",
      rule(ev.n),
      som(ev.amount),
    ];
    let x = M;
    cells.forEach((value, ci) => {
      const col = COLS[ci]!;
      const strong = ci === 0 || ci === 6 || (ci === 3 && ev.kind === "absent");
      const color = ci === 3 ? (ev.kind === "late" ? rgb(0.706, 0.325, 0.035) : rgb(0.745, 0.071, 0.235)) : ci === 6 ? fg : INK;
      d.page.drawText(fit(value, strong ? d.bold : d.font, 8, col.w - 8), {
        x: x + 4,
        y: y + 4,
        size: 8,
        font: strong ? d.bold : d.font,
        color: ev.n >= 5 && ci === 0 ? fg : color,
      });
      x += col.w;
    });
    d.page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.4, color: LINE });
    d.y = y;
  });

  const nextLines = wrap(`Keyingi qadam: ${disciplineNextStep(p.strikes)}`, d.bold, 8, width - 16);
  const notes = [
    ...nextLines.map((t) => ({ t, bold: true, color: fg })),
    ...lockLines.map((t) => ({ t, bold: true, color: rgb(0.62, 0.05, 0.16) })),
    ...historyLines.map((t) => ({ t, bold: false, color: MUTED })),
  ];
  ensure(d, 6 + notes.length * 11);
  d.y -= 4;
  for (const n of notes) {
    d.page.drawText(n.t, { x: M + 8, y: d.y - 9, size: 8, font: n.bold ? d.bold : d.font, color: n.color });
    d.y -= 11;
  }
  d.y -= 12;
}

function summarizeHistory(p: DisciplinePerson): string {
  const byMonth = new Map<string, typeof p.history>();
  for (const ev of p.history) {
    const list = byMonth.get(ev.month) ?? [];
    list.push(ev);
    byMonth.set(ev.month, list);
  }
  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, list]) => {
      const sum = list.reduce((s, e) => s + e.amount, 0);
      const days = list.map((e) => `${dmy(e.date).slice(0, 5)} ${e.kind === "late" ? "kech" : "kelmadi"}`).join(", ");
      return `${monthTitle(month)} — ${list.length} marta, ${som(sum)} (${days})`;
    })
    .join(";  ");
}

const COORD_COLS = [
  { label: "Koordinator", w: 215 },
  { label: "Xodim", w: 52 },
  { label: "5+ marta", w: 58 },
  { label: "4 marta", w: 52 },
  { label: "3 marta", w: 52 },
  { label: "Jami jarima", w: 110 },
];

function drawCoordinatorSummary(d: Draw, people: DisciplinePerson[]) {
  const width = PAGE_W - M * 2;
  const groups = new Map<string, DisciplinePerson[]>();
  for (const p of people) {
    const key = p.coordinator || "Biriktirilmagan";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const rows = [...groups.entries()]
    .map(([name, list]) => ({
      name,
      count: list.length,
      s5: list.filter((p) => p.strikes >= 5).length,
      s4: list.filter((p) => p.strikes === 4).length,
      s3: list.filter((p) => p.strikes === 3).length,
      amount: list.reduce((s, p) => s + p.monthAmount, 0),
    }))
    .sort(
      (a, b) =>
        Number(a.name === "Biriktirilmagan") - Number(b.name === "Biriktirilmagan") ||
        b.s5 - a.s5 ||
        b.count - a.count ||
        a.name.localeCompare(b.name, "uz"),
    );

  ensure(d, 40 + Math.min(rows.length, 6) * 14);
  d.page.drawText("KOORDINATORLAR KESIMIDA", { x: M, y: d.y - 10, size: 8, font: d.bold, color: NAVY });
  d.y -= 16;
  const drawHead = () => {
    const y = d.y - 14;
    d.page.drawRectangle({ x: M, y, width, height: 14, color: NAVY });
    let x = M;
    for (const c of COORD_COLS) {
      d.page.drawText(c.label, { x: x + 4, y: y + 4, size: 7.5, font: d.bold, color: PAPER });
      x += c.w;
    }
    d.y = y;
  };
  drawHead();
  rows.forEach((r, i) => {
    if (d.y - 14 < BOTTOM) {
      newPage(d);
      drawHead();
    }
    const y = d.y - 14;
    if (i % 2 === 1) d.page.drawRectangle({ x: M, y, width, height: 14, color: ZEBRA });
    const cells = [r.name, String(r.count), r.s5 ? String(r.s5) : "—", r.s4 ? String(r.s4) : "—", r.s3 ? String(r.s3) : "—", som(r.amount)];
    let x = M;
    cells.forEach((value, ci) => {
      const col = COORD_COLS[ci]!;
      const color = ci === 2 && r.s5 ? LEVELS[0]!.fg : ci === 3 && r.s4 ? LEVELS[1]!.fg : ci === 0 && r.name === "Biriktirilmagan" ? MUTED : INK;
      const f = ci === 0 || ci === 5 || (ci === 2 && r.s5) ? d.bold : d.font;
      d.page.drawText(fit(value, f, 8, col.w - 8), { x: x + 4, y: y + 4, size: 8, font: f, color });
      x += col.w;
    });
    d.page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.4, color: LINE });
    d.y = y;
  });
  d.y -= 14;
}

function hm(value: string | Date | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" }).format(d);
}

const LOCK_COLS = [
  { label: "№", w: 24 },
  { label: "F.I.Sh.", w: 140 },
  { label: "Lavozim · filial", w: 130 },
  { label: "Sabab", w: 125 },
  { label: "", w: 120 },
];

const BLOCKED_TONE = { bg: rgb(0.996, 0.886, 0.898), fg: rgb(0.62, 0.05, 0.16) };
const ALLOWED_TONE = { bg: rgb(0.863, 0.969, 0.906), fg: rgb(0.02, 0.45, 0.25) };

function drawLockTable(
  d: Draw,
  title: string,
  note: string,
  lastLabel: string,
  list: TodayLock[],
  tone: { bg: RGB; fg: RGB },
  last: (l: TodayLock) => string,
) {
  const width = PAGE_W - M * 2;
  ensure(d, 60 + Math.min(list.length, 3) * 14);
  const h = 34;
  d.page.drawRectangle({ x: M, y: d.y - h, width, height: h, color: tone.bg });
  d.page.drawRectangle({ x: M, y: d.y - h, width: 3, height: h, color: tone.fg });
  d.page.drawText(title, { x: M + 10, y: d.y - 14, size: 11, font: d.bold, color: tone.fg });
  const cnt = `${list.length} xodim`;
  d.page.drawText(cnt, { x: M + width - 8 - d.bold.widthOfTextAtSize(cnt, 10), y: d.y - 14, size: 10, font: d.bold, color: tone.fg });
  d.page.drawText(fit(note, d.font, 8, width - 20), { x: M + 10, y: d.y - 27, size: 8, font: d.font, color: tone.fg });
  d.y -= h;

  if (!list.length) {
    d.page.drawText("Hozircha yo‘q.", { x: M + 10, y: d.y - 14, size: 9, font: d.font, color: MUTED });
    d.y -= 26;
    return;
  }

  const cols = LOCK_COLS.map((c, i) => (i === LOCK_COLS.length - 1 ? { ...c, label: lastLabel } : c));
  const drawHead = () => {
    const y = d.y - 14;
    d.page.drawRectangle({ x: M, y, width, height: 14, color: NAVY });
    let x = M;
    for (const c of cols) {
      d.page.drawText(c.label, { x: x + 4, y: y + 4, size: 7.5, font: d.bold, color: PAPER });
      x += c.w;
    }
    d.y = y;
  };
  drawHead();
  list.forEach((l, i) => {
    if (d.y - 14 < BOTTOM) {
      newPage(d);
      drawHead();
    }
    const y = d.y - 14;
    if (i % 2 === 1) d.page.drawRectangle({ x: M, y, width, height: 14, color: ZEBRA });
    const cells = [
      String(i + 1),
      l.fullName,
      [l.position, l.branch].filter(Boolean).join(" · ") || "—",
      `${l.strikeN}-marta · ${l.kind === "late" ? "kech keldi" : "kelmadi"} ${dmy(String(l.eventDate)).slice(0, 5)}`,
      last(l),
    ];
    let x = M;
    cells.forEach((value, ci) => {
      const col = cols[ci]!;
      const strong = ci === 1 || ci === 4;
      d.page.drawText(fit(value, strong ? d.bold : d.font, 8, col.w - 8), {
        x: x + 4,
        y: y + 4,
        size: 8,
        font: strong ? d.bold : d.font,
        color: ci === 4 ? tone.fg : INK,
      });
      x += col.w;
    });
    d.page.drawLine({ start: { x: M, y }, end: { x: M + width, y }, thickness: 0.4, color: LINE });
    d.y = y;
  });
  d.y -= 14;
}

function drawTodayLocks(d: Draw, locks: TodayLock[], today: string) {
  const blocked = locks.filter((l) => !l.clearedAt);
  const allowed = locks
    .filter((l) => l.clearedAt)
    .sort((a, b) => new Date(b.clearedAt!).getTime() - new Date(a.clearedAt!).getTime());

  ensure(d, 80);
  d.page.drawText(`BUGUNGI PLATFORMA HOLATI — ${dmy(today)}`, { x: M, y: d.y - 10, size: 8, font: d.bold, color: NAVY });
  d.y -= 18;
  drawLockTable(
    d,
    "Bloklanganlar",
    "Bugun platformaga kira olmaydi — rahbar ruxsat bermaguncha.",
    "Bloklangan vaqt",
    blocked,
    BLOCKED_TONE,
    (l) => hm(l.createdAt),
  );
  drawLockTable(
    d,
    "Ruxsat berilganlar",
    "Blok olib tashlangan — bugun platformadan foydalanmoqda.",
    "Ruxsat berdi",
    allowed,
    ALLOWED_TONE,
    (l) => [l.clearedByName || "admin", hm(l.clearedAt)].filter(Boolean).join(" · "),
  );
}

export type DisciplinePdfOptions = {
  /** Berilsa — faqat shu koordinator xodimlari uchun hisobot */
  coordinatorName?: string;
  /** Berilsa — bugungi bloklar «Bloklanganlar» va «Ruxsat berilganlar» bo‘yicha alohida chiqariladi */
  todayLocks?: TodayLock[];
  today?: string;
};

export async function renderDisciplinePdf(report: DisciplineReport, opts: DisciplinePdfOptions = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFont("DejaVuSans.ttf"), { subset: true });
  const bold = await doc.embedFont(await readFont("DejaVuSans-Bold.ttf"), { subset: true });
  const generated = stamp(report.generatedAt);
  const coord = opts.coordinatorName?.trim() || null;
  const d: Draw = {
    doc,
    font,
    bold,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H,
    pageNo: 1,
    headLine: coord
      ? `VAKSINA HR  ·  Intizom hisoboti  ·  ${coord} xodimlari  ·  ${monthTitle(report.month)}  ·  ${generated}`
      : `VAKSINA HR  ·  Intizom hisoboti  ·  ${monthTitle(report.month)}  ·  ${generated}`,
    audience: coord ? `faqat koordinator ${coord} uchun` : "faqat rahbariyat uchun",
  };
  const width = PAGE_W - M * 2;

  d.page.drawRectangle({ x: 0, y: PAGE_H - 84, width: PAGE_W, height: 84, color: NAVY });
  d.page.drawText("VAKSINA HR  ·  MAXFIY", { x: M, y: PAGE_H - 22, size: 9, font: bold, color: rgb(0.73, 0.85, 0.95) });
  d.page.drawText(coord ? "Intizom hisoboti — sizning xodimlaringiz" : "Intizom hisoboti — davomat jarimalari", {
    x: M,
    y: PAGE_H - 44,
    size: 17,
    font: bold,
    color: PAPER,
  });
  d.page.drawText(fit(`${coord ? `Koordinator: ${coord}  ·  ` : ""}${monthTitle(report.month)}  ·  yangilangan: ${generated}`, font, 10, width), {
    x: M,
    y: PAGE_H - 64,
    size: 10,
    font,
    color: rgb(0.86, 0.92, 0.97),
  });
  d.y = PAGE_H - 100;
  footer(d);

  if (coord) {
    const warnText =
      "Ushbu hisobotdagi xodimlar sizga biriktirilgan. Har bir holat bo‘yicha sababni aniqlang, xodim bilan suhbat o‘tkazing va HR ga asosli ma’lumot (F.I.Sh., sana, sabab, tasdiqlovchi hujjat) bering. Agar bu holatlar bo‘yicha ma’lumotga ega bo‘lmasangiz yoki o‘z vaqtida chora ko‘rmasangiz — sizga ham jarima qo‘llaniladi.";
    const warnLines = wrap(warnText, bold, 8.5, width - 18);
    const warnH = 20 + warnLines.length * 11.5;
    d.page.drawRectangle({ x: M, y: d.y - warnH, width, height: warnH, color: rgb(0.996, 0.902, 0.91) });
    d.page.drawRectangle({ x: M, y: d.y - warnH, width: 3, height: warnH, color: rgb(0.75, 0.07, 0.2) });
    d.page.drawText("KOORDINATOR DIQQATIGA", { x: M + 10, y: d.y - 12, size: 7.5, font: bold, color: rgb(0.62, 0.05, 0.16) });
    warnLines.forEach((line, i) => {
      d.page.drawText(line, { x: M + 10, y: d.y - 25 - i * 11.5, size: 8.5, font: bold, color: rgb(0.5, 0.04, 0.13) });
    });
    d.y -= warnH + 10;
  }

  const ruleText =
    "Qoida: 1-marta — ogohlantirish va tushuntirish xati; 2-marta va 3-marta — 1 kunlik ish haqining 30%; 4-marta — 1 kunlik ish haqining 100%; 5-marta va undan keyin — har safar 1 oylikning 50%, ishdan bo‘shatish masalasi ko‘riladi va xodim o‘sha kuni tizimga kira olmaydi. Har bir holat bo‘yicha tushuntirish xati imzolanmaguncha keyingi davomat belgilanmaydi. Kech kelish va kelmaslik bir xil hisoblanadi.";
  const ruleLines = wrap(ruleText, font, 8.5, width - 16);
  const boxH = 18 + ruleLines.length * 11;
  d.page.drawRectangle({ x: M, y: d.y - boxH, width, height: boxH, color: rgb(1, 0.973, 0.882) });
  d.page.drawText("JARIMA QOIDASI", { x: M + 8, y: d.y - 12, size: 7.5, font: bold, color: rgb(0.573, 0.251, 0.055) });
  ruleLines.forEach((line, i) => {
    d.page.drawText(line, { x: M + 8, y: d.y - 25 - i * 11, size: 8.5, font, color: rgb(0.47, 0.21, 0.06) });
  });
  d.y -= boxH + 12;

  const total = report.people.reduce((s, p) => s + p.monthAmount, 0);
  const cards = [
    ...LEVELS.map((lv) => ({ label: lv.key === "5" ? "5+ marta" : `${lv.key} marta`, value: String(report.people.filter(lv.match).length), fg: lv.fg, bg: lv.bg })),
    { label: "Jami jarima", value: som(total), fg: NAVY, bg: rgb(0.945, 0.957, 0.973) },
  ];
  const gap = 6;
  const cw = (width - gap * (cards.length - 1)) / cards.length;
  cards.forEach((c, i) => {
    const x = M + i * (cw + gap);
    d.page.drawRectangle({ x, y: d.y - 40, width: cw, height: 40, color: c.bg });
    d.page.drawText(c.label, { x: x + 8, y: d.y - 14, size: 8, font, color: MUTED });
    let size = 13;
    while (size > 8 && bold.widthOfTextAtSize(c.value, size) > cw - 16) size -= 0.5;
    d.page.drawText(fit(c.value, bold, size, cw - 16), { x: x + 8, y: d.y - 32, size, font: bold, color: c.fg });
  });
  d.y -= 54;

  if (opts.todayLocks && opts.today) drawTodayLocks(d, opts.todayLocks, opts.today);

  if (!report.people.length) {
    d.page.drawText("Shu oyda 3 va undan ko‘p marta jarima olgan xodim yo‘q.", { x: M, y: d.y - 14, size: 11, font, color: MUTED });
  } else if (!coord) {
    drawCoordinatorSummary(d, report.people);
  }

  let counter = 0;
  for (const lv of LEVELS) {
    const list = report.people.filter(lv.match);
    if (!list.length) continue;
    ensure(d, 120);
    const noteLines = wrap(lv.note, font, 8.5, width - 16);
    const h = 22 + noteLines.length * 11;
    d.page.drawRectangle({ x: M, y: d.y - h, width, height: h, color: lv.bg });
    d.page.drawText(fit(lv.title, bold, 11.5, width - 80), { x: M + 8, y: d.y - 15, size: 11.5, font: bold, color: lv.fg });
    const cnt = `${list.length} xodim`;
    d.page.drawText(cnt, { x: M + width - 8 - bold.widthOfTextAtSize(cnt, 10), y: d.y - 15, size: 10, font: bold, color: lv.fg });
    noteLines.forEach((line, i) => {
      d.page.drawText(line, { x: M + 8, y: d.y - 28 - i * 11, size: 8.5, font, color: lv.fg });
    });
    d.y -= h + 10;
    for (const p of list) {
      counter += 1;
      drawPerson(d, p, counter, lv.fg);
    }
    d.y -= 6;
  }

  return Buffer.from(await doc.save());
}
