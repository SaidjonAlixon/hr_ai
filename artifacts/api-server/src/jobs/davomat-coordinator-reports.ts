import { and, eq, gte } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { isTelegramConfigured, sendDocument, sendMessage } from "../lib/telegram";
import {
  coordinatorDispatches,
  dateLabelUz,
  tashkentNow,
  type ShiftBucket,
} from "../lib/davomat-shift-report";
import { renderDavomatShiftPdf, reportWarning } from "../lib/davomat-shift-report-pdf";

const SLOTS: Array<{
  hour: number;
  hm: string;
  buckets: ShiftBucket[];
  updated: boolean;
  nextWhen: string;
}> = [
  { hour: 10, hm: "10:00", buckets: ["one"], updated: false, nextWhen: "bugun soat 13:00" },
  { hour: 13, hm: "13:00", buckets: ["one", "orta"], updated: true, nextWhen: "bugun soat 17:00 (1-smena tugashi)" },
  { hour: 19, hm: "19:00", buckets: ["two", "12"], updated: false, nextWhen: "bugun soat 22:00" },
  { hour: 22, hm: "22:00", buckets: ["two", "12", "orta"], updated: true, nextWhen: "bugun soat 23:45 (smena tugashi)" },
];

/**
 * Har kuni Toshkent vaqti bilan, har koordinatorga faqat o‘z xodimlari:
 * 10:00 va 13:00 — 1-smena; 19:00 va 22:00 — 2-smena va 1+2; 13:00 va 22:00 — O‘rta smena
 * (smenasi hali boshlanmaganlar «kelmagan» deb yozilmaydi).
 * PDF: kelmaganlar, kechikkanlar, kelganlar + oylik sanoq.
 */
export async function sendCoordinatorShiftReports(): Promise<number> {
  const now = tashkentNow();
  if (now.minute >= 12) return 0;
  const slot = SLOTS.find((s) => s.hour === now.hour);
  if (!slot) return 0;
  if (!isTelegramConfigured()) {
    logger.warn("Davomat smena hisoboti: TELEGRAM_BOT_TOKEN yo‘q");
    return 0;
  }

  const since = new Date(`${now.ymd}T00:00:00+05:00`);
  const label = dateLabelUz(now.ymd);
  const kind = slot.updated ? "Yangilangan hisobot" : "Ogohlantirish";
  let sent = 0;
  const delivered: string[] = [];
  const notInBot: string[] = [];
  const failed: string[] = [];
  const noCoordinator = new Set<string>();

  for (const bucket of slot.buckets) {
    const { items, withoutCoordinator } = await coordinatorDispatches({
      ymd: now.ymd,
      buckets: [bucket],
    });
    for (const name of withoutCoordinator) noCoordinator.add(name);
    const type = `davomat_shift_pdf_${slot.hm.replace(":", "")}_${bucket}`;

    for (const item of items) {
      const block = item.sections.flatMap((s) => s.blocks)[0];
      if (!block?.people.length) continue;
      const line = digestLine(item.coordinatorName, block);
      if (!item.telegramId || !item.userId) {
        notInBot.push(line);
        continue;
      }
      try {
        const [already] = await db
          .select({ id: notificationsTable.id })
          .from(notificationsTable)
          .where(
            and(
              eq(notificationsTable.userId, item.userId),
              eq(notificationsTable.type, type),
              gte(notificationsTable.createdAt, since),
            ),
          )
          .limit(1);
        if (already) {
          delivered.push(line);
          continue;
        }

        const people = block.people;
        const absent = people.filter((p) => p.list === "absent").length;
        const late = people.filter((p) => p.list === "late").length;
        const came = people.filter((p) => p.statusLabel === "Kelgan").length;
        const noLeave = people.filter((p) => p.statusLabel.startsWith("Keldi, ketishi")).length;
        const excused = people.filter((p) => p.statusLabel === "Sababli").length;
        const deadline = reportWarning(label, slot.hm, slot.nextWhen);
        const caption = [
          `${kind}. ${block.title} · ${block.hours}`,
          `Koordinator: ${item.coordinatorName}`,
          "",
          `Bugungi kun: ${label}`,
          `Hisobot vaqti: soat ${slot.hm}`,
          "Shu kundagi ma’lumot — faqat sizning shu smenadagi xodimlaringiz:",
          `Kelmagan: ${absent}`,
          `Kechikkan: ${late}`,
          `Kelgan: ${came}`,
          `Keldi, ketishi yo‘q: ${noLeave}`,
          ...(excused ? [`Sababli: ${excused}`] : []),
          "",
          "To‘liq ro‘yxat, sana va holat shu xabar tagidagi PDF da.",
          "",
          `Keyingi vaqt: ${slot.nextWhen}.`,
          "Shu vaqtgacha kelmagan va kechikkan xodimlarni HR menejerlarga yozib, sababli qildiring. Aks holda bu bir kunlik jarimaga sabab bo‘ladi.",
        ].join("\n");

        const pdf = await renderDavomatShiftPdf({
          dateLabel: label,
          reportHm: slot.hm,
          updated: slot.updated,
          title: slot.updated ? "Davomat · yangilangan hisobot" : "Davomat · ogohlantirish",
          warningText: deadline,
          filterLine: `${item.coordinatorName} · ${block.title} · ${block.hours}`,
          sections: item.sections,
        });
        const file = `davomat_${bucket}_${slot.hm.replace(":", "")}_${now.ymd}.pdf`;
        await sendDocument(item.telegramId, pdf, file, {
          mimeType: "application/pdf",
          caption: caption.slice(0, 1000),
        });
        await db.insert(notificationsTable).values({
          userId: item.userId,
          text: caption.slice(0, 2000),
          type,
          linkUrl: "/davomat",
        });
        delivered.push(line);
        sent += 1;
      } catch (err) {
        failed.push(`${line} Sabab: yuborishda xato.`);
        logger.error({ err, coordinator: item.coordinatorName, bucket }, "Davomat smena hisoboti yuborilmadi");
      }
    }
  }

  await sendAdminDispatchDigest({
    ymd: now.ymd,
    label,
    hm: slot.hm,
    since,
    delivered,
    notInBot,
    failed,
    withoutCoordinator: [...noCoordinator],
  });

  if (sent > 0) logger.info({ sent, slot: slot.hm }, "Davomat smena hisoboti yuborildi");
  return sent;
}

