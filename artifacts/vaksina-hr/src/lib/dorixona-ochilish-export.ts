import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";

const FONT = '"Segoe UI", "Noto Sans", Arial, sans-serif';

export type OpenDayExport = {
  date: string;
  weekday: string;
  systemOpen: string;
  systemClose: string;
  systemDur: string;
  sbOpen: string;
  sbClose: string;
  sbDur: string;
  note: string;
  filledBy: string;
  status: string;
};

export type OpenRowExport = {
  n: number;
  name: string;
  phone: string;
  coordinator: string;
  days: OpenDayExport[];
};

export type OpenExportPayload = {
  grain: "kun" | "hafta" | "oy";
  title: string;
  period: string;
  filterLine: string;
  rows: OpenRowExport[];
};

function escXml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(value: string, style = "sText") {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escXml(value || "—")}</Data></Cell>`;
}

function dayText(day: OpenDayExport) {
  return [
    `Tizim: ${day.systemOpen} – ${day.systemClose} (${day.systemDur})`,
    `SB: ${day.sbOpen} – ${day.sbClose} (${day.sbDur})`,
    `Holat: ${day.status}`,
    day.note && day.note !== "—" ? `Izoh: ${day.note}` : "",
    day.filledBy && day.filledBy !== "—" ? `Yozgan: ${day.filledBy}` : "",
  ].filter(Boolean).join("\n");
}

export async function downloadDorixonaExcel(data: OpenExportPayload) {
  const kun = data.grain === "kun";
  const headers = kun
    ? ["№", "Dorixona", "Sotuv telefoni", "Koordinator", "Tizim ochildi", "Tizim yopildi", "Tizim vaqt", "SB ochildi", "SB yopildi", "SB vaqt", "Izoh", "Yozgan", "Holat"]
    : ["№", "Dorixona", "Sotuv telefoni", "Koordinator", ...data.rows[0]?.days.map((day) => `${day.date.slice(8)} ${day.weekday}`) || []];
  const body = data.rows.map((row) => {
    const day = row.days[0];
    const values = kun && day
      ? [String(row.n), row.name, row.phone, row.coordinator, day.systemOpen, day.systemClose, day.systemDur, day.sbOpen, day.sbClose, day.sbDur, day.note, day.filledBy, day.status]
      : [String(row.n), row.name, row.phone, row.coordinator, ...row.days.map(dayText)];
    return `<Row>${values.map((value, index) => cell(value, index < 4 ? "sText" : "sWrap")).join("")}</Row>`;
  }).join("");
  const flat = data.rows.flatMap((row) => row.days.map((day) => [
    String(row.n), row.name, row.phone, row.coordinator, day.date, day.weekday,
    day.systemOpen, day.systemClose, day.systemDur, day.sbOpen, day.sbClose, day.sbDur, day.note, day.filledBy, day.status,
  ]));
  const flatHead = ["№", "Dorixona", "Sotuv telefoni", "Koordinator", "Sana", "Kun", "Tizim ochildi", "Tizim yopildi", "Tizim vaqt", "SB ochildi", "SB yopildi", "SB vaqt", "Izoh", "Yozgan", "Holat"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="sTitle"><Font ss:Bold="1" ss:Size="14" ss:Color="#0B3A5C"/></Style>
  <Style ss:ID="sHead"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3A5C" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
  <Style ss:ID="sText"><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="sWrap"><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style>
 </Styles>
 <Worksheet ss:Name="Jadval">
  <Table>
   <Row><Cell ss:StyleID="sTitle" ss:MergeAcross="${Math.max(headers.length - 1, 0)}"><Data ss:Type="String">${escXml(data.title)}</Data></Cell></Row>
   <Row><Cell ss:MergeAcross="${Math.max(headers.length - 1, 0)}"><Data ss:Type="String">${escXml(`${data.period} · ${data.filterLine} · ${data.rows.length} dorixona`)}</Data></Cell></Row>
   <Row>${headers.map((head) => `<Cell ss:StyleID="sHead"><Data ss:Type="String">${escXml(head)}</Data></Cell>`).join("")}</Row>
   ${body}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="Kunlar">
  <Table>
   <Row><Cell ss:StyleID="sTitle" ss:MergeAcross="14"><Data ss:Type="String">${escXml(`${data.title} — har bir kun`)}</Data></Cell></Row>
   <Row>${flatHead.map((head) => `<Cell ss:StyleID="sHead"><Data ss:Type="String">${escXml(head)}</Data></Cell>`).join("")}</Row>
   ${flat.map((values) => `<Row>${values.map((value) => cell(value)).join("")}</Row>`).join("")}
  </Table>
 </Worksheet>
</Workbook>`;
  const stamp = data.period.replace(/\s+/g, "_");
  await deliverFile(new Blob(["\uFEFF" + xml], { type: "application/vnd.ms-excel;charset=utf-8" }), `dorixona-ochilishi-${stamp}.xls`);
}

function mm(value: number) {
  return Math.round((value / 25.4) * 150);
}

