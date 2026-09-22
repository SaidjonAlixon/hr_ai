import ExcelJS from "exceljs";
import type { StaffingMonitorReport, StaffNeedItem } from "./filial-staffing-monitor";

function urgencyRank(days: number): number {
  if (days >= 30) return 0;
  if (days >= 14) return 1;
  if (days >= 7) return 2;
  return 3;
}

function urgencyFill(days: number): string {
  if (days >= 30) return "FFDC2626";
  if (days >= 14) return "FFF97316";
  if (days >= 7) return "FFFBBF24";
  return "FF22C55E";
}

function statusFill(status: string): string {
  if (status === "dismissed") return "FF1F2937";
  if (status === "need_hire" || status === "new") return "FFEA580C";
  if (status === "searching") return "FFCA8A04";
  return "FF64748B";
}

function headerStyle(cell: ExcelJS.Cell, bg = "FF0B5FFF") {
  cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
}

/** Professional Excel — ochiq ehtiyojlar to‘liq */
export async function buildStaffingMonitorExcel(report: StaffingMonitorReport): Promise<{
  buffer: Buffer;
  filename: string;
  count: number;
}> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Vaksina lokatsiya";
  wb.created = report.generatedAt;

  // ── Sheet: Sarlavha ──
  const cover = wb.addWorksheet("Sarlavha", { views: [{ showGridLines: false }] });
  cover.columns = [{ width: 28 }, { width: 36 }, { width: 22 }, { width: 22 }];

  cover.mergeCells("A1:D1");
  const t1 = cover.getCell("A1");
  t1.value = "VAKSINA — XODIM EHTIYOJI (JONLI)";
  t1.font = { name: "Calibri", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
  t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A2540" } };
  t1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  cover.getRow(1).height = 36;

  cover.mergeCells("A2:D2");
  const t2 = cover.getCell("A2");
  t2.value = `${report.generatedAtLabel} (Toshkent) · Faqat ochiq ehtiyojlar (to‘ldirilgan joylar hisobga olinmagan)`;
  t2.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF334155" } };
  t2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
  cover.getRow(2).height = 22;

  const stats: Array<[string, string | number, string]> = [
    ["Jami ochiq ehtiyoj", report.totalNeeds, "FFDC2626"],
    ["Yollash kerak (need_hire)", report.needHireCount, "FFEA580C"],
    ["Bo‘shatilgan (ochiq)", report.dismissedCount, "FF1F2937"],
    ["Qidirilmoqda", report.searchingCount, "FFCA8A04"],
    ["Ehtiyojli filial", `${report.gapBranches} / ${report.totalBranches}`, "FF0B5FFF"],
    ["To‘liq filial (OK)", `${report.okBranches} / ${report.totalBranches}`, "FF16A34A"],
    ["Kritik (≥30 kun)", report.items.filter((i) => i.daysOpen >= 30).length, "FF991B1B"],
    ["Uzoq (≥14 kun)", report.items.filter((i) => i.daysOpen >= 14 && i.daysOpen < 30).length, "FFC2410C"],
  ];

  cover.getCell("A4").value = "KO‘RSATKICH";
  cover.getCell("B4").value = "QIYMAT";
  headerStyle(cover.getCell("A4"), "FF0A2540");
  headerStyle(cover.getCell("B4"), "FF0A2540");

  stats.forEach((row, i) => {
    const r = 5 + i;
    cover.getCell(`A${r}`).value = row[0];
    cover.getCell(`B${r}`).value = row[1];
    cover.getCell(`A${r}`).font = { name: "Calibri", size: 11, bold: true };
    cover.getCell(`B${r}`).font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    cover.getCell(`B${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: row[2] } };
    cover.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
    cover.getRow(r).height = 24;
  });

  cover.getCell("A14").value = "Tahlil";
  cover.getCell("A14").font = { bold: true, size: 12, color: { argb: "FF0B5FFF" } };
  cover.mergeCells("A15:D16");
  cover.getCell("A15").value = report.analysisLine;
  cover.getCell("A15").alignment = { wrapText: true, vertical: "top" };

  cover.getCell("A18").value = "Urgency ranglar";
  cover.getCell("A18").font = { bold: true };
  const legend = [
    ["A19", "≥30 kun — KRITIK", "FFDC2626"],
    ["A20", "14–29 kun — YUQORI", "FFF97316"],
    ["A21", "7–13 kun — O‘RTACHA", "FFFBBF24"],
    ["A22", "0–6 kun — YANGI", "FF22C55E"],
  ] as const;
  for (const [cell, label, color] of legend) {
    cover.getCell(cell).value = label;
    cover.getCell(cell).font = { bold: true, color: { argb: "FFFFFFFF" } };
    cover.getCell(cell).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  }

  // ── Sheet: Ochiq ehtiyojlar ──
  const sheet = wb.addWorksheet("Ochiq ehtiyojlar", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  const headers = [
    "№",
    "Urgency",
    "Kun ochiq",
    "Holat",
    "Filial",
    "Tuman",
    "Lavozim",
    "Smena",
    "Bo‘shagan / kartochka",
    "Lavozim (batafsil)",
    "Mudir (ism)",
    "Mudir telefon",
    "Koordinator",
    "Koordinator telefon",
    "Filial telefon",
    "Ochilgan sana",
    "Workflow",
    "Alert ID",
  ];

  sheet.mergeCells(1, 1, 1, headers.length);
  const title = sheet.getCell(1, 1);
  title.value = `Ochiq xodim ehtiyoji · ${report.totalNeeds} ta · ${report.generatedAtLabel} · to‘ldirilgan joylar chiqarilmagan`;
  title.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A2540" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(1).height = 28;

  const headerRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    headerStyle(cell);
  });
  headerRow.height = 26;

  sheet.columns = [
    { width: 5 },
    { width: 14 },
    { width: 11 },
    { width: 14 },
    { width: 28 },
    { width: 18 },
    { width: 12 },
    { width: 16 },
    { width: 24 },
    { width: 18 },
    { width: 22 },
    { width: 16 },
    { width: 22 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
    { width: 12 },
    { width: 10 },
  ];

  const sorted = [...report.items].sort((a, b) => {
    const ua = urgencyRank(a.daysOpen);
    const ub = urgencyRank(b.daysOpen);
    if (ua !== ub) return ua - ub;
    if (b.daysOpen !== a.daysOpen) return b.daysOpen - a.daysOpen;
    return a.branch.localeCompare(b.branch, "uz");
  });

  sorted.forEach((it: StaffNeedItem, idx: number) => {
    const row = sheet.addRow([
      idx + 1,
      it.urgencyLabel,
      it.daysOpen,
      it.statusLabel,
      it.branch,
      it.district,
      it.roleLabel,
      it.shift,
      it.employeeName,
      it.position || "—",
      it.mudirName || "—",
      it.mudirPhone || "—",
      it.coordinatorName || "—",
      it.coordinatorPhone || "—",
      it.branchPhone || "—",
      it.openedAtLabel,
      it.workflowStatus,
      it.alertId,
    ]);

    const zebra = idx % 2 === 0 ? "FFF8FAFC" : "FFFFFFFF";
    row.eachCell((cell, col) => {
      cell.font = { name: "Calibri", size: 10, bold: col === 5 || col === 2 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
      cell.alignment = {
        vertical: "middle",
        horizontal: col === 1 || col === 3 || col === 18 ? "center" : "left",
        wrapText: true,
      };
    });

    // Urgency cell color
    const urg = row.getCell(2);
    urg.fill = { type: "pattern", pattern: "solid", fgColor: { argb: urgencyFill(it.daysOpen) } };
    urg.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };

    // Status cell
    const st = row.getCell(4);
    st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: statusFill(it.status) } };
    st.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };

    row.height = 22;
  });

  // AutoFilter
  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2 + sorted.length, column: headers.length },
  };

  // ── Sheet: Tumanlar ──
  const dist = wb.addWorksheet("Tumanlar");
  dist.columns = [{ width: 6 }, { width: 24 }, { width: 12 }, { width: 12 }];
  dist.getCell("A1").value = "Tumanlar bo‘yicha ochiq ehtiyoj";
  dist.mergeCells("A1:D1");
  headerStyle(dist.getCell("A1"), "FF0A2540");
  ["№", "Tuman", "Soni", "Ulush %"].forEach((h, i) => {
    const c = dist.getCell(2, i + 1);
    c.value = h;
    headerStyle(c);
  });
  report.byDistrict.forEach((d, i) => {
    dist.addRow([i + 1, d.label, d.count, d.pct]);
  });

  // ── Sheet: Smenalar ──
  const sh = wb.addWorksheet("Smenalar");
  sh.columns = [{ width: 6 }, { width: 24 }, { width: 12 }, { width: 12 }];
  sh.getCell("A1").value = "Smena bo‘yicha ochiq ehtiyoj";
  sh.mergeCells("A1:D1");
  headerStyle(sh.getCell("A1"), "FF0A2540");
  ["№", "Smena", "Soni", "Ulush %"].forEach((h, i) => {
    const c = sh.getCell(2, i + 1);
    c.value = h;
    headerStyle(c);
  });
  report.byShift.forEach((d, i) => {
    sh.addRow([i + 1, d.label, d.count, d.pct]);
  });

  // ── Sheet: Lavozim ──
  const roles = wb.addWorksheet("Lavozimlar");
  roles.columns = [{ width: 6 }, { width: 18 }, { width: 12 }, { width: 12 }];
  roles.getCell("A1").value = "Lavozim bo‘yicha";
  roles.mergeCells("A1:D1");
  headerStyle(roles.getCell("A1"), "FF0A2540");
  ["№", "Lavozim", "Soni", "Ulush %"].forEach((h, i) => {
    const c = roles.getCell(2, i + 1);
    c.value = h;
    headerStyle(c);
  });
  report.byRole.forEach((d, i) => {
    roles.addRow([i + 1, d.label, d.count, d.pct]);
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return {
    buffer,
    filename: `vaksina-xodim-ehtiyoji_${stamp}.xlsx`,
    count: sorted.length,
  };
}
