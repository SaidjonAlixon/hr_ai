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
  const headers = [
    "№", "Xodim", "Filial", "Holat", "Ball %", "To‘g‘ri", "Xato", "Jami", "Vaqt (min / sek)",
    "Urinish", "Joy", "Masofa, m", "Fokus yo‘qolgan", "Boshlangan", "Topshirilgan",
  ];
  const sorted = sortMonitorRows(data.rows);
  const rows = sorted
    .map(
      (r, i) =>
        `<Row>${[
          cell(i + 1),
          cell(r.fullName),
          cell(r.branchLabel || "—"),
          cell(statusText(r)),
          cell(r.score ?? ""),
          cell(r.correct ?? ""),
          cell(r.correct == null ? "" : Math.max(0, r.total - r.correct)),
          cell(r.total),
          cell(durationOf(r.durationSec, r.startedAt, r.submittedAt)),
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
<Worksheet ss:Name="Har bir javob"><Table>
 <Row>${["Xodim", "Ball %", "To‘g‘ri", "Jami", "Natija", "№", "Savol", "Tanlagan javob", "To‘g‘ri javob", "Holat"].map((h) => `<Cell ss:StyleID="sHead"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join("")}</Row>
 ${(data.answerSheets || [])
   .flatMap((sheet) =>
     sheet.items.map(
       (it) =>
         `<Row>${[
           cell(sheet.fullName),
           cell(sheet.score ?? ""),
           cell(sheet.correct ?? ""),
           cell(sheet.total),
           cell(sheet.passed == null ? "—" : sheet.passed ? "O‘tdi" : "O‘tmadi"),
           cell(it.number),
           cell(it.question),
           cell(it.chosenText),
           cell(it.correctText),
           cell(it.ok ? "To‘g‘ri" : "Noto‘g‘ri"),
         ].join("")}</Row>`,
     ),
   )
   .join("\n")}
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

