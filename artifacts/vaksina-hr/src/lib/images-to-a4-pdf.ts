/**
 * Rasm(lar)ni CamScanner uslubida A4 PDF ga aylantirish.
 */
import {
  autoFitPage,
  enhanceDocument,
  imageDataToCanvas,
  imageToImageData,
  loadImageFromFile,
  pagesToPdfBlob,
  warpToA4,
  defaultCorners,
  detectDocumentCorners,
} from "@/lib/document-scan";

export async function imagesToA4Pdf(
  files: File[],
  filename = "hujjat.pdf",
): Promise<{ blob: Blob; filename: string }> {
  if (!files.length) throw new Error("Rasm tanlanmadi");
  const pages: HTMLCanvasElement[] = [];

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const img = await loadImageFromFile(file);
    const { data } = imageToImageData(img, 1600);
    const corners = detectDocumentCorners(data);
    const warped = warpToA4(data, corners.length === 4 ? corners : defaultCorners(data.width, data.height));
    const fitted = autoFitPage(warped);
    const enhanced = enhanceDocument(fitted, "bw");
    pages.push(imageDataToCanvas(enhanced));
  }

  if (!pages.length) throw new Error("Yaroqli rasm topilmadi");
  const safe = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  return pagesToPdfBlob(pages, safe);
}

export async function fileToDossierPdf(
  file: File,
  fallbackName: string,
): Promise<{ blob: Blob; filename: string }> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return { blob: file, filename: file.name || fallbackName };
  }
  if (file.type.startsWith("image/")) {
    return imagesToA4Pdf([file], fallbackName);
  }
  throw new Error("Faqat PDF yoki rasm yuklash mumkin");
}
