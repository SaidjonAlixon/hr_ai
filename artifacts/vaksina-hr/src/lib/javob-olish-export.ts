/**
 * Javob olish — «Ruxsat berganlarim» Excel (.xls) va PDF eksport.
 */

import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";
import type { JavobRequestItem } from "./javob-olish-api";
import { formatYmdDisplay } from "./javob-olish-api";

const FONT =
  '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

function escXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mmToPx(mm: number, dpi = 160): number {
  return Math.round((mm / 25.4) * dpi);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  const t = String(text || "—");
  if (ctx.measureText(t).width <= maxW) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function fmtDt(v?: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("uz-UZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function kindLabel(item: JavobRequestItem): string {
  return item.kind === "hour" ? "Soatlik" : "Kunlik";
}

export type JavobApprovedExportPayload = {
  title: string;
  generatedAt: string;
  stamp: string;
  rows: JavobRequestItem[];
};

export function buildJavobApprovedExport(
  items: JavobRequestItem[],
  title = "Ruxsat berganlarim — Javob olish",
): JavobApprovedExportPayload {
  const now = new Date();
  const stamp = now
    .toLocaleString("sv-SE", { timeZone: "Asia/Tashkent" })
    .replace(/[: ]/g, "-")
    .slice(0, 19);
  return {
    title,
    generatedAt: now.toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" }),
    stamp,
    rows: items,
  };
}

function statusLabelUz(status: string): string {
  if (status === "pending" || status === "pending_coord") return "Koordinator kutmoqda";
  if (status === "pending_hr") return "HR kutmoqda";
  if (status === "approved") return "Tasdiqlangan";
  if (status === "rejected") return "Rad etilgan";
  if (status === "cancelled") return "Bekor";
  return status || "—";
}

export async function exportJavobApprovedExcel(payload: JavobApprovedExportPayload): Promise<void> {
  const headers = [
    "№",
    "Xodim",
    "Sana",
    "Turi",
    "Vaqt",
    "Smena",
    "Davomiylik",
    "Holat",
    "Izoh",
    "Yuborilgan",
    "Qaror vaqti",
    "HR izoh",
  ];
  const rowsXml = payload.rows
    .map((r, i) => {
      const cells = [
        String(i + 1),
        r.fullName || `#${r.employeeId}`,
        formatYmdDisplay(r.workDate),
        kindLabel(r),
        `${r.fromHm}–${r.toHm}`,
        `${r.shiftStartHm}–${r.shiftEndHm}`,
        r.durationLabel || "—",
        statusLabelUz(r.status),
        r.note || "—",
        r.createdAtLabel || fmtDt(r.createdAt),
        fmtDt(r.decidedAt),
        r.decisionNote || "—",
      ];
      return `<Row>${cells.map((c) => `<Cell><Data ss:Type="String">${escXml(c)}</Data></Cell>`).join("")}</Row>`;
    })
    .join("");

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Javob">
  <Table>
   <Row>${headers.map((h) => `<Cell><Data ss:Type="String">${escXml(h)}</Data></Cell>`).join("")}</Row>
   ${rowsXml}
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  await deliverFile(blob, `javob-holat-${payload.stamp}.xls`);
}

export async function exportJavobApprovedPdf(payload: JavobApprovedExportPayload): Promise<void> {
  const pageW = 297;
  const pageH = 210;
  const margin = 10;
  const dpi = 160;
  const canvasW = mmToPx(pageW, dpi);
  const canvasH = mmToPx(pageH, dpi);
  const scale = canvasW / pageW;

  const colW = [8, 36, 24, 16, 22, 24, 18, 28, 42, 24, 24];
  const headers = [
    "№",
    "Xodim",
    "Sana",
    "Turi",
    "Vaqt",
    "Smena",
    "Davom.",
    "Holat",
    "Izoh",
    "Yuborilgan",
    "Qaror",
  ];

  const rowsPerPage = 12;
  const pages: JavobRequestItem[][] = [];
  for (let i = 0; i < payload.rows.length; i += rowsPerPage) {
    pages.push(payload.rows.slice(i, i + rowsPerPage));
  }
  if (!pages.length) pages.push([]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  for (let pi = 0; pi < pages.length; pi++) {
    if (pi > 0) doc.addPage();
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = "#0f172a";
    ctx.font = `bold ${Math.round(5.2 * scale)}px ${FONT}`;
    ctx.fillText(payload.title, margin * scale, 14 * scale);
    ctx.font = `${Math.round(3.2 * scale)}px ${FONT}`;
    ctx.fillStyle = "#64748b";
    ctx.fillText(
      `${payload.generatedAt} · ${payload.rows.length} ta · sahifa ${pi + 1}/${pages.length}`,
      margin * scale,
      20 * scale,
    );

    let x = margin * scale;
    let y = 28 * scale;
    const rowH = 11 * scale;
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(x, y, (pageW - margin * 2) * scale, rowH);
    ctx.fillStyle = "#0f172a";
    ctx.font = `bold ${Math.round(2.6 * scale)}px ${FONT}`;
    let cx = x + 2 * scale;
    headers.forEach((h, hi) => {
      ctx.fillText(h, cx, y + rowH * 0.68);
      cx += colW[hi]! * scale;
    });
    y += rowH;

    ctx.font = `${Math.round(2.5 * scale)}px ${FONT}`;
    pages[pi]!.forEach((r, ri) => {
      const bg = ri % 2 === 0 ? "#f8fafc" : "#ffffff";
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, (pageW - margin * 2) * scale, rowH);
      ctx.fillStyle = "#1e293b";
      const vals = [
        String(pi * rowsPerPage + ri + 1),
        r.fullName || `#${r.employeeId}`,
        formatYmdDisplay(r.workDate),
        kindLabel(r),
        `${r.fromHm}–${r.toHm}`,
        `${r.shiftStartHm}–${r.shiftEndHm}`,
        r.durationLabel || "—",
        statusLabelUz(r.status),
        r.note || "—",
        r.createdAtLabel || fmtDt(r.createdAt),
        fmtDt(r.decidedAt),
      ];
      let vx = x + 2 * scale;
      vals.forEach((v, vi) => {
        ctx.fillText(truncate(ctx, v, colW[vi]! * scale - 4 * scale), vx, y + rowH * 0.68);
        vx += colW[vi]! * scale;
      });
      y += rowH;
    });

    if (!pages[pi]!.length) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = `${Math.round(3.5 * scale)}px ${FONT}`;
      ctx.fillText("Hozircha so‘rov yo‘q", margin * scale, 50 * scale);
    }

    const img = canvas.toDataURL("image/jpeg", 0.92);
    doc.addImage(img, "JPEG", 0, 0, pageW, pageH);
  }

  const blob = doc.output("blob");
  await deliverFile(blob, `javob-holat-${payload.stamp}.pdf`);
}
