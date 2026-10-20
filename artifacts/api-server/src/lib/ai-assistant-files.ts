/**
 * Yordamchi AI — admin buyrug'i bilan fayl tayyorlash (PDF / Excel).
 * Ma'lumot faqat jonli bazadan olinadi; AI faqat qaysi dataset/format kerakligini aytadi.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { desc, eq, gte } from "drizzle-orm";
import {
  db,
  usersTable,
  attendanceRecordsTable,
  attestatsiyaAttemptsTable,
  attestatsiyaExamsTable,
} from "@workspace/db";
import { resolveUserBranches } from "./employee-branch";

export type AssistantFileFormat = "pdf" | "excel";
export type AssistantDataset =
  | "employees"
  | "davomat_today"
  | "davomat_month"
  | "atestatsiya_results"
  | "custom_table";

export type AssistantFileRequest = {
  format: AssistantFileFormat;
  dataset: AssistantDataset;
  title?: string;
  columns?: string[];
  rows?: string[][];
};

export type BuiltAssistantFile = {
  buffer: Buffer;
  filename: string;
  mime: string;
  title: string;
  rowCount: number;
};

const MAX_ROWS = 3000;

function todayTashkent(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
}

function fmtTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
}

function fmtDateTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
}

function slug(s: string): string {
  const t = s
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return t || "hisobot";
}

type Table = { title: string; columns: string[]; rows: string[][] };

async function datasetTable(req: AssistantFileRequest): Promise<Table> {
  const today = todayTashkent();

  if (req.dataset === "employees") {
    const users = await db
      .select({
        id: usersTable.id,
        fullName: usersTable.fullName,
        role: usersTable.role,
        login: usersTable.login,
        phone: usersTable.phone,
        status: usersTable.status,
      })
      .from(usersTable)
      .orderBy(usersTable.fullName)
      .limit(MAX_ROWS);
    const branches = await resolveUserBranches(users.map((u) => u.id)).catch(
      () => new Map<number, { label?: string }>(),
    );
    return {
      title: req.title || "Xodimlar ro'yxati",
      columns: ["№", "F.I.Sh.", "Rol", "Filial", "Telefon", "Login", "Holat"],
      rows: users.map((u, i) => [
        String(i + 1),
        u.fullName,
        u.role,
        branches.get(u.id)?.label || "—",
        u.phone || "—",
        u.login,
        u.status,
      ]),
    };
  }

  if (req.dataset === "davomat_today" || req.dataset === "davomat_month") {
    const from = req.dataset === "davomat_today" ? today : `${today.slice(0, 8)}01`;
    const recs = await db
      .select({
        workDate: attendanceRecordsTable.workDate,
        checkInAt: attendanceRecordsTable.checkInAt,
        checkOutAt: attendanceRecordsTable.checkOutAt,
        status: attendanceRecordsTable.status,
        userId: attendanceRecordsTable.userId,
        fullName: usersTable.fullName,
      })
      .from(attendanceRecordsTable)
      .leftJoin(usersTable, eq(attendanceRecordsTable.userId, usersTable.id))
      .where(gte(attendanceRecordsTable.workDate, from))
      .orderBy(desc(attendanceRecordsTable.workDate), usersTable.fullName)
      .limit(MAX_ROWS);
    const branches = await resolveUserBranches(
      recs.map((r) => r.userId).filter((n): n is number => Boolean(n)),
    ).catch(() => new Map<number, { label?: string }>());
    return {
      title: req.title || (req.dataset === "davomat_today" ? `Davomat — ${today}` : `Davomat — ${from} dan`),
      columns: ["Sana", "F.I.Sh.", "Filial", "Keldi", "Ketdi", "Holat"],
      rows: recs.map((r) => [
        r.workDate,
        r.fullName || "—",
        (r.userId ? branches.get(r.userId)?.label : undefined) || "—",
        fmtTime(r.checkInAt),
        fmtTime(r.checkOutAt),
        r.status,
      ]),
    };
  }

  if (req.dataset === "atestatsiya_results") {
    const rows = await db
      .select({
        fullName: usersTable.fullName,
        title: attestatsiyaExamsTable.title,
        score: attestatsiyaAttemptsTable.score,
        passed: attestatsiyaAttemptsTable.passed,
        status: attestatsiyaAttemptsTable.status,
        startedAt: attestatsiyaAttemptsTable.startedAt,
      })
      .from(attestatsiyaAttemptsTable)
      .innerJoin(attestatsiyaExamsTable, eq(attestatsiyaAttemptsTable.examId, attestatsiyaExamsTable.id))
      .leftJoin(usersTable, eq(attestatsiyaAttemptsTable.userId, usersTable.id))
      .orderBy(desc(attestatsiyaAttemptsTable.startedAt))
      .limit(500);
    return {
      title: req.title || "Atestatsiya natijalari (oxirgi 500)",
      columns: ["F.I.Sh.", "Test", "Ball", "Natija", "Holat", "Sana"],
      rows: rows.map((r) => [
        r.fullName || "—",
        r.title,
        r.score == null ? "—" : String(r.score),
        r.passed == null ? "—" : r.passed ? "O'tdi" : "O'tmadi",
        r.status,
        fmtDateTime(r.startedAt),
      ]),
    };
  }

  // custom_table — AI snapshotda ko'rgan jadvalni o'zi beradi
  const columns = (req.columns || []).map((c) => String(c).slice(0, 60)).slice(0, 12);
  const rows = (req.rows || [])
    .slice(0, MAX_ROWS)
    .map((r) => columns.map((_, i) => String((r || [])[i] ?? "").slice(0, 300)));
  if (!columns.length || !rows.length) {
    throw new Error("Jadval ma'lumoti bo'sh — avval ma'lumotni aniqlashtiring");
  }
  return { title: req.title || "Hisobot", columns, rows };
}

/* ------------------------------------------------------------------ Excel */

