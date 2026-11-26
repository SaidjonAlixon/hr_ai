/** Open API to‘liq qo‘llanma — Word (.doc) yuklab olish */

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