function mins(sec: number | null) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const t = Math.max(0, Math.round(sec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  if (m <= 0) return `${s} sek`;
  if (s <= 0) return `${m} min`;
  return `${m} min / ${s} sek`;
}

function durationOf(sec: number | null, startedAt?: string | null, submittedAt?: string | null) {
  if (sec != null && Number.isFinite(sec)) return mins(sec);
  if (startedAt && submittedAt) {
    const ms = new Date(submittedAt).getTime() - new Date(startedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) return mins(Math.round(ms / 1000));
  }
  return "—";
}

function correctPair(correct: number | null, total: number) {
  if (correct == null) return "—";
  return `${correct}/${total}`;
}

function wrongOf(correct: number | null, total: number) {
  if (correct == null) return "—";
  return String(Math.max(0, total - correct));
}

function monitorSortRank(r: AttestMonitor["rows"][number]) {
  if ((r.status === "submitted" || r.status === "expired") && r.passed === true) return 0;
  if ((r.status === "submitted" || r.status === "expired") && r.passed === false) return 1;
  if (r.status === "not_started") return 2;
  if (r.status === "in_progress") return 3;
  return 4;
}

function sortMonitorRows(rows: AttestMonitor["rows"]) {
  return [...rows].sort((a, b) => {
    const d = monitorSortRank(a) - monitorSortRank(b);
    if (d) return d;
    // Yuqori ball → pastga: 100%, 97% … 0%
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    if (sa !== sb) return sb - sa;
    const ta = a.durationSec ?? Number.POSITIVE_INFINITY;
    const tb = b.durationSec ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.fullName.localeCompare(b.fullName, "uz");
  });
}

function monitorHolat(r: AttestMonitor["rows"][number]) {
  if (r.status === "submitted" || r.status === "expired") return r.passed ? "O‘tdi" : "O‘tmadi";
  return ATTEST_STATUS_LABEL[r.status];
}

export async function exportAttestPdf(data: AttestMonitor) {
  const pageWmm = 297;
  const pageHmm = 210;
  const scale = 2;
  const margin = 7;
  const contentW = Math.round(((pageWmm - margin * 2) / 25.4) * 160);
  const pages: HTMLCanvasElement[] = [];
  // № Xodim Filial Holat Ball To‘g‘ri Xato Vaqt Boshlangan Topshirildi
  const cols = [22, 118, 92, 54, 38, 52, 38, 78, 88, 88];
  const sum = cols.reduce((a, b) => a + b, 0);
  const ws = cols.map((w) => Math.floor((w / sum) * contentW));
  ws[ws.length - 1]! += contentW - ws.reduce((a, b) => a + b, 0);
  const headers = ["№", "Xodim", "Filial", "Holat", "Ball", "To‘g‘ri", "Xato", "min / sek", "Boshlangan", "Topshirildi"];
  const sorted = sortMonitorRows(data.rows);
  let i = 0;
  let pageNo = 0;
  const rowH = 26;
  while (i < sorted.length || pages.length === 0) {
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
    while (i < sorted.length && y + rowH < H - 24) {
      const r = sorted[i]!;
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
        monitorHolat(r),
        r.score != null ? `${r.score}%` : "—",
        correctPair(r.correct, r.total),
        wrongOf(r.correct, r.total),
        durationOf(r.durationSec, r.startedAt, r.submittedAt),
        formatAttestDt(r.startedAt),
        formatAttestDt(r.submittedAt),
      ];
      let x = x0;
      vals.forEach((v, n) => {
        ctx.fillStyle =
          n === 3 && r.passed
            ? "#065f46"
            : n === 3 && r.passed === false
              ? "#9f1239"
              : n === 6 && wrongOf(r.correct, r.total) !== "—" && wrongOf(r.correct, r.total) !== "0"
                ? "#9f1239"
                : n === 5 && r.correct != null
                  ? "#065f46"
                  : "#0f172a";
        ctx.fillText(truncate(ctx, v, ws[n]! - 8), x + 4, y + 17);
        x += ws[n]!;
      });
      y += rowH;
      i += 1;
    }
    pages.push(canvas);
    if (!sorted.length) break;
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
  if (r.missed || r.status === "not_started") return "Kirmagan";
  if (r.status === "in_progress") return "Ishlayapti";
  return ATTEST_STATUS_LABEL[r.status];
}

/** PDF/Excel: 1) o‘tganlar → 2) o‘tmaganlar → 3) kirmaganlar → 4) ishlayapti → 5) boshqa */
function resultSortRank(r: AttestResultRow) {
  const fin = r.status === "submitted" || r.status === "expired";
  if (fin && r.passed === true) return 0;
  if (fin && r.passed === false) return 1;
  if (r.missed || r.status === "not_started") return 2;
  if (r.status === "in_progress") return 3;
  return 4;
}

function sortResultRows(rows: AttestResultRow[]) {
  return [...rows].sort((a, b) => {
    const d = resultSortRank(a) - resultSortRank(b);
    if (d) return d;
    // Yuqori ball → pastga
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    if (sa !== sb) return sb - sa;
    const ta = a.durationSec ?? Number.POSITIVE_INFINITY;
    const tb = b.durationSec ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.fullName.localeCompare(b.fullName, "uz");
  });
}

function sheetRows(
  list: AttestResultRow[],
  headers: string[],
  mapRow: (r: AttestResultRow, i: number) => Array<string | number>,
) {
  return list
    .map((r, i) => `<Row>${mapRow(r, i).map((v) => cell(v)).join("")}</Row>`)
    .join("");
}

export async function exportAttestResultsExcel(data: AttestResults) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const headers = [
    "№", "Xodim", "Telefon", "Filial", "Atestatsiya", "Holat", "Ball %",
    "To‘g‘ri", "Xato", "Savollar", "Vaqt (min / sek)",
    "O‘tish bali", "Urinish", "Joy turi", "Aniqlangan joy",
    "Boshlangan", "Topshirilgan", "Oyna boshi", "Oyna oxiri",
  ];
  const mapRow = (r: AttestResultRow, i: number): Array<string | number> => [
    i + 1,
    r.fullName,
    r.phone || "—",
    r.branchLabel || "—",
    r.examTitle,
    resultStatus(r),
    r.score ?? "",
    r.correct ?? "",
    r.correct == null ? "" : Math.max(0, r.total - r.correct),
    r.total,
    durationOf(r.durationSec, r.startedAt, r.submittedAt),
    r.passScore,
    r.attemptsCount,
    r.locationMode === "anywhere" ? "Istalgan joy" : r.locationMode === "office" ? "Ofis" : "Filial",
    r.locationLabel || "—",
    formatAttestDt(r.startedAt),
    formatAttestDt(r.submittedAt),
    formatAttestDt(r.windowStart),
    formatAttestDt(r.windowEnd),
  ];
  const isFin = (r: AttestResultRow) => r.status === "submitted" || r.status === "expired";
  const passed = data.rows.filter((r) => isFin(r) && r.passed === true);
  const failed = data.rows.filter((r) => isFin(r) && r.passed === false);
  const missed = data.rows.filter((r) => r.missed || r.status === "not_started");
  const progress = data.rows.filter((r) => r.status === "in_progress");
  const s = data.stats;
  const head = headers.map((h) => `<Cell ss:StyleID="sHead"><Data ss:Type="String">${esc(h)}</Data></Cell>`).join("");
  const block = (title: string, list: AttestResultRow[]) =>
    `<Row><Cell ss:StyleID="sSec"><Data ss:Type="String">${esc(`${title} (${list.length})`)}</Data></Cell></Row>
     <Row>${head}</Row>
     ${sheetRows(list, headers, mapRow)}
     <Row/>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
 <Style ss:ID="sHead"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3A5C" ss:Pattern="Solid"/></Style>
 <Style ss:ID="sTitle"><Font ss:Size="14" ss:Bold="1" ss:Color="#0B3A5C"/></Style>
 <Style ss:ID="sSec"><Font ss:Bold="1" ss:Color="#0B3A5C"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/></Style>
</Styles>
<Worksheet ss:Name="Hisobot"><Table>
 <Row><Cell ss:StyleID="sTitle"><Data ss:Type="String">${esc(`Atestatsiya hisobot — ${data.trackLabel}`)}</Data></Cell></Row>
 <Row><Cell><Data ss:Type="String">${esc(`O‘tgan ${passed.length} · O‘tmagan ${failed.length} · Kirmagan ${missed.length} · Ishlayapti ${progress.length} · O‘tish ${s.passRate ?? "—"}%`)}</Data></Cell></Row>
 <Row/>
 ${block("O‘tganlar", passed)}
 ${block("O‘tmaganlar", failed)}
 ${block("Kirmaganlar", missed)}
 ${progress.length ? block("Ishlayapti", progress) : ""}
</Table></Worksheet>
<Worksheet ss:Name="Hammasi"><Table>
 <Row><Cell ss:StyleID="sTitle"><Data ss:Type="String">${esc(`Barcha qatorlar — ${data.trackLabel}`)}</Data></Cell></Row>
 <Row>${head}</Row>
 ${sheetRows(sortResultRows(data.rows), headers, mapRow)}
</Table></Worksheet>
</Workbook>`;
  await deliverFile(new Blob(["\uFEFF" + xml], { type: "application/vnd.ms-excel;charset=utf-8" }), `atestatsiya-hisobot-${stamp}.xls`);
}

