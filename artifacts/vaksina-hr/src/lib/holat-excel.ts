import type { HolatPerson, HolatReport } from "./holat-api";

type Cell = string | number | null | undefined;

type SheetSpec = {
  name: string;
  title: string;
  subtitle: string;
  headers: string[];
  rows: Cell[][];
  widths: number[];
  statusCol?: number;
};

const NAVY = "FF0B3A5C";
const HEADER = "FF0F4A73";
const ZEBRA = "FFF4F8FB";
const WHITE = "FFFFFFFF";
const GREEN = "FFD1FAE5";
const AMBER = "FFFEF3C7";
const RED = "FFFECACA";
const ORANGE = "FFFDE68A";
const VIOLET = "FFEDE9FE";
const LINE = "FFD0D7DE";

function xml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dash(v: Cell) {
  if (v == null || v === "") return "—";
  return v;
}

function statusStyle(label: string) {
  const s = String(label).toLowerCase();
  if (s.includes("ishlay") || s.includes("ishlamoq")) return 5;
  if (s.includes("mudir yo")) return 6;
  if (s.includes("xodim bor")) return 5;
  if (s.includes("qo‘shilmagan") || s.includes("qoshilmagan")) return 6;
  if (s.includes("bo‘shagan") || s.includes("bo'shat") || s.includes("bo‘shat") || s.includes("tugat")) return 7;
  if (s.includes("kerak") || s.includes("yollash")) return 8;
  if (s.includes("qidir")) return 9;
  if (s.includes("faol")) return 5;
  return 4;
}

