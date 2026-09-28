import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";
import { ATTEST_STATUS_LABEL, formatAttestDt, type AttestMonitor, type AttestResults, type AttestResultRow } from "./atestatsiya-api";

const FONT = '"Segoe UI", "Noto Sans", Arial, sans-serif';

function esc(s: string | number | null | undefined) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(v: string | number) {
  const type = typeof v === "number" ? "Number" : "String";
  return `<Cell><Data ss:Type="${type}">${esc(v)}</Data></Cell>`;
}

function statusText(row: AttestMonitor["rows"][number]) {
  if (row.status === "submitted" || row.status === "expired") {
    return `${row.passed ? "O‘tdi" : "O‘tmadi"} · ${row.score ?? 0}%`;
  }
  return ATTEST_STATUS_LABEL[row.status];
}

export async function exportAttestExcel(data: AttestMonitor) {
  const s = data.stats;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const headers = ["№", "Xodim", "Filial", "Holat", "Ball", "To‘g‘ri", "Jami", "Urinish", "Joy", "Masofa, m", "Fokus yo‘qolgan", "Boshlangan", "Topshirilgan"];
  const rows = data.rows
    .map(
      (r, i) =>
        `<Row>${[
          cell(i + 1),
          cell(r.fullName),
          cell(r.branchLabel || "—"),
          cell(statusText(r)),
          cell(r.score ?? ""),
          cell(r.correct ?? ""),
          cell(r.total),
          cell(r.attemptsCount),
          cell(r.locationLabel || "—"),
          cell(r.distanceM ?? ""),
          cell(r.focusLost),
          cell(formatAttestDt(r.startedAt)),
          cell(formatAttestDt(r.submittedAt)),
        ].join("")}</Row>`,
    )
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="sHead"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3A5C" ss:Pattern="Solid"/></Style>
 <Style ss:ID="sTitle"><Font ss:Size="14" ss:Bold="1" ss:Color="#0B3A5C"/></Style>
</Styles>
<Worksheet ss:Name="Natijalar"><Table>
 <Row><Cell ss:StyleID="sTitle"><Data ss:Type="String">${esc(data.exam.title)} — ${esc(data.trackLabel)}</Data></Cell></Row>
 <Row><Cell><Data ss:Type="String">${esc(`${formatAttestDt(data.exam.startsAt)} – ${formatAttestDt(data.exam.endsAt)} · O‘tish ${data.exam.passScore}%`)}</Data></Cell></Row>
 <Row>${[["Xodimlar", s.targets], ["Boshlamagan", s.notStarted], ["Ishlayapti", s.inProgress], ["Tugatgan", s.finished], ["O‘tgan", s.passed], ["O‘tmagan", s.failed], ["O‘tish %", s.passRate ?? "—"], ["O‘rtacha", s.avgScore ?? "—"]].map(([k, v]) => cell(String(k)) + cell(typeof v === "number" ? v : String(v))).join("")}</Row>
 <Row/>
 <Row>${headers.map((h) => `<Cell ss:StyleID="sHead"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join("")}</Row>
 ${rows}
</Table></Worksheet>
<Worksheet ss:Name="Savollar"><Table>
 <Row>${["№", "Savol", "Javob bergan", "To‘g‘ri", "%"].map((h) => `<Cell ss:StyleID="sHead"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join("")}</Row>
 ${data.questionStats.map((q) => `<Row>${cell(q.number)}${cell(q.text)}${cell(q.answered)}${cell(q.correct)}${cell(q.percent ?? "")}</Row>`).join("")}
</Table></Worksheet>
</Workbook>`;
  await deliverFile(new Blob(["\uFEFF" + xml], { type: "application/vnd.ms-excel;charset=utf-8" }), `atestatsiya-${stamp}.xls`);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const t = String(text || "—");
  if (ctx.measureText(t).width <= maxW) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

export async function exportAttestPdf(data: AttestMonitor) {
  const pageWmm = 297;
  const pageHmm = 210;
  const scale = 2;
  const margin = 8;
  const contentW = Math.round(((pageWmm - margin * 2) / 25.4) * 160);
  const pages: HTMLCanvasElement[] = [];
  const cols = [28, 170, 130, 110, 50, 70, 90, 110];
  const sum = cols.reduce((a, b) => a + b, 0);
  const ws = cols.map((w) => Math.floor((w / sum) * contentW));
  ws[ws.length - 1]! += contentW - ws.reduce((a, b) => a + b, 0);
  const headers = ["№", "Xodim", "Filial", "Holat", "Ball", "Joy", "Boshlangan", "Topshirilgan"];
  let i = 0;
  let pageNo = 0;
  const rowH = 28;
  while (i < data.rows.length || pages.length === 0) {
    pageNo += 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((pageWmm / 25.4) * 160) * scale;
    canvas.height = Math.round((pageHmm / 25.4) * 160) * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    const W = canvas.width / scale;
    const H = canvas.height / scale;
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, W, H);
    const x0 = Math.round((margin / 25.4) * 160);
    let y = x0;
    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(x0, y, contentW, pageNo === 1 ? 78 : 40);
    ctx.fillStyle = "#fff";
    ctx.font = `bold 18px ${FONT}`;
    ctx.fillText(truncate(ctx, data.exam.title, contentW - 24), x0 + 12, y + 24);
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.fillText(`${data.trackLabel} · ${formatAttestDt(data.exam.startsAt)} – ${formatAttestDt(data.exam.endsAt)} · ${pageNo}-sahifa`, x0 + 12, y + 42);
    if (pageNo === 1) {
      ctx.font = `11px ${FONT}`;
      const s = data.stats;
      ctx.fillText(
        `Xodim ${s.targets} · Tugatgan ${s.finished} · O‘tgan ${s.passed} · O‘tmagan ${s.failed} · O‘tish ${s.passRate ?? "—"}% · O‘rtacha ${s.avgScore ?? "—"}`,
        x0 + 12,
        y + 64,
      );
      y += 90;
    } else y += 52;
    const drawHead = () => {
      ctx.fillStyle = "#0b3a5c";
      ctx.fillRect(x0, y, contentW, 24);
      ctx.fillStyle = "#fff";
      ctx.font = `bold 10px ${FONT}`;
      let x = x0;
      headers.forEach((h, n) => {
        ctx.fillText(h, x + 4, y + 16);
        x += ws[n]!;
      });
      y += 24;
    };
    drawHead();
    while (i < data.rows.length && y + rowH < H - 24) {
      const r = data.rows[i]!;
      if (i % 2 === 0) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(x0, y, contentW, rowH);
      }
      ctx.fillStyle = "#0f172a";
      ctx.font = `11px ${FONT}`;
      const vals = [
        String(i + 1),
        r.fullName,
        r.branchLabel || "—",
        statusText(r),
        r.score != null ? `${r.score}%` : "—",
        r.locationLabel || "—",
        formatAttestDt(r.startedAt),
        formatAttestDt(r.submittedAt),
      ];
      let x = x0;
      vals.forEach((v, n) => {
        ctx.fillStyle = n === 3 && r.passed ? "#065f46" : n === 3 && r.passed === false ? "#9f1239" : "#0f172a";
        ctx.fillText(truncate(ctx, v, ws[n]! - 8), x + 4, y + 18);
        x += ws[n]!;
      });
      y += rowH;
      i += 1;
    }
    pages.push(canvas);
    if (!data.rows.length) break;
  }
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pages.forEach((c, n) => {
    if (n) pdf.addPage("a4", "landscape");
    pdf.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, pageWmm, pageHmm);
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  await deliverFile(pdf.output("blob"), `atestatsiya-${stamp}.pdf`);
}

function resultStatus(r: AttestResultRow) {
  if (r.status === "submitted" || r.status === "expired") return r.passed ? "O‘tdi" : "O‘tmadi";
  return ATTEST_STATUS_LABEL[r.status];
}

function mins(sec: number | null) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export async function exportAttestResultsExcel(data: AttestResults) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const headers = [
    "№", "Xodim", "Telefon", "Filial", "Atestatsiya", "Holat", "Ball %", "To‘g‘ri", "Savollar",
    "O‘tish bali", "Urinish", "Joy turi", "Aniqlangan joy", "Masofa, m", "GPS aniqligi, m",
    "Fokus yo‘qolgan", "Davomiylik", "Boshlangan", "Topshirilgan", "Oyna boshi", "Oyna oxiri", "Bekor sababi", "Qayta ruxsat",
  ];
  const rows = data.rows
    .map((r, i) => {
      const vals: Array<string | number> = [
        i + 1,
        r.fullName,
        r.phone || "—",
        r.branchLabel || "—",
        r.examTitle,
        resultStatus(r),
        r.score ?? "",
        r.correct ?? "",
        r.total,
        r.passScore,
        r.attemptsCount,
        r.locationMode === "office" ? "Ofis" : "Filial",
        r.locationLabel || "—",
        r.distanceM ?? "",
        r.accuracyM ?? "",
        r.focusLost,
        mins(r.durationSec),
        formatAttestDt(r.startedAt),
        formatAttestDt(r.submittedAt),
        formatAttestDt(r.windowStart),
        formatAttestDt(r.windowEnd),
        r.annulReason || "—",
        r.retakeAllowed ? "Ha" : "Yo‘q",
      ];
      return `<Row>${vals.map((v) => cell(v)).join("")}</Row>`;
    })
    .join("");
  const s = data.stats;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="sHead"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3A5C" ss:Pattern="Solid"/></Style>
 <Style ss:ID="sTitle"><Font ss:Size="14" ss:Bold="1" ss:Color="#0B3A5C"/></Style>
</Styles>
<Worksheet ss:Name="Natijalar"><Table>
 <Row><Cell ss:StyleID="sTitle"><Data ss:Type="String">${esc(`Atestatsiya natijalari — ${data.trackLabel}`)}</Data></Cell></Row>
 <Row><Cell><Data ss:Type="String">${esc(`Xodim ${s.people} · Test ${s.exams} · Tugatgan ${s.finished} · O‘tgan ${s.passed} · O‘tmagan ${s.failed} · O‘tish ${s.passRate ?? "—"}% · O‘rtacha ${s.avgScore ?? "—"}`)}</Data></Cell></Row>
 <Row/>
 <Row>${headers.map((h) => `<Cell ss:StyleID="sHead"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join("")}</Row>
 ${rows}
</Table></Worksheet>
</Workbook>`;
  await deliverFile(new Blob(["\uFEFF" + xml], { type: "application/vnd.ms-excel;charset=utf-8" }), `atestatsiya-natijalar-${stamp}.xls`);
}

export async function exportAttestResultsPdf(data: AttestResults) {
  const pageWmm = 297;
  const pageHmm = 210;
  const scale = 2;
  const margin = 8;
  const contentW = Math.round(((pageWmm - margin * 2) / 25.4) * 160);
  const headers = ["№", "Xodim", "Filial", "Atestatsiya", "Holat", "Ball", "To‘g‘ri", "Joy", "Boshlangan", "Topshirilgan"];
  const cols = [26, 130, 110, 140, 70, 42, 52, 90, 100, 100];
  const sum = cols.reduce((a, b) => a + b, 0);
  const ws = cols.map((w) => Math.floor((w / sum) * contentW));
  ws[ws.length - 1]! += contentW - ws.reduce((a, b) => a + b, 0);
  const pages: HTMLCanvasElement[] = [];
  let i = 0;
  let pageNo = 0;
  const rowH = 26;
  while (i < data.rows.length || pages.length === 0) {
    pageNo += 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((pageWmm / 25.4) * 160) * scale;
    canvas.height = Math.round((pageHmm / 25.4) * 160) * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    const W = canvas.width / scale;
    const H = canvas.height / scale;
    const x0 = Math.round((margin / 25.4) * 160);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, W, H);
    let y = x0;
    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(x0, y, contentW, pageNo === 1 ? 56 : 36);
    ctx.fillStyle = "#fff";
    ctx.font = `bold 16px ${FONT}`;
    ctx.fillText(`Atestatsiya natijalari — ${data.trackLabel}`, x0 + 12, y + 22);
    ctx.font = `11px ${FONT}`;
    if (pageNo === 1) {
      const s = data.stats;
      ctx.fillText(
        `Xodim ${s.people} · Tugatgan ${s.finished} · O‘tgan ${s.passed} · O‘tmagan ${s.failed} · O‘tish ${s.passRate ?? "—"}% · O‘rtacha ${s.avgScore ?? "—"} · ${pageNo}-sahifa`,
        x0 + 12,
        y + 42,
      );
      y += 68;
    } else {
      ctx.fillText(`${pageNo}-sahifa`, x0 + 12, y + 28);
      y += 48;
    }
    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(x0, y, contentW, 22);
    ctx.fillStyle = "#fff";
    ctx.font = `bold 10px ${FONT}`;
    let x = x0;
    headers.forEach((h, n) => {
      ctx.fillText(h, x + 4, y + 15);
      x += ws[n]!;
    });
    y += 22;
    while (i < data.rows.length && y + rowH < H - 18) {
      const r = data.rows[i]!;
      if (i % 2 === 0) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(x0, y, contentW, rowH);
      }
      const vals = [
        String(i + 1),
        r.fullName,
        r.branchLabel || "—",
        r.examTitle,
        resultStatus(r),
        r.score != null ? `${r.score}%` : "—",
        r.correct != null ? `${r.correct}/${r.total}` : "—",
        r.locationLabel || (r.locationMode === "office" ? "Ofis" : "Filial"),
        formatAttestDt(r.startedAt),
        formatAttestDt(r.submittedAt),
      ];
      x = x0;
      ctx.font = `11px ${FONT}`;
      vals.forEach((v, n) => {
        ctx.fillStyle = n === 4 && r.passed ? "#065f46" : n === 4 && r.passed === false ? "#9f1239" : "#0f172a";
        ctx.fillText(truncate(ctx, v, ws[n]! - 8), x + 4, y + 17);
        x += ws[n]!;
      });
      y += rowH;
      i += 1;
    }
    pages.push(canvas);
    if (!data.rows.length) break;
  }
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pages.forEach((c, n) => {
    if (n) pdf.addPage("a4", "landscape");
    pdf.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, pageWmm, pageHmm);
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  await deliverFile(pdf.output("blob"), `atestatsiya-natijalar-${stamp}.pdf`);
}
