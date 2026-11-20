/**
 * Telegram bot: aniq keldim/ketdim javobi + majburiyat / mijoz baholash QR fayllari.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desc, eq, or, sql } from "drizzle-orm";
import { attendanceRecordsTable, db, employeesTable } from "@workspace/db";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  listQrCodes,
  scopedBranchIds,
} from "./customer-ratings";
import { logger } from "./logger";
import type { LinkedPlatformUser } from "./personal-bot-context";

const TZ = "Asia/Tashkent";

function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("uz-UZ", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function fmtDay(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return String(ymd);
}

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** Holatni o‘zbekcha, aniq */
export function statusLabelUz(status: string, excused?: boolean | null): string {
  if (excused) return "Sababli";
  const s = String(status || "").toLowerCase();
  if (s === "present" || s === "on_time" || s === "ok") return "O‘z vaqtida";
  if (s === "late") return "Kechikkan";
  if (s === "absent") return "Kelmagan";
  if (s === "incomplete") return "Ketdim yo‘q";
  if (s === "leave" || s === "vacation") return "Ta’til";
  if (s === "day_off" || s === "rest") return "Dam olish";
  return status || "Noma’lum";
}

function statusEmoji(status: string, excused?: boolean | null): string {
  if (excused) return "📝";
  const s = String(status || "").toLowerCase();
  if (s === "present" || s === "on_time" || s === "ok") return "✅";
  if (s === "late") return "🟡";
  if (s === "absent") return "🔴";
  if (s === "incomplete") return "🟠";
  if (s === "leave" || s === "vacation") return "🏖";
  return "•";
}

/** Faqat holat/hisobot so‘rovi — muammo matnini ushlamaydi */
export function looksAttendanceQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`']/g, "'").trim();
  if (looksAttendanceTrouble(t)) return false;
  return (
    /^(davomat|holatim|statistik)[\s!.?]*$/i.test(t) ||
    /davomat\s*(qanday|holat|bugun|ko'?r|och|stat)|bugun\s*(keldimmi|kelganmi|davomat)|keldimmi|ketdimmi|kelganmi|kechikdimmi|7\s*kunlik|oxirgi\s*davomat/.test(
      t,
    )
  );
}

/** «davomat qilolmayabman / bo‘lmadi» — hisobot emas, AI yordam */
export function looksAttendanceTrouble(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`']/g, "'");
  return /davomat.*(qilol|bo'?lmadi|ishlamay|ochilmay|saqlan|xato|muammo|chiqmay)|keldim.*(qilol|bo'?lmadi|ishlamay)|ketdim.*(qilol|bo'?lmadi)|face\s*id.*(ishlamay|ochilmay|tanima)|qr.*(ishlamay|ochilmay|o'?qima)|gps.*(ishlamay|topilmay)|joylashuv.*(ishlamay|ruxsat)/.test(
    t,
  );
}

export function looksMajburiyatRequest(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`]/g, "'");
  return /majburiyat|qaytarib\s*olmas|dori.*(qaytar|almashtir)|mahsulot.*(qaytar|almashtir)|poster|vaksina.?med.?poster|185.?son|39.?band/.test(
    t,
  );
}

export function looksBahoQrRequest(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`]/g, "'");
  return /mijoz.*(baho|qr)|baholash\s*qr|baho\s*qr|qr.*(baho|mijoz)|mijozlar\s*baholash|customer\s*rating|filial\s*qr|qr\s*(ber|yubor|tashla|kerak|olish)/.test(
    t,
  );
}

async function loadMyAttendanceRows(userId: number, limit = 14) {
  const [emp] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);
  return db
    .select()
    .from(attendanceRecordsTable)
    .where(
      or(
        eq(attendanceRecordsTable.userId, userId),
        emp ? eq(attendanceRecordsTable.employeeId, emp.id) : sql`false`,
      ),
    )
    .orderBy(desc(attendanceRecordsTable.workDate))
    .limit(limit);
}

