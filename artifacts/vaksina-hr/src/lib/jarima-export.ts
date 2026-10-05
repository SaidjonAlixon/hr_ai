/**
 * Jarima — tanlangan holat (kelmagan / kechikkan) bo‘yicha Excel va PDF.
 */
import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";

export type JarimaExportLine = {
  fullName: string;
  branch: string;
  shift: string;
  date: string;
  weekday: string;
  status: string;
  amount: number;
};

const FONT = '"Segoe UI", "Noto Sans", Arial, sans-serif';

function escXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stampNow() {
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function fileStamp() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function som(n: number) {
  return `${Math.round(n).toLocaleString("ru-RU")} so‘m`;
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const raw = String(text || "—").replace(/\s+/g, " ").trim() || "—";
  if (ctx.measureText(raw).width <= maxW) return raw;
  let s = raw;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

export async function exportJarimaExcel(input: {
  month: string;
  filterLabel: string;
  lines: JarimaExportLine[];
}): Promise<void> {
  const headers = ["№", "Ism familiya", "Filial", "Smena", "Kun", "Holat", "Jarima"];
  const widths = [28, 180, 140, 80, 130, 90, 90];
  const total = input.lines.reduce((sum, line) => sum + line.amount, 0);
  const dataRows = input.lines
    .map((line, i) => {
      const style = i % 2 === 0 ? "odd" : "even";
      const cells: Array<{ value: string; type: "String" | "Number"; style: string }> = [
        { value: String(i + 1), type: "String", style: "num" },
        { value: line.fullName || "—", type: "String", style },
        { value: line.branch || "—", type: "String", style },
        { value: line.shift || "—", type: "String", style },
        { value: `${line.date}${line.weekday ? `, ${line.weekday}` : ""}`, type: "String", style },
        { value: line.status || "—", type: "String", style },
        { value: String(Math.round(line.amount)), type: "Number", style: "money" },
      ];
      return `<Row ss:AutoFitHeight="0" ss:Height="20">${cells
        .map((cell) => `<Cell ss:StyleID="${cell.style}"><Data ss:Type="${cell.type}">${escXml(cell.value)}</Data></Cell>`)
        .join("")}</Row>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="title"><Font ss:Bold="1" ss:Size="16" ss:Color="#0B3A5C"/><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="sub"><Font ss:Size="10" ss:Color="#64748B"/><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="head"><Font ss:Bold="1" ss:Size="10" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3A5C" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
  <Style ss:ID="odd"><Font ss:Size="10" ss:Color="#0F172A"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
  <Style ss:ID="even"><Font ss:Size="10" ss:Color="#0F172A"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
  <Style ss:ID="num"><Font ss:Size="10" ss:Bold="1" ss:Color="#0B3A5C"/><Alignment ss:Vertical="Center" ss:Horizontal="Center"/></Style>
  <Style ss:ID="money"><Font ss:Size="10" ss:Bold="1" ss:Color="#9F1239"/><Alignment ss:Vertical="Center" ss:Horizontal="Right"/><NumberFormat ss:Format="#,##0"/></Style>
  <Style ss:ID="foot"><Font ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/><Interior ss:Color="#9F1239" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="footMoney"><Font ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/><Interior ss:Color="#9F1239" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:Horizontal="Right"/><NumberFormat ss:Format="#,##0"/></Style>
 </Styles>
 <Worksheet ss:Name="Jarima">
  <Table>
   ${widths.map((w) => `<Column ss:AutoFitWidth="0" ss:Width="${w}"/>`).join("")}
   <Row ss:Height="24"><Cell ss:MergeAcross="6" ss:StyleID="title"><Data ss:Type="String">${escXml(`Jarima — ${input.filterLabel}`)}</Data></Cell></Row>
   <Row ss:Height="18"><Cell ss:MergeAcross="6" ss:StyleID="sub"><Data ss:Type="String">${escXml(`${input.month} · ${stampNow()} · ${input.lines.length} kun`)}</Data></Cell></Row>
   <Row ss:Height="22">${headers.map((h) => `<Cell ss:StyleID="head"><Data ss:Type="String">${escXml(h)}</Data></Cell>`).join("")}</Row>
   ${dataRows}
   <Row ss:Height="22">
    <Cell ss:MergeAcross="5" ss:StyleID="foot"><Data ss:Type="String">Jami jarima</Data></Cell>
    <Cell ss:StyleID="footMoney"><Data ss:Type="Number">${Math.round(total)}</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;
  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const slug = input.filterLabel.toLowerCase().replace(/\s+/g, "-");
  await deliverFile(blob, `jarima-${slug}-${input.month}-${fileStamp()}.xls`);
}

export async function exportJarimaPdf(input: {
  month: string;
  filterLabel: string;
  lines: JarimaExportLine[];
}): Promise<void> {
  const pageW = 297;
  const pageH = 210;
  const margin = 8;
  const dpi = 130;
  const canvasW = Math.round((pageW / 25.4) * dpi);
  const canvasH = Math.round((pageH / 25.4) * dpi);
  const scale = canvasW / pageW;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const cols = [
    { title: "№", w: 12 },
    { title: "Ism familiya", w: 62 },
    { title: "Filial", w: 48 },
    { title: "Smena", w: 28 },
    { title: "Kun", w: 48 },
    { title: "Holat", w: 32 },
    { title: "Jarima", w: 36 },
  ];
  const total = input.lines.reduce((sum, line) => sum + line.amount, 0);
  let index = 0;
  let page = 0;
  while (index < input.lines.length || (input.lines.length === 0 && page === 0)) {
    if (page > 0) doc.addPage();
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PDF chizilmadi");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = "#172033";
    ctx.fillRect(0, 0, canvasW, 16 * scale);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(5.2 * scale)}px ${FONT}`;
    ctx.fillText(`Jarima — ${input.filterLabel}`, margin * scale, 7.2 * scale);
    ctx.font = `${Math.round(2.6 * scale)}px ${FONT}`;
    ctx.fillStyle = "#fecdd3";
    ctx.fillText("VAKSINA MED HR", margin * scale, 12.2 * scale);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`${stampNow()}  ·  ${page + 1}-list`, (pageW - margin) * scale, 8 * scale);
    ctx.textAlign = "left";

    let y = 22 * scale;
    ctx.fillStyle = "#334155";
    ctx.font = `${Math.round(2.7 * scale)}px ${FONT}`;
    ctx.fillText(`${input.month} · ${input.lines.length} kun · jami ${som(total)}`, margin * scale, y);
    y += 6 * scale;

    const tableX = margin * scale;
    const rowH = 8 * scale;
    const headH = 7 * scale;
    ctx.fillStyle = "#172033";
    ctx.fillRect(tableX, y, (pageW - margin * 2) * scale, headH);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(2.5 * scale)}px ${FONT}`;
    let x = tableX;
    for (const col of cols) {
      ctx.fillText(col.title, x + 2 * scale, y + 4.6 * scale);
      x += col.w * scale;
    }
    y += headH;

    const bottom = (pageH - 12) * scale;
    while (index < input.lines.length && y + rowH <= bottom) {
      const line = input.lines[index]!;
      ctx.fillStyle = index % 2 === 0 ? "#ffffff" : "#f8fafc";
      ctx.fillRect(tableX, y, (pageW - margin * 2) * scale, rowH);
      ctx.strokeStyle = "#e2e8f0";
      ctx.strokeRect(tableX, y, (pageW - margin * 2) * scale, rowH);
      const cells = [
        String(index + 1),
        line.fullName || "—",
        line.branch || "—",
        line.shift || "—",
        `${line.date}${line.weekday ? ` · ${line.weekday}` : ""}`,
        line.status || "—",
        som(line.amount),
      ];
      x = tableX;
      cells.forEach((text, i) => {
        const maxW = cols[i]!.w * scale - 3 * scale;
        ctx.fillStyle = i === 6 ? "#9f1239" : i === 0 ? "#172033" : "#0f172a";
        ctx.font = i === 1 || i === 6 ? `bold ${Math.round(2.4 * scale)}px ${FONT}` : `${Math.round(2.35 * scale)}px ${FONT}`;
        ctx.fillText(clip(ctx, text, maxW), x + 1.6 * scale, y + 5.2 * scale);
        x += cols[i]!.w * scale;
      });
      y += rowH;
      index += 1;
    }

    if (index >= input.lines.length) {
      ctx.fillStyle = "#9f1239";
      ctx.fillRect(tableX, y, (pageW - margin * 2) * scale, rowH);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(2.6 * scale)}px ${FONT}`;
      ctx.fillText("Jami jarima", tableX + 2 * scale, y + 5.2 * scale);
      ctx.textAlign = "right";
      ctx.fillText(som(total), (pageW - margin) * scale - 2 * scale, y + 5.2 * scale);
      ctx.textAlign = "left";
    }

    ctx.fillStyle = "#94a3b8";
    ctx.font = `${Math.round(2.3 * scale)}px ${FONT}`;
    ctx.fillText("Jarima hisoboti · VAKSINA MED HR", margin * scale, (pageH - 3.5) * scale);
    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, pageH);
    page += 1;
    if (input.lines.length === 0) break;
    if (page > 80) break;
  }
  const slug = input.filterLabel.toLowerCase().replace(/\s+/g, "-");
  await deliverFile(doc.output("blob"), `jarima-${slug}-${input.month}-${fileStamp()}.pdf`);
}
