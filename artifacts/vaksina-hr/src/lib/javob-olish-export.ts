/**
 * Javob olish — Excel (.xls) va PDF eksport.
 * PDF: A4 portret, har bir so‘rov alohida aniq bo‘limli kartochka.
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

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines = 6,
): string[] {
  const words = String(text || "—").split(/\s+/).filter(Boolean);
  if (!words.length) return ["—"];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    const last = lines[maxLines - 1] || "";
    let s = last;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    lines[maxLines - 1] = `${s}…`;
  }
  return lines.length ? lines : ["—"];
}

function statusLabelUz(status: string): string {
  if (status === "pending" || status === "pending_coord") return "Koordinator kutmoqda";
  if (status === "pending_hr") return "HR kutmoqda";
  if (status === "approved") return "Ruxsat berilgan";
  if (status === "rejected") return "Rad etilgan";
  if (status === "cancelled") return "Bekor";
  return status || "—";
}

function statusStamp(status: string): { label: string; fill: string; border: string; ink: string } {
  if (status === "approved") {
    return { label: "RUXSAT BERILGAN", fill: "#dcfce7", border: "#15803d", ink: "#14532d" };
  }
  if (status === "rejected") {
    return { label: "RAD ETILGAN", fill: "#fee2e2", border: "#b91c1c", ink: "#7f1d1d" };
  }
  if (status === "pending_hr") {
    return { label: "HR KUTMOQDA", fill: "#ffedd5", border: "#c2410c", ink: "#9a3412" };
  }
  if (status === "pending" || status === "pending_coord") {
    return { label: "KOORDINATOR KUTMOQDA", fill: "#dbeafe", border: "#1d4ed8", ink: "#1e3a8a" };
  }
  if (status === "cancelled") {
    return { label: "BEKOR", fill: "#f1f5f9", border: "#64748b", ink: "#334155" };
  }
  return { label: statusLabelUz(status).toUpperCase(), fill: "#f8fafc", border: "#64748b", ink: "#0f172a" };
}

function drawStatusStamp(
  ctx: CanvasRenderingContext2D,
  right: number,
  top: number,
  scale: number,
  stamp: { label: string; fill: string; border: string; ink: string },
): { w: number; h: number } {
  const fontPx = Math.round(3.6 * scale);
  ctx.font = `bold ${fontPx}px ${FONT}`;
  const textW = ctx.measureText(stamp.label).width;
  const w = textW + 8 * scale;
  const h = 11 * scale;
  const x = right - w;
  ctx.save();
  ctx.translate(x + w / 2, top + h / 2);
  ctx.rotate((-7 * Math.PI) / 180);
  ctx.fillStyle = stamp.fill;
  ctx.strokeStyle = stamp.border;
  ctx.lineWidth = Math.max(2.2, 0.75 * scale);
  const r = 1.6 * scale;
  ctx.beginPath();
  ctx.roundRect?.(-w / 2, -h / 2, w, h, r);
  if (!ctx.roundRect) ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = Math.max(1, 0.28 * scale);
  const inset = 1.15 * scale;
  ctx.beginPath();
  ctx.roundRect?.(-w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2, r * 0.6);
  if (!ctx.roundRect) ctx.rect(-w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2);
  ctx.stroke();
  ctx.fillStyle = stamp.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(stamp.label, 0, 0.3 * scale);
  ctx.restore();
  return { w, h };
}

function kindLabel(item: JavobRequestItem): string {
  return item.kind === "hour" || item.fromHm !== item.shiftStartHm || item.toHm !== item.shiftEndHm
    ? "Soatlik"
    : "Kunlik";
}

function timelineText(item: JavobRequestItem): string {
  if (item.timeline?.length) {
    return item.timeline
      .map((s) => {
        const who = s.by ? ` (${s.by})` : "";
        return `${s.label}: ${s.atLabel || "—"}${who}`;
      })
      .join(" | ");
  }
  const parts = [`Yuborilgan: ${item.createdAtLabel || "—"}`];
  if (item.coordDecidedAtLabel || item.coordDecidedAt) {
    parts.push(`Koordinator: ${item.coordDecidedAtLabel || item.coordDecidedAt}`);
  }
  if (item.escalatedAtLabel || item.escalatedAt) {
    parts.push(`HR ga: ${item.escalatedAtLabel || item.escalatedAt}`);
  }
  if (item.decidedAtLabel || item.decidedAt) {
    parts.push(`Qaror: ${item.decidedAtLabel || item.decidedAt}`);
  }
  return parts.join(" | ");
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

export async function exportJavobApprovedExcel(payload: JavobApprovedExportPayload): Promise<void> {
  const headers = [
    "№",
    "Xodim",
    "Filial",
    "Sana",
    "Turi",
    "Vaqt",
    "Smena",
    "Davomiylik",
    "Koordinator",
    "Holat",
    "Izoh",
    "Tarix",
    "HR izoh",
  ];
  const rowsXml = payload.rows
    .map((r, i) => {
      const cells = [
        String(i + 1),
        r.fullName || `#${r.employeeId}`,
        r.branchLabel || "—",
        formatYmdDisplay(r.workDate),
        kindLabel(r),
        `${r.fromHm}–${r.toHm}`,
        `${r.shiftStartHm}–${r.shiftEndHm}`,
        r.durationLabel || "—",
        r.coordinatorName || "—",
        statusLabelUz(r.status),
        r.note || "—",
        timelineText(r),
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

function drawSectionBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  title: string,
  lines: string[],
  scale: number,
  opts?: { bg?: string; border?: string; titleColor?: string },
): number {
  const pad = 3.2 * scale;
  const titleH = 5.2 * scale;
  const lineH = 4.2 * scale;
  const h = pad * 2 + titleH + lines.length * lineH + 1 * scale;
  ctx.fillStyle = opts?.bg || "#f8fafc";
  ctx.strokeStyle = opts?.border || "#cbd5e1";
  ctx.lineWidth = Math.max(1, 0.35 * scale);
  ctx.beginPath();
  ctx.roundRect?.(x, y, w, h, 2.5 * scale);
  if (!ctx.roundRect) {
    ctx.rect(x, y, w, h);
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = opts?.titleColor || "#0f172a";
  ctx.font = `bold ${Math.round(3.2 * scale)}px ${FONT}`;
  ctx.fillText(title, x + pad, y + pad + 3.2 * scale);

  ctx.fillStyle = "#334155";
  ctx.font = `${Math.round(3 * scale)}px ${FONT}`;
  let ly = y + pad + titleH + 2.5 * scale;
  for (const line of lines) {
    ctx.fillText(line, x + pad, ly);
    ly += lineH;
  }
  return y + h + 3 * scale;
}

export async function exportJavobApprovedPdf(payload: JavobApprovedExportPayload): Promise<void> {
  const pageW = 210;
  const pageH = 297;
  const margin = 12;
  const dpi = 160;
  const canvasW = mmToPx(pageW, dpi);
  const canvasH = mmToPx(pageH, dpi);
  const scale = canvasW / pageW;
  const contentW = (pageW - margin * 2) * scale;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const rows = payload.rows.length ? payload.rows : [];

  // Estimate cards per page: ~2–3 depending on timeline length
  let pageIndex = 0;
  let rowIndex = 0;

  while (rowIndex < rows.length || (rows.length === 0 && pageIndex === 0)) {
    if (pageIndex > 0) doc.addPage();

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.fillStyle = "#0f172a";
    ctx.font = `bold ${Math.round(5.5 * scale)}px ${FONT}`;
    ctx.fillText(payload.title, margin * scale, 16 * scale);
    ctx.font = `${Math.round(3 * scale)}px ${FONT}`;
    ctx.fillStyle = "#64748b";
    ctx.fillText(
      `${payload.generatedAt} · ${payload.rows.length} ta · sahifa ${pageIndex + 1}`,
      margin * scale,
      22 * scale,
    );

    let y = 28 * scale;
    const bottom = (pageH - 10) * scale;

    if (!rows.length) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = `${Math.round(4 * scale)}px ${FONT}`;
      ctx.fillText("Hozircha so‘rov yo‘q", margin * scale, 50 * scale);
    }

    while (rowIndex < rows.length) {
      const r = rows[rowIndex]!;
      const startY = y;

      // Measure needed height roughly
      const timeline = r.timeline?.length
        ? r.timeline
        : [
            {
              key: "sent",
              label: "So‘rov yuborildi",
              atLabel: r.createdAtLabel || "—",
              by: r.fullName,
              note: null as string | null,
            },
          ];
      const noteLines = wrapLines(ctx, r.note || "—", contentW - 8 * scale, 4);
      const histLines = timeline.flatMap((s) => {
        const head = `${s.label} — ${s.atLabel || "—"}${s.by ? ` · ${s.by}` : ""}`;
        const wrapped = wrapLines(ctx, head, contentW - 8 * scale, 2);
        return s.note
          ? [...wrapped, ...wrapLines(ctx, `  ${s.note}`, contentW - 10 * scale, 2)]
          : wrapped;
      });
      const estH =
        20 * scale + // header + shtamp
        22 * scale + // meta box
        (6 + noteLines.length * 4.2) * scale +
        (8 + histLines.length * 4.2) * scale +
        8 * scale;

      if (startY + estH > bottom && startY > 32 * scale) {
        break; // new page
      }

      // Card border
      const cardPad = 3.5 * scale;
      let cy = y + cardPad;

      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = Math.max(1, 0.4 * scale);
      ctx.fillStyle = "#ffffff";

      // We'll draw border after we know height — first draw content, track endY
      const cardX = margin * scale;
      const cardInnerX = cardX + cardPad;
      const cardInnerW = contentW - cardPad * 2;

      const stamp = statusStamp(r.status);
      const stampBox = drawStatusStamp(ctx, cardX + contentW - cardPad, cy, scale, stamp);

      ctx.save();
      ctx.beginPath();
      ctx.rect(cardInnerX, cy, Math.max(20 * scale, cardInnerW - stampBox.w - 4 * scale), stampBox.h);
      ctx.clip();
      ctx.fillStyle = "#0f172a";
      ctx.font = `bold ${Math.round(4.2 * scale)}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(r.fullName || `#${r.employeeId}`, cardInnerX, cy + 5.2 * scale);
      ctx.restore();
      cy += Math.max(8 * scale, stampBox.h + 3.2 * scale);

      ctx.fillStyle = "#64748b";
      ctx.font = `${Math.round(2.8 * scale)}px ${FONT}`;
      ctx.fillText(
        `${formatYmdDisplay(r.workDate)} · ${kindLabel(r)} · ${r.fromHm}–${r.toHm}` +
          (r.durationLabel ? ` · ${r.durationLabel}` : ""),
        cardInnerX,
        cy,
      );
      cy += 5 * scale;

      cy = drawSectionBox(
        ctx,
        cardInnerX,
        cy,
        cardInnerW,
        "Filial / Smena / Koordinator",
        [
          `Filial: ${r.branchLabel || "—"}`,
          `Smena: ${r.shiftStartHm}–${r.shiftEndHm}${r.shiftOvernight ? " (keyingi kun)" : ""}${r.shiftLabel ? ` · ${r.shiftLabel}` : ""}`,
          `Koordinator: ${r.coordinatorName || "—"}`,
        ],
        scale,
        { bg: "#f1f5f9", border: "#94a3b8" },
      );

      cy = drawSectionBox(
        ctx,
        cardInnerX,
        cy,
        cardInnerW,
        "Izoh",
        noteLines,
        scale,
        { bg: "#fffbeb", border: "#fbbf24", titleColor: "#92400e" },
      );

      cy = drawSectionBox(
        ctx,
        cardInnerX,
        cy,
        cardInnerW,
        "Tarix (kim / qachon)",
        histLines,
        scale,
        { bg: "#f0fdf4", border: "#86efac", titleColor: "#166534" },
      );

      if (r.decisionNote) {
        cy = drawSectionBox(
          ctx,
          cardInnerX,
          cy,
          cardInnerW,
          "HR izohi",
          wrapLines(ctx, r.decisionNote, cardInnerW - 8 * scale, 3),
          scale,
          { bg: "#ecfdf5", border: "#6ee7b7" },
        );
      }

      const cardH = cy - y + cardPad;
      ctx.strokeStyle = stamp.border;
      ctx.lineWidth = Math.max(1.4, 0.55 * scale);
      ctx.strokeRect(cardX, y, contentW, cardH);
      ctx.fillStyle = stamp.border;
      ctx.fillRect(cardX, y, 1.8 * scale, cardH);

      y = cy + cardPad + 4 * scale;
      rowIndex += 1;

      if (y > bottom - 40 * scale) break;
    }

    const img = canvas.toDataURL("image/jpeg", 0.93);
    doc.addImage(img, "JPEG", 0, 0, pageW, pageH);
    pageIndex += 1;

    if (!rows.length) break;
    if (rowIndex >= rows.length) break;
    // safety
    if (pageIndex > 200) break;
  }

  const blob = doc.output("blob");
  await deliverFile(blob, `javob-holat-${payload.stamp}.pdf`);
}
