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

function wrapAnalysis(text: string, maxLen = 42): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxLen && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

const DOT = ["#0B5FFF", "#3D7EFF", "#5BA0FF", "#8BBCFF", "#A8C8FF", "#C7D7FF"];

/** Bank-style monitoring SVG (sharp bo‘lsa) */
export function buildStaffingMonitorSvg(report: StaffingMonitorReport): string {
  const d1 = report.byDistrict[0];
  const d2 = report.byDistrict[1];
  const s1 = report.topShift;
  const legend = report.byDistrict.slice(0, 6);
  const shifts = report.byShift.slice(0, 4);
  const analysis = wrapAnalysis(report.analysisLine);

  const pieA = d1 ? Math.max(10, Math.min(340, (d1.pct / 100) * 340)) : 0;
  const pieDash = `${pieA.toFixed(1)} 360`;

  const analysisSvg = analysis
    .map(
      (line, i) =>
        `<text x="48" y="${568 + i * 26}" font-family="Arial,sans-serif" font-size="17" fill="#334155">${xmlEsc(line)}</text>`,
    )
    .join("\n");

  const legendSvg = legend.length
    ? legend
        .map((d, i) => {
          const y = 568 + i * 34;
          return `
      <circle cx="476" cy="${y - 5}" r="6" fill="${DOT[i] || "#A8C8FF"}"/>
      <text x="494" y="${y}" font-family="Arial,sans-serif" font-size="17" fill="#0A2540">${xmlEsc(truncate(d.label, 18))}</text>
      <text x="820" y="${y}" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#0A2540" text-anchor="end">${fmtPct(d.pct)}</text>`;
        })
        .join("")
    : `<text x="476" y="600" font-family="Arial,sans-serif" font-size="16" fill="#64748B">Ehtiyoj yo'q</text>`;

  const shiftSvg = shifts.length
    ? shifts
        .map((s, i) => {
          const barW = Math.max(24, Math.round((s.pct / 100) * 500));
          const y = 870 + i * 42;
          return `
    <rect x="52" y="${y}" width="${barW}" height="26" rx="8" fill="${i === 0 ? "#0B5FFF" : "#8BBCFF"}"/>
    <text x="570" y="${y + 19}" font-family="Arial,sans-serif" font-size="16" fill="#0A2540">${xmlEsc(truncate(s.label, 18))} — ${s.count} (${fmtPct(s.pct)})</text>`;
        })
        .join("")
    : `<text x="52" y="910" font-family="Arial,sans-serif" font-size="16" fill="#64748B">Smena ehtiyoji yo'q</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="880" height="1100" viewBox="0 0 880 1100">
  <rect width="880" height="1100" fill="#E8EEF7"/>
  <rect x="28" y="28" width="824" height="200" rx="28" fill="#0B5FFF"/>
  <text x="56" y="78" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#FFFFFF">Xodim ehtiyoji</text>
  <text x="56" y="112" font-family="Arial,sans-serif" font-size="16" fill="#D6E4FF">${xmlEsc(report.generatedAtLabel)} · Toshkent</text>
  <text x="56" y="178" font-family="Arial,sans-serif" font-size="56" font-weight="800" fill="#FFFFFF">${report.totalNeeds}</text>
  <text x="56" y="208" font-family="Arial,sans-serif" font-size="15" fill="#C7D7FF">ochiq ehtiyoj</text>
  <rect x="560" y="58" width="260" height="88" rx="18" fill="#FFFFFF" fill-opacity="0.16"/>
  <text x="580" y="92" font-family="Arial,sans-serif" font-size="14" fill="#E8F0FF">Ehtiyojli filial</text>
  <text x="580" y="128" font-family="Arial,sans-serif" font-size="36" font-weight="800" fill="#FFFFFF">${report.gapBranches}</text>
  <text x="680" y="128" font-family="Arial,sans-serif" font-size="18" fill="#D6E4FF">/ ${report.totalBranches}</text>
  <rect x="560" y="158" width="124" height="48" rx="12" fill="#FFFFFF" fill-opacity="0.14"/>
  <text x="572" y="178" font-family="Arial,sans-serif" font-size="12" fill="#D6E4FF">Qidiruv</text>
  <text x="572" y="198" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">${report.searchingCount}</text>
  <rect x="696" y="158" width="124" height="48" rx="12" fill="#FFFFFF" fill-opacity="0.14"/>
  <text x="708" y="178" font-family="Arial,sans-serif" font-size="12" fill="#D6E4FF">To'liq OK</text>
  <text x="708" y="198" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">${report.okBranches}</text>
  <rect x="28" y="252" width="400" height="220" rx="24" fill="#1A73E8"/>
  <text x="52" y="292" font-family="Arial,sans-serif" font-size="18" fill="#E8F0FF">Eng yuklangan tuman</text>
  <text x="52" y="328" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#FFFFFF">${xmlEsc(truncate(d1?.label || "—", 22))}</text>
  <text x="52" y="368" font-family="Arial,sans-serif" font-size="20" fill="#D6E4FF">${d1 ? `${d1.count} ehtiyoj` : "0"}</text>
  <text x="52" y="430" font-family="Arial,sans-serif" font-size="64" font-weight="800" fill="#FFFFFF">${d1 ? fmtPct(d1.pct) : "0%"}</text>
  <rect x="452" y="252" width="400" height="220" rx="24" fill="#5BA0FF"/>
  <text x="476" y="292" font-family="Arial,sans-serif" font-size="18" fill="#E8F0FF">${d2 ? "2-o'rin tuman" : "Eng kerakli smena"}</text>
  <text x="476" y="328" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#FFFFFF">${xmlEsc(truncate(d2?.label || s1?.label || "—", 22))}</text>
  <text x="476" y="368" font-family="Arial,sans-serif" font-size="20" fill="#EAF2FF">${d2 ? `${d2.count} ehtiyoj` : s1 ? `${s1.count} ehtiyoj` : "0"}</text>
  <text x="476" y="430" font-family="Arial,sans-serif" font-size="64" font-weight="800" fill="#FFFFFF">${d2 ? fmtPct(d2.pct) : s1 ? fmtPct(s1.pct) : "0%"}</text>
  <rect x="28" y="496" width="400" height="280" rx="24" fill="#FFFFFF"/>
  <circle cx="52" cy="528" r="6" fill="#0B5FFF"/>
  <text x="68" y="534" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#0A2540">Tahlillar</text>
  ${analysisSvg}
  <circle cx="200" cy="720" r="52" fill="none" stroke="#E2E8F0" stroke-width="16"/>
  <circle cx="200" cy="720" r="52" fill="none" stroke="#0B5FFF" stroke-width="16"
    stroke-dasharray="${pieDash}" stroke-linecap="round" transform="rotate(-90 200 720)"/>
  <text x="200" y="726" font-family="Arial,sans-serif" font-size="18" font-weight="800" fill="#0A2540" text-anchor="middle">${d1 ? fmtPct(d1.pct) : "0%"}</text>
  <rect x="452" y="496" width="400" height="280" rx="24" fill="#FFFFFF"/>
  <text x="476" y="534" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#0A2540">Tumanlar ulushi</text>
  ${legendSvg}
  <rect x="28" y="800" width="824" height="260" rx="24" fill="#FFFFFF"/>
  <text x="52" y="844" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#0A2540">Smena bo'yicha</text>
  ${shiftSvg}
  <text x="52" y="1035" font-family="Arial,sans-serif" font-size="13" fill="#64748B">Vaksina HR · Real-time staffing</text>
</svg>`;
}

