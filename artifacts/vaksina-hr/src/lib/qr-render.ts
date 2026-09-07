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

/**
 * Popup kerak emas: iframe orqali chop etish (PDF saqlash).
 * Qo‘shimcha: HTML fayl ham yuklanadi (zaxira).
 */
function printHtmlAsPdf(html: string, filenameBase: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);

  // Zaxira: HTML yuklab olish (popup bloklanganda ham qoladi)
  downloadDataUrl(blobUrl, `${filenameBase}.html`);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "davomat-qr-print");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    // Brauzer yangi tabda ochishga urinib ko‘radi
    window.location.assign(blobUrl);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const win = iframe.contentWindow;
  const imgs = Array.from(doc.images || []);
  const waitImgs =
    imgs.length === 0
      ? Promise.resolve()
      : Promise.all(
          imgs.map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete) {
                  resolve();
                  return;
                }
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }),
          ),
        );

  void waitImgs.then(() => {
    window.setTimeout(() => {
      try {
        win?.focus();
        win?.print();
      } catch {
        /* print dialog ochilmasa ham HTML yuklangan */
      } finally {
        window.setTimeout(() => {
          iframe.remove();
          URL.revokeObjectURL(blobUrl);
        }, 1500);
      }
    }, 200);
  });
}

export async function downloadQrPdf(text: string, title: string, _filename: string) {
  const png = await qrPngDataUrl(text, 480);
  const safeTitle = title.replace(/[<>&]/g, "");
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${safeTitle}</title>
    <style>
      body{font-family:system-ui,sans-serif;text-align:center;padding:32px;color:#0b3a5c}
      img{width:360px;height:360px;border:1px solid #e2e8f0;border-radius:16px}
      h1{font-size:20px;margin:0 0 8px} p{font-size:13px;color:#64748b}
      @media print{button{display:none}}
    </style></head><body>
    <h1>${safeTitle}</h1>
    <p>VAKSINA MED · Davomat QR</p>
    <img src="${png}" alt="QR" />
    <p style="margin-top:16px;font-size:11px;color:#64748b">Chop etish oynasida «PDF sifatida saqlash» ni tanlang</p>
    </body></html>`;
  printHtmlAsPdf(html, `davomat-qr-${safeTitle.slice(0, 40).replace(/\s+/g, "-") || "branch"}`);
}

export type BulkQrItem = {
  n: number;
  title: string;
  payload: string;
};

const PER_PAGE = 20;

/** Barcha QR lar — har sahifada 20 ta (4×5). Popup shart emas. */
export async function downloadAllQrPdf(items: BulkQrItem[], docTitle = "Davomat QR — barcha filiallar") {
  const list = items.filter((it) => it.payload?.trim());
  if (!list.length) throw new Error("Yuklash uchun faol QR yo‘q");

  const pngs = await Promise.all(
    list.map(async (it) => ({
      ...it,
      png: await qrPngDataUrl(it.payload, 280),
    })),
  );

  const pages: typeof pngs[] = [];
  for (let i = 0; i < pngs.length; i += PER_PAGE) {
    pages.push(pngs.slice(i, i + PER_PAGE));
  }

  const safeDoc = docTitle.replace(/[<>&]/g, "");
  const pagesHtml = pages
    .map((page, pageIdx) => {
      const cells = page
        .map((it) => {
          const safe = `${it.n}. ${it.title}`.replace(/[<>&]/g, "");
          return `<div class="cell">
            <img src="${it.png}" alt="QR ${it.n}" />
            <div class="label">${safe}</div>
          </div>`;
        })
        .join("");
      return `<section class="page">
        <header class="hdr">
          <div>
            <h1>${safeDoc}</h1>
            <p>VAKSINA MED · sahifa ${pageIdx + 1}/${pages.length} · ${list.length} ta QR</p>
          </div>
        </header>
        <div class="grid">${cells}</div>
      </section>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${safeDoc}</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;font-family:system-ui,-apple-system,sans-serif;color:#0b3a5c;background:#fff}
      .page{padding:10mm 8mm;page-break-after:always;break-after:page}
      .page:last-child{page-break-after:auto;break-after:auto}
      .hdr{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;
        padding-bottom:8px;border-bottom:1px solid #e2e8f0}
      .hdr h1{margin:0;font-size:16px}
      .hdr p{margin:4px 0 0;font-size:11px;color:#64748b}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 8px}
      .cell{display:flex;flex-direction:column;align-items:center;text-align:center;
        padding:6px 4px;border:1px solid #e8eef5;border-radius:10px;background:#fafbfc;break-inside:avoid}
      .cell img{width:38mm;height:38mm;object-fit:contain}
      .label{margin-top:4px;font-size:9px;font-weight:600;line-height:1.25;max-width:100%;
        overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      @page{size:A4 portrait;margin:8mm}
    </style></head><body>
    ${pagesHtml}
    </body></html>`;

  printHtmlAsPdf(html, "davomat-qr-barcha");
}
