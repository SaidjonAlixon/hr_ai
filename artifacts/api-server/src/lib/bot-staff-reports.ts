/**
 * Bot: 1 oylik davomat PDF/text, oylik, kechikish/jarima tushuntirish (faqat o‘qish).
 * Jarima qoidalari — AI tushuntirish (bazani o‘zgartirmaydi).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import {
  attendanceRecordsTable,
  db,
  employeesTable,
  payrollMonthsTable,
  pool,
} from "@workspace/db";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { statusLabelUz } from "./bot-attendance-docs";
import { logger } from "./logger";
import type { LinkedPlatformUser } from "./personal-bot-context";

const TZ = "Asia/Tashkent";
const PURPLE = rgb(92 / 255, 45 / 255, 145 / 255);
const INK = rgb(0.08, 0.1, 0.16);
const MUTED = rgb(0.4, 0.45, 0.55);
const GREEN = rgb(0.06, 0.55, 0.35);
const AMBER = rgb(0.72, 0.45, 0.05);
const ROSE = rgb(0.75, 0.15, 0.25);

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

function monthKeyFromYmd(ymd: string): string {
  return ymd.slice(0, 7);
}

function monthStartEnd(month: string): { from: string; to: string; days: number } {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(days).padStart(2, "0")}`,
    days,
  };
}

function fmtDay(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ymd;
}

function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("uz-UZ", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function money(n: number): string {
  return `${Math.round(n).toLocaleString("uz-UZ")} so‘m`;
}

export function looksAttendancePdfRequest(text: string): boolean {
  const t = text.toLowerCase();
  return /davomat.*(pdf|fayl|yukla|tashla|ber)|pdf.*(davomat|oylik)|1\s*oylik|oxirgi\s*oy|oylik\s*davomat/.test(
    t,
  );
}

/**
 * «Oylik ololmadim / maosh kelmadi» — hisobot emas, koordinator/HR yo‘li.
 * Oddiy «oylik qancha?» so‘rovidan farq qiladi.
 */
export function looksUnpaidSalaryIssue(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`']/g, "'");
  if (
    /(oylik|maosh|ish\s*haq|зарплат).{0,48}(olol|olmadi|ololmay|olganim\s*yo'?q?|kelmadi|berilmadi|bermad|chiqmadi|tushmadi|tushmay|kelmay|muammo|problem)|(olol|olmadi|kelmadi|berilmadi).{0,24}(oylik|maosh)|(не\s*получил).{0,24}(зарп|оклад)|salary.{0,24}(not\s*paid|didn'?t\s*get)/.test(
      t,
    )
  ) {
    return true;
  }
  // «oylik muammo», «maosh bilan muammo»
  return /(oylik|maosh|ish\s*haq).{0,20}(muammo|problem)|muammo.{0,20}(oylik|maosh)/.test(t);
}

export function looksOylikOrJarimaQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`']/g, "'");
  // Oylik OLINMAGAN shikoyat — jadval tashlamaslik
  if (looksUnpaidSalaryIssue(t)) return false;
  return /oylik|maosh|ish\s*haq|jarima|shtraf|штраф|штраф|ushlab|ushlangan|olishib|olishob|kechik.*qancha|qancha\s*kech|necha\s*marta\s*kech|statistika|hisob|qancha\s*olaman|olamanmi/.test(
    t,
  );
}