/** Gemini kontekstiga ham sodda, aniq blok */
export function formatAttendanceSnapshotBlock(
  recs: Array<{
    workDate: string;
    checkInAt: Date | string | null;
    checkOutAt: Date | string | null;
    status: string;
    excused?: boolean | null;
  }>,
): string {
  if (!recs.length) return "Davomat: yozuv topilmadi.";
  const lines = recs.map((r) => {
    const inT = fmtTime(r.checkInAt);
    const outT = fmtTime(r.checkOutAt);
    const holat = statusLabelUz(r.status, r.excused);
    return `${fmtDay(r.workDate)}: Keldim ${inT || "—"} | Ketdim ${outT || "—"} | Holat: ${holat}`;
  });
  return `Davomat (Toshkent, aniq):\n${lines.join("\n")}`;
}

/**
 * Telegramga yuboriladigan to‘liq o‘zbekcha javob.
 * 🟢 = vaqt bor (yashil), ⚪ = yo‘q.
 */
export async function buildAttendanceReplyUz(userId: number, fullName: string): Promise<string> {
  const today = todayYmd();
  let recs: Awaited<ReturnType<typeof loadMyAttendanceRows>> = [];
  try {
    recs = await loadMyAttendanceRows(userId, 14);
  } catch (err) {
    logger.warn({ err }, "bot-attendance: load");
    return "Davomatni hozir o‘qib bo‘lmadi. Birozdan keyin qayta so‘rang.";
  }

  const todayRec = recs.find((r) => String(r.workDate) === today) || null;
  const week = recs.slice(0, 7);
  let kelgan = 0;
  let kech = 0;
  let kelmagan = 0;
  let ketdimYoq = 0;
  for (const r of week) {
    const s = String(r.status || "").toLowerCase();
    if (r.excused) continue;
    if (s === "late") kech += 1;
    else if (s === "absent") kelmagan += 1;
    else if (s === "incomplete") ketdimYoq += 1;
    else if (s === "present" || s === "on_time" || s === "ok") kelgan += 1;
    else if (r.checkInAt) kelgan += 1;
  }

  const inT = todayRec ? fmtTime(todayRec.checkInAt) : "";
  const outT = todayRec ? fmtTime(todayRec.checkOutAt) : "";
  const holat = todayRec
    ? statusLabelUz(todayRec.status, todayRec.excused)
    : "Hali yozuv yo‘q";
  const holatIcon = todayRec ? statusEmoji(todayRec.status, todayRec.excused) : "⚪";

  const lines: string[] = [
    `<b>📋 ${fullName}</b> · ${fmtDay(today)}`,
    inT ? `🟢 Keldim: <b>${inT}</b>` : `⚪ Keldim: hali yo‘q`,
    outT ? `🟢 Ketdim: <b>${outT}</b>` : `⚪ Ketdim: hali yo‘q`,
    `${holatIcon} Holat: <b>${holat}</b>`,
    `📊 7 kun: ✅${kelgan} · 🟡${kech} · 🔴${kelmagan} · 🟠${ketdimYoq}`,
  ];

  for (const r of recs.slice(0, 4)) {
    if (String(r.workDate) === today) continue;
    const i = fmtTime(r.checkInAt) || "—";
    const o = fmtTime(r.checkOutAt) || "—";
    lines.push(
      `• ${fmtDay(r.workDate)}: ${i} → ${o} · ${statusLabelUz(r.status, r.excused)}`,
    );
  }

  return lines.join("\n");
}

