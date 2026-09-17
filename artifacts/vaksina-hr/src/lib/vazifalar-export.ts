/**
 * Topshiriqlar — Excel (.xls SpreadsheetML) va PDF (albom / landscape) eksport.
 * Kirillcha matn canvas orqali (jspdf standart shriftlarida ishonchsiz).
 */

import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";
import type { Vazifa } from "./vazifalar-api";

const FONT =
  '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

export type TaskExportColumnId = "past" | "today" | "progress" | "review" | "completed";

export type TaskExportRow = {
  id: number;
  title: string;
  description: string;
  column: string;
  columnId: TaskExportColumnId;
  status: string;
  statusRaw: string;
  priority: string;
  priorityRaw: string;
  taskType: string;
  assignee: string;
  createdBy: string;
  dueAt: string;
  completedAt: string;
  result: string;
  branchOrDept: string;
  acceptedAt: string;
};

export type TaskExportPayload = {
  title: string;
  generatedAt: string;
  stamp: string;
  kpi: { total: number; overdue: number; today: number; progress: number; done: number };
  columns: Array<{ id: TaskExportColumnId; label: string; count: number; color: string }>;
  topPeople: Array<{ name: string; count: number }>;
  rows: TaskExportRow[];
};

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

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function priorityColors(p: string): { bg: string; fg: string } {
  const k = p.toLowerCase();
  if (k.includes("shoshil") || k.includes("urgent")) return { bg: "#ffe4e6", fg: "#9f1239" };
  if (k.includes("yuqori") || k.includes("high")) return { bg: "#ffedd5", fg: "#9a3412" };
  if (k.includes("o‘rta") || k.includes("orta") || k.includes("normal") || k.includes("medium"))
    return { bg: "#fef3c7", fg: "#92400e" };
  return { bg: "#e0f2fe", fg: "#075985" };
}

function columnColors(id: TaskExportColumnId): { bg: string; fg: string; bar: string } {
  switch (id) {
    case "past":
      return { bg: "#ffe4e6", fg: "#9f1239", bar: "#f43f5e" };
    case "today":
      return { bg: "#fef3c7", fg: "#92400e", bar: "#f59e0b" };
    case "progress":
      return { bg: "#e0f2fe", fg: "#075985", bar: "#0ea5e9" };
    case "review":
      return { bg: "#ede9fe", fg: "#5b21b6", bar: "#8b5cf6" };
    case "completed":
      return { bg: "#d1fae5", fg: "#065f46", bar: "#10b981" };
  }
}

