/** Davomat hisobot PDF — ekrandagi filtr ko‘rinishiga mos, Unicode canvas orqali. */

import { jsPDF } from "jspdf";
import type { DavomatDayMetrics, DavomatEmployee } from "./davomat-api";
import { deliverFile } from "./tg-download";
import { smenaLabelShort, workHoursForEmployee } from "./davomat-staff-filter";

const FONT =
  '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

const STATUS_BG: Record<string, string> = {
  present: "#d1fae5",
  late: "#fef3c7",
  incomplete: "#e0f2fe",
  absent: "#ffe4e6",
  leave: "#ede9fe",
  rest: "#f1f5f9",
};

const STATUS_FG: Record<string, string> = {
  present: "#065f46",
  late: "#92400e",
  incomplete: "#075985",
  absent: "#9f1239",
  leave: "#5b21b6",
  rest: "#334155",
};

export type DavomatDayPdfRow = {
  emp: DavomatEmployee;
  day: DavomatDayMetrics;
};

export type DavomatPdfExportInput = {
  mode: "day" | "period";
  title: string;
  subtitle: string;
  filterLine: string;
  statsLine?: string;
  fileBase: string;
  statusLabel: (status: string) => string;
  statusShort: (status: string) => string;
  /** Kunlik jadval */
  dayRows?: DavomatDayPdfRow[];
  showShiftCol?: boolean;
  workStart?: string;
  workEnd?: string;
  /** Davr jadvali */
  periodDates?: string[];
  periodEmployees?: DavomatEmployee[];
};

