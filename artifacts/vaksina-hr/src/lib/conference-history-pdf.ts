/**
 * Konferensiya yakuniy hisobot PDF — qatnashuv, vaqt, chat to‘liq ko‘rsatiladi.
 */

import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";
import {
  formatDate,
  formatSpan,
  hhmmOf,
  type ConferenceHistory,
} from "./conference/api";

const FONT =
  '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

function mmToPx(mm: number, dpi = 144): number {
  return Math.round((mm / 25.4) * dpi);
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  const t = String(text || "—");
  if (ctx.measureText(t).width <= maxW) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

/** Matnni maxW bo‘yicha qatorlarga bo‘lish (maxLines dan ortig‘i … bilan kesiladi). */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number,
): string[] {
  const raw = String(text || "").trim() || "—";
  if (ctx.measureText(raw).width <= maxW) return [raw];
  const words = raw.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (!lines.length) return [truncate(ctx, raw, maxW)];
  // Oxirgi qator kesilgan bo‘lsa …
  const joined = lines.join(" ");
  if (joined.length < raw.length || words.length > 0 && lines.length >= maxLines) {
    lines[lines.length - 1] = truncate(ctx, lines[lines.length - 1]!, maxW);
  }
  return lines.slice(0, maxLines);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function roleLabel(role: string): string {
  if (role === "host") return "Tashkilotchi";
  if (role === "cohost") return "Raxbar";
  return "Ishtirokchi";
}

function stampNow(): string {
  return new Date().toLocaleString("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export async function downloadConferenceHistoryPdf(h: ConferenceHistory): Promise<void> {
  const c = h.conference;
  const pageW = 210;
  const pageH = 297;
  const margin = 12;
  const scale = 2;
  const attended = h.attendance.filter((a) => a.firstJoin);
  const absent = h.attendance.filter((a) => !a.firstJoin && a.invited);
  const totalSec = Math.max(1, h.actualSeconds || 1);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  let page = 0;

  type Block =
    | { kind: "header" }
    | { kind: "stats" }
    | { kind: "section"; title: string }
    | { kind: "person"; a: (typeof attended)[0] }
    | { kind: "absent"; name: string; position: string | null }
    | { kind: "chat"; at: string; name: string; text: string }
    | { kind: "footer-note" };

  const blocks: Block[] = [{ kind: "header" }, { kind: "stats" }, { kind: "section", title: `Qatnashuvchilar · ${attended.length}` }];
  for (const a of attended) blocks.push({ kind: "person", a });
  if (absent.length) {
    blocks.push({ kind: "section", title: `Kirmaganlar · ${absent.length}` });
    for (const a of absent) blocks.push({ kind: "absent", name: a.fullName, position: a.position });
  }
  if (h.messages.length) {
    blocks.push({ kind: "section", title: `Chat · ${h.messages.length}` });
    for (const m of h.messages) blocks.push({ kind: "chat", at: hhmmOf(m.at), name: m.name, text: m.text });
  }
  blocks.push({ kind: "footer-note" });

  let i = 0;
  while (i < blocks.length) {
    const canvas = document.createElement("canvas");
    canvas.width = mmToPx(pageW, 144) * scale;
    canvas.height = mmToPx(pageH, 144) * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas ishlamaydi");
    ctx.scale(scale, scale);
    const W = mmToPx(pageW, 144);
    const H = mmToPx(pageH, 144);

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, W, H);

    // header strip
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "#062e2a");
    grad.addColorStop(0.55, "#0b4d5c");
    grad.addColorStop(1, "#0b5fff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, mmToPx(22, 144));

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${mmToPx(4.2, 144)}px ${FONT}`;
    ctx.fillText("VAKSINA HR · Konferensiya hisobot", mmToPx(margin, 144), mmToPx(9, 144));
    ctx.font = `${mmToPx(2.8, 144)}px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(`Sahifa ${page + 1} · ${stampNow()}`, mmToPx(margin, 144), mmToPx(15.5, 144));

    let y = mmToPx(28, 144);
    const bottom = H - mmToPx(14, 144);
    const contentW = W - mmToPx(margin * 2, 144);
    const left = mmToPx(margin, 144);

    while (i < blocks.length) {
      const b = blocks[i]!;
      let need = mmToPx(10, 144);

      if (b.kind === "header") need = mmToPx(28, 144);
      else if (b.kind === "stats") need = mmToPx(32, 144);
      else if (b.kind === "section") need = mmToPx(12, 144);
      else if (b.kind === "person") need = mmToPx(17, 144);
      else if (b.kind === "absent") need = mmToPx(9, 144);
      else if (b.kind === "chat") {
        ctx.font = `${mmToPx(2.65, 144)}px ${FONT}`;
        const linesN = wrapLines(ctx, b.text, contentW - mmToPx(6, 144), 2).length;
        need = mmToPx(8.5, 144) + linesN * mmToPx(3.6, 144) + mmToPx(2, 144);
      } else need = mmToPx(16, 144);

      if (y + need > bottom && b.kind !== "header") break;

      if (b.kind === "header") {
        ctx.fillStyle = "#0f172a";
        ctx.font = `bold ${mmToPx(5.2, 144)}px ${FONT}`;
        const titleLines = (() => {
          const words = c.title.split(/\s+/);
          const lines: string[] = [];
          let cur = "";
          for (const w of words) {
            const next = cur ? `${cur} ${w}` : w;
            if (ctx.measureText(next).width <= contentW) cur = next;
            else {
              if (cur) lines.push(cur);
              cur = w;
              if (lines.length >= 2) break;
            }
          }
          if (cur && lines.length < 2) lines.push(cur);
          return lines.length ? lines : [c.title];
        })();
        titleLines.forEach((ln, idx) => ctx.fillText(ln, left, y + mmToPx(5, 144) + idx * mmToPx(6, 144)));
        y += mmToPx(6, 144) + titleLines.length * mmToPx(6, 144);
        ctx.fillStyle = "#64748b";
        ctx.font = `${mmToPx(3.1, 144)}px ${FONT}`;
        ctx.fillText(`Tashkilotchi: ${c.host.fullName}`, left, y);
        y += mmToPx(5, 144);
        ctx.fillText(
          `Sana: ${formatDate(h.actualStart ?? c.scheduledAt, { weekday: true })} · Kod: ${c.code}`,
          left,
          y,
        );
        y += mmToPx(8, 144);
      } else if (b.kind === "stats") {
        const cards = [
          { lab: "BOSHLANDI", val: h.actualStart ? hhmmOf(h.actualStart) : "—" },
          { lab: "TUGADI", val: h.actualEnd ? hhmmOf(h.actualEnd) : "—" },
          { lab: "DAVOMIYLIGI", val: h.actualSeconds ? formatSpan(h.actualSeconds) : "—" },
          { lab: "QATNASHDI", val: `${h.attendedCount} / ${h.invitedCount}` },
        ];
        const gap = mmToPx(2.5, 144);
        const cardW = (contentW - gap * 3) / 4;
        const cardH = mmToPx(18, 144);
        cards.forEach((card, idx) => {
          const x = left + idx * (cardW + gap);
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = "#e2e8f0";
          ctx.lineWidth = 1;
          roundRect(ctx, x, y, cardW, cardH, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#64748b";
          ctx.font = `bold ${mmToPx(2.2, 144)}px ${FONT}`;
          ctx.fillText(card.lab, x + mmToPx(2.5, 144), y + mmToPx(5.5, 144));
          ctx.fillStyle = "#0f172a";
          ctx.font = `bold ${mmToPx(3.8, 144)}px ${FONT}`;
          ctx.fillText(truncate(ctx, card.val, cardW - mmToPx(5, 144)), x + mmToPx(2.5, 144), y + mmToPx(12.5, 144));
        });
        y += cardH + mmToPx(8, 144);
      } else if (b.kind === "section") {
        ctx.fillStyle = "#0b5fff";
        ctx.font = `bold ${mmToPx(3.4, 144)}px ${FONT}`;
        ctx.fillText(b.title, left, y + mmToPx(4, 144));
        y += mmToPx(9, 144);
      } else if (b.kind === "person") {
        const a = b.a;
        const share = Math.min(100, Math.round((a.seconds / totalSec) * 100));
        const padX = mmToPx(3, 144);
        const rowH = mmToPx(15, 144);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        roundRect(ctx, left, y, contentW, rowH, 5);
        ctx.fill();
        ctx.stroke();

        // O‘ngdagi vaqt — avval o‘lchab joy qoldiramiz
        ctx.font = `bold ${mmToPx(3.1, 144)}px ${FONT}`;
        const right = `${formatSpan(a.seconds)} · ${share}%`;
        const rightW = ctx.measureText(right).width;
        const rightX = left + contentW - padX - rightW;
        ctx.fillStyle = "#0f172a";
        ctx.fillText(right, rightX, y + mmToPx(5.5, 144));

        const role = roleLabel(a.role);
        ctx.font = `bold ${mmToPx(2.35, 144)}px ${FONT}`;
        const roleW = ctx.measureText(role).width;
        const gap = mmToPx(2.5, 144);
        const nameMax = Math.max(mmToPx(28, 144), rightX - roleW - gap * 2 - (left + padX) - mmToPx(2, 144));

        ctx.fillStyle = "#0f172a";
        ctx.font = `bold ${mmToPx(3.2, 144)}px ${FONT}`;
        const nameText = truncate(ctx, a.fullName, nameMax);
        const nameW = ctx.measureText(nameText).width;
        ctx.fillText(nameText, left + padX, y + mmToPx(5.2, 144));

        // Rol — ismdan KEYIN, o‘ngdagi vaqtdan OLDIN (ustma-ust tushmasin)
        const roleX = left + padX + nameW + gap;
        ctx.fillStyle = "#0369a1";
        ctx.font = `bold ${mmToPx(2.35, 144)}px ${FONT}`;
        if (roleX + roleW < rightX - gap) {
          ctx.fillText(role, roleX, y + mmToPx(5.2, 144));
        } else {
          // Joy yetmasa — ism ostiga
          ctx.fillText(role, left + padX, y + mmToPx(8.2, 144));
        }

        ctx.fillStyle = "#64748b";
        ctx.font = `${mmToPx(2.45, 144)}px ${FONT}`;
        const meta = [
          a.position || "",
          a.firstJoin ? `${hhmmOf(a.firstJoin)}${a.lastLeave ? `–${hhmmOf(a.lastLeave)}` : ""}` : "",
          a.sessions > 1 ? `${a.sessions} marta` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        ctx.fillText(truncate(ctx, meta, contentW - padX * 2 - rightW), left + padX, y + mmToPx(9.8, 144));

        const barX = left + padX;
        const barY = y + mmToPx(12, 144);
        const barW = contentW - padX * 2;
        ctx.fillStyle = "#e2e8f0";
        roundRect(ctx, barX, barY, barW, mmToPx(1.6, 144), 2);
        ctx.fill();
        ctx.fillStyle = "#10b981";
        roundRect(ctx, barX, barY, Math.max(mmToPx(2, 144), (barW * share) / 100), mmToPx(1.6, 144), 2);
        ctx.fill();

        y += mmToPx(17, 144);
      } else if (b.kind === "absent") {
        ctx.fillStyle = "#9f1239";
        ctx.font = `${mmToPx(2.9, 144)}px ${FONT}`;
        const absentLine = `• ${b.name}${b.position ? ` — ${b.position}` : ""}`;
        ctx.fillText(truncate(ctx, absentLine, contentW - mmToPx(2, 144)), left + mmToPx(2, 144), y + mmToPx(4, 144));
        y += mmToPx(8, 144);
      } else if (b.kind === "chat") {
        const padX = mmToPx(3, 144);
        const msgMaxW = contentW - padX * 2;
        ctx.font = `${mmToPx(2.65, 144)}px ${FONT}`;
        const msgLines = wrapLines(ctx, b.text, msgMaxW, 2);
        const boxH = mmToPx(8.5, 144) + msgLines.length * mmToPx(3.6, 144);

        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#e2e8f0";
        roundRect(ctx, left, y, contentW, boxH, 5);
        ctx.fill();
        ctx.stroke();

        // Vaqt o‘ngda — avval o‘lchab, ismni chapda kesamiz (ustma-ust bo‘lmasin)
        ctx.font = `${mmToPx(2.4, 144)}px ${FONT}`;
        const atW = ctx.measureText(b.at).width;
        const atX = left + contentW - padX - atW;
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(b.at, atX, y + mmToPx(4.8, 144));

        ctx.fillStyle = "#0f172a";
        ctx.font = `bold ${mmToPx(2.8, 144)}px ${FONT}`;
        const nameMax = Math.max(mmToPx(36, 144), atX - (left + padX) - mmToPx(5, 144));
        ctx.fillText(truncate(ctx, b.name, nameMax), left + padX, y + mmToPx(4.8, 144));

        ctx.fillStyle = "#334155";
        ctx.font = `${mmToPx(2.65, 144)}px ${FONT}`;
        msgLines.forEach((ln, idx) => {
          ctx.fillText(ln, left + padX, y + mmToPx(9.2, 144) + idx * mmToPx(3.6, 144));
        });
        y += boxH + mmToPx(2, 144);
      } else if (b.kind === "footer-note") {
        ctx.fillStyle = "#64748b";
        ctx.font = `${mmToPx(2.4, 144)}px ${FONT}`;
        const note =
          "Yozuv (agar bo‘lsa) VAKSINA tushuntirish xatlari guruhiga yuboriladi va platformadan o‘chiriladi. Faqat statistika saqlanadi.";
        const words = note.split(/\s+/);
        let line = "";
        let ny = y + mmToPx(3.5, 144);
        for (const w of words) {
          const next = line ? `${line} ${w}` : w;
          if (ctx.measureText(next).width > contentW) {
            ctx.fillText(line, left, ny);
            ny += mmToPx(4, 144);
            line = w;
          } else line = next;
        }
        if (line) ctx.fillText(line, left, ny);
        y = ny + mmToPx(8, 144);
      }

      i += 1;
    }

    ctx.fillStyle = "#94a3b8";
    ctx.font = `${mmToPx(2.3, 144)}px ${FONT}`;
    ctx.fillText("VAKSINA MED HR · konferensiya hisobot", left, H - mmToPx(6, 144));

    if (page > 0) doc.addPage();
    doc.addImage(canvas.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, pageW, pageH);
    page += 1;
    if (page > 40) break;
  }

  const safe = c.title.replace(/[^\w\u0400-\u04FF\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 40) || c.code;
  const blob = doc.output("blob");
  await deliverFile(blob, `Konferensiya_hisobot_${safe}_${c.code}.pdf`);
}
