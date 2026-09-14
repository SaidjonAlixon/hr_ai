/** Xodimlar ro‘yxati PDF — kitob (portret), Excel bilan bir xil ma’lumot, Koordinatorgacha. */

import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";

const FONT =
  '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

export type EmployeesExportRow = {
  n: number;
  fullName: string;
  position: string;
  role: string;
  department: string;
  status: string;
  shift: string;
  hiredAt: string;
  phone: string;
  place: string;
  coordinator: string;
};

export type EmployeesExportPayload = {
  title: string;
  generatedAt: string;
  stamp: string;
  total: number;
  headers: string[];
  rows: EmployeesExportRow[];
  filters?: {
    group?: string;
    workplace?: string;
    role?: string;
    status?: string;
    search?: string;
  };
};

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

function wrap2(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): [string, string?] {
  const t = String(text || "—").trim() || "—";
  if (ctx.measureText(t).width <= maxW) return [t];
  const words = t.split(/\s+/);
  let line1 = "";
  let i = 0;
  for (; i < words.length; i++) {
    const trial = line1 ? `${line1} ${words[i]}` : words[i]!;
    if (ctx.measureText(trial).width > maxW) break;
    line1 = trial;
  }
  if (!line1) return [truncate(ctx, t, maxW)];
  const rest = words.slice(i).join(" ");
  return rest ? [line1, truncate(ctx, rest, maxW)] : [line1];
}

function statusColors(status: string): { bg: string; fg: string } {
  const s = status.toLowerCase();
  if (s.includes("ishlay") || s.includes("working") || s.includes("yangi") || s.includes("new")) {
    return { bg: "#d1fae5", fg: "#065f46" };
  }
  if (s.includes("ta’til") || s.includes("tatil") || s.includes("leave") || s.includes("отпуск")) {
    return { bg: "#fef3c7", fg: "#92400e" };
  }
  if (s.includes("bo‘shat") || s.includes("boshat") || s.includes("dismiss") || s.includes("уволен")) {
    return { bg: "#ffe4e6", fg: "#9f1239" };
  }
  return { bg: "#e2e8f0", fg: "#334155" };
}

function filterCaption(filters?: EmployeesExportPayload["filters"]): string {
  if (!filters) return "";
  const bits: string[] = [];
  if (filters.group === "other") bits.push("Boshqa holat");
  else if (filters.group === "active") bits.push("Faol xodimlar");
  if (filters.workplace === "ofis") bits.push("Ofis");
  else if (filters.workplace === "dorixona") bits.push("Dorixona");
  else if (filters.workplace === "all") bits.push("Ofis + Dorixona");
  if (filters.role && filters.role !== "all") bits.push(`Rol: ${filters.role}`);
  if (filters.status && filters.status !== "all") bits.push(`Holat: ${filters.status}`);
  if (filters.search) bits.push(`Qidiruv: ${filters.search}`);
  return bits.join(" · ");
}

/** Portret A4 kengligiga proporsional ustunlar (jami 1000 birlik). */
const COL_WEIGHTS = [
  32, // №
  150, // F.I.Sh. + lavozim
  78, // Rol
  78, // Bo‘lim
  72, // Holat
  58, // Smena
  68, // Ishga olingan
  88, // Telefon
  110, // Joy / filial
  100, // Koordinator
] as const;

const HEADERS = [
  "№",
  "F.I.Sh. / Lavozim",
  "Rol",
  "Bo‘lim",
  "Holat",
  "Smena",
  "Ishga olingan",
  "Telefon",
  "Joy / filial",
  "Koordinator",
] as const;