function digestLine(
  name: string,
  block: { title: string; people: Array<{ list: string; statusLabel: string }> },
): string {
  const absent = block.people.filter((p) => p.list === "absent").length;
  const late = block.people.filter((p) => p.list === "late").length;
  const came = block.people.filter((p) => p.statusLabel === "Kelgan").length;
  const noLeave = block.people.filter((p) => p.statusLabel.startsWith("Keldi, ketishi")).length;
  return `${name} — ${block.title}. Xodim ${block.people.length} ta. Kelmagan ${absent}, kechikkan ${late}, kelgan ${came}, keldi-ketishi yo‘q ${noLeave}.`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function numbered(lines: string[]): string {
  if (!lines.length) return "Yo‘q.";
  return lines.map((line, i) => `${i + 1}. ${esc(line)}`).join("\n");
}

async function sendAdminDispatchDigest(opts: {
  ymd: string;
  label: string;
  hm: string;
  since: Date;
  delivered: string[];
  notInBot: string[];
  failed: string[];
  withoutCoordinator: string[];
}): Promise<void> {
  const type = `davomat_admin_digest_${opts.hm.replace(":", "")}`;
  const admins = await db
    .select({
      id: usersTable.id,
      telegramId: usersTable.telegramId,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  const targets = admins.filter((a) => a.status === "active" && String(a.telegramId || "").trim());
  if (!targets.length) return;

  const text = [
    "Davomat hisoboti jo‘natish natijasi.",
    "",
    `Bugungi kun: ${opts.label}.`,
    `Jo‘natilgan vaqt: soat ${opts.hm}.`,
    "Har bir koordinatorga faqat o‘z smenasidagi xodimlari yuboriladi.",
    "",
    `Yuborilgan koordinatorlar (${opts.delivered.length} ta):`,
    numbered(opts.delivered),
    "",
    `Yuborilmagan koordinatorlar — hali botga kirmagan (${opts.notInBot.length} ta):`,
    numbered(opts.notInBot),
    ...(opts.notInBot.length
      ? ["Bularning Telegrami botga ulanmagan, shu sababli hisobot yuborilmadi."]
      : []),
    "",
    `Yuborishda xato bo‘lganlar (${opts.failed.length} ta):`,
    numbered(opts.failed),
    "",
    opts.withoutCoordinator.length
      ? `Koordinatori topilmagan xodimlar (${opts.withoutCoordinator.length} ta): ${esc(opts.withoutCoordinator.sort((a, b) => a.localeCompare(b, "uz")).join(", "))}. Ularga tegishli koordinator bo‘lmagani uchun hisobot yuborilmadi.`
      : "Koordinatori topilmagan xodim yo‘q.",
  ].join("\n");

  const chunks: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const next = cur ? `${cur}\n${line}` : line;
    if (next.length > 3500) {
      if (cur) chunks.push(cur);
      cur = line;
    } else cur = next;
  }
  if (cur) chunks.push(cur);

  for (const admin of targets) {
    const [already] = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, admin.id),
          eq(notificationsTable.type, type),
          gte(notificationsTable.createdAt, opts.since),
        ),
      )
      .limit(1);
    if (already) continue;
    try {
      for (const part of chunks) {
        await sendMessage(String(admin.telegramId), part, { parse_mode: "HTML" });
      }
      await db.insert(notificationsTable).values({
        userId: admin.id,
        text: text.slice(0, 2000),
        type,
        linkUrl: "/davomat",
      });
    } catch (err) {
      logger.error({ err, adminId: admin.id }, "Davomat jo‘natish hisoboti admin ga yuborilmadi");
    }
  }
}
