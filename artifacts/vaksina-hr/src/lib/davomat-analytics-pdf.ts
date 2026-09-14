/** Davomat Dashboard PDF — filtrdagi barcha ko‘rinadigan bloklar. */

import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";

const FONT =
  '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

export type AnalyticsPdfShare = { onTime: number; late: number; absent: number };
export type AnalyticsPdfDay = {
  date: string;
  label: string;
  onTime: number;
  late: number;
  absent: number;
};
export type AnalyticsPdfNamedRate = {
  name: string;
  attendanceRate: number;
  headcount?: number;
  present?: number;
  late?: number;
  absent?: number;
};
export type AnalyticsPdfPerson = {
  fullName: string;
  meta?: string;
  status?: string;
  checkIn?: string | null;
  lateMinutes?: number;
};
export type AnalyticsPdfLate = {
  fullName: string;
  departmentName?: string | null;
  lateDays: number;
  lateMinutes: number;
};

export type DavomatAnalyticsPdfInput = {
  title: string;
  subtitle: string;
  filterLine: string;
  fileBase: string;
  /** 1 kun → portret, aks holda albom */
  singleDay: boolean;
  kpis: Array<{ label: string; value: string; sub?: string }>;
  share: AnalyticsPdfShare;
  shareTitle: string;
  dynamics: AnalyticsPdfDay[];
  branches: AnalyticsPdfNamedRate[];
  branchTitle: string;
  shifts: AnalyticsPdfNamedRate[];
  roles: AnalyticsPdfNamedRate[];
  officeOnTime: AnalyticsPdfPerson[];
  officeLate: AnalyticsPdfPerson[];
  officeAbsent: AnalyticsPdfPerson[];
  officeTitle?: string;
  branchOpenings?: AnalyticsPdfPerson[];
  branchOpenTitle?: string;
  topLate: AnalyticsPdfLate[];
  recent: Array<{ fullName: string; departmentName?: string | null; checkIn: string; statusLabel: string }>;
  deptTable: AnalyticsPdfNamedRate[];
};

function mmToPx(mm: number, dpi = 144): number {
  return Math.round((mm / 25.4) * dpi);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  const t = String(text || "");
  if (ctx.measureText(t).width <= maxW) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function createPage(pageWmm: number, pageHmm: number) {
  const scale = 2;
  const W = mmToPx(pageWmm) * scale;
  const H = mmToPx(pageHmm) * scale;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas ishlamaydi");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.scale(scale, scale);
  return { canvas, ctx, W: W / scale, H: H / scale, margin: mmToPx(10) };
}

type PageBag = ReturnType<typeof createPage> & { y: number; contentW: number };

function ensureSpace(bag: PageBag, pages: HTMLCanvasElement[], need: number, pageWmm: number, pageHmm: number) {
  if (bag.y + need < bag.H - bag.margin) return bag;
  pages.push(bag.canvas);
  const next = createPage(pageWmm, pageHmm);
  return {
    ...next,
    y: next.margin + 8,
    contentW: next.W - next.margin * 2,
  };
}

function drawTitle(bag: PageBag, title: string, subtitle: string, filterLine: string, pageNo: number) {
  const { ctx, margin, contentW } = bag;
  let y = bag.y;
  ctx.fillStyle = "#0b3a5c";
  ctx.font = `bold 18px ${FONT}`;
  ctx.fillText(truncate(ctx, title, contentW - 80), margin, y);
  ctx.textAlign = "right";
  ctx.fillStyle = "#94a3b8";
  ctx.font = `10px ${FONT}`;
  ctx.fillText(`${pageNo}-sahifa`, margin + contentW, y);
  ctx.textAlign = "left";
  y += 18;
  ctx.fillStyle = "#475569";
  ctx.font = `11px ${FONT}`;
  ctx.fillText(truncate(ctx, subtitle, contentW), margin, y);
  y += 15;
  ctx.fillStyle = "#0b3a5c";
  ctx.font = `11px ${FONT}`;
  ctx.fillText(truncate(ctx, filterLine, contentW), margin, y);
  y += 12;
  ctx.strokeStyle = "#cbd5e1";
  ctx.beginPath();
  ctx.moveTo(margin, y);
  ctx.lineTo(margin + contentW, y);
  ctx.stroke();
  bag.y = y + 14;
}

function sectionHead(bag: PageBag, label: string) {
  const { ctx, margin, contentW } = bag;
  ctx.fillStyle = "#0b3a5c";
  ctx.fillRect(margin, bag.y, 4, 14);
  ctx.font = `bold 13px ${FONT}`;
  ctx.fillText(truncate(ctx, label, contentW - 20), margin + 10, bag.y + 12);
  bag.y += 22;
}

function drawKpis(bag: PageBag, kpis: DavomatAnalyticsPdfInput["kpis"]) {
  const { ctx, margin, contentW } = bag;
  const cols = Math.min(5, Math.max(1, kpis.length));
  const gap = 8;
  const cardW = Math.floor((contentW - gap * (cols - 1)) / cols);
  const cardH = 52;
  kpis.forEach((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cardW + gap);
    const y = bag.y + row * (cardH + gap);
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, cardW, cardH, 8);
    } else {
      ctx.rect(x, y, cardW, cardH);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#64748b";
    ctx.font = `10px ${FONT}`;
    ctx.fillText(truncate(ctx, k.label, cardW - 16), x + 8, y + 16);
    ctx.fillStyle = "#0f172a";
    ctx.font = `bold 16px ${FONT}`;
    ctx.fillText(truncate(ctx, String(k.value), cardW - 16), x + 8, y + 36);
    if (k.sub) {
      ctx.fillStyle = "#64748b";
      ctx.font = `9px ${FONT}`;
      ctx.fillText(truncate(ctx, k.sub, cardW - 16), x + 8, y + 48);
    }
  });
  const rows = Math.ceil(kpis.length / cols);
  bag.y += rows * (cardH + gap) + 8;
}