/* ── Pure PNG (sharp yo‘q / Vercel) ───────────────────────── */

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
  "‘": [4, 4, 0, 0, 0, 0, 0],
  "’": [4, 4, 0, 0, 0, 0, 0],
  "·": [0, 0, 4, 0, 0, 0, 0],
  ",": [0, 0, 0, 0, 4, 4, 8],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
};

function normalizeChar(ch: string): string {
  const map: Record<string, string> = {
    "ʻ": "'",
    "ʼ": "'",
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "—": "-",
    "–": "-",
    "…": ".",
    "ö": "o",
    "Ö": "O",
    "ü": "u",
    "Ü": "U",
    "ğ": "g",
    "Ğ": "G",
    "ş": "s",
    "Ş": "S",
    "ç": "c",
    "Ç": "C",
    "ñ": "n",
    о: "o",
    а: "a",
    е: "e",
    с: "c",
    р: "p",
    у: "y",
    х: "x",
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
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
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

  constructor(w: number, h: number, bg: RGB = [232, 238, 247]) {
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
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c);
    }
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB) {
    const rr = Math.min(r, w / 2, h / 2);
    this.fill(x + rr, y, w - 2 * rr, h, c);
    this.fill(x, y + rr, w, h - 2 * rr, c);
    // corners (approx boxes)
    this.fill(x, y, rr, rr, c);
    this.fill(x + w - rr, y, rr, rr, c);
    this.fill(x, y + h - rr, rr, rr, c);
    this.fill(x + w - rr, y + h - rr, rr, rr, c);
  }

  text(x: number, y: number, str: string, c: RGB, scale = 2) {
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
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                this.set(cx + col * scale + sx, cy + row * scale + sy, c);
              }
            }
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

