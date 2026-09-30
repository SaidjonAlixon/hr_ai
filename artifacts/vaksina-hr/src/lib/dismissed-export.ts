/**
 * Bo‘shatilganlar — tartibli Excel va A4 gorizontal PDF.
 */
import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";
import { userRoleLabel } from "./roles";
import type { DismissedStaff } from "./dismissed-staff-api";

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

export function fmtDismissedWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function ymd(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10) || "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function roleOf(row: DismissedStaff) {
  return userRoleLabel(row.role) || row.role || "—";
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const raw = String(text || "—").replace(/\s+/g, " ").trim() || "—";
  if (ctx.measureText(raw).width <= maxW) return raw;
  let s = raw;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

export async function exportDismissedExcel(rows: DismissedStaff[], search?: string): Promise<void> {
  const headers = [
    "№",
    "F.I.Sh.",
    "Telefon",
    "Rol",
    "Lavozim",
    "Bo‘lim",
    "Filial",
    "Oldingi login",
    "Ishga kirgan",
    "Bo‘shatilgan",
    "Kim tomonidan",
    "Sabab",
  ];
  const widths = [28, 160, 90, 130, 110, 120, 160, 140, 80, 120, 130, 220];

  const dataRows = rows
    .map((r, i) => {
      const cells = [
        String(i + 1),
        r.fullName || "—",
        r.phone || "—",
        roleOf(r),
        r.position || "—",
        r.departmentName || "—",
        r.location || "—",
        r.login || "—",
        ymd(r.hiredAt),
        fmtDismissedWhen(r.dismissedAt),
        r.dismissedByName || "—",
        r.reason || "—",
      ];
      const style = i % 2 === 0 ? "odd" : "even";
      return `<Row ss:AutoFitHeight="0" ss:Height="20">${cells
        .map(
          (c, idx) =>
            `<Cell ss:StyleID="${idx === 0 ? "num" : style}"><Data ss:Type="String">${escXml(c)}</Data></Cell>`,
        )
        .join("")}</Row>`;
    })
    .join("");

  const lastRow = rows.length + 3;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="title"><Font ss:Bold="1" ss:Size="16" ss:Color="#0B3A5C"/><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="sub"><Font ss:Size="10" ss:Color="#64748B"/><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="head"><Font ss:Bold="1" ss:Size="10" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3A5C" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0B3A5C"/></Borders></Style>
  <Style ss:ID="odd"><Font ss:Size="10" ss:Color="#0F172A"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
  <Style ss:ID="even"><Font ss:Size="10" ss:Color="#0F172A"/><Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
  <Style ss:ID="num"><Font ss:Size="10" ss:Bold="1" ss:Color="#0B3A5C"/><Alignment ss:Vertical="Center" ss:Horizontal="Center"/></Style>
 </Styles>
 <Worksheet ss:Name="Boshhatilganlar">
  <Table>
   ${widths.map((w) => `<Column ss:AutoFitWidth="0" ss:Width="${w}"/>`).join("")}
   <Row ss:Height="24"><Cell ss:MergeAcross="11" ss:StyleID="title"><Data ss:Type="String">Bo‘shatilganlar — VAKSINA MED HR</Data></Cell></Row>
   <Row ss:Height="18"><Cell ss:MergeAcross="11" ss:StyleID="sub"><Data ss:Type="String">${escXml(`${stampNow()} · ${rows.length} ta${search?.trim() ? ` · qidiruv: ${search.trim()}` : ""} · login va parol bekor`)}</Data></Cell></Row>
   <Row ss:Height="22">${headers.map((h) => `<Cell ss:StyleID="head"><Data ss:Type="String">${escXml(h)}</Data></Cell>`).join("")}</Row>
   ${dataRows}
  </Table>
  <AutoFilter x:Range="R3C1:R${lastRow}C12" xmlns:x="urn:schemas-microsoft-com:office:excel"/>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/>
   <FrozenNoSplit/>
   <SplitHorizontal>3</SplitHorizontal>
   <TopRowBottomPane>3</TopRowBottomPane>
   <ActivePane>2</ActivePane>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  await deliverFile(blob, `Boshhatilganlar_${fileStamp()}.xls`);
}

