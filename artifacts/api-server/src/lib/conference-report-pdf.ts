/**
 * Konferensiya hisobot PDF (Telegramga yozuvdan keyin).
 */
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFont } from "./discipline-pdf";
import type { Conference, ConferenceHistory } from "./conferences";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 36;
const BOTTOM = 40;
const NAVY = rgb(0.024, 0.18, 0.165);
const TEAL = rgb(0.043, 0.302, 0.361);
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.886, 0.91, 0.941);
const ZEBRA = rgb(0.973, 0.98, 0.988);
const WHITE = rgb(1, 1, 1);
const ACCENT = rgb(0.043, 0.373, 1);

function clean(s: string): string {
  return String(s || "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fit(text: string, font: PDFFont, size: number, max: number): string {
  const t = clean(text) || "—";
  if (font.widthOfTextAtSize(t, size) <= max) return t;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > max) s = s.slice(0, -1);
  return `${s}…`;
}

function wrap(text: string, font: PDFFont, size: number, max: number, lines = 3): string[] {
  const words = clean(text).split(" ").filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= max) cur = next;
    else {
      if (cur) out.push(cur);
      cur = w;
      if (out.length >= lines) break;
    }
  }
  if (cur && out.length < lines) out.push(cur);
  if (out.length > lines) {
    const rest = out.slice(lines - 1).join(" ");
    return [...out.slice(0, lines - 1), fit(rest, font, size, max)];
  }
  return out.length ? out.map((l) => fit(l, font, size, max)) : ["—"];
}

function hm(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "long",
    year: "numeric",
    weekday: "long",
  });
}

function spanLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} soat ${m} daq`;
  if (m > 0) return `${m} daqiqa`;
  return `${s} soniya`;
}

function roleLabel(role: string): string {
  if (role === "host") return "Tashkilotchi";
  if (role === "cohost") return "Raxbar";
  return "Ishtirokchi";
}

export async function renderConferenceReportPdf(
  conf: Conference,
  history: ConferenceHistory,
  hostName: string,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFont("DejaVuSans.ttf"), { subset: true });
  const bold = await doc.embedFont(await readFont("DejaVuSans-Bold.ttf"), { subset: true });

  const attended = history.attendance.filter((a) => a.firstJoin);
  const absent = history.attendance.filter((a) => !a.firstJoin && a.invited);
  const totalSec = Math.max(1, history.actualSeconds || 1);
  const width = PAGE_W - M * 2;

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;
  let pageNo = 1;

  const footer = () => {
    page.drawText(fit(`VAKSINA HR · ${conf.code} · ${pageNo}-varaq`, font, 8, width), {
      x: M,
      y: 18,
      size: 8,
      font,
      color: MUTED,
    });
  };

  const ensure = (need: number) => {
    if (y - need >= BOTTOM) return;
    footer();
    page = doc.addPage([PAGE_W, PAGE_H]);
    pageNo += 1;
    y = PAGE_H - M;
  };

  // Header
  page.drawRectangle({ x: 0, y: PAGE_H - 72, width: PAGE_W, height: 72, color: NAVY });
  page.drawRectangle({ x: 0, y: PAGE_H - 72, width: 8, height: 72, color: TEAL });
  page.drawText(fit("VAKSINA HR · Konferensiya hisobot", bold, 16, width), {
    x: M,
    y: PAGE_H - 34,
    size: 16,
    font: bold,
    color: WHITE,
  });
  page.drawText(
    fit(
      new Date().toLocaleString("uz-UZ", {
        timeZone: "Asia/Tashkent",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      font,
      9,
      width,
    ),
    { x: M, y: PAGE_H - 54, size: 9, font, color: rgb(0.82, 0.9, 0.92) },
  );
  y = PAGE_H - 92;

  // Title
  const titleLines = wrap(conf.title, bold, 15, width, 3);
  for (const ln of titleLines) {
    ensure(20);
    page.drawText(ln, { x: M, y: y - 14, size: 15, font: bold, color: INK });
    y -= 18;
  }
  y -= 4;
  ensure(28);
  page.drawText(fit(`Tashkilotchi: ${hostName}`, font, 10, width), { x: M, y: y - 12, size: 10, font, color: MUTED });
  y -= 16;
  page.drawText(
    fit(`Sana: ${dayLabel(history.actualStart)} · Kod: ${conf.code}`, font, 10, width),
    { x: M, y: y - 12, size: 10, font, color: MUTED },
  );
  y -= 28;

  // Stats cards
  const cards = [
    { lab: "BOSHLANDI", val: hm(history.actualStart) },
    { lab: "TUGADI", val: hm(history.actualEnd) },
    { lab: "DAVOMIYLIGI", val: spanLabel(history.actualSeconds) },
    { lab: "QATNASHDI", val: `${history.attendedCount} / ${history.invitedCount}` },
  ];
  ensure(56);
  const gap = 8;
  const cardW = (width - gap * 3) / 4;
  cards.forEach((c, i) => {
    const x = M + i * (cardW + gap);
    page.drawRectangle({
      x,
      y: y - 48,
      width: cardW,
      height: 48,
      color: ZEBRA,
      borderColor: LINE,
      borderWidth: 1,
    });
    page.drawText(fit(c.lab, bold, 7, cardW - 12), { x: x + 8, y: y - 18, size: 7, font: bold, color: MUTED });
    page.drawText(fit(c.val, bold, 11, cardW - 12), { x: x + 8, y: y - 36, size: 11, font: bold, color: INK });
  });
  y -= 64;

  // Attendance
  ensure(24);
  page.drawText(fit(`Qatnashuvchilar · ${attended.length}`, bold, 12, width), {
    x: M,
    y: y - 12,
    size: 12,
    font: bold,
    color: ACCENT,
  });
  y -= 22;

  for (let i = 0; i < attended.length; i++) {
    const a = attended[i]!;
    ensure(36);
    if (i % 2 === 0) {
      page.drawRectangle({ x: M, y: y - 30, width: width, height: 30, color: ZEBRA });
    }
    const share = Math.min(100, Math.round((a.seconds / totalSec) * 100));
    page.drawText(fit(`${i + 1}. ${a.fullName}`, bold, 10, width * 0.55), {
      x: M + 6,
      y: y - 12,
      size: 10,
      font: bold,
      color: INK,
    });
    page.drawText(fit(`${roleLabel(a.role)} · ${spanLabel(a.seconds)} · ${share}%`, font, 8.5, width * 0.4), {
      x: M + width * 0.55,
      y: y - 12,
      size: 8.5,
      font,
      color: MUTED,
    });
    page.drawText(
      fit(
        `${a.position || "—"} · ${hm(a.firstJoin)}–${hm(a.lastLeave)}`,
        font,
        8,
        width - 12,
      ),
      { x: M + 6, y: y - 24, size: 8, font, color: MUTED },
    );
    y -= 34;
  }

  if (absent.length) {
    ensure(24);
    page.drawText(fit(`Kirmaganlar · ${absent.length}`, bold, 12, width), {
      x: M,
      y: y - 12,
      size: 12,
      font: bold,
      color: ACCENT,
    });
    y -= 20;
    for (const a of absent) {
      ensure(16);
      page.drawText(fit(`· ${a.fullName}${a.position ? ` (${a.position})` : ""}`, font, 9.5, width), {
        x: M + 4,
        y: y - 11,
        size: 9.5,
        font,
        color: INK,
      });
      y -= 15;
    }
    y -= 6;
  }

  // Chat
  if (history.messages.length) {
    ensure(24);
    page.drawText(fit(`Chat · ${history.messages.length}`, bold, 12, width), {
      x: M,
      y: y - 12,
      size: 12,
      font: bold,
      color: ACCENT,
    });
    y -= 20;
    const chatLimit = history.messages.slice(0, 200);
    for (const m of chatLimit) {
      const lines = wrap(m.text, font, 9, width - 70, 3);
      ensure(16 + lines.length * 12);
      page.drawText(fit(hm(m.at), bold, 8, 40), { x: M, y: y - 11, size: 8, font: bold, color: MUTED });
      page.drawText(fit(m.name, bold, 9, width - 70), { x: M + 48, y: y - 11, size: 9, font: bold, color: INK });
      y -= 14;
      for (const ln of lines) {
        page.drawText(ln, { x: M + 48, y: y - 10, size: 9, font, color: INK });
        y -= 12;
      }
      y -= 4;
    }
    if (history.messages.length > chatLimit.length) {
      ensure(14);
      page.drawText(fit(`… yana ${history.messages.length - chatLimit.length} xabar`, font, 8.5, width), {
        x: M,
        y: y - 10,
        size: 8.5,
        font,
        color: MUTED,
      });
      y -= 14;
    }
  }

  ensure(28);
  page.drawText(
    fit("Full HD yozuv Telegramga yuboriladi. Platformada video saqlanmaydi — faqat statistika qoladi.", font, 8.5, width),
    { x: M, y: y - 12, size: 8.5, font, color: MUTED },
  );

  footer();
  return Buffer.from(await doc.save());
}
