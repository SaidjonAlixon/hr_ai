import ExcelJS from "exceljs";
import {
  formatTashkent,
  listLokatsiyaBotUsers,
  lokatsiyaUserDisplayName,
  lokatsiyaUserStats,
  type LokatsiyaBotUser,
} from "./filial-bot-users";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function buildLokatsiyaUsersTextReport(): Promise<string> {
  const [stats, users] = await Promise.all([lokatsiyaUserStats(), listLokatsiyaBotUsers()]);
  const lines: string[] = [
    "📊 <b>Vaksina lokatsiya — foydalanuvchilar</b>",
    `<i>${esc(formatTashkent(new Date()))} (Toshkent)</i>`,
    "",
    `👥 <b>Jami:</b> ${stats.total}`,
    `✅ <b>Aktiv:</b> ${stats.active}`,
    `🚫 <b>Bloklagan:</b> ${stats.blocked}`,
    `🌅 <b>Bugun /start:</b> ${stats.startsToday}`,
    `👁 <b>Bugun faol:</b> ${stats.seenToday}`,
    "",
    "<b>So‘nggi 15 ta:</b>",
  ];

  const top = users.slice(0, 15);
  if (!top.length) {
    lines.push("<i>Hali foydalanuvchi yo‘q</i>");
  } else {
    top.forEach((u, i) => {
      const un = u.username ? `@${u.username}` : "—";
      const st = u.is_blocked ? "🚫" : "✅";
      lines.push(
        `${i + 1}. ${st} <b>${esc(lokatsiyaUserDisplayName(u))}</b>`,
        `   ID: <code>${esc(String(u.telegram_user_id))}</code> · ${esc(un)}`,
        `   Start: ${esc(formatTashkent(u.first_start_at))} · Ko‘rish: ${u.branch_views} · /start: ${u.starts_count}`,
      );
    });
  }

  lines.push("", "<i>To‘liq ro‘yxat Excel faylda.</i>");
  return lines.join("\n");
}

export async function buildLokatsiyaUsersExcel(): Promise<{
  buffer: Buffer;
  count: number;
  filename: string;
  stats: Awaited<ReturnType<typeof lokatsiyaUserStats>>;
}> {
  const [users, stats] = await Promise.all([listLokatsiyaBotUsers(), lokatsiyaUserStats()]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Vaksina lokatsiya";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Foydalanuvchilar", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  sheet.mergeCells("A1:L1");
  const title = sheet.getCell("A1");
  title.value = `Vaksina lokatsiya — foydalanuvchilar · Jami ${stats.total} · Aktiv ${stats.active} · Blok ${stats.blocked} · ${formatTashkent(new Date())}`;
  title.font = { name: "Calibri", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A2540" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sheet.getRow(1).height = 28;

  const headers = [
    "№",
    "Ism",
    "Username",
    "Telegram ID",
    "Chat ID",
    "Til",
    "Holat",
    "/start soni",
    "Filial ko‘rish",
    "Birinchi start",
    "Oxirgi start",
    "Oxirgi faollik",
  ];
  const headerRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B5FFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  headerRow.height = 24;

  sheet.columns = [
    { width: 5 },
    { width: 26 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
    { width: 8 },
    { width: 12 },
    { width: 11 },
    { width: 12 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
  ];

  users.forEach((u: LokatsiyaBotUser, idx: number) => {
    const zebra = u.is_blocked ? "FFFEE2E2" : idx % 2 === 0 ? "FFF8FAFC" : "FFFFFFFF";
    const values = [
      idx + 1,
      lokatsiyaUserDisplayName(u),
      u.username ? `@${u.username}` : "—",
      String(u.telegram_user_id),
      String(u.chat_id),
      u.language_code || "—",
      u.is_blocked ? "Bloklagan" : "Aktiv",
      u.starts_count,
      u.branch_views,
      formatTashkent(u.first_start_at),
      formatTashkent(u.last_start_at),
      formatTashkent(u.last_seen_at),
    ];
    const row = sheet.addRow(values);
    row.eachCell((cell, col) => {
      cell.font = { name: "Calibri", size: 11, bold: col === 2 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
      cell.alignment = {
        vertical: "middle",
        horizontal: col === 1 || col === 7 || col === 8 || col === 9 ? "center" : "left",
      };
      if (col === 4 || col === 5) cell.numFmt = "@";
    });
    row.height = 20;
  });

  const summary = wb.addWorksheet("Statistika");
  summary.columns = [{ width: 28 }, { width: 18 }];
  summary.addRow(["Ko‘rsatkich", "Qiymat"]);
  summary.getRow(1).font = { bold: true };
  summary.addRow(["Jami foydalanuvchi", stats.total]);
  summary.addRow(["Aktiv", stats.active]);
  summary.addRow(["Bloklagan", stats.blocked]);
  summary.addRow(["Bugun /start", stats.startsToday]);
  summary.addRow(["Bugun faol", stats.seenToday]);
  summary.addRow(["Hisobot vaqti", formatTashkent(new Date())]);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    buffer,
    count: users.length,
    filename: `vaksina-lokatsiya-users_${stamp}.xlsx`,
    stats,
  };
}

export function isBlockedSendError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("blocked") ||
    m.includes("deactivated") ||
    m.includes("chat not found") ||
    m.includes("user is deactivated") ||
    m.includes("bot was blocked") ||
    m.includes("forbidden")
  );
}
