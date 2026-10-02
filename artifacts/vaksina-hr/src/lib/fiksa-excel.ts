import { deliverFile } from "./tg-download";

export type FiksaExcelRow = {
  userId: number;
  fullName: string;
  branch: string;
  position: string;
  salary: number;
};

export type FiksaExcelRead = {
  userId: number | null;
  name: string;
  salary: number;
};

const HEADERS = ["ID", "Xodim", "Filial", "Lavozim", "1 oylik fiksa"] as const;

function xml(s: string) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeXml(s: string) {
  return s
    .replace(/&#10;/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function zipStored(files: { path: string; text: string }[]) {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path);
    const raw = enc.encode(f.text);
    const crc = crc32(raw);
    const local = new Uint8Array(30 + name.length + raw.length);
    local.set([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0], 0);
    local.set(u16(0), 8);
    local.set(u32(crc), 14);
    local.set(u32(raw.length), 18);
    local.set(u32(raw.length), 22);
    local.set(u16(name.length), 26);
    local.set(name, 30);
    local.set(raw, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    central.set([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0], 0);
    central.set(u32(crc), 16);
    central.set(u32(raw.length), 20);
    central.set(u32(raw.length), 24);
    central.set(u16(name.length), 28);
    central.set(u32(offset), 42);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, x) => n + x.length, 0);
  const end = new Uint8Array(22);
  end.set([0x50, 0x4b, 0x05, 0x06], 0);
  end.set(u16(files.length), 8);
  end.set(u16(files.length), 10);
  end.set(u32(cdSize), 12);
  end.set(u32(offset), 16);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const x of locals) {
    out.set(x, p);
    p += x.length;
  }
  for (const x of centrals) {
    out.set(x, p);
    p += x.length;
  }
  out.set(end, p);
  return out;
}

