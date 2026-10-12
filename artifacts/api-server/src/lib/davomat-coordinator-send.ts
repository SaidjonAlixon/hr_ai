/**
 * «Hisobot yuborish» tugmasi: shu daqiqadagi davomat.
 * - koordinatorlarga: har biriga faqat o‘z xodimlari;
 * - direktorga: tanlangan koordinatorlar bo‘yicha bitta to‘liq hisobot.
 * Holat (kelmagan / kechikkan / kelgan) va koordinatorlar tanlanadi.
 * Yuborish: shaxsiy Telegram + platforma bildirishnomasi, guruhdagi «Koordinatorlar» mavzusi (nik bilan belgilanadi).
 */
import { db, notificationsTable, pool } from "@workspace/db";
import { logger } from "./logger";
import { escapeHtml, getChatMember, isTelegramConfigured, sendDocument, sendMessage } from "./telegram";
import { buildCoordinatorShiftReport, dateLabelUz, tashkentNow, type BuiltSection } from "./davomat-shift-report";
import { renderDavomatShiftPdf, type ReportListKind } from "./davomat-shift-report-pdf";
import { getReportGroup } from "./telegram-report-group";

export type ReportSendMode = "coordinators" | "director";

export type CoordinatorSendOptions = {
  mode: ReportSendMode;
  lists: ReportListKind[];
  /** Bo‘sh — barcha koordinatorlar */
  coordinatorIds: number[];
  toPersonal: boolean;
  toGroup: boolean;
  employeeIds?: number[];
  filterLine?: string | null;
  actorName: string;
};

export type CoordinatorSendResult = {
  mode: ReportSendMode;
  coordinators: number;
  people: number;
  recipients: number;
  personal: number;
  group: number;
  groupReady: boolean;
  notInBot: string[];
  failed: string[];
  withoutCoordinator: number;
};

type Recipient = { name: string; userId: number | null; telegramId: string | null };

const LIST_LABEL: Record<ReportListKind, string> = {
  absent: "Kelmaganlar",
  late: "Kechikkanlar",
  present: "Kelganlar",
};
const ALL_LISTS: ReportListKind[] = ["absent", "late", "present"];

const HR_NOTICE =
  "Har bir xodim kelmaganligi yoki kechikkanligi sababini alohida izohlab, ushbu holat qayta takrorlanmasligi uchun qanday choralar ko‘rganingizni HR bo‘limiga — @hrvaksina ga ma’lum qilishingiz shart. Aks holda, sizga jarima solishga sabab bo‘ladi.";

function peopleOf(sections: BuiltSection[]) {
  return sections.flatMap((s) => s.blocks.flatMap((b) => b.people));
}

function countsOf(sections: BuiltSection[]) {
  const people = peopleOf(sections);
  return {
    total: people.length,
    absent: people.filter((p) => p.list === "absent").length,
    late: people.filter((p) => p.list === "late").length,
    present: people.filter((p) => p.list === "present").length,
  };
}

/** «1-smena (08:00–17:00): 3 kishi» — har smena alohida qator */
function shiftLines(section: BuiltSection): string[] {
  return section.blocks.map((b) => `${b.title} (${b.hours}): ${b.people.length} kishi`);
}

function summaryLines(c: ReturnType<typeof countsOf>, lists: ReportListKind[]): string[] {
  return [...lists.map((k) => `${LIST_LABEL[k]}: ${c[k]}`), `Jami: ${c.total}`];
}

/** Faqat tanlangan holatdagi xodimlar qoladi; bo‘sh smena va koordinatorlar tashlanadi */
function keepLists(sections: BuiltSection[], lists: ReportListKind[]): BuiltSection[] {
  const keep = new Set(lists);
  return sections
    .map((s) => ({
      ...s,
      blocks: s.blocks
        .map((b) => ({ ...b, people: b.people.filter((p) => keep.has(p.list)) }))
        .filter((b) => b.people.length),
    }))
    .filter((s) => s.blocks.length);
}

async function mentionOf(chatId: string, who: Recipient): Promise<string> {
  const name = escapeHtml(who.name);
  if (!who.telegramId) return `<b>${name}</b>`;
  try {
    const member = await getChatMember(chatId, who.telegramId);
    if (member.user?.username) return `@${escapeHtml(member.user.username)} (${name})`;
  } catch {
    /* guruhda yo‘q yoki topilmadi — havola bilan belgilaymiz */
  }
  return `<a href="tg://user?id=${encodeURIComponent(who.telegramId)}">${name}</a>`;
}