async function buildExcel(table: Table): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(table.title.slice(0, 31) || "Hisobot");
  const header = ws.addRow(table.columns);
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A5C" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  for (const r of table.rows) ws.addRow(r);
  table.columns.forEach((c, i) => {
    let max = c.length;
    for (const r of table.rows) max = Math.max(max, (r[i] || "").length);
    ws.getColumn(i + 1).width = Math.min(Math.max(10, max * 1.05 + 2), 48);
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.columns.length } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* -------------------------------------------------------------------- PDF */

async function readFont(file: string): Promise<Buffer> {
  const candidates = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts", file),
    path.join(process.cwd(), "dist", "fonts", file),
    path.join(process.cwd(), "assets", "fonts", file),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "fonts", file),
  ];
  for (const p of candidates) {
    try {
      return await readFile(p);
    } catch {
      /* keyingi yo'l */
    }
  }
  throw new Error(`PDF shrifti topilmadi: ${file}`);
}

function fit(text: string, font: PDFFont, size: number, max: number): string {
  const t = String(text || "").replace(/\s+/g, " ").trim() || "—";
  if (font.widthOfTextAtSize(t, size) <= max) return t;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > max) s = s.slice(0, -1);
  return `${s}…`;
}

async function buildPdf(table: Table): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFont("DejaVuSans.ttf"), { subset: true });
  const bold = await doc.embedFont(await readFont("DejaVuSans-Bold.ttf"), { subset: true });

  const landscape = table.columns.length >= 6;
  const PW = landscape ? 841.89 : 595.28;
  const PH = landscape ? 595.28 : 841.89;
  const M = 28;
  const usable = PW - M * 2;

  const weights = table.columns.map((c, i) => {
    let max = c.length;
    for (const r of table.rows.slice(0, 200)) max = Math.max(max, Math.min((r[i] || "").length, 34));
    return Math.max(4, max);
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.max(34, (w / sum) * usable));

  const NAVY = rgb(0.043, 0.227, 0.361);
  const INK = rgb(0.06, 0.09, 0.16);
  const MUTED = rgb(0.39, 0.45, 0.55);
  const ZEBRA = rgb(0.953, 0.965, 0.984);
  const dateLine = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  let page = doc.addPage([PW, PH]);
  let y = PH - M;
  let pageNo = 1;

  const drawTitle = () => {
    page.drawText(fit(table.title, bold, 13, usable), { x: M, y: y - 13, size: 13, font: bold, color: NAVY });
    y -= 20;
    page.drawText(`VAKSINA MED HR · ${dateLine} · ${table.rows.length} qator`, {
      x: M, y: y - 9, size: 9, font, color: MUTED,
    });
    y -= 22;
  };
  const drawHeader = () => {
    let x = M;
    page.drawRectangle({ x: M, y: y - 15, width: usable, height: 15, color: NAVY });
    table.columns.forEach((c, i) => {
      page.drawText(fit(c, bold, 8, widths[i]! - 6), {
        x: x + 3, y: y - 11, size: 8, font: bold, color: rgb(1, 1, 1),
      });
      x += widths[i]!;
    });
    y -= 15;
  };
  const newPage = () => {
    page = doc.addPage([PW, PH]);
    pageNo += 1;
    y = PH - M;
    drawHeader();
  };

  drawTitle();
  drawHeader();
  table.rows.forEach((r, idx) => {
    if (y < M + 18) newPage();
    if (idx % 2 === 1) page.drawRectangle({ x: M, y: y - 13, width: usable, height: 13, color: ZEBRA });
    let x = M;
    r.forEach((cell, i) => {
      page.drawText(fit(cell, font, 8, widths[i]! - 6), { x: x + 3, y: y - 10, size: 8, font, color: INK });
      x += widths[i]!;
    });
    y -= 13;
  });
  page.drawText(`${pageNo}-bet`, { x: PW - M - 40, y: 14, size: 8, font, color: MUTED });

  return Buffer.from(await doc.save());
}

/* ------------------------------------------------------------------ public */

export async function buildAssistantFile(req: AssistantFileRequest): Promise<BuiltAssistantFile> {
  const table = await datasetTable(req);
  if (!table.rows.length) throw new Error("So'ralgan ma'lumot bazada topilmadi (bo'sh)");
  const isExcel = req.format === "excel";
  const buffer = isExcel ? await buildExcel(table) : await buildPdf(table);
  const ext = isExcel ? "xlsx" : "pdf";
  return {
    buffer,
    filename: `${slug(table.title)}-${todayTashkent()}.${ext}`,
    mime: isExcel
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf",
    title: table.title,
    rowCount: table.rows.length,
  };
}