function colLetter(n: number) {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function sheetXml(title: string, note: string, rows: FiksaExcelRow[]) {
  const titleRow = `<row r="1" ht="28" customHeight="1"><c r="A1" s="1" t="inlineStr"><is><t>${xml(title)}</t></is></c></row>`;
  const noteRow = `<row r="2" ht="20" customHeight="1"><c r="A2" s="1" t="inlineStr"><is><t>${xml(note)}</t></is></c></row>`;
  const head = HEADERS.map((h, i) => `<c r="${colLetter(i + 1)}3" s="2" t="inlineStr"><is><t>${xml(h)}</t></is></c>`).join("");
  const headRow = `<row r="3" ht="22" customHeight="1">${head}</row>`;
  const body = rows
    .map((row, index) => {
      const r = 4 + index;
      const zebra = index % 2 === 0 ? 3 : 4;
      const cells = [
        `<c r="A${r}" s="${zebra}"><v>${row.userId}</v></c>`,
        `<c r="B${r}" s="${zebra}" t="inlineStr"><is><t>${xml(row.fullName)}</t></is></c>`,
        `<c r="C${r}" s="${zebra}" t="inlineStr"><is><t>${xml(row.branch)}</t></is></c>`,
        `<c r="D${r}" s="${zebra}" t="inlineStr"><is><t>${xml(row.position)}</t></is></c>`,
        `<c r="E${r}" s="${zebra}"><v>${Math.max(0, Math.round(row.salary))}</v></c>`,
      ].join("");
      return `<row r="${r}" ht="20" customHeight="1">${cells}</row>`;
    })
    .join("");
  const last = Math.max(4, 3 + rows.length);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:E${last}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="12" customWidth="1"/>
    <col min="2" max="2" width="32" customWidth="1"/>
    <col min="3" max="3" width="28" customWidth="1"/>
    <col min="4" max="4" width="22" customWidth="1"/>
    <col min="5" max="5" width="18" customWidth="1"/>
  </cols>
  <sheetData>${titleRow}${noteRow}${headRow}${body}</sheetData>
  <mergeCells count="2"><mergeCell ref="A1:E1"/><mergeCell ref="A2:E2"/></mergeCells>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0B3A5C"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  </fills>
  <borders count="2"><border/><border>
    <left style="thin"><color rgb="FFCBD5E1"/></left>
    <right style="thin"><color rgb="FFCBD5E1"/></right>
    <top style="thin"><color rgb="FFCBD5E1"/></top>
    <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
  </border></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="5">
    <xf fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
    <xf fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
  </cellXfs>
</styleSheet>`;

function workbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Fiksa" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

export function buildFiksaWorkbook(title: string, note: string, rows: FiksaExcelRow[]) {
  const bytes = zipStored([
    { path: "[Content_Types].xml", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>` },
    { path: "_rels/.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { path: "xl/workbook.xml", text: workbookXml() },
    { path: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { path: "xl/styles.xml", text: STYLES },
    { path: "xl/worksheets/sheet1.xml", text: sheetXml(title, note, rows) },
  ]);
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function downloadFiksaExcel(month: string, title: string, rows: FiksaExcelRow[]) {
  const note = "Faqat «1 oylik fiksa» ustunini o‘zgartiring. ID ni o‘chirmang. Keyin shu faylni qayta yuklang.";
  const blob = buildFiksaWorkbook(title, note, rows);
  await deliverFile(blob, `fiksa-${month}.xlsx`);
}

function colIndex(ref: string) {
  const letters = /^([A-Z]+)/i.exec(ref)?.[1]?.toUpperCase() || "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function headerKind(raw: string): "id" | "name" | "fiksa" | null {
  const h = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (!h) return null;
  if (h === "id" || h === "user id" || h === "userid" || h === "xodim id") return "id";
  if (h === "xodim" || h === "ism" || h.includes("familiya") || h === "f.i.sh." || h === "fio") return "name";
  if (h.includes("fiksa") && !h.includes("kunlik")) return "fiksa";
  return null;
}

export function parseFiksaAmount(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : null;
  let s = String(raw).replace(/\u00a0/g, " ").trim();
  if (!s || s === "—" || s === "-" || s === "–") return null;
  s = s.replace(/so['’‘]m|сум/gi, "").trim();
  if (/^\d{1,3}(?:[ .]\d{3})+$/.test(s)) s = s.replace(/[ .]/g, "");
  else if (/^\d{1,3}(?:,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function textsOf(block: string) {
  return [...block.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map((m) => unescapeXml(m[1] || "")).join("");
}

function sharedStrings(xmlText: string) {
  const out: string[] = [];
  for (const m of xmlText.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) out.push(textsOf(m[1] || ""));
  return out;
}

function cellValue(inner: string, attrs: string, shared: string[]): string | number | null {
  const type = /\bt="([^"]+)"/.exec(attrs)?.[1] || "";
  if (type === "inlineStr") {
    const text = textsOf(inner);
    return text || null;
  }
  const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i.exec(inner)?.[1] ?? "";
  if (type === "s") return shared[Number(v)] ?? "";
  if (type === "str") return unescapeXml(v);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : unescapeXml(v);
}

export function matrixFromSheetXml(sheet: string, shared: string[] = []) {
  const rows: (string | number | null)[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells: (string | number | null)[] = [];
    for (const cell of (row[1] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const attrs = cell[1] || "";
      const ref = /\br="([^"]+)"/.exec(attrs)?.[1] || "";
      const index = ref ? colIndex(ref) : cells.length;
      cells[index] = cellValue(cell[2] || "", attrs, shared);
    }
    rows.push(cells);
  }
  return rows;
}

function matrixFromSpreadsheetMl(xmlText: string) {
  const rows: (string | number | null)[][] = [];
  for (const row of xmlText.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/gi)) {
    const cells: (string | number | null)[] = [];
    let cursor = 0;
    for (const cell of (row[1] || "").matchAll(/<Cell\b([^>]*?)>([\s\S]*?)<\/Cell>/gi)) {
      const indexAttr = /\bss:Index="(\d+)"/i.exec(cell[1] || "")?.[1];
      const index = indexAttr ? Number(indexAttr) - 1 : cursor;
      const data = /<Data\b[^>]*>([\s\S]*?)<\/Data>/i.exec(cell[2] || "")?.[1] ?? "";
      const type = /\bss:Type="([^"]+)"/i.exec(cell[2] || "")?.[1] || "String";
      const text = unescapeXml(data).trim();
      cells[index] = type === "Number" ? Number(text) : text;
      cursor = index + 1;
    }
    rows.push(cells);
  }
  return rows;
}

function matrixFromCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const delim = (lines[0] || "").includes(";") && !(lines[0] || "").includes(",") ? ";" : ",";
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let quote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (quote && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quote = !quote;
      } else if (ch === delim && !quote) {
        cells.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

export function readsFromMatrix(rows: (string | number | null)[][]): FiksaExcelRead[] {
  let header = -1;
  let idCol = -1;
  let nameCol = -1;
  let fiksaCol = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const kinds = (rows[i] || []).map((cell) => headerKind(String(cell ?? "")));
    const fiksa = kinds.findIndex((k) => k === "fiksa");
    const id = kinds.findIndex((k) => k === "id");
    const name = kinds.findIndex((k) => k === "name");
    if (fiksa < 0 || (id < 0 && name < 0)) continue;
    header = i;
    fiksaCol = fiksa;
    idCol = id;
    nameCol = name;
    break;
  }
  if (header < 0 || fiksaCol < 0) throw new Error("Excelda «1 oylik fiksa» ustuni topilmadi");
  const out: FiksaExcelRead[] = [];
  for (const row of rows.slice(header + 1)) {
    const salary = parseFiksaAmount(row[fiksaCol]);
    if (salary == null) continue;
    const idRaw = idCol >= 0 ? row[idCol] : null;
    const userId = typeof idRaw === "number" ? idRaw : Number(String(idRaw ?? "").trim());
    const name = nameCol >= 0 ? String(row[nameCol] ?? "").trim() : "";
    if (!Number.isFinite(userId) && !name) continue;
    out.push({ userId: Number.isFinite(userId) && userId > 0 ? Math.round(userId) : null, name, salary });
  }
  return out;
}

async function inflateRaw(raw: Uint8Array) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Excel fayl siqilgan. Qayta yuklashdan oldin .xlsx qilib saqlang.");
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZip(buf: Uint8Array) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Excel fayl ochilmadi");
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const files = new Map<string, string>();
  const dec = new TextDecoder("utf-8");
  for (let n = 0; n < count; n++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOff = view.getUint32(pos + 42, true);
    const name = dec.decode(buf.subarray(pos + 46, pos + 46 + nameLen));
    const localNameLen = view.getUint16(localOff + 26, true);
    const localExtra = view.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + localNameLen + localExtra;
    const compressed = buf.subarray(dataOff, dataOff + compSize);
    const data = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
    if (!data) throw new Error("Bu Excel fayl formati o‘qilmadi");
    files.set(name.replace(/\\/g, "/"), dec.decode(data));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

export async function readFiksaExcel(file: File): Promise<FiksaExcelRead[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder("utf-8").decode(buf.subarray(0, 80)).trim();
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const files = await readZip(buf);
    const shared = sharedStrings(files.get("xl/sharedStrings.xml") || "");
    const sheet =
      [...files.keys()].find((name) => /xl\/worksheets\/sheet\d+\.xml$/i.test(name)) ||
      [...files.keys()].find((name) => name.endsWith(".xml") && name.includes("worksheet"));
    if (!sheet) throw new Error("Excel varag‘i topilmadi");
    return readsFromMatrix(matrixFromSheetXml(files.get(sheet) || "", shared));
  }
  const text = new TextDecoder("utf-8").decode(buf);
  if (/urn:schemas-microsoft-com:office:spreadsheet/i.test(head) || /<Workbook[\s>]/i.test(text.slice(0, 500))) {
    return readsFromMatrix(matrixFromSpreadsheetMl(text));
  }
  return readsFromMatrix(matrixFromCsv(text));
}