function clip(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const raw = text || "—";
  if (ctx.measureText(raw).width <= max) return raw;
  let s = raw;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

export async function downloadDorixonaPdf(data: OpenExportPayload) {
  const pageWmm = 297;
  const pageHmm = 210;
  const margin = 8;
  const scale = 2;
  const contentW = mm(pageWmm - margin * 2);
  const pages: HTMLCanvasElement[] = [];
  const dayGroups: OpenDayExport[][] = [];
  const sample = data.rows[0]?.days || [];
  if (data.grain === "kun") dayGroups.push(sample);
  else for (let i = 0; i < sample.length; i += 7) dayGroups.push(sample.slice(i, i + 7));
  if (!dayGroups.length) dayGroups.push([]);

  for (const group of dayGroups) {
    let start = 0;
    let pageNo = 0;
    while (start < data.rows.length || pageNo === 0) {
      pageNo += 1;
      const canvas = document.createElement("canvas");
      canvas.width = mm(pageWmm) * scale;
      canvas.height = mm(pageHmm) * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("PDF chizilmadi");
      ctx.scale(scale, scale);
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, mm(pageWmm), mm(pageHmm));
      const x0 = mm(margin);
      let y = mm(margin);
      ctx.fillStyle = "#0b3a5c";
      ctx.fillRect(x0, y, contentW, 36);
      ctx.fillStyle = "#fff";
      ctx.font = `700 16px ${FONT}`;
      ctx.fillText(clip(ctx, data.title, contentW - 24), x0 + 12, y + 16);
      ctx.font = `11px ${FONT}`;
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.fillText(clip(ctx, `${data.period} · ${data.filterLine} · ${data.rows.length} dorixona`, contentW - 24), x0 + 12, y + 30);
      y += 44;

      const heads = data.grain === "kun"
        ? ["№", "Dorixona / telefon", "Koordinator", "Tizim", "SB fakt", "Vaqt", "Izoh", "Holat"]
        : ["Dorixona", ...group.map((day) => `${Number(day.date.slice(8))} ${day.weekday}`)];
      const weights = data.grain === "kun"
        ? [28, 160, 120, 100, 100, 80, 160, 80]
        : [180, ...group.map(() => 100)];
      const sum = weights.reduce((a, b) => a + b, 0) || 1;
      const widths = weights.map((w) => Math.floor((w / sum) * contentW));
      widths[widths.length - 1]! += contentW - widths.reduce((a, b) => a + b, 0);
      const rowH = data.grain === "kun" ? 40 : 48;
      ctx.fillStyle = "#0b3a5c";
      ctx.fillRect(x0, y, contentW, 22);
      ctx.fillStyle = "#fff";
      ctx.font = `700 10px ${FONT}`;
      let x = x0;
      heads.forEach((head, index) => {
        ctx.fillText(clip(ctx, head, widths[index]! - 8), x + 4, y + 15);
        x += widths[index]!;
      });
      y += 22;

      while (start < data.rows.length && y + rowH < mm(pageHmm) - mm(margin)) {
        const row = data.rows[start]!;
        ctx.fillStyle = start % 2 ? "#f1f5f9" : "#ffffff";
        ctx.fillRect(x0, y, contentW, rowH);
        ctx.strokeStyle = "#e2e8f0";
        ctx.strokeRect(x0, y, contentW, rowH);
        ctx.fillStyle = "#0f2744";
        ctx.font = `12px ${FONT}`;
        x = x0;
        const day = row.days.find((item) => item.date === group[0]?.date) || row.days[0];
        const values = data.grain === "kun" && day
          ? [String(row.n), `${row.name}\n${row.phone}`, row.coordinator, `${day.systemOpen} – ${day.systemClose}`, `${day.sbOpen} – ${day.sbClose}`, day.systemDur, day.note, day.status]
          : [`${row.name}\n${row.phone}`, ...group.map((slot) => {
              const cellDay = row.days.find((item) => item.date === slot.date);
              return cellDay ? `${cellDay.systemOpen}–${cellDay.systemClose}\nSB ${cellDay.sbOpen}–${cellDay.sbClose}` : "—";
            })];
        values.forEach((value, index) => {
          const lines = String(value).split("\n");
          ctx.fillStyle = index === 0 || (data.grain === "kun" && index === 1) ? "#0f2744" : "#334155";
          ctx.font = index === 0 ? `700 11px ${FONT}` : `11px ${FONT}`;
          lines.slice(0, 2).forEach((line, lineNo) => {
            ctx.fillText(clip(ctx, line, widths[index]! - 8), x + 4, y + 16 + lineNo * 14);
          });
          x += widths[index]!;
        });
        y += rowH;
        start += 1;
      }
      pages.push(canvas);
      if (start >= data.rows.length) break;
    }
  }

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pages.forEach((canvas, index) => {
    if (index) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.86), "JPEG", 0, 0, pageWmm, pageHmm);
  });
  const stamp = data.period.replace(/\s+/g, "_");
  await deliverFile(pdf.output("blob"), `dorixona-ochilishi-${stamp}.pdf`);
}
