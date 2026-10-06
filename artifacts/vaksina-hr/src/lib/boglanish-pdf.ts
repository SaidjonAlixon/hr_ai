/**
 * Bog‘lanish — filiallar holati, A4 gorizontal PDF (kirill/lotin to‘g‘ri chiqishi uchun canvas orqali).
 */
import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";
import { userRoleLabel } from "./roles";
import type { BoglanishOverviewBranch } from "./boglanish-api";

const FONT = '"Segoe UI", "Noto Sans", Arial, sans-serif';
const TZ = "Asia/Tashkent";

function stampNow() {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function fileStamp() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function fmtBoglanishWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatUzPhone(raw?: string | null): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("998")) {
    return `+998 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`;
  }
  return raw || "";
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const raw = String(text || "—").replace(/\s+/g, " ").trim() || "—";
  if (ctx.measureText(raw).width <= maxW) return raw;
  let s = raw;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

export async function exportBoglanishPdf(
  rows: BoglanishOverviewBranch[],
  opts: { filterLabel: string; total: number; filled: number },
): Promise<void> {
  const pageW = 297;
  const pageH = 210;
  const margin = 8;
  const dpi = 140;
  const canvasW = Math.round((pageW / 25.4) * dpi);
  const canvasH = Math.round((pageH / 25.4) * dpi);
  const scale = canvasW / pageW;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const cols = [
    { title: "№", w: 9 },
    { title: "Filial", w: 46 },
    { title: "Mudir", w: 42 },
    { title: "Koordinator", w: 40 },
    { title: "Filial raqami", w: 33 },
    { title: "Qo‘shimcha · Telegram · vaqt", w: 45 },
    { title: "Kim kiritgan", w: 40 },
    { title: "Holat", w: 26 },
  ];
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const pct = opts.total ? Math.round((opts.filled / opts.total) * 100) : 0;

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
    ctx.fillRect(0, 0, canvasW, 17 * scale);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(5.2 * scale)}px ${FONT}`;
    ctx.fillText("Bog‘lanish — filiallar holati", margin * scale, 7.6 * scale);
    ctx.font = `${Math.round(2.6 * scale)}px ${FONT}`;
    ctx.fillStyle = "#dbeafe";
    ctx.fillText(`VAKSINA MED HR  ·  ${opts.filterLabel}`, margin * scale, 12.8 * scale);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`${stampNow()}  ·  ${page + 1}-list`, (pageW - margin) * scale, 8 * scale);
    ctx.textAlign = "left";

    let y = 22 * scale;
    if (page === 0) {
      const cards = [
        { label: "Jami filial", value: String(opts.total), color: "#0b3a5c", bg: "#f1f5f9" },
        { label: "To‘ldirgan", value: `${opts.filled}  (${pct}%)`, color: "#047857", bg: "#ecfdf5" },
        { label: "To‘ldirmagan", value: String(opts.total - opts.filled), color: "#be123c", bg: "#fff1f2" },
        { label: "Shu hisobotda", value: `${rows.length} ta`, color: "#334155", bg: "#f8fafc" },
      ];
      const cw = (tableW - 3 * 4) / 4;
      cards.forEach((c, i) => {
        const cx = (margin + i * (cw + 4)) * scale;
        ctx.fillStyle = c.bg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cx, y - 1 * scale, cw * scale, 12 * scale, 2 * scale);
        else ctx.rect(cx, y - 1 * scale, cw * scale, 12 * scale);
        ctx.fill();
        ctx.fillStyle = "#64748b";
        ctx.font = `${Math.round(2.4 * scale)}px ${FONT}`;
        ctx.fillText(c.label, cx + 3 * scale, y + 3 * scale);
        ctx.fillStyle = c.color;
        ctx.font = `bold ${Math.round(4.2 * scale)}px ${FONT}`;
        ctx.fillText(c.value, cx + 3 * scale, y + 8.6 * scale);
      });
      y += 16 * scale;
    }

    const tableX = margin * scale;
    const rowH = 9 * scale;
    const headH = 7 * scale;
    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(tableX, y, tableW * scale, headH);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(2.45 * scale)}px ${FONT}`;
    let x = tableX;
    for (const col of cols) {
      ctx.fillText(col.title, x + 1.8 * scale, y + 4.6 * scale);
      x += col.w * scale;
    }
    y += headH;

    if (rows.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.font = `${Math.round(3 * scale)}px ${FONT}`;
      ctx.fillText("Bu filtr bo‘yicha filial yo‘q", tableX + 3 * scale, y + 8 * scale);
    }

    const bottom = (pageH - 9) * scale;
    while (index < rows.length && y + rowH <= bottom) {
      const r = rows[index]!;
      ctx.fillStyle = r.complete ? (index % 2 === 0 ? "#ffffff" : "#f8fafc") : "#fff7f7";
      ctx.fillRect(tableX, y, tableW * scale, rowH);
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.strokeRect(tableX, y, tableW * scale, rowH);
      if (!r.complete) {
        ctx.fillStyle = "#e11d48";
        ctx.fillRect(tableX, y, 0.8 * scale, rowH);
      }

      const extras = [
        r.extraPhones.map(formatUzPhone).join(", "),
        r.telegramNick,
        r.contactFromHm && r.contactToHm ? `${r.contactFromHm}–${r.contactToHm}` : "",
      ].filter(Boolean);
      const cells: Array<{ main: string; sub?: string; bold?: boolean; color?: string }> = [
        { main: String(index + 1), color: "#0b3a5c", bold: true },
        { main: r.branchName, bold: true },
        { main: r.vacant ? "Mudir yo‘q (vakant)" : r.mudirName || "—", sub: formatUzPhone(r.mudirPhone), color: r.vacant ? "#b45309" : undefined },
        { main: r.coordinatorName || "Biriktirilmagan", sub: formatUzPhone(r.coordinatorPhone), color: r.coordinatorName ? undefined : "#94a3b8" },
        { main: r.complete ? formatUzPhone(r.primaryPhone) : "Kiritilmagan", bold: r.complete, color: r.complete ? "#0f172a" : "#be123c" },
        { main: extras[0] || "—", sub: extras.slice(1).join(" · ") || undefined, color: extras.length ? undefined : "#94a3b8" },
        {
          main: r.updatedByName || "—",
          sub: r.updatedAt ? `${r.updatedByRole ? `${userRoleLabel(r.updatedByRole)} · ` : ""}${fmtBoglanishWhen(r.updatedAt)}` : undefined,
          color: r.updatedByName ? undefined : "#94a3b8",
        },
        { main: r.complete ? "To‘ldirgan" : "To‘ldirmagan", bold: true, color: r.complete ? "#047857" : "#be123c" },
      ];

      x = tableX;
      cells.forEach((c, i) => {
        const maxW = cols[i]!.w * scale - 3.2 * scale;
        ctx.fillStyle = c.color || "#0f172a";
        ctx.font = `${c.bold ? "bold " : ""}${Math.round(2.4 * scale)}px ${FONT}`;
        ctx.fillText(clip(ctx, c.main, maxW), x + 1.8 * scale, y + (c.sub ? 3.7 : 5.4) * scale);
        if (c.sub) {
          ctx.fillStyle = "#64748b";
          ctx.font = `${Math.round(2 * scale)}px ${FONT}`;
          ctx.fillText(clip(ctx, c.sub, maxW), x + 1.8 * scale, y + 6.9 * scale);
        }
        x += cols[i]!.w * scale;
      });
      y += rowH;
      index += 1;
    }

    ctx.fillStyle = "#94a3b8";
    ctx.font = `${Math.round(2.3 * scale)}px ${FONT}`;
    ctx.fillText("Maxfiy · faqat admin · VAKSINA MED HR", margin * scale, (pageH - 4) * scale);

    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageW, pageH);
    page += 1;
    if (rows.length === 0) break;
    if (page > 80) break;
  }

  await deliverFile(doc.output("blob"), `Boglanish_filiallar_${fileStamp()}.pdf`);
}
