/** QR PNG/PDF — local `qrcode` package. */

import QRCode from "qrcode";

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function renderQrToCanvas(canvas: HTMLCanvasElement, text: string, size = 280): Promise<void> {
  if (!text?.trim()) throw new Error("QR matn bo‘sh");
  await QRCode.toCanvas(canvas, text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0b3a5c", light: "#ffffff" },
  });
}

export async function qrPngDataUrl(text: string, size = 512): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0b3a5c", light: "#ffffff" },
  });
}

export async function downloadQrPng(text: string, filename: string) {
  const url = await qrPngDataUrl(text);
  downloadDataUrl(url, filename);
}

export async function downloadQrPdf(text: string, title: string, _filename: string) {
  const png = await qrPngDataUrl(text, 480);
  const w = window.open("", "_blank", "noopener,noreferrer,width=640,height=800");
  if (!w) throw new Error("Popup bloklangan — PNG yuklab oling");
  const safeTitle = title.replace(/[<>&]/g, "");
  w.document.write(`<!doctype html><html><head><title>${safeTitle}</title>
    <style>
      body{font-family:system-ui,sans-serif;text-align:center;padding:32px;color:#0b3a5c}
      img{width:360px;height:360px;border:1px solid #e2e8f0;border-radius:16px}
      h1{font-size:20px;margin:0 0 8px} p{font-size:13px;color:#64748b}
      @media print{button{display:none}}
    </style></head><body>
    <h1>${safeTitle}</h1>
    <p>VAKSINA MED · Davomat QR</p>
    <img src="${png}" alt="QR" />
    <p style="margin-top:16px;font-size:11px;color:#64748b">Chop etish → PDF sifatida saqlang</p>
    <button onclick="window.print()" style="margin-top:20px;padding:10px 18px;border-radius:10px;border:0;background:#0b3a5c;color:#fff;cursor:pointer">PDF / Chop etish</button>
    </body></html>`);
  w.document.close();
}
