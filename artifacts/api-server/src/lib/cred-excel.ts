import type { Response } from "express";
import ExcelJS from "exceljs";

export function paintCredSheet(
  workbook: ExcelJS.Workbook,
  opts: {
    name: string;
    title: string;
    headers: string[];
    widths: number[];
    rows: Array<Array<string | number>>;
    monoCols?: number[];
  },
) {
  const sheet = workbook.addWorksheet(opts.name, {
    views: [{ state: "frozen", ySplit: 2 }],
    properties: { defaultRowHeight: 22 },
  });
  const lastCol = opts.headers.length;
  sheet.mergeCells(1, 1, 1, lastCol);
  const title = sheet.getCell("A1");
  title.value = opts.title;
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A5C" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(1).height = 30;
  opts.headers.forEach((h, i) => {
    const cell = sheet.getRow(2).getCell(i + 1);
    cell.value = h;
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A5F8A" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  sheet.columns = opts.widths.map((width) => ({ width }));
  const mono = new Set(opts.monoCols ?? [2, 3]);
  opts.rows.forEach((vals, idx) => {
    const row = sheet.addRow(vals);
    row.eachCell((cell, col) => {
      cell.font = {
        name: mono.has(col) ? "Consolas" : "Calibri",
        size: 10,
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: idx % 2 === 0 ? "FFF7FAFC" : "FFFFFFFF" },
      };
    });
  });
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: lastCol } };
}

export async function sendWorkbook(res: Response, workbook: ExcelJS.Workbook, filename: string) {
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const safe = String(filename || "export.xlsx")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
  const finalName = safe.toLowerCase().endsWith(".xlsx") ? safe : `${safe}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${finalName}"`);
  res.send(buffer);
}

export function newCredWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "VAKSINA MED HR";
  workbook.created = new Date();
  return workbook;
}
