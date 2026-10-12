/**
 * «Hisobot yuborish» tugmasi: shu daqiqadagi davomat — har koordinatorga faqat o‘z xodimlari.
 * 1) koordinatorning shaxsiy Telegrami + platformadagi bildirishnoma;
 * 2) hisobot guruhidagi «Koordinatorlar» mavzusi — koordinator nik bilan belgilanadi.
 */
import { db, notificationsTable } from "@workspace/db";
import { logger } from "./logger";
import { escapeHtml, getChatMember, isTelegramConfigured, sendDocument, sendMessage } from "./telegram";
import { buildCoordinatorShiftReport, dateLabelUz, tashkentNow, type BuiltSection } from "./davomat-shift-report";
import { renderDavomatShiftPdf } from "./davomat-shift-report-pdf";
import { getReportGroup } from "./telegram-report-group";

export type CoordinatorSendResult = {
  coordinators: number;
  personal: number;
  group: number;
  groupReady: boolean;
  notInBot: string[];
  failed: string[];
  withoutCoordinator: number;
};

function countsOf(section: BuiltSection) {
  const people = section.blocks.flatMap((b) => b.people);
  return {
    total: people.length,
    absent: people.filter((p) => p.list === "absent").length,
    late: people.filter((p) => p.list === "late").length,
    came: people.filter((p) => p.statusLabel === "Kelgan").length,
    noLeave: people.filter((p) => p.statusLabel.startsWith("Keldi, ketishi")).length,
    excused: people.filter((p) => p.statusLabel === "Sababli").length,
  };
}

function summaryLines(c: ReturnType<typeof countsOf>): string[] {
  return [
    `Xodimlar: ${c.total}`,
    `Kelmagan: ${c.absent}`,
    `Kechikkan: ${c.late}`,
    `Kelgan: ${c.came}`,
    `Keldi, ketishi yo‘q: ${c.noLeave}`,
    ...(c.excused ? [`Sababli: ${c.excused}`] : []),
  ];
}

async function mentionOf(chatId: string, section: BuiltSection): Promise<string> {
  const name = escapeHtml(section.coordinatorName);
  if (!section.telegramId) return `<b>${name}</b>`;
  try {
    const member = await getChatMember(chatId, section.telegramId);
    if (member.user?.username) return `@${escapeHtml(member.user.username)} (${name})`;
  } catch {
    /* guruhda yo‘q yoki topilmadi — havola bilan belgilaymiz */
  }
  return `<a href="tg://user?id=${encodeURIComponent(section.telegramId)}">${name}</a>`;
}

export async function sendCoordinatorReportsNow(opts: {
  employeeIds: number[];
  filterLine?: string | null;
  actorName: string;
}): Promise<CoordinatorSendResult> {
  if (!isTelegramConfigured()) throw new Error("Telegram bot sozlanmagan");
  const now = tashkentNow();
  const label = dateLabelUz(now.ymd);
  const sections = await buildCoordinatorShiftReport({ ymd: now.ymd, employeeIds: opts.employeeIds });
  const targets = sections.filter((s) => s.coordinatorEmployeeId && s.blocks.some((b) => b.people.length));
  const withoutCoordinator = sections
    .filter((s) => !s.coordinatorEmployeeId)
    .reduce((n, s) => n + s.blocks.reduce((m, b) => m + b.people.length, 0), 0);

  const group = await getReportGroup().catch(() => null);
  const result: CoordinatorSendResult = {
    coordinators: targets.length,
    personal: 0,
    group: 0,
    groupReady: !!group,
    notInBot: [],
    failed: [],
    withoutCoordinator,
  };
  if (!targets.length) return result;

  const warning = `Bugungi kun: ${label}. Hisobot vaqti: soat ${now.hm} (shu daqiqadagi holat). Kelmagan va kechikkan xodimlarni HR menejerlarga yozib, sababli qildiring. Aks holda bu bir kunlik jarimaga sabab bo‘ladi.`;
  const file = `davomat_${now.ymd}_${now.hm.replace(":", "")}.pdf`;

  if (group) {
    await sendMessage(
      group.chatId,
      `📋 <b>Davomat hisoboti</b> · ${escapeHtml(label)}, soat ${now.hm}\nHar bir koordinatorga faqat o‘z xodimlari jadvali.`,
      { message_thread_id: group.threadId },
    ).catch((err) => logger.warn({ err }, "Koordinator guruhiga sarlavha yuborilmadi"));
  }

  for (const section of targets) {
    const c = countsOf(section);
    let pdf: Buffer;
    try {
      pdf = await renderDavomatShiftPdf({
        dateLabel: label,
        reportHm: now.hm,
        updated: true,
        title: "Davomat · joriy hisobot",
        warningText: warning,
        filterLine: [section.coordinatorName, opts.filterLine].filter(Boolean).join(" · "),
        sections: [section],
      });
    } catch (err) {
      result.failed.push(`${section.coordinatorName}: PDF tayyorlanmadi`);
      logger.error({ err, coordinator: section.coordinatorName }, "Koordinator hisobot PDF");
      continue;
    }

    const personalCaption = [
      "Davomat · joriy hisobot",
      `Koordinator: ${section.coordinatorName}`,
      "",
      `Bugungi kun: ${label}, soat ${now.hm}`,
      "Faqat sizning xodimlaringiz:",
      ...summaryLines(c),
      "",
      "To‘liq jadval shu xabar tagidagi PDF da.",
      "Kelmagan va kechikkan xodimlarni HR menejerlarga yozib, sababli qildiring.",
    ].join("\n");

    if (section.telegramId) {
      try {
        await sendDocument(section.telegramId, pdf, file, { mimeType: "application/pdf", caption: personalCaption.slice(0, 1000) });
        result.personal += 1;
      } catch (err) {
        result.failed.push(`${section.coordinatorName}: shaxsiy chatga yuborilmadi`);
        logger.error({ err, coordinator: section.coordinatorName }, "Koordinator hisobot shaxsiy chatga");
      }
    } else {
      result.notInBot.push(section.coordinatorName);
    }

    if (section.userId) {
      await db
        .insert(notificationsTable)
        .values({ userId: section.userId, text: personalCaption.slice(0, 2000), type: "davomat_coordinator_manual", linkUrl: "/davomat" })
        .catch((err) => logger.warn({ err }, "Koordinator hisobot bildirishnomasi"));
    }

    if (group) {
      try {
        const caption = [
          `${await mentionOf(group.chatId, section)} — sizning xodimlaringiz davomati`,
          `${escapeHtml(label)}, soat ${now.hm}`,
          "",
          ...summaryLines(c).map(escapeHtml),
        ].join("\n");
        await sendDocument(group.chatId, pdf, file, {
          mimeType: "application/pdf",
          caption: caption.slice(0, 1000),
          parseMode: "HTML",
          messageThreadId: group.threadId,
        });
        result.group += 1;
      } catch (err) {
        result.failed.push(`${section.coordinatorName}: guruhga yuborilmadi`);
        logger.error({ err, coordinator: section.coordinatorName }, "Koordinator hisobot guruhga");
      }
    }
  }

  logger.info({ ...result, actor: opts.actorName }, "Koordinator hisobotlari qo‘lda yuborildi");
  return result;
}
