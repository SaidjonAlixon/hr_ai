/** Koordinator hisobot PDF — aniq jadval, rangli foiz, tushunarli. */
import { jsPDF } from "jspdf";
import { deliverFile } from "./tg-download";
import type { CoordinatorHisobot, HisobotBranchBlock } from "./hisobot-api";

const FONT =
  '"Segoe UI", "Noto Sans", "DejaVu Sans", Arial, "Helvetica Neue", sans-serif';

function mmToPx(mm: number) {
  return (mm / 25.4) * 96;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function fmtDate(ymd: string) {
  if (!ymd || ymd.length < 10) return ymd;
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
}

function fmtDates(dates: string[], max = 10): string {
  if (!dates.length) return "—";
  const show = dates.slice(0, max).map((d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`);
  return show.join(", ") + (dates.length > max ? ` (+${dates.length - max})` : "");
}

function rateColor(rate: number): string {
  if (rate >= 80) return "#047857";
  if (rate >= 50) return "#b45309";
  return "#be123c";
}

function rateBg(rate: number): string {
  if (rate >= 80) return "#d1fae5";
  if (rate >= 50) return "#fef3c7";
  return "#ffe4e6";
}

function branchAvgRate(b: HisobotBranchBlock): number {
  const all = [
    ...(b.mudir ? [b.mudir] : []),
    ...b.pharmacists,
    ...b.interns,
    ...b.others,
  ];
  if (!all.length) return 0;
  return Math.round((all.reduce((s, e) => s + e.presentRate, 0) / all.length) * 10) / 10;
}

export async function downloadHisobotPdf(report: CoordinatorHisobot) {
  const pageWmm = 210;
  const pageHmm = 297;
  const scale = 2;
  const pages: HTMLCanvasElement[] = [];
  const marginX = 24;
  const footerY = (H: number) => H - 22;

  const paintPage = (draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void) => {
    const canvas = document.createElement("canvas");
    canvas.width = mmToPx(pageWmm) * scale;
    canvas.height = mmToPx(pageHmm) * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas ishlamaydi");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    draw(ctx, canvas.width / scale, canvas.height / scale);
    pages.push(canvas);
  };

  const drawPageChrome = (
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    pageNo: number,
    section: string,
  ) => {
    const maxW = W - marginX * 2;
    // Top bar
    ctx.fillStyle = "#0b3a5c";
    ctx.fillRect(0, 0, W, 8);

    let y = 32;
    ctx.fillStyle = "#0b3a5c";
    ctx.font = `bold 16px ${FONT}`;
    ctx.fillText("VAKSINA MED", marginX, y);
    ctx.fillStyle = "#64748b";
    ctx.font = `11px ${FONT}`;
    ctx.fillText("Koordinator hisobot", marginX + 118, y);

    y += 20;
    ctx.fillStyle = "#0f172a";
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillText(truncate(ctx, report.coordinator.fullName, maxW), marginX, y);

    y += 16;
    ctx.fillStyle = "#64748b";
    ctx.font = `10px ${FONT}`;
    ctx.fillText(
      truncate(
        ctx,
        `Davr: ${fmtDate(report.from)} — ${fmtDate(report.to)}  ·  ${report.dayCount} kun  ·  ${section}`,
        maxW - 50,
      ),
      marginX,
      y,
    );

    y += 10;
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(marginX, y, maxW, 1);

    // Footer
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(marginX, footerY(H) - 8, maxW, 1);
    ctx.fillStyle = "#94a3b8";
    ctx.font = `9px ${FONT}`;
    ctx.fillText(`Yangilangan: ${report.generatedAt}`, marginX, footerY(H) + 4);
    ctx.textAlign = "right";
    ctx.fillText(`Sahifa ${pageNo}`, W - marginX, footerY(H) + 4);
    ctx.textAlign = "left";

    return y + 16;
  };

  const drawLegend = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const items: Array<[string, string, string]> = [
      ["≥80%", "#047857", "#d1fae5"],
      ["50–79%", "#b45309", "#fef3c7"],
      ["<50%", "#be123c", "#ffe4e6"],
    ];
    let cx = x;
    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = "#64748b";
    ctx.fillText("Davomat:", cx, y);
    cx += 52;
    for (const [label, fg, bg] of items) {
      ctx.fillStyle = bg;
      ctx.fillRect(cx, y - 10, 54, 14);
      ctx.fillStyle = fg;
      ctx.font = `bold 9px ${FONT}`;
      ctx.fillText(label, cx + 6, y);
      cx += 60;
    }
  };

  const drawRateBadge = (
    ctx: CanvasRenderingContext2D,
    rate: number,
    x: number,
    y: number,
    w = 48,
  ) => {
    ctx.fillStyle = rateBg(rate);
    ctx.fillRect(x, y - 11, w, 16);
    ctx.fillStyle = rateColor(rate);
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(`${rate}%`, x + w / 2, y);
    ctx.textAlign = "left";
  };

  // —— 1) Qisqacha + filiallar jadvali (paginated) ——
  let branchIdx = 0;
  let isFirstSummary = true;

  while (isFirstSummary || branchIdx < report.branches.length) {
    paintPage((ctx, W, H) => {
      const pageNo = pages.length + 1;
      let y = drawPageChrome(ctx, W, H, pageNo, "Filiallar");
      const maxW = W - marginX * 2;
      const bottom = footerY(H) - 16;

      if (isFirstSummary) {
        isFirstSummary = false;
        const s = report.summary;
        const cards: Array<[string, string, string]> = [
          ["Filial", String(s.branchCount), "#0b3a5c"],
          ["Mudir", String(s.mudirCount), "#0b3a5c"],
          ["Farmasevt", String(s.pharmacistCount), "#0b3a5c"],
          ["Stajyor", String(s.internCount), "#0b3a5c"],
          ["O‘rtacha davomat", `${s.avgPresentRate}%`, rateColor(s.avgPresentRate)],
          ["Umuman kelmagan", String(s.noShowCount), s.noShowCount > 0 ? "#be123c" : "#047857"],
        ];
        const gap = 8;
        const cardW = (maxW - gap * 2) / 3;
        const cardH = 46;
        cards.forEach((c, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const cx = marginX + col * (cardW + gap);
          const cy = y + row * (cardH + gap);
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(cx, cy, cardW, cardH);
          ctx.strokeStyle = "#e2e8f0";
          ctx.strokeRect(cx, cy, cardW, cardH);
          ctx.fillStyle = "#64748b";
          ctx.font = `9px ${FONT}`;
          ctx.fillText(c[0]!, cx + 10, cy + 16);
          ctx.fillStyle = c[2]!;
          ctx.font = `bold 18px ${FONT}`;
          ctx.fillText(c[1]!, cx + 10, cy + 36);
        });
        y += cardH * 2 + gap + 18;

        drawLegend(ctx, marginX, y);
        y += 18;

        ctx.fillStyle = "#0b3a5c";
        ctx.font = `bold 12px ${FONT}`;
        ctx.fillText("1. Filiallar bo‘yicha qisqacha", marginX, y);
        y += 8;
        ctx.fillStyle = "#94a3b8";
        ctx.font = `9px ${FONT}`;
        ctx.fillText("Har bir filial: mudir, farmasevt, stajyor soni va o‘rtacha davomat foizi", marginX, y + 12);
        y += 24;
      } else {
        ctx.fillStyle = "#0b3a5c";
        ctx.font = `bold 12px ${FONT}`;
        ctx.fillText("1. Filiallar bo‘yicha qisqacha (davomi)", marginX, y);
        y += 18;
      }

      // Table header
      const cols = [
        { key: "n", label: "№", w: 28 },
        { key: "branch", label: "Filial", w: 0 },
        { key: "mudir", label: "Mudir", w: 130 },
        { key: "f", label: "Farm.", w: 40 },
        { key: "st", label: "Staj.", w: 40 },
        { key: "tot", label: "Jami", w: 40 },
        { key: "rate", label: "Davomat", w: 58 },
      ] as const;
      const fixed = cols.reduce((s, c) => s + (c.key === "branch" ? 0 : c.w), 0);
      const branchColW = maxW - fixed;
      const widths = cols.map((c) => (c.key === "branch" ? branchColW : c.w));

      const drawTableHead = (yy: number) => {
        ctx.fillStyle = "#0b3a5c";
        ctx.fillRect(marginX, yy, maxW, 22);
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 9px ${FONT}`;
        let cx = marginX;
        cols.forEach((c, i) => {
          const w = widths[i]!;
          if (c.key === "f" || c.key === "st" || c.key === "tot" || c.key === "rate" || c.key === "n") {
            ctx.textAlign = "center";
            ctx.fillText(c.label, cx + w / 2, yy + 14);
          } else {
            ctx.textAlign = "left";
            ctx.fillText(c.label, cx + 6, yy + 14);
          }
          cx += w;
        });
        ctx.textAlign = "left";
        return yy + 22;
      };

      y = drawTableHead(y);
      const rowH = 28;

      while (branchIdx < report.branches.length && y + rowH < bottom) {
        const b = report.branches[branchIdx]!;
        const n = branchIdx + 1;
        const avg = branchAvgRate(b);
        if (n % 2 === 0) {
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(marginX, y, maxW, rowH);
        }
        ctx.strokeStyle = "#e2e8f0";
        ctx.beginPath();
        ctx.moveTo(marginX, y + rowH);
        ctx.lineTo(marginX + maxW, y + rowH);
        ctx.stroke();

        let cx = marginX;
        const cells: Array<{ text: string; align: CanvasTextAlign; color?: string }> = [
          { text: String(n), align: "center" },
          { text: b.branch, align: "left" },
          { text: b.mudir?.fullName || "—", align: "left" },
          { text: String(b.pharmacists.length), align: "center" },
          { text: String(b.interns.length), align: "center" },
          { text: String(b.staffCount), align: "center" },
          { text: "", align: "center" },
        ];
        cells.forEach((cell, i) => {
          const w = widths[i]!;
          if (i === 6) {
            drawRateBadge(ctx, avg, cx + (w - 48) / 2, y + 18, 48);
          } else {
            ctx.fillStyle = "#0f172a";
            ctx.font = i === 1 ? `bold 10px ${FONT}` : `10px ${FONT}`;
            ctx.textAlign = cell.align;
            const tx =
              cell.align === "center"
                ? cx + w / 2
                : cx + 6;
            ctx.fillText(truncate(ctx, cell.text, w - 10), tx, y + 18);
          }
          cx += w;
        });
        ctx.textAlign = "left";
        y += rowH;
        branchIdx += 1;
      }
    });
  }

  // —— 2) Xodimlar jadvali (aniq ustunlar) ——
  let empIndex = 0;
  while (empIndex < report.employees.length) {
    paintPage((ctx, W, H) => {
      const pageNo = pages.length + 1;
      let y = drawPageChrome(
        ctx,
        W,
        H,
        pageNo,
        empIndex === 0 ? "Xodimlar davomati" : "Xodimlar (davomi)",
      );
      const maxW = W - marginX * 2;
      const bottom = footerY(H) - 16;

      ctx.fillStyle = "#0b3a5c";
      ctx.font = `bold 12px ${FONT}`;
      ctx.fillText(
        empIndex === 0
          ? "2. Xodimlar davomati — aniq jadval"
          : "2. Xodimlar davomati (davomi)",
        marginX,
        y,
      );
      y += 6;
      if (empIndex === 0) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = `9px ${FONT}`;
        ctx.fillText(
          "Har qator: xodim, lavozim, filial, smena, kelgan/kelmagan kunlar soni va foiz. Pastda sanalar.",
          marginX,
          y + 12,
        );
        y += 18;
        drawLegend(ctx, marginX, y + 4);
        y += 18;
      } else {
        y += 12;
      }

      const cols = [
        { key: "n", label: "№", w: 26 },
        { key: "name", label: "F.I.Sh.", w: 118 },
        { key: "role", label: "Lavozim", w: 62 },
        { key: "branch", label: "Filial", w: 0 },
        { key: "shift", label: "Smena", w: 58 },
        { key: "ok", label: "Kelgan", w: 48 },
        { key: "bad", label: "Kelmagan", w: 56 },
        { key: "rate", label: "%", w: 48 },
      ] as const;
      const fixed = cols.reduce((s, c) => s + (c.key === "branch" ? 0 : c.w), 0);
      const branchW = maxW - fixed;
      const widths = cols.map((c) => (c.key === "branch" ? branchW : c.w));

      const drawEmpHead = (yy: number) => {
        ctx.fillStyle = "#0b3a5c";
        ctx.fillRect(marginX, yy, maxW, 22);
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold 9px ${FONT}`;
        let cx = marginX;
        cols.forEach((c, i) => {
          const w = widths[i]!;
          const center = c.key === "n" || c.key === "ok" || c.key === "bad" || c.key === "rate";
          ctx.textAlign = center ? "center" : "left";
          ctx.fillText(c.label, center ? cx + w / 2 : cx + 5, yy + 14);
          cx += w;
        });
        ctx.textAlign = "left";
        return yy + 22;
      };

      y = drawEmpHead(y);
      const rowH = 38;

      while (empIndex < report.employees.length && y + rowH + 18 < bottom) {
        const e = report.employees[empIndex]!;
        const n = empIndex + 1;
        if (n % 2 === 0) {
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(marginX, y, maxW, rowH);
        }
        ctx.strokeStyle = "#e2e8f0";
        ctx.beginPath();
        ctx.moveTo(marginX, y + rowH);
        ctx.lineTo(marginX + maxW, y + rowH);
        ctx.stroke();

        let cx = marginX;
        // №
        ctx.fillStyle = "#64748b";
        ctx.font = `10px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(String(n), cx + widths[0]! / 2, y + 16);
        cx += widths[0]!;

        // Name
        ctx.textAlign = "left";
        ctx.fillStyle = "#0f172a";
        ctx.font = `bold 10px ${FONT}`;
        ctx.fillText(truncate(ctx, e.fullName, widths[1]! - 8), cx + 5, y + 16);
        cx += widths[1]!;

        // Role
        ctx.fillStyle = "#475569";
        ctx.font = `9px ${FONT}`;
        ctx.fillText(truncate(ctx, e.roleLabel, widths[2]! - 6), cx + 4, y + 16);
        cx += widths[2]!;

        // Branch
        ctx.fillText(truncate(ctx, e.branch, widths[3]! - 8), cx + 4, y + 16);
        cx += widths[3]!;

        // Shift
        ctx.fillText(truncate(ctx, e.shiftDisplay, widths[4]! - 6), cx + 4, y + 16);
        cx += widths[4]!;

        // Present days
        ctx.fillStyle = "#047857";
        ctx.font = `bold 11px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(String(e.presentDays), cx + widths[5]! / 2, y + 16);
        cx += widths[5]!;

        // Absent days
        ctx.fillStyle = "#be123c";
        ctx.fillText(String(e.absentDays), cx + widths[6]! / 2, y + 16);
        cx += widths[6]!;

        // Rate
        ctx.textAlign = "left";
        drawRateBadge(ctx, e.presentRate, cx + 1, y + 18, widths[7]! - 2);

        // Dates sub-line
        ctx.fillStyle = "#047857";
        ctx.font = `8px ${FONT}`;
        ctx.fillText(
          truncate(ctx, `Kelgan: ${fmtDates(e.presentDates, 12)}`, maxW * 0.48),
          marginX + 6,
          y + 30,
        );
        ctx.fillStyle = "#be123c";
        ctx.fillText(
          truncate(ctx, `Kelmagan: ${fmtDates(e.absentDates, 12)}`, maxW * 0.48),
          marginX + maxW * 0.5,
          y + 30,
        );

        y += rowH;
        empIndex += 1;
      }
    });
  }

  // —— 3) Kelmaganlar ——
  if (report.noShows.length) {
    let noIdx = 0;
    while (noIdx < report.noShows.length) {
      paintPage((ctx, W, H) => {
        const pageNo = pages.length + 1;
        let y = drawPageChrome(ctx, W, H, pageNo, "Kelmaganlar");
        const maxW = W - marginX * 2;
        const bottom = footerY(H) - 16;

        ctx.fillStyle = "#be123c";
        ctx.font = `bold 12px ${FONT}`;
        ctx.fillText(
          `3. Davomat qilmaganlar — ${report.noShows.length} ta xodim`,
          marginX,
          y,
        );
        y += 6;
        ctx.fillStyle = "#94a3b8";
        ctx.font = `9px ${FONT}`;
        ctx.fillText(
          "Tanlangan davrda birorta ham kelmagan (0%). Ro‘yxat tekshirish uchun.",
          marginX,
          y + 12,
        );
        y += 24;

        ctx.fillStyle = "#9f1239";
        ctx.fillRect(marginX, y, maxW, 20);
        ctx.fillStyle = "#fff";
        ctx.font = `bold 9px ${FONT}`;
        ctx.fillText("№", marginX + 8, y + 13);
        ctx.fillText("F.I.Sh.", marginX + 36, y + 13);
        ctx.fillText("Lavozim", marginX + maxW * 0.38, y + 13);
        ctx.fillText("Filial", marginX + maxW * 0.55, y + 13);
        ctx.fillText("Smena", marginX + maxW * 0.78, y + 13);
        y += 20;

        const rowH = 24;
        while (noIdx < report.noShows.length && y + rowH < bottom) {
          const e = report.noShows[noIdx]!;
          const n = noIdx + 1;
          ctx.fillStyle = n % 2 === 0 ? "#fff1f2" : "#ffffff";
          ctx.fillRect(marginX, y, maxW, rowH);
          ctx.fillStyle = "#9f1239";
          ctx.font = `10px ${FONT}`;
          ctx.fillText(String(n), marginX + 8, y + 16);
          ctx.fillStyle = "#0f172a";
          ctx.font = `bold 10px ${FONT}`;
          ctx.fillText(truncate(ctx, e.fullName, maxW * 0.32), marginX + 36, y + 16);
          ctx.font = `10px ${FONT}`;
          ctx.fillStyle = "#475569";
          ctx.fillText(truncate(ctx, e.roleLabel, maxW * 0.15), marginX + maxW * 0.38, y + 16);
          ctx.fillText(truncate(ctx, e.branch, maxW * 0.2), marginX + maxW * 0.55, y + 16);
          ctx.fillText(truncate(ctx, e.shiftDisplay, maxW * 0.16), marginX + maxW * 0.78, y + 16);
          y += rowH;
          noIdx += 1;
        }
      });
    }
  }

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    pdf.addImage(
      pages[i]!.toDataURL("image/jpeg", 0.93),
      "JPEG",
      0,
      0,
      pageW,
      pageH,
      undefined,
      "FAST",
    );
  }
  const stamp = report.to.replace(/-/g, "");
  const safeName = report.coordinator.fullName.replace(/[^\w\u0400-\u04FF]+/g, "_");
  await deliverFile(pdf.output("blob"), `Hisobot_${safeName}_${stamp}.pdf`);
}