export async function exportAttestResultsPdf(data: AttestResults) {
  const pageWmm = 297;
  const pageHmm = 210;
  const scale = 2;
  const margin = 7;
  const contentW = Math.round(((pageWmm - margin * 2) / 25.4) * 160);
  const headers = ["№", "Xodim", "Filial", "Atestatsiya", "Holat", "Ball", "To‘g‘ri", "Xato", "min / sek", "Boshlangan", "Topshirildi"];
  const cols = [20, 100, 82, 100, 54, 36, 48, 36, 72, 82, 82];
  const sum = cols.reduce((a, b) => a + b, 0);
  const ws = cols.map((w) => Math.floor((w / sum) * contentW));
  ws[ws.length - 1]! += contentW - ws.reduce((a, b) => a + b, 0);
  const sorted = sortResultRows(data.rows);
  const pages: HTMLCanvasElement[] = [];
  let i = 0;
  let pageNo = 0;
  const rowH = 26;
  while (i < sorted.length || pages.length === 0) {
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
        `O‘tgan ${s.passed} · O‘tmagan ${s.failed} · Kirmagan ${s.missed ?? s.notStarted} · Ishlayapti ${s.inProgress} · O‘tish ${s.passRate ?? "—"}% · ${pageNo}-sahifa`,
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
    while (i < sorted.length && y + rowH < H - 18) {
      const r = sorted[i]!;
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
        correctPair(r.correct, r.total),
        wrongOf(r.correct, r.total),
        durationOf(r.durationSec, r.startedAt, r.submittedAt),
        formatAttestDt(r.startedAt),
        formatAttestDt(r.submittedAt),
      ];
      x = x0;
      ctx.font = `11px ${FONT}`;
      vals.forEach((v, n) => {
        ctx.fillStyle =
          n === 4 && r.passed
            ? "#065f46"
            : n === 4 && r.passed === false
              ? "#9f1239"
              : n === 7 && wrongOf(r.correct, r.total) !== "—" && wrongOf(r.correct, r.total) !== "0"
                ? "#9f1239"
                : n === 6 && r.correct != null
                  ? "#065f46"
                  : "#0f172a";
        ctx.fillText(truncate(ctx, v, ws[n]! - 8), x + 4, y + 17);
        x += ws[n]!;
      });
      y += rowH;
      i += 1;
    }
    pages.push(canvas);
    if (!sorted.length) break;
  }
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pages.forEach((c, n) => {
    if (n) pdf.addPage("a4", "landscape");
    pdf.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, pageWmm, pageHmm);
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  await deliverFile(pdf.output("blob"), `atestatsiya-natijalar-${stamp}.pdf`);
}
