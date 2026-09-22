import { logger } from "./logger";
import { isBlockedSendError } from "./filial-bot-admin";
import { listRecruiterBroadcastTargets } from "./filial-bot-recruiters";
import { markLokatsiyaUserBlocked } from "./filial-bot-users";
import {
  buildDismissAlertText,
  resolveEmployeePlace,
} from "./filial-staffing-monitor";
import { filialSendMessage, isFilialBotConfigured } from "./telegram-filial";

/** Xodim bo‘shatilganda / need_hire — rekruterlarga darhol xabar */
export async function notifyFilialRecruitersStaffNeed(opts: {
  employee: {
    fullName: string;
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    orgRole?: string | null;
    shiftType?: string | null;
    shiftLabel?: string | null;
  };
  branchLocation?: string | null;
  status: string;
}): Promise<void> {
  if (!isFilialBotConfigured()) return;
  if (opts.status !== "dismissed" && opts.status !== "need_hire" && opts.status !== "new") {
    return;
  }

  try {
    const place = await resolveEmployeePlace({
      ...opts.employee,
      branchLocation: opts.branchLocation,
    });
    const text = buildDismissAlertText({
      branch: place.branch,
      district: place.district,
      shift: place.shift,
      roleLabel: place.roleLabel,
      employeeName: opts.employee.fullName,
      status: opts.status,
    });

    const targets = await listRecruiterBroadcastTargets();
    for (const t of targets) {
      try {
        await filialSendMessage(t.chat_id, text, { parse_mode: "HTML" });
      } catch (err) {
        const msg = (err as Error)?.message || String(err);
        if (isBlockedSendError(msg)) {
          await markLokatsiyaUserBlocked(t.telegram_user_id).catch(() => undefined);
        }
        logger.warn({ err, chatId: t.chat_id }, "Recruiter dismiss alert yuborilmadi");
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  } catch (err) {
    logger.warn({ err }, "notifyFilialRecruitersStaffNeed failed");
  }
}