export async function exportDismissedPdf(rows: DismissedStaff[], search?: string): Promise<void> {
  const pageW = 297;
  const pageH = 210;
  const margin = 8;
  const dpi = 130;
  const canvasW = Math.round((pageW / 25.4) * dpi);
  const canvasH = Math.round((pageH / 25.4) * dpi);
  const scale = canvasW / pageW;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const cols = [
    { title: "№", w: 10 },
    { title: "Xodim", w: 46 },
    { title: "Rol", w: 36 },
    { title: "Bo‘lim", w: 32 },
    { title: "Filial", w: 48 },
    { title: "Bo‘shatilgan", w: 32 },
    { title: "Kim", w: 32 },
    { title: "Sabab", w: 45 },
  ];

  const roleCounts = new Map<string, number>();
  for (const r of rows) {
    const label = roleOf(r);
    roleCounts.set(label, (roleCounts.get(label) || 0) + 1);
  }
  const topRoles = [...roleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  let index = 0;
  let page = 0;
  while (index < rows.length || (rows.length === 0 && page === 0)) {
    if (page > 0) doc.addPage();
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("PDF chizilmadi");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(0, 0, canvasW, 16 * scale);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(5.2 * scale)}px ${FONT}`;
    ctx.fillText("Bo‘shatilganlar", margin * scale, 7.2 * scale);
    ctx.font = `${Math.round(2.6 * scale)}px ${FONT}`;
    ctx.fillStyle = "#dbeafe";
    ctx.fillText("VAKSINA MED HR", margin * scale, 12.2 * scale);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`${stampNow()}  ·  ${page + 1}-list`, (pageW - margin) * scale, 8 * scale);
    ctx.textAlign = "left";

    let y = 20 * scale;
    ctx.fillStyle = "#334155";
    ctx.font = `${Math.round(2.7 * scale)}px ${FONT}`;
    const meta = `${rows.length} ta xodim${search?.trim() ? ` · qidiruv: ${search.trim()}` : ""} · login bekor · boshqa joyda ko‘rinmaydi`;
    ctx.fillText(meta, margin * scale, y);
    y += 5 * scale;

    let chipX = margin * scale;
    ctx.font = `bold ${Math.round(2.4 * scale)}px ${FONT}`;
    for (const [label, n] of topRoles) {
      const text = `${label} ${n}`;
      const w = ctx.measureText(text).width + 8 * scale;
      if (chipX + w > (pageW - margin) * scale) break;
      ctx.fillStyle = "#f1f5f9";
      ctx.beginPath();
      ctx.roundRect?.(chipX, y - 3.2 * scale, w, 5.2 * scale, 2 * scale);
      if (!ctx.roundRect) ctx.rect(chipX, y - 3.2 * scale, w, 5.2 * scale);
      ctx.fill();
      ctx.fillStyle = "#0b3a5c";
      ctx.fillText(text, chipX + 4 * scale, y);
      chipX += w + 2 * scale;
    }
    y += 6 * scale;

    const tableX = margin * scale;
    const rowH = 8.2 * scale;
    const headH = 7 * scale;
    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(tableX, y, (pageW - margin * 2) * scale, headH);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(2.5 * scale)}px ${FONT}`;
    let x = tableX;
    for (const col of cols) {
      ctx.fillText(col.title, x + 2 * scale, y + 4.6 * scale);
      x += col.w * scale;
    }
    y += headH;

    const bottom = (pageH - 8) * scale;
    while (index < rows.length && y + rowH <= bottom) {
      const r = rows[index]!;
      ctx.fillStyle = index % 2 === 0 ? "#ffffff" : "#f8fafc";
      ctx.fillRect(tableX, y, (pageW - margin * 2) * scale, rowH);
      ctx.strokeStyle = "#e2e8f0";
      ctx.strokeRect(tableX, y, (pageW - margin * 2) * scale, rowH);
      ctx.fillStyle = "#0f172a";
      ctx.font = `${Math.round(2.45 * scale)}px ${FONT}`;
      const cells = [
        String(index + 1),
        r.fullName || "—",
        roleOf(r),
        r.departmentName || "—",
        r.location || "—",
        fmtDismissedWhen(r.dismissedAt),
        r.dismissedByName || "—",
        r.reason || "—",
      ];
      x = tableX;
      cells.forEach((text, i) => {
        const maxW = cols[i]!.w * scale - 3 * scale;
        ctx.fillStyle = i === 0 ? "#0b3a5c" : "#0f172a";
        ctx.font = i === 1 ? `bold ${Math.round(2.45 * scale)}px ${FONT}` : `${Math.round(2.35 * scale)}px ${FONT}`;
        ctx.fillText(clip(ctx, text, maxW), x + 1.6 * scale, y + 3.5 * scale);
        if (i === 1 && r.phone) {
          ctx.fillStyle = "#64748b";
          ctx.font = `${Math.round(2 * scale)}px ${FONT}`;
          ctx.fillText(clip(ctx, r.phone, maxW), x + 1.6 * scale, y + 6.4 * scale);
        }
        x += cols[i]!.w * scale;
      });
      y += rowH;
      index += 1;
    }

    ctx.fillStyle = "#94a3b8";
    ctx.font = `${Math.round(2.3 * scale)}px ${FONT}`;
    ctx.fillText("Maxfiy · faqat admin · VAKSINA MED HR", margin * scale, (pageH - 3.5) * scale);

    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, pageH);
    page += 1;
    if (rows.length === 0) break;
    if (page > 80) break;
  }

  const blob = doc.output("blob");
  await deliverFile(blob, `Boshhatilganlar_${fileStamp()}.pdf`);
}
