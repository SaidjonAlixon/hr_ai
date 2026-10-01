/** Ekrandagi A4 listlarni o‘sha ko‘rinishda PDF qiladi. */
import { jsPDF } from "jspdf";
import { domToCanvas } from "modern-screenshot";
import { deliverFile } from "./tg-download";
import type { XodimReport } from "./xodim-hisobot-api";
import type { XodimSealView } from "../pages/admin/xodim-hisobot-sheet";

async function paintPage(page: HTMLElement) {
  return domToCanvas(page, {
    scale: 2,
    backgroundColor: "#ffffff",
    fetch: {
      requestInit: { credentials: "include", cache: "force-cache" },
    },
  });
}

function sliceCanvas(source: HTMLCanvasElement, offset: number, height: number) {
  const slice = document.createElement("canvas");
  slice.width = source.width;
  slice.height = height;
  const ctx = slice.getContext("2d");
  if (!ctx) throw new Error("Canvas ishlamaydi");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, slice.width, slice.height);
  ctx.drawImage(source, 0, offset, source.width, height, 0, 0, source.width, height);
  return slice;
}

export async function downloadPagesPdf(root: HTMLElement, fileName: string) {
  const pages = [...root.querySelectorAll<HTMLElement>("[data-hisobot-page]")];
  if (!pages.length) throw new Error("Hisobot hali chiqmagan");
  if (document.fonts?.ready) await document.fonts.ready;

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = 210;
  const pageH = 297;

  for (let i = 0; i < pages.length; i += 1) {
    const canvas = await paintPage(pages[i]!);
    const naturalH = (canvas.height / canvas.width) * pageW;
    if (i > 0) pdf.addPage();
    if (naturalH <= pageH + 1) {
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, Math.min(pageH, naturalH));
      continue;
    }
    const slicePx = Math.max(1, Math.round(canvas.width * (pageH / pageW)));
    let offset = 0;
    let part = 0;
    while (offset < canvas.height - 1) {
      const height = Math.min(slicePx, canvas.height - offset);
      const slice = sliceCanvas(canvas, offset, height);
      if (part > 0) pdf.addPage();
      const drawH = (height / canvas.width) * pageW;
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, Math.min(pageH, drawH));
      offset += height;
      part += 1;
    }
  }
  await deliverFile(pdf.output("blob"), fileName);
}

export async function downloadXodimHisobotPdf(root: HTMLElement, report: XodimReport, seal: XodimSealView | null) {
  const safe = report.employee.fullName.replace(/[^\w\u0400-\u04FF]+/g, "_").slice(0, 40);
  const stamp = report.to.replace(/-/g, "");
  const prefix = seal ? "Hisobot_VAKSINAMEDHR" : "Xodim_hisoboti";
  await downloadPagesPdf(root, `${prefix}_${safe}_${stamp}.pdf`);
}