function mmToPx(mm: number, dpi = 144): number {
  return Math.round((mm / 25.4) * dpi);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  const t = String(text || "");
  if (ctx.measureText(t).width <= maxW) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function weekdayShort(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  const keys = ["Ya", "Du", "Se", "Ch", "Pa", "Ju", "Sh"];
  return keys[dt.getUTCDay()] ?? "";
}

function cellSubline(day: DavomatDayMetrics): string {
  const parts: string[] = [];
  if (day.workedHours && day.workedHours !== "—" && day.workedHours !== "0:00") {
    parts.push(day.workedHours);
  }
  if (day.lateArrivalLabel && day.lateArrivalLabel !== "—") {
    parts.push(`K:${day.lateArrivalLabel.replace(/\s*soat\s*/gi, "s ").replace(/\s*daq/gi, "d")}`);
  }
  return parts.join(" · ");
}

async function paintAndDeliver(
  pages: HTMLCanvasElement[],
  orientation: "portrait" | "landscape",
  fileBase: string,
) {
  const pdf = new jsPDF({
    orientation,
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    const canvas = pages[i]!;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    pdf.addImage(dataUrl, "JPEG", 0, 0, pageW, pageH, undefined, "FAST");
  }

  const blob = pdf.output("blob");
  await deliverFile(blob, `${fileBase}.pdf`);
}

function createPageCanvas(pageWmm: number, pageHmm: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  scale: number;
} {
  const scale = 2;
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
  return { canvas, ctx, W: W / scale, H: H / scale, scale };
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  opts: {
    x: number;
    y: number;
    maxW: number;
    title: string;
    subtitle: string;
    filterLine: string;
    statsLine?: string;
    pageLabel: string;
  },
): number {
  let y = opts.y;
  ctx.fillStyle = "#0b3a5c";
  ctx.font = `bold 18px ${FONT}`;
  ctx.fillText(truncate(ctx, opts.title, opts.maxW), opts.x, y);
  y += 22;

  ctx.fillStyle = "#475569";
  ctx.font = `12px ${FONT}`;
  ctx.fillText(truncate(ctx, opts.subtitle, opts.maxW - 80), opts.x, y);
  ctx.textAlign = "right";
  ctx.fillStyle = "#94a3b8";
  ctx.font = `10px ${FONT}`;
  ctx.fillText(opts.pageLabel, opts.x + opts.maxW, y);
  ctx.textAlign = "left";
  y += 18;

  ctx.fillStyle = "#0b3a5c";
  ctx.font = `11px ${FONT}`;
  ctx.fillText(truncate(ctx, opts.filterLine, opts.maxW), opts.x, y);
  y += 16;

  if (opts.statsLine) {
    ctx.fillStyle = "#334155";
    ctx.font = `11px ${FONT}`;
    ctx.fillText(truncate(ctx, opts.statsLine, opts.maxW), opts.x, y);
    y += 16;
  }

  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(opts.x, y);
  ctx.lineTo(opts.x + opts.maxW, y);
  ctx.stroke();
  return y + 12;
}

function exportDayPdf(input: DavomatPdfExportInput): Promise<void> {
  const pageWmm = 210;
  const pageHmm = 297;
  const margin = 12;
  const contentW = mmToPx(pageWmm - margin * 2);
  const rows = input.dayRows ?? [];
  const showShift = !!input.showShiftCol;

  const cols = showShift
    ? [
        { key: "num", label: "№", w: 28 },
        { key: "name", label: "F.I.Sh.", w: 150 },
        { key: "pos", label: "Lavozim", w: 110 },
        { key: "status", label: "Holat", w: 78 },
        { key: "shift", label: "Smena", w: 72 },
        { key: "in", label: "Kelish", w: 52 },
        { key: "out", label: "Ketish", w: 52 },
        { key: "work", label: "Ishlagan", w: 58 },
        { key: "late", label: "Kech", w: 48 },
        { key: "earlyIn", label: "Erta+", w: 48 },
        { key: "earlyOut", label: "Erta−", w: 48 },
        { key: "ot", label: "Kech+", w: 48 },
      ]
    : [
        { key: "num", label: "№", w: 28 },
        { key: "name", label: "F.I.Sh.", w: 170 },
        { key: "pos", label: "Lavozim", w: 120 },
        { key: "status", label: "Holat", w: 82 },
        { key: "in", label: "Kelish", w: 56 },
        { key: "out", label: "Ketish", w: 56 },
        { key: "work", label: "Ishlagan", w: 62 },
        { key: "late", label: "Kech", w: 52 },
        { key: "earlyIn", label: "Erta+", w: 52 },
        { key: "earlyOut", label: "Erta−", w: 52 },
        { key: "ot", label: "Kech+", w: 52 },
      ];

  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const scaleX = Math.min(1, contentW / tableW);
  const colWs = cols.map((c) => Math.floor(c.w * scaleX));
  const rowH = 28;
  const headH = 26;

  const pages: HTMLCanvasElement[] = [];
  let pageIdx = 0;
  let rowIdx = 0;

  while (rowIdx < rows.length || pages.length === 0) {
    pageIdx += 1;
    const { canvas, ctx, W, H } = createPageCanvas(pageWmm, pageHmm);
    const x0 = mmToPx(margin);
    let y = mmToPx(margin);

    y = drawHeader(ctx, {
      x: x0,
      y: y + 14,
      maxW: contentW,
      title: input.title,
      subtitle: input.subtitle,
      filterLine: input.filterLine,
      statsLine: input.statsLine,
      pageLabel: `${pageIdx}-sahifa`,
    });

    const drawHead = () => {
      let x = x0;
      ctx.fillStyle = "#0b3a5c";
      ctx.fillRect(x0, y, contentW, headH);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold 10px ${FONT}`;
      for (let i = 0; i < cols.length; i++) {
        const w = colWs[i]!;
        ctx.fillText(truncate(ctx, cols[i]!.label, w - 6), x + 4, y + 17);
        x += w;
      }
      y += headH;
    };

    drawHead();

    while (rowIdx < rows.length && y + rowH < H - mmToPx(margin)) {
      const { emp, day } = rows[rowIdx]!;
      const zebra = rowIdx % 2 === 0;
      ctx.fillStyle = zebra ? "#ffffff" : "#f8fafc";
      ctx.fillRect(x0, y, contentW, rowH);

      const status = day.status || "absent";
      const bg = STATUS_BG[status] || "#f1f5f9";
      const fg = STATUS_FG[status] || "#334155";
      const hours = workHoursForEmployee(emp);
      const cells: string[] = [
        String(rowIdx + 1),
        emp.fullName,
        emp.position || "—",
        input.statusLabel(status),
      ];
      if (showShift) cells.push(`${hours.start}–${hours.end}`);
      cells.push(
        day.checkIn || "—",
        day.checkOut || "—",
        day.workedHours || "—",
        day.lateArrivalLabel || "—",
        day.earlyArrivalLabel || "—",
        day.earlyLeaveLabel || "—",
        day.overtimeLabel || "—",
      );

      let x = x0;
      for (let i = 0; i < cells.length; i++) {
        const w = colWs[i]!;
        if (cols[i]!.key === "status") {
          drawRoundRect(ctx, x + 3, y + 6, Math.min(w - 6, 74), 16, 8, bg);
          ctx.fillStyle = fg;
          ctx.font = `bold 9px ${FONT}`;
          ctx.fillText(truncate(ctx, cells[i]!, w - 14), x + 8, y + 17);
        } else if (cols[i]!.key === "name") {
          ctx.fillStyle = "#0f172a";
          ctx.font = `bold 10px ${FONT}`;
          ctx.fillText(truncate(ctx, cells[i]!, w - 8), x + 4, y + 12);
          ctx.fillStyle = "#64748b";
          ctx.font = `8px ${FONT}`;
          const loc = emp.location ? String(emp.location).split("|")[0]!.trim() : "";
          ctx.fillText(truncate(ctx, loc || emp.departmentName || "", w - 8), x + 4, y + 23);
        } else {
          ctx.fillStyle = i === 0 ? "#64748b" : "#1e293b";
          ctx.font = `${i >= 5 ? "10px" : "9px"} ${FONT}`;
          ctx.fillText(truncate(ctx, cells[i]!, w - 6), x + 4, y + 17);
        }
        x += w;
      }

      ctx.strokeStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.moveTo(x0, y + rowH);
      ctx.lineTo(x0 + contentW, y + rowH);
      ctx.stroke();

      y += rowH;
      rowIdx += 1;
    }

    if (rows.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = `12px ${FONT}`;
      ctx.fillText("Tanlangan filtr bo‘yicha ma’lumot yo‘q", x0, y + 24);
    }

    ctx.fillStyle = "#94a3b8";
    ctx.font = `9px ${FONT}`;
    ctx.fillText("VAKSINA HR · Davomat hisobot", x0, H - mmToPx(6));

    pages.push(canvas);
    if (rows.length === 0) break;
  }

  return paintAndDeliver(pages, "portrait", input.fileBase);
}

function exportPeriodPdf(input: DavomatPdfExportInput): Promise<void> {
  const pageWmm = 297;
  const pageHmm = 210;
  const margin = 8;
  const contentW = mmToPx(pageWmm - margin * 2);
  const dates = input.periodDates ?? [];
  const employees = input.periodEmployees ?? [];

  const numW = 28;
  const nameW = 140;
  const minCell = 58;
  const avail = contentW - numW - nameW;
  const datesPerPage = Math.max(1, Math.min(dates.length, Math.floor(avail / minCell)));
  const cellW = Math.floor(avail / datesPerPage);
  const rowH = 42;
  const headH = 34;

  const dateChunks: string[][] = [];
  for (let i = 0; i < dates.length; i += datesPerPage) {
    dateChunks.push(dates.slice(i, i + datesPerPage));
  }
  if (!dateChunks.length) dateChunks.push([]);

  const pages: HTMLCanvasElement[] = [];
  let globalPage = 0;

  for (const chunk of dateChunks) {
    let empIdx = 0;
    while (empIdx < employees.length || (employees.length === 0 && pages.length === globalPage)) {
      globalPage += 1;
      const { canvas, ctx, W, H } = createPageCanvas(pageWmm, pageHmm);
      const x0 = mmToPx(margin);
      let y = mmToPx(margin);

      const chunkLabel =
        chunk.length > 0
          ? ` · kunlar ${chunk[0]} — ${chunk[chunk.length - 1]}`
          : "";

      y = drawHeader(ctx, {
        x: x0,
        y: y + 12,
        maxW: contentW,
        title: input.title,
        subtitle: `${input.subtitle}${chunkLabel}`,
        filterLine: input.filterLine,
        statsLine: input.statsLine,
        pageLabel: `${globalPage}-sahifa`,
      });

      const drawHead = () => {
        let x = x0;
        ctx.fillStyle = "#0b3a5c";
        ctx.fillRect(x0, y, contentW, headH);
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 10px ${FONT}`;
        ctx.fillText("№", x + 6, y + 21);
        x += numW;
        ctx.fillText("F.I.Sh.", x + 6, y + 21);
        x += nameW;
        for (const date of chunk) {
          ctx.font = `9px ${FONT}`;
          ctx.fillText(weekdayShort(date), x + 6, y + 14);
          ctx.font = `bold 10px ${FONT}`;
          ctx.fillText(date.slice(5), x + 6, y + 27);
          x += cellW;
        }
        y += headH;
      };

      drawHead();

      while (empIdx < employees.length && y + rowH < H - mmToPx(margin)) {
        const emp = employees[empIdx]!;
        const zebra = empIdx % 2 === 0;
        ctx.fillStyle = zebra ? "#ffffff" : "#f8fafc";
        ctx.fillRect(x0, y, contentW, rowH);

        let x = x0;
        ctx.fillStyle = "#64748b";
        ctx.font = `10px ${FONT}`;
        ctx.fillText(String(empIdx + 1), x + 6, y + 24);
        x += numW;

        ctx.fillStyle = "#0f172a";
        ctx.font = `bold 10px ${FONT}`;
        ctx.fillText(truncate(ctx, emp.fullName, nameW - 10), x + 4, y + 16);
        ctx.fillStyle = "#64748b";
        ctx.font = `8px ${FONT}`;
        ctx.fillText(
          truncate(ctx, `${emp.position || ""} · ${smenaLabelShort(emp)}`, nameW - 10),
          x + 4,
          y + 30,
        );
        x += nameW;

        for (const date of chunk) {
          const day = emp.days.find((d) => d.date === date);
          const status = day?.status || "absent";
          const bg = STATUS_BG[status] || "#f1f5f9";
          const fg = STATUS_FG[status] || "#334155";
          drawRoundRect(ctx, x + 2, y + 3, cellW - 4, rowH - 6, 6, bg);

          ctx.fillStyle = fg;
          ctx.font = `bold 9px ${FONT}`;
          const label = input.statusShort(status);
          ctx.fillText(truncate(ctx, label, cellW - 10), x + 6, y + 15);

          if (day && status !== "leave" && status !== "rest" && status !== "absent") {
            const inT = day.checkIn && day.checkIn !== "—" ? day.checkIn : "—";
            const outT = day.checkOut && day.checkOut !== "—" ? day.checkOut : "—";
            ctx.font = `8px ${FONT}`;
            ctx.fillText(truncate(ctx, `${inT}–${outT}`, cellW - 10), x + 6, y + 26);
            const sub = cellSubline(day);
            if (sub) {
              ctx.font = `7px ${FONT}`;
              ctx.fillText(truncate(ctx, sub, cellW - 10), x + 6, y + 36);
            }
          }

          x += cellW;
        }

        ctx.strokeStyle = "#e2e8f0";
        ctx.beginPath();
        ctx.moveTo(x0, y + rowH);
        ctx.lineTo(x0 + contentW, y + rowH);
        ctx.stroke();

        y += rowH;
        empIdx += 1;
      }

      if (employees.length === 0) {
        ctx.fillStyle = "#64748b";
        ctx.font = `12px ${FONT}`;
        ctx.fillText("Tanlangan filtr bo‘yicha ma’lumot yo‘q", x0, y + 24);
      }

      ctx.fillStyle = "#94a3b8";
      ctx.font = `9px ${FONT}`;
      ctx.fillText(
        "VAKSINA HR · Yashil=Kelgan · Sariq=Kech · Qizil=Kelmagan · Binafsha=Ta’til",
        x0,
        H - mmToPx(5),
      );

      pages.push(canvas);
      if (employees.length === 0) break;
    }
  }

  return paintAndDeliver(pages, "landscape", input.fileBase);
}

export async function downloadDavomatPdf(input: DavomatPdfExportInput): Promise<void> {
  if (input.mode === "day") {
    await exportDayPdf(input);
  } else {
    await exportPeriodPdf(input);
  }
}