/** Sharp kerak emas — Vercelda ishonchli PNG */
export function renderStaffingMonitorPngPure(report: StaffingMonitorReport): Buffer {
  const W = 880;
  const H = 1100;
  const cv = new Canvas(W, H, hex("#E8EEF7"));
  const white: RGB = [255, 255, 255];
  const dark: RGB = [10, 37, 64];
  const muted: RGB = [100, 116, 139];
  const d1 = report.byDistrict[0];
  const d2 = report.byDistrict[1];
  const s1 = report.topShift;

  // Header
  cv.roundRect(28, 28, 824, 200, 24, hex("#0B5FFF"));
  cv.text(56, 58, "Xodim ehtiyoji", white, 3);
  cv.text(56, 100, `${report.generatedAtLabel} · Toshkent`, hex("#D6E4FF"), 2);
  cv.text(56, 145, String(report.totalNeeds), white, 6);
  cv.text(56, 195, "ochiq ehtiyoj", hex("#C7D7FF"), 2);

  cv.roundRect(560, 58, 260, 88, 16, hex("#3D7EFF"));
  cv.text(580, 72, "Ehtiyojli filial", white, 2);
  cv.text(580, 105, `${report.gapBranches} / ${report.totalBranches}`, white, 3);

  cv.roundRect(560, 158, 124, 48, 12, hex("#3D7EFF"));
  cv.text(572, 168, "Qidiruv", white, 1);
  cv.text(572, 186, String(report.searchingCount), white, 2);

  cv.roundRect(696, 158, 124, 48, 12, hex("#3D7EFF"));
  cv.text(708, 168, "Toliq OK", white, 1);
  cv.text(708, 186, String(report.okBranches), white, 2);

  // Mid cards
  cv.roundRect(28, 252, 400, 220, 20, hex("#1A73E8"));
  cv.text(52, 272, "Eng yuklangan tuman", hex("#E8F0FF"), 2);
  cv.text(52, 310, truncate(d1?.label || "-", 20), white, 3);
  cv.text(52, 355, d1 ? `${d1.count} ehtiyoj` : "0", hex("#D6E4FF"), 2);
  cv.text(52, 400, d1 ? fmtPct(d1.pct) : "0%", white, 5);

  cv.roundRect(452, 252, 400, 220, 20, hex("#5BA0FF"));
  cv.text(476, 272, d2 ? "2-orin tuman" : "Eng kerakli smena", hex("#E8F0FF"), 2);
  cv.text(476, 310, truncate(d2?.label || s1?.label || "-", 20), white, 3);
  cv.text(476, 355, d2 ? `${d2.count} ehtiyoj` : s1 ? `${s1.count} ehtiyoj` : "0", hex("#EAF2FF"), 2);
  cv.text(476, 400, d2 ? fmtPct(d2.pct) : s1 ? fmtPct(s1.pct) : "0%", white, 5);

  // Analysis
  cv.roundRect(28, 496, 400, 280, 20, white);
  cv.text(52, 520, "Tahlillar", dark, 2);
  wrapAnalysis(report.analysisLine, 28).forEach((line, i) => {
    cv.text(48, 560 + i * 28, line, hex("#334155"), 2);
  });
  cv.text(48, 700, d1 ? `Top: ${fmtPct(d1.pct)}` : "0%", hex("#0B5FFF"), 3);

  // Legend
  cv.roundRect(452, 496, 400, 280, 20, white);
  cv.text(476, 520, "Tumanlar ulushi", dark, 2);
  report.byDistrict.slice(0, 6).forEach((d, i) => {
    const y = 560 + i * 32;
    cv.roundRect(476, y, 12, 12, 3, hex(DOT[i] || "#A8C8FF"));
    cv.text(500, y, truncate(d.label, 16), dark, 2);
    cv.text(760, y, fmtPct(d.pct), dark, 2);
  });

  // Shifts
  cv.roundRect(28, 800, 824, 260, 20, white);
  cv.text(52, 824, "Smena boyicha", dark, 2);
  report.byShift.slice(0, 4).forEach((s, i) => {
    const y = 870 + i * 42;
    const barW = Math.max(24, Math.round((s.pct / 100) * 480));
    cv.roundRect(52, y, barW, 24, 8, hex(i === 0 ? "#0B5FFF" : "#8BBCFF"));
    cv.text(550, y + 4, `${truncate(s.label, 14)} ${s.count} (${fmtPct(s.pct)})`, dark, 2);
  });

  cv.text(52, 1040, "Vaksina HR · Real-time · Ma'lumot", muted, 2);
  cv.text(52, 1065, `Yollash ${report.needHireCount} · Qidiruv ${report.searchingCount}`, muted, 2);

  return cv.toPng();
}

export async function renderStaffingMonitorPng(report: StaffingMonitorReport): Promise<Buffer> {
  // Avvalo pure PNG — Vercel serverlessda sharp ko‘pincha yo‘q / xato
  try {
    const pure = renderStaffingMonitorPngPure(report);
    if (pure?.length > 500) return pure;
  } catch (err) {
    console.error("[monitor-png] pure failed", err);
  }
  try {
    const svg = buildStaffingMonitorSvg(report);
    const mod = await import("sharp");
    const sharpFn = (mod as { default: (i: Buffer, o?: { density?: number }) => { png: (o?: object) => { toBuffer: () => Promise<Buffer> } } }).default;
    return await sharpFn(Buffer.from(svg), { density: 140 }).png().toBuffer();
  } catch (err) {
    console.error("[monitor-png] sharp failed", err);
    return renderStaffingMonitorPngPure(report);
  }
}
