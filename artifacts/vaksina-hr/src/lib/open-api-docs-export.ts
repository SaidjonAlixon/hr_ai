/** Open API to‘liq qo‘llanma — Word (.doc) va PDF yuklab olish */

import { jsPDF } from "jspdf";
import { buildFullDocText } from "./open-api-docs-content";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function downloadOpenApiWordDoc(origin = window.location.origin) {
  const generatedAt = new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
  const text = buildFullDocText({ origin, generatedAt });
  const paragraphs = text
    .split("\n")
    .map((line) => {
      const t = escHtml(line);
      if (!line.trim()) return "<p style='margin:6pt 0'>&nbsp;</p>";
      if (line.startsWith("VAKSINA HR")) {
        return `<h1 style="font-family:Segoe UI,Arial;font-size:18pt;color:#2e1065;margin:0 0 8pt">${t}</h1>`;
      }
      if (/^\d+\.\s/.test(line) && line.length < 70 && !line.includes("→") && !line.includes("http")) {
        return `<h2 style="font-family:Segoe UI,Arial;font-size:14pt;color:#4c1d95;margin:14pt 0 6pt">${t}</h2>`;
      }
      if (line.startsWith("GET /")) {
        return `<h3 style="font-family:Consolas,monospace;font-size:11pt;color:#5b21b6;margin:10pt 0 4pt">${t}</h3>`;
      }
      if (line.startsWith("  ") || line.startsWith("    ")) {
        return `<p style="font-family:Consolas,monospace;font-size:9.5pt;margin:2pt 0;white-space:pre-wrap">${t}</p>`;
      }
      return `<p style="font-family:Segoe UI,Arial;font-size:11pt;margin:4pt 0;line-height:1.45">${t}</p>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:w="urn:schemas-microsoft-com:office:word"
 xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>VAKSINA Open API qo‘llanma</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; }
  @page { size: A4; margin: 2cm; }
</style>
</head>
<body>
${paragraphs}
<p style="margin-top:24pt;font-size:9pt;color:#666">© VAKSINA HR · Read-only Open API</p>
</body>
</html>`;

  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  downloadBlob(`VAKSINA_Open_API_qollanma_${stamp()}.doc`, blob);
}

export async function downloadOpenApiPdf(origin = window.location.origin) {
  const generatedAt = new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
  const text = buildFullDocText({ origin, generatedAt });
  const lines = text.split("\n");

  const pageW = 794; // A4 ~96dpi
  const pageH = 1123;
  const margin = 48;
  const lineH = 18;
  const maxW = pageW - margin * 2;
  const font =
    '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

  const pages: HTMLCanvasElement[] = [];
  let canvas = document.createElement("canvas");
  canvas.width = pageW;
  canvas.height = pageH;
  let ctx = canvas.getContext("2d")!;
  const paintBg = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageW, pageH);
    ctx.fillStyle = "#6b2d91";
    ctx.fillRect(0, 0, pageW, 8);
  };
  paintBg();
  let y = margin + 8;

  const newPage = () => {
    pages.push(canvas);
    canvas = document.createElement("canvas");
    canvas.width = pageW;
    canvas.height = pageH;
    ctx = canvas.getContext("2d")!;
    paintBg();
    y = margin;
  };

  const wrap = (raw: string, size: number, bold = false): string[] => {
    ctx.font = `${bold ? "700" : "400"} ${size}px ${font}`;
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width <= maxW) cur = test;
      else {
        if (cur) out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
    return out;
  };

  for (const line of lines) {
    const isTitle = line.startsWith("VAKSINA HR");
    const isH2 = /^\d+\.\s/.test(line) && line.length < 60;
    const isCode = line.startsWith("  ") || line.startsWith("GET /");
    const size = isTitle ? 18 : isH2 ? 13 : isCode ? 10 : 11;
    const bold = isTitle || isH2;
    const color = isTitle || isH2 ? "#4c1d95" : isCode ? "#1e293b" : "#0f172a";
    const chunks = wrap(line || " ", size, bold);
    for (const chunk of chunks) {
      if (y + lineH > pageH - margin) newPage();
      ctx.font = `${bold ? "700" : "400"} ${size}px ${font}`;
      ctx.fillStyle = color;
      ctx.fillText(chunk, margin, y);
      y += lineH + (isH2 ? 4 : 0);
    }
    if (!line.trim()) y += 6;
  }
  pages.push(canvas);

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pdfW = pdf.internal.pageSize.getWidth();
  const pdfH = pdf.internal.pageSize.getHeight();
  pages.forEach((c, i) => {
    if (i > 0) pdf.addPage();
    pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pdfW, pdfH);
  });
  pdf.save(`VAKSINA_Open_API_qollanma_${stamp()}.pdf`);
}
