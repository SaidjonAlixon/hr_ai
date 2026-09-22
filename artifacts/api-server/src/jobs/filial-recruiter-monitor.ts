import { logger } from "../lib/logger";
import { isBlockedSendError } from "../lib/filial-bot-admin";
import { listRecruiterBroadcastTargets } from "../lib/filial-bot-recruiters";
import { markLokatsiyaUserBlocked } from "../lib/filial-bot-users";
import { loadStaffingMonitorReport } from "../lib/filial-staffing-monitor";
import { buildStaffingMonitorExcel } from "../lib/filial-staffing-monitor-excel";
import { renderStaffingMonitorPng } from "../lib/filial-staffing-monitor-image";
import {
  filialSendDocument,
  filialSendMessage,
  filialSendPhoto,
  isFilialBotConfigured,
} from "../lib/telegram-filial";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

let started = false;
let sending = false;

export async function sendRecruiterStaffingMonitor(opts?: {
  chatIds?: number[];
  reason?: string;
}): Promise<{ sent: number; failed: number }> {
  if (!isFilialBotConfigured()) return { sent: 0, failed: 0 };
  if (sending) return { sent: 0, failed: 0 };
  sending = true;
  try {
    const report = await loadStaffingMonitorReport();
    const shortCap = [
      `📊 <b>Xodim ehtiyoji</b> · ${report.totalNeeds} ochiq`,
      report.generatedAtLabel,
      report.analysisLine,
      "",
      "<i>To‘liq — Excel faylda</i>",
    ].join("\n").slice(0, 1024);

    let png: Buffer | null = null;
    let excel: { buffer: Buffer; filename: string; count: number } | null = null;
    try {
      png = await renderStaffingMonitorPng(report);
    } catch (err) {
      logger.warn({ err }, "Recruiter monitor PNG render xato");
    }
    try {
      excel = await buildStaffingMonitorExcel(report);
    } catch (err) {
      logger.warn({ err }, "Recruiter monitor Excel xato");
    }

    const targets = opts?.chatIds?.length
      ? opts.chatIds.map((id) => ({ chat_id: id, telegram_user_id: id, name: "" }))
      : await listRecruiterBroadcastTargets();

    let sent = 0;
    let failed = 0;
    for (const t of targets) {
      try {
        if (png?.length) {
          await filialSendPhoto(t.chat_id, png, {
            caption: shortCap,
            parse_mode: "HTML",
            filename: "vaksina-xodim-ehtiyoji.png",
          });
        } else {
          await filialSendMessage(t.chat_id, shortCap, { parse_mode: "HTML" });
        }
        if (excel?.buffer?.length) {
          await filialSendDocument(t.chat_id, excel.buffer, excel.filename, {
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            caption: `📎 Excel · ${excel.count} ochiq ehtiyoj`,
          });
        }
        sent += 1;
      } catch (err) {
        failed += 1;
        const msg = (err as Error)?.message || String(err);
        if (isBlockedSendError(msg)) {
          try {
            await markLokatsiyaUserBlocked(t.telegram_user_id);
          } catch {
            /* ignore */
          }
        }
        logger.warn({ err, chatId: t.chat_id }, "Recruiter monitor yuborilmadi");
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    logger.info(
      { sent, failed, totalNeeds: report.totalNeeds, reason: opts?.reason || "schedule" },
      "Recruiter staffing monitor yuborildi",
    );
    return { sent, failed };
  } finally {
    sending = false;
  }
}

export function startFilialRecruiterMonitorJob(): void {
  if (started) return;
  if (!isFilialBotConfigured()) {
    logger.info("Recruiter monitor: filial bot token yo‘q — o‘chirilgan");
    return;
  }
  started = true;

  setTimeout(() => {
    sendRecruiterStaffingMonitor({ reason: "startup" }).catch((err) =>
      logger.error({ err }, "Recruiter monitor startup failed"),
    );
  }, 120_000);

  setInterval(() => {
    sendRecruiterStaffingMonitor({ reason: "every_3h" }).catch((err) =>
      logger.error({ err }, "Recruiter monitor job failed"),
    );
  }, THREE_HOURS_MS);

  logger.info("Recruiter staffing monitor job started (every 3 hours)");
}