function drawShare(bag: PageBag, title: string, share: AnalyticsPdfShare) {
  sectionHead(bag, title);
  const { ctx, margin } = bag;
  const items = [
    { label: "Vaqtida", value: share.onTime, color: "#22c55e" },
    { label: "Kech", value: share.late, color: "#eab308" },
    { label: "Kelmagan", value: share.absent, color: "#ef4444" },
  ];
  let x = margin;
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.beginPath();
    ctx.arc(x + 6, bag.y + 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillText(`${it.label}: ${it.value}`, x + 16, bag.y + 10);
    x += 130;
  }
  bag.y += 28;
}

function drawTable(
  bag: PageBag,
  pages: HTMLCanvasElement[],
  pageWmm: number,
  pageHmm: number,
  headers: string[],
  rows: string[][],
  colWeights: number[],
) {
  const weightSum = colWeights.reduce((a, b) => a + b, 0);
  let local = bag;
  const headH = 26;
  const rowH = 22;

  const paintHead = () => {
    const { ctx, margin, contentW } = local;
    let x = margin;
    const widths = colWeights.map((w) => Math.floor((w / weightSum) * contentW));
    widths[widths.length - 1]! += contentW - widths.reduce((a, b) => a + b, 0);
    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(margin, local.y, contentW, headH);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 10px ${FONT}`;
    headers.forEach((h, i) => {
      ctx.fillText(truncate(ctx, h, widths[i]! - 8), x + 4, local.y + 17);
      x += widths[i]!;
    });
    local.y += headH;
    return widths;
  };

  let widths = paintHead();

  for (let ri = 0; ri < rows.length; ri++) {
    local = ensureSpace(local, pages, rowH + 4, pageWmm, pageHmm);
    if (local.y === local.margin + 8) {
      // new page — redraw header
      widths = paintHead();
    }
    const { ctx, margin, contentW } = local;
    ctx.fillStyle = ri % 2 === 0 ? "#ffffff" : "#f8fafc";
    ctx.fillRect(margin, local.y, contentW, rowH);
    let x = margin;
    ctx.fillStyle = "#1e293b";
    ctx.font = `10px ${FONT}`;
    rows[ri]!.forEach((cell, i) => {
      ctx.fillText(truncate(ctx, cell, widths[i]! - 8), x + 4, local.y + 15);
      x += widths[i]!;
    });
    ctx.strokeStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(margin, local.y + rowH);
    ctx.lineTo(margin + contentW, local.y + rowH);
    ctx.stroke();
    local.y += rowH;
  }
  local.y += 12;
  return local;
}

function drawPersonColumns(
  bag: PageBag,
  pages: HTMLCanvasElement[],
  pageWmm: number,
  pageHmm: number,
  title: string,
  cols: Array<{ title: string; tone: string; people: AnalyticsPdfPerson[] }>,
) {
  let local = ensureSpace(bag, pages, 40, pageWmm, pageHmm);
  sectionHead(local, title);
  const { margin, contentW } = local;
  const gap = 10;
  const colW = Math.floor((contentW - gap * (cols.length - 1)) / cols.length);
  const maxRows = Math.max(...cols.map((c) => c.people.length), 1);
  const rowH = 28;
  const headH = 28;

  local = ensureSpace(local, pages, headH + Math.min(maxRows, 12) * rowH + 20, pageWmm, pageHmm);
  if (local.y === local.margin + 8) sectionHead(local, title);

  cols.forEach((col, ci) => {
    const x = margin + ci * (colW + gap);
    const { ctx } = local;
    ctx.fillStyle = col.tone;
    ctx.fillRect(x, local.y, colW, headH);
    ctx.fillStyle = "#0f172a";
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillText(truncate(ctx, `${col.title} (${col.people.length})`, colW - 10), x + 8, local.y + 18);
  });
  local.y += headH + 4;

  for (let i = 0; i < maxRows; i++) {
    local = ensureSpace(local, pages, rowH + 2, pageWmm, pageHmm);
    cols.forEach((col, ci) => {
      const person = col.people[i];
      if (!person) return;
      const x = margin + ci * (colW + gap);
      const { ctx } = local;
      ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#f8fafc";
      ctx.fillRect(x, local.y, colW, rowH);
      ctx.strokeStyle = "#e2e8f0";
      ctx.strokeRect(x, local.y, colW, rowH);
      ctx.fillStyle = "#0f172a";
      ctx.font = `bold 10px ${FONT}`;
      ctx.fillText(truncate(ctx, person.fullName, colW - 12), x + 6, local.y + 12);
      ctx.fillStyle = "#64748b";
      ctx.font = `8px ${FONT}`;
      const meta = [person.meta, person.checkIn, person.status].filter(Boolean).join(" · ");
      ctx.fillText(truncate(ctx, meta || "—", colW - 12), x + 6, local.y + 23);
    });
    local.y += rowH;
  }
  local.y += 14;
  return local;
}

export async function downloadDavomatAnalyticsPdf(input: DavomatAnalyticsPdfInput): Promise<void> {
  const pageWmm = input.singleDay ? 210 : 297;
  const pageHmm = input.singleDay ? 297 : 210;
  const pages: HTMLCanvasElement[] = [];
  let bag: PageBag = {
    ...createPage(pageWmm, pageHmm),
    y: 0,
    contentW: 0,
  };
  bag.contentW = bag.W - bag.margin * 2;
  bag.y = bag.margin + 14;
  let pageNo = 1;

  drawTitle(bag, input.title, input.subtitle, input.filterLine, pageNo);
  drawKpis(bag, input.kpis);
  drawShare(bag, input.shareTitle, input.share);

  bag = ensureSpace(bag, pages, 40, pageWmm, pageHmm);
  sectionHead(bag, "Davomat dinamikasi (kunlik)");
  bag = drawTable(
    bag,
    pages,
    pageWmm,
    pageHmm,
    ["Sana", "Vaqtida", "Kech", "Kelmagan", "Jami"],
    input.dynamics.map((d) => [
      `${d.label} (${d.date})`,
      String(d.onTime),
      String(d.late),
      String(d.absent),
      String(d.onTime + d.late + d.absent),
    ]),
    [3, 1.2, 1.2, 1.2, 1.2],
  );

  if (input.branches.length) {
    bag = ensureSpace(bag, pages, 36, pageWmm, pageHmm);
    sectionHead(bag, input.branchTitle);
    bag = drawTable(
      bag,
      pages,
      pageWmm,
      pageHmm,
      ["Nomi", "Xodim", "Kelgan", "Kech", "Kelmagan", "Davomat %"],
      input.branches.map((b) => [
        b.name,
        String(b.headcount ?? "—"),
        String(b.present ?? "—"),
        String(b.late ?? "—"),
        String(b.absent ?? "—"),
        `${b.attendanceRate}%`,
      ]),
      [3.5, 1, 1, 1, 1, 1.2],
    );
  }

  if (input.shifts.length) {
    bag = ensureSpace(bag, pages, 36, pageWmm, pageHmm);
    sectionHead(bag, "Smena bo‘yicha");
    bag = drawTable(
      bag,
      pages,
      pageWmm,
      pageHmm,
      ["Smena", "Xodim", "Davomat %"],
      input.shifts.map((s) => [s.name, String(s.headcount ?? "—"), `${s.attendanceRate}%`]),
      [4, 1.5, 1.5],
    );
  }

  if (input.roles.length) {
    bag = ensureSpace(bag, pages, 36, pageWmm, pageHmm);
    sectionHead(bag, "Rol bo‘yicha");
    bag = drawTable(
      bag,
      pages,
      pageWmm,
      pageHmm,
      ["Rol", "Xodim", "Kech", "Davomat %"],
      input.roles.map((r) => [
        r.name,
        String(r.headcount ?? "—"),
        String(r.late ?? "—"),
        `${r.attendanceRate}%`,
      ]),
      [3.5, 1.2, 1.2, 1.5],
    );
  }

  if (input.officeTitle && (input.officeOnTime.length || input.officeLate.length || input.officeAbsent.length)) {
    bag = drawPersonColumns(bag, pages, pageWmm, pageHmm, input.officeTitle, [
      { title: "Vaqtida", tone: "#d1fae5", people: input.officeOnTime },
      { title: "Kech", tone: "#fef3c7", people: input.officeLate },
      { title: "Kelmagan", tone: "#ffe4e6", people: input.officeAbsent },
    ]);
  }

  if (input.branchOpenTitle && (input.branchOpenings?.length ?? 0) > 0) {
    bag = ensureSpace(bag, pages, 36, pageWmm, pageHmm);
    sectionHead(bag, input.branchOpenTitle);
    bag = drawTable(
      bag,
      pages,
      pageWmm,
      pageHmm,
      ["Filial / mudir", "Holat", "Kelish", "Kech (daq)"],
      (input.branchOpenings ?? []).map((b) => [
        b.fullName,
        b.status || "—",
        b.checkIn || "—",
        b.lateMinutes != null && b.lateMinutes > 0 ? String(b.lateMinutes) : "—",
      ]),
      [4, 1.5, 1.5, 1.2],
    );
  }

  if (input.topLate.length) {
    bag = ensureSpace(bag, pages, 36, pageWmm, pageHmm);
    sectionHead(bag, "Eng ko‘p kechikkanlar");
    bag = drawTable(
      bag,
      pages,
      pageWmm,
      pageHmm,
      ["F.I.Sh.", "Bo‘lim", "Kun", "Soat"],
      input.topLate.map((r) => [
        r.fullName,
        r.departmentName || "—",
        String(r.lateDays),
        String(r.lateMinutes),
      ]),
      [3.5, 2.5, 1, 1.2],
    );
  }

  if (input.recent.length) {
    bag = ensureSpace(bag, pages, 36, pageWmm, pageHmm);
    sectionHead(bag, "So‘nggi kelishlar");
    bag = drawTable(
      bag,
      pages,
      pageWmm,
      pageHmm,
      ["F.I.Sh.", "Bo‘lim", "Kelish", "Holat"],
      input.recent.map((r) => [r.fullName, r.departmentName || "—", r.checkIn, r.statusLabel]),
      [3.5, 2.5, 1.5, 1.5],
    );
  }

  if (input.deptTable.length) {
    bag = ensureSpace(bag, pages, 36, pageWmm, pageHmm);
    sectionHead(bag, "Bo‘lim / filial jadvali");
    bag = drawTable(
      bag,
      pages,
      pageWmm,
      pageHmm,
      ["Nomi", "Xodim", "Kelgan", "Kech", "Kelmagan", "%"],
      input.deptTable.map((d) => [
        d.name,
        String(d.headcount ?? "—"),
        String(d.present ?? "—"),
        String(d.late ?? "—"),
        String(d.absent ?? "—"),
        `${d.attendanceRate}%`,
      ]),
      [3.5, 1, 1, 1, 1, 1],
    );
  }

  pages.push(bag.canvas);

  const pdf = new jsPDF({
    orientation: input.singleDay ? "portrait" : "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    pdf.addImage(pages[i]!.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pw, ph, undefined, "FAST");
  }
  await deliverFile(pdf.output("blob"), `${input.fileBase}.pdf`);
}
