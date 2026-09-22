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

/** Bank-style monitoring SVG */
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
        `<text x="48" y="${568 + i * 26}" font-family="Segoe UI, Arial, sans-serif" font-size="17" fill="#334155">${xmlEsc(line)}</text>`,
    )
    .join("\n");

  const legendSvg = legend.length
    ? legend
        .map((d, i) => {
          const y = 568 + i * 34;
          return `
      <circle cx="476" cy="${y - 5}" r="6" fill="${DOT[i] || "#A8C8FF"}"/>
      <text x="494" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="17" fill="#0A2540">${xmlEsc(truncate(d.label, 18))}</text>
      <text x="820" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="17" font-weight="700" fill="#0A2540" text-anchor="end">${fmtPct(d.pct)}</text>`;
        })
        .join("")
    : `<text x="476" y="600" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#64748B">Ehtiyoj yo‘q</text>`;

  const shiftSvg = shifts.length
    ? shifts
        .map((s, i) => {
          const barW = Math.max(24, Math.round((s.pct / 100) * 500));
          const y = 870 + i * 42;
          return `
    <rect x="52" y="${y}" width="${barW}" height="26" rx="8" fill="${i === 0 ? "#0B5FFF" : "#8BBCFF"}"/>
    <text x="570" y="${y + 19}" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#0A2540">${xmlEsc(truncate(s.label, 18))} — ${s.count} (${fmtPct(s.pct)})</text>`;
        })
        .join("")
    : `<text x="52" y="910" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#64748B">Smena ehtiyoji yo‘q</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="880" height="1100" viewBox="0 0 880 1100">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F0F6FF"/>
      <stop offset="100%" stop-color="#E8EEF7"/>
    </linearGradient>
    <linearGradient id="cardA" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B5FFF"/>
      <stop offset="100%" stop-color="#0747C2"/>
    </linearGradient>
    <linearGradient id="cardB" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1A73E8"/>
      <stop offset="100%" stop-color="#0B5FFF"/>
    </linearGradient>
    <linearGradient id="cardC" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5BA0FF"/>
      <stop offset="100%" stop-color="#3D7EFF"/>
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0A2540" flood-opacity="0.12"/>
    </filter>
  </defs>

  <rect width="880" height="1100" fill="url(#bg)"/>

  <rect x="28" y="28" width="824" height="200" rx="28" fill="url(#cardA)" filter="url(#shadow)"/>
  <text x="56" y="78" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="700" fill="#FFFFFF">Xodim ehtiyoji</text>
  <text x="56" y="112" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#D6E4FF">${xmlEsc(report.generatedAtLabel)} · Toshkent</text>
  <text x="56" y="178" font-family="Segoe UI, Arial, sans-serif" font-size="56" font-weight="800" fill="#FFFFFF">${report.totalNeeds}</text>
  <text x="56" y="208" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="#C7D7FF">ochiq ehtiyoj</text>

  <rect x="560" y="58" width="260" height="88" rx="18" fill="#FFFFFF" fill-opacity="0.16"/>
  <text x="580" y="92" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#E8F0FF">Ehtiyojli filial</text>
  <text x="580" y="128" font-family="Segoe UI, Arial, sans-serif" font-size="36" font-weight="800" fill="#FFFFFF">${report.gapBranches}</text>
  <text x="680" y="128" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#D6E4FF">/ ${report.totalBranches}</text>

  <rect x="560" y="158" width="124" height="48" rx="12" fill="#FFFFFF" fill-opacity="0.14"/>
  <text x="572" y="178" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#D6E4FF">Qidiruv</text>
  <text x="572" y="198" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">${report.searchingCount}</text>

  <rect x="696" y="158" width="124" height="48" rx="12" fill="#FFFFFF" fill-opacity="0.14"/>
  <text x="708" y="178" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#D6E4FF">To‘liq OK</text>
  <text x="708" y="198" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">${report.okBranches}</text>

  <rect x="28" y="252" width="400" height="220" rx="24" fill="url(#cardB)" filter="url(#shadow)"/>
  <text x="52" y="292" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#E8F0FF">Eng yuklangan tuman</text>
  <text x="52" y="328" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="700" fill="#FFFFFF">${xmlEsc(truncate(d1?.label || "—", 22))}</text>
  <text x="52" y="368" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="#D6E4FF">${d1 ? `${d1.count} ehtiyoj` : "0"}</text>
  <text x="52" y="430" font-family="Segoe UI, Arial, sans-serif" font-size="64" font-weight="800" fill="#FFFFFF">${d1 ? fmtPct(d1.pct) : "0%"}</text>

  <rect x="452" y="252" width="400" height="220" rx="24" fill="url(#cardC)" filter="url(#shadow)"/>
  <text x="476" y="292" font-family="Segoe UI, Arial, sans-serif" font-size="18" fill="#E8F0FF">${d2 ? "2-o‘rin tuman" : "Eng kerakli smena"}</text>
  <text x="476" y="328" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="700" fill="#FFFFFF">${xmlEsc(truncate(d2?.label || s1?.label || "—", 22))}</text>
  <text x="476" y="368" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="#EAF2FF">${d2 ? `${d2.count} ehtiyoj` : s1 ? `${s1.count} ehtiyoj` : "0"}</text>
  <text x="476" y="430" font-family="Segoe UI, Arial, sans-serif" font-size="64" font-weight="800" fill="#FFFFFF">${d2 ? fmtPct(d2.pct) : s1 ? fmtPct(s1.pct) : "0%"}</text>

  <rect x="28" y="496" width="400" height="280" rx="24" fill="#FFFFFF" filter="url(#shadow)"/>
  <circle cx="52" cy="528" r="6" fill="#0B5FFF"/>
  <text x="68" y="534" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" fill="#0A2540">Tahlillar</text>
  ${analysisSvg}
  <circle cx="200" cy="720" r="52" fill="none" stroke="#E2E8F0" stroke-width="16"/>
  <circle cx="200" cy="720" r="52" fill="none" stroke="#0B5FFF" stroke-width="16"
    stroke-dasharray="${pieDash}" stroke-linecap="round" transform="rotate(-90 200 720)"/>
  <text x="200" y="726" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="800" fill="#0A2540" text-anchor="middle">${d1 ? fmtPct(d1.pct) : "0%"}</text>

  <rect x="452" y="496" width="400" height="280" rx="24" fill="#FFFFFF" filter="url(#shadow)"/>
  <text x="476" y="534" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="700" fill="#0A2540">Tumanlar ulushi</text>
  ${legendSvg}

  <rect x="28" y="800" width="824" height="260" rx="24" fill="#FFFFFF" filter="url(#shadow)"/>
  <text x="52" y="844" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" fill="#0A2540">Smena bo‘yicha</text>
  ${shiftSvg}

  <text x="52" y="1035" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="#64748B">Vaksina HR · Aptekalar tarmog‘i · Real-time staffing</text>
  <text x="828" y="1035" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="#94A3B8" text-anchor="end">har 3 soat / Ma’lumot</text>
</svg>`;
}

export async function renderStaffingMonitorPng(report: StaffingMonitorReport): Promise<Buffer> {
  const svg = buildStaffingMonitorSvg(report);
  const mod = await import("sharp");
  const sharpFn = (mod as { default: (i: Buffer, o?: { density?: number }) => { png: (o?: { compressionLevel?: number }) => { toBuffer: () => Promise<Buffer> } } }).default;
  return sharpFn(Buffer.from(svg), { density: 160 }).png({ compressionLevel: 8 }).toBuffer();
}