export async function downloadEmployeesPdf(
  data: EmployeesExportPayload,
  fileBase?: string,
): Promise<void> {
  const pageWmm = 210;
  const pageHmm = 297;
  const margin = 7;
  const contentW = mmToPx(pageWmm - margin * 2);
  const scale = 2;

  const weightSum = COL_WEIGHTS.reduce((a, b) => a + b, 0);
  let colWs = COL_WEIGHTS.map((w) => Math.floor((w / weightSum) * contentW));
  const used = colWs.reduce((a, b) => a + b, 0);
  colWs[colWs.length - 1]! += contentW - used;

  const rowH = 36;
  const headH = 32;
  const pages: HTMLCanvasElement[] = [];
  let rowIdx = 0;
  let pageNo = 0;
  const rows = data.rows;
  const filterLine = filterCaption(data.filters);

  while (rowIdx < rows.length || pages.length === 0) {
    pageNo += 1;
    const W = mmToPx(pageWmm) * scale;
    const H = mmToPx(pageHmm) * scale;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas ishlamaydi");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.scale(scale, scale);

    const pageW = W / scale;
    const pageH = H / scale;
    const x0 = mmToPx(margin);
    let y = mmToPx(margin) + 16;

    ctx.fillStyle = "#0b3a5c";
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText(truncate(ctx, data.title, contentW - 90), x0, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#64748b";
    ctx.font = `11px ${FONT}`;
    ctx.fillText(`${pageNo}-sahifa`, x0 + contentW, y);
    ctx.textAlign = "left";
    y += 20;

    ctx.fillStyle = "#334155";
    ctx.font = `12px ${FONT}`;
    const when = new Date(data.generatedAt || Date.now()).toLocaleString("uz-UZ");
    ctx.fillText(
      truncate(
        ctx,
        `Jami: ${data.total} ta xodim · ${when}${filterLine ? ` · ${filterLine}` : ""}`,
        contentW,
      ),
      x0,
      y,
    );
    y += 12;

    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + contentW, y);
    ctx.stroke();
    y += 10;

    const drawHead = () => {
      let x = x0;
      ctx.fillStyle = "#0b3a5c";
      ctx.fillRect(x0, y, contentW, headH);
      for (let i = 0; i < COL_WEIGHTS.length; i++) {
        const w = colWs[i]!;
        if (i === 8) {
          ctx.fillStyle = "#0f766e";
          ctx.fillRect(x, y, w, headH);
        } else if (i === 9) {
          ctx.fillStyle = "#7c3aed";
          ctx.fillRect(x, y, w, headH);
        }
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 10px ${FONT}`;
        const label = HEADERS[i]!;
        const lines = wrap2(ctx, label, w - 8);
        if (lines[1]) {
          ctx.fillText(lines[0]!, x + 4, y + 13);
          ctx.fillText(lines[1], x + 4, y + 25);
        } else {
          ctx.fillText(truncate(ctx, label, w - 8), x + 4, y + 20);
        }
        x += w;
      }
      y += headH;
    };

    drawHead();

    while (rowIdx < rows.length && y + rowH < pageH - mmToPx(margin + 2)) {
      const r = rows[rowIdx]!;
      const zebra = rowIdx % 2 === 0;
      ctx.fillStyle = zebra ? "#ffffff" : "#f1f5f9";
      ctx.fillRect(x0, y, contentW, rowH);

      const cellVals = [
        String(r.n),
        r.fullName,
        r.role,
        r.department,
        r.status,
        r.shift,
        r.hiredAt,
        r.phone,
        r.place,
        r.coordinator,
      ];

      let x = x0;
      for (let i = 0; i < cellVals.length; i++) {
        const w = colWs[i]!;
        const val = cellVals[i] || "—";

        if (i === 0) {
          ctx.fillStyle = "#64748b";
          ctx.font = `11px ${FONT}`;
          ctx.fillText(truncate(ctx, val, w - 6), x + 4, y + 22);
        } else if (i === 1) {
          ctx.fillStyle = "#0f172a";
          ctx.font = `bold 11px ${FONT}`;
          ctx.fillText(truncate(ctx, val, w - 8), x + 4, y + 14);
          ctx.fillStyle = "#475569";
          ctx.font = `9px ${FONT}`;
          ctx.fillText(truncate(ctx, r.position || "—", w - 8), x + 4, y + 28);
        } else if (i === 4) {
          const { bg, fg } = statusColors(val);
          const pillW = Math.min(w - 6, Math.max(52, w - 8));
          const px = x + 3;
          const py = y + 9;
          const ph = 18;
          const rr = 9;
          ctx.fillStyle = bg;
          ctx.beginPath();
          ctx.moveTo(px + rr, py);
          ctx.arcTo(px + pillW, py, px + pillW, py + ph, rr);
          ctx.arcTo(px + pillW, py + ph, px, py + ph, rr);
          ctx.arcTo(px, py + ph, px, py, rr);
          ctx.arcTo(px, py, px + pillW, py, rr);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = fg;
          ctx.font = `bold 9px ${FONT}`;
          ctx.fillText(truncate(ctx, val, pillW - 10), px + 6, y + 21);
        } else if (i === 7) {
          ctx.fillStyle = "#047857";
          ctx.font = `bold 10px ${FONT}`;
          ctx.fillText(truncate(ctx, val, w - 6), x + 4, y + 22);
        } else if (i === 8) {
          ctx.fillStyle = "#1d4ed8";
          ctx.font = `10px ${FONT}`;
          const lines = wrap2(ctx, val, w - 8);
          if (lines[1]) {
            ctx.fillText(lines[0]!, x + 4, y + 14);
            ctx.fillText(lines[1], x + 4, y + 28);
          } else {
            ctx.fillText(truncate(ctx, val, w - 8), x + 4, y + 22);
          }
        } else if (i === 9) {
          ctx.fillStyle = "#6d28d9";
          ctx.font = `bold 10px ${FONT}`;
          const lines = wrap2(ctx, val, w - 8);
          if (lines[1]) {
            ctx.fillText(lines[0]!, x + 4, y + 14);
            ctx.fillText(lines[1], x + 4, y + 28);
          } else {
            ctx.fillText(truncate(ctx, val, w - 8), x + 4, y + 22);
          }
        } else {
          ctx.fillStyle = "#1e293b";
          ctx.font = `10px ${FONT}`;
          ctx.fillText(truncate(ctx, val, w - 6), x + 4, y + 22);
        }
        x += w;
      }

      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y + rowH);
      ctx.lineTo(x0 + contentW, y + rowH);
      ctx.stroke();

      y += rowH;
      rowIdx += 1;
    }

    if (rows.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = `13px ${FONT}`;
      ctx.fillText("Tanlangan filtr bo‘yicha xodim yo‘q", x0, y + 28);
    }

    ctx.fillStyle = "#94a3b8";
    ctx.font = `9px ${FONT}`;
    ctx.fillText(
      "VAKSINA HR · Kitob format · №…Koordinator · Excel bilan bir xil ma’lumot",
      x0,
      pageH - mmToPx(4),
    );

    pages.push(canvas);
    if (rows.length === 0) break;
  }

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    pdf.addImage(pages[i]!.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, pageW, pageH, undefined, "FAST");
  }

  const blob = pdf.output("blob");
  const name = `${fileBase || `xodimlar_${data.stamp || "export"}`}.pdf`;
  await deliverFile(blob, name);
}