/** Excel 2003 XML Spreadsheet (.xls) — Excel / LibreOffice ochadi */
export async function downloadTasksExcel(data: TaskExportPayload): Promise<void> {
  const headers = [
    "№",
    "ID",
    "Sarlavha",
    "Tavsif",
    "Bo‘lim (kanban)",
    "Status",
    "Muhimlik",
    "Turi",
    "Ijrochi",
    "Beruvchi",
    "Muddat",
    "Yakunlangan",
    "Natija",
    "Filial / bo‘lim",
    "Qabul qilingan",
  ];

  const cell = (v: string | number, opts?: { bold?: boolean; color?: string }) => {
    const style = opts?.bold || opts?.color ? ` ss:StyleID="${opts.bold ? "sBold" : "sNorm"}"` : "";
    return `<Cell${style}><Data ss:Type="${typeof v === "number" ? "Number" : "String"}">${escXml(
      String(v ?? ""),
    )}</Data></Cell>`;
  };

  const rowsXml = data.rows
    .map((r, i) => {
      return `<Row>${[
        cell(i + 1),
        cell(r.id),
        cell(r.title),
        cell(r.description),
        cell(r.column),
        cell(r.status),
        cell(r.priority),
        cell(r.taskType),
        cell(r.assignee),
        cell(r.createdBy),
        cell(r.dueAt),
        cell(r.completedAt),
        cell(r.result),
        cell(r.branchOrDept),
        cell(r.acceptedAt),
      ].join("")}</Row>`;
    })
    .join("\n");

  const kpiRow = `<Row>${[
    cell("Jami"),
    cell(data.kpi.total),
    cell("Kechikkan"),
    cell(data.kpi.overdue),
    cell("Bugun"),
    cell(data.kpi.today),
    cell("Jarayonda"),
    cell(data.kpi.progress),
    cell("Bajarilgan"),
    cell(data.kpi.done),
  ].join("")}</Row>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Segoe UI" ss:Size="11"/></Style>
  <Style ss:ID="sHead"><Font ss:FontName="Segoe UI" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3A5C" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sTitle"><Font ss:FontName="Segoe UI" ss:Size="14" ss:Bold="1" ss:Color="#0B3A5C"/></Style>
  <Style ss:ID="sBold"><Font ss:FontName="Segoe UI" ss:Size="11" ss:Bold="1"/></Style>
  <Style ss:ID="sNorm"><Font ss:FontName="Segoe UI" ss:Size="11"/></Style>
 </Styles>
 <Worksheet ss:Name="Topshiriqlar">
  <Table>
   <Column ss:AutoFitWidth="0" ss:Width="36"/>
   <Column ss:AutoFitWidth="0" ss:Width="48"/>
   <Column ss:AutoFitWidth="0" ss:Width="160"/>
   <Column ss:AutoFitWidth="0" ss:Width="140"/>
   <Column ss:AutoFitWidth="0" ss:Width="100"/>
   <Column ss:AutoFitWidth="0" ss:Width="90"/>
   <Column ss:AutoFitWidth="0" ss:Width="80"/>
   <Column ss:AutoFitWidth="0" ss:Width="80"/>
   <Column ss:AutoFitWidth="0" ss:Width="120"/>
   <Column ss:AutoFitWidth="0" ss:Width="120"/>
   <Column ss:AutoFitWidth="0" ss:Width="110"/>
   <Column ss:AutoFitWidth="0" ss:Width="110"/>
   <Column ss:AutoFitWidth="0" ss:Width="140"/>
   <Column ss:AutoFitWidth="0" ss:Width="110"/>
   <Column ss:AutoFitWidth="0" ss:Width="110"/>
   <Row><Cell ss:StyleID="sTitle"><Data ss:Type="String">${escXml(data.title)}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">${escXml(
     `Yaratilgan: ${new Date(data.generatedAt).toLocaleString("uz-UZ")} · Jami ${data.rows.length} ta`,
   )}</Data></Cell></Row>
   ${kpiRow}
   <Row/>
   <Row>${headers.map((h) => `<Cell ss:StyleID="sHead"><Data ss:Type="String">${escXml(h)}</Data></Cell>`).join("")}</Row>
   ${rowsXml}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="Top 5">
  <Table>
   <Row><Cell ss:StyleID="sHead"><Data ss:Type="String">Xodim</Data></Cell><Cell ss:StyleID="sHead"><Data ss:Type="String">Vazifalar</Data></Cell></Row>
   ${data.topPeople
     .map(
       (p) =>
         `<Row><Cell><Data ss:Type="String">${escXml(p.name)}</Data></Cell><Cell><Data ss:Type="Number">${p.count}</Data></Cell></Row>`,
     )
     .join("\n")}
  </Table>
 </Worksheet>
</Workbook>`;

  const blob = new Blob(["\uFEFF" + xml], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  await deliverFile(blob, `topshiriqlar-${data.stamp}.xls`);
}

/** Albom (landscape) A4 PDF — zamonaviy dashboard uslubida */
export async function downloadTasksPdf(data: TaskExportPayload): Promise<void> {
  const pageWmm = 297;
  const pageHmm = 210;
  const margin = 8;
  const contentW = mmToPx(pageWmm - margin * 2);
  const scale = 2;
  const pages: HTMLCanvasElement[] = [];

  const COL_W = [28, 150, 72, 72, 58, 100, 88, 100, 120] as const;
  const weightSum = COL_W.reduce((a, b) => a + b, 0);
  let colWs = COL_W.map((w) => Math.floor((w / weightSum) * contentW));
  colWs[colWs.length - 1]! += contentW - colWs.reduce((a, b) => a + b, 0);

  const HEADERS = [
    "№",
    "Vazifa",
    "Bo‘lim",
    "Status",
    "Muhimlik",
    "Ijrochi",
    "Muddat",
    "Natija",
    "Filial / bo‘lim",
  ];

  let rowIdx = 0;
  let pageNo = 0;
  const rowH = 38;
  const headH = 30;

  while (rowIdx < data.rows.length || pages.length === 0) {
    pageNo += 1;
    const W = mmToPx(pageWmm) * scale;
    const H = mmToPx(pageHmm) * scale;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas ishlamaydi");
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, W, H);
    ctx.scale(scale, scale);

    const pageW = W / scale;
    const pageH = H / scale;
    const x0 = mmToPx(margin);
    let y = mmToPx(margin);

    /* Header band */
    roundRect(ctx, x0, y, contentW, 52, 14);
    ctx.fillStyle = "#0b3a5c";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillText(truncate(ctx, data.title, contentW - 160), x0 + 16, y + 28);
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.fillText(
      truncate(
        ctx,
        `${new Date(data.generatedAt).toLocaleString("uz-UZ")} · ${data.rows.length} ta vazifa · ${pageNo}-sahifa`,
        contentW - 32,
      ),
      x0 + 16,
      y + 44,
    );
    y += 64;

    if (pageNo === 1) {
      /* KPI cards */
      const cards = [
        { label: "Jami", value: data.kpi.total, color: "#0b3a5c" },
        { label: "Kechikkan", value: data.kpi.overdue, color: "#e11d48" },
        { label: "Bugun", value: data.kpi.today, color: "#d97706" },
        { label: "Jarayonda", value: data.kpi.progress, color: "#0284c7" },
        { label: "Bajarilgan", value: data.kpi.done, color: "#059669" },
      ];
      const gap = 10;
      const cardW = (contentW - gap * (cards.length - 1)) / cards.length;
      cards.forEach((c, i) => {
        const x = x0 + i * (cardW + gap);
        roundRect(ctx, x, y, cardW, 48, 12);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = c.color;
        ctx.fillRect(x, y, 4, 48);
        ctx.fillStyle = "#64748b";
        ctx.font = `bold 9px ${FONT}`;
        ctx.fillText(c.label.toUpperCase(), x + 12, y + 16);
        ctx.fillStyle = "#0f172a";
        ctx.font = `bold 22px ${FONT}`;
        ctx.fillText(String(c.value), x + 12, y + 38);
      });
      y += 60;

      /* Column chips + Top people */
      const leftW = Math.floor(contentW * 0.58);
      const rightW = contentW - leftW - 12;

      roundRect(ctx, x0, y, leftW, 78, 12);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#e2e8f0";
      ctx.stroke();
      ctx.fillStyle = "#0b3a5c";
      ctx.font = `bold 12px ${FONT}`;
      ctx.fillText("Kanban bo‘limlari", x0 + 12, y + 18);
      let cx = x0 + 12;
      const cy = y + 32;
      for (const col of data.columns) {
        const cc = columnColors(col.id);
        const label = `${col.label}: ${col.count}`;
        ctx.font = `bold 10px ${FONT}`;
        const tw = Math.min(ctx.measureText(label).width + 20, leftW - 24);
        if (cx + tw > x0 + leftW - 12) break;
        roundRect(ctx, cx, cy, tw, 22, 11);
        ctx.fillStyle = cc.bg;
        ctx.fill();
        ctx.fillStyle = cc.fg;
        ctx.fillText(label, cx + 10, cy + 15);
        cx += tw + 8;
      }
      ctx.fillStyle = "#64748b";
      ctx.font = `10px ${FONT}`;
      ctx.fillText("Holatlar va natijalar filtrlangan ro‘yxat asosida", x0 + 12, y + 68);

      roundRect(ctx, x0 + leftW + 12, y, rightW, 78, 12);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#e2e8f0";
      ctx.stroke();
      ctx.fillStyle = "#0b3a5c";
      ctx.font = `bold 12px ${FONT}`;
      ctx.fillText("Top 5 faol xodim", x0 + leftW + 24, y + 18);
      const maxC = Math.max(1, ...data.topPeople.map((p) => p.count));
      data.topPeople.slice(0, 4).forEach((p, i) => {
        const py = y + 28 + i * 12;
        ctx.fillStyle = "#334155";
        ctx.font = `10px ${FONT}`;
        ctx.fillText(truncate(ctx, p.name, rightW - 70), x0 + leftW + 24, py);
        const barMax = rightW - 90;
        const bw = Math.round((p.count / maxC) * barMax);
        ctx.fillStyle = "#e2e8f0";
        roundRect(ctx, x0 + leftW + 24, py + 2, barMax, 4, 2);
        ctx.fill();
        ctx.fillStyle = "#0b3a5c";
        roundRect(ctx, x0 + leftW + 24, py + 2, Math.max(4, bw), 4, 2);
        ctx.fill();
        ctx.fillStyle = "#64748b";
        ctx.font = `bold 9px ${FONT}`;
        ctx.textAlign = "right";
        ctx.fillText(String(p.count), x0 + leftW + 12 + rightW - 10, py);
        ctx.textAlign = "left";
      });
      if (!data.topPeople.length) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = `10px ${FONT}`;
        ctx.fillText("Ma’lumot yo‘q", x0 + leftW + 24, y + 48);
      }
      y += 90;
    }

    /* Table panel */
    const tableTop = y;
    const tableH = pageH - y - mmToPx(margin);
    roundRect(ctx, x0, tableTop, contentW, tableH, 12);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#e2e8f0";
    ctx.stroke();

    y = tableTop + 8;
    const drawHead = () => {
      let x = x0 + 6;
      ctx.fillStyle = "#0b3a5c";
      roundRect(ctx, x0 + 6, y, contentW - 12, headH, 8);
      ctx.fill();
      for (let i = 0; i < HEADERS.length; i++) {
        const w = colWs[i]!;
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 10px ${FONT}`;
        ctx.fillText(truncate(ctx, HEADERS[i]!, w - 8), x + 4, y + 19);
        x += w;
      }
      y += headH + 4;
    };
    drawHead();

    while (rowIdx < data.rows.length && y + rowH < tableTop + tableH - 8) {
      const r = data.rows[rowIdx]!;
      const zebra = rowIdx % 2 === 0;
      if (!zebra) {
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(x0 + 6, y, contentW - 12, rowH);
      }

      const cells = [
        String(rowIdx + 1),
        r.title,
        r.column,
        r.status,
        r.priority,
        r.assignee,
        r.dueAt,
        r.result || "—",
        r.branchOrDept || "—",
      ];

      let x = x0 + 6;
      for (let i = 0; i < cells.length; i++) {
        const w = colWs[i]!;
        const val = cells[i] || "—";

        if (i === 1) {
          ctx.fillStyle = "#0f172a";
          ctx.font = `bold 11px ${FONT}`;
          ctx.fillText(truncate(ctx, val, w - 8), x + 4, y + 15);
          if (r.description) {
            ctx.fillStyle = "#64748b";
            ctx.font = `9px ${FONT}`;
            ctx.fillText(truncate(ctx, r.description, w - 8), x + 4, y + 29);
          }
        } else if (i === 2) {
          const cc = columnColors(r.columnId);
          const pillW = Math.min(w - 8, 78);
          roundRect(ctx, x + 3, y + 10, pillW, 18, 9);
          ctx.fillStyle = cc.bg;
          ctx.fill();
          ctx.fillStyle = cc.fg;
          ctx.font = `bold 9px ${FONT}`;
          ctx.fillText(truncate(ctx, val, pillW - 10), x + 9, y + 22);
        } else if (i === 4) {
          const pc = priorityColors(val);
          const pillW = Math.min(w - 6, 64);
          roundRect(ctx, x + 2, y + 10, pillW, 18, 9);
          ctx.fillStyle = pc.bg;
          ctx.fill();
          ctx.fillStyle = pc.fg;
          ctx.font = `bold 9px ${FONT}`;
          ctx.fillText(truncate(ctx, val, pillW - 8), x + 8, y + 22);
        } else if (i === 7) {
          ctx.fillStyle = r.result ? "#065f46" : "#94a3b8";
          ctx.font = `10px ${FONT}`;
          ctx.fillText(truncate(ctx, val, w - 8), x + 4, y + 22);
        } else {
          ctx.fillStyle = i === 0 ? "#94a3b8" : "#334155";
          ctx.font = `${i === 0 ? 10 : 10}px ${FONT}`;
          ctx.fillText(truncate(ctx, val, w - 8), x + 4, y + 22);
        }
        x += w;
      }

      ctx.strokeStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.moveTo(x0 + 6, y + rowH);
      ctx.lineTo(x0 + contentW - 6, y + rowH);
      ctx.stroke();

      y += rowH;
      rowIdx += 1;
    }

    /* Footer */
    ctx.fillStyle = "#94a3b8";
    ctx.font = `9px ${FONT}`;
    ctx.fillText("HR PRO · Topshiriqlar hisoboti · Albom", x0, pageH - mmToPx(4));

    pages.push(canvas);
    if (data.rows.length === 0) break;
  }

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage("a4", "landscape");
    const img = pages[i]!.toDataURL("image/jpeg", 0.92);
    pdf.addImage(img, "JPEG", 0, 0, pageWmm, pageHmm);
  }
  const blob = pdf.output("blob");
  await deliverFile(blob, `topshiriqlar-hisobot-${data.stamp}.pdf`);
}