function colLetter(n: number) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array) {
  if (typeof CompressionStream === "undefined") return data;
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  await writer.write(data);
  await writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
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

async function zipFiles(files: { path: string; text: string }[]) {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();

  for (const f of files) {
    const name = enc.encode(f.path);
    const raw = enc.encode(f.text);
    const compressed = await deflateRaw(raw);
    const method = compressed.length < raw.length && typeof CompressionStream !== "undefined" ? 8 : 0;
    const payload = method === 8 ? compressed : raw;
    const crc = crc32(raw);
    const local = new Uint8Array(30 + name.length + payload.length);
    local.set([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 8], 0);
    local.set(u16(method), 8);
    local.set(u16(0), 10);
    local.set(u16(0), 12);
    local.set(u32(crc), 14);
    local.set(u32(payload.length), 18);
    local.set(u32(raw.length), 22);
    local.set(u16(name.length), 26);
    local.set(u16(0), 28);
    local.set(name, 30);
    local.set(payload, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    central.set([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 8], 0);
    central.set(u16(method), 10);
    central.set(u16(0), 12);
    central.set(u16(0), 14);
    central.set(u32(crc), 16);
    central.set(u32(payload.length), 20);
    central.set(u32(raw.length), 24);
    central.set(u16(name.length), 28);
    central.set(u16(0), 30);
    central.set(u16(0), 32);
    central.set(u16(0), 34);
    central.set(u16(0), 36);
    central.set(u32(0), 38);
    central.set(u32(offset), 42);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }

  const cdSize = centrals.reduce((n, x) => n + x.length, 0);
  const end = new Uint8Array(22);
  end.set([0x50, 0x4b, 0x05, 0x06], 0);
  end.set(u16(0), 4);
  end.set(u16(0), 6);
  end.set(u16(files.length), 8);
  end.set(u16(files.length), 10);
  end.set(u32(cdSize), 12);
  end.set(u32(offset), 16);
  end.set(u16(0), 20);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
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

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="10"/><color rgb="FF1E293B"/><name val="Calibri"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="11">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${NAVY}"/><bgColor rgb="${NAVY}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${HEADER}"/><bgColor rgb="${HEADER}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${ZEBRA}"/><bgColor rgb="${ZEBRA}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${WHITE}"/><bgColor rgb="${WHITE}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${GREEN}"/><bgColor rgb="${GREEN}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${AMBER}"/><bgColor rgb="${AMBER}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${RED}"/><bgColor rgb="${RED}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${ORANGE}"/><bgColor rgb="${ORANGE}"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="${VIOLET}"/><bgColor rgb="${VIOLET}"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border/>
    <border>
      <left style="thin"><color rgb="${LINE}"/></left>
      <right style="thin"><color rgb="${LINE}"/></right>
      <top style="thin"><color rgb="${LINE}"/></top>
      <bottom style="thin"><color rgb="${LINE}"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="10">
    <xf fontId="0" fillId="0" borderId="1" applyBorder="1"/>
    <xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyAlignment="1" applyBorder="1"><alignment vertical="center" horizontal="left"/></xf>
    <xf fontId="2" fillId="3" borderId="1" applyFont="1" applyFill="1" applyAlignment="1" applyBorder="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>
    <xf fontId="0" fillId="4" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf fontId="0" fillId="5" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf fontId="0" fillId="6" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>
    <xf fontId="0" fillId="7" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>
    <xf fontId="0" fillId="8" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>
    <xf fontId="0" fillId="9" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>
    <xf fontId="0" fillId="10" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>
  </cellXfs>
</styleSheet>`;
}

function sheetXml(spec: SheetSpec) {
  const cols = spec.headers.length;
  const lastCol = colLetter(cols);
  const headerRow = 3;
  const lastData = headerRow + spec.rows.length;
  const colXml = spec.widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  const titleRow = `<row r="1" ht="32" customHeight="1">${`<c r="A1" s="1" t="inlineStr"><is><t>${xml(spec.title)}</t></is></c>`}</row>`;
  const subRow = `<row r="2" ht="20" customHeight="1">${`<c r="A2" s="1" t="inlineStr"><is><t>${xml(spec.subtitle)}</t></is></c>`}</row>`;
  const headCells = spec.headers
    .map((h, i) => `<c r="${colLetter(i + 1)}${headerRow}" s="2" t="inlineStr"><is><t>${xml(h)}</t></is></c>`)
    .join("");
  const headRow = `<row r="${headerRow}" ht="26" customHeight="1">${headCells}</row>`;

  const dataRows = spec.rows
    .map((vals, ri) => {
      const r = headerRow + 1 + ri;
      const zebra = ri % 2 === 0 ? 3 : 4;
      const cells = spec.headers
        .map((_, i) => {
          const raw = dash(vals[i]);
          const ref = `${colLetter(i + 1)}${r}`;
          const isStatus = spec.statusCol === i + 1;
          const s = isStatus ? statusStyle(String(raw)) : zebra;
          if (typeof raw === "number") {
            return `<c r="${ref}" s="${s}"><v>${raw}</v></c>`;
          }
          return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(String(raw))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r}" ht="20" customHeight="1">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr><tabColor rgb="${NAVY}"/></sheetPr>
  <dimension ref="A1:${lastCol}${Math.max(lastData, headerRow)}"/>
  <sheetViews>
    <sheetView workbookViewId="0" showGridLines="0">
      <pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${colXml}</cols>
  <sheetData>${titleRow}${subRow}${headRow}${dataRows}</sheetData>
  <mergeCells count="2">
    <mergeCell ref="A1:${lastCol}1"/>
    <mergeCell ref="A2:${lastCol}2"/>
  </mergeCells>
  <autoFilter ref="A${headerRow}:${lastCol}${headerRow}"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;
}

function workbookXml(names: string[]) {
  const sheets = names
    .map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets}</sheets>
</workbook>`;
}

function workbookRels(count: number) {
  const rels = Array.from({ length: count }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  ${rels}
</Relationships>`;
}

function contentTypes(count: number) {
  const overrides = Array.from(
    { length: count },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${overrides}
</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

function personRow(p: HolatPerson, i: number): Cell[] {
  return [
    i + 1,
    p.firstName,
    p.lastName,
    p.fullName,
    p.position,
    p.orgRoleLabel,
    p.employmentStatusLabel,
    p.loginRoleLabel,
    p.login,
    p.phone,
    p.branch,
    p.coordinatorName,
    p.mudirName,
    p.departmentName,
    p.hiredAt,
    p.createdAt,
    p.createdByName,
  ];
}

const PEOPLE_H = [
  "№",
  "Ism",
  "Familiya",
  "F.I.Sh.",
  "Lavozim",
  "Tarmoq roli",
  "Holat",
  "Login roli",
  "Login",
  "Telefon",
  "Filial",
  "Koordinator",
  "Mudir",
  "Bo‘lim",
  "Ishga olingan",
  "Yaratilgan",
  "Qo‘shgan",
];
const PEOPLE_W = [6, 14, 16, 26, 16, 14, 14, 16, 16, 14, 22, 22, 22, 18, 14, 18, 22];

function sheetsFromReport(report: HolatReport): SheetSpec[] {
  const when = report.generatedAt;
  const scope = report.scoped ? "Faqat sizning tarmog‘ingiz" : "To‘liq tizim";
  const treeRows: Cell[][] = [];
  for (const c of report.coordinators) {
    if (!c.mudirs.length) {
      treeRows.push([
        c.fullName, "—", "—", "—", "—", c.position, "Koordinator",
        c.employmentStatusLabel, c.phone, c.hiredAt, c.createdAt, c.createdByName,
      ]);
    }
    for (const m of c.mudirs) {
      if (!m.staff.length) {
        treeRows.push([
          c.fullName, m.fullName, m.branch, m.firstName, m.lastName, m.position, "Mudir",
          m.employmentStatusLabel, m.phone, m.hiredAt, m.createdAt, m.createdByName,
        ]);
      }
      for (const s of m.staff) {
        treeRows.push([
          c.fullName, m.fullName, m.branch, s.firstName, s.lastName, s.position, s.orgRoleLabel,
          s.employmentStatusLabel, s.phone, s.hiredAt, s.createdAt, s.createdByName,
        ]);
      }
    }
  }

  return [
    {
      name: "Umumiy",
      title: "VAKSINA MED — Holat hisoboti",
      subtitle: `${when}  ·  ${scope}`,
      headers: ["Ko‘rsatkich", "Son", "Izoh"],
      widths: [36, 12, 42],
      rows: [
        ["Koordinatorlar (tarmoq)", report.pharmacyCounts.coordinators, "employees.org_role"],
        ["Mudirlar", report.pharmacyCounts.mudirs, "Filial mudirlari"],
        ["Farmasevtlar", report.pharmacyCounts.pharmacists, ""],
        ["Stajyorlar", report.pharmacyCounts.interns, ""],
        ["Tarmoq jami", report.pharmacyCounts.total, "Bo‘shatilganlar kirmaydi"],
        ["Login: koordinator", report.loginCounts.koordinator, "users.role, faol"],
        ["Login: mudir", report.loginCounts.mudir, ""],
        ["Login: farmasevt", report.loginCounts.farmasevt, ""],
        ["Login: stajyor", report.loginCounts.stajyor, ""],
        ["Bo‘limlar", report.office.departments, "departments"],
        ["Barcha xodimlar", report.office.employeesTotal, "employees"],
        ["Barcha loginlar", report.office.usersTotal, "users"],
        ["Filialda jamoa bor", report.branchesWithStaff.length, ""],
        ["Filialda jamoa yo‘q", report.branchesWithoutStaff.length, "Mudir bor, xodim yo‘q"],
      ],
    },
    {
      name: "Kim qoshgan",
      title: "Kim nechta odam qo‘shgan",
      subtitle: "created_by_id, yo‘q bo‘lsa tarmoq daraxti",
      headers: ["F.I.Sh.", "Rol", "Mudir", "Farmasevt", "Stajyor", "Jami", "User ID"],
      widths: [30, 18, 12, 14, 12, 10, 12],
      rows: report.addedBy.map((a) => [a.fullName, a.roleLabel, a.mudirs, a.pharmacists, a.interns, a.total, a.userId]),
    },
    {
      name: "Tarmoq daraxti",
      title: "Koordinator → mudir → xodim",
      subtitle: "Har qator — bitta odam",
      headers: ["Koordinator", "Mudir", "Filial", "Ism", "Familiya", "Lavozim", "Rol", "Holat", "Telefon", "Ishga olingan", "Yaratilgan", "Qo‘shgan"],
      widths: [24, 24, 22, 16, 16, 16, 14, 14, 16, 14, 18, 22],
      statusCol: 8,
      rows: treeRows,
    },
    {
      name: "Filiallar",
      title: "Filiallar — jamoa bor / yo‘q",
      subtitle: when,
      headers: ["Filial", "Mudir", "Koordinator", "Farmasevt", "Stajyor", "Jami xodim", "Holat"],
      widths: [26, 26, 24, 12, 12, 14, 20],
      statusCol: 7,
      rows: [
        ...report.branchesWithStaff.map((b) => [b.branch, b.mudirName, b.coordinatorName, b.pharmacistCount, b.internCount, b.staffCount, "Xodim bor"]),
        ...report.branchesWithoutStaff.map((b) => [b.branch, b.mudirName, b.coordinatorName, 0, 0, 0, "Xodim qo‘shilmagan"]),
      ],
    },
    {
      name: "Tarmoq xodimlari",
      title: "Tarmoq xodimlari (koordinator → stajyor)",
      subtitle: when,
      headers: PEOPLE_H,
      widths: PEOPLE_W,
      statusCol: 7,
      rows: report.networkPeople.map(personRow),
    },
    {
      name: "Barcha xodimlar",
      title: "Tizimdagi barcha xodimlar",
      subtitle: when,
      headers: PEOPLE_H,
      widths: PEOPLE_W,
      statusCol: 7,
      rows: report.allEmployees.map(personRow),
    },
    {
      name: "Bolimlar",
      title: "Bo‘limlar",
      subtitle: when,
      headers: ["ID", "Bo‘lim", "Rahbar", "Xodimlar soni", "Yaratilgan"],
      widths: [8, 32, 28, 16, 20],
      rows: report.departments.map((d) => [d.id, d.name, d.headName, d.employeeCount, d.createdAt]),
    },
    {
      name: "Loginlar",
      title: "Barcha foydalanuvchi loginlari",
      subtitle: when,
      headers: ["ID", "Ism", "Familiya", "F.I.Sh.", "Lavozim (rol)", "Login", "Telefon", "Bo‘lim", "Holat", "Yaratilgan"],
      widths: [8, 16, 16, 26, 18, 18, 16, 18, 12, 20],
      statusCol: 9,
      rows: report.allUsers.map((u) => [
        u.id, u.firstName, u.lastName, u.fullName, u.roleLabel, u.login, u.phone, u.departmentName, u.statusLabel, u.createdAt,
      ]),
    },
  ];
}

export async function downloadHolatXlsxFile(report: HolatReport) {
  const sheets = sheetsFromReport(report);
  const files = [
    { path: "[Content_Types].xml", text: contentTypes(sheets.length) },
    { path: "_rels/.rels", text: ROOT_RELS },
    { path: "xl/workbook.xml", text: workbookXml(sheets.map((s) => s.name)) },
    { path: "xl/_rels/workbook.xml.rels", text: workbookRels(sheets.length) },
    { path: "xl/styles.xml", text: stylesXml() },
    ...sheets.map((s, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })),
  ];
  const bytes = await zipFiles(files);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `VAKSINA_Holat_${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
