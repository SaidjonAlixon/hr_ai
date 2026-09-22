import { deflateSync } from "node:zlib";
import type { StaffingMonitorReport } from "./filial-staffing-monitor";

function xmlEsc(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  const t = Math.round(n * 10) / 10;
  return `${t % 1 === 0 ? t.toFixed(0) : t.toFixed(1)}%`;
}

function truncate(s: string, max: number): string {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function wrapLines(text: string, maxLen = 36): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxLen && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

const DOT = ["#0B5FFF", "#3D7EFF", "#5BA0FF", "#8BBCFF", "#A8C8FF", "#C7D7FF"];

function kritCount(report: StaffingMonitorReport): number {
  return report.items.filter((i) => i.daysOpen >= 30).length;
}
function highCount(report: StaffingMonitorReport): number {
  return report.items.filter((i) => i.daysOpen >= 14 && i.daysOpen < 30).length;
}

/** Aniq shriftli SVG — sharp orqali PNG */
export function buildStaffingMonitorSvg(report: StaffingMonitorReport): string {
  const d1 = report.byDistrict[0];
  const d2 = report.byDistrict[1];
  const d3 = report.byDistrict[2];
  const s1 = report.topShift;
  const roleFarm = report.byRole.find((r) => /farmasevt/i.test(r.label));
  const roleMudir = report.byRole.find((r) => /mudir/i.test(r.label));
  const roleStaj = report.byRole.find((r) => /stajyor/i.test(r.label));
  const analysis = wrapLines(report.analysisLine, 40);
  const krit = kritCount(report);
  const high = highCount(report);

  const legend = report.byDistrict.slice(0, 8);
  const shifts = report.byShift.slice(0, 4);

  const analysisSvg = analysis
    .map(
      (line, i) =>
        `<text x="48" y="${548 + i * 24}" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="15" fill="#334155">${xmlEsc(line)}</text>`,
    )
    .join("\n");

  const legendSvg = legend
    .map((d, i) => {
      const y = 548 + i * 28;
      return `
      <rect x="476" y="${y - 10}" width="12" height="12" rx="3" fill="${DOT[i % DOT.length]}"/>
      <text x="498" y="${y}" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="15" fill="#0A2540">${xmlEsc(truncate(d.label, 18))}</text>
      <text x="820" y="${y}" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="15" font-weight="700" fill="#0A2540" text-anchor="end">${d.count} · ${fmtPct(d.pct)}</text>`;
    })
    .join("");

  const shiftSvg = shifts
    .map((s, i) => {
      const barW = Math.max(20, Math.round((s.pct / 100) * 420));
      const y = 820 + i * 36;
      return `
    <rect x="48" y="${y}" width="${barW}" height="22" rx="6" fill="${i === 0 ? "#0B5FFF" : "#8BBCFF"}"/>
    <text x="490" y="${y + 16}" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="14" fill="#0A2540">${xmlEsc(truncate(s.label, 20))} — ${s.count} (${fmtPct(s.pct)})</text>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <rect width="900" height="1200" fill="#E8EEF7"/>

  <!-- HEADER -->
  <rect x="24" y="24" width="852" height="168" rx="20" fill="#0B5FFF"/>
  <text x="48" y="64" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="26" font-weight="700" fill="#FFFFFF">Xodim ehtiyoji</text>
  <text x="48" y="92" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="14" fill="#D6E4FF">${xmlEsc(report.generatedAtLabel)} · Toshkent · faqat ochiq yollash</text>
  <text x="48" y="148" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="52" font-weight="800" fill="#FFFFFF">${report.totalNeeds}</text>
  <text x="48" y="172" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="14" fill="#C7D7FF">ochiq ehtiyoj (bo'shatilgan hisobga olinmagan)</text>

  <rect x="520" y="44" width="332" height="56" rx="12" fill="#FFFFFF" fill-opacity="0.18"/>
  <text x="536" y="68" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="13" fill="#E8F0FF">Ehtiyojli filial</text>
  <text x="536" y="90" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="24" font-weight="800" fill="#FFFFFF">${report.gapBranches} / ${report.totalBranches}</text>

  <rect x="520" y="112" width="100" height="60" rx="10" fill="#FFFFFF" fill-opacity="0.16"/>
  <text x="532" y="134" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="11" fill="#D6E4FF">Yollash</text>
  <text x="532" y="158" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="22" font-weight="800" fill="#FFFFFF">${report.needHireCount}</text>

  <rect x="632" y="112" width="100" height="60" rx="10" fill="#FFFFFF" fill-opacity="0.16"/>
  <text x="644" y="134" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="11" fill="#D6E4FF">Qidiruv</text>
  <text x="644" y="158" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="22" font-weight="800" fill="#FFFFFF">${report.searchingCount}</text>

  <rect x="744" y="112" width="108" height="60" rx="10" fill="#FFFFFF" fill-opacity="0.16"/>
  <text x="756" y="134" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="11" fill="#D6E4FF">To'liq OK</text>
  <text x="756" y="158" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="22" font-weight="800" fill="#FFFFFF">${report.okBranches}</text>

  <!-- KPI row -->
  <rect x="24" y="208" width="204" height="100" rx="16" fill="#1A73E8"/>
  <text x="40" y="236" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="13" fill="#E8F0FF">Kritik (≥30 kun)</text>
  <text x="40" y="280" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="36" font-weight="800" fill="#FFFFFF">${krit}</text>

  <rect x="240" y="208" width="204" height="100" rx="16" fill="#F97316"/>
  <text x="256" y="236" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="13" fill="#FFF7ED">Yuqori (≥14 kun)</text>
  <text x="256" y="280" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="36" font-weight="800" fill="#FFFFFF">${high}</text>

  <rect x="456" y="208" width="204" height="100" rx="16" fill="#0EA5E9"/>
  <text x="472" y="236" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="13" fill="#E0F2FE">Eng kerakli smena</text>
  <text x="472" y="268" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">${xmlEsc(truncate(s1?.label || "—", 16))}</text>
  <text x="472" y="294" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="16" fill="#E0F2FE">${s1 ? `${s1.count} · ${fmtPct(s1.pct)}` : "0"}</text>

  <rect x="672" y="208" width="204" height="100" rx="16" fill="#6366F1"/>
  <text x="688" y="236" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="13" fill="#E0E7FF">Top tuman</text>
  <text x="688" y="268" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">${xmlEsc(truncate(d1?.label || "—", 14))}</text>
  <text x="688" y="294" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="16" fill="#E0E7FF">${d1 ? `${d1.count} · ${fmtPct(d1.pct)}` : "0"}</text>

  <!-- Roles + top districts -->
  <rect x="24" y="324" width="280" height="150" rx="16" fill="#FFFFFF"/>
  <text x="40" y="352" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="16" font-weight="700" fill="#0A2540">Lavozimlar</text>
  <text x="40" y="388" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="15" fill="#334155">Farmasevt: ${roleFarm?.count ?? 0} (${fmtPct(roleFarm?.pct ?? 0)})</text>
  <text x="40" y="416" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="15" fill="#334155">Mudir: ${roleMudir?.count ?? 0} (${fmtPct(roleMudir?.pct ?? 0)})</text>
  <text x="40" y="444" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="15" fill="#334155">Stajyor: ${roleStaj?.count ?? 0} (${fmtPct(roleStaj?.pct ?? 0)})</text>

  <rect x="316" y="324" width="280" height="150" rx="16" fill="#1A73E8"/>
  <text x="332" y="352" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="14" fill="#E8F0FF">1-o'rin tuman</text>
  <text x="332" y="388" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#FFFFFF">${xmlEsc(truncate(d1?.label || "—", 16))}</text>
  <text x="332" y="430" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="40" font-weight="800" fill="#FFFFFF">${d1 ? fmtPct(d1.pct) : "0%"}</text>
  <text x="332" y="456" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="14" fill="#D6E4FF">${d1 ? `${d1.count} ehtiyoj` : "0"}</text>

  <rect x="608" y="324" width="268" height="150" rx="16" fill="#5BA0FF"/>
  <text x="624" y="352" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="14" fill="#E8F0FF">2 / 3-o'rin</text>
  <text x="624" y="388" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="16" font-weight="700" fill="#FFFFFF">${xmlEsc(truncate(d2?.label || "—", 16))} · ${d2 ? fmtPct(d2.pct) : "0%"}</text>
  <text x="624" y="418" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="14" fill="#EAF2FF">${d2 ? `${d2.count} ehtiyoj` : ""}</text>
  <text x="624" y="450" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="16" font-weight="700" fill="#FFFFFF">${xmlEsc(truncate(d3?.label || "—", 16))} · ${d3 ? fmtPct(d3.pct) : "0%"}</text>

  <!-- Analysis + districts -->
  <rect x="24" y="490" width="420" height="280" rx="16" fill="#FFFFFF"/>
  <circle cx="44" cy="518" r="5" fill="#0B5FFF"/>
  <text x="58" y="524" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="17" font-weight="700" fill="#0A2540">Tahlillar</text>
  ${analysisSvg}
  <text x="48" y="660" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="13" fill="#64748B">Yollash ${report.needHireCount} · Qidiruv ${report.searchingCount} · Kritik ${krit}</text>
  <text x="48" y="700" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="28" font-weight="800" fill="#0B5FFF">${d1 ? fmtPct(d1.pct) : "0%"}</text>
  <text x="48" y="726" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="13" fill="#64748B">top tuman ulushi</text>

  <rect x="460" y="490" width="416" height="280" rx="16" fill="#FFFFFF"/>
  <text x="480" y="524" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="17" font-weight="700" fill="#0A2540">Tumanlar ulushi</text>
  ${legendSvg || `<text x="480" y="560" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="14" fill="#64748B">Ehtiyoj yo'q</text>`}

  <!-- Shifts -->
  <rect x="24" y="786" width="852" height="180" rx="16" fill="#FFFFFF"/>
  <text x="48" y="816" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="17" font-weight="700" fill="#0A2540">Smena bo'yicha</text>
  ${shiftSvg || `<text x="48" y="860" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="14" fill="#64748B">Smena ehtiyoji yo'q</text>`}

  <!-- Critical list preview -->
  <rect x="24" y="982" width="852" height="180" rx="16" fill="#FFFFFF"/>
  <text x="48" y="1012" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="17" font-weight="700" fill="#0A2540">Eng uzoq ochiq (top 5)</text>
  ${
    report.critical.slice(0, 5)
      .map((it, i) => {
        const y = 1040 + i * 22;
        return `<text x="48" y="${y}" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="13" fill="#0A2540">${i + 1}. ${xmlEsc(truncate(it.branch, 22))} · ${xmlEsc(it.roleLabel)} · ${xmlEsc(it.shift)} · ${it.daysOpen} kun · ${xmlEsc(it.statusLabel)}</text>`;
      })
      .join("\n") ||
    `<text x="48" y="1048" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="14" fill="#64748B">Ochiq ehtiyoj yo'q</text>`
  }

  <text x="48" y="1185" font-family="DejaVu Sans,Arial,Helvetica,sans-serif" font-size="12" fill="#64748B">Vaksina HR · Real-time · Excelda to'liq · Bo'shatilgan yo'q</text>
</svg>`;
}

/* ── Pure PNG fallback (katta shrift) ─────────────────────── */

type RGB = [number, number, number];

const FONT_5X7: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  "-": [0, 0, 0, 31, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0, 4],
  "/": [1, 2, 4, 8, 16, 0, 0],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [30, 1, 1, 14, 1, 1, 30],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [14, 16, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 1, 14],
  ":": [0, 4, 0, 0, 4, 0, 0],
  "%": [25, 26, 2, 4, 8, 11, 19],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [1, 1, 1, 1, 17, 17, 14],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  a: [0, 0, 14, 1, 15, 17, 15],
  b: [16, 16, 30, 17, 17, 17, 30],
  c: [0, 0, 14, 17, 16, 17, 14],
  d: [1, 1, 15, 17, 17, 17, 15],
  e: [0, 0, 14, 17, 31, 16, 14],
  f: [6, 8, 8, 28, 8, 8, 8],
  g: [0, 0, 15, 17, 15, 1, 14],
  h: [16, 16, 30, 17, 17, 17, 17],
  i: [4, 0, 12, 4, 4, 4, 14],
  j: [2, 0, 6, 2, 2, 18, 12],
  k: [16, 16, 18, 20, 24, 20, 18],
  l: [12, 4, 4, 4, 4, 4, 14],
  m: [0, 0, 26, 21, 21, 17, 17],
  n: [0, 0, 30, 17, 17, 17, 17],
  o: [0, 0, 14, 17, 17, 17, 14],
  p: [0, 0, 30, 17, 30, 16, 16],
  q: [0, 0, 15, 17, 15, 1, 1],
  r: [0, 0, 22, 25, 16, 16, 16],
  s: [0, 0, 15, 16, 14, 1, 30],
  t: [8, 8, 28, 8, 8, 8, 6],
  u: [0, 0, 17, 17, 17, 17, 15],
  v: [0, 0, 17, 17, 17, 10, 4],
  w: [0, 0, 17, 17, 21, 21, 10],
  x: [0, 0, 17, 10, 4, 10, 17],
  y: [0, 0, 17, 17, 15, 1, 14],
  z: [0, 0, 31, 2, 4, 8, 31],
  "'": [4, 4, 0, 0, 0, 0, 0],
  ",": [0, 0, 0, 0, 4, 4, 8],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
};

function normalizeChar(ch: string): string {
  const map: Record<string, string> = {
    "ʻ": "'", "ʼ": "'", "‘": "'", "’": "'", "—": "-", "–": "-", "…": ".",
    "ö": "o", "Ö": "O", "ü": "u", "Ü": "U", "ğ": "g", "Ğ": "G", "ş": "s", "Ş": "S",
  };
  return map[ch] || ch;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = deflateSync(raw, { level: 6 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

class Canvas {
  w: number;
  h: number;
  buf: Buffer;
  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.buf = Buffer.alloc(w * h * 4);
    this.fill(0, 0, w, h, bg);
  }
  private set(x: number, y: number, c: RGB) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.buf[i] = c[0];
    this.buf[i + 1] = c[1];
    this.buf[i + 2] = c[2];
    this.buf[i + 3] = 255;
  }
  fill(x: number, y: number, w: number, h: number, c: RGB) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c);
  }
  roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB) {
    const rr = Math.min(r, w / 2, h / 2);
    this.fill(x + rr, y, w - 2 * rr, h, c);
    this.fill(x, y + rr, w, h - 2 * rr, c);
    this.fill(x, y, rr, rr, c);
    this.fill(x + w - rr, y, rr, rr, c);
    this.fill(x, y + h - rr, rr, rr, c);
    this.fill(x + w - rr, y + h - rr, rr, rr, c);
  }
  text(x: number, y: number, str: string, c: RGB, scale = 3) {
    let cx = Math.floor(x);
    const cy = Math.floor(y);
    for (const raw of str) {
      const ch = normalizeChar(raw);
      const glyph = FONT_5X7[ch] || FONT_5X7[ch.toUpperCase()] || FONT_5X7["."];
      if (!glyph) {
        cx += 6 * scale;
        continue;
      }
      for (let row = 0; row < 7; row++) {
        const bits = glyph[row]!;
        for (let col = 0; col < 5; col++) {
          if (bits & (16 >> col)) {
            for (let sy = 0; sy < scale; sy++)
              for (let sx = 0; sx < scale; sx++)
                this.set(cx + col * scale + sx, cy + row * scale + sy, c);
          }
        }
      }
      cx += 6 * scale;
    }
  }
  toPng(): Buffer {
    return encodePng(this.w, this.h, this.buf);
  }
}

function hex(c: string): RGB {
  const h = c.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Fallback — kattaroq shrift, zich kartalar, bo'shatilgan yo'q */
export function renderStaffingMonitorPngPure(report: StaffingMonitorReport): Buffer {
  const W = 900;
  const H = 1200;
  const cv = new Canvas(W, H, hex("#E8EEF7"));
  const white: RGB = [255, 255, 255];
  const dark: RGB = [10, 37, 64];
  const muted: RGB = [100, 116, 139];
  const d1 = report.byDistrict[0];
  const d2 = report.byDistrict[1];
  const s1 = report.topShift;
  const krit = kritCount(report);
  const high = highCount(report);
  const roleFarm = report.byRole.find((r) => /farmasevt/i.test(r.label));
  const roleMudir = report.byRole.find((r) => /mudir/i.test(r.label));
  const roleStaj = report.byRole.find((r) => /stajyor/i.test(r.label));

  cv.roundRect(24, 24, 852, 160, 20, hex("#0B5FFF"));
  cv.text(48, 48, "Xodim ehtiyoji", white, 4);
  cv.text(48, 90, `${report.generatedAtLabel}`, hex("#D6E4FF"), 2);
  cv.text(48, 125, String(report.totalNeeds), white, 6);
  cv.text(200, 145, "ochiq (boshatsiz)", hex("#C7D7FF"), 2);

  cv.roundRect(520, 44, 160, 56, 12, hex("#3D7EFF"));
  cv.text(532, 54, "Filial", white, 2);
  cv.text(532, 78, `${report.gapBranches}/${report.totalBranches}`, white, 3);

  cv.roundRect(696, 44, 160, 56, 12, hex("#3D7EFF"));
  cv.text(708, 54, "Toliq OK", white, 2);
  cv.text(708, 78, String(report.okBranches), white, 3);

  cv.roundRect(520, 112, 100, 56, 10, hex("#3D7EFF"));
  cv.text(532, 122, "Yollash", white, 2);
  cv.text(532, 146, String(report.needHireCount), white, 3);

  cv.roundRect(636, 112, 100, 56, 10, hex("#3D7EFF"));
  cv.text(648, 122, "Qidiruv", white, 2);
  cv.text(648, 146, String(report.searchingCount), white, 3);

  cv.roundRect(752, 112, 104, 56, 10, hex("#DC2626"));
  cv.text(764, 122, "Kritik", white, 2);
  cv.text(764, 146, String(krit), white, 3);

  // KPI
  cv.roundRect(24, 204, 210, 90, 14, hex("#1A73E8"));
  cv.text(40, 220, "Kritik 30+kun", white, 2);
  cv.text(40, 252, String(krit), white, 4);

  cv.roundRect(246, 204, 210, 90, 14, hex("#F97316"));
  cv.text(262, 220, "Yuqori 14+kun", white, 2);
  cv.text(262, 252, String(high), white, 4);

  cv.roundRect(468, 204, 210, 90, 14, hex("#0EA5E9"));
  cv.text(484, 220, "Top smena", white, 2);
  cv.text(484, 252, truncate(s1?.label || "-", 12), white, 3);

  cv.roundRect(690, 204, 186, 90, 14, hex("#6366F1"));
  cv.text(704, 220, "Top tuman", white, 2);
  cv.text(704, 252, truncate(d1?.label || "-", 10), white, 3);

  // Roles + districts
  cv.roundRect(24, 312, 280, 160, 14, white);
  cv.text(40, 332, "Lavozimlar", dark, 3);
  cv.text(40, 372, `Farmasevt ${roleFarm?.count ?? 0}`, dark, 2);
  cv.text(40, 404, `Mudir ${roleMudir?.count ?? 0}`, dark, 2);
  cv.text(40, 436, `Stajyor ${roleStaj?.count ?? 0}`, dark, 2);

  cv.roundRect(316, 312, 280, 160, 14, hex("#1A73E8"));
  cv.text(332, 332, "1-orin tuman", hex("#E8F0FF"), 2);
  cv.text(332, 368, truncate(d1?.label || "-", 14), white, 3);
  cv.text(332, 416, d1 ? fmtPct(d1.pct) : "0%", white, 5);

  cv.roundRect(608, 312, 268, 160, 14, hex("#5BA0FF"));
  cv.text(624, 332, "2-orin tuman", hex("#E8F0FF"), 2);
  cv.text(624, 368, truncate(d2?.label || "-", 14), white, 3);
  cv.text(624, 416, d2 ? fmtPct(d2.pct) : "0%", white, 5);

  cv.roundRect(24, 492, 420, 260, 14, white);
  cv.text(40, 512, "Tahlillar", dark, 3);
  wrapLines(report.analysisLine, 26).forEach((line, i) => {
    cv.text(40, 552 + i * 28, line, hex("#334155"), 2);
  });
  cv.text(40, 680, `Yollash ${report.needHireCount}  Qidiruv ${report.searchingCount}`, muted, 2);
  cv.text(40, 712, d1 ? `TOP ${fmtPct(d1.pct)}` : "0%", hex("#0B5FFF"), 3);

  cv.roundRect(460, 492, 416, 260, 14, white);
  cv.text(480, 512, "Tumanlar", dark, 3);
  report.byDistrict.slice(0, 7).forEach((d, i) => {
    const y = 552 + i * 28;
    cv.roundRect(480, y, 12, 12, 2, hex(DOT[i % DOT.length]!));
    cv.text(500, y, `${truncate(d.label, 14)} ${d.count} ${fmtPct(d.pct)}`, dark, 2);
  });

  cv.roundRect(24, 772, 852, 180, 14, white);
  cv.text(40, 792, "Smena boyicha", dark, 3);
  report.byShift.slice(0, 4).forEach((s, i) => {
    const y = 832 + i * 30;
    const barW = Math.max(20, Math.round((s.pct / 100) * 400));
    cv.roundRect(40, y, barW, 18, 6, hex(i === 0 ? "#0B5FFF" : "#8BBCFF"));
    cv.text(460, y, `${truncate(s.label, 14)} ${s.count}`, dark, 2);
  });

  cv.roundRect(24, 972, 852, 180, 14, white);
  cv.text(40, 992, "Eng uzoq ochiq", dark, 3);
  report.critical.slice(0, 5).forEach((it, i) => {
    cv.text(
      40,
      1032 + i * 24,
      `${i + 1}. ${truncate(it.branch, 18)} ${it.roleLabel} ${it.daysOpen}k`,
      dark,
      2,
    );
  });

  cv.text(40, 1175, "Vaksina HR · Excel to'liq · Boshatsiz", muted, 2);
  return cv.toPng();
}

export async function renderStaffingMonitorPng(report: StaffingMonitorReport): Promise<Buffer> {
  // Avvalo sharp+SVG — o‘qiladigan shrift
  try {
    const svg = buildStaffingMonitorSvg(report);
    const mod = await import("sharp");
    const sharpFn = (mod as { default: (i: Buffer, o?: { density?: number }) => { png: (o?: object) => { toBuffer: () => Promise<Buffer> } } }).default;
    const buf = await sharpFn(Buffer.from(svg), { density: 160 }).png().toBuffer();
    if (buf?.length > 1000) return buf;
  } catch (err) {
    console.error("[monitor-png] sharp failed, pure fallback", err);
  }
  return renderStaffingMonitorPngPure(report);
}