/** «Shtraf/jarima olishibdi» — tushuntirish (escalate emas) */
export function looksFineComplaint(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’ʻ`']/g, "'");
  return /shtraf|штраф|jarima.*(ol|bor|nega|nima|qancha)|ushlab\s*ol|ushlangan|olishib|olishob|олиш(иб|об)|ушлан/.test(
    t,
  );
}

/** Shtraf savoliga: kech/kelmagan → jarima mumkin; hozirgi holat + ijobiy yakun */
export function formatFineExplainReply(pack: MonthAttendancePack): string {
  const lines: string[] = [];
  lines.push(
    "Agar kech qolgan yoki kelmagan kuningiz bo‘lsa, shu asosda jarima (ushlab qolish) qo‘llanilgan bo‘lishi mumkin.",
  );
  lines.push("");
  lines.push(`Hozirgi oy (${pack.month}) holatingiz:`);
  lines.push(
    `• Vaqtida: ${pack.onTime} · Kech: ${pack.late} · Kelmagan: ${pack.absent}` +
      (pack.excused ? ` · Sababli: ${pack.excused}` : ""),
  );

  if (pack.payrollJarima != null && pack.payrollJarima > 0) {
    lines.push(`• Hisob-kitobdagi jarima: ${money(pack.payrollJarima)}`);
  } else if (pack.penaltyAmount > 0) {
    lines.push(`• Qoida bo‘yicha taxminiy ushlash: ${money(pack.penaltyAmount)}`);
    for (const l of pack.penaltyLines.slice(0, 3)) lines.push(`  — ${l}`);
  } else {
    lines.push("• Bu oyda jarima zinasiga hali yetmagansiz.");
  }

  lines.push("");
  if (pack.late === 0 && pack.absent === 0) {
    lines.push(
      "Yaxshi yangilik: shu oyda kechikish/kelmaslik yo‘q — intizomingiz joyida. Oldingi oy uchun alohida hisob bo‘lishi mumkin; batafsil «davomat pdf» deb yozing.",
    );
  } else if (pack.late + pack.absent <= 2) {
    lines.push(
      "Holat yengil. Vaqtida kelishni davom ettiring — qo‘shimcha jarima bo‘lmasin. Savolingiz bo‘lsa yozing.",
    );
  } else {
    lines.push(pack.nextWarning);
    lines.push("Savol qoldimi — yozing, tushuntiraman.");
  }
  return lines.join("\n");
}

export function wantsPdf(text: string): boolean {
  return /pdf|fayl|yukla|tashla|hujjat/.test(text.toLowerCase());
}

type DayRow = {
  workDate: string;
  checkInAt: Date | string | null;
  checkOutAt: Date | string | null;
  status: string;
  excused: boolean | null;
};

export type MonthAttendancePack = {
  month: string;
  from: string;
  to: string;
  monthDays: number;
  fullName: string;
  role: string;
  monthlySalary: number;
  dailySalary: number;
  rows: DayRow[];
  late: number;
  absent: number;
  onTime: number;
  incomplete: number;
  excused: number;
  presentDays: number;
  penaltyAmount: number;
  penaltyLines: string[];
  nextWarning: string;
  payrollTotal: number | null;
  payrollJarima: number | null;
  payrollStatus: string | null;
};

async function loadEmployeeSalary(userId: number): Promise<{
  fixedSalary: number;
  employeeId: number | null;
  fullName: string;
}> {
  const [emp] = await db
    .select({
      id: employeesTable.id,
      fullName: employeesTable.fullName,
      fixedSalary: employeesTable.fixedSalary,
    })
    .from(employeesTable)
    .where(eq(employeesTable.userId, userId))
    .limit(1);
  return {
    fixedSalary: Math.max(0, Number(emp?.fixedSalary || 0)),
    employeeId: emp?.id ?? null,
    fullName: emp?.fullName || "",
  };
}

async function loadPayrollMonth(userId: number, month: string) {
  const [row] = await db
    .select({
      fixedSalary: payrollMonthsTable.fixedSalary,
      totalAmount: payrollMonthsTable.totalAmount,
      jarima: payrollMonthsTable.jarima,
      jarimaNote: payrollMonthsTable.jarimaNote,
      status: payrollMonthsTable.status,
      bonusAmount: payrollMonthsTable.bonusAmount,
    })
    .from(payrollMonthsTable)
    .where(and(eq(payrollMonthsTable.userId, userId), eq(payrollMonthsTable.month, month)))
    .limit(1);
  return row ?? null;
}

async function loadMonthAttendance(
  userId: number,
  employeeId: number | null,
  from: string,
  to: string,
): Promise<DayRow[]> {
  const rows = await db
    .select({
      workDate: attendanceRecordsTable.workDate,
      checkInAt: attendanceRecordsTable.checkInAt,
      checkOutAt: attendanceRecordsTable.checkOutAt,
      status: attendanceRecordsTable.status,
      excused: attendanceRecordsTable.excused,
    })
    .from(attendanceRecordsTable)
    .where(
      and(
        or(
          eq(attendanceRecordsTable.userId, userId),
          employeeId ? eq(attendanceRecordsTable.employeeId, employeeId) : sql`false`,
        ),
        gte(attendanceRecordsTable.workDate, from),
        lte(attendanceRecordsTable.workDate, to),
      ),
    )
    .orderBy(attendanceRecordsTable.workDate);
  return rows.map((r) => ({
    workDate: String(r.workDate),
    checkInAt: r.checkInAt,
    checkOutAt: r.checkOutAt,
    status: String(r.status || ""),
    excused: r.excused ?? null,
  }));
}

/**
 * Foydalanuvchi aytgan jarima zinalari (tushuntirish uchun).
 * 3 kech → 0.5 kun; takror (6) → +1 kun; yana (9) → +2 kun;
 * 8+ kech/kelmagan → 3 kun; sababsiz 9–10 kelmagan → oylik 30%.
 */
export function computePenaltyAdvisory(
  late: number,
  absent: number,
  monthlySalary: number,
  monthDays: number,
): { amount: number; lines: string[]; nextWarning: string } {
  const daily = monthlySalary > 0 ? Math.round(monthlySalary / Math.max(1, monthDays)) : 0;
  const miss = late + absent;
  const lines: string[] = [];
  let amount = 0;

  if (absent >= 9) {
    amount = Math.round(monthlySalary * 0.3);
    lines.push(
      `Sababsiz ${absent} kun kelmagan → oylikning 30% ushlanadi (${money(amount)}).`,
    );
  } else if (miss >= 8) {
    amount = daily * 3;
    lines.push(
      `Oyda ${miss} marta kech/kelmagan (≥8) → 3 kunlik ish haqi (${money(amount)}).`,
    );
  } else {
    if (late >= 3) {
      const a = Math.round(daily * 0.5);
      amount += a;
      lines.push(`3 marta kechikish → 1 kunlik ish haqining 50% (${money(a)}).`);
    }
    if (late >= 6) {
      const a = daily;
      amount += a;
      lines.push(`Shu oyda takror (≥6 kech) → yana 1 kunlik to‘liq (${money(a)}).`);
    }
    if (late >= 9) {
      const a = daily * 2;
      amount += a;
      lines.push(`Yana takror (≥9 kech) → 2 kunlik to‘liq (${money(a)}).`);
    }
  }

  let nextWarning = "Hozircha qo‘shimcha jarima bo‘lmasa, vaqtida keling.";
  if (absent >= 9) {
    nextWarning = "Ogohlantirish: sababsiz kelmaslik oylikdan katta ushlashga olib keladi.";
  } else if (miss >= 8) {
    nextWarning = "Ogohlantirish: yana sababsiz 9–10 kun → oylikning 30% ushlanishi mumkin.";
  } else if (late >= 6) {
    nextWarning = "Ogohlantirish: yana kechikishlar → +2 kunlik yoki ≥8 holatda 3 kunlik ushlash.";
  } else if (late >= 3) {
    nextWarning = "Ogohlantirish: yana 3 marta kech → qo‘shimcha 1 kunlik to‘liq ushlash.";
  } else if (late === 2) {
    nextWarning = "Ogohlantirish: yana 1 marta kech (jami 3) → 0.5 kunlik ushlash boshlanadi.";
  } else if (late === 1) {
    nextWarning = "1 marta kechikdingiz. 3 ga yetmasin.";
  }

  if (!lines.length) {
    lines.push("Bu oyda jarima zinasiga hali yetmagansiz.");
  }

  return { amount, lines, nextWarning };
}

export async function buildMonthAttendancePack(
  user: LinkedPlatformUser,
  month?: string,
): Promise<MonthAttendancePack> {
  const m = month || monthKeyFromYmd(todayYmd());
  const { from, to, days: monthDays } = monthStartEnd(m);
  const emp = await loadEmployeeSalary(user.id);
  const payroll = await loadPayrollMonth(user.id, m);
  const monthlySalary = Math.max(
    0,
    Number(payroll?.fixedSalary || emp.fixedSalary || 0),
  );
  const dailySalary = monthlySalary > 0 ? Math.round(monthlySalary / Math.max(1, monthDays)) : 0;
  const rows = await loadMonthAttendance(user.id, emp.employeeId, from, to);

  let late = 0;
  let absent = 0;
  let onTime = 0;
  let incomplete = 0;
  let excused = 0;
  let presentDays = 0;

  for (const r of rows) {
    if (r.excused) {
      excused += 1;
      continue;
    }
    const s = r.status.toLowerCase();
    if (s === "late") late += 1;
    else if (s === "absent") absent += 1;
    else if (s === "incomplete") incomplete += 1;
    else if (s === "present" || s === "on_time" || s === "ok") {
      onTime += 1;
      presentDays += 1;
    } else if (r.checkInAt) {
      presentDays += 1;
      onTime += 1;
    }
  }

  const pen = computePenaltyAdvisory(late, absent, monthlySalary, monthDays);

  return {
    month: m,
    from,
    to,
    monthDays,
    fullName: emp.fullName || user.fullName,
    role: user.role,
    monthlySalary,
    dailySalary,
    rows,
    late,
    absent,
    onTime,
    incomplete,
    excused,
    presentDays,
    penaltyAmount: pen.amount,
    penaltyLines: pen.lines,
    nextWarning: pen.nextWarning,
    payrollTotal: payroll?.totalAmount != null ? Number(payroll.totalAmount) : null,
    payrollJarima: payroll?.jarima != null ? Number(payroll.jarima) : null,
    payrollStatus: payroll?.status ?? null,
  };
}

export function formatMonthAttendanceText(pack: MonthAttendancePack): string {
  const lines = [
    `<b>📅 ${pack.fullName}</b> · ${pack.month}`,
    `🟢 Vaqtida: <b>${pack.onTime}</b> · 🟡 Kech: <b>${pack.late}</b> · 🔴 Kelmagan: <b>${pack.absent}</b>`,
    `🟠 Ketdim yo‘q: <b>${pack.incomplete}</b> · 📝 Sababli: <b>${pack.excused}</b>`,
    pack.monthlySalary > 0
      ? `💰 Oylik (baza): <b>${money(pack.monthlySalary)}</b> · 1 kun ≈ <b>${money(pack.dailySalary)}</b>`
      : `💰 Oylik baza bazada ko‘rinmayapti — HR dan so‘rang.`,
  ];
  // Status (draft/tasdiqlanmagan) xodimga aytilmaydi
  if (pack.payrollTotal != null && pack.payrollStatus === "approved") {
    lines.push(
      `📊 Hisob-kitob: jami ${money(pack.payrollTotal)}${pack.payrollJarima ? ` · jarima ${money(pack.payrollJarima)}` : ""}`,
    );
  }
  lines.push("", `<b>Jarima (qoida bo‘yicha):</b>`);
  for (const l of pack.penaltyLines) lines.push(`• ${l}`);
  if (pack.penaltyAmount > 0) {
    lines.push(`👉 Taxminiy ushlash: <b>${money(pack.penaltyAmount)}</b>`);
  }
  lines.push(pack.nextWarning);
  lines.push("", "PDF kerak bo‘lsa: «davomat pdf» deb yozing.");
  return lines.join("\n");
}

async function readFont(file: string): Promise<Uint8Array> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "assets", "fonts", file),
    path.join(here, "..", "assets", "fonts", file),
    path.join(here, "..", "..", "assets", "fonts", file),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "fonts", file),
    path.join(process.cwd(), "assets", "fonts", file),
    `/opt/hr_ai/artifacts/api-server/assets/fonts/${file}`,
  ];
  for (const p of candidates) {
    try {
      return new Uint8Array(await readFile(p));
    } catch {
      /* next */
    }
  }
  throw new Error(`Font topilmadi: ${file}`);
}

function fit(text: string, font: PDFFont, size: number, max: number): string {
  const t = String(text || "").replace(/\s+/g, " ").trim() || "—";
  if (font.widthOfTextAtSize(t, size) <= max) return t;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > max) s = s.slice(0, -1);
  return `${s}…`;
}

export async function buildMonthAttendancePdf(pack: MonthAttendancePack): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFont("DejaVuSans.ttf"), { subset: true });
  const bold = await doc.embedFont(await readFont("DejaVuSans-Bold.ttf"), { subset: true });

  const PW = 595.28;
  const PH = 841.89;
  const M = 36;
  let page = doc.addPage([PW, PH]);
  let y = PH - M;

  const draw = (text: string, opts: { size?: number; b?: boolean; color?: ReturnType<typeof rgb>; x?: number }) => {
    const size = opts.size ?? 10;
    const f = opts.b ? bold : font;
    page.drawText(fit(text, f, size, PW - M * 2 - (opts.x || 0)), {
      x: M + (opts.x || 0),
      y: y - size,
      size,
      font: f,
      color: opts.color || INK,
    });
    y -= size + 4;
  };

  page.drawRectangle({ x: 0, y: PH - 64, width: PW, height: 64, color: PURPLE });
  page.drawText("VAKSINA MED · Davomat hisoboti", {
    x: M,
    y: PH - 38,
    size: 16,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText(`${pack.fullName} · ${pack.month} · ${pack.role}`, {
    x: M,
    y: PH - 54,
    size: 10,
    font,
    color: rgb(0.92, 0.88, 1),
  });
  y = PH - 80;

  draw(`Davr: ${fmtDay(pack.from)} — ${fmtDay(pack.to)}`, { size: 10, color: MUTED });
  draw(
    `Vaqtida: ${pack.onTime}   Kech: ${pack.late}   Kelmagan: ${pack.absent}   Ketdim yo‘q: ${pack.incomplete}   Sababli: ${pack.excused}`,
    { size: 10, b: true },
  );
  if (pack.monthlySalary > 0) {
    draw(`Oylik baza: ${money(pack.monthlySalary)} · 1 kun ≈ ${money(pack.dailySalary)}`, {
      size: 10,
      color: GREEN,
      b: true,
    });
  }
  if (pack.payrollTotal != null && pack.payrollStatus === "approved") {
    draw(
      `Hisob-kitob jami: ${money(pack.payrollTotal)}${pack.payrollJarima ? ` · jarima ${money(pack.payrollJarima)}` : ""}`,
      { size: 10 },
    );
  }

  y -= 6;
  draw("Jarima qoidalari (shu oy):", { size: 11, b: true, color: PURPLE });
  for (const line of pack.penaltyLines) {
    draw(`• ${line}`, { size: 9 });
  }
  if (pack.penaltyAmount > 0) {
    draw(`Taxminiy ushlash: ${money(pack.penaltyAmount)}`, { size: 11, b: true, color: ROSE });
  }
  draw(pack.nextWarning, { size: 9, color: AMBER });

  y -= 8;
  // Table header
  const cols = [
    { t: "Sana", w: 70 },
    { t: "Keldim", w: 70 },
    { t: "Ketdim", w: 70 },
    { t: "Holat", w: 120 },
  ];
  const usable = cols.reduce((a, c) => a + c.w, 0);
  const drawHeader = () => {
    page.drawRectangle({ x: M, y: y - 16, width: usable + 20, height: 16, color: PURPLE });
    let x = M + 4;
    for (const c of cols) {
      page.drawText(c.t, { x, y: y - 12, size: 9, font: bold, color: rgb(1, 1, 1) });
      x += c.w;
    }
    y -= 18;
  };
  drawHeader();

  for (const r of pack.rows) {
    if (y < 48) {
      page = doc.addPage([PW, PH]);
      y = PH - M;
      drawHeader();
    }
    const holat = statusLabelUz(r.status, r.excused);
    const s = r.status.toLowerCase();
    const color =
      r.excused || s === "present" || s === "on_time"
        ? GREEN
        : s === "late"
          ? AMBER
          : s === "absent"
            ? ROSE
            : INK;
    const cells = [fmtDay(r.workDate), fmtTime(r.checkInAt), fmtTime(r.checkOutAt), holat];
    let x = M + 4;
    cells.forEach((cell, i) => {
      page.drawText(fit(cell, font, 9, cols[i]!.w - 6), {
        x,
        y: y - 10,
        size: 9,
        font: i === 3 ? bold : font,
        color: i === 3 ? color : INK,
      });
      x += cols[i]!.w;
    });
    y -= 14;
  }

  y -= 10;
  if (y > 40) {
    page.drawText("Faqat ma’lumot. Bazaga o‘zgartirish kiritilmaydi. · Men AI yordamchiman.", {
      x: M,
      y: 28,
      size: 8,
      font,
      color: MUTED,
    });
  }

  return Buffer.from(await doc.save());
}

/** Sizga qo‘yilgan ochiq vazifalar — odamdek eslatma */
export async function formatTasksHumanReminder(userId: number): Promise<string> {
  try {
    const { rows } = await pool.query<{
      id: number;
      title: string;
      status: string;
      due_at: Date | null;
      creator: string | null;
    }>(
      `
      SELECT t.id, t.title, t.status, t.due_at,
             u.full_name AS creator
        FROM tasks t
        LEFT JOIN employees e ON t.assignee_kind = 'employee' AND e.id = t.assignee_id
        LEFT JOIN users u ON u.id = t.created_by_id
       WHERE t.status IN ('todo', 'in_progress')
         AND t.candidate_id IS NULL
         AND t.pipeline_stage IS NULL
         AND t.title !~* '^[0-9]+-qadam'
         AND (
           CASE WHEN t.assignee_kind = 'employee' THEN e.user_id ELSE t.assignee_id END
         ) = $1
       ORDER BY t.due_at NULLS LAST, t.id DESC
       LIMIT 12
      `,
      [userId],
    );
    if (!rows.length) {
      return "Sizga qo‘yilgan ochiq vazifa hozircha yo‘q.\nYangi kerak bo‘lsa «topshiriq yarat» deb yozing.\nMen AI Saydman.";
    }
    const open = rows.length;
    const lines = [
      `<b>Sizga qo‘yilgan vazifalar</b> — ochiq <b>${open}</b> ta:`,
      "",
    ];
    rows.forEach((r, i) => {
      const due = r.due_at
        ? new Intl.DateTimeFormat("uz-UZ", {
            timeZone: TZ,
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(r.due_at))
        : "muddat yo‘q";
      const st = r.status === "in_progress" ? "jarayonda" : "kutilmoqda";
      const from = (r.creator || "—").replace(/</g, "");
      lines.push(
        `${i + 1}) «${String(r.title).replace(/\s+/g, " ").trim().slice(0, 90)}»\n   ${st} · muddat ${due} · kimdan: ${from}`,
      );
    });
    lines.push(
      "",
      "Bajarish uchun: <b>bajar</b> yoki raqam (masalan <b>1</b>).",
      "Men AI Saydman.",
    );
    return lines.join("\n");
  } catch (err) {
    logger.warn({ err }, "bot-staff: tasks");
    return "Topshiriqlarni hozir o‘qib bo‘lmadi. Qayta «vazifalarim» deb yozing.";
  }
}

export async function buildOylikContextBlock(user: LinkedPlatformUser): Promise<string> {
  try {
    const pack = await buildMonthAttendancePack(user);
    return [
      `OYLIK/DAAMAT (faqat shu odam, o‘qish):`,
      `month=${pack.month}; oylik_baza=${pack.monthlySalary}; kunlik≈${pack.dailySalary}`,
      `vaqtida=${pack.onTime}; kech=${pack.late}; kelmagan=${pack.absent}; ketdim_yoq=${pack.incomplete}`,
      `jarima_taxminiy=${pack.penaltyAmount}; qoida=${pack.penaltyLines.join(" | ")}`,
      pack.payrollTotal != null && pack.payrollStatus === "approved"
        ? `payroll_jami=${pack.payrollTotal}; payroll_jarima=${pack.payrollJarima}`
        : "payroll: xodimga status/draft dema",
      "Oylik muammo: ofis→HR; farmasevt/mudir/stajyor→koordinatarni xabardor qiling. Draft/tasdiqlanmagan dema.",
    ].join("\n");
  } catch (err) {
    logger.warn({ err }, "bot-staff: oylik ctx");
    return "Oylik kontekst: o‘qilmadi.";
  }
}