async function loadDirectors(): Promise<Recipient[]> {
  const { rows } = await pool.query(
    `SELECT id, full_name, telegram_id FROM users
      WHERE role = 'director' AND status IN ('active', 'on_leave')
      ORDER BY full_name`,
  );
  return rows.map((r) => ({
    name: String(r.full_name || "Direktor"),
    userId: Number(r.id),
    telegramId: r.telegram_id ? String(r.telegram_id) : null,
  }));
}

export async function sendCoordinatorReportsNow(opts: CoordinatorSendOptions): Promise<CoordinatorSendResult> {
  if (!isTelegramConfigured()) throw new Error("Telegram bot sozlanmagan");
  const lists = ALL_LISTS.filter((k) => opts.lists.includes(k));
  if (!lists.length) throw new Error("Kamida bitta holatni tanlang");
  if (!opts.toPersonal && !opts.toGroup) throw new Error("Qayerga yuborishni tanlang");

  const now = tashkentNow();
  const label = dateLabelUz(now.ymd);
  const built = await buildCoordinatorShiftReport({
    ymd: now.ymd,
    employeeIds: opts.employeeIds,
    pharmacyOnly: true,
  });
  const withoutCoordinator = peopleOf(built.filter((s) => !s.coordinatorEmployeeId)).length;
  const wantedCoords = new Set(opts.coordinatorIds);
  const chosen = built.filter(
    (s) => s.coordinatorEmployeeId && (!wantedCoords.size || wantedCoords.has(s.coordinatorEmployeeId)),
  );
  const sections = keepLists(chosen, lists);

  const group = opts.toGroup ? await getReportGroup().catch(() => null) : null;
  const result: CoordinatorSendResult = {
    mode: opts.mode,
    coordinators: sections.length,
    people: peopleOf(sections).length,
    recipients: 0,
    personal: 0,
    group: 0,
    groupReady: !!group,
    notInBot: [],
    failed: [],
    withoutCoordinator,
  };
  if (!sections.length) return result;

  const listsLine = lists.map((k) => LIST_LABEL[k]).join(", ");
  const warning = `Bugungi kun: ${label}. Hisobot vaqti: soat ${now.hm} (shu daqiqadagi holat). Kelmagan va kechikkan xodimlarni HR menejerlarga yozib, sababli qildiring. Aks holda bu bir kunlik jarimaga sabab bo‘ladi.`;
  const file = `davomat_${now.ymd}_${now.hm.replace(":", "")}.pdf`;

  const deliver = async (to: Recipient, pdf: Buffer, personalCaption: string, groupHead: string) => {
    if (opts.toPersonal) {
      if (to.telegramId) {
        try {
          await sendDocument(to.telegramId, pdf, file, { mimeType: "application/pdf", caption: personalCaption.slice(0, 1000) });
          result.personal += 1;
        } catch (err) {
          result.failed.push(`${to.name}: shaxsiy chatga yuborilmadi`);
          logger.error({ err, to: to.name }, "Davomat hisobot shaxsiy chatga");
        }
      } else {
        result.notInBot.push(to.name);
      }
      if (to.userId) {
        await db
          .insert(notificationsTable)
          .values({ userId: to.userId, text: personalCaption.slice(0, 2000), type: "davomat_coordinator_manual", linkUrl: "/davomat" })
          .catch((err) => logger.warn({ err }, "Davomat hisobot bildirishnomasi"));
      }
    }
    if (group) {
      try {
        const caption = `${await mentionOf(group.chatId, to)} — ${groupHead}`;
        await sendDocument(group.chatId, pdf, file, {
          mimeType: "application/pdf",
          caption: caption.slice(0, 1000),
          parseMode: "HTML",
          messageThreadId: group.threadId,
        });
        result.group += 1;
      } catch (err) {
        result.failed.push(`${to.name}: guruhga yuborilmadi`);
        logger.error({ err, to: to.name }, "Davomat hisobot guruhga");
      }
    }
  };

  if (opts.mode === "director") {
    const directors = await loadDirectors();
    if (!directors.length) throw new Error("Faol direktor topilmadi");
    result.recipients = directors.length;
    const c = countsOf(sections);
    let pdf: Buffer;
    try {
      pdf = await renderDavomatShiftPdf({
        dateLabel: label,
        reportHm: now.hm,
        updated: true,
        title: "Davomat · to‘liq hisobot",
        warningText: warning,
        filterLine: [`Ko‘rsatilgan: ${listsLine}`, `Koordinatorlar: ${sections.length} ta`, opts.filterLine]
          .filter(Boolean)
          .join(" · "),
        sections,
        lists,
        summary: true,
      });
    } catch (err) {
      logger.error({ err }, "Direktor hisobot PDF");
      throw new Error("PDF tayyorlanmadi");
    }
    const personalCaption = [
      "Davomat · to‘liq hisobot",
      `${label}, soat ${now.hm}`,
      `Ko‘rsatilgan: ${listsLine}`,
      `Koordinatorlar: ${sections.length} ta`,
      "",
      ...summaryLines(c, lists),
      "",
      "To‘liq jadval shu xabar tagidagi PDF da.",
    ].join("\n");
    const groupHead = [
      "to‘liq davomat hisoboti",
      `${escapeHtml(label)}, soat ${now.hm} · ${escapeHtml(listsLine)}`,
      "",
      ...summaryLines(c, lists).map(escapeHtml),
    ].join("\n");
    for (const d of directors) await deliver(d, pdf, personalCaption, groupHead);
    logger.info({ ...result, actor: opts.actorName }, "Direktorga davomat hisoboti yuborildi");
    return result;
  }

  result.recipients = sections.length;
  if (group) {
    await sendMessage(
      group.chatId,
      `📋 <b>Davomat hisoboti</b> · ${escapeHtml(label)}, soat ${now.hm}\nKo‘rsatilgan: ${escapeHtml(listsLine)}\nHar bir koordinatorga faqat o‘z xodimlari jadvali.`,
      { message_thread_id: group.threadId },
    ).catch((err) => logger.warn({ err }, "Koordinator guruhiga sarlavha yuborilmadi"));
  }

  for (const section of sections) {
    const c = countsOf([section]);
    let pdf: Buffer;
    try {
      pdf = await renderDavomatShiftPdf({
        dateLabel: label,
        reportHm: now.hm,
        updated: true,
        title: "Davomat · joriy hisobot",
        warningText: `Bugungi kun: ${label}. Hisobot vaqti: soat ${now.hm} (shu daqiqadagi holat). ${HR_NOTICE}`,
        filterLine: [`Koordinator: ${section.coordinatorName}`, `Ko‘rsatilgan: ${listsLine}`, opts.filterLine]
          .filter(Boolean)
          .join(" · "),
        sections: [section],
        lists,
      });
    } catch (err) {
      result.failed.push(`${section.coordinatorName}: PDF tayyorlanmadi`);
      logger.error({ err, coordinator: section.coordinatorName }, "Koordinator hisobot PDF");
      continue;
    }
    const personalCaption = [
      "Davomat · joriy hisobot",
      `Koordinator: ${section.coordinatorName}`,
      `${label}, soat ${now.hm}`,
      `Ko‘rsatilgan: ${listsLine}`,
      "",
      "Smena:",
      ...shiftLines(section),
      "",
      "Faqat sizning xodimlaringiz:",
      ...summaryLines(c, lists),
      "",
      "To‘liq jadval shu xabar tagidagi PDF da.",
      "",
      `⚠️ ${HR_NOTICE}`,
    ].join("\n");
    const groupHead = [
      "sizning xodimlaringiz davomati",
      `${escapeHtml(label)}, soat ${now.hm}`,
      "",
      "<b>Smena:</b>",
      ...shiftLines(section).map((l) => `🕘 ${escapeHtml(l)}`),
      "",
      ...summaryLines(c, lists).map((l) => `• ${escapeHtml(l)}`),
      "",
      `⚠️ <b>Diqqat!</b> ${escapeHtml(HR_NOTICE)}`,
    ].join("\n");
    await deliver(
      { name: section.coordinatorName, userId: section.userId, telegramId: section.telegramId },
      pdf,
      personalCaption,
      groupHead,
    );
  }

  logger.info({ ...result, actor: opts.actorName }, "Koordinator hisobotlari qo‘lda yuborildi");
  return result;
}