function resolveMajburiyatPdfPath(): string | null {
  const candidates = [
    resolve(process.cwd(), "artifacts/vaksina-hr/dist/public/posters/vaksina-med-poster.pdf"),
    resolve(process.cwd(), "artifacts/vaksina-hr/public/posters/vaksina-med-poster.pdf"),
    resolve(process.cwd(), "../vaksina-hr/public/posters/vaksina-med-poster.pdf"),
    resolve(process.cwd(), "../vaksina-hr/dist/public/posters/vaksina-med-poster.pdf"),
    resolve("/opt/hr_ai/artifacts/vaksina-hr/dist/public/posters/vaksina-med-poster.pdf"),
    resolve("/opt/hr_ai/artifacts/vaksina-hr/public/posters/vaksina-med-poster.pdf"),
    resolve("/opt/hr_ai/public/posters/vaksina-med-poster.pdf"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadMajburiyatPdf(): { buffer: Buffer; filename: string } | null {
  const path = resolveMajburiyatPdfPath();
  if (!path) {
    logger.warn("bot-docs: majburiyat PDF topilmadi");
    return null;
  }
  return {
    buffer: readFileSync(path),
    filename: "vaksina-med-majburiyat.pdf",
  };
}

async function qrPngBuffer(text: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const QRCode = require("qrcode") as typeof import("qrcode");
  return QRCode.toBuffer(text, {
    type: "png",
    width: 720,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#1a1028", light: "#ffffff" },
  });
}

/** Koordinator / mudir o‘z filiallari uchun mijoz baholash QR PDF */
export async function buildScopedBahoQrPdf(
  user: LinkedPlatformUser,
): Promise<{ buffer: Buffer; filename: string; count: number; caption: string } | null> {
  const role = String(user.role || "").toLowerCase();
  const allowed =
    role === "koordinator" ||
    role === "regional_menejer" ||
    role === "mudir" ||
    role === "admin" ||
    role === "hr" ||
    role === "hr_direktor" ||
    role === "hr_menejer";
  if (!allowed) {
    return null;
  }

  const scope = await scopedBranchIds(user.id, role);
  const items = (await listQrCodes(scope)).filter(
    (i) => i.publicUrl && i.status === "active",
  );
  if (!items.length) {
    return {
      buffer: Buffer.alloc(0),
      filename: "baho-qr.pdf",
      count: 0,
      caption:
        "Sizning doirangizda faol mijoz baholash QR topilmadi. Avval platformada «Mijozlar baholashi» → QR yarating.",
    };
  }

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);
  const purple = rgb(92 / 255, 45 / 255, 145 / 255);

  for (const it of items.slice(0, 80)) {
    const page = doc.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: height - 72, width, height: 72, color: purple });
    page.drawText("VAKSINA MED · Mijoz baholash QR", {
      x: 40,
      y: height - 42,
      size: 16,
      font,
      color: rgb(1, 1, 1),
    });

    const label = String(it.branchLabel || `Filial #${it.branchId}`).slice(0, 80);
    const asciiSafe = label.replace(/[^\x20-\x7E]/g, "?");
    page.drawText(asciiSafe || `Branch #${it.branchId}`, {
      x: 40,
      y: height - 110,
      size: 18,
      font,
      color: purple,
    });
    if (it.regionLabel) {
      const reg = String(it.regionLabel).replace(/[^\x20-\x7E]/g, "?").slice(0, 70);
      page.drawText(reg, {
        x: 40,
        y: height - 132,
        size: 11,
        font: fontReg,
        color: rgb(0.35, 0.35, 0.4),
      });
    }

    const png = await qrPngBuffer(it.publicUrl!);
    const img = await doc.embedPng(png);
    const size = 280;
    const x = (width - size) / 2;
    const y = height / 2 - size / 2;
    page.drawRectangle({
      x: x - 12,
      y: y - 12,
      width: size + 24,
      height: size + 24,
      borderColor: purple,
      borderWidth: 2,
    });
    page.drawImage(img, { x, y, width: size, height: size });

    page.drawText("QR ni skanerlab baho bering", {
      x: 40,
      y: 80,
      size: 12,
      font: fontReg,
      color: rgb(0.2, 0.2, 0.25),
    });
    page.drawText(String(it.publicUrl || "").slice(0, 90), {
      x: 40,
      y: 58,
      size: 9,
      font: fontReg,
      color: rgb(0.45, 0.45, 0.5),
    });
  }

  const bytes = await doc.save();
  const buffer = Buffer.from(bytes);
  return {
    buffer,
    filename: `mijoz-baho-qr-${items.length}.pdf`,
    count: items.length,
    caption: `Mijozlar baholashi QR — sizning filiallaringiz: <b>${items.length}</b> ta.\nChop etib kassa oldiga qo‘ying.`,
  };
}